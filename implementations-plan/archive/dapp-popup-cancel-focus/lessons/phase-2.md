# Phase 2 — journal-driven cancel in `DappInteractionService` + post-registration reconciliation

Date: 2026-09-05 · branch `worktree-dapp-popup-cancel-focus`

## What shipped
- `init()` subscribes to `operationJournal.onOperationUpdated`; a `cancelled` transition calls
  `cancelInteractionForJournal(record.id)`: scan `storage` by `hooks.queuedJournalId`, flag
  `cancelledAt`, broadcast `onInteractionCancelled`, `windowManager.cancel(handleId, new JobCancelledError(..., { jobId }))`.
- `interaction()` fires `void reconcileCancelledJournal(journalId)` right after `storage.set`
  (only for interactions that carry `hooks.queuedJournalId`): one lock-free `getOperation`; a stage
  other than `queued` → `cancelInteractionForJournal`; a failed read is logged at debug and ignored.
- Tests: 8 unit cases in `service.test.ts` (handler-driven) and a NEW `service.composition.test.ts`
  with the real journal FSM + real `WindowManager` on one `FakeBrowserApi`, the service started via
  `ServiceCollection` so `init()` wires the subscription for real: (a) cancel A → A's window only is
  removed, A's `execute()` rejects with `JobCancelledError{jobId}`, A cleaned up, B untouched, a late
  `rejectInteraction(A)` is a no-op, B later rejects as `UserRejectedError`; (b) registration gap —
  `execute()` parked inside `isConfirmationNeeded` (the profile stub's promise), cancel lands, release →
  the reconciliation read cancels it and the manager closes the late-created window.
- `ARCHITECTURE.md` has no cancel-path narrative to amend (grep for cancelJob / approval popup /
  WindowManager → none); nothing added.

## Validation gate (as run)
- `bun run --cwd apps/extension test src/wallet/services/dapp-interaction` → 3 files, 39 tests, exit 0.
- `bun run --cwd apps/extension typecheck` → exit 0. `bun run lint` → exit 0 (after formatting the new
  composition test: biome wanted the `settleOf` arrow broken across lines).
- Arc gate `bun run audit:vue`: its `typecheck:all` leg exited 0 for all 14 workspaces and its `lint`
  leg passed, but its `test` leg reported 20 failures — every one a 5 s timeout in modules this arc
  never touched (wallet-crypto password boxes, profile deletion integration, auth page latch,
  method-descriptor exhaustiveness, a dispatcher schema test). Re-run in isolation: profile/log-ban/auth
  files 180/180, wallet-crypto 112/112, wallet-bridge 241/241. The full extension suite run ALONE:
  436 files, 5443 tests, exit 0. Build: see the line below.
- `bun run build` (chrome) → `✓ built in 2.85s`, exit 0.

## Lessons
- `audit:vue` runs `typecheck:all` (14 workspaces of tsc/vue-tsc), the whole vitest suite and biome
  CONCURRENTLY (`bun run --parallel`). On this machine that starves the PBKDF2/argon-heavy crypto tests
  and the 5 s-timeout integration tests into false failures. The gate's substance is the four commands;
  when the parallel form reds on pure timeouts in untouched modules, run `test` and `build`
  sequentially after `typecheck:all` + `lint` and treat that as the gate. Worth a `--parallel`-free
  variant of the script in a separate PR.
- The journal refuses `initialStage: queued` unless `kind = dapp_execute`, `origin = dapp` AND a
  non-empty `sessionId` (zod at `createOperation`): the composition fixture must carry `sessionId`.
- A `queued` dApp record parks `execute()` at `isConfirmationNeeded`'s `getActiveProfile()` await — a
  cheap, deterministic place to hold a request between the pre-popup short-circuit and registration
  when a test needs to land a cancel in that gap.
