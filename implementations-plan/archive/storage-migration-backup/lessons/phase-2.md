# Phase 2 — finite DSL + BackupMigrator + guardrails — lessons

**Status: ✓ complete.** Gate: backup module tests 48 pass (`backup-migrator.test.ts` + `footprint-coverage.test.ts` + registry), engine regression `migrator.test.ts` 41 pass, `bun run typecheck` exit 0, `bun run lint` exit 0.

## What was built
- `row-map-migration.ts` — `defineRowMapMigration` (finite data-only DSL: `rename`/`drop`/`retype`/`remapValues`/`addDefault`, fixed clause order, per-row interpreter `applyRowTransform`), WeakSet brand + deep-freeze (`isBackupSafeMigration` requires both), `rowMapDefOf` accessor (WeakMap) so guardrail tests derive samples from the declared transform without widening `Migration`.
- `backup-migrator.ts` — `migrateBackupData`: version guards → normalize → fail-closed preflight (backup-safe brand, blocked roots, registry coverage, absent-required reads) → scratch `MemoryStorageArea` seeded in live format + `nulo:schema:version` → REAL `Migrator` → denormalize. Result union `noop|migrated|incompatible|failed`.
- `MemoryStorageArea` promoted into `wallet-core/storage` (engine test's `MemStore` now extends it with fault injection — one impl, as the plan required).
- `backupMigrations` array in `migrations/index.ts` + declarative e2e backup fixture (`src/e2e/backup-migration-fixture.ts`, v9001, contact `legacyName→name`, `@__PURE__` + stamp-gated like the live fixture; marker const `nulo:e2e:backup-mig-fixture` for the prod-bundle negative grep — grep wiring is Phase 5).
- `template.ts` — hostile-input standing rule + backup-safe-form-first guidance + `defineRowMapMigration` example.

## Design decisions (flag for post-impl codex audit)
- **`valueMaps` added to the DSL** (not in the plan's clause list): the plan's own motivating case — the config KEY-RENAME `runtime.ts` anticipates — is a ValueStorage transform, inexpressible with `rowMaps` alone. Same finite data clauses applied to the single stored object; absent value stays absent (never fabricated). Still zero author functions; row-locality is trivial (one value).
- **Non-idempotent declarations rejected at define time**: rename chains (`a→b,b→c`), remap chains (`x→y` where `y` is also a table key) — the engine's run-twice contract would otherwise break silently.
- **remapValues matches by `String(value)`** for string/number/boolean only; non-primitives never match. Deterministic, documented in the type.
- **Metamorphic guardrail derives its sample rows from the transform's own declaration** (every clause exercised) and runs subset × permutation × duplication through the REAL engine, asserting byte-identical per-row output. `IMPORT_BLOCKING_ACK` set in `footprint-coverage.test.ts` is the explicit-release-decision chokepoint for any migration that blocks import.
- **Engine untouched** — only export-surface additions to wallet-core: `SCHEMA_RESERVED_PREFIX` (phase 1), `MemoryStorageArea` (this phase). `Migrator` logic byte-identical.

## Gotchas
- `needs-recovery` is unreachable from a fresh scratch store (no journal/marker to corrupt — attacker input can't seed `nulo:schema:*` keys because normalize builds keys from registry roots + validated ids). The reject mapping is still pinned via engine-`failed` (breaking AND non-breaking both reject).
- `test.each` with a Migration in the args: pass `[description, m]` pairs — vitest printf-formats the first element.
