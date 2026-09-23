# Repo map — dApp/execution half of `apps/extension/src/wallet/services/`

Scope: `dapp-interaction`, `dapp-session`, `execution` (+`fee/`), `fpc`, `wallet-sdk`, `window-manager`, `transaction`, `token`, `token-balance`, `note`, `pxe`, `network`, `task`, `operation-journal`, `activity-protocol`, `incoming-transfer`, `contact`, `price`, `config`, `logger`, `log-viewer`, `composition-harness.ts`.

## 0. dApp request lifecycle, end to end

**1. Page → content script.** `apps/extension/src/content-script/content.ts:9-22` — `ContentScriptConnectionHandler` pure relay: `sendToBackground: (message) => chrome.runtime.sendMessage(message)` (`:12`), `addBackgroundListener` via `chrome.runtime.onMessage` (`:14-18`).

**2. Content script → SW.** `attachContentListener` (`wallet-sdk/content-message-relay.ts`) registered from `buildContentTransport` (`background.ts:270-332`). Defenses before upstream `BackgroundConnectionHandler`: **subframe rejection** `isSubframeSender(sender)` (`content-script-validator.ts:93-95`), gated by `VITE_NULO_ALLOW_IFRAME_DAPPS` (`background.ts:89`, default false), rejects `sender.frameId !== 0` (`background.ts:283-304`); **envelope validation** `validateContentScriptMessage` (`content-script-validator.ts:97-114`, Zod `ContentScriptMessageSchema` `:51-59`) for `origin: "content-script"` only; others pass through (`background.ts:316-326`).

**3. Discovery.** `onPendingDiscovery` → `handleDiscovery` (`background.ts:336-337`, body `:619-678`). `chainInfoToChainId` (`session-established.ts:14-19`); locked → `DiscoveryQueue` (caps `DISCOVERY_PENDING_GLOBAL_CAP=32`, `PER_ORIGIN_CAP=4`, `background.ts:606-607,748-761`), drain on unlock (`wireDiscoveryDrain` `:552-576`); existing `DappSession` for `(origin, chainId)` → **auto-approve** (`autoApproveExistingSession` `:701-709`); else `DappInteractionService.discover()` (`background.ts:784`, `dapp-interaction/service.ts:352-355`) → `WindowManager.openAndAwait` URL `src/popup/index.html#/windows/discover?requestId=${id}` (`dapp-interaction/service.ts:374-380`). `sanitizeWireString` scrubs `appName`/`appId` to 64 codepoints (`background.ts:769-776`, `dapp-session/capability-meta.ts:176-181`). Approval mints a `DappSession` with **empty accounts** (`background.ts:802-808`).

**4. Key exchange + session establishment.** Upstream ECDH P-256 + AES-256-GCM, then `handleSessionEstablished` (`session-established.ts:61-169`): pending-verification marker keyed by request id (= `sessionId`) (`:65-72`, `background.ts:206-213`); stale marker → terminate (`:89-93`); approving profile must equal validating profile (`:105-109`); session live at two checkpoints (`:116-123, 131-138`). **Verify popup** opened directly via `chrome.windows.create` (not `WindowManager`): `src/popup/index.html#/windows/verify?sessionId=${dappSession.id}&verificationHash=${encodeURIComponent(session.verificationHash)}&isReconnect=${!isNewConnection}` (`:145-152`) — payload rides URL params (B-06, `:49-52`). Fail-closed terminate `:156-165`.

**5. Wallet messages.** `onWalletMessage` (`background.ts:367,371-426`). Per-session FIFO baton (`session-baton.ts`); decryption serialized per-session via `KeyedLock` (`background.ts:264-265,505-511`, monkey-patching `handler.handleEncryptedMessage`). Pre-claim journal `queued` record on arrival for top-level `sendTx` (`background.ts:398-421`, `queued-journal.ts`). Establishment-validation gate B-13 (`:381-408,455-474`). `handleWalletMessage` (`:853-971`): `enforceSessionProfileBinding` fail-closed (`:887-899`), `SessionContext {chainId, profileId, origin, sessionId}` (`:909-914`), `dispatcher.dispatch(...)` (`:920`). Response-suppression epoch check (`:947-962`).

**6. Dispatcher.** `WalletSdkDispatcher.dispatch()` (`packages/wallet-bridge/src/dispatcher.ts:641-668`): session captured once at entry (`:650`); `enforceMethodAndScope` (`:673-725`): `assertKnownMethod` (`Object.hasOwn`), `argSchema`, `assertAuthRelevantArgShape` (`:576-618`), `enforceCapability` (`:1327-1370`, fail-closed F-006), `enforceScopeWithSession`/`enforceScope`. Routes to handler methods or `executionService.executeOperations([operation], origin)` (`:663-667`). `sendTx` → `handleSendTx` (`:920-970`) resolves `opts.from` against session accounts (`resolveNetworkAndAccount` → `resolveAuthorizedSessionAccount`, `:1542-1569`) → `dappInteractionService.execute(...)`. `registerToken` → `handleRegisterToken` (`:1033-1058`). `batch` legs cannot include `sendTx`/`registerToken` (`:887-902`).

**7. Approval window bind.** `DappInteractionService.execute()` (`dapp-interaction/service.ts:317-343`): `validateSession` (`:490-537` — per-operation account/method/scope re-checks); cancelled-while-queued short-circuit (`:329-337`); `silentInteraction` (self-paid sends, no popup, `:403-488`) or `interaction()` (`:357-401`). Request id: 128-bit random `randomIdNotIn` (`:372`), embedded in popup URL. `windowManager.openAndAwait({ url: .../windows/${type}?requestId=${id}, width: 400, height: 800, timeoutMs: 600_000, kind: type })` (`:374-380`). `WindowManager` (`window-manager/window-manager.ts:56-230`) keys by random `handleId` (`:66`), matched on `chrome.windows.onRemoved` (`:119-133`). No nonce beyond `requestId`; `interaction.cancelledAt` one-shot claim (`:168-176,194-198`). Popup fetches payload via `getInteractionPayload(id)` (`:150-156`) → `{ params, session }`; `session.dappMetadata` already sanitized. `DappIdentityBlock`/`useDappHostname` (`popup/windows/execute/index.vue:124`).

**8. Displayed vs executed.** `execute/index.vue` `init()` (`:181-236`) takes `payload.params.operations` and **re-resolves** every CAIP `chain`/`account` to live rows (`buildOperationsFromPayload`, `:241-335`) — same `materializeRequest` as the silent path (`dapp-interaction/materialize.ts:54-107`). `register_token` metadata pre-fetched live (`prefetchTokenMetadata` → `tokenService.previewTokenMetadata`, `:344-374`), rendered via `safeWire`/`sanitizeWireString` (`humanize.ts:43`, `OperationCard.vue:243,251`) — **NOT homoglyph-normalized**. Fee: `feeSettings` undefined unless embedded/self-pay (`isEmbeddedFeePayment`, `:302-309,319-326`); user's `FeeSettingsCard` choice written into the DRAFT (`handleFeeUpdate` `:376-387`); gates Confirm (`requiresFeeSelection` `:487-489`). **On Approve**, popup strips UI fields, `assertExecutableOperation`, calls `approveInteraction(requestId, executable, origin, estimateIds)` (`:389-449`). **`approveInteraction` executes exactly the `operations` array the popup hands back** (`dapp-interaction/service.ts:158-187` → `executeAndResolve` → `executeOperations`, `:219-286`) — does NOT re-derive from stored `interaction.payload`. `estimateIds` never on the wire shape (`dapp-interaction/spec.ts:107-115`). `origin: LocalTxOrigin` popup-constructed from `dapp.value?.name` (`index.vue:444-449`). `executeAndResolve` re-validates active profile via `captureExecutionFence()` (`:228-268`) and the `DappSession` row (`:264-267`).

**9. Execution.** `executeOperations` → `TransferExecutor` (popup Send, no mutex slot — "Zero-slot transfer quirk", `execution/README.md:35-37`), `DappSendExecutor` (dApp `sendTx`, slot-bearing), `ViewExecutor` (read-only). `execution-lane.ts:1-24` frozen invariants (no mutex timeout/force-release). Fee strategy in `fee/build-fee-strategies.ts` → `FeeStrategy.buildAndEstimate`. `execution-coordinator.ts` `proveAndSend`; outcome → `OperationJournalService` + `TransactionService`.

## 1. Module inventory

| Module | Purpose | LOC |
|---|---|---|
| dapp-interaction | Popup-approval broker (`service.ts`, `materialize.ts`, `client.ts`, `spec.ts`). | ~899 |
| dapp-session | `DappSession` CRUD per `(origin, chainId, profileId)`, grant/rejection ledger, MAC-integrity wrapper. | ~966 |
| execution (+`fee/`, `helpers/`, `utils/`, `models/`) | Build/estimate/simulate/prove/submit every tx; fee strategies; mutex/lane; register-token/contract/sender; view-executor. | ~8820 |
| fpc (+`handlers/`) | FPC registry: protocol auto-discovery via deterministic address, user-added FPC CRUD, per-type handlers. | ~794 |
| wallet-sdk | SW wiring for `BackgroundConnectionHandler`: discovery/verify/teardown, FIFO baton, envelope validation, error envelope. | ~2279 |
| window-manager | `chrome.windows.*` lifecycle for approvals. Not a `Service`. | 230 |
| transaction | Tx-history rows, DROPPED debounce, confirmation polling. | ~875 |
| token (+`functions/`) | Token registry, `registerToken`, `parseTokenInterface`, metadata preview, default seeding (TOFU-pinned). | ~2233 |
| token-balance | Per-`(token, account)` balances; identity-triple invariant; reconcile. | ~1788 |
| note | `getNotes`/`getNotesRaw` over PXE. | 343 |
| pxe (ext-side) | Thin subclass of `PxeServiceClientBase` + offscreen-bootstrap hook; `ShallowPxeClient`. | 166 |
| network | `Network`/`NetworkEndpoint` CRUD, RPC-URL allowlist, chain-identity probing, node cache, chain-purge cascade. | ~1542 |
| task | In-memory task tree. | 455 |
| operation-journal (+`reaper.ts`, `gc.ts`) | Durable FSM operation records; reaper; GC. | ~1476 |
| activity-protocol | Sequence allocator for the activity feed. | 317 |
| incoming-transfer | Incoming detection (notes + public events), trust prompts, dust threshold, sync state. | ~3040 |
| contact | Address book + plaintext JSON import/export. | 435 |
| price | CoinGecko USD feed, sanity band, unlock-gated alarm. | 742 |
| config | Settings facade, backup-restore allowlist. | 156 |
| logger / log-viewer | RPC facades over `LoggerStore` (`apps/extension/src/wallet/logger/`). | 75 / 71 |
| composition-harness.ts | Test-only. | 13 |

## 2. Entrypoints
- Content script: `content-script/content.ts`.
- `chrome.runtime.onMessage` (SW): `attachContentListener` (`content-message-relay.ts`) → `buildContentTransport` (`background.ts:270-332`) — SOLE entry for dApp wire traffic.
- `chrome.runtime.onConnect`: every `Service<Methods>` (`packages/extension-messaging/src/background/service.ts:35`), gated `isTrustedInternalSender`.
- `chrome.alarms`: `PriceService` (`price/service.ts:24,257-259`, `nulo:price:refresh`, 3 min, unlocked + `showFiatValues`); journal reaper/GC.
- `chrome.windows.onRemoved`: `WindowManager` (`:119-133`).
- Windows: `discover`/`capabilities`/`execute` (`dapp-interaction/service.ts:374-380`); `verify` (direct `chrome.windows.create`, `session-established.ts:145-152`, bypasses `WindowManager`); `passkey` (`passkey/service.ts:119-120`); `json` (`popup/windows/execute/index.vue:493-495`, direct); `logger` (`popup/pages/settings/advanced/index.vue:45-50`, direct, Developer Mode).
- RPC surfaces: `DappInteractionService` (`service.ts:80-87`): `getInteractionPayload, approveInteraction, resolveInteraction, rejectInteraction, isInteractionCancelled, focusInteractionWindow`. `DappSessionService` (`:32-46`): `getDappSessions, getDappSession, addDappSession, updateDappSession, deleteDappSession, setVerificationHash, setTrustedVerification, setAccountAliases, setCapabilityGrants, getCapabilityGrants, setCapabilityRejections, getCapabilityRejections, applyCapabilityDecision`. `ExecutionService` (`:83-91`): `executeTransfer, executeOperations, getGasBalances, peekGasBalances, estimateTransferFee, estimateOperationFee, cancelJob, cancelEstimate`. `FpcService` (`:56`): `getFpcs, getFpc, addFpc, updateFpc, updateFpcAddress, deleteFpc`. `TokenService` (`:73-81`): `getTokens, getToken, addToken, updateToken, deleteToken, parseTokenInterface, previewTokenMetadata` (NOT `addTokenAuthorized`/`addSeededToken`, `:257,452`). `TokenBalanceService` (`:37`). `NetworkService` (`:170-187`): `getOrInitNetworks, getNetworks, getNetwork, addNetwork, renameNetwork, deleteNetwork, setActiveNetwork, getActiveNetwork, getPrimaryNetwork, setActiveForProfile, addEndpoint, updateEndpoint, deleteEndpoint, setPrimaryEndpoint, getNodeStatus, probeNodeStatus`. `OperationJournalService` (`:47-53`). `IncomingTransferService` (`:120-130`). `ContactService` (`:23-32`) incl. `exportContacts, importContacts`. `TransactionService` (`:59`). `NoteService` (`:52`). `PriceService` (`:67`; pinned not dApp-exposed). `ConfigService` (`:28`). `TaskService` (`:25`). `LoggerService` `log` (`:12`); `LogViewerService` `getLogs, clearLogs` (`:10`).
- `WalletSdkDispatcher` methods: `getChainInfo, getContractClassMetadata, getContractMetadata, getPrivateEvents, registerSender, getAddressBook, registerContract, simulateTx, executeUtility, profileTx, createAuthWit, sendTx, registerToken, isTokenRegistered, grantPublicAuthwit, requestCapabilities, getAccounts, getWalletFeatures, batch`.

## 3. Trust boundaries

### 3a. dApp RPC boundary
`content-script-validator.ts:97-114` (Zod); `:93-95` subframe (`background.ts:305-313`); `sender-auth.ts:17-23`; `dispatcher.ts:692` `assertKnownMethod`; `:576-618` `assertAuthRelevantArgShape`; `:1327-1370` capability fail-closed; `scope-enforcement.ts` (`dispatcher.ts:718-722`); `:1542-1569` account authorization; `dapp-interaction/service.ts:490-537` popup-side re-validation; `background.ts:769-776` sanitization; flood caps `background.ts:606-607,744-761`.

### 3b. Storage tamper boundary
`DappSession` rows MAC-protected (F-12): HMAC-SHA256 over canonicalized row, per-profile non-extractable `CryptoKey` from master (`dapp-session/integrity.ts:30-69`, `mac-storage.ts:23-56`); invalid MAC → drop + quarantine-delete (`mac-storage.ts:9-18`). Every `EntityStorage` read runs its Zod codec. Price cache re-validated at read (`price/service.ts:263-264`, `isValidQuote` `:282-297`).

### 3c. Fee / FPC — `@nulo/bridge-core` call sites
- `predictedWorstMinFees` + `MinFeeNode` from `@nulo/bridge-core/fee-juice`: `execution/fee/fee-strategy.ts:44` (used `finalizeGasLimits` `:282`), `fpc-strategy.ts:77` (`:165,239`), `operation-estimate-reuse.ts:30` (`:87`, `:170`), `transfer-estimate-reuse.ts:22` (`:123`, `:199`).
- `fpc/service.ts:35-42`: PrivateFPC canonical salt (`PRIVATE_FPC_PARAMS` `:44`) must equal bridge-core's `PRIVATE_FPC_SALT` — drift = unrecoverable fund loss; asserted only on the bridge-core side.
- **Fee caps**: `embedded-fpc-cap.ts:71-82` (`applyEmbeddedFpcGasCap`: dApp `fee.maxFeesPerGas` honored verbatim or `getCurrentMinFees()` with no padding, rationale `:1-65`); `fee-strategy.ts:205-235` (`admissionCap`/`assertCustomGasLimitsWithinCap`: custom gas over cap **throws**; auto-derived limits clamped `:315-339`); `:265-296` (`finalizeGasLimits`); `DEFAULT_FEE_MULTIPLIER = 2` unless `VITE_NULO_FEE_MULTIPLIER` (`:61-64`).

### 3d. Token registry (`registerToken`)
Address: `pxe.getContractInstance(AztecAddress.fromStringUnsafe(contract))` (`token/service.ts:608-611`); class id → artifact (`:622-625`); `ensureRegistered` (`:627`). Name/symbol/decimals from simulating the contract's own views (`fetchTokenMetadata` `:685-722`) — attacker-controlled (`:669-671`). Homoglyph: render-time only via `sanitizeWireString` (`capability-meta.ts:126-170` strips `\p{Cf}`, variation selectors, C0/C1; **no confusable detection / normalization**, `:157-161`). Dedup on `(profileId, chainId, contract)` (`:329-343`). Popup always for `registerToken` by `kind` match (`dapp-interaction/service.ts:600-608`).

### 3e. Network service
`DEFAULT_SEEDS` (`network/service.ts:99-126`) — Mainnet/Testnet dRPC URLs with embedded API key path segment (`https://lb.drpc.live/aztec-mainnet/Ak_eT5HA2...`); Local `http://localhost:8080` / `VITE_LOCAL_NETWORK_RPC_URL` (`:89`). User endpoints via `RpcUrlSchema` (`network/spec.ts:152-179`): `https:` any host, `http:` loopback only, userinfo rejected; enforced at 3 points (`spec.ts:146-150`; adapter `aztec-node-factory-adapter.ts:32-47`). Chain identity probed (`_probeChainIdentity` `:994-1006`) — composite `(l1ChainId ^ rollupVersion) >>> 0`, local carve-out hardcoded `0`. Seeded networks: `l1ChainId` validated against in-code constant on every read (`assertCanonicalStoredL1`/`SEED_L1_BY_KIND` `:346-355`). Custom: `resolveVerifiedL1ChainId` (`:372-388`) live probe at account creation only; `opts?.unattended` refuses (`:379`). `addEndpoint`/`updateEndpoint` require probed `chainId` AND exact `l1ChainId` match (`:560-572,607-618`). Restore: `validateRestoredNetwork` (`:1046-1059`, comment `:1041-1044`).

### 3f. PXE
Ext-side thin wrapper (`pxe/client.ts`, `shallow-port.ts`) around `PxeServiceClientBase`; engine in offscreen (`apps/extension/src/offscreen/index.ts`). Per-`(profileId, chainId)` encrypted SQLite-OPFS (`packages/aztec-runtime/src/pxe/opfs-store.ts:1-26`, `:4-10`); 32-byte per-profile ChaCha20 key via `derivePxeStoreKey` (`:12-13`); key provider registered at SW boot (`pxe/client.ts:18-28`), returns `undefined` when locked/deleted/tombstoned. Version mismatch refuses to open (`opfs-store.ts:16-20`). Outside migration framework.

### 3g. Logger / log-viewer
`console.*` hijacked in all contexts → `LoggerStore`. Redaction `apps/extension/src/wallet/logger/utils.ts:178-264` (`trim`): `REDACTED_KEYS` (`:82-115`), `SECRET_KEY_SUFFIX` (`/secretkey$/i`, `:125`), collapses `ContractArtifact`/`ContractInstance`/`Note` (`:221-239`)/`ActiveSession`/`Profile`; `URL_KEYS` → origin (`:132-141`); errors capped 200 chars, no stacks (`projectError` `:169-175`). Key-name based — pre-interpolated strings opaque (enforced by `apps/extension/src/utils/log-payload-ban.test.ts`). Persistence: `chrome.storage.session` only when Developer Mode (`store.ts:33,107-120,144-149`); 2s debounce, last 2000; ring 1000 (Info) / 10,000 (Debug) (`store.ts:28,167-169`). Export via `#/windows/logger`, CSV.

### 3h. Window-manager
Windows listed in §2. URL params: `requestId` (dapp windows/passkey/json), `sessionId`+`verificationHash`+`isReconnect` (verify — rendered straight from URL, B-06). `WindowManager.openAndAwait` (`:65-142`): `centerOn` (`:23-31`); race guards re-check `this.handles.get(handleId) !== handle` after every await (`:88-134`); `detach()`/`settle()`/`cancel()` (`:144-190`); `approveInteraction` detaches before async execution (`dapp-interaction/service.ts:177-181`).

## 4. Dependency graph
```
content-script/content.ts → (runtime.sendMessage) → wallet-sdk/content-message-relay.ts → wallet-sdk/background.ts
background.ts → dapp-interaction, dapp-session, execution, token, network, account (oos), profile (oos), operation-journal, @nulo/wallet-bridge
  events: profileService.onActiveProfileChanged → wireProfileSwitchTeardown, wireDiscoveryDrain; dappSessionService.onDappSessionDeleted → wireSessionTeardown
wallet-bridge/dispatcher.ts → services-contract (structural); constructed in background.ts:resolveSdkDeps
dapp-interaction/service.ts → dapp-session, execution, network, account, operation-journal, window-manager, materialize.ts
execution/service.ts → network, pxe/client, account, contact, profile, auth-registry, token, fpc, transaction, operation-journal, task, fee/*
fpc/service.ts → network, pxe/client, execution/contract-resolver
token/service.ts → network, account, pxe/shallow-port, task, operation-journal, execution/contract-resolver; emits onTokenAdded/onTokenDeleted → token-balance, incoming-transfer
token-balance → account, network, token, execution, pxe, transaction
incoming-transfer → network, account, token, transaction, operation-journal, note, config, token-balance, task, price, pxe
network → profile, pxe/client, @nulo/aztec-runtime/adapters; registerChainPurgeSubscriber → fpc, token, transaction
price → config, profile; external https://api.coingecko.com
contact → profile; transaction → account, network, profile, task; note → network, pxe; operation-journal → network, profile
activity-protocol/coordinator.ts → @nulo/wallet-core/activity; consumed by transaction, operation-journal, incoming-transfer
logger/log-viewer → apps/extension/src/wallet/logger/
window-manager → consumed by dapp-interaction, passkey
```

## 5. Frameworks / libs
WebCrypto HMAC-SHA256 (`dapp-session/integrity.ts`); `@aztec/*` 5.2.0 (+ `@aztec/viem@2.38.2`); `zod ^4.4.3` (row codecs, `validateParams` on every mutating `network/service.ts` method, content-script envelope); `@nulo/extension-messaging`; `@nulo/wallet-core` storage + locks; `@nulo/bridge-core` (`predictedWorstMinFees`, `MinFeeNode`); `@nulo/wallet-sdk-schema-patch/register` first import in `background.ts:28`. External: CoinGecko (`price/service.ts:31,323`; optional `x-cg-demo-api-key` from `VITE_COINGECKO_API_KEY` `:324-325`); Aztec RPC nodes.

## 6. Test surfaces
Well-covered: `execution/` (~90 files, half tests; composition + pxe-seam; fee structural parity), `wallet-sdk/` (every collaborator + 2 pins), `token-balance/` pins, `dapp-session/` composition + unit. Composition tests: dapp-interaction, dapp-session, execution, token. Thinner: `activity-protocol/` (lock-ordering invariant `coordinator.ts:14-17` unpinned), logger/log-viewer facades, `window-manager` (verify-window direct `chrome.windows.create` path untested), `pxe/` wrapper (`client.ts`/`shallow-port.ts` no dedicated test).

## 7. Generated / fixture
`token/functions/__snapshots__/*.snap` test-only; `composition-harness.ts` test-only; `@private-fpc-artifact` vendored, production-wired (`fpc/service.ts:27,30,44,114,217`); `token/functions/descriptors.ts` hand-written pin.

## 8. Security-relevant invariants (quoted)
- `execution-lane.ts:1-24`: "The mutex has NO timeout and NO force-release … silent overlap is worse — nullifier double-spends"; `JobCancelledSentinel` never crosses RPC; `cancelJob` transitions journal FIRST.
- `execution/README.md:35-37`: zero-slot transfer quirk.
- `dapp-session/service.ts:109` AUDIT A12: sessions per `(origin, chainId, profileId)`.
- `dispatcher.ts:1337-1350` F-006 fail-closed.
- wallet-bridge README: per-message scope; "A dApp never learns which accounts it lacks".
- `token/service.ts:669-671`: metadata attacker-controlled; UI MUST render address.
- `fpc/service.ts:35-42`: PrivateFPC salt drift = unrecoverable loss.
- `network/spec.ts:129-135` F-011.
- `opfs-store.ts:16-20`: refuse to open on stamp mismatch, never wipe.
- `price/service.ts:59-64`: not dApp-exposed; no fake $0.00.
- CLAUDE.md logging policy + `log-payload-ban.test.ts`.
- `capability-meta.ts:157-161`: no homoglyph/UTS39 normalization.
- ARCHITECTURE §8: session's chain is the dApp's, not the wallet's active network.
- ARCHITECTURE §12: private-cold-start fee path not yet wired.
