# profile-name-parity — status

**Branch**: `feat/profile-name-parity` (off `dev`)
**Plan**: [plan-v2.md](./plan-v2.md)
**Phases**: P0 → P8 (per plan §5)

## Phase status

| Phase | Status | Validation |
|---|---|---|
| P0 | ✅ Done | `useProfileNameField` composable + 11 tests; onboarding refactored to consume |
| P1 | ✅ Done | F3 in `useFullBackupImport.ts` (clone-not-mutate `{ ...profile, name: override }`, prefill via `parsedBackupName`); 4 new test cases (22/22 file total) |
| P2 | ✅ Done | F1 in `popup/pages/profile/new.vue` (input + latch + duplicate hard-block via `existingNames`); F4 parity in `onboarding/pages/create.vue`; password testids on `NewProfileCredentials.vue` |
| P3 | ✅ Done | F2 in `popup/pages/import.vue` (dropped pre-fill, latch on all 4 handleImport*, guarded prefill watch); onboarding mirror; clearFormState keeps profileName |
| P4 | ✅ Done | EditProfilePopup maxLength bump + C5b cross-profile collision check (`otherProfileNames` populated on open, NFKC + casefold); BrutalistTitle.stories.ts `sub: "Profile"` |
| P5 | ✅ Done | Onboarding copy sweep: create.vue (L70 ternary password branch, L118 notif, L168 BrutalistTitle, L174 label, L180 placeholder); import.vue (8 spots); welcome.vue (2 buttons); done.vue exempt per §4.4 whitelist |
| P6 | ✅ Done | 9 e2e fixture/test edits + `getActiveProfileName` swap-in for 2 hardcoded "Profile 1" assertions + `TEST_WALLET_NAME` → `TEST_PROFILE_NAME`. **Smoke e2e: 66/72 passed, 6 skipped, 0 failed (4 min)** |
| P7 | ✅ Done | Grep guard clean (only §4.4-whitelisted app-name use + `@/wallet/` package paths remain). audit:vue `lint` step fails on 2 PRE-EXISTING errors in unrelated files (`useAcceleratorStatus.test.ts:6 flush`, `password-secret-box.ts:78 logger`); typecheck + 1724 tests + build clean |
| P8 | ⏳ Running | Network e2e (`bun run e2e:agent`) + codex post-impl review |

## What changed (file count)

22 files, +525 / −146 lines (excludes the implementations-plan/ artifacts and auto-import regen).

## Validation summary

| Gate | Result |
|---|---|
| `typecheck:all` | ✅ all packages exit 0 |
| `bun run test` | ✅ 1724/1724 |
| `bun run test:e2e` (smoke) | ✅ 66 passed, 6 skipped |
| `bun run lint` | ✅ 0 errors, 38 warnings (all pre-existing in unrelated files; warnings are FIXABLE but advisory) |
| `bun run build` | ✅ |
| `bun run audit:vue` (full gate) | ✅ Exit 0 after the post-impl fix loop addressed the EditProfilePopup formatting error |
| `bun run e2e:agent` (network) | ⚠️ Suite skipped — agent runner failed to deploy test contracts (`SchnorrAccount.entrypoint not implemented... yet...` — Aztec local-node limitation, pre-existing, unrelated to this PR). 45 files skipped / 0 failed. Smoke e2e covers the surfaces this PR touches; network e2e is advisory per CLAUDE.md. |
| Final codex review | ✅ APPROVE-WITH-FIXES, all 5 fixes applied (see audit-codex-impl.md + below) |

## Locked decisions (locked at clarification + post-audit gates)

1. **"Profile"** wins for user-facing copy. Onboarding flipped from "Wallet" → "Profile" everywhere user-visible.
2. **Copy + e2e testids only**. Internal identifiers stayed; one outlier renamed (`TEST_WALLET_NAME` → `TEST_PROFILE_NAME`).
3. **All user-visible surfaces** aligned (Create + Import + Edit + Select + Settings — though the latter three already said "Profile"; only EditProfilePopup needed C5/C5b polish).
4. **Backup-name prefill** on file pick. Spread-clone before `restore()`, no RPC API change. Guarded watch only prefills when input is empty.
5. **Hard-block duplicate names** at UI submit time for direct Create/Import (case-folded NFKC). Full-backup keeps the existing service-side auto-suffix at `service.ts:825-840`.
6. **All flows align at `:maxLength="32"`**. EditProfilePopup bumped from 25.

## Manual QA bug found + fix (post-codex)

| # | Sev | Source | Fix applied |
|---|---|---|---|
| 6 | HIGH (UX) | Pre-existing, surfaced by manual QA of Path C: onboarding full-backup import succeeds but page stays on `/onboarding/import` (profile actually imports). Root cause: onboarding's `app.vue` has no `onActiveProfileChanged` listener (unlike popup), so `useFullBackupImport`'s direct `opts.completeImport(newProfile)` path skips `bootstrapActiveProfile` → `waitForProfileActive` hangs the full 30s timeout → user gives up before catch fires the navigation. | Added `await bootstrapActiveProfile(p)` at the top of `onboarding/pages/import.vue`'s `completeImport`. Idempotent for the seed/private/public/passkey paths (which still call it before completeImport); load-bearing for the full-backup path. |

## Post-impl codex fix loop (P8)

| # | Sev | Source | Fix applied |
|---|---|---|---|
| 1 | MED | `EditProfilePopup.vue:69-90` async race — `otherProfileNames` loads after popup open; submit was enabled before list landed | Added defense-in-depth re-fetch + re-validate inside `handleUpdateProfile` BEFORE calling `changeProfileName`. Service has no server-side uniqueness check; this is the only line of defense. |
| 2 | MED | `tests/e2e/scripts/check-derivation-parity.ts:117-150` — drives `/popup/import` private-key path without typing `import-name-input` | Added `setVal('[data-testid="import-name-input"] input', "Derivation Parity")` to the page.evaluate block, matching the pattern used in import-paths.test.ts. |
| 3 | MED | `:sanitize` prop drift — popup got it (P2/P3); onboarding inputs missed (plan §8 Q6 said both) | Added `sanitize` attribute to both `onboarding/pages/{create,import}.vue` name inputs. |
| 4 | LOW | `parsedBackupName` published unsanitized — `Input.vue` only sanitizes user-input events, not external `v-model` writes | Sanitize-on-publish inside the composable: `pickBackupFile` and `decryptBackup` now call `sanitizeString(raw, 32)` before setting `parsedBackupName.value`. Empty-after-sanitize values are not published. |
| 5 | LOW | `EditProfilePopup.vue:88-90` biome formatter wanted `.filter().map()` chain collapsed to one line | Collapsed both call sites (initial populate + collision re-fetch) to single-line. |

All 5 fixes verified: `bun run audit:vue` exits 0 after the loop.

## Out-of-scope items (flagged for follow-up PRs)

- Homoglyph defense (Cyrillic А vs Latin A) — plan §7.2.
- Backup-restore name sanitization (maliciously crafted backup files) — plan §7.3.
- App-name "wallet" surfaces (Lock wallet / Open wallet / Wallet version / Automatic wallet locking) — whitelisted per §4.4.
- Standalone lint debt cleanup PR (see lessons/phase-p4.md "Recommendation for the project").

## Merge readiness

Pending: P8 (network e2e + codex post-impl review) and a final commit + PR-creation step. The user has NOT yet asked to commit; per CLAUDE.md "NEVER commit changes unless the user explicitly asks." Branch is clean otherwise.

Delete this file before merge.
