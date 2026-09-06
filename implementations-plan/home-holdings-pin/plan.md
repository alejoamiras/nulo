# home-holdings-pin — Home, a Holdings tab, and "Pin to Home"

- **Tier**: mid (codex + fable dual audit, final fresh codex pass). `code_review: off`. `eli5_mode: artifact`. `driver: claude-code`.
- **Budget**: recon 2 sonnet agents (done, `recon.md`); codex at `high`: plan audits + a post-impl loop of ≤3 rounds per arc + 1 cross-arc pass; fable: 1 plan audit.
- **Worktree**: `home-holdings-pin` / branch `worktree-home-holdings-pin` off `dev@2a3d2d87` (#556). Created on the Mac, pushed, **executed on the homelab** in a fresh session — § Bootstrap is written for that session.
- **Owner decisions (2026-09-06)**: four tabs HOME · HOLDINGS · HISTORY · SETTINGS; Home shows three token rows and a "View all →"; a Holdings page with search, value/name sort, and one fold for empty + under-dust tokens reusing the EXISTING dust setting; "Pin to Home" / "Unpin from Home" in the token page's "⋯" menu, cap 3, a 4th pin opens an informational popup; **no chip, glyph or control on rows**; the Send picker renders the same list; the balance-display popup is retired; no horizontal strip; paste-an-address-to-add is a later plan.
- **Design reference**: the round-4b mockups (interactive, shared pin state) live at the Claude Artifact `https://claude.ai/code/artifact/1b64e873-a804-4262-8818-55d6481b7bef`. Everything a fresh session needs from them is restated in § Scope and § Copy; the artifact is for taste, not for facts.
- **Revision**: r2 after the codex round-1 audit (`audit-codex.md`, reject → all adopted but one copy nit).

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
   ordered by one shared comparator (§ Algorithms), capped at `HOME_TOKEN_ROWS = 3`, plus a
   "View all →" link (`tokens-view-all`) shown only when more tokens exist than fit. In-flight import
   rows and minting rows render above the cap as today. The in-flight tx card stays where
   RecentActivityView puts it.
3. **Retire the balance-display popup**: `SelectBalanceTypePopup.vue`, its `PopupManager`
   registration, `appStore.displayOption`, and `BalanceView`'s per-token hero mode + the
   `nulo:ui:balanceDisplayOption@` load/save. The Home hero always shows the aggregate over both
   sides; the token page keeps its own hero via the `tokenBalance` prop.
4. **Holdings page** (`pages/holdings.vue`, tab-level, normal app header): aggregate summary
   (`holdings-summary`: fiat total + "N tokens", "priced assets only" when partial; the fiat figure
   hidden under the fiat kill-switch), a loading state (design `LoadingState`) until the first fetch
   resolves, an error line if it throws, then one `TokenList`.
5. **`TokenList`** (new L4 module, presentational, used by Holdings AND the Send picker): sticky
   search (`holdings-search`, symbol/name substring + contract prefix, literal, no sanitizer), a
   section header with the count and a value/name sort toggle (`holdings-sort`), pinned rows above a
   dashed rule (`token-list-divider`), the rest in sort order, one fold row (`holdings-fold`) hiding
   empty and under-dust tokens with the label `N hidden · X empty · Y under $T` (or `N empty` when the
   threshold is 0), and the existing `ListStatusMessage variant="no-results"` for a miss. Rows are
   `TokenCard` in link mode (Holdings) or select mode (Send). Local state (query, sort, fold) lives
   in the component and resets whenever it mounts.
6. **Dust**: the Holdings fold reuses `incomingDustUsdThreshold` and the bigint predicate in
   `utils/incoming-dust.ts` through a generic alias; the config schema bounds the threshold; the
   Settings → Appearance copy widens from "receipts" to "receipts and holdings". The fold applies
   regardless of the fiat kill-switch (it is a data filter, like the incoming feed's, which does not
   consult `showFiatValues`). Pinned and never-synced tokens never fold.
7. **Send picker**: `SelectTokenPopup.vue`'s body becomes `TokenList` in select mode over the
   account's balances (fetched on open, scope-guarded), search shown when more than
   `HOME_TOKEN_ROWS` tokens exist, the fold applies, state resets on every open (`v-if="show"`); the
   selection contract (`cacheStore.activeTokenIdx = token.id`, emit close) and the "Manage tokens" row
   are unchanged.
8. **Pins**: `usePinnedTokens` composable owning the key `nulo:ui:pinnedTokens@${profileId}` →
   `Record<networkId, contract[]>` (lowercase contract addresses, ≤ 3) behind the storage facade.
   Contracts, not ids: token ids are max+1 reallocatable, so an id could pin a successor token; a
   re-added token keeping its pin is the intended behaviour. The cap counts only pins that intersect
   the current token set; dangling entries are pruned on the next write. `pin()` returns `"full"` at
   the cap. `onTokenDeleted` cleanup plus a re-read on `chrome.storage.onChanged`. Writes are
   serialised per key inside one JS context; two contexts (popup + side panel) writing at the same
   instant are last-writer-wins and can lose at most one pin, which the next read shows honestly.
9. **Token page menu**: one `DropdownItem` (`token-menu-pin`, `data-pinned`) reading "Pin to Home"
   or "Unpin from Home". A refused pin opens `PinLimitPopup` (`pin_limit`): "Home is full" / "Home
   shows up to 3 pinned tokens. Unpin one of these to pin {symbol}:" / the three pinned symbols /
   one **Got it** button. Nothing changes until the user unpins.
10. **Degenerate case**: with three or fewer tokens, Home shows them all and hides "View all"; a
    two-token wallet looks exactly like today.
11. **Tests**: pure-function unit tests for the comparator, the cap, the fold predicate, the
    aggregate and the pin store; component tests for `TokenList`, `PinLimitPopup`, the token page
    menu states, and the rewritten `BalanceView` cases; smoke e2e for the four tabs; network e2e for
    Holdings rendering real balances, search, the Send picker selecting a token, and a pin/unpin
    round trip that survives a popup reopen. The cap, the full state and the fold are unit/component
    tested with fixtures — e2e never needs more than the sandbox's tokens.

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
- A cross-context write lock for pins (see Scope 8).

## Bootstrap on the homelab (fresh machine, fresh session)

The plan was written on the Mac; the branch is pushed. On the homelab, in a zsh **login** shell (bun,
claude, codex and agent-worktree live in `~/.bun/bin`, `~/.local/bin` and nvm):

```bash
cd ~/Projects/nulo                                   # the homelab's canonical clone (see ~/.agents/clones.md)
git fetch origin
# first time on this machine:
git worktree add --track -b worktree-home-holdings-pin \
  .claude/worktrees/home-holdings-pin origin/worktree-home-holdings-pin
# if the local branch already exists (a previous fetch/checkout), use this form instead:
#   git worktree add .claude/worktrees/home-holdings-pin worktree-home-holdings-pin
cd .claude/worktrees/home-holdings-pin
bun --version | grep -q '^1\.[4-9]' || echo "NEED bun >= 1.4"   # lockfile v2 needs 1.4+
node --version; tmux -V; google-chrome --version; anvil --version | head -1
bun install --frozen-lockfile                        # installs the git hooks too (prepare)
agent-worktree register home-holdings-pin --status "approved: implementing phase 1"
codex login status                                   # must say logged in; the loops need it
gh auth status && (gh extension list | grep -q stack || gh extension install github/gh-stack)
git config --get commit.gpgsign                      # homelab signs non-interactively: keep it ON
```

Machine facts that matter (from `~/.agents/machine.md` on the homelab): commit signing is
non-interactive (passphrase-less SSH key) so AFK keeps signing; **long jobs must run in tmux**
(`tmux new-session -d -s <name> "<cmd>"`) or they die with the Claude process; `TMPDIR` is
redirected to `~/.cache/tmp`; `/tmp` is tmpfs — never point a sandbox data dir at it. No `.env`
files are needed: unit, smoke and proverless network e2e run from the repo alone (the network
runner builds the wallet itself and stamps its own env; the smoke runner does NOT build — every
smoke gate below is preceded by `bun run build`). The Aztec sandbox and anvil are started by
`bun run e2e:agent` from the workspace's own dependencies; nothing global is required beyond
Chrome and foundry.

Pushing before the stack exists: plain `git push` on `worktree-home-holdings-pin` (its upstream is
set). `gh stack init` happens at the Arc A boundary (§ Delivery); from then on `gh stack push`.

Start the implementing session **inside the worktree** (`claude` from that directory, or
`agent-worktree resume home-holdings-pin`), paste the `/goal` seed from § Seeds, and keep plan.md
as the source of truth: phases are marked ✓ in this file, lessons go in
`implementations-plan/home-holdings-pin/lessons/phase-N.md`.

## Architecture & Implementation

### Proposed architecture

Five pieces, all inside `apps/extension`; no package boundary moves, no new dependencies.

```
pure helpers (unit-tested, no Vue)
  src/popup/components/modules/holdings/token-order.ts     classifyRow, compareTokenRows, orderTokenRows, capTokenRows, HOME_TOKEN_ROWS
  src/popup/components/modules/holdings/token-fold.ts      isHiddenHolding, foldLabel
  src/popup/components/modules/holdings/token-aggregate.ts aggregateFiat (lifted out of BalanceView)
  src/popup/components/modules/holdings/token-search.ts    matchesQuery
  src/utils/incoming-dust.ts                               + isAmountAboveDustThreshold (alias), hardened

state (C1 composable, unit-tested with a fake client + in-memory storage)
  src/composables/usePinnedTokens.ts                       key, cap, pin/unpin, pruning, deletion cleanup, onChanged, scope

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
export type OrderCtx = { pinnedContracts: ReadonlySet<string>; fiatOf: FiatOf }
export type RowClass = "pinned" | "held-priced" | "held-unpriced" | "unsynced" | "empty"
export function classifyRow(tb: TokenBalanceInfo, ctx: OrderCtx): RowClass
export function compareTokenRows(a: TokenBalanceInfo, b: TokenBalanceInfo, ctx: OrderCtx): number
export function orderTokenRows(rows: TokenBalanceInfo[], ctx: OrderCtx): TokenBalanceInfo[]   // never mutates input
export function capTokenRows<T>(rows: T[], budget = HOME_TOKEN_ROWS): { shown: T[]; overflow: number }

// token-fold.ts — pure
export function isHiddenHolding(tb, p: { pinned: boolean; usdRate: number | undefined; thresholdMicro: bigint }): boolean
export function foldLabel(p: { hidden: number; empty: number; dust: number; thresholdUsd: number }): string

// token-search.ts — pure
export function matchesQuery(tb: TokenBalanceInfo, query: string): boolean   // trim + lowercase, literal includes / 0x-prefix

// token-aggregate.ts — pure (the body of BalanceView's `aggregate` computed, lifted)
export function aggregateFiat(rows: TokenBalanceInfo[], fiatOf: FiatOf): { micro: bigint; priced: number; holdings: number; partial: boolean }

// usePinnedTokens.ts — C1; parent owns the TokenServiceClient
export const PINNED_TOKENS_MAX = HOME_TOKEN_ROWS
export function usePinnedTokens(deps: {
  tokenService: Pick<TokenServiceClient, "onTokenDeleted">
  getScope: () => { profileId: string; networkId: string } | undefined
  knownContracts: () => ReadonlySet<string>          // the caller's current token set (lowercase); cap + pruning use it
}): {
  pinnedContracts: ComputedRef<ReadonlySet<string>>  // this scope's list ∩ knownContracts
  isPinned(contract: string): boolean
  pin(contract: string): Promise<"pinned" | "full" | "already">
  unpin(contract: string): Promise<void>
  refresh(): Promise<void>                            // re-read for the current scope (mount, scope change, onChanged)
  dispose(): void
}
// storage: key `nulo:ui:pinnedTokens@${profileId}` → Record<networkId, string[]>
```

`TokenList.vue` props: `rows: TokenBalanceInfo[]`, `pinnedContracts: ReadonlySet<string>`,
`fiatOf: FiatOf`, `usdRateOf: (tb) => number | undefined`, `dustThresholdUsd: number`,
`mode: "link" | "select"`, `selectedTokenId?: number`, `showSearch = true`; emits `select(tokenId)`
(the TOKEN id, `tb.token.id`, never the balance-row id). Internal state: `query`, `sort`
(`"value" | "name"`, default value), `showHidden`. In select mode the list root is `role="listbox"`
and each row `role="option" aria-selected`.

`TokenCard.vue` gains `mode` (default `"link"`, the existing `RouterLink`; `"select"` renders a
`<button type="button" role="option">` root that emits `select`) and `selected` (accent left rule +
`aria-selected`). Both modes keep `data-testid="tokens-card"` and add `data-token-id`.

`PinLimitPopup.vue` reads `popupStore.getPayload("pin_limit")` as
`{ symbol: string; pinnedSymbols: string[] }`, validated at runtime (strings only, ≤ 3 entries).

### Data & control flow

- **Home**: `TokensView` fetches balances as today → `orderTokenRows(rows, { pinnedContracts, fiatOf })`
  → `capTokenRows` → renders `shown` with `TokenCard`, plus "View all →" when `overflow > 0`.
  `fiatOf` comes from a `PriceServiceClient` + `usePrices` owned by TokensView (the shape BalanceView
  uses; disposed after its client disconnects); `pinnedContracts` from `usePinnedTokens` with a
  `TokenServiceClient` TokensView constructs for it (`knownContracts` = the fetched rows' contracts).
- **Holdings**: `pages/holdings.vue` owns a `TokenBalanceServiceClient` + `useEntityCrud` over
  `getTokenBalances(undefined, account.address)` with the three balance events; ONE
  `watch(() => [profile.id, account.address, network.id])` calls `refresh({ clear: true })` (the
  TokensView idiom); `tokenBalanceService.onConnected` calls `refresh()` (the RecentActivityView /
  TokensView resnapshot idiom — a port reconnect can drop events); a null scope renders the loading
  state and fetches nothing. It also owns a `PriceServiceClient` + `usePrices`, a `ConfigServiceClient`
  (`getValue("incomingDustUsdThreshold")` + `onUpdate`), and a `TokenServiceClient` for
  `usePinnedTokens`. Summary via `aggregateFiat`; everything else goes to `TokenList`.
- **Send**: `SelectTokenPopup` on `show` fetches balances for the current account (guarded by a
  scope captured before the await; a stale result is dropped), renders
  `TokenList mode="select" :selectedTokenId="cacheStore.activeTokenIdx"` with the same price/config/
  pins clients as Holdings (created inside the popup, disconnected on hide), and on `select` sets
  `cacheStore.activeTokenIdx = tokenId` and emits close — exactly the current contract, so
  `send.vue`'s resolution order (`?tokenId` → `activeTokenIdx` → `tokens[0]`) is untouched. A token
  deleted while the popup is open disappears through `onTokenBalanceDeleted`.
- **Pin**: token page → `pins.pin(contract)` → `"pinned"` (toast "Pinned to Home") | `"full"` →
  `popupStore.open("pin_limit", { symbol, pinnedSymbols })` | `"already"` (no-op). `unpin` → toast
  "Unpinned from Home". The menu closes on action (existing behaviour). Home re-reads pins on mount
  and on `chrome.storage.onChanged`. Deletion: `onTokenDeleted` → splice + persist.
- **Storage write path**: `pin`/`unpin` enqueue on a module-level `Map<key, Promise>` chain (one per
  storage key, shared by every instance in the context); inside the chain: `storageLocalGet(key)` →
  validate → intersect with `knownContracts()` (prune) → mutate → `storageLocalSet`. A rejected write
  logs, leaves the chain usable, and re-reads. Values are validated on every read (object → string
  array → lowercase `0x` + 64 hex → de-duplicated → truncated to the cap); anything else is empty.

### File-level change map

| File | Change |
|---|---|
| `src/popup/components/Navigation.vue` | four entries; `general` relabelled HOME with icon `home`; new `holdings` entry |
| `src/popup/pages/holdings.vue` | **new** page, `{ "meta": { "isAuthRequired": true, "showBottomNav": true } }` |
| `src/popup/components/modules/holdings/token-order.ts` (+ `.test.ts`) | **new** pure classes, comparator, cap |
| `src/popup/components/modules/holdings/token-fold.ts` (+ `.test.ts`) | **new** pure fold predicate + label |
| `src/popup/components/modules/holdings/token-search.ts` (+ `.test.ts`) | **new** pure matcher |
| `src/popup/components/modules/holdings/token-aggregate.ts` (+ `.test.ts`) | **new**, lifted from `BalanceView.vue` L106-126 |
| `src/popup/components/modules/holdings/TokenList.vue` (+ `.test.ts`) | **new** L4 module |
| `src/utils/incoming-dust.ts` (+ test) | export `isAmountAboveDustThreshold`; keep the receipt name as an alias; all bigint math inside the try |
| `src/wallet/config/config.ts` (+ test) | `incomingDustUsdThreshold: z.number().nonnegative().max(1_000_000).default(0)` |
| `src/composables/usePinnedTokens.ts` (+ `.test.ts`) | **new** C1 composable |
| `src/popup/constants/storage-keys.ts` | `pinnedTokens(profileId)` key builder next to the existing keys |
| `src/popup/components/modules/general/TokenCard.vue` (+ test) | `mode`, `selected`, `data-token-id` |
| `src/popup/components/modules/general/TokensView.vue` (+ test) | comparator + cap + View all; header copy; no in-place `.sort`; price + pins clients |
| `src/popup/components/modules/general/BalanceView.vue` (+ test) | drop `displayOption`, load/save, watchers; aggregate via `aggregateFiat`; keep `tokenBalance` prop path |
| `src/popup/components/popups/SelectBalanceTypePopup.vue` | **delete** |
| `src/popup/components/popups/PopupManager.vue` | remove `select_balance_type`; add `pin_limit` |
| `src/popup/components/popups/PinLimitPopup.vue` (+ test) | **new**, `TokenMetadataPopup` shape |
| `src/popup/components/popups/SelectTokenPopup.vue` | body → `TokenList mode="select"` |
| `src/popup/pages/tokens/[id].vue` | `token-menu-pin` item; `usePinnedTokens`; toasts; popup |
| `src/stores/app.store.ts` + `app.store.shape.pins.test.ts` | remove `displayOption` from the store and the pinned key list |
| `src/popup/pages/settings/appearance.vue` | copy: "Hide dust receipts" → applies to holdings too |
| `tests/e2e/fixtures/helpers.ts` | `clickNavTab` union + `"holdings"`; `openHoldings`; `navigateToTokenDetail(page, symbol?)` selects by `data-symbol` when given; `pinFromTokenPage`; `selectSendToken` |
| `tests/e2e/navigation.test.ts` | four tabs |
| `tests/e2e/network/holdings.test.ts`, `send-picker.test.ts`, `pin-to-home.test.ts` | **new** |
| `CLAUDE.md` § Extension component model | mention `modules/holdings/` and the L4 `TokenList` |
| `apps/extension/tests/e2e/README.md` | new helpers in the conventions table |
| `implementations-plan/index.md` | entry |

### Algorithms

**Row classes** (`classifyRow`): `raw = BigInt(public ?? 0) + BigInt(private ?? 0)`; `unsynced =
raw === 0n && updatedAt === 0` (the projector never ran — `TokenCard.vue:50` renders a spinner for
it); `pinned` if the contract is in `pinnedContracts`; else `held-priced` if `raw > 0n` and
`fiatOf(tb) !== undefined`; else `held-unpriced` if `raw > 0n`; else `unsynced`; else `empty`.
Emptiness is classified BEFORE price, so a priced token with a zero balance never outranks a funded
unpriced one.

**Comparator** (`compareTokenRows`): class rank in the order above; inside `pinned` and
`held-priced`: fiat desc, unpriced pinned after priced pinned; inside every other class:
`stringCompare(name)`; final tiebreak `localeCompare(symbol)`. Unpriced is a class, never coerced
to $0 — the aggregate treats unpriced as "not counted", and sorting must not contradict it. Under
the fiat kill-switch `fiatOf` returns `undefined` for every row, so everything but pinned orders by
name and the summary shows no figure.

**Cap**: `capTokenRows(rows, 3)` → `{ shown: rows.slice(0, 3), overflow: rows.length - shown.length }`.
"View all →" renders iff `overflow > 0`. Pinned tokens with a zero balance are still ranked first and
therefore shown (dimmed like any empty row) — explicit beats automatic.

**Fold**: `isHiddenHolding` = `!pinned && !unsynced && (raw === 0n || !isAmountAboveDustThreshold({ amountRaw: raw.toString(), decimals, usdRate, thresholdMicro }))`.
The predicate fails OPEN (threshold 0, no rate, unparseable, invalid decimals → shown), so an
unpriced token with a balance never folds. `foldLabel`: `hidden === 0` → no row; `thresholdUsd === 0`
→ `${hidden} empty`; else `${hidden} hidden · ${empty} empty · ${dust} under $${thresholdUsd}`.

**Search** (`matchesQuery`): `q = query.trim().toLowerCase()`; empty `q` matches all; otherwise
`symbol.toLowerCase().includes(q) || name.toLowerCase().includes(q) || (q.startsWith("0x") &&
contract.toLowerCase().startsWith(q))`. No `RegExp`, no sanitizer. Pinned/rest/fold partition is
computed AFTER the filter; the divider renders only when both partitions are non-empty; the fold row
only when the hidden partition is non-empty; `ListStatusMessage variant="no-results"` when all three
are empty and `q` is non-empty.

**Pin toggle**: `pin(c)`: enqueue → read → prune to `knownContracts()` → if includes → `"already"`;
if `length >= PINNED_TOKENS_MAX` → `"full"` (no write); else append, write, `"pinned"`.
`unpin(c)`: enqueue → read → filter → write. Every read result is validated as in § Storage write
path. `onTokenDeleted(token)` → `unpin(token.contract)` if the event's `profileId`/`chainId` match
the scope. `chrome.storage.onChanged` for the key → `refresh()` (the `syncedRef` precedent: re-read
through the facade, never trust the event's value).

### Trade-offs & alternatives not taken

- **Pins on the `Token` entity (a backend flag)** — rejected: it is presentation state, per profile
  AND per network, and would put a presentation invariant (the cap) into the data layer. The UI key
  mirrors `balanceDisplayOption`'s proven shape. (Pre-production, neither design needs a migration
  today, so that is not the argument.)
- **Pins keyed by token id** — rejected after audit: ids are max+1 reallocatable
  (`token-balance/service.ts:519` comment), so a stale id could pin a successor; contracts are the
  stable identity per network and a re-added token keeping its pin is desirable.
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
- **A cross-context write lock (routing pins through a background service)** — deferred: the popup
  is one SPA; the only concurrent writer is a side panel open at the same instant, the loss is
  bounded to one pin, and `onChanged` converges every reader. If dogfooding shows it, a tiny
  `UiPrefsService` is the fix, not a Token flag.

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
   `data-testid="token-symbol" :data-symbol`; it owns a `PriceServiceClient` per row; `updatedAt === 0`
   means never synced (`:50`). Network tests select these directly (`tokens.test.ts:16-31`,
   `default-token-seeding.test.ts:39`, `fiat-send.test.ts:47`, `send-amount-clamp.test.ts:31`,
   `receive-unregistered.test.ts:62,103`); `navigateToTokenDetail` (`helpers.ts:793-803`) clicks the
   FIRST `tokens-card`, so ordering changes can change which token it opens.
5. `sendTransfer` (`helpers.ts:871-900`) never opens the token picker: it clicks `actions-send`,
   sets the from-type, fills amount and destination. No existing e2e exercises `SelectTokenPopup`.
6. `usePrices(client).tokenFiatMicro(token, raw)` returns `bigint | undefined`; unpriced is
   `undefined` at every layer (`composables/usePrices.ts:72-80`); only USDC-pegged contracts and Fee
   Juice are priced (`services/price/price-map.ts:55-72`). `showFiatValues` gates fiat rendering
   (`BalanceView.vue:82-90`); the incoming dust filter does not consult it.
7. `incomingDustUsdThreshold` is `z.number().nonnegative().default(0)` (`wallet/config/config.ts:45-49`),
   edited in `settings/appearance.vue:74-98` (`dust-threshold-input`), applied at read time by
   `IncomingTransferService.applyDustFilter` (`incoming-transfer/service.ts:577-608`) through
   `isReceiptAboveDustThreshold` (`utils/incoming-dust.ts:22-45`). `usdThresholdToMicro` rejects
   non-finite input but `1e308 × 1e6` overflows to `Infinity` before `BigInt` (`:13`), and
   `10n ** BigInt(decimals)` (`:44`) sits outside the try.
8. UI preferences persist through `storageLocalGet/Set` (`utils/storage.ts`), which waits for
   `migrationIdle()`; raw `chrome.storage` in UI code fails `utils/storage-facade-ban.test.ts`.
   `BalanceView.vue:194-220` is the per-profile → per-network map precedent; `composables/syncedRef.js:20-32`
   is the `chrome.storage.onChanged` re-read precedent. `nulo:ui:*` keys are outside
   `BACKUP_SLICE_REGISTRY` (`backup-migration-registry.ts:197-223`) and never backed up.
9. Token ids are max+1 reallocatable — a deleted token's id can be re-minted
   (`token-balance/service.ts:519` comment; `token/service.ts:785`).
10. `select_balance_type` is opened by nothing: grep over `apps/extension/src` and `tests` finds only
    `PopupManager.vue:341` and the popup. `displayOption` is read by `app.store.ts`,
    `app.store.shape.pins.test.ts:40,84`, `BalanceView.vue` and `BalanceView.test.ts` (S-A matrix
    L247-330, deletion tests L166-187).
11. `TokenMetadataPopup.vue:65-66,210` is the single-button popup shape; `ConfirmPopup.vue:134-155`
    always renders Cancel + Confirm. `popupStore.open(target, payload)` / `getPayload(target)` exist.
12. `SelectTokenPopup.vue` fetches `getTokens(profile.id, network.chainId)` and sets
    `cacheStore.activeTokenIdx`; `send.vue:89,99,402,438-495` resolve the selection from `?tokenId`,
    then `activeTokenIdx`, then `tokens[0]`.
13. `TokenServiceClient.onTokenDeleted` carries `TokenInfo & { profileId }`
    (`services/token/spec.ts:225`); `BalanceView.vue:182-188` is the UI precedent for reacting to it.
    `useEntityCrud` returns `{ entities, refresh({ clear? }), dispose }` (`composables/useEntityCrud.ts:58`)
    and does not resnapshot on reconnect by itself. Every background service client inherits
    `onConnected: EventHandler<void>` from `ServiceClient`
    (`packages/extension-messaging/src/background/client.ts:32,58`), fired on each port (re)connect.
14. The design `Input`'s `sanitize` prop strips everything outside letters, digits, space, `-._`
    (`packages/design/src/internal/sanitize.ts:12`) — unusable for a token search.
15. `tests/vitest.setup.ts:88-113` stubs `chrome.storage` as `{}`; every storage-touching test
    installs its own in-memory backing (`BalanceView.test.ts:121-156`, `app.store.test.ts:41-49`).
16. Scripts: `bun run lint` (biome + complexity baseline), `bun run typecheck` (vue-tsc on the
    extension), `bun run test` (extension vitest on Bun), `bun run build`, `bun run audit:vue`
    (typecheck ∥ test ∥ lint, then build), `bun run test:e2e` (smoke, Node Puppeteer — requires a
    prior `bun run build`: `tests/e2e/global-setup-smoke.ts:38` only checks that `dist/chrome`
    exists), `bun run e2e:agent [files|--shard=N/5]` (network; builds the wallet itself; owns anvil +
    sandbox; `NULO_E2E_PROVERLESS=1` for the fast build). Concurrent shards need separate worktrees:
    `agent.sh` rewrites `.e2e-state/ports.json`, clears boot sentinels and rebuilds `dist/chrome`
    (`scripts/e2e/agent.sh:7,21,94`); `global-setup.ts:206` kills Chrome by extension path;
    `tests/e2e/README.md:125` says so. CI's smoke and network filters are whole-package
    `apps/extension/**`, so every PR here runs both.
17. `gh stack` v0.0.1 is installed on the Mac and the homelab; the homelab has Chrome, foundry
    (anvil), bun, claude, agent-worktree and a non-interactive signing key.

### Inferences (unverified, attackable)

1. The sandbox network suite never registers more than three tokens in one test, so a Home cap of
   3 strands no existing `tokens-card` selector. Not proven suite-wide; the Phase 2 gate runs the
   files that select cards, and the helper change in Phase 2 removes the order dependence.
2. Extra `PriceServiceClient`s (TokensView, holdings page, Send popup) are cheap: the price service
   caches and throttles refreshes (`services/price/service.ts:145`) and `usePrices`' ticker only
   re-evaluates freshness. Moderate confidence.
3. `useEntityCrud` over `getTokenBalances(undefined, account)` with the three balance events plus an
   `onConnected` resnapshot is sufficient for Holdings, because adding a token creates a balance
   row for every account (`token-balance/service.ts:476`).
4. `MaterialIcon name="home"` and `push_pin` exist in the bundled Material Symbols subset. Phase 1
   and Phase 6 gates include a rendered check; fall back to `account_balance_wallet` / the existing
   `Icon` set if a glyph is missing.
5. Two proverless network shards in parallel (two worktrees) fit in 30 GB RAM. Unknown; Phase 7 is
   sequential by default and the parallel form is opt-in after a first measured run.

### Asks (resolved with the owner, 2026-09-06)

- Tab label → **Holdings**. Send picker reuse → **yes**. Retire the balance-display popup → **yes**.
  Dust → **reuse the existing setting**. Rows carry **no** chip or glyph. Cap → **3**, refusal → an
  **informational popup** titled "Home is full". Validation → unit/component on every phase, smoke at
  every arc end, targeted proverless network files per arc, the full network suite sharded at the
  end. `code_review: off`. Delivery → **three stacked PRs**.
- Decided by the plan on the owner's behalf (surface at the gate; cheap to flip): the fold applies in
  the Send picker; picker search appears only past three tokens; list state resets on every open;
  unpriced pinned tokens sort after priced pinned ones; the fold ignores the fiat kill-switch.

No unresolved Asks.

## Phases

Each phase ends with a **Validation gate**: the commands must exit 0 and the pass criteria hold
before the phase is marked ✓ in this file. The fast layers run after every meaningful edit inside a
phase too. `<fast>` and `<smoke>` below mean:

```bash
<fast>  = bun run lint && bun run typecheck && bun run test
<smoke> = bun run build && bun run test:e2e          # the smoke runner does not build (Fact 16)
```

Network gates run in tmux: `tmux new-session -d -s hhp-<phase> "cd $PWD && NULO_E2E_PROVERLESS=1 bun run e2e:agent <files> > ~/.cache/hhp-<phase>.log 2>&1; echo EXIT=\$? >> ~/.cache/hhp-<phase>.log"`,
then poll `tail -n1 ~/.cache/hhp-<phase>.log` until it reads `EXIT=…`. `EXIT=86` is an infra boot
failure (`bun run e2e:reap`, rerun); anything else non-zero is a real failure.

### Arc A — nav + Home (branch `worktree-home-holdings-pin`)

#### Phase 1 — four tabs and an empty Holdings page

- `Navigation.vue`: `[general → HOME (home icon), holdings → HOLDINGS, activity, settings]`.
- `pages/holdings.vue`: route block, app header, a `SectionLabel label="Holdings"` placeholder body,
  `data-testid="holdings-page"`. Real content lands in Phase 3.
- `tests/e2e/fixtures/helpers.ts`: `clickNavTab` union gains `"holdings"`; add `openHoldings(page)`
  (`clickNavTab` + `waitForHash("#/popup/holdings")`).
- `tests/e2e/navigation.test.ts`: assert the four tabs round-trip by hash.

Validation gate — `<fast>`; `bun run build && bun run --cwd apps/extension test:e2e tests/e2e/navigation.test.ts`;
the built popup opened once (`bun run build` then load `apps/extension/dist/chrome` unpacked, or the
smoke screenshot) shows the `home` glyph, not a tofu box. Pass: exit 0; four hashes in the spec.
Layers: lint/typecheck · unit · smoke.

#### Phase 2 — Home order, cap, "View all →", aggregate-only hero

- `token-order.ts` + tests: classes, comparator (pinned set is a parameter, empty until Arc C),
  `orderTokenRows` (copy, never mutates), `capTokenRows`, `HOME_TOKEN_ROWS`. Cases: priced desc;
  priced-zero below unpriced-funded; unsynced above empty; name order inside classes; overflow.
- `token-aggregate.ts` + tests: `aggregateFiat` lifted from `BalanceView`.
- `TokensView.vue`: a `PriceServiceClient` + `usePrices` (disposed in `onBeforeUnmount` AFTER the
  service disconnects, per the cleanup-order rule), `orderTokenRows` + `capTokenRows`, section title
  **HOLDINGS** with the total count, `tokens-view-all` link (`router.push("/popup/holdings")`) when
  `overflow > 0`. `TokensView.test.ts`: two new cases — order and cap/overflow; the existing
  sync-state cases untouched.
- Retire the display option: delete `SelectBalanceTypePopup.vue`, its `PopupManager` lines, the
  `displayOption` ref in `app.store.ts` and the key in `app.store.shape.pins.test.ts`; `BalanceView`
  shows the aggregate over both sides unless `tokenBalance` is passed; remove load/save + watchers;
  `BalanceView.test.ts`: replace the S-A matrix with three cases (aggregate with prices, partial
  caption, fiat kill-switch hides the figure) and keep the deletion cases as "list stays consistent".
- `helpers.ts`: `navigateToTokenDetail(page, symbol?)` selects
  `[data-testid="tokens-card"]:has([data-symbol="<symbol>"])` when given; audit every caller and pass
  the symbol where the test cares which token opens.

Validation gate — `<fast>`; `<smoke>`; network, targeted:
`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/tokens.test.ts tests/e2e/network/default-token-seeding.test.ts tests/e2e/network/fiat-send.test.ts tests/e2e/network/incoming-public-transfers.test.ts`.
Pass: exit 0 everywhere; `TokensView.test.ts` and `BalanceView.test.ts` green with the new cases;
`fiat-display.test.ts` green in the smoke run. Layers: lint/typecheck · unit · smoke · network (targeted).

**Arc A boundary**: `bun run audit:vue` green; run the arc quality loop (§ Post-implementation);
THEN `gh stack init --adopt worktree-home-holdings-pin --base dev` and `gh stack add home-holdings-pin/holdings`.

### Arc B — Holdings page + TokenList + Send picker (branch `home-holdings-pin/holdings`)

#### Phase 3 — TokenList and the Holdings page

- `incoming-dust.ts`: export `isAmountAboveDustThreshold`; `isReceiptAboveDustThreshold` becomes an
  alias; move `10n ** BigInt(decimals)` inside the try; tests for an extreme threshold, invalid
  decimals (negative, non-integer, > 77), malformed balances → all fail open. `config.ts`: bound the
  threshold with `.max(1_000_000)` (+ schema test).
- `token-fold.ts`, `token-search.ts` + tests: hidden classes, pinned/unsynced exempt, label
  variants; query matching incl. `0x` prefix and punctuation symbols.
- `TokenCard.vue`: `mode`/`selected`/`data-token-id`; `TokenCard.test.ts` gains link-vs-button,
  emitted `select` carries `token.id`, selected marker + `aria-selected`.
- `TokenList.vue` + `TokenList.test.ts` covering: filter by symbol/name/contract; sort toggle; pinned
  partition + divider presence rules; fold label variants and expand; pinned and unsynced never
  fold; no-results; select emits the token id; selected marker; listbox semantics in select mode;
  empty rows.
- `pages/holdings.vue`: summary (`holdings-summary`), loading/error states, clients and watches as in
  § Data & control flow, `TokenList mode="link"`. Copy per § Copy.
- `settings/appearance.vue`: dust copy widened.
- `tests/e2e/network/holdings.test.ts`: open Holdings, the sandbox token renders as `tokens-card`
  with real balances, typing its symbol into `holdings-search` keeps it, a miss shows the no-results
  message, the sort toggle flips its label.

Validation gate — `<fast>`; `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/holdings.test.ts tests/e2e/network/tokens.test.ts`.
Pass: exit 0; every listed TokenList behaviour has a green case. Layers: lint/typecheck · unit/component · network (targeted).

#### Phase 4 — Send picker on TokenList

- `SelectTokenPopup.vue`: on show, fetch balances for the account (scope-guarded), `TokenList
  mode="select" :selectedTokenId="cacheStore.activeTokenIdx" :showSearch="rows.length > HOME_TOKEN_ROWS"`,
  keep the "Manage tokens" row; clients created on show, disconnected on hide. `send.vue` untouched.
- `helpers.ts`: `selectSendToken(page, symbol)` — click `send-token-trigger`, click the
  `tokens-card:has([data-symbol=...])` inside the popup, wait for the popup to close.
- `tests/e2e/network/send-picker.test.ts`: with two tokens present (the sandbox token + one
  `importToken`), open Send, pick the other token, assert `send-token-trigger` shows its symbol,
  reopen the picker and assert the row is `aria-selected`.

Validation gate — `<fast>`; `<smoke>`;
`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/send-picker.test.ts tests/e2e/network/transfers.test.ts tests/e2e/network/send-amount-clamp.test.ts tests/e2e/network/fiat-send.test.ts`.
Pass: exit 0. Layers: lint/typecheck · unit · smoke · network (targeted).

**Arc B boundary**: `bun run audit:vue` green; arc quality loop; THEN `gh stack add home-holdings-pin/pins`.

### Arc C — pins (branch `home-holdings-pin/pins`)

#### Phase 5 — `usePinnedTokens`

- `storage-keys.ts`: `pinnedTokens: (profileId: string) => \`nulo:ui:pinnedTokens@${profileId}\``.
- `usePinnedTokens.ts` + `usePinnedTokens.test.ts` covering: read validation of hostile shapes
  (non-object, non-array, non-strings, bad hex, duplicates, > 3); pin returns pinned/full/already;
  unpin; cap counts only known contracts (three dangling entries do not make it full; they are pruned
  on the next write); per-network isolation; scope change refresh; deletion event for the scope
  splices, for another scope is ignored; a deletion missed while disconnected is pruned by the next
  read; concurrent `pin`/`unpin` in one context serialise (the last state is consistent); a rejected
  write leaves the chain usable; `onChanged` triggers a re-read; dispose unsubscribes.

Validation gate — `<fast>`. Pass: exit 0, composable suite green. Layers: lint/typecheck · unit.

#### Phase 6 — the menu item, the popup, and the order everywhere

- `PinLimitPopup.vue` (+ test: renders symbol + pinned symbols, Got it closes, close button, payload
  missing or malformed → renders nothing harmful) and its `PopupManager` line.
- `pages/tokens/[id].vue`: `usePinnedTokens` (parent owns the `TokenServiceClient` it already has),
  `token-menu-pin` item with the two labels and `data-pinned`, toasts, popup on `"full"`. Rendered
  check of the `push_pin` glyph (fallback: the existing `Icon` set).
- `TokensView.vue`, `pages/holdings.vue`, `SelectTokenPopup.vue`: pass `pinnedContracts` into the
  order.
- `helpers.ts`: `pinFromTokenPage(page)`; `tests/e2e/network/pin-to-home.test.ts`: open the sandbox
  token's page, pin, back to Home → the row is first and `token-menu-pin` reads `data-pinned="true"`,
  close and reopen the popup → still pinned, unpin → `data-pinned="false"`.
- Docs: `CLAUDE.md` component model (holdings module), e2e README helper table,
  `implementations-plan/index.md` entry, lessons.

Validation gate — `<fast>`; `<smoke>`;
`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/pin-to-home.test.ts tests/e2e/network/holdings.test.ts tests/e2e/network/tokens.test.ts`.
Pass: exit 0. Layers: lint/typecheck · unit/component · smoke · network (targeted).

#### Phase 7 — final full network suite, sharded

Default — sequential, one worktree, one tmux session (safe; ~1.5–3 h):

```bash
tmux new-session -d -s hhp-full "cd $PWD && for s in 1 2 3 4 5; do NULO_E2E_PROVERLESS=1 bun run e2e:agent --shard=\$s/5 > ~/.cache/hhp-shard-\$s.log 2>&1; echo EXIT=\$? >> ~/.cache/hhp-shard-\$s.log; done"
# poll: until every file ends EXIT=…
tail -n1 ~/.cache/hhp-shard-*.log
```

Optional 2× — two worktrees (concurrent shards from one worktree collide, Fact 16). Only after the
first measured shard shows headroom in `free -g`:

```bash
git worktree add --detach ../hhp-shards-b HEAD && (cd ../hhp-shards-b && bun install --frozen-lockfile)
tmux new-session -d -s hhp-a "cd $PWD             && for s in 1 3 5; do NULO_E2E_PROVERLESS=1 bun run e2e:agent --shard=\$s/5 > ~/.cache/hhp-shard-\$s.log 2>&1; echo EXIT=\$? >> ~/.cache/hhp-shard-\$s.log; done"
tmux new-session -d -s hhp-b "cd $PWD/../hhp-shards-b && for s in 2 4;   do NULO_E2E_PROVERLESS=1 bun run e2e:agent --shard=\$s/5 > ~/.cache/hhp-shard-\$s.log 2>&1; echo EXIT=\$? >> ~/.cache/hhp-shard-\$s.log; done"
# afterwards: git worktree remove ../hhp-shards-b
```

Validation gate — `<fast>`; the five shard logs end `EXIT=0` (an `EXIT=86` is an infra boot failure:
`bun run e2e:reap`, rerun that shard). Layers: everything. After the final `gh stack sync` (if `dev`
moved), rerun `<fast>` and `<smoke>` on the synced tip before submitting.

## Security & adversarial considerations

- **Threat surface**: UI-only change, no new permissions, no network calls, no new dependencies
  (`bun.lock` unchanged — checked at every arc boundary). Attackers reach it through storage
  contents, token metadata and the settings value.
- **Hostile storage**: the pins key is validated on every read (object → array → strings →
  lowercase `0x` + 64 hex → de-duplicated → truncated to the cap); anything else is treated as
  empty. A poisoned map can at most reorder rows. The popup payload is validated the same way.
- **Hostile token metadata**: symbols and names come from contracts. They render through Vue
  interpolation (escaped) in rows, in the popup and in toasts; long strings are clipped by the
  existing row CSS; the search compares lowercase strings and never builds HTML or regexes from input
  (`String.prototype.includes`, no `RegExp`). Duplicate symbols are possible and are never used as
  identity — contracts are.
- **Search input**: local state, never persisted, never sent anywhere; no sanitizer (it would
  mangle symbols), so nothing is transformed before comparison.
- **Numeric path**: the threshold is bounded in the schema (`max(1_000_000)`) so
  `usdThresholdToMicro` cannot overflow; the predicate keeps every bigint operation inside its try
  and fails open, so a malformed balance or an absurd `decimals` can never throw out of a render.
- **Dust and prices**: the fold fails open (unknown price → shown), so a price-feed failure can never
  hide a holding; pinned tokens are exempt so a hostile threshold cannot hide what the user chose.
- **Deletion**: removing a token drops its contract from the pins list; a dangling contract that
  appears anyway (storage edited, event missed) is ignored by ordering and pruned on the next write,
  and never counts toward the cap.
- **Least privilege / supply chain**: nothing new; CI's frozen lockfile and 7-day min-age policies
  are untouched.

## Copy

- Tabs: `HOME`, `HOLDINGS`, `HISTORY`, `SETTINGS`.
- Home section header: `HOLDINGS` + count; link `View all →`.
- Holdings summary: fiat total (or nothing under the fiat kill-switch), `N tokens`,
  `priced assets only` when partial. Loading: the design `LoadingState`. Error: `Couldn't load
  holdings` + the existing retry idiom if one exists on the page, else the pull-to-refresh menu on Home.
- Search placeholder: `Search tokens`. Sort toggle: `Value ↓` / `Name A–Z`.
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

Mechanics: during Arc A checkpoint with plain `git push`. After Arc A's loop,
`gh stack init --adopt worktree-home-holdings-pin --base dev`, then `gh stack add home-holdings-pin/holdings`;
from here `gh stack push` at every checkpoint (a branch push without a PR triggers no CI). After Arc
B's loop, `gh stack add home-holdings-pin/pins`. After the cross-arc pass: `gh stack sync` (if `dev`
moved) and rerun `<fast>` + `<smoke>` on the tip, then `gh stack submit --auto`, then `gh pr edit`
each PR with a Conventional-Commit title ≤ 93 chars (`feat(popup): home shows three holdings and a
holdings tab`, `feat(holdings): holdings page, token list and send picker`, `feat(popup): pin to
home`) and a body, then `gh pr checks --watch`. `gh stack merge` lands the named PR and everything
below it — the owner's call, never autonomous.

## Decision ledger

- **Chosen outline**: plan.md (TokenList + selectable TokenCard + UI storage key + dedicated
  informational popup). Codex round 1 concurred; the alternative (`outline-alt.md`) breaks two fixed
  owner decisions (separate Send rendering, two PRs) and moves presentation policy onto `Token`.
- **Absorbed from the alternative** (via codex): identity-safe persistence — pins keyed by contract,
  cap counted against the live token set, pruning; serialised writes.
- **Rejected**: pins on the Token entity; TokensView `variant`; ConfirmPopup single mode; disabling
  the menu item when full; a second dust threshold; renaming the Home route; a cross-context write
  lock (deferred with a named fallback).
- **Still disputed**: none blocking. Codex prefers the popup title "Pin limit reached"; the owner
  approved "Home is full" in the mockups and it stays. The parallel-shard speed-up is opt-in after a
  measured run rather than assumed.

## Audit outcome

- **Codex round 1** (`audit-codex.md`, Astra `high`): `reject` — smoke gates without a build, an
  empty Send-picker claim, unsafe parallel shards, and pin-persistence gaps (id reuse, dangling ids,
  cross-instance writes). All adopted in r2 except the popup-title copy. Second-order fixes made in
  the same pass: comparator classifies emptiness before price, never-synced rows never fold, the
  search field drops the sanitizer, numeric path bounded, `navigateToTokenDetail` takes a symbol.
- **Fable**: _pending_.
- **Final fresh-context codex pass**: _pending_.

## Seeds

_Draft until the approval gate; finalized after approval._

```
/goal All seven phases marked ✓ in implementations-plan/home-holdings-pin/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate reported passing in the transcript (smoke gates preceded by `bun run build`; network gates read from their tmux log ending EXIT=0); for each phase the agent has printed `LESSONS_FILE=implementations-plan/home-holdings-pin/lessons/phase-N.md`; `/code-review` was NOT run (code_review is off); the codex fix loop converged for each of the three arcs at its boundary AND for the final cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings quoted in the transcript; the three-PR stack exists on GitHub, created only after all loops converged (`gh stack view` output in the transcript); `bun run test` and `bun run lint` both report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/home-holdings-pin forward. Never idle waiting for my input. Each firing:
1. **Reality check**: read implementations-plan/home-holdings-pin/plan.md and lessons/ (authoritative state — not the chat); native task list empty (fresh session)? rebuild it from plan.md, one task per remaining phase; run `git status` and `git log --oneline -5`. If a PR exists, `gh stack view`. Without a PR, `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. **Waiting on CI or a tmux e2e run is fine** — confirm it's progressing (`gh run watch <run-id>` up to 10 minutes; `tail -n2 ~/.cache/hhp-*.log`); use the wait to prep the next phase or strengthen tests. Don't start work that conflicts with the in-flight change.
3. **No task in hand?** Pick the next pending phase from plan.md and start it. After each meaningful edit run `bun run lint && bun run typecheck && bun run test`. Commit (signed — the homelab signs non-interactively) → `git push` (before the stack exists) / `gh stack push` (after).
4. **Stuck, or facing a decision you'd normally bring to me?** Don't wait. Call `/codex high` with full context and go back and forth until you two reach a defensible decision, then act on it. Log every consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge to dev or main, never publish or deploy, never expand scope beyond plan.md; if a decision requires crossing one, surface it and hold.
5. **Same step failed 5 times?** Stop retrying; reassess the approach with codex, then continue down the agreed path.
6. **Phase green?** "Green" means THE PHASE'S VALIDATION GATE as written in plan.md passes (smoke = build first; network = tmux log ends EXIT=0). Run the full gate, paste the result, mark ✓ in plan.md, file the lessons entry, print `LESSONS_FILE=implementations-plan/home-holdings-pin/lessons/phase-N.md`, advance. Arc boundary crossed (per plan.md's Delivery section)? `bun run audit:vue` green, then the arc's codex loop FIRST (plan.md § Post-implementation: arc diff + plan + ledger + arc map + the no-over-engineering and comment-quality rules, resume until a round yields nothing material) — THEN `gh stack init`/`gh stack add` per plan.md.
7. **All seven phases ✓?** Run the final cross-arc codex pass (FRESH session, net diff from dev@2a3d2d87, cross-arc ask, same loop-until-clean), then Delivery per plan.md — the FIRST time any PR is opened: `gh stack sync` if dev moved and rerun the fast + smoke gates, `gh stack submit --auto`, `gh pr edit` bodies, `gh pr checks --watch`. Then write the wrap-up report: what shipped, every contentious decision codex and I debated with ELI5 context, open items. Surface and stop.

Keep the native task list current; plan.md stays the source of truth.
```
