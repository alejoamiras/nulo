# v3 phase 1 — activation: release the baton when the request enqueues for execution

This is the commit that turns parallel popups ON. The engine (phases 2+3) was
inert until now because the session-FIFO baton only advanced at handler
completion. Phase 1 moves the release earlier — but to the right place, which
took a codex round to pin down.

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

## First cut (and why codex blocked it)

The first cut unified the field name and fired the release at the **approval
seam** — `approveInteraction()` / `silentInteraction()`. Codex audited it and
blocked on a real ordering bug (P1):

> Releasing at approval does not preserve T1→T2 execution order. The execution
> mutex is FIFO only among callers that have already called `acquire()`.
> `executeAndResolve()` awaits `refreshSession()` before reaching the mutex, so
> a faster T2 could call `acquire()` first and overtake T1. The mutex still
> closes stale-note interleaving, but the "T2 waits behind T1" model is not
> guaranteed — dependent back-to-back txs could flip order.

Also P2: the extension's `ExecutionHooks` was a separate all-optional type from
wallet-bridge's `IExecutionHooks`, so a one-sided rename on the extension side
could still go structurally dead.

## The fix that shipped

**P1 — release on mutex-enqueue, not at approval.** `ExecutionMutex.acquire()`
installs the request as the FIFO tail *synchronously*, before its first `await`
(execution-mutex.ts). So `acquireExecutionSlot` now calls `acquire()`, fires the
release the instant we're enqueued (new `onEnqueued` param ← `onExecutionEnqueued`
hook), then awaits the grant. Because we enqueued *before* the baton advanced,
any later request can only reach its own `acquire()` strictly behind us →
execution order is preserved. Popup #2 still opens immediately (we don't wait
for the slot grant — important when an earlier tx is still proving and holds the
mutex). The firing moved out of DappInteractionService entirely; both send paths
pass `hooks?.onExecutionEnqueued` into `acquireExecutionSlot`. Hook renamed
`onInteractionApproved` → `onExecutionEnqueued` to match where it actually fires.

**P2 — single hook type.** The extension's `ExecutionHooks` now aliases
wallet-bridge's `IExecutionHooks` (`export type ExecutionHooks = IExecutionHooks`),
so the field set is one type across the layer boundary; a one-sided rename is a
build error. The dispatcher's `DispatchHooks` is tied to it at the `handleSendTx`
mapping (object literal → excess-property check).

## Why this is safe to turn on

The per-(profileId, chainId) `ExecutionMutex` (phase 2) serializes the full
build→simulate→prove→submit lifecycle. Releasing the baton at mutex-enqueue lets
the next popup open while preserving order: a later request enqueues strictly
behind the current one. The release is idempotent, so the safety-net
`.finally(releaseFifo)` (still in place for reject / non-sendTx / throw / cancel-
before-execution paths, which never reach `acquireExecutionSlot`) is harmless if
it also fires.

## Tests

- `wallet-bridge/dispatcher.test.ts` — forwarding pin: `dispatch("sendTx", …,
  { onExecutionEnqueued, queuedJournalId })` must reach
  `DappInteractionService.execute` under those exact names.
- `dapp-interaction/service.test.ts` — pins that DappInteractionService
  *forwards* the hooks to `executeOperations` and does NOT fire the release
  itself (that's ExecutionService's job now).
- `execution-mutex.test.ts` already pins acquire-call-order == FIFO-order (the
  "three acquirers" test) — the property the P1 fix depends on.
- e2e: `concurrent-sendtx-approve.test.ts` (standard matrix — popup #2 opens
  while T1 is still active, T2 queued) and `concurrent-sendtx-confirm.test.ts`
  (heavy job — both approved, both confirm; doubles as the mutex no-double-spend
  pin since both draw the same public balance).

## Validation

typecheck:all ✓ · extension unit 1946 ✓ · wallet-bridge unit 81 ✓ · lint ✓ · build ✓.
e2e: lint-clean + pattern-consistent with the sibling network tests; full
network shard sweep pending (Phase 4 close-out).

Note: e2e files are not typechecked in CI (no tsconfig includes `tests/e2e`); the
`chrome.storage.session.get(null)` cast pattern matches the existing
`concurrent-sendtx.test.ts` verbatim.
