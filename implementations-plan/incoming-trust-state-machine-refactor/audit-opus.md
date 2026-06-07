# Audit: Per-Triple Lock Refactor Plan (`plan.md`) — Opus Round 1

**Verdict: Approve-with-changes.** Plan is sound at the level of strategy and shape but has at least 4 concrete defects that will produce real bugs or deadlocks on land. The plan keeps too much from "opus" without re-validating ordering claims; phase 3 and phase 6 have material issues.

---

## CRITICAL

**C1. `clearProfile` and `clearChain` second-pass sweep is racy AND unbounded.** Plan §Phase 6.
The proposed `doWipe` snapshots `listTrust()` BEFORE `acquireManyTriples`. A scan can persist a new `pending` trust row in the gap between `listTrust()` and `acquireManyTriples`. Worse: it can also do so between the wipe's release of `acquireManyTriples` and the second-pass `listTrust()` — the second pass takes its own snapshot and again races with new scans. The plan blithely says "if profiling shows it, can loop until empty" (I5) — but under continuous poll cadence (30s + multiple accounts + multiple contracts) the second pass is itself racy and may discover a row that arrives between its own snapshot and second `acquireManyTriples`. **Fix:** acquire a service-wide `clearLock` (or a dedicated "scan blocker" lock) that `scanContract` checks at the top of its locked section to early-return when a clear is in flight. Alternative: take a single triple-set snapshot, do `acquireManyTriples` once, and gate `scanContract` against `isWiping` semaphore. Loop is not acceptable without a bound — `i3 inferences` calling it "negligible probability" is wrong under realistic UX cadence.

**C2. Phase 3 `onTokenDeleted` race: scheduler teardown OUTSIDE lock, rows wipe INSIDE.** Plan §Phase 3 + service.ts:437-484.
A scan for the contract can be parked on PXE (`getNotesRaw` is outside the lock per Phase 4) AFTER scheduler teardown completed. When scan resumes, its locked critical section runs AFTER `onTokenDeleted` releases its lock (FIFO). Scan re-reads tokens inside lock, sees token missing → returns. **But:** the scan acquired its lock BEFORE `onTokenDeleted`'s wipe critical section if scan arrived first. Then scan upserts a new `pending` row → `onTokenDeleted` runs second, wipes records + resets trust. End-state coherent. So far OK.
However: between scheduler teardown and the wipe critical section, a NEW poll cannot enqueue (scheduler is torn down). But an existing in-flight scan that hasn't yet reached `withTripleLock` for its per-note section CAN still enter the lock and write rows. That's the exact race the design intends to close. The lock will serialize them; final state will be wipe-after-scan → wipe wins → end state correct. **Verdict:** the ordering actually works, but the plan's comment "scheduler teardown stays OUTSIDE the lock" is misleading — the actual safety relies on the lock-fairness of subsequent re-entries. Plan §3 D-list should call this out explicitly.

---

## HIGH

**H1. Phase 4 — pre-fetched `blockTimestampCache` becomes incoherent across per-note critical sections.** Plan §Phase 4.
Plan prefetches `blockTimestampCache` outside lock once, then enters lock PER NOTE. Between note K and note K+1 a writer can set trust to `blocked` and another writer can wipe records. Note K+1's locked section observes the new state correctly — but the cached `blockTimestamp` for that note is fine (it's PXE-derived). **However:** trust transitioning `unknown → pending` happens ONLY for the FIRST note that hits the lock; subsequent notes find `pending` and don't re-emit Pending. If between notes K and K+1, `setTrustAllow` runs (flips `pending → trusted` + flips ALL records visible from K's snapshot), then note K+1 inserts as `trusted` visible. That's correct behavior. **But:** the `onIncomingTransferAdded` emit for K+1 fires inside K+1's lock — `setTrustAllow` had already emitted Added for K because K was persisted hidden first and then flipped. So **K is emitted TWICE: once by `setTrustAllow`'s flip loop and once by scan when scan inserts K**? No — scan inserts K BEFORE the gap, then `setTrustAllow` flips K visible (emit). Then scan resumes for K+1, inserts K+1 as `trusted` (emit). One emit per record. OK.
The actual problem: between notes K and K+1, `onTokenDeleted` can land, wipe ALL records (including K), set trust unknown. Note K+1's locked section reads tokens — sees no token → returns. So K+1 is NOT persisted. But what about notes K+2..N? Same path. **Wait — that's actually correct: token gone, no rows persisted.** The plan claim that "user's Allow click between notes affects subsequent iterations" is sound. **Verdict:** the per-note lock pattern is correct, but Phase 4 documentation does not explain the trust-transition emit happens only on the FIRST note's locked section; subsequent notes from the same poll bypass the pending emit. The plan glosses this.

**H2. Per-iteration `getRecord` re-check IS still required even with the lock — plan §Phase 1 incorrectly drops it.** Plan lines 92-94, 270-276 of service.ts.
The plan says "Snapshot stays accurate inside the lock." That's true with respect to other LOCK-HOLDING writers. But the audit-5-skips fixture at scenarios.test.ts:1731-1786 directly mutates the `records` Map (bypassing `repo`, bypassing the service, bypassing the lock). The plan §Phase 7 acknowledges this: "the fixture deletes from the underlying Map directly (not via the service) which doesn't acquire the lock." Plan claims this becomes "a regression pin that 'the lock doesn't accidentally resurrect externally-deleted rows'." **But if the per-iteration `getRecord` check is dropped, the loop WILL resurrect externally-deleted rows.** This contradicts the plan's own keep-as-regression-pin claim. **Fix:** either keep the per-iteration `getRecord` re-check (cheap, the lock makes it almost always a no-op except in this exact fixture case), OR update the fixture's pin to allow resurrection (semantic shift).

**H3. `onAccountDeleted` is missing from the lock-coverage list.** service.ts:184-202 + plan §Phase 3.
`onAccountDeleted` tears down schedulers for `(network, deletedAccount)` keys but does NOT touch records or trust rows. Records belonging to that account survive — they're contract-scoped trust, account-scoped records (per spec). The plan's locked decision says "account is removed but contract trust survives" implicitly. But records for the deleted account ARE owned by the triple — and `clearProfile/clearChain` would wipe them later. Concurrent `onAccountDeleted` + in-flight scan for the same triple: scan completes, persists a row for the (now-deleted) account. The lock doesn't help because the scan's locked section doesn't know the account was deleted (the lock key has no account). **Fix:** `onAccountDeleted` should also wipe records for the deleted account per triple inside the lock for each affected contract. Plan section 3 "Concurrency invariants" question explicitly asks this and never answers it.

**H4. Async event subscriber throwing inside the critical section.** Plan §Section 3 "Eventual delivery."
Plan claims "if a Vue subscriber throws, next critical section still runs (lock leaves in `finally`)." **Verify:** `this.emit()` is sync-fires-async (F7). If a subscriber throws synchronously during `EventHandler.invoke`, the throw propagates up the `await this._setTrustStateLocked` chain. `withTripleLock`'s `finally` releases the lock — good. **But:** the lock-holder's `await` chain rejects, so the public `setTrustState` rejects too. PopupManager's `allow:() => setTrustAllow(...)` then rejects → IncomingTrustPopup catches via `ok !== false` — but `ok` is `undefined` (rejected promise unwrap), so `ok !== false` is `true`, popup treats as success even though it threw. **This is a pre-existing bug**, not a refactor regression, but plan should call it out.

---

## MEDIUM

**M1. `replayPendingPrompts` outer `tokens` snapshot still races (the race the plan didn't close).** Plan §Phase 2.
The outer `await this.tokenService.getTokensRaw(profileId)` is taken before any lock. The plan then takes per-row lock + re-reads `getTrust` live inside. **It does NOT re-read tokens live inside the lock.** Plan §Phase 6 of opus did. Consolidated plan dropped this. If `onTokenDeleted` runs between the outer `getTokensRaw` and a per-row critical section, the outer `tokens` array still includes the deleted token; the locked section finds `token` and emits Pending for a deleted contract. **Fix:** re-read tokens live inside the per-row lock (mirrors what opus had, lines 277-280 of plan-opus.md). Plan §Phase 2 currently misses this.

**M2. `acquireManyTriples` deadlock-by-starvation.** Plan §Phase 0, Phase 6.
Lexicographic ordering is correct for deadlock avoidance vs other `acquireManyTriples` calls. But a `clearProfile` acquiring 50 triples in order while individual `scanContract` calls keep grabbing single triples FIFO: clear's acquire-set holds locks for the duration; each scan request enqueues; clear holds A, then waits for B; new scan for A enqueues behind clear; meanwhile clear's wait for B is behind other scans. Wall-clock: bulk wipe of 50 triples under realistic 30s poll cadence could be tens of seconds blocked. **Plan claims FIFO solves starvation** (D3) — but FIFO solves single-lock starvation, not multi-lock acquisition holdup. **Recommended:** acquireMany should release each previous lock if it can't acquire the next within a bound, then retry — OR (simpler) bounded clearLock barrier (see C1).

**M3. Lock-map ref-count leak under exception during `getOrCreateTripleLock`.** Plan §Phase 0.
If `withTripleLock`'s `fn()` throws BEFORE `lock.enter()` resolves (e.g., synchronous exception in the wrapper), the `refCount++` already ran but the `finally` may not — depends on the precise wrapper code. Plan does not show the helper body. **Fix:** put `refCount` increment AFTER `lock.enter()` returns, decrement in `finally` regardless of fn outcome.

**M4. `setTrustState` public wrapper is still exposed via spec.ts:135 + client.ts:41 — IPC callers can invoke it from outside.** Plan §Phase 1 + spec.ts:135.
The plan says the public method "becomes a thin wrapper around `_setTrustStateLocked`." Good — that's lock-safe. BUT: `setTrustState` is on the public `Methods` interface (spec.ts:135) and routes via IPC (client.ts:41). The dApp / popup can call it with arbitrary `state` including `"blocked"` directly. This bypasses the FSM `unknown → pending → trusted | blocked` constraint (User-locked decision #3). The lock alone does NOT enforce the FSM. Plan §3 acknowledges this ("filed as Open Question") but if "wallet has imminent real users" — this is a footgun TODAY. Recommend: either remove `setTrustState` from `Methods` (only setTrustAllow/Reject IPC-exposed) or add transition validation. Not strictly a refactor regression, but the plan is the right venue.

---

## LOW

**L1. SW restart mid-critical-section.** Not addressed.
Lock is in-process. SW restart drops the entire service + Map + Lock state. A critical section partway through writing both `repo.setTrust(pending)` and `repo.upsertRecord(...)` may complete only the first write before SW dies. Storage now in an inconsistent state: `pending` trust but no records. Next service init re-runs scans, observes pending trust + sees notes, finds existing trust row (`pending`), buildRecord runs and persists. End state recovers. **Acceptable residual** — plan should document.

**L2. `forceReleaseTimer` cleared in `leave()` — but in plan's `withTripleLock`'s `finally`, `lock.leave()` is called even if the critical section was force-released by timer.** lock.ts:47-51. `leave()` sets `locked=false` unconditionally; if a queue holder already entered, that holder's force-release timer would have started fresh — the leaving caller would `clearTimeout(undefined)` (no-op) — no corruption. Lock primitive is robust here.

**L3. The 60+ tests assumption (plan §Success criteria) is stale.** Actual scenarios test file is 1840 LoC. Plan should re-count or just say "all scenario tests pass."

---

## Things that look fine (verified)

- `trustKey(profileId, networkId, contract)` already exists at `repository.ts:25` and matches plan's lock-key claim (F4 verified).
- 8 writer count is accurate against service.ts (`scanContract`, `setTrustState`, `setTrustAllow`, `setTrustReject`, `onTokenDeleted`, `onTransactionAdded`, `clearProfile`, `clearChain`).
- `Lock` primitive is FIFO, non-reentrant, force-release at 5 min, no `isIdle`/`isHeld` accessor — plan's ref-counted eviction correctly avoids touching `wallet-core` (F1 verified).
- `setTrustAllow`/`setTrustReject` reentrancy via `setTrustState` (service.ts:247, 299) IS a real deadlock surface; plan's split into `_setTrustStateLocked` is necessary and correct.
- UI consumers in PopupManager.vue:100-101, IncomingTrustPopup.vue:20-21, NewTokenPopup.vue:224 only depend on boolean return — refactor preserves contract (F6, F8 verified).
- Per-iteration `getRecord` re-check at service.ts:275-276 is correctly identified.
- `txDeleteInflight` set at service.ts:491-518 — lock supersedes it correctly.
- `EventHandler.invoke` sync-fires-async (F7) — confirms double-emit risk on `onTransactionAdded` is real, lock solves it.
- Lexicographic `acquireManyTriples` ordering prevents AB-BA deadlock between concurrent multi-triple operations.

---

## Round 2 (push-back)

**Verdict: REJECT** (needs revision before implementation).

The iteration closed Round-1 finds but introduced new defects from the swap-out: `isWiping` semaphore is racy at the boundary; drain pattern is incomplete; `onAccountAdded` is now missing from coverage despite Phase 3.5; dropping `txDeleteInflight` opens a new same-hash regression; and the "no eviction" decision is fine memory-wise but I anchored too easily on the "single-PR big-bang" framing.

### CRITICAL — what I missed in Round 1 / new in Round 2

**C1. `isWiping` TOCTOU at the per-note boundary.** Phase 4, lines 266-267. The check `if (this.isWiping.value) return` runs OUTSIDE `withTripleLock`. Sequence: scan reads `isWiping=false` → scan calls `withTripleLock` (awaits queue) → during the await `clearProfile` flips `isWiping=true`, drains every existing triple lock, calls `repo.clearProfile`, flips `isWiping=false` → scan's lock turn arrives, runs the full critical section against now-empty storage, writes `pending` trust row + record for a profile that was just wiped. **End state: zombie trust row + record survive `clearProfile`.** The check must be re-read INSIDE the lock, after `enter()` resolves, before any repo write. Plan's `withTripleLock` wrapper doesn't show this. Fix: add `if (this.isWiping.value) return` as the first line inside the locked closure for every writer.

**C2. Drain pattern leaks late-discovered triples.** Phase 6, lines 399-402. `clearProfile` drains `await this.repo.listTrust()` filtered to that profile. But the closed C1 race in Round 1 ("late-discovered triple") still exists in a new dress: a scan can hold `withTripleLock` for triple `X` that does NOT YET have a trust row when `listTrust()` is taken. That scan is past PXE, queued on the lock, will create the trust row inside its CS. Drain skips X because X isn't in `trustRows`. Drain proceeds to `repo.clearProfile`. Scan's CS then writes a trust row for X. **Same zombie outcome.** Round 1 flagged this as "racy AND unbounded"; the new design only fixed "unbounded" by adding `isWiping`, but the `isWiping` check is itself racy (C1 above). Fix: drain MUST also acquire+release locks for EVERY triple currently in `tripleLocks.keys()` AND combine with the inside-lock recheck. Even simpler: a global service-level `Lock` for clear operations + `isWiping` re-checked inside every triple lock CS.

**C3. Dropping `txDeleteInflight` is a regression.** Phase 5. F7 (reworded) confirms `EventHandler.invoke` is sync — two `onTransactionAdded` handlers fire back-to-back synchronously. Each is async; both reach `listByTxHash` before either `deleteRecord` runs. Two records share the same `tx.hash` across DIFFERENT contracts (legal per existing comment service.ts:507-511 "split-fee / sponsored flows"). The lock is keyed per-contract — handler A acquires lock for contract X, handler B acquires lock for contract Y → no serialization → both call `repo.getRecord` → both find the record → both delete + emit. **Double-emit regression.** `txDeleteInflight` guarded on `tx.hash` which is contract-agnostic. The plan's per-record `getRecord` re-check inside lock doesn't help when the two handlers are on DIFFERENT locks. Fix: keep `txDeleteInflight` OR widen the lock key for `onTransactionAdded` OR add a per-`(profile,network,account,hash)` guard.

### HIGH

**H1. `onAccountAdded` lock coverage missing.** Phase 3.5 covers DELETE but plan §service.ts:175-182 shows `onAccountAdded` calls `hydrateSchedulers()` which mutates `watchedContracts` / `schedulers` — not under any lock. A scan in flight for `(profile, network, contract)` on a SAME-contract NEW account fires unprotected. Worse: `hydrateSchedulers` (line 370-372) currently bumps `scanGenerations`; the plan removes that primitive but doesn't add a lock equivalent. After Phase 4 lands, an in-flight scan past PXE will write rows for a contract that account-add concurrently re-hydrated. Plan needs Phase 3.6 covering `onAccountAdded` or proof its lock-independence is safe.

**H2. `isWiping` is a plain boolean read without memory-barrier semantics.** JS single-threaded so technically OK across microtasks, but `isWiping = { value: false }` is a closure-captured object — if any helper destructures `value` early (e.g., `const { isWiping } = this`) the check reads stale. Defensive: make it a method (`isWipeInProgress()`) that reads the field at call-time.

### MEDIUM

**M1. Anchoring on "single-PR big-bang switch".** Round 1 accepted Locked Decision #1 without challenge. Six-phase commit shape with 8 writers, 3 retired primitives, and a `wallet-core` test phase is high blast-radius. A phased rollout (Phase -1 + Phase 0 + Phase 1 land first; Phase 4 + 5 + 6 in a follow-up PR) would let LR1 prove value before the riskier scanContract/clearProfile rewrites. Recommend: ask user to consider 2-PR split.

**M2. Anchored on "Lock-per-triple Map" over "global service Lock".** Plan §Locked Decision #2. A SINGLE service-wide `Lock` would serialize ALL writers — simpler, no Map, no `acquireMany`, no `tripleLocks.size` bookkeeping, no LR5/LR10 parallelism tests. Cost: scan A for `(profile,net,contractX)` blocks scan B for `(profile,net,contractY)`. With realistic load (hundreds of contracts, 30s poll), the contention is bounded by PXE latency — and PXE is OUTSIDE the lock per Phase 4. Worth investigating before committing to Map design.

**M3. Long-running browser session memory growth dismissed too easily.** Plan §Phase 0 says "hundreds of entries × Lock-instance size ≈ tens of KB." On a long-running SW (no restart for days), with malicious dApps `register_token`-spamming distinct contracts, this grows unbounded. The drop-eviction decision was anchored on Codex's force-release-resurrection concern, but the simpler fix is: eviction only when `Lock.queue.length === 0 && !locked` AND wrap eviction in `isWiping` semaphore.

### LOW

**L1.** F7 reworded correctly per Round 1, but the popup misread (Ask A3 deferred) is the SAME bug surface a future refactor will encounter — flag for user reconsideration.

**L2.** LR1 regression-pin description doesn't specify which `Allow` event is `await`-blocked. Specify "test parks scan's `withTripleLock` call mid-`enter()`".

### Where I anchored in Round 1
Accepted Locked Decisions 1-4 wholesale. Did not challenge big-bang shape, Map-vs-singleton lock design, or the unbounded growth assumption. Codex was right to push harder on lifecycle primitives.
