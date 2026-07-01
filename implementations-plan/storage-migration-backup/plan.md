# Backup-import migration (split from storage-migration-framework)

**Status:** QUEUED — blocked on the live migration engine (`storage-migration-framework/`) landing its injected-data-source seam. Blueprint properly (`/blueprint mid`) before implementing. · **Not yet designed to gate-ready.**

## Why this is its own plan
Migrating an imported full-backup forward looked like a "free second consumer" of the migration engine, but the codex final pass (Round 4, `../storage-migration-framework/audit-codex.md`) showed it is a genuinely different problem:

1. **Different representation.** The backup blob is **per-service arrays** (`data.account`, `data.network`, `data.token`, `data.profile`, …) + an encrypted `master-key` + a **whole-blob checksum** (`apps/extension/src/popup/pages/settings/security/export/full.vue:128-141`). Live storage is per-row `${root}@${id}` entity rows. A migration written against live rows cannot run on the backup blob without an explicit **service-array ↔ storage-row mapping** (+ ID-key mapping, config-value mapping, missing-root semantics, parity tests).
2. **Compat gate conflated with the version.** The "incompatible / custom account contracts" rejection IS `schema-version !== 2` (`apps/extension/src/composables/useFullBackupImport.ts:216`). A **separate, non-migratable compatibility-epoch field** must be added to the export format so an *incompatible* backup stays distinguishable from *migratable old* data.
3. **Checksum-after-migrate.** Migrating a backup invalidates its `checksum` — the flow must verify-before, migrate, then recompute (and decide the trust ordering).

## Scope (to be detailed at blueprint time)
- A backup `MigrationContext` adapter over the injected data-source seam (service-array representation).
- The service-array ↔ storage-row mapping + parity tests vs the live adapter.
- The new compatibility-epoch field in `export/full.vue` + `useFullBackupImport.ts`; rewire the `!== 2` reject into "migrate `vN→current` unless the compat-epoch is incompatible."
- Checksum verify→migrate→recompute ordering.
- Smoke e2e: import a `vN` backup, assert it migrates forward end-to-end; an incompatible-epoch backup still rejects; a same-version backup is a no-op.
- Network e2e: full-backup restore round-trip post-migration.

## Dependency
Requires `storage-migration-framework/` Phase 1 (the engine + injected data-source/backup/version ports). Once that seam exists, this is additive.
