# Phase 2 — Drop the `dark` color name (split: tertiary dots / secondary metadata)

**Status:** ✓ DONE (machine-green; the 8-site visible change rides with P4's visual sign-off — but the
token choice was pre-approved via `dark-color-options.html`).

## What shipped
- **8 call sites repointed** per the approved split: the 2 masked-`•••` dots
  (`TokenMetadataPopup.vue:79`, `ReceivePopup.vue:65`) → `tertiary`; the 6 mono metadata values
  (`TokenMetadataPopup.vue` ×6) → `secondary`. (`perl` for the 6 identical `color="dark" mono` lines;
  the 2 `color="dark">•••` dots separately.)
- **`dark` removed at the source:** `token-contract.ts`'s `textColors` map (`dark: "--gray-15"` + the
  ghost-comment) deleted; `utilities.css` REGENERATED via `bun run gen:tokens` (it's generated —
  `utilities.drift.test.ts` enforces it; editing the CSS directly would fail the drift test). That
  drops both `.color--dark` and `.fill--dark`.
- **The SCSS side (codex catch):** `_text.scss`'s `$textColors` map still shipped `"dark": "--gray-15"`
  (`_base.scss` `@use`s it, live via `setup/index.ts`) — removed there too.
- **Tests:** dropped the now-invalid `Text.test.ts` `(PIN) color='dark'` case; cleaned the stale
  `--gray-15` ghost note in `tokens.parity.test.ts`.

## Note
The `dark`→`--gray-15` ghost rendered as INHERITED full text color (the var was never declared), so
the real visible delta is full-color → muted — NOT a gray fix. The split (tertiary for the recede-y
dots, secondary for the readable-but-muted metadata) was chosen from the rendered mockup.

## Validation gate — PASS
`bun run typecheck:all` → 0 · `bun run --cwd packages/design test` → 248 (Text −1 PIN; utilities.drift
green ⇒ regen matches the contract) · `bun run test` → 2409 · `bun run lint` → 0 · `bun run build` +
`bun run build:faucet` → 0. No `color="dark"` / `.color--dark` / `.fill--dark` / `"dark":` / `--gray-15`
remains in `packages/*/src` (grep empty).

LESSONS_FILE=implementations-plan/design-system-externalization-round-3/lessons/phase-2.md
