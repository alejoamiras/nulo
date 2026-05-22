**Tier A Plan**

**Architecture Decisions**
1. **Failover trigger.** Count only endpoint-health failures on the **current live endpoint**: transport rejection, timeout, non-2xx, invalid JSON/body, and on-use chain-id mismatch during promotion. Do **not** count business-level failures like revert, dropped tx status, missing contract, or ambiguous submit failures. The production node path already retries/backoffs inside `makeFetchWithTimeout()`, so a counted failure is post-retry evidence, not a single blip (`packages/aztec-runtime/src/utils/fetch.ts:34-97`, `packages/extension/src/wallet/services/network/service.ts:726-736`, `packages/extension/src/wallet/services/transaction/service.ts:196-220`).

2. **Threshold N.** Use **2 consecutive logical-operation failures** for the live route. Keep the existing **3-failure eviction** only for the URL-pinned transient tx-poll cache. `3` is too slow for the live route because each logical failure already includes transport retries; `1` is too hair-trigger (`packages/aztec-runtime/src/utils/fetch.ts:80-97`, `packages/extension/src/wallet/services/network/service.ts:519-535`).

3. **Eviction vs proactive swap.** Do a **proactive live-route swap** when threshold trips: update routing state, evict the chain’s cached node, emit an event, and let the **next** call use the backup. Do **not** generically replay the failing call. That avoids double-submit risk while still making polling loops and subsequent user traffic recover immediately (`packages/extension/src/wallet/services/network/service.ts:142-145`, `packages/extension/src/wallet/services/network/service.ts:488-548`, `packages/extension/src/wallet/services/network/service.ts:519-535`).

4. **Next-best selection.** Use persisted `endpoints[]` order as priority order. Scan forward from the current live endpoint, skip quarantined endpoints, wrap once, and stop at the first candidate that passes an on-use chain check. No randomization, no round-robin, no eager failback. Manual override rewrites the preferred endpoint and resets routing state (`packages/extension/src/wallet/services/network/spec.ts:22-59`, `packages/extension/src/wallet/services/network/service.ts:328-463`).

5. **Health lifecycle.** Keep health entirely **in memory** in the SW: `activeEndpointId`, consecutive-failure counters, a `cooldownUntil` for recently failed endpoints, and a session-long `invalidChain` quarantine. Clear it with the existing profile/cache resets (`packages/extension/src/wallet/services/network/service.ts:649-679`).

6. **PXE coherence.** Failover affects **new operations only**. Each operation acquires one endpoint binding and stays pinned to it. PXE **must** rebuild on URL change; do **not** hot-swap `runtime.node`. Rebind under the PXE per-chain write lock so old readers/writers drain before disposal. Do **not** call `clearChainState()` on failover because that deletes the chain DB (`packages/aztec-runtime/src/pxe/chain-runtime.ts:33-39`, `packages/aztec-runtime/src/pxe/chain-runtime.ts:125-156`, `packages/aztec-runtime/src/pxe/service.ts:376-443`, `packages/extension/src/wallet/services/network/service.ts:552-589`).

7. **User UX.** Make failover visible but non-blocking. Extend `onPrimaryEndpointChanged` payload to include `{ fromEndpointId, toEndpointId, source }`, use a toast for `source: "failover"`, and add an amber `Degraded` header status when live != preferred. On the networks page, show which endpoint is preferred vs currently active (`packages/extension/src/wallet/services/network/spec.ts:211-226`, `packages/extension/src/wallet/services/network/client.ts:23-29`, `packages/extension/src/stores/app.store.ts:103-116`, `packages/extension/src/components/Header.vue:233-242`, `packages/extension/src/components/Header.vue:373-392`, `packages/extension/src/popup/pages/settings/networks/[id].vue:71-79`, `packages/extension/src/popup/pages/settings/networks/[id].vue:186-230`, `packages/extension/src/composables/toast.js:14-32`).

8. **Manual override.** Manual override is **sticky preference**; auto-failover never rewrites it. After failover, the wallet stays on the backup until that backup fails, the user explicitly selects another endpoint, or the SW restarts and loses in-memory health. Selecting an endpoint manually immediately makes it preferred and live, clears its failure history, and emits `source: "manual"` (`packages/extension/src/wallet/services/network/service.ts:446-463`, `packages/extension/src/wallet/services/network/service.ts:649-657`).

**Schema Changes**
- `NetworkEndpoint`: no persisted health fields. Keep `id`, `rpcUrl`, `label?` (`packages/extension/src/wallet/services/network/spec.ts:13-20`).
- `Network`: keep the persisted shape simple; **do not** store live health in `chrome.storage.local`. Change the contract so `primaryEndpointId` is the **user-preferred** endpoint and `endpoints[]` is the **fallback priority list** (`packages/extension/src/wallet/services/network/spec.ts:22-37`).
- Add new **ephemeral** service-layer types, not persisted rows:
  - `NetworkBinding` for SW-internal operation pinning: `{ network, endpoint, info, node }`.
  - `NetworkRouteState` for popup reads: `{ networkId, preferredEndpointId, activeEndpointId, isFailedOver }`.
- Keep `NetworkInfo` as `{ profileId, chainId, rpcUrl }`; the change is how it is resolved, not its shape (`packages/extension/src/wallet/services/network/spec.ts:44-59`).

**Phases**
1. **Routing core.** Add per-network live-route state, convert the primary node cache from `Map<number, AztecNode>` to entries that carry endpoint identity + failure state, preserve the URL-pinned transient cache, and extend the endpoint-change event payload (`packages/extension/src/wallet/services/network/spec.ts:13-59`, `packages/extension/src/wallet/services/network/spec.ts:103-160`, `packages/extension/src/wallet/services/network/spec.ts:211-226`, `packages/extension/src/wallet/services/network/service.ts:135-145`, `packages/extension/src/wallet/services/network/service.ts:305-318`, `packages/extension/src/wallet/services/network/service.ts:328-548`, `packages/extension/src/wallet/services/network/service.ts:649-755`, `packages/extension/src/wallet/services/network/client.ts:23-29`, `packages/extension/src/wallet/services/network/service.test.ts:150-188`, `packages/extension/src/wallet/services/network/service.test.ts:524-569`).  
   Shippable outcome: node-side live routing exists, tx-polling path can fail over, event contract is in place.

2. **PXE-safe rebind.** Move rpcUrl mismatch handling out of opportunistic registry reads and into a serialized rebind path under the per-chain write guard. Keep the same IndexedDB; never purge it on failover (`packages/aztec-runtime/src/pxe/chain-runtime.ts:125-156`, `packages/aztec-runtime/src/pxe/service.ts:405-443`, `packages/aztec-runtime/src/pxe/service.ts:376-401`, `packages/extension/src/wallet/services/pxe/chain-runtime.test.ts:56-199`, `packages/aztec-runtime/src/pxe/service.test.ts:96-169`).  
   Shippable outcome: live-route changes are PXE-correct and do not tear down in-flight work mid-lock.

3. **Caller adoption.** Migrate L2 service-worker callers to acquire one binding per logical op and use its `node` + `NetworkInfo` together. Update tx-submission bookkeeping and estimate-reuse snapshots to record the **live** endpoint, not the preferred one (`packages/extension/src/wallet/services/execution/tx-request-builder.ts:101-105`, `packages/extension/src/wallet/services/execution/tx-request-builder.ts:353-367`, `packages/extension/src/wallet/services/execution/tx-request-builder.ts:388-390`, `packages/extension/src/wallet/services/execution/service.ts:471`, `packages/extension/src/wallet/services/execution/service.ts:616-625`, `packages/extension/src/wallet/services/execution/service.ts:707-734`, `packages/extension/src/wallet/services/execution/service.ts:1209`, `packages/extension/src/wallet/services/execution/service.ts:1263`, `packages/extension/src/wallet/services/execution/service.ts:1571-1691`, `packages/extension/src/wallet/services/execution/service.ts:1750`, `packages/extension/src/wallet/services/execution/service.ts:1819`, `packages/extension/src/wallet/services/account-state/service.ts:44-56`, `packages/extension/src/wallet/services/account-state/service.ts:100-128`, `packages/extension/src/wallet/services/account-state/service.ts:196-217`, `packages/extension/src/wallet/services/token/service.ts:275`, `packages/extension/src/wallet/services/token/service.ts:360`, `packages/extension/src/wallet/services/token/service.ts:453`, `packages/extension/src/wallet/services/note/service.ts:129-189`, `packages/extension/src/wallet/services/fpc/service.ts:160`, `packages/extension/src/wallet/services/fpc/service.ts:243`, `packages/extension/src/wallet/services/fpc/service.ts:345`, `packages/extension/src/wallet/services/transaction/service.ts:124-150`, `packages/extension/src/wallet/services/transaction/service.ts:196-220`, `packages/extension/src/wallet/services/transaction/spec.ts:121-128`).  
   Shippable outcome: failover covers real wallet reads/writes, not just the node cache.

4. **Popup surface.** Rehydrate route state in the popup, add `Degraded` status rendering, show a failover toast, and label preferred vs active endpoints in settings (`packages/extension/src/stores/app.store.ts:103-116`, `packages/extension/src/composables/useProfileBootstrap.ts:23-46`, `packages/extension/src/popup/app.vue:97-127`, `packages/extension/src/components/Header.vue:233-242`, `packages/extension/src/components/Header.vue:373-392`, `packages/extension/src/popup/pages/settings/networks/[id].vue:71-79`, `packages/extension/src/popup/pages/settings/networks/[id].vue:186-230`, `packages/extension/src/composables/toast.js:14-32`).  
   Shippable outcome: users can see that the wallet is healthy-but-on-backup.

**Failover State Machine**
- Initial state: `activeEndpoint = preferredEndpoint`, all counters zero.
- Success on live endpoint: reset that endpoint’s consecutive-failure counter.
- Countable failure on live endpoint: increment counter.
- Counter `< 2`: keep route unchanged.
- Counter `== 2`: set `cooldownUntil = now + 5m` on the failed endpoint, scan next candidates in `endpoints[]` order, and promote the first candidate whose on-use `_getChainId()` matches the network (`packages/extension/src/wallet/services/network/service.ts:726-736`).
- Candidate chain mismatch: mark `invalidChain` for the session and skip it until user edits/deletes it or the SW restarts.
- Candidate list exhausted: keep current route, bubble the original error, and retry only on future user traffic.
- Live-route promotion: evict the chain node cache immediately and emit the route-change event.
- URL-pinned tx polling: keep the existing `transientNodes` model and evict only after 3 failures; the next polling tick falls back to the current live route (`packages/extension/src/wallet/services/network/service.ts:519-535`).

**PXE Coherence**
- Failover **does** imply a future `ChainRuntime` rebuild because `rpcUrl` is part of the runtime identity (`packages/aztec-runtime/src/pxe/chain-runtime.ts:33-39`, `packages/aztec-runtime/src/pxe/chain-runtime.ts:129-156`).
- In-flight operations keep their original binding. New operations block behind the per-chain guard long enough to rebind safely, then continue on the new endpoint (`packages/aztec-runtime/src/pxe/service.ts:405-443`).
- Pending tx receipt polling stays pinned to `submittedEndpointUrl`; failover changes only the fallback after transient eviction, never the original submission target (`packages/extension/src/wallet/services/transaction/service.ts:124-150`, `packages/extension/src/wallet/services/transaction/service.ts:196-220`).
- Do not run concurrent dual PXEs against the same chain DB. Do not purge PXE state on failover.

**UX Surface**
- Event: extend `onPrimaryEndpointChanged` payload with `fromEndpointId`, `toEndpointId`, `source`.
- Toast: show once per auto-failover on the active network, e.g. “RPC switched to Backup 1”.
- Header: add `Degraded` amber status when live != preferred (`packages/extension/src/components/Header.vue:373-392`).
- Settings page: show one “Preferred” marker and one “Active” marker when they differ; keep manual selection on row click (`packages/extension/src/popup/pages/settings/networks/[id].vue:186-230`).
- Manual override: selecting a row makes it preferred, sets it live immediately, clears cooldown/quarantine for that endpoint, and does not wait for another failure cycle.

**Security And Adversarial**
- **Endpoint impersonation.** Re-probe chain identity on every promotion, not only on add/update. Skip mismatched endpoints and session-quarantine them. This is the minimum defense against a stale/malicious backup that later points elsewhere (`packages/extension/src/wallet/services/network/service.ts:328-346`, `packages/extension/src/wallet/services/network/service.ts:389-392`, `packages/extension/src/wallet/services/network/service.ts:726-736`).
- **Split-brain.** Accept that different endpoints can disagree on tip. Mitigation is operational, not cryptographic: pin in-flight ops, keep tx polling on the submitted URL, and surface `Degraded` so the user knows they are on backup. No quorum logic.
- **Timing oracle.** No background pings and no multi-endpoint fanout. Only probe the current endpoint and, on threshold trip, the next candidate. That minimizes attacker-visible timing compared with periodic health checks.
- **DoS / forced failover.** Ordered priority means an attacker only receives failover traffic if they were already configured as a backup. Threshold 2 plus 5-minute cooldown prevents tight flip-flopping. No auto-failback means the attacker cannot bounce traffic back and forth cheaply.
- **Stale state on retry / duplicate tx.** Never auto-resubmit an ambiguous tx across endpoints. If submit fails before a clear tx hash/receipt contract, bubble the error and let the user retry explicitly. Auto-failover only changes routing for later traffic.
- **In-flight PXE coherence.** Rebind only after old chain work drains. Reusing `clearChainState()` here would be a correctness bug because it wipes notes/senders/contracts for the chain (`packages/aztec-runtime/src/pxe/service.ts:376-401`, `packages/extension/src/wallet/services/network/service.ts:552-589`).
- **Config integrity.** Failover only chooses from endpoints already in the user’s stored network config; there is no endpoint discovery path and no external reputation dependency.

**Validation Gates**
- Unit:
  - `packages/extension/src/wallet/services/network/service.test.ts`: add live-route, cooldown, invalid-chain-skip, manual override, and active-backup mutation tests (`:150-188`, `:524-569`).
  - `packages/extension/src/wallet/services/pxe/chain-runtime.test.ts`: add rebind-under-lock cases (`:56-199`).
  - `packages/aztec-runtime/src/pxe/service.test.ts`: add serialized rebind/no-purge cases (`:96-169`).
  - `packages/extension/src/wallet/services/execution/service.ts` paths: add estimate-reuse invalidation against live-endpoint drift (`:616-625`, `:707-734`).
- Smoke e2e:
  - Extend the existing network settings/network-chip coverage in `packages/extension/tests/e2e/network/networks.test.ts:9-69` with a failover-visible-state case.
- Network e2e:
  - Run `bun run e2e:agent`; the harness and CI job already exist (`packages/extension/tests/e2e/README.md:15-29`, `.github/workflows/_network-e2e.yml:23-45`, `.github/PULL_REQUEST_TEMPLATE.md:11-19`).
  - Add one proxy-backed scenario that flips the preferred endpoint from pass-through to 5xx/timeout, proves route promotion, and verifies no duplicate submit when the original submission path is ambiguous.
- Manual smoke:
  1. Configure two valid endpoints for one L2 chain and make the flaky one preferred.
  2. Trigger two countable failures and verify toast + amber header dot + settings-page preferred/active split.
  3. Confirm the next balance/contract/account read uses the backup.
  4. Submit a tx, then break the original endpoint and verify receipt polling stays pinned until transient eviction, with no automatic resubmission.

**Out Of Scope**
- L1 / bridge-side RPC failover.
- Background health checks or periodic probes.
- Persistent health memory across SW restarts.
- Chain-level quorum, block-height arbitration, or split-brain reconciliation.
- Automatic replay/resubmission of failed or ambiguous tx submissions.
- Endpoint discovery, trust scoring, or third-party availability feeds.
- Storage migration code.

Recommended approach: keep persisted network config simple, add in-memory per-network live routing with threshold-2 proactive failover, pin each logical operation to one resolved endpoint, and make PXE rebind wait for the per-chain write barrier so failover is correct without wiping chain state.