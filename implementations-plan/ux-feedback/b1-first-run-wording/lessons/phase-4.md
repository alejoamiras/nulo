# Phase 4 · Lock chip and marks (items 7, 8, U12, U13)

Picks: unchanged since P3's read (no U12 or U13 row). Both are built as recommended (U12, U13A)
and stay **sign-off pending**. Sizes and offsets are the mock's (`design/mocks/src/nulo.css`):
`.n-lockchip`, `.n-pub-cell .ic`, `.n-rv-row > .ic`, `.n-rv-gap`, `.n-names-tag .ic`.

## What shipped

- `Header.vue`: the lock is a chip, `MaterialIcon lock` at 15px (primary) and "Lock" (mono 10px,
  500, 0.08em, uppercase, secondary), 26px high, padding `0 9px 0 7px`, gap 5px, the network chip's
  border and hover. Testid, `aria-label="Lock wallet"` and `type="button"` unchanged. The old
  `.icon_button` rule had no other user and went with it.
- `publishGlyph(visibility)` in `publish-facts.ts`: `hidden` → lock, `public` and `exposed` →
  globe, `unknown` → none.
- `PublishStrip.vue`: each cell draws its glyph inline (`Icon`, 10px, `aria-hidden`), none when
  unknown, so the cell's gap collapses; the glyph per cell is precomputed so the template's
  `v-if` narrows its type.
- `SendReviewSheet.vue`: the row's glyph at 10px with `margin-top: 2px`; an unmarked row keeps a
  10px spacer so its words line up.
- `FeeMethodSelector.vue`: the "names your address" tag draws `publishGlyph("exposed")`, the globe.
- `publish-mark.module.css`: `.mark` and `.filled` removed; the header comment describes glyphs.
  Words, sentences, `stripAriaLabel`, every testid and `data-*` attribute are unchanged.
- Tests: the mapping for every visibility; the strip's glyph per cell and state, its size and
  `aria-hidden`, and no glyph on `NO_FACTS`' you cell; the review rows' glyphs and the unknown
  row's spacer; the tag's globe; the header chip's icon, word, accessible name and type.

## Decisions

1. **No new component for the glyph.** An L3 composite may not import another L3, so the three
   consumers render `Icon` inline, as the plan says. The colour comes from the parent's visibility
   class; `Icon` without a `color` prop fills with `currentColor`.
2. **The chip keeps `:active { opacity: 0.8 }`** from the button it replaces. The mock draws no
   pressed state, and dropping it would remove feedback the button already gave.

## Gate

- `bun run lint` → exit 0 (30 warnings, 5 infos, none in changed files).
- `bun run typecheck:all` → exit 0.
- `bun run test:all` → exit 0 (extension 7,122 passed, 4 skipped, 7 todo).
- `bun run --cwd apps/extension build-storybook` → exit 0 ("Storybook build completed
  successfully"; `PublishStrip.stories.ts` builds).
