# Phase 7 — close out

## What landed

- **`apps/extension/src/wallet/services/execution/README.md`, "Authorization fence".** What the
  fence binds and why the serial makes A → B → A and a same-profile re-unlock fail; the capture
  points; the two entry contracts (`executeOperations` refuses a DAPP origin without
  `authorizedFence`; `executeSendTransaction` captures when no fence arrives, correct only for a
  caller that awaited nothing); `assertFence` and its sites; `isFenceLive` after the account
  lookups and as the statement before `node.sendTx`, behind the unchanged post-`submitting`
  cancellation check; the registry; the sweep and its two terminal shapes; the limits
  (unregistered work, PXE calls already issued including store-key recovery); the auto-lock
  predicate. The file map's lane row names `registerInFlight` and `abandonDeadSessions`; the
  Testing section names the composition describes and the three network tests.
- **`ARCHITECTURE.md` §7**, one paragraph: a session end cancels the sends it authorized that have
  not been broadcast, the lock button asks first, the auto-lock defers in `min(60 s, TTL)` steps
  within a per-session budget of `min(TTL, 10 min)` that nothing refills, and dApp activity
  refreshes the TTL as before.
- **Sweeps.**
  - `apps/extension/tests/e2e/README.md`: the three new tests join the proof-gate (STUB) list; the
    feature-helper table gains the lock, profile, session-row and send-record helpers.
  - `ProfileService.captureExecutionFence`'s docblock named the fence `{profileId, epoch}`; it now
    names `session` too, and its `(D13)` and `(codex TOCTOU)` tags are gone.
  - `lockWallet`'s docblock said the handler flips `isLogined` at once and quoted a 20 s timeout;
    the handler awaits one journal read first, and the waits live in `waitForLockScreen`.
  - `apps/extension/src/types/.eslintrc-auto-import.json`: the build adds
    `"approvedSendsInFlight": true`; committed here so CI's build job finds no drift.
    `auto-imports.d.ts` regenerated identical to the hand edit in phase 5.

## Decisions

1. **The README states limits, not only guarantees.** Phase 4's round-2 rejection (store-key
   recovery reads whichever session of that profile is open) and the unregistered-work limitation
   were promised a home in this section; both are there, one sentence each.
2. **`transaction/service.ts:175` still reads "captured {profileId, epoch}".** Not edited: this plan
   did not touch that file, and the comment describes the two fields `addTransaction` asserts,
   which is still accurate.
3. **No skill update.** The durable e2e techniques from phase 6 (set the TTL after the last
   navigation; read session state without navigating) are now in the helper table and the helpers'
   own docs. The stale-tracker finding is a product limitation recorded in plan.md, not a testing
   technique.

## Validation gate

Run alone, nothing else on the host (codex not running):

| Command | Result |
|---|---|
| `bun run audit:vue` | exit 0. typecheck:all: every workspace exit 0. test: 503 files passed, 3 skipped; 6245 tests passed, 4 skipped, 7 todo. lint: 30 warnings, 5 infos, all pre-existing; complexity-baseline check OK. build: OK. |
| `bun run test:e2e`, run 1 (the dist `audit:vue` built) | exit 1: 30 files passed, 1 failed, 2 skipped. The one failure is `backup-migration.test.ts`'s fixture-arming contract: "NULO_E2E_MIGRATION_FIXTURE is unset on a repo-build run". |
| `bun run test:e2e`, run 2 (armed build, as `_extension-smoke-e2e.yml` runs it) | exit 0: 32 files passed, 1 skipped; 123 tests passed, 6 skipped; 555 s. |

After the build, `git diff -- apps/extension/src/types/` showed only the `approvedSendsInFlight`
line, committed with this phase.

## Attempt log — the smoke gate

1. **Run 1 failed on the environment, not the code.** `audit:vue` ends in a plain `bun run build`,
   which leaves an unarmed `dist/chrome`; the smoke suite then ran without the migration fixture
   and without `NULO_E2E_MIGRATION_FIXTURE`, and `backup-migration.test.ts` throws by design in that
   case. The `e2e-testing` skill already names this trap ("a later plain `bun run build` —
   including the one at the end of `bun run audit:vue` — silently disarms the dist").
2. **Run 2 reproduced CI's source-build path**: `VITE_NULO_E2E_MIGRATION_FIXTURE=1
   VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1
   VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run build:chrome`, a grep for the token-seed stamp and
   key and the `nulo:e2e:backup-mig-fixture` marker in `dist/chrome`, then
   `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` from the repository root. Exit 0.

Run order for this gate: `audit:vue`, then the armed build, then smoke.
