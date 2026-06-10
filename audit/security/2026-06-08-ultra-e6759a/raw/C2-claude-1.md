# C2 — Content-script + wallet-sdk handler (Claude Opus Pass 1)

## Cluster scope

The OUTERMOST trust boundary: untrusted web pages → content script (`document_start`, `all_frames: true`) → service worker (`BackgroundConnectionHandler`). Files:

- `packages/extension/src/content-script/content.ts` — 22-line relay using upstream `ContentScriptConnectionHandler`.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — `initWalletSdkHandler`, discovery + session lifecycle, FIFO baton, queued-journal.
- `packages/extension/src/wallet/services/wallet-sdk/content-script-validator.ts` — zod envelope filter at the SW seam.
- `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts` — runtime patch of `WalletSchema.registerToken`.
- `packages/extension/src/wallet/services/wallet-sdk/error-envelope.ts` — EIP-1193 error mapping.
- `packages/extension/src/wallet/services/wallet-sdk/queued-journal.ts` — best-effort queued journal record on message arrival.
- `packages/extension/src/wallet/services/wallet-sdk/session-baton.ts` — per-session FIFO baton primitive.

Upstream dependencies (read for context, NOT in cluster scope):
- `node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js`
- `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js`
- `node_modules/@aztec/wallet-sdk/dest/crypto.js`

---

## Findings

### Finding 1 — `all_frames: true` content-script injection combined with upstream origin attribution to `sender.tab.url` lets a third-party iframe establish a wallet session that the user attributes to the top-frame origin (confused-deputy on the wallet-discovery trust anchor)

**Title**: A malicious iframe embedded in a user-trusted top-frame (e.g. `evil.com` iframed in `nulo.sh`, or in any site that user-content-embeds — Substack, Notion-embed, GitHub-pages user pages, etc.) can initiate a wallet discovery + session that the SW credits to the top-frame origin, because the upstream `BackgroundConnectionHandler` derives the session `origin` from `sender.tab.url` (top frame URL) instead of `sender.url` (frame URL). The Nulo extension manifest enables this attack by injecting the content script `all_frames: true` (every frame becomes a candidate wallet client), and the local `initWalletSdkHandler` does not add any defense-in-depth `sender.frameId !== 0` filter at the SW seam.

**Impact factors**:
- CIA+A: **Authorization**. The session created from the iframe is permanently keyed `(top-frame origin, chainId, profileId)`. The legit top-frame script (which the user intended to grant access to) ALSO matches this session and can use the wallet — but more importantly, the iframe shares the same session because both have `sender.tab.url` of the top frame. The iframe has wallet authority the user never granted.
- Blast radius: every wallet user who visits any site that embeds third-party iframes from origins the user does NOT independently trust — and that includes nearly every modern website (analytics widgets, ads, embedded social-media widgets, OAuth iframes, embedded checkouts). Because the discovery flow includes a user-visible popup showing the TOP-FRAME hostname, the user has no signal that the iframe (not the top frame) initiated the request. Many users would Allow when a known top frame "asks to connect."
- Exploitability: AV:Network / AC:Low (need iframe permission on victim site; for ad slots / Substack-embed / Notion-embed / GitHub-pages this is trivial) / PR:None / UI:Required (one-time approval). Persistence: after the iframe causes the user to approve, all subsequent discoveries on the same top-frame auto-approve via `existingSession` lookup. The iframe also gains wallet access via the same session; the user-trusted top-frame inherits the same session.

**Evidence confidence**: **high** — concrete trace through upstream's source-of-truth, manifest config, and local consumer.

**OWASP / CWE mapping**: A01:2021 Broken Access Control — **CWE-862** (Missing Authorization), **CWE-441** (Unintended Proxy or Intermediary), **CWE-345** (Insufficient Verification of Data Authenticity), **CWE-346** (Origin Validation Error). Also classic confused-deputy.

**Trace** (source → sink):
1. Source: manifest at `packages/extension/manifest/manifest.config.ts:33` declares `all_frames: true` for `content_scripts[0]`. Chrome injects `src/content-script/content.ts` into every frame matching `*://*/*`.
2. `packages/extension/src/content-script/content.ts:11-22` constructs `ContentScriptConnectionHandler` and calls `handler.start()`. The handler's `pageMessageHandler` listens on `window.addEventListener('message', ...)` (upstream `content_script_connection_handler.js:60-76`) and accepts ANY message where `event.source === window`. Each frame's content script binds to ITS own window, so an iframe's content script listens for messages posted by the iframe's own document.
3. The iframe's dApp script calls `window.postMessage(JSON.stringify({type: "aztec-wallet-discovery", requestId, appId, chainInfo}), '*')`. The iframe's content script receives it via `event.source === window` (same-window check passes — `window` here is the iframe's window).
4. The iframe's content script forwards via `chrome.runtime.sendMessage({origin: "content-script", type: "discovery-request", content: { requestId, appId, chainInfo }})` (`content_script_connection_handler.js:82-86`). Chrome attaches a `MessageSender` containing both `sender.url` (= iframe origin) and `sender.tab.url` (= top-frame URL in the address bar).
5. The SW's listener at `packages/extension/src/wallet/services/wallet-sdk/background.ts:121-135` runs `validateContentScriptMessage(message)` → valid (envelope matches schema). Forwards to the upstream `BackgroundConnectionHandler.handleMessage` listener.
6. Upstream `handleMessage` at `node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:187-188`:
   ```ts
   const tabId = sender.tab?.id;
   const tabOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : 'unknown';
   ```
   **The upstream takes the TOP-FRAME origin** (`sender.tab.url`), NOT the iframe's URL (`sender.url`). Stores in `PendingDiscovery.origin`.
7. Sink: our `onPendingDiscovery` callback at `background.ts:139-151` → `handleDiscovery(...)` at `background.ts:351-480`:
   - Builds `params.dappMetadata.url = discovery.origin` (top-frame origin).
   - Opens discover popup via `dappInteractionService.discover(params, ...)`.
   - User sees the TOP-FRAME hostname as the trust anchor (UI at `packages/extension/src/components/composite/DappIdentityBlock.vue:37` renders `hostname` from `new URL(dapp.url).hostname`).
   - On approve, `dappSessionService.addDappSession(params.dappMetadata, ...)` persists the session keyed on top-frame origin (`background.ts:452-458`).
   - `handler.approveDiscovery(...)` sends `DISCOVERY_APPROVED` to the tab — Chrome's `chrome.tabs.sendMessage(tabId, ...)` broadcasts to all frames, but only the iframe's `ContentScriptConnectionHandler` has the `requestId` in its `ports` map and acts on it.
   - ECDH key exchange completes inside the iframe's MessageChannel. `onSessionEstablished` records `session.origin === topFrameOrigin`. Encrypted channel is between the iframe and the SW, both believing they are talking to "the top-frame origin."

**Missing control**: 
The wallet-sdk upstream sets `tabOrigin = new URL(sender.tab.url).origin` (top frame URL) instead of `sender.url` (frame URL). Either:
- (a) The Nulo content-script bridge should refuse to relay when `window !== window.top` (drop discovery requests from iframes entirely at the content-script layer), OR
- (b) The SW seam (`background.ts:119-136`) should inspect `sender.frameId !== 0` and reject content-script messages from sub-frames, OR
- (c) The manifest should declare `all_frames: false` (cleanest mitigation; loses subframe-dApp support, which is rarely used and easy to revert if needed). 

Even if upstream wallet-sdk is fixed, defense-in-depth at the local seam is warranted because the manifest decision (`all_frames: true`) is what enables Chrome to inject the script into iframes in the first place.

**Exploit story**:
1. User visits any web property `https://news-site.example` that includes a third-party iframe at `https://evil-ad-network.example/ad-slot`. The user does NOT visually see the iframe URL — the address bar shows `news-site.example`.
2. The iframe's JS calls `ExtensionProvider.discoverWallets({ chainId, version }, { appId: "Nulo Wallet Official" })` (or a raw `window.postMessage`).
3. The iframe's content script forwards the discovery to the SW. The SW (via upstream) sees `sender.tab.url === news-site.example/...` and creates a discovery request with `origin = "https://news-site.example"`.
4. Our `handleDiscovery` opens a popup showing "https://news-site.example wants to connect to your wallet. Allow / Deny."
5. The user, recognizing `news-site.example`, clicks Allow.
6. The session is persisted: `{ profileId, chainId, origin: "news-site.example", trustedVerification: false, accounts: [] }`.
7. The iframe (NOT the user-visible news site) now has the secure-channel MessagePort. It immediately calls `requestCapabilities({ accounts: { canGet: true, accounts: ALL_AUTHORIZED } })` (or the user's grant of capabilities); user approves (popup shows `news-site.example`).
8. Iframe now calls `getAccounts()` (or `simulateTx`, `sendTx`, etc.) under the user-granted session.
9. The legit `news-site.example` top-frame ALSO matches this session — if it tries to open its own wallet connection, it auto-approves via `existingSession` lookup at `background.ts:376-381`.
10. Persistence: session valid for 7 days (`dapp-session/service.ts:131`). The iframe can return on subsequent loads, find the auto-approved session, and continue exfiltrating.

**Preconditions**:
- Victim user visits a site with a malicious third-party iframe. (Common: ad networks, embedded comments / chat widgets, OAuth iframes, embedded analytics. Sites where users routinely upload arbitrary HTML — Substack, GitHub pages, Notion embed — make this trivial for the attacker.)
- Iframe is sourced from a different origin (does NOT need to be on the same Aztec-using site).

**Why mitigations fail**:
- The discover popup shows the top-frame hostname (the user-visible site in the address bar), which is exactly what the user expects to see, so the trust anchor LOOKS correct.
- The `useDappHostname` composable computes `hostname` from `dapp.url` (the top-frame URL provided by the SW). There is no information channel surfacing "this came from an iframe."
- The `useDappHostname.isSuspicious` heuristic only checks for non-ASCII and `xn--` (punycode IDN homographs). It does not check whether the request came from a frame.
- `chrome.tabs.onUpdated` (`background.ts:314-333`) only fires on TOP-FRAME navigation. If the iframe loads a different malicious page later (without the top frame navigating), the session persists.
- `chrome.tabs.onRemoved` (`background.ts:306-308`) only fires on tab close. Iframe document destruction does not fire this.
- Upstream's `terminateSession` (lines 200-222 of upstream handler) explicitly restores the discovery to "approved" so the dApp can retry key exchange — meaning even if the SW terminates the session, the iframe can re-establish without a fresh user approval.
- The `pendingDiscoveryPromises` dedupe at `background.ts:393-420` keys on `(origin, chainId)` — both the legit top frame and the malicious iframe map to the same tuple, so the second discovery is auto-approved against the iframe's outcome.

**Instances**:
- `packages/extension/manifest/manifest.config.ts:31-38` — manifest declares `all_frames: true`.
- `packages/extension/src/content-script/content.ts:11-22` — content script attaches the handler unconditionally regardless of frame.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:119-136` — SW seam forwards to upstream without reading `sender.frameId`.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:139-151` — `onPendingDiscovery` callback trusts the upstream `discovery.origin`.
- `node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:187-188` — upstream uses `sender.tab.url` to derive origin (out-of-cluster but load-bearing for the local defect to be exploitable).

---

### Finding 2 — Discovery popup shows attacker-controlled `appId` as the dApp's "name" alongside the trusted hostname, providing a phishing surface for users who glance at the name field instead of the hostname

**Title**: The popup's `DappIdentityBlock` displays the dApp-controlled `appId` string (relayed via `discovery.appId` from `window.postMessage`) as the dApp's "name" label, with no length cap, no Unicode normalization, no BIDI / RTL-override filter. While the hostname displayed alongside is the trusted top-frame origin, the unbounded `name` line enables a phishing message that capitalizes on user-trust-by-name rather than user-trust-by-domain.

**Impact factors**:
- CIA+A: **Authorization** (user is socially engineered into approving a session under a misleading identity).
- Blast radius: every user who runs through the discovery popup at least once.
- Exploitability: AV:Network / AC:Low (the attacker just sets `appId: "Nulo Wallet Official\n\nThis dialog is from Nulo. Click Allow to verify."`) / PR:None / UI:Required.

**Evidence confidence**: **high** — direct trace, value flows from `window.postMessage` to Vue interpolation.

**OWASP / CWE mapping**: A07:2021 Identification and Authentication Failures — **CWE-1021** (Improper Restriction of Rendered UI Layers or Frames — UI deception subclass), **CWE-451** (User Interface Misrepresentation of Critical Information).

**Trace** (source → sink):
1. Source: dApp calls `window.postMessage(JSON.stringify({ type: "aztec-wallet-discovery", requestId, appId: <ATTACKER_CONTROLLED>, chainInfo }), '*')`.
2. Content script forwards to SW via `chrome.runtime.sendMessage`.
3. Upstream `handleDiscoveryRequest` (`background_connection_handler.ts:228-241`) sets `discovery.appId = request.appId` with no validation.
4. `background.ts:425` builds `params.dappMetadata.name = discovery.appName ?? discovery.appId`. Note: `discovery.appName` is **always `undefined`** because the upstream wire protocol `DiscoveryRequest` (`node_modules/@aztec/wallet-sdk/src/types.ts:96-103`) does NOT carry `appName` — the upstream `PendingDiscovery.appName?` field type is declared but never populated. Consequently `name` is ALWAYS `discovery.appId`.
5. `dappInteractionService.discover(params, ...)` → popup pulls `params.dappMetadata` via `getInteractionPayload(...)` (`packages/extension/src/popup/windows/discover/index.vue:48-58`).
6. Sink: Vue template at `packages/extension/src/components/composite/DappIdentityBlock.vue:47`:
   ```vue
   <span v-if="dapp?.name" :data-testid="nameTestId" :class="$style.dapp_name">{{ dapp.name }}</span>
   ```
   Vue's `{{ }}` interpolation HTML-escapes, so the literal text is shown. But there is no length cap, no homograph filter, no BIDI / RTL-override (U+202E etc.) filter.

**Missing control**:
- Length cap on `appId` at the SW seam (e.g. `>= 64` rejects the envelope).
- Strip / detect RTL-override, zero-width characters, BIDI controls (U+202A-U+202E, U+2066-U+2069, U+200B-U+200F).
- Either ONLY show the dApp-controlled name in a clearly-flagged "Self-declared name (untrusted)" frame, OR hide it entirely from the trust-anchor surface.

**Exploit story**:
1. Attacker registers a domain `nulo-vault.example` (not the user's wallet domain) or a typosquat.
2. dApp sends `appId: "Nulo Wallet — Trusted Connection\nVerified by Aztec"`. Newlines, hyphens, emoji-prefix all render naturally because there's no sanitization.
3. User opens the page. Discovery popup shows hostname `nulo-vault.example` (small font, monospace per `DappIdentityBlock.vue` styles — `font-mono`, `font-size: 11px`) AND the name "Nulo Wallet — Trusted Connection\nVerified by Aztec" (also styled but with `text-overflow: ellipsis` truncating the second line).
4. User skims the popup, sees "Nulo Wallet — Trusted Connection," reads `wants to connect to your wallet` action line, clicks Allow.
5. Session is persisted; the malicious dApp now has wallet access.

**Preconditions**:
- User visits the attacker's page (or a page that embeds the attacker via Finding 1's iframe path).
- User has not previously connected to the attacker's origin (otherwise auto-approve, no popup).

**Why mitigations fail**:
- The hostname display IS the trust anchor and is correctly attributed (font-headline, bold, larger). But user-research consistently shows users skim names over URLs.
- `useDappHostname.isSuspicious` does NOT cover dApp-controlled `name` — only the hostname.
- The popup shows the verb "wants to connect to your wallet" — the user's mental model is "this name is what's asking" rather than "this hostname is what's asking."
- No e2e or unit test exercises the `appId` field with adversarial inputs (homograph, RTL, zero-width, length overflow). Tests at `packages/extension/src/wallet/services/wallet-sdk/content-script-validator.test.ts:21-31` use the benign string `"test"`.

**Instances**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:425` — `name = discovery.appName ?? discovery.appId` (always falls back to attacker-controlled `appId` because `appName` is wire-protocol-absent).
- `packages/extension/src/components/composite/DappIdentityBlock.vue:47` — renders the unsanitized name in the trust-anchor block.
- `packages/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:46-54` — schema validates envelope shape only; `content` is `z.unknown()`.

---

### Finding 3 — Walletside `chainInfo` integer-conversion via `Number(BigInt(...))` followed by `>>> 0` 32-bit XOR truncation can collide distinct chainIds, allowing a malicious dApp to auto-approve a fake-chain discovery against a legit-chain session for the SAME origin (low-severity confused-chain)

**Title**: `chainInfoToChainId(obj)` at `background.ts:630-635` and at the inlined copy in `queued-journal.ts:48-53` reduces `(chainId XOR version)` modulo 2^32. dApp-controlled large chainIds collide with small chainIds at the truncation boundary. The lookup key `String((chainId ^ version) >>> 0)` is then used to find an existing session for auto-approve. This lets a single dApp open a "fake chain" discovery that finds a session for a different chainId it previously created — same-origin lateral movement across chains.

**Impact factors**:
- CIA+A: **Authorization**, **Integrity** of chain-scoping invariant (AUDIT plan A12).
- Blast radius: scoped to a single attacker-controlled dApp; cross-origin collision is blocked by the origin component of the session key.
- Exploitability: AV:Network / AC:High (requires understanding the XOR truncation; requires the user to have approved at least one session on a chain the attacker also chose). Low-impact: same-dApp lateral movement only.

**Evidence confidence**: **moderate** — function math is verifiable; whether the upstream `chainInfo` is constrained to a smaller numeric range elsewhere is unclear from the audit scope.

**OWASP / CWE mapping**: **CWE-190** (Integer Overflow / Wraparound), **CWE-697** (Incorrect Comparison).

**Trace** (source → sink):
1. dApp posts discovery with `chainInfo.chainId = "0x100000001"` (= 2^32 + 1) and `chainInfo.version = "0x100000001"`.
2. `chainInfoToChainId` runs `Number(BigInt(hex))` → 4294967297. `(4294967297 ^ 4294967297) >>> 0` → `0`.
3. The previously-approved session has `chainInfo.chainId = "0x1", version = "0x1"` → XOR = `0`.
4. `dappSessionService.tryGetDappSessionByOriginAndChain(origin, "0")` finds the legit session. `handler.approveDiscovery(...)` fires auto-approval.
5. The malicious dApp now operates over the legit session's encrypted channel under a different chain label internally.

**Missing control**: 
- Reject `chainId` or `version` values that don't fit in 32 bits (or 53-bit safe integer) at the validator. Compare BigInts directly for the equality lookup instead of truncating to a 32-bit number.

**Exploit story**:
1. dApp opens a fresh session on chain `(1,1)` → XOR=0. User approves and grants `transaction` capability scoped to chain 0.
2. dApp opens a discovery on chain `(2^32+1, 2^32+1)` → same XOR=0 key. Auto-approve.
3. From the dApp's perspective, the on-chain side now believes the session is "for chain 2^32+1," and the wallet's persisted `chainId` field stores `"0"`. Mismatch the dApp could exploit if it relies on chain ID for downstream operations (e.g. a downstream proxy that branches on `chainInfo.chainId`).

**Preconditions**: same-origin, same-profile, attacker has already established one session.

**Why mitigations fail**:
- `dappSessionService.tryGetDappSessionByOriginAndChain` filters `x.chainId === chainId`, both strings — but both strings come from the same truncated computation.
- The XOR truncation is by design (`NetworkService convention: chainId = l1ChainId ^ rollupVersion`), but the cap is implicit (network IDs in practice are small). The validation gap is at the SW seam.

**Instances**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:630-635` — `chainInfoToChainId`.
- `packages/extension/src/wallet/services/wallet-sdk/queued-journal.ts:48-53` — duplicated copy of the same function.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:371-376` — auto-approve lookup uses the truncated key.

---

### Finding 4 — Wallet `walletIcon` URL (containing the extension's stable ID) is posted to the page via `window.postMessage(..., '*')` on every approved discovery, providing a deterministic fingerprint signal that the Nulo extension is installed (intentional disclosure but worth documenting)

**Title**: After discovery approval, the upstream `ContentScriptConnectionHandler.handleDiscoveryApproved` posts the wallet's `walletInfo` (containing `icon: chrome-extension://<EXTENSION_ID>/src/assets/logo.png`) to `window.postMessage(JSON.stringify(response), '*', [channel.port2])`. The `'*'` target origin means ANY origin in the same window can read the message (e.g., the parent of an iframe whose dApp got auto-approved). Once a session exists, the wallet auto-approves and reveals the extension ID. This enables persistent cross-origin fingerprinting (the extension ID is stable across all browsers and all users running Nulo — public extension ID at the Chrome Web Store level).

**Impact factors**:
- CIA+A: **Confidentiality** (low — extension ID is public for store-installed wallets).
- Blast radius: every user who has any approved dApp session.
- Exploitability: AV:Network / AC:Low / PR:None / UI:None. The extension ID is recoverable from any page that has been auto-approved.

**Evidence confidence**: **high** — direct source observation.

**OWASP / CWE mapping**: **CWE-201** (Insertion of Sensitive Information into Sent Data), **CWE-1029** (Insufficient Authentication / not directly applicable but adjacent — fingerprinting class).

**Trace** (source → sink):
1. `packages/extension/src/wallet/services/wallet-sdk/background.ts:115` sets `walletIcon: chrome.runtime.getURL("/src/assets/logo.png")` → URL becomes `chrome-extension://<ID>/src/assets/logo.png`.
2. `BackgroundConnectionHandler.getWalletInfo()` returns `{ id, name, version, icon }` (upstream `background_connection_handler.ts:218-225`).
3. `approveDiscovery(...)` sends `DISCOVERY_APPROVED` content (= walletInfo) to the tab.
4. Content script's `handleDiscoveryApproved` (upstream `content_script_connection_handler.js:88-132`) calls `window.postMessage(JSON.stringify(response), '*', [channel.port2])`. Note: the response contains the full walletInfo including the extension ID in the icon URL.

**Missing control**:
- Either ship the icon as a fetch-on-demand `web_accessible_resource` data URL OR strip the icon from the discovery response. The walletInfo only needs to populate the dApp's wallet-selection UI — a generic name is sufficient.
- Alternatively, pass a random per-session blob URL that doesn't reveal the extension ID.

**Exploit story**:
1. User has Nulo installed, has approved any dApp session.
2. Any third-party iframe (per Finding 1) or any same-origin script on a domain the user has connected to dispatches a discovery request.
3. Auto-approve path fires; `walletInfo.icon` is posted to the page.
4. Analytics / fingerprinting library captures the extension ID, sends to telemetry.
5. The user is now uniquely associated with "Nulo wallet user" across all visits.

**Preconditions**: user has approved at least one session, OR the user clicks Allow on any new dApp's discovery popup.

**Why mitigations fail**:
- `web_accessible_resources` in the manifest (`manifest.config.ts:56-61`) only constrains which extension resources pages can REQUEST — the icon URL itself is sent to the page via the discovery response.
- The icon is rendered by the wallet-sdk's reference dApp (e.g. wallet-selection UI), so simply omitting it breaks UX.

**Instances**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:115` — icon URL contains extension ID.
- Upstream `node_modules/@aztec/wallet-sdk/dest/extension/handlers/content_script_connection_handler.js:129` — `window.postMessage(..., '*')` to ANY origin (effectively cross-origin readable in the iframe-confused case).

---

### Finding 5 — Approve-then-key-exchange-skip: a malicious page that triggers `approveDiscovery` (forcing the user through Allow) but never sends the `KEY_EXCHANGE_REQUEST` leaks `pendingVerification` Set entries indefinitely until the SW restarts (low-severity unbounded local-memory growth)

**Title**: `pendingVerification: Set<string>` at `background.ts:84` accumulates `${origin}|${chainId}` entries on every approved discovery (`background.ts:464`) and only removes them in `onSessionEstablished` after key exchange completes (`background.ts:166-168`). A dApp that triggers user-approved discovery but never sends `KEY_EXCHANGE_REQUEST` (or whose key exchange fails) leaks the entry permanently. Combined with Finding 1's iframe trick or simply many distinct origins, the Set can grow unbounded until the SW restarts (which happens every ~30s when idle on MV3, but can be kept alive by other dApps).

**Impact factors**:
- CIA+A: **Availability**. Low-impact memory pressure on the SW. SW lifecycle (~30s idle) limits practical impact.
- Blast radius: SW memory only.
- Exploitability: AV:Network / AC:Low.

**Evidence confidence**: **high**.

**OWASP / CWE mapping**: **CWE-401** (Missing Release of Memory after Effective Lifetime).

**Trace** (source → sink):
1. dApp triggers discovery, user approves. `background.ts:464` runs `pendingVerification.add(dedupeKey)`.
2. dApp's content script does not call `establishSecureChannel()` (i.e. does not post a `KEY_EXCHANGE_REQUEST` over the MessagePort).
3. `onSessionEstablished` never fires; the Set entry is never removed.
4. After many distinct origins approve, the Set grows. With ~64 byte entries (origin string + chainId + Set overhead), 10000 entries = ~640KB. SW memory growth.

**Missing control**:
- Pair `pendingVerification.add(...)` with a timeout that removes the entry after, say, 60s if no key exchange completes.
- Or: derive the "needs verification" decision from the persisted `dappSession.trustedVerification` flag alone, removing the in-memory Set entirely.

**Instances**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:84` — declaration.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:464` — add.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:167-168` — remove (only fires on successful key exchange).

---

### Finding 6 — Validator-bypassed content-script types: if the upstream `InternalMessageType` enum gains a new content-script→background message type, the local validator at `content-script-validator.ts:44` silently drops it (availability impact, not security — but the test suite does NOT catch the drift)

**Title**: `content-script-validator.ts:44` declares:
```ts
const CONTENT_SCRIPT_MESSAGE_TYPES = ["discovery-request", "key-exchange-request", "secure-message", "disconnect-request"] as const
```
This is a hand-mirrored copy of upstream's `InternalMessageType` enum (`node_modules/@aztec/wallet-sdk/dest/extension/handlers/internal_message_types.js:6-10`). If upstream adds a new content-script→background type (e.g. `"capability-request"`), the validator silently rejects it ("schema check failed"), the upstream listener never receives it, and the new type is unusable in Nulo without a paired update. The validator's docstring acknowledges this:
> "If the upstream enum gains a new content-script→background message type, extend this set."
But no automated drift detection exists.

**Impact factors**:
- CIA+A: **Availability** only. No security impact (defense fails closed).
- Blast radius: future upstream bumps.
- Exploitability: not adversarial — this is a maintainability defect.

**Evidence confidence**: **high**.

**OWASP / CWE mapping**: **CWE-829** (Inclusion of Functionality from Untrusted Control Sphere — adjacent, more accurately a drift-management gap).

**Missing control**:
- Add a build-time or test-time assertion that imports the upstream `InternalMessageType` and compares its content-script-subset with the validator's allow-list.

**Instances**:
- `packages/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:44`.

---

### Finding 7 — SW cold-boot listener-registration race: messages delivered to the SW BEFORE `handler.initialize()` registers `chrome.runtime.onMessage` are silently dropped (availability — low-severity, dApp can retry within discovery timeout)

**Title**: The SW boot path (`packages/extension/src/wallet/index.ts:71-83` → `runtime.start()` → async awaits → `initWalletSdkHandler(...)` → `handler.initialize()` at `background.ts:335`) registers the content-script-message listener only AFTER `await Promise.all([config.load(), BarretenbergSync.initSingleton(...)])` and `await runStorageMigration(...)` and `await services.start()`. Top-level `chrome.runtime.onMessage` listeners (`index.ts:35`) handle only `nulo:open-toolbar-popup` and return `false` for everything else. A content-script `discovery-request` that wakes the SW during cold boot fires the top-level listener (which ignores it) before the SW's deeper init runs. The message is then dropped.

**Impact factors**:
- CIA+A: **Availability** only.
- Blast radius: bounded by SW boot duration (typically 100-2000ms).
- Exploitability: not adversarial.

**Evidence confidence**: **moderate** — depends on Chrome's exact `chrome.runtime.onMessage` dispatch semantics during SW wake (verified by reasoning over the listener registration order, not by chromium source citation).

**OWASP / CWE mapping**: **CWE-364** (Signal Handler Race Condition — adjacent), **CWE-697** (Incorrect Comparison — also adjacent). Most accurately: an availability bug, not a security bug.

**Missing control**:
- Register `chrome.runtime.onMessage` at the top level (synchronously) and buffer messages until the deeper listener is wired.
- OR: bake the wallet-sdk handler initialization into the top-level synchronous boot path (move it ahead of `services.start()` and pass services lazily).

**Instances**:
- `packages/extension/src/wallet/index.ts:71-83` — async boot.
- `packages/extension/src/wallet/runtime.ts:94-170` — multi-await chain before `initWalletSdkHandler`.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:335` — late listener registration.

---

### Finding 8 — `chrome.tabs.onUpdated` URL parse failure terminates ALL sessions for the tab via `terminateForTab` fallback, including `about:blank` / `chrome://newtab` transit (low-severity availability, SPA users may experience session drops)

**Title**: The tab-update listener at `background.ts:314-333`:
```ts
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    try {
      const newOrigin = new URL(changeInfo.url).origin
      ...
    } catch {
      handler.terminateForTab(tabId)
    }
  }
})
```
If `changeInfo.url` is `"about:blank"`, `"chrome://newtab"`, `"javascript:"`, or any non-URL parseable string, the `catch` block calls `terminateForTab(tabId)`. SPA navigation transiting through `about:blank` (rare but happens) would kill all sessions in the tab. Defense in depth is good, but the failure mode is overly aggressive: an unparseable URL doesn't necessarily mean a malicious cross-origin navigation.

**Impact factors**:
- CIA+A: **Availability** only.
- Blast radius: per-tab.
- Exploitability: not adversarial.

**Evidence confidence**: **moderate**.

**OWASP / CWE mapping**: not strictly a CWE; an over-reactive teardown.

**Missing control**:
- Inspect `changeInfo.url` for the special protocols and ignore them (return without terminating).
- Or: only terminate when `new URL(...)` succeeds AND `newOrigin !== session.origin`.

**Instances**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:328-331`.

---

### Finding 9 — Sessions per-`(origin, chainId)` lookup uses `dappMetadata.url === origin` strict equality, but `discovery.origin` (server-derived from `sender.tab.url`) is the trusted source — verified non-finding, documented as such

**Title**: `tryGetDappSessionByOriginAndChain` at `dapp-session/service.ts` filters `x.dappMetadata.url === origin`. Both sides flow from the same `tabOrigin = new URL(sender.tab.url).origin` derivation. No mismatch is possible UNLESS the persisted `dappMetadata.url` is overwritten by a later code path that reads dApp-supplied data. Verified: only `background.ts:425-427` populates `dappMetadata.url`, and the value is `discovery.origin` (SW-trusted).

**Verdict**: **NON-FINDING**. Documented for cross-rebuttal completeness.

---

## Non-findings (excluded after analysis)

- **Malicious page calls `chrome.runtime.sendMessage` directly to spoof a wallet-sdk handshake** — manifest does NOT declare `externally_connectable`; Chrome enforces that pages cannot send messages directly to the SW. The content script is the only entry point. Verified at `packages/extension/manifest/manifest.config.ts` (no `externally_connectable` block) and in the runtime sender semantics (`sender.tab` is required to be present, set only for content-script senders).
- **`window.postMessage` from page intercepted by validator** — the validator at `content-script-validator.ts:73-79` filters by `origin === "content-script"`. Pages cannot directly invoke `chrome.runtime.sendMessage`, but if they could, they would need to provide the `origin: "content-script"` field; the validator catches malformed envelopes. The validator's value is defense in depth — the primary trust boundary is Chrome itself.
- **Schema patch fail-closed at SW init** — `nulo-schema-patch.ts:43-49` throws if upstream `registerToken` exists with a different param count. This breaks the SW boot, which means the wallet stops working — but no security regression (no silent fall-back to upstream behavior). The wallet refuses to start; fail-closed is appropriate. The reachability assertion at `packages/wallet-bridge/src/dispatcher.test.ts:666-679` pins the patch's effect.
- **Schema patch comparison `existing !== PATCHED_SCHEMA`** — line 41 compares the upstream schema (when present) against a fresh zod schema. The reference equality is always `false`, so the branch always enters `existingParamCount` check. This is intentional defensive behavior — if upstream's shape matches (2 params, AztecAddress × 2), leave it as is. Not a bug.
- **`onWalletMessage` per-session FIFO baton** — verified safe. Each session has its own baton chain. Cross-session messages don't interfere. Tests at `session-baton.test.ts` exercise idempotence, safety-net release, early-release semantics, and order preservation.
- **`queued-journal.ts` cap atomicity** — verified safe. `queuedCreationLock` serializes the count + create section (`queued-journal.ts:111-159`). Pinned by `queued-journal.test.ts:237-251` (ATOMIC cap test).
- **`messageId` collision attack** — `WalletMessage.messageId` is dApp-controlled. `handleWalletMessage` echoes it back into `response.messageId` without using it as a map key on the SW side, so collision causes only dApp-side response routing ambiguity. The session's encrypted channel guarantees attribution to one origin. No SW-side state is keyed on messageId.
- **`requestId` reuse across discoveries from the same origin** — upstream `pendingDiscoveries.set(requestId, ...)` overwrites on duplicate; our `pendingDiscoveryPromises` is keyed on `(origin, chainId)` not requestId, so the second discovery awaits the first popup. No bypass observed.
- **`sessionId === requestId` reuse on terminate / reconnect** — upstream `terminateSession` (lines 200-222) deliberately restores the discovery to `"approved"` state so the dApp can re-key-exchange. Our `pendingVerification.has(verifKey)` correctly returns false (entry was deleted on first session-established), so re-verification only triggers via `!dappSession.trustedVerification` (per `background.ts:170-181`). Safe semantics, but worth noting in the verify-popup flow documentation.
- **Decryption queue per-session monkey-patch** — `background.ts:257-269` overrides `handler.handleEncryptedMessage` to serialize decryptions. The monkey-patch is bounded to a single private-method override that does not alter security semantics — only ordering. Verified safe.
- **Content-script `event.source !== window` filter** — upstream `pageMessageHandler` checks `event.source === window` (`content_script_connection_handler.js:60-63`). For an iframe-injected content script, `window` is the iframe's window; the filter prevents cross-frame `postMessage` interference between iframes within the same tab. Each frame's session is isolated to its own MessagePort. The confused-deputy (Finding 1) is a TAB-level attribution issue, not a frame-level message bleed.
- **`window.postMessage` from page to ANY origin (`'*'`)** — used by the content script ONLY for posting the discovery response back to the page (containing the MessagePort transferable). The page is by definition the origin that initiated the discovery, so revealing the wallet's identity to that origin is intentional. Finding 4 documents the residual fingerprinting concern.
- **`sender.tab?.id` missing** — upstream `background_connection_handler.ts:189-191` returns early if `!tabId`, preventing tab-less messages from reaching the discovery flow. SW-internal messages (no `sender.tab`) are filtered out. Verified.
- **Schema patch import-side-effect tree-shaking** — handled by being the FIRST import in `background.ts` and pinned by `dispatcher.test.ts:671`. If a future bundler tree-shakes the side-effect import, the dispatcher test fails fast.
- **Error-envelope information leak** — `error-envelope.ts` returns structured EIP-1193 envelopes for `JobCancelledError`, `CapabilityNotGrantedError`, `TooManyPendingError`, and falls back to `error.message` for others. The fallback IS user-controllable (via thrown error messages); a future audit could expand this to a strict whitelist, but no current path includes sensitive material in error messages.
- **`toJsonSafe` recursion depth / circular refs** — `WeakSet` cycle detection at `background.ts:594-620` prevents stack overflow.
- **`PendingDiscovery` map unbounded growth** — upstream `pendingDiscoveries` map grows with each new requestId. `terminateForTab` (`background.ts:307`) cleans on tab close; `chrome.tabs.onRemoved` clears the map's per-tab entries. Bounded by active tab discoveries.
- **`sessionQueues` and `decryptQueues` map unbounded growth** — entries are removed in `onSessionTerminated` (`background.ts:184-187`). Bounded by active sessions.
- **CSP `script-src 'self' 'wasm-unsafe-eval'`** at the manifest level prevents inline / remote scripts from running in the extension's own pages — out of cluster scope but worth noting that the wallet UI is protected even if a popup template embeds attacker-controlled text.

---

## Confidence summary

| Finding | Severity (informal) | Confidence | Notes |
|---------|---------------------|------------|-------|
| F1 — iframe confused-deputy | **HIGH** | high | Upstream + manifest interaction; mitigation requires either `all_frames: false` or local sender.frameId filter |
| F2 — phishing surface via `appId` name field | MEDIUM | high | UX-level mitigation needed |
| F3 — chainId XOR truncation collision | LOW | moderate | Same-dApp lateral only |
| F4 — extension-ID fingerprint | LOW | high | Documented disclosure |
| F5 — `pendingVerification` leak | LOW | high | Memory pressure only |
| F6 — validator drift detection | LOW | high | Availability + maintainability |
| F7 — SW cold-boot listener race | LOW | moderate | Availability only |
| F8 — `chrome.tabs.onUpdated` URL parse fallback | LOW | moderate | Over-reactive teardown |
| F9 — origin/url lookup mismatch | (non-finding) | high | Verified safe |

---

## Out-of-cluster observations

- The chain between content-script handler and the SW depends on upstream `@aztec/wallet-sdk@4.2.0`. Findings 1, 4, and parts of 5 fundamentally rest on upstream behavior. Even with upstream fixes, defense-in-depth at the local seam (manifest + `background.ts:119-136`) is warranted.
- The schema patch is mirrored in three packages (`extension`, `faucet`, `playground`). The reachability test in `wallet-bridge/dispatcher.test.ts` pins drift for the extension copy but NOT for faucet / playground. A consolidated drift assertion would close that gap (out of cluster — handler scope is C2 only).
- The verify-popup flow (sessionId via URL fragment) trusts the SW to have set `dappSession.verificationHash` from the upstream ECDH derivation. The hash is computed independently by both parties via HKDF + HMAC over the public-keys salt (`crypto.js:210-261`). Cross-party MITM detection rests on the user's visual comparison of the emoji grid. The Nulo verify-popup UI is a reasonable implementation of the upstream protocol; no per-session emoji-grid bypass observed.
