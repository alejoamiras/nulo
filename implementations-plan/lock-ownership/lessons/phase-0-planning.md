# Planning lessons — lock-ownership (batch 4)

## Codex plan audit round 1 (session 01a0376b-b8d9-7c02-b8df-5f537c641b04, xhigh, fresh): REJECT

Six findings, adjudicated:
1. **N-12 fence is TOCTOU** (VALID, redesign): the per-leg gen check precedes the await — a close suspended INSIDE `session.delete()` (which targets the SINGLETON `nulo:core:session` key) still deletes B's row after B writes it; same shape for the alarm clear. Rev 2 direction: a session-manager-INTERNAL artifact mutex (never held across facade calls → no reentrancy trap): open's artifact section {bump generation + write row + schedule alarm} atomic under it; close's artifact section {in-lock gen re-check → delete + clear}. Ordering under the mutex makes both interleavings correct.
2. **Failed open leaves A's bearer restorable** (VALID): bump-at-open-ENTRY stands a close down without B's row ever landing → A's persisted bearer survives its own close. Fixed by the same redesign — the bump moves INSIDE the artifact section, atomic with B's write, so stand-down implies B's row exists (and, singleton key, A's row is gone). Plus a sync-head identity guard: `close(expected?)` no-ops when `activeSession` is no longer the observed session (an off-lock `getActive` close racing an `open` could otherwise nuke B's in-memory session/DEK).
3. **N-17 gaps not exhaustive** (VALID): also getTrust→setTrust (:1080→:1087), markBalanceDirty→upsertRecord (:1117→:1118), and the two emit sites; `hydrateSchedulers` bumps the epoch LOCK-FREE so mid-CS drift is real. Rev 2: re-check before EVERY mutation/emit in the CS.
4. **N-17 pin silently green on revert** (VALID — batch-3 lesson recurring): `onTokenDeleted` queues on the same serviceLock, so it cannot bump while the CS is parked. Rev 2 pin: use the lock-free bump path while parked; assert record+outbox+trust+emits.
5. **Tickets ≠ restored mutual exclusion under watchdog fire** (VALID, half-adopt): H1/H2 overlap during a by-design >5-min hold is inherent to any force-release. Rev 2: `maxHoldMs: null` for the NETWORK service lock specifically (its 30-min hold is by design; queueing is the correct semantic; a wedged clearChainState already wedges the PXE profile barrier anyway) + document the accepted limitation for other locks + per-timer ticket capture (the timer verifies `currentTicket === its ticket` before privileged release) + a pin that H1's stale leave does NOT clear H2's watchdog timer.
6. **Doc examples reference the raw API** (VALID, trivial): update profile/repository.ts:83-92 + purge-rows.ts:7-10 examples.

Holding rev 2 until the parallel Fable audit lands (fold both rounds at once).

## Fable plan audit round 1 (parallel): APPROVE-WITH-CHANGES

Six findings — the converse-ordering fence hole, the vacuous N-17 pin + the GOLD watchdog-handoff recomposition, the f1-1 harness/fence contradiction, the check-first `leave` order + watchdog-own-ticket liveness pins, rationale corrections (storage.session is browser-session-lifetime; `if (!active) return` is the primary benignity), doc adjacencies. All adopted into rev 2; full transcript in audit-fable.md. Notably fable REFUTED codex's blanket-N-17 ask with a mechanistic census — the round's one cross-auditor disagreement.

## Final fresh-context codex pass (session 01a0377c-e5b7-7eb0-8fdc-404326250345): REJECT on rev 2 → rev 3

Five findings, all adopted:
1. Mutex ordering hole — a close entering DURING B's artifact section captured the already-bumped generation (bump-first) and passed its re-check against B's completed artifacts. Fix: **bump LAST = the commit point**.
2. `session.set` rejection indeterminacy — bump-first + reject could stand a close down with A's bearer persisted. Fix: bump-last + best-effort compensating delete on rejection, never bump on reject; rejection-after-write test added.
3. The artifact mutex's own DEFAULT watchdog recreated N-12 at the 5-min mark (stalled delete → B admitted → A's tail clears B's alarm). Fix: `maxHoldMs: null` on the mutex, documented load-bearing.
4. N-17: final pass ruled FOR the two-site placement (disagreement resolved unanimously) but fixed the pin — pre-seed allowed trust, assert post-handoff effects only (the unknown-trust write/emit land pre-park).
5. Both simpler f1-1 orderings pass on revert — the MID-ARTIFACT ordering is the load-bearing pin; added.

Meta-lesson (recurring at every gate this pipeline has run): the first "atomic" design is rarely atomic at the right BOUNDARY — the commit point must be the LAST act of the winning section, and every companion test must be checked for pass-on-revert before it's trusted. Round-3 re-verdict pending on rev 3 (e89bd1b9).

## Gate round 3 (resumed final pass): APPROVE-WITH-CHANGES → GATE PASSED

Bump-last verified sound across "normal, mid-artifact, completed-open, double-close, and restart interleavings"; the watchdog-free artifact mutex endorsed. One folded specification: the rejection branch must preserve session-manager's pinned MEMORY-FIRST DEGRADED SUCCESS contract (:216-220) — compensate → read back → confirmed-absent ⇒ install B + schedule + bump (committed degraded successor); unconfirmable ⇒ abort unbumped (pending close retries). Rev 4 is the plan of record. Gate arc total: 3 rounds, 12 adopted findings, 1 cross-auditor disagreement resolved unanimously, 0 unresolved.
