### Finding: `pendingVerification` entry leaks when a wallet-sdk session is established after its backing `DappSession` was deleted (F-006 path)

1. **Title**: `pendingVerification` Set entry never cleared on the F-006 "session established but DappSession missing" branch

2. **Severity**: Minor

3. **Repro confidence**: high

4. **Type**: resource leak (primary), state invariant violation (secondary)

5. **Counter-example**:
   - A dApp at `(origin=O, chainId=C)` runs discovery; the user approves. `handleDiscovery` creates a `DappSession` row and calls `pendingVerification.add("O|C")` (`apps/extension/src/wallet/services/wallet-sdk/background.ts:610`).
   - Before the wallet-sdk ECDH key exchange round-trip completes, that same `DappSession` row is deleted — e.g. the user clicks "Disconnect" for that origin in the extension's connected-sites settings (a completely ordinary action, requiring no attacker involvement).
   - The `BackgroundConnectionHandler` still completes key exchange and invokes `onSessionEstablished(session)` (background.ts:212). `dappSessionService.tryGetDappSessionByOriginAndChain(O, C)` now returns `undefined`, so the `else` branch runs (background.ts:223-238): it logs, calls `handler.terminateSession(...)`, and `return`s at line 237 — **before** reaching the `verifKey`/`pendingVerification.delete(...)` cleanup at lines 240-242.
   - `pendingVerification` now permanently retains `"O|C"` for the rest of the service worker's in-memory lifetime.

6. **Violated invariant**: the module's own doc comment on `pendingVerification` (background.ts:103-109) states it "Track[s] new connections... keyed by `(origin, chainId)`" and the code's only cleanup site (line 242) assumes every `add()` is eventually matched by a `delete()`. The F-006 early-return path breaks that pairing.

7. **Failing path**: `handleDiscovery` (background.ts:598-612, `pendingVerification.add`) → external deletion of the `DappSession` row → `onSessionEstablished` callback (background.ts:212-256) → `dappSession` lookup returns `undefined` (line 220) → `else` branch (223-238) → `return` at line 237, skipping lines 240-242.

8. **Expected vs actual**: Expected — every `pendingVerification` entry is removed once its discovery attempt resolves (established-with-session, or abandoned). Actual — an entry survives indefinitely whenever the backing `DappSession` is gone by the time `onSessionEstablished` runs.

   Secondary, lower-confidence risk worth flagging: because the leaked key uses the exact same `(origin, chainId)` format as the dedupe/verification key, a later session established for the same pair via the upstream `BackgroundConnectionHandler.terminateSession()` "restore discovery to approved state so user can retry key exchange" path (confirmed in `node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:389-414`, which re-runs `handleKeyExchangeRequest` without a new `DISCOVERY_REQUEST`/`handleDiscovery` call) would read the stale `true` and could show a spurious "Verify" popup. I did not confirm the client actually exercises that retry path without a fresh discovery, so this consequence is not asserted as high-confidence — only the leak itself is.

9. **Recommended fix**: in the `else` branch (background.ts:223-238), also call `pendingVerification.delete(pendingKey(session.origin, chainId))` before `return`, mirroring the cleanup already done on the happy path (line 242).

10. **Instances**: `apps/extension/src/wallet/services/wallet-sdk/background.ts:223-238` (leak site), `:610` (add site), `:240-242` (the only cleanup site, unreachable from the leak path).

---

### Finding: `handleRequestCapabilities` persists a popup-approved grant across multiple independently-locked writes; a concurrent session revoke mid-sequence discards the approval behind a misleading error

1. **Title**: Non-atomic multi-step capability-grant persistence loses an approved `requestCapabilities()` result if the `DappSession` is deleted mid-sequence

2. **Severity**: Major

3. **Repro confidence**: moderate

4. **Type**: bad error path (primary), lost update (secondary)

5. **Counter-example**:
   - A dApp calls `requestCapabilities({capabilities:[{type:"accounts", canGet:true}]})`; the user approves in the popup. `dappInteractionService.requestCapabilities(...)` (dispatcher.ts:940) resolves successfully with `result.selectedAccounts=["0x..."]`.
   - After that `try` block (dispatcher.ts:938-961) exits successfully, `handleRequestCapabilities` runs a sequence of **separately awaited, separately locked** writes with no enclosing try/catch: `updateDappSession` (~983-988) / `setAccountAliases` (~989-991) → `setCapabilityGrants` (1030) → `setCapabilityRejections` (1039) → `getDappSession` reload (1042). Each of these independently acquires and releases `DappSessionService`'s internal `Lock` (`apps/extension/src/wallet/services/dapp-session/service.ts`), so nothing prevents another RPC from interleaving between any two of them.
   - Concretely: in another window/tab the user clicks "Disconnect" for the same origin (`dappSessionService.deleteDappSession(dappSession.id)`) while the just-approved capability popup's persistence sequence above is still in flight. `deleteDappSession`, `updateDappSession`, `setCapabilityGrants`, `setCapabilityRejections`, and `setAccountAliases` all throw a plain `Error("Invalid id")` when the row is gone (`dapp-session/service.ts:169-171,228,239,256`).
   - Whichever of the sequence's calls runs after the delete throws that plain `Error`, which propagates uncaught through `handleRequestCapabilities` → `dispatch()` (no top-level try/catch there) → `handleWalletMessage`'s catch in `background.ts` → `toWalletResponseError` (which doesn't recognize a plain `Error`) collapses it to the string `"Invalid id"` sent to the dApp.
   - Net effect: the user explicitly approved the capability request, but the dApp sees a cryptic `"Invalid id"` failure instead of either success or a clear "session was revoked" signal, and the approval is lost (any writes already committed before the delete are moot since the row is now gone).

6. **Violated invariant**: the function's own "Phase 0.5" doc comment (dispatcher.ts:390-396) states the dApp session is "captured ONCE at dispatch entry and threaded through every internal call" specifically to close TOCTOU windows across "6 separate lookups" — but the *write* side of `handleRequestCapabilities` (unlike the read side) still makes 3-5 separate, non-atomic round trips to storage after that single capture, each independently vulnerable to the session disappearing mid-sequence.

7. **Failing path**: `dispatch()` (dispatcher.ts:390) → `handleRequestCapabilities` (857) → `dappInteractionService.requestCapabilities` resolves (940-947) → concurrent `dappSessionService.deleteDappSession` (dapp-session/service.ts:270-278) → next write in sequence (e.g. `setCapabilityGrants`, dispatcher.ts:1030) throws `Error("Invalid id")` (dapp-session/service.ts:239) → uncaught back through `dispatch()` → `handleWalletMessage`'s catch (background.ts:672-716) → `toWalletResponseError` (error-envelope.ts:93) collapses to a bare string.

8. **Expected vs actual**: Expected — either the approval fully persists and the dApp gets its granted-capabilities result, or the dApp gets a clear, specific "session revoked" error. Actual — the user's approval is silently discarded and the dApp receives a generic, uninformative `"Invalid id"` error unrelated to what actually happened.

9. **Recommended fix**: wrap the post-approval persistence sequence (963-1042) in a single guarded section (or re-fetch/verify `dappSession` still exists immediately before the write block and treat a mid-sequence "Invalid id" as a distinguishable, documented outcome rather than an opaque propagated error) — the existing catch pattern around the `requestCapabilities()` call itself (938-961) is the right shape to extend.

10. **Instances**: `packages/wallet-bridge/src/dispatcher.ts:963-1042` (the whole unguarded write sequence); the throw sites it depends on are `apps/extension/src/wallet/services/dapp-session/service.ts:169-171` (`updateDappSession`), `:228` (`setAccountAliases`), `:239` (`setCapabilityGrants`), `:256` (`setCapabilityRejections`).

---

## Non-findings considered

- `base-client.ts` pending-map / reconnect: `nextRequestId` is a monotonic per-instance counter that is never reset on `disconnect()`/`connect()` (background/client.ts), so no request id is ever reused across a reconnect; `settle()`'s idempotency + map-deletion make late/duplicate responses safe no-ops — no counter-example found for "settles a reused id."
- `background/service.ts` clients array splice-by-indexOf + `sendEvent` fan-out failure not removing the client: the window where a client stays in `this.clients` after a failed `postMessage` is inherently short-lived — Chrome's own `onDisconnect` event for that same Port will still fire asynchronously and splice it out via the existing listener; found no path where a truly-dead client survives permanently in the array.
- Offscreen `ServiceClient` uid routing (`message.to === this.uid`): `uid` is a per-instance `getRandomHex(8)` value generated once in the constructor; found no code path that constructs multiple simultaneously-live instances of the same client class, so no realistic collision/stale-routing scenario after an SW restart (a restart wipes the whole in-memory singleton, it doesn't leave a stale second instance).
- `wallet-sdk/background.ts` `sessionQueues`/`decryptQueues` promise-chain batons: traced both — the value actually stored in each map is always the `.catch(() => {})`-wrapped promise, so a rejected leg never propagates a rejection into the chain the next message's `.then()` awaits; no "one rejected leg breaks the FIFO for all queued successors" scenario found.
- `WindowManager` handles (random `handleId` + `TimerHandle` + `unsubOnRemoved`): traced `_settle`/`_settleUserClose`/`detach` against every call site in `dapp-interaction/service.ts` and `passkey/service.ts` — `detach()` is always immediately followed by a `settle()`/`cancel()` call in every path examined (including the `executeAndResolve` try/catch, which settles or cancels on every exit), and the `settled` flag + map deletion double-guard prevents double-settle even under the documented window-closed-vs-result-posted race.
- `dispatcher.ts` `handleRequestCapabilities`'s catch around the `requestCapabilities()` popup call itself (938-961), persisting rejection records then rethrowing: this specific catch is intentional/documented behavior ("On popup reject/close, persist rejection..."), not itself a bug — see the related but distinct finding above about the *post-success* persistence sequence.
- `DiscoveryQueue.drain()` re-queue-on-`false`: `snapshot.slice(i)` correctly re-includes the just-failed entry (the one whose `processFn` returned `false`), so a wallet-locked-mid-drain does not silently drop the discovery that triggered the abort.

## Quality handoffs

- `apps/extension/src/wallet/services/window-manager/window-manager.ts:103-106`: the `if (!this.handles.has(handleId)) { unsub(); return }` check right after subscribing to `onRemoved` is unreachable dead code — nothing async happens between it and the identical check a few lines above, so `handles` cannot have changed in between.