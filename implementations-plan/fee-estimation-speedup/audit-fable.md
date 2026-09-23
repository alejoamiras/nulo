# audit-fable.md — fee-estimation-speedup

## Round 1 — fresh Plan agent (Fable), full packet (both outlines + recon.md), all claims re-verified against source

- **Verdict**: `conditional approve` (4 conditions + 6 advisories; Phase 1 unconditional; outline B rejected as current path, correctly positioned as measurement-gated convergence target)
- Cross-audit note: fable independently confirmed codex's authwit-widening finding (its F-1 = codex Critical 2) and additionally proved the fold's sim-count benefit is ZERO in conservative mode (F-2). Fable did NOT catch codex's PrivateFPC gas-envelope finding (it approved Phase 3 "as designed") — the two audits are complementary; consolidation takes the union.

### Disposition (consolidated with codex round 1 — see audit-codex.md)

| Finding | Disposition in plan rev 2 |
|---|---|
| F-1 (HIGH) discovery fold widens auto-sign surface (malicious user-registered FPC: loud failure → silent signed authwit); equivalence fixtures can't catch it | **Adopted via deferral** — the pipeline fold does NOT ship in this plan; the follow-up must resolve F-1 via option (a) app-only sim A (recorded as chosen direction) + adversarial-FPC fixture |
| F-2 (HIGH) fold saves 0 sims in conservative mode; goal table mis-attributed the −1; PR C bundled riskiest change with zero benefit; reuse verified independent of fold | **Adopted** — goal table corrected; fold deferred; reuse decoupled; runner/extractor split + stub-arg threading kept as mechanical prep |
| F-3 (MED) reuse entry must carry `txCalls` + `pendingPublicAuthwits` (recordPendingAuthwits-on-hit else silent auth-registry gap); never cache live handles | **Adopted** — exact field list pinned in Phase 4; dedicated test required (matches codex F3) |
| F-4 (MED) fingerprint scope: post-planner/pre-discovery/pre-payload action set; include `op.fee` FeeOptions; bind executionMode + opts.from | **Adopted** (matches codex F2; superset of it) |
| F-5 (MED) `estimateId` on shared wire type is dApp-reachable; matching forged id could evict a live entry (delete-before-validate) | **Adopted, strengthened** — `estimateId` dropped from `Operation` entirely; rides a popup-privileged `approveInteraction` envelope (per-op id array); consume validates ownership before delete (matches codex boundary critique) |
| F-6 (MED) cancel registry: profile ownership principal, collision rejection, TTL sweep, cancel-evicts-stash | **Adopted** (matches codex A3) |
| F-7 (LOW/MED) collapse must not literally mirror fjwc finalize args (multiplier double-apply / customLimits behavior change); document limit-context shift | **Adopted** — Phase 3 spec pins exact finalize args + invariant header |
| F-8 restate inference 1 as design guarantee ("sim A output feeds extraction only") | **Adopted** (moot this plan — fold deferred — recorded for follow-up) |
| F-9 fold needs its own network-e2e milestone if it ships | **Adopted into follow-up charter** |
| F-10 evict reuse entries on interaction reject/window close; signed-artifact retention surfaced as explicit posture line | **Adopted** — reject-time eviction in Phase 4; retention Ask added |
| F-11 record never-rebuilt-final-splice fact (shipped pipeline never delivered post-sim maxFee into built bytes) in new fpc-strategy header + Decision 6 doc | **Adopted** |
| Boundary: `FeeStrategyContext.discovery` leaks dApp concern into strategies → prefer decorator (`DiscoveryAwareEstimator`) owned by dapp-send-executor | **Adopted into follow-up charter** (fold deferred) |
| A-vs-B: A decisively, minus fold; sim-B stance is not cowardice (cuts 3→2, defers 2→1 pending data); upstream disagrees with itself on padding (wallets 10%, aztec-kit 0) — argument FOR measuring | **Adopted** — B formally rejected in ledger |

### Verbatim report

(paths rewritten repo-relative per repo policy)

---

**Scope**: `plan.md` main draft (outline A) + appendix outline B, cross-checked against `recon.md` and the actual source. Every claim below was re-verified in the worktree.

**Verification summary** — recon.md is accurate. Spot-checks confirmed: the FPC two-pass shape and its audit-pinned mutation discipline (`fee/fpc-strategy.ts:42-81`); `SimulateTxFn` dropping the stub arg (`fee/fee-strategy.ts:74-79`, `execution-coordinator.ts:92-108` calls `pxe.simulateTx(txRequest, opts)` with no third arg); the discovery pre-pass with hardcoded `PREEXISTING_FEE_JUICE` (`authwit-discoverer.ts:77`) and stubbed sim (`:90-99`); zero-reuse dApp confirm (`dapp-send-executor.ts:415-434`); both handlers' zero-arg payloads (`fpc/handlers/private-fpc-handler.ts:23-32`, `default-sponsored-fpc-handler.ts:18-27`; the `IFpcHandler` interface does declare `(fpc, account, maxFee)` — `handlers/index.ts:11` — impls elide params via structural typing); `[SYNC-DEBUG]` blocks (`packages/aztec-runtime/src/pxe/service.ts:415-424, 452-459` — note both fire *inside* the exclusive write lock, so deletion also shortens lock hold, a bonus the plan doesn't claim); `completeFeeOptions({forEstimation:true})` unconditional (`nulo-account.ts:133-137`); `GasSettings.forEstimation` + `TxSimulationResult.offchainEffects`/`gasUsed` at 5.0.1; `skipKernels=true` upstream default (`@aztec/pxe/src/pxe.ts:1201`); upstream `EmbeddedWallet.sendTx` single-stub-sim shape with `DEFAULT_ESTIMATED_GAS_PADDING = 0.1` (`@aztec/wallets/src/embedded/embedded_wallet.ts:96,160-207`); `cancelJob` journal- and profile-gated (`execution-lane.ts:148-193`); `estimateId` on the wire type, popup-index-keyed estimates, fire-and-forget `approveInteraction` (`fee.ts`, `execute/index.vue:127`, `dapp-interaction/service.ts:94-110`); the reuse ladder incl. delete-before-validate single-shot (`transfer-estimate-reuse.ts:137-140`); the stash pattern (`transfer-executor.ts:270-317`); Action kinds match the plan's fingerprint switch list.

One verification *bonus* for the plan: today's FPC Pass-2 build is never rebuilt after the final `splice` (`fpc-strategy.ts:64-78`) — the returned `txRequest` already embeds the *Pass-1* `maxFee` in the payload args. Since both shipped handlers take `args: []`, this is inert — meaning the shipped pipeline has **never** delivered a post-sim `maxFee` into built bytes. The collapse's "placeholder maxFee is provably inert" claim is therefore not just true, it's the status quo. Decision 6's doc comment should record this (see F-11).

### 1. Adversarial / security review

**F-1 (HIGH) — The discovery fold widens the auto-sign surface: a malicious or merely nonstandard registered FPC converts "loud estimation failure" into "silently signed authwit"**

The plan's security section claims "The fold must not widen what gets auto-signed" while architecture §2 builds sim A "with the *real* payment method and FPC payload" and inference 3 celebrates the result as "superset-faithful." Those two statements are in direct tension, and the superset direction is exactly the attack surface:

- **Today**: discovery builds with `PREEXISTING_FEE_JUICE` and *no fee payload* (`authwit-discoverer.ts:77`). The FPC's calls never execute during the stubbed sim, so no FPC-originated `CallAuthorizationRequest` can ever be discovered. If an FPC's `pay_fee` internally needed an authwit (e.g. it routes a `token.transfer(user → X, amt)` where the token macro emits a `CallAuthorizationRequest`), the *unstubbed, validated* Pass-2 sim fails on `verify_private_authwit` and estimation errors out loudly. Failure mode: annoying, safe.
- **After the fold**: sim A is stubbed + `skipTxValidation` + *includes the payload*. Any `CallAuthorizationRequest` the FPC's subtree emits is extracted, `computeAuthWitMessageHash`'d, spliced as an `add_private_authwit` action, and **signed by `account.createAuthWit` in the rebuild** — then sim B passes (the authwit is now attached), and the confirm tx executes the FPC's transfer with the wallet's blessing. Failure mode: silent token exfiltration dressed as fee payment.

The principal here is not the dApp (feeSettings come from wallet UI) — it's a **user-registered FPC**. The settings surface exists (`popup/components/modules/settings/fpcs/`), and `PrivateFpcHandler.validateArtifact` only checks that `pay_fee` exists with zero params/returns (`private-fpc-handler.ts:8-21`) — it says nothing about what `pay_fee` *does*. Inference 2 ("FPC payloads never require caller authwits") is empirically true for the two shipped contracts and completely unenforced for the class. The plan simultaneously keeps the `IFpcHandler` `maxFee` param *because* future FPCs may be budget-checking (Decision 6) and assumes no FPC will ever emit an authorization request (Inference 2). Pick one.

The Phase-4 "discovery-equivalence" test cannot catch this: it asserts "equal on fixtures," and fixtures are the well-behaved shipped FPCs. The widening only manifests on the adversarial fixture the plan doesn't include.

Note upstream (`embedded_wallet.ts:178-196`) does auto-sign everything the stubbed sim asks for, payload included — but the embedded wallet's operator *is* the dApp; there is no third-party-FPC registry in that threat model. Nulo's is different.

**Required resolution (any one):**
(a) Build sim A *without* the FPC fee payload (payment-method faithfulness — `EXTERNAL` vs `PREEXISTING_FEE_JUICE` entrypoint flag — can still be fixed; the entrypoint wrapper itself introduces no third-party calls). This preserves today's fail-loud property with zero sim-count cost, and the "faithful request" it gives up solves a problem no one has observed (see F-2).
(b) Keep the payload in sim A but fail closed: any discovered effect whose emitting `contractAddress` is not attributable to the user-approved action set aborts estimation with an explicit "this FPC requires an authorization the wallet will not auto-sign" error. (Attribution is hard in general — consumer is the token, not the FPC — so (a) is the cleaner fix.)
(c) Owner explicitly accepts the risk, recorded in the plan's threat model with the malicious-registered-FPC principal added, plus an adversarial-FPC test pinning whatever gate is chosen.

**F-2 (HIGH, planning integrity) — Phase 4 saves zero simulations; the plan's table attributes the fpc −1 to it anyway**

Recompute honestly: after Phase 3 (collapse) alone, dApp `fpc` estimate = discovery sim (1) + collapsed strategy sim (1) = **2**. After Phase 4, sim A + sim B = **2**. For `fj`: 2 → 2. The goal table's "dApp op estimate 3→2, mechanism: collapse + discovery fold (Phases 3–4)" and architecture §2's "−1 for `fpc` (3→2)" attribute to the fold a reduction the collapse already delivered. Conservative-mode Phase 4's actual deliverables are: one fewer `buildStandard` (cheap — no sim), a "faithful" discovery request (of negative security value per F-1, solving no observed bug), and being the enabler for a stretch mode the plan itself defers pending Phase-6 measurement.

So PR C bundles the single riskiest change in the plan (rewiring the authorization-discovery pipeline through every strategy) with **zero measured user-facing benefit today**, alongside Phase 5 (the biggest win, 3→0 on confirm) which — I verified — does *not* depend on it: `executeAztecSendTx`'s consume-hit path skips "discovery + buildAndEstimate" identically whether discovery is standalone or folded, and the consume-miss fallback is 2 sims either way.

**Recommendation**: ship Phases 0–3 + 5 (all of the sim wins: send 2→1, dApp estimate 3→2, dApp confirm 3→0). Defer the pipeline fold to the measurement-gated follow-up, where — if Phase-6 data supports stub gas — it lands as the B-lite single-stub-sim shape and actually pays for itself. Keeping now, as mechanical prep: the `SimulateTxFn`/coordinator `stubAccountAddresses` threading and the runner/extractor split (pure refactor, independently testable). This also un-bundles PR C.

**F-3 (MEDIUM) — Reuse-entry completeness for the dApp path: `pendingPublicAuthwits` and `txCalls` are load-bearing, live handles are poison**

Architecture §3 says "Same snapshot fields" as the transfer entry. Not sufficient. On a reuse hit, `executeAztecSendTx`'s post-send tail must still run `addTransaction(txCalls, nonce, feePaymentMethod, ...)` **and** `recordPendingAuthwits(pendingPublicAuthwits, hash)` (`dapp-send-executor.ts:453-470`). The transfer entry substitutes an activity-shaped `{token, fnName, args}` triple and has no public-authwit concept. If the Operation entry omits `pendingPublicAuthwits`, a reuse-hit tx that grants a public authwit lands on-chain with **no auth-registry row** — a silent security-bookkeeping break no existing test covers. Conversely, the entry must *not* cache `pxe`/`node`/`account`/`network` handles (the transfer path deliberately re-resolves all four at consume, `transfer-executor.ts:172-176` — the cross-profile fail-closed property depends on it). Spell the exact field list in Phase 5 before implementation, and pin recordPendingAuthwits-on-reuse-hit with a test.

**F-4 (MEDIUM) — Fingerprint scope is underspecified in three ways that matter**

1. **Which `Action[]`**: for `aztec_sendTx` the actions are planner-derived (`processAztecJsPayload`), then discovery splices authwit actions, then the strategy prepends the fee payload. The fingerprint must be over the **post-planner, pre-discovery, pre-payload** set on both sides (stash and consume re-derivation), or every consume misses (fail-safe but benefit-destroying) — and this invariant is nowhere stated.
2. **`FeeOptions`**: `detectedFee` from the payload (`gasLimits`, `maxFeesPerGas`, `gasPadding`, `embeddedFeePayment`) shapes the build via `suggestGasLimits`/`finalizeGasLimits`. `fingerprintFeeSettings` covers wallet fee settings only. A drifted `op.fee` between estimate and confirm would reuse a request built under different gas constraints. Include it.
3. **`executionMode` / `opts.from`**: eligibility excludes `default_entrypoint`, but the fingerprint should still bind mode and `from` so an entry can never be consumed across shapes.

**F-5 (MEDIUM) — `estimateId` on the shared wire type is dApp-reachable; strip it at the boundary**

`Operation` lives in `packages/wallet-bridge/src/operation.ts` and `dapp-interaction-protocol.ts` derives dApp request types from it via `Omit` of `SendParams` only. The execute window materializes UI ops by spreading the **dApp-supplied** payload (`execute/index.vue:213`) and approve re-spreads into the executable array (`:356`). An optional `estimateId` on the Operation shape therefore rides dApp → popup → approve unless the popup overwrites it on every op. Consequences are bounded — a forged id is a guaranteed fingerprint miss, and guessing a live SW-minted UUID is infeasible — but note the ladder's **delete-before-validate** single-shot (`transfer-estimate-reuse.ts:139`) means a *matching* forged id would evict a live entry (theoretical eviction DoS). Fix cheaply: keep the field off the dApp-facing types and have the popup unconditionally set-or-delete it. The plan's "untrusted hint" stance is correct but should be enforced at the type/boundary level, not just at consume.

**F-6 (MEDIUM) — Cancellation registry: four small gaps, all cheap to close**

- **No ownership principal**: `cancelJob`'s gate is the journal record's `profileId` (`execution-lane.ts:159-163`). Estimates have no journal record. Record `profileId` at registration; `cancelEstimate` checks the active profile; unknown/foreign tokens no-op silently (existence non-disclosure, same as cancelJob).
- **Caller-minted tokens can collide**: registry should reject re-registration of an active token rather than letting a second estimate's completion clear a first's entry. Worst case is self-DoS, but pin it.
- **No TTL sweep**: an estimate that hangs on a dead RPC leaks its `AbortController` until SW restart. Mirror the reuse cache's opportunistic eviction.
- **Cancel-after-complete should evict the stashed reuse entry**: cancel-on-refire will often race estimate completion; `cancelEstimate` should abort-if-running *and* evict-if-stashed. Related (F-10): reuse entries are not evicted on interaction reject/window close — a fully signed dApp tx request lingers ≤5 min in SW memory. Send-page precedent exists; extending that retention posture to dApp ops deserves one explicit line in the plan (and reject-time eviction is nearly free).

**F-7 (LOW/MEDIUM) — FPC collapse: "mirrors fjwc" must not be taken literally**

- fjwc's finalize is `finalizeGasLimits(node, txReq, sim, padding, undefined, ctx.op.fee, ctx.feeMultiplier)` (`fee-juice-with-claim-strategy.ts:37`); FPC's is `finalizeGasLimits(node, txReq, sim, padding, baseFees)` with the multiplier pre-baked into `baseFees` and **no customLimits** (`fpc-strategy.ts:58,79`). Copying fjwc's arg list would double-apply the multiplier path and newly honor `op.fee.gasLimits` in the final settings — a behavior change for dApp-supplied fee options under `fpc`.
- Decide explicitly whether the collapsed single sim keeps Pass 1's `suggestGasLimits(txRequest, ctx.op.fee)` pre-sim override.
- Context shift: today's Pass-2 sim runs under tight Pass-1-derived limits; the collapsed sim runs under `forEstimation`'s huge limits and `currentMinFees×1.5` maxFees instead of `predictedWorst×multiplier`. Gas metering is limit-insensitive for the shipped contracts, but a budget-asserting `fpc`-kind contract would now fail estimation loudly where the two-pass might have passed. Fail-loud is acceptable — document it next to the new invariant header.

**Reuse cache — remaining checks that pass**: Poisoning requires SW compromise (out of scope). Replay: single-shot + fingerprint + `pendingHashes`. Cross-profile/account: profile ladder step + consume-time re-resolution (contingent on F-3's no-live-handles rule). Same-batch drift: `recordTransaction` is awaited inside `proveAndSend` before it resolves (`execution-coordinator.ts:176-177`) and `executeOperations` is sequential, so op #1's pending hash is visible to op #2's consume — the dedicated test pins the remaining assumption. Estimate-unslotted/confirm-slotted asymmetry: consume-inside-`runInSlot` is specified. Nonce: estimate-time nonce reuse matches shipped Send behavior.

### 2. Assumption attack

**Facts**: all ten check out. Two presentation defects: the goal table's fold attribution (F-2) — the only place the plan's numbers don't survive re-derivation; and fact 6/9 eliding that `approveInteraction` carries the dApp-shared `Operation` type (F-5 exposure).

**Inferences**: Inference 1 — moot as stated and mislabeled; sim A's `gasUsed` is never consumed in conservative mode; restate as design guarantee ("sim A output feeds extraction only") or an implementer will add the fast-path "because the plan says it's covered". Inference 2 — unsafe as a class invariant (see F-1); internally inconsistent with Decision 6's future-FPC rationale. Inference 3 — the "superset" direction is the cost, not the win; "equal on our fixtures" is unfalsifiable against the adversarial case by construction. Inference 4 — holds; strengthened by the never-rebuilt-final-splice observation. Inference 5 — properly hedged.

**Asks (missing)**: (1) payload-in-discovery-sim decision (F-1) — an authorization-surface decision the owner must make; (2) fold-now-vs-defer (F-2) — distinct from PR ordering; (3) signed-artifact retention for dApp ops (F-10).

### 3. Implementation critique

Right overall structure, mostly: the collapse is genuinely near-vestigial-code-removal [NB: superseded by codex's PrivateFPC envelope finding — collapse is Sponsored-only]; the reuse generalization correctly reuses the audited ladder; deletion-over-flag-gating is right (both blocks additionally sit inside the write lock); unit-layer sim-count pins are the correct altitude.

**Wrong boundary: `FeeStrategyContext.discovery`** — injecting an extractor hook makes every payment strategy grow dApp-orchestration branching for a feature only the dApp path uses. If the fold survives, invert it: a `DiscoveryAwareEstimator` decorator around `buildAndEstimate`, owned by `dapp-send-executor` — strategies stay payment-only, the send path provably cannot pick up discovery behavior by accident. `SimulateTxFn` opts growth is fine. `Operation.estimateId` leaks per F-5.

**A vs B**: A, decisively — but A-minus-fold. B concentrates every risk the repo has explicitly fenced (stub-gas sizing against a documented prohibition, all-four-strategy rewrite including the delicate embedded/budget-capped path, one unreviewable PR). Its premise ("stub deltas ≪ pad") is precisely what Phase 6 measures — and upstream can't agree with itself on the margin (wallets pad 10%, aztec-kit 0), an argument FOR measuring. The conservative sim-B stance is not cowardice: the plan cuts 3→2 and defers 2→1 pending data; spinner seconds vs user-visible dropped-at-inclusion txs. The one incoherence is keeping conservative Phase 4 now: it imports B's sharpest surface while capturing none of B's win. The fold belongs in the follow-up.

**Phase ordering / PR mapping**: A (0–2) good; B (Phase 3) good with the canary-pair milestone; C must split fold from reuse (verified independent). If the fold ever ships, it needs its own network-e2e milestone. Phase 2's "cannot kill an in-flight ACVM run" honesty is correct.

**Duplication/reuse check**: no violations; the plan consumes every recon reuse-as-is item. The fjwc-mirroring shorthand is the one place "reuse" would produce a wrong result if applied literally (F-7).

### 4. Verdict

**Conditional approve** — conditions: (1) resolve F-1 before any fold implementation (app-only sim A recommended; adversarial-FPC fixture required); (2) correct the sim-count attribution, decouple reuse from fold, surface fold-deferral as an Ask; (3) pin the reuse-entry field list (incl. `txCalls` + `pendingPublicAuthwits`, no live handles) + fingerprint scope before Phase-5 implementation; (4) keep `estimateId` off dApp-facing types and strip/overwrite at the popup boundary. Advisory: F-6, F-7, F-8, F-9, F-10, F-11. Phases 0–3 and 5 approved as designed subject to conditions 3–4; Phase 1 unconditional; outline B rejected as current path.
