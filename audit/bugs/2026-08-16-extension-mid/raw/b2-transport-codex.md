<!-- codex session 01a00a8b-f3cf-7b12-8d3a-64962869fa2e -->

### Finding: Concurrent sessions overwrite the verification hash shown by another session

1. **Severity:** Critical
2. **Repro confidence:** high
3. **Type:** race / wrong result
4. **Counter-example:** Two tabs for the same `(origin, chainId)` complete key exchange close together, producing active sessions A and B with hashes `HA` and `HB`. A stores `HA` and opens its verification window. Before that window loads the session row, B stores `HB`. A’s window then reads `HB` and displays B’s emojis. Selecting “Always trust” trusts the shared dApp session after verifying the wrong channel.
5. **Violated invariant:** The verification emojis displayed for a connection must derive from that exact active session’s `verificationHash`. The code explicitly supports multiple live `ActiveSession`s for one stored `DappSession`, so a connection-specific value cannot safely live in the shared row.
6. **Failing path:** `BackgroundConnectionHandler.handleKeyExchangeRequest()` installs each distinct active session and invokes the callback (`node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:319`, `:330`, `:346`) → `onSessionEstablished` resolves the shared tuple-level session and overwrites its hash (`apps/extension/src/wallet/services/wallet-sdk/background.ts:212`, `:220`, `:222`) → both windows receive only the shared `dappSession.id` (`apps/extension/src/wallet/services/wallet-sdk/background.ts:247`) → the verification window reloads that shared row and displays its current hash (`apps/extension/src/popup/windows/verify/index.vue:140`, `:149`, `:155`).
7. **Expected vs actual behavior:** Expected: each window shows the emojis for its own transport session. Actual: the last established connection wins the shared `verificationHash`, so another connection’s window can show the wrong emojis.
8. **Recommended fix:** Keep verification state per active wallet-SDK session. Pass a unique verification-record/session identifier to the popup and bind it to `{activeSessionId, dappSessionId, verificationHash}`. Do not use the tuple-level `DappSession.verificationHash` as the source for concurrent connection windows.
9. **Instances:** `apps/extension/src/wallet/services/wallet-sdk/background.ts:220`, `:222`, `:247`; `apps/extension/src/wallet/services/dapp-session/service.ts:203`; `apps/extension/src/popup/windows/verify/index.vue:140`, `:149`, `:155`; shared trust write at `apps/extension/src/popup/windows/verify/index.vue:77`.
10. **Certificate conclusion:** A normal, explicitly supported two-tab connection interleaving deterministically allows one session’s verification value to replace another’s before display.

### Finding: Capability approvals lose concurrent updates and can commit partial decisions

1. **Severity:** Major
2. **Repro confidence:** high
3. **Type:** lost update / state invariant violation
4. **Counter-example:** A dApp has two active tab sessions backed by the same stored `DappSession`, initially with no grants or accounts. Tab A requests and receives approval for account A; tab B concurrently requests and receives approval for the transaction capability. Both dispatches snapshot the empty session. A writes its accounts/grants, then B writes arrays computed from its stale empty snapshot. Both RPCs report success, but the final row contains only B’s state and silently loses A’s approval.
5. **Violated invariant:** Every successfully approved capability decision must be merged into the latest session state, and accounts, aliases, grants, and rejections representing one decision must commit together. The per-session FIFO only serializes one wallet-SDK `sessionId`; the code documents that multiple live session IDs may share one stored tuple-level session.
6. **Failing path:** `onWalletMessage` serializes by active `session.sessionId`, not stored session ID (`apps/extension/src/wallet/services/wallet-sdk/background.ts:263`, `:265`, `:316`) → both `dispatch()` calls capture the same stored session snapshot (`packages/wallet-bridge/src/dispatcher.ts:390`, `:396`) → `handleRequestCapabilities()` computes merges from that snapshot (`packages/wallet-bridge/src/dispatcher.ts:876`, `:977`, `:1025`, `:1037`) → separate service calls replace accounts/grants/rejections under independent lock acquisitions (`apps/extension/src/wallet/services/dapp-session/service.ts:161`, `:236`, `:253`).
7. **Expected vs actual behavior:** Expected: both successful approvals remain present. Actual: last-writer-wins replacement loses an earlier approval. Separately, if any later write fails after `updateDappSession`, `setAccountAliases`, or `setCapabilityGrants` succeeds, the RPC rejects while a partial decision remains persisted.
8. **Recommended fix:** Add one `applyCapabilityDecision` service mutation that reacquires the latest row under `DappSessionService`’s lock, merges the approved delta, selected accounts, aliases, and rejections there, and performs one signed storage write. Avoid passing precomputed whole-row arrays from the dispatcher.
9. **Instances:** `packages/wallet-bridge/src/dispatcher.ts:396`, `:876`, `:977-991`, `:1025-1039`; `apps/extension/src/wallet/services/dapp-session/service.ts:161-179`, `:225-244`, `:253-261`; interface encouraging split writes at `packages/wallet-bridge/src/services-contract.ts:88-96`.
10. **Certificate conclusion:** The lock protects individual writes but not the read/merge/write transaction, so concurrent successful operations can overwrite one another and failure between writes leaves an observable partial state.

### Finding: RPC timeout does not cover connection establishment

1. **Severity:** Major
2. **Repro confidence:** high
3. **Type:** bad retry-or-timeout
4. **Counter-example:** An existing extension page calls an RPC after an extension update invalidates its context. `chrome.runtime.connect()` repeatedly throws “Extension context invalidated.” Even with `requestTimeoutMs: 500`, the RPC remains pending forever because request ID allocation and the timeout timer occur only after connection succeeds.
5. **Violated invariant:** `DEFAULT_RPC_TIMEOUT_MS` is documented as the upper bound for an RPC and as protection against a wedged service worker. Readiness failure is part of that RPC lifecycle and must not bypass the bound.
6. **Failing path:** A generated client method calls `BaseServiceClient.request()` (`packages/extension-messaging/src/core/base-client.ts:101`) → it awaits `ensureTransportReady()` before creating the pending entry (`packages/extension-messaging/src/core/base-client.ts:110`) → background readiness calls `connect()`/`waitForConnection()` (`packages/extension-messaging/src/background/client.ts:101`, `:110`) → `connect()` catches every failure and retries forever (`packages/extension-messaging/src/background/client.ts:45`, `:50`, `:59`) while the actual timeout is not installed until `packages/extension-messaging/src/core/base-client.ts:123`.
7. **Expected vs actual behavior:** Expected: the request rejects within its configured timeout with a typed timeout/disconnection error. Actual: it never reaches the correlator or timer and can hang the calling UI indefinitely.
8. **Recommended fix:** Establish a total request deadline before awaiting readiness. Pass the remaining deadline or an abort signal into connection waiting, and reject with `RpcTimeoutError` or `RpcDisconnectedError` when readiness cannot be achieved in time.
9. **Instances:** `packages/extension-messaging/src/core/base-client.ts:110-125`; `packages/extension-messaging/src/background/client.ts:45-63`, `:101-120`. The same ordering also leaves offscreen readiness outside the request deadline at `packages/extension-messaging/src/offscreen/client.ts:97-100`.
10. **Certificate conclusion:** A concrete synchronous connection-failure loop bypasses the configured timeout entirely.

### Finding: Locked discovery requests can disappear early or be approved after the dApp stopped waiting

1. **Severity:** Major
2. **Repro confidence:** high
3. **Type:** bad retry-or-timeout / lost update
4. **Counter-example:** Using the wallet SDK’s default discovery timeout, a locked wallet receives a discovery at `t=0`. If the user unlocks at `t=61s`, Nulo still treats it as live because its stale limit is five minutes, opens the connection flow, and may persist/approve the session. The dApp removed its response listener at 60 seconds, so the connection cannot complete. Alternatively, if the MV3 worker is reclaimed around 30 seconds and the user unlocks at 40 seconds, the in-memory queue has already disappeared even though the dApp is still waiting.
5. **Violated invariant:** A queued discovery must remain available exactly while its requester can consume approval: it must neither be lost during ordinary service-worker teardown nor processed after the producer’s discovery lifetime ended. `DiscoveryQueue` promises to drain locked-wallet requests on unlock.
6. **Failing path:** The SDK emits one discovery and removes its listener on its default 60-second timeout (`node_modules/@aztec/wallet-sdk/src/extension/provider/extension_provider.ts:16`, `:170`, `:176`, `:181`, `:190`, `:228`) → locked handling enqueues it (`apps/extension/src/wallet/services/wallet-sdk/background.ts:486`, `:495`) → `DiscoveryQueue` stores it only in a process-local array and uses a five-minute stale threshold (`packages/wallet-bridge/src/discovery-queue.ts:5`, `:22`, `:52`) → unlock drains and processes it (`apps/extension/src/wallet/services/wallet-sdk/background.ts:383`, `:386`, `:397`).
7. **Expected vs actual behavior:** Expected: unlocking while the dApp is still waiting resumes discovery; after the dApp times out, the request is rejected without prompting or persisting a connection. Actual: MV3 restart loses live requests, while requests aged 60 seconds to five minutes are still presented and approved after their consumer has gone.
8. **Recommended fix:** Give queued discoveries an explicit producer-compatible expiry and make their lifecycle restart-safe. Persist sufficient pending metadata in `chrome.storage.session` and restore/reconcile it with the wallet-SDK handler, or arrange an explicit content-script rediscovery handshake after worker restart. The default expiry must not exceed the SDK’s default 60-second waiting period.
9. **Instances:** `packages/wallet-bridge/src/discovery-queue.ts:5`, `:22`, `:39-55`, `:62-99`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:324`, `:383-410`, `:486-498`.
10. **Certificate conclusion:** Both timing examples use ordinary documented lifetimes and result in a failed connection despite the user acting within one side’s apparent valid window.

### Finding: Verification setup failures leave an unverified active session running

1. **Severity:** Major
2. **Repro confidence:** high
3. **Type:** bad error path / state invariant violation
4. **Counter-example:** Key exchange succeeds, but the signed `DappSession` write for `setVerificationHash` rejects because storage is temporarily unavailable. The callback’s promise rejects, `pendingVerification` is not cleared, no verification window opens, and the wallet-SDK session remains in `activeSessions` and continues accepting messages.
5. **Violated invariant:** A connection requiring verification must either finish verification setup or be terminated/retried in a controlled state. Failure to persist or present the verification value must not silently leave the connection active.
6. **Failing path:** The upstream handler inserts the session into `activeSessions` before invoking the callback and does not await the callback’s returned promise (`node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:330`, `:346`) → the async callback awaits `setVerificationHash` without local error containment (`apps/extension/src/wallet/services/wallet-sdk/background.ts:212`, `:220`, `:222`) → the storage write rejects (`apps/extension/src/wallet/services/dapp-session/service.ts:203`, `:208`) → cleanup and window creation at `apps/extension/src/wallet/services/wallet-sdk/background.ts:240-255` never execute.
7. **Expected vs actual behavior:** Expected: setup failure is caught, the pending marker is cleaned, and the active session is terminated or verification is retried. Actual: an unhandled rejection occurs and the active session survives without its required verification UI. A rejected `chrome.windows.create()` similarly has no handler because its promise is neither awaited nor caught.
8. **Recommended fix:** Wrap the entire callback in `try/catch/finally`, await `chrome.windows.create`, remove the tuple from `pendingVerification` in `finally`, and terminate the specific active session if verification persistence or popup creation fails.
9. **Instances:** `apps/extension/src/wallet/services/wallet-sdk/background.ts:212-255`, especially `:222`, `:240-242`, `:247`; `apps/extension/src/wallet/services/dapp-session/service.ts:203-210`.
10. **Certificate conclusion:** A concrete storage or window-creation failure occurs after upstream commits the active session, and no current path rolls that commit back.

## Non-findings considered

- Base-client late-response/reconnect ID reuse: reconnect keeps the same monotonically increasing counter and disconnect clears pending entries, so a late response cannot settle a newer request under practical operation.
- Background service `splice(indexOf(client))`: the `-1` case is guarded; a failed fan-out send leaves a stale reference temporarily, but normal Port teardown delivers `onDisconnect`, and no concrete wrong result beyond logging was established.
- Offscreen UID routing: the 64-bit random UID collision requires an impractical collision, and old service-worker listeners do not coexist after normal worker teardown.
- `sessionQueues` and `decryptQueues` rejection poisoning: stored queue tails use rejection-swallowing promises, and the session baton is released by the handler-chain `finally`, so a rejected leg does not block successors.
- `pendingVerification` cleanup alone: stale tuple membership can cause an extra verification prompt but does not by itself grant authority or suppress required verification.
- `handleRequestCapabilities` persisting rejection records before rethrow is intentional bookkeeping for the “previously denied” UI; the bug is the non-atomic multi-write commit after approval, not this documented rejection write.
- `data.addressBook` and `contractClasses` capability field widening are explicitly pinned by characterization tests as known intentional drift and were not reported.
- WindowManager close/result races: `detach`, map deletion, and idempotent settlement correctly prevent double resolution in the examined normal interleavings.