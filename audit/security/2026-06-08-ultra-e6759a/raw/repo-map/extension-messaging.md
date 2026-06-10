# Security Map: packages/extension-messaging

**THIS IS THE IPC LAYER.** Popup ↔ SW ↔ offscreen channels. ~1100 LOC.

## Module inventory

| Subdir | Purpose | Language | LOC |
|---|---|---|---|
| `background/` | Service + ServiceClient for popup ↔ SW RPC via `chrome.runtime.Port` | TypeScript | ~450 |
| `offscreen/` | OffscreenService + ServiceClient for SW ↔ offscreen RPC via `chrome.runtime.sendMessage`; telemetry sidecar | TypeScript | ~450 |
| `src/` (root) | Message envelopes, error registry, utilities, pub/sub snapshot helper | TypeScript | ~200 |

## Entrypoints

**ServiceClient ↔ Service (background/)**

- `Service<TRequests, TEvents>`: Server-side base. Registers `chrome.runtime.onConnect` listener at construction (line 25); dispatches by method name via `this.requests[method]` (line 76). Port stored in array; clients tracked but **not validated by origin/sender**.
- `ServiceClient<TRequests, TEvents>`: Client-side base. Calls `chrome.runtime.connect(undefined, { name: this.service })` with only a `name` parameter (line 55); no origin check on the server side.
- Connection lifecycle: Client connects on demand; server accepts any port with matching `name` field. Reconnect on disconnect is silent (line 91 triggers `connect()` automatically).

**OffscreenServiceClient ↔ OffscreenService (offscreen/)**

- `OffscreenService`: Listens on `chrome.runtime.onMessage` (line 30); routes by message `to` field and service name.
- `OffscreenServiceClient`: Sends via `chrome.runtime.sendMessage()` with `from`/`to` fields in message envelope. Per-request UUID for response correlation (line 43).

**Wire shape** (messages.ts)

- `RequestMessage`: `{ type: MessageType.Request, content: { requestId, method, params } }`
- `ResponseMessage`: `{ type: MessageType.Response, content: { requestId, result?, error?, errorPayload?, resultIsJson? } }`
- `EventMessage`: `{ type: MessageType.Event, content: { event, payload } }`
- Error envelope: `errorPayload` contains `{ code, message, details }` for structured `WalletError` subclasses. Plain throws flatten to `error: string`.

## Trust boundaries (this package IS a trust boundary)

### Who can connect (⚠️ CRITICAL)

- `Service.onConnect()` (line 40-48): Filters by `client.name === this.name` but performs **NO sender validation**. Any context (popup, content script, external page) that can call `chrome.runtime.connect({ name: ... })` will be accepted.
- **Vulnerability**: A malicious content script or rogue origin can fabricate a port and send arbitrary method calls if it guesses the service name. No `chrome.runtime.Port.sender` check against extension URL / extension ID.
- Offscreen variant similarly accepts any `from` field in the message.

### Sensitive data crossing the channel

- `params` and `result` are serialized via `jsonSanitize()` (wallet-core utility). The package does NOT inspect payloads — it's transport-agnostic.
- Error responses: Plain `Error` throws are converted to `message` string only (line 86-96). Only `WalletError` subclasses round-trip as structured payloads (line 90).
- **Audit note**: Lines 158-184 in service.ts document a fallback for structured-clone failures (AUDIT plan A6) — if sanitization misses a circular ref or BigInt, the service retries with `jsonStringify()` and the client parses it back. Defense-in-depth but adds a JSON-parsing surface.

### Error envelope (errors.ts)

- Base `WalletError.toPayload()` returns `{ code, message, details }` — no stack trace, no file paths. Subclasses (RpcTimeoutError, UserRejectedError, JobCancelledError, CapabilityNotGrantedError, ValidationError, InvalidPasswordError, ProfileIdConflictError) preserve code + details.
- `walletErrorFromPayload()` (line 220-246) reconstructs typed errors via a switch on `.code`. Unknown codes produce a plain `WalletError` — no eval, no prototype mutation beyond `Object.setPrototypeOf(this, Subclass.prototype)`.
- **Data sensitivity note** (errors.ts lines 129-131): `CapabilityNotGrantedError.message` is a stable public contract; dApp authors substring-match on the literal. Never interpolate origin/profile/account.

### Method dispatch

- Service-side: Method name comes directly from `message.content.method` (line 68 checks `method in this.requests`). This is **membership checking only** — not a whitelist.
- **Vulnerability**: If a service inadvertently adds a property to `this.requests` (via prototype pollution or property assignment outside the constructor), it becomes callable. The check `method in this.requests` is property-name based; no explicit deny-list exists.
- No length/type validation on `params` — the caller wraps positional args as a key-indexed object (utils.ts: `wrapParams`), and the service unwraps them (utils.ts: `unwrapParams`).

### Concurrency & reentrancy

- Service-side: No per-port queueing. `onMessage` handler (line 62) is async and fires in parallel across multiple clients. A single client flooding the service with rapid requests will queue in the browser's event loop; no per-port backpressure exists.
- **Vulnerability**: A malicious client can DOS the service by flooding it with slow methods (e.g., PXE proof-generation) — the service has no rate-limiting or connection-level quota. The 60s timeout on the client side (DEFAULT_RPC_TIMEOUT_MS, line 18) does not protect the server from resource exhaustion.

## Dependency graph

**Workspace imports:**

- `@nulo/wallet-core`: For `ILogger`, `LogLevel`, `EventHandler`, `jsonSanitize`, `jsonStringify`, `getErrorMessage`, `sleep`, `array_max`, `getRandomHex`, and base types.
- **No other workspace deps** — deliberately isolated from `wallet-crypto`, `aztec-runtime`, `wallet-bridge`.

**External:**

- `zod` (peer dependency, optional): Used by consumers for schema validation via `validateParams()` / `validateResult()` helpers.
- `chrome` types: `chrome.runtime.connect()`, `chrome.runtime.onConnect()`, `chrome.runtime.sendMessage()`, `chrome.runtime.onMessage()`.

**Who consumes this:**

- `@nulo/extension`: Service implementations in the SW and OffscreenService on the offscreen document.
- `@nulo/wallet-bridge`: Relies on this messaging layer for wallet-SDK dispatcher RPC.

## Frameworks

- **`chrome.runtime`** (native MV3 API): Port-based RPC (background/), sendMessage-based RPC (offscreen/).
- **No external messaging library** (webext-bridge, webextension-polyfill not used here). Custom typed RPC.
- **Error reconstruction**: `WalletError` subclasses use `Object.setPrototypeOf()` to restore prototype chain across JSON boundary.

## Test surfaces

| File | LOC | Coverage |
|---|---|---|
| `errors.test.ts` | 46 | Error round-tripping: JobCancelledError, UserRejectedError, CapabilityNotGrantedError payload/class preservation |
| `lazy-listener.test.ts` | 203 | Boot-time message buffering: buffer overflow, ready-path dispatch, detach cleanup |
| `subscribe-with-snapshot.test.ts` | 217 | Subscription race-condition closure: snapshot-then-events ordering, reconnect re-fire |

**Missing test surfaces:**

- Sender origin/URL validation: No test that a content script or external origin is rejected.
- Method whitelisting: No test that arbitrary property access fails (e.g., `__proto__`, `constructor`, custom-added properties).
- Oversized payloads: No test for the `jsonStringify()` fallback path.
- Concurrency limits: No test for DOS via flooding or per-port backpressure.
- Offscreen reconnect: No test for stale response handling after disconnect.

## Generated / vendored / dev-only

No generated code. No vendored libraries. All source hand-written.

---

## Key security findings for Phase 2 clustering

1. **⚠️ Trust boundary NOT enforced at port accept** — Service accepts any `chrome.runtime.Port` matching by name only. No `sender` origin check. Content scripts can connect if they know the service name.
2. **⚠️ Method dispatch is membership-not-whitelist** — Checking `method in this.requests` allows any enumerable property. Prototype pollution risk.
3. **⚠️ Concurrent request flood unpaced** — No per-connection rate-limiting or queueing.
4. **Error details could leak in fallback path** — The `jsonStringify()` fallback exists for circular-ref edge cases; depends on upstream sanitization not missing anything.
5. **Test suite does NOT pin security boundaries** — No sender-validation test, no prototype-pollution test, no DOS test. Phase 2 should propose regression pins.
