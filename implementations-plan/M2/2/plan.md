# M2.2 — Split `ExecutionService` (7 sub-PRs, ~3-5 weeks)

> **Status (2026-04-22)**: **M2.2-a/c/e/d/b/f shipped + merged. M2.2-g skipped by user decision.**
>
> The original plan for `M2.2-g` (feature flag + parallel-run comparator + 9 golden fixtures) assumed a **strangler-fig split** where the legacy pipeline lived alongside the new collaborators and both ran in parallel mode to prove equivalence before the old code was deleted. We shipped **drop-in style** instead — each sub-PR replaced the god-service method in place, so there's no legacy pipeline to compare against. The feature-flag + comparator are architecturally moot.
>
> Golden fixtures (the one component that still has value — they catch `@aztec/*` version-bump drift) could be added later as a quality-of-life regression suite if needed. Not a blocker today; e2e coverage + manual QA is the verification bar for now.
>
> **If fixtures are added later**: capture the 9 canonical `TxExecutionRequest` shapes per codex's Q7 answer (see `audit-codex.md`), commit under `tests/fixtures/execution/`, add a canonical-equality unit test. ~1-2 days of work.

## Context & entry state

ExecutionService at `packages/extension/src/wallet/services/execution/service.ts` — **2426 LOC**, the largest god-service in the codebase. It orchestrates transaction execution end-to-end: operation dispatch, fee estimation, contract resolution, tx payload assembly, authwit discovery, simulation, proving, sending, and journal updates.

After M2.1 shipped, the facade pattern is proven. M2.2 applies the same playbook but larger. Key difference: **incremental merging is mandatory**. Both v3-plan audits flagged M2.2 as multi-PR, not one big-bang. The final sub-PR (M2.2-g) is a feature-flagged parallel-run + golden-fixture verification to catch behavior drift before the old pipeline is deleted.

### Targets (from `architecture/plan/03-final-plan-v3.md:145-161`)

**Execution order (post-audit): `a || c → e → d → b → f → g`**. Both audits flagged that FeeStrategy depends on TxRequestBuilder depends on AuthwitDiscoverer; original `a → b → c → d → e` cannot ship as written.

| Slot | Sub-PR | Extract | Est. | Depends on |
|---|---|---|---|---|
| 1 | M2.2-a | `OperationPlanner` — normalize incoming ops | 3-4d | (can parallelize with c) |
| 1 | M2.2-c | `ContractResolver` — pulled from ExecutionService AND PxeService | 3-4d | (can parallelize with a) |
| 2 | M2.2-e | `AuthwitDiscoverer` — decouple from `AuthRegistryService` side-effect | 3-4d | c |
| 3 | M2.2-d | `TxRequestBuilder` — payload assembly + account entrypoint call (+ NoFrom variant) | 3-4d | c, e |
| 4 | M2.2-b | `FeeStrategy` interface + 4 impls (FJ / FJWC / FPC / Embedded) | 1w | d |
| 5 | M2.2-f | `ExecutionCoordinator` — wraps pipeline, owns journal updates (from M1.1) | 3-4d | a, b, c, d, e |
| 6 | M2.2-g | Feature flag + parallel-run + golden-fixture verification | 1-1.5w | f |

### Entry state (verified via discovery — 2026-04-22)

- **Public surface** (from `spec.ts`): `executeTransfer`, `executeOperations`, `getGasBalances`, `estimateTransferFee`, `estimateOperationFee`. **This public surface is frozen across the split.** Clients (popup, wallet-sdk background) call it; we change nothing observable.
- **Operation kinds**: 22 kinds across `models/operation.ts` — Nulo ops (`send_transaction`, `simulate_transaction`, `register_*`, `get_complete_address`) + Aztec.js ops (`aztec_sendTx`, `aztec_simulateTx`, etc.).
- **Fee branches**: 4-way switch at `service.ts:1796-1916` in `buildAndEstimateTxRequest` — `fj` | `fjwc` | `fpc` | `embedded`. Each branch mutates a local-cloned `op.actions` array.
- **Authwit side-effect**: `buildTxRequest` at `service.ts:2033-2064` calls `authRegistryService.trackAuthwit()` DURING tx-request assembly (before simulation). Writes registry state as a side-effect of estimation. **This is the decoupling M2.2-e targets.**
- **Contract resolution overlap**: `getInstances / getInstance / getArtifacts / getArtifact` at `service.ts:2353-2425` duplicates logic found in `pxe/service.ts:123-163`. M2.2-c is the consolidation; it ships before M2.3-b consumes it.
- **Journal integration (M1.1)**: `executeTransfer` writes `planned → proving → submitted/failed` via `operationJournal` (`service.ts:310-327`). The state machine is inline; M2.2-f owns it.
- **DefaultEntrypoint special case**: `executeNoFromSendTx + buildNoFromTxRequest` at `service.ts:1321-1542`. Inlined DefaultEntrypoint logic (cannot import from `@aztec/*` in SW context — the upstream class references `window`). Handled separately in the FeeStrategy-embedded branch.
- **Gas-balance cache** (`service.ts:173-208, 973-1070`): 5-min TTL + single-flight dedup, invalidated on transaction completion. **Scope gap** — doesn't fit any of a-f cleanly; folded into M2.2-g or becomes a hidden M2.2-h (decision below).
- **Services injected today**: PxeServiceClient, ProfileService, NetworkService, AccountService, ContactService, TokenService, FpcService, TransactionService, AuthRegistryService, TaskService, OperationJournalService. None change.

### Gap decisions (flagged by discovery, refined by audit)

1. **Gas-balance cache** (`GAS_BALANCE_TTL_MS`, `gasBalanceCache`, `gasBalanceInFlight`, `#computeGasBalances`) → extracted in M2.2-f as a small `GasBalanceCache` helper class. **Audit correction**: **facade-owned, not coordinator-owned**. `getGasBalances` is a public RPC (spec.ts:41), not a send-pipeline step. Coordinator may inject + share the helper and call `invalidateForAccount`, but the `getGasBalances` method body stays on the facade.
2. **Priority multipliers** → M2.2-b FeeStrategy (unchanged).
3. **Capsules / extraArgs** → M2.2-d TxRequestBuilder (unchanged).
4. **No-From / DefaultEntrypoint** → **M2.2-d with an explicit `buildNoFrom` + its own discover/simulate/finalize loop (from service.ts:1358-1405)**. Previously the plan said "FeeStrategy.Embedded is the only strategy that drives DefaultEntrypoint" — audit caught this conflates two concepts: (a) normal `"embedded"` fee uses `buildAndEstimateTxRequest`'s embedded branch, (b) `"default_entrypoint"` short-circuits to its own pipeline. Fix: `TxRequestBuilder` owns both the `buildStandard` + `buildNoFrom` methods AND the NoFrom-specific discovery/scope logic. `FeeStrategy.Embedded` remains the only fee strategy that drives the NoFrom path's `buildMode: "no_from"`, but the pipeline is NOT conflated.
5. **Pass-through Aztec.js RPC** → stays on the facade (unchanged).
6. **Preview / shared-builder consumers** (NEW — audit finding): `executeSimulateTransaction` (service.ts:690-701), `executeAztecSimulateTx` (1182), `executeAztecProfileTx` (1230), `executeSimulateViews` (756) all reuse normalization, request building, and gas handling but are NOT send-pipeline ops. **These are NOT part of ExecutionCoordinator's send-pipeline flow**. They consume `TxRequestBuilder` (M2.2-d) directly, return without proving/sending, and live on the facade side as thin read-only methods. Coordinator handles only the prove/send pipeline.
7. **Internal `executeSendTransaction`** (service.ts:660-688) is called directly by `AuthRegistryService` (for `revokeAuthwits`, `setRegistryEnabled`). After M2.2-f the facade's internal delegate becomes `coordinator.execute({ kind: "send_transaction", ... })`. Document this callsite explicitly in the M2.2-f PR description.

## Architecture invariants (preserved across all 7 sub-PRs)

1. **RPC surface frozen** — `spec.ts` unchanged. Zero changes to message shapes.
2. **Error strings frozen — preserved BY CALL SITE, not by collaborator-wide normalization** (audit correction). Every throw in discovery section 9 preserved verbatim, including the formatted variant `"Contract artifact not found for class ${classId}"` at service.ts:2419 (which differs from the bare `"Contract artifact not found"`). Popup matches on specific strings (`"Wallet locked"`, `"Unauthorized"`, `"Invalid operation"`, etc.).
3. **Event emissions unchanged** — no new events added, none removed.
4. **Side-effect ordering (post M2.2-e)**: `trackAuthwit` moves from *during estimation* to *after successful send*. This is a DELIBERATE semantic change — document in the PR, verify no UI code relies on the early-write. **Side-benefit noted by audit**: current FPC 2-pass double-writes the registry; moving to post-send dedups.
5. **Storage keys frozen** — journal key `nulo:operation-journal`, token-balances key `nulo:core:token-balances`, etc. No collaborator owns new storage.
6. **M1.1 journal contract** — `createOperation` / `updateOperationState` calls happen from the coordinator at the same life-cycle points as today. A journal consumer watching for `proving → submitted` transitions sees the same trace.

## Per-sub-PR specifications

### M2.2-a — `OperationPlanner`

**Purpose**: Normalize every incoming `Operation` shape into a single internal `PlannedOperation` that downstream collaborators consume. Eliminates the `switch(op.kind)` scattered across the facade.

**New file**: `src/wallet/services/execution/operation-planner.ts`

**Surface**:
```ts
/**
 * Normalized operation shape after parsing + validation. Downstream
 * collaborators (TxRequestBuilder, FeeStrategy, ExecutionCoordinator)
 * consume this instead of the raw union.
 */
export type PlannedOperation =
  | { kind: "transfer"; accountAddress, networkId, token, recipient, amount, fromType, toType, action: EncodedCallAction, feeSettings }
  | { kind: "send_transaction"; accountAddress, networkId, actions: Action[], feeSettings }
  | { kind: "aztec_send_tx"; accountAddress, networkId, actions: Action[], feeSettings, opts: SendTxOpts }
  | { kind: "aztec_send_tx_no_from"; accountAddress, networkId, call: FunctionCall, capsules, extraArgs, feeSettings }
  | { kind: "simulate_*" | "register_*" | "aztec_get_*" | ... }  // pass-throughs

export class OperationPlanner {
  constructor(private readonly tokens: TokenService) {}

  /** Build a transfer operation from user-supplied params. Resolves the
   *  token's transfer function against its fromType/toType. Throws the
   *  same "Transfer type not supported" / "Invalid transfer type"
   *  strings as today (service.ts:231-262). */
  async planTransfer(params: TransferParams): Promise<PlannedOperation & { kind: "transfer" }>

  /** Parse an Aztec.js ExecutionPayload into a normalized action array.
   *  Equivalent of today's processAztecJsPayload (service.ts:1642-1710).
   *  Detects embedded fee payment via feePayer comparison. */
  async planAztecJsSend(op, opts): Promise<PlannedOperation & { kind: "aztec_send_tx" | "aztec_send_tx_no_from" }>

  /** Planner routes a raw Operation to the right planX method.
   *  Throws "Invalid operation" for unknown kinds. */
  async plan(op: Operation, origin?: string): Promise<PlannedOperation>

  /** Extract the method name for task-display purposes (service.ts:463-474). */
  extractPrimaryMethod(op: PlannedOperation): string | undefined
}
```

**What moves**: `buildTransferOperation` (211-287), `processAztecJsPayload` (1642-1710), `extractPrimaryMethod` (463-474).

**Dependencies**: TokenService (unchanged).

**What stays on the facade**: `executeOperations` dispatcher (still switches on kind), `executeTransfer` (still orchestrates). Both consume `PlannedOperation` from the planner now.

**Test strategy**:
- Unit: `operation-planner.test.ts` exercises every `planX` path + error cases. Uses fake TokenService (no chrome.*).
- Integration unchanged — facade still calls planner then old pipeline.

**Rollback**: Drop-in; revert the one file + inline calls.

---

### M2.2-b — `FeeStrategy` + 4 implementations

**Purpose**: Extract the 4-way fee-branch switch (`service.ts:1796-1916`) into a polymorphic strategy interface. Each impl owns its own fee payload injection + simulate/finalize sequence.

**New files**:
- `src/wallet/services/execution/fee/fee-strategy.ts` (interface)
- `src/wallet/services/execution/fee/fee-juice-strategy.ts`
- `src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts`
- `src/wallet/services/execution/fee/fpc-strategy.ts`
- `src/wallet/services/execution/fee/embedded-strategy.ts`

**Surface** (post-audit corrections: widened FeeEstimateResult to the full 8-field bundle + `buildMode` discrimination):
```ts
export interface FeeStrategy {
  readonly kind: "fj" | "fjwc" | "fpc" | "embedded"

  /** Build the full TxExecutionRequest with fee actions already injected,
   *  run the needed simulate/re-simulate passes, and return the finalized
   *  prepared bundle. Mirrors the current buildAndEstimateTxRequest
   *  behavior for the strategy's specific branch. */
  buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimateResult>
}

export type FeeStrategyContext = {
  op: PlannedOperation
  feeSettings: FeeSettings
  /** Encodes whether to use `buildStandard` (account wallet entrypoint)
   *  or `buildNoFrom` (DefaultEntrypoint path). Only FeeStrategy.Embedded
   *  supports "no_from"; others throw. */
  buildMode: "standard" | "no_from"
  deps: {
    txRequestBuilder: TxRequestBuilder   // M2.2-d
    contractResolver: ContractResolver   // M2.2-c
    authwit: AuthwitDiscoverer           // M2.2-e
    pxe: PxeServiceClient
    network: NetworkService
    fpc: FpcService
    tasks: TaskService
    parentTask?: string
  }
}

/** Full prepared bundle — post-audit widened from 3 fields to the 8-tuple
 *  today's callers destructure at service.ts:340, 663, 1280. Coordinator
 *  and call-sites consume the whole bundle; no field is "internal". */
export type FeeEstimateResult = {
  txRequest: TxExecutionRequest
  simulatedTx: TxSimulationResult
  gasDetails: GasDetails
  /** Post-estimation fee-payment method (may differ from input, e.g., FPC
   *  pass 2 settles on External). */
  feePaymentMethod: NuloFeePaymentMethod
  /** Resolved at phase 1 of the strategy's work; coordinator uses these
   *  to avoid re-fetching during prove/send. */
  account: AccountContract
  network: Network
  node: AztecNode
  pxe: PXE
  /** Account nonce at phase 1 (used for bookkeeping + journal). */
  nonce: Fr
  /** The TxCall[] that ended up in the final TxExecutionRequest, for
   *  transaction-history recording post-send. */
  txCalls: TxCall[]
}
```

**What moves**:
- `buildAndEstimateTxRequest` (1772-1921) — split across the 4 impls.
- `suggestGasLimits` (1712-1735) — shared helper, lives at `execution/fee/gas-helpers.ts` (or as a static method on `FeeStrategy`). Called by FJ + Embedded; FPC + FJWC have custom gas logic.
- `finalizeGasLimits` (1737-1770) — shared helper, same location.
- `PRIORITY_MULTIPLIERS` lookup + `feeMultiplier` application — lives in the shared helper.

**Dependencies (per strategy)**:
| Strategy | Extra deps |
|---|---|
| FJ | none beyond `deps` |
| FJWC | none (claim payload is in `feeSettings.paymentMethod`) |
| FPC | `FpcService` (fetches impl), node.getCurrentMinFees |
| Embedded | only the `feePayer` in the exec payload |

**What stays on the facade**: a small dispatcher `feeStrategies.get(feeSettings.paymentMethod.kind)` that forwards to the right strategy. No business logic.

**Test strategy**:
- Per-strategy unit tests mock the `FeeStrategyContext.deps` and verify the right actions are prepended, the right simulation calls fire with the right flags, and the final `FeeEstimateResult` matches golden output.
- Regression integration test: run `executeTransfer` with each of the 4 fee methods against a fake PXE; assert the sent `TxExecutionRequest` matches the pre-split golden fixture byte-for-byte.

**Rollback**: Retain the facade-side switch during M2.2-g's parallel run; delete only after golden-fixture verification passes for N weeks.

---

### M2.2-c — `ContractResolver` (shared with PxeService, ships BEFORE M2.3-b)

**Purpose**: Consolidate contract-instance + artifact fetching, currently duplicated between `execution/service.ts:2353-2425` and `pxe/service.ts:123-163`.

**New file**: `src/wallet/services/contract-resolver/resolver.ts`

**Surface**:
```ts
export class ContractResolver {
  constructor(private readonly pxe: PxeServiceClient) {}

  /** Fetch unique contract instances for the given addresses. Parallel
   *  fetch, returns a Map keyed by address string. Throws
   *  "Contract instance not found" on miss — matches today's behavior. */
  async resolveInstances(network: NetworkId, addresses: AztecAddress[]): Promise<Map<string, ContractInstanceWithAddress>>

  /** Fetch unique contract artifacts by class id, deduped. Throws
   *  "Contract artifact not found" on miss. */
  async resolveArtifacts(network: NetworkId, instances: ContractInstanceWithAddress[]): Promise<Map<string, ContractArtifact>>

  /** Convenience: instances + artifacts in one call. */
  async resolveInstancesAndArtifacts(
    network: NetworkId,
    addresses: AztecAddress[],
  ): Promise<{ instances: Map<string, ContractInstanceWithAddress>; artifacts: Map<string, ContractArtifact> }>

  /** Action-tree traversal: pull every AztecAddress referenced by any
   *  action in the list (authwits + calls). Equivalent of today's
   *  getContracts (service.ts:2353-2378). */
  extractContracts(actions: Action[]): AztecAddress[]
}
```

**What moves**:
- `getContracts` (2353-2378)
- `getInstances / getInstance` (2380-2398)
- `getArtifacts / getArtifact` (2400-2425)

**What stays in PxeService**: the lower-level `getContractInstance` / `getContractArtifact` RPC methods (lines 123-163). These are the PXE-facing primitives; ContractResolver is the higher-level orchestrator that uses them.

**Test strategy**:
- Unit: `contract-resolver.test.ts` with a fake PxeServiceClient. Verify dedup, missing-instance throw, parallel-fetch behavior.

**Cross-cut with M2.3-b**: The ArtifactRegistry (M2.3-b) sits BELOW ContractResolver. ContractResolver asks PxeServiceClient which asks ArtifactRegistry. **Order: M2.2-c ships first, M2.3-b rewires pxeServiceClient.getContractArtifact later.** No ContractResolver change required for M2.3-b.

**Rollback**: Drop-in; the facade-side code calls `contractResolver.resolveX` instead of the inline method.

---

### M2.2-d — `TxRequestBuilder`

**Purpose**: Extract tx payload assembly (`service.ts:1923-2195` for the normal path + `1441-1542` for DefaultEntrypoint).

**New file**: `src/wallet/services/execution/tx-request-builder.ts`

**Surface**:
```ts
export class TxRequestBuilder {
  constructor(
    private readonly pxe: PxeServiceClient,
    private readonly network: NetworkService,
    private readonly accounts: AccountService,
    private readonly resolver: ContractResolver,
    private readonly authwit: AuthwitDiscoverer,     // M2.2-e
  ) {}

  /** Standard path: build a TxExecutionRequest via the account's
   *  AccountWallet entrypoint (DefaultAccountEntrypoint or
   *  DefaultMultiCallEntrypoint + chunking). Invoked by every fee strategy
   *  that isn't "no-from DefaultEntrypoint". */
  async buildStandard(
    op: PlannedOperation,
    feePaymentMethod: NuloFeePaymentMethod,
    parentTask?: string,
  ): Promise<StandardTxRequestResult>

  /** DefaultEntrypoint variant: single-call, no account wrapper, inlined
   *  DefaultEntrypoint logic (service.ts:1441-1542). Throws
   *  "DefaultEntrypoint requires exactly 1 call" etc. preserved. */
  async buildNoFrom(
    op: PlannedOperation & { kind: "aztec_send_tx_no_from" },
    parentTask?: string,
  ): Promise<NoFromTxRequestResult>
}

export type StandardTxRequestResult = {
  txRequest: TxExecutionRequest
  txCalls: TxCall[]
  account: AccountContract
  node: AztecNode
  pxe: PXE
}
```

**What moves**:
- `buildTxRequest` (1923-2195)
- `buildNoFromTxRequest` (1441-1542)
- Capsule / extraArgs handling (1970-1987, 1506-1513)
- The call-to-`authRegistryService.trackAuthwit` at 2033-2064 MOVES to AuthwitDiscoverer (M2.2-e). TxRequestBuilder produces the prepended `setAuthorized` call but does NOT write registry state.

**What stays on facade**: nothing from tx-request assembly.

**Dependencies**: ContractResolver (M2.2-c) must be merged first.

**Test strategy**:
- Unit: per-call-type unit tests (add_private_authwit, add_public_authwit, call, encoded_call, intent-authwit, capsule, extra_args). Mock ContractResolver + AccountService; assert the TxExecutionRequest shape.
- Integration: standalone transfer test running through buildStandard + fake PXE.

**Rollback**: Drop-in.

---

### M2.2-e — `AuthwitDiscoverer`

**Purpose**: Own authwit discovery + message-hash computation. **Decouple from AuthRegistryService side-effect** — today `buildTxRequest` calls `authRegistryService.trackAuthwit` during assembly, before any simulation. The audit flags this as improper.

**New file**: `src/wallet/services/execution/authwit-discoverer.ts`

**Surface**:
```ts
export class AuthwitDiscoverer {
  constructor(
    private readonly resolver: ContractResolver,
    private readonly pxe: PxeServiceClient,
    private readonly network: NetworkService,
    private readonly accounts: AccountService,
    /** Discoverer knows about AuthRegistryService but never writes to it
     *  during tx building. It produces a `trackedAuthwits: TrackedAuthwit[]`
     *  side-output for the coordinator to flush after a successful send. */
    private readonly authRegistryFlush: AuthRegistryFlushApi,
  ) {}

  /** Kernelless simulation + CallAuthorizationRequest extraction. Emits
   *  AddPrivateAuthwitAction[] for the caller to splice into op.actions.
   *  Equivalent of today's discoverRequiredAuthWitnesses (1549-1589). */
  async discoverPrivateAuthwits(
    op: PlannedOperation,
    parentTask?: string,
  ): Promise<AddPrivateAuthwitAction[]>

  /** Compute message hashes for the 4 authwit content kinds. Pure —
   *  no registry write. (Equivalent of getCallMessageHash,
   *  getEncodedCallMessageHash, getIntentMessageHash at 2233-2352.) */
  async computeMessageHash(
    content: AuthwitContent,
    nodeInfo: NodeInfo,
    instances: Map<string, ContractInstanceWithAddress>,
    artifacts: Map<string, ContractArtifact>,
  ): Promise<Fr>

  /** Defer the registry-state mutation until after send. Coordinator
   *  calls this ONLY on successful send. */
  async commitPublicAuthwitTracking(
    tracked: TrackedAuthwit[],
  ): Promise<void>
}

/** Collected by AuthwitDiscoverer during assembly, flushed by the
 *  coordinator after `node.sendTx(...)` returns. */
export type TrackedAuthwit = {
  accountAddress: string
  messageHash: string
  content: AuthwitContent
}
```

**What moves**:
- `discoverRequiredAuthWitnesses` (1549-1589)
- `getCallMessageHash` (2233-2272)
- `getEncodedCallMessageHash` (2274-2339)
- `getIntentMessageHash` (2340-2352)
- The `authRegistryService.trackAuthwit` call (2033-2064) — DEFERRED to `commitPublicAuthwitTracking`.

**Semantic change (DELIBERATE)**: Public authwit tracking happens AFTER successful send, not during tx-request assembly. Pre-M2.2-e: the authwit is "registered as tracked" even if the user cancels the transaction. Post-M2.2-e: only tracked on success. Document in the PR; verify no UI path depends on pre-send tracking.

**Dependencies**: ContractResolver (M2.2-c).

**Test strategy**:
- Unit: `authwit-discoverer.test.ts` mocks PxeService + Account. Verify hash computation for each content kind; verify the kernelless simulation path.
- **Regression**: write a test that runs a public-authwit flow through the old code + new code and asserts the registry state differs at the right moment (during vs after send).

**Rollback**: Drop-in. The AuthRegistryService contract doesn't change — only WHEN trackAuthwit is called.

---

### M2.2-f — `ExecutionCoordinator` (pipeline wrapper + M1.1 journal owner)

**Purpose**: Own the pipeline: `plan → resolve contracts → discover authwits → build tx → estimate fees → prove → send → journal → track authwits`. All fee strategies plug in here. The facade becomes a thin delegator.

**New file**: `src/wallet/services/execution/execution-coordinator.ts`

**Surface**:
```ts
export class ExecutionCoordinator {
  constructor(
    private readonly planner: OperationPlanner,
    private readonly resolver: ContractResolver,
    private readonly txBuilder: TxRequestBuilder,
    private readonly feeStrategies: Map<FeeKind, FeeStrategy>,
    private readonly authwit: AuthwitDiscoverer,
    private readonly gasCache: GasBalanceCache,         // extracted from service.ts:173-208, 973-1070
    private readonly deps: {
      pxe, network, accounts, profile, tasks, journal, transactions, config,
    },
  ) {}

  /** Main entry: runs plan → resolve → authwit → build → estimate → prove
   *  → send → journal. Owns the state machine. */
  async execute(op: Operation, origin: string, parentTask?: string): Promise<OperationResult>

  /** Fee-only path (no prove/send). Used by estimateTransferFee +
   *  estimateOperationFee. */
  async estimate(op: Operation, feeSettings: FeeSettings): Promise<TransferFeeEstimate>

  /** Batch dispatcher (replaces today's executeOperations switch loop). */
  async executeBatch(operations: Operation[], origin: string, parentTask?: string): Promise<OperationResult[]>
}
```

**What moves**:
- `executeOperations` dispatcher loop (476-589)
- The transfer pipeline from `executeTransfer` (289-388)
- The Aztec.js `send_tx` pipeline (1254-1314)
- The DefaultEntrypoint `send_tx` pipeline (1321-1440)
- Journal updates (310-327, 346-365) — now centralized
- Task lifecycle (simulateTxTask / proveTxTask / sendTxTask at 2195-2231) — wrapped
- Gas-balance cache (173-180, 1001-1070) — extracted into `GasBalanceCache` helper in the same PR

**What stays on the facade**: the Service<Methods> scaffolding, RPC binding, `ensureInitialized`, direct pass-through methods (`executeAztecGetChainInfo`, etc.).

**New helper class (same PR)**: `GasBalanceCache` at `src/wallet/services/execution/gas-balance-cache.ts`. TTL + single-flight dedup + invalidate-on-tx-completion. Owned by Coordinator.

**Test strategy**:
- Integration tests that drive the full pipeline through coordinator against a fake PXE.
- Golden-fixture verification at every fee branch (sets up for M2.2-g).

**Dependencies**: All prior sub-PRs must be merged.

**Rollback**: This is the cutover PR. Rollback = revert the coordinator, re-enable the facade-side pipeline. The facade's old methods stay during M2.2-g's parallel run, so rollback is cheap.

---

### M2.2-g — Feature flag + parallel-run + golden-fixture verification

**Purpose**: De-risk the cutover. Run both pipelines in parallel on every tx; compare outputs byte-for-byte against golden fixtures; alert on drift.

**Scope (audit-corrected): parallel-run diffs `TxExecutionRequest` ONLY, not prove/send.** Proving + sending uses the selected authoritative pipeline exclusively. Running prove+send on both pipelines double-charges fees on chain and flakes e2e. The shadow pipeline stops at build/estimate and runs asynchronously (does not block user-visible latency). Comparator canonicalizes + hashes first; computes detailed diff only on mismatch.

**Files**:
- `src/wallet/services/execution/pipeline-comparator.ts` — runs old + new **up to TxExecutionRequest build**, canonicalizes both, diffs, logs discrepancies. Does NOT call proveTx or sendTx on the shadow side.
- `tests/fixtures/execution/*.json` — captured sandbox `TxExecutionRequest`s.
- Feature flag: build-time define `__NULO_EXECUTION_PIPELINE__ = "legacy" | "new" | "parallel"`. Config: `executionPipeline` in `ConfigService` (staff-visible toggle).

**Golden fixture matrix (audit-corrected)**: 9 pipeline shapes, not 4 × 22:
1. `send_transaction` + `fj`
2. `send_transaction` + `fjwc`
3. `send_transaction` + `fpc` private
4. `send_transaction` + `fpc` public
5. `aztec_sendTx` account mode + non-embedded
6. `aztec_sendTx` account mode + embedded `fjwc`
7. `aztec_sendTx` account mode + embedded `fpc`
8. `aztec_sendTx` default_entrypoint + embedded
9. One transfer integration fixture (end-to-end planner coverage)

Read-only/pass-through (`get_*`, `register_*`, `simulate_*`, `aztec_createAuthWit`) is redundant for golden request fixtures. Add degenerate cases (multi-call >5 chunked, extraArgs, capsule) as additional tests if time permits — not required for the core matrix.

**Verification criteria** before old pipeline deletion:
1. 4 weeks of parallel-run on staff devices with **zero** diff alerts at the canonicalized-`TxExecutionRequest` level.
2. All 9 golden fixtures pass on the new pipeline.
3. e2e test suite (smoke + network + transfers) passes on the new pipeline alone.
4. One user-facing PR explicitly calls out the deletion of the legacy pipeline.

**What gets deleted in a follow-up PR**:
- `buildAndEstimateTxRequest`, `buildTxRequest`, `buildNoFromTxRequest`, `executeTransfer` (inline version), the scattered switch-based `executeOperations` — everything duplicated during parallel-run.

**Rollback**: Flip the build-time flag to `"legacy"`. Config-level flip is staff-only; user-level flip not exposed.

---

## Verification cadence (per sub-PR)

After each sub-PR:
1. `bunx vitest run` — full unit suite, target: new tests for the extracted collaborator + no regressions on existing tests.
2. `bun run typecheck` — no new errors vs baseline.
3. `bun run build:chrome` — clean build.
4. `bun run test:e2e` — smoke suite green.
5. `bun run test:e2e:all` — network suite green, **transfers 8/8** mandatory at M2.2-b / d / f.
6. Manual QA at M2.2-b (each fee method end-to-end), M2.2-d (transfer + aztec_sendTx both), M2.2-f (full cutover).

**Integration-test addition cadence**:
- a: operation-planner isolated tests
- b: FeeStrategy × 4 + shared gas-helper tests
- c: ContractResolver dedup + error-path tests
- d: TxRequestBuilder round-trip tests
- e: AuthwitDiscoverer registry-timing regression test
- f: end-to-end pipeline integration tests via ExecutionCoordinator
- g: pipeline-comparator + golden-fixture tests

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **Fee-strategy subtle differences** — each branch has ~50 LOC of specific logic (pass1/pass2 for FPC, claim payload for FJWC). Missing a detail breaks fee estimation silently. | HIGH | Golden fixtures per strategy (M2.2-g). Regression test runs old + new on each fixture. |
| 2 | **TxRequestBuilder's DefaultEntrypoint variant** drift — inlined DefaultEntrypoint logic is brittle (originated because the upstream class references `window`). A future `@aztec/*` bump could change what we should inline. | MED | Pin `@aztec/*` version in M2.6 golden fixtures. Re-verify after every `@aztec` bump via the fixture run. |
| 3 | **AuthwitDiscoverer timing change** (pre vs post-send tracking) breaks a UI flow. | MED | Search the popup + dApp code for `authRegistryService.trackAuthwit`-derived observations. Document the change prominently in the M2.2-e PR. |
| 4 | **Coordinator's journal integration** drift from the M1.1 contract — journal state writes happen at slightly different life-cycle points in the new pipeline. | MED | Replay existing journal traces (from prod logs) through the new coordinator; assert identical state transitions. |
| 5 | **Parallel-run overhead** on end-user latency — M2.2-g doubles the work per tx for staff testing. | LOW | Gate parallel-run behind staff-only config flag. Default users stay on `"new"` after merge-fence passes. |
| 6 | **Gas-balance cache migration** semantics — TTL + single-flight dedup is subtle; Send popup UX depends on it. | MED | GasBalanceCache unit tests must cover: first call, cache hit, cache miss after TTL, concurrent calls during in-flight, invalidate-on-tx. |
| 7 | **@aztec/* version churn** during the 3-5 week arc. | MED | Freeze `@aztec/*` at M2.2 entry; any bump mid-arc triggers full golden-fixture re-run. |
| 8 | **ContractResolver overlaps with M2.3-b** — ArtifactRegistry might want to sit inside ContractResolver, not below PxeService. | LOW | M2.2-c decision: ContractResolver depends on PxeServiceClient (current API); M2.3-b rewires PxeServiceClient internals. Keep the dependency arrow one-way. |

## Pre-formulated codex audit questions (for M2.2 plan audit)

Q1. **FeeStrategy interface completeness**: is `FeeStrategyContext` + `FeeEstimateResult` rich enough to express all 4 current impls without the facade reaching back into strategy internals? Walk the FPC two-pass path specifically — does it fit?

Q2. **Cross-sub-PR dependency ordering**: a → b, c → d → e → f → g. Is this actually minimal? Can any pair be parallelized across developers?

Q3. **AuthwitDiscoverer timing change**: is moving `trackAuthwit` from during-assembly to after-send a safe semantic change? Search the codebase for reads of the registry state mid-flow.

Q4. **`executeOperations` dispatcher ownership**: in M2.2-f the coordinator takes over this loop. But `executeOperations` is the PUBLIC RPC method — does the facade still own `ensureInitialized` + RPC binding + delegation to coordinator? Or does the coordinator replace the method entirely?

Q5. **Gas-balance cache extraction**: is it right to put `GasBalanceCache` inside `execution/` rather than as a standalone service? The invalidation hook relies on `TransactionService.onTransactionUpdated` — does that coupling justify its location?

Q6. **DefaultEntrypoint special case**: `TxRequestBuilder.buildNoFrom` + `FeeStrategy.Embedded` — is this the right split? An alternative is one FeeStrategy that knows about DefaultEntrypoint internally. Which is cleaner?

Q7. **Golden fixture coverage**: 4 fee strategies × N operation kinds. Concretely: how many fixtures? Which operation kinds do you MUST cover vs which are redundant?

Q8. **Parallel-run performance**: during M2.2-g, every tx runs through both pipelines. If the new pipeline is slower (it probably is during early sub-PRs), does the parallel run affect user-visible latency? Should the comparator short-circuit on the happy path?

Q9. **Observable-behavior preservation**: walk the 9+ classes of error strings from discovery (section 9 of the M2.2 brief). Any likely drift?

Q10. **What did the plan MISS**: what responsibility in the 2426 LOC doesn't cleanly fit a-g? Reference line numbers.

## Open decisions for execution time

1. **Planner's `plan(op)` vs per-kind methods** (per-kind feels cleaner, but the dispatcher loop needs a uniform method). Decision at M2.2-a drafting.
2. **`GasBalanceCache` owner** — facade, coordinator, or a 4th service. Plan picks coordinator; confirm during M2.2-f.
3. **Parallel-run enablement strategy** — default on for staff ConfigService flag vs opt-in via URL param. Pick during M2.2-g design.
4. **Fixture storage format** — raw `TxExecutionRequest` JSON vs a canonical pretty-print with contract addresses resolved. Pick during M2.2-g.
