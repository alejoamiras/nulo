# M2.3-d audit-diff

## Single deviation: reentry fail-fast dropped

**Plan (line 302, 310):** nested `write` inside `read` should throw synchronously via an "AsyncLocalStorage-style dev-assertion."

**What shipped:** no reentry check. JSDoc warns callers not to nest; 5-minute force-release unsticks any accidental deadlock.

**Why:** MV3 service workers / browsers do not have `AsyncLocalStorage`. The naive global `readStackDepth` counter approach produces false positives: while `read(fn)` is `await`-ing inside `fn`, the JS runtime yields; another unrelated call to `write()` would see `readStackDepth > 0` and throw — but that is exactly the profile-switch-during-read case we *want* to queue, not reject. Per-context tracking needs AsyncLocalStorage, which we do not have.

**Blast radius:** In PxeService, writes come exclusively from `onActiveProfileChanged` / `onProfileDeleted`; reads come from public RPC methods. No call path goes read → (handler) → write organically, so the reentry case does not arise in practice. Developer error (writing `read(() => write(...))`) would deadlock, but the 5-min force-release converts it to a loud error log + unstick, which is the same debuggability outcome the plan's fail-fast aimed for.

**Replaced test:** plan's "reentry fails fast" test case (line 310) → shipped "force-release unsticks writer after MAX_READER_DRAIN_MS when readers hang" — covers the same pathological deadlock using the 5-min safety net instead of sync throw.

## Confirmed-in-scope items

- Reader counting + drain-on-write: shipped.
- Writer FIFO / no starvation: shipped + tested.
- Readers-arrive-after-writer-queued wait for writer: shipped + tested.
- enterWrite drains active readers: shipped + tested.
- Rejection paths decrement counters: shipped + tested (reader throw + writer throw).
- Baton-pass handoff so racing writers can't jump the queue: shipped (not in plan but needed for correctness).
- 5-min force-release: shipped + tested.
- Registry fetch bounded timeout (plan line 268): shipped (`REGISTRY_FETCH_TIMEOUT_MS = 30_000` in `pxe/service.ts`).

## Items deferred to later M2.3 sub-PRs

- `ensureChain` at `service.ts:365` mutates `chainInitPromises` **outside** the guard's read path. This is a latent double-init race on concurrent reads against a cold chain. **Deferred to M2.3-a** (`ChainRuntimeRegistry.getOrInit` internalizes + dedupes this under the guard).
- "stale-profile init race" + "profile-switch race regression" tests (plan lines 312-313) are ChainRuntimeRegistry-level tests. **Deferred to M2.3-a test suite.**
