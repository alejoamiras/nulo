# Phase 2 — the exit canary: `PRIVATE_HUB_EXIT_GAS` measured

Owner direction (2026-09-06): "execute (1)" — replace the provisional exit limit (the claim's limits
reused, PR #554) with a measured one. Method: extend `packages/bridge-core/scripts/deploy-sandbox.ts
--smoke` so the private exit pays the way the app pays it — the PrivateFPC's `pay_fee` from held
credit — and report what it billed. Worktree `private-exit-gas-canary`.

## What the smoke does now

- New flow **(d) private gas → PrivateFPC credit**: bridges Fee Juice through the router's direct
  fee-asset lane with `fuelRecipient = PRIVATE_FPC_ADDRESS` and the claimer-bound secret, then
  `FeeJuice.claim(fpc, amount, secret, leaf)` and `PrivateFPC.mint(amount, salt, leaf)`.
- **(e) private exit** now sends `exit_to_l1_private` with `privateFeeJuicePayment(FPC)` under
  `PRIVATE_HUB_EXIT_GAS` at `predictedWorstMinFees` (the app's `privateExitFee` shape), reads the
  credit before and after, simulates first with `includeMetadata` (new `simulateHubExit` in
  `hub-l2.ts`) and, after the battery, prints one line: simulated billed gas, the landed fee at its
  block's prices, the credit the FPC kept against the ceiling it was promised.
- The sponsored private exit is gone from the smoke: the app never names that payer.

## Runs

| run | outcome | lesson |
|---|---|---|
| 1 | `ENOENT …/contracts/bridge/evm/out/MockSwapTarget.sol/MockSwapTarget.json` before the smoke | A fresh worktree has no forge `lib/` or `out/` (both gitignored). Install the libs, `bun scripts/gen-remappings.ts` from bridge-core, `forge build`. Now in bridge-core's README row for `deploy:sandbox`. |
| 2 | `(d) private gas` — `Nullifier read request at index 0 is reading an unknown nullifier` from `PrivateFPC.mint` | `mint` does not consume the L1→L2 message: it PROVES a prior `FeeJuice.claim` by reading that claim's nullifier (package README, "two-step flow"). `mint_and_pay_fee` is the one-transaction form. The flow claims first now. The same error text on a first private bridge in production is a different cause (the wrong-account clobber, `self-pay-setup-fix`). |
| 3 | `(e) private exit` — `Declared DA gas limit (100000) exceeds the maximum this network allows per tx (55882)` | The wallet-sdk's `assertGasLimitsWithinNetworkLimits` refuses any declared limit above the node's `txsLimits.gas`. Testnet admits 117,668 DA; this local network 55,882. The smoke clamps its declared limits to the node's maximum (the clamp changes nothing the reading measures); the app's constants keep testnet's headroom — a target network admitting less DA than a constant declares would refuse the exit and the claims outright. |
| 4 | all 16 flows green, 7.0 min | the reading below |

## The reading (run 4, aztec 5.2.0 local network, PrivateFPC 5.0.1, one credit note held)

| quantity | value |
|---|---|
| simulated `billedGas` | l2Gas **826,543**, daGas **1,696** |
| landed `transactionFee` | 8,430,738,600,000 FJ-wei at the block's `feePerL2Gas` 10,200,000 (`feePerDaGas` 0) → **826,543 L2 gas**, equal to the simulation |
| credit charged | 23,030,308,000,000 = the ceiling exactly (declared 2,000,000 L2 × predicted-worst 11,515,154 + 55,882 DA × 0) |
| beside the testnet claim | claim_private + `FeeJuice.claim` + `mint_and_pay_fee` billed 909,600; the exit is 9% lighter |

The "charged = ceiling" row is the first direct proof of the no-refund rule every ceiling comment in
`private-fuel.ts` relies on: the FPC deducts `getFeeLimit`, never the fee.

## The constant

`PRIVATE_HUB_EXIT_GAS = { daGas: 50_000, l2Gas: 1_900_000 }` (was `= PRIVATE_HUB_CLAIM_GAS`,
`{ 100_000, 2_000_000 }`):

- **L2 1,900,000 = 2.3×** the 826,543 billed — the register's ratio, not the claim's 2.2×, because
  this exit selected ONE credit note and `pay_fee`'s note selection grows with the notes an account
  accumulates (each claim's leftover is a note). Unmeasured: an exit over many notes.
- **DA 50,000 = 29×** the 1,696 billed. A burn, an L2→L1 message and the FPC's change note are the
  whole data footprint; it sits under the 55,882 a local network admits, so the smoke no longer
  needs the clamp for DA. The claim's 100,000 DA was never a measurement (its comment says DA fee 0).
- What it costs the user: the ceiling drops from 2,000,000·L2 + 100,000·DA to 1,900,000·L2 +
  50,000·DA at the predicted worst fees; at testnet's 2026-09 `feePerL2Gas` ≈ 1.96e12 that is
  ≈ 3.7 FJ set aside per private exit, of which ≈ 1.6 FJ is the fee and the rest forfeited.

Test pins moved with it: `useHubExit.test.ts` `EXIT_CEILING` 41,000,000 → 38,500,000 (mocked fees
10/20) and the `gasLimits` expectation.

## Follow-ups (not in this arc)

- **Per-network admission limits.** `assertGasLimitsWithinNetworkLimits` is a hard refusal. Every
  `*_HUB_*_GAS` constant assumes a network admitting ≥ 100,000 DA (the claims) — true of testnet,
  not of a local network. If a target network ever admits less, the app has to read `txsLimits.gas`
  and clamp (as the smoke does) or size per network; today it would refuse with the wallet-sdk's
  message and no bridge-side explanation.
- **Multi-note exits.** Measure an exit over an account holding several credit notes before treating
  the 2.3× as generous.
