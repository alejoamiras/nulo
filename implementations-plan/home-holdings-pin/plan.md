# home-holdings-pin — Home, a Holdings tab, and "Pin to Home"

- **Tier**: mid (codex + fable dual audit, final fresh codex pass). `code_review: off`. `eli5_mode: artifact`. `driver: claude-code`.
- **Budget**: recon 2 sonnet agents (done, `recon.md`); codex at `high`: 2 plan audits + a post-impl loop of ≤3 rounds per arc + 1 cross-arc pass; fable: 1 plan audit.
- **Worktree**: `home-holdings-pin` / branch `worktree-home-holdings-pin` off `dev@2a3d2d87` (#556). Created on the Mac, pushed, **executed on the homelab** in a fresh session — § Bootstrap is written for that session.
- **Owner decisions (2026-09-06)**: four tabs HOME · HOLDINGS · HISTORY · SETTINGS; Home shows three token rows and a "View all →"; a Holdings page with search, value/name sort, and one fold for empty + under-dust tokens reusing the EXISTING dust setting; "Pin to Home" / "Unpin from Home" in the token page's "⋯" menu, cap 3, a 4th pin opens an informational popup; **no chip, glyph or control on rows**; the Send picker renders the same list; the balance-display popup is retired; no horizontal strip; paste-an-address-to-add is a later plan.
- **Design reference**: the round-4b mockups (interactive, shared pin state) live at the Claude Artifact `https://claude.ai/code/artifact/1b64e873-a804-4262-8818-55d6481b7bef`. Everything a fresh session needs from them is restated in § Scope and § Copy; the artifact is for taste, not for facts.

## Why

Home lists every registered token alphabetically under the hero. With the two seeded tokens that
is fine. With a real Aztec portfolio (bridged assets, test tokens, dust) it breaks in three ways:
value order is lost (a $1,625 ETH row sorts under an unpriced AZTK), the Recent transactions feed
scrolls off the screen, and every "which token?" picker grows linearly. The fix is a Home that
never grows past three rows, a Holdings tab that owns the full list with search, and a small,
explicit way for the user to choose the three rows.

## Scope

In:
1. **Nav**: `Navigation.vue` gets four tabs. The first keeps route name `general` and URL
   `/popup/general` (65 e2e files assert that hash; the manifest cold-opens it; two redirect pages
   and the sub-page-header fallback point at it) and is relabelled **HOME** with the `home` material
   icon. A new second tab **HOLDINGS** (`nav-holdings`, `/popup/holdings`, `account_balance_wallet`).
   HISTORY and SETTINGS unchanged.
2. **Home** (`TokensView.vue`): section header **HOLDINGS** with the token count, the existing "⋯"
   menu untouched (import / manage / contacts / refresh, every `tokens-menu-*` testid preserved), rows
   ordered by one shared comparator (pinned → priced by fiat value desc → unpriced-with-balance by
   name → empty by name), capped at `HOME_TOKEN_ROWS = 3`, plus a "View all →" link
   (`tokens-view-all`) shown only when more tokens exist than fit. In-flight import rows and minting
   rows render above the cap as today. The in-flight tx card stays where RecentActivityView puts it.
3. **Retire the balance-display popup**: `SelectBalanceTypePopup.vue`, its `PopupManager`
   registration, `appStore.displayOption`, and `BalanceView`'s per-token hero mode + the
   `nulo:ui:balanceDisplayOption@` load/save. The Home hero always shows the aggregate over both
   sides; the token page keeps its own hero via the `tokenBalance` prop.
4. **Holdings page** (`pages/holdings.vue`, tab-level, normal app header): aggregate summary
   (`holdings-summary`: fiat total + "N tokens", "priced assets only" when partial), then one
   `TokenList`.
5. **`TokenList`** (new L4 module, presentational, used by Holdings AND the Send picker): sticky
   search (`holdings-search`, symbol/name substring + contract prefix), a section header with the
   count and a value/name sort toggle (`holdings-sort`), pinned rows above a dashed rule
   (`token-list-divider`), the rest in sort order, one fold row (`holdings-fold`) hiding empty and
   under-dust tokens with the label `N hidden · X empty · Y under $T` (or `N empty` when the
   threshold is 0), and the existing `ListStatusMessage variant="no-results"` for a miss. Rows are
   `TokenCard` in link mode (Holdings) or select mode (Send).
6. **Dust**: the Holdings fold reuses `incomingDustUsdThreshold` and the bigint predicate in
   `utils/incoming-dust.ts` through a generic alias; the Settings → Appearance copy widens from
   "receipts" to "receipts and holdings". Pinned tokens never fold.
7. **Send picker**: `SelectTokenPopup.vue`'s body becomes `TokenList` in select mode over the
   account's balances; the selection contract (`cacheStore.activeTokenIdx`, emit close) and the
   "Manage tokens" row are unchanged.
8. **Pins**: `usePinnedTokens` composable owning the key `nulo:ui:pinnedTokens@${profileId}` →
   `Record<networkId, tokenId[]>` (≤ 3 ids) behind the storage facade; `pin(id)` returns `"full"`
   at the cap; `onTokenDeleted` cleanup; per profile + network scope.
9. **Token page menu**: one `DropdownItem` (`token-menu-pin`) reading "Pin to Home" or "Unpin from
   Home". A refused pin opens `PinLimitPopup` (`pin_limit`): "Home is full" / "Home shows up to 3
   pinned tokens. Unpin one of these to pin {symbol}:" / the three pinned symbols / one **Got it**
   button. Nothing changes until the user unpins.
10. **Degenerate case**: with three or fewer tokens, Home shows them all and hides "View all"; a
    two-token wallet looks exactly like today.
11. **Tests**: pure-function unit tests for the comparator, the cap, the fold predicate, the
    aggregate and the pin store; component tests for `TokenList`, `PinLimitPopup`, the token page
    menu states, and the rewritten `BalanceView` cases; smoke e2e for the four tabs; network e2e for
    Holdings rendering real balances, search, and a pin/unpin round trip that survives a popup
    reopen. The cap, the full state and the fold are unit/component-tested with fixtures — e2e never
    needs more than the sandbox's tokens.

Out (deliberately):
- Renaming the Home route or URL; renaming `nav-general`.
- Manual ordering of pinned tokens; any control or mark on rows; bulk toggles on the Manage-tokens
  settings page; a "replace which?" dialog; auto-pinning seeded tokens.
- Paste-an-address-to-add in the Holdings search (agreed direction, next plan). The Holdings page
  has no "⋯" menu in v1; import stays on Home's menu and in Settings → Tokens.
- Backing up the pins key (UI prefs are not backed up today; same treatment).
- Removing orphaned `nulo:ui:balanceDisplayOption@` keys from existing installs (pre-production,
  no migration; the key is simply never read again).
- Showing the balance-refresh dot or in-flight import rows on Holdings (Home keeps them).

## Bootstrap on the homelab (fresh machine, fresh session)

The plan was written on the Mac; the branch is pushed. On the homelab:

```bash
# 1. A zsh LOGIN shell: bun, claude, codex, agent-worktree live in ~/.bun/bin, ~/.local/bin and nvm.
cd ~/Projects/nulo
git fetch origin
git worktree add --track -b worktree-home-holdings-pin \
  .claude/worktrees/home-holdings-pin origin/worktree-home-holdings-pin
cd .claude/worktrees/home-holdings-pin
bun install --frozen-lockfile                        # installs the git hooks too (prepare)
agent-worktree register home-holdings-pin --status "approved: implementing phase 1"
codex login status                                   # must say logged in; the loops need it
gh extension list | grep -q stack || gh extension install github/gh-stack
git config --get commit.gpgsign                      # homelab signs non-interactively: keep it ON
```

Machine facts that matter (from `~/.agents/machine.md` on the homelab): commit signing is
non-interactive (passphrase-less SSH key) so AFK keeps signing; **long jobs must run in tmux**
(`tmux new-session -d -s <name> "<cmd>"`) or they die with the Claude process; `TMPDIR` is
redirected to `~/.cache/tmp`; `/tmp` is tmpfs — never point a sandbox data dir at it. No `.env`
files are needed: unit, smoke and proverless network e2e run from the repo alone (the network
runner stamps its own env).

Start the implementing session **inside the worktree** (`claude` from that directory, or
`agent-worktree resume home-holdings-pin`), paste the `/goal` seed from § Seeds, and keep plan.md
as the source of truth: phases are marked ✓ in this file, lessons go in
`implementations-plan/home-holdings-pin/lessons/phase-N.md`.

## Architecture & Implementation

### Proposed architecture

Five pieces, all inside `apps/extension`; no package boundary moves, no new dependencies.

```
pure helpers (unit-tested, no Vue)
  src/popup/components/modules/holdings/token-order.ts     compareTokenRows, HOME_TOKEN_ROWS, capRows
  src/popup/components/modules/holdings/token-fold.ts      isHiddenHolding (empty | under dust), foldLabel
  src/popup/components/modules/holdings/token-aggregate.ts aggregateFiat (lifted out of BalanceView)
  src/utils/incoming-dust.ts                               + isAmountAboveDustThreshold (alias)

state (C1 composable, unit-tested with a fake client + in-memory storage)
  src/composables/usePinnedTokens.ts                       key, cap, pin/unpin, deletion cleanup, scope

presentation (L4)
  src/popup/components/modules/holdings/TokenList.vue      search · sort · pinned/rule/rest · fold · no-results
  src/popup/components/modules/general/TokenCard.vue       + `mode: "link" | "select"`, `selected`
  src/popup/components/popups/PinLimitPopup.vue            informational popup (TokenMetadataPopup shape)

orchestration (L5/L6)
  src/popup/components/Navigation.vue                      four tabs
  src/popup/pages/holdings.vue                             summary + TokenList
  src/popup/components/modules/general/TokensView.vue      comparator, cap, View all
  src/popup/components/modules/general/BalanceView.vue     aggregate-only hero on Home
  src/popup/components/popups/SelectTokenPopup.vue         TokenList in select mode
  src/popup/pages/tokens/[id].vue                          Pin/Unpin menu item
```

Home keeps `TokensView` as its own orchestrator (its task/journal/sync-state wiring is the expensive
part and stays); Holdings and Send share `TokenList`. All three sort through `compareTokenRows`.

### Key interfaces

```ts
// token-order.ts — pure
export const HOME_TOKEN_ROWS = 3                     // Home's row budget AND the pin cap: one number by design
export type FiatOf = (tb: TokenBalanceInfo) => bigint | undefined   // micro-USD; undefined = unpriced
export type OrderCtx = { pinnedIds: ReadonlySet<number>; fiatOf: FiatOf }
export function compareTokenRows(a: TokenBalanceInfo, b: TokenBalanceInfo, ctx: OrderCtx): number
export function orderTokenRows(rows: TokenBalanceInfo[], ctx: OrderCtx): TokenBalanceInfo[]   // never mutates input
export function capTokenRows<T>(rows: T[], budget = HOME_TOKEN_ROWS): { shown: T[]; overflow: number }

// token-fold.ts — pure
export function isHiddenHolding(tb, p: { pinned: boolean; usdRate: number | undefined; thresholdMicro: bigint }): boolean
export function foldLabel(p: { hidden: number; empty: number; dust: number; thresholdUsd: number }): string

// token-aggregate.ts — pure (the body of BalanceView's `aggregate` computed, lifted)
export function aggregateFiat(rows: TokenBalanceInfo[], fiatOf: FiatOf): { micro: bigint; priced: number; holdings: number; partial: boolean }

// usePinnedTokens.ts — C1; parent owns the TokenServiceClient
export const PINNED_TOKENS_MAX = HOME_TOKEN_ROWS
export function usePinnedTokens(deps: {
  tokenService: Pick<TokenServiceClient, "onTokenDeleted">
  getScope: () => { profileId: string; networkId: string } | undefined
}): {
  pinnedIds: Readonly<Ref<number[]>>       // this scope's list, storage order
  pinnedSet: ComputedRef<ReadonlySet<number>>
  isPinned(id: number): boolean
  pin(id: number): Promise<"pinned" | "full" | "already">
  unpin(id: number): Promise<void>
  refresh(): Promise<void>                  // re-read for the current scope (mount, scope change)
  dispose(): void
}
// storage: key `nulo:ui:pinnedTokens@${profileId}`, value Record<networkId, number[]>
```

`TokenList.vue` props: `rows: TokenBalanceInfo[]`, `pinnedIds: ReadonlySet<number>`, `fiatOf: FiatOf`,
`usdRateOf: (tb) => number | undefined`, `dustThresholdUsd: number`, `mode: "link" | "select"`,
`selectedId?: number`, `showSearch = true`; emits `select(tokenId)`. Internal state: `query`, `sort`
(`"value" | "name"`, default value), `showHidden`. `TokenCard.vue` gains `mode` (default `"link"`,
renders the existing `RouterLink`; `"select"` renders a `<button type="button">` root that emits
`select`) and `selected` (accent left rule + `aria-selected`).

`PinLimitPopup.vue` reads its payload through `popupStore.getPayload("pin_limit")`:
`{ symbol: string; pinnedSymbols: string[] }`.

### Data & control flow

- **Home**: `TokensView` fetches balances as today → `orderTokenRows(rows, { pinnedIds, fiatOf })` →
  `capTokenRows` → renders `shown` with `TokenCard`, plus "View all →" when `overflow > 0`. `fiatOf`
  comes from a `PriceServiceClient` + `usePrices` owned by TokensView (same shape BalanceView uses);
  `pinnedIds` from `usePinnedTokens` (its `TokenServiceClient` is the one TokensView already owns
  for `onTokenDeleted`? — it doesn't own one today; it constructs one, like BalanceView does).
- **Holdings**: `pages/holdings.vue` owns `TokenBalanceServiceClient` + `useEntityCrud` over
  `getTokenBalances(undefined, account.address)` with the three balance events (`mode: "resync"` on
  scope change via `refetch({ clear: true })` from ONE `watch(() => [account.address, network.id])`,
  the TokensView idiom), a `PriceServiceClient` + `usePrices`, a `ConfigServiceClient` for the dust
  threshold (`getValue` + `onUpdate`), and `usePinnedTokens`. It computes the summary with
  `aggregateFiat` and hands everything to `TokenList`.
- **Send**: `SelectTokenPopup` fetches balances for the account on open (today it fetches tokens),
  renders `TokenList mode="select" :selectedId="cacheStore.activeTokenIdx"`, and on `select` sets
  `cacheStore.activeTokenIdx` and emits close — exactly the current contract, so `send.vue`'s
  resolution order (`?tokenId` → `activeTokenIdx` → `tokens[0]`) is untouched.
- **Pin**: token page → `pins.pin(id)` → `"pinned"` (toast "Pinned to Home") | `"full"` →
  `popupStore.open("pin_limit", { symbol, pinnedSymbols })`. `unpin` → toast "Unpinned from Home".
  The menu closes on action (existing behaviour). Home re-reads pins on mount, so navigating back
  shows the new order. Deletion: `onTokenDeleted` → splice + persist.
- **Storage write path**: read-modify-write serialised through a per-instance promise chain;
  values are validated on read (array of finite non-negative integers, de-duplicated, truncated to
  the cap) — storage is treated as hostile input, like the backup importer treats blobs.

### File-level change map

| File | Change |
|---|---|
| `src/popup/components/Navigation.vue` | four entries; `general` relabelled HOME with icon `home`; new `holdings` entry |
| `src/popup/pages/holdings.vue` | **new** page, `{ "meta": { "isAuthRequired": true, "showBottomNav": true } }` |
| `src/popup/components/modules/holdings/token-order.ts` (+ `.test.ts`) | **new** pure comparator, cap |
| `src/popup/components/modules/holdings/token-fold.ts` (+ `.test.ts`) | **new** pure fold predicate + label |
| `src/popup/components/modules/holdings/token-aggregate.ts` (+ `.test.ts`) | **new**, lifted from `BalanceView.vue` L106-126 |
| `src/popup/components/modules/holdings/TokenList.vue` (+ `.test.ts`) | **new** L4 module |
| `src/utils/incoming-dust.ts` (+ test) | export `isAmountAboveDustThreshold`; keep the receipt name as an alias |
| `src/composables/usePinnedTokens.ts` (+ `.test.ts`) | **new** C1 composable |
| `src/popup/constants/storage-keys.ts` | `pinnedTokens(profileId)` key builder next to the existing keys |
| `src/popup/components/modules/general/TokenCard.vue` (+ test) | `mode`, `selected` |
| `src/popup/components/modules/general/TokensView.vue` (+ test) | comparator + cap + View all; header copy; no in-place `.sort` |
| `src/popup/components/modules/general/BalanceView.vue` (+ test) | drop `displayOption`, load/save, watchers; aggregate via `aggregateFiat`; keep `tokenBalance` prop path |
| `src/popup/components/popups/SelectBalanceTypePopup.vue` | **delete** |
| `src/popup/components/popups/PopupManager.vue` | remove `select_balance_type`; add `pin_limit` |
| `src/popup/components/popups/PinLimitPopup.vue` (+ test) | **new**, `TokenMetadataPopup` shape |
| `src/popup/components/popups/SelectTokenPopup.vue` | body → `TokenList mode="select"` |
| `src/popup/pages/tokens/[id].vue` | `token-menu-pin` item; `usePinnedTokens`; toasts; popup |
| `src/stores/app.store.ts` + `app.store.shape.pins.test.ts` | remove `displayOption` from the store and the pinned key list |
| `src/popup/pages/settings/appearance.vue` | copy: "Hide dust receipts" → applies to holdings too |
| `tests/e2e/fixtures/helpers.ts` | `clickNavTab` union + `"holdings"`; `openHoldings`, `pinFromTokenPage` helpers |
| `tests/e2e/navigation.test.ts` | four tabs |
| `tests/e2e/network/holdings.test.ts`, `tests/e2e/network/pin-to-home.test.ts` | **new** |
| `CLAUDE.md` § Extension component model | mention `modules/holdings/` and the L4 `TokenList` |
| `apps/extension/tests/e2e/README.md` | new helpers in the conventions table |
| `implementations-plan/index.md` | entry |

### Algorithms

**Comparator** (`compareTokenRows`): rank `(pinned ? 0 : 1)`, then fiat class
`(priced ? 0 : held ? 1 : 2)`, then within priced: fiat desc; within unpriced-held and empty:
`stringCompare(name)`. `held = BigInt(public ?? 0) + BigInt(private ?? 0) > 0n`. Stable for equal
keys (`localeCompare` tiebreak on symbol). Unpriced is a class, never coerced to $0 — the existing
aggregate treats unpriced as "not counted", and sorting must not contradict it.

**Cap**: `capTokenRows(rows, 3)` → `{ shown: rows.slice(0, 3), overflow: rows.length - shown.length }`.
"View all →" renders iff `overflow > 0`. Pinned tokens with a zero balance are still ranked first and
therefore shown (dimmed like any empty row) — explicit beats automatic.

**Fold**: `isHiddenHolding` = `!pinned && (raw === 0n || !isAmountAboveDustThreshold({ amountRaw: raw.toString(), decimals, usdRate, thresholdMicro }))`.
The predicate fails OPEN (threshold 0, no rate, unparseable → shown), so an unpriced token with a
balance never folds. `foldLabel`: `hidden === 0` → no row; `thresholdUsd === 0` → `${hidden} empty`;
else `${hidden} hidden · ${empty} empty · ${dust} under $${thresholdUsd}`.

**Search**: `q = query.trim().toLowerCase()`; a row matches when `symbol` or `name` contains `q`,
or `contract.toLowerCase().startsWith(q)` for `q` starting with `0x`. Pinned/rest/fold partition is
computed AFTER the filter; the divider renders only when both partitions are non-empty; the fold
row only when the hidden partition is non-empty; `ListStatusMessage variant="no-results"` when all
three are empty and `q` is non-empty.

**Pin toggle**: `pin(id)`: read → if includes → `"already"`; if `length >= PINNED_TOKENS_MAX` →
`"full"` (no write); else append, write, `"pinned"`. `unpin(id)`: filter, write. Writes are
`storageLocalGet(key)` → merge `{ ...map, [networkId]: list }` → `storageLocalSet({ [key]: map })`,
chained on the instance's `writeChain` promise so two clicks cannot interleave.

### Trade-offs & alternatives not taken

- **Pins on the `Token` entity (a backend flag)** — rejected: it is presentation state, per profile
  AND per network, and a `Token` row-shape change would become a migration the day the wallet has
  users. The UI key mirrors `balanceDisplayOption`'s proven shape and costs nothing in backup terms.
- **Reusing `TokensView` for Holdings via a `mode` prop** — rejected: TokensView's value is its
  task/journal/sync-state wiring, which Holdings deliberately does not show. A separate
  presentational `TokenList` keeps Holdings and the Send picker simple and lets TokensView stay the
  one place that decorates rows with `isUpdating`/`isMinting`.
- **A single-action mode on `ConfirmPopup`** — rejected: it always renders Cancel + Confirm and
  already carries toggle/type-to-confirm/passkey branches; the metadata popup's shape is the
  existing single-button precedent and a new file is cheaper than a new branch.
- **Disabling the menu item when Home is full** — rejected by the owner: the item stays clickable
  and the popup explains, which reads better than a greyed line and needs no tooltip.
- **A separate dust threshold for holdings** — rejected by the owner: one dust number for the
  wallet; the setting's copy widens.
- **Renaming the Home route to `/popup/home`** — rejected: touches the manifest, two redirects, the
  header fallback and 65 e2e hash assertions for a URL nobody sees.
- **Cross-context sync of pins via `chrome.storage.onChanged`** — deferred: the popup is one SPA
  and every consumer re-reads on mount and on scope change; the side panel and a popup open at once
  is the only case that would drift, and it self-heals on the next mount.

## Assumptions

### Facts (verified on the worktree base)

1. `Navigation.vue` renders `navigationLinks` with `data-testid="nav-${name}"` and matches the active
   tab with `route.path.includes(link.path)` (L5-22, L31-34). `/popup/holdings` and `/popup/general`
   don't prefix each other.
2. Pages register through `vite-plugin-pages` from `src/popup/pages` under base `popup`; the
   `<route lang="json">` block carries `isAuthRequired` / `showBottomNav` (e.g. `general.vue:1-8`).
3. `TokensView.vue:69-76` sorts IN PLACE by name with `stringCompare`; `:435-436` renders
   `TokenCard v-for` over it; `:390-417` hold the `tokens-menu-*` items the e2e `importToken` and
   `refreshBalances` helpers click (`tests/e2e/fixtures/helpers.ts:715-773`).
4. `TokenCard.vue` root is a `RouterLink` with `data-testid="tokens-card"`; the symbol span carries
   `data-testid="token-symbol" :data-symbol`; it owns a `PriceServiceClient` per row for `fiatLabel`.
   Network tests select these directly (`tokens.test.ts:16-31`, `default-token-seeding.test.ts:39`,
   `fiat-send.test.ts:47`, `send-amount-clamp.test.ts:31`, `receive-unregistered.test.ts:62,103`);
   `navigateToTokenDetail` (`helpers.ts:793-803`) clicks the FIRST `tokens-card`.
5. `usePrices(client).tokenFiatMicro(token, raw)` returns `bigint | undefined`; unpriced is
   `undefined` at every layer (`composables/usePrices.ts:72-80`); only USDC-pegged contracts and Fee
   Juice are priced (`services/price/price-map.ts:55-72`). `showFiatValues` gates fiat rendering
   (`BalanceView.vue:82-90`).
6. `incomingDustUsdThreshold` is `z.number().nonnegative().default(0)` (`wallet/config/config.ts:45-49`),
   edited in `settings/appearance.vue:74-98` (`dust-threshold-input`), applied at read time by
   `IncomingTransferService.applyDustFilter` (`incoming-transfer/service.ts:577-608`) through
   `isReceiptAboveDustThreshold` (`utils/incoming-dust.ts:22-45`), which fails open.
7. UI preferences persist through `storageLocalGet/Set` (`utils/storage.ts`), which waits for
   `migrationIdle()`; raw `chrome.storage` in UI code fails `utils/storage-facade-ban.test.ts`.
   `BalanceView.vue:194-220` is the per-profile → per-network map precedent. `nulo:ui:*` keys are
   outside `BACKUP_SLICE_REGISTRY` (`backup-migration-registry.ts:197-223`) and never backed up.
8. `select_balance_type` is opened by nothing: grep over `apps/extension/src` and `tests` finds only
   `PopupManager.vue:341` and the popup. `displayOption` is read by `app.store.ts`,
   `app.store.shape.pins.test.ts:40,84`, `BalanceView.vue` and `BalanceView.test.ts` (S-A matrix
   L247-330, deletion tests L166-187).
9. `TokenMetadataPopup.vue:65-66,210` is the single-button popup shape; `ConfirmPopup.vue:134-155`
   always renders Cancel + Confirm. `popupStore.open(target, payload)` / `getPayload(target)` exist.
10. `SelectTokenPopup.vue` fetches `getTokens(profile.id, network.chainId)` and sets
    `cacheStore.activeTokenIdx`; `send.vue:89,99,402,438-495` resolve the selection from `?tokenId`,
    then `activeTokenIdx`, then `tokens[0]`.
11. `TokenServiceClient.onTokenDeleted` carries `TokenInfo & { profileId }`
    (`services/token/spec.ts:225`); `BalanceView.vue:182-188` is the UI precedent for reacting to it.
12. `tests/vitest.setup.ts:88-113` stubs `chrome.storage` as `{}`; every storage-touching test
    installs its own in-memory backing (`BalanceView.test.ts:121-156`, `app.store.test.ts:41-49`).
13. Scripts: `bun run lint` (biome + complexity baseline), `bun run typecheck` (vue-tsc on the
    extension), `bun run test` (extension vitest on Bun), `bun run test:e2e` (smoke, Node
    Puppeteer), `bun run e2e:agent [files|--shard=N/5]` (network; owns anvil + sandbox per worktree;
    `NULO_E2E_PROVERLESS=1` for the fast build). CI's smoke and network filters are whole-package
    `apps/extension/**`, so every PR here runs both.
14. `gh stack` v0.0.1 is installed on the Mac and the homelab.

### Inferences (unverified, attackable)

1. The sandbox network suite never registers more than three tokens in one test, so a Home cap of
   3 strands no existing `tokens-card` selector. (Every direct selector found targets one symbol or
   the first card.)
2. Two extra `PriceServiceClient`s (TokensView, holdings page) are cheap because the price service
   caches quotes and `usePrices` polls at 30s; TokenCard already opens one per row.
3. `useEntityCrud` over `getTokenBalances(undefined, account)` with the three balance events is
   sufficient for Holdings because balance rows are created for every (token, account) pair when a
   token is added, so "token added" always surfaces as `onTokenBalanceAdded`.
4. `MaterialIcon name="home"` and `push_pin` exist in the bundled Material Symbols subset (the
   package ships `MaterialSymbolsOutlined.woff2`; if the subset lacks a glyph, fall back to
   `account_balance_wallet` for Home and to the existing `Icon` set for the menu item).
5. A 30 GB homelab runs two proverless shards in parallel comfortably; five at once will swap.

### Asks (resolved with the owner, 2026-09-06)

- Tab label → **Holdings**. Send picker reuse → **yes**. Retire the balance-display popup → **yes**.
  Dust → **reuse the existing setting**. Rows carry **no** chip or glyph. Cap → **3**, refusal → an
  **informational popup**. Validation → unit/component on every phase, smoke at every arc end,
  targeted proverless network files per arc, the full network suite sharded at the end.
  `code_review: off`. Delivery → **three stacked PRs**.

No unresolved Asks.

## Phases

Each phase ends with a **Validation gate**: the commands must exit 0 and the pass criteria hold
before the phase is marked ✓ in this file. The fast layers run after every meaningful edit inside a
phase too. `<fast>` below means:

```bash
bun run lint && bun run typecheck && bun run test
```

### Arc A — nav + Home (branch `worktree-home-holdings-pin`)

#### Phase 1 — four tabs and an empty Holdings page

- `Navigation.vue`: `[general → HOME (home icon), holdings → HOLDINGS, activity, settings]`.
- `pages/holdings.vue`: route block, app header, a `SectionLabel label="Holdings"` placeholder body,
  `data-testid="holdings-page"`. Real content lands in Phase 3.
- `tests/e2e/fixtures/helpers.ts`: `clickNavTab` union gains `"holdings"`; add `openHoldings(page)`
  (`clickNavTab` + `waitForHash("#/popup/holdings")`).
- `tests/e2e/navigation.test.ts`: assert the four tabs round-trip by hash.

Validation gate — `<fast>` and `bun run test:e2e -- tests/e2e/navigation.test.ts` (run as
`bun run --cwd apps/extension test:e2e tests/e2e/navigation.test.ts`). Pass: exit 0; the navigation
spec shows four hashes. Layers: lint/typecheck · unit · smoke.

#### Phase 2 — Home order, cap, "View all →", aggregate-only hero

- `token-order.ts` + tests: comparator (pinned set is a parameter, empty until Arc C), `orderTokenRows`
  (copy, never mutates), `capTokenRows`, `HOME_TOKEN_ROWS`.
- `token-aggregate.ts` + tests: `aggregateFiat` lifted from `BalanceView`.
- `TokensView.vue`: a `PriceServiceClient` + `usePrices` (disposed in `onBeforeUnmount` AFTER the
  service disconnects, per the cleanup-order rule), `orderTokenRows` + `capTokenRows`, section title
  **HOLDINGS** with the total count, `tokens-view-all` link (`router.push("/popup/holdings")`) when
  `overflow > 0`. `TokensView.test.ts`: two new cases — order (priced desc, unpriced-held, empty) and
  cap/overflow; the existing sync-state cases untouched.
- Retire the display option: delete `SelectBalanceTypePopup.vue`, its `PopupManager` lines, the
  `displayOption` ref in `app.store.ts` and the key in `app.store.shape.pins.test.ts`; `BalanceView`
  shows the aggregate over both sides unless `tokenBalance` is passed; remove load/save + watchers;
  `BalanceView.test.ts`: replace the S-A matrix with three cases (aggregate with prices, partial
  caption, fiat kill-switch hides the figure) and keep the deletion cases as "list stays consistent".
- Smoke `fiat-display.test.ts` still green (it drives the aggregate + kill-switch).

Validation gate — `<fast>`; `bun run test:e2e` (full smoke, ~10 min); network, targeted:
`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/tokens.test.ts tests/e2e/network/default-token-seeding.test.ts tests/e2e/network/fiat-send.test.ts`
(in tmux). Pass: exit 0 everywhere; `TokensView.test.ts` and `BalanceView.test.ts` green with the new
cases. Layers: lint/typecheck · unit · smoke · network (targeted).

**Arc A boundary**: run the arc quality loop (§ Post-implementation), THEN `gh stack init --adopt worktree-home-holdings-pin --base dev` and `gh stack add home-holdings-pin/holdings`.

### Arc B — Holdings page + TokenList + Send picker (branch `home-holdings-pin/holdings`)

#### Phase 3 — TokenList and the Holdings page

- `incoming-dust.ts`: export `isAmountAboveDustThreshold`; `isReceiptAboveDustThreshold` becomes an
  alias; existing tests unchanged plus one asserting identity.
- `token-fold.ts` + tests: `isHiddenHolding`, `foldLabel` (threshold 0, dust, empty, pinned exempt).
- `TokenCard.vue`: `mode`/`selected` props; `TokenCard.test.ts` gains link-vs-button and selected.
- `TokenList.vue` + `TokenList.test.ts` (≥ 10 cases per the L3/L4 bar: filter by symbol/name/contract,
  sort toggle, pinned partition + divider presence rules, fold label variants, fold expand, pinned
  never folds, no-results, select emits, selected marker, empty rows).
- `pages/holdings.vue`: summary (`holdings-summary`), clients as in § Data & control flow,
  `TokenList mode="link"`. Copy per § Copy.
- `settings/appearance.vue`: dust copy widened.
- `tests/e2e/network/holdings.test.ts`: open Holdings, the sandbox token renders as `tokens-card`
  with real balances, typing its symbol into `holdings-search` keeps it, a miss shows the no-results
  message, the sort toggle flips label.

Validation gate — `<fast>`; `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/holdings.test.ts tests/e2e/network/tokens.test.ts`.
Pass: exit 0; TokenList suite ≥ 10 green. Layers: lint/typecheck · unit/component · network (targeted).

#### Phase 4 — Send picker on TokenList

- `SelectTokenPopup.vue`: fetch balances for the account on open, `TokenList mode="select"
  :selectedId="cacheStore.activeTokenIdx" :showSearch="rows.length > HOME_TOKEN_ROWS"`, keep the
  "Manage tokens" row. `send.vue` untouched.
- e2e: extend `tests/e2e/network/transfers.test.ts`'s existing token selection if it selects by
  testid (it uses `sendTransfer` in helpers — verify the helper's selector still resolves; add
  `data-token-id` to the select-mode `TokenCard` root and use it there).

Validation gate — `<fast>`; `bun run test:e2e`;
`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/transfers.test.ts tests/e2e/network/send-amount-clamp.test.ts tests/e2e/network/fiat-send.test.ts`.
Pass: exit 0. Layers: lint/typecheck · unit · smoke · network (targeted).

**Arc B boundary**: arc quality loop, THEN `gh stack add home-holdings-pin/pins`.

### Arc C — pins (branch `home-holdings-pin/pins`)

#### Phase 5 — `usePinnedTokens`

- `storage-keys.ts`: `pinnedTokens: (profileId: string) => \`nulo:ui:pinnedTokens@${profileId}\``.
- `usePinnedTokens.ts` + `usePinnedTokens.test.ts` (≥ 10: read/validate hostile shapes, pin returns
  pinned/full/already, unpin, cap, per-network isolation, scope change refresh, deletion cleanup,
  serialised writes, dispose unsubscribes, no write on `"full"`).

Validation gate — `<fast>`. Pass: exit 0, composable suite green. Layers: lint/typecheck · unit.

#### Phase 6 — the menu item, the popup, and the order everywhere

- `PinLimitPopup.vue` (+ test ≥ 5: renders symbol + pinned symbols, Got it closes, close button,
  payload missing → no crash) and its `PopupManager` line.
- `pages/tokens/[id].vue`: `usePinnedTokens` (parent owns the `TokenServiceClient` it already has),
  `token-menu-pin` item with the two labels, toasts, popup on `"full"`.
- `TokensView.vue`, `pages/holdings.vue`, `SelectTokenPopup.vue`: pass `pinnedSet` into the order.
- `tests/e2e/fixtures/helpers.ts`: `pinFromTokenPage(page)`; `tests/e2e/network/pin-to-home.test.ts`:
  open the sandbox token's page, pin, back to Home → the row is first and the menu now reads
  Unpin (assert `token-menu-pin`'s `data-pinned="true"`), close and reopen the popup → still pinned,
  unpin → `data-pinned="false"`.
- Docs: `CLAUDE.md` component model (holdings module), e2e README helper table,
  `implementations-plan/index.md` entry, lessons.

Validation gate — `<fast>`; `bun run test:e2e`;
`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/pin-to-home.test.ts tests/e2e/network/holdings.test.ts tests/e2e/network/tokens.test.ts`.
Pass: exit 0. Layers: lint/typecheck · unit/component · smoke · network (targeted).

#### Phase 7 — final full network suite, sharded

In tmux, two shards at a time (RAM), all five must exit 0:

```bash
for s in 1 2 3 4 5; do
  tmux new-session -d -s "hhp-shard-$s" \
    "cd ~/Projects/nulo/.claude/worktrees/home-holdings-pin && NULO_E2E_PROVERLESS=1 bun run e2e:agent --shard=$s/5 > ~/.cache/hhp-shard-$s.log 2>&1; echo EXIT=\$? >> ~/.cache/hhp-shard-$s.log"
  [ $((s % 2)) -eq 0 ] && sleep 900   # let the first pair finish before the next
done
tail -n1 ~/.cache/hhp-shard-*.log     # every file ends EXIT=0
```

Validation gate — `<fast>`; the five shard logs end `EXIT=0` (an `EXIT=86` is an infra boot failure:
`bun run e2e:reap`, rerun that shard). Layers: everything.

## Security & adversarial considerations

- **Threat surface**: UI-only change, no new permissions, no network calls, no new dependencies
  (`bun.lock` unchanged — a gate check). Attackers reach it through storage contents and token
  metadata.
- **Hostile storage**: the pins key is validated on every read (array, finite non-negative integers,
  de-duplicated, truncated to the cap); anything else is treated as empty. A poisoned map can at
  most reorder rows.
- **Hostile token metadata**: symbols and names come from contracts. They render through Vue
  interpolation (escaped) in rows, in the popup and in toasts; the search compares lowercase strings
  and never builds HTML or regexes from input (`String.prototype.includes`, no `RegExp`).
- **Search input**: the design `Input` with `sanitize` strips control characters; the query is
  local state, never persisted, never sent anywhere.
- **Dust and prices**: the fold fails open (unknown price → shown), so a price-feed failure can never
  hide a holding; it mirrors the incoming-feed policy. Pinned tokens are exempt so a hostile threshold
  cannot hide what the user chose.
- **Popup payload**: `PinLimitPopup` reads only `symbol` and `pinnedSymbols` strings from the store
  payload and renders them as text.
- **Deletion**: removing a token drops its id from the pins list, so no dangling id survives; a
  dangling id that appears anyway (storage edited) is ignored by consumers because ordering only
  consults ids present in the fetched rows.
- **Least privilege / supply chain**: nothing new; CI's frozen lockfile and 7-day min-age policies
  are untouched.

## Copy

- Tabs: `HOME`, `HOLDINGS`, `HISTORY`, `SETTINGS`.
- Home section header: `HOLDINGS` + count; link `View all →`.
- Holdings summary: fiat total (or hidden under the fiat kill-switch), `N tokens`,
  `priced assets only` when partial.
- Search placeholder: `Search tokens`. Sort toggle: `↓ value` / `A → Z`.
- Fold: `N hidden · X empty · Y under $T` · `show` / `hide`; `N empty` when the threshold is 0.
- No results: `NO MATCHES · TRY A DIFFERENT TERM` (existing component default).
- Menu: `Pin to Home` / `Unpin from Home`. Toasts: `Pinned to Home` / `Unpinned from Home`.
- Popup: title `Home is full`; body `Home shows up to 3 pinned tokens. Unpin one of these to pin
  {symbol}:`; the three symbols; button `Got it`.
- Settings: `Hide dust` / `Hide receipts and holdings below this value. 0 turns it off.`

## Post-implementation

Executed by the implementing session from this file. `code_review` is **off**: do not run
`/code-review`; the codex loop is the review.

1. **Per arc, at its boundary** (after the arc's phases are ✓ and BEFORE `gh stack add` opens the
   next arc): `/codex high` with the arc's diff (`git diff <arc-base>...HEAD`), this plan, the decision
   ledger, the arc map ("this is arc N of 3; later arcs will build X on it"), an explicit
   adversarial/security ask, and the two rules below verbatim. Triage (verify codex's factual claims
   against the repo first), apply accepted fixes, commit, log the round in
   `lessons/post-impl-arc-N.md`, RESUME the same codex session with the fix diff for a re-review.
   Repeat until a round yields no new material findings; hard stop at 3 rounds → surface to the
   owner.
2. **After all three arcs**: a FRESH codex session over the net diff from `dev@2a3d2d87` asking for
   cross-arc issues (seams, duplication across arcs, drift from this plan), same loop, logged in
   `lessons/post-impl-cross-arc.md`.
3. **Delivery** (below) — the first time any PR is opened.

**The no-over-engineering rule** (verbatim in every codex prompt, initial and resumed): *"Report bugs
and small, targeted improvements only. Do not propose speculative abstractions, extra configuration
surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and
is clear, leave it alone."*

**The comment-quality rule** (same treatment): *"Audit the comments for value per character. Flag any
comment that narrates what the code visibly does, restates its line, references implementation plans
/ phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious
invariant or constraint deserves a comment it doesn't have. Comments are permanent context every
future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*

Hard limits for the autonomous session: never merge to `dev` or `main`, never publish or deploy,
never expand scope beyond this file; commit signing stays ON on the homelab; push only the three arc
branches.

## Delivery

Three stacked PRs via `gh stack` (installed on both machines), all `code_review: off`:

| Arc | Branch | Phases | Stacks on |
|---|---|---|---|
| A · nav + Home | `worktree-home-holdings-pin` | 1, 2 | `dev` |
| B · Holdings + TokenList + Send | `home-holdings-pin/holdings` | 3, 4 | A |
| C · pins | `home-holdings-pin/pins` | 5, 6, 7 | B |

Mechanics: after Arc A's loop, `gh stack init --adopt worktree-home-holdings-pin --base dev`, then
`gh stack add home-holdings-pin/holdings`; after Arc B's loop, `gh stack add home-holdings-pin/pins`.
Push with `gh stack push` at every checkpoint (a branch push without a PR triggers no CI). After the
cross-arc pass: `gh stack sync` (if `dev` moved), `gh stack submit --auto`, then `gh pr edit` each PR
with a Conventional-Commit title ≤ 93 chars (`feat(popup): home shows three holdings and a holdings
tab`, `feat(holdings): holdings page, token list and send picker`, `feat(popup): pin to home`) and a
body, then `gh pr checks --watch`. `gh stack merge` lands the named PR and everything below it — the
owner's call, never autonomous.

## Decision ledger

_Filled after the dual audit._

## Audit outcome

_Filled after the audits: adopted / rejected per finding, verdicts, the final fresh-context codex
verdict in the explicit format._

## Seeds

_Draft until the approval gate; finalized after approval._

```
/goal All seven phases marked ✓ in implementations-plan/home-holdings-pin/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/home-holdings-pin/lessons/phase-N.md`; `/code-review` was NOT run (code_review is off); the codex fix loop converged for each of the three arcs at its boundary AND for the final cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; the three-PR stack exists on GitHub, created only after all loops converged (`gh stack view` output in the transcript); `bun run test` and `bun run lint` both report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/home-holdings-pin forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/home-holdings-pin/plan.md and lessons/ (authoritative state — not the chat); native task list empty (fresh session)? rebuild it from plan.md, one task per remaining phase; run `git status` and `git log --oneline -5`. If a PR exists, `gh stack view`. Without a PR, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI or a tmux e2e shard is fine** — confirm it's progressing (`gh run watch <run-id>` up to 10 minutes; `tail -n2 ~/.cache/hhp-shard-*.log`); use the wait to prep the next phase or strengthen tests. Don't start work that conflicts with the in-flight change.
3. **No task in hand?** Pick the next pending phase from plan.md and start it. After each meaningful edit run `bun run lint && bun run typecheck && bun run test`. Commit (signed — the homelab signs non-interactively) → `gh stack push`.
4. **Stuck, or facing a decision you'd normally bring to me?** Don't wait. Call `/codex high` with full context and go back and forth until you two reach a defensible decision, then act on it. Log every consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge to dev or main, never publish or deploy, never expand scope beyond plan.md; if a decision requires crossing one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess the approach with codex, then continue down the agreed path.
6. **Phase green?** "Green" means THE PHASE'S VALIDATION GATE as written in plan.md passes. Run the full gate (network gates in tmux), paste the result, mark ✓ in plan.md, file the lessons entry, print `LESSONS_FILE=implementations-plan/home-holdings-pin/lessons/phase-N.md`, advance. Arc boundary crossed (per plan.md's Delivery section)? Run the arc's codex loop FIRST (plan.md § Post-implementation: arc diff + plan + ledger + arc map + the no-over-engineering and comment-quality rules, resume until a round yields nothing material) — THEN `gh stack add <next-arc-branch>`.
7. **All seven phases ✓?** Run the final cross-arc codex pass (FRESH session, net diff from dev@2a3d2d87, cross-arc ask, same loop-until-clean), then Delivery per plan.md — the FIRST time any PR is opened: `gh stack sync` if dev moved, `gh stack submit --auto`, `gh pr edit` bodies, `gh pr checks --watch`. Then write the wrap-up report: what shipped, every contentious decision codex and I debated with ELI5 context, open items. Surface and stop.

Keep the native task list current; plan.md stays the source of truth.
```
