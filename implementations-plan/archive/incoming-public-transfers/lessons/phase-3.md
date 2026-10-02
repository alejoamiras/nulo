# Phase 3 — Balance wiring: persisted outbox (both arms)

Log for Phase 3 (D4/L17 — the causal task-anchored balance-refresh ack; the outbox WRITE-side
already landed in Phase 2, this adds the DRAIN + note-arm parity + deps).

## What shipped
- **`TokenBalanceService.requestBalanceRefresh(tokenId, account) → {taskId} | {busy}`**: finds the
  balance row for `(tokenId, account)` (throws if none — the caller treats that as a stale outbox
  row), then enqueues. Returns a task id ONLY when it minted a FRESH task; when the queue COALESCES
  (a task already pending/processing) it returns `{busy}` with NO id — reusing the coalesced id
  would false-ack a receipt the task may have preceded. Seam: `BalanceJobQueue.hasPendingTask` /
  `getPendingTaskId`.
- **Note-arm parity**: `scanContract` now `markBalanceDirty`s BEFORE the record upsert (public arm
  already did in Phase 2), so both arms mark the balance dirty regardless of trust/display state.
- **`drainBalanceOutbox()`** (runs on `init` + every note/public poll tick): ACTIVE-PROFILE-SCOPED
  (TokenBalance's map is active-profile-only — draining a background row would look up a missing
  balance). Per row, re-read under the lock:
  - anchored + terminal-SUCCESS → delete (causal — the fresh task was minted after `dirtyAt`);
  - anchored + terminal-FAILURE/MISSING → clear anchor + re-request next drain;
  - no anchor → `requestBalanceRefresh`: `{taskId}` → anchor; `{busy}` → keep unanchored (a later
    drain mints a fresh post-`dirtyAt` task); throw → delete the stale row.
  Task terminal state read via `TaskService.getTaskSync` (`missing` on expiry/gone).
- **Deps**: `IncomingTransferService` gains `TokenBalanceService.name` + `TaskService.name` (acyclic —
  TokenBalance doesn't depend on incoming-transfer; also starts TokenBalance first).

## The non-causal gap (pinned)
`markBalanceDirty` OVERWRITES the whole row `{dirtyAt: now}` (drops any `pendingTaskId`), so a new
receipt clears the prior anchor. Test `in-flight-coalescing interleave` pins the exact codex gap:
T1 (for A) is processing → B arrives (clears anchor) → drain sees T1 pending → `{busy}`, row stays
unanchored → T1 completes on pre-B state but B's row has NO anchor → NOT deleted → a later drain
mints a FRESH T2 (after B's dirtyAt) → T2 success → row deletes. A reused-coalesced-task anchor
would have false-acked B on T1.

## Gotchas
- The service now depends on TokenBalance + Task, so the scenarios harness `bootService` needed
  `makeTokenBalanceStub` (configurable `requestBalanceRefresh` result) + `makeTaskStub` (settable
  `getTaskSync` ledger). Added to the default fixture; the note-arm tests were failing on init until
  the stubs were wired.
- The drain runs on init (fire-and-forget-caught) so an SW-death outbox row recovers pull-based.

## Validation gate — PASS
- `bun run audit:vue` → typecheck:all exit 0 · test exit 0 (287 files, **3468 tests**) · lint exit 0
  · build exit 0.
- Named outbox tests all present + green: outbox-regardless-of-trust; coalescing (N→1); delete-only-
  on-terminal-SUCCESS-not-enqueue; the in-flight-coalescing interleave; new-receipt-clears-anchor +
  overwrites-dirtyAt; terminal-FAILURE/MISSING → re-request; active-profile-scoped (background row
  untouched); drain-on-init after SW death; stale-row tolerance (delete, never throw); private-arm
  parity; + the `BalanceJobQueue` `hasPendingTask`/`getPendingTaskId` seam unit test.

## Codex consults
None this phase.
</content>
