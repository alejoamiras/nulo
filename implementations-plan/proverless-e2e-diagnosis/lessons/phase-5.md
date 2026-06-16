# Phase 5 — Breadth synthesis + handoff

Full report: `DIAGNOSIS.md`.

## The common root is CONFIRMED (not just hypothesized)
Side-by-side, all three failures' captured dumps share one mechanism: **a dApp-tx execution-start path starved by the offscreen PXE block-synchronizer backpressuring the single SW event loop**, stalling the op at whichever pre-`executionMutex.acquire` point it reached when the PXE was busy:
- **F3** send → stuck at `queued` (createdAt===updatedAt).
- **F1** consume → stuck at `queued` (grant succeeded first); + secondary 300s CDP freeze.
- **F2** grant → stalled in preflight (empty `dapp_execute`); or consume → `queued`.

Every stall dump carried the offscreen `pxe:block_synchronizer` trail; none showed machine resource saturation (idle cores) or a dead SW/offscreen. **Proverless-EXPOSED** (proving time used to mask the PXE-sync window), not proverless-caused.

## Disproven prior theory
"Resource starvation on the 4-core runner" — refuted with measured runner-process snapshots (idle cores) + the SW-trail evidence. It was an unmeasured inference; corrected in the prior plan's `run-summary.md` + `phase-3.md`.

## Handoff to the fix blueprint
One fix likely resolves all three (shared root): **PXE readiness/warmup gate** before the first dApp action + reduce offscreen→SW logger-RPC chatter during sync. Plus a fast-fail watchdog for the F1 CDP-freeze secondary. See DIAGNOSIS.md § fix direction. Exact await-point pinning (preflight vs key-resolve) is a fix-phase timing-log task.

## Reusable artifact
`tests/e2e/fixtures/journal.ts` deep-dump (full record + SW log trail + out-of-band targets + off-thread resources), read via the SW worker so it works from playground-page callers and survives a wedged renderer. Bounded + failure-path-only (observer-safe).

LESSONS_FILE=implementations-plan/proverless-e2e-diagnosis/lessons/phase-5.md
