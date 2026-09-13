# Repo map — `packages/extension-messaging`

Scope: `packages/extension-messaging` (process-boundary messaging layer: service worker ↔ popup ↔
offscreen document; also consumed by `packages/aztec-runtime` for the SW ↔ offscreen PXE channel).
Read-only map, no vulnerability judgments.

## 1. Module inventory

| Module | Path | Purpose | LOC (non-test) |
|---|---|---|---|
| Package root | `packages/extension-messaging/` | Typed RPC plumbing between SW/popup/offscreen; `Service`/`ServiceClient`/`OffscreenService` base classes; Error reconstruction; telemetry sidecar. | ~2208 (src, excl. `testing/`) / ~2448 incl. test-support helpers |
| `core/base-service.ts` | `src/core/base-service.ts` | Transport-agnostic server core: request validation, RPC-surface guard (`rpcMethods`), invoke, error projection, 3-tier send, `init`/`ensureInitialized`. | 230 |
| `core/base-client.ts` | `src/core/base-client.ts` | Transport-agnostic client core: request correlation (id allocation, pending map), timeout lifecycle, response dispatch, event dispatch, disconnect handling. | 381 |
| `core/sender-auth.ts` | `src/core/sender-auth.ts` | `isTrustedInternalSender` — the one sender-identity predicate (F-09), shared by both service transports. | 23 |
| `core/envelope-summary.ts` | `src/core/envelope-summary.ts` | Safe-for-logging envelope summarizers (never echo params/results/unvouched method names). | 115 |
| `core/error-response.ts` | `src/core/error-response.ts` | Projects a thrown value into `{error, errorPayload?}` response fields. | 25 |
| `core/decode.ts` | `src/core/decode.ts` | Success-path result decode (`resultIsJson` fallback). | 16 |
| `core/rpc-methods.ts` | `src/core/rpc-methods.ts` | `defineRpcMethods<Methods>()` — compile-time-checked RPC allowlist builder. | 29 |
| `core/service-client-factory.ts` | `src/core/service-client-factory.ts` | `definePassthroughs`/`definePassthroughsExhaustive` — installs mechanical forwarder methods on a client prototype. | 67 |
| `core/initialization.ts` | `src/core/initialization.ts` | `awaitInitialized` — poll-until-ready helper shared by both service bases. | 21 |
| `core/terminal-status.ts` | `src/core/terminal-status.ts` | `RequestTerminalStatus` union (success/rejected/timeout/disconnected/send_failed). | 21 |
| `background/service.ts` | `src/background/service.ts` | `Service<Methods,Events>` — Port-transport server (popup ↔ SW). | 108 |
| `background/client.ts` | `src/background/client.ts` | `ServiceClient<Methods,Events>` — Port-transport client (popup side). | 157 |
| `offscreen/service.ts` | `src/offscreen/service.ts` | `Service<Methods,Events>` (offscreen) — `sendMessage`-transport server (SW ↔ offscreen), incl. keepalive. | 81 |
| `offscreen/client.ts` | `src/offscreen/client.ts` | `ServiceClient<Methods,Events>` (offscreen) — `sendMessage`-transport client (SW side), incl. `requestAlreadyReady` bypass + telemetry hook. | 165 |
| `offscreen/telemetry.ts` | `src/offscreen/telemetry.ts` | `TelemetrySink` (`LoggingTelemetrySink`/`NoopTelemetrySink`/`MemoryTelemetrySink`) + `sanitizeTelemetry`. | 159 |
| `offscreen/messages.ts` | `src/offscreen/messages.ts` | Adds `{from, to?}` addressing to the shared envelope types. | 15 |
| `messages.ts` | `src/messages.ts` | Wire schema: `MessageType`, `RequestMessage`/`ResponseMessage`/`EventMessage`/content shapes. | 57 |
| `errors.ts` | `src/errors.ts` | `WalletError` hierarchy (13 subclasses), `toPayload`/`walletErrorFromPayload` reconstruction, disconnect-rejection contract. | 401 |
| `zod-helpers.ts` | `src/zod-helpers.ts` | `validateParams`/`validateResult` — Zod-schema wire validation, throws `ValidationError`. | 63 |
| `utils.ts` | `src/utils.ts` | `wrapParams`/`unwrapParams` — explicit-arity positional-params codec (survives `undefined`-hole JSON drop), bounded at `MAX_RPC_ARITY=256`. | 48 |
| `index.ts` / `background/index.ts` / `offscreen/index.ts` | `src/index.ts` etc. | Barrel/subpath exports (see package.json `exports`). | 4–18 each |
| `testing/setup.ts`, `testing/transport-harness.ts` | `src/testing/` | Test-only vitest setup + hand-rolled `chrome.*` stub (NOT exported from package.json `exports`). | excluded from the LOC budget above |

## 2. Entrypoints

All entrypoints are **class-based RPC surfaces**, not raw listeners exposed to arbitrary code — but each ultimately registers exactly one `chrome.runtime` listener per transport side:

- **`chrome.runtime.onConnect`** listener — `background/service.ts:35` (`Service.subscribe` → `onConnect`, `background/service.ts:38`). Fires per incoming Port; `background/service.ts:39` filters by `client.name !== this.name` (routing), `background/service.ts:45` gates on `isTrustedInternalSender` (identity).
- **Port `onMessage`** — `background/service.ts:50` (`client.onMessage.addListener(this.onMessage)`), handler `background/service.ts:67` → `BaseService.handleRequest` (`core/base-service.ts:82`).
- **Port `onDisconnect`** (service side) — `background/service.ts:49`, handler `background/service.ts:55`.
- **`chrome.runtime.connect`** (client side, popup) — `background/client.ts:53` inside `connect()` (`background/client.ts:46`); Port `onMessage`/`onDisconnect` wired at `background/client.ts:54-55`.
- **`chrome.runtime.onMessage`** (offscreen SERVICE) — `offscreen/service.ts:35` (`subscribe`), handler `offscreen/service.ts:38` (`onMessageListener`, gated by `isTrustedInternalSender` at `offscreen/service.ts:41`) → `offscreen/service.ts:48` (`onMessage`) → `BaseService.handleRequest`.
- **`chrome.runtime.onMessage`** (offscreen CLIENT, SW-side, e.g. PXE client in `aztec-runtime`) — `offscreen/client.ts:47` (registered in `connect()`), handler `offscreen/client.ts:60` (`onMessageListener`, **no sender check** — see §3) → `offscreen/client.ts:68` (`onMessage`) → `BaseServiceClient.handleResponse`/`handleEvent`.
- **RPC method dispatch** (per concrete service) — `BaseService.invoke` (`core/base-service.ts:125-127`): `(this as Record<string,fn>)[method](...params)`, gated upstream by the `rpcMethods` allowlist check at `core/base-service.ts:94`.
- **Event dispatch** (per concrete client) — `BaseServiceClient.handleEvent` (`core/base-client.ts:230-242`): looks up `(this as Record<PropertyKey,unknown>)[event]`, gated by `instanceof EventHandler` + not in `reservedEventNames`.
- **Framework convenience RPCs**: `backup`/`restore` — declared in `frameworkRpcMethods` (`background/service.ts:25`), default impls at `background/service.ts:101-107`; client-side callers at `background/client.ts:143-149`. Not present on the offscreen transport (its `frameworkRpcMethods` stays the base default empty set).
- **Public exports** (entrypoints for consumers) — `src/index.ts` (types-only marker), `src/background/index.ts` (re-exports `Service`, `ServiceClient`, `defineRpcMethods`, `definePassthroughs(Exhaustive)`), `src/offscreen/index.ts` (same + `telemetry`), `src/errors.ts`, `src/messages.ts`, `src/utils.ts`, `src/zod-helpers.ts` — all declared as subpath exports in `package.json` (`.`, `./background`, `./offscreen`, `./errors`, `./messages`, `./utils`, `./zod`).
- No extension pages/windows, content-script injection, `window.postMessage`, or `BroadcastChannel` transport is defined in this package (grepped — none found). The content-script ↔ dApp `window.postMessage` bridge lives in `apps/extension/src/content-script/` / `wallet-bridge`, outside this package.

## 3. Trust boundaries

**Untrusted-input entry points into this package:**
- Any `chrome.runtime.Port` message (popup→SW or, in principle, any same-extension context that can connect to the named port) — received at `background/service.ts:67` (`onMessage`).
- Any `chrome.runtime.sendMessage` payload delivered to the offscreen listener — received at `offscreen/service.ts:38` (`onMessageListener`).
- Response/event traffic delivered back to a client — `background/client.ts:86` (Port) and `offscreen/client.ts:60` (sendMessage).
- The `content` of every request (`method`, `params`, `requestId`) is attacker-shaped whenever the sender is a compromised/foreign context; the base classes treat it as hostile even after the sender check passes (malformed `requestId`, non-object `params`, unregistered `method`).

**Sender/origin/permission checks — WHERE PRESENT:**
- `isTrustedInternalSender` (`core/sender-auth.ts:17-23`, marker `F-09`): `sender.id !== chrome.runtime.id` → reject; else `sender.url === undefined || sender.url.startsWith(chrome.runtime.getURL(""))`. Deliberately does **not** discriminate on `sender.tab` (an extension page can legitimately live in a tab — options page, popup-in-tab, e2e).
  - Invoked at `background/service.ts:45` inside `onConnect`, gating which Ports may attach to a `Service`.
  - Invoked at `offscreen/service.ts:41` inside `onMessageListener`, gating which `sendMessage` calls the offscreen `Service` will act on.
- Port **name** match — `background/service.ts:39` (`client.name !== this.name`): routing only, not an identity/authorization check (any same-extension sender can open a Port with any name).
- Offscreen envelope **address** match — `offscreen/service.ts:42` (`message.to === this.name`) and `offscreen/client.ts:62` (`message.to === this.uid` / event `from === this.service && to === undefined`): routing/correlation, not sender authentication (uid is a random 8-hex string from `getRandomHex(8)`, `offscreen/client.ts:38`, but it is a routing token, not a verified-sender credential).
- RPC-surface allowlist (`D10`) — `core/base-service.ts:94` (`this.rpcMethods.has(methodName) && this.frameworkRpcMethods`): the ONLY method names ever invoked via `invoke()` (`core/base-service.ts:126`) are those a concrete service explicitly registers via `defineRpcMethods<Methods>()(...)` (`core/rpc-methods.ts:23-29`) — blocks reaching inherited/prototype/framework methods (`toString`, `constructor`, `start`, `emit`, …) from an attacker-controlled `method` string.
- Event-name allowlist (client side) — `core/base-client.ts:230-242` (`handleEvent`): the received `event` key must resolve to a real `EventHandler` instance on `this` AND must not be in `reservedEventNames` (`background/client.ts:37`: `onConnected`/`onDisconnected`) — blocks a forged event message from invoking framework lifecycle handlers or non-event properties.
- `requestId` validation — `core/base-service.ts:91-95`: must be `Number.isSafeInteger` and `> 0`; otherwise dropped silently (no response) — defends against NaN/Infinity/float/object/hostile-string ids.
- Params-shape validation — `core/base-service.ts:99-105`: `wrappedParams` must be a non-null object or the request gets a clean `ValidationError` reply (not a hang/crash).
- Params-arity bound — `utils.ts:1-3, 34-48` (`MAX_RPC_ARITY = 256`): `unwrapParams` never iterates past 256 even given a hostile `{999999999: "x"}` or bogus `n`.

**Sender/origin checks — WHERE ABSENT (noted, not judged):**
- `offscreen/client.ts:60` (`onMessageListener`) declares only `(message)` — no `sender` parameter is read or checked at all. Every response the SW-side offscreen client accepts is gated purely by the routing match on `message.to`/`message.from` (§ above), not by `isTrustedInternalSender` or any sender-identity check. This is the one message-receiving listener in the package that omits the sender check present on its three siblings (`background/service.ts:45`, `offscreen/service.ts:41`; the Port-based `background/client.ts:86` is implicitly scoped because the client itself created the Port via `chrome.runtime.connect(undefined, …)`, which Chrome always resolves to the caller's own extension).
- `background/client.ts:86` (`onMessage`, Port-based) and `background/service.ts:67` (`onMessage`, Port-based) do not re-check sender per message — they rely on the one-time `isTrustedInternalSender` check at Port-connect time (`background/service.ts:45`) plus the Port object's fixed identity for the life of the connection.
- `frameId` is never read or checked anywhere in the package (grepped — zero occurrences).

**Secrets / sensitive data handling:** this package carries no secrets itself (no seed/key/password/PRF/session-token literals) but is the transport for RPC calls whose `params`/`result` frequently DO carry them (`unlockProfile(id, password)`, `importMnemonic(...)`, `exportMnemonic()`, etc. — per `core/envelope-summary.ts:6-16` doc comment). Handling:
- `core/envelope-summary.ts` is the deliberate secrecy boundary for **logging**: `summarizeContent`/`summarizeMessage` (`core/envelope-summary.ts:108-115`) rebuild a fixed allowlisted shape (ids, arities, presence booleans) and NEVER include `params`/`result`/`payload` contents; a bare method/event name is echoed only when the caller's `vouch` predicate (`isRegisteredName`, `core/base-service.ts:185`) confirms it is a registered name — otherwise it's reduced to `[unregistered:<length>]` (`core/envelope-summary.ts:21-25`).
- `offscreen/telemetry.ts:59-90` (`sanitizeTelemetry`) is the equivalent boundary for the offscreen telemetry sidecar: only `method`/`requestId`/timestamps/`status` and a closed whitelist of static `detail` strings (`ALLOWED_DETAILS`, `offscreen/telemetry.ts:67-76`) ever reach a sink; everything else (params, response data, `error.message`, stack traces) is documented as DISALLOWED at `offscreen/telemetry.ts:26-29`.
- Structured error `details` (`WalletErrorPayload.details`, `errors.ts:16-21`) round-trip whatever the throwing service attached — this package does not scrub `details`; several call sites document a "never put user input here" contract inline (e.g. `CapabilityNotGrantedError` at `errors.ts:143-146`, `TooManyPendingError` at `errors.ts:162-166` — both note the wallet-sdk wraps the envelope in `new Error(JSON.stringify(error))`, so unescaped interpolation would break the JSON, not just leak data).

**External calls / storage writes:** none. This package makes no network calls and never touches `chrome.storage.*`, IndexedDB, or PXE (grepped — zero occurrences of `chrome.storage`/`@aztec/`). It only uses `chrome.runtime.*` (connect/onConnect/onMessage/sendMessage/id/getURL) and `chrome.alarms`/keepalive is NOT used here (the offscreen keepalive at `offscreen/service.ts:73-80` sends a plain `sendMessage`, not an alarm).

## 4. Dependency graph (one level deep)

```
core/base-service.ts     → @nulo/wallet-core/{logger,utils,base}; ./error-response; ./initialization;
                           ./envelope-summary; ../errors (ValidationError); ../utils (unwrapParams)
core/base-client.ts      → @nulo/wallet-core/{logger,utils,base}; ./decode; ../utils (wrapParams);
                           ../errors; ./terminal-status; ./envelope-summary
core/sender-auth.ts      → chrome.runtime (global) only — no internal imports
core/envelope-summary.ts → no internal imports (pure)
core/error-response.ts   → @nulo/wallet-core/utils; ../errors (WalletError)
core/rpc-methods.ts      → no internal imports (pure generic helper)
core/service-client-factory.ts → @nulo/wallet-core/base (MethodsMap type only)
core/decode.ts           → none
core/initialization.ts   → @nulo/wallet-core/utils (sleep)
core/terminal-status.ts  → none (pure type)

background/service.ts    → core/base-service.ts (BaseService); core/sender-auth.ts (isTrustedInternalSender);
                           core/envelope-summary.ts (summarizeMessage); core/base-client.ts (type ResponseContentLike);
                           ../messages.ts
background/client.ts     → core/base-client.ts (BaseServiceClient); core/envelope-summary.ts (summarizeMessage);
                           ../messages.ts; @nulo/wallet-core/{logger,utils}

offscreen/service.ts     → core/base-service.ts; core/sender-auth.ts; core/envelope-summary.ts;
                           core/base-client.ts (type only); ../messages.ts (MessageType); ./messages.ts (local types)
offscreen/client.ts      → core/base-client.ts; core/envelope-summary.ts; ../messages.ts; ./messages.ts;
                           ./telemetry.ts (TelemetrySink, LoggingTelemetrySink)
offscreen/telemetry.ts   → @nulo/wallet-core/logger; core/terminal-status.ts (RequestTerminalStatus)
offscreen/messages.ts    → ../messages.ts (base envelope types); @nulo/wallet-core/base (type only)

messages.ts              → @nulo/wallet-core/base (type only); ./errors.ts (type WalletErrorPayload)
errors.ts                → no internal imports (self-contained hierarchy)
zod-helpers.ts           → zod (peer, optional); ./errors.ts (ValidationError)
utils.ts                 → none (pure)

background/index.ts      → ./client; ./service; ../core/rpc-methods (defineRpcMethods);
                           ../core/service-client-factory (definePassthroughs, definePassthroughsExhaustive)
offscreen/index.ts        → ./client; ./service; ./telemetry; ../core/rpc-methods (defineRpcMethods)
index.ts                  → (no runtime exports — doc-only marker)
```

**Handoff edges (cross-boundary):**
- `chrome.runtime.onConnect` (Chrome) → `Service.onConnect` (`background/service.ts:38`) — **port open → handler**.
- `client.onMessage` (Port event) → `Service.onMessage` (`background/service.ts:67`) → `BaseService.handleRequest` (`core/base-service.ts:82`) — **message produce (popup) → consume (SW)**.
- `Service.sendResponse`/`wrapResponse` → `client.postMessage` (`background/service.ts:81-83`) → popup's `port.onMessage` (`background/client.ts:86`) → `BaseServiceClient.handleResponse` (`core/base-client.ts:194`) — **message produce (SW) → consume (popup)**; settles the pending-request map (`core/base-client.ts:261` `settle`).
- `BaseService.emit` (`core/base-service.ts:129`) → `sendEvent` (`background/service.ts:85-94`, broadcast to every connected `clients[]` Port) → client `onMessage` (`background/client.ts:86`) → `BaseServiceClient.handleEvent` (`core/base-client.ts:230`) → concrete client's `EventHandler.invoke` — **event emit → listener**.
- `chrome.runtime.onMessage` (offscreen transport) → `Service.onMessageListener` (`offscreen/service.ts:38`, sender-gated) → `onMessage` (`offscreen/service.ts:48`) → `BaseService.handleRequest` — **message produce (SW) → consume (offscreen)**.
- `Service.rawSend` (`offscreen/service.ts:62-64`) → `chrome.runtime.sendMessage` → SW's `ServiceClient.onMessageListener` (`offscreen/client.ts:60`, **not sender-gated**) → `onMessage` (`offscreen/client.ts:68`) → `BaseServiceClient.handleResponse`/`handleEvent` — **message produce (offscreen) → consume (SW)**.
- `defineRpcMethods<Methods>()(...)` (registration, per concrete `Service` subclass in `apps/extension`/`packages/aztec-runtime`) → consumed at `core/base-service.ts:94` (the dispatch guard) — **DI/service-registration → consumer**.
- `definePassthroughsExhaustive<Methods>()()(proto, names)` (registration, per concrete `ServiceClient` subclass) → installs forwarder methods that call the private `request()` — **DI/service-registration → consumer**, client side.
- `ServiceCollection`/`IService.start(services)` (`@nulo/wallet-core/base`) → `BaseService.start` (`core/base-service.ts:64`) → `init(services)` (overridden per concrete service) — **DI/service-registration → consumer**, lifecycle wiring owned by `wallet-core`, consumed here.

## 5. Frameworks / libs

- **Crypto libs**: none. This package performs no cryptography; `@nulo/wallet-crypto` sits below it in the layer order but is not a dependency of `extension-messaging` (`package.json` only lists `@nulo/wallet-core`).
- **Validation libs**: `zod` — declared as an **optional peer dependency** `^4` (`package.json:22-28`), dev-pinned to `^4.4.3` for the package's own tests. Used only in `src/zod-helpers.ts` (`validateParams`/`validateResult`), which is an opt-in subpath export (`./zod`) — a consumer that never imports `@nulo/extension-messaging/zod` never needs zod installed.
- **Messaging abstractions**: the package itself IS the messaging abstraction layer — `Service`/`ServiceClient` (Port transport, `src/background/`), `Service`/`ServiceClient` (sendMessage transport, `src/offscreen/`), both built on a shared `BaseService`/`BaseServiceClient` core (`src/core/base-service.ts`, `src/core/base-client.ts`).
- **Storage abstractions**: none used in this package.
- **`@aztec/*` packages**: none used in this package (grepped — zero occurrences). Consumed indirectly: `packages/aztec-runtime/src/pxe/{client,service}.ts` import `ServiceClient`/`Service` from `@nulo/extension-messaging/offscreen` to carry `@aztec/*`-typed PXE RPCs across the SW↔offscreen boundary, but the `@aztec/*` types themselves live entirely in `aztec-runtime`, not here.
- **Dependency**: `@nulo/wallet-core` (workspace) — supplies `ILogger`/`LogLevel`, `EventHandler`, `jsonSanitize`/`jsonStringify`/`getErrorMessage`/`errorMessageFromUnknown`, `sleep`, `getRandomHex`, and the base service types (`IService`, `ServiceCollection`, `EventsMap`, `MethodsMap`, `EventsSpec`, `MethodsSpec`, `ServiceSpec`).
- **Dev/test-only**: `@webext-core/fake-browser` (`^1.5.2`), `chrome-types` (`^0.1.429`), `jsdom` (`^29.1.1`), `vitest` (`^4.1.9`), `typescript` (`^6.0.3`) — none shipped in the built extension.

## 6. Test surfaces

Colocated `*.test.ts` next to source, all in `src/`:

| Test file | LOC | Covers |
|---|---|---|
| `background/client.test.ts` | 557 | Frozen transport error contract, response correlation, timeout, error deserialization, `resultIsJson` fallback (AUDIT A6), port disconnect race (AUDIT A5), `disconnect()`, onDisconnect→reconnect. |
| `background/service.test.ts` | 335 | Envelope validation, success/error path, 3-tier send fallback, malformed params (no silent hang), event emit, `ensureInitialized`. |
| `offscreen/client.test.ts` | 618 | Frozen transport error contract, `request()` core, telemetry + send-failure, pending-map leak guards, `requestAlreadyReady` bypass. |
| `offscreen/service.test.ts` | 306 | Envelope validation, success/error path (structured `errorPayload`, D9), 3-tier send fallback, malformed params, event emit, `ensureInitialized`. |
| `core/hardening.test.ts` | 187 | Adversarial-input sweep (see below) — the package's explicit security-hardening suite. |
| `errors.test.ts` | 218 | `walletErrorFromPayload` round-trips per subclass, prototype/`instanceof` identity ritual, `remoteErrorFromResponseContent`, `isClientDisconnectRejection`. Includes a **(BUG PIN)**: `TOO_MANY_PENDING` is not in the reconstruction switch (`errors.ts:328-341`) and deliberately reconstructs as a base `WalletError`, not `TooManyPendingError` (`errors.test.ts:166-178`). |
| `core/core.test.ts` | 85 | `decodeResult`, `buildErrorResponseContent`, `awaitInitialized`. |
| `core/envelope-summary.test.ts` | 132 | Every summarizer path incl. hostile/throwing-getter shapes. |
| `core/sender-auth.test.ts` | 45 | `isTrustedInternalSender` — same-extension SW/popup/offscreen/options acceptance, foreign-id rejection, content-script (web-url) rejection, undefined-sender rejection, Firefox (`moz-extension://`) parity. |
| `core/service-client-factory.test.ts` | 88 | `definePassthroughs`/`definePassthroughsExhaustive` forwarding + name/enumerability identity. |
| `core/base-client-readiness.test.ts` | 52 | B-15 pin: a wedged transport readiness rejects within its configured timeout. |
| `utils.test.ts` | 55 | `wrapParams`/`unwrapParams` explicit-arity round-trip + hostile-input posture (huge sparse key, bogus `n`, arity cap). |

`core/hardening.test.ts` (`packages/extension-messaging/src/core/hardening.test.ts`) is the concentrated adversarial suite: hostile event names (`toString`, `constructor`, `__proto__`, `connect`, `disconnect`), replayed/duplicate responses, malformed inbound messages (`null`/`42`/wrong `type`), hostile `requestId`s (`0`, `-1`, non-integer, `NaN`/`Infinity`, non-numeric), hostile/non-registered method names (`__proto__`, `constructor`, `prototype`, `hasOwnProperty`, `valueOf`, `start`, `emit`, trailing-space `"echo "`), forged `onConnected`/`onDisconnected` lifecycle events, malformed `resultIsJson` payload (fails closed), and a sparse/huge-key params object (bounded unwrap, no DoS).

**Well-covered**: the request/response correlator (timeout, disconnect, replay-idempotency), the RPC-surface guard (D10), sender authentication (`isTrustedInternalSender`), envelope-summary log-safety, error round-tripping.

**Thinner / notable gaps** (rough, not exhaustive):
- `zod-helpers.ts` has **no test file inside this package** — its only test coverage found is `apps/extension/src/wallet/base/zod-helpers.test.ts` (a consumer-side test), so this package's own `bun run test` does not exercise `validateParams`/`validateResult`.
- The offscreen client's un-sender-checked `onMessageListener` (`offscreen/client.ts:60`, §3) has no dedicated adversarial test in `hardening.test.ts` (which targets the `background/` transport only — its `HClient`/`HService` fixtures are built on `../background/client` and `../background/service|hs`, not the offscreen transport).
- `core/initialization.ts`'s `awaitInitialized` timeout-exceeded branch is covered generically (`core/core.test.ts:73`) but not from within a real `Service.start()` call site.
- `testing/transport-harness.ts` and `testing/setup.ts` are test infrastructure, not test subjects (see §7).

## 7. Generated / vendored / fixture / test-only code

- `src/testing/setup.ts` and `src/testing/transport-harness.ts` — **test-only**, NOT production-wired. Not part of the `package.json` `exports` map (only `.`, `./background`, `./offscreen`, `./errors`, `./messages`, `./utils`, `./zod` are exported); the package README explicitly says the setup file is for consumer packages that opt in, and most extension tests use their own setup. No file under `apps/extension/src/**` (non-test) imports from `@nulo/extension-messaging/testing/*`.
- All `*.test.ts` files (12 files, ~2678 LOC) — test-only, excluded from the production bundle by the build (vite only bundles what's imported from non-test entrypoints; these are colocated but never imported by `src/index.ts` or any subpath export).
- Nothing in this package is generated (no codegen step in `package.json` scripts — only `test` and `typecheck`) or vendored from an external source.
- No fixtures directory exists in this package.

## 8. Security-relevant invariants (READMEs / comments / AUDIT markers)

From `packages/extension-messaging/README.md` ("Key invariants"):
- *"Errors are reconstructed across the wire as real `Error` instances. On the client, compare with `err instanceof Error && err.message === "…"` — never `err === "…"`."*
- *"Port reconnects are silent. Service clients re-establish their port and re-subscribe to events on disconnect; in-flight requests reject with `PortDisconnectedError`* [sic — actual class is `RpcDisconnectedError`, see `errors.ts:69-75`] *. Callers should treat that as a retryable signal, not a fatal error."*
- *"Telemetry is best-effort. … It must not be on the request hot path; lost telemetry never fails an RPC."*
- *"No service logic in this package. This is plumbing only."*
- *"Zod helpers are validation, not transformation. Schemas verify the wire shape; they do not coerce values."*

From `ARCHITECTURE.md:98` (§3): *"`Error` instances are reconstructed across the wire — comparing error messages on the client must use `err instanceof Error && err.message === "..."`, not `err === "..."`."* (duplicates the README invariant; both sides should be checked for drift.)

Inline `AUDIT`/marker comments (grepped, non-test files):
- `core/base-service.ts:25-27`: *"the EXPLICIT RPC-surface guard (`rpcMethods`) — only declared method names are callable; inherited/prototype/framework/helper methods are not (D10 security fix)."*
- `core/base-service.ts:85-90`: *"Strict envelope: requestId must be a positive safe integer (NaN / Infinity / floats / hostile string / object ids are dropped, not echoed). D10: only explicitly-registered method names are callable — the service's own `rpcMethods` plus the base-level framework RPCs (backup/restore). Everything else … is dropped."*
- `core/base-service.ts:178-185` (`isRegisteredName` doc): *"The envelope-summary logger echoes a method name only when this returns true: those log lines fire on MALFORMED input, where the 'method' is attacker-chosen and could just as easily be a password."*
- `core/sender-auth.ts:1-16` (F-09): *"authenticate the sender of an internal extension message. Trust same-extension SW / popup / offscreen / options contexts; reject foreign extensions and content-scripts the extension injected into a web page. The discriminator is `sender.url`, NOT `sender.tab` … `sender.url`/`sender.id` are set by Chrome, not spoofable by the sender."*
- `background/service.ts:42-44` (F-09 at Port connect): *"reject Ports opened by anything other than a same-extension SW / popup / offscreen context (foreign extension id, or a tab-bound content-script sender)."*
- `offscreen/service.ts:39-40` (F-09 at sendMessage listener): *"only same-extension SW / popup / offscreen senders may drive the offscreen listener — reject foreign extensions and any tab-bound sender."*
- `background/client.ts:123-130` (AUDIT A5): *"capture the connected port locally so a concurrent onDisconnect (which sets `this.port = undefined` via `disconnect()`) can't turn this `postMessage` into a null deref."*
- `errors.ts:58-67` (`RpcDisconnectedError` doc): *"Closes AUDIT A5 ('port!.postMessage non-null assertion race')."*
- `core/base-client.ts:223-229` (`handleEvent` doc): *"Hardened two ways: the named property must be a real `EventHandler` … AND it must not be a framework-reserved lifecycle handler (so a forged message can't drive reconnect/subscription logic via `onConnected`/`onDisconnected`)."*
- `core/base-client.ts:232-236`: *"Unvalidated and sender-controlled: a forged message can put a secret in the event slot, and this line is at Warn, above the level filter. Describe it, never echo it."*
- `core/envelope-summary.ts:1-16` (module doc): *"the very next statement sends the client a clean error response. A hostile object with a throwing getter would otherwise take the whole handler down … turning a log-hygiene helper into a denial of service."* → enforced by the `guard()` try/catch at `core/envelope-summary.ts:89-95`.
- `utils.ts:1-3`: *"the cap bounds `unwrapParams` so a hostile params object can't drive a huge loop"* (`MAX_RPC_ARITY = 256`).
- `offscreen/telemetry.ts:11-33` (data-sensitivity contract, user-flagged): explicit ALLOWED/DISALLOWED field lists; *"Sinks MUST call `sanitizeTelemetry()` before logging."*
- `offscreen/client.ts:95-110` (`requestAlreadyReady` doc): *"Never expose publicly: a generic readiness bypass would let arbitrary calls race the transport."* — this bypass is `protected`, consumed by `packages/aztec-runtime`'s PXE client for an authority-check-then-send sequence.
- `errors.ts:143-146` / `errors.ts:162-166`: *"never interpolate user input … because the wallet-sdk wraps the envelope in `new Error(JSON.stringify(error))` and unescaped input would break the JSON."* (message-stability + injection-safety contract for two error classes.)
- `core/base-client.ts:108-114` / `279-282` (B-13/B-15): the request deadline is set BEFORE awaiting transport readiness, "because a wedged transport whose `connect()` retries forever would otherwise hang the request past its configured timeout."

## Consumers in `apps/extension/src` that instantiate a client or server from this package

Grep of `from "@nulo/extension-messaging` across `apps/extension/src` (non-test files only; test files also import heavily but are excluded here). Every `Service`/`ServiceClient` subclass constructor lives in a paired `service.ts`/`client.ts` file per domain, all via the `/background` subpath — **no file under `apps/extension/src` imports `@nulo/extension-messaging/offscreen`** (that subpath's only consumer is `packages/aztec-runtime/src/pxe/{client.ts,service.ts}`, which builds the PXE `Service`/`ServiceClient` used by the offscreen document and the SW; wired into the extension only via `apps/extension/src/offscreen/index.ts:101` (`new ProfileServiceClient()`/`new LoggerServiceClient()` — themselves `/background`-transport clients passed into `createPxeOffscreen`) and `apps/extension/src/wallet/services/execution/*` at the aztec-runtime boundary).

`Service`/`defineRpcMethods` imports (server side, `@nulo/extension-messaging/background`):
- `apps/extension/src/wallet/services/account/service.ts:7`
- `apps/extension/src/wallet/services/account-state/service.ts:6`
- `apps/extension/src/wallet/services/auth-registry/service.ts:5`
- `apps/extension/src/wallet/services/config/service.ts:3`
- `apps/extension/src/wallet/services/contact/service.ts:3`
- `apps/extension/src/wallet/services/dapp-interaction/service.ts:3`
- `apps/extension/src/wallet/services/dapp-session/service.ts:2`
- `apps/extension/src/wallet/services/execution/service.ts:30`
- `apps/extension/src/wallet/services/fpc/service.ts:4`
- `apps/extension/src/wallet/services/incoming-transfer/service.ts:3`
- `apps/extension/src/wallet/services/logger/service.ts:2`
- `apps/extension/src/wallet/services/log-viewer/service.ts:2`
- `apps/extension/src/wallet/services/network/service.ts:5`
- `apps/extension/src/wallet/services/note/service.ts:6`
- `apps/extension/src/wallet/services/operation-journal/service.ts:1`
- `apps/extension/src/wallet/services/passkey/service.ts:2`
- `apps/extension/src/wallet/services/price/service.ts:3`
- `apps/extension/src/wallet/services/profile/service.ts:7`
- `apps/extension/src/wallet/services/task/service.ts:2`
- `apps/extension/src/wallet/services/token/service.ts:3`
- `apps/extension/src/wallet/services/token-balance/service.ts:5`
- `apps/extension/src/wallet/services/transaction/service.ts:5`

`ServiceClient`/`definePassthroughsExhaustive` imports (client side, `@nulo/extension-messaging/background`):
- `apps/extension/src/wallet/services/account/client.ts:2`
- `apps/extension/src/wallet/services/account-state/client.ts:2`
- `apps/extension/src/wallet/services/auth-registry/client.ts:2`
- `apps/extension/src/wallet/services/config/client.ts:2`
- `apps/extension/src/wallet/services/contact/client.ts:2`
- `apps/extension/src/wallet/services/dapp-interaction/client.ts:2`
- `apps/extension/src/wallet/services/dapp-session/client.ts:2`
- `apps/extension/src/wallet/services/execution/client.ts:2`
- `apps/extension/src/wallet/services/fpc/client.ts:2`
- `apps/extension/src/wallet/services/incoming-transfer/client.ts:2`
- `apps/extension/src/wallet/services/logger/client.ts:1`
- `apps/extension/src/wallet/services/log-viewer/client.ts:2`
- `apps/extension/src/wallet/services/network/client.ts:2`
- `apps/extension/src/wallet/services/note/client.ts:2`
- `apps/extension/src/wallet/services/operation-journal/client.ts:1`
- `apps/extension/src/wallet/services/passkey/client.ts:2`
- `apps/extension/src/wallet/services/price/client.ts:2`
- `apps/extension/src/wallet/services/profile/client.ts:2`
- `apps/extension/src/wallet/services/task/client.ts:2`
- `apps/extension/src/wallet/services/token/client.ts:2`
- `apps/extension/src/wallet/services/token-balance/client.ts:2`
- `apps/extension/src/wallet/services/transaction/client.ts:2`

`validateParams`/`validateResult` (`@nulo/extension-messaging/zod`):
- `apps/extension/src/wallet/services/network/client.ts:3`, `apps/extension/src/wallet/services/network/service.ts:6`
- `apps/extension/src/wallet/services/operation-journal/client.ts:2`, `apps/extension/src/wallet/services/operation-journal/service.ts:3`

`errors.ts` (`WalletError` subclasses) — imported widely for `instanceof` checks / throws, not client/server instantiation; notable non-service call sites: `apps/extension/src/wallet/services/account-integrity/coordinator.ts:7`, `apps/extension/src/composables/full-backup-restore.ts:13`, `apps/extension/src/popup/pages/auth.vue:21`, `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:29`, `apps/extension/src/wallet/utils/create-passkey-profile.ts:1` (full list in the earlier grep output; 30 non-test files import `@nulo/extension-messaging/errors`).

**Service-worker entrypoint** wiring these servers together: `apps/extension/src/wallet/index.ts` (SW module entry, declared as `background.service_worker` in `apps/extension/manifest/manifest.config.ts:25`) → `createWalletRuntime()` (`apps/extension/src/wallet/runtime.ts`, not read in this pass) constructs the full service graph. **Offscreen entrypoint**: `apps/extension/src/offscreen/index.ts` constructs `new LoggerServiceClient("offscreen")` (line 41) and, inside `createPxeOffscreen({...})` (line 100), `new ProfileServiceClient()` / `new LoggerServiceClient()` (lines 101-102) — all `/background`-transport clients — plus the PXE offscreen `Service` (constructed inside `@nulo/aztec-runtime/offscreen/entry`, outside this package's or this app's direct instantiation).
