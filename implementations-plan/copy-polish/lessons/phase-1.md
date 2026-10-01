# Phase 1 · The 46 strings, and the guard (E)

## The guard, red on the base

- `apps/extension/src/utils/copy-dash-ban.test.ts` as § E · The guard: TypeScript's parser for
  scripts, `@vue/compiler-sfc` for templates (text, static attributes, interpolations and bound
  expressions, each expression parsed again as TypeScript), hits on `/\S\s*—\s*\S/`, the log
  exemption by callee spelling, 40 reviewed `{ file, text, why }` entries matched by exact text and
  consumed one per hit, a stale-entry case, and 12 scanner cases in one `test.each`.
- `compiler-sfc` does not re-export compiler-core's `NodeTypes` or its AST types, and the app does
  not declare `@vue/compiler-core`, so the template walk reads a small structural type that
  `RootNode` satisfies, with `TEXT = 2` and `INTERPOLATION = 5` named once. A text node's line is
  its first word's, not the whitespace it opens with.
- A first run with an empty reviewed list listed 86 hits: the table's 46 plus the 40 leaves of
  § Leave that the pattern matches, each at the file and line the plan cites. `materialize.ts:105`
  (split across a concatenation), the four label joiners and the 24 glyphs do not match.
- A scratch probe mirroring the scanner counted what the position exemption skipped: **38**
  dash-bearing log-argument literals, every one matching the clause pattern: 37 in the three
  original roots (6 `console.*`, 31 named log calls) and exactly one `log.warn`, at
  `packages/aztec-runtime/src/pxe/opfs-store.ts:221`. 684 files read.
- **Red run** with the 40 entries, from `apps/extension`:
  `bun --bun vitest run src/utils/copy-dash-ban.test.ts` → exit 1; 1 failed, 13 passed (the
  stale-entry case and the 12 scanner cases). The failure lists exactly 46 strings, the table's E1
  to E46 and no other hit. Four sit a line or two above the table's cite because the scanner
  reports a text node's first word: E29 `AccountIntegrityBarrier.vue:74` (table `:76-77`), E37
  `full.vue:543` (`:544`), E39 `RevokeAuthwitsPopup.vue:155` (`:156`), E40 `:162` (`:164`).
- `dev` had not moved past the stack (the merge at P0 carried no change), so no hit needed
  classifying.

## The strings, one commit per group

- Each group's edits go through a scratch script that replaces exact text and refuses any edit
  whose match count differs from the expected one.
- **A pin the plan missed**: the snacks' first run failed
  `popup/components/popups/NewTokenPopup.test.ts:382`, which matches `/balance will appear/`
  case-sensitively (E10), the same class as E22's `journal-state.test.ts:627`. It became
  `/Balance will appear/`, and the plan's E10 row and change map now list it. A sweep then searched
  every test, e2e and playground file for the words after each of the 46 dashes, which the split
  capitalises: every other match is in the Pin column or a generic fixture the plan keeps, and the
  e2e helpers match only prefixes or comments.
- **Snacks, E1 to E13**: 13 strings plus the pins `errors.test.ts:89`, `pxe/client.test.ts:57`,
  `NewNetworkPopup.pins.test.ts:122` and `NewTokenPopup.test.ts:382`. From `apps/extension`:
  `bun --bun vitest run src/wallet/services/pxe/client.test.ts src/popup/components/popups/NewNetworkPopup.pins.test.ts src/popup/components/popups/NewTokenPopup.test.ts ../../packages/extension-messaging/src/errors.test.ts`
  → exit 0, 4 files, 49 passed. The guard lists 33.
- **Lines, E14 to E21, E25 to E28, E44 to E46**: 15 strings plus the pins and input copies of the
  table (`FeeSettingsCard.test.ts:1639`, `transfer-failure-copy.test.ts:35`,
  `scope-mismatch.test.ts` ×3, `scope-follow.test.ts:251`, `useFullBackupImport.test.ts:1020` and
  `:1032`, `full-backup-helpers.test.ts` ×3, `account-state/service.test.ts:343-344`,
  `restore-surface.pins.test.ts:130`, `onboarding/pages/import.test.ts:150` and `:186`). From
  `apps/extension`, those files plus the skip constants' consumers (`importChainSync.test.ts`,
  `normalize.test.ts`) and E20's prefix (`service.integration.test.ts`) → exit 0, 12 files, 506
  passed; from `packages/aztec-runtime`,
  `bun --bun vitest run src/pxe/opfs-store.test.ts src/pxe/opfs-store-open.test.ts` → exit 0, 2
  files, 17 passed. The guard lists 18.
- **Journal, E22 to E24**: 3 strings plus `journal-state.test.ts:146`, E24's title and two
  subtitles (`:149`, `:153`, `:453`), and E22's case-sensitive `toContain` at `:627`. From
  `apps/extension`, `bun --bun vitest run src/utils/journal-state.test.ts` → exit 0, 91 passed.
  The guard lists 15.
- **Screens, E29 to E43**: E29's exact pin went into `AccountIntegrityBarrier.test.ts`'s
  presented-profile case first, beside its existing assertions, and ran red on the old copy
  (exit 1, 1 failed, 9 passed; expected and received differ only at the dash). Then 15 strings
  plus `ImportContactsPopup.test.ts:121`. From `apps/extension`, every colocated test of the
  changed screens (the two barriers, the passkey dialog, Import contacts, Revoke authwits, auth,
  profile new, the full export and its passkey pins, three OperationCard files), the generic
  `BarrierOverlay.test.ts` and the guard → exit 0, 14 files, 122 passed. **The guard is green**: no
  open hit, no stale entry.
- **CLAUDE.md** gains one bullet in § UI changes need explicit owner sign-off: no em dash joins two
  clauses in user-facing copy, a full stop does, the empty-value "—" stays, and the guard fails on
  the forms it reads while its header lists the ones it cannot.

## Gate

- From `apps/extension`: the guard and every pin file of the table in one run (20 files: the
  guard, `errors.test.ts`, `pxe/client.test.ts`, `NewNetworkPopup.pins.test.ts`,
  `NewTokenPopup.test.ts`, `FeeSettingsCard.test.ts`, `transfer-failure-copy.test.ts`,
  `scope-mismatch.test.ts`, `scope-follow.test.ts`, `service.integration.test.ts`,
  `useFullBackupImport.test.ts`, `full-backup-helpers.test.ts`, `account-state/service.test.ts`,
  `restore-surface.pins.test.ts`, `onboarding/pages/import.test.ts`, `journal-state.test.ts`,
  `AccountIntegrityBarrier.test.ts`, `MigrationBarrier.test.ts`, `ImportContactsPopup.test.ts`,
  `OperationCard.createAuthwit.test.ts`) → exit 0, 660 passed.
- From the root: `bun run lint` → exit 0 (28 warnings, 3 infos, the base's; complexity-baseline
  OK); `bun run typecheck:all` → exit 0; `bun run test:all` → exit 0 (extension 625 files passed,
  3 skipped; 8458 tests passed, 4 skipped, 8 todo; every other workspace green, aztec-runtime 257
  passed and 2 skipped); `bun run test:ci-gating` → exit 0 (244 pass, 2 skip, 0 fail). The known
  `useFullBackupImport.test.ts` Retry flake did not occur. ✓
