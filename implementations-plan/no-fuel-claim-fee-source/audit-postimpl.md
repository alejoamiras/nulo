# Post-implementation audit — no-fuel-claim-fee-source

## Codex availability
The codex post-impl audit was attempted **twice** (`xhigh`, sessions PMO6C7nV + FPHWy2kt). Both runs read the diff/files for ~15-17 min then **STALLED mid-synthesis** — the process lingered (1h27m on the first) with no log write and no `response.md` ever produced. This is a codex CLI/service stall today (independent of prompt size — the retry used a tight ≤350-word, 4-vector prompt). Per the loop's stuck-policy, retrying was stopped after two hangs and the audit is **substituted by a documented self-audit** below (precedent: aztec-5.0-upgrade ran an independent plan when fable was unavailable). Re-run codex when the service recovers; the attack vectors are recorded so it can resume.

## Pre-codex `/code-review max` (autonomous self-review)
All 12 changed files reviewed at max effort: **no correctness bugs, no fixes to apply** (biome auto-fixes were applied inline during implementation). The new pure `decideNoFuelFeeSource` is correct + unit-tested (8 cases); fail-closed reads distinguish unread from zero; the codex-C cache is opportunistic with a proven-path fallback; the manifest scoping is artifact-verified; the primitive is live-proven.

## Self-audit of the 4 attack vectors

**Verdict: no high/critical.**

### 1. codex-C cache (`useDeposit.ts` simulate/send) — SOUND
- **teardown=0 with `gasLimits = gasUsed.totalGas.mul(1.2)`:** correct. A no-fuel claim is `claim_public/private` + the `pay_fee` SETUP call; `FPCFeePaymentMethod` does NOT refund → no teardown phase. The live proof settled with teardown=0 (the script's no-fuel-spend used the same). `totalGas` is the right gasLimits basis; 1.2× is the SDK's own recommended pad (`interaction_options.d.ts:175` "pad `totalGas`").
- **caching only the first successful sim:** the first POST-PXE-SYNC simulate is the real claim execution (deterministic gasUsed); no anomalous-low path. Fine.
- **Residual (LOW):** if the cache activates AND `totalGas×1.2` under-budgets a fee-spike, the tx could out-of-gas. Bounded by the 1.2× pad + the fact that when the cache does NOT activate (gasUsed absent cross-RPC) it falls back to the proven tentative shape. Acceptable.

### 2. Manifest spend authority (`PrivateFPC.pay_fee` in `transaction.scope`) — ACCEPTABLE
- Grants the faucet origin the ability to spend the user's private FJ. **Backstop: every `aztec_sendTx` is user-APPROVED in the wallet's execute popup** (shows the tx + fee payer) — no silent spend. The scope is a NAMED function on the PINNED PrivateFPC (no wildcard), the same authz shape as the already-scoped `mint_and_pay_fee`. A compromised faucet frontend can only spend what the user approves. No NEW hole beyond the existing FPC scope. Testnet-only; re-evaluate before any mainnet exposure (→ `/harden security`).

### 3. Fail-closed asymmetry (claim-time CLOSED vs pre-deposit OPEN) — INTENTIONAL + SOUND
- The claim-time gate is AUTHORITATIVE (decides the real payment) → fail-closed prevents a wrong-source / wasted proof. The pre-deposit gate is ADVISORY (a pre-bridge warning) → fail-open (benefit of the doubt) avoids blocking a bridge when a read blips; the claim-time gate re-checks. No PERMANENT strand: if a read is failing at claim time, the journal retries the claim until the read recovers (tokens stay claimable). Defensible.

### 4. Live-coverage gap (cache path not live-tested) — ACCEPTABLE for `light`
- The live fuel-testnet proved the PRIMITIVE (`privateFeeJuicePayment` + explicit gasSettings settles, FPC 295.14→292.84 FJ). The faucet CACHE path (simulate→gasUsed→commit) is typecheck-only. **Bounded by the proven fallback:** if `gasUsed` doesn't cross the dApp simulate boundary, the send uses the tentative shape = the proven primitive. The full cache path is covered by the user's manual UI run + the documented e2e follow-up (needs the cluster-A+B FPC-balance fixture).

## Misc (LOW, no action)
- `fmtFj` uses `Number(x)/1e18` → imprecise last digits on huge bigints; cosmetic (user-facing balance message only).
- Conservative gate ≈ live × 2M l2Gas ≈ 6 FJ vs actual ~2.3 FJ (≈2.6×) — over-gates the SOURCE decision, but users hold hundreds of FJ post-claim (live: 295 FJ), so no real false-block; never under-gates.
- `_nonce: 0` self-transfer in the script — proven live (exit 0).

## Outcome
No high/critical. No code changes required. The feature is unit-tested (8 decision + 2 manifest + primitive pins), live-proven (pay_fee settles on V5), and gate-green (faucet 347 · bridge-core 116 · lint 0). Open item: re-run codex post-impl when the service recovers (vectors above).
