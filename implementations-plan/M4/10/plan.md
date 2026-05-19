# M4.10 — Per-RPC PXE isolation (2-3d, after M4.7)

> **STATUS: SUPERSEDED — see `../10-network-rework/plan-v4.md`** (executed 2026-04-27).
>
> User correctly identified that the current model conflates `Network` with `NetworkEndpoint` (chainId + rpcUrl carried together). The proper fix isn't per-RPC isolation; it's splitting `Network` (logical chain) from `NetworkEndpoint` (rpc URL). PXE state belongs at the `Network` level — switching endpoints within the same chain reuses PXE state.
>
> The network-model rework arc shipped this in three PRs (`m4.10/01-core` PR-1+2 + `m4.10/03-e2e-docs` PR-3). See `../DECISIONS.md` § "Post-M4 follow-up" for ship status, and `../10-network-rework/plan-v4.md` for the executed plan.
>
> The text below is preserved as historical context for the original per-RPC PXE isolation design (which would have been correct under the old data model).
>
> **Audit tier**: dual (codex xhigh + Plan agent).
>
> **Hard dependency**: M4.7 (migration registry) must land first. Without M4.7 we'd ship a one-shot wipe that defeats the purpose.

## Context & entry state

PXE data dir is keyed `pxe/${profileId}/${chainId}` (`packages/aztec-runtime/src/pxe/chain-runtime.ts:78`). Two networks pointing at the **same chainId but different RPC URLs** share PXE state. This is wrong for several reasons:

1. **Note discovery state mismatch**: PXE indexes notes from the node it's connected to. Switching RPC URLs (e.g. testnet → testnet-mirror, or local-network → sandbox) and reusing the cached PXE indexes notes against a stale view.
2. **Risk R11 in `architecture/plan/02-final-plan.md:299`**: same-chain RPC variants share PXE data dir.
3. **Multi-RPC users blocked**: power users with two endpoints on the same chain can't isolate experiments; one endpoint corrupts the other's state.

`ChainRuntimeRegistry.getOrInit` (`chain-runtime.ts:128`) already detects RPC URL changes and disposes the old runtime — but the disposal doesn't change the underlying IndexedDB key, so re-init reuses the same shared DB.

**Codex audit BLOCKER**: M4.10 is under-scoped at "change the dir key." The full surface includes:
- PXE creation site (`chain-runtime.ts:78`)
- Orphan cleanup at startup (`pxe/service.ts:84-117`)
- Profile-delete cleanup (`pxe/service.ts:331-344`)
- Legacy migration (`storage/migrate.ts:15` `INDEXEDDB_WIPE_PREFIXES = ["pxe/"]`)

All four sites assume `pxe/${profileId}/${chainId}` shape. M4.10 must update all of them coherently and migrate existing user data.

**Plan agent audit pass-through**: piggyback on M4.7's migration registry rather than ship a one-shot wipe. M4.7-c reserved a placeholder for this migrator.

## Architecture invariants (preserved)

1. **PXE behavior** — UNCHANGED for a given (profileId, chainId, rpcUrl) tuple. M4.10 only re-keys.
2. **`ChainRuntimeRegistry` semantics** — UNCHANGED externally. `peek`, `getOrInit`, `clear` keep their existing public API.
3. **`ChainRuntime` interface** — UNCHANGED.
4. **Existing PXE on disk** — gets MIGRATED via M4.7's runner from `pxe/${profileId}/${chainId}` to `pxe/${profileId}/${chainId}/${sha256(rpcUrl)}`. **No destructive wipe.**
5. **`onProfileDeleted` cleanup** — still removes all PXE DBs for that profile, just under the new key shape.
6. **`onActiveProfileChanged` write-lock semantics** — UNCHANGED. M4.10 doesn't change the locking model.

## Sub-step breakdown

Single PR, three commits.

### Step 1 — RPC URL hash + new dir-key shape

**New file**: `packages/aztec-runtime/src/pxe/rpc-url-hash.ts`

```ts
/**
 * 8-byte hex truncation of SHA-256(rpcUrl). Stable, URL-safe, short
 * enough for IndexedDB key cosmetics. Two different URLs collide only
 * if their first 64 bits of SHA-256 match — vanishing probability for
 * non-adversarial inputs. M4.10 isolation is not a security boundary
 * (an attacker with disk read can already see all the data); collision
 * resistance is for accidental drift, not adversarial.
 */
export async function hashRpcUrl(rpcUrl: string): Promise<string> {
  const data = new TextEncoder().encode(rpcUrl)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Construct the PXE data-dir key. The shape is part of the M4.10
 *  contract and must match the migrator + cleanup paths. */
export function pxeDataDir(profileId: string, chainId: number, rpcUrlHash: string): string {
  return `pxe/${profileId}/${chainId}/${rpcUrlHash}`
}
```

(8 bytes / 16 hex chars is enough; if the audit insists on full 64-char SHA-256, extend trivially. Default: 16 chars for ergonomics.)

### Step 2 — Wire into PXE creation, orphan cleanup, profile-delete cleanup

**Modified**: `packages/aztec-runtime/src/pxe/chain-runtime.ts:78`

```ts
const rpcUrlHash = await hashRpcUrl(network.rpcUrl)
const config = {
  ...getPXEConfig(),
  dataDirectory: pxeDataDir(network.profileId, network.chainId, rpcUrlHash),
  proverEnabled: true,
} as PXEConfig
```

`createChainRuntime` becomes `async` (already is, but now awaits the hash too). `ChainRuntime` constructor also stores `rpcUrlHash` so cleanup can target it precisely:

```ts
export class ChainRuntime {
  public constructor(
    public readonly chainId: number,
    public readonly node: AztecNode,
    public readonly pxe: PXE,
    public readonly rpcUrl: string,
    public readonly rpcUrlHash: string,
    public readonly dataDir: string,  // pxeDataDir(...)
  ) {}
}
```

`ChainRuntimeRegistry.getOrInit` (line 128) — when `existing.rpcUrl !== network.rpcUrl`, dispose AND rename: schedule the old DB for deletion (or leave it for orphan cleanup at next boot — verify).

**Modified**: `packages/aztec-runtime/src/pxe/service.ts:84-117` (orphan cleanup)

The current logic walks `dbs` filtering for `db.name?.startsWith("pxe/")` and keeps DBs matching `pxe/${profile.id}/`. M4.10 needs to recognize the new shape (`pxe/${profileId}/${chainId}/${rpcUrlHash}`):

```ts
const profileIds = new Set((await this.profiles.getProfiles()).map(p => p.id))
const knownNetworks = await this.networks.getNetworks() // all (profileId, chainId, rpcUrl)
const expectedDirs = new Set<string>()
for (const net of knownNetworks) {
  if (!profileIds.has(net.profileId)) continue
  const hash = await hashRpcUrl(net.rpcUrl)
  expectedDirs.add(pxeDataDir(net.profileId, net.chainId, hash))
}
for (const db of dbs) {
  if (!db.name?.startsWith("pxe/")) continue
  if (!expectedDirs.has(db.name)) {
    // orphan — delete
  }
}
```

(Need `NetworksClient` injected here; it currently isn't. Audit at execution time and either inject or piggyback on a different sweep.)

**Modified**: `packages/aztec-runtime/src/pxe/service.ts:331-344` (`onProfileDeleted`)

Already filters by `pxe/${profile.id}/` prefix; the new shape is `pxe/${profile.id}/${chainId}/${rpcUrlHash}` which still has the prefix. No behavior change, but verify the `keyval-store` co-cleanup (line 337) still applies. The current condition `db.name?.startsWith(\`pxe/${profile.id}/\`) || db.name === "keyval-store"` is fine.

### Step 3 — Migration via M4.7 registry

**Modified**: `packages/extension/src/wallet/storage/migration-registry.ts` (created in M4.7-a; populated here)

Register the IndexedDB migrator:

```ts
{
  fromVersion: 0,
  toVersion: 1,
  migrate: async (_area, _root) => {
    // _area is chrome.storage.local; this migrator targets IndexedDB instead.
    const dbs = await indexedDB.databases()
    const networks = await readPersistedNetworks() // helper that pulls from "nulo:core:networks"
    for (const db of dbs) {
      if (!db.name?.startsWith("pxe/")) continue
      const parts = db.name.split("/")
      // Old shape: ["pxe", profileId, chainId]
      // New shape: ["pxe", profileId, chainId, rpcUrlHash]
      if (parts.length !== 3) continue   // already migrated or unrelated
      const [, profileId, chainIdStr] = parts
      const chainId = Number(chainIdStr)
      if (Number.isNaN(chainId)) continue
      const matching = networks.find(n => n.profileId === profileId && n.chainId === chainId)
      if (!matching) {
        // Orphaned old-shape DB; let cleanup remove it later
        continue
      }
      const rpcUrlHash = await hashRpcUrl(matching.rpcUrl)
      const newName = pxeDataDir(profileId, chainId, rpcUrlHash)
      await renameIndexedDb(db.name, newName)
    }
  },
}
```

`renameIndexedDb` is a helper that opens the old DB, copies all object stores to a new DB with the new name, then deletes the old. Documented as best-effort: if the rename fails midway, the old DB persists; on next boot the migrator re-attempts (idempotent).

**Note on migrator scope**: this migrator runs once per profile/chain, not per session. The M4.7 runner respects the version sidecar; once `version=1` is set globally for IndexedDB-PXE, the migration is done.

(Caveat: if the network record's `rpcUrl` changes BETWEEN M4.10 ship and the user's next boot, the rename might fail to find the matching network. Acceptable — orphan cleanup catches it.)

## Test plan

ALL tests in `packages/aztec-runtime/src/pxe/` namespace.

**`packages/aztec-runtime/src/pxe/rpc-url-hash.test.ts`** (new):
1. `hashRpcUrl("https://aztec.example.com")` is stable across calls.
2. Different URLs produce different hashes (collision-free for representative inputs).
3. `pxeDataDir(p, 1, h)` produces the expected string shape.

**`packages/aztec-runtime/src/pxe/chain-runtime.test.ts`** (new or extend):
1. `ProductionPxeFactory.createChainRuntime` writes to the new dir shape (mock the PXE config; assert `dataDirectory`).
2. `ChainRuntimeRegistry.getOrInit` with same `(profileId, chainId)` but different `rpcUrl` disposes old + creates new under different `dataDir`.
3. `ChainRuntime.dispose` works against the new shape (no implicit assumption about path).

**`packages/aztec-runtime/src/pxe/service.orphan-cleanup.test.ts`** (new):
1. Old-shape PXE DB matching no current network is deleted (orphan).
2. Old-shape PXE DB matching a current network is preserved (M4.10 migrator owns the rename, not orphan cleanup).
3. New-shape PXE DB matching a current network is preserved.
4. New-shape PXE DB matching no current network is deleted (e.g. profile gone).

**`packages/extension/src/wallet/storage/m4-10-migration.test.ts`** (new, owned by M4.10 PR):
1. **Round-trip rename**: old-shape `pxe/p/1` for a known network → new-shape `pxe/p/1/abc123def456` after migration. Object stores copied. Old DB gone.
2. **Idempotent on partial failure**: kill the rename mid-copy (mock); re-run the migrator; the migrator either picks up where it left off or starts over without data loss.
3. **Orphan during migration** (old-shape DB has no matching network): not renamed; left for orphan cleanup.

Total: ~9-11 focused tests. Each tests a distinct invariant.

**NOT TESTED:**
- Real `indexedDB.databases()` ordering quirks (rely on browser).
- Concurrent rename of the same DB (M4.7's lock prevents it).
- Specific PXE behavior post-rename (existing PXE tests cover that).

**Existing tests to consider**:
- Any test that asserts on `dataDirectory` path shape needs updating. Grep at execution time.
- `pxe/service.ts` test (if it exists) for orphan cleanup — extend with new-shape expectations.

## Verification commands

```bash
bun run --filter '@nulo/aztec-runtime' test     # rpc-url-hash + chain-runtime tests
bun run --filter '@nulo/extension' test         # migration test
bun run typecheck:all
bun run test:all                                # M2.6 unaffected
bun run check:imports
bun run build
```

Manual QA (30 min — networks-heavy):
1. Set up two networks on the same chainId with different RPC URLs (e.g. local-network and sandbox both pretending to be chainId 31337).
2. Switch between them; verify each maintains independent note discovery state.
3. Pre-M4.10 install state (existing user): on first boot post-M4.10, observe migration logs; verify PXE state survives.
4. Profile delete: verify both old-shape (if any leftover) and new-shape DBs for the deleted profile are removed.

## Risks tracked

1. **IndexedDB rename is non-atomic**. The helper copies-then-deletes; an interruption between leaves both DBs. Migrator must handle this on re-run (skip already-renamed targets or merge).
2. **Hash collision** is vanishingly unlikely for non-adversarial URLs (8-byte hash). If a user types two URLs that hash-collide, they'll silently share state — same bug as today, just rarer. Document; if real-world reports surface, extend hash to full 32 bytes.
3. **Network record changes during migration**. If the user edits an RPC URL between M4.10 ship and first boot, the migrator might miss the rename target. Falls back to orphan cleanup; user keeps a stale DB until next sweep. Acceptable.
4. **Cross-profile collision**. The dir prefix includes `profileId`, so different profiles never collide regardless of RPC URL. Confirmed.
5. **`keyval-store` shared between PXEs**. Existing logic deletes it only after all `pxe/*` DBs are gone. M4.10 doesn't change this. Document.
6. **Ordering with M4.7**. M4.10's migrator must run AFTER `nulo:core:networks` is readable (it depends on the network records). Either gate on a specific network-storage version, or run M4.10's migrator after a baseline network migrator. Decide at execution time when reading M4.7-c's actual ordering.

## Rollback

`git revert <m4.10-commit-sha>` rolls back the wiring changes. Migration still ran on disk for users who upgraded; manual re-test step needed if regressing. Document in commit message.

## Open questions / decision flags

1. **Hash length**: 16 chars vs 64 chars — default 16. Audit may push to 64.
2. **Old-DB orphan policy**: rename-then-delete vs rename-only. Default rename-only; orphan cleanup picks up the old later. If orphan cleanup is sketchy, rename-then-delete is safer.
3. **Re-import network during migration**: migrator pulls from `nulo:core:networks` — verify this collection is migrated by M4.7 BEFORE the IndexedDB migrator runs (cross-root ordering question from M4.7).
