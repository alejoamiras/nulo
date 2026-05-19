# M4.10 — Network-model rework: split `Network` from `NetworkEndpoint`

> **Status: PLANNING (v1, pre-audit).** Replaces the DEFERRED `implementations-plan/M4/10/plan.md` (per-RPC PXE isolation). Per `implementations-plan/M4/DECISIONS.md` line 209-228, the user determined the v0 framing was backwards: PXE state SHOULD be shared per chain; the data model is the thing to fix.
>
> **Audit tier**: dual (codex xhigh + Plan-agent) on this v1 before execution.
>
> **Scope flag**: `Network → Network + NetworkEndpoint` only. Automatic primary/fallback RPC failover is OUT OF SCOPE (user-flagged "complex; another expansion"). Plan must keep the door open for it but not implement it.
>
> **Pre-launch context**: zero production users. Storage migration can be modestly destructive if it dramatically simplifies the migrator. We still write a deterministic, idempotent migrator (production-grade).

---

## 0. Context recap (why this exists)

`packages/extension/src/wallet/services/network/spec.ts:11-24`:

```ts
type Network = { id, profileId, name, rpcUrl, chainId, isDefault }
```

This row glues "logical chain identity" (`chainId`) to "endpoint identity" (`rpcUrl`). Adding a backup RPC for the same chain creates a *peer Network row* with the same `chainId`, then `setDefault` (`service.ts:191`) does a chainId-scoped "default within a chainId" dance to pick which one is active.

PXE state (`pxe/${profileId}/${chainId}` in `packages/aztec-runtime/src/pxe/chain-runtime.ts:78`) is already chain-keyed, so multiple Network rows with the same chainId already share PXE state. The data model lies — switching "Network" to a same-chain peer is, mechanically, switching endpoint within one logical chain.

Most of the codebase reads `chainId` to do its work — `AccountService.getAccounts(profileId, chainId, …)`, every PXE write taking `NetworkInfo { profileId, chainId, rpcUrl }`, `wallet-bridge`'s `INetworkRef.chainId`. **The new model lines up with what the rest of the system already assumes.** The fix is contained to the `network/` service + the UI that consumes its rows.

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
    /** Display name — user-customizable. Seeded from defaults. */
    name: string
    /** Currently-active endpoint id. Always points at an existing endpoint. */
    activeEndpointId: string
}

type NetworkEndpoint = {
    /** Stable id (random hex). */
    id: string
    /** Owning Network. */
    networkId: string
    /** RPC URL. */
    rpcUrl: string
    /** Optional human-readable label ("Primary", "Backup", etc). */
    label?: string
}
```

### Design decisions baked in

**(a) `activeEndpointId` lives on Network, not as a separate `ActiveEndpoint` row.**

Why: Networks are already per-profile (`Network.profileId`). A separate `ActiveEndpoint { profileId, networkId, currentEndpointId }` would be redundant — there's exactly one (profileId, networkId) tuple per Network row, so `currentEndpointId` is a 1:1 attribute. Extracting it adds a join + a consistency invariant for zero benefit.

**(b) Drop `isDefault`.**

In the old model `isDefault` picked a Network row when multiple shared a chainId. In the new model there's exactly one Network per (profileId, chainId), so the disambiguator is gone. `wallet-bridge/INetworkRef.isDefault?: boolean` is already optional (`session-types.ts:33`); we stop populating it. `caip.ts:74` `resolveNetworkByChainId` falls through to `networks[0]` (the only one). No protocol break.

**(c) `Network.name` is user-customizable but seeded from defaults.**

Today's seeded names ("Alpha Mainnet", "Testnet", …) live in `service.ts:57-89`. After rework, the user can rename. Seeding is one-shot at first profile init.

**(d) NO `healthStatus` on Endpoint.**

The user said primary+fallback is out of scope. Health status is the prerequisite for fallback; if we add it now we're tempted to use it. Keep the door open: `label?` is a forward-compatible attribute. When fallback ships, add `lastSeenHealthy?: number` and `priority?: number`. No churn at that point.

**(e) Endpoint validation rules**:
- `rpcUrl` must pass `getNodeInfo()` and produce the same `chainId` as its Network (else reject with "Endpoint chainId mismatch").
- A Network must have ≥1 Endpoint (last-endpoint deletion blocked at the service level).
- Two endpoints on the same Network can't share an `rpcUrl` (UI guard + service guard, like today's name/url uniqueness).

**(f) Network deletion cascade**: deleting a Network deletes its endpoints (in storage) AND wipes per-chain state (accounts, balances, txs, PXE) FOR THAT (profileId, chainId). Same surface as today's `onProfileDeleted` cleanup, narrowed to one chain. **Open question for user**: do we even allow deleting a default Network? Today we allow it (last-network-guard only). Recommendation: keep allowing, surface confirm dialog with "this wipes accounts on this chain."

---

## 2. Architectural invariants preserved

1. **`NetworkInfo { profileId, chainId, rpcUrl }`** (`packages/aztec-runtime/src/pxe/chain-runtime.ts:18-22`) **stays unchanged.** PxeService doesn't know about endpoints. NetworkService synthesizes `NetworkInfo` from `(Network, activeEndpoint.rpcUrl)` at lookup time. PXE's locking, runtime registry, orphan cleanup, profile-delete cleanup — all unchanged.

2. **PXE storage key** `pxe/${profileId}/${chainId}` unchanged.

3. **`AccountService` API + storage shape unchanged** (`account/spec.ts:33-68`). Already chain-keyed.

4. **`TokenService`, `TokenBalanceService`, `TransactionService`, `NoteService`, `FpcService`, `AccountStateService`, `ExecutionService`, `TxRequestBuilder`** — all consume `getNode(chainId)` or take a Network whose only-read fields are `chainId` + `rpcUrl`. Behavior unchanged.

5. **`wallet-bridge` dApp surface** (`INetworkRef`, `INetworkReader`, CAIP) unchanged. dApps see `chainId`. They don't see endpoints.

6. **CAIP resolution**: `resolveNetworkByChainId(networkService, chainId)` continues to work. After rework there's exactly one Network per chainId in the active profile, so no disambiguation needed; `networks[0]` is correct.

7. **`getRandomHex`, `EntityStorage`, `Lock`** plumbing all unchanged.

8. **Backup/restore protocol-level shape** has a v0→v1 transformer (see PR-1 below). Imports from older backups still work.

---

## 3. Surface area (full map)

Source: Explore agent + focused reads, cross-checked 2026-04-27 against master `b31c554`.

### NetworkService consumers (touch PR-1)
- `packages/extension/src/wallet/services/network/{spec,service,client}.ts` — entity definition + service + client.
- `packages/extension/src/wallet/services/network/service.test.ts` — extend with new method tests.
- `packages/extension/src/wallet/runtime.ts:27` — service registration (no change).
- `packages/extension/src/wallet/services/{note,token,transaction,fpc,token-balance,account-state,execution}/service.ts` — each consumes `NetworkService`. They call `getNode(chainId)` or take a `Network` whose `chainId` + `rpcUrl` they read. Pinned interface boundary; **no behavioral change** but typecheck flushes places that destructure removed fields like `.isDefault`.
- `packages/extension/src/wallet/services/execution/tx-request-builder.ts` — same.
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — extend (the integration suite touches NetworkService init).

### Storage / migration (PR-1)
- `packages/extension/src/wallet/storage/migrate.ts` — bump `CURRENT_VERSION` 2→3, add Network-shape migrator that runs AFTER the existing wipe.
- `packages/extension/src/wallet/storage/EntityStorage.ts` — used by NetworkService for `nulo:core:networks` + (new) `nulo:core:network-endpoints`. No changes to the storage class itself.
- New storage key: `nulo:core:network-endpoints` (EntityStorage<NetworkEndpoint>).

### Popup UI (PR-2 + PR-3 + PR-4)
- `packages/extension/src/popup/app.vue:75-103` — `initNetworks()` flow.
- `packages/extension/src/stores/app.store.ts:88-109` — `network`, `networks`, `updateNetwork`, `removeNetwork`. Add `endpoints`, `activeEndpoint`, endpoint manipulators.
- `packages/extension/src/popup/components/popups/NetworksPopup.vue` — chain-switcher.
- `packages/extension/src/popup/components/popups/NewNetworkPopup.vue` — replace with New-Network flow that creates a Network + first Endpoint atomically.
- `packages/extension/src/popup/components/popups/EditNetworkPopup.vue` — replace with rename-Network.
- `packages/extension/src/popup/components/popups/{NewEndpointPopup,EditEndpointPopup}.vue` — NEW.
- `packages/extension/src/popup/pages/settings/networks/index.vue` — list of Networks.
- `packages/extension/src/popup/pages/settings/networks/[id].vue` — NEW; Network detail with endpoint list.
- `packages/extension/src/popup/components/modules/general/NetworkBadge.vue` — reads `chainId`. Unchanged.
- `packages/extension/src/popup/pages/settings/connected-apps/[id].vue` — calls `getNetworks(chainId?)`. Unchanged.

### dApp bridge surface (no change, but typecheck verifies)
- `packages/wallet-bridge/src/{caip,session-types,services-contract,dispatcher}.ts` — `INetworkRef` is structurally compatible (id + chainId + optional isDefault).

### E2E tests (PR-5 + each affected PR adds smoke)
- `packages/extension/tests/e2e/network/networks.test.ts` — needs the 4 chain names asserted. Will keep working since Network names survive migration; add per-endpoint tests in PR-5.
- `packages/extension/tests/e2e/settings-crud.test.ts` — `addNetwork`/`deleteNetworkRow` flows. Splits into Network-CRUD + Endpoint-CRUD; helper renames in `helpers.ts`.
- `packages/extension/tests/e2e/fixtures/helpers.ts:115-135` — `openNetworkPopup`, `switchToNetwork`, `switchToLocalNetwork`, `deleteNetworkRow` — selectors + behavior change in PR-3/PR-4.

### Backup/restore (PR-1)
- `packages/extension/src/wallet/services/network/service.ts:320-352` — `backup()` returns `Network[]`; `restore(networks: Network[])`. Update to backup `{ networks: NewNetwork[], endpoints: NetworkEndpoint[] }` + accept old shape via v0→v1 transformer in the restore path.
- `packages/extension/src/popup/pages/settings/security/export/full.vue:50` — calls `s.backup()`. No change needed; the service handles its own shape.
- `packages/extension/src/popup/pages/import.vue` — calls `networkService.restore(backup.data.network)`. No change in caller (the service accepts the old shape via the transformer).

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

**After rework**:
```ts
public async getNode(chainId: number): Promise<AztecNode> {
    let node = this.nodes.get(chainId)
    if (!node) {
        const network = await this.getNetworkByChainId(chainId)  // 1 row
        const endpoint = await this.getEndpoint(network.activeEndpointId)
        node = this.nodeFactory.createNode(endpoint.rpcUrl)
        this.nodes.set(chainId, node)
    }
    return node
}
```

The `Map<number, AztecNode>` cache invalidates whenever `setActiveEndpoint(networkId, endpointId)` runs OR the underlying endpoint's URL changes. Implementation: emit `onActiveEndpointChanged(network)` and have the cache eviction listener clear that chainId entry.

**`NetworkService` synthesizes `NetworkInfo`** for callers that ask for one (e.g. via a new `getNetworkInfo(networkId): NetworkInfo` method) — `{ profileId, chainId, rpcUrl: <active endpoint url> }`. Today this is implicit because Network IS the NetworkInfo shape; after rework it's a small synthesis call.

---

## 5. Migration strategy

### Constraints

- One-shot. Idempotent (re-running is a no-op).
- Survives `chrome.storage.local` partial reads / write failures by NOT setting the version sentinel until ALL writes succeed.
- Pre-launch: a small loss is tolerable, but we still aim for losslessness because we want a production-grade migrator pattern in the codebase. Future migrators (M4.7 when users exist) will reuse this shape.
- Runs AFTER the existing v2 migrator wipe (which clears accounts/txs/balances/PXE).

### Algorithm (v3 migrator)

```ts
async function migrateNetworksV2toV3(log: (msg: string) => void): Promise<void> {
    // 1. Read existing rows under "nulo:core:networks"
    const rawAll = await chrome.storage.local.get(null)
    const oldRows: OldNetwork[] = []
    for (const [key, value] of Object.entries(rawAll)) {
        if (key.startsWith("nulo:core:networks@") && value && typeof value === "object") {
            oldRows.push(value as OldNetwork)
        }
    }

    // 2. Group by (profileId, chainId)
    const groups = new Map<string, OldNetwork[]>()
    for (const row of oldRows) {
        const k = `${row.profileId}:${row.chainId}`
        const arr = groups.get(k) ?? []
        arr.push(row)
        groups.set(k, arr)
    }

    // 3. For each group, build (Network, Endpoint[]) under new keys
    const newNetworks: NewNetwork[] = []
    const newEndpoints: NetworkEndpoint[] = []

    for (const [_, rows] of groups) {
        // Pick the row with isDefault=true as canonical Network row
        // (preserves user's prior "default" pick as the active endpoint)
        const canonical = rows.find(r => r.isDefault) ?? rows[0]
        const networkId = canonical.id  // reuse old id → keeps `nulo:ui:lastActiveNetwork@<profileId>` pointing at it

        // Build endpoints (one per old row)
        const endpoints = rows.map(r => ({
            id: r.id === networkId ? `${r.id}-ep` : r.id,  // primary endpoint gets the canonical id w/ -ep suffix
            networkId,
            rpcUrl: r.rpcUrl,
            label: r.name === canonical.name ? undefined : r.name, // distinct label for non-canonical
        }))

        newNetworks.push({
            id: networkId,
            profileId: canonical.profileId,
            chainId: canonical.chainId,
            name: canonical.name,
            activeEndpointId: endpoints[0].id,  // canonical first
        })
        newEndpoints.push(...endpoints)
    }

    // 4. Write new shape — uses EntityStorage's prefix
    for (const net of newNetworks) {
        await chrome.storage.local.set({ [`nulo:core:networks@${net.id}`]: net })
    }
    for (const ep of newEndpoints) {
        await chrome.storage.local.set({ [`nulo:core:network-endpoints@${ep.id}`]: ep })
    }

    // 5. Delete any orphan old-shape rows (those that survived the rewrite but
    //    don't match any new key) — none should exist since we reused IDs, but
    //    defensive sweep for partial-failure recovery.
    const survivingKeys = new Set([
        ...newNetworks.map(n => `nulo:core:networks@${n.id}`),
        ...newEndpoints.map(e => `nulo:core:network-endpoints@${e.id}`),
    ])
    const deleteKeys: string[] = []
    for (const key of Object.keys(rawAll)) {
        if (key.startsWith("nulo:core:networks@") && !survivingKeys.has(key)) {
            deleteKeys.push(key)
        }
    }
    if (deleteKeys.length) await chrome.storage.local.remove(deleteKeys)

    log(`Network migration: ${oldRows.length} rows → ${newNetworks.length} Networks + ${newEndpoints.length} Endpoints.`)
}
```

The version sentinel (`nulo:core:storage-version` = 3) is set ONLY after this completes. If it crashes, the next boot retries.

### What survives the migration
- Per-profile Networks (one per chainId).
- Endpoint URLs (1:1 with old rows).
- The user's prior "default" pick as the active endpoint.
- `nulo:ui:lastActiveNetwork@<profileId>` keys (still point at a valid Network id because we reused the canonical row's id).
- `nulo:ui:activeNetwork` (legacy) — same; if it points at a non-canonical id (a non-default same-chain peer), the UI fallback (`app.vue:96-99`) finds default network. Safe.

### What gets wiped (existing v2 migrator behavior, unchanged)
- `nulo:core:accounts` — accounts already wiped by v2 (Aztec address-derivation mismatch). v3 doesn't re-wipe.
- `nulo:core:txs`, `nulo:core:tx-cursors`, `nulo:core:token-balances` — same.
- IndexedDB `pxe/*`, `keyval-store` — same.

### Failure-mode tests
1. Migration is idempotent: run twice, second is no-op.
2. Partial storage write (mid-migration crash): version sentinel not set, next boot re-runs cleanly.
3. Empty storage (fresh install): no-op (no `nulo:core:networks@*` keys exist).
4. Single-row-per-chain (the typical post-fresh-install state): produces 1 Network + 1 Endpoint per chain, no surprises.
5. Multi-row-per-chain with isDefault: canonical row chosen correctly.
6. Multi-row-per-chain WITHOUT any isDefault: first row chosen.

---

## 6. UX redesign

### Settings → Networks (top-level page)

**Today** (`pages/settings/networks/index.vue`): one row per `Network` (chain + rpcUrl combined), each with edit + delete + radio-style "is current."

**After rework**: one row per logical Network (per chain). Each row shows:
- Chain icon (existing `NetworkBadge`)
- Network name ("Testnet")
- Currently active endpoint label OR truncated RPC URL ("Primary · rpc.testnet…")
- Right-side: chevron to drill into per-Network detail

Tapping the row navigates to `/popup/settings/networks/<networkId>`.

A "current" radio still appears (selecting a Network promotes it to the active chain, like today's setDefault).

A "+ Add network" button at the bottom opens the New-Network popup (creates a Network + first endpoint atomically).

### Settings → Networks → [Network Detail] (NEW page)

Route: `/popup/settings/networks/[id]`

Layout:
```
[SubPageHeader: <Network name>]

Section: Network info
  Name: <input — rename Network>
  Chain ID: 4138294185 (read-only)

Section: Endpoints (<count>)
  - <SettingItem per endpoint>
    - Label OR rpcUrl (truncated)
    - Right: "Active" pill if active; chevron to edit; delete icon (hidden if last endpoint)
  + Add endpoint

Section: Danger zone
  Delete network (red, opens confirm dialog "wipes accounts on this chain")
```

Tapping an endpoint row opens `EditEndpointPopup` (rename label + rpcUrl).

The "Active" pill is the explicit affordance — user taps a non-active row to switch active. We could ALSO add a swap-active-endpoint mini-button next to each row, but for popup UX pinpoint accuracy beats button density. Default: tap the row to make it active.

### Chain-switcher (NetworksPopup)

**Today**: lists all Network rows (the chain-endpoint pairs). After rework with someone running 2 RPCs on testnet, they'd see "Testnet" + "Testnet Mirror" as peers — bad.

**After rework**: one row per logical Network. Each row: chain icon + Name + tiny subtitle showing the active endpoint label/URL.

Switching here only swaps the active chain (today's behavior). Endpoint switching lives in Settings → Networks. This intentional separation:
- Top-of-funnel UX: 95% of users only swap chains, not endpoints. Don't pollute the popup.
- Power-user UX: endpoint management is one-click further (Settings → Networks → [Network] → endpoint row).

Existing testid contracts stay: `data-testid="network-button"` (header trigger), `data-testid="networks-popup"` (popup container), `data-testid="network-item"` + `data-network-name="<name>"` (clickable rows). These keep `helpers.ts` working with one-line edits.

### New-Network popup

Today: name + rpcUrl + "create."

After rework: name + rpcUrl + "create." Same UI. Internally: creates Network + first endpoint atomically. The endpoint gets `label: undefined` (Network name is the displayed label until user edits).

### Add-Endpoint popup (NEW)

Triggered from Settings → Networks → [Network detail] → "+ Add endpoint":
```
[Header: Add endpoint to <Network name>]

Label (optional): <input — "Backup", "Cloudflare", etc>
RPC URL: <input>

[Probe button — fetches getNodeInfo, validates chainId matches Network's chainId]
[Save (disabled until validated)]
```

Validation rule: RPC must respond AND its derived chainId must match `Network.chainId`. Mismatch shows error: "This RPC is on chain X, but this Network is chain Y."

### Edit-Endpoint popup (NEW)

Same UI as Add, prefilled. Save updates label + rpcUrl (with chainId revalidation if URL changed). Cancel reverts.

### Delete-Endpoint flow

Tap delete icon on a non-active endpoint → ConfirmPopup → wipes the Endpoint row.

If the endpoint is active: button disabled. User must select a different active endpoint first (UI hints "Make another endpoint active to delete this one").

If it's the last endpoint on a Network: button hidden. User must delete the Network instead.

### Header indicator

Today the header globe button shows the active Network name. After rework: still shows Network name (the chain name). For users with multiple endpoints, a tiny secondary indicator could surface "via Backup" — but this clutters the header. **Recommendation**: don't add a header endpoint indicator; keep header clean.

### data-testid additions
- `setting-networks-list` — root of network list
- `network-row[data-network-id="<id>"]` — already exists
- `network-row-endpoint-count` — small hint
- `endpoint-row[data-endpoint-id="<id>"]` — new
- `endpoint-active-pill` — new
- `endpoint-edit-btn` — new
- `endpoint-delete-btn` — new
- `endpoint-add-btn` — new
- `add-endpoint-submit`, `add-endpoint-rpc-input`, `add-endpoint-label-input` — new
- `edit-endpoint-submit`, `edit-endpoint-rpc-input`, `edit-endpoint-label-input` — new

---

## 7. PR-by-PR breakdown (iterative)

Each PR self-contained. Each PR ends with verification gates. CI must be green before merge.

### PR-1 — Spec + service + storage migration + unit tests (the core)

**Branch**: `m4.10/01-network-rework-core`

**Files**:
- `packages/extension/src/wallet/services/network/spec.ts` — REWRITE: new types (Network without rpcUrl/isDefault, NetworkEndpoint), new zod schemas, new method tuple types.
- `packages/extension/src/wallet/services/network/service.ts` — REWRITE: new methods, new lookup map, new lock pattern, backup/restore.
- `packages/extension/src/wallet/services/network/client.ts` — REWRITE in lockstep with spec.
- `packages/extension/src/wallet/services/network/service.test.ts` — EXTEND with ~20-25 new tests (see test plan).
- `packages/extension/src/wallet/storage/migrate.ts` — bump CURRENT_VERSION 2→3, append `migrateNetworksV2toV3`. Idempotent.
- `packages/extension/src/wallet/storage/migrate.test.ts` (NEW) — 6 migration tests.
- `packages/extension/src/wallet/services/profile/service.integration.test.ts` — extend (NetworkService init touches profile activation).
- `packages/extension/src/wallet/services/{token,token-balance,note,fpc,transaction,account-state,execution}/service.ts` — typecheck-driven follow-through (only places that destructure `.isDefault` / `.rpcUrl` from a Network — most just take Network and pass it along; minimal mechanical edits).
- `packages/extension/src/wallet/services/execution/tx-request-builder.ts` — same.
- `packages/wallet-bridge/src/caip.ts` — `resolveNetworkByChainId` works as-is (`networks.find(n => n.isDefault) ?? networks[0]` falls through). No edit.
- `packages/wallet-bridge/src/session-types.ts` — `INetworkRef.isDefault?: boolean` stays optional (no edit). New Networks just don't populate it.

**New/changed methods on NetworkService**:
- `getNetworks(chainId?: number): Network[]` — unchanged signature; new shape.
- `getNetwork(id: string): Network` — unchanged.
- `getOrInitNetworks(): Network[]` — seeds 4 default Networks + 1 endpoint each on first run.
- `addNetwork(name: string, rpcUrl: string): Network` — creates Network + first endpoint atomically.
- `updateNetwork(id: string, name: string): Network` — RENAMES (no longer takes rpcUrl).
- `deleteNetwork(id: string): Network` — cascades Endpoint rows.
- `setActiveNetwork(id: string): Network` — replaces `setDefault` semantics (chain switch).
- `getEndpoints(networkId: string): NetworkEndpoint[]` — NEW.
- `addEndpoint(networkId: string, label: string | undefined, rpcUrl: string): NetworkEndpoint` — NEW.
- `updateEndpoint(endpointId: string, label: string | undefined, rpcUrl: string): NetworkEndpoint` — NEW.
- `deleteEndpoint(endpointId: string): NetworkEndpoint` — NEW; rejects if it's the active one.
- `setActiveEndpoint(networkId: string, endpointId: string): Network` — NEW.
- `getNodeStatus(networkId: string): NodeStatus` — unchanged signature; uses active endpoint.
- `getNode(chainId: number): AztecNode` — unchanged signature; uses active endpoint.
- `backup()` and `restore()` — new shape (see §5).

**New events**:
- `onNetworkAdded`, `onNetworkUpdated`, `onNetworkDeleted` — existing.
- `onActiveNetworkChanged` — REPLACES `onDefaultNetworkChanged`.
- `onEndpointAdded`, `onEndpointUpdated`, `onEndpointDeleted` — NEW.
- `onActiveEndpointChanged` — NEW (fires when `setActiveEndpoint` runs).

**Deprecated**: `setDefault` (renamed to `setActiveNetwork`) and `onDefaultNetworkChanged` (renamed to `onActiveNetworkChanged`). The clients that call these all live in `popup/` and the e2e helpers — get renamed in PR-2/PR-3.

**Verification gate**:
- `bun run typecheck` clean (this surfaces every consumer that breaks).
- `bun run --filter '@nulo/extension' test` — all green, including 20+ new NetworkService tests + 6 migration tests + ProfileService integration extension.
- `bun run lint` clean.
- `bun run build:chrome` produces a working `dist/`.
- E2E SMOKE only (`bun run test:e2e`) — should pass; we haven't changed UI yet.

**Failure mode if merged alone**: NONE — service is internally consistent and the popup still works because:
- `getNetworks` / `getNetwork` / `setDefault` (now `setActiveNetwork`) still exist (via alias if needed for the duration of one PR).

But the popup UI's `setDefault` calls + `Network.rpcUrl` reads break in PR-2. So PR-1 has to ALSO ship a thin compatibility layer:
- Keep `setDefault(id)` as an alias for `setActiveNetwork(id)` (deprecation comment, removed in PR-2).
- Keep `onDefaultNetworkChanged` as an alias firing on `onActiveNetworkChanged`.
- Stop populating `Network.rpcUrl` on rows but keep the type field as `rpcUrl?: string` for ONE PR cycle so consumers that destructure don't typecheck-fail. Remove in PR-2.

Or — more aggressive — break it all at once and let PR-2 land before PR-1 hits master via a stack. **Recommendation**: ship PR-1 with the 1-cycle compat aliases. Audit can challenge.

---

### PR-2 — app.store + initNetworks + UI plumbing

**Branch**: `m4.10/02-store-init-flow`

**Files**:
- `packages/extension/src/stores/app.store.ts:88-109` — extend the networks slice:
  - `endpoints: ref<NetworkEndpoint[]>` (per active Network).
  - `activeEndpoint: computed<NetworkEndpoint | undefined>` — derived from `network.activeEndpointId` + `endpoints`.
  - Add `addEndpoint`, `updateEndpoint`, `removeEndpoint`, `setActiveEndpoint` mutators.
  - `removeNetwork` cascades correctly (server-side already handles).
  - `updateNetwork(id, name)` — drops the `url` parameter.
- `packages/extension/src/popup/app.vue:75-103` — `initNetworks()`:
  - Load networks + endpoints in parallel.
  - Call `setActiveNetwork(network.id)` (renamed from `setDefault`).
  - Subscribe to `onActiveEndpointChanged` to refresh `appStore.endpoints` for that Network.
- `packages/extension/src/popup/components/popups/NetworksPopup.vue:35` — replace `setDefault` call with `setActiveNetwork`.
- `packages/extension/src/popup/components/popups/NewNetworkPopup.vue:57` — same rename.
- `packages/extension/src/popup/pages/settings/networks/index.vue:39, 60` — same rename.
- Wire `onActiveEndpointChanged` listener in Pinia.
- Drop the PR-1 compat aliases.

**Verification gate**:
- typecheck clean (compat aliases gone, all callers explicit).
- E2E smoke green (header still shows network, popup still switches, settings list still works — UI is unchanged, only the underlying call names changed).
- `bun run --filter '@nulo/extension' test` green.

**Failure mode if merged alone**: app.vue.initNetworks references `setActiveNetwork` which doesn't exist without PR-1. ONLY mergeable as `PR-1 → PR-2`.

---

### PR-3 — Settings → Networks UX redesign

**Branch**: `m4.10/03-settings-ux`

**Files**:
- `packages/extension/src/popup/pages/settings/networks/index.vue` — REWRITE (one row per Network; chevron drills into detail).
- `packages/extension/src/popup/pages/settings/networks/[id].vue` — NEW (per-Network detail with endpoint list).
- `packages/extension/src/popup/components/popups/NewNetworkPopup.vue` — minor: ensure `addNetwork` returns the Network+endpoint pair correctly.
- `packages/extension/src/popup/components/popups/EditNetworkPopup.vue` — REWRITE (rename Network only; no rpcUrl input).
- `packages/extension/src/popup/components/popups/NewEndpointPopup.vue` — NEW.
- `packages/extension/src/popup/components/popups/EditEndpointPopup.vue` — NEW.
- `packages/extension/src/stores/popup.store.ts` — register the 2 new popup types.
- `packages/extension/src/stores/cache.store.ts` — add `endpointToEditIdx`.
- `packages/extension/src/popup/components/popups/PopupManager.vue` — register the new popups.

**New testids** (per §6).

**Verification gate**:
- Manual smoke: open settings → networks → see chain list. Tap a network → see endpoints. Add an endpoint → success toast. Edit endpoint → save. Delete a non-active endpoint → success. Try to delete the active endpoint → button disabled. Delete a network → confirm dialog → success → router.back.
- E2E smoke: existing settings-crud test passes (selectors preserved).
- typecheck + lint + build clean.

**Failure mode if merged alone**: would land an updated UI calling `getEndpoints(networkId)` which doesn't exist without PR-1. ONLY mergeable as `PR-1 → PR-2 → PR-3`.

---

### PR-4 — NetworksPopup chain-switcher polish

**Branch**: `m4.10/04-chain-switcher`

**Files**:
- `packages/extension/src/popup/components/popups/NetworksPopup.vue` — show one row per Network (the data is already filtered by chain since `getNetworks()` returns one per chain in the new model — but if any code path returns >1, we Set-dedupe by chainId).
- Optional: secondary subtitle "via {endpointLabel}" if user has >1 endpoint on a chain. Keep it tiny + low-contrast.

**Verification gate**:
- Manual smoke: open chain-switcher (header globe). See one row per chain. Switch chain → header updates.
- E2E: existing `networks.test.ts` (4 chain names visible, switch to local works) passes.

**Failure mode if merged alone**: same dependency chain.

---

### PR-5 — E2E coverage expansion

**Branch**: `m4.10/05-e2e-coverage`

**Files**:
- `packages/extension/tests/e2e/network/networks.test.ts` — add tests:
  - Network list shows one row per chain (4 rows).
  - Per-Network detail page renders endpoint list.
- `packages/extension/tests/e2e/network/endpoints.test.ts` — NEW:
  - Add endpoint to existing chain (RPC probe).
  - Edit endpoint label.
  - Delete non-active endpoint (last one disabled).
  - Set active endpoint mid-session, send a tx, verify state continuity (tx confirms, balances refresh from new endpoint).
- `packages/extension/tests/e2e/settings-crud.test.ts` — add deleteNetwork → cascades endpoints.
- `packages/extension/tests/e2e/fixtures/helpers.ts` — add `addEndpoint`, `setActiveEndpoint`, `deleteEndpoint`, `navigateToNetworkDetail` helpers.
- `packages/extension/tests/e2e/migration.test.ts` (NEW, NON-NETWORK SUITE):
  - Pre-seed `chrome.storage.local` with old-shape (v2) Network rows.
  - Boot extension.
  - Verify migrated `nulo:core:networks@*` + `nulo:core:network-endpoints@*` keys.
  - Verify `nulo:ui:lastActiveNetwork@<profileId>` still resolves.

**Verification gate**:
- All e2e network suite green.
- E2E migration test green (using fake-browser fixture).

**Failure mode if merged alone**: tests reference symbols / UI from PR-1/PR-3. Sequential dependency.

---

### PR-6 — Docs + DECISIONS update

**Branch**: `m4.10/06-docs`

**Files**:
- `implementations-plan/M4/DECISIONS.md` — append M4.10 v2 decision (replace the v0 DEFERRED note's text, point to this plan).
- `implementations-plan/M4/10/plan.md` — top-of-file note "SUPERSEDED by `../10-network-rework/plan-v2.md`" (don't delete; archived).
- `implementations-plan/M4/10-network-rework/plan-v2.md` — final consolidated plan (this file rev'd post-audit).
- `implementations-plan/M4/10-network-rework/audit-codex.md`, `audit-agent.md`, `audit-diff.md` — created during audit phase.
- `implementations-plan/M4/README.md` — bump M4 status from "closed" to "M4.10 in flight."
- `SECURITY.md` — only if anything changes (default: no changes; the threat model is endpoint-agnostic).

**Verification gate**: doc-only, no code. Plan-merge into master.

**Failure mode if merged alone**: harmless. Can be cherry-picked.

---

## 8. Test plan (overall)

### Unit tests (PR-1, ~25 new)

`network/service.test.ts` (extend the existing harness pattern):
1. `getOrInitNetworks` seeds 4 Networks + 4 Endpoints on first run; idempotent on second call.
2. `addNetwork(name, rpcUrl)` creates Network + first Endpoint, both stored, events fired.
3. `addNetwork` rejects duplicate `name` for same profile.
4. `addNetwork` rejects `rpcUrl` already used by any endpoint of any network in profile.
5. `addNetwork` rejects if RPC's chainId conflicts with an existing Network's chainId in the profile (you'd be adding a duplicate logical chain — instead, ask user to add an Endpoint to existing Network).
6. `updateNetwork(id, name)` renames; rejects collision.
7. `deleteNetwork(id)` cascades endpoints; emits `onEndpointDeleted` per endpoint and `onNetworkDeleted` once.
8. `setActiveNetwork(id)` replaces previous active.
9. `addEndpoint(networkId, label, rpcUrl)` succeeds when RPC's chainId matches.
10. `addEndpoint` rejects when RPC's chainId mismatches Network's chainId.
11. `addEndpoint` rejects rpcUrl already used by any endpoint in the SAME network.
12. `updateEndpoint(id, label, rpcUrl)` re-validates chainId; rolls back on mismatch.
13. `deleteEndpoint` rejects if it's the active endpoint.
14. `deleteEndpoint` rejects if it's the last endpoint on the Network.
15. `setActiveEndpoint(networkId, endpointId)` updates Network.activeEndpointId; emits event; clears `nodes` cache for that chainId.
16. `getNode(chainId)` resolves via active endpoint; cache invalidation on endpoint swap.
17. `getNodeStatus(networkId)` uses active endpoint URL.
18. `backup()` returns `{ networks: Network[], endpoints: NetworkEndpoint[] }`.
19. `restore({ networks, endpoints })` writes new shape; idempotent on conflicts.
20. `restore({ networks: oldShape[] })` (legacy backup) transforms to new shape on read.
21. `onProfileDeleted` cascades all networks + endpoints for that profile.
22. `onActiveProfileChanged` clears the AztecNode cache.
23. Concurrent `setActiveEndpoint` + `getNode(chainId)` — Lock semantics preserve consistency (no torn read).
24. `getNetworks(chainId)` returns the single Network for that chainId in the active profile.
25. `getNetworkInfo(networkId)` returns `{ profileId, chainId, rpcUrl }` synthesizing from active endpoint.

### Migration tests (PR-1, 6 new)

`storage/migrate.test.ts`:
1. Idempotent: run twice; second is no-op (version sentinel guard).
2. Empty storage: no-op.
3. Single-row-per-chain: produces 1 Network + 1 Endpoint per chain.
4. Multi-row-per-chain WITH `isDefault`: canonical row picked correctly.
5. Multi-row-per-chain WITHOUT `isDefault`: first row picked.
6. Mid-write crash (storage-write rejection mock): version sentinel NOT set → re-run on next boot succeeds.

### Integration tests (PR-1, ~5 extend)

`profile/service.integration.test.ts`:
1. `createProfile()` → `getOrInitNetworks()` returns 4 Networks + 4 Endpoints on the new profile.
2. Active profile switch: NetworkService cache evicts; new profile's networks load.
3. `deleteProfile()` cascades both Network and Endpoint rows for that profile.

### E2E smoke tests (PR-1 to PR-4, run after each)

`tests/e2e/network/networks.test.ts` (existing):
1. Default Networks show on fresh popup.
2. Switch to Local Network, header reflects it.
3. Networks page lists all 4 default chain names.

### E2E expanded coverage (PR-5)

`tests/e2e/network/endpoints.test.ts` (new):
1. Add endpoint to Testnet (RPC probe required → network suite only).
2. Edit endpoint label.
3. Delete non-active endpoint → row disappears.
4. Try to delete active endpoint → button disabled.
5. Set non-active endpoint as active → visible in header subtitle.
6. **Continuity test**: send a tx on Endpoint A → swap to Endpoint B → balance refreshes from B → tx history still shows the prior tx.

### E2E migration test (PR-5)

`tests/e2e/migration.test.ts`:
1. Boot extension with pre-seeded v2 storage shape; verify successful migration.

### Performance / non-functional
- Memory: AztecNode cache shouldn't grow unboundedly (one entry per chainId; eviction on profile change).
- Endpoint swap latency: must be < 1s (measured: time from `setActiveEndpoint` to next successful `getNode().getNodeInfo()`).

---

## 9. Risks tracked

1. **AztecNode cache invalidation on endpoint swap.** Today's cache (`network/service.ts:26`) is keyed by chainId. Endpoint swap must explicitly evict it; otherwise the next `getNode(chainId)` returns the stale node bound to the old URL. Mitigation: `setActiveEndpoint` calls `this.nodes.delete(chainId)` before emitting `onActiveEndpointChanged`. Test-covered.

2. **PXE re-init on endpoint swap.** Today's `ChainRuntimeRegistry.getOrInit` (`chain-runtime.ts:128-155`) compares `existing.rpcUrl` and disposes if changed. After endpoint swap, the next `getOrInit` will dispose+reinit PXE pointing at new URL. The IndexedDB persists (`pxe/${profileId}/${chainId}` is unchanged), so state continuity works. Performance: ~500ms-2s re-init cost. **Acceptable** for an explicit endpoint swap; the optimal path (mutate the AztecNode in place) is a future micro-optimization.

3. **In-flight tx during endpoint swap.** ReadWriteGuard (`pxe/service.ts:68`) ensures any in-flight `proveTx` / `simulateTx` finishes before the registry can `clear()`. So endpoint swap mid-tx waits behind the in-flight job. Test: queue a slow simulateTx, fire setActiveEndpoint, verify the swap waits. Acceptable.

4. **Last-endpoint deletion guard race.** Service-level guard prevents deletion of last endpoint. UI-level guard hides the button. Both checks defend against the race.

5. **Endpoint chainId drift.** A previously-validated endpoint's RPC could later return a different chainId (provider migration / typosquatting). We don't actively probe. UI shows `getNodeStatus(networkId) = InvalidChain` if it drifts at probe time. **Mitigation**: revalidate chainId on every `setActiveEndpoint` call (cheap; one RPC roundtrip). Show error toast if mismatch; don't swap.

6. **Backup restore from older versions.** Old backups have `Network[]` with rpcUrl + isDefault. Restore must accept both shapes (transformer in `restore()`). Test-covered.

7. **SW lifecycle vs config.** Active endpoint state is in `chrome.storage.local` (durable). SW restart re-reads on next access. No `chrome.storage.session` involvement. Verified.

8. **`nulo:ui:lastActiveNetwork@<profileId>` after migration**. Reuses old canonical row id, so the value stays valid. If the value was a non-canonical id (a same-chain peer), `app.vue:96-99` falls back to `n.isDefault` which now isn't populated — so it falls back to `networks[0]` (still works). Test-covered indirectly via migration tests.

9. **dApp protocol stability**. `INetworkRef.id` is the same Network row id pre/post migration. `chainId` unchanged. `isDefault?` becomes `undefined`; consumers (only `caip.ts:74`) handle that case. Verified.

10. **Profile import flow** (`popup/pages/import.vue`) — calls `networkService.restore(backup.data.network)`. The `restore()` accepts old + new shapes via transformer. No caller change.

11. **`getOrInitNetworks` ordering vs profile activation** — must run AFTER profile activates (it filters by `profile.id`). Existing `app.vue.loadProfile()` already serializes this. Confirmed.

12. **`Network.name` collision in import**. Two profiles' backups could be merged; if user imports a backup whose Network names collide with seeded ones, the restore path appends a numeric suffix or overwrites. Decision: overwrite by id (current behavior). Document.

---

## 10. Rollback strategy

Per-PR:
- PR-1: `git revert` reverts spec + service + migrator. Storage version on user disks reverts to 2 only after the revert lands AND the popup boots; in the meantime, runtime reads new-shape rows under v3 sentinel — broken state. **Mitigation**: ship a v3→v2 down-migrator IF we see post-merge regressions. Defensive: gate PR-1 behind a strict QA cycle with the audited dual-audit fixes.

- PR-2 to PR-6: standard `git revert`. Storage state is forward-compatible (v3 rows can be read by both shapes via the transformer in PR-1).

Whole arc rollback (e.g. discover the model is wrong post-launch — TIME-BOXED to before user signups): revert all 6 PRs in reverse order. Storage version sentinel needs to be reset to 2 manually per user — do NOT ship a destructive down-migrator unless we confirm no users have committed v3 data.

---

## 11. Verification commands (per PR)

```bash
bun run typecheck                       # all 8 packages clean
bun run --filter '@nulo/extension' test  # unit + integration
bun run lint                            # biome clean
bun run --filter '@nulo/extension' build:chrome  # builds
bun run test:e2e                        # smoke (no network)
# After PR-5 lands:
bun run test:e2e:all                    # smoke + network suite
```

Manual QA (15 min per UX PR):
- Create profile → see 4 default Networks → switch chain → header updates.
- Settings → Networks → tap Testnet → see endpoint list → add endpoint → label it → save → see in list.
- Set new endpoint as active → header subtitle reflects (if implemented) → balances refresh.
- Send tx on Endpoint A → swap to Endpoint B → balance + tx history continuous.
- Delete non-active endpoint → row disappears.
- Delete network → confirm → wipes accounts on that chain → redirects.
- Backup → import on fresh profile → networks + endpoints restore.

---

## 12. Open questions for user (decision flags)

These should be resolved BEFORE PR-1 starts. Plan v2 will have user's decisions baked in.

1. **`activeEndpointId` on Network vs separate `ActiveEndpoint` table.** I recommend on-Network (simpler, no consistency invariant). User?

2. **Drop `isDefault`?** I recommend yes (no peers). User?

3. **Default Network deletion**: today user CAN delete the "default Testnet". In new model, do we let them delete the only Testnet Network? Recommendation: yes, with confirm dialog. User?

4. **Chainid mismatch handling**: when user adds an endpoint whose RPC returns a different chainId than the Network's. Recommendation: reject at add-time AND on every active-swap (cheap recheck). User?

5. **Migration aggressiveness**: lossless migrator (recommended) vs destructive reseed. Pre-launch either is fine; recommendation is lossless because the migrator pattern is reusable.

6. **Auto-fallback (out of scope per user)**: confirm we're skipping it. The plan reserves `label?` for future label-as-priority semantics.

7. **Header subtitle for non-default endpoint**: show "via Backup" when active endpoint is not the first one? Recommendation: NO — header stays clean. User?

8. **`updateNetwork` drops rpcUrl param** (rename only). Old backup imports get the rpcUrl into the first endpoint via the transformer. Confirm this is the right break.

9. **Plan name in DECISIONS.md**: "M4.10 — Network-model rework" (this plan) vs renumber. Recommendation: keep M4.10 alias for the M4 arc continuation.

10. **Backup format version field**. Today backups don't have an explicit version. Adding one is a small cross-cutting change. Recommendation: defer until M4.7 lands (when users exist + migrations matter for backup). Current strategy: shape-detect at restore time.

---

## 13. Estimated effort

- Planning (this doc + audit + iterate): 1d.
- PR-1 (core): 1.5-2d (largest PR; lots of test surface).
- PR-2 (store + init): 0.5d.
- PR-3 (Settings UX): 1d.
- PR-4 (chain switcher): 0.25d.
- PR-5 (E2E coverage): 0.75d.
- PR-6 (docs): 0.25d.
- Manual QA + iteration: 0.5d.

**Total: ~5-6d execution wall-time.** Fits a single-week arc. M4.7 + M4.11 stay deferred per DECISIONS.md.

---

## 14. Versioning & ship cadence

- After each PR lands on master, bump `packages/extension/package.json` patch version (0.13.9 → 0.13.10 → … → 0.13.15).
- Final release tag at end of arc: `0.14.0` (minor bump — first user-visible UX redesign of network management since pre-Nulo).

---

*End of plan-v1. Awaiting dual audit (codex xhigh + Plan-agent) and user decision on Section 12 open questions.*
