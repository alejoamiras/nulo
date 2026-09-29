# Phase 1 · Shared pieces

## Red runs, before each change (`bun --bun vitest run <file>` from `apps/extension`)

- `usePopupEntity.test.ts`, the two `refuseRepeatEnter` cases: 2 failed, 21 passed
  (`TypeError: refuseRepeatEnter is not a function`, the export did not exist).
- `DappApprovalFooter.test.ts`, "a repeat or composing Enter on the confirm approves nothing":
  1 failed, 11 passed. The repeat and the composing Enter each emitted `approve` (`[[], []]`), since
  the confirm had only `@click`.
- `new-profile-helpers.test.ts`, the composing, repeat and already-handled Enters from an input:
  3 failed, 11 passed, each `onSubmit` called once through `shouldHandleEnter`.
- `packages/design` `Input.test.ts`, "inputTestid names the native <input>": 1 failed, 18 passed
  (the root carried `root-id`, the native `<input>` no testid).

## Notes

- `pressOn` moved to `apps/extension/tests/helpers/press-key.ts`; both authwit suites import it and
  stay 31 of 31 before and after the switch to `refuseRepeatEnter`.
- The design `Button` declares only `onKeybind`, and the local wrapper forwards `$attrs`, so a
  `@keydown.enter` on `<Button>` lands on the native element in the dApp windows as in the authwit
  popups.
- The build regenerates `.eslintrc-auto-import.json` beside `auto-imports.d.ts`: one line there,
  two in the declarations.

## Gate

- The six named vitest files: 6 files, 77 tests passed, exit 0.
- `bun run --cwd packages/design test`: 41 files, 402 tests passed, exit 0.
- `bun run lint`: exit 0 (29 warnings, 3 infos, the same as on `85c4d20f`).
- `bun run typecheck:all`: exit 0.
- `bun run build`: exit 0; `git status --short apps/extension/src/types/` after the commit: empty.
