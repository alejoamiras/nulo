# port-client-connect — a synchronous connect failure is terminal, and one port fake for every test

---
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: default (recon 1 agent; codex at high)
status: IMPLEMENTED 2026-09-17 — phases 1–4 green, codex post-impl loop converged in two rounds; PR into dev open, merge is the owner's call
baseline: 771c2a16 (dev, after #613)
worktree: .claude/worktrees/port-client-connect · branch worktree-port-client-connect
---

## Summary

`ServiceClient.connect()` (`packages/extension-messaging/src/background/client.ts:45-64`) wraps
`chrome.runtime.connect` in a `while (Connecting)` loop that catches any throw, logs an error and sleeps
1 s before trying again — forever. The loop rests on a false premise: in MV3 `chrome.runtime.connect`
never throws because the service worker is asleep (it returns a Port and wakes the worker; a dead peer
surfaces later as `onDisconnect`, which the client already handles by reconnecting). The synchronous
throws that are known are permanent — "Extension context invalidated" after an update or reload, or a bad
extension id — and Chrome documents no transient one (F3). So the loop rescues nothing anyone has
observed; on an invalidated page it spins forever, emitting
`logError("Failed to connect")` once a second, and `waitForConnection()` polls state every 300 ms while a
caller's request waits out its full timeout with no cause. In unit tests the same loop is what the
`vitest.setup.ts` throw-on-second-port guard trips into: a retry timer that ticks for the rest of the file
(#613 silenced it for the logger client with a mock; this plan removes it).

There is a second loop hiding behind the first (codex A1). `documentLogger().log()` returns its request
promise unhandled; the popup's and offscreen's `onunhandledrejection` handlers log the rejection through
that same logger. On an invalidated page every log line's request rejects — today after its 60 s request deadline
— and the handler logs the rejection, which rejects, which the handler logs. That cadence made it
invisible. Make the failure immediate without containing it and the cadence becomes one task per
iteration: a busy loop for the life of the page.

This plan (1) makes a synchronous connect throw **terminal**: the request that needed the port rejects at
once with a typed `RpcConnectError`, nothing retries, no timer exists; the `onDisconnect` reconnect path is
untouched; `connect()` keeps its never-rejects contract because 19 of the extension's 27 `connect()` calls
are floating. (2) Contains logger rejections at the `documentLogger` boundary — the returned promise is
observed so it never reaches the page's unhandled-rejection handler, while an explicit awaiter still sees
the rejection. (3) Deletes the `Connecting` state and the poll — both existed only to serve the loop
(`chrome.runtime.connect` is synchronous, so the port is either open or the call threw). (4) Promotes the
`FakePort`/`PortRegistry` written for `client.ports.test.ts` into `@nulo/extension-messaging/testing`
and puts the extension's global port stub, the package's transport harness, that test and the logger
redaction test's inline port on it, so the repo has one port fake with honest semantics (N ports per name,
per-port disconnect, a closed port throws on `postMessage`) instead of four, and the throw-on-second-port
guard becomes an opt-in count.

Out of scope: any user-visible change (owner: errors flow through existing paths); the offscreen client
(no loop there); the wallet-core `FakeBrowserApi` port registry (a different layer's abstraction, same
name); a `connect_failed` terminal status (see Trade-offs).

## Goals / non-goals

- G1: a synchronous `chrome.runtime.connect` throw rejects the triggering request with `RpcConnectError`
  within the same tick, leaves the client `Disconnected`, schedules no timer, and logs one line (with
  Chrome's reason) per failed open — on the request path as well as on an explicit `connect()`.
- G2: a service-worker restart (`port.onDisconnect`) still reconnects transparently and in-flight
  requests still reject with the string-shaped `"Client disconnected"` error (existing tests pin it).
- G3: `connect()` never rejects; the request is where the typed error surfaces.
- G4: exactly one `chrome.runtime.connect` port fake in the repo, exported as
  `@nulo/extension-messaging/testing`, consumed by the extension setup file, the package harness, the
  logger ports test and the logger redaction test; helper names `capturePortMessage` / `emitPortMessage`
  / `emitPortDisconnect` keep working for the five files that import them.
- G5: a rejected logger line never reaches a page's `onunhandledrejection` handler (which would log it
  through the same logger); a caller that awaits the line still observes the rejection.
- N1: no change to `BaseServiceClient.request()` — a sync throw from `ensureTransportReady()` already
  rejects cleanly before any pending state exists (`core/base-client.ts:122-123`).
- N2: no UI change, no new event on the client (`onConnected`/`onDisconnected` unchanged).
- N3: the server-side (`onConnect`, `connectServiceClient`), the offscreen `sendMessage` broker and the
  logger helpers of `transport-harness.ts` stay where they are.

## Architecture & Implementation

### Client (`packages/extension-messaging/src/background/client.ts`)

```ts
enum ClientState { Connected, Disconnecting, Disconnected }   // Connecting removed

/** Never rejects: a failed open is already logged by `openPort` and is reported by the request that
 *  needed the port. Kept non-rejecting because most callers do not await it. */
public async connect(): Promise<void> {
	try { this.openPort() } catch { /* logged at the open */ }
}

/** Opens the port synchronously or throws `RpcConnectError`. A synchronous throw from
 *  `chrome.runtime.connect` is treated as permanent (the extension context is gone); an asleep worker
 *  never throws — it is woken, and a missing peer surfaces later as `onDisconnect`. Nothing retries. */
private openPort(): void {
	if (this.state !== ClientState.Disconnected) return
	let port: chrome.runtime.Port
	try {
		port = chrome.runtime.connect(undefined, { name: this.service })
	} catch (cause) {
		const error = new RpcConnectError(this.service, cause)
		this.logError("Failed to connect", error)
		throw error
	}
	this.port = port
	port.onDisconnect.addListener(this.onDisconnect)
	port.onMessage.addListener(this.onMessage)
	this.state = ClientState.Connected
	this.logDebug("Connected")
	this.onConnected.invoke()
}

protected ensureTransportReady(): void {   // was `void | Promise<void>`
	this.openPort()                          // no-op unless Disconnected; throws when the open fails
}

private readonly onDisconnect = () => { this.disconnect(); void this.connect() }
```

- `waitForConnection`, `sleep` import and the `Connecting` state are deleted. `ensureTransportReady`
  narrows to `void`; the base's contract (`void | Promise<void>`) is unchanged for the offscreen client.
- `disconnect()` is unchanged. `Disconnecting` stays as the transient guard it is today. A request issued
  while `Disconnecting` (re-entrant only, e.g. a synchronous `onTerminal` override during settlement) now
  sends against a cleared port and settles `send_failed` instead of awaiting the poll; no production
  caller does this (codex B4).
- The log line is emitted at the open, so a failure on the request path (`ensureTransportReady`) is
  logged exactly like an explicit `connect()` — once per failed open, never twice (codex C1).
- A request on an invalidated page pays one `chrome.runtime.connect` call + one log line — bounded by
  request rate, not by a timer.

### Error (`packages/extension-messaging/src/errors.ts`)

```ts
/** `chrome.runtime.connect` threw synchronously — the extension context is gone (update / reload) or the
 *  id is wrong. Treated as permanent for this document; nothing retries. Client-local, never crosses the
 *  wire. The cause's message is folded into this message because the log projection keeps only
 *  `name` + `message` of an error (`trim()` drops `details`). */
export class RpcConnectError extends WalletError {
	static readonly CODE = "RPC_CONNECT_FAILED"
	constructor(service: string, cause: unknown) {
		super(RpcConnectError.CODE, `Cannot open a port to ${service}: ${getErrorMessage(cause)}`, { service }, "RpcConnectError")
	}
}
```

Follows the sibling pattern (`RpcDisconnectedError`). Not added to `walletErrorFromPayload` — it is never
serialized from a service. Kept distinct from `RpcDisconnectedError`, whose callers already interpret it
as "worker went away, wait for liveness" (`useFullBackupRestore` waits on it — codex C1).

### Logger containment (`apps/extension/src/wallet/services/logger/client.ts`)

```ts
export function documentLogger(context?: DocumentLogContext): ILogger {
	return {
		log(source, level, ...data) {
			shared ??= new LoggerServiceClient()
			const line = shared.log(context, source, level, ...data)
			// Observed here so a failed line never reaches the page's unhandled-rejection handler, which
			// logs through this same logger — an immediate rejection would loop for the life of the page.
			// The original promise is returned, so an awaiting caller still sees the rejection.
			line.catch(() => {})
			return line
		},
	}
}
```

This reverses #613's D30 ("a rejected line still reaches the page's unhandled-rejection handler"): that
reach is the loop. The disconnect cascade on a worker restart, which the two handlers currently demote to
debug, no longer arrives at all — one fewer line per pending log request per restart.

### Shared port fake (`packages/extension-messaging/src/testing/port-registry.ts`, new)

The `FakePort` + `PortRegistry` from `client.ports.test.ts`, generalised in three places:

- `post()` no longer asserts `method === "log"`; it validates the envelope shape
  (`type === Request`, numeric `requestId`, string `method`) and records `{port, requestId, method, params}`.
- A per-name `vi.fn` postMessage mock (`registry.mock(name)`) so `capturePortMessage(name)` keeps returning
  a `Mock` whose `.mock.calls` the harness tests read (`lastRequestId()` in `client.test.ts`). Contract
  (codex C3): `FakePort.postMessage(message)` calls that mock **synchronously with the original envelope
  as its only argument** before anything else; if the mock throws (`mockImplementationOnce` — the AUDIT A5
  tests drive the send failure this way) the throw propagates and the envelope is neither recorded nor
  answered.
- Answering is a mode, not a default: `new PortRegistry({ answer: "microtask" | "manual" })`. `manual`
  never answers (the harness and the extension setup; tests deliver responses with `emitPortMessage`);
  `microtask` answers on the port that posted, with `hold` / `answerHeld()` as today (the logger tests).
- `deliver(name, message)` invokes every live port's `onMessage` listeners for that name. It is a
  broadcast: two live clients of one name whose request ids collide cannot be addressed separately —
  the same limitation the existing helpers have; a test that needs the distinction uses the port instance.
- `remoteClose(port)` (unchanged) closes one port and fires only its far-end `onDisconnect`.
  `closeAll(name)` remote-closes **a snapshot** of the ports live when the call began — a listener
  reconnects synchronously and inserts a replacement into the live set, which must not be visited
  (codex C2; the reconnect tests depend on it).
- `connectStub(registry)` returns the `chrome.runtime.connect` implementation
  (`(_, { name }) => registry.open(name)`).
- Exported from a new `src/testing/index.ts` that exports **only** `port-registry.ts` — never the
  hook-installing `transport-harness.ts`: importing that from the extension's setup file would register
  its `beforeEach` before the setup file's own and reverse the winning order (codex C3, F8). `package.json`
  gains `"./testing": "./src/testing/index.ts"`. `setup.ts` stays unexported (unchanged).

Under `src/testing/` the 80-line and cognitive-15 budgets apply; every method is under 20 lines.

### Consumers

- `transport-harness.ts`: the client-direction maps (`portMessageListeners`, `portDisconnectListeners`,
  `sendPortMessageMocks`, `mockClientPort`) are replaced by one `PortRegistry` created in its `beforeEach`;
  `emitPortMessage` / `emitPortDisconnect` / `capturePortMessage` become one-line delegates. Server side,
  the sendMessage broker and the logger helpers are untouched. The double-run under the extension's
  `setupFiles` keeps working: the harness stub is still a superset and still registers last.
- `apps/extension/tests/vitest.setup.ts`: `mockPort` and its three maps go; `beforeEach` builds a
  registry and stubs `chrome.runtime.connect` with `connectStub`; `emitPortMessage` / `capturePortMessage`
  delegate; `emitPortDisconnect` is added (the stub could not emit a disconnect at all). The silent
  `documentLogger` mock and the console shim stay.
- `client.ports.test.ts`: deletes its local classes, imports the shared ones, keeps S1–S4 and its
  `expectOneLoggerPort` helper (the opt-in count that replaces the old throw guard).
- `logger/client.test.ts` (the redaction tests): its inline `captureWire` port (a fourth fake, codex B2)
  becomes a `microtask` registry; `sent` is read from `registry.posted` (method + unwrapped params).
- The three extension client tests (`network`/`task`/`profile`) change nothing — same helper names, same
  relative import. `service.test.ts` keeps `connectServiceClient` (server side, untouched): it sends
  malformed requests on purpose, which the registry's request-envelope validation must never intercept.

### Data & control flow (the critical path)

Request on a healthy page: `request()` → `ensureTransportReady()` → `openPort()` (no-op, Connected) →
sync `postMessage`. Unchanged timing — no microtask inserted (the base's synchronous-send invariant).

Request on an invalidated page: `request()` → `ensureTransportReady()` → `openPort()` logs once and
throws `RpcConnectError` → `request()`'s promise rejects; no pending entry, no timer. `connect()` called
explicitly by a page: the same one log line, resolves. A log line on that page: `documentLogger.log` →
rejected request, observed by the containment `catch` → nothing reaches `onunhandledrejection`.

Worker restart: `port.onDisconnect` → `disconnect()` (rejects in-flight with `"Client disconnected"`,
fires `onDisconnected`) → `connect()` → `openPort()` → `Connected`, `onConnected`. Identical to today.

### File-level change map

| File | Change |
|---|---|
| `packages/extension-messaging/src/background/client.ts` | delete loop, poll, `Connecting`, `sleep` import; add `openPort`; `connect` never rejects |
| `packages/extension-messaging/src/errors.ts` | `RpcConnectError` |
| `packages/extension-messaging/src/background/client.test.ts` | new describe "connect failure is terminal" (3 tests); the reconnect describe gains a throwing-replacement case |
| `apps/extension/src/wallet/services/logger/client.ts` | containment `catch` on the returned line; the TSDoc that promises delivery to the unhandled-rejection handler is rewritten to the new contract |
| `apps/extension/src/wallet/logger/console-forwarding.containment.test.ts` (new) | the A1 regression: real logger, throwing connect, forwarding installed — the loop does not start |
| `packages/extension-messaging/src/testing/port-registry.ts` (new) + `port-registry.test.ts` (new) + `index.ts` (new) | the shared fake + 2 contract tests + barrel |
| `packages/extension-messaging/package.json` | `./testing` export |
| `packages/extension-messaging/src/testing/transport-harness.ts` | client direction on the registry |
| `apps/extension/tests/vitest.setup.ts` | port stub on the registry; `emitPortDisconnect` |
| `apps/extension/src/wallet/services/logger/client.ports.test.ts` | import the shared fake |
| `apps/extension/src/wallet/services/logger/client.test.ts` | `captureWire` on the shared fake |
| `packages/extension-messaging/README.md` | file-map rows for `transport-harness.ts` + `port-registry.ts`; rewrite the "Port reconnects are silent" invariant into the three distinct contracts: in-flight requests on a disconnect reject with the plain `Error("Client disconnected")`, a send on a torn-down port rejects `RpcDisconnectedError`, a failed open rejects `RpcConnectError` and nothing retries (codex B1) |
| `implementations-plan/index.md` | this plan's row; `owned-client-teardown` → merged (#613) |
| `implementations-plan/owned-client-teardown/plan.md` | status line → merged |

### Trade-offs & alternatives not taken

- **`connect()` rejects with the typed error** (honest, no swallowing). Rejected: 19 floating
  `x.connect()` calls in `apps/extension/src` would become unhandled rejections in exactly the case that
  fails; the request is where every caller already handles errors. Documented in the TSDoc.
- **A sticky `Failed` state** (fail once, reject every later request without touching Chrome). Rejected:
  a fourth state and a recovery question ("who resets it?") to save one synchronous call per request on a
  page that is already dead.
- **Bounded backoff** (3 attempts). Rejected: no transient case for a synchronous throw is known to
  recover from; a retry only delays the honest answer.
- **A `connect_failed` `RequestTerminalStatus`** with `onTerminal` reporting. Deferred: readiness-phase
  failures (this one and the existing deadline timeout) reject before a pending entry exists and are
  invisible to `onTerminal` today; making them visible is a coherent, separate change to the base
  correlator. The `logError` line is the observable signal for bug reports.
- **Keeping the throw-on-second-port guard** in the shared fake. Rejected: a fake that throws inside
  the code under test is the mechanism that produced this wart; `registry.live(name).size` is the same
  leak detector, asserted where the test means it.
- **Migrating only the extension consumers** and leaving `transport-harness.ts`. Rejected by the owner
  (Phase 0): one fake, every consumer.
- **Containing logger rejections by swallowing them** (return the caught promise). Rejected: an explicit
  awaiter (S3 in the ports test) must still observe the rejection;
  observing a branch (`line.catch(() => {})`) marks the original handled without changing what it
  returns.
- **Fixing the loop in the two `onunhandledrejection` handlers** (skip logging when the reason is an
  `RpcConnectError`). Rejected: the loop is a property of the logger's returned promise, and a third
  handler (a future window) would re-introduce it; contain at the one source.

## Security & Adversarial Considerations

- Threat surface: none new on the wire. `RpcConnectError` is client-local and never serialized; its
  message folds in Chrome's own reason ("Extension context invalidated.") and reaches the log through
  `trim()`'s error projection (name + message, URL-scrubbed). No payload.
- Denial of usefulness, two loops: an invalidated popup today runs a 1 s error-log loop AND a 60 s
  logger-rejection loop (`documentLogger` → `onunhandledrejection` → `documentLogger`). Removing the
  first without containing the second would turn that cadence into a busy loop (codex A1). Both are
  closed here: no timer, and no rejection reaches the handler.
- Sender authentication, envelope validation and the request deadline (B-15) are untouched; the only
  code path added is one that fails faster.
- Test code stays out of production: `@nulo/extension-messaging/testing` is imported only by
  `*.test.ts` and `tests/vitest.setup.ts`; the extension bundle's test-fixture leakage grep in
  `_build-extension.yml` and the biome layer rules are not affected (no `noRestrictedImports` rule covers
  this subpath — see recon).
- Supply chain: no new dependency. `bun.lock` unchanged.

## Assumptions

### Facts (verified)

- F1: `connect()` loops on a caught throw with `sleep(1000)` and `waitForConnection()` polls every 300 ms
  (`packages/extension-messaging/src/background/client.ts:45-64`, `:112-120`).
- F2: `request()` calls `ensureTransportReady()` before it registers the pending entry and the timeout /
  warn timers (`src/core/base-client.ts:122-123` vs `:133-152`), so a synchronous throw there rejects the
  request with nothing left behind.
- F3: `chrome.runtime.connect` returns a Port synchronously; an asleep worker is woken, and a missing
  peer surfaces asynchronously as `onDisconnect` with `lastError` (Chrome's `runtime.connect` reference;
  the premise of the existing `port onDisconnect → reconnect` tests). Chrome documents no exhaustive
  taxonomy of synchronous throws; the ones known are permanent (context invalidated, bad id). **Fail-fast
  is therefore the chosen policy, not a browser guarantee** (codex A2): the request is terminal, the
  client is not — a later open may succeed and is tested.
- F3b: `documentLogger().log` returns the request promise unhandled
  (`apps/extension/src/wallet/services/logger/client.ts:49`); both `onunhandledrejection` handlers log
  the reason through `documentLogger` (`wallet/logger/console-forwarding.ts:17-21`,
  `offscreen/index.ts:50-68` — its `try/catch` cannot catch a rejected promise).
- F4: no test pins the retry or the poll (grep in the five messaging test files: 0 hits for
  `sleep(300)|sleep(1000)|waitForConnection`); the reconnect block at `client.test.ts:511-557` must stay
  green.
- F5: `apps/extension/src` has 27 explicit `.connect()` calls outside tests, 8 awaited, 19 floating
  (`git grep`), none wrapped in `.catch`.
- F6: `apps/extension/tests/vitest.setup.ts` is the extension's only `setupFiles` entry; it throws on a
  second same-name port (`:62-64`), never clears a port on `disconnect` and cannot emit a disconnect
  (`onDisconnect.addListener: vi.fn()`). Its helpers are imported by exactly three tests
  (`network`/`task`/`profile` `client.test.ts`), none of which opens two clients of one service.
- F7: `@nulo/extension-messaging/package.json` has no `./testing` export; `@nulo/wallet-core/testing`
  and `@nulo/design/testing` are the precedent, and `apps/extension` already depends on the package.
- F8: `apps/extension/vitest.config.ts` re-runs `packages/extension-messaging/src/**/*.test.ts` under the
  extension's setup file; the harness's import-installed `beforeEach` registers after it and wins.
- F9: `biome.json` exempts `**/vitest.setup.ts`, `**/*.test.ts`, `**/tests/**` from the 80-line cap but
  not `packages/*/src/testing/`.
- F10: the README's key invariant names `PortDisconnectedError`, which does not exist, and conflates two
  contracts: a disconnect rejects in-flight requests with the plain `Error("Client disconnected")`
  (`base-client.ts:342`), while `RpcDisconnectedError` is the send-failure error (`:331-339`); both are
  pinned by `client.test.ts:69-86`.
- F11: `trim()` projects an error to `name` + scrubbed `message` and drops everything else
  (`wallet/logger/utils.ts:169-174`) — a cause carried in `details` never reaches the log.

### Inferences

- I1: on a **successful** open nothing changes for any caller — the 8 awaited `connect()` sites
  (`activity.vue:157`, `json/index.vue:36`, `RecentActivityView.vue:761,766`, `PopupManager.vue:260,265`,
  `NewTokenPopup.vue:184`, `app.store.ts:248`) get the same synchronous open. On a **failed** open the
  awaited sites now proceed where today they hang forever (the loop never resolves); event-only clients
  among them (`incomingTransfer`, `config`) hold no port and receive no events — on a page that is
  already dead. Accepted (codex B3).
- I2: on a successful open, `ensureTransportReady` returning `void` changes no timing — today it returns
  `void` whenever the port is open. The one state where it returned a promise outside the loop is
  `Disconnecting` (re-entrant only; see the client section).
- I3: the promoted registry keeps `localDisconnects` semantics verbatim — the counter counts every local
  `disconnect()` call, including the client's own teardown after a remote close. S3 does not assert on
  it (codex B4); it stays as the opt-in leak count for future tests.

### Asks

None. (Phase 0 answers: full consolidation; no UI change; gates = fast layers + local smoke + local
sharded network + CI.)

## Phases

### Phase 1 — terminal connect (messaging package) ✓

1. `RpcConnectError` in `errors.ts` (+ its `CODE` in the exported list, if one exists).
2. Rewrite `client.ts` per the Architecture section; delete `sleep` import and `Connecting`.
3. The containment `catch` in `apps/extension/src/wallet/services/logger/client.ts`.
4. Tests in `client.test.ts`, new describe `connect failure is terminal` (fake timers, spy logger):
   - `chrome.runtime.connect` throws → `client.echo()` rejects with `RpcConnectError` **before any timer
     advance**; `pendingCount` 0; `vi.getTimerCount()` unchanged; `connect` called exactly once; the spy
     logger holds exactly one error line whose message contains Chrome's reason.
   - `await client.connect()` resolves (does not reject); one log line, not two.
   - after a throwing open, a later successful open serves a request (the client is not stuck).
   - the reconnect describe gains: `emitPortDisconnect` while the replacement open throws → in-flight
     requests still reject `"Client disconnected"`, no timer remains, a later request reopens
     successfully.
5. `console-forwarding.containment.test.ts` (unmocks the logger client; keeps a **throwing**
   `chrome.runtime.connect` override — the point is a failed open): install forwarding, log one line via
   the real `documentLogger`, drain a macrotask → `chrome.runtime.connect` was attempted exactly once,
   no `unhandledrejection` fired (vitest fails the run on one regardless), and awaiting the returned line
   still rejects with `RpcConnectError`.

**Validation gate** — `bun run lint && bun run typecheck && bun --cwd packages/extension-messaging test
&& bun --cwd apps/extension test src/wallet/logger src/wallet/services/logger` → all exit 0, the new
describe and the containment test green, `port onDisconnect → reconnect` green. Layers: lint/typecheck,
unit.

### Phase 2 — the shared port fake ✓

1. `src/testing/port-registry.ts` + `index.ts`; `package.json` `./testing` export.
2. `port-registry.test.ts`, two contract cases (codex D2): (a) two live ports under one name are
   independent, and `closeAll(name)` closes only the snapshot — a listener that reopens synchronously
   leaves exactly one live replacement, not a close/reopen loop; (b) in `microtask` mode a port closed
   **after** posting and before its queued answer is never answered, and a further `postMessage` on it
   throws.
3. `transport-harness.ts` client direction on the registry; helper signatures unchanged.

**Validation gate** — `bun run lint && bun run typecheck && bun --cwd packages/extension-messaging test`
→ exit 0, every existing harness consumer green (`client.test.ts`, `hardening.test.ts`, `service.test.ts`).
Layers: lint/typecheck, unit.

### Phase 3 — extension consumers ✓

1. `tests/vitest.setup.ts` on the registry; `emitPortDisconnect` exported.
2. `client.ports.test.ts` imports the shared fake; local classes deleted.
3. `logger/client.test.ts`'s `captureWire` on the shared fake. The containment test keeps its **throwing** `chrome.runtime.connect` override — the registry's `connectStub` always opens a port, so migrating it would stop exercising a failed open (codex r2).

**Validation gate** — `bun run lint && bun run typecheck && bun --cwd apps/extension test` → exit 0
(this run also re-executes the messaging tests under the extension setup — the double-run in F8).
Layers: lint/typecheck, unit + component.

### Phase 4 — docs + browser validation ✓

1. README rows and the invariant paragraph; `index.md`; the old plan's status line.
2. Local smoke: `cd apps/extension && bun run test:e2e` (alone — it pkills the dist's Chromes).
3. Local network, sharded per the owner's directive: `bun run e2e:agent --shard=1/2` and `--shard=2/2`
   as two runs, sequentially, nothing else heavy on the host (the suite mass-fails under load); a red shard
   is re-run once before triage.

**Validation gate** — smoke exit 0; both network shards exit 0 (or a re-run green with the flake named
in lessons); `bun run lint` exit 0. Layers: e2e, e2e-live-network. The PR's CI then runs the full
partition (`extension-network-e2e-status`, incl. `Run / canary / real-proving`).

## Post-implementation (self-contained; executed by the implementing session)

`code_review` is `off`: do NOT run `/code-review` (owner directive). The codex loop is the review.

1. **Codex audit** (`/codex` at `high`, via `~/.claude/skills/codex/scripts/run-codex.sh` launched inside
   tmux — background Bash codex runs get killed on this host; never `codex exec` directly). Send: the whole
   diff from `771c2a16`, this plan, the adversarial / security ask from the Security section, and both
   rules below verbatim. Tell codex not to run tests, builds or any vitest e2e config (a reviewer's smoke
   run kills other Chrome processes).
2. **Iterate**: verify each finding against the repo first; apply the accepted fixes; commit (signed);
   log the round (consult + verdict) in `lessons/post-impl.md`; resume the same codex session with the fix
   diff. Repeat until a round yields no new material findings. Still material after three rounds → stop
   and surface to the owner.
3. **Re-validate**: if any loop fix touched runtime code, re-run the Phase 1 gate and the smoke run;
   the PR's CI re-runs the network suite.
4. **Delivery** per the Delivery section — the first time any PR is opened.

**No-over-engineering rule** (verbatim in every codex prompt, initial and resumed): *"Report bugs and
small, targeted improvements only. Do not propose speculative abstractions, extra configuration
surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works
and is clear, leave it alone."*

**Comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per
character. Flag any comment that narrates what the code visibly does, restates its line, references
implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag
places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are
permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and
exact."*

Dispositional rules for an autonomous session: never idle; consult codex (`/codex high`) on any
decision you would otherwise bring to the owner and log the verdict in `lessons/`; hard limits stay
hard — never merge, publish or deploy, never widen scope past this file; five failures on one step →
reassess with codex.

## Delivery

Single arc, one branch, one PR into `dev`: `worktree-port-client-connect` → `gh pr create` after the
codex loop converges. PR title (Conventional, ≤ 93 chars):
`fix(messaging): fail a request at once when the port cannot open, and share one port fake`.
No stack ceremony. `code_review: off`. Merge is the owner's call.

## Codex audit

Transcripts in `audit-codex.md`. GPT-6 Astra at `high`, read-only sandbox.

### Round 1 — plan v1: `reject (with blocking findings: A1)`

| # | Finding | Outcome |
|---|---|---|
| A1 High | `documentLogger().log` returns an unhandled promise; both `onunhandledrejection` handlers log through the same logger → an immediate rejection loops per task. The plan's "cannot recurse" claim was wrong (it only covered synchronous recursion). | **adopted** — containment `catch` at the logger boundary (G5); regression test (Phase 1.5); reverses #613 D30. Verified: the loop exists today at the request-deadline cadence (established statically). |
| A2 Low | F3 overstated Chrome's contract as a guarantee. | **adopted** — F3 reworded: fail-fast is the chosen policy; the client is not terminal, only the request. |
| B1 Low | The README fix would still conflate the disconnect `Error` with `RpcDisconnectedError`. | **adopted** — three contracts documented separately (F10). |
| B2 Low | Recon counted a prose `.connect()`; `logger/client.test.ts` holds a fourth inline port fake. | **adopted** — 27 / 8 / 19; the fourth fake migrates (G4). |
| B3 Low | I1's evidence misstated: several awaited sites are event-only. | **adopted** — I1 narrowed to successful-open ordering; failed-open behaviour change accepted explicitly. |
| B4 Low | I2 ignored the `Disconnecting` re-entrant case; I3 cited an assertion S3 does not make. | **adopted** — both rewritten. |
| B5 High | "No Asks" hid the logger containment dependency. | **adopted** — containment is in scope (production file added to the map); no Ask remains. |
| C1 Med | Request-path failures were never logged (logging only in `connect()`); `trim()` drops `details.cause`. | **adopted** — log at `openPort`; cause message folded into `RpcConnectError.message` (F11). |
| C2 Med | `closeAll` must close a snapshot. | **adopted**. |
| C3 Med | Fake compatibility constraints (sync original envelope to the mock; `mockImplementationOnce` controls the send; manual never answers; barrel must not re-export the harness; `deliver` is a broadcast). | **adopted** — all five in the fake's contract. |
| D1 High | No test for A1. | **adopted** — the containment test. |
| D2 Med | Strengthen the existing cases; fold the Phase 2 cases into two. | **adopted**. |

Nothing rejected.

### Round 2 — plan v2 (resumed session): `approve`

A1 and C1 confirmed closed; the strengthened tests distinguish fixed from broken code (the containment
test's ordering — attach the rejection assertion only **after** the macrotask drain — is what isolates
containment). Six Low findings, all adopted: policy wording made consistent (Summary, Trade-offs); the
request deadline is 60 s (`DEFAULT_RPC_TIMEOUT_MS`), not 30 s, and the loop cadence is a static
conclusion, not a measurement; `settled` in the redaction test is not a logger awaiter (S3 is the
evidence); the `Disconnecting` re-entrancy is via a synchronous `onTerminal` override, not a rejection
callback; the `documentLogger` TSDoc that promises delivery to the unhandled-rejection handler is
rewritten with the containment; the containment test keeps its throwing `chrome.runtime.connect` after
Phase 3.

## ELI5

Artifact: https://claude.ai/artifact/F9F7aKvqon8Skw9jAVRejd — source `implementations-plan/port-client-connect/eli5.html` (republish the same path to update).

## Seeds (final — the owner set the `/goal` seed unchanged, 2026-09-17)

`/goal` — recommended (completion is transcript-observable):

```
/goal All four phases marked ✓ in implementations-plan/port-client-connect/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript (Phase 4: smoke exit 0 and both e2e:agent shards exit 0, or one re-run green with the flake named in lessons); for each phase the agent printed `LESSONS_FILE=implementations-plan/port-client-connect/lessons/phase-N.md`; plan.md says `code_review: off`, so `/code-review` was NOT run; the codex fix loop converged over the whole diff from 771c2a16, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; exactly one PR into dev exists for branch worktree-port-client-connect, created only after the loop converged (`gh pr view` output in the transcript), and `gh pr checks` shows every required check green with the `Run / canary / real-proving` job itself passed; `bun run test:all` and `bun run lint` both report exit 0 in the transcript.
```

`/loop 15m` — fallback:

```
/loop 15m Drive implementations-plan/port-client-connect forward. Never idle waiting for my input. Each firing: (1) read plan.md + lessons/ (authoritative), rebuild the task list from plan.md if empty, `git status`, `git log --oneline -5`; if a PR exists `gh pr view --json statusCheckRollup`. (2) Waiting on CI is fine — confirm it progresses; use the wait to review the diff. (3) No task in hand? take the next pending step; after each edit run `bun run lint` + the touched package's `test`; commit, push. (4) Stuck or facing a decision you'd bring to me? `/codex high`, decide, log the consult in lessons/phase-N.md; hard limits: never merge, publish, deploy, or widen scope. (5) Same step failed 5 times → reassess with codex. (6) Phase green = its validation gate in plan.md passes: paste the result, mark ✓, print `LESSONS_FILE=…/lessons/phase-N.md`. (7) All ✓ → Post-implementation section: codex loop (`code_review: off`) until clean, then `gh pr create`, `gh pr checks --watch`, wrap-up report, stop.
```

Use exactly one per session — they don't compose.
