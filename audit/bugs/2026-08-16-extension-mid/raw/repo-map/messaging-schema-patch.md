# Package Map: extension-messaging & wallet-sdk-schema-patch

Repo root: `~/Projects/nulo` (Bun monorepo). Both packages live under `packages/`.

---

## Package 1: `packages/extension-messaging` (`@nulo/extension-messaging`, v0.2.0, private)

### 1. Module inventory

| Path | Purpose | LOC |
|---|---|---|
| `src/index.ts` | Root barrel — deliberately empty (`export {}`); doc-comment directs consumers to subpath exports | 18 |
| `src/messages.ts` | Wire envelope types: `MessageType` enum (Event/Request/Response), `EventMessage`/`RequestMessage`/`ResponseMessage` generics | 57 |
| `src/errors.ts` | `WalletError` base class + subclass registry (`RpcTimeoutError`, `RpcDisconnectedError`, `UserRejectedError`, `JobCancelledError`, `CapabilityNotGrantedError`, `TooManyPendingError`, `ValidationError`, `InvalidPasswordError`, `AccountAddressInconsistencyError`, `RestoreTornError`, `ProfileIdConflictError`); `walletErrorFromPayload()` reconstruction switch; `isClientDisconnectRejection()` | 325 |
| `src/utils.ts` | `wrapParams`/`unwrapParams` — positional-args ↔ `{0,1,...,n}` wire encoding that survives `undefined` holes through `JSON.stringify` | 48 |
| `src/zod-helpers.ts` | `validateParams`/`validateResult` — thin Zod wrappers throwing `ValidationError` | 63 |
| `src/core/base-client.ts` | `BaseServiceClient<TRequests,TEvents>` — shared request correlator (pending map, timeout, settle, event dispatch) used by both transports | 327 |
| `src/core/base-service.ts` | `BaseService<TRequests,TEvents,TCtx>` — shared server-side dispatch (RPC allowlist guard, invoke, 3-tier send, init lifecycle) | 220 |
| `src/core/decode.ts` | `decodeResult()` — success-path JSON-fallback unwrap | 16 |
| `src/core/error-response.ts` | `buildErrorResponseContent()` — projects a thrown value into `{error, errorPayload?}` | 25 |
| `src/core/initialization.ts` | `awaitInitialized()` — polling wait-for-init helper (30s default budget) | 21 |
| `src/core/rpc-methods.ts` | `defineRpcMethods<M>()` — compile-time-exhaustive RPC-surface declarator | 29 |
| `src/core/sender-auth.ts` | `isTrustedInternalSender()` — same-extension sender predicate (F-09 security gate) | 23 |
| `src/core/service-client-factory.ts` | `definePassthroughs`/`definePassthroughsExhaustive` — installs mechanical forwarder methods on a client prototype | 67 |
| `src/background/client.ts` | `ServiceClient` — popup↔SW client over `chrome.runtime.Port` (connect/reconnect state machine) | 157 |
| `src/background/service.ts` | `Service` — popup↔SW server over `chrome.runtime.Port` (client-list fan-out) | 107 |
| `src/background/index.ts` | Re-exports client/service + `defineRpcMethods`/`definePassthroughs*` | 4 |
| `src/offscreen/client.ts` | `ServiceClient` — SW↔offscreen client over `chrome.runtime.sendMessage` (uid-based routing + telemetry) | 132 |
| `src/offscreen/service.ts` | `Service` — SW↔offscreen server (keepalive-ping-on-invoke) | 80 |
| `src/offscreen/messages.ts` | Offscreen-specific envelope extension (`from`/`to` fields added to base messages) | 15 |
| `src/offscreen/telemetry.ts` | `TelemetrySink` interface + `LoggingTelemetrySink`/`NoopTelemetrySink`/`MemoryTelemetrySink`, `sanitizeTelemetry()` | 168 |
| `src/offscreen/index.ts` | Re-exports client/service/telemetry + `defineRpcMethods` | 4 |
| `src/testing/setup.ts` | Vitest setup installing `@webext-core/fake-browser`, `beforeEach` reset | 17 |
| `src/testing/transport-harness.ts` | Hand-rolled `chrome.*` stub (Port + sendMessage brokers) used by contract tests | 244 |

Total non-test src: ~1857 LOC across 22 files (package total incl. tests: 4611 LOC).

### 2. Entrypoints / public exports

Declared in `package.json#exports` (six subpaths, no root barrel with real content):
- `.` → `src/index.ts` — intentionally empty; doc-only pointer to subpaths.
- `./background` → `Service`, `ServiceClient` (Port transport), `defineRpcMethods`, `definePassthroughs`/`definePassthroughsExhaustive`.
- `./offscreen` → `Service`, `ServiceClient` (sendMessage transport), telemetry types/sinks, `defineRpcMethods`.
- `./errors` → `WalletError` hierarchy, `walletErrorFromPayload`, `remoteErrorFromResponseContent`, `isClientDisconnectRejection`, `CLIENT_DISCONNECTED_MESSAGE`.
- `./messages` → `MessageType`, envelope type generics.
- `./utils` → `wrapParams`/`unwrapParams`.
- `./zod` → `validateParams`/`validateResult` (requires `zod` peer dep, marked optional).

**Intended consumers**: exclusively `apps/extension` (~65 files import it — every `apps/extension/src/wallet/services/*/client.ts` + `service.ts` pair, plus onboarding/popup composables) and two sibling packages that sit downstream in the stack per the README's stated position (`wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`): `packages/aztec-runtime/src/pxe/{client,service}.ts` and `packages/wallet-bridge/src/dispatcher.ts`. No consumers outside the extension's Chrome-runtime world (faucet/playground/landing don't use it).

### 3. Coupling surfaces

- **`src/core/base-client.ts` and `src/core/base-service.ts`** are the highest-fan-in modules — every transport (`background/*`, `offscreen/*`) extends one of these two abstract classes and depends on their protected hooks. They are the intentional coupling point (by design, to kill duplication between the two transport forks — see README/`base-client.ts` doc comment).
- **`src/errors.ts`** is imported by both `core/base-client.ts` (for `RpcTimeoutError`/`RpcDisconnectedError`/`remoteErrorFromResponseContent`) and `core/error-response.ts`/`core/service-client-factory.ts` — it's the shared vocabulary between client and service halves.
- **`src/background/index.ts` / `src/offscreen/index.ts`** are thin re-export grab-bags (not logic) that stitch `core/rpc-methods.ts` and `core/service-client-factory.ts` into each transport's public surface — mild "reaching into core from the outside" pattern, not a grab-bag of unrelated utilities.
- Each of `base-client.ts`/`base-service.ts` has 8 imports (highest in-package fan-out); transport subclasses each have 7 — none are true "utility grab-bags," the fan-out is inherent to gluing correlator+errors+messages+wallet-core primitives together.
- **Cross-package imports**: every non-trivial module imports from `@nulo/wallet-core` (`/base`, `/logger`, `/utils`) — `ILogger`, `LogLevel`, `EventHandler`, `jsonSanitize`, `jsonStringify`, `getErrorMessage`, `sleep`, `getRandomHex`, `EventsMap`/`MethodsMap`/`IService`/`ServiceCollection`/`EventsSpec` types. This is the package's single external dependency (declared in `package.json#dependencies`). No import goes the other direction (checked — `wallet-core/src/jobs/fsm.ts` only *mentions* `@nulo/extension-messaging/errors` in a comment, not an actual import), so no cycle.
- `zod` is a peer dependency used only by `src/zod-helpers.ts`.

### 4. State owners

| State | Module | Guard / lifecycle |
|---|---|---|
| `pending: Map<number, PendingEntry>` (resolver + reject + timers, one entry per in-flight request) | `core/base-client.ts` (`BaseServiceClient`) | Entries created in `request()`, cleared exclusively via the single `settle()` method — idempotent (`if (!entry) return`), so late/duplicate terminal events are safe no-ops. `pendingCount` getter, `rejectAllPending()` for teardown. |
| `nextRequestId: number` (monotonic counter) | `core/base-client.ts` | Incremented per-instance in `request()`; no wraparound guard (relies on `Number.isSafeInteger` range in practice). |
| `timeoutHandle` / `warnHandle` (`setTimeout` handles inside `PendingEntry`) | `core/base-client.ts` | Owned per pending entry; cleared inside `settle()`. |
| `clients: chrome.runtime.Port[]` (connected popup ports) | `background/service.ts` (`Service`) | Pushed in `onConnect`, spliced out in `onDisconnect` via `indexOf`; iterated (copy-free) in `sendEvent`/`onSendDropped` — a send failure to one client doesn't remove it from the array (only logs if still present). |
| `port?: chrome.runtime.Port` (current live port) | `background/client.ts` (`ServiceClient`) | Set in `connect()`, cleared in `disconnect()`; captured into a local `const port` before `postMessage` in `sendEnvelope` specifically to dodge a disconnect race (documented as "AUDIT A5"). |
| `state: ClientState` (Connecting/Connected/Disconnecting/Disconnected enum) | `background/client.ts` | Guards `connect()`/`disconnect()` re-entrancy; drives the `onDisconnect → disconnect() → connect()` auto-reconnect loop. |
| `connected: boolean` | `offscreen/client.ts` (`ServiceClient`) | Guards `connect()`/`disconnect()` idempotency for the `chrome.runtime.onMessage` listener subscription. |
| `uid: string` (per-instance random id, `getRandomHex(8)`) | `offscreen/client.ts` | Set once in constructor; used to route responses (`message.to === this.uid`) — effectively a session/identity token, immutable after construction. |
| `initialized: boolean` | `core/base-service.ts` (`BaseService`) | Set `false → true` once in `start()`; polled by `ensureInitialized()`/`awaitInitialized()`. |
| Keepalive `setInterval` handle | `offscreen/service.ts` (`beforeInvoke`) | Created per-invocation, returned as a cleanup closure, cleared in the caller's `finally` (`base-service.ts` `handleRequest`). Not a field — scoped to one request's lifetime. |
| `records: RequestTelemetry[]` | `offscreen/telemetry.ts` (`MemoryTelemetrySink`) | Test-only append-only array, no eviction — acceptable since it's not exported from the package's public index. |
| Module-level listener/mock maps (`portMessageListeners`, `portDisconnectListeners`, `sendPortMessageMocks`, `connectListeners`, `messageListeners`, `sendMessageMock`) | `src/testing/transport-harness.ts` | Test-harness-only singletons; cleared in a global `afterEach`. |

No module-level (file-scope) mutable singletons exist in non-test production code — all state is instance-scoped on `BaseServiceClient`/`BaseService`/subclasses, which is a deliberate design choice enabling multiple concurrent service instances.

### 5. Dependency graph (package-internal, one level deep)

```
index.ts                 → (none — export {})
messages.ts               → errors.ts (type-only, WalletErrorPayload) ; @nulo/wallet-core/base
errors.ts                  → (none internal) ; @nulo/wallet-core/utils
utils.ts                   → (none)
zod-helpers.ts              → errors.ts
core/decode.ts               → (none)
core/error-response.ts        → errors.ts ; @nulo/wallet-core/utils
core/initialization.ts         → @nulo/wallet-core/utils
core/rpc-methods.ts             → (none — types only)
core/sender-auth.ts              → (none — chrome types only)
core/service-client-factory.ts    → @nulo/wallet-core/base (types)
core/base-client.ts                → core/decode.ts, utils.ts, errors.ts, offscreen/telemetry.ts (type-only import
                                       of RequestTerminalStatus — core reaching INTO a transport subpackage)
core/base-service.ts                → core/error-response.ts, core/initialization.ts, core/base-client.ts (type-only),
                                       errors.ts, utils.ts
background/client.ts                  → core/base-client.ts, messages.ts
background/service.ts                  → core/base-service.ts, core/sender-auth.ts, core/base-client.ts (type-only), messages.ts
background/index.ts                     → background/client.ts, background/service.ts, core/rpc-methods.ts,
                                            core/service-client-factory.ts
offscreen/client.ts                      → core/base-client.ts, messages.ts, offscreen/messages.ts, offscreen/telemetry.ts
offscreen/service.ts                      → core/base-service.ts, core/sender-auth.ts, core/base-client.ts (type-only),
                                            messages.ts, offscreen/messages.ts
offscreen/messages.ts                      → messages.ts
offscreen/telemetry.ts                      → (none internal)
offscreen/index.ts                           → offscreen/client.ts, offscreen/service.ts, offscreen/telemetry.ts,
                                                core/rpc-methods.ts
```

**Cycle flag**: `core/base-client.ts` imports a type (`RequestTerminalStatus`) from `offscreen/telemetry.ts` — i.e., the transport-agnostic `core/` layer reaches into the `offscreen/` transport layer for one type. This is a layering inversion (core → offscreen) but not a true import cycle since `offscreen/telemetry.ts` imports nothing back from `core/`. Worth flagging to the downstream audit as an architectural wart even though it doesn't produce a circular resolution error.

No other cycles detected among internal modules.

### 6. Frameworks / primitives

- **Concurrency primitives**: no locks/mutexes in this package itself (locking, e.g. `ExecutionMutex`, lives in `apps/extension`, only referenced in `errors.ts` doc comments). Uses plain `Promise`, `setTimeout`/`clearTimeout` (per-request timeout + warn-after timers), `setInterval`/`clearInterval` (offscreen keepalive), and a hand-written async-poll loop (`awaitInitialized`, `sleep(500)` cadence) rather than a condition variable.
- **`chrome.*` APIs used**: `chrome.runtime.connect` / `chrome.runtime.Port` (`onMessage`, `onDisconnect`, `postMessage`, `disconnect`) in `background/*`; `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` in `offscreen/*`; `chrome.runtime.onConnect` in `background/service.ts`; `chrome.runtime.id` / `chrome.runtime.getURL` in `core/sender-auth.ts`.
- **Event emitters**: `@nulo/wallet-core`'s `EventHandler<T>` class (imported, not defined here) backs `onConnected`/`onDisconnected` on `background/client.ts`'s `ServiceClient`, and backs every declared wire-event handler that `handleEvent()` dispatches to via `instanceof EventHandler` check.
- **Validation**: `zod` (`ZodType`) as an optional peer dep, wrapped by `zod-helpers.ts`.
- **Test doubles**: `@webext-core/fake-browser` (via `testing/setup.ts`) and a hand-rolled `chrome` stub (`testing/transport-harness.ts`) using `vitest`'s `vi.fn`/`vi.stubGlobal`.

### 7. Test surfaces

- Tests are **colocated** (`*.test.ts` beside the module) — no separate `test/` or `__tests__/` directory.
- Coverage by module (roughly, `it`/`test` counts): `background/client.test.ts` 29 cases (557 LOC — largest suite, covers connect/reconnect/timeout/disconnect races), `offscreen/client.test.ts` 24 cases (558 LOC), `background/service.test.ts` 18, `offscreen/service.test.ts` 15, `errors.test.ts` 16, `core/core.test.ts` 11 (covers `decode.ts`+`error-response.ts`+`initialization.ts` together — these three tiny modules share one test file), `core/hardening.test.ts` 6 (12 `describe` blocks across both hostile-client and hostile-service scenarios, cross-cutting), `core/service-client-factory.test.ts` 6, `core/sender-auth.test.ts` 6, `utils.test.ts` 7.
- **Modules with no dedicated test file**: `src/messages.ts` (pure types, untested directly — implicitly exercised by every other suite), `src/zod-helpers.ts` (no `zod-helpers.test.ts` found — only referenced via doc comments; not directly unit-tested in this package), `src/core/rpc-methods.ts` (no direct test file, though its `defineRpcMethods` is exercised indirectly through `hardening.test.ts`'s fixture services), `src/offscreen/messages.ts` (pure type extension, untested), `src/background/index.ts` / `src/offscreen/index.ts` (barrels, untested — expected).
- README states explicitly: "Most coverage lives across the SW boundary and is exercised inside `@nulo/extension`'s test suite... the unit tests here focus on the message-schema contract and the error reconstruction path" — i.e., this package's own suite is deliberately narrower than the real integration surface, which lives in `apps/extension`.
- Test config: `vitest.config.ts` uses `jsdom` environment + `src/testing/setup.ts` as global setupFile.

### 8. Generated / vendored / fixture code

None found. No `dist/` checked in, no codegen directory, no vendored third-party source. `src/testing/transport-harness.ts` and `src/testing/setup.ts` are hand-written test infrastructure (not fixtures/generated) — exclude from audit findings about "production logic" but they are first-party maintained code, not vendored.

### 9. Apparent duplication

- **`background/client.ts` vs `offscreen/client.ts`** and **`background/service.ts` vs `offscreen/service.ts`** are structurally parallel by design — both pairs exist specifically because `core/base-client.ts`/`core/base-service.ts` were extracted to *de-duplicate* what used to be two independent forks (this is stated explicitly in the doc comments of both core files: "duplicated and subtly drift-prone across the two forks"). The remaining per-transport code (connect/Port lifecycle vs. sendMessage/uid routing, keepalive vs. no keepalive, telemetry vs. none) is genuinely different, not copy-paste residue — but a downstream audit should still visually diff `background/client.ts:45-97` (connect/disconnect/onMessage) against `offscreen/client.ts:44-84` (connect/disconnect/onMessage) since the shape (guard boolean/enum → subscribe listener → rejectAllPending → toggle flag) is near-identical even though the specifics differ.
- **`background/index.ts` vs `offscreen/index.ts`**: both are 4-line re-export barrels with the same pattern (`export * from "./client"`, `export * from "./service"`, plus a `core/` re-export) — trivial, not a real duplication risk.
- No byte-identical or near-identical function bodies were found within the non-test source; the intentional consolidation into `core/base-client.ts`/`core/base-service.ts` appears to have already resolved the main historical duplication (per README/doc comments referencing past dedup work, e.g. commit `7f9a92c8 refactor(messaging): dedup error identity ritual, transport error shaping, client guards`).

### 10. Error-path hotspots

- **`core/base-client.ts`** — the core request lifecycle: `try/catch` around `sendEnvelope()` distinguishing sync-throw vs. async-reject send failures (`request()`, lines ~149-159); `try/catch` around `decodeResult()` in `handleResponse()` to fail closed on malformed `resultIsJson` payloads rather than leaking the pending entry until timeout; the entire `settle()` idempotency contract exists purely to make disconnect/timeout/late-response races safe.
- **`core/base-service.ts`** — `sendResponse()` is a 3-tier cascading `try/catch` (structured-clone send → `jsonStringify` fallback → error-response send → `onSendDropped` drop), each tier catching the previous tier's failure; `handleRequest()` wraps `invoke()` in `try/catch/finally` (finally clears the keepalive interval regardless of outcome).
- **`background/client.ts`** — `connect()` has a `while (Connecting)` retry loop with `try/catch` + `sleep(1000)` on connect failure; `onDisconnect = () => { disconnect(); connect() }` is the auto-reconnect path; `sendEnvelope()` captures `port` into a local to avoid a disconnect-race null-deref (documented "AUDIT A5" fix for `RpcDisconnectedError`).
- **`background/service.ts`** — `sendEvent()` wraps each client's `postMessage` in its own `try/catch` per iteration so one dead client doesn't break fan-out to the rest.
- **`offscreen/client.ts`** — `onTerminal()` wraps the telemetry sink call in `try/catch` with an explicit "Sink errors must NEVER affect the request lifecycle" comment.
- **`offscreen/service.ts`** — `sendEvent()`/`beforeInvoke()`'s keepalive both use `.catch(() => {})` to swallow SW-teardown races silently.
- **`errors.ts`** — not try/catch-heavy itself, but it's the taxonomy that every above catch block converts into (`RpcTimeoutError`, `RpcDisconnectedError`, `CLIENT_DISCONNECTED_MESSAGE`/`isClientDisconnectRejection` exists specifically to let callers distinguish "expected reconnect churn" from real errors).
- **`core/hardening.test.ts`** (test file, not production) is the concentrated adversarial-input suite — "hostile inbound messages" / "hostile requests" / "post-audit hardening" describe blocks — useful for the downstream audit to see what threat model is already covered vs. not.

---

## Package 2: `packages/wallet-sdk-schema-patch` (`@nulo/wallet-sdk-schema-patch`, v0.1.0, private)

### 1. Module inventory

| Path | Purpose | LOC |
|---|---|---|
| `src/apply.ts` | `applyNuloSchemaPatch(schema)` — pure function mutating a `WalletSchema`-shaped object in place, adding `registerToken`, `isTokenRegistered`, `grantPublicAuthwit` zod-function schema entries; signature-drift guard throws if upstream later ships conflicting entries | 112 |
| `src/register.ts` | Side-effect entry point: imports the real `WalletSchema` singleton from `@aztec/aztec.js/wallet` and calls `applyNuloSchemaPatch(WalletSchema)` at module-eval time | 14 |
| `src/apply.test.ts` | Unit tests for `apply.ts` against mock schema objects | 50 |

Whole package is 3 files, ~176 LOC total (excluding config). This is a tiny, single-purpose package.

### 2. Entrypoints / public exports

`package.json#exports` — two subpaths, deliberately **no root barrel**:
- `./apply` → `src/apply.ts` — exports `applyNuloSchemaPatch(schema: object): void`. Pure/testable helper.
- `./register` → `src/register.ts` — side-effect-only module; must be the **first import** in an app's entry module (documented invariant: static imports evaluate before the importing module's body, so importing `./register` first guarantees the patch lands before any `@aztec/wallet-sdk` code constructs a wallet proxy).

**Intended consumers** (confirmed by grep): `apps/extension/src/wallet/services/wallet-sdk/background.ts`, `apps/faucet/src/composables/createAztecWalletSession.ts`, `apps/faucet/src/composables/useFaucetAddToken.ts`, `apps/playground/src/lib/wallet.ts`, `apps/playground/src/sections/contracts.ts` — i.e. the three dApp-facing/extension apps that need the Nulo-custom `WalletSchema` methods. Also imported by `packages/wallet-bridge/src/dispatcher.test.ts` and `packages/wallet-bridge/src/method-descriptors.test.ts` to verify the patched methods actually route through the dispatcher (reachability tests), and by `apps/extension/tests/e2e/network/register-token.test.ts` for e2e coverage. Deliberately **not** re-exported by `wallet-bridge` — the README explains this is to avoid leaking wallet-bridge's dispatcher/protocol internals to the dApp-facing apps (faucet/playground) that only need the schema patch.

### 3. Coupling surfaces

- No internal fan-out — `register.ts` imports only `apply.ts` (1 import). `apply.ts` imports only `@aztec/stdlib/schemas` and `zod` (2 imports, both external).
- **Cross-package imports**: none to other `@nulo/*` workspace packages — this package's only dependencies are external (`@aztec/aztec.js`, `@aztec/stdlib`, `zod`), making it a leaf node with zero intra-monorepo coupling on the dependency-consuming side. It is consumed by `apps/extension`, `apps/faucet`, `apps/playground`, and `packages/wallet-bridge` (test-only), but consumes nothing from any of them.
- No grab-bag utility modules — the package is intentionally minimal (its whole reason for existing, per the README, is to be the *single* source of truth replacing three byte-identical inline copies that used to live separately in each app).

### 4. State owners

- **No package-owned mutable state.** `apply.ts`'s `applyNuloSchemaPatch()` mutates the *caller-supplied* `schema` object in place (documented as intentional — "Mutate `schema`... in place"); the three `*_SCHEMA` constants (`PATCHED_SCHEMA`, `REGISTERED_QUERY_SCHEMA`, `GRANT_AUTHWIT_SCHEMA`, module-level `const`) are immutable zod schema objects built once at module load, used only for identity comparison (`existing !== PATCHED_SCHEMA`) and as the values installed onto the target.
- `register.ts` has one load-time side effect (mutating the imported `WalletSchema` singleton from `@aztec/aztec.js/wallet`) but owns no local state itself — the mutated singleton lives in the upstream `@aztec/aztec.js` package, outside this package's boundary.
- No caches, locks, timers, subscriptions, or in-flight-request tracking anywhere in this package — consistent with its stated scope as a one-shot schema-mutation utility.

### 5. Dependency graph (package-internal)

```
apply.ts     → (external only: @aztec/stdlib/schemas, zod)
register.ts   → apply.ts ; @aztec/aztec.js/wallet (external)
apply.test.ts  → apply.ts ; @aztec/stdlib/schemas, zod, vitest (external)
```

No cycles possible — strictly linear `register.ts → apply.ts`.

### 6. Frameworks / primitives

- No concurrency primitives, no `chrome.*` APIs, no event emitters — this package does none of that. It is pure synchronous object mutation plus `zod` v4's `z.function({ input, output })` schema builder (using the newer `.def.input`/`.def.output` shape rather than the older `.parameters()`/`.returnType()` API — called out explicitly in the doc comment as a v4-specific detail worth knowing for anyone auditing zod-version assumptions).
- Uses reference-identity checks (`existing !== PATCHED_SCHEMA`) and structural introspection (`existing?.def?.input?.def?.items`) rather than deep equality — the signature-drift guard is doing manual shape-matching against zod's internal `.def` representation, which is a coupling risk to zod's internal schema representation (not just its public API) that the downstream audit should note.

### 7. Test surfaces

- `src/apply.test.ts` — 5 test cases in one `describe("applyNuloSchemaPatch", ...)` block: (1) adds all three methods with correct arity/output type when absent, (2)-(4) throws when each of the three methods already exists with a different signature, (5) leaves a shape-compatible existing entry untouched (idempotency). Per the README, this suite runs under the extension's vitest config via include globs (not the package's own isolated `test` script necessarily — worth confirming at execution time).
- **`register.ts` has no dedicated unit test in this package** — its side-effect activation is instead exercised end-to-end by `packages/wallet-bridge/src/dispatcher.test.ts` (imports `@nulo/wallet-sdk-schema-patch/register` at three call sites, per grep, under a "schema-patch reachability + routing" comment block) and `packages/wallet-bridge/src/method-descriptors.test.ts`, plus the extension's e2e suite (`apps/extension/tests/e2e/network/register-token.test.ts`). This is a deliberate design per the README ("The end-to-end reachability... is pinned in `packages/wallet-bridge/src/dispatcher.test.ts`") — the downstream audit should treat `register.ts`'s test coverage as living outside this package's own file tree.

### 8. Generated / vendored / fixture code

None. No `dist/`, no codegen, no vendored code. Entirely first-party, 3 files.

### 9. Apparent duplication

- **Internal to this package**: none — it's 112 LOC of one function. However, the *reason the package exists* is to eliminate duplication that used to live elsewhere: the README states it "replaced three byte-identical inline copies" that were previously duplicated across the extension, faucet, and playground apps. That historical duplication is now gone from the packages under review, but the downstream audit may want to verify no fourth copy has crept back into any of the four consumer apps (a targeted grep for inline `registerToken`/`isTokenRegistered`/`grantPublicAuthwit` schema literals outside this package would confirm).
- The three method-patch blocks *within* `apply.ts` (`registerToken`, `isTokenRegistered`, `grantPublicAuthwit` — lines 55-111) are structurally repetitive (same `if (name in schema) { ...drift-check... } else { target[name] = SCHEMA }` shape three times) but each guard checks a different arity/type signature, so this reads as parallel-not-copy-paste rather than true duplication; still, a downstream quality pass could reasonably suggest collapsing the three blocks into a small loop over a `{name, schema, validate}` table.

### 10. Error-path hotspots

- `apply.ts`'s entire logic *is* an error path: each of the three method blocks throws a descriptive `Error` (with the exact expected-signature English text baked in) if an existing upstream entry's `.def.input.def.items`/`.def.output.def.type` shape doesn't match what Nulo expects — this "signature-drift guard" is the package's core safety mechanism (fail loud rather than silently no-op or silently overwrite upstream's own future implementation of the same method name). No try/catch, no retry, no timeout, no disconnect/reconnect logic exists anywhere — the package is synchronous and side-effect-scoped, so this is its only error-handling shape, but it is a load-bearing one: a downstream audit should verify the drift-checks stay in sync with `@aztec/wallet-sdk`'s pinned version (`5.0.0` per `apply.ts` comment vs. `5.0.1` per `package.json` dependency — worth flagging as a version-string vs. dependency-pin mismatch to verify, since the doc comment says "Pinned upstream version: `@aztec/wallet-sdk == 5.0.0`" while `package.json` pins `@aztec/aztec.js`/`@aztec/stdlib` at `5.0.1`).