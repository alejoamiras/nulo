# Multi-RPC auto-failover (L2) — consolidated plan v1

**Status:** plan v1.2 — APPROVED by user. Two user decisions locked in: (1) drop `primaryEndpointId`, (2) **enable auto-snapback** (reverses v1.1's "manual-only" stance). Implementation in flight on `feat/multi-rpc-failover`.
**Tier:** A — cross-cutting (network service + PXE rebind + ~20 caller sites + popup UX).
**Branch target:** `feat/multi-rpc-failover` cut from `dev`.

## Sourcing the decisions

Each load-bearing call cites which draft it came from. Three voices agreed on most, diverged on a few that mattered.

| Decision | Picked from | Rejected option |
|---|---|---|
| Schema: `primaryEndpointId` | **opus + main** | codex (kept it as a separate field) — rejected because preferred-vs-active distinction is cleaner as `endpoints[0]` (persisted, sticky) vs `activeEndpointId` (in-memory, ephemeral). One persisted source of truth. |
| Failure threshold (live) | **all three** | n/a — all picked 2 |
| Failure threshold (transient/pinned) | **codex** | n/a — keep existing 3 in `transientNodes` |
| Strike decay window | **opus** | codex didn't address; main missed it |
| Demoted-endpoint cooldown | **all three** | n/a — 5 min |
| Failure classifier (4-bucket: hard/soft/ignore/evict) | **opus** | codex's 2-bucket model is too coarse for the 4xx case |
| Retry-on-failure policy | **codex** | opus's "reads retry once". Codex's no-replay is simpler and removes a class of double-execute bugs. |
| Events: extend `onPrimaryEndpointChanged` with `source` discriminator | **codex** | opus's 3 separate new events. Codex's single-event-with-source is more elegant. |
| In-memory state shape | **opus + codex** | main's coarser shape rejected |
| `nodes` map shape carries identity | **opus + codex** | main's bare `AztecNode` rejected |
| `acquireBinding(chainId)` helper | **codex** | opus's `acquireNode`; codex's `NetworkBinding = { network, endpoint, info, node }` is the more complete shape |
| PXE rebind under per-chain write guard | **codex** | opus's "lazy via getOrInit" missed the serialization concern with `pxe/service.ts:376-443` |
| **Don't ever call `clearChainState()` on failover** | **codex** | opus + main missed this entirely — it would wipe notes/senders/contracts |
| UX: amber "Degraded" header dot when active != preferred | **codex** | main + opus had only a toast |
| UX: separate Preferred + Active markers in settings | **codex** | main + opus didn't separate |
| Caller-site sweep scope | **codex** | main + opus underspecified. Codex enumerated ~20 sites covering account-state, token, fpc, note, execution, tx-request-builder. |
| Nonce-determinism caveat for double-submit | **opus** | flagged for verification during impl |

## Architecture decisions (the 8 questions)

### Q1. What counts as a failure?

Four buckets, classified at the call boundary by a new pure helper `classifyEndpointError(err): { kind, reason }` in `packages/extension/src/wallet/services/network/error-classifier.ts`:

| Kind | Triggers | Effect |
|---|---|---|
| **hard** | `fetch` reject (TypeError, ECONNREFUSED, DNS, TLS, non-user AbortError), HTTP 5xx, HTTP 429, JSON-RPC code `-32603` / `-32000…-32099`, JSON-RPC body whose message contains `timeout`/`overloaded`/`unavailable` | Increment hard counter. Threshold = 2. |
| **soft** | HTTP 4xx other than 429 (we don't have a slow-response detector in v1 — see "deferred to follow-up" below) | Increment soft counter. Threshold = 8. |
| **ignore** | JSON-RPC `-32600`/`-32601`/`-32602` (our bug), user-initiated abort, parse error against a 2xx response | No counter change. |
| **evict** | `_getChainId` mismatch on a promotion candidate | Permanent session quarantine for that endpoint. |

The fetch layer at `packages/aztec-runtime/src/utils/fetch.ts:34-97` already does transport-level retries/backoff, so a counted failure is post-retry evidence, not a single network blip.

### Q2. Threshold N

- **Live primary path**: 2 consecutive hard failures (or 8 consecutive soft) → failover trigger.
- **Transient URL-pinned cache** (`transientNodes`, existing): keep the existing 3. It tolerates polling-tick blips.
- **Strike decay**: 60s of healthy traffic resets the counter to 0 (lazy check on next update — no timer needed).
- **Demote cooldown**: when an endpoint is evicted from live routing, it's marked `cooldownUntil = now + 5min`. Eligible for re-promotion after that elapses or on user-driven `clearEndpointCooldowns(networkId)`.

### Q3. Eviction vs proactive swap

**Proactive swap.** On threshold trip:

1. Under `this.lock`, walk `endpoints[]` in order starting after the current active, skipping any in cooldown or invalidChain quarantine.
2. Probe each candidate's chainId via the existing `_getChainId(rpcUrl)` (`service.ts:726-736`). Codex final-pass §7 item 4: the 5s `AbortController` timeout I sketched earlier isn't plumbed through `NodeFactory.createNode` (`packages/aztec-runtime/src/ports/node-factory-port.ts:23-24`); v1 uses `_getChainId`'s existing transport-level timeout (already inside `makeFetchWithTimeout`, `packages/aztec-runtime/src/utils/fetch.ts:17-18, 87-97`). Adding per-call timeout to the node-factory port is a separate plumbing change, deferred to follow-up.
3. On match: build a new node via `nodeFactory.createNode(rpcUrl)`, replace `nodes.get(network.chainId)`, demote the previous active to cooldown, emit `onPrimaryEndpointChanged({ from, to, source: "failover" })`.
4. On chainId mismatch: mark `invalidChain` for that endpoint for the session, recurse to next.
5. On exhaustion: set `exhaustedAt = now`, emit `onPrimaryEndpointDegraded({ networkId, exhausted: true })`, leave the broken node in place.
6. **DO NOT generically replay the failing call.** The original error bubbles to the caller. The next call to `getNode(chainId)` uses the post-failover route. Polling loops naturally recover; user-driven ops re-fire via the UI.

### Q4. Next-best selection

**`endpoints[]` order is priority order.** Index 0 = user-preferred. The runtime scans forward from the current active endpoint, wraps once, skips cooled-down + quarantined entries. No randomization, no round-robin, no eager failback.

**Schema collapse**: drop `primaryEndpointId` from persisted state. `setPrimaryEndpoint(networkId, endpointId)` becomes `promoteEndpoint(networkId, endpointId)` which splices the endpoint to index 0 and clears its cooldown. Persisted state is "the user's priority order"; in-memory state is "where traffic is currently going."

### Q5. Health state lifecycle

In-memory only, lost on SW restart. Per the user constraint. New private field on `NetworkService`:

```ts
private readonly routeState = new Map<string /* networkId */, NetworkRouteState>()

type NetworkRouteState = {
  activeEndpointId: string                      // current routing target (may differ from endpoints[0])
  failures: Map<string /* endpointId */, { hard: number; soft: number; lastIncidentAt: number }>
  cooldownUntil: Map<string /* endpointId */, number>
  invalidChain: Set<string /* endpointId */>    // permanent-for-session
  exhaustedAt?: number
}
```

The `nodes` Map (`service.ts:143`) is rebuilt as `Map<number /* chainId */, { node: AztecNode; endpointId: string; rpcUrl: string }>` so cache lookups carry endpoint identity.

### Q6. PXE coherence — the hardest call

**Per-op pinning for node calls + PXE rebind under per-chain write guard for runtime.**

Three components:

1. **In-flight ops stay pinned** to the URL they started on, via the existing `getNodeForUrl` pattern (`service.ts:519-535`) extended to all ops via the new `acquireBinding(chainId): NetworkBinding` accessor. The `NetworkBinding` shape:
   ```ts
   type NetworkBinding = {
     network: Network
     endpoint: NetworkEndpoint
     info: NetworkInfo                  // { profileId, chainId, rpcUrl }
     node: AztecNode
   }
   ```
   Callers capture this once at the start of a logical op; all subsequent reads in that op use the same `binding.node` and `binding.endpoint.rpcUrl`.

   **Failure-reporting contract (codex final-pass §6 — the load-bearing missing piece):** `acquireBinding()` is only half the API. Every caller MUST wrap its `binding.node.*()` calls in `try { ... } catch (e) { networkService.reportEndpointFailure(binding.endpoint.id, e); throw e }`. Without this wrapper, `reportEndpointFailure` is never invoked on the primary path and failover never triggers — only the legacy transient tx-poll path (`transaction/service.ts:204-218`) currently reports failures. The plan introduces a tiny helper to make this discipline impossible to skip:

   ```ts
   // service.ts (new)
   public async withBinding<T>(chainId: number, fn: (b: NetworkBinding) => Promise<T>): Promise<T> {
     const binding = await this.acquireBinding(chainId)
     try {
       return await fn(binding)
     } catch (err) {
       this.reportEndpointFailure(binding.endpoint.id, err)
       throw err
     }
   }
   ```

   Phase 3's caller-sweep replaces every `getNode(chainId)` + raw `.method()` with `withBinding(chainId, b => b.node.method(...))`. The wrapper is the only sanctioned way to consume a node — manual binding acquisition without the try/catch is a code-review block. The classifier inside `reportEndpointFailure` decides whether the error counts toward threshold; ignore-bucket errors don't move the counter, so wrapping cost is cheap.

2. **PXE rebind is serialized**, not opportunistic. The existing `ChainRuntimeRegistry.getOrInit()` at `chain-runtime.ts:129-156` already rebuilds when `rpcUrl` changes, but the rebind needs to happen under the per-chain write guard at `pxe/service.ts:376-443` so in-flight readers drain before disposal. The plan moves the `rpcUrl !== network.rpcUrl` detection from the opportunistic registry-read path into an explicit serialized rebind triggered by the network service's failover event.

3. **NEVER call `clearChainState()` on failover.** That function (`pxe/service.ts:376-401`) wipes notes/senders/contracts for the chain. Reusing it would be a correctness disaster — the chain DB stays valid across endpoint changes because the chainId is unchanged.

This combination means in-flight ops complete on their captured URL even if failover happens mid-flight; the next op blocks behind the per-chain guard long enough for the rebind to finish, then runs on the new endpoint; PXE state (decryption progress, sync block) survives the swap.

### Q7. User UX

**Visible but non-blocking.** Three events drive the UI:

- **`onPrimaryEndpointChanged`** (existing event, payload extended): now carries `{ networkId, fromEndpointId, toEndpointId, source: "failover" | "manual" }`.
- **`onPrimaryEndpointDegraded`** (new event): `{ networkId, exhausted: boolean }` — fires when all endpoints are unhealthy.

UI responses:

| Surface | Trigger | Behavior |
|---|---|---|
| Popup toast | `onPrimaryEndpointChanged` with `source: "failover"` | One toast, 6s: "RPC switched to \<endpoint label\>". |
| Header status dot | `activeEndpointId !== endpoints[0].id` | Amber "Degraded" indicator. Existing green/red dots stay. |
| Settings → Networks → \<network\> | always | Show both "Preferred" marker (next to `endpoints[0]`) and "Active" marker (next to currently-routing endpoint) when they differ. |
| Settings → Networks → \<network\> | `onPrimaryEndpointDegraded({ exhausted: true })` | Persistent banner: "All endpoints for \<chain\> are unreachable" + "Retry preferred" button → calls new RPC `clearEndpointCooldowns(networkId)`. |

User actions (codex final-pass §7 item 3 — promote/clear MUST NOT flip `activeEndpointId` before re-probing):

- Clicking "Retry preferred" → `clearEndpointCooldowns(networkId)` → clears cooldowns + invalidChain set for that network. **Does NOT set `activeEndpointId` directly.** Next traffic call goes through the normal `getNode` path which probes `endpoints[0]` first; only on probe success does `activeEndpointId` flip back.
- Clicking an endpoint row in settings → `promoteEndpoint(networkId, endpointId)` → splices the endpoint to index 0 (persisted), clears that endpoint's cooldown + invalidChain entry. **Does NOT flip `activeEndpointId` directly.** The next `getNode` call probes the newly-promoted endpoint; on probe success, `activeEndpointId = endpointId` and `onPrimaryEndpointChanged({ source: "manual" })` fires. On probe failure (e.g. user promoted a chain-mismatched endpoint), failover engages from there. This preserves the chain-mismatch security invariant — manual promotion never bypasses the probe.

### Q8. Manual override semantics + auto-snapback (user decision, v1.2)

Manual override is **sticky preference**. The user's choice rewrites the persisted `endpoints[]` order; auto-failover never does.

**Auto-snapback (NEW in v1.2 — user enabled it):** when the preferred endpoint's cooldown elapses, the next `getNode(chainId)` call tries preferred FIRST as an opportunistic probe. If preferred succeeds, snap back: `activeEndpointId = endpoints[0].id`, emit `onPrimaryEndpointChanged({ from: prev, to: preferred, source: "snapback" })`. If preferred fails, extend its cooldown by another 5min (multiplicative, not additive — second snapback attempt cools for 5min after that fails, etc.) and continue serving from the current active.

**Anti-flapping bound**: the cooldown clock means at most one extra probe round-trip every 5min per chainId. If preferred is consistently bad, the user sees periodic "snapback failed" attempts but no rapid oscillation. The user can still hit "Retry preferred" to force an immediate probe.

**Snapback event source** = `"snapback"` (third value in the source enum, distinct from `"failover"` and `"manual"`). UI surfaces a small toast: "Reconnected to preferred RPC: <label>". Clears the amber Degraded dot on success.

Cross-restart behavior unchanged: SW restart wipes in-memory state, next call starts fresh from `endpoints[0]`.

**Cross-restart**: SW restart wipes `routeState`. Next traffic call starts fresh from `endpoints[0]`. This is correct — failover is operational, not preferential.

## Schema changes (concrete)

### Persisted shape

```diff
type NetworkEndpoint = { id: string; rpcUrl: string; label?: string }

type Network = {
  id: string
  profileId: string
  chainId: number
  name: string
- primaryEndpointId: string           // ← REMOVED
  endpoints: NetworkEndpoint[]         // now priority-ordered; min: 1
  kind?: ChainKind
}

type NetworkInfo = { profileId: string; chainId: number; rpcUrl: string }
```

Pre-release destructive wipe (`storage/migrate.ts:5`) handles the change. Bump `CURRENT_VERSION` so existing pre-release stores get re-seeded.

### Error code removed

`ERR_PRIMARY_ENDPOINT` (`spec.ts:69`) is unreachable post-schema — the `endpoints[]` array always has ≥1 entry (`spec.ts:89` zod min(1)), and `deleteEndpoint` keeps the `ERR_LAST_ENDPOINT` guard. Drop the constant.

### Service-layer types (new, not persisted)

```ts
// New, in service.ts or a new internal file
type NetworkBinding = {
  network: Network
  endpoint: NetworkEndpoint
  info: NetworkInfo
  node: AztecNode
}

type NetworkRouteState = {
  activeEndpointId: string
  failures: Map<string, { hard: number; soft: number; lastIncidentAt: number }>
  cooldownUntil: Map<string, number>
  invalidChain: Set<string>
  exhaustedAt?: number
}
```

### RPC methods (delta in `NetworkMethodSchemas` `spec.ts:107-160`)

- `setPrimaryEndpoint` → **`promoteEndpoint(networkId, endpointId): Network`** (same shape, renamed for clarity; behavior: splice to index 0 + clear cooldown).
- New: **`clearEndpointCooldowns(networkId): Network`** — clears cooldowns + invalidChain set, returns updated network. Used by the "Retry preferred" banner button.
- New: **`getEndpointHealth(networkId): EndpointHealthSnapshot`** — serializable read of `routeState` (a plain-object projection — Map → Record, Set → array). Used by the settings page to render dots.
- `addEndpoint`, `updateEndpoint`, `deleteEndpoint` — unchanged.

### Events (delta in `spec.ts:211-227`)

- `onPrimaryEndpointChanged`: payload extended from `{ networkId, endpointId }` → `{ networkId, fromEndpointId, toEndpointId, source: "failover" | "manual" | "snapback" }`.
- New: `onPrimaryEndpointDegraded: { networkId; exhausted: boolean }`.

(The existing event is reused for failover. Opus proposed three separate events; codex's discriminator-on-existing-event is more elegant and existing UI listeners just need a payload update.)

## Failover state machine

```
state INITIAL                                          # SW boot or post-restore
  on first call to getNode(chainId)
    routeState[networkId] = { activeEndpointId: endpoints[0].id, ... }
    transition → LIVE_PREFERRED

state LIVE_PREFERRED                                   # active == endpoints[0]
  on call success on active
    reset active's hard+soft counters (if 60s decay elapsed)
    stay
  on call hard-fail on active
    failures[active].hard++
    if failures[active].hard >= 2
      transition → FAILOVER(reason="hard")
    else stay
  on call soft-fail on active
    failures[active].soft++
    if failures[active].soft >= 8
      transition → FAILOVER(reason="soft")
    else stay
  on probe-mismatch on a candidate (lazy, e.g. on user re-add)
    invalidChain.add(candidate)
    stay
  on manual promoteEndpoint(id)
    persisted endpoints[] reordered, active = id, clear cooldown[id], emit "manual"
    stay (or transition → LIVE_PREFERRED if id was already preferred)

state FAILOVER(reason)
  candidates = endpoints[] starting after active, skipping cooldown + invalidChain
  for each candidate:
    probe _getChainId(candidate.rpcUrl) with 5s timeout
    on match:
      cooldownUntil[active] = now + 5min
      active = candidate.id
      replace nodes[chainId]
      emit onPrimaryEndpointChanged({ from: prevActive, to: active, source: "failover" })
      if active == endpoints[0].id: transition → LIVE_PREFERRED
      else: transition → LIVE_FALLBACK
      return
    on mismatch or timeout:
      invalidChain.add(candidate)
      continue
  # exhausted
  exhaustedAt = now
  emit onPrimaryEndpointDegraded({ exhausted: true })
  bubble original error to caller
  transition → EXHAUSTED

state LIVE_FALLBACK                                    # active != endpoints[0]
  on call success on active
    decay counters
    if cooldown[endpoints[0]] has elapsed:
      # No auto-snapback; user must explicitly recover. But after
      # one more user-driven re-promotion attempt OR clearEndpointCooldowns,
      # we go back to LIVE_PREFERRED.
    stay
  on call hard-fail / soft-fail on active
    same threshold logic → may transition → FAILOVER
  on manual promoteEndpoint(id) on the preferred endpoint
    persisted reorder, active = preferred, clear cooldown
    transition → LIVE_PREFERRED
  on clearEndpointCooldowns(networkId)
    cooldownUntil.clear(), invalidChain.clear()
    active = endpoints[0].id (probe on next call)
    transition → LIVE_PREFERRED

state EXHAUSTED
  on call (any)
    if any endpoint's cooldown elapsed OR invalidChain entry user-cleared:
      transition → FAILOVER
    else bubble error
  on clearEndpointCooldowns(networkId)
    cooldownUntil.clear(), invalidChain.clear()
    active = endpoints[0].id
    transition → LIVE_PREFERRED
```

SW restart wipes `routeState`. Re-entry starts at INITIAL → LIVE_PREFERRED.

## Phasing

Four phases, each independently shippable. Each ends with `bun run audit:vue` + unit tests green.

### Phase 1 — Routing core (network service layer)

**Goal**: in-memory route state + classifier + failover engine + caller-facing accessor.

- New file `packages/extension/src/wallet/services/network/error-classifier.ts` + test (≥12 cases per opus's spec).
- New file `packages/extension/src/wallet/services/network/route-state.ts` carrying `NetworkRouteState` + helpers (recordSuccess, recordFailure, demote, isCool, etc.).
- `spec.ts:13-37` — drop `primaryEndpointId` from `Network` + zod schema.
- `spec.ts:55-59` — `networkInfoFrom(network)` reads `endpoints[0].rpcUrl`.
- `spec.ts:65-71` — drop `ERR_PRIMARY_ENDPOINT`.
- `spec.ts:103-160` — rename `setPrimaryEndpoint` → `promoteEndpoint`; add `clearEndpointCooldowns`, `getEndpointHealth`.
- `spec.ts:211-227` — extend `onPrimaryEndpointChanged` payload with `fromEndpointId/toEndpointId/source`; add `onPrimaryEndpointDegraded`.
- `service.ts:142-145` — replace `nodes: Map<chainId, AztecNode>` with `Map<chainId, { node, endpointId, rpcUrl }>`. Add `routeState: Map<networkId, NetworkRouteState>`.
- `service.ts:192, 315, 477, 498, 545` — replace `network.endpoints.find(e => e.id === network.primaryEndpointId)` with `network.endpoints[0]`.
- `service.ts:446-463` — `setPrimaryEndpoint` → `promoteEndpoint`: splice + clear cooldown + set active.
- `service.ts:488-548` — rewrite `getNode(chainId)` to use `routeState` and try-failover semantics.
- `service.ts:519-535` — `reportEndpointFailure(url, error?: unknown)` now classifies via the new helper.
- New method: `acquireBinding(chainId): Promise<NetworkBinding>` — public service method that returns the full binding for caller pinning.
- New method: `clearEndpointCooldowns(networkId): Promise<Network>`.
- New method: `getEndpointHealth(networkId): Promise<EndpointHealthSnapshot>`.
- `client.ts:23-29` — relay extended event payload + new methods.
- `service.test.ts:150-188, 524-569` — extensions: failover happy path, probe mismatch, exhaustion, strike decay, cooldown elapse, promoteEndpoint, clearEndpointCooldowns.

**Files**: `network/{spec.ts, service.ts, service.test.ts, client.ts, error-classifier.ts, error-classifier.test.ts, route-state.ts, route-state.test.ts}`. Plus `transaction/service.ts:129-150` for the `primaryEndpointId` reference.

**Shippable outcome**: node-side live routing exists. The `transactionService` tx-poll path continues working unchanged because it uses the URL-pinned `getNodeForUrl` (unaffected by the primary-route changes).

### Phase 2 — PXE-safe rebind

**Goal**: failover-triggered URL changes rebind ChainRuntime under the per-chain write guard, without wiping chain state.

- `packages/aztec-runtime/src/pxe/chain-runtime.ts:125-156` — move the `existing.rpcUrl !== network.rpcUrl` detection out of the opportunistic registry-read into an explicit `rebind(network)` path triggered by the network service's failover event.
- `packages/aztec-runtime/src/pxe/service.ts:376-443` — invoke the rebind under the per-chain write guard, draining in-flight readers/writers first.
- `packages/aztec-runtime/src/pxe/service.ts:376-401` — `clearChainState()` STAYS untouched; documented prominently that failover MUST NOT call it.
- `pxe/chain-runtime.test.ts:56-199` — rebind-under-lock cases: old binding finishes, new binding picks up, no DB purge.
- `aztec-runtime/src/pxe/service.test.ts:96-169` — serialized rebind + no-purge cases.

**Transport wiring (codex final-pass §3 — the underspecified piece):** PxeService needs to learn when the network service has failed over. The offscreen bootstrap (`packages/extension/src/offscreen/index.ts:52-55`) and `packages/aztec-runtime/src/offscreen/entry.ts:19-32` today only inject `{ profiles, logger }`, NOT a `NetworkServiceClient`. Three options, with the plan picking (B):

  - **(A)** Inject `NetworkServiceClient` into the offscreen entry's deps, have `PxeService` subscribe to `onPrimaryEndpointChanged` directly. Cleanest dep graph but expands offscreen's service surface, which has been deliberately minimal.
  - **(B) — PICKED:** Add a new `rebindChain(chainId, newRpcUrl)` method to PXE service's RPC spec. Network service's `_failover()` calls `pxeServiceClient.rebindChain(chainId, newEndpoint.rpcUrl)` directly after replacing the live route. This keeps offscreen deps unchanged (network service is the SW-side caller, which already has `pxeServiceClient` at `service.ts:162`). The PXE side serializes the rebind under its per-chain write guard.
  - **(C)** Have PxeService poll/observe `chrome.storage` for the network record. Rejected — adds latency + indirection.

  The new RPC method `rebindChain(chainId: number, newRpcUrl: string): Promise<void>` is added to `packages/aztec-runtime/src/pxe/service.ts` + `packages/extension/src/wallet/services/pxe/client.ts`. Its implementation acquires the per-chain write guard, disposes the existing `ChainRuntime` for that chainId, and lazily lets the next `getOrInit(network)` rebuild against the new URL. The non-emit-but-call shape avoids any deadlock concern (`emit()` doesn't await listeners per `packages/extension-messaging/src/background/service.ts:104-117`, so even if we kept the event-listener shape we'd be deadlock-free — but the direct RPC call is more explicit about the ordering contract).

**Files**: `aztec-runtime/src/pxe/{chain-runtime.ts, service.ts, chain-runtime.test.ts, service.test.ts}` + `extension/src/wallet/services/pxe/chain-runtime.test.ts`.

**Shippable outcome**: PXE rebind correctness during failover. No in-flight work torn down mid-lock; no chain DB wipe.

### Phase 3 — Caller adoption

**Goal**: every L2 service-worker caller acquires one `NetworkBinding` per logical op and uses `binding.node` + `binding.info` for all reads in that op. The `submittedEndpointUrl` recorded for tx receipt polling becomes "the URL the binding resolved to," not "endpoints[0].rpcUrl."

**API change for tx submission (codex final-pass §7 item 1):** `transactionService.addTransaction()` currently recomputes `submittedEndpointUrl` from current network state at `packages/extension/src/wallet/services/transaction/service.ts:109-136`. That races failover — if the live endpoint changes between when the execution service started building the tx and when transactionService persists the record, the recorded URL would be the post-failover one, not the URL the tx was actually sent to. Phase 3 changes the API to require the caller to pass the captured URL+id explicitly: `addTransaction(tx, { submittedEndpointUrl, submittedEndpointId })`. Internal lookup is dropped. The call site at `execution/service.ts` (sendTx flow) already holds the binding; it passes `binding.endpoint.rpcUrl` + `binding.endpoint.id` directly.

**Estimate cache (codex final-pass §4):** the estimate-reuse path at `execution/service.ts:707-734` currently snapshots endpoint identity AFTER the fact from `network.primaryEndpointId` (which we're dropping anyway). Phase 3 changes `buildAndEstimateTxRequest()` to return the binding-derived endpoint identity directly: `{ tx, binding, ... }`. The estimate cache keys on `binding.endpoint.id`, not on a re-derived URL. The failover event listener at the cache layer invalidates entries whose `endpointId` no longer matches the active.

Call-site sweep (per codex's exhaustive enumeration):

- `execution/tx-request-builder.ts:101-105, 353-367, 388-390`
- `execution/service.ts:471, 616-625, 707-734, 1209, 1263, 1571-1691, 1750, 1819`
- `account-state/service.ts:44-56, 100-128, 196-217`
- `token/service.ts:275, 360, 453`
- `note/service.ts:129-189`
- `fpc/service.ts:160, 243, 345`
- `transaction/service.ts:124-150, 196-220` — also update `submittedEndpointUrl` source
- `transaction/spec.ts:121-128` — `submittedEndpointUrl` type docs

Each site: replace `await networkService.getNode(chainId)` + `await networkService.getNetwork(networkId)` with `await networkService.acquireBinding(chainId)`; use `binding.node` for the AztecNode call, `binding.info` for the NetworkInfo, `binding.endpoint.rpcUrl` for any URL recording.

Estimate-reuse invalidation: the `execution/service.ts` paths that cache estimates need to invalidate on active-endpoint change. Add a listener for `onPrimaryEndpointChanged({ source: "failover" })` that purges in-memory estimate caches for the affected chainId.

**Files**: per the list above + extension service tests covering "estimate reuse invalidates on failover."

**Shippable outcome**: failover affects real wallet reads/writes, not just the node cache. The tx-submission path remains correct: submission records the live URL at submit-time, receipt polling pins to that URL even after the live route changes.

### Phase 4 — Popup surface

**Goal**: users see when the wallet is healthy-but-on-backup, when it's exhausted, and can recover manually.

- `packages/extension/src/stores/app.store.ts:103-116` — add `routeState` reactive: subscribes to `getEndpointHealth` for the active network on profile bootstrap.
- `packages/extension/src/composables/useProfileBootstrap.ts:23-46` — hydrate route state on session restore.
- `packages/extension/src/popup/app.vue:97-127` — wire the toast on `onPrimaryEndpointChanged({ source: "failover" })`.
- `packages/extension/src/components/Header.vue:233-242, 373-392` — three-state health dot: green when `active == endpoints[0]` AND `active` is healthy; amber when `active != endpoints[0]` (Degraded — running on backup); red when `exhaustedAt` is set OR `active` is currently failing.
- `packages/extension/src/popup/pages/settings/networks/[id].vue:71-79, 186-230` — per-endpoint health indicator, "Preferred" + "Active" markers when they differ, "Retry preferred" banner button on exhaustion.
- `packages/extension/src/composables/toast.js:14-32` — re-use the existing `useToast` composable.

**`getNodeStatus` semantics (codex final-pass §7 item 2):** the existing `getNodeStatus(networkId)` at `packages/extension/src/wallet/services/network/service.ts:470-485` probes `endpoints[0]` (preferred). Under failover, preferred is down — calling that returns red, even though the wallet IS healthy on a backup. The header would never show amber, only red, defeating the new UX.

Fix: introduce `getNodeStatus(networkId)` semantics change: probe the CURRENT ACTIVE endpoint (resolved via `routeState[networkId].activeEndpointId`), not `endpoints[0]`. The amber-vs-red distinction is then a function of `(activeEndpointHealth, activeEndpointId === endpoints[0].id)`:

| active healthy? | active == preferred? | Dot |
|---|---|---|
| yes | yes | green |
| yes | no | amber (Degraded) |
| no | — | red |

The store layer derives the dot color from the snapshot returned by `getEndpointHealth(networkId)` + the live `Network` record. No additional RPC needed.

**Files**: as listed.

**Shippable outcome**: visible-but-non-blocking failover UX. User can self-recover via "Retry preferred."

## Security & adversarial considerations

### Endpoint impersonation (HIGH — primary defense is probe-on-promotion)

- **Threat**: An endpoint added at chainId X later starts impersonating chainId Y.
- **Mitigation**: `_failover` does a fresh `_getChainId(endpoint.rpcUrl)` probe on every promotion candidate (`service.ts:726-736`). Mismatch → permanent session quarantine via `invalidChain.add(endpointId)`. The endpoint is never used until SW restarts or user edits it.
- **Residual risk**: An endpoint can probe-correctly then return malicious *content* (wrong balances, wrong receipts). Same surface as single-endpoint configs.
- **Hardening**: `SECURITY.md` notes that adding an endpoint = trusting it with chain reads.

### Split-brain (two endpoints disagree on tip)

- **Threat**: Failover from A to B shifts the user's view of "latest tx."
- **Mitigation**: Per-op pinning bounds it. In-op reads come from the captured `binding.endpoint.rpcUrl`. Receipt polling pins to `submittedEndpointUrl` even after failover changes live routing.
- **Residual risk**: PXE rebuild merges block-stream from a different endpoint. PXE handles this block-by-block from checkpoints, but a malicious B feeding bad blocks can degrade decryption.
- **Out-of-scope hardening**: block-number sanity check on failover (refuse promotion if new endpoint's block is wildly off). Acknowledged for post-MVP.

### Timing oracle (privacy)

- **Threat**: An attacker controlling endpoint B observes when wallet traffic shifts to them after A degrades.
- **Mitigation**: No background pings. Probe-on-use only. Failover only happens on user-driven traffic + the candidate probe.
- **Residual risk**: Same as static config (user's IP visible to whichever endpoint serves the call). Failover doesn't widen this; if anything, it narrows the timing signal because the attacker only sees on-failover probing, not periodic pings.

### DoS / forced failover

- **Threat**: Attacker degrades user's preferred endpoint A to force traffic onto attacker-controlled backup B.
- **Mitigation**: Threshold 2 + 60s decay window resists transient blips. 5min cooldown after eviction prevents rapid flip-flopping. The "Degraded" header dot + toast + settings markers give the user a clear signal to inspect.
- **Residual risk**: If user adds a hostile endpoint to their priority list, this plan can't save them. Settings UI flags newly-added endpoints with "verify before adding" copy.

### Double-submit on retry (CRITICAL — addressed by no-replay design)

- **Threat**: User submits tx via A. A returns HTTP 500 mid-submit. If we auto-retry on B, the tx could land twice.
- **Mitigation**: **Failover NEVER replays the failing call.** The original error bubbles. The next call to `getNode(chainId)` uses the new live URL. For `sendTx` specifically, the popup surface decides whether to retry via user click; if the user clicks retry, the tx-builder regenerates against the same nonce.
- **Caveat (verify in implementation)**: If tx-builder advances the nonce eagerly (before submission acknowledgment), a manual retry would submit a *different* tx, defeating mempool de-dupe. The implementation MUST verify the nonce is taken at submission time, not at build time. If it isn't, the implementation needs a fix that's out of scope here.
- This is the **nonce-determinism caveat** opus flagged. Pinned for Phase 3 verification.

### Stale PXE state mid-failover

- **Threat**: PXE's `latestBlockNumber` is per-instance; mid-failover, the cached view could diverge from the new node's view.
- **Mitigation**: PXE rebind under per-chain write guard drains in-flight readers/writers before disposal. New ops block briefly, then run on the rebuilt PXE. Old ops complete on the old PXE instance they captured.
- **Never use `clearChainState()` on failover.** That wipes notes/senders/contracts — a chain-DB nuke. This is a critical landmine codex flagged; documented in code + plan.

### Supply chain / least-privilege / crypto

- No new external deps.
- No new chrome permissions.
- No crypto changes — failover is transport-layer.
- 7-day npm min-age in `bunfig.toml` covers transitive updates.

### Input validation

- New RPC methods (`promoteEndpoint`, `clearEndpointCooldowns`, `getEndpointHealth`) get zod schemas in `NetworkMethodSchemas` (`spec.ts:107`).
- `EndpointHealthSnapshot` (read shape) gets a zod schema for the SW↔popup wire boundary.

### Audit asks (must be in the final codex review)

> 1. Is the "no replay on failure" policy actually safer than a single retry for read paths? Walk through a concrete `getCurrentMinFees` flow.
> 2. Is the per-chain write-guard rebind actually serialized end-to-end? Trace through the lock acquisition order.
> 3. Can a user add a hostile endpoint that passes `_getChainId` probe but lies about balances? What's the residual risk and how do we surface it?
> 4. Is the `acquireBinding` accessor cleanly threaded through all 20+ caller sites in Phase 3? Any site where `binding.info` is captured at op-start but `binding.node` is consumed after the binding is stale?

## Validation gates

### Unit + component

- `error-classifier.test.ts` — ≥12 cases per failure-kind branch.
- `route-state.test.ts` — counter increment/decay, cooldown elapsed, invalidChain set, exhaustion.
- `network/service.test.ts` (extensions at `:150-188, :524-569`):
  - Failover happy path (2 hard strikes → swap + event).
  - Probe mismatch on candidate (permanent invalidChain, recurse).
  - Exhaustion (`exhaustedAt` set + degraded event).
  - Strike decay (mock clock).
  - Cooldown elapsed → eligible on next call.
  - `promoteEndpoint` reorders + clears cooldown.
  - `clearEndpointCooldowns` clears all + clears invalidChain.
  - `acquireBinding` returns the live endpoint.
- `pxe/chain-runtime.test.ts:56-199` — rebind under write guard, no clearChainState call.
- `aztec-runtime/src/pxe/service.test.ts:96-169` — serialized rebind, no purge.
- `execution/service.ts` paths — estimate-reuse invalidates on failover-driven `onPrimaryEndpointChanged`.
- Vue component tests for the new banner + Preferred/Active markers + Degraded dot (≥10 cases).

### Smoke e2e

Existing flow unchanged. Add to `tests/e2e/network/networks.test.ts:9-69`: `promoteEndpoint` from the settings UI swaps the active endpoint chip (no failover firing needed — just user-driven flow).

### Network e2e

`bun run e2e:agent` against two-endpoint configurations:

1. Configure network with two valid endpoints (add-time validation requires a working chain probe; we can't add a known-bad URL directly per `service.ts:338-346, 384-392`). Then break the first via a proxy that returns 5xx, or by killing its port mid-test. Trigger a balance read. Verify failover + event + post-failover read succeeds against the second URL.
2. Submit a tx, then break the original endpoint mid-flight. Verify receipt polling stays pinned to the original `submittedEndpointUrl` (transient eviction at 3 strikes, not 2), no auto-resubmit.
3. All endpoints unreachable (proxy returning 5xx) → exhausted banner appears, no infinite retry loop.
4. Add an endpoint whose `_getChainId` reports a different chain. Promote it manually. Verify the wallet refuses + emits the chain-mismatch event.

### Manual smoke

1. Two valid testnet endpoints (both add-time-probe-clean). Promote the second. Trigger a balance read. Verify it uses the new live URL (DevTools network tab).
2. Block the preferred via dev-tools network throttling (offline mode for the host). Trigger any read. Verify toast fires + amber dot appears + settings shows split Preferred/Active markers.
3. Click "Retry preferred" in settings. Verify the wallet snaps back to the preferred endpoint.
4. Submit a tx. Mid-flight, block the primary. Verify receipt polling continues against the original endpoint (until transient cache eviction).
5. SW restart — verify in-memory health is cleared, next call goes to preferred.

## Out of scope

- L1 / Ethereum RPC failover (bridge UI).
- Background periodic pings — user-vetoed.
- Persisted health memory across SW restarts — user-locked constraint.
- Chain-level quorum, block-height arbitration, split-brain reconciliation.
- Automatic replay/resubmission of failed or ambiguous txs.
- Endpoint discovery, trust scoring, third-party availability feeds.
- Storage migration code (pre-release destructive wipe handles it).
- Auto-add public fallback endpoints to seed networks (Alpha-Testnet, etc. stay single-endpoint seeds; users add fallbacks manually).
- Drag-to-reorder UI for endpoint priority — Phase 4 uses a single "Promote" button per row; drag-reorder is a separate UX exercise.
- `@aztec/*` package internal changes — plan is purely in `packages/extension/...` + `packages/aztec-runtime/src/pxe/...`. We consume existing PXE-registry behavior; we don't modify upstream PXE.
- Multi-profile / cross-profile health sharing — health is per-network, which is already per-profile by construction.
- Block-number sanity check on failover (catches a hostile B feeding bad blocks) — future hardening.

## Rollback plan

The work is one feature branch + squash-merge into dev. If a regression is found post-merge:

- **Routing regression** — revert the squash commit. The pre-existing `transientNodes` failover path is untouched.
- **PXE coherence regression** — most dangerous case. The Phase 2 rebind-under-write-guard change is the critical part; if PXE state corruption is observed, revert ONLY Phase 2's commits (rest of phases don't rely on it). The user would lose failover-driven PXE rebuilds but keep the routing layer.
- **Schema break** — pre-release destructive wipe runs on `STORAGE_VERSION_KEY` bump. Existing users get re-seeded. Acceptable.

## Lesson tracking

Per the protocol, log meaningful attempts at `implementations-plan/multi-rpc-failover/lessons/phase-N.md`. After 3 failures on the same step → stop and reassess.

Likely lesson categories:
- **Phase 2** — PXE write-guard ordering. The aztec-runtime locks are subtle.
- **Phase 3** — the 20-site caller sweep is the biggest grep-and-replace; mismatches between `binding.info` capture-time and `binding.node` use-time are the bug class to watch.
- **Phase 4** — the popup store hydration on profile bootstrap. App-store changes have historically broken auth flows.

## Open questions (surface to user before final approval)

Codex final-pass §5 cut my original 8 open questions down to the genuinely user-facing two. The rest are implementation calls I've made; documented inline above but not gating user approval.

1. **`primaryEndpointId` drop vs keep.** Plan v1.1 drops it (one persisted source of truth: `endpoints[0]` is implicitly preferred). Codex's first draft kept it as a separate explicit pointer. The drop is simpler; the keep is more decoupled. Codex's final pass confirmed dropping is fine if we guard "array order is authoritative" with tests + docs.
   **Recommendation: drop. Confirm.**

2. **Failback policy.** No auto-snapback when preferred recovers. The wallet stays on the backup until user clicks "Retry preferred" or selects a different endpoint. Alternative would be "snap back when preferred's cooldown elapses + probe succeeds" — feels magical but invites flapping if both endpoints are intermittently bad.
   **Recommendation: no auto-snapback. Confirm.**

### Decisions I've made (not blocking; flag if you want to change)

- Threshold: 2 hard / 8 soft failures.
- Decay window: 60s healthy traffic resets counter.
- Demote cooldown: 5min.
- `acquireBinding(chainId)` returns `{ network, endpoint, info, node }`.
- `withBinding(chainId, fn)` wrapper is the only sanctioned way to call node methods (enforces try/catch + reportEndpointFailure).
- `onPrimaryEndpointChanged` payload gets `{ fromEndpointId, toEndpointId, source }` (breaking change for any external listener — acceptable pre-release).
- Caller-sweep ships as one PR for atomicity (~20 sites, one-liners each).
- Drop the latency-based soft-fail (>10s slow) for v1 — needs a timing wrapper not currently in the codebase.
- Drop the explicit 5s probe-timeout; rely on existing `_getChainId`'s transport timeout.
