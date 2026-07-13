# Consolidated findings — Nulo extension security audit (max)
## Summary table
| ID | Title | Band | Confidence | Found by | Cluster(s) |
|---|---|---:|---|---|---|
| F-01 | Raw-hash `createAuthWit` silently signs unscopable authwits | Critical | high | both | bridge-dispatcher, aztec-runtime-signing |
| F-02 | Function scopes authorize `name` while execution uses `selector` | High | high | codex-only | bridge-dispatcher |
| F-03 | Tx signing re-fetches unvalidated chain identity after the guard | High | high | claude-only | aztec-runtime-signing |
| F-04 | Discovery intake can be flooded into unbounded queue/popup work | Medium | high | both | ext-content-script, ext-sw-dapp-connection |
| F-05 | dApp `logo` is rendered as unrestricted `<img src>` beacon | Medium | high | both | ext-popup-sensitive, ext-components-design |
| F-06 | Backup restore can silently disable strict mode and persist passhash | Medium | high | codex-only | ext-sw-services-storage |
| F-07 | Transaction approval renders dApp method labels without wire-string sanitization | Medium | moderate | claude-only | ext-popup-sensitive |
| F-08 | SW dispatcher consumes dApp RPC `unknown[]` via unchecked casts | Medium | moderate | claude-only | bridge-dispatcher |
| F-09 | Offscreen PXE listener lacks sender/context authentication | Low | high code / low reachability | claude-only | ext-offscreen, messaging-boundary |
| F-10 | Firefox offscreen fallback can duplicate PXE listeners after SW restart | Low | high | both | ext-offscreen |
| F-11 | Password/passkey bearer material has weak lifetime and recovery properties | Low | high | both | crypto-core |
| F-12 | Unsigned `DappSession` rows can mint grants if extension storage is tampered | Low | high | codex-only | wallet-core-storage |
| F-13 | Malformed `ValueStorage` rows can abort wallet startup/restore | Low | high | both | wallet-core-storage |
| F-14 | Seed/private-key export copies secrets to OS clipboard without clearing | Low | high | claude-only | ext-popup-sensitive |

## Findings
### [CRITICAL] F-01: Raw-hash `createAuthWit` silently signs unscopable authwits
- Impact / CVSS factors: malicious dApp with `accounts.canCreateAuthWit` can obtain an `AuthWitness` for an attacker-chosen raw `Fr` hash with no per-request popup; AV:N, AC:L, PR:L, UI:N after initial grant, wallet signing authority impact.
- Confidence: high
- Cross-model: both
- OWASP/CWE: OWASP A01; CWE-863, CWE-862
- Instances: `packages/wallet-bridge/src/method-scope-checkers.ts:255`; `packages/wallet-bridge/src/method-scope-checkers.ts:306`; `packages/wallet-bridge/src/dispatcher.ts:370`; `packages/wallet-bridge/src/dispatcher.ts:1162`; `apps/extension/src/wallet/services/execution/service.ts:680`; `apps/extension/src/wallet/services/execution/service.ts:685`
- Root cause + trace (source→sink, file:line each step): dApp RPC enters dispatcher with raw args at `dispatcher.ts:275`; capability/scope gate runs at `dispatcher.ts:299` and `dispatcher.ts:320`; `checkCreateAuthWit` enforces only `canCreateAuthWit` for the account at `method-scope-checkers.ts:258-267`; structured intents are checked by `call.name` at `method-scope-checkers.ts:279-287`, but raw `Fr` falls through at `method-scope-checkers.ts:306-308`; dispatcher forwards `args[1]` at `dispatcher.ts:1156-1162`; execution parses raw `Fr` at `service.ts:680-682` and signs at `service.ts:685`.
- Missing control: dApp-originated authwits are not required to be structured, recomputable, and scope-checkable before signing.
- Exploit/violation scenario + preconditions: user approves an accounts grant with `canCreateAuthWit`; malicious dApp computes an authwit hash for an unauthorized token/protocol call and calls `createAuthWit(from, rawHash)`; wallet returns a valid witness silently.
- Why mitigations fail / reachability verdict: ext-sw-dapp-connection Claude was wrong that this is “properly scope-bound”; that is true only for structured call shapes, not raw hashes. Chain identity is checked at `service.ts:650`, but payload authorization is not.
- Recommended fix: reject raw `Fr` / opaque `IntentInnerHash` from dApp RPC, or require explicit user confirmation for unscopable hashes; prefer recomputing the hash from a structured `CallIntent` whose contract/function/selector are all authorized.
- Needs Phase-4 verification: yes

### [HIGH] F-02: Function scopes authorize `name` while execution uses `selector`
- Impact / CVSS factors: malicious dApp can satisfy a granted function scope with a benign `call.name` while executing/signing/simulating a different `call.selector`; AV:N, AC:L, PR:L, UI:N for simulation/utility/authwit paths and UI-mediated but misleading for `sendTx`.
- Confidence: high
- Cross-model: codex-only
- OWASP/CWE: OWASP A01; CWE-863, CWE-20
- Instances: `packages/wallet-bridge/src/method-scope-checkers.ts:121`; `packages/wallet-bridge/src/method-scope-checkers.ts:160`; `packages/wallet-bridge/src/method-scope-checkers.ts:174`; `packages/wallet-bridge/src/method-scope-checkers.ts:281`; `apps/extension/src/wallet/services/execution/operation-planner.ts:207`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:311`
- Root cause + trace (source→sink, file:line each step): scope checks compare grants to attacker-controlled `call.name` at `method-scope-checkers.ts:121`, `:160`, `:174`, and `:281`; dispatcher forwards calls unchanged at `dispatcher.ts:544` and `dispatcher.ts:1134-1154`; planner stores both fields at `operation-planner.ts:207-219`; tx builder constructs `FunctionCall` with `FunctionSelector.fromString(action.selector)` at `tx-request-builder.ts:313-318`, while `action.name` is only `fnName` metadata at `tx-request-builder.ts:311`.
- Missing control: no binding of `name` to `selector` against the contract artifact before authorization.
- Exploit/violation scenario + preconditions: dApp has scope for `transfer@TOKEN`; it submits `{ name: "transfer", selector: approveSelector, args: approveArgs }`; scope passes and execution uses `approveSelector`.
- Why mitigations fail / reachability verdict: Fable missed this. I did not find any pre-authorization binding step in dispatcher, planner, or tx builder.
- Recommended fix: authorize the executable selector, or resolve selector from the authorized artifact/name and reject mismatches; render both verified function label and selector when artifact resolution fails.
- Needs Phase-4 verification: yes

### [HIGH] F-03: Tx signing re-fetches unvalidated chain identity after the guard
- Impact / CVSS factors: malicious/drifted RPC can return correct chain info for the guard, then different chain info for account signing; AV:N through selected RPC, AC:L if RPC-controlled, UI:R for normal tx approval, integrity of signed tx/authwit context.
- Confidence: high
- Cross-model: claude-only
- OWASP/CWE: OWASP A08/A01; CWE-367, CWE-345
- Instances: `apps/extension/src/wallet/services/execution/tx-request-builder.ts:119`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:124`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:343`; `packages/aztec-runtime/src/account/nulo-account.ts:103`; `packages/aztec-runtime/src/account/nulo-account.ts:140`
- Root cause + trace (source→sink, file:line each step): builder gets node and checks first `node.getNodeInfo()` at `tx-request-builder.ts:116-124`; then passes the same node into `account.buildTxExecutionRequest` at `tx-request-builder.ts:342-344`; `NuloAccount` calls `node.getNodeInfo()` again at `nulo-account.ts:103`, builds `chainInfo` at `nulo-account.ts:104-107`, and signs/wraps with it at `nulo-account.ts:137`, `:140`, and `:184`.
- Missing control: the validated `(l1ChainId, rollupVersion)` is not passed into the signing routine; the second RPC response is trusted.
- Exploit/violation scenario + preconditions: user profile points to attacker-controlled RPC; first response matches selected network, second response names another chain; wallet signs/proves for the second chain.
- Why mitigations fail / reachability verdict: `assertLiveChainIdentity` protects only the first fetch. Fixed `Fr.ZERO` account salt at `nulo-account.ts:66` amplifies cross-chain landing/linkability but is not a standalone exploit.
- Recommended fix: pass validated chain info into `buildTxExecutionRequest` and remove the internal refetch, or assert the second response against the selected network before using it.
- Needs Phase-4 verification: yes

### [MEDIUM] F-04: Discovery intake can be flooded into unbounded queue/popup work
- Impact / CVSS factors: any visited page can consume SW memory while locked or open many connect popups while unlocked; AV:N, AC:L, PR:N, UI:R to visit page, availability impact.
- Confidence: high
- Cross-model: both
- OWASP/CWE: OWASP A04; CWE-770, CWE-400
- Instances: `apps/extension/src/content-script/content.ts:12`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:475`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:503`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:552`; `packages/wallet-bridge/src/discovery-queue.ts:20`; `apps/extension/src/wallet/services/window-manager/window-manager.ts:83`
- Root cause + trace (source→sink, file:line each step): page discovery messages are relayed by content script at `content.ts:12`; SW validates envelope and forwards at `background.ts:187-192`; locked path enqueues unbounded at `background.ts:473-476` and `discovery-queue.ts:20-23`; unlocked path derives attacker-controlled `chainId` at `background.ts:740-745`, dedupes by `${origin}|${chainId}` at `background.ts:503`, and opens popup through `dappInteractionService.discover` at `background.ts:552` → `window-manager.ts:83-84`.
- Missing control: no per-origin/tab rate limit, max pending count, chain allowlist before popup, or locked-queue cap.
- Exploit/violation scenario + preconditions: malicious page loops discovery with unique request IDs or chain IDs; locked wallet accumulates queue, unlocked wallet spawns repeated popups.
- Why mitigations fail / reachability verdict: content-script leg’s “only low relay DoS” undercounted the SW sink; SW-dapp legs correctly identified the unbounded state.
- Recommended fix: cap pending discoveries globally and per origin/tab, reject unknown chains before popup, and coalesce locked discoveries by `(origin, chainId)`.
- Needs Phase-4 verification: no

### [MEDIUM] F-05: dApp `logo` is rendered as unrestricted `<img src>` beacon
- Impact / CVSS factors: malicious dApp can force extension pages to fetch attacker URLs during connect/execute/verify/settings views, leaking IP/timing and enabling logo-based UI spoofing; AV:N, AC:L, PR:N, UI:R.
- Confidence: high
- Cross-model: both
- OWASP/CWE: OWASP A05/A01; CWE-200, CWE-359, CWE-1021
- Instances: `apps/extension/src/composables/useDappInteractionPayload.ts:92`; `apps/extension/src/components/composite/DappIdentityBlock.vue:40`; `apps/extension/src/popup/windows/verify/index.vue:161`; `apps/extension/src/popup/windows/verify/index.vue:199`; `apps/extension/src/popup/pages/settings/connected-apps/index.vue:43`; `apps/extension/src/popup/pages/settings/connected-apps/index.vue:144`; `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:83`; `apps/extension/src/popup/pages/settings/connected-apps/[id].vue:202`; `apps/extension/manifest/manifest.config.ts:42`
- Root cause + trace (source→sink, file:line each step): dApp metadata carries `logo?: string`; UI copies `meta.logo` to `logoBlobUrl` at `useDappInteractionPayload.ts:90-93`, verify/settings do the same at cited lines, and Vue binds it into `<img :src>` at `DappIdentityBlock.vue:40` and other sinks; CSP has only `script-src` at `manifest.config.ts:41-42`, so remote images are unrestricted.
- Missing control: no scheme/origin allowlist, no blob re-encoding privacy gate, no `img-src` CSP.
- Exploit/violation scenario + preconditions: dApp sets `logo=https://attacker/px.gif?id=...`; approval view loads and attacker records IP and timing before approval.
- Why mitigations fail / reachability verdict: Vue escaping does not sanitize URL fetches; `sanitizeWireString` protects names, not image URLs. Codex popup leg missed this; components Claude missed because background discovery currently omits logo on one path, but stored/session interaction paths still copy it.
- Recommended fix: drop remote logos or fetch through a wallet-controlled sanitizer that outputs `blob:`; add `img-src 'self' data: blob:` or stricter CSP.
- Needs Phase-4 verification: no

### [MEDIUM] F-06: Backup restore can silently disable strict mode and persist passhash
- Impact / CVSS factors: malicious/tampered backup can set security config before restored profile activation, causing passhash persistence; AV:L/user-assisted file import, AC:L, UI:R, confidentiality/authorization impact.
- Confidence: high
- Cross-model: codex-only
- OWASP/CWE: OWASP A01/A05; CWE-862, CWE-20
- Instances: `apps/extension/src/composables/useFullBackupImport.ts:226`; `apps/extension/src/composables/useFullBackupImport.ts:391`; `apps/extension/src/composables/useFullBackupImport.ts:412`; `apps/extension/src/wallet/services/config/service.ts:45`; `apps/extension/src/wallet/config/store.ts:34`; `apps/extension/src/wallet/services/profile/session-manager.ts:211`; `apps/extension/src/wallet/services/profile/service.ts:1082`
- Root cause + trace (source→sink, file:line each step): backup checksum is recomputable from attacker-controlled content at `useFullBackupImport.ts:226`; config service is restored before profile activation at `useFullBackupImport.ts:381-399`; `ConfigService.restore` writes raw props at `config/service.ts:45-50`; store assigns and emits update at `config/store.ts:28-36`; restored `strictSecurityMode=false` updates `SessionManager` at `session-manager.ts:483-495`; `finalizeRestore` derives passhash at `profile/service.ts:1082` and `open()` persists it when strict is false at `session-manager.ts:211-214`.
- Missing control: no runtime schema/allowlist for backup config restore and no explicit confirmation for security-critical config changes during import.
- Exploit/violation scenario + preconditions: user imports attacker-supplied plaintext backup containing `strictSecurityMode=false`; restored password profile opens and stores base64 passhash in session storage.
- Why mitigations fail / reachability verdict: Claude was correct that ordinary strict mode does not persist passhash, but missed this restore ordering. The checksum is integrity against corruption, not authenticity.
- Recommended fix: validate config backup props against an allowlist/schema; ignore or prompt separately for `strictSecurityMode` and `sessionTtl`; default restored security settings to strict unless user confirms.
- Needs Phase-4 verification: yes

### [MEDIUM] F-07: Transaction approval renders dApp method labels without wire-string sanitization
- Impact / CVSS factors: dApp-controlled Unicode/bidi/long method labels can mislead a user at the signing approval checkpoint; AV:N, AC:L, PR:L, UI:R, integrity of approval display.
- Confidence: moderate
- Cross-model: claude-only
- OWASP/CWE: OWASP A04; CWE-451, CWE-176
- Instances: `apps/extension/src/popup/windows/execute/OperationCard.vue:118`; `apps/extension/src/popup/windows/execute/OperationCard.vue:133`; `apps/extension/src/popup/windows/execute/OperationCard.vue:138`; `apps/extension/src/popup/windows/execute/OperationCard.vue:183`; `apps/extension/src/popup/windows/execute/OperationCard.vue:401`; `apps/extension/src/popup/windows/execute/OperationCard.vue:416`; `apps/extension/src/popup/windows/execute/OperationCard.vue:433`; `apps/extension/src/utils/tx-enrichment.ts:52`
- Root cause + trace (source→sink, file:line each step): dApp operation payload enters execute window, `OperationCard` renders `call.name`, `action.method`, authwit method, and args through `humanizeMethodName` / `String(a)` at cited lines; `humanizeMethodName` only title-cases/truncates hex at `tx-enrichment.ts:52-64`, with no `sanitizeWireString`.
- Missing control: security-decision text lacks the same bidi/control/length sanitizer already used for dApp names and capability details.
- Exploit/violation scenario + preconditions: dApp submits method name with RLO/zero-width/homoglyphs or extreme length; popup appears to describe a benign method while selector or target differs.
- Why mitigations fail / reachability verdict: Vue prevents HTML XSS but not visual spoofing. Address display partly mitigates but does not neutralize misleading method text.
- Recommended fix: route all dApp-authored labels/args through `sanitizeWireString` or a stricter method-label sanitizer; clamp lengths in fixed UI rows; prefer artifact-verified names.
- Needs Phase-4 verification: no

### [MEDIUM] F-08: SW dispatcher consumes dApp RPC `unknown[]` via unchecked casts
- Impact / CVSS factors: approved dApp can send raw channel frames whose args bypass client-side wallet-sdk Zod schemas; systemic trust-boundary weakness, AV:N, AC:L, PR:L, UI:N for auto-approved methods.
- Confidence: moderate
- Cross-model: claude-only
- OWASP/CWE: OWASP A03/A08; CWE-20, CWE-501, CWE-843
- Instances: `apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:50`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:637`; `packages/wallet-bridge/src/dispatcher.ts:275`; `packages/wallet-bridge/src/dispatcher.ts:328`; `packages/wallet-bridge/src/dispatcher.ts:544`; `packages/wallet-bridge/src/dispatcher.ts:1134`; `packages/wallet-bridge/src/dispatcher.ts:1162`
- Root cause + trace (source→sink, file:line each step): content-script validator leaves payload `content` unknown at `content-script-validator.ts:50`; SW dispatches `message.args` directly at `background.ts:637`; dispatcher accepts `args: unknown[]` at `dispatcher.ts:275` and uses casts throughout, including capability manifests, tx execs, account ops, and authwit payload at cited lines.
- Missing control: no server-side per-method schema validation before casts and authorization.
- Exploit/violation scenario + preconditions: connected dApp sends raw encrypted protocol frames with malformed or semantically inconsistent args; current concrete consequences include F-01/F-02, and future methods inherit the same risk.
- Why mitigations fail / reachability verdict: dApp-side `WalletSchema` is not a SW-side security control; envelope validation intentionally does not validate method args.
- Recommended fix: add SW/dispatcher-side method schema table and parse `args` before capability/scope checks; reject unknown fields where semantic binding matters.
- Needs Phase-4 verification: no

### [LOW] F-09: Offscreen PXE listener lacks sender/context authentication
- Impact / CVSS factors: any extension context that can emit top-level `{to:"pxe"}` messages could invoke PXE RPCs outside SW authorization; current web reachability blocked, so defense-in-depth Low.
- Confidence: high code / low reachability
- Cross-model: claude-only
- OWASP/CWE: OWASP A01; CWE-306, CWE-862, CWE-940
- Instances: `packages/extension-messaging/src/offscreen/service.ts:36`; `packages/extension-messaging/src/offscreen/service.ts:43`; `apps/extension/src/offscreen/index.ts:14`; `apps/extension/src/wallet/utils/offscreen.ts:47`; `apps/extension/src/wallet/utils/offscreen.ts:80`
- Root cause + trace (source→sink, file:line each step): offscreen service registers `chrome.runtime.onMessage` at `offscreen/service.ts:32-33`; listener ignores `sender` and gates only on `message.to === this.name` at `offscreen/service.ts:36-38`; request dispatches at `offscreen/service.ts:43-48`; offscreen lifecycle ping/ready listeners similarly accept bare strings at `offscreen/index.ts:14-17` and `wallet/utils/offscreen.ts:47-55`, `:80-87`.
- Missing control: no `sender.id`, `sender.tab`, frame, or instance-token validation.
- Exploit/violation scenario + preconditions: requires compromised extension context or future relay that exposes top-level `to`; page cannot do this today through `content.ts`.
- Why mitigations fail / reachability verdict: ext-offscreen Claude over-rated as High via content-script relay. Messaging-boundary Claude/Codex are right: no `externally_connectable`, content script uses fixed SDK envelope, and page cannot set top-level `to`.
- Recommended fix: bind `sender` in offscreen service listener and reject tab/content-script senders; add nonce/instance token to offscreen lifecycle messages, following the explicit sender checks used by `content-script-validator` subframe defense.
- Needs Phase-4 verification: yes

### [LOW] F-10: Firefox offscreen fallback can duplicate PXE listeners after SW restart
- Impact / CVSS factors: Firefox hidden-window fallback can leave stale PXE windows that also receive broadcast RPCs; AV environmental/local timing, AC:H, integrity/availability and secret-bearing RPC duplication.
- Confidence: high
- Cross-model: both
- OWASP/CWE: OWASP A01; CWE-664, CWE-863
- Instances: `apps/extension/src/wallet/utils/offscreen.ts:45`; `apps/extension/src/wallet/utils/offscreen.ts:183`; `apps/extension/src/wallet/utils/offscreen.ts:201`; `apps/extension/src/wallet/utils/offscreen.ts:215`; `packages/extension-messaging/src/offscreen/client.ts:104`; `packages/extension-messaging/src/offscreen/service.ts:36`
- Root cause + trace (source→sink, file:line each step): Firefox offscreen window id is module-local at `offscreen.ts:45`; comments acknowledge SW restart leak at `offscreen.ts:183-190`; Firefox running check trusts only in-memory id at `offscreen.ts:201-202`; next ensure creates another window at `offscreen.ts:215-222`; SW broadcasts RPCs with `{to:this.service}` at `offscreen/client.ts:103-104`; every listener matching `to` handles at `offscreen/service.ts:36-48`.
- Missing control: durable singleton lease or per-window instance binding for PXE RPC.
- Exploit/violation scenario + preconditions: Firefox build, existing hidden PXE window survives SW restart, later account registration/prove/clear RPC is broadcast and executed by multiple PXEs.
- Why mitigations fail / reachability verdict: client drops duplicate responses after settlement, but duplicate side effects already happened.
- Recommended fix: maintain durable offscreen instance token, include it in every request, and have stale windows self-close or ignore mismatched tokens; consider minimal `tabs`/window rediscovery for Firefox cleanup.
- Needs Phase-4 verification: no

### [LOW] F-11: Password/passkey bearer material has weak lifetime and recovery properties
- Impact / CVSS factors: local/high-privilege heap or session-storage exposure can recover password-equivalent/passkey-derived material; no web path; confidentiality impact high only after local compromise.
- Confidence: high
- Cross-model: both
- OWASP/CWE: OWASP A02; CWE-522, CWE-759, CWE-916, CWE-226, CWE-316
- Instances: `packages/wallet-crypto/src/encryption-key.ts:77`; `packages/wallet-crypto/src/encryption-key.ts:97`; `packages/wallet-crypto/src/password-secret-box.ts:80`; `packages/wallet-crypto/src/password-secret-box.ts:122`; `packages/wallet-crypto/src/passkey-credential.ts:60`; `packages/wallet-crypto/src/zeroize.ts:17`
- Root cause + trace (source→sink, file:line each step): `getPasshash` is unsalted single SHA-256 at `encryption-key.ts:97-99`; `fromPasshash` treats it as PBKDF2 base key at `encryption-key.ts:87-89`; `seal` returns it at `password-secret-box.ts:80-84`; session persistence is F-06’s sink. Passkey HKDF output is copied through `Buffer.from(new Uint8Array(masterBits))` into `Fr` at `passkey-credential.ts:60`; only `masterBits` is zeroed at `:68`; zeroize caveat says copies and `Fr` internals are not cleared at `zeroize.ts:17-20`.
- Missing control: passhash bearer should be high-entropy/random or KDF-hardened with salt, and temporary buffers should be named and zeroized where possible.
- Exploit/violation scenario + preconditions: attacker with heap/session-storage read after unlock/passkey ceremony recovers bearer material; for weak passwords, SHA-256 bearer can be cracked offline.
- Why mitigations fail / reachability verdict: strict mode default reduces persistence but not transient material. Claude overstated “reversible” as universal; practical risk is offline cracking for human passwords plus bearer reuse.
- Recommended fix: redesign silent-restore bearer as random wrapping token or salted KDF output; zeroize `fromPassword` passhash in `finally`; avoid `Fr` for master-secret derivation or add wipeable scratch handling.
- Needs Phase-4 verification: no

### [LOW] F-12: Unsigned `DappSession` rows can mint grants if extension storage is tampered
- Impact / CVSS factors: valid JSON forged in extension storage can create grants and high `confirmationLevel`, but requires local/disk/extension-storage write; no web write path.
- Confidence: high
- Cross-model: codex-only
- OWASP/CWE: OWASP A01/A08; CWE-345, CWE-863, CWE-502
- Instances: `packages/wallet-core/src/storage/entity_storage.ts:49`; `packages/wallet-core/src/storage/entity_storage.ts:103`; `apps/extension/src/wallet/services/dapp-session/service.ts:53`; `apps/extension/src/wallet/services/dapp-session/service.ts:106`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:486`; `packages/wallet-bridge/src/dispatcher.ts:281`; `apps/extension/src/wallet/services/dapp-interaction/service.ts:443`
- Root cause + trace (source→sink, file:line each step): `EntityStorage` parses valid JSON as `T` at `entity_storage.ts:47-49` and returns rows at `:103-110`; dApp sessions use that storage at `dapp-session/service.ts:53`; auto-approval lookup trusts rows by profile/origin/chain at `dapp-session/service.ts:100-112` and `background.ts:486-488`; dispatcher loads same row at `dispatcher.ts:281`; interaction confirmation compares stored numeric `confirmationLevel` at `dapp-interaction/service.ts:442-443`.
- Missing control: persisted grants are not MACed, signed, or schema-validated on load.
- Exploit/violation scenario + preconditions: attacker with extension storage write plants a session row for `https://evil`; later discovery auto-approves and forged grants govern RPCs.
- Why mitigations fail / reachability verdict: Codex was right about effect; severity is Low because no attacker-controlled web write path was found. This is storage/disk-compromise-only.
- Recommended fix: Zod-validate session rows on load, clamp enum/range values, and MAC authorization rows with a profile-local key so storage tampering is detected.
- Needs Phase-4 verification: no

### [LOW] F-13: Malformed `ValueStorage` rows can abort wallet startup/restore
- Impact / CVSS factors: corrupted scalar storage row can brick config/session initialization; local/corruption only, availability impact.
- Confidence: high
- Cross-model: both
- OWASP/CWE: CWE-248, CWE-755, CWE-20
- Instances: `packages/wallet-core/src/storage/value-storage.ts:21`; `apps/extension/src/wallet/config/store.ts:18`; `apps/extension/src/wallet/runtime.ts:96`; `apps/extension/src/wallet/services/profile/session-manager.ts:138`; `apps/extension/src/wallet/services/profile/session-manager.ts:336`
- Root cause + trace (source→sink, file:line each step): `ValueStorage.get()` calls `JSON.parse` without try/catch at `value-storage.ts:18-22`; config load awaits it during runtime start at `config/store.ts:17-18` and `runtime.ts:95-98`; session restore uses the same primitive at `session-manager.ts:138` and `:335-336`.
- Missing control: no `parseOrDelete` equivalent for scalar storage.
- Exploit/violation scenario + preconditions: malformed `nulo:config` or `nulo:core:session` row exists from local tamper/corruption; startup or service init throws repeatedly.
- Why mitigations fail / reachability verdict: `EntityStorage` has containment, `ValueStorage` does not; no web-controlled write path found.
- Recommended fix: catch parse errors, log bounded metadata, delete/quarantine malformed scalar row, and return default/undefined.
- Needs Phase-4 verification: no

### [LOW] F-14: Seed/private-key export copies secrets to OS clipboard without clearing
- Impact / CVSS factors: user-triggered export leaves full recovery secret/private key on shared clipboard; local apps or permitted pages can read later; AV:L, UI:R, confidentiality high after user action.
- Confidence: high
- Cross-model: claude-only
- OWASP/CWE: OWASP A02; CWE-522, CWE-200
- Instances: `apps/extension/src/popup/pages/settings/security/export/seed.vue:67`; `apps/extension/src/popup/pages/settings/security/export/key.vue:77`
- Root cause + trace (source→sink, file:line each step): seed export stores phrase at `seed.vue:56-57` and copies via `navigator.clipboard.writeText` at `seed.vue:67-69`; private-key export stores key at `key.vue:67` and copies at `key.vue:77-79`; component state clears on unmount at `seed.vue:87-88` and `key.vue:97-99`, but clipboard is not cleared.
- Missing control: no timed clipboard clear or clear-on-close attempt; key page lacks the seed page’s clipboard warning.
- Exploit/violation scenario + preconditions: user copies seed/key to paste elsewhere; clipboard manager, synced clipboard, local app, or later page with clipboard permission reads it.
- Why mitigations fail / reachability verdict: this is user-assisted/local, not a dApp exploit; countdown only clears Vue state.
- Recommended fix: warn on both seed and key copy, attempt delayed clear when clipboard still equals the copied secret, and prefer masked/manual reveal with “copy at your own risk” friction.
- Needs Phase-4 verification: no

## Findings NOT pursued
- `bridge-core-channel` event-log spoofing: real faucet-side library issue in Claude leg, but `@nulo/bridge-core` is imported only by `apps/faucet`, not the extension.
- Build-time iframe origin impersonation: real if `VITE_NULO_ALLOW_IFRAME_DAPPS=1`, but shipped Chrome/Firefox build paths do not set that env var; default SW rejects subframes at `background.ts:172`.
- Offscreen no-sender-auth as High: missing check is real, but web reachability is blocked by no `externally_connectable` and the fixed SDK content-script envelope.
- `createAuthWit` “properly scope-bound” claim: dropped for raw `Fr`; kept only as true for inspectable structured intent shapes, subject to F-02 selector mismatch.
- Authwit/account-entrypoint binding and chunking bugs: not pursued; Claude verified binding sound for approved calls and no dropped calls at chunk boundaries.
- Chain XOR collision: mechanism exists at `chain-identity.ts:52`, but no concrete real-chain collision trace was shown; folded into recommendations for F-03.
- Fixed `Fr.ZERO` account salt: linkability/amplifier, not standalone fund-drain or authz bypass.
- dApp `feePayer` unscoped in dispatcher: popup-gated; no concrete downstream UI bypass shown.
- Operation-journal cross-profile reads: port service is popup/internal only today; no dApp exposure.
- Logger secret persistence: sanitizer gap is real, but no concrete current secret log source was found.
- Messaging background Port sender checks: missing defense-in-depth, but no web/external Port reachability without future manifest or relay changes.
- Plain backup checksum “tamper detection”: not treated as authenticity; only security impact kept is F-06 restore of security config.
- External links / `v-html` / JSON/log viewers: reviewed and no concrete untrusted HTML/script URL sink found.
- `grantPublicAuthwit` caller/args UI concerns: popup-gated and not enough concrete trace beyond F-07 display sanitization.

## Cross-cutting observations
- Rebuttal by cluster: crypto-core findings are local/hardening, not web-exploitable; wallet-core-storage’s unsigned sessions require storage write; messaging-boundary’s missing sender checks rely on external invariants that currently hold; bridge-dispatcher has the strongest web-reachable authz bugs; bridge-core is out of extension scope; aztec-runtime signing has a real chain TOCTOU but authwit call binding itself is sound; content-script iframe bypass is non-shipped while discovery flood remains; offscreen sender-auth is Low but Firefox duplicate listeners are real; sw-dapp-connection was right on discovery DoS but wrong on raw authwit scope binding; sw-services Claude was right on normal strict mode but missed restore ordering; popup/components converge on logo beacons, with method-label spoofing as a separate UI integrity issue.
- Web-reachable silent signing/authz bypasses dominate severity. Local storage, heap, clipboard, and offscreen hardening findings are intentionally Low unless a web write/reachability path exists.
- Root-cause dedupe was by boundary and sink: raw-hash authwit merged across dispatcher/runtime; dApp logo merged across popup/components; discovery DoS merged across content/SW; ValueStorage and Firefox offscreen duplicate-listener merged across both legs where applicable.

## Deferred / out-of-scope
- `bridge-core-channel` / `packages/bridge-core` is out of extension scope. It is consumed by `apps/faucet` only (`apps/faucet/package.json:35` and faucet source imports), so its address-unfiltered `parseEventLogs(...)[0]` faucet finding should be tracked in a faucet/bridge audit, not counted as a Nulo extension wallet finding.