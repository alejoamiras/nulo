## F1: Wallet method metadata is split across parallel registries
1. Title: Wallet method metadata is split across parallel registries.
2. Smell name: Shotgun Surgery.
3. Maintenance impact bucket: architectural. Blast radius: 3 source files and at least 6 registries/switch surfaces. Change frequency: high; the repo-map hotspot summary reports `dispatcher.ts` 8 touches, `scope-enforcement.ts` 4, and `capability-map.ts` 3 in the last 3 months.
4. Concrete evidence: `getAddressBook` is represented separately in `packages/wallet-bridge/src/capability-map.ts:43-45`, `packages/wallet-bridge/src/scope-enforcement.ts:300-306,358-361`, and `packages/wallet-bridge/src/dispatcher.ts:170,184-192,889-890`. `simulateTx` is spread across `capability-map.ts:35-37`, `scope-enforcement.ts:109-130,352-355`, and `dispatcher.ts:172,198,918-925`. `sendTx` is special-cased in `dispatcher.ts:275-277,404-461` while still needing entries in `capability-map.ts:39-40` and `scope-enforcement.ts:90-107,352-355`.
5. Why it harms future change: adding, retiring, or reclassifying one wallet method requires synchronized edits in unrelated modules, so reviewers must remember hidden coupling instead of checking one definition site.
6. Smallest safe refactoring: Introduce Parameter Object with a single `MethodDescriptor` table, then Move Function so capability lookup, scope enforcement, routing kind, and resolution mode derive from that table.
7. What disappears: manual registry sync, duplicated method taxonomy, and the need to prove that every protocol-method edit touched every table and switch.
8. Instances: `packages/wallet-bridge/src/capability-map.ts:18-46`, `packages/wallet-bridge/src/scope-enforcement.ts:348-362`, `packages/wallet-bridge/src/dispatcher.ts:163-198,275-285,842-955`.

## F2: WalletSdkDispatcher is a hotspot class with too many reasons to change
1. Title: WalletSdkDispatcher is a hotspot class with too many reasons to change.
2. Smell name: Large Class.
3. Maintenance impact bucket: structural with architectural spillover. Blast radius: one file, but it is the package hub for every wallet-sdk request path. Change frequency: high; the repo-map hotspot summary reports `packages/wallet-bridge/src/dispatcher.ts` was touched 8 times in the last 3 months.
4. Concrete evidence: the class spans a 1,011-line file. `dispatch()` at `packages/wallet-bridge/src/dispatcher.ts:227-292` does session lookup, capability enforcement, routing, batching, and execution handoff. `handleSendTx()` and `handleRegisterToken()` at `404-521` own popup-specific flows. `handleRequestCapabilities()` at `531-701` is a grant/rejection state machine. `enrichGrantedCapabilities()` at `707-760` reshapes response payloads. `buildNetworkOperation()` and `buildAccountOperation()` at `867-955` translate wire args into operations. `resolveNetworkAndAccount()` at `984-1006` owns session-aware account selection.
5. Why it harms future change: protocol-routing changes, capability-grant changes, popup-hook changes, and account-resolution changes all collide in the same class, increasing merge conflicts and making isolated refactors risky.
6. Smallest safe refactoring: Extract Class plus Move Function, splitting grant-management, operation-building, and session-account resolution into dedicated collaborators while leaving `WalletSdkDispatcher` as a thin coordinator.
7. What disappears: a single 1k-line hotspot accumulating unrelated edits, and the class-level coupling between grant workflow, popup workflow, and operation translation.
8. Instances: `packages/wallet-bridge/src/dispatcher.ts:207-1011`, especially `227-292`, `310-339`, `371-394`, `404-521`, `531-760`, `770-825`, `835-1006`.

## F3: Scope enforcement repeats the same checker skeletons
1. Title: Scope enforcement repeats the same checker skeletons.
2. Smell name: Duplicate Code.
3. Maintenance impact bucket: structural/local. Blast radius: one file today, but every scope-policy edit fans across several near-copies. Change frequency: medium; the repo-map hotspot summary reports `packages/wallet-bridge/src/scope-enforcement.ts` was touched 4 times in the last 3 months.
4. Concrete evidence: `checkGetAddressBook()` and `checkRegisterSender()` at `packages/wallet-bridge/src/scope-enforcement.ts:300-319` are byte-identical except for the method name in the error string. `checkRegisterContract()`, `checkGetContractMetadata()`, and `checkGetContractClassMetadata()` at `53-88` all follow the same parse-target / fetch-cap-family / early-return / boolean-check / formatted-error skeleton. `checkTransactionCalls()` and `checkSimulationTransactions()` at `90-130` repeat the same `exec.calls` validation, empty-array handling, typed-call projection, descriptor building, and failure formatting.
5. Why it harms future change: changing a shared policy convention like empty-grant handling, call-array validation, or error composition requires synchronized edits across multiple clones, which encourages new checkers to be copy-pasted again.
6. Smallest safe refactoring: Extract Function into reusable helpers such as `checkBooleanSubgrant`, `checkAddressScopedGrant`, and `checkCallArrayScope`, parameterized by capability access and error text.
7. What disappears: repeated control flow, repeated data extraction, and the need to audit several near-identical functions for each scope-policy change.
8. Instances: `packages/wallet-bridge/src/scope-enforcement.ts:53-88,90-130,300-319`.

## F4: CAIP helpers exist as two competing source-of-truth modules
1. Title: CAIP helpers exist as two competing source-of-truth modules.
2. Smell name: Duplicate Code.
3. Maintenance impact bucket: architectural. Blast radius: 2 modules with many downstream consumers. Change frequency: low-to-moderate; neither file is hotspot-listed, but both are shared helper entry points for dispatcher and extension-side services.
4. Concrete evidence: `formatCaipChain`, `formatCaipAccount`, `parseCaipAccount`, `resolveNetworkByChainId`, and the local `NetworksQuery` helper are duplicated between `packages/wallet-bridge/src/caip.ts:23-69` and `packages/extension/src/wallet/utils/caip.ts:21-87`. The ownership comments also diverge: bridge says the extension copy is the source of truth at `packages/wallet-bridge/src/caip.ts:5-9`, while the extension file claims to be the single source of truth for extension-side CAIP handling at `packages/extension/src/wallet/utils/caip.ts:4-9`.
5. Why it harms future change: any CAIP parsing or validation change must be applied twice, and there is no compiler or module boundary forcing the two copies to stay behaviorally aligned.
6. Smallest safe refactoring: Move Function / Extract Module so one pure CAIP helper module owns the shared logic and the other layer re-exports it.
7. What disappears: line-for-line helper duplication and ambiguous ownership over which CAIP implementation is authoritative.
8. Instances: `packages/wallet-bridge/src/caip.ts:15-69`, `packages/extension/src/wallet/utils/caip.ts:16-87`.

## F5: Capability kinds are modelled as freeform strings across the bridge and UI
1. Title: Capability kinds are modelled as freeform strings across the bridge and UI.
2. Smell name: Primitive Obsession.
3. Maintenance impact bucket: architectural/structural. Blast radius: 3 modules plus the popup/settings surfaces that consume capability metadata. Change frequency: low-to-moderate; capability additions are infrequent, but every one crosses bridge types, storage, and UI metadata.
4. Concrete evidence: the canonical capability discriminators live only as string literals in `packages/wallet-bridge/src/capabilities.ts:16-59`. `packages/wallet-bridge/src/capability-map.ts:11` re-declares the same six kinds as a separate `CapabilityType` union. `RejectedCapabilityRecord` stores `capabilityType: string` at `packages/wallet-bridge/src/capabilities.ts:66-68`. `CAPABILITY_LABELS` is typed as `Record<string, CapabilityInfo>`, and `getCapabilityInfo()` / `isKnownCapability()` accept raw `string` at `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:29-34,83-101`. That file explicitly says the table must be kept in sync manually with the `Capability` union.
5. Why it harms future change: adding or renaming a capability kind gets little compiler help across storage, routing, and UI metadata, so the most likely failure mode is silent fallback to “unknown permission” until every string mirror is updated by hand.
6. Smallest safe refactoring: Replace Primitive with a shared `CapabilityKind = Capability["type"]`, type `RejectedCapabilityRecord.capabilityType` to it, and constrain `CAPABILITY_LABELS` with `satisfies Record<CapabilityKind, CapabilityInfo>`.
7. What disappears: stringly-typed drift surfaces and the manual sync burden between capability definitions, storage records, and UI metadata.
8. Instances: `packages/wallet-bridge/src/capabilities.ts:16-59,66-68`, `packages/wallet-bridge/src/capability-map.ts:11-21`, `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:29-34,83-101,179-199`.

## Non-findings
- `DispatchHooks` versus `IExecutionHooks` was considered, but the narrower dispatcher-facing bag is intentional because `originKey` is derived from `ctx.origin`, and the extension-side `ExecutionHooks` already aliases `IExecutionHooks`.
- The manual re-export shims in `dapp-session/spec.ts`, `dapp-interaction/spec.ts`, and `execution/models/index.ts` were considered, but within this cluster I did not find a concrete drift or high-churn failure family strong enough to beat the prompt’s convention carve-out.
- The stale package comment in `packages/wallet-bridge/src/index.ts` is documentation drift, but cosmetic only.
- The heavy `F-00x` audit comments in `dispatcher.ts` were not flagged because the prompt explicitly whitelists those markers.

## Out-of-scope observations
- None.