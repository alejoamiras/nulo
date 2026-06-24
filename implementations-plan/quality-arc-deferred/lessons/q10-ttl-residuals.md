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

### STATUS: C1 ✓ MERGED — #164 `d217a6d`, full network gate green (8/8 on run 28045182972).

---

## C2 + C3 OUTCOME (2026-06-24) — dual-model + owner decision

Both surfaced to the owner via `c2-c3-decision.html`. Owner: **C2 → close (no code); C3 → minimal fix.**

### C2 — Lock re-entrancy guard → **CLOSED, no code change** (codex + claude AGREE)
No path re-enters the facade lock; the wallet-core `Lock`'s 5-min force-release prevents PERMANENT
deadlock; same-context re-entry isn't reliably detectable in async JS without owner-token threading
(brittle). The self-deadlock-shape warning already lives at `service.ts:101`. Both noted one nuance
(force-release HIDES a deadlock for 5 min rather than failing fast); if ever revisited, the safe shape
is an extension-side `runExclusive` depth-counter assert, NOT a shared-Lock change. Not done — documented.

### C3 — cross-profile pending-tx RPC leak → **FIXED** (branch `c3/pin-pending-tx-endpoint`, #165)
**The leak (codex found; I verified):** the pending-tx set is global (Tx records carry chainId, NOT
profileId — `transaction/service.ts:76-78`). After a profile switch, `onActiveProfileChanged` clears
`transientNodes`; polling profile A's still-pending tx called `getNodeForUrl(A_url)`, whose
`_isKnownEndpointUrl` was ACTIVE-profile-scoped → A_url "unknown" under B → fell back to `getNode`
(B's node) → **A's tx hash sent to B's RPC provider.** claude originally under-weighted it (assumed
the submitted-URL pin held); the cache-miss fallback silently broke the pin. Verified at
`network/service.ts:529-537,770-775` + `transaction/service.ts:192-219`.

**First cut (too small):** widened `_isKnownEndpointUrl` to all profiles. Post-impl dual audit
(codex `019ef8d1` CORRECT-SHIP-with-residual + fresh-claude FIX-FIRST) BOTH flagged the SAME residual:
the `getNodeForUrl` active-profile fallback still leaks when the submitting endpoint is edited/deleted
from the active profile (reachable via a normal endpoint edit, not just exotic deletion) — and the
first-cut test BLESSED that fallback as intended. Both recommended the IDENTICAL stronger fix.

**Final fix (faithful to the owner's "pin regardless of active profile"):** `getNodeForUrl(url)` now
ALWAYS pins to the submitted URL — build + cache the transient node, NEVER fall back to the active
profile's node. Removed `_isKnownEndpointUrl` (now unused) + the `fallbackChainId` param. The legacy
no-recorded-endpoint path (`updateTx`, `submittedEndpointUrl === undefined`) keeps `getNode(chainId)` —
no URL to pin to. Trust note (both models, accepted): this trusts the internal, allowlist-validated
`submittedEndpointUrl`; defending it against local-storage tampering is moot (that compromise dwarfs
this dial).

**Tests (network/service.test.ts):**
- cross-profile pin: active=p2, `getNodeForUrl(A_url)` → builds A's node, never p2's. VERIFIED it fails
  under the old active-scoped logic (teeth check: patched to old behavior → red; restored → green).
- deleted/edited endpoint: URL on no profile → STILL pins to the submitted URL, never the active node
  (the flipped test — the first cut had it asserting the leak as correct; now asserts it closed).
- 52 network tests green. typecheck:all + lint exit 0. No transaction unit-test file exists; the pin
  behavior is fully covered by the network tests + network e2e.

### C3 part 2 — the RECORDING-site leak (found by the arc-wide confidence pass)
The owner asked for a fresh codex + opus pass on the whole arc before manual smoke. The two models
SPLIT on a privacy point — exactly the surface the pass was meant to find:
- opus#1 (concurrency/security agent): PROMOTE; rated the undefined-`submittedEndpointUrl` residual minor.
- codex (arc-wide): **HOLD** — sharper arc-level interaction: Q10 made proactive TTL auto-lock LIVE +
  proving is slow, so the lock can fire MID-PROVE. `addTransaction` (`transaction/service.ts`) re-derived
  `submittedEndpointUrl` from `networkService.getNetworks(chainId)` — which is active-profile-scoped and
  throws (via Q19's `requireActiveProfile`) when locked → records `undefined` → poll falls back to the
  active profile's node = the SAME cross-profile leak C3 closed at the POLLING site, reintroduced at the
  RECORDING site. THREE arc findings interacting (Q10 + Q19 + C3) — none has it alone.

**Verified codex is right** against the code: `addTransaction:137` re-queried + `catch → undefined`; the
executor already held the real `network` (`network = built.network`) but threw it away. Not surfaced to
the owner as a question (it's the SAME privacy-first decision already made; the owner explicitly asked
this review to catch such issues) → fixed.

**Fix:** `addTransaction` now takes `submittedEndpointUrl` as a param; the executor resolves it from its
own build network via a new `primaryEndpointUrl(network)` helper (network/spec.ts) and passes it at all
4 call sites (transfer + 3 dapp-send). Removed the active-profile re-derivation entirely. The helper
guards `endpoints?.` defensively (storage-boundary record). Pin test: dapp-send records the submitting
network's primary URL as arg 7 (teeth: without the threading the arg shifts to the fee value).
341 execution+network tests green; typecheck:all + lint exit 0.

### STATUS: C2 ✓ closed-documented. C3 ✓ (polling + recording sites both closed); gating on network e2e.
