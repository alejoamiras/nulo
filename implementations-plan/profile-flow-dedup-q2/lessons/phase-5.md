# Phase 5 — Onboarding-import e2e coverage (post-review follow-up)

User-requested after the review surfaced that onboarding *import* had zero e2e (only onboarding create-password did), despite Q2 refactoring both shells' import onto `useProfileImportFlow`. Instruction: "reuse as much code as possible from popup, don't dup."

## What changed
- New **`tests/e2e/helpers/import-drivers.ts`** — extracted the import drivers (`importPlainKey/Seed/EncryptedKey/FullBackup`, `gotoPopupImport`/`gotoOnboardingImport`, + `readActiveAccount`/`makeRandomMasterBase64`/`makeEncryptedKeyBlob`/`buildSyntheticBackup`/`writeBackupToTemp`) parameterized by an `ImportShell` config. Only three things differ per shell (`nameInputTestId`, `submitTestId(method)`, `successHash`) — the method picker + secret inputs are shared L3 composites, so their testids are identical. Two configs: `POPUP_IMPORT_SHELL`, `ONBOARDING_IMPORT_SHELL`.
- **`import-paths.test.ts`** — refactored to consume the shared drivers + `POPUP_IMPORT_SHELL` (dropped ~200 lines of inline helpers). Behavior identical.
- New **`onboarding-import.test.ts`** — 3 tests (plain key / seed / encrypted key) driving the onboarding shell → `/onboarding/learn`, via the same drivers + `ONBOARDING_IMPORT_SHELL`.

## Gate
| Check | Result |
|---|---|
| typecheck | 0 |
| lint | 0 (after formatter fix on the Promise.all line) |
| `vitest run --config vitest.e2e.config.ts onboarding-import.test.ts import-paths.test.ts` | **2 files / 11 tests passed** (3 onboarding + 8 popup; 64s) |

Confirms onboarding import works e2e via the shared composable, and the shared-driver refactor kept popup import green. Does not affect the pre-existing `settings-crud` FPC failure (separate, out-of-scope).

LESSONS_FILE=implementations-plan/profile-flow-dedup-q2/lessons/phase-5.md
