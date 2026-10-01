# M4.4-followup — wire `LoggingTelemetrySink` as default

> **Status**: planned 2026-04-26 (post-M4 QA, post-master-push-prep). Branch: `m4/4-followup-telemetry-default`. Awaiting codex audit + execution.
>
> Closes the half-wired bridge from M4.4: the telemetry surface ships
> but `NoopTelemetrySink` is the default in `ServiceClient` (offscreen
> base), so every production caller drops events. User QA caught this
> when looking for `[offscreen-telemetry]` logs that never appear.

## Context recap

M4.4 shipped (commit `34d5189`):
- `RequestTelemetry` + `RequestTerminalStatus` types
- `TelemetrySink` interface + 3 sinks: `NoopTelemetrySink` (default), `LoggingTelemetrySink`, `MemoryTelemetrySink` (test-only)
- `sanitizeTelemetry()` static-whitelist filter
- `send_failed` terminal status + synchronous cleanup wrapping `chrome.runtime.sendMessage`

What's NOT working in production:
- All 6 `PxeServiceClient` callers (`fpc/note/transaction/token/execution/account-state`) instantiate as `new PxeServiceClient(this.logger)` — telemetry param defaults to `NoopTelemetrySink`, so events are discarded.

What IS working:
- `send_failed` cleanup runs unconditionally inside the catch — caller sees `"Offscreen send failed: ${method}"` instead of a 90s hang. Observable behavior, not just observable logs.

## Approach

**Single mechanism**: change the default sink in `ServiceClient` (offscreen base) constructor from `NoopTelemetrySink` to `LoggingTelemetrySink(logger)`. Every offscreen ServiceClient subclass picks this up automatically — no call-site changes needed.

**Plus**: split log level by status in `LoggingTelemetrySink.recordTerminal()`:
- `success` / `rejected` → `LogLevel.Debug` (chatty, normal flow)
- `timeout` / `disconnected` / `send_failed` → `LogLevel.Info` (anomalies — user notices these without flipping to Debug)

Production behavior:
- Default logger filtering at `Info` (today's default): users see `timeout`/`disconnected`/`send_failed` events automatically in DevTools.
- Set logger to `Debug`: see all events including success/rejected.
- `NoopTelemetrySink` and `MemoryTelemetrySink` remain available; tests that want explicit control pass them via the optional ctor param.

## Files affected

```
packages/extension-messaging/src/offscreen/client.ts          (1-line default change)
packages/extension-messaging/src/offscreen/telemetry.ts       (split level by status)
packages/extension/src/wallet/base/offscreen/client.test.ts   (extend existing tests)
```

No production caller changes. No new public API.

## Implementation specifics

### 1. `client.ts` — change default sink

```diff
-this.telemetry = telemetry ?? new NoopTelemetrySink()
+this.telemetry = telemetry ?? new LoggingTelemetrySink(logger)
```

Note: uses the `logger` ctor param (already in scope) rather than `this.logger` — doesn't matter functionally but reads cleaner.

### 2. `telemetry.ts` — split level by status

```diff
 export class LoggingTelemetrySink implements TelemetrySink {
   public constructor(
     private readonly logger: ILogger,
     private readonly logSource: string = "offscreen-telemetry",
   ) {}

   public recordTerminal(record: RequestTelemetry): void {
-    this.logger.log(this.logSource, LogLevel.Debug, sanitizeTelemetry(record))
+    const sanitized = sanitizeTelemetry(record)
+    const level = isAnomalyStatus(sanitized.status) ? LogLevel.Info : LogLevel.Debug
+    this.logger.log(this.logSource, level, sanitized)
   }
 }

+function isAnomalyStatus(status: RequestTerminalStatus): boolean {
+  return status === "timeout" || status === "disconnected" || status === "send_failed"
+}
```

`isAnomalyStatus` is a pure helper — easy to extend if a future status enum value should also surface at Info.

### 3. Tests — `client.test.ts`

Two test updates:

**(a) Replace** the existing test `default sink (NoopTelemetrySink)`:
```diff
-test("default sink (NoopTelemetrySink): client works without explicit sink", async () => {
+test("default sink (LoggingTelemetrySink): client works AND logs at logger sink", async () => {
   ...
+  // Build the client with a real ILogger spy; assert
+  // logger.log was called with the sanitized telemetry record
+  // and the right level for the status path.
})
```

**(b) Add** a level-discrimination test:
```ts
test("LoggingTelemetrySink uses Info for anomaly statuses, Debug for normal", () => {
  const logCalls: Array<[string, LogLevel, ...unknown[]]> = []
  const spyLogger: ILogger = { log: (src, lvl, ...rest) => logCalls.push([src, lvl, ...rest]) }
  const sink = new LoggingTelemetrySink(spyLogger)

  sink.recordTerminal({ method: "x", requestId: 1, startedAtMs: 0, endedAtMs: 1, status: "success" })
  sink.recordTerminal({ method: "x", requestId: 2, startedAtMs: 0, endedAtMs: 1, status: "timeout", detail: "timeout_fired" })
  sink.recordTerminal({ method: "x", requestId: 3, startedAtMs: 0, endedAtMs: 1, status: "send_failed", detail: "sendMessage_threw" })

  expect(logCalls[0][1]).toBe(LogLevel.Debug)  // success
  expect(logCalls[1][1]).toBe(LogLevel.Info)   // timeout
  expect(logCalls[2][1]).toBe(LogLevel.Info)   // send_failed
})
```

These augment the existing 9 M4.4 contract suite tests; no other file touches.

### 4. Sanity-check: existing tests still pass

The 9-test M4.4 contract suite uses `MemoryTelemetrySink` explicitly. Those pass-through unchanged.

The `silentLogger` used in the older 2 tests (the onReady hook tests that pre-date M4.4) is `{ log: async () => {} }` — even if `LoggingTelemetrySink` wraps it, the log call goes nowhere. Safe.

## Verification

```bash
bun run typecheck:all                                    # 8/8 packages
bun run --filter '@nulo/extension' test                  # existing + 1 new + 1 updated test
bun run --filter '@nulo/extension' build                 # clean (gate runs)
```

Manual smoke (~3 min):
1. Load fresh `dist/chrome/` → open DevTools → Console
2. Trigger any wallet operation that uses offscreen (e.g. unlock + send a tx)
3. Expect `[offscreen-telemetry]` Debug entries on success path (only visible if logger at Debug level)
4. Force-close offscreen mid-tx (`chrome://extensions` → reload during in-flight tx) → expect `[offscreen-telemetry]` **Info** entry with `status: "send_failed"` (visible at default Info level)

## Risks tracked

1. **Existing tests using a real logger** — if any existing test passes a logger with a side-effect-producing `log()` method and DOESN'T pass an explicit sink, that test would now emit telemetry events when it doesn't expect to. Mitigation: grep for `extends ServiceClient` consumers, verify pattern. Tests use `silentLogger` per convention.
2. **Log noise in production** — `success`/`rejected` at Debug means production users with default logger won't see them. Anomaly statuses (`timeout`/`disconnected`/`send_failed`) at Info means they DO show — appropriate, but consider Warn instead if these become noisy.
3. **No metrics push** — this is observability via console only. A future PR can add a pluggable sink for actual metrics endpoints; the `TelemetrySink` interface already supports that.

## Bump + ship

- Version: 0.13.7 → 0.13.8
- Squash to a single commit on `m4/4-followup-telemetry-default`
- Merge ff to master after manual smoke
- Push origin/master with the M4 arc + this follow-up

## Why not alternative approaches

- **Plumb `telemetry` param through `PxeServiceClient` ctor + 6 call sites**: ~10 file diff, more visible. Rejected because the default-change approach is simpler + automatically picks up future offscreen ServiceClient subclasses.
- **Keep NoopTelemetrySink + add a config-toggle**: over-engineered for a 1-line default change. The optional ctor param is already the toggle for tests; production has no reason to opt out.
- **Make `LoggingTelemetrySink` always log at Info**: too chatty — `success`/`rejected` happens dozens of times per session. Splitting by anomaly preserves Info as a meaningful signal.
