NOTE FOR CODEX: This is a DEFENSIVE hardening review of our own code, commissioned by the code owner, so we can fix weaknesses before release. Report weaknesses with concrete traces and recommended fixes. You run in a read-only sandbox: do NOT try to write files. Output your FULL report as your response text (it will be saved as raw/c04-backup-import-migration-codex.md by the orchestrator). Ignore the 'Write your report to …-claude.md' line at the end. Where the instructions say to read SECURITY-PROMPT.md, read audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT-codex.md instead.

You are a Phase 2 cluster auditor in a map-reduce security audit. Working directory is the repo root (a git worktree of origin/dev). READ FIRST, in this order: `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`, then `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (the exact audit prompt + negative list + output format — follow it exactly), then the repo-map files named below for orientation. Then read the cluster source files IN FULL (not excerpts). Verify every claim against the code; cite file:line. Do not modify any file except your output file.

# Cluster c04-backup-import-migration — full backup export/import, untrusted backup handling, migration engine, storage primitives

Repo maps: `raw/repo-map/extension-services-secrets.md` (§3 backup gates, storage keys), `raw/repo-map/wallet-core.md` (§3, §8).

Source files (read all, in full):
- `apps/extension/src/wallet/services/backup/{backup-migration-registry.ts, backup-migrator.ts, row-map-migration.ts, README.md}`
- `apps/extension/src/wallet/storage/migrations/{index.ts, template.ts}`, `apps/extension/src/utils/storage.ts`
- `packages/wallet-core/src/migration/{migrator.ts, staging.ts, types.ts}`, `packages/wallet-core/src/storage/{entity_storage.ts, value-storage.ts, memory-storage-area.ts, prefixed-entries.ts}`
- `apps/extension/src/composables/{useFullBackupImport.ts, full-backup-restore.ts, useFullBackupExport.ts}` (whatever exists), `apps/extension/src/utils/full-backup-helpers.ts`, `apps/extension/src/popup/pages/settings/security/export/full.vue` and the import page
- Every service `backup()`/`restore()` override: `profile/service.ts` (~2160-2330 and `restore`/`finalizeRestore`), `account/service.ts` (~661-800), `account-state/service.ts` (~150-300) + `normalize.ts`, `auth-registry/service.ts` (~405-470), `config/service.ts` (restore allowlist), `network/service.ts` (`validateRestoredNetwork` ~1040-1060 + its restore), `token/service.ts`, `token-balance/*` restore, `transaction/service.ts` restore, `contact/service.ts` (+ `importContacts`/`exportContacts`), `fpc/service.ts` restore, `dapp-session` (is it in the backup? check registry)
- `apps/extension/src/wallet/services/{restore-fence.ts, restore-rows.ts, purge-rows.ts}`
- Tests: `backup/footprint-coverage.test.ts`, `backup-migrator.test.ts`, `profile/service.integration.test.ts` restore cases.

Specific questions:
1. Build the exact export blob shape (what is encrypted with what, what is plaintext, checksum coverage). Is the encrypted backup authenticated over its metadata (`backup-schema-version`, `compat-epoch`, `aztec-version`, profile type)? Can an untrusted party downgrade/upgrade version fields to steer migration or restore into a weaker path?
2. `master-key` handling on import: where is it decrypted, how long is it held, is it zeroized, does it ever pass through `migrateBackupData` or a log?
3. Trust gates order: checksum → compat-epoch → version range → migrate → per-service restore. For EACH restored slice, list what is validated (zod), what is NOT (semantic: ownership `profileId` rebinding, duplicate ids, cross-profile rows, foreign chainIds, oversized rows), and what a untrusted backup can plant: extra accounts under the victim profile, a tampered Network endpoint (F-011 regression?), a fake FPC address (fund-loss per fpc/service.ts:35-42), a trusted dApp session with wide grants (is dapp-session backed up? if yes, is the MAC recomputed under the importing profile — meaning a untrusted backup can mint grants?), config keys (E fix: allowlist — verify `strictSecurityMode` cannot be restored to false), auth-registry rows, contacts with lookalike names, tokens with impersonated metadata.
4. Restore atomicity + torn restore: `restore-pending` marker, `finalizeRestore`, epoch fences. Can a crash mid-restore leave a profile that unlocks with partial/foreign rows? Can a second restore race the first?
5. Migration engine: footprint enforcement, reserved prefix, journal backup validation, run-twice idempotency, `breaking` default — any way a untrusted backup can cause the in-memory migrator to write outside its footprint or throw in a way that leaves the LIVE store half-written (the live store must never be touched by backup import).
6. `EntityStorage.decodeRow` keep-but-hide + `requireKeyIdentityMatch` opt-in: list which roots enable identity matching and which do NOT; for those that don't, construct a row-transplant attack (copy profile B's row under profile A's key) and say whether any consumer trusts the embedded id.
7. The UI storage facade: any UI code that bypasses it (grep `chrome.storage.local` in `apps/extension/src/{popup,onboarding,stores,composables}`); consequences during a running migration.
8. Contacts import/export (plaintext JSON): injection into display, size caps, address validation.

Write your report to `audit/security/2026-09-13-high-prerelease/raw/c04-backup-import-migration-claude.md`.
