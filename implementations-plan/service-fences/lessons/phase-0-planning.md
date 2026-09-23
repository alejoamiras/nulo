# Phase 0 — planning (light tier: single codex audit)

## Codex round 1 — REJECT ×5, all adopted (session logged in scratchpad; rev 2 committed)

The rejection's spine was capture-ordering, twice:

1. **"Synchronously after the await" is NOT atomic with the awaited resolution.** `getProfileSecret` releases the profile lock before the awaiting caller's continuation runs; other queued continuations (a `beginDeletion`) can interleave in the microtask gap, so an epoch captured after the secret await can already be post-bump — the assert then passes and the orphan write lands. Capture must precede the first await. **Lesson: "no interleave window because JS is single-threaded" only holds within one synchronous block — the moment a value crosses an await, anything may have run; capture fences BEFORE the await they guard.**
2. Same bug at restore scale: lazy first-row epoch capture sits after `ensureInitialized`/lock/collision-read awaits — a deletion can complete before the first row's capture. Entry capture (synchronous, post-`ensureInitialized`, before everything else) + entry `isReserved` rejection.
3. **Row shapes lie about ownership**: authwits + balances have no `profileId`, transaction's is optional and backup-controlled. The authoritative `createdProfileId` gets threaded from the composable into those restore RPCs — fence on the passed id, never row fields. **Lesson: before fencing "per profileId", verify each row shape actually HAS one; the audit's prose assumed it.**
4. Optional callbacks make silent fence-disables: `getGeneration?` + `!== undefined` guards stay green in queue-level pins while production wiring is dropped. Required callback = omission is a type error. Also caught a plan-text impossibility (`writeSyncFailure` can't failTask — it holds no taskId).
5. Two representative pins for nine independently-revertible write sites is under-coverage — table-driven per-writer suite (which also creates the missing fpc test file).

Ratified: entry-capture makes the post-deletion-start case the covered one (fully-post-deletion restores out of scope); per-row `restoreError` flood over violating restoreRows' best-effort contract; the runbook's writer-fence mechanism; `dapp-session/mac-storage.ts` adjacency OUT (logged, not fenced — new dependency design not justified by these findings).
