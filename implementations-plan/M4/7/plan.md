# M4.7 — Per-collection schema migrations (1-2w)

> **STATUS: DEFERRED until users exist** (2026-04-26 user decision — see `../DECISIONS.md`). Pre-launch the global wipe is fine; nothing to preserve. Re-open when production-launch is on the horizon. Audit found 3 BLOCKING design errors that require a v1 reshape before execution (backend-aware migrator, shared lock registry, cross-root ordering). See `audit-diff.md` for details.
>
> **Audit tier**: dual (codex xhigh + Plan agent).

## Context & entry state

Today storage schema migration is destructive + global. `packages/extension/src/wallet/storage/migrate.ts:13-15`:

```ts
const KEYS_TO_WIPE = ["nulo:core:accounts", "nulo:core:txs", "nulo:core:tx-cursors", "nulo:core:token-balances"]
const INDEXEDDB_WIPE_PREFIXES = ["pxe/"]
const INDEXEDDB_WIPE_NAMES = ["keyval-store"]
```

On any `STORAGE_VERSION_KEY` change, those 4 chrome.storage.local keys + every `pxe/*` IndexedDB are obliterated. Every other persisted collection (contacts, tokens, fpcs, networks, profiles, dapp sessions, auth registry, journal, configs, session, etc.) survives by accident. Future schema changes either repeat this destructive wipe (cumulating user pain) or require ad-hoc per-collection one-shot scripts that don't compose.

**Codex audit BLOCKING**: do NOT introduce a per-record `version` field. `EntityStorage` already has **collection-level** `getVersion()` / `setVersion()` (`packages/wallet-core/src/storage/entity_storage.ts:33-40`). M4.7 should:
- Inventory durable roots across the repo.
- Define collection-level migrators using the existing version sidecar.
- Specify a write fence so concurrent writers can't race a migrate-on-read.

**Plan agent audit BLOCKING**: write fence — per-collection mutex during migration. Re-use existing `Lock` primitive at `packages/wallet-core/src/utils/lock.ts`.

**Codex audit additional**: M4.7 is a HARD prerequisite for M4.10 (per-RPC PXE isolation needs migration registry to rename existing IndexedDB databases). Block M4.10 on M4.7.

### Inventory of durable storage roots (verified against `55f88a4`)

**`chrome.storage.local`** (persistent across browser restart):

| Root | Type | Owner | Notes |
|---|---|---|---|
| `nulo:core:profiles` | EntityStorage | `profile/repository.ts:45-46` | password+passkey credentials; profile metadata |
| `nulo:core:session` | ValueStorage | `profile/session-manager.ts:112-113` | session record (passhash + since); shape evolves with M4.5 (`lockedAt`) and M4.2 (post-passhash design) |
| `nulo:core:accounts` | EntityStorage | `account/service.ts:22` | account info per chain |
| `nulo:core:txs` | EntityStorage | `transaction/service.ts:36` | tx history records |
| `nulo:core:tokens` | EntityStorage | `token/service.ts:39` | token metadata |
| `nulo:core:token-balances` | EntityStorage | `token-balance/balance-repository.ts:21` | persisted balance snapshots |
| `nulo:core:contacts` | EntityStorage | `contact/service.ts:38-39` | address book |
| `nulo:core:dappSessions` | EntityStorage | `dapp-session/service.ts:29` | persisted dApp connections |
| `nulo:core:fpcs` | EntityStorage | `fpc/service.ts:34` | FPC discovery cache |
| `nulo:core:networks` | EntityStorage | `network/service.ts:25` | RPC endpoints + chain configs |
| `nulo:core:auth-registry` | EntityStorage | `auth-registry/service.ts:28` | authwit records |
| `nulo:core:auth-registry-enabled` | EntityStorage | `auth-registry/service.ts:29` | authwit feature flags per (chainId, address) |
| `nulo:config` | ValueStorage | `config/store.ts:10` | user config (privacy toggles, ttl, etc.) |

**`chrome.storage.session`** (cleared on browser exit):

| Root | Type | Owner | Notes |
|---|---|---|---|
| `nulo:core:session` | ValueStorage | session-manager.ts (also listed above; lives in session storage) | clears on browser exit, persists SW suspension |
| `nulo:journal` | EntityStorage | `operation-journal/service.ts:43-44` | M1.1 operation records |

**IndexedDB**:

| Pattern | Owner | Notes |
|---|---|---|
| `pxe/${profileId}/${chainId}` | aztec-runtime PXE (`chain-runtime.ts:78`) | per-chain note + state DB; M4.10 changes the key to include `${sha256(rpcUrl)}` |
| `keyval-store` | Aztec PXE upstream | shared across PXEs; cleaned up only when all PXE DBs gone (`pxe/service.ts:103-115`) |
| (`pxe-data`) | upstream PXE bundle | check at execution time; may emerge from upstream |

Total: **15 collections + 1-2 IndexedDB hierarchies**. M4.7 must handle all of them under one migrator pattern.

## Architecture invariants (preserved)

1. **Storage root names** — UNCHANGED. M4.7 introduces a per-collection `${root}@__version__` sidecar that EntityStorage already supports (`getVersion`/`setVersion`); no rename of existing rows.
2. **EntityStorage / ValueStorage public API** — UNCHANGED. M4.7 adds a wrapper (`MigratingStore`) that callers opt into; existing callers continue to work until migrated.
3. **`runStorageMigration` global wipe** — KEPT for one release as a safety net while per-collection migrators land. **REMOVED in Step 4 (final).**
4. **M2.6 vectors** — N/A.
5. **Lock primitive** (`Lock`) — unchanged. M4.7 adds per-collection lock instances; the primitive itself is fine.
6. **Storage-version key `nulo:core:storage-version`** — kept as a global "did we run anything new" flag during transition; removed after Step 4.

## Sub-step breakdown (4 PRs in series)

The 1-2w estimate covers all 4. Each PR is mergeable independently.

### M4.7-a — Migrator interface + registry (3-4d)

**New file**: `packages/wallet-core/src/storage/migrator.ts`

```ts
import type { MinimalStorageArea } from "./entity_storage"

/**
 * A migrator is a per-collection function from version N to version N+1.
 * The migrator reads ALL rows under the root via `area.get()` (mirrors
 * EntityStorage's getAll), produces a transformed batch, and writes it
 * back. It MUST NOT touch any other root.
 *
 * Migrators run inside a `Lock` keyed by the root, so concurrent reads
 * + writes against the same root from the rest of the SW are queued
 * until the migration completes.
 *
 * Returning an error rejects the migration; the runner restores the
 * pre-migration state by NOT advancing the version sidecar (next
 * startup will re-attempt). Migrators MUST be idempotent on partial
 * failure: if a migration fails halfway through, re-running it on the
 * partial state must still produce the correct vN+1 outcome.
 */
export type CollectionMigrator = (
  area: MinimalStorageArea,
  root: string,
) => Promise<void>

/** Per-collection migration registry. */
export interface MigrationStep {
  fromVersion: number
  toVersion: number
  migrate: CollectionMigrator
}

/** Map root → ordered list of MigrationSteps. */
export type MigrationRegistry = Record<string, MigrationStep[]>

export class MigrationRunner {
  constructor(
    private readonly registry: MigrationRegistry,
    private readonly logger: (msg: string) => void,
  ) {}

  /** Run all pending migrations for a single root. Acquires the
   *  per-root Lock; releases before returning. */
  public async migrate(root: string, area: MinimalStorageArea): Promise<void> { … }

  /** Run all pending migrations across the registry. Used at SW boot
   *  before services that depend on migrated data. */
  public async migrateAll(area: MinimalStorageArea): Promise<void> { … }
}
```

The runner uses `EntityStorage.getVersion(root)` to read the current version, walks `MigrationStep[]` filtering for `fromVersion === currentVersion`, runs each in order, and bumps the sidecar after each successful step.

**New file**: `packages/extension/src/wallet/storage/migration-registry.ts`

Initial registry: empty Record. Step 1 ships an EMPTY registry — just the runner + interface. Subsequent sub-PRs (M4.7-b/c/d) populate it.

**Wire-up**: `packages/extension/src/wallet/index.ts` (composition root) — call `migrationRunner.migrateAll(browserApi.storage.local)` at boot, BEFORE any service constructor that reads storage. This replaces the existing `runStorageMigration` call (kept in parallel for transition; see Step 4).

### M4.7-b — Per-collection write fence + lock primitive (2-3d)

**New file**: `packages/wallet-core/src/storage/migrating-store.ts`

A wrapper class that intercepts `EntityStorage` / `ValueStorage` operations and routes them through a per-root `Lock` while a migration is in progress. Used internally by services that opt into M4.7's contract.

```ts
import { Lock } from "@nulo/wallet-core/utils"
import type { MinimalStorageArea } from "./entity_storage"

export class MigratingStore implements MinimalStorageArea {
  private readonly lock = new Lock("MigratingStore")
  
  constructor(
    private readonly inner: MinimalStorageArea,
    private readonly root: string,
    private readonly migrationGate: () => Promise<void>,
  ) {}

  // Each delegates with `await this.migrationGate()` first, then await this.lock.enter() / leave()
  // … for get/set/remove …
}
```

**Lock semantics**:
- During migration: `MigrationRunner` calls `lock.enter()` for the root → all readers/writers queue.
- During normal ops: `MigrationRunner.migrationGate()` resolves immediately if the version sidecar matches expected.
- The `migrationGate` callback is supplied by the runner; it returns a settled promise once the per-root migration is complete (or never had any pending steps).

**Stale-write race fix**: a writer that started before migration must re-read after migration completes. Pattern: `set()` inside the lock acquires + checks the post-migration shape; if the writer has an old shape (e.g. it computed an entity in the vN format), the writer is responsible for re-running its computation against the vN+1 read. M4.7-b documents this constraint; no automatic translation.

(This is the part the audits hammered. Document the constraint clearly and provide a `withMigratingStore<T>(fn)` helper that wraps any read-modify-write into a lock-and-re-read pattern.)

**Tests** (in this sub-PR's test file `migrating-store.test.ts`):
1. Read during migration queues until migration completes (assert ordering via timestamps).
2. Write during migration queues, then writes against the migrated shape.
3. Concurrent read + write during migration: both block; both unblock in order.
4. Migration failure: lock released, sidecar NOT bumped, next call re-runs migration.

### M4.7-c — Migrate active collections one at a time (3-5d)

For each of the 15 collections + 2 IndexedDB hierarchies:
1. Identify the current shape.
2. Decide if a v0 → v1 transition is needed NOW (most are "v0 is current; no migration needed but register at v1 baseline so future steps have somewhere to land").
3. Wire the migrator into `migration-registry.ts`.
4. Switch the consuming service to `MigratingStore` (or just call `migrationRunner.migrate(root, area)` at service init).

For collections with no current schema change pending, the registry entry is empty for now — but the **scaffolding** is in place so future schema changes don't require re-introducing the migrator infrastructure.

**Required active migrations** at M4.7-c land:
- **`nulo:core:session`** — needs `lockedAt` field added by M4.5. M4.7-c ensures the migrator runs before SessionManager re-hydrates a pre-M4.5 session.
- **`pxe/${profileId}/${chainId}` IndexedDB → `pxe/${profileId}/${chainId}/${sha256(rpcUrl)}`** — this is M4.10's payload, but the migrator infrastructure is needed first. M4.7-c registers a placeholder; M4.10's PR populates the body.

Other migrations are baseline-only (vN === vN, no transformation).

**Deletion policy**: collections that are now redundant (e.g. tx-cursors, after the journal subsumes them — verify at execution time) get a "drop on migrate" entry: a vN → vN+1 migrator that calls `area.remove(root)` and clears the version sidecar.

### M4.7-d — Drop the global wipe (2-3d)

**Modified**: `packages/extension/src/wallet/storage/migrate.ts` — replaced with a thin call into `migrationRunner.migrateAll(...)`. The `KEYS_TO_WIPE` + `INDEXEDDB_WIPE_PREFIXES` arrays go away.

**Modified**: `packages/extension/src/wallet/index.ts` — removes the parallel call to the old `runStorageMigration`. Only the new runner runs at boot.

**Cleanup**: drop `STORAGE_VERSION_KEY = "nulo:core:storage-version"` (or repurpose as the "all collections at expected versions" sentinel via an aggregate check). Decide at execution time based on whether downstream code reads it.

## Test plan

**Migrator interface** (`packages/wallet-core/src/storage/migrator.test.ts`) — owned by M4.7-a:
1. Empty registry → `migrateAll` no-ops, no version bumps.
2. Single migrator vN → vN+1 runs and bumps the sidecar.
3. Chained migrators v0 → v1 → v2 run in order; partial failure stops at the failing step (sidecar at last successful version).
4. Re-run after partial failure: idempotent — picks up where it left off.

**MigratingStore** (`migrating-store.test.ts`) — owned by M4.7-b: 4 tests as above.

**Per-collection golden fixtures** (`packages/extension/src/wallet/services/*/migration.test.ts`) — owned by M4.7-c. ONE fixture per collection that has a real transformation. Per-codex audit: 10-14 tests across 6 collections × ~2 fixtures each (round-trip + partial) is the right level. **Do NOT** write a fixture for collections with empty migrator (no transformation to verify).

Specifically:
- `nulo:core:session` — golden fixture: pre-M4.5 session record (`since` only) + post-M4.5 (`lockedAt` added).
- `pxe/${profileId}/${chainId}` IndexedDB rename — owned by M4.10's plan; M4.7-c ships placeholder.
- Drop-on-migrate collections — fixture: pre-state has rows, post-state has none, sidecar bumped.

**NOT TESTED:**
- Full e2e of every collection (covered by smoke + network e2e).
- Performance (migration runs once at boot; small data sets — irrelevant unless benchmarks show otherwise).
- IndexedDB migration timing (covered by M4.10's tests).

**Existing tests to consider**:
- Any service test that touches storage may need to be aware of the migration runner. Most use `FakeBrowserApi` with empty state; migration will no-op. Verify per-service.
- The `migrate.test.ts` for the legacy `runStorageMigration` (if it exists) — DELETE after Step 4 (drops with the function).

## Verification commands

```bash
# Per sub-PR
bun run --filter '@nulo/wallet-core' test           # migrator + MigratingStore
bun run --filter '@nulo/extension' test             # per-collection migration tests
bun run typecheck:all
bun run test:all                                    # M2.6 unaffected
bun run check:imports
bun run build
```

Manual QA per sub-PR:
- M4.7-a: smoke (no migrations run; equivalent to today).
- M4.7-b: smoke; observe debug logs showing lock acquisition during migrate.
- M4.7-c: install on a fresh profile (clean slate); reload extension; observe migrations run on second boot. Repeat with a pre-M4.5 session record (manually inject).
- M4.7-d: full reload; observe only the new runner runs.

## Risks tracked

1. **Migration order**. Some migrations imply others (e.g. session shape change after profile shape change if both touch the same record). M4.7-a registry is per-root; cross-root ordering is implicit by `migrateAll` walk order. Document the ordering convention; if a future migration needs cross-root sequencing, add an `after: [otherRoot]` field to `MigrationStep`.
2. **Failed migration leaves the SW broken**. The runner doesn't auto-roll-back. Strategy: log + warn loudly, leave version sidecar at last-successful, don't advance — next boot retries. Document the "if the migration consistently fails, the user must manually clear data" escape hatch.
3. **IndexedDB migration in M4.7-c (PXE rename)** is async + can be slow. Block service init on it; show a "preparing storage…" UI if needed. M4.10 owns the actual rename; M4.7 just gives it the infrastructure.
4. **Lock contention during boot**. Migrations + service init both try to read storage. Pattern: services that opt into MigratingStore wait on the migrationGate; services not opted-in read pre-M4.7-style (no lock). Document; gradually migrate services in M4.7-c.
5. **`runStorageMigration` removal in M4.7-d**. Anyone depending on its destructive wipe (e.g. an upgrade test) needs to be re-anchored on M4.7's migrators. Search before deletion.
6. **Per-record vs per-collection** (codex BLOCKING): we are NOT introducing a per-record version field. The plan above commits to collection-level only. Documented to prevent regression.

## Rollback

Each sub-PR is a separate revert point. M4.7-d's removal of the global wipe is the riskiest — `git revert` restores it cleanly.

## Open questions / decision flags

1. **Cross-root ordering**: needed? Default to no; add the `after: []` field if M4.7-c uncovers a real case.
2. **`STORAGE_VERSION_KEY` sentinel**: keep or drop? Decide in M4.7-d after auditing readers.
3. **Boot-time UI for in-progress migration**: most migrations are <1s. UI cost vs benefit decided at execution time; default off.
4. **Drop-on-migrate for tx-cursors**: pending verification at M4.7-c whether the journal really subsumes it (M1.1 introduced the journal — re-grep at execution).
