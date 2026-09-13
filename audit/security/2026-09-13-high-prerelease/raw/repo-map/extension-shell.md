# Extension shell — repo map (outside `wallet/services`)

Scope per assignment: `apps/extension/src/{core,offscreen,content-script,setup,shims,accelerator,e2e,pages,stores,utils,types}`,
the background entry, `src/wallet/logger/`, `src/wallet/base/`, the trust-boundary windows
(`src/popup/windows/{execute,verify,discover,capabilities,passkey,json,logger}`), `src/onboarding/`,
security-relevant composables, `src/components/passkey/`, `apps/extension/vite.config.ts` +
`manifest/`, and `apps/extension/public/`. `wallet/services/**` internals are OUT of scope (mapped by
another cluster) — where a listener or call site is registered from an in-scope file but its
handler body lives in `wallet/services`, it is noted here only at the wiring/entrypoint level.

All paths below are repo-relative from the repo root unless stated otherwise; the base directory
for bare paths is `apps/extension/`.

## 1. Module inventory

| Module | Path | Purpose | Non-test LOC |
|---|---|---|---|
| Background entry | `src/wallet/index.ts` | MV3 service-worker shell: registers `onInstalled`/`onMessage`/`onAlarm` listeners synchronously at module scope, wires console hijack + logger, then hands off to `runtime.ts`. | 111 |
| Runtime bootstrap | `src/wallet/runtime.ts` | Constructs `ServiceCollection`, runs the storage migrator, boots all ~25 background services in topological phases, initializes the wallet-sdk handler. (Deep service internals are `wallet/services/**`, out of scope.) | 612 |
| Offscreen entry | `src/offscreen/index.ts`, `is-benign-sw-disconnect.ts` | Hosts the Aztec PXE inside the offscreen document; wires health-ping/pong, Firefox instance-adoption, console/error forwarding, then calls `createPxeOffscreen()` (aztec-runtime). | 147 |
| Offscreen lifecycle (SW side) | `src/wallet/utils/offscreen.ts` | Service-worker-side supervisor: create/probe/health-check/close the offscreen document (Chromium `chrome.offscreen` or Firefox hidden-window fallback), single-flight + pass-fencing to avoid races. | 409 |
| Content script | `src/content-script/content.ts` | Pure relay: `ContentScriptConnectionHandler` (upstream `@aztec/wallet-sdk`) bridges page `postMessage`/`MessageChannel` ↔ `chrome.runtime.sendMessage`/`onMessage`. No secrets, no business logic. | 22 |
| Content-script message validation | `src/wallet/services/wallet-sdk/content-script-validator.ts`, `content-message-relay.ts` | SW-side defense-in-depth: zod-validates content-script envelopes, rejects subframe senders, buffers pre-boot discovery with global/per-origin caps. (Physically under `wallet/services/wallet-sdk/`, but these are the entrypoint files the mapping task calls out by name.) | 243 |
| Setup shell | `src/setup/` (`app.vue`, `index.ts`, `index.html`, `index.scss`) | Dead/placeholder HTML entry — routes to `install.vue`/`update.vue` components. Built (`vite.config.ts` rollup input) but never opened by any runtime code (see §7). | 56 |
| Shims | `src/shims/` (`bb-fetch-code.ts`, `detect-node.ts`, `function-bind-stub.cjs`) | Build-time compatibility shims: replaces bb.js's dynamic `import()` WASM loader (MV3 forbids runtime `import()`), forces `detect-node` false (browser pino transport), replaces `function-bind`'s dynamic-`new Function` construction (CSP `script-src` has no `'unsafe-eval'`). | 62 |
| Accelerator config | `src/accelerator/config.ts` | Centralizes the native Aztec Accelerator app's connection constants (`127.0.0.1:59833`, `/health`) and the CI-only `ACCELERATOR_REQUIRED` build flag. No client logic itself — consumed by `offscreen/index.ts` and `onboarding/composables/useAcceleratorStatus.ts`. | 43 |
| E2E build-flag surface | `src/e2e/*` | Double-opt-in build-time flags (proverless mode, migration fixture, token-seed override) + the storage "gate" shims they arm. Production-wired import graph (see §7) but every effective branch is statically false in a release build. | 652 |
| Static pages | `src/pages/about.vue` | Placeholder page (`baseRoute: "common"`), no real content, not linked from any nav. | 9 |
| Pinia stores | `src/stores/*.store.ts` | Popup-side reactive caches (`appStore`, `balancesStore`, `activityStore`, `cacheStore`, `popupStore`, `notificationStore`) mirroring background-service state; not authoritative (ARCHITECTURE §4). | 1795 |
| Utils | `src/utils/*.ts` | Pure helpers: clipboard, storage facade, file pick/download/compress, password strength, URL scrubbing, amount/token math, journal/activity formatting. | 3326 |
| Types | `src/types/*.d.ts` + `.eslintrc-auto-import.json` | Generated auto-import/component ambient types (`unplugin-auto-import`, `unplugin-vue-components`) + hand-written `vite-env.d.ts`/`console.d.ts`. | 812 (mostly generated) |
| Logger | `src/wallet/logger/{index,store,console-forwarding,utils}.ts` | `LoggerStore` (ring buffer, `chrome.storage.session` persistence gated on Developer Mode), the redaction walker (`trim()`/`REDACTED_KEYS`), console hijack installers for SW + UI contexts. | 499 |
| Service base re-export | `src/wallet/base/index.ts` | 5-line re-export of `@nulo/wallet-core/base` (`ServiceCollection` etc.) under the extension's `@/wallet/base` import path. | 5 |
| Popup trust-boundary windows | `src/popup/windows/{execute,discover,capabilities,verify,json,logger,passkey}/` | Separate `chrome.windows.create` popups the SW opens for dApp approvals, connection verification, raw-payload inspection, log viewing, and SW-driven passkey ceremonies. | 3056 |
| Onboarding | `src/onboarding/` (`app.vue`, `pages/*.vue`, `components/`, `composables/`) | Full Vue app (own Pinia + service clients) for profile creation/import/passkey, opened as a browser tab on install. | 1810 |
| Composables (secrets/clipboard/dapp) | `src/composables/{useDappInteractionPayload,useSecretCountdown,useSecretClipboardCopy,useDappApprovalWindow,useDappHostname,useProfileCreateFlow,useProfileImportFlow,...}.ts` | Shared reactive logic for loading dApp-interaction payloads, secret-reveal countdowns, clipboard-copy-then-scrub, profile create/import flows, passkey ceremony wiring. | 4789 (whole `composables/` dir; the security-relevant subset is a fraction) |
| Passkey ceremony dialog | `src/components/passkey/PasskeyCeremonyDialog.vue` | Cross-shell (popup + onboarding) WebAuthn ceremony UI — shown inline, not a separate window (see popup/windows/passkey note in §2). | 164 |
| Core adapters | `src/core/adapters/{chrome-browser-api,clock-ticker-adapter,system-clock}.ts` | Real-Chrome implementations of `@nulo/wallet-core`'s `BrowserApi`/`ClockPort` ports (storage/runtime/windows/alarms wrappers). | 410 |
| Manifest | `manifest/manifest.{config,chrome.config,firefox.config}.ts` | Declarative MV3 manifest source consumed by `@crxjs/vite-plugin`; Firefox overlay strips `background`/`offscreen` permissions. | n/a (config) |
| Vite build | `vite.config.ts` (+ `vite.shared.ts`, referenced) | Aliases (function-bind/detect-node/bb-fetch-code shims), WASM emission (bb.js, sqlite3mc), page-router config (`vite-plugin-pages` over 5 dirs), auto-import/component resolvers, CSP-relevant build defines. | n/a (config) |
| Public assets | `public/{logo.svg,theme-boot.js,.gitkeep}` | Static assets copied verbatim into `dist/`. `theme-boot.js` is a tiny inline script (see §3) that sets the dark/light class before Vue mounts (FOUC guard). | ~20 |

## 2. Entrypoints

**Background / service-worker listeners** (all registered synchronously at module top level per the MV3 cold-wake rule documented at `src/wallet/index.ts:1-13`):

- `chrome.runtime.onInstalled` — `src/wallet/index.ts:29-32`. Only acts on `reason === "install"`; opens/focuses the onboarding tab (`utils/onboarding-tab.ts:25`).
- `chrome.runtime.onMessage` (toolbar-popup opener) — `src/wallet/index.ts:35-46`. Matches `message.type === "nulo:open-toolbar-popup"` with **no sender check**; only sender in the codebase is `src/onboarding/pages/done.vue:40` (an extension page). Not reachable from a web page: `externally_connectable` is absent from the manifest and the content-script relay only forwards wallet-sdk-protocol-shaped envelopes (see below), not arbitrary message types.
- `chrome.alarms.onAlarm` (price refresh) — `src/wallet/index.ts:88-96`. Filters on `alarm.name === PRICE_REFRESH_ALARM_NAME`; forwards to `PriceService.onAlarmTick()` (service body out of scope).
- `registerContentMessageRelay()` — `src/wallet/services/wallet-sdk/content-message-relay.ts:75-108`. THE single `chrome.runtime.onMessage` listener for content-script (dApp) traffic; called synchronously from `src/wallet/index.ts:34` before any await, so a cold-wake discovery is never dropped. Discriminates on `message.origin === "content-script"` (`:83`); everything else passes through untouched.
- Offscreen supervision listeners — `src/wallet/utils/offscreen.ts`: `onOffscreenReady` (`:97`, matches `OFFSCREEN_READY_MESSAGE`), `isOffscreenHealthy`'s `onPong` (`:170`, matches `OFFSCREEN_PONG`). Both are bare string/message-shape matches with no sender check — same-extension-only surface (offscreen document is not attacker-reachable).
- wallet-sdk `BackgroundConnectionHandler` — initialized at `src/wallet/services/wallet-sdk/background.ts:97` (`initWalletSdkHandler`), called from `runtime.ts`. Its content-transport (`buildContentTransport`, `background.ts:270-330`) attaches to the relay above via `attachContentListener` (not a second `chrome.runtime.onMessage`) and layers the subframe + zod checks described in §3.

**Offscreen document listeners** (`src/offscreen/index.ts`):

- `chrome.runtime.onMessage` health-ping responder — `:18-23`. Answers `OFFSCREEN_PONG` only once `servicesReady` flips true (withholds pong during PXE init).
- `chrome.runtime.onMessage` Firefox instance-adoption listener — `:33-38`, armed only when the offscreen URL carries a `?instance=` token (Firefox hidden-window fallback only). Self-closes (`window.close()`) if `isSupersededByAdopt()` (`src/wallet/utils/offscreen.ts:71-81`) returns true — checks `sender.id === chrome.runtime.id && sender.tab === undefined` (same-extension, non-tab sender) plus a token mismatch.
- `createPxeOffscreen(...)` — `:100-116`. Bootstraps the Aztec PXE (from `@nulo/aztec-runtime/offscreen/entry`, out of primary scope) wired with `ProfileServiceClient`/`LoggerServiceClient` and, only in CI/e2e builds, a `ProductionPxeFactory` pointed at the accelerator (`ACCELERATOR_HOST`/`PORT`) or proverless mode.

**Content script** (`src/content-script/content.ts:1-22`): injected `all_frames: true`, `matches: ["*://*/*"]`, `run_at: "document_start"` (manifest — see §7). The ONLY logic is `ContentScriptConnectionHandler({ sendToBackground, addBackgroundListener })`; it owns its own `window.postMessage`/`MessageChannel` handling upstream in `@aztec/wallet-sdk` (out of repo scope).

**Extension pages / windows** (each a separate `chrome.windows.create` popup or tab; query params are the only untrusted-ish input — all are opaque request ids the SW itself minted, not attacker-controlled payload):

| Window | Path | Query param(s) read | Renders | Confirms/executes |
|---|---|---|---|---|
| `execute` | `src/popup/windows/execute/index.vue` | `requestId` (`:120`) | Every requested operation (`register_contract`, `simulate_transaction`, `aztec_sendTx`, `register_token`, …), signer identity strip, dApp identity block, per-op fee card, a "show raw JSON" escape hatch (`showJson()` → opens `windows/json?requestId=`, `:491-496`) | `interactionService.approveInteraction(requestId, executable, origin, estimateIds)` (`:441-449`) — gated on `initComplete`, no in-flight token-metadata fetch, and every send-like op having a chosen fee (`:389-405`) |
| `discover` | `src/popup/windows/discover/index.vue` | `requestId` (`:52`) | dApp identity block + generic "wants to connect" copy | `interactionService.resolveInteraction(requestId, {approved:true})` (`:112`) — gated on `isReady` (profile + requestId + dapp all loaded, `:93`) |
| `capabilities` | `src/popup/windows/capabilities/index.vue` | `requestId` (`:105`) | Requested capability delta vs. existing grants, account picker (wallet-derived list only — dApp cannot inject phantom accounts, `:181-182` comment), chain-mismatch banner | Builds granted-capabilities set and resolves the interaction (see `buildGrantedCaps`, `:215-224`, truncated in this read but wired the same way as execute/discover) |
| `verify` | `src/popup/windows/verify/index.vue` | `sessionId` (`:135`), `verificationHash` (`:140`), `isReconnect` (`:141`) | Emoji-grid hash of the session's `verificationHash` (`hashToEmoji`, `@aztec/wallet-sdk/crypto`), dApp identity + hostname homograph check (`hostnameHasNonAscii`, `:62-68`), signer identity strip | Optional "always trust" toggle → `dappSessionService.setTrustedVerification(session.id, true)` (`:74`); otherwise just closes the window |
| `json` | `src/popup/windows/json/index.vue` | `requestId` (`:10`) | Raw `payload.params.operations` via `<JsonViewer>` (CodeMirror-based, no `v-html`) — the "show me exactly what I'm signing" escape hatch for `execute` | None — read-only viewer, closes on profile logout |
| `logger` | `src/popup/windows/logger/index.vue` | none | `<LogsViewer>` (buffered log lines, CSV-exportable) | None |
| `passkey` (Path B) | `src/popup/windows/passkey/index.vue` | `requestId` (`:41`) | "Waiting for passkey..." — no payload rendered before the WebAuthn ceremony | Runs `runPasskeyCeremony()` then `passkey.resolvePasskeyRequest`/`rejectPasskeyRequest`. **Currently NO production caller opens this route** — see the file's own header comment: Path A (`PasskeyCeremonyDialog.vue` inline in popup/onboarding) is the active host; Path B is reserved for a future SW/dApp-triggered ceremony with no popup open. |

**Onboarding pages** (`src/onboarding/pages/*.vue`, opened as a full browser tab via `openOrFocusOnboardingTab()`): `welcome`, `create` (password/passkey profile creation — no mnemonic shown here), `import` (seed / passkey / full-backup import), `accelerator` (native-app detection + install links), `fees`, `learn`, `done` (sends `nulo:open-toolbar-popup` back to the SW, `:40`, then closes the tab).

**Seed/secret reveal pages** (technically `src/popup/pages/settings/security/export/{seed,account}.vue` — outside the primary onboarding directory but the same "how is the mnemonic displayed/stored/cleared" trust boundary the task calls out): `export/seed.vue` unlocks with the account password (`managers.profile.exportMnemonic(profileId, password)`, `:47`), holds the plaintext phrase in a component `ref`, auto-closes after 5 minutes (`useSecretCountdown`), nulls the ref in `onBeforeUnmount` (`phrase.value = null`), and copies through `useSecretClipboardCopy` (F-14: `writeText("")` scrub 60s after copy, unconditional, no `clipboardRead` permission requested).

**Public exports**: none of the in-scope modules are library entry points (the extension is a build sink, ARCHITECTURE §2) except `@nulo/wallet-core/base` re-exported at `src/wallet/base/index.ts`.

## 3. Trust boundaries

**dApp → content script → SW (postMessage / chrome.runtime messaging)**

- Page ↔ content script: `window.postMessage`/`MessageChannel`, handled entirely inside upstream `ContentScriptConnectionHandler` (`content-script/content.ts:11-20`) — no Nulo-side validation in this file; the handler's internal message-type switch is the boundary (out of repo scope, `@aztec/wallet-sdk`).
- Content script → SW: `chrome.runtime.sendMessage` (`content.ts:12`), received by `registerContentMessageRelay` (`content-message-relay.ts:79`). Admission checks BEFORE the SDK handler even attaches:
  - Discriminator: `message?.origin !== "content-script"` → ignored (`:83`).
  - Subframe rejection: `isSubframeSender(sender)` (`content-script-validator.ts:93-95`) — `sender.tab !== undefined && sender.frameId !== undefined && sender.frameId !== 0`. Applied at buffer-admission time (`content-message-relay.ts:91`) AND again at the live path (`wallet-sdk/background.ts:300`, `buildContentTransport`). Feature-flaggable via build-time `VITE_NULO_ALLOW_IFRAME_DAPPS` (`content-message-relay.ts:42`, `background.ts` mirror) — OFF by default; no legitimate iframe-dApp use case found per the code comment.
  - Envelope shape: `validateContentScriptMessage()` (`content-script-validator.ts:97-114`) — zod `ContentScriptMessageSchema` requires `origin: "content-script"`, `type` ∈ a fixed enum (`discovery-request`, `key-exchange-request`, `secure-message`, `disconnect-request`, `ping`). Applied at buffer-admission (`:92`) and live path (`background.ts:316-322`).
  - Pre-attach (cold-wake) admission is STRICTER than live: only `discovery-request` messages may occupy a buffer slot (`content-message-relay.ts:93`), capped at `CONTENT_RELAY_GLOBAL_CAP=32` total / `CONTENT_RELAY_PER_ORIGIN_CAP=4` per origin (`:44-45`, enforced `:94-104`), reject-new (never evict), and flushed entries older than `CONTENT_RELAY_MAX_AGE_MS=5000` are dropped at flush time (`:117-128`).
- Same-extension internal messages (offscreen ready/pong, Firefox instance-adopt, toolbar-popup-open) are matched by literal string/shape with **no sender identity check** beyond, in one case, `sender.id === chrome.runtime.id` (`offscreen.ts:78`) — acceptable because MV3 `chrome.runtime.onMessage` (without `onMessageExternal`) is only reachable from contexts inside the same extension, and `externally_connectable` is absent from the manifest.

**SW → offscreen (PXE)**: `ensureOffscreenRunning()` (`wallet/utils/offscreen.ts:342`) creates/probes/health-checks the offscreen document; no message content crosses this boundary other than the `OFFSCREEN_PING`/`PONG`/`READY`/`ADOPT_INSTANCE` control strings. The actual PXE RPC traffic goes through `@nulo/extension-messaging`'s `OffscreenService`/client (out of scope — `wallet/services/pxe/`).

**Offscreen → accelerator (native app)**: `src/accelerator/config.ts` — plain **HTTP over localhost**, `ACCELERATOR_HOST=127.0.0.1`, `ACCELERATOR_PORT=59833` (`:22-23`), health endpoint `http://127.0.0.1:59833/health` (`:24`). No native-messaging, no WS. **No authentication** — the accelerator answers with a wildcard CORS header and the manifest grants `host_permissions: ["http://127.0.0.1/*"]` (`manifest.config.ts:20`) as "belt-and-suspenders" (comment at `useAcceleratorStatus.ts:13-15`). `ACCELERATOR_REQUIRED` (host/port passed into `ProductionPxeFactory`) is a CI/e2e-only build flag (`config.ts:26`, off in every production build) — the actual prover-connection code lives in `packages/aztec-runtime` (out of scope for this cluster).

**Popup windows ← SW-supplied `requestId`**: every dApp-approval window (`execute`/`discover`/`capabilities`/`verify`) reads only an opaque `requestId`/`sessionId` from its own URL query string, then calls back into a background service (`DappInteractionServiceClient.getInteractionPayload` / `DappSessionServiceClient.getDappSession`) to fetch the actual payload — the payload itself never rides the URL, so a shoulder-surfed or logged window URL leaks no operation content. Rendered dApp-controlled strings (`dapp.name`, hostname) are passed through `sanitizeWireString()` (`@/wallet/services/dapp-session/capability-meta`, called from `DappIdentityBlock.vue:14,32`) before interpolation — strips bidi overrides / zero-width chars (Unicode-spoofing defense, comment at `DappIdentityBlock.vue:7-13`). The dApp logo is bound via `<img :src="dapp.logoBlobUrl">` (never `v-html`/`innerHTML`) — **zero occurrences of `v-html`, `innerHTML`, `dangerouslySetInnerHTML`, `eval(`, or `new Function(` in production `src/**` were found** (only test-file `document.body.innerHTML = ""` cleanup calls).

**Secrets handled in this scope**:

- Recovery phrase (mnemonic): revealed at `popup/pages/settings/security/export/seed.vue` via `managers.profile.exportMnemonic(profileId, password)` (background does the actual decryption — out of scope); held in a plain `ref`, auto-closes after 5 min, nulled on `onBeforeUnmount`.
- Passwords (profile create/import): `src/onboarding/pages/create.vue:96-102` and `import.vue:120-126` both zero the `password`/`repeatedPassword`/`seedPhrase` refs in `onBeforeUnmount` ("defense-in-depth" comments at both sites).
- Passkey ceremony: `src/components/passkey/PasskeyCeremonyDialog.vue` + `popup/windows/passkey/index.vue` both wire an `AbortController` that aborts the in-flight `navigator.credentials` call on unmount/close.
- Clipboard writes of secrets: `useSecretClipboardCopy.ts:33` (`window.navigator.clipboard.writeText(value)`) — scrubs to empty string after 60s (`CLIPBOARD_CLEAR_MS`, `:3,39-41`), unconditional (no `clipboardRead` permission requested, so equality-checking before scrub isn't possible — accepted risk documented in the file's header comment). General non-secret clipboard copy: `src/utils/clipboard.ts:30-43` (`copyToClipboard`), honest toast only after the write resolves, optional `sanitize` strips wire-control/bidi chars via `stripWireControl`.
- Logging redaction: `src/wallet/logger/utils.ts:82-113` — `REDACTED_KEYS` set (blanks `mnemonic`, `seedPhrase`, `password`, `passhash`, `prf`, `masterKey`, `privateKey`, `entropy`, etc. by KEY NAME, both camelCase and backup-JSON kebab-case), `SECRET_KEY_SUFFIX = /secretkey$/i` catches the `*SecretKey` family, `URL_KEYS` reduces endpoint URLs to origin only (`toOrigin()`, `:130-137`). This redaction is enforced statically for the whole call graph by `src/utils/log-payload-ban.test.ts` (not read in this pass; see CLAUDE.md "Logging policy").

**Storage writes**:

- `chrome.storage.local` (persistent) — UI code MUST go through the migration-aware facade `src/utils/storage.ts` (`storageLocalGet/Set/Remove`, `:68-81`), which blocks on the `nulo:schema:running` marker (`migrationIdle()`, `:32-66`) before every access. Raw `chrome.storage.local` access outside this file (+ an allowlisted composition-root adapter) is banned and enforced by `src/utils/storage-facade-ban.test.ts`.
- `chrome.storage.session` (ephemeral) — used directly (not through the facade) for: onboarding-tab tracking (`wallet/utils/onboarding-tab.ts:29,46,58`), the e2e storage/proof/restore/token-seed "gates" (`src/e2e/*`), the active `Session` mirror (owned by `wallet/services/profile/session-manager.ts`, out of scope), and `LoggerStore` persistence (Developer-Mode-gated, `wallet/logger/store.ts`, out of scope for deep read here).
- The offscreen document's PXE IndexedDB (`sqlite3mc`/OPFS) is written directly by aztec-runtime, outside this shell's code (see `vite.config.ts`'s `sqlite3mc-wasm-emit` plugin, `:240-267`, for the asset-serving side of it).

**Origin/permission/sender checks — file:line index** (superset of the above, for cluster-auditor convenience):

| Check | File:line |
|---|---|
| Content-script origin discriminator | `content-message-relay.ts:83` |
| Subframe rejection (pre-attach) | `content-message-relay.ts:91` → `content-script-validator.ts:93-95` |
| Subframe rejection (live path) | `wallet-sdk/background.ts:300` |
| Content-script envelope zod validation (pre-attach) | `content-message-relay.ts:92` |
| Content-script envelope zod validation (live path) | `wallet-sdk/background.ts:316` |
| Global/per-origin pre-boot buffer caps | `content-message-relay.ts:94-104` |
| Offscreen same-extension sender check | `wallet/utils/offscreen.ts:78-79` (`isSupersededByAdopt`) |
| Toolbar-popup message: NO sender check (relies on `externally_connectable` absence) | `wallet/index.ts:35-46` |
| dApp-controlled name/hostname sanitization | `DappIdentityBlock.vue:14,32` (`sanitizeWireString`) |
| Homograph/punycode hostname flag | `windows/verify/index.vue:62-68`, `composables/useDappHostname.ts` (not read in depth this pass) |
| Migration-mid-flight storage barrier | `utils/storage.ts:32-66` |
| Storage-facade ban (static enforcement, not read this pass) | `utils/storage-facade-ban.test.ts` |

## 4. Dependency graph (one level deep, in-scope modules)

- `wallet/index.ts` → `core/adapters` (RealChromeBrowserApi/SystemClock), `wallet/config`, `wallet/logger`, `wallet/runtime`, `wallet/services/wallet-sdk/content-message-relay` (registration only), `wallet/services/price/service`, `wallet/utils/onboarding-tab`, `utils/console-sniffer`. **Handoff**: `chrome.runtime.onInstalled`/`onMessage`/`onAlarm` (emit) → the module-scope listeners above (consume).
- `wallet/runtime.ts` → ~25 `wallet/services/*/service.ts` (out of scope), `wallet/base` (`ServiceCollection`), `wallet/storage/migrations`, `e2e/config` + 4 `e2e/chrome-storage-*-gate.ts` files, `wallet/services/wallet-sdk/background.ts` (`initWalletSdkHandler`). **Handoff**: DI/service registration (`ServiceCollection.add`) → consumers resolve via `services.get(Name)`.
- `wallet/services/wallet-sdk/background.ts` → `content-message-relay.ts` (`attachContentListener` — port-open/handler handoff), `content-script-validator.ts`, `@aztec/wallet-sdk/extension/handlers` (`BackgroundConnectionHandler`), a dozen `wallet/services/*` clients (out of scope).
- `content-message-relay.ts` → `content-script-validator.ts` only.
- `offscreen/index.ts` → `accelerator/config.ts`, `e2e/config.ts`, `wallet/logger` (client), `wallet/services/{logger,profile}/client`, `wallet/utils/offscreen.ts` (constants + `isSupersededByAdopt`/`shouldRespondPong`), `@nulo/aztec-runtime/offscreen/entry` + `/pxe` (out of repo scope for this cluster).
- `content-script/content.ts` → `@aztec/wallet-sdk/extension/handlers` only (no `@/` imports at all).
- Popup windows (`execute`/`discover`/`capabilities`/`verify`/`json`/`logger`/`passkey`) → `composables/{useDappInteractionPayload,useDappHostname,useDappApprovalWindow,useFeeEstimationMap}`, `wallet/services/{profile,dapp-interaction,dapp-session,execution,token,network,account,passkey}/client` (client-side RPC stubs, out of scope for service bodies), `stores/app.store`. **Handoff**: `chrome.windows.create` (SW opens window with `?requestId=`) → window mounts → `interactionService.getInteractionPayload(requestId)` (RPC call/response) → `approveInteraction`/`resolveInteraction`/`rejectInteraction` (RPC call, no response awaited on reject).
- `onboarding/index.ts` → `onboarding/app.vue`, `~pages` (virtual route table — see note below), `wallet/logger/console-forwarding`, `utils/core` (`initAppServiceContext`), same `wallet/services/*/client` layer as the popup.
- `composables/useSecretClipboardCopy.ts`, `utils/clipboard.ts` → `window.navigator.clipboard` (browser API), `wallet/services/dapp-session/capability-meta` (`stripWireControl`).
- `utils/storage.ts` → `@nulo/wallet-core/migration` (`SCHEMA_RUNNING_KEY`) only; consumed by nearly every `stores/*` and several `composables/*` (fan-in, not enumerated).
- **Cross-shell routing note**: `vite.config.ts`'s `usePages` plugin (`:110-133`) merges FIVE page directories (`src/pages`, `src/setup/pages` [empty], `src/popup/pages`, `src/popup/windows`, `src/onboarding/pages`) into ONE virtual `~pages` route table, and all three HTML shells (`popup/index.ts:9`, `onboarding/index.ts:16`, `setup/index.ts:4`) import routes from it. So the onboarding tab's router technically has routes for `/windows/execute` etc. registered too — harmless in practice since window content is gated on live SW payload lookups, not on which shell loaded it, but worth flagging for a cluster auditor checking window-isolation assumptions.

## 5. Frameworks / libs

- **Crypto**: no direct crypto npm deps in this scope — `useSecretClipboardCopy`/`clipboard.ts` use only `window.navigator.clipboard`; actual KDF/AES-GCM lives in `@nulo/wallet-crypto` (Web Crypto `SubtleCrypto`, no `@noble/*`/`@scure/*` direct dep — those arrive transitively via `@aztec/foundation`/`aztec-runtime`, per the sibling workspace map). `apps/extension/package.json`: no `bip39`, no `tweetnacl`.
- **Validation**: `zod ^4.4.3` — used in-scope at `content-script-validator.ts` (`ContentScriptMessageSchema`). Extension-wide zod usage elsewhere (RPC boundary, config schema) lives in `wallet/services/*` (out of scope) and `packages/extension-messaging`/`wallet-bridge`.
- **Messaging abstraction**: `@nulo/extension-messaging`'s `Service`/`ServiceClient` (background.ts/client.ts) and `OffscreenService` (offscreen side) — both out-of-scope packages; every `*ServiceClient` import in this scope (popup windows, composables) is a thin typed-RPC stub over them.
- **Storage abstraction**: `@nulo/wallet-core/storage` (`EntityStorage`/`ValueStorage`, out of scope package) underneath; in-scope, the facade is `src/utils/storage.ts`.
- **`@aztec/*` packages used directly in this scope**: `@aztec/wallet-sdk` (`ContentScriptConnectionHandler` in `content.ts`; `BackgroundConnectionHandler` in `wallet-sdk/background.ts`; `hashToEmoji` from `@aztec/wallet-sdk/crypto` in `windows/verify/index.vue:7`), `@aztec/bb.js` (referenced by the `bb-fetch-code.ts` shim and `runtime.ts`'s `BarretenbergSync` import), `@nulo/aztec-runtime` (`createPxeOffscreen`, `ProductionPxeFactory` in `offscreen/index.ts`). All pinned to `5.2.0` (root workspace) per the sibling package map.
- **UI**: Vue 3.5.38, Vue Router 5.1.0 (via `usePages`), Pinia 4.0.3, `@nulo/design` (L0-L2 primitives, out of scope package), CodeMirror (`@codemirror`/`@lezer`, transitively via `JsonViewer`) for the raw-JSON/log viewers — no HTML-sanitizer library present or needed (no `v-html` sinks found).
- **Build**: Vite ^8.0.16, `@crxjs/vite-plugin` ^2.6.1 (manifest+HMR), `vite-plugin-node-polyfills` ^0.28.0, `unplugin-auto-import`/`unplugin-vue-components`, `vite-plugin-pages` ^0.33.3.

## 6. Test surfaces

Colocated `*.test.ts` next to source, Bun/vitest runtime (per CLAUDE.md). Rough src-file : test-file ratio per in-scope directory:

| Dir | Non-test files | Test files | Note |
|---|---|---|---|
| `src/core` | 6 | 2 | adapters partially covered |
| `src/offscreen` | 2 | 1 | `is-benign-sw-disconnect` tested; `index.ts` itself (the bootstrap sequencing) is NOT unit-tested — only exercised via e2e |
| `src/content-script` | 1 | 0 | 22-line pure relay; untested directly (covered indirectly by network e2e) |
| `src/setup` | 2 | 0 | dead code (§7) |
| `src/shims` | 2 | 1 | `function-bind-stub` tested; `bb-fetch-code`/`detect-node` not |
| `src/accelerator` | 1 | 0 | constants-only file |
| `src/e2e` | 11 | 4 | the 4 "gate" test files cover the storage/proof/restore/token-seed gates; `config.ts`'s fail-closed double-opt-in logic IS tested (`config.test.ts`) |
| `src/pages` | 1 | 0 | placeholder |
| `src/stores` | 6 | 7 | well covered (balances store has a fuzz test + single-flight pin test) |
| `src/utils` | 34 | 32 | well covered; notable: `clipboard.test.ts`, `storage.test.ts`, `storage-facade-ban.test.ts`, `log-payload-ban.test.ts`, `sanitize-parity.test.ts` all present |
| `src/types` | 4 | 0 | generated ambient types, N/A |
| `src/wallet/logger` | 4 | 3 | `console-forwarding`, `store`, `utils` (redaction) all tested |
| `src/wallet/base` | 1 | 2 | re-export file; the 2 tests are for `@nulo/wallet-core/base` surface (`errors.test.ts`, `zod-helpers.test.ts`) |
| `src/popup/windows` | 18 | 16 | **but concentrated**: `execute`/`discover`/`capabilities` are heavily tested (frozen-oracle `index.test.ts` per window, `reentrancy.test.ts` for capabilities); `json`, `logger`, `passkey`, `verify` windows have **ZERO** component tests |
| `src/onboarding` | 16 | 7 | tests exist only for shared `components/` + `useAcceleratorStatus`; **all 7 onboarding `pages/*.vue`** (welcome/create/import/accelerator/fees/learn/done — i.e. the whole seed-create/seed-import flow's page layer) have no direct component test (by the repo's own L5/L6 convention: "not required, covered by e2e + manual smoke") |
| `src/composables` | 33 | 29 | well covered, including the secret-touching ones (`useSecretClipboardCopy.test.ts`, `useSecretCountdown.test.ts`, `useDappInteractionPayload.test.ts`) |
| `src/components/passkey` | 1 | 1 | `PasskeyCeremonyDialog` tested |

**Thin spots worth a cluster auditor's attention**: `verify/index.vue` (the anti-phishing emoji-verification surface) and `json/index.vue` (raw-payload viewer for `execute`) have no component-level test at all — coverage for these two currently depends entirely on e2e/manual smoke. `offscreen/index.ts`'s own bootstrap sequence (ready-gate ordering, accelerator/proverless branch selection) is likewise untested at the unit level.

## 7. Generated / vendored / fixture / test-only code

| Path | Status | Production-wired? |
|---|---|---|
| `src/types/auto-imports.d.ts`, `src/types/components.d.ts`, `src/types/.eslintrc-auto-import.json` | Generated by `unplugin-auto-import`/`unplugin-vue-components` at build/dev time | N/A — ambient types only, not runtime code. Excluded from finding eligibility. |
| `src/setup/` (`app.vue`, `index.ts`, `index.html`, `index.scss`) | Placeholder shell, built (`vite.config.ts:319` rollup input `setup: "src/setup/index.html"`) | **Built into `dist/` but never opened by any runtime code path.** No `chrome.tabs.create`/manifest reference points at it; grep across `src/` found zero references to `"setup/index.html"` outside `vite.config.ts` itself. Its own sibling comment (`src/onboarding/index.ts:1-3`) calls it "a placeholder with no stores." Treat as dead code — exclude from findings unless a future change wires it up. |
| `src/pages/about.vue` | Placeholder page (`baseRoute: "common"`) | Built and routable (any shell could navigate `#/common/about`) but not linked from any nav/menu found in this pass. Low-risk dead surface. |
| `src/e2e/*.ts` (`config.ts`, `chrome-storage-*-gate.ts`, `migration-fixture.ts`, `backup-migration-fixture.ts`, `proof-gate.ts`, `restore-gate.ts`, `incoming-poll-gate.ts`, `storage-gate.ts`) | **Production-wired by import** — `wallet/runtime.ts`, `wallet/storage/migrations/index.ts`, `wallet/services/execution/service.ts` + `execution-coordinator.ts`, `wallet/services/account-state/service.ts`, `wallet/services/contact/service.ts`, `wallet/services/incoming-transfer/service.ts`, and `offscreen/index.ts` all import from `@/e2e/*` in non-test files. | Imports are real, but every effective code path is gated behind `import.meta.env.VITE_NULO_E2E_*` flags that are unset (and several require an explicit fail-closed DOUBLE opt-in pair, `config.ts:32-38,82-88`) in any real release build, are dead-code-eliminated by Vite, and are asserted absent from shipped bundles by a negative grep in `_build-extension.yml` (per the file headers). Not vendored/fixture-only in the sense of being excludable from the import graph — but not reachable at runtime in production either. |
| `src/wallet/storage/migrations/*` fixtures (e.g. a `9001` sentinel migration) | Not read directly in this pass (belongs to the storage-migration cluster) | Per ARCHITECTURE §5, build-stamped fixtures are tree-shaken from prod and grep-guarded in CI — same pattern as `src/e2e/*`. |
| `src/core/testing/{fake-node-factory,index}.ts` | Test helper exports (`FakeBrowserApi`-adjacent) | Consumed only by `*.test.ts` files in this pass's grep; not imported by any production module found. Exclude from findings. |
| `apps/extension/tests/**`, `*.test.ts` colocated files | Test-only | Excluded per standard convention. |
| `public/theme-boot.js` | Shipped verbatim (not built/transformed) | **Production-wired** — loaded by the popup/onboarding HTML shells directly (not read in depth this pass; small inline FOUC-guard script). |

## 8. Security-relevant invariants (quoted, with file:line)

- **Content-script relay ownership (single-listener invariant)**: "Single-listener ownership is load-bearing: a second listener alongside the SDK-attached one would double-deliver, and a duplicate discovery's coalesce→reject path DELETES the entry its twin legitimately queued, while a duplicate secure-message would double-journal a sendTx." — `src/wallet/services/wallet-sdk/content-message-relay.ts:17-20`.
- **Subframe rejection is a deliberate default-deny, not an oversight**: "Default is 'reject subframes' because research found NO legitimate iframe-dApp use cases in the Nulo ecosystem. If a counterexample surfaces, set the env var rather than removing this check." — `src/wallet/services/wallet-sdk/background.ts:295-298`.
- **No `clipboardRead` permission, by design**: "We deliberately do NOT add a clipboardRead permission (it would only widen the wallet's clipboard-read surface); the scrub is therefore unconditional, not equals-checked..." — `src/composables/useSecretClipboardCopy.ts:15-18`.
- **Clipboard scrub has NO dispose/lifecycle guard, by design**: "NO lifecycle hooks and NO dispose() export, BY DESIGN — do not 'fix' this to the repo's usual composable-dispose convention... The timer only runs an idempotent `writeText(\"\")`... safe to outlive the component, at the documented small cost of clobbering an unrelated clipboard copy made within the 60s window (accepted; no clipboardRead)." — `src/composables/useSecretClipboardCopy.ts:18-25`.
- **Accelerator has no real auth, accepted**: "CORS: the accelerator emits Access-Control-Allow-Origin: * so an extension page can fetch /health freely. We also added http://127.0.0.1/* to host_permissions in the manifest for belt-and-suspenders authorization." — `src/onboarding/composables/useAcceleratorStatus.ts:13-15`.
- **Accelerator-required is CI-only, never production**: "`ACCELERATOR_REQUIRED` is the CI-only switch. It is OFF for every production build... the SDK's silent WASM fallback path is preserved for end users without Aztec Accelerator (the desktop app) installed." — `src/accelerator/config.ts:9-15`.
- **Proverless e2e flag is a "PRODUCTION CATASTROPHE if it ever ships"**: "It is a PRODUCTION CATASTROPHE if it ever ships — a proverless wallet broadcasts unproven transactions... Only `apps/extension/scripts/e2e/agent.sh` (and the proverless CI job) set these. No `.env` default, no `vite.config` define, no release workflow." — `src/e2e/config.ts:6-19`.
- **Logging redaction is by KEY NAME only, a stated blind spot**: "It redacts by key name, so `{ password }` is safe and `{ value: password }` is not — the walker reads a benign key and passes the string through. A finished string is opaque to it — `` `k=${x}` `` can never be redacted." — CLAUDE.md § Logging policy (not re-quoted from `wallet/logger/utils.ts` directly, but the `REDACTED_KEYS`/`SECRET_KEY_SUFFIX` definitions at `:82-121` are the implementation of this rule).
- **UI storage MUST go through the facade**: "Every accessor here waits for the marker to clear before touching data... Deliberately NO timeout: proceeding while a migration is mid-flight is the corruption we're preventing." — `src/utils/storage.ts:9-17`.
- **Passkey window Path B is unused in production**: "Currently NO production callers exercise this route. PATH A (`PasskeyCeremonyDialog.vue` rendered inline by auth/profile-new/import.vue) is the active host for popup-originated ceremonies." — `src/popup/windows/passkey/index.vue:13-16`.
- **`execute` window approval race guard**: "Block approval until init() has finished and at least one operation exists. Without this guard, a fast click before payload materialization would approve an empty operations list." — `src/popup/windows/execute/index.vue:391-393`.
- **`discover` window Allow-only-gate**: "Allow stays disabled until the trust anchor is rendered; Deny stays fast on !requestId because early reject is harmless." — `src/popup/windows/discover/index.vue:33-34`.
- **Anti-phishing dApp-name sanitization**: "The `name` field is dApp-controlled metadata from the discovery payload. Route through sanitizeWireString to strip bidi overrides, zero-width chars, etc. so a phishing dApp can't impersonate a familiar name via Unicode tricks." — `src/components/composite/DappIdentityBlock.vue:7-10`.
- **Account-picker cannot be poisoned by the dApp**: "`availableAccounts` and `grantedAccounts` are both wallet-derived (never dApp-supplied), so there is no path for a malicious dApp to inject a phantom account or a phantom lock here." — `src/popup/windows/capabilities/index.vue:181-182`.
- **Manifest has no `externally_connectable`, no `<all_urls>` host permission, no sandbox page** — `manifest/manifest.config.ts:20,39-42,55-60` (verified by direct read; no inline comment states this as a rule, but it is the as-shipped posture a cluster auditor should confirm stays true across future manifest edits).
