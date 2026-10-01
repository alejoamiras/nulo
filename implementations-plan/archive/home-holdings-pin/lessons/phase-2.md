# Phase 2 — Home order, cap, "View all", aggregate-only hero

Implemented on the Mac, 2026-09-06.

## What changed
- `src/utils/token-amount.ts`: `parseRawBalance`, `isValidDecimals` (0..77), `safeFiatOf` — the one
  place row numbers are parsed. `token-order.ts`: classes (`pinned` decided before any number is
  read; `unknown` for malformed rows), `compareTokenRows`, `orderTokenRows` (copy), `capTokenRows`,
  `forChain`, `HOME_TOKEN_ROWS = 3`. `token-aggregate.ts`: `aggregateFiat` lifted from BalanceView;
  a malformed row is an unpriced holding → partial.
- `TokensView.vue`: a `PriceServiceClient` + `usePrices` (disposed after the service disconnects),
  `forChain` on the fetch AND `onBalanceAdded`, order + cap, header **HOLDINGS** + count, `View all`
  (`tokens-view-all`) when rows overflow. Pins are an empty set until Arc C. The alphabetical
  in-place `.sort` is gone.
- `BalanceView.vue`: Home hero is the aggregate over the active chain (`forChain` on fetch, chain
  check on `onBalanceAdded`); the token hero comes only from the `tokenBalance` prop; the display
  option, its storage load/save, three watchers, the `TokenServiceClient` and the popup/cache stores
  are gone. `SelectBalanceTypePopup.vue` deleted; `PopupManager` and `app.store` (+ the shape-pin
  test) drop `displayOption`.
- `helpers.ts`: `navigateToTokenDetail(page, symbol?)`. Every existing caller and direct
  `tokens-card` selector sits in a one-token fixture (the sandbox TST), so none needed the symbol.
- Generated `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` picked up the new util
  exports (`HOME_TOKEN_ROWS`, `MAX_DECIMALS`, …) on build — committed with the phase.

## Gate notes
- **The smoke gate must be ARMED.** `bun run build && bun run test:e2e` fails three specs by
  design: `backup-migration.test.ts`'s fixture-arming contract asserts `NULO_E2E_MIGRATION_FIXTURE=1`
  on a repo-build run, and the two imported-account specs fail under the same unarmed build. CI
  (`_smoke-e2e.yml:69-105`) builds with `VITE_NULO_E2E_MIGRATION_FIXTURE=1` and runs with
  `NULO_E2E_MIGRATION_FIXTURE=1`; plan.md's `<smoke>` now says exactly that. First armed run below.
- A `bun run test:e2e` launched as a backgrounded shell command with captured stdout died silently
  (empty output, no vitest process). Long e2e runs go in tmux with a log file, on this machine too.
- Pre-existing, not ours: `vite-plugin-pages` bundles every `*.test.ts` beside a page as a route
  (`auth.test`, `send-amount.test`, …, and now `holdings.test`). Worth a follow-up exclude in
  `vite.config.ts`; out of this plan's scope.

## Test notes
- `TokensView.test.ts` needed the price-client mock (the composable calls `refreshIfStale()` at
  construction). The "priced first" case uses the mainnet cUSD contract on `CHAIN_IDS.MAINNET`
  because the price map is keyed by (chainId, contract) and only the seeded ids are priced.
- `BalanceView.test.ts` rewritten: six aggregate cases (incl. a same-address foreign-chain row not
  counted, and a deletion keeping the list consistent) and three token-hero cases via the prop.
- Biome's formatter reflowed three test files; run `bunx biome format --write` on new files before
  `bun run lint` to avoid the churn.
