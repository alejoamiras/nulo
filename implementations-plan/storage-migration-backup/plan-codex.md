# Backup-Import Migration Plan

## Architecture Decision

**Chosen: C, normalize to a scratch `MinimalStorageArea`, run the live `Migrator`, then re-slice for `service.restore()`.**

The implementation should convert verified backup `data` slices into storage-shaped scratch keys, stamp `nulo:schema:version` from `backup-schema-version`, run the same registry used by live storage, then convert the migrated scratch rows back into backup slices before the existing restore order runs.

This is a **small hybrid** only where the backup is not live-storage-backed: storage-backed slices use the live migrator path; non-storage slices such as `account-state` pass through unchanged unless a future explicit backup-only migration is added. They must not be silently treated as live roots.

Why this choice:

- The live engine already owns ordering, staging, version checks, and footprint enforcement in `Migrator` ([migrator.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/wallet-core/src/migration/migrator.ts:96), [migrator.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/wallet-core/src/migration/migrator.ts:197), [migrator.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/wallet-core/src/migration/migrator.ts:255)).
- `MigrationArea` type parameters are assertions, not validation, so the backup trust boundary still needs explicit validation and fail-closed parsing ([types.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/wallet-core/src/migration/types.ts:25)).
- Backup import already has ID remapping after restore; migration should preserve logical pre-restore references and let existing remap logic run afterward ([useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:296), [useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:320), [useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:369)).

Rejected alternatives:

- **A, direct `MigrationArea` backup adapter:** reuses `up()` bodies, but would need a custom runner for version filtering, sequencing, staging, failure handling, and footprint guards. That duplicates exactly the logic the live engine centralizes.
- **B, version each `service.restore(slice, fromVersion)`:** scatters migration logic through services and reintroduces the anti-pattern the numbered engine replaced. Restore is already order-sensitive and ID-remapping-heavy.
- **Pure C without hybrid constraints:** unsafe, because not every backup slice maps to `chrome.storage.local`. `account-state` is PXE-backed and has no `EntityStorage` root in its service ([account-state/service.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/wallet/services/account-state/service.ts:37)).

## Phase 1: Format Constants And Registry

Implement:

- Add `compat-epoch` and `backup-schema-version`.
- New baseline export stamps:
  - `"compat-epoch": 2`
  - `"backup-schema-version": CURRENT_BACKUP_SCHEMA_VERSION`, currently `1`.
- Stop relying on legacy `"schema-version": 2`; current import conflates compatibility and migration version ([useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:216)).
- Split the migration registry into real migrations and test fixture migrations so the E2E fixture version `9001` never becomes a backup schema version ([migrations/index.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/wallet/storage/migrations/index.ts:17)).
- Add an explicit backup mapping registry, not string transforms. Required mappings include:
  - `profile` → root `nulo:core:profiles`
  - `account` → root `nulo:core:accounts`
  - `network` → root `nulo:core:networks`
  - `token` → root `nulo:core:tokens`
  - `token-balance` → root `nulo:core:token-balances`
  - `transaction` → root `nulo:core:txs`
  - `contact` → root `nulo:core:contacts`
  - `fpc` → root `nulo:core:fpcs`
  - `auth-registry` → root `nulo:core:auth-registry`
  - `config` → value `nulo:config`
- Explicitly mark unmapped persisted roots, such as `nulo:core:auth-registry-enabled`, as unsupported for backup migration unless a future mapping is added.

Validation gate:

```bash
bun run --cwd apps/extension test src/wallet/storage/migrations/registry.test.ts src/wallet/storage/migrations/backup-registry.test.ts
bun run typecheck
bun run lint
```

Pass criteria: registry versions remain contiguous, every mapped root/value has a codec test, unknown roots are rejected, no fixture version leaks into backup schema version.

## Phase 2: Normalize, Migrate, Re-Slice

Implement `apps/extension/src/wallet/storage/migrations/backup-migrator.ts`:

1. Validate `data` is an object and has no unknown service keys.
2. Normalize mapped slices into a scratch `MinimalStorageArea`:
   - entity rows as `${root}@${id}` with JSON-string values, matching `EntityStorage` ([entity_storage.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/wallet-core/src/storage/entity_storage.ts:75)).
   - config props array into JSON-string `nulo:config`, matching `ValueStorage` ([value-storage.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/wallet-core/src/storage/value-storage.ts:18)).
3. Stamp `nulo:schema:version` to the backup’s `backup-schema-version`.
4. Run `new Migrator({ store: scratch, migrations: realMigrations, baselineVersion: BASELINE_VERSION })`.
5. Treat only `noop` and `migrated` as success. Any `failed`, even non-breaking, rejects import.
6. Re-slice scratch storage back into backup `data`.
7. Fail closed if any migration read/write ref is not represented by the registry.

Missing-slice semantics:

- If a migration touches a missing required slice, reject.
- Optional emptyable slices may normalize as empty only when the registry explicitly marks that service as optional.
- Extra unknown slices reject. Do not preserve unrecognized `data.*` payloads.

Validation gate:

```bash
bun run --cwd packages/wallet-core test src/migration/migrator.test.ts
bun run --cwd apps/extension test src/wallet/storage/migrations/backup-migrator.test.ts
bun run typecheck
bun run lint
```

Pass criteria: synthetic row and value migrations produce byte-equivalent results to the live migrator; unmapped refs, malformed rows, id/key mismatches, and unknown slices reject before restore.

## Phase 3: Export And Import Rewire

Implement:

- Update full backup export at [full.vue](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/popup/pages/settings/security/export/full.vue:128) to stamp `compat-epoch` and `backup-schema-version`.
- Keep checksum generation last, over the original exported body minus checksum, as today ([full.vue](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/popup/pages/settings/security/export/full.vue:143)).
- In `useFullBackupImport.ts`, reorder trust gates:
  1. Parse/decrypt.
  2. Strip checksum and verify it over the original body.
  3. Validate `compat-epoch`.
  4. Validate `backup-schema-version`.
  5. Migrate.
  6. Restore.
- Do **not** recompute and trust a migrated checksum. The migrated object is derived from a verified original; a restamped checksum would be easy to misread as user-provided integrity.

Validation gate:

```bash
bun run --cwd apps/extension test src/composables/useFullBackupImport.test.ts src/utils/full-backup-helpers.test.ts
bun run --cwd apps/extension test src/components/composite/import/ImportFullBackupForm.test.ts src/popup/pages/import-helpers.test.ts
bun run typecheck
bun run lint
```

Pass criteria: checksum failure blocks before migration, incompatible compat epoch blocks after checksum, old migratable version calls the backup migrator, and no service client restore is called on rejected blobs.

## Phase 4: Restore Atomicity And Parity Tests

Implement:

- Run backup migration before `ProfileServiceClient.restore()` so migration failure cannot mutate live storage.
- Track `newProfile.id` after profile restore.
- Preserve existing intentional behavior where `finalizeRestore` failure leaves the profile available for later unlock ([useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:411)).
- Harden pre-finalize failures: if profile was created and restore fails before finalization, attempt `deleteProfile(newProfile.id)` in the outer catch. Today only the no-network and duplicate-address branches delete the profile ([useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:309), [useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:342)).
- Add parity tests: same synthetic migration, same logical data, live storage path and backup path produce identical re-sliced current backup data.

Validation gate:

```bash
bun run --cwd apps/extension test src/composables/useFullBackupImport.test.ts src/wallet/storage/migrations/backup-migrator.test.ts
bun run --cwd apps/extension test src/components/composite/import/ImportFullBackupForm.test.ts
bun run typecheck
bun run lint
```

Pass criteria: no half-restore on migration failure, rollback runs for pre-finalize restore failures, finalize failure behavior remains pinned, parity tests cover root and value migrations.

## Phase 5: Smoke E2E And Release Gate

Implement:

- Update synthetic backup builders in `apps/extension/tests/e2e/helpers/import-drivers.ts` and passkey backup tests to use the new metadata fields.
- Add smoke coverage for:
  - current backup v1 import succeeds.
  - incompatible compat epoch shows incompatible-backup UX.
  - tampered checksum blocks before restore.
  - migratable old version path is covered by unit parity, since no real production migration exists yet.
- Do not add network E2E. This is an accepted coverage tradeoff: smoke E2E proves UI/import wiring; unit parity proves migration correctness against the live engine.

Validation gate:

```bash
bun run test:e2e import-paths
bun run test:e2e security-backup
bun run typecheck
bun run lint
```

Optional local passkey smoke:

```bash
bun run test:e2e passkey-backup
```

Pass criteria: smoke import still lands on `/popup/general`, duplicate-address rollback still holds, metadata errors show user-facing failure, no network E2E required.

## Security & Adversarial Considerations

Threat model: attacker can provide arbitrary plain or encrypted backup bytes. A plain backup checksum is not authentication; an attacker can edit a plain JSON backup and recompute SHA-256. Treat checksum as accidental-integrity detection, not proof of benign origin.

Key controls:

- **Checksum ordering:** verify original checksum before migration. Never migrate first and then trust a recomputed checksum.
- **Input validation:** validate top-level fields, data keys, slice shapes, row id consistency, and version ranges before scratch migration.
- **Least privilege:** migration runs only against in-memory scratch storage. Live storage is untouched until migration succeeds and restore begins.
- **Footprint enforcement:** rely on `Migrator.guardCommit()` and add backup-registry preflight so writes to unmapped roots cannot be silently dropped.
- **Master key handling:** never place `"master-key"` into scratch storage, logs, restore error details, or migration fixtures. Strings cannot be zeroized; avoid extra copies.
- **Downgrade/replay:** allow same-compat old backups from version `1..current`; reject version `<1`, missing version, and version `>current`.
- **Missing slices:** missing required touched slices reject. Optional-as-empty is an explicit registry exception and should be treated as an unsafe assumption in review.
- **Non-storage slices:** `account-state` is PXE-backed, so live migrations cannot transform it. Any future account-state backup shape change needs an explicit backup-only migration design, not accidental pass-through.

## Assumptions

### Facts

- The migration engine operates on injected `MinimalStorageArea` and exposes `MigrationArea` rows/value APIs ([types.ts](/Users/alejoamiras/Projects/nulo/nulo-4/packages/wallet-core/src/migration/types.ts:31)).
- Fresh installs stamp the baseline; current baseline is `1`, and real migrations are currently empty ([migrations/index.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/wallet/storage/migrations/index.ts:17)).
- Export currently writes `"schema-version": 2`, `"master-key"`, `data`, and checksum last ([full.vue](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/popup/pages/settings/security/export/full.vue:128)).
- Import currently rejects `schema-version !== 2` before checksum verification ([useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:216)).
- Restore order is profile, network, account, token, then remaining services ([useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:287), [useFullBackupImport.ts](/Users/alejoamiras/Projects/nulo/nulo-4/apps/extension/src/composables/useFullBackupImport.ts:381)).
- Pre-production policy says current shape is the launch baseline; once production starts, every persisted shape change requires a migration ([CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-4/CLAUDE.md:78)).

### Inferences

- The new backup baseline should be current data shape with new metadata: `compat-epoch: 2`, `backup-schema-version: 1`.
- Unit parity plus smoke E2E is sufficient for the dropped network-E2E layer unless the first real migration depends on live PXE/network behavior.
- Any migration touching an unmapped storage ref should block backup import rather than silently skipping that migration.

### Asks

- Confirm whether legacy `"schema-version"` should be omitted entirely or kept as an ignored transitional field in exported JSON.
- Confirm user-facing copy for “newer backup version” versus “incompatible compat epoch.”
- Before the first migration touching `account-state`, decide whether to add a backup-only migration lane or declare that slice non-migratable.