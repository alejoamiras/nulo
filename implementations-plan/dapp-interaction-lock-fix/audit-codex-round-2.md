# Codex review — round 2 (NEEDS-WORK, direction sound)

**Date:** 2026-05-22
**Effort:** xhigh, read-only
**Session:** 019e50ed-37bb-7701-a98a-3b23f7f4dffa

**Verdict: needs-work.** Two corrections + several refinements before implementation.

## Findings

### F1 — `releaseFifo` must NOT live on `SessionContext`

`dispatch("batch", ...)` recursively reuses the same `ctx` for each batch leg (dispatcher.ts:220 + handleBatch at :332). If a batched `sendTx` leg calls `ctx.releaseFifo`, the top-level session baton advances before later batch legs finish — breaks the batch's sequential contract; lets following session messages overtake unfinished work.

**Fix:** pass the hook as an internal `dispatch(..., hooks?)` / `handleSendTx(..., releaseFifo?)` argument. Do NOT propagate into recursive batch dispatch.

### F2 — `NO_FROM` / `default_entrypoint` path missed

`executeAztecSendTx()` tail-calls `executeNoFromSendTx()` (service.ts:1966) when `executionMode === "default_entrypoint"` (service.ts:1848-1854). The plan only fired the hook in the standard path. NO_FROM sendTx would stay serialized.

**Fix:** fire the hook in `executeNoFromSendTx` too, at its proving-stage equivalent boundary (service.ts:2070-2081).

## Direct answers

### Nonce model

**Plan's mental model was wrong.** Wallet generates the nonce itself at `tx-request-builder.ts:126` (`Fr.random()`), passes as `txNonce` at :354-361. The account adapter forwards unchanged at `nulo-account.ts:92-136`. Upstream binds via `EncodedAppEntrypointCalls.create(calls, txNonce)`.

PXE does NOT allocate/return a nonce. Two txs get independent `Fr.random()` nonces → collision is cryptographically negligible, NOT state-race impossible. Sequential build doesn't *guarantee* uniqueness; it just preserves conservative pre-prove ordering. For the field's bit-width, the collision probability is negligible enough to count as safe.

### Release-point timing

`markJournal({stage: "proving"})` IS after request finalization (service.ts:1919, after :1912-1916). Plan's choice was correct on safety.

**Better release point: slightly earlier.** The strict boundary is "final `txRequest` exists and cancellation was checked" — i.e., after `buildAndEstimateTxRequest(...)` + `checkCancelled()`, BEFORE the journal write. Avoids coupling FIFO progress to journal I/O. Latency benefit small but the semantic is cleaner.

If we move the release point, **rename the callback** from `onProvingStarted` to `onTxRequestFinalized`.

### Proving/submitting nonce re-read

After build, pipeline only passes the finalized `txRequest` into:
- `pxe.proveTx(txRequest, scopes)` (execution-coordinator.ts:70)
- `node.sendTx(tx)` (execution-coordinator.ts:89)

No nonce re-read. Stored nonce comes from captured build result at service.ts:1930-1937. Safe.

### Plumbing pattern

Per-call callback is the right mechanism. No existing async-hook / event pattern fits. TaskService / journal events are global observability channels, not precise control-flow hooks.

**Scope:** keep the hook off exported / domainish types like `SessionContext`. Internal-only on dispatcher/service methods.

### Safety net

With current code, it fires. `handleWalletMessage()` catches dispatcher failures + response-send failures (background.ts:445-484). Synchronous throws from `dispatcher.dispatch` still settle the handler promise.

**Recommendation:** attach `.catch(() => {})` to the ignored internal chain in the new queue wiring so future refactors don't create unhandled rejections.

### PXE/node concurrency

Same-chain PXE work is already serialized in the offscreen runtime. `simulateTx`, `proveTx`, `executeUtility`, `profileTx` all go through `withPxeWrite(...)` (aztec-runtime/src/pxe/service.ts:425).

**Implications:**
- Two `simulateTx`: safe, but serialized.
- Two `proveTx`: safe, but serialized.
- Two `sendTx` submissions can overlap only after proof (because `node.sendTx` itself is NOT guarded by `withPxeWrite`).

This does NOT defeat the popup/FIFO fix, but it does limit true execution parallelism. The benefit users see: popups appear concurrently (not after waiting minutes); proving still serializes at PXE — but that's faster than the popup-wait was.

### Settlement race

Unchanged. `approveInteraction()` still detaches then kicks off `executeAndResolve` (service.ts:83). `WindowManager` already supports concurrent handles (window-manager.ts:10-12). More overlap → same race surface.

### Out-of-order responses

Once early release is allowed, same-session responses CAN resolve out of order. Probably acceptable because wallet-sdk correlates by `messageId` (not request order) in `extension_wallet.ts:165-186`.

**Add a test** that verifies this end-to-end: send T1, send T2, T2 resolves first (via deferred T1 execution), assert dApp sees both results correctly correlated.

## Verdict

If we fix F1 (batch leakage) and F2 (NO_FROM path), and address the refinements (release point + rename + .catch + out-of-order test), the core direction is sound.
