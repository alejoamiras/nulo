# Phase 3 — F1 (CDP freeze) hypotheses [IN PROGRESS — awaiting soak deep dumps]

## Exact hang point (from Phase 0)
`authwit-lifecycle.test.ts:101` → `grant()` `:81` → `waitForPgResult` (`playground.ts`) → `page.waitForFunction` → **`Runtime.callFunctionOn` timed out at the full 300s `protocolTimeout`** (extension.ts:52). A single CDP call unanswered for 300 continuous seconds = the **playground PAGE renderer is hard-wedged for 5 minutes**, not transient slowness. The freeze hit the FIRST grant's result-wait (not deep into the 9-op test), and the failing test varies run-to-run (authwit-lifecycle + cancel-mid-prove in #94; register-token + authwit-lifecycle earlier) → not single-test-logic.

## Candidate mechanisms (to discriminate with the deep dump)
1. **Renderer crash / context destroyed** — the page's JS execution context died (OOM, crash, or a context-replacement) so `Runtime.callFunctionOn` never resolves. → deep-dump TARGET INVENTORY would show the page target missing/changed, or a crashed target.
2. **SW/offscreen wedged → blocks the page** — the service worker (running the proverless sim + dApp response plumbing) hangs and the page waits on it. → target inventory shows SW/offscreen state; sw-log trail (if flushed) stops.
3. **Resource starvation of the renderer** — CPU/mem pressure starves the page's main thread. → RESOURCE SNAPSHOT at the freeze shows saturation (THIS is the data that kills-or-confirms the discredited starvation theory — measured, not assumed).
4. **CDP/Puppeteer regression** — a variant of the documented `Runtime.callFunctionOn` hang (`extension.ts:1148`, Puppeteer 24.4x/Chrome 128+), now on the `waitForFunction` path. → resources NORMAL + page target present + SW alive ⇒ points here (a browser-bug, fix = puppeteer/chrome bump or a poll-path workaround).

## The H3 discriminator (contamination vs shared path) — via the two F1 soaks
- **F1 isolation** (`authwit-lifecycle` alone, run 27649704923): if it freezes ALONE → NOT cross-test contamination; it's a shared fragile path / renderer / resource issue intrinsic to the test.
- **F1 in-sequence** (shard-1 list, run 27649706248): if it freezes here but NOT in isolation → contamination from a heavy predecessor (e.g. `incoming-transfers`/`cancel-mid-prove` before `authwit-lifecycle`).

## Deep-dump capture path (now wired)
F1 fails in `waitForPgResult` (playground.ts), which now calls `dumpDeepDiagnostics` on timeout (commit 5373512). On the freeze, the in-page reads bound out at 10s each (frozen CDP) but the **out-of-band target inventory + off-thread resource snapshot DO capture** — exactly the signals that separate mechanisms 1-4. The `[journal-diag] ... journal read FAILED (likely frozen CDP)` line also confirms the wedge.

## Evidence captured (F1 isolation soak 27649704923)
- **Reproduces in ISOLATION** (authwit-lifecycle alone freezes, 1/1 early) → **NOT cross-test contamination** (H3 RESOLVED: a shared fragile path, not a poisoning predecessor).
- Froze at the **G1 consume sendTx** result-wait (`waitForPgResult(sendTx)` + `Runtime.callFunctionOn timed out` ×2) — the SAME sendTx execution path as F2's consume and F3's send.
- **Targets at the freeze: SW + offscreen + pages ALIVE** (`service_worker` + `background_page .../offscreen/index.html` present). **Resources: idle** (top proc ~2.6% provjobd, nothing pegged). ⇒ mechanism 2 (dead SW) and mechanism 3 (resource starvation) **REFUTED with data**. The wedge is the PLAYGROUND page's renderer/CDP while the consume sendTx is stalled.

## Unification (F1 ≡ F2 ≡ F3)
All three fail on a **sendTx whose execution-start is stalled** (F3 proved: stuck at `queued`, starved by offscreen PXE block-sync backpressure — `lessons/phase-2.md`). F1 + F2 both fail at the **consume sendTx** result-wait — and the consume runs AFTER the grant mines, so the PXE is even busier (more backlog). F1 additionally shows a 300s CDP freeze: a SECONDARY symptom of the playground page polling for a result that will never arrive (the doomed/stalled consume) while the SW is backpressured — not a separate root cause. The instrument's out-of-band capture (SW alive + resources idle) is what lets us say the freeze is downstream of the stall, not an independent renderer crash or starvation.

## Pending
Confirm F1's (and F2's) consume op-state is `queued` (same as F3) via the SW-worker-read instrument (this firing's fix) on a re-dispatched soak — the in-page reads failed before (playground page has no `chrome.storage`). That closes the unification. Fix direction inherits F3's: PXE readiness/warmup.
