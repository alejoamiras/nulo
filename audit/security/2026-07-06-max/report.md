# Harden Report: security

**Repo:** Nulo Aztec wallet (`nulo-2`) — browser extension + dependency-chain packages
**Date:** 2026-07-06
**Effort:** max
**Run ID:** 2026-07-06-max
**Models:** Phase-2 map — Claude Fable ×12 + Codex (high) ×12, one pair per cluster; Phase-2.5 rebuttal + Phase-3 reduce — Codex (high) coordinator + Claude Fable adversarial meta-review; Phase-4 verify — Codex (high) + Claude Fable, cross-family, independent re-read.
**Scope:** `apps/extension/src/**` plus the seven dependency packages it can import (`wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge`, and — after verification — `bridge-core` and `design`). **Excluded:** `apps/faucet`, `apps/landing`, `apps/playground`; all `*.test.ts` / `tests/e2e/**`; generated files. `packages/bridge-core` was found to be imported only by the faucet and is reported as out-of-scope.

---

## Executive summary

Nulo is a non-custodial MV3 wallet that holds Aztec private keys and signs L2 transactions on behalf of dApps. The audit was structured around the wallet's real attack surface: a malicious or compromised dApp web page driving the content-script → service-worker → `wallet-bridge` RPC path, plus secret-material handling and persisted-data trust. Fourteen findings survived cross-model consolidation and independent verification: **1 Critical, 2 High, 4 Medium, 7 Low**.

The headline theme is a single architectural weakness with three faces: **the dApp→wallet trust boundary validates message *shape* but not *semantics*.** The SW dispatcher accepts `unknown[]` args from the dApp channel and never binds the dApp-supplied `name` / `selector` / raw-hash to an authorized, artifact-verified action before it signs (F-08, the root enabler). Two concrete exploits fall out of it: a dApp holding a routinely-granted, **UI-invisible** `canCreateAuthWit` permission can get the wallet to **silently sign an arbitrary auth-witness** (F-01, Critical — a credible fund-drain), and a dApp can satisfy a granted function scope with a benign `call.name` while a different `call.selector` actually executes — **which also makes the approval popup lie about what is being signed** (F-02, High). Independently, transaction signing re-fetches chain identity *after* its own guard and signs over the second, unvalidated response (F-03, High TOCTOU).

Recommended priorities: (1) land the dispatcher hardening PR — reject opaque hashes, authorize the executable selector, and add server-side per-method arg validation (fixes F-01, F-02, F-08 together, and makes the approval UI trustworthy); (2) fix the chain-identity TOCTOU (F-03) by threading the already-validated chain info into signing; (3) sweep the cheap defense-in-depth items (CSP `img-src`, `ValueStorage` parse containment, clipboard clear, offscreen/messaging `sender.id` guards) so several Lows can't silently become Highs after a future manifest or relay change. None of the findings indicate an actively-exploited path in the *current shipped build*, but F-01 and F-02 are reachable by any dApp the user connects to and should be treated as ship-blockers.

---

## Methodology

Map-reduce, coordinator-of-specialists shape, per the `/harden` protocol at `max` effort.

- **Phase 1 (map).** The top-level repo map (`raw/repo-map.md`) was authored from the repo's own `ARCHITECTURE.md` + per-package READMEs + a directory/LOC inventory rather than spawned mapper agents — a documented deviation justified by the repo shipping a high-fidelity architecture doc. Twelve security clusters were defined by entrypoint / sink-family / trust boundary. Each Phase-2 agent still mapped its own cluster before auditing.
- **Phase 2 (map, ×12 clusters).** One Claude Fable agent **and** one Codex (high, read-only sandbox) agent per cluster — 24 independent audits — each with the same structured security prompt, threat model, and negative list. Inter-procedural traces capped at ~4 functions with one-hop handoff-edge escalation (content-script→SW, dispatcher→service, SW→offscreen, messaging-base→service).
- **Phase 2.5 + Phase 3 (rebuttal + reduce).** Absorbed into two parallel cross-family passes (an explicitly-blessed deviation in the skill's own methodology notes): a **Codex coordinator** rebutted both legs per cluster, deduped by root-cause+sink+boundary, and assigned CVSS v4.0 bands (`findings/consolidated.md`); a **Claude Fable adversarial meta-review** independently re-read the disputed code and challenged both legs (`findings/fable-challenge.md`). This preserved cross-family rebuttal on both sides.
- **Phase 4 (verify).** All Medium+ and every disputed finding were verified by the *other* family (Codex → `verify-codex.md`; Fable → `verify-fable.md`), each required to re-read the source and state its own conclusion before weighing the prior claim. Final reconciliation in `findings/verified.md`.

**Honest deviations from the formal `max` spec:** (a) 1 Fable + 1 Codex per cluster in Phase 2 rather than 2 of each; (b) Phase 2.5 blind cross-rebuttal folded into the Phase-3 coordinator + a dedicated Fable meta-review, rather than run as a separate per-cluster append; (c) Phase 4 verification concentrated on the band-deciding / disputed findings (F-01, F-02, F-03, F-05, F-06, F-08) — the remainder were already confirmed by two independent code-level reads (coordinator + meta-review), which meets the "both models confirm" bar. Cross-family coverage was held constant at every stage.

---

## Findings

Full per-step traces and all instances for every finding are in [`findings/consolidated.md`](findings/consolidated.md); verification evidence is in [`findings/verified.md`](findings/verified.md), [`findings/verify-codex.md`](findings/verify-codex.md), and [`findings/verify-fable.md`](findings/verify-fable.md).

### [CRITICAL] F-01: Raw-hash `createAuthWit` silently signs unscopable auth-witnesses
**Impact:** CVSS Critical band. A malicious connected dApp obtains the user's signature over an attacker-chosen raw `Fr` message hash — no per-request popup, no scope check. A forged auth-witness authorizes a third party/contract to act on the user's account → credible fund loss.
**Confidence:** high · **Found by:** both (Codex + Fable), verified by both
**Mapping:** OWASP A01; CWE-863, CWE-862
**Instances:** `packages/wallet-bridge/src/method-scope-checkers.ts:255,306`; `packages/wallet-bridge/src/dispatcher.ts:352,370,1156-1162`; `apps/extension/src/wallet/services/execution/service.ts:680-685`; approval-UI gap: `apps/extension/src/popup/windows/capabilities/build-items.ts:32`, `AccountSelectRow.vue:45`

**Trace.** dApp RPC enters the dispatcher as `unknown[]` (`dispatcher.ts:275`) → the `createAuthWit` scope checker enforces only `accounts.canCreateAuthWit` (`method-scope-checkers.ts:255`), scope-checks only *structured* `CallIntent`/`IntentInnerHash`, and lets a raw `Fr` fall through with "no semantic info" (`:306`) → the dispatcher routes non-popup methods straight to `executionService.executeOperations` (`dispatcher.ts:370`; `:352` lists only `sendTx`/`registerToken` as popup-gated) → execution parses the raw `Fr` (`service.ts:680`) and signs it (`:685`).

**Why it's Critical, not High.** The gating permission `canCreateAuthWit` is bundled into a routinely-requested `accounts` (account-selection) grant and is **not surfaced in the approval UI** — the capability view skips `accounts` cards entirely (`build-items.ts:32`) and the account row shows only identity/alias (`AccountSelectRow.vue:45`). The user therefore grants it without informed consent, and thereafter signing is fully silent. The typed SDK may not expose a raw `Fr`, but the dispatcher's `unknown[]` path (F-08) accepts it from a hand-crafted dApp frame.

**Recommended fix.** Reject opaque hashes from dApp-originated `createAuthWit`, or force an explicit per-request confirmation for them; prefer recomputing the hash from a structured `CallIntent` whose contract/function/**selector** are all authorized. Surface `canCreateAuthWit` in the approval UI. **Effort:** ~hours for the reject-opaque-hash guard; ~1 day with the UI surfacing.

### [HIGH] F-02: Function scope authorizes `call.name` while execution runs `call.selector` — and the approval popup shows the name
**Impact:** CVSS High. A dApp with a granted function scope (e.g. `transfer@TOKEN`) submits `{ name:"transfer", selector: approveSelector, args: approveArgs }`; the scope check passes on the benign `name`, the approval popup **renders "Transfer"**, and execution/signing uses `approveSelector`. Defeats both the machine scope check and the human approval.
**Confidence:** high · **Found by:** both (Codex Phase-2; both families at Phase-4), verified by both
**Mapping:** OWASP A01; CWE-863, CWE-20, CWE-451
**Instances:** `packages/wallet-bridge/src/method-scope-checkers.ts:121,160,174,281`; `apps/extension/src/wallet/services/execution/operation-planner.ts:207-219`; `tx-request-builder.ts:304,311,317`; `apps/extension/src/popup/windows/execute/index.vue:181`; `OperationCard.vue:183`

**Trace.** Scope checks compare grants to attacker-controlled `call.name` (`method-scope-checkers.ts:121/160/174/281`) → dispatcher forwards the call object unchanged (`dispatcher.ts:544,1134,1153`) → planner stores `selector` and `name` independently (`operation-planner.ts:212,215`) → the tx builder resolves the selector only to fill missing type/static fields and **never compares the ABI-resolved name to `action.name`** (`tx-request-builder.ts:304`), then executes `FunctionSelector.fromString(action.selector)` (`:317`) → the execute window copies the dApp op into popup state (`execute/index.vue:181`) and `OperationCard.vue:183` displays `call.name ?? call.selector`. The `parseTransferIntent` "verified transfer" block also keys on `name`, so even that reassurance is spoofable.

**Recommended fix.** Authorize the *executable selector*, not the name: resolve the selector against the contract artifact before authorization and reject when the supplied `name` disagrees with the ABI-resolved function; render the ABI-verified name (or the selector, when resolution fails) in the popup — never the raw dApp `name`. **Effort:** ~1 day. Ships with F-01/F-07/F-08.

### [HIGH] F-03: Transaction signing re-fetches unvalidated chain identity after the guard (TOCTOU)
**Impact:** CVSS High. An attacker-controlled or drifted RPC endpoint can return the correct chain info to pass the guard, then a *different* chain identity for the signing routine; the wallet signs/proves over the second, unvalidated identity.
**Confidence:** high · **Found by:** Fable (Phase-2) + both at reduce, verified by Codex
**Mapping:** OWASP A08/A01; CWE-367, CWE-345
**Instances:** `apps/extension/src/wallet/services/execution/tx-request-builder.ts:116-124,343`; `packages/aztec-runtime/src/account/nulo-account.ts:103-107,127,137,140`; reached via `dapp-send-executor.ts:153,351`

**Trace.** The builder fetches a first `node.getNodeInfo()` (`tx-request-builder.ts:119`) and validates it with `assertLiveChainIdentity` (`:124`), then hands the same node to `account.buildTxExecutionRequest` (`:343`); `NuloAccount` calls `getNodeInfo()` **again** (`nulo-account.ts:103`), builds `chainInfo` from that second response (`:104-107`), and signs/wraps with it (`:127,:137,:140`). The validated `(l1ChainId, rollupVersion)` is never passed into signing. Reached on the normal dApp send path via `buildStandard()`.

**Recommended fix.** Thread the already-validated chain info into `buildTxExecutionRequest()` and drop the internal re-fetch, or re-run `assertLiveChainIdentity` on the second response before constructing `chainInfo`. **Effort:** ~hours.

### [MEDIUM] F-04: dApp discovery can be flooded into unbounded queue / popup work
**Impact:** Availability. Any visited page can grow SW memory while the wallet is locked, or spawn repeated connect popups while unlocked, via unique request/chain IDs.
**Confidence:** high · **Found by:** both, verified at reduce
**Mapping:** OWASP A04; CWE-770, CWE-400
**Instances:** `apps/extension/src/content-script/content.ts:12`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:475,503,552`; `packages/wallet-bridge/src/discovery-queue.ts:20`; `apps/extension/src/wallet/services/window-manager/window-manager.ts:83`
**Recommended fix.** Cap pending discoveries globally and per origin/tab, reject unknown `chainId` before opening a popup, and coalesce locked-state discoveries by `(origin, chainId)`. **Effort:** ~hours.

### [MEDIUM] F-06: Backup restore can silently disable strict mode and persist the passhash
**Impact:** Confidentiality/authorization. Importing an attacker-crafted plaintext backup that sets `strictSecurityMode=false` causes the restored password profile to persist a base64 passhash bearer to `chrome.storage.session` — the exact material strict mode exists to keep out of storage.
**Confidence:** high · **Found by:** Codex, verified by Fable
**Mapping:** OWASP A01/A05; CWE-862, CWE-20
**Instances:** `apps/extension/src/composables/useFullBackupImport.ts:226,393-412`; `apps/extension/src/wallet/services/config/service.ts:45`; `apps/extension/src/wallet/services/profile/session-manager.ts:211-214`; `profile/service.ts:1082`

**Trace.** Config (including `strictSecurityMode`) is restored *before* profile activation (`useFullBackupImport.ts:393-403`) → `ConfigService.restore` writes raw props (`config/service.ts:45`) → `finalizeRestore` derives the passhash (`profile/service.ts:1082`) and `SessionManager.open()` persists it because strict is now off (`session-manager.ts:211`). The backup checksum (`:226`) is recomputable from attacker content — integrity, not authenticity.

**Recommended fix.** Validate backup config against an allowlist/schema; never restore `strictSecurityMode=false` (or `sessionTtl`) silently — default to strict unless the user explicitly confirms a security downgrade. **Effort:** ~hours.

### [MEDIUM] F-07: Approval UI renders dApp method labels/args without wire-string sanitization
**Impact:** Approval-display integrity. dApp-controlled Unicode/bidi (RLO)/zero-width/overlong method names and args are rendered on the signing confirmation via `humanizeMethodName` / `String(a)` with none of the `sanitizeWireString` treatment applied to dApp names elsewhere — a user can be visually misled about what they are signing.
**Confidence:** high (verified) · **Found by:** Fable, verified by Fable
**Mapping:** OWASP A04; CWE-451, CWE-176
**Instances:** `apps/extension/src/popup/windows/execute/OperationCard.vue:118,133,138,183,401,416,433`; `apps/extension/src/utils/tx-enrichment.ts:52`
**Recommended fix.** Route all dApp-authored labels/args through `sanitizeWireString` (or a stricter method-label sanitizer), clamp lengths in fixed UI rows, and prefer artifact-verified names. Ship with F-02 — together they make the confirmation UI trustworthy. **Effort:** ~hours.

### [MEDIUM] F-08: SW dispatcher consumes dApp RPC `unknown[]` with no server-side schema (root enabler)
**Impact:** Systemic trust-boundary weakness. The dApp-side `WalletSchema` (Zod) is a *client* control; the SW dispatcher accepts `args: unknown[]` and runs capability/scope checks over raw casts, so args are never semantically validated server-side. This is the substrate F-01 and F-02 stand on, and every future RPC inherits the risk.
**Confidence:** high (verified) · **Found by:** Fable, verified by Fable
**Mapping:** OWASP A03/A08; CWE-20, CWE-501, CWE-843
**Instances:** `apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:50`; `background.ts:637`; `packages/wallet-bridge/src/dispatcher.ts:275,328,544,1134,1162`
**Recommended fix.** Add a SW/dispatcher-side per-method schema table and parse `args` **before** capability/scope checks and casts; reject unknown fields where semantic binding matters. **Effort:** ~1-2 days (highest structural leverage — closes the class, not just the instances).

### [LOW] F-05: dApp `logo` wired to unrestricted `<img src>` + no `img-src` CSP (latent)
**Impact:** Latent privacy beacon / UI-spoof. The render sinks exist and the manifest CSP has no `img-src`/`default-src`, so a dApp-supplied logo URL *would* be fetched by extension pages before approval — **but there is no production writer** for the field today, so it is dormant. It becomes a live Medium the instant any path plumbs a dApp logo.
**Confidence:** high · **Found by:** both (recalibrated Medium→Low)
**Mapping:** OWASP A05/A01; CWE-200, CWE-359, CWE-1021
**Instances (sinks):** `apps/extension/src/composables/useDappInteractionPayload.ts:90-93`; `components/composite/DappIdentityBlock.vue:40`; `popup/windows/verify/index.vue:161,199`; `popup/pages/settings/connected-apps/index.vue:43,144`, `[id].vue:83,202`. CSP: `apps/extension/manifest/manifest.config.ts:42`. Sole `dappMetadata` constructor (no `logo` key): `apps/extension/src/wallet/services/wallet-sdk/background.ts:535-541`.
**Recommended fix.** Add `img-src 'self' data: blob:` (or stricter) to the CSP now, and if remote logos are ever wanted, fetch through a wallet-controlled sanitizer that re-encodes to `blob:`. **Effort:** ~minutes (CSP one-liner) — cheapest defense-in-depth in the report.

### [LOW] F-09: Offscreen PXE listener lacks sender/context authentication (defense-in-depth)
**Impact:** The offscreen document's `chrome.runtime.onMessage` handler routes on `message.to === "pxe"` and ignores Chrome's `sender`, so any extension context that can emit a top-level `{to:"pxe"}` message could invoke privileged PXE RPCs (`registerAccount`, `proveTx`, `clearChainState`) outside SW authorization. **Not web-reachable today** — no `externally_connectable`, and `content.ts` relays only via `sendMessage` inside a fixed SDK envelope that can't set a top-level `to`.
**Confidence:** high (code) / low (reachability) · **Found by:** Fable (recalibrated High→Low)
**Mapping:** OWASP A01; CWE-306, CWE-862
**Instances:** `packages/extension-messaging/src/offscreen/service.ts:36-48`; `apps/extension/src/offscreen/index.ts:14`; `apps/extension/src/wallet/utils/offscreen.ts:47,80`
**Recommended fix.** Add a `sender.id === chrome.runtime.id` guard (and reject tab/content-script senders) in the offscreen service listener, mirroring the `content-script-validator` subframe defense; add a nonce/instance token to lifecycle ping/ready. **Effort:** ~hours. Do it now so this stays a non-issue if the relay/manifest ever changes.

### [LOW] F-10: Firefox offscreen fallback can duplicate PXE listeners after SW restart
**Impact:** Integrity/availability on Firefox. The hidden-window id is module-local; an SW restart loses it, a new window is created, and both windows receive broadcast `{to:"pxe"}` RPCs — a secret-bearing RPC (e.g. `registerAccount`) can be handled by multiple PXEs.
**Confidence:** high · **Found by:** both
**Instances:** `apps/extension/src/wallet/utils/offscreen.ts:45,183,201,215`; `packages/extension-messaging/src/offscreen/client.ts:104`; `offscreen/service.ts:36`
**Recommended fix.** Maintain a durable offscreen instance token, include it in every request, and have stale windows self-close or ignore mismatched tokens. **Effort:** ~hours-day.

### [LOW] F-11: Password/passkey bearer material has weak lifetime/recovery properties
**Impact:** Confidentiality after local compromise (no web path). The silent-restore bearer is an unsalted single `SHA-256(password)` (offline-crackable for human passwords, and password-equivalent); passkey HKDF output is copied into an `Fr` whose internal buffer isn't zeroized.
**Confidence:** high · **Found by:** both
**Mapping:** OWASP A02; CWE-522, CWE-759, CWE-916, CWE-226
**Instances:** `packages/wallet-crypto/src/encryption-key.ts:77,97`; `password-secret-box.ts:80,122`; `passkey-credential.ts:60`; `zeroize.ts:17`. (The AES-GCM/PBKDF2 core itself is sound: CSPRNG IV, unique per-message key+nonce, 600k iterations, GCM integrity enforced.)
**Recommended fix.** Redesign the silent-restore bearer as a random wrapping token or salted-KDF output; zeroize the `fromPassword` passhash in a `finally`; avoid `Fr` for master-secret derivation or add wipeable scratch handling. **Effort:** ~days (touches vector-locked crypto — keep `key-vectors.test.ts` byte-identical).

### [LOW] F-12: Unsigned `DappSession` rows can mint grants if extension storage is tampered
**Impact:** Authorization integrity, storage-write precondition only. Persisted dApp-session/grant rows are not MACed, signed, or schema-validated on load, so valid JSON planted in extension storage can create grants and a high `confirmationLevel`. No web write path found.
**Confidence:** high · **Found by:** Codex
**Mapping:** OWASP A08; CWE-345, CWE-863, CWE-502
**Instances:** `packages/wallet-core/src/storage/entity_storage.ts:47-49,103`; `apps/extension/src/wallet/services/dapp-session/service.ts:53,100-112`; `background.ts:486`; `dispatcher.ts:281`; `dapp-interaction/service.ts:443`
**Recommended fix.** Zod-validate session rows on load, clamp enum/range values, and MAC authorization rows with a profile-local key so tampering is detected. **Effort:** ~hours-day.

### [LOW] F-13: Malformed `ValueStorage` rows can abort wallet startup/restore
**Impact:** Availability (local corruption only). `ValueStorage.get()` calls `JSON.parse` with no try/catch, so one corrupt `nulo:config` / `nulo:core:session` row throws on every read — asymmetric with `EntityStorage`, which already contains bad rows.
**Confidence:** high · **Found by:** both
**Mapping:** CWE-248, CWE-755
**Instances:** `packages/wallet-core/src/storage/value-storage.ts:18-22`; `apps/extension/src/wallet/config/store.ts:18`; `runtime.ts:96`; `session-manager.ts:138,336`
**Recommended fix.** Mirror `EntityStorage`'s `parseOrDelete`: catch parse errors, log bounded metadata, quarantine/delete the malformed row, return default/undefined. **Effort:** ~hours.

### [LOW] F-14: Seed/private-key export copies secrets to OS clipboard without clearing
**Impact:** Confidentiality after a user action (local). Export copies the full recovery phrase / private key via `navigator.clipboard.writeText` and never clears it; the key page lacks even the seed page's warning. A clipboard manager, synced clipboard, or later permitted page can read it.
**Confidence:** high · **Found by:** Fable
**Mapping:** OWASP A02; CWE-522, CWE-200
**Instances:** `apps/extension/src/popup/pages/settings/security/export/seed.vue:67`; `key.vue:77`
**Recommended fix.** Warn on both copy actions, attempt a delayed clipboard clear when it still equals the copied secret, and add "copy at your own risk" friction. **Effort:** ~hours.

---

## Findings NOT pursued (with reasoning)

- **`packages/bridge-core` event-log emitter-trust** — real library issue but imported only by `apps/faucet`; out of extension scope. Track in a faucet audit.
- **Build-time iframe origin impersonation** — only reachable if `VITE_NULO_ALLOW_IFRAME_DAPPS=1`, which shipped Chrome/Firefox builds do not set; SW rejects subframes by default (`background.ts:172`).
- **Authwit / account-entrypoint call binding + multi-call chunking** — Fable traced a 12-call payload end-to-end against upstream `@aztec/entrypoints@5.0.0-rc.2`; the outer signature transitively commits every wrapper's `args_hash`, no hidden call rides along, no chunk boundary drops a binding. Sound. (This is the *signature-binding* layer; it is distinct from F-01/F-02, which are *authorization/scope* bugs.)
- **Fixed `Fr.ZERO` account salt** — cross-chain address linkability/amplifier, not a standalone authz/fund bug.
- **Chain-identity XOR fold collision** (`chain-identity.ts:52`) — mechanism exists but no concrete real-chain collision was demonstrated; folded into F-03's fix.
- **`feePayer` unscoped in dispatcher** — popup-gated; no concrete downstream bypass shown.
- **Operation-journal cross-profile reads / logger secret-key redaction gap** — real latent gaps but no current dApp-exposure or confirmed secret source.
- **Messaging background `Port` sender checks** — same root cause as F-09; missing defense-in-depth held up by the same external boundary invariant.
- **`v-html`/`innerHTML`/eval, JSON/Log viewers, external links** — reviewed; no untrusted HTML/script/URL sink found (a `v-html` tripwire test exists; JsonViewer/LogsViewer render via CodeMirror as text; `explorerUrl` uses a fixed https allowlist).

## Cross-cutting observations

**1. The dApp→wallet boundary checks shape, not semantics.** Zod/envelope validation proves a message is parseable; nothing binds the dApp-supplied `name` / `selector` / raw-hash to an authorized, artifact-verified action before the wallet signs. F-08 is the substrate; F-01 and F-02 are its two sharpest exploits. The single most valuable structural fix in this report is server-side, per-method arg validation + selector-based authorization at the dispatcher.

**2. The approval popup — the human's last line of defense — can be made to misrepresent what is signed.** F-02 (name shown, selector executed), F-07 (unsanitized bidi/homoglyph labels), and the UI-invisible `canCreateAuthWit` grant behind F-01 all erode "what you see equals what you sign." These should be treated as one theme and fixed together; a scope fix that still renders attacker-controlled text is only half a fix.

**3. Several Lows are safe only because of external boundary invariants that could silently change.** F-09 (offscreen sender-auth), F-12 (unsigned session rows), and the messaging `Port` sender gap are all non-issues *today* purely because there is no `externally_connectable` and the content-script relay uses a fixed SDK envelope. A future manifest permission or a relay refactor would convert them to Highs with no code change at the vulnerable site. Add the `sender.id === chrome.runtime.id` guards and row integrity now, so safety is self-enforcing rather than incidental.

**4. Local-attacker secret hygiene is soft but not web-exploitable.** F-06, F-11, F-14 (and the logger redaction gap) don't help a remote dApp, but they weaken the wallet against local malware, a shared/synced clipboard, or heap inspection. Reasonable to batch as a "local hardening" PR after the dApp-boundary fixes.

## Coupled fixes (ship together)

- **F-01 + F-02 + F-08** — one dispatcher-hardening PR (reject opaque hashes; authorize the executable selector against the artifact; add server-side per-method schema validation). Fixing any one alone leaves the boundary weak.
- **F-02 + F-07** — the confirmation UI must both authorize the real selector and sanitize/label it truthfully.
- **F-05 CSP** — add `img-src` alongside any future remote-content work; pairs with the general CSP tightening.
