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

# activity-feed: one row scope, one card-field builder, one chip and empty-state style

Findings Q-06 (a to d) and Q-22 (e), from `audit/quality/2026-09-30-dedup-high/`. Home's recent activity (account and token page) and the History page build their rows, card fields and card CSS in two copies each. This batch keeps one copy of every part the two agree on and passes each difference in as a strategy. Every feed shows exactly the rows it shows today, for the same profile, account, chain and network, with the same pixels.

## Outcome & Quality Bar

- **For whom:** the next person who changes how an activity row is scoped or how a journal card reads. Today a tx scoping fix must land in two identical functions, and the awaiting card's six field getters shadow the terminal card's builder with two silent differences.
- **Excellent:**
  - One tx-row scope function and one incoming-row scope predicate serve both feeds. Each feed keeps its own extra guards inline, in today's order.
  - The awaiting card and the terminal card take their fields from one builder. The amount policy is the only difference, and it is a named strategy, not a flag.
  - The title separator lives in one CSS rule, the awaiting/terminal chip in one, and the dashed empty state in one module that `ListStatusMessage` and the two Home empty states compose.
  - Every touched surface is pixel-identical on Chrome and Firefox, dark and light, by the zero-diff harness, with computed-style probes on every element whose class moved.
- **Good enough:** the three journal-scope copies (Home, TokensView, History) keep their own network rules, because those rules disagree today (see Drift).

## Architecture & Implementation

Paths are under `apps/extension/src/`. Lines read 2026-10-03 on `origin/harden-dedupe` at `2adab99d`.

### Q-06 (a): row scoping

| site | current guard set, in order | after |
|---|---|---|
| History tx, `utils/activity-rows.ts:79-88` (`txRows`) | account if set; chain if set; `isForeignProfile` | the same function, exported as `scopedTxRows` |
| Home tx, `popup/components/modules/general/recent-activity-rows.ts:55-64` (`scopedTxRows`) | identical body | deleted; imports the shared `scopedTxRows` |
| History incoming, `activity-rows.ts:104-121` | account if set; network if set | `incomingInScope(inc, scope)` (those two checks, same order) then `incomingRow(inc)` |
| Home incoming, `recent-activity-rows.ts:66-81` | token if a token object is present; account; network; `isForeignProfile` | token check inline; `incomingInScope`; `isForeignProfile` inline; `incomingRow` |
| Home journal, `popup/components/modules/general/RecentActivityView.vue:265-278` | account (strict); profile `op.profileId && active && op.profileId !== active` (`:270`); network, both sides truthy (`:275`); token | profile clause becomes `isForeignProfile(appStore.profile?.id, op.profileId)`; the rest unchanged |
| TokensView imports, `popup/components/modules/general/TokensView.vue:62-75` | kind; account; profile, same truthy form (`:67`); network, row side only (`:69`); terminal and retention | profile clause becomes `isForeignProfile`; the rest unchanged |
| History journal, `activity-rows.ts:90-102` | succeeded; kind; account; `isForeignProfile`; terminal | untouched |

- `incomingRow(inc)` returns `{ type: "incoming", key: \`incoming:${inc.id}\`, sortKey, inc }` with today's sort key: `blockTimestamp * 1000` when present, else `discoveredAt`. The two copies of its comment become one sentence, without the "Path 2" tag.
- `RecentActivityRow` becomes an alias of `ActivityRow` (the same union in another member order). `buildRecentActivityRows`, `remainingRowSlots`, the journal rows' `terminalAt ?? 0` key and the slice stay in `recent-activity-rows.ts`.
- **Why the profile clause may change form.** The truthy form and `isForeignProfile` differ only when the row's id is empty or null, or the active id is empty. On every path into these lists the row's `profileId` is a non-empty string: the storage codec parses `OperationRecordSchema` (`profileId: z.string().min(1)`, `wallet/services/operation-journal/spec.ts:232`, applied at `service.ts:108`), the client validates results against it (`client.ts:35`), and a create refuses an unknown profile (`service.ts:269-271`). The active id is `ProfileInfo["id"] | undefined` (`stores/app.store.ts:34`), and ids are random hex from `generateUniqueId` (`wallet/services/profile/repository.ts:105-107`). So the two forms agree on every reachable input. Because the row id is always truthy, today's short circuit always reaches the `appStore.profile` read, so the computeds keep the same reactive dependencies.
- **Exports.** `src/utils/` is an auto-import directory (`apps/extension/vite.config.ts:111`), so the four new exports (`scopedTxRows`, `incomingInScope`, `incomingRow`, `activityRowRoute`) and the one in `journal-state.ts` become globals. None collides with an existing name. `src/types/auto-imports.d.ts` and `src/types/.eslintrc-auto-import.json` are regenerated by a build before the commit.
- The header of `activity-rows.ts` loses its audit-round citation; the merge description stays.

### Q-06 (b): journal card fields

Today the awaiting card's six getters (`RecentActivityView.vue:337-392`) re-derive what `buildJournalTerminalCardProps` already builds (`utils/journal-state.ts:358-409`). Field by field:

| field | Home in-flight today | terminal today | after |
|---|---|---|---|
| title, icon, origin chip, transfer-type chip | same expressions, plus `!op` / `op?.` guards | — | shared; the guards go (see below) |
| amount | transfer; `amountRaw !== undefined`; token found → formatted. `""` formats as `"0"` (`utils/amount.ts:103`) | transfer; `amountRaw` truthy and token found → formatted | per-policy |
| amount symbol | transfer; token found → `symbol \|\| null`, whether or not there is an amount | only beside an amount: `symbol ?? null` | per-policy |

- **Change.** `journal-state.ts` gains a module-private `journalCardFields(op, ctx, amountOf)`. It looks the token up once, then dispatches on `op.kind === "transfer"` exactly as both copies do. `amountOf(amountRaw, token)` returns `{ amount, amountSymbol }`, and two module-private policies reproduce the two columns above. They take values, not the record, so no read moves into the policy.
- `buildJournalTerminalCardProps` keeps its signature and its feed-kind and display gates, and calls `journalCardFields` with the terminal policy.
- **New export:** `buildJournalAwaitingCardProps(op, ctx)` returns the awaiting card's prop names (`title`, `icon`, `originLabel`, `transferTypeLabel`, `amount`, `amountSymbol`) with the in-flight policy. It has no kind gate, as today: in-flight ops are already filtered to feed kinds (`RecentActivityView.vue:288`), and a `null` would drop the card to its defaults.
- **Home template.** The awaiting card's six bindings (`:822-828`) become `v-bind="awaitingCardProps(op)"`, a local wrapper passing `{ tokenById }` beside the existing `journalTerminalCardProps`. All six keys are declared props of `TransactionAwaitingCard`, so nothing falls through as an attribute. The other bindings (`subtitle`, `cancellable`, `jobId`, `stage`, `backend`, events) stay explicit.
- **The dropped guards are dead.** `renderedInFlightOps` comes from a filter that reads `op.terminalAt` first (`:284`), so a null op throws there before any getter runs.
- `tokenById` is called once per card instead of up to three times. It is a pure `find` over the scoped token list (`composables/useScopedTokens.ts:67`).
- The six getters and the `formatTransferType` import leave the SFC. The orphan-task computeds (`:154-193`) read a different record and stay.
- The comment at `journal-state.ts:319-324` loses its history of the two inline copies.

### Q-06 (c): dispatch ladders

The Home ladder (`RecentActivityView.vue:852-865`) and History's (`popup/components/modules/activity/TransactionsList.vue:62-75`) differ on every line except the three route strings:

- Home's terminal props carry `id`, which falls through to the card root (`:399-403`). History's do not (`TransactionsList.vue:49-51`).
- `arriving` is `!token && …` on Home and `isArriving?.(…) ?? false` in History.
- The token list comes from different sources.

So only the routes are shared. `activityRowRoute(row)` in `activity-rows.ts` returns `/popup/tx/<hash>`, `/popup/received/<id>` or `/popup/journal/<id>`, and the six `:to` bindings call it. It is still evaluated only in the branch that renders.

### Q-06 (d) and Q-22 (e): CSS

**Cascade rule.** A composed module is copied into every chunk that composes it, so shared and local declarations on one element stay disjoint. Every local class below that becomes `composes`-only keeps its exported name, so template classes, `data-testid`s and the `transfer_chip` class assertion in `TransactionAwaitingCard.test.ts:101` are unchanged.

- **New `components/composite/activity/activity-card.module.css`** with:
  - `.title_sep`, byte-identical today in `TransactionAwaitingCard.vue:132`, `TransactionTerminalCard.vue:87`, `TransactionIncomingCard.vue:77` and `popup/components/modules/activity/TransactionCard.vue:200`. All four compose it.
  - `.chip`, byte-identical today in `TransactionAwaitingCard.vue:141` (`.transfer_chip`) and `TransactionTerminalCard.vue:94`. Both compose it.
- **Chips that stay local:** the incoming chip (`TransactionIncomingCard.vue:84`, green on purpose) and `TransactionCard.vue:207` (no `flex-shrink` or `white-space`). Composing those and overriding at equal specificity would depend on chunk load order.
- **Empty state:** `git mv popup/components/modules/general/list-empty.module.css components/composite/list-empty.module.css`, down to L3, because `ListStatusMessage` (L3) may not reach into L4. Then:
  - `TokensView.vue:563-573` and `RecentActivityView.vue:947-957` repoint their `composes` paths;
  - `components/composite/ListStatusMessage.vue:29-57` composes `empty_state`, `empty_headline` and `empty_sub`, and keeps `width: 100%` and `overflow-wrap: break-word` locally on `.empty_sub`, a property set disjoint from the shared rule;
  - `.no_results` is untouched.

### Not taken

- **A shared row component** for (c). It would need three per-site props (the terminal-props builder, an `isArriving` function, the token source) to save about ten template lines, and it moves `isArriving`, which is judged at render, behind a new component boundary.
- **A truthy twin of `isForeignProfile`** for the two inline profile clauses. Since both forms agree on every reachable input, a second helper would only name an unreachable difference.
- **Replacing the two Home empty blocks with `<ListStatusMessage>`.** TokensView's line holds a button, which the component's string `sub` cannot carry, and the component's `width` / `overflow-wrap` would change wrapping.

## Security & Adversarial Considerations

- **The boundary is scoping.** A row shown under the wrong profile, account or network leaks another identity's activity. Two profiles can hold one address (one phrase imported twice), and one address exists on every network. Each site's guard set is listed above and must match after the change. The shared tx and incoming functions keep the union each site has today, and nothing is relaxed.
- **What an attacker controls.** A dApp writes the journal's `title` and `subtitle` and the tx `origin.name`; the wallet writes every scope field. The awaiting card must keep `sanitizeJournalSubtitle` (`journal-state.ts:133`) on the dApp chip, and Phase 1 pins a schemeful subtitle bracketed on the awaiting card as well as the terminal one.
- **A shared function couples two feeds.** A future edit to `scopedTxRows` or `incomingInScope` now moves both. That is the point, and both suites call it. History's lack of an incoming profile guard and of a journal network rule is pinned, so the shared code cannot quietly adopt Home's rules, or Home lose its own.
- **No logging, storage, crypto or dependency change.** The only CSS moves are byte-identical rules.

## Assumptions

**Facts** (read 2026-10-03 at `2adab99d`):

1. The sites and guard sets are as tabled; `isForeignProfile` is at `activity-rows.ts:73-75`.
2. Journal `profileId` is `z.string().min(1)` and is parsed on storage read and validated on client read (`spec.ts:232`, `service.ts:108`, `client.ts:35`).
3. `TransactionCardLayout` renders the symbol only inside the `v-if="amount"` column (`components/composite/activity/TransactionCardLayout.vue:114-116`). So the in-flight policy's symbol-without-amount and `""` symbol never show.
4. No row on either feed renders a relative time. History's date labels format `sortKey` absolutely (`TransactionsList.vue:29`). Fixed seed timestamps therefore give stable shots without masking. Only the incoming card's fiat line reads a live price, as in visual-shells-b.
5. Existing pins: Home and History routes (`RecentActivityView.test.ts:505`, `TransactionsList.test.ts:60`); TokensView's profile and network clauses (`TokensView.test.ts:286-330`); Home tx and incoming scoping and order (`recent-activity-rows.test.ts:41-108`); terminal fields (`journal-state.test.ts:225-265`).
6. Incoming records reach both feeds already scoped to profile, network and account (`composables/useIncomingTransfers.ts:85`, `:117`; `wallet/services/incoming-transfer/service.ts:487`).
7. No overlap with any unmerged arc's committed diff (9, 17, 18 on the remote; 10, 11, 12, 15, 15b, 19, 20 in local branches). balance-snapshot also edits `TokensView.vue`, but at about `:184-392`, against this arc's `:67` and `:563-573`. Whichever lands second rebases mechanically.

**Inferences:**

- Calling the in-flight builder once per card instead of six getters changes no output, because every input is a plain reactive read with no side effects.

**Asks:**

1. **History's incoming profile guard.** The program lets this arc's panel add it under the invisible, strictly safer route. The guard never fires on a realistic path (Fact 6), and adding it would let History use Home's incoming builder whole. **Recommendation: not in this arc.** The driver asked for today's scoping exactly, and the guard buys no visible safety. It stays drift.

## Phases

### Phase 0: harness surfaces and stability (no product code)

Write the surface file `surfaces/activity-feed.ts` for the program's local screenshot harness. Use visual-shells-b's seed helpers (scope read, token row, transfer tx, note receipt, failed and proving journal rows, reload with the worker kept), and add:

- a dApp `dapp_execute` row in `proving`, with `title: "swap_tokens_for_exact_tokens"` and `subtitle: "alpha.example"`;
- a cancelled `dapp_execute` row, terminal at a fixed time.

Every surface:

- asserts its counts before the shot and again after settling;
- probes the computed styles of `title_sep`, `chip`, `transfer_chip`, the incoming chip, `TransactionCard`'s chip, `empty_state`, `empty_headline` and `empty_sub` wherever they render, at rest (leaving out keyframe names);
- makes every changed element visible, scrolling when needed.

| surface | route / state | asserted |
|---|---|---|
| home-empty | Home, no token rows and no activity, settled | the TokensView empty state = 1; `activity-feed-root` = 0 |
| token-feed-empty | `#/popup/tokens/<id>` with no activity | `activity-feed-root` = 1, `activity-icon` = 0 |
| activity-empty | `#/popup/activity` with no activity | the History empty banner = 1 |
| home-feed, home-feed-end | Home after seeding a transfer tx (with origin, so both chips), a note receipt, a failed transfer row and a proving transfer row. One in-flight card leaves 4 of the 5-row budget, so every settled row shows. | 1 `tx-awaiting-card`, 1 `tx-terminal-card`, 1 `tx-card`, 1 `tx-incoming-card` |
| home-feed-dapp | the two transfer journal rows swapped for a proving dApp row and a cancelled dApp row | 1 awaiting and 1 terminal card, each with the bracket-free origin chip and `zap` |
| token-feed | `#/popup/tokens/<id>` with all six seeds | only that token's rows; count recorded and re-asserted |
| activity-page, activity-page-end | `#/popup/activity` with all six seeds | 4 rows (tx, receipt, two terminal), 1 date label |
| ls-tokens, ls-contacts, ls-notes, ls-authwits, ls-contracts, ls-senders | each settings page's empty `ListStatusMessage`: no token rows, no contacts, and port stubs answering `[]` for notes, authwits, contracts and senders, each stub's served-call count asserted | the empty block = 1 |
| ls-no-results | Holdings search with a term that matches nothing | `holdings-no-results` = 1 |

**Gate:** `run.ts --batch activity-feed --base <parent> --stability` reports ALL IDENTICAL on both browsers.

- If any `ls-*` surface cannot be staged, the `ListStatusMessage` half of Q-22 (e) moves to Deferred before Phase 1, and the Home empty states keep today's module path.
- If any Q-06 surface cannot be staged, that row kind's CSS stays local.

### Phase 1: characterization (test only, green on today's code)

- **`utils/activity-rows.test.ts`:**
  - History drops a foreign-profile tx;
  - History keeps a terminal journal row from another network (drift pin);
  - History keeps an incoming record stamped with another profile (drift pin).
- **`RecentActivityView.test.ts`:**
  - **A table of in-flight ops, pinning all six awaiting-card props per row:**
    - a transfer with token and amount, and `transferType: 0` (the Private chip);
    - `amountRaw: ""` → amount `"0"` with the symbol;
    - no `amountRaw` → amount `null`, symbol kept;
    - a token whose symbol is `""` → title "Transfer", symbol `null`;
    - no `tokenId`;
    - a dApp op with a title → humanized, `zap`;
    - a dApp op with `subtitle: "https://evil.example"` → bracketed;
    - a dApp op with no title → "Transaction".
  - **Journal scoping:** an in-flight op and a terminal op stamped with another profile are hidden, the active profile's show; an op from another network is hidden.
- **`journal-state.test.ts`:** a terminal transfer with `amountRaw: ""` has amount and symbol `null`; a token whose symbol is `""` gives `amountSymbol: ""`.

Commit `test: pin the activity feed's row scope and journal card fields` on its own. The test files are frozen from here.

**Mutants it must kill** (each tried by hand, and recorded in the arc's lessons file):

1. History's incoming adopts the profile guard.
2. History's journal adopts the network rule.
3. The in-flight builder takes the terminal policy, and the reverse.
4. `||` swapped for `??` in either symbol.
5. The profile clause dropped at Home or in TokensView.
6. Home's token filter dropped.
7. One scope check dropped from `scopedTxRows` or `incomingInScope`.
8. A route swapped.
9. `sanitizeJournalSubtitle` dropped from the shared dApp fields.

A survivor gets a test or a probe showing an identical outcome, never an "equivalent" label.

### Phase 2: logic

Make the Q-06 (a, b, c) changes with the test files untouched. Then build, so the auto-import declarations regenerate, and inspect them. Commit `refactor(activity): share the feed's row scope, card fields and routes`.

### Phase 3: CSS

Add `activity-card.module.css`, move `list-empty.module.css` and repoint the composes. Commit `refactor(activity): share the card chip and empty-state styles`.

**Validation gate (after each phase):**

- **Commands:** `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`. All exit 0. Phases 2 and 3 leave every `*.test.ts` byte-identical.
- **Screenshots (Phases 2 and 3):** `run.ts --batch activity-feed --base <parent> --head <head> --browsers chrome,firefox` reports ALL IDENTICAL for shots and probes alike. A forced-diff head, built with `title_sep`'s colour nudged and the `empty_sub` composes dropped, must show a diff on exactly the surfaces that render them.
- **Layers:** unit, component, visual; the e2e lanes run in CI per the program gates.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks.
   - It must check that every site's guard set is unchanged, that the profile-clause equivalence holds on every path into the three lists, and that no shared and local CSS declaration competes on one element.
   - Include the no-over-engineering rule verbatim: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - Include the comment-quality rule verbatim: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against `harden-dedupe` (gh stack), then add both e2e labels. Once the program gates are green, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/22-activity-feed`, stacked on `harden-dedupe`. Code review: off.

## UI impact

None by design. Every surface in Phase 0 must be pixel-identical on Chrome and Firefox, in dark and light, proven by the zero-diff harness and the computed-style probes:

- Home's feed and its empty state;
- the token page's feed and its empty state;
- History's rows and its empty banner;
- the six `ListStatusMessage` empty hosts and one no-results host.

## Drift left for the alignment arc

1. **History shows other networks' terminal journal rows** (`activity-rows.ts:90-102`; `popup/pages/activity.vue:78` reads by profile only). Owner call 2.
2. **The empty-amount gate, corrected.** It is Home's *in-flight* awaiting card that shows `"0"` for `amountRaw: ""`. Terminal cards suppress it on both Home and History. The program plan's owner call 2 states it the other way round, and the call's evidence should show the awaiting card.
3. **Three network rules for journal rows:** Home hides only when both ids are known; TokensView hides when the row names a network the active one is not, including when none is active; History has none.
4. **History's incoming profile guard,** unless the panel rules otherwise on Ask 1.
5. **Invisible today, kept by the in-flight policy:** that policy passes a symbol without an amount and treats a `""` symbol as `null`, where the terminal policy gives `""`. Neither renders (Fact 3).

**Kept as today, no call:** Home's terminal cards carry an `id` attribute; the token page never plays an arrival; `TransactionCard`'s chip has no `flex-shrink` or `white-space`; the incoming chip is green; `ListStatusMessage` alone keeps `width` and `overflow-wrap`.

## Decisions (delegated)
