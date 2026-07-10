# Q-17 — route profile/service.ts lock blocks through `runExclusive` · tier: **light (NOT mechanical)**

**Re-verify (STEP 1, vs `dev-quality`):** VALID. `runExclusive` defined at `service.ts:113-120` (`lock.enter()`/try/`finally lock.leave()`); ~21 facade methods paste the same `try{ await this.lock.enter() … } finally{ this.lock.leave() }` inline. claude-only finding but high-confidence + visually obvious (53 lock-pattern lines).

## The 3 patterns (each inline block maps to exactly one)
**A — simple lock block** (e.g. `getActiveProfile` 142-149):
```ts
try { await this.lock.enter(); …work…; return X } finally { this.lock.leave() }
→ return this.runExclusive(async () => { …work…; return X })
```
**B — lock block + zeroize-AFTER-leave** (e.g. `createProfile` 161-188: `finally { this.lock.leave(); zeroize(secret); zeroize(passhash) }`):
```ts
try {
  return await this.runExclusive(async () => { …work…; return X })
} finally { zeroize(secret); zeroize(passhash) }   // OUTER finally — runs AFTER runExclusive's own leave()
```
Preserves the EXACT current ordering: `lock.leave()` (inside runExclusive's finally) → then `zeroize` (outer finally). The zeroize must NOT move inside the locked fn (it currently runs post-leave so a thrown `open()`/`repo.set()` still zeroes — `await this.runExclusive(...)` inside the try keeps that: a throw propagates through runExclusive's finally (leave) then the outer finally (zeroize)).
**C — phased lock** (`unlockProfile` 197+: phase-1 locked snapshot → UNLOCKED ~1s crypto → phase-3 locked revalidate+open). Each locked phase → its own `runExclusive` call; the unlocked crypto stays between them verbatim. Do NOT collapse the phases into one runExclusive (that would hold the lock across the ~1s PBKDF2 — the whole point of the phasing).

## Load-bearing PINS (the "not mechanical" part)
1. **Non-reentrant Lock.** `runExclusive` is already wired at `:97` as `(fn) => this.runExclusive(fn)` for the config/alarm `applyTtlChange` path; comment `:106-112` warns a facade-locked `sessionTtl` write would re-enter → deadlock. **A method routed through runExclusive must NEVER be called from inside another locked section.** The 21 inline blocks are top-level RPC entries; if any nested today it would ALREADY deadlock (same `lock.enter()` twice), so working-today ⇒ no nesting ⇒ routing them through the same lock is safe. VERIFY during impl: no transformed method calls another locked facade method within its `runExclusive` fn.
2. **Zeroization-finally ordering** (pattern B) — outer finally, after runExclusive. The C1 invariant test asserts zeroize runs; keep it green.
3. **Phased methods stay phased** (pattern C) — never widen the lock over crypto.
4. Behavior-preserving: same lock acquired, same try/finally semantics, same emit ordering. No telemetry/reentrancy change (the finding's "future change" motivation is the WIN, not a behavior change now).

## Scope
The ~21 inline `lock.enter()/leave()` blocks in `service.ts`. Classify each as A/B/C, transform, preserve zeroize/emit/throw ordering verbatim. No signature changes.

## Validation gate
- `bun run lint` + `bun run typecheck:all`.
- `bun run test` for **extension** (profile service units — INCL. the batch-2 C1/C2/C3 race + zeroization-invariant tests, the real gate here).
- smoke + FULL network e2e (concurrent-confirm shard exercises the locked path).

## Decision ledger
- A-pattern over leaving inline: the helper already exists; the finding is "apply existing extract method." High-confidence.
- Keep phased methods phased (codex to confirm no method nests a lock). Extra codex eye per plan (concurrency-critical, batch-2-hardened path).

## Codex consult — verdict `conditional approve` (session 019f19a3); adopted findings
**Reentrancy: CONFIRMED SAFE** — no locked body calls another lock-acquiring facade method. `backup()`→`getActiveProfile()` but NOT while locked; `import*`→private `importPasswordProfile`/`importPasskeyProfile` after UNLOCKED prep. So A/B blocks can route through the same lock without deadlock. ✓ (my claim held).

**4 sites need SPECIAL handling (the non-mechanical part) — do NOT apply the naive transform:**
1. **`restore(passkey)` (~968-1021):** the `try` does WebAuthn/validation BEFORE `lock.enter()` (`:988`), `finally leave()` (`:1021`) — a `leave()` whose `enter()` isn't at the top of the same try. **Wrap ONLY the locked storage tail in `runExclusive`, NOT the whole try.** Preserve the "do NOT zero if stored in `pendingRestoreSecrets`" ownership rule verbatim.
2. **`restore(password)`:** has a `catch` INSIDE the lock region (`toRestoreError(err)` runs before `leave()`). Keep the `catch` INSIDE the `runExclusive` callback; put only zeroization outside. (Naive `try{ return await runExclusive }catch{}finally{}` would move `toRestoreError` after release → ordering change.)
3. **`changeProfilePassword` + `finalizeRestore(password)`:** zeroize INSIDE the locked body before `leave()`. **Do NOT reclassify as B** (moving zeroize to an outer finally changes timing). Keep zeroize inside the `runExclusive` callback.
4. Only blocks whose CURRENT outer `finally` is exactly `leave(); zeroize(...)` get the B treatment.

**Biggest wedge risk (codex):** accidentally widening a phased/pre-lock flow over PBKDF2/WebAuthn/restore-ceremony → blocks the alarm/config `runExclusive` + session RPCs for seconds-to-minutes. Classify each of the ~21 sites explicitly before transforming; default to leaving structure if a block doesn't cleanly match A or true-B.

**Implementation note:** map every site to {A | true-B | C-phased | SPECIAL-1..3 | leave-as-is} in a checklist before editing; gate on the C1/C2/C3 race + zeroization-invariant tests.
