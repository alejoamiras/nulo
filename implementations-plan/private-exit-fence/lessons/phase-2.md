# Phase 2 — the exit canary: `PRIVATE_HUB_EXIT_GAS` measured

Owner direction (2026-09-06): "execute (1)" — replace the provisional exit limit (the claim's limits
reused, PR #554) with a measured one. Method: extend `packages/bridge-core/scripts/deploy-sandbox.ts
--smoke` so the private exit pays the way the app pays it — the PrivateFPC's `pay_fee` from held
credit — and report what it billed. Worktree `private-exit-gas-canary`.

## What the smoke does now

- **The actor is the account shape the extension deploys**: a constructor-based Schnorr account
  under Nulo's key derivation (`deriveNuloAccountKeys`), sponsor-deployed through
  `deployAccountIfAbsent`, deterministic (fixed sandbox secret + salt) so a `--keep` re-attach finds
  the deployer that owns the generation. The genesis accounts are initializerless — a different
  entrypoint — and only the relayer still comes from them.
- **(d) private gas → one PrivateFPC credit note**: bridges Fee Juice through the router's direct
  fee-asset lane with `fuelRecipient = PRIVATE_FPC_ADDRESS` and the claimer-bound secret, then
  `FeeJuice.claim(fpc, amount, secret, leaf)` and `PrivateFPC.mint(amount, salt, leaf)`. One note of
  1.4× the exit's ceiling.
- **(e) private exit paid from one credit note**: `exit_to_l1_private` with
  `privateFeeJuicePayment(FPC)` under `PRIVATE_HUB_EXIT_GAS` at `predictedWorstMinFees` (the app's
  `privateExitFee` shape, limits clamped to the node's `txsLimits.gas`), simulated first with
  `includeMetadata` (new `simulateHubExit` in `hub-l2.ts`), the credit read before and after.
- **(d) two more notes of 0.45× the ceiling** beside the first exit's ≈0.4× change: no note and no
  pair covers a ceiling, so the next `pay_fee` must select all three — past the two the FPC reads
  first, into its recursion.
- **(e) private exit paid across three credit notes**: the same exit, the multi-note shape.
- **The sample fails closed**: missing simulated gas, landed fee or block prices throws; so does a
  landed fee that is not `billedGas.computeFee(blockFees)`, or a deduction that is not the ceiling.
  The report prints one line per exit. The sponsored private exit is gone: the app never names it.

## Runs

| run | outcome | lesson |
|---|---|---|
| 1 | `ENOENT …/contracts/bridge/evm/out/MockSwapTarget.sol/MockSwapTarget.json` before the smoke | A fresh worktree has no forge `lib/` or `out/` (both gitignored). Install the libs, `bun scripts/gen-remappings.ts` from bridge-core, `forge build`. Now in bridge-core's README row for `deploy:sandbox`. |
| 2 | `(d) private gas` — `Nullifier read request at index 0 is reading an unknown nullifier` from `PrivateFPC.mint` | `mint` does not consume the L1→L2 message: it PROVES a prior `FeeJuice.claim` by reading that claim's nullifier (package README, "two-step flow"). `mint_and_pay_fee` is the one-transaction form. The flow claims first now. The same error text on a first private bridge in production has a different cause (the wrong-account clobber, `self-pay-setup-fix`). |
| 3 | `(e) private exit` — `Declared DA gas limit (100000) exceeds the maximum this network allows per tx (55882)` | The wallet-sdk's `assertGasLimitsWithinNetworkLimits` refuses any declared limit above the node's `txsLimits.gas`. Testnet admits 117,668 DA; this local network 55,882. The smoke clamps its declared limits to the node's maximum and reports them beside the constant; the app's claim constants keep testnet's 100,000 — a target network admitting less would refuse the claims outright. |
| 4 | all 16 flows green, 7.0 min; genesis actor, one note | first reading (below) |
| 5 | all 18 flows green; Schnorr actor, one-note and three-note exits | the readings below; codex round 1's two measurement gaps closed |

## The readings (aztec 5.2.0 local network, PrivateFPC 5.0.1; every landed fee equals the simulated billed gas at its block's `feePerL2Gas` 10,200,000, `feePerDaGas` 0; every deduction equals the ceiling)

| exit | actor | billed L2 gas | billed DA gas |
|---|---|---|---|
| one credit note (run 4) | genesis, initializerless | 826,543 | 1,696 |
| one credit note (run 5) | Nulo-derivation Schnorr, constructor-based | 826,543 | 1,696 |
| three credit notes (run 5) | Nulo-derivation Schnorr | 888,143 | 1,760 |

- The account artifact does not move the bill: identical to the gas unit. The testnet claim
  measurement (909,600, through the extension) and these sandbox exits are therefore comparable.
- Each further note `pay_fee` selects costs ≈30,800 L2 gas and ≈32 DA gas (two extra notes: +61,600
  / +64). The exit is 9% lighter than the claim (claim_private + `FeeJuice.claim` +
  `mint_and_pay_fee`).
- "Charged = ceiling" is now asserted on every run — the first direct proof of the no-refund rule
  every ceiling comment in `private-fuel.ts` relies on. The FPC deducts `getFeeLimit`, never the fee.

## The constant

`PRIVATE_HUB_EXIT_GAS = { daGas: 50_000, l2Gas: 1_900_000 }` (was `= PRIVATE_HUB_CLAIM_GAS`,
`{ 100_000, 2_000_000 }`):

- **L2 1,900,000**: 2.3× the one-note reading, 2.14× the three-note one; the ≈1,010,000 above the
  three-note bill covers some thirty-five further notes at ≈30,800 each — the shape an account that
  keeps bridging accumulates (each claim's leftover is a note).
- **DA 50,000**: 28× the three-note bill; sits under the 55,882 a local network admits, so the smoke's
  clamp is a no-op. The claim's 100,000 DA was never a measurement (its comment says DA fee 0).
- What it costs the user at testnet's 2026-09 `feePerL2Gas` ≈ 1.96e12: ≈3.7 FJ set aside per private
  exit, of which ≈1.6–1.7 FJ is the fee and the rest forfeited (was ≈3.9 FJ set aside).

Test pins moved with it: `useHubExit.test.ts` `EXIT_CEILING` 41,000,000 → 38,500,000 (mocked fees
10/20) and the `gasLimits` expectation.

## Codex (`/codex high`, read-only, session `01a07857-a137-7721-aa45-0f577cba314c`)

Round 1 over `36444483`: **request changes** — MED the one-note reading does not bound `pay_fee`'s
recursion (adopted: the three-note exit, run 5); MED the genesis actor is not Nulo's account shape
(adopted: the Schnorr actor, run 5 — and the bill turned out identical); MED the sample zero-filled
missing evidence and asserted neither equality (adopted: fails closed, both asserted); LOW the
"clamp changes nothing" and "whole data footprint" wording overstated, 1,696 is simulated DA at a
zero DA price (adopted: reworded in `deploy-sandbox.ts` and `private-fuel.ts`). Fine: same FPC,
`pay_fee`, burn intent, exit arguments, zero teardown; `includeMetadata` beside witnesses and fee is
supported; held credit implies a prior transaction, so first-ever initialization is outside this
shape; no fence weakened.

## Follow-ups (not in this arc)

- **Per-network admission limits.** `assertGasLimitsWithinNetworkLimits` is a hard refusal. The
  claim constants assume a network admitting ≥ 100,000 DA (true of testnet, not of a local network).
  If a target network ever admits less, the app has to read `txsLimits.gas` and clamp (as the smoke
  does) or size per network; today it would refuse with the wallet-sdk's message and no bridge-side
  explanation.
- **Deep fragmentation.** Thirty-five notes of headroom is a projection from two points; an account
  that has bridged that many times without an exit is the case to measure before trusting it.
