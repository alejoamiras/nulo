# MetaMask Migration Architecture — Research Notes

Reference doc for designing Nulo's storage-migration system. All citations point into the `metamask-extension` repo read at HEAD ~2026-07.

---

## 1. Engine: How the Migrator works

**File:** `app/scripts/lib/migrator/index.js`

The `Migrator` class (extends `EventEmitter`) is constructed with a flat array of migration objects. Constructor sorts them ascending by `version` and derives `defaultVersion` from the highest entry.

```js
// index.js:28
this.migrations = migrations.sort((a, b) => a.version - b.version);
```

**Version comparison** — `migrateData()` walks migrations in sorted order and skips any whose `version <= state.meta.version`:

```js
// index.js:134-136
function migrationIsPending(migration) {
  return migration.version > state.meta.version;
}
```

**Persistence of version** — each migration is responsible for bumping `versionedData.meta.version = version` inside its own `migrate()`. The engine validates this after each run (`assertValidShape`, index.js:144-156). No centralised version bump.

**Two protocol generations** (split at `MIGRATION_V2_START_VERSION = 186`, index.js:18):
- **Pre-186 (legacy):** migrations receive state, return a new cloned object. Engine replaces `state` with the return value.
- **Post-186 (v2):** engine does a `structuredClone` first, then calls `migrate(migratedData, localChangedControllers)`. Migrations mutate in place and track which controller keys they touched. Returning any value throws.

---

## 2. State model

**Type definition:** `shared/lib/stores/base-store.ts`

```ts
type MetaMaskStorageStructure = {
  data?: MetaMaskStateType;   // Record<string, unknown> — keyed by controller name
  meta?: MetaData;            // { version: number; storageKind?: 'data' | 'split' }
};
```

The state is a **monolithic blob keyed by controller name** — `data.AccountsController`, `data.NetworkController`, etc. One version number governs the entire blob.

**Storage kinds** (split at runtime by `storageKind` in meta):
- `'data'` (legacy): entire `{ data, meta }` written as one `chrome.storage.local.set({ data, meta })` call.
- `'split'` (current): each top-level controller key is its own `chrome.storage.local` entry, tracked via an explicit manifest array. `ExtensionStore.get()` reads the manifest, then fetches only those keys. Writes via `setKeyValues(Map<key, value>)` are per-key. `meta` itself is stored as a separate key.

**Load path** (background.js:1085-1115):

```
persistenceManager.get({ validateVault: true })
→ ExtensionStore.get()
→ browser.storage.local.get(['manifest'])
→ if manifest exists: get each key individually
→ else: get(['data', 'meta'])  // legacy monolith fallback
```

**Write path** — only changed keys are written in split mode (background.js:1251-1263):

```js
for (const key of changedKeys) {
  persistenceManager.update(key, versionedData.data[key]);
}
await persistenceManager.persist(); // batches into one setKeyValues call
```

**Scalability concern**: a single global `version` number serialises all schema changes. Migrating a new controller's schema requires bumping the global version even if 200 other controllers are untouched. In split-storage mode the write overhead is contained (only changed keys land in storage), but the migration engine still runs all pending migrations sequentially over the full materialized state object.

---

## 3. Migration anatomy

**Type:** `app/scripts/migrations/types.ts`

```ts
export type Migrate = (
  versionedData: Required<MetaMaskStorageStructure>,
  changedKeys: ChangedKeys,   // Set<string>
) => void | Promise<void>;
```

**Template pattern** (`app/scripts/migrations/template.ts`):
1. Set `versionedData.meta.version = version` unconditionally (first line, before any guard).
2. Read `versionedData.data` as `Record<string, unknown>`.
3. Call a `transformState(data, changedKeys)` helper.
4. Add touched controller names to `changedKeys`.

**Defensive patterns** (exemplified in migrations 208, 210, 215):
- Always guard with `hasProperty(data, 'ControllerKey') && isObject(data.ControllerKey)` before reading nested state. Return early if the expected structure isn't there.
- Use `??=` or conditional `if (!hasProperty)` to create missing sub-maps rather than crashing.
- Use `readPath(root, [...keys])` (215.ts:427-434) to safely traverse nested paths with `undefined` fallback at any missing step.
- Never assume array shapes: check `Array.isArray` before iterating.

**Cloning discipline**:
- Pre-186 migrations: `cloneDeep(originalVersionedData)` at the top of `migrate()`, return the clone. (See `002.js:9`, `180.ts:28`.)
- Post-186 migrations: the engine does a `structuredClone(state)` before calling `migrate()` (index.js:67). The migration mutates in place — no per-migration clone needed.

**Example — field removal** (208.ts): iterates an array of obsolete property names, calls `delete controller[property]` for each one that `hasProperty` finds. Sets `changedControllers.add('AppStateController')` only if something was actually deleted.

**Example — field addition / controller creation** (212.ts): checks `if (!hasProperty(data, 'AnalyticsController'))` and only then constructs the new controller object and sets `data.AnalyticsController = { analyticsId, optedIn }`. Adds to `changedControllers` only if a write occurred.

**Example — healing / fill-gap** (215.ts): uses `??=` (`ac.assetsInfo[assetId] ??= info`) so the write is idempotent and never overwrites existing data. Any error inside the `try` block is caught, sent to Sentry, and swallowed — the version bump already happened before the `try`, so the migration does not re-run on next startup even if the healing step failed.

---

## 4. Error handling and safety

**Throw semantics** (index.js:99-109):

When a migration throws, the engine:
1. Wraps the error in an `AggregateError` with context (`MetaMask Migration Error #N`).
2. **Emits** the error rather than throwing it: `this.emit('error', aggregateError)`.
3. `break`s out of the migration loop — all subsequent migrations are skipped.
4. Returns the state **as it was before the failing migration**.

The caller (`background.js:1098-1108`) listens on `migrator.on('error', ...)` and sends the error to Sentry with the vault structure (keys only, no secrets). The extension continues booting with partially-migrated state.

**No rollback.** The pre-migration data is loaded and passed in; if a migration throws the loop stops and the last good state is used. There is no snapshot saved to restore from, and the version in meta has NOT been bumped for the failed migration, so it will re-run on next boot.

**Individual migration error handling** (pattern in 215.ts:117-123): many migrations wrap their logic in `try/catch`, call `captureException` to Sentry, and swallow the error — but critically, they bump the version unconditionally before the `try`. This means a failed migration is NOT retried — it's marked done. The state may be partially healed. This is a deliberate trade-off: retry-on-error could cause an infinite boot loop.

**IndexedDB backup** (`shared/lib/stores/persistence-manager.ts:21-28`): A separate `IndexedDB` database (`metamask-backup`) mirrors a small subset of critical keys: `KeyringController`, `AppMetadataController`, `MetaMetricsController`, `AnalyticsController`. On `get()` with `validateVault: true`, if the vault is missing from `chrome.storage.local`, the engine tries the backup and emits `vaultCorruptionDetected`. There is no general-purpose pre-migration snapshot; the backup is security-focused, not migration-focused.

**Write lock** — `navigator.locks.request(STATE_LOCK, { mode: 'exclusive' })` serializes all writes. Aborts in-flight writes if a newer one arrives.

---

## 5. Testing

**Pattern** (from 208.test.ts, 215.test.ts):
- Build `oldStorage = { meta: { version: OLD_VERSION }, data: { ... } }`.
- `cloneDeep(oldStorage)` before calling `await migrate(vd, changedKeys)`.
- Assert on `vd` after: exact shape via `toStrictEqual`, changed keys via `expect(changedKeys).toContain(...)`.
- One test always asserts `vd.meta.version === VERSION` regardless of data path.

**Error / missing-data paths** are tested explicitly:
- 215.test.ts:383-405 — `AssetsController` absent → no-op, version still bumped.
- 215.test.ts:443-457 — a thrown error inside `migrate` is resolved (not rejected) and Sentry is called.
- 215.test.ts:271-302 — hidden tokens are skipped.

**Fixture discipline**: fixtures are built via helper functions (`buildBaseStorage`, `buildWipedFlareStorage`) rather than large inline objects. Overrides allow per-test variation.

**CI enforcement** (migrator/index.test.js:55-70): a test reads the filesystem and asserts every migration file has a corresponding `.test.` file (for migrations ≥ 33).

---

## 6. Versioning discipline

**No squash, no deletion.** Every migration from `002.js` to `215.ts` is still present and exported from `app/scripts/migrations/index.js`. There is no baseline/squash mechanism.

**Old versions**: a user on any version from 2 onward runs all pending migrations in sequence. The first-boot path sets version to `defaultVersion` (the highest migration number), so brand-new installs skip all migrations. Pre-155 users without a stored version get `meta.version = 155` injected as a fallback (`background.js:1081`) — effectively treating them as if they completed migration 155 even if their state predates it.

**Continuity constraint**: because all migrations chain, every migration must be defensive about fields that may not exist (they might be running on state from 5 years ago). The `hasProperty / isObject` guard pattern is non-negotiable.

---

## 7. Backend abstraction

The migrator itself is **pure**: it receives a `{ data, meta }` POJO and returns one. It has no storage dependency.

**Storage stack:**

```
Migrator (pure — plain object in/out)
    ↓ receives versionedData from / passes to ↓
PersistenceManager  (shared/lib/stores/persistence-manager.ts)
    - owns the write lock (navigator.locks)
    - owns the IndexedDB backup
    - owns the split-vs-data routing
    - owns the storageKind tag
    ↓ delegates raw I/O to ↓
ExtensionStore (BaseStore impl)  (shared/lib/stores/extension-store.ts)
    - chrome.storage.local via webextension-polyfill
    - maintains an in-memory manifest set for split-key tracking
    - implements: get(), set(), setKeyValues(Map), reset()
```

**`BaseStore` interface** (`shared/lib/stores/base-store.ts`):
```ts
type BaseStore = {
  setKeyValues: (pairs: Map<string, unknown>) => Promise<void>;
  set: (state: Required<MetaMaskStorageStructure>) => Promise<void>;
  get: () => Promise<MetaMaskStorageStructure | null>;
  reset: () => Promise<void>;
};
```

The `BrowserStorageAdapter` (`shared/lib/stores/browser-storage-adapter.ts`) is an orthogonal storage layer used by `@metamask/storage-service` for per-controller fine-grained storage; it is NOT part of the migration pipeline. Keys are namespaced `storageService:{namespace}:{key}`.

---

## 8. Architectural lessons

### Top 5 to steal

1. **Emit-don't-throw on migration error.** The `EventEmitter` pattern lets the engine continue booting with the last good state rather than crashing to a blank wallet. Combined with Sentry telemetry, failures surface without destroying the user session.

2. **Pure migrator, side-effectful persistence layer.** The migrator knows nothing about storage. It receives a POJO, returns a POJO. Storage concerns (write locking, backup, split-key tracking) live in `PersistenceManager`. This makes migrations trivially unit-testable and the storage layer independently replaceable.

3. **`changedKeys` set for minimal writes.** Migrations declare exactly which top-level keys they modified. The persistence layer only writes those keys to storage. This is what makes large state manageable in split-storage mode — an unrelated controller write costs nothing.

4. **Version bump before try/catch.** Swallowing a migration error is the right call to avoid boot loops. But bumping the version unconditionally before the `try` (so the migration is not re-run even on error) must be a deliberate, explicit pattern — it needs to be part of the template.

5. **`hasProperty / isObject` guard + early-return everywhere.** Migrations run on data shaped by earlier code paths that may not exist or may have been corrupted. Every field access is guarded. The template enforces this by routing all actual work through a `transformState` function that receives `data` typed as `Record<string, unknown>`.

### What won't map to a three-backend wallet

1. **Single global version over ONE storage backend.** MetaMask's `meta.version` is a single integer governing a single materialized state object read from one backend (`chrome.storage.local`). Nulo has three independent backends: `chrome.storage.local` (value rows), `chrome.storage.session` (session cache), and IndexedDB (large blobs). A single global version creates a coordination problem: a migration touching only a `chrome.storage.session` key forces a version bump that also guards unrelated `chrome.storage.local` and IndexedDB keys. Per-backend (or per-namespace) version counters are likely needed.

2. **Monolithic materialization into one POJO.** MetaMask loads everything into one `data` object before running migrations. For Nulo with potentially large IndexedDB payloads, materializing everything into a single in-memory object at startup to run migrations is not viable. Migrations need to be able to operate on individual records or storage namespaces without loading all backends. MetaMask partially addresses this with split storage (per-key writes), but the migration input is still a full materialized object.

3. **No per-controller independent versioning.** Because there is one global version, a new controller added in migration 200 must wait for migration 200 to run even if no other controller changed since migration 180. In a wallet with many independently-deployed feature areas (each backed by different storage), per-namespace versions (like IndexedDB's own `onupgradeneeded` version per database) let each area evolve independently without a global lock on the boot sequence.
