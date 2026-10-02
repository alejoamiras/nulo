# Phase 5a — Tab-order root fix + convention (#5)

**Status:** ✓ complete (code + gate green). Commit pending 1Password unlock.

## Root cause (corrected twice across the audit chain)
Not "DOM order" (draft 1) and not "remove the tabindex" (draft 2 — the nodes are `<div>`s). Two real causes:
1. **Positive `tabindex="1"` on non-focusable `<div>`s** (`Toggle.vue`, `DropdownItem.vue`) — a positive
   tabindex corrupts the WHOLE document into two-pass tab order; and on a `<div>` the tabindex is what
   makes it focusable, so it must be CHANGED to `"0"`, not removed.
2. **Secondary controls in the Tab path between logical fields** — the show/hide-password `<button>` in
   `NewProfileCredentials.vue` (between password + confirm), and the auth-method tab buttons (two separate
   stops between name + password) in `create.vue` + `NewProfileMethodTabs.vue`.

## What changed
- **`Toggle.vue`** (`@nulo/design`): `tabindex="1"` → `:tabindex="disabled||protected ? -1 : 0"`; added
  `@keydown.enter/space.prevent="toggle"` (it was a `<div @click>` — mouse-only) + `role="switch"` +
  `:aria-checked`. +5 Toggle tests.
- **`DropdownItem.vue` + `DropdownRoot.vue`** (`@nulo/extension`): item `tabindex="1"` → `tabindex="0"` +
  a stable `data-dropdown-item` hook; `DropdownRoot`'s ArrowUp/Down nav now queries `[data-dropdown-item]`
  (was `[tabindex="1"]`) so the nav is decoupled from the tabindex literal. Added null-`wrapper` + empty
  guards (a closed dropdown receiving an arrow key used to throw). Test pin updated (1→0 + data-attr) +
  an ArrowDown arrow-nav regression test.
- **`NewProfileCredentials.vue`**: the show/hide-password `<button>` → `tabindex="-1"` (out of the Tab
  path; still mouse/AT-clickable) → Tab flows password → confirm.
- **`NewProfileMethodTabs.vue` + `create.vue`**: the Password/Passkey segmented control → a **roving
  tablist** (`role="tablist"`/`role="tab"`, only the active tab `tabindex="0"`, ←/→ switch + move focus) →
  ONE Tab stop between name and password instead of two. +7 NewProfileMethodTabs tests.
- **`CLAUDE.md`**: new "Keyboard & focus order" convention (no positive tabindex; `<div>` widgets get
  keyboard activation; secondary in-field controls `tabindex="-1"`; grouped choices = roving tablist; nav
  never keys off a tabindex literal).

## Keyboard model decision (the codex/opus ask)
The auth-method tabs sit between name and password, so "Tab name→password→confirm with the tabs still
serial" is impossible. Chosen model (a11y-correct): **roving tablist** — the method stays keyboard-reachable
as ONE stop (name → method → password), ←/→ switch it; secondary buttons (show/hide, clear) leave the Tab
path entirely. The user's "name → password → confirm" expectation is satisfied modulo the single,
skippable method stop (a real choice, not drift). Confirmed at the human keyboard sign-off (P5b).

## Validation gate — PASSED
- `bun run --cwd packages/design test -- src/ui/Toggle` → 13 passed.
- `bun run --cwd packages/extension test -- run src/components/ui/Dropdown src/popup/components/modules/settings/new-profile` → 34 passed.
- `bun run typecheck:all` → exit 0. `bun run lint` → exit 0 (baseline 51 warnings).
- `bun run build` → exit 0 (no new auto-imported components → no components.d.ts churn from P5a).
- `bun run test:e2e` (registration + onboarding-tab + onboarding-import) → 11 passed.

## Lessons
- **A closed dropdown still had its `document` keydown listener attached**, so an ArrowDown dispatched
  anywhere threw on `dropdown.value.wrapper` (null when closed). Surfaced by the new arrow-nav test (4
  unhandled errors from leaked listeners of earlier mounts). Guard: `if (!dropdown.value?.wrapper) return`.
- **`mount(...).get(sel).exists()` type-errors** (`.get()` omits `exists`); use `.find(sel).exists()` or
  assert another attribute. (Recurring across phases — `.get()` already throws on absence.)
- **Vue `.space` key**: trigger with explicit `{ key: " " }` (the space char), not `keydown.space`.

LESSONS_FILE=implementations-plan/frontend-ux-fixes/lessons/phase-5a.md
