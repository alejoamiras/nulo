# Phase 4 — acceptance gate findings + redesign follow-up

## Acceptance result

After PR #65 (Phase 3C: heavy split + 180s wait + 240s test budget + diagnostic), the Phase 4 acceptance gate fired 5 runs on pinned SHA `0d020614`:

```
r1: ✅ 5/5 GREEN  (diagnostic: waitForPgResult settled in 2022ms)
r2: ❌ shard 3 / tx-sendTx-default / Waiting failed: 180000ms exceeded
r3: ❌ shard 1 / cancel-mid-prove   / Timed out after waiting 30000ms
r4: ❌ shard 3 / tx-sendTx-default / Waiting failed: 180000ms exceeded
r5: ✅ 5/5 GREEN
─────────────────────
2 of 5 = 40%   (target: 3 of 5 = 60% → NOT MET)
```

## What this revealed

- The fast runs (r1, r5) confirm the structural fixes work — when the runner cooperates, the wallet's full popup→prove→submit→callback chain settles in ~2 seconds.
- The slow runs (r2, r4) ran the full 180s × 3 retries = 540s wall and never settled. That's not popup boot, not DOM polling, not same-shard queue pressure — it's the wallet promise not resolving in time on slow hosted runners.
- r3 hit a different test (`cancel-mid-prove`) on a different shard with the SAME latency family — its 30s post-approve selector waits fail on slow runners for the same reason.

## What we tried (in order)

1. NO_WAIT to remove receipt mining (PR #63) — correct structural fix, kept
2. Pre-grant fixture to remove cap-popup cold tax (PR #63 + PR #64) — correct, kept
3. Heavy split: fee-methods to its own job (PR #65) — correct, kept
4. waitForPgResult 30s → 90s → 180s — each bump just pushed the same failure mode upward
5. Test budget 180s → 240s — fixed a self-inflicted bug where the test envelope < the wait it wrapped

The structural changes work. The residual flake is runner-pool variability that timeouts cannot fix.

## Decision (Codex audit session 019e6743-2fb7-7df3-bad7-6cf503cf2338 §3)

**Verdict G**: quarantine `tx-sendTx-default` from the acceptance gate, then redesign its assertion seam.

- Re-quarantine via the existing `NULO_E2E_SKIP_DEFERRED_SLOW` env so it skips on CI but still runs locally
- Bump `cancel-mid-prove`'s two post-approve selector waits (30s → 90s) to absorb the same latency variance
- File the follow-up: replace `tx-sendTx-default` with a journal-stage assertion test (popup opens → fee picker → approve → operation transitions into simulating/proving) — does NOT wait on the dApp's full sendTx promise

## What's still covered by CI

`tx-sendTx-noFrom`, `tx-sendTx-feePayer`, `tx-sendTx-sponsoredFpc` all currently pass on the acceptance gate. The popup-shape gate isn't lost — it's exercised by sibling tests. Only `tx-sendTx-default`'s specific "default account-bound sendTx → execute popup → confirm" path is temporarily skipped on CI.

## Follow-up issue

Replace `tx-sendTx-default` with a journal-stage observation test. Add stage-level instrumentation (markJournal console emission for `simulating` / `proving` / `submitting` / `succeeded`) in the same PR. Once the redesign lands, drop the `skipDeferredSlow` gate.

Estimate: 4-6 hours for the redesign + instrumentation. Wallet code touch (markJournal callsite) requires codex review per CLAUDE.md.

---

## Resolution (2026-05-28)

The "redesign tx-sendTx-default with journal-stage assertion" follow-up was superseded by a simpler structural fix: `implementations-plan/accelerator-server-ci/plan.md` (PR #67) landed native bb proving on CI runners, which collapses the per-prove time tail that motivated the journal-stage redesign. The follow-up `implementations-plan/network-e2e-unquarantine/plan.md` removes the `skipDeferredSlow` gate from `tx-sendTx-default` and restores `cancel-mid-prove`'s 30s post-approve selector waits — both via the un-quarantine PR rather than a wallet-code-level redesign.

The journal-stage instrumentation would still be valuable for future un-quarantine signal beyond accelerator perf (PR #67 plan §11 flags it as a follow-up).
