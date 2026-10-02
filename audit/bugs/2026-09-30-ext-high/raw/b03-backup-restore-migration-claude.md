# b03-backup-restore-migration — claude

Scope read: apps/extension/src/composables/{useFullBackupImport.ts (1-310, 395-620), full-backup-restore.ts (all)}; apps/extension/src/utils/{full-backup-helpers.ts (100-235, 380-425), files.ts (1-90), string.ts}; apps/extension/src/popup/pages/settings/security/export/{full.vue (100-420, template grep), account.vue (160-190)}; apps/extension/src/wallet/services/{restore-fence,restore-rows,require-owned-row,id-allocators,purge-rows}.ts; apps/extension/src/wallet/services/backup/backup-migrator.ts; packages/wallet-core/src/migration/{migrator,staging}.ts; restore() of account, token, token-balance, contact, config, auth-registry, transaction services (service.ts); packages/design/src/ui/Input.vue + internal/sanitize.ts; EditProfilePopup.vue / profile/new.vue (sanitize usage). Not read in depth: backup-migration-registry.ts, row-map-migration.ts, useProfileImportFlow.ts, wallet/storage/**, ProfileService.restore/finalizeRestore.

Result: zero findings. The restore/migration path is heavily hardened (per-row epoch fence, journaled migrator with counted-attempt resume matrix, locked batch allocation, rollback with bounded retry and liveness gate), and every trace I attempted ended in a documented or guarded behavior.

## Leads adjudicated

- `full.vue:375` (`profile.name.replace(" ", "_")`, path separators): REJECTED as not triggerable. The lead is right that only the first space is replaced and no separator stripping happens, but a profile name cannot contain a path separator on any entry path I traced: `profile/new.vue:111` and `EditProfilePopup.vue:148` pass `sanitize` (allowed set: letters, digits, space, `-`, `.`, `_`; 32 chars), and the backup import path runs `sanitizedBackupName` (`useFullBackupImport.ts:398`) through the same regex. Remaining spaces and dots are legal in a download filename, and the fixed `NuloBackup_` prefix means a name like `..` cannot produce a traversal segment. It is an inconsistency with `account.vue:174`, not a wrong result. Residual (low confidence, not reported): `Input`'s `sanitize` is opt-in, and I did not read the passkey/mnemonic profile-import pages that also set names.
- `full.vue:316` (`passkeyPasswordBlocked` hides the recommendation before checking the password, silent on empty): REJECTED. `showRecommendation=false` is what reveals the passkey password form (template `full.vue:572` `v-if="!showRecommendation && isPasskeyProfile && backupStatus === 'finished'"`), so clearing it is the intended step from banner to form. Empty password gives no toast, but the form is then visible and the submit path simply declines to start; no wrong result, no state corruption.

## Routed to security

None.

## Non-findings considered

- Migrator crash-resume (`migrator.ts`): stamp-before-journal-clear ordering, `counted` marker ordering, restore-from-declared-footprint, and the `stamped` guard were each traced for a double-count or revert-under-stamp interleaving; none found.
- `StagingArea` commit is non-atomic (sets, then removes, then version stamp): a kill in the gap leaves `version < backup.version` with an armed journal, which resume restores from the footprint snapshot. Safe.
- `nextNumericId` / `preferOrReallocId` / `nextRandomId` are check-then-write, but every restore caller holds the service lock (token `lock.withLock`, contact `lock.withLock`, auth-registry lock, balance lock); no unlocked concurrent allocator in this cluster.
- Token-balance re-link pairs by result index (`relinkRestoredTokenBalances`); relies on `TokenService.restore` returning one ordered result per input, which `restoreRows` guarantees (failures keep position).
- `TransactionService.restore` rejects hash collisions with a same-seed sibling profile's rows; those rows stay visible to the new profile because transactions are read by address, so no history is lost, only a recorded restoreError.
- `ConfigService.restore` is unlocked and unfenced and writes global (non-profile) presentation prefs; it is allowlisted and intentional, and the rollback of a failed import does not revert those prefs (design, not a corruption).
- Export slices read at different times, each `backup()` using the SW's active profile while key material is exported for `appStore.profile.id`: a profile switch in a second window mid-assembly could mix profiles, but it needs a switch within a sub-second window during export and the page's generation fence is bumped on unmount; low repro confidence, not reported.
- `rollbackCreatedProfile` commit-ambiguity on retry is documented in its own comment as an accepted conservative choice (cleanup-pending message).
- `restoreTokensStage` passes `data.token` unchecked: a backup with no `token` slice would throw and roll back, but the registry normalizes missing optional slices and the exporter always emits arrays.

## Cross-rebuttal (claude on codex)

### 1. Codex findings

- **X-1 (Critical): partially agree, severity inflated; I reverse my own non-finding.** I traced the counter-example line by line and it is mechanically valid.
  - `full.vue:296` builds `sources` as `client.backup()` with no profile argument, and `assembleFullBackup` awaits them sequentially (`full-backup-helpers.ts:137-142`).
  - The account slice resolves the profile at call time: `account/service.ts:748-749` calls `requireActiveProfile(this.profileService)`, which calls `getActiveProfile()`. That reads `sessionManager.getActive()`, and the SW has exactly one active session.
  - `profile/service.ts:1321` `sessionManager.open(B)` replaces A's session. It emits `onActiveProfileChanged(B)`.
  - `app.vue:198-208` handles a truthy profile with `bootstrapActiveProfile`. That sets `appStore.profile = B` (`useProfileBootstrap.ts:149`) and does not unmount the export page. The `generation` fence (`full.vue:296`, bumped only on unmount) stays true.
  - So the later slices and `backupImportedKeys()` return B's rows (`[]`). The master key, entropy and DEK stay A's, because `exportBackupMaterial` takes an explicit id. The checksum is valid, and restore then drops IA as keyless via reconcile.
  - The gap Codex missed: `full.vue:375` and `active-chain-id` read live `appStore`, so the filename would carry B's name.
  - It is not Critical. It needs a profile activation (unlock, create or restore of B) in a second window inside the export's assembly span (after KDF, across local-storage slice reads), while A's export page stays open. The user types B's password in that span. The original wallet is untouched, and the failure is a bad backup, not data loss by itself.
  - I rate it **Major, low likelihood**. The fix Codex proposes (capture the profile id and validate it per slice, or abort on an `appStore.profile.id` change) is right and cheap: probe `appStore.profile.id === startId` inside the `onSlice` callback.
- **X-2 (Major): partially agree, Minor.** The mechanism is real. `runPickBackupFile` guards `restoreStatus === "progress"` only at entry (`useFullBackupImport.ts:622`). Its completion at `:637` and `:659-662` publishes unconditionally and resets `restoreStatus` and the passwords. Two things make it unrealistic:
  - `readBackupFile` on a size-capped file takes milliseconds, so a second pick, password entry and restore start would have to fit inside A's read.
  - The OS picker is modal, so the two picks cannot overlap.
  - The only plausible window is a very large compressed file. A generation token is still a cheap, correct fix.
- **X-3 (Minor): agree.**
  - `seed.vue:59` awaits `exportMnemonic`, whose KDF takes real time.
  - `onScopeDispose(clear)` (`useSecretCountdown.ts:50`) runs at unmount.
  - `countdown.start()` (`seed.vue:63`) then arms a new timeout and interval that are never cleared.
  - After 5 minutes, `onTimeout` navigates the user away from whatever page they are on.
  - The leaked interval is harmless.
- **Leads.** The q07 filename and passkey-Encrypt rejections match mine. The q02 lead (legacy mnemonic-export password error) I never adjudicated. Codex's rejection is sound: `seed.vue:64` catches every rejection.

### 2. What Codex missed that the Claude report found

Nothing. My report had zero findings, and X-1 is what I wrongly dismissed as low confidence.

### 3. What both missed

None that I can demonstrate with a counter-example.
