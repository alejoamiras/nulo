# Phase 5 — Send flow fiat input (C3): lessons

## Shipped — the full quote-consistency policy

- `AmountCard.vue`: fiat/token input toggle (testid `send-amount-fiat-toggle`,
  offered ONLY for priced tokens). Entering fiat mode FREEZES the session quote
  (`fiatGuard` model: `{ frozenUsd, frozenAt, converting }`); typed dollars
  derive token units through `usdToTokenAmount` (bigint, round-DOWN) after a
  250ms debounce with a skeleton on the secondary line (`send-amount-converting`
  → `send-amount-derived`). The derived token amount IS `model` — the exact
  string the page validates and integerizes: what you see is what sends.
  Token-mode conversion line is live and proxy-labeled (`≈ $124.98 via USDC`,
  testid `send-amount-fiat-label`); the old `~ $0.00` stub is gone ("Price
  unavailable" + tooltip when quoteless). Fiat-mode Max/Half are bigint-exact
  from the new `balanceRawByType` prop (token-mode Number paths preserved
  verbatim). `refreezeQuote()` exposed for the page's re-confirmation flow.
- `send.vue` (owns `handleSend` — the gate lives where submit lives):
  `fiatQuoteBlocked` fails closed — no guard, conversion pending, NO current
  usable quote, or live-vs-frozen drift > 1% all block `isAllowedToSend`.
  Drift/staleness surfaces the requote notice (testid `send-fiat-requote`):
  "Refresh quote" re-freezes at the current quote and re-derives, so the user
  sees the NEW token amount before confirming.
- `price-map.ts`: `proxyTickerFor()` (usd-coin → USDC, aztec → AZTEC).

## Gotchas

- L3 layer rules ban `@/wallet/services/*/client` — AmountCard imports the pure
  `price/convert` helpers instead (allowed); the CLIENT lives in `send.vue`.
- Round-down check: $125 at $0.999857 → 125.017877 (raw×rate ≤ typed dollars
  verified in-test); my first hand-computed expectation was wrong, the helper
  was right.
- The old `renders the conversion line with placeholder dollar amount` pin
  test asserted the fake `$0.00` — replaced with the no-fake-numbers pin.

## Gate result

- `bun run lint` → 0 errors ✓ · `bun run typecheck` → clean ✓
- `bun run test:components` → 35 files / 378 ✓ (11 new C3 cases)
- `bun run test` → 278 files / 3315 ✓
