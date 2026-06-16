# Phase 4 — F2 (`authwit-consume-smoke` settle-timeout) root cause

Full synthesis in `DIAGNOSIS.md`. F2-specific evidence:

- **Two captured variants** (the failing op varies by timing):
  - Old-instrument iter: got past grant+mine, stalled at the **consume** sendTx result-wait (`waitForPgResult(sendTx)`, 240s).
  - Soak `27650622333`: stalled at the **grant** (`waitForPgResult(grantPublicAuthwit)`, 120s) with an **empty `dapp_execute` array** ⇒ stalled in the **dapp-interaction preflight, BEFORE the record is created** (`dapp-interaction/service.ts:128` `getActiveProfile`+`refreshSession`). This is the alternate stall site codex predicted.
- **No CDP freeze** (0 `Runtime.callFunctionOn`) — distinguishes F2 from F1; F2 is a clean settle-timeout (the page keeps polling, the result just never arrives).
- **Second signal (page-DOM-independent, audit D9):** the SW-worker journal read + the offscreen PXE-sync trail (block 117932) — both confirm the stall is execution-start, not a page render miss. Resources: one MainThread at 66% = the PXE block-sync on ONE core; 3 cores idle ⇒ NOT machine saturation.
- **Root cause:** same as F1/F3 — execution-start starved by offscreen-PXE-block-sync SW backpressure. **Fix direction:** inherits the unified PXE-readiness/warmup fix (DIAGNOSIS.md).
- **Confidence:** HIGH on the class; exact per-run stall point (grant vs consume) is timing-dependent.

LESSONS_FILE=implementations-plan/proverless-e2e-diagnosis/lessons/phase-4.md
