# Codex plan audit — lock-ownership (round 1)

Session `01a0376b-b8d9-7c02-b8df-5f537c641b04` (xhigh, fresh, read-only). Verdict on rev 1: **REJECT**.

Findings (condensed; adjudication in lessons/phase-0-planning.md and the rev-2 ledger):

1. N-12 fence TOCTOU — the per-leg check precedes the await; a close suspended inside `session.delete()` (SINGLETON key `nulo:core:session`) deletes B's row after B writes it; the alarm-clear leg has the same check→suspend→stale-clear shape. Demanded serialization of the artifact operations or post-drift repair. → ADOPTED (artifact mutex redesign).
2. Failed open leaves A's bearer restorable — bump-at-entry stands a close down without B's row landing; A's persisted row silently restores after SW restart, worse than today. → ADOPTED (bump atomic with B's write inside the mutex; failed open never bumps).
3. N-17 gaps not exhaustive (trust write, dirty→upsert, emits; hydrateSchedulers bumps lock-free). → NARROWED by fable's verified census (only the two PXE awaits are plausible >5-min park points; destructive bumpers hold the lock); two-site placement upheld. The one cross-auditor disagreement — logged.
4. N-17 pin silently green on revert (`onTokenDeleted` queues on the held serviceLock). → ADOPTED (composed watchdog-handoff pin per fable's gold version).
5. Tickets don't restore mutual exclusion under watchdog fire (H1/H2 overlap inherent); the deleteNetwork witness still overlaps a mutator; demanded stated limitation or watchdog disable for that lock; plus per-timer ticket capture and a stale-leave-doesn't-clear-H2's-timer pin. → ADOPTED (network lock `maxHoldMs: null`; documented limitation; watchdog-own-ticket; both pins).
6. Raw-API break invalidates doc examples (profile/repository.ts:83-92, purge-rows.ts:7-10). → ADOPTED (doc sweep, plus fable's additions).

"What looks right": zero real raw callers, the 30-minute witness and reentrancy trap confirmed, handoff-minted unique tickets with stale-leave no-op as the correct containment primitive.
