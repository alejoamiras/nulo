# Claude's draft plan — PR 8c full mixed-payload + fee semantics unification

**Branch**: `feat/pr-8c-full-mixed-and-fee-unification` (off `0ee26eb9` / v0.14.6)
**Safe checkpoint to roll back to**: `0ee26eb9` (v0.14.6, user-validated)

## What we're solving

Two follow-ups from the v0.14.6 ship-checkpoint:

1. **Mixed payload fast path**: today the fast path only fires on PURE public-static payloads. Upstream `BaseWallet.simulateTx` supports `[public-static prefix + private/non-static remainder]` — running the prefix on the node and the remainder through PXE in parallel, then merging via `buildMergedSimulationResult`. Grego inherits this via `BaseWallet`. Nulo restricted to pure-only to dodge two issues (chain-state divergence + `appCallOffset` mis-tagging on mixed merge). Both are tractable; this plan fixes them.

2. **Fee semantics unification**: `nulo-account.ts:32-33` hardcodes `MAX_FEE_PER_DA_GAS = MAX_FEE_PER_L2_GAS = 10**18`. The fast path translator (`fast-path.ts:buildFastPathGasSettings`) mirrors upstream `completeFeeOptions` (defaults from `node.getCurrentMinFees().mul(1.5)`). Drift is real and observable for dApps that set `skipFeeEnforcement: false` without supplying fee fields. The fix: extract upstream-faithful `completeFeeOptions` into a shared module that both standard and fast paths import.

## Upstream behavior we're aligning with (verified)

Source: `@aztec/wallet-sdk@4.2.0/dest/base-wallet/base_wallet.js` lines 125-260.

```
simulateTx(executionPayload, opts):
  feeOptions = completeFeeOptions({                          ← gas-settings translator
    from, feePayer, gasSettings: opts.fee?.gasSettings,
    forEstimation: true
  })
  { optimizableCalls, remainingCalls } =                     ← split payload
    extractOptimizablePublicStaticCalls(executionPayload)
  blockHeader = pxe.getSyncedBlockHeader()                   ← prefer PXE, fall back to node
    .catch(() => aztecNode.getBlockHeader())
  [optimizedResults, normalResult] = Promise.all([           ← parallel arms
    optimizableCalls.length > 0 ? simulateViaNode(...) : [],
    remainingCalls.length > 0 ? simulateViaEntrypoint(...) : null
  ])
  return buildMergedSimulationResult(optimizedResults, normalResult)
                                                              ↑ produces TxSimulationResultWithAppOffset

simulateViaEntrypoint(executionPayload, opts):
  txRequest = createTxExecutionRequestFromPayloadAndFee(executionPayload, opts.from, opts.feeOptions)
  result = pxe.simulateTx(txRequest, {simulatePublic: true, ...scopes})
  appCallOffset = computeAppCallOffset(opts.from, opts.feeOptions)
                          ↑ NO_FROM → 0
                            else → (feeOptions.walletFeePaymentMethod?.getExecutionPayload()?.calls.length ?? 0) + 1
  return TxSimulationResultWithAppOffset.fromResultAndOffset(result, appCallOffset)

completeFeeOptions({from, feePayer, gasSettings, forEstimation}):
  maxFeesPerGas = gasSettings?.maxFeesPerGas
    ?? (await aztecNode.getCurrentMinFees()).mul(1 + minFeePadding)    ← minFeePadding = 0.5
  return {
    gasSettings: (forEstimation ? GasSettings.forEstimation : GasSettings.fallback)({
      gasLimits: gasSettings?.gasLimits ? Gas.from(gasSettings.gasLimits) : undefined,
      teardownGasLimits: gasSettings?.teardownGasLimits ? Gas.from(...) : undefined,
      maxFeesPerGas,
      maxPriorityFeesPerGas: gasSettings?.maxPriorityFeesPerGas ?? GasFees.empty()
    }),
    walletFeePaymentMethod: undefined,                                  ← upstream's wallet has this concept
    accountFeePaymentMethodOptions
  }
```

## Nulo-specific complication: first-tx multicall wrapping

`nulo-account.ts:buildTxExecutionRequest` checks `getNullifierMembershipWitness` for the account's init nullifier:
- If init nullifier exists: regular `entrypoint.createTxExecutionRequest()` (single entrypoint hop). `txRequest.origin === accountAddress`.
- If init nullifier missing: `buildWithInitialization()` wraps `[ctor, ...entrypoint(appCalls)]` through `DefaultMultiCallEntrypoint`. `txRequest.origin === MULTI_CALL_ENTRYPOINT_ADDRESS`.

The existing decode logic at `service.ts:1292-1294` already handles both:
```ts
const privateReturn = txRequest.origin.toString() === op.accountAddress
  ? simulatedTx.getPrivateReturnValues().nested      // regular: nested[appIdx]
  : simulatedTx.getPrivateReturnValues().nested[1].nested  // multicall: nested[1].nested[appIdx]
```

Upstream's flat `appCallOffset` model doesn't naturally handle the doubly-nested multicall case. The cleanest approach: **the standard arm of mixed merge skips the first-tx multicall case** (because the fast path itself doesn't need init wrapping — `simulateViaNode` bypasses the account entirely). If the account isn't initialized AND we have a remainder, fall through to pure standard path.

Concretely: detection via the same `getNullifierMembershipWitness` check NuloAccount does, but moved earlier so we can branch on it.

## Phase 1 — IPXE plumbing for `getSyncedBlockHeader()`

Files (5 surfaces, RPC-glue pattern already established for `simulateTx`):

| File | Change |
|------|--------|
| `packages/aztec-runtime/src/pxe/ipxe.ts` | Add `getSyncedBlockHeader(): Promise<BlockHeader>` to interface |
| `packages/aztec-runtime/src/pxe/spec.ts` | Add Method `getSyncedBlockHeader(network): BlockHeader` |
| `packages/aztec-runtime/src/pxe/service.ts` | Implement: `withPxeRead` → `pxe.getSyncedBlockHeader()` |
| `packages/aztec-runtime/src/pxe/client.ts` | Add `getSyncedBlockHeader(network)` → `BlockHeader.schema.parseAsync(result)` |
| `packages/aztec-runtime/src/pxe/proxy.ts` | Delegate: `pxeService.getSyncedBlockHeader(network)` |

`BlockHeader.schema` exists upstream (`@aztec/stdlib/tx/block_header.d.ts:45`). The class is large but serializable.

**Test**: no unit-test plumbing change — the RPC pattern is identical to `simulateTx`. E2E coverage comes from the mixed-path tests.

## Phase 2 — Extract shared `completeFeeOptions` translator

New module: `packages/aztec-runtime/src/account/fee-options.ts`

```ts
export const MIN_FEE_PADDING = 0.5  // mirrors upstream base_wallet.ts:32

export type PartialGasSettingsRPC = {
  gasLimits?: unknown
  teardownGasLimits?: unknown
  maxFeesPerGas?: unknown
  maxPriorityFeesPerGas?: unknown
}

export interface CompleteFeeOptionsConfig {
  node: AztecNode
  gasSettings?: PartialGasSettingsRPC
  forEstimation: boolean
}

export async function completeFeeOptions(config: CompleteFeeOptionsConfig): Promise<GasSettings> {
  const { node, gasSettings, forEstimation } = config
  const maxFeesPerGas = gasSettings?.maxFeesPerGas
    ? GasFees.from(gasSettings.maxFeesPerGas as Parameters<typeof GasFees.from>[0])
    : (await node.getCurrentMinFees()).mul(1 + MIN_FEE_PADDING)

  const overrides = {
    gasLimits: gasSettings?.gasLimits ? Gas.from(gasSettings.gasLimits as Parameters<typeof Gas.from>[0]) : undefined,
    teardownGasLimits: gasSettings?.teardownGasLimits
      ? Gas.from(gasSettings.teardownGasLimits as Parameters<typeof Gas.from>[0])
      : undefined,
    maxFeesPerGas,
    maxPriorityFeesPerGas: gasSettings?.maxPriorityFeesPerGas
      ? GasFees.from(gasSettings.maxPriorityFeesPerGas as Parameters<typeof GasFees.from>[0])
      : GasFees.empty(),
  }

  return forEstimation ? GasSettings.forEstimation(overrides) : GasSettings.fallback(overrides)
}
```

Updates:

- **`nulo-account.ts:buildTxExecutionRequest`**: replace inline `GasSettings.forEstimation({ maxFeesPerGas: new GasFees(MAX_FEE_PER_DA_GAS, ...) })` with `await completeFeeOptions({ node, gasSettings: options.gasSettings, forEstimation: true })`. Drop the `MAX_FEE_PER_DA_GAS` / `MAX_FEE_PER_L2_GAS` constants — no longer needed. (Add `gasSettings` as an optional field on `DefaultAccountEntrypointOptions` — actually `options` is already typed `DefaultAccountEntrypointOptions` from upstream; if it doesn't have a `gasSettings` field, the caller passes it separately.)

- **`fast-path.ts`**: delete the inline `buildFastPathGasSettings`. Import `completeFeeOptions` from `@nulo/aztec-runtime/account`. Call `await completeFeeOptions({ node, gasSettings: opts.fee?.gasSettings, forEstimation: true })`.

**Test**: new `fee-options.test.ts` in `packages/aztec-runtime/src/account/` with ~6 cases:
1. No gasSettings + `forEstimation: true` → uses `getCurrentMinFees().mul(1.5)` + GasFees.empty priority + estimation flags
2. No gasSettings + `forEstimation: false` → same defaults + fallback flags
3. Partial gasSettings (`maxFeesPerGas` only) → uses provided maxFees + default priority
4. Partial gasSettings (`maxPriorityFeesPerGas` only) → defaults maxFees from node + uses provided priority
5. Full gasSettings → all four fields used
6. Malformed `maxFeesPerGas` → `GasFees.from` throws (caller's responsibility to catch)

Existing fast-path.test.ts tests #17, #18, #21, #22 already cover the translator behavior — they keep working since the translator's signature is the same (just moved). Tests get a thin re-import.

`nulo-account.test.ts` (1 existing test, currently a stub) — needs a new test asserting the same gas settings flow into the upstream entrypoint for both pre/post unification. Add 2 cases (with + without dApp-provided fee settings).

## Phase 3 — Mixed-payload fast path

### Detection: first-tx multicall

Add helper `requiresMulticallInit(accountAddress, node, instance): Promise<boolean>` colocated with NuloAccount. Reuses the existing `getNullifierMembershipWitness("latest", initNullifier)` check. If `true`, fast path is unsafe for the mixed merge — fall through to pure standard.

### Updated `executeAztecSimulateTx` orchestration

```ts
private async executeAztecSimulateTx(op): Promise<TxSimulationResult> {
  if (op.accountAddress !== op.opts?.from?.toString()) throw new Error("Invalid `opts.from`")

  // (1) Rehydrate the FULL call list — both arms need real FunctionCalls.
  const rehydrated = tryRehydrateCalls(op.exec?.calls)        // renamed from PureStaticPayload
  if (rehydrated === null) return this.executeAztecSimulateTxStandard(op)

  // (2) Split into [public-static prefix, remainder].
  const splitIdx = rehydrated.findIndex((c) => !c.isPublicStatic())
  const boundary = splitIdx === -1 ? rehydrated.length : splitIdx
  const optimizableCalls = rehydrated.slice(0, boundary)
  const remainingCalls = rehydrated.slice(boundary)

  // (3) No optimizable prefix → standard path only.
  if (optimizableCalls.length === 0) return this.executeAztecSimulateTxStandard(op)

  // (4) Multicall-init case + remainder: can't merge cleanly, route all to standard.
  if (remainingCalls.length > 0) {
    const needsInit = await this.requiresMulticallInit(op)
    if (needsInit) return this.executeAztecSimulateTxStandard(op)
  }

  // (5) Build the merged result.
  return await this.runMergedFastPath(op, optimizableCalls, remainingCalls)
}
```

### `runMergedFastPath`

```ts
private async runMergedFastPath(
  op: AztecSimulateTxOperation,
  optimizableCalls: FunctionCall[],
  remainingCalls: FunctionCall[],
): Promise<TxSimulationResult> {
  const network = await this.networkService.getNetwork(op.networkId)
  const node = await this.networkService.getNode(network.chainId)
  const pxe = this.pxeService.getPXE(networkInfoFrom(network))

  // (a) Anchor block-header. Prefer PXE synced, fall back to node head — mirrors upstream.
  let blockHeader: BlockHeader | undefined
  try {
    blockHeader = await pxe.getSyncedBlockHeader()
  } catch {
    blockHeader = await node.getBlockHeader() ?? undefined
  }
  if (!blockHeader) return this.executeAztecSimulateTxStandard(op)

  // (b) Build gas settings via the shared translator.
  const gasSettings = await completeFeeOptions({
    node,
    gasSettings: op.opts.fee?.gasSettings,
    forEstimation: true,
  })

  // (c) chainInfo — same as today.
  const nodeInfo = await node.getNodeInfo()
  const chainInfo = { chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }
  const fromAddr = AztecAddress.fromString(op.accountAddress)

  // (d) Parallel arms.
  let optimizedResults: TxSimulationResult[]
  let normalResult: TxSimulationResultWithAppOffset | null = null
  try {
    const optimizedPromise = simulateViaNode(node, optimizableCalls, fromAddr, chainInfo, gasSettings, blockHeader,
      op.opts.skipFeeEnforcement ?? true, /* getContractName */ async () => undefined)
    const normalPromise: Promise<TxSimulationResultWithAppOffset | null> =
      remainingCalls.length > 0
        ? this.executeAztecSimulateTxStandardWithOffset({ ...op, exec: { ...op.exec, calls: remainingCalls } })
        : Promise.resolve(null)
    ;[optimizedResults, normalResult] = await Promise.all([optimizedPromise, normalPromise])
  } catch (err) {
    if (err instanceof SimulationError) throw err
    this.logError("[PR 8c] mixed-path fast arm failed, falling back to standard", err)
    return this.executeAztecSimulateTxStandard(op)
  }

  return buildMergedSimulationResult(optimizedResults, normalResult)
}
```

### `executeAztecSimulateTxStandardWithOffset`

New thin wrapper that calls existing `executeAztecSimulateTxStandard` and wraps:

```ts
private async executeAztecSimulateTxStandardWithOffset(
  op: AztecSimulateTxOperation,
): Promise<TxSimulationResultWithAppOffset> {
  const result = await this.executeAztecSimulateTxStandard(op)
  // Nulo's DefaultAccountEntrypoint wraps the app payload as a single
  // nested call; appCallOffset = 1 (one entrypoint hop, no wallet-prepended
  // fee calls). Multicall init case is excluded upstream in
  // executeAztecSimulateTx, so we only reach here in the regular case.
  return TxSimulationResultWithAppOffset.fromResultAndOffset(result, 1)
}
```

### `tryRehydrateCalls`

Replace `tryRehydratePureStaticPayload` with `tryRehydrateCalls(calls)`:
- Returns `FunctionCall[]` for any valid payload (no pure-only restriction)
- Returns `null` for malformed/empty input
- The split happens AFTER rehydration in the caller (#2 above)

## Phase 4 — Test impact

### Unit tests touched

| File | Change | Cases |
|------|--------|-------|
| `fast-path.test.ts` | Replace `tryRehydratePureStaticPayload` tests with `tryRehydrateCalls` (no pure-only restriction). Replace `runFastPath` with `runMergedFastPath` orchestration tests. | ~25 cases (was 23) |
| `fee-options.test.ts` (NEW) | Translator tests for the extracted `completeFeeOptions` | 6 cases |
| `nulo-account.test.ts` | Add ~2 cases asserting fee unification (with/without dApp-supplied fee settings) | +2 |

### Unit tests NOT touched

- `service.test.ts` files for other execution paths — unaffected (we only change `executeAztecSimulateTx` orchestration; `executeAztecSimulateTxStandard` body unchanged)
- `pxe/*.test.ts` — new `getSyncedBlockHeader` RPC method is structurally identical to existing methods; no spec-level test needed if pattern is preserved
- All other 119 test files — no changes

### E2E tests

No e2e test files need code changes. They assert correctness of dApp interactions; the mixed fast path produces the same return values as the pure-standard path (just faster for the public-static prefix). Test impact:

- **`network/sim-methods.test.ts`** (3 tests): exercises `simulateTx` / `profileTx` / `executeUtility`. Should pass unchanged — covers our new mixed path implicitly.
- **`network/connect-dapp.test.ts`**: exercises the connect handshake which triggers a few simulateTx calls. Should pass unchanged.
- **`network/transfers.test.ts`** (8 tests): exercises full tx flows that involve sim. Should pass unchanged.
- **`network/cap-request-*.test.ts`**: capability flows that involve sims. Should pass unchanged.

Verification gate: `bun run e2e:agent` — same or better failure profile than v0.14.6's run (which already had 6-9 failure load-flakes; nothing we do here should change that pattern).

## Risks + rollback

| Risk | Severity | Mitigation |
|------|----------|------------|
| `appCallOffset = 1` is wrong for some Nulo edge case | HIGH | Restrict to non-init case via `requiresMulticallInit`. Add unit test asserting wrapped result has offset=1 for regular case. |
| Fee semantics change breaks existing simulate flows | MED | `skipFeeEnforcement: true` is the default and most common — unaffected. Add regression test for `skipFeeEnforcement: false` + no fee settings. |
| `pxe.getSyncedBlockHeader()` RPC adds offscreen round-trip latency on every fast-path call | LOW | RPC is fast; the saved kernel-sim cost dwarfs it 100x. |
| Mixed merge return-value ordering differs from standard path | MED | Add e2e-style test that runs the same mixed payload through both paths and asserts identical return values. (Can be a unit test with fake PXE.) |

**Rollback**: `git reset --hard 0ee26eb9`, push, done. v0.14.6 is the always-safe baseline.

## Phases / sequencing

```
Phase 1: IPXE plumbing                  (~2 hours, 5 files)
  ↓
Phase 2: Extract completeFeeOptions     (~2 hours, 3 files + new fee-options.test.ts)
  ↓
Phase 3: Mixed-payload orchestration    (~4 hours, 2 files + fast-path.test.ts rewrite)
  ↓
Phase 4: Verification                   (~1 hour gates + ~30 min e2e:agent)
  ↓
Manual QA on rebuilt dist/qa-v0.14.7   (user)
```

## Files touched (final list)

```
NEW
  packages/aztec-runtime/src/account/fee-options.ts        Phase 2
  packages/aztec-runtime/src/account/fee-options.test.ts   Phase 2 tests
  implementations-plan/pr-8c-mixed-and-fee/                docs

MODIFIED
  packages/aztec-runtime/src/pxe/ipxe.ts                   Phase 1
  packages/aztec-runtime/src/pxe/spec.ts                   Phase 1
  packages/aztec-runtime/src/pxe/service.ts                Phase 1
  packages/aztec-runtime/src/pxe/client.ts                 Phase 1
  packages/aztec-runtime/src/pxe/proxy.ts                  Phase 1
  packages/aztec-runtime/src/account/nulo-account.ts       Phase 2 (use completeFeeOptions)
  packages/aztec-runtime/src/account/nulo-account.test.ts  Phase 2 tests (+2 cases)
  packages/extension/src/wallet/services/execution/fast-path.ts        Phase 3 (mixed)
  packages/extension/src/wallet/services/execution/fast-path.test.ts   Phase 3 tests
  packages/extension/src/wallet/services/execution/service.ts          Phase 3 (orchestration)
  packages/extension/package.json                          version bump (0.14.7)
```

13 file changes total. Most are small (1-line additions for IPXE plumbing). The substantive code is Phase 3 orchestration (~80 lines) and Phase 2 translator extraction (~60 lines).
