# Phase 3 — speed audit findings

## Win matrix

| # | Candidate | Outcome | Saving | Notes |
|---|---|---|---|---|
| 1 | `refreshBalances` 500ms + 2s padding (`helpers.ts:432-446`) | **Landed** | ~2.5s per call × up to 30-60 calls in fixture loops | Replaced 500ms with `waitForSelector` of refresh row; dropped trailing 2s (caller polling handles it) |
| 2 | `feeJuiceReady` + `feeJuiceImported` polling cadence (`extension.ts:408-420`, `extension.ts:541-554`) | **Landed** | 30 × 5s = 150s → 60 × 1.5s = 90s budget shape; ~3× faster happy-path detection | Matches PR #70 `tokenReadyExtension` tightening pattern |
| 3 | smoke `retry: 2 → 1` (`vitest.e2e.config.ts:38`) | **Rejected (reverted)** | Would have saved ~10 min cumulative on flake-hit runs (per codex audit estimate) | **Empirical: surfaced 4 fresh failures (profile-rename + wallet-lock cascade) under the documented "~17 sequential files Chrome cascade" path. The second retry is doing real work, not masking.** Codex's earlier "directionally right but unevidenced" was the correct framing — and the evidence now points the other way. Inline comment preserved at `vitest.e2e.config.ts:39-42`. |
| 4 | `waitForTxConfirmation` hard 10s sleep (`helpers.ts:623`) | **Deferred** | ~10s × tx-using-tests | No deterministic confirmation signal in the popup yet — adding one (e.g. `awaitingTransactions` empty via storage) needs a small refactor + risk of double-submit on retry. Codex specifically warned against helper-level recovery here. |
| 5 | `sendTransfer` 5s post-fee-estimation sleep (`helpers.ts:602-604`) | **Deferred** | ~25s × 5 call sites | Comment says "Give PXE a moment to fully sync after fee estimation before proving. Without this, proveTx may use a stale anchor block on slow networks." This is masking a real PXE-anchor race per codex audit. Removing requires a deterministic PXE-anchor-synced signal. |
| 6 | `sendTransfer` 3s post-refreshBalances sleep (`helpers.ts:538`, private-from path) | **Deferred** | ~3s × ~3 private-from sends | Same risk as #5 — PXE sync masking. Downstream input-enabled wait *might* catch it, but couldn't validate within autonomous-run budget. |
| 7 | `navigateToSettings` 200ms post-route sleep (`helpers.ts:108-110`) | **Landed** | ~5s smoke (×26 call sites); ~3s network (×6) | Every caller follows with its own `waitForSelector`, which gives a deterministic mount signal that makes the sleep redundant. Validated: smoke 67/67 pass after the drop. |
| 8 | `openPopup` triple-nav (`extension.ts:676-684`) | **Deferred** | ~500ms × 75 invocations/smoke run = ~37s smoke if drop one nav | Original triple-nav was a real SW handshake workaround. Highest potential single-PR win but also highest risk. Needs focused measurement run + isolation from other changes. |
| 9 | retry: 1 scope expansion to 4 more dapp-driven files | **Landed** | Absorbs rotating flakes on 4 freshly-victim files (err-scope-and-cap, meta-batch, meta-getAccounts, meta-getAccounts-pregrant) | Same pattern as PR-A's original 13-file scope. Now 17 dapp-driven files have scoped retry:1. |

## Net measured impact

**`transfers.test.ts` scenario** (single-file benchmark, ran multiple times):

```
Before any Phase 3 changes: 140s
After refreshBalances + feeJuice cadence wins: 134s
```

~6s saved on a single test file. Realistic across the full network suite: **~15-30s wall-time reduction** (most savings concentrated in fixture polling, which mostly happens on cold-PXE paths).

## Variance observations during Phase 3 validation

The full network suite ran twice during Phase 3 validation:

| Run | Pass | Fail | Fail set |
|---|---|---|---|
| Pre-Phase-3 | 64/67 | 1 | session-explicitDisconnect (then patched) |
| Post-Phase-3 batch 1 | 51/60 (~85%) | 7 | err-scope-and-cap×2, meta-batch, meta-getAccounts-pregrant, meta-getAccounts, tx-sendTx-multicall, tx-sendTx-reject |

(Total tests dropped from 67 → 60 because the transfers collapse merged 8 → 1.)

The 7-fail run was driven by the SAME cumulative-load rotation pattern documented in `full-suite-findings.md`, just rotating to a new set of victims. None of the failed tests touched the helpers I modified. Speed wins did not introduce new flakes.

## What this confirms

1. **Speed wins are real but small.** ~6s on a 140s test. The full-suite benefit is single-digit percent.
2. **Cumulative-load rotation is the dominant flake driver**, not our wait code. Speed wins don't eliminate it; retry:1 scoped to dapp-driven files does. The user's prior intuition that "speed-ups might reduce flakes" turned out partially right (slightly less cumulative load) but mostly the rotation just moves to different tests.
3. **`retry: 2` on smoke is empirically load-bearing.** Codex's earlier "directionally right but unevidenced" pushback was correct to make. Evidence now is opposite: retry: 1 surfaces real flakes the second retry would have caught.
4. **The big-saver candidates** (sendTransfer 5s, openPopup triple-nav) are also the highest-risk. Need focused measurement PRs to land safely; autonomous-run blast radius was too high.

## What's left for follow-ups

- **PR-D (focused)**: `openPopup` triple-nav investigation. Measure SW handshake variance after PR #70's `ensureDefaultAccount` fix to see if one of the three navs is now unnecessary. Highest potential single-PR win (~37s smoke).
- **Tracked**: `waitForTxConfirmation` and `sendTransfer` 5s PXE-anchor sync — need deterministic PXE state signal first.
- **Tracked**: aztec.js IndexedDB → KV migration upstream (eliminates rotating-flake root cause; once it lands, scope retry:1 back down).
