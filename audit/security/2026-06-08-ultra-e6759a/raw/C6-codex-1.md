# C6 - DappInteractionService + popup approval flows (Codex xhigh Pass 1)

## Findings

### Finding 1 - The default execute approval surface omits the calldata values the user is being asked to approve

**Title**: The main execute popup reduces send-like and simulation-like requests to "function label + target contract" rows, even though the underlying operation model already carries argument arrays and full execution payloads. The only way to inspect the real calldata is to open a separate JSON viewer window.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization**. The user's approval decision is made without seeing the recipient, amount, note value, or other argument-level effects encoded in the call.
- Blast radius: every popup-gated `sendTx` / `aztec_sendTx` request, plus the same lossy review pattern on `simulate_transaction`, `aztec_simulateTx`, `aztec_profileTx`, `aztec_executeUtility`, and `aztec_createAuthWit`.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required. A malicious dApp only needs the user to approve the default popup without opening the raw JSON window.

**Evidence confidence**: **high** - direct trace from typed operation payloads to the popup renderer.

**OWASP / CWE mapping**: A04:2021 Insecure Design - **CWE-451** (User Interface Misrepresentation of Critical Information), **CWE-602** (Client-Side Enforcement of Server-Side Security).

**Trace** (source -> sink):
1. Source: the operation types already carry the user-relevant values. `CallAction` / `EncodedCallAction` include `args` at `packages/wallet-bridge/src/action.ts:37-54`; `SimulateUtilityOperation` includes `args` at `packages/wallet-bridge/src/operation.ts:97-104`; `AztecSendTxOperation` / `AztecSimulateTxOperation` / `AztecProfileTxOperation` carry full `exec` payloads at `packages/wallet-bridge/src/operation.ts:152-183`.
2. The execute popup materializes those operations into `operations.value` at `packages/extension/src/popup/windows/execute/index.vue:260-266`.
3. The primary review surface in `packages/extension/src/popup/windows/execute/OperationCard.vue` only renders method labels and target contracts:
   - `send_transaction`: `humanizeMethodName(...)` + target address at `:114-117`
   - `aztec_sendTx`: `humanizeMethodName(...)` + target address at `:134-136`
   - `simulate_transaction`: `humanizeMethodName(...)` + target address at `:266-269`
   - `simulate_utility`: method only at `:283-286`
   - `aztec_simulateTx`: `humanizeMethodName(...)` + target address at `:325-327`
   - `aztec_executeUtility`: method only at `:338-341`
   - `aztec_profileTx`: `humanizeMethodName(...)` + target address at `:357-359`
   - `aztec_createAuthWit`: target + function only at `:383-399`
4. The raw payload is not on the main review surface. It is behind the small expand icon at `packages/extension/src/popup/windows/execute/index.vue:456-463`, which opens a separate popup window at `:391-396`; that secondary window renders `<JsonViewer :data="data" fullscreen />` at `packages/extension/src/popup/windows/json/index.vue:46-57`.

**Missing control**: The primary approval surface should render structured summaries of argument-level effects for each operation kind, especially recipient-like addresses, token/amount values, opaque selector arguments, and any utility-call parameters. A secondary raw-JSON window is useful as an expert fallback, but it is not a sufficient default review surface.

**Exploit story**:
1. A malicious dApp asks the wallet to send a legitimate token contract call such as `transfer_private_to_public`.
2. The attacker places the real recipient and amount entirely in `args`.
3. The execute popup shows only "Transfer (private -> public) on <real token contract>".
4. The user never sees the attacker's recipient address or the transfer amount on the default approval card and clicks Confirm.
5. The wallet executes the malicious transfer even though the visible review surface looked routine.

**Preconditions**: The dApp can trigger any execute-popup flow and the user approves from the main window without separately opening the JSON viewer.

**Why mitigations fail**:
- `humanizeMethodName` is intentionally lossy and never exposes `args`; it only maps labels / title-cases names at `packages/extension/src/utils/tx-enrichment.ts:52-65`.
- The existence of the JSON viewer is not an effective mitigation because it is a secondary affordance, not the primary approval surface.
- Address-only rendering is insufficient for token transfers and utility calls where the meaningful effect is encoded in calldata, not in the contract address itself.

**Instances**:
- `packages/wallet-bridge/src/action.ts:37-54`
- `packages/wallet-bridge/src/operation.ts:97-104`
- `packages/wallet-bridge/src/operation.ts:152-183`
- `packages/extension/src/popup/windows/execute/index.vue:260-266`
- `packages/extension/src/popup/windows/execute/index.vue:391-396`
- `packages/extension/src/popup/windows/execute/index.vue:456-463`
- `packages/extension/src/popup/windows/json/index.vue:46-57`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:104-138`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:253-286`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:312-361`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:374-399`

---

### Finding 2 - The identity block is not a faithful rendering of the authority being granted

**Title**: Sessions are keyed on the full origin string, but the approval windows display only `hostname` and then add a raw dApp-controlled `name` line. This hides scheme / port distinctions and reintroduces a Unicode-spoofable brand label next to the trust anchor.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization**. The user may believe they are approving the same already-known app when the actual authority is a different origin, or they may trust a spoofed brand string more than the origin.
- Blast radius: discovery, capabilities, execute, and verify windows all share the same identity rendering path.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required. The attacker only needs to control `discovery.origin` / `discovery.appName`.

**Evidence confidence**: **high** - direct trace from origin/session storage and popup rendering.

**OWASP / CWE mapping**: A04:2021 Insecure Design - **CWE-451** (User Interface Misrepresentation of Critical Information), **CWE-1007** (Insufficient Visual Distinction of Homoglyphs Presented to User).

**Trace** (source -> sink):
1. Source: wallet-sdk discovery stores dApp identity as:
   - `name: discovery.appName ?? discovery.appId`
   - `url: discovery.origin`
   at `packages/extension/src/wallet/services/wallet-sdk/background.ts:423-427`.
2. Session lookup keys on the full stored origin string: `x.dappMetadata.url === origin && x.chainId === chainId` at `packages/extension/src/wallet/services/dapp-session/service.ts:85-99`.
3. The popup-side helper discards scheme and port by computing `new URL(url).hostname` at `packages/extension/src/composables/useDappHostname.ts:9-16`.
4. The shared identity block renders only that hostname at `packages/extension/src/components/composite/DappIdentityBlock.vue:37` and separately renders the raw `dapp.name` at `:47`.
5. The same raw `dapp.name` also appears in the verify window at `packages/extension/src/popup/windows/verify/index.vue:210` and in the execute fee badge at `packages/extension/src/popup/windows/execute/OperationCard.vue:156`.

**Missing control**: The wallet should display the same canonical origin string it keys trust on (scheme + host + non-default port), and any dApp-supplied display name should be sanitized and visually marked as untrusted metadata instead of being rendered as a plain secondary identity label.

**Exploit story**:
1. An attacker hosts a clone of a legitimate app on a different origin that keeps the same hostname but changes the scheme or port, or otherwise relies on a user not noticing the exact origin boundary.
2. The attacker sets `appName` to a trusted-looking brand string using confusable Unicode characters.
3. The popup shows the hostname-only trust anchor and the spoofed brand line.
4. The user sees a familiar hostname and brand, assumes this is the same app they already trust, and approves a fresh session or execute request for a different origin.

**Preconditions**: The dApp can supply discovery metadata and the user relies on the popup's identity block when deciding whether to approve.

**Why mitigations fail**:
- `useDappHostname` only flags non-ASCII / punycode hostnames at `packages/extension/src/composables/useDappHostname.ts:19-25`; it does not preserve the full origin that the session model actually keys on.
- The raw `dapp.name` field is not run through the existing wire-string sanitizer anywhere on these surfaces.
- Internal session isolation still works, but the user-facing display does not faithfully surface the differentiators the model uses for trust decisions.

**Instances**:
- `packages/extension/src/wallet/services/wallet-sdk/background.ts:423-427`
- `packages/extension/src/wallet/services/dapp-session/service.ts:85-99`
- `packages/extension/src/composables/useDappHostname.ts:9-25`
- `packages/extension/src/components/composite/DappIdentityBlock.vue:37-47`
- `packages/extension/src/popup/windows/verify/index.vue:200-210`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:153-157`

---

### Finding 3 - Execute approval windows bypass the existing wire-string sanitizer for dApp-controlled operation labels

**Title**: The popup already has a dedicated `sanitizeWireString` helper for hostile wire strings, but the execute approval surface does not use it for function names, selectors, or contract artifact names. Instead it renders dApp-controlled labels via `humanizeMethodName` or direct interpolation.

**Impact factors**:
- CIA+A: **Integrity**. The user can be shown visually misleading operation labels containing bidi overrides, zero-width characters, or Unicode confusables.
- Blast radius: every execute popup that renders a function name / selector, plus `aztec_registerContract` artifact names.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required. The attacker only needs to supply hostile wire strings in call metadata or artifact metadata.

**Evidence confidence**: **high** - direct trace plus a nearby existing sanitizer that is not reused here.

**OWASP / CWE mapping**: A04:2021 Insecure Design - **CWE-1007** (Insufficient Visual Distinction of Homoglyphs Presented to User), **CWE-451** (User Interface Misrepresentation of Critical Information), **CWE-20** (Improper Input Validation).

**Trace** (source -> sink):
1. Source: dApp-controlled operation labels enter through the operation model:
   - `CallAction.method` / `EncodedCallAction.name` / `EncodedCallAction.selector` at `packages/wallet-bridge/src/action.ts:37-54`
   - `AztecExecuteUtilityOperation.call` and `AztecRegisterContractOperation.artifact` at `packages/wallet-bridge/src/operation.ts:144-166`
2. The execute popup renders those labels directly:
   - `humanizeMethodName(...)` for send/sim/profile/authwit rows at `packages/extension/src/popup/windows/execute/OperationCard.vue:114,134,266,285,325,340,357,394-398`
   - raw artifact name at `packages/extension/src/popup/windows/execute/OperationCard.vue:369-371`
3. `humanizeMethodName` does not sanitize hostile Unicode. It only maps known labels, truncates hex selectors, or title-cases snake case at `packages/extension/src/utils/tx-enrichment.ts:52-65`.
4. A sanitizer already exists for exactly this class of problem: `sanitizeWireString` strips Unicode format controls / zero-width chars / control bytes and clamps length at `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:104-166`.
5. The capability popup reuses that sanitizer for function labels at `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:14,37,163-166,198-200`, but the execute popup does not.

**Missing control**: The execute popup should run all dApp-controlled operation labels through the same `sanitizeWireString` / `stripWireControl` path already used in the capability UI before any humanization or display.

**Exploit story**:
1. A malicious dApp submits an encoded call with a spoofed `name` such as a visually-confusable variant of `transfer`, or with bidi / zero-width control characters embedded in the label.
2. The execute popup humanizes and displays that hostile string without stripping control characters.
3. The user sees a familiar-looking function label and approves, even though the underlying call is not what the label visually suggests.

**Preconditions**: The dApp can supply operation metadata (`name`, `method`, `selector`, or `artifact.name`) and the user relies on the rendered label when reviewing the popup.

**Why mitigations fail**:
- Vue interpolation prevents HTML injection, but it does not strip Unicode format controls or confusable glyphs.
- The project already solved this problem for the capability popup, but that control is not reused on execute surfaces.
- `humanizeMethodName` is a presentation helper, not a sanitizer.

**Instances**:
- `packages/wallet-bridge/src/action.ts:37-54`
- `packages/wallet-bridge/src/operation.ts:144-166`
- `packages/extension/src/utils/tx-enrichment.ts:52-65`
- `packages/extension/src/wallet/services/dapp-session/capability-meta.ts:104-166`
- `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:14,37,163-166,198-200`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:114`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:134`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:266`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:285`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:325`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:340`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:357`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:369-371`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:394-398`

---

### Finding 4 - Token approval and first-receive popups render attacker-controlled token strings without normalization or length caps

**Title**: Token `name` / `symbol` values come from on-chain simulation and flow into both the `register_token` popup and the incoming-trust popup without `sanitizeWireString`, normalization, or explicit length limits. This leaves the approval UI open to Unicode-homograph, bidi, zero-width, and layout-abuse attacks.

**Impact factors**:
- CIA+A: **Integrity**. The user's "add this token" and "allow receives from this token" decisions are made against attacker-controlled strings.
- Blast radius: every dApp-initiated `registerToken` flow, and every first-receive trust prompt for the resulting token.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required. The attacker only needs a malicious token contract plus one user approval.

**Evidence confidence**: **high** - direct trace from on-chain metadata fetch to popup rendering.

**OWASP / CWE mapping**: A04:2021 Insecure Design - **CWE-1007** (Insufficient Visual Distinction of Homoglyphs Presented to User), **CWE-451** (User Interface Misrepresentation of Critical Information), **CWE-20** (Improper Input Validation).

**Trace** (source -> sink):
1. Source: token metadata is fetched from the token contract itself. `previewTokenMetadata()` calls `fetchTokenMetadata()` at `packages/extension/src/wallet/services/token/service.ts:460-472`; `fetchTokenMetadata()` simulates `getName` / `getSymbol` and returns the raw strings at `:495-507`.
2. The execute popup prefetches those values for `register_token` operations at `packages/extension/src/popup/windows/execute/index.vue:270-291`.
3. The register-token approval card renders the raw values at `packages/extension/src/popup/windows/execute/OperationCard.vue:222-231`.
4. The same unsanitized strings are persisted into the token record at `packages/extension/src/wallet/services/token/service.ts:156-183`.
5. Incoming-transfer scanning later emits `token.symbol` into the pending-trust event at `packages/extension/src/wallet/services/incoming-transfer/service.ts:647-656` and replay path at `:736-745`.
6. `PopupManager` copies that raw `tokenSymbol` into popup state at `packages/extension/src/popup/components/popups/PopupManager.vue:92-103`, and `IncomingTrustPopup` renders it in the title/body/toasts at `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:49,90,102,135-137`.

**Missing control**:
- Apply `stripWireControl` / `sanitizeWireString` to token display fields before rendering.
- Clamp length on `name` / `symbol` to avoid layout abuse.
- Prefer registry-backed canonical metadata, or at minimum mark on-chain strings as untrusted and visually secondary to the contract address.

**Exploit story**:
1. The attacker deploys a token whose `symbol` is a confusable variant of `USDC` and whose `name` carries bidi or zero-width control characters.
2. The dApp asks the user to `registerToken`.
3. The popup shows the spoofed `symbol` / `name`, and the user approves because it looks like a familiar asset.
4. Later, when the attacker dusts the wallet from that same contract, the first-receive popup asks `Allow <spoofed symbol>?` and the success / rejection toasts repeat the spoofed label.
5. The fake asset is now reinforced across two separate trust decisions.

**Preconditions**: The token contract controls its metadata methods, the dApp can trigger `registerToken`, and the user approves the resulting popups.

**Why mitigations fail**:
- The code comments correctly acknowledge that `symbol/name come straight from the on-chain contract and are attacker-controllable` at `packages/extension/src/popup/windows/execute/OperationCard.vue:214-219`, but there is no sanitization logic behind that warning.
- Vue interpolation blocks HTML injection but does not mitigate confusables, bidi overrides, or zero-width characters.
- The contract-address row is helpful, but it is not enough to neutralize a hostile primary asset label.
- There is no trusted-registry cross-check before the label is shown.

**Instances**:
- `packages/extension/src/wallet/services/token/service.ts:460-472`
- `packages/extension/src/wallet/services/token/service.ts:495-507`
- `packages/extension/src/wallet/services/token/service.ts:156-183`
- `packages/extension/src/popup/windows/execute/index.vue:270-291`
- `packages/extension/src/popup/windows/execute/OperationCard.vue:214-231`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:647-656`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:736-745`
- `packages/extension/src/popup/components/popups/PopupManager.vue:92-103`
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:49`
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:90`
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:102`
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:135-137`

---

### Finding 5 - `onTokenAdded` pre-trusts the token before any first-receive scan, bypassing the intended second confirmation

**Title**: `IncomingTransferService.onTokenAdded` unconditionally flips `(profileId, networkId, contract)` trust to `trusted` before it starts the per-account schedulers. As a result, the first incoming note from a newly added contract never traverses the `unknown -> pending -> popup` flow that `IncomingTrustPopup` is supposed to enforce.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization**. The wallet silently treats the token as trusted for inbound visibility before the user has made the "allow receives from this contract" decision.
- Blast radius: every token added through `TokenService.addToken`, including dApp-driven `registerToken` approvals and manual custom-token adds.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required once (the initial token-add approval). The follow-up first-receive gate is then skipped.

**Evidence confidence**: **high** - direct state-transition trace with explicit code comments describing the pre-trust.

**OWASP / CWE mapping**: A04:2021 Insecure Design - **CWE-841** (Improper Enforcement of Behavioral Workflow), **CWE-693** (Protection Mechanism Failure).

**Trace** (source -> sink):
1. Source: `TokenService.addToken()` persists the token and emits `onTokenAdded` at `packages/extension/src/wallet/services/token/service.ts:156-183`.
2. `IncomingTransferService.onTokenAdded` explicitly documents and implements "Flip trust->trusted BEFORE the per-account schedulers kick scans" at `packages/extension/src/wallet/services/incoming-transfer/service.ts:440-447`; the actual trust write happens at `:449-453`.
3. Only after that trust flip does the service start per-account schedulers at `packages/extension/src/wallet/services/incoming-transfer/service.ts:455-465`.
4. The scan path only emits a pending-popup event when `trustState === "unknown"` at `packages/extension/src/wallet/services/incoming-transfer/service.ts:642-657`.
5. If the state is already `trusted`, the record is emitted visible immediately at `packages/extension/src/wallet/services/incoming-transfer/service.ts:673-675`.
6. This contradicts the popup's own threat model, which says the first incoming note from a newly added contract should require a second confirmation at `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:11-15`.

**Missing control**: Keep dApp-added tokens in `unknown` / `pending` until the first inbound scan and explicit user allow. If the product wants to suppress friction for manual token imports, key that policy on the add source rather than treating every `addToken` path as implicitly trusted.

**Exploit story**:
1. A malicious dApp socially engineers the user into approving `registerToken` for a fake stablecoin contract.
2. `addToken()` emits `onTokenAdded`, and `IncomingTransferService` marks the contract `trusted` before any inbound scan runs.
3. The attacker sends a dust note from that contract.
4. The scan sees `trusted`, stores the record visible, and never emits the first-receive trust popup.
5. The fake asset appears in the wallet immediately, reinforcing the impression that the contract is legitimate.

**Preconditions**: The token was added through any explicit add path, and the attacker can cause an inbound note from that contract afterward.

**Why mitigations fail**:
- The pre-trust is not accidental; it is a deliberate state transition implemented before the scan path runs.
- PopupManager's stale-popup defenses do not help here because no pending popup is emitted in the trusted branch.
- The first-receive defense described in `IncomingTrustPopup.vue` is bypassed before it ever has a chance to run.

**Instances**:
- `packages/extension/src/wallet/services/token/service.ts:156-183`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:440-465`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:642-657`
- `packages/extension/src/wallet/services/incoming-transfer/service.ts:673-675`
- `packages/extension/src/popup/components/popups/IncomingTrustPopup.vue:11-15`

## Non-findings

- No direct template-HTML injection sink was found on the audited approval surfaces. A repo search for `v-html` across `packages/extension/src/popup/components/popups`, `packages/extension/src/popup/windows`, and `packages/extension/src/components/composite` returned no matches, and the reviewed surfaces use Vue interpolation rather than raw HTML insertion.
- No batch-based confirmation bypass was found for popup-gated methods. `WalletSdkDispatcher.handleBatch()` explicitly rejects `sendTx` and `registerToken` legs server-side at `packages/wallet-bridge/src/dispatcher.ts:349-364`.
- No phantom-account grant path was found in the capability popup. The popup returns only user-selected accounts at `packages/extension/src/popup/windows/capabilities/index.vue:200-215`, and the dispatcher only merges those selected accounts into the session at `packages/wallet-bridge/src/dispatcher.ts:614-630`.
- No cross-profile stale-popup execution path was found for execute approvals. The popup rejects on active-profile change at `packages/extension/src/popup/windows/execute/index.vue:300-302`, and the service re-validates that the active profile still matches the session before executing at `packages/extension/src/wallet/services/dapp-interaction/service.ts:132-147`.
- No stale incoming-trust popup replay bypass was found in the popup manager itself. The manager drops mismatched live triples and purges queued/open prompts when trust resets to `unknown` at `packages/extension/src/popup/components/popups/PopupManager.vue:108-154`.
