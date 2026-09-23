# Phase 8 — Playwright scaffold, L1 shim, first cell, agent runner

The scaffold (`playwright.config.ts`, `global-setup.ts`, the fixtures, the page objects, `agent.sh` with
`reap`) landed during the spike; this phase is the first cell driven through it end to end and what
that cell found.

## The finding: the FPC ceiling is the wallet's, not the app's

Cell 1 (plain wallet, public USDC, one credit note of 1.4× the ceiling the app showed) passed the
amount-step gate, made its irreversible L1 deposit, and then the claim's simulation failed inside the
PrivateFPC with `Balance too low`. The same claim through the harness's Node wallet deducts exactly
the shown ceiling. Cross-PXE note discovery was ruled out first (a probe minted credit through one
`EmbeddedWallet` and spent it through another, exactly the ceiling).

The cause is the transport. The FPC keeps `gasLimits · maxFeesPerGas` of the transaction it pays
for; tools priced that from `predictedWorstMinFees`. But the wallet-sdk option schema
(`GasSettingsOptionSchema`, aztec.js 5.2.0) names the cap `maxFeePerGas` while the wallets read
`maxFeesPerGas`, so a stock `BaseWallet` never sees a dApp's cap and prices it itself:
`getMinFees(Limit) × (1 + minFeePadding)`, padding 0.5. Every stock wallet keeps 1.5× what tools
showed; credit between 1× and 1.5× strands a deposit. Nulo's extension is the exception — its
embedded FPC strategy honors an explicit cap at multiplier 1 — which is why the bug never showed.

## Consult (codex, GPT-6 Astra, `high`, two rounds — plan § Autonomy)

- Round 1 verdict: **fail closed** when the wallet cannot commit to a fee budget; a multiplier
  (assume 1.5×) or a simulation-derived estimate is not a commitment; the durable fix is wallet-side
  (a documented, enforced cap the wallet advertises). Corrections accepted: the simulation result
  DOES carry the applied gas settings (`publicInputs.constants.txContext.gasSettings`); stock fees
  are not exactly 1.5× componentwise; Nulo honors explicit caps at 1×.
- Pushback: the wallet packages are out of this plan's scope, so a feature flag Nulo advertises
  cannot ship here; fail-closed-for-all would regress Nulo's main path on merge.
- Round 2 verdict: **price from the wallet** (B) with fail-closed on "cannot price", accepted for
  this scope; probe with a real no-op (an empty payload has no usable result); the flag + the
  extension advertising it stays the owner's follow-up (MORNING.md).

## What changed in tools

- `src/lib/wallet-fee-budget.ts`: `walletMaxFees(aztec, account, limits)` simulates a public authwit
  revocation of a random hash under the app's limits (`skipTxValidation`, `skipFeeEnforcement`) and
  reads back the max fees the wallet applied; cached 30 s per account; the network's per-tx gas
  limits are read once and every fee the app names is clamped to them (`clampGas`). A wallet with no
  `simulateTx` (a scripted stand-in) is priced from the node's prediction; a wallet that cannot
  simulate leaves the ceiling unpriced.
- Every held-credit ceiling prices from it: `ownGasFee`, `privateCreditFee`, `privateFpcFee`
  (`deposit-flow.ts`), `privateExitFee` (`useHubExit.ts`), and the private slice ceilings
  (`useGasShare` takes the wallet + account; the wizard invalidates its price on an account change).
  An unpriced wallet stops with "Your wallet could not price this transaction's fee ceiling".
- The fee objects carry the cap in BOTH spellings (`maxFeesPerGas`, `maxFeePerGas`) so a wallet that
  reads either gets it.
- The standalone fuel claim (`fuelClaim.ts`, a gas-only deposit's own claim) declared `daGas: 100_000`
  unclamped and priced from the prediction too: cell 19 (private gas-only) failed at submission with
  `Declared DA gas limit (100000) exceeds the maximum this network allows per tx (55882)` — a stock
  wallet refuses limits above the node's per-tx admission limit, which a local network sets far
  below testnet's. Both its builders now clamp and price from the wallet; the same `clampGas` guards
  every fee the app names.

## What the suite asserts

Per the consult: the exact deduction is the wallet's figure — `tests/browser/pages/fees.ts`
`walletCeiling(actor, shape)` runs the same probe through the harness's scripting wallet (the same
`EmbeddedWallet` class on the same node) — never a multiple of tools' prediction. Fixtures are sized
from it. The books themselves are proved against the wallet's own submissions (`keptFor`, the hash the
journal recorded → the fee limit the wallet handed to the node): the chain's fees move between a
fixture's pricing and a send (`lessons/phase-9.md` § Delivery, cell 1).

## Gate

`bun run e2e:tools` on a fresh sandbox at retry 0 (2026-09-09, `669de738`): **51 passed (44.0m)**,
`EXIT=0`, 2,755 s wall clock — cell 1 (`connect-and-deposit.spec.ts`) green with its credit funded
to the wallet's ceiling exactly. The egress fixture asserts an empty blocked-request record at every
test's teardown (`fixtures/test.ts`, "every request stayed on loopback"), so the 51 passes are 51
zero-egress runs; both frames' isolation is the spike's first cell (44, "isolation in both frames",
16.2 s). `bun run e2e:tools:reap` after the runs: `[e2e:tools] nothing to reap`, and the port registry holds no rows.
