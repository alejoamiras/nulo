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
  - awaited `persistMigrationOutcome(migration, …): Promise<{ retrySafe: boolean }>`
    — the blocked/degraded/healthy three-way branch, each arm keeping its
    decide→persist writes together; NON-mechanical: `retrySafe` is a closure `let`
    the single-flight wrapper reads, so the helper RETURNS the verdict and `doStart`
    assigns it (no closure mutation from a helper);
  - sync `registerServices(services, deps, …)` — the ~25 `services.add` calls + the PXE
    provider registrations (the provider CALLBACK bodies run later, off the boot
    chain — registering them is sync). The store-key provider callback itself (a
    self-contained awaited chain with its own generation re-read) may move to a named
    function verbatim;
  - `retrySafe = false` stays in `doStart`, between the `Promise.all` and
    `registerServices(...)`; `const journalBootCutoff = Date.now()` stays glued to
    `await services.start()`;
  - sync `startReaperAndGc(...)`: `new JournalReaper` → `reaper.start().catch` and
    `new JournalGC` → `journalGc.start().catch` inside ONE synchronous call, returning
    both instances for `doStart` to assign to its closure `let`s;
  - sync `armPostStartTasks(...)`: the deletion-coordinator resume + the storage probe
    IIFE — both `void`/fire-and-forget, kicked off in the same synchronous tick;
  - `initWalletSdkHandler(...)`, the first liveness write and the heartbeat
    `setInterval` stay in `doStart`, in that order, the heartbeat last.
- `createWalletRuntime` (183L) lands under 80 once `doStart`'s phases are module-level;
  `doStart` itself stays a closure (it captures `heartbeatHandle`/`reaper`/`journalGc`/
  `retrySafe`) but shrinks to the spine.

## Decomposition — PR-b

- **`dispatcher.ts` `dispatch` (25)** — sync `enforceMethodAndScope(methodName, args, ctx,
  dappSession)` (the guard ladder after the session await; every throw keeps its exact
  message/class), sync `normalizeSessionAccounts(...)` (the CAIP block), and a sync
  `routeHandlerMethod(...)` returning `Promise<unknown> | undefined` — the if-ladder of
  `via: "handler"` methods, still NOT awaited (the caller returns the promise as today);
  the generic `buildOperation` + `executeOperations` fallthrough stays inline.
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
  `awaitPendingPopupDedupe(...)` for the dedupe branch; the popup + durable write +
  re-expiry + approve/rollback block moves as ONE unit with its try/finally (the
  `finally` that resolves the popup and releases the dedupe entry travels with it);
  `rejectIfExpired()` re-check positions unchanged.
- **`apply.ts` (24)** — one sync `patchOrVerifyEntry(schema, key, patched, isCompatible,
  mismatchMessage)` replacing the three blocks; the three mismatch messages verbatim.
- **`execute/index.vue` `init` (25 + 103L)** — the `getNetwork`/`getNetworkAndAccount`
  closures stay (they close over the two locally-constructed clients the B-30 `finally`
  disconnects); awaited `buildOperationsFromPayload(...)` wrapping the sequential
  per-operation loop (already awaits on every operation) and returning
  `{ operations, accounts }`; awaited `prefetchTokenMetadata(...)` under the existing
  register_token guard with its own loading/error refs passed in; `initComplete` flips
  in `init` after the loop returns; the outer try/finally stays in `init`. Testids
  untouched; `index.test.ts` (eager-connect order, B-30 dual-disconnect-on-throw)
  zero-edit.

## Equivalence

BL/C. Pins FIRST where coverage is thin: (a) dispatcher enforcement ORDER (a request
failing both args and capability surfaces the args error; unknown-method precedes
everything after the session read) if not already pinned; (b) a boot-order pin for
runtime.ts (cutoff-before-start, reaper/GC armed synchronously after start, heartbeat
last) IF the harness permits — otherwise recorded as e2e-covered; (c) apply.ts
idempotency (applying twice leaves the same entries). Existing suites zero-edit green
per PR: `runtime.test.ts`, `runtime.migration-gate.test.ts`, `dispatcher.test.ts`, the
background helper suites, `apply.test.ts`, `execute/index.test.ts`. Gates per PR as
listed, single sequential e2e run.

## Acceptance

- PR-a: 4 directives, 87 → 83, zero inserted (read the regen diff); runtime suites
  zero-edit; the three boot gates green.
- PR-b: 9 directives, 83 → 74, zero inserted; dispatcher/background/apply/execute suites
  zero-edit; the protocol gates + PR-a's three green.
- Codex loop: one session — plan audit → PR-a impl review → PR-b impl review → approve.

## Rollback

Squash revert per PR; no wire-shape, schema, storage or listener-registration change.
