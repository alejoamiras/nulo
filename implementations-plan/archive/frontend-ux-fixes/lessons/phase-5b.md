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

## Post-impl codex finding on the swept buttons (resolved)
Codex's post-impl audit flagged that `tabindex="-1"` on the show/hide-password buttons is a WCAG-2.1.1
keyboard-access gap. Surfaced to the user with 3 options (reposition after the field group / keep-as-is /
restore standard tabbing). **User chose KEEP-AS-IS** — field→field flow is the priority; the eye stays
`tabindex="-1"` (mouse + screen-reader reachable). Recorded as a deliberate owner-accepted tradeoff in
`audit-postimpl.md` + the CLAUDE.md convention. No code change.

## Human sign-off — RECEIVED (2026-06-22)
The user did the keyboard + visual pass against a versioned local build (`0.25.0-rc.1` → `…-rc.9`, bumps
local-only/uncommitted since release-please owns the version) and **signed off**: *"Lovely, this work is
ready to be merged."* All six fixes confirmed; #1/#5/#6 approved as-is; #2/#3/#4 approved after the
refinement rounds below.

### Visual-refinement rounds during sign-off (recorded for history)
The card/avatar/spacing got several user-directed passes after the functional fixes landed — all on the
Send surface (in scope of #3/#4, plus a bonus Send-layout polish the user explicitly directed):
- **Avatar** → flat **grey square** (no per-account color, no rounded corners) to match the brutalist
  design system (`AccountAvatar.vue`); recipient avatar sized **36** to match the token rectangle.
- **Masked address** → single baseline ellipsis `0x123456…12345678` (the spaced `***` rendered misaligned).
- **AddressInput (#2)** → reworked twice: scroll-reset-on-blur wasn't enough; final = **pin to start while
  not focused** (native scroll/focus/blur listeners snap `scrollLeft` to 0), so a blurred address can't be
  drag-scrolled. Pure read affordance; value never mutated.
- **RecipientCard** → removed the "Copy full address" button (revealed address stays selectable); applied
  card **style D** (field-style bottom underline, no box) from `card-style-options.html`.
- **EditAccountPopup** → removed the redundant "Selected account for editing" header card.
- **Send layout** → de-stacked paddings (section `20→14`, token-card wrapper `12→4`), shrank the token
  picker (avatar `40→36`, fonts `18→16`); top-section bottom padding removed; recipient card padding `14px`.
- **Recipient validity** → replaced the cryptic ✓/! suffix icon with the app-standard worded **"Invalid
  address"** hint (red warning + text in the label row, as in the contact/FPC popups); the Send button's
  `isValidHex` gate (`send.vue:190`) remains the hard block.

## Validation gate — PASSED (machine) + human sign-off RECEIVED
- `bun run audit:vue` green; full smoke 69/76 (the 1 fail pre-existing — see above).
- Keyboard + visual sign-off received from the user (2026-06-22).

LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-5b.md

LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-5b.md
