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

### N-15: typed duplicate-nullifier classification (no new node round-trips)
- New `DuplicateInitializationError` (typed, in `aztec-runtime/src/account/` or the extension's execution error taxonomy — wherever the failure is OBSERVED; recon says the observation point is the tx execution result path).
- Detection: at the inclusion-failure classification seam, match the node/sequencer's duplicate-nullifier rejection shape (the error string/code Aztec returns for a duplicate private initialization nullifier) → map to the typed error → the journal/task error carries a distinct kind + honest message ("account already initialized — likely a concurrent first transaction; retry without re-initializing") instead of the AppLogicReverted catch-all.
- CROSS-CHECK deliberately NOT added (assumption 2). requiresInitialization untouched.
- Codex question: where exactly is the classification seam (send-path error mapping vs tx-status polling), and what is Aztec 5.0's actual duplicate-nullifier error shape? Implementation resolves against the real dep.

### N-21: derive the window budget from the ceremony constant
- `PASSKEY_TIMEOUT_MS = 2 * PASSKEY_TIMEOUT + 60_000` (7 min) — derived, not magic, importing `PASSKEY_TIMEOUT` from spec.ts; doc updated to name the two-leg fallback as the budget driver.
- Pin: a unit test asserting the relationship (`PASSKEY_TIMEOUT_MS >= 2*PASSKEY_TIMEOUT + slack`) so a future edit to either constant that re-opens the race reds. (Constant-relationship pins are shallow but exactly right for a latent-path budget invariant.)

### N-28: allSettled + aggregate in start(); handler-gating scoped
- `ServiceCollection.start()`: per phase, `Promise.allSettled`; on any rejection, throw an AggregateError carrying the first error + per-service outcomes (names + reasons) — siblings are always settled (no unhandled rejections, no unobserved in-flight starts), and no later phase runs.
- "Gate handler registration": recon shows the honest gate means touching the messaging-base constructors (listeners hot from construction — a cross-package design change). Proposed scope: OUT for this batch (logged), because (a) the adjudication's fix column says "allSettled + aggregate. S/M." only, (b) the runbook lists gating but the recon-discovered blast radius (every service's transport wiring) exceeds a Low-severity light-tier batch, (c) the journalBootCutoff mitigation already covers the worst symptom. Codex to ratify or overrule.
- Pins (composition-style, real ServiceCollection): phase with A-rejects-fast + B-still-pending → start() rejects AFTER B settles, aggregate names both; B-rejects-late → no unhandled rejection (process handler spy); later phase never starts; all-green phases unchanged.

## Test plan
- N-15: unit pin at the classification seam — feed the duplicate-nullifier error shape → typed error + distinct journal kind; catch-all preserved for other reverts. Probe: revert the mapping → red.
- N-21: relationship pin. Probe: restore 5-min constant → red.
- N-28: the three composition pins above. Probe: restore Promise.all → late-rejection pin reds.

## Validation gates
audit:vue → armed smoke → network e2e IF codex rules N-15's seam touches dApp/network behavior (the typed error rides the tx-status path — likely yes, run it). Then max review → codex fix loop → PR → gates → sign-off → merge. THEN: pipeline close-out (index, lessons, AFK report).

## Out of scope (logged)
- N-15 pre-flight cross-check (rejected pattern; recon assumption 2).
- N-28 transport-listener gating (blast radius exceeds the batch; symptom-mitigated; codex to ratify).
- PATH-B production wiring (N-21 stays latent by design).
