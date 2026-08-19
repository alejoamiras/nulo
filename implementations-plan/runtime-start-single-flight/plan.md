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

1. **Barretenberg init failure** — `BarretenbergSync.initSingleton` memoizes its REJECTED promise upstream with no reset (verified in the vendored SOURCE; the initial draft claimed self-reset after misreading the async `Barretenberg` class's catch — codex caught this and verified empirically). An in-lifetime retry could only re-observe the same error. The veto lives in the BB leg's own `.catch`.
2. **ANY migration-blocked throw** — fable's HIGH find hardened codex's terminal-only version: every `Migrator.run()` on a failing migration bumps the DURABLE attempt counter (`bumpAttempts`, max 3), whose cadence is next-boot by construction. With a terminal-only veto, the surviving 3-minute price alarm would re-run the engine on attempts 1–2 and burn the whole cross-boot budget inside one SW lifetime, flipping a recoverable block to terminal with zero real boots. Unconditional veto; pinned for the budget-burner variant (`failed`+`breaking`+`terminal:false`) AND the retryable needs-recovery.
3. **The registration zone** (from the first `services.add`) — `ServiceCollection.add` THROWS on duplicates (verified), and the pxe-provider/tab-lifecycle registrations are not re-entrant. No per-registration guards were added: the veto makes re-entry impossible, strictly stronger than sprinkling guards.

**Overlap-on-retry, settled across both audit legs:** codex initially demanded `allSettled` quiescence (a fast BB rejection must not reset the memo while config still ran). Fable then showed that with the BB veto in place `allSettled` protects an empty set — a BB rejection keeps the memo (no retry, no overlap) — while ADDING a silent forever-pending boot when a leg hangs after the other failed, which is the defect class this arc removes. Codex accepted the reversal on resume, correcting one detail of fable's rationale along the way: `config.load` CAN reject (its `apply()` storage write is uncaught) — which doesn't disturb `Promise.all` (a config rejection settles its own leg before any retry re-runs it) but does mean the retryable zone is real, not vestigial. Resolution: `Promise.all` with the veto in the BB leg's `.catch`; pinned (fast BB rejection + memo kept + no re-run while config pends).

**What remains genuinely retryable:** transient storage writes — the schema-status sets/removes AND config.load's own `apply()` write. The retry pin drives the status-write representative.

**Fable's plain-memo alternative (F3), considered and NOT taken:** dropping the retry zone entirely (pure `memo ??= doStart()`) would fix both proven defects by deletion. Not adopted because the goal explicitly prescribes the failure-resetting form and the retryable zone is genuinely reachable (transient storage writes, config's apply()); the veto classification is fully pinned. Recorded so a future simplification has the argument ready.

**Call-site audit** (the rethrow must add no unhandled-rejection noise): `runtime.start()` has exactly two callers, both in `wallet/index.ts`, both already `.catch()`-guarded (the price-alarm shim and the boot kick). No changes needed.

## Validation

- RED→GREEN: `runtime.test.ts` 5/5 — the two original RED pins (concurrent-share; failed-boot-retry, now driven by the transient-storage-write representative) + three audit-forged pins (fast-BB-rejection-with-config-pending keeps the memo with no overlapping re-run; BB veto; unconditional migration-block veto incl. the budget-burner variant) — plus `single-flight-start.test.ts` 5/5 (incl. the post-registration latch case the runtime-level pins can't reach without booting the real graph).
- `bun run audit:vue` green.
- SOLO `NULO_E2E_PROVERLESS=1 bun run e2e:agent` (boot path touched; sw-resilience is the canary) — see ledger.
- Mid tier: dual audit (codex xhigh + fable) on plan+diff, then codex end-diff convergence — see ledger.

**HARD BOUNDARY honored (comment-only contact, no semantics):** the diff touches `content-message-relay.ts` ONLY to fix its header comment's stale `started`-flag sentence (a codex condition) — zero code, no readiness signaling, acks, or transport semantics. The memo changes when `start()`'s promise settles; attach-keyed drain stays correct because attachment happens strictly earlier in the boot tail.

**Recorded behavior change (fable F8):** after a post-registration boot failure, a later price alarm previously void-resolved, fetched the (registered) PriceService, and parked ~30s in `ensureInitialized()` before throwing; it now observes the rejection immediately and skips — fail-closed and faster, deliberately accepted.

## Audit ledger

- **Fable (mid-tier leg 2, fresh context): `conditional approve`** — independently re-derived the BB defect, then found what the codex round missed AND what its fix introduced: (F1 HIGH) the terminal-only migration veto fires after the damage — unconditional veto adopted + budget-burner pin; (F2) `allSettled` protected an empty overlap set once BB vetoed, while adding a silent forever-pending boot — reverted to `Promise.all` with the veto in BB's `.catch`; (F5) stale `start()` JSDoc + unpinned `stop()` semantics — both documented; (F6) test-fidelity nits (non-variant migration result, missing budget-burner pin) — fixed; (F7) plan's "zero contact" boundary claim contradicted the relay comment fix — reworded to comment-only contact; (F8) the alarm fail-closed trade recorded. Its F3 plain-memo recommendation is documented above as considered-not-taken. Confirmed sound: the memo helper itself, the zone boundary placement, the keep-policy's necessity, both original RED pins, MV3 event re-entry unaffected.
- **Codex resume 2 (final end-diff): `conditional approve` → CONVERGED.** Codex explicitly accepted BOTH fable reversals ("Promise.all is preferable once BB rejection vetoes the memo"; "unconditional migration-block veto correctly preserves the cross-boot attempt budget") — full three-way design convergence. Its remaining conditions were documentation-fidelity: correct the "config cannot reject" claims (its `apply()` write is uncaught — fixed in runtime/test/plan wording), refresh the stale allSettled-era test header and validation text (fixed), and qualify the `stop()` contract for the in-flight-boot case instead of claiming an unwritten pin (fixed — the JSDoc now states stop-during-boot does not cancel the heartbeat arming). All conditions met in the final commit.
- **Codex xhigh (mid-tier leg 1): `reject` with three blocking findings — ALL ACCEPTED and fixed.** (1) BB does NOT self-reset (the draft misread the wrong class's catch; codex verified empirically that `BarretenbergSync.initSingleton` retains its rejected promise) → BB failures now veto retry, pinned; (2) `Promise.all` rejected fast while the other leg still ran, so a reset memo could overlap unfinished work → `allSettled` quiescence, pinned (config-hangs-while-BB-fails); (3) terminal migration blocks were retry-enabled, letting a surviving alarm re-run terminal engine work → `blocked.terminal` vetoes, pinned both directions. Also fixed per codex: the stale `started`-flag reference in the relay's doc comment. Codex confirmed: the post-registration KEEP policy is conservative and correct; the alarm fail-closed trade is preferable; stop() semantics unchanged; no Ready-handshake contact.
