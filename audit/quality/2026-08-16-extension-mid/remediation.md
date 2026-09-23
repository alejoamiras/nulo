# Remediation record — quality audit 2026-08-16-extension-mid

Remediation of maintainability findings Q-01..Q-12 from [`report.md`](./report.md), executed as 3 sequential codex-converged PRs into `dev` (arcs 7–9). Every quality arc: characterization pins before refactor → **zero behavior change** → repo gates → dual audit (codex xhigh + fable/opus) over the complete arc diff → converged → squash-merge. The verified findings ([`findings/verified.md`](./findings/verified.md), Q-01..Q-05) were authoritative over [`findings/consolidated.md`](./findings/consolidated.md); Q-06..Q-12 were consolidated-only.

**11 of 12 findings remediated; Q-04 is a codex-agreed documented deferral.** Per the remediation goal, the extraction findings (Q-01, Q-02) were deliberately scoped to their verifier-blessed smallest-safe-first-step — the full god-service decomposition is an owner follow-up, not this remediation.

## Finding → PR map

| Finding | Title (short) | Arc | PR | Status |
|---|---|---|---|---|
| Q-01 | God-service accretion across 5 core services | 9 quality-first-extractions | #396 | ✅ remediated (scoped) — `PxeLifecycleCoordinator` extracts the duplicated purge-epoch fence (the "MED #4" recurring bug class); 5-service split = follow-up F-Q01 |
| Q-02 | 532-line, 11-service full-backup restore coordinator | 9 quality-first-extractions | #396 | ✅ remediated (staged) — `validateAndMigrateBackup` carves out the closure-state-free validation+migration stage; later stages = follow-up F-Q02 |
| Q-03 | `EventHandler.invoke()` silently swallows every subscriber exception | 7 quality-quick-wins | #394 | ✅ remediated — optional `onError` reporter (a callback, not `ILogger` — avoids re-closing the logger↔EventHandler type cycle) |
| Q-04 | Composition-root wiring — 200–375-line undecomposed closures | — | — | ⏸️ **codex-agreed deferral** — architectural, 25 `= null!` init-ordering hazards, bricks-the-SW blast radius; pilot (`buildFeeStrategies`/`wireTabLifecycle`) recorded as the entry point (F-Q04) |
| Q-05 | No shared "alarm-backed periodic task" primitive (4 re-impls) | 7 quality-quick-wins | #394 | ✅ remediated (narrowed) — thin `AlarmDispatcher` (per verified.md — a period-bundling primitive doesn't fit `session-manager`'s `when`-based reschedule); `JournalGC` migrated, other 3 sites = follow-up F-Q05 |
| Q-06 | Layering inversion + cyclic type dependency at messaging/bridge | 7 quality-quick-wins | #394 | ✅ remediated — `RequestTerminalStatus` moved down to `extension-messaging/core`; `call-shapes.ts` breaks the `authwit-content ↔ action` cycle |
| Q-07 | Extracted helpers exist but adoption stalled (restore/id-gen loops, popups) | 8 quality-dedup-adoption | #395 | ✅ remediated — `restoreRows` ×3 + `preferOrReallocId`/`nextRandomId` + `isPopupSubmitKey` ×5; network/config restore + task-id deferred F-Q07 |
| Q-08 | Hand-rolled keyed-promise-chain FIFO ×3 | 8 quality-dedup-adoption | #395 | ✅ remediated — `KeyedLock` (opt-out watchdog for byte-zero-delta); `sessionQueues` + serializePerTuple unhandledrejection = follow-ups F-Q08 |
| Q-09 | Row services hand-roll near-identical N-way method families | 8 quality-dedup-adoption | #395 | ✅ remediated — `patchSession` (dapp-session's 6 setters); token 9-way + network pipeline deferred F-Q09 |
| Q-10 | Estimate-reuse caches duplicate stash/evict/validation-ladder | 8 quality-dedup-adoption | #395 | ✅ remediated — `SingleShotTtlCache` + `pendingHashesChanged` (fixes the incidental Set-vs-array divergence); ladders stay per-caller |
| Q-11 | UI overlay/window shells duplicate markup + CSS | 8 quality-dedup-adoption | #395 | ✅ remediated — `DappApprovalFooter` (3 approval windows, testids verbatim); `BlockingBarrierFrame` (2-site) deferred F-Q11 |
| Q-12 | Cross-package sanitizer fork claims "byte-identical" with no test | 7 quality-quick-wins | #394 | ✅ remediated — `sanitize-parity.test.ts` enforces the invariant |

Arc 0 (#383) committed this audit directory itself.

## Documented deviations (codex-agreed)

- **Q-04 deferral** — both audit legs (codex + fable) agreed: an architectural composition-root refactor with 25 `= null!` eager fields is init-ordering-dominated and boots the SW; pulling even a pilot into arc 9 would violate the arc's smallest-safe-step discipline. Recorded entry point: the verifier's `buildFeeStrategies`/`wireTabLifecycle` pilot.
- **Q-05 narrowed** — verified.md overrode consolidated's full `AlarmBackedTask`: the thin `AlarmDispatcher` (name + create/clear + name-guarded dispatch) fits all 4 sites; scheduling/boot-run/gating stay per-caller.
- **Q-08 zero-delta watchdog** — `Lock` gained an opt-out `maxHoldMs` so all 3 `KeyedLock` adopters stay byte-zero-delta (coordinator keeps its prior 5-min watchdog; the two raw-chain sites disable it). `serializePerTuple`'s pre-existing latent `unhandledrejection` is PINNED verbatim (bug-pin rule), fix tracked separately.
- **Q-02 scheduling note** — extracting the awaited stage adds one promise-reaction turn before the caller's continuation (inherent to any function-extraction of an async stage; unobservable vs the real crypto/migration awaits; strictly re-entrancy-safe). Documented + codex-accepted.

## Owned follow-ups (owner decisions / future arcs)

- **F-Q01** — full 5-service god-class decomposition + the #281-D4 generation/incarnation fence extraction (`provisionChainStoreKey`/`assertGenerationCurrent`).
- **F-Q02** — the remaining `restoreBackup` stages (profile/network/account/token restore, the 6-client loop, finalize/relink) — they share the deliberately-hoisted `createdProfileId`/`finalizeStarted`/`importedChainAddress` rollback state (Q-02 verifier constraint: provenance + relink stay together).
- **F-Q04** — the composition-root closure decomposition (`background.ts` `initWalletSdkHandler`, execution `init()`), pilot-first.
- **F-Q05** — migrate `reaper` / `price/service` / `session-manager` onto `AlarmDispatcher`.
- **F-Q07** — network restore (`unknown[]` rows) + config restore (allowlist skip) + task-id (sync `Map.has`) adoption.
- **F-Q08** — the `sessionQueues` early-release baton (concurrent-sendtx invariant) onto a split-release primitive; drop `serializePerTuple`'s pinned unhandledrejection in a classified behavior arc.
- **F-Q09** — token `getTokenInterface`/`parseTokenInterface` 9-way iteration + `persistToken` + network `resolveEndpointWrite`.
- **F-Q11** — `BlockingBarrierFrame` for the 2 blocking barriers (visual-only; distinct staleness guards stay per-component).

## Follow-up closure (2026-08-18)

All owned quality follow-ups executed as characterization-pinned, zero-behavior-change arcs (`implementations-plan/remediation-followups/plan.md`):

| Item | Arc | PR | Status |
|---|---|---|---|
| F-Q05 (AlarmDispatcher ×3) | 5 primitive-adoption-closure | #408 | ✅ adopted — reaper (full ritual), session-manager + price (create/clear only; the listener constraints documented per site) |
| F-Q07 (restoreRows capability-or-reject) | 5 primitive-adoption-closure | #408 | ✅ resolved — network/config/task REJECTED as correctly-deferred (documented per-site reasons); the missed token-balance site ADOPTED |
| (helper sweep) | 5 primitive-adoption-closure | #408 | ✅ 3 id-allocator adoptions (byte-identical bodies); all other candidates rejected with reasons; KeyedLock/SingleShotTtlCache already fully adopted; popup Enter-handlers flagged as an owner follow-up (adoption would be a behavior change) |
| F-Q09 (row-service method families) | 6 row-service-method-families | #412 | ✅ persistToken extracted (discriminated metadata source — the seed path cannot fetch by construction); token 9-way REJECTED (`getTokenInterface` has zero production callers — owner ask: delete it from the RPC surface); endpoint pipeline REJECTED (both audit legs); updateEndpoint + getTokenInterface pinned from zero coverage |
| F-Q02 (restore stage 2) | 7 restore-stage-2 | #413 | ✅ stages C+D extracted separately with the `importedChainAddress` allow-set threaded explicitly (the codex redesign); the false-coverage hole in the chain-equality check closed; B+G (`createdNetworks`) recorded as the next stage |
| Q-04 (composition-root pilot) | 8 composition-root-pilot | #415 | ✅ pilot shipped (buildFeeStrategies + wireTabLifecycle, pins first) + STOP honored; findings + the DAG-first owner recommendation in `implementations-plan/composition-root-pilot/pilot-findings.md` |

Arc 9 + the remaining god-services: written recommendation only, per the OWNER-GATED charter — `implementations-plan/remediation-followups/arc9-recommendation.md`. The REJECTED list (`sessionQueues` split-release; `BlockingBarrierFrame`) stands.
