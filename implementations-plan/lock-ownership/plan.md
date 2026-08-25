# lock-ownership — batch 4 of audit-448-remediation (rev 4, gate-approved)

Fixes **N-11 (Major, launch gate)** — `Lock`'s watchdog force-release + ownerless `leave()` lets a late holder release a stranger's acquisition, collapsing mutual exclusion for every service lock (harm witness: `deleteNetwork` holds the network lock across `purgeChain` → `clearChainState`, which deliberately carries the 30-min prove-tx envelope, 6× the 5-min watchdog) — **N-12 (Minor)** — the session-TTL reader-triggered `close()` runs off-serializer and its suspended tail destroys a NEWER session's artifacts (row delete on the singleton key + lock-alarm clear; lazy auto-lock dead) — and **N-17 (Minor, opportunistic)** — the incoming-transfer note-CS checks its lifecycle epoch once at entry but writes durables after PXE-bound awaits with no re-check. Spec: `implementations-plan/audit-448-remediation/runbook.md` (batch 4); verdicts: `audit/bugs/2026-08-22-production-ready/adjudication-2026-08-24.md`; recon: [recon.md](./recon.md); audit trail: [audit-codex.md](./audit-codex.md) + [audit-fable.md](./audit-fable.md). Base: dev `8710518d`. Tier: **mid**.

**Scope:** N-11 + N-12 + N-17, adopting proofs `p1-1` and `f1-1` as colocated regression pins (audit/ copies untouched). OUT: `ReadWriteGuard` writer-path watchdog (recon follow-up flag), epoch-fence unification, `TokenSeeder.markerLock`, caller-structure changes (recon + both audits verified zero raw `enter()`/`leave()` application callers; the one split site is `ReadWriteGuard` in pxe/service.ts, already-safe).

## Clarifying questions (self-answered per goal; ratified through the audit rounds)

- **Done =** p1-1/f1-1 adoptions GREEN with the fixes and RED on revert; the deferral pin at `lock.test.ts:249-287` inverted; N-17 re-checks + the composed watchdog-handoff pin; full battery green; PR merged.
- **Quality bar**: production (launch gate). **Validation layers**: audit:vue per phase; final battery = audit:vue + armed-build smoke + full solo `e2e:agent`.

## Architecture & Implementation

### N-11 — owner ticket inside `Lock` (packages/wallet-core/src/utils/lock.ts)

Entire fix in the one class; zero caller changes (all consumers are `withLock`-style; `KeyedLock` only calls `withLock`).

- `type LockTicket = symbol` (exported, opaque; named "ticket" — `ReadWriteGuard.readerTokens` already means force-release AGING, avoid the collision). Private `currentTicket: LockTicket | null`.
- **All grants flow through `dispatch()`** (there is no separate uncontended path — enter() enqueues and dispatches): `dispatch()` mints `Symbol("lock-ticket")` at HANDOFF, sets `currentTicket`, arms the watchdog for that grant, resolves the waiter WITH the ticket. `enter(): Promise<LockTicket>`.
- `leave(ticket)`: **the ticket check is the FIRST statement** — on mismatch, log one Warn and return WITHOUT touching the timer or state (order is load-bearing: clearing the timer before the check would let a stale leave disarm the CURRENT holder's watchdog while every other assertion stays green — a silently revertible liveness kill). On match: clear timer, `currentTicket = null`, unlock, dispatch.
- **Watchdog uses its own ticket** (runbook requirement): the timer callback closes over the ticket minted for ITS grant and force-releases ONLY IF `currentTicket === armedTicket` (belt over clearTimeout semantics). Privileged release: log Error, `currentTicket = null`, unlock, dispatch (next holder minted fresh). The displaced holder's later `leave(stale)` no-ops.
- `withLock` threads the ticket internally; its leave-iff-entered contract and the never-reject-after-grant invariant (:30-39) are preserved.
- Raw-API break deliberate; only `lock.test.ts` uses it.
- **Accepted limitation (documented in code)**: tickets stop theft and cascade, they do NOT prevent H1/H2 overlap when the watchdog fires during a still-running legitimate hold — that is inherent to any force-release. For the one lock whose >5-min holds are BY DESIGN, overlap is guaranteed, so:
- **`NetworkService.lock` gets `maxHoldMs: null`** (network/service.ts:212): `deleteNetwork`'s 30-min `clearChainState` drain is intentional; queueing mutators behind it is the correct semantic, and a genuinely wedged clearChainState already wedges the PXE profile barrier regardless (recon). One-line change + rationale comment.

Tests (`lock.test.ts` rewrite):
- **p1-1 adoption** replaces the deferral pin (:249-287): H1 wedged past a tiny watchdog → W2 granted → H1's late `leave(stale)` no-ops → queued W3 does NOT enter until W2's own leave → W3 enters. RED on revert.
- **Stale-leave-preserves-watchdog pin** (fable): after H1's stale leave, W2 wedges past maxHoldMs → W3 IS admitted by W2's OWN watchdog (proves the stale leave disarmed nothing). RED if leave clears the timer before the ticket check.
- Watchdog-own-ticket pin: a timer callback whose grant was already superseded must not force-release the successor.
- Adapted raw-API pins: leave with a foreign symbol no-ops; double `leave(sameTicket)` second call no-ops; enter-reject invariant (fix its stale `holdsLock` comment); non-reentrancy unchanged.

### N-12 — artifact mutex + generation fence in `SessionManager` (apps/extension/src/wallet/services/profile/session-manager.ts)

Redesigned after both audits killed rev 1's bare fence (TOCTOU: the per-leg check precedes the await, and `session.delete()` targets the SINGLETON `nulo:core:session` key — a suspended delete destroys B's row after B writes it; converse ordering: a close capturing AFTER open's entry-bump never mismatches and clears B's alarm).

- Private **artifact mutex** (`artifactLock = new Lock("session-artifacts", logger, null)`) — session-manager-INTERNAL, never held across facade-locked calls, so the runbook's reentrancy TRAP cannot fire. **`maxHoldMs: null` is load-bearing** (final-pass finding): a default watchdog would re-admit B's section 5 minutes into a stalled delete and A's resumed tail would then clear B's alarm — the exact N-12 harm reborn inside the fix. The mutex's legs are storage/alarms ops with no by-design long holds; a wedge there is a broken browser, and the PXE-style liveness concern doesn't apply.
- `open()`: crypto prep (wrapPair etc.) stays outside; the **artifact section** runs under the mutex in this strict order: `{ write row → install activeSession → schedule alarm → sessionGeneration++ }` — **the bump is LAST, the commit point** (final-pass finding: bump-first let a close that entered mid-section capture the already-bumped value and then pass its re-check against B's completed artifacts). A close capturing at its own entry therefore sees the pre-section value until B has FULLY landed.
- **`session.set` rejection is indeterminate** (it may have written), and the existing contract (session-manager.ts:216-220) pins MEMORY-FIRST DEGRADED SUCCESS when persistence fails — the rejection branch must not silently change that. Specified (final-pass round 3): on rejection, compensate (delete the row) and **read back**. Row absence CONFIRMED → install B in memory, schedule B's alarm, then bump — the degraded in-memory session is a committed successor and A's bearer is confirmed gone. Absence NOT confirmable (compensation/read-back also failing) → abort without installing or bumping; the pending close retries cleanup, and `restore()`'s expiry gate bounds the residue. Tested (rejection-after-write ordering, both sub-branches).
- `close(expected?)`: captures `const gen = this.sessionGeneration` at ENTRY; sync head keeps the **identity guard** (belt — when `expected` is passed and `this.activeSession !== expected`, return untouched) plus the unchanged zeroize/drop/emit; then the **artifact section** under the mutex: `{ if (this.sessionGeneration !== gen) stand down; else delete row; clear alarm }`.
- Why every interleaving is now correct: the legs serialize under the mutex, and with the bump as open's LAST act, a close's re-check passing implies NO successor committed (safe to delete what's there — either A's row or a failed open's debris); a re-check failing implies the successor FULLY landed (stand down touches nothing). Close-enters-during-B's-section queues on the mutex, and its entry-captured generation predates B's commit → mismatch → stand down. Close-enters-before-B's-section runs first, cleans A, and B lands cleanly after. A failed open never bumps, so A's close always completes its cleanup — no restorable bearer.
- Corrected rationale (fable): `chrome.storage.session` survives SW suspension (browser-session lifetime — silent re-unlock is a feature, NOT ephemerality); the residual stale-row case stays benign because only EXPIRY closes reach this off-lock (manual lock/delete closes are `runExclusive`-serialized) and `restore()`'s `isExpired` gate (:452-455) drops an expired leftover. A stale alarm after a stood-down close is benign primarily via `onAlarmFired`'s `if (!active) return` short-circuit (:729), with the `scheduledTime === expectedLockedAt` gate (:731) as the second belt.
- `silentClose()` (:601-610) shares the delete+clear legs unfenced — safe ONLY because it is init-only pre-`ensureInitialized`; add the invariant comment (fable adjacency).

Tests (**f1-1 adoption**, colocated, FakeBrowserApi):
- Gated-delete ordering: A's close parked INSIDE the mutex'd delete; B's open QUEUES on the mutex; release → A's delete completes (A's row — B hasn't written), A clears A's alarm, THEN B's section writes B + schedules B. Assert: B's row present, B's alarm scheduled and never cleared. (The proof's literal "zero clears total" becomes "B's alarm never cleared" — A clearing its OWN alarm is legitimate under serialized ordering.)
- **Mid-artifact ordering (the load-bearing new pin — both prior orderings pass with the fence reverted)**: B's open parked INSIDE its artifact section (gated row write); the expiry close for A passes its identity guard (A still installed), captures the PRE-bump generation, queues on the mutex; B completes {write, install, schedule, bump}; the close's section then MISMATCHES and stands down. Assert: B's row + B's alarm intact. RED on revert of bump-last or of the in-mutex re-check.
- Full stand-down ordering: B's open completes first → A's close head identity-guard stands down → B's artifacts untouched; assert A's DEK zeroize still happened.
- Failed open (pre-section): open throws before the artifact section → generation unbumped → a pending close still deletes A's row + clears A's alarm (no restorable bearer).
- **Rejection-after-write, confirmed branch**: `session.set` writes then rejects → compensation deletes, read-back confirms absence → B installs in memory (degraded-success contract preserved), B's alarm scheduled, generation bumps; a pending close stands down. Assert: no row, B in memory, B's alarm live.
- **Rejection-after-write, unconfirmable branch**: compensation/read-back also fail → nothing installs, no bump; the pending close completes A's cleanup. Assert: no in-memory session, no bump.
- Mid-open expiry close (pre-section park at wrapPair): expiry close runs to completion (A's artifacts removed) → open resumes and lands B; assert B's alarm intact.

### N-17 — post-await epoch re-checks at the PXE park points (apps/extension/src/wallet/services/incoming-transfer/service.ts)

- Re-check `serviceEpoch !== epochAtStart → return` after the two PXE-bound awaits: :1104 (before `markBalanceDirty`/`upsertRecord` :1117-1118) and :1064 (before the backfill `upsertRecord` :1066).
- **Cross-auditor disagreement RESOLVED**: round-1 codex asked for re-checks before EVERY mutation/emit; fable's verified census narrowed to the two PXE park points, and the FINAL-PASS codex (fresh context) independently ruled the two-site placement ships ("blanket checks add partial-commit opportunities and cannot undo an already-running storage mutation"). Unanimous at close.
- `serviceLock` keeps its default watchdog (all rounds concur).
- Test (**the composed gold pin**, replacing rev 1's vacuous spec — `onTokenDeleted` queues on the same lock and can never bump while the CS is parked): **pre-seed the note's trust as allowed** (final-pass fix: the unknown-trust write + emit land BEFORE the park point, so asserting their absence could never pass) → park the CS at a deferred `getBlockTimestamp` → advance fake timers past the serviceLock watchdog → the lock hands to the queued `onTokenDeleted` (bumps + wipes) → release the deferred → assert the revoked CS produced NO post-handoff effects (no record, no outbox row, no post-park emit). RED on revert of the re-checks.

### File-level change map

- `packages/wallet-core/src/utils/lock.ts` (M) + `lock.test.ts` (L rewrite).
- `packages/wallet-core/README.md` — lock section drift (`Lock.MAX_HOLD_MS` never existed; raw-API removal) (S).
- `apps/extension/src/wallet/services/network/service.ts:212` — `maxHoldMs: null` + rationale (S).
- `apps/extension/src/wallet/services/profile/session-manager.ts` — artifact mutex + identity guard + fence (M) + NEW colocated fence test (M).
- `apps/extension/src/wallet/services/profile/repository.ts:87-92`, `purge-rows.ts:8`, `profile/service.ts:2248,:2313` — stale raw-API examples/comments (S).
- `apps/extension/src/wallet/services/incoming-transfer/service.ts` — two re-checks (S) + `service.scenarios.test.ts` composed pin (M).

### Alternatives considered (updated)

- A. Generation-number Lock — rejected (type-safety; symbols unforgeable).
- B. Fix-the-witness-only — rejected (16 services inherit; launch gate is the class).
- C. Optional-ticket back-compat — rejected (silently-revertible escape hatch).
- D. N-12 via serializing off-lock entries (`deriveDappSessionMacKey` under `runExclusive`) — rejected for hot-path contention, BUT re-weighed after round 1: the artifact mutex achieves the same serialization scoped to the artifact ops only, which is why it replaced the bare fence.
- E. Alarm-identity-aware clear alone — rejected: immune to the counter's blind spots (it keys on artifact identity) but covers only the alarm leg; the mutex subsumes it for both legs.
- F. (new, rejected) Blanket N-17 re-checks at every await — noise beyond the harm model (see adjudicated disagreement).

## Security & Adversarial Considerations

- Ticket minted at HANDOFF only; `leave(stale)` no-ops (never throws — it sits in `withLock`'s finally); the ticket CHECK precedes any timer/state mutation in `leave` (liveness-load-bearing order); the watchdog callback guards on its OWN ticket.
- The artifact mutex is private and leaf-level: it never wraps calls into facade-locked code, so no reentrancy or lock-ordering cycle is possible. Its own watchdog stays DEFAULT (its legs are storage/alarms ops, never >5-min by design).
- The N-12 head identity-guard is sync (no TOCTOU); the artifact re-check happens INSIDE the mutex (no check→await gap).
- FIFO assumption: the mutex removes the plan's prior reliance on `chrome.storage`/`chrome.alarms` dispatch-order FIFO (both audits flagged it); ordering is now enforced by the mutex itself.
- No attacker-controlled input in any of the three changes.

## Phases

1. **N-11**: ticket mechanics + network-lock `maxHoldMs: null` + full `lock.test.ts` rewrite + doc sweep. Gate: wallet-core vitest green; audit:vue green.
2. **N-12**: artifact mutex + identity guard + fence + colocated test (f1-1 adoption, 4 orderings). Gate: profile suites + new test green; audit:vue green.
3. **N-17**: two re-checks + composed watchdog-handoff pin. Gate: incoming-transfer suites green; audit:vue green.
4. **Battery**: audit:vue + armed-build smoke + full solo `e2e:agent` (re-run once before triaging any failure).
5. **Post-impl**: `/code-review max --fix` (separate commit) → codex final-diff loop → PR ≤93-char title → babysit required checks → squash-merge.

## Decision ledger

- Ticket over generation-number; handoff-mint; raw-API break (zero callers, verified twice); check-first `leave` order (fable — silently-revertible liveness); watchdog-own-ticket (runbook + both audits); network lock `maxHoldMs: null` (codex round 1; final pass concurs) vs serviceLock keeping its watchdog (all rounds).
- N-12: bare generation fence REJECTED by both round-1 audits (TOCTOU + capture-after-bump + failed-open bearer) → artifact mutex (rev 2) → final pass found three holes in rev 2's mutex (bump-first capture window; `session.set` rejection indeterminacy; the mutex's own watchdog re-creating N-12) → rev 3: **bump-LAST as the commit point**, rejection-compensation + never-bump-on-reject, **`maxHoldMs: null` on the artifact mutex** (load-bearing). Alternatives D/E subsumed.
- N-17: two-site placement — disagreement RESOLVED unanimously at the final pass (blanket checks add partial-commit surface).
- Test-vacuity findings across all rounds (echoing batch 3): N-17 pin recomposed (watchdog-handoff + pre-seeded trust, post-handoff assertions only); f1-1 adoption re-shaped with the MID-ARTIFACT ordering as the load-bearing pin (both simpler orderings pass on revert).
- Gate arc: round-1 dual audit (codex REJECT + fable APPROVE-WITH-CHANGES) → rev 2 → final fresh-context pass REJECT → rev 3 → resumed re-verdict **APPROVE-WITH-CHANGES** (the rejection-branch contract, folded above) → rev 4 = the approved plan of record.
