# Codex audit — e2e determinism plan (session 019e2c76)

## Verdict

**Hold.** Real bugs in the consolidated plan; needs revision before implementation.

## Per-section findings (verbatim)

### A. Tx-confirmation signal
Per-key storage contract is fine: `EntityStorage.set()` writes one JSON string via one `chrome.storage.local.set`, so a popup read can see old, missing, or new, but not a half-mutated tx. The real problem is **hash discovery**, not confirmation polling. Post-submit scan of all `nulo:core:txs@*` rows by `(account, createdAt >= submittedAt - 5000)` can select the previous tx once the fixed 10s spacing is removed, because the scenario reuses the same account and sometimes the same destination; the code returns the first match, not "the new key". Also, the plan's validation note is wrong: **there is no existing `transaction-service.test.ts`**.

### B. Popup-handshake signal — STRONGEST REASON TO HOLD
- `chrome.storage.session` **survives MV3 worker suspension/restart** while the browser session lives (`session-manager.ts:10`). Plan's "cleared on SW death" claim is unreliable.
- Watcher can miss entirely: `initAppServiceContext()` connects the profile port **before** `app.vue` mounts (`index.ts:31`). Proposed `watch(isBackgroundConnected, ...)` is not `immediate: true`, so the fast path can connect before the watcher exists.
- The new signal is only observability; it does NOT fix the first-load handshake drop that the triple-nav works around. Dropping the workaround re-exposes the bug.

### C. Tests removed under signal 1+5
PR-C still depends on the `Transaction submitted` toast: the toast fires only after `executeTransfer()` resolves, and the SW resolves only after `transactionService.addTransaction(...)` writes storage. So "read storage after toast" is safe. But "remove `waitForToast` from `sendTransfer` and let tx existence replace it" is underspecified and **worse on diagnostics**: on failure you would get "tx not found in storage after submit" instead of the real failed/cancelled reason.

### D. Wallet anchor-gate — scope understated
`executeTransfer` has no explicit anchor-freshness gate between simulate/estimate and prove/send. But the same simulate→prove pattern exists in **dapp send paths too**, so the real fix probably wants a shared gate/helper. "10 cases" may be fine only if you first factor the gate into a pure unit with explicit input/output. Today `buildAndEstimateTxRequest()` does not surface the anchor.

### E. Phasing
- PR-C is SMALLER than the plan says: `sendTransfer` only has 5 e2e call sites; changing return type does not force all callers to update if they ignore the value.
- PR-D should be SPLIT: "land a freshness-safe wallet signal" then "adopt it in `openPopup` with fallback". One-shot replacement of a known workaround in a helper used by every popup test is too aggressive.

### F. Both plans missed
The **operation journal is the better correlation primitive**. Per `spec.ts:104`, it persists per-operation id + stages + `progress.succeeded.txHash`. Snapshot journal ids before click; wait for the new record to hit `succeeded` or `failed`. **This avoids the tx-store scan race entirely.** Also: popup-handshake key must be **freshness-scoped**, not global, and the watcher needs `immediate: true` or a post-`loadProfile()` write on initial mount.

## What looks fine
- Using tx storage as the confirmation source is directionally right.
- `status !== Pending` is a plausible threshold.
- The post-fee-estimation 5s sleep should stay pinned and renamed, not "tested away".
- Wallet-owned signals over DOM/toast timing in general — correct direction. The plan just needs tighter contracts.
