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

## Remaining Phase 0 (in progress)
- 0.2 e2e helpers: `switchToAccount` wait-for-target (storage key now; DOM scope marker upgrade lands with
  Phase 1's composite scope) + `createSecondAccount`; mint helper returns tx hash.
- 0.3 observability: `activity-feed-root` marker with active-account attr; reactive appStore test harness.
- 0.4 harness test: real note → PXE → gate `discovery-held` → nothing commits held → release → A's row.
- A6: verify current network-suite baseline before any gate is declared green.
