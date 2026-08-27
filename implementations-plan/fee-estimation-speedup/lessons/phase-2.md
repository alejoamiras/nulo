# Phase 2 — Estimate cancellation

## What shipped

- **`estimate-cancel-registry.ts`** (new): admission + cancellation for estimates, with the audit-pinned contract — per-profile cap of 4 UNSETTLED underlying jobs (cancelled jobs keep their slot until settle; non-preemptible), overflow = abort-oldest + park-newcomer in a latest-wins pending slot per (profile, flowKey) admitted on settle, duplicate-token rejection, foreign/unknown silent no-op, TTL reap for dead runners, settled-token→estimateId map so post-completion cancels still evict the stash, and settle-evicts-when-aborted (closes the stash→settle race window completely).
- **`cancelEstimate` RPC** end-to-end: spec + client passthrough + service `rpcMethods` (almost missed the `defineRpcMethods` list — the spec/client exhaustiveness guards do NOT cover the service-side list; worth remembering for any new RPC).
- **Signal threading**: `withEstimateAdmission` envelope in `ExecutionService` (admit → run → settle-with-estimateId; sentinel → `JobCancelledError` at the boundary); stage-boundary `checkCancelled` in `TransferExecutor.estimateFee` (pre-planner, pre-sim, **pre-stash** — a cancelled estimate never caches a signed request) and `DappSendExecutor.estimateOperationFee` (pre-discovery, pre-strategy); `FeeStrategyContext.signal` consumed by `FpcStrategy` between passes (skips Pass 2's full ACVM run on cancel).
- **Composables**: token minting per attempt, `cancelRemote` fired only for tokens whose RPC actually started (a never-fired debounce needs no remote cancel) and never for handed-off tokens; **`handoff()` / `handoffAll()`** — the H1 race fix: submit/approve transfers ownership so unmount cleanup can't evict the entry the fire-and-forget confirm is about to consume. Wired in `send.vue` (`handoffFeeEstimate()` before reading `estimateId`) and `execute/index.vue` (`handoffFeeEstimates()` before `approveInteraction`).
- **Reuse TTL 5 min → 120 s** (owner decision #16) + `TransferEstimateReuse.evict()`.

## Gotchas

- Three pre-existing composable tests pinned exact estimator call args (`toHaveBeenCalledWith(3)`) — updated to expect the new token/flowKey params rather than loosening to `toHaveBeenCalled`.
- The estimator callback signature change (`(params)` → `(params, token[, flowKey])`) is arity-compatible for JS callers, but arg-pinned mocks notice. No production call sites besides the two wired pages.

## Gate result: PASS

- Targeted: `estimate-cancel-registry.test.ts` 18/18 (incl. the cap invariant: unsettled ≤ N under non-preemptible cancellation, coalescing, admit-on-settle), `transfer-executor.test.ts` cancel trio (pre-abort short-circuit, no-stash-on-cancel, signal forwarding), composable suites incl. both HANDOFF RACE PINs.
- `bun run lint` exit 0 (33 pre-existing warnings) · `bun run typecheck:all` 13/13 exit 0 · `bun run test` 302+1 files, 3780 passed / 2 skipped.
