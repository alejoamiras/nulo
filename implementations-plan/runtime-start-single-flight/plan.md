# runtime-start-single-flight [mid, bug]

Arc E of the discovery-fixes follow-on (parent: `implementations-plan/fix-cold-wake-discovery-loss/plan.md`, out-of-scope finding: "runtime.start()'s `started` flag is never reset on failure"). Fixes the SW boot's start latch.

## The bug (two defects, both proven RED first)

`createWalletRuntime`'s `start()` used `if (started) return; started = true`:

1. **Resolve-before-ready (happy path!):** any concurrent second `start()` call void-resolved immediately while the first boot was still mid-flight. Real victim: the price-alarm shim (`wallet/index.ts`) does `start().then(() => services.get(PriceService).onAlarmTick())` — an alarm landing during boot grabbed a not-yet-registered service, threw, and the tick was lost.
2. **Permanent failure latch:** a failed boot left `started = true`, so every later `start()` void-resolved against a half-booted runtime; no retry for the SW's remaining lifetime, and no caller ever observed the failure.

RED evidence (`runtime.test.ts`, both red pre-fix with the predicted signatures): (a) second caller "settled" while the boot hung at BB init; (b) after a BB-init rejection, the second call resolved void and the boot was never re-attempted.

## The fix

`createSingleFlightStart(doStart, canRetryAfterFailure)` (`single-flight-start.ts`, 5 unit pins): concurrent callers share ONE in-flight boot; success memoizes; failure re-throws to every waiter and resets the memo ONLY when retry is safe.

**The retry-zone latch is the design's core** (and the answer to the goal's idempotency-audit clause): `registrationsBegun` flips right before the first `services.add`. 

- **Pre-registration zone** (uninstall URL → migration gate → config.load + BB init): every step is re-runnable — setUninstallURL is caught; the migration engine is contractually re-runnable (its status writes are idempotent); config.load re-reads; bb.js's `initSingleton` self-resets on failure (verified in the vendored source). Failures here reset the memo → the next call retries for real.
- **Registration zone and later**: `ServiceCollection.add` THROWS on duplicates (verified), and the pxe-provider/tab-lifecycle registrations are not re-entrant. Failures here KEEP the rejected memo: callers observe the same rejection (instead of the old silent void-resolve), and a fresh SW lifetime — fresh module state — is the retry. **No new registered-guards were added**: the zone latch makes re-entry impossible, which is strictly stronger than sprinkling per-registration guards (documented refinement of the goal's letter, consistent with its intent).

**Call-site audit** (the rethrow must add no unhandled-rejection noise): `runtime.start()` has exactly two callers, both in `wallet/index.ts`, both already `.catch()`-guarded (the price-alarm shim and the boot kick). No changes needed.

## Validation

- RED→GREEN: `runtime.test.ts` 2/2 (was 0/2 pre-fix) + `single-flight-start.test.ts` 5/5 (incl. the post-registration latch case the runtime-level pins can't reach without booting the real graph).
- `bun run audit:vue` green.
- SOLO `NULO_E2E_PROVERLESS=1 bun run e2e:agent` (boot path touched; sw-resilience is the canary) — see ledger.
- Mid tier: dual audit (codex xhigh + fable) on plan+diff, then codex end-diff convergence — see ledger.

**HARD BOUNDARY honored:** zero contact with the parked transport-ready-handshake surface. The memo changes when `start()`'s promise settles — it does not add readiness signaling, acks, or transport semantics.

## Audit ledger

(appended as legs complete)
