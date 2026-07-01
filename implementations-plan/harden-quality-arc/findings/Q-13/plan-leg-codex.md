**Plan**

Goal: deduplicate restore/allocation/ownership/cascade scaffolding without hiding profile isolation. Do not start with a base class. Use composable helpers plus small repository adapters, because the services diverge too much.

**Inventory**

| Service | Shape / Key | Repo? | Restore | Ownership | Cascades / Divergences |
|---|---|---:|---|---|---|
| `token` | `Token {id:number, profileId, chainId, contract,...}` keyed by numeric id string | Open-coded | locked batch, `max(keys)+1`, always reassigns id, per-row `toRestoreError` | mixed: list filters optional `profileId`; update checks profile/chain/contract; `getToken/deleteToken/getTokenRaw` are id-only | profile delete deletes tokens via `deleteToken`; chain purge emits `onTokenDeleted` so balances cascade. **High-risk: id-only RPC surfaces look cross-profile-readable/deletable. Stop/go test required.** |
| `token-balance` | `TokenBalanceRaw {id:number, token:number, account}` no `profileId` | `BalanceRepository` | no lock, allocate id per row, per-row `toRestoreError` | indirect through Token/Account, not row-owned | token delete listener deletes by token id. **Not directly profile-scoped; backup currently calls `requireActiveProfile` then returns all repo rows.** |
| `fpc` | stored `Omit<FpcInfo,"isProtocol">`, string id | Open-coded | locked, reject legacy `FpcType`, preserve id if free else random, strip `isProtocol` | active profile + `fpc.profileId === profile.id` checks | profile/chain purge; protocol rows cannot rename/delete; read-time decoration/cache. **Bad first target.** |
| `network` | `Network {id:string, profileId, chainId, endpoints[]}` | Open-coded | locked `unknown[]`, old-shape rejection, Zod validate, reject `(profileId,chainId)` collision, preserve/random id | active profile required, invalid id on mismatch | deleteNetwork calls awaited `purgeChain` before delete; profile delete purges each chain, clears node caches and active key. **Repository must not own orchestration.** |
| `account` | `Account`, key = address; index allocated per `(profile,chain,type)` | Open-coded | duplicate address precheck throws whole restore, then per-row `toRestoreError` | explicit `profileId, chainId` params; mismatches return undefined/throw depending method | profile/chain purge emits account deleted; auth registry listens. **Natural key, no storage id allocation.** |
| `auth-registry` | `Authwit {id:number, account,...}` plus status keyed by account | Open-coded | locked `max(values.id)+1`, per-row `toRestoreError` | account-address scoped, not profile row scoped | account-delete listener deletes authwits/status by address. **Do not force into `ProfileScopedRepository<T>`. Needs account-owned adapter or leave alone.** |
| `contact` | `Contact {id:string, profileId,...}` | Open-coded | locked, preserve id if free else random, per-row `toRestoreError` | active profile + row `profileId` checks | profile delete only. **Least divergent first migration.** |
| `incoming-transfer` | records keyed by `siloedNullifier`; trust keyed by `profile|network|contract` | `IncomingTransferRepository` | none in service | explicit profile/network/account params; some fail-closed checks | profile/chain clear under service lock, scheduler rehydrate, epoch bump. **Keep custom repo/lock semantics.** |

`full-backup-helpers.ts` depends on `restoreError` staying on failed rows and on ID remapping after profile/network restore; preserve that result shape.

**Shared Abstractions**

Add `apps/extension/src/wallet/services/profile-scoped-repository.ts`:

```ts
type EntityKey = string | number

class ProfileScopedRepository<T, K extends EntityKey> {
  constructor(storage, spec: {
    keyOf(row: T): K
    profileOf(row: T): string | undefined
    invalidIdMessage?: string
  })

  getOwned(key: K, profileId: string): Promise<T>          // throws on missing/mismatch
  maybeGetOwned(key: K, profileId: string): Promise<T | undefined>
  listOwned(profileId: string, filter?: (row: T) => boolean): Promise<T[]>
  set(row: T): Promise<void>                               // rejects missing profileId
  deleteOwned(key: K, profileId: string): Promise<T>
  purgeOwned(profileId: string, filter?: (row: T) => boolean): Promise<T[]>
}
```

Rules: `profileId` is never optional; missing/empty profile fails closed; no `list(profileId?: string)` API; no public “get all”. Any all-row read for restore/allocation remains private to the service/repo and named as such.

Add `apps/extension/src/wallet/services/restore-rows.ts`:

```ts
restoreRows<T, R extends T = T>(
  rows: readonly T[],
  restoreOne: (row: T, index: number) => Promise<R>,
  onRecoverableSkip?: (row: T) => R | undefined
): Promise<Restored<R>[]>
```

This only centralizes `try/catch -> toRestoreError -> Restored<T>[]`. Validation, locks, id remap policy, and batch duplicate checks stay caller-side.

Add `apps/extension/src/wallet/services/id-allocators.ts`:

```ts
allocateNumericMax(existingKeys: () => Promise<string[]>): Promise<number>
allocateUniqueRandomHex(contains: (id: string) => Promise<boolean>, length = 8, preferred?: string): Promise<string>
allocateUniqueFromSet(taken: Iterable<string>, length = 8): string
```

No generic base class. A base class would either hide service-specific cascades or grow hooks for network purge, protocol FPCs, account-derived authwits, incoming scheduler epochs, and token-balance indirection. That is worse than duplication.

**Privacy Tests**

Isolation invariant: a service method running under profile A may only return, update, delete, emit, or cascade rows whose ownership resolves to profile A. Unknown row, missing profile, stale active profile, or unresolved indirect owner means deny/empty, never “all rows”.

Before migration, add characterization tests:

- `contact/service.test.ts`: delete/update/get for profile B id while active profile A must reject and leave B row intact.
- `network/service.test.ts`: already has profile-delete isolation; extend id-owned mutations (`renameNetwork`, `deleteNetwork`, endpoints) for foreign row.
- `token/service.isolation.test.ts`: seed pA/pB tokens; active pA must not `getToken`, `deleteToken`, or `getTokenInterface` for pB id. If this fails, stop Q-13 and split a security fix.
- `token-balance/service.test.ts`: pA listing must not throw or reveal pB balances when repo has pB token balances.
- `incoming-transfer/repository.test.ts`: `clearProfile/clearChain` delete only matching records and trust rows.
- New `profile-scoped-repository.test.ts`: `listOwned(undefined as any)` throws; `getOwned(pBRow, "pA")` throws; `deleteOwned` cannot delete foreign rows.

**Phasing**

1. Privacy characterization PR. No refactor. Run targeted service tests. Any red privacy test becomes a prerequisite security PR, not hidden in Q-13.
2. Add `restoreRows` + id allocators with unit tests. Migrate no services yet.
3. Migrate `contact` first using `ProfileScopedRepository`, `restoreRows`, and `allocateUniqueRandomHex`.
4. Migrate `network` repository reads/writes only; keep `purgeChain`, active-key deletion, node caches in service.
5. Migrate `account` direct ownership helpers, but keep per-tuple serialization and duplicate-address restore precheck.
6. Migrate `token` only after privacy decision. Keep event cascade behavior exactly.
7. Migrate `fpc` last among direct profile rows; keep decoration/protocol restrictions in service.
8. For `token-balance`, `auth-registry`, `incoming-transfer`: use restore/id helpers where useful, but do not force into profile repo unless an explicit owner resolver is introduced and tested.

Each PR runs the affected service tests plus full backup helper tests. Final PR runs full workspace tests.

**Decision Ledger**

Chosen: composable helpers, no base class.  
Rejected: generic service superclass, because it obscures cascades and indirect ownership.  
Chosen: fail-closed repository API with mandatory `profileId`.  
Rejected: optional profile filters, because `undefined` becomes “return everything”.  
Unresolved: token id-only RPC behavior and token-balance/auth-registry indirect ownership may already violate the intended invariant.

**Assumptions**

Facts: verified from cited files; only `token-balance` and `incoming-transfer` have repositories in this set; no `CONTEXT.md`/ADR found by `rg`.  
Inferences: token/token-balance/auth-registry need privacy characterization before migration.  
Ask: decide whether red isolation tests are allowed to become prerequisite security fixes before the behavior-preserving refactor continues.