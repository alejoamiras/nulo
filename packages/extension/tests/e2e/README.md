# E2E test suite

Three vitest configs live next to this README:

| Config | Suite | Boots a sandbox? |
|---|---|---|
| `vitest.e2e.config.ts` | Smoke (`tests/e2e/*.test.ts`) | No |
| `vitest.e2e.network.config.ts` | Network (`tests/e2e/network/**`) | Yes — anvil + aztec + playground |
| `vitest.e2e.all.config.ts` | Smoke + network | Yes |

The smoke suite drives the extension UI without an Aztec node and runs from any worktree. The network suite expects a per-run anvil + aztec sandbox + playground; this README focuses on it.

## Running locally

The agent wrapper handles port allocation, the wallet build, and the test invocation in one shot:

```bash
bun run e2e:agent                                    # full network suite
bun run e2e:agent --reporter=verbose                 # extra args go to vitest
bun run e2e:agent tests/e2e/network/transfers.test.ts # filter to one file
bun run e2e:agent --shard=5/5                        # reproduce one CI shard (see "CI sharding")
```

Internally `scripts/e2e/agent.sh`:

1. Calls `scripts/e2e/resolve-ports.ts` to allocate five ephemeral TCP ports (anvil, aztec, aztec admin, aztec p2p, playground) and persists them to `.e2e-state/ports.json`.
2. Builds the Chrome extension with `VITE_LOCAL_NETWORK_RPC_URL=http://localhost:<aztec port>` so the wallet's "Local Network" preset talks to this run's sandbox.
3. Greps the bundle for the URL — fails fast if the vite env didn't propagate.
4. Runs the network suite with `ANVIL_URL` / `ANVIL_PORT` / `AZTEC_NODE_URL` / `AZTEC_PORT` / `AZTEC_ADMIN_PORT` / `AZTEC_P2P_PORT` / `PLAYGROUND_URL` / `PLAYGROUND_PORT` in env.

`global-setup.ts` reads those env vars, spawns anvil + aztec + playground (each with the assigned port) and writes an ownership lockfile at `.e2e-state/owned.json`.

### Accelerator: local vs CI

**Locally** (`bun run e2e:agent`), the wallet's `AcceleratorProver` (from `@alejoamiras/aztec-accelerator`) auto-detects whichever proving backend is up on `127.0.0.1:59833`:

- **Aztec Accelerator** (the user-facing desktop app on macOS) running → native bb proving.
- Nothing → silent fallback to in-browser WASM (still works, just slower).

There is no `VITE_NULO_ACCELERATOR_REQUIRED` enforcement locally. This matches production behavior — end users without Aztec Accelerator installed get WASM proving without any error.

**In CI** (`pr-network-e2e.yml`), the workflow:

1. Installs the headless **`accelerator-server`** binary (Linux x86_64 release from `alejoamiras/aztec-accelerator`, SHA-256 pinned).
2. Starts it on the runner's `127.0.0.1:59833`.
3. Builds the wallet with `VITE_NULO_ACCELERATOR_REQUIRED=1` → `chain-runtime.ts` constructs `ProductionPxeFactory` in required-mode (eager preflight + `onPhase` throw on silent-fallback paths).
4. Any test where the wallet would have fallen back to WASM fails loudly with `[accelerator-required] SDK emitted phase="fallback"`.

The terminology gap matters: **Aztec Accelerator** is the desktop app a user installs; **accelerator-server** is the headless binary CI uses. Same HTTP contract, different surface.

**Caveat for local devs running e2e while Aztec Accelerator is running**: both compete on `127.0.0.1:59833`. The wallet probes `/health` and routes to whichever responds first — usually the one that started first. No crash, but proves may be routed to the desktop app instead of being explicitly absent. If this matters for a specific test, quit the desktop app before `bun run e2e:agent`.

### Proverless mode

`NULO_E2E_PROVERLESS=1 bun run e2e:agent <file>` builds the wallet with `proverEnabled:false` (skips BB-SNARK generation; kernel simulation + on-chain submission stay real — the local node accepts the fake proof). Much faster than real proving, and accelerator-independent (it's forced off). The agent arms the double-opt-in flags + asserts the proverless build stamp. Most CI shards run this way.

The **STUB** tests (`cancel-mid-prove`, `concurrent-sendtx-{approve,confirm}`) hold the tx at `proving` via a `ProofGate` barrier (`holdProofGate`/`releaseProofGate` in `fixtures/proof-gate.ts`, backed by `chrome.storage.session` key `nulo:e2e:proof-gate`) so the sub-second proverless prove still gives a deterministic window. Real BB proving is guarded by the prover-ON `network-e2e-canary` CI job (`transfers` + `tx-sendTx-default`); see [CI.md § Proverless network e2e](../../../../CI.md). Full design: [`implementations-plan/e2e-proverless-stub/`](../../../../implementations-plan/e2e-proverless-stub/plan.md).

## Running multiple agents in parallel

Open one terminal per worktree and run `bun run e2e:agent` in each. Each agent allocates fresh ports and owns its own anvil + aztec + playground:

```bash
# terminal 1 — worktree at ~/Projects/nulo/nulo-1
bun run e2e:agent

# terminal 2 — worktree at ~/Projects/nulo/nulo-2
bun run e2e:agent
```

Verify with `lsof`:

```bash
lsof -iTCP -sTCP:LISTEN -P | grep -E "anvil|node"
```

You should see two of each, on different ports. The Chrome processes are scoped via `--load-extension=$EXTENSION_PATH` so the orphan-cleanup `pkill` in setup only kills *this* worktree's chromes.

### Verified concurrent run

Two-worktree proof of isolation, captured during PR validation:

| Worktree | Port pack (anvil, aztec, admin, p2p, pg) | Token contract deployed |
|---|---|---|
| `nulo-1`     | `49522, 49523, 49524, 49525, 49526` | `0x0693fd819c9dd798…` |
| `legacy-rebrand`  | `49527, 49528, 49529, 49530, 49531` | `0x1c477acbeea157c9…` |

Both ran `bun run e2e:agent tests/e2e/network/meta-getChainInfo.test.ts` simultaneously. Both passed `1/1` in ~40s wall. The distinct token-contract addresses prove the runs deployed against independent PXE state.

## Single-worktree fast iteration

If you `bun run vitest run --config vitest.e2e.network.config.ts` directly with stable env vars (e.g. `AZTEC_PORT=8080` etc.), `global-setup.ts` will reuse a still-healthy sandbox from the previous run instead of cold-starting:

- the lockfile must exist
- the recorded ports + baked URL must match the current env
- the recorded PIDs must still be alive
- the candidate sandbox must report the same L1 contract addresses recorded post-deploy (proves we're talking to *our* sandbox, not a stranger that drifted onto the same port)

If any check fails, setup reaps the stale children and cold-starts a fresh stack. `bun run e2e:agent` always allocates fresh ports, so it never hits the reuse path — the lockfile only serves orphan cleanup there.

## CI sharding (5-way matrix)

CI runs the network suite as a **5-shard GitHub Actions matrix** (`.github/workflows/pr-network-e2e.yml`). Each shard:

- Is its own ubuntu-latest VM — own anvil, own aztec node, own playground vite, own Chrome
- Gets ~9 of the 45 network test files, assigned deterministically by vitest's `--shard=N/M` (SHA-1 hash of filename)
- Runs in parallel with the other 4 shards

**Wall time**: ~10–15 min (vs ~35–45 min unsharded). CPU minutes: ~25% more than serial (each shard pays the ~30s anvil+aztec boot cost), but the wall-time win is dramatic.

**Why N=5 and not N=4 or N=9**: legacy reasoning from when `tx-sendTx-multicall` and `multi-account-from` were collision-sensitive under WASM proving. N=4 collided them on the same shard, blowing the shard timeout; N=5 separated them. Post-accelerator (PR #67) the per-prove time is bounded enough that the collision concern no longer holds — N=5 is preserved for now as the stable shape, but could be tuned in a future PR.

**Failing shard logs**: each shard uploads its own artifact (`network-e2e-logs-<N>-of-5`) containing `.e2e-state`, `aztec-*.log`, `anvil-*.log`, `accelerator-server.log`, `accelerator-health.json` on failure.

**Reproducing a CI shard locally**: pass `--shard=N/5` to `e2e:agent`:

```bash
bun run e2e:agent --shard=5/5                                  # just the files in shard 5
```

Vitest's deterministic SHA-1-of-filename sharder picks the same files locally as in CI, so this is the fastest way to reproduce a shard-specific failure (e.g. "register-token only fails on shard 1"). Each invocation still starts its own anvil + aztec + playground; running multiple shards in parallel needs multiple worktrees (see "Running multiple agents in parallel" above).

**Previously quarantined**: `tx-sendTx-default`, `multi-account-from`, `tx-sendTx-multicall` (both #32 + #33) were previously skipped on CI via `NULO_E2E_SKIP_DEFERRED_SLOW=1` (now removed) due to the WASM kernel-prove tail exceeding puppeteer's 300s `protocolTimeout` on slow runners. Resolved by restructuring those tests + the `tx-sendTx-{noFrom,feePayer,sponsoredFpc}` siblings to assert on the wallet's journal `proving` stage via `waitForSendTxActiveStage()` instead of waiting on the dApp's full sendTx promise. See `implementations-plan/journal-stage-restructure/`.

**Known limitation: cold-shard rotation.** Each shard starts with a fresh anvil + aztec + playground + Chrome + extension. The FIRST capability-popup-driven test in shard 1 (whichever file the SHA-1 sharder puts first) pays a cold-SW penalty — `chrome.windows.create` + bb.js init + PXE warmup can push that test past its budget. Quarantining the offender just exposes the next file as the new "first" victim. The structural fix is a fixture-level warm-up tap or pre-grant-capability fixture; tracked in [Issue #59](https://github.com/alejoamiras/nulo/issues/59). Until then: Network e2e is treated as advisory on `dev` (only `Quality / Status` is the required check); single-shard re-runs (or local repro via `--shard=N/5`) usually pass green once the SW is warm.

## Troubleshooting

**`FATAL: built bundle does not contain http://localhost:<port>`** — vite didn't substitute `import.meta.env.VITE_LOCAL_NETWORK_RPC_URL`. Confirm `vite.config.ts` exposes the `VITE_*` env (this is on by default; the build wrapper passes the env via `VITE_LOCAL_NETWORK_RPC_URL=... bun run build:chrome`).

**`Timed out waiting for anvil at …`** — the bundled anvil binary failed to bind. Check `lsof -ti:<anvil port>` for an unrelated process. Re-run `bun run e2e:agent` to allocate a fresh port.

**`prior sandbox identity mismatch — tearing down and starting fresh`** — a previous run's sandbox died and a foreign process took over its port. Setup detects this via the L1-contract-address check and recovers automatically.

**`reaped orphan <name> pid=<n>`** — a previous agent run left children alive (Ctrl-C, OOM). Setup found them through the lockfile and reaped them. No action needed.

**Manual cleanup of stale state.** Delete `.e2e-state/` in the worktree, then `pkill -f "anvil.*--port"` and `pkill -f "aztec.*start.*--local-network"` if you suspect leftover processes.

## Helper conventions (CDP regression workarounds)

A Puppeteer/Chrome interaction layer regressed somewhere between sandbox ABI versions; e2e helpers in `fixtures/extension.ts` and `fixtures/helpers.ts` work around it. **Do not bypass these helpers** — calling raw `page.click()` / `handle.click()` / `page.waitForFunction()` directly will reintroduce flakes that look like timeouts but are actually CDP / rAF-throttling issues.

| Helper | Use it instead of | Why |
|---|---|---|
| `clickByTestId(page, id)` / `clickSelector(page, sel)` | `(await page.waitForSelector(...))!.click()` and `handle.click()` | The CDP element-handle click hangs with `Runtime.callFunctionOn timed out`. Synthetic in-page click via `page.evaluate(() => el.click())` bypasses the broken protocol path. |
| `typeIntoInput` / `replaceInputValue` | `handle.type(text)` | Same CDP path, same hang. The helper sets `value` via the prototype setter and dispatches `input` events. |
| `patchPagePolling(page)` (auto-applied by `launchExtension`, `openPopup`, `openPlayground`, `waitForPopup`) | manually configuring polling on every `page.waitForFunction` call | Default `'raf'` polling is throttled in offscreen / unfocused tabs. Patch defaults to `polling: 200`. `waitForSelector` (CSS-only) is rerouted through the patched `waitForFunction` for the same reason; prefixed selectors (`text/`, `xpath/`, `aria/`, `pierce/`) are left alone. |
| `closeStuckPopup(page)` | waiting for the popup to unmount after a confirm/submit | Vue `<Transition>` sticks mid-enter / mid-leave under headless Chrome rAF throttling — `slide-enter-from + slide-enter-active` never advances. Helper force-removes the `#popup` teleport children + dim backdrop AFTER asserting the actual post-mutation signal (row appeared, contact deleted, etc.). |

Anti-throttle Chrome flags live in `launchExtension` (`extension.ts`):

```
--disable-renderer-backgrounding
--disable-backgrounding-occluded-windows
--disable-features=CalculateNativeWinOcclusion
```

`protocolTimeout: 300_000` is set on the browser launch; this is a safety net, not a fix — the helpers above are the actual fix.

## Known failures + triage

The full network suite is currently **46 / 66 passing**. The 18 remaining failures are tracked in `implementations-plan/network-test-triage/plan.md` and bucketed as: importToken cascade (14), contacts-sender (3), data-registerSender (1). None are infrastructure regressions from this work — they predate the parallel-isolation refactor.

## What's owned per worktree (parallel-safety summary)

| Resource | Per-worktree isolated? | How |
|---|---|---|
| Anvil PID | Yes | spawned by setup; tracked in lockfile |
| Aztec sandbox PID | Yes | spawned by setup; tracked in lockfile; data dir `/tmp/nulo-aztec-<pid>-<ts>` |
| Playground vite PID | Yes | spawned by setup; tracked in lockfile |
| Ports | Yes | bind-and-release via `resolve-ports.ts`; spawn re-binds |
| Wallet build artifact | Yes | `dist/chrome/` lives inside the worktree |
| Chrome user-data-dir | Yes | Puppeteer creates a fresh `/tmp` dir per `launch()` |
| Chrome orphan cleanup | Yes | `pkill -f "chrome.*--load-extension=$EXTENSION_PATH"` is path-scoped |
| `.test-config.json` | Yes | per worktree |
| `.e2e-state/` lockfile | Yes | per worktree |
| EmbeddedWallet PXE temp dir | Yes | random `tmpdir()/nulo-e2e-<8hex>` per call |
