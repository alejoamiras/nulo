# Consolidated plan — PR 8c full mixed-payload + fee semantics unification

**Branch**: `feat/pr-8c-full-mixed-and-fee-unification` (off `0ee26eb9` / v0.14.6)
**Safe checkpoint to roll back to**: `0ee26eb9` (v0.14.6, user-validated)
**Codex sessions**: `019e183f` (independent draft) — see `codex-plan.md` for context.

## Goals (recap)

1. **Mixed-payload fast path** — match upstream `BaseWallet.simulateTx` for `[public-static prefix + non-static remainder]` payloads.
2. **Fee semantics unification** — both standard and fast paths share an upstream-faithful `completeFeeOptions` translator. Drift currently visible when dApp sets `skipFeeEnforcement: false` without explicit fee fields.

## Decision matrix — claude vs codex divergences resolved

| Topic | Claude's draft | Codex's draft | Final decision |
|-------|----------------|---------------|----------------|
| First-tx multicall in mixed merge | Skip mixed entirely; fall through to pure standard path | Normalize standard-arm `privateExecutionResult` tree (project onto inner entrypoint subtree); wrap with `appCallOffset = 1` | **Skip** (claude's, codex agreed in v2 review). Normalizer is non-trivial (~50 lines of upstream-fragile code) and first-tx + mixed is an edge case — dApp would need to call `aztec_simulateTx` with non-pure payload before any tx has been sent. Document as TRACKED FOLLOW-UP. |
| `requiresInitialization` detection seam | `requiresMulticallInit` on `ExecutionService` reaching through `account.instance.initializationHash` | (not addressed in codex draft; raised in v2 review) | **Account-level interface method** (`IAccountContract.requiresInitialization(node): Promise<boolean>`). `NuloAccount` implements it (reuses existing init-nullifier check). Avoids `ExecutionService` punching through concrete `NuloAccount` internals. |
| `gasSettings` transport seam | Extend `DefaultAccountEntrypointOptions` with `gasSettings` field | (not addressed) | **Separate `gasSettings` parameter** on `buildTxExecutionRequest(node, pxe, payload, options, gasSettings?)`. Don't augment upstream's type — gas-settings isn't an entrypoint concern. Codex's v2 catch. |
| Boundary detection in `tryRehydrateCalls` | Rehydrate whole payload, split after | (not addressed) | **Data-only precheck for boundary, rehydrate ONLY the optimizable prefix**. Recreates the wasteful double-parse if we rehydrate the whole payload only to discard the remainder. Codex's v2 catch. Renamed helper: `rehydrateOptimizablePrefix(calls): { optimizableCalls: FunctionCall[], remainingRaw: unknown[] } | null`. |
| Standard-arm result wrapper | Method on ExecutionService (`executeAztecSimulateTxStandardWithOffset`) | Helper in `service.ts` or `fast-path.ts` | **Helper in `fast-path.ts`**. Less surface on `ExecutionService`; the wrapper is fast-path-specific. |
| Merge function | Use upstream `buildMergedSimulationResult` | Write Nulo-local merge helper | **Upstream** (Claude's original, reaffirmed by user 2026-05-11 — "I'll always lean to using the upstream default if it exists. It reduces our side of the maintenance"). The wrapped-standard arm already returns `TxSimulationResultWithAppOffset` which is exactly what upstream's merge expects, so no impedance mismatch. We trade hypothetical "wire-contract drift insurance" for zero maintenance — the right trade for a stable upstream we already depend on. |
| `maxPriorityFeesPerGas` plumbing | NOT addressed | Add to `operation-planner.ts` (currently dropped) + `tx-request-builder.ts` | **ADOPT codex's catch** — critical. Unification is incomplete without this. Even if `completeFeeOptions` is shared, the standard path's `FeeOptions` shim drops priority fees today. |
| Translator location | `aztec-runtime/src/account/fee-options.ts` | `aztec-runtime/src/account/complete-fee-options.ts` | `aztec-runtime/src/account/fee-options.ts` (shorter, internal name `completeFeeOptions` function). |
| Test counts | ~25 fast-path + 6 fee + 2 nulo-account | 8 fast-path + 6 fee + 2 operation-planner | **8 NEW fast-path + 6 fee + 2 operation-planner + 1 nulo-account regression**. Existing 12 helper tests stay; we add 8 mixed cases on top. |
| `FeeOptions` schema change | Not addressed | Need to add `maxPriorityFeesPerGas` field | **ADOPT**. Schema lives in `wallet-bridge/src/operation.ts`. |

## Files touched (final list, consolidated)

```
NEW
  packages/aztec-runtime/src/account/fee-options.ts            Phase 2 — shared translator
  packages/aztec-runtime/src/account/fee-options.test.ts       Phase 2 — 6 tests
  implementations-plan/pr-8c-mixed-and-fee/                    docs (this dir)

MODIFIED
  packages/aztec-runtime/src/account/index.ts                  Phase 2 — export fee-options + add `requiresInitialization` to IAccountContract interface
  packages/aztec-runtime/src/account/nulo-account.ts           Phase 2 — use completeFeeOptions + implement `requiresInitialization`
  packages/extension/src/wallet/services/account/contracts/nulo-account.test.ts  Phase 2 — +1 regression case (existing file is in extension, not aztec-runtime)
  packages/aztec-runtime/src/pxe/ipxe.ts                       Phase 1 — getSyncedBlockHeader
  packages/aztec-runtime/src/pxe/spec.ts                       Phase 1 — RPC method
  packages/aztec-runtime/src/pxe/service.ts                    Phase 1 — implementation
  packages/aztec-runtime/src/pxe/client.ts                     Phase 1 — RPC client wrapper
  packages/aztec-runtime/src/pxe/proxy.ts                      Phase 1 — proxy delegate
  packages/wallet-bridge/src/operation.ts                      Phase 2 — FeeOptions schema (priorityFees)
  packages/extension/src/wallet/services/execution/operation-planner.ts        Phase 2 — thread priorityFees
  packages/extension/src/wallet/services/execution/operation-planner.test.ts   Phase 2 — +2 tests
  packages/extension/src/wallet/services/execution/tx-request-builder.ts       Phase 2 — accept priorityFees
  packages/extension/src/wallet/services/execution/fast-path.ts                Phase 3 — mixed orchestration
  packages/extension/src/wallet/services/execution/fast-path.test.ts           Phase 3 — +8 mixed tests
  packages/extension/src/wallet/services/execution/service.ts                  Phase 3 — wire-up
  packages/extension/package.json                              version bump → 0.14.7
```

Total: 2 new + 15 modified = **17 file changes**.

## Phases (ordered for safe incremental landing)

### Phase 1 — IPXE plumbing for `getSyncedBlockHeader()` (independent of others)

Files: `ipxe.ts`, `spec.ts`, `service.ts`, `client.ts`, `proxy.ts` (5 files in `aztec-runtime/src/pxe/`).

```ts
// ipxe.ts — add to interface
getSyncedBlockHeader(): Promise<BlockHeader>

// spec.ts — add to RPC Methods type
getSyncedBlockHeader(network: NetworkInfo): BlockHeader

// service.ts — implementation
public async getSyncedBlockHeader(network: NetworkInfo): Promise<BlockHeader> {
  return this.withPxeRead("getSyncedBlockHeader", network, async (pxe) => pxe.getSyncedBlockHeader())
}

// client.ts — RPC client wrapper (mirrors existing `simulateTx` pattern)
public async getSyncedBlockHeader(network: NetworkInfo): Promise<BlockHeader> {
  const result = await this.request("getSyncedBlockHeader", network)
  return await BlockHeader.schema.parseAsync(result)
}

// proxy.ts — delegate
public async getSyncedBlockHeader(): Promise<BlockHeader> {
  return this.pxeService.getSyncedBlockHeader(this.network)
}
```

No tests needed (pattern is identical to existing `simulateTx`; covered by integration via mixed-path tests in Phase 3).

### Phase 2 — Shared `completeFeeOptions` translator + priorityFees plumbing

**Step 2a**: New `packages/aztec-runtime/src/account/fee-options.ts`

```ts
import { Fr } from "@aztec/foundation/curves/bn254"
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"

/** Mirrors upstream BaseWallet's private constant (base_wallet.ts:32). */
export const MIN_FEE_PADDING = 0.5

/** RPC-shaped partial gas settings — fields are `unknown` because the SW
 *  boundary doesn't validate dApp payloads before dispatch. Throws on
 *  malformed input inside `Gas.from` / `GasFees.from`; callers should
 *  let those propagate (errors are real, not recoverable). */
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

/** Upstream-faithful gas-settings completion. Single source of truth for
 *  both NuloAccount (standard path via `buildTxExecutionRequest`) and
 *  the fast-path orchestrator (`runFastPath` via `simulateViaNode`). */
export async function completeFeeOptions(config: CompleteFeeOptionsConfig): Promise<GasSettings> {
  const { node, gasSettings, forEstimation } = config

  const maxFeesPerGas = gasSettings?.maxFeesPerGas
    ? GasFees.from(gasSettings.maxFeesPerGas as Parameters<typeof GasFees.from>[0])
    : (await node.getCurrentMinFees()).mul(1 + MIN_FEE_PADDING)

  const overrides = {
    gasLimits: gasSettings?.gasLimits
      ? Gas.from(gasSettings.gasLimits as Parameters<typeof Gas.from>[0])
      : undefined,
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

Tests in `fee-options.test.ts` (6 cases):
1. No gasSettings + `forEstimation: true` → `getCurrentMinFees().mul(1.5)` + `GasFees.empty()` priority + estimation flags
2. No gasSettings + `forEstimation: false` → same defaults + fallback flags
3. Explicit `maxFeesPerGas` only → uses provided + default priority
4. Explicit `maxPriorityFeesPerGas` only → defaults maxFees from node + uses provided priority
5. Full gasSettings → all four fields used (including `gasLimits`, `teardownGasLimits`)
6. Malformed `maxFeesPerGas` (e.g. `{feePerDaGas: "garbage"}`) → `GasFees.from` throws (asserted via `await expect(...).rejects`)

**Step 2b**: Update `nulo-account.ts:buildTxExecutionRequest` to use `completeFeeOptions`.

```ts
// nulo-account.ts — signature change: add a separate `gasSettings` param.
// We deliberately DO NOT augment upstream's `DefaultAccountEntrypointOptions`
// with a `gasSettings` field — gas-settings isn't an entrypoint concern, and
// extending an upstream type couples Nulo behavior to a foreign owner.
public async buildTxExecutionRequest(
  node: AztecNode,
  pxe: IPXE,
  payload: ExecutionPayload,
  options: DefaultAccountEntrypointOptions,
  gasSettings?: PartialGasSettingsRPC,                  // NEW separate param
): Promise<TxExecutionRequest> {
  // ...
  const fullGasSettings = await completeFeeOptions({
    node,
    gasSettings,
    forEstimation: true,
  })
  // ... rest of buildTxExecutionRequest uses fullGasSettings
  // Drop the MAX_FEE_PER_DA_GAS / MAX_FEE_PER_L2_GAS constants.
}
```

Callers of `buildTxExecutionRequest` (`tx-request-builder.ts:buildStandard`) pass `gasSettings` derived from `opts.fee?.gasSettings` (which now includes `maxPriorityFeesPerGas` after Step 2c).

`nulo-account.test.ts` adds **1 regression case** asserting the same gas settings flow through `buildTxExecutionRequest` for both pre/post unification.

**Step 2c**: Thread `maxPriorityFeesPerGas` through `FeeOptions`.

`packages/wallet-bridge/src/operation.ts` — extend `FeeOptions` schema:

```ts
// BEFORE
export type FeeOptions = {
  embeddedFeePayment: ...
  gasLimits?: { ... }
  teardownGasLimits?: { ... }
  maxFeesPerGas?: { feePerDaGas: string; feePerL2Gas: string }
  gasPadding: number
}

// AFTER (add maxPriorityFeesPerGas)
export type FeeOptions = {
  embeddedFeePayment: ...
  gasLimits?: { ... }
  teardownGasLimits?: { ... }
  maxFeesPerGas?: { feePerDaGas: string; feePerL2Gas: string }
  maxPriorityFeesPerGas?: { feePerDaGas: string; feePerL2Gas: string }   // NEW
  gasPadding: number
}
```

`operation-planner.ts` — capture priority fees from `opts.fee?.gasSettings?.maxPriorityFeesPerGas` and stringify into `feeOptions.maxPriorityFeesPerGas`. Add 2 test cases in `operation-planner.test.ts`:
- Priority fees preserved from `opts.fee.gasSettings`
- Both maxFees and priorityFees stringified into `FeeOptions`

`tx-request-builder.ts` — accept `maxPriorityFeesPerGas` from `FeeOptions` and pass through to `nulo-account.buildTxExecutionRequest` via `options.gasSettings.maxPriorityFeesPerGas`.

**Step 2d**: Update `fast-path.ts` to use `completeFeeOptions`. Delete the now-duplicate `buildFastPathGasSettings` and the local `PartialGasSettingsRPC` / `MIN_FEE_PADDING` constants — they live in the shared module.

### Phase 3 — Mixed-payload orchestration

**Step 3a**: Rename `tryRehydratePureStaticPayload` → `rehydrateOptimizablePrefix`. Cheap data-only scan for the prefix boundary BEFORE rehydration — rehydrating a fully-private or non-optimizable payload only to throw it away recreates the double-parse problem (planner re-rehydrates in the standard path anyway).

```ts
// fast-path.ts
export function rehydrateOptimizablePrefix(
  calls: readonly unknown[] | undefined,
): { optimizableCalls: FunctionCall[]; remainingRaw: unknown[] } | null {
  if (!Array.isArray(calls) || calls.length === 0) return null

  // Data-only scan — find the first non-public-static boundary without
  // touching the (expensive) zod schema. `FunctionType` is string-backed
  // upstream so `=== FunctionType.PUBLIC` survives JSON round-trip.
  let boundary = 0
  for (const c of calls) {
    if (typeof c !== "object" || c === null) break
    const obj = c as { type?: unknown; isStatic?: unknown }
    if (obj.type !== FunctionType.PUBLIC || obj.isStatic !== true) break
    boundary++
  }
  if (boundary === 0) return null  // No optimizable prefix; caller falls through to standard

  // Rehydrate ONLY the prefix. Remainder stays raw — the standard arm
  // closure re-rehydrates via planner.processAztecJsPayload internally.
  try {
    const optimizableCalls = calls.slice(0, boundary).map((c) => FunctionCall.schema.parse(c))
    return { optimizableCalls, remainingRaw: calls.slice(boundary) }
  } catch {
    return null
  }
}
```

**Step 3b**: Add the standard-arm wrapper helper (still in `fast-path.ts` since it's fast-path-specific):

```ts
// fast-path.ts
/** Wrap a standard-path TxSimulationResult with appCallOffset for mixed merge.
 *  For Nulo's DefaultAccountEntrypoint (regular case, account already initialized):
 *  the flattened tree is `root = entrypoint`, `nested[0..] = app calls`. Offset = 1.
 *  First-tx multicall case is excluded upstream in the orchestrator. */
export function wrapStandardArmForMixedMerge(result: TxSimulationResult): TxSimulationResultWithAppOffset {
  return TxSimulationResultWithAppOffset.fromResultAndOffset(result, 1)
}
```

**Step 3c**: Call upstream `buildMergedSimulationResult` directly. No Nulo-local merge helper.

```ts
// In fast-path.ts:
import { buildMergedSimulationResult } from "@aztec/wallet-sdk/base-wallet"
// ...
return buildMergedSimulationResult(optimizedResults, wrappedNormal)
```

Upstream's signature:
```
buildMergedSimulationResult(
  optimizedResults: TxSimulationResult[],
  normalResult: TxSimulationResultWithAppOffset | null,
): TxSimulationResultWithAppOffset
```

Handles the `normalResult === null` case natively (pure-prefix → no standard arm). Returns `TxSimulationResultWithAppOffset` which `extends TxSimulationResult` so it's assignable to `executeAztecSimulateTx`'s return.

Rationale: user preference "lean toward upstream defaults when they exist; reduces our maintenance" (memory `feedback_prefer_upstream_defaults.md`). The standard-arm wrapper (Step 3b) produces exactly the type upstream's merge expects, so no impedance mismatch.

**Step 3d**: Update `runFastPath` to accept and handle the mixed case:

```ts
// fast-path.ts
export interface FastPathDeps {
  node: AztecNode
  pxe: IPXE                                              // NEW — for getSyncedBlockHeader
  fromAddr: AztecAddress
  opts: SimulateOptions
  optimizableCalls: FunctionCall[]                        // pre-rehydrated public-static prefix
  remainingRaw: unknown[]                                 // RAW (un-rehydrated) remainder — standard arm closure re-rehydrates via planner
  runStandardArm: (remainingRaw: unknown[]) => Promise<TxSimulationResult>  // closure over Nulo's standard path
  logError: (msg: string, err: unknown) => void
}

export async function runFastPath(deps: FastPathDeps): Promise<TxSimulationResult | null> {
  const { node, pxe, fromAddr, opts, optimizableCalls, remainingCalls, runStandardArm, logError } = deps

  // getNodeInfo shares fate with PXE — let it propagate.
  const nodeInfo = await node.getNodeInfo()
  const chainInfo: ChainInfo = {
    chainId: new Fr(nodeInfo.l1ChainId),
    version: new Fr(nodeInfo.rollupVersion),
  }

  // Fast-path-exclusive ops under one try/catch (per the v0.14.6 narrowed-catch invariant).
  let optimizedResults: TxSimulationResult[]
  let normalResult: TxSimulationResultWithAppOffset | null = null
  try {
    // Mirror upstream: prefer PXE-synced header, fall back to node head.
    // Critical for mixed merge — optimized arm and standard arm must observe the same chain state.
    let blockHeader: BlockHeader | undefined
    try {
      blockHeader = await pxe.getSyncedBlockHeader()
    } catch {
      blockHeader = (await node.getBlockHeader()) ?? undefined
    }
    if (!blockHeader) return null

    const gasSettings = await completeFeeOptions({
      node,
      gasSettings: opts.fee?.gasSettings as PartialGasSettingsRPC | undefined,
      forEstimation: true,
    })

    const optimizedPromise = optimizableCalls.length > 0
      ? simulateViaNode(node, optimizableCalls, fromAddr, chainInfo, gasSettings, blockHeader,
          opts.skipFeeEnforcement ?? true, async () => undefined)
      : Promise.resolve([] as TxSimulationResult[])

    const normalPromise = remainingRaw.length > 0
      ? runStandardArm(remainingRaw).then(wrapStandardArmForMixedMerge)
      : Promise.resolve(null)

    ;[optimizedResults, normalResult] = await Promise.all([optimizedPromise, normalPromise])
  } catch (err) {
    if (err instanceof SimulationError) throw err
    logError("[PR 8c] fast-path failed, falling back to standard path", err)
    return null
  }

  // Merge via upstream — TxSimulationResultWithAppOffset | null is exactly
  // what buildMergedSimulationResult expects (Step 3b's wrap is what makes
  // this work). Local invariants from the merge itself surface naturally.
  return buildMergedSimulationResult(optimizedResults, normalResult)
}
```

**Step 3e**: Update `service.ts:executeAztecSimulateTx` orchestration:

```ts
private async executeAztecSimulateTx(op): Promise<TxSimulationResult> {
  if (op.accountAddress !== op.opts?.from?.toString()) throw new Error("Invalid `opts.from`")

  // (1) Cheap data-only scan for the optimizable prefix, then rehydrate
  //     ONLY that slice. Avoids the double-parse if the prefix is empty.
  const split = rehydrateOptimizablePrefix(op.exec?.calls)
  if (split === null) return this.executeAztecSimulateTxStandard(op)
  const { optimizableCalls, remainingRaw } = split

  // (2) First-tx multicall + remainder: can't merge cleanly (upstream's
  // flat appCallOffset doesn't express doubly-nested execution trees).
  // Route everything to the standard path. TRACKED FOLLOW-UP: normalize
  // the standard arm's tree (project onto inner entrypoint subtree) to
  // recover this optimization for first-tx mixed payloads.
  //
  // Note: pure-prefix (remainingRaw.length === 0) IS optimized even when
  // first-tx init is required — `simulateViaNode` bypasses the account
  // entirely, so the init wrapping concern doesn't apply.
  if (remainingRaw.length > 0) {
    const account = await this.accountService.getAccountContract(profileId, network.chainId, op.accountAddress)
    const needsInit = await account.requiresInitialization(node)
    if (needsInit) return this.executeAztecSimulateTxStandard(op)
  }

  // (5) Run merged fast path.
  const network = await this.networkService.getNetwork(op.networkId)
  const node = await this.networkService.getNode(network.chainId)
  const pxe = this.pxeService.getPXE(networkInfoFrom(network))

  const result = await runFastPath({
    node,
    pxe,
    fromAddr: AztecAddress.fromString(op.accountAddress),
    opts: op.opts,
    optimizableCalls,
    remainingRaw,
    runStandardArm: async (rawCalls) => this.executeAztecSimulateTxStandard({ ...op, exec: { ...op.exec, calls: rawCalls } }),
    logError: (msg, err) => this.logError(msg, err),
  })
  if (result === null) return this.executeAztecSimulateTxStandard(op)
  return result
}

// IAccountContract (in `aztec-runtime/src/account/index.ts`) gets a new method.
// NuloAccount implements it; ExecutionService calls it without punching through
// concrete-type internals.
//
// Account-interface addition:
//   requiresInitialization(node: AztecNode): Promise<boolean>
//
// NuloAccount implementation (reuses existing init-nullifier check from
// buildTxExecutionRequest):
//   public async requiresInitialization(node: AztecNode): Promise<boolean> {
//     const initNullifier = await computeSiloedPrivateInitializationNullifier(
//       this.address, this.instance.initializationHash)
//     const witness = await node.getNullifierMembershipWitness("latest", initNullifier)
//     return witness === undefined
//   }
//
// ExecutionService uses it inline (no separate private helper needed):
//   const account = await this.accountService.getAccountContract(profileId, network.chainId, op.accountAddress)
//   const needsInit = await account.requiresInitialization(node)
```

### Phase 3 tests — `fast-path.test.ts` (+8 new cases on top of existing 23)

Codex's 8 cases adopted verbatim:

1. Leading public-static prefix + private remainder splits correctly (optimizable=2, remaining=1)
2. Leading public-static prefix + public-non-static remainder splits correctly
3. No optimizable prefix → straight to standard path (existing behavior)
4. `pxe.getSyncedBlockHeader()` is preferred over `node.getBlockHeader()`
5. PXE synced-header failure → falls back to `node.getBlockHeader()`
6. Standard-arm normal result is wrapped with `appCallOffset = 1`
7. Pure-prefix case (`remainingRaw.length === 0`) → upstream `buildMergedSimulationResult(optimizedResults, null)` returns optimized-only merge. (Asserts our integration with upstream produces correct output for the no-remainder case; the upstream helper's internals are upstream's concern.)
8. Mixed merge preserves standard `stats` and concatenates `publicReturnValues` in optimized-first order. (Asserts our integration calls upstream correctly + that the wrap step doesn't lose stats.)

For Step 3c's `mergeFastPathResults` specifically, add 1 unit test asserting `normal.stats` ends up on the merged result (not lost).

Test #7 from codex (first-tx multicall normalizer) is omitted — we skip that case to standard path; no test needed beyond an orchestration test asserting the skip.

Add 2 orchestration tests at the `executeAztecSimulateTx` level:
- `account.requiresInitialization === true` + `remainingRaw.length > 0` → standard path (mock asserts merge is NOT called).
- `account.requiresInitialization === true` + `remainingRaw.length === 0` (pure-prefix, first-tx) → fast path STILL runs (`simulateViaNode` bypasses the account so init wrapping is irrelevant). Pins that we don't over-gate.

Total new fast-path cases: **10** (8 mixed-merge + 2 init-detection orchestration).

### Phase 4 — Verification

```
typecheck:all          ✓ across 8 packages
bun run test           ✓ 1424 existing + ~12 new = ~1436 passes
bun run lint           ✓ only pre-existing warnings
bun run build:full     ✓ chrome + firefox at 0.14.7
bun run e2e:agent      → same/better profile vs v0.14.6's 6-9 load-flake range
                       → if regression appears, roll back to 0ee26eb9
manual QA on dist/qa-v0.14.7
```

E2E test files: **0 code changes**. Existing network tests cover the mixed path implicitly via dApp flows.

## Sequencing (codex's order, adopted)

```
Phase 1 (IPXE plumbing)         [independent]
  ↓ (no dependency, can be done first or in parallel with Phase 2)

Phase 2 (gas-settings translator + priorityFees plumbing)
  Step 2a: fee-options.ts + tests
  Step 2b: nulo-account.ts uses it
  Step 2c: operation-planner.ts + tx-request-builder.ts + wallet-bridge schema thread priorityFees
  Step 2d: fast-path.ts drops local translator, uses shared
  ↓ (Phase 2 unifies both paths around same gas-settings shape)

Phase 3 (mixed-payload orchestration)
  Step 3a: tryRehydrateCalls (no pure-only restriction)
  Step 3b: wrapStandardArmForMixedMerge helper
  Step 3c: mergeFastPathResults helper
  Step 3d: runFastPath accepts optimizableCalls + remainingCalls
  Step 3e: service.ts orchestration (split + first-tx skip + merge)
  ↓ (Phase 3 depends on Phase 1's getSyncedBlockHeader + Phase 2's translator)

Phase 4 (verification gates + e2e + manual QA)
```

## Risks + rollback

| Risk | Severity | Mitigation |
|------|----------|------------|
| `appCallOffset = 1` is wrong for some Nulo case | HIGH | Restrict to non-init via `requiresMulticallInit`. Unit test asserts wrap behavior. |
| Fee unification breaks existing flows | MED | `skipFeeEnforcement: true` (default) unchanged. nulo-account regression test pins behavior. |
| `getSyncedBlockHeader` RPC adds latency | LOW | Offscreen round-trip << saved kernel-sim cost. |
| Mixed merge return ordering bug | MED | Unit test #8 explicitly pins concat order. |
| `FeeOptions` schema bump breaks unrelated consumer | LOW | `maxPriorityFeesPerGas?:` is optional; no consumer is required to send it. |
| First-tx mixed case silently falls back without optimization | LOW | Documented; tracked follow-up to add normalizer if a real use case emerges. |

**Rollback**: `git reset --hard 0ee26eb9`. v0.14.6 is the always-safe baseline.

## No data migrations needed

Wallet has no production users (memory `feedback_no_data_migrations.md`). The only schema-shaped change in this plan is the wire-format addition of `maxPriorityFeesPerGas?` on `FeeOptions` in `wallet-bridge/src/operation.ts`. This is:

- An **optional** field, so existing dApp requests / SW dispatches that don't include it continue to work.
- **Not** a persisted-storage shape — `FeeOptions` is constructed fresh per operation. No on-disk rows need translation.

There's no need to bump `runStorageMigration` or write any "old → new shape" conversion logic. Type-level optionality is sufficient.

## What's deliberately NOT in this plan

1. **First-tx multicall normalizer**: routed to standard path. Future work if needed.
2. **`accountFeePaymentMethodOptions`** unification: Nulo uses `NuloFeePaymentMethod` enum (`FeeJuice` / `FeeJuiceWithClaim` / `External`); upstream uses `AccountFeePaymentMethodOptions`. Different concepts. Out of scope; only gas-settings completion is unified.
3. **Nulo-local merge helper**: dropped per user preference (memory `feedback_prefer_upstream_defaults.md`). We call upstream `buildMergedSimulationResult` directly. Wrap step (Step 3b) produces the input shape upstream expects.
4. **Embedded-FPC override to 1× min fees** (existing in `execution/service.ts:1603` for embedded payments): kept as-is, Nulo-specific budget constraint.
