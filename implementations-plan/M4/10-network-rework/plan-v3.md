# M4.10 — Network-model rework: split `Network` from `NetworkEndpoint` (v3, final)

> **Status: PLANNING (v3, post-dual-audit, EXECUTION-READY pending user approval).** This is the final plan. v1 (initial draft) and v2 (post-codex-design-pass) live alongside as historical artifacts. Audit results: `audit-codex-v2.md` (REJECT), `audit-agent-v2.md` (APPROVE WITH FIXES), and `audit-diff.md` (point-by-point response to each finding).
>
> **Audit verdicts addressed**: 5 codex BLOCKERs + 3 plan-agent BLOCKERs = 8 unique BLOCKERs. All resolved. 11 SHOULD-FIX items: 9 incorporated, 2 deferred with justification. NITS: incorporated where cheap.
>
> **Major v2 → v3 changes**:
> 1. **PR breakdown collapsed** from 5 to 3 (1 core + 1 endpoint UX + 1 docs/e2e). Compat-aliases-for-PR-1 strategy was unsound (popup reads `network.isDefault` directly — JS/Vue, not caught by TS). PR-1 now ships entity rewrite + migrator + UI plumbing + cascade + pending-tx pin atomically.
> 2. **Migrator wire format fixed**: `EntityStorage` stores JSON strings via `JSON.stringify`. v2 plan's `typeof value === "object"` filter would have skipped real rows. v3 spec uses explicit `JSON.parse`/`JSON.stringify` at the boundary + shape gate (skip rows already in v3 shape) + single atomic batched-set with deletes encoded as nullify writes; sentinel set last.
> 3. **`normalizeRpcUrl` fixed**: `new URL()` — normalize protocol+hostname only; preserve path/query/API keys.
> 4. **Cascade replaced with awaited purge coordinator**: `NetworkService.purgeChain(profileId, chainId)` calls each chain-keyed service's `clearChainState(profileId, chainId)` method directly, in order. `EventHandler.invoke` is fire-and-forget; not safe for cleanup. PxeService runs LAST via `PxeServiceClient.clearChainState` (NEW SW→offscreen RPC). `AuthRegistryService` added to the cascade.
> 5. **Backup contract preserved**: `backup()` still returns `Network[]` (array of new-shape Networks with nested endpoints). Restore inspects per-element shape (`element.endpoints` present → v3; `element.rpcUrl` + `element.isDefault` → v2). `restore()` returns `{ oldToNewNetworkId: Map<string, string> }` so callers (especially `import.vue`) can remap dependent records.
> 6. **`isDefault` removed entirely** (no compat getter): drop from new Network type, drop `find(isDefault)` from both CAIP resolvers, drop `isDefault?` from `INetworkRef`. Clean break.
> 7. **`setActiveNetwork(id)` + `onActiveNetworkChanged` event** explicit in PR-1 (not deferred to PR-4). Mutates `nulo:ui:lastActiveNetwork@<profileId>`-equivalent in NetworkService, primes AztecNode cache, emits event for UI sync. The mutation that's killed in cleanup is "implicit setDefault on chain switch from popup/init code" — PR-1 already replaces the call sites with `setActiveNetwork`.
> 8. **`Tx.submittedEndpointUrl?: string` in PR-1 spec** (not deferred to PR-4). Field add lives with the entity rewrite; writer/reader wired in PR-1.
> 9. **`getNodeForUrl(url, fallbackChainId)`** specified with **URL-keyed transient cache**. The returned node is bound to the literal URL until it fails three consecutive `getNodeInfo()` calls (mirrors today's getNodeStatus probe), then falls back to current primary. Cache entries auto-evict on `deleteEndpoint(url)`.
> 10. **`runStorageMigration(log, browserApi)` refactor**: accepts a `BrowserApi` port for testability; production caller passes the chrome adapter; tests pass `FakeBrowserApi`.
> 11. **Smart-add error handling**: probe errors `DuplicateChainError` → popup transforms to "Add as endpoint to <Network>?" flow. Concurrent probe race resolved by service-side lock.
> 12. **Restore conflict policy**: `restore()` rejects same `(profileId, chainId)` collision unless `force: true` (full-profile-import path passes force; ad-hoc restore doesn't).
> 13. **`Network.kind` canonicalization documented**: migration sets canonical kind for known seeded chainIds; renames pre-existing custom rows whose chainId matches a seed.
> 14. **`prevent-deleting-active-chain` guard**: `deleteNetwork` rejects if `id === currentActiveNetworkId`. UI shows "Switch to another chain first."
> 15. **E2E migration fixture infrastructure** (PR-3): pre-boot storage seeding via service-worker bootstrap hook.
> 16. **SECURITY.md endpoint-as-input addendum** (PR-3): document smart-add probe surface (already exists today; just acknowledge).
>
> **Pre-launch context**: zero production users. Migration is forward-only; no downgrade.
>
> **Out of scope (reaffirmed)**: automatic primary/fallback RPC failover. Plan reserves `primaryEndpointId` naming + `Network.kind` slot for the future expansion.

---

## 0. Context recap (why this exists)

`packages/extension/src/wallet/services/network/spec.ts:11-24`:

```ts
type Network = { id, profileId, name, rpcUrl, chainId, isDefault }
```

This row glues "logical chain identity" (`chainId`) to "endpoint identity" (`rpcUrl`). Adding a backup RPC for the same chain creates a peer Network row with the same `chainId`. PXE state at `pxe/${profileId}/${chainId}` is already chain-keyed, so multiple Network rows with the same chainId already share PXE state — the data model lies.

Most consumers (`AccountService`, `TokenService`, `TokenBalanceService`, `TransactionService`, `NoteService`, `FpcService`) are already chain-keyed by `chainId`. The new model lines up with what the rest of the system already assumes. The fix is contained to `NetworkService` + the UI that consumes its rows + a deterministic cascade for the chain-purge case.

The earlier M4.10 v0 plan (`implementations-plan/M4/10/plan.md`, DEFERRED) tried to FRAGMENT PXE per-rpcUrl. That was backwards. This rework embraces sharing.

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

    /** User-customizable display name. Seeded from defaults. */
    name: string

    /** Persisted user choice — which endpoint receives traffic by default. */
    primaryEndpointId: string

    /** Endpoints owned by this Network. Always ≥1. */
    endpoints: NetworkEndpoint[]

    /** Optional chain-type metadata. Set at seed time + canonicalized at migration. */
    kind?: "mainnet" | "testnet" | "devnet" | "local" | "custom"
}

type NetworkEndpoint = {
    /** Stable id. */
    id: string
    /** RPC URL (case-preserved on path/query, host lowercased). */
    rpcUrl: string
    /** Optional human-readable label. */
    label?: string
}
```

**Storage shape**: single `EntityStorage<Network>` rooted at `nulo:core:networks`. JSON-serialized per `EntityStorage.set` (`packages/wallet-core/src/storage/entity_storage.ts:57`). Endpoints nested inside Network — atomic per-Network mutation.

### Design decisions (v3 final)

**(a) Nested aggregate.** One storage root. Per-Network mutation is atomic. Migration writes one JSON blob per Network. Audit-confirmed.

**(b) `primaryEndpointId` semantics**: persisted user intent. Future fallback adds runtime "currently bound endpoint" without renaming this field.

**(c) Drop `isDefault` entirely.** From Network type. From `caip.ts:74` + `extension/src/wallet/utils/caip.ts:93` (drop `find(isDefault)` clauses). From `wallet-bridge/src/session-types.ts:33` (drop `INetworkRef.isDefault?`). After migration there's exactly one Network per chainId; `networks[0]` is correct.

**(d) `Network.name` is chain label.** Seeded names ("Alpha Mainnet", "Testnet", "Devnet", "Local Network") live for the chain (`Network.name`). Old non-default same-chain row names move into `endpoint.label`.

**(e) `Network.kind`**: optional, set at seed time; **migration canonicalizes** known chainIds to their canonical kind regardless of what `Network.name` was. This means: a user who renamed "Testnet" to "My Testnet" pre-migration → still classified `kind: "testnet"` post-migration (chainId is the source of truth). Custom chains → `kind: "custom"`.

**(f) NO `healthStatus` persisted.** UI shows transient probe results computed from `getNodeStatus(networkId)`. When fallback ships, the persisted shape grows `lastSeenHealthy?: number`, `priority?: number` — no churn.

**(g) Validation rules** (per-Network scope, not per-profile):
- Endpoint `rpcUrl` must pass `getNodeInfo()` and produce the same `chainId` as its Network.
- A Network has ≥1 Endpoint.
- Two endpoints in the SAME Network can't share a normalized `rpcUrl`.
- One Network per (profileId, chainId): `addNetwork` rejects if a Network with the probed chainId already exists in the profile (smart-add UI converts this to "add as endpoint" flow).
- (Cross-Network `rpcUrl` reuse is ALLOWED — not a security boundary; e.g. `localhost:8080` on two different profiles, same URL, different chains in unusual setups.)

**(h) Awaited purge coordinator** (replaces v2's event-cascade).

`NetworkService.purgeChain(profileId: string, chainId: number): Promise<void>` is a new internal method. `deleteNetwork` calls it before deleting the Network row. `onProfileDeleted` calls it for each network of the deleted profile.

```ts
async purgeChain(profileId: string, chainId: number): Promise<void> {
    // 1. Stop any tx polling worker on this chain (avoid races against deletion)
    await this.transactionService.stopPollingForChain(profileId, chainId)
    // 2. Delete chain-keyed entities in dependency order
    await this.transactionService.clearChainState(profileId, chainId)
    await this.tokenBalanceService.clearChainState(profileId, chainId)
    await this.tokenService.clearChainState(profileId, chainId)
    await this.fpcService.clearChainState(profileId, chainId)
    await this.authRegistryService.clearChainState(profileId, chainId)
    await this.accountService.clearChainState(profileId, chainId)
    await this.operationJournalService.clearChainState(profileId, chainId)
    // 3. PXE last (via SW→offscreen RPC)
    await this.pxeServiceClient.clearChainState(profileId, chainId)
    // 4. Emit event for UI refresh ONLY (no consumer-side cleanup)
    this.emit("onChainPurged", { profileId, chainId })
}
```

Each chain-keyed service exposes a NEW `clearChainState(profileId, chainId)` method that wipes its rows for that chain. The PXE method goes through `PxeServiceClient.clearChainState` → SW→offscreen RPC → `PxeService.clearChainState` (offscreen) → IndexedDB delete `pxe/${profileId}/${chainId}`.

**Why this beats events**:
- Awaited completion means `deleteNetwork` truly returns when chain is purged.
- Deterministic order prevents "PXE clears DB while TransactionService is mid-poll."
- Single direct caller (NetworkService) → no double-fire on profile delete (subscribers don't subscribe to `onNetworkDeleted` for cleanup; they expose a method NetworkService calls).
- `onProfileDeleted` cascade in NetworkService now calls `purgeChain` per network, then deletes the network. Other services no longer subscribe to `onProfileDeleted` for chain-state cleanup (they DO subscribe for profile-level cleanup like `nulo:core:profiles`).

**Init-order contract**: NetworkService `init()` resolves `services.get(<peer service>.name)` for all peers in the cascade. EventHandler instances are constructor-initialized so subscription is safe pre-`init()`. Documented in service.ts top-comment.

**(i) `prevent-deleting-active-chain` guard**: `deleteNetwork(id)` rejects with `Error("Cannot delete the active network. Switch to another chain first.")` if `id === currentActiveNetworkId`. UI hides the delete button on the active row + shows the hint.

---

## 2. Architectural invariants preserved

1. **`NetworkInfo { profileId, chainId, rpcUrl }`** (`packages/aztec-runtime/src/pxe/chain-runtime.ts:18-22`) **stays unchanged.** PxeService doesn't know about endpoints. NetworkService synthesizes `NetworkInfo` from `(Network, primaryEndpoint.rpcUrl)`.
2. **PXE storage key** `pxe/${profileId}/${chainId}` unchanged.
3. **`AccountService` API + storage shape unchanged.** Already chain-keyed. NEW method: `clearChainState(profileId, chainId)`.
4. **dApp bridge surface** (`INetworkRef`, `INetworkReader`, CAIP) — minor: `isDefault?` removed from `INetworkRef`; `find(isDefault)` clauses dropped from CAIP resolvers. Networks per chainId post-migration is exactly 1; `networks[0]` is correct.
5. **`getRandomHex`, `EntityStorage`, `Lock`, `ReadWriteGuard`** plumbing unchanged.
6. **Backup wire format** stays array-shaped (`Network[]`). Restore detects per-element shape.

---

## 3. Surface area (full file map, all audit additions integrated)

### NetworkService consumers (touch PR-1)
- `packages/extension/src/wallet/services/network/{spec,service,client}.ts` — REWRITE.
- `packages/extension/src/wallet/services/network/service.test.ts` — EXTEND (~25 unit tests).
- `packages/extension/src/wallet/services/network/service.integration.test.ts` (NEW) — ~6 integration tests.
- `packages/extension/src/wallet/runtime.ts:27` — service registration.
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — extend.

### Chain-keyed services with new `clearChainState` method (PR-1)
- `packages/extension/src/wallet/services/account/service.ts` — `clearChainState(profileId, chainId)`.
- `packages/extension/src/wallet/services/transaction/service.ts` — `stopPollingForChain` + `clearChainState`. Plus `Tx.submittedEndpointUrl` field add + writer (sendTx) + reader (`updateTx`) wiring.
- `packages/extension/src/wallet/services/token-balance/service.ts` — `clearChainState`.
- `packages/extension/src/wallet/services/token/service.ts` — `clearChainState`.
- `packages/extension/src/wallet/services/fpc/service.ts` — `clearChainState`.
- `packages/extension/src/wallet/services/auth-registry/service.ts` — `clearChainState` (clears authwits associated with deleted accounts).
- `packages/extension/src/wallet/services/operation-journal/service.ts` — `clearChainState` (clears `nulo:journal@*` records with matching networkId from `chrome.storage.session`).
- `packages/aztec-runtime/src/pxe/service.ts` — `clearChainState({profileId, chainId})` (offscreen).
- `packages/aztec-runtime/src/pxe/spec.ts` — add method to spec; `client.ts` exposes RPC.
- `packages/extension/src/wallet/services/token-balance/balance-projector.ts:118` — replace `find(x => x.isDefault)` with `[0]`.

### Storage / migration (PR-1)
- `packages/extension/src/wallet/storage/migrate.ts` — bump `CURRENT_VERSION` 2→3; refactor signature to `runStorageMigration(log, browserApi)`; append `migrateNetworksV2toV3`.
- `packages/extension/src/wallet/storage/migrate.networks.test.ts` (NEW) — 11 migration tests (codex's 4 + plan-agent's 4 + my baseline 3).
- All callers of `runStorageMigration` updated to pass browserApi.

### Wallet-bridge (PR-1, minor)
- `packages/wallet-bridge/src/session-types.ts:33` — drop `isDefault?: boolean` from `INetworkRef`.
- `packages/wallet-bridge/src/caip.ts:74` — replace `networks.find(n => n.isDefault) ?? networks[0]` with `networks[0]`. Update test if any.
- `packages/extension/src/wallet/utils/caip.ts:93` (mirror in extension) — same.

### Popup UI (PR-1, except endpoint-detail UX → PR-2)
- `packages/extension/src/popup/app.vue:75-103` — `initNetworks()`:
  - Drop `find(n => n.isDefault)` (line 97).
  - Replace `setDefault` calls with `setActiveNetwork`.
  - Subscribe to `onActiveNetworkChanged` (renamed from `onDefaultNetworkChanged`).
- `packages/extension/src/stores/app.store.ts:88-109` — `network`, `networks`, store mutators:
  - `network` is now the new Network shape (with nested endpoints).
  - `primaryEndpoint: computed<NetworkEndpoint>` derived from `network.endpoints + primaryEndpointId`.
  - `removeNetwork`, `setActiveNetwork`, `setPrimaryEndpoint`, `addEndpoint`, `updateEndpoint`, `deleteEndpoint` mutators.
  - `updateNetwork(id, name, url)` → `renameNetwork(id, name)`.
- `packages/extension/src/popup/components/popups/NetworksPopup.vue` — chain-only switching. Drop `setDefault` side-effect.
- `packages/extension/src/popup/components/popups/NewNetworkPopup.vue` — REWRITE with smart-add (catches DuplicateChainError → switches to "add as endpoint" flow); drops `notAllowedNetworkUrls` cross-Network check.
- `packages/extension/src/popup/components/popups/EditNetworkPopup.vue` — rename Network only (no rpcUrl input).
- `packages/extension/src/popup/pages/settings/networks/index.vue` — list view: one row per Network (not endpoint). Drop `setDefault` side-effect of "tap to make active."
- `packages/extension/src/popup/components/modules/general/NetworkBadge.vue:46` — tooltip `node.rpcUrl` → `network.endpoints.find(e => e.id === network.primaryEndpointId)?.rpcUrl`.
- `packages/extension/src/popup/components/popups/SelectNetworksPopup.vue:87` — direct `network.rpcUrl` read (audit-found vestigial; might be unused — verify; if dead, delete the file).
- `packages/extension/src/popup/components/modules/general/BalanceView.vue:208-262` — no caller change, but rely on migrator remapping `nulo:ui:balanceDisplayOption@<profileId>` keys.

### NEW endpoint UX (PR-2 — separate)
- `packages/extension/src/popup/pages/settings/networks/[id].vue` (NEW) — per-Network detail page.
- `packages/extension/src/popup/components/popups/NewEndpointPopup.vue` (NEW).
- `packages/extension/src/popup/components/popups/EditEndpointPopup.vue` (NEW).
- `packages/extension/src/stores/popup.store.ts` — register new popup types.
- `packages/extension/src/stores/cache.store.ts` — add `endpointToEditIdx`, `endpointToEditNetworkId`.
- `packages/extension/src/popup/components/popups/PopupManager.vue` — register new popups.

### Backup / restore (PR-1)
- `packages/extension/src/wallet/services/network/service.ts:320-352` — `backup() → Network[]` (new shape, array preserved). `restore(networks: unknown[]): { oldToNewNetworkId: Map<string, string> }` — shape-detects per element, returns mapping for caller remapping.
- `packages/extension/src/popup/pages/import.vue:374, 389-403` — consume `oldToNewNetworkId` returned by NetworkService.restore; remap `accountAddress`, `tokenId`, etc., using the map. Reject conflict (per-element `(profileId, chainId)` already present) with toast.
- `packages/extension/src/popup/pages/settings/security/export/full.vue` — no caller change (still calls `s.backup()` which now returns `Network[]` with new shape).

### E2E tests (PR-3, plus smoke after each PR)
- `packages/extension/tests/e2e/network/networks.test.ts` — extend.
- `packages/extension/tests/e2e/network/endpoints.test.ts` (NEW).
- `packages/extension/tests/e2e/migration.test.ts` (NEW, non-network suite).
- `packages/extension/tests/e2e/sw-restart-network.test.ts` (NEW) — codex-requested MV3 SW restart test.
- `packages/extension/tests/e2e/fixtures/storage-seed.ts` (NEW) — pre-boot storage seeding hook.
- `packages/extension/tests/e2e/fixtures/helpers.ts` — add `addEndpoint`, `setPrimaryEndpoint`, `deleteEndpoint`, `navigateToNetworkDetail`.

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

**`NetworkService.getNodeForUrl(url, fallbackChainId)`** (NEW, codex-spec'd):
```ts
private readonly transientNodes = new Map<string, { node: AztecNode; failures: number }>()

public async getNodeForUrl(url: string, fallbackChainId: number): Promise<AztecNode> {
    let entry = this.transientNodes.get(url)
    if (!entry) {
        // Verify URL is still a known endpoint of some Network (security boundary)
        const isKnown = await this.isKnownEndpointUrl(url)
        if (!isKnown) {
            return this.getNode(fallbackChainId)  // URL retired, fall back
        }
        entry = { node: this.nodeFactory.createNode(url), failures: 0 }
        this.transientNodes.set(url, entry)
    }
    return entry.node
}

/** Called by transaction/service.ts on getTxReceipt failure. */
public reportEndpointFailure(url: string): void {
    const entry = this.transientNodes.get(url)
    if (!entry) return
    entry.failures += 1
    if (entry.failures >= 3) {
        this.transientNodes.delete(url)  // give up; next call falls back
    }
}
```

`deleteEndpoint` evicts `transientNodes.get(deletedUrl)`.

**Pending-tx polling pin** (`transaction/service.ts:148`):
```ts
private async updateTx(tx: Tx) {
    let node: AztecNode
    if (tx.submittedEndpointUrl) {
        try {
            node = await this.networkService.getNodeForUrl(tx.submittedEndpointUrl, tx.chainId)
        } catch {
            node = await this.networkService.getNode(tx.chainId)
        }
    } else {
        node = await this.networkService.getNode(tx.chainId)
    }
    try {
        const receipt = await node.getTxReceipt(TxHash.fromString(tx.hash))
        // ... rest unchanged
    } catch (err) {
        if (tx.submittedEndpointUrl) this.networkService.reportEndpointFailure(tx.submittedEndpointUrl)
        throw err
    }
}
```

`sendTx` writes `tx.submittedEndpointUrl = primaryEndpoint.rpcUrl` at submission time. New txs always have it; old (pre-PR-1) txs are wiped by the v2→v3 migrator.

---

## 5. Migration strategy (final, both audits applied)

### `runStorageMigration(log, browserApi)` signature

```ts
export async function runStorageMigration(
    log: (msg: string) => void,
    browserApi: BrowserApi,
): Promise<void> {
    // ... existing v2→? branch plus new v2/3→3 logic
}
```

`browserApi.storage.local` and `browserApi.storage.session` are the storage areas. `FakeBrowserApi` (`packages/wallet-core/src/testing/fake-browser-api.ts`) supports both.

### Algorithm (v3 migrator — wire-format-correct)

```ts
async function migrateNetworksV2toV3(log, local, session): Promise<void> {
    // 1. Read all rows under "nulo:core:networks@*"
    const all = await local.get(undefined)
    const oldRows: OldNetwork[] = []
    const alreadyV3Ids = new Set<string>()

    for (const [key, raw] of Object.entries(all)) {
        if (!key.startsWith("nulo:core:networks@")) continue
        if (typeof raw !== "string") continue  // EntityStorage stores JSON strings
        let value: unknown
        try { value = JSON.parse(raw) } catch { continue }
        if (!value || typeof value !== "object") continue

        // Shape gate: if value already has `endpoints` array, it's v3 (skip)
        if ("endpoints" in value && Array.isArray((value as { endpoints?: unknown }).endpoints)) {
            alreadyV3Ids.add(key)
            continue
        }
        // v2 row check: must have rpcUrl
        if (!("rpcUrl" in value)) continue
        oldRows.push(value as OldNetwork)
    }

    if (oldRows.length === 0 && alreadyV3Ids.size === 0) {
        log("No networks to migrate (fresh install or already v3).")
        return  // sentinel set by outer runStorageMigration
    }

    // 2. Group by (profileId, chainId)
    const groups = new Map<string, OldNetwork[]>()
    for (const row of oldRows) {
        const k = `${row.profileId}:${row.chainId}`
        const arr = groups.get(k) ?? []
        arr.push(row)
        groups.set(k, arr)
    }

    // 3. Read UI keys to remap
    const uiKeys = [
        "nulo:ui:activeNetwork",
        ...new Set(oldRows.map(r => `nulo:ui:lastActiveNetwork@${r.profileId}`)),
        ...new Set(oldRows.map(r => `nulo:ui:balanceDisplayOption@${r.profileId}`)),
    ]
    const uiState = await local.get(uiKeys)

    const oldToNewNetworkId = new Map<string, string>()

    try {
        // 4. Build new aggregates per group
        const newRows: NewNetwork[] = []
        for (const [_, rows] of groups) {
            const lastActiveId = parseUiValue(uiState[`nulo:ui:lastActiveNetwork@${rows[0].profileId}`])
            const canonical =
                rows.find(r => r.id === lastActiveId) ??
                rows.find(r => r.isDefault) ??
                [...rows].sort((a, b) => a.id.localeCompare(b.id))[0]  // deterministic

            const networkId = canonical.id
            const networkName = deriveChainName(canonical.chainId, canonical.name)
            const networkKind = deriveChainKind(canonical.chainId)

            const endpoints = rows.map(r => ({
                id: r.id === canonical.id ? `${r.id}-ep0` : r.id,
                rpcUrl: normalizeRpcUrl(r.rpcUrl),
                label: r.id === canonical.id ? undefined : (r.name === canonical.name ? undefined : r.name),
            }))
            // Dedupe by URL (keep first by source order)
            const dedupedEndpoints = dedupeEndpointsByUrl(endpoints)
            const primaryEndpointId = dedupedEndpoints.find(e => e.id.startsWith(`${canonical.id}-ep`))?.id
                ?? dedupedEndpoints[0].id

            newRows.push({
                id: networkId,
                profileId: canonical.profileId,
                chainId: canonical.chainId,
                name: networkName,
                primaryEndpointId,
                endpoints: dedupedEndpoints,
                kind: networkKind,
            })

            for (const row of rows) {
                oldToNewNetworkId.set(row.id, networkId)
            }
        }

        // 5. Build atomic batched-set
        const writes: Record<string, unknown> = {}
        for (const net of newRows) {
            writes[`nulo:core:networks@${net.id}`] = JSON.stringify(net)
        }

        // Remap UI keys
        const profileIds = new Set(oldRows.map(r => r.profileId))
        for (const profileId of profileIds) {
            const lastActiveKey = `nulo:ui:lastActiveNetwork@${profileId}`
            const lastActive = parseUiValue(uiState[lastActiveKey])
            if (lastActive && oldToNewNetworkId.has(lastActive)) {
                writes[lastActiveKey] = oldToNewNetworkId.get(lastActive)!
            }

            const balanceKey = `nulo:ui:balanceDisplayOption@${profileId}`
            const optionsMap = uiState[balanceKey] as Record<string, string> | undefined
            if (optionsMap) {
                const remapped: Record<string, string> = {}
                for (const [oldId, opt] of Object.entries(optionsMap)) {
                    const newId = oldToNewNetworkId.get(oldId) ?? oldId
                    if (!(newId in remapped)) remapped[newId] = opt
                }
                writes[balanceKey] = remapped
            }
        }
        const legacyActive = uiState["nulo:ui:activeNetwork"] as string | undefined
        if (legacyActive && oldToNewNetworkId.has(legacyActive)) {
            writes["nulo:ui:activeNetwork"] = oldToNewNetworkId.get(legacyActive)!
        }

        // Encode deletes as nullify writes (then explicit remove to free quota)
        const deleteKeys: string[] = []
        for (const [oldId, newId] of oldToNewNetworkId) {
            if (oldId !== newId) deleteKeys.push(`nulo:core:networks@${oldId}`)
        }

        // 6. Single atomic set; chrome.storage.local.set IS atomic for a batched object.
        await local.set(writes)

        // Explicit remove (separate call; if it fails after writes succeed, we still
        // converge on rerun thanks to the v3 shape gate above).
        if (deleteKeys.length) await local.remove(deleteKeys)

        // Clear journal records (networkIds may be stale)
        const sessionAll = await session.get(undefined)
        const journalKeys = Object.keys(sessionAll).filter(k => k.startsWith("nulo:journal@"))
        if (journalKeys.length) await session.remove(journalKeys)

        log(`Network migration: ${oldRows.length} v2 rows + ${alreadyV3Ids.size} pre-existing v3 rows → ${newRows.length} v3 networks.`)
    } catch (err) {
        log(`Lossless migration failed: ${String(err)}. Falling back to destructive reseed.`)
        const allKeys = Object.keys(all)
        const networkKeys = allKeys.filter(k =>
            k.startsWith("nulo:core:networks@") ||
            k.startsWith("nulo:ui:lastActiveNetwork@") ||
            k === "nulo:ui:activeNetwork" ||
            k.startsWith("nulo:ui:balanceDisplayOption@")
        )
        if (networkKeys.length) await local.remove(networkKeys)
        const sessionAll2 = await session.get(undefined)
        const journalKeys2 = Object.keys(sessionAll2).filter(k => k.startsWith("nulo:journal@"))
        if (journalKeys2.length) await session.remove(journalKeys2)
    }
}
```

### Helpers

```ts
function normalizeRpcUrl(rawUrl: string): string {
    try {
        const u = new URL(rawUrl)
        u.protocol = u.protocol.toLowerCase()
        u.hostname = u.hostname.toLowerCase()
        // u.pathname / u.search preserved as-is (case + trailing-slash sensitive)
        let s = u.toString()
        // URL.toString() always includes trailing slash for path "/"; preserve original intent
        if (!rawUrl.endsWith("/") && s.endsWith("/")) s = s.slice(0, -1)
        return s
    } catch {
        return rawUrl  // not a parseable URL; let validation reject it elsewhere
    }
}

function deriveChainName(chainId: number, fallbackName: string): string {
    const KNOWN: Record<number, string> = {
        2934756904: "Alpha Mainnet",
        4138294185: "Testnet",
        896946031: "Devnet",
        0: "Local Network",
    }
    return KNOWN[chainId] ?? fallbackName ?? `Custom chain ${chainId}`
}

function deriveChainKind(chainId: number): Network["kind"] {
    if (chainId === 0) return "local"
    if (chainId === 2934756904) return "mainnet"
    if (chainId === 4138294185) return "testnet"
    if (chainId === 896946031) return "devnet"
    return "custom"
}

function dedupeEndpointsByUrl(endpoints: NetworkEndpoint[]): NetworkEndpoint[] {
    const seen = new Set<string>()
    const out: NetworkEndpoint[] = []
    for (const ep of endpoints) {
        if (seen.has(ep.rpcUrl)) continue
        seen.add(ep.rpcUrl)
        out.push(ep)
    }
    return out
}
```

### Migration tests (PR-1, 11)

`storage/migrate.networks.test.ts`:
1. Idempotent: run twice; second is no-op (sentinel guard).
2. Empty storage: no-op.
3. Single-row-per-chain: 1 Network + 1 Endpoint.
4. Multi-row-per-chain WITH `isDefault`: canonical correct.
5. Multi-row-per-chain WITHOUT `isDefault`: deterministic (id-sort) first row.
6. UI key remap (`lastActiveNetwork` non-canonical → canonical post-migration).
7. balanceDisplayOption map remap (non-canonical keys collapsed to canonical).
8. Mid-write crash (storage rejection mock): sentinel NOT set; rerun succeeds.
9. Destructive fallback path: simulated transform-throw → all network keys removed; sentinel set.
10. **Mixed storage** (codex-requested): one v3 row already written + one v2 row + sentinel absent → shape gate detects v3, migrates only v2.
11. **URL case preservation** (codex-requested): `https://EXAMPLE.com/Path?KEY=Value` → `https://example.com/Path?KEY=Value` (host lowercased, path preserved).

---

## 6. UX redesign (final)

(Same as v2 §6 with these tweaks:)

- **Smart-add error handling**: NewNetworkPopup catches `DuplicateChainError` from service (thrown when probed chainId matches an existing Network in profile). Popup transforms to "This RPC is on **Testnet**. Add as a backup endpoint?" with single button → calls `addEndpoint` instead. Also catches `DuplicateEndpointError` (URL already exists in this Network) → toast.
- **Concurrent probe race**: `addNetwork` / `addEndpoint` acquire the `network` Lock before chainId probe. Two concurrent probes serialize.
- **Add-Endpoint probe TIMEOUT**: 10s timeout on `getNodeInfo` probe → toast "RPC didn't respond in 10 seconds. Check the URL."
- **Active-chain delete guard**: list view hides delete button on the active row + shows hint "Switch to another chain first."
- **Auto-account-create on chain switch** (existing `app.vue:143-146`): preserved. `setActiveNetwork` triggers it as today.
- **Pending-tx card UI (codex test gap)**: in-flight tx cards optionally show a tooltip "Submitted via {endpointLabel || endpointHost}" — read from `tx.submittedEndpointUrl`. Defer if it adds churn.

---

## 7. PR breakdown (3 PRs total)

### PR-1 — Core entity rewrite + migrator + UI plumbing + cascade + pending-tx pin

**Branch**: `m4.10/01-core`

This is a single atomic PR. Each commit within the PR is independently reviewable:

- Commit 1: spec + service (shell, methods stubbed), zod, types.
- Commit 2: storage migrator + `runStorageMigration(browserApi)` refactor + 11 migration tests.
- Commit 3: service implementation (CRUD + getNode + getNodeForUrl + cache invalidation) + ~25 unit tests + ~6 integration tests.
- Commit 4: chain-keyed services `clearChainState` methods + tests.
- Commit 5: `purgeChain` coordinator + `PxeServiceClient.clearChainState` (offscreen RPC) + integration test for purge with active pending tx.
- Commit 6: UI plumbing — app.vue init, app.store, NetworksPopup, NewNetworkPopup smart-add, EditNetworkPopup, settings/networks index, NetworkBadge tooltip, balance-projector consumer fix, drop SelectNetworksPopup if dead.
- Commit 7: `Tx.submittedEndpointUrl` field + sendTx writer + updateTx reader + `reportEndpointFailure` wiring.
- Commit 8: wallet-bridge cleanup (drop `INetworkRef.isDefault?` + `find(isDefault)` clauses); extension/utils/caip mirror.
- Commit 9: backup/restore new shape + import.vue remap consumer.

**Verification gate**:
- `bun run typecheck` (all 8 packages).
- `bun run --filter '@nulo/extension' test` (~40 new tests).
- `bun run --filter '@nulo/aztec-runtime' test` (PXE clearChainState test).
- `bun run lint`.
- `bun run build:chrome`.
- `bun run test:e2e` (smoke; UI changed for chain-switch but settings detail isn't shipped yet — existing networks.test.ts, settings-crud.test.ts pass).
- Manual smoke: chain switch works; settings → networks lists chains (one row per chain); add network with new chainId works; add network with existing chainId triggers "add endpoint" prompt.

**Failure mode if merged alone**: Endpoint UX (per-chain detail page, add/edit/delete endpoint popups) not shipped — user can use chains but can't add a backup endpoint via UI. Service API supports it but no UI surface. PR-2 ships the UX.

---

### PR-2 — Endpoint UX (settings detail + popups)

**Branch**: `m4.10/02-endpoint-ux`

**Files**:
- `packages/extension/src/popup/pages/settings/networks/[id].vue` (NEW).
- `packages/extension/src/popup/components/popups/NewEndpointPopup.vue` (NEW).
- `packages/extension/src/popup/components/popups/EditEndpointPopup.vue` (NEW).
- popup.store + cache.store + PopupManager registrations.

**Verification gate**:
- typecheck + lint + build clean.
- E2E smoke: navigate to chain detail; add endpoint (RPC probe); edit label; delete non-primary endpoint; "delete primary" disabled hint.
- Manual smoke: full endpoint CRUD.

**Failure mode if merged alone**: depends on PR-1.

---

### PR-3 — E2E expansion + docs

**Branch**: `m4.10/03-e2e-docs`

**Files**:
- `packages/extension/tests/e2e/network/endpoints.test.ts` (NEW) — endpoint CRUD + primary swap + state continuity.
- `packages/extension/tests/e2e/migration.test.ts` (NEW, non-network).
- `packages/extension/tests/e2e/sw-restart-network.test.ts` (NEW) — codex-requested MV3 SW restart after primary swap + after pending-tx submission.
- `packages/extension/tests/e2e/fixtures/storage-seed.ts` (NEW) — pre-boot storage seeding.
- `packages/extension/tests/e2e/fixtures/helpers.ts` — endpoint helpers.
- `implementations-plan/M4/DECISIONS.md` — append M4.10 v3 decision.
- `implementations-plan/M4/10/plan.md` — top-of-file note "SUPERSEDED".
- `implementations-plan/M4/README.md` — bump M4 status.
- `SECURITY.md` — append "Endpoint as input" subsection (smart-add probe surface; already exists pre-rework, now documented).

**Verification gate**:
- `bun run test:e2e:all` (smoke + network suite).
- E2E continuity test (codex's): send tx on Endpoint A → swap to B mid-pending → assertion: tx still resolves on A (or fails over per `reportEndpointFailure` after 3 timeouts).
- Migration e2e: pre-seed v2 storage → boot → verify v3 shape.

**Failure mode if merged alone**: depends on PR-1+PR-2.

---

## 8. Test plan (overall, audit-supplemented)

### Unit (PR-1, ~25)

`network/service.test.ts`:
1-25 from plan-v2 §8, with these adjustments:
- Test 4: rephrased to "rejects duplicate `rpcUrl` within the SAME Network" (cross-Network reuse allowed).
- Tests 7, 15: moved to integration suite (event emission requires real init).
- New test 26: `setActiveNetwork(id)` updates internal active-id pointer; emits `onActiveNetworkChanged`; primes nodes cache; does NOT mutate `primaryEndpointId`.
- New test 27: `getNodeForUrl(url, fallbackChainId)` caches per-URL; `reportEndpointFailure` increments; after 3 failures evicts.
- New test 28: `purgeChain(profileId, chainId)` calls each service's `clearChainState` in deterministic order (mock services with spies).
- New test 29: `deleteNetwork(activeId)` rejects with appropriate error.

### Migration (PR-1, 11)

See §5.

### Integration (PR-1, ~7)

`network/service.integration.test.ts` + extend `profile/service.integration.test.ts`:
1-6 from plan-v2 §8.
7. New: `purgeChain` with pending tx — TransactionService stops polling before AccountService deletes; PXE last; assertion: order verified via call timestamps.

### E2E (PR-1 smoke + PR-3 expanded)

PR-1 smoke (existing tests still pass):
- networks.test.ts (4 chain names visible).
- settings-crud.test.ts (add/delete network).

PR-3 expanded:
- endpoints.test.ts: add endpoint, edit, delete non-primary, set primary, continuity test.
- migration.test.ts: pre-seed v2 → v3 conversion verified.
- sw-restart-network.test.ts: SW restart preserves active chain + active endpoint; pending-tx polling preserved across restart.

---

## 9. Risks tracked (final)

(Same as v2 §9, plus:)

19. **Migrator wire format** (codex BLOCKER 1) — addressed via JSON.stringify/parse + shape gate.
20. **`normalizeRpcUrl` corruption** (codex BLOCKER 2) — addressed via `new URL()` + protocol/hostname-only normalization.
21. **PR-1 compat strategy collapse** (codex BLOCKER 3 + plan-agent S6) — addressed by merging UI plumbing into PR-1.
22. **Cascade event-handler fire-and-forget** (codex BLOCKER 4 + plan-agent S1) — addressed via awaited `purgeChain` coordinator.
23. **Backup contract caller breakage** (codex BLOCKER 5 + plan-agent S2) — addressed by preserving `Network[]` array shape; restore returns `oldToNewNetworkId`.
24. **AuthRegistry missing from purge** (codex) — added.
25. **PXE in offscreen** (codex) — addressed via `PxeServiceClient.clearChainState` SW→offscreen RPC.
26. **Profile-delete double-fire** (codex + plan-agent) — addressed: subscribers no longer subscribe to `onNetworkDeleted` for cleanup; NetworkService calls cleanup methods directly.
27. **Restore conflict policy** (codex) — addressed via reject-on-collision unless `force: true`.
28. **Smart-add concurrency** (codex) — addressed via service-side Lock acquire before probe.
29. **`getNodeForUrl` lifecycle** (codex) — addressed via per-URL transient cache + 3-failure eviction.
30. **`Network.kind` canonicalization** (codex) — addressed: migration sets canonical kind for known chainIds regardless of name.
31. **Deleting active chain** (audit gap) — addressed via guard + UI hint.

---

## 10. Rollback strategy

Per-PR `git revert`. v3 sentinel is set after migration succeeds; rollback to v2 means leaving v3 storage shape on disk (the v2 service shape doesn't read it). For pre-launch this is acceptable; reseed on next forward roll.

---

## 11. Verification commands (per PR)

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

Manual QA: see plan-v1 §11 (preserved across versions).

---

## 12. Open questions for user (final, post-audit)

The audits closed most of v2's open questions. Remaining:

1. **PR breakdown**: 3 PRs (PR-1 atomic core + PR-2 endpoint UX + PR-3 e2e/docs) per v3, or split PR-1 further? **Default: 3 PRs (codex+plan-agent agree atomicity beats granularity for the core).** Confirm.

2. **`Network.kind` canonicalization**: migration overrides user's renamed seeded chain (`name: "My Testnet"`) with `kind: "testnet"` regardless of name. Does this surprise users? **Default: yes; user's name preserved, only `kind` is forced.** Confirm.

3. **`Tx.submittedEndpointUrl` cleanup**: pre-PR-1 pending txs lack the field; v2→v3 migrator wipes them as part of the existing tx-wipe behavior in `migrate.ts:13`. Confirm we're OK losing pending txs (pre-launch yes; for completeness, doc this).

4. **SECURITY.md addendum** for endpoint-as-input: required (codex test gap) or optional? **Default: ship it in PR-3.** Confirm.

5. **Pending-tx card UI tooltip "Submitted via X"**: ship in PR-2 or defer? **Default: defer (separate enhancement).** Confirm.

6. **`Network.name` rename for seeded chains**: today seeded chains can be renamed (`updateNetwork(id, name, rpcUrl)` allowed it). Post-rework `renameNetwork(id, name)` still allows. **Default: yes, user can rename Testnet to whatever they want.** Confirm — alternative is making seeded names read-only.

7. **Compat with old custom-RPC `Network.name`**: a user who pre-rework had named a custom Aztec RPC "Custom Aztec 999999" gets it preserved. But what if the chainId XORs to a known seeded chain? `deriveChainName` returns the canonical name and discards the user's custom name. Audit-flagged as confusing. **Default: prefer canonical name (cleaner data model). User can rename post-migration if they care.** Confirm.

---

## 13. Estimated effort (revised)

- Planning + dual audit + iterate (this is approximately complete).
- PR-1 (core): 3-4d (largest).
- PR-2 (endpoint UX): 1-1.5d.
- PR-3 (E2E + docs): 0.75-1d.
- Manual QA + iteration: 1d.

**Total: ~6-7d execution wall-time** (from PR-1 start to PR-3 merge).

---

## 14. Versioning & ship cadence

- PR-1 lands → bump 0.13.9 → 0.13.10.
- PR-2 lands → 0.13.11.
- PR-3 lands → 0.14.0 (minor; first user-visible network UX redesign since pre-Nulo).

---

*End of plan-v3 (final). Ready for user approval. See `audit-diff.md` for point-by-point response to every audit finding.*
