# Lessons — dedup-p4-vue-shells

Base: `worktree-dedup-p3-service-wrappers` (PR #568). Scope: ledger ids J1 J2 J3 J4 K1 K7 K4 K5 K6 K9 K10 K11 L1 L3 N6 N9 M2 M3.

## Phase 0 — blueprint light under the ledger README's pre-answers

- Deviation: the README pre-answers "recon: 0 extra agents"; one read-only Sonnet reuse sweep ran anyway because P4
  introduces a mechanism with no precedent in the repo (CSS-module partials) and the ledger's line ranges were two
  phases old. Its findings are condensed in `recon.md`; every verdict that matters was re-checked by hand.
- The `composes:` spike (FeeCostReadout, reverted) is the fact the whole phase rests on: vitest 6/6, build 0, two-token
  mapping, one emitted partial rule.

## Skipped ids

- **K4** — the seven onboarding heroes share a shape but not their CSS or markup (padding 8/16/24, bar 40/56,
  `Flex` vs `header`, centered variants with a `.subhead`); a shared component would need four props and two slots
  to save ~30 lines.
- **J3 (LSM adoption)** — folded into J1's partial; `ListStatusMessage.empty` is a dashed 32px card, the pages'
  empty state a borderless 12px-gap column.
- **J4 (useEntityCrud move for contracts/notes)** — three visible-state differences (`isLoading` start value, error
  reset on refresh, the refetch toast) for ~30 lines; the template piece still lands.

## Codex plan audit

`/codex high` (GPT-6 Astra, session `01a07cb9-c178-7562-ab43-7d0f685a3e8f`): *conditional approve*, seven conditions, all verified and adopted (table in `plan.md` § Audit log). The two that changed the design: J2's shell must forward `#trailing` as a named slot and leave three exceptional pages on a partial; M3 is skipped (two chip variants and a two-chip case). Notes' error reset corrected the J4 reasoning.

## Skipped ids (after the audit)

- **M3** — the Incoming chip is accent-coloured and non-shrinking, the settled card's chip lacks the nowrap rules and renders two chips when both labels exist; a single `chip` prop on the layout cannot preserve that.
- **L3 (LSM adoption)** — `ListStatusMessage.empty_sub` adds `width:100%` and `overflow-wrap:break-word`; the two views compose a partial instead.

## Phase 1 — partials (J1, J3, L1, K9, K10, N6, N9, L3, J2's classes) ✓

- Six partials, 42 consumer files, +108/−467 before formatting. Every extraction asserted the consumer blocks equal
  (declaration-set compare, so `verify`'s reordered `.wrapper` and `GasBalanceCard`'s reformatted shimmer passed) before
  writing the partial from the first consumer.
- N9: the partial carries only the shared declarations and the `:hover`/`:active` blocks; `.fpc`/`.contact` keep
  `&:hover .icons { opacity: 1 }` locally (the build emits native nesting, so `.fpc:hover .icons` keeps its
  specificity), `.fpc` keeps `min-height`, all four keep `padding`.
- K10: the `body` rule stays in both viewer windows; only `viewer_wrapper`/`json_viewer` moved.
- Gate: lint 0 · extension typecheck 0 · 49 files / 487 tests (send, general, execute, popups, pages) · `build:chrome` 0
  with `src/types/` unchanged. Emitted CSS: each partial rule once (`select_row`, `approval_wrapper`, `scroll_area`,
  `viewer_wrapper`, `json_viewer`, `detail_row`, `fee_label`, `empty_state`, `amount_value`, `hero_meta` …); consumer
  → partial two-token mappings 4/4 approval windows, 2/2 viewers, 4/4 `detail_row`, 3/3 `fee_label`, 3/3 `skeleton`,
  4/4 select rows, 2/2 headers, 3/3 detail pages, 2/2 empty states, 18/19 settings wrappers and 18/19 contents; the
  composed skeleton's `animation` names the partial's emitted `@keyframes`; the partial's `select_row` rule precedes
  the consumers' rules in the stylesheet. (`AmountCard.vue` owns a separate shimmer — not an L1 site, untouched.)
