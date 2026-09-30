---
plan: layout-polish
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: feat/layout-polish
worktree: a harness-created agent worktree (lessons/phase-0.md records it)
base: dev @ 85c4d20f (#719 merged; Facts were read at f32b1e0a, the same tree as 48a97f4a, and every file #719 touched was re-read at 85c4d20f)
---

## Outcome

- **Date:** 2026-09-29. **Status:** closed, awaiting archive: delivered on `feat/layout-polish`,
  whose PR the driver opens once the codex loop has converged; not merged. The owner was away and
  delegated the decision page to a panel; on 2026-09-30 the owner confirmed every answer below
  (§ P4).
- **Shipped** on `feat/layout-polish`, P0 to P4:
  - L1: activity rows 10px apart on Home, a token's page and History; History's date heading
    keeps its 12px to its first row.
  - L2: History's and Settings' titles at their drawn height, from one module
    (`apps/extension/src/popup/pages/tab-hero.module.css`); the compact bar takes no flow and
    paints, hides and takes clicks as before, and a click just under it now reaches the row there.
  - L3 as O1 (b): "Recent activity" and "View history".
  - L7 as O5 (b): Home's hero keeps its skeleton until the first price answer when the wallet
    holds a price-mapped token, under the existing 12 s cap (`usePrices`' `settled`).
  - L4 to L6 unchanged, as O2 to O4 (a).
  - Tests: unit cases for the header, `settled` and the hero's wait; e2e cases for the row gaps,
    the date heading, row containment in both themes, the titles, the bar's box and hits, and
    Settings' Tab order, with seeders in `apps/extension/tests/e2e/helpers/activity-seeds.ts`.
  - From the codex loop: the rows case waits for every row's dollar figure; two test comments.
- **Gates at delivery:** the final gate on `6e880e8c` (`lessons/phase-4.md`): lint,
  `typecheck:all`, `test:all`, `test:ci-gating`, the build and Storybook exit 0; smoke green in
  three shards per browser with no retry; the flake bar three of three per browser at retry 0;
  the two network files green on Chrome. Red first on both browsers (`lessons/phase-1.md`).
- **Delegated answers, 2026-09-29:** O1 (b), two to one; O2 (a), O3 (a), O4 (a), O5 (b) and the
  blanket for B1 and B2, unanimous (§ P4).
- **The owner's answers, 2026-09-30:** O1 (b), O2 (a), O3 (a), O4 (a) and O5 (b) on the page, and
  B1 and B2 signed in chat (§ P4).
- **Dropped:** O1 (c), O2 (b) and (c), O3 (b), O4 (b) and O5 (a); their capture-only branches were
  never pushed.
- **Open items:** none left here; `follow-ups.md` holds them. In § Layout: the two view links'
  keyboard access, History filtered to a token's page, the links' contrast, the compact bar's
  doubled title for screen readers, and Home's header spacing. In § Amounts, sends and fees: the
  owner's call on a failed first price fetch. `lessons.md` § E2E carries one: `navigateByHash`
  returns before the router swaps the page.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

# Layout polish

The layout around batch 4's surfaces that predates the ux-feedback program, as one PR off `dev`.
The record (`implementations-plan/ux-feedback/plan.md:474-478`): "rows 4px apart (drawn 10px),
Home's rows 59px tall with a third "≈ $" line (drawn 52px), the History and Settings titles about
31px lower than drawn, History's date heading, Home's "Recent transactions" and "View archives"
(drawn "Recent activity" and "View all"), and Settings' account header." The driver added one
item found by `hygiene` (its F-3): Home's hero reads "$0.00" until its quotes land.

Seven items, and what this plan does with each:

| # | Item | Plan |
|---|---|---|
| L1 | Activity rows 4px apart, drawn 10px | build to the drawing (blanket sign-off) |
| L2 | The History and Settings titles about 31px lower than drawn | build to the drawing (blanket sign-off) |
| L3 | "Recent transactions" and "View Archives", drawn "Recent activity" and "View all" | owner call O1; build the drawn strings |
| L4 | Rows 59px with a third "≈ $" line, drawn 52px | owner call O2; the line was a deliberate earlier decision, so keep it |
| L5 | Settings' account header, which the drawing leaves out | owner call O3; keep it |
| L6 | History's date heading, which the drawing leaves out | owner call O4; keep it |
| L7 | Home's hero shows "$0.00" until its quotes land | owner call O5; hold the skeleton until the first price answer |

Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner:

- 2026-09-28: "Can you ultracode 1 to 5 + security and privacy + test rliability + trivial?
  Assigning blueprinting level to each of those and just needing me to answer the open questons
  that it may come."
- 2026-09-29: "Feel free to leverage the gh cli to merge away the branches that you understand are
  ready and feel confident on their implementation. Continue then with ultracodeing the
  follow-ups."
- 2026-09-28: "FYI: use opus5.5 instead of fable please."
- 2026-09-29: "let's cover realistic scenarios lol."
- 2026-09-29: "for next documents please put how it's going to look on each choice you are giving
  me".

The item's own record: the owner, 2026-09-25, on batch 4's parity page, call 13: "(a) follow-up
maybe?" (`implementations-plan/ux-feedback/b4-snackbar-rows-arrivals/plan.md` § P6).

- **Scope**: L1 to L7 above, on Home's activity list and hero (and the token page, which renders
  the same activity view), History and Settings.
- **Out**: the received row's content against the drawing (title, label, hash line, arrow, badge,
  separator, chip colour), which the owner kept on 2026-09-25 (batch 4, answer 8); Home's section
  header rule and spacing (Fact 13, not in the record); the two "View all" spans' keyboard access
  (Follow-ups); every token in `@nulo/design`; the review-history comments in
  `RecentActivityView.vue` (`:50-61` and others), which `hygiene`'s comment sweep owns.
- **Constraints**: pre-production, no migrations; no new dependency; no `@nulo/design` change
  (Fact 10); existing testids verbatim; e2e selects only by testid; complexity budgets hold with no
  new acceptance; new copy joins no clauses with an em dash.
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Decisions**: UI and product asks go to the owner; technical asks are decided with
  `/codex high`. Every Ask carries a recommendation and a confidence and is labelled `owner` or
  `codex`.
- **Validation layers**: lint, types, unit and component, CI-gating scripts, build, Storybook
  build (component visuals change); smoke e2e on Chrome and Firefox (the popup changes). Network
  specs read Home's rows only for presence (`network/incoming-arrival.test.ts:198-205`, `:565`),
  never their spacing, the titles or the changed labels, so L1 to L4 need no local network run. L7
  changes when `waitForHomeTotal` resolves on a priced wallet, so while O5 (b) is on the branch,
  `network/incoming-arrival.test.ts` and `network/fiat-send.test.ts` (both read the hero after it,
  `:293`, `:561`; `fiat-send.test.ts:43-46`) run locally on Chrome through `e2e:agent`. CI runs the
  full network suite on both browsers.
- **Delivery**: single arc, one PR off `dev` on `feat/layout-polish`, plain `gh pr create` once
  the owner's answers are applied (P4) and the codex loop has converged. The first commit adds
  `implementations-plan/layout-polish/` and one line in `implementations-plan/index.md`. Merge: by
  the driver under the owner's standing authorization (2026-09-29, above), once every required
  check is green on the head, every UI surface carries the owner's quoted sign-off and the codex
  loop has converged.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 0 | CSS values, one shared style module on an existing precedent, two strings, one more condition on an existing skeleton |
| Blast radius | 1 | Two tab pages, two list components, Home's header and hero; every change is visual |
| Irreversibility | 0 | Code and tests only; nothing stored changes |
| Migration cost | 0 | Pre-production, and no stored shape is involved |
| External coupling | 0 | Nothing a dApp sees or sends changes |
| Security sensitivity | 0 | No data, permission or signing path is touched (§ Security); two paths could show a wrong amount, and both are tested |

`light`: the owner's standing cap is "never blueprint more than mid, to keep our credits safe", and
nothing here needs a second audit leg. The light floor holds: 15 Facts below, and every phase
lists its assumptions.

## Outcome & Quality Bar

For whom: a person reading Home's activity and total, History or Settings in the 360×600 popup,
who sees the wallet the owner drew rather than the one that grew before the drawings.

Excellent means:

1. **Each built surface matches its drawing wherever the owner chose the drawing, to the pixel
   that a test can read.** Rows are 10px apart on Home, the token page and History, and History's
   date heading keeps its 12px to its first row; the History and Settings titles start 10px below
   the top of their page with 28px under the hero, as drawn; the compact title bar still appears,
   opaque and on top, once the hero leaves, and its painted box owns every point it covers. A
   smoke e2e on Chrome and Firefox reads each number, and the new-value ones fail on `85c4d20f`.
2. **No row hides or cuts an amount.** With a long title, a wide amount and a priced receipt, each
   row's text stays inside its row, the title never overlaps the amount column, and the amount is
   never clipped, at 360×600, in both themes and both browsers. Row heights stay content-driven.
3. **Home never shows a total it does not know** (if O5 (b)): a wallet with priced holdings shows
   the skeleton until the first price answer, never "$0.00"; an empty wallet shows its true
   "$0.00" as today.
4. **The owner decides every remaining difference from pictures, not prose.** The decision page
   sets each surface today beside its drawing and beside each option, at the popup's real size,
   and every answer is quoted in this plan before the PR opens.

Good enough: the Home section header keeps its rule and spacing; the received row keeps its
content; the two "View all" spans stay mouse-only, as today (Follow-ups).

## UI impact

Every row was decided on 2026-09-29 by the panel the owner delegated to while away, and the owner
confirmed each on 2026-09-30 (§ P4). Captures: § P3.

| # | Surface | Before → after (as built) | Sign-off |
|---|---|---|---|
| 1 | Home's activity list, and the token page's | rows 4px apart → 10px (L1) | B1 signed, delegated panel, 2026-09-29; the owner, 2026-09-30 |
| 2 | History's list | rows 4px apart → 10px; the date heading keeps its 12px to its first row (L1) | B1 signed, delegated panel, 2026-09-29; the owner, 2026-09-30 |
| 3 | History's title | the "HISTORY" title about 31px lower than drawn → 10px below the header, as drawn; the gap under its accent bar 32px → 28px, as drawn; the compact bar looks as today and appears when the hero leaves, which is about 31px of scroll sooner than today, since the hero now starts higher (L2) | B2 signed, delegated panel, 2026-09-29; the owner, 2026-09-30 |
| 4 | Settings' title | the same as row 3 for "SETTINGS" (L2) | B2 signed, delegated panel, 2026-09-29; the owner, 2026-09-30 |
| 5 | Home's and the token page's activity header | "RECENT TRANSACTIONS" / "VIEW ARCHIVES" → "RECENT ACTIVITY" / "VIEW HISTORY" (on screen in capitals, as today); type, colour, place and target unchanged (L3) | O1 (b), delegated panel, 2026-09-29, two to one; the owner, 2026-09-30 |
| 6 | Every priced activity row | no change: the third "≈ $" line stays (L4) | O2 (a), delegated panel, 2026-09-29; the owner, 2026-09-30 |
| 7 | Settings | no change: the account header (account, network, Lock) stays (L5) | O3 (a), delegated panel, 2026-09-29; the owner, 2026-09-30 |
| 8 | History | no change: the date heading stays (L6) | O4 (a), delegated panel, 2026-09-29; the owner, 2026-09-30 |
| 9 | Home's hero, a wallet with priced holdings | "$0.00" with "priced assets only" until the quotes land → the skeleton until the first price answer, capped at 12 s as today; an empty or unpriced-only wallet unchanged (L7) | O5 (b), delegated panel, 2026-09-29; the owner, 2026-09-30 |

### UI asks for the owner

Five calls and one blanket, each on the decision page with its pictures (§ P3).

- **O1 · The Home activity header's words** (`owner`). (a) "Recent activity" and "View all", as
  drawn and as Holdings' header on the same screen already says "View all" (Fact 7); (b) "Recent
  activity" and "View history"; (c) today's "Recent transactions" and "View Archives". The link
  opens all of History on both Home and a token's page, so on a token's page "View all" can read
  as "all of this token": (b) avoids that. Recommended: (a), confidence moderate. Pictures: each
  option built, Home's header above its rows and the token page's header, Chrome dark; (a) also
  Firefox; beside the drawing `12-incoming` A.
- **O2 · The third "≈ $" line** (`owner`). The dollar line under a priced amount was a deliberate
  decision (Fact 2), and it is what makes a priced row taller than the drawing's, which has no
  dollar figure. (a) keep it; (b) join it to the symbol line, "TST · ≈ $1,000.00": a wider amount
  column, so long titles wrap sooner; (c) drop it from rows, as drawn: the dollar figure only on the
  detail page. Recommended: (a), confidence moderate. Pictures: each option built on the scratch
  branch, Home and History each with a priced send, a priced receipt, an unpriced row and the long
  title of P1, Chrome dark; (a) also Firefox and with fiat values off; beside the drawing `11-rows`
  A.
- **O3 · Settings' account header** (`owner`). The one drawing of Settings (Fact 5) leaves the
  header out, while every drawn History and Home keeps it, so the omission reads as a crop for the
  snack it illustrates (Inference 2). (a) keep it, as on the other three tabs; (b) hide it on the
  Settings page only, as drawn: the list starts 64px higher, and Settings loses Lock and the
  account switcher. Recommended: (a), confidence high. Pictures: (a) as built with B2, (b) built
  on the scratch branch, Settings at the top, Chrome dark; beside the drawing `12-incoming` B.
- **O4 · History's date heading** (`owner`). The drawing has no heading because each drawn row
  says when it happened ("Today · 11:40"); built rows show a hash there, which the owner kept
  (Fact 6). (a) keep the heading; (b) remove it, as drawn: one continuous list 10px apart, and
  History shows no date at all. Recommended: (a), confidence high. Pictures: (a) as built with B1,
  (b) built on the scratch branch, History with rows from two days, Chrome dark; beside the drawing
  `10-snackbar`.
- **O5 · Home's hero before its quotes land** (`owner`). The hero's skeleton waits for balances
  only, so a wallet with priced holdings reads "$0.00" and "priced assets only" for a message round
  trip after every remount, and up to 10 s on the first open after the browser was closed for over
  15 minutes (Fact 15). (a) today: "$0.00" with its caption until the quotes land, then the priced
  figure; (b) the skeleton stays until the first price answer (quotes, or a failed fetch), under
  the same 12 s cap; a wallet with no price-mapped holding does not wait, so an empty wallet's
  true "$0.00" shows as today, and a failed fetch still ends in today's "$0.00" with its caption.
  No third option: answering at once from stale cached quotes would break the recorded rule that
  a stale quote is never shown (`implementations-plan/token-prices/plan.md:24`, `usePrices.ts:18-20`),
  and a dash breaks the rule that the hero is always a dollar figure (`BalanceView.vue:115-116`).
  Recommended: (b), confidence high: "$0.00" on a funded wallet is a wrong amount a real person
  sees every day, and the same token-prices record says "never $0.00" for an unpriced value. Pictures: each option as a short sequence at 360×600, Chrome dark: just after
  opening (a: "$0.00" and its caption; b: the skeleton) and after the quotes land (the same priced
  figure for both); built where the smoke harness can hold a priced holding without a fresh quote,
  otherwise a faithful mock at real size made from the built settled frame.
- **The blanket sign-off** covers B1 (UI impact rows 1 and 2) and B2 (rows 3 and 4), each built to
  its drawing, and O1 to O5 if answered "as recommended".

## Architecture & Implementation

Compact, per the tier.

- **L1 · row gaps.** `RecentActivityView.vue`'s `.list` gap 4px → 10px (`:955-959`).
  `TransactionsList.vue`'s per-date `Flex gap="4"` → `gap="10"` (`:56`), and the date row's
  `padding-bottom` 8px → 2px (`:83-85`) so its label keeps today's 12px to the first row. The two
  narrating template comments there (`:57`, `:63`) go. `@nulo/design`'s `.gap--10` already exists.
- **L2 · titles.** Cause (Inference 1): the compact title bar is `position: sticky` and only
  faded (`opacity: 0`), so it keeps its box in the flow and pushes the hero down by its own height
  (padding 12px + a 13px line + 12px), where the drawing starts the hero 10px below the header.
  Fix: the bar takes no room in the flow. `.page_title_bar` stays sticky at `top: 0` with its
  z-index, opacity, pointer-events and transition, and becomes `display: block; height: 0` (its
  `display: flex; align-items: center` and padding go, since a centred child in a zero-height box
  would straddle its top edge). `.page_title_label` becomes `display: block`, a full-width block,
  and takes the `12px 24px` padding and `background: var(--app-bg)`, so the painted bar is today's
  box, drawn by the child, overflowing the zero-height wrapper downward. `pointer-events` inherits,
  so the child passes presses through while hidden and takes them once shown, as today. One comment
  on the wrapper: `/* Zero height so the hero starts where drawn; the label paints the bar and owns its hits. */`.
  The hero's padding becomes the drawn `10px 24px 28px`. No height literal depends on the font's
  metrics. The two pages' identical blocks (Fact 4) move into one
  `apps/extension/src/popup/pages/tab-hero.module.css`, which both pages `composes` from, after
  `popup/pages/detail-page.module.css`; each page keeps its `.wrapper` and its observer.
- **L3 · strings** (if O1 (a)). Both branches of `RecentActivityView.vue`'s template render
  `<SectionLabel label="Recent activity" />` (the component Holdings' header uses, same type as
  today's `.header_title`, Fact 8), and the link reads "View all" with a new
  `data-testid="activity-view-all"`. `.header_title` goes. The comment at `TokensView.vue:526`
  goes (it only quoted the old label); `ARCHITECTURE.md:102` follows the new words.
- **L7 · the hero's wait** (if O5 (b)). `usePrices` gains `settled`, a ref set once the first
  answer arrives (a `refreshIfStale` result or rejection, or a broadcast). `BalanceView.vue`'s
  pending condition (`:212`) adds "fiat display on, `settled` false, and some in-scope holding with
  a non-zero balance has a price-map entry" (`getPriceMapEntry`, `price-map.ts:62`), under the
  existing cap. Nothing else in the hero changes.
- **L4 to L6**: nothing ships if the owner takes the recommendations. The alternatives are built
  only on a scratch branch for the captures and never pushed.
- **File-level change map**: modified `popup/components/modules/general/RecentActivityView.vue`,
  `RecentActivityView.test.ts`, `popup/components/modules/general/TokensView.vue` (the comment),
  `popup/components/modules/activity/TransactionsList.vue`, `popup/pages/activity.vue`,
  `popup/pages/settings/index.vue`, `popup/components/modules/general/BalanceView.vue`,
  `BalanceView.test.ts`, `composables/usePrices.ts`, `composables/usePrices.test.ts`,
  `apps/extension/tests/e2e/rows.test.ts`, `apps/extension/tests/e2e/navigation.test.ts`,
  `ARCHITECTURE.md`, `implementations-plan/follow-ups.md`, `implementations-plan/index.md`; added
  `popup/pages/tab-hero.module.css`, `implementations-plan/layout-polish/`. Nothing deleted.
  Paths under `popup/` and `composables/` are in `apps/extension/src/`.
- **Trade-offs**: (1) keep the bar in flow and pull the hero up with a negative margin: rejected,
  it hard-codes the bar's font-dependent height (about 41px, and Chrome and Firefox round line
  heights differently). (2) Fix each page in place: works, but edits the same 57 lines twice and
  leaves two copies to drift; the shared module is the repo's own pattern. (3) A shared
  `PageHero` component with the observer inside: fewer lines, but it moves script and markup of two
  pages for a CSS fix; not worth it at two sites. (4) A list-gap token in `@nulo/design`: the
  landing shares the package and nothing outside these two lists uses the value. (5) For L7, make
  `waitForHomeTotal` wait for prices instead: rejected by `hygiene` (its C11), and it would hide
  the visible defect rather than fix it.

## Security & Adversarial Considerations

- **Threat model**: none of the changed surfaces sends or signs anything. The rows already render
  dApp-originated titles and amounts; this plan changes their spacing only and adds no new rendering
  of dApp data, so the wire-shaped fixture rule has no new subject.
- **Misleading amounts**: two paths could show a person a wrong figure. A row whose amount is cut
  or covered by a long title: P1's containment case, at 360×600, both themes, both browsers. Home's
  "$0.00" on a funded wallet: O5, with its unit cases.
- **Clickjacking and hit-testing**: the compact bar overlays the top of the hero while invisible.
  Its wrapper keeps `pointer-events: none` until it shows, which the painted child inherits, so it
  cannot swallow a press; once shown, the child covers the top of the scrolled list with the page
  background, as today. P1's case probes the painted child's centre and its four edges (1px in) in
  the hidden, shown and back-at-top states on both pages and browsers, and a real click just below
  the shown bar reaches the row under it.
- **Least privilege, cryptography, supply chain**: N/A; no dependency, permission, key or workflow
  changes. The capture script lives outside the repo and uses the repo's pinned Puppeteer.
- **Log redaction**: no logging changes.
- **The decision page** holds screenshots of a sandbox wallet with test tokens (TST), no seed, no
  real address, and stays a private Artifact until the owner shares it.

## Assumptions

### Facts (read at `f32b1e0a`, the tree of `48a97f4a`; `rows.test.ts` at `85c4d20f`)

1. **Row gaps.** Home's activity list is `.list { gap: 4px }`
   (`apps/extension/src/popup/components/modules/general/RecentActivityView.vue:955-959`);
   History's rows sit in a per-date `Flex gap="4"`
   (`apps/extension/src/popup/components/modules/activity/TransactionsList.vue:56`), inside an
   outer `gap="24"` between date groups (`:55`). Every drawn list sets `gap:10px` inline on
   `.n-txlist` (`implementations-plan/ux-feedback/design/mocks/src/parts/11-rows.html`, each option;
   `parts/10-toasts.html:31`; `parts/12-incoming.html:36`).
2. **The third line is deliberate.** Every activity row shares
   `apps/extension/src/components/composite/activity/TransactionCardLayout.vue`: padding 6px 8px
   (`:136-140`), a 40px icon (`:189-199`), a title that wraps (`.title`, `:220-226`, no
   `nowrap`), and an amount column that never shrinks (`.amount_col { flex-shrink: 0 }`,
   `:238-240`) of amount, symbol and an optional 9px `≈ $` line, 2px apart (`:114-127`). Priced
   transfer rows pass the dollar line (`TransactionCard.vue:144-152`) and so do receipts
   (`TransactionIncomingCard.vue:25`, `:56`); both came with #309 (`c3fa7fc5`) as the owner's pick
   "D2+I1" (`implementations-plan/token-prices/lessons/phase-6.md:63-66`: activity rows "carry
   `≈ $x.xx`"). Batch 4 gave it the "At today's price" title (`TransactionCardLayout.vue:117-126`),
   which `apps/extension/tests/e2e/rows.test.ts:289` asserts (at `85c4d20f`).
3. **The measured numbers** come from batch 4's parity page (the built popup at `12b24a1c`, 360×600,
   Chrome and Firefox; `implementations-plan/ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-6.md`
   links the copy): Home's hovered row `[16, 427, 328, 59]` with a third line, History's sent row
   `[16, 451, 328, 59]`, History's then-unpriced received rows 52px tall, rows 4px apart, the
   History title "about 31px lower than drawn", and on Settings "its title sits about 31px lower
   than drawn on top of the header's 64px". Between `12b24a1c` and `48a97f4a` no style rule or
   layout prop in these surfaces changed (`git diff 12b24a1c 48a97f4a`): nothing in
   `settings/index.vue` or `Header.vue`; in `TransactionCardLayout.vue` added testids, a comment
   and `pointer-events: none` on the icon; in `TransactionsList.vue` and `activity.vue` the token
   lookup; in `RecentActivityView.vue` the token lookup and compact amounts
   (`balanceFormatted(..., { compact: true })`, `:188`, `:373`), which can only narrow the amount
   column. Since #718 History's received rows find their token and a price, so they also carry the
   dollar line (`apps/extension/src/popup/pages/activity.test.ts:190`).
4. **The title offset.** History renders a sticky compact bar before its hero
   (`apps/extension/src/popup/pages/activity.vue:174-183`), styled `position: sticky; top: 0`,
   `display: flex; align-items: center`, `padding: 12px 24px` and `opacity: 0` until the hero
   leaves (`:217-233`), with a 13px label (`:240-252`); the hero's padding is `0 24px 32px 24px`
   (`:254-256`); the page's `.wrapper` is the scroll container (`overflow: auto`, `:209-215`).
   Settings has the same markup (`apps/extension/src/popup/pages/settings/index.vue:66-75`) and a
   byte-identical style block (`settings/index.vue:205-261` against `activity.vue:217-273`, checked
   with `diff`). The drawn hero is `padding: 10px 24px 28px` (`design/mocks/src/nulo.css:434`)
   directly under the 64px header (`nulo.css:100`; History in `parts/10-toasts.html:31`).
5. **The account header.** The popup renders `Header` unless Home's screen flag is set, the route
   is `popup-auth`, or the route sets `hideHeader`
   (`apps/extension/src/components/Header.vue:268`); it is 64px tall (`:343-344`); Settings'
   route meta has no `hideHeader` (`settings/index.vue:1-9`). The one drawn Settings page
   (`parts/12-incoming.html:53`, option B's snack) starts at its title with no header, while drawn
   History (`parts/10-toasts.html:31`) and Home (`parts/12-incoming.html:31`) have it.
6. **The date heading.** History groups its rows by the date formatted "MMM d, yyyy" in capitals
   (`TransactionsList.vue:24-35`) under a heading with a rule (`:57-61`, `:83-101`). The drawn
   History has no heading and each row's second line says when ("Today · 11:40", "Yesterday",
   "Sep 20"; `parts/10-toasts.html:31`); a built row's second line is its hash
   (`TransactionCard.vue:193-199`, `TransactionIncomingCard.vue:71`), and the owner kept the
   received row as it is on 2026-09-25 (batch 4, answer 8, "I don't quite see what you are
   saying", recorded as "the received row stays as it is" in
   `implementations-plan/ux-feedback/b4-snackbar-rows-arrivals/plan.md` § P6).
7. **The labels.** `RecentActivityView.vue:799-800` renders "RECENT TRANSACTIONS" and a
   `<span @click="router.push('/popup/activity')">View Archives</span>`, and its token-feed branch
   repeats the title (`:875`). The drawing says "Recent activity" and "View all"
   (`parts/12-incoming.html:35`); `implementations-plan/ux-feedback/design/spec.md` names neither.
   Home's Holdings header on the same screen already reads "View all"
   (`popup/components/modules/general/TokensView.vue:404-409`). The token page renders the same
   view (`apps/extension/src/popup/pages/tokens/[id].vue:279`), so its link also opens all of
   History.
8. **The header's type.** `SectionLabel` (`packages/design/src/ui/SectionLabel.vue:28-38`) is 12px
   headline, 700, `0.1em`, uppercase, `--nulo-secondary`: the same type as `.header_title`
   (`RecentActivityView.vue:891-898`). Holdings uses it (`TokensView.vue:3`, `:396`). Its wrapper
   differs, so geometric equality is for the capture to show, not a claim here.
9. **What tests read these surfaces.** No e2e or component test pins "RECENT TRANSACTIONS", "View
   Archives" or the date format (`git grep -n -i "view archives\|recent transactions\|MMM d, yyyy"
   -- apps packages` hits only source), and none measures a row gap, a row height or a title
   (recon, § Reuse map). At `85c4d20f`, `rows.test.ts` seeds one 1.5 USDC transfer (`:40-82`,
   `openHomeWithRow` `:84-92`), waits for Home through `backToHome` (`:176-183`), checks a Contacts
   row's 24px edit box (`:312-331`, not an activity row) and that History does not scroll sideways
   (`:452-480`), which cannot see text overlapping inside a row. `network/incoming-arrival.test.ts`
   waits for Home rows by id (`:198-205`, `:565`) and reads the hero after `waitForHomeTotal`
   (`:293`, `:561`); `network/fiat-send.test.ts:43-46` does too. `network/home-cap.test.ts` clicks
   Holdings' `tokens-view-all` (`:51`), not the activity link. `navigation.test.ts:35` finds
   History's title by text (`text/HISTORY`), against the testid rule. The Firefox-only
   `action-popup-layout.test.ts:19-25` measures the bottom nav on every tab.
10. **No `@nulo/design` change.** The `.gap--10` utility exists
    (`packages/design/src/utilities.css:297`) and is used by `TransactionCardLayout.vue:75`; the
    landing imports the package (`apps/landing/src/main.ts:1`); every changed value is local to
    two extension pages, two lists and one hero.
11. **Words elsewhere.** `ARCHITECTURE.md:102` says "Home's Recent transactions shows one line for
    it"; `TokensView.vue:526` says "Same voice as RecentActivityView's "View Archives" link."
12. **Home's cap.** Home renders every in-flight card (`RecentActivityView.vue:824`) and caps only
    the settled preview to the remaining slots of five (`:56`, `:99`, `:120`), so a larger gap
    changes the list's height, not which rows show.
13. **Home's header spacing, outside the record.** The built header has `padding-bottom: 8px` and a
    1px rule (`RecentActivityView.vue:886-889`) and sits 16px above the list (`:790-795`); the
    drawn one has `padding: 14px 24px 6px` and no rule (`nulo.css:214`).
14. **The two view links are mouse-only.** Both are `span`s with a click handler and no
    `tabindex` or key handler (`RecentActivityView.vue:800`, `TokensView.vue:404-409`); the bottom
    nav's History tab reaches the same page.
15. **Home's "$0.00" before quotes.** The hero's skeleton shows while `isTotalUnsettled`, which
    reads balances and seeds only (`BalanceView.vue:192-199`, skeleton `:351`), capped at 12 s
    (`HERO_PENDING_CAP_MS`, `:202`, `:212`). A holding without a quote counts as $0.00 and marks
    the total partial (`BalanceView.vue:112-118`; `utils/token-aggregate.ts:17-29`), so the hero
    reads "$0.00" over "priced assets only" (`:384-390`) until quotes arrive; with no arrival
    in progress the figure then jumps, without a count (`balance-count.ts:65-77`). Quotes start
    empty on every mount (`usePrices.ts:23`) and come from one `refreshIfStale` call (`:33-41`),
    which answers from cache only when every mapped id is fresh (15 minutes, `price/spec.ts:22`)
    or a fetch completed in the last 3 minutes (`price/service.ts:27`, `:145-158`), and otherwise
    after a CoinGecko fetch aborted at 10 s (`:335`). The smoke `fiat-display.test.ts:12-29` pins
    an empty wallet's "$0.00" after `waitForHomeTotal` (`fixtures/helpers.ts:999-1002`).

No unit test was run for this plan.

### Inferences (unverified; audits attack these)

1. The ≈31px offset is the bar's in-flow height, 12px + a 13px Space Grotesk line (about 17px) +
   12px ≈ 41px, less the drawn 10px top padding. P1's red run records the real number on both
   browsers.
2. The Settings drawing leaves the header out to frame the snack, not by design: every other drawn
   tab page has it (Fact 5). The owner decides (O3).
3. A zero-height block sticky wrapper with a full-width block child sticks and paints the same in
   Chrome and Firefox, and the threshold-0 `IntersectionObserver` on the hero still shows the bar
   when the hero leaves (sooner in scroll, since the hero moved up). P1's preservation pins and
   P2's run prove both.
4. A priced row's extra height is the dollar line: with JetBrains Mono's normal line height (about
   1.32), 18.5 + 2 + 13.2 + 2 + 11.9 ≈ 47.6px of amount column plus 12px of padding; without the
   line the 40px icon sets 52px. P1 logs heights, never asserts them.
5. No e2e outside `rows.test.ts`, `navigation.test.ts` and the hero's readers (Fact 9) depends on
   where a row or a title sits: the snack tests measure against the nav and footers, which do not
   move. The full smoke runs on both browsers prove it.
6. A receipt row can be seeded through storage (`nulo:core:incoming-transfers`,
   `wallet/services/incoming-transfer/repository.ts:36`) and reaches Home and History in the smoke
   build. If P1 finds it cannot, the priced-receipt containment probe runs inside
   `network/incoming-arrival.test.ts`'s existing priced receipt on Chrome, locally through
   `e2e:agent`.

### Asks

- O1 to O5 and the blanket (`owner`): § UI asks for the owner.
- C1 (`codex`): the shared style module against the in-place fix (§ Trade-offs 2). Codex round 1:
  **approve**.
- C2 (`codex`): the height-0 sticky bar against any other way to take it out of the flow. Codex
  round 1: **amend**, an explicit block wrapper with a full-width block label and painted-child
  checks; applied (§ Architecture L2, P1.4).

### Plan audit ledger

- `/codex high` (GPT-6 Astra), round 1: **conditional approve**, confidence high, conditions 1-7,
  session `01a0edf3-9284-7ed2-a645-d401db0e93c3`. All seven accepted.
- Driver, round 1: O5 added (`hygiene`'s F-3), verified against the code (Fact 15).

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex | major | The zero-height bar keeps `display:flex; align-items:center`, so the padded child straddles the wrapper and may not span the width; the wrapper-centre probe proves nothing | accepted: L2 names the block wrapper and full-width block label; P1.4 probes the painted child's centre and edges in hidden, shown and back-at-top states, both pages and browsers; one comment on the wrapper |
| 2 | codex | major | Two short seeded transfers cannot prove no clipping; titles wrap and the amount column cannot shrink; "every row is 59/52px" is unsafe | accepted: P1.3 seeds a long title, a wide amount and a priced receipt; containment and non-overlap at 360×600 in both themes and browsers, token page included; heights logged only; the 12px heading clearance, the 28px hero padding, Tab order and real clicks around the bar asserted; Fact 2 and UI rows 6 drop the fixed heights |
| 3 | codex | minor | O2 (c) also breaks `TransactionIncomingCard.test.ts:125`; O2 (b) must keep tooltip and activation; O4 (b) by removing headings leaves 24px between groups | accepted: P4.1 names the receipt test and keeps its once-only navigation; O2 (b) keeps the title and `activate()`; O4 (b) sets the group gap to 10px too, shown in the two-day capture |
| 4 | codex | minor | Several Facts are wrong or overbroad (2's provenance, 3's diff and test path, 5's header guards, 9's Contacts box and network readers, 12's cap) | accepted: Facts 2, 3, 5, 8, 9, 12 corrected at file:line; #719's `rows.test.ts` re-read at `85c4d20f`; sibling-plan claims marked as build-time rechecks (§ Delivery) |
| 5 | codex | minor | A copied smoke config outside the repo breaks its `./vite.shared` import; recon's archive advice cannot fix `shots.mjs`/`build.py` paths | accepted: P4.3 uses the CLI's `--retry=0` with the normal config; recon and P3.1 run the drawings before the archive move or from a scratch copy with the repo root fixed |
| 6 | codex | minor | The PR may open before answers while P3 gates P4; Storybook only if a story changes; preservation checks labelled as red; Inference 3's "same scroll" unsupported | accepted: the PR opens after P4 and the loop (Approval, Delivery); Storybook build is in P2 and P4 gates; P1 labels the opacity/top/hit checks as preservation pins; Inference 3 and UI row 3 say "appears when the hero leaves" |
| 7 | codex | minor | Comments: delete `TokensView.vue:526`; remove narrations at `TransactionsList.vue:57`, `:63`; do not carry review-history paragraphs; one comment on the zero-height wrapper | accepted, amended for one part: `:526` deleted, `:57` and `:63` removed, the wrapper comment written; `RecentActivityView.vue:50-61` is not touched here because `hygiene`'s comment sweep rewrites it (its table rows 3-8) |
| 8 | driver | major | Home's hero reads "$0.00" until quotes land (`hygiene` F-3) | accepted: L7, Fact 15, O5 with (a) and (b), no (c) (stale quotes or a dash break recorded rules), UI row 9, P1.2, P2.4, P3 captures, shared files named |

### Decision ledger

Realism, one line each (no fix, no test, no owner question):

- A Chrome side panel wider than 360px: realistic, and nothing here depends on the width; the
  captures stay at the popup's 360×600.
- The headline font failing to load: the old offset depended on its metrics, the new bar does not;
  no test.
- A History with hundreds of rows: the gap adds 6px per row and nothing else; no test.
- Reduced motion: no motion changes; nothing is tested. Light theme is in P1's containment case,
  since a cut amount is a wrong-amount path.
- A zoomed popup: no test; nothing here uses fixed page heights.
- Fiat values turned off: the dollar line and Home's fiat hero are absent; captured once under O2
  as context; O5 (b) does not wait when fiat display is off.
- A price fetch that never answers: the fetch aborts at 10 s and the 12 s cap ends the skeleton
  anyway (Fact 15); no test beyond the existing cap case.
- A focused Settings row scrolled under the shown bar: the bar is today's size, so this is today's
  behaviour; no test.
- A transfer row cuts a whole part longer than 8 characters to its first 8 (123,456,789.123456
  USDC reads "123,456,"; P1's wide row, `lessons/phase-1.md`): a wrong amount, owned by
  `amount-honesty` (its UI row 7, the compact form); not changed here.

No brief item was found unrealistic. The brief's "third ≈ $ line" turned out to be a deliberate
decision (Fact 2), so it is an owner call with keep recommended, not a fix. No point is disputed
with codex.

### Follow-ups

- **Home's two view links are mouse-only** (Fact 14): Recent activity's "View history" and
  Holdings' "View all" are `span`s with a click handler, so Tab never reaches them (the nav's
  History and Holdings tabs do). A real link adds a Tab stop to Home, a UI change of its own.
- **From a token's page, History should open filtered to that token** (the panel, O1). The link
  opens every token's History, and History has no token filter today; a filtered view is a UI
  change of its own.
- **The view links' contrast** (the panel). Both use `--nulo-outline`, 2.1:1 on the dark
  background and 1.6:1 on the light one; the drawing's `.n-list-link` uses `--nulo-secondary`,
  6.4:1 dark and 5.3:1 light (`implementations-plan/ux-feedback/design/mocks/src/nulo.css:216`).
- **Screen readers hear History's and Settings' title twice** (the panel). The compact bar's
  label stays in the accessibility tree while hidden (opacity 0, no `aria-hidden`), as before this
  plan.
- **Owner decision: a failed first price fetch still ends in "$0.00" and "priced assets only" on a
  funded wallet** (the panel, O5). An honest no-price state collides with the hero's rule that it
  is always a dollar figure (`BalanceView.vue:116-117`), so only the owner can choose.
- **Home's section header against the drawing** (Fact 13): the built rule and 25px from label to
  first row, against the drawn 6px and no rule; not in the record, so not changed.

## Approval

Final at build time (the driver's brief). **Delivery boundary**: the PR opens only after the
answers are recorded in P3 and P4, applied in P4, and the codex loop has converged.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/layout-polish/lessons/phase-N.md`. Unit commands run from
`apps/extension`. Smoke runs build first:
`VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`,
then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e [files]` (`<b>` is
`chrome` or `firefox`). Never a smoke and a network run of the same browser together.

### P0 · Plan in the tree ✓

1. Branch `feat/layout-polish` off `dev` (`85c4d20f` or later), in the harness's agent worktree.
2. First commit: `implementations-plan/layout-polish/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`.
3. Recheck at build time: whether `hygiene`, `amount-honesty` or `copy-polish` merged first, and
   rebase over any that did (§ Delivery, Overlaps).

Assumes: `rows.test.ts` has `backToHome` (Fact 9, at `85c4d20f`).

Gate:
- Commands: `bun run lint`; `bun scripts/ci-cd/plans/check.ts`.
- Pass: both exit 0.
- Layers: lint, CI-gating.

### P1 · Red tests that measure today ✓

1. `RecentActivityView.test.ts`: one case: the account feed with a row shows "Recent activity"
   and a "View all" (`activity-view-all`) whose press pushes `/popup/activity`, and the empty
   token feed shows "Recent activity".
2. `usePrices.test.ts` and `BalanceView.test.ts` (O5 (b)): `settled` turns true on the first
   answer, resolved or rejected; with a price-mapped holding and `refreshIfStale` held, the hero
   shows `balance-hero-loading`, never "$0.00", then the figure once it resolves; a rejected answer
   ends in "$0.00" with "priced assets only"; an empty wallet and an unpriced-only wallet do not
   wait; the 12 s cap still ends the wait. The existing cases at `BalanceView.test.ts:241` and the
   cap block (`:379`) stay green.
3. `rows.test.ts` (new values and containment): `seedTransaction` takes a hash, an amount and a
   token, and a receipt seeder is added (Inference 6). One case seeds a priced 1.5 USDC transfer, a
   priced transfer with a wide amount (`123456789.123456`), a row whose title wraps at 360px (P1
   records which seeded field reaches the title), and a priced receipt, then on Home, a token's
   page and History reads: the gap between consecutive `tx-card` boxes, 10 ± 0.5px (red today at
   4px); History's first date label bottom to its first row top, 12 ± 0.5px (a pin); and for
   every row, every descendant's box inside the row, the title's box not intersecting the amount
   column's, and the amount's `scrollWidth` not above its `clientWidth` (pins). It logs each row's
   height without asserting it. The containment part runs in dark and in light.
4. `navigation.test.ts` (titles and the bar): add `data-testid="page-hero"` to both heroes,
   `page-hero-title` to both titles, `page-title-bar` to both compact-bar labels (the painted
   child) and `settings-page` to Settings' wrapper (new testids; none renamed). One case, on
   History (`activity-feed-root`) and on Settings: the title's top less its wrapper's top is
   10 ± 1px and the hero's computed `padding-bottom` is `28px` (both red today); then the
   preservation pins, green today and after: at the top, `elementFromPoint` at the bar label's
   centre and 1px inside each edge lands on the hero, not the bar; scrolled to the end, the label's
   computed opacity reaches 1, its top is the wrapper's top ± 1px, its width is the wrapper's
   client width ± 1px, and the same five points land inside it; a real `page.mouse.click` 2px
   below its bottom edge on Settings opens the row under it; back at the top, the five points land
   on the hero again. The Tab walk on Settings from the page's start records the testid order,
   which P2 must reproduce. Replace `text/HISTORY` at `:35` with the new testid.
5. Run all of it on `85c4d20f`'s code, Chrome and Firefox; record every measured number in the
   log. Expected red: the copy case, O5's hero cases, the row gaps (4px), the titles (about 41px)
   and the hero padding (32px). Everything else green.

Assumes: Inferences 1, 4 and 6 (the log confirms or corrects them); the new testids are the only
markup change in this phase.

Gate:
- Commands: `bun --bun vitest run src/popup/components/modules/general/RecentActivityView.test.ts src/popup/components/modules/general/BalanceView.test.ts src/composables/usePrices.test.ts`;
  the smoke build and `bun run test:e2e tests/e2e/rows.test.ts tests/e2e/navigation.test.ts` on
  Chrome and on Firefox; `bun run lint`.
- Pass: exactly the cases listed as red fail, each with today's value in its message; every pin
  and old case passes; lint exits 0.
- Layers: unit, component, smoke e2e (both browsers).

### P2 · Build the recommended layout ✓

1. L1: the two gaps, the date row's padding, the two narrating comments (§ Architecture).
2. L2: `popup/pages/tab-hero.module.css`, both pages composing from it; the block wrapper at
   height 0 with its one comment, the full-width block label carrying the padding and background;
   the hero at `10px 24px 28px`.
3. L3 as O1 (a): `SectionLabel`, "View all" with its testid, the `TokensView.vue:526` comment
   deleted, `ARCHITECTURE.md:102`.
4. L7 as O5 (b): `usePrices`' `settled` and `BalanceView`'s pending condition.
5. Re-run P1's tests green; run the full local gates.

Assumes: Inference 3 (the e2e proves it); the owner may still change L3 or L7 (then P4 swaps them).

Gate:
- Commands: `bun run lint`; `bun run typecheck:all`; `bun run test:all`; `bun run test:ci-gating`;
  `bun run build`; `bun run --cwd apps/extension build-storybook`; the full smoke suite on Chrome
  and on Firefox (the gate's build flags above); `bun run e2e:agent tests/e2e/network/incoming-arrival.test.ts tests/e2e/network/fiat-send.test.ts`
  on Chrome (O5 (b) on the branch), then `bun run e2e:reap`.
- Pass: all exit 0; P1's cases green on both browsers, the Tab order equal to P1's record; smoke
  green at its config's retries; `fiat-display.test.ts` green.
- Layers: lint, types, unit, component, CI-gating, build, Storybook, smoke e2e, network e2e
  (two files, Chrome).

### P3 · The owner's decision page ✓

1. Rebuild the drawings before the ux-feedback plan moves to `archive/`:
   `python3 implementations-plan/ux-feedback/design/mocks/build.py`, then
   `node implementations-plan/ux-feedback/design/shots.mjs <scratch-dir>`. Both derive the repo
   root from their own location (`shots.mjs:11`, `mocks/build.py:9`); if the plan has moved, run a
   scratch copy with the repo root fixed (recon).
2. Build the alternatives on a local scratch branch, never pushed: O1 (b) and (c), O2 (b) and (c)
   (in `TransactionCardLayout.vue`), O3 (b) (`hideHeader` on Settings), O4 (b) (no date rows, one
   10px list), O5 (a) (today's pending condition).
3. Capture with a scratch Puppeteer script outside the repo against the smoke build: the popup at
   360×600, device scale 1, with rows seeded as P1 seeds them. A row the storage seeds cannot make
   comes from the network harness's sandbox, as batch 4's parity captures did (one `e2e:agent` at
   a time). Today's captures come from `85c4d20f`'s build.
4. Publish one private Artifact (an `answers` database, as the earlier sign-off pages): for each
   surface, today, the drawing and each option, side by side, at 1×; the five calls with their
   recommendation; one blanket sign-off for B1, B2 and every call answered "as recommended".
5. Record the owner's answers here, quoted, with the date.

Capture list (dark unless stated; "both" is Chrome and Firefox):

| Call | Option | State | Browser | Theme |
|---|---|---|---|---|
| B1 | today (`85c4d20f`) · drawing `11-rows` A · built | Home with three rows at rest; History with the same rows; the token page's list | both (built), Chrome (today) | dark; built also light, Chrome |
| B2 | today · drawing `10-snackbar` (History), `12-incoming` B (Settings) · built | History and Settings at the top; each scrolled with the compact bar shown | both (built), Chrome (today) | dark; built also light, Chrome |
| O1 | (a) · (b) · (c) = today · drawing `12-incoming` A (its header) | Home's header above its rows; the token page's header | Chrome; (a) also Firefox | dark |
| O2 | (a) = today · (b) · (c) · drawing `11-rows` A | Home with a priced send, a priced receipt, an unpriced row and the long title; History with the same; (a) also with fiat values off | Chrome; (a) also Firefox | dark |
| O3 | (a) = today with B2 · (b) · drawing `12-incoming` B | Settings at the top | Chrome | dark |
| O4 | (a) = today with B1 · (b) · drawing `10-snackbar` | History with rows from two days | Chrome | dark |
| O5 | (a) = today · (b) | a sequence: just after opening a wallet holding priced USDC with no fresh quote; after the quotes land (built, or a faithful mock from the built settled frame) | Chrome | dark |

Assumes: the owner answers on the page; an answer other than the recommendation becomes P4 work.

Gate:
- Commands: none in the repo; the Artifact URL printed in the transcript and in `lessons/phase-3.md`.
- Pass: every row of the capture list is on the page; the owner's answers are quoted in this plan.
- Layers: none (owner review).

Answers: decided on 2026-09-29 by the panel the owner delegated to, recorded in § P4. The page:
https://claude.ai/artifact/CkFrJzKMAmyTkWSN7mXV7G (`lessons/phase-3.md`). The owner's own answers
of 2026-09-30 are in § P4 too.

### P4 · Apply the answers and close ✓

**The answers, by delegation (2026-09-29).** The owner, away, delegated the open decision pages:
"any chance your resolve auditing with Codex and Opus5.5 subagents the open artifacts? Ask those
subagents to be evaluators on the ux/ui/copies. Use your knowledge about my previous decisions
too." The driver ran a panel on this page, two Opus 5.5 evaluators (an interaction lens and a copy
and visual lens) and codex (session `01a0ef77-c701-7113-a16f-c4b9e46c5da5`), and decided. Each
answer is a delegated decision the owner can overturn, not the owner's own sign-off.

| Call | Decision | Panel |
|---|---|---|
| O1 | (b) "Recent activity" and "View history" | two to one, the copy evaluator and codex: "View all" on a token's page promises all of that token, but the link opens every token's History, and "View history" is true on both screens. Dissent: the interaction evaluator preferred (a). |
| O2 | (a) keep the "≈ $" line | unanimous |
| O3 | (a) keep Settings' account header | unanimous |
| O4 | (a) keep History's date heading | unanimous |
| O5 | (b) the skeleton until the first price answer | unanimous |
| B1, B2 | signed | unanimous |

Applied: O1 (b) in `1ec3747a`, its unit case red first ("expected 'View all' to be 'View
history'"); the other answers are P2's build. The panel's four follow-ups are in § Follow-ups.

**The owner's sign-off, 2026-09-30.** On the decision page the owner answered O1 (b), O2 (a),
O3 (a), O4 (a) and O5 (b), then wrote: "Okei, ive answered everything on the artifacts." The
page's blanket button was left unclicked, so the driver asked in chat: "#724 layout-polish: its
page's final sign-off button wasn't clicked. It covers B1 (activity rows 10px apart on Home, a
token's page and History) and B2 (History's and Settings' big titles 10px under the header, as
drawn), both built and green. Sign them off?" The owner picked **"Sign off B1 + B2"** (the option
read: rows 10px apart and titles at their drawn height, as pictured on the page, as built). Every row of
§ UI impact now carries the owner's own answer.

1. For each answer other than the recommendation, build it on the branch with its test:
   O1 (b) or (c): the strings and P1's unit case; O2 (b): `TransactionCardLayout.vue` with the
   dollar figure keeping its "At today's price" title and its `target?.activate()` press, its test,
   its story; O2 (c): the same files, `rows.test.ts:288-289`, and
   `components/composite/activity/TransactionIncomingCard.test.ts:125`, whose fiat assertions go
   while its once-only navigation check stays on the row; O3 (b): `hideHeader` on Settings and a
   check of every e2e that clicks the header on Settings; O4 (b): `TransactionsList.vue` (no date
   rows, the group gap 24px → 10px) and its test; O5 (a): P2.4 reverted with its unit cases.
2. `implementations-plan/follow-ups.md`: delete the "Layout around batch 4's surfaces" entry
   (§ ux-feedback: owner decisions) and add this plan's two follow-ups.
3. Flake bar: three consecutive retry-0 runs per browser of `rows.test.ts` and
   `navigation.test.ts`, as `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e --retry=0 tests/e2e/rows.test.ts tests/e2e/navigation.test.ts`
   (the normal config; the CLI's `--retry=0` overrides its `retry: 2`).
4. `bun run e2e:reap`.

Assumes: no answer adds a surface outside L1 to L7; one that does is a new plan.

Gate:
- Commands: `bun run lint`; `bun run typecheck:all`; `bun run test:all`; `bun run test:ci-gating`;
  `bun run build`; `bun run --cwd apps/extension build-storybook`; the full smoke suite on Chrome
  and on Firefox; the two network files on Chrome if O5 (b) stands; the flake bar; `bun run e2e:reap`.
- Pass: all exit 0; the flake bar three of three per browser; counts recorded in
  `lessons/phase-4.md`.
- Layers: lint, types, unit, component, CI-gating, build, Storybook, smoke e2e, network e2e, flake
  bar.

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P4 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't?"), and these
   two rules, verbatim in the first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/post-impl.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope. A visible
   change it proposes is an owner question, not a fix.
4. If the loop changed a captured surface, re-capture it and update the decision page.
5. **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc, one branch `feat/layout-polish`, one PR off `dev`, plain `gh pr create` after the
  owner's answers are applied and the loop converges; then `gh pr checks --watch`.
- Title: `feat(layout): activity rows 10px apart, tab titles at their drawn height` (≤ 93
  characters), adjusted to the owner's answers.
- Commits: conventional, lower-case, signed; one per phase at least, fixes separate.
- PR body: the UI impact table with each row's quoted sign-off, the decision page's link, a
  capture of each changed surface, the red-before-green numbers per browser, the e2e counts.
- **Overlaps** (recheck at build time; the sibling plans are unmerged drafts):
  - `hygiene`: `network/incoming-arrival.test.ts` (its `waitForPricedHero`),
    `fiat-display.test.ts` and `fixtures/helpers.ts`' `waitForHomeTotal`, which this plan reads and
    does not edit, and `RecentActivityView.vue`'s comments; whichever PR lands second rebases, and
    O5 (b) keeps `fiat-display.test.ts`'s empty-wallet case green.
  - `amount-honesty`: `TransactionsList.vue` and `RecentActivityView.vue` (it passes `tokens` to
    the card), `TransactionCard.vue` and its test; `TransactionCardLayout.vue`,
    `TransactionIncomingCard.test.ts` and `rows.test.ts` too if O2 (b) or (c). Whichever lands
    second re-runs `TransactionsList.test.ts`, `TransactionCardLayout.test.ts` and `rows.test.ts`.
  - `copy-polish`: textual only, in the same popup files.
  - `follow-ups.md` and `index.md` with every wave-2 plan (reconcile against `dev` right before
    delivery).
- **Merge**: by the driver under the owner's standing authorization, once every required check is
  green on the head, every UI impact row carries the owner's quoted sign-off, and the codex loop
  has converged. Never `--admin`.
- Closing the plan in the same PR: the `## Outcome` block after the front matter, any general
  gotcha promoted to `implementations-plan/lessons.md`, the follow-ups moved (P4.2).

## Seeds

DRAFT until approval.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/layout-polish/plan.md. Done when the transcript shows every phase ✓ in plan.md with its validation gate reported passing, P1's red run recorded on Chrome and Firefox with the measured gap, title, hero-padding and hero-pending results, LESSONS_FILE=implementations-plan/layout-polish/lessons/phase-N.md printed per phase, the decision page's Artifact URL, the owner's answers to O1-O5 and the blanket sign-off quoted in P3 and applied in P4, the flake bar three of three per browser, a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. Merge only with every required check green and every UI row signed off. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/layout-polish/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step; write its failing test first and record the red numbers; after each edit run bun run lint and the phase's vitest or smoke command; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner's decision page. Phase gate green: paste it, mark ✓, print LESSONS_FILE. One e2e run at a time, never smoke and network of one browser together, bun run e2e:reap after. P4 done and the owner's answers applied: the Post-implementation loop, then gh pr create and gh pr checks --watch, then report and stop. Merge only when every check is green and every UI row is signed off; hard limits stay hard.
```

Use exactly one per session.
