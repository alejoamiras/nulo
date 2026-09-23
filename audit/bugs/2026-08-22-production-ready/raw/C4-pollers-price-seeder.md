# Cluster C4 — token-balance queue + incoming-transfer pollers + price + seeder (generation-fence/cache lens)

> Scanner: general agent, 2026-08-22.

## C4-1 — BalanceJobQueue has no profile-generation fence inside syncBatch: A→B→A switch admits a cross-profile-computed projection onto the reactivated profile's balance row

**Severity:** Medium-Low (≈Major for affected display) | **Repro confidence:** moderate (every code step verified; needs shared address + double profile switch spanning a slow simulation) | **Type:** Generation-fence gap (TOCTOU across profile switch)

**Counter-example:**
1. Profiles A and B share account address X (backup-restored/imported-key/same-seed). Both have network row chainId C. A active; A owns token T_A (id 5) with balance row {id:5, token:5, account:X}.
2. Trigger enqueues row 5. Tick drains batch; syncBatch starts; projector.project resolves token 5 (A active), enters projectChunk.
3. Mid-chunk (getNetworks/getViewSimulationDeps/batchedViewSimulation awaits — seconds on slow node), user switches to B: onActiveProfileChanged bumps gen, clears tokens, queue.reset() (cancels task; in-flight batch untouched by design).
4. Chunk's remaining awaits now resolve against B: BalanceProjector.project calls networks.getNetworks(chainId)[0] (balance-projector.ts:157) filtered by requireActiveProfile → returns B's network row; getViewSimulationDeps resolves requireActiveProfile → B; accounts.getAccountContract(B.id, C, X) succeeds (B owns X); pxeService.getPXE → proxy stamped with B's network row → every private balance_of_private sim executes against B's PXE store whose note-sync state for X diverges from A's.
5. User switches back to A within window. onActiveProfileChanged rebuilds tokens with T_A (:268-271).
6. In-flight results loop resumes: repo.get(5) exists, deletion fence empty, isRowEmittable(5) === true (map repopulated!) → repo.set commits B-derived balances onto A's row with fresh updatedAt (balance-job-queue.ts:250-260), emits to UI. completeTask throws (task cancelled by reset()), lands in batch catch where finishedAt short-circuits — write silently stands.

**Violated invariant:** "a projection must never persist values computed under a departed profile context" — enforced elsewhere via profileGeneration re-checks after every await (service.ts:61-65, 282-313), but syncBatch relies solely on tokens-map membership which momentarily RESTORES on A→B→A, disarming the guard. Neither isBalanceInvalidated nor isRowEmittable is generation-aware.

**Failing path:** balance-job-queue.ts:186-293 (no gen capture/check anywhere; commit at :260 gated only by :250/:256); enabled by balance-projector.ts:157 + helpers/get-view-simulation-deps.ts:33-37 resolving live active profile mid-projection.

**Expected:** stale-context batch discarded (task fails superseded; row untouched). **Actual:** wrong private balance displayed for A until next successful refresh of that row. No fund risk.

**Smallest safe fix:** pass isGenerationCurrent callback into BalanceJobQueue; capture gen at syncBatch entry; bail after projector.project resolves and again before repo.set. (Alternative: freeze resolved {network, deps} per batch before projection.)

**Instances:** balance-job-queue.ts:213, :232/:260, :264.

## C4-2 — Per-note critical section checks lifecycle epoch once, but serviceLock force-releases after 5 min: stalled PXE timestamp lookup lets a wiped token's record + outbox row resurrect

**Severity:** Low-Medium | **Repro confidence:** moderate (mechanism fully code-verified; trigger requires ≥5-min PXE/offscreen stall with SW alive) | **Type:** Lock-watchdog theft + stale-snapshot commit

**Counter-example:**
1. Note-arm scan enters per-note withServiceLock CS; epoch matches; live re-reads pass. Reaches blockTimestampFor(note.l2BlockNumber) → noteService.getBlockTimestamp → PXE RPC issued WHILE HOLDING serviceLock (incoming-transfer/service.ts:1104; CS spans :1045-1124).
2. Offscreen document wedges; RPC stalls >5 min. Lock's watchdog force-releases at maxHoldMs = 5*60_000 default (wallet-core lock.ts:60-68; serviceLock built with defaults service.ts:203) and dispatches next waiter while CS still executing.
3. onTokenDeleted acquires freed lock: bumps serviceEpoch, tears down schedulers, deletes token's records + outbox rows, resets trust (service.ts:887-933).
4. Stalled PXE call returns; original CS resumes UNSERIALIZED AND UNGUARDED — no epoch re-check after await — executes markBalanceDirty (:1117) + upsertRecord (:1118): ghost receipt for deleted token persisted + balance-outbox row. Nothing sweeps it later.
5. Cascade: CS finally leave() (lock.ts:88) clears locked AGAIN, stealing ownership from whoever acquired at step 3's dispatch — subsequent waiters can overlap too (double-release semantics of watchdog pattern).

**Violated invariant:** CS atomicity assumption ("lock held ⇒ no lifecycle writer interleaves; entry-time epoch check suffices") broken by the watchdog the same lock ships by default. Seeder closed identical purge-vs-commit window by re-checking epoch INSIDE its marker-lock critical section after every await (seeder.ts:259-277); note-arm CS did not.

**Failing path:** incoming-transfer/service.ts:1047 (single epoch check) → :1104 (awaited PXE under lock) → :1117-1118 (unguarded writes); wallet-core lock.ts:63-67 (watchdog leave), :88 (holder late leave steals current owner).

**Expected:** post-wipe resume aborts or blocks until wedge clears. **Actual:** resurrected rows for purged token + degraded mutex for later writers.

**Smallest safe fix:** re-check serviceEpoch !== epochAtStart after EVERY await inside note-arm CS (at minimum immediately after blockTimestampFor resolves before markBalanceDirty/upsertRecord) — mirrors seeder guardsHold. Optionally construct serviceLock with maxHoldMs: null so wedged holder degrades to blocking rather than tearing serialization.

**Instances:** incoming-transfer/service.ts:1045-1124 (only CS holding across a PXE call).

## Verified clean (lens items)

- Delete-vs-write TOCTOU in queue (invalidatedBalanceIds + synchronous pre-repo.set fence + post-write emit re-check + allocateUnfencedId never reallocating fenced ids): interleavings enumerated; resurrection impossible.
- Projector chunking/partial failure: projectChunk catches per chunk → earlier successes commit, later failures surface as per-balance errors; projection read-only, single write once in syncBatch — retries duplicate no side effects. Public-first two-pass indexing consistent.
- Ticker concurrency: ClockTickerAdapter serializes/coalesces (running flag) — stuck-Processing scenarios unreachable; reset()-cancelled tasks' completeTask/failTask throws absorbed by batch catch.
- hydrateSchedulers atomic-commit claim verified — bail check (:756) and commit (:758-772) separated by ZERO awaits; bornAtEpoch fences both arms; initial kicks inherit fence via scanContract entry capture.
- Singleflight Sets delete in finally (:989-991, :842-844) — no leak on throw.
- Trust machine transitions serialize under serviceLock with live re-reads; deregistration bumps epoch BEFORE teardown; fail-closed registration check inside lock.
- Outbox causal chain: setOutbox REPLACES row (repository.ts:146-154) so newer receipt clears stale anchor; busy keeps unanchored with guaranteed progress; transient throws keep row; expired anchored-task recovers via fresh re-request.
- Price kill-switch double-flip: disable neutralizes in-flight synchronously so following enable cannot adopt stale run; four-point gen re-checks incl. post-cache-write; merge-monotonic prevents older-late overwrites.
- Seeder: attempt-before-work documented tradeoff; version-reset handles edge cases incl. corrupt entries; tombstone survives updateMarker guard + commit CS re-check; purge bump-before-lock closes resurrection window.
- classGateCache lead DROPPED: keys include CSPRNG profileId; hit requires byte-exact finalizedTip AND checkpointHash; purged profile's schedulers rebuilt away — no user-visible consequence constructible.
