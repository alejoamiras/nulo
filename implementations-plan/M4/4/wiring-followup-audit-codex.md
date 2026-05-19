# M4.4-followup — codex (xhigh) audit

Date: 2026-04-26
Plan: implementations-plan/M4/4/wiring-followup.md

## Verdict

No BLOCKING. 2 SHOULD-FIX + 2 NIT.

## Findings

-    this.logger.log(this.logSource, LogLevel.Debug, sanitizeTelemetry(record))
- **Keep NoopTelemetrySink + add a config-toggle**: over-engineered for a 1-line default change. The optional ctor param is already the toggle for tests; production has no reason to opt out.
- **Make `LoggingTelemetrySink` always log at Info**: too chatty — `success`/`rejected` happens dozens of times per session. Splitting by anomaly preserves Info as a meaningful signal.
- **NIT** — Keep `NoopTelemetrySink` exported. After this change it becomes the explicit opt-out for tests/future consumers, not dead code. Removing it would be needless churn.
- **NIT** — Make the planned `spyLogger` explicitly `void`-returning to match [`packages/wallet-core/src/logger/interfaces.ts:28`]((project root)/packages/wallet-core/src/logger/interfaces.ts:28): `log: (...): void => { logCalls.push(...) }`. The loose version will probably compile, but the explicit signature is cleaner.
- **Plumb `telemetry` param through `PxeServiceClient` ctor + 6 call sites**: ~10 file diff, more visible. Rejected because the default-change approach is simpler + automatically picks up future offscreen ServiceClient subclasses.
- **SHOULD-FIX** — If you keep the default-change approach, update the stale contract comments in [`packages/extension-messaging/src/offscreen/telemetry.ts:5`]((project root)/packages/extension-messaging/src/offscreen/telemetry.ts:5), [`telemetry.ts:111`]((project root)/packages/extension-messaging/src/offscreen/telemetry.ts:111), and [`telemetry.ts:121`]((project root)/packages/extension-messaging/src/offscreen/telemetry.ts:121). They currently say the default is `NoopTelemetrySink` and that `LoggingTelemetrySink` logs at debug only; both become false.
- **SHOULD-FIX** — The plan misses a narrower fix: wire the sink in [`packages/aztec-runtime/src/pxe/client.ts:36`]((project root)/packages/aztec-runtime/src/pxe/client.ts:36) instead of changing the generic default in [`packages/extension-messaging/src/offscreen/client.ts:33`]((project root)/packages/extension-messaging/src/offscreen/client.ts:33). A `super(PXE_SERVICE_NAME, logger, undefined, new LoggingTelemetrySink(logger))` change fixes the actual production bug for all six callers with smaller blast radius. The planned default swap is still safe in this repo, but it is not the minimal fix.
- `NoopTelemetrySink` and `MemoryTelemetrySink` remain available; tests that want explicit control pass them via the optional ctor param.
- `RequestTelemetry` + `RequestTerminalStatus` types
- `sanitizeTelemetry()` static-whitelist filter
- `send_failed` cleanup runs unconditionally inside the catch — caller sees `"Offscreen send failed: ${method}"` instead of a 90s hang. Observable behavior, not just observable logs.
- `send_failed` terminal status + synchronous cleanup wrapping `chrome.runtime.sendMessage`
- `success` / `rejected` → `LogLevel.Debug` (chatty, normal flow)
- `TelemetrySink` interface + 3 sinks: `NoopTelemetrySink` (default), `LoggingTelemetrySink`, `MemoryTelemetrySink` (test-only)
- `timeout` / `disconnected` / `send_failed` → `LogLevel.Info` (anomalies — user notices these without flipping to Debug)
- 8 packages, layer hierarchy enforced by biome (M3.7).
- All 6 `PxeServiceClient` callers (`fpc/note/transaction/token/execution/account-state`) instantiate as `new PxeServiceClient(this.logger)` — telemetry param defaults to `NoopTelemetrySink`, so events are discarded.
- Branch (planned): m4/4-followup-telemetry-default.
- Default logger filtering at `Info` (today's default): users see `timeout`/`disconnected`/`send_failed` events automatically in DevTools.
- M4.4 shipped at 34d5189: telemetry types + 3 sinks + sanitizer + send_failed terminal + sync cleanup wrapping chrome.runtime.sendMessage.
- Master HEAD: 84a9082 = 0.13.7 (M4 + AUDIT refresh, all signed).
- Merge ff to master after manual smoke
- Push origin/master with the M4 arc + this follow-up
- Set logger to `Debug`: see all events including success/rejected.
- Squash to a single commit on `m4/4-followup-telemetry-default`
- Version: 0.13.7 → 0.13.8
