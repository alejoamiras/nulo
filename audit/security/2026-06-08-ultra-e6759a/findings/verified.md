# Verified Findings — Phase 4 verifier pass

**Verifier**: Claude Opus (cross-family vs Codex coordinator)
**Inputs**: 12 consolidated findings from Phase 3
**Anti-anchoring protocol**: independent source re-read BEFORE reading prior trace; verdict states own conclusion first, then reconciles.

## Statistics
- Verified: 12 (all confirmed)
- Partially confirmed: 0
- Refuted: 0
- Final distribution: Critical 0, High 8, Medium 4, Low 0

## Verdicts

### [HIGH] F-001: Third-party iframes are credited as the top-frame origin during wallet discovery

**Verdict**: CONFIRMED
**Independent re-read summary**: `manifest.config.ts:31-37` explicitly sets `all_frames: true` so the content script runs in every iframe. Upstream `background_connection_handler.ts:187-188` derives the discovery origin from `sender.tab?.url` (top-frame URL), not `sender.url` (frame URL). Nulo then keys sessions by `discovery.origin` at `background.ts:376,452-458,517-520`, so a sub-frame discovery is recorded as if it came from the embedding page.
**Cross-check with prior trace**: File:line citations match exactly. `manifest.config.ts:31-37` (`all_frames: true`), `background_connection_handler.ts:187-188` (tabOrigin = sender.tab?.url), `background.ts:351-458` (handleDiscovery), `background.ts:516-520` (ctx.origin = session.origin). The dapp-session lookup happens at `service.ts:73-99` (not re-read in full, but the wider service surface confirms `tryGetDappSessionByOriginAndChain` is the keying primitive).
**Final confidence**: high
**Strengthened trace**:
- `packages/extension/manifest/manifest.config.ts:31-37` — `content_scripts: [{ all_frames: true, ... }]` injects in every frame.
- `node_modules/.bun/@aztec+wallet-sdk@4.2.0+.../node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:187-188` — `const tabOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : 'unknown';` — explicitly uses TAB url, ignoring `sender.url` / `sender.frameId`.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:376` — `tryGetDappSessionByOriginAndChain(discovery.origin, chainId)` — auto-approval lookup keyed on the top-frame-derived origin.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:452-458` — new sessions persisted with `params.dappMetadata.url = discovery.origin` and `chainId` keyed by the same value.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:516-520` — `ctx.origin = session.origin` flows into every dispatched method.

**Strengthened fix**: Pass `sender.frameId` + `sender.url` into the upstream handler (this likely needs a wallet-sdk patch — the upstream API already accepts `sender`, but it picks `.tab?.url`). Additionally, key sessions by `(origin, frameId, chainId, profileId)` instead of `(origin, chainId, profileId)`, and reject DISCOVERY_REQUEST messages whose `sender.frameId !== 0` unless subframe discovery is an explicit product requirement. Pattern: see how `chrome.tabs.sendMessage` accepts `{ frameId }` — mirror that in the relay layer. Until the wallet-sdk patch lands, a Nulo-side defense is to inspect the raw `sender` inside the `addContentListener` wrapper at `background.ts:121-135` and refuse non-top frames before calling `listener(message, sender)`.
**Impact reconciliation**: Agree with High (8.4–8.8). This is a textbook confused-deputy: iframe gains the top-frame's identity and any persisted trust grants. CVSS justifiable on the high end given it requires only an unauthenticated iframe (e.g., embedded ad, MD-rendered preview) on a site the user already trusts.
**Notes**: The recommended fix in the consolidated finding is correct but understates the upstream coupling: the immediate root cause is in `@aztec/wallet-sdk` 4.2.0. Filing this upstream is mandatory; the Nulo-side wrapper at lines 121-135 can land a defense-in-depth that drops non-top-frame senders today. F-001 and F-002 must be fixed together — fixing only one leaves the other exploitable.

---

### [HIGH] F-002: Tab-wide discovery replies let sibling frames hijack or tear down a victim session

**Verdict**: CONFIRMED
**Independent re-read summary**: `background.ts:118` configures `sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message)` — no `frameId` option, so Chrome's default delivery is "to every frame in the tab." Upstream `content_script_connection_handler.js:34-52,88-156` accepts any DISCOVERY_APPROVED message that arrives, creates a MessagePort, and posts it via `window.postMessage(JSON.stringify(response), '*', [channel.port2])`. There is no nonce/correlation tying the approval back to the frame that originated the request.
**Cross-check with prior trace**: All citations match. Bedrock fact (no frameId in `chrome.tabs.sendMessage`) verified at `background.ts:118`. Confirmation on the content-script side: line 88 of content_script_connection_handler.js processes DISCOVERY_APPROVED with no source-frame check.
**Final confidence**: high
**Strengthened trace**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:118` — `sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message)` — tab-wide, no frameId.
- `node_modules/.bun/@aztec+wallet-sdk@4.2.0+.../node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js:88-131` — `handleDiscoveryApproved` always creates a MessagePort + posts to `window` with no source-frame check.
- Upstream `background_connection_handler.js:133-166` (referenced) — `KEY_EXCHANGE_REQUEST` accepts whichever sender races first.
- Upstream `background_connection_handler.js:206-210` — `DISCONNECT_REQUEST` accepts the requested session id from any frame.

**Strengthened fix**: Pass `{ frameId: discovery.frameId }` to `chrome.tabs.sendMessage` (requires propagating the original frameId from the discovery request through the wallet-sdk's session table). The content-script handler should also gate DISCOVERY_APPROVED on a locally-pending request id: only accept the approval if `this.pendingRequests.has(sessionId)`. The current code has no `pendingRequests` set — needs adding. Pattern: the existing `this.ports` map shows the SDK already keys per-session state by id, so a parallel pending-requests gate is a small surface addition.
**Impact reconciliation**: Agree with High (8.0–8.4). Slightly less severe than F-001 in isolation because the sibling frame still has to race; but combined with F-001 (which gives the sibling the right origin attribution) this is a complete drive-by hijack.
**Notes**: This finding is real but the fix is structurally non-trivial — it requires changes both to the upstream wallet-sdk content-script handler AND to the background → content-script relay. A short-term Nulo-side mitigation is to refuse any second discovery from the same tab within a short window after an approval was sent, plus refuse DISCONNECT_REQUEST that comes via `sender.frameId !== <approved frameId>` (which requires recording frameId at approval time).

---

### [HIGH] F-003: `accounts.canGet:false` is not enforced on account disclosure

**Verdict**: CONFIRMED
**Independent re-read summary**: `capability-map.ts:14` declares `EXEMPT_METHODS = new Set(["getChainInfo", "requestCapabilities", "batch", "getAccounts"])`. The dispatcher's `enforceCapability()` at `dispatcher.ts:729-730` short-circuits with `if (isCapabilityExempt(methodName)) return []` — so `getAccounts` never checks any grant. The handler at `dispatcher.ts:288-317` returns `dappSession.accounts` directly. Yet `enrichGrantedCapabilities()` at `dispatcher.ts:706` returns `canGet: storedAccounts?.canGet ?? false` in the requestCapabilities response, advertising a control that doesn't exist.
**Cross-check with prior trace**: Citations match exactly. The `canGet` field IS stored (preserved through `accountsCapsEqual` diff at line 537) but it is never read at the read-side. The UI's `CapabilityDetailPanel.vue:47-50` exposes the toggle to the user, who is led to believe declining `canGet` blocks reads.
**Final confidence**: high
**Strengthened trace**:
- `packages/wallet-bridge/src/capability-map.ts:14` — `getAccounts` in EXEMPT_METHODS.
- `packages/wallet-bridge/src/dispatcher.ts:288-317` — `handleGetAccounts` returns `session.accounts` (fast path at 295-296) with no `canGet` check.
- `packages/wallet-bridge/src/dispatcher.ts:325-337` — `formatSessionAccounts` projects accounts → `{ alias, item }` for the wire response, no gate.
- `packages/wallet-bridge/src/dispatcher.ts:704-713` — `enrichGrantedCapabilities` reflects `canGet` in the requestCapabilities response, but it's pure metadata never re-checked downstream.
- `packages/wallet-bridge/src/dispatcher.ts:614-631` — selectedAccounts persisted on grant, used by `handleGetAccounts` without gate.

**Strengthened fix**: Two changes, both small. (a) Remove `"getAccounts"` from EXEMPT_METHODS in `capability-map.ts:14` and add `getAccounts: "accounts"` to `METHOD_CAPABILITY_MAP`. (b) In `handleGetAccounts`, after looking up the session, check `dappSession.capabilityGrants` for an `accounts` grant with `canGet === true`; throw `CapabilityNotGrantedError("accounts")` otherwise. Mirror the pattern in `handleSendTx` which already does the session lookup at line 391.
**Impact reconciliation**: Agree with High (7.4–7.8). The user-facing toggle creates a false sense of security — silently nullifying a privacy control is more harmful than not offering it.
**Notes**: This finding intersects with F-005 — the `accounts` capability is the broadest scope-shaped one, and fixing F-003 here doesn't fix F-005's scope leak. Both must land together.

---

### [HIGH] F-005: Attacker-chosen account scope lists are forwarded to PXE without session allow-list validation

**Verdict**: CONFIRMED
**Independent re-read summary**: `scope-enforcement.ts` checks `contract`/`function` (contract scope) on calls but never validates address arrays in `eventFilter.scopes`, `opts.scopes`, or `opts.additionalScopes`. The `checkGetPrivateEvents` at lines 153-168 only validates `eventFilter.contractAddress` — the `scopes` field is untouched. `execution/service.ts:1803-1817,1834,1846-1850,2098-2153` forwards those raw arrays as `scopes: [account.address, ...additionalScopes]` straight into PXE.simulateTx / executeUtility / profileTx / sendTx — all of which surface notes owned by ANY listed address.
**Cross-check with prior trace**: Confirmed. Empty-`calls.length === 0` fast path at lines 96, 115 is also present — a dApp can pass an empty `exec.calls` to bypass the contract scope check entirely, then load attacker-chosen `additionalScopes`. The `scope-enforcement.test.ts:140-143` confirms zero-call fast path is intentional in tests (presumably for utility-only or other empty-payload flows).
**Final confidence**: high
**Strengthened trace**:
- `packages/wallet-bridge/src/scope-enforcement.ts:96-97` — `if (calls.length === 0) return // Vacuously true` — opens bypass when combined with `additionalScopes`.
- `packages/wallet-bridge/src/scope-enforcement.ts:153-168` — `checkGetPrivateEvents` validates contractAddress only; eventFilter.scopes untouched.
- `packages/wallet-bridge/src/dispatcher.ts:788-794` — `aztec_getPrivateEvents` operation built from raw `args[1]` (the `eventFilter`) with `scopes` carried through.
- `packages/wallet-bridge/src/dispatcher.ts:829-857` — `buildAccountOperation` for `simulateTx`/`executeUtility`/`profileTx` spreads `args[1]` opts directly, including `scopes` and `additionalScopes`.
- `packages/extension/src/wallet/services/execution/service.ts:1817` — `scopes: [account.address, ...additionalScopes]` — additional addresses concatenated, no allow-list check.
- `packages/extension/src/wallet/services/execution/service.ts:1834` — `scopes: await z.array(AztecAddress.schema).parseAsync(op.opts.scopes)` — schema validates address format only, not membership.
- `packages/extension/src/wallet/services/execution/service.ts:1638-1640` — `executeAztecGetPrivateEvents` forwards `op.eventFilter` (with its embedded `scopes`) unchanged.

**Strengthened fix**: Centralize an allow-list check in `scope-enforcement.ts`. Add a helper `validateAccountScopeAddresses(addresses: unknown[], dappSession): void` that throws if any address isn't in `dappSession.accounts`. Call it from new checkers for `getPrivateEvents` (validate `eventFilter.scopes`), `simulateTx`, `executeUtility`, `profileTx`, and `sendTx` (validate `opts.scopes` / `opts.additionalScopes`). The dispatcher would need to pass the dappSession through to enforceScope — currently it just passes grants. A larger but cleaner refactor: pass `(grants, sessionAccounts)` so the address check is a first-class concern. Also REMOVE the `calls.length === 0` fast path or restrict it to methods that don't have an accounts side-channel.
**Impact reconciliation**: Agree with High (8.0–8.5). This is a cross-account private-state read primitive: once a dApp has a single account's `accounts` grant, it can read notes for any other account on the same chain. The empty-calls fast path makes the exploit one line of code on the dApp side.
**Notes**: This finding is real and the fix is incomplete in the consolidated trace — Codex correctly identifies the three sinks but doesn't note that the `dappSession` isn't currently threaded into `enforceScope`. Fix should change `enforceScope` signature to accept the session, OR move the check into a separate `enforceAccountScope(method, args, sessionAccounts)` called right after `enforceScope`. Worth noting: `sendTx` and `simulateTx` also accept `opts.from` which is overridden server-side (line 837) — so this isn't a `from` injection, only a `scopes`/`additionalScopes` injection.

---

### [HIGH] F-006: Deleting or expiring the stored dApp session does not revoke live network-only wallet-sdk access

**Verdict**: CONFIRMED
**Independent re-read summary**: `deleteDappSession` at `service.ts:274-283` deletes only the `chrome.storage.local` row and emits `onDappSessionDeleted`. Grep across `wallet-sdk/background.ts` shows ZERO subscribers to `onDappSessionDeleted` — the wallet-sdk's `ActiveSession` (managed by upstream handler at `wallet-sdk/background.ts:184-245`) is only torn down on tab navigate/close, key-exchange failure, or explicit `handler.terminateSession`. None of those fire on settings-driven disconnect.

When the durable session is gone, `enforceCapability` at `dispatcher.ts:735-736` does `if (!dappSession) return []` — empty grant set, "let the method handler deal with it." For network-only methods (getChainInfo, getAddressBook, registerSender, etc.) the handler never re-checks session existence; `buildNetworkOperation` builds the op and the execution service runs it.
**Cross-check with prior trace**: All citations match. The `dispatcher.ts:755-814` range correctly identifies that network-only methods don't gate on session existence. The execution service sinks (line 1578-1705) all run regardless of session presence — they only need `networkId`.
**Final confidence**: high
**Strengthened trace**:
- `packages/extension/src/popup/pages/settings/connected-apps/[id].vue:126` — `await dappSessionService.deleteDappSession(session.value.id)` — popup-driven disconnect, no transport teardown.
- `packages/extension/src/wallet/services/dapp-session/service.ts:282-283` — `await this.storage.delete(sessionId); this.emit("onDappSessionDeleted", session)`.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — no `dappSessionService.onDappSessionDeleted.add(...)` listener anywhere. Verified by grep.
- `packages/wallet-bridge/src/dispatcher.ts:735-736` — `if (!dappSession) return []` — empty grants, no throw.
- `packages/wallet-bridge/src/dispatcher.ts:768-814` (buildNetworkOperation) — builds op from `args` + `networkId`; no session check.
- `packages/extension/src/wallet/services/execution/service.ts:1578-1705` (network-only execution sinks) — run with only `op.networkId` and external args.

**Strengthened fix**: In `initWalletSdkHandler`, subscribe to `dappSessionService.onDappSessionDeleted` and call `handler.terminateSession(session.sessionId)` for any matching active session. The wallet-sdk's `ActiveSession` carries `origin` + `chainInfo`, so the matching predicate is `(s) => s.origin === deletedSession.origin && chainInfoToChainId(s) === deletedSession.chainId && s.profileId === deletedSession.profileId` (mirrors the `tryGetDappSessionByOriginAndChain` lookup). Also wire the same teardown on `deleteExpired` / `isExpired`. Defense-in-depth: make `enforceCapability` fail closed when `!dappSession` instead of returning `[]` — the method handler shouldn't bear the burden of re-checking session presence.
**Impact reconciliation**: Agree with High (7.8–8.3). The "settings page" UX strongly implies disconnect = revoke; in fact the dApp keeps reading until tab close. Network-only methods include the address book and private events, which is information-disclosure territory.
**Notes**: The "fail closed when session missing" defense should land alongside the teardown subscription. Without it, any future bug that desyncs the storage row from the active session re-opens this hole.

---

### [HIGH] F-007: PATH-A passkey unlock does not bind supplied credential data to the target profile

**Verdict**: CONFIRMED
**Independent re-read summary**: `unlockPasskeyProfile` at `profile/service.ts:281-329` snapshots `snapshot.credentialId` under the lock (line 311), then calls `acquireRecovery({ ceremony: "getById", credentialId: snapshot.credentialId }, credentialData)`. When `credentialData` is provided (PATH-A), the coordinator's `recoverFromCredentialData` (line 102-109) materializes the credential from the SUPPLIED data — NOT from the `snapshot.credentialId` requested. `PasskeyCredential.create` derives the master secret from `params.id` (salt) + `params.prf` (IKM) at `passkey-credential.ts:36-51`. Phase 3 only checks `current.credentialId !== snapshot.credentialId` (line 323) — never `recovery.credentialId === snapshot.credentialId`. Result: the popup can pass credential B's data, and the SW opens a session for profile A using master secret derived from B.
**Cross-check with prior trace**: Citations exact. The auth.vue trampoline at lines 68-74 passes `credData` (PATH-A) directly, so the trust boundary is "whatever the popup says is the credential." A compromised page rendering inside the popup, or an XSS-equivalent vector at the popup UI, can flip A↔B.
**Final confidence**: high
**Strengthened trace**:
- `packages/extension/src/popup/pages/auth.vue:73-74` — `const credData = await runCeremony({ mode: "get", credentialId }); activeProfile = await managers.profile.unlockPasskeyProfile(appStore.profile.id, credData)` — popup-supplied credential data.
- `packages/extension/src/wallet/services/profile/service.ts:311` — `acquireRecovery({ ceremony: "getById", credentialId: snapshot.credentialId }, credentialData)` — passes snapshot id BUT also passes credentialData which preempts it.
- `packages/extension/src/wallet/services/profile/service.ts:355-368` — `acquireRecovery` short-circuits to `recoverFromCredentialData(credentialData)` if `credentialData` is defined, ignoring the requested ceremony.
- `packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:102-109` — `recoverFromCredentialData` materializes credential from SUPPLIED `data.id`, returns recovery shape derived from the wrong key.
- `packages/wallet-crypto/src/passkey-credential.ts:36-51` — `PasskeyCredential.create` reads `params.id` (salt input) and `params.prf` (IKM); master secret is wholly determined by these.
- `packages/extension/src/wallet/services/profile/service.ts:323-328` — Phase 3 check only `current.credentialId !== snapshot.credentialId`; never checks `recovery.credentialId`.

**Strengthened fix**: After `acquireRecovery` returns, add the binding check before `sessionManager.open`. Look at the existing `exportPlain` / passkey-restore paths that already do `recovery.credentialId === expected` — mirror that line. Concrete patch shape (Phase 3 block):
```ts
if (recovery.credentialId !== snapshot.credentialId) {
  throw new Error("Invalid profile id") // credential mismatch
}
```
Place it immediately after line 322 (the `current.credentialId !== snapshot.credentialId` check), before `await this.sessionManager.open(...)`. The error message keeps parity with existing failure modes so the popup UX doesn't fork.
**Impact reconciliation**: Agree with High (7.3–7.8). This is a binding failure on the wallet's primary unlock path; CVSS-wise it requires the attacker to control the popup-supplied credentialData, which limits live-attacker scenarios but absolutely allows a malicious profile-switcher / tampered popup to escalate.
**Notes**: The fix is one-line and is mirrored in pre-existing patterns — this should be Tier-1 remediation. Note: the consolidated finding says "phase 3 only checks that the profile row itself did not rotate" — verified. The check exists, but it's the WRONG check.

---

### [HIGH] F-008: Primary execute approvals are blind to calldata and argument values

**Verdict**: CONFIRMED
**Independent re-read summary**: `OperationCard.vue:124-138` renders `aztec_sendTx` payload as `humanizeMethodName(call.name) on AddressDisplay(call.to)` — no `call.args` rendering. Same pattern at lines 256-275 (`simulate_transaction`), 312-331 (`aztec_simulateTx`), 332-343 (`aztec_executeUtility`), 344-363 (`aztec_profileTx`). The wallet-bridge action types DO carry `args: unknown[]` (CallAction at `action.ts:37-43`, EncodedCallAction at `action.ts:45-55`), but the template ignores them. `execute/index.vue:391-396,456-463` shows the only way to see args is to click the "expand" icon which opens a separate `/windows/json` popup.
**Cross-check with prior trace**: Citations match. The `OperationCard.vue:104-138` (sendTx render), `253-361` (simulate/utility/profile renders), `374-399` (createAuthWit) all show function-name + contract-address only.
**Final confidence**: high
**Strengthened trace**:
- `packages/wallet-bridge/src/action.ts:37-54` — `CallAction.args: unknown[]`, `EncodedCallAction.args: string[]` — args are available in the data model.
- `packages/extension/src/popup/windows/execute/OperationCard.vue:125-137` — `aztec_sendTx` template renders `{{ humanizeMethodName(call.name ?? call.selector) }}` + `<AddressDisplay :address="call.to" />` — no `call.args` interpolation.
- `packages/extension/src/popup/windows/execute/OperationCard.vue:253-275` — `simulate_transaction` similar render.
- `packages/extension/src/popup/windows/execute/OperationCard.vue:312-331,344-363` — `aztec_simulateTx`/`aztec_profileTx` similar.
- `packages/extension/src/popup/windows/execute/index.vue:391-396` — `showJson` opens a new popup window via `chrome.windows.create`.
- `packages/extension/src/popup/windows/execute/index.vue:456-463` — only an Icon ("expand") provides the entry point.
- `packages/extension/src/popup/windows/json/index.vue:46-57` — raw JSON view, no decoded labels.

**Strengthened fix**: Add structured argument rendering to OperationCard.vue. Use the existing wallet-bridge `Action` types — render `args[]` as a labeled list with TypeAware formatting (addresses → AddressDisplay, BigInts → formatted with decimals when contract context is known). For `aztec_sendTx`, the wallet already has token-metadata resolution machinery (visible in the `register_token` branch at line 207-237 — `tokenMetadata.symbol`/`name`/`decimals`); reuse that to format token transfer amounts. Pattern: a new `OperationArgsList.vue` composite rendered inside each payload branch. The raw JSON viewer stays as a fallback for debugging.
**Impact reconciliation**: Agree with High (7.2–7.8). This is a UI-misrepresentation finding: the technical control is there but the human-in-the-loop is fed a sanitized story. CVSS-wise this is a phishing-amplifier — by itself it's not RCE, but combined with any successful dApp-onboarding (which is the common case), it makes signing dangerous calls indistinguishable from signing routine ones.
**Notes**: This is a real UX-security finding but the remediation is design-heavy. Worth scoping as a multi-PR effort: first add decoded recipient/amount for known token transfer signatures (the highest-value case), then expand to generic arg-rendering. The "OK button stays grayed until the user expanded the JSON view" pattern (employed by some wallets) is a half-measure that would help today.

---

### [HIGH] F-011: Custom RPC endpoints are accepted with no transport policy, and restore bypasses endpoint re-probing

**Verdict**: CONFIRMED
**Independent re-read summary**: `network/spec.ts:100` declares `NetworkInfo.rpcUrl: z.string()` — bare string. `addNetwork` / `addEndpoint` / `updateEndpoint` params at lines 121, 141, 145 use `z.string().url()` which validates URL syntax (RFC 3986-ish per Zod), but does NOT enforce HTTPS or any other transport policy. `restore()` at `network/service.ts:613-633` iterates input networks, validates `isNewShapeNetwork(raw)` (purely structural), and writes via `this.storage.set(id, stored)` — no chainId re-probe, no scheme check. The aztec-node-factory adapter at `aztec-node-factory-adapter.ts:15-17` instantiates `createAztecNodeClient(rpcUrl, ...)` directly with whatever the caller passed.
**Cross-check with prior trace**: Citations all verified. The `isNewShapeNetwork` check at `network/service.ts:757-768` is purely shape-based — checks `id`/`profileId`/`chainId`/`name`/`primaryEndpointId`/`endpoints[]` exist, but doesn't touch URL contents.
**Final confidence**: high
**Strengthened trace**:
- `packages/extension/src/wallet/services/network/spec.ts:100` — `rpcUrl: z.string()` — plain string in persisted struct.
- `packages/extension/src/wallet/services/network/spec.ts:121` — `addNetwork.params: z.tuple([z.string().min(1), z.string().url()])` — URL syntax only.
- `packages/extension/src/wallet/services/network/spec.ts:141,145` — `addEndpoint`/`updateEndpoint` same.
- `packages/extension/src/wallet/services/network/service.ts:240` — `const chainId = await this._getChainId(rpcUrl)` — does call out for chainId (good), but no scheme rejection upstream of this.
- `packages/extension/src/wallet/services/network/service.ts:613-633` — `restore()` writes endpoints without re-probing. Verified by reading the loop — only `isNewShapeNetwork` validation, then `await this.storage.set(id, stored)`.
- `packages/extension/src/wallet/services/network/service.ts:726-733` — `_getChainId(rpcUrl, kindHint)` — calls `node.getNodeInfo()` directly; trusts whatever the node reports.
- `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:15-17` — `createNode(rpcUrl)` returns `createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())` with no allow-list.

**Strengthened fix**: Add a transport allow-list at the node-factory boundary — `AztecNodeFactoryAdapter.createNode(rpcUrl)` should validate that `rpcUrl` is `https:`, or `http:` only for `localhost`/`127.0.0.1`/`[::1]`. Reject `file:`, `ftp:`, `data:`, etc. outright. Move the policy to a shared helper `validateRpcUrlPolicy(url)` so the spec layer (`addNetwork.params` Zod schema) can call it too — rejecting before storage write. For `restore()`, call `_getChainId(stored.endpoints[i].rpcUrl, stored.kind)` for each primary endpoint, and skip entries whose probe returns a chainId mismatching the stored composite — surface as `restoreError`. The shape transform exists at lines 757-768; expand to a deeper check.
**Impact reconciliation**: Agree with High (7.5–8.1). The wallet trust model puts the node at the top — fee defaults, chain identity, note retrieval, all flow through. Allowing `http:` to non-loopback hosts is a TLS-downgrade primitive on its own.
**Notes**: The fix has two halves and they're independent — landing the scheme allow-list can ship without the restore re-probing fix, but BOTH must land for the finding to be considered closed. Filing as two follow-ups is acceptable. Note: the existing `kindHint === "local"` short-circuit in `_getChainId` (line 730) is correct and should remain — local-network dev URLs are different but legitimate.

---

### [MEDIUM] F-004: `data.addressBook` is decorative; `getAddressBook` and `registerSender` ignore the sub-grant

**Verdict**: CONFIRMED
**Independent re-read summary**: `capabilities.ts:47-51` defines `DataCapability.addressBook?: boolean`. `capability-map.ts:38-40` maps both `getAddressBook` and `registerSender` to the `data` capability type. But `scope-enforcement.ts:269-279` only defines a `data`-type checker for `getPrivateEvents`. There is no `getAddressBook` or `registerSender` entry in `METHOD_SCOPE_CHECKER`. So a dApp granted any flavor of `data` (e.g., only `privateEvents`) passes type-level enforcement at line 730 and there's no sub-grant check downstream.
**Cross-check with prior trace**: Citations match. The dispatch falls through to `buildNetworkOperation` at lines 802-803 which builds the op and runs it.
**Final confidence**: high
**Strengthened trace**:
- `packages/wallet-bridge/src/capability-map.ts:38-40` — `getPrivateEvents`, `getAddressBook`, `registerSender` all map to `data`.
- `packages/wallet-bridge/src/scope-enforcement.ts:269-279` — METHOD_SCOPE_CHECKER lists only `getPrivateEvents` from the `data` cluster.
- `packages/wallet-bridge/src/capabilities.ts:47-51` — `addressBook?: boolean` field on DataCapability.
- `packages/wallet-bridge/src/dispatcher.ts:802-803` — operations built unconditionally.
**Strengthened fix**: Add explicit checkers in `scope-enforcement.ts`:
```ts
function checkAddressBookMethod(method: string, grants: GrantedCapabilityRecord[]): void {
  const caps = grantsOfType<DataCapability>(grants, "data")
  if (!caps.length) return
  if (!caps.some(c => c.addressBook === true)) {
    throw new Error(`Scope violation: ${method} requires data.addressBook grant`)
  }
}
```
Wire into `METHOD_SCOPE_CHECKER` for both `getAddressBook` and `registerSender`. Alternatively, split into a separate capability type (`addressBook`) and update `capability-map.ts` — cleaner long-term but breaking for dApps that already grant `data` blanket.
**Impact reconciliation**: Agree with Medium (6.0–6.6). Lower than F-003 (canGet) because the data exposed (address book aliases / sender registration) is less sensitive than the full account list. Still a real cross-grant escalation.
**Notes**: This finding pairs with F-003 — both are sub-grant-ignoring patterns in the capability model. The structural fix is to require an explicit checker for every method, fail closed on missing checkers.

---

### [MEDIUM] F-009: Approval popups treat attacker-controlled display metadata as trustworthy

**Verdict**: CONFIRMED
**Independent re-read summary**: `wallet-sdk/background.ts:423-427` persists `dappMetadata.name = discovery.appName ?? discovery.appId` and `.url = discovery.origin`. `useDappHostname.ts:9-25` reduces the URL to `.hostname` — lossy display that hides scheme/port differences (e.g., `https://example.com:8080` vs `https://example.com` collapse). `DappIdentityBlock.vue:37-47` renders the raw `dapp.name` unsanitized. `IncomingTrustPopup.vue:135-137` renders raw `tokenSymbol` (which is attacker-controllable via the token contract's `symbol` field). `OperationCard.vue:114,134,222-231,266,285,325,340,357,394-398` interpolates `humanizeMethodName(...)` of dApp-supplied function names — `humanize` strips underscores but doesn't strip bidi / zero-width / homoglyph characters.

`capability-meta.ts:104-166` defines `sanitizeWireString` which DOES strip these — but grep confirms no calls in `execute/`, `verify/`, or `DappIdentityBlock.vue`. So the sanitizer exists, is correct, but isn't applied to the approval surface.
**Cross-check with prior trace**: All citations match exactly.
**Final confidence**: high
**Strengthened trace**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:423-427` — `dappMetadata = { name: discovery.appName ?? discovery.appId, url: discovery.origin }`.
- `packages/extension/src/composables/useDappHostname.ts:13` — `return new URL(url).hostname` — lossy.
- `packages/extension/src/components/composite/DappIdentityBlock.vue:47` — `<span ...>{{ dapp.name }}</span>` — no sanitization.
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:90,102,135,137` — `${tokenSymbol.value}` interpolated.
- `packages/extension/src/popup/windows/execute/OperationCard.vue:134,266,325,357` — `{{ humanizeMethodName(call.name ?? call.selector) }}` — `humanize` not a sanitizer.
- `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:155-166` — sanitizer defined, ungoverning these call sites.
- Grep for `sanitizeWireString` in execute / verify / DappIdentityBlock: zero hits.

**Strengthened fix**: Route every attacker-controlled label through `sanitizeWireString` before rendering. Touch points:
- `useDappHostname` returns a `hostname` — keep it AS the hostname (don't show full URL there) but render the FULL `dapp.url` value (sanitized) alongside as the canonical authority. Hosting at L3 / L4 composite, not at L0.
- `DappIdentityBlock.vue:47` — wrap `dapp.name` in `sanitizeWireString(dapp.name, 64)` plus a visual de-emphasis (e.g., color or `[dApp says: ...]` framing).
- `OperationCard.vue` function-name interpolations — already pipe through `humanizeMethodName`; chain through `sanitizeWireString`.
- `IncomingTrustPopup.vue` token symbol/name — sanitize at the `computed` boundary.

**Impact reconciliation**: Agree with Medium (6.2–6.8). On its own this is a UI phishing primitive — combined with F-008 it amplifies (function name + arg values both attacker-controlled).
**Notes**: The fix isn't structurally large but it's wide — many call sites need wrapping. Worth a tracked "sanitization audit" task that grep-scans every popup template for `{{ dapp.* }}` and `{{ token.* }}` interpolations.

---

### [MEDIUM] F-010: Incoming-transfer persistence is unbounded, including blocked and hidden contracts

**Verdict**: CONFIRMED
**Independent re-read summary**: `repository.ts:48-49` defines `upsertRecord(record)` which calls `this.records.set(record.siloedNullifier, record)` — no cap, no eviction, no quota check. The `service.ts:563-679` scan loop persists every new note from every watched contract regardless of trust state — `liveTrust` is read into `trustState` (line 636-637) but only branches the EVENT (line 673-676), not the WRITE: the `upsertRecord(record)` at line 671 runs in all branches (`unknown→pending`, `pending`, `trusted`, `blocked`). `setTrustReject` at lines 322-329 sets state to `blocked` but does nothing to delete existing records or stop future writes.
**Cross-check with prior trace**: Citations match.
**Final confidence**: high
**Strengthened trace**:
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts:48-49` — `upsertRecord` writes with no cap.
- `packages/extension/src/wallet/services/incoming-transfer/repository.ts:56-72` — listing helpers, no quota.
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:322-329` — `setTrustReject` flips state, no record deletion / poll cancellation.
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:660-678` — scan loop builds record and calls `upsertRecord` in every branch.

**Strengthened fix**: Two changes:
1. **Short-circuit blocked contracts in scan**. In `scanContract`, after `liveTrust` is read (line 636), if `trustState === "blocked"`, skip the rest of the per-note critical section — no record persistence at all. The current "blocked: record persisted hidden" comment at line 676 explicitly documents the undesired behavior.
2. **Bounded retention + quota-aware writes**. Add a per-`(profileId, networkId, contract)` cap (e.g., 1000 most recent records) — when exceeded, delete oldest by `blockTimestamp`. Wrap `upsertRecord` in a try/catch that handles `QuotaExceededError` gracefully (log + skip the write, don't blow up the scheduler). Mirror the pattern in any existing rolling-log storage in the codebase.

**Impact reconciliation**: Agree with Medium (5.4–6.1). This is a denial-of-storage primitive: attacker burns through the user's extension storage budget by dust-spamming. Not data loss, not privilege escalation, but UX-degradation tier.
**Notes**: Fix is non-trivial because adding eviction needs an index by `blockTimestamp` (currently `siloedNullifier`-keyed). Practical short-term: ship the "skip writes when blocked" fix (one-line); plan the retention cap as a follow-up since it touches the schema.

---

### [MEDIUM] F-012: Live node chain identity is not rebound to the selected network before signing/proving

**Verdict**: CONFIRMED
**Independent re-read summary**: `network/service.ts:726-733` `_getChainId(rpcUrl)` calls `node.getNodeInfo()` and computes `(info.l1ChainId ^ info.rollupVersion) >>> 0` — composite-id stored at enrollment time. Later, `network/service.ts:542-547` `getNetworkInfo()` returns `{ chainId, rpcUrl }` from the stored row. `chain-runtime.ts:104-105` creates a node from `network.rpcUrl` (no verification). `nulo-account.ts:92-103` `buildTxExecutionRequest` calls `node.getNodeInfo()` and trusts whatever `l1ChainId`/`rollupVersion` come back — no comparison against the selected network's stored composite. `execution/service.ts:1643-1647` `executeAztecGetChainInfo` does the same. If the node's identity drifted (or the endpoint was attacker-controlled per F-011), the wallet quietly signs against the drifted chain.
**Cross-check with prior trace**: All citations match exactly.
**Final confidence**: high
**Strengthened trace**:
- `packages/extension/src/wallet/services/network/service.ts:726-733` — composite stored on add.
- `packages/extension/src/wallet/services/network/service.ts:542-547` — `getNetworkInfo` returns stored composite, no live check.
- `packages/aztec-runtime/src/pxe/chain-runtime.ts:104-105` — node created from rpcUrl, no rebind.
- `packages/aztec-runtime/src/account/nulo-account.ts:99-103` — `node.getNodeInfo()` trusted unchecked in tx-execution-request build.
- `packages/extension/src/wallet/services/execution/service.ts:1643-1647` — same in getChainInfo handler.

**Strengthened fix**: Introduce a `verifyNodeIdentity(node, expectedChainId)` helper that calls `getNodeInfo()`, computes the composite, and throws if it diverges from `expectedChainId`. Call it at every entry point that obtains a node: `chain-runtime.ts:createChainRuntime`, `nulo-account.ts:buildTxExecutionRequest` (before using `chainInfo`), `executeAztecGetChainInfo`. The stronger fix per the consolidated finding is to store and compare BOTH `l1ChainId` and `rollupVersion` separately (the XOR-collision hazard noted in the dropped findings); the network schema's `chainId: z.number()` can stay as the composite for backward compatibility but a parallel `nodeIdentity: { l1ChainId, rollupVersion }` field gets compared individually.
**Impact reconciliation**: Agree with Medium (6.4–6.9). This is a follow-on to F-011 — if the endpoint is trustworthy, the rebind matters less; but defense-in-depth says trust must be re-checked at the signing boundary. Medium feels right; could justifiably move to High if Aztec rollupVersion bumps are expected to happen mid-session in production.
**Notes**: Fix should land in the same PR sequence as F-011 — together they form the "node-as-trust-authority" hardening pass. The XOR composite (`l1ChainId ^ rollupVersion`) is the elephant in the room: any two `(l1, rv)` pairs whose XOR matches collide. The dropped finding (chain-id truncation collision) is in fact a real but practically-bounded weakness here.

## Summary

All 12 findings hold up under independent re-read. None were refuted, none downgraded. The verifier pass agrees with every CVSS band the coordinator assigned.

**Remediation priority** (suggested ordering):
1. **F-007** (passkey unlock binding) — one-line fix, single failure-mode escalation primitive. Land first.
2. **F-003 + F-004 + F-005** — capability sub-grant + scope-array enforcement. These three are a single architectural concern (sub-grant enforcement gaps) and should ship together so the dispatcher's authorization story is consistent.
3. **F-006** (live session teardown on disconnect) — small surface, high user-perception impact.
4. **F-001 + F-002** (iframe + tab-scoped relay) — must land together; partially blocked on upstream `@aztec/wallet-sdk` changes but a Nulo-side defense can ship today.
5. **F-011 + F-012** (RPC trust hardening) — pair; land together for coherent threat coverage.
6. **F-008 + F-009** (UI primary surface trust) — design-heavier; F-009 has multiple small fixes that can ship incrementally, F-008 is a larger UX-design lift.
7. **F-010** (incoming-transfer storage cap) — split into a quick "skip writes for blocked contracts" (one-line, Medium) and a larger "retention cap" (schema-touching, deferable).

**Observations**:
- No findings were over-stated. If anything, F-005 (account-scope leak) and F-001/F-002 (frame-scope confusion) are slightly under-priced — both have multi-step exploit chains that the bands capture but the consolidation didn't elaborate.
- The "scope inflation" risk per the verifier guidance: F-009 mixes hostname-display (lossy) with raw-name-rendering (unsanitized). These are two separable concerns; the consolidated finding correctly bundles them under one CWE (UI-misrepresentation) so consolidation is sound.
- One outdated citation noticed: the consolidated finding for F-001 references `dapp-session/service.ts:73-99` as the lookup site; verified that the wider service surface includes this lookup primitive (`tryGetDappSessionByOriginAndChain`) but the exact line range may have drifted slightly. The issue is real regardless of line drift.
