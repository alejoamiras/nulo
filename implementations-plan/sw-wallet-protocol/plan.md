# sw-wallet-protocol — round-2 plan 5 (blueprint light, BL/C)

Scope authority: [round-2 scope](../complexity-residue-round-2/scope.md) § 5. 2 PRs.
Burns 13 prod directives: `wallet/runtime.ts` 183L + 160L + 33 + 27 (PR-a);
`packages/wallet-bridge/src/dispatcher.ts` 25 + 31 + 102L, `wallet-sdk/background.ts`
21 + 196L + 99L, `packages/wallet-sdk-schema-patch/src/apply.ts` 24,
`popup/windows/execute/index.vue` 25 + 103L (PR-b). Manifest 87 → 83 → 74. Seam toolkit
as adjudicated in plans 1–4: sync guard-ladder helpers; tail-returns; an awaited helper
only where its call replaces a span that already awaited, under a caller-side
applicability guard; register-immediately spans (construct → `start()`, capture →
`services.start()`, write → emit) never gain a hop; any helper that creates a
cancellable/registered resource owns the create→register span; classify
zero-await branches synchronously rather than routing them through an awaited helper.

## Recon findings that shape the cuts

- **`runtime.ts` is a flat boot sequence with few, sharp fences** (recon agent, verified
  against the source): (1) `journalBootCutoff = Date.now()` must be the statement
  immediately before `await services.start()` — RPC handlers go live inside `start()`;
  (2) `retrySafe = false` must sit between the config/BB `Promise.all` and the first
  `services.add` (it marks the end of the vetoable failure classes); (3) the reaper and
  journal-GC are each `new X(...)` then `x.start().catch(...)` with no await between —
  construct-and-arm pairs whose instances `stop()` reads from the closure; (4) the
  heartbeat `setInterval` is deliberately the LAST synchronous action of `doStart`
  (liveness means fully wired); (5) the migration-gate short-circuit branch inspects the
  just-returned decision synchronously. **MV3 listener timing is NOT in scope**: every
  timing-sensitive `chrome.*` listener lives in `wallet/index.ts` at module scope;
  `initWalletSdkHandler` attaches to the pre-registered relay, never registers a new
  listener — which is why it is safe after several awaits.
- **Coverage on runtime.ts is split**: `runtime.migration-gate.test.ts` pins the gate's
  decision table; `runtime.test.ts` pins single-flight/retry in the PRE-registration zone
  and constructs no service; the post-start ordering (fences 1, 3, 4 above) is pinned
  only by the three e2e gates. → BL/C pin: a boot-order pin against the real
  `createWalletRuntime` with fake deps IF the existing harness can construct through
  `services.start()` cheaply; otherwise the e2e trio + the gate suite are the base and
  the plan says so explicitly (codex rules).
- **`dispatch()` is a sync guard ladder** after one awaited session capture: known-method
  → arg schema → auth-relevant arg shape → capability → scope, then an if-ladder routing
  `via: "handler"` methods (each `return this.handleX(...)`, NOT awaited) before the
  generic `buildOperation` + `executeOperations` fallthrough. The dApp-visible error
  contract (`Unsupported wallet method`, `Invalid arguments for wallet method: X`,
  `CapabilityNotGrantedError` → 4100) is pinned in `dispatcher.test.ts`, including
  patched-method reachability and batch-leg `hooks` non-forwarding.
- **`handleRequestCapabilities`** is a 3-phase negotiation whose fence is "persist the
  rejection before rethrowing" on popup failure and ONE atomic `applyCapabilityDecision`
  write (B-14) at the end. **`handleDiscovery`** re-checks `rejectIfExpired()` after
  EVERY await (three times) and closes the popup lifecycle in a `finally` that also
  releases the dedupe entry — that try/finally is one unit.
- **`applyNuloSchemaPatch`** is three copy-pasted sync verify-or-patch blocks; the
  textbook case. **`execute/index.vue init()`** is a sequential per-operation resolve
  loop whose B-30 fence is the `finally` that disconnects two locally-constructed
  clients on every exit path; the `initComplete` flip must stay AFTER the loop commits;
  testids `execute-show-json-btn` / `execute-reject-btn` / `execute-confirm-btn` are
  verbatim.

## PR split

- **PR-a — the service-worker boot**: `wallet/runtime.ts` ×4. 87 → 83. Gates:
  cold-wake-discovery · backup-restore-sw-restart · profile-reimport-matrix.
- **PR-b — the wallet protocol**: `dispatcher.ts` ×3, `background.ts` ×3, `apply.ts`,
  `execute/index.vue` ×2. 83 → 74. Gates: cap-request-{accounts,basic,partial,reject,
  repeat-noPopup,rerequest} · connect-{dapp,deny,locked-queue,locked-queue-sw-restart} ·
  session-{explicitDisconnect,profileSwitch,reconnect,tabClose,tabNavigate} ·
  meta-{batch,getAccounts,getAccounts-pregrant,getChainInfo} · register-token ·
  data-{addressBook,privateEvents,registerSender}.
- Both PRs also run audit:vue + test:ci-gating; PR-b re-runs PR-a's three (the
  dispatcher/handler live inside the boot PR-a re-shapes).

## Decomposition — PR-a (`runtime.ts`)

- `evaluateMigrationGate` (27) → a module-level `evaluateMigrationGate(deps)` function,
  body verbatim (it is already an independently-awaited unit; the caller keeps
  `await` + the synchronous short-circuit branch adjacent).
- `doStart` (160L + 33) → keep the spine in `doStart` and move the phases:
  - awaited `runMigrationEngine(deps, …)` — the single `new Migrator(...).run().catch`
    expression + its log line;
  - the migration-outcome branch splits into a SYNC classification in `doStart` —
    `classifyMigrationOutcome(migration)` → blocked | degraded | healthy — with the
    `retrySafe = false` veto applied in `doStart` for the blocked class BEFORE the
    awaited persistence helper is entered (codex correction: today the veto precedes
    the first persistence await, so a helper that returned the verdict after a
    throwing write would leave a same-lifetime retry permitted); then awaited
    `persistBlockedOutcome(...)` (status write, the free-failure gesture re-arm, the
    throw) / `persistDegradedOutcome(...)` / `clearMigrationStatus(...)`, each an
    already-awaited span under its class guard. New pin: a blocked outcome whose
    status write REJECTS still vetoes retry (the memo stays rejected);
  - sync `registerServices(services, deps, …)` — the ~25 `services.add` calls + the PXE
    provider registrations (the provider CALLBACK bodies run later, off the boot
    chain — registering them is sync). The store-key provider callback itself (a
    self-contained awaited chain with its own generation re-read) may move to a named
    function verbatim;
  - `retrySafe = false` stays in `doStart`, between the `Promise.all` and
    `registerServices(...)`; `const journalBootCutoff = Date.now()` stays glued to
    `await services.start()`;
  - ONE sync `armPostStartWork(...)` owning the whole post-start ordered sequence
    exactly as today — deletion-coordinator `resumePending` (void) → `new
    JournalReaper` → `reaper.start().catch` → `new JournalGC` → `journalGc.start().catch`
    → the storage-probe IIFE (void) — with zero awaits, returning `{ reaper, journalGc }`
    for `doStart` to assign to its closure `let`s (codex: the resume and probe spans
    are NOT contiguous, so they cannot be bundled apart from the reaper/GC arming;
    `stop()` keeps its heartbeat → reaper → GC order);
  - `initWalletSdkHandler(...)`, the first liveness write and the heartbeat
    `setInterval` stay in `doStart`, in that order, the heartbeat last. The MV3 note
    refined (codex): `initWalletSdkHandler` installs tab listeners and reaper/GC
    install alarm listeners late — safe because that state is lifetime-local or
    boot-sweep-compensated; the split preserves zero awaits there and exactly ONE
    `handler.initialize()`, after the teardown subscriptions.
- `createWalletRuntime` (183L) lands under 80 once `doStart`'s phases are module-level;
  `doStart` itself stays a closure (it captures `heartbeatHandle`/`reaper`/`journalGc`/
  `retrySafe`) but shrinks to the spine.

## Decomposition — PR-b

- **`dispatcher.ts` `dispatch` (25)** — sync `enforceMethodAndScope(methodName, args, ctx,
  dappSession)` (the guard ladder after the session await; every throw keeps its exact
  message/class), sync `normalizeSessionAccounts(...)` (the CAIP block), and a SYNC
  `routeHandlerMethod(...)` returning the handler's EXACT promise or `undefined` — the
  if-ladder of `via: "handler"` methods, never awaited by the helper (an async helper or
  a caller-side `await` would move rejection timing — codex); the caller tests
  `routed !== undefined` and returns it as today; the generic `buildOperation` +
  `executeOperations` fallthrough stays inline. `UnsupportedMethodError` (-32601),
  `CapabilityNotGrantedError` (4100) and every message/class pass through unwrapped;
  invalid-argument `Error`s keep becoming the generic wire error. Pin: the returned
  promise is identical (===) to the handler's.
- **`handleRequestCapabilities` (31 + 102L)** — sync `computeCapabilityDelta(...)`
  (phase 1, pure); awaited `loadAvailableAccountsForPopup(ctx)` under the existing
  accounts-in-delta guard; awaited `persistRejectionOnPopupFailure(...)` = the catch
  body (already awaited, swallow-if-revoked inside); sync `mergeGrantsAndRejections(...)`
  producing the decision object, with the ONE atomic `applyCapabilityDecision` await
  staying in the caller as the last write (codex flagged the merge as borderline —
  the split keeps computation pure and the write in place).
- **`background.ts` `initWalletSdkHandler` (196L)** — length-only: the callback wiring
  splits into named module-level factories (`buildDiscoveryCallbacks`, the
  decrypt-serialization patch, the teardown subscriptions) called in the same order;
  every listener install stays synchronous and in the same continuation as today.
  **`handleDiscovery` (21 + 99L)** — sync `checkDiscoveryPopupCaps(...)`; awaited
  `checkExistingSessionAutoApprove(...)` replacing its already-awaited span; awaited
  `awaitPendingPopupDedupe(...)` for the dedupe branch; the popup block moves as ONE
  unit — popup-promise creation, the dedupe-map registration, the durable write, the
  re-expiry check, approve/rollback, and the inner `finally` that resolves the popup
  promise and deletes the map entry travel TOGETHER, while the OUTER rejection catch
  stays caller-side (codex). Expiry re-checks preserved at their three actual local
  positions plus `approveOrRollbackDiscoverySession`'s own post-write check (not
  "after every await"). `initWalletSdkHandler`'s split preserves zero awaits and ONE
  `handler.initialize()` after the teardown subscriptions.
- **`apply.ts` (24)** — one sync `patchOrVerifyEntry(schema, key, patched, isCompatible,
  mismatchMessage)` replacing the three blocks; the three mismatch messages verbatim.
- **`execute/index.vue` `init` (25 + 103L)** — the `getNetwork`/`getNetworkAndAccount`
  closures stay (they close over the two locally-constructed clients the B-30 `finally`
  disconnects); awaited `buildOperationsFromPayload(payload, accountClient,
  networkClient, profileId)` — the transient clients passed EXPLICITLY (codex) —
  wrapping the sequential per-operation loop (already awaits on every operation) and
  returning `{ operations, accounts }`; awaited `prefetchTokenMetadata(operations,
  tokenService, refs)` under the existing register_token guard with the token service
  and every metadata/loading/error ref passed explicitly; order in `init` exactly as
  today: commit session/operations/accounts → flip `initComplete` → prefetch; the
  outer try/finally stays in `init`. Testids untouched; `index.test.ts`
  (eager-connect order, B-30 dual-disconnect-on-throw) zero-edit.

## Equivalence

BL/C. Codex ruled: the dispatcher enforcement order is already pinned; the runtime
harness stops pre-registration by design and cannot reach `services.start()` cheaply,
and e2e cannot prove synchronous ordering — so the boot fences get focused
call-order/helper pins instead. Pins FIRST (committed before each PR's refactor,
byte-identical after): PR-a — a blocked migration whose status write REJECTS still
vetoes in-lifetime retry (memo stays rejected); `armPostStartWork` call order
(resume → reaper.start → GC.start → probe, zero awaits) and `stop()`'s heartbeat →
reaper → GC order via fakes at the helper seam. PR-b — the routed promise is the
handler's exact promise (identity); `initWalletSdkHandler` installs each
listener/subscription once, in order, with ONE `handler.initialize()` last; discovery
expiry checks + the inner `finally` cleanup (popup promise resolved, dedupe entry
deleted) on every exit; execute `init` sequential resolution → `initComplete` flip →
prefetch with its `finally`; `applyNuloSchemaPatch` idempotency + all three full
mismatch messages. Existing suites zero-edit green per PR: `runtime.test.ts`,
`runtime.migration-gate.test.ts`, `single-flight-start.test.ts`, `dispatcher.test.ts`,
the background helper suites, `apply.test.ts`, `execute/index.test.ts`. Gates per PR
as listed plus `tx-sendTx-default` as the representative send gate on both, single
sequential e2e run. PR-a rebases onto #509 first (manifest 87 is post-#509).

## Acceptance

- PR-a: 4 directives, 87 → 83, zero inserted (read the regen diff); runtime suites
  zero-edit; the three boot gates green. **DONE — #510 merged 2026-09-01.**
- PR-b: 9 directives, 83 → 74, zero inserted; dispatcher/background/apply/execute suites
  zero-edit; the protocol gates + PR-a's three green (27 specs, one sequential run).
- Codex loop: one session — plan audit → PR-a impl review → PR-b impl review → approve.
  Transcript summary + lessons: `lessons/phase-1.md`.

## Rollback

Squash revert per PR; no wire-shape, schema, storage or listener-registration change.
