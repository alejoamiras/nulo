# PR 8c re-implementation — proper class rehydration

**Branch checkpoint to roll back to if this doesn't pan out:** `4f6c640a` (v0.14.3, PR 8c disabled, dApp simulateTx routes through standard PXE path).

**Codex review session**: `019e16ec-9c1c-7de2-9fad-993141c42496` (v1: `fix-and-reshow`, v2: `one-more-pass`, v3: addresses gas-settings translator + log-once wording + multi-batch test).

## What we're solving

`executeAztecSimulateTx` receives `op.exec.calls` that have *travelled over an RPC boundary* (dApp → content-script → SW, or popup → SW). RPC strips JavaScript prototypes — what arrives is plain JSON conforming to the structural type, not real `FunctionCall` instances. The previous PR 8c attempt called `call.isPublicStatic()` (a prototype method) on these plain objects → `TypeError: s.isPublicStatic is not a function`.

The standard path doesn't have this problem because `planner.processAztecJsPayload(op.exec, op.opts)` rehydrates everything via `FunctionCall.schema.parseAsync(_call)` as part of its preprocessing (`packages/extension/src/wallet/services/execution/operation-planner.ts:192-193`). PR 8c wanted to skip that work, but skipping the planner also skipped the rehydration.

Confirmed via dispatcher inspection: `packages/wallet-bridge/src/dispatcher.ts:671-678` — `op.exec` is a bare `args[0] as ...` cast, no validation. The SW receives whatever the dApp sent.

## Goal

Re-enable the fast path for pure-public-static dApp simulateTx payloads, with:

1. **Correct rehydration**: convert plain-JSON calls into real `FunctionCall` instances (and their nested `FunctionSelector` / `AztecAddress` / `Fr` types) BEFORE handing them to upstream's `simulateViaNode`.
2. **Cheap precheck**: avoid the rehydration cost when the payload is obviously not optimizable.
3. **Boundary safety**: helper guards `calls` against `undefined` / non-array shapes (dispatcher does not validate).
4. **Upstream-faithful gas-settings flow**: pick up `op.opts.fee?.gasSettings` if the dApp supplied one, otherwise use estimation defaults — matches `base_wallet.ts:224-257` semantics.
5. **Differentiated error policy**: contract reverts (`SimulationError`) surface to the dApp via the fast path directly (no log, no fall-back — re-simulating through PXE would produce the same revert 3-5 s later); infrastructure errors fall back to standard path with an error log.
6. **PURE-only restriction preserved** from the previous audit: no remainder arm, no `appCallOffset` wrapper.
7. **Unit tests** for both the helper and a thin orchestration shim (split out specifically so we can test fallback policy + gas-settings flow without instantiating 20 services).

## Upstream APIs (verified)

- `FunctionCall.schema` (static getter, `@aztec/stdlib/abi/function_call.ts:49-61`) — `z.object(...).transform(FunctionCall.from)` with hex-string nested schemas (`AztecAddress.schema`, `FunctionSelector.schema`, `Fr.schema`). **NOT idempotent on already-hydrated instances** — the nested schemas use `hexSchemaFor` which expects a hex string, not the rich type. The helper therefore only accepts RPC-shaped input; on internal paths that pass real instances we either don't go through this path at all (standard path) or we accept the parse cost is non-applicable. We do NOT special-case `instanceof FunctionCall` because (a) it's a single check site, (b) zod's failure is caught and falls back cleanly, (c) the production hot path is always RPC-shaped.
- `FunctionType` is string-backed (`@aztec/stdlib/abi/abi.ts:166-170`) so `=== FunctionType.PUBLIC` survives JSON-round-trip.
- `ExecutionPayload.calls` is flat (`@aztec/stdlib/tx/execution_payload.ts:11-26`). Entrypoint wrapping happens later in `buildTxExecutionRequest`, not inside `op.exec.calls` itself — no nested-wrapper hazard.
- `SimulateOptions.fee?: GasSettingsOption & FeeEstimationOptions` (`@aztec/aztec.js/wallet/wallet.d.ts:166-170`). Upstream `BaseWallet.simulateTx` threads `opts.fee?.gasSettings` into `completeFeeOptions({forEstimation: true, ...})` and passes the resulting `feeOptions.gasSettings` to `simulateViaNode` (`base_wallet.ts:230-260`).
- `simulateViaNode` throws `publicOutput.revertReason` (typed `SimulationError | undefined`, `@aztec/stdlib/tx/public_simulation_output.d.ts:25`) when the public sim reverts. `SimulationError extends Error` (`@aztec/stdlib/errors/simulation_error.d.ts:63`).

## Design

### Helper: `tryRehydratePureStaticPrefix`

Pure function. Lives in a new module `packages/extension/src/wallet/services/execution/fast-path.ts` so it can be tested without dragging the 20-dep service container in.

```ts
import { FunctionCall, FunctionType } from "@aztec/stdlib/abi"
import type { ExecutionPayload } from "@aztec/stdlib/tx"

/**
 * Returns rehydrated `FunctionCall[]` if the payload's leading run is
 * entirely public-static, or `null` to signal "not optimizable, fall
 * back to the standard path."
 *
 * Pure-only restriction: any non-public-static call anywhere in the
 * payload disqualifies the fast path (we don't take a public-static
 * prefix + remainder split — the appCallOffset and chain-head
 * concerns from the prior audit still apply for mixed payloads).
 *
 * Accepts `readonly unknown[] | undefined` because the wallet-bridge
 * dispatcher does not validate `op.exec.calls` before dispatch
 * (`dispatcher.ts:671-678`), so a malformed dApp payload can drop
 * `undefined` here.
 *
 * Does NOT support already-hydrated `FunctionCall` instances —
 * `FunctionCall.schema` uses hex-string nested parsers that reject
 * rich types. In production this is fine: the SW boundary always
 * delivers RPC-shaped input.
 */
export function tryRehydratePureStaticPrefix(
  calls: readonly unknown[] | undefined,
): FunctionCall[] | null {
  if (!Array.isArray(calls) || calls.length === 0) return null

  // Cheap data-only precheck. Skips the zod-parse cost when the
  // payload is obviously not optimizable.
  for (const c of calls) {
    if (typeof c !== "object" || c === null) return null
    const obj = c as { type?: unknown; isStatic?: unknown }
    if (obj.type !== FunctionType.PUBLIC || obj.isStatic !== true) return null
  }

  // All calls are pure-public-static — rehydrate. Zod parses recursively
  // and may throw on malformed inputs (e.g. test fixtures with partial
  // data, or future schema drift). Caller treats null as "fall back."
  try {
    return calls.map((c) => FunctionCall.schema.parse(c))
  } catch {
    return null
  }
}
```

### Orchestration shim: `runFastPath`

Extracted as a free function so the fallback / log / gas-settings policy is testable in isolation. Takes the things it needs as plain args; no service-container surface.

```ts
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractNameResolver } from "@aztec/pxe/client/lazy"
import { simulateViaNode } from "@aztec/wallet-sdk/base-wallet"
import { SimulationError } from "@aztec/stdlib/errors"
import { GasFees, GasSettings } from "@aztec/stdlib/gas"
import { Fr } from "@aztec/foundation/curves/bn254"
import { TxSimulationResult } from "@aztec/stdlib/tx"
import type { SimulateOptions } from "@aztec/aztec.js/wallet"

/**
 * Mirrors upstream `BaseWallet.completeFeeOptions({ forEstimation: true, ... })`
 * for the fast-path use case (`base_wallet.ts:128-160`). The dApp may pass
 * `opts.fee?.gasSettings` as `Partial<FieldsOf<GasSettings>>` — at the RPC
 * boundary that's plain JSON with hex-string fields, not real instances —
 * so this translator (a) reads through the partial RPC shape, (b) rebuilds
 * `Gas` / `GasFees` via their static `.from(...)` constructors, and
 * (c) defaults `maxFeesPerGas` from `node.getCurrentMinFees() * (1 + padding)`
 * when the dApp didn't supply one (same default as upstream).
 *
 * Upstream's `minFeePadding` is `0.5` (`base_wallet.ts:32`); we mirror it.
 */
const MIN_FEE_PADDING = 0.5

async function buildFastPathGasSettings(
  node: AztecNode,
  partial: PartialGasSettingsRPC | undefined,
): Promise<GasSettings> {
  const maxFeesPerGas = partial?.maxFeesPerGas
    ? GasFees.from(partial.maxFeesPerGas)
    : (await node.getCurrentMinFees()).mul(1 + MIN_FEE_PADDING)

  return GasSettings.forEstimation({
    gasLimits: partial?.gasLimits ? Gas.from(partial.gasLimits) : undefined,
    teardownGasLimits: partial?.teardownGasLimits ? Gas.from(partial.teardownGasLimits) : undefined,
    maxFeesPerGas,
    maxPriorityFeesPerGas: partial?.maxPriorityFeesPerGas ? GasFees.from(partial.maxPriorityFeesPerGas) : GasFees.empty(),
  })
}

/** RPC-shaped `Partial<FieldsOf<GasSettings>>` — hex-string fields, no
 *  prototypes. We deliberately type it as `unknown`-friendly because
 *  the SW boundary doesn't validate (dispatcher just casts). */
type PartialGasSettingsRPC = {
  gasLimits?: unknown
  teardownGasLimits?: unknown
  maxFeesPerGas?: unknown
  maxPriorityFeesPerGas?: unknown
}

export interface FastPathDeps {
  node: AztecNode
  fromAddr: AztecAddress
  opts: SimulateOptions
  rehydrated: FunctionCall[]
  getContractName: ContractNameResolver
  logError: (msg: string, err: unknown) => void
}

/**
 * Returns:
 *  - `TxSimulationResult` on success
 *  - `null` if any boundary check fails (no block header, infrastructure
 *    error in simulateViaNode) — caller falls back to the standard path
 *
 * THROWS `SimulationError` from the fast path on contract reverts so
 * the dApp sees the same revert it would get from the standard path,
 * minus 3-5 s of PXE round-trip. Re-routing reverts through standard
 * would just produce the same error slower.
 */
export async function runFastPath(deps: FastPathDeps): Promise<TxSimulationResult | null> {
  const { node, fromAddr, opts, rehydrated, getContractName, logError } = deps

  // Single try/catch covers every infra step: getBlockHeader,
  // getNodeInfo, the gas-settings translator's getCurrentMinFees
  // fallback, AND simulateViaNode itself. Only SimulationError
  // (contract revert) propagates — the real sim outcome — so the
  // caller doesn't double-simulate via the standard path.
  try {
    const blockHeader = await node.getBlockHeader()
    if (!blockHeader) return null // node has no synced block — fall back

    const nodeInfo = await node.getNodeInfo()
    const chainInfo: ChainInfo = {
      chainId: new Fr(nodeInfo.l1ChainId),
      version: new Fr(nodeInfo.rollupVersion),
    }

    // Translate partial RPC-shaped fee settings into a real `GasSettings`.
    // Defaults match upstream `completeFeeOptions({forEstimation:true, ...})`.
    const gasSettings = await buildFastPathGasSettings(node, opts.fee?.gasSettings as PartialGasSettingsRPC | undefined)

    const optimizedResults = await simulateViaNode(
      node,
      rehydrated,
      fromAddr,
      chainInfo,
      gasSettings,
      blockHeader,
      opts.skipFeeEnforcement ?? true,
      getContractName,
    )

    // Inline merge — see prior-attempt commentary for the no-wrapper rationale.
    const allReturnValues = optimizedResults.flatMap((r) => r.publicOutput?.publicReturnValues ?? [])
    const baseResult = optimizedResults[0]
    const mergedPublicOutput = baseResult.publicOutput
      ? { ...baseResult.publicOutput, publicReturnValues: allReturnValues }
      : undefined
    return new TxSimulationResult(baseResult.privateExecutionResult, baseResult.publicInputs, mergedPublicOutput, undefined)
  } catch (err) {
    if (err instanceof SimulationError) {
      // Contract revert. Real sim outcome — propagate to the dApp.
      throw err
    }
    // Infrastructure failure (node down, RPC blip, batch-size invariant,
    // serialization bug). Log + signal fallback to caller. No throttling
    // here — same infra failure will surface on the standard path's logs
    // too if it persists, so noise stays co-located.
    logError("[PR 8c] fast-path failed, falling back to standard path", err)
    return null
  }
}
```

### Caller wiring in `executeAztecSimulateTx`

```ts
private async executeAztecSimulateTx(op: AztecSimulateTxOperation): Promise<TxSimulationResult> {
  if (op.accountAddress !== op.opts?.from?.toString()) {
    throw new Error("Invalid `opts.from`")
  }

  const rehydrated = tryRehydratePureStaticPrefix(op.exec?.calls)
  if (rehydrated === null) {
    return this.executeAztecSimulateTxStandard(op)
  }

  const network = await this.networkService.getNetwork(op.networkId)
  const node = await this.networkService.getNode(network.chainId)

  const result = await runFastPath({
    node,
    fromAddr: AztecAddress.fromString(op.accountAddress),
    opts: op.opts,
    rehydrated,
    getContractName: async () => undefined,
    logError: (msg, err) => this.logError(msg, err),
  })
  if (result === null) {
    return this.executeAztecSimulateTxStandard(op)
  }
  return result
}
```

### Files

- **New**: `packages/extension/src/wallet/services/execution/fast-path.ts` — `tryRehydratePureStaticPrefix` + `runFastPath`.
- **New**: `packages/extension/src/wallet/services/execution/fast-path.test.ts` — colocated unit tests (per repo convention).
- **Modified**: `packages/extension/src/wallet/services/execution/service.ts` — restore PR 8c entry-point body using the helpers; drop the standalone imports that previously lived inline (`simulateViaNode`, `extractOptimizablePublicStaticCalls`, `ContractNameResolver`, `TxSimulationResult` as value — these all move to `fast-path.ts`).

### Test plan — fast-path.test.ts

**Helper tests** (pure data, no mocks):

| # | Test | Expected |
|---|------|----------|
| 1 | `tryRehydrate(undefined)` → null | null |
| 2 | `tryRehydrate(null)` → null | null |
| 3 | `tryRehydrate("not-an-array")` → null | null |
| 4 | `tryRehydrate([])` → null | null |
| 5 | One pure-private call → null | null, no zod parse triggered |
| 6 | One public-but-non-static call → null | null |
| 7 | Mixed `[public-static, private]` → null | null |
| 8 | One RPC-shaped public-static call → `FunctionCall[]` of length 1 | result[0] is `FunctionCall`, `.isPublicStatic()` returns true |
| 9 | Three RPC-shaped public-static calls → 3 rehydrated | each instance, all isPublicStatic() true |
| 10 | RPC roundtrip — `JSON.parse(JSON.stringify(realCall))` → rehydrates | values equal to original (compare via toString / toJSON) |
| 11 | Malformed (missing `selector`) → null | helper catches zod throw |
| 12 | Malformed (`args` contains non-hex) → null | helper catches zod throw |

**Orchestration tests** for `runFastPath` (mocks: a fake `AztecNode` returning `getBlockHeader` / `getNodeInfo` / `getCurrentMinFees`; spy `simulateViaNode` via module-level `vi.mock("@aztec/wallet-sdk/base-wallet", ...)`):

| # | Test | Expected |
|---|------|----------|
| 13 | `node.getBlockHeader()` returns undefined → returns null (fallback signal) | null returned; `simulateViaNode` not called |
| 14 | Happy path — `simulateViaNode` returns `[oneResult]` → returns merged `TxSimulationResult` | merged result returned; publicReturnValues == oneResult.publicReturnValues |
| 15 | `simulateViaNode` throws `SimulationError` → re-throws | error propagates; logError NOT called |
| 16 | `simulateViaNode` throws generic `Error` → logs + returns null | logError called once; null returned |
| 17 | `opts.fee.gasSettings.maxFeesPerGas` provided (RPC-shaped) → translator builds real `GasFees` and passes it through | inspect captured `gasSettings.maxFeesPerGas`; equals `GasFees.from(rpcShape)` |
| 18 | `opts.fee.gasSettings.maxFeesPerGas` ABSENT → translator calls `node.getCurrentMinFees().mul(1.5)` and uses that | inspect captured `gasSettings.maxFeesPerGas`; equals minFees.mul(1.5); `getCurrentMinFees` was called |
| 19 | Multi-batch — `simulateViaNode` returns `[batchA, batchB]` → publicReturnValues are concatenated in order | merged.publicOutput.publicReturnValues == [...batchA.publicReturnValues, ...batchB.publicReturnValues]; rest of shape (privateExecutionResult, publicInputs) comes from batchA |
| 20 | `node.getNodeInfo()` throws → treated as infra-fallback | logError called once; null returned |
| 21 | `opts.fee.gasSettings` includes only `maxPriorityFeesPerGas` → `maxFeesPerGas` still defaults from node | both fields end up as real `GasFees`; maxPriorityFeesPerGas == GasFees.from(rpcShape), maxFeesPerGas from node default |
| 22 | `opts.fee.gasSettings.maxFeesPerGas` is malformed → `GasFees.from(...)` throws inside the translator → caught by `runFastPath`'s single try/catch → logError + null | logError called once; null returned; `simulateViaNode` NEVER called |

**Mocking strategy for orchestration**: `simulateViaNode` is imported from `@aztec/wallet-sdk/base-wallet`. Two options:

(a) Use `vi.mock("@aztec/wallet-sdk/base-wallet", ...)` at the top of the test file.
(b) Inject `simulateViaNode` via a dep argument on `runFastPath`. Cleaner but adds a permanent test-only seam.

Going with (a) — vitest module mocking. The mock returns canned `TxSimulationResult` for happy cases and throws controlled errors for failure cases. The `AztecNode` itself can be a hand-rolled minimal stub object literal (`getBlockHeader`, `getNodeInfo` are the only methods touched in `runFastPath`).

### Verification gate (must pass to land)

1. `bun run typecheck:all` — clean across 8 packages
2. `bun run test` — existing 1401 + new 22 tests pass
3. `bun run lint` — only pre-existing warnings
4. `bun run build:full` — chrome + firefox both at the new patch version
5. `bun run e2e:agent` — same or better failure profile than `4f6c640a`'s baseline:
   - cap-request-rerequest (load flake on master too)
   - session-reconnect alwaysTrust=true (pre-existing master bug)
   - send-amount-clamp (pre-existing master bug)
   - **`connect-dapp` MUST pass** — this is the regression that disappeared in v0.14.3 and confirms PR 8c was the cause
6. Manual smoke: dApp `aztec_simulateTx` for a pure-public-static query (balance read) returns correct value end-to-end.

### Risk summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Zod parse rejects a valid payload due to schema drift | LOW | try/catch → null → standard path |
| `simulateViaNode` semantics change in future upstream | LOW | pinned to 4.2.0; bump goes through audit |
| Revert error gets thrown twice (once via fast path, once via standard) due to log policy bug | MED | covered by tests #15, #16 |
| `opts.fee.gasSettings` ignored — dApp gets default settings | MED | covered by tests #17, #18; matches upstream behavior |
| Helper called from internal code paths with real instances | LOW | doesn't happen today (only dApp entry); helper documented to be RPC-input-only; zod will reject and fall back if it ever does |

### Rollback

If verification 5 or 6 fails: `git reset --hard 4f6c640a`. Push branch as v0.14.3.

### Out of scope

- Mixed public-static-prefix + remainder fast path (needs PXE synced-header surface via IPXE).
- Eager rehydration at the dispatch boundary (large surface change; the fast-path local approach is sufficient).
- Schema-drift telemetry beyond a one-time error log — if the helper ever falls back due to malformed input on a real dApp call, the standard path's `planner.processAztecJsPayload` will produce the same zod-parse error with full diagnostic context.
