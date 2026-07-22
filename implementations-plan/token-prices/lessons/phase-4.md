# Phase 4 — Fees live rate (D2 + missed surfaces): lessons

## Shipped

- `utils/fee-estimation.ts`: `FEE_JUICE_USD_RATE`/`FEE_JUICE_PRICING` (the
  hardcoded 0.02 "for privacy" stub) REMOVED. `feeToUsd(amount, pricing)` has
  no default and returns `string | null`; `feeJuicePricingFromUsd(usd?)`
  builds live pricing from the AZTEC quote; `buildFeeEstimate` takes optional
  pricing. `FeeEstimate.maxFeeUsd: string | null`.
- Executors (`transfer-executor`, `dapp-send-executor`): new
  `getFeeJuicePricing()` dep — wired in `ExecutionService.init` to
  `PriceService.getUsableQuote("aztec")` (cache-or-nothing: NEVER fetches at
  estimate time — transaction-timing privacy per the final codex pass).
- Wire type `packages/wallet-bridge/src/fee.ts` `TransferFeeEstimate.maxFeeUsd`
  widened to `string | null` (dApp-visible; consumers omit rather than fake).
- `tx/[id].vue`: fee + estimated-fee USD priced at TODAY'S AZTEC rate via
  `usePrices`; `TxFeeRow` aux hidden when null + `title="At today's AZTEC
  price"` (testid `tx-fee-usd`).
- `FeeCostReadout`: now renders the (finally real) `estimate.usd` aux with the
  same spot-rate title (testid `fee-estimate-usd`).
- `GasBalanceCard`: `≈ $x.xx` under non-zero FJ balances (testids
  `gas-fiat-public`/`gas-fiat-private`), only with a usable quote.
- `FeeJuiceCard` (dead placeholder composite, mounted nowhere): fake `$0.00` →
  honest `—`; its pin test updated.

## Gotchas

- The execution composition harness + 4 executor test files needed the new
  dep faked (`getFeeJuicePricing: async () => undefined` / a PriceService svc
  stub) — missing-service errors surfaced exactly where expected.
- `$0.00` sweep: only remaining literal is `AmountCard.vue`'s `~ $0.00` stub —
  that IS Phase 5's surface.

## Gate result

- `bun run lint` → 0 errors ✓ · `bun run typecheck` → clean ✓
- `bun run test:components` → 35 files / 367 ✓
- `bun run test` → 278 files / 3304 ✓ (new: 6 fee-estimation + 3 GasBalanceCard)
