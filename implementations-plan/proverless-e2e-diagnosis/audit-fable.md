# Planner audit — proverless-e2e-diagnosis (Round 1)

Run via the `Plan` subagent on **opus** (the `fable` model was inaccessible this session; capability-over-name per blueprint).

**Verdict: conditional approve** — conditions: (1) fix the shard-composition confound before Phase 1/3 (replay exact failing-shard file lists via `mode=files`, never `mode=shard`); (2) add a no-instrumentation control arm so F3's intermittency can't be falsely "fixed" by the observer effect; (3) use `docker-ci-like.sh` as the Linux-on-Mac repro bridge; (4) correct the misattribution — the prior *plan.md* flagged starvation UNPROVEN; only `run-summary.md`/`phase-3.md` overclaimed.

## High
- **H1 — shard-composition confound (load-bearing).** The failing PR run shards over the include glob **minus 4 excluded heavy files** (`pr-network-e2e.yml:139`: fee-methods, concurrent-sendtx-confirm, transfers, tx-sendTx-default). vitest shards by SHA-1 of file path (`pr-network-e2e.yml:109`). The soak `mode=shard` forwards only `shard`+`test_files`, never an exclude (`network-e2e-soak.yml:86-88`), so it shards the FULL glob; local `--shard=k/5` likewise. ⇒ "shard 1"/"shard 5" mean a **different file set with a different predecessor** in (a) the failing PR run, (b) the Phase-3 soak, (c) the Phase-1 local run. The cross-contamination axis is silently broken. **Fix:** extract the exact ordered file list from the failing shard logs in Phase 0; replay with `mode=files`. Use `--shard` only to confirm bucketing.
- **H2 — observer effect on F3 under-mitigated.** F3 is intermittent; its failure is a missed `queued→pending` baton release (`background.ts:300` `onExecutionEnqueued: releaseFifo`). Phase 2 wires a hang-hook into the exact waiter F3 hangs in. A green Phase-3 soak is then ambiguous (real fix vs timing shift). **Fix:** Phase 3 must run a **no-instrumentation control arm** at the same rep count; F3's failure rate must be statistically indistinguishable between arms before any dump is trusted. Resource `top` shell-out must be off the CDP thread.
- **H3 — F1 contamination vs shared-slow-path not discriminated.** Both tests route clicks/inputs through `page.evaluate`/`waitForFunction` due to a known CDP regression (`extension.ts:1148-1152`: "Runtime.callFunctionOn timed out", Puppeteer 24.4x/Chrome 128+); `popups.ts:55-97` is saturated with detach/re-wait recovery. Identical signature is equally consistent with a shared fragile path. **Discriminator must be explicit:** contamination ⇒ register-token freezes ONLY when sequenced after a heavy predecessor AND passes in isolation AND correlates with a left-behind artifact (zombie offscreen doc / orphaned popup target); shared-path ⇒ freezes in isolation too under CDP pressure.

## Medium
- **M1 — "discard starvation" re-introduces the sin, inverted**; a single `top` one-shot is weak (freeze + high load co-occur). **Factual:** the prior plan.md marked starvation UNPROVEN (`…/plan.md:99,187,189`); only `run-summary.md:30-39` + `phase-3.md:16` overclaimed. Phase-5 correction scope is wrong as written.
- **M2 — breadth-first is the wrong default (D1).** Flip to depth-first on F3: it is the only intermittent failure (only place the observer effect is measurable), its mechanism is narrowest/most code-grounded (`background.ts:300-310`, reaper 10-min queued grace vs 90s test budget), and cross-comparison is NOT lost (dumps are committed artifacts).
- **M3 — Phase 2 gate is happy-path only.** "Trigger a dump" doesn't prove capture survives a **frozen CDP channel** (`journal.ts:74-78` already anticipates this). Add a fault-injection case (wedged target) asserting the dump degrades gracefully with a bounded budget.
- **M4 — `protocolTimeout: 300_000` interacts badly with the hang-hook** (`extension.ts:52`). A CDP call against a frozen target blocks up to 300s before rejecting → can convert a clean "timeout with dump" into a runner-timeout "job killed, no artifact." Instrument CDP probes need an explicit SHORT timeout.
- **M5 — F2 has no hypothesis or discriminator.** It waits on a real on-chain mine (`waitForTxMined`) between grant and consume. "Never settles" could be (a) the dApp promise genuinely never resolving (real bug) or (b) the mine legitimately exceeding budget (perf). Most at risk of a confident-but-wrong "just slow CI" conclusion.

## Low
- **L1 — plan skips `docker-ci-like.sh`** (Ubuntu 24.04, `--cpus=4 --memory=12g --shm-size=2g`, takes a shard expr + file arg). The Linux-on-Mac bridge; far cheaper than CI round-trips; removes the macOS/Linux confound.
- **L2 — cheaper localization primitives skipped:** shard-file **bisection** (log2 N runs to find the contaminating file), `DEBUG=puppeteer:protocol` logging, CDP `Performance.getMetrics`/heap snapshot, chrome-devtools MCP `take_heapsnapshot`/`performance_start_trace`.
- **L3 — redaction is an allowlist problem.** `chrome.storage.local.get(null)` pulls every key incl. `nulo:core:*` account rows + session mirrors. A salt denylist is insufficient; allowlist diagnostic/journal keys. (Salt is empty on localhost anyway.)
- **L4 — retry on/off axis partly redundant** with the soak's `retry=0` default + the known F3=race.

## What looks fine
- The five methodology principles (observe-before-theorize, cite-an-artifact, hold-don't-force a common root, instrument-don't-guess).
- Extending `dumpJournal` vs a separate tracer (reuses `awaitOrDump`'s frozen-CDP-vs-journal-visible split — exactly the F1-vs-F3 distinction).
- F3 hypothesis is genuinely well-grounded in source (baton/`releaseFifo`; reaper grace-vs-budget arithmetic).
- Security posture mostly right (`contents/pull-requests: read`, no new secrets, salt empty on localhost, repeats clamp).
