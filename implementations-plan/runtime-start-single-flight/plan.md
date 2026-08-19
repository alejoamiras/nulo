# runtime-start-single-flight [mid, bug]

Arc E of the discovery-fixes follow-on (parent: `implementations-plan/fix-cold-wake-discovery-loss/plan.md`, out-of-scope finding: "runtime.start()'s `started` flag is never reset on failure"). Fixes the SW boot's start latch.

## The bug (two defects, both proven RED first)

`createWalletRuntime`'s `start()` used `if (started) return; started = true`:

1. **Resolve-before-ready (happy path!):** any concurrent second `start()` call void-resolved immediately while the first boot was still mid-flight. Real victim: the price-alarm shim (`wallet/index.ts`) does `start().then(() => services.get(PriceService).onAlarmTick())` — an alarm landing during boot grabbed a not-yet-registered service, threw, and the tick was lost.
2. **Permanent failure latch:** a failed boot left `started = true`, so every later `start()` void-resolved against a half-booted runtime; no retry for the SW's remaining lifetime, and no caller ever observed the failure.

RED evidence (`runtime.test.ts`, both red pre-fix with the predicted signatures): (a) second caller "settled" while the boot hung at BB init; (b) after a BB-init rejection, the second call resolved void and the boot was never re-attempted.

## The fix

`createSingleFlightStart(doStart, canRetryAfterFailure)` (`single-flight-start.ts`, 5 unit pins): concurrent callers share ONE in-flight boot; success memoizes; failure re-throws to every waiter and resets the memo ONLY when retry is safe.

**Retry classification is the design's core** (and the answer to the goal's idempotency-audit clause) — `retrySafe` starts true each attempt and is vetoed at three points; a vetoed failure keeps the rejected memo (callers observe the rejection; a fresh SW lifetime is the retry):

1. **Barretenberg init failure** — `BarretenbergSync.initSingleton` memoizes its REJECTED promise upstream with no reset (verified in the vendored SOURCE; the initial draft claimed self-reset after misreading the async `Barretenberg` class's catch — codex caught this and verified empirically). An in-lifetime retry could only re-observe the same error.
2. **TERMINAL migration block** (`blocked.terminal`) — a surviving recurring alarm must not re-run explicitly terminal engine work and burn durable attempts meant for SW-respawn cadence. A RETRYABLE block stays retryable (the engine's next-boot resume is designed for it).
3. **The registration zone** (from the first `services.add`) — `ServiceCollection.add` THROWS on duplicates (verified), and the pxe-provider/tab-lifecycle registrations are not re-entrant. No per-registration guards were added: the veto makes re-entry impossible, strictly stronger than sprinkling guards.

**Quiescence before retry** (codex blocking find): the config/BB parallel init uses `Promise.allSettled`, not `Promise.all` — a fast rejection in one leg must not settle `doStart()` (and reset the memo) while the other leg is still running, or a retry would re-run migration/config CONCURRENTLY with the first attempt's unfinished work. Both legs settle before any rethrow, so a reset memo implies quiescence.

Retryable failures in the remaining pre-registration steps ARE truly re-runnable: setUninstallURL is caught; the migration engine is contractually re-runnable with idempotent status writes; config.load re-reads.

**Call-site audit** (the rethrow must add no unhandled-rejection noise): `runtime.start()` has exactly two callers, both in `wallet/index.ts`, both already `.catch()`-guarded (the price-alarm shim and the boot kick). No changes needed.

## Validation

- RED→GREEN: `runtime.test.ts` 5/5 — the two original RED pins (concurrent-share, failed-boot-retry via a config failure) + three audit-forged pins (no-overlap quiescence, BB veto, terminal-vs-retryable migration classification) — plus `single-flight-start.test.ts` 5/5 (incl. the post-registration latch case the runtime-level pins can't reach without booting the real graph).
- `bun run audit:vue` green.
- SOLO `NULO_E2E_PROVERLESS=1 bun run e2e:agent` (boot path touched; sw-resilience is the canary) — see ledger.
- Mid tier: dual audit (codex xhigh + fable) on plan+diff, then codex end-diff convergence — see ledger.

**HARD BOUNDARY honored:** zero contact with the parked transport-ready-handshake surface. The memo changes when `start()`'s promise settles — it does not add readiness signaling, acks, or transport semantics.

## Audit ledger

- **Codex xhigh (mid-tier leg 1): `reject` with three blocking findings — ALL ACCEPTED and fixed.** (1) BB does NOT self-reset (the draft misread the wrong class's catch; codex verified empirically that `BarretenbergSync.initSingleton` retains its rejected promise) → BB failures now veto retry, pinned; (2) `Promise.all` rejected fast while the other leg still ran, so a reset memo could overlap unfinished work → `allSettled` quiescence, pinned (config-hangs-while-BB-fails); (3) terminal migration blocks were retry-enabled, letting a surviving alarm re-run terminal engine work → `blocked.terminal` vetoes, pinned both directions. Also fixed per codex: the stale `started`-flag reference in the relay's doc comment. Codex confirmed: the post-registration KEEP policy is conservative and correct; the alarm fail-closed trade is preferable; stop() semantics unchanged; no Ready-handshake contact.
