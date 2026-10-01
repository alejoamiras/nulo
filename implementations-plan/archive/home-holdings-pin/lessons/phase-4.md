# Phase 4 — Send picker order and search

Implemented on the Mac, 2026-09-06 (drafted while Phase 2's armed smoke gate ran).

## What changed
- `popups/SelectTokenPopup.vue`: rows come from `TokenBalanceServiceClient.getTokenBalances`
  through `forChain` (the old picker listed the token service's rows, which are already
  chain-scoped but unordered); one `PriceServiceClient` at setup, `usePrices` created on show and
  disposed on hide BEFORE the client disconnects (the popup stays mounted, so a permanent price
  subscription would outlive every open); `orderTokenRows` with the empty pin set; a native search
  input (`select-token-search`) only past `HOME_TOKEN_ROWS`; `ListStatusMessage no-results`
  (`select-token-no-results`); each `SettingItem` carries `select-token-row` + `data-symbol` +
  `data-selected` (attrs fall through to its single root). Added rows are gated on account AND
  chain; a fetch that resolves after the popup closed is dropped. `send.vue` untouched.
- `send/SelectTokenCard.vue`: `data-testid="send-token-symbol"` on the trigger's symbol span.
- `helpers.ts`: `selectSendToken(page, symbol)`. `network/send-picker.test.ts`: TST + a deployed ALT,
  the picker lists both without a search box, exactly one row selected, choosing ALT updates the
  trigger, choosing TST back through the helper, re-open shows `{TST: true, ALT: false}`.

## Test notes
- `SelectTokenPopup.test.ts` (7 cases): the shared order with a seeded quote, foreign-chain row
  excluded, search visibility at 3 vs 4 rows, filter + no-results, select writes the TOKEN id and
  closes, hide tears down both clients and re-open fetches fresh, live add gated on scope.
- A plain-object `useCacheStore` mock does not re-render `data-selected`; the mock returns
  `reactive(H.cache)` so the write goes through a proxy like the Pinia store does.
- "Pinned first" is not testable here until Arc C wires `usePinnedTokens` into the picker; the
  order helper's own suite covers the class ordering.
