# Phase 3 — the sweep

## What landed

- **`ExecutionLane.abandonDeadSessions()`** walks the controller map. For each entry it reads
  `peekLiveSerial()` when it reaches the entry and skips a live serial. A dead one gets
  `transitionIfStage(id, ["queued", "pending", "simulating", "proving"], { stage: "cancelled" })`,
  and only a `transitioned` outcome aborts the controller. Each record runs in its own `try`, and a
  failure is logged as `{ journalId, error }`.
- **`abortCancelled(jobId)`** is the abort, delete and pre-claim prune that `cancelJob` already
  ran after its transition. `cancelJob` and the sweep share it; `cancelJob`'s principal check and
  its `transitionOperation` call are unchanged.
- **Scheduling.** `ExecutionService.init` subscribes `() => void this.lane.abandonDeadSessions()` to
  `onActiveProfileChanged`, so every open and close starts a sweep and the handler returns at once.

## Decisions and deviations

1. **A separate subscription, not a second statement in the gas-cache subscriber.** Both fire on
   every event, truthy or `undefined`. Keeping them apart leaves `wireCacheInvalidation` about
   caches.
2. **The sweep iterates the live map, not a copy.** A job registered while the sweep awaits is
   reached and judged by the liveness read at that moment, which is what the stale-argument case
   exercises. Entries deleted mid-sweep are skipped by `Map` iteration.
3. **`transitionIfStage` instead of `cancelJob`'s `transitionOperation` and catch.** The compare
   returns a discriminant for `submitting`, terminal and missing records without throwing. A thrown
   error is then a real journal failure and is logged at error level, not read as "too late".
4. **Only `transitioned` aborts.** `stage` means the record reached `submitting` or a terminal
   stage, which the broadcast check owns. `missing` means the row is gone, as after a deletion
   purge, and the fence's epoch check stops that work at its next assert.
5. **Serials make deadness stable.** Each open or restore takes the next serial, and neither the counter nor
   the registry survives a service-worker restart. A record judged dead therefore cannot become live
   while its cancel is awaited.
6. **The handler returning synchronously is structural.** `EventHandler.invoke` is synchronous and
   the subscriber returns `void`. The stale-argument case shows the handler returned while the
   sweep's journal write was still parked.

## Tests

Unit (`execution-lane.test.ts`, describe `ExecutionLane.abandonDeadSessions`):

- A dead serial's record is transitioned before its controller aborts. A live serial and a record
  at `submitting` keep their controllers and stages.
- A journal failure on one record is logged with its id, and the next record is still cancelled.

Composition (`service.composition.test.ts`, describe "a session change sweeps the work of the
session that ended"):

| Plan case | Test |
|---|---|
| Parked at prove, switch or lock | `test.each`: the record is `cancelled` before the gate releases; the run throws `JobCancelledError`; `toTx` and `sendTx` never run |
| A record at `submitting` | The sweep settles with the record still `submitting`; the send completes and the record succeeds |
| Stale-argument race | A lock starts the sweep, whose cancel write is parked; `p1` re-opens and a new job registers under the new serial; on release the old job is `cancelled`, the new one stays `queued` with its controller live |
| Registration after the sweep | A transfer parked at its journal create; lock and sweep; on release the registration refuses, the record is `failed/session_ended` under `p1`, the proof gate is never entered |
| Journal failure | `transitionIfStage` rejects once; the sweep resolves, the error is logged with the journal id, and the send stops at its post-prove assert as `failed/session_ended` |

## Mutation checks

Run by a scratch script that patched a source, ran the lane and composition files, and restored it.

| Mutation | Tests that failed |
|---|---|
| Subscriber removed | both parked-at-prove cases, the stale-argument race, the journal-failure case |
| Liveness read once before the loop | the stale-argument race |
| Abort before the journal transition | the unit order pin, the unit failure pin, the journal-failure case |
| Abort on every outcome | the unit order pin |
| One `try` around the whole loop | the unit failure pin |

The `submitting` and registration-after-sweep cases do not depend on the sweep acting, so no
mutation of the sweep fails them; they pin that nothing else changes.

## Validation gate

| Command | Result |
|---|---|
| `cd apps/extension && bun --bun vitest run src/wallet/services/execution` | exit 0: 45 files passed, 1 skipped; 629 tests passed, 7 todo |
| `bun run typecheck:all && bun run lint` | exit 0; 30 warnings, all pre-existing elsewhere; complexity-baseline check OK |

The new subscriber is wired at service init, so `bun --bun vitest run src/wallet` also ran: exit 0,
183 files passed, 2 skipped; 2537 tests passed.
