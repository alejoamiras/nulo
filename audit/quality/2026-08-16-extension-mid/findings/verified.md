# Verified findings — quality 2026-08-16-extension-mid

Phase 4 verifier pass, medium effort: top 5 by impact bucket (all-architectural first). Each verifier re-read the source blind and stated its own conclusion BEFORE reading the claim (anchoring guard). Q-06..Q-12 were not verifier-checked at this effort level — treat them as consolidated-only.

| Finding | Verdict | Confidence |
|---|---|---|
| Q-01 god-service accretion (5 services) | CONFIRMED | high |
| Q-02 full-backup restore Long Method | CONFIRMED-WITH-CORRECTIONS | high |
| Q-03 EventHandler silent swallow | CONFIRMED | high |
| Q-04 composition-root closures | CONFIRMED | high |
| Q-05 alarm ritual | CONFIRMED-WITH-CORRECTIONS (narrowed) | moderate |

## Q-01 verification — VERDICT: CONFIRMED (final confidence: high)

**Own blind conclusion:** independently, all five files are genuine Large Class / Divergent Change instances; profile/service.ts already delegates to `SessionManager`/`PasskeyRecoveryCoordinator`/`TombstoneRepository` as real separately-instantiated collaborators (profile/service.ts:31,29,42,140-154) — the extraction seams exist. Git history on all five shows unrelated change reasons colliding.

**Corrections:** none material. One methodology note: `network/service.ts`'s "21 commits (highest-churn)" matches only with `git log --follow` (15 without; the repo restructure rename) — real number, silently different methodology than the other four counts.

**Verified claims (all held):** deleteDatabase 3× with 3 DIFFERENT onblocked policies (246-248 resolve-false / 263-266 resolve-void / 760-775 timeout-reject; deleteDb reused at 643/685/693); purge-epoch fence duplicated at withPxeRead:828/844 + withPxeWrite:879/889 with the first-party "concurrency audit MED #4" comment admitting this bug class already recurred once; `IProfileReader.onProfileDeleted` dead surface (declared :68, zero production `.add()` sites, only test fakes); `ArtifactRegistry` speculative hooks (`chainId` self-commented as unread, `setPolicy` zero production callers, single ctor call site).

**Strengthened evidence:** the pxe deleteDb/purge-epoch pair is a first-party ADMISSION (inline comment) that centralization was already needed once and wasn't done.

**Smallest safe first step:** extract `PxeLifecycleCoordinator` (teardown + epoch fencing) first — self-documented recurring bug class, smallest blast radius, directly prevents a third fencing-bug recurrence.

## Q-02 verification — VERDICT: CONFIRMED-WITH-CORRECTIONS (final confidence: high)

**Own blind conclusion:** `restoreBackup()` (532 lines, 208-739) is a genuine Long Method with distinct sequential stages, BUT extraction safety is constrained by shared-closure state: `createdProfileId`/`finalizeStarted` (rollback bookkeeping read in the one outer catch), `importedChainAddress` (deliberately hoisted so the LATER token-relink stage can read it), and the two service clients threaded through nearly every stage + the outer finally. 11 service clients and 10 commits independently confirmed.

**Corrections:**
1. Impact line enumerates 12 service names for "11 service contracts" — `balance` is a spurious duplicate (no distinct BalanceService; only `TokenBalanceServiceClient`). Count right, enumeration has a stray entry.
2. The proposed independent extraction of "account provenance filtering" (:462-557) and "token relinking" (:559-619) is NOT independent: they share the deliberately-hoisted `importedChainAddress` Set (comment at :462-464) that the relink stage's chain-equality check (:601-605) reads. Naive extraction silently drops that cross-check unless the Set is explicitly returned/threaded.
3. `profileService`/`networkService` must be parameters of every extracted stage (implied but not spelled out).

**Strengthened evidence:** every per-stage line cite verified accurate; 10-commit churn confirmed via git log; 11-client count independently verified via `ServiceClient()` instantiation grep.

**Smallest safe first step:** extract validation+migration (:219-312) first — pure function of `fullBackup`/`checksum`/`backup`, zero service clients, precedes all rollback-bookkeeping state: zero closure-state risk.

## Q-03 verification — VERDICT: CONFIRMED (final confidence: high)

**Own blind conclusion:** `EventHandler.invoke()` (`packages/wallet-core/src/utils/event-handler.ts:22-28`) wraps each subscriber callback in a bare, silent `try { callback(payload) } catch {}` — no logging, no rethrow, no subscriber identity. Genuine exception-swallowing smell; one broken listener is invisible while siblings look healthy.

**Corrections:** Independent grep counts **50** distinct production files referencing `EventHandler` (39 direct `new EventHandler`), vs the finding's "~52" — within rounding, not material. Fan-out is amplified by `base-service.ts:130` generically dispatching every service's events through it.

**Strengthened evidence:**
- `event-handler.ts` is the ONLY empty `catch {}` in all of `wallet-core/src` (exact grep) — the "sole bare uncommented catch" claim is exactly correct.
- No test file exists for it — confirmed.
- Sibling swallows all carry comments/logging (`lock.ts:56-59,96-100`, `jobs/error.ts:46-51,60-62`, `entity_storage.ts` uses `console.error`).
- `Lock`'s constructor already takes `(name?, logger?: ILogger)` — the proposed fix matches an established package pattern.

**Smallest safe first step:** optional `logger?: ILogger` constructor param + log error/context in the per-subscriber catch + one colocated contract test. Hours; zero dispatch-behavior change.

## Q-04 verification — VERDICT: CONFIRMED (final confidence: high)

**Own blind conclusion:** both are undecomposed Long Methods, not cohesive composition roots. `initWalletSdkHandler` (background.ts:76-450, 375 lines) mixes ~9 concerns sharing one closure's mutable state, including the `handleEncryptedMessage` monkeypatch (332-344). `execution/service.ts` `init()` (166-367, ~200 lines) populates 25 `= null!` fields; several dependencies are passed as EAGER non-closure values (`resolver: this.resolver`, `txBuilder: this.txBuilder`, `planner: this.planner`) so a reorder silently captures a still-`null!` instance, while lazy arrow-fn deps are order-independent.

**Corrections:** none substantive. The `:201,:230,:239,:286` cites are in execution/service.ts (each the start of a `new XxxExecutor({...})` with inline adapter closures) — verified. The "~50-line" transport listener is 48 lines.

**Strengthened evidence:** the finding UNDERSTATES the risk — the `= null!` typing disables strict-null-checking entirely, so nothing (not even the type system) guards a reorder wiring a null dependency into an eagerly-read field.

**Smallest safe first step:** pilot on the lowest-risk piece: `buildFeeStrategies` (built from already-set fields at init()'s tail, no ordering hazard) or `wireTabLifecycle` (closes only over handler/logger). Defer the `discoveryQueue` forward-declaration and eager-value execution fields to a careful later pass.

## Q-05 verification — VERDICT: CONFIRMED-WITH-CORRECTIONS (final confidence: moderate)

**Own blind conclusion:** all four hand-roll alarm-name constant + create/clear; three self-register onAlarm with an inline name guard while `PriceService` is dispatch-filtered externally in `wallet/index.ts:81-85` (deliberate "single dispatch path"). Real mechanism differences: `periodInMinutes` (price/reaper/gc) vs dynamically-recomputed one-shot `when` (session-manager, rescheduled from 4 call sites under `runExclusive`); price/session-manager gate alarm existence on runtime state, reaper/gc have NO enabled-predicate.

**Corrections (the finding overstates uniformity):**
1. Session-manager's actual boot reconcile is `restore()` (`session-manager.ts:341-432`, esp. 356-361, 428) — NOT the cited `:70,148,582-638` (ctor registration + helpers).
2. Reaper/GC unconditionally recreate + sweep every boot (no conditional "should this alarm exist") — a different shape than price's gated create-else-clear.
3. `reaper.ts` line cites are off by ~40 lines (real: create 118-119, clear 139, dispatch 142-143); `gc.ts` cites check out.
4. Price's dispatch is centralized externally — inconsistent with the other three's self-registration; "identical shape" is too strong.

**Strengthened evidence:** still a genuine cross-cutting smell — 4 places independently solve "don't let a stray/stale alarm fire wrong."

**Refined recommendation (narrower than the finding's):** extract only a thin `AlarmDispatcher(name)` wrapper (name constant + create/clear + name-guard); leave scheduling semantics (periodic vs `when`, gating) per-caller. The proposed full `AlarmBackedTask(name, period, tick, enabled)` does NOT fit session-manager's `when`-based reschedule-under-lock without redesign. Migrate GC first (simplest, no gating).
