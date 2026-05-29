# v3 phase 1 — activation: baton release at the approval seam

This is the commit that turns parallel popups ON. The engine (phases 2+3) was
inert until now because the session-FIFO baton only advanced at handler
completion. Phase 1 moves the release to the moment the user approves.

## Root cause of the long wait (the dead wire)

`background.ts:onWalletMessage` created `{ releaseFifo, queuedJournalId }` and
passed it down. The dispatcher's `DispatchHooks` declared the release field as
`onTxRequestFinalized`, and `ExecutionService` read `hooks?.onTxRequestFinalized?.()`.
Field-name mismatch: the object carried `releaseFifo`, the readers looked for
`onTxRequestFinalized`. TypeScript did not catch it — both fields are optional,
and excess-property checks fire only on object literals, not on a typed
variable passed through. So the early release was **never wired**; the baton
only advanced via the safety-net `.finally(releaseFifo)` at full handler
completion. That is why popup #2 waited for popup #1's entire prove+submit.

## The fix (surgical)

1. **Unify the field name** to `onInteractionApproved` across all three type
   layers: `IExecutionHooks` (services-contract.ts), `DispatchHooks`
   (dispatcher.ts), `ExecutionHooks` (dapp-interaction/spec.ts).
2. **Move the firing site** from the (dead) post-build call in
   `executeAztecSendTx` / `executeNoFromSendTx` to the two approval seams in
   `DappInteractionService`:
   - `approveInteraction()` — fires when the user approves the popup, before the
     un-awaited `executeAndResolve` handoff.
   - `silentInteraction()` — fires right before `executeOperations`, for the
     no-popup self-paid path.
   ExecutionService no longer reads the hook (the two dead calls were deleted);
   it still receives the bag for `queuedJournalId`.
3. **Wire `releaseFifo` into the `onInteractionApproved` slot** at
   `onWalletMessage`, and type `handleWalletMessage`'s `hooks` param as the
   imported `DispatchHooks` (not a local mirror) so the wiring is type-checked
   end-to-end. A future one-sided rename now breaks the extension compile —
   closing the exact gap that let the original drift ship.

## Why this is safe to turn on now

The per-(profileId, chainId) `ExecutionMutex` (phase 2) already serializes the
full build→simulate→prove→submit lifecycle. Releasing the baton at approval
only lets the *next popup* open; when that request reaches execution it waits
on the mutex behind the in-flight one. So T2 shows "Queued" while T1 proves —
popup concurrency without on-chain interleaving. The release is idempotent, so
the safety-net `.finally(releaseFifo)` (still in place for reject / non-sendTx /
throw paths) double-firing is harmless.

## Tests

- `wallet-bridge/src/dispatcher.test.ts` — added a positive forwarding test:
  `dispatch("sendTx", …, { onInteractionApproved, queuedJournalId })` must reach
  `DappInteractionService.execute` under those exact names. Pins the wiring whose
  drift caused the bug. (The batch-isolation test was renamed in lockstep.)
- `dapp-interaction/service.test.ts` (new) — both seams fire
  `onInteractionApproved`, and the release is **not gated on execution
  completion**.

Timing lesson: could not assert `executeOperations` was uncalled at the instant
of approval — microtask interleaving (the un-awaited `executeAndResolve` resumes
after `refreshSession`'s already-resolved await before the test continuation
runs). Asserted instead that `windowManager.settle` is never called while
`executeOperations` hangs — proving the release fired independently of the
request finishing.

## Validation

typecheck:all ✓ · extension unit 1946 ✓ · wallet-bridge unit 81 ✓ · lint ✓ · build ✓
