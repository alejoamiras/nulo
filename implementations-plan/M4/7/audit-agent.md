# M4.7 — Plan agent audit

Date: 2026-04-26

**BLOCKING**
- Stale-write race: `withMigratingStore<T>(fn)` lock-and-re-read helper documents the constraint (line 169) but only commits to "documenting" — no contract enforcement. **Fix**: runner exposes per-root **epoch counter**; `withMigratingStore` captures epoch at read, asserts unchanged at write, force-fails if migration intervened. Lock alone is insufficient — it serializes but doesn't invalidate stale closures.

**SHOULD-FIX**
- Inventory: `nulo:core:tx-cursors` is in legacy `KEYS_TO_WIPE` but NOT instantiated in master. No live writer. Plan's "drop-on-migrate" entry would be no-op. Just remove from `KEYS_TO_WIPE` without registering migrator (saves a fixture). Verify before deletion.
- M4.10 dependency: migrator interface at line 102 is `(area: MinimalStorageArea, root: string) => Promise<void>`. **IndexedDB is not a `MinimalStorageArea`.** M4.7-a should ship a separate IndexedDB migrator type alongside `CollectionMigrator` so M4.10 doesn't have to extend the registry shape.
- Migration failure handling: "Re-running on partial state must produce vN+1" (line 96-98) puts the burden on each migrator author. **Fix**: migrator interface receives a `transaction(fn)` helper that batches `set()` calls and only flips the version sidecar on commit. Without it, idempotency is per-author and untestable.
- `(pxe-data)` line 59 is conditional — settle BEFORE M4.7-d ships.

**NIT**
- Cross-root ordering OK for M4.7-c's actual migrations (`nulo:core:session` independent + IndexedDB rename in different store). Add `after: []` only if first cross-root migration appears.
- 4+4+10-14 test count right level.
- STORAGE_VERSION_KEY: only read inside `migrate.ts` itself. Safe to drop in M4.7-d. Deferring fine.
- tx-cursors confirmed missing in master.
