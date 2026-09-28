# Phase 2 · First run (item 5, U11)

Picks re-read before the phase: 22 rows in the artifact's `picks` collection, all version 1, no
row for U11–U16 yet. U11 is built as recommended and stays **sign-off pending**.

## What shipped

- `src/utils/profile-name.ts`: `FIRST_PROFILE_NAME`, `normalizeProfileName` (moved out of
  `useProfileNameField`'s duplicate check), `defaultProfileName`. Its test pins "Main", "Profile N",
  the bump past a case/NFKC variant (scripts do not fold), and that a default passes validation
  up to 999 existing names.
- `useProfileNameDefault` (C1, 13 tests): `nameFieldState`, one tracked `lastAuto` for both
  automatic writers, `offer(backupName)`, `resolveName(backupName?)` from a fresh read, with the
  setup read fenced once submit starts.
- Both flows use it. The create flow's read moved inside its `try`: a rejected read releases the
  latch and notifies, and a retry creates.
- Full backup: `resolveProfileName` is a required option; `sanitizedBackupName` trims and returns
  null when nothing is left; every pick and decrypt recomputes the candidate; the restore asks the
  resolver once, before `resolvePasskeyCredential`, and a null answer stops quietly.
- Pages: the four roots carry their testid and `data-name-field`; onboarding create reads
  "Create" / "Wallet", "How you'll unlock Nulo", "Create wallet" / "Create with passkey", with focus
  on the password; onboarding import reads "Import" / "Wallet".
- Component tests: onboarding create (3), onboarding import (2), popup new (2).
- e2e: `waitForNameField`, `expectNoNameField`, `expectNameFieldPrefill` in `fixtures/extension.ts`;
  `readProfileNames` in `fixtures/helpers.ts`; `importSeed(…, { profileName? })`; every first-profile
  path asserts the field absent, every later one its `Profile N` prefill. New smoke coverage: the
  onboarding tab creates "Main" (`onboarding-tab.test.ts`), and the next profile opens prefilled
  "Profile 2" (`auth-flows.test.ts`).

## Decisions

1. **A failed setup read.** The field shows empty (never a guessed name, per the plan). Submitting
   an untouched empty field resolves a default from the fresh read, so the failure costs the user
   nothing. A cleared field that was prefilled is the user's choice and blocks as today.
2. **The typed name in the full-backup path is now validated** like the seed and passkey paths.
   Before, that path skipped validation and restored whatever was typed. This is the plan's "full
   backups resolve the same way".
3. **A backup's own name keeps the service's exact-string suffix** in `restore`, as the plan says;
   only automatic defaults are unique under `normalizeProfileName`.
4. **`tests/e2e/scripts/check-derivation-parity.ts` is left as is.** It is a manual tool nothing
   runs (no script, no workflow; `browser-seam.test.ts` exempts it), and it was already broken
   before this batch: it clicks `import-option-private-key`, which `ImportMethodPicker.test.ts` pins
   absent. Classified per call site, as the plan asks; repairing it is out of scope.
5. **`feeJuiceImportedExtension` loads `helpers/import-drivers` at call time**: import-drivers
   imports `fixtures/extension`, so a static import would be a cycle.

## Traps

- Vitest does not run the design resolver: page tests register the real `@nulo/design`
  components through `global.components` (`BrutalistTitle`, `Flex`, `Input`, `Text`).
- A globally registered `Button` recurses: its `<component :is="'button'">` resolves to itself.
  Stub it.
- The app store reads `chrome.storage.onChanged` at setup: `vi.stubGlobal("chrome", …)` in
  `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`.
- A plain backup's pick clears both password fields: set them after the pick, or the restore never
  starts.
- `vi.fn(async (x: string | null) => x ?? "Main")` infers `Promise<string>`, so
  `mockResolvedValueOnce(null)` fails `typecheck:all` while vitest passes. Annotate the mock's
  return type with the option's (`Promise<string | null>`).
- The build regenerates `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` for new
  `src/utils` and `src/composables` exports (`nextAccountName` from P1, the P2 helpers). They are
  tracked, so they go in with the code that caused them.

## Gate

- `bun run lint` → exit 0 (30 warnings, 5 infos, none in changed files).
- `bun run typecheck:all` → exit 2 on the first run (the mock's inferred return type above), exit 0
  after the fix. The two affected test files re-ran green (106 tests).
- `bun run test:all` → exit 0 (extension 7,100 passed, 4 skipped, 7 todo).
- `bun run build` → exit 0.
- Smoke build (Chrome, the e2e env vars) → exit 0; full Chrome smoke
  (`NULO_E2E_BROWSER=chrome NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`) → exit 0, 139 passed,
  8 skipped (147), 912 s, no test retried: the same counts as the program's P0 baseline.
