# Deprecate `simulate_views` op kind — extract batching helper + clean dispatch surface

## 1. Summary

The `simulate_views` operation kind is a leftover from the pre-canonical `@aztec/wallet-sdk` era. Its dApp-facing surface was dropped in [#50](https://github.com/alejoamiras/nulo/pull/50) (faucet-add-token), but the op kind survives as the implementation of `ExecutionService.executeSimulateViews(...)`, which is called internally by:

1. `BalanceProjector.projectChunk` — batches token `balance_of_public` + `balance_of_private` reads
2. `ExecutionService.#computeGasBalances` — FeeJuice public balance + PrivateFPC `balance_of` (2 separate single-call invocations)

This PR extracts the batching+decode logic into a pure helper module (`execution/helpers/batched-view-simulation.ts`), refactors the two internal call sites to use canonical `executeAztecSimulateTx` + `pxe.executeUtility` via that helper, and removes every remaining trace of the `simulate_views` op kind: the type, the request shape, the dispatcher path, the execute popup case, the dapp-interaction cases, the materialize case, the humanize test, and the playground README mentions.

Bundled scope (per user clarifying):
- **Register-token preview threading** — `executeRegisterToken` currently re-runs `parseTokenInterface` after Allow even though the popup already pre-fetched it. Codex deferred this in the post-impl review (`register-token-popup-preview-threading`). Thread the popup's parsed interface through the operation so the executor skips the second PXE call.
- **Legacy dapp-interaction cleanup** — drop the leftover `simulate_views` branches in `dapp-interaction/service.ts:290, 394` and `materialize.ts:93`. They were kept in #50 per Opus M1 ("alive on the legacy popup path") but with the op kind gone they're truly dead.
- **Balance-projector unit tests** — net-new. Pin the split-by-FunctionType + group-by-(account, chainId) + batch-into-12 behavior with a stub `ExecutionService` that records the dispatched operations. Today the projector has zero unit coverage; only the network e2e tests it transitively.

## 2. State of the world (recon)

| Layer | Location | Status |
|---|---|---|
| `SimulateViewsOperation` type | `packages/wallet-bridge/src/operation.ts:116-119` | Internal-only after #50; in the `Operation` union (line 22) |
| `SimulateViewsRequest` type | `packages/wallet-bridge/src/dapp-interaction-protocol.ts:31, 65-67` | Wire shape; in `OperationRequest` union (line ~133) |
| Dispatcher switch | `packages/wallet-bridge/src/dispatcher.ts` | Already dropped from `METHOD_TO_KIND` + `ACCOUNT_KINDS` in #50; **no current dispatch path** |
| Capability gate | `packages/wallet-bridge/src/capability-map.ts` | Already dropped from `METHOD_CAPABILITY_MAP` in #50 |
| Scope enforcement | `packages/wallet-bridge/src/scope-enforcement.ts` | Already dropped in #50 (replaced by "retired methods" regression test) |
| `executeSimulateViews` | `packages/extension/src/wallet/services/execution/service.ts:1237-1452` | **Active**. Public method called by 3 internal sites. |
| `executeOperations` switch | `service.ts:905-907` | `case "simulate_views"` still present (dead — no dispatch path reaches it after #50) |
| Internal caller #1 — balance projector | `packages/extension/src/wallet/services/token-balance/balance-projector.ts:121-138` | Batches public + private balance reads per chunk-of-12 |
| Internal caller #2 — gas balance public | `service.ts:1493-1505` | 1 PUBLIC call to FeeJuice `balance_of_public` |
| Internal caller #3 — gas balance private | `service.ts:1521-1533` | 1 UTILITY call to PrivateFPC `balance_of` |
| dApp-interaction validateSession | `dapp-interaction/service.ts:290` | `case "simulate_views"` — dead (no request can carry it) |
| dApp-interaction getOperationAccessLevel | `dapp-interaction/service.ts:394` | Same — dead |
| Materialize | `dapp-interaction/materialize.ts:93` | Same — dead |
| Execute popup operation-narrowing switch | `popup/windows/execute/index.vue:186` | Same — dead |
| Humanize test entry | `popup/windows/execute/humanize.test.ts:28` | Tests humanize on a kind that can't reach the popup |
| Playground doc mentions | `playground/src/sections/meta.ts:5`, `simulation.ts:7`, `playground/README.md` | Comments referencing the dropped surface |
| Register-token executor | `extension/src/wallet/services/execution/service.ts:1042-1050` | Calls `parseTokenInterface` AGAIN after the popup already pre-fetched via `previewTokenMetadata` |

## 3. Locked-in decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Shape C**: extract a pure batching helper, refactor callers to canonical APIs, drop `executeSimulateViews` public method entirely | Single-responsibility (ExecutionService executes Operations; batching isn't an Operation). No duplicated logic across 3 callers. Future-discoverable. User chose this. |
| D2 | Helper lives at `extension/src/wallet/services/execution/helpers/batched-view-simulation.ts` with dependency injection (pxe, node, account, resolver, planner are injected) | Pure module, no Service-class coupling, unit-testable in isolation. Mirrors the dependency-injection pattern of `materializeRequest` in `dapp-interaction/materialize.ts`. |
| D3 | Helper internally uses `aztec_simulateTx` semantics (one PXE simulateTx for batched public/private TX-typed calls) and `pxe.executeUtility` (direct, not through `executeAztecExecuteUtility`) for utility calls | The canonical `executeAztecExecuteUtility` adds a layer that resolves the account from `op.opts` and re-derives PXE/account refs. Internal callers already have these resolved — skip the redundant lookup. |
| D4 | Register-token preview threading via optional `previewedMetadata` field on `RegisterTokenOperation` | Avoids re-running `parseTokenInterface` in the executor. The popup's `previewTokenMetadata` result becomes part of the materialized op. Executor reads it if present, else fetches as a fallback (NewTokenPopup path or any caller that skips the preview). |
| D5 | Legacy `dapp-interaction` `simulate_views` branches dropped | With the op kind gone they're physically unreachable. Keep `materialize.ts` clean. |
| D6 | Unit tests pin the split-by-FunctionType + grouping + batching contract, not the PXE roundtrip | The PXE roundtrip is exercised by network e2e. Unit tests are about catching regressions in the pure-logic surface (classification, batching, decoding). |
| D7 | NO behavior change for the user-visible token list / gas balance display | This is a refactor — exact output parity is the acceptance criterion. |

## 4. Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  BEFORE                                                                │
│                                                                        │
│  balance-projector ──┐                                                 │
│                      ├──▶ ExecutionService.executeSimulateViews ──▶ PXE│
│  gas-balance (×2)  ──┘                                                 │
│                          (also dispatch-switch-case in                 │
│                           executeOperations, dispatch path,            │
│                           SimulateViewsOperation type, etc)            │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  AFTER                                                                 │
│                                                                        │
│  balance-projector ──┐                                                 │
│                      ├──▶ batchedViewSimulation({                      │
│  gas-balance (×2)  ──┘        pxe, node, account, resolver, planner,   │
│                               calls,                                   │
│                            }) ──▶ split FunctionType                   │
│                                   ├─ utility calls → pxe.executeUtility│
│                                   └─ tx calls → buildExecutionPayload  │
│                                                  → pxe.simulateTx      │
│                                                  → decode return values│
│                                                                        │
│  ExecutionService.executeOperations: no `case "simulate_views"`        │
│  Operation union: no SimulateViewsOperation                            │
│  wallet-bridge: no SimulateViewsRequest                                │
└───────────────────────────────────────────────────────────────────────┘
```

### Helper signature (proposed)

```ts
// packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts

import type { Fr } from "@aztec/foundation/curves/bn254"
import type { AbiDecoded, AbiType } from "@aztec/stdlib/abi"
import type { CallAction, EncodedCallAction } from "@nulo/wallet-bridge"
// ... other PXE / contract / account imports

export interface BatchedViewSimulationDeps {
	pxe: PXE
	node: AztecNode
	account: AccountContractRef                 // resolved account contract (signing/registration)
	contractResolver: ContractResolver           // resolveInstances + resolveArtifacts
	logger?: { logError: (msg: string, err: unknown) => void }
}

export interface BatchedViewSimulationResult {
	encoded: Fr[][]
	decoded: AbiDecoded[]
}

/** Simulate a batch of view-shaped calls, splitting UTILITY-typed
 *  function calls (executed individually via pxe.executeUtility) from
 *  PUBLIC/PRIVATE function calls (batched into a single pxe.simulateTx).
 *  Returns per-call encoded + decoded values in input order.
 *
 *  Pure module — no Service coupling. Tested in isolation by injecting
 *  a stub PXE that records calls and returns canned results.
 */
export async function batchedViewSimulation(
	calls: (CallAction | EncodedCallAction)[],
	deps: BatchedViewSimulationDeps,
): Promise<BatchedViewSimulationResult>
```

The helper signature deliberately takes already-resolved deps (PXE, node, account) instead of accepting a `networkId`/`accountAddress` and re-resolving. This keeps the helper:
- **Pure-ish**: easy to unit-test by passing stub PXE
- **Cheap**: no redundant `getActiveProfile`/`getNetwork`/`getAccount` lookups
- **Composable**: callers that already have these resolved (both internal callers do) just pass them

### Caller integration

```ts
// balance-projector.ts (projectChunk)
const network = (await this.networks.getNetworks(chainId))[0]
const profile = await this.profiles.getActiveProfile()
const account = await this.accounts.getAccountContract(profile.id, chainId, accountAddress)
const pxe = this.execution.getPXE(network)
const node = await this.networks.getNode(chainId)
const result = await batchedViewSimulation(callActions, {
	pxe,
	node,
	account,
	contractResolver: this.execution.resolver,
})

// gas-balance (executePublicGasBalance + executePrivateGasBalance helpers)
// Same shape, single-call batches
```

Either:
- ExecutionService exposes a thin `getViewSimulationDeps(networkId, accountAddress)` method that bundles the resolution, OR
- Each caller does the 4-line resolution inline.

§5.4 picks the helper-method approach for ergonomics — it preserves the "one function call from outside" feel that `executeSimulateViews` had, just under a more honest name.

## 5. File-by-file changes

### 5.1 NEW — `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts`

The pure helper module. Body extracted from `executeSimulateViews:1271-1451` with deps injected instead of read from `this.*`. Same control flow:

1. Resolve contract instances + artifacts for every call's target (via `contractResolver`)
2. Register any contracts the PXE doesn't already know about
3. `await account.ensureRegistered(pxe)`
4. For each call: lookup the `FunctionAbi`; build a `FunctionCall`; split utility vs tx-typed
5. If tx-typed calls exist: build one `ExecutionPayload` → `account.buildTxExecutionRequest` → `pxe.simulateTx({simulatePublic: true, ...})` → unpack `getPublicReturnValues()` + `getPrivateReturnValues()`
6. For each utility call: `await pxe.executeUtility(call, {scopes: [account.address]})`
7. Per-call decode via `decodeFromAbi`

Public surface: just `batchedViewSimulation(calls, deps)`. No class. No subclassing. No `this.*` state.

### 5.2 NEW — `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.test.ts`

Unit tests using stub PXE + stub contractResolver. Pin:

- Empty input → empty output, no PXE calls.
- All-utility calls → N `pxe.executeUtility` calls, zero `pxe.simulateTx`.
- All-public calls → 1 `pxe.simulateTx` with the right payload shape, zero `executeUtility`.
- All-private calls → 1 `pxe.simulateTx` (also batched), correct private return unpacking.
- Mixed (utility + public) → N executeUtility + 1 simulateTx; results return in input order.
- Mixed (public + private TX-typed) → 1 simulateTx; correct public/private return slot mapping.
- Decode failure on one call doesn't blow up the others (matches the existing try/catch around `decodeFromAbi`).
- Unknown contract → throws "Contract not found" (regression for the existing error message).
- Unknown method → throws "Method not found".

### 5.3 NEW — `packages/extension/src/wallet/services/execution/helpers/get-view-simulation-deps.ts`

Thin convenience method that bundles the network/account/PXE/node resolution into one call. Lives next to the helper; not strictly required, but means callers stay 1-line wrappers around the helper.

```ts
export async function getViewSimulationDeps(
	services: {
		profiles: ProfileService
		networks: NetworkService
		accounts: AccountService
		pxeService: PxeServiceClient
		contractResolver: ContractResolver
	},
	networkId: string,
	accountAddress: string,
): Promise<BatchedViewSimulationDeps>
```

### 5.4 MODIFIED — `packages/extension/src/wallet/services/execution/service.ts`

- Drop `executeSimulateViews` entirely (lines 1237-1452).
- Drop `case "simulate_views"` in `executeOperations` switch (lines 905-907). Since the kind is being removed from the `Operation` union, the switch's default `throw new Error("Invalid operation")` covers it.
- Drop `import { type SimulateViewsOperation }` (line 74).
- Rewrite `#computeGasBalances` (lines 1482-1541) to use the new helper directly:
  ```ts
  const deps = await getViewSimulationDeps(
      { profiles: this.profileService, networks: this.networkService, accounts: this.accountService,
        pxeService: this.pxeService, contractResolver: this.resolver },
      networkId, accountAddress,
  )
  // Public FeeJuice
  const publicResult = await batchedViewSimulation(
      [{ kind: "call", contract: feeJuiceAddress, method: "balance_of_public", args: [accountAddress] }],
      deps,
  )
  // ... same for private FPC
  ```
- Keep the existing single-flight `gasBalanceInFlight` map + TTL cache around it — those are unchanged.

### 5.5 MODIFIED — `packages/extension/src/wallet/services/token-balance/balance-projector.ts`

- Drop the `kind: "simulate_views"` shape (lines 121-138).
- Replace with:
  ```ts
  if (calls.length > 0) {
      const deps = await this.execution.getViewSimulationDeps(network.id, account)
      const results = await batchedViewSimulation(calls.map((x) => x[0]), deps)
      // ... existing unpack loop
  }
  ```
- Update the imports.
- The chunk-of-12 grouping + per-balance unpack loop are unchanged.

### 5.6 NEW — `packages/extension/src/wallet/services/token-balance/balance-projector.test.ts`

Unit tests for the projector itself, separate from the helper:

- Empty input → empty output.
- Single token with both balance fns → enqueues 2 calls, returns ok with values.
- Single token with only public balance fn → enqueues 1 call, private defaults to "0".
- Multiple tokens, same (account, chain) → grouped into one chunk, projection succeeds.
- Multiple tokens, 15 of them → chunked into 12 + 3 (regression on `BATCH_SIZE = 12`).
- Multiple (account, chain) groups → projected independently.
- Unknown token id → returns `{ kind: "error", error: "Unknown token #<id>" }`.
- `batchedViewSimulation` throws → returns one error per input balance, error message preserved.

Uses stub `ExecutionService` (injects a fake `getViewSimulationDeps` + a controllable `batchedViewSimulation` callable) + stub `TokenService` + stub `NetworkService`. The batchedViewSimulation helper has its own unit tests (§5.2) — this file tests the projector's compositional logic.

### 5.7 MODIFIED — `packages/wallet-bridge/src/operation.ts`

- Drop `SimulateViewsOperation` (lines 116-126).
- Drop the union member (line 22).
- Drop the `kind: "simulate_views"` reference in the file-header JSDoc if any.

### 5.8 MODIFIED — `packages/wallet-bridge/src/dapp-interaction-protocol.ts`

- Drop `SimulateViewsRequest` (lines 31, 65-67).
- Drop from `OperationRequest` union.

### 5.9 MODIFIED — `packages/extension/src/wallet/services/execution/models/index.ts`

- Drop `SimulateViewsOperation` re-export.

### 5.10 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/service.ts`

- Drop `case "simulate_views"` from `validateSession` switch (line 290).
- Drop `case "simulate_views"` from `getOperationAccessLevel` switch (line 394).

### 5.11 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/materialize.ts`

- Drop `case "simulate_views"` from the materialize switch (line 93).

### 5.12 MODIFIED — `packages/extension/src/popup/windows/execute/index.vue`

- Drop `case "simulate_views":` from the operation-narrowing switch (line 186).

### 5.13 MODIFIED — `packages/extension/src/popup/windows/execute/humanize.test.ts`

- Drop the `simulate_views` test entry (line 28). Replace with a regression test that asserts `humanizeOperationKind("simulate_views")` returns the same fallback as any other unknown bare kind (i.e., `"Simulate views"`) — or drop the assertion entirely since the kind isn't dispatched anymore.

### 5.14 MODIFIED — `packages/playground/src/sections/meta.ts` + `simulation.ts`

- Drop or update the comments referencing the dropped `simulateViews` surface. The wallet-bridge README already documents the deprecation; the playground comments are stale.

### 5.15 MODIFIED — `packages/playground/README.md`

- Update the "Custom RPC" reference to drop the `simulateViews` mention (or note it's fully retired now, both dApp + internal).

### 5.16 MODIFIED — `packages/wallet-bridge/README.md`

In the "Custom RPC methods (Nulo extensions)" section, update the "Dropped surface" subsection: `simulateViews` is now fully retired — the op kind that previously survived for internal callers (balance projector + gas balance) is also gone, replaced by the `batchedViewSimulation` helper in `extension/src/wallet/services/execution/helpers/`.

### 5.17 BUNDLED — Register-token preview threading

The popup already calls `tokenService.previewTokenMetadata(networkId, accountAddress, contract)` and stores the result in `tokenMetadata: Map<address, { name, symbol, decimals }>`. The executor (`executeRegisterToken`) re-runs `parseTokenInterface` because the operation doesn't carry the parsed result.

Change:
- Add optional `previewedInterface?: TokenInterface` to `RegisterTokenOperation` (`wallet-bridge/src/operation.ts`) AND `RegisterTokenRequest` (`dapp-interaction-protocol.ts`).
- Popup approves with the parsed interface attached (the popup currently has the metadata strings but NOT the full `TokenInterface` — needs an extra `tokenService` call to get it OR we add the interface to `previewTokenMetadata`'s return type).
- Simpler approach: extend `previewTokenMetadata` to return `{ name, symbol, decimals, interface: TokenInterface }`. Popup stores both. On Allow, the request carries the interface; on materialize, it lands on the op.
- `executeRegisterToken` checks if `op.previewedInterface` is present; if yes, skips `parseTokenInterface`; if no, falls back to fetching (NewTokenPopup path, which doesn't pre-fetch).
- This is forward-compatible with non-preview callers (they pass `undefined` and the old path runs).

### 5.18 BUNDLED — Legacy dapp-interaction cleanup

Already covered by 5.10 + 5.11 + 5.12. With the op kind gone from the union, those branches are physically unreachable and the TS exhaustiveness check would yell at any leftover case. Confirms #50 was right to "keep them for the legacy popup path" — but now there's no legacy path either.

## 6. Security & Adversarial Considerations

### 6.1 Threat model

| Actor | Goal | Surface | Mitigation |
|---|---|---|---|
| Malicious dApp | Re-introduce `simulateViews` via raw protocol bypass | dApp wire | Already covered: `dispatcher.dispatch("simulateViews", ...)` throws "Unsupported wallet method" (regression test pinned in #50). After this PR, the BatchedMethodSchema doesn't include it either. |
| Malicious dApp | Inject crafted `previewedInterface` to skip wallet-side parse + lie about the token's metadata | `RegisterTokenOperation` extension | **Critical**: the `previewedInterface` is dApp-controllable. If the executor trusts it as authoritative, a malicious dApp can pass `{ name: "USDC", symbol: "USDC", decimals: 6 }` for a contract that's actually a scam token. **Mitigation**: the executor must re-run `parseTokenInterface` if it CANNOT verify the previewed interface matches the on-chain contract. Safer alternative: previewed interface is treated as a UI hint ONLY, not as a substitute for the executor's fetch. The executor STILL fetches but uses the previewed data for the journal title (we already do this via `setOperationMeta`). |
| Compromised execution-service caller | Pass a `BatchedViewSimulationDeps` with a stub PXE that returns attacker-controlled return values | Internal helper API | Helper is called only by ExecutionService internals + balance-projector with PXE from the wallet's own PxeService. No external entry. |

### 6.2 Reconsidering D4 — register-token preview threading

The original framing of 5.17 was "skip the executor's fetch if the popup pre-fetched." That's a SECURITY HOLE: the popup-fetched data is dApp-influenceable (popup fetched it for display, but the popup ran in the extension's own context so the values are trustworthy IF the popup fetched correctly).

Actually re-reading: the popup's `previewTokenMetadata` calls `tokenService.previewTokenMetadata` which itself calls `parseTokenInterface` + `fetchTokenMetadata` — both run on the EXTENSION side (offscreen PXE). The dApp can't influence these values. So the popup result IS trustworthy.

**The risk is staleness, not forgery.** Between popup pre-fetch and executor execution, the on-chain contract could (theoretically) change behavior. For a token contract that's near-zero risk (the artifact/instance don't change between the two reads in seconds).

**Conclusion**: 5.17 is safe to implement as "thread the popup-fetched interface to skip the executor's fetch." The popup's data is trustworthy because it was fetched by our own offscreen PXE.

### 6.3 Behavior parity

The refactor must produce IDENTICAL outputs for the same inputs (modulo PXE non-determinism). Adversarial review must include:
- Same return-value order
- Same decode semantics
- Same error message strings (e.g., "Contract not found", "Method not found") because callers (especially balance-projector) may surface them
- Same fee-payment-method behavior on the simulateTx call (`AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE` is currently passed; helper must preserve this)
- Same `skipFeeEnforcement: true` + `scopes: [account.address]` on `pxe.simulateTx`

## 7. Tests

### 7.1 Unit (new)

- `batched-view-simulation.test.ts` (§5.2) — 9+ test cases pinning the contract.
- `balance-projector.test.ts` (§5.6) — 8+ test cases pinning chunking + classification + error propagation.

### 7.2 Unit (modify)

- `humanize.test.ts` (§5.13) — drop the `simulate_views` entry or replace with fallback.
- `dispatcher.test.ts` — the existing `does not dispatch simulateViews` regression test from #50 stays as-is.
- `scope-enforcement.test.ts` — the existing "retired methods are no-ops" test from #50 stays.

### 7.3 Integration / e2e

- Existing network e2e (`test:e2e` smoke + `e2e:agent` network suite) must pass unchanged.
- Manual test on alpha-testnet: drip USDC → balance updates correctly in wallet popup; gas balance pill shows correct value; faucet's "Add to wallet" flow still works.

### 7.4 Behavior-parity check

A separate "before vs after" sanity check before the PR ships: run the existing network e2e in a worktree on `dev`, capture balance + gas readings; same in a worktree on this branch; compare outputs.

## 8. Acceptance criteria

- [ ] `bun run audit:vue` passes (typecheck + units + lint + build).
- [ ] `bun run e2e:agent` network suite passes including the existing `faucet-add-token.test.ts`.
- [ ] On alpha-testnet, token balances + gas balance pill display IDENTICALLY to `dev` (no regression).
- [ ] `grep -rn "simulate_views\|SimulateViewsOperation\|SimulateViewsRequest\|executeSimulateViews\|simulateViews" packages` returns ONLY:
  - The wallet-bridge README's "Dropped surface" note
  - The dispatcher.test.ts regression guard
  - The scope-enforcement.test.ts retired-methods guard
- [ ] `executeOperations` switch has no `case "simulate_views"`.
- [ ] No `Operation` union member is `SimulateViewsOperation`.
- [ ] No `OperationRequest` union member is `SimulateViewsRequest`.
- [ ] balance-projector + gas-balance still call into a shared helper (`batchedViewSimulation`) — single source of truth for the split+batch+decode logic.
- [ ] `RegisterTokenOperation.previewedInterface` is honored by `executeRegisterToken` (no second `parseTokenInterface` call when present).
- [ ] Behavior-parity check passes (§7.4).

## 9. Open questions / follow-ups

- The `BATCH_SIZE = 12` constant in balance-projector — is there a reason it's 12? Should the helper accept a maxBatchSize parameter for future tuning? Defer; current value works.
- `pxe.executeUtility` vs `executeAztecExecuteUtility` — the latter does extra ABI parsing of `op.opts.authWitnesses` + `op.opts.scopes` via Zod. Internal callers don't pass those opts; skipping `executeAztecExecuteUtility` is OK. Documented.
- Could the helper be moved to `wallet-bridge` so it's reusable by other internal consumers? Not yet — wallet-bridge intentionally doesn't depend on `aztec-runtime` (per ARCHITECTURE.md §2 + wallet-bridge README "Key invariants"), and the helper needs PXE access. Helper stays in `extension/`.
- Should `batchedViewSimulation` carry the journal-level retry / backoff behavior that ExecutionService had for the dispatched op? No — the dispatched op had `executeOperations`'s `classifyOperationCatch` wrapper, but internal callers (balance-projector, gas-balance) handle their own errors. Helper just rethrows.

## 10. ASCII status (live)

```
[✓] 0. Clarifying questions
[▶] 1. Draft main plan
[ ] 2. Dual audit (codex + opus)
[ ] 3. Final codex review of consolidated plan
[ ] 4. Approval gate
[ ] 5. Implementation
[ ] 6. Post-impl codex review
[ ] 7. Fix loop
```
