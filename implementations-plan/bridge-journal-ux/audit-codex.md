HYBRID — keep MAIN’s durable failure facts and same-record continuation; add chain probes for verification/legacy fallback, never as leg provenance, and reject COMPETING’s discard-and-redo.

### Facts

- **[SEC — CRITICAL]** Resume currently has no trusted intent. The loader barely checks `id`/`direction`, so an attacker can replace public `recipient`, amount, secret/hash, or fuel slice and induce an on-chain spend. `fromStringUnsafe` explicitly skips address validity. Require a strict resume schema, `await address.isValid()`, current wallet/account equality, recomputed secret hashes, variant invariants, configured asset/router pins, and an explicit amount/recipient review before signing.

- **[SEC — CRITICAL]** “No `depositTxHash`” does not prove no deposit was submitted: the page can die after wallet/RPC acceptance but before `updateRecord`. Such `depositing` failures are **unknown outcome**, not safely resumable and not eligible for “no funds moved.” Cross-tab reads do not close this crash window.

- **[SEC — CRITICAL]** The private fueled-token seal is insufficient. Its envelope authenticates token secret, recipient, and token amount, but creation leaves `bridgeSecretSalt` plaintext and does not seal fuel amount/min-output/total spend. “Envelope exists, skip re-seal” can therefore strand fuel or spend a tampered amount. Direct private Fuel does seal its salt; fueled token does not.

- **[ASSUME — HIGH]** J2 says terminal errors are persisted “via A,” but A persists only `failedStep` and hashes. The actual note remains runtime-only. Persist a structured failure `{ leg, outcome, at }`; derive copy from it.

- **[ASSUME — HIGH]** `failedStep` omits `signing`, although fueled deposits have a Permit2 SIGN leg. Sealing eligibility is also inconsistent between D, J3, and J4.

- **[SEC — HIGH]** Returning a hash from `useL1FeeAsset.approve()` is insufficient if it still waits internally: a receipt-wait failure prevents the return. Persist through an `onSubmitted(hash)` callback or split submit/wait. Validate an approval hash’s receipt identity—owner, token, spender, amount, status—before narrating it.

### Inferences

- **[SEC — CRITICAL]** Fresh Permit2 nonce/deadline is unsafe: the old permit/transaction may still land, allowing two deposits. Persist the nonce before signing and reuse that nonce so Permit2 gives at-most-one execution; probe its bitmap. A different nonce is acceptable only once the old authorization cannot execute.

- **[SEC — CRITICAL]** `withRecordLock` is only a module-local `Set`; it neither coordinates tabs nor covers the existing live deposit flow. Use an origin-wide lock such as `navigator.locks`, re-read storage inside it, broadcast busy state, and fail closed where unavailable. Also, calling `runDepositClaim` while holding the same lock will silently no-op as “already in flight.”

- **[ASSUME — HIGH]** Optional fields need no mechanical JSON migration, but they require a compatibility policy. Existing approve-death records lack both fields, so MAIN alone will not repair the smoke-test history. This is where the allowance probe is useful—as “allowance currently sufficient,” not “this approval confirmed.”

- **[ASSUME — HIGH]** Allowance is mutable and may predate the record; it cannot identify a failed leg or prove a particular approval.

### Asks

- **[ASSUME — HIGH]** Must RESUME require the original L1 funder and currently selected Aztec recipient? The record does not persist an L1 owner for public deposits.

- **[ASSUME — HIGH]** What is policy for pre-hash unknown outcomes: permanent review-only, transaction-history search, or wait-until-safe?

- **[PHASE — HIGH]** Are legacy records, sealing failures, and signing failures resumable, or explicitly redo-only?

- **[PHASE — HIGH]** Re-split: first strict validator/state machine + cross-tab/idempotency gates; then direct Fuel and plain token; then private authenticated-intent upgrade; finally fueled Permit2. Do not expose an enabled J3 RESUME before its variant’s runner lands. Add two-tab, send/persist-crash, hostile-field fuzz, and Permit2 nonce-race gates.

### Looks fine

- Click-only policy.
- Same-record audit continuity.
- Deployment/FPC pinning.
- Receipt-based post-deposit recovery.
- Per-leg links and consequence-oriented narration.
- Direct Fuel as the first resume canary, once shared safety gates exist.