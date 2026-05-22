# Plan A (main agent) — L2 RPC auto-failover

Tier A draft #1 of 3, written in parallel with codex + opus. Consolidated plan lives at `plan.md`.

## Architecture decisions (the 8 questions)

### Q1. Failover trigger — what counts as "a failure"

| Signal | Count? | Reason |
|---|---|---|
| Network error (fetch throw) | ✓ | Genuine "endpoint down" signal |
| HTTP 5xx | ✓ | Server-side problem |
| HTTP 429 | ✓ but with cooldown | Rate-limit ≠ broken — count, but add a 30s skip window before re-trying that endpoint |
| HTTP 4xx (not 429) | ✗ | Client bug or scope violation; not endpoint health |
| `_getChainId` mismatch on use | ✓ + special event | LOUDER signal — endpoint flipped chain; emit `onEndpointChainMismatched` and skip permanently for this session |
| JSON-RPC `{error: ...}` body | ✗ | Aztec-level error (e.g. "tx invalid"); endpoint is up |

Successive successes RESET the streak counter to 0.

### Q2. Threshold N

**N = 3 consecutive failures.** Same as the existing `transientNodes` pattern (`service.ts:534`) — consistency, and the existing transient path has empirically worked since the wallet shipped.

### Q3. Eviction strategy

**Proactive swap, not eviction.** When threshold trips:
1. Evict the dead node from `nodes: Map<chainId, AztecNode>`.
2. Iterate `network.endpoints` in order, skip any with `failStreak >= 3` (or in 429-cooldown).
3. Probe the next candidate via `_getChainId` once (cheap), reject if mismatch.
4. On success, cache the new node, emit `onPrimaryEndpointChanged` (existing event), reset that endpoint's `failStreak` to 0.
5. If all endpoints fail, throw `ALL_ENDPOINTS_FAILED` — caller bubbles up to UI.

### Q4. Next-best selection

**User-ordered priority via the `endpoints[]` array.** `endpoints[0]` is the user's preferred; `endpoints[1]` is the first backup; etc. The current `primaryEndpointId` indirection is removed — see Schema below.

### Q5. Health lifecycle

**In-memory only**, per the user constraint. New private field:

```ts
// service.ts
private readonly endpointHealth = new Map<string /* endpointId */, EndpointHealth>()
type EndpointHealth = {
  failStreak: number
  lastFailedAt: number | null
  lastOkAt: number | null
  lastChainIdSeen: number | null
  cooldownUntil: number | null  // for 429 backoff
}
```

Lost on every SW restart (~30s of MV3 idle). Acceptable: on next call, the streak resets and we re-discover the bad endpoint. Trades signal-precision for zero-storage-cost.

### Q6. PXE coherence — the hardest call

**Hybrid: per-op pinning for in-flight, ChainRuntime rebuild for new ops.**

- In-flight ops (anything with a tx submitted, simulate result pending, etc.) keep their captured URL via the existing `getNodeForUrl` pattern. The transaction service already does this for receipt polling (`transaction/service.ts:205-217`).
- New ops call `getNode(chainId)` which now returns the next-healthy-endpoint node. If that's a different URL than the previously-cached one, `ChainRuntimeRegistry.bind()` will rebuild the PXE on next access — heavy but correct.
- We do NOT try to swap the underlying node inside an existing ChainRuntime. The `rpcUrl` field on `ChainRuntime` is load-bearing for cache-invalidation logic at `chain-runtime.ts:132-135` and the upstream PXE has internal state tied to the original node.

**Cost**: PXE rebuild on failover is expensive (seconds, plus losing decryption progress). Mitigation: if the next-best endpoint reports the SAME chainId AND is on the same `kind` (e.g., both testnet), the PXE state SHOULD still be conceptually valid — but the upstream `@aztec/pxe` doesn't expose a "swap node" API and tampering with internals is fragile. Accept the cost; surface a "Reconnecting…" status to the user.

### Q7. UX surface

| Event | When | UI surface |
|---|---|---|
| `onPrimaryEndpointChanged` (existing) | Failover swaps the live endpoint | Popup toast: "Switched to backup RPC: \<label\>". Re-fires the existing `chain-runtime` rebuild path. |
| `onEndpointHealthChanged({ networkId, endpointId, healthy })` (NEW) | failStreak crosses 0→failed or back | Settings page: green/yellow/red dot per endpoint. Banner on networks page if any endpoint is unhealthy. |
| `onEndpointChainMismatched({ networkId, endpointId, expectedChainId, actualChainId })` (NEW) | Hard mismatch on use | Settings page: red flag with "This endpoint is reporting the wrong chain — verify the URL." Locked out for the session. |

### Q8. Manual override

User's `endpoints[]` order IS the source of truth for preference. Failover is **transient runtime state** — it never mutates the persisted order. When the user explicitly reorders in settings (move endpoint X to position 0), that resets that endpoint's health and the next `getNode` call retries it. No auto-snap-back when a previously-failed endpoint recovers — that would cause flapping, and the user already chose the order.

## Schema changes

```diff
type NetworkEndpoint = { id: string; rpcUrl: string; label?: string }

type Network = {
  id: string
  profileId: string
  chainId: number
  name: string
- primaryEndpointId: string         // ← REMOVED
  endpoints: NetworkEndpoint[]       // now ORDER-MEANINGFUL: [0] = preferred
  kind?: ChainKind
}

type NetworkInfo = {
  profileId: string
  chainId: number
  rpcUrl: string                     // synthesised from endpoints[0] now
}
```

Pre-release destructive wipe handles the storage change.

Call-site sweep (from earlier `grep`):
- `service.ts:55-58` `networkInfoFrom(network)` → use `network.endpoints[0]`
- `service.ts:192,317,498,545` `network.endpoints.find(e => e.id === network.primaryEndpointId)` → `network.endpoints[0]`
- Drop `setPrimaryEndpoint` method; add `reorderEndpoints(networkId, ids: string[])` instead.
- `spec.ts:139` `onPrimaryEndpointChanged` event stays (re-used for failover swaps).

## Phasing

### Phase 0 — schema collapse + call-site sweep
- Remove `primaryEndpointId` from `Network` type + zod schema.
- `endpoints[0]` is the canonical primary.
- Replace `setPrimaryEndpoint(networkId, endpointId)` with `reorderEndpoints(networkId, orderedIds: string[])`.
- Sweep ~10 call sites that do `network.endpoints.find(... primaryEndpointId)`.
- Unit tests: all existing network-service tests stay green after sweep.

**Files**: `wallet/services/network/{spec.ts,service.ts,service.test.ts,client.ts}` + settings UI that exposed `setPrimaryEndpoint` (Endpoint management page).

### Phase 1 — health map + failure classification
- Add `endpointHealth: Map<endpointId, EndpointHealth>` (in-memory).
- Helpers: `recordSuccess(endpointId)`, `recordFailure(endpointId, kind: "network" | "5xx" | "429" | "chainMismatch")`.
- Classification logic for HTTP statuses + caught errors.
- Threshold const = 3, 429-cooldown const = 30000ms.
- Unit tests for the classifier + state machine.

**Files**: New `wallet/services/network/endpoint-health.ts` + test.

### Phase 2 — failover loop in `getNode(chainId)`
- Wrap the existing `getNode` body in a try-each-endpoint loop with the health filter.
- On success, cache (chainId → node) + emit `onPrimaryEndpointChanged` if the URL differs from the prior cache.
- On all-fail, throw `ALL_ENDPOINTS_FAILED`.
- The existing `getNodeForUrl` + `reportEndpointFailure` keep working as-is for per-op pinning.

**Files**: `service.ts:488-507` rewrite.

### Phase 3 — failure reporting at call sites
- Wrap every `node.<rpc method>()` call (in execution/tx-request-builder/etc.) with a try/catch that calls `reportFailure(endpointId, kind)` and rethrows.
- Existing `transaction/service.ts:217` becomes the template.

**Files**: `execution/service.ts` (many sites), `execution/tx-request-builder.ts`, `fpc/service.ts`, `note/service.ts`.

### Phase 4 — new events + UI surface
- New event types `onEndpointHealthChanged`, `onEndpointChainMismatched` in `spec.ts:Events`.
- Service emits them from Phase 1 helpers.
- Settings → Networks → endpoint list: per-row health dot, click "View details" surfaces last-failure timestamp.
- Popup: toast on `onPrimaryEndpointChanged` ("Switched to backup RPC: \<label\>") for the next 5s.

**Files**: `spec.ts:Events`, `client.ts` (relay events), `popup/pages/settings/networks/[id].vue` (settings page), `popup/components/composite/NetworkStatusToast.vue` (new) or extend an existing toast.

### Phase 5 — tests + network e2e
- Unit: failover loop (mock NodeFactory; one endpoint throws, the next succeeds; assert event emitted + health updated).
- Component: settings-page health dots render per state.
- Network e2e: new test `multi-rpc-failover.test.ts` that boots TWO anvil-aztec stacks, configures the wallet with both endpoints, kills the primary, runs a `simulate` op, verifies the wallet failed over to the backup and emitted the event.

## PXE coherence — concrete answer

**Failover triggers ChainRuntime rebuild.** The chain-runtime registry's existing `existing.rpcUrl !== network.rpcUrl` check (`chain-runtime.ts:132-135`) is correct as-is; we don't loosen it. Failover changes `network.endpoints[0].rpcUrl`'s effective value (which is what `NetworkInfo.rpcUrl` returns via `networkInfoFrom`), so the registry tears down the old PXE and builds a new one bound to the new URL. PXE state is lost (decryption progress, sync block, etc.) and re-bootstrapped from the new node. This costs a few seconds; the popup shows "Reconnecting…" during it.

In-flight operations that captured a URL at start (via `getNodeForUrl`) continue against the captured URL. The transaction service is the proof-of-concept for this pattern; the plan extends it to other long-lived ops if any exist (mostly `simulate` flows).

## Security & adversarial considerations

| Threat | Mitigation |
|---|---|
| Endpoint chainId-spoof on failover (endpoint claims to be on `chainId` X, isn't) | `_getChainId` probe on every failover swap — mismatched endpoint goes to a session-locked-out state via `onEndpointChainMismatched`, never serves traffic for the rest of the SW lifetime |
| Split-brain (two endpoints report different latest-block) | We trust one endpoint at a time. The user sees the view of whichever endpoint is currently primary. No quorum check. Acknowledged limitation. |
| DoS-forced failover (attacker degrades endpoint A to push traffic to attacker's endpoint B) | If user adds a hostile endpoint to their own list, that's a config-attack outside this plan's scope. Mitigation: settings UI shows a warning chip for newly-added endpoints that haven't completed a successful call, encouraging users to verify before adding |
| Tx re-submission on retry (sendTx lands twice if failover retries) | **sendTx is NEVER retried by failover.** Failures bubble out to the execute popup. Only READ paths and `simulate` retry. Encoded as a `retryOnFailover: boolean` flag passed to a new `withFailover(chainId, op, opts)` wrapper. |
| Timing oracle (attacker controlling one endpoint correlates user activity with the OTHER endpoint going down) | Inherent to having multiple endpoints; we accept it. Mitigated by "probe on-use only" — endpoint only sees timing tied to actual user actions, not background pings. |
| In-flight PXE state lost mid-failover | Per-op URL pinning ensures in-flight ops complete against the URL they started with. Only NEW ops see the failover. |
| Health-state poisoning across sessions | Health is in-memory only; no persistence; SW restart clears it. Constraint satisfied. |

## Validation gates

| Gate | Command |
|---|---|
| Unit + component | `bun run --cwd packages/extension test` |
| Lint | `bun run --cwd packages/extension lint` |
| Typecheck | `bun run --cwd packages/extension typecheck` |
| Build | `bun run --cwd packages/extension build` |
| Smoke e2e | `bun run --cwd packages/extension test:e2e` |
| Network e2e (new test) | `bun run e2e:agent tests/e2e/network/multi-rpc-failover.test.ts` |
| Manual smoke | Add a fake-localhost endpoint, kill it, observe failover toast + dot |

## Out-of-scope

- L1 / Ethereum RPC handling (bridge UI).
- Background periodic pings — vetoed by user.
- Storage migration code — pre-release destructive wipe handles it.
- Quorum / split-brain detection across endpoints (we trust one at a time).
- Auto-snap-back when a previously-failed endpoint recovers (would cause flapping).
- New external dependencies — must build on existing `AztecNode` + `NodeFactory` ports.
- `sendTx` failover retry — explicit non-goal (mempool replay risk).

---

**Recommended approach:** Drop `primaryEndpointId`, make `endpoints[]` priority-ordered, add an in-memory `EndpointHealth` map; `getNode(chainId)` becomes a try-each-endpoint loop with threshold=3 + chainId-verify per swap; in-flight ops keep per-op URL pinning; new failover triggers a ChainRuntime rebuild and emits `onPrimaryEndpointChanged` for the UI toast.
