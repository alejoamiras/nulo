---
plan: harden-dedupe / activity-feed (arc 22 of 25)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/22-activity-feed, stacked on harden-dedupe
---

# activity-feed: one row scope, shared card fields, one chip and empty-state style

Findings Q-06 (a to d) and Q-22 (e), from `audit/quality/2026-09-30-dedup-high/`. Home's recent activity (account and token page) and the History page build their rows, card fields and card CSS in two copies each. This batch keeps one copy of every part the two agree on and leaves each difference at its site. Every feed shows exactly the rows it shows today, for the same profile, account, chain and network, with the same pixels.

## Outcome & Quality Bar

- **For whom:** the next person who changes how an activity row is scoped or how a journal card reads. Today a tx scoping fix must land in two identical functions, and the awaiting card's field getters shadow the terminal card's builder.
- **Excellent:**
  - One tx-row scope function and one incoming-row scope predicate serve both feeds. Each feed keeps its own extra guards inline, in today's order.
  - The awaiting card and the terminal card take title, icon, origin chip, transfer-type chip and amount formatting from the same helpers. Each helper dispatches on the kind before reading any token. The amount gates, which differ, stay at their sites.
  - The title separator lives in one CSS rule, the awaiting/terminal chip in one, and the dashed empty state in one module that `ListStatusMessage` and the two Home empty states compose.
  - Every touched surface is pixel-identical on Chrome and Firefox, dark and light, by the zero-diff harness, with computed-style probes on every element whose class moved.
- **Good enough:** the three journal-scope copies (Home, TokensView, History) keep their own profile and network clauses, because those clauses disagree today (see Drift).

## Architecture & Implementation

Paths are under `apps/extension/src/`. Lines read 2026-10-03 on `origin/harden-dedupe` (`2adab99d`; unchanged in these files at `eb06c37d`).

### Q-06 (a): row scoping

| site | current guard set, in order | after |
|---|---|---|
| History tx, `utils/activity-rows.ts:79-88` (`txRows`) | account if set; chain if set; `isForeignProfile` | the same body, exported as `scopedTxRows` |
| Home tx, `popup/components/modules/general/recent-activity-rows.ts:55-64` (`scopedTxRows`) | identical body | deleted; imports the shared `scopedTxRows` |
| History incoming, `activity-rows.ts:104-121` | account if set; network if set | `incomingInScope(inc, scope)` (those two checks, same order) then `incomingRow(inc)` |
| Home incoming, `recent-activity-rows.ts:66-81` | token if a token object is present; account; network; `isForeignProfile` | token check inline; `incomingInScope`; `isForeignProfile` inline; `incomingRow` |
| Home journal, `popup/components/modules/general/RecentActivityView.vue:265-278` | account (strict); profile, truthy both sides (`:270`); network, both sides truthy (`:275`); token (`:276`) | untouched |
| TokensView imports, `popup/components/modules/general/TokensView.vue:62-75` | kind; account; profile, truthy (`:67`); network, row side only (`:69`); terminal and retention | untouched |
| History journal, `activity-rows.ts:90-102` | succeeded; kind; account; `isForeignProfile`; terminal | untouched |

- `incomingRow(inc)` keeps today's read order: the sort key first (`blockTimestamp * 1000` when present, else `discoveredAt`), then the key from `inc.id`. Its two comments become one sentence, without the "Path 2" tag.
- `RecentActivityRow` becomes an alias of `ActivityRow` (the same union in another member order). `buildRecentActivityRows`, `remainingRowSlots`, the journal rows' `terminalAt ?? 0` key and the slice stay in `recent-activity-rows.ts`.
- **Exports.** `src/utils/` is an auto-import directory (`apps/extension/vite.config.ts:111`), so the new exports become globals; none collides with an existing name. A build regenerates `src/types/auto-imports.d.ts` and `src/types/.eslintrc-auto-import.json` before the commit.
- The header of `activity-rows.ts` loses its audit-round citation; the merge description stays.

### Q-06 (b): journal card fields

The awaiting card's getters (`RecentActivityView.vue:337-392`) re-derive what the terminal builder computes (`utils/journal-state.ts:358-409`).

**Shared, as exported helpers in `journal-state.ts`.** Each one dispatches on `op.kind === "transfer"` first, so a dApp card reads neither `tokenId` nor the token list, as today on both paths.

| helper | transfer | otherwise |
|---|---|---|
| `journalCardTitle(op, tokenById)` | `tokenById(op.tokenId)?.symbol \|\| "Transfer"`, looked up only when `tokenId` is defined | `op.title ? humanizeMethodName(op.title) : "Transaction"` |
| `journalCardIcon(op)` | `arrow-narrow-up-right` | `zap` |
| `journalCardOriginLabel(op)` | `null` | `sanitizeJournalSubtitle(op.subtitle)` |
| `journalCardTransferTypeLabel(op)` | `formatTransferType(op.transferType)`, or `null` when undefined (`TransferType.Private` is 0) | `null` |

**Home awaiting card.**

- The template keeps its eleven bindings separate and in order (`:822-834`). `:title`, `:icon`, `:originLabel` and `:transferTypeLabel` call the helpers directly, so field evaluation still runs title → `cardSubtitleFor` → icon → origin → amount → symbol → transfer type.
- `cardAmountFor` and `cardAmountSymbolFor` stay in the SFC with today's gates (`amountRaw !== undefined`; a symbol without an amount; `symbol || null`). The compact `balanceFormatted` call stays inline in both places: `amount.callers.test.ts` pins how many compact calls each file makes, so a shared formatter would change a frozen test (decided during the build, see the lessons file).
- `cardTitleFor`, `cardIconFor`, `cardOriginLabelFor`, `cardTransferTypeFor` and the `formatTransferType` import leave the SFC. Their `!op` / `op?.` guards are dead: `renderedInFlightOps` comes from a filter that reads `op.terminalAt` first (`:284`), so a null op throws there before any getter runs.

**Terminal builder.**

- `buildJournalTerminalCardProps` keeps its signature, its feed-kind and display gates, and today's key order: title, icon, origin, type, amount and symbol, then the display.
- Its fields come from the helpers. The amount pair comes from a module-private `terminalAmount(op, tokenById)`: kind first, then `amountRaw` truthy and token found, then today's inline `balanceFormatted` call and `symbol ?? null`.
- `transferCardFields` and `dappCardFields` go.

**Reads and error precedence.** Characterized before claiming equivalence, and pinned in Phase 1.

- **Dependency set.**
  - On both paths, per card: the record's own fields, plus the token list only on transfer cards.
  - The terminal transfer card now calls `tokenById` twice: once for the title, once for the amount. That is the same list read; `tokenById` is a pure `find` (`composables/useScopedTokens.ts:67`) or a `Map` get (`TransactionsList.vue:48-51`).
  - Home's awaiting card reads exactly what its getters read today.
- **Throwers.**
  - A transfer card has one: `balanceFormatted`, through `BigInt` on a non-numeric `amountRaw`. `formatTransferType` (`utils/tx-enrichment.ts:145-147`) is a lookup with a `String` fallback, and `sanitizeJournalSubtitle` only runs a regex.
  - A dApp card has one: `humanizeMethodName`, but only on a non-string title, which the schema bars (`wallet/services/operation-journal/spec.ts:243`).
  - A card that can throw at most once throws the same error, whatever order its fields evaluate in. Home's binding order is unchanged anyway.
- The comment at `journal-state.ts:319-324` loses its history of the two inline copies, and `:351-353` loses the "Codex flagged" attribution. The `TransferType.Private === 0`, subtitle-sanitization and timestamp-unit notes stay.

### Q-06 (c): dispatch ladders

The Home ladder (`RecentActivityView.vue:852-865`) and History's (`popup/components/modules/activity/TransactionsList.vue:62-75`) differ on every line except the three route strings:

- Home's terminal props carry `id`, which falls through to the card root (`:399-403`). History's do not (`TransactionsList.vue:49-51`).
- `arriving` is `!token && …` on Home and `isArriving?.(…) ?? false` in History.
- The token list comes from different sources.

So only the routes are shared. `activityRowRoute(row)` in `activity-rows.ts` returns `/popup/tx/<hash>`, `/popup/received/<id>` or `/popup/journal/<id>`, and the six `:to` bindings call it. It is still evaluated only in the branch that renders.

The template comment at `RecentActivityView.vue:813-818` says the cards render oldest-first; the sort is newest-first (`:333`), so the comment is corrected.

### Q-06 (d) and Q-22 (e): CSS

**Cascade rule.** A composed module is copied into every chunk that composes it, so shared and local declarations on one element stay disjoint. Every local class that becomes `composes`-only keeps its exported name, so template classes, `data-testid`s and the `transfer_chip` class assertion in `TransactionAwaitingCard.test.ts:101` are unchanged.

- **New `components/composite/activity/activity-card.module.css`** with:
  - `.title_sep`, byte-identical today in `TransactionAwaitingCard.vue:132`, `TransactionTerminalCard.vue:87`, `TransactionIncomingCard.vue:77` and `popup/components/modules/activity/TransactionCard.vue:200`. All four compose it.
  - `.chip`, byte-identical today in `TransactionAwaitingCard.vue:141` (`.transfer_chip`) and `TransactionTerminalCard.vue:94`. Both compose it.
- **Chips that stay local:** the incoming chip (`TransactionIncomingCard.vue:84`, green on purpose) and `TransactionCard.vue:207` (no `flex-shrink` or `white-space`).
- **Empty state:** `git mv popup/components/modules/general/list-empty.module.css components/composite/list-empty.module.css`, down to L3, so `ListStatusMessage` (L3) never reaches into L4.

**The empty-state compositions, exactly:**

| consumer | rule | change | surfaces |
|---|---|---|---|
| `TokensView.vue:563-573` | `empty_state`, `empty_headline`, `empty_sub` | composes path only | home-empty |
| `RecentActivityView.vue:947-957` | the same three | composes path only | token-feed-empty |
| `ListStatusMessage.vue:29-39` | `.empty` | every declaration removed; composes `empty_state` | the six `ls-*` surfaces |
| `ListStatusMessage.vue:41-48` | `.empty_headline` | every declaration removed; composes `empty_headline` | the six `ls-*` surfaces |
| `ListStatusMessage.vue:50-57` | `.empty_sub` | `font-family`, `font-size`, `line-height` and `color` removed; composes `empty_sub`; keeps `width: 100%` and `overflow-wrap: break-word` | the six `ls-*` surfaces (those with a sub line) |
| `ListStatusMessage.vue:59-67` | `.no_results` | untouched | ls-no-results, select-token-no-results |

### Not taken

- **Switching the two truthy profile clauses to `isForeignProfile`.** They differ on an empty active profile id, which is reachable: backup normalization accepts `profile.id: ""`, password restore keeps it (`wallet/services/profile/service.ts:2308`), and the repository's identity guard accepts a matching empty key and id. The switch would also reverse the operand read order. The clauses stay inline, and the difference is drift.
- **One builder bound through a single `v-bind`.** It would move the awaiting card's field evaluation across `cardSubtitleFor`, and its token lookup ahead of the kind check.
- **A shared row component** for (c). It would need three per-site props to save about ten template lines, and it moves `isArriving`, judged at render, behind a new component boundary.
- **Replacing the two Home empty blocks with `<ListStatusMessage>`.** TokensView's line holds a button, which the string `sub` cannot carry, and the component's `width` / `overflow-wrap` would change wrapping.

## Security & Adversarial Considerations

- **The boundary is scoping.** A row shown under the wrong profile, account or network leaks another identity's activity. Two profiles can hold one address (one phrase imported twice), one address exists on every network, and an empty profile id is reachable through restore. Each site's guard set is listed above and must match after the change. The shared tx and incoming functions keep the union each site has today, and nothing is relaxed.
- **What an attacker controls.** A dApp writes the journal's `title` and `subtitle` and the tx `origin.name`; the wallet writes every scope field. Both cards keep `sanitizeJournalSubtitle` on the dApp chip; Phase 1 pins a schemeful subtitle bracketed on each.
- **A shared function couples two feeds.** A future edit to `scopedTxRows` or `incomingInScope` now moves both, which is the point, and both suites call it. History's lack of an incoming profile guard and of a journal network rule is pinned, so the shared code cannot quietly adopt Home's rules, or Home lose its own.
- **No logging, storage, crypto or dependency change.** The only CSS moves are byte-identical rules.

## Assumptions

**Facts** (read 2026-10-03):

1. The sites and guard sets are as tabled; `isForeignProfile` is at `activity-rows.ts:73-75`.
2. `TransactionCardLayout` renders the symbol only inside the `v-if="amount"` column (`components/composite/activity/TransactionCardLayout.vue:114-116`).
3. No row on either feed renders a relative time. History's date labels format `sortKey` absolutely (`TransactionsList.vue:29`), so fixed seed timestamps give stable shots without masking. Only the incoming card's fiat line reads a live price, as in visual-shells-b.
4. **Existing pins:**
   - routes (`RecentActivityView.test.ts:505`, `TransactionsList.test.ts:60`);
   - TokensView's profile and network clauses (`TokensView.test.ts:286-330`);
   - Home's tx scoping and row order (`recent-activity-rows.test.ts:41-108`);
   - terminal fields (`journal-state.test.ts:225-265`).

   Home's incoming profile guard is not pinned: `recent-activity-rows.test.ts:59` passes an undefined scope.
5. Incoming records reach both feeds already scoped to profile, network and account (`composables/useIncomingTransfers.ts:85`, `:117`; `wallet/services/incoming-transfer/service.ts:487`).
6. **Overlap.** No unmerged arc's committed diff touches these files. balance-snapshot also edits `TokensView.vue`, but at about `:184-392`, against this arc's `:563-573`.

**Inferences:** none beyond the reads and throwers characterized above.

**Asks:** none open. The panel's answer to the History incoming profile guard is under Decisions.

## Phases

### Phase 0: harness surfaces and stability (no product code)

Write the surface file `surfaces/activity-feed.ts` for the program's local screenshot harness. Use visual-shells-b's seed helpers (scope read, token row, transfer tx, note receipt, failed and proving transfer journal rows, reload with the worker kept), and add:

- a `dapp_execute` row in `proving`, with `title: "swap_tokens_for_exact_tokens"` and `subtitle: "alpha.example"`;
- a cancelled `dapp_execute` row, terminal at a fixed time on the same day as the other seeds.

Every surface:

- asserts its counts before the shot and again after settling;
- probes the computed styles, at rest, of every element whose class moved and that it renders: `title_sep`, `chip`, `transfer_chip`, the incoming chip, `TransactionCard`'s chip, `empty_state`, `empty_headline` and `empty_sub` (and `empty`, `empty_headline`, `empty_sub` in `ListStatusMessage`);
- makes every changed element visible, scrolling when needed.

The counts are fixed now, from the 5-row budget (in-flight cards count) and the token page's filters (a journal row needs the token's id; dApp rows have none):

| surface | route / state | asserted |
|---|---|---|
| home-empty | Home with no token rows and no activity, settled | TokensView's empty state = 1; `activity-feed-root` = 0 |
| token-feed-empty | `#/popup/tokens/<id>`, no activity | `activity-feed-root` = 1; `activity-icon` = 0 |
| activity-empty | `#/popup/activity`, no activity | History's empty banner = 1 |
| home-feed, home-feed-end | Home with the transfer tx (with an origin, so both chips), the note receipt, the failed transfer row and the proving transfer row | `tx-awaiting-card` 1, `tx-terminal-card` 1, `tx-card` 1, `tx-incoming-card` 1 |
| home-feed-dapp | the two transfer journal rows swapped for the proving and cancelled dApp rows | `tx-awaiting-card` 1 and `tx-terminal-card` 1, each with an origin chip; `tx-card` 1; `tx-incoming-card` 1 |
| token-feed | `#/popup/tokens/<id>`, all six seeds | `tx-awaiting-card` 1, `tx-terminal-card` 1, `tx-card` 1, `tx-incoming-card` 1 |
| activity-page, activity-page-end | `#/popup/activity`, all six seeds | `tx-terminal-card` 2, `tx-card` 1, `tx-incoming-card` 1, `activity-date-label` 1 |
| ls-tokens, ls-contacts, ls-notes, ls-authwits, ls-contracts, ls-senders | each settings page's empty `ListStatusMessage`: no token rows, no contacts, no authwits (a fresh profile stores none, so no stub), and port stubs answering `[]` for notes, contracts and senders, each stub's served-call count asserted | the empty block = 1 |
| ls-no-results | Holdings search with a term that matches nothing | `holdings-no-results` = 1 |
| select-token-no-results | Send → token picker, searched with a term that matches nothing (`components/popups/SelectTokenPopup.vue:173`) | `select-token-no-results` = 1 |

`TokenImportRow` states are not shot. TokensView's only edit is the empty-state `composes` path, and its import rows take no class from that module.

**Gate:** `run.ts --batch activity-feed --base <parent> --stability` reports ALL IDENTICAL on both browsers.

- If any `ls-*` surface cannot be staged, the `ListStatusMessage` half of Q-22 (e) moves to Deferred before Phase 1.
- If any Q-06 surface cannot be staged, that row kind's CSS stays local.

### Phase 1: characterization (test only, green on today's code)

**`utils/activity-rows.test.ts`** (History):
- tx: a foreign profile is dropped; a chain id `0` scope keeps a chain-0 tx and drops a chain-1 tx; an all-undefined scope keeps every tx;
- a terminal journal row from another network is kept (drift pin);
- an incoming record stamped with another profile is kept under a known scope (drift pin);
- **read order:** a property-recording proxy shows the exact reads, in order, for:
  - a tx that fails on account (no chain or profile read);
  - a tx that fails on chain;
  - a kept tx (account, chain, profile, then hash, then `updatedAt`);
  - an incoming record that fails on account;
  - a kept incoming record (account, network, then the sort-key fields, then `id`).

**`recent-activity-rows.test.ts`** (Home):
- under a fully known scope, a foreign-profile incoming row otherwise identical to a kept one is dropped, beside a positive control;
- the token check on incoming is independent of the journal token check;
- chain id `0`, as above;
- **read order** under a token scope: a row of another token reads only `tokenId`; a kept row reads token, account, network, profile, then the sort key and `id`.

**`journal-state.test.ts`** (terminal):
- a spy `tokenById` is never called for a dApp card, even when the record carries a `tokenId`;
- `amountRaw: ""` gives amount and symbol `null`;
- a `""` token symbol gives `amountSymbol: ""` and title "Transfer";
- a schemeful subtitle is bracketed.

**`RecentActivityView.test.ts`** (Home):
- **A table of in-flight ops, pinning all six awaiting-card props per row:**
  - a transfer with token and amount, and `transferType: 0` (the Private chip);
  - `amountRaw: ""` → amount `"0"` with the symbol;
  - no `amountRaw` → amount `null`, symbol kept;
  - a token whose symbol is `""` → title "Transfer", symbol `null`;
  - no `tokenId`;
  - a dApp op with a title → humanized, `zap`;
  - a dApp op with `subtitle: "https://evil.example"` → bracketed;
  - a dApp op with no title → "Transaction".
- **Journal scoping:** an op of another token is hidden from the token feed, which distinguishes it from the incoming token check.

Commit `test: pin the activity feed's row scope and journal card fields` on its own. The test files are frozen from here.

**Mutants it must kill, one guard at a time** (each applied by hand, its killing test recorded in the arc's lessons file):

| # | mutant |
|--:|---|
| 1 | `scopedTxRows` drops the account check |
| 2 | `scopedTxRows` drops the chain check |
| 3 | `scopedTxRows` drops the profile check |
| 4 | `scopedTxRows` turns its chain check truthy (chain `0`) |
| 5 | `incomingInScope` drops the account check |
| 6 | `incomingInScope` drops the network check |
| 7 | Home incoming drops its token check |
| 8 | Home incoming drops its profile guard |
| 9 | History incoming gains the profile guard |
| 10 | History journal gains a network rule |
| 11 | Home's journal token check is dropped |
| 12 | `incomingRow` computes its key before its sort key (read order) |
| 13 | the title helper looks the token up before the kind check |
| 14 | `terminalAmount` looks the token up before the kind check |
| 15 | Home's amount gate becomes truthy |
| 16 | the terminal amount gate becomes `!== undefined` |
| 17 | Home's symbol `\|\|` becomes `??` |
| 18 | the terminal symbol `??` becomes `\|\|` |
| 19 | the title's `\|\|` becomes `??` |
| 20 | the transfer-type gate becomes truthy |
| 21 | `sanitizeJournalSubtitle` is dropped |
| 22 | the icons are swapped |
| 23 | a route is swapped |
| 24 | History's list drops a row's route |

A survivor gets a test or a probe showing an identical outcome, never an "equivalent" label.

### Phase 2: logic

Make the Q-06 (a, b, c) changes and the two comment fixes with the test files untouched. Build, so the auto-import declarations regenerate, and inspect them. Commit `refactor(activity): share the feed's row scope, card fields and routes`.

### Phase 3: CSS

Add `activity-card.module.css`, move `list-empty.module.css` and repoint the composes. Commit `refactor(activity): share the card chip and empty-state styles`.

**Validation gate (after each phase):**

- **Commands:** the program's gate script (`lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue`). All exit 0. Phases 2 and 3 leave every `*.test.ts` byte-identical.
- **Screenshots** (Phases 2 and 3):
  - `run.ts --batch activity-feed --base <parent> --head <head> --browsers chrome,firefox`, then `--stability`. Both report ALL IDENTICAL for shots and probes alike.
  - A forced-diff head shows a diff on exactly the surfaces that render each nudge: `title_sep`'s colour (every feed surface with a chip), and `ListStatusMessage`'s `empty_sub` composes dropped (the `ls-*` surfaces with a sub line).
- **Layers:** unit, component, visual. The e2e lanes run in CI per the program gates.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks.
   - It must check that every site's guard set and read order is unchanged, and that no shared and local CSS declaration competes on one element.
   - Include the no-over-engineering rule verbatim: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - Include the comment-quality rule verbatim: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against `harden-dedupe` (gh stack), then add both e2e labels. Once the program gates are green, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/22-activity-feed`, stacked on `harden-dedupe`. Code review: off. Follow-up: activity-feed-b (arc 22b), History's incoming profile guard by the invisible, strictly safer route, planned once this arc lands.

## UI impact

None by design. Every surface in Phase 0 must be pixel-identical on Chrome and Firefox, in dark and light, proven by the zero-diff harness and the computed-style probes:

- Home's feed and its empty state;
- the token page's feed and its empty state;
- History's rows and its empty banner;
- the six `ListStatusMessage` empty hosts and the two no-results hosts.

## Drift left for the alignment arc

1. **History shows other networks' terminal journal rows** (`activity-rows.ts:90-102`; `popup/pages/activity.vue:78` reads by profile only). Owner call 2.
2. **The empty-amount gate, corrected.** It is Home's *in-flight* awaiting card that shows `"0"` for `amountRaw: ""`. Terminal cards suppress it on both Home and History. The program plan's owner call 2 states it the other way round, and the call's evidence should show the awaiting card.
3. **Two profile rules for journal rows.**
   - Home (`RecentActivityView.vue:270`) and TokensView (`:67`) treat an empty id on either side as unscoped.
   - History's `isForeignProfile` treats only `undefined` that way, so under an empty active id it hides every stamped row.
   - An empty active id is reachable through restore (see Not taken).
4. **Three network rules for journal rows:** Home hides only when both ids are known; TokensView hides when the row names a network the active one is not, including when none is active; History has none.
5. **History's incoming profile guard,** moved to arc 22b.
6. **Invisible today:** the awaiting card passes a symbol without an amount and treats a `""` symbol as `null`, where the terminal card gives `""`. Neither renders (Fact 2).

**Kept as today, no call:** Home's terminal cards carry an `id` attribute; the token page never plays an arrival; `TransactionCard`'s chip has no `flex-shrink` or `white-space`; the incoming chip is green; `ListStatusMessage` alone keeps `width` and `overflow-wrap`.

## Decisions (delegated)

### Plan audit, Codex round 1 (GPT-6 Astra, xhigh): REVISE

Two blockers, both adopted, plus five more findings, all adopted:

1. **Blocker: the profile clauses are not equivalent.** An empty active profile id is reachable through backup normalization, password restore (`profile/service.ts:2308`) and the repository's identity guard, and the switch reversed the operand read order. **Adopted:** both truthy clauses stay inline, TokensView loses its logic edit, and the difference is drift 3. Restore validation is not changed here.
2. **Blocker: the card extraction.** The single builder looked the token up before dispatching on kind (a dApp card reads no token today), and one `v-bind` moved field evaluation across `cardSubtitleFor`. **Adopted:**
   - per-field helpers that dispatch on kind first;
   - Home's bindings kept separate and in order;
   - the amount gates kept at their sites;
   - the reads and throwers characterized above and pinned in Phase 1.
3. **Mutants.** `recent-activity-rows.test.ts:59` uses an undefined scope, so removing Home's incoming profile guard survived. **Adopted:**
   - a known-scope foreign-profile case with a positive control;
   - one mutant per guard, the incoming and journal token checks apart;
   - chain id `0`, unknown-scope and read-order probes.
4. **Screenshots. Adopted:**
   - SelectTokenPopup's no-results state;
   - token-feed counts fixed in advance;
   - the empty-state compositions named per rule and surface.

   `TokenImportRow` states were asked for if the TokensView edit stayed. Only its CSS path edit stays, which import rows do not use, so they are not shot.
5. **Comments. Adopted:** the "Codex flagged" attribution at `journal-state.ts:352` goes, and the "oldest-first" template comment at `RecentActivityView.vue:813` is corrected to newest-first. The `TransferType.Private`, sanitization and timestamp-unit notes stay.
6. **The History incoming profile guard.** Codex said yes, by the invisible, strictly safer route. The program plan puts such a fix in its own arc, so it moves to arc 22b, and this arc keeps pinning History's current behaviour.
