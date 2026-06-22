# Phase 2 Clusters (security focus)

Clustering route: by entrypoint + sink family. Trust-boundary-crossing flows each get their own cluster.

## C1 — dApp-bridge dispatcher + scope enforcement
**Surface**: Every RPC method a dApp can call.
**Files**:
- `packages/wallet-bridge/src/dispatcher.ts`
- `packages/wallet-bridge/src/scope-enforcement.ts`
- `packages/wallet-bridge/src/capability-map.ts`
- `packages/wallet-bridge/src/capabilities.ts`
- `packages/wallet-bridge/src/dapp-interaction-protocol.ts`
- `packages/wallet-bridge/src/operation.ts`
- `packages/wallet-bridge/src/session-types.ts`
- `packages/wallet-bridge/src/caip.ts`

## C2 — Content-script + wallet-sdk handler
**Surface**: Untrusted dApp page → content script → SW boundary.
**Files**:
- `packages/extension/src/content-script/content.ts`
- `packages/extension/src/wallet/services/wallet-sdk/background.ts`
- `packages/extension/src/wallet/services/wallet-sdk/content-script-validator.ts`
- `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts`
- `packages/extension/src/wallet/services/wallet-sdk/*.ts` (other wallet-sdk wiring files)

## C3 — Extension-messaging IPC layer
**Surface**: popup ↔ SW ↔ offscreen channels.
**Files**:
- `packages/extension-messaging/background/service.ts`
- `packages/extension-messaging/background/client.ts`
- `packages/extension-messaging/offscreen/service.ts`
- `packages/extension-messaging/offscreen/client.ts`
- `packages/extension-messaging/src/messages.ts`
- `packages/extension-messaging/src/errors.ts`
- `packages/extension-messaging/src/utils.ts`
- `packages/extension-messaging/src/lazy-listener.ts`
- `packages/extension-messaging/src/subscribe-with-snapshot.ts`

## C4 — Crypto primitives
**Surface**: All wallet-crypto + array_equals comparator used by it.
**Files**:
- `packages/wallet-crypto/src/encryption-key.ts`
- `packages/wallet-crypto/src/password-secret-box.ts`
- `packages/wallet-crypto/src/passkey-credential.ts`
- `packages/wallet-crypto/src/zeroize.ts`
- `packages/wallet-crypto/src/constants.ts`
- `packages/wallet-core/src/utils/arrays.ts` (array_equals)
- `packages/wallet-core/src/utils/random.ts` (CSPRNG)
- `packages/wallet-core/src/utils/mnemonic.ts`

## C5 — Profile + session + auth + backup
**Surface**: Wallet unlock, session restore, profile creation, backup/restore.
**Files**:
- `packages/extension/src/wallet/services/profile/service.ts`
- `packages/extension/src/wallet/services/profile/session-manager.ts`
- `packages/extension/src/wallet/services/profile/*.ts` (entire profile service dir)
- `packages/extension/src/wallet/services/passkey/service.ts`
- `packages/extension/src/composables/useFullBackupImport.ts`
- `packages/extension/src/popup/utils/passkey-ceremony.ts`

## C6 — DappInteractionService + popup approval flows
**Surface**: Popup approval UX for sendTx, registerToken, requestCapabilities.
**Files**:
- `packages/extension/src/wallet/services/dapp-interaction/service.ts`
- `packages/extension/src/wallet/services/dapp-interaction/*.ts`
- `packages/extension/src/wallet/services/dapp-session/service.ts`
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue`
- `packages/extension/src/popup/components/popups/NewTokenPopup.vue`
- `packages/extension/src/popup/components/popups/RequestCapabilitiesPopup.vue` (if exists)
- `packages/extension/src/popup/components/popups/SendTxPopup.vue` (if exists)

## C7 — Storage + migration + entity persistence
**Surface**: chrome.storage.local/session writes; migration; FSM persistence.
**Files**:
- `packages/extension/src/wallet/storage/migrate.ts`
- `packages/wallet-core/src/storage/entity_storage.ts`
- `packages/wallet-core/src/storage/value-storage.ts`
- `packages/extension/src/wallet/services/operation-journal/service.ts` (FSM journal)
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts`

## C8 — PXE + accelerator + offscreen + Aztec node URL
**Surface**: Offscreen PXE wiring, Aztec node RPC, accelerator gating.
**Files**:
- `packages/aztec-runtime/src/pxe/*.ts`
- `packages/aztec-runtime/src/adapters/aztec-node-factory.ts`
- `packages/aztec-runtime/src/account/nulo-account.ts`
- `packages/aztec-runtime/src/utils/fetch.ts`
- `packages/extension/src/offscreen/index.ts`
- `packages/extension/src/accelerator/config.ts`
- `packages/extension/src/wallet/utils/offscreen.ts`
- `packages/extension/src/wallet/services/network/service.ts`
