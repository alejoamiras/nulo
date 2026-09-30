# layout-polish · recon

Read at `f32b1e0a` (dev after #718, the same tree as `48a97f4a`); `rows.test.ts`, the one file here #719 touched, re-read at `85c4d20f` (dev after #719). Paths are repo-relative; extension source paths
are under `apps/extension/src/` unless they start with `apps/`, `packages/` or
`implementations-plan/`.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| A 10px row gap on Home | `.list { gap: 4px }` in `popup/components/modules/general/RecentActivityView.vue:955-959` | adapt (one value) |
| A 10px row gap on History | the per-date `Flex gap="4"` in `popup/components/modules/activity/TransactionsList.vue:56`; `@nulo/design`'s `.gap--10` utility exists (`packages/design/src/utilities.css:297`), already used by `TransactionCardLayout.vue:75` | adapt (one prop, plus the date row's `padding-bottom` at `:83-85` so the heading keeps its 12px to the first row) |
| The History and Settings titles at the drawn height | two byte-identical blocks: the sticky compact bar and the hero, `popup/pages/activity.vue:174-183` + `:217-273`, and `popup/pages/settings/index.vue:66-75` + `:205-261`; each page also carries the same `IntersectionObserver` (`activity.vue:121-138`, `settings/index.vue:39-53`) | adapt: move the two style blocks into one shared module the two pages `composes` from, following `popup/pages/detail-page.module.css` (composed by `popup/pages/journal/[id].vue:358-459`); the observer stays in each page |
| The Home header label | `SectionLabel` from `@nulo/design` (`packages/design/src/ui/SectionLabel.vue`), whose type is exactly today's `.header_title` (12px, 700, `0.1em`, uppercase, `--nulo-secondary`; `RecentActivityView.vue:891-898`); Home's Holdings header already uses it (`popup/components/modules/general/TokensView.vue:3`, `:396`) | reuse-as-is; delete `.header_title` |
| The "View all" link | Holdings' `View all` span, `TokensView.vue:404-409`, styled `.view_all` (`:526-541`), which is a copy of `.archive_link` (`RecentActivityView.vue:900-915`) and says so in a comment that names "View Archives" (`TokensView.vue:526`) | adapt: text only, plus a `data-testid="activity-view-all"` like `tokens-view-all`; update the comment. Two copies of one style is under the three-site refactor line: leave them |
| Hiding the account header on one route (O3 (b), capture only) | route meta `hideHeader`, read by `components/Header.vue:268`, set by eight pages (for example `popup/pages/settings/security/reset.vue:5`) | reuse-as-is |
| A red unit test for the copy | `popup/components/modules/general/RecentActivityView.test.ts` (771 lines; its harness mounts the view `shallow: true` with a router and service fakes, `:225`, and unstubs single children where a case needs them, as at `:510`) | reuse the harness, add one case that unstubs `SectionLabel` (or reads the stub's `label` prop), since a shallow mount does not render its text |
| A red e2e for the gaps and containment | `apps/extension/tests/e2e/rows.test.ts` at `85c4d20f`: `seedTransaction` writes one finalized 1.5 USDC transfer under a fixed hash (`:40-82`), `openHomeWithRow` seeds, prices and waits for the row (`:84-92`), `backToHome` also waits for Home's token card (`:176-183`) | adapt: `seedTransaction` takes a hash, an amount and a token; add a receipt seeder over `nulo:core:incoming-transfers` (`wallet/services/incoming-transfer/repository.ts:36`) if the smoke build surfaces it, else the priced receipt comes from `network/incoming-arrival.test.ts` (plan, Inference 6) |
| A red e2e for the titles | `apps/extension/tests/e2e/navigation.test.ts` opens History and Settings through `clickNavTab` (`:5-39`) | extend it; new testids on the two heroes, the compact bar and the Settings wrapper (History's wrapper already has `activity-feed-root`, `activity.vue:171`) |
| The drawings for the decision page | `implementations-plan/ux-feedback/design/mocks/build.py` then `design/shots.mjs` (targets `10-snackbar`, `11-rows`, `12-arrival`, `12-incoming` in `design/targets.mjs:86-90`) | reuse-as-is, before the ux-feedback plan moves to `archive/`: both derive the repo root from their own file location (`shots.mjs:10-11`, three levels up; `mocks/build.py:8-9`, `parents[3]`), so the invocation path cannot fix them after the move; then run a scratch copy with the root fixed |
| Captures of the built popup at 360×600 | batch 4's parity captures were taken by a script outside the repo (`implementations-plan/ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-6.md`, § The parity page); nothing in the tree drives a capture except `tests/e2e/store-captures.test.ts`, which is opt-in and writes committed store art | build new, outside the repo: a scratch Puppeteer script against the smoke build. It must not land in the tree, and `store-captures` must not be used (it rewrites `store/captures/`) |
| Holding Home's hero until quotes land (O5 (b)) | `BalanceView.vue`'s `heroPending` (`:212`) over `isTotalUnsettled` (`:192-199`) with its 12 s cap (`:202-211`); `usePrices` (`composables/usePrices.ts:22-45`) and `getPriceMapEntry` (`wallet/services/price/price-map.ts:62`); the unit harness `BalanceView.test.ts` (its mocked `refreshIfStale`, `:101`; the cap block, `:379`) and `composables/usePrices.test.ts` | adapt: one `settled` ref in `usePrices`, one more condition in `heroPending`; no new timer |
| The owner's decision page | the earlier sign-off pages (ux-owner-picks, send-amount-exact): a private Artifact with an `answers` database | reuse the pattern |

Searches with no hit, so nothing to reuse: no e2e or component test measures a row's height, a
row gap, a title's offset or the date heading. `rg -n "getBoundingClientRect" apps/extension/tests/e2e`
finds rows.test.ts's centre points, 24px box and no-sideways-scroll check (`:215`, `:322`,
`:468`), the snack's placement against the nav and footers (`snackbar.test.ts`), tooltip bubbles
(`tooltips-glossary.test.ts`), a popup-over-popup hit test (`popup-stack.test.ts:20`) and, on
Firefox only, the bottom nav's edge on every tab (`action-popup-layout.test.ts:19-25`). None reads
a row gap or a title, but the last one runs on the two pages this plan changes, so the Firefox
smoke run is part of the gate. No test pins "RECENT TRANSACTIONS", "View Archives" or the date format (`git grep -n -i
"view archives\|recent transactions\|MMM d, yyyy" -- apps packages` hits only the source files);
no token in `@nulo/design` names a list gap or a page-title offset (`packages/design/src/token-contract.ts`).

## Conventions to match

- Scoped `<style module>` per SFC; shared page styles are a `*.module.css` beside the pages,
  pulled in with `composes: <class> from "<path>"` (`detail-page.module.css`,
  `list-empty.module.css`). No new token in `@nulo/design`: the landing shares it
  (`packages/design/README.md`), and every value here is local to two extension pages and two
  lists.
- Copy in source is written as it reads and uppercased by CSS (`SectionLabel`'s
  `text-transform: uppercase`), so the source string is "Recent activity", as drawn
  (`implementations-plan/ux-feedback/design/mocks/src/parts/12-incoming.html:35`).
- e2e selects only by `data-testid`; new testids are added, none renamed. Geometry is read with
  `getBoundingClientRect` inside `page.evaluate`, as `rows.test.ts:215-216` and `:468` do.
- Vue SFC block and script order per CLAUDE.md; comments only for a non-obvious why.

## Collision and dedup risks

- **#719 (merged, `85c4d20f`)** turned `rows.test.ts`'s `goBackTo` into `backToHome`, which also
  waits for Home's token card to settle because its empty state pushes the row down. This plan
  branches after it, edits `seedTransaction` and adds one case, and reuses `backToHome`'s wait for
  the same reason (a row measured before the token card lands moves).
- **`hygiene`** (unmerged draft; recheck at build time) adds `waitForPricedHero` to
  `network/incoming-arrival.test.ts` and keeps `waitForHomeTotal` (`fixtures/helpers.ts:999-1002`)
  because `fiat-display.test.ts:12-29` needs it on an empty wallet; it also rewrites the
  review-history comments in `RecentActivityView.vue` (`:50-61` and others). This plan reads those
  tests and does not edit them; O5 (b) must keep `fiat-display.test.ts` green.
- **`amount-honesty`** (unmerged draft; recheck at build time) edits
  `popup/components/modules/activity/TransactionCard.vue` and passes `tokens` to the card from
  `TransactionsList.vue` and `RecentActivityView.vue`, two files this plan edits (textual overlap
  only). This plan does not touch `TransactionCard.vue`. It touches
  `components/composite/activity/TransactionCardLayout.vue` only if the owner picks O2 (b) or (c);
  then the two PRs meet only through the row's amount column, and whichever lands second re-runs
  `TransactionsList.test.ts`, `TransactionCardLayout.test.ts` and `rows.test.ts`.
- **`copy-polish`** rewrites em-dash strings across the popup. None of this plan's strings has
  one; `RecentActivityView.vue` holds no clause-joining em dash in copy (its " — " hits are in
  comments). Only textual conflicts are possible.
- **Shared curated files**: `implementations-plan/index.md`, `follow-ups.md` (this plan deletes
  the "Layout around batch 4's surfaces" entry under § ux-feedback: owner decisions and adds one),
  and `ARCHITECTURE.md:102`, whose "Home's Recent transactions" follows the copy.
- **Dedup**: the two tab pages' compact-bar and hero styles are the duplication this change would
  otherwise edit twice; the shared module removes it. The two "view" links' styles stay two
  copies.
