# Phase 3 — Header + token rows fiat (A1 + B1): lessons

## Shipped

- `composables/usePrices.ts` — C1 composable (client injected by parent):
  ticker-reactive (30s) staleness on top of the spec's `isQuoteFresh`, price-map
  resolution (`quoteFor`, `feeJuiceQuote`), bigint fiat math (`tokenFiatMicro`,
  `tokenFiatLabel`), `dispose()` for the parent's unmount slot.
- `BalanceView.vue` (A1): `≈ $x.xx` secondary line under the token amount
  (testid `balance-fiat`); "Account Value"/private/public options now render the
  REAL aggregate Σ balance×price over priced tokens, `—` when nothing is priced
  (the hardcoded `$0.00` is gone), `priced assets only` label when partial
  (testid `balance-fiat-partial`).
- `TokenCard.vue` (B1): holding fiat line between amount and split (testid
  `token-fiat`), absent when unpriced.
- `SelectBalanceTypePopup.vue`: all three fake `$0.00`s replaced with real
  per-option aggregates (`—` fallback; testid `balance-type-aggregate`).

## Gotchas

- **Composables are NOT auto-imported here** (despite older docs wording) — the
  repo convention is explicit imports (`useToast` etc.). `usePrices` is imported
  explicitly in all three components; the composable itself imports
  `ref`/`computed`/`useTicker` explicitly too.
- `useTicker` keeps a SHARED per-period registry; a test that mounts hosts
  without unmounting leaks a real-timer interval into later fake-timer tests.
  `usePrices.test.ts` unmounts hosts in `afterEach`.
- `useTicker`'s ref is `number | undefined` typed — guarded with `?? Date.now()`.

## Gate result

- `bun run lint` → 0 errors ✓
- `bun run typecheck` → clean ✓
- `bun run test:components` → 35 files / 367 ✓
- `bun run test` → 276 files / 3295 ✓ (new: 11 usePrices + 3 TokenCard B1 + 5 BalanceView A1 cases)
