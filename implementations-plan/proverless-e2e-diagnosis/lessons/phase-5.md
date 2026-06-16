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

## Post-impl review (instrument code)
- **Self-review (`/code-review max --fix` substance):** no correctness bug — the bounded-timeout late-rejection is handled by `Promise.race`'s internal handlers (not unhandled); success path untouched.
- **Codex post-impl audit (session in `bzx6zf5mp`): Reject (blocking) → all findings ADDRESSED:**
  - **(High) Redaction** — full-record dump leaked `accountAddress`/`txHash`/`profileId`/`sessionId`/error-body; target URLs leaked `requestId`/`sessionId` query params. → `readDappExecuteRecordsFull` now projects DIAGNOSTIC fields only (stage, createdAt/updatedAt, attempts, terminalAt, title, errorCode, truncated `sid8`); `captureTargetInventory` strips query params.
  - **(High) SW-target correctness** — `swEvaluate` picked the first SW globally. → now pins the extension worker (`chrome-extension://`).
  - **(Med) Failure budget** — was ~35s summed. → the two in-page reads now run via `Promise.all` (one ~10s window).
  - **(Med) Soak concurrency** — unique-per-run group removed auto-cancel (unbounded burn). → reverted to upstream (`cancel-in-progress: true`); diagnosis no longer needs parallel arms.
- Re-validated: `bun run typecheck` exit 0, `bun run lint` exit 0, `actionlint` clean.

LESSONS_FILE=implementations-plan/proverless-e2e-diagnosis/lessons/phase-5.md
