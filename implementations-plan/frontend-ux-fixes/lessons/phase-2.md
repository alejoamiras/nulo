# Phase 2 — vault → initials AccountAvatar (#4, non-Send)

**Status:** ✓ complete.

## What changed
- **New** `src/utils/string.ts` `getInitials(name)` — first letters of the first two words, or first 1–2
  chars of one word, uppercased; empty/whitespace → "". Behavior-identical to the contact service's
  former private `_getAbbreviation` (the unreachable `"AZ"` length-0 branch dropped; both return "" for
  empty). 8 unit tests in `string.test.ts`.
- **DRY:** `contact/service.ts` `_getAbbreviation` now delegates to `getInitials` (was a duplicated copy).
  Contact `abbr` derivation + the new avatar now share one source. Contact service tests stay green.
- **New** `src/components/composite/general/AccountAvatar.vue` — a rounded-square disc with the name's
  initials (white, weight 600) on a deterministic background color hashed (djb2) from the lowercased
  address. `size` prop (default 28); font-size = `max(9, round(size*0.4))`. 13 component tests.
- **Replaced `icon="vault"`** at the two NON-Send account sites via `SettingItem`'s `#icon` slot:
  `settings/accounts/index.vue:147` (hidden-accounts rows) + `EditAccountPopup.vue:99` (edit header).

## Design decisions
- **Initials avatar, NOT emoji** (user decision after the audit showed single-emoji = 8 bits/grindable
  and `hashToEmoji` can't parse a raw `0x…` address). The disc color is DECORATION — identity is the
  name+address shown alongside; collisions are expected and harmless (documented in the SFC).
- **Saturated disc + white initials** (not pale pastels): the repo has no dark theme (grep: no
  `data-theme`/`prefers-color-scheme`), and white-on-saturated reads on any surface — future-proof.
- **`#icon` slot, not the `icon` prop** (audit): `SettingItem.icon` only resolves an `<Icon name>` SVG and
  can't render an avatar; the slot wins and still triggers the 20×20 `.icon_wrapper`.
- **20px in SettingItem:** the `.icon_wrapper` is a fixed 20×20 box (`size="large"` only changes padding),
  so the avatar is sized 20 to fill it without layout shift.

## Validation gate — PASSED
- `bun run --cwd packages/extension test -- run src/components/composite/general/AccountAvatar src/utils/string src/wallet/services/contact` → 41 passed.
- `bun run typecheck:all` → all packages exit 0.
- `bun run lint` → exit 0 (baseline 51 warnings; my files clean after a biome auto-format collapsed the
  palette array).
- `! grep -rn 'name="vault"|icon="vault"' packages/extension/src` → remaining vault is ONLY
  `RecipientField.vue:89,131` + its test (the P3 Send targets). The two account sites are clean.
- `bun run build` → exit 0.

## Lessons
- **jsdom serializes `background: #RRGGBB` → `rgb(r, g, b)`.** Color assertions must compare in rgb form
  (added a `toRgb` helper + `PALETTE_RGB`), or test determinism (same input → same output) which is
  format-agnostic.
- **`wrapper.get(sel)` omits `.exists()` from its return type** (it throws if missing, so `exists` is
  meaningless) — use `wrapper.find(sel).exists()` for presence assertions.
- **`components.d.ts` legitimately gains the new auto-imported `AccountAvatar`** (KEEP it — unlike the
  spurious `auto-imports.d.ts` + `.eslintrc-auto-import.json` dev-drift, which were restored). The
  components.d.ts diff was exactly one line; `bun run build` (not build-storybook) keeps it complete.

LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-2.md
