# lock-ownership — batch 4 of audit-448-remediation (rev 1)

Fixes **N-11 (Major, launch gate)** — `Lock`'s watchdog force-release + ownerless `leave()` lets a late holder release a stranger's acquisition, collapsing mutual exclusion for every service lock (harm witness: `deleteNetwork` holds the network lock across `purgeChain` → `clearChainState`, which deliberately carries the 30-min prove-tx envelope, 6× the 5-min watchdog) — **N-12 (Minor)** — the session-TTL reader-triggered `close()` runs off-serializer and its suspended tail cancels a NEWER session's lock alarm (lazy auto-lock dead; the row-delete leg races the new session too) — and **N-17 (Minor, opportunistic)** — the incoming-transfer note-CS checks its lifecycle epoch once at entry but writes durables after PXE-bound awaits with no re-check. Spec: `implementations-plan/audit-448-remediation/runbook.md` (batch 4); verdicts: `audit/bugs/2026-08-22-production-ready/adjudication-2026-08-24.md`; recon: [recon.md](./recon.md). Base: dev `8710518d`. Tier: **mid** (rubric: blast radius HIGH — one class serializes 16 services; 1 high → mid).

**Scope:** N-11 + N-12 + N-17 per the runbook, adopting proofs `p1-1` and `f1-1` as colocated regression pins (audit/ copies untouched). OUT: `ReadWriteGuard` writer-path watchdog (real gap found in recon — pxe `clearProfileState` can wedge a profile's barrier forever — but orthogonal to N-11's double-release; logged as follow-up), epoch-fence unification across services (4+ in-repo idioms; separate arc), `TokenSeeder.markerLock` (never used `Lock`), any change to lock CALLERS' structure (recon: all 16 files are `withLock`-insulated; zero split callers exist — the runbook's "audit split enter()/leave() callers" resolves to: verified none exist, plus the one `ReadWriteGuard` split site verified already-safe).

## Clarifying questions (self-answered per goal; codex ratifies)

- **Done =** p1-1 and f1-1 rewritten to repo conventions and GREEN with the fixes (RED against base); the deferral pin at `lock.test.ts:249-287` flipped to assert the new containment; N-17 re-checks in place with a composition pin; full battery green; PR merged.
- **Quality bar**: production (launch-gate finding). **Validation layers**: `bun run audit:vue` per phase; final battery = audit:vue + armed-build smoke + full `e2e:agent` (locks underpin dApp/network flows; smoke exercises the SW).
- **Scope cuts**: none — all three findings are S/M and land in one PR.

## Architecture & Implementation

### N-11 — owner ticket inside `Lock` (packages/wallet-core/src/utils/lock.ts)

The entire fix lives in the one class; **zero caller changes** (recon: every consumer goes through `withLock`-style wrappers; `KeyedLock` only calls `withLock`).

- `type LockTicket = symbol` (exported, opaque). One private `currentTicket: LockTicket | null` field.
- **Mint at handoff, not enqueue**: the FIFO `queue` becomes `((ticket: LockTicket) => void)[]`; `dispatch()` mints a fresh `Symbol("lock-ticket")`, sets `currentTicket`, and resolves the next waiter WITH it. The direct-grant path in `enter()` (uncontended) mints identically. `enter(): Promise<LockTicket>`.
- `leave(ticket: LockTicket)`: if `ticket !== this.currentTicket` → **no-op** + one `LogLevel.Warn` line (late releases after a force-release are expected-rare, not silent). On match: clear timer, `currentTicket = null`, unlock, `dispatch()`.
- **Watchdog on fire**: logs the existing Error line, then performs a privileged release — `currentTicket = null`, clear its own timer ref, unlock, `dispatch()` (which mints the NEXT holder's ticket). The wedged holder's eventual `finally leave(staleTicket)` mismatches and no-ops. The single `forceReleaseTimer` field stays single: it is always the CURRENT holder's timer, because every grant path (mint) re-arms it and every release path clears it before handoff.
- `withLock` threads the ticket internally (`const t = await this.enter(); try … finally { this.leave(t) }`). Its "leave fires iff enter resolved" contract is unchanged.
- **Raw-API break is deliberate**: `leave()` without a ticket ceases to exist. Only `lock.test.ts` uses the raw API; it is rewritten. (Recon confirmed no application raw callers.)
- Naming: "ticket", not "token" — `ReadWriteGuard` already uses `readerTokens` for force-release AGING (unrelated semantics; avoid the collision).
- Cheap for `KeyedLock`'s unbounded per-key `Lock` minting: one nullable field + a Symbol per grant.

Tests (`lock.test.ts`):
- Rewrite the deferral pin (:249-287) into the **p1-1 adoption**: wedged H1 past a tiny watchdog → W2 granted → H1's late `leave(stale)` no-ops → queued W3 does NOT enter until W2's own `leave` → then W3 enters. (Green with the fix; asserts the exact inversion of today's pinned behavior.)
- New: stale-ticket leave is a warn-logged no-op; ticket is minted at handoff (a long-queued waiter's ticket differs from the force-released holder's); double `leave(sameTicket)` — second call no-ops (ticket already cleared).
- Adapt the raw-API pins (:100-105, :161-164 — leave-before-enter needs a ticket to even call: replace with "leave with a foreign symbol is a no-op"), the enter-reject invariant (:216-233; also fix its stale `holdsLock` comment — recon: that boolean no longer exists), non-reentrancy (:310-327, semantics unchanged).

### N-12 — session-generation fence in `SessionManager` (apps/extension/src/wallet/services/profile/session-manager.ts)

No locking changes at all — the TRAP (non-reentrant facade lock; `getActive` is reached both inside `runExclusive` and off-lock) is sidestepped entirely with the in-genre epoch idiom:

- Private `sessionGeneration = 0`. **`open()` bumps it at entry** (before any write): any suspended stale `close()` immediately stands down.
- `close()` captures `const gen = this.sessionGeneration` at entry. Before EACH destructive awaited leg — `session.delete()` (:323) and `clearLockAlarm()` (:332) — re-check `this.sessionGeneration === gen`; on mismatch, **skip the remaining legs** (a newer session owns those artifacts now) and log one Info line. The synchronous head (DEK zeroize, `activeSession = undefined`, `onChange` emit) is untouched — it always refers to the session being closed and runs before any suspension point.
- `getActive()`'s expiry path keeps calling `close()` directly (now internally fenced); `getActiveProfile`/`captureExecutionFence` (inside `runExclusive`) and `deriveDappSessionMacKey`/init (off-lock) all stay as-is. The fence makes the close safe from EVERY entry point instead of trying to serialize the entry points.
- Residual accepted: a stood-down close may leave the OLD session's storage row if the newer `open()` didn't overwrite the same key — `chrome.storage.session` is SW-lifetime-ephemeral and `activeSession` no longer references it; verified/adjusted at implementation against the real storage shape. An `open()` that bumps and then FAILS leaves the old alarm armed; `onAlarmFired`'s existing `scheduledTime === expectedLockedAt` identity gate (:730-731) keeps a stale firing benign.

Tests: **f1-1 adoption**, colocated `session-manager` test (repo conventions, FakeBrowserApi): gate `storage.session` delete inside A's close, open B (schedules B's alarm) while suspended, release the gate → assert ZERO `chrome.alarms.clear` of `"nulo:core:session:ttl"` after B's open, B's alarm intact, B's row intact. Plus: unforced close (no concurrent open) still deletes + clears; generation bump on failed open leaves the stale alarm to the identity gate (pin the benign no-op).

### N-17 — post-await epoch re-checks in the note-CS (apps/extension/src/wallet/services/incoming-transfer/service.ts)

- Re-check `if (this.serviceEpoch !== epochAtStart) return` immediately after the `blockTimestampFor` await (:1104), before `markBalanceDirty`/`upsertRecord` (:1117-1118); and after the existing-record branch's PXE await (:1064), before its backfill `upsertRecord` (:1066).
- `serviceLock` keeps its default watchdog (the audit's "consider `maxHoldMs:null`" is REJECTED: the owner ticket already prevents theft; the watchdog stays as a liveness failsafe).
- Test: composition pin in `service.scenarios.test.ts` — swap `makeNoteStub.getBlockTimestamp` for a deferred promise, drive a scan into the note-CS, fire `onTokenDeleted` (bumps `serviceEpoch`) while parked, release, assert the purged token's record is NOT resurrected in the repo fake.

### Data & control flow (the three interlocking guarantees)

1. Lock theft cannot cascade: a force-released holder's late `leave` is inert (N-11) — so the network-delete witness degrades to "watchdog logs an error and the cascade finishes without exclusivity theft".
2. A stale session close cannot destroy a successor's artifacts (N-12) — generation fence, no lock involvement.
3. A lifecycle-purged token cannot be resurrected by an in-flight note commit (N-17) — epoch re-checks at the write boundary.

### File-level change map

- `packages/wallet-core/src/utils/lock.ts` — ticket mechanics (M).
- `packages/wallet-core/src/utils/lock.test.ts` — deferral-pin inversion + p1-1 adoption + raw-API adaptation (M).
- `apps/extension/src/wallet/services/profile/session-manager.ts` — generation fence (S).
- NEW colocated session-manager fence test (f1-1 adoption) (S/M).
- `apps/extension/src/wallet/services/incoming-transfer/service.ts` — two re-check lines (S).
- `apps/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts` — parked-CS pin (S).
- `implementations-plan/lock-ownership/*` — plan artifacts.

### Alternatives considered (competing outline)

- **A. Generation-counter Lock** (grant bumps `generation: number`; `leave(gen)` compares): functionally equivalent to tickets; rejected on type-safety — a number invites arithmetic/reuse mistakes and cross-lock confusion, a `symbol` is unforgeable and per-grant by construction.
- **B. Fix the witness, not the class** (move `purgeChain` out of `deleteNetwork`'s lock body; keep `Lock` as-is): rejected — the adjudication makes N-11 the launch gate BECAUSE 16 services inherit the hazard; narrowing to one witness leaves every other >5-min hold (present or future) exposed.
- **C. Back-compat optional ticket** (`leave(ticket?)` — argless keeps old semantics): rejected — an unticketed escape hatch is exactly the "silently revertible" hole batch 3's reviews taught us to close; no production caller needs it.
- **D. N-12 via serializing the off-lock entry points** (wrap `deriveDappSessionMacKey` in `runExclusive`): viable, no deadlock (it IS off-lock) — rejected because it puts the facade lock on the hottest dApp read path (every dApp-session read contends with 30+ `runExclusive` sites) and still needs close-internal care for the init-tail path; the generation fence is smaller, lock-free, and covers all entry points uniformly.
- **E. N-12 via alarm-identity-aware clear only** (compare `chrome.alarms.get(name).scheduledTime` to the closing session's expected lock time before clearing): narrower than the fence — it protects the alarm leg but not the row-delete leg; the fence subsumes it.

## Security & Adversarial Considerations

- The ticket must be minted at HANDOFF: minting at enqueue would hand a queued waiter a ticket that a force-release could invalidate before grant, deadlocking the waiter's eventual leave into a no-op while it holds the lock (self-inflicted theft). The handoff-mint rule is pinned by test.
- `leave(stale)` must NO-OP, never throw: it fires inside `withLock`'s `finally` — a throw there masks `fn()`'s own result/error (recon collision note).
- The watchdog's privileged release must INVALIDATE the holder's ticket before dispatching — otherwise the original hazard reappears verbatim.
- N-12's fence is deliberately NOT a lock: adding any lock to `close()` re-opens the reentrancy trap. The fence's only failure mode is standing down too eagerly (a bump from a failed open) — which degrades to today's benign stale-alarm path, guarded by the existing `onAlarmFired` identity gate.
- N-17's re-checks are read-only epoch compares inside an already-held lock — no new interleavings introduced.
- Adversarial surface: none of the three changes takes attacker-controlled input; all inputs are internal service state.

## Phases

1. **N-11**: implement ticket mechanics + full `lock.test.ts` rewrite. Gate: wallet-core vitest green (p1-1 pin green, RED if mechanics reverted), `bun run audit:vue` green.
2. **N-12**: generation fence + f1-1 adoption test. Gate: profile-service + new test green; audit:vue green.
3. **N-17**: re-checks + scenarios pin. Gate: incoming-transfer suites green; audit:vue green.
4. **Battery**: audit:vue + armed-build smoke + full solo `e2e:agent`. Gate: all green (network suite re-run once before triaging any failure).
5. **Post-impl protocol**: `/code-review max --fix` (independent max-effort review agent; fixes as a separate commit) → codex final-diff loop to sign-off → PR (title ≤93 chars) → babysit required checks → squash-merge.

## Decision ledger (running)

- Ticket over generation-number (type-safety); handoff-mint (security §); raw-API break accepted (zero callers); watchdog kept on `serviceLock` (owner ticket de-teeths theft; watchdog = liveness net); N-12 fence over serialization (trap + hot-path contention) and over alarm-only guard (subsumption); ReadWriteGuard writer-watchdog gap logged out-of-scope.
