# Phase 3 — the balance queue reschedules transient failures (bounded, in-memory)

**Status:** ✓ gate green — `apps/extension` token-balance 133/133 (9 files, order pins untouched) · `typecheck:all` exit 0 · `lint` exit 0.

## What shipped
- `ProjectedBalance`'s error variant carries `transient: boolean`; `projectChunk` sets it from `err instanceof PxeStaleAnchorError` (the class survives the offscreen port since Phase 1), the unknown-token site sets `false`.
- `balance-job-queue.ts`: `MAX_TRANSIENT_RETRIES = 2`, `TRANSIENT_RETRY_DELAY_MS = 5_000`, the two in-memory maps, and `scheduleTransientRetry` split out of `applyProjectedError` (cancel the attempt's task, park a `retryDue` entry stamped with the batch generation, skip the failure write). `enqueueDueRetries` runs first in `tick()` and goes through `enqueue`, which stays the only entry into the queue.
- The six lifecycle rules as specified: `enqueue` deletes the id's `retryDue` entry (budget kept); success and terminal failure clear both maps; the drain drops older-generation and invalidated entries with their budget; `reset()` clears both maps in its `finally`; a stale completion (generation mismatch) touches neither map; an invalidated row is refused at scheduling time and falls through to the existing fenced failure path.
- `reconcile-pairs.ts` comment rewritten: the in-memory retry is the queue's, reconcile still re-enqueues only never-projected rows, and a `syncFailure` row waits for its next trigger.

## Tests
- `balance-job-queue.test.ts`, new describe with a fake `Date` (`vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`; the ticker is driven by calling `tick()` directly, so no timer faking beyond `Date`): recovery after the delay with the budget reset by the success; exhaustion (third transient failure persists `syncFailure`, nothing scheduled behind it); explicit `enqueue` during the delay supersedes it (one attempt, nothing when the delay elapses); `reset()` drops the parked retry; older-generation entry dropped; stale transient completion fails its task and schedules nothing; invalidated row dropped at drain time and refused at scheduling time. The existing non-transient test additionally pins `cancelTask` not called.
- `balance-projector.test.ts`: `transient` true only for a `PxeStaleAnchorError` rejection; the generic rejection and the unknown-token entry carry `false`.

## Notes
- "`reset()` during an in-flight projection" is covered by the stale-completion test rather than a literal mid-projector `reset()`: every production `reset()` is preceded by the service's generation bump (`onActiveProfileChanged`), so the in-flight batch completes as a stale completion and the retry path is never entered. A `reset()` without a generation bump exists only in tests. Calling `reset()` from inside the fake projector would also exercise a pre-existing edge unrelated to this phase (`failTask` on a task `reset()` already cancelled throws in the real `TaskService`).
- The abandoned attempt's `TaskService` record ends as CANCELLED, so the UI's task list shows no failure for a retried row; only the third attempt (or a non-transient error) produces the FAILED record and the persisted marker.
- No dead ends this phase; the existing fences (`isBalanceInvalidated`, `isRowEmittable`, generation) composed without changes.

## Carry-forward
- Phase 4's canary should see, per stale-anchor incident, the offscreen's `stale anchor on first attempt — resynced, retrying once` line; the queue's `transient failure, retry N/2` info line appears only if the offscreen's own retry also failed (two consecutive stale anchors), which the canary should not require.
