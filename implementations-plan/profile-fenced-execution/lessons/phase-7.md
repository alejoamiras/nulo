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

## Arc 2 codex loop

Codex (GPT-6 Astra, effort `high`, static review of `worktree-profile-fenced-execution..64897bd7`)
was told not to run tests. Session `01a0acf5-f6bb-7c60-8c9e-ac9646cc5a17`.

### Round 1 — reject, seven findings: five accepted, two accepted in part

| # | Codex finding | Verified | Disposition |
|---|---|---|---|
| 1 | High: `Header.vue` awaits the journal read before any lock; a stalled read holds the lock for the client's 60 s RPC timeout (longer while connecting). | Yes: `DEFAULT_RPC_TIMEOUT_MS = 60_000` (`packages/extension-messaging/src/background/client.ts`); `refreshInFlightOps` awaits `connect()` then `getOperations`. Before arc 2 the button locked synchronously. | **Fixed.** The read races a 3 s budget; a read that has not answered locks without asking, whatever count earlier events cached. A late answer only updates the store. Same rule as the failed-read case (phase 5, decision 2). |
| 2 | High: a stale confirmation can lock a replacement session. Window A shows the dialog; window B locks and unlocks; A's `app.vue` lock cleanup awaits `getProfiles()` and is abandoned when the unlock event supersedes it, so A's dialog stays open and its callback locks B's session and cancels B's work. A pending read can resume after a replacement unlock the same way. | Yes: `app.vue` `onActiveProfileChanged` returns on `seq !== profileEventSeq` before `enterLockedState` (which is what calls `popupStore.closeAll()`). | **Fixed in the popup.** `Header` counts `onActiveProfileChanged` events: each one closes a lock dialog `Header` raised, and a decision whose read spanned one starts over on a fresh read. **Rejected in part:** comparing the session identity where the worker closes the session needs a serial on the wire and a new `lockActiveProfile` parameter; an event not yet delivered when the user confirms stays under "Consent is best-effort" (plan, Known limitations). |
| 3 | Medium: the auto-lock e2e cannot tell a lock after the send finished from a lock after the budget ran out; an always-true deferral check would pass. | Yes: with an 8 s TTL, step = `min(60 s, TTL)` = budget = `min(TTL, 10 min)`, so the first deferral moves the deadline to the budget's end, and both causes lock at that same deadline. | **Accepted as a claim fix.** No TTL of 60 s or less separates them, and a longer TTL needs the proof gate held past its 20 s self-release. The test's header now claims deferral while proving and a lock afterwards, and names what pins the rest: the composition test "init registers it over the real journal: an approved send defers its own profile's lock until it settles" (the check turns false once the send settles) and the session-manager test "repeated deferrals stop at the budget…". |
| 4 | Medium: `lock-cancels-dapp-send` and `profile-switch-sweeps-transfer` wait up to 30 s for `cancelled` although the gate releases itself after 20 s, so a slow sweep, or B unlocking after A's execution unwound, could still pass. | Yes: neither test compared the clock with `enteredProveAt`. | **Fixed.** `PROOF_GATE_HOLD_MS` (`fixtures/proof-gate.ts`, the gate's exported `SAFETY_TIMEOUT_MS` minus 2 s) replaces the auto-lock test's local constant. `lock-cancels-dapp-send` asserts the cancel lands before it; `profile-switch-sweeps-transfer` asserts B is unlocked before it. |
| 5 | Medium: `callService` settles only on a response or a disconnect. | Yes. | **Fixed.** A 15 s timer disconnects and rejects with the service and method only; every settlement clears it. |
| 6 | Low: `readSessionRow` ships the whole row, restore secret included, out of the page and parses it in the runner, where a parse error can quote the input. | Yes. | **Fixed.** Parsed and projected in the page; an unreadable row throws a constant message. |
| 7 | Comment: the Header comment narrated the handler; `SendRecordView`'s doc said `enteredProveAt` is when the gate starts its timer. | Yes: `proveAndSend` stamps `enteredProveAt` in the `proving` write, and `ChromeStorageProofGate.wait()` starts its timer later, inside `proveTxTask`. | **Fixed.** The Header comments state the two rules; the journal doc calls the stamp a lower bound. |

Tests: three `Header.test.ts` cases (a read that never answers locks at 3 s without asking, with a
count cached from events, and its late answer opens nothing; a session change closes the dialog
`Header` raised; a session change during the read discards the count and decides again).

Mutation checks (scratch script, file restored after each):

| Mutation | Tests that failed |
|---|---|
| The lock awaits the read with no budget | the budget case |
| A timed-out read still uses the cached count | the budget case (after it was given a cached count of 1; it survived before) |
| A session change leaves the dialog open | the dialog-close case |
| A read that spanned a session change is trusted | the decide-again case |

Gate: `bun --bun vitest run src/components` exit 0 (49 files, 540 tests); `bun run typecheck`
(extension) exit 0; `biome check` on the touched files clean. Network e2e, solo, `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent`: `lock-cancels-dapp-send`
exit 0 (23 s), `auto-lock-defers-while-proving` exit 0 (48 s), `profile-switch-sweeps-transfer` exit 0
(93 s), so B's unlock does land inside the gate's hold.
