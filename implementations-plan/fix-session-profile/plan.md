# fix-session-profile — Arc 1 of the 2026-08-16 remediation

Four session/profile-lifecycle correctness fixes, bundled because they all live in `profile/service.ts` + `session-manager.ts` + `profile-deletion-state.ts` and share the same test surface. Source of truth: `audit/bugs/2026-08-16-extension-mid/{report.md,findings/verified.md}`; verified.md overrides consolidated. **Prove-first**: each fix gets a RED characterization test reproducing the counter-example BEFORE the fix; the test is the regression pin (green after). Smallest safe change per verified.md — no new abstraction in this arc (none clears the ≥3-callsite bar).

## Findings + verified fixes

### B-01 (Critical) — session open/close report false success
`session-manager.ts open()` writes storage (`:221`) BEFORE the in-memory `activeSession = {...}` (`:223`), so a rejecting `session.set` jumps to the swallowing catch and `activeSession` is never set — yet `openSessionVerified` (`service.ts:858-864`) checks only deletion state after `open()`, never `isActive`, so `unlockProfile` resolves a valid `ProfileInfo` while the wallet is actually locked. `close()` is the mirror (delete `:240` before clear `:241-244`). `refresh()` (`:259-278`) is already correctly memory-first.
- **Fix (verified.md):** (a) memory-first ordering in `open()`/`close()` — commit the in-memory transition first, then attempt the storage write in a way a failure does NOT undo the memory commit (matches the doc's own stated intent: "a broken chrome.storage write at unlock time still leaves the in-memory secret usable"); (b) add a post-`open()` `isActive` check in `openSessionVerified` so a genuine persistence failure surfaces as an RPC error, not a silent false success.

### B-10 (Major) — zeroize gap on the F-007 credential-mismatch throw
`service.ts:480-482` throws on `recovery.credentialId !== snapshot.credentialId` BEFORE the `try { … } finally { zeroize(recovery.secret) }` at `:485-509`, so the recovered master secret is never zeroized on that path. Two sibling call sites (`exportPlain` ~`:1110`, `restore()` ~`:1451`) correctly wrap it.
- **Fix:** zeroize `recovery.secret` before the mismatch throw (or move the check inside the existing try/finally). Smallest: `zeroize` immediately before `throw`, mirroring `restore()`'s passkey branch.

### B-11 (Major) — abandoned restore parks a master secret un-zeroized for the SW's life
`restore()` stashes `pendingRestoreSecrets.set(id, recovery.secret)` (`:1499`, deliberately not zeroized — the map takes ownership); the only consumers are `finalizeRestore` (`:1595`) and `deleteProfile` (`:919`). A restore closed before either runs leaves the raw master secret resident with no TTL/GC/boot sweep.
- **Fix (anti-overengineering — simplest):** stamp each entry with a capture time; sweep stale entries (zeroize + delete) on the next `restore()`/`finalizeRestore()` call. NO alarm — sweep-on-next-op is sufficient (an abandoned entry is harmless until the next restore activity, and SW teardown clears the map anyway). Open question for codex: is sweep-on-next-op acceptable, or does the threat model require an alarm? (Default: sweep-on-next-op.)

### B-12 (Major) — failed tombstone write falsely reserves a live profile forever
`deleteProfile` calls `beginDeletion(id)` (`:911`, synchronously reserves id + bumps epoch) THEN `await tombstones.write(...)` (`:912`). If the write rejects, the id stays reserved (no durable tombstone, `repo.delete` at `:913` never ran) — the live profile is wedged (`isReserved` true) until SW restart; every unlock throws "Invalid profile id".
- **Fix:** on a tombstone-write (or pre-`repo.delete`) failure after `beginDeletion`, release the reservation (`deletionState.release(id)`). Keep the monotonic epoch bump (harmless — only fences stale writes). The rollback window ends once `repo.delete` succeeds (past that, the tombstone exists and crash-resume completes it — reservation must stay). Open question for codex: confirm the window boundary and that releasing after a failed tombstone write can't race a concurrent op that already captured the bumped epoch.

## Architecture & Implementation

All changes are in-place edits to three existing files; no new modules, no new abstractions (none of the four fixes shares a shape with ≥3 beneficiaries). File map:
- `apps/extension/src/wallet/services/profile/session-manager.ts` — reorder `open()`/`close()` to memory-first (B-01).
- `apps/extension/src/wallet/services/profile/service.ts` — post-open `isActive` check in `openSessionVerified` (B-01); zeroize before F-007 throw (B-10); timestamped `pendingRestoreSecrets` + sweep helper (B-11); reservation rollback in `deleteProfile` (B-12).
- `apps/extension/src/wallet/services/profile/profile-deletion-state.ts` — no change expected (`release(id)` already exists at `:46`); B-12 uses it.

Data/control flow unchanged except the four failure paths above. The B-01 memory-first reorder is the only one touching a success path, and it preserves observable success-path behavior exactly (the write still happens; only its ordering vs the memory commit and its failure semantics change).

## Competing outline (rejected)

**Alt:** make `session-manager.open()` RETHROW on storage failure instead of memory-first-swallow, and let `openSessionVerified` catch it. Rejected: it contradicts the class's own documented intent (a write failure should still leave the in-memory secret usable for the SW lifetime) and would turn a transient storage hiccup into a hard unlock failure the user must retry — strictly worse UX for the same safety. The post-op `isActive` check gives the same "no false success" guarantee without breaking the documented degradation.

## Prove-first test plan (RED before fix)

1. **B-01a** (`session-manager.test.ts`): inject a `session.set` that rejects once → `open()` → assert `isActive(profile.id)` is TRUE (currently false → RED). **B-01b**: reject `session.delete` once → `close()` → assert `isActive` is FALSE (currently true → RED). **B-01c** (`service.*.test.ts`): a rejecting session.set → `unlockProfile` should surface an error / not resolve a false success (post-op check).
2. **B-10** (`service.*.test.ts`): passkey unlock with a credential whose id ≠ snapshot → assert `zeroize` called on `recovery.secret` (spy the buffer / assert wiped) — currently not → RED.
3. **B-11** (`service.*.test.ts`): `restore()` then abandon (no finalize/delete) → a later `restore()` → assert the first entry was zeroized+swept — currently retained → RED.
4. **B-12** (`service.*.test.ts`): `deleteProfile` with a `tombstones.write` that rejects → assert `isReserved(id)` is FALSE afterward (profile still unlockable) — currently reserved → RED.

Any test that can't be made RED after honest effort → codex xhigh consult → NOT-REPRODUCED in remediation.md, no code change.

## Validation gates

- `bun run lint` + `bun run typecheck:all`
- Targeted: the three touched test files, green (all pins).
- `bun run audit:vue` (apps/extension touched).
- Armed smoke (arc 1 per goal): `VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build` → `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.

## Security & Adversarial Considerations

B-10/B-11 are secret-lifetime fixes (reduce the window a master secret sits in memory un-zeroized) — no new trust boundary, strictly less exposure. B-01/B-12 are availability/correctness (false success / wedged profile) — no secret handling change. No new inputs cross a trust boundary; no new persisted shape (B-11's timestamp is in-memory only, never persisted).

## Decision ledger

- L1 — memory-first-swallow over rethrow for B-01 open(); post-op `isActive` check in openSessionVerified. **Status: Fable conditional-approve; codex pending.**
- L2 — B-11 sweep-on-next-op over an alarm. **Status: Fable approves WITH conditions (see L5); codex pending.**
- L3 — no new abstraction this arc (four unrelated fixes, none ≥3-callsite). **Status: settled.**
- L4 — B-12 release-on-failure. **Status: Fable — tighten to tombstone-write-rejection ONLY; KEEP the epoch bump (rolling it back is dangerous — a later real deletion re-mints the same epoch, un-fencing a stale out-of-lock writer that captured it). Document the one spurious `assertCurrent` rejection for an out-of-lock worker that captured the pre-bump epoch (fails safe). codex pending.**

### Reconciled resolutions (both audits — codex REJECT + Fable conditional; conditions folded, design finalized)

- **R-B01-open** — open() memory-first; a swallowed `session.set` failure is REDEFINED as degraded-in-memory success (documented: the secret is usable this SW lifetime, just not persisted; a stale prior-profile bearer may survive on disk and is ignored — restore() validates the bearer against the active profile). Keep the post-open `isActive` check in openSessionVerified as a cheap invariant (only fires on a genuine memory-commit throw — `wrap`/`Fr.fromBuffer` — NOT forced RED; kept, not dropped).
- **R-B01-close (C2 resolution)** — close() memory-first (clear activeSession first), `session.delete()` in its OWN try/catch so `clearLockAlarm()` always runs (both auditors). Then `lockActiveProfile` (service.ts:551-556) gets a post-close READ-BACK: after close(), if a persisted session record still exists, throw so the RPC surfaces "lock didn't persist" — this is verified.md's post-close check and DOES detect the persistence failure (a read-back, not the in-memory isActive). Add one `SessionManager` method `hasPersistedSession(): Promise<boolean>`. Smallest safe; no close() signature change (still void). Pin: swallowed delete → lockActiveProfile surfaces + persisted record asserted gone-or-surfaced.
- **R-B10** — move the F-007 mismatch check INSIDE the existing try/finally (codex: structurally safer than zeroize-before-throw). Scope note: this arc fixes the unlockPasskeyProfile instance ONLY; remediation.md records that the consolidated B-10 lists sibling setup-throw instances — swept if trivially in-diff, else logged as follow-up (do NOT claim all-of-B-10).
- **R-B11 (helper now justified)** — a private `sweepStalePendingRestore()` helper (30-min TTL from capture time), swept synchronously at entry to `restore`/`finalizeRestore`/`deleteProfile` (THREE call sites ⇒ clears the ≥3-benefit bar for a small helper — codex + Fable both). `pendingRestoreSecrets` entry becomes `{ secret, capturedAt }`. In finalizeRestore: REMOVE the target entry from the map BEFORE awaiting openSessionVerified, zeroize in finally (else a concurrent sweep zeroizes mid-use). Accept + document: a legitimate import exceeding 30 min can be expired by a later trigger. Test advances fake time past TTL.
- **R-B12 (readback-after-reject)** — catch ONLY `tombstones.write`. On rejection, read RAW-key presence via `tombstones.reservedIds()` (never decoded `get`): release the reservation ONLY when absence is confirmed; if the key exists / is corrupt / readback throws → RETAIN fail-closed (rejection is commit-ambiguous). Rollback window ends once tombstone durability is possible — any later `repo.delete` failure RETAINS tombstone+reservation (resume completes it). Keep the epoch bump (rolling back → ABA, re-authorizes a pre-delete op). Pins: (a) cleanly-failed write (key absent) → released [my committed B-12 pin]; (b) commit-ambiguous write (key landed then reject) → RETAINED fail-closed.

### Fable audit conditions (adopted, pending codex reconciliation)
- **C1 (B-01 test)** — B-01c can't go green under memory-first (unlock still resolves = documented degradation). Reframe: assert `unlockProfile` RESOLVES **and** `getActiveProfile()`/`getSecret()` succeeds (second assertion RED today, green after). The post-open `isActive` check then only fires on a genuine memory-commit failure (`wrap`/`Fr.fromBuffer` throw) — keep the check as a cheap invariant even though it's hard to force RED (do NOT drop it under the can't-repro rule).
- **C2 (B-01 close — BLOCKING, restores dropped verified.md item)** — memory-first `close()` with a swallowed `session.delete()` rejection leaves the persisted bearer alive → next SW restart silently re-unlocks via `restore()`. My committed B-01b pin (memory `isActive` false) passes straight through this. close() is therefore ASYMMETRIC to open(): it must NOT silently swallow the delete failure. Fix: surface/verify the persisted-clear in `lockActiveProfile` (service.ts:551-556) — post-close analog of openSessionVerified's post-open check — OR rethrow close()'s storage-leg failure. Add a pin: swallowed delete → assert the persisted session is gone / lockActiveProfile surfaces. **codex to arbitrate rethrow-vs-surface.**
- **C3 (B-01 minor)** — schedule the TTL alarm independently of the write's success; still `clearLockAlarm` when delete rejects. Racing-alarm gate preserved by memory-first (state clears earlier, re-checked under runExclusive). Emitting onChange before persist is safe (all subscribers read in-memory via the facade).
- **C4 (B-11)** — sweep MUST run under `runExclusive` (finalizeRestore holds a live reference to the buffer it consumes; an unlocked sweep zeroizing mid-open is a real hazard); TTL must comfortably exceed a slow backup import (≥30 min); NEVER sweep the id currently being finalized.
- **C5 (B-10)** — confirmed real, fix minimal (zeroize before the :480 throw, mirroring restore()'s :1451). RED test: override FakePasskeyService's master-secret derivation to return a retained buffer, assert wiped after the F-007 rejection.
