# Plan B (opus subagent) — L2 RPC auto-failover

Tier A draft #2 of 3. Returned via opus subagent in parallel with main + codex. Verbatim below; consolidation lives in `plan.md`.

## 1 — Architecture decisions (the 8 questions, answered)

### Q1 — What counts as a failure?

**Classify into three buckets at the call boundary, not at the network layer.** The `AztecNode` interface (HTTP-JSON-RPC over `fetch`) gives us enough signal to distinguish, and the categorization is what makes the failover safe.

- **Fail-fast (counts as a hard failure, increments the strike counter):**
  - `fetch` reject: `TypeError`, `ECONNREFUSED`, DNS failure, TLS error, AbortError on a non-user-cancel
  - HTTP status ≥ 500 from the RPC origin
  - HTTP 429 (rate-limit; this endpoint is unusable to us right now)
  - JSON-RPC envelope error with code `-32603` (internal error), `-32000…-32099` (server defined), or any code where the error message contains `timeout`/`overloaded`/`unavailable`
  - Probe-on-promotion chainId mismatch (the candidate's `getNodeInfo()` resolves but XOR doesn't match `network.chainId`) — counts as **immediate eviction**, not just a strike
- **Don't count (transparent passthrough, no strike):**
  - JSON-RPC code `-32600`/`-32601`/`-32602` (malformed request / method not found / invalid params) — that's our bug, not theirs
  - User-initiated abort (`AbortController` cancel from the popup closing the op)
  - Any thrown error whose cause is a parse error from `@aztec/aztec.js`'s decoder of a *valid* HTTP response (semantically the endpoint replied; the wallet failed)
- **Soft signal (counts toward eviction at higher threshold, separate counter):**
  - HTTP 4xx other than 429 — likely a config error on our side; eject only after many consecutive
  - Slow response > 10s without explicit error — counts a "slow" tick; doesn't trigger failover on its own but contributes to next-best selection

The classification lives in one helper, `classifyEndpointError(err): "hard" | "soft" | "ignore" | "evict"`, in a new file `packages/extension/src/wallet/services/network/error-classifier.ts`. It's the only piece a future contributor needs to update when an Aztec node starts emitting a new error shape.

### Q2 — Threshold N

**Hard-failure threshold = 2 on the primary path.** The existing transient pool uses 3 because in-flight tx polling tolerates one or two consecutive misses while a block proposes. The primary cache has no such tolerance budget — every miss is a user waiting on a screen. 2 strikes is "the first one might be a hiccup; the second is a pattern." This is below `transientNodes`'s 3 deliberately so failover happens *before* the per-op pinned client gives up.

**Soft-failure threshold = 8.** 4x the hard threshold; effectively only fires on a sustained "this 4xx-returning endpoint is broken."

**Strike decay = 60s of no-incident traffic resets the counter to 0** (not a timer — checked lazily when the next traffic-driven update fires). Keeps an endpoint that recovered from getting permanently soured by yesterday's outage.

### Q3 — Eviction vs proactive swap

**Proactive swap.** Once the counter trips, the service:
1. Picks the next-best endpoint (Q4).
2. Probes its chainId synchronously (one `getNodeInfo()` call, 5s timeout). If mismatch → mark that endpoint failed-permanent-for-session, pick the next-next. If all candidates fail probe → emit `onPrimaryEndpointDegraded` with `{ networkId, exhausted: true }` and leave the broken node in place (user gets a banner saying "no working endpoints"). The wallet doesn't grind to a halt; the user can fix the network in settings.
3. Atomically swaps `this.nodes.set(chainId, newNode)`, captures the previous primary's id into a session-only "demoted" set, and fires `onPrimaryEndpointChanged` (existing event) plus a new `onFailoverEngaged` event.
4. Triggers a `ChainRuntime` rebuild lazily on next PXE use (see Q6).

**Why proactive and not lazy-evict-then-rebuild:** lazy eviction would force every concurrent caller to race for the lock and replay the failed call before discovering the cache is empty. Proactive swap means the second call after the failover decision goes straight to the new node. The atomicity is cheap — it's just a Map.set under the existing `this.lock`.

### Q4 — Next-best selection

**Endpoint-array order = priority order.** The user's manually-set preference is "the first endpoint that's not currently demoted." This means:

- Drop `primaryEndpointId` from the persisted schema (Q3 of context.md says to improve the schema; the user-locked answer says we can).
- `endpoints: NetworkEndpoint[]` becomes ordered. Index 0 = preferred. UI reorders via drag-handle.
- "Live URL" at runtime = first endpoint in array that's NOT in the in-memory "demoted" set for that chain.
- `setPrimaryEndpoint(id)` becomes `reorderEndpoints(networkId, ids[])` or `promoteEndpoint(networkId, endpointId)` (re-sorts so the given id is index 0). Picks the deterministic UI.

**Selection within a session:** strictly ordered. No randomization. No round-robin. Round-robin spreads load, which is fine, but it also makes it impossible for the user to reason about "where did my last tx go?" Strict order keeps the mental model simple: "my preferred endpoint is up, or it isn't; if it isn't, you're on my fallback."

**Demoted endpoints have a TTL.** A demoted endpoint becomes available again after 5 minutes of wall-clock time OR after `NetworkService.recheckPreferred(networkId)` is called from the UI (toast button "retry preferred" / settings open). The clock is in-memory only — service-worker restart wipes demotion, and the next traffic-driven call probes the user's preferred endpoint fresh.

### Q5 — Health state lifecycle

**Purely in-memory, lost on SW restart.** Per user constraint: probe on-use only, no background pings. Persisting health to `chrome.storage` would invite stale-health bugs across versions and require a migration that the user has vetoed. The session-scoped TTL (Q4) and the lazy probe-on-promotion are the recovery mechanisms.

The runtime health state lives in a new field on the service:

```
private readonly endpointHealth = new Map<string /* networkId */, EndpointHealth>()

type EndpointHealth = {
  demoted: Map<string /* endpointId */, { at: number; reason: string }>
  strikes: Map<string /* endpointId */, { hard: number; soft: number; lastIncidentAt: number }>
  exhaustedAt?: number  // set when all endpoints in the array have been demoted
}
```

Strictly transient. No storage. Reset on SW restart.

### Q6 — PXE rebuild cost — the load-bearing call

**Failover triggers a `ChainRuntime` rebuild on next PXE use.** Not on the failover event itself. The existing `ChainRuntimeRegistry.bind()` / `getOrInit()` path at `packages/aztec-runtime/src/pxe/chain-runtime.ts:129-156` already does this lazily — when the next `pxeService.getPXE(networkInfoFrom(network))` resolves with a different `rpcUrl`, the registry disposes + rebuilds. The plan is to ride that existing path: the failover-engaged event mutates `nodes` Map and the live-URL projection, and the next PXE-using call site discovers the change naturally.

**In-flight operations stay pinned to the URL they started with.** The existing per-op pinning pattern in `packages/extension/src/wallet/services/transaction/service.ts:204-217` is the precedent. The plan generalizes it: any op that *submits* a tx records the URL at submission time and uses `getNodeForUrl` for receipt polling. The plan extends this to:

- **`execution/service.ts:470,633,1262`** — currently calls `getNode(chainId)` directly. The plan moves to a "pin at start" model: when an execution flow begins (estimate, build, prove, send), it captures the URL once via the new `acquireNode(chainId): { node, url }` accessor and pins to that URL through all subsequent network calls in that operation. If any call along the way throws a hard-failure-classified error, the operation reports the failure, gets a new pinned node from the post-failover state, and either retries (for idempotent reads like `getCurrentMinFees`) or surfaces an error to the user (for non-idempotent like `sendTx` — Q7 of adversarial below).
- **PXE state coherence:** PXE rebuild *is* the right call when failover happens, because the wallet's view of "latest decrypted block" is only valid against a single node. Per-op pinning for *node* calls + PXE rebuild for *new* PXE calls. An in-flight PXE-using op (e.g. private transfer that hasn't finished `prove` yet) is bound to the ChainRuntime instance it already holds; it completes on the old PXE, then the next op gets the rebuilt one.

**Why this combination is the right answer:**
- Option (a) "tear down ChainRuntime on every failover" is correct but punishes the user for a flaky endpoint with a full PXE re-sync. Bad UX.
- Option (b) "swap the node reference inside ChainRuntime" violates the `rpcUrl` invariant that the registry guards. The invariant exists because PXE's note decryption is path-dependent on the node's block stream — swapping mid-flight could produce undecryptable notes if the new node has different recent tips. Hard NO.
- Option (c) "per-op pinning everywhere" is what we already do for tx polling. Extending it is consistent with existing code. PXE rebuild is lazy; in-flight ops finish on their bound URL; new ops get the new state.

**Concrete: PXE only rebuilds when a PXE-touching call discovers the URL changed.** This is already the existing behavior at `chain-runtime.ts:132-138`. We don't need new code there — just ensure `networkInfoFrom(network)` (`spec.ts:55`) projects the new live URL after failover.

### Q7 — User UX

**Visible but non-blocking.** A small toast on the first failover event ("Switched to fallback endpoint: <label>") that auto-dismisses in 6s, plus a persistent banner on the home view if `exhaustedAt` is set ("All endpoints for <chain> are degraded. <Retry preferred>"). No blocking modal. The reason: silent failover is appropriate for transient flakes but a non-event sets up a worse failure mode where the user thinks they're on endpoint A and is actually on B (e.g. they pasted endpoint A's block explorer URL to debug a tx — that endpoint is wrong).

The events emitted:

- `onPrimaryEndpointChanged({ networkId, endpointId })` — **fired**. UI already listens for this; reuse it for the visual swap of the endpoint indicator.
- `onFailoverEngaged({ networkId, from: endpointId, to: endpointId, reason: string })` — **new event.** Specifically for the toast. Separate from `onPrimaryEndpointChanged` because that event also fires on user-driven `promoteEndpoint`, and we don't want a "switched to fallback" toast when the user explicitly switched.
- `onPrimaryEndpointDegraded({ networkId, exhausted: boolean })` — **new event.** Fires when all endpoints in the array are demoted. UI surfaces the banner.
- `onEndpointHealthRestored({ networkId, endpointId })` — **new event.** Fires when a demoted endpoint passes a probe-on-use. Lets the UI dismiss the banner without polling.

### Q8 — Manual override semantics

**Promotion is a hint, not a pin.** When the user calls `promoteEndpoint(networkId, endpointId)` (the renamed setter), the endpoint is moved to index 0 of the array AND its demoted-state is cleared. The wallet immediately probes the promoted endpoint on the next traffic-driven call. If the probe fails, failover re-fires and the next call goes to the next-best. If the promoted endpoint stays healthy, it remains the live one.

**The "preferred" concept stays implicit in the array order.** No `preferredEndpointId` field. The user's preference IS the order. If they want endpoint X to be the snap-back target, they put it first. After a failover, the array order is unchanged in storage — only the in-memory demoted set tracks who's currently being skipped. The next SW restart picks the user-preferred endpoint again, because demotion is in-memory.

**This means: failover does NOT mutate persisted state.** Only the in-memory `endpointHealth` map. The user's stored preference is untouched. Reload SW → preferred endpoint is back. This is the right behavior — failover is operational, not preferential.

---

## 2 — Phasing (ordered, each independently shippable)

### Phase 1 — Schema redesign + helper accessors (1 PR, no behavior change)

- **`packages/extension/src/wallet/services/network/spec.ts:13-37`** — restructure types:
  - Keep `NetworkEndpoint`; add nothing new to the persisted shape.
  - Drop `primaryEndpointId` from `Network`. The "primary" is implicit = `endpoints[0]`.
  - Update `NetworkSchema` zod definition (`spec.ts:83-91`) to remove the field.
  - Update `networkInfoFrom(network)` at `spec.ts:55-59` to read `endpoints[0]` (with a defensive throw if empty — invariant already enforced by `endpoints.min(1)`).
- **`packages/extension/src/wallet/services/network/service.ts`**:
  - Replace every `network.endpoints.find((e) => e.id === network.primaryEndpointId)` with `network.endpoints[0]`. Call sites: `service.ts:192, 315, 477, 498, 545`.
  - Rename `setPrimaryEndpoint` → `promoteEndpoint(networkId, endpointId)`. Internal behavior: splice the endpoint out and unshift to index 0. Storage write + emit `onPrimaryEndpointChanged` + `onNetworkUpdated` (preserved).
  - Update RPC schema in `spec.ts:152-155`: same method name, same params, semantics shift documented in the TSDoc.
- **`packages/extension/src/wallet/services/transaction/service.ts:129-136`** — replace the `network.endpoints.find` lookup with `network?.endpoints[0]?.rpcUrl`.
- **Storage migration**: none. `storage/migrate.ts:5` bumps the version constant; existing pre-release storage is wiped. Tests covered by an integration test that proves a fresh install seeds correctly with the new schema.
- **UI**: `packages/extension/src/popup/components/...` — every place that reads `primaryEndpointId` needs to switch to "the first endpoint." Grep target: `primaryEndpointId` (UI side only).
- **Validation gates:** `bun run audit:vue` + new unit test in `network/service.test.ts` confirming `getNetworkInfo` returns `endpoints[0]`'s URL after `promoteEndpoint` reorders.

### Phase 2 — Error classifier + failure plumbing through `AztecNode` calls

- **New file** `packages/extension/src/wallet/services/network/error-classifier.ts` — exports `classifyEndpointError(err: unknown): { kind: "hard" | "soft" | "ignore" | "evict"; reason: string }`. Uses string-matching on error messages + duck-typing on JSON-RPC envelope shape. Companion test file `error-classifier.test.ts` with ≥12 cases covering each branch (the codex audit will catch missing variants).
- **`service.ts:142-145`** — replace `nodes: Map<number, AztecNode>` with `nodes: Map<number, { node: AztecNode; endpointId: string; rpcUrl: string }>`. The triple lets failover know what to demote.
- **`service.ts:530-535`** — `reportEndpointFailure(url)` becomes `reportEndpointFailure(url, error: unknown): void`. Internally calls the classifier, decides hard/soft/evict, updates strikes in `endpointHealth`, and if threshold trips, calls the new private `_failover(networkId)`. Backwards-compat: existing callers in `transaction/service.ts:217` pass the error through; the no-error overload remains for the legacy in-flight pinning path (treats it as one hard strike).
- **No failover logic engaged yet** — this phase just wires the classifier and counter. `_failover` is a stub that no-ops until phase 3.
- **Validation gates:** `bun run audit:vue`, unit tests on the classifier, no behavior change in e2e.

### Phase 3 — `_failover` and demoted set + event emission

- **`service.ts`** — implement `_failover(networkId)`:
  - Under `this.lock`, read the current `Network`, look up `endpointHealth.get(networkId)`, walk the endpoints array picking the first non-demoted one, probe its chainId via `_getChainId(endpoint.rpcUrl)` with a 5s `AbortController` timeout.
  - On probe success: build a new node via `nodeFactory.createNode(endpoint.rpcUrl)`, replace `nodes.get(network.chainId)`, add the old endpoint to demoted, emit `onFailoverEngaged` + `onPrimaryEndpointChanged`.
  - On probe failure: mark that endpoint as failed-this-session-permanently (different from time-decayed demotion), loop to the next.
  - If exhausted: set `exhaustedAt`, emit `onPrimaryEndpointDegraded({ exhausted: true })`, leave the bad node in place.
- **`spec.ts:211-227`** — add the three new events:
  - `onFailoverEngaged: { networkId; from: string; to: string; reason: string }`
  - `onPrimaryEndpointDegraded: { networkId; exhausted: boolean }`
  - `onEndpointHealthRestored: { networkId; endpointId: string }`
- **`service.ts:138-140`** — declare the matching `EventHandler` fields.
- **`service.ts:488-507`** — `getNode(chainId)` becomes the recovery point: on entry, check if any demoted endpoint's TTL has passed; if the array's index-0 endpoint is now eligible again and the current cached node is NOT it, evict and emit `onEndpointHealthRestored`. Then the next call rebuilds against the recovered preference.
- **Validation gates:** add `service.test.ts` cases covering: single endpoint (no failover possible, exhausted fires), two endpoints (failover succeeds), all endpoints fail probe (exhausted fires), demoted endpoint restored after TTL.

### Phase 4 — Wire failure reporting into all non-tx `getNode` consumers

- **`execution/service.ts:470,633,1262`** — wrap each `getNode(chainId)` call with a try/catch that, on hard error from the node, calls `networkService.reportEndpointFailure(rpcUrl, error)`, awaits `getNode` again (which now returns the post-failover node), and retries the operation ONCE. Retry-once is critical: it bounds the latency penalty.
- **`execution/tx-request-builder.ts:103, 389`** — same pattern.
- **Read-only operations** (`getCurrentMinFees`, `getNodeInfo`, `getBlockNumber`, etc.) — safe to auto-retry once.
- **Write operations** (`sendTx`) — DO NOT auto-retry across failover. Pin to URL at submission per the existing pattern; on failure, surface the error to the user. Re-submission risks double-mempool (see adversarial §7).
- **New helper** `service.ts` — `acquireNode(chainId): Promise<{ node: AztecNode; rpcUrl: string; endpointId: string }>` exposes the pin metadata for callers that need to record the URL for later receipt polling. The transaction service migrates from inlining `network.endpoints[0]?.rpcUrl` at `transaction/service.ts:133` to using `acquireNode` — single source of truth for "which URL did this op start on?"

### Phase 5 — UI surface (toast + banner + manual override semantics)

- **`packages/extension/src/popup/components/...`** — listen for the new events:
  - `onFailoverEngaged` → toast with the existing `useToast` composable.
  - `onPrimaryEndpointDegraded` (with `exhausted: true`) → persistent banner on the home view; banner has a "Retry preferred" button that calls a new RPC `networkService.recheckPreferred(networkId)` which clears the demoted set and triggers a probe on next traffic.
  - `onEndpointHealthRestored` → silently dismiss the banner if it's showing.
- **Settings UI** — per-endpoint health indicator. Read from a new `getEndpointHealth(networkId): EndpointHealth` accessor (returns the snapshot). The indicator is a dot: green / yellow (demoted-but-eligible-for-retry) / red (demoted-and-probe-failed).
- **Drag-to-reorder** — the existing endpoint list UI gets a drag handle. Calls `promoteEndpoint` with the new index-0 id. (Alternative: keep "promote" as a single-button "Make primary" action — less disruptive if drag-and-drop is too much.) Pick: single button. Drag-reorder is a separate visual concern.

### Phase 6 — Telemetry hooks (post-MVP, optional)

- Counter export via the existing logger: log `failover_engaged` and `failover_exhausted` at WARN level. No external telemetry — just structured log lines for users to share if they file bugs. Probably nothing to ship as a separate phase; ride the phase-3 PR with the events.

---

## 3 — Schema changes (concrete)

### Persisted shape (delta from `spec.ts:13-37`)

```
NetworkEndpoint   { id, rpcUrl, label? }                              # unchanged
Network           { id, profileId, chainId, name, endpoints[], kind } # primaryEndpointId DROPPED
NetworkInfo       { profileId, chainId, rpcUrl }                      # unchanged shape; derivation changed
```

Derivation:
- `networkInfoFrom(network)` at `spec.ts:55-59` projects `endpoints[0].rpcUrl`.
- "Add endpoint" appends to the array (index N). To make the new endpoint primary, the user explicitly calls `promoteEndpoint`.
- `deleteEndpoint` at `service.ts:447` no longer needs `ERR_PRIMARY_ENDPOINT` (`spec.ts:69`) — the array always has ≥1 endpoint, deleting the only one is still blocked by `ERR_LAST_ENDPOINT`. Drop `ERR_PRIMARY_ENDPOINT` entirely.

### In-memory shape (new)

In `service.ts` after line 145:

```
private readonly endpointHealth = new Map<string /* networkId */, EndpointHealth>()

type EndpointHealth = {
  demoted: Map<string /* endpointId */, { at: number; permanent: boolean; reason: string }>
  strikes: Map<string /* endpointId */, { hard: number; soft: number; lastIncidentAt: number }>
  exhaustedAt?: number
}
```

The `nodes` Map (`service.ts:143`) becomes `Map<number, { node: AztecNode; endpointId: string; rpcUrl: string }>` to carry pin metadata.

### RPC method changes (`spec.ts:107-160` `NetworkMethodSchemas`)

- `setPrimaryEndpoint` → `promoteEndpoint` (same shape, renamed for clarity)
- `addEndpoint`, `updateEndpoint`, `deleteEndpoint` — unchanged
- **New**: `getEndpointHealth(networkId) -> EndpointHealth` (read-only snapshot; serializable variant of the map, just plain object)
- **New**: `recheckPreferred(networkId) -> void` (clears demoted set, triggers probe on next traffic)

### Error code changes (`spec.ts:65-71`)

- Drop `ERR_PRIMARY_ENDPOINT` (no longer reachable).
- Keep `ERR_LAST_ENDPOINT`, `ERR_DUPLICATE_CHAIN`, `ERR_DUPLICATE_ENDPOINT`, `ERR_ENDPOINT_CHAIN_MISMATCH`, `ERR_ACTIVE_NETWORK`, `ERR_BACKUP_TOO_OLD`.

---

## 4 — Failover state machine (one diagram, in prose)

```
state: ARRAY_HEAD     # endpoints[0] is the live URL, no demoted entries
  on traffic_success    -> ARRAY_HEAD (strikes counter decays after 60s)
  on traffic_hard_fail  -> increment endpoints[0].strikes.hard
                            if hard >= 2 -> failover(reason="hard")
  on traffic_soft_fail  -> increment endpoints[0].strikes.soft
                            if soft >= 8 -> failover(reason="soft")
  on probe_mismatch     -> demote endpoints[0] permanent, failover(reason="chainId")

state: failover()
  pick next non-demoted endpoints[i] in order
  probe chainId with 5s timeout
    -> match: replace nodes[chainId], demote previous, emit onFailoverEngaged + onPrimaryEndpointChanged, go to FALLBACK_ACTIVE
    -> mismatch or timeout: mark endpoints[i] demoted-permanent, recurse
    -> exhaust: set exhaustedAt, emit onPrimaryEndpointDegraded({exhausted:true}), stay on the broken endpoint

state: FALLBACK_ACTIVE  # nodes[chainId] is endpoints[k>0]
  on traffic_success on endpoints[k]    -> stay (no auto-snap-back without recheckPreferred)
  on traffic_hard_fail on endpoints[k]  -> increment endpoints[k].strikes.hard
                                            if hard >= 2 -> failover(reason="hard")
  on getNode() called with demoted[0].at + TTL elapsed  -> emit onEndpointHealthRestored, go back to ARRAY_HEAD
  on recheckPreferred(networkId) (UI)   -> clear demoted, emit onEndpointHealthRestored, go to ARRAY_HEAD

state: EXHAUSTED
  on recheckPreferred                   -> clear demoted, go to ARRAY_HEAD
  on TTL elapse on the most-recent demotion -> go to FALLBACK_ACTIVE or ARRAY_HEAD as appropriate
```

The state isn't persisted; SW restart resets to ARRAY_HEAD.

---

## 5 — PXE coherence (the resolved hard call)

Restating because this is the most consequential decision: **per-op pinning for node calls, lazy registry rebuild for PXE.**

- **Node calls** — every operation that touches `getNode` captures the URL once at start (via `acquireNode`) and pins all subsequent network reads in that op to the same URL via `getNodeForUrl`. Failover that occurs mid-op affects the *next* op, not this one.
- **PXE calls** — the existing `ChainRuntimeRegistry.getOrInit(network)` at `chain-runtime.ts:129-156` already rebuilds when `existing.rpcUrl !== network.rpcUrl`. Failover updates `networkInfoFrom(network)` (returns the new live URL), and the next PXE-using op naturally triggers the rebuild. In-flight PXE ops complete on their bound ChainRuntime instance (they hold the reference).
- **Why this is safe**: PXE rebuild is expensive but rare (only on actual failover, not on every node call). In-flight ops finish their bound work. The only window of incoherence is "did the new node ingest the tx the old node accepted?" — and that's an L2 sequencer-side question that no client-side strategy can solve. The wallet's job is to keep the *user's view* consistent: the pinned tx polling does that for receipts, and the PXE rebuild does that for future sync.

---

## 6 — UX surface (consolidated)

| Event | Trigger | UI response |
|---|---|---|
| `onFailoverEngaged` | Auto-failover swapped the live URL | Toast: "Switched to <new endpoint label> for <chain name>", 6s |
| `onPrimaryEndpointChanged` (existing) | Either user-driven `promoteEndpoint` OR failover | Update the endpoint chip in the header |
| `onPrimaryEndpointDegraded` (exhausted) | All endpoints have failed probe | Persistent banner with "Retry preferred" button |
| `onEndpointHealthRestored` | Demoted endpoint passed a fresh probe | Dismiss banner if shown, optional toast (no, too noisy — silent) |

**Manual override semantics**: `promoteEndpoint(networkId, endpointId)` reorders to put the endpoint at index 0, clears its demoted entry. The next traffic call probes the new index 0. If it fails, failover re-fires. If healthy, it sticks. This means "the user's preferred endpoint is whatever they last promoted, and we always try it first."

**Cross-restart behavior**: SW restart wipes `endpointHealth`. Next traffic call uses `endpoints[0]` (the user-preferred one). This is correct behavior: failover state is operational, not preferential.

---

## 7 — Security & adversarial considerations (required)

### Endpoint impersonation (probe-on-promotion is the only line of defense)

- **Threat**: A malicious endpoint URL was added to the user's network (e.g., via copy-paste from a phishing site). It correctly reports the network's chainId on add-time (`_getChainId` at `service.ts:240`), then later starts impersonating a different chain.
- **Mitigation**: `_failover` does a fresh `_getChainId` probe (`service.ts:726-737`) on every promotion candidate. The probe XORs `l1ChainId ^ rollupVersion`; on mismatch, the endpoint is permanently demoted for the session and the next candidate is tried. The probe-on-use is the user-locked constraint; this design honors it.
- **Residual risk**: An endpoint can probe-correctly then return malicious *content* (wrong balances, wrong tx receipts). This is the same threat surface as a single-endpoint configuration; failover doesn't make it worse, but it does mean a degraded primary can force traffic onto an attacker-controlled fallback (see "DoS forced failover" below).
- **Hardening**: Document in `SECURITY.md` that adding an endpoint is equivalent to trusting it with the wallet's view of the chain. Encourage users to add endpoints they own or trust.

### Split-brain (two endpoints disagree on chain state)

- **Threat**: Endpoint A's block 100 and Endpoint B's block 100 are different (forked, behind, or one is lying). Failover from A to B mid-session means the user's "latest tx" view shifts.
- **Mitigation**: The per-op pinning bounds this. Within a single tx op, all reads come from the same URL. Across ops, the user observes the new URL's view, which is correct for the new op even if it differs from the prior one. The receipt-polling pin (existing) means the *outcome* of a submitted tx is always read from the URL that accepted it.
- **Residual risk**: PXE rebuild on failover means notes decrypted on URL A's block-stream are now being merged with URL B's. PXE's design handles this (block-by-block sync from a checkpoint), but a malicious B that lies about blocks could feed bad data.
- **Hardening**: Phase 6 addition (post-MVP) — sanity-check that the new endpoint's block-number is within some window of the previous endpoint's last-seen block. If wildly off, refuse to promote and surface a "suspicious endpoint" warning. Not in scope for the initial ship but called out for follow-up.

### Timing oracle (privacy)

- **Threat**: An attacker controls endpoint B. They observe the moment the user's wallet starts hitting them as a failover from endpoint A. By correlating the timing with public mempool events on A (an outage they caused, or even just A's public traffic dropping), they can fingerprint which user just switched.
- **Mitigation**: The per-op pinning means in-flight txs complete on the original endpoint, not the failover target. The "switch event" the attacker sees is "next op, this user came to me" — which is the same information they'd get on a normal session start. No new oracle.
- **Residual risk**: If the user makes back-to-back ops, the attacker sees the gap pattern; combined with knowledge of A's outage windows, they can probabilistically link ops. Same threat as static endpoint config; failover doesn't worsen.
- **Hardening**: Document that the wallet's privacy model is "trust each configured endpoint with all your txs against that chain." No counter-mitigation needed in this plan.

### DoS / forced-failover (attacker degrades A to force traffic to B)

- **Threat**: Attacker controls endpoint B. They can degrade endpoint A (e.g., DDoS A; or A is a public RPC and they spam it from elsewhere). After the threshold trips, the wallet routes everything to B. Attacker now has full visibility into the user's tx traffic.
- **Mitigation**:
  - Threshold 2 is low enough to be reactive but high enough that one flake doesn't trigger. Combined with the 60s strike decay, transient hiccups don't burn an endpoint.
  - User-driven `recheckPreferred` lets them snap back at any time.
  - The proactive probe on the candidate means the wallet doesn't blindly trust the next endpoint — at least it has the correct chainId.
- **Residual risk**: If an attacker has access to degrade A AND they control B, the failover lands exactly where they want. The wallet has no signal to detect this.
- **Hardening**: The persistent banner on `exhausted` and the visible toast on `onFailoverEngaged` give the user a signal to inspect. They CAN see "I'm now on endpoint B" and react. This is why the UX is visible, not silent (Q7 decision).
- **Future hardening (out of scope)**: cross-endpoint consensus (require 2 of 3 endpoints to agree on the latest block before promoting one). Explicit out-of-scope per context.md "Multi-chain quorum / split-brain detection."

### Stale-state on retry (double-mempool)

- **Threat**: User submits tx via endpoint A. A returns HTTP 500 mid-submit. Wallet fails over to B and retries the submit. Both A and B accept the tx; user pays gas twice (or one tx reverts, both sit in pending forever).
- **Mitigation**: **DO NOT auto-retry write operations across failover.** The plan is explicit in phase 4: `sendTx` failures surface to the user; read operations (`getCurrentMinFees`, `getBlockNumber`, etc.) retry once. The transaction service's existing flow already records the URL at submission and polls receipts from there.
- **Residual risk**: If endpoint A *did* accept the tx but the response failed to reach the wallet (network blip on the response leg), the wallet shows the user "tx submission failed" and the tx is in A's mempool unknown to the wallet. The user might retry manually, double-submitting.
- **Hardening**: The wallet's existing OperationJournal (`packages/extension/src/wallet/services/journal/`) records the op state; the in-progress tx-builder result is reproducible from the same nonce + accounts, so a re-submit would generate the *same* tx hash (deterministic). Same hash → not double-submitted (mempool de-dupe). Confirm this by reading `tx-request-builder.ts` and noting in the plan that nonce determinism makes the retry safe. **VERIFY this in implementation** — if it turns out nonces are advanced eagerly, the threat is real and we'd need a separate fix (out of scope).

### Supply-chain / dep policy

- **No new external deps.** The plan uses only `AztecNode`, `NodeFactory`, existing types from `@aztec/aztec.js` (already a dep). No new packages added.
- **7-day npm min-age** in `bunfig.toml` already covers any incidental transitive updates.

### Least privilege

- **No new permissions.** The failover state machine is in-memory + uses the existing `chrome.storage.local` for the network schema. No new chrome.* surface.

### Cryptography

- **No new crypto.** Failover is at the transport layer; nothing about keys or signatures changes.

### Input validation

- The new `recheckPreferred(networkId)` RPC method needs zod validation in `NetworkMethodSchemas` (`spec.ts:107`). Same pattern as existing methods.
- The new `EndpointHealth` shape returned by `getEndpointHealth` needs a zod schema for the wire boundary — even though it's read-only, the SW↔popup boundary validates both directions.

### Prompt injection / LLM surface

- N/A. No LLM-driven flow touches the network service.

---

## 8 — Validation gates

### Unit tests (`bun run test`)

- `error-classifier.test.ts` (new) — ≥12 cases covering each branch of `classifyEndpointError`: fetch reject, HTTP 500, HTTP 429, HTTP 400, JSON-RPC error codes -32600/-32601/-32603, slow response, AbortError, parse error.
- `service.test.ts` extensions in `packages/extension/src/wallet/services/network/`:
  - Failover happy path: 2 hard strikes → failover engaged, new node used.
  - Probe mismatch: failover candidate reports wrong chainId → permanently demoted, next candidate tried.
  - Exhaustion: all endpoints fail probe → `onPrimaryEndpointDegraded({ exhausted: true })` fires.
  - Strike decay: 1 strike + 61s of healthy traffic → counter reset (mock the clock).
  - Demoted endpoint TTL: 5min wall-clock → eligible for retry on next `getNode`.
  - `recheckPreferred`: clears demoted set, next call probes preferred.
  - `promoteEndpoint`: reorders array, clears the endpoint's demoted entry, next call uses it.
- Schema change tests: confirm a freshly-seeded `Network` has no `primaryEndpointId` field; `networkInfoFrom(network)` returns `endpoints[0].rpcUrl`.

### Component tests (Vitest, ≥10 cases for new composites)

- Banner component for `onPrimaryEndpointDegraded` — render, button click triggers `recheckPreferred`.
- Endpoint health dot component — green/yellow/red state from props.
- Settings page reorder UI (if shipped) — promote button moves endpoint to index 0.

### Smoke e2e (`bun run test:e2e`)

- Existing smoke flow unchanged; new test: configure a network with two endpoints, manually `promoteEndpoint` the second, verify the active endpoint switches in the UI. (Doesn't test failover triggering — that needs a flaky endpoint, which smoke doesn't have.)

### Network e2e (`bun run e2e:agent`)

The wallet's `Run / Aztec agent` CI job orchestrates aztec sandbox + anvil + playground. The plan adds:

- A new e2e fixture that spins up TWO aztec sandboxes on different ports for the same chain (or uses a port-blocker to simulate endpoint A going down).
- Test: configure network with both URLs, perform a tx, mid-tx kill the primary endpoint's port; verify the receipt eventually arrives via the failover, no toast about user-action-required.
- Test: configure network with both URLs, the second URL points to a different chainId (simulate misconfig); verify failover probe rejects it and exhaustion banner appears.

If two-sandbox setup is too expensive, fall back to a unit-test-level integration using a mock `NodeFactory` that simulates flaky endpoints.

### Manual smoke

- Configure a real testnet endpoint + a known-bad URL (e.g., `https://127.0.0.1:9999`). Promote the known-bad URL. Trigger any tx. Verify toast fires, failover lands on the testnet URL, balance updates correctly.
- Repeat with two real testnet endpoints (Alpha-Testnet and a public one); manually rate-limit one via dev-tools network throttling.

---

## 9 — Out of scope (explicit)

- **L1 / Ethereum side RPC failover.** Bridge UI's RPC handling stays as-is.
- **Background pinging.** Probe-on-use only, per user constraint.
- **Schema migration code.** Pre-release destructive wipe handles it.
- **Cross-endpoint consensus / quorum.** Single-endpoint trust per call. Future work, see "Split-brain" mitigation above.
- **Block-number sanity check on failover.** Mentioned as Phase 6 follow-up; not initial ship.
- **Telemetry export.** Just structured logs; no external sink.
- **Auto-add public fallback endpoints to seed networks.** The seeds (`packages/extension/src/wallet/services/network/seeds.ts`-equivalent area) keep their current single-endpoint seed. Users add fallbacks manually.
- **Drag-to-reorder UI.** Phase 5 picks a single "Make primary" button; reorder gesture is a separate UX exercise.
- **`@aztec/*` package changes.** Nothing in the runtime/SDK changes. Plan is purely in `packages/extension/...` and consumes existing PXE-registry behavior in `packages/aztec-runtime/...` without modifying it.
- **Persisting failover state.** Health is in-memory only. SW restart resets.
- **Mid-op retry of write operations.** `sendTx` failures surface to the user; no auto-retry.
- **Multi-profile / cross-profile health sharing.** Health is per-network (per-profile already by construction).

---

**Recommended approach: Drop `primaryEndpointId` in favor of array-order-is-priority, generalize the existing `transientNodes` failure-counter + per-op URL-pinning pattern to the primary `getNode` cache, run a chainId probe on every failover candidate, let PXE rebuild lazily via the existing `ChainRuntimeRegistry.getOrInit` path, and surface failover events through a visible-but-non-blocking toast + exhausted-state banner.**
