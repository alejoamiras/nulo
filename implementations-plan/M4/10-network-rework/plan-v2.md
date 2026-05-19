# M4.10 — Network-model rework: split `Network` from `NetworkEndpoint` (v2)

> **Status: PLANNING (v2, post-codex-consolidation, pre-audit).** Replaces the DEFERRED `implementations-plan/M4/10/plan.md` (per-RPC PXE isolation). Per `implementations-plan/M4/DECISIONS.md:209-228`, the user determined the v0 framing was backwards: PXE state SHOULD be shared per chain; the data model is the thing to fix.
>
> **What changed v1 → v2** (after codex xhigh review):
> - **Entity model**: switched from 2 EntityStorage roots (Network + NetworkEndpoint) to **1 nested aggregate** (Network owns endpoints[]). Eliminates a consistency invariant. Codex's pushback; agreed.
> - **Naming**: `activeEndpointId` → `primaryEndpointId` to leave room for the future "currently bound endpoint" runtime concept (auto-fallback).
> - **`Network.kind`** optional field added for chain-type metadata ("mainnet" | "testnet" | "devnet" | "local" | "custom").
> - **Surface map additions**: `token-balance/balance-projector.ts:118` (isDefault consumer I missed), `operation-journal/spec.ts:43` (networkId in journal records, must clear on migration), `transaction/service.ts:148-156` (pending tx polling — race I missed), `NetworkBadge.vue:46` (tooltip shows rpcUrl).
> - **Migration**: lossless-with-destructive-fallback (codex's recommendation); also remap `nulo:ui:balanceDisplayOption@<profileId>` map keys + clear `nulo:journal@*` from chrome.storage.session.
> - **PR restructure**: 4 work PRs + 1 docs (was 6) — codex-aligned ordering.
> - **`deleteNetwork` semantics**: full chain purge (cascading event handler in chain-keyed services). Today `deleteNetwork` orphans the Network row but leaves accounts/tx/balances/PXE on disk — a known cleanliness issue we fix here.
> - **Pending-tx polling pin**: capture submitted-endpoint snapshot at `sendTx` time so receipt polling stays bound to the originating endpoint. Endpoint swap mid-tx no longer redirects polling.
> - **`updateNetwork` chain-mismatch rejection**: today it can silently move a Network across chains (`service.ts:151-163`); v2 rejects.
> - **"Smart Add network"**: if user-supplied RPC's chainId matches an existing Network in the profile, popup offers "Add this as another endpoint for <Network name>" instead of creating a duplicate.
>
> **Audit tier**: dual (codex xhigh + Plan-agent) on this v2 before execution.
>
> **Scope flag**: `Network → Network + NetworkEndpoint` only. **Automatic primary/fallback RPC failover is OUT OF SCOPE** (user-flagged "complex; another expansion"). Plan reserves naming + structure to make adding it later trivial (`primaryEndpointId` semantics, no `healthStatus` persisted yet).
>
> **Pre-launch context**: zero production users. Storage migration can be modestly destructive if it dramatically simplifies the migrator. We still write a deterministic, idempotent migrator (production-grade) — the pattern is reusable for M4.7 when users exist.

---

## 0. Context recap (why this exists)

`packages/extension/src/wallet/services/network/spec.ts:11-24`:

```ts
type Network = { id, profileId, name, rpcUrl, chainId, isDefault }
```

This row glues "logical chain identity" (`chainId`) to "endpoint identity" (`rpcUrl`). Adding a backup RPC for the same chain creates a *peer Network row* with the same `chainId`, then `setDefault` (`service.ts:191`) does a chainId-scoped "default within a chainId" dance.

PXE state (`pxe/${profileId}/${chainId}` in `packages/aztec-runtime/src/pxe/chain-runtime.ts:78`) is already chain-keyed, so multiple Network rows with the same chainId already share PXE state. The data model lies — switching "Network" to a same-chain peer is, mechanically, switching endpoint within one logical chain.

Most of the codebase reads `chainId` to do its work — `AccountService.getAccounts(profileId, chainId, …)`, every PXE write taking `NetworkInfo { profileId, chainId, rpcUrl }`, `wallet-bridge`'s `INetworkRef.chainId`. **The new model lines up with what the rest of the system already assumes.**

The earlier M4.10 v0 plan tried to FRAGMENT PXE per-rpcUrl. That was backwards. This rework embraces sharing.

---

## 1. Target entity model

```ts
type Network = {
    /** Stable id (random hex). Used as `networkId` in operations + bridge. */
    id: string

    /** Profile scoping — Networks are per-profile. */
    profileId: string

    /** Logical chain identity (XOR of l1ChainId + rollupVersion, or 0 for localhost). */
    chainId: number

    /** User-customizable display name ("Testnet", "My Custom Aztec"). Seeded from defaults. */
    name: string

    /** Persisted user choice — which endpoint receives traffic by default. */
    primaryEndpointId: string

    /** Endpoints owned by this Network. ≥1 always. */
    endpoints: NetworkEndpoint[]

    /** Optional chain-type metadata for UI badges + sorting. Computed at seed time. */
    kind?: "mainnet" | "testnet" | "devnet" | "local" | "custom"
}

type NetworkEndpoint = {
    /** Stable id (random hex). */
    id: string
    /** RPC URL. */
    rpcUrl: string
    /** Optional human-readable label ("Primary", "DRPC Backup"). */
    label?: string
}
```

### Design decisions baked in (codex-consolidated)

**(a) Nested aggregate, not 2 EntityStorage roots.**

Why: `chrome.storage.local` has no joins or transactions. A separate `nulo:core:network-endpoints` root would force the service to maintain a consistency invariant (every endpoint has a Network; every Network's `primaryEndpointId` resolves) across two writes. Nested is one write per mutation — atomic.

Trade-off: storage-level entity scans for endpoints across networks aren't possible, but no consumer needs that.

**(b) `primaryEndpointId` semantics.**

This is the user's *persisted intent* — "the endpoint I want to use when nothing else is going on." Future fallback (out of scope) introduces "currently bound endpoint" — runtime, transient, not persisted. Naming `primaryEndpointId` (not `activeEndpointId`) leaves the latter slot open.

**(c) Drop `isDefault`.**

Old model used it to pick which Network row (within a chainId) was active. New model has exactly one Network per (profileId, chainId), so the disambiguator is gone. `wallet-bridge/INetworkRef.isDefault?: boolean` is already optional (`session-types.ts:33`); we stop populating it. `caip.ts:74` `resolveNetworkByChainId` falls through to `networks[0]` — works.

**(d) `Network.name` is the chain label, NOT endpoint identity.**

Today's seeded names ("Alpha Mainnet", "Testnet") live in `service.ts:57-89`. After rework, they apply to the Network (chain), not the endpoint. **Migration nuance**: an OLD non-default same-chain row's name might encode endpoint identity ("Testnet Mirror") — migrator turns those into `endpoint.label`, not `network.name`.

**(e) `Network.kind`.**

Optional, set at seed time. Local Network → `"local"`. The 3 testnet seeds → `"testnet"`/`"mainnet"`/`"devnet"`. User-added → `"custom"`. UI uses this for badge color/sorting (replaces parts of `getChainPosition()` over time, but doesn't have to in this PR).

**(f) NO `healthStatus` on Endpoint.**

Health status is the prerequisite for fallback; persisting it tempts ad-hoc usage. The plan reserves the slot (UI shows a transient "Connected"/"Unreachable" pill computed from a probe, not stored). When fallback ships (post-launch), the persisted shape adds `lastSeenHealthy?: number`, `priority?: number`. No churn at that point.

**(g) Validation rules**:
- Endpoint `rpcUrl` must pass `getNodeInfo()` and produce the same `chainId` as its Network. Mismatch → reject.
- Network has ≥1 Endpoint (cannot remove last; cannot create empty).
- Two endpoints in the SAME Network can't share an `rpcUrl` (UI guard + service guard).
- One Network per (profileId, chainId) — `addNetwork` rejects duplicate chainId.

**(h) `deleteNetwork` PURGES chain-scoped state** (codex's "snake under this rock" decision).

Today (`service.ts:170-186`), `deleteNetwork` removes only the Network row. Chain-scoped data (accounts, txs, token balances, tokens, PXE IndexedDB, operation-journal records) lingers invisibly. v2 fixes this:

- `deleteNetwork(networkId)` emits `onNetworkDeleted({ profileId, chainId, networkId })`.
- Each chain-keyed service subscribes:
  - `AccountService` deletes accounts where `(profileId, chainId)` matches.
  - `TransactionService`, `TokenBalanceService`, `TokenService`, `FpcService` — same.
  - `PxeService` (in offscreen) deletes `pxe/${profileId}/${chainId}` IDB.
  - `OperationJournalService` clears records with matching `networkId` from `chrome.storage.session`.
- UI confirm dialog: "Deleting Testnet wipes accounts, transactions, balances, and PXE state on this chain. Continue?"
- A guard prevents deleting the *current* Network without first switching off it (else the popup would fall into a no-active-chain state).

This is a behavioral change + new event surface. Documented + audited.

---

## 2. Architectural invariants preserved

1. **`NetworkInfo { profileId, chainId, rpcUrl }`** (`packages/aztec-runtime/src/pxe/chain-runtime.ts:18-22`) **stays unchanged.** PxeService doesn't know about endpoints. NetworkService synthesizes `NetworkInfo` from `(Network, primaryEndpoint.rpcUrl)` at lookup time.
2. **PXE storage key** `pxe/${profileId}/${chainId}` unchanged.
3. **`AccountService` API + storage shape unchanged** (`account/spec.ts:33-68`). Already chain-keyed.
4. **`TokenService`, `TokenBalanceService`, `TransactionService`, `NoteService`, `FpcService`, `AccountStateService`, `ExecutionService`, `TxRequestBuilder`** — consume `getNode(chainId)` or take a Network whose only-read fields are `chainId` + `rpcUrl`. The `rpcUrl` reader paths get an `await network.getEndpoint(network.primaryEndpointId).rpcUrl` synthesis (or NetworkService exposes `getActiveRpcUrl(networkId)`). Behavior unchanged.
5. **`wallet-bridge` dApp surface** (`INetworkRef`, `INetworkReader`, CAIP) unchanged. dApps see `chainId`. They don't see endpoints.
6. **CAIP resolution**: `resolveNetworkByChainId(networkService, chainId)` continues to work. After rework there's exactly one Network per chainId; `networks[0]` is correct.
7. **`getRandomHex`, `EntityStorage`, `Lock`** plumbing unchanged.
8. **Backup/restore protocol-level shape** has a v0→v1 transformer (see PR-2 below). Old backups still importable.

---

## 3. Surface area (full map, codex-supplemented)

### NetworkService consumers (touch PR-1)
- `packages/extension/src/wallet/services/network/{spec,service,client}.ts` — entity definition + service + client.
- `packages/extension/src/wallet/services/network/service.test.ts` — extend.
- `packages/extension/src/wallet/runtime.ts:27` — service registration (no shape change).
- `packages/extension/src/wallet/services/{note,token,transaction,fpc,token-balance,account-state,execution}/service.ts` — typecheck-driven mechanical edits where they read removed fields (`.isDefault`).
- `packages/extension/src/wallet/services/execution/tx-request-builder.ts` — same.
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — extend.

**Found by codex (added in v2):**
- ✅ `packages/extension/src/wallet/services/token-balance/balance-projector.ts:118` — `(await this.networks.getNetworks(chainId)).find((x) => x.isDefault)`. Replace with `getNetworks(chainId)[0]` or call a new `getNetwork(chainId)` helper.
- ✅ `packages/extension/src/popup/components/modules/general/NetworkBadge.vue:16, 46` — `node = appStore.networks.find(n => n.chainId === ...)` → tooltip shows `node.rpcUrl`. Update to `node.endpoints.find(e => e.id === node.primaryEndpointId).rpcUrl`.

### Storage / migration (PR-1)
- `packages/extension/src/wallet/storage/migrate.ts` — bump `CURRENT_VERSION` 2→3, append `migrateNetworksV2toV3`. Idempotent.
- `packages/extension/src/wallet/storage/EntityStorage.ts` — used as-is for `nulo:core:networks` (Network[] now has nested endpoints). No changes to the storage class itself.

**New in v2 (codex):**
- ✅ `packages/extension/src/wallet/services/operation-journal/spec.ts:43` — `OperationRecord.networkId?: string`. Lives in `chrome.storage.session` under `nulo:journal@*`. **Migration must clear** these because old `networkId` values may not exist after the grouping.
- ✅ `packages/extension/src/popup/components/modules/general/BalanceView.vue:208-262` — `nulo:ui:balanceDisplayOption@<profileId>` is a map `{ [networkId]: option }`. After migration, non-canonical row ids orphan. Migrator remaps via `oldToNewNetworkId`.

### Pending tx polling (PR-4, codex-found race)
- ✅ `packages/extension/src/wallet/services/transaction/service.ts:148-156` — `updateTx(tx)` calls `this.networkService.getNode(tx.chainId)`. Uses CURRENT primary endpoint. After endpoint swap mid-pending-tx, polling jumps RPC.
- **Fix**: add `Tx.submittedEndpointUrl?: string` (or `submittedEndpointId?`); `updateTx` calls a new `getNodeForUrl(url)` that bypasses the active-endpoint resolution, with fallback to current primary if the URL is no longer a known endpoint.

### Popup UI (PR-3)
- `packages/extension/src/popup/app.vue:75-103` — `initNetworks()` flow.
- `packages/extension/src/stores/app.store.ts:88-109` — `network`, `networks`, `updateNetwork`, `removeNetwork`. Add primary-endpoint mutators.
- `packages/extension/src/popup/components/popups/NetworksPopup.vue` — chain-switcher.
- `packages/extension/src/popup/components/popups/NewNetworkPopup.vue` — replace; "Smart Add" detects existing chain.
- `packages/extension/src/popup/components/popups/EditNetworkPopup.vue` — rename Network only.
- `packages/extension/src/popup/components/popups/{NewEndpointPopup,EditEndpointPopup}.vue` — NEW.
- `packages/extension/src/popup/pages/settings/networks/index.vue` — list of Networks (chains).
- `packages/extension/src/popup/pages/settings/networks/[id].vue` — NEW: per-Network detail.
- `packages/extension/src/popup/components/modules/general/NetworkBadge.vue` — tooltip update (above).
- `packages/extension/src/popup/pages/settings/connected-apps/[id].vue` — `getNetworks(chainId?)` unchanged.

### dApp bridge surface (no change)
- `packages/wallet-bridge/src/{caip,session-types,services-contract,dispatcher}.ts` — `INetworkRef` is structurally compatible (`id` + `chainId` + optional `isDefault`).

### E2E tests (PR-5 + each affected PR adds smoke)
- `packages/extension/tests/e2e/network/networks.test.ts` — keeps working since chain names survive.
- `packages/extension/tests/e2e/settings-crud.test.ts` — splits Network-CRUD vs Endpoint-CRUD.
- `packages/extension/tests/e2e/fixtures/helpers.ts:115-135` — selectors + behavior change.
- NEW: `packages/extension/tests/e2e/network/endpoints.test.ts`.
- NEW: `packages/extension/tests/e2e/migration.test.ts` (non-network suite).

### Backup/restore (PR-2)
- `packages/extension/src/wallet/services/network/service.ts:320-352` — `backup()` / `restore()`. New shape with old-shape transformer.
- `packages/extension/src/popup/pages/settings/security/export/full.vue:50` — calls `s.backup()`. No caller change.
- `packages/extension/src/popup/pages/import.vue` — calls `restore()`. No caller change.

---

## 4. Architecture: where does endpoint resolution live?

**`NetworkService.getNode(chainId)`** today (`service.ts:243-262`):
```ts
public async getNode(chainId: number): Promise<AztecNode> {
    let node = this.nodes.get(chainId)
    if (!node) {
        const network = networks.find(n => n.isDefault) ?? networks[0]
        node = this.nodeFactory.createNode(network.rpcUrl)
        this.nodes.set(chainId, node)
    }
    return node
}
```

**After v2**:
```ts
public async getNode(chainId: number): Promise<AztecNode> {
    let node = this.nodes.get(chainId)
    if (!node) {
        const network = await this.getNetworkByChainId(chainId)  // 1 row
        const endpoint = network.endpoints.find(e => e.id === network.primaryEndpointId)
        if (!endpoint) throw new Error(`Network ${network.id} has no primary endpoint`)
        node = this.nodeFactory.createNode(endpoint.rpcUrl)
        this.nodes.set(chainId, node)
    }
    return node
}
```

Cache invalidation: `setPrimaryEndpoint(networkId, endpointId)` deletes `this.nodes.get(network.chainId)` BEFORE emitting `onPrimaryEndpointChanged`. Same for `updateEndpoint` if `rpcUrl` changes.

**`NetworkService` synthesizes `NetworkInfo`** for callers via a new `getNetworkInfo(networkId): NetworkInfo` method that returns `{ profileId, chainId, rpcUrl: <primary endpoint url> }`. Today this is implicit because Network IS the NetworkInfo shape; after rework it's a small synthesis call.

**Pending-tx polling pin** (PR-4):
```ts
// transaction/service.ts:148
private async updateTx(tx: Tx) {
    const node = tx.submittedEndpointUrl
        ? this.networkService.getNodeForUrl(tx.submittedEndpointUrl, tx.chainId)
        : await this.networkService.getNode(tx.chainId)
    // ... rest unchanged
}
```

`getNodeForUrl(url, fallbackChainId)`: returns a node bound to `url` if that URL is still a known endpoint of the chain's Network; else falls back to the chain's primary endpoint. This way endpoint deletion mid-pending-tx still resolves cleanly.

---

## 5. Migration strategy (codex-aligned, lossless with fallback)

### Algorithm (v3 migrator)

```ts
async function migrateNetworksV2toV3(log: (msg: string) => void): Promise<void> {
    // 1. Read all old Network rows under "nulo:core:networks@*"
    const all = await chrome.storage.local.get(null)
    const oldRows: OldNetwork[] = []
    for (const [key, value] of Object.entries(all)) {
        if (key.startsWith("nulo:core:networks@") && value && typeof value === "object") {
            oldRows.push(value as OldNetwork)
        }
    }
    if (oldRows.length === 0) {
        // Fresh install — defaults seeded later by getOrInitNetworks()
        return
    }

    // 2. Group by (profileId, chainId)
    const groups = new Map<string, OldNetwork[]>()
    for (const row of oldRows) {
        const k = `${row.profileId}:${row.chainId}`
        const arr = groups.get(k) ?? []
        arr.push(row)
        groups.set(k, arr)
    }

    // 3. Read UI-state keys we may need to remap
    const uiKeysToRead = [
        "nulo:ui:activeNetwork",  // legacy fallback
        ...oldRows.map(r => `nulo:ui:lastActiveNetwork@${r.profileId}`),
        ...oldRows.map(r => `nulo:ui:balanceDisplayOption@${r.profileId}`),
    ]
    const uiState = await chrome.storage.local.get(Array.from(new Set(uiKeysToRead)))

    const oldToNewNetworkId = new Map<string, string>()
    const newRows: NewNetwork[] = []
    const writes: Record<string, unknown> = {}
    const deletes: string[] = []

    try {
        // 4. Build new Network aggregates per group
        for (const [_, rows] of groups) {
            // Pick canonical: ui-selected > isDefault > deterministic first
            const lastActiveId = uiState[`nulo:ui:lastActiveNetwork@${rows[0].profileId}`]
            const canonical =
                rows.find(r => r.id === lastActiveId) ??
                rows.find(r => r.isDefault) ??
                rows[0]

            const networkId = canonical.id
            const networkName = deriveChainName(canonical.chainId, canonical.name)
            const networkKind = deriveChainKind(canonical.chainId)

            // Build endpoints (one per old row)
            const endpoints: NetworkEndpoint[] = rows.map(r => ({
                id: r.id === canonical.id ? `${r.id}-ep0` : r.id,
                rpcUrl: normalizeRpcUrl(r.rpcUrl),  // strip trailing slash, lowercase host
                label: deriveEndpointLabel(r, canonical),
            }))
            // Dedupe endpoints by URL (rare: two old rows with identical URL)
            const dedupedEndpoints = dedupeEndpointsByUrl(endpoints)
            const primaryEndpointId = dedupedEndpoints.find(e => e.id.startsWith(`${canonical.id}-ep`))?.id
                ?? dedupedEndpoints[0].id

            const newNetwork: NewNetwork = {
                id: networkId,
                profileId: canonical.profileId,
                chainId: canonical.chainId,
                name: networkName,
                primaryEndpointId,
                endpoints: dedupedEndpoints,
                kind: networkKind,
            }
            newRows.push(newNetwork)
            writes[`nulo:core:networks@${networkId}`] = newNetwork

            // Build oldToNewNetworkId for non-canonical rows
            for (const row of rows) {
                oldToNewNetworkId.set(row.id, networkId)
            }
        }

        // 5. Remap UI keys (lastActive + balanceDisplayOption map)
        for (const [oldId, newId] of oldToNewNetworkId) {
            // (already a no-op for canonical rows; only matters for non-canonical)
        }
        const profileIds = new Set(oldRows.map(r => r.profileId))
        for (const profileId of profileIds) {
            const lastActiveKey = `nulo:ui:lastActiveNetwork@${profileId}`
            const lastActive = uiState[lastActiveKey]
            if (lastActive && oldToNewNetworkId.has(lastActive)) {
                writes[lastActiveKey] = oldToNewNetworkId.get(lastActive)
            }

            const balanceKey = `nulo:ui:balanceDisplayOption@${profileId}`
            const optionsMap = uiState[balanceKey] as Record<string, string> | undefined
            if (optionsMap) {
                const remapped: Record<string, string> = {}
                for (const [oldId, opt] of Object.entries(optionsMap)) {
                    const newId = oldToNewNetworkId.get(oldId) ?? oldId
                    if (!remapped[newId]) remapped[newId] = opt  // first-write-wins
                }
                writes[balanceKey] = remapped
            }
        }

        const legacyActive = uiState["nulo:ui:activeNetwork"]
        if (legacyActive && oldToNewNetworkId.has(legacyActive)) {
            writes["nulo:ui:activeNetwork"] = oldToNewNetworkId.get(legacyActive)
        }

        // 6. Delete non-canonical Network rows (their data migrated into endpoints[])
        for (const [oldId, newId] of oldToNewNetworkId) {
            if (oldId !== newId) deletes.push(`nulo:core:networks@${oldId}`)
        }

        // 7. Write atomically (chrome.storage is per-key; sequence is the closest we get)
        await chrome.storage.local.set(writes)
        if (deletes.length) await chrome.storage.local.remove(deletes)

        // 8. Clear chrome.storage.session journal (networkId values may be stale)
        const sessionAll = await chrome.storage.session.get(null)
        const journalKeys = Object.keys(sessionAll).filter(k => k.startsWith("nulo:journal@"))
        if (journalKeys.length) await chrome.storage.session.remove(journalKeys)

        // 9. Set sentinel — only after all writes succeed
        await chrome.storage.local.set({ "nulo:core:storage-version": 3 })
        log(`Network migration: ${oldRows.length} rows → ${newRows.length} Networks; idempotent on rerun.`)

    } catch (err) {
        log(`Network migration: lossless path failed (${String(err)}). Falling back to destructive reseed.`)
        // Destructive fallback — pre-launch tolerable; tests cover this branch.
        const allKeys = Object.keys(all)
        const networkKeys = allKeys.filter(k =>
            k.startsWith("nulo:core:networks@") ||
            k.startsWith("nulo:ui:lastActiveNetwork@") ||
            k === "nulo:ui:activeNetwork" ||
            k.startsWith("nulo:ui:balanceDisplayOption@")
        )
        if (networkKeys.length) await chrome.storage.local.remove(networkKeys)
        const sessionAll2 = await chrome.storage.session.get(null)
        const journalKeys2 = Object.keys(sessionAll2).filter(k => k.startsWith("nulo:journal@"))
        if (journalKeys2.length) await chrome.storage.session.remove(journalKeys2)
        await chrome.storage.local.set({ "nulo:core:storage-version": 3 })
    }
}
```

**Helpers**:
- `deriveChainName(chainId, oldName)` — for known seeded chains, returns canonical ("Alpha Mainnet" / "Testnet" / "Devnet" / "Local Network") regardless of `oldName`. For custom chains, uses `oldName` (or `Custom Aztec ${chainId}`).
- `deriveChainKind(chainId)` — maps the seeded chainIds to their kind; custom → `"custom"`.
- `deriveEndpointLabel(oldRow, canonical)` — if `oldRow.id !== canonical.id` and `oldRow.name !== canonical.name`, label = `oldRow.name`; else `undefined`.
- `normalizeRpcUrl(url)` — `url.replace(/\/$/, '').toLowerCase()` (URL hosts are case-insensitive; trailing slash often inconsistent in user input).
- `dedupeEndpointsByUrl(endpoints)` — drop duplicates after normalize.

### What survives (lossless path)
- One Network per (profileId, chainId).
- Endpoint URLs (1:1 with old rows, deduped).
- User's prior "default" pick as the primary endpoint.
- `nulo:ui:lastActiveNetwork@<profileId>` (remapped if it pointed at a non-canonical row).
- `nulo:ui:balanceDisplayOption@<profileId>` (map keys remapped).

### What gets wiped
- `nulo:journal@*` from `chrome.storage.session` (always, both paths — networkIds may be stale).
- Non-canonical Network rows.
- (existing v2 wipes still run for `nulo:core:accounts`, txs, balances, PXE — unchanged from current `migrate.ts`).

### Failure-mode tests (PR-1)
1. Idempotent: run twice, second is no-op (sentinel guard).
2. Empty storage: no-op.
3. Single-row-per-chain: 1 Network + 1 Endpoint.
4. Multi-row-per-chain WITH `isDefault`: canonical chosen correctly.
5. Multi-row-per-chain WITHOUT `isDefault`: deterministic first row chosen.
6. UI key remap: `lastActiveNetwork` pointing at non-canonical → after migration points at canonical's id.
7. balanceDisplayOption remap: map with old non-canonical keys → after migration only canonical keys.
8. Mid-write crash (mocked storage rejection): sentinel NOT set → re-run succeeds.
9. Destructive fallback path: simulated transform-throw → all network keys removed; sentinel set; getOrInitNetworks reseeds defaults on next access.

---

## 6. UX redesign

### Settings → Networks (top-level page)

**After**: one row per logical Network (chain). Each row:
- Chain icon (`NetworkBadge` updated to use primary endpoint's URL in the tooltip)
- Chain name ("Testnet")
- Subtitle line: `Using {endpointLabel || endpointHost}` + `{N} endpoint(s)` (subtle)
- Right-side: tap-to-make-primary radio + chevron to drill into detail

`/popup/settings/networks/<networkId>` is the per-Network detail.

### Settings → Networks → [Network Detail] (NEW)

```
[SubPageHeader: <Network name>]

Network info
  Name: <input — rename Network>           (custom Networks only; seeded ones read-only by default)
  Chain ID: 4138294185 (read-only)
  Note: Accounts, tokens, txs, and PXE are shared across endpoints on this chain.

Endpoints (<count>)
  - <SettingItem per endpoint>
    Label OR host
    Right: "Primary" pill if primary; "Connected"/"Unreachable" pill (transient probe);
           edit chevron; delete icon (hidden if last endpoint, disabled if primary)

  + Add endpoint

Danger zone
  Delete chain   (red; opens confirm dialog with cascade copy)
```

Tapping an endpoint row that isn't primary → opens a "Make primary" flow (one-tap toggle) OR `EditEndpointPopup`. Decision: **tap = open EditEndpointPopup**; the "Make primary" affordance is a button inside the popup or an explicit dot-menu action on the row. Less ambiguous than tap-to-promote.

### Chain-switcher (NetworksPopup)

**Before**: lists all Network rows (chain+endpoint pairs).

**After**: lists logical Networks (one per chain). Subtitle hints at primary endpoint (`via DRPC` or empty if there's only one endpoint). Switching = chain-only side effect.

**Codex note**: today's `NetworksPopup.vue:33-38` AND `app.vue:75-103` AND `settings/networks/index.vue:37-42` ALL call `setDefault()` as a side effect of selecting a chain. **This mutation needs to die in PR-4.** "Switching chain" should NOT mutate `isDefault` (or in v2, NOT mutate `primaryEndpointId`). It only updates the active chain pointer.

### "Smart Add network" (codex-suggested UX)

`NewNetworkPopup` flow:
1. User enters RPC URL.
2. Probe runs (existing `getChainId(rpcUrl)` path).
3. If `chainId` matches a Network already in this profile → popup transforms: "This RPC is on **Testnet**. Add it as a backup endpoint?" with a single button. Endpoint label = user-entered name.
4. If `chainId` is new → continue today's flow: Network name + first endpoint URL.

This eliminates the worst onboarding friction (user adds a backup RPC, gets a confused duplicate Network).

### Add-Endpoint popup (NEW)

```
[Header: Add endpoint to <Network name>]

Label (optional): <input>
RPC URL: <input>

[Probe — fetches getNodeInfo, validates chainId matches Network.chainId]
[Save (disabled until probe succeeds)]
```

ChainId mismatch: error toast "This RPC is on chain X, but this Network is chain Y."

### Edit-Endpoint popup (NEW)

Same UI as Add, prefilled. Save updates label + rpcUrl (chainId revalidation if URL changed). Cancel reverts.

### Delete-Endpoint flow

- Tap delete on non-primary endpoint → ConfirmPopup → wipes the endpoint.
- Primary endpoint: button disabled with hint "Make another endpoint primary first."
- Last endpoint: button hidden. UI hint "Delete the chain instead."

### Header indicator

Today's globe button shows `appStore.network.name`. Unchanged. Active endpoint indication stays in Settings → Networks → [detail] to keep header clean.

### data-testid additions
(See plan-v1 §6 for full list; updated names: `endpoint-primary-pill` not `endpoint-active-pill`; `set-primary-endpoint-btn` not `set-active-endpoint-btn`.)

---

## 7. PR-by-PR breakdown (codex-aligned, 4 work + 1 docs)

Each PR self-contained with a verification gate (typecheck + unit + integration + smoke e2e). CI must be green before merge.

### PR-1 — Core model + migrator + DI seam + compat projection

**Branch**: `m4.10/01-core-model`

**Goal**: rewrite the entity + storage + service WITHOUT changing UI behavior. Existing `getNetworks/getNetwork/getNode/getNodeStatus` behavior preserved by projecting `primaryEndpoint.rpcUrl` to a top-level `rpcUrl` field on Network OR by leaving the new shape as-is and letting downstream PRs read `endpoints[primaryIndex].rpcUrl`. Recommendation: **NOT** projected (clean break) — but provide one PR cycle of compat aliases (`setDefault` as alias of `setPrimaryEndpoint`, `onDefaultNetworkChanged` as alias of `onPrimaryEndpointChanged`) so PR-1 doesn't touch the UI files.

**Files**:
- `packages/extension/src/wallet/services/network/spec.ts` — REWRITE: new types (Network with nested endpoints + primaryEndpointId; NetworkEndpoint), new zod schemas, new method tuple types.
- `packages/extension/src/wallet/services/network/service.ts` — REWRITE.
- `packages/extension/src/wallet/services/network/client.ts` — REWRITE in lockstep.
- `packages/extension/src/wallet/services/network/service.test.ts` — EXTEND with ~25 tests (see test plan).
- `packages/extension/src/wallet/services/network/service.integration.test.ts` (NEW) — ~6 tests with real ProfileService over shared FakeBrowserApi.
- `packages/extension/src/wallet/storage/migrate.ts` — bump `CURRENT_VERSION` 2→3, append `migrateNetworksV2toV3`.
- `packages/extension/src/wallet/storage/migrate.networks.test.ts` (NEW) — 9 migration tests.
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — extend (NetworkService init touches profile activation).
- `packages/extension/src/wallet/services/token-balance/balance-projector.ts:118` — replace `find(x => x.isDefault)` with `[0]`.
- All other consumers (`token`, `transaction`, `fpc`, `note`, `account-state`, `execution`, `tx-request-builder`) — typecheck-driven mechanical edits.
- `packages/wallet-bridge/*` — no edits needed (INetworkRef compatible).

**Methods on NetworkService (new shape)**:
- `getNetworks(chainId?: number): Network[]` — unchanged signature; new shape.
- `getNetwork(id: string): Network` — unchanged.
- `getOrInitNetworks(): Network[]` — seeds 4 default Networks + 1 endpoint each.
- `addNetwork(name: string, rpcUrl: string): Network` — creates Network + first endpoint; rejects duplicate chainId.
- `updateNetwork(id: string, name: string): Network` — RENAME ONLY (no rpcUrl).
- `deleteNetwork(id: string): Network` — emits `onNetworkDeleted` (cascade subscribers in PR-4).
- `setPrimaryEndpoint(networkId: string, endpointId: string): Network` — replaces `setDefault`.
- `addEndpoint(networkId: string, label: string | undefined, rpcUrl: string): NetworkEndpoint`.
- `updateEndpoint(networkId: string, endpointId: string, label: string | undefined, rpcUrl: string): NetworkEndpoint`.
- `deleteEndpoint(networkId: string, endpointId: string): NetworkEndpoint` — rejects if primary or last.
- `getNodeStatus(networkId: string): NodeStatus` — unchanged signature; uses primary endpoint.
- `getNode(chainId: number): AztecNode` — unchanged signature; uses primary endpoint.
- `getNodeForUrl(url: string, fallbackChainId: number): AztecNode` — NEW; for pending tx polling pin (PR-4 wires it up; PR-1 just exposes).
- `getNetworkInfo(networkId: string): NetworkInfo` — synthesizes `{ profileId, chainId, rpcUrl }`.
- `backup() / restore(...)` — new shape (PR-2 finishes the transformer).

**Compat aliases (one PR cycle)**:
- `setDefault(id)` → calls `setPrimaryEndpoint(network.id, network.primaryEndpointId)` after switching active. Marked `@deprecated` JSDoc; removed in PR-3.
- `onDefaultNetworkChanged` → fires alongside `onPrimaryEndpointChanged`. Removed in PR-3.

**Events**:
- `onNetworkAdded`, `onNetworkUpdated`, `onNetworkDeleted` — existing.
- `onPrimaryEndpointChanged({ networkId, endpointId })` — NEW.
- `onEndpointAdded`, `onEndpointUpdated`, `onEndpointDeleted` — NEW.

**Verification gate**:
- `bun run typecheck` clean.
- `bun run --filter '@nulo/extension' test` green (incl. ~25 new NetworkService unit + ~9 migration + ~6 integration tests).
- `bun run lint` clean.
- `bun run build:chrome` clean.
- Smoke e2e (`bun run test:e2e`) green — UI hasn't changed yet.

**Failure mode if merged alone**: NONE — service + storage are internally consistent. Compat aliases keep the UI working. PR-2 lands cleanly on top.

---

### PR-2 — Endpoint API surface in client + backup/restore transformer

**Branch**: `m4.10/02-endpoint-api-backup`

**Files**:
- `packages/extension/src/wallet/services/network/client.ts` — expose endpoint methods.
- `packages/extension/src/wallet/services/network/service.ts` — finalize `backup()` / `restore()`:
  - `backup(): { networks: NewNetwork[] }` (endpoints nested per-Network).
  - `restore({ networks })` — accepts new shape natively; transforms old shape via `migrateOldBackupShape({ networks: OldNetwork[] })` if input lacks `primaryEndpointId`.
- `packages/extension/src/wallet/services/network/service.integration.test.ts` — extend backup/restore round-trip + old-shape ingest tests.

**Verification gate**:
- typecheck + unit + integration green.
- Manual smoke: backup → import on fresh profile → networks restore correctly.

**Failure mode if merged alone**: harmless — exposes API but UI still uses compat aliases. PR-3 consumes it.

---

### PR-3 — Settings UX redesign + Pinia store + initNetworks rewrite

**Branch**: `m4.10/03-settings-ux`

**Files**:
- `packages/extension/src/stores/app.store.ts:88-109` — extend networks slice:
  - `network: ref<Network>` (now has nested endpoints)
  - `primaryEndpoint: computed<NetworkEndpoint>` derived from `network.endpoints + primaryEndpointId`
  - Add `addEndpoint`, `updateEndpoint`, `deleteEndpoint`, `setPrimaryEndpoint` mutators
  - Drop `updateNetwork(id, name, url)` — rename to `renameNetwork(id, name)`.
- `packages/extension/src/popup/app.vue:75-103` — `initNetworks()`:
  - Use `setActiveNetwork` (replaces `setDefault` mutation in init flow).
  - Subscribe to `onPrimaryEndpointChanged`.
- `packages/extension/src/popup/pages/settings/networks/index.vue` — REWRITE.
- `packages/extension/src/popup/pages/settings/networks/[id].vue` — NEW.
- `packages/extension/src/popup/components/popups/NewNetworkPopup.vue` — REWRITE with smart-add.
- `packages/extension/src/popup/components/popups/EditNetworkPopup.vue` — REWRITE (rename only).
- `packages/extension/src/popup/components/popups/{NewEndpointPopup,EditEndpointPopup}.vue` — NEW.
- `packages/extension/src/popup/components/popups/NetworksPopup.vue` — chain-only switching; show subtitle hint.
- `packages/extension/src/popup/components/modules/general/NetworkBadge.vue` — tooltip update.
- `packages/extension/src/stores/popup.store.ts` — register new popup types.
- `packages/extension/src/stores/cache.store.ts` — add `endpointToEditIdx`.
- `packages/extension/src/popup/components/popups/PopupManager.vue` — register new popups.
- Drop PR-1's compat aliases (`setDefault`, `onDefaultNetworkChanged`).

**Verification gate**:
- typecheck clean.
- E2E smoke: existing `networks.test.ts` + `settings-crud.test.ts` pass.
- Manual smoke: add chain → see in list → tap → add endpoint → make primary → label-edit → delete non-primary → delete chain (with cascade confirm).

**Failure mode if merged alone**: blocked on PR-1+PR-2.

---

### PR-4 — Cascading delete + pending-tx polling pin + side-effect cleanup

**Branch**: `m4.10/04-cascade-delete-polling-pin`

**Files**:
- `packages/extension/src/wallet/services/account/service.ts` — subscribe to `networkService.onNetworkDeleted` → cascade-delete accounts for that `(profileId, chainId)`.
- `packages/extension/src/wallet/services/transaction/service.ts` — subscribe; cascade. Plus polling pin: extend `Tx` shape with `submittedEndpointUrl?: string`; `executeOperations` (or wherever sendTx persists Tx) writes the URL; `updateTx` uses `getNodeForUrl` if present.
- `packages/extension/src/wallet/services/token-balance/service.ts` — subscribe; cascade.
- `packages/extension/src/wallet/services/token/service.ts` — subscribe; cascade.
- `packages/extension/src/wallet/services/fpc/service.ts` — subscribe; cascade.
- `packages/extension/src/wallet/services/operation-journal/service.ts` — subscribe; clear journal records with that `networkId` from `chrome.storage.session`.
- `packages/extension/src/wallet/services/transaction/spec.ts` — add `submittedEndpointUrl?: string` to `Tx`.
- `packages/extension/src/popup/app.vue` — drop `setDefault` side-effect on chain switch (now only sets `appStore.network`).
- `packages/extension/src/popup/components/popups/NetworksPopup.vue` — drop `setDefault` side-effect on chain switch.
- `packages/extension/src/popup/pages/settings/networks/index.vue` — keep `setDefault` ONLY when user explicitly taps the radio.

**Verification gate**:
- typecheck + unit + integration + smoke e2e green.
- Manual smoke: delete a Network with accounts/balances/PXE → all wiped, popup gracefully redirects.
- Manual smoke: send a tx on Endpoint A → swap primary to B → tx still polls A → confirms.

**Failure mode if merged alone**: blocked on PR-3 (uses new event surface).

---

### PR-5 — E2E coverage expansion + docs

**Branch**: `m4.10/05-e2e-and-docs`

**Files**:
- `packages/extension/tests/e2e/network/networks.test.ts` — extend.
- `packages/extension/tests/e2e/network/endpoints.test.ts` (NEW) — full endpoint CRUD + primary swap + state continuity test.
- `packages/extension/tests/e2e/migration.test.ts` (NEW) — pre-seed v2 storage, boot, verify v3 migration.
- `packages/extension/tests/e2e/fixtures/helpers.ts` — `addEndpoint`, `setPrimaryEndpoint`, `deleteEndpoint`, `navigateToNetworkDetail`.
- `implementations-plan/M4/DECISIONS.md` — append M4.10 v2 decision.
- `implementations-plan/M4/10/plan.md` — top-of-file note "SUPERSEDED by `../10-network-rework/plan-v2.md`".
- `implementations-plan/M4/10-network-rework/plan-v2.md` — final consolidated plan with audit-diff.
- `implementations-plan/M4/README.md` — bump M4 status.
- `SECURITY.md` — only if anything changes (default: no changes; threat model is endpoint-agnostic).

**Verification gate**:
- All e2e green.
- Doc-only changes for the docs portion.

---

## 8. Test plan (overall)

### Unit tests (PR-1, ~25 new)

`network/service.test.ts`:
1. `getOrInitNetworks` seeds 4 Networks + 4 Endpoints; idempotent.
2. `addNetwork(name, rpcUrl)` creates Network + first Endpoint.
3. `addNetwork` rejects duplicate `name` for same profile.
4. `addNetwork` rejects `rpcUrl` already used by any endpoint of any Network in profile.
5. `addNetwork` rejects new chain when an existing Network has the same chainId (smart-add: caller should `addEndpoint` instead).
6. `updateNetwork(id, name)` renames; rejects collision; **rejects rpcUrl param if passed** (signature drops it; legacy callers caught by typecheck).
7. `deleteNetwork(id)` emits `onNetworkDeleted` with `(profileId, chainId, networkId)`.
8. `setActiveNetwork(id)` (chain switch) does NOT mutate `primaryEndpointId`.
9. `addEndpoint(networkId, label, rpcUrl)` succeeds when chainId matches.
10. `addEndpoint` rejects when chainId mismatches Network's chainId.
11. `addEndpoint` rejects rpcUrl already used by any endpoint in the SAME Network.
12. `updateEndpoint(networkId, endpointId, label, rpcUrl)` re-validates chainId.
13. `deleteEndpoint` rejects if primary.
14. `deleteEndpoint` rejects if last endpoint on Network.
15. `setPrimaryEndpoint(networkId, endpointId)` updates Network.primaryEndpointId; emits event; clears `nodes` cache for that chainId.
16. `getNode(chainId)` resolves via primary endpoint; cache invalidation on primary swap.
17. `getNode(chainId)` cache invalidation on `updateEndpoint` if rpcUrl changes.
18. `getNodeStatus(networkId)` uses primary endpoint URL.
19. `getNodeForUrl(url, chainId)` returns node bound to `url` if it's a known endpoint; falls back to primary.
20. `backup()` returns `{ networks: Network[] }` (nested endpoints).
21. `restore({ networks })` accepts new shape.
22. `restore({ networks: oldShape[] })` transforms via legacy adapter.
23. `onProfileDeleted` cascades all networks for that profile.
24. `onActiveProfileChanged` clears the AztecNode cache.
25. Concurrent `setPrimaryEndpoint` + `getNode(chainId)` — Lock semantics preserve consistency.

### Migration tests (PR-1, ~9 new)

`storage/migrate.networks.test.ts`:
1. Idempotent: run twice; second is no-op.
2. Empty storage: no-op.
3. Single-row-per-chain: 1 Network + 1 Endpoint.
4. Multi-row-per-chain WITH `isDefault`: canonical correct.
5. Multi-row-per-chain WITHOUT `isDefault`: deterministic first row.
6. UI key remap (`lastActiveNetwork` pointing at non-canonical): post-migration points at canonical.
7. balanceDisplayOption map remap: non-canonical keys collapsed to canonical.
8. Mid-write crash: sentinel NOT set; rerun succeeds.
9. Destructive fallback path: simulated transform-throw → all network keys removed; sentinel set.

### Integration tests (PR-1, ~6 new)

`network/service.integration.test.ts` + extend `profile/service.integration.test.ts`:
1. `createProfile()` → `getOrInitNetworks()` returns 4 Networks + 4 Endpoints.
2. `getNetwork(id)` after `setPrimaryEndpoint` returns updated row.
3. Active profile switch evicts AztecNode cache.
4. `deleteProfile()` cascades all networks.
5. `deleteNetwork()` (post-PR-4) emits event consumed by AccountService → accounts wiped.
6. `addEndpoint` then `getNode(chainId)` returns node for primary; not for new endpoint.

### E2E smoke (each PR's verification gate)

`tests/e2e/network/networks.test.ts`:
1. Default Networks show on fresh popup.
2. Switch to Local Network, header reflects it.
3. Settings → Networks lists all 4 chain names (one row per chain, NOT one row per old-shape pair).

### E2E expanded (PR-5)

`tests/e2e/network/endpoints.test.ts`:
1. Add endpoint to Testnet (RPC probe; network suite).
2. Edit endpoint label.
3. Delete non-primary endpoint.
4. Try to delete primary endpoint → button disabled.
5. Set non-primary endpoint as primary → reflected in list + (optional) header subtitle.
6. **Continuity test**: send tx on Endpoint A → swap primary to B → balance refreshes from B → tx history still shows the prior tx; receipt polling for the prior tx still works on A (or falls through cleanly if A removed).
7. Delete a chain with accounts/balances/PXE → cascade verified (re-open settings, accounts wiped on that chain).

### E2E migration (PR-5)

`tests/e2e/migration.test.ts`:
1. Boot extension with pre-seeded v2 storage shape; verify successful migration.
2. Pre-seed multi-row-per-chain → assert 1 Network with N endpoints post-migration.

---

## 9. Risks tracked

1. **AztecNode cache invalidation on primary swap.** `setPrimaryEndpoint` evicts before emitting. Test-covered.

2. **PXE re-init on primary swap.** `ChainRuntimeRegistry.getOrInit` (`chain-runtime.ts:128-155`) compares `existing.rpcUrl` and disposes if changed. After primary swap, next `getOrInit` disposes+reinits PXE pointing at new URL. IndexedDB persists (`pxe/${profileId}/${chainId}` unchanged), so state continuity works. ~500ms-2s re-init cost. **Acceptable**.

3. **In-flight tx during primary swap.** `ReadWriteGuard` (`pxe/service.ts:68`) ensures any in-flight `proveTx`/`simulateTx` finishes before `clear()`. Endpoint swap mid-tx waits behind in-flight job.

4. **Pending-tx polling race (codex-found).** `transaction/service.ts:148-156` uses `getNode(tx.chainId)` for receipt polling — primary swap during pending state moves polling. **Fixed in PR-4** via `submittedEndpointUrl` capture + `getNodeForUrl` lookup.

5. **Last-endpoint deletion guard race.** Service-level guard + UI guard.

6. **Endpoint chainId drift.** A previously-validated endpoint's RPC could later return a different chainId. Mitigation: revalidate chainId on every `setPrimaryEndpoint` call; show error toast on mismatch; don't swap.

7. **Backup restore from older versions.** Old backups have `Network[]` with rpcUrl + isDefault. Restore accepts both shapes.

8. **SW lifecycle vs config.** Active endpoint state is in `chrome.storage.local` (durable). SW restart re-reads. No `chrome.storage.session` involvement for primary endpoint pick.

9. **`nulo:journal@*` networkId staleness (codex-found).** Migration clears journal records (both lossless + destructive paths).

10. **`balanceDisplayOption@<profileId>` map staleness (codex-found).** Migration remaps keys.

11. **dApp protocol stability.** `INetworkRef.id` is the same Network row id pre/post migration. `chainId` unchanged. `isDefault?` becomes undefined; consumers handle that case.

12. **`balance-projector.ts:118` isDefault consumer (codex-found).** Replaced with `[0]` indexing in PR-1.

13. **`NetworkBadge.vue` tooltip (codex-found).** Updated to read primary endpoint URL.

14. **Profile import flow** — calls `restore()`. Service handles old + new shapes.

15. **`getOrInitNetworks` ordering vs profile activation** — must run AFTER profile activates. `app.vue.loadProfile()` already serializes.

16. **`Network.name` collision in import**. Two profiles' backups merged with name collisions: overwrite by id (current behavior).

17. **`updateNetwork` chain-mismatch** (codex-found). Today silently moves Network across chains. v2 rejects.

18. **`onNetworkDeleted` had no subscribers** (codex's "snake"). v2 wires AccountService, TransactionService, TokenBalanceService, TokenService, FpcService, PxeService, OperationJournalService.

---

## 10. Rollback strategy

Per-PR `git revert` + standard recovery. For storage version 3 already on user disks: a v3→v2 down-migrator is **not** shipped pre-launch. If a critical regression surfaces post-merge, halt the arc and reseed.

---

## 11. Verification commands (per PR)

```bash
bun run typecheck                       # all 8 packages clean
bun run --filter '@nulo/extension' test  # unit + integration + migration
bun run lint                            # biome clean
bun run --filter '@nulo/extension' build:chrome
bun run test:e2e                        # smoke
# After PR-5:
bun run test:e2e:all                    # smoke + network suite
```

Manual QA (15-25 min per UX PR): see plan v1 §11.

---

## 12. Open questions for user (final decisions before execution)

These should be resolved before PR-1 starts. Plan-v3 (post-audit) bakes in user's decisions.

1. **Entity model**: nested aggregate (codex's call, recommended) vs my v1's 2 EntityStorage roots. ✅ **Default: nested.** Confirm.

2. **Drop `isDefault`?** ✅ **Default: yes.** Confirm.

3. **`primaryEndpointId` naming** (vs `activeEndpointId` from v1). ✅ **Default: primary.** Confirm.

4. **`Network.kind` field** (mainnet/testnet/devnet/local/custom). ✅ **Default: yes (optional).** Confirm.

5. **`deleteNetwork` PURGES chain-scoped state** (codex's snake). ✅ **Default: yes (PR-4 cascades).** Confirm.

6. **Smart-add UX** (probe RPC, offer "add as endpoint" if chain exists). ✅ **Default: yes.** Confirm.

7. **Pending-tx polling pin** (capture submittedEndpointUrl in Tx). ✅ **Default: yes (PR-4).** Confirm.

8. **`updateNetwork` drops rpcUrl param** (rename only). ✅ **Default: yes.** Old backup imports route the rpcUrl into the first endpoint via the transformer. Confirm.

9. **Migration: lossless with destructive fallback.** ✅ **Default: yes.** Confirm.

10. **Header subtitle for non-primary endpoint** ("via Backup"). 🔲 **Default: NO** (keep header clean). Confirm or override.

11. **Compat aliases for one PR cycle** (`setDefault` / `onDefaultNetworkChanged` survive PR-1, removed in PR-3). 🔲 **Default: yes** (less PR-1 surface). Confirm or skip and merge PR-1+PR-3 together.

12. **Backup format version field**. 🔲 **Default: defer** until M4.7 lands. Current strategy: shape-detect at restore time.

13. **Plan name in DECISIONS.md**: "M4.10 — Network-model rework" or renumber. 🔲 **Default: keep M4.10.**

14. **PR scope change**: codex proposed 4 PRs (vs my 6); audit phase may push back. 🔲 **Default: 5 (4 work + 1 docs).** Confirm.

---

## 13. Estimated effort

- Planning + audit + iterate: 1d (this is most of today + next session).
- PR-1 (core + migrator): 2-2.5d (largest; ~25 new tests + service rewrite).
- PR-2 (endpoint API + backup): 0.5-1d.
- PR-3 (Settings UX): 1-1.5d.
- PR-4 (cascade + polling pin): 0.75-1d.
- PR-5 (E2E + docs): 0.75d.
- Manual QA + iteration: 0.5-1d.

**Total: ~6-8d execution wall-time** (from PR-1 start to PR-5 merge). Same arc as planned.

---

## 14. Versioning & ship cadence

- Each PR bumps `packages/extension/package.json` patch version (0.13.9 → 0.13.10 → … → 0.13.14).
- Final tag at end of arc: `0.14.0` (minor bump — first user-visible UX redesign of network management since pre-Nulo).

---

*End of plan-v2. Awaiting dual audit (codex xhigh + Plan-agent) and user decision on Section 12 open questions.*
