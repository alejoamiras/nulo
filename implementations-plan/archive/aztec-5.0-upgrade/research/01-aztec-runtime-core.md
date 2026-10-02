# Research: aztec-runtime core (TS) — 4.2.0 → 5.0.0-rc.1

Source: read-only Explore sweep + maintainer verification. Paths repo-relative.

## File inventory (touched surface)
- `packages/aztec-runtime/src/pxe/chain-runtime.ts` — `createPXE` factory, `AcceleratorProver` wiring, required/proverless modes.
- `packages/aztec-runtime/src/pxe/service.ts` — `proveTx`/`simulateTx`/`SimulationOverrides`, `getBlock`, contract-instance cascade.
- `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts` — sole `createAztecNodeClient` call site (line 55).
- `packages/aztec-runtime/src/account/nulo-account.ts` — `deriveKeys`/publicKeys, `DefaultMultiCallEntrypoint`, `getNodeInfo`.
- `packages/aztec-runtime/src/account/fee-options.ts` — **byte-for-byte copy** of `@aztec/wallet-sdk/base-wallet/base_wallet.js` fee logic.
- `packages/aztec-runtime/src/pxe/known-artifacts.ts` — AuthRegistry / FeeJuice / MultiCallEntrypoint / PrivateFPC / WonderlandToken artifacts.
- `packages/aztec-runtime/src/pxe/note-schemas.ts` — hardcoded storage slots `0x1` (PrivateFPC), `0x3` (Token), `0x7` (NFT/WonderlandToken).
- Tests: `chain-runtime.test.ts`, `service.test.ts`, `account/fee-options.test.ts`, `utils/chain-identity.test.ts`.

## Breaking call-sites (high-confidence)
| file:line | symbol | breaks-because | migration |
|---|---|---|---|
| chain-runtime.ts:143,192 | `createPXE(node,cfg,{...})` | 5.0 createPXE auto-preloads MultiCallEntrypoint but **NOT AuthRegistry**; wallet uses `createPXE` (not EmbeddedWallet) and HAS an `auth-registry/service.ts` consumer | pass `preloadedContractsProvider` incl. AuthRegistry (and re-list MultiCallEntrypoint, since provider REPLACES the default), or register AuthRegistry explicitly. MEDIUM-HIGH. |
| service.ts (proveTx) | `proveTx(req, scopes)` | scopes → options bag | `proveTx(req,{scopes, senderForTags?})` |
| service.ts (SimulationOverrides) | `new SimulationOverrides(contracts)` | positional → options bag; entries are `{instance}` only (no `artifact`) | `new SimulationOverrides({contracts})`; for artifact override, pre-register class + set `currentContractClassId` |
| account/fee-options.ts | `GasSettings.forEstimation/fallback`, fee logic | `getGasLimits` moved to `@aztec/wallet-sdk/base-wallet` w/ new sig `(gasUsed, Gas.from(txsLimits.gas), padding)`; `estimateGas`/`estimatedGasPadding` removed; result `estimatedGas`→`gasUsed`; `GasSettings.fallback` now requires explicit `gasLimits`; `NodeInfo.txsLimits` required; constants `APPROXIMATE_MAX_DA_GAS_PER_BLOCK`/`FALLBACK_TEARDOWN_*` removed from stdlib | **re-sync the byte-for-byte copy against 5.0 base_wallet**; fetch `node.getNodeInfo().txsLimits.gas`, pass explicit gasLimits. HIGH — primary fee hotspot. |
| nulo-account.ts (deriveKeys) | `keys.publicKeys` → contract instantiation | PublicKeys ctor changed `(npkMHash, ivpkM, ovpkMHash, tpkMHash)`; KeyValidationRequest pkMHash; KeyStore.getMasterSecretKey(pkMHash) | auto-binding usually absorbs; typecheck will flag if hand-rolled. MEDIUM (account critical path). |
| account/index, nulo-account | `getNodeInfo()` | `NodeInfo.txsLimits` now required; client cannot talk to pre-5.0 nodes | none beyond reading txsLimits for fee fallback. |

## Fee logic (the copy) — deepest risk
`fee-options.ts` mirrors upstream `base_wallet.js:128-160` verbatim (documented). 5.0 reshaped that exact region: `getGasLimits` relocated + new signature, estimate options gone, `gasUsed` replaces `estimatedGas`, fallback needs explicit limits from node `txsLimits`. Plan: re-read the 5.0 `base_wallet` source post-install, re-copy, then re-green `fee-options.test.ts` (6 cases pin `forEstimation`/`fallback` + MIN_FEE_PADDING=0.5).

## Hardcoded constants / addresses
- note-schemas slots `0x1/0x3/0x7` — verify against new `artifact.storageLayout` post-bump (likely stable).
- Protocol contract addresses compacted to 1–3 in 5.0 (ContractClassRegistry→1, ContractInstanceRegistry=2, FeeJuice→3). Artifacts derive addresses at runtime → low risk, but verify `known-artifacts.ts` import paths still resolve.
- `chain-runtime.test.ts` mock hardcodes `sdkAztecVersion: "4.2.0"` → update to 5.0.0-rc.1.

## Precedent (aztec-4.2.0-bump)
- Re-vendor `packages/extension/libs/@aztec/bb.js/{barretenberg,barretenberg-threads}.wasm.gz` from `node_modules/@aztec/bb.js/dest/browser/` (npm bump only updates JS half). REQUIRED.
- Storage version bump + PXE wipe (now `CURRENT_VERSION=7` in `packages/extension/src/wallet/storage/migrate.ts`).
- `GasSettings.fallback` rename already handled last bump; 5.0 changes the signature again.

## Open questions / risks
1. AuthRegistry preload under `createPXE` (MEDIUM-HIGH) — does any flow need it pre-registered? `auth-registry/service.ts` exists.
2. Fee copy re-sync correctness (HIGH) — must diff 5.0 base_wallet.
3. PublicKeys/deriveKeys signature (MEDIUM) — account creation critical path.
4. SimulationOverrides + simulate `overrides` shape (MEDIUM).
