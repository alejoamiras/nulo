# Codex review — round 1 (BLOCKER)

**Date:** 2026-05-22
**Effort:** xhigh, read-only
**Session:** 019e50e1-6d76-7880-810c-e8f5540919e4

**Verdict: BLOCKER** — the plan attacked the wrong chokepoint.

## Findings

1. **Wrong chokepoint.** Same-session wallet messages are already serialized FIFO in [background.ts:93](packages/extension/src/wallet/services/wallet-sdk/background.ts) and enforced at [background.ts:181](packages/extension/src/wallet/services/wallet-sdk/background.ts). The queue wraps the full `handleWalletMessage(...)` path, which awaits `dispatcher.dispatch(...)` at [background.ts:458](packages/extension/src/wallet/services/wallet-sdk/background.ts). For `sendTx`, `dispatch()` awaits `dappInteractionService.execute(...)` at [dispatcher.ts:386](packages/wallet-bridge/src/dispatcher.ts). Two concurrent `sendTx` from the same faucet session serialize end-to-end at THIS layer, before reaching DappInteractionService.

2. **`cancelInteraction()` story incorrect.** Not part of the RPC surface in [spec.ts:72](packages/extension/src/wallet/services/dapp-interaction/spec.ts); the popup-side event listener only flips `isCancelled` in [useDappInteractionPayload.ts:73](packages/extension/src/composables/useDappInteractionPayload.ts), it does NOT auto-call `rejectInteraction`. The only reject path is explicit UI code at [useDappInteractionPayload.ts:104](packages/extension/src/composables/useDappInteractionPayload.ts). If the plan relied on `cancelInteraction` to release the lock, that would be a bug.

3. **Settlement race noted (correctness, not lock).** If an `onRemoved` callback is already queued before `detach()` at [service.ts:93](packages/extension/src/wallet/services/dapp-interaction/service.ts), `_settleUserClose` could still reject the handle while `executeAndResolve` is in flight, and the later `settle()` becomes a no-op. That is a correctness race on the request result, separate from any lock issue. Should be tested.

4. **`interaction()` lock scope diagnosis unproven.** The method returns `handle.promise.finally(...)` from inside an `async try` — but does NOT `await` that promise. The "outer `finally` holds the lock until execution finishes" claim is shaky. The session FIFO above already explains the live repro.

5. **Defense-in-depth:** `requestId` is only 32 bits via `getRandomHex(8)` at [random.ts:13](packages/wallet-core/src/utils/random.ts). Not a blocker, but increase if defense-in-depth desired.

6. **No synchronous reentrancy hazard** in `Lock.dispatch()` at [lock.ts:63](packages/wallet-core/src/utils/lock.ts).

7. **Tests:** the plan referenced `service.test.ts` which doesn't exist. Test scaffolding is part of the work. Need an integration proof at the `wallet-sdk/background.ts` level — a pure DappInteractionService unit can pass while the reported bug still reproduces.

## Verification of the popup-lock claim (post-codex)

I traced `interaction()` carefully after codex's correction. The async function body sequence:

1. `await this.lock.enter()` — awaits lock acquisition.
2. `id` generation, popup open via `windowManager.openAndAwait(...)` — synchronous (returns a handle immediately, popup runs in background).
3. `storage.set(id, interaction)` — synchronous.
4. `return handle.promise.finally(() => storage.delete(id))` — constructs the chain. Synchronous.
5. The function's outer `finally { this.lock.leave() }` runs as the `return` is evaluated — **synchronously**, BEFORE the async function's outer Promise resolves.
6. The outer Promise then "follows" `handle.promise` (adopts its resolution).

So `lock.leave()` fires the moment the popup opens — NOT at execution completion. The popup-lock is fine.

Caller side: `handleWalletMessage` awaits the dispatcher → service → interaction chain. interaction()'s outer Promise follows handle.promise (which resolves on execution complete). So `handleWalletMessage` does wait for full execution. The session FIFO chains on `handleWalletMessage` completion → session FIFO holds across full execution. **THIS** is the bug.

## Conclusion

Original plan: REJECTED.
New target: per-session FIFO queue at `background.ts:181-189`. Fix needs to allow handlers to release the FIFO baton early for execution-heavy methods (sendTx specifically), while preserving FIFO ordering for methods that depend on prior state writes (registerContract → executeUtility).
