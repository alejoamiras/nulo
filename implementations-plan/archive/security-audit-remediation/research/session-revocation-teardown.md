# Research: Session revocation teardown (F-006)

## Current disconnect flow

`packages/extension/src/popup/pages/settings/connected-apps/[id].vue:120-127`:
```typescript
const handleDropSession = () => {
  // ... confirm dialog ...
  cacheStore.confirm.callback = async () => {
    await dappSessionService.deleteDappSession(session.value.id)
  }
  popupStore.open("confirm")
}
```

`packages/extension/src/wallet/services/dapp-session/service.ts:274-288`:
```typescript
public async deleteDappSession(sessionId: string): Promise<DappSession> {
  try {
    await this.lock.enter()
    const session = await this.storage.get(sessionId)
    if (!session) throw new Error("Invalid id")
    await this.storage.delete(sessionId)
    this.emit("onDappSessionDeleted", session)
    return session
  } finally { this.lock.leave() }
}
```

**What's torn down**: chrome.storage.local row only.
**What's NOT torn down**: live `ActiveSession` in upstream wallet-sdk's `BackgroundConnectionHandler.activeSessions` Map.

## Upstream `ActiveSession` model

`node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.d.ts:34-51`:
```typescript
export interface ActiveSession {
  sessionId: string;       // = the discovery's requestId
  sharedKey: CryptoKey;
  verificationHash: string;
  tabId: number;
  origin: string;
  appId: string;
  connectedAt: number;
  chainInfo: ChainInfo;
}
```

Storage: `BackgroundConnectionHandler.activeSessions` (private Map, key = sessionId).

**Public termination API**: `handler.terminateSession(sessionId)` at `background_connection_handler.js:200-223`:
```javascript
terminateSession(sessionId) {
  const session = this.activeSessions.get(sessionId);
  if (session) {
    this.transport.sendToTab(session.tabId, {
      type: InternalMessageType.SESSION_DISCONNECTED, sessionId
    });
    this.activeSessions.delete(sessionId);
    this.callbacks.onSessionTerminated?.(sessionId);
  }
}
```

## ⚠️ Critical gap: SessionId not stored in DappSession

The wallet-sdk's `sessionId` = the discovery's `requestId` (generated fresh per discovery). Nulo's `DappSession.id` is a separate 128-bit random hex string. There's **no cross-reference** between them.

To disconnect, Nulo needs to find which `ActiveSession.sessionId` matches the `DappSession` being deleted. Two options:
1. **Add `walletSdkSessionId` to DappSession schema** (cleanest)
2. **Iterate active sessions, match by `(origin, chainId)`** (no schema change, but error-prone if multiple sessions exist)

## `onSessionTerminated` callback wiring

`background.ts:184-187`:
```typescript
onSessionTerminated: (sessionId) => {
  sessionQueues.delete(sessionId)
  decryptQueues.delete(sessionId)
},
```

Fires on:
- Explicit `handler.terminateSession(sessionId)`
- Tab close: `handler.terminateForTab(tabId)` (bg.ts:306)
- Tab origin change: `handler.terminateSession(sessionId)` (bg.ts:315-326)
- Content script DISCONNECT_REQUEST (background_connection_handler.js:68-71)

If Nulo calls `handler.terminateSession()` itself, the upstream handler fires `onSessionTerminated`, and Nulo's cleanup runs. **No additional wiring needed for the cleanup side — only for the trigger side.**

## Enforcement open-when-missing problem

`packages/wallet-bridge/src/dispatcher.ts:735-736`:
```typescript
const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))
if (!dappSession) return [] // ← PERMISSIVE FALLBACK
```

When `dappSession` is missing, `enforceCapability` returns empty grants. Downstream contract: empty grants means no scope-enforcement (line 231: `if (grants.length)`). Method dispatch proceeds; sinks execute unchecked.

## Sinks that still execute when session is missing

For each method:
- `getPrivateEvents`: dispatcher.ts:788-794 → execution/service.ts:1638-1641 — **no session check**
- `getAddressBook`: dispatcher.ts:802 → execution/service.ts:1655-1661 — **no session check**
- `registerSender`: dispatcher.ts:795-801 → execution/service.ts:1650-1653 — **no session check**
- `registerContract`: dispatcher.ts:804-811 → execution/service.ts:1663-1706 — **no session check**
- `getContractMetadata`: dispatcher.ts:786-787 → execution/service.ts:1589-1636 — **no session check**
- `getContractClassMetadata`: dispatcher.ts:785 → execution/service.ts:1578-1587 — **no session check**

## Proposed fix shape

### Fix 1: Tear down live transport on DappSession delete
Two sub-options:
- **1a**: Add `walletSdkSessionId?: string` field to `DappSession`. Stored at discovery-approval time. On delete: call `handler.terminateSession(walletSdkSessionId)`.
- **1b**: Add an `onDappSessionDeleted` listener in `wallet-sdk/background.ts` that iterates active sessions, matches by `(origin, chainId)`, terminates each. No schema change, but iteration is O(n).

**Implementation site for 1a**: `wallet-sdk/background.ts` already handles discovery approval — record the `requestId` (= upstream sessionId) when creating the DappSession.

### Fix 2: Fail-closed on missing session
`dispatcher.ts:735-736` — change `return []` to `throw new Error('Session not found or expired')` for non-exempt methods. Trade-off: dApp code might retry expecting auto-recovery (currently transient missing-session means open-channel succeeds).

### Independence
NOT independent. Fix 1 alone: live channel open, drains only on tab-close. Fix 2 alone: local enforcement closed but channel still drains data. Both needed for complete teardown.

## Stored-session expiry

`DappSession.expiry: number` set at creation to `Date.now() + 7 days` (spec.ts:46, service.ts:131).

Checked at lookup in:
- `getDappSession()` (service.ts:53-62): throws if expired
- `tryGetDappSessionByOriginAndChain()` (service.ts:85-100): filters out expired

`isExpired()` (service.ts:291-307): if expired, deletes session + emits `onDappSessionDeleted`.

So expiry **does** delete + emit. The audit's fix is to make `enforceCapability` fail-closed when session is missing — applies to both delete AND expiry paths.

## Test patterns

`packages/wallet-bridge/src/dispatcher.test.ts` already establishes the pattern with `makeSessionWriter` + `makeDispatcher`:
```typescript
function makeSessionWriter(initial) {
  let session = initial
  return {
    writer: { tryGetDappSessionByOriginAndChain: async () => session, ... },
    setSession: (s) => session = s,
  }
}
```

Test sequence for F-006 fix:
1. Session with grants → method succeeds
2. Set session to undefined (simulate delete) → method **throws** (post-fix) instead of returning result
3. `requestCapabilities` still works (exempt)

## Unresolved ambiguity

**Responsibility boundary**: Is fail-closed enforcement the wallet-bridge's job (in `dispatcher.enforceCapability`) or the wallet's job (in the call sites that consume grants)? Audit marks F-006 as wallet-layer, but `enforceCapability` is in the dispatcher. Decision needed in the plan.

**DappSessionService → BackgroundConnectionHandler reference**: Currently DappSessionService has no handler reference. Either DI refactor or a callback pattern (listener in `wallet-sdk/background.ts` that subscribes to `onDappSessionDeleted` from DappSessionService).
