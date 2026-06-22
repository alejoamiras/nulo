# Phase 5b — Long-tail tab-order sweep + human sign-off (#5)

**Status:** machine gate green; **awaiting the human keyboard + visual sign-off** (and 1Password unlock to commit). Code complete.

## Sweep method
With P5a's root causes fixed (no positive `tabindex`, the create/profile-new flow, the convention in
CLAUDE.md), the long-tail is "apply the convention everywhere the same patterns appear." Two greps drove it:
1. `grep 'tabindex="[1-9]'` across `packages/{extension,design}/src` → **NONE remain** (the whole
   document-corruption class is eliminated).
2. `grep 'visibility_btn'` (the show/hide-password button class) → every password form. Each such `<button>`
   sits in a field's `#suffix`, i.e. BETWEEN the password and the next field/button — so each gets
   `tabindex="-1"` (mouse/AT-clickable, out of the Tab path).

## Screens swept + fixed (show/hide-password buttons → tabindex="-1")
| Screen | File | buttons |
|---|---|---|
| Unlock / login | `popup/pages/auth.vue` | 1 |
| Create profile (popup) | `…/new-profile/NewProfileCredentials.vue` | 1 (P5a) |
| Change password | `popup/pages/settings/security/change-password.vue` | 2 |
| Import full backup | `components/composite/import/ImportFullBackupForm.vue` | 2 |
| Import secret | `components/composite/import/ImportSecretForm.vue` | 5 |

Plus the P5a primitives (`Toggle`, `DropdownItem`/`DropdownRoot`) and the roving method tablist
(`create.vue`, `NewProfileMethodTabs.vue`) already covered the segmented-control + shared-widget cases.

## Screens reviewed, no change needed
- The other `visibility`/`eye` grep hits (`RecentActivityView`, `FeeMethodRow`, `CapabilityCard`,
  `OperationCard`, `activity.vue`) use the word for non-password icons, not in-field tab-path buttons.
- Plain forms (contacts, send amount, token/network/fpc/endpoint edit popups) have no positive tabindex
  and no in-field secondary buttons between fields → already flow field → field by DOM order.

## Machine gate
- `bun run lint` → exit 0 · `bun run typecheck:all` → exit 0 · `bun run build` → exit 0.
- `bun run audit:vue` (full typecheck → unit/component suite → lint → build) → green end-to-end.
- `bun run test:e2e` (full smoke suite, 20 files / 76 tests) → **69 passed · 6 skipped · 1 failed**.
  The single failure is `passkey-backup.test.ts:201` (a `waitForFunction` timeout on the async
  `[data-testid="backup-status-card"]` "Creating your backup" poll). **Confirmed PRE-EXISTING, not a
  regression:** `git stash -u` → rebuild clean dev → re-run reproduced the IDENTICAL failure (1 failed /
  2 passed) with NONE of this PR's changes present. The flow it exercises (`export/full.vue`) is untouched
  by this PR (the P5b sweep only added `tabindex="-1"` to `visibility_btn` buttons; that file has none).
  Smoke is advisory (per CLAUDE.md), and this failure is independent of the PR. The 18 other smoke files
  (incl. contacts, accounts, settings-crud, registration, onboarding, auth-flows, security) all pass.

## Human sign-off (REQUIRED — not yet recorded)
The plan's gate forbids marking P5b ✓ without the human keyboard + visual sign-off. Checklist handed to
the user (keyboard Tab-through of: onboarding create, unlock, change-password, import, send, contacts,
settings + the edit popups; visual check of the initials avatars + the Send recipient card). To be recorded
here on sign-off.

LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-5b.md
