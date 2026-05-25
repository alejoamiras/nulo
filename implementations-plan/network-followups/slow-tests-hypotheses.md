# Slow-test investigation — hypotheses (deferred from this PR)

## Status

**Deferred.** The 2h time-box (per consolidated plan §6.4) elapsed without confident root cause. Probes were wired but the diagnostic test (`_diag-slow-tx.test.ts`) didn't produce usable probe traces in the time available — vitest's default reporter suppresses test-body `console.log`, and the test wraps each DIAG step in `try/catch` (so partial failures pass silently). Dump produced 0 records.

The two slow tests remain known load-induced flakes that sharding (Phase A) likely mitigates by reducing cumulative load per shard. Re-evaluate after sharding lands on CI.

## What we tried

- Re-introduced storage-based `probe()` helper at `packages/extension/src/wallet/utils/probe.ts` (per PR #46's `lessons/probe-infrastructure.md`)
- Wired probe boundaries:
  - `EC-SIM-START` / `EC-SIM-END` at `execution-coordinator.ts:51-67` (simulateTxTask)
  - `EC-PROVE-START` / `EC-PROVE-END` at `execution-coordinator.ts:69-86` (proveTxTask)
  - `EC-SEND-START` / `EC-SEND-END` at `execution-coordinator.ts:88-99` (sendTxTask)
  - `EXEC-AZTEC-SENDTX-RECEIPT-START` / `EXEC-AZTEC-SENDTX-RECEIPT-END` at `service.ts:1949` (standard path) + `service.ts:2109` (no-from path)
- Created `_diag-slow-tx.test.ts` to drive both slow flows with `dumpProbes` on failure
- Forwarded `VITE_E2E_PROBE` from `agent.sh` build env to the wallet bundle (verified probes ARE in `dist/chrome` via bundle grep)

## Why no probe data

Probes are in the bundle. They would fire if the wallet code reached them. But the diagnostic test's DIAG steps all failed silently inside their try/catch blocks; vitest's reporter ate the `console.log` traces, so we can't see which step failed. The wallet's `executeAztecSendTx` was never invoked.

The diagnostic test design needs revision before another investigation cycle:
- Drop the try/catch wrappers around each step OR use vitest's `expect.soft()` so failures surface in the test report
- Stream `DIAG` lines via `process.stderr.write` instead of `console.log` (vitest doesn't capture stderr the same way)
- Consider running the test with `--reporter=verbose` to see step-by-step output

## Hypotheses ranked (from PR #46 prior art + opus's parallel-plan analysis)

### H-OP-1 (top per opus): bb.wasm `proveTx` cold-start cost per fresh Chrome browser

`dappConnectedExtensionPerTest` opens a fresh browser per test; the worker that loads bb.wasm is freshly created. First `proveTx` in a worker is order-of-magnitude slower than subsequent ones. Chunked multicall does ≥2 `proveTx` calls (one per chunk).

**Falsifiable**: `EC-PROVE-START` to `EC-PROVE-END` elapsed-ms for the FIRST `proveTx` in a fresh-browser run should be 30-90s; subsequent ones < 5s.

**If confirmed**: pre-warm bb.wasm via a no-op `proveTx` in the test fixture setup, OR cache bb.wasm WASM in a persistent worker.

### H-OP-2: PXE block-sync lag under CI's slower IO

`getTxReceipt` polls; if the L2 node's block production is paced by anvil (3-call multicall = 3 separate block fills under `SEQ_MIN_TX_PER_BLOCK=0`), each tx waits a full block for receipt. CI's slower disk stretches block production.

**Falsifiable**: `EXEC-AZTEC-SENDTX-RECEIPT-START` to `END` elapsed-ms on CI vs local. Wide gap = block-production paced.

**If confirmed**: switch `multi-account-from` + `tx-sendTx-multicall` to `wait: "NO_WAIT"` if the test assertions are popup-shape (codex flagged they are — `multi-account-from` asserts "popup uses first session account regardless of opts.from"; `tx-sendTx-multicall` asserts popup payload count).

### H-OP-3: Cap popup target-creation backpressure

`waitForPopup` 15s timeout fires not because the SW is slow but because puppeteer's `waitForTarget` polls every 500ms and may miss a fast-mount window under cumulative load.

**Falsifiable**: probe inside the SW's chrome.windows.create + at the puppeteer-side target appearance.

**If confirmed**: sharding (Phase A) mitigates by reducing cumulative load per shard. No code fix needed.

## Recommended next-step investigation

1. **Wait for sharding to land** (Phase A of this PR). Observe whether the 2 slow tests still fail on CI under per-shard load.
2. **If still failing**: redesign the diagnostic test to surface failures loudly. Drop try/catch wrappers; use `expect.soft()`; stream via `process.stderr.write`. Re-run with probes.
3. **First probe to check**: H-OP-2 (`EXEC-AZTEC-SENDTX-RECEIPT-*`). The `wait: "NO_WAIT"` fix is the smallest code change and codex's preferred candidate.

## Files left behind (deleted in Phase C.3)

These are the artifacts of the time-boxed investigation that were stripped before merge:

- `packages/extension/src/wallet/utils/probe.ts` (storage-based probe helper)
- Probe call-sites in `execution-coordinator.ts` (EC-SIM-*, EC-PROVE-*, EC-SEND-*)
- Probe call-sites in `service.ts` (EXEC-AZTEC-SENDTX-RECEIPT-*)
- `packages/extension/tests/e2e/fixtures/helpers.ts` `dumpProbes` function
- `packages/extension/tests/e2e/network/_diag-slow-tx.test.ts`

Resurrect via `git show 1081c1b^:packages/extension/src/wallet/utils/probe.ts` etc.

## References

- PR #46 lessons: `implementations-plan/e2e-full-network-recovery/lessons/probe-infrastructure.md`
- PR #46 lessons: `implementations-plan/e2e-full-network-recovery/lessons/hypothesis-falsification.md` ("be ready to discard 80% of the plan after probes run")
- Network triage prior art: `implementations-plan/network-test-triage/full-suite-findings.md` (rotating-flake characterization)
- Consolidated followup plan: `implementations-plan/network-followups/plan.md` §6
- Opus's parallel plan §2.3: `implementations-plan/network-followups/audit-opus.md`
- Codex's parallel plan §2.3: `implementations-plan/network-followups/audit-codex.md`
