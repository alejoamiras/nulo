# Plan — Embedded-FPC override cleanup + First-tx normalizer + `NuloFeePaymentMethod` rename

**Branch**: `feat/embedded-fpc-firsttx-and-cosmetic-cleanup` (off `master` post-merge-of-PR-74)
**Three independent fixes**, can land as one PR or three. Sequencing low risk → high risk.

---

## Phase C — `NuloFeePaymentMethod` rename (lowest risk, lands first)

### What

Drop the `NuloFeePaymentMethod` cosmetic re-export. Use upstream `AccountFeePaymentMethodOptions` directly.

Currently at `packages/aztec-runtime/src/account/index.ts`:

```ts
export const NuloFeePaymentMethod = {
  External: AccountFeePaymentMethodOptions.EXTERNAL,
  FeeJuice: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
  FeeJuiceWithClaim: AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM,
} as const
export type NuloFeePaymentMethod = AccountFeePaymentMethodOptions
```

### Scope

- 31 occurrences across 18 files (verified by grep)
- Identifier renames only:
  - `NuloFeePaymentMethod.External` → `AccountFeePaymentMethodOptions.EXTERNAL`
  - `NuloFeePaymentMethod.FeeJuice` → `AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE`
  - `NuloFeePaymentMethod.FeeJuiceWithClaim` → `AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM`
  - Type imports of `NuloFeePaymentMethod` → `AccountFeePaymentMethodOptions`
- Delete the const + type re-export from `aztec-runtime/src/account/index.ts`

### Files touched (18)

```
packages/aztec-runtime/src/account/index.ts                                  (remove re-export)
packages/extension/src/popup/components/modules/general/GasBalanceCard.vue
packages/extension/src/popup/components/modules/tx/tx-detail-helpers.ts
packages/extension/src/popup/components/modules/tx/tx-detail-helpers.test.ts
packages/extension/src/wallet/utils/fn.ts
packages/extension/src/wallet/services/transaction/service.ts
packages/extension/src/wallet/services/transaction/spec.ts
packages/extension/src/wallet/services/execution/authwit-discoverer.test.ts
packages/extension/src/wallet/services/execution/operation-planner.test.ts
packages/extension/src/wallet/services/execution/tx-request-builder.ts
packages/extension/src/wallet/services/execution/operation-planner.ts
packages/extension/src/wallet/services/execution/service.ts
packages/extension/src/wallet/services/execution/fee/embedded-strategy.ts
packages/extension/src/wallet/services/execution/fee/fpc-strategy.ts
packages/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts
packages/extension/src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts
packages/extension/src/wallet/services/execution/fee/fee-strategy.ts
+ 1 more identified via grep
```

### Tests

- **No new tests**. Purely mechanical rename.
- **Existing tests must keep passing**. The values are identical (same enum constants).

### Risk

- **LOW**. The values are identical; only identifiers change. TypeScript catches any typo.
- TypeScript-narrowing on switch/match statements may need adjustment (we use the enum values, not destructured names).

### Decision required from user

**Question C1**: Drop the re-export entirely vs keep as deprecated alias?

- (a) **Drop entirely** — cleanest. Lean-upstream-default principle. Touches 18 files but mechanical.
- (b) **Keep as `@deprecated` alias** — lowers immediate friction; future PRs can migrate gradually. But the alias persists indefinitely as soft drift.

**Recommendation**: (a). Cleaner. The rename is mechanical, the touched files are stable, and we have the test suite as a safety net.

---

## Phase A — Embedded-FPC override cleanup

### What

Investigate + simplify the embedded-FPC `maxFeesPerGas` cap pattern that appears in 4 places, all with identical comments and logic:

| Site | Path | Lines |
|------|------|-------|
| `service.ts:executeAztecSimulateTxStandard` | (sim path) | ~1640 |
| `service.ts:executeAztecProfileTx` | (profile path) | ~1693 |
| `service.ts:executeNoFromSendTx` | (kernelless send) | ~1834 |
| `fee/embedded-strategy.ts:buildAndEstimate` | (send/prove path) | ~44 |

### Background — why the override exists

**Original problem (pre-PR-8c-followup)**: Standard path used hardcoded `maxFeesPerGas = 10^18`. An embedded FPC has a budgeted `amount` that must cover `gasLimits * maxFeesPerGas`. Against 10^18 this is astronomical → FPC assertion fails. The override capped `maxFeesPerGas` to `node.getCurrentMinFees()` (no padding) when the dApp didn't supply explicit fees.

**Post-PR-8c-followup**: `completeFeeOptions({forEstimation:true})` defaults `maxFeesPerGas = node.getCurrentMinFees() * 1.5`. So:
- WITHOUT override: budget needs ≥ `1.5x minFees * gasLimits`
- WITH override: budget needs ≥ `1.0x minFees * gasLimits`

The override saves the FPC budget ~33% but exposes the tx to revert if minFees rises between sim and send.

### Three possible directions

#### Direction A1 — Drop the override entirely (lean-upstream)

Net effect: embedded FPCs need ~50% more budget than before. dApps already targeting upstream `BaseWallet` budget for `1.5x` so this aligns Nulo's behavior with their expectations.

```diff
- if (fee.embeddedFeePayment) {
-   const maxFeesPerGas = fee.maxFeesPerGas
-     ? new GasFees(BigInt(fee.maxFeesPerGas.feePerDaGas), BigInt(fee.maxFeesPerGas.feePerL2Gas))
-     : await node.getCurrentMinFees()
-   txRequest.txContext.gasSettings = new GasSettings(
-     txRequest.txContext.gasSettings.gasLimits,
-     txRequest.txContext.gasSettings.teardownGasLimits,
-     maxFeesPerGas,
-     txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
-   )
- }
```

**Pros**: 4 sites simplified, ~40 lines deleted, behavior matches upstream wallets exactly.
**Cons**: any dApp that budgeted exactly for `1.0x minFees` now fails. We don't know if such dApps exist; this is a probability question.

#### Direction A2 — Consolidate to a single helper

Keep the behavior, but extract `applyEmbeddedFpcGasCap(txRequest, fee, node)`. 4 sites become 1 helper + 4 calls.

```ts
// new file: packages/extension/src/wallet/services/execution/fee/gas-cap.ts
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

**Pros**: explicit Nulo-specific UX choice documented in one place, behavior unchanged.
**Cons**: still Nulo-local surface — doesn't align with upstream.

#### Direction A3 — Parameterize `completeFeeOptions` with a multiplier override

Add an option to `completeFeeOptions` like `maxFeesPaddingMultiplier?: number` (default 1.5). Embedded-fee callers pass `1.0`. Removes the post-hoc override entirely; just call the translator with the right input.

```diff
// fee-options.ts
export interface CompleteFeeOptionsConfig {
  node: AztecNode
  gasSettings?: PartialGasSettingsRPC
  forEstimation: boolean
+ /** Override the default minFeePadding (0.5 = upstream BaseWallet's value).
+  *  Used by embedded-FPC callers to use no padding (multiplier=1.0) to
+  *  minimize the dApp's FPC budget requirement. */
+ minFeePaddingOverride?: number
}
```

**Pros**: zero post-hoc override sites. The "embedded FPC needs no padding" knowledge lives WITH the gas-settings logic. Cleanest.
**Cons**: `completeFeeOptions` no longer mirrors upstream exactly. Adds a Nulo-specific parameter to what was a pure upstream-faithful helper.

### Tests for Phase A

- **Unit**: `fee-options.test.ts` already covers the translator. Add 1 case if we go A3 (multiplier override branch).
- **Unit**: existing fee-strategy tests cover embedded payments. If we extract a helper (A2), add 1 unit test for it.
- **E2E**:
  - `network/tx-sendTx-feePayer.test.ts` — dApp sets feePayer, tests embedded fpc path
  - `network/tx-sendTx-sponsoredFpc.test.ts` — sponsored FPC (note: this is NOT embedded; this is the FPC-strategy path, different code)
  - `network/tx-sendTx-default.test.ts` — default fee payer flow
- **Manual**: a dApp transaction that uses embedded fee payment with tight FPC budget. If A1 chosen, verify it still works.

### Decision required from user

**Question A1**: Which direction?

- (A1) **Drop entirely** — leanest, may break dApps with tight FPC budgets, hard to know
- (A2) **Consolidate helper** — preserves behavior, easier review, doesn't simplify the architecture
- (A3) **Parameterize translator** — cleanest architecture but Nulo-specific param on a previously-pure-upstream helper

**Recommendation**: I lean **A1** with a fallback to A3 if QA shows real dApp breakage. Reasoning:
1. dApps targeting upstream `BaseWallet` already budget for 1.5x → most dApps already work
2. The override is defensive code for a problem that may no longer exist
3. If a real dApp breaks, the recovery is trivial (call `completeFeeOptions({minFeePaddingOverride: 0})`)
4. ~40 lines deleted, lean-upstream-default principle satisfied

**Question A2**: If we go A1, do we add observability? E.g., log a warning when an embedded-FPC tx would have benefited from the old override (gasLimits * minFees * 0.5 > some threshold). Probably overkill but worth considering.

---

## Phase B — First-tx mixed-payload normalizer

### What

Currently when a dApp does a **mixed** payload `simulateTx` (public-static prefix + non-static remainder) AND the user's account hasn't sent its first tx yet, we skip the fast-path optimization entirely and route through the standard path. The standard path wraps via `DefaultMultiCallEntrypoint`, producing a doubly-nested execution tree (`multicall → [ctor, entrypoint(appCalls)]`) that upstream's flat `appCallOffset` model can't represent.

### Goal

Recover the fast-path optimization for the first-tx mixed case by normalizing the standard arm's `privateExecutionResult` tree before wrap-and-merge.

### Implementation

#### B.1 — Investigation: what dApp-facing surface does normalization need to fix?

The dApp consumes these from `TxSimulationResult`:
- `result.publicOutput.publicReturnValues` — already handled correctly by merge (no tree dependency)
- `result.getPrivateReturnValues()` — calls `accumulatePrivateReturnValues(privateExecutionResult)` which traverses `entrypoint` recursively
- `result.getPrivateReturnValuesOfAppCall(idx)` — indexes into `nested[idx + offset - 1]` based on `appCallOffset`

For the **regular case** (account already initialized):
- `privateExecutionResult.entrypoint` IS the account entrypoint
- `nested[0..]` are the app calls
- `appCallOffset = 1` → `getPrivateReturnValuesOfAppCall(0)` returns `nested[0]` (first app call) ✅

For the **first-tx case** (multicall init):
- `privateExecutionResult.entrypoint` is the multicall
- `nested[0]` = ctor, `nested[1]` = account entrypoint
- `nested[1].nested[0..]` are the app calls
- WITHOUT normalization + `appCallOffset = 1` → `getPrivateReturnValuesOfAppCall(0)` returns `nested[0]` (ctor — WRONG)
- WITH normalization (rewrite `entrypoint` to point at the inner subtree):
  - `privateExecutionResult.entrypoint` IS the account entrypoint
  - `nested[0..]` are the app calls
  - `getPrivateReturnValuesOfAppCall(0)` returns first app call ✅

#### B.2 — The normalizer

```ts
// In fast-path.ts:
import { PrivateExecutionResult, TxSimulationResult } from "@aztec/stdlib/tx"

/**
 * Normalize a first-tx (multicall-wrapped) standard-arm result for the
 * mixed-merge path. Projects the privateExecutionResult tree onto the
 * inner account-entrypoint subtree so upstream's flat `appCallOffset`
 * model correctly indexes app calls.
 *
 * Multicall init produces this tree:
 *
 *   multicall (root)
 *     ├─ nested[0]: ctor execution
 *     └─ nested[1]: entrypoint execution
 *          └─ nested[0..]: app calls
 *
 * Post-normalize:
 *
 *   entrypoint (root)
 *     └─ nested[0..]: app calls
 *
 * Caveats:
 *   - SIM-ONLY. The returned result has `publicInputs` from the original
 *     multicall kernel — stale relative to the projected tree. The dApp
 *     never proves or sends this result, so the inconsistency is invisible.
 *   - Drops the ctor's return values + side effects from the visible tree.
 *     The dApp doesn't care about the ctor (wallet-internal); when the
 *     user actually SENDS the first tx, NuloAccount re-wraps with the
 *     full multicall.
 */
export function normalizeFirstTxStandardArm(result: TxSimulationResult): TxSimulationResult {
  const inner = result.privateExecutionResult.entrypoint.nestedExecutionResults[1]
  if (!inner) {
    // Multicall tree shape not as expected — pass through unchanged.
    // This shouldn't happen given the caller only invokes us when
    // requiresInitialization() returns true.
    return result
  }
  return new TxSimulationResult(
    new PrivateExecutionResult(
      inner,
      result.privateExecutionResult.firstNullifier,
      result.privateExecutionResult.publicFunctionCalldata,
    ),
    result.publicInputs,
    result.publicOutput,
    result.stats,
  )
}
```

#### B.3 — Wiring

`FastPathDeps` gains:

```ts
export interface FastPathDeps {
  // ... existing fields ...
  /** Whether the user's account hasn't yet sent its first tx. When true,
   *  the standard arm result is normalized (ctor stripped, entrypoint
   *  promoted to root) before mixed-merge wrap. */
  requiresInitialization: boolean
}
```

`runFastPath` calls the normalizer between `runStandardArm` and `wrapStandardArmForMixedMerge`:

```diff
const normalPromise: Promise<TxSimulationResultWithAppOffset | null> =
  remainingRaw.length > 0
-   ? runStandardArm(remainingRaw).then(wrapStandardArmForMixedMerge)
+   ? runStandardArm(remainingRaw)
+       .then(r => requiresInitialization ? normalizeFirstTxStandardArm(r) : r)
+       .then(wrapStandardArmForMixedMerge)
    : Promise.resolve(null)
```

`service.ts:executeAztecSimulateTx`:

```diff
if (remainingRaw.length > 0) {
  const account = await this.accountService.getAccountContract(...)
  const needsInit = await account.requiresInitialization(node)
- if (needsInit) {
-   // Skip mixed-merge entirely for first-tx + remainder cases.
-   return this.executeAztecSimulateTxStandard(op)
- }
+ // First-tx case is handled by the normalizer in runFastPath.
+ // (was: route everything to standard path)
}
+ const needsInit = ... // hoist out of the if block

const result = await runFastPath({
  ...,
+ requiresInitialization: needsInit,
})
```

### Tests for Phase B

#### Unit tests

Add to `fast-path.test.ts`:

1. **Normalizer happy path** — synthetic multicall tree: `multicall.nested[0]=ctor, multicall.nested[1]=entrypoint(returnValues={a,b}, nested=[appCall1, appCall2])`. After normalize: `result.entrypoint === entrypoint subtree`, `result.entrypoint.nestedExecutionResults.length === 2`.

2. **Normalizer pass-through** — when tree shape doesn't have `nested[1]` (defensive), returns input unchanged.

3. **Wrap-after-normalize** — feed normalized result through `wrapStandardArmForMixedMerge`, verify `getPrivateReturnValuesOfAppCall(0)` returns `appCall1`'s return values.

4. **End-to-end `runFastPath` with `requiresInitialization: true`** — mock the standard-arm closure to return a multicall-shaped result, assert the merge consumes the normalized tree (publicReturnValues concat + correct private return indexing).

#### E2E tests

This is harder — needs a **fresh account that has never sent a tx** AND a mixed-payload simulateTx. Existing tests assume the account is already initialized.

Two options:

- **Option B-E1**: add a new file `network/sim-firsttx-mixed.test.ts`. Setup: register profile fresh → switch to Local Network → dApp connects → dApp issues a mixed simulateTx (e.g., `balance_of_public` + private transfer to self) → verify the simulate result.

- **Option B-E2**: skip e2e for now. Cover via unit tests + manual QA.

**Recommendation**: B-E1. The test is concrete and pins the optimization.

### Decision required from user

**Question B1**: Do we ship Phase B at all?

- (a) **Yes, ship** — recover the fast-path optimization for first-tx mixed payloads. ~50 lines of normalizer + 4-5 tests. Risk: fragile to upstream tree-shape changes.
- (b) **Skip, document** — keep current behavior (skip-to-standard). Add a clear comment in the architecture-research doc explaining why we don't bother.

**Recommendation**: (a). The work is bounded, the savings are real (saves ~3-5s of PXE kernel sim for the prefix on first-tx mixed payloads), and the fragility is contained behind a single helper that's tested.

**Question B2**: If yes, do we add the e2e test (B-E1) or just unit tests?

**Recommendation**: add the e2e — confidence pays off. ~30 min to write, runs in ~30s.

---

## Verification gate (must pass before merge)

```
1. typecheck:all              → 8 packages clean
2. bun run test               → existing tests + new ones (estimate ~1480 → ~1495)
3. bun run lint               → only pre-existing warnings
4. bun run build:full         → chrome + firefox at v0.14.9
5. bun run e2e:agent          → same/better failure profile than v0.14.8
6. Manual smoke (if Phase A1 chosen) — dApp with embedded FPC payment
```

### Rollback

Each phase is independently revertable. If we land them as separate commits:
- Phase C revert: trivial (single `git revert` on the rename commit)
- Phase A revert: depends on direction (A1 most invasive)
- Phase B revert: revert the normalizer commit; orchestrator falls back to "skip to standard"

### Risk summary

| Risk | Phase | Severity | Mitigation |
|------|-------|----------|------------|
| Touch-30-files rename introduces typo | C | LOW | TypeScript + tests |
| Embedded-FPC dApp budget breaks (A1) | A | MED | Manual QA + e2e |
| Normalizer tree-shape drift on upstream bump | B | LOW-MED | Defensive return-pass-through + unit tests pinning shape |
| `publicInputs` inconsistency after normalize | B | LOW | Documented, sim-only result, never proven |

---

## Questions for the user (consolidated)

1. **C1** — Drop `NuloFeePaymentMethod` re-export entirely, or keep as deprecated alias?
2. **A1** — Embedded-FPC override: drop / consolidate / parameterize translator?
3. **A2** — Add observability when an embedded-FPC tx would have benefited from old override? (probably skip)
4. **B1** — Ship the first-tx normalizer, or document why we don't?
5. **B2** — If shipping B, add an e2e test for first-tx mixed simulateTx?
