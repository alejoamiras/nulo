# R2 design — Q-15 lock/bootstrap product race (mid, concurrency)

The product-code fix round-1 deliberately deferred (`../lessons/Q-15.md` §26-27). Round-1 fixed
only the TEST side (`lockWallet` waits on authoritative session storage); the latent product race
is R2.

## The race (verified against current dev-quality HEAD)

1. **Lock** — `Header.vue:23-25`: `if (!isLogined) return; isLogined = false; managers.profile.lockActiveProfile()`
   — `lockActiveProfile()` is **fire-and-forget** (no `await`).
2. `lockActiveProfile()` → background `SessionManager.close()` → clears the authoritative session
   storage (`chrome.storage.session["nulo:core:session"]`, `SESSION_STORAGE_ROOT`) → emits
   `onActiveProfileChanged(undefined)`.
3. `onActiveProfileChanged(undefined)` (`app.vue:131-139`): `closeAll(); isLogined=false;
   profiles=…; router.push("/popup/auth")`.
4. **The bug** — a stale `bootstrapActiveProfile(profile)` (kicked off by a *prior*
   `onActiveProfileChanged(newProfile)` right after a password change) is still awaiting through
   `initNetworks → initAccount → initTransactionService → syncTransactions`; its FINAL line
   `appStore.isLogined = true` (`useProfileBootstrap.ts:76`) lands **after** step 3 → resurrects
   `isLogined`.
5. Route guard `popup/index.ts:63-65`: `if (to.name === "popup-auth" && appStore.isLogined) next(from||general)`
   — bounces the `/popup/auth` push → hash never changes. Session IS cleared (storage authoritative);
   only the UI redirect loses. Symptom: popup shows the general page while locked.

Trigger window is narrow (lock click landing inside the post-password-change bootstrap window).
Low security impact (session genuinely cleared); it's a UI-integrity `isLogined` race.

## Candidate fixes

**A. Bootstrap end-guard (localized to `useProfileBootstrap.ts`) — RECOMMENDED.**
Before the resurrecting write, re-read the authoritative active profile; only set `isLogined=true`
if it still matches the profile we bootstrapped:
```ts
// after syncTransactions(), replacing `appStore.isLogined = true`
const current = await managers.profile.getActiveProfile()
if (current?.id === profile.id) appStore.isLogined = true
```
JS is single-threaded: after the `await` resolves, the `if`+write run with no interleaving, so a
lock that cleared the session before the re-check → `current === undefined` → skip (the step-3
handler already set `isLogined=false` + redirected, so skipping leaves the correct locked state). A
lock that clears *after* the write → step-3 handler runs last → also correct. "The lock wins" in
every ordering. Apply to BOTH `bootstrapActiveProfile` and `hydrateKnownProfile` for consistency
(the latter is initial-load, far less racy, but cheap to harden).
- Pro: minimal, one file, unit-testable in isolation, matches the summary's stated intent.
- Con: one extra `getActiveProfile()` round-trip at bootstrap tail. Leaves `appStore.profile`/
  networks/accounts populated (stale-but-harmless — UI is on `/popup/auth`; a fresh popup re-derives
  from storage). Does not *cancel* the in-flight work, only neutralizes its harmful write.

**B. Epoch/generation guard.** Monotonic counter bumped on every lock + profile switch; bootstrap
captures at start, checks unchanged before `isLogined=true`.
- Pro: robust; cancels the stale bootstrap fully.
- Con: spreads state across Header/app.vue/store/composable; more surface for a bug the minimal fix
  already closes. Mid-bootstrap cancellation isn't required — only the `isLogined` write is harmful.

**C. Route-guard authoritative re-check.** `popup/index.ts` reads session storage instead of
trusting `isLogined` for the `popup-auth` bounce.
- Pro: fixes at the routing trust boundary.
- Con: async storage read on every nav; broad routing-behavior change; heavier than the race needs.

## Test plan (pins the fix; deterministic, no network)

Unit test on `useProfileBootstrap` (or a focused component test) that reproduces the ordering:
seed an active profile; start `bootstrapActiveProfile(p)`; mid-flight (mock a bootstrap step to
`await` a controllable deferred) flip the authoritative `getActiveProfile()` to return `undefined`
(simulating the lock's `SessionManager.close()`); let bootstrap finish; assert `appStore.isLogined`
is STILL `false` (the lock won). A companion test: no lock → `isLogined` becomes `true` (happy path
preserved). Gate: this unit test + smoke (`change password`, the round-1-hardened flake) + units.

## Decision ledger

- **Chosen:** A — minimal localized bootstrap end-guard, + return a `boolean` ("bootstrapped and
  still active") so `loadProfile` can gate its `/popup/general` push (closes the analogous
  initial-load bounce). Guard BOTH `bootstrapActiveProfile` and `hydrateKnownProfile`.
- **Rejected:** B (over-broad for the symptom — stale populated state is cosmetic here), C (routing
  blast radius AND wrong signal — see codex HIGH).
- **Codex xhigh review (`019f1f44`):** VERDICT **A sound; would not pick B/C.** Corrections adopted:
  (HIGH) `getActiveProfile()` is an RPC **serialized with `lockActiveProfile()` under `runExclusive`**
  (`profile/service.ts:148,429`), so the re-check waits behind an in-flight lock and observes the
  cleared state — strictly better than a storage-presence check. My "storage authoritative" framing
  was WRONG: storage is a persisted **mirror**; live authority is `SessionManager.activeSession`
  (they diverge on passkey-restore, `session-manager.ts:348`). `getActiveProfile()` reflects the live
  session, so A uses the right signal. (LOW) return `boolean` for a clean composable contract —
  ADOPTED. (MED) A is not full cancellation (stale bootstrap still writes profile/net/acct state
  before the guarded write); codex agrees this does NOT preserve the auth-bounce bug and stale
  populated state is out of R2 scope (that's B's domain). Confirmed safe: lock-during-re-check,
  no client caching of `getActiveProfile()`, keeping `appStore.profile` while locked.
- **Opus Plan review:** SKIPPED — codex xhigh gave a decisive, well-grounded verdict that re-derived
  the concurrency model from source (runExclusive serialization); round-1 (`../lessons/Q-15.md`
  §29-30) established codex + main-leg as an adequate deep-lite when the fable/opus Plan leg is
  unavailable. No unresolved fork remained for a third opinion to adjudicate.

## Security & adversarial

No new trust boundary. The authoritative lock signal (session storage removal) is unchanged and
remains the source of truth; A only stops a stale client-side write from *contradicting* it in the
UI. No assertion weakened, no fail-open introduced. Threat: could an attacker force the "clear after
write" ordering to keep a locked session's UI alive? No — step-3's handler always runs after and
sets `isLogined=false`; and the session storage is already cleared, so no privileged action is
reachable regardless of the `isLogined` flag's transient value.
