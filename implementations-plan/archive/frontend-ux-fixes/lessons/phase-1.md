# Phase 1 — Copy + border quick fixes (#1, #6)

**Status:** ✓ complete.

## What changed
- **#1** `packages/extension/src/popup/pages/settings/index.vue:55` — the Identity row title
  `:title="appStore.profile.name"` → static `title="Profile"`. The profile name still shows on the
  detail page the row links to (`/popup/settings/profile`); the user explicitly wanted the name off this
  list row.
- **#6** Removed `border-top: 1px solid var(--nulo-border)` from `.sender_row` in
  `EditContactPopup.vue` (:477) and `NewContactPopup.vue` (:300). The row's top border stacked under the
  address `Input`'s bottom border → a doubled line. Kept `margin-top: -12px` + `padding: 12px 0` (spacing
  tuning); only the border line was the complaint.

## Validation gate — PASSED
- `bun run typecheck:all` → all 12 packages exit 0.
- `bun run lint` → exit 0 (51 warnings / 3 infos are the repo's pre-existing baseline; none of the 3
  touched files flagged).
- `bun run build` → exit 0.
- Component tests: N/A — `settings/index.vue` (L6 page) + the two contact popups (L5) have no unit tests
  and don't require them per the testing philosophy (e2e + manual smoke cover them). `vitest run
  <filters>` reports "No test files found" (exit 1) only because the filter matched nothing — not a failure.

## Lessons
- **Type-file churn after `bun run build` is PRE-EXISTING dev drift, not phase-introduced.** The build
  regenerated `auto-imports.d.ts` + `.eslintrc-auto-import.json` to ADD `toRestoreError` (from dev commit
  `10ae086`) and DROP a dead `../composables/toast.d` ref (round-2/3 toast move). The committed copies on
  dev are stale; `git checkout --` restores them so the phase commit stays scoped. Confirmed `dev` is
  green WITH the stale committed files (typecheck passed before the build regenerated them).

LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-1.md
