# port-client-connect — a synchronous connect failure is terminal, and one port fake for every test

---
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: default (recon 1 agent; codex at high)
status: DRAFT — awaiting codex audit
baseline: 771c2a16 (dev, after #613)
worktree: .claude/worktrees/port-client-connect · branch worktree-port-client-connect
---

## Summary

`ServiceClient.connect()` (`packages/extension-messaging/src/background/client.ts:45-64`) wraps
`chrome.runtime.connect` in a `while (Connecting)` loop that catches any throw, logs an error and sleeps
1 s before trying again — forever. The loop rests on a false premise: in MV3 `chrome.runtime.connect`
never throws because the service worker is asleep (it returns a Port and wakes the worker; a dead peer
surfaces later as `onDisconnect`, which the client already handles by reconnecting). The only synchronous
throws are permanent — "Extension context invalidated" after an update or reload, or a bad extension id.
So the loop never rescues anything; on an invalidated page it spins forever, emitting
`logError("Failed to connect")` once a second, and `waitForConnection()` polls state every 300 ms while a
caller's request waits out its full timeout with no cause. In unit tests the same loop is what the
`vitest.setup.ts` throw-on-second-port guard trips into: a retry timer that ticks for the rest of the file
(#613 silenced it for the logger client with a mock; this plan removes it).

This plan (1) makes a synchronous connect throw **terminal**: the request that needed the port rejects at
once with a typed `RpcConnectError`, nothing retries, no timer exists; the `onDisconnect` reconnect path is
untouched; `connect()` keeps its never-rejects contract because 19 of the extension's 27 `connect()` calls
are floating. (2) Deletes the `Connecting` state and the poll — both existed only to serve the loop
(`chrome.runtime.connect` is synchronous, so the port is either open or the call threw). (3) Promotes the
`FakePort`/`PortRegistry` written for `client.ports.test.ts` into `@nulo/extension-messaging/testing`
and puts the extension's global port stub, the package's transport harness and that test on it, so the
repo has one port fake with honest semantics (N ports per name, per-port disconnect, a closed port throws
on `postMessage`) instead of three, and the throw-on-second-port guard becomes an opt-in count.

Out of scope: any user-visible change (owner: errors flow through existing paths); the offscreen client
(no loop there); the wallet-core `FakeBrowserApi` port registry (a different layer's abstraction, same
name); a `connect_failed` terminal status (see Trade-offs).

## Goals / non-goals

- G1: a synchronous `chrome.runtime.connect` throw rejects the triggering request with `RpcConnectError`
  within the same tick, leaves the client `Disconnected`, schedules no timer, logs once.
- G2: a service-worker restart (`port.onDisconnect`) still reconnects transparently and in-flight
  requests still reject with the string-shaped `"Client disconnected"` error (existing tests pin it).
- G3: `connect()` never rejects; the request is where the typed error surfaces.
- G4: exactly one `chrome.runtime.connect` port fake in the repo, exported as
  `@nulo/extension-messaging/testing`, consumed by the extension setup file, the package harness and the
  logger ports test; helper names `capturePortMessage` / `emitPortMessage` / `emitPortDisconnect` keep
  working for the five files that import them.
- N1: no change to `BaseServiceClient.request()` — a sync throw from `ensureTransportReady()` already
  rejects cleanly before any pending state exists (`core/base-client.ts:122-123`).
- N2: no UI change, no new event on the client (`onConnected`/`onDisconnected` unchanged).
- N3: the server-side (`onConnect`, `connectServiceClient`), the offscreen `sendMessage` broker and the
  logger helpers of `transport-harness.ts` stay where they are.

## Architecture & Implementation

### Client (`packages/extension-messaging/src/background/client.ts`)

```ts
enum ClientState { Connected, Disconnecting, Disconnected }   // Connecting removed

/** Never rejects: a failed open is logged once and reported by the request that needed the port. */
public async connect(): Promise<void> {
	try { this.openPort() } catch (error) { this.logError("Failed to connect", error) }
}

/** Opens the port synchronously or throws `RpcConnectError`. `chrome.runtime.connect` only throws for
 *  permanent reasons (the extension context is invalidated), so there is nothing to retry. */
private openPort(): void {
	if (this.state !== ClientState.Disconnected) return
	let port: chrome.runtime.Port
	try { port = chrome.runtime.connect(undefined, { name: this.service }) }
	catch (cause) { throw new RpcConnectError(this.service, cause) }
	this.port = port
	port.onDisconnect.addListener(this.onDisconnect)
	port.onMessage.addListener(this.onMessage)
	this.state = ClientState.Connected
	this.logDebug("Connected")
	this.onConnected.invoke()
}

protected ensureTransportReady(): void {   // was `void | Promise<void>`
	this.openPort()                          // no-op when Connected; throws when the open fails
}

private readonly onDisconnect = () => { this.disconnect(); void this.connect() }
```

- `waitForConnection`, `sleep` import and the `Connecting` state are deleted. `ensureTransportReady`
  narrows to `void`; the base's contract (`void | Promise<void>`) is unchanged for the offscreen client.
- `disconnect()` is unchanged. `Disconnecting` stays as the transient guard it is today.
- A request on an invalidated page pays one `chrome.runtime.connect` call + one `logError` per request —
  bounded by request rate, not by a timer. (The logger client logs through `DummyLogger`, so a failing
  logger port cannot recurse.)

### Error (`packages/extension-messaging/src/errors.ts`)

```ts
/** `chrome.runtime.connect` threw synchronously — the extension context is gone (update / reload) or the
 *  id is wrong. Permanent for this document; nothing retries. Client-local, never crosses the wire. */
export class RpcConnectError extends WalletError {
	static readonly CODE = "RPC_CONNECT_FAILED"
	constructor(service: string, cause: unknown) {
		super(RpcConnectError.CODE, `Cannot open a port to ${service}`, { service, cause }, "RpcConnectError")
	}
}
```

Follows the sibling pattern (`RpcDisconnectedError`). Not added to `walletErrorFromPayload` — it is never
serialized from a service. The `cause` is projected by the logger's `trim()` like every other error.

### Shared port fake (`packages/extension-messaging/src/testing/port-registry.ts`, new)

The `FakePort` + `PortRegistry` from `client.ports.test.ts`, generalised in three places:

- `post()` no longer asserts `method === "log"`; it validates the envelope shape
  (`type === Request`, numeric `requestId`, string `method`) and records `{port, requestId, method, params}`.
- A per-name `vi.fn` postMessage mock (`registry.mock(name)`) so `capturePortMessage(name)` keeps returning
  a `Mock` whose `.mock.calls` the harness tests read (`lastRequestId()` in `client.test.ts`).
- Answering is a mode, not a default: `new PortRegistry({ answer: "microtask" | "manual" })`. The harness
  and the extension setup use `manual` (tests deliver responses with `emitPortMessage`); the logger ports
  test uses `microtask` with `hold` / `answerHeld()` as today.
- `deliver(name, message)` invokes every live port's `onMessage` listeners for that name;
  `remoteClose(port)` (unchanged) closes one port and fires only its far-end `onDisconnect`;
  `closeAll(name)` remote-closes every live port of a name (what `emitPortDisconnect` becomes).
- `connectStub(registry)` returns the `chrome.runtime.connect` implementation
  (`(_, { name }) => registry.open(name)`).
- Exported from a new `src/testing/index.ts`; `package.json` gains `"./testing": "./src/testing/index.ts"`.
  `setup.ts` stays unexported (unchanged).

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
- The three extension client tests (`network`/`task`/`profile`) change nothing — same helper names, same
  relative import.

### Data & control flow (the critical path)

Request on a healthy page: `request()` → `ensureTransportReady()` → `openPort()` (no-op, Connected) →
sync `postMessage`. Unchanged timing — no microtask inserted (the base's synchronous-send invariant).

Request on an invalidated page: `request()` → `ensureTransportReady()` → `openPort()` throws
`RpcConnectError` → `request()`'s promise rejects; no pending entry, no timer. `connect()` called
explicitly by a page: logs once, resolves.

Worker restart: `port.onDisconnect` → `disconnect()` (rejects in-flight with `"Client disconnected"`,
fires `onDisconnected`) → `connect()` → `openPort()` → `Connected`, `onConnected`. Identical to today.

### File-level change map

| File | Change |
|---|---|
| `packages/extension-messaging/src/background/client.ts` | delete loop, poll, `Connecting`, `sleep` import; add `openPort`; `connect` never rejects |
| `packages/extension-messaging/src/errors.ts` | `RpcConnectError` |
| `packages/extension-messaging/src/background/client.test.ts` | new describe "connect failure is terminal" (3 tests) |
| `packages/extension-messaging/src/testing/port-registry.ts` (new) + `port-registry.test.ts` (new) + `index.ts` (new) | the shared fake + 3 contract tests + barrel |
| `packages/extension-messaging/package.json` | `./testing` export |
| `packages/extension-messaging/src/testing/transport-harness.ts` | client direction on the registry |
| `apps/extension/tests/vitest.setup.ts` | port stub on the registry; `emitPortDisconnect` |
| `apps/extension/src/wallet/services/logger/client.ports.test.ts` | import the shared fake |
| `packages/extension-messaging/README.md` | file-map rows for `transport-harness.ts` + `port-registry.ts`; rewrite the "Port reconnects are silent" invariant (name `RpcDisconnectedError` correctly; add the terminal case) |
| `implementations-plan/index.md` | this plan's row; `owned-client-teardown` → merged (#613) |
| `implementations-plan/owned-client-teardown/plan.md` | status line → merged |

### Trade-offs & alternatives not taken

- **`connect()` rejects with the typed error** (honest, no swallowing). Rejected: 19 floating
  `x.connect()` calls in `apps/extension/src` would become unhandled rejections in exactly the case that
  fails; the request is where every caller already handles errors. Documented in the TSDoc.
- **A sticky `Failed` state** (fail once, reject every later request without touching Chrome). Rejected:
  a fourth state and a recovery question ("who resets it?") to save one synchronous call per request on a
  page that is already dead.
- **Bounded backoff** (3 attempts). Rejected: there is no transient case for a synchronous throw to
  recover from; a retry only delays the honest answer.
- **A `connect_failed` `RequestTerminalStatus`** with `onTerminal` reporting. Deferred: readiness-phase
  failures (this one and the existing deadline timeout) reject before a pending entry exists and are
  invisible to `onTerminal` today; making them visible is a coherent, separate change to the base
  correlator. The `logError` line is the observable signal for bug reports.
- **Keeping the throw-on-second-port guard** in the shared fake. Rejected: a fake that throws inside
  the code under test is the mechanism that produced this wart; `registry.live(name).size` is the same
  leak detector, asserted where the test means it.
- **Migrating only the extension consumers** and leaving `transport-harness.ts`. Rejected by the owner
  (Phase 0): one fake, three consumers.

## Security & Adversarial Considerations

- Threat surface: none new on the wire. `RpcConnectError` is client-local and never serialized; the
  `cause` it carries is Chrome's own message ("Extension context invalidated.") and reaches the log only
  through `trim()`'s error projection (name + message). No URL, no payload.
- The change removes a denial-of-usefulness: an invalidated popup no longer runs a 1 s log loop that
  fills the `LoggerStore` ring buffer (and, with developer mode on, `chrome.storage.session`) for as long
  as the page stays open.
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
- F3: `chrome.runtime.connect` is synchronous and only throws for permanent reasons — Chrome's
  `runtime.connect` contract; an asleep worker is woken, a missing listener surfaces as `onDisconnect`
  with `lastError`. (Also the premise of the existing `port onDisconnect → reconnect` tests.)
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
- F10: the README's key invariant names `PortDisconnectedError`, which does not exist (the class is
  `RpcDisconnectedError`).

### Inferences

- I1: no production code depends on `connect()` taking time — every awaited call is immediately followed
  by a request or a subscription. Verified by reading the 8 awaited sites; codex is asked to attack it.
- I2: making `ensureTransportReady` return `void` (never a promise) for the port client changes no
  observable timing: today it already returns `void` whenever the port is open, and the only path that
  returned a promise was the retry loop.
- I3: the `client.ports.test.ts` S3 expectation on `localDisconnects` survives the promotion unchanged —
  the registry's `closedLocally` semantics are copied verbatim.

### Asks

None. (Phase 0 answers: full consolidation; no UI change; gates = fast layers + local smoke + local
sharded network + CI.)

## Phases

### Phase 1 — terminal connect (messaging package)

1. `RpcConnectError` in `errors.ts` (+ its `CODE` in the exported list, if one exists).
2. Rewrite `client.ts` per the Architecture section; delete `sleep` import and `Connecting`.
3. Tests in `client.test.ts`, new describe `connect failure is terminal`:
   - `chrome.runtime.connect` throws → `client.echo()` rejects with `RpcConnectError`, `connect` was
     called exactly once, `vi.advanceTimersByTimeAsync(5_000)` triggers no second call, `pendingCount` 0.
   - `await client.connect()` resolves (does not reject) and logs the error once (spy logger).
   - after a throwing open, a later successful open serves requests (the client is not stuck).
   - the reconnect describe stays as is.

**Validation gate** — `bun run lint && bun run typecheck && bun --cwd packages/extension-messaging test`
→ all exit 0, the new describe green, `port onDisconnect → reconnect` green. Layers: lint/typecheck, unit.

### Phase 2 — the shared port fake

1. `src/testing/port-registry.ts` + `index.ts`; `package.json` `./testing` export.
2. `port-registry.test.ts`, three contract cases: two live ports under one name are independent;
   `remoteClose` fires only that port's `onDisconnect` and removes it from `live`; a closed port throws on
   `postMessage` and is not answered.
3. `transport-harness.ts` client direction on the registry; helper signatures unchanged.

**Validation gate** — `bun run lint && bun run typecheck && bun --cwd packages/extension-messaging test`
→ exit 0, every existing harness consumer green (`client.test.ts`, `hardening.test.ts`, `service.test.ts`).
Layers: lint/typecheck, unit.

### Phase 3 — extension consumers

1. `tests/vitest.setup.ts` on the registry; `emitPortDisconnect` exported.
2. `client.ports.test.ts` imports the shared fake; local classes deleted.

**Validation gate** — `bun run lint && bun run typecheck && bun --cwd apps/extension test` → exit 0
(this run also re-executes the messaging tests under the extension setup — the double-run in F8).
Layers: lint/typecheck, unit + component.

### Phase 4 — docs + browser validation

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

_(pending — round 1 recorded here with adopted / rejected per finding)_

## Seeds (DRAFT until approval)

`/goal` — recommended (completion is transcript-observable):

```
/goal All four phases marked ✓ in implementations-plan/port-client-connect/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript (Phase 4: smoke exit 0 and both e2e:agent shards exit 0, or one re-run green with the flake named in lessons); for each phase the agent printed `LESSONS_FILE=implementations-plan/port-client-connect/lessons/phase-N.md`; plan.md says `code_review: off`, so `/code-review` was NOT run; the codex fix loop converged over the whole diff from 771c2a16, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; exactly one PR into dev exists for branch worktree-port-client-connect, created only after the loop converged (`gh pr view` output in the transcript), and `gh pr checks` shows every required check green with the `Run / canary / real-proving` job itself passed; `bun run test:all` and `bun run lint` both report exit 0 in the transcript.
```

`/loop 15m` — fallback:

```
/loop 15m Drive implementations-plan/port-client-connect forward. Never idle waiting for my input. Each firing: (1) read plan.md + lessons/ (authoritative), rebuild the task list from plan.md if empty, `git status`, `git log --oneline -5`; if a PR exists `gh pr view --json statusCheckRollup`. (2) Waiting on CI is fine — confirm it progresses; use the wait to review the diff. (3) No task in hand? take the next pending step; after each edit run `bun run lint` + the touched package's `test`; commit, push. (4) Stuck or facing a decision you'd bring to me? `/codex high`, decide, log the consult in lessons/phase-N.md; hard limits: never merge, publish, deploy, or widen scope. (5) Same step failed 5 times → reassess with codex. (6) Phase green = its validation gate in plan.md passes: paste the result, mark ✓, print `LESSONS_FILE=…/lessons/phase-N.md`. (7) All ✓ → Post-implementation section: codex loop (`code_review: off`) until clean, then `gh pr create`, `gh pr checks --watch`, wrap-up report, stop.
```

Use exactly one per session — they don't compose.
