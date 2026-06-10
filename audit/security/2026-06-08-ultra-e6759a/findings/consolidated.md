# Consolidated Findings — security audit

**Phase 3 coordinator**: Codex xhigh
**Inputs**: 8 clusters × (Claude Opus + Codex xhigh) raw passes = 16 files
**Methodology**: cross-model dedupe by root cause + sink + boundary; CVSS v4.0 bands assigned at this stage; cross-cutting observations annexed.

## Statistics
- Total raw findings (pre-dedupe): 121
- Consolidated findings: 12
- Cross-model agreement: 7 (claude+codex both flagged)
- Cross-model unique: Claude 1, Codex 4
- Distribution: Critical 0, High 8, Medium 4, Low 0
- Findings density: 12/8 = 1.50 per cluster (target ~1.2)

## Critical findings
None.

## High findings

### [HIGH] F-001: Third-party iframes are credited as the top-frame origin during wallet discovery
**CVSS v4.0 band**: High (estimated 8.4-8.8)
**Cluster**: C2
**Found by**: claude+codex
**Confidence**: high
**CWE**: CWE-346 (Origin Validation Error), CWE-441 (Unintended Proxy / Confused Deputy)
**Trace**: `manifest.config.ts:31-37` injects the content script into all frames → iframe-local discovery is relayed by `content_script_connection_handler.js:60-86` → upstream background attribution uses `sender.tab.url` instead of the frame URL at `background_connection_handler.ts:187-188` → Nulo stores/looks up the session by `origin + chainId` at `background.ts:351-458` and `dapp-session/service.ts:73-99` → later wallet RPCs run under `ctx.origin = session.origin` at `background.ts:516-520`.
**Instances**: `packages/extension/manifest/manifest.config.ts:31-37`; `packages/extension/src/content-script/content.ts:11-22`; `packages/extension/src/wallet/services/wallet-sdk/background.ts:119-151,351-458,516-520`; `packages/extension/src/wallet/services/dapp-session/service.ts:73-99`; `node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js:60-86`; `node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:187-188`.
**Description**: A malicious iframe can initiate discovery from its own frame, but the service worker records the top-frame origin as the trusted dApp identity. That lets the iframe establish or silently reclaim the top-level site’s session and inherit any stored grants for that origin. The user sees the top-frame hostname in the popup, so the trust anchor itself is confused.
**Recommended fix**: Bind discovery to `sender.url` and `sender.frameId`, key sessions by frame as well as origin, and reject subframe discovery locally unless subframe support is explicitly required.
**Effort estimate**: days

### [HIGH] F-002: Tab-wide discovery replies let sibling frames hijack or tear down a victim session
**CVSS v4.0 band**: High (estimated 8.0-8.4)
**Cluster**: C2
**Found by**: codex (Claude didn't notice)
**Confidence**: moderate
**CWE**: CWE-668 (Exposure of Resource to Wrong Sphere)
**Trace**: Nulo sends discovery replies to the whole tab via `background.ts:118-135` → Chrome delivers those replies to every frame when no `frameId` is specified → every injected content script accepts `DISCOVERY_APPROVED` and creates a `MessagePort` in `content_script_connection_handler.js:88-156` → the first sibling frame to send `KEY_EXCHANGE_REQUEST` wins at `background_connection_handler.js:133-166`, and any sibling frame can later send `DISCONNECT` by session id at `background_connection_handler.js:68-71,200-221`.
**Instances**: `packages/extension/src/wallet/services/wallet-sdk/background.ts:118-135`; `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:106-121,133-166,183-221`; `node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js:34-52,88-156`; `node_modules/@types/webextension-polyfill/namespaces/tabs.d.ts:520-526`.
**Description**: Even if origin attribution is fixed, discovery approval is still tab-scoped rather than frame-scoped. Any sibling frame in the tab can receive the approval, mint its own port, race the legitimate frame’s key exchange, and later disconnect the victim session. This breaks the intended frame boundary and compounds F-001.
**Recommended fix**: Target discovery/session messages to the original `frameId`, reject unsolicited approvals in the content script unless a matching local request is pending, and bind later traffic/disconnect to the frame that completed key exchange.
**Effort estimate**: days

### [HIGH] F-003: `accounts.canGet:false` is not enforced on account disclosure
**CVSS v4.0 band**: High (estimated 7.4-7.8)
**Cluster**: C1
**Found by**: claude+codex
**Confidence**: high
**CWE**: CWE-862 (Missing Authorization)
**Trace**: the dApp requests an `accounts` capability with `canGet:false` via `dispatcher.ts:235-236,504-510` → selected accounts are persisted into `session.accounts` at `dispatcher.ts:614-631` → the grant response still includes those accounts at `dispatcher.ts:658-669,689-713` → later `getAccounts()` returns `session.accounts` from `dispatcher.ts:288-317,325-337` because `capability-map.ts:14` exempts the method from capability enforcement.
**Instances**: `packages/wallet-bridge/src/capability-map.ts:14`; `packages/wallet-bridge/src/dispatcher.ts:288-317,325-337,504-510,614-631,658-669,689-713`; `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:47-50`; `packages/extension/src/popup/windows/capabilities/index.vue:294-309`.
**Description**: The UI and capability model expose `canGet` as the sub-grant that should prevent a dApp from reading addresses, but the dispatcher treats it as metadata only. A dApp that was approved for authwit- or selection-related account access can still receive the full account list immediately and later re-read it silently.
**Recommended fix**: Remove `getAccounts` from the exemption set and enforce `AccountsCapability.canGet` on both the `requestCapabilities()` response path and the later `getAccounts()` handler.
**Effort estimate**: hours

### [HIGH] F-005: Attacker-chosen account scope lists are forwarded to PXE without session allow-list validation
**CVSS v4.0 band**: High (estimated 8.0-8.5)
**Cluster**: C1
**Found by**: claude+codex
**Confidence**: high
**CWE**: CWE-862 (Missing Authorization)
**Trace**: the bridge checks only contract/function scope at `scope-enforcement.ts:90-167` after `dispatcher.ts:227-232` → attacker-controlled `eventFilter.scopes`, `opts.scopes`, and `opts.additionalScopes` are forwarded unchanged by `dispatcher.ts:382-432,788-793,829-857` → execution sinks feed those addresses directly into PXE at `execution/service.ts:1638-1640,1803-1851,1966-1967,2098-2153`; Claude also showed the empty-`calls` fast path at `scope-enforcement.ts:96-97,115-116`, which makes the same bypass easier.
**Instances**: `packages/wallet-bridge/src/scope-enforcement.ts:90-167`; `packages/wallet-bridge/src/dispatcher.ts:227-232,382-432,788-793,829-857`; `packages/extension/src/wallet/services/dapp-interaction/service.ts:340-385,423-426`; `packages/extension/src/wallet/services/execution/service.ts:1638-1640,1803-1851,1966-1967,2098-2153`; `packages/wallet-bridge/src/scope-enforcement.test.ts:140-143`.
**Description**: Once a dApp has a legitimate simulation, utility, transaction, or private-events grant, it can append other wallet-owned account addresses in the scope lists that PXE uses to expose private state during execution. Those extra addresses are never checked against the session’s approved accounts, so one granted account can be widened into cross-account private-state access.
**Recommended fix**: Reject any `eventFilter.scopes`, `opts.scopes`, or `opts.additionalScopes` entry not present in the session’s approved account set, including the `calls.length === 0` fast path.
**Effort estimate**: days

### [HIGH] F-006: Deleting or expiring the stored dApp session does not revoke live network-only wallet-sdk access
**CVSS v4.0 band**: High (estimated 7.8-8.3)
**Cluster**: C1
**Found by**: codex (Claude didn't notice)
**Confidence**: high
**CWE**: CWE-613 (Insufficient Session Expiration)
**Trace**: settings-driven disconnect deletes only the stored `DappSession` at `connected-apps/[id].vue:120-126` and `dapp-session/service.ts:274-283` → the active encrypted wallet-sdk transport stays alive because only `onSessionTerminated` tears it down in `wallet-sdk/background.ts:184-245` → when `tryGetDappSessionByOriginAndChain()` misses, `enforceCapability()` returns an empty grant set at `dispatcher.ts:735-736` → `dispatch()` still builds network-only operations at `dispatcher.ts:755-814` → sinks such as `aztec_getPrivateEvents`, `aztec_getAddressBook`, `aztec_registerSender`, and `aztec_registerContract` still execute at `execution/service.ts:1578-1705`.
**Instances**: `packages/extension/src/popup/pages/settings/connected-apps/[id].vue:120-126`; `packages/extension/src/wallet/services/dapp-session/service.ts:274-306`; `packages/extension/src/wallet/services/wallet-sdk/background.ts:184-245,495-528`; `packages/wallet-bridge/src/dispatcher.ts:729-814`; `packages/extension/src/wallet/services/execution/service.ts:1578-1705`.
**Description**: Revocation deletes the durable session record but does not fail closed for an already-established transport session. A dApp that keeps its tab open can continue calling network-only methods after the user disconnects it or after the stored session expires.
**Recommended fix**: Tear down live wallet-sdk `ActiveSession`s whenever the backing `DappSession` is deleted or expires, and make network-only capability enforcement fail closed when the stored session is missing.
**Effort estimate**: days

### [HIGH] F-007: PATH-A passkey unlock does not bind supplied credential data to the target profile
**CVSS v4.0 band**: High (estimated 7.3-7.8)
**Cluster**: C4+C5
**Found by**: claude+codex
**Confidence**: high
**CWE**: CWE-345 (Insufficient Verification of Data Authenticity)
**Trace**: popup auth forwards `credentialData` into `unlockPasskeyProfile(...)` at `auth.vue:68-74` → `unlockPasskeyProfile` snapshots the stored credential id at `profile/service.ts:281-311` → PATH-A recovery ignores that id and trusts caller-supplied credential data through `acquireRecovery(...)` and `passkey-recovery-coordinator.ts:102-109` → `PasskeyCredential.create` derives a master secret from the supplied `id`/`prf` at `wallet-crypto/passkey-credential.ts:36-63` → phase 3 only checks that the profile row itself did not rotate at `profile/service.ts:313-327` and opens the session with the unbound secret at `profile/service.ts:328-329`.
**Instances**: `packages/extension/src/popup/pages/auth.vue:68-74`; `packages/extension/src/wallet/services/profile/service.ts:281-329,356-370,641-677,910-919`; `packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:102-109`; `packages/wallet-crypto/src/passkey-credential.ts:36-63`.
**Description**: The service trusts popup-supplied `PasskeyCredentialData` strongly enough to open a session, but it never verifies that the recovered credential id matches the profile’s stored `credentialId`. A wrong or forged passkey payload can therefore unlock profile A with a master secret derived from credential B.
**Recommended fix**: Mirror the existing `exportPlain` / passkey-restore binding checks and reject unless `recovery.credentialId === snapshot.credentialId` before `sessionManager.open(...)`.
**Effort estimate**: hours

### [HIGH] F-008: Primary execute approvals are blind to calldata and argument values
**CVSS v4.0 band**: High (estimated 7.2-7.8)
**Cluster**: C6
**Found by**: codex (Claude didn't notice)
**Confidence**: high
**CWE**: CWE-451 (User Interface Misrepresentation of Critical Information)
**Trace**: operation models already carry argument arrays and full execution payloads in `wallet-bridge/action.ts:37-54` and `wallet-bridge/operation.ts:97-183` → the popup loads those operations at `execute/index.vue:260-266` → the main review cards in `OperationCard.vue:104-138,253-361,374-399` show only function labels and contract addresses → the real payload is only visible in the secondary JSON viewer opened from `execute/index.vue:391-396,456-463` and rendered at `popup/windows/json/index.vue:46-57`.
**Instances**: `packages/wallet-bridge/src/action.ts:37-54`; `packages/wallet-bridge/src/operation.ts:97-183`; `packages/extension/src/popup/windows/execute/index.vue:260-266,391-396,456-463`; `packages/extension/src/popup/windows/json/index.vue:46-57`; `packages/extension/src/popup/windows/execute/OperationCard.vue:104-138,253-361,374-399`.
**Description**: The wallet asks users to approve calls without showing the values that actually determine the transfer or utility effect: recipients, amounts, selectors, calldata, and similar argument-level semantics. A malicious dApp can keep the contract/function labels looking routine while hiding the dangerous effect in the unseen arguments.
**Recommended fix**: Make structured argument/effect summaries part of the primary approval surface for every popup-gated operation type, keeping the raw JSON viewer as a fallback rather than the only detailed view.
**Effort estimate**: days

### [HIGH] F-011: Custom RPC endpoints are accepted with no transport policy, and restore bypasses endpoint re-probing
**CVSS v4.0 band**: High (estimated 7.5-8.1)
**Cluster**: C8
**Found by**: claude+codex
**Confidence**: high
**CWE**: CWE-20 (Improper Input Validation), CWE-184 (Incomplete List of Disallowed Inputs)
**Trace**: endpoint validation is only `z.string().url()` at `network/spec.ts:120-145`, while persisted `NetworkInfo.rpcUrl` is plain `z.string()` at `network/spec.ts:97-100` → `addNetwork`, `addEndpoint`, and `updateEndpoint` persist user-supplied URLs via `network/service.ts:235-252,328-348` → `restore()` writes imported endpoints without re-probing at `network/service.ts:613-633,757-768` → later runtime use-sites call `createAztecNodeClient(rpcUrl, ...)` at `aztec-node-factory-adapter.ts:15-17` and ultimately `fetch(host, ...)` at `aztec-runtime/utils/fetch.ts:42-47`.
**Instances**: `packages/extension/src/wallet/services/network/spec.ts:97-100,120-145`; `packages/extension/src/wallet/services/network/service.ts:235-252,305-318,328-348,488-547,613-633,726-733,757-768`; `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:15-17`; `packages/aztec-runtime/src/utils/fetch.ts:42-47`.
**Description**: Once a user adds or restores a custom endpoint, that endpoint becomes the wallet’s node authority with no scheme/host policy beyond generic URL syntax, and restore skips even the one-time enrollment probe. In practice this lets a phishing-supplied or imported endpoint control the wallet’s view of chain state, fees, notes, and signing inputs.
**Recommended fix**: Enforce a central allowlist at the node-factory boundary: allow `https:` generally, allow `http:` only for loopback/dev hosts, reject other schemes outright, and re-validate restored endpoints before persisting them.
**Effort estimate**: days

## Medium findings

### [MEDIUM] F-004: `data.addressBook` is decorative; `getAddressBook` and `registerSender` ignore the sub-grant
**CVSS v4.0 band**: Medium (estimated 6.0-6.6)
**Cluster**: C1
**Found by**: claude (Codex didn't notice)
**Confidence**: high
**CWE**: CWE-863 (Incorrect Authorization)
**Trace**: `capability-map.ts:38-40` maps both methods to the `data` capability → `scope-enforcement.ts:269-279` defines no checker for either method → the dispatcher builds `aztec_getAddressBook` / `aztec_registerSender` operations anyway at `dispatcher.ts:802-803` and related paths → the `DataCapability.addressBook?: boolean` field at `capabilities.ts:47-51` is never consulted.
**Instances**: `packages/wallet-bridge/src/capability-map.ts:38-40`; `packages/wallet-bridge/src/scope-enforcement.ts:269-279`; `packages/wallet-bridge/src/capabilities.ts:47-51`; `packages/wallet-bridge/src/dispatcher.ts:802-803`.
**Description**: A dApp granted any `data` capability, even one meant only for private events, can still read the user’s address book and register arbitrary sender aliases because the only enforced decision is “has some `data` grant,” not “has the address-book sub-grant.” Codex did not notice this variant.
**Recommended fix**: Add explicit scope checkers for `getAddressBook` and `registerSender` that require `addressBook: true` (or split these methods into their own capability type).
**Effort estimate**: hours

### [MEDIUM] F-009: Approval popups treat attacker-controlled display metadata as trustworthy
**CVSS v4.0 band**: Medium (estimated 6.2-6.8)
**Cluster**: C1+C2+C6
**Found by**: claude+codex
**Confidence**: high
**CWE**: CWE-451 (User Interface Misrepresentation of Critical Information), CWE-1007 (Insufficient Visual Distinction of Homoglyphs Presented to User)
**Trace**: dApp metadata is persisted as `name: discovery.appName ?? discovery.appId, url: discovery.origin` at `wallet-sdk/background.ts:423-427` → popup identity rendering reduces the authority to `new URL(url).hostname` in `useDappHostname.ts:9-25` and separately renders the raw name in `DappIdentityBlock.vue:37-47` and `verify/index.vue:200-210` → execute cards render raw method/artifact labels through `humanizeMethodName` and interpolation at `OperationCard.vue:114,134,222-231,266,285,325,340,357,369-371,394-398`, while on-chain token symbols/names also feed `IncomingTrustPopup.vue:49,90,102,135-137` → the existing sanitizer `capability-meta.ts:104-166` is used in the capability UI but not on these approval surfaces.
**Instances**: `packages/extension/src/wallet/services/wallet-sdk/background.ts:423-427`; `packages/extension/src/composables/useDappHostname.ts:9-25`; `packages/extension/src/components/composite/DappIdentityBlock.vue:37-47`; `packages/extension/src/popup/windows/verify/index.vue:200-210`; `packages/extension/src/popup/windows/execute/OperationCard.vue:114,134,156,214-231,266,285,325,340,357,369-371,394-398`; `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:49,90,102,135-137`; `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:104-166`; `packages/extension/src/wallet/services/token/service.ts:460-507`; `packages/wallet-bridge/src/action.ts:37-54`; `packages/wallet-bridge/src/operation.ts:144-183`.
**Description**: The trust surface mixes a lossy authority display with unsanitized attacker-controlled strings. Codex showed that the wallet hides scheme/port differences by reducing the canonical origin to a hostname; Claude showed that dApp names, token labels, function names, and artifact names bypass `sanitizeWireString`, enabling bidi, zero-width, and homoglyph phishing on the approval surface itself.
**Recommended fix**: Display the same full origin string the session model keys on, visually mark dApp-supplied names as untrusted metadata, and route every attacker-controlled label through `sanitizeWireString` (or an equivalent canonicalization pipeline) before rendering.
**Effort estimate**: days

### [MEDIUM] F-010: Incoming-transfer persistence is unbounded, including blocked and hidden contracts
**CVSS v4.0 band**: Medium (estimated 5.4-6.1)
**Cluster**: C7
**Found by**: codex (Claude didn't notice)
**Confidence**: high
**CWE**: CWE-400 (Uncontrolled Resource Consumption)
**Trace**: incoming-transfer rows are persisted in local storage at `repository.ts:20,34-35` with no cap/GC path in `repository.ts:48-49,56-72,95-120` → after a token is watched, scans read raw notes at `incoming-transfer/service.ts:573-576` and persist every new nullifier at `service.ts:617-629,660-676` → `blocked` only hides rows instead of stopping writes because `setTrustReject()` flips state at `service.ts:322-329`, but later scans still upsert hidden rows.
**Instances**: `packages/extension/src/wallet/services/incoming-transfer/repository.ts:20,34-35,48-49,56-72,95-120`; `packages/extension/src/wallet/services/incoming-transfer/service.ts:260-275,322-329,440-453,573-576,617-629,660-676`.
**Description**: Once a contract is watched, an attacker who can send dust notes to the user can grow `chrome.storage.local` without bound. Even blocked contracts continue to accumulate hidden rows. Claude did not notice this quota-exhaustion path.
**Recommended fix**: Add bounded retention and quota-aware error handling for incoming-transfer rows, and short-circuit persistence entirely for blocked contracts.
**Effort estimate**: days

### [MEDIUM] F-012: Live node chain identity is not rebound to the selected network before signing/proving
**CVSS v4.0 band**: Medium (estimated 6.4-6.9)
**Cluster**: C8
**Found by**: claude+codex
**Confidence**: high
**CWE**: CWE-345 (Insufficient Verification of Data Authenticity)
**Trace**: enrollment stores only the composite chain id via `_getChainId(rpcUrl)` at `network/service.ts:726-733` → later runtime code reconstructs `NetworkInfo` from the stored row at `network/service.ts:542-547` and creates a node from `network.rpcUrl` at `chain-runtime.ts:104-105` → `NuloAccount.buildTxExecutionRequest()` then trusts fresh `node.getNodeInfo()` values at `nulo-account.ts:99-103` without checking they still match the selected network → `execution/service.ts:1643-1647` likewise exposes fresh node values on `getChainInfo`.
**Instances**: `packages/extension/src/wallet/services/network/service.ts:235-252,470-485,542-547,726-733`; `packages/aztec-runtime/src/pxe/chain-runtime.ts:104-105,199-229`; `packages/aztec-runtime/src/account/nulo-account.ts:99-103`; `packages/extension/src/wallet/services/execution/service.ts:1643-1647`.
**Description**: Even after the user has selected a network, the wallet does not rebind the live node’s `(l1ChainId, rollupVersion)` pair back to that stored network identity before building authwits or tx requests. A malicious or drifted endpoint can therefore change the signing/proving context after enrollment. This is a follow-on trust failure after F-011, not an independent endpoint-selection primitive.
**Recommended fix**: Recompute the live composite from `node.getNodeInfo()` before any signing/proving or `getChainInfo` response and fail closed if it does not match the selected network’s stored identity; stronger still, persist and compare both fields separately.
**Effort estimate**: days

## Low findings
None.

## Findings NOT pursued (dropped during reduce)
- C3 IPC sender-validation, inherited-dispatch, `unwrapParams`, and backpressure findings were dropped as current-snapshot hardening gaps: they require a hypothetical same-extension or future `externally_connectable` caller, and I did not find a concrete page-to-generic-IPC bridge in the present repo.
- C2 extension-ID / `walletIcon` leakage was dropped as a low-sensitivity fingerprinting disclosure with explicit protocol tradeoff characteristics and limited standalone impact.
- C2 chain-id truncation collision was dropped as low-impact and highly conditional; the math is real, but the practical exploit chain was not strong enough to keep.
- C2/C8 cold-boot races, offscreen READY races, prove-timeout behavior, and similar boot-window issues were dropped as availability/reliability problems rather than material boundary breaks.
- C4 passhash-in-`chrome.storage.local`, constant-time `array_equals`, `Math.random()` utility hygiene, salt-from-IV structure, and similar crypto-quality claims were dropped where Codex’s negative-space review ruled out the claimed exploit path or the remaining issue was only defense-in-depth.
- C4 passkey PRF-length validation and zeroization-clone concerns were dropped because they require a malicious authenticator or forged internal credential payload, not a concrete web-to-wallet exploit path in this audit scope.
- C5 backup authenticity/replay, partial-restore rollback, `pendingRestoreSecrets` lifetime, and passhash-in-session issues were dropped as documented opt-in tradeoffs, user-assisted import risks, or robustness issues rather than strong privilege-boundary breaks in current defaults.
- C6 `dapp.logo` image-url hazard was dropped because no current write path populates `logo`; keeping it as a finding would be speculative.
- C6 token pre-trust / first-receive workflow concerns and adjacent races were dropped as product-workflow inconsistencies after the user has already approved the token add, not as strong standalone security boundary breaks.
- C7 malformed-storage handling, enum/schema validation gaps, journal races, migration drift, and logging-preview issues were dropped where they depended on local storage corruption or an untrusted write primitive that was not present in the audited scope.
- C8 artifact-cache keying and node-driven default-fee concerns were dropped as derivative/chained hardening issues under the broader “malicious RPC endpoint becomes trusted authority” finding.

## Cross-cutting observations
- Authorization is repeatedly checked at the wrong granularity. The code often validates a coarse type or session once, then skips the finer-grained re-check that actually matters later: frame identity vs tab identity, capability type vs sub-grant bits, primary account vs scope lists, stored dApp session vs live wallet-sdk transport, selected network vs live node identity.
- The approval UX over-trusts metadata. Across discovery, execute, token, and trust popups, user decisions depend on dApp-controlled strings while the authoritative data is either hidden (`args`, full calldata, full origin) or visually de-emphasized (contract address, full URL).
- User- or backup-supplied RPC configuration is effectively a root of trust. Once an endpoint is selected, the wallet lets that node shape chain identity, fee defaults, private-state reads, and signing/proving context with limited independent validation.
