# M4.4 — audit-diff (post-dual-audit)

Date: 2026-04-26

## ⚠ Plan needs material reshape before execution

Both audits flagged that the M4.4 plan as written commits to "durable + reapable" without actual durability. The pre-execution revision MUST resolve this before code lands.

## Codex BLOCKERS

1. **Durability mismatch (codex BLOCKING)**: `pendingMeta` is in-memory only (plan.md:87). Plan also says "restart reconstructs nothing" (line 94). That makes the boot-time orphan reap (line 96), test #7 (line 136), and adversarial QA (line 162) impossible as written. Architecture target was "durable request ids" (`architecture/plan/03-final-plan-v3.md:225`). **Fix**: either persist pending request metadata in storage and rehydrate/reap at boot, OR explicitly descope restart recoverability and rename M4.4 to "observability-only."
2. **5-min reap unreachable behind 90s timeout (codex BLOCKING)**: every pending request dies at 90s (plan.md:33) before the 5-min reap window (plan.md:118) ever fires. After restart, maps are empty. The orphan path is dead. **Fix**: drop `orphaned`/alarm scope OR persist metadata and fence on boot.
3. **Missing `chrome.runtime.sendMessage` immediate-failure window (codex BLOCKING)**: closest match to the original incident. `client.ts:153` calls `await chrome.runtime.sendMessage(request)` AFTER the pending state is set; if the await rejects (offscreen not ready), no cleanup runs. **Fix**: add `send_failed` terminal status. Wrap `sendMessage` in try/catch. Clear request/timer/meta synchronously on send failure. Add contract test mocking sendMessage rejection.
4. **Idempotency catalog absent (codex BLOCKING)**: plan claims "popup will retry naturally" + "retry after recreate" but never builds the architecture-required idempotency catalog (`architecture/plan/02-final-plan.md:242`). PXE client mixes reads with mutators (`registerAccount`, `registerContractClass`). **Fix**: classify each PXE RPC as safe-to-retry / unsafe-to-retry / requires-compensation. Scope recoverability claims to safe subset.

## Plan agent BLOCKER

- **SW restart fixture**: plan defers to execution time. Specify NOW: expose `protected seedPendingForTest()` (NODE_ENV gate) OR factor `reapStalePending()` to accept the map externally.

## Codex SHOULD-FIX

- Use existing `ILogger`/`LogLevel` (not duck-typed logger). The `LogLevel.Info` numeric value is **2 = Warn** in `wallet-core/logger/interfaces.ts:14`, NOT Info — plan example was wrong.
- Test harness: offscreen tests should mirror background invariants but use `sendMessage` harness (per `vitest.setup.ts:33`), NOT the port harness (`background/client.test.ts:21`).

## Plan agent SHOULD-FIX

- Use `ILogger` directly (already imported at `client.ts:1`).
- Export `REAP_THRESHOLD_MS` as module-level const.
- Missing test: spurious response (no in-flight) — already silently dropped at `client.ts:73-76`; pin behavior.
- Missing test: reap idempotency.

## Recommended execution-time absorption

1. **Reshape decision** (user/implementer must pick):
   - **Option A**: Descope to "observability-only." Drop `orphaned`/alarm/reap; keep telemetry surface (success/rejected/timeout/disconnected/send_failed). Rename plan section header to "Offscreen telemetry + send-failure cleanup." This is the pragmatic path.
   - **Option B**: Persist pending request metadata in `chrome.storage.session.nulo:offscreen:pending` (M4.7-c migration registry entry needed). Rehydrate on boot. Boot-time reap entries that crossed SW lifecycle. Higher cost, full durability.
2. **Add `send_failed` terminal**, regardless of A/B decision.
3. **Idempotency catalog**: add a method-level annotation (or a static table) for every `PxeServiceClient` RPC: `@idempotent` / `@unsafe` / `@compensating`. Tests assert classification before any retry path uses the method.
4. **SW-restart fixture**: ship `protected seedPendingForTest(reqId, meta)` gated by `process.env.NODE_ENV === "test"`.

## Status

- Plan v0 SHIPPED (commit-pending on `planning/m4` branch). Audits absorbed in this audit-diff.
- Plan v1 (post-execution-time-revision) — implementer must revise per the BLOCKERs above before opening the M4.4 PR. Reasonable to escalate the descope (Option A) to user for product call.
