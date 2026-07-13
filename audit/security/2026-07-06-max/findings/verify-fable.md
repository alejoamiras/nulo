# Phase-4 verification — Fable leg (F-05, F-06, F-02-approval, F-08)

Independent re-read of cited source. Each item: my own conclusion from the code first, then confirm/refute + final band. Repo-relative citations.

---

## F-05 — dApp `logo` `<img :src>` beacon: is there a production WRITER?

**VERDICT: REFUTED** (as a live Medium; the beacon is DORMANT/LATENT). The Fable meta-review is correct: **NO production writer exists** for `dappMetadata.logo` on the shipped path.

**Independent evidence (file:line):**
- The *only* place a `dappMetadata` object is CONSTRUCTED from dApp-supplied discovery data: `apps/extension/src/wallet/services/wallet-sdk/background.ts:535-541` — reads `discovery.appName ?? discovery.appId` and `discovery.origin` only, and builds `{ name: sanitizeWireString(rawAppName, 64), url: discovery.origin }`. **No `logo` key is written.** Even if the upstream SDK `PendingDiscovery` carried an icon, Nulo does not spread it — it hand-constructs the object from exactly three source fields (`appName`, `appId`, `origin`).
- The sole session persistence call: `background.ts:565` `dappSessionService.addDappSession(params.dappMetadata, …)` passes that same name+url object; `apps/extension/src/wallet/services/dapp-session/service.ts:139` stores `dappMetadata: dappMetadata` verbatim — nothing adds a logo.
- `DappMetadata.logo?: string` exists in the type (`apps/extension/src/wallet/services/dapp-session/spec.ts:30`) but is never assigned. Grep for any write to `.logo` (excluding `logoBlobUrl`/`loadingLogo`) across `apps/extension/src` + `packages`: **zero hits.** Every `.logo` occurrence is a READ that copies into `logoBlobUrl` (`useDappInteractionPayload.ts:92`, `connected-apps/index.vue:43`, `connected-apps/[id].vue:83`, `verify/index.vue:161`).
- All three interaction-payload sources resolve `dappMetadata` to the stored (name+url) session or the discovery params: execute `dappOf: (p) => p.session.dappMetadata` (`execute/index.vue:120`), capabilities `p.session.dappMetadata` (`capabilities/index.vue:79`), verify reads the stored `DappSession`. None can carry a logo.
- Capability path does not inject metadata: `CapabilityManifest` (`packages/wallet-bridge/src/dispatcher.ts:240-243`) has an index signature but `handleRequestCapabilities` (dispatcher.ts:695+) writes no `dappMetadata`/`logo`.
- Backup/local path cannot inject it either: `dapp-session` is NOT in the `backupServices` restore list (`useFullBackupImport.ts:381-392`), so a malicious backup cannot plant a `dappMetadata.logo`.
- **CSP genuinely lacks img-src/default-src — CONFIRMED:** `apps/extension/manifest/manifest.config.ts:41-42` = `content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'"`. No `img-src`, no `default-src` → IF a `logo` URL were ever populated, the `<img :src="logoBlobUrl">` sinks (`DappIdentityBlock.vue:40`, `verify/index.vue:199`, `connected-apps/index.vue:144`, `[id].vue:202`) WOULD fetch it unrestricted.

**Final band: LOW (latent / defense-in-depth).** The copy→`logoBlobUrl`→`<img :src>` plumbing is fully wired and the CSP gap is real, but the source field is always `undefined` on every shipped path, so no attacker URL is ever fetched today. The "5 render sinks → Medium" legs conflate *wired plumbing* with a *live data flow*. It becomes Medium the instant any code plumbs a dApp-supplied icon into `dappMetadata.logo` (a plausible near-future change, given the fully-built render path) — so the fix (`img-src 'self' data: blob:` + a sanitizer) is still warranted as hardening.

**Notes:** Definitive answer to the decisive question — **production writer: NONE.** Proof-of-absence site: `background.ts:535-541`. The `useDappInteractionPayload.ts:48-49` TSDoc ("post-#29 the privacy gate is gone") confirms a re-encoding gate was intentionally removed, which is why the concern was raised — but removal of the gate is moot while nothing populates the field.

---

## F-06 — backup restore disables strict mode + persists passhash

**VERDICT: CONFIRMED.**

**Independent evidence (file:line):**
- **Checksum is integrity-only, recomputable from attacker content (NOT authenticity):** `apps/extension/src/composables/useFullBackupImport.ts:226-227` — `comparisonChecksum = await EncryptionKey.getHashHex(JSON.stringify(backup))`, compared to the `checksum` field that was split OUT of the same object at `:207` (`const { checksum, ...backup } = fullBackup`). An attacker crafting a plaintext backup simply recomputes the SHA-256 hex over their own `backup` body. No key, no signature.
- **Ordering — config (incl. `strictSecurityMode`) restored BEFORE profile activation:**
  - Config restore runs in the `backupServices` loop at `useFullBackupImport.ts:393-403`; `CONFIG_SERVICE_NAME` is a member of that list (`:391`). Each slice calls `client.restore(sliceData)`.
  - `apps/extension/src/wallet/services/config/service.ts:45-50` `restore()` iterates props and calls `this.setValue(cp.key, cp.value)` **raw — no allowlist, no schema, no per-key guard.** A backup carrying `{ key: "strictSecurityMode", value: false }` is written directly.
  - `setValue` → config store emits `onUpdate` → SessionManager's handler at `apps/extension/src/wallet/services/profile/session-manager.ts:483-485`: `else if (prop.key === "strictSecurityMode") { … this.strictSecurityMode = prop.value }`. Flag is now `false`.
  - THEN activation: `useFullBackupImport.ts:412` `profileService.finalizeRestore(newProfile.id, opts.password.value || undefined)` — the comment at `:405-410` calls this "Late activation: open the session NOW."
- **`finalizeRestore` derives + passes the passhash; `open()` persists it when strict is false:**
  - `apps/extension/src/wallet/services/profile/service.ts:1069-1084` (password branch): `const passhash = await EncryptionKey.getPasshash(password)` (`:1082`) → `await this.sessionManager.open(profile, secret, passhash)` (`:1084`).
  - `session-manager.ts:211`: `const persistPasshash = passhash !== undefined && !this.strictSecurityMode` → with strict now `false`, `persistPasshash === true` → `:214` writes `passhash: Buffer.from(passhash).toString("base64")` into persisted `Session`.

**Preconditions:** (1) user is socially-engineered into importing an attacker-supplied backup (AV:L / UI:R, user-assisted-local — no web path); (2) the profile is a **password** profile (passkey branch at `service.ts:1099` passes no passhash, so the sink doesn't fire); (3) attacker sets `strictSecurityMode=false` in the config slice and recomputes the plain checksum. Effect: the wallet silently persists a base64 `SHA-256(password)` bearer (unsalted per F-11) in session storage, downgrading the user's posture without an explicit security-setting confirmation. Full exploitation of the persisted bearer needs a second local-read primitive.

**Final band: MEDIUM.** Sits at the Low/Medium boundary given the social-engineering + password-profile + second-read-primitive chain, but the silent authorization/security-config downgrade during an operation the user perceives as a benign import is the differentiator that keeps it above the plain local-storage Lows. Claude's "ordinary strict mode does not persist passhash" was correct but missed this restore-ordering path. Fix: allowlist/schema the config restore, and prompt separately (default-to-strict) for `strictSecurityMode`/`sessionTtl`.

---

## F-02 — approval popup escalation: renders `call.name` while executing `call.selector`

**VERDICT: CONFIRMED** — the `sendTx` approval popup is **actively misleading**, not merely a silent bypass.

**Independent evidence (file:line):**
- **Display uses the dApp-supplied `name`, decoupled from the selector:** `apps/extension/src/popup/windows/execute/OperationCard.vue:183` (the `aztec_sendTx` branch) renders `humanizeMethodName(call.name ?? call.selector)` — `call.name` is preferred; the executable selector is only a fallback label.
- **The display object carries the RAW dApp `exec.calls`:** the execute window spreads the operation verbatim — `execute/index.vue:216-235` (`aztec_sendTx` case) does `_operations.push({ ...op, network, account, feeSettings })` with **no artifact resolution and no name↔selector binding**. `op.exec.calls[j]` reaching `OperationCard` is exactly the dApp's `{ to, selector, name, args }`. The payload is `{ params, session }` and `sendOp.exec = args[0]` straight from the wire (`packages/wallet-bridge/src/dispatcher.ts:544`).
- **Execution uses the selector, `name` is a mere label:** `apps/extension/src/wallet/services/execution/operation-planner.ts:207-219` carries BOTH `selector: call.selector.toString()` (`:212`) and `name: call.name` (`:215`) separately into `EncodedCallAction`; `apps/extension/src/wallet/services/execution/tx-request-builder.ts:304` resolves the function via `findFunctionBySelector(artifact, action.selector)`, `:311` sets `fnName = action.name || action.selector` (label only), and `:314-318` constructs the `FunctionCall` with `FunctionSelector.fromString(action.selector)` — **the executed selector is `action.selector`; `fnName`/`action.name` never influences execution.**
- **Secondary "verified transfer" block is ALSO spoofable — strengthens the finding:** `apps/extension/src/utils/transfer-intent.ts:59` keys `parseTransferIntent` on `call.method ?? call.name` (the dApp name), not the selector. A crafted `{ name: "transfer", selector: <otherSelector>, args: [a,b,c] }` yields `{kind:"transfer", from,to,amount}` and the popup renders a decoded From/To/Amount "verified" block (OperationCard.vue:192-199) for a call that executes a *different* selector. The helper's own header (`:16-18`) claims to refuse "precise-but-wrong" rendering, but it guards on name+arity only, so the guarantee is defeated.
- **Same `name`-keyed value passes the scope gate:** `packages/wallet-bridge/src/method-scope-checkers.ts:121` matches `matchesScope(String(call.to), call.name, c.scope)` — a dApp scoped `transfer@TOKEN` satisfies the grant with `name:"transfer"` while shipping a different selector.

**Final band: HIGH.** The one control meant to catch higher-privilege ops (the user-approval popup) shows the attacker's chosen method label *and* a falsely-"verified" decoded-args block, while the wallet signs/executes the attacker's selector. `AddressDisplay :address="call.to"` (OperationCard.vue:185) does honestly show the target contract, but the method identity — the security-decision text — is attacker-controlled and unbound from what executes. Codex-only catch; Fable missed it. Fix: resolve the selector from the authorized artifact/name and reject mismatches (or authorize the executable selector and render the artifact-verified label).

---

## F-08 — SW dispatcher consumes dApp RPC args as `unknown[]` with no server-side per-method schema validation before authorization

**VERDICT: CONFIRMED** (systemic).

**Independent evidence (file:line):**
- **Args enter as `unknown[]`:** `packages/wallet-bridge/src/dispatcher.ts:275` `async dispatch(methodName: string, args: unknown[], ctx, hooks?)`. Fed directly from the wire: `apps/extension/src/wallet/services/wallet-sdk/background.ts:637` `dispatcher.dispatch(message.type, message.args, ctx, hooks)`.
- **Envelope validator intentionally leaves the payload unvalidated:** `apps/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:53` — `content: z.unknown().optional()`, with the comment "`content` is intentionally `unknown` … the upstream handler does its own per-type validation." Its own docstring (`:20-22`) states it is "NOT a security boundary on its own."
- **No per-method schema parse precedes authorization; authorization runs on raw casts:**
  - `dispatch` looks up only the method NAME in `METHOD_REGISTRY` (`:293`), then runs `enforceCapability` (`:299`) and `enforceScopeWithSession`/`enforceScope` (`:320`/`:322`) — all BEFORE any arg-shape validation.
  - The scope checkers read raw casts: `method-scope-checkers.ts:110` `args[0] as WireExecPayload`, `:120` `calls as WireCall[]`, `:132` `args[1] as {…}`, `:146` `args[0] as WireExecPayload`, `:169` `args[0] as WireCall`. They do only ad-hoc structural checks (is-array, has-`to`/`name`), never a per-method schema.
  - Direct operation construction casts unchecked: `dispatcher.ts:328` `args[0] as CapabilityManifest`; `:544` `args[0] as AztecSendTxRequest["exec"]`; `buildAccountOperation` at `:1134/:1142/:1153/:1162` casts `args[0]`/`args[1]` to simulateTx/executeUtility/profileTx/createAuthWit shapes.
- Downstream execution does parse SOME shapes (`operation-planner.ts:208` `FunctionCall.schema.parseAsync`), but that is AFTER authorization and only for a subset — it does not gate the capability/scope decision.

**Final band: MEDIUM (systemic / root-cause).** This is the trust-boundary weakness that ENABLES the concrete high-severity findings (F-01 raw-hash authwit, F-02 name/selector decoupling); on its own it is a systemic Medium whose severity is realized through its instances. Confidence moderate, consistent with the consolidated. Fix: a SW/dispatcher-side per-method schema table that parses `args` before capability/scope checks, rejecting unknown/inconsistent fields where semantic binding matters.

---

### Summary of bands
| Item | Consolidated | This verification |
|---|---|---|
| F-05 logo beacon | Medium | **Low (latent)** — no production writer |
| F-06 restore strict-off + passhash | Medium | **Medium** (confirmed) |
| F-02 approval name/selector | High | **High** (confirmed; actively misleading) |
| F-08 unchecked `unknown[]` args | Medium | **Medium** (confirmed; systemic) |
