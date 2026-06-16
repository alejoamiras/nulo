# Phase 1 — Instrument hardening (on F3)

Extended `tests/e2e/fixtures/journal.ts` (test-harness only — **no production code change**) so a wait-timeout dumps the state needed to diagnose all three failures.

## What was added
- **`readDappExecuteRecordsFull`** — full `dapp_execute` records (claim metadata: `queuedJournalId`, stage timestamps, `error`) the lean view hides. Allowlisted to `dapp_execute` (no `get(null)` leak).
- **`readSwLogTrail`** — reads `chrome.storage.session["nulo:logs"]`, the SW's own log trail (`LoggerStore` debounce-flushes it every 2s — `wallet/logger/store.ts:80`). **This is the key move:** F3's stall state (did `acquireSlot` run? did `executionMutex.acquire` resolve? was the claim attempted?) lives in SW memory; the flushed trail surfaces it from the test side with zero production change. Filtered (allowlist regex) to execution sources.
- **`captureTargetInventory`** — out-of-band: `page.browser().targets()` (browser-level cache, synchronous). Survives a wedged PAGE renderer (F1), where every in-page `page.evaluate` hangs the full `protocolTimeout`. Shows SW-alive / offscreen-present / page-count.
- **`captureResourceSnapshot`** — off-CDP-thread `ps` one-shot (top procs by CPU). Settles the starvation question with DATA, not assumption. Works regardless of browser state.
- **`dumpDeepDiagnostics`** — orchestrates the above; every part independently guarded + bounded.

## Hardening guarantees (audit conditions)
- **M4 bounded:** each in-page read is wrapped in `withTimeout` (10s) → a frozen CDP cannot extend the dump past ~20s total. Out-of-band probes don't go through the wedged channel.
- **Observer-safe (H2/D5):** the deep dump runs ONLY on the failure path (`awaitOrDump`'s catch); the success path is byte-for-byte unchanged. So an "instrumented pass" can't be a timing artifact of the instrument.
- **Redaction (L3):** allowlisted to `dapp_execute` records + execution-source logs; no `get(null)` of all storage. (Localhost e2e has no salt/secret anyway.)

## M3 fault-injection proof (graceful degradation)
Ran `/tmp/journal-faultinjection.ts`: a fake page whose `evaluate` never resolves (simulates frozen CDP). Result:
```
[diag-deep] FAULT-INJECTION full dapp_execute: <full records timed out after 10000ms>
[diag-deep] FAULT-INJECTION sw-log trail:      <sw-log trail timed out after 10000ms>
[diag-deep] FAULT-INJECTION targets:           ["service_worker chrome-extension://abc/sw.js"]
[diag-deep] FAULT-INJECTION resources:         <ps table captured>
dumpDeepDiagnostics completed in 20073ms — PASS (bounded; did NOT hang)
```
The frozen in-page reads degraded to markers; the out-of-band target + resource capture still succeeded. (Test has no committed home — unit config excludes `tests/e2e/**`, e2e config boots the sandbox — so it's a one-off proof, documented here.)

## Known caveat for Phase 2
The SW log trail is **Info-level + 2s-debounced + session-storage**. `claim-helper`'s `logger.debug` calls (the claim decision tree) only appear if `debugMode` is on (off by default in the proverless build). Phase 2's first local F3 run will reveal empirically whether the Info-level trail shows the `acquireSlot`/`acquire`/`claim` steps; if not, options are (a) enable `debugMode` in the e2e build, or (b) a minimal Info log at the mutex-acquire boundary — **decide with codex** (a one-line Info log is borderline instrumentation-vs-fix; prefer enabling debugMode if it surfaces the trail).

## Status
Phase 1 gate met: `bun run typecheck` ✓, `bun run lint` (journal.ts) ✓, M3 graceful-degradation proof ✓. The "captures F3's correlated state on a real run" half is exercised in Phase 2 (instrumented F3 repro). The earlier F3 CI soaks (runs 27648745796 isolation + 27648747237 in-sequence) are the **no-instrument control arm** (dispatched on the pre-instrument commit) for the H2 comparison.
