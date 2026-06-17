# Planner audit — proverless-e2e-fix (Round 1)

Run via the `Plan` subagent on **opus** (fable model inaccessible this session).

**Verdict: reject (blocking).** The planned PXE-anchor readiness gate rests on three false premises.

## Blocking (High)
- **B1/H1 — the readiness signal is NOT test-readable.** `getSyncedBlockHeader` is an offscreen-hosted `PxeService` method reachable only via the offscreen messaging transport; no SW/offscreen global exposes a PXE handle, and `swEvaluate` runs in the SW global where only `chrome.storage` exists — nothing to call. The `[SYNC-DEBUG]` lines are `logDebug` (filtered out of `nulo:logs` at default Info) AND only emit mid-`simulateTx`/`proveTx` (useless as a *pre*-action gate). `node.getBlockNumber()` (tip) is reachable node-side, but the **PXE anchor** (the half that matters) is not. → "readable signal exists" is an unverified inference mis-bucketed as Fact.
- **B2/H2 — gate placement can't cover the stall.** F1/F2 stall at the **consume**, which runs after `waitForTxMined` advances the chain (re-opening the backpressure window *after* the fixture returned). A fixture-once warmup can't gate it; `authwit-lifecycle` has 6+ post-fixture chain-advancing actions. Worse: a fixture-placed gate makes the 20× soak **green for the wrong reason** (never exercised at the failing point) → false-accept promoted to required.
- **B3/H3 — the probe measures the wrong thing AND self-contends.** `getSyncedBlockHeader` → `withPxeRead` → `chainGuard.read()`, which **queues behind** the simulate/prove `write()` (rw-guard) — so a poll either reports a committed anchor while the offscreen synchronizer is *still* flooding the SW with logger-RPCs (FALSE-READY — anchor convergence is **decoupled** from the actual backpressure), or blocks up to `MAX_READER_DRAIN_MS=5min` (the gate hangs like the test). **Anchor-vs-tip is not correlated with the backpressure clearing** — the diagnosis's real mechanism is SW-event-loop starvation from the logger-RPC flood, not anchor position.

## Medium
- **M4 — "test-only" likely unsatisfiable for the signal.** The only clean way to expose a real readiness signal is a production change (offscreen/SW exposure, a new PXE method, or promoting the sync logs) — contradicting the hard test-only constraint. Scope and mechanism are mutually exclusive as written.
- **M5 — rejecting budget/retry is directionally right, but "readiness gate is deterministic" is false (H1-H3).** The competing option the plan never considered: **the fast-fail watchdog as the PRIMARY deliverable + a modest budget**, deferring the unbuildable sync-gate. Rejecting B for the wrong reason risks an A that's worse than B.
- **M1 — the fixture isn't quiescent** (`createSecondAccount` + cap-popup `loadInteractionPayload` trigger sync).
- **M2 — soak `mode=files` co-locates the trio** (one runner), but they fail SHARDED (F1=shard1/F2=shard3/F3=shard5) → co-location changes the backpressure profile; the soak may not reproduce the flake. Need per-file isolation.
- **M3 — pass-when-skipped + positive allowlist is a real dodge.** A PR editing `packages/wallet-core/src/utils/rw-guard.ts` (governs every PXE op) matches NO `extension-network` filter entry → green required check, zero network tests. Needs run-by-default + doc-only negative skips (codex agreed).
- **H4 — watchdog gaps:** a 45s threshold false-fails the real-proving **canary** (`proveTx` up to 30min, in the required `Status` aggregate); a `queued`-only watchdog misses "got to simulating then starved." Must scope to proverless + the right stage.

## Assumptions attack
- The F2 grant variant stalls in **preflight** (`getActiveProfile`+`refreshSession`, dapp-interaction `service.ts:128`) — **no PXE call** — so even a perfect PXE-sync gate doesn't obviously remove that starvation. The soak "arbiter" is compromised by H2/H3.

## What looks fine
- Diagnosis grounding solid (the offscreen→SW logger-RPC path is literal: `offscreen/index.ts:22-28`).
- The instrument is reusable for the **watchdog dump** (not the gate signal) — bounded reads, exactly what a fast-fail needs.
- Rejecting retry-as-fix is correct; phase sequencing/hygiene + CI-plumbing reads are accurate.
