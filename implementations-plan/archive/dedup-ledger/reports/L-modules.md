# Cluster L — popup feature modules (`apps/extension/src/popup/components/modules/`)

## Cluster verdict

Overall quality is decent — the `.ts` helper files (`fee-helpers.ts`, `recent-activity-rows.ts`,
`recent-activity-handlers.ts`, `authwit-helpers.ts`, `fpc-helpers.ts`, `tx-detail-helpers.ts`,
`useContactImportExport.ts`) are already well-factored, pure, and unit-tested — this is not
vibecoded slop at the logic layer. The duplication that exists is concentrated in two shapes: (1)
**`<style module>` CSS blocks copy-pasted verbatim across sibling SFCs** because Vue CSS Modules
don't compose across files without an explicit shared partial, and (2) **one large component
(`RecentActivityView.vue`, 994 lines) that duplicates ~90% of its own template** across two
near-identical `v-if`/`v-else-if` branches. The biggest lever is the CSS duplication inside
`send/` (four components repeating the same `.detail_row` block, three repeating a shimmer
skeleton) — a single shared partial removes ~70-90 lines with near-zero behavioral risk, since
every affected component already has a dedicated `.test.ts`. Total removable across this cluster:
roughly **230-260 lines**, none of it requiring new abstractions the codebase doesn't already have
a precedent for (a `ListStatusMessage` composite already exists and is used in 6 other pages; two
of the files in *this* cluster reinvent it instead of importing it).

## Findings

### F1 [duplication] The `send/` fee-card family repeats three CSS blocks verbatim, 3-4x each

- **Where:**
  - `.detail_row` (6-line block): `apps/extension/src/popup/components/modules/send/FeeSettingsCard.vue:686-692`, `send/FeeCostReadout.vue:39-45`, `send/FeePriorityRow.vue:39-45`, `send/FeeMethodRow.vue:51-57`
  - `.fee_label` (6-line block): `send/FeeMethodSelector.vue:64-71`, `send/FeeCostReadout.vue:47-54`, `send/FeePriorityRow.vue:47-54`
  - `.skeleton` + `@keyframes shimmer` (21-line block): `general/GasBalanceCard.vue:250-262`, `send/FeeMethodRow.vue:59-80`, `send/FeeCostReadout.vue:68-89`

- **Evidence** (`.detail_row`, identical in all four files):
  ```css
  .detail_row {
  	background: transparent;
  	overflow: hidden;
  	border-top: 1px solid rgba(74, 70, 63, 0.2);

  	padding: 10px 12px;
  }
  ```
  `.skeleton`/`shimmer` (identical modulo line-wrapping, `GasBalanceCard.vue:250-262` vs `send/FeeMethodRow.vue:59-80`):
  ```css
  .skeleton {
  	display: inline-block;
  	width: 60px;
  	height: 12px;
  	background: linear-gradient(90deg, var(--nulo-surface-high) 25%, var(--nulo-surface) 50%, var(--nulo-surface-high) 75%);
  	background-size: 200% 100%;
  	animation: shimmer 1.5s infinite;
  }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  ```

- **Refactor:** Add one shared, non-scoped stylesheet, e.g.
  `apps/extension/src/popup/components/modules/send/_fee-shared.module.css`, holding `.detailRow`,
  `.feeLabel`, `.skeleton` + `@keyframes shimmer`. Each SFC does
  `import feeShared from "./_fee-shared.module.css"` and swaps `$style.detail_row` →
  `feeShared.detailRow` (Vue SFCs can import an external CSS-module file directly; this is
  standard CSS-Modules composition, no new tooling). `GasBalanceCard.vue` lives in `general/` but
  is L4 like the `send/` files, so it can import the same partial, or the skeleton piece can go one
  layer down into `@nulo/design` (L2) as it's a generic loading primitive with no existing home —
  larger payoff, larger PR; the local partial is the low-risk version.
- **LOC delta:** -70 to -90 (24 dup lines of `.detail_row` → 6+4 imports; 18 dup lines of
  `.fee_label` → 6+3 imports; 63 dup lines of `.skeleton`/shimmer → 21+3 imports).
- **Risk / tests:** Low — pure CSS move, no markup/logic change. Covered by
  `send/FeeSettingsCard.test.ts`, `send/FeeCostReadout.test.ts`, `send/FeePriorityRow.test.ts`,
  `send/FeeMethodRow.test.ts`, `general/GasBalanceCard.test.ts`, plus the cross-card
  `modules/fee-cards.comount.test.ts` composition test that mounts `FeeSettingsCard` and
  `GasBalanceCard` together against the real store.
- **Confidence:** high.

### F2 [duplication] `RecentActivityView.vue` renders the whole card twice for `token` vs `!token`

- **Where:** `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:797-863` (token branch) and `:864-917` (!token branch).
- **Evidence** — the two `<Flex>` blocks are identical except for the outer `v-if` and one inner `v-else-if`:
  ```vue
  <!-- line 799 -->
  <Flex v-if="token && (executingTask || showJournalAwaiting || isTokenAwaitingTx || recentActivityRows.length)" ...>
    ...
    <TransactionAwaitingCard v-else-if="!renderedInFlightOps.length && isTokenAwaitingTx" />
    ...
  </Flex>
  <!-- line 865 -->
  <Flex v-else-if="!token && (executingTask || showJournalAwaiting || recentActivityRows.length || awaitingAccountTxs.length)" ...>
    ...
    <TransactionAwaitingCard v-else-if="!renderedInFlightOps.length && awaitingAccountTxs.length" />
    ...
  </Flex>
  ```
  Every other line inside the two blocks — the section header, the `v-for` over `renderedInFlightOps`,
  the orphan-task card, and the `v-for="row in recentActivityRows"` chain of three card types — is
  byte-identical between the two branches.
- **Refactor:** Merge into one `<Flex>` block. Add a computed
  `const showFallbackAwaiting = computed(() => token ? isTokenAwaitingTx.value : awaitingAccountTxs.value.length > 0)`
  (this ternary is already inlined once, at line 96, inside `recentActivityRows`'s
  `fallbackRendered` calculation — reuse it) and use it for both the outer visibility condition and
  the single `v-else-if` fallback card. The third branch (`v-else-if="token"`, the token empty
  state at lines 918-927) is genuinely distinct and stays.
- **LOC delta:** -50 to -55 (120 lines of near-duplicate template → ~66).
- **Risk / tests:** Med — this is the most state-heavy file in the cluster (30+ computeds/watchers)
  and the template branches gate on subtle in-flight/terminal/orphan interactions documented at
  length in the surrounding comments (cancel-dupe fixes, account-switch containment). Any merge
  must preserve the exact per-branch conditions. Covered by
  `general/RecentActivityView.test.ts`, which asserts on `data-testid="activity-feed-root"` and the
  card list, plus the file's own `defineExpose` surface used by "Layer-A containment" tests.
- **Confidence:** high on the duplication; medium on the safety of the merge given the density of
  documented edge cases nearby.

### F3 [duplication] Two files reimplement the existing `ListStatusMessage` composite's empty state

- **Where:** `general/TokensView.vue:438-451,503-529` and `general/RecentActivityView.vue:918-927,967-993`. The real component: `apps/extension/src/components/composite/ListStatusMessage.vue`.
- **Evidence** — `RecentActivityView.vue:967-993` vs `TokensView.vue:503-529`, byte-identical CSS:
  ```css
  .empty_state {
  	display: flex;
  	flex-direction: column;
  	align-items: center;
  	gap: 8px;

  	padding: 32px 16px;
  	border: 1px dashed var(--nulo-border);

  	text-align: center;
  }
  .empty_headline { font-family: var(--font-headline); font-size: 14px; font-weight: 700;
  	letter-spacing: 0.1em; text-transform: uppercase; color: var(--nulo-secondary); }
  .empty_sub { font-family: var(--font-mono); font-size: 11px; line-height: 1.4; color: var(--nulo-outline); }
  ```
  ...and `ListStatusMessage.vue:29-57` already defines the exact same three rules under the names
  `.empty`, `.empty_headline`, `.empty_sub`. It's already the pattern used by 6 other pages
  (`popup/pages/settings/{tokens,contacts,advanced/account-state/{notes,authwits,contracts,senders}}/index.vue`)
  — this cluster's two files are the odd ones out.
- **Refactor:** `RecentActivityView.vue`'s empty state (a plain string `sub`) is a drop-in:
  `<ListStatusMessage variant="empty" headline="NOTHING HERE YET" :sub="\`Send or receive ${token.symbol} to see activity here.\`" testid="activity-feed-root" />`.
  `TokensView.vue`'s empty state embeds a clickable "Tap" button inside the sub-line
  (`data-testid="tokens-empty-import-link"`), which `ListStatusMessage`'s current `sub: String`
  prop can't carry — it needs a small addition (a default/`#sub` slot, falling back to the `sub`
  prop) before `TokensView` can switch over. That's a ~5-line change to the shared composite, done
  once, then both call sites drop their local `.empty_state`/`.empty_headline`/`.empty_sub` CSS.
- **LOC delta:** -30 to -35 net (removes ~34 lines of duplicated CSS across the two files; adds
  ~5 lines to `ListStatusMessage.vue` + 2 short call sites).
- **Risk / tests:** Low for `RecentActivityView` (no test asserts on the removed class names, only
  `data-testid="activity-feed-root"`, which is preserved on the wrapper). Low-medium for
  `TokensView` since it needs the composite's slot addition first — `ListStatusMessage` has no
  dedicated test file today, so add a slot-render case there when extending it.
- **Confidence:** high.

### F4 [duplication] `incomingCardProps()` duplicated verbatim — the sibling helper was already deduped once

- **Where:** `general/RecentActivityView.vue:246-256` and `activity/TransactionsList.vue:83-93`.
- **Evidence:**
  ```js
  // RecentActivityView.vue:246
  function incomingCardProps(inc) {
  	const token = inc.tokenId !== undefined ? tokenById(inc.tokenId) : undefined
  	return {
  		tokenSymbol: token?.symbol || "Token",
  		amountRaw: inc.amountRaw,
  		tokenDecimals: token?.decimals || 0,
  		txHash: inc.txHash,
  		amountFiat: token ? (incomingPrices.tokenFiatLabel(token, BigInt(inc.amountRaw || 0)) ?? null) : null,
  		receivedLabel: receivedLabel(resolveReceivedType(inc)),
  	}
  }
  ```
  ```js
  // TransactionsList.vue:83
  function incomingCardProps(inc) {
  	const token = props.tokensById[inc.tokenId]
  	return {
  		tokenSymbol: token?.symbol || "Token",
  		amountRaw: inc.amountRaw,
  		tokenDecimals: token?.decimals || 0,
  		txHash: inc.txHash,
  		amountFiat: token ? (prices.tokenFiatLabel(token, BigInt(inc.amountRaw || 0)) ?? null) : null,
  		receivedLabel: receivedLabel(resolveReceivedType(inc)),
  	}
  }
  ```
  Only the `token` lookup (function vs. map) and the `prices` instance differ; the returned object
  is line-for-line the same 6 fields. Notably, `TransactionsList.vue:95-97` already has a comment
  explaining this exact drift happened once before and was fixed for the sibling terminal-card
  resolver: *"Previously this file inlined a byte-identical duplicate of RecentActivityView's
  resolver; the shared helper closes the drift surface."* — that fix (`buildJournalTerminalCardProps`
  in `@/utils/journal-state.ts`) was never applied to `incomingCardProps`.
- **Refactor:** Add `buildIncomingCardProps(inc, { tokenById, tokenFiatLabel })` to
  `apps/extension/src/utils/journal-state.ts` (same home as its sibling helper), taking a
  `tokenById` function and a `tokenFiatLabel` function so both call sites pass their own lookup
  strategy (map vs. function) and price-service instance.
- **LOC delta:** -8 (two 11-line functions → one 13-line helper + two 2-line call sites).
- **Risk / tests:** Low. `general/RecentActivityView.test.ts` covers the `RecentActivityView` call
  site; `TransactionsList.vue` has no dedicated test file today (covered by the Archives page e2e)
  — worth a quick smoke check after the change, not a blocker.
- **Confidence:** high.

### F5 [duplication] The "chevron-toggle disclosure" CSS + inline style is copy-pasted in `tx/`

- **Where:** `tx/TxFeeRow.vue:119-138` (`.fee_row_toggle`) and `tx/TxDebugPanel.vue:100-119` (`.debug_toggle`); the chevron rotate inline style at `TxFeeRow.vue:41-44` and `TxDebugPanel.vue:34`.
- **Evidence** (byte-identical 18-line block, only the class name differs):
  ```css
  .fee_row_toggle {           /* .debug_toggle in TxDebugPanel.vue is identical */
  	display: flex;
  	align-items: center;
  	justify-content: space-between;
  	width: 100%;

  	padding: 0;
  	background: transparent;
  	border: none;
  	cursor: pointer;

  	color: inherit;
  	text-align: inherit;

  	transition: opacity 0.2s ease;

  	&:hover { opacity: 0.8; }
  }
  ```
  Both components also independently render the same "chevron that rotates 180° when expanded"
  button (`TxFeeRow.vue:36-45`, `TxDebugPanel.vue:28-36`) — a third near-instance of the same idiom
  (different syntax, same rotate/transition values) shows up in
  `settings/connected-apps/GrantedCapabilitiesList.vue:41-46`.
- **Refactor:** Extract a small local composite, e.g. `tx/DisclosureToggle.vue` (or
  `src/components/composite/DisclosureToggle.vue` if the third occurrence in
  `connected-apps/` is folded in): a `<button>` wrapping a label slot + the rotating chevron,
  driven by a `expanded` boolean prop/model. `TxFeeRow.vue` and `TxDebugPanel.vue` both use it for
  their toggle header.
- **LOC delta:** -20 to -25 (two 18-line CSS blocks + two small JS/template chevron blocks → one
  ~30-line composite + two ~5-line usages).
- **Risk / tests:** Med — neither `TxFeeRow.vue` nor `TxDebugPanel.vue` has a dedicated
  `.test.ts` (only `tx/tx-detail-helpers.test.ts` for the pure helpers they consume); regression
  coverage is whatever E2E touches `pages/tx/[id].vue`. Flag this as needing a quick component test
  for the new `DisclosureToggle` if extracted, though the brief excludes proposing new tests as a
  finding — noting it here as a pre-existing gap this refactor would expose.
- **Confidence:** medium (only 2 exact-CSS sites; the third is a look-alike, not a byte match).

### F6 [duplication] The `(await storageLocalGet(K))[K] || {}` idiom repeated 3x in one file

- **Where:** `send/FeeSettingsCard.vue:191, 417, 498`.
- **Evidence:**
  ```js
  const fpms = (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}   // line 191
  const saved = (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}  // line 417
  const saved = (await storageLocalGet(FEE_METHOD_LS_KEY))[FEE_METHOD_LS_KEY] || {}  // line 498
  ```
- **Refactor:** One-line helper in the same file: `const readFeeMethodsMap = () => storageLocalGet(FEE_METHOD_LS_KEY).then((r) => r[FEE_METHOD_LS_KEY] || {})`, replacing all three call sites with `await readFeeMethodsMap()`.
- **LOC delta:** -4 (small, but it's the exact same expression repeated three times in one file — a pure mechanical win with no design decision attached).
- **Risk / tests:** Low. Covered by `send/FeeSettingsCard.test.ts`.
- **Confidence:** high.

## Not worth it

- **`BalanceView.vue:194-220`** (`loadBalanceDisplayOption`/`saveBalanceDisplayOption`) — same
  "read a JSON map from storage, get/set one key" shape repeated twice in one file, but each copy
  is ~13 lines (under the >20-line bar for a twice-only repeat) and the read/write branches differ
  enough (one conditionally writes a default, one only writes on change) that a shared helper would
  need its own branching parameter — not worth it for ~8 saved lines.
- **`settings/new-profile/NewProfileCredentials.vue` vs `NewProfileMethodTabs.vue`** — both define
  an identical `.section`/`.section_last` (5 lines) and `.section_label` (8 lines) CSS block. Real
  duplication, but only 13 lines total across 2 files — under the 15-line bar, and these are the
  only two consumers of this exact block in the cluster.
- **`settings/contacts/ContactRow.vue` vs `settings/fpcs/FpcRow.vue`** — considered folding
  `ContactRow` onto the shared `SettingItem` composite (`components/ui/Settings/SettingItem.vue`)
  that `FpcRow` already uses. Rejected: `ContactRow` needs a 3-icon action cluster plus a sender
  chip that `SettingItem`'s single `#right` slot doesn't cleanly model, and forcing it in would
  make `SettingItem` less generic for its other 5+ consumers.
- **`TokenCard.vue`'s `.balance_shimmer`/`token_balance_shimmer` keyframe** vs the `shimmer`
  keyframe in F1 — visually similar but uses different timing (1.4s vs 1.5s) and colors
  (`--nulo-surface-low`/`-high` vs `--nulo-surface-high`/`--nulo-surface`), so it's a deliberate
  variant, not an accidental copy; left out of F1.
- **`GasBalanceCard.vue` vs `FeeSettingsCard.vue` subscribe/release-to-`balancesStore` boilerplate**
  — both use the store's `subscribe`/`release`/`ensure` dance, but with materially different
  `CARD_CAPS` and drift-guard logic (`FeeSettingsCard`'s `runInit` has ~10x the state machine of
  `GasBalanceCard`'s `resubscribe`); merging would obscure rather than clarify.
- **`buildSettings` export in `send/fee-helpers.ts`** — exported but only called from within the
  same file (3 call sites in `settingsForMethod`); not dead (production code uses it), just an
  unnecessary `export` keyword — a formatting nit, not a duplication/dead-code finding.
