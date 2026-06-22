# Frontend UX fixes — batch 1 — wrap-up

`/blueprint mid` → 6 reported UX fixes. Branch `feat/frontend-ux-batch-1` off `dev`.

## Outcome (all code complete + validated)
| Phase | Fix | Status |
|---|---|---|
| P1 | Settings "Identity" row → static "Profile"; drop the doubled `.sender_row` border | ✓ committed `00919c5` |
| P2 | Retire `vault` → reusable initials `AccountAvatar` (address-hashed disc color) | ✓ green |
| P3 | Send recipient **card** (avatar + name + `8***8` masked + optional reveal/copy) | ✓ green |
| P4 | `AddressInput` wrapper: long `0x…` reads from the start at rest (no value mutation) | ✓ green |
| P5a | Tab-order ROOT fix (no positive tabindex; `<div>` keyboard ops; roving method tablist; convention) | ✓ green |
| P5b | Long-tail sweep (show/hide buttons → `tabindex="-1"` across auth/change-pw/import) | code done; **awaiting human sign-off** |

## New components / shared code
- `components/composite/general/AccountAvatar.vue` (13 tests) — initials + djb2 address-hashed disc color; DECORATION only.
- `components/composite/send/RecipientCard.vue` (13 tests) — masked recipient + optional full-address reveal + copy.
- `components/composite/general/AddressInput.vue` (10 tests) — transparent `<Input>` wrapper, blur→`scrollLeft=0`.
- `utils/string.ts` `getInitials` (8 tests) — extracted + shared with the contact service (DRY).
- P5a: `@nulo/design` `Toggle` (keyboard + role), extension `Dropdown{Item,Root}` (data-attr nav), `NewProfileMethodTabs` roving tablist (7 tests). `CLAUDE.md` "Keyboard & focus order" convention.

## Validation
- `bun run audit:vue` (typecheck:all → full unit/component suite → lint → build) — **green end-to-end**.
- New tests: 51 across the new components + Toggle/Dropdown/tablist additions; all existing tests still pass.
- `bun run test:e2e` (full smoke, 20 files / 76 tests) — **69 passed, 6 skipped, 1 failed**. The lone
  failure (`passkey-backup`) is **pre-existing on clean dev** (proven via stash→rebuild→reproduce) and
  exercises `export/full.vue`, untouched here. Smoke is advisory.
- `grep 'tabindex="[1-9]'` → none remain anywhere; `grep 'icon="vault"|name="vault"'` → none in source.

## Audits + review
- **Pre-impl dual audit** (`audit-codex.md` + `audit-opus.md`): both `reject` → every blocking finding folded.
- **Final fresh-context codex pass**: `reject` (caught a div-tabindex regression the first revision introduced) → folded.
- **Post-impl codex `xhigh`** (`audit-postimpl.md`): completed after a mid-run network stall → **no high/critical**.
  2 MED + 3 LOW. MED disabled-dropdown + LOW clipboard-error FIXED (`733c152`, with tests); MED eye-a11y is
  an owner-accepted tradeoff (user chose field→field); avatar-color LOW acknowledged. A post-fix codex
  re-audit on the final state confirms the fixes.
- **`/code-review max --fix`**: reviewed the full branch diff (44 files) through a quality lens — converged
  with codex on the same findings (already fixed in `733c152`); no additional fixes. Code adheres to the
  CLAUDE.md conventions (no milestone tags / debug / WHAT-comments / dead code; lint + 2548 tests enforce).

## Key decision (user, informed)
P3 Send recipient = masked **+ OPTIONAL reveal** (not forced). The full fork (full-always / mandatory-reveal
/ optional) was surfaced after the audits showed `send.vue` has no later confirm surface; the user chose
optional and owns the residual address-poisoning risk. The implementation makes the reveal prominent + one
tap, and binds the exact `searchTerm` that submits — display and submitted address never diverge.

## Pending (both need the user)
1. **1Password unlock** — every commit since P1 fails to sign; P2–P5b (36 files) + the audit/wrap-up docs
   wait. Not bypassed (not AFK). On unlock: commit the phases + push.
2. **P5b keyboard + visual sign-off** — checklist delivered; `dist/chrome` freshly rebuilt with all changes.
   On sign-off: mark P5b ✓, then PR (`feat: frontend UX fixes batch 1` → `dev`).
