# Proverless network-e2e — DIAGNOSIS plan

> **Status: DRAFT (blueprint mid, awaiting approval).** Diagnosis-only — **no fixes**. Successor to `proverless-network-stabilization` (which shipped Modes 1+4 in PR #94). Revised after the codex + planner dual audit (verdicts inline in `audit-codex.md` / `audit-fable.md`; both **conditional approve** — conditions folded in below and tracked in the Decision ledger).

## Mission

Replace the discredited "resource starvation on the 4-core runner" theory with **evidence-backed root causes** for the three remaining proverless network-e2e failures, plus a recommended fix direction for each — without writing the fixes. The next blueprint turns these diagnoses into fixes.

> Correction (audit M1): the prior **plan.md** already marked starvation "UNPROVEN" and prescribed `docker-ci-like.sh` + real-runner soak as the arbiter — its *methodology* was sound. The unqualified "resource starvation" claim lives only in `proverless-network-stabilization/lessons/run-summary.md` + `phase-3.md`. Those are the only docs Phase 5 corrects.

## The three failures under investigation

| ID | Shard | Test(s) | Symptom (from CI) | Leading hypothesis (held, not assumed) |
|----|-------|---------|-------------------|------------------------------------------|
| **F3** | shard 5 | `multi-account-from` (L86) | journal record stuck at `queued`; `waitForDappExecuteWorked` times out (90s budget). **Intermittent** — passed on #94. | Missed `queued→pending` baton release (`background.ts:300` `onExecutionEnqueued: releaseFifo`). The reaper's 10-min queued grace (`reaper.ts:77`) ≫ the 90s budget, so the diag reading is honest: the claim never fired. **Best-grounded; diagnosed FIRST.** |
| **F1** | shard 1 | `authwit-lifecycle`, `register-token` | CDP freeze: `ProtocolError: Runtime.callFunctionOn timed out` + `waitForHashGeneral 30000ms` | **TWO competing hypotheses, to be discriminated (not assumed):** (a) **shared CDP-fragile path** under load — a documented Puppeteer 24.4x/Chrome 128+ regression (`extension.ts:1148-1152`); (b) **cross-test contamination via shared external state** (sandbox/anvil/playground or leaked OS processes — NOT browser state; the browser is fresh per test). |
| **F2** | shard 3 | `authwit-consume-smoke` (L75, L103) | `waitForPgResult` 120/240s never resolves | **Undecided between:** (a) the dApp promise genuinely never resolves (real bug, would also fail with real proving), vs (b) the real on-chain mine (`waitForTxMined` between grant/consume) legitimately exceeds budget under load (perf/budget, proverless-irrelevant). |

## Success criterion ("done")

Per clarifying answers (done = **root cause + fix direction**; CI budget = **generous**; local runs = **freely**):

For **each** of F3/F1/F2:
1. **A reproduction signal** — a local/`docker-ci-like` recipe OR a measured CI failure rate from a soak (with a no-instrument control arm).
2. **The precise hang point** — which `await`/line/CDP call wedges, with **request/session/op-id-correlated** journal + worker/target state at the freeze.
3. **A named root-cause mechanism**, backed by cited evidence artifacts (never a bare theory).
4. **A recommended fix direction** (prose, no fix code).
5. **Two classification axes resolved**: proverless-specific vs also-real-proving; race (intermittent) vs deterministic.

Plus: the stale "resource starvation" wording in `run-summary.md` + `phase-3.md` is corrected; a follow-up **fix** blueprint is scoped.

## Methodology — principles (hardened by the audit)

These exist because the last attempt jumped to "resource starvation" with zero measurement.

1. **Observe before theorize.** No root cause is recorded without a cited artifact. Every phase emits evidence first.
2. **Replay EXACT file lists, never `--shard`** *(audit H1)*. The failing PR run shards the include glob **minus 4 excluded heavy files** (`pr-network-e2e.yml:139`) via a SHA-1-of-path sharder (`:109`); the soak (`network-e2e-soak.yml`, no `exclude_files` input) and local `--shard=k/5` shard the FULL glob → a *different* file set + predecessor. So Phase 0 extracts the exact ordered file list of each failing shard from CI logs, and all repro replays it via `mode=files` / `e2e:agent <files…>`. `--shard` is used ONLY to confirm bucketing.
3. **Differential diagnosis — vary ONE axis at a time:** local(macOS) / `docker-ci-like`(Linux) / CI(Linux); proverless / real-proving; test-in-isolation / in-exact-predecessor-sequence; headed / headless. `retry=0` is pinned everywhere (`NULO_E2E_RETRY=0`) so a pass is never a retry-pass *(audit, codex #2)*.
4. **Guard the observer effect** *(audit H2 + final-pass)*. Heavy capture fires only on timeout (existing `awaitOrDump` is already passive-on-success). Every soak runs a **no-instrumentation control arm at equal rep count**. **Executable acceptance rule:** with ≤25 reps/arm per soak dispatch (the `network-e2e-soak.yml` cap), accumulate across dispatches until each arm has **≥40 observations**; the instrument is accepted as non-perturbing only if a two-proportion test on instrumented-vs-control failure rate gives p > 0.05 **and** the instrumented arm does not fail *fewer* times than control by more than one. If the instrumented arm is materially quieter, treat the instrument as perturbing and fall back to **out-of-band-only** capture for that failure. The resource snapshot runs **off the CDP thread**.
5. **F1 needs OUT-OF-BAND probes** *(audit H3 / codex #4)*. Once `Runtime.callFunctionOn` times out, anything collected through the same CDP channel fails the same way. Use `DEBUG=puppeteer:protocol` logging, Chrome stderr/process-liveness, runner-side process snapshots, and CDP `Performance.getMetrics` buffered *before* the hang — not just the in-page dump.
6. **Bounded probe timeouts** *(audit M4)*. Instrument CDP calls get an explicit short timeout independent of `protocolTimeout` (300s), so the hang-hook can't turn a 30s failure into a job-killing multi-minute hang that loses the artifact.
7. **Do NOT force a single root cause.** Hold per-failure hypotheses AND one explicit *common-root* hypothesis (offscreen-doc / durable-job-worker lifecycle), confirmed-or-killed by side-by-side dump comparison in Phase 5 — not assumed.
8. **Cheaper localization first** *(audit L2)*: shard-file **bisection** (log₂N to find a contaminating predecessor) before high-rep soaks; protocol logging + a one-shot heap/metrics snapshot before building bespoke capture.

## Phases (depth-first: harden the instrument on F3, then the hard ones)

### Phase 0 — Evidence baseline, exact file lists, code grounding ✓ DONE (`lessons/phase-0.md`)
- Pull failing shard-1/3/5 CI logs (#94 + 27638447273). Extract: exact error + stack, the failing test, **and the exact ordered file list of each failing shard** (the H1 fix — save to `lessons/raw/`).
- Read each failing test + its real shard-mates; ground hypotheses in code: the baton/`releaseFifo` claim (`background.ts:300`), reaper grace (`reaper.ts:77`), offscreen lifecycle (`ARCHITECTURE.md`), the CDP regression (`extension.ts:1148`), `waitForPgResult`'s DOM-only signal (`playground.ts:67`).
- Write an **evidence sheet per failure** with explicit **discriminators**: F1 contamination ⇒ `register-token` freezes only after a heavy predecessor + passes in isolation + correlates with a left-behind artifact; shared-path ⇒ freezes in isolation too. F2 ⇒ promise-never-resolves vs mine-exceeds-budget.

**Validation gate:** `gh run view <id> --log-failed` excerpts + exact file lists saved to `lessons/raw/`; evidence sheets (with discriminators) in `lessons/`. No mechanism asserted yet. Layers: recon.

### Phase 1 — Harden the instrument ON F3 (with observer-effect control) ✓ DONE (`lessons/phase-1.md`)
- Extend `tests/e2e/fixtures/journal.ts` `dumpJournal`/hang-hook to capture, on timeout: **request/session/op-id-correlated** journal state *(audit M-codex)*, durable-job worker + baton state, offscreen-doc health, CDP target inventory (bounded-timeout), console (**key-allowlist redaction**, not a salt denylist — `get(null)` exposes `nulo:core:*` + session mirrors, audit L3), and a resource snapshot **off the CDP thread**.
- Prove it on F3 first (the only journal-visible, intermittent failure — the safe place to design probes; codex Medium).

**Validation gate:** `bun run typecheck` + `bun run lint` exit 0; a local run captures F3's correlated worker/claim state; **a fault-injection case (deliberately wedged target) shows the dump degrades gracefully within a bounded budget** (audit M3) rather than hanging. Layers: typecheck · lint · e2e-live-network (local trigger).

### Phase 2 — F3 root cause (tractable + intermittent) ✓ DONE (`lessons/phase-2.md`)
- Repro F3 across axes: local `NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/multi-account-from.test.ts` (+ exact-predecessor sequence); `docker-ci-like.sh` (Linux); CI soak `mode=files` (exact list, `retry=0`) **with a no-instrument control arm at equal N**.
- Measure failure rate per arm; confirm instrumentation is non-perturbing before trusting dumps. With `/codex xhigh`: confirm the baton/claim mechanism, name root cause + fix direction, classify (race; proverless-specific?).

**Validation gate:** F3 root-cause + fix-direction writeup citing artifacts; instrumented-vs-control failure rates recorded; codex consult logged (`lessons/phase-2.md`). Layers: e2e-live-network (local + docker + CI).

### Phase 3 — F1 root cause (CDP freeze; out-of-band + bisection) ✓ DONE (`lessons/phase-3.md`)
- Replay the **exact** shard-1 file list (`mode=files`, `retry=0`) locally + `docker-ci-like` + CI. Resolve the F1 discriminator: run `register-token` **in isolation** (freezes alone?) vs **after the exact heavy predecessor**; **bisect** the shard file list to localize any contaminating predecessor.
- Collect **out-of-band** evidence (`DEBUG=puppeteer:protocol`, Chrome stderr/liveness, runner process snapshot, pre-hang `Performance.getMetrics`). Resource snapshot **over time** (Chrome + Bun + Aztec procs) settles starvation-vs-not with DATA — neither assuming nor inverting it (audit M1).
- With `/codex xhigh`: name root cause + fix direction.

**Validation gate:** F1 root-cause + fix-direction writeup citing artifacts; the contamination-vs-shared-path discriminator resolved by evidence; codex consult logged. Layers: e2e-live-network (local + docker + CI) + out-of-band capture.

### Phase 4 — F2 root cause (settle timeout; second signal) ✓ DONE (`lessons/phase-4.md`)
- Replay the exact shard-3 file list (`retry=0`). Add a second signal that is **independent of the playground page DOM** (final-pass — `waitForPgResult` is itself same-page DOM observation, `playground.ts:67`): read the wallet **operation-journal op-state** (durable source of truth, a different channel) **and query the Aztec node directly for the tx's mine status**. This separates three cases: page-wedged (CDP/console) vs promise-unresolved (journal op never reaches `worked`) vs mine-too-slow (op submitted + node shows tx still pending past budget). Compare proverless vs **real-proving** for the same test.
- With `/codex xhigh`: root cause + fix direction; classify.

**Validation gate:** F2 root-cause + fix-direction writeup citing artifacts; promise-vs-budget distinguished with the second signal; codex consult logged. Layers: e2e-live-network.

### Phase 5 — Breadth synthesis, report, handoff ✓ DONE (`DIAGNOSIS.md`, `lessons/phase-5.md`)
- Compare F3/F1/F2 dumps **side-by-side** → confirm or kill the common-root (offscreen/worker lifecycle) hypothesis (the breadth payoff, preserved despite depth-first sequencing — dumps are committed artifacts).
- Write `DIAGNOSIS.md` (per-failure root cause · evidence · fix direction · confidence high/moderate/low). Correct the "resource starvation" wording in **`run-summary.md` + `phase-3.md` only**. Scope the successor **fix** blueprint. Update `implementations-plan/index.md`.

**Validation gate:** `DIAGNOSIS.md` committed; the two prior docs corrected (plan.md left as-is — it was already accurate); `index.md` updated; `bun run lint` exit 0. Layers: docs.

## Alternative approach considered (competing outline) + why rejected

**Approach A — breadth-first (original draft):** instrument everything, soak all three in parallel, synthesize last. **Rejected** (audit M2): the common-root payoff only materializes *after* the instrument reliably captures worker/target state, and the instrument is brand-new + a perturbation risk. Breadth-first designs probes against F1 — the worst case, where the CDP transport itself is suspect.

**Approach B — depth-first on F3 → F1 → F2 (CHOSEN):** F3 is the only intermittent failure (the only place the observer effect can be *measured* via the control arm), the most code-grounded mechanism (baton/reaper), and journal-visible (safe to design probes against). Harden the instrument on F3, then apply to the deterministic F1/F2. Cross-failure comparison is **not** lost — Phase 5 compares the committed dumps retrospectively.

## Security & Adversarial Considerations
- **Threat model:** test-harness + CI + diagnosis; no production runtime code. Primary risk is a **wrong conclusion** (sends the fix plan down a blind alley) — mitigated by "cite an artifact" + explicit discriminators + the control arm.
- **Least privilege:** `network-e2e-soak.yml` runs `permissions: contents: read, pull-requests: read`; no new secrets. `SPONSORED_FPC_SALT` is empty on localhost (`_network-e2e.yml:104`) and passed as a `secrets:` input (not echoed).
- **Redaction is an ALLOWLIST problem** *(audit L3)*: `chrome.storage.local.get(null)` returns every key including `nulo:core:*` account rows + session mirrors. The instrument allowlists journal/diagnostic key prefixes; a salt denylist is insufficient. Phase-1 gate asserts no account/session/secret material in dumps.
- **Telemetry artifact minimization** *(final-pass)*: Phase-3 out-of-band capture (protocol logs, process snapshots) is uploaded by `_network-e2e.yml:315` on failure. Minimize + redact **before** upload, not after: no environment dump (`env`/`argv` scrubbed), **no full protocol transcript by default** (capture only the wedged call + a bounded pre-hang window), and the process snapshot carries names/RSS/CPU only — never command-line secrets.
- **Supply chain:** no dependency changes; prefer built-in puppeteer/CDP + the existing chrome-devtools MCP tools over a new tracer dep (7-day min-age + `bun.lock` if ever needed).
- **Adversarial asks (carried into the final codex pass):** where can a diagnosis *look* confirmed but be wrong? where does the instrument perturb the race? what are we trusting about vitest SHA-1 sharding / CDP semantics?

## Assumptions

**Facts (verified):**
- `bun run e2e:agent` → `bash packages/extension/scripts/e2e/agent.sh`; passthrough args → `vitest run --config vitest.e2e.network.config.ts` (`agent.sh:131`). Local single-test: `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<file>` (`agent.sh:37-54,120-131`).
- **vitest shards by SHA-1-of-file-path (`pr-network-e2e.yml:109`); the PR matrix EXCLUDES 4 heavy files (`:139`: fee-methods, concurrent-sendtx-confirm, transfers, tx-sendTx-default). The soak has no `exclude_files` input and local has no exclude → `--shard=k/5` ≠ the failing PR's shard-k.** *(audit H1)*
- `vitest.e2e.network.config.ts`: `pool: forks` + `isolate: true` (`:39-40`) — fresh worker per file; fixtures launch + `browser.close()` a fresh browser per test (`extension.ts:420,~465`). `fileParallelism:false`. `retry` default 2 via `NULO_E2E_RETRY` (`:52`).
- The `Runtime.callFunctionOn timed out` freeze is a documented Puppeteer 24.4x/Chrome 128+ regression on the element-handle path (`extension.ts:1148-1152`); `popups.ts:55-97` carries detach/re-wait recovery.
- F3: reaper queued grace 10 min (`reaper.ts:77`) ≫ 90s test budget (`multi-account-from.test.ts:41`) → a `queued` reading at failure is honest (reaper hasn't fired). Baton release at `background.ts:300` (`onExecutionEnqueued: releaseFifo`).
- `waitForPgResult` watches a playground DOM result row only (`playground.ts:67`) — not proof the dApp promise settled.
- `docker-ci-like.sh` exists: Ubuntu 24.04, `--cpus=4 --memory=12g --shm-size=2g`, takes a shard expr/file arg — the Linux-on-Mac bridge.
- Prior `proverless-network-stabilization/plan.md:99,187,189` marked starvation UNPROVEN; only `run-summary.md`/`phase-3.md` overclaimed.
- #94 final: shards 1,3 FAILURE; shard 5 SUCCESS (F3 intermittent); shard 2,4,canary,concurrent-confirm,fee-methods SUCCESS.

**Inferences (unverified — to confirm/kill with evidence):**
- F1 is the **shared CDP-fragile path** (a) more likely than contamination (b) — fresh-browser-per-test makes browser-state contamination implausible; any contamination would be via shared external state/processes. *(Discriminator in Phase 0/3; not assumed.)*
- F3 is a missed baton/claim under CI timing. *(Best-grounded; Phase 2 confirms.)*
- A single common root (offscreen/worker lifecycle) may underlie F3+F1(+F2). *(Held; Phase 5 confirms-or-kills.)*
- The failures are NOT primarily CPU/RAM starvation. *(A prior to TEST with over-time, all-process data — explicitly NOT to re-assert without it; audit M1.)*

**Asks (for approval):**
- Done = root cause + fix direction (no fix code). ✓
- CI soak budget = generous. ✓
- Local runs = freely. ✓
- **NEW (audit):** (1) acceptable confidence threshold when a failure does NOT reproduce locally or in `docker-ci-like` (CI-only) — propose: name the mechanism from CI out-of-band evidence + a control-arm-validated failure rate, mark confidence `moderate`. (2) OK to add runner-level telemetry/artifacts (process snapshots, protocol logs) to the soak, with the redact-before-upload minimization above? (3) For F3's intermittency, a **target rep count + executable rule** — propose ≤25 reps/arm/dispatch (the soak cap), accumulated across dispatches to ≥40/arm, accepted via the two-proportion test in Methodology §4. (4) Correcting only `run-summary.md`+`phase-3.md` in Phase 5 (not plan.md) — confirm.

## Decision ledger
- **D1 — sequencing:** ~~breadth-first~~ → **depth-first on F3** (audit M2). F3 hardens the instrument + measures the observer effect; breadth comparison preserved in Phase 5.
- **D2 — instrument:** extend `dumpJournal` (not a separate tracer) — reuses `awaitOrDump`'s frozen-CDP-vs-journal-visible split. Adopted; + request/op-id correlation, bounded-timeout CDP probes, off-thread resource snapshot, allowlist redaction.
- **D3 — repro lever:** ~~`--shard=k/5`~~ → **exact file lists via `mode=files`** (audit H1). `--shard` only to confirm bucketing.
- **D4 — F1 framing:** ~~"cross-test contamination (leading)"~~ → **two competing hypotheses with an explicit discriminator** (audit H3). Browser is fresh per test, so contamination (if any) is external-state, not browser.
- **D5 — observer effect:** **no-instrument control arm at equal N** is mandatory before trusting any instrumented pass (audit H2).
- **D6 — F2:** add an explicit hypothesis + a **second signal** beyond `waitForPgResult` (audit M5).
- **D7 — Phase-5 scope:** correct only `run-summary.md`+`phase-3.md`; prior `plan.md` was accurate (audit M1).
- **D8 — observer-effect rule (final-pass):** executable two-proportion acceptance test + ≥40 obs/arm accumulated under the 25/dispatch cap (resolves the ≥30-vs-25 conflict codex flagged).
- **D9 — F2 second signal (final-pass):** must be page-DOM-independent (journal op-state + direct node mine-status), not another same-page symptom.
- **D10 — telemetry minimization (final-pass):** redact/minimize protocol logs + process snapshots BEFORE the `if: failure()` upload; no env, no full transcript by default.
- **Rejected:** treating `retry on/off` as a first-class differential axis (audit L4) — `retry=0` is pinned globally instead; F3=race is already known.
- **Disputed/open:** the four NEW Asks above (confidence threshold, telemetry approval, target rep count, Phase-5 scope) — surfaced for the approval gate.

### Audit verdicts
- **Round-1 codex** (`019ed228`): conditional approve — see `audit-codex.md`. All conditions folded in.
- **Round-1 planner** (opus; `audit-fable.md`): conditional approve — H1/H2/H3 + M1–M5 + L1–L4 folded in.
- **Final fresh-context codex** (`019ed230`): **conditional approve, NO High/Critical**; confirmed H1/H3 genuinely closed + no new ordering hazard; its 3 residual conditions folded in as D8–D10.

## Seeds (draft — finalized post-approval)
*(Recommended: `/goal` — each phase's completion is transcript-observable via committed evidence artifacts + validation gates. Canonical after approval.)*
