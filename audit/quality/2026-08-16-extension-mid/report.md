# Harden Quality Report

**Repo:** nulo | **Date:** 2026-08-16 | **Effort:** medium | **Run ID:** 2026-08-16-extension-mid | **Models:** Phase 1 map Sonnet ×8; Phase 2 scans Claude Sonnet + Codex gpt-5.6-sol (medium) ×7 clusters; Phase 3 coordinator Sonnet; Phase 4 verifiers Sonnet ×5; orchestration Fable | **Scope:** apps/extension + its workspace dependency closure (wallet-core, wallet-crypto, extension-messaging, aztec-runtime, wallet-bridge, bridge-core [fee-juice.ts only — the sole extension-reachable file], design, wallet-sdk-schema-patch). Excluded: apps/faucet, apps/playground, apps/landing, generated catalogs, the vendored frozen account artifact, bridge-core scripts/ (ops-only).

## Executive summary

This run audited the extension and its full workspace dependency closure for maintainability, deliberately picking up where the 2026-08-14 dedup-mid audit left off: findings already remediated there were used as a suppression list, so everything below is either residue that accumulated since or was out of that audit's scope entirely. Twelve findings survived consolidation from roughly 45 raw candidates across seven clusters, each scanned blind by both Claude Sonnet and Codex (medium effort). The top five by impact bucket went through a verifier pass; all five were held (three CONFIRMED at high confidence, two CONFIRMED-WITH-CORRECTIONS).

The headline is god-service accretion: five unrelated service families — `WalletSdkDispatcher`, `PxeService`, `NetworkService`, `IncomingTransferService`, `ProfileService` — independently show the same Large Class / Divergent Change shape, and each is its own subsystem's single highest-churn file. This is not five unrelated cleanups; it's one recurring failure mode with an identical fix template (incremental Extract Class along seams that already exist), and it compounds every time a new feature lands in one of these files instead of in a collaborator. The second theme is stalled adoption: helpers built specifically to kill a known duplication (`restoreRows`, `id-allocators.ts`, `usePopupEntity`, `useEntityCrud`) were rolled out partway and then abandoned — in the popup case, a prior harden-quality arc explicitly scoped the rollout to 5 of 15 popups and documented the rest as deferred, and they're still deferred three months later. The single highest-payoff item in the whole run is Q-03: `EventHandler.invoke()`'s bare `catch {}` is an hours-scale fix (an optional logger param, matching the pattern `Lock` already uses) that removes the sole silent exception swallow reachable from roughly 50 production files.

Recommended priorities, in order: (1) fix Q-03 first — it's cheap, isolated, and its blast radius (every pub/sub relationship in the codebase) is disproportionate to its cost; (2) start the Q-01 god-service extractions with `PxeLifecycleCoordinator` (the verifier's pick — it addresses a bug class the file's own comments admit has already recurred once); (3) treat Q-07's stalled adoption as a process fix, not just a code fix — future extractions need an explicit rollout-completion task, not an assumption that adoption happens opportunistically; (4) schedule Q-02's `restoreBackup()` decomposition deliberately, staged as the verifier corrected it (validation/migration first, provenance-filtering and token-relinking kept together because they share a hoisted `Set`), since this is the data-recovery path and an ordering mistake here is a data-loss bug, not a readability one.

## Methodology

Map-reduce per the harden-quality medium spec: an 8-mapper hierarchical Phase 1 (shared with the parallel bugs run) produced the repo maps under `raw/repo-map/` (`aztec-runtime.md`, `bridge-core.md`, `design.md`, `extension-ui.md`, `extension-wallet.md`, `messaging-schema-patch.md`, `wallet-bridge.md`, `wallet-core-crypto.md`). Phase 2 ran 7 clusters (q1-foundations, q2-messaging-bridge, q3-aztec-runtime, q4-row-services, q5-execution-flows, q6-ui, q7-design), each scanned independently by Claude Sonnet and Codex gpt-5.6-sol at medium effort — **no cross-rebuttal** (that phase only exists at `high`+; at medium the two scanners stay blind to each other, per spec). A Sonnet coordinator deduplicated the resulting ~45 raw candidates by root-cause + smell + affected boundary down to 12 findings. Phase 4 ran a verifier pass over the top 5 findings by impact bucket (all-architectural first), each verifier independently re-deriving its own conclusion from source before reading the original claim (a blind-first anchoring guard).

Deviations from the nominal spec, stated honestly:

1. **Verifier coverage is partial.** Only Q-01 through Q-05 went through the Phase 4 verifier pass; Q-06 through Q-12 are consolidated-only, capped at medium effort. Their confidence labels reflect that — they are not independently re-derived, only cross-model-corroborated at Phase 2/3.
2. **Cluster count was 7, not the nominal ~10** for this scope size — the coordinator judged the package boundaries in this closure (foundations / messaging-bridge / aztec-runtime / row-services / execution-flows / ui / design) didn't subdivide further without artificially splitting cohesive files.
3. **Codex ran at medium effort, not xhigh**, for all 7 clusters — a medium-effort budget constraint for this run, consistent across both scanners.
4. **The 2026-08-14 dedup-mid remediation record was used as a suppression list.** Every finding below was cross-checked against `audit/quality/2026-08-14-dedup-mid/remediation.md`; none overlap with anything already fixed there (verified per-finding during consolidation).

Scan prompts carried the standard ~4-function inter-procedural trace cap with handoff-edge escalation — a scanner follows a call chain up to ~4 functions deep before it must either resolve the finding or explicitly escalate at the package/service handoff boundary, rather than tracing indefinitely into a dependency's internals.

## Findings

### [ARCHITECTURAL] Q-01: God-service accretion recurs across 5 core services

**Verified:** CONFIRMED (high)

**Impact:** architectural (crosses the service/RPC boundary each service owns; every one of these is the sole owner of its RPC surface) — blast radius: 5 files (2,000-3,400 LOC combined), change frequency: extremely high aggregate churn (`dispatcher.ts` 18 commits, `pxe/service.ts` 13-14 commits, `network/service.ts` 21 commits — the single highest-churn file across the whole audit [21 via `git log --follow`; 15 without, since the repo restructure renamed the file — a real number but a silently different counting methodology than the other four files use], `incoming-transfer/service.ts` 9 commits, `profile/service.ts` 9 commits) | **Confidence-signal:** both — codex independently named "Large Class + Divergent Change" for all 5 instances; claude corroborated 4 of 5 with granular sub-symptom findings (duplicate scaffolds, switches, shotgun surgery, teardown duplication) and explicitly agreed on the Large Class framing for `ProfileService` | **Smell:** Large Class / Divergent Change (Fowler)

**Instances:**
- `packages/wallet-bridge/src/dispatcher.ts` (1,368 LOC) — capability coverage policy (`:167-299`, a switch + 5 parallel "is this covered" functions), authorization-shape validation (`:316-367`), 4 popup/execution routing paths repeating a 5-step scaffold verbatim (`:636-847`), 200-line `handleRequestCapabilities` (`:857-1056`), operation construction (`:1186-1307`), network/account resolution (`:1312-1363`).
- `packages/aztec-runtime/src/pxe/service.ts` (25 RPC methods) — RPC façade + 5 separate lifecycle/concurrency state maps (`:131-162`) + orphan-store deletion (`:224`) + destructive chain/profile teardown (`:626,655`) + runtime binding/retry/purge-fencing (`:803-904`). The class also duplicates its own safety-critical logic instead of centralizing it: `indexedDB.deleteDatabase` is hand-wrapped 3x with 3 different `onblocked` policies (`:242-250` resolve-false, `:259-267` resolve-true, `:760-775` the "real" timeout-and-reject version actually reused elsewhere), and the purge-epoch anti-resurrection fence is independently re-derived in both `withPxeRead` (`:828,844`) and `withPxeWrite` (`:879,889`) — the exact kind of concurrency bug class (per `service.ts:885-888`'s own "concurrency audit MED #4" comment) this file has already had to patch once because one path was missing what the other had. It also still carries the dead surface flagged as a residual gap in the prior audit's remediation record (`IProfileReader.onProfileDeleted` — required at `:68`, zero production readers) plus an `ArtifactRegistry` extensibility hook (`chainId`, policy setters) with exactly one caller and zero configuration (`artifact-registry.ts:14-189`).
- `apps/extension/src/wallet/services/network/service.ts` (869 LOC, 21 commits) — row/endpoint CRUD (`:209-522`, including an 80%-identical `addEndpoint`/`updateEndpoint` 7-step pipeline), node probing/transient-cache/failure-eviction (`:524-628`), cross-service deletion cascade (`:630-689`), backup/restore/profile-lifecycle (`:691-782`). It also fans its 16-method RPC surface across 4 hand-maintained registries — `spec.ts:200-267` (schema), `spec.ts:269-337` (type contract), `service.ts:152-169`+15 validate call sites (allowlist), and `network/client.ts:35-134` (the only client in the row-services cluster that never adopted the `definePassthroughsExhaustive` installer 13 siblings use, per the prior audit's Q-05) — a new RPC method requires editing all 4 by hand.
- `apps/extension/src/wallet/services/incoming-transfer/service.ts` (1,996 LOC, 9 commits, largest file in the execution-flows cluster after `execution/service.ts`) — 11 service dependencies + 6 event streams (`:119`), scheduler/polling/public-indexing/fee-cache/sync-state fields (`:126`), private-note discovery (`:939`) and public-event indexing/reorg-reconciliation (`:1171`) independently re-implement the same "resolve token under lock → dedupe own tx → transition trust → write outbox before record → persist → conditionally emit" workflow (private arm `:1013-1083`, public arm `:1712-1762`), and independently re-implement scheduler teardown: the public arm has a named `stopPublicScheduler()` (`:781-790`) while the private arm hand-copies the same 4-line teardown inline 3x (`:365-368`, `:718-720`, `:870-873`).
- `apps/extension/src/wallet/services/profile/service.ts` (1,608 LOC, 9 commits spanning 6 unrelated change reasons in 6 months: lock-primitive refactor, import bugfix, account-identity freeze, Aztec 5.0.1 bump, a 3-commit security/backup-hardening series, and the prior quality audit) — CRUD, password lifecycle, passkey ceremonies, 3 independent import formats and 3 independent export formats, deletion orchestration, and full-backup restore (a 532-line stage — see Q-02) all in one class.

**Why it harms future change:** each class is the single point where unrelated feature arcs collide — the git history above shows security-hardening PRs and unrelated bugfixes already landing in the same files in the same months. A reviewer changing one concern (e.g. `NetworkService`'s endpoint probing) must hold the whole file's invariants in their head to be confident an unrelated concern (deletion cascade, backup restore) wasn't disturbed. Each class already has the collaborator seams needed for extraction (`sessionManager`, `passkeyCoordinator`, `tombstones` are already separate classes `ProfileService` composes) — the accretion pattern is "add to the god class" rather than "extend the collaborator," so the problem compounds with every feature.

**Recommended refactoring:** Extract Class (Fowler), incrementally, one collaborator at a time, along each file's own existing seams: `CapabilityConsentCoordinator` for the dispatcher's capability logic; `PxeLifecycleCoordinator` for PXE's guards/epochs/teardown; `NetworkNodePool` for NetworkService's connectivity state; `PublicIncomingScanner` for the public-event half of `IncomingTransferService`; `ImportExportCoordinator` + `ProfileRestoreCoordinator` for `ProfileService`. Each extraction is independently shippable behind the existing public method surface. Verifier's smallest-safe-first-step pick: `PxeLifecycleCoordinator` (teardown + epoch fencing) — the file's own inline comment is a first-party admission that centralization was already needed once and wasn't done, so this piece both has the smallest blast radius and directly prevents a third recurrence of the same fencing-bug class.

**Effort:** days per service (roughly 2-4 days each for the first extraction), tackled incrementally rather than as one arc — not a single PR.

---

### [ARCHITECTURAL] Q-02: Full-backup restore is a 532-line, 11-service transaction coordinator

**Verified:** CONFIRMED-WITH-CORRECTIONS (high)

**Impact:** architectural — blast radius: `useFullBackupImport.ts`, its tests, and 11 service contracts (profile, network, account, token, token-balance, transaction, auth-registry, FPC, contact, config, account-state) it orchestrates in sequence | **Confidence-signal:** codex only | **Smell:** Long Method (Fowler)

**Evidence:** `restoreBackup()` spans `apps/extension/src/composables/useFullBackupImport.ts:208-739` (10 commits since introduction — an actively-changed data path, independently confirmed via git log). Within one function: backup validation + schema migration (`:219-312`), profile/passkey restore (`:317-396`), network restore + identifier remapping (`:398-460`), account restore + provenance filtering (`:462-557`), token/balance relinking (`:559-619`), six more service restores (`:624-648`), profile finalization + account-state chain sync (`:650-701`), and completion/rollback policy (`:703-738`) — all sharing one function scope and one set of nested helpers (e.g. `filterByAccount`). Every per-stage line cite and the 11-client count were independently re-verified by the verifier via a `ServiceClient()` instantiation grep.

**Verifier corrections (material — apply before extracting):**
1. The impact line's original enumeration listed 12 service names for "11 service contracts" — `balance` was a spurious duplicate (there is no distinct `BalanceService`, only `TokenBalanceServiceClient`); the count of 11 is right, the enumeration above has been corrected to drop the stray entry.
2. **Account provenance filtering (`:462-557`) and token relinking (`:559-619`) are NOT independently extractable as originally proposed.** They share a deliberately-hoisted `importedChainAddress` `Set` (comment at `:462-464`) that the relink stage's chain-equality check (`:601-605`) reads. A naive Extract Function on either stage alone silently drops that cross-check unless the `Set` is explicitly returned from the first stage and threaded into the second as a parameter.
3. `profileService`/`networkService` must be explicit parameters of every extracted stage — implied by the original recommendation but not spelled out, and easy to drop by accident during a mechanical cut.

**Why it harms future change:** adding a 12th restored slice, or changing rollback policy, requires reasoning about nested service lifetimes, pre/post-finalization failure semantics, identifier remapping, and completion ordering simultaneously — a change near one restore stage can silently alter cleanup or rollback owned hundreds of lines away. This is the codebase's data-recovery path; an ordering mistake here is a data-loss bug, not just a readability problem.

**Recommended refactoring:** Extract Function, stage-by-stage, but keep provenance-filtering and token-relinking as one combined extraction (or explicitly thread `importedChainAddress` between them) per the correction above: validation/migration, profile+network restore, account-provenance-filtering-plus-token-relinking as one unit, the 6 ordinary-slice restores, post-finalization chain sync — keeping the top-level function as the transaction coordinator and preserving its existing rollback bookkeeping untouched per stage. Verifier's smallest-safe-first-step pick: extract validation+migration (`:219-312`) first — it's a pure function of `fullBackup`/`checksum`/`backup`, has zero service-client dependencies, and precedes all rollback-bookkeeping state, so it carries zero closure-state risk.

**Effort:** 1-2 days (mechanical extraction; the risk is in re-verifying rollback ordering after each cut, so test coverage should gate each stage).

---

### [ARCHITECTURAL] Q-03: `EventHandler.invoke()` silently swallows every subscriber exception

**Verified:** CONFIRMED (high)

**Impact:** architectural — the defect is one 5-line method, but `EventHandler`/`.invoke(` usage reaches roughly 50 production files across `apps/extension` and other `@nulo/*` packages (config store, logger store, `extension-messaging`'s background/base clients, and effectively every pub/sub relationship in the codebase; fan-out is amplified further by `base-service.ts:130` generically dispatching every service's events through it) | **Confidence-signal:** both, independently | **Smell:** Exception Swallowing (error-handling analog of a missing error boundary)

**Evidence:** `packages/wallet-core/src/utils/event-handler.ts:22-26/28`:
```ts
public invoke(payload: T) {
    for (const callback of this.#callbacks) {
        try { callback(payload) } catch {}
    }
}
```
No `ILogger` hook, no rethrow, no diagnostic — the sole bare, uncommented `catch {}` in the package (verifier re-confirmed via exact grep: this is the ONLY empty `catch {}` in all of `wallet-core/src`). Every sibling swallow in the same package (`utils/lock.ts:56-59,96-100`, `jobs/error.ts:46-51,60-62`, `storage/entity_storage.ts:76-82`, which uses `console.error`) carries an explanatory comment and/or a logging path; `EventHandler` has neither, and the file hasn't been touched since its original import even while the rest of the package's error handling was actively hardened in the same period. No test file exists for it — also independently confirmed.

**Verifier correction (immaterial):** independent grep counts 50 distinct production files referencing `EventHandler` (39 via direct `new EventHandler`), vs. the finding's original "~52" — within rounding, not a substantive correction.

**Strengthened evidence:** `Lock`'s constructor already takes `(name?, logger?: ILogger)` — the proposed fix matches an established, already-proven package pattern rather than introducing a new one.

**Why it harms future change:** adding or editing an event subscriber is one of the most common change shapes in this codebase. If a new subscriber throws, the publisher still appears to succeed — no log line, no subscriber identity, nothing reaches `LoggerStore`. Debugging "my new listener isn't firing" degrades into bisecting a diff instead of reading a log, and because one `EventHandler` typically backs several independent subscribers, one silently-broken listener doesn't stop its siblings from looking healthy.

**Recommended refactoring:** Introduce Error Boundary — add an optional error-reporter/`ILogger` constructor param (mirroring `utils/lock.ts`'s existing pattern) and invoke it with the caught error + event context inside the existing per-subscriber try/catch; add one colocated contract test (none exists today).

**Effort:** hours. Verifier's assessment: zero dispatch-behavior change, cheapest fix in the run relative to its blast radius — the recommended first priority.

---

### [ARCHITECTURAL] Q-04: Composition-root wiring functions are 200-375 line undecomposed closures

**Verified:** CONFIRMED (high)

**Impact:** architectural — these are the two process boot paths for wallet-sdk discovery/session/message dispatch and for the execution subsystem; a bug here affects every dApp interaction and every send/estimate flow | **Confidence-signal:** both for `initWalletSdkHandler`; codex only for `execution/service.ts`'s `init()` | **Smell:** Long Method (Fowler)

**Evidence:**
- `apps/extension/src/wallet/services/wallet-sdk/background.ts:76-450` — `initWalletSdkHandler`, 375 lines, one function that constructs the dispatcher (`:86-101`), owns 3 closure-scoped concurrency collections (`:109-131`), wires a 48-line subframe/zod-validation content listener (independently re-measured; originally reported as ~50) plus 4 more inline protocol callbacks (`:135-320`), monkeypatches `handleEncryptedMessage` with a second hand-rolled FIFO (`:332-344`), then registers 4 more independent listeners (`:356-444`) — 9 distinct concerns sharing one closure's mutable state.
- `apps/extension/src/wallet/services/execution/service.ts:98-367` — `init()`, ~200 lines, more than 20 late-initialized fields typed `= null!` (`:98`) constructed through gas balances, both estimate-reuse caches, cancellation/lane machinery, transfer/view/dApp executors, fee strategies, and cache-invalidation listeners, with several dependencies re-exposed through inline adapter closures (verified at `:201,230,239,286`, each the start of a `new XxxExecutor({...})` with inline adapter closures) whose implicit identity-sharing constraints (every consumer must get the *same* resolver/lane/builder instance) are encoded only by construction order.

**Strengthened evidence (verifier):** the finding understates the risk. The `= null!` typing on the ~25 late-initialized fields disables strict-null-checking entirely for them, so nothing — not even the type system — guards against a reorder that wires a still-`null!` instance into an eagerly-read field. Several dependencies are passed as eager non-closure values (`resolver: this.resolver`, `txBuilder: this.txBuilder`, `planner: this.planner`), which are exactly the ones vulnerable to this; lazy arrow-function-wrapped dependencies are order-independent and safe.

**Why it harms future change:** every one of the 9 (wallet-sdk) or ~8 (execution) concerns is a top-level statement in the same function body sharing the same closure variables. A change to tab-lifecycle handling requires scrolling past unrelated discovery/decrypt/session code to find the right block; a change to one execution collaborator risks breaking another's implicit shared-instance guarantee, since nothing but source order enforces it.

**Recommended refactoring:** Extract Method into named builders — `wireDiscoveryHandling`, `wireSessionMessageQueue`, `wireDecryptSerialization`, `wireTabLifecycle` for wallet-sdk; `buildEstimateCaches`, `buildExecutionLane`, `buildExecutors`, `buildFeeStrategies` for execution — each called in sequence from a slimmed entry point, preserving construction order and instance identity. Verifier's smallest-safe-first-step pick: pilot on the lowest-risk piece first — `buildFeeStrategies` (built entirely from already-set fields at `init()`'s tail, no ordering hazard) or `wireTabLifecycle` (closes only over handler/logger) — and defer the `discoveryQueue` forward-declaration and the eager-value execution fields to a later, more careful pass.

**Effort:** 1-2 days combined (mechanical extraction; wallet-sdk's piece touches security-sensitive validation so needs careful re-test).

---

### [ARCHITECTURAL] Q-05: No shared "alarm-backed periodic task" primitive — 4 independent re-implementations

**Verified:** CONFIRMED-WITH-CORRECTIONS, narrowed (moderate)

**Impact:** architectural, cross-cutting (spans `row-services`, `profile`, and `operation-journal` subsystems) — blast radius: 4 files across 3 different service families | **Confidence-signal:** claude, corroborated by grep-confirmed pattern existence in the 3 out-of-cluster files (not independently deep-audited) | **Smell:** Config/temporal-coupling sprawl — a named analog where each consumer re-derives the same lifecycle instead of sharing one primitive.

**Evidence:** `price/service.ts` hand-rolls an alarm-name constant (`:24`), `ensureAlarm()` wrapping `alarms.create` (`:231-233`), boot-time reconcile logic for a stray alarm surviving a previous service-worker lifetime (`:113-122`), and dispatch routed externally by name from the SW shell (`wallet/index.ts:81-85` — a deliberate "single dispatch path"). The same broad shape — alarm-name constant + `create`/`clear` + boot-reconcile + name-filtered dispatch — recurs in `profile/session-manager.ts` and `operation-journal/{reaper.ts,gc.ts}`, but the verifier found the four are **less uniform** than originally claimed (see corrections).

**Verifier corrections (the finding overstates uniformity — narrows the recommendation):**
1. Session-manager's actual boot reconcile lives in `restore()` (`session-manager.ts:341-432`, esp. `:356-361,428`) — **not** the originally-cited `:70,148,582-638` (which are ctor registration + helpers, not the reconcile itself).
2. Reaper and GC unconditionally recreate-and-sweep on every boot — no conditional "should this alarm even exist" check — a materially different shape from price's gated create-else-clear.
3. `reaper.ts` line cites were off by roughly 40 lines (corrected: create `:118-119`, clear `:139`, dispatch `:142-143`); `gc.ts` cites checked out as originally given.
4. Price's dispatch is centralized externally in the SW shell, inconsistent with the other three services' self-registration pattern — "identical shape" across all four is too strong a claim.
5. Real mechanism differences beyond the above: `periodInMinutes` (price/reaper/gc) vs. a dynamically-recomputed one-shot `when` (session-manager, rescheduled from 4 call sites under `runExclusive`); price and session-manager gate alarm existence on runtime state, while reaper/GC have no enabled-predicate at all.

**Strengthened evidence:** despite the overstated uniformity, this remains a genuine cross-cutting smell — 4 places independently solve "don't let a stray/stale alarm fire wrong," and a fix to that correctness requirement in one place (the exact bug `price/service.ts` already had to solve once) has no structural guarantee of propagating to the other three.

**Why it harms future change:** each of the 4 consumers must independently rediscover and re-implement the same boot-reconciliation and dispatch-filtering correctness requirements, with no shared place a fix lands once.

**Recommended refactoring (narrowed per verifier — do not build the originally-proposed full primitive):** extract only a thin `AlarmDispatcher(name)` wrapper — alarm-name constant + create/clear + name-guard — and leave scheduling semantics (periodic-vs-`when`, gating) per-caller. The originally-proposed full `AlarmBackedTask(name, period, tick, enabled)` primitive does **not** fit session-manager's `when`-based reschedule-under-lock without a redesign, so forcing all 4 consumers onto one shape would either misfit session-manager or under-serve reaper/GC's simpler needs. Migrate GC first — verifier's pick, as the simplest case with no gating to reconcile.

**Effort:** 1-2 days (thin primitive + migrate 4 call sites) — narrower in scope than the original estimate implied, since scheduling semantics stay per-caller.

---

### [ARCHITECTURAL] Q-06: Layering inversion + cyclic type dependency at the messaging/bridge boundary

**Verified:** not verifier-checked (below medium-effort cap)

**Impact:** architectural — both instances sit on public, cross-package type surfaces (`extension-messaging`'s `core/` layer, `wallet-bridge`'s exported `Action`/`AuthwitContent` types) | **Confidence-signal:** both, independently, for both instances | **Smell:** Inappropriate Intimacy (layering inversion) + Cyclic Dependencies

**Evidence:**
- `packages/extension-messaging/src/core/base-client.ts:8` imports `RequestTerminalStatus` from `../offscreen/telemetry` — the transport-agnostic `core/` layer (whose own doc comment says it exists to be shared by any transport) depends on one specific transport's leaf module, used at `TerminalRecord.status` (`:46-53`) and `settle`/`rejectAllPending` (`:214-245`).
- `packages/wallet-bridge/src/action.ts:1,28,34` imports `AuthwitContent` from `authwit-content.ts`; `authwit-content.ts:1,5,10` imports `CallAction`/`EncodedCallAction` back from `action.ts` — a genuine two-file type-level cycle (erased at build since both are `import type`, but real for anyone reasoning about or splitting either module). Both files are publicly re-exported at `wallet-bridge/src/index.ts:12-13`.

**Why it harms future change:** a third transport (or `background/client.ts`, which currently no-ops `onTerminal`) wanting meaningful terminal telemetry would have to fork or grow an offscreen-owned enum with transport-irrelevant cases. Extracting or splitting either `action.ts` or `authwit-content.ts` — a natural next step as the `Action` union grows — requires solving the mutual reference first; `authwit-content.ts` also silently inherits ripple effects from `action.ts`'s shape via `Omit<>` with no explicit signal at the call site.

**Recommended refactoring:** Move Type — relocate `RequestTerminalStatus` into `core/` (offscreen imports it, not the reverse); extract the shared call-payload shape both `action.ts` and `authwit-content.ts` need into a neutral leaf module (`call-shapes.ts`) that both import one-directionally.

**Effort:** hours (pure type relocation, no runtime behavior change either way).

---

### [STRUCTURAL] Q-07: Extracted shared helpers exist but adoption stalled partway — row-service restore/id-generation loops, and UI popup composables

**Verified:** not verifier-checked (below medium-effort cap)

**Impact:** structural, cross-cutting (spans the `row-services` and `ui` clusters — the same meta root cause the task brief flagged) — blast radius: 5 row-service files + 5 more id-generation call sites, plus up to 10 popup components | **Confidence-signal:** claude for the row-services half (codex's blanket "already extracted, NON-FINDING" dismissal did not engage the specific line-cited duplicate loops, so not honored as a refutation); both, narrowed, for the UI-popup half | **Smell:** Duplicate Code — incomplete adoption of an existing extraction.

**Evidence — row services:** `apps/extension/src/wallet/services/restore-rows.ts` centralizes the "for each row: try write, on failure push a `restoreError`-tagged row, never abort the batch" shape, and is correctly used by `contact/service.ts:258-271`, `fpc/service.ts:427-458`, `token/service.ts:739-748`. The identical loop is hand-rolled again in `account/service.ts:345-390`, `network/service.ts:703-752`, `auth-registry/service.ts:431-456`, `transaction/service.ts:505-547`, `config/service.ts:64-87`. Separately, `id-allocators.ts`'s `nextRandomId` (already supports a `length` param) is bypassed by `dapp-session/service.ts:139-142` and `task/service.ts:47-50`, which hand-roll the identical "reroll on collision" loop; the "prefer source id, reroll only on collision" variant every restore path needs isn't in `id-allocators.ts` at all and is hand-rolled 3x (`contact/service.ts:259-263`, `fpc/service.ts:436-439`, `network/service.ts:737-738` — the last with an extra intra-batch collision guard the other two lack, see Bug handoffs).

**Evidence — UI popups:** `apps/extension/src/composables/usePopupEntity.ts` exists and is consumed by exactly 5 of 15 CRUD popups; the shared Enter-submit-guard predicate (fire only when an `<input>`/`<textarea>` is focused) is independently hand-copied — comment and all — into at least 5 more (`NewContactPopup.vue:151-161`, `EditContactPopup.vue:195-203`, `NewFpcPopup.vue:121-127`, `EditFpcPopup.vue:192-197`, `NewTokenPopup.vue:296-301`; claude's fuller sweep additionally cites `NewEndpointPopup.vue`, `ChangeAuthwitsRegistryPopup.vue`, `RevokeAuthwitsPopup.vue`, `EditProfilePopup.vue`, `NewSenderPopup.vue`). Similarly, `useEntityCrud.ts` is consumed by the 5 settings list pages but 4 CRUD popups (`NewFpcPopup.vue:83-92`, `NewContactPopup.vue:33-57`, `EditFpcPopup.vue:129-146`, `EditContactPopup.vue:29-57`) hand-write the same three-handler add/update/delete splice shape instead.

**Why it harms future change:** each hand-rolled copy is a place a future fix (a batch-collision guard, a listener-ordering bug, a splice-shape protocol change) can land in some copies and not others — which has already happened once (`network/service.ts`'s id-reroll got an intra-batch guard the other two copies never received; see Bug handoffs). Codex correctly narrowed the *popup* half: `usePopupEntity`/`useEntityCrud` can't be swapped in wholesale everywhere (some popups have genuinely different listener-timing or subscribe-while-shown needs), which is why the recommendation below is scoped to the safely-shared piece, not a blanket composable swap.

**Recommended refactoring:** row services — route the 5 hand-rolled `restore()` loops through the existing `restoreRows` helper (service-specific pre-loop logic stays as code around the call, not inside a re-copied loop); add a `nextRandomIdPreferring(storage, preferredId, length, avoid?)` to `id-allocators.ts` for the 3 reroll-preserving copies and call the existing `nextRandomId` directly from the 2 fresh-alloc copies. UI popups — extract just the Enter-submit predicate (`isPopupSubmitKey(event)`) for the popups whose lifecycle doesn't cleanly fit `usePopupEntity`, and evaluate `usePopupEntity`/a narrower splice-only helper per-popup rather than uniformly.

**Effort:** 1-2 days (row services) + 1 day (popups) — both are mostly mechanical substitutions once the target helper signature is confirmed per call site.

---

### [STRUCTURAL] Q-08: Hand-rolled keyed-promise-chain FIFO reimplemented independently 3 times

**Verified:** not verifier-checked (below medium-effort cap)

**Impact:** structural — blast radius: 2 files, 3 call sites, each with its own subtly different error-swallow/cleanup logic | **Confidence-signal:** claude (codex's non-finding narrowly disputes only that the 3 sites are *interchangeable with each other* — a different, stronger claim than the one actually made here, which is that each independently reimplements the same "get-previous-or-resolved → chain `.then` → write back" mechanic instead of reusing the `Lock`-per-key idiom the codebase already has proven elsewhere) | **Smell:** Duplicate Code, with a Missing Abstraction analog

**Evidence:** `apps/extension/src/wallet/services/account/service.ts:179-197` (`tupleLocks`/`serializePerTuple`), `apps/extension/src/wallet/services/wallet-sdk/background.ts:334-344` (`decryptQueues`, monkeypatching `handleEncryptedMessage`), and `background.ts:120-131,263-320` (`sessionQueues`/`pendingDiscoveryPromises`) each independently write `const prev = map.get(key) ?? Promise.resolve(); const next = prev.then(op); map.set(key, next.catch(() => {}))` from scratch — while `activity-protocol/coordinator.ts:83,85,94-101`'s `lockFor(map, key)` already solves "serialize per key" correctly via a lazily-created per-key `Lock` + `.withLock()`, unused by any of the 3. Compounding this, `account/service.ts:190-195` has a `finally` block whose comment claims it "cleans up the slot" but is a structural no-op for every input (the guard condition can never be false in the branch that matters) — a documented behavior that was never implemented, discovered only because this duplication was being traced.

**Why it harms future change:** a fix to one chain's error handling or cleanup (like the dead cleanup this file already accumulated) doesn't propagate to the other two; each must be independently reasoned about and independently fixed. A 4th per-key serialization need (there are already 3) will likely become a 4th hand-rolled copy rather than reuse.

**Recommended refactoring:** Extract Class — a `KeyedLock`/`PerKeyQueue` utility in `@nulo/wallet-core/utils` (sibling to `Lock`) wrapping the `Map<string, Lock>` idiom already proven in `activity-protocol/coordinator.ts`; migrate `serializePerTuple` and the decrypt monkeypatch onto it (the session-queue's early-release semantics need checking before migrating it too). Remove or actually implement the dead `finally` cleanup in the same pass.

**Effort:** 1 day.

---

### [STRUCTURAL] Q-09: Row services hand-roll near-identical N-way method families instead of one shared helper

**Verified:** not verifier-checked (below medium-effort cap)

**Impact:** structural — blast radius: 3 files (`token/service.ts`, `dapp-session/service.ts`, `network/service.ts`), all moderate-to-high churn (`token/service.ts` 7 commits/90d, `network/service.ts` the cluster's highest-churn file) | **Confidence-signal:** both for the token-import half; claude only for `DappSessionService` and the `addEndpoint`/`updateEndpoint` pipeline | **Smell:** Duplicate Code (Fowler)

**Evidence:**
- `token/service.ts` has two independent duplications: `getTokenInterface` (`:442-522`) and `parseTokenInterface` (`:533-635`) each separately hand-unroll all 9 `TokenFnKind`s as near-identical statement pairs, exactly the "re-threading" the co-located `TOKEN_FN_DESCRIPTORS` map's own header comment says consumers should iterate instead of. Separately, `addToken` (`:178-268`) and `addSeededToken` (`:283-350`) both build a byte-identical 15-field `Token` object literal and run the identical journal/lock/emit state machine (idempotency check → lock → `simulating` → persist → emit → `succeeded`/`failed`+rethrow).
- `dapp-session/service.ts`: `updateDappSession`, `setVerificationHash`, `setTrustedVerification`, `setAccountAliases`, `setCapabilityGrants`, `setCapabilityRejections` (`:161-262`) each independently repeat "load → null-check → patch one field → save → emit," varying only in which field is assigned.
- `network/service.ts`: `addEndpoint` (`:406-436`) and `updateEndpoint` (`:438-483`) share an ~80%-identical 7-step pipeline (validate → peek unlocked → probe chain id → re-check inside the lock → collision-check → persist → emit), diverging only in push-vs-replace and cache eviction.

**Why it harms future change:** a 10th token-fn-kind, a 7th dApp-session mutable field, or a new endpoint-write invariant each requires copy-pasting an existing N-way block instead of adding one entry to a table — and each copy can silently drift (`token/service.ts`'s two 9-way blocks must stay in lockstep by hand across 4 separate unrolled sites).

**Recommended refactoring:** Extract Method / Template Method throughout — a `buildTokenInterface(artifact, selectFn)` loop over `TOKEN_FN_DESCRIPTORS` for the first token duplication; a `persistToken(...)` helper for the second; a `patchSession(sessionId, patch)` for `DappSessionService`; a `resolveEndpointWrite(...)` for the network pipeline's shared preamble.

**Effort:** 1-2 days total (each sub-instance is a half-day extraction).

---

### [STRUCTURAL] Q-10: Estimate-reuse caches duplicate their stash/evict/validation-ladder shape

**Verified:** not verifier-checked (below medium-effort cap)

**Impact:** structural — blast radius: 2 files, both consumed by `execution/service.ts` (the execution subsystem's fee/gas correctness path) | **Confidence-signal:** both, independently, near-identical evidence | **Smell:** Duplicate Code, with a Data Clumps component

**Evidence:** `TransferEstimateReuse` and `OperationEstimateReuse` (`apps/extension/src/wallet/services/execution/{transfer,operation}-estimate-reuse.ts`) each independently implement: a `Map<string, Entry>` cache with identical stash/evict/`evictStale` (`transfer-estimate-reuse.ts:131-143,239-246` vs. `operation-estimate-reuse.ts:98-110,185-189`); a profile-drift check (`:179-183` vs. `:129-132`); an endpoint-identity check (`:186-195` vs. `:133-137`); a base-fee-fingerprint check (`:203-221` vs. `:171-176`); and a pending-tx-set check that has already incidentally diverged (`Set` vs. sorted array) between the two copies (`:228-233` vs. `:138-145`). The two files already partially acknowledge the overlap — `operation-estimate-reuse.ts:36` imports `ESTIMATE_REUSE_TTL_MS`/`fingerprintBaseFee` directly from the transfer file — but only 2 of ~5 shared elements were factored out. (`gas-balance-reader.ts`'s cache was checked and confirmed structurally distinct — stale-while-revalidate with eviction generations — not part of this duplication, per both reports.)

**Why it harms future change:** a new validation gate added to one reuse cache (the pattern already recurs 4x: profile, endpoint, base-fee, pending-set) must be hand-copied into the other with matching semantics, and the two already show incidental divergence (Set vs. array equality) a shared helper would have prevented.

**Recommended refactoring:** Extract Class for a generic one-shot TTL store, then Extract Function for the shared profile/endpoint/pending-set/base-fee validators; each flow keeps its operation-specific fingerprint/chain-identity/FPC checks.

**Effort:** 1 day.

---

### [STRUCTURAL] Q-11: UI overlay/window shells duplicate markup and CSS instead of sharing a frame component

**Verified:** not verifier-checked (below medium-effort cap)

**Impact:** structural — blast radius: 5 files across 2 UI-shell families, both security-sensitive (dApp consent windows, blocking overlays) | **Confidence-signal:** both, independently, for both sub-families | **Smell:** Duplicate Code (Fowler)

**Evidence:**
- The 3 dApp approval windows (`execute/index.vue`, `discover/index.vue`, `capabilities/index.vue`) — the cluster's most actively-changed surface (5, 5, and 3 commits respectively, clustered around active dApp-execution feature work) — share byte-identical `.wrapper`/`.scroll_area`/`.footer` CSS (`execute/index.vue:561-598`, `discover/index.vue:209-237`, `capabilities/index.vue:388-416`) and a structurally identical footer template (error-tooltip banner + Reject/Confirm button pair), differing only in test-ids, labels, and the disabled expression (`execute:502-544`, `discover:166-202`, `capabilities:341-378`). `useDappApprovalWindow.ts` already extracted the *logic* half (lifecycle, `closeWindow`, profile guard) but deliberately left the markup unextracted.
- `MigrationBarrier.vue` and `AccountIntegrityBarrier.vue` (the latter created by cloning the former) share byte-identical `.wrapper`/`.card`/`.title`/`.sub`/`.detail` CSS (`MigrationBarrier.vue:106-144` vs. `AccountIntegrityBarrier.vue:91-129`) and the same Teleport-overlay + raw-`chrome.storage.local`-read + subscribe-before-read + cleanup skeleton (`:1-76` vs. `:1-64`). Their internal staleness guards are **not** duplicated — codex confirmed they solve genuinely different races (fixed-key events-outrank-snapshot vs. prefix-scan generation-fencing) — so this finding is scoped to the shell/CSS layer only, not the guard logic.

**Why it harms future change:** a visual or accessibility change to either family (loading state on a reject button, overlay stacking, typography) must be applied identically 2-3 times, and because divergent parts (test-ids, labels, banner-vs-no-banner) are interleaved with identical layout code in the same block, a partial edit is easy to make and hard to notice as partial — a real risk given the approval windows' high change frequency.

**Recommended refactoring:** Extract Component — a shared `DappApprovalFooter.vue` (props/slots for labels, test-ids, disabled predicate) for the 3 approval windows; a visual-only `BlockingBarrierFrame` (title/default/detail slots) for the 2 barriers, leaving each barrier's distinct staleness-guard logic in its own owner.

**Effort:** 1 day.

---

### [STRUCTURAL] Q-12: Cross-package sanitizer fork claims "byte-identical" with no enforcing test

**Verified:** not verifier-checked (below medium-effort cap)

**Impact:** structural (correctness-adjacent: a silent drift here means `Input`'s sanitize behavior diverges from backup/contact-import normalization across the two apps that use it) — blast radius: 2 files across 2 packages, each with independent consumers (`packages/design/src/ui/Input.vue`'s `sanitize` prop; multiple extension service-layer callers including backup and contact import) | **Confidence-signal:** both, independently, citing the same lines | **Smell:** Duplicate Code, compounded by Comments-as-deodorant

**Evidence:** `packages/design/src/internal/sanitize.ts:1-18` — doc comment: *"Byte-identical copy of the extension's `utils/string.ts` `sanitizeString`... pinned byte-for-byte... do not 'improve' the regex."* `apps/extension/src/utils/string.ts:33-42` has the identical implementation. `packages/design/src/internal/sanitize.test.ts:4-6` repeats the "keep it verbatim" claim, but its test suite (`:7-35`) only asserts fixed input/output pairs against the **local** copy — it never imports or executes the extension's copy. A fully separate `apps/extension/src/utils/string.test.ts` tests the other side in isolation. Nothing in CI compares the two.

**Why it harms future change:** a future edit to either regex (e.g. extending the allowed character set for a new locale) passes both test suites independently even if the two files have now diverged, silently reintroducing exactly the "Input's sanitize behavior diverges across the two apps" bug both comments warn against — the comments describe a guard that doesn't exist.

**Recommended refactoring:** Introduce Assertion — one cross-package test (in either package, importing both source files) that runs a shared fixture table through both implementations and asserts identical output. Converts the comment's claim into an enforced invariant without touching either implementation.

**Effort:** hours.

---

## Findings NOT pursued (with reasoning)

- **Toast implemented twice (`Toast.vue` vs. `ToastManagerBase.vue`)** — split verdict. Claude framed it as Alternative Classes with Different Interfaces (same domain responsibility, incompatible option shapes, fully disjoint consumers). Codex refuted: the two have genuinely different responsibilities (queue-driven dismissible item vs. teleported singleton manager), not duplicated implementation. Neither side cited evidence strong enough to override the other; left as a design-system-owner judgment call rather than a hard finding.
- **Badge/Tag/DisclaimerTag "chip trio" disjoint tone vocabularies** — refuted by codex with a specific distinction claude's finding didn't address: Badge is a filled semantic-status surface, Tag is an outlined contextual label, DisclaimerTag centralizes fixed product copy — no shared variant implementation exists to safely merge, so unifying `Tag`'s local `Tone` into `SeverityTone` would be forcing an abstraction, not removing one.
- **`checkTransactionCalls`/`checkSimulationTransactions` as a 3rd scope-checker duplication pair** — codex included this pair in its broader scope-checker finding; claude specifically verified and refuted it: the simulation variant's extra guard is load-bearing (it's the sole guard for `simulateTx`, which the dispatcher deliberately skips pre-guarding), so collapsing the two would either weaken a security guard or add a redundant one. The genuinely-duplicated scope-checker pairs (`checkGetContractMetadata`/`checkIsTokenRegistered`/`checkRegisterContract`/`checkGetContractClassMetadata`, and `checkGetAddressBook`/`checkRegisterSender`) are real but were cut from the numbered findings for density — deferred, not refuted.
- **"Ten hand-rolled popup lifecycles, swap in `usePopupEntity` wholesale"** — codex narrowed this: listener timing, target guards, disabled-state gates, and async initialization genuinely differ across the 10 popups, and `usePopupEntity` mandates a specific listener-before-`onShow` ordering not every popup can adopt as-is. The narrower, safe version (the Enter-key predicate specifically) survives in Q-07.
- **"4 CRUD popups, swap in `useEntityCrud` wholesale"** — codex narrowed this: `useEntityCrud` subscribes and fetches immediately at component scope, while several popups construct clients and subscribe only while shown; edit popups also interleave entity-specific side effects into the same handlers. The duplication among the 4 popups themselves is real and survives in Q-07; the specific recommended target composable does not.
- **`restoreRows`/id-allocator "NON-FINDING, already extracted"** (codex) — codex's dismissal was a blanket assertion that did not engage claude's specific, line-cited evidence of 5 services hand-rolling the exact loop `restoreRows` exists to replace. Not honored as a refutation; kept in Q-07 with confidence scoped to claude.
- **Barrier staleness-guard unification** — codex refuted merging `MigrationBarrier`'s and `AccountIntegrityBarrier`'s internal race-guard mechanisms: they solve different races (fixed-key events-outrank-snapshot vs. prefix-scan generation-fencing). Q-11 is scoped to the shell/CSS duplication only, per this correction.
- **`seed.vue`/`key.vue` as "near-identical twins"** — verified directly: codex is right that `key.vue` has grown a public/private key selector (`selectedKey`, extra computed branches) seed.vue doesn't have, so the pages are no longer near-identical overall. The narrower claim (the unlock-lifecycle state machine and agreement-gate template genuinely still duplicate) was independently re-verified as still accurate but was cut from the numbered findings for density.
- **Two coexisting prop-declaration conventions in `packages/design`** — codex called this a non-finding ("both typed now, no drift demonstrated"). Direct verification found this overstated: `Checkbox.vue:5` genuinely uses the untyped array-form `defineProps([...])`, the sole such instance in the package. The narrow Checkbox finding is real but was cut for density rather than promoted to a numbered finding.
- Several other real, single-model findings were cut purely for density and are not re-litigated here in detail: `Lock`/`ReadWriteGuard`'s duplicated force-release watchdog timer machinery (q1-codex); `aztec-runtime`'s split-primitive signatures (`(profileId, chainId)` vs. the package's own `ChainCoordinates`, and `buildTxExecutionRequest`'s 6-parameter list) (q3); `balances.store.ts`'s `fetchGas`/`fetchFpc` skeleton duplication plus its ad-hoc `${key}|${leg}|${epoch}` string-keyed identity (q6); `Input.vue`'s `handleInput` mixing sanitize/warning/3-way type coercion (q7); a small family of dead/speculative API surface (`ActivityScopeReset`, `Input.vue`'s unused `suffix` prop, `Button.vue`'s unemitted `onKeybind`) (q1, q7).

## Cross-cutting observations

- **God-service accretion (Q-01) is the dominant pattern of this audit.** The same "Large Class, Divergent Change" shape recurs in 5 unrelated service families (`WalletSdkDispatcher`, `PxeService`, `NetworkService`, `IncomingTransferService`, `ProfileService`), independently, in files that are each their subsystem's single highest-churn file. This is worth treating as one initiative (incremental Extract Class per file) rather than 5 unrelated cleanups, since the fix template is identical each time.
- **Incomplete adoption of existing extractions (Q-07) is a recurring failure mode, not a one-off.** `restoreRows`, `id-allocators.ts`, `usePopupEntity`, and `useEntityCrud` were all built specifically to kill a duplication and then only partially rolled out — in the popup case, an explicit prior harden-quality arc (`578861be`) scoped the rollout to 5 of 15 popups and documented the rest as deferred, and they're still deferred. When an extraction ships, the rollout itself needs to be tracked as a follow-up task, not assumed to happen opportunistically.
- **Exception swallowing recurs at every layer** — the flagship instance is Q-03 (`EventHandler`, wallet-core, ~50 consumers), but the same undisciplined "catch and return as if normal" shape also appears at the PXE/RPC layer (`getBlockTimestamp` in `packages/aztec-runtime/src/pxe/service.ts:564-577` collapses parse failures, node-transport failures, and genuinely-missing blocks into the same `undefined`, so a node outage is indistinguishable from a legitimate empty result) and at the UI layer (`ConfirmPopup.vue:51-57` and `settings/security/export/key.vue:52-59` both have empty `catch {}` blocks around security-relevant confirmation flows, with no cancellation-vs-failure distinction). Each has a different owner and a different fix, so they're not merged into one finding, but the pattern is systemic enough to warrant a lint/review-checklist rule (no bare `catch {}` without a comment or reporter) rather than fixing each occurrence ad hoc.
- **"Large Class" and "Duplicate Code" compound in the same files.** `PxeService` (Q-01) is both a god class *and* hand-duplicates its own safety-critical fencing logic (IndexedDB deletion, purge-epoch checks); `NetworkService` (Q-01) is both a god class *and* fans its RPC surface across 4 parallel registries (also Q-01). This is consistent with the accretion pattern: as a class grows past the point where its own author can hold it in their head, they re-derive logic that already exists elsewhere in the same file rather than finding and reusing it.
- **Bug handoffs were forwarded to the parallel bugs audit** — 5 correctness-flavored items surfaced incidentally while tracing these quality findings (a dead unreachable-message guard in the dispatcher, a stale version-pin doc comment, a missing intra-batch collision guard on 2 of 3 restore id-reroll copies, a `Popover.vue` listener-leak on unmount, and a pre-existing `(BUG PIN)` in `Input.vue`'s int-subtype parsing) — these are correctness defects, not maintainability findings, so they were not numbered here; they belong to and were routed to the sibling `audit/bugs/` run rather than duplicated into this report.
