# Research: wallet-bridge + custom RPC schema + extension consumers

Paths repo-relative.

## Custom RPC schema patch (the 3-copy contract)
Three identical side-effect-only files patch `WalletSchema` (from `@aztec/aztec.js/wallet`) with Zod entries, importing `schemas` from `@aztec/stdlib/schemas`:
- `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts`
- `packages/faucet/src/lib/nulo-schema-patch.ts`
- `packages/playground/src/lib/nulo-schema-patch.ts`

Patches **THREE** methods (not just `registerToken`): `registerToken` (2 args), `isTokenRegistered` (1 arg), `grantPublicAuthwit` (2 args). Each has an arity guard that **throws** if upstream signature drifted.

Drift pin: `packages/wallet-bridge/src/dispatcher.test.ts` imports the extension copy, asserts `"registerToken" in WalletSchema` and `params.items.length === 2`.

5.0 risk: HIGH if `@aztec/aztec.js/wallet` `WalletSchema` or `@aztec/stdlib/schemas` moved/renamed — patch fails at SW init (guard throws). MUST verify both import paths resolve at 5.0 and `WalletSchema` shape unchanged.

## wallet-sdk consumed surface (verify each at 5.0)
- `@aztec/wallet-sdk/base-wallet`: `buildMergedSimulationResult`, `simulateViaNode` (`fast-path.ts:45`, `batched-view-simulation.ts:133`). **`getGasLimits` now also lives here.** CRITICAL — base-wallet exports reshuffled in 5.0.
- `@aztec/wallet-sdk/extension/handlers`: `BackgroundConnectionHandler`, `ContentScriptConnectionHandler`, `ActiveSession`, `PendingDiscovery` (`background.ts:30`, `content.ts:9`, `queued-journal.ts`).
- `@aztec/wallet-sdk/types`: `WalletMessage`, `WalletResponse`.
- `@aztec/aztec.js/wallet`: `WalletSchema`, `TxSimulationResultWithAppOffset`, `ContractInitializationStatus`.

The dispatcher (`packages/wallet-bridge/src/dispatcher.ts`) itself imports **no** @aztec types (transport-shaped contracts) — insulated.

## Extension breaking call-sites
| file:line | symbol | migration |
|---|---|---|
| transaction/service.ts:213 (+ enum map :245-253) | `getTxReceipt` | union narrowing via `isMined()/isPending()/isDropped()`; verify `TxStatus`/`TxExecutionResult` enum members |
| execution/dapp-send-executor.ts:407,596 | `getTxReceipt` | same |
| auth-registry/service.ts:312 | `getTxReceipt(TxHash.fromString)` | same |
| (1 site) | `getTxEffect` | → `getTxReceipt(h,{includeTxEffect:true})` then `.txEffect` |
| tx-request-builder.ts:46, fee-strategy.ts:41, embedded-fpc-cap.ts:66, fpc-strategy.ts:25 | `GasSettings` import/usage | typecheck-gated; verify ctor + `forEstimation/fallback` |
| fee/, view-executor.ts:77, operation-planner.ts:217, dapp-send-executor.ts:497 | `gasUsed`/`gasLimits` property chains | likely stable; verify field names |

NOT found (grep clean): `DeployMethod`/`AccountManager`/`.deploy()`/`createSchnorr*`/`createEcdsa*` in extension src; PublicKeys display (masterNullifier/ovpk/tpk); `AppTaggingSecret`/`ExtendedDirectionalAppTaggingSecret`; raw `node_*`/`p2p_*` RPC strings. → these changelog items don't bite the extension directly.

## UI surfaces
- Fee: `composables/useFeeEstimation.ts`, `useFeeEstimationMap.ts`, `popup/components/modules/send/FeeSettingsCard.vue`, `wallet/services/execution/tx-fee-details.ts` (reads `gs.gasLimits.daGas/l2Gas`), `fee-structural-parity.test.ts`. Property-name dependent; verify.
- No public-key display surface (nothing to migrate for the PublicKeys-points removal).

## Precedent
4.2.0 bump: schema-patch guards catch import failures at SW init; base-wallet export moves were the main churn vector last time too.

## Open questions / risks
1. base-wallet export surface (HIGH) — `simulateViaNode`/`buildMergedSimulationResult`/`getGasLimits` location at 5.0.
2. WalletSchema / schemas import-path stability (HIGH) — patch fails loudly if moved.
3. TxReceipt union enum coverage (MEDIUM) — `transaction/service.ts:245-253`.
