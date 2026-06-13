# Map — @nulo/wallet-bridge

Mapper: Fable Explore subagent. Total src 7,934 LOC incl. tests. Raw-TS export, no build.

## 1. Module inventory

dispatcher.ts 1011 (WalletSdkDispatcher — routes every wallet-sdk method, enforces capabilities/scope, mutates session grants) · dispatcher.test.ts 973 · scope-enforcement.test.ts 531 · scope-enforcement.ts 421 (12 method checkers + F-005 account-scope validation) · operation.ts 191 (18-variant Operation union) · dapp-interaction-protocol.ts 156 · services-contract.ts 104 (structural consumer interfaces) · discovery-queue.ts 78 · caip.ts 70 · capabilities.ts 69 · fee.ts 67 · session-types.ts 66 · capability-map.ts 61 · action.ts 55 · operation-result.ts 29 · index.ts 26 (export * barrel) · authwit-content.ts 24 · transaction-origin.ts 21 · types.ts 14.

Doc drift: index.ts header (5-8) says "dispatcher stays in @nulo/extension" while line 18 exports ./dispatcher.

## 2. Consumption (all in packages/extension)

- background.ts — only runtime-class consumer: WalletSdkDispatcher, DiscoveryQueue, DispatchHooks, SessionContext.
- dapp-session/spec.ts — re-exports AccessLevel + 12 types "for backward compatibility".
- execution/models/index.ts — re-exports ~38 types + PRIORITY_MULTIPLIERS.
- dapp-interaction/spec.ts — re-exports all 18 *Request types; aliases IExecutionHooks as ExecutionHooks.
- transaction/spec.ts — OriginType, TxOrigin, LocalTxOrigin.
- popup windows execute/capabilities — Operation/Capability types.
- NOT directly imported by extension: enforceScope*, unwrapOperationResult, caip fns, capability-map helpers (internal to dispatcher).

## 3. Dependency graph

dispatcher.ts imports 11 of 15 siblings (hub). action.ts ↔ authwit-content.ts type-level cycle. operation.ts is the only file touching @aztec/* (all import type). No aztec-runtime imports (invariant holds). @aztec/wallet-sdk dep used only type-only in discovery-queue.

## 4. Similarity candidates

Within scope-enforcement.ts:
- checkGetAddressBook (300-306) vs checkRegisterSender (313-319) — **byte-identical bodies** except error string.
- checkRegisterContract/checkGetContractMetadata/checkGetContractClassMetadata (53-88) share identical 4-step skeleton.
- checkTransactionCalls (90-107) vs checkSimulationTransactions (109-130) same structure; checkExecuteUtility (132-151) single-call variant.
- Empty-grants pass-through convention repeated 9×.

Within dispatcher.ts:
- Account-projection logic twice: formatSessionAccounts (347-359) vs enrichGrantedCapabilities canGet branch (741-747) — format parity test-pinned, not shared.
- resolveNetwork→getAccounts→getSessionAccountAddresses recurs ×4 (formatSessionAccounts, handleRegisterToken 494-497, enrichGrantedCapabilities 721-724, resolveNetworkAndAccount 989-996).
- Rejection-merge logic duplicated: catch 622-630 vs grant-path 678-684.

Cross-package:
- **caip.ts vs extension wallet/utils/caip.ts (87)**: formatCaipChain/formatCaipAccount/parseCaipAccount line-for-line duplicates; BOTH claim source-of-truth in headers.
- dapp-session capability-meta.ts CAPABILITY_LABELS sync-by-comment with Capability union (not type-enforced).
- **Three parallel method tables**: capability-map METHOD_CAPABILITY_MAP + EXEMPT_METHODS vs dispatcher METHOD_TO_KIND + NETWORK_ONLY_KINDS/ACCOUNT_KINDS vs scope-enforcement METHOD_SCOPE_CHECKER — must agree, sync-by-comment.
- DispatchHooks (dispatcher:90-107) vs IExecutionHooks (services-contract:56-60) near-identical bags.
- nulo-schema-patch: 3 deliberate inline copies (extension/faucet/playground), drift pinned by dispatcher.test.

## 5. dispatcher.ts deep-dive

1,011 LOC. Hybrid routing: if-chain for 5 special methods → METHOD_TO_KIND record (11) → buildOperation → 2 switches (7 network cases, 4 account cases). 11 distinct concerns counted: routing, capability enforcement (enforceCapability 770-825), scope-enforcement delegation, session-lookup consolidation, session mutation (handleRequestCapabilities 531-701 = 170 lines, largest), capability-response enrichment, account/network resolution, batch semantics, hook plumbing, result unwrapping, arg coercion (positional args[n] casts). Heavy audit-trail commentary (F-00x markers) inflates LOC.

## 6. Conventions

Two structured errors only (CapabilityNotGrantedError 4100, JobCancelledError 4001); "Scope violation:" prefix ×12 as public contract; rigorous import type; structural interfaces; relative imports inside package (barrel self-import forbidden); F-00x audit-traceability comments.

## 7. Tests

dispatcher.test.ts (973, ~35 tests, hand-rolled fakes, makeSession/makeSessionWriter builders; imports extension's nulo-schema-patch to pin drift). scope-enforcement.test.ts (531, ~70 tests). Extension-side type-pins: operation-validation.test, feesettings-invariant.test, batched-view-simulation.test.

## 8. Hotspots (3 months)

dispatcher.ts 8 · dispatcher.test 7 · services-contract 4 · scope-enforcement 4 (+test 4) · README 4 · operation 3 · dapp-interaction-protocol 3 · capability-map 3. Dispatcher touched by essentially every change.

## 9. Size outliers

dispatcher.ts 1,011 (2.4× next non-test; 11 concerns) — package is bimodal: two logic-heavy files + thirteen small type modules.
