# Plan v2 — post-audit consolidation

**Auditors converged on three big corrections** from plan v1 (`plan.md`):

| Phase | v1 recommendation | v2 (after audits) | Reasoning |
|-------|-------------------|-------------------|-----------|
| C | Drop re-export | **Drop re-export** ✅ unchanged | both agreed ship as-is |
| A | A1 (drop entirely) | **A2 (consolidate)** | both auditors caught A1 is regression-prone |
| B | Ship normalizer | **Skip**, document why | both auditors flagged correctness issues |

Codex session: `019e1912-ae66-7f72-829b-1762a8e84f1d`
Opus 4.7 review (single round, in-context).

## What changed and why

### Phase A correction — the override is NOT dead code, and A1 would regress multiple paths

My v1 plan said: "post-PR-8c-followup, `completeFeeOptions` defaults `maxFeesPerGas = minFees * 1.5`, so the override at 4 sites is probably redundant." That was wrong on two counts:

**1. The override's purpose changed; the comment didn't.** Post-PR-8c-followup, the override no longer protects against `10^18` defaults (those are gone). It now does two things:
- Caps `maxFeesPerGas` to `1.0x minFees` (vs `completeFeeOptions`'s `1.5x` default) — aligns with dApps that budget against `getCurrentMinFees()` directly. This is the upstream-recommended pattern in aztec.js fee-juice examples for `FeeJuicePaymentMethodWithClaim` and sponsored-FPC with `claim_and_end_setup`.
- Applies dApp-supplied explicit `maxFeesPerGas` on paths where it isn't otherwise threaded.

**2. Three of the 4 override sites are also the ONLY path where dApp-supplied fees reach the txRequest.** Specifically: `service.ts:1691` (`executeAztecProfileTx`), `service.ts:1824` (`executeNoFromSendTx`), `embedded-strategy.ts:34` (`buildAndEstimate`). Only `executeAztecSimulateTxStandard` threads `gasSettings` through `buildStandard` (we did that in the previous PR). A1 (delete entirely) loses dApp fees on those three paths.

Codex on this:
> "a naive A1 delete is worse than 'just upstream defaults'. On some paths, those override blocks are currently also the only place explicit dApp `maxFeesPerGas` survives"

Opus on this:
> "A1 ships a real regression for any dApp that asked the node for current min fees and budgeted against that, which is the upstream-recommended pattern in aztec.js fee-juice examples."

**Verdict: A2. Consolidate to one helper, fix the stale comments, move on.** Don't aspire to A1 until we have a real dApp signal that the 1.0x cap isn't needed.

### Phase B correction — the proposed normalizer has correctness issues

My v1 plan said: "publicInputs becomes stale but invisible — the dApp never proves the result, only consumes return values." That was wrong on two counts:

**1. `publicInputs.gasUsed` IS dApp-visible.** Upstream `TxSimulationResult.gasUsed` reads `publicInputs.gasUsed` (`simulated_tx.js:65-71`). dApps consume this for fee estimation UI. The normalizer leaves multicall's gasUsed (which includes ctor execution) attached to a tree rooted at the entrypoint subtree. dApp sees over-reported gas.

**2. `firstNullifier` carries init-nullifier semantics.** Multicall init's `firstNullifier` IS the account init nullifier. Carrying it verbatim onto an entrypoint-rooted tree is semantically wrong — the entrypoint subtree's first nullifier is whatever the entrypoint emits first, not the init.

Codex on this:
> "the returned object becomes semantically mixed: projected `privateExecutionResult`, but full-multicall `publicInputs` / `publicFunctionCalldata`. That is observable through the public API."

Opus on this:
> "publicInputs.gasUsed includes ctor execution gas. The 'normalized' result will over-report gas vs what an already-initialized account would. Not 'invisible'."

**Verdict: Skip Phase B in this PR.** Document the trade-off clearly. The 3-5s saving on first-tx-only-mixed sims doesn't justify shipping a subtly wrong tree projection. If we ever ship it, we'd need to:
- Strip ctor gas from the synthesized publicInputs (non-trivial — kernel circuit output isn't trivially partitionable)
- Recompute `firstNullifier` from the entrypoint subtree, or document the divergence
- Add mandatory e2e coverage (unit tests against synthetic trees won't catch upstream tree-shape drift)

### Phase C — no change

Both auditors agreed: ship. Mechanical rename. Opus pinned: "the plan's '18 files / 31 occurrences' should be pinned to an exact number before PR". Will verify with a single grep.

---

## Final plan (v2)

### Order

C (rename) → A (consolidate override) → (B skipped, document)

Bundle as one PR with two commits OR two separate PRs. Given C is mechanical and A is a clean consolidation, one PR is fine. Phase B's "skip + document" change is doc-only and can ride along.

### Phase C — `NuloFeePaymentMethod` rename

**Action**: delete the re-export at `packages/aztec-runtime/src/account/index.ts`. Replace `NuloFeePaymentMethod.{External,FeeJuice,FeeJuiceWithClaim}` with `AccountFeePaymentMethodOptions.{EXTERNAL,PREEXISTING_FEE_JUICE,FEE_JUICE_WITH_CLAIM}` across the codebase.

**Pre-PR step**: run `grep -rn "NuloFeePaymentMethod" packages --include='*.ts' --include='*.vue' | grep -v node_modules | wc -l` to pin the exact occurrence count before opening the PR.

**Tests**: existing tests cover. No new tests.

### Phase A — consolidate the embedded-FPC `maxFeesPerGas` cap to one helper

**Action**: extract a helper to a new file `packages/extension/src/wallet/services/execution/fee/embedded-fpc-cap.ts`:

```ts
/**
 * Apply the Nulo-specific embedded-FPC `maxFeesPerGas` cap on the
 * tx-request's gas settings.
 *
 * Why this exists: an embedded FPC has a budgeted `amount` that must
 * cover `gasLimits * maxFeesPerGas`. By default `completeFeeOptions`
 * sets `maxFeesPerGas = node.getCurrentMinFees().mul(1.5)` (the same
 * pattern upstream uses). dApps that build embedded fee payments
 * (`FeeJuicePaymentMethodWithClaim`, sponsored-FPC with
 * `claim_and_end_setup`) typically derive their budget from
 * `node.getCurrentMinFees()` directly — without the `*1.5` padding. So
 * the default would force them to over-budget.
 *
 * This helper caps `maxFeesPerGas` to `1.0x minFees` when there's an
 * embedded fee payment AND the dApp didn't supply explicit fees. It
 * ALSO ensures dApp-supplied explicit `maxFeesPerGas` survives on
 * non-sim paths (profileTx, executeNoFromSendTx, embedded-strategy)
 * where `gasSettings` isn't yet threaded through `buildStandard`.
 *
 * No-op when `fee.embeddedFeePayment` is undefined.
 */
export async function applyEmbeddedFpcGasCap(
  txRequest: TxExecutionRequest,
  fee: FeeOptions,
  node: AztecNode,
): Promise<void> {
  if (!fee.embeddedFeePayment) return
  const maxFeesPerGas = fee.maxFeesPerGas
    ? new GasFees(BigInt(fee.maxFeesPerGas.feePerDaGas), BigInt(fee.maxFeesPerGas.feePerL2Gas))
    : await node.getCurrentMinFees()
  txRequest.txContext.gasSettings = new GasSettings(
    txRequest.txContext.gasSettings.gasLimits,
    txRequest.txContext.gasSettings.teardownGasLimits,
    maxFeesPerGas,
    txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
  )
}
```

Replace the 4 copies with `await applyEmbeddedFpcGasCap(txRequest, fee, node)`.

**Tests** (3 unit cases, suggested by codex + opus consensus):

1. **`fee.embeddedFeePayment === undefined` → no-op** (early return; gas settings unchanged).
2. **`fee.embeddedFeePayment === "fjwc"` AND `fee.maxFeesPerGas === undefined` → uses `node.getCurrentMinFees()` (no `*1.5` padding); `gasLimits`/`teardownGasLimits`/`maxPriorityFeesPerGas` preserved verbatim.**
3. **`fee.embeddedFeePayment === "fpc"` AND `fee.maxFeesPerGas` provided → uses provided values; `node.getCurrentMinFees()` NOT called.**

These cases were missing in the existing test surface. Codex flagged: "the relevant e2e tests accept both `'ok'` and `'error'`, so they won't catch budget regressions" (`tx-sendTx-feePayer.test.ts:66`, `tx-sendTx-sponsoredFpc.test.ts:68`, `tx-sendTx-default.test.ts:77`). The unit tests fill that gap.

**E2E**: existing tests continue to run. We do NOT tighten them (they accept ok/error for valid reasons — the dApp's FPC budget is its concern, not ours; we just don't want to make it worse).

### Phase B — SKIP, document why

**Action**: add a TRACKED-FOLLOW-UP entry to `wallets-architecture-research/synthesis/implementation-plan-p1-p3.md` describing:
- The optimization we're not doing
- The correctness issues that would need to be solved first (publicInputs.gasUsed staleness, firstNullifier semantic mismatch, upstream tree-shape drift)
- The trigger to revisit: a real dApp pattern that frequently does mixed simulateTx before any send

Update `service.ts` orchestrator comment to be explicit about the trade ("we don't normalize because publicInputs.gasUsed staleness would over-report gas to the dApp").

### Verification gate

1. `typecheck:all` — 8 packages clean
2. `bun run test` — existing + 3 new unit cases (`applyEmbeddedFpcGasCap`)
3. `bun run lint` — only pre-existing warnings
4. `bun run build:full` — chrome + firefox at v0.14.9
5. `bun run e2e:agent` — same/better failure profile than v0.14.8

### Rollback

Each phase is independently revertable:
- Phase C: trivial rename revert
- Phase A: revert the helper extraction; copies were unchanged in behavior

### Open decision questions (now narrowed)

After the audits, only **two** decisions remain for the user:

1. **One PR or two?** I lean ONE PR with Phase C and Phase A as two commits, plus the doc change for Phase B. All low risk, related theme (post-PR-8c cleanup).

2. **For Phase A's stale comment fix, how prescriptive should the new comment be?**
   - Option α: minimal — "caps maxFeesPerGas to 1.0x minFees when no explicit fees; required for embedded-FPC budget alignment"
   - Option β: verbose — explain the specific dApp patterns (FeeJuicePaymentMethodWithClaim, sponsored-FPC with claim_and_end_setup) that depend on it

I lean β because the next person reading this code needs to know WHEN it matters, not just THAT it matters.

The original v1 questions are now resolved:
- ~~C1~~: drop entirely (both auditors agreed)
- ~~A1~~: A2 (both auditors agreed)
- ~~A2 (observability)~~: skip (not worth it)
- ~~B1~~: skip + document (both auditors agreed)
- ~~B2~~: N/A (B skipped)
