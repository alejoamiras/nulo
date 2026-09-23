# Recon — e2e-skill-refresh (2026-09-06)

Three read-only sweeps against `dev` at `122149ad` (the #548 merge): a claim-by-claim staleness audit
of `.claude/skills/e2e-testing/SKILL.md`, a map of the current e2e layer, and a harvest of the durable
lessons across the deflake plans. Conclusions only; the code is the evidence.

## Reuse map

| Capability | Existing code | Verdict |
|---|---|---|
| Real MV3 worker kill + proof of a new instance | `tests/e2e/fixtures/helpers.ts` `stopServiceWorker` (unattached `Target.closeTarget` + `performance.timeOrigin` witness, #548) | reuse-as-is — delete the six local variants |
| Strictly-newer liveness gate after a restart | `network/connect-locked-queue-sw-restart.test.ts` `waitForLiveness(afterTs)`; `sw-resilience.test.ts` | reuse-as-is (already per-file; no shared export needed for this arc) |
| Flake ledger content | `implementations-plan/{e2e-deflake/flake-ledger.md, deflake-round-2..4, e2e-flake-fixes, import-stage-deadlines, mac-identity-binding}` | adapt — condense into the skill's ledger table, link the plans |
| Suite/CI facts | `apps/extension/tests/e2e/README.md`, `.github/workflows/{pr-smoke-e2e,_smoke-e2e,pr-network-e2e,_network-e2e,nightly,network-e2e-soak}.yml`, `scripts/e2e/agent.sh`, `resolve-ports.ts`, `sentinel.ts`, `lockfile.ts` | reuse (source of truth); the README carries two stale snapshots (below) |

## The six SW-kill variants (the code arc)

| File | Primitive | Wait | Verdict |
|---|---|---|---|
| `imported-account-lifecycle.test.ts` (smoke, retry 0) | `worker.close()` | `targetdestroyed` identity + 15s | pre-#548 copy — the parked-host race |
| `network/connect-locked-queue-sw-restart.test.ts` | same | same | same |
| `network/backup-restore-sw-restart.test.ts` | same | same | same |
| `network/cold-wake-discovery.test.ts` | same | same | same (header even says "kept local") |
| `network/frozen-account-canary.test.ts` (prover-ON canary lane, retry 0) | `Runtime.terminateExecution` over an attached, never-detached session | none | not a kill (deflake-round-3 measured it); the 2026-09-02 "lock state never settled" flake sits on top of it |
| `network/passkey-execution-canary.test.ts` (retry 0) | same | none | same |

`onInstalled` gating is `reason === "install"` (`src/wallet/index.ts:29`), so a reused `userDataDir`
opens no first-run tab — relevant to the freshness rule `launchExtension` now enforces.

## Staleness verdicts on the current skill (674 lines)

Wrong or gone (delete, or replace with the current mechanism):

- "Extensions require `headless: false`" — `launchExtension` is headless unless `HEADLESS=0`.
- "Write a standalone debug script (`npx tsx tests/e2e/debug.ts`)" — never existed.
- "Use `text/` selectors" — contradicts the repo-wide testid-only rule.
- "`Button.vue` doesn't set HTML `disabled`; `btn.disabled` is always false; `handleMint`" —
  `packages/design/src/ui/Button.vue:103` binds `disabled` when `tag === 'button'`; `pointer-events`
  is the universal signal; `handleMint` does not exist. The right rule is the helper's: check both.
- `window.__nuloRouteTrace` — gone; only `__nuloResetNavTrace` inside `resetProfile` survives.
- "Local resource leaks: the sandbox datadir is on tmpfs" + the tmpfs bullet — fixed by #310
  (2026-07-22): `lockfile.ts` puts the datadir under `~/.cache/nulo-e2e`, `bun run e2e:reap` exists.
- "backup-restore-sw-restart: two DESIGNED outcomes" — the test was rewritten (#400) around the
  `restore-gate` rendezvous; the later deflake-round-4 section already describes the live design.
- "The SW-kill load flake (2026-08-28)" — every mechanism sentence is pre-#548: the helper is no
  longer inline, the stop is no longer an attached `worker.close()`, and the section's proposed
  "positive signal" fix is exactly what shipped.
- `~/.agents/ports.md` — this suite claims ports via `scripts/e2e/resolve-ports.ts` into the
  worktree-local `.e2e-state/ports.json`; no registry file is read or written.
- "Runtime.terminateExecution … correct method is `worker().close()`" — one generation behind (the
  contrast with terminateExecution still holds).

Current and verified (keep, condense): global-setup stage rules; the SW-restart auth-popup flake
(2026-09-02, every symbol matches); the cold-shard approvable flake; build-time-armed tests; the
console-sniffer blindness + `readSwLogTrail`; the `RetryErrorReporter` single owner; the
CI-log source-echo trap; `NULO_E2E_ARTIFACT_RUN` semantics; imported-account arc rules; post-unlock
navigation races; `chrome.runtime.reload()` relaunch pattern.

Unverifiable (general Vitest/Puppeteer/Chrome behaviour, kept only where the repo carries the
matching workaround): mtime ordering, `networkidle0`, `waitForFunction` first-truthy semantics,
Vitest swallowing passing-test stdout, CDP element-handle clicks hanging.

## Suite facts that shape the rewrite

- Three configs: smoke (`tests/e2e/*.test.ts`, `global-setup-smoke.ts`, retry 2 fixed, 60s/90s),
  network (`tests/e2e/network/**`, `global-setup.ts`, `retry: NULO_E2E_RETRY ?? 2`, 30s/300s),
  all (both, network setup). `vitest.e2e.network.config.ts:42` comment says "3 attempts"; code is 2.
- Root scripts: `test:e2e`, `test:e2e:network` (bare config, no port wiring), `test:e2e:all`,
  `e2e:agent` (`scripts/e2e/agent.sh`), `e2e:reap`.
- `agent.sh`: `@requires-proverless` scan → exit 2; fresh port pack per run (bind-and-release in a
  static window below the ephemeral floor); armed build (`VITE_NULO_E2E_DEFAULT_NET=testnet`,
  `PRICE_MAP`, `MIGRATION_FIXTURE`, `TOKEN_SEEDS(+CONFIRM)`, optional `PROVERLESS(+CONFIRM)`,
  mutually exclusive with `ACCELERATOR_REQUIRED`); bundle stamp assertions; `E2E_REQUIRE_SETUP=1`;
  `classify-exit.ts` → 86 on boot-started ∧ ¬boot-ready ∧ ¬tests-started.
- Both global setups `pkill -f "chrome.*--load-extension=<this dist>"` at setup (smoke also at
  teardown) — path-scoped, so parallel worktrees are safe but smoke + network on ONE worktree are not.
- CI: smoke = `pr-smoke-e2e.yml` → `_smoke-e2e.yml` (paths filter `smoke-surface`, label
  `e2e:smoke`, `NULO_E2E_ARTIFACT_RUN` on either artifact path, 20 min); network =
  `pr-network-e2e.yml` → `_network-e2e.yml` (filter `extension-network`, label `e2e:network`,
  5 vitest shards proverless retry 0 excluding 5 files, heavy `fee-methods` +
  `concurrent-sendtx-confirm`, canary `transfers` + `tx-sendTx-default` + `frozen-account-canary`
  prover-ON with the SHA-pinned `accelerator-server` and a "Proving succeeded" log assertion, exit-86
  one retry, `PROBE` bundle grep); `nightly.yml` (only schedule, config-default retries, prerelease);
  `network-e2e-soak.yml` (manual, retry 0). `scripts/ci-cd/behavior-gating.test.ts` pins the
  filters and the exclude list.
- Selector discipline is convention + review: no lint rule or scanner enforces testid-only.
- Test inventory: 32 smoke files (+ 2 env-gated probes), 78 network files.
- README drift: "Known failures + triage" (46/66, 18 failing) and "45 network test files" are
  snapshots from an earlier phase.

## Lessons harvest — what the skill must carry

Four themes organise every durable lesson: (1) the signal you wait for can lie (one-shot samples,
visibility vs state, freshness-blind polls, rendered vs approvable, truthy liveness); (2) verify the
primitive before hardening a wait on it (terminateExecution, the parked DevTools host, URL-keyed
diffs, the first-run tab, dual-bundle resolution, teardown export, console sniffer, runtime.reload,
passkey FTN scope); (3) diagnose, don't guess (probe-first, storage probes to a file, stack-capture
attribution, `gh api` logs, `taskset -c 0,1`, retry 0, certification rules); (4) the boundaries the
harness respects (port/lock/identity isolation, three-tier smoke/network/composition, build-armed
discipline, proverless layering, canary philosophy, boot sentinel, retry as a per-class decision).

Named fingerprints with a mechanism and a status: 28 (see the ledger in the skill). Open today:
the cold-shard `multicall-chunked` approvable timeout; the prover-ON canary duration variance; the
duplicate-aggregator CI residue (`import-stage-deadlines/lessons/post-impl.md`).
