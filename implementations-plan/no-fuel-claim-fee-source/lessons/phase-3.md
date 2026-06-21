# Phase 3 — live primitive proof + wiring assertion

## What shipped
- `fuel-testnet.ts`: a `NOFUEL_SPEND_RUNS`-gated variant (default 0). Each run:
  1. Seeds the PrivateFPC with private FJ via a PUBLIC-token + private-FPC-fuel bridge (`runVariant(false, …, true)`) — `mint_and_pay_fee` credits the remainder to `from`'s FPC balance.
  2. Reads `PrivateFPC.balance_of(from)` → asserts `B > 0`.
  3. Sends a 1-unit `transfer_public_to_public` self-transfer paying via `privateFeeJuicePayment(fpcAddr)` (`FPCFeePaymentMethod.pay_fee`), re-priced per attempt (`predictedWorstMinFees × RELIABILITY_PAD`).
  4. Reads `balance_of` again → asserts it DECREASED.
- `MINT` now scales with `2 + PRIVATE_RUNS + NOFUEL_SPEND_RUNS` (moved the env reads up).

## Live result (V5, PROVEN — exit 0, 21.7m)
```
PUBLIC fuel claim SETTLED (4.1m)                         ← harness sanity
PUBLIC+FPC-fuel SEED claim SETTLED (21.3m)               ← credits the FPC
NO-FUEL-SPEND: FPC private FJ before = 295.135948 FJ      ← balance_of read works
OK NO-FUEL-SPEND run 1: tx self-paid from EXISTING private FJ via pay_fee on V5
  (FPC 295135948156049300685 -> 292842481565467243045, spent 2293466590582057640) (21.7m)
```
- The `pay_fee` spend cost **2.293 FJ** — same ballpark as the seed claim's actual fee (2.726 FJ) / getFeeLimit ceiling (4.13 FJ), so the no-refund overpay is modest and the conservative pre-flight `NO_FUEL_CLAIM_GAS_BOUND` (≈ live × 2M l2Gas) comfortably covers it.
- This is the EXACT primitive the faucet's no-fuel claim uses: read `PrivateFPC.balance_of`, then pay a tx from that balance via `pay_fee`. The faucet→extension-wallet wiring is the manual-UI proof (the user ran the full private claim live) + the documented e2e follow-up.

## Wiring assertion — documented follow-up (not a new test), justified
A *meaningful* dApp-supplied-`FPCFeePaymentMethod` SETTLEMENT e2e needs the test account's PrivateFPC internal balance pre-funded — exactly the fixture the **already-skipped** `fee-methods.test.ts:154` provides (cluster A+B, `network-test-triage`). A non-settlement version would only duplicate `tx-sendTx-feePayer.test.ts`'s address-agnostic routing assertion (`feePayer !== undefined → embedded`). So rather than add a third near-duplicate / non-functional skipped test, the dApp-supplied settlement e2e is deferred to extend that skipped test once cluster A+B is unblocked. Consistent with codex's "skipIf/manual, not hard-gate," refined for proportionality.

## Gate (achieved)
- `NOFUEL_SPEND_RUNS=1 PRIVATE_RUNS=0 bun --env-file=packages/bridge-core/.env packages/bridge-core/scripts/fuel-testnet.ts` → exit 0, `OK NO-FUEL-SPEND run 1` printed, FPC balance dropped by the real fee.
- `bun run --cwd packages/bridge-core typecheck` clean; `bun run lint` exit 0.

`LESSONS_FILE=implementations-plan/no-fuel-claim-fee-source/lessons/phase-3.md`

## Phase 3: ✓ (live pay_fee spend SETTLED on V5; balance_of read + spend + decrease all proven; wiring e2e = follow-up)
