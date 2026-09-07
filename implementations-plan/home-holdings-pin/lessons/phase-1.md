# Phase 1 — four tabs and an empty Holdings page

Implemented on the Mac (owner's call to start here instead of the homelab), 2026-09-06.

## What changed
- `Navigation.vue`: `general` relabelled HOME with the `home` glyph; new `holdings` entry
  (`nav-holdings`, `/popup/holdings`, `account_balance_wallet`). Route name and path of Home untouched.
- `pages/holdings.vue`: TS SFC, auth + bottom-nav route meta, `holdings-page` testid, placeholder
  `SectionLabel`. Real content lands in Phase 3.
- `tests/e2e/fixtures/helpers.ts`: `clickNavTab` union gains `"holdings"`; new `openHoldings(page)`.
- `tests/e2e/navigation.test.ts`: the tab round-trip walks all four.

## Gate notes
- `bun run typecheck` at the root fails with `vue-tsc: command not found` on a fresh worktree — the
  root script names the binary directly and only `apps/extension/node_modules/.bin` has it. The
  extension's own `bun run --cwd apps/extension typecheck` is what CI's `typecheck:all` runs; plan.md's
  `<fast>` now says so.
- Glyph check (fontTools on the bundled subset): `home` and `push_pin` present.
