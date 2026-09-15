# Repo map: packages/wallet-bridge + packages/wallet-sdk-schema-patch

Read-only map — no vulnerability judgments.

## 1. Module inventory

### packages/wallet-bridge (~3938 non-test LOC across 24 src files)

| File | Purpose | LOC |
|---|---|---|
| `src/dispatcher.ts` | `WalletSdkDispatcher.dispatch()` is the single chokepoint every dApp RPC flows through — resolves the method descriptor, enforces capability + scope, routes to a popup-backed handler or builds an `Operation` for `ExecutionService`. Owns the accounts-widening capability-delta logic. | 1574 |
| `src/method-descriptors.ts` | `METHOD_REGISTRY`: per-method capability required, routing (`network-operation`/`account-operation`/`handler`), scope-checker ref, arg-shape guard, audit markers. Six legacy parallel tables derived from it. | 398 |
| `src/method-scope-checkers.ts` | Leaf: per-method scope-check bodies (contract/function pattern matching against granted `Scope`s). | 411 |
| `src/scope-enforcement.ts` | `enforceScope` / `enforceScopeWithSession` — per-message re-check entry points; owns the F-005 session-account-scope array validation. | 106 |
| `src/capability-map.ts` | `getRequiredCapability` / `isCapabilityExempt` facade. | 34 |
| `src/capabilities.ts` | `Capability` union (`accounts`/`contracts`/`contractClasses`/`simulation`/`transaction`/`data`), `Scope`/`ScopePattern`, `GrantedCapabilityRecord`/`RejectedCapabilityRecord`. | 69 |
| `src/services-contract.ts` | Structural consumer interfaces (`INetworkReader`, `IAccountReader`, `IAccountProvisioner`, `IExecutionRunner`, `IDappInteractionRunner`, `IDappSessionWriter`, `ITokenRegistryReader`). | 147 |
| `src/session-types.ts` | `IDappSessionRef`, `INetworkRef`, `IAccountRef`, `DappPermissions`, `AccessLevel`. | 66 |
| `src/dapp-interaction-protocol.ts` | Wire-shape request/result types for popup-driven interactions (`ExecutionParams`/`ExecutionResult`, `CapabilityParams`/`CapabilityResult`, per-op `*Request`). | 162 |
| `src/action.ts` | `Action` union (`call`, `encoded_call`, `add_capsule`, `add_extra_args`, `add_private_authwit`, `add_public_authwit`). | 40 |
| `src/operation.ts` | `Operation` union — the network/account-resolved shape handed to `ExecutionService`; `DraftOperation`. | 222 |
| `src/operation-result.ts` | `OperationResult` union. | 37 |
| `src/operation-validation.ts` | `requiresFeeSelection` / `isEmbeddedFeePayment` / `assertExecutableOperation`. | 69 |
| `src/transaction-origin.ts` | `OriginType` enum (`UI`/`DAPP`) + `TxOrigin`. | 21 |
| `src/caip.ts` | CAIP-2/10 format/parse (`formatCaipChain`, `formatCaipAccount`, `parseCaipAccount`). | 70 |
| `src/authwit-content.ts` | `AuthwitContent` union (`call`/`encoded_call`/`intent`/`message_hash`). | 26 |
| `src/call-shapes.ts` | `CallPayload` / `EncodedCallPayload`. | 26 |
| `src/discovery-queue.ts` | `DiscoveryQueue` — bounds + coalesces dApp discovery while locked (global/per-origin caps, staleness, badge). | 141 |
| `src/external-id.ts` | `describeExternalId` / `describeWireMethod` — maps attacker-controlled ids/method names to safe log tokens. | 64 |
| `src/wallet-features.ts` | `WALLET_FEATURES` (`dapp-self-pay`). | 12 |
| `src/account-resolution.ts` | `resolveAuthorizedSessionAccount` — "which account does this request act as", shared by dispatcher and journal. | 60 |
| `src/fee.ts` | `FeePaymentMethod`, `FeeSettings`, `GasBalances`, `TransferFeeEstimate`. | 68 |
| `src/fee-payer.ts` | `classifyFeePayer` / `isSelfPay` / `isClaimAndEndSetup` — from parsed payload fields, never a dApp flag. | 70 |
| `src/types.ts` | `SessionContext` (chainId/profileId/origin/sessionId). | 14 |
| `src/index.ts` | Barrel — does NOT export `./method-descriptors` or `./method-scope-checkers` (internal). | 31 |

Tests: `dispatcher.test.ts` (2553), `scope-enforcement.test.ts` (633), `method-descriptors.test.ts` (429, "frozen authz oracle"), `discovery-queue.test.ts` (192), `account-order.characterization.test.ts` (134), `fee-payer.test.ts` (101), `external-id.test.ts` (97), `dispatcher.route.pins.test.ts` (59), `operation-validation.parity.test.ts` (34), `method-name.test.ts` (39).

### packages/wallet-sdk-schema-patch (~132 LOC)

| File | Purpose | LOC |
|---|---|---|
| `src/apply.ts` | `applyNuloSchemaPatch(schema)` — mutates a `WalletSchema`-shaped object in place, adding 4 zod entries: `registerToken`, `isTokenRegistered`, `grantPublicAuthwit`, `getWalletFeatures`. Signature-drift guard (`patchOrVerifyEntry`) throws on incompatible same-name upstream entry. | 118 |
| `src/register.ts` | Side-effect entry: runs `applyNuloSchemaPatch(WalletSchema)` against the `@aztec/aztec.js/wallet` singleton at module-eval. Must be the first import. | 14 |

Tests: `apply.test.ts`, `apply.pins.test.ts`.

## 2. Entrypoints

- **`WalletSdkDispatcher.dispatch(methodName, args, ctx, hooks?)`** (`dispatcher.ts:641`) — called per decrypted `WalletMessage` from `onWalletMessage` in `apps/extension/src/wallet/services/wallet-sdk/background.ts:920`.
- **`unwrapOperationResult(result)`** (`dispatcher.ts:155`).
- **`DiscoveryQueue`** (`discovery-queue.ts:42`) — constructed once per SW lifetime in `background.ts:115`; `enqueue`/`drain` from `background.ts:636`, `background.ts:558`.
- **`isDiscoveryExpired` / `DISCOVERY_STALE_MS`** (`discovery-queue.ts:16,24`) — re-checked before every discovery approval (`rejectIfExpired`, `background.ts:687-698`).
- **`describeExternalId` / `describeWireMethod`** (`external-id.ts:29,61`).
- **`resolveAuthorizedSessionAccount`** (`account-resolution.ts:48`) — `dispatcher.ts:1557` and `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:29`.
- **`ungrantedAccounts`** (`dispatcher.ts:327`) — used by `applyAccountsWidening` (`dispatcher.ts:1209`).
- Schema-patch: `import "@nulo/wallet-sdk-schema-patch/register"` first import in `apps/extension/src/wallet/services/wallet-sdk/background.ts:28` (+ tools, playground). `applyNuloSchemaPatch(schema)` at `apply.ts:53`.

## 3. Trust boundaries

### Where dApp-controlled input enters
- Every argument to `dispatch()` — `methodName: string`, `args: unknown[]` (`dispatcher.ts:641`) — arrives via upstream `BackgroundConnectionHandler`'s decrypted `WalletMessage`, passed unmodified from `background.ts:920`.
- `ctx.origin` (`types.ts:11`) — established by upstream from `sender.tab?.url` (top-frame URL); defended by `apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:93` (`isSubframeSender`) + `background.ts:305` (subframe rejection). Feature-flag override `VITE_NULO_ALLOW_IFRAME_DAPPS` at `background.ts:89`.
- `requestCapabilities` manifest (`dispatcher.ts:1128`, `manifest?.capabilities ?? []`) — validated only by `argsRequestCapabilities` (`method-descriptors.ts:130`), then `computeCapabilityDelta` (`dispatcher.ts:354`). Unknown capability `type` strings flow to the popup, render default-off/high-risk (`dispatcher.ts:273-284`, `apps/extension/.../capability-meta.ts:194-215` `getSafeDisplay`).
- `exec.calls[].to` / `.name`, `opts.scopes` / `.additionalScopes`, createAuthWit's `messageHashOrIntent` — checked in `method-scope-checkers.ts` and F-005 `scope-enforcement.ts:37` (`validateAccountScopes`).
- `registerToken` token address (`args[1]`), `grantPublicAuthwit` `content.{caller,contract,method,args}` — flow into a popup display and then into a built transaction.
- Discovery `requestId`, `discovery.appName`/`appId` — sanitized at persistence via `sanitizeWireString` (`capability-meta.ts:176`, called `background.ts:773`) before writing `DappSession.dappMetadata`.
- Discovery volume — `DiscoveryQueue.enqueue` (`discovery-queue.ts:68`) `GLOBAL_CAP=32` / `PER_ORIGIN_CAP=4` (`:33-34`); unlocked analog `DISCOVERY_PENDING_GLOBAL_CAP`/`PER_ORIGIN_CAP` in `background.ts:606-607`.

### Where the dApp origin is established and flows to authorization
1. Upstream attributes `origin` from the content-script sender's top-frame tab URL.
2. `content-script-validator.ts:93` + `background.ts:305` reject `sender.frameId !== 0`.
3. Discovery: `background.ts:625` (`handleDiscovery`) computes `chainId = String(chainInfoToChainId(discovery))`, looks up `DappSession` by `(origin, chainId)` (`background.ts:647` → `DappSessionService.tryGetDappSessionByOriginAndChain`, `dapp-session/service.ts:116`) — auto-approve on hit, popup on miss.
4. On approval `background.ts:802` creates a `DappSession` scoped `(origin, chainId, profileId)` with empty accounts + empty grants (`background.ts:812`).
5. Session established: `session-established.ts:61` re-validates — lookup by `(origin, chainId)` (line 94), profile check (105), `stampSessionProfile` (141). Fail-closed terminate at 90, 98, 106, 156-165.
6. `dispatch()` re-derives `SessionContext.origin` = `session.origin`, looks the `DappSession` up ONCE at entry (`dispatcher.ts:650`, "F-006 / audit cross-cutting #1"), anchored to `ctx.profileId`.
7. `enforceSessionProfileBinding` (`profile-switch-teardown.ts`, invoked `background.ts:887`) — mismatch → `SESSION_INVALID_ERROR` (`background.ts:893`, code 4900).
8. `enforceCapability` (`dispatcher.ts:1327`) then `enforceScope`/`enforceScopeWithSession` (`scope-enforcement.ts:59,82`).

### Secrets
wallet-bridge handles no cryptographic secret material. Encrypted channel (AES-256-GCM / ECDH P-256) is upstream `@aztec/wallet-sdk`. `DappSession.mac` (`dapp-session/spec.ts:63`) HMAC-SHA256 via `dapp-session/mac-storage.ts:33` (`signDappSession`) with `ProfileService.deriveDappSessionMacKey` (extension-side). `sessionId` / `requestId` are attacker-influenced; passed through `describeExternalId` (`external-id.ts:6-16` — upstream reuses dApp `requestId` verbatim as `sessionId`).

### External calls / storage
None from wallet-bridge (only `chrome.action.setBadgeText` in `discovery-queue.ts:136`). `DiscoveryQueue` in-memory only (`discovery-queue.ts:49-56` reconciles badge on boot). Persistence via `IDappSessionWriter` → `dapp-session/service.ts` (`EntityStorage("nulo:core:dappSessions")` wrapped by `mac-storage.ts`).

### Sender/origin/permission checks — index

| Check | File:line |
|---|---|
| Subframe sender rejection | `content-script-validator.ts:93`, enforced `background.ts:305` |
| Content-script envelope validation | `content-script-validator.ts:97` (`validateContentScriptMessage`), called `background.ts:322` |
| Session-established origin/profile re-validation | `session-established.ts:94,105` |
| Session→profile binding at dispatch | `background.ts:887` (`enforceSessionProfileBinding`) |
| dApp session single-capture at dispatch entry | `dispatcher.ts:650` |
| Known-method guard | `method-descriptors.ts:386` (`assertKnownMethod`), called `dispatcher.ts:692` |
| Arg-shape guard | `dispatcher.ts:700-703`, bodies `method-descriptors.ts:130-164` |
| Auth-relevant arg-shape guard | `dispatcher.ts:576` (`assertAuthRelevantArgShape`), called `dispatcher.ts:707` |
| Capability gate (fail-closed on missing session) | `dispatcher.ts:1327` (`enforceCapability`), F-006 branch `dispatcher.ts:1337-1352` |
| Per-call scope gate | `scope-enforcement.ts:59` / `:82`, called `dispatcher.ts:718-722` |
| Session-authorized account resolution | `account-resolution.ts:48`, called `dispatcher.ts:933,987,1041,1077,1397,1557` |
| createAuthWit silent-vs-popup routing | `method-scope-checkers.ts:270` (`isCreateAuthWitCoveredByTxOrSimulationScope`) |
| `registerContractClass` deny | `method-scope-checkers.ts:407` |
| Capability-decision atomicity + revoked-grant refusal | `dapp-session/service.ts:301-341` (`applyCapabilityDecision`), `requiresGrant` at 309-311 |
| DappSession MAC verify-or-drop | `dapp-session/mac-storage.ts:85` (`verifyOrDrop`) |
| Session teardown on dApp-session deletion | `background.ts:523` (`wireSessionTeardown`) |

## 4. Dependency graph

- wallet-bridge → `@aztec/aztec.js/*`, `@aztec/foundation/*`, `@aztec/stdlib/*`, `@aztec/wallet-sdk/*` (types); `dispatcher.ts` → `@nulo/extension-messaging/errors`, `@nulo/wallet-core/logger`; `discovery-queue.ts` → `@aztec/wallet-sdk/extension/handlers`; `method-descriptors.ts` → `./method-scope-checkers` (leaf). No `@nulo/aztec-runtime` / `@nulo/extension` (biome `biome.json:320-333`).
- schema-patch: `apply.ts` → `@aztec/stdlib/schemas`, `zod`; `register.ts` → `@aztec/aztec.js/wallet`.

Handoff edges:

| Producer | Edge | Consumer |
|---|---|---|
| dApp page (`@aztec/wallet-sdk`) | `postMessage` → content script → `chrome.runtime` | `background.ts:270-330` content listener |
| `BackgroundConnectionHandler.onPendingDiscovery` | callback | `background.ts:336` (`handleDiscovery`) → `DiscoveryQueue` |
| `.onSessionEstablished` | callback | `background.ts:340` → `session-established.ts:61` |
| `.onWalletMessage` | callback | `background.ts:367` → `onWalletMessage` → `dispatcher.ts:641` |
| dispatcher (network/account ops) | call | `IExecutionRunner.executeOperations` → `ExecutionService` |
| dispatcher (handler-routed: sendTx/registerToken/grantPublicAuthwit/requestCapabilities/discover) | call | `IDappInteractionRunner` → `DappInteractionService` → popup window |
| dispatcher | call | `IDappSessionWriter` → `DappSessionService` |
| `DappSessionService.onDappSessionDeleted` | emit | `background.ts:524` → `handler.terminateSession` |
| `ProfileService.onActiveProfileChanged` | emit | `background.ts:554` → `DiscoveryQueue.drain` |

## 5. Frameworks / libs
- No crypto in either package. **zod only in schema-patch** (`apply.ts:34-46`). **wallet-bridge has no zod dependency** — arg validation is hand-written `ArgGuard` predicates (`method-descriptors.ts:92-164`) + `assertAuthRelevantArgShape` (`dispatcher.ts:576`). `ARCHITECTURE.md:162` says "narrows protocol shapes via Zod" — stale; zod exists at `content-script-validator.ts` (envelope) and execution-layer (`dispatcher.ts:599-601` comment).
- `@aztec/*` 5.2.0.

## 6. Test surfaces
Heavily covered: dispatcher (2553 test LOC), scope-enforcement, method-descriptors (exhaustiveness pin). Thin: `caip.ts` (parity pinned from `apps/extension/src/wallet/utils/caip.test.ts:112`). Schema-patch reachability pinned in `dispatcher.test.ts:1089,1518`.

## 7. Generated / vendored
None.

## 8. Security-relevant invariants (quoted)
- README: "No `aztec-runtime` imports." (biome `biome.json:320-333`).
- README: "One CAIP source of truth." (`caip.ts:24-51`; `dispatcher.ts:55`).
- README: "Scope enforcement is per-message." (`dispatcher.ts:711-723`, `enforceMethodAndScope` from `dispatch()` `:651`).
- README: "An accounts grant is widened, never re-granted … a decline keeps the grant … `requiresGrant: ["accounts"]` enforced inside `applyCapabilityDecision`'s lock … A dApp never learns which accounts it lacks." — `planAccountsWidening` (`dispatcher.ts:336-352`), `applyAccountsWidening` (`:1209-1227`), `accountsAdditions` (`:438-463`), `dapp-session/service.ts:309-311`. PR #582 (860deda1).
- README: "Capabilities encode UX, not authority."
- README: "The dispatcher is the single chokepoint … a method with no registry row is rejected." (`method-descriptors.ts:386-390`, `dispatcher.ts:692`).
- `method-descriptors.ts:290-292`: "F1: WITHOUT the transaction capability, enforceCapability returns [] and the scope-enforcement block is skipped — the gate becomes dead code."
- `dispatcher.ts:1338-1352`: "F-006: fail-closed when the stored DappSession is missing."
- `method-descriptors.ts:220`: "F-003: now requires accounts.canGet=true" (`method-scope-checkers.ts:346-352`).
- `method-descriptors.ts:306,313`: "F-004: requires data.addressBook=true" (`method-scope-checkers.ts:355-380`).
- `method-scope-checkers.ts:399-411`: `registerContractClass` deny.
- `scope-enforcement.ts:23-27`: "F-005: validate dApp-supplied account-scope arrays against the session's approved account list."
- `method-scope-checkers.ts:155-159`: "F-08: never dereference a raw-unknown call element."
- `method-scope-checkers.ts:43-49`: "An EMPTY function name is never a legitimate call target."
- README (registerToken): popup pre-fetches `name`/`symbol`/`decimals` via `parseTokenInterface`, address always shown, strings attacker-controllable. Every-call popup at `dapp-interaction/service.ts:606-608`.
- README: "Not in `batch`." Server-side `dispatcher.ts:898-902` (`handleBatch` throws for `sendTx`/`registerToken`).
- README + schema-patch README pin `5.0.0-rc.2` — stale; actual `5.2.0` (`apply.ts:28`).
- `apply.ts:23-28`: drift guard throws rather than no-op; `patchOrVerifyEntry` (`apply.ts:66-86`).

## Callers in `apps/extension/src`
- Popup: `popup/windows/execute/{index.vue:19,OperationCard.vue:19,OperationActionRow.vue:2,operation-validation.ts:9,types.ts:30}`, `popup/windows/capabilities/{CapabilityCard.vue:23,build-items.ts:11,index.vue:25}`, `components/composite/capabilities/{ScopePatternList.vue:2,CapabilityDetailPanel.vue:10}`.
- wallet-sdk wiring: `wallet/services/wallet-sdk/{background.ts:65,discovery-approval.ts:3,tab-lifecycle.ts:3,queued-journal.ts:29,profile-switch-teardown.ts:27,session-established.ts:11}`.
- dapp-session / dapp-interaction: `dapp-session/spec.ts:8,18,19,33`, `dapp-interaction/{spec.ts:4,37,service.ts:20,materialize.ts:32,33}`.
- execution: `execution/{operation-planner.ts:61,operation-fingerprint.ts:22,operation-estimate-reuse.ts:31,transfer-estimate-reuse.ts:23,utils/fee-detection.ts:1,models/index.ts,helpers/batched-view-simulation.ts:137}`.
- `transaction/spec.ts:8,9`; `wallet/utils/caip.ts:22`.
- schema-patch: `wallet/services/wallet-sdk/background.ts:28`.
