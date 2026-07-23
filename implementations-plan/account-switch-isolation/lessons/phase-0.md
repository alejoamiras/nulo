# Phase 0 — deterministic race-test infrastructure

## 0.1 Bidirectional incoming-poll gate ✓
- `src/e2e/incoming-poll-gate.ts` (interface `IncomingPollGate` + `IncomingPollMatch`) +
  `src/e2e/chrome-storage-incoming-poll-gate.ts` (impl + `INCOMING_POLL_HOLD_KEY`/`INCOMING_POLL_STATUS_KEY`).
  Two-key protocol (test→SW hold, SW→test status: `discovery-held → released → committed`) — the one-way
  proof-gate can't tell the test the scan is parked, which the switch-mid-poll race needs.
- Injected into `IncomingTransferService` as an optional 4th ctor arg; wired in `runtime.ts` only inside
  `E2E_PROVERLESS ? new ChromeStorageIncomingPollGate() : undefined` (mirrors ProofGate → ExecutionService).
- Hold point in `scanContract`: AFTER `getNotesRaw` returns, BEFORE the locked commit loop
  (`service.ts` ~line 592), matched by profile+network+account+contract + an armed txHash ∈ discovered notes;
  NEVER under `serviceLock`. `markCommitted` fires after the loop so the test knows the late emission occurred.
  Safety timeout 15s (< 30s network `testTimeout`) releases loudly.
- Test fixture `tests/e2e/fixtures/incoming-poll-gate.ts`: `holdIncomingPoll`/`releaseIncomingPoll`/
  `waitForIncomingPollPhase`.
- Negative-grep: both keys added to `_build-extension.yml`'s marker loop.

**DCE verified:** `build:chrome` → both keys + `ChromeStorageIncomingPollGate` class ABSENT from
`apps/extension/dist/chrome`. The only bundle occurrence is the no-op `s.incomingPollGate?.waitIfArmed(...)`
call site — the same legitimate pattern as the proof gate's `?.wait()`; the CI negative-grep checks the KEY
strings (clean), not method names. typecheck clean; lint clean on the 5 touched files (pre-existing
`noImplicitAnyLet` warning at service.ts:749 is untouched).

## 0.2 e2e helpers ✓ (subagent, reviewed)
- `helpers.ts`: `waitForActiveAccount(page, address)` (polls `nulo:ui:activeAccount`, expected-vs-observed);
  `switchAccountByAddress` + `switchAccount` now wait for the switch to LAND in storage (not just the click);
  `createSecondAccount(page, name?)` → returns the new address.
- `aztec.ts`: `mintPrivateTokens`/`transferPrivateTokens` now return the L2 tx hash. **SDK note:** no
  `SentTx`/`getTxHash` in this version — `.send({wait})` returns `TxSendResultMined = {receipt} & OffchainOutput`;
  return `sent.receipt.txHash.toString()`, which byte-matches the scanner's `note.txHash.toString()` (the value
  the gate matches on + `IncomingTransferRecord.txHash` persists) → exact correlation.

## 0.3 observability ✓
- `RecentActivityView.vue` (3 root branches) + `activity.vue`: additive `data-testid="activity-feed-root"` +
  `:data-active-account="appStore.account?.address"`. **Gotcha:** RecentActivityView's root renders only with
  content (empty home state = no root); `activity.vue`'s is always present when logged in → Phase-1 isolation
  assertions should lean on `activity.vue`'s root (matches plan §7's History-as-separate-surface).
- `tests/helpers/app-store-harness.ts` (new) — `reactive()` appStore factory for switch-reset component tests.

## 0.4 harness test ✓ (code) — running Gate 0
- `tests/e2e/network/account-switch-isolation.test.ts` (Phase-0 portion): deliver private note to A (capture
  hash) → arm gate → drive `refreshBalances` until `discovery-held` → assert nothing committed while held →
  release → `committed` → assert A's record appears (correlate on `txHash`, `accountAddress===A`, `hidden===false`).
- **Verified pre-run:** `EntityStorage` persists JSON strings (`entity_storage.ts:99` `JSON.stringify`), so the
  test's `findIncomingRecordByHash` (string + `JSON.parse` on `nulo:core:incoming-transfers@*`) is correct.
- Uncertainties the real run proves (subagent-flagged): 30s scan cadence vs the 300s budget; hash-equality being
  byte-identical; the 15s gate safety-timeout margin.

## Gate 0 — running
`NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts`
(TMPDIR on disk). A6 baseline: confirm the current expected-green network baseline before marking any later gate ✓.
Phase 0 is marked ✓ only once this run is GREEN.
