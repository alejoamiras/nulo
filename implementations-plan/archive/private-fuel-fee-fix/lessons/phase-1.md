# Phase 1 — Reliable, pinned fee cap for the embedded fuel claim (wallet)

## What shipped
`finalizeGasLimits` (`fee-strategy.ts:159-172`): added an `embeddedFeePayment`-gated branch. When an embedded-FPC payment has no explicit `customLimits.maxFeesPerGas`, **reuse `txRequest.txContext.gasSettings.maxFeesPerGas`** (the value `applyEmbeddedFpcGasCap` already committed pre-sim) instead of refetching `getCurrentMinFees()` post-sim. This kills the drift: the FPC budget is now reasoned against exactly the committed ceiling. Non-embedded paths are untouched (still refetch × the general multiplier).

The plumbing that makes the headroom work (verified, no code change needed): `operation-planner.ts:213` + `dapp-send-executor.ts:494` thread `opts.fee.gasSettings.maxFeesPerGas` → `FeeOptions.maxFeesPerGas`, and `applyEmbeddedFpcGasCap` honors an explicit `fee.maxFeesPerGas`. So a dApp (the faucet's private claim) that passes an explicit predicted-worst `maxFeesPerGas` gets it committed verbatim — the headroom is scoped to that claim, not the general embedded cap.

## Validation results (gate PASSED)
- `bun run --cwd packages/extension test -- fee`: **143 passed** incl. 3 new `fee-structural-parity` cases: (i) embedded + no explicit → reuses the committed cap (DRIFT_NODE returns 999/1111; committed stays 555/666 — proves no refetch); (ii) embedded + explicit customLimits.maxFeesPerGas → commits exactly that (predicted-worst headroom path); (iii) NON-embedded + no explicit → still refetches 999/1111 × 2 = 1998/2222 (proves the fix is embedded-gated, general default preserved).
- `bun run --cwd packages/extension typecheck`: exit 0.
- `bun run lint`: exit 0 (after biome wrapped the long test calls).

## Deferred to Phase 2 (where they're live-exercised)
The predicted-worst `maxFeesPerGas` SOURCE — `useDeposit.ts` (faucet UI) + `fuel-testnet.ts` (calibration script) computing `getPredictedMinFees()`-worst and passing it explicitly — lands in Phase 2, because its only meaningful validation is the live private claim settling on V5 (a unit test can't prove inclusion-safety). Phase 1 is the self-contained wallet drift fix + the plumbing capability that honors explicit fees.

`LESSONS_FILE=implementations-plan/private-fuel-fee-fix/lessons/phase-1.md`

## Phase 1: ✓ (extension fee unit 143 green incl. 3 drift-fix cases + typecheck 0 + lint 0)
