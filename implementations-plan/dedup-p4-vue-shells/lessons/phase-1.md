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

(pending)
