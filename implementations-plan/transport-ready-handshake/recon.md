# Recon — transport ready-handshake + SW-death debt (phase 0.4, deep tier) — PARKED

> **Status: PARKED by owner decision 2026-08-18** before any planning leg ran.
> Four read-only scouts completed against dev @ `3e3bd129`; their findings are
> consolidated here so a future un-parking session starts from this map instead
> of re-paying the exploration. The normative spec this arc would implement is
> UNCHANGED and lives in `implementations-plan/deflake-round-4/fix-plan.md`
> (decision-ledger rows 1, 6) + `recon-fixes.md` §B + the two OPEN entries in
> `implementations-plan/e2e-deflake/flake-ledger.md`. Line numbers below are
> exact at `3e3bd129` and will drift.

## A. Transport surface (`packages/extension-messaging`)

**Client state machine** (`src/background/client.ts`):
- `ClientState` enum :152-157 — `Connecting / Connected / Disconnecting /
  Disconnected`. `Connecting` is near-instantaneous today; the name already
  matches the rework's "port open, awaiting Ready" meaning.
- `connect()` :45-64. Reentrancy guard :45-48 (`state !== Disconnected →
  return`) — already a correct single-flight gate. Body: `chrome.runtime.connect()`
  → attach listeners → **immediately** `Connected` + `onConnected.invoke()`
  (:55-57) before any byte returns. Catch-retry loop :59-62 is a flat
  `sleep(1000)` forever — **no backoff helper exists anywhere in the repo**
  (grep-confirmed); capped backoff would be written fresh.
- `ensureTransportReady()` :101-111 — returns `void` **synchronously** when
  `Connected`; `base-client.ts:115-121` only awaits a truthy return. This is
  the synchronous-send fast path to preserve (contract: "void when actually
  ready").
- `waitForConnection()` :113-121 — 300ms poll, **no self-cap**; bounded only
  by each caller's deadline race. `implementations-plan/fix-transport-sessions/plan.md:85`
  flags this as the B-16 "leaked retry loop remains" follow-up — the rework's
  natural home to close it.
- `onDisconnect` :80-83 — `disconnect(); connect()`. Reads **nothing** from
  `chrome.runtime.lastError` (the churn gap). Minimal fix shape: an inline
  read mirroring `apps/extension/src/core/adapters/chrome-browser-api.ts:136-140`.
  Do NOT adopt `wallet-core/src/ports/runtime-port.ts` (`RuntimePort`,
  lastError getter :50-54) — its doc claims ServiceClient use but
  extension-messaging has ZERO references to it (stale/aspirational doc);
  adopting it would add a cross-package dep + constructor change the harness
  (which stubs the raw `chrome` global) doesn't support.
- `sendEnvelope()` :123-131 — `AUDIT A5` local-port capture (racing
  onDisconnect nulls `this.port`); mirror this shape in new send code.
- `disconnect()` :66-78 → `rejectAllPending(() => makeDisconnectError(), ...)`.
- `reservedEventNames` :36 = `{onConnected, onDisconnected}`; enforced at
  `core/base-client.ts:229-236` (non-EventHandler or reserved wire events
  dropped); pinned `core/hardening.test.ts:155-168`. Any new lifecycle
  EventHandler must join the Set.
- Timeouts: `DEFAULT_RPC_TIMEOUT_MS = 60_000` :16 (30s was too tight for PXE);
  `WARN_AFTER_MS = 10_000` :19; timers wired `base-client.ts:134-142`.

**THE design-shrinking find**: `base-client.ts` B-15 machinery —
`request()` :101-186 + `awaitReadyWithinDeadline` :277-295 — already
implements "wait for readiness, bounded by the call's own deadline."
Redefining `ensureTransportReady()` to gate on Ready (not just Connected)
yields pre-Ready queuing **with zero new queue data structure**: never-sent
calls are structurally the ones still awaiting readiness; sent calls are the
ones in the pending map. Each queued call still fails safely at its own
deadline if Ready never arrives.

**Sent-never-replayed is already the status quo**: `settle()`
(`base-client.ts:255-271`, idempotent) and `rejectAllPending` (:239-243) only
ever reject; no requeue/replay path exists. The rework pins this (send-count
pins), it does not build it.

**Send-failure error**: `makeSendFailureError()` `base-client.ts:323-331` →
`RpcDisconnectedError`, constructed at exactly **one production site** (:326),
reached from `request()`'s sync-throw (:176-183) and async-rejection
(:167-174) paths. This is precisely the "never-sent call" class the queue
replaces.

**Service side** (`src/background/service.ts`, `core/base-service.ts`):
- `onConnect` :37-52: name check → **F-09** `isTrustedInternalSender`
  (`core/sender-auth.ts:17-23`: `sender.id === chrome.runtime.id` AND
  (`sender.url === undefined` OR startsWith `chrome.runtime.getURL("")`)) →
  listeners + `clients.push`. On F-09 failure: warn + early return — the port
  **dangles silently** (never closed, never answered). Under a Ready
  handshake a rejected client would spin in `Connecting` forever → the rework
  must decide to explicitly `disconnect()` rejected ports.
- **Nothing is sent back on connect today.** Pinned by
  `service.test.ts:93-152` (assertions :99,107,115,134-135,143,151) and
  `hardening.test.ts:116-140,185-191` — all `captureResponse().not.toHaveBeenCalled()`
  after a legitimate connect. **Every one breaks the instant a Ready ack is
  added** (they'd see exactly one call).
- `initialized` gate `base-service.ts:45,63-72`; `ensureInitialized()` polls
  `awaitInitialized` (`core/initialization.ts:13-21`, 30s default). But
  `subscribe()` runs **unconditionally from the constructor**
  (`service.ts:26-31`) — a port can connect mid-`init()`; only RPC bodies
  gate. "Ready after F-09" therefore does NOT imply "ready after
  initialized" — a conscious decision either way.
- Dispatch: `service.ts:66-72` → `handleRequest` `base-service.ts:81-120`
  (requestId validation, D10 allowlist, 3-tier `sendResponse` :140-164).

**Wire shape** (`core/messages.ts:4-8`): `Event = 1, Request = 2,
Response = 3` — no Ready. Background messages carry no `from`/`to` (offscreen
extends with those). `client.ts:86` drops messages with falsy `content` —
a `ReadyContent` must be non-empty; carrying the version satisfies this.

**Version identity for skew**: `__VERSION__` (compile-time define,
`apps/extension/vite.shared.ts:37-38`) is embedded in ALL bundles incl. the
SW (proof: SW-side consumer `account-integrity/coordinator.ts:16-17`).
`chrome.runtime.getManifest().version` is the WRONG tool: it reflects the
on-disk manifest, which Chrome swaps atomically on auto-update while a stale
SW still runs old code — misreporting during exactly the skew window the
check exists for. Put `__VERSION__` in the Ready payload.

**Test harness** (`src/testing/transport-harness.ts`):
- `mockClientPort` :63-116 (no `sender` field); `connectServiceClient`
  :138-172 (always F-09-valid — hostile-sender connects must be hand-rolled);
  `chrome` stub :205-232 has **no `lastError`** field.
- **No doomed-port primitive exists** (confirmed by full read): nothing
  simulates connect-returns-port-synchronously → `onDisconnect` fires later
  with `lastError`, before any message. Genuine gap to fill, additively —
  6 test files consume the harness; `mockClientPort` behavior must not change.
- `client.test.ts:511-557` ("port onDisconnect → reconnect") pins today's
  no-handshake semantics (fresh request round-trips immediately after
  `emitPortDisconnect`) — needs a purposeful rewrite under the rework.
- 40+ `await client.connect()` sites across client/hardening tests assume
  synchronous readiness → make the harness **auto-emit Ready by default**
  with an explicit opt-out for pre-Ready/doomed-port tests.
- Conventions: this package tests with **vitest** (not bun:test), jsdom,
  banner-commented describes with prose motivation, `test.each` adversarial
  sweeps, `flush()` helper, fake timers in try/finally, reason-carrying
  `biome-ignore` for private-field probes, `AUDIT [A-Z]\d+` markers paired
  with tests (informal `<Letter>-<NN>` finding ids: F-09, B-06/13/14/15/16/17,
  D9/D10, Q-01…).

## B. Callers + noise filters (`apps/extension`, wallet-sdk envelope)

**Two transports both named ServiceClient**: background (Port) — the rework
target; offscreen (one-shot sendMessage) — consumed only by
`PxeServiceClientBase` (`packages/aztec-runtime/src/pxe/client.ts:81`).

**Canonical error surface** (`packages/extension-messaging/src/errors.ts`):
`CLIENT_DISCONNECTED_MESSAGE = "Client disconnected"` :84;
`isClientDisconnectRejection` :93-95; `RPC_DISCONNECTED` code :70 travels
only as structured `walletErrorCode` (never string-matched outside tests).

**dApp contract** (`apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:61-73`
— NOT in wallet-bridge; path verified): `RpcDisconnectedError` → `-32603` +
`walletErrorCode: RPC_DISCONNECTED`, deliberately NOT EIP-1193 4900; pinned
`error-envelope.test.ts:76-85`. Retry-ability semantics are a hard invariant.

**Noise filters — the full reconciliation surface** (all hardcode the
literal; none import the constant):
- `offscreen/is-benign-sw-disconnect.ts:23-25` — strict `===` on the literal
  (drifted; siblings `popup/index.ts:20` + `onboarding/index.ts:26` use the
  canonical predicate). Sole call site `offscreen/index.ts:59`.
- e2e: `fixtures/extension.ts:171` + `:181` (openOnboarding console/pageerror),
  `:1111` + `:1122` (setUpPopupPage duplicates); `security.test.ts:13`
  (used :76-79, :114-117); `passkey-paths.test.ts:127,:214`;
  `passkey-backup.test.ts:333,:398,:471`. All `.includes("Client disconnected")`.
- Near-collision string: `service.ts:63` logs `"Client disconnected. Total: N"`
  (logDebug, not an error) — new Ready-era log text must stay distinguishable.
- **None of these filters match `RpcDisconnectedError`'s message text** — only
  the plain `Error("Client disconnected")` shape is treated as benign anywhere.

**Fire-and-forget / fast-reject reliers**:
- Offscreen console sniffer `offscreen/index.ts:40-47` (un-awaited
  `logger.log`; rejections land in `onunhandledrejection` :50-67).
- `app.vue:87-96` account-switch `syncTransactions()` un-awaited (:93);
  `app.store.ts:389-423` has no try/catch — rejections become pageerrors
  (filtered by the e2e fixture).
- The large `onConnected`-driven reconnect population (13+ consumers:
  `usePrices.ts:45`, `useIncomingTransfers.ts:133`, `utils/core.ts:62-71`,
  `activity.vue:104`, `PopupManager.vue:190`, `TokensView.vue:212,261,339`,
  `operation-journal/client.ts:116`, `profile/client.ts:152`,
  `RecentActivityView.vue:609`, `app.store.ts:261`…) does NOT depend on fast
  rejection — it waits for `onConnected` and re-syncs. Naturally compatible;
  but retiming `onConnected` to "actually Ready" is a REAL behavior change to
  call out (GlobalLoader/`isBackgroundConnected` wired to
  `ProfileServiceClient.onConnected`, `utils/core.ts:32,62-64`).

**HIGHEST-VALUE constraint (open ask #1 resolution pressure)**:
`useFullBackupImport.ts:829-856` — the shipped crash-rollback gate classifies
`isClientDisconnectRejection(err) || err instanceof RpcDisconnectedError`.
If a queued never-sent call's deadline exhaustion surfaces as
`RpcTimeoutError` instead, the gate misses → `deleteProfile` fires
immediately against doomed ports → **BUG-TRANSPORT reintroduced**. Whatever
the latency contract, deadline-exhausted queued calls MUST reject
disconnect-classified. (Pins: `useFullBackupImport.test.ts:1581-1614` both
shapes gate; :1616-1629 non-disconnect skips.)

**Bounded-retry house precedent**: `composables/importPreflight.ts:17-21`
(5s per-attempt, backoff [2s,4s], absolute shared deadline, MIN_ATTEMPT_MS,
concurrency 3).

**E2E workaround that a real handshake obsoletes**:
`fixtures/extension.ts:1126-1183` "fast-path-then-fallback" triple-nav for
the lost first-popup handshake (`FAST_PATH_BUDGET_MS`, measured P99 comment,
`NULO_E2E_OPENPOPUP_LOG=1` `path=fallback` counter = the regression signal).
Post-rework removal/simplification candidate.

**Population**: 22 background ServiceClient subclasses (all
`apps/extension/src/wallet/services/*/client.ts`); the offscreen document
itself hosts two of them (`ProfileServiceClient`, `LoggerServiceClient` —
`offscreen/index.ts:41,:101-102`); NO content scripts exist (manifest
grep-confirmed). Naming collision to avoid: `wallet-bridge`'s
`DiscoveryQueue` already owns "queue" for dApp discovery — don't export a
bare `RequestQueue` from extension-messaging.

## C. Profile/PXE lifecycle (boot race + A3 tombstone + D4)

**Boot race (ledger row 6)** — `apps/extension/src/wallet/services/profile/service.ts`:
- `deleteProfile` :951-1054 starts `await this.ensureInitialized()` (:952 —
  sees only ProfileService's OWN `initialized`), then throws
  `"deletion coordinator not ready"` if `deletionDelegate` (:152) unset
  (:953-954). The delegate is set only by `ProfileDeletionCoordinator.start()`
  (`profile-deletion/coordinator.ts:79`) via setter :828-830 — the dependency
  edge runs coordinator→ProfileService, so `ensureInitialized` structurally
  cannot see it.
- Topology truth: `ServiceCollection.start()`
  (`packages/wallet-core/src/base/index.ts:65-70`) awaits phases
  sequentially; the coordinator (12 deps, `coordinator.ts:31-44`) lands in a
  later phase than ProfileService (no deps, phase 0). The `nulo:liveness`
  write (`runtime.ts:323-325`) is causally downstream of `services.start()`
  (:263) — the shipped "liveness ⇒ wired" claim is structurally true. The
  race window: `ProfileService.initialized` flips when ITS `start()` resolves,
  racing phase-0 siblings — so the window spans the rest of phase 0 + every
  phase up to the coordinator's.
- Exposure today: `reset.vue:66` (raw call; catch → generic "Couldn't delete
  profile — try again" toast :67-72) and `useFullBackupImport`'s two INNER
  legs :507/:641 (deliberately NOT liveness-gated — fable's scope boundary,
  folded in round 4). The F-B24 sweep's own call (:1173) never races boot
  (invoked from `runtime.ts:273-275` after `services.start()`).
- **Minimal fix shape**: export `awaitInitialized` from
  `background/index.ts` (not currently exported; `initialization.ts:13-21`
  is the consolidated primitive), and in `deleteProfile` await
  `awaitInitialized(() => this.deletionDelegate !== null)` before the
  (now fail-closed backstop) throw. Pins belong in
  `service.integration.test.ts` "finding D" describe (:1263; two-boot
  template :1291-1334). Fixing at ProfileService level covers ALL call sites
  uniformly (incl. reset.vue) — the argument against another caller-level gate.
- `rollbackCreatedProfile` (`useFullBackupImport.ts:405-423`,
  `ROLLBACK_MAX_ATTEMPTS = 3` :69) burns all 3 retries identically on the
  boot-race throw today (retries target live-worker failures, a different
  class).

**A3 — the stuck-undeletable trace** (exact, verified):
1. P fully deleted at G1 → offscreen map `deleted(G1)`
   (`packages/aztec-runtime/src/pxe/service.ts:715`); durable tombstone/row
   cleared.
2. Same-id re-import mints G2 (`profile/service.ts:1578` password /
   :1666 passkey; other mint sites :305,:441,:1448,:1493).
3. Crash before any G2 PXE op (map still `deleted(G1)`), then
   `deleteProfile(id)` (user retry or F-B24 sweep).
4. Phase 1 fine (tombstone written with G2 :983-1009, row deleted :1010).
5. Phase 2 — **unguarded** `await delegate.runFor(id, snapshot)` :1035 →
   coordinator `purge()` last step `pxe.clearProfileState(id, G2)`
   (`coordinator.ts:125`).
6. `PxeService.clearProfileState` (`pxe/service.ts:665-721`): the
   **kind-blind** guard :672-676 sees `deleted(G1)` vs G2 → throws
   `"generation mismatch … refusing to erase"`.
7. `deleteProfile` rejects; phase 3 (:1049-1053 tombstone clear + release)
   never runs. Row gone + tombstone retained + id reserved → every later
   `deleteProfile` fails at :959-961 ("Invalid profile id");
   `resumePendingDeletions` retries each SW boot into the same rejection
   (caught :1114, silent) — **until the OFFSCREEN document restarts** (map
   :159 is in-memory offscreen state; the WORKERS-reason offscreen document
   is decoupled from SW lifetime). User sees the reset.vue toast forever.
- **No pin exists for deleted+different-gen clear** — "pin 6b" in round-4's
  fix-plan is plan-doc-only (git-verified: the round-4 stack never touched
  `incarnation-fence.test.ts` or these guards). Only live+different-gen is
  pinned (:123-136).
- **Variant A (single-tombstone supersede)** — narrow the guard to
  `current.kind !== "deleted" && gen mismatch → throw`; `deleted(G1)`+
  clear(G2) proceeds → map ends `deleted(G2)`. CONSEQUENCE: a later stale
  `provisionChainStoreKey(id, key, G1)` passes ALL THREE guards
  (:750 deleting, :753 deleted-same, :756 live-different) → **installs
  live(G1) offscreen-locally = resurrection**, with only the SW durable-row
  provider (`runtime.ts:214-229`: live-gen read + HKDF + post-derive re-read
  + refuse-on-move) + the client capture-equality guard
  (`pxe/client.ts:170-177`) as remaining backstops. Removes one full D4
  defense layer for superseded generations.
- **Variant B (dead-generation SET)** — accumulate every erased gen per
  profile (`Map<profileId, Set<gen>>`); `provisionChainStoreKey`'s same-gen
  reject tests membership; the clear advances the slot freely while G1 stays
  offscreen-locally dead forever. Bigger diff; D4-preserving; memory growth
  bounded by twice-crash frequency within one offscreen lifetime.
- `assertGenerationCurrent` (:813-824, the shipped fall-through fence — the
  deleted+different-gen pass-through is :818) needs NO change under either
  variant. Existing D4 pins to keep green: `incarnation-fence.test.ts`
  :83-88, :90-101, :103-121, :123-136, :213-233, :235-246, :248-264;
  client half `client-capture.test.ts` :63-69, :71-89, :91-109, :111-124,
  :126-156, :158-174, :176-180. `#281 D4` comment sites:
  `chain-runtime.ts:61`; `pxe/service.ts:147,731,789`; `pxe/client.ts:75,132`;
  `spec.ts:111,118` (always written with the `#281` prefix — keep that
  discipline; distinct from `AUDIT D4`).

## D. E2E harness + certification surface

**Canary (A2)** — `tests/e2e/network/frozen-account-canary.test.ts`:
- Stage 5's `stopServiceWorker` (:44-58) is the FAKE kill
  (`Runtime.terminateExecution`) with an **absent-target tolerance**
  (5s waitForTarget → catch null → proceed) that none of the real-kill
  precedents have; its ":42-43 mirrors backup-restore-sw-restart" comment is
  STALE (that file was rewritten on the real kill in #400: hard 15s wait,
  throws if `worker()` falsy, :100-102,117).
- Conversion: swap the body for the real-kill pattern (arm `targetdestroyed`
  with OBJECT-IDENTITY compare BEFORE closing, `await (await
  swTarget.worker()).close()`, await destruction); DECIDE the absent-target
  tolerance explicitly; fix the stale comment; re-measure the 180s
  post-restart popup budget (:290-291) — calibrated against a worker that
  never actually died. The REAL respawn proof is downstream: post-restart
  `sendTx` as A (:283-314; :247-248 rebuilds from seed, hard-throws on
  drift). Liveness-gate comment :196-205 already round-3-corrected.
- **Three real-kill inline copies exist** (identical shape):
  `sw-restart-network.test.ts:11-38`, `sw-resilience.test.ts:29-56`,
  `backup-restore-sw-restart.test.ts:94-120`. Inline-not-extracted is
  DELIBERATE (`sw-restart-network.test.ts:7-9`: "the SW-restart shape is the
  test-case under test"). A 4th copy follows convention; extraction is a
  conscious override to call out.
- Rendezvous machinery (if ever needed): `fixtures/restore-gate.ts`
  (arm/waitHeld/clear :21-53, protocol doc :12-19; sole consumer the crash
  file), sibling `fixtures/proof-gate.ts` (4 consumers). Shared crash helpers:
  `helpers/crash-truth.ts` (:1-8 "no test imports another test module";
  consumers: exactly the two cert files).

**Certification files**: `backup-restore-sw-restart.test.ts` (scenario A
:164-388 service-restore gate, budget 180s :150; scenario B :390-514
account-state gate, 300s; `@requires-proverless` :36-42 — runner REFUSES
prover-ON; BUG-TRANSPORT regression comment :153-163) and
`profile-reimport-matrix.test.ts` (prover-capable; leg A :103-174 id-reuse +
fresh-gen pins; leg B :176-209; `readStage`/`readProfileGen` from
crash-truth). `RestoreStage` union: `useFullBackupImport.ts:52-66`, exposed
as `data-restore-stage`. Smoke files (flat, no smoke/ dir):
`sw-restart-network.test.ts` (:81-144), `sw-resilience.test.ts` (4 tests;
one 3-reason `// SKIP —` block :188-245; heartbeat pin :265-317).

**Runner env truth**: `NULO_E2E_RETRY` (`vitest.e2e.network.config.ts:46`,
default 2); `NULO_E2E_PROVERLESS` → agent.sh double opt-in (:80-104,
mutually exclusive with `VITE_NULO_ACCELERATOR_REQUIRED`), pre-build
`@requires-proverless` refusal (:21-34, exit 2), runtime fail-closed
(`src/e2e/config.ts:29-40`), post-build stamp grep (:147-154). Exit-86 =
boot-failure-only (`sentinel.ts:24,:79-83`; agent.sh :196-202). Armed-build:
`VITE_*` at build time only; stamps + bundle greps agent.sh
:109-114,:119-123,:133-140,:147-154,:162-169; skill "Build-time-armed tests"
(:285-319) documents the two required belts. Solo-run rationale: skill
:321-352. Certification precedent (round 4, repeatable):
`fix-plan.md:367-377` + `certification.md:4-11`.

**Skill/CLAUDE.md reconciliation notes**: the kill-primitive lesson lives at
skill :376-388 ("verify the primitive does what its name says"); the
console-noise rule is skill Gotchas :45 (never blanket-benign) with the
narrow churn-count precedent at `backup-restore-sw-restart.test.ts:178-186`
(count one known substring as diagnostics, assert pageErrors separately);
the strict selector rule + `waitForToast` exception live in CLAUDE.md, not
the skill.

## E. Consolidated design notes (for the future un-parking session)

1. The rework is materially smaller than ledger row 1's framing suggests:
   B-15 gives the queue; sent-never-replayed already holds; `Connecting`
   exists; the reentrancy guard transfers.
2. The REAL new decisions: Ready-vs-`initialized` gating; explicit close of
   F-09-rejected ports; `onConnected` retiming (13+ consumers — behavior
   change, arguably a correctness fix); latency contract for queued calls
   (MUST reject disconnect-classified on exhaustion — the
   `useFullBackupImport` gate depends on it); harness auto-Ready default.
3. Breaking-test map (enumerated, will red immediately):
   `service.test.ts:99,107,115,134-135,143,151`;
   `hardening.test.ts:116-140,185-191`; `client.test.ts:511-557`.
4. Version skew: Ready carries `__VERSION__` (never `getManifest()`).
5. A3 fork: Variant B (dead-gen set) is the D4-preserving shape; Variant A
   removes one defense layer and leans on the SW provider + capture guard —
   exactly the question the goal reserved for codex xhigh.
6. Boot race: ProfileService-level `awaitInitialized(() => delegate wired)`
   covers all call sites; the composable's inner legs stay un-gated by design.
