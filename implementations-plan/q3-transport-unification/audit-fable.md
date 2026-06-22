# Audit — fresh hostile subagent (fable slot) — Round 1

**Verdict:** `reject (blocking: B1, B2, stale Ask3)`

## Blocking
- **B1 (dApp oracle — FALSE safety claim, verified):** the plan's "PXE errors are SW-internal, flip doesn't widen the dApp oracle" is wrong. Trace: dApp `sendTx` → `background.ts:646 dispatcher.dispatch` → execution-coordinator `proveTxTask`/`simulateTxTask` `catch{ task.fail(error); throw }` (no transform) → `handleWalletMessage` catch → `background.ts:647 toWalletResponseError(error)`. `error-envelope.ts:22-54` has NO `Rpc*` case → collapses to `error.message`. So flipping an offscreen prove/simulate timeout from string → `RpcTimeoutError` CHANGES the dApp-visible `response.error`. Must add `Rpc*` cases to `toWalletResponseError` (or pin the dApp message) + an explicit dApp-contract network gate on Phase 4.
- **B2 (misattributed disconnect risk, verified):** `is-benign-sw-disconnect.ts:24` + e2e `.includes("Client disconnected")` guard the offscreen-PROCESS `onunhandledrejection` hosting BACKGROUND-PORT clients — NOT the offscreen transport flipped in P4. `PxeServiceClient.disconnect()` has ZERO production callers (verified). Parity is fine, but the "load-bearing" justification is false; correct it.

## Other (non-blocking)
- **B3:** exactly-once cleanup (P2) is UNIT-provable only; smoke/network can't deterministically force timeout/late-response/send-throw interleavings — the P2 network leg is liveness, not exactly-once proof. State it.
- **B4:** `getErrorData = (error as Error)?.stack ?? getErrorMessage(error)` — post-flip, offscreen rejections become Errors with `.stack` → SW `wallet/index.ts:66` unhandledrejection + every `getErrorData` catch logs full STACK TRACES where they logged one-liners. Not a break, but "no production consumer breaks" is too strong (logging shape/volume change).
- **Stale Fact:** extension-messaging tests ARE CI-wired (`_unit-tests.yml:25 → test:all → --filter '@nulo/*' test`). Ask3 is a non-problem; remove.
- **null wrappedParams:** consequence misstated — `unwrapParams(null)` throws → unhandled rejection → no response → client still times out. The fix removes the SW throw but doesn't change the client-observable hang.
- Verified accurate: 449+387/836 test lines, 21 subclasses, `ensureInitialized` identical, `messages.ts` `errorPayload` additive, telemetry sanitizer intact.
