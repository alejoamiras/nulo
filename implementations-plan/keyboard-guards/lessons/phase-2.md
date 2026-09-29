# Phase 2 · The five pages

## Red runs, before each page's guard (`bun --bun vitest run <file>` from `apps/extension`)

- `onboarding/pages/create.test.ts`: 3 failed, 3 passed. Enter on Back and Enter on the active
  Password tab each called `createProfile` once (the document handler, with a valid pair); the
  repeat Enter in the confirm field went through uncancelled (`dispatchEvent` returned `true`).
- `popup/pages/import.test.ts` (new): 4 failed, 1 passed (the preservation case). Enter on Back
  called `restoreBackup` once; Enter on View Errors continued the import once
  (`setLastActiveProfileId`, the first call `completeImport` makes); a repeat Enter on Continue
  continued it twice (the document handler, then the native click); in the error viewer, the search
  Enter and the "match case" Enter each continued it (2 calls), while CodeMirror's `findNext` had
  already moved the selection onto "mismatch".
- `settings/security/change-password.test.ts` (new): 3 failed, 1 passed (the preservation case).
  Enter on the back arrow sent one `changeProfilePassword`; Enter on Change Password sent two (the
  document handler, then `pressOn`'s click before Vue re-rendered the button disabled; a browser may
  flush that render first, Inference 6); a repeat Enter on it sent two.
- `settings/security/export/seed.test.ts` (new): 3 failed, 1 passed (the preservation case). Enter
  on the back arrow retrieved the phrase once; Enter on Retrieve retrieved it twice; a repeat Enter
  on Retrieve twice. `seed.vue` first gained an explicit `useSecretClipboardCopy` import: the unit
  vitest does not auto-import composables, and the build's auto-import skips a name already
  imported, so the bundle is unchanged.
- `settings/security/export/full.test.ts`: 4 failed, 7 passed. Before export, Enter on the back arrow
  ran `exportBackupMaterial` once; at the backup-ready stage, Enter on Download Backup downloaded
  nothing (the document handler started encryption, whose `isBusy` then refused the click's
  download); a repeat Enter on it started encryption (`getPasshash` once); an Enter at
  `document.body` started encryption. The two rewritten latch cases passed before the guard, as latch
  evidence should.

## Notes

- CodeMirror runs in jsdom and its search panel handled the Enter (the selection moved onto the
  match), but its measure pass calls `Range.getClientRects`, which jsdom lacks, and threw from a
  `requestAnimationFrame` callback as an unhandled error. `import.test.ts` gives ranges empty rects
  while the viewer is shown and destroys the editor before restoring them, which cancels the pending
  measure. The editor, its search field and its key handler stay the real ones.
- The page tests pin `window.history.length` at jsdom's fresh 1 as a precondition, so each Back
  case asserts the branch it takes: `SubPageHeader` pushes the page's `backTo`.
- With the guard, full export's `encrypted` case has no field to answer from (no input renders at
  that stage), and its `finished` case answers only a passkey profile's encryption fields. The
  switch stays whole, as the plan says, for the K1 (b) listener to reuse if the owner picks it.
- The other refusals (Import's Decrypt and Import, full export's Create Backup and Protect) share the
  binding the per-page repeat cases prove, and their handlers latch before the first await.
- Import's Back button carries no `data-testid`, so `import.test.ts` finds it by its text. That is a
  unit test; no e2e selects it, and adding a testid was left out of a keyboard change.

## Gate

- The six named vitest files: 6 files, 35 tests passed, exit 0.
- `bun run lint`: exit 0 (29 warnings, 3 infos, as on `85c4d20f`) after `biome format` wrapped
  three long lines in the new tests.
- `bun run typecheck:all`: exit 0.
- `bun run test:all`: exit 0; `@nulo/extension` 608 files passed and 3 skipped, 8043 tests passed,
  4 skipped, 8 todo; every other workspace passed.
- `bun run test:ci-gating`: exit 0, 244 passed, 2 skipped, 0 failed.
- `bun run build`: exit 0; `git status --short apps/extension/src/types/`: empty.
