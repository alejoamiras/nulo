# Fable cross-family adversarial meta-review — challenge

Method: I read the cited source before weighing either leg. Every verdict below is
anchored to code I opened myself (file:line). Repo-relative paths only.

**Headline recalibrations:** two of the "converged/High" items shrink and one grows.
The offscreen HIGH and the logo-beacon MEDIUM are both **not web-reachable in the
shipped build** and drop to LOW. The name-vs-selector bypass (codex-only) is the
**most under-rated** finding — it defeats the `sendTx` approval popup and every
silent path, and it also unravels `createAuthWit`'s structured-intent scope check.

---

## Dispute 1 — `createAuthWit` raw-hash silent-signing

**Verdict: CONFIRM. Band: High.** The dispatcher+aztec legs are right; the
`ext-sw-dapp-connection` leg's "properly scope-bound, verified present, not a hole
here" is **wrong**.

**Independent evidence (read myself):**
- `packages/wallet-bridge/src/method-scope-checkers.ts:255-308` — `checkCreateAuthWit`.
  The accounts-level check (`:265-267`) requires only `canCreateAuthWit`. For the raw
  `Fr` form the function **falls through to the end with no call-scope check** — the
  literal comment at `:306-308`: "Raw Fr message hash … no semantic info to validate
  beyond the accounts-level check above."
- Even the structured branches only throw `if (hasTxCaps && !permitted)`
  (`:283`, `:298`); with `canCreateAuthWit` but no transaction/simulation grant,
  `callWithinTxOrSimulationScope` returns `{hasTxCaps:false}` (`:225`) → **no throw**.
- `packages/wallet-bridge/src/dispatcher.ts:355-374` — only `sendTx`, `registerToken`,
  `grantPublicAuthwit` route through `DappInteractionService` (the popup). `createAuthWit`
  falls to `METHOD_TO_KIND` → `buildOperation` → `executionService.executeOperations`
  (`:370-373`). **No popup.**
- Sink `apps/extension/src/wallet/services/execution/service.ts:680-685` — raw branch
  `messageHash = await Fr.schema.parseAsync(op.messageHashOrIntent)` then
  `account.createAuthWit(messageHash)`. The only gate before it is
  `assertLiveChainIdentity` (`:650`), which binds the hash to the chain, not to any scope.

**What was missed:** the minimal grant is even smaller than the exploit stories say —
just `accounts` with `canCreateAuthWit: true`; **no** transaction grant is needed for the
raw form. An authwit is a blank-check pre-authorization; the attacker contract consumes
it in its own tx, so there is no second user interaction. High stands.

---

## Dispute 2 — name-vs-selector scope bypass (codex-only)

**Verdict: CONFIRM. Band: High (I RECALIBRATE UP from codex's framing).** fable/claude
did not raise it. This is the single most consequential finding in the set.

**Independent evidence (read myself):**
- Authorization gates on `call.name`:
  `method-scope-checkers.ts:121` (`checkTransactionCalls` → `matchesScope(String(call.to), call.name, …)`),
  `:160` (simulation), `:174` (`checkExecuteUtility`, `fn = call.name`),
  `:281` (`createAuthWit` CallIntent, `fn = intent.call.name`).
- Execution keys on `call.selector`:
  `apps/extension/src/wallet/services/execution/operation-planner.ts:207-219` — parses the
  wire `FunctionCall` and stores **both** `selector: call.selector.toString()` (`:212`) and
  `name: call.name` (`:215`).
  `apps/extension/src/wallet/services/execution/tx-request-builder.ts:311-324` — builds the
  executable `FunctionCall` from `FunctionSelector.fromString(action.selector)` (`:317`);
  `fnName = action.name || action.selector` (`:311`) is display-only metadata.
- `FunctionCall.schema.parseAsync` (`operation-planner.ts:208`) validates shape only — it
  does **not** verify `selector == computeSelector(name)` against the target artifact. No
  code binds `name` to `selector`.

`call.to` **is** consistent between check and execution (both use `call.to`), so the
escalation is confined to *any function on an already-granted contract* — which, for a
token, is `approve`/`burn`/`transfer-to-attacker` = asset loss.

**What BOTH legs missed (the amplification):**
1. **The `sendTx` popup does not protect against this.** `OperationCard.vue:118` renders
   `humanizeMethodName(action.name ?? action.selector)` — the card shows the attacker's
   `name`. A call `{name:"transfer", selector:approve_sel}` renders a clean "Transfer" and
   the user approves it while `approve` executes. The popup gate cited as the mitigant for
   `sendTx` is **defeated by design**.
2. **It also unravels `createAuthWit`'s CallIntent scope check** (thought to be the "safe"
   structured form). `execution/service.ts:657-672` builds the `FunctionCall` from
   `call.selector` (`:664`) and `computeAuthWitMessageHash` signs over the selector/args —
   **not** the `name` the scope checker validated at `method-scope-checkers.ts:281`. So
   Dispute 1 is broader than "raw hash only": the structured CallIntent path is *also*
   scope-bypassable via name/selector mismatch.
3. `simulateTx`/`executeUtility`/`profileTx` are silent (Dispute 1 routing) → the sim/utility
   scope bypass is a **no-popup** confidentiality escalation (reads private state on functions
   the dApp was not scoped for).

Net: function-level scope is decoupled from every downstream artifact (execution, signature,
and the approval display). High.

---

## Dispute 3 — offscreen no-sender-auth reachability

**Verdict: REFUTE as HIGH → LOW (defense-in-depth only). Not web-reachable.** The
offscreen-claude leg already rated end-to-end exploitability "moderate" and deferred the
reachability question to cluster 7; I resolve it against reachability.

**Independent evidence (read myself):**
- `packages/extension-messaging/src/offscreen/service.ts:36-49` — the listener's only gate is
  `message.to === this.name` (`"pxe"`); `sender` is never bound. The missing check is **real**.
- `apps/extension/src/content-script/content.ts:11-22` — the sole page→extension relay; it
  hands page data to the SDK `ContentScriptConnectionHandler` and relays via
  `chrome.runtime.sendMessage(message)`.
- SDK handler (installed dist, read directly):
  `~/.bun/install/cache/@aztec/wallet-sdk@5.0.0-…/dest/extension/handlers/content_script_connection_handler.js:94-137`
  — **every** `sendToBackground` uses a fixed envelope
  `{ origin: MessageOrigin.CONTENT_SCRIPT, type: InternalMessageType.<CONST>, sessionId, content: data }`.
  The page-controlled `data` is nested under `.content`; the page cannot set a top-level `to`.
  So the offscreen guard evaluates `undefined === "pxe"` → **false** → rejected.
- `apps/extension/manifest/manifest.config.ts` — **no `externally_connectable`**, no
  `onMessageExternal`. Web pages cannot address `chrome.runtime` at all; only the extension's
  own contexts can, and the content script only ever emits the fixed envelope above.

**Conclusion:** a malicious web page **cannot** produce a top-level `to:"pxe"` message. The
gap is a genuine one-line hardening item (add `sender.id === chrome.runtime.id && sender.tab
=== undefined`), but it is defense-in-depth, not a live High. Same disposition for the
offscreen PING/PONG/READY control-message listeners (`offscreen/index.ts:14-19`,
`wallet/utils/offscreen.ts:47-55,80-87`). The offscreen-**codex** Firefox-zombie duplicate-PXE
finding is a separate internal-lifecycle bug (Firefox-only, feature-flagged) → Low.

---

## Dispute 4 — backup-restore silently disables strict mode + persists passhash

**Verdict: CONFIRM (mechanics). Band: RECALIBRATE to Medium.** codex is mechanically right;
fable's "non-persistence VERIFIED correct" is correct for the *normal* flow but **missed this
restore bypass**. codex's framing reads higher than the preconditions justify.

**Independent evidence (read myself):**
- `apps/extension/src/composables/useFullBackupImport.ts:391-403` — the `CONFIG_SERVICE_NAME`
  slice from the (attacker-craftable) backup is `client.restore(sliceData)`-ed, and this runs
  **before** `finalizeRestore` at `:412`.
- `apps/extension/src/wallet/services/config/service.ts:45-51` — `restore()` loops each prop
  through `setValue` with **no allowlist/schema**.
- `apps/extension/src/wallet/config/store.ts:28-36` — `set()` writes `this.config[key]=value`
  and fires `onUpdate` with **no key/type validation**; the update propagates to `SessionManager`
  (subscribed via `ConfigService.onConfigUpdated`, `config/service.ts:22,63-65`).
- `apps/extension/src/wallet/services/profile/session-manager.ts:211-214` —
  `persistPasshash = passhash !== undefined && !this.strictSecurityMode`; a restored
  `strictSecurityMode:false` makes this `true` → passhash base64 written to `chrome.storage.session`.
- `apps/extension/src/wallet/services/profile/service.ts:1082-1084` — `finalizeRestore` derives
  the passhash and calls `open(profile, secret, passhash)`. Confirmed reachable.

**Why Medium not High:** (a) the precondition is a **user importing an attacker-crafted full
backup** (a high-trust, destructive, socially-engineered action); (b) the plaintext-backup
checksum is a non-keyed SHA over the same file (`useFullBackupImport.ts:226`) so it is not an
authenticity control — but the harm is a **downgraded posture** (passhash persisted to
TRUSTED-context session storage; `sessionTtl:0` is also injectable → never-locks), not direct
theft; (c) monetizing the persisted passhash still needs a **separate** `chrome.storage.session`
read capability. Actionable defect (real): `ConfigStore.set`/`ConfigService.restore` need a
runtime allowlist + type-check, and a confirmation gate for `strictSecurityMode`/`sessionTtl`
on the restore path (the settings-page confirmation is bypassed).

---

## Dispute 5 — unsigned `DappSession` rows mint grants

**Verdict: CONFIRM (integrity gap is real). Band: RECALIBRATE to Low-Medium.** codex is right
that the rows are unauthenticated; the severity is capped by an **already-compromised
local-storage** precondition (there is no dApp/web write path). fable did not file it (deferred
the sink to the services cluster in Note B) — an under-coverage, not a wrong call.

**Independent evidence (read myself):**
- `apps/extension/src/wallet/services/dapp-session/service.ts:53` — backed by `EntityStorage`
  (`JSON.parse(raw) as T`, no schema/MAC — confirmed both wallet-core-storage legs).
- Read paths trust the row wholesale: `:65` (`getDappSessions` filters only `profileId`),
  `:100-108` (`tryGetDappSessionByOriginAndChain` — used for auto-approve), `:260-264`
  (`getCapabilityGrants` returns stored grants verbatim).
- **No web-reachable write path:** the only writers are the service RPCs (`addDappSession`
  `:117-152` mints a 256-bit id and is popup-gated; `setCapabilityGrants` `:246-258`) which are
  port-RPC popup-only. The manifest has no `externally_connectable`, and these methods are **not**
  in the wallet-bridge dispatcher's dApp method registry — a dApp cannot call them over the channel.

**Conclusion:** forging a grant requires the attacker to already hold `chrome.storage.local`
write (extension-context code-exec, or on-disk profile access) — capabilities that already imply
broad compromise. The marginal gain is downgrading connect/execute **popups to silent**
(forged `confirmationLevel:999` clears the confirm gate) while the wallet is unlocked. Real
hardening item: **authenticate/version persisted authorization rows** (MAC or bind the session
id to `(profileId,origin,chainId)`, validate at load). Note the **systemic** shape — the same
"no integrity on `EntityStorage` rows" applies to `contacts`/`tokens`/`networks`/`accounts`,
not just `dappSessions`.

---

## Dispute 6 — build-time iframe origin impersonation (codex-only)

**Verdict: CONFIRM (conditional). Band: RECALIBRATE to Low / informational — the flag is unset
in the shipped build.** codex correctly conditioned it on the build flag; as a *shipped*
vulnerability it is not live.

**Independent evidence (read myself):**
- `apps/extension/src/wallet/services/wallet-sdk/background.ts:68` —
  `NULO_ALLOW_IFRAME_DAPPS = import.meta.env?.VITE_NULO_ALLOW_IFRAME_DAPPS === "1"` (default false);
  `:172` — subframe reject is active whenever the flag is not `"1"`.
- Repo-wide grep: `VITE_NULO_ALLOW_IFRAME_DAPPS` appears **only** inside `background.ts` (the
  reader). It is set in **no** `.env`, CI workflow, vite config, or build script. The two
  `.env.example` hits are unrelated apps (faucet, bridge/evm).

**Conclusion:** the shipped build rejects subframe senders by default; the flag is a documented,
default-secure, build-time toggle with a security rationale in-code (`:57-67`). Reachable only if
someone builds with `=1`. Keep as an informational/hardening note (consider frame-scoped origin
attribution if iframe dApps are ever enabled), not a shipped High.

---

## Converged Medium sanity-check A — dApp `logo` `<img :src>` beacon

**Verdict: RECALIBRATE Medium → Low (latent). The field is never populated from dApp input in
the shipped code.** This is a genuine **claude-vs-codex disagreement and codex is right**;
both claude legs (popup-sensitive, components-design) overstated it by inferring reachability
from the *type* + the copy + the sink without confirming a writer.

**Independent evidence (read myself):**
- CSP is as claimed: `apps/extension/manifest/manifest.config.ts:41-43` —
  `script-src 'self' 'wasm-unsafe-eval'` only; **no `img-src`/`default-src`/`connect-src`**. (COEP
  `require-corp` at `:44-45` does **not** save it — the request is dispatched before the response
  CORP check, and the attacker controls their own CORP header anyway; `data:` UI-spoof is
  unaffected. So *if* the field were populated the beacon would fire.)
- Sink exists: `apps/extension/src/components/composite/DappIdentityBlock.vue:40` —
  `<img v-else-if="dapp?.logoBlobUrl" :src="dapp?.logoBlobUrl">`; fed by
  `useDappInteractionPayload.ts:92` `if (meta.logo) meta.logoBlobUrl = meta.logo`.
- **But `dappMetadata.logo` has no writer.** Grep across `apps/extension/src` + `packages` for
  any `logo:` object-literal or `.logo =` assignment returns **nothing** in production. The
  discovery payload sets only `{name, url}` (`background.ts:536-540`); the dApp-interaction
  payload builds `{ name: … }` only (`dapp-interaction/service.ts:339`); no `appIcon`/`icon`→`logo`
  mapping exists. `spec.ts:30 logo?: string` is a type field the claude legs mistook for a source.

**Conclusion:** the `<img>` renders a dApp URL only if a future change wires a dApp `logo`/`icon`
into `dappMetadata.logo`; today it never does. **Latent/Low**, not a live Medium. Real residual:
add `img-src`/`connect-src`/`default-src 'none'` to the CSP now, and a scheme-allowlist +
re-encode gate before any future `logo` wiring.

---

## Converged Medium sanity-check B — OperationCard method-name / authwit-arg spoofing

**Verdict: CONFIRM Medium. claude is right; codex missed it** (codex saw the identity
sanitizer and generalized "OperationCard has wire-string sanitization").

**Independent evidence (read myself):**
- Identity/name **is** sanitized: `OperationCard.vue:232` `safe(dapp?.name, 64)`
  (the `sanitizeWireString` alias), and `DappIdentityBlock.vue:33` `sanitizeWireString(props.dapp.name, 64)`.
- Method-name/args bindings are **not**:
  `OperationCard.vue:118` `humanizeMethodName(action.name ?? action.selector)`,
  `:133`/`:149` authwit method via `humanizeMethodName`, `:138`
  `action.content.args.map((a) => String(a)).join(", ")`, `:159` raw `messageHash` — **none**
  routed through `safe`/`sanitizeWireString`.
- `apps/extension/src/utils/tx-enrichment.ts:52-65` — for an unknown name, `humanizeMethodName`
  returns `method.replace(/_/g," ").replace(/\b\w/g, upper)` with **no `\p{Cf}`/bidi/zero-width
  strip and no length clamp**.

**Conclusion:** Vue escapes HTML (no script-XSS), but the sole human signing checkpoint renders
attacker method labels/args without Unicode/length neutralization → bidi/homoglyph/length-overflow
misrepresentation (CWE-451). Medium. Its severity is **amplified by Dispute 2**: because the card
renders `name` and the executed artifact is `selector`, a `name:"transfer"` label displays cleanly
("Transfer") while `selector` executes something else — the display faithfully shows the *wrong*
thing. Fix: run method-name + args through `sanitizeWireString` **and** display/verify the
selector-derived identity, not the dApp `name`.

---

## Cross-cutting note (both legs under-connected)

The through-line of Disputes 1, 2, and Medium-B is one root cause: **dApp `call.name` is treated
as authorization-and-display truth while `call.selector` is execution-and-signature truth, with no
binding between them.** Fixing name↔selector consistency at the dispatcher (resolve the selector
from the authorized name against the target artifact and reject mismatches, or authorize the
selector directly) closes the `sendTx`/`simulateTx`/`executeUtility`/`profileTx` scope bypass,
the `createAuthWit` CallIntent bypass, and removes the approval-popup spoof in one move. Raw-hash
`createAuthWit` (Dispute 1) additionally needs either rejection of opaque hashes from dApps or a
per-request popup.
