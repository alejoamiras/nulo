# C2 — Content-script + wallet-sdk handler (Codex xhigh Pass 1)

## Findings

### C2-F1 — Cross-origin iframe is trusted as the top-level origin

**Severity**: High

**CWE**: CWE-346 (Origin Validation Error), CWE-441 (Unintended Proxy / Confused Deputy)

**Affected code**: `packages/extension/manifest/manifest.config.ts:31-37`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js:60-86`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:51-60`, `packages/extension/src/wallet/services/dapp-session/service.ts:73-99`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:373-380`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:516-520`

**Impact**: A third-party iframe can open or silently reclaim a wallet-sdk session as the embedding top-level site. If the user already trusted `https://trusted.example`, a malicious iframe on that page can inherit that origin’s stored accounts/capability grants and invoke wallet methods under `trusted.example`’s session context.

**Exploitability**: The attacker only needs JavaScript execution inside any iframe on a trusted page. No direct page-side `chrome.runtime.sendMessage` access is required.

**Attack prerequisites**: `all_frames: true` content-script injection is enabled for every page and frame, and the wallet is unlocked. Silent exploitation is strongest when a valid `(origin, chainId)` dApp session already exists, because auto-approval removes the connect popup entirely.

**Attack path**: The iframe posts an `aztec-wallet-discovery` message to its own window. Its frame-local content script relays that to the service worker. The upstream background handler attributes the request with `sender.tab.url` instead of `sender.url`, so the discovery is recorded as the top-frame origin. Nulo then auto-approves or creates the dApp session keyed by that misattributed origin, and later dispatches wallet RPCs with `ctx.origin = session.origin`, so downstream capability and session checks all execute as the top-level site.

**Evidence**: The manifest injects the content script into `*://*/*` with `all_frames: true` at `document_start` (`manifest.config.ts:31-37`). The content script accepts discovery from any same-window page script and forwards it untouched (`content_script_connection_handler.js:60-86`). The background handler reads `sender.tab?.url` into `tabOrigin` and ignores the frame URL even though `MessageSender.url` is explicitly defined as the iframe URL when the sender is in an iframe (`background_connection_handler.js:51-60`, `runtime.d.ts:161-178`). Nulo then auto-approves by `origin + chainId` (`dapp-session/service.ts:73-99`, `background.ts:373-380`) and forwards `session.origin` into the dispatcher context (`background.ts:516-520`).

**Root cause**: Trust is bound to the tab, not the frame. The integration discards `sender.url` and `sender.frameId`, so a subframe becomes a confused deputy for the top frame’s origin and stored authorization state.

**Recommended fix**: Capture `sender.url` and `sender.frameId` at discovery time, derive the trusted origin from `sender.url`, and key pending/active sessions by `(tabId, frameId, origin, chainId)` rather than `(tabId, origin, chainId)`. All background-to-content-script replies should target the original `frameId`, and frame lifecycle events should terminate sessions when that specific frame navigates or disappears.

**Notes**: The verify-popup step does not mitigate this. The attacker controls one endpoint of the real ECDH exchange, so the emoji hash still matches; the user is only misled about which origin they are verifying.

### C2-F2 — Tab-wide broadcast lets sibling frames hijack or kill another frame’s session

**Severity**: High

**CWE**: CWE-668 (Exposure of Resource to Wrong Sphere)

**Affected code**: `packages/extension/src/wallet/services/wallet-sdk/background.ts:118-135`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:106-121`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:133-166`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:183-221`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js:34-52`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js:88-156`, `node_modules/@types/webextension-polyfill/namespaces/tabs.d.ts:520-526`

**Impact**: Any sibling frame in the same tab can receive discovery approval for another frame, obtain its own `MessagePort`, and either race the first key exchange to take over the session or send `DISCONNECT` to tear the victim session down. This breaks frame isolation even if origin attribution is fixed.

**Exploitability**: The attacker only needs script execution in another frame in the same tab. The victim frame can be top-level or another iframe.

**Attack prerequisites**: Some frame in the tab reaches the “approved discovery” state. That can be the victim’s own discovery flow or the attacker’s discovery flow.

**Attack path**: The background integration calls `chrome.tabs.sendMessage(tabId, message)` without a `frameId`. The local type docs state that omitting `frameId` sends to all frames in the tab. Every injected content-script instance blindly accepts `DISCOVERY_APPROVED`, creates a new `MessageChannel`, and posts a `DISCOVERY_RESPONSE` into its own frame window even if that frame never initiated discovery. A malicious sibling frame can then send `KEY_EXCHANGE_REQUEST` on its unsolicited port before the legitimate frame does; the background handler accepts the first request while `discovery.status === "approved"` and deletes the pending discovery after success. The same unsolicited port can always send `DISCONNECT`, which the background honors by session ID alone.

**Evidence**: Nulo wires `sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message)` with no `frameId` (`background.ts:118-135`). The bundled WebExtension types document that `frameId` is the option used to target a specific frame “instead of all frames in the tab” (`tabs.d.ts:520-526`). The upstream content-script handler accepts every background message with `origin === "background"` and, on `DISCOVERY_APPROVED`, creates and stores a port plus posts `DISCOVERY_RESPONSE` back into the page (`content_script_connection_handler.js:34-52`, `content_script_connection_handler.js:88-132`). It forwards `KEY_EXCHANGE_REQUEST`, `DISCONNECT`, and all other port traffic back to the service worker under the approved `sessionId` (`content_script_connection_handler.js:94-120`). The background handler accepts the first key exchange while the discovery is approved and deletes that pending record after success (`background_connection_handler.js:133-166`), and it honors `DISCONNECT_REQUEST` by session ID (`background_connection_handler.js:68-71`, `background_connection_handler.js:200-221`).

**Root cause**: The transport is tab-scoped, but the security boundary is frame-scoped. Background replies are broadcast to every content script in the tab, and content scripts do not correlate approvals to a locally pending request before minting a page-visible `MessagePort`.

**Recommended fix**: Target all `sendMessage` calls to the original `frameId`; reject unsolicited `DISCOVERY_APPROVED` / `KEY_EXCHANGE_RESPONSE` messages in the content script unless the frame has a matching locally pending request; and bind disconnect / encrypted traffic to the frame that completed key exchange. A per-frame runtime `Port` or an explicit frame-bound nonce would also remove the ambient broadcast channel.

**Notes**: This bug also amplifies C2-F1. Once a malicious iframe is misattributed as the top origin, tab-wide broadcast gives it the approved channel material it needs to win the race.

### C2-F3 — Discovery response leaks the extension runtime URL to page scripts

**Severity**: Low

**CWE**: CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor)

**Affected code**: `packages/extension/src/wallet/services/wallet-sdk/background.ts:112-116`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:85-91`, `node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js:124-131`, `packages/extension/manifest/manifest.config.ts:56-60`

**Impact**: Approved pages learn `chrome-extension://<id>/src/assets/logo.png`, which reveals the stable extension ID and gives the page a durable installation-specific identifier beyond the protocol’s logical `walletId = "nulo"`.

**Exploitability**: Low. The attacker must first reach discovery approval or exploit a silent returning-session path.

**Attack prerequisites**: The page receives a `DISCOVERY_RESPONSE`.

**Attack path**: Nulo sets `walletIcon` to `chrome.runtime.getURL("/src/assets/logo.png")`, the upstream background handler returns that icon in `walletInfo`, and the content script posts that `walletInfo` into the page via `window.postMessage`. The page can parse the extension ID directly from the icon URL.

**Evidence**: The wallet-sdk config passes `walletIcon: chrome.runtime.getURL("/src/assets/logo.png")` (`background.ts:112-116`). `getWalletInfo()` returns that icon field to the discovery response (`background_connection_handler.js:85-91`, `background_connection_handler.js:116-121`). The content script posts the `DISCOVERY_RESPONSE` with `walletInfo` into the page window (`content_script_connection_handler.js:124-131`). The same icon file is marked web-accessible for all origins (`manifest.config.ts:56-60`).

**Root cause**: Page-visible metadata reuses a Chrome runtime URL rather than a neutral asset reference, so the extension host identifier crosses the trust boundary unnecessarily.

**Recommended fix**: Replace the page-visible icon field with a neutral HTTPS URL or an inline data URL. If the runtime URL must remain, treat the extension-ID leak as an explicit protocol tradeoff and document it.

**Notes**: I did not find a corresponding `window.postMessage` leak of the verification hash or other public-key fingerprint. Those appear only after key exchange on the `MessagePort` path.

## Non-findings

- I found no repo-level externally-connectable page → service-worker surface. The manifest has no `externally_connectable` entry, and the implemented web-page ingress is the injected content script relay (`packages/extension/manifest/manifest.config.ts:14-62`, `packages/extension/src/content-script/content.ts:11-22`).

- The content script does not forward arbitrary `window.postMessage` traffic into the service worker. On the plain window channel it only accepts `aztec-wallet-discovery`; key exchange and encrypted RPC traffic only flow after approval over the `MessageChannel` (`content_script_connection_handler.js:60-75`, `content_script_connection_handler.js:88-132`).

- `origin: "content-script"` is not a real security boundary by itself, and the validator says so explicitly. In this codebase the page does not set that runtime envelope directly; the content script wrapper sets it around discovery / port traffic. The exploitable failures are frame and origin misbinding, not the existence of that string flag (`content-script-validator.ts:11-22`, `content-script-validator.ts:72-88`).

- Replaying a previously seen wallet public key from another origin does not recover a session key. The wallet generates a fresh P-256 keypair for each key exchange, and `deriveSessionKeys` binds both parties’ public keys into the HKDF salt before deriving the AES/HMAC material (`background_connection_handler.js:139-166`, `crypto.js:210-260`).

- The `registerToken` schema patch is fail-closed, not fail-open. `background.ts` imports `./nulo-schema-patch` before initializing the handler, the patch throws on signature drift, and `runtime.ts` statically imports the handler module. A patch failure aborts startup instead of silently falling back to upstream routing (`packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts:25-55`, `packages/extension/src/wallet/runtime.ts:45-46`).

- `document_start` + `all_frames` does create an active probing surface for wallet-presence fingerprinting, but I did not find a passive ready signal emitted at load. Observable behavior still requires a page to initiate discovery or exploit one of the frame-binding flaws above (`packages/extension/manifest/manifest.config.ts:31-37`, `content_script_connection_handler.js:55-79`).
