# Phase 5 — Trust-point redesign (post-send, pending + reconcile)

Move public-authwit recording out of build-time (`buildStandard.trackAuthwit`, which
leaks on estimate/reject) to a post-send, pending→reconcile flow with a pre-send cap.

## Foundation (landed `bc6c024`)
`Authwit.pending?` + `Authwit.txHash?`; `MAX_TRACKED_AUTHWITS_PER_ACCOUNT=256`; service
methods `isAtCap` / `recordPendingAuthwits` / `reconcileAuthwits`. Additive, compiles.

## Codex design consult (session `019ed9e4`, xhigh) — verdict + 4 holes caught

Threading verdict: thread `pendingPublicAuthwits` via `BuiltStandardTx → FeeEstimate`
(`FeeEstimate extends BuiltStandardTx`, fee-strategy.ts:67) — the cleanest seam, since
`buildStandard` is the only place that computes the authoritative hash in context.
Do NOT re-derive in the executor (fjwc/fpc mutate actions around build) and do NOT stash
on `txRequest` (mixes transport bytes with wallet bookkeeping). Use ONE post-send closure
owning BOTH tx-recording AND authwit-persistence (not a second coordinator hook) so
ordering is explicit.

Holes caught (my naive plan would have shipped these):
1. **Cap per-action is insufficient.** `isAtCap` inside each `add_public_authwit` arm lets
   `255 existing + 2 new` slip through and miscounts intra-tx duplicates. Need a per-BUILD
   check: `existing tracked + pending + unique-new-hashes-not-already-tracked ≤ 256`.
2. **`waitForTx` / journal `succeeded` ≠ mined.** `transactionService.waitForTx` returns
   when the tx leaves the pending map — which includes PROPOSED, PROVEN, FINALIZED, AND
   DROPPED (transaction/service.ts:158-164,238-240). Reconcile off
   `transactionService.onTransactionUpdated`: Proven/Finalized + `executionResult===Success`
   ⇒ confirm; Dropped or any included non-success ⇒ remove.
3. **`syncAuthwit` prunes pending rows.** It deletes any non-consumable row
   (auth-registry/service.ts syncAuthwit) — a pending grant isn't consumable until mined,
   so sync would delete it pre-maturely. Pending rows MUST be excluded from sync-prune.
4. **Recovery source is circular.** "The pending row IS the durable record" fails when the
   row's write fails. A send can succeed then crash before journal `succeeded`, and the boot
   reaper can mark `submitting` failed while the tx is live. Durable source must be
   JOURNAL-backed authwit metadata, persisted no later than `submitting` keyed by txHash;
   recovery scans journal rows by txHash regardless of final stage + idempotently repairs.

## Invariant (the security contract)
For each wallet-originated public-authwit hash, local state is EXACTLY one of:
- `pending` + unresolved tx, OR
- `confirmed` (pending cleared) + proven-successful tx, OR
- absent (tx dropped / reverted / non-consumable).
Worst failure: a proven-successful grant MISSING from the index ⇒ the user silently loses
the ability to revoke it (a lost security control). The design breaks the invariant if the
cap is per-action, pending rows are sync-pruned, `succeeded` is treated as mined, or
recovery metadata lives only in the row whose write may fail.

## Implementation plan (per the validated design)
1. `buildStandard`: collect `pendingPublicAuthwits[]` (drop the 4 `trackAuthwit` calls);
   per-build cap check (existing+pending+unique-new ≤ 256, throw overflow); add to
   `BuiltStandardTx`. `FeeEstimate` inherits; ensure strategies propagate (fpc spreads
   `...built`; embedded/fee-juice cherry-pick → add explicitly or convert to spread).
2. Persist authwit metadata into the operation-journal at `submitting` (keyed by txHash) —
   the durable recovery source.
3. One post-send closure (fold into `recordTransaction`) records the pending rows.
4. Reconcile via `transactionService.onTransactionUpdated` (Proven/Finalized+Success →
   confirm; Dropped/non-success → remove).
5. `syncAuthwit`: exclude `pending` rows from prune. **[doing first — small, safe, correct]**
6. Startup recovery: scan journal rows by txHash, query tx outcome, idempotently repair.
7. Tests: per-build cap (255+2 blocked), estimate/reject/fail record nothing, one mined
   records once, dropped reconciles to absent, sync does not prune pending.
LESSONS_FILE=implementations-plan/network-e2e-required/lessons/phase-5.md

═══ REGRESSION (post-cutover) — BLOCKED pending user decision ═══
The cutover compiles + 16 unit tests pass, but the F1 e2e soak fails REPRODUCIBLY (2×):
- bt9eze2fn: 329s, "Waiting failed" at the revoke settingsAction submit-disappears wait.
- bseja9x1z: 364s, identical.
Baseline (Phase 4, pre-cutover): 76s/80s green. So the cutover introduced a ~4× slowdown
+ a revoke-completion hang (protocolTimeout — SW/page unresponsive). NOT a flake (2 identical).
Recording itself WORKS: G1 recorded→consumed, G2 granted, revoke-all enabled+clicked — the
hang is the revoke sendTx not completing. Prime suspect: the new onTransactionUpdated
reconcile subscription firing per-tx-update + contending on `this.lock` with revokeAuthwits'
syncAuthwit, or general SW load; needs SW-side timing diagnostics to confirm.
Executor negative pins landed (dc61a92): record-once-on-send, none-on-estimate, none-on-fail.
NOT done: cap-blocks pin (needs tx-request-builder harness), reconcile pin (needs auth-registry
service harness), journal-backed crash-recovery (codex #4).
STATUS: Phase 5 reproducibly RED. opts.from fix (5d09ca3) is done + proven (2× green) and
independent. Awaiting user: land opts.from + park/revert Phase 5, vs debug the revoke hang.

═══ REVOKE-HANG ROOT CAUSE — FIXED (codex r10, session bn67m59dw) ═══
The 3× reproducible revoke hang was NOT lock contention (codex ruled that out) and NOT
machine load (reproduced on a light machine). Root cause: my `syncAuthwit` pending-exclusion
(`if (authwit.pending) return`) was placed AFTER `parentTask.startSubtask(...)`, so it
returned leaving the subtask UNFINISHED. `TaskService` refuses to complete/fail a parent
with open children (task/service.ts:95), so `revokeAuthwits`' `syncAuthwits` wedged its own
task tree → revokeAuthwits never resolved → the popup's submit never cleared → e2e
`waitForFunction` hung ~5min → protocolTimeout. The revoked grants are still `pending` at
revoke time because the e2e's `waitForTxMined` advances on node receipt, not wallet reconcile
(reconcile "mined" fires on Proven/Finalized, later). The pre-existing `if (isConsumable)
return` had the same latent shape but never bit (revoked rows are non-consumable → took the
delete path → completed).
FIX: move BOTH no-op guards (pending + isConsumable) BEFORE `startSubtask` — a no-op sync now
starts no subtask, so nothing wedges the parent. (Also fixed a latent typecheck error in the
estimate pin + added `pendingPublicAuthwits:[]` to the service.characterization mock.)
typecheck + 276 execution units green. Re-soaking to validate the revoke completes e2e.
