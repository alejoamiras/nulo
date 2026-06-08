# Codex review — round 3 (BLOCKER)

**Date:** 2026-05-22
**Effort:** xhigh, read-only
**Session:** 019e510b-2881-7243-a47f-f7227959ee5c

**Verdict: BLOCKER.** Three issues that would break user-cancel semantics or never deliver hooks across the popup handoff.

## Findings

### F1 — Hook plumbing breaks across the popup handoff

`handleSendTx()` reaches `DappInteractionService.execute(...)` at dispatcher.ts:349. But the real execution happens later, after the user approves, via `approveInteraction() → executeAndResolve() → executeOperations(...)` at dapp-interaction/service.ts:83. Plan v3 says "plumb hooks through DappInteractionService → ExecutionService" but never explains where the hooks LIVE across the popup gap.

Without storing hooks on the interaction record (or a side map keyed by interaction id), the common popup-confirmed path never gets `onTxRequestFinalized` or `queuedJournalId`. The hook design works for the silent path; it BREAKS for the popup path.

### F2 — Claim-or-create fallback is unsafe

Plan B2 allows `queued → cancelled`. If a user cancels while the request is still queued (e.g., reaper sweep, manual cancel), the journal record transitions to `cancelled`. When the handler later runs, claim fails (legal transition `cancelled → pending` doesn't exist).

Plan B5's fallback says "on claim failure, fall through to create-new and execute". **This executes a user-cancelled transaction.** Catastrophic.

Same fallback creates the duplicate-record hazard: RecentActivityView renders by journal record id, not by logical tx identity. A leftover cancelled record + a new in-flight record would both surface.

### F3 — Batch handling contradictory

Plan A1 pre-creates a queued record for top-level `batch` messages. Plan A3 correctly forbids hook propagation into batch legs. With the current recursive batch dispatch, the batch-level queued record has no clean claim path — no inner leg knows to claim it.

## Direct answers

**queuedClaimed mutable ref:** technically fine in a single JS thread, but don't make it source of truth. In `handleWalletMessage` catch, read the record and only fail it if it's still `queued`. Journal is already the durable ownership state. Event is overkill; Promise buys nothing.

**N=8 cap reasonable as starting point.** Make it per `sessionId` or `(origin, chainId)`, not global. Add a coarse global hard ceiling (~32) across all sessions. T1 sketch in plan was per-account, not truly per-session.

**Pre-auth queued creation:** safe only as best-effort with cheap gates. Skip creation when:
- No active profile
- No dapp session
- No authorized account
- No `sendTx` capability grant

Full scope-enforcement duplication in background.ts is too much; cheap gates remove most noise.

**Zod schema MUST be updated.** Update:
- `JobProgressSchema`
- `JobStageSchema`
- `OperationRecordSchema`
- `NewOperationInputSchema`
- `OperationJournalMethodSchemas.createOperation`

(all in `packages/extension/src/wallet/services/operation-journal/spec.ts:140`)

Unknown-stage persisted rows are dropped on read by the journal service. **Additive stage doesn't require a storage-version bump by itself.**

**Queued/new duplicate:** observable today with blind fallback. Correct semantics:
- Do NOT delete the queued record on claim failure.
- Do NOT create-new on generic claim failure.
- ONLY create-new if `getOperation(queuedJournalId)` returns `undefined` (record was reaped).
- If record exists but isn't `queued` (cancelled, failed, ...) — ABORT execution, don't continue.

**executeNoFromSendTx** DOES call `beginDappExecuteJournal()` at execution/service.ts:1984. So B5 mirror REQUIRED. A6 also applies.

**Reaper 2-min stale window reasonable for periodic sweep.** BUT: the existing boot sweep already reaps every non-terminal record immediately on restart (reaper.ts:112). So restart-orphaned queued records don't wait 2 minutes unless special-cased. Either special-case `queued` in boot sweep OR accept that boot-sweep handles them.

**Popup interaction timeout is 10 minutes, not 5** (service.ts:40).

**Reaper cleanup of stale queued records:** transition to `failed` with an interrupted-style error kind, not `cancelled`. Cancellation should be user-initiated; this is wallet-initiated.

**Visual:** no existing queued-specific pattern. Reusing `TransactionAwaitingCard` + changing only the subtitle to `"Queued..."` is right scope. Card already uses neutral waiting styling.

## Missing tests

- Popup-confirmed path preserves hooks across `approveInteraction`
- Queued cancel before claim does NOT execute
- Claim failure on `cancelled` does NOT create-new
- `NO_FROM` path claims/releases correctly
- Top-level `batch` is either explicitly unsupported or covered
- Queued boot-sweep behavior
- Out-of-order responses still correlate by `messageId` (per user's pushback — out-of-order isn't possible with PXE serialization, but the messageId correlation should still be tested for completeness)

## Verdict for plan-v4

If we fix the popup-path hook persistence (F1) and the unsafe claim fallback (F2), the direction becomes solid. F3 is easy — drop batch from queued-record scope.
