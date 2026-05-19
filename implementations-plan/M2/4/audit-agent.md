# M2.4 plan — general-purpose agent audit

Run date: 2026-04-22. Plan file: `plan.md`. Reviewer: general-purpose agent (parallel to codex xhigh).

## Verdict: **Go with 4 fixes**

## Must-fix before M2.4-a / b / c start

1. **`BackgroundTickerPort` JSDoc rewrite** (blocker, doc-only). Plan's JSDoc promises chrome.alarms swap-in. BUT `chrome.alarms` has a 30-second floor; balance cadence is 1 second → swap incompatible at today's cadence. Either:
   - **(a) Drop the new port** — reuse `ClockPort.setInterval` with a small `subscribePeriodic(clock, ms, fn)` helper. Simpler. OR
   - **(b) Keep the port** but rewrite JSDoc to state plainly: "ticks pause during SW suspension; caller semantics are best-effort periodic. Future swap to chrome.alarms is gated on cadence ≥ 30s." Drop the misleading future-swap claim.
   Pick one; today's plan says (b) but without the honest JSDoc.

2. **WindowManager: injectable class, not Service<Methods>**. Only SW-side callers (PasskeyService + DappInteractionService). No popup-side or content-script client. Full Service + client.ts + spec.ts is unjustified ceremony. Demote to a plain injectable collaborator (ctor arg pattern, same as `BalanceRepository` / `SessionManager`). Remove `settle` / `cancel` from `Methods` — keep them as plain class methods. Only return to Service shape if a cross-process caller (e.g., debug panel listing open approvals) is named.

3. **`pxe/service.ts:398` inline `createAztecNodeClient`** — NodeFactory scope in M2.4-b currently targets only NetworkService. Either extend b's scope to cover PxeService's call site or explicitly document in the PR description that b is scoped to NetworkService and PXE's inline creation is deferred. Otherwise a future reviewer sees "NodeFactory means no inline creation" and files a bug.

4. **wallet-sdk 3rd window call site** (`background.ts:135`). Plan defers — defensible for fire-and-forget notification popup semantically distinct from blocking approvals. But without an enforcement mechanism (lint rule or follow-up), the "all windows route through WindowManager" invariant erodes silently. Add either:
   - A lint-level guard (eslint `no-restricted-syntax` on `chrome.windows.create`) when M2.4-c lands, OR
   - A one-line `WindowManager.openDetached(url, opts)` method for fire-and-forget calls, absorbing this site too.

## Per-question findings (plan's Q1-Q10)

| Q | Status | Notes |
|---|---|---|
| Q1 | **Concern** | Port is justified IFF JSDoc is honest (see must-fix #1). Other wallets ship periodic work on raw setInterval without abstracting. |
| Q2 | OK | `start()` must fire after trigger handlers; pin in a unit test. |
| Q3 | **OK but under-specified** | Lifecycle-only cut is right. Plan's `settle/cancel` on RPC `Methods` contradicts risk #3's "INTERNAL" claim — see must-fix #2. |
| Q4 | OK | Keep ExecutionService seam; direct-PXE would duplicate ContractResolver + PXE registration. |
| Q5 | OK | Start minimal. `destroyNode` / `isHealthy` add when consumer appears. |
| Q6 | **Concern** | Today's code DOES support multiple concurrent windows. Plan should state the invariant explicitly so a reviewer doesn't "fix" it. |
| Q7 | OK | WindowPort (thin chrome.windows wrapper) + WindowManager (policy layer — timeout, pending-map, onRemoved correlation). Clean layering. Update window-port.ts comment to point at M2.4-c. |
| Q8 | OK | Repository / Projector / JobQueue = storage / compute / scheduling. Same pattern as M2.1. Not over-split. |
| Q9 | **Concern** | See must-fix #4. |
| Q10 | OK | Double-tick doubles PXE load briefly (syncBatch idempotent). Dropped tick delays until next enqueue trigger. Bounded. |

## Extra audit checks (reviewer-added)

**Sub-PR independence** [OK with caveat]: a/b/c don't share changed files or signatures. Caveat: `pxe/service.ts:398` has its own `createAztecNodeClient` — if NodeFactory scope is interpreted as "no more inline creation anywhere", b is incomplete. Document.

**BackgroundTickerPort vs ClockPort** [Concern]: the port adds 3 files + test double + wiring for ~zero behavioral gain today. chrome.alarms floor incompatible with 1s cadence. Pragmatic counter: just use `ClockPort.setInterval` with a helper.

**BalanceProjector direct-PXE vs ExecutionService** [OK]: ExecutionService.executeSimulateViews does ContractResolver lookup, instance/artifact hydration, PXE registration, per-call encoding. Bypassing it duplicates all of that. Keep the seam.

**WindowManager Service vs utility** [Concern] — see must-fix #2.

**SW suspension semantics of BackgroundTickerPort** [Blocker, doc-only] — see must-fix #1.

## Top-3 risks

1. **Semantic drift on BackgroundTickerPort** — port's documented guarantees don't match reality or future swap target. Future bug where caller assumes alarm-like persistence.

2. **WindowManager-as-Service bloat** — shipping full client/spec for an SW-only collaborator sets a precedent that pollutes the Service boundary. Worse, `settle/cancel` on public `Methods` surface is a footgun any SW code can call.

3. **wallet-sdk 3rd window call site drift** — without enforcement, "all windows through WindowManager" invariant erodes between M2.4-c and whenever someone revisits.
