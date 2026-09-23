# Phase 3 — TokenList and the Holdings page

Implemented on the Mac, 2026-09-06 (started while Phase 2's heavy gates ran; nothing here touches
Phase 2's files except `token-order.ts`, see below).

## What changed
- `utils/incoming-dust.ts`: `isAmountAboveDustThreshold` is the export; the receipt name is an
  alias (`toBe` identity test). `decimals` is validated BEFORE any exponent; every bigint op sits
  inside the try. `config.ts` bounds the threshold at 1,000,000 (+ schema tests: 1e308 and 1e6+1
  rejected).
- `utils/token-fold.ts` (`isHiddenHolding`, `foldLabel`), `utils/token-search.ts` (`matchesQuery`).
- `utils/token-order.ts`: `isUnknownRow` now also rejects an out-of-range `decimals`, so the
  classifier and `TokenCard` agree on what "malformed" means (found by the TokenList test that mounts
  the REAL card: a `decimals: 500` row was `held-unpriced` to the comparator but a dash to the card).
- `TokenCard.vue`: amount/split/fiat parse through `parseRawBalance` / `isValidDecimals`; a malformed
  row renders `—` (`data-malformed`) with no split; symbol and subtitle get `max-width` + ellipsis.
- `modules/holdings/TokenList.vue` (TS): native `<input data-testid="holdings-search">`, `BY VALUE` /
  `A–Z` sort, pinned partition + `token-list-divider`, `holdings-fold` with `show`/`hide`, the existing
  `ListStatusMessage no-results`. Row callbacks take `any` at the prop boundary (biome-ignored, one
  line) so a `FiatOf<TokenBalanceInfo>` fits without a cast.
- `pages/holdings.vue` (TS): `useEntityCrud` incremental with a chain + account `accept`, `forChain`
  on the fetch, `onConnected` resnapshot, one scope watch with `refresh({ clear: true })`, price +
  config clients, `holdings-summary` (fiat total or nothing under the kill-switch, `N tokens`,
  `priced assets only`), `LoadingState`, `holdings-error`.
- `settings/appearance.vue`: "Hide dust" / "Hide receipts and holdings below this value. 0 turns it off."
- E2E: `deployTestToken(…, symbol, name)` gains distinguishable symbols; new
  `deployExtraTokensForAccount(config, account, [{symbol, amount}])` deploys + mints with the sandbox
  minter; `network/home-cap.test.ts` (four tokens, seeded quote → `BIG,TST,MID` on Home, count 4,
  View all → Holdings) and `network/holdings.test.ts` (RICH + EMPTY: value order, real balances, the
  `1 empty` fold, expand, search hit/miss, sort toggle).

## E2E notes
- First run of both new network specs failed for the same reason: they asserted on rows the balance
  projector had not finished yet (Holdings read a count of 2 with EMPTY still projecting; Home-cap
  stalled in `importToken`'s 60s wait for the import button under three back-to-back imports). The
  fix is the fixture's own discipline: after every `importToken`, `captureBalanceBaseline` +
  `waitForFreshBalanceRow` with the exact expected raw balance (0 for the never-minted EMPTY), and
  only then seed the quote, reload and assert. `waitForToast` is a substring match, so the
  "Token added — balance will appear in a moment" variant already satisfies it.

## Test notes
- `TokenList.test.ts` mounts the real `TokenCard` on purpose; it is what caught the classifier /
  card disagreement above. `holdings.test.ts` (unit) pins the foreign-chain row exclusion and the
  error line.
- `Flex align` has no `baseline` value in the design primitive (`end` used).
- Biome reflowed five new test files; format new files before `bun run lint`.
