# Cluster F1a — KDF-v2 crypto + session/profile glue (async/concurrency lens)

> Scanner: general agent, 2026-08-22. All scope files read fully; every async seam traced.

## F1-1 — Reader-triggered reactive TTL close runs OUTSIDE the facade lock and can cancel a freshly-scheduled lock alarm (delayed auto-lock)

**Severity:** Minor | **Repro confidence:** moderate | **Type:** Concurrency / lock-discipline hole (code contradicts its own serialization contract)

**Violated invariant.** `SessionManager`'s header (`session-manager.ts:43-49`) states callers "run its methods under `ProfileService.lock` when they need serialization with profile CRUD," and `runExclusive` exists specifically to "serialize out-of-band closes against locked writers" (`:113-118`, `service.ts:255-269`). `getActive()`'s embedded `close()` (`session-manager.ts:178-182`) is a **state-mutating close that no caller-side lock covers**, because several readers invoke it lock-free.

**Concrete counter-example.** The only production unlocked *mutating* reader path is `deriveDappSessionMacKey` (`service.ts:806-807` — no `ensureInitialized`, no `runExclusive`), reached from `DappSessionService` on every dApp-session read. Interleaving:

1. Proactive TTL enforcement is down for session A (scheduleLockAlarm failed at open — tolerated by design at `session-manager.ts:747-751`, or Chrome dropped/throttled the one-shot). A expires.
2. t₀: dApp RPC → `getSecret(A)` → `getActive()` sees expired → `close()` sync head drops A, then issues `session.delete()` and suspends.
3. t₀…t₀+1s: user unlocks profile B; the ~1s PBKDF2 phase 2 runs unlocked, so the entire race window spans it. Phase 3 (locked) → `open(B)` commits memory, issues `session.set(B)`, then `scheduleLockAlarm(B.lockedAt)` (`:299`).
4. Step 2's `close()` resumes: `clearLockAlarm()` (`:332`) executes **after** B's alarm create → cancels B's fresh alarm.

**Expected vs actual.** Expected: B's proactive lock fires at B.lockedAt. Actual: B has no alarm; TTL enforcement silently degrades to the reactive isExpired gate — auto-lock fires only when some later RPC touches getActive() after expiry. Self-heals on next refresh()/open/config change; fail-safe direction (never unlocks early), hence Minor.

**Smallest safe fix.** In getActive(), replace the awaited close with a lock-queued, in-lock-revalidated close that the reader does not await: `void this.runExclusive(async () => { const s = this.activeSession; if (s && this.isExpired(s.session)) await this.close() })` — non-reentrant-safe because the reader never awaits acquisition, in-lock expiry recheck makes stale fire a no-op. (Do NOT naively wrap the awaited close: getActive() also called from locked contexts — `service.ts:328,344` — and Lock is non-reentrant.)

**Instances:** `session-manager.ts:174-184` (getActive → close); reached lock-free from `service.ts:806-807` (deriveDappSessionMacKey → getSecret → getActive) and `service.ts:318-322` (init tail — benign). All other close() sites correctly serialized.

## F1-2 — Master/entropy-equivalent buffers allocated before the owning try/finally: a throw in the intervening derivation leaks them unwiped

**Severity:** Minor | **Repro confidence:** high (code shape) / near-zero practical trigger | **Type:** Zeroize-discipline gap on exception paths

**Counter-example.** `importMnemonic` (`service.ts:1429-1444`): `secret = await deriveMasterFromMnemonic(words)` at :1440 allocates 32-byte master-equivalent buffer; `passhash = await EncryptionKey.getPasshash(password)` at :1441 runs BEFORE ownership transfers to importPasswordProfile (whose finally at :1949-1954 wipes). If getPasshash throws (TextEncoder TypeError on non-string smuggled through messaging layer — RPC params are JSON, runtime-untyped), function exits with secret + raw entropy never zeroized. Compare createProfile which wraps identical sequence in try/finally precisely for this (`:404-412`).

**Violated invariant:** house rule every allocated secret buffer wiped on every exit path. Actual: buffers linger until GC.

**Smallest fix:** hoist let declarations + extend ownership try over getPasshash call (or derive passhash before deriving secret).

**Instances:** `service.ts:1439-1441` (primary); `service.ts:365-367` (createProfile latent same shape — entropy allocated :365, getMnemonic :366 can throw before try :372).

## Checked and cleared (verified negatives)

- Check-then-act across awaits: unlockProfile/unlockPasskeyProfile 3-phase revalidation (ciphertext-equality :481, credentialId binding+rotation :657/:673), epoch revalidation in all four export paths, dup-guard-under-commit-lock in all six row-construction sites, openSessionVerified pre/post deletion-epoch bracket — sound.
- Ordering on failure paths: open() memory-first with read-back undo; close() memory-first with fail-closed hasPersistedSession; restore() marker-before-row with compensation; silentClose storage-first asymmetry only invoked pre-memory-commit; deleteProfile tombstone-resume idempotency — consistent.
- Zeroize mid-sequence throws: unsealInternal handoff flag, unwrapPair defensive double-wipe, restore() ownership flags vs map-transfer, finalizeRestore remove-from-map-before-await, exportPlain probe zeroize-then-null-check — correct.
- Degradation machine: every DEK/MAC discard site discards then opens derived-only + emits; changeProfilePassword refuse-vs-self-heal split deliberate.
- TTL/alarm races: staleness equality gate survives applyTtlChange; refresh reschedules; alarm-during-change reopen wins gate.
- pending maps: consume-before-await honored; sweeps/consumers serialize under facade lock.
- Fr.fromBuffer throw paths (crafted bearer ≥ modulus) → silentClose not init crash; verifyEnvelopeMacV2(undefined mac) → false fail-closed.
