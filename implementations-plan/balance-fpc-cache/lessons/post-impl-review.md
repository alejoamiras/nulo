# Post-impl code review — two rounds to convergence

## Round 1 (three parallel lenses over `dev..HEAD`)

Fixed (commit `code-review round 1`):
- **SW reader cross-epoch join**: a post-switch `get()` joined a pre-switch in-flight compute and received the old profile's data as the promise VALUE — the stale-marking commit fence only demotes the cache entry. Flights are now epoch-stamped; cross-epoch joiners wait the flight out and re-enter. `epochAtStart` is captured before any await.
- **Cross-profile peek**: the profile-switch invalidation stale-marked, leaving the old profile's figures peekable. New `evictAll()` (evict, not stale-mark) on the profile-change wiring; `invalidateAll` stays for the same-profile PrivateFPC-mutation sweep.
- **Observer-side retry debt**: an ensure that JOINED a failing forced flight ended degraded with `retryDebt=false` — permanent "retrying in the background" with no loop running. Debt now follows the OBSERVING cause (set by ensure on requested degraded legs); success commits clear it ONLY on the retry path (D11 letter — the previous ensure-clears semantics could kill the loop without bumping `retryVersion`, stranding the degraded card).
- **Forced stale-wait bounded** (`withTimeout` on the pre-trigger flight wait) — an unbounded wait let every joiner inherit a transport wedge ~4× the documented fetch bound.
- **`armRetry` clears an overwritten timer** — a concurrent ensure + mid-flight `runRetry` re-arm could orphan a live `setTimeout` into a duplicate backoff chain.
- **Pre-trigger success vs forced stale-mark**: a plain refresh overtaken by a settle un-dimmed the card with pre-settle data (`forcedGasPending` counter; non-forced successes preserve the mark).
- **Lease overlap replaces release-before-subscribe** in both cards: releasing first transits the profile through zero subscribers on a same-profile switch, firing the suspenders fence — epoch bump, entries wiped, the A→B→A flap re-issuing its RPC (the old keyed-maps invariant). Subscribe-new-then-release-old keeps the fence for cross-profile switches only.
- **Embedded flip via the parent v-model** never ran `runInit`, so the early-return release never fired — the store retry loop survived into embedded mode and a recovery recommit could clobber the dApp's embedded settings. A `[isCustomMethod, useOwnMethod]` watcher releases on entering the embedded-visible state; `recommit` mirrors the entry guards.
- **Coverage holes (mutation-proven)**: release-on-identity-change and the D11 debt lifecycle were entirely unpinned; GasBalanceCard's identity was undrivable (static app-store mock). All pinned now.
- Hygiene: doubled TSDoc in `wallet-bridge/fee.ts`, PR-number/audit-round comment vocabulary, dead exports (`__testing`, `scopeKeyFor`, unused re-export), `!props.profile` guard, `recommit` rejection guard.

## Round 2 (adversarial verification of round 1's fixes)

Fixed (commit `code-review round 2`), each failure mode empirically reproduced before fixing and pinned after:
- **`evictAll` resurrection**: a compute in flight across the eviction wrote its snapshot back stale-marked — peekable again, re-opening the leak. `evictGeneration` captured at compute start; a generation mismatch skips the write-back entirely (the pre-switch caller still gets its value; popup-side fences handle it).
- **chainId hole in both `runInit` guards** (post-storage revalidation + post-ensure drift guard) while `reqKey`/`liveKey`/`recommit` had it — a testnet-reset-shaped chainId swap mid-init let the stale-chain run commit last with recovery dead.
- **Forced-vs-forced**: settle S2 landing while S1's forced run is in flight — F1's success cleared S2's stale-mark and bumped `forcedVersion` (early overlay reset) with pre-S2 data. A forced success now counts as post-trigger only when it is the LAST live forced run.

## Test-infrastructure find

`setActivePinia(createPinia())` in a beforeEach does NOT isolate the component suites: the SFC transform chain resolves a different pinia module copy than the test file's import, so all mounts silently shared one store across tests (proved by an entry version accumulating across tests). Both card suites now INJECT a fresh pinia per mount/test (`global.plugins` / `config.global.plugins`); the plain-TS store suite is unaffected (single module copy).

## Residual nitpicks — reviewed, deliberately not fixed

- `retryDebt` can strand `true` on a ready slice when only a non-retry-capable observer saw the degraded state (dormant; costs at most one extra TTL-cache-served refetch; self-corrects on the next degradation).
- GasBalanceCard first-fetch transport REJECTION → skeleton with no retry (parity with the pre-store SWR card; a resolved-null renders the em dash as designed).
- A saved `fj` selection on a null balance stays selected-but-disabled instead of falling through to the default (fail-closed everywhere; reconcile ordering is the pinned deviation-2 behavior).
- Private-leg disabled copy says "no balance" for unknown (dev parity; the public leg's honest copy was the enumerated deviation).
- The suspenders fence clears a profile's entries on page navigation (conservative; the SW TTL cache is the warm layer).
- A same-profile identity switch can trigger one spurious idempotent `recommit` (extra storage read only).
- A never-settling raw RPC's `rawFlights` entry persists (memory-only, transport-bounded in practice).
