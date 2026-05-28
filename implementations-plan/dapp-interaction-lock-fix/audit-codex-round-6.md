# Codex review — round 6 (NEEDS-WORK, smallest finding-set yet)

**Date:** 2026-05-22
**Effort:** xhigh, read-only
**Session:** 019e5142-43cf-7202-b921-5429bbd83315

**Verdict: needs-work** — two mechanical fixes. Otherwise architecture sound.

## Findings

### F1 — `updateMetadata` reintroduces a lost-update race

`transitionOperation()` is a full-record load/validate/write at service.ts:169. `EntityStorage.set()` replaces the whole row at entity_storage.ts:97. A concurrent `updateMetadata(load + merge + write)` can overwrite a newer stage/error/terminalAt written by `transitionOperation`, even if `title` is "non-FSM".

**Best fix:** drop `updateMetadata` from v6 entirely. It's not load-bearing — the queued helper already sets `title` from the same message payload. If kept, it MUST share the same journal write lock.

### F2 — DappInteractionService.execute arg-slot collision

`execute` already uses arg 2 as `cancellationToken?: string` (dapp-interaction/service.ts:140; wallet-bridge services-contract.ts:41). The plan repurposes that slot for hooks.

**Fix:** use a third arg or options bag. Same pattern as the `executeOperations` arg-3 collision from R5.

## Direct answers

**Journal mutex on transitionOperation only:** correct for the current bug. `createOperation` doesn't need it (writes fresh id). `deleteOperation` doesn't matter for this fix. **Once you add another whole-record writer like `updateMetadata`, the statement stops being true.** If kept, lock must be journal-write-wide, not transition-only.

**Global vs per-record:** global is right. Critical section is tiny, journal write volume is low, simplicity wins.

**Reaper interaction:** no deadlock risk. `Lock` is single FIFO with no nested acquisition (lock.ts:19). Reaper awaits transitionOperation per record (reaper.ts:189). Worst case is delay.

**Batch handling:** no hidden shared-record problem. Hooks intentionally not forwarded through `handleBatch()` (dispatcher.ts:332). Batched sendTx uses normal `beginDappExecuteJournal`, gets its own record. The only limitation is the documented one (no queued visibility / no early FIFO release for batch).

**JobCancelledSentinel before markJournal("simulating"):** valid. Outer per-op try/catch in `executeOperations` (service.ts:865) wraps the whole op dispatch.

**Sessionless records and cap filter:** predicate correct. `if (filter.sessionId !== undefined && op.sessionId !== filter.sessionId) continue` excludes `sessionId === undefined` rows when a filter is present.

**updateMetadata without mutex:** REFUTED. Not safe against concurrent transitionOperation. Either serialize under the same global lock or remove. Codex recommends remove.

**Cap counts vs cleanup race:** soft cap, not hard. Concurrent arrivals can overshoot by ~1. Acceptable for DoS mitigation.

**Small follow-up (not blocker):** keep `.catch(() => {})` on the ignored internal handler chain so a future refactor doesn't create unhandled rejection. Already in v6 Step 5.

## Verdict for v7

Once F1 (drop updateMetadata) and F2 (use third arg) are addressed: no other correctness blockers.
