# Phase 6 — end to end, live

## What landed

- **Helpers** (`tests/e2e/fixtures/helpers.ts`):
  - `createAndActivateProfile(page, name, password)`, extracted from `session-profileSwitch`, which
    now calls it. It returns the new profile's id, read from the session row once the row names a
    profile other than the one before.
  - `readSessionRow` / `waitForSessionRow` read the persisted session row, projected to
    `{profile, since, lockedAt}` so the row's restore secret never reaches an assertion message.
  - `peekSession` calls `getActiveProfile` over a port of its own. `setSessionTtlMs` calls
    `refreshSession`, then `setValue("sessionTtl", ms)`, and returns the row once
    `lockedAt === since + ms`. Both go through a private `callService` that speaks the service
    wire (`MessageType` and `wrapParams` imported from `@nulo/extension-messaging`), so no
    navigation and no popup client is involved.
  - `lockWallet` now ends in `waitForLockScreen`, the storage-authoritative lock wait it used to
    inline. `lockThroughConfirmDialog` clicks `header-lock`, returns the dialog copy read through
    the `confirm-*` testids, confirms, and waits for the lock screen.
- **Journal readers** (`tests/e2e/fixtures/journal.ts`): `readSendRecords` and
  `waitForSendRecord` project every `transfer` and `dapp_execute` record to
  `{id, kind, profileId, stage, enteredProveAt}`. The existing reader covers `dapp_execute` only.
- **Three network tests**, each `@requires-proverless`, `retry: 0`, one test per file, with a header
  stating the departure from `account-switch-live-session`:
  `lock-cancels-dapp-send`, `auto-lock-defers-while-proving`, `profile-switch-sweeps-transfer`.

## Decisions and deviations

1. **The TTL is set after the send reaches `proving`, not before the Send flow.** Each route change
   refreshes the session. The Send form spends at least the helper's fixed 5 s anchor wait, plus
   fee estimation, between its entry refresh and its submit, so an 8 s TTL set before the flow
   expires the session mid-form, before any send exists. `setSessionTtlMs` refreshes the session
   first, so the new deadline is a full TTL away whenever it is called. The plan's constraint
   ("immediately after a fresh unlock or a popup action") therefore holds by construction.
2. **`tGate` is the record's `enteredProveAt`, not the moment the card shows `proving`.** The
   coordinator stamps `enteredProveAt` right before the gate starts holding, so it is the gate's own
   start. The card paints later, and a bound taken from the card could overshoot the gate's 20 s
   self-release.
3. **Per-test timeouts are 240 s and 360 s, not 90 s.** The vitest timeout covers the whole body,
   including the Send form, and `sendTransfer`'s own waits alone exceed 90 s. The bounds that matter
   are asserted explicitly: the deferral is observed before `tGate + 18 s`, and the lock follows
   within 30 s of the send reaching `succeeded`.
4. **The popup-Send tests use `tokenReadyExtension`.** It is file-scoped, but each file holds one
   test and runs at `retry: 0`, so every test gets a fresh browser, as a per-test fixture would. No
   per-test token-ready fixture exists, and adding one would duplicate its setup. The dApp test
   uses the per-test `dappConnectedExtensionWithTransactionCap`.
5. **Each lock test waits for `cancelled` before moving on.** The sweep writes it while the proof is
   still held, so the tests also prove the cancel lands before the proof returns.
6. **The dApp test also checks the error code.** Beyond `status: "error"`, the parsed
   `walletErrorCode` must be `JOB_CANCELLED` or `SESSION_ENDED`: either typed exit is correct, a
   generic failure is not.
7. **`profile-switch-sweeps-transfer` picks profile B in a freshly opened popup.** See the attempt log
   below: the popup that locked always refuses the pick. The fresh popup changes nothing the test
   proves. The lock still cancels the send while its proof is held, B is still unlocked before the
   gate is released, and the "submitted" toast is still watched on the popup that sent.
8. **`session-profileSwitch` was re-run** after its steps moved into `createAndActivateProfile`,
   because the gate does not cover it.

## Attempt log — `profile-switch-sweeps-transfer`

| Run | Result | What it showed |
|---|---|---|
| 1 | fail at the B pick, 10 s | the lock-screen picker stayed open; the record was already `cancelled` in storage |
| 2 | fail, same step | diagnostic dump: popup on `#/popup/auth`, picker open with A checked, record `cancelled`, no toast left on screen (it lasts 3 s) |
| 3 | fail, same step | probes: the popup did **not** reload during the lock wait, and the refusal toast "Finish or cancel your pending transaction first" **did** appear right after the pick |
| 4 | pass, 93 s | B picked in a freshly opened popup |

**Cause.** `OperationJournalService` forwards wire events and answers `getOperation(s)` only for the
active profile (`sendEvent` and `invoke` overrides, from the #595 hardening). The sweep runs on
`onActiveProfileChanged` after `close()`, so its `cancelled` event is dropped. The popup's in-flight
tracker keeps A's row at `proving`, and `commitScopeChange` refuses on that cached value before it
would re-read (Fact 30). Nothing refreshes the tracker on lock or on unlock: its refresh callers are
the profile-id watcher, a journal reconnect, `commitScopeChange` after its cached check, and the
lock button before it decides.

**Consequence, beyond the plan's wording.** plan.md listed this refusal as a residual that "can still
appear". In the popup that locked it is certain. Closing and reopening the popup clears it, because a
fresh popup reads the journal while locked and gets an empty list. By the same reading, unlocking
the same profile in that popup leaves the account/network Send freeze on the stale row, so an
account switch there is refused until the popup reopens. That variant is inferred from the code,
with high confidence, and was not exercised. plan.md's Known limitations now says both.

**Not fixed here.** Each fix touches either the Send freeze tracker or the lock-screen selector.
Examples: refresh the tracker when the popup enters its locked state, or have the selector re-read
the journal before its cached check. The plan's Out list and the hard limits exclude both, and the
owner assigned that surface to the parked approval-scope-follow plan, which inherits this finding as
an input.

## What the assertions rest on

Each test fails by construction when its mechanism is absent. This is read from the test code and
was not run as e2e mutations; the unit and composition layers carry the mutation checks.

- Without the sweep, `waitForSendRecord(… "cancelled")` times out while the gate still holds.
- Without the dialog, `lockThroughConfirmDialog` times out waiting for `confirm-submit`.
- Without the deferral, the expired session closes at its deadline, and `peekSession` one second
  later returns `undefined`.
- A refresh posing as a deferral moves `since`, and `row1.since === row0.since` fails.

## Validation gate

All runs solo on an idle host, `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<file>.test.ts`:

| File | Result | Test time |
|---|---|---|
| `lock-cancels-dapp-send` | exit 0, 1 passed | 22 s |
| `auto-lock-defers-while-proving` | exit 0, 1 passed | 48 s |
| `profile-switch-sweeps-transfer` (run 4, final code) | exit 0, 1 passed | 93 s |
| `session-profileSwitch` (regression, helper extraction) | exit 0, 1 passed | 11 s |

Runs 1 and 2 came before the only later edits, which touched `profile-switch-sweeps-transfer.test.ts`,
plan.md and this file, so the helpers they exercised are the committed ones.
