# Parallel-Safe E2E — Per-Agent Isolation (v2, post-audits)

**Goal.** Multiple agents (2–4) running `bun run test:e2e:network` concurrently from sibling git worktrees do not collide on ports, processes, build artifacts, or external state. Each agent owns its own anvil + aztec sandbox + playground + chrome instance and runs to completion independently of the others.

**Status.** v2 — consolidates Codex (xhigh) + Opus 4.7 audits and the user's resolved decisions.

**Audit artefacts:** `audit-codex.md`, `audit-opus.md`.

---

## 1. What's actually broken (consolidated)

| Resource | Behaviour today | Risk |
|---|---|---|
| Anvil :8545 | External; relied on a user-launched anvil at :8545 — the holonym project's anvil happens to be there. | Foreign chain state contaminates tests. |
| Aztec :8080 | `global-setup.ts:98` spawns `aztec start --local-network` with no `--port`/`--l1-rpc-urls`. Picks up `ETHEREUM_HOSTS` env, fails if anvil isn't on :8545. | Two agents both try :8080. |
| Wallet "Local Network" preset | `network/service.ts:74-79` hardcodes `http://localhost:8080`. `_getChainId` at `:680` does string equality against that literal. | Even if we move the sandbox to a different port, the wallet still talks to :8080. |
| `_getChainId` URL equality | Returns 0 only for the literal `"http://localhost:8080"`. | A user editing Local Network's URL via the endpoint UI gets a chainId mismatch they can't escape. |
| "Already running" reuse | `checkNodeHealth(LOCAL_NODE_URL)` accepts ANY service answering on the URL. | Agents silently attach to each other's services if ports collide. (Codex critical) |
| Cleanup model | Teardown kills services. Reuse doesn't actually buy anything across runs because each run cold-starts. | Plan's "reuse" justification is fiction. (Codex critical) |
| FPC bridge derivation | `aztec-private-fpc-bridge.ts:33` derives from `feeAssetHandlerAddress` which comes from anvil deploy nonce. | Two agents on a shared anvil can't both deploy without collision. (Opus high) |
| Default ports | Agent 0 = :8545/:8080/:5174 = same defaults every other tool uses. | Real conflict, not theoretical. |

What's already isolated and we don't need to touch: per-worktree `dist/chrome/`, `.test-config.json`, path-scoped `pkill`, Puppeteer user-data-dir, EmbeddedWallet's PXE temp dir.

---

## 2. Architecture

### 2.1 Port allocation — bind-and-hand-off

Always auto-allocate. Never use defaults. The only sane choice once the user has any other L1 dev tool installed.

The implementation must avoid the "found a free port but lost it" race Codex flagged. Pattern:

```ts
// scripts/e2e/resolve-ports.ts
import { createServer } from "node:net"

async function reservePort(): Promise<{ port: number; release: () => void }> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port
      // Hold the socket until the caller is ready to spawn its child.
      // The caller releases by calling `release()` immediately before `spawn()`.
      resolve({ port, release: () => srv.close() })
    })
    srv.once("error", reject)
  })
}

export async function reserveAgentPorts() {
  const anvil = await reservePort()
  const aztec = await reservePort()
  const aztecAdmin = await reservePort()
  const aztecP2P = await reservePort()
  const playground = await reservePort()
  return { anvil, aztec, aztecAdmin, aztecP2P, playground }
}
```

`global-setup.ts` reserves all five, then for each child it calls `release()` immediately before `spawn(... --port ${port})`. Window of vulnerability is one syscall. Acceptable.

### 2.2 Wallet "Local Network" — structural matching + build-time stamping (user decision)

Two complementary changes. Neither alone suffices once the URL is dynamic.

**(a) Structural match in `_getChainId`** — fixes the pre-existing UX bug Opus flagged where a user editing Local Network's endpoint URL gets `ERR_ENDPOINT_CHAIN_MISMATCH`:

```ts
// network/service.ts ~line 676 — current
private async _getChainId(rpcUrl: string): Promise<number> {
  const rpc = this.nodeFactory.createNode(rpcUrl)
  const info = await rpc.getNodeInfo()
  if (rpcUrl === "http://localhost:8080") return 0
  return (info.l1ChainId ^ info.rollupVersion) >>> 0
}

// v2 — adds a kindHint from callers that know
private async _getChainId(rpcUrl: string, kindHint?: ChainKind): Promise<number> {
  const rpc = this.nodeFactory.createNode(rpcUrl)
  const info = await rpc.getNodeInfo()
  if (kindHint === "local") return 0   // structural — survives URL edits
  if (normalizeRpcUrl(rpcUrl) === normalizeRpcUrl(LOCAL_NETWORK_RPC_URL)) return 0
  return (info.l1ChainId ^ info.rollupVersion) >>> 0
}
```

`addEndpoint` and `updateEndpoint` — both know the network they're modifying — pass `network.kind` as `kindHint`. `addNetwork` doesn't (always custom) — leaves the URL fallback as the only path for new local-like networks (very rare).

**(b) Build-time stamp on the seed** — keeps the network detail UI honest about which URL the wallet is actually talking to:

```ts
// network/service.ts ~line 51
const LOCAL_NETWORK_RPC_URL = import.meta.env.VITE_LOCAL_NETWORK_RPC_URL ?? "http://localhost:8080"

const DEFAULT_SEEDS: DefaultSeed[] = [
  // ...
  {
    name: "Local Network",
    rpcUrl: LOCAL_NETWORK_RPC_URL,
    chainId: 0,
    kind: "local",
    isPrimaryActive: false,
  },
]
```

Vite's standard `import.meta.env.VITE_*` exposure handles the substitution. No extra `define` block needed.

### 2.3 Anvil — owned per agent, identity-asserted

Spawn:

```bash
~/.aztec/current/bin/anvil \
  --host 127.0.0.1 \
  --port $ANVIL_PORT \
  --chain-id 31337 \
  --slots-in-an-epoch 1 \
  --silent
```

Health check via `eth_blockNumber` POST. **Identity check** comes after the aztec sandbox lands, because anvil itself doesn't have a "this is my deployment" signal yet — see §2.4.

### 2.4 Aztec — owned per agent, fully parametrized, identity-asserted

Spawn (note: `--data-directory` is mandatory per Opus — defeats `~/.aztec/data` collisions even when state is ephemeral):

```bash
~/.aztec/current/node_modules/.bin/aztec start --local-network \
  --port $AZTEC_PORT \
  --admin-port $AZTEC_ADMIN_PORT \
  --p2p.p2pPort $P2P_PORT \
  --l1-rpc-urls "http://127.0.0.1:$ANVIL_PORT" \
  --data-directory "/tmp/nulo-aztec-${AGENT_ID}-${TS}" \
  --disable-admin-api-key
```

Env: `SEQ_MIN_TX_PER_BLOCK=0`, `ETHEREUM_HOSTS=http://127.0.0.1:$ANVIL_PORT`, `ANVIL_PORT=$ANVIL_PORT`, `AZTEC_PORT=$AZTEC_PORT`.

**Identity check (user picked: L1 contract addresses).** After `waitForLocalNode()`, setup calls `node.getNodeInfo()` and records `nodeInfo.l1ContractAddresses` in the lockfile. Reuse logic compares the candidate sandbox's `l1ContractAddresses` against the recorded set — only if all match does it accept the sandbox as ours. This catches any case where:

- Another agent's aztec is now on our port.
- Someone manually started an aztec.
- Our recorded sandbox died and was replaced by an unrelated process.

### 2.5 Ownership lockfile (user picked: full ownership lock)

Path: `packages/extension/.e2e-state/owned.json` (gitignored).

Schema:

```ts
interface OwnedState {
  agentId: string         // ulid or pid-derived; just identifies this run
  startedAt: string       // ISO timestamp
  bakedLocalRpcUrl: string // matches the build's VITE_LOCAL_NETWORK_RPC_URL
  ports: { anvil: number; aztec: number; aztecAdmin: number; aztecP2P: number; playground: number }
  pids: { anvil: number; aztec: number; playground: number }
  pgids: { anvil: number; aztec: number; playground: number }  // process-group ids for clean kill
  l1ContractAddresses: Record<string, string>  // recorded post-deploy from getNodeInfo()
}
```

Lifecycle:

1. **Setup start.** Read existing lock if present. Validate: PIDs alive (`process.kill(pid, 0)` returns true), ports answer, `bakedLocalRpcUrl` matches the current build's stamp, candidate sandbox's `l1ContractAddresses` match recorded. If all pass → reuse, skip cold-start. If any fail → tear down the rotten state and start fresh.
2. **First run.** Reserve ports → spawn anvil → spawn aztec (with anvil URL) → spawn playground → record everything to `owned.json` atomically (write to `.tmp` and rename).
3. **Teardown.** `process.kill(-pgid, "SIGTERM")` for each tracked pgid; wait up to 5 s; `SIGKILL` escalation; remove the lockfile.
4. **SIGINT / SIGTERM / process exit.** Same teardown path.

**Mutual exclusion within a worktree.** The lockfile doubles as a single-runner-per-worktree gate. If the lock is fresh AND its services are healthy, a second `bun run e2e:agent` in the same worktree should refuse to start (it would race with the running one). For now, document this as a constraint; we can add `flock`-style enforcement later.

### 2.6 Build wrapper — `bun run e2e:agent`

```sh
#!/usr/bin/env bash
# packages/extension/scripts/e2e/agent.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

# Resolve ports + agent id; writes .e2e-state/ports.json
bun run scripts/e2e/resolve-ports.ts

# Read what we just wrote
PORTS_JSON=".e2e-state/ports.json"
ANVIL_PORT=$(jq -r .anvil "$PORTS_JSON")
AZTEC_PORT=$(jq -r .aztec "$PORTS_JSON")
PLAYGROUND_PORT=$(jq -r .playground "$PORTS_JSON")

# Build with the baked URL
VITE_LOCAL_NETWORK_RPC_URL="http://localhost:${AZTEC_PORT}" bun run build:chrome

# Run e2e
ANVIL_URL="http://127.0.0.1:${ANVIL_PORT}" \
AZTEC_NODE_URL="http://localhost:${AZTEC_PORT}" \
ANVIL_PORT="${ANVIL_PORT}" \
AZTEC_PORT="${AZTEC_PORT}" \
PLAYGROUND_PORT="${PLAYGROUND_PORT}" \
PLAYGROUND_URL="http://localhost:${PLAYGROUND_PORT}/" \
  bun run vitest run --config vitest.e2e.network.config.ts "$@"
```

Reasons env-var pass-through is needed even though we wrote a JSON file:
- `aztec-private-fpc-bridge.ts:35` reads `process.env.ANVIL_URL`.
- `start_anvil.ts:53` (used inside aztec internals) reads `ANVIL_PORT`. Pass it explicitly to avoid that fallback ever firing on a stale value.

### 2.7 Post-build verification (replaces vi.stubEnv unit test)

```sh
# in agent.sh, between build and test
if ! grep -q "${AZTEC_NODE_URL}" packages/extension/dist/chrome/assets/*.js; then
  echo "[e2e-setup] FATAL: bundled URL doesn't match AZTEC_NODE_URL=${AZTEC_NODE_URL}"
  echo "[e2e-setup] Did the vite build env propagate? Aborting."
  exit 1
fi
```

Catches the mistake Opus flagged: `vi.stubEnv` only patches `process.env`, not `import.meta.env.VITE_*`. The post-build grep is the only reliable check that the URL is actually in the bundle.

### 2.8 Cleanup correctness

- `process.kill(-pgid, "SIGTERM")`. Wait up to 5 s with a 200 ms poll for child exit.
- If still alive: `process.kill(-pgid, "SIGKILL")`.
- Stream destroy at end so PipeWrap handles don't keep the loop alive.
- Lockfile removed even on error paths.
- `pkill -f "chrome.*--load-extension=${EXTENSION_PATH}"` retained — already path-scoped.

---

## 3. Implementation phases

### Phase 1 — Wallet code (small, isolated)

Files:
- `packages/extension/src/wallet/services/network/service.ts` — add `LOCAL_NETWORK_RPC_URL` constant, structural `kindHint` parameter on `_getChainId`, normalized URL fallback, callers pass `kindHint` from `addEndpoint`/`updateEndpoint`.
- `packages/extension/vite.config.ts` — verify `import.meta.env.VITE_LOCAL_NETWORK_RPC_URL` is exposed (vite default; document the convention).
- `packages/extension/src/wallet/services/network/service.test.ts` — `kindHint === "local"` overrides chainId; fallback URL match; default `localhost:8080` still works; trailing-slash variant accepted via `normalizeRpcUrl`.

**Validation:** `bun run typecheck && bun run test && bun run build`. Smoke: `VITE_LOCAL_NETWORK_RPC_URL=http://localhost:18080 bun run build`, load extension, register profile, verify Local Network shows the new URL in network detail.

### Phase 2 — Port reservation utility + agent script scaffolding

Files:
- `packages/extension/scripts/e2e/resolve-ports.ts` — bind-and-hand-off helper; emits `.e2e-state/ports.json`.
- `packages/extension/scripts/e2e/agent.sh` — orchestrator (resolve-ports → build → grep-check → vitest).
- Root `package.json` adds `"e2e:agent": "bun run --cwd packages/extension scripts/e2e/agent.sh"` (and a passthrough flag for selecting test files).

**Validation:** call `resolve-ports.ts` standalone; verify it returns five distinct ports each run and that the held sockets release cleanly when the script exits.

### Phase 3 — Anvil spawn + aztec re-parametrization in global-setup.ts

Files:
- `packages/extension/tests/e2e/global-setup.ts` — add anvil spawn (`AnvilProcess`, `weStartedAnvil`, `killAnvilProcess`); pass full flag set to aztec; resolve URLs from env (already plumbed).
- `packages/extension/tests/e2e/fixtures/aztec.ts` — no behavioural change; ensure `LOCAL_NODE_URL` resolves from `AZTEC_NODE_URL` env (already does).

**Validation:** delete any external anvil; `bun run e2e:agent`; assert it spawns anvil + aztec + playground and tests pass identically to today.

### Phase 4 — Ownership lockfile + identity check

Files:
- `packages/extension/tests/e2e/lockfile.ts` — typed read/write/validate helpers for `owned.json`.
- `packages/extension/tests/e2e/global-setup.ts` — uses lockfile for reuse decisions; records `l1ContractAddresses`; teardown always removes the lock.
- `.gitignore` — exclude `packages/extension/.e2e-state/`.

**Validation:** kill `bun run e2e:agent` halfway; rerun; confirm setup detects stale lock and tears down before starting fresh. `lsof -ti:<recorded ports>` should match the running agents only.

### Phase 5 — Parallel-agent acceptance

Open two worktrees (`nulo/`, `nulo-1/`); `bun run e2e:agent` in both. Both pass. Logs show distinct port packs. `lsof` shows two anvils, two aztecs, two playgrounds. No cross-talk in test output.

Then scale to four worktrees, repeat.

### Phase 6 — Doc + risk-table closeout

`packages/extension/tests/e2e/README.md` — covers parallel-agent semantics, the agent script, the lockfile, troubleshooting (collisions, manual cleanup of stale `.e2e-state/`).

---

## 4. Risks & mitigations (post-audit)

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Two agents bind to the same port via auto-allocate race | Low | High | bind-and-hand-off pattern; one syscall window; in practice infinitesimal |
| Build with wrong URL stamping (mismatch with AZTEC_NODE_URL) | Med | High | post-build `grep` assertion in `agent.sh`; setup also re-asserts via lockfile's `bakedLocalRpcUrl` field |
| Lockfile says "ours" but PID is reused by an unrelated process | Low | Med | identity check (`l1ContractAddresses` match) catches this |
| `~/.aztec/data` LMDB corruption | Low after fix | High | always pass `--data-directory` per agent (mandatory in v2) |
| `aztec start` cold-start dominates total runtime | High | Low | lockfile-based reuse skips cold start when state is healthy |
| Stale build serves cross-worktree e2e | Low after guard | High | post-build `grep` + lockfile mismatch detection |
| FPC bridge non-determinism across re-deploys to shared anvil | None after design | Med | architecture forbids shared anvil; identity check catches drift |
| User has another aztec/anvil/playground on the machine | Med | None | auto-allocate side-steps; never uses defaults |
| Vitest worker recycle eats stdout from child processes | Low | Low | log to `.e2e-state/logs/{anvil,aztec,playground}.log` for post-mortem |
| SIGTERM doesn't propagate to grandchildren | Med | Med | use `process.kill(-pgid)` (process group); SIGKILL escalation after 5 s |

---

## 5. Validation matrix

| Scenario | Expected | Phase |
|---|---|---|
| Single agent, fresh worktree | Spawns anvil + aztec + playground; tests pass | 3 |
| Single agent, second run in same worktree | Reuses healthy lock; skips cold-start | 4 |
| Single agent, second run after Ctrl-C mid-run | Detects stale lock; tears down; cold-starts | 4 |
| Two agents, sibling worktrees | Both pass; distinct port packs; no cross-talk | 5 |
| Four agents, sibling worktrees | All four pass; runtime within 1.5x of single-agent | 5 |
| User has anvil already on :8545 | Agent ignores it; auto-allocates a different port | 3 |
| Build with override URL | Network detail page shows configured URL; bundle grep finds it | 1 |
| Wallet user edits Local Network endpoint URL | No `ERR_ENDPOINT_CHAIN_MISMATCH`; structural `kindHint` returns 0 | 1 |
| Agent's aztec dies mid-run | Subsequent setup detects identity check failure; rebuilds state | 4 |

---

## 6. Open implementation questions

(None remaining for the user — Q1–Q3 from v1 and the three new audit-driven questions are all resolved.)

User's resolved decisions:
- Q1 ports: **Auto-allocate** (bind-and-hand-off pattern from §2.1).
- Q2 sandbox state: **In-memory** + **always pass `--data-directory`** per agent.
- Q3 UX: **One command** `bun run e2e:agent`.
- D1 URL injection: **Both** structural-match (§2.2a) + build-time stamping (§2.2b).
- D2 ownership: **Full lockfile** (§2.5).
- D3 identity check: **L1 contract addresses match** (§2.4).
