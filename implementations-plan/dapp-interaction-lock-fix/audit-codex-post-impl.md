# Codex post-impl review

**Date:** 2026-05-22
**Effort:** xhigh, read-only
**Session:** 019e5167-a1a4-7383-8e0f-83ca6ac7b8e7
**Commit reviewed:** 3ce7f58

**Verdict: needs-work** — 2 real findings + observability notes.

## Findings

### F1 — Queued-cap not actually bounded under bursts

`countOperations` returns a fresh count, then `createOperation` writes a record. Between count and create there's NO atomicity; N concurrent `tryCreateQueuedJournal` invocations all race through the same `countOperations() → createOperation()` sequence with no shared lock or CAS.

A malicious dApp firing 100 sendTx in one tab burst will create 100 queued records before the cap engages. The 8/32 cap is advisory, not protective. The doc string overstates the protection.

**Fix needed:** atomic "reserve queued slot + create record" path. A small per-session lock around the count + create section, OR a global lock if simpler.

### F2 — Pre-claim cancel is not end-to-end

`RecentActivityView.vue` cancel button → `recent-activity-handlers.ts` → `ExecutionService.cancelJob(jobId)` → transitions journal record to `cancelled`. **But the send path still enters `DappInteractionService.execute()` and can open/wait on a popup** because nothing checks that queued cancellation BEFORE the popup handoff.

`cancelInteraction()` exists but is NOT wired from the queued-card cancel surface.

The 4001 path only kicks in once `claimOrCreateDappExecuteJournal` sees a non-queued record (`execution/service.ts:1219`). So "queued cancel before claim" is only partially implemented — the user CAN end up seeing a popup for a request they cancelled.

## Direct answers (positive)

- **Layer 1 looks mechanically sound.** Baton released exactly where intended; non-sendTx methods keep old serial semantics via safety-net `.finally(releaseFifo)`.
- **No awaitable gap after `queued → pending`.** Controller registration IS the next synchronous line after the awaited transition.
- **Popup-handoff hook persistence is correct on the approve path and doesn't leak into batch recursion.** Hooks stored on the interaction record, recovered in `executeAndResolve`, passed through silent path too. Batch carve-out is correct: hooks 4th arg, not on `ctx`, and `dispatch("batch")` deliberately recurses without them.
- **The journal mutex does close the exact queued→pending vs queued|pending→cancelled race.** If cancel wins inside `transitionOperation()`, claim re-reads and turns that into the existing 4001 pipeline.
- **"Wallet locked" adversarial case is slightly off.** With the shipped code there's no queued record in that case — `tryCreateQueuedJournal` returns early when no active profile exists (cheap gate).
- **FIFO ordering for `registerContract` / `executeUtility` remains intact.** Only `sendTx` can early-release; other methods still release on handler completion.
- **SW-restart recovery looks fine.** Boot reap marks every non-terminal record failed, including `queued`.

## Notes (cosmetic drifts)

- **Reaper observability drift:** stale `queued` records currently tagged `stale_on_resume`, not a queued-specific kind. Should be `stuck_queued` (or `stuck_proving` if reusing existing kinds).
- **Type permissiveness:** `initialStage: {stage:"queued"}` allows queued records of ANY `kind` (including `transfer`). Could tighten via discriminated union: queued is only legal for `kind:"dapp_execute"`, `origin:"dapp"`, sessionId present.
- **Missing tests** that would materially reduce regression risk:
  - One integration test for the background FIFO baton and hook propagation
  - One burst test proving the cap behavior actually engages
  - One queued-card-cancel-before-popup test
  - One dispatcher test pinning that batch legs never receive hooks
- **Operationally,** the O(n) `countOperations` scan is fine at "hundreds of records" scale. Global transition mutex holds only for one validated read + one write — low-ms in normal conditions. Migration risk is low (additive). The bigger operational concern is the non-atomic queued-cap (F1).
