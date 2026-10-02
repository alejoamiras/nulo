# P8 · The panel's delegated decisions, built

The owner, away, on 2026-09-29: "any chance your resolve auditing with Codex and Opus5.5 subagents
the open artifacts? Ask those subagents to be evaluators on the ux/ui/copies. Use your knowledge
about my previous decisions too." The driver's panel decided O1 (a), O2 (b) worded "No account
shared", the blanket rows, and one copy fix (`plan.md` § P8, where each vote, dissent and declined
edit is recorded). They are delegated decisions the owner can overturn, not the owner's sign-off,
and the branch does not merge on them. P8 step 2 applies: build the option that was not built,
then rerun P5's gate and P6's specs on both browsers.

## The build

- `verify/header-labels.ts`: while nothing is shared it returns "No account shared" beside the
  session's network, with `warn` false. The labels no longer read the active account or the active
  network, so `verify/index.vue` stops passing them; `warn` now means only a shared account on
  another chain than the session's.
- `discover/index.vue:156`, the revoke line: "… any time from Settings → Connected Apps.", the
  entry `settings/index.vue:142` renders. It was the only "General → Sessions" in `src`.
- `IdentityStrip`'s account label gets `data-testid="identity-account"`, and
  `connect-one-window.test.ts` asserts the check's header on both browsers. No e2e read the check's
  header before: the one strip read, `cap-chain-mismatch.test.ts`, reads the permission window's
  network, which does not change.
- The label fits: "NO ACCOUNT SHARED" measures 120.3 px in Space Grotesk 700 at 11 px with 0.05em
  tracking (headless Chrome, the package's own font file), inside the strip's 140 px cap.

## Red first (the new tests against the production files as on `92eb2efd`)

`bun --bun vitest run src/popup/windows/verify src/popup/windows/discover/index.test.ts`: exit 1,
3 files failed, 4 of 34 tests failed:

- `header-labels.test.ts`, nothing shared: received `{ account: "No account", network: "Local
  Network", warn: false }`, what the old labels return once no active account is passed.
- `verify/index.test.ts`, a new connection: the header read "Account 1·Local NetworkNULO".
- `verify/index.test.ts`, a Testnet session while Local Network is active: `accountLabel` "Account
  1" and `warn` true, the orange mark that (b) drops.
- `discover/index.test.ts`, the revoke line: "… any time from Settings → General → Sessions."

## Green

- P5's gate command, `bun --bun vitest run src/popup/windows/discover src/popup/windows/verify
  src/popup/windows/ConnectStepBar.test.ts src/composables/useDappApprovalWindow.test.ts`: exit 0,
  6 files, 64 tests passed.
- `bun run lint`: exit 0 after one formatter fix in `verify/index.test.ts`. `bun run
  typecheck:all`: exit 0.
- Commits: `808766ea` (the header), `392645b0` (the revoke line), `6f127072` (the e2e read).

## Gates on the final tree

Local, on `2c0a2c19` (the commits after it change only `implementations-plan/`):

- `bun run lint`: exit 0, 1,911 files checked; 29 warnings and 3 infos, pre-existing.
- `bun run typecheck:all`: exit 0.
- `bun run test:ci-gating`: exit 0, 17 files, 246 tests: 244 passed, 2 skipped (the same
  `decide-gate` draft case). The plans gate reports its three pre-existing `path-token` findings,
  none enforced.
- `bun run test:all`: exit 0. `@nulo/extension` 615 files (612 passed, 3 skipped), 8,131 tests
  (8,119 passed, 4 skipped, 8 todo), one more than at P7: one header-labels case went, a verify
  case and the revoke-line case came. `@nulo/aztec-runtime` 35 files (34 passed, 1 skipped), 252
  tests (250 passed, 2 skipped); `@nulo/passkey-rp` 11 tests (5 passed, 6 skipped); every other
  workspace all passed.
- `bun run build`: exit 0; no diff under `src/types/`.

Network: P6's six specs, the other connect and verify specs P7 names, and `cap-chain-mismatch`
(the one spec that reads the identity strip), in one `e2e:agent` invocation per browser at retry
0, on `6f127072` in a detached worktree with its own `bun install --frozen-lockfile`:
`NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run
e2e:agent` over `connect-one-window`, `connect-dapp`, `connect-deny`, `window-placement`,
`session-reconnect`, `session-reconnect-flood`, `cold-wake-discovery`, `connect-locked-queue`,
`session-profileSwitch`, `session-tabClose`, `session-tabNavigate` and `cap-chain-mismatch`, then
the same with `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1`; `bun run e2e:reap` after each.

| Browser | Files | Tests | Time |
|---|---|---|---|
| Chrome, prover on | 12 passed | 16: 15 passed, 1 skipped (`window-placement`'s `FIREFOX_ONLY.windowRefocus`) | 345 s |
| Firefox, proverless | 12 passed | 16 passed | 508 s |

Both exit 0. On both browsers `connect-one-window` read the check's header as "No account shared"
beside "Local Network" and logged that the check loaded in the same document.

## Captures

The surfaces the panel changed, taken again on 2026-09-30 as a set beside the first, which stays
as it was: the check's header for a new connection (Chrome light and dark, Firefox light), a
Testnet session (Chrome, from the local capture-only branch
`capture/connect-window-after-panel-testnet` at `5e04722f`, never pushed), a reconnect with one
and with two shared accounts (Chrome, Firefox), and the connect screen with the revoke line
(Chrome light and dark, Firefox light). Three runs from `6f127072`, each exit 0 at retry 0.

## Smoke

On `2c0a2c19`: one armed build per browser (`VITE_NULO_E2E_MIGRATION_FIXTURE=1
VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1
bun run --cwd apps/extension build:<b>`, exit 0), copied to `dist/smoke2-<b>` and
`dist/smoke3-<b>`, then three parallel shards, `EXTENSION_PATH=<its copy> NULO_E2E_BROWSER=<b>
NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e --retry=0 --shard=i/3`, each exit 0:

| Browser | Shard 1/3 | Shard 2/3 | Shard 3/3 | Sum |
|---|---|---|---|---|
| Chrome, files | 14: 12 passed, 2 skipped | 14: 13 passed, 1 skipped | 14 passed | 42: 39 passed, 3 skipped |
| Chrome, tests | 52: 50 passed, 2 skipped | 38: 34 passed, 4 skipped | 76: 75 passed, 1 skipped | 166: 159 passed, 7 skipped |
| Firefox, files | 14: 13 passed, 1 skipped | 14: 13 passed, 1 skipped | 14 passed | 42: 40 passed, 2 skipped |
| Firefox, tests | 52: 51 passed, 1 skipped | 38: 34 passed, 4 skipped | 76: 70 passed, 6 skipped | 166: 155 passed, 11 skipped |

The same counts and the same skips as P7's run on `9eac9f47` (`lessons/phase-7.md`). `bun run
e2e:reap` found nothing to reap.
