# Phase 7 — Q23: execution-lane seam

## The move (commit on this checkpoint)

`execution-lane.ts` (NEW) now owns, moved verbatim off the facade:
`activeControllers`, `executionMutex`, `executionWaiters` + heartbeat
timer + begin/end/heartbeat methods, `resolveExecutionMutexKey`,
`acquireExecutionSlot` (→ `acquireSlot`), the
`claimOrCreateDappExecuteJournal` wrapper (→ `claimOrCreateJournal`),
`markJournal`, and `cancelJob`. The caps statics
(`EXECUTION_ORIGIN_CAP`=8, `EXECUTION_LANE_CAP`=32,
`EXECUTION_WAIT_HEARTBEAT_MS`=30s) moved with it.

Stays facade-side: `beginDappExecuteJournal` (journal-record SHAPING —
injected into the lane as `createFreshRecord` for the claim path),
`ensureInitialized` on the public `cancelJob` delegate, and the
`executeOperations` dispatcher.

Executors were already lane-shaped (CC6 paid off exactly as designed):
the facade wiring flipped from facade-private closures to
`this.lane.*` calls — zero executor-file changes in this phase.

Constraint registry — all preserved verbatim and documented in the
module docblock: mutex no-timeout/no-force-release; FIFO baton release
point (`onEnqueued` after synchronous enqueue, before grant);
transition-journal-first-abort-second; `JobCancelledSentinel` never
crosses RPC (`rpc-cancel.ts` unchanged); journal FSM untouched;
sync-register (controller registered before the acquire's first await).

## Tests

`execution-lane.test.ts` (5, real `ExecutionMutex`, mocked journal):
1. sync-register + cancel-during-wait → `JobCancelledSentinel` carrying
   the queued id, controller cleaned, lane still grants afterward.
2. FIFO baton point: `onEnqueued` fires while still waiting; grant
   order preserved across two queued followers.
3. **capacity-reject mapping** (plan-mandated): origin depth 8 filled →
   9th rejects `TooManyPendingError`, journal got
   `("q9", {stage:"failed"}, {kind:"dapp_execute"})`, controller cleaned.
4. **queued-wait heartbeat + reaper-window** (plan-mandated): fake
   timers; `touchOperation` fires each 30s while queued; after the
   grant the timer stops cold (0 touches over a further 120s) — the
   holder's stage transitions take over.
5. Mutex keying: different chainIds never contend.

cancelJob's two ordering pins (FSM-accept → abort+remove; FSM-reject →
drop, no abort) retargeted from facade-private injection to the lane in
`service.characterization.test.ts`.

Existing race suites (`claim-helper.test.ts`, `execution-mutex.test.ts`,
journal `_transitionLocked`) untouched and green.

## Gates (slice)

typecheck exit 0 · `bun run lint` exit 0 · full unit suite **2,336
passed** (+5) · facade now **746 lines**.

## Phase gate (pending)

Full e2e:agent + heavy shards (cancel-mid-prove, concurrent-sendtx,
concurrent-sendtx-confirm) — purged, idle. Bail-out per A2 if it fails
twice.
