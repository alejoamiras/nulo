# Phase 2 — Extract useProfileImportFlow (+ Quirk 1 + A1)

## What changed
- New `src/composables/useProfileImportFlow.ts` (C1): composes `useProfileNameField` + `usePasskeyCeremony` + `useFullBackupImport`; owns the import refs, `error`/`fillError`/`clearError`, `isCopied`/`handleCopyError`, password/secret input handlers, the `isAllowedTo*` gates, the four `handleImport*` handlers, the `parsedBackupName` prefill watch, `clearFormState`/`handleBack`, `dispose()`. Flat returns. Uses `managers.profile` global + `pickFile` from `@/utils`.
- Injected per shell: `completeImport`, `showErrorLog`, `notifyImportFailed`, `openToast`. The SAME `completeImport` ref is threaded into `useFullBackupImport` (no double-injection).
- **Quirk 1 (dissolved by construction):** the shared handlers call the injected `completeImport` once; they never `bootstrapActiveProfile`. The onboarding page's old per-handler bootstrap calls (`:145/164/187/215`) have no counterpart in the shared composable → onboarding now bootstraps exactly once, inside its injected `completeImport`. Pinned by the call-count==1 test.
- **A1 (user-ratified inline fix):** unified catch-all `fillError("unknown", "Import failed", message)` for both shells (popup previously passed the Error object as title → `[object Object]`). Popup passkey-failure notification title `"Profile Import Failed"` → sentence-case `"Profile import failed"` (matches onboarding + toast house style). Removed the per-shell `onUnknownImportError` hook entirely — net simplification.
- New `useProfileImportFlow.test.ts` — 14 cases incl. latch-once, name-validation (empty + duplicate), typed-error routing, passkey cancel-silent / generic-notify, **Quirk-1 completeImport-once pin**, **A1 unified-shape pin**, dispose/no-onUnmounted.
- Migrated `popup/pages/import.vue` (JS) + `onboarding/pages/import.vue` (TS) to consume the composable. Popup keeps: listener-based `completeImport` (no bootstrap), full-backup `onKeydown`, scroll/hero, `redirectToOnboardingTabIfNeeded`. Onboarding keeps: bootstrap `completeImport`, secret-zeroing on unmount, no keydown. All `data-testid` preserved verbatim.

## Gate result
| Check | Exit | Result |
|---|---|---|
| typecheck | 0 | clean |
| lint | 0 | 42 warnings (baseline; no new) |
| `bunx vitest run` | 0 | **197 files / 2412 tests** (= baseline 2398 + 14 new; zero regression) |
| `useProfileImportFlow.test.ts` | 0 | 14/14 |
| A1 casing pre-check | — | no test/e2e pins old Title-Case import strings (only the not-yet-migrated create page hits "Profile Creation Failed" → Phase 3) |

## Notes
- Biome reformatted one long `isAllowedToContinue` line (wrapped the `return false`). Removed an ineffective `biome-ignore noNonNullAssertion` — `let flow!: T` is a definite-assignment assertion, which that rule doesn't flag.
- Composable tested inside an `effectScope` so its internal `watch(parsedBackupName)` is owned/disposed between tests.

LESSONS_FILE=implementations-plan/profile-flow-dedup-q2/lessons/phase-2.md
