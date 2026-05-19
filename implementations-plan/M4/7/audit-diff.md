# M4.7 — audit-diff (post-dual-audit)

Date: 2026-04-26

## ⚠ Plan needs material reshape before execution

Codex flagged 3 BLOCKING design errors. M4.7 as written would clobber `ValueStorage` roots and not migrate session/IndexedDB at all.

## Codex BLOCKERS

1. **Version-key design clobbers ValueStorage roots (codex BLOCKING)**: `EntityStorage.getVersion()`/`setVersion()` (`entity_storage.ts:33-39`) read/write the BARE root key (`this.root`), not a sidecar. EntityStorage rows live at `${root}@id` so the bare root is unused. But `ValueStorage` uses the bare root for the value itself (`value-storage.ts:18-27`); calling `setVersion()` on `nulo:core:session` or `nulo:config` would overwrite the session/config payload. **Fix**: M4.7-a uses a backend-agnostic version-metadata adapter — bare-root versioning ONLY for EntityStorage-backed roots, explicit collection-level sidecar key for ValueStorage/IndexedDB. No per-record version field.
2. **Runner API can't migrate session/IndexedDB (codex BLOCKING)**: plan defines `migrateAll(area)` and wires to `browserApi.storage.local` (line 124-136), but inventory includes `chrome.storage.session` roots (line 46-52) AND IndexedDB (line 53-60). With the current interface, `nulo:core:session`, `nulo:journal`, and ALL IndexedDB migrations are out of scope. **Fix**: each registry entry carries its backend (`local` / `session` / `indexeddb`). Also: keep startup wiring in `wallet/runtime.ts` (where `runStorageMigration` lives today, line 96-99), NOT `wallet/index.ts`.
3. **Write fence not actually a shared mutex (codex BLOCKING)**: `MigratingStore` instantiates `new Lock("MigratingStore")` (line 148-159) but `MigrationRunner` separately says it acquires "the per-root lock" (line 120-123, 162-165). These are different objects. **Fix**: shared per-root lock registry injected into both runner and store factory. OR simplify to boot-only migrations and delete lazy migrate-on-read entirely (recommended: simpler).

## Plan agent BLOCKER

- **Stale-write race**: epoch counter needed alongside lock. Lock serializes but doesn't invalidate stale closures.

## Codex SHOULD-FIX

- Inventory: `nulo:core:session` listed in BOTH local (line 33) AND session storage (line 50). Code stores it ONLY in `chrome.storage.session` (`session-manager.ts:112-113`). Deduplicate.
- `nulo:core:tx-cursors` is in legacy KEYS_TO_WIPE but NOT instantiated. Add as explicit drop-on-migrate with test (or just remove from KEYS_TO_WIPE entirely — simpler).
- `nulo:core:session` lockedAt migration is NOT a required active M4.7 migration — M4.5 already made it forward-compat optional. Replace this item with: legacy tx-cursors cleanup + M4.10 PXE placeholder (the actual work).
- Cross-root ordering: M4.10 already depends on `nulo:core:networks` migrated before PXE rename. Don't defer ordering support; either add toposort to M4.7-a now OR explicitly state M4.10 owns that interface change.
- Drop `STORAGE_VERSION_KEY` in M4.7-d (only consumer is `runStorageMigration`).

## Plan agent SHOULD-FIX

- IndexedDB migrator type alongside `CollectionMigrator`. M4.10 placeholder needs it.
- Migration failure: `transaction(fn)` helper that batches `set()` calls and only flips version sidecar on commit. Otherwise idempotency is per-author + untestable.
- `(pxe-data)` line 59 conditional — settle before M4.7-d ships.

## Recommended execution-time absorption

1. **M4.7-a reshape** (the foundational PR):
   - Backend-aware migrator type: `{ backend: "local" | "session" | "indexeddb", root: string, fromVersion: number, toVersion: number, migrate: (...) => Promise<void> }`.
   - For `local`/`session`: callable signature `(area: StorageArea, root: string, helpers: { transaction(fn) })`.
   - For `indexeddb`: callable signature `(helpers: { all-profiles network reader, transaction(fn) })`.
   - Cross-root ordering: `after?: string[]` field on each step.
   - Shared per-root lock registry injected into runner + MigratingStore factory.
   - Boot-only migrations recommended; drop lazy migrate-on-read (simpler, fewer race surfaces).
   - Wire from `wallet/runtime.ts` (replaces `runStorageMigration` call at line 96-99).
2. **M4.7-b reshape**: drop separate `MigratingStore` lock; use runner's shared registry. Or, if boot-only, delete this PR entirely.
3. **Inventory cleanup**: `nulo:core:session` is session-storage only. `nulo:core:tx-cursors` is dead — just delete from KEYS_TO_WIPE.
4. **Active migrations** at M4.7-c: legacy `tx-cursors` cleanup + M4.10 IndexedDB rename placeholder.

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 (post-execution-time-revision) — major reshape. Recommend a planning-revision pass before M4.7-a opens.
