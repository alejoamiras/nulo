# Proverless network-e2e — FIX plan (root fix: throttle the sync log-flood)

> **⛔ HALTED at the Phase-0 gate (2026-06-17) — the premise is FALSIFIED.** Removing 100% of the offscreen→SW log forwarding did NOT ease the F3 stall (no-flood ≈43% vs baseline ≈33%; soak 27676912669). The logger-RPC flood is **NOT the F3 cause**, so batching it cannot fix F3 — the diagnosis's "SW-log-flood backpressure" mechanism was **wrong for F3**. **Re-diagnosis required** (leading candidate: `chrome.storage.local` contention — offscreen PXE sync-writes vs SW-local execution-start reads). The `createBatchingForwarder` (commit 58b1388, 8 tests) is kept as **logging hygiene**, not the fix. Details: `lessons/phase-0.md`.
>
> **Status: APPROVED v2, then HALTED at Phase 0.** Successor to [`proverless-e2e-diagnosis`](../proverless-e2e-diagnosis/DIAGNOSIS.md). v1 (a test-only PXE-readiness gate) was rejected by both auditors; the approved v2 (production log-flood throttle) just failed its own Phase-0 falsifier. The falsifier worked as designed — caught the wrong mechanism before a full build/ship.

## Mission
Make F1/F2/F3 reliably green by **removing the root backpressure**: batch the offscreen→service-worker console-log forwarding so the upstream PXE block-synchronizer's per-block log flood no longer saturates the single SW event loop (which is what starves dApp-tx execution-start). Add a test-side **fast-fail watchdog** (anti-masking). Prove zero-flake with a **soak (targeted 20×/test ISOLATED + full-matrix 3×, retry=0)**, then make the suite **run-by-default** and **prepare the required-check flip** (flip user-gated).

## Root cause (from the diagnosis)
A dApp-tx execution-start path is starved while the offscreen PXE block-synchronizer **floods the SW with logger RPCs** during block-sync (the single SW loop is the contention point). Confirmed mechanism: `offscreen/index.ts:22-28` forwards EVERY console call (incl. upstream @aztec `block_synchronizer` "Updated pxe last block to N", one per block) as a separate `logger.log("pxe", …)` RPC. See [DIAGNOSIS.md](../proverless-e2e-diagnosis/DIAGNOSIS.md). **Fix the transport, not the tx logic.**

## Approach (main): batch the forwarding + anti-masking watchdog
1. **Production (transport-only): batch offscreen→SW log forwarding.** Buffer forwarded console logs in the offscreen and flush in batches (debounced ~N ms / M entries) via a `logBatch` path, collapsing the per-block flood into a few RPCs → the SW loop stays responsive during sync → execution-start isn't starved. **Same logs, fewer RPCs** — no behavior change to tx flow; flush Error/Warn immediately + on teardown so nothing important is delayed or lost. This also helps **real users** (the latent stall the diagnosis flagged), not just tests.
2. **Test-side fast-fail watchdog (anti-masking).** Wrap the dApp result-waiters (incl. `waitForPgResult`) so a residual stall fails FAST with the captured journal/deep-dump (reuse the instrument) instead of a 300s freeze — **scoped to proverless paths** (never the real-proving canary, where `proveTx` legitimately runs ≤30min) and covering both `queued` AND post-claim stages (audit H4).

## Competing outline (v1, REJECTED — see audits)
**Test-only PXE-readiness gate** (wait for PXE anchor ≥ node tip before each action). Rejected: (H1) the anchor isn't readable from the test side without a production change; (H3) anchor-convergence is *decoupled* from the logger-RPC backpressure → it measures the wrong thing + self-contends on the chain RW-lock (can hang 5min); (H2) a fixture-once gate can't cover the consume-after-mine stall. Cutting the flood at the source is strictly better — it fixes the actual mechanism for tests AND users.

## Phases

### Phase 0 — Confirm the flood IS the dominant load (FALSIFIER) + design the batcher
- Confirm `offscreen/index.ts:22-28` is the console-flood choke point — but do NOT assume it's the ONLY SW-loop load (audit H1: per-log `trim`/`onLog`/`print` in `wallet/logger/store.ts:46-61` + live fan-out to popup subscribers `services/log-viewer/service.ts:19-31` also cost). So the batcher must reduce SW-side per-log WORK too: the SW `logBatch` processes N entries in **ONE handler turn** (not N turns), not just batch the transport.
- **Explicit FALSIFIER (gate-blocking, audit H1):** an early spike measures `logger.log` RPC count + the F3 stall behaviour before/after batching. **If batched RPC count collapses but the stall persists → the flood is NOT the dominant load → STOP + re-plan** (don't build the rest on a false premise).
- Decide the missing policies (audit asks): **batch policy** (flush every `N`ms / `M` entries / max-delay cap), the **proverless detection source** for the watchdog (the build/runtime proverless signal — NOT a shorter timeout), **immediate Warn/Error flush**, best-effort teardown flush, bounded buffer (drop-oldest + a dropped-count log).
- **Validation gate:** a written batcher design (policy values, flush triggers, SW-side one-turn processing, ordering, loss posture) + the early falsifier result (RPC count down AND an early F3 stall-rate signal). Layers: recon + a measurement spike.

### Phase 1 — Implement batched forwarding (production, transport-only)
- Add the offscreen-side buffer + a `logBatch` on `LoggerService`/`LoggerServiceClient`; route the console-catch (`offscreen/index.ts:25-26`) through it. Keep Error/Warn immediate. Unit-test the batcher (buffers, flushes on cadence/threshold/error/teardown, preserves order, no loss).
- **Validation gate:** `bun run typecheck` + `bun run lint` + `bun run test` (the new batcher unit tests + existing logger tests) exit 0. Layers: typecheck · lint · unit.

### Phase 2 — Fast-fail watchdog (test-side, anti-masking)
- Wrap **every proverless stall surface** (audit H4), not just `waitForPgResult`: also the journal waiters AND the settings-flow `waitForFunction` (`authwit-lifecycle.test.ts:109-123`) that can hang post-claim. On a stall, dump deep-diagnostics + fail fast.
- **Gate on the proverless build/runtime SIGNAL** (the Phase-0 source), NOT a shorter timeout — so the real-proving canary (`tx-sendTx-default.test.ts:92`, `proveTx` ≤30min) is never false-failed. Cover `queued` AND post-claim (simulating/proving) stages.
- **Validation gate:** `bun run typecheck` + `bun run lint` exit 0; fault-injection (forced stall) → fast labeled failure WITH journal state; a normal run passes; a simulated long real-proving wait under the canary signal is NOT false-failed. Layers: typecheck · lint · e2e-live-network (local fault-injection).

### Phase 3 — Local validation (agent.sh)
- Run F1/F2/F3 locally via `agent.sh`, `retry=0`, ≥3× each, on the batched build + watchdog. Confirm no regression + the batcher build is healthy. (F3 is CI-only; local-green is necessary, not sufficient.)
- **Validation gate:** F1/F2/F3 pass locally ≥3× at `NULO_E2E_RETRY=0`; `bun run audit:vue` exit 0 (the production change touches the extension build). Layers: typecheck · lint · unit · e2e-live-network (local) · build.

### Phase 4 — CI soak acceptance (the real proof)
- `network-e2e-soak.yml`, `retry=0`, proverless: **targeted** F1/F2/F3 each soaked **in isolation** (one file per dispatch, audit M2) 20× each; + **shard-specific repeats** of the historical failing shards (shard 1/3/5 via `mode=shard`) to prove SHARD stability — isolation alone can't (audit Med); + **full-matrix** 3×. All green = the throttle fixed the root.
- **Validation gate:** each of F1/F2/F3 20× ISOLATED green + shards 1/3/5 repeated green + full-matrix 3× green, all at `retry=0`. THE acceptance gate. Layers: e2e-live-network (CI).

### Phase 5 — Make-required (run-by-default, not pass-when-skipped)
- Rework the gate (audit M3 — NOT a tiny edit): `changes` today exports only the positive `extension-network` filter, so add a `docs-only`/`non-doc` output + **rewrite `decide`** to run Network e2e by default on `dev` PRs, skipping ONLY truly-doc-only diffs. Closes the dodge where a network-affecting PR (e.g. `packages/wallet-core/**`) matches no positive path.
- **Cost-aware:** run-by-default adds 5 shards + 2 heavy + canary to most `dev` PRs. **Keep the required-flip SEPARATE + data-gated** — observe real-PR runtime/cost first, THEN flip `Network e2e / Status` to required on `dev` (GitHub ruleset, **USER-GATED**).
- **Validation gate:** the `decide` rewrite + negative-skip passes `actionlint` + a dry-run check (doc-only PR skips; a `wallet-core` change runs); the required-flip is a precise user-gated runbook noting observe-cost-first. Layers: workflow lint + docs.

> **PR + merge to `dev` and the required-flip are USER-GATED.** The `/goal` STOPs before them.

## Security & Adversarial Considerations
- **Production change is logging-TRANSPORT only** (no tx-logic change) — but NOT literally "same logs" (audit H2): batching shifts Info/Debug timing + cross-context ordering. The honest promise is **same semantic content; Warn/Error flushed IMMEDIATELY (reliable); Info/Debug best-effort timing, ordered within a batch**. MV3 teardown-flush is best-effort (not a guarantee) — Info/Debug may be lost on offscreen death; Warn/Error must not be. Must not swallow security-relevant error logs.
- **Make-required integrity (audit M3):** run-by-default + doc-only negative skips closes the pass-when-skipped + positive-allowlist dodge. Keep `contents: read`/`pull-requests: read`; accelerator SHA-pin + `SPONSORED_FPC_SALT` (empty on localhost) unchanged. Consider pinning third-party actions (`dorny/paths-filter`, `actions/*`) to SHAs (noted; broader CI hygiene).
- **Anti-masking:** the watchdog (proverless-scoped, fail-fast with evidence) ensures a future regression surfaces loudly rather than hiding behind a quieter log path.

## Assumptions
**Facts (verified):**
- The flood + its choke point: `offscreen/index.ts:22-28` forwards every console call as a per-call `logger.log("pxe", …)` RPC; the diagnosis SW-trail was 50/50 `block_synchronizer` lines.
- The "Updated pxe last block" lines are upstream @aztec console output (not ours) — so we fix the **forwarding**, which IS ours (`wallet/services/logger/{client,service}.ts`).
- The instrument (`tests/e2e/fixtures/journal.ts`) is reusable for the watchdog dump (bounded reads).
- Soak harness: `network-e2e-soak.yml` (`mode=files|full`, `repeats` clamp 1-25, `retry`); `agent.sh` local; `NULO_E2E_RETRY` drives vitest retry.
- The required-gate dodge is real (audit M3): pass-when-skipped + positive `extension-network` allowlist.

**Inferences (to confirm):**
- Batching the forwarding clears enough SW-loop backpressure to fix all three (the flood is the dominant load). *Phase 4 soak is the arbiter.*
- The F2 preflight-stall variant (no PXE call) is also relieved by freeing the SW loop. *Phase 4 confirms.*
- Local-green predicts CI-green. *Weak — F3 is CI-only; the soak decides.*

**Asks (resolved):** minimal production fix approved ✓ · done = fix + soak-prove + flip-required (flip user-gated) ✓ · soak bar = targeted 20× (isolated) + full 3× ✓ · F1 watchdog = yes ✓. **/harden:** the production change touches a shared logging path — a `/harden security` pass is NOT warranted (no trust boundary / secret / authz), but the change must keep error-log fidelity (covered in Security).

## Decision ledger
- **D1 — approach pivot:** v1 test-only readiness gate → **v2 production log-flood throttle** (both auditors rejected v1: signal unreadable + decoupled + placement; user approved minimal production). 
- **D2 — transport-only:** batch the offscreen→SW console forwarding (no tx-logic change; Error/Warn immediate; teardown flush; bounded buffer).
- **D3 — watchdog:** proverless-scoped fast-fail wrapping the result-waiters (audit H4 — don't false-fail the real-proving canary; cover post-claim stages).
- **D4 — make-required:** run-by-default + doc-only negative skips (audit M3), not pass-when-skipped + positive allowlist.
- **D5 — soak isolation:** one file per dispatch (audit M2) + shard-specific repeats for shards 1/3/5 (audit Med).
- **D6 — falsifier first:** Phase 0 must prove batching actually reduces the stall (RPC-down-but-stall-persists ⇒ STOP) — the flood may not be the only SW load (audit H1).
- **D7 — narrowed claim:** "transport-only" = same semantic content, Warn/Error immediate, Info/Debug best-effort, ordered-in-batch (audit H2/H4).
- **D8 — watchdog:** wrap all proverless stall surfaces, gated on the proverless build signal (audit H4).
- **D9 — make-required:** a `decide` rewrite (docs-only negative skip) + a data-gated, separate required-flip (audit M3 + cost).

### Audit verdicts
- **Round 1 — codex + opus planner on v1 (test-only readiness gate): BOTH REJECT (blocking)** — signal not test-readable, decoupled from the real backpressure, placement can't cover the consume-after-mine stall. → pivoted to v2 (`audit-codex.md`, `audit-fable.md`).
- **Round 2 — codex on v2 (throttle): CONDITIONAL APPROVE** — 3 conditions + Mediums, ALL folded above (D6-D9 + Phase-0 falsifier + Phase-2 scope + Phase-4 shards + Phase-5 rewrite). The opus planner's Round-1 deep analysis already endorsed THIS direction (it named the offscreen→SW logger-RPC flood as the real mechanism + the production lever as the right fix), so v2 was not re-run through the full dual round — codex Round-2 is the fresh cross-family check on the new approach.

## Seeds (draft — finalized post-approval)
*(Recommended: `/goal` — phase completion is transcript-observable (unit tests, soak gate, committed artifacts). STOP before the PR merge + the required-flip, both user-gated.)*
