# C3 — Extension-messaging IPC layer — Claude (Phase 2 raw)

Cluster scope: `packages/extension-messaging/src/`, including `background/` (popup ↔ SW Port-based RPC) and `offscreen/` (SW ↔ offscreen `chrome.runtime.sendMessage` RPC).

The mapper's three pre-findings (no sender validation; `method in this.requests` dispatch; no rate limiting) are all confirmed. Additional issues found below.

---

## F1 — Content script can drive any background `Service` (no `port.sender` validation)

- Severity: HIGH
- Confidence: HIGH
- File:line: `packages/extension-messaging/src/background/service.ts:40-48`
- Category: AuthZ / sender-confusion
- Affected code: `Service.onConnect`
- Description:
  `chrome.runtime.onConnect` fires for any extension page (popup, offscreen, options) AND for any content script in the extension. The handler accepts the port purely on `client.name === this.name` — no `port.sender.id`, `port.sender.url`, or `port.sender.tab` check. The wallet ships a content script at `content_scripts: matches: ["*://*/*"], all_frames: true` (`packages/extension/manifest/manifest.config.ts:31-38`), so every page the user visits runs a Nulo-injected content script in an isolated world that has full access to `chrome.runtime.connect(undefined, { name: <serviceName> })`. The legitimate content script (`packages/extension/src/content-script/content.ts`) does not use ports — but a malicious content script payload (delivered by, e.g., a compromised npm package that adds a `chrome.runtime.connect` call, or a malicious page injecting into the isolated world via prototype pollution of injected globals) reaches every Service.
- Exploit chain:
  1. User installs Nulo and unlocks a profile.
  2. User visits any web page.
  3. Page-side attacker reaches into the content script's isolated world (or attacker is the content script itself in a supply-chain compromise) and runs `const p = chrome.runtime.connect(undefined, { name: "profile" })`.
  4. Attacker `p.postMessage({ type: 2, content: { requestId: 1, method: "exportPlain", params: { 0: "<profileId>", 1: "<guessed-password>" } } })`.
  5. ProfileService dispatches `exportPlain`. If the password is wrong, the call throws `InvalidPasswordError` — but the attacker can now iterate against the password offline-free, rate-limited only by the SW's compute. Each guess goes through PBKDF2 (~100ms), so 36000 guesses/hour — given a weak password, full compromise within hours.
  6. Even without password guessing, attacker can call `deleteProfile(id)` (no password required by spec, `packages/extension/src/wallet/services/profile/spec.ts:172-175`), `lockActiveProfile()`, `refreshSession()`, `cancelJob(jobId)`, `executeOperations(...)` against the currently-unlocked profile — losing user funds via authorized-but-attacker-driven sends.
- Surface concretely confirmed:
  - `ProfileService` (service name `"profile"`): `unlockProfile`, `unlockPasskeyProfile`, `exportPlain`, `exportEncrypted`, `exportMnemonic`, `deleteProfile`, `changeProfilePassword`, `lockActiveProfile`, `refreshSession`, `restore`, `finalizeRestore`.
  - `ExecutionService` (service name `"execution"`): `executeTransfer`, `executeOperations`, `estimateTransferFee`, `estimateOperationFee`, `getGasBalances`, `cancelJob`.
  - Every other Service in `packages/extension/src/wallet/services/*/service.ts` — the messaging base class is universal.
- No mitigations present: zero `port.sender` checks anywhere in `packages/` (`grep -rn 'sender\.(id|tab|origin|url)'` returns zero non-test hits).
- Suggested fix:
  In `Service.onConnect`, gate on `client.sender?.id === chrome.runtime.id && client.sender?.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)`. Content scripts have a `sender.tab` set; extension pages do not. Reject any port whose sender carries `tab` or whose URL is not a `chrome-extension://` URL from this extension. Pin this check with a unit test that simulates `port.sender = { id: chrome.runtime.id, tab: {...} }` and asserts the port is rejected.

---

## F2 — Content script can call any offscreen service directly (no sender check on `chrome.runtime.onMessage`)

- Severity: HIGH
- Confidence: HIGH
- File:line: `packages/extension-messaging/src/offscreen/service.ts:45-50`
- Category: AuthZ / sender-confusion
- Affected code: `Service.onMessageListener`
- Description:
  Offscreen `Service` registers `chrome.runtime.onMessage.addListener(this.onMessageListener)`. The listener's signature drops the `sender` argument entirely (`(message: RequestMessage<TRequests>): boolean`). The accept gate is `message.to === this.name` only. Inside, `onMessage` reads `message.from` and routes the response to `to: message.from`. **A content script can `chrome.runtime.sendMessage({ type: 2, to: "pxe", from: "<arbitrary>", content: {...} })`** and the offscreen PXE service will execute the request and broadcast the response. Chrome's runtime delivers `sendMessage` from a content script to all registered listeners in the same extension (background SW and offscreen documents) — confirmed Chrome semantics.
- Exploit chain (once the offscreen document is up; up by default after the user opens the popup once):
  1. Malicious content script: `chrome.runtime.onMessage.addListener((m) => receivedResponses.push(m))` — listen for the broadcasted response.
  2. `chrome.runtime.sendMessage({ type: 2, to: "pxe", from: "attacker", content: { requestId: 1, method: "getNotes", params: { 0: { networkId: "...", accountAddress: "...", contractAddress: "...", storageSlot: "...", noteSelector: "..." } } } })`.
  3. PxeService runs the read, broadcasts response with `to: "attacker"` (just an opaque tag, not validated). The attacker's onMessage receives it.
  4. With PXE access on the currently-loaded chain, attacker can drain **private notes, contract instances, and effectively any private state the PXE knows** — bypassing the popup's authorization UI entirely.
- Compounding: the offscreen Service does not preserve `errorPayload` (only sends `error: errorMessage`) so error responses are flat strings — but the success path returns full payloads of private state.
- The `from` tag is opaque (a random hex per client). The attacker just picks any non-conflicting string; no signature, no nonce.
- Suggested fix:
  Take `sender: chrome.runtime.MessageSender` in the listener signature. Reject any sender with `sender.tab` set (content script) or with `sender.id !== chrome.runtime.id`. Same gate as F1.

---

## F3 — Method dispatch by `in` check allows Object.prototype method invocation

- Severity: MEDIUM
- Confidence: HIGH
- File:line: `packages/extension-messaging/src/background/service.ts:68`, `packages/extension-messaging/src/offscreen/service.ts:58`
- Category: Logic / dispatch-confusion
- Affected code: `if (!requestId || !(method in this.requests) || typeof wrappedParams !== "object")`
- Description:
  `this.requests` is defined as `private get requests() { return this as unknown as MethodsSpec<TRequests> }` — i.e. the Service subclass instance itself. The `in` operator walks the prototype chain, so `"toString" in this.requests`, `"hasOwnProperty" in this.requests`, `"valueOf" in this.requests`, `"isPrototypeOf" in this.requests`, `"propertyIsEnumerable" in this.requests`, `"constructor" in this.requests`, `"__defineGetter__" in this.requests`, `"__defineSetter__" in this.requests` are all `true`. The dispatcher then runs `await this.requests[method](...params)`. I confirmed empirically:
  - `dispatch("toString", {})` → returns `"[object Object]"` (success response).
  - `dispatch("valueOf", {})` → returns `{}` (success response).
  - `dispatch("hasOwnProperty", { 0: "foo" })` → returns `false` (success response — leak about which prop names exist on the service).
  - `dispatch("propertyIsEnumerable", { 0: "x" })` → returns `false`.
  - `dispatch("isPrototypeOf", { 0: {} })` → returns `false`.
  - `dispatch("constructor", {})` → throws `"Class constructor X cannot be invoked without 'new'"` — leaks the **service class name** through the error response (`getErrorMessage(error)`).
  - `dispatch("__proto__", {})` → throws `"X.__proto__ is not a function"` — info leak.
- The defining-getter routes (`__defineGetter__`, `__defineSetter__`) are reachable but reject non-function args. **The current "safety" depends on Object.prototype's API surface not accepting JSON-serialized args** — that's accident, not design. Adding any new prototype method that accepts arbitrary input becomes a hijack vector overnight.
- Concrete impact: oracle-like enumeration of own vs prototype keys, class-name leak via constructor-throw. Not an immediate compromise of secrets, but it widens the attack surface and means any future Object.prototype extension or any custom monkey-patch (e.g. a debugging library) becomes a Service hijack.
- Suggested fix:
  Switch from `method in this.requests` to a positive allowlist. Either (a) each Service exposes a static `METHOD_NAMES: Set<string>` it explicitly registers, OR (b) check via `Object.prototype.hasOwnProperty.call(this.requests, method)` AND assert `typeof this.requests[method] === "function"` — but the allowlist option is more robust. Pin with a regression test that sends `{ method: "__proto__" }`, `{ method: "constructor" }`, `{ method: "toString" }`, `{ method: "hasOwnProperty" }`, and asserts an error response (not success).

---

## F4 — `unwrapParams` allocates O(max-numeric-key) array; DOS via crafted params

- Severity: HIGH
- Confidence: HIGH
- File:line: `packages/extension-messaging/src/utils.ts:10-21`
- Category: DOS / memory exhaustion
- Affected code: `unwrapParams`
- Description:
  `unwrapParams` computes `array_max(Object.keys(params).map(+))` and then `for (let i = 0; i <= max; i++) res.push(params[i])`. A single RPC request with `params: { "0": "x", "100000000": "y" }` allocates a **100-million-element array** in the SW heap and runs the loop for ~2s on modern hardware. I confirmed locally: `unwrapParams({ 0: "x", 100000000: "y" })` produces an array of length 100,000,001 in 2.1 seconds. A few concurrent requests like this OOM-crash the SW. Chrome will restart the SW (eventually) but throughout the attack the wallet is unusable.
- Exploit chain:
  1. Content script opens a port to any Service: `chrome.runtime.connect(undefined, { name: "profile" })`.
  2. Sends `{ type: 2, content: { requestId: 1, method: "getProfiles", params: { 0: "x", 999999999: "y" } } }`.
  3. SW allocates 1-billion-element array; throws RangeError or OOM.
  4. Repeat across multiple ports for sustained denial of service.
- This DOS is reachable PRE-AUTHENTICATION (any content script, no unlock required) because the `name in this.requests` gate passes for any valid method name and the param shape check is `typeof wrappedParams !== "object"` only — `{ 0: ..., 999999999: ... }` is an object.
- Compounding with F1: even if F1 is fixed (gated on sender), the popup and other extension surfaces can still hit the same DOS by accident or by sending pathological params from a compromised vendor module.
- Suggested fix:
  In `unwrapParams`, validate `keys.every(k => Number.isInteger(k) && k >= 0 && k < MAX_PARAMS)` where `MAX_PARAMS` ≤ 32 (no RPC method takes more than a handful of args). Also check `params` is a plain object (`Object.getPrototypeOf(params) === Object.prototype`) to prevent prototype-pollution side-channels. Reject malformed params with a `ValidationError` BEFORE dispatching. Pin with a unit test sending `{ 0: "x", 999999: "y" }` and asserting rejection without allocation.

---

## F5 — No per-port / per-sender rate limiting; concurrent floods exhaust SW

- Severity: MEDIUM
- Confidence: HIGH
- File:line: `packages/extension-messaging/src/background/service.ts:40-71` (entire Service class)
- Category: DOS / resource exhaustion
- Affected code: `Service.onConnect` + `Service.onMessage`
- Description:
  No bound on `this.clients.length`, no per-port pending-request cap, no per-port message rate limit. A single content script can call `chrome.runtime.connect` thousands of times in a tight loop — Chrome itself has limits on this (`MAX_TABS` × `MAX_PORTS_PER_TAB`) but those are generous (hundreds per tab). Even at 100 ports × 100 in-flight requests = 10,000 simultaneous awaits, each holding closure state for `await this.requests[method](...)`. Each `unlockProfile` call kicks off PBKDF2 (CPU-bound, ~100ms). Sustained flood → SW pegs CPU and Chrome eventually kills/restarts it.
- The flood compounds with F4 (each request allocates an arbitrary-size array first), F1 (no sender gate), and the lazy-listener buffer overflow (boot-window flood up to 100 buffered messages, but the boot window is short).
- Suggested fix:
  Token bucket per port (e.g. 10 requests/sec, burst 30). Cap `this.clients.length` per service (e.g. 8 ports max). Cap per-port pending requests (e.g. 16). On excess, reject with a `WalletError("RATE_LIMITED", ...)` and tear down the offender's port.

---

## F6 — Offscreen client accepts forged broadcast events (`from === this.service`, no UID)

- Severity: MEDIUM
- Confidence: HIGH
- File:line: `packages/extension-messaging/src/offscreen/client.ts:81-86`
- Category: Integrity / sender-confusion
- Affected code: `ServiceClient.onMessageListener`
- Description:
  The offscreen `ServiceClient.onMessageListener` accepts messages where `message.to === this.uid` OR `(message.type === MessageType.Event && message.from === this.service && message.to === undefined)`. For broadcast events, the only filter is `from === this.service` — a string constant known in the source (e.g. `"pxe"`). The handler then runs `(this as EventsSpec<TEvents>)[event].invoke(payload)` with attacker-controlled `event` name + `payload`. **A content script can `chrome.runtime.sendMessage({ type: 1, from: "pxe", content: { event: "<eventName>", payload: <attacker-data> } })` and every offscreen-client listener will fire its handler with the malicious payload.**
- Current concrete impact: `PxeService` has no events (only methods), so today this is dormant. But the messaging contract is broken — any service that adds a broadcast event (e.g. a future `onNoteAdded`) opens a UI-hijack vector. The popup's note-list view, balance display, etc., would render forged events.
- The handler also doesn't validate `event` is in the schema — calls `.invoke(payload)` on whatever property name comes in. If the consumer-side EventHandler map is implemented as plain object (it is), `(this as any)["constructor"]` resolves to the class constructor — calling `.invoke` on that throws, but earlier in the chain various other prototype-chain methods could be called.
- Suggested fix:
  Validate `sender.id === chrome.runtime.id && !sender.tab` BEFORE accepting any message. Also require an explicit broadcast-target UID handshake instead of "broadcast = no `to` field" — at minimum, accept only events whose `event` name appears in a registered allowlist on the client.

---

## F7 — Lazy-listener has no per-source rate limit; boot-window buffer of 100 entries

- Severity: LOW
- Confidence: MEDIUM
- File:line: `packages/extension-messaging/src/lazy-listener.ts:33,100-106`
- Category: DOS / amplification
- Affected code: `makeLazyListener`, `onIncoming`
- Description:
  The boot-window buffer is capped at 100 entries (drops oldest on overflow). Each buffered entry holds the entire `msg` + `sender` object. A content script can flood messages BEFORE the SW finishes booting (the buffer is attached top-of-file, the `ready` promise resolves after async init). With 100 large messages buffered, the SW's heap pre-pays the cost during boot. Combined with F4 (no `unwrapParams` cap), each buffered message could carry a `{ 0: "x", 999999: "y" }` shape that the real handler then explodes into a giant array.
- Lower severity because the buffer drops oldest (bounded memory at the buffer layer); the amplification only fires once at flush time, after the SW is alive enough to respond normally — at which point F4 dominates anyway.
- Suggested fix:
  Drop messages from senders that fail the sender-validation gate BEFORE they enter the buffer. Reduce `DEFAULT_MAX_BUFFERED` to ~16. Add per-sender rate-limiting at this layer for defense-in-depth.

---

## F8 — `jsonStringify` fallback serializes Errors WITH stack traces

- Severity: MEDIUM
- Confidence: HIGH
- File:line: `packages/wallet-core/src/utils/serialization.ts:36-52` (called from `packages/extension-messaging/src/background/service.ts:139-185` and `offscreen/service.ts:99-138`)
- Category: Info leak
- Affected code: `jsonStringify` Error branch
- Description:
  Mapper noted "Error envelope: no stack traces. Good." That's true for the **error path** (`getErrorMessage(error)` returns `.message` only). BUT the **success path** has a `trySendJsonFallback` that calls `jsonStringify(response.content.result)` when structured clone fails. If `result` happens to contain an Error object nested anywhere in the response, `jsonStringify`'s Error replacer serializes `{ name, message, stack, code, details }`. Stack traces include source-file paths in the built extension bundle — discloses bundler layout, function call chains, and potentially user-input substrings captured in upstream error wrappers.
- The fallback is rare in practice (most responses are plain JSON-safe after `jsonSanitize`), but the OFFSCREEN path's `result.value !== undefined` branch unconditionally invokes the fallback whenever the response contains anything non-cloneable. PXE results from `@aztec/*` packages sometimes embed underlying Errors as fields on result objects (e.g. a partial-success batch result). One leaked stack = one disclosed user-input fragment.
- Compounding: combined with F2 (content script reads broadcast responses), this leak surface includes anyone with content-script access to the offscreen broadcast.
- Suggested fix:
  In the fallback path's `jsonStringify`, force-strip `stack` from any Error encountered: pass a 2nd argument that explicitly omits `stack`. Alternative: refuse to send the fallback when the recursive walk finds an Error inside `result` (treat it like the legacy "drop and let the timeout fire" path).

---

## F9 — `ValidationError.details.issues` discloses sensitive schema field paths to clients

- Severity: LOW
- Confidence: MEDIUM
- File:line: `packages/extension-messaging/src/zod-helpers.ts:38-46`
- Category: Info leak
- Affected code: `validateParams`
- Description:
  On a Zod validation failure, the thrown `ValidationError` carries `details: { method, issues: result.error.issues }`. The `issues` array reveals internal field paths from the schema (e.g. `["body", "credentials", "password"]`). For a service-call-via-content-script attacker (F1/F2), this gives an oracle on which method args are required vs optional and their internal naming. Mild info leak; primarily useful for attackers building exploit primitives against the wallet's RPC surface.
- The flat `error` string in the same response already discloses a summary, so the marginal disclosure of `details.issues` is modest. But there's no need for it on the wire.
- Suggested fix:
  Drop `details.issues` from the wire payload. Keep it for service-side logging only — emit `ValidationError(message, undefined)` on the wire, log full issues to the SW console.

---

## F10 — Non-WalletError throws expose raw `error.message` to clients

- Severity: LOW (depends on what services throw)
- Confidence: MEDIUM
- File:line: `packages/extension-messaging/src/background/service.ts:86-98`, `packages/extension-messaging/src/offscreen/service.ts:84-98`
- Category: Info leak
- Affected code: error-response construction
- Description:
  Both Service catch blocks use `getErrorMessage(error)` (returns `(error as Error)?.message`) and ship that string back to the client. Service authors who `throw new Error(\`Decryption failed for ${profile.id} with hash ${passwordHash}\`)` leak everything in the message string. Spot-checking the codebase didn't surface any such cases TODAY, but the contract is unsafe by default — every future `throw new Error(...)` in a service is a potential info-leak.
- Suggested fix:
  Replace the bare `getErrorMessage(error)` in the error-path with `error instanceof WalletError ? error.message : "Internal error"`. Force services to use `WalletError` subclasses for any wire-exposed message. Log the full message to the SW console only.

---

## F11 — `subscribeWithSnapshot` race assumption fails on the offscreen path

- Severity: LOW
- Confidence: MEDIUM
- File:line: `packages/extension-messaging/src/subscribe-with-snapshot.ts:54-88`
- Category: Logic
- Affected code: docstring + production guarantee
- Description:
  The helper's docstring says "With port FIFO ordering, the snapshot value is always at least as recent as any event delivered during the fetch." That holds for `chrome.runtime.Port` (background path) but NOT for `chrome.runtime.sendMessage` (offscreen path). `sendMessage` is per-message; there's no FIFO between successive sendMessage calls relative to inbound onMessage broadcasts. The offscreen variant could deliver an event between the snapshot-request-send and snapshot-response-receive, and the handler then fires the snapshot AFTER the event, leaving the consumer with stale state — exactly the bug the helper claims to fix.
- The existing test (`subscribe-with-snapshot.test.ts`) models an in-memory source where `setValue` mutates `current` synchronously, so the test PASSES but doesn't validate the offscreen wire behavior. The bug surfaces only when production code uses this helper against an offscreen service client.
- Suggested fix:
  Restrict the helper's contract to port-based clients (background only), document this, and add a build-time check that prevents offscreen clients from being passed in. OR rewrite the helper to use a monotonic version counter on the source side so snapshots can be ordered against events.

---

## F12 — `Service.start()` boot window admits unauthenticated requests that pile up awaiting `ensureInitialized`

- Severity: LOW
- Confidence: MEDIUM
- File:line: `packages/extension-messaging/src/background/service.ts:22-27, 187-199`
- Category: DOS amplification
- Affected code: `Service` constructor registers `onConnect` BEFORE `init()` runs
- Description:
  The constructor immediately registers `chrome.runtime.onConnect.addListener(this.onConnect)`. Any request received in the boot window passes the `method in this.requests` gate, dispatches to the method body, and the method body does `await this.ensureInitialized()` — which polls every 500ms for up to 30s. During the boot window, a flooding attacker can stack hundreds of pending awaits, each holding closure state for the request handler. When `init()` finally completes, all those pending requests fire simultaneously, hammering the SW.
- Suggested fix:
  Gate `Service.onMessage` on `this.initialized` — reject with a "service not yet ready" error if `initialized === false`. Better: don't accept any connections until `start()` is called (defer the `onConnect.addListener` to inside `start()`). Pair with the lazy-listener buffer in F7.

---

## Pre-finding rebuttals (mapper's claims that DON'T hold or are nuanced)

- **Mapper finding #4** ("OffscreenService.onMessage accepts any `from` field in envelope") — CONFIRMED, and the impact is bigger than mapper implied: it's the entry vector for F2 (direct PXE access) AND F6 (forged broadcast events).
- **Mapper finding #5** ("`WalletError.toPayload` returns code+message+details — no stack traces. Good.") — TRUE for the WalletError path, but the **success-path fallback** in `trySendJsonFallback` does ship stack traces when an Error is nested in a result (F8).
- **Mapper finding #6** ("`jsonStringify` fallback exists for circular-ref edge cases — defense-in-depth.") — TRUE, but the same fallback is the F8 stack-trace vector.

---

## What was checked but didn't turn up exploitable findings

- **Prototype pollution via params**: `unwrapParams` uses `Object.keys` which doesn't enumerate `__proto__`. Structured clone (used by `chrome.runtime.Port`) doesn't transport non-enumerable `__proto__` either. The proto-pollution vector is closed by the transport layer; the in-process code is also safe. No finding.
- **`jsonStringify` recursion DOS**: Untested; the `jsonSanitize` upstream means most calls run on already-flat objects. Possible but speculative.
- **WalletError reconstruction**: `walletErrorFromPayload` produces a generic `WalletError` for unknown codes — `details` field is preserved verbatim. The wire risk is on the service-side authoring (F8/F9/F10), not the client reconstruction.
- **Lazy-listener errors swallowed**: Errors thrown by `realHandler` are caught + logged but not re-thrown. Confirmed via the existing test. Behaves correctly; no finding.
- **Client-side `disconnect` race**: `BackgroundServiceClient` already has the A5 fix (captured `connectedPort` local). The rejected-with-`RpcDisconnectedError` path is correct.
- **`MessageType` enum**: Numeric values 1/2/3 — no off-by-one or signature confusion. Both sides use the enum consistently.

---

## Summary by severity

- HIGH (3): F1 (no port.sender check), F2 (no offscreen sender check), F4 (unwrapParams DOS)
- MEDIUM (5): F3 (prototype-chain dispatch), F5 (no rate limiting), F6 (forged broadcast events), F8 (stack leak via fallback), F10 (raw error.message leak — depends on services)
- LOW (4): F7 (lazy-listener buffer amplification), F9 (Zod issues leak), F11 (subscribeWithSnapshot offscreen race), F12 (boot-window admit)

Net read on this cluster: the IPC layer ships with **zero authentication-of-sender**. The fix is a single 4-line sender gate in each Service base class (background `onConnect`, offscreen `onMessageListener`), plus a positive method allowlist (F3) and bounded `unwrapParams` (F4). All other findings are defense-in-depth or follow-on hardening; F1/F2/F3/F4 are the must-fix-before-shipping set.
