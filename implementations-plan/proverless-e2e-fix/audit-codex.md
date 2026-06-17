# Codex audit — proverless-e2e-fix (Round 1)

Session `019ed48f-5c9e-76a2-a363-c3784b6a22df`, xhigh, read-only.

**Verdict: reject (blocking)** — gate placement, signal assumptions, and required-check semantics aren't sound enough yet to make the suite a trustworthy merge gate.

## High/Critical
1. **Gate placement is wrong.** Plan says "gate each test's *first* dApp action", but F1/F2 fail at the **consume** which runs AFTER the grant mines + advances the chain again (`authwit-lifecycle.test.ts:71`, `authwit-consume-smoke.test.ts:67`). Fixture-once warmup covers F3's first send, NOT F1/F2's later actions. → gate must run **before each tx-producing action** (every `consume` + settings submit after a mined state change).
2. **Readiness signal not test-readable yet.** `PxeService.getSyncedBlockHeader()` exists (`service.ts:373`), but the instrument only reads `chrome.storage`/SW-logs via `swEvaluate` — there's NO existing test-side path to call runtime PXE APIs. "A readable readiness signal exists" is an INFERENCE, not a Fact → building the read path is real work.
3. **Convergence criteria too loose.** `anchor >= tip - ε` (ε=1) reintroduces the race (the consume needs the just-mined grant block). "stable for K polls" can be stable-but-behind. **Robust: snapshot `tip0` once, then require `anchor >= tip0` for 2 consecutive polls** (polling a moving current tip can chase forever).
4. **Required-check story weak.** `Status` passes when skipped (`pr-network-e2e.yml:205`). Broadening a positive allowlist isn't enough — a network-changing PR can dodge via an unlisted path. Once required on `dev`, the suite should be **run-by-default with doc-only NEGATIVE skips**, not pass-when-skipped.

## Medium/Low
- Rejecting retry/timeout tuning as the fix is correct — but the watchdog IS timeout tuning; valid only as a diagnostic guardrail, not proof (the soak is the proof).
- The watchdog must wrap the post-click/post-approve waiters incl. `waitForPgResult()` (`playground.ts:68`), NOT fixture setup. F2's empty-`dapp_execute` variant means journal-only watching is insufficient.
- Security: accelerator SHA pin + read-only tokens are fine; the weaker surface is skip-as-pass + **unpinned third-party actions** (`dorny/paths-filter@v4`, `actions/*@v*`).

## Assumptions attack
- **Facts:** "readable readiness signal exists" is misstated (readable-from-tests unverified). "Root cause established" fair, but the exact blocked await is not pinned.
- **Inferences:** "first-action gate removes the flake" unsafe (F1/F2 contradict). "local green predicts CI green" weak (F3 is CI-only).
- **Asks (hidden):** choose per-action placement (not just the signal); scope the watchdog to proverless paths so real-proving canaries aren't false-failed; decide whether a required check may pass-when-skipped.

## What looks fine
Test-only scope is coherent. Reusing `dumpDeepDiagnostics` is right. Rejecting retry-as-fix is right. The soak-before-required shape is right — once placement, signal, and skip-semantics are fixed.

---

# Codex audit — proverless-e2e-fix v2 (Round 2, the throttle approach)

**Verdict: conditional approve** — tighten: (1) explicitly falsify "logger-RPC flood is the dominant SW load", (2) narrow the "transport-only / same logs" claim, (3) scope the watchdog to every proverless stall surface (not just `waitForPgResult`). All folded into plan v2.

## High (conditions, adopted)
- **Flood may not be THE sole bottleneck.** After a log arrives the SW still does per-log `trim`/`onLog`/`print` (`wallet/logger/store.ts:46-61`) + live fan-out to popup subscribers (`services/log-viewer/service.ts:19-31`, `Header.vue:28-30`). If envelope churn isn't dominant, batching only the transport won't clear the stall. **Falsifier:** batched RPC count collapses but stalls persist ⇒ hypothesis false. → Phase 0 falsifier + SW-side `logBatch` processes N entries in one turn.
- **"Transport-only / same logs" too strong.** Log consumers observe live per-log events; batching shifts timing + cross-context ordering. → narrow to "same semantic content; Warn/Error immediate; Info/Debug best-effort timing; ordered-within-batch."
- **Watchdog scope under-specified.** `waitForPgResult` necessary not sufficient — `authwit-lifecycle.test.ts:109-123` settings `waitForFunction` can hang post-claim. Gate on the proverless build/runtime SIGNAL, not a shorter timeout, or the real-proving canary (`tx-sendTx-default.test.ts:92`) false-fails. → wrap all proverless stall surfaces.
- **Log-loss overstated.** MV3 teardown-flush is best-effort; Warn/Error-immediate is reliable; Info/Debug can still be lost. → narrow the guarantee.

## Medium/Low (adopted)
- Phase 5 `decide`/`changes` only exports the positive `extension-network` filter — "doc-only negative skip" needs an added `docs-only`/`non-doc` output + a `decide` rewrite (manageable, not a rearchitecture).
- Run-by-default raises CI cost materially (5 shards + 2 heavy + canary per non-doc dev PR) → keep the required flip SEPARATE + data-gated after observing cost.
- Isolated 20× is a valid lower-bound (F1/F3 repro in isolation) but can't prove shard stability; full-matrix 3× is thin → add shard-specific repeats for the historical failing shards.

## What looks fine
The pivot is much better than v1 (finally pointed at the real mechanism). Immediate Warn/Error bypass + bounded-buffer-with-drop-count is the right mitigation. Proverless-scoped fast-fail + soak-before-required + run-by-default-with-negative-skips is the right rollout shape.
