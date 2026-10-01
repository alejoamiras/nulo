# Arc 4 recon — F-B16 (queued discoveries vanish on SW restart), against `dev@96d2a823`

Three parallel read-only agents + a direct SDK-source read. Anchors verified on current dev.

## What vanishes vs what survives

Everything discovery-related is in-memory inside `initWalletSdkHandler`'s closure (`apps/extension/src/wallet/services/wallet-sdk/background.ts:77-450`), recreated empty at every SW boot with zero rehydration:

- `DiscoveryQueue.queue: QueuedDiscovery[]` (`packages/wallet-bridge/src/discovery-queue.ts:42`) — the locked-wallet queue; a plain array of `{requestId, origin, chainId}`. Constructed fresh at `background.ts:330`.
- The SDK's `BackgroundConnectionHandler.pendingDiscoveries: Map<string, PendingDiscovery>` — the REAL record (`origin, chainInfo, tabId, appId, appName, timestamp, status`). No persistence hook.
- `pendingVerification`, `pendingDiscoveryPromises`, `establishmentStatus`, `sessionQueues`, `decryptLocks` (`background.ts:110-341`).
- Popup-side: `DappInteractionService.storage` Map + `WindowManager.handles` (live resolve/reject closures — structurally unserializable).

Durable already: `DappSession` rows (`nulo:core:dappSessions`, written only POST-approval), and the `chrome.storage.session["nulo:liveness"]` heartbeat (`runtime.ts:313-333`) — proof that the storage.session tier (survives SW restart, clears on browser exit) is an established pattern here.

**The toolbar badge is Chrome-level state that DOES survive** (`discovery-queue.ts:125-131`, the repo's only badge writer) — a restart with a non-empty queue leaves a stale nonzero badge over an empty queue; nothing resets it at boot.

## The decisive SDK facts (read from `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js`)

- `approveDiscovery(requestId)` (:132) requires `pendingDiscoveries.get(requestId)` with `status === 'pending'`; then sends `DISCOVERY_APPROVED` to `discovery.tabId`.
- `handleKeyExchangeRequest` (:159) — the post-approval ECDH — ALSO requires the map record (`status === 'approved'`). Both halves of the handshake depend on the SDK's map.
- **`handleDiscoveryRequest(request, tabId, origin)` (:118) is a public entry** that constructs the record, seeds the map (`status:'pending'`), and fires `callbacks.onPendingDiscovery` — the exact same path the content-script relay uses. Replaying a persisted projection through it re-creates the SDK state legitimately (no private-field access, no message forgery).
- **The SDK itself re-seeds `pendingDiscoveries` from session data** in `terminateSession` (:246-257, "Restore discovery to approved state so user can retry key exchange") — internal precedent for record reconstruction.
- Caveat: `handleDiscoveryRequest` stamps `timestamp: Date.now()` — a replay would launder staleness. `getPendingDiscovery(requestId)` returns the LIVE record reference (plain `Map.get`), so the caller can restore the original timestamp synchronously after the call returns — before the (async) `handleDiscovery` resumes past its first await. Both facts need canary pins.
- The dApp side (`extension_provider.ts:17`) runs its own local `DEFAULT_DISCOVERY_TIMEOUT_MS = 60_000`; the wallet's `DISCOVERY_STALE_MS = 55_000` (`discovery-queue.ts:15`) deliberately undercuts it. Durability therefore only has value inside the ≤55s window — but that window is exactly the common MV3 case (idle SW killed ~30s after the queued discovery, user unlocks at 40-50s).

## The anti-lost-tx invariant (spec warning, mapped)

Exact wording at `background.ts:256-261`: two concurrent `sendTx` requests must BOTH journal as `queued` before either is approved; queued-journal creation happens at message ARRIVAL, gated only on establishment, deliberately OFF the per-session FIFO baton. Pinned by `tests/e2e/network/concurrent-sendtx{,-approve,-confirm}.test.ts`. Historical regression: commit `d1529c83` pulled journal creation behind the baton; `dc580a9f` reverted it. **Constraint for this arc: discovery durability must not share plumbing (locks, serialized boot-replay, journal roots) with the `onWalletMessage`/sendTx arrival path.** Discovery is pre-session; the flows only share the closure, not state.

Also: do NOT conflate with `queued-journal.ts` (`tryCreateQueuedJournal` — durable `nulo:journal` records for POST-connection sendTx, its own caps and reaper grace windows).

## Boot-resume precedents to adopt

- `runtime.ts:256-284` — `journalBootCutoff` captured pre-`services.start()`; `deletionCoordinator.resumePending(bootCutoff)` + `JournalReaper.start()` fire-and-forget after start. The template for a boot hook.
- `EntityStorage<T>` over an injected `MinimalStorageArea` — works over `chrome.storage.session` (layer-legal: wallet-bridge imports wallet-core).
- No `chrome.runtime.onStartup` anywhere; MV3 re-executes the SW top-level on every wake. The SDK message listener is registered LATE (async, tail of `runtime.start()` → `handler.initialize()` at `background.ts:446`) — **a dApp message that itself wakes a cold SW races this registration and can be lost entirely. Separate, newly-observed gap — recorded as a discovery, out of arc scope** (F-B16 is about already-queued discoveries).

## Test surface

- Unit pins to preserve: `discovery-queue.test.ts` (F-04 caps, coalesce, 55s boundary, per-entry clock re-read), `discovery-approval.test.ts` (B-16 rollback), `session-baton/session-established/queued-journal` tests.
- **Restart-simulation idiom exists**: `profile/service.integration.test.ts:168-194` `makeServiceFromExistingApi` — two service-graph generations over ONE `FakeBrowserApi` (module-level singleton storage, `.reset()` skipped on gen-2); used throughout the F-B24 torn-import suite. The proven RED-test template.
- **E2E scaffold exists**: `tests/e2e/network/connect-locked-queue.test.ts` (lock → queue → unlock → drain → popup) — the natural extension point: insert the verified SW kill (`worker().close()` + `targetdestroyed` by object identity — `Runtime.terminateExecution` is a documented fake kill) + `waitForLiveness` strictly-newer check between queue and unlock.
- Popup fixtures: `waitForPopup(ctx, "discover")`, `approveDiscover` etc. (`fixtures/popups.ts`); playground drivers in `fixtures/playground.ts`/`extension.ts`.
- `wallet-sdk/background.ts` has NO composition/integration test today; arc 8 owns decomposing it — keep this arc's tests at the DiscoveryQueue/store layer + e2e, not a new harness for the whole closure.

## Collision/dedup risks (from recon, must be honored)

1. Persisting only the queue triple is useless — drain re-fetches the full record via `handler.getPendingDiscovery` and silently drops "gone" entries (`discovery-queue.ts:95-102`). The projection must carry enough to replay (`requestId, appId, appName?, origin, chainId, chainInfo, tabId, timestamp`).
2. Caps/coalesce (F-04) are pinned against the enqueue/drain choke points — persistence must flow through them, never a parallel write path.
3. `tabId` can die across the boundary; nothing currently removes QUEUED entries on tab close (pre-existing gap that persistence widens) — replay should verify the tab still exists.
4. Cross-boot dedupe: `pendingDiscoveryPromises`/`pendingVerification` reset at boot; a replayed discovery racing a fresh same-`(origin,chainId)` discovery goes through `handleDiscovery`'s existing dedupe/auto-approve guards — rely on those, don't invent new ones.
5. Badge must be re-derived at rehydrate time unconditionally (including to "" when nothing survives) — the stale-ghost badge is otherwise permanent.
6. Popup-side orphaning (open discover popup + SW restart → `"Invalid id"`) is a SEPARATE gap (unserializable window handles) — out of scope, documented.
