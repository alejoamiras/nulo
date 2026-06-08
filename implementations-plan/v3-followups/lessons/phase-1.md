# P1 phase 1 — ExecutionMutex hybrid backpressure cap

**Done.** `ExecutionMutex` enforces a dual cap (per-origin + total-lane), checked
atomically before enqueue. New `ExecutionMutexCapacityError` + `AcquireCaps`
(`{ originKey, maxOriginDepth, maxLaneDepth }`). Depth is tracked ONLY for capped
acquires, so uncapped callers + the FIFO-mechanics tests are untouched. Composite
origin-depth key uses a NUL separator (`${laneKey}\x00${originKey}`; neither a lane
key `profileId:chainId` nor a browser origin can contain NUL).

**Invariants (codex):**
- Cap checked + applied before enqueue → a capacity reject mutates nothing.
- `release` is the SOLE decrement path (both counters), idempotent via `released`.
- An aborted waiter's depth frees when its chained `prior.finally(release)` fires —
  conservative over-count, never an under-count, so the cap cannot be bypassed.

**Tests:** 4 new (15 total) — per-origin cap + free-on-release; total-lane cap
across origins; conservative-over-count under abort; uncapped unaffected.

**Lesson (test, not code):** the per-origin test first deadlocked + timed out — it
`await`ed a new `acquire` that queues BEHIND a still-held waiter, before releasing
that waiter. Fix: release the holder before awaiting the next acquire, or leave the
"slot freed" proof un-awaited until the holder releases.

**Validation:** 15/15 mutex tests · extension typecheck ✓ · lint ✓.
**Next (P1.2):** `TooManyPendingError` + `error-envelope` `-32005` mapping.
