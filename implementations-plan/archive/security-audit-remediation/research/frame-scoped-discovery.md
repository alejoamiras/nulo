# Research: Frame-scoped discovery (F-001 + F-002)

## Current state

### Nulo wrapper (`packages/extension/src/wallet/services/wallet-sdk/background.ts:118-150`)
- Instantiates `BackgroundConnectionHandler` with two lambdas: `sendToTab` (uses `chrome.tabs.sendMessage(tabId, message)` — no frameId) and `addContentListener` (registers `chrome.runtime.onMessage.addListener` with Zod validation at lines 121-135).
- Passes raw `sender` object to upstream handler at line 133: `listener(message, sender)`.
- Session keying by `(origin, chainId)` tuple at lines 98, 393.

### Upstream attribution bug (F-001 root cause)
Exact location: `node_modules/@aztec/wallet-sdk/src/extension/handlers/background_connection_handler.ts:188`:
```typescript
const tabOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : 'unknown';
```
- `sender.tab.url` = **top-frame URL** (the page the user navigated to)
- `sender.url` = **actual frame URL** (the URL of the frame executing the script)
- For an iframe at `https://evil.com/x.html` inside `https://app.example.com`, `sender.tab.url = https://app.example.com` (gets credited) and `sender.url = https://evil.com/x.html` (the actual sender).

### Upstream `MessageSender` type insufficient
Located at `node_modules/@aztec/wallet-sdk/src/extension/handlers/internal_message_types.ts:61-69`:
```typescript
export interface MessageSender {
  tab?: { id?: number; url?: string; };
}
```
**Missing**: `frameId`, `url`, `origin`. Without these, upstream cannot distinguish subframes.

### Chrome MV3 sender API has the right data
- `sender.frameId` (0 = main frame, >0 = subframe) — definitive classification
- `sender.url` (actual frame URL) — solves F-001 attribution
- `chrome.tabs.sendMessage(tabId, message, { frameId })` — supports frame-targeting → solves F-002

## Possible Nulo-side fixes (no upstream changes)

### 5a. Subframe rejection at listener (CRITICAL, ~1 hour)
Reject `chrome.runtime.onMessage` events where `sender.frameId !== 0`. Closes F-001 by refusing iframe discovery. Trade-off: breaks legitimate iframe-dApp support (if any).

```typescript
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.frameId !== 0 && sender.frameId !== undefined) {
    return undefined // Reject subframes
  }
  // ... existing flow
})
```

### 5b. Local re-attribution (GOOD, ~2 hours)
Before forwarding to upstream, replace `sender.tab.url` with `sender.url || sender.tab?.url` so upstream's broken attribution uses the actual frame URL.

```typescript
const frameSender = { ...sender, tab: { ...sender.tab, url: sender.url || sender.tab?.url } }
listener(message, frameSender)
```

Feasibility: 90% (relies on upstream's contract not changing).

### 5c. Frame-scoped session keying (~3-4 hours)
Extend session key from `(origin, chainId)` to `(origin, chainId, frameId)`. Touches `pendingKey`, `pendingDiscoveryPromises`, `sessionQueues`, plus possibly `DappSessionService` if it consumes these keys.

### 5d. Frame-targeted message broadcast (F-002 mitigation, ~2-3 hours)
Override `sendToTab` so discovery approvals go to ONE frame, not the whole tab. Requires upstream to track `frameId` in `ActiveSession` to know which frame to target — or Nulo monkey-patches based on origin context.

```typescript
sendToTab: (tabId, message, frameId) =>
  chrome.tabs.sendMessage(tabId, message, { frameId: frameId ?? 0 })
```

## What hard requires upstream changes

1. **Upstream `MessageSender` type** should include `frameId?: number`, `url?: string`. (15 min upstream.)
2. **Upstream attribution** at `background_connection_handler.ts:188` should use `sender.url || sender.tab?.url`. (15 min upstream.)
3. **`ActiveSession` should track `frameId: number`** so callbacks receive which frame the session is bound to.
4. **`PendingDiscovery` should expose `frameId`** so Nulo can route responses.

## Recommendation

- **Immediate (Nulo-side defense-in-depth)**: 5a (subframe rejection) IF subframes are not intended → quickest win
- **Or 5b (re-attribution)**: minimal disruption, doesn't break iframe support if any exists
- **Plus 5c (frame-scoped keying)**: closes F-002 sibling hijack
- **Coordinate upstream**: file PR/issue for items 1-4 in parallel

## Test scaffold

Unit test (content-script-validator pattern):
```typescript
test("rejects messages from subframes (frameId > 0)", () => {
  const subframeSender = { frameId: 1, tab: { id: 1, url: "https://victim.com" }, url: "https://evil.com" }
  listener(validMessage, subframeSender)
  // assert: no discovery logged
})
```

Integration test: mock `chrome.runtime.onMessage` + `chrome.tabs.sendMessage`, drive an iframe-vs-top-frame discovery sequence, assert session attribution + send-to-frame routing.
