# M4.4 — Plan agent audit

Date: 2026-04-26

**BLOCKING**
- SW restart fixture — plan defers to execution time. Must specify NOW: expose `protected seedPendingForTest()` (NODE_ENV gate) OR factor `reapStalePending()` to accept the map externally. Without this, test #7 is hand-wavy.

**SHOULD-FIX**
- Use `ILogger` from `@nulo/wallet-core/logger` directly (not parallel structurally-typed `{ log: ... }` contract). Existing `client.ts:1` already imports `ILogger`.
- Export `REAP_THRESHOLD_MS` as module-level const for override (Chrome 116+ raised SW idle limit).
- Missing test: spurious response (no in-flight). Background covers this at `background/client.test.ts:100`. Offscreen client at `client.ts:73-76` already drops silently — needs explicit test.
- Missing test: reap idempotency (connect + alarm fire in same tick — telemetry once).

**NIT**
- Alarm naming OK; suggest registry constant when M4.5 lands.
- 90s timeout right call for M4.4 scope. Background already supports per-instance `requestTimeoutMs` — parity follow-up.
