# Phase 3A — warm-up effect probe findings

> Decision criterion (from plan.md §5.3): if browser-A warm-up reduces browser-B first-cap-popup latency by ≥30%, use `global-setup.ts` warm-up; otherwise fall back to per-test fixture-layer warm-up.

## Result: ❌ DOES NOT MEET 30% THRESHOLD

10 trials (5 NO_WARMUP, 5 WITH_WARMUP) on warm M-series local machine:

| Metric | NO_WARMUP | WITH_WARMUP | Delta |
|---|---|---|---|
| capPopup (ms) | 206 ± 82 (n=5) | 220 ± 78 (n=5) | -6.8% (slightly slower) |
| capAccountItem (ms) | 533 ± 103 (n=5) | 720 ± 209 (n=5) | -35.2% (significantly slower) |

Raw data:
- NO_WARMUP capPopup: [172, 357, 223, 128, 149]
- WITH_WARMUP capPopup: [288, 114, 135, 272, 290]
- NO_WARMUP capAccountItem: [575, 560, 624, 332, 574]
- WITH_WARMUP capAccountItem: [890, 318, 740, 874, 780]

## Critical caveat: probe is inconclusive for CI

Local M-series warm machine handles cap-popup in **~200ms**. CI cold-shard takes **30,000–60,000ms** (100–300×). The within-host warm-up probe cannot model the cross-VM cold-cliff that's actually hurting CI:

- Local: every cycle starts on a warm host with hot OS caches
- CI: each shard is a fresh VM, cold disk, cold bb.js wasm, cold puppeteer driver

A negative probe result here doesn't mean warm-up won't help on CI — it means we can't test the relevant regime from a local mac.

## Why warm-up could even hurt locally

Within-host on a warm machine, opening browser A then browser B doesn't help because the host is already warm. But it costs ~30–60s of additional work per trial and creates transient memory pressure during overlap. The data shows WITH_WARMUP browser-B times are mixed (some faster, some slower) with no clear pattern.

## What the failed CI shard actually showed (PR #63 run, shard 3)

Shard 3 ran `fee-methods.test.ts` first, then `tx-sendTx-default.test.ts`:

| Test | Wall time | Verdict |
|---|---|---|
| `fee-methods` "sponsored FPC is default fee method" | 27,279ms | ✅ first-test cold tax |
| `fee-methods` "transfer with sponsored FPC fee" | 195,635ms (retry x2) | ✅ but fundamentally slow |
| `fee-methods` "transfer with public Fee Juice" | 138,279ms | ✅ also slow |
| `fee-methods` "transfer with private Fee Juice" | 58,738ms | ✅ |
| `fee-methods` "gas balance card shows non-zero FeeJuice" | 1,316ms | ✅ |
| `tx-sendTx-default` (180s budget) | 194,377ms (retry x2) | ❌ timeout |

Diagnosis:
- Cold tax appears as the first-test 27s overhead (acceptable)
- The 195s `transfer with sponsored FPC fee` test is **not** paying cold tax — it's intrinsically slow (FJ flows are heavy)
- `tx-sendTx-default` failed because shard 3 ran fee-methods → exhausted the shard quasi-budget before tx-sendTx-default could fit its 180s

This is **shard load imbalance + per-test slowness**, not the cold cap-popup cliff the warm-up was designed for.

## Pivoted Phase 3 plan

The probe + log analysis points to a different remedy than warm-up:

1. **Generalize the Phase 2 pre-grant fixture pattern** — move cap-grant work into fixture setup (hookTimeout=300s) for ALL cap+execute tests, not just register-token. The Phase 2 fixture proved this pattern works (43s test vs prior quarantine).
2. **Add per-bundle fixture variants** — `dappConnectedExtensionWithTransactionCap` for tx-sendTx-default + similar.
3. **Consider budget bumps** for genuinely slow tests (fee-methods FJ transfers, register-token). 180s isn't enough on cold shards.
4. **Skip cross-browser warm-up entirely** — probe didn't validate it, and the failure mode it was designed for (cold cap-popup) isn't what's actually hurting CI right now.

## Probe infrastructure preserved

The probe test file `packages/extension/tests/e2e/network/_probe-warmup-effect.test.ts` is kept in the repo, gated on `NULO_E2E_PROBE=1`. Useful for future re-measurement if cold-shard concerns resurface.

To run:
```bash
NULO_E2E_PROBE=1 bun run e2e:agent tests/e2e/network/_probe-warmup-effect.test.ts
# Results stream to /tmp/nulo-probe-warmup-results.log
```

## Confidence assessment

- **High confidence**: warm-up via throwaway browser A doesn't help in within-host warm regime
- **Moderate confidence**: shard 3 failure on PR #63 is NOT cap-popup cold cliff — it's per-test slowness + shard load
- **Low confidence**: that the right Phase 3 fix is "generalize pre-grant fixture". Worth trying because it's structural and proven on register-token, but CI may surface a different failure pattern.
