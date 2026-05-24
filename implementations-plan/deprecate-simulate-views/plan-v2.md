# Deprecate `simulate_views` op kind — plan-v2 (consolidated)

Supersedes [`plan.md`](plan.md). Incorporates [`audit-opus.md`](audit-opus.md) + [`audit-codex.md`](audit-codex.md).

## Diff vs plan-v1

| Change | Source |
|---|---|
| Helper preserves parallel-launch / serial-await for utility calls (was: serial await) | Opus F3 + Codex C1 (consensus BLOCKER) |
| `OperationCard.vue:288-296` template branch added to cleanup inventory | Opus F1 + Codex C3 (consensus) |
| `dapp-interaction/spec.ts:11-38` re-export added to cleanup inventory | Codex C3 |
| Stale comments in `balance-projector.ts:1-4` + `dispatcher.ts:171-174` added to cleanup inventory | Codex C3 |
| `previewedInterface` lives on an **extension-local extended type** (`MaterializedRegisterTokenOperation`) — wallet-bridge stays clean of any `TokenInterface` import | Codex C4 + final pass FC1 (layer-hierarchy fix) |
| Popup attaches `previewedInterface` in the **approve mapper** at `execute/index.vue:327-330`, NOT in the init materialization loop (the loop runs before prefetch completes) | Codex final pass FC2 |
| `materialize.ts` is unchanged for `register_token` — no `previewedInterface` threading there (wire shape doesn't carry it; popup attaches post-approval) | Codex final pass FC3 |
| Expose `ContractResolver` via a public `get contractResolver()` getter on `ExecutionService` — no `this.execution.resolver` private reach-in | Codex final pass FC6 |
| Helper types corrected: `IPXE` (not `PXE`), `IAccountContract` (not `AccountContractRef`) | Opus F2 + Codex confirmation |
| Executor sanity check: `previewedInterface.contract === op.address` + `chainId === network.chainId` before trusting | Opus F4 |
| Extend `previewTokenMetadata` return shape — enumerate `token/spec.ts:183` + `token/client.ts:59-64` as MODIFIED | Opus F5 + Codex C5 |
| Popup-side merge path explicit: extend the operations-narrowing loop at `execute/index.vue:182-198` to attach the interface from the stored `tokenInterfaces` map | Codex C5 |
| Test for origin-dependent private-return branch (both sides of `txRequest.origin === op.accountAddress`) | Codex C2 |
| Test for `hideSender` (call) vs `hideMsgSender` (encoded_call) vs `false` (utility) split | Codex C2 |
| `describe.skipIf(!RUN_NETWORK_E2E)` integration test against real sandbox PXE | Opus F9 |
| `getViewSimulationDeps` shape locked: pure function in `helpers/`, not a service method | Codex "tight, not sprawl" + Opus F10 |
| Confirm `materialize.test.ts` needs no changes (verified — no `simulate_views` references today) | Opus F8 |
| Popup race verification cited in §5.17 (`execute/index.vue:312, :482` gates) | Opus F11 |
| Note `BATCH_SIZE = 12` is also duplicated at `balance-job-queue.ts:15-19, 36-37` (out of scope, but noted for the next refactor) | Codex confirmation |

## 1. Summary

[Unchanged from plan-v1.] Retire the `simulate_views` op kind in full. Extract its batching+decode logic into a pure helper module (`execution/helpers/batched-view-simulation.ts`), refactor the two internal callers (balance-projector + gas-balance) to use it via canonical APIs, delete every remaining `simulate_views`-shaped surface.

Bundled scope:
- Thread the popup-fetched `TokenInterface` through `RegisterTokenOperation` (extension-internal materialized form only — NOT the wire request) so the executor skips its second `parseTokenInterface` call.
- Drop the leftover `dapp-interaction` switch cases that were kept defensively in #50.
- Add unit tests for both the helper and the balance projector.

## 2. State of the world (revised recon)

| Layer | Location | Status |
|---|---|---|
| `SimulateViewsOperation` type | `packages/wallet-bridge/src/operation.ts:116-119` | Internal-only after #50; in `Operation` union (line 22) |
| `SimulateViewsRequest` type | `packages/wallet-bridge/src/dapp-interaction-protocol.ts:31, 65-67` | Wire shape; in `OperationRequest` union |
| Stale dispatcher comment about `simulate_views` retention | `packages/wallet-bridge/src/dispatcher.ts:171-174` | Says "simulate_views op kind is retained for internal callers (the balance projector + gas-balance code)" — needs removal/update |
| `SimulateViewsRequest` re-export | `packages/extension/src/wallet/services/dapp-interaction/spec.ts:11-38` | Re-exported alongside other request types |
| `SimulateViewsOperation` re-export | `packages/extension/src/wallet/services/execution/models/index.ts` | Re-exported |
| `executeSimulateViews` method | `packages/extension/src/wallet/services/execution/service.ts:1237-1452` | Public method called by 3 internal sites |
| `executeOperations` switch case | `packages/extension/src/wallet/services/execution/service.ts:905-907` | `case "simulate_views"` (dead — no dispatch path reaches it after #50) |
| dApp-interaction validateSession | `packages/extension/src/wallet/services/dapp-interaction/service.ts:290` | `case "simulate_views"` — dead |
| dApp-interaction getOperationAccessLevel | `packages/extension/src/wallet/services/dapp-interaction/service.ts:394` | Same — dead |
| Materialize | `packages/extension/src/wallet/services/dapp-interaction/materialize.ts:93` | Same — dead |
| Popup window operation-narrowing switch | `packages/extension/src/popup/windows/execute/index.vue:186` | Same — dead |
| **Popup OperationCard template branch** | `packages/extension/src/popup/windows/execute/OperationCard.vue:288-299` | Renders "View calls:" block for `op.kind === 'simulate_views'` — dead after union shrinks, but template stops compiling under Vue strict type checks |
| Humanize test entry | `packages/extension/src/popup/windows/execute/humanize.test.ts:28` | Tests on a kind that can't reach the popup |
| **Stale projector header comment** | `packages/extension/src/wallet/services/token-balance/balance-projector.ts:1-4` | Says "call the execution service's `executeSimulateViews` and unpack" |
| Playground doc mentions | `packages/playground/src/sections/meta.ts:5`, `simulation.ts:7`, `playground/README.md` | Comments referencing dropped surface |
| Internal caller #1 (balance projector) | `packages/extension/src/wallet/services/token-balance/balance-projector.ts:121-138` | Batches token balance reads, chunks of 12 |
| Internal caller #2 (gas balance public) | `packages/extension/src/wallet/services/execution/service.ts:1493-1505` | FeeJuice `balance_of_public` (PUBLIC-typed) |
| Internal caller #3 (gas balance private) | `packages/extension/src/wallet/services/execution/service.ts:1521-1533` | PrivateFPC `balance_of` (UTILITY-typed) |
| Register-token re-fetch in executor | `packages/extension/src/wallet/services/execution/service.ts:1042-1050` | Calls `parseTokenInterface` even though popup already pre-fetched via `previewTokenMetadata` |
| Popup interface storage today | `packages/extension/src/popup/windows/execute/index.vue:93-95, 268-269` | Stores only `{name, symbol, decimals}` strings |
| `previewTokenMetadata` return shape | `packages/extension/src/wallet/services/token/spec.ts:176-183`, `client.ts:59-64` | Returns only `{name, symbol, decimals}` — needs extension to also return parsed `TokenInterface` |
| Popup approve materialize loop | `packages/extension/src/popup/windows/execute/index.vue:182-198, 327-335` | Strips `network`/`account`, forwards rest; needs popup-side merge for `previewedInterface` |

## 3. Locked-in decisions (revised)

| # | Decision | Source |
|---|---|---|
| D1 | **Shape C**: pure helper module | User + Opus F13 + Codex confirmation |
| D2 | Helper lives at `extension/src/wallet/services/execution/helpers/batched-view-simulation.ts` with DI | Plan-v1 (unchanged) |
| D3 | Helper preserves **parallel-launch, serial-await** pattern for utility calls (mirrors current `service.ts:1271-1272 / 1441-1448`) | **NEW** — Opus F3 + Codex C1 BLOCKER fix |
| D4 | `getViewSimulationDeps` ships as a **pure function** at `helpers/get-view-simulation-deps.ts`, NOT as an `ExecutionService` method (codex "tight, not sprawl") | **NEW** — Codex confirmation + Opus F10 |
| D5 | `previewedInterface?: TokenInterface` field lives on a NEW **extension-local extended type** `MaterializedRegisterTokenOperation = RegisterTokenOperation & { previewedInterface?: TokenInterface }` defined in `packages/extension/src/wallet/services/execution/models/index.ts`. wallet-bridge stays clean — `RegisterTokenOperation` is unchanged, `RegisterTokenRequest` is unchanged, no `TokenInterface` import in wallet-bridge (which would violate the layer hierarchy: extension depends on wallet-bridge, not vice versa). Popup attaches the field in the **approve mapper** at `execute/index.vue:327-330` (NOT the init materialization loop, which runs before prefetch). Executor accepts the extended type, validates `previewedInterface.contract === op.address` + `chainId === network.chainId`, falls back to `parseTokenInterface` on mismatch. | **REVISED v2** — Codex final pass FC1 + FC2 + FC3 (was: field on `RegisterTokenOperation` in wallet-bridge) |
| D6 | Executor sanity check: if `previewedInterface` is present, validate `previewedInterface.contract === op.address` AND `previewedInterface.chainId === network.chainId` before trusting. If validation fails, log warning + fall back to `parseTokenInterface`. | **NEW** — Opus F4 |
| D7 | `previewTokenMetadata` (token service) extended to return `{ name, symbol, decimals, interface: TokenInterface }`. Existing consumers (which only use the strings) tolerate the wider shape via field access. | **NEW** — Codex C5 + Opus F5 |
| D8 | Helper types: `pxe: IPXE`, `account: IAccountContract` | **NEW** — Opus F2 + Codex confirmation |
| D9 | Test matrix expanded — see §7 | **NEW** — Codex C2 + Opus F9 |
| D10 | NO behavior change for user-visible token list / gas balance display | Plan-v1 |

## 4. Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  AFTER                                                                 │
│                                                                        │
│  Wire layer (wallet-bridge)                                            │
│    RegisterTokenRequest    { kind, account, address }                  │
│      (NO previewedInterface — strict 2-arg dispatcher contract)        │
│                                                                        │
│  Materialize boundary (popup approve mapper, NOT init loop)            │
│    Extension-local MaterializedRegisterTokenOperation = RegisterTokenOp │
│                              & { previewedInterface?: TokenInterface } │
│      (popup approve mapper attaches `previewedInterface` from its      │
│       `tokenInterfaces` map AFTER prefetch — Allow gated on             │
│       tokenMetadataLoading; executor validates contract+chainId match) │
│                                                                        │
│  Execution layer                                                       │
│    executeRegisterToken(op)                                            │
│      if (op.previewedInterface                                         │
│           && op.previewedInterface.contract === op.address             │
│           && op.previewedInterface.chainId === network.chainId)        │
│        use op.previewedInterface (skip parseTokenInterface fetch)      │
│      else                                                              │
│        fall back to parseTokenInterface (NewTokenPopup path,           │
│        forged-popup-input path, or staleness invariant violation)      │
│                                                                        │
│  Internal batching helper (NEW)                                        │
│    batchedViewSimulation(calls, { pxe, node, account, resolver }):     │
│      - kick off utility calls eagerly (push promises into queue,       │
│        await later) ──── PARALLEL-LAUNCH, SERIAL-AWAIT                 │
│      - bundle tx-typed calls into one ExecutionPayload                 │
│      - account.buildTxExecutionRequest({                               │
│          cancellable: false,                                           │
│          txNonce: Fr.random(),                                         │
│          feePaymentMethodOptions: PREEXISTING_FEE_JUICE,               │
│        })                                                              │
│      - pxe.simulateTx(req, {                                           │
│          simulatePublic: true,                                         │
│          skipFeeEnforcement: true,                                     │
│          scopes: [account.address],                                    │
│        })                                                              │
│      - private-return unpacking:                                       │
│          txRequest.origin === op.accountAddress                        │
│            ? sim.getPrivateReturnValues().nested                       │
│            : sim.getPrivateReturnValues().nested[1].nested             │
│      - decode per-call via decodeFromAbi (try/catch around each)       │
│      - return { encoded: Fr[][], decoded: AbiDecoded[] } (in input    │
│        order)                                                          │
│                                                                        │
│  Helper consumers                                                      │
│    balance-projector.projectChunk → batchedViewSimulation              │
│    ExecutionService.#computeGasBalances → batchedViewSimulation (×2)   │
└───────────────────────────────────────────────────────────────────────┘
```

### Helper signature (corrected per Opus F2 + Codex)

```ts
// packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts

import type { IPXE } from "@nulo/aztec-runtime/pxe"
import type { IAccountContract } from "@nulo/aztec-runtime/account"
import type { AztecNode } from "@aztec/aztec.js/node"
import type { AbiDecoded } from "@aztec/stdlib/abi"
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { CallAction, EncodedCallAction } from "@nulo/wallet-bridge"
import type { ContractResolver } from "../contract-resolver"
import type { ILogger } from "@/wallet/logger"

export interface BatchedViewSimulationDeps {
  pxe: IPXE
  node: AztecNode
  account: IAccountContract           // resolved via accountService.getAccountContract
  contractResolver: ContractResolver  // effectively stateless apart from logger
  logger?: ILogger
}

export interface BatchedViewSimulationResult {
  encoded: Fr[][]
  decoded: AbiDecoded[]
}

export async function batchedViewSimulation(
  calls: (CallAction | EncodedCallAction)[],
  deps: BatchedViewSimulationDeps,
): Promise<BatchedViewSimulationResult>
```

### Parallel-launch / serial-await pattern (D3 — the BLOCKER fix)

```ts
// Inside batchedViewSimulation — preserves current concurrency semantics

const utility: [Promise<UtilityExecutionResult>, number, AbiType[]][] = []
const txCalls: [FunctionCall, number, number, AbiType[]][] = []
let privateCallIndex = 0
let publicCallIndex = 0

for (let i = 0; i < calls.length; i++) {
  const call = calls[i]
  // ... ABI resolution ...
  if (fn.functionType === FunctionType.UTILITY) {
    // EAGER LAUNCH — push the live promise, do not await here.
    utility.push([
      pxe.executeUtility(functionCall, { scopes: [account.address] }),
      i,
      fn.returnTypes,
    ])
  } else {
    txCalls.push([functionCall, i, fn.functionType === FunctionType.PUBLIC ? publicCallIndex++ : privateCallIndex++, fn.returnTypes])
  }
}

// Bundle + simulate tx-typed calls
if (txCalls.length) {
  // ... build ExecutionPayload, simulateTx, unpack returns ...
}

// NOW await the utility promises (they've been running concurrently)
for (const [promise, i, types] of utility) {
  const { result: values } = await promise
  // ... decode + assign ...
}
```

## 5. File-by-file changes (v2)

### 5.1 NEW — `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts`

Pure helper. Body extracted from `executeSimulateViews:1271-1451` with `this.*` removed, deps injected. Preserves:
- Parallel-launch / serial-await for utility calls (D3)
- `ExecutionPayload(calls, [], [], [])` construction
- `buildTxExecutionRequest({ cancellable: false, txNonce: Fr.random(), feePaymentMethodOptions: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE })`
- `pxe.simulateTx(req, { simulatePublic: true, skipFeeEnforcement: true, scopes: [account.address] })`
- Conditional private return unpacking: `txRequest.origin.toString() === op.accountAddress ? .nested : .nested[1].nested`
- `hideSender` for `call` kind, `hideMsgSender` for `encoded_call`, hardcoded `false` for utility
- Error message strings ("Contract not found", "Method not found", "Failed to decode...")
- try/catch boundary around `decodeFromAbi`

### 5.2 NEW — `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.test.ts`

Unit tests using stub PXE + stub contractResolver. **Test matrix expanded per Codex C2:**

Empty / classification:
- Empty input → empty output, no PXE calls.
- All-utility calls (3+) → utility promises launched concurrently, NOT awaited until after the tx-typed path; `pxe.simulateTx` is never called.
- All-public calls → 1 `pxe.simulateTx`, zero `executeUtility`.
- All-private calls → 1 `pxe.simulateTx` (batched), correct private return unpacking.
- Mixed (utility + public) → utility eager launch + 1 simulateTx; results return in input order.
- Mixed (public + private TX-typed) → 1 simulateTx, correct public/private slot mapping.

Origin-quirk parity (**NEW per Codex C2**):
- Private TX-typed calls where `txRequest.origin === op.accountAddress` → use `.nested` (no `[1].nested` indirection).
- Private TX-typed calls where `txRequest.origin !== op.accountAddress` → use `.nested[1].nested`. Inject a stub `account.buildTxExecutionRequest` that returns the appropriate origin to exercise both branches.

`hideSender` / `hideMsgSender` parity (**NEW per Codex C2**):
- `call`-kind PUBLIC call with `hideSender: true` → `FunctionCall` constructor gets `hideMsgSender: true` (third arg).
- `encoded_call`-kind PUBLIC call with `hideMsgSender: true` → same.
- `call`-kind UTILITY call ignores `hideSender` → `FunctionCall.hideMsgSender` is `false`.
- `encoded_call`-kind UTILITY call ignores `hideMsgSender` → same.

Error paths:
- Unknown contract → throws "Contract not found".
- Unknown method → throws "Method not found".
- Decode failure on one call doesn't blow up the others (existing try/catch).

Concurrency (per codex final pass FC7 — assert event order, not just microtask resolution):
- Stub `pxe.executeUtility` records a timestamp into a shared event log when invoked AND when its promise resolves.
- Stub `pxe.simulateTx` records a timestamp when invoked.
- Test asserts: all `executeUtility` invocations recorded BEFORE the `simulateTx` invocation completes (proves parallel launch).
- Test asserts: all `executeUtility` resolution timestamps are AFTER the `simulateTx` completion timestamp (proves serial await after tx-typed path).
- Per-call results return in input order regardless of utility resolution order.

### 5.3 NEW — `packages/extension/src/wallet/services/execution/helpers/get-view-simulation-deps.ts`

Pure function (D4 — NOT a service method per Codex). Bundles the network/account/PXE/node resolution into one call.

```ts
export async function getViewSimulationDeps(
  services: {
    profiles: ProfileService
    networks: NetworkService
    accounts: AccountService
    pxeService: PxeServiceClient
    contractResolver: ContractResolver
    logger?: ILogger
  },
  networkId: string,
  accountAddress: string,
): Promise<BatchedViewSimulationDeps>
```

### 5.4 NEW — `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.integration.test.ts`

`describe.skipIf(!process.env.RUN_NETWORK_E2E)` integration test (**NEW per Opus F9**) against the local sandbox PXE booted by the existing e2e setup. Exercises:

- A real `pxe.simulateTx` round-trip with the FeeJuice `balance_of_public` call → asserts result decodes to a bigint.
- A real `pxe.executeUtility` round-trip with a token's `balance_of_private` → asserts result decodes.
- Both the `.nested` and `.nested[1].nested` private-return branches via two different account/origin pairings.

This is the "external-system data" rule from user CLAUDE.md applied to the helper.

### 5.5 MODIFIED — `packages/extension/src/wallet/services/execution/service.ts`

- Drop `executeSimulateViews` entirely (lines 1237-1452).
- Drop `case "simulate_views"` in `executeOperations` switch (lines 905-907).
- Drop `import { type SimulateViewsOperation }` (line 74).
- Rewrite `#computeGasBalances` (lines 1482-1541) to use the new helper:
  ```ts
  const deps = await getViewSimulationDeps({
    profiles: this.profileService,
    networks: this.networkService,
    accounts: this.accountService,
    pxeService: this.pxeService,
    contractResolver: this.resolver,
    logger: this.logger,
  }, networkId, accountAddress)
  // Public FeeJuice
  const publicResult = await batchedViewSimulation(
    [{ kind: "call", contract: feeJuiceAddress, method: "balance_of_public", args: [accountAddress] }],
    deps,
  )
  // ... same for private FPC
  ```
- Single-flight `gasBalanceInFlight` map + TTL cache unchanged.
- **Modify `executeRegisterToken`** (D6 sanity check). Signature widens to accept the extension-local extended type:
  ```ts
  private async executeRegisterToken(
    op: MaterializedRegisterTokenOperation,  // extension-local type, RegisterTokenOperation & { previewedInterface? }
    origin: LocalTxOrigin,
    parentTask?: WrappedTask,
  ) {
    const profile = await this.profileService.getActiveProfile()
    if (!profile) throw new Error("Wallet locked")
    const network = await this.networkService.getNetwork(op.networkId)

    let ti: TokenInterface
    if (
      op.previewedInterface &&
      op.previewedInterface.contract.toLowerCase() === op.address.toLowerCase() &&
      op.previewedInterface.chainId === network.chainId
    ) {
      ti = op.previewedInterface
    } else {
      if (op.previewedInterface) {
        this.logger.warn("executeRegisterToken: discarding previewedInterface — contract/chainId mismatch", {
          previewed: { contract: op.previewedInterface.contract, chainId: op.previewedInterface.chainId },
          op: { address: op.address, chainId: network.chainId },
        })
      }
      ti = await this.tokenService.parseTokenInterface(op.networkId, op.address, parentTask)
    }
    // ... rest unchanged
  }
  ```
- **Add public `get contractResolver()` getter** on ExecutionService (D-FC6 fix). Backing field stays `private readonly resolver: ContractResolver`; getter exposes it to `BalanceProjector` without leaking other private state:
  ```ts
  public get contractResolver(): ContractResolver {
    return this.resolver
  }
  ```

### 5.6 MODIFIED — `packages/extension/src/wallet/services/token-balance/balance-projector.ts`

- Update stale header comment (line 1-4) to reference the new helper.
- Drop the `kind: "simulate_views"` shape (lines 121-138).
- Replace with helper call (uses the new public getter, NOT private `.resolver`):
  ```ts
  if (calls.length > 0) {
    const deps = await getViewSimulationDeps({
      profiles: this.profiles,            // added to constructor
      networks: this.networks,
      accounts: this.accounts,            // added to constructor
      pxeService: this.pxeService,        // added to constructor
      contractResolver: this.execution.contractResolver,  // public getter on ExecutionService
      logger: this.logger,
    }, network.id, account)
    const results = await batchedViewSimulation(calls.map((x) => x[0]), deps)
    // ... existing unpack loop
  }
  ```
- The chunk-of-12 grouping + per-balance unpack loop unchanged.
- **Constructor change**: `BalanceProjector` currently takes `ExecutionService, NetworkService, TokenService, logger?`. Adds `ProfileService, AccountService, PxeServiceClient` — all already available at the only callsite (`packages/extension/src/wallet/services/token-balance/service.ts:60`). One callsite to update.

### 5.7 NEW — `packages/extension/src/wallet/services/token-balance/balance-projector.test.ts`

Unit tests covering the projector's compositional logic (separate from the helper):

- Empty input → empty output.
- Single token with both balance fns → enqueues 2 calls, returns ok with values.
- Single token with only public balance fn → enqueues 1 call, private defaults to "0".
- Multiple tokens, same (account, chain) → grouped into one chunk, projection succeeds.
- Multiple tokens, 15 of them → chunked into 12 + 3 (regression on `BATCH_SIZE = 12`).
- Multiple (account, chain) groups → projected independently.
- Unknown token id → returns `{ kind: "error", error: "Unknown token #<id>" }`.
- `batchedViewSimulation` throws → returns one error per input balance, error message preserved.

Stubs `batchedViewSimulation` directly (the helper has its own tests in §5.2). Uses stubbed `getViewSimulationDeps` callable that returns a sentinel.

### 5.8 MODIFIED — `packages/wallet-bridge/src/operation.ts`

- Drop `SimulateViewsOperation` (lines 116-126).
- Drop the union member (line 22).
- **`RegisterTokenOperation` is UNCHANGED.** The `previewedInterface` field does NOT live here — wallet-bridge has no dependency on `@nulo/extension` (verified `packages/wallet-bridge/package.json`), so it cannot import `TokenInterface`. The field lives on an extension-local extended type defined in `packages/extension/src/wallet/services/execution/models/index.ts` (see §5.12).

### 5.9 MODIFIED — `packages/wallet-bridge/src/dapp-interaction-protocol.ts`

- Drop `SimulateViewsRequest` (lines 31, 65-67).
- Drop from `OperationRequest` union.
- **`RegisterTokenRequest` is UNCHANGED.** No `Omit` needed because the field doesn't exist on `RegisterTokenOperation` in wallet-bridge (per §5.8). Wire shape stays exactly `{ kind, address, account }`.

### 5.10 MODIFIED — `packages/wallet-bridge/src/dispatcher.ts`

- Update the stale comment at lines 171-174 about `simulate_views` being retained for internal callers — say "fully retired" + reference the helper module.

### 5.11 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/spec.ts`

- Drop `SimulateViewsRequest` re-export (line 38 in the imports list).

### 5.12 MODIFIED — `packages/extension/src/wallet/services/execution/models/index.ts`

- Drop `SimulateViewsOperation` re-export.
- **Add new extension-local extended type**:
  ```ts
  import type { RegisterTokenOperation } from "@nulo/wallet-bridge"
  import type { TokenInterface } from "@/wallet/services/token/spec"

  /**
   * Materialized form of `RegisterTokenOperation` carrying the optional
   * `previewedInterface` hint that the popup attaches during the approve
   * mapper after `previewTokenMetadata` resolves. Wallet-bridge's
   * `RegisterTokenOperation` stays clean of any `TokenInterface` import
   * (it has no dependency on extension types). The executor accepts this
   * extended type, validates `contract === op.address` +
   * `chainId === network.chainId` before trusting the hint, and falls back
   * to `parseTokenInterface` on mismatch.
   */
  export type MaterializedRegisterTokenOperation = RegisterTokenOperation & {
    readonly previewedInterface?: TokenInterface
  }
  ```

### 5.13 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/service.ts`

- Drop `case "simulate_views"` from `validateSession` switch (line 290).
- Drop `case "simulate_views"` from `getOperationAccessLevel` switch (line 394).

### 5.14 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/materialize.ts`

- Drop `case "simulate_views"` from the materialize switch (line 93).
- **No `previewedInterface` threading here** (was the plan-v2 v1 mistake codex caught at FC3). The wire `RegisterTokenRequest` doesn't carry the field, so materialize.ts can't propagate it. The popup attaches the field AFTER materialize, in the approve mapper (§5.15). materialize.ts is unchanged for `register_token` beyond the `simulate_views` case removal.

### 5.15 MODIFIED — `packages/extension/src/popup/windows/execute/index.vue`

- Drop `case "simulate_views":` from the operation-narrowing switch (line 186).
- **Add popup-side interface threading at the APPROVE MAPPER** (Codex C5 + final pass FC2):
  - Extend the existing `tokenMetadata` state with a parallel `tokenInterfaces: ref<Map<address, TokenInterface>>` populated during the same `previewTokenMetadata` call at `:261-279` (alongside the existing `tokenMetadata.set(op.address, {name, symbol, decimals})` — add `tokenInterfaces.value.set(op.address, interface)` from the extended `previewTokenMetadata` return).
  - In the **approve mapper at `:327-330`** (NOT the init materialization loop at `:183-198`, which runs BEFORE prefetch completes), for any `register_token` op, attach `previewedInterface: tokenInterfaces.value.get(op.address)` if available. This is the post-prefetch merge point.
  - Pin the popup race verification (Opus F11): `tokenMetadataLoading.value` at `:312` + Confirm-button disabled state at `:482` prevent a fast click from approving with incomplete metadata. By the time `approveInteraction` runs, prefetch has completed.

### 5.16 MODIFIED — `packages/extension/src/popup/windows/execute/OperationCard.vue` (**NEW — Opus F1 / Codex C3**)

- Drop the entire `<template v-else-if="op.kind === 'simulate_views'">` template block (lines 288-299).

### 5.17 MODIFIED — `packages/extension/src/popup/windows/execute/humanize.test.ts`

- Drop the `simulate_views` test entry (line 28).

### 5.18 MODIFIED — `packages/extension/src/wallet/services/token/spec.ts` (**NEW — Codex C5**)

- Extend `previewTokenMetadata` return type to `{ name: string; symbol: string; decimals: number; interface: TokenInterface }` (line 176-183).

### 5.19 MODIFIED — `packages/extension/src/wallet/services/token/client.ts` (**NEW — Codex C5**)

- Match the spec change at lines 59-64.

### 5.20 MODIFIED — `packages/extension/src/wallet/services/token/service.ts`

- `previewTokenMetadata` implementation: return the parsed `TokenInterface` alongside the strings.

### 5.21 MODIFIED — `packages/playground/src/sections/meta.ts` + `simulation.ts`

- Update comments to say `simulateViews` is fully retired (no surviving internal op kind).

### 5.22 MODIFIED — `packages/playground/README.md`

- Update the dropped-surface mention to reflect the full retirement.

### 5.23 MODIFIED — `packages/wallet-bridge/README.md`

- Update the "Dropped surface" subsection: `simulateViews` is now fully retired — the op kind that previously survived for internal callers is also gone, replaced by `batchedViewSimulation` helper.

## 6. Deprecation summary (revised)

| Method | dApp wire surface | Op kind | Internal callers |
|---|---|---|---|
| `simulateViews` | Dropped in #50 | **dropped entirely** (this PR) | replaced by `batchedViewSimulation` helper consumed by balance-projector + gas-balance |

## 7. Security & Adversarial Considerations (revised)

### 7.1 Threat model

| Actor | Goal | Surface | Mitigation |
|---|---|---|---|
| Malicious dApp | Forge `previewedInterface` to lie about token metadata | wallet-sdk wire | **Closed by D5**: field is `Omit`ed from `RegisterTokenRequest` at the type level. dispatcher constructs requests from the 2 dApp args only. No wire path can set the field. |
| Malicious dApp | Re-introduce `simulateViews` | wallet-sdk wire | Closed in #50; regression-tested in `dispatcher.test.ts` (retired methods throw "Unsupported wallet method"). |
| Popup-side bug | Pre-fetch lands on wrong contract; popup attaches mismatching `previewedInterface` | Extension internal | **Closed by D6**: executor validates `contract === op.address` + `chainId === network.chainId`. On mismatch, logs warning + falls back to canonical `parseTokenInterface`. |
| Staleness | Popup open for an hour, contract re-registered, executor approves with stale interface | Extension internal | Accepted risk. Contract artifact mutation is exceedingly rare; the fallback path runs if validation fails. Not worth defending against further. |
| Concurrent batched-view simulation | Stale results from a previous batch leak into a later batch | Helper concurrency | Helper has no shared state — each invocation has its own `utility[]` + `txCalls[]` queues. Stub-PXE concurrency tests in §5.2 pin per-input-order output. |

### 7.2 Behavior parity (critical for refactor PRs)

The refactor must produce **byte-for-byte identical outputs** for the same inputs, modulo PXE non-determinism. The §5.2 test matrix pins:

- Same `FunctionType` classification (utility vs public vs private)
- Same `ExecutionPayload` construction
- Same `buildTxExecutionRequest` opts (cancellable, txNonce, feePaymentMethodOptions)
- Same `pxe.simulateTx` opts (simulatePublic, skipFeeEnforcement, scopes)
- Same conditional private-return unpacking branch
- Same `hideSender` / `hideMsgSender` propagation
- Same error message strings
- Same parallel-launch / serial-await for utilities (D3)

A pre-merge sanity step: run the existing network e2e on `dev` AND on this branch, capture balance + gas readings, compare outputs. Same numbers = parity confirmed.

## 8. Tests (revised)

### 8.1 Unit (new)

- `batched-view-simulation.test.ts` (§5.2) — ~14 cases (was 9 in plan-v1).
- `batched-view-simulation.integration.test.ts` (§5.4) — `describe.skipIf(!RUN_NETWORK_E2E)` real-PXE coverage.
- `balance-projector.test.ts` (§5.7) — 8 cases.

### 8.2 Unit (modify)

- `humanize.test.ts` (§5.17) — drop `simulate_views` entry.
- `dispatcher.test.ts` — existing `does not dispatch simulateViews` regression test stays.
- `scope-enforcement.test.ts` — existing "retired methods" guard stays.
- `materialize.test.ts` — **VERIFIED NO CHANGES NEEDED** (grep returned empty for `simulate_views` / `SimulateViews`).

### 8.3 Integration / e2e

- Existing `bun run test:e2e` (smoke) + `bun run e2e:agent` (network) must pass unchanged.
- Manual test on alpha-testnet: drip USDC → balance updates correctly; gas balance pill shows correct value; faucet's "Add to wallet" still works.

### 8.4 Behavior-parity check

Pre-PR sanity: run network e2e on `dev` worktree and this branch's worktree, diff captured balance/gas readings.

## 9. Acceptance criteria

- [ ] `bun run audit:vue` passes.
- [ ] `bun run e2e:agent` network suite passes including existing `faucet-add-token.test.ts`.
- [ ] `RUN_NETWORK_E2E=1 bun run test` runs the new integration test successfully.
- [ ] On alpha-testnet, token balances + gas balance pill display IDENTICALLY to `dev`.
- [ ] `grep -rn "simulate_views\|SimulateViewsOperation\|SimulateViewsRequest\|executeSimulateViews\|simulateViews" packages` returns ONLY:
  - wallet-bridge README "Dropped surface" note
  - dispatcher.test.ts regression guard
  - scope-enforcement.test.ts retired-methods guard
- [ ] `executeOperations` switch has no `case "simulate_views"`.
- [ ] No `Operation` union member is `SimulateViewsOperation`.
- [ ] No `OperationRequest` union member is `SimulateViewsRequest`.
- [ ] `RegisterTokenRequest` (wallet-bridge) is unchanged — `{ kind, address, account }`.
- [ ] `RegisterTokenOperation` (wallet-bridge) is unchanged — no `TokenInterface` import in wallet-bridge.
- [ ] `MaterializedRegisterTokenOperation` (extension-local) carries optional `previewedInterface`.
- [ ] Popup approve mapper attaches `previewedInterface` from `tokenInterfaces` map (post-prefetch).
- [ ] `executeRegisterToken` validates `previewedInterface.contract === op.address` + `chainId === network.chainId` before trusting; falls back to `parseTokenInterface` on mismatch.
- [ ] `ExecutionService` exposes public `contractResolver` getter; no private `.resolver` reach-in from `BalanceProjector`.
- [ ] balance-projector + gas-balance both call `batchedViewSimulation` (single source of truth).
- [ ] Behavior-parity check passes (§8.4).
- [ ] `OperationCard.vue` no longer renders a `simulate_views` template branch.

## 10. Open questions / follow-ups (filed)

- `centralize-batch-size-12` — both `balance-projector.ts:29` and `balance-job-queue.ts:15-19, 36-37` define `BATCH_SIZE = 12`. Codex confirms no PXE hard limit. Out of this PR's scope; track for the next refactor.

## 11. ASCII status (live)

```
[✓] 0. Clarifying questions
[✓] 1. Draft main plan + ELI5
[✓] 2. Dual audit (codex + opus)
[✓] 3. Final codex review of consolidated plan (4 fixes applied to v2)
[▶] 4. Approval gate
[ ] 5. Implementation
[ ] 6. Post-impl codex review
[ ] 7. Fix loop
```
