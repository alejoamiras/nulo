# Cluster plan — 2026-06-11-ultra-50b45d

Effort: ultra. Per cluster: 2× Claude Fable + 2× Codex xhigh, independent. Clustering by package boundary + similarity (likely-duplicate modules share a cluster).

## C1 — execution service (pain-point prior)
Scope: `packages/extension/src/wallet/services/execution/**` (facade + 19 extracted files + fee/ + helpers/ + models/ + spec/client; tests in scope for harness-duplication only).
Map ref: repo-map/extension-wallet.md §5.

## C2 — wallet-service fleet patterns
Scope: `packages/extension/src/wallet/services/{token,transaction,contact,config,network,fpc,auth-registry,account,profile,dapp-session}/service.ts` (+ profile/repository.ts, profile/session-manager.ts, dapp-session/capability-meta.ts as context), `packages/extension/src/wallet/runtime.ts`, `packages/extension-messaging/src/background/service.ts` (base-class context only).
Focus: cross-service copy-paste families (backup/restore ×9, onProfileDeleted ×6, active-profile guards, lock idioms, EntityStorage construction, event triples, PxeServiceClient ×8, ensureInitialized preambles, dependencies-declaration gap).
Map ref: repo-map/extension-wallet.md §3-§4.

## C3 — wallet-bridge protocol layer
Scope: `packages/wallet-bridge/src/**` + `packages/extension/src/wallet/utils/caip.ts` + `packages/extension/src/wallet/services/dapp-session/{spec.ts,capability-meta.ts}` + `packages/extension/src/wallet/services/dapp-interaction/spec.ts` + `packages/extension/src/wallet/services/execution/models/index.ts` (re-export shims).
Focus: dispatcher concern count, 3 parallel method tables, checker duplication, caip line-for-line duplicate, sync-by-comment surfaces, DispatchHooks vs IExecutionHooks.
Map ref: repo-map/wallet-bridge.md.

## C4 — popup UI duplication families
Scope: `packages/extension/src/popup/components/popups/{New,Edit}*.vue`, `Select*Popup.vue`, `packages/extension/src/popup/pages/import.vue` + `packages/extension/src/onboarding/pages/{import,create}.vue` + `packages/extension/src/popup/pages/profile/new.vue`, `packages/extension/src/popup/pages/settings/advanced/account-state/*/index.vue`, `packages/extension/src/components/{AddressDisplay,ScopeAddress,ScopeClassId}.vue`, `packages/extension/src/popup/components/modules/general/{BalanceView,SplittedBalancesView,RecentActivityView}.vue` + `recent-activity-handlers.ts`, `packages/extension/src/popup/components/modules/activity/*`, `packages/extension/src/components/composite/activity/*`, `packages/extension/src/utils/{journal-state,card-subtitle,activity-rows}.ts`, `packages/extension/src/popup/windows/execute/*` (UI side), composables `useEntityCrud`/`useFormState`/`useFeeEstimation*`.
Focus: the 9 similarity families in the UI map + layer-rule gaps (CapabilityDetailPanel/DappIdentityBlock in composite/, onboarding→PasskeyCeremonyDialog import).
Map ref: repo-map/extension-ui.md §4.

## C5 — PXE + messaging transport layer
Scope: `packages/aztec-runtime/src/**`, `packages/extension-messaging/src/**`, `packages/extension/src/wallet/services/pxe/client.ts`, `packages/extension/src/wallet/utils/offscreen.ts`, `packages/extension/src/wallet/base/**` (test-location inversion).
Focus: 5-surface PXE method enumeration, background-vs-offscreen client/service duplication, divergent error surfaces, dead subpaths (lazy-listener, subscribe-with-snapshot), dead exports, upstream-mirror drift surfaces, NetworkInfo double declaration.
Map ref: repo-map/aztec-runtime-messaging.md.

## C6 — core libs + infra/config
Scope: `packages/wallet-core/src/**`, `packages/wallet-crypto/src/**`, `packages/extension/src/utils/**`, entries (`packages/extension/src/{wallet,popup,offscreen,onboarding}/index.ts`, `content-script/content.ts`, `setup/`), configs (`packages/extension/vite*.{ts,mts}`, `vitest*.ts`, `manifest/*`), `packages/extension/scripts/e2e/*`, `packages/extension/tests/e2e/fixtures/{extension,helpers}.ts` (harness duplication only).
Focus: mnemonic outlier, 3 stringify variants, dead exports (wallet-core + wallet-crypto + dead dep @aztec/stdlib), console-hijack ×4, config sprawl (vite/vitest duplication, in-place plugin mutation), utils overlaps (primary-method/tx-enrichment, amount/fee-estimation, lastActiveProfile/sentinel, general.js), fixtures duplication.
Map ref: repo-map/wallet-core-crypto.md + repo-map/extension-infra.md.

## Output naming
`raw/c<N>-<claude|codex>-<1|2>.md` per agent. Rebuttals appended as `## Cross-rebuttal` (Round 1) and `## Round 2 push-back` sections.
