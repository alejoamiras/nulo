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

## Decision ledger

- L1 — **per-site fences, NO shared utility** (cross-layer SW/Vue boundary; B-20 reuses its file's own idiom; ≥3-benefit bar not cleanly met). **Status: THE arc decision — pending codex (its call per the goal).**
- L2 — B-04 both-ends (try/catch + queue reset), not a generation fence. **Status: verified.md, settled.**
- L3 — B-29 use the awaiting-exemption (simplest) for (a); separate monotonic map for (b). **Status: pending audit.**
- L4 — B-08/B-29 may land NOT-REPRODUCED if no deterministic RED. **Status: prove-first will decide.**
