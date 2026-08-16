# fix-state-fences — Arc 3 of the 2026-08-16 remediation

Six findings in ONE root-cause family: an async operation captured before a state transition (profile switch / chain purge / tx-settle / kill-switch toggle / LRU eviction) resolves AFTER the transition and commits with no generation/identity check. Source of truth: `audit/bugs/2026-08-16-extension-mid/findings/{verified.md (B-04,B-05), consolidated.md (B-08,B-20,B-21,B-29)}`. **Prove-first**: RED repro per finding before its fix; a repro that can't go red after honest effort → codex consult → NOT-REPRODUCED, no code change. Smallest-safe; the shared-utility question is codex's call (below).

## THE arc decision (codex's call, not a default): per-site fences vs one shared utility

The 6 fixes span TWO layers with incompatible concurrency idioms:
- **SW services** (`token-balance/service.ts` B-05, `incoming-transfer/service.ts` B-20, `price/service.ts` B-21): plain async, per-service state, no Vue reactivity.
- **Vue pinia stores** (`balances.store.ts` B-08, `activity.store.ts` B-29): reactive refs, `flush:'sync'` watchers.
- **B-04** is not even a generation fence — it's a defensive try/catch + queue reset.

Crucially, **B-20's fix is applying `incoming-transfer/service.ts`'s OWN existing `epochAtStart` idiom** (already used at :470,:499,:1015,:1219,:1651,:1713) to the one method that forgot it — reusing an in-file pattern, not importing a new one. B-05/B-08/B-21/B-29 each want a *different* shape (generation counter / seq marker / local-identity / monotonic map).

**Proposed (to codex): per-site fences using each file's existing idiom. NO new shared "capture-gen→await→commit-if-current" utility** — the ≥3-benefit bar is not cleanly met (only B-05+B-20 share a shape, and B-20 already has its file's version), the sites cross the SW/Vue layer boundary, and a cross-layer abstraction here adds indirection over five one-to-three-line guards. This is the "simpler-wins / don't over-engineer" case. Codex to confirm or override.

## Findings + fixes

### B-04 (Critical) — profile switch permanently jams a balance's sync
`balance-job-queue.ts:159-167` task-start loop runs BEFORE the try/finally; after a profile switch cleared TaskService's map, `startTask(staleId)` throws outside the try, cleanup never runs, and `enqueue()`'s `!pendingTasks.has(id)` gate coalesces every future enqueue onto the dead entry → permanent jam.
- **Fix (verified.md, both-ends):** wrap the task-start loop per item in try/catch — mint a fresh task on a stale-id failure; AND have `TokenBalanceService.onActiveProfileChanged` reset the queue's `pendingTasks`/`queue`.

### B-05 (Critical) — token-ownership map rebuild race
`token-balance/service.ts:240-248` `onActiveProfileChanged` clears then AWAITS `getTokensRaw(profile.id)` with no generation guard; the emitter doesn't await async subscribers, so rapid A→B→A switches race — the last-resolving rebuild wins and can serve one profile's balances in another's session.
- **Fix:** capture a monotonic profile-generation counter at handler entry; build the repopulated set into a temp map; commit into `this.tokens` only if the captured generation is still current after the await.

### B-08 (Potential Critical) — forced gas refresh overwritten by a slow pre-trigger fetch
`balances.store.ts` uses the TRANSIENT `forcedGasPending` counter as a durability marker; a forced run's wait-out timeout + `finally` can clear it before the outlived pre-trigger RPC resolves, so the stale pre-settlement balance commits `stale:false`.
- **Fix (consolidated):** fence non-forced commits by `forcedGasSeq` (an epoch-style "last forced trigger seen" marker); drop a non-forced commit whose captured trigger-seq is behind the current `forcedGasSeq`.

### B-20 (Major) — stale hydration reinstalls inactive-profile pollers
`incoming-transfer/service.ts` `hydrateSchedulers()` bumps the epoch at entry (:716) but never re-checks a captured epoch before its final scheduler-map commit (:730-743) — unlike the file's 6 other epoch-gated writes. A slow B-hydration resumes after C's clearing pass and appends B's pollers.
- **Fix:** capture the epoch at hydration entry, build the desired scheduler set off-map, commit only if the captured epoch still matches immediately before replacing the maps — the file's OWN existing idiom. Same for `onTokenAdded` (:808-845, shares the root cause).

### B-21 (Major) — kill-switch clobbers a newer refresh's single-flight + timeout
`price/service.ts` `refresh()`/`doRefresh()` `finally` blocks unconditionally clear the shared `this.inflight`/`this.abortController`, so a stale generation's cleanup wipes the newer refresh's promise and can hijack/lose its abort-timeout.
- **Fix:** capture the promise/controller identity locally; clear `this.inflight`/`this.abortController` in `finally` ONLY if they still refer to the completing invocation; each `doRefresh` timeout closure aborts its LOCAL controller, not the shared field.

### B-29 (Minor) — LRU eviction blind to live work (two sub-bugs)
`activity.store.ts` `evictIfNeeded` can (a) drop an unresolved `awaiting` placeholder from a write-hot-but-view-cold slice (`lastAccessedAt` only set at creation), and (b) delete `mutationVersion` alongside the slice → an ABA reset lets a pre-eviction fetch supersede a live tx.
- **Fix:** (a) exempt slices with a non-empty `awaiting` array from eviction (mirrors `balances.store.ts`'s `forcedGasPending` exemption) — simplest of the two options; (b) keep `mutationVersion` in a separate store-lifetime monotonic map that eviction never deletes.

## Prove-first test plan (RED before fix)

Each finding gets a RED repro (fake timers where timing-dependent):
1. B-04: enqueue → profile switch clears tasks → next tick → assert the balance still syncs (fresh task minted), not jammed.
2. B-05: unlock B (slow getTokensRaw) → lock → unlock C (fast) → B resolves → assert `tokens` holds C's, not B's.
3. B-08: slow pre-trigger fetch + a forced fetch that times out and commits, THEN the stale pre-trigger resolves → assert the fresh balance is not overwritten.
4. B-20: slow B-hydration + C-hydration → B resumes → assert only C's schedulers installed.
5. B-21: refresh A stalls, kill-switch toggle, refresh B starts, A settles → assert B's `inflight`/`abortController` not cleared; a third caller doesn't start a duplicate.
6. B-29: (a) write-hot cold-viewed slice with an awaiting placeholder + 32 activations → assert not evicted / placeholder kept; (b) ABA version sequence → assert the stale fetch is rejected.

B-08 and B-29 are moderate-confidence — if a deterministic RED can't be built, codex-consult → NOT-REPRODUCED.

## Validation gates

- `bun run lint` + `bun run typecheck:all`; targeted test files green.
- `bun run audit:vue` (apps/extension touched).
- Armed smoke (arc 3 per goal): `VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build` → `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.
- `NULO_E2E_PROVERLESS=1 bun run e2e:agent` SOLO (arc 3 per goal).

## Security & Adversarial Considerations

These are correctness/state-integrity fixes (wrong balances shown, stale pollers, jammed sync) — no fund-movement path, no new trust boundary, no new persisted shape (all fences are in-memory generation/seq counters). B-05's cross-profile balance display is the most sensitive (a stale rebuild showing profile B's tokens in C's session is an info-integrity issue, not a secret leak).

## Reconciled design (codex + Fable — both conditional approve, both confirm per-site L1)

- **L1 SETTLED** — per-site, no shared utility (both auditors definitive). Only B-05 introduces a new counter; B-08 & B-29(b) reuse existing in-file state; B-20 reuses `serviceEpoch`; B-21 needs identity not a counter.
- **B-04** — both-ends AND **identity-checked cleanup** (codex): recovery catches ONLY the missing/stale-task-id case (not every startTask failure); the batch's `finally { pendingTasks.delete(id) }` deletes ONLY when the stored id === the batch-owned id (else an old batch deletes a newer post-reset task for the same id). Reset disposition: clear queue + pendingTasks on `onActiveProfileChanged`.
- **B-05** — temp-map commit gated on BOTH generation equality AND current-profile-id equality; KEEP the synchronous unconditional `this.tokens.clear()` at handler entry (incl `profile===undefined`); bump generation on EVERY invocation; ALSO generation/profile-check the awaited `onTokenAdded`/`onTokenUpdated` tails via `Token.profileId` (they can independently repopulate the active-only map).
- **B-08 — PROVE-FIRST DECIDES (codex: likely NOT-REPRODUCED).** Codex's analysis: the non-forced run's `withTimeout` starts BEFORE the forced run waits on the same raw promise, both using `INIT_FETCH_TIMEOUT_MS` — so the non-forced run necessarily resolves/times-out before the forced wait can time out and clear `forcedGasPending`; a late raw-promise settlement has no remaining commit continuation. **Action: attempt a deterministic fake-timer RED. If the race proves unreachable → NOT-REPRODUCED (codex-agreed documented deviation), NO code change.** If it DOES go red → extend the existing `forcedGasSeq` check to non-forced commits (Fable), capturing the seq before the await, dropping the whole non-forced commit; do NOT reset the seq on eviction.
- **B-20** — build scheduler DESCRIPTORS off-map (key→contracts, params); keep the entry teardown (clearInterval + map clears :717-723) SYNCHRONOUS at entry; after the epoch check, synchronously create intervals + fire initial-poll kicks in ONE commit. `onTokenAdded`: capture epoch at entry, check before EVERY scheduler/trust side effect after awaits (incl `contracts.add` :842).
- **B-21 — INCOMPLETE per plan (codex).** Local promise/controller identity fixes the named clobbers AND the timeout closes over its LOCAL controller — but stale success can ALSO mutate `consecutiveFailures`/`nextAllowedFetchAt`/`lastCompletedFetchAt`/cache + emit after `cache.set`, and rapid false→true config handlers can race (old disable deletes B's new cache). Fix: generation-check ALL post-await mutations + cache commits; serialize/fence config transitions so a stale generation's cleanup touches nothing it doesn't own.
- **B-29** — (a) awaiting-exemption (bounded growth, acceptable). (b) the monotonic `mutationVersion` fence must SURVIVE LRU eviction (:169), `clearScope` (:267), AND `clearProfile` (:275) — stop deleting it there; `clearAll` (:291) must bump a GLOBAL incarnation before clearing identifiers (else an old fetch repopulates after lock) while keeping its documented privacy clear.
- **Prove-first** — B-04/B-05/B-20/B-21/B-29 deterministically RED-able; B-08 is the one that may legitimately land NOT-REPRODUCED.

## Fable audit conditions (adopted, pending codex reconciliation)

- **L1 CONFIRMED + strengthened** — per-site is right; reading the code makes it stronger: **B-08's `forcedGasSeq` ALREADY exists** (balances.store.ts:185, used :368-369/:410) — the fix EXTENDS its check to non-forced commits, no new state. **B-29(b)'s monotonic map ALREADY exists** (`mutationVersion` :118) — the fix is just NOT deleting it at :169. So only B-05 needs a NEW generation counter; a shared capture-gen utility fits exactly ONE site. Per-site definitive.
- **B-04** — complete (queue reset doubles as a commit fence: cleared pendingTasks → `!taskId` → `continue` at :174/:231). Residual benign (note, don't fix): a post-reset re-key + a pre-switch in-flight batch could falsely complete/fail the fresh task, but same (token,account) data.
- **B-05 (2 conditions)** — (1) KEEP the synchronous `this.tokens.clear()` at handler entry (:243); building off-map without it leaves the OLD profile's tokens visible during the rebuild (regression vs backup()'s fail-closed clear at :344). (2) bump the generation on EVERY invocation INCLUDING `profile === undefined` (lock), else A→lock→A′ leaks. Temp-map commit (clear+bulk-set) is atomic only because it has no interior await — keep it so.
- **B-08** — composes cleanly (epoch fence :406 covers cross-profile; eviction's `forcedGasSeq.delete` :252 covered by the `!entry` check :412). The fix makes the `preTrigger` branch (:417) near-dead — leave as belt, don't refactor.
- **B-20 (2 mandatory refinements)** — (1) keep the entry teardown (`clearInterval` + map clears :717-723) SYNCHRONOUS at entry; gate only the INSTALL (moving teardown to commit lets old-profile intervals fire mid-rebuild with post-bump epochs, breaking clearProfile's :649-653 invariant). (2) "build off-map" = DESCRIPTORS (key→contracts, scheduler params); interval creation AND initial-poll kicks deferred into ONE synchronous epoch-checked commit (can't build a live setInterval off-map). Also fixes an unflagged mid-loop hazard (installs interleave with getAccounts awaits). onTokenAdded: epoch-capture-then-gate the scheduler tail (:829-845); the `contracts.add` at :842 must sit behind the gate.
- **B-21** — inflight+abortController are the load-bearing leaks (catch :325 + pre-commit :315 gate the rest). Optional one-line guard: the post-`cache.set` tail (:317-322) resets `consecutiveFailures`/`nextAllowedFetchAt` + emits without a gen re-check after the await. Fix shape (local `p`/`controller`, identity-checked finally, timeout aborts LOCAL controller) correct.
- **B-29 (condition)** — (a) awaiting-exemption growth bounded (popup-session in-memory; >32 live-placeholder scopes implausible); residual: a never-settling placeholder pins its slice for the session (acceptable). (b) real fix = delete ONLY the `mutationVersion.value.delete` at :169. **Explicit decision required on clearScope (:267)/clearProfile (:275)** — identical ABA shape; `clearAll` (:291) MUST keep clearing (privacy rule).
- **Prove-first** — all six deterministically RED-able (B-08 via fake timers on withTimeout's 20s; B-29 sync store + one controlled promise). NOT-REPRODUCED should be RARE.

## Decision ledger

- L1 — **per-site fences, NO shared utility**. **Status: Fable CONFIRMS (strengthened — B-08/B-29(b) reuse existing in-file state); pending codex (its call per the goal).**
- L2 — B-04 both-ends (try/catch + queue reset), not a generation fence. **Status: verified.md, settled.**
- L3 — B-29 use the awaiting-exemption (simplest) for (a); separate monotonic map for (b). **Status: pending audit.**
- L4 — B-08/B-29 may land NOT-REPRODUCED if no deterministic RED. **Status: prove-first will decide.**
