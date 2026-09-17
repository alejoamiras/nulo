# Recon — port-client-connect

Read at `771c2a16` (dev after #613). One batched reuse sweep (read-only), findings verified by the planner
where they drive a design decision.

## Reuse map

| Capability | Found | Verdict |
|---|---|---|
| Client connect state machine | `packages/extension-messaging/src/background/client.ts:45-64` `connect()` — `while (Connecting) { try chrome.runtime.connect … catch { logError; await sleep(1000) } }`; `waitForConnection()` L112-120 polls state every 300 ms; `ensureTransportReady()` L100-110; `onDisconnect` L80-83 = `disconnect(); connect()`. `ClientState` L151-156: Connecting / Connected / Disconnecting / Disconnected. `sleep` from `@nulo/wallet-core/utils`. | **adapt** — delete the loop and the poll; `Connecting` exists only because of the loop (`chrome.runtime.connect` is synchronous). |
| Request-side readiness | `src/core/base-client.ts:102-187` `request()` computes the deadline, calls `ensureTransportReady()` and only THEN registers the pending entry + timers; `awaitReadyWithinDeadline` L283-299 races a readiness promise against the deadline. `rejectAllPending` L245-249. | **reuse-as-is** — a synchronous throw from `ensureTransportReady` rejects the `request()` promise with no timer or pending-map leak. No base change needed. |
| Typed error vocabulary | `src/errors.ts` (19 `WalletError` subclasses, static `CODE`, `walletErrorFromPayload` switch L440-488); `RpcDisconnectedError` (`RPC_DISCONNECTED`) is the send-time port-gone error; `makeDisconnectError()` (`base-client.ts:342`) is deliberately a plain `Error` with `CLIENT_DISCONNECTED_MESSAGE` (string-shaped contract, `isClientDisconnectRejection`). `RequestTerminalStatus` (`core/terminal-status.ts`) = success / rejected / timeout / disconnected / send_failed. | **build new** — no connect-failure class or code exists. Searched: `ConnectError|CONNECT_FAILED|RpcConnectError|PortConnectError` (0 hits), `context invalidated` (1 comment hit, `core/base-client-readiness.test.ts:4`), `runtime.lastError` (3 unrelated), `Failed to connect` (the log line itself + an `apps/tools` UI string). Add `RpcConnectError` (`RPC_CONNECT_FAILED`) following the sibling pattern. |
| Offscreen client | `src/offscreen/client.ts:46-51` `connect()` is synchronous, idempotent, no retry; send failures → `RpcDisconnectedError` once. | **N/A** — nothing mirrors the loop; untouched. |
| Tests pinning connect behaviour | `src/background/client.test.ts` (557 lines): every test `await client.connect()` on a never-throwing harness; `describe("port onDisconnect → reconnect")` L511-557 pins the SW-restart path (must stay green). `core/base-client-readiness.test.ts` pins B-15 via a hand-rolled `NeverReadyClient` (transport-agnostic, stays valid). No test asserts the 1 s retry or the 300 ms poll (grep `sleep(300)|sleep(1000)|waitForConnection` in the five files: 0; the only `1000` is a timer-drain window at `client.test.ts:494`). | **reuse-as-is** + add the terminal-failure tests the loop made unreachable. |
| Port fake #1 — extension global stub | `apps/extension/tests/vitest.setup.ts` (the ONLY `setupFiles` entry, `apps/extension/vitest.config.ts`): one `Port` per name, **throws on a second same-name `connect`** (L62-64), `disconnect: vi.fn()` no-op (never clears the map), `onDisconnect.addListener: vi.fn()` no-op → **cannot emit a disconnect at all**; single shared `sendMessage` mock. Exports `emitPortMessage`/`capturePortMessage`/`emitMessage`/`captureMessage`. Consumers: `apps/extension/src/wallet/services/{network,task,profile}/client.test.ts` via the relative path `../../../../tests/vitest.setup` (2 / 2 / 5 `capturePortMessage`, 1 / 3 / 3 `emitPortMessage`). No consumer opens two clients of one service in a test. | **adapt** — keep the export names, back them with the shared registry, add `emitPortDisconnect`. |
| Port fake #2 — package harness | `packages/extension-messaging/src/testing/transport-harness.ts` (224 lines): import-to-install (`beforeEach`/`afterEach` stub `chrome`); client side one port per name with the same throw guard but `disconnect()` DOES clear state (reconnect works); real `onDisconnect` tracking + `emitPortDisconnect(service)`; **server side** `chrome.runtime.onConnect` + `connectServiceClient(service)` (17 uses in `service.test.ts`, 5 in `hardening.test.ts`); offscreen-direction `emitMessage`/`captureMessage`; `silentLogger`, `makeSpyLogger`. Consumers: `background/client.test.ts` (5 / 19 / 2 capture / emit / disconnect), `core/hardening.test.ts`. | **adapt** — client direction backed by the shared registry; server side, sendMessage broker and logger helpers stay. |
| Port fake #3 — the promotion source | `apps/extension/src/wallet/services/logger/client.ports.test.ts:29-118` `FakePort` (closed flag, `postMessage` throws once closed, per-instance listener sets) + `PortRegistry` (`live: Map<name, Set<FakePort>>` — N ports per name; `opened` history; `localDisconnects` counter; envelope validation; microtask auto-answer with `hold`; `remoteClose(port)` fires only the far end's `onDisconnect`). Its header states the gap that forced it: "the global port double cannot count (it refuses a second same-name port)". | **adapt → promote** into `packages/extension-messaging/src/testing/port-registry.ts`; the test then imports it. |
| Port fake #4 — a different layer | `packages/wallet-core/src/testing/fake-browser-api.ts:88-199` `PortRegistry`/`linkedPortPair` fake wallet-core's injected `RuntimePort` abstraction (`FakeBrowserApi`, ~45 importers). Same name, different abstraction (injected `BrowserApi.runtime`, not the `chrome` global). | **out of scope** — explicit non-goal; do not merge across the layer. |
| `/testing` subpath precedent | `@nulo/wallet-core/testing` (`exports["./testing"] = "./src/testing/index.ts"`, ~48 importers under `apps/extension`), `@nulo/design/testing`. `@nulo/extension-messaging/package.json` `exports` has `.`, `./background`, `./offscreen`, `./errors`, `./messages`, `./utils`, `./zod` — **no `./testing`**. `apps/extension` already depends on `@nulo/extension-messaging` (`workspace:*`); `apps/extension/vitest.config.ts` inlines `@nulo/*` (`server.deps.inline`). | **adapt** — add the `./testing` export; no app-side package change. |
| Biome constraints | `biome.json` L81-90 exempts `**/*.test.ts`, `**/tests/**`, `**/vitest.setup.ts`, `**/test-utils/**` from the 80-line cap; `src/testing/` is NOT exempt (80 lines / cognitive 15 apply). No `noRestrictedImports` rule blocks `apps/extension` → `@nulo/extension-messaging/testing`. | constraint noted. |
| Docs | `packages/extension-messaging/README.md`: file map has no `transport-harness.ts` row; key invariant "in-flight requests reject with `PortDisconnectedError`" names a class that does not exist (it is `RpcDisconnectedError`) and describes reconnect as unconditionally silent. `ARCHITECTURE.md`: structural mentions only. `apps/extension/tests/COMPOSITION-TESTS.md`: no reference to the chrome port stub. | **adapt** README; ARCHITECTURE unchanged. |

## Facts the planner re-verified

- `apps/extension/src` has 28 explicit `.connect()` calls outside tests; 8 are `await`ed, the rest are bare
  floating calls (`git grep '\.connect()'` / `'await .*\.connect()'`). A `connect()` that rejects would turn
  every bare call into an unhandled rejection in the one case it fails.
- `request()` (`base-client.ts:122-123`) calls `ensureTransportReady()` before creating the pending entry, so
  a synchronous throw there leaves no timer and no `pending` row behind, and `onTerminal` is not invoked
  (the same is already true for the readiness-deadline timeout).

## Collision / dedup risks

1. `apps/extension/vitest.config.ts` re-runs `packages/extension-messaging/src/**/*.test.ts` under the
   extension's global `setupFiles`; the harness's import-installed `beforeEach` registers second and its
   `vi.stubGlobal("chrome", …)` wins. The promoted design must keep the harness stub a superset of the
   global one.
2. The throw-on-second-port guard is a leak detector both installers rely on implicitly. The registry
   replaces it with an explicit, opt-in count (`registry.live(name)`), not a hard throw.
3. Disconnect semantics differ: the two installers fire disconnect per service name at a module map;
   the registry fires per `FakePort` instance. `emitPortDisconnect(service)` becomes "remote-close every
   live port of that name" — same observable effect for the two existing uses.
4. Two same-named `capturePortMessage`/`emitPortMessage` pairs already exist. Sequence the migration so
   every commit has one behavioural source: registry + export → harness → extension setup → ports test.
5. The wallet-core `PortRegistry` is a homonym at another layer; not part of this consolidation.
