# Phase 0 — planning (mid tier: dual audit codex + fable-role)

## Round 1 — a genuine cross-auditor fork on N-07

- **Codex** (session in scratchpad b8-codex-out.log): "amendment to (b)" — keep my registry-spare primary, but release membership only at `handlerChain.finally` (the early `onExecutionEnqueued → releaseFifo` fires pre-grant and the heartbeat's first touch is 30 s away — a real exposure gap I'd missed) and snapshot liveness sweep-locally (stale-positive costs one tick; stale-negative falsely fails work).
- **Fable-role** (Opus): REJECT — case for minimal (a′) built on verified facts: (1) my proof-adoption tiebreaker for (b) was FALSE (the c2-1 proof constructs the reaper hookless — red under (b) as written too; the proof header blesses both fixes); (2) `updatedAt` has exactly one consumer and its doc names it the liveness channel — (b) = a second competing channel + inverted layering; (3) my (a) was a strawman — real (a′) is two delegators + two call sites over the EXISTING set/timer; (4) a Set-based liveness spare shields a hung handler FOREVER (never-settling promise ≡ hang), regressing the grace's raison d'être; (5) under (a′) a live waiter's persisted updatedAt never goes stale, removing the FIFO leg of the mid-sweep race structurally.
- **Adjudication: (a′)** — fable's facts checked out one by one (I re-verified the proof's hookless construction, the single updatedAt consumer, the delegator precedent at execution/service.ts:466-470, background.ts:91 holding executionService). **Lesson: when writing a competing outline, steel-man it — I compared my primary against a maximal version of the alternative and nearly shipped the worse design on a false tiebreaker.**

## Shared ground both auditors found independently

- **F-1 / codex amendment 2 — the mid-sweep claim race is a LIVE bug**: `reap()` snapshots once, awaits per record, and `transitionOperation` has no stage precondition — a record claimed `queued→pending` during an earlier candidate's await is failed on stale data. Adopted the STRONGER form: `transitionIfStage` (allowedStages re-checked under the transition lock, the `refileOperationScope` idiom). **Lesson: a reaper that snapshots then awaits per item needs per-item recheck-at-commit, same capture-then-assert family as batches 4-7 — this pipeline keeps finding the one loop that skipped it.**
- **N-16 branch (3) dead** (codex finding 1 + fable F-5, which proved it three ways: `validateTaskBeforeFinish` forbids finishing a parent with an open child so `isFinished` can't fire; taking the branch double-throws in the callers; polling `isFinished` throws after `tasks.clear()`). Cut; bound-only + settle-exactly-once + `WrappedTask.exists`. Codex's AbortSignal alternative parked as out-of-scope (fable: adjudicated harm closes with the bound; no caller can deliver a cancel today) — put to codex for round-2 concurrence.
- **N-25 test placement**: both auditors killed my claim-helper-level real-Map test (no finally there — it cannot observe the fix); the pin moves to a real-Map-backed lane mock in the executor harness. Plus fable F-9: `journalId !== queuedJournalId` IS reachable (fresh-id fallbacks), so unconditional both-key delete.

## Traps recorded for implementation

- F-10: an executor test passing `hooks.queuedJournalId` with `preController: undefined` constructs an unreachable production state — mock consistently.
- F-13: inject a short `timeoutMs` in tests (advancing 120 s under fake timers fires ~1200 sleep timers + ~120 worker ticks).
- F-11: the network e2e gate is regression safety, NOT N-07 evidence (10-min wall clock un-exercisable) — mechanism pins carry the proof.
- F-7 naming: the uncovered window is arrival→slot-grant including the op's OWN popup (INTERACTION_TIMEOUT_MS exactly equals the queued grace) — "pre-claim wait", never "fifo".
