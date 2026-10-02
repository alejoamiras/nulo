# b03-backup-restore-migration — codex

Scope read:

- `CLAUDE.md`, `ARCHITECTURE.md`, `implementations-plan/lessons.md`.
- Requested repo maps, quality-run leads, both prior bug reports, and the August 24 adjudication; relevant sections of the popup, shared-UI, and packages-low maps.
- `apps/extension/src/wallet/services/backup/{README.md,backup-migration-registry.ts,backup-migrator.ts,row-map-migration.ts}`.
- `apps/extension/src/wallet/services/{purge-rows,restore-rows,restore-fence,require-owned-row,id-allocators}.ts`.
- `apps/extension/src/wallet/storage/{index.ts,migrations/index.ts}`.
- `packages/wallet-core/src/migration/{types,staging,migrator}.ts`.
- `apps/extension/src/composables/{useFullBackupImport,full-backup-restore,useProfileImportFlow,useProfileBootstrap,useProfileNameField,useSecretCountdown}.ts`.
- `apps/extension/src/utils/{full-backup-helpers,files,string}.ts`.
- `apps/extension/src/popup/pages/settings/security/export/{full,account,seed}.vue`.
- Backup/restore handoff sections in `apps/extension/src/wallet/services/{profile,account,account-state,token,token-balance,transaction,auth-registry,contact}/service.ts`, plus `profile/session-manager.ts`.
- Relevant sections of `popup/app.vue`, popup/onboarding import pages, `popup/pages/profile/new.vue`, `popup/components/popups/{EditProfilePopup,SelectProfilePopup}.vue`, and `components/composite/import/ImportFullBackupForm.vue`.
- `packages/design/src/ui/Input.vue`, `packages/design/src/internal/sanitize.ts`.
- Relevant cases and test declarations in the migration, backup registry/migrator, import composable, and export-page tests.

Verification: three in-memory reproductions using existing function bodies and synthetic dependencies. No files modified; no services or browser tests started.

## b03-backup-restore-migration-X-1: [Critical] Full export can silently omit imported signing keys after another window activates a profile

**Title:** Full-backup assembly is not bound to one profile.

**Severity:** Critical — a realistic multi-window interleaving produces a checksum-valid backup missing an imported account’s signing key.

**Repro confidence:** High.

**Type:** Silent corruption; secondary: race.

**Counter-example:**

1. Password profile A contains an imported account IA. Profile B contains no imported accounts.
2. Start A’s full export. Its master/entropy/DEK, profile slice, and account slice are collected successfully.
3. Before the imported-key slice is requested, another extension window finishes creating or restoring B, activating B.
4. `backupImportedKeys()` now reads B and returns `[]`. Remaining slices also read the current profile.
5. Export finishes successfully with A’s account IA but no corresponding signing-key row.

The in-memory assembler reproduction produced `profile=A`, `accountOwner=A`, `importedKeyCount=0`, `contactOwner=B`, and a valid checksum.

**Violated invariant:** A full backup represents one profile. `normalizeAllIds()` explicitly relies on this at `apps/extension/src/utils/full-backup-helpers.ts:381`. Imported-account rows must travel with their recoverable signing keys.

**Failing path:**

- `apps/extension/src/popup/pages/settings/security/export/full.vue:193`: export A’s authenticated key material.
- `full.vue:295`: construct parameterless slice calls.
- `apps/extension/src/utils/full-backup-helpers.ts:137`: await those calls sequentially.
- `apps/extension/src/wallet/services/account/service.ts:750`: the imported-key slice independently resolves the currently active profile.
- `full.vue:296`: the currency check compares only the page generation; that generation changes on unmount, not profile activation.
- `apps/extension/src/popup/app.vue:198`: a truthy profile-change event bootstraps the new profile without unmounting the export page.
- On restoration, `apps/extension/src/composables/useFullBackupImport.ts:557` calls reconciliation; `account/service.ts:842` identifies IA as keyless and `:852` deletes its restored account row.

**Expected vs actual behavior:** Export should finish entirely for A or abort when its profile context changes. Instead, it reports success for a mixed-profile artifact. Restoring that artifact cannot recover IA; its signing key is absent from the file. The original wallet remains intact, but relying on this backup after deletion/device loss loses access to that imported account unless another key copy exists.

**Recommended fix:** Capture the export profile identity before authentication and require every backup RPC to use or validate that same identity. Abort on a profile/session change, and bind artifact metadata and filename to the captured profile. A page-unmount fence alone is insufficient.

**Instances:**

- Assembly and live metadata: `apps/extension/src/popup/pages/settings/security/export/full.vue:193`, `:242`, `:295`, `:296`, `:375`; `apps/extension/src/utils/full-backup-helpers.ts:137`.
- Independently resolved profile slices: `apps/extension/src/wallet/services/profile/service.ts:2249`; `account/service.ts:663`, `:748`; `token/service.ts:847`; `token-balance/service.ts:663`; `transaction/service.ts:508`; `auth-registry/service.ts:487`; `contact/service.ts:276` through `:68`; `account-state/service.ts:206`.

## b03-backup-restore-migration-X-2: [Major] An older file selection can overwrite a newer backup and clear an active restore’s latch

**Title:** File-picker completions lack a selection-generation fence.

**Severity:** Major.

**Repro confidence:** High.

**Type:** Race; secondary: state invariant violation.

**Counter-example:**

1. Select valid backup A; its decompression or `File.text()` remains pending.
2. Select valid backup B; B finishes reading first and becomes the selected backup.
3. Enter B’s new password and start restoring it, setting `restoreStatus = "progress"`.
4. A’s older read completes.
5. The older handler replaces B with A, resets `restoreStatus` to `null`, and clears both password fields while B’s restore continues.

The in-memory execution of the existing `runPickBackupFile()` reproduced the transition from `B.json` to `A.json`, with the active restore’s status reset and password erased.

**Violated invariant:** The current selection must reflect the latest file-picking action. An active restore must retain its progress latch and credentials until its own completion. `runRestoreBackup()` explicitly depends on that latch to prevent concurrent restores.

**Failing path:**

- `apps/extension/src/components/composite/import/ImportFullBackupForm.vue:64`: picking is disabled only during restore, not during file reading.
- `apps/extension/src/composables/useFullBackupImport.ts:622`: progress is checked only before asynchronous work.
- `:624` and `:636`: file picking/decompression and reading yield.
- `:637`: any completion publishes its selection without checking whether it is still current.
- `:659`–`:662`: that completion resets restore status and credentials.
- `:717`: the ongoing restore’s re-entry guard is consequently reopened.

**Expected vs actual behavior:** A superseded file read should publish nothing, and no pending picker should reset a running import. Instead, the selected wallet can revert, the import can fail after losing its password, and another restore can pass the reopened guard.

**Recommended fix:** Give file selections a generation token checked after both awaits and before every publication, including error paths. Invalidate pending selections on reset/disposal and when restore begins; prevent submission while a replacement file is still loading.

**Instances:** `apps/extension/src/composables/useFullBackupImport.ts:621`, `:637`, `:659`, `:664`, `:922`, `:953`; shared UI entry at `apps/extension/src/components/composite/import/ImportFullBackupForm.vue:58`. Both popup and onboarding import pages use this handler.

## b03-backup-restore-migration-X-3: [Minor] A late recovery-phrase response redirects the user after the export page has closed

**Title:** Recovery-phrase export can start countdown timers after unmount.

**Severity:** Minor.

**Repro confidence:** High.

**Type:** Resource leak; secondary: wrong result.

**Counter-example:**

1. Click “Retrieve Recovery Phrase” with the correct password.
2. Navigate back before `exportMnemonic()` resolves.
3. The page’s unmount cleanup and countdown’s scope cleanup run.
4. The pending export resolves and calls `countdown.start()` on the disposed page.
5. Five minutes later, its timeout pushes `/popup/settings/security/export`, interrupting whatever page the user is viewing. Its interval also remains active.

An in-memory reproduction using the actual page script and countdown implementation left one timeout and one interval after disposal; invoking the timeout produced the unrelated navigation.

**Violated invariant:** Page-owned timers must end with their scope. The full-export sibling explicitly fences asynchronous completion against unmount at `full.vue:276` and `:416`; recovery-phrase export lacks that protection.

**Failing path:**

- `apps/extension/src/popup/pages/settings/security/export/seed.vue:59`: await the export RPC.
- `:79`: navigation runs unmount cleanup.
- `apps/extension/src/composables/useSecretCountdown.ts:50`: scope disposal clears existing timer handles.
- `seed.vue:63`: the late continuation starts new timers after cleanup.
- `useSecretCountdown.ts:29`: the timeout invokes `handleClose()`.
- `seed.vue:46`: `handleClose()` navigates the current router.

**Expected vs actual behavior:** A response belonging to an unmounted export page should be discarded. Instead, it creates timers that outlive the page and later redirect the user.

**Recommended fix:** Capture a lifecycle generation in `handleUnlock()` and check it immediately after the RPC; invalidate it on unmount. Also make countdown `start()` refuse execution after disposal.

**Instances:** `apps/extension/src/popup/pages/settings/security/export/seed.vue:55`, `:63`, `:79`; `apps/extension/src/composables/useSecretCountdown.ts:26`, `:50`.

## Leads adjudicated

- **q07 — `export/full.vue:375`, unsanitized filename:** Rejected. Current create/rename/import inputs strip path separators; embedded backup names are also sanitized. The proposed `a/b c` stored name has no demonstrated normal UI producer. Remaining spaces are not a demonstrated download failure.
- **q07 — `export/full.vue:316`, passkey Encrypt hides recommendation:** Rejected. Hiding the recommendation reveals the password form at `full.vue:572`; the first empty-password click is the transition into that form. Mismatches receive explicit feedback.
- **q02 — `profile/service.ts:1965`, legacy mnemonic-export password error:** Rejected at the export-UI handoff. `export/seed.vue:64` catches every rejection and sets the wrong-password state; it does not depend on `InvalidPasswordError` identity.

## Routed to security

None.

## Non-findings considered

- Filename lead: current profile-name input sanitization removes `/` and `\`; no normal-operation counter-example established.
- Passkey Encrypt lead: the first click intentionally reveals password fields, and mismatches render an error.
- Mnemonic-export error-type lead: the consuming page recognizes failure without matching an error class.
- Per-row restore failures are explicitly best effort; partial success alone is not a bug.
- Keeping a fully written profile after finalization starts is documented behavior.
- Prior N-01 export re-entry/checksum failure is fixed by the synchronous latch, sealed serialization, error handling, and cleanup; X-1 concerns a different profile-consistency gap.
- Prior N-14 rollback race now has restore deletion fences; inspected writers capture epochs before queued work and serialize relevant writes.
- Prior N-20 remains excluded per adjudication; the current numeric allocator additionally checks canonical safe integers and physical occupancy.
- Prior N-24 authwit duplication is addressed by compound-identity deduplication during restore.
- Migration recovery distinguishes committed checkpoints from interrupted writes and preserves the journal on recovery failures; no new concrete failure established.
- Production `realMigrations` is empty; hypothetical failures requiring an unshipped transform were not reported.
- Retired network/FPC slices, unsupported compatibility epochs, and custom-network restore exclusions are documented intentional restrictions.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

Claude reported no numbered findings. I disagree with its zero-finding conclusion, specifically its dismissal of the export race. The “sub-second window” is unsupported, and unmount fencing does not cover profile activation: `apps/extension/src/popup/app.vue:198` bootstraps the replacement profile without unmounting the export page; `apps/extension/src/popup/pages/settings/security/export/full.vue:416` increments the export generation only on unmount. **Confidence: high.**

**2. Rejected leads where we differ—or agree**

- **Mixed-profile export — disagree with rejection:** after exporting A’s account rows, another window can activate B; `apps/extension/src/wallet/services/account/service.ts:750` then selects B for the imported-key slice. The assembler’s check at `apps/extension/src/popup/pages/settings/security/export/full.vue:296` still passes. My in-memory reproduction produced a checksum-valid artifact containing A’s imported account without its signing key.
- **Filename separators — agree with rejection:** ordinary create/rename inputs sanitize names; `packages/design/src/internal/sanitize.ts:12` removes separators, and `apps/extension/src/composables/useFullBackupImport.ts:401` sanitizes embedded names. No demonstrated normal-operation failure.
- **Passkey Encrypt recommendation — agree with rejection:** `apps/extension/src/popup/pages/settings/security/export/full.vue:572` deliberately reveals password fields when the recommendation disappears.
- **Transaction-collision rationale — partially agree:** rejecting overwrite is intentional, but “no history is lost” overstates the evidence: although raw reads match by address, `apps/extension/src/wallet/services/transaction/service.ts:578` excludes another profile’s rows from subsequent backups. This alone does not establish a new eligible finding.

**3. What Claude missed that I found**

- **b03-backup-restore-migration-X-1 — retain, Critical:** the rejected export race can omit imported signing keys while reporting success; `apps/extension/src/wallet/services/account/service.ts:750` resolves the replacement profile, and reconciliation later deletes the keyless restored account at `:852`. **Confidence: high.**
- **b03-backup-restore-migration-X-2 — retain, Major:** an older pending file read can overwrite a newer selection and clear an ongoing restore’s latch/password; publication at `apps/extension/src/composables/useFullBackupImport.ts:637` and resets at `:659` have no post-await currency check. Reproduced in memory. **Confidence: high.**
- **b03-backup-restore-migration-X-3 — retain, Minor:** a recovery-phrase RPC resolving after navigation starts timers after disposal at `apps/extension/src/popup/pages/settings/security/export/seed.vue:63`; the timeout later navigates through `:46`. Existing cleanup at `apps/extension/src/composables/useSecretCountdown.ts:50` cannot clear subsequently created timers. Reproduced with fake timers. **Confidence: high.**

**4. What both missed**

No additional finding established in this light pass.