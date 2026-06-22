## F1: `WalletSdkDispatcher` owns too many independent responsibilities
1. Title: `WalletSdkDispatcher` mixes protocol routing, popup orchestration, grant mutation, account projection, and operation building.
2. Smell name: `Large Class` (Fowler bloater); the same class changes for unrelated reasons such as adding a wallet method, changing grant persistence, or changing account-resolution rules.
3. Maintenance impact bucket: structural; blast radius is 1 file but it is the protocol hub for 5 service interfaces and most wallet-sdk flows; change frequency is high, with `packages/wallet-bridge/src/dispatcher.ts` touched in 8 commits from 2026-03-11 to 2026-06-11.
4. Concrete evidence: `dispatch()` does method routing and special-case branching at `dispatcher.ts:227`; `handleGetAccounts` owns session/account projection at `:310`; `handleBatch` owns batch semantics at `:371`; `handleSendTx` and `handleRegisterToken` own popup-gated execution at `:404` and `:483`; `handleRequestCapabilities` owns grant delta/rejection/session writes at `:531`; `enrichGrantedCapabilities` owns response shaping at `:707`; `enforceCapability` owns grant checks at `:770`; `buildOperation`/builders own protocol-to-operation translation at `:835`; `resolveNetworkAndAccount` owns session account selection at `:984`.
5. Why it harms future change: a single protocol change now requires reading and preserving invariants from unrelated flows in a 1,000-line file, so small edits carry high regression risk and expensive review/test setup.
6. Smallest safe refactoring: `Extract Class` for at least grant negotiation/session mutation, session-account resolution, and operation building, leaving the dispatcher as a thin entrypoint.
7. What disappears: unrelated change axes stop colliding in one file, and the dispatcher no longer has to own both transport concerns and domain shaping concerns.
8. Instances: [dispatcher.ts:227](packages/wallet-bridge/src/dispatcher.ts:227), [dispatcher.ts:310](packages/wallet-bridge/src/dispatcher.ts:310), [dispatcher.ts:371](packages/wallet-bridge/src/dispatcher.ts:371), [dispatcher.ts:404](packages/wallet-bridge/src/dispatcher.ts:404), [dispatcher.ts:483](packages/wallet-bridge/src/dispatcher.ts:483), [dispatcher.ts:531](packages/wallet-bridge/src/dispatcher.ts:531), [dispatcher.ts:707](packages/wallet-bridge/src/dispatcher.ts:707), [dispatcher.ts:770](packages/wallet-bridge/src/dispatcher.ts:770), [dispatcher.ts:835](packages/wallet-bridge/src/dispatcher.ts:835), [dispatcher.ts:984](packages/wallet-bridge/src/dispatcher.ts:984).

## F2: Wallet method knowledge is spread across parallel registries
1. Title: One wallet-sdk method must be encoded in several unrelated tables and branches.
2. Smell name: `Shotgun Surgery` (Fowler); changing one protocol method requires coordinated edits to multiple registries and control-flow branches that must stay manually synchronized.
3. Maintenance impact bucket: architectural; blast radius is 3 files and at least 6 separate registries/branches; change frequency is high, with `dispatcher.ts`/`capability-map.ts`/`scope-enforcement.ts` touched in 15 commits combined from 2026-03-11 to 2026-06-11.
4. Concrete evidence: method-to-operation mapping lives in `METHOD_TO_KIND` at `dispatcher.ts:163`, execution context is split between `NETWORK_ONLY_KINDS` at `:184` and `ACCOUNT_KINDS` at `:198`, popup-gated methods are hard-coded in `dispatch()` at `:252` and `handleBatch()` at `:382`, capability requirements live in `METHOD_CAPABILITY_MAP` at `capability-map.ts:21`, exemptions live in `EXEMPT_METHODS` at `capability-map.ts:18`, and scope handlers live in `METHOD_SCOPE_CHECKER` at `scope-enforcement.ts:348`; `scope-enforcement.ts:9` explicitly says its arg shapes must stay in sync with dispatcher builders.
5. Why it harms future change: adding, retiring, or reclassifying a method means remembering every place that describes it; missing one edit leaves the method surface internally inconsistent even though each table looks locally correct.
6. Smallest safe refactoring: named analog refactoring, introduce one canonical `MethodDescriptor` registry and derive kind, capability, scope checker, and resolution strategy from that single source.
7. What disappears: sync-by-comment maintenance and parallel registries vanish, so method additions become a single-table change instead of a scavenger hunt.
8. Instances: [dispatcher.ts:163](packages/wallet-bridge/src/dispatcher.ts:163), [dispatcher.ts:184](packages/wallet-bridge/src/dispatcher.ts:184), [dispatcher.ts:198](packages/wallet-bridge/src/dispatcher.ts:198), [dispatcher.ts:252](packages/wallet-bridge/src/dispatcher.ts:252), [dispatcher.ts:382](packages/wallet-bridge/src/dispatcher.ts:382), [capability-map.ts:18](packages/wallet-bridge/src/capability-map.ts:18), [capability-map.ts:21](packages/wallet-bridge/src/capability-map.ts:21), [scope-enforcement.ts:9](packages/wallet-bridge/src/scope-enforcement.ts:9), [scope-enforcement.ts:348](packages/wallet-bridge/src/scope-enforcement.ts:348).

## F3: CAIP parsing and formatting is duplicated across two packages
1. Title: The bridge and extension each carry their own CAIP helper implementation.
2. Smell name: `Duplicate Code` (Fowler).
3. Maintenance impact bucket: structural; blast radius is 2 files in different packages; change frequency is low-to-moderate, with the pair touched in 2 commits combined from 2026-03-11 to 2026-06-11.
4. Concrete evidence: both `packages/wallet-bridge/src/caip.ts` and `packages/extension/src/wallet/utils/caip.ts` define the same `AZTEC_NAMESPACE`, `formatCaipChain`, `formatCaipAccount`, `parseCaipAccount`, and `resolveNetworkByChainId`; the ownership comments even conflict, with bridge saying extension is the source of truth (`wallet-bridge/src/caip.ts:5`) while extension says it is the single source of truth (`extension/.../caip.ts:4`).
5. Why it harms future change: tightening CAIP validation or adjusting formatting now requires editing two modules and re-verifying that every caller picked up the same change.
6. Smallest safe refactoring: `Move Function` into one canonical CAIP module, then re-export from the other package only if the import boundary still needs the old path.
7. What disappears: duplicated parser/formatter logic and split ownership of CAIP semantics disappear.
8. Instances: [wallet-bridge/src/caip.ts:1](packages/wallet-bridge/src/caip.ts:1), [extension/src/wallet/utils/caip.ts:1](packages/extension/src/wallet/utils/caip.ts:1).

## F4: Authorized-account loading and projection is repeated inside the dispatcher
1. Title: Session account resolution is hand-rebuilt in four dispatcher paths.
2. Smell name: `Duplicate Code` (Fowler).
3. Maintenance impact bucket: structural; blast radius is 1 hot file; change frequency is high because `dispatcher.ts` changed 8 times from 2026-03-11 to 2026-06-11.
4. Concrete evidence: `formatSessionAccounts()` does `resolveNetwork → getAccounts → filter session accounts → map alias` at `dispatcher.ts:347`; `handleRegisterToken()` repeats `resolveNetwork → getAccounts → filter session accounts` at `:494`; `enrichGrantedCapabilities()` repeats the same loading/filtering plus the alias projection at `:721`; `resolveNetworkAndAccount()` repeats the same loading/filtering again at `:989`.
5. Why it harms future change: any change to how authorized accounts are selected, filtered by chain, or aliased must be replicated across independent code paths, so behavior drifts easily.
6. Smallest safe refactoring: `Extract Method` for `loadAuthorizedAccounts(ctx, dappSession)` and a second `Extract Method` for account-to-wire projection.
7. What disappears: repeated network lookup, account loading, session filtering, and alias formatting logic disappear from individual handlers.
8. Instances: [dispatcher.ts:347](packages/wallet-bridge/src/dispatcher.ts:347), [dispatcher.ts:494](packages/wallet-bridge/src/dispatcher.ts:494), [dispatcher.ts:721](packages/wallet-bridge/src/dispatcher.ts:721), [dispatcher.ts:984](packages/wallet-bridge/src/dispatcher.ts:984).

## F5: Scope enforcement repeats the same checker skeletons
1. Title: Per-method scope checks are copy-variants instead of parameterized helpers.
2. Smell name: `Duplicate Code` (Fowler).
3. Maintenance impact bucket: local; blast radius is 1 file; change frequency is medium, with `scope-enforcement.ts` touched in 4 commits from 2026-03-11 to 2026-06-11.
4. Concrete evidence: `checkRegisterContract`, `checkGetContractMetadata`, and `checkGetContractClassMetadata` at `scope-enforcement.ts:53`, `:66`, and `:78` all repeat the same target extraction / `grantsOfType` / `.some()` / throw pattern; `checkTransactionCalls` and `checkSimulationTransactions` at `:90` and `:109` repeat the same `exec.calls` parsing and error assembly; `checkGetAddressBook` and `checkRegisterSender` at `:300` and `:313` are byte-identical except for the method name in the error string.
5. Why it harms future change: changing common enforcement behavior, error wording, or guard semantics means editing several near-identical functions and trusting that every copy stayed aligned.
6. Smallest safe refactoring: `Extract Method` plus `Parameterize Method` for boolean sub-grant checks, address-list scoped checks, and call-list scoped checks.
7. What disappears: near-identical checker bodies and repeated permit/throw scaffolding disappear, leaving only per-method parameters.
8. Instances: [scope-enforcement.ts:53](packages/wallet-bridge/src/scope-enforcement.ts:53), [scope-enforcement.ts:66](packages/wallet-bridge/src/scope-enforcement.ts:66), [scope-enforcement.ts:78](packages/wallet-bridge/src/scope-enforcement.ts:78), [scope-enforcement.ts:90](packages/wallet-bridge/src/scope-enforcement.ts:90), [scope-enforcement.ts:109](packages/wallet-bridge/src/scope-enforcement.ts:109), [scope-enforcement.ts:132](packages/wallet-bridge/src/scope-enforcement.ts:132), [scope-enforcement.ts:300](packages/wallet-bridge/src/scope-enforcement.ts:300), [scope-enforcement.ts:313](packages/wallet-bridge/src/scope-enforcement.ts:313).

## F6: Backward-compatibility spec files act as a middle-man chain
1. Title: Bridge types are forwarded through multiple extension shim modules before reaching callers.
2. Smell name: `Middle Man` (Fowler).
3. Maintenance impact bucket: structural; blast radius is 3 shim files plus in-scope consumers that chain through them; change frequency is medium-high, with `dapp-interaction/spec.ts`, `dapp-session/spec.ts`, and `execution/models/index.ts` touched in 9 commits combined from 2026-03-11 to 2026-06-11.
4. Concrete evidence: `dapp-session/spec.ts` re-exports bridge capability/session types “for backward compatibility” at `:5-25`; `dapp-interaction/spec.ts` re-exports 26 bridge protocol types at `:6-37` and aliases `IExecutionHooks` at `:56-62`; `execution/models/index.ts` re-exports almost its entire public type surface from bridge at `:1-62` before adding one local type at `:64`; and `wallet/utils/caip.ts:16` imports `CaipAccount`/`CaipChain` through `dapp-interaction/spec.ts` instead of from bridge directly.
5. Why it harms future change: renaming or adding bridge types requires mirrored export-list maintenance and keeps consumers split between legacy shim paths and the actual package boundary.
6. Smallest safe refactoring: `Remove Middle Man` by migrating consumers to direct `@nulo/wallet-bridge` imports, then shrinking the shim modules to only their truly local types.
7. What disappears: duplicated export lists and one-hop type indirection disappear, leaving one canonical home for bridge protocol types.
8. Instances: [dapp-session/spec.ts:5](packages/extension/src/wallet/services/dapp-session/spec.ts:5), [dapp-interaction/spec.ts:6](packages/extension/src/wallet/services/dapp-interaction/spec.ts:6), [dapp-interaction/spec.ts:56](packages/extension/src/wallet/services/dapp-interaction/spec.ts:56), [execution/models/index.ts:1](packages/extension/src/wallet/services/execution/models/index.ts:1), [extension/src/wallet/utils/caip.ts:16](packages/extension/src/wallet/utils/caip.ts:16).

## Non-findings
- `DispatchHooks` vs `IExecutionHooks`: considered, but `ExecutionHooks` already aliases the bridge interface in `dapp-interaction/spec.ts`, and the only remaining adaptation in scope is the explicit `handleSendTx()` bridge at `dispatcher.ts:458`.
- `CAPABILITY_LABELS` vs `Capability["type"]`: considered, but within this cluster it is one metadata table behind centralized helpers, and I did not see enough change amplification in scope to rank it above the findings above.
- `wallet-bridge/src/index.ts` exporting `dispatcher` despite its stale header comment: comment drift only, without a separate named maintainability smell beyond the stronger issues above.

## Out-of-scope observations
- None in the reviewed C3 source scope.