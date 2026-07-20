# Rabby Migration Architecture — Research Findings

Reference research for Nulo's storage-migration framework design. Rabby repo read-only; all paths below are repo-relative to the Rabby root.

---

## 1. Registry + Engine

**Files:** `src/migrations/migrations.ts`, `src/migrations/index.ts`

### How migrations are registered

`migrations.ts` is a flat barrel file — every named migration is simply re-exported by name:

```ts
// src/migrations/migrations.ts
export { default as customTokenMigration }    from './customTokenMigration';
export { default as daiChainMigration }       from './daiChainMigration';
export { default as contactBookMigration }    from './contactBookMigration';
// ... 8 more named exports
```

The migration engine (`src/migrations/index.ts:15-17`) collects the exports, sorts them by their numeric `version` field, and uses that sorted array as the execution plan:

```ts
const sortedMigrations = Object.values(migrations).sort((a, b) => a.version - b.version);
```

### Global version counter, not per-store

There is a single integer `dataVersion` stored as a key in `chrome.storage.local` (`src/migrations/index.ts:21`). On boot the engine reads it, identifies which sorted migrations have a `version` greater than the stored value, and runs only those in ascending order. After all pending migrations run, `dataVersion` is updated to the highest migration number that executed.

```ts
const currentDataVersion = (await storage.get('dataVersion')) || 0;
// ...
if (migration.version > currentDataVersion) {
  const migrationResult = await migration.migrator(result);
  result = Object.assign({}, result, migrationResult);
  dataVersion = migration.version;   // advances step by step
}
// ...
await storage.set('dataVersion', dataVersion);   // committed at the end
```

**Key invariant:** version numbers are integers assigned manually per migration. The name is cosmetic; the version integer is the only ordering key. Names live in `migrations.ts` export aliases, NOT in the engine. The engine is purely version-number-ordered.

### Early-exit guard

```ts
// src/migrations/index.ts:24-29
if (
  sortedMigrations.length <= 0 ||
  currentDataVersion > sortedMigrations[sortedMigrations.length - 1].version
) {
  return;
}
```

New installs (`dataVersion == 0`) run ALL migrations in order. Already-migrated installs where `dataVersion` equals the max version skip the entire function body.

### Observed version sequence

| Version | Export name                    | Concern                                  |
|---------|--------------------------------|------------------------------------------|
| 1       | customTokenMigration           | Token ID format: bare address → chain:addr |
| 2       | daiChainMigration              | Rename DAI chain enum → GNOSIS           |
| 3       | connectedSiteMigration         | Add `isConnected: true` to site records  |
| 4       | contactBookMigration           | Split `alianNames` out of preference into contactBook |
| 5       | customRPCMigration             | RPC value: `string` → `{url, enable}`   |
| 6       | customizedTokenMigration       | Build cross-account token dedup list     |
| 7       | localeMigration                | Normalize locale codes (jp→ja, _ →-)   |
| 8       | metamaskModeSiteMigration      | Wipe a deprecated `isMetamaskMode` field |
| 9       | siteAccountMigration           | Backfill `account` onto connected sites  |
| 10      | siteAccountMigrationEmpty      | Revert that backfill (bug correction)    |
| 11      | userDataTrackingOptOutMigration| Seed new `userDataTrackingOptOut: false` |

Versions 9 and 10 are noteworthy: a botched migration was immediately followed by a corrective one rather than amending v9. This means the numbered model forces forward-only remediation — you cannot retract a shipped migration.

---

## 2. Migration Anatomy

### Shape (all migrations follow this contract)

```ts
export default {
  version: <integer>,
  async migrator(data: { <storeKey>: StoreType | undefined; ... }): Promise<typeof data | undefined> {
    try {
      // guard: if the relevant slice is missing, return undefined or data unchanged
      if (!data.rpc) return undefined;
      // transform
      return { <storeKey>: newValue };
    } catch (e) {
      // fallback: return data unchanged OR return a safe default
      return data;
    }
  },
};
```

### State received: the whole merged snapshot, not a single store

`src/migrations/index.ts:31-35` loads a fixed set of storage keys into a single `result` object before running any migration:

```ts
const KEYS = ['chains','contactBook','pageStateCache','permission','preference','transactions','txHistory','rpc'];
for (let i = 0; i < KEYS.length; i++) {
  const d = await storage.get(KEYS[i]);
  result = Object.assign({}, result, { [key]: d });
}
```

Every migrator receives this full snapshot as `data`. Each migration destructures only the slices it cares about. The engine merges the migrator's return value back into the running snapshot before the next migration runs, so later migrations see the output of earlier ones.

### Key design choices in migrations

**Type-annotated inputs.** Migrators accept typed inputs (importing the service's `Store` interface), which gives precise TypeScript inference on the slice shape. The "old shape" is either inferred from the import or declared inline as a local `interface PrevStore { ... }`:

```ts
// src/migrations/customRPCMigration.ts:3-5
interface PrevStore {
  customRPC: Record<string, string>;  // old: plain URL string
}
export default {
  version: 5,
  async migrator(data: { rpc: PrevStore | undefined }) { ... }
}
```

**Null/partial guards are the caller's responsibility.** Every migrator has an explicit guard at the top: if the relevant slice is `undefined` or missing the expected fields, it either returns `undefined` (signaling "nothing to do") or returns `data` unchanged. The engine does not provide this check — each migration owns it.

**Idempotency via field presence checks.** `connectedSiteMigration.ts:8-10` checks for the field before writing it:

```ts
const hasIsConnected = data.permission.dumpCache.every(cache => 'isConnected' in cache.v);
if (hasIsConnected) return data;  // already migrated, skip
```

Most migrations are NOT explicitly idempotent — they rely on the version gate preventing re-runs, not on the transform being safe to apply twice. The `connectedSiteMigration` check is an outlier written because the author was uncertain the version was already gated.

**Cross-store migrations exist.** `contactBookMigration.ts` (v4) reads from BOTH `preference.alianNames` and `contactBook` and writes to both output slices. The merged-snapshot design makes cross-store operations as cheap as single-store ones.

**Side-effect migrations exist (v1 only).** `customTokenMigration.ts:22-26` calls a live API (`openapiService.searchToken`) to resolve token IDs. It uses a `_mockData` second parameter as a seam for testing. This pattern is the exception; all other migrations are pure transforms.

---

## 3. Per-Store Persistence + Versioning

### createPersistStore

`src/background/utils/persistStore.ts` is a thin abstraction over `chrome.storage.local`. The function signature:

```ts
createPersistStore<T extends object>({
  name: string,       // the chrome.storage.local key
  template?: T,       // default value for fresh installs
  fromStorage?: boolean,  // default true
}): Promise<T>
```

It hydrates the named key from storage, merges it over the template with `Object.assign({}, template, storageCache)`, and returns a `Proxy` that auto-writes to storage on every property set or delete. There is no in-proxy debounce; every assignment triggers a `storage.set` synchronously.

### No per-store versions

Services do NOT carry their own version numbers or migration hooks. The `createPersistStore` call has no `version` or `migrate` parameter. There is exactly one global version counter (`dataVersion`) in the migration engine.

Services are completely agnostic to migration: they `init()` after `migrateData()` completes, read the (already-migrated) storage key, and proceed. A representative service init:

```ts
// src/background/service/permission.ts:45-49
init = async () => {
  const storage = await createPersistStore<PermissionStore>({ name: 'permission' });
  this.store = storage || this.store;
  // ... post-load cleanup
};
```

```ts
// src/background/service/preference.ts:206-208
this.store = await createPersistStore<PreferenceStore>({
  name: 'preference',
  template: { ... }  // new-install defaults
});
```

### Forward-compatibility via template merging

`createPersistStore` merges the stored value OVER the template with `Object.assign({}, template, storageCache)`. This means new fields added to the template appear on fresh installs, but are NOT automatically backfilled for existing users — that backfilling is what a migration must do. `userDataTrackingOptOutMigration.ts` (v11) illustrates this: it exists solely to add a new field to `preference` for existing users.

---

## 4. Startup Wiring

```
src/background/index.ts → restoreAppState():
  1. keyringService.loadStore()    // keyring bypasses migration (encrypted, managed separately)
  2. openapiService.init()         // openapi also bypasses migration
  3. migrateData()                 // ← runs ALL pending migrations against chrome.storage.local
  4. permissionService.init()      // reads the now-migrated 'permission' key
  5. preferenceService.init()      // reads the now-migrated 'preference' key
  6. ... all other services .init()
```

Citation: `src/background/index.ts:105-141`.

**Implications:**

- `migrateData()` runs before any service `init()`. The services always see already-migrated data.
- The keyring is explicitly excluded from migration (`// Init keyring and openapi first since this two service will not be migrated` — `index.ts:112`). Its state is separately managed and encrypted.
- `migrateData()` is a one-shot async function. There is no re-running of migrations mid-session.
- On fresh install, `dataVersion` is `0` and ALL migrations run before the first service init.

---

## 5. Error Handling / Safety

### Per-migration try/catch: swallow, not throw

Every migration wraps its body in `try { ... } catch (e) { return data; }`. On error, the migration silently returns the original (unmodified) data slice. The global version counter still advances past that version — the errored migration is NOT retried on the next boot.

**There is no global error boundary in the engine.** If a migration throws OUTSIDE its try/catch (e.g., the async boundary before the try block), the error propagates up to `restoreAppState()`. Inspecting `index.ts`, there is no try/catch wrapping the `migrateData()` call — an uncaught migration error would crash the background service worker startup.

### No backup / rollback

There is no snapshot taken before running migrations. The writes happen piecemeal during the migration loop (`storage.set` per key at `index.ts:45-47`), and `dataVersion` is committed at `index.ts:48` only after all keys are written. A crash mid-loop leaves a partial state with no recovery path. The per-migration catch-and-continue pattern is the entire safety net.

### Idempotency: mostly not guaranteed

Migrations rely on the version gate to prevent re-runs. Only `connectedSiteMigration.ts` (v3) has an explicit idempotency check. If a migration runs twice (e.g., due to a storage write race or a version counter rollback from a Chrome bug), most migrations would re-apply the transform and could corrupt data.

---

## 6. Testing

### Migration tests exist and are isolated unit tests

Location: `__tests__/migration/` — one test file per migration.

Pattern observed across all test files:
- `@jest-environment jsdom` (chrome extension env)
- Import the migration module directly
- Construct a complete in-memory snapshot of the relevant store slices as a plain object
- Call `migration.migrator(data)` and assert on the returned object

```ts
// __tests__/migration/rpcMigration.test.ts
const data = { rpc: { customRPC: { BSC: 'https://rpc.bsc.com/bsc' } } };
test('should migrate data', () => {
  return rpcMigration.migrator(data).then((result) => {
    expect(result!.rpc).toEqual({ customRPC: { BSC: { url: 'https://rpc.bsc.com/bsc', enable: true } } });
  });
});
```

### Fixture patterns

- Fixtures are inline object literals, not external JSON files.
- Tests cover: the happy path, "new user" (all slices `undefined`), and edge cases (empty collections, partial data).
- `customTokenMigration.test.ts` passes `_mockData` as the second argument to bypass the live API call — the migration has an explicit `process.env.NODE_ENV === 'test'` branch for this.
- No snapshot or golden-file testing; all assertions are explicit `.toEqual`.

### No integration test for the engine itself

There is no test for `src/migrations/index.ts` — the orchestrator that reads `dataVersion`, chains migrations, and writes back to storage. The only coverage is per-migration unit tests. The version-ordering logic and the write-back behavior are untested at the integration level.

---

## 7. Top 5 Architectural Lessons

### Lesson 1: Named + numbered is a false dichotomy

Rabby's migrations are "named" only in the export alias (`contactBookMigration`, etc.) and the filename. The engine orders and gates them purely by `version: integer`. The name is documentation, not an execution key. The key insight: **names convey intent for humans; the integer conveys ordering for the machine.** A pure named/hash system (as in some ORMs) would require an external ordering mechanism anyway.

**For Nulo:** adopt both — a human-readable name AND a monotonic integer. The integer is the source of truth for ordering; the name is the self-documenting label. Avoid pure-name hashing (non-deterministic alphabetical ordering is a footgun).

### Lesson 2: The merged snapshot model is powerful but fragile

Loading ALL store keys into one object before running any migration allows cross-store operations for free (`contactBookMigration` reads two stores and writes two stores). But:
- The `KEYS` array at `index.ts:4-13` must be manually maintained. Add a new store and forget to add it to `KEYS`, and no migration will ever see that store's data.
- The model couples all migrations to a single pass over a single storage backend.

**For Nulo:** with three backends (chrome.storage.local, chrome.storage.session, IndexedDB), a single merged snapshot is impractical. The architecture should be backend-scoped: a migration declares which backend(s) it reads from, and the engine dispatches to per-backend loaders. Cross-backend migrations need explicit plumbing.

### Lesson 3: Forward-only remediation is mandatory, and version 9→10 proves it hurts

A bad migration (v9 added an `account` field to site records; v10 removed it a commit later) must be corrected by shipping another migration forward. You cannot retract v9. This means the migration list can accumulate compensating pairs, and the migration count grows monotonically even for mistakes.

**For Nulo:** accept this invariant, but enforce it structurally. Consider a lint rule or CI check that verifies no migration `version` in `migrations.ts` is ever removed or renumbered (only new ones appended). This prevents the silent breakage where removing a migration re-runs the next one against already-migrated data.

### Lesson 4: Per-migration catch-and-continue is a data-loss risk

Every Rabby migration silently swallows its own error and returns `data` unchanged. The upside: a single bad migration doesn't crash startup. The downside: the version counter advances past the failed migration, which is now permanently skipped, and there is no alert, no log to surface, and no user notification.

For transforms that add new fields (additive), this is acceptable — the field is just missing for that user. For transforms that rename or restructure existing data, a silent failure can leave the store in a hybrid state that later service code does not expect.

**For Nulo:** distinguish migration severity. Additive/backfill migrations (adding a field) can use catch-and-continue. Destructive/rename migrations (changing key names, restructuring records) should emit a tracked error and potentially refuse to advance the version counter, forcing a retry.

### Lesson 5: No per-store version means no independent store evolution

Because there is one global `dataVersion`, ALL stores are coupled to the same migration timeline. If two teams independently evolve two stores, their migrations must be serialized into the same integer sequence. There is no way to say "contactBook is at schema v3, permission is at schema v5" — the stores' schemas are only understandable relative to the global migration number.

**For Nulo's many-collection model:** this coupling will become painful. With independent per-record collections in IndexedDB (accounts, notes, interactions, etc.), a schema change to the `accounts` collection should not force a migration run for the `notes` collection. Consider a per-store or per-collection version property stored alongside the data (`__schemaVersion`), with per-store migration lists and a global engine that dispatches to per-store runners. The global version can still exist as "the highest store version across all stores" for the fast-exit guard.

---

## MetaMask vs Rabby Contrast

| Dimension | MetaMask | Rabby |
|-----------|----------|-------|
| Migration ID | Monotonic integer only (`migration-NNN.js`) | Integer (ordering) + name (documentation) |
| File naming | `migration-001.js`, `migration-002.js` ... | `contactBookMigration.ts`, one concern per file |
| Ordering enforcement | Filename order + array index | `version` field + runtime sort |
| State scope | Full MetaMask state object | Fixed-KEYS snapshot loaded per run |
| Per-store versions | No — global migration number | No — same global `dataVersion` |
| Migration function | `(state) => state` — pure transform, full state | `(data) => partialData` — transform returns only modified keys |
| Cross-store mutations | Natural (has whole state) | Supported (has merged snapshot) |
| Error handling | Re-throw or migrate-or-die | Per-migration catch-and-continue, no global boundary |
| Rollback | None | None |
| Testing | Unit tests with state fixtures | Unit tests with inline fixtures; dedicated `__tests__/migration/` dir |
| Test coverage of engine | Yes (MetaMask has integration tests for the runner) | No (Rabby engine is untested) |
| New-field backfill | Explicit migration required | Explicit migration required (template merge only covers new installs) |
| Idempotency | Not guaranteed (relies on version gate) | Not guaranteed; `connectedSiteMigration` is the one exception |

**The core philosophical difference:** MetaMask treats a migration as "one step in an ordered pipeline applied to the whole state." Rabby treats it as "a named, self-describing transform for a specific concern, ordered by a version tag." Rabby's approach produces files with meaningful names and narrow type signatures — `customRPCMigration.ts:9` declares `data: { rpc: PrevStore | undefined }`, not `data: WholeState`. This makes each migration independently readable and independently testable without understanding the whole state shape. MetaMask's approach gives the migration more power (it can read and write anything) at the cost of coupling every migration to the full state type.

For Nulo — which has many independent per-record collections across three backends — the Rabby per-concern naming is the right instinct, but neither model's single-pass engine fits. The right design is likely: per-collection migration lists, each with their own version counter, dispatched by a per-backend engine that knows how to load and write each collection type (chrome.storage rows vs IndexedDB records vs session entries).
