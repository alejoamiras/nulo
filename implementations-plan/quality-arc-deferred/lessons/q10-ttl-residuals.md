# Q10 TTL-race residuals (post-#161) — C1/C2/C3 re-verification + disposition

#161 wrapped the **alarm** expiry-close in `runExclusive` (the ProfileService facade-lock serializer)
to kill the refresh-writeback-resurrects-expired-session race. The arc mega-audit flagged three siblings.
This file re-verifies each against current dev-quality before deciding fix-vs-surface-vs-close.

## C1 — config-driven `applyTtlChange` close is NOT serialized (REAL — same race class as #161)
`session-manager.ts:495 applyTtlChange` does session writeback (`this.session.set` :502/:515) and
`this.close()` (:511) OUTSIDE `runExclusive`. A concurrent facade-locked `refresh()`/`open()`/`unlock()`
can interleave exactly as the alarm path did pre-#161 → TTL-shorten can be resurrected, or `lockedAt`
lost-update. Triggered by the user shortening the TTL while a refresh is in flight.

**Reentrancy check (the "can't naively reuse runExclusive" caveat) — DISPROVEN.**
- `applyTtlChange` is invoked ONLY by `onConfigUpdated` (`session-manager.ts:470`), fired by
  `config.set("sessionTtl")`.
- The ONLY setter of `sessionTtl` is the UI settings page (`popup/pages/settings/security/index.vue:55`
  `configService.setValue("sessionTtl", …)`) → ConfigService (a SEPARATE service). NO ProfileService
  locked op (open/unlock/refresh/close) sets it.
- `close()` (`session-manager.ts:235`) is lock-free internally (delete + state-clear + clearLockAlarm),
  so calling it from within `runExclusive` is safe (the alarm path already does at :562).
- ∴ `applyTtlChange` is never called from within the facade lock → wrapping its body in `runExclusive`
  carries NO deadlock risk. The naive wrap is correct.

**Fix (pending dual-model confirm):** wrap the `applyTtlChange` body in `void this.runExclusive(async () => …)`
mirroring `onAlarmFired`; re-read `this.activeSession` INSIDE the lock. Add a config-driven race test
mirroring the #161 alarm-vs-refresh test (park a refresh holding the lock via a blocked `session.set`,
fire a TTL-shorten, assert no resurrection + memory/storage agreement). → completes #161; IN SCOPE
("fix the race now").

## C2 — Lock re-entrancy guard in wallet-core (DEFENSE-IN-DEPTH — assess, likely SURFACE)
The non-reentrant FIFO `Lock` deadlocks if a holder re-enters. The mega-audit suggested a guard
(throw/detect) as defense-in-depth. BUT the C1 re-verification shows the actual call graph has NO
reentrant caller. This is NEW wallet-core scope, not one of the 6 findings. Disposition: dual-model on
value-vs-blast-radius; if it's a speculative guard with no real caller, document-as-not-needed rather
than expand wallet-core scope autonomously. Candidate to SURFACE.

## C3 — `NetworkService.nodes.clear()` on `onActiveProfileChanged` mid-tx (assess)
On lock/profile-switch, the node pool is cleared unconditionally; an in-flight execution holding a node
ref could be disrupted. Real concern, separate from the 6 findings. Disposition: dual-model; SURFACE if
it's a concurrency-critical judgment call (mid-tx node lifecycle is exactly that).

## Scope note
C1 completes the user's "fix the race now" (#161) on its sibling path → do autonomously. C2/C3 are
mega-audit residuals outside the 6 findings → resolve via dual-model + judgment, surfacing genuine
concurrency-critical disagreements per the goal's SURFACE rule rather than silently expanding scope.

---

## C1 OUTCOME (2026-06-23) — dual-model + implemented (branch `c1/serialize-config-ttl-close`)

### applyTtlChange wrap — codex `019ef582` + claude/Plan BOTH **FIX-IS-RIGHT** (AGREE)
- Race real (same resurrection class as #161); wrap body in `runExclusive`, re-read `activeSession`
  INSIDE the lock (load-bearing — a queued refresh may have bumped `since` / closed the session).
- Keep `this.sessionTtl = newTtl` (the sync listener contract) OUTSIDE the lock — required so an
  in-flight locked writer reads the new TTL; the queued applyTtlChange then computes from the
  post-refresh `since` → serializable, not an old/new hybrid.
- Deadlock-free: only reached from `onConfigUpdated`, never from within the facade lock; `close()` is
  lock-free. Codex add: updated the now-stale `service.ts:101` runExclusive comment to warn a future
  facade-locked `sessionTtl` write would self-deadlock.

### clearPasshash — claude found it; codex confirm `019ef582` resume → **WRAP-AND-SIMPLIFY** (AGREE)
- `clearPasshash` (strict-mode toggle, `:479`) was the SAME void-dispatched lock-free class. Its
  clear-memory-first ordering correctly handles the passhash-vs-refresh leg, but its stale-snapshot
  write (`{...persisted}`) is a lost-update vector against a serialized refresh/applyTtlChange's newer
  `since`/`lockedAt`.
- Fix: wrap in the same `runExclusive`; for the LIVE-session path persist the re-read `active.session`
  (authoritative latest) instead of the stale snapshot; keep the storage-scrub ONLY for the
  `!activeSession` (locked) path. Both-orders walk (codex): clearPasshash-then-applyTtlChange and
  applyTtlChange-then-clearPasshash both end correct (no overwrite, no resurrection).

### Tests (service.integration.test.ts, mirror the #161 alarm-vs-refresh pattern, config-triggered)
- "sessionTtl shorten-to-elapsed close during refresh's write-back does NOT resurrect" — asserts
  memory/storage agreement + `memActive===false`. The `toBe(false)` is the serialization-regression
  sentinel: drop the wrap and applyTtlChange runs early → reschedule branch → session stays active → red.
- "enabling strict mode during refresh's write-back drops the bearer WITHOUT reverting lockedAt" —
  asserts bearer dropped + bumped lockedAt preserved (strict deliberately drops the cross-restart
  bearer, so a SW-restart agreement check does NOT apply — documented in the test).
- 128 profile tests green (126 + 2). typecheck + lint clean.

### STATUS: C1 ✓ implemented; gating on dev-quality network e2e before merge.
