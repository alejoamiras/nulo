# Context blob — multi-RPC auto-failover

This is the shared grounding for the three parallel planners (main + codex + opus). Every fact below was verified against the current `dev` branch (commit `f57bba0f` and earlier).

## User-locked constraints (clarifying-question answers)

1. **Goal level: auto-failover.** When the primary endpoint fails N times in a row, the wallet silently re-points the cached node to the next healthy endpoint and emits a status event. User can still override. Mid-tx coherence handled by pinning the node per in-flight operation.
2. **Scope: L2 (Aztec) only.** Only the Network service in `packages/extension/src/wallet/services/network/`. L1 stays as-is.
3. **Storage: change schema in place, no migration.** The extension is pre-release; `storage/migrate.ts:5` already does destructive wipes on schema bump. We can change the `Network` / `NetworkEndpoint` types freely without versioning concern.
4. **Privacy: probe on-use only.** No background ping loop. Health state is updated only when the wallet actually calls an endpoint as part of user-driven traffic.

## Current code state (verified facts)

### Network service: `packages/extension/src/wallet/services/network/`

- **`spec.ts:13-37`** — types:
  ```ts
  type NetworkEndpoint = { id: string; rpcUrl: string; label?: string }
  type Network = {
    id: string; profileId: string; chainId: number; name: string
    primaryEndpointId: string                    // user's selected primary
    endpoints: NetworkEndpoint[]                 // min: 1 (zod validated)
    kind?: ChainKind
  }
  type NetworkInfo = { profileId: string; chainId: number; rpcUrl: string }
  // synthesised at lookup-time from (Network, primaryEndpoint.rpcUrl)
  ```
- **`spec.ts:139`** — `onPrimaryEndpointChanged: { networkId, endpointId }` event ALREADY EXISTS. The right thing to fire on failover.
- Storage: `EntityStorage<Network>("nulo:core:networks", chrome.storage.local)`.

### Service runtime state (`service.ts:142-155`)

```ts
private readonly nodes = new Map<number, AztecNode>()
//   ^ chainId → cached AztecNode bound to the network's primary endpoint URL.
//     No failure tracking. THIS is what needs failover.

private readonly transientNodes = new Map<string, { node: AztecNode; failures: number }>()
//   ^ url → cached node + failure counter, used by pending-tx polling to
//     pin receipt fetches to the originally-submitted endpoint. Failover
//     prototype already exists here.
```

### Existing failover prototype (`service.ts:519-535`)

```ts
public async getNodeForUrl(url: string, fallbackChainId: number): Promise<AztecNode> {
  const entry = this.transientNodes.get(url)
  if (entry) return entry.node
  const known = await this._isKnownEndpointUrl(url)
  if (!known) return this.getNode(fallbackChainId)
  const created = this.nodeFactory.createNode(url)
  this.transientNodes.set(url, { node: created, failures: 0 })
  return created
}

public reportEndpointFailure(url: string): void {
  const entry = this.transientNodes.get(url)
  if (!entry) return
  entry.failures += 1
  if (entry.failures >= 3) this.transientNodes.delete(url)
}
```

This is the proven pattern. The plan needs to generalize it: bring the same "failure tracking + eviction at threshold" model to the primary `nodes` cache, and re-pick the next-best endpoint instead of just evicting.

### Primary call sites for `getNode(chainId)` (`grep` result, non-test)

```
wallet/services/transaction/service.ts:206       // already calls getNodeForUrl + reportEndpointFailure
wallet/services/execution/service.ts:470,633,1262
wallet/services/execution/tx-request-builder.ts:103,389
```

Plus `getNetwork()` (metadata-only) call sites at `caip.ts:82`, `note/service.ts:52`, `fpc/service.ts:242`, `transaction/service.ts:131,285`, `execution/service.ts:469,617,991,1004,1034,1206,1259,1503,1570,1585,1628,1633`.

### PXE coherence — the load-bearing constraint

- **`packages/aztec-runtime/src/pxe/chain-runtime.ts`** declares `class ChainRuntime { node: AztecNode; pxe: PXE; rpcUrl: string }` — the PXE is *tightly coupled* to a single URL.
- **`ChainRuntimeRegistry.bind(network)` at `chain-runtime.ts:132-135`** rebuilds the runtime when `existing.rpcUrl !== network.rpcUrl`:
  ```ts
  if (existing && existing.rpcUrl !== network.rpcUrl) {
    await existing.dispose()
    // build a new runtime
  }
  ```
- Implication: if failover swaps `getNode(chainId)` to point at a different URL, the next PXE access will trigger a full PXE teardown + rebuild. That's correct but **EXPENSIVE** (PXE init can take seconds; in-flight notes / sync state get rebuilt against the new node's view of the chain).
- The transaction service's existing pattern (`service.ts:205-217`) sidesteps this by **per-op URL pinning**: each pending-tx record stores `submittedEndpointUrl`, and receipt fetches use that URL via `getNodeForUrl` so failover doesn't interrupt an in-flight op.

### Storage migration mechanism (`storage/migrate.ts`)

```
// line 5: "no production users, so the migration is a destructive wipe"
const STORAGE_VERSION_KEY = "nulo:core:storage-version"
```

Per the user constraint: we change the `NetworkEndpoint` / `Network` types freely. No migration code. Anyone running an older version after this lands gets reset, which is acceptable pre-release.

### Events the service already emits (`service.ts:135-140`)

```
onNetworkAdded(Network)
onNetworkUpdated(Network)
onNetworkDeleted(Network)
onActiveNetworkChanged(Network)
onPrimaryEndpointChanged({ networkId, endpointId })   // ← already exists
onChainPurged({ profileId, chainId })
```

`onPrimaryEndpointChanged` is the natural channel for failover to emit "we switched the live URL." The UI can listen and surface a banner.

## Concept the plan needs to nail

1. **Failover trigger** — what counts as "failed N times"? Network error (fetch throw)? `_getChainId` mismatch? HTTP 5xx? RPC-level error (return `{ error: ... }` instead of `{ result }`)? Which to count, which to ignore.

2. **Threshold N** — `transientNodes` uses 3. Is that the right number for the primary cache? Lower (fail fast)? Higher (tolerate flakes)?

3. **Eviction strategy** — when threshold trips, just evict (next call rebuilds against next-best endpoint), or proactively rebuild and emit a status event?

4. **Next-best selection** — round-robin? Order of `endpoints[]`? User-set priority list? Random? Last-known-healthy?

5. **Health state lifecycle** — purely in-memory, lost on SW restart. Or should there be a session-scoped "this endpoint was bad recently" memory? (Constraint: no storage.)

6. **PXE rebuild cost vs failover correctness** — when failover fires, is the right call to:
   - (a) Tear down ChainRuntime and rebuild against the new URL (heavy, but correct).
   - (b) Keep the ChainRuntime, swap the underlying node reference (lighter but breaks the `rpcUrl` invariant).
   - (c) Per-op pinning everywhere — failover only affects NEW operations, in-flight ones complete against the URL they started with.
   - The existing pending-tx pattern is (c).

7. **User UX** — should failover be silent (transparent) or visible (toast / banner)? Both audits' opinions matter here.

8. **Manual override** — user has a `setPrimaryEndpoint(networkId, endpointId)` setter. After failover swaps the live URL, does the next user action reset it back to their preferred primary? Or does the user need to manually retoggle?

## Adversarial surface

The plan's security section needs to address:

- **Endpoint impersonation** — a malicious endpoint reports a fake `chainId` matching the network's. `_getChainId` probe runs on add but not on failover; if a stale endpoint flips chains, failover could land on the wrong chain.
- **Split-brain** — two endpoints report different recent block numbers. The wallet trusts the one it asks. Failover could shift the user's view of "what's the latest tx?" mid-session.
- **Timing oracle** — an attacker who controls one of the user's endpoints can correlate user activity timing with failover events (when the OTHER endpoint goes down) to infer when the user is making transactions.
- **DoS / forced-failover** — an attacker who can degrade one endpoint can force traffic onto another endpoint (theirs, ideally) by waiting for the failure threshold to trip.
- **Stale state on retry** — if a tx is submitted to endpoint A, A returns 500, the wallet fails over to B and re-submits, the tx could land twice (mempool replay). Idempotency story matters.
- **In-flight PXE state coherence** — note decryption progress is per-PXE-instance. Mid-failover, the wallet's "latest decrypted block" could diverge from the new node's view.

## Out-of-scope (per user constraint clarification)

- L1 / Ethereum side (bridge UI's RPC handling).
- Background pinging / periodic health checks.
- Schema migration code (pre-release destructive wipe handles it).
- Multi-chain quorum / split-brain detection at the chain level (we trust each endpoint individually; failover is per-chain).
- New external dependencies — must build on existing `AztecNode` + `NodeFactory` ports.
