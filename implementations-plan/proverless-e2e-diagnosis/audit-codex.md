# Codex audit — proverless-e2e-diagnosis (Round 1)

Session `019ed228-345d-74c1-905f-04818d039bc2`, xhigh, read-only.

**Verdict: conditional approve** — conditions: use `retry=0` in all diagnostic runs; replay explicit file lists instead of trusting `--shard`; add out-of-band/browser-external probes for F1; require request-correlated evidence for F2/F3.

## High
- **F1 contamination hypothesis too strong for the isolation model.** Config is `pool: forks` + `isolate: true` (`vitest.e2e.network.config.ts:39-40`) and fixtures launch a fresh browser per test, closed after (`extension.ts:420,~465`). "Prior test leaves a wedged page/worker" is a weak default. Same CDP signature across `register-token` + `authwit-lifecycle` fits a **shared setup / common popup path** (both traverse launchExtension → registerProfile → openPopup → waitForHashGeneral).
- **Phase 1 local commands omit `NULO_E2E_RETRY=0`** — local default `retry: 2` (`vitest.e2e.network.config.ts:52`). A "pass" may be a retry-pass.
- **F2 symptom overinterpreted.** `waitForPgResult` only watches a DOM result row (`playground.ts:67`); it does NOT prove the dApp promise never settled. Need a second signal (playground RPC/result writer or console).
- **F1 cannot be diagnosed from inside the same wedged CDP client.** Once `Runtime.callFunctionOn` times out, target-inventory/offscreen-health collected through the same channel fails the same way. Add out-of-band probes: Chrome stderr/process liveness, periodic `browser.targets()` buffered *before* the hang, runner-side process snapshots.

## Medium
- One timeout snapshot doesn't settle starvation — measure over time; include Chrome + Bun + Aztec processes, not just the worker.
- F3 needs request correlation — bind evidence to the current request/session/op id, not "any `dapp_execute`."
- Phase 1-2 should be hybrid: prove instrumentation on F3 first (visible in journal-truth; F1 is the worst place to design probes since the transport is suspect).
- Guard observer effect: minimal always-on probes, heavy capture only on timeout, probe-off vs probe-on soak comparison before accepting any "instrumented pass."

## Facts / Inferences / Asks
- Facts overstated: "serial within a shard" incomplete without per-file/process isolation; "F2 dApp promise never settles" not a fact.
- Inferences unsafe: F1 cross-contamination; F3 worker-failed-to-claim; "not starvation" from a single snapshot.
- Asks missing: acceptable confidence threshold when local never repros; approval for runner-level telemetry/artifacts; explicit-file replay vs trusting `--shard` parity across macOS/Linux.

## What looks fine
- Soak backbone (fresh runners, sequential, `retry=0` default).
- Not forcing a single common root.
- Reusing `dumpJournal` as the low-overhead timeout hook — provided heavy probes are gated and correlation is added.
