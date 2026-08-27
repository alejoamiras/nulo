# journal-reaper — recon (batch 8 of the PR #448 remediation)

Consolidated from two read-only recon agents against dev @ `90896ce4`. Findings in `audit/bugs/2026-08-22-production-ready/`; adjudications 2026-08-24.

## N-07 — FIFO siblings cross the reaper's queued grace (Major, RED proof `c2-1`)

- **Mechanism**: queued-journal records are created at message ARRIVAL (`wallet-sdk/queued-journal.ts` `tryCreateQueuedJournal`, called from `background.ts:308` BEFORE the session-FIFO wait). The reaper (`operation-journal/reaper.ts`) fails any non-terminal record whose `age = now − op.updatedAt` exceeds `STAGE_GRACE_MS[stage]` (:193-195; queued = 10 min :77) → `stuck_queued` (:205-210). The existing 30 s heartbeat (`execution-lane.ts:76-83` `executionWaiters` + `heartbeatExecutionWaiters` :304-307 → `journal.touchOperation`) covers ONLY ids between `acquireSlot` enqueue and grant (:239-244 begin, :283 end) — i.e. the execution-mutex wait. The session-FIFO wait (`background.ts:150` `sessionQueues`, baton at :276-282, handler chained on `prev` at :334-347, `releaseFifo` at :365/:376) is UNHEARTBEATED; a sibling behind a long approval popup (`INTERACTION_TIMEOUT_MS` = 10 min ceiling) ages past the grace and is reaped; its later claim hits `JobCancelledSentinel` — an explicitly approved op reports cancelled.
- **Adjudication**: confirmed Major, S/M; "reap clock starts at arrival, popup clock at baton-grant."
- **Fix options** (codex-mediation REQUIRED per the runbook):
  - (a) **Heartbeat session-FIFO waiters**: a second tracked set (arrival → baton grant), wired around `background.ts:276-334`, bumping `touchOperation` like `heartbeatExecutionWaiters`.
  - (b) **Key the queued grace on claim-eligibility**, not age alone (scanner variant: `createdAt` + handler-started flag; report variant: claim-eligibility keying inside `reap()`'s :193 lookup).
  - REJECTED by the audit itself: reap-on-FIFO-position ("reintroduces crash-detection the grace exists for").
- **Proof-adoption nuance**: `proofs/c2-1-reaper-vs-fifo-waiter.proof.test.ts` backdates a queued record 11 min and asserts it SURVIVES `reap({unconditional:false})`. That assertion goes green only under option (b) — under option (a) a live FIFO waiter's `updatedAt` never GOES 11-min stale (the heartbeat bumps it), the aged-record state means "genuinely dead", and the reaper SHOULD reap it; the colocated adoption must then pin the heartbeat freshness instead. The literal-proof-adoption instruction therefore leans (b); the mediation must weigh this.
- **Colocation notes** (from the proof-recon): target `operation-journal/reaper.test.ts` conventions — injected `now?: () => number` ctor arg (NOT hand-edited JSON), alias imports, standard `*.test.ts` name; the extension's `vitest.setup.ts` already stubs `chrome`.

## N-16 — unbounded `waitForTx` (Minor re-weighted S; converged C1-2/C2-3)

- `transaction/service.ts:221-227`: `while (this.pending.has(txHash)) await sleep(100)` — no bound, no cancellation. Locked wallet stalls `runWorker` (:326 `while (activeProfile)`), so the loop spins for the whole lock period. Adjudication residual: the 60 s popup RPC timeout means the UI never hangs — the harm is a background poll leak + a misleading 60 s transport error.
- Callers (only two, both `auth-registry/service.ts`): `revokeAuthwits` :229, `setRegistryEnabled` :278 — both already in try/catch with `task.fail`. Sibling `waitForTxProven` (:333-343) already takes `timeoutMs = 120_000` and throws on expiry — the in-file pattern to mirror.
- Cancellation primitive: `WrappedTask.cancel()` (`task/wrapped-task.ts:32-34`), `.isFinished` (:44-47, true for Completed|Failed|Cancelled). TRAP: `waitForTxTask?.complete()` on an already-cancelled task THROWS (`task/service.ts:107-122` validation) — the loop exit paths must handle task state.
- Zero existing coverage: no test references `waitForTx`; `auth-registry/service.test.ts` doesn't exercise either caller.

## N-25 — controller leak under `queuedJournalId` (Minor; broader per adjudication: reaped-sentinel path too)

- Registration #1: `execution-lane.ts:239-244` — `acquireSlot` registers `preController` under `queuedJournalId` + `beginExecutionWait`. Registration #2: `claim-helper.ts:239-241` re-sets under the same key on successful claim.
- The leak: `dapp-send-executor.ts:175-237` `runInSlot` — `journalId` only assigned at :218 AFTER `claimOrCreateJournal` resolves; every pre-claim `JobCancelledSentinel` throw in `claim-helper.ts` (:125-131, :155-157, :184-186) and any genuine storage error rejects before that, so the finally's `if (journalId) deleteController(journalId)` (:234) no-ops while the :242 registration persists. Only the "record not found"/"reaped mid-refile" branches clean up (claim-helper :101, :160). `releaseSlot()` is unconditional — the mutex doesn't wedge, only the Map entry leaks (till cancelJob or SW death).
- Fix per audit: delete the controller under `queuedJournalId` in the finally when `journalId` is unset (shape: `journalId ?? hooks?.queuedJournalId`).
- Scope nuance: `acquireSlot`'s OWN catch (:262-278) already deletes the entry for failures inside itself (capacity/abort, :264) — the uncovered window is strictly claim-time (post-grant, pre-:218).
- Secondary harm (recon): the stuck `waitForTxTask` subtask never finishes, which also blocks `TaskService.cleanupStaleTasks` from GC-ing the task tree (N-16).
- **Existing pin PINS THE BUG**: `dapp-send-executor.test.ts:590-607` asserts `deleteController` NOT called on claim-throw — written with `queuedJournalId` undefined, so the fixed code ALSO doesn't call it there; the pin needs a sibling case WITH a queuedJournalId where the fix DOES delete. `claim-helper.test.ts` uses a REAL `Map` for `activeControllers` (leak assertions possible); `dapp-send-executor.test.ts` mocks the lane entirely.

## Harness map

- `reaper.test.ts`: real journal + FakeBrowserApi; injected `now()`; `started()` helper.
- `gc.test.ts`: same + direct storage writes for deterministic timestamps.
- `queued-journal.test.ts`: real journal, stub everything else (`makeProfileStub` etc.).
- `execution-lane.test.ts`: mocked deps + REAL ExecutionMutex; `controllers()` private reach-in; fake timers for the heartbeat (`advanceTimersByTimeAsync(30_000)` + microtask flushes).
- `claim-helper.test.ts`: mocked journal, REAL controllers Map.
- `dapp-send-executor.test.ts`: fully mocked lane (`makeHarness`); module-level vi.mocks for @aztec/tx + runtime utils; the P17 slot-scaffold oracle block (:531-624) is the ordering/no-leak contract home.
- `session-baton.test.ts`: pure-function FIFO/baton tests.
- `transaction/service.test.ts`: real service, fake timers park the 1 s worker; `svc()` stubs.
