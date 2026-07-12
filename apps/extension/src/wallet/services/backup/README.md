# backup — backup-import migration

Migrates an imported full-backup's `data` slices forward to the current storage schema **before** the service-by-service restore runs. Backup migrations and live migrations are the SAME numbered objects (`realMigrations`) — never a divergent second copy.

## Files

| File | Owns |
|---|---|
| `backup-migration-registry.ts` | The pinned `serviceName → SliceDescriptor` map (`root` / `value-projection` / `non-storage` / `block-listed`), `normalizeBackupData` / `denormalizeBackupData`, the `compat-epoch` + `backup-schema-version` constants, `isSupportedCompatEpoch`, `BACKUP_BLOCKED_ROOTS`. Pure data transforms — no chrome.*, no engine, no services. |
| `row-map-migration.ts` | `defineRowMapMigration` — the **backup-safe** migration form: a finite declarative DSL (`rename` / `drop` / `retype` / `remapValues` / `addDefault`, fixed clause order, per-row interpreter). Compiles to a standard `Migration`, WeakSet-branded + deep-frozen (`isBackupSafeMigration` requires both). **No author functions, ever** — arbitrary code cannot be proven row-local; that hole was rejected 4× in the plan's audits. |
| `backup-migrator.ts` | `migrateBackupData`: version guards → normalize → fail-closed preflight → in-memory scratch `MemoryStorageArea` seeded in the exact live key/value format → the REAL `Migrator` → denormalize. Result: `noop` / `migrated` (success, carry `data`) / `incompatible` (re-export) / `failed` (reject). Also `maxBackupSchemaVersion` (import range) and `CURRENT_BACKUP_SCHEMA_VERSION` (export stamp — real migrations only, fixtures excluded). |
| `footprint-coverage.test.ts` | The anti-drift keystone: every backup-facing migration is registry-covered + backup-safe or explicitly acknowledged in `IMPORT_BLOCKING_ACK`; the generic metamorphic guardrail (per-row output byte-identical under subset × permutation × duplication through the real engine); brand non-forgeability. |

## Invariants

- **Trust boundary**: the blob is attacker-controlled (a plain backup's checksum is recomputable — integrity detection, not authentication). Every transform presence-guards and fails closed. Unknown slice name → reject.
- **Trust-gate order** (`useFullBackupImport`): checksum over the ORIGINAL body → `compat-epoch` (non-migratable; the only hard version reject) → `backup-schema-version` range → migrate → restore. Never recompute-and-trust a post-migration checksum.
- **Row locality is structural**: backup slices are profile-scoped projections of the live store, so a backup-safe migration's per-row output must not depend on siblings, order, or call count. Pure data can't observe them; imperative migrations therefore BLOCK import (the honest escape hatch) rather than risk divergent output.
- **Row identity**: migrations never renumber ids/anchors or change cardinality; denormalize re-derives each row's id from its value and rejects a mismatch.
- **Block-listed roots**: `nulo:core:profiles` (rows re-derived from `master-key` on restore) and `nulo:core:auth-registry-enabled` (backup-absent by design, defaults `true` when absent). A migration touching either blocks import.
- **`master-key` never enters the scratch store**, results, or error reasons — it flows only to `profileService.restore`.
- **Atomicity**: migration is fully in-memory before any `service.restore()`; a failure rejects with zero live mutations.

## Adding a migration

Author it in `apps/extension/src/wallet/storage/migrations/` per `template.ts` — prefer `defineRowMapMigration`; register in `realMigrations`. If it can't fit the DSL, the imperative form must be acknowledged in `IMPORT_BLOCKING_ACK` (an explicit release decision: old backups will demand a re-export). E2E coverage is inherited automatically via the build-stamped declarative fixture (`src/e2e/backup-migration-fixture.ts`) — smoke (`tests/e2e/backup-migration.test.ts`) and the on-chain network round-trip (`tests/e2e/network/backup-migration-roundtrip.test.ts`).
