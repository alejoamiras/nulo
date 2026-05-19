# M4.10 — Network-model rework: split `Network` from `NetworkEndpoint` (v4, final, lean)

> **Status: PLANNING (v4, post-user-feedback, EXECUTION-READY pending approval).**
>
> **What changed v3 → v4**:
> - **Migration dropped.** Pre-launch wallet, no users. v2→v3 storage bump just wipes network rows alongside the existing wipe in `migrate.ts` (accounts/txs/balances/PXE). `getOrInitNetworks()` reseeds the 4 defaults on next boot. No grouping logic, no `oldToNewNetworkId`, no UI-key remapping. ~10 fewer pages of plan, ~10 fewer tests.
> - **Old-shape backup compat dropped.** `restore()` accepts new-shape only. Old-shape backups (made pre-rework) are rejected with a clear toast: "This backup was created with an older version of Nulo. Re-create it on this version." Pre-launch, no testers have backups they can't reproduce in 30 seconds.
> - **`runStorageMigration` refactor dropped.** No port injection needed; the function stays as-is and just adds the network keys to its existing wipe list.
> - **§12 Q6 clarified** (kept the answer "yes, allow renaming seeded chains").
> - **Effort drops from 6-7d to ~4.5-5.5d.**
>
> Everything else from v3 stays — the runtime issues caught by both audits (cascade coordinator, pending-tx polling pin, `setActiveNetwork` semantics, `isDefault` removal, smart-add UX, AuthRegistry in cascade, `getNodeForUrl` URL-keyed cache) all still apply because they're not migration-specific.
>
> **Audits that informed this**: `audit-codex-v2.md` (REJECT, 5 BLOCKERs — 4 runtime, 1 migration; the migration BLOCKER is N/A in v4) + `audit-agent-v2.md` (APPROVE WITH FIXES, 3 BLOCKERs — 2 runtime, 1 migration; same).
>
> **Out of scope (reaffirmed)**: automatic primary/fallback RPC failover. Plan reserves `primaryEndpointId` naming + `Network.kind` slot for the future expansion.

---

## 0. Context

`packages/extension/src/wallet/services/network/spec.ts:11-24`:

```ts
type Network = { id, profileId, name, rpcUrl, chainId, isDefault }
```

This row glues "logical chain identity" (`chainId`) to "endpoint identity" (`rpcUrl`). Adding a backup RPC for the same chain creates a peer Network row with the same `chainId` — the data model lies. PXE state at `pxe/${profileId}/${chainId}` is already chain-keyed; same-chain Network rows already share PXE state.

Most consumers (`AccountService`, `TokenService`, `TokenBalanceService`, `TransactionService`, `NoteService`, `FpcService`) are already chain-keyed. The new model lines up with what the rest of the system already assumes. Replaces the DEFERRED `implementations-plan/M4/10/plan.md` (per-RPC PXE isolation — that v0 plan was backwards).

---

## 1. Target entity model

```ts
type Network = {
    /** Stable id (random hex, 8 chars). Used as `networkId` in operations + bridge. */
    id: string

    /** Profile scoping. */
    profileId: string

    /** Logical chain identity. */
    chainId: number

    /** User-customizable display name. Seeded from defaults; user may rename. */
    name: string

    /** Persisted user choice — which endpoint receives traffic by default. */
    primaryEndpointId: string

    /** Endpoints owned by this Network. Always ≥1. */
    endpoints: NetworkEndpoint[]

    /** Optional chain-type metadata. Set at seed time. */
    kind?: "mainnet" | "testnet" | "devnet" | "local" | "custom"
}

type NetworkEndpoint = {
    /** Stable id. */
    id: string
    /** RPC URL (host lowercased on add; path/query preserved). */
    rpcUrl: string
    /** Optional human-readable label. */
    label?: string
}
```

**Storage shape**: single `EntityStorage<Network>` rooted at `nulo:core:networks`. Endpoints nested inside Network — atomic per-Network mutation.

### Design decisions

**(a) Nested aggregate.** One storage root. Per-Network mutation atomic.

**(b) `primaryEndpointId`** is persisted user intent. Future fallback adds runtime "currently bound endpoint" without renaming.

**(c) `isDefault` removed.** From Network type. From `caip.ts:74` + extension/utils/caip mirror (drop `find(isDefault)`). From `wallet-bridge/INetworkRef.isDefault?`. After rework there's exactly one Network per chainId; `networks[0]` is correct.

**(d) `Network.name` is chain label.** Seeded from defaults; user may rename.

**(e) `Network.kind`** optional, set at seed time. Local Network → `"local"`, etc. Custom RPCs → `"custom"`.

**(f) NO `healthStatus` persisted.** UI shows transient probe results computed via `getNodeStatus(networkId)`.

**(g) Validation rules** (per-Network scope):
- Endpoint `rpcUrl` must pass `getNodeInfo()` and produce the same `chainId` as its Network.
- A Network has ≥1 Endpoint.
- Two endpoints in the SAME Network can't share a normalized `rpcUrl`.
- One Network per (profileId, chainId): `addNetwork` rejects duplicate chainId (smart-add UI converts this to "add as endpoint" flow).
- Cross-Network `rpcUrl` reuse ALLOWED (not a security boundary).

**(h) Awaited purge coordinator** (replaces v2's event-cascade — both audits flagged events as fire-and-forget unsafe for cleanup).

`NetworkService.purgeChain(profileId: string, chainId: number): Promise<void>`:

```ts
async purgeChain(profileId: string, chainId: number): Promise<void> {
    await this.transactionService.stopPollingForChain(profileId, chainId)
    await this.transactionService.clearChainState(profileId, chainId)
    await this.tokenBalanceService.clearChainState(profileId, chainId)
    await this.tokenService.clearChainState(profileId, chainId)
    await this.fpcService.clearChainState(profileId, chainId)
    await this.authRegistryService.clearChainState(profileId, chainId)
    await this.accountService.clearChainState(profileId, chainId)
    await this.operationJournalService.clearChainState(profileId, chainId)
    await this.pxeServiceClient.clearChainState(profileId, chainId)  // SW→offscreen RPC
    this.emit("onChainPurged", { profileId, chainId })  // UI-refresh signal only
}
```

Each chain-keyed service exposes a NEW `clearChainState(profileId, chainId)` method. PXE goes through `PxeServiceClient.clearChainState` (NEW SW→offscreen RPC) → offscreen `PxeService.clearChainState` → IDB delete `pxe/${profileId}/${chainId}`.

`deleteNetwork(id)` calls `purgeChain` before deleting the Network row. `onProfileDeleted` calls `purgeChain` for each network of the deleted profile.

**Why awaited beats events**: deterministic order; `deleteNetwork` returns when chain truly purged; PXE only runs after SW-side state is wiped; no double-fire on profile delete (subscribers stop subscribing to `onNetworkDeleted` for cleanup — they expose methods NetworkService calls).

**Init-order contract**: NetworkService's `init()` resolves `services.get()` for all peers in the cascade. EventHandler instances are constructor-initialized → safe pre-`init()`. Documented in service.ts top-comment.

**(i) Active-chain delete guard**: `deleteNetwork(id)` rejects if `id === currentActiveNetworkId`. UI hides delete button on active row + shows "Switch to another chain first."

---

## 2. Architectural invariants preserved

1. **`NetworkInfo { profileId, chainId, rpcUrl }`** unchanged. NetworkService synthesizes from `(Network, primaryEndpoint.rpcUrl)`.
2. **PXE storage key** `pxe/${profileId}/${chainId}` unchanged.
3. **`AccountService` API** unchanged. NEW `clearChainState` method.
4. **dApp bridge surface**: `INetworkRef.isDefault?` removed (was already optional); CAIP resolvers updated to `networks[0]`.
5. **Backup wire format** stays array (`Network[]`).

---

## 3. Surface area (file map)

### NetworkService + spec rewrite (PR-1)
- `packages/extension/src/wallet/services/network/{spec,service,client}.ts` — REWRITE.
- `packages/extension/src/wallet/services/network/service.test.ts` — extend.
- `packages/extension/src/wallet/services/network/service.integration.test.ts` (NEW).
- `packages/extension/src/wallet/runtime.ts:27` — registration.
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — extend.

### Chain-keyed services with new `clearChainState` method (PR-1)
- `packages/extension/src/wallet/services/account/service.ts`
- `packages/extension/src/wallet/services/transaction/service.ts` — also `stopPollingForChain` + `Tx.submittedEndpointUrl` field + `sendTx`/`updateTx` wiring.
- `packages/extension/src/wallet/services/token-balance/service.ts`
- `packages/extension/src/wallet/services/token/service.ts`
- `packages/extension/src/wallet/services/fpc/service.ts`
- `packages/extension/src/wallet/services/auth-registry/service.ts`
- `packages/extension/src/wallet/services/operation-journal/service.ts`
- `packages/aztec-runtime/src/pxe/service.ts` + `spec.ts` + `client.ts` — `clearChainState({profileId, chainId})` SW→offscreen RPC.
- `packages/extension/src/wallet/services/token-balance/balance-projector.ts:118` — replace `find(x => x.isDefault)` with `[0]` (audit-found consumer).

### Storage version bump (PR-1) — TINY
- `packages/extension/src/wallet/storage/migrate.ts` — bump `CURRENT_VERSION` 2→3; add `nulo:core:networks@*` + `nulo:ui:lastActiveNetwork@*` + `nulo:ui:activeNetwork` + `nulo:ui:balanceDisplayOption@*` to the existing `KEYS_TO_WIPE` list. Also add `nulo:journal@*` from `chrome.storage.session` to a parallel session-wipe step. **No migrator** — `getOrInitNetworks()` reseeds defaults on next boot.

### Wallet-bridge cleanup (PR-1)
- `packages/wallet-bridge/src/session-types.ts:33` — drop `INetworkRef.isDefault?`.
- `packages/wallet-bridge/src/caip.ts:74` — `networks[0]` only.
- `packages/extension/src/wallet/utils/caip.ts:93` — same mirror.

### Popup UI (PR-1, except per-chain detail UX → PR-2)
- `packages/extension/src/popup/app.vue:75-103` — `initNetworks()`: drop `find(n => n.isDefault)` (line 97); replace `setDefault` with `setActiveNetwork`; subscribe `onActiveNetworkChanged`.
- `packages/extension/src/stores/app.store.ts:88-109` — new mutators (`setActiveNetwork`, `setPrimaryEndpoint`, `addEndpoint`, `updateEndpoint`, `deleteEndpoint`, `renameNetwork`).
- `packages/extension/src/popup/components/popups/NetworksPopup.vue` — chain-only switching; drop `setDefault` side-effect.
- `packages/extension/src/popup/components/popups/NewNetworkPopup.vue` — REWRITE with smart-add (catches `DuplicateChainError` → switches to "add as endpoint" flow).
- `packages/extension/src/popup/components/popups/EditNetworkPopup.vue` — rename Network only.
- `packages/extension/src/popup/pages/settings/networks/index.vue` — list view (one row per Network); drop `setDefault` side-effect.
- `packages/extension/src/popup/components/modules/general/NetworkBadge.vue:46` — tooltip uses primary endpoint URL.
- `packages/extension/src/popup/components/popups/SelectNetworksPopup.vue` — verify dead; delete if so (audit-flagged vestigial).

### Endpoint detail UX (PR-2)
- `packages/extension/src/popup/pages/settings/networks/[id].vue` (NEW) — per-Network detail page.
- `packages/extension/src/popup/components/popups/NewEndpointPopup.vue` (NEW).
- `packages/extension/src/popup/components/popups/EditEndpointPopup.vue` (NEW).
- popup.store + cache.store + PopupManager registrations.

### Backup / restore (PR-1)
- `packages/extension/src/wallet/services/network/service.ts:320-352` — `backup() → Network[]` (new shape, array preserved).
- `restore(networks)`: rejects entries lacking `endpoints[]` field with toast "Backup format too old; please re-create it on this version." Conflict policy: rejects same `(profileId, chainId)` collision.

### E2E (PR-3)
- `packages/extension/tests/e2e/network/networks.test.ts` — extend.
- `packages/extension/tests/e2e/network/endpoints.test.ts` (NEW) — endpoint CRUD + primary swap + state continuity.
- `packages/extension/tests/e2e/sw-restart-network.test.ts` (NEW) — codex-requested SW restart preserves active chain + active endpoint + pending-tx polling.
- `packages/extension/tests/e2e/fixtures/helpers.ts` — `addEndpoint`, `setPrimaryEndpoint`, `deleteEndpoint`, `navigateToNetworkDetail`.

---

## 4. Architecture: endpoint resolution + transient node cache

**`NetworkService.getNode(chainId)`** (post-rework):
```ts
public async getNode(chainId: number): Promise<AztecNode> {
    let node = this.nodes.get(chainId)
    if (!node) {
        const network = await this.getNetworkByChainId(chainId)
        const endpoint = network.endpoints.find(e => e.id === network.primaryEndpointId)
        if (!endpoint) throw new Error(`Network ${network.id} has no primary endpoint`)
        node = this.nodeFactory.createNode(endpoint.rpcUrl)
        this.nodes.set(chainId, node)
    }
    return node
}
```

`setPrimaryEndpoint(networkId, endpointId)` evicts `this.nodes.get(network.chainId)` BEFORE emitting `onPrimaryEndpointChanged`. Same for `updateEndpoint` if `rpcUrl` changes.

**`NetworkService.getNodeForUrl(url, fallbackChainId)`** (NEW, codex-spec'd, URL-keyed cache):
```ts
private readonly transientNodes = new Map<string, { node: AztecNode; failures: number }>()

public async getNodeForUrl(url: string, fallbackChainId: number): Promise<AztecNode> {
    let entry = this.transientNodes.get(url)
    if (!entry) {
        const isKnown = await this.isKnownEndpointUrl(url)
        if (!isKnown) return this.getNode(fallbackChainId)
        entry = { node: this.nodeFactory.createNode(url), failures: 0 }
        this.transientNodes.set(url, entry)
    }
    return entry.node
}

public reportEndpointFailure(url: string): void {
    const entry = this.transientNodes.get(url)
    if (!entry) return
    entry.failures += 1
    if (entry.failures >= 3) this.transientNodes.delete(url)
}
```

`deleteEndpoint` evicts `transientNodes` for that URL.

**Pending-tx polling pin** (`transaction/service.ts:148`):
```ts
private async updateTx(tx: Tx) {
    const node = tx.submittedEndpointUrl
        ? await this.networkService.getNodeForUrl(tx.submittedEndpointUrl, tx.chainId)
        : await this.networkService.getNode(tx.chainId)
    try {
        const receipt = await node.getTxReceipt(TxHash.fromString(tx.hash))
        // ... rest unchanged
    } catch (err) {
        if (tx.submittedEndpointUrl) this.networkService.reportEndpointFailure(tx.submittedEndpointUrl)
        throw err
    }
}
```

`sendTx` writes `tx.submittedEndpointUrl = primaryEndpoint.rpcUrl` at submission time.

---

## 5. Storage version bump (no migrator)

```ts
// packages/extension/src/wallet/storage/migrate.ts
const STORAGE_VERSION_KEY = "nulo:core:storage-version"
const CURRENT_VERSION = 3   // was 2

const KEYS_TO_WIPE_LOCAL = [
    "nulo:core:accounts",      // existing
    "nulo:core:txs",           // existing
    "nulo:core:tx-cursors",    // existing
    "nulo:core:token-balances",// existing
    // NEW for v3:
    "nulo:core:networks",
    // (UI keys with `@<id>` suffixes wiped via prefix sweep below)
]

const KEY_PREFIXES_TO_WIPE_LOCAL = [
    "nulo:core:networks@",
    "nulo:ui:lastActiveNetwork@",
    "nulo:ui:balanceDisplayOption@",
]

const KEYS_TO_WIPE_LOCAL_LEGACY = [
    "nulo:ui:activeNetwork",
]

const KEY_PREFIXES_TO_WIPE_SESSION = [
    "nulo:journal@",
]
```

Inside `runStorageMigration`:
1. If version === 3: return (no-op).
2. Read all `chrome.storage.local` keys; collect those matching `KEY_PREFIXES_TO_WIPE_LOCAL`.
3. `chrome.storage.local.remove([...KEYS_TO_WIPE_LOCAL, ...KEYS_TO_WIPE_LOCAL_LEGACY, ...prefixMatches])`.
4. (Existing) IDB wipe: `pxe/*` + `keyval-store`.
5. Read all `chrome.storage.session` keys; collect matching `KEY_PREFIXES_TO_WIPE_SESSION`; remove.
6. Set `nulo:core:storage-version = 3`.

`getOrInitNetworks()` reseeds the 4 defaults on next access.

**No tests for the wipe.** This is intentional. There are no users to
migrate; the version-bump path is a destructive wipe + reseed and the
existing test infrastructure exercises the reseed implicitly on every
test boot. Migration scaffolding (lossless transformers, idempotency
suites, etc.) is deferred to M4.7 — see
`memory/feedback_no_migrations_pre_launch.md`.

---

## 6. UX (unchanged from v3 §6)

Settings → Networks: one row per chain. Chevron drills into per-Network detail (PR-2).

Per-Network detail (PR-2): Network info (name + chainId) + endpoint list (primary pill, edit, delete) + Add endpoint + Danger zone (Delete chain with cascade-purge confirm).

Chain-switcher (NetworksPopup): chain-only. Drops `setDefault` mutation side-effect.

Smart-add (NewNetworkPopup): probe RPC; if chainId matches existing Network → "Add as endpoint to {name}?"; if new → today's flow. Catches `DuplicateChainError`/`DuplicateEndpointError` from service. 10s probe timeout with toast.

Add-Endpoint (NEW popup): label + URL + probe (chainId-match validation) + Save.

Edit-Endpoint (NEW popup): same UI prefilled.

Delete-Endpoint: tap delete on non-primary → confirm → wipe. Primary endpoint button disabled with hint. Last endpoint button hidden.

Active-chain delete guard: list view hides delete button on the active row.

---

## 7. PR breakdown (3 PRs)

### PR-1 — Core entity + service + storage bump + UI plumbing + cascade + pending-tx pin

**Branch**: `m4.10/01-core`. Single atomic PR; commit-by-commit reviewable.

- Commit 1: spec + service shell + zod + types.
- Commit 2: storage version bump (~5 lines in migrate.ts; no test — wipe path is exercised implicitly on every test boot).
- Commit 3: service implementation (CRUD + getNode + getNodeForUrl + cache invalidation) + ~25 unit tests + ~6 integration tests.
- Commit 4: chain-keyed services `clearChainState` methods + tests.
- Commit 5: `purgeChain` coordinator + `PxeServiceClient.clearChainState` SW→offscreen RPC + integration test for purge with active pending tx.
- Commit 6: UI plumbing (app.vue init, app.store, NetworksPopup, NewNetworkPopup smart-add, EditNetworkPopup, settings/networks list, NetworkBadge tooltip, balance-projector consumer fix).
- Commit 7: `Tx.submittedEndpointUrl` field + sendTx writer + updateTx reader + `reportEndpointFailure` wiring.
- Commit 8: wallet-bridge cleanup (drop `INetworkRef.isDefault?`, drop `find(isDefault)` in CAIP).
- Commit 9: backup/restore new-shape only; restore rejects old-shape with toast.

**Verification**:
- `bun run typecheck` (all 8 packages).
- `bun run --filter '@nulo/extension' test` (~32 new tests).
- `bun run --filter '@nulo/aztec-runtime' test`.
- `bun run lint`.
- `bun run build:chrome`.
- `bun run test:e2e` (smoke).
- Manual smoke: chain switch; settings → networks lists chains; smart-add converts duplicate-chain to endpoint flow.

**Failure mode if merged alone**: per-chain detail page + endpoint CRUD popups not shipped. User can use chains but can't add backup endpoints via UI yet. Service API supports it; PR-2 ships the UX.

### PR-2 — Endpoint UX (settings detail + add/edit/delete popups)

**Branch**: `m4.10/02-endpoint-ux`. ~1d.

**Verification**: manual smoke endpoint CRUD; e2e smoke.

### PR-3 — E2E expansion + docs

**Branch**: `m4.10/03-e2e-docs`. ~0.5-0.75d.

> **No migration tests.** Pre-launch wallet, no users to migrate. The v3
> storage bump in `migrate.ts` wipes affected keys + reseeds via
> `getOrInitNetworks()`. Don't write tests as if it were a lossless
> migration; that scope is deferred to M4.7 if/when users exist.

- `endpoints.test.ts` (NEW) — endpoint CRUD + primary swap + state continuity.
- `sw-restart-network.test.ts` (NEW) — codex test gap (active chain + active endpoint + pending-tx polling preserved across SW restart).
- `helpers.ts` — endpoint helpers.
- `implementations-plan/M4/DECISIONS.md` — append.
- `implementations-plan/M4/10/plan.md` — top-of-file note "SUPERSEDED".
- `implementations-plan/M4/README.md` — bump M4 status.
- `SECURITY.md` — endpoint-as-input subsection.

---

## 8. Test plan (~32 new tests, vs v3's 43)

### Unit (PR-1, ~25)

`network/service.test.ts`:
1. `getOrInitNetworks` seeds 4 Networks + 4 Endpoints; idempotent.
2. `addNetwork(name, rpcUrl)` creates Network + first Endpoint atomically.
3. `addNetwork` rejects duplicate `name` for same profile.
4. `addNetwork` rejects when chain already exists in profile (DuplicateChainError).
5. `addNetwork` rejects `rpcUrl` already used in SAME Network.
6. `renameNetwork(id, name)` renames; rejects collision.
7. `deleteNetwork(id)` calls `purgeChain` then deletes row.
8. `deleteNetwork` rejects active id.
9. `setActiveNetwork(id)` updates active pointer; emits `onActiveNetworkChanged`; primes nodes cache; doesn't mutate `primaryEndpointId`.
10. `addEndpoint(networkId, label, rpcUrl)` succeeds when chainId matches.
11. `addEndpoint` rejects when chainId mismatches (`EndpointChainMismatchError`).
12. `addEndpoint` rejects rpcUrl already used in SAME Network.
13. `updateEndpoint` re-validates chainId.
14. `deleteEndpoint` rejects if primary.
15. `deleteEndpoint` rejects if last endpoint.
16. `setPrimaryEndpoint(networkId, endpointId)` updates Network.primaryEndpointId; emits event; clears `nodes` cache for that chainId.
17. `getNode(chainId)` resolves via primary endpoint; cache invalidation on swap.
18. `getNodeStatus(networkId)` uses primary endpoint URL.
19. `getNodeForUrl(url, fallbackChainId)` caches per-URL; `reportEndpointFailure` increments; 3 failures evict.
20. `purgeChain(profileId, chainId)` calls each service's `clearChainState` in deterministic order (mock services with spies).
21. `backup()` returns `Network[]` (new shape).
22. `restore(newShape)` accepts.
23. `restore(oldShape)` rejects with clear error.
24. `onProfileDeleted` calls `purgeChain` per network then deletes networks.
25. Concurrent `setPrimaryEndpoint` + `getNode(chainId)` — Lock semantics consistent.

### Storage version bump (PR-1)

No dedicated test. The version-bump path in `migrate.ts` is a destructive
wipe + reseed; the existing unit + e2e infra exercises the reseed leg
on every fresh-storage run. We do not write migration-style tests
(pre-seed v2 → run migrator → assert v3) because there is no v2 user
state to migrate. See `memory/feedback_no_migrations_pre_launch.md`.

### Integration (PR-1, ~6)

`network/service.integration.test.ts` + extend `profile/service.integration.test.ts`:
1. `createProfile()` → `getOrInitNetworks()` returns 4 Networks + 4 Endpoints.
2. Active profile switch evicts AztecNode cache.
3. `deleteProfile()` cascades purgeChain per network.
4. `purgeChain` with pending tx — TransactionService stops polling before AccountService deletes; PXE last; order verified via call timestamps.
5. Concurrent `addNetwork` + probe race — Lock serializes.
6. End-to-end `addNetwork → addEndpoint → setPrimary → switchActive` flow.

### E2E (PR-1 smoke, PR-3 expanded)

PR-1 smoke (existing tests still pass):
- networks.test.ts: 4 chain names; switch to local works.
- settings-crud.test.ts: add/delete network.

PR-3 expanded:
- endpoints.test.ts: add/edit/delete endpoint; set primary; continuity test (send tx on Endpoint A → swap to B → tx still resolves on A or fails over after 3 timeouts).
- sw-restart-network.test.ts: SW restart preserves active chain, active endpoint, pending-tx polling.

---

## 9. Risks tracked

1. **AztecNode cache invalidation on primary swap** — `setPrimaryEndpoint` evicts before emit. Test-covered (#16).
2. **PXE re-init on primary swap** — `ChainRuntimeRegistry.getOrInit` (`chain-runtime.ts:128-155`) compares `existing.rpcUrl` and disposes if changed. IDB persists; state continuity works. ~500ms-2s re-init cost. Acceptable.
3. **In-flight tx during primary swap** — `ReadWriteGuard` ensures in-flight `proveTx`/`simulateTx` finishes before `clear()`.
4. **Pending-tx polling race** — addressed via `submittedEndpointUrl` capture + `getNodeForUrl` URL-keyed cache.
5. **Last-endpoint deletion guard race** — service-level + UI guard.
6. **Endpoint chainId drift** — revalidate chainId on every `setPrimaryEndpoint`; show error toast on mismatch; don't swap.
7. **Backup restore from older versions** — rejected at restore time with clear toast.
8. **SW lifecycle vs config** — active endpoint state is in `chrome.storage.local` (durable). SW restart re-reads.
9. **`balance-projector.ts:118`** — replaced with `[0]` indexing (audit-found).
10. **`NetworkBadge.vue` tooltip** — updated to read primary endpoint URL.
11. **dApp protocol stability** — `INetworkRef.id` unchanged; `chainId` unchanged; `isDefault?` removed.
12. **Cascade safety** — awaited `purgeChain` coordinator; deterministic order; PXE last via SW→offscreen RPC.
13. **AuthRegistry orphaned authwits** — included in cascade.
14. **`updateNetwork` chain-mismatch** — old behavior allowed silent chain move; new `renameNetwork` only renames.
15. **Deleting active chain** — guard rejects.
16. **Smart-add concurrent probes** — Lock serializes.

---

## 10. Rollback

Per-PR `git revert`. Storage version 3 on disk; if reverting, the v2 service shape doesn't read v3 storage so user lands in seed-defaults state on next boot. Pre-launch acceptable.

---

## 11. Verification commands

```bash
bun run typecheck
bun run --filter '@nulo/extension' test
bun run --filter '@nulo/aztec-runtime' test
bun run lint
bun run --filter '@nulo/extension' build:chrome
bun run test:e2e
# After PR-3:
bun run test:e2e:all
```

---

## 12. Open questions for user

1. **PR breakdown**: 3 PRs (atomic core + endpoint UX + e2e/docs). Default: 3.
2. **Allow renaming seeded chains** ("Testnet" → "My Testnet"): default yes, like today.
3. **SECURITY.md endpoint-as-input subsection** in PR-3: default yes.
4. **Pending-tx card UI tooltip** ("Submitted via X"): defer to follow-up. Default: defer.

(Removed v3's migration-related questions since they're moot now.)

---

## 13. Estimated effort

- PR-1 (core): 2.5-3.5d (largest; ~32 new tests).
- PR-2 (endpoint UX): 1-1.5d.
- PR-3 (E2E + docs): 0.5-0.75d.
- Manual QA + iteration: 0.5d.

**Total: ~4.5-5.5d execution.**

---

## 14. Versioning

PR-1 → 0.13.10. PR-2 → 0.13.11. PR-3 → 0.14.0 (minor; first user-visible network UX redesign since pre-Nulo).

---

*End of plan-v4 (final, lean). Awaiting user approval. v3 + v3 audits preserved as historical artifacts.*
