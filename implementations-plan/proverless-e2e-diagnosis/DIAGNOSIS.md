# Proverless network-e2e — DIAGNOSIS

**Date:** 2026-06-16 · **Branch:** `test/proverless-e2e-diagnosis` · **Method:** instrumented CI soaks (`retry=0`) + deep-dump capture + codex synthesis. Evidence: `lessons/phase-0..3.md` + raw dumps (cited by run/job ID).

## Headline: one root cause, three faces

All three remaining failures are **the same root cause**: a dApp-transaction's **execution-start path is starved by the offscreen PXE block-synchronizer backpressuring the single service-worker event loop**, so the operation never advances within the test budget. It is **proverless-EXPOSED, not proverless-caused** — real proving time used to absorb this PXE-sync window; collapsing it to fake-proof speed made the stall visible.

**The discredited "resource starvation on the 4-core runner" theory is positively REFUTED with measured data**: at every captured stall the runner had idle cores (top process 2–5%, or a single MainThread at 66% = one core doing PXE work, 3 idle) and the SW + offscreen targets were alive. This is **single-context event-loop starvation**, not machine resource exhaustion, and not a CDP/browser bug.

### The pre-execution path (where it stalls)
```
dApp tx → [preflight: getActiveProfile + refreshSession]  (dapp-interaction/service.ts:128)
        → executeOperations → create dapp_execute record at `queued`
        → acquireSlot [resolveExecutionMutexKey → executionMutex.acquire]  (execution-lane.ts:217-248)
        → claim queued→pending  (claim-helper.ts:123) → simulate → prove → submit
```
Under PXE-sync backpressure the op stalls at **whichever point it has reached** when the offscreen floods the SW with block-sync logger RPCs. `getActiveProfile`/`getNetwork` are SW-local (no direct PXE dep — codex-confirmed), so the blocking is INDIRECT (event-loop/message backpressure), not a PXE call inside execution-start.

## Per-failure

### F3 — `multi-account-from` queued-stall (shard 5)
- **Evidence (soak 27649347398):** record stuck `{"stage":"queued","createdAt===updatedAt","attempts":0}`; SW trail 50/50 offscreen `pxe:block_synchronizer`. Reproduces in **isolation** ~33% on CI, never on the fast Mac.
- **Root cause:** the send op's execution-start stalls at/after record-creation (stuck at `queued`, never claimed). `createdAt===updatedAt` ⇒ never reached the `beginExecutionWait` heartbeat.
- **Classification:** race (intermittent, depends on PXE backlog at fire time) · proverless-exposed.
- **Confidence:** HIGH.

### F1 — `authwit-lifecycle` CDP freeze (shard 1)
- **Evidence (soak 27650620845):** grant op `succeeded`; **consume sendTx op stuck at `queued`** (`attempts:0, terminalAt:null`) — identical to F3. Froze in **isolation** (∴ not cross-test contamination). Targets alive, resources idle.
- **Root cause:** the consume sendTx stalls at `queued` (same as F3). The 300s `Runtime.callFunctionOn` CDP freeze is a **secondary symptom** — the playground page polling (`waitForPgResult`) for a result that will never arrive while the SW is backpressured — NOT an independent renderer crash or starvation.
- **Classification:** same race as F3 + a secondary CDP-freeze manifestation · proverless-exposed.
- **Confidence:** HIGH (op-state confirmed `queued`).

### F2 — `authwit-consume-smoke` settle-timeout (shard 3)
- **Evidence:** two captured variants — (a) old-instrument iter: stalled at the **consume** sendTx result-wait (got past grant+mine); (b) soak 27650622333: stalled at the **grant** (`waitForPgResult(grantPublicAuthwit)`) with an **empty `dapp_execute` array** ⇒ stalled in the **preflight before record creation**; offscreen PXE-sync trail (block 117932); no CDP freeze; resources non-saturated.
- **Root cause:** same execution-start starvation; the failing op (grant or consume) is whichever fires while the PXE is busiest. The empty-record variant directly evidences a **preflight stall** (codex's predicted alternate site).
- **Classification:** race · proverless-exposed.
- **Confidence:** HIGH on the class; the exact per-run stall point (grant vs consume) varies by timing.

## What is NOT proven (honest residual)
The **exact await** that blocks (preflight `refreshSession` vs `resolveExecutionMutexKey` vs the storage reads in between) is not pinned to a single line — the evidence bounds it to the pre-`executionMutex.acquire` path. Pinning it precisely needs timing logs in the SW execution path (a fix-phase activity, NOT diagnosis). It does not change the root cause or the fix direction.

## Recommended fix direction (for the successor fix blueprint — NOT done here)
Treat as a **PXE readiness / warmup** problem, not an execution-lane change:
1. **Gate the first dApp action on PXE block-sync settle** (the test's `_probe-warmup-effect` exists but evidently doesn't guarantee sync-caught-up before the act).
2. **Reduce offscreen→SW logger-RPC chatter during block-sync** (the backpressure source) — e.g. batch/throttle `block_synchronizer` logs.
3. Investigate **why the local e2e PXE has a large block backlog** (block ~117911) at test time — a sandbox/warmup config lever.
4. (F1 secondary) a watchdog so a stalled `waitForPgResult` fails fast with the journal state instead of a 300s CDP freeze.

A single fix (1 or 2) likely resolves all three, since they share the root.

## Process note
The prior arc's "resource starvation" call was an **unmeasured inference**; this diagnosis replaced it with captured runner-process + journal + SW-trail evidence. The instrument (`tests/e2e/fixtures/journal.ts` deep-dump, read via the SW worker) is the reusable artifact that made it legible.
