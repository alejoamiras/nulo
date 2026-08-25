# runtime-edges — batch 9 of the PR #448 audit remediation [light]

Findings N-15, N-21, N-28 — the final batch. All Minor/Low, adjudicated to minimal fixes; no RED proofs (all "recipe").

## Success criterion
Each fix pinned + revert-probed; audit:vue + smoke green (network e2e: only N-15 touches tx-shape surfaces — codex to ratify whether the network gate is required given the typed-error-only scope); PR merged under the three required gates with codex sign-off. THE PIPELINE'S LAST BATCH — close-out report follows.

## Assumptions (light floor — verified Facts, from recon)
1. **F**: `nulo-account.ts:170-188` — both `buildTxExecutionRequest` and `requiresInitialization` trust a single `getNullifierMembershipWitness("latest")` read; consumer `view-executor.ts:249`. No typed duplicate-nullifier error exists anywhere (grep zero). A duplicate-init failure surfaces as the `AppLogicReverted` catch-all (`transaction/service.ts:477-489`).
2. **F (fix-recipe trap)**: the "cross-check via node.getContract" recipe is the EXACT pattern `ensureContractRegistered` (:115-127) already rejected — the node client's retry/backoff blows caller timeouts offline (documented). The adjudication re-weighted N-15 to "usually rejects rather than burns; self-heals; M" and the runbook says "minimal scope" → the typed-error classification is the fix, NOT a pre-flight cross-check.
3. **F**: N-21 — `PASSKEY_TIMEOUT_MS = 5*60*1000` (`passkey/service.ts:16`, sole consumer `openWindowAndWait` :120) races leg1+leg2 = 2×`PASSKEY_TIMEOUT` (3 min each, `spec.ts:4`) on the PRF-on-get fallback (`passkey-ceremony.ts:113-119`). PATH B has NO production caller (latent; adjudication: "Bump the constant. S."). Neither constant is referenced by any test.
4. **F**: N-28 — `ServiceCollection.start()` (`wallet-core/src/base/index.ts:65-70`) is reject-fast `Promise.all` per phase: pending same-phase siblings run on unobserved (late rejection = unhandled), no later phase starts, no stop hook exists. Transport listeners are hot from CONSTRUCTION (`extension-messaging/*/service.ts` ctor `subscribe()`), i.e. before start() — the composition root documents the symptom (`runtime.ts:414-420`) and `retrySafe=false` at :328 makes any start() failure a permanent SW-lifetime veto.
5. **F**: no existing coverage on any of the three defect spans (recon-verified).

## Architecture & implementation (minimal per adjudication)

### N-15: typed duplicate-init classification at SEND TIME, provenance-gated (codex-resolved)
- **Seam ruling (codex, source-verified against Aztec 5.0.1)**: mined receipts carry only `SUCCESS | REVERTED` with NO error field — REVERTED is unclassifiable and stays the catch-all. Only send-time rejections and dropped receipts carry the validator text `Existing nullifier` (`@aztec/stdlib` validator error_texts; observed as "Invalid tx: Existing nullifier"). The seam is `execution-coordinator.ts:139-147`, before `task.fail`. Optionally also match the simulation-phase strings ("Attempted to emit duplicate [siloed] nullifier"). NO dropped-path typing (would need provenance persisted into the tx row — out of minimal scope).
- **Provenance, not text-matching alone**: any double-spend produces `Existing nullifier` — a false "account initialized elsewhere" on a note collision is worse than the catch-all. The wrap decision at `nulo-account.ts:170-175` is the single source: `buildTxExecutionRequest` return carries `initializesAccount`; threaded through the built-tx/coordinator context; classification fires ONLY when the flag is true.
- **Taxonomy**: journal error kind `duplicate_initialization` (added to `KnownJobErrorKind` + its UI humanization); typed `DuplicateInitializationError` as a `WalletError` registered in `extension-messaging/errors.ts` AND `wallet-sdk/error-envelope.ts` (cross-boundary); the task keeps `error?: string` (no schema change) with the honest copy: "another first transaction initialized this account — wait for network sync, then retry".
- CROSS-CHECK deliberately NOT added (assumption 2). `requiresInitialization` untouched.

### N-21: derive the window budget from the ceremony constant
- `PASSKEY_TIMEOUT_MS = 2 * PASSKEY_TIMEOUT + 60_000` (7 min) — derived, not magic, importing `PASSKEY_TIMEOUT` from spec.ts; doc updated to name the two-leg fallback as the budget driver.
- Pins (codex round 1: the bare constant relationship is shallow — pin the CONSUMER too): (a) the relationship assertion; (b) `openWindowAndWait` drives a mocked `WindowManager.openAndAwait` and the test asserts `timeoutMs === 2 * PASSKEY_TIMEOUT + 60_000` — catches both a constant regression AND `service.ts:120` becoming hard-coded. Restoring 5 min reds both.

### N-28: allSettled + aggregate in start(); handler-gating scoped
- `ServiceCollection.start()`: per phase, `Promise.allSettled`; on any rejection, throw an AggregateError carrying the first error + per-service outcomes (names + reasons) — siblings are always settled (no unhandled rejections, no unobserved in-flight starts), and no later phase runs.
- "Gate handler registration": recon shows the honest gate means touching the messaging-base constructors (listeners hot from construction — a cross-package design change). Proposed scope: OUT for this batch (logged), because (a) the adjudication's fix column says "allSettled + aggregate. S/M." only, (b) the runbook lists gating but the recon-discovered blast radius (every service's transport wiring) exceeds a Low-severity light-tier batch, (c) the journalBootCutoff mitigation already covers the worst symptom. Codex to ratify or overrule.
- Pins (real ServiceCollection, colocated `base/index.test.ts` in wallet-core — codex round 1 KILLED my unhandled-rejection premise: `Promise.all` installs handlers on every input, so a late sibling rejection is handled even today and a process-level spy would be VACUOUS, possibly green pre-fix): (a) start() remains PENDING until every same-phase service settles (deferred B; A rejects fast; assert start() unresolved until B resolves), then rejects with an `AggregateError` naming every rejection; (b) later phases never start; (c) all-green phases unchanged. A code comment documents the ratified limit: survivors' listeners stay live after aggregate failure — allSettled improves the phase barrier + diagnostics, NOT rollback.

## Test plan
- N-15: coordinator-seam pins — (flag true + `Existing nullifier` text → typed error + `duplicate_initialization` kind + honest copy); (flag FALSE + same text → generic — the note-collision false-positive guard); (flag true + other text → generic). Probes: revert the mapping → red; strip the flag gate → the false-positive pin reds.
- N-21: the two pins above. Probe: restore the 5-min constant → both red.
- N-28: the three pins above. Probe: restore `Promise.all` → the settle-before-throw pin reds (start() rejects while B is still pending).

## Decision ledger (light tier — codex round 1: APPROVE-WITH-CHANGES, all five adopted)
1. Seam corrected: send-time only (mined receipts carry no error field — REVERTED unclassifiable); dropped-path typing out (needs persisted provenance).
2. Text-matching alone rejected — `initializesAccount` provenance flag threaded from the wrap decision; classification gated on it (note-collision false-positive guard).
3. Taxonomy specified: journal `duplicate_initialization` kind + humanization; `WalletError`-registered typed error (extension-messaging + wallet-sdk envelope); task copy honest and user-actionable ("wait for network sync, then retry").
4. N-21 consumer pin added (mocked `WindowManager.openAndAwait` asserting the passed `timeoutMs`).
5. My N-28 unhandled-rejection premise was WRONG (Promise.all handles all inputs) — pin replaced with settle-before-throw + AggregateError contents; listener-gating scope cut RATIFIED with the no-rollback limit documented in code.
- Ratified: solo network e2e REQUIRED (N-15 touches dApp/network submission behavior); the 7-min derivation; the N-28 scope cut.

## Validation gates
audit:vue → armed smoke → network e2e IF codex rules N-15's seam touches dApp/network behavior (the typed error rides the tx-status path — likely yes, run it). Then max review → codex fix loop → PR → gates → sign-off → merge. THEN: pipeline close-out (index, lessons, AFK report).

## Out of scope (logged)
- N-15 pre-flight cross-check (rejected pattern; recon assumption 2).
- N-28 transport-listener gating (blast radius exceeds the batch; symptom-mitigated; codex to ratify).
- PATH-B production wiring (N-21 stays latent by design).
