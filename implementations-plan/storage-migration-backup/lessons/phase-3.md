# Phase 3 — export format + reject rewire + trust-gate reorder — lessons

**Status: ✓ complete.** Gate: `useFullBackupImport.test.ts` 26 pass + `full-backup-helpers.test.ts` pass + `test:components src/components/composite/import/` 367 pass + `bun run typecheck` exit 0 + `bun run lint` exit 0.

## What was built
- `full.vue` stamps `compat-epoch` (=2) + `backup-schema-version` (=`CURRENT_BACKUP_SCHEMA_VERSION`), drops legacy `schema-version`. Constants imported from the registry/migrator — export + import single-sourced.
- `useFullBackupImport.ts` trust-gate reorder: checksum over the ORIGINAL body FIRST, then `isSupportedCompatEpoch` (pre-baseline blob → "Incompatible backup" re-export copy), then schema-version range (`<1`/missing/non-integer → incompatible; `> maxBackupSchemaVersion()` → distinct "Backup is too new" + update-the-wallet copy). Migration itself not wired yet (Phase 4).
- `CURRENT_BACKUP_SCHEMA_VERSION = maxBackupSchemaVersion(realMigrations)` — deliberately EXCLUDES the 9001 fixtures so a stamped e2e build can't mint backups a production build would reject as from-the-future. Import range uses `backupMigrations` (so a stamped build accepts the fixture version).
- Test/builders updated: composable `buildBackup` + e2e `buildSyntheticBackup` + passkey-backup builder stamp the new fields; new guard tests incl. an ORDER pin (bad epoch + bad checksum → the checksum error wins).

## Incident: blanket `biome check --write` broke 13 unrelated tests (RESOLVED)
The Phase-2 wrap-up ran `bunx biome check --write apps/extension/src packages/wallet-core/src` — biome's `useArrowFunction` "safe" fix rewrote `vi.fn(function () { return client })` constructor-mock factories into arrow functions across ~10 pre-existing test files. Vitest 4 cannot `new` an arrow implementation ("() => profileClient is not a constructor") — the exact pattern those files' own comments warn about. Symptom: 13 failures in `useFullBackupImport.test.ts` (and latent breakage in 9 other files) that pre-dated Phase 3 edits. Diagnosed by running the suite in a throwaway worktree at the branch base (green) → phase-1 (green) → phase-2 (red) → `git show --stat` exposed the collateral file list.
**Fixes:** reverted the 9 untouched files to base (`fix(tests): restore constructor-capable function mocks…`), restored the 11 factories in the composable test by hand.
**Rule going forward: NEVER run `biome check --write` broader than the files you authored in the change.** `bun run lint` treats `useArrowFunction` as a warning, so the repo baseline is fine — it's the `--write` that's destructive.

## Notes
- The composable test mocks spec modules shallowly (side-effect avoidance); the registry now imports `*_STORAGE_ROOT` from those specs, so the mocks were extended with the root constants. When adding registry-consumed exports to a spec, update these mocks.
- `buildBackup({ "compat-epoch": undefined })` works for the pre-baseline case because `JSON.stringify` drops `undefined` properties on both the builder and the composable side — checksum still matches.
