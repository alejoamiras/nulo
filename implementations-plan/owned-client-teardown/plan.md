---
plan: owned-client-teardown
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
codex_effort: high
recon_budget: 2 agents (batched reuse sweep + messaging-lifecycle mapper), default
status: APPROVED 2026-09-17 (owner set the /goal seed) — implementing; five review rounds folded, codex closure check approve
worktree: .claude/worktrees/owned-client-teardown (branch worktree-owned-client-teardown, from origin/dev @ c543c18d)
eli5: https://claude.ai/artifact/QnnvndhFVNppQxMt38tWGc (source implementations-plan/owned-client-teardown/eli5.html)
---

# owned-client-teardown — one logger port per document, not one per service client

Every service client the popup, onboarding tab, action windows and offscreen document construct
builds its own private `LoggerServiceClient`. That logger is a port-based messaging client, the
first log line opens its port, and nothing ever closes it: `disconnect()` closes the client's own
port and then logs `"Disconnected"` through the logger, which keeps (or reopens) the logger's port.
A page mount, a profile switch, an unlock or a backup import therefore leaves one logger port
behind per client it built, for as long as the document lives. The presto-migration arc-2 codex
round reproduced it: three connect/disconnect cycles, three logger ports left open.

This plan stops building private loggers. The logger class stops being exported; a document gets
its loggers from `documentLogger(context?)` — context-tagged views over one shared client, whose
port the first line opens and Chrome closes when the document unloads — so a document holds one
logger port however many clients it builds. Nothing is torn down, so none of recon's teardown
hazards (reconnect flap, reopen by late lines, rejected in-flight lines, double disconnect) can
occur. A port-count test fails on today's code and passes on the fix. Ask A3 decides whether the
same PR also stops three outer account clients that leak their own ports the same way.

## Owner answers (Phase 0, 2026-09-16)

- **Scope**: every owned inner client — the logger, plus any other client that builds an inner
  messaging client and never closes it. Recon found no second leaking kind (the service worker's
  nine PXE clients are one-per-worker; see `recon.md`). The Claude audit found three *outer* account
  clients that leak; widening to them is Ask A3, not assumed.
- **Design fork**: the audits pick between the two designs; the owner approves or overrules at the
  gate. All three audit passes picked the lead design.
- **Validation**: fast layers on every phase; smoke e2e locally; the network e2e locally, sharded,
  before the PR; CI on the PR. Standing owner directive (2026-09-01): run local e2e shards
  concurrently for wall-clock speed. **v4 revises this** (Fable review, D26): the PR's required
  network gate runs the identical partition at retry 0, and the host's own record says the network
  suite mass-fails under concurrent load — so the local gate is smoke, and a local network pass is
  Ask A5 (none, or one sequential pool pass). The owner confirms or overrules at the gate.
- **`code_review: off`** (standing owner directive, 2026-09-03); codex at `high`; no `/harden` —
  no trust boundary moves.

**UI impact: none.** No screen, copy, row or format changes; log lines keep their context tags, so
the log viewer and its CSV export are unchanged.

## Scope

**In**

- `apps/extension/src/wallet/services/logger/client.ts`: `documentLogger(context?: DocumentLogContext)`,
  a module-private `LoggerServiceClient` shared by the document, and `_resetDocumentLoggerForTests()`.
- The 20 service-client constructors and the 3 standalone logger sites (popup/onboarding console
  forwarding, the offscreen console, the offscreen PXE logger) take their logger from it;
  `installConsoleForwarding` returns `void` and accepts only `"popup" | "onboarding"`.
- `apps/extension/tests/vitest.setup.ts`: one module mock gives every extension unit test a silent
  document logger; the logger's own tests opt out.
- A port-count test that fails on today's code and proves the fix.
- The two tests that construct or mock the logger client adapt; one stale comment; one sentence in
  `ARCHITECTURE.md` §3.
- **If A3 = fold in**: Phase 3's three account-client fixes, each with a test.
- Local smoke (Phase 4); the PR's CI runs the network suite. **If A5 = yes**: one sequential,
  CI-partitioned proverless pool pass before the PR.

**Out** (why)

- The service worker's nine `PxeServiceClient`s — one per worker, sendMessage transport, no port;
  not a leak (`recon.md`, verified non-leaks).
- Any change to `packages/extension-messaging` — the chosen design needs no state-machine change.
- Client-side level gating of debug log lines (Ask A1) — every request still sends `→`/`←` debug
  RPCs that the service worker drops when debug mode is off; a traffic cost, not a leak.
- Making the port client's `disconnect()` idempotent — dropped: latent, no caller disconnects twice
  (recon hazard 4).
- Today's logging-failure behavior (Ask A4).
- Profile creation's activation poll, which checks only `isLogined` (F14) — pre-existing, unchanged
  by this plan; a follow-up.
- A local run of the prover-ON canary files (Ask A2), and of the heavy and concurrent-sendtx files
  (CI's dedicated jobs cover them; nothing here touches their paths).
- New e2e specs — the proof is unit-level; the smoke and network suites are the regression net.
- Consolidating the fake-port test doubles (three after this plan; Ask A1's follow-up).

## Architecture & Implementation

### Shape

The bug is an ownership mistake: a document-lifetime resource (a logger connection) was given a
per-client owner that never releases it. The fix gives it the owner it actually has — the document
— instead of teaching every client to release it. The per-document memo reuses the idiom
`apps/extension/src/utils/core.ts:92-112` already applies to the profile and contact clients
(`initAppServiceContext`), one level down.

Nothing in `packages/extension-messaging` changes: `BaseServiceClient` keeps receiving an
`ILogger` it never manages, and `ServiceClient`'s connect/disconnect/reconnect state machine
(pinned by `background/client.test.ts:511-556`) stays byte-identical.

### Key interface

```ts
// apps/extension/src/wallet/services/logger/client.ts
export * from "./spec"

/** The `context` tags extension documents put on their log lines. */
export type DocumentLogContext = "popup" | "onboarding" | "offscreen"

class LoggerServiceClient extends ServiceClient<Methods> {
	public constructor() {
		super(LOGGER_SERVICE_NAME, new DummyLogger())
	}

	/** Redacts here, before `request()` sanitizes the shapes `trim()` collapses (unchanged). */
	public log(context: DocumentLogContext | undefined, source: string, level: LogLevel, ...data: unknown[]) {
		return this.request("log", context, source, level, ...(trim(data) as unknown[]))
	}
}

let shared: LoggerServiceClient | undefined

/** This document's logger, tagging its lines `context`. Every view shares one client whose port
 *  the first line opens and Chrome closes with the document; callers never disconnect it. */
export function documentLogger(context?: DocumentLogContext): ILogger {
	return {
		log(source, level, ...data) {
			shared ??= new LoggerServiceClient()
			return shared.log(context, source, level, ...data)
		},
	}
}

/** Forgets the shared client without disconnecting it, for tests that assert on logger traffic. */
export function _resetDocumentLoggerForTests(): void {
	shared = undefined
}
```

- **Why a module function, not a static factory with a private constructor** (v1): a TypeScript
  `private constructor` guards only TypeScript. `apps/extension/tsconfig.json` has no
  `allowJs`/`checkJs`, and 149 of the 191 extension SFCs are plain `<script setup>`. With the class
  not exported at all, `import { LoggerServiceClient }` fails everywhere: a type error in `.ts` and
  `lang="ts"` files, and a `MISSING_EXPORT` build error in JS SFCs (F12, probed). This is an API
  boundary, not a security boundary.
- **One client, context-bound views** (v4, D27): `ILogger` is a single method
  (`packages/wallet-core/src/logger/interfaces.ts:30-32`), so a view is a three-line closure that
  prepends its tag. The document ends with one logger port, not one per context; the per-context
  memo and its `Map` go away; the codex round-1 note ("if one port later matters, use immutable
  context-bound views") is taken up now rather than later. Views are stateless, so nothing memoises
  them; a caller that holds one keeps it for the document's life as before.
- **The view is a plain object**, not the client: a typed borrower cannot reach `disconnect()`,
  and a cast reaches nothing — only the module holds the client. The view returns `log()`'s
  promise as today's class does (F4): `ILogger.log`'s `void` return type accepts it, no production
  caller consumes it (grep), and a rejected line still surfaces through the page's
  unhandled-rejection handler (A4). Returning it rather than dropping it is what lets the proof test
  observe a rejection directly (codex round 3 #2): vitest runs under jsdom, where a runtime
  rejection never becomes a `PromiseRejectionEvent`.
- **`DocumentLogContext`** names the three tags documents use. It is deliberately not wallet-core's
  existing `LogContext` (`"sw" | "offscreen" | "popup" | "content"`, F19), which lacks
  `"onboarding"` and names contexts that never log over a port. The wire `Methods.log` keeps
  `context: string | undefined`; the service worker treats it as untrusted input as before.
- **`_resetDocumentLoggerForTests`** forgets without disconnecting: a disconnect would reject pending
  log calls that nobody awaits, and vitest fails a run on unhandled rejections. Naming follows
  `_resetArtifactCatalogForTests` and siblings in `packages/aztec-runtime/src/pxe/`.
- Log lines keep today's `context` values, so the log viewer and its CSV export are unchanged.

### Test isolation

Within one test file the shared client outlives each test's `chrome` stub
(`tests/vitest.setup.ts:88-123`), so it would keep posting later tests' lines into the first test's
fake port, each line holding a 60 s timeout timer (`base-client.ts:135`). Every client test that
builds a real client — directly (e.g. `profile/client.test.ts:54`) or through the code it mounts —
would inherit that. The mock also retires a pre-existing wart: the global port double throws on a
second port with the same name (F9), and `connect()` catches that and retries every second forever
(`background/client.ts:47-62`), so today any unit test whose second client logs `"Connected"` leaves
a permanent 1 s retry loop running for the rest of the file. One module mock in the setup file
removes both for all of them:

```ts
// apps/extension/tests/vitest.setup.ts
vi.mock("@/wallet/services/logger/client", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	documentLogger: () => ({ log: () => {} }),
}))
```

`logger/client.test.ts` and `client.ports.test.ts` start with
`vi.unmock("@/wallet/services/logger/client")` and reset the shared client in `beforeEach`;
`console-forwarding.test.ts` keeps its own mock, which wins over the setup's (F18, probed). A setup
file that *imports* the module instead would break that file mock (D7).

### Data & control flow (critical paths)

1. **Page boot**: `popup/index.ts` → `installConsoleForwarding("popup")` → `documentLogger("popup")`;
   its port opens on the first forwarded console line.
2. **First service client**: `client.connect()` → `logDebug("Connected")` → the untagged view →
   the shared client's port opens, synchronously (`background/client.ts:52-56,107`) — or it is
   already open from step 1.
3. **Every later client** — page mounts, the bootstrap handoff (`useProfileBootstrap.ts:58-60,
   103-105`, `utils/core.ts:172-179`), throwaway clients (`refreshBalances`, backup import) — logs
   through the same client: no new logger port.
4. **Client disconnect**: closes its own port; `"Disconnected"` and the settle lines ride the
   shared port, which stays open for the next borrower.
5. **Service-worker restart**: every port drops; the shared client reconnects through the existing
   `onDisconnect` path (one replacement port per document); its in-flight lines reject as today and
   the page handlers (`console-forwarding.ts:17-22`, `offscreen/index.ts:50-69`) demote them.
6. **Document unload**: Chrome closes the document's ports; `Service.onDisconnect` splices them
   (`background/service.ts:54-63`).

Every document — popup, side panel, onboarding tab, action windows, offscreen — ends with exactly
one logger port; its lines carry the tag of whichever view logged them.

### Outer account clients (Phase 3, only if A3 = fold in)

| Site | Change | Why this shape |
|---|---|---|
| `apps/extension/src/popup/pages/auth.vue:184` | `managers.account ??= new AccountServiceClient()` | Disconnect-then-replace would reject in-flight calls of any flow still holding the old client across awaits — the network-switch handler does (F15). Keeping the existing client changes nothing observable (I7). |
| `apps/extension/src/popup/pages/profile/new-profile-helpers.ts:28` | same | Same reasoning; this poll's weaker handshake (F14) is pre-existing and unchanged. |
| `apps/extension/src/composables/useFullBackupImport.ts:528` | `try { reconcile } finally { accountService.disconnect() }`; rewrite the NOTE at 526-527 | The accounts stage already disconnected this client; the reconcile call reconnects it and nothing uses it afterwards. |

`??=` removes the leak; it does not make the activation handshakes race-free and must not be
described as doing so.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/wallet/services/logger/client.ts` | as in Key interface |
| `apps/extension/src/wallet/services/*/client.ts` (20) | `new LoggerServiceClient()` → `documentLogger()` |
| `apps/extension/src/wallet/logger/console-forwarding.ts` | `documentLogger(client)`; `client: "popup" \| "onboarding"`; returns `void` |
| `apps/extension/src/offscreen/index.ts` | `:41` → `documentLogger("offscreen")`, `:102` → `documentLogger()` |
| `apps/extension/tests/vitest.setup.ts` | the silent-logger module mock (Test isolation) |
| `apps/extension/src/wallet/services/logger/client.test.ts` | `vi.unmock`; `documentLogger("popup")` etc.; reset in `beforeEach`; the capture helper replaces `chrome.runtime.connect` with a port that records `postMessage` params (the class is no longer reachable, so its `request` seam is not either) |
| `apps/extension/src/wallet/logger/console-forwarding.test.ts` | the module mock exposes `documentLogger`; assert it received the tag |
| `apps/extension/src/wallet/services/logger/client.ports.test.ts` | **new** — the port-count proof |
| `apps/extension/src/wallet/services/logger/service.ts` | comment at `:8-10` points at `documentLogger` |
| `ARCHITECTURE.md` §3 | one sentence: clients borrow their document's loggers |
| Phase 3 (A3): `auth.vue`, `new-profile-helpers.ts`, `useFullBackupImport.ts` + their tests | as in the table above |

The ~130 outer client call sites, the `onBeforeUnmount` cleanup-order rule and the C1 composable
rule are untouched.

### The proof test (non-obvious mechanics)

`client.ports.test.ts` cannot use the global port double: it never answers a request and throws on
a second port with the same service name, even after the first disconnected
(`tests/vitest.setup.ts:50-86`), and "N live `logger` ports" is exactly what it must count.

- **Counting stub**, installed in the file's `beforeEach` by replacing `chrome.runtime.connect` on
  the global stub. Each fake port mirrors Chrome's semantics:
  - `live: Map<name, Set<FakePort>>` plus a cumulative `opened: Map<name, FakePort[]>`;
    `port.disconnect()` removes the port, counts a local disconnect and does not fire its own
    `onDisconnect` (Chrome fires only the other end); `remoteClose(port)` removes it and fires its
    `onDisconnect` listeners (a service-worker restart).
  - `postMessage` on a closed port throws, as Chrome does.
  - Every posted message must be a request envelope (`type: MessageType.Request`, numeric
    `requestId`, the expected method); anything else fails the test.
  - Auto-answer mode replies on a microtask, on the originating port only, with that request's
    `requestId`, to the listeners attached at delivery time, and skips a port closed by then. A hold
    mode keeps requests unanswered for S3.
  - Keep the stub's functions flat: Biome's cognitive-complexity budget applies to tests.
- **Delivery, settlement and continuity, not just counts**: each scenario asserts that every
  expected line (source, message and context tag decoded from the `wrapParams` params) was posted
  on a live `logger` port; that the `logger` ports opened so far, cumulatively, are the expected
  set (same port object throughout in the fixed code) with zero local disconnects — so a borrower
  that closes the shared logger and lets the next line reopen it fails; and, after draining
  microtasks, that no request is left pending (settlement is observable at the stub: every
  request it answered, and no `logger` port holding an unanswered one), so nothing keeps a timer.
- **Scenarios**, driven through real service-client classes (statically imported after
  `vi.unmock`; no `vi.resetModules()`):
  - **S1** five different service clients connect → one live, one cumulative `logger` port; each
    client's `"Connected"` line delivered and answered on it.
  - **S2** fifty construct → connect → disconnect cycles of one client type (the bootstrap handoff
    shape) → one live, one cumulative `logger` port, the same object throughout; zero live ports
    for the cycled service; all hundred lines delivered and answered.
  - **S3** service-worker restart: with answers held, a line logged through `documentLogger()` is
    pending when the `logger` port closes remotely; the test holds the promise the view returns
    (a test-only cast from `void`), awaits its rejection with `CLIENT_DISCONNECTED_MESSAGE`, then
    asserts exactly one replacement `logger` port and that the next line is delivered and answered
    on it. The page handlers' demotion stays covered by `console-forwarding.test.ts`'s synthetic
    events; jsdom never turns a runtime rejection into a `PromiseRejectionEvent`.
  - **S4** views for `"popup"`, `"onboarding"`, `"offscreen"` and no context each deliver a line
    carrying its own wire tag, all on the one `logger` port; after
    `_resetDocumentLoggerForTests()` the next line opens a new port.
- **Red first, no pins**: Phase 1 writes S1–S2 with the fixed expectations and records the failing
  assertions on today's code (baseline SHA, exact command, the count failures, and a note that the
  red test is uncommitted); Phase 2 adds S3–S4 and makes all four pass. The `(BUG PIN)`
  convention is for behavior a PR *preserves*; pinning counts this PR fixes, then flipping them, is
  churn the lessons file already replaces (D28).
- **Both real-logger test files settle before they reset**: the transport arms a timeout and a
  warning timer per request (`base-client.ts:131-151`) and `_resetDocumentLoggerForTests()` clears
  neither, so the proof stub *and* the redaction test's capture port answer every request on a
  microtask (correlated `requestId`, originating port) and each test drains before `beforeEach`
  resets. The redaction test keeps its positive assertions (the projected Error, the collapsed
  Note) by decoding the wrapped params it captures, not only the negative secret searches.
- **A third fake-port double, accepted** (D29): the extension's global port stub and the messaging
  package's `transport-harness.ts` are both single-slot-per-service (a second same-name port
  throws), which is the opposite of what a leak proof must observe. Neither can host counting
  without changing the contract their transport suites rely on, so the proof keeps its own stub —
  kept to what S1–S4 need — and Ask A1's consolidation follow-up now covers three doubles.

### Trade-offs & alternatives not taken

- **Owner closes its private logger** — the competing outline below; rejected by every audit.
- **Static `forDocument()` + private constructor** (v1) — leaves 149 JS SFCs unguarded.
- **Idle-close timer inside the logger** — bounds the leak without ownership, but adds a timer per
  logger, churns ports, and still holds one port per live client.
- **Log over `chrome.runtime.sendMessage`** — no port to leak, but every line would reach every
  other extension `onMessage` listener, including the service worker's nine PXE-client listeners
  and the offscreen document.
- **`FinalizationRegistry` closing a collected client's logger** — non-deterministic, and a
  connected port's listeners keep the client reachable, so it may never run.
- **Scan test banning `new LoggerServiceClient(`** — superseded: nothing outside the module can
  reach the class.
- **One memoised client per context** (v3) — two ports per document instead of one, a `Map` keyed
  on the context union, and a per-context reset, for no behavior the views don't give.
- **A global memo reset in `tests/vitest.setup.ts`** — it has to import the module, and vitest cannot
  mock a module a setup file already imported; `console-forwarding.test.ts` mocks this one.
- **Per-file `documentLogger` mocks in unrelated client tests** — misses tests that build real
  clients through the code they mount; one setup mock covers all of them.
- **`vi.resetModules()` + dynamic imports in the proof test** (v1) — re-evaluates every inlined
  `@nulo/*` package (`vitest.config.ts:82-86`), breaking `instanceof` for anything imported earlier,
  and disposes nothing; the reset function is simpler.
- **Disconnect-then-replace for the auth and profile-creation account clients** — see the Phase 3
  table.
- **A local replay of CI's network partition** (v3: two coordinated lanes, a sibling helper
  worktree, a baseline worktree for classification) — the PR's required gate runs the same
  partition at retry 0 on the same commit, and this change touches no network, PXE or dApp path.
  Dropped in v4 for smoke + CI, with one sequential pool pass as Ask A5 (D26).
- **Two concurrent lanes** for that pass (v3, D18) — the host's record says the network suite
  mass-fails under concurrent load and two sandbox boots starved each other on 2026-09-01; the
  fresh codex pass objected on the same grounds. If a local pass runs, it runs alone.

## Competing outline — "the owner closes what it owns" (rejected by all audits)

Keep one private logger per client and release it deterministically: the messaging base takes
`{ ownsLogger?: boolean }` and `ILogger` gains `close?()`; the port client's `disconnect()` splits
into a private `dropPort()` (used by reconnect-on-remote-close) and a public idempotent
`disconnect()` that closes an owned logger after its in-flight lines drain; a late line reopens it;
the 20 clients pass `ownsLogger: true`.

**For**: explicit ownership, generic at the messaging layer. **Against**: changes the state machine
every client uses (pinned by `background/client.test.ts:511-556`); each of recon's teardown hazards
needs code and a test; steady state still holds two ports per live client; the offscreen document
keeps three loggers; the drain adds an async tail after `disconnect()` that a page unloading
mid-drain loses anyway.

## Security & Adversarial Considerations

- **Threat model**: loggers run in extension-origin documents (popup, side panel, onboarding, action
  windows, offscreen). The service worker accepts a port only from a trusted internal sender
  (`background/service.ts:44`), checked per port. Sharing a port changes neither the sender nor that
  gate; no message type, RPC method or manifest permission is added.
- **Redaction**: every line still goes through `LoggerServiceClient.log`, which runs `trim()` before
  `request()` → `jsonSanitize` (`logger/client.ts:20-35`). `trim()` walks the logged objects
  synchronously in the caller and can run their getters — today's behavior, unchanged.
- **Encapsulation**: borrowers get a plain view object; neither a type nor a cast reaches the
  client, whose only reference is the module's `shared` binding. The test reset is exported and a
  production call to it would start a second client — a naming contract, not a runtime one; no
  production code calls it (grep). Nothing outside the module can import the class (F12).
- **Availability**: log calls are fire-and-forget (`ILogger.log` is `void`; `logDebug` does not
  await, `base-client.ts:366-368`), so a slow logger port never holds a client RPC — apart from
  `trim()`'s synchronous walk. What changes is the blast radius inside logging: a *closed* shared
  port reconnects on its `onDisconnect` as any client does today, but a *connected and
  unresponsive* one is not healed by further lines — each line times out after 60 s while the port
  stays connected — and that now affects every line in the document, not one client's.
- **Existing failure behavior kept (Ask A4)**: each rejected fire-and-forget log call is itself
  logged by the page's unhandled-rejection handler through the same logger
  (`console-forwarding.ts:17-22`, `offscreen/index.ts:50-69`), so a persistently failing logger
  (e.g. an invalidated extension context) sustains a serial chain of failing log calls, and each
  pending call keeps polling for a connection (`background/client.ts:112-119`). Sharing creates
  neither; it replaces N per-client connect-retry loops with one, not every outstanding waiter.
- **Service-worker self-connect**: a port client inside the service worker would connect to its own
  context. No service-worker path reaches `documentLogger`: service-worker code imports the client
  modules only with `import type` (e.g. `execution/fee/embedded-fpc-cap.ts:69`,
  `wallet/utils/create-passkey-profile.ts:3`), `wallet/logger/index.ts` does not re-export console
  forwarding, and worker services receive `LoggerStore` (`runtime.ts:450-452`). The memo is lazy, so
  importing the module opens nothing. Phase 2's chunk check also shows which bundles carry it.
- **Account clients (Phase 3)**: `??=` never disconnects a client another flow may hold, so it adds
  no rejection path; the backup-import `finally` closes a client only its own flow uses, after its
  last call settles.
- **Local e2e runs (Phase 4)**: the smoke setup kills only Chromes loaded from this worktree's
  `dist`; a local pool pass (A5) tears down only the process groups it recorded, never processes
  matched by name.
- **Privacy**: log `context` values and payloads are unchanged, so nothing new reaches the log
  viewer or its CSV export.
- **Supply chain**: no dependency or lockfile change.

## Assumptions

### Facts (verified at `c543c18d`)

- **F1** 23 logger construction sites: 20 service-client constructors plus
  `wallet/logger/console-forwarding.ts:12`, `offscreen/index.ts:41` and `:102`.
- **F2** `ServiceClient.disconnect()` closes its own port, rejects pending requests, then logs
  `"Disconnected"` through `this.logger`, and never closes the logger (`background/client.ts:66-78`).
- **F3** A request auto-connects a Disconnected port (`background/client.ts:100-110`,
  `base-client.ts:121`); a remote close runs `disconnect()` then `connect()` (80-83). A request
  timeout settles the request without disconnecting (`base-client.ts:135-137, 261-277`).
- **F4** `ILogger.log` returns `void` (`packages/wallet-core/src/logger/interfaces.ts:30-32`);
  `LoggerServiceClient.log` returns the unawaited request promise (`logger/client.ts:34`).
- **F5** `LoggerServiceClient` and `LoggerService` use `DummyLogger` as their own base logger
  (`logger/client.ts:16`, `logger/service.ts:18`).
- **F6** The service worker's nine `PxeServiceClient`s are built once per worker: the runtime's
  start is single-flight (`runtime.ts:147`) and retry is vetoed before service registration
  (`runtime.ts:230`); `BaseService.start()` alone would not guarantee it (`base-service.ts:64-67`).
- **F7** The service worker's `Service` keeps one `clients` slot per open port and splices it on
  that port's disconnect (`background/service.ts:48-63`); `LoggerService` declares no events.
- **F8** Profile bootstrap rebuilds the network, account and transaction clients, disconnecting the
  old ones (`composables/useProfileBootstrap.ts:58-60, 103-105`, `utils/core.ts:172-179`).
- **F9** The extension's port double never answers a request and throws on any second port with the
  same service name within a test, even after the first disconnected — its `disconnect` is a bare
  `vi.fn()` (`tests/vitest.setup.ts:50-86`). The messaging harness frees the slot on disconnect
  (`packages/extension-messaging/src/testing/transport-harness.ts:74-78`).
- **F10** `createPxeOffscreen` types its logger as `ILogger`
  (`packages/aztec-runtime/src/offscreen/entry.ts:23`).
- **F11** Only `console-forwarding.test.ts` mocks the logger client module, and only
  `logger/client.test.ts` constructs the class; no test captures or emits `logger` port traffic or
  asserts `chrome.runtime.connect` call counts (grep over `apps/extension` and `packages` tests).
  Six test files build real service clients without mocking their modules (e.g.
  `profile/client.test.ts:54`).
- **F12** With the repo's Vite 8.2.1 / Rolldown 1.2.4, a plain `<script setup>` SFC importing a
  name that a `.ts` module exports only as a type fails `vite build` with `MISSING_EXPORT` (probe,
  2026-09-16, `@vitejs/plugin-vue` 6.0.8); neither extension vite config downgrades build logs.
  `vue-tsc` reports the same import in TypeScript files.
- **F13** A port whose document unloads is disconnected, firing `onDisconnect` on the other end
  (Chrome extension message-passing docs, "Port lifetime"; confidence high).
- **F14** The unlock wait is identity-aware and resolves only after bootstrap: `isLogined` flips
  after `runBootstrapCore` (`useProfileBootstrap.ts:155-171, 189-195`;
  `composables/unlockWait.ts:20-22`). Profile creation's poll checks only `isLogined`
  (`new-profile-helpers.ts:24-26`), the popup's profile handler does not clear it first
  (`popup/app.vue:137-142`), and `initAccount` can return without creating a client
  (`useProfileBootstrap.ts:100`).
- **F15** The network-switch handler keeps its own account client across awaits
  (`popup/network-switch.ts:66-73`), obtained from `replaceAccountClient`, which disconnects the
  previous client first (`popup/app.vue:117-121`).
- **F16** CI's network gate is a 5-shard proverless pool with `retry: 0` excluding six files, two
  proverless heavy jobs (fee-methods + selfpay-phase; concurrent-sendtx-confirm) and one prover-ON
  `Run / canary / real-proving` job, aggregated by the required `extension-network-e2e-status`
  (`.github/workflows/pr-extension-network-e2e.yml:123-248`). Every job builds with
  `VITE_NULO_FEE_MULTIPLIER=10`, passes excludes as a bash array, retries the agent once on exit 86
  (an infra boot failure) and fails any other nonzero exit immediately
  (`_extension-network-e2e.yml:122-137, 227-268`).
- **F17** Local e2e teardown: a normal run's global teardown SIGTERMs its groups, waits on each
  group *leader* only (up to 5 s, then SIGKILL) and then deletes `owned.json`
  (`tests/e2e/global-setup.ts:803-819, 827-850`), so the ownership record is gone after a clean
  run; `bun run e2e:reap` SIGTERMs recorded groups without waiting (`tests/e2e/reap.ts:22-36`,
  `tests/e2e/lockfile.ts:113-125`). `resolve-ports.ts` releases its bind probes before the build
  (`scripts/e2e/resolve-ports.ts:187-197`); `agent.sh:50` clears the boot sentinels, and
  `boot-ready` is written only after anvil, the node and the playground are up and contracts are
  deployed (`tests/e2e/global-setup.ts:259-303`); the smoke global setup kills every Chrome loaded
  from its dist path (`tests/e2e/global-setup-smoke.ts:21`).
- **F18** On this repo's vitest under Bun, a `vi.mock` in a setup file applies to every test file,
  a test file's own `vi.mock` of the same module wins, and `vi.unmock` in a test file restores the
  real module (probe, 2026-09-16).
- **F19** wallet-core already exports `LogContext = "sw" | "offscreen" | "popup" | "content"`
  (`packages/wallet-core/src/logger/interfaces.ts:19`), re-exported by the extension logger barrel.

### Inferences (unverified — attack these)

- **I1** A production build holds one memo per document: one Rolldown build over the HTML inputs
  (`vite.config.ts:312-317`) emits each module into exactly one chunk. Not true across vite dev/HMR
  re-evaluation (dev only). Confidence: moderate — Phase 2's sourcemap check turns it into a fact.
- **I2** No production path depends on per-client logger identity, and no borrower disconnects or
  mutates its logger (grep).
- **I3** One port per document adds no user-visible log latency: lines are small and the service
  worker handles `log` synchronously. Unmeasured; low risk.
- **I4** Silencing the document logger in unit tests hides nothing a test checks today (F11); the
  logger's real path stays covered by its own two test files.
- **I5** (v4) The smoke suite is integration execution and UI-regression coverage for the shared
  logger, not a delivery check: it runs the popup's console forwarding and every service client's
  `"Connected"` line through the share in a real Chrome, so a share that throws or breaks a page
  surfaces there. It cannot see a wrong tag or a silently dropped line — the fixture's console
  capture bypasses forwarded application logs (`tests/e2e/fixtures/extension.ts:238-251`) and no
  smoke assertion reads a log line; delivery and tag correctness rest on S1–S4. The network suite
  adds coverage of paths this change does not touch.
- **I6** (v4) A single proverless pool pass, run alone, fits this host; the 2026-09-01 starvation
  came from two sandbox boots overlapping, which a sequential pass never does. Superseded the v3
  launch rule.
- **I7** Keeping an existing account client (`??=`) is behavior-preserving: the client carries event
  handlers and passthrough methods but no profile or network state (`account/client.ts:14-20`),
  reconnects when disconnected, and nothing subscribes to its events (grep).

### Asks (owner decisions — resolved at approval)

**Owner answers (2026-09-17):** A1 follow-ups · A2 yes · A3 fold in (Phase 3 runs) · A4 accept ·
A5 none (smoke locally; the PR's CI runs the network suite — the pool-pass scripts stay documented,
unused). Codex closure check: approve for this scope.

- **A1** Keep as follow-ups, not scope: client-side debug-level gating, and one shared fake-port
  harness. **Recommended: follow-ups.**
- **A2** Leave the prover-ON canary files (`transfers`, `tx-sendTx-default`,
  `frozen-account-canary`) to the PR's CI: delivery requires `gh pr checks` to show the
  `Run / canary / real-proving` job itself passed — not skipped. Locally they are excluded exactly as
  in CI's proverless pool. **Recommended: yes** — no proving code changes.
- **A3** Fold the three outer account-client leaks (Phase 3: two `??=` edits, one `finally`, three
  tests) into this PR, or leave them as a follow-up. **Recommended: fold in** — same bug class, same
  triggers (unlock, profile creation, backup import), small and independently tested; without it
  the PR must not claim unlock or import port growth is fixed.
- **A4** Accept today's logging-failure behavior unchanged: rejected log calls are re-logged by the
  page handlers, and pending calls keep polling for a connection (see Security).
  **Recommended: accept** — this change does not cause it.
- **A5** (v4) Local network e2e before the PR: **none** (smoke locally, the PR's required network
  gate decides), or **one sequential pool pass** (CI's five shards back to back, its six excludes,
  proverless, retry 0, in this worktree, nothing else running). This revises the Phase 0 answer
  "local network e2e with shards". **Recommended: none** — the CI gate runs the identical partition
  on the same commit; the change touches no network path; the host's own record says the suite
  mass-fails under concurrent load, so the only safe local pass is the slow one.

## Phases

One arc, one PR. Each phase ends with its validation gate; a phase is ✓ only when its gate passes.
Run every command from the worktree root. After each step inside a phase, run `bun run lint` and
the touched test file; run full unit suites, builds and e2e alone, never beside each other or codex.

### Phase 1 — prove the leak ✓

1. Write `apps/extension/src/wallet/services/logger/client.ports.test.ts` with the counting stub and
   S1–S2 (proof mechanics above; they need only today's service clients), asserting the fixed
   expectations: one live, one cumulative `logger` port, the same object throughout. S3 and S4
   need `documentLogger` and join in Phase 2.
2. Run it; S1 and S2 must fail on today's code on their port counts (five and fifty). Paste the
   failing assertions into `lessons/phase-1.md` — that record, not a pin, is the proof of the leak.
3. Do not commit: a red test never lands in history. Phase 2 commits the test with the fix.

**Validation gate** (layers: unit, lint)

- `bun run --cwd apps/extension test src/wallet/services/logger/client.ports.test.ts` reports S1
  and S2 red on port counts (5 and 50 live ports) and red for no other reason.
- `bun run lint` exits 0.
- `lessons/phase-1.md` holds step 2's red output.

### Phase 2 — one logger per document ✓

1. `logger/client.ts` as in Key interface.
2. The 20 service-client constructors, `console-forwarding.ts` (void return, `"popup" | "onboarding"`),
   `offscreen/index.ts` (two sites).
3. The silent-logger mock in `tests/vitest.setup.ts`; `vi.unmock` + `beforeEach` reset in
   `logger/client.test.ts` and the proof test; adapt `console-forwarding.test.ts`; fix the
   `logger/service.ts:8-10` comment.
4. Add S3 and S4 to the proof test and run it: S1–S4 green. Paste the summary into
   `lessons/phase-2.md`.
5. `ARCHITECTURE.md` §3: one sentence.
6. One-time chunk check (not committed), from the worktree root: a sourcemap build, then a count of
   the emitted maps whose `sources` include the logger module (each match is printed). Record the
   output in `lessons/phase-2.md`.

   ```bash
   cd apps/extension && NODE_OPTIONS=--max-old-space-size=16000 node_modules/.bin/vite build -c vite.chrome.config.mts --sourcemap; cd ../..
   bun -e 'const fs = require("node:fs"); const dir = "apps/extension/dist/chrome/"; let n = 0; for (const f of new Bun.Glob("**/*.map").scanSync(dir)) { const m = JSON.parse(fs.readFileSync(dir + f, "utf8")); if (m.sources?.some((s) => s.endsWith("wallet/services/logger/client.ts"))) { n++; console.log(f) } } console.log("maps=" + n)'
   ```

**Validation gate** (layers: typecheck, unit, lint, build)

- `bun run typecheck:all && bun run test:all && bun run lint && bun run build` exits 0.
- `bun run --cwd apps/extension test src/wallet/services/logger/client.ports.test.ts` passes with S1
  and S2 at one live, cumulative and identical `logger` port, zero local logger disconnects, zero
  live ports for S2's cycled service, S3 and S4 green.
- `git grep -n "new LoggerServiceClient(" -- apps packages` prints only the one line in
  `apps/extension/src/wallet/services/logger/client.ts`.
- Step 6 prints `maps=1`, and that map is not the service worker's.
- `lessons/phase-2.md` holds step 4's summary and step 6's result.

### Phase 3 — outer account clients (A3 = fold in) ✓

The owner chose fold in (2026-09-17): this phase runs.

1. Write each test first and see it fail on today's code:
   - `new-profile-helpers.test.ts`: an existing `managers.account` is kept — the constructor is not
     called, that client's `getAccounts` is used, and the flow reaches `router.push` (reset
     `managers.account` per test; the mocked `managers` object persists across the file).
   - `auth.test.ts`: a successful unlock keeps a `managers.account` set before it (same instance, no
     `AccountServiceClient` constructed) and still completes its continuation
     (`initTransactionService` called).
   - `useFullBackupImport.test.ts`: with `reconcileImportedAccounts` held pending, `accountClient.disconnect`
     has not run; after it resolves (and, in a second case, rejects) and microtasks drain,
     `disconnect` has run exactly once.
2. Apply the three changes from the Phase 3 table.

**Validation gate** (layers: typecheck, unit, lint)

- `bun run --cwd apps/extension test src/popup/pages/auth.test.ts src/popup/pages/profile/new-profile-helpers.test.ts src/composables/useFullBackupImport.test.ts src/composables/useFullBackupImport.stages.test.ts`
  exits 0 with the new tests green.
- `bun run typecheck:all && bun run lint` exits 0.
- `lessons/phase-3.md` notes each new test's red run before its fix.

### Phase 4 — local smoke; the PR's CI runs the network suite ✓

**Candidate.** `git status --porcelain` prints nothing; record `CANDIDATE=$(git rev-parse HEAD)` in
`lessons/phase-4.md`.

1. **Smoke**, in this worktree, with nothing else of this plan's running (its global setup kills
   Chromes loaded from this dist):
   `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:chrome`,
   then `NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e`. The smoke suite
   drives the real popup: its console forwarding and every service client's `"Connected"` line go
   through the shared logger (I5).
2. **A red smoke test**: re-run the file once alone; red again → check it out at `c543c18d` in a
   sibling helper worktree
   (`git worktree add --detach "$(git rev-parse --git-common-dir)/../.claude/worktrees/owned-client-teardown-baseline" c543c18d`,
   `bun install --frozen-lockfile`, the same build and run); the same test failing the same way
   is pre-existing (record it, the PR body names it); anything else is **blocked**. Remove the
   helper worktree afterwards (`git worktree remove <path>`).
3. **Network**: the PR's required `extension-network-e2e-status` runs CI's full partition at
   retry 0 on this commit (F16); the plan runs none of it locally unless A5 = pool pass.
4. **If A5 = pool pass** — one sequential run of CI's proverless pool, in this worktree, alone:
   - Write the two scripts below into the worktree's ignored `.playwright-mcp/`, `chmod +x` them,
     and launch the pool by absolute path inside tmux
     (`tmux new-session -d -s e2e-pool "$PWD/.playwright-mcp/e2e-pool.sh"`) — a worktree-isolated
     session refuses `bash <script>`, and the tool shell is zsh. Watch `.playwright-mcp/e2e-pool.log`
     with a Monitor matching the vitest summary, failures and the `EXIT=` / `VERIFY=` lines.
   - `e2e-pool.sh` runs one shard at a time, `1/5` … `5/5`, each as its own attempt
     (`e2e-run.sh <label> <k>`): CI's six excludes as a bash array,
     `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 VITE_NULO_FEE_MULTIPLIER=10`, `HEAD=` per attempt, a
     **fresh** ownership snapshot per attempt (`owned-<label>.json`, copied each second while the
     agent runs — only when the record's `startedAt` postdates this attempt's `LAUNCHED`, so a
     stale record from an earlier attempt is never mistaken for this one — because the runner
     deletes the original on clean exit, F17), the watcher stopped and waited for, and — **before
     the next attempt starts** — that attempt's teardown verified by `e2e-verify.sh <label>
     <launched>`: every recorded process group gone within 30 s (SIGKILL and re-check otherwise),
     no Chrome loaded from this worktree's dist, and a snapshot that is present, valid JSON, and
     from this attempt whenever the attempt's `boot-started` sentinel exists — a missing, stale or
     unparseable record is a failed verification, not a pass. A failed verification stops the
     pool; survivors go into the lessons table.
   - **Classify each nonzero `EXIT=`**: `86` (infra boot failure) → re-run that shard once, alone,
     as `<k>-retry`; a second 86 is an infra blocker to surface. Any other nonzero → re-run that
     whole shard once, alone, as `<k>-rerun`; green → a **local exception (flaky)**, red again →
     **blocked** until the failure is understood (the PR's retry-0 CI is the arbiter either way; a
     local exception is recorded in `lessons/phase-4.md` and the PR body, never counted as a pass).
     Re-runs go through the same `e2e-run.sh` + `e2e-verify.sh` pair.
   - Close out with `bun run e2e:reap` in this worktree.

```bash
#!/usr/bin/env bash
# .playwright-mcp/e2e-run.sh <label> <k> — one proverless pool shard (k of 5), alone, then verified.
set -u
label=$1; k=$2
root=$(git rev-parse --show-toplevel)
cd "$root" || exit 2
mkdir -p .playwright-mcp
log=".playwright-mcp/e2e-$label.log"
rec=".playwright-mcp/owned-$label.json"
rm -f "$rec"
launched=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf 'HEAD=%s\nLAUNCHED=%s\nSHARD=%s\n' "$(git rev-parse HEAD)" "$launched" "$k" > "$log"
excludes=()
for f in fee-methods selfpay-phase concurrent-sendtx-confirm transfers tx-sendTx-default frozen-account-canary; do
  excludes+=(--exclude "tests/e2e/network/$f.test.ts")
done
# Copy only a record THIS attempt wrote: `startedAt` (ISO 8601, sorts lexically) after LAUNCHED.
( while :; do
    if [ -f apps/extension/.e2e-state/owned.json ]; then
      started=$(jq -r '.startedAt // empty' apps/extension/.e2e-state/owned.json 2>/dev/null)
      [ -n "$started" ] && [ "$started" \> "$launched" ] && cp apps/extension/.e2e-state/owned.json "$rec"
    fi
    sleep 1
  done ) &
watcher=$!
NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 VITE_NULO_FEE_MULTIPLIER=10 bun run e2e:agent "${excludes[@]}" --shard="$k/5" >> "$log" 2>&1
echo "EXIT=$?" >> "$log"
kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null
"$root/.playwright-mcp/e2e-verify.sh" "$label" "$launched" >> "$log" 2>&1
echo "VERIFY_EXIT=$?" >> "$log"
```

```bash
#!/usr/bin/env bash
# .playwright-mcp/e2e-pool.sh — CI's five pool shards back to back; stops on a failed teardown.
set -u
root=$(git rev-parse --show-toplevel)
cd "$root" || exit 2
log=".playwright-mcp/e2e-pool.log"
: > "$log"
for k in 1 2 3 4 5; do
  "$root/.playwright-mcp/e2e-run.sh" "$k" "$k"
  grep -E '^(HEAD|SHARD|EXIT|VERIFY_EXIT|RECORD)=|SURVIVOR|STILL ALIVE|CHROME LEFT' ".playwright-mcp/e2e-$k.log" | sed "s/^/[$k] /" >> "$log"
  if ! grep -q '^VERIFY_EXIT=0$' ".playwright-mcp/e2e-$k.log"; then echo "POOL=stopped after shard $k (teardown unverified)" >> "$log"; exit 1; fi
done
echo "POOL=done" >> "$log"
```

```bash
#!/usr/bin/env bash
# .playwright-mcp/e2e-verify.sh <label> <launched-iso> — after every attempt, its watcher stopped,
# before anything else starts.
set -u
label=$1; launched=$2
root=$(git rev-parse --show-toplevel)
cd "$root" || exit 2
rec=".playwright-mcp/owned-$label.json"
status=0
if [ -f "$rec" ]; then
  started=$(jq -r 'select(.pids | type == "object") | .startedAt // empty' "$rec" 2>/dev/null)
  if [ -z "$started" ] || ! [ "$started" \> "$launched" ]; then echo "RECORD INVALID or from an earlier attempt"; status=1; fi
elif [ -f apps/extension/.e2e-state/boot-started ]; then
  echo "RECORD MISSING but boot started"; status=1
fi
pids=""
[ -f "$rec" ] && pids=$(jq -r '.pids[]? // empty' "$rec" 2>/dev/null)
for pid in $pids; do
  for _ in $(seq 30); do kill -0 -- "-$pid" 2>/dev/null || break; sleep 1; done
  if kill -0 -- "-$pid" 2>/dev/null; then
    echo "SURVIVOR group $pid: SIGKILL"
    kill -KILL -- "-$pid"
    sleep 3
    kill -0 -- "-$pid" 2>/dev/null && { echo "STILL ALIVE group $pid"; status=1; }
  fi
done
if pgrep -af "[l]oad-extension=$root/apps/extension/dist"; then echo "CHROME LEFT"; status=1; fi
echo "RECORD=$([ -f "$rec" ] && echo present || echo missing) VERIFY=$status"
exit $status
```

`e2e-run.sh` and `e2e-verify.sh` descend from v3's scripts, which were dry-run on this host (a
stubbed agent; a detached process group killed and confirmed gone); the per-attempt snapshot,
the in-script verification and the pool loop are new and must be dry-run the same way (a stubbed
`e2e:agent` that writes a fake `owned.json` and a `boot-started` sentinel) before the real pass.

5. **Record** in `lessons/phase-4.md`: `CANDIDATE`, the smoke result (and any baseline comparison),
   and — if A5 = pool pass — one row per attempt: label, `HEAD=`, `EXIT=`, the vitest file
   summary (passed / failed / skipped), classification, `VERIFY=`.

**Validation gate** (layers: smoke e2e; network e2e only if A5 = pool pass)

- The smoke run exits 0, or every red file is a recorded pre-existing failure from step 2.
- If A5 = pool pass: each shard has `EXIT=0` or a recorded local exception; nothing is blocked;
  every attempt's `HEAD=` equals `CANDIDATE` and its `VERIFY_EXIT=0`; the pool log ends
  `POOL=done`; the attempt logs show exactly CI's six excludes and no prover-ON canary file ran
  (A2); `bun run e2e:reap` ran.
- No helper worktree remains.

## Post-implementation (self-contained; executed by the implementing session)

`code_review` is `off`: do NOT run `/code-review` (owner directive). The codex loop is the review.

1. **Codex audit** (`/codex` at `high`, via `~/.claude/skills/codex/scripts/run-codex.sh` launched
   inside tmux — background Bash codex runs get killed on this host; never `codex exec` directly).
   Send: the whole diff from `c543c18d`, this plan (including the decision ledger), the adversarial
   / security ask from the Security section, and both rules below verbatim. Tell codex not to run
   tests, builds or any vitest e2e config (a reviewer's smoke run kills other Chrome processes).
2. **Iterate**: verify each finding against the repo first; apply the accepted fixes; commit
   (signed); log the round (consult + verdict) in `lessons/post-impl.md`; resume the same codex
   session with the fix diff. Repeat until a round yields no new material findings. Still material
   after three rounds → stop and surface to the owner.
3. **Re-validate**: if any loop fix touched runtime code (not comments or tests), re-run the Phase 2
   gate, the Phase 3 test files (if Phase 3 ran) and the smoke run before delivery; the PR's CI
   re-runs the network suite.
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

## Delivery

| Arc | Phases | Branch | Stacks on | `/code-review` |
|---|---|---|---|---|
| one logger per document (+ account clients if A3) | 1, 2, 3, 4 | `worktree-owned-client-teardown` | `dev` | off |

Single arc: after the codex loop converges, push the branch (after `bun run test:all` and
`bun run lint` pass) and `gh pr create --base dev` with the title
`fix(extension): stop leaking messaging ports from loggers and account clients` (77 characters) if
A3 = fold in, else `fix(extension): one logger port per document instead of one per service client`
(78) — both within the 93 budget. Body: what changed, the proof's before/after port counts, the
gate evidence, any Phase 4 local exceptions, the follow-ups, ending with the Claude Code attribution
line. Then `gh pr checks <n> --watch`. The PR trips the smoke and network filters; the required
`extension-network-e2e-status` aggregates the prover-ON `Run / canary / real-proving` job, and
`gh pr checks` must show that job itself passed, not skipped (A2). A red required check is a flake
to re-run or breakage to fix, never neutralised. Merging is the owner's call.

## Autonomy

- Never merge, never push to `dev` or `main`, never publish or deploy.
- Never expand scope beyond this plan; the follow-ups stay follow-ups.
- Codex is advisory: it cannot override the owner's answers, this plan's scope or a hard limit.
- Commits stay signed (the homelab key is non-interactive).
- Kill only process groups recorded by this plan's runs (Phase 4); never pattern-kill anvil, aztec
  or Chrome by name.

## Audit verdicts

- **Codex** (GPT-6 Astra, `high`, plan v1; `audit-codex.md`): `conditional approve (with conditions:
  fix test isolation, strengthen the port-count proof, and correct the e2e execution and cleanup
  gates)`. Design pick: lead — document-scoped sharing fixes the growth without putting logger
  ownership and asynchronous draining into every client's reconnect state machine.
- **Claude** (Opus 5 1M; the Fable 5.1 attempt hit its usage limit; plan v1; `audit-fable.md`):
  `conditional approve (with conditions: make the local network gate mirror CI's lanes and fix its
  shard sequencing; add an Ask for the three outer account-client port leaks instead of implying
  unlock/import port growth is gone; correct the claim that the private constructor covers .vue
  files, or strengthen the guard; make the proof test's S4 and post-reset imports safe)`. Design
  pick: lead — fixes the ownership bug without touching the shared reconnect state machine.
- **Codex, fresh session** (GPT-6 Astra, `high`, plan v2 + ledger; `audit-codex.md`, round 2):
  `conditional approve (with conditions: close the test-isolation and proof gaps, correct Phase 4
  cleanup and scheduling, and tighten failure classification)`. Design: agree — document-scoped
  sharing fixes the ownership error without changing the messaging state machine. Every condition
  is folded into v3 (D6, D15, D18–D25); the one it is not satisfied the way codex proposed is D18.
- **Claude** (Fable 5.1, plan v3 review; `audit-fable.md`, round 2): `conditional approve on
  Phases 1–3; cut Phase 4 to smoke + CI`. Applied as v4: one port per document through
  context-bound views (D27), no pin-then-flip (D28), the third fake-port double accepted
  explicitly (D29), Phase 4 = smoke with the PR's CI as the network gate and a sequential pool pass
  as Ask A5 (D26, which sides with codex on D18). Also surfaced that the silent-logger mock retires
  a pre-existing 1 s connect-retry loop in unit tests.
- **Codex, round 3** (GPT-6 Astra, `high`, plan v4; `audit-codex.md`, round 3): `conditional
  approve (with conditions: repair S3's rejection-observation seam, settle redaction-test requests,
  fix A5's per-run cleanup verification if selected, and reconcile stale instructions)`. Agreed
  with D26–D29 (D26 "subject to owner approval"); found no regression class a local network run
  would catch that CI's partition would not. All four conditions folded in (D30–D33).
- **Codex, closure check** (the round-3 session resumed with the folded plan and the owner's
  A1–A5): `approve` — conditions 2–4 satisfied, the stale instructions reconciled; one remaining
  Med on the unselected A5 script (snapshot provenance, watcher racing the verifier), fixed the
  same day in D31.

### Decision ledger

| # | Decision | Source | Outcome | Why |
|---|---|---|---|---|
| D1 | Lead design (one logger per document) over the competing outline | codex, Claude, fresh codex | adopted | No state-machine change; one replacement port per document on a worker restart (per context until D27); independent of cleanup order. The outline needs a split reconnect path and a drain tail, and leaves three offscreen loggers. |
| D2 | Module function + unexported class instead of a static factory + private constructor | Claude #3; fresh codex upheld | adopted | The private constructor misses 149 JS SFCs; an unexported class makes the import a build error there too (F12). An API boundary, not a security boundary. |
| D3 | A context union instead of `string` | codex #5 | adopted | Names the three tags a document can put on the wire; named per D22 (bounded the per-context memo until D27 removed it). |
| D4 | `installConsoleForwarding` returns `void` | Claude #6 | adopted | Only a test read the return value. |
| D5 | `_resetDocumentLoggerForTests()` (v3 name: plural), reset per test in both logger test files | codex #1 | adopted | Tests that observe the real logger start from a fresh instance. |
| D6 | Keep unrelated unit tests off the real document logger | codex #1, fresh codex #4 | adopted, reversing v2 | v2 rejected per-file mocks; the fresh pass showed a stale singleton in real-client tests. Adopted as one setup-file `vi.mock` returning a silent logger (covers tests that build clients through mounted code too), with `vi.unmock` in the two logger test files (F18). |
| D7 | Global memo reset in `tests/vitest.setup.ts` | driver | rejected; fresh codex agreed | It would import the module, and a setup-imported module can't be mocked later. |
| D8 | `vi.resetModules()` + dynamic imports in the proof test | v1 | rejected; fresh codex agreed | Re-evaluates inlined `@nulo/*` (Claude #4b) and disposes nothing (codex #1). |
| D9 | Proof hardening: envelope validation, per-port answers, closed ports throw, drain + zero pending, S3 awaits the held line's rejection, red-first both ways | codex #2, Claude #4a/c/d | adopted; "both ways" superseded by D28, the S3 seam by D30 | Counts alone could pass with broken borrowers; an unobserved rejection fails vitest. Completed by D21. |
| D10 | Local network runs use CI's partition: 5-shard pool with CI's six excludes, heavy files apart, `NULO_E2E_RETRY=0`, fee multiplier 10, exit 86 retried once | codex #3, Claude #1 | adopted | v1's `--shard=K/3` recombined lanes CI separates and ran canaries on fake proofs. Scheduling in D18, failure policy in D19. |
| D11 | Verified cleanup after local runs | codex #4 | adopted | `e2e:reap` only sends SIGTERM (F17). Completed by D20. |
| D12 | Qualified security claims + Ask A4 | codex #6 | adopted; the encapsulation clause superseded by D27 | `trim()` is synchronous and the rejection-logging chain exists today (still true). "`ILogger` hides, not removes, `disconnect()`" described the memoised client; a view holds no client to reach. Completed by D23. |
| D13 | Outer account-client leaks surfaced as Ask A3 with a ready Phase 3 | Claude #2 | adopted as an Ask | Outside the owner's "inner client" scope. |
| D14 | `??=` instead of disconnect-then-replace for the auth and profile-creation clients | driver, after Claude #2; fresh codex upheld | adopted | A disconnect could reject a concurrent network switch's calls (F15); keeping the client changes nothing observable (I7). Justification no longer leans on F14. |
| D15 | Check the emitted chunk graph for a duplicated logger module | codex (v1, on I1), fresh codex | adopted, reversing v2 | v2 argued minified names leave nothing to grep; sourcemap `sources` do. One extra build in Phase 2 turns I1 into a fact. |
| D16 | Idempotent port `disconnect()` follow-up | v1 A1 | dropped; fresh codex agreed | Latent; nothing disconnects twice. |
| D17 | Fact and inference corrections: F2 wording, F6 reasoning, nine PXE clients, F9, F12, the passkey claim, the side panel, I1's lifetimes | codex, Claude | adopted | Corrected here and in `recon.md`. |
| D18 | Phase 4 scheduling: two pool lanes whose port-allocation and boot windows never overlap, capacity and foreign-sandbox checks before overlapping, heavy runs and re-runs alone, fall back to sequential on contention | fresh codex #2 (proposed all-sequential) | adopted with a different fix | Codex's sequential run is the safe floor; the owner's standing directive asks for concurrent shards. Serialising allocation-to-boot closes the collision window codex identified (I6); the fallback covers boot starvation (I5). **Disagreement with codex** — the owner may choose sequential at the gate. |
| D19 | Failure classification: one candidate SHA for every run; re-run the whole workload, not the file; "pre-existing" only on the same failures in a baseline run; local exceptions labelled as such; anything unclassified blocks | fresh codex #3 | adopted for the A5 pool pass (whole shard re-runs); smoke re-runs its red file, then compares it at the baseline | A green isolated file re-run could hide an ordering regression in a sharded network run; smoke files are independent, so a file re-run is the honest unit there. The baseline-worktree comparison survives only for smoke (D26). |
| D20 | Capture each run's ownership record while the run is alive and verify group disappearance after every run, including failed boots, retries and SIGKILL escalation | fresh codex #1 (High); re-asserted by codex round 3 #1 | adopted; applies to every A5 attempt | Clean teardown deletes `owned.json` and waits only on group leaders (F17), so a post-run read was vacuous. v4's first draft snapshotted once for the whole pool and verified at the end, which let a shard-1 survivor vanish from the evidence; D31 restores per-attempt capture and verification. |
| D21 | Continuity in the proof (cumulative opens, one port identity, zero local disconnects, every wire tag) and ordering in Phase 3 tests (disconnect only after reconcile settles; auth's continuation proven) | fresh codex #5 | adopted | Auto-reconnect lets a borrower close the shared port without failing delivery or live-count assertions. |
| D22 | Name the union `DocumentLogContext` | fresh codex #6 | adopted | wallet-core already exports a different `LogContext` (F19). |
| D23 | Corrections: F14 weakened, check names (`extension-network-e2e-status`), F17 teardown facts, encapsulation and memo bounds as TypeScript contracts (superseded by D27: no memo, no client in the borrower's hands), availability of a connected-but-unresponsive port, A2 requires the canary job itself, A4 includes connection polling | fresh codex | adopted | Verified against the cited code. |
| D24 | `/loop` seed follows Phase 4's launch rule and pushes only after `test:all` + `lint` | fresh codex | adopted | v2's seed contradicted Phase 4 and the push rule. |
| D25 | Phase 4 command fixes: sibling helper worktrees (a relative path nested them), excludes as a bash array in an executable script launched by absolute path (zsh would not split `$EXCL`; a worktree-isolated session refuses `bash <script>`), a bracketed `pgrep` pattern, `kill -- -<pgid>` | driver during the fresh pass, fresh codex #2 | adopted | Each command as v2 wrote it would have misbehaved; the scripts and the Phase 2 chunk counter were dry-run on this host. |
| D26 | Phase 4 = local smoke + the PR's CI network gate; a local network pass becomes Ask A5 (none, or one sequential pool pass, alone) — supersedes D10's local replay and D18's lanes | Fable review #1 | adopted, revising the Phase 0 validation answer | CI's required gate runs the identical partition at retry 0 on the same commit; the change touches no network, PXE or dApp path; the host's record says the suite mass-fails under concurrent load — so codex's D18 objection stands, and the only safe local pass is the slow one. The owner confirms at the gate. |
| D27 | One shared client with context-bound `ILogger` views, instead of one memoised client per context | Fable review #2; codex round 1 #5 suggested the views | adopted | `ILogger` is one method; a view is three lines. One port per document instead of two; no `Map`, no union-keyed memo; a borrower cannot reach the client even by cast. |
| D28 | No `(BUG PIN)` pin-then-flip; the red run recorded in lessons is the proof of the leak | Fable review #3 | adopted, revising D9's "red first, both directions" | The pin convention preserves behavior across a PR; pinning counts this PR fixes is churn. Phase 1 leaves the red test uncommitted; Phase 2 commits test and fix together. |
| D29 | The proof test's counting stub is a third fake-port double, accepted explicitly | Fable review #4 | adopted | Both existing doubles are single-slot-per-service (a second same-name port throws) — the opposite of what a leak proof observes — and extending either changes the contract their transport suites rely on. Ask A1's consolidation follow-up now covers three. |
| D30 | The view returns the request promise instead of dropping it; S3 observes the rejection through a test-only cast | codex round 3 #2 | adopted | vitest runs under jsdom, where a runtime rejection never becomes a `PromiseRejectionEvent`, so "observe it through the page handler" could not work; `ILogger.log`'s `void` accepts a returned promise, and no production caller consumes it. Handler demotion stays covered by `console-forwarding.test.ts`'s synthetic events. |
| D31 | A5 pool pass: one attempt per shard with its own ownership snapshot, copied only when its `startedAt` postdates the attempt, the watcher stopped before verification; verified before the next attempt starts; a missing, stale or invalid snapshot after `boot-started` fails verification; the pool stops on a failed verification | codex round 3 #1 (High); provenance + watcher race from the closure check | adopted | The first v4 script overwrote one snapshot across five shards and verified once at the end, so a survivor from an earlier shard could be replaced in the evidence and a missing capture still printed `VERIFY=0` — the hole D20 closed, reopened. |
| D32 | Both real-logger test files answer every request and settle before resetting the shared client; the redaction test keeps its positive assertions by decoding the captured wire params | codex round 3 #3 | adopted | The transport arms timeout and warning timers per request (`base-client.ts:131-151`) that the reset does not clear; today's redaction helper returned an already-resolved promise and never touched the transport. |
| D33 | I5 restated: smoke is integration execution and UI regression, not delivery or tag verification — those rest on S1–S4 | codex round 3 #4 | adopted | The e2e fixture's console capture bypasses forwarded application logs (`tests/e2e/fixtures/extension.ts:238-251`); a wrong tag or a dropped line leaves every UI assertion green. Codex found no regression class a local network run would catch that the required CI partition would not, so D26 stands. |

**Still disputed**: none. D18's disagreement is resolved in codex's favour by D26 (sequential if
any local pass runs); the owner may still choose a local pass at A5. Codex round 3 agreed with
D26–D29 and its six findings are D30–D33 plus the Phase 1 and seed wording fixes.

## Follow-ups

- Client-side level gating for debug log lines (Ask A1).
- One shared fake-port harness for `apps/extension`'s global stub, the proof test's counting stub
  and `packages/extension-messaging`'s transport harness (Ask A1, D29).
- Profile creation's activation poll checks only `isLogined` (F14); an identity-aware wait like
  unlock's would close it.
- If A3 = follow-up: the three outer account-client leaks (Phase 3 as written).

## Seeds (final — A3 fold in, A5 none)

Use exactly one per session; they don't compose. Run it inside this worktree
(`agent-worktree resume owned-client-teardown`), in the permission mode you intend, so no prompt
stalls it. The ELI5 companion (`eli5.html`; Artifact URL in the front matter) carries the same two
strings with copy buttons.

**Recommended: `/goal`** (every completion signal is visible in the transcript)

```
/goal All phases marked ✓ in implementations-plan/owned-client-teardown/plan.md (the phase headers in the file, not the chat or the task list; all four phases including Phase 3 — the owner chose A3 = fold in — and Phase 4 as smoke only, the owner having chosen A5 = none), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent printed `LESSONS_FILE=implementations-plan/owned-client-teardown/lessons/phase-N.md`; plan.md says `code_review: off`, so `/code-review` was NOT run; the codex fix loop converged over the whole diff from c543c18d, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; exactly one PR into dev exists for branch worktree-owned-client-teardown, created only after the loop converged (`gh pr view` output in the transcript), and `gh pr checks` shows every required check green with the Run / canary / real-proving job itself passed; `bun run test:all` and `bun run lint` both report exit 0 in the transcript.
```

**Alternative: `/loop`**

```
/loop 15m Drive implementations-plan/owned-client-teardown forward. Never idle waiting for my input. Each firing:
1. Reality check: read plan.md and lessons/ (authoritative, not the chat); rebuild the task list from plan.md if empty; `git status`, `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup`.
2. Waiting on CI or a Phase 4 run is fine — confirm it progresses (tmux session alive, its log growing; `gh run watch` up to 10 minutes); use the wait to review the diff. One e2e run at a time, and never codex, audit:vue, a full unit suite or a build beside it.
3. No task in hand? Take the next pending step from plan.md. After each meaningful edit run `bun run lint` and the touched test file; commit (signed) — except Phase 1's red proof test, which stays uncommitted until Phase 2 commits it with the fix. Push the branch only after `bun run test:all` and `bun run lint` pass.
4. Stuck, or facing a decision you'd bring to me? Consult `/codex` at high (run-codex.sh inside tmux) until you reach a defensible decision; log consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, never push to dev or main, never publish, never expand scope, never kill processes outside this plan's ownership records.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue on the agreed path.
6. Phase green = its validation gate in plan.md passes. Paste the result, mark ✓ in plan.md, write the lessons entry, print `LESSONS_FILE=implementations-plan/owned-client-teardown/lessons/phase-N.md`, run `agent-worktree status owned-client-teardown "phase N green: <next>"`, advance.
7. All phases ✓? `code_review` is off — skip /code-review. Run the codex loop per plan.md's Post-implementation section (whole diff from c543c18d, adversarial ask, no-over-engineering + comment-quality rules, resume until a round yields nothing material; still churning after 3 rounds → surface and stop). Re-validate if runtime code changed. Then `gh pr create` per the Delivery section and `gh pr checks --watch` until every required check is green and the canary job itself passed (re-run a flake; fix breakage). Write the wrap-up: what shipped, every decision codex and I debated with ELI5 context, open items. Surface and stop.
```
