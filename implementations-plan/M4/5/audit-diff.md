# M4.5 — audit-diff (post-dual-audit)

Date: 2026-04-26

## BLOCKERs to absorb at execution time (both audits agreed)

1. **Stale alarm delivery race (codex BLOCKING)**: alarm listener closes session on name match only; queued stale delivery from an old alarm can lock a freshly refreshed session. The port already exposes `scheduledTime` (`alarms-port.ts:22`). **Fix**: gate `close()` on `alarm.scheduledTime === activeSession.session.lockedAt`; ignore mismatches. Add test: refresh or re-open, deliver old alarm event, assert new session stays unlocked.
2. **`IConfig.onUpdate` is sync fire-and-forget (BOTH audits BLOCKING)**: `EventHandler.add` takes sync callback; `invoke` doesn't await; `ConfigStore.set()` returns immediately. Plan's async `onConfigUpdated` becomes fire-and-forget. **Fix**: keep `onConfigUpdated` SYNC; update `this.sessionTtl` synchronously; then `void` an internal async helper with own error logging. Inside helper: if `since + newTtl <= Date.now()`, `close()` immediately; else reschedule/persist. Add test "shorten TTL below elapsed age locks immediately."

## Codex SHOULD-FIX

- Startup-fence claim wrong: services register RPC connect listeners in CONSTRUCTORS (`background/service.ts:22`), before `services.start()` runs. So `ProfileService.init()` is NOT "awaited before service is registered for RPC dispatch." The safer property: ProfileService public methods block on `ensureInitialized()` (`profile/service.ts:67`, `background/service.ts:129`). **Fix**: rewrite the claim. If a true pre-dispatch fence is needed, task execution with late listener registration / phase ordering.

## Plan agent SHOULD-FIX

- Init-ordering Q3: name file/line of SW boot sequence as verification target.
- lockedAt migration ownership: M4.5 stays at session schema v1; M4.7-c's session migrator must accept BOTH lockedAt-present and lockedAt-absent as v1.
- Missing test: refresh observes new lockedAt in storage (current #3 only checks alarm registry).
- Missing test: stale alarm fires after `silentClose()`.

## Recommended execution-time absorption

1. **Listener architecture**: keep config-update listener sync; dispatch reschedule/lock work via internal `void (async () => { ... })()` helper.
2. **`scheduledTime` gate**: alarm handler matches `alarm.scheduledTime === activeSession.session.lockedAt` to ignore stale deliveries.
3. **TTL-below-elapsed-age**: when config change makes `since + newTtl <= Date.now()`, lock immediately.
4. **Fix startup-fence claim**: rewrite to "ProfileService public methods block on `ensureInitialized()`" (the actually-true property). If a real pre-dispatch fence is wanted, add a task to the M4.5-or-follow-up scope.
5. **Add 2 tests**: stale alarm post-refresh, TTL-shrink-below-elapsed.

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 — small revisions; mostly listener wiring + scheduledTime gate. Tractable in-place.
