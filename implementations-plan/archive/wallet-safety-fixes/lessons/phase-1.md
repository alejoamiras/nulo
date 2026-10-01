# Phase 1 · No Enter confirms a transaction popup from another control (A1)

## Red, on the unfixed code

Run at `b172f0ca`, whose `usePopupEntity`, authwit popups and `DropdownRoot` are byte-identical to
`624117cd`. From `apps/extension`:
`bun --bun vitest run src/composables/usePopupEntity.test.ts src/popup/components/popups/RevokeAuthwitsPopup.test.ts src/popup/components/popups/ChangeAuthwitsRegistryPopup.test.ts src/components/ui/Dropdown/Dropdown.test.ts`
→ exit 1, 21 failed, 66 passed. Exactly the new cases are red, each for the reason the plan names:

- Both popups, 8 cases each: Enter on × (`onClose` emitted twice: the sent transaction's own close,
  then the ×), on the fee card's control, on an element outside the popup standing for a teleported
  menu item, with nothing focused, in the field of a form popup layered over it, repeat-only on the
  idle confirm, composing (`isComposing: true`) and IME boundary (`keyCode: 229`,
  `isComposing: false`) on the idle confirm. Each sent once (`revokeAuthwits` /
  `setRegistryEnabled` called 1 time).
- `usePopupEntity`: a repeat, a composing Enter and an IME boundary Enter in an input each submitted
  once; without `submit`, a `keydown` listener was still added.
- `DropdownRoot`: Enter with focus on a button outside the open menu clicked it.

Every pin was green before the fix: Enter and Space on the focused confirm send once, a held Enter
sends once, a press before the fee is set or while in flight sends nothing, Revoke's error keeps the
button disabled, a click sends once, and the content button opens the content without revoking.

## Attempts

- First red run: the nested-popup case mounted a second VTU wrapper, and the popup under test then
  re-rendered with real components (`FeeSettingsCard` asking for Pinia, `Button` without a render
  function). VTU installs its stub transform through Vue's process-global `transformVNodeArgs` and
  replaces it on every `mount` (`vue-test-utils.cjs.js:8199`), so a second mount drops the first
  wrapper's stubs; the failed unmounts then leaked document listeners into later tests. Fixed by
  showing the nested form popup in a plain `createApp` of its own.
- `DropdownRoot` opens its trap with `initialFocus: false`, so right after the menu opens focus stays
  wherever it was, outside the menu, until an arrow key or Tab moves it in; the backstop is not the
  only way focus sits outside. The in-menu check covers both.

## Green, and the gate

- The fix as § A1: `submit` optional with no listener without it, `submitKey` gone,
  `isRepeatOrComposing` shared by `isPopupSubmitKey` and both confirm buttons' `@keydown.enter`
  guard, `DropdownRoot`'s Enter clicking only inside the open menu, the CLAUDE.md bullet through the
  `update-docs` skill (no conflict with `dev`). `bun run build` regenerated
  `src/types/auto-imports.d.ts` and `src/types/.eslintrc-auto-import.json` with the one new export.
- `bun --bun vitest run src/composables/usePopupEntity.test.ts src/popup/components/popups/ src/components/ui/Dropdown/`
  from `apps/extension`: exit 0, 24 files, 239 passed, the step-1 and step-5 cases among them.
- `bun run lint`: exit 0 (29 warnings and 3 infos, all present before this branch; the changed files
  check clean). `bun run typecheck:all`: exit 0. `bun run test:all`: exit 0; the extension ran 7807
  passed, 4 skipped, 8 todo, every other workspace passed.
