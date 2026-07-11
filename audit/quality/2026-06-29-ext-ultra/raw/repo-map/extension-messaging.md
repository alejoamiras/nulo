# Repo map — `@nulo/extension-messaging`

> Phase 1 of `/harden quality` (ultra). Read-only map. Lens: **TYPING quality** + **DEDUP**.
> Package = the cross-process RPC/messaging boundary the whole extension's type-safety rests on.
> `packageManager` bun; `private`; v0.2.0; ESM; `zod ^4` is an **optional peer dep**.

---

## 1. Module inventory

21 source `.ts` (non-test) + 8 test files. Note: **README file-map is STALE** — it lists
`src/background/service.ts`/`client.ts` and `src/zod-helpers.ts`/`src/utils.ts` but omits the
entire `core/` subdir (the shared correlator extracted under the D7/D9/D10 hardening work). The
README also says the offscreen client "rejects with raw strings" — that is no longer true (it now
emits typed `WalletError`s, identical shaping to the Port client; see §9 DEDUP-1).

| Path | LOC | Purpose | Typing notes |
|---|---|---|---|
| `src/index.ts` | 19 | Doc-only `export {}`; subpath guide. | — |
| `src/messages.ts` | 58 | **Wire envelope types**: `MessageType` enum + `EventMessage`/`RequestMessage`/`ResponseMessage` (+ `…Content`). | The ONE place typing is done right: real discriminated unions on `type: MessageType`. |
| `src/errors.ts` | 247 | `WalletError` base + 9 subclasses + `walletErrorFromPayload()` registry. | `WalletErrorPayload.details?: unknown` → per-subclass re-casts. |
| `src/zod-helpers.ts` | 64 | `validateParams`/`validateResult` (thin `ZodType<T>` wrappers → throw `ValidationError`). | Schema `T` is decoupled from method's actual param tuple (see §9 TYPE-10). |
| `src/utils.ts` | 29 | `wrapParams` (array→`Record<number,unknown>`) / `unwrapParams` (reverse, DoS-bounded `MAX_RPC_ARITY=256`). | `unwrapParams<T>` returns `unknown[] as T` — a typed lie. |
| `src/core/base-client.ts` | 300 | **`BaseServiceClient`** — shared request correlator: id alloc, single pending map (resolver+timer+telemetry in one entry), timeout, idempotent `settle`, success decode, event dispatch. Abstract transport hooks. | `ResponseContentLike` loose shadow of `ResponseContent`; `this as unknown as Record<PropertyKey,unknown>` event reach. |
| `src/core/base-service.ts` | 220 | **`BaseService`** — shared service core: RPC-surface guard, param unwrap, invoke, error projection, 3-tier send, `ensureInitialized`. Abstract transport seams. | `RequestContentLike` loose shadow; `invoke` = `this as unknown as Record<string,fn>`; `as unknown as EventsSpec`. |
| `src/core/decode.ts` | 16 | `decodeResult` — JSON.parse when `resultIsJson`. | clean (`as T` on parse only). |
| `src/core/error-response.ts` | 25 | `buildErrorResponseContent` — service-side inverse of `walletErrorFromPayload`. | clean; physically in `core/` but conceptually an *errors* unit. |
| `src/core/initialization.ts` | 22 | `awaitInitialized` poll-loop (500ms, 30s budget). | clean. |
| `src/core/rpc-methods.ts` | 29 | `defineRpcMethods<M>()(...names)` — curried compile-time exhaustiveness check producing a runtime `ReadonlySet<string>`. | The keystone fail-closed type guard; `as readonly string[]` at the end. |
| `src/background/index.ts` | 3 | Barrel: client+service + `defineRpcMethods`. | — |
| `src/background/service.ts` | 99 | **Port `Service`** — `chrome.runtime.onConnect` fan-out; clients[]; `backup`/`restore` framework RPCs. | `as EventMessage<TEvents>` cast (dup of offscreen). |
| `src/background/client.ts` | 178 | **Port `ServiceClient`** — connect/reconnect loop, `ClientState`, typed-error hooks, `backup`/`restore`. | `makeRemoteError` dup; `"backup" as keyof TRequests` + `[] as unknown as Parameters<…>` casts. |
| `src/offscreen/index.ts` | 4 | Barrel: client+service+telemetry + `defineRpcMethods`. | — |
| `src/offscreen/messages.ts` | 15 | Offscreen envelope = base envelope `& {from; to?}` (intersection). | Routing fields bolted via `& MessageExt`, not unified. |
| `src/offscreen/service.ts` | 76 | **Offscreen `Service`** — `sendMessage` server, from/to routing, 20s keepalive `setInterval`. | `as EventMessage<TEvents>` cast (dup of background). |
| `src/offscreen/client.ts` | 153 | **Offscreen `ServiceClient`** — `sendMessage` caller, uid routing, `onReady` hook, telemetry sink, typed-error hooks. | `makeRemoteError` byte-dup of Port client; `errorPayload as …` + `detail as RequestTelemetry["detail"]` casts. |
| `src/offscreen/telemetry.ts` | 169 | **Telemetry sidecar** — `RequestTerminalStatus` union, `RequestTelemetry`, `sanitizeTelemetry` (allowlist), `TelemetrySink` + Noop/Logging/Memory sinks. | Best-typed module after messages.ts; clean unions. |
| `src/testing/setup.ts` | 18 | vitest `fakeBrowser.reset()`. | test infra. |
| `src/testing/transport-harness.ts` | 239 | Hand-rolled `chrome` stub w/ port/sendMessage brokers + spy loggers. | `{ log:()=>{} } as unknown as ILogger`; test infra. |

---

## 2. Public exports (what every service extends)

Per `package.json#exports` (subpath-scoped; consumer usage counts from `extension/`+`wallet-bridge/`+`aztec-runtime/`):

| Subpath | Exports | Consumer files |
|---|---|---|
| `./background` | `ServiceClient`, `Service`, `defineRpcMethods` | **43** — the dominant surface; every wallet service client/service extends these. |
| `./errors` | `WalletError` + 9 subclasses, `WalletErrorPayload`, `walletErrorFromPayload` | **31** |
| `./zod` | `validateParams`, `validateResult` | 5 |
| `./offscreen` | `ServiceClient`, `Service`, telemetry, `defineRpcMethods` | 2 |
| `./messages` | `MessageType` + envelope types | 2 |
| `./utils` | `wrapParams`, `unwrapParams` | (internal-leaning) |
| `.` | doc-only `export {}` | — |

**Error hierarchy** (errors.ts): `WalletError(code,message,details?)` → `RpcTimeoutError`, `RpcDisconnectedError`,
`UserRejectedError`, `JobCancelledError`, `CapabilityNotGrantedError`, `TooManyPendingError`, `ValidationError`,
`InvalidPasswordError`, `ProfileIdConflictError`. Each repeats `Object.setPrototypeOf` + `this.name` (so
`instanceof` survives the JSON boundary). `walletErrorFromPayload` is a `switch(payload.code)` registry — adding a
subclass requires touching 3 sites (class, `CODE`, switch case) with no compile-time exhaustiveness link.

**Consumer extension pattern** (`contact/client.ts`, `token/client.ts`, …): every client is
`class XServiceClient extends ServiceClient<Methods,Events> implements ServiceSpec<Methods,Events>` whose
methods are pure passthroughs `foo(...a): Promise<T> { return this.request("foo", ...a) }`. See §9 DEDUP-7.

---

## 3. Trust boundary (SW ↔ popup ↔ offscreen wire)

Two transports over a shared correlator core:

- **Port transport** (`background/`): popup ↔ service-worker over long-lived `chrome.runtime.Port`.
  Server fans events to every connected client; client auto-reconnects on disconnect and rejects
  in-flight with `RpcDisconnectedError`. Send is **synchronous** (preserved deliberately — see
  `ensureTransportReady` comment).
- **sendMessage transport** (`offscreen/`): SW ↔ offscreen-document over one-shot
  `chrome.runtime.sendMessage`. Adds `from`/`to` (uid) routing, a 20s keepalive interval, and a
  per-request telemetry terminal event.

**Hardening already in place** (these are the security-relevant invariants a quality audit must not regress):
- **RPC-surface guard** (`base-service.ts:90-97`): only names in the per-service `rpcMethods` Set (built by
  `defineRpcMethods`) **or** `frameworkRpcMethods` (`backup`/`restore`) are callable. `requestId` must be a
  positive safe integer. Prototype/inherited/helper methods are NOT reachable (D10).
- **Event-dispatch guard** (`base-client.ts:204-211`): inbound event name must resolve to a real
  `EventHandler` instance AND not be a `reservedEventNames` lifecycle handler — blocks
  forged `onConnected`/`onDisconnected` reconnect-hijack.
- **`unwrapParams` DoS bound** (`utils.ts`): contiguous-prefix read capped at 256 (was `max(keys)` → 10^9 loop).
- **3-tier send fallback** (`base-service.ts:140-164`): structured-clone → `jsonStringify`+`resultIsJson`
  → error response → log-and-drop. Mirrored by `decodeResult` client-side.
- **Telemetry sanitization** (`telemetry.ts`): `detail` restricted to a static `ALLOWED_DETAILS` allowlist;
  no error.message/params/addresses leak to sinks.

**Untyped-at-boundary reality:** every inbound message arrives as the typed envelope but is treated as
`unknown`-ish at runtime — `RequestContentLike`/`ResponseContentLike` (loose shadows) + `String(method)` +
`this as unknown as Record<…>` invoke. The generic `Parameters<T[M]>`/`ReturnType<T[M]>` types are **compile-time
fiction once on the wire**; runtime safety is the Sets + integer/shape guards, NOT the types. This is correct
defense-in-depth but means the wire types provide *consumer ergonomics*, not *boundary enforcement* — worth stating
plainly in the report.

---

## 4. Internal deps

- **Only runtime dep: `@nulo/wallet-core`** (`workspace:*`). Imports: `ILogger`/`LogLevel` (`/logger`);
  `getErrorMessage`/`jsonSanitize`/`jsonStringify`/`sleep`/`EventHandler`/`getRandomHex`/`array_max` (`/utils`);
  **`EventsMap`/`MethodsMap`/`EventsSpec`/`MethodsSpec`/`ServiceSpec`/`IService`/`ServiceCollection`** (`/base`).
- **Foundational typing root is EXTERNAL** but load-bearing: `wallet-core/base/index.ts:11`
  `MethodsMap = Record<string, (...params: any[]) => unknown>` (carries a `biome-ignore noExplicitAny`).
  Every generic in this package keys off this. The `any[]` is the *intended* escape hatch (lets concrete
  signatures satisfy the constraint), but it means the constraint itself enforces nothing about params.
- Intra-package: `core/*` is the shared base; `background/*` and `offscreen/*` are the two concrete forks;
  `messages.ts`+`errors.ts`+`utils.ts` are shared leaves; `offscreen/messages.ts` intersects `messages.ts`.
- No layering violation (sits at layer 3 of the 6-layer hierarchy; depends only downward on wallet-core).

---

## 5. Libs

- **zod `^4`** — optional peer (`peerDependenciesMeta.zod.optional`). Used ONLY in `zod-helpers.ts` as
  `ZodType<T>` → `.safeParse`. The **schemas themselves live in consumer `spec.ts` files**, not here, so this
  package has **no internal zod↔TS drift**; the drift risk is pushed to each consuming service (dual
  source-of-truth: hand-written `paramsSchema` parallel to the TS `Methods` tuple — out of THIS package's scope
  but flag the boundary). Dev: `@webext-core/fake-browser`, `chrome-types`, `jsdom`, `vitest ^4`, `typescript ^6`.
- No other runtime libs. `chrome.*` is the platform surface (Port + sendMessage).

---

## 6. Test surfaces

8 colocated `*.test.ts`, ~2068 LOC, heavy on the boundary/hardening contract:

| File | LOC | Covers |
|---|---|---|
| `errors.test.ts` | 46 | `walletErrorFromPayload` round-trips (JobCancelled jobId, UserRejected, CapabilityNotGranted exact message). |
| `core/core.test.ts` | 85 | `decodeResult`, `buildErrorResponseContent`, `awaitInitialized`. |
| `core/hardening.test.ts` | 202 | Hostile inbound: forged events, replayed/settled responses, hostile params, framework-event drop, malformed `resultIsJson` fail-closed, sparse-params DoS bound. |
| `background/service.test.ts` | 340 | Envelope validation, success/error path, 3-tier send fallback, malformed-params clean error, event fan-out. |
| `background/client.test.ts` | 516 | Correlation, timeout (`DEFAULT_RPC_TIMEOUT_MS`), error deserialization, `resultIsJson`, A5 port-disconnect race, disconnect→reconnect cycles. |
| `offscreen/service.test.ts` | 309 | `onReady`, null-message ignore, per-request keepalive, `ensureInitialized`. |
| `offscreen/client.test.ts` | 524 | Telemetry terminal records, send-failure sync cleanup, timeout, per-method timeout override, late/out-of-order responses, sink sanitization, leak guards. |

Driven by `testing/transport-harness.ts` (custom `chrome` stub) where the default `fakeBrowser` can't make
`postMessage` throw / `sendMessage` reject. Coverage is strong on lifecycle/security; **thin on the typing
contract** (no type-level tests asserting `rpcMethods` exhaustiveness or schema↔signature alignment).

---

## 7. EXCLUDE paths

- `node_modules/`, `dist/` (none committed).
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md` — config/docs (README is stale; flag separately, do not "fix" as code).
- `src/testing/setup.ts`, `src/testing/transport-harness.ts` — **test infra, not shipped**. Exclude from
  shipped-code hotspots; the harness's `as unknown as ILogger` is acceptable test-double pragmatism (note only).
- `**/*.test.ts` — mapped as **test surface (§6)**, excluded from source typing/dedup hotspot scoring.

---

## 8. Proposed Phase-2 clusters (4 stably-named units)

1. **`extension-messaging/correlator-core`** — `core/base-client.ts`, `core/base-service.ts`, `core/decode.ts`,
   `core/initialization.ts`, `core/rpc-methods.ts` (+ `core/core.test.ts`, `core/hardening.test.ts`).
   *The transport-agnostic request/response engine + RPC-surface guard. The dedup heart and the densest
   `as unknown as` cluster.*
2. **`extension-messaging/transports`** — `background/{service,client,index}.ts`,
   `offscreen/{service,client,index,messages,telemetry}.ts` (+ their 4 tests).
   *The two concrete Port-vs-sendMessage forks + telemetry sidecar. Where residual cross-fork DEDUP
   (`makeRemoteError`, event-literal casts) and the offscreen `from/to` envelope live.*
3. **`extension-messaging/wire-protocol`** — `messages.ts`, `utils.ts`.
   *On-the-wire envelope discriminated unions + param (un)wrapping. The `wrapParams`/`unwrapParams` `as T`
   lie and the `Parameters<>`-is-fiction-on-the-wire story.*
4. **`extension-messaging/errors-and-validation`** — `errors.ts`, `core/error-response.ts`, `zod-helpers.ts`
   (+ `errors.test.ts`). *`WalletError` hierarchy + payload round-trip (`buildErrorResponseContent` ↔
   `walletErrorFromPayload`) + zod helpers. `details:unknown` re-casts; switch-registry exhaustiveness gap;
   schema↔signature decoupling.* (Note: `error-response.ts` physically lives in `core/` but belongs here by concern.)

`index.ts`/barrels carry no logic — fold into whichever cluster owns the re-export.

---

## 9. Typing + dedup hotspots (ranked)

### TYPING

- **TYPE-1 (root, external):** `MethodsMap = Record<string,(...params: any[]) => unknown>` (wallet-core/base:11).
  `any[]` params are the deliberate constraint escape hatch but mean the base type enforces nothing about args;
  all arg safety rests on `Parameters<T[M]>` at the *call* site, erased on the wire. Foundational — every generic
  here inherits it.
- **TYPE-2 (dispatch core):** `invoke` = `(this as unknown as Record<string,(...args:unknown[])=>unknown>)[method](...params)`
  (`base-service.ts:125`) + `params as unknown[]` (`:111`). The RPC invoke is fully untyped; safety = the
  `rpcMethods` Set + integer/shape guards, not types. By design, but the central trust point.
- **TYPE-3 (shadow-type drift):** `ResponseContentLike` (`base-client.ts:67`) and `RequestContentLike`
  (`base-service.ts:13`) are hand-maintained **loose duplicates** of the typed `ResponseContent`/`RequestContent`
  in `messages.ts`. `errorPayload` is `unknown` here vs `WalletErrorPayload` there → re-cast on every read
  (`content.errorPayload as Parameters<typeof walletErrorFromPayload>[0]`, both clients) and a silent drift risk
  if the wire type changes.
- **TYPE-4 (`details:unknown` obsession):** `WalletErrorPayload.details?: unknown` (`errors.ts:20`) forces each
  reconstruction to re-cast: `payload.details as {jobId?:string}` (`:229`), `as {capabilityType?:string}` (`:234`).
  No discriminated union mapping `code` → `details` shape; the error registry's exhaustiveness is a manual `switch`.
- **TYPE-5 (wire-type fiction):** `wrapParams` makes a `Record<number,unknown>`; `unwrapParams<T>` returns
  `unknown[] as T` (`utils.ts:28`); the request builds `jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>`
  (`base-client.ts:117`). The positional-tuple type is asserted, never checked.
- **TYPE-6 (event reach):** `this as unknown as EventsSpec<TEvents>` (`base-service.ts:130`) and
  `this as unknown as Record<PropertyKey,unknown>` (`base-client.ts:205`) — emit/dispatch index `this` by computed
  key; runtime `instanceof EventHandler` + reserved-name Set is the only guard.
- **TYPE-7 (framework-RPC casts):** `backup`/`restore` aren't in `Methods`, so the Port client casts
  `"backup" as keyof TRequests` + `[] as unknown as Parameters<…>` (`background/client.ts:165,169`). Framework
  methods bolted onto a generic that can't express them.
- **TYPE-8 (envelope-literal casts):** `{ type, content } as EventMessage<TEvents>` in **both** services
  (`background/service.ts:77`, `offscreen/service.ts:62`) — the mapped-union `EventContent` can't be inferred from
  a literal, forcing identical force-casts in two places (also a DEDUP).
- **TYPE-9 (offscreen envelope shape):** routing via intersection `BaseX<T> & {from; to?}` (`offscreen/messages.ts`)
  rather than a unified envelope — the discriminant is shared but `from/to` is a parallel structure layered on.
- **TYPE-10 (schema↔signature decoupling):** `validateParams<T>(schema: ZodType<T>, …): T` (`zod-helpers.ts`) ties
  the result to the *schema's* `T`, with **nothing linking it to the method's real param tuple** — a schema can
  validate the wrong shape vs the signature and nothing catches it. (Drift fully realized in consumer `spec.ts`.)
- **GOOD:** `messages.ts` discriminated unions on `MessageType`, `telemetry.ts` string-literal unions, and
  `defineRpcMethods` compile-time exhaustiveness (`rpc-methods.ts`) are the package's typing high points — cite as
  the pattern to extend, not fix.

### DEDUP

- **DEDUP-1 (clearest win):** `makeRemoteError` is **byte-identical** across `background/client.ts:134-141` and
  `offscreen/client.ts:113-117` (`errorPayload ? walletErrorFromPayload(... as ...) : new Error(content.error ?? "Unknown error")`).
  It's the client-side inverse of `buildErrorResponseContent` — should be a shared helper next to it in the
  errors-and-validation cluster. README still claims the offscreen client uses raw strings; it doesn't.
- **DEDUP-2:** `makeDisconnectError` identical in both clients (`new Error("Client disconnected")`).
- **DEDUP-3:** `makeTimeoutError`/`makeSendFailureError` near-identical (same `RpcTimeoutError`/`RpcDisconnectedError`
  construction; only the message string differs) → parameterizable.
- **DEDUP-4:** the `as EventMessage<TEvents>` event-literal construction (TYPE-8) duplicated across both `Service`s.
- **DEDUP-5:** inbound-message validation guard (`message?.type !== MessageType.X || !message.content`) repeated
  ~4× across both services + both clients (transport-specific `from/to` deltas only).
- **DEDUP-6:** the `logDebug/logInfo/logWarn/logError` 4-method quartet is duplicated verbatim in `BaseService`
  and `BaseServiceClient` (differ only by `this.name` vs `this.clientName`) — extractable mixin/helper.
- **DEDUP-7 (largest LOC, consumer-side):** ~20 `ServiceClient` subclasses in `extension/` are near-pure
  boilerplate — each method `foo(...a): Promise<T> { return this.request("foo", ...a) }` mechanically restates the
  `Methods` type the class already `implements ServiceSpec<Methods,Events>`. A typed proxy/generated-client factory
  on the base would erase hundreds of lines. Lives outside this package but is *caused* by the base API shape —
  call it out as the headline dedup opportunity of the RPC layer.

### Cross-cutting note
README file-map + "offscreen rejects raw strings" are **stale**; treat as a docs-fix, not code. The whole boundary's
runtime safety rests on Sets + integer/shape guards + `instanceof` — solid — while the generic types are ergonomic
fiction at the wire. The audit's main typing lever is collapsing the `…ContentLike` shadow types onto the real
`messages.ts` types (kills TYPE-3 + several casts) and giving `WalletErrorPayload.details` a code-keyed discriminated
union (kills TYPE-4). Main dedup lever is a shared client error-shaping module (DEDUP-1/2/3) + a generated/proxy
client (DEDUP-7).
