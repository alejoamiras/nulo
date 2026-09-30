# Phase 7 · The arc gate

Three heads. The local gates and the Chrome smoke ran first on `ca466b59` (P6's head). The codex
loop then added `ace0ef23`, `af1c8210`, `673b3e66` and `494cb9e3`, and the whole network suite ran
on `494cb9e3`. keyboard-guards then reached `dev` (`4387b112`): the branch took it by a signed
merge (`53b34c18`) and switched OK to its `refuseRepeatEnter` (`9eac9f47`), and the final gate ran
again on `9eac9f47`: smoke and the whole network suite on both browsers and the flake bar. The
local gates ran last, on the final commit.

## The merge of `dev`

- `origin/dev` moved from `85c4d20f` to `4387b112` (keyboard-guards). The only conflict was
  `implementations-plan/index.md`, both new lines kept, dev's first. keyboard-guards changed
  neither `discover/index.vue` nor any file this branch changes: its repeat refusal sits on
  `DappApprovalFooter`'s confirm, where it now joins this branch's `isLoading` on Allow.
- `9eac9f47`: Verify's OK takes `refuseRepeatEnter` in place of its inline
  `isRepeatOrComposing` check, which resolves keyboard-guards' FU-2. Its unit test (repeat,
  composing and IME Enter cancelled, a plain one through) is unchanged and green:
  `bun --bun vitest run src/popup/windows/verify src/popup/windows/discover
  src/components/composite/DappApprovalFooter.test.ts src/composables/usePopupEntity.test.ts
  src/popup/windows/ConnectStepBar.test.ts src/composables/useDappApprovalWindow.test.ts`, exit 0,
  8 files, 98 passed.

## Local gates

On `ca466b59`:

- `bun run lint`: exit 0. 29 warnings and 3 infos, pre-existing; complexity baseline OK.
- `bun run typecheck:all`: exit 0, every workspace.
- `bun run test:ci-gating`: exit 0, 17 files, 246 tests: 244 passed, 2 skipped. The two skips are
  `decide-gate.test.ts`'s draft case for the two gate workflows that do not skip drafts (a
  structural `skipIf`, not this branch's).
- `bun run test:all`: exit 0. `@nulo/extension` 612 files (609 passed, 3 skipped), 8,107 tests
  (8,095 passed, 4 skipped, 8 todo); `@nulo/aztec-runtime` 35 files (34 passed, 1 skipped), 252
  tests (250 passed, 2 skipped); every other workspace all passed: wallet-bridge 481, design 401,
  wallet-core 248, extension-messaging 239, wallet-crypto 120, third-party-notices 66, legal 54,
  landing 40, resolve-asset 14, wallet-sdk-schema-patch 11. No test file this branch touches has a
  skip, a `skipIf` or a todo.
- `bun run build`: exit 0; no diff under `src/types/`.

On the final tree (`9eac9f47` with this plan's close-out staged; the commit that follows adds
only this section's text):

- `bun run lint`: exit 0, 1,911 files checked; 29 warnings and 3 infos, pre-existing; complexity
  baseline OK.
- `bun run typecheck:all`: exit 0, every workspace.
- `bun run test:ci-gating`: exit 0, 17 files, 246 tests: 244 passed, 2 skipped (the same
  `decide-gate` draft case). The plans gate inside it enforces nothing here; its three report-only
  `path-token` findings sit in files this branch does not touch.
- `bun run test:all`: exit 0. `@nulo/extension` 615 files (612 passed, 3 skipped), 8,130 tests
  (8,118 passed, 4 skipped, 8 todo), the growth being keyboard-guards' tests;
  `@nulo/aztec-runtime` 35 files (34 passed, 1 skipped), 252 tests (250 passed, 2 skipped);
  `@nulo/passkey-rp` 11 tests (5 passed, 6 skipped); every other workspace all passed:
  wallet-bridge 481, design 402, wallet-core 248, extension-messaging 239, wallet-crypto 120,
  third-party-notices 66, legal 54, landing 40, resolve-asset 14, wallet-sdk-schema-patch 11.
- `bun run build`: exit 0; no diff under `src/types/`.

## Smoke

Chrome on `ca466b59`, one unsharded run (before the owner asked for sharded runs): the armed build
exit 0, then `NULO_E2E_BROWSER=chrome NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e --retry=0`
exit 0, 41 files (38 passed, 3 skipped), 164 tests (157 passed, 7 skipped).

On `9eac9f47`, by the owner's sharding instruction (2026-09-29): one armed build per browser
(`VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1
VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`, exit 0), copied to
`dist/smoke2-<b>` and `dist/smoke3-<b>` so no shard's path prefixes another's, then three parallel
shards, `EXTENSION_PATH=<its copy> NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run
test:e2e --retry=0 --shard=i/3`, each exit 0:

| Browser | Shard 1/3 | Shard 2/3 | Shard 3/3 | Sum |
|---|---|---|---|---|
| Chrome, files | 14: 12 passed, 2 skipped | 14: 13 passed, 1 skipped | 14 passed | 42: 39 passed, 3 skipped |
| Chrome, tests | 52: 50 passed, 2 skipped | 38: 34 passed, 4 skipped | 76: 75 passed, 1 skipped | 166: 159 passed, 7 skipped |
| Firefox, files | 14: 13 passed, 1 skipped | 14: 13 passed, 1 skipped | 14 passed | 42: 40 passed, 2 skipped |
| Firefox, tests | 52: 51 passed, 1 skipped | 38: 34 passed, 4 skipped | 76: 70 passed, 6 skipped | 166: 155 passed, 11 skipped |

The one file more than on `ca466b59` is keyboard-guards' `keyboard-guards.test.ts`, green on both.
The skips stand on `dev` too, none in a file this branch touches:

- Both browsers: `_probe-console-capture` (3, `NULO_E2E_CONSOLE_PROBE` opt-in), `store-captures`
  (1, `STORE_CAPTURES` opt-in), and the unconditional `test.skip`s in `sw-resilience` (strict mode
  off) and `appearance` (theme across navigation).
- Chrome only: `action-popup-layout` (1, a Firefox-only case).
- Firefox only: `import-dead-rpc`'s `CHROME_ONLY.cdpFetch` block (4) and `sw-resilience`'s open
  popup across a kill (1; Firefox will not end an event page an extension page keeps busy).

## Network suite

Sharded by the owner's instruction (2026-09-29): each browser's full suite in three shards
(`--shard=i/3`), one `e2e:agent` invocation per shard, across three worktrees at the same commit:
this one and two detached worktrees, each with its own `bun install --frozen-lockfile` (exit 0 at
both commits). At most three sandboxes of this plan ran at once, and never smoke and network in
one worktree. Every run at `NULO_E2E_RETRY=0` with `NODE_OPTIONS=--dns-result-order=ipv4first`,
then `bun run e2e:reap`, which found nothing to reap every time. Chrome runs prover on over every
file but the seven `@requires-proverless` ones (96), which run again on the proverless build;
Firefox runs all 103 on the proverless build.

On `494cb9e3`:

| Run | Shard 1/3 | Shard 2/3 | Shard 3/3 | Sum |
|---|---|---|---|---|
| Chrome prover on, files | 32: 30 passed, 2 skipped | 32 passed | 32: 31 passed, 1 skipped | 96: 93 passed, 3 skipped |
| Chrome prover on, tests | 44: 42 passed, 2 skipped | 51: 50 passed, 1 skipped | 45: 43 passed, 2 skipped | 140: 135 passed, 5 skipped |
| Firefox, files | 35: 34 passed, 1 skipped | 34: 33 passed, 1 skipped | 34: 33 passed, 1 skipped | 103: 100 passed, 3 skipped |
| Firefox, tests | 47: 45 passed, 2 skipped | 62: 58 passed, 4 skipped | 49: 48 passed, 1 skipped | 158: 151 passed, 7 skipped |

Every shard exit 0 (1,306 s, 2,396 s and 1,754 s on Chrome; 1,572 s, 2,386 s and 1,981 s on
Firefox). Chrome proverless, the seven files in one invocation: exit 0, 7 files, 18 tests passed
(940 s).

On `9eac9f47`:

| Run | Shard 1/3 | Shard 2/3 | Shard 3/3 | Sum |
|---|---|---|---|---|
| Chrome prover on, files | 32: 30 passed, 2 skipped | 32 passed | 32: 30 passed, 1 failed, 1 skipped | 96: 92 passed, 1 failed, 3 skipped |
| Chrome prover on, tests | 44: 42 passed, 2 skipped | 51: 50 passed, 1 skipped | 45: 42 passed, 1 failed, 2 skipped | 140: 134 passed, 1 failed, 5 skipped |
| Firefox, files | 35: 34 passed, 1 skipped | 34: 33 passed, 1 skipped | 34: 33 passed, 1 skipped | 103: 100 passed, 3 skipped |
| Firefox, tests | 47: 45 passed, 2 skipped | 62: 58 passed, 4 skipped | 49: 48 passed, 1 skipped | 158: 151 passed, 7 skipped |

Chrome 1,338 s, 2,227 s and 1,622 s; Firefox 1,639 s, 2,573 s and 2,083 s. The one failure is
outside this plan's files, re-run once and passed (below), so Chrome prover on counts 93 files
and 135 tests passed. Chrome proverless, the seven files in one invocation: exit 0, 7 files, 18
tests passed (1,015 s).

The skips, the same set on both heads:

- The declared inventory: `firefox-background-restart` (a Firefox-only file) and
  `window-placement`'s `FIREFOX_ONLY.windowRefocus` case on Chrome; on Firefox,
  `backup-restore-sw-restart` (3, a `CHROME_ONLY` file) and `cap-window`'s reduced-motion case
  (Firefox's BiDi cannot emulate media features).
- Three opt-ins skipped the same way on `dev` and in CI, on both browsers: `_probe-warmup-effect`
  (`NULO_E2E_PROBE`, a probe, not a gate), `tx-sendTx-delegated-authwit`
  (`NULO_E2E_STANDARD_CONTRACTS`: the local network does not seed the `PublicChecks` standard
  contract it calls) and `stale-anchor-recovery`'s reorg case (`NULO_E2E_REORG`, run armed below).

The specs this branch adds or edits, and P6's other connect specs, passed on both heads and both
browsers: `connect-one-window`, `window-placement`, `cold-wake-discovery`, `connect-locked-queue`,
`session-profileSwitch`, `session-reconnect`, `session-reconnect-flood`, `session-tabClose`,
`session-tabNavigate`, `connect-dapp` and `connect-deny`.

`stale-anchor-recovery` armed, alone, on `9eac9f47` (`NULO_E2E_REORG=1 bun run e2e:agent
tests/e2e/network/stale-anchor-recovery.test.ts`; CI never arms it, and it rides
`dappConnectedExtensionWithAccountsCap`, so `connectPlayground`): Chrome, prover on, exit 0, 2
tests passed (L2 block 6 pruned, 8 of 8 views ok, one retry line seen); Firefox, proverless, exit
0, 1 passed and 1 skipped: its views all survived the prune, but no retry line landed in a view's
window, so the canary skips itself as "not reproduced", as it is written to.

### The one failure: `price-fixture`, a load timeout

On `9eac9f47`'s Chrome shard 3/3, `price-fixture.test.ts` ("gas card fiat line renders from a
seeded price cache") failed with `Test timed out in 120000ms`. Its `feeJuiceImportedExtension`
fixture bridges Fee Juice over L1 inside the test's 120 s budget, and it had taken 105.8 s on
`494cb9e3`'s Chrome run and 88.6 s on Firefox. It touches no connect path and neither this branch
nor keyboard-guards changes it. Re-run once, alone, on `9eac9f47` (`bun run e2e:agent
tests/e2e/network/price-fixture.test.ts`, prover on, retry 0): exit 0, 1 file, 1 test passed, in
107.7 s. Logged as a flake: the host was at a load of 130 to 170 on 192 cores throughout, and the
test runs within 13 s of its budget there.

## Flake bar

On `9eac9f47`, `connect-one-window`, `window-placement` and `connect-dapp` in one `e2e:agent`
invocation per run, three consecutive runs per browser at retry 0:

- Chrome, prover on: three of three exit 0, each 3 files passed, 4 tests (3 passed, 1 skipped:
  `window-placement`'s `FIREFOX_ONLY.windowRefocus` case), 140 s, 133 s and 134 s.
- Firefox, proverless: three of three exit 0, each 3 files, 4 tests passed, 193 s, 190 s and
  198 s.
