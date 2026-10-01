# Phase 2 — Base/theme/font takeover (RELOCATE) · SUPERVISED

Branch: `feat/design-system-p2-takeover` (stacked on `feat/design-system-p1-tokens`).

## What shipped (machine work)
- **`@nulo/design/base.css`** is now the wallet's full base stylesheet — a verbatim flattened port of
  the extension's `_base.scss` + `_flex.scss` + `_text.scss`: token blocks (`:root` dark +
  `[theme=light]`/`[theme=dark]` + `:root[data-has-nav]`), `@font-face` (package-relative `./fonts/`),
  `.material-symbols-outlined`, resets, scrollbar, body `user-select:none`, all 7 keyframe families,
  and the static utilities. `@import "./utilities.css"` pulls the generated utility layer.
- **`src/utilities.css`** — GENERATED (`render-css.ts`) from the contract scales/maps (`.fz--`/`.fw--`/
  `.lh--`/`.ta--`/`.color--`/`.fill--`/`.flex`/`.gap--`/`.justify-`/`.items-`/`.justify-items-`/
  `.content-`/`.wrap-`/`.flex-direction-`). Byte-pinned by `utilities.drift.test.ts`.
- **Fonts** `git mv`'d into `packages/design/src/fonts/` (5 live woff2; **ClashDisplay dropped** — dead,
  only `_base.scss` referenced it). Referenced package-relative; Vite/crxjs bundle + hash them.
- **Extension** `popup/index.ts` + `onboarding/index.ts` + `.storybook/preview.ts` now
  `import "@nulo/design/base.css"`; `_base.scss`/`_flex.scss`/`_text.scss` **deleted**; dead SCSS
  `loadPaths` removed from `vite.config.ts`. `setup/index.ts` left untouched (imports no base today).
- Token contract extended with the utility-class inputs (`textColors`, `textAligns`, `flexGaps`,
  `flexAlignments`, `flexWraps`, `flexDirections`) — verbatim from the originals.

## Decisions
- **Verbatim port over generate-from-re-encoded-values** for the token VALUE blocks: zero
  re-encoding risk for the look-same invariant; CSS owns values, TS owns typed names (the proven
  design, relocated). `tokens.parity.test.ts` asserts every typed token name is declared in base.css.
- **Generate the utility layer** (deterministic; avoids per-class hand-typing typos across ~120 classes).
- `--gray-15` ghost (`.color--dark` → undeclared var) preserved verbatim → renders inherited as today;
  fix tracked for the Phase-3 `Text` rewrite (§2.7).
- jsdom stubs `.css` imports → drift/parity tests read CSS via `node:fs` + `process.cwd()`.

## Machine gate — GREEN
- `bun run typecheck:all` exit 0 · `bun run lint` exit 0 (1095 files).
- `bun run build:chrome` + `build:firefox` + `build:faucet` exit 0. **Fonts verified emitted** (all 5
  woff2 hashed in `dist/{chrome,firefox}/assets/` incl. Material Symbols; faucet bundles them too) —
  closes the crxjs/font-path concern the audits raised.
- Tests: design 71 (drift + parity + boundary) · extension 2398 · faucet 336.
- Smoke e2e: **66/67 pass.** The one failure — `settings-crud > manage-fpcs ... synthetic Public Fee
  Juice anchor row` (a `waitForSelector('[data-fpc-id="public-fj"]', { visible: true })` 5s timeout) —
  is **PRE-EXISTING, not a takeover regression**: it fails IDENTICALLY on the Phase-1 branch
  (tokens-only, pre-takeover). No console/font/page errors. Smoke is advisory. Tracked for the
  smoke-fixture-cleanup follow-up, independent of this work.

## Human gate — PENDING (supervised)
Phase 2 is NOT marked ✓ until the user confirms the extension (chrome + firefox, light + dark, nav +
no-nav, key screens) and the faucet render identically. Fresh `dist/` built for load-unpacked review.

## Round-2 cleanup noted
- Faucet `public/fonts/` is now orphaned (base.css uses the package-bundled fonts) — remove later.
- Extension `src/assets/fonts/` dir removed (fonts relocated); `src/assets/styles/` removed.
