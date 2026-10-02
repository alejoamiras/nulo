# b06-network-pxe-transport — claude

Scope read: `packages/extension-messaging/src/{core/base-client,core/base-service,core/error-response,core/initialization,core/sender-auth,core/decode,core/terminal-status,core/rpc-methods,core/service-client-factory,background/client,background/service,offscreen/client,offscreen/service,offscreen/telemetry,errors,utils}.ts`; `packages/aztec-runtime/src/pxe/{service,client,chain-runtime,opfs-store,lifecycle-coordinator,chain-coordinates,async-memo,artifact-registry,public-events,stale-anchor,proxy}.ts`; `packages/aztec-runtime/src/{utils/fetch,utils/chain-identity,adapters/aztec-node-factory-adapter,offscreen/entry}.ts`; `apps/extension/src/wallet/services/network/{service,spec}.ts` (+ `service.test.ts` greps); `apps/extension/src/wallet/services/pxe/{client,shallow-port}.ts`; `apps/extension/src/wallet/utils/offscreen.ts`; `apps/extension/src/offscreen/index.ts`; `apps/extension/src/presto/client.ts`; `packages/wallet-core/src/utils/{lock,rw-guard,keyed-lock,event-handler,serialization}.ts`; `packages/wallet-core/src/base/{index,topology}.ts`; `packages/wallet-core/src/jobs/{fsm,error}.ts`. Cross-boundary reads (one hop): `stores/app.store.ts` (`syncNetworkStatus`), `account-state/service.ts` (`getNodeStatus` callers), `transaction/service.ts` (`waitForTx`), `account/spec.ts`.

This cluster has been audited twice (2026-08-16, 2026-08-22) and is heavily fenced (epochs, generations, single-flight gates, owner-token locks). One new defect survived a full trace; the rest of the time went into refuting candidates, listed below.

## b06-network-pxe-transport-C-1: [Minor] `getNodeStatus` lacks the local-network carve-out its sibling `probeNodeStatus` has, so an edited Local Network endpoint reads as `InvalidChain`

1. **Title**: `NetworkService.getNodeStatus` reports `InvalidChain` for a `kind: "local"` network whose primary endpoint URL is not the seed literal.
2. **Severity**: Minor (dev-facing Local Network only; wrong status indicator plus a silently thinner backup).
3. **Repro confidence**: high (pure code trace; both halves of the asymmetry are in one file).
4. **Type**: wrong result (secondary: silent omission in backup export).
5. **Counter-example**: a developer edits the seeded "Local Network" endpoint from `http://localhost:8080` to `http://127.0.0.1:8080` (or `http://localhost:8081`). `updateEndpoint` accepts it (it passes `peek.kind === "local"` as `kindHint`, so the probe returns `chainId: 0`; covered by the `service.test.ts` "Local Network accepts a non-seed endpoint URL via the kindHint short-circuit" case). Then `getNodeStatus(localNetworkId)` calls `_getChainId(primary.rpcUrl)` with NO hint, `sameLocalNetworkUrl(url, LOCAL_NETWORK_RPC_URL)` is false (host/port differ), so the probe returns the real composite `(l1ChainId ^ rollupVersion) >>> 0`, which is non-zero and differs from the stored `chainId === 0`, so the result is `NodeStatus.InvalidChain` although the node is healthy and correct.
6. **Violated invariant**: `_getChainId`'s own doc comment ("`kindHint` lets callers that already know the target network's kind bypass the URL comparison ... structural fix for the bug where editing Local Network's endpoint URL ... yielded ERR_ENDPOINT_CHAIN_MISMATCH") and `probeNodeStatus`'s comment ("mirror `_getChainId`'s carve-outs so a local endpoint can't misreport as InvalidChain"). `probeNodeStatus` (`network/service.ts:753`) applies `network.kind === "local" || sameLocalNetworkUrl(...) ? 0 : probed`; `getNodeStatus` does not.
7. **Failing path**: `apps/extension/src/wallet/services/network/service.ts:726-740` (`getNodeStatus`) → `:996-998` (`_getChainId`, `kindHint` undefined) → `:1003-1010` (`_probeChainIdentity`: `kindHint === "local"` false; `sameLocalNetworkUrl` false; returns the XOR composite) → `:735` `probedChainId !== network.chainId` → `InvalidChain`. Consumers: `stores/app.store.ts:495-499` (`syncNetworkStatus` feeds `Header.vue:317` status dot); `account-state/service.ts:221` (`backupAccountState`: `!== Active` → logs "OMITTED from this backup" and skips the network's contract/sender state); `account-state/service.ts:101` (`getSendersAcrossActiveNetworks` skips the network).
8. **Expected vs actual**: expected `Active` for a reachable local node at the user-configured endpoint, as `probeNodeStatus` and `updateEndpoint` already decide; actual `InvalidChain` — header dot shows the wrong state and a full-backup export silently drops the local network's registered contract artifacts and senders (only a warn line records it).
9. **Recommended fix**: pass the row's kind through: `_getChainId(primary.rpcUrl, network.kind)` in `getNodeStatus` (one argument), or factor the `probeNodeStatus` carve-out into a shared helper used by both.
10. **Instances**: `apps/extension/src/wallet/services/network/service.ts:734` (the only call site of `_getChainId` without a hint for a known row; `_getChainId` has no other callers).

## Leads adjudicated

- q04 `setActiveNetwork` with no primary endpoint (`network/service.ts:575-590`): rejected. The divergent branch needs a row whose `primaryEndpointId` matches no endpoint. Every mutator preserves it (`deleteEndpoint` refuses the primary and the last endpoint, `updateEndpoint` keeps the id, `setPrimaryEndpoint` checks membership, `_buildNetwork` sets `${id}-ep0`), so only raw storage corruption or a tampered backup reaches it, and the next `getNode` then fails loudly ("has no primary endpoint"). No normal-operation trigger.
- q13 plain-`Error` subclasses lose identity (`ImportedAccountUnusableError`, `TxConfirmationTimeoutError`): rejected. `TxConfirmationTimeoutError` is thrown by `TransactionService.waitForTx`, which is only called SW-locally (`auth-registry/service.ts:303,359`), never across an RPC, so identity is never lost where it matters. `ImportedAccountUnusableError` is thrown from `AccountService` signing-path helpers (`account/service.ts:371-421`); nothing anywhere (popup, dispatcher, SW) discriminates on the class or name, the descriptive message survives flattening intact, and the "offer delete + re-import" CTA its doc promises does not exist as code regardless of transport. A missing CTA is a feature gap, not a wrong result or invariant violation.
- q13 `LogsViewer.vue` timer / `integrity.ts` dead catch: outside this cluster, not adjudicated here.
- q01, q02, q03, q05–q12: not in this cluster.

## Routed to security

- `packages/aztec-runtime/src/pxe/artifact-registry.ts:203-215`: `verifiedClassIds` is keyed by class id alone and shared across every profile and chain on the `PxeService`, so once any PXE returned a verified artifact for class X, a later `pxe-local` lookup in a different profile's PXE returns whatever artifact that store holds for X without re-verifying. Needs a hostile or corrupted store to matter.

## Non-findings considered

- Offscreen document dying mid-request leaves `proveTx` pending until its 30-minute ceiling (no death signal; the responding `sendMessage` resolves immediately): already adjudicated bounded and deliberate in the prior run (journal reaper / `cancelJob` recover); not re-reported.
- `isOffscreenHealthy` 3 s PING could kill a document whose event loop is blocked: the PXE's heavy work is in workers or awaits between oracle calls; no demonstrated >3 s main-thread block. Low confidence, dropped.
- Node HTTP envelope (60 s per attempt x 4 attempts) exceeds the 90 s SW→offscreen timeout, so a slow node leaves timed-out ops queued on the chain write guard: real mismatch, but the orphaned ops are idempotent reads and the effect is delay only; no wrong result.
- `BaseServiceClient.request` timer lifecycle: readiness race timer cleared in `finally`; pending timer and warn timer cleared in `settle`; `settle` is idempotent, so no leak and no double resolution. Late `ready` rejection is handled by the `Promise.race`.
- `requestAlreadyReady` / `bypassReadyOnce`: flag consumed synchronously in the same call stack before the first await; it calls `BaseServiceClient.request` directly, so the PXE override (generation stamping) is correctly not re-entered and the args are already stamped.
- Background `ServiceClient.onDisconnect` → `disconnect()` → `connect()`: `rejectAllPending` runs before reconnect, `state` transitions are synchronous, and `openPort` is idempotent.
- `ReadWriteGuard` baton passing, per-token force-release re-arm, and reader wake loop: traced writer-queued / reader-drain / orphaned-token interleavings; no starvation or double-hold found.
- `Lock` ticket/force-release: stale `leave` is a no-op; `NetworkService`'s lock has the watchdog disabled by design.
- `PxeService.provisionChainStoreKey` lifecycle table, `assertGenerationCurrent`, and `clearProfileState` marking `deleting` before its first await: consistent with the documented fence; retry idempotence holds.
- `withPxeWrite` capturing the purge epoch before queueing: an op queued behind a proof that then outlives a `clearChainState` fails with "purged mid-operation"; correct, since the chain's network row is gone when `clearChainState` runs (only `purgeChain` calls it).
- `ChainRuntimeRegistry.ensure` rebind on endpoint change: a flow holding a stale `NetworkInfo` (captured before a primary-endpoint switch) can flip the runtime between URLs; transient slowness only, no state corruption.
- `openChainStore` quarantine after a 30 s timeout: self-heals when the abandoned open settles; a never-settling worker needs an offscreen restart, as its typed error states.
- `NetworkService.nodes` keyed by `chainId` only: cleared under the lock on profile change; in-flight flows capture their node object at flow start (`ExecutionCoordinator` ctx), so a profile switch mid-prove does not re-route `sendTx`.
- `getOrInitNetworks` returning a partial seed set on later calls after one seed's storage write failed: needs a transient storage failure during first-run seeding; rare, and recovery is a re-add.
- `topologicalPhases` with a duplicated dependency name would report a false cycle: no service declares duplicates.
- `fetchPublicTokenTransferEvents` dropped-page semantics, `validatePageOrdering`, class-gate double anchor: traced; the hostile-response handling matches its documented contract.

## Cross-rebuttal (claude on codex)

### 1. Codex findings

- **X-1: agree on the defect, disagree on severity.** It is the same root cause as my C-1 (`network/service.ts:734`, `_getChainId` called with no kind hint, against `:753` and `:647`). The trigger is editing the dev-only Local Network endpoint. The effect is a wrong status dot plus a warn-logged thinner backup. I rate it Minor, not Major. Codex's counter-example is otherwise sound: `31337 ^ 1 = 31336`, which is non-zero and differs from the stored `0`. The two reports share one fix, `_getChainId(primary.rpcUrl, network.kind)`. Merge them as one finding.
- **X-2: agree it is real, partially on severity (Moderate, not Major).** I re-traced it in source.
  - `PxeService.profileTx` (`packages/aztec-runtime/src/pxe/service.ts:621-623`) passes only `{profileMode, skipProofGeneration, scopes}` to `pxe.profileTx`. Its siblings pass `senderForTags` at `:501` (`proveTx`) and `:584` (`simulateTx`).
  - Upstream `pxe.ts:1107` destructures `senderForTags` for profiling and forwards it to `#executePrivate` at `:1138`. The oracle's `getSenderForTags` (`private_execution_oracle.ts:195-196`) returns `Option.none()` when it is undefined.
  - The only caller, `view-executor.ts:403-407`, builds `scopes` as `[account, ...additional]`, so the sender is available. The `proveTx` comment at `:481-490` states the invariant that `scopes[0]` is the sender.
  - I missed this because I scoped `profileTx` only for the stale-anchor wrapper. I should have compared the option lists of the three siblings.
  - Severity: the failure is loud and only hits a dApp's `profileTx` on private-log-emitting calls. It loses no funds and does not affect send or simulate. The fix is to add `senderForTags: scopes[0]`. I can't confirm the "sender for tags is not set" assertion text from the contract artifact, but the `Option.none()` path itself is verified.
- **Leads q04 and q13:** we independently reached the same verdicts (both rejected), so no re-decision is needed.

### 2. What Codex missed that the Claude report found

- Routed to security: `artifact-registry.ts:203-215`, where `verifiedClassIds` is keyed by class id alone and shared across profiles and chains. This needs a hostile store, so Codex's "none" is defensible. I still stand by routing it for a look.
- Node HTTP envelope (60 s x 4 attempts) exceeds the 90 s SW→offscreen timeout. The effect is delay only (orphaned idempotent reads), so it is non-finding-grade and I do not press it.

### 3. What both missed

- None confirmed. Both passes hit the same 'sibling-asymmetry' class, so one more sweep for it is worth doing. I did not find a further instance in this cluster.
