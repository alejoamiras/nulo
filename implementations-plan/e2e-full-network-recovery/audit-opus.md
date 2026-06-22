# E2E Full Network Recovery — Independent Opus Plan

> Tier A independent plan written **before** reading `plan-main.md`. Formed an opinion from `quarantine.md`, `phase-discovery.md`, `plan-v2.md`, plus first-hand reads of the wallet-bridge dispatcher, the SW wallet-sdk integration, the upstream `@aztec/wallet-sdk` `BackgroundConnectionHandler`, the offscreen lifecycle, and a representative slice of the failing tests. After drafting, compared against `plan-main.md`. Deltas noted below.

## Verdict

**APPROVE-WITH-DELTAS.**

Main plan's *structure* is right (probe-first for A, real fix for B, phased commits, no merge). Where it goes wrong is the **substance** of the probes and the **hypothesis ranking** — main plan hands a list of 6 plausible mechanisms and lets the probes decide. That's defensible but wasteful: there's a *concretely-named* upstream silent-drop site in `@aztec/wallet-sdk` that's almost certainly the culprit, and the probes should be aimed at that surface first. There's also an existing per-session `sessionQueues` head-of-line property on the Nulo side that any probe must accommodate or it'll mis-attribute the hang to the wrong layer.

## Top 10 deltas vs `plan-main.md`

1. **Add probes that main plan missed**: the upstream `handleEncryptedMessage`'s silent `if (!session) return` (background_connection_handler.js:173) and the `decrypt`-catch silent swallow (line 179-181), plus the symmetric pair in `sendResponse` (line 184-198). These are the most likely root cause for cluster A.
2. **Reorder boundary probe set** for cluster A. Main plan's 5 (PG-OUT, WB-IN, BCH-RECV, BCH-SEND, PG-IN) skip the upstream SDK layer entirely. Add **BCH-DECRYPT-IN/OUT** + **BCH-SEND-WIRE** before any others.
3. **Drop the SW liveness 5s heartbeat probe (A.5)**. `nulo:liveness` is already written every 10s; instrumenting on top adds noise. Instead, add a **SW-LIFECYCLE** probe — log on `chrome.runtime.onStartup`, `onSuspend`, `onSuspendCanceled` — to distinguish "SW was idle and restarted" from "SW never went down".
4. **Reframe hypothesis ranking** — top hypothesis is `activeSessions` map loss on SW restart, NOT the dispatcher hanging. The dispatcher path is straightforward to probe but is unlikely to be the bug given that connect-handshake (which exercises the same path twice) succeeds.
5. **Cluster B real-fix candidate**: PXE pre-warm at offscreen-iframe load (network-agnostic), not on first switch. Main plan lists this as one of three options; my plan ranks it #1 with rationale.
6. **Re-enable quarantined files INCREMENTALLY during cluster A/B fix, not all at the end.** Specifically, un-quarantine `data-registerSender` immediately after cluster A probe-and-fix lands, because it's the cleanest single-RPC repro of the cluster. Same for `fee-methods` after cluster B.
7. **Phase 0 (probe-add commit) AND a baseline-with-probes "no-fix" full e2e:agent run** before the fix phase. Main plan jumps from probe-add to single-test repros; we want a wide signal of "which tests hit which probe boundaries" to confirm the cluster mapping is what we think it is.
8. **Strip-probes mechanism**: don't grep for `[PROBE:CLA:*]` literals (main plan's mitigation). Instead, gate ALL probes on `import.meta.env.MODE === "test"` OR a Vite `define("__NULO_E2E_PROBE__", false)` constant. Tree-shaking will dead-code-eliminate them. Main plan does suggest a Vite define for the env switch but doesn't apply it consistently across packages and forgets the playground side.
9. **Adversarial test cases**: main plan suggests adding 2 new e2e tests as post-fix coverage. Defer these. Adding new tests now is non-goal scope and increases the surface to debug. File them as a follow-up `e2e-coverage-hardening` plan.
10. **Phase ordering**: keep main's A→H but split D into D1 (apply fix), D2 (write a wallet-bridge unit test pinning the fix), D3 (re-run probe to confirm probe says fixed before stripping). Main plan's "single-test repro" requirement covers D1+D2 but doesn't gate on D3, so we'd ship a fix with no proof the probes still tell us the truth.

---

## 1. Context

This continues the work tracked in `implementations-plan/e2e-network-recovery/`. PR #46 (`fix/e2e-network-suite-recovery`, draft) restored the network suite from silent pass-by-skip to executing-with-real-failures. Current state per `quarantine.md`:

```
Test Files  29 failed | 12 passed | 4 skipped (45)
Tests       36 failed | 17 passed | 8 skipped (61)
```

Cluster headline (verbatim from `quarantine.md`):
- **A** (~22 files): `waitForPgResult` 30s timeout on 2nd+ dApp RPC after connect handshake works.
- **B** (4 files): first `switchToLocalNetwork` takes ~30s; subsequent ones fast.
- **C** (1 file): `send-amount-clamp` cascade victim of A/B.
- **D** (1 test): `session-reconnect (alwaysTrust=false)` flake at 71s with retry x1.

Quarantined: `data-registerSender`, `connect-locked-queue`, `fee-methods`, `token-management`.

**Non-goal**: any change to the popup-side fixes (F1/F2/F3 from `network-test-triage`). Those landed on `dev`. They don't address the current dApp-side failures.

## 2. Goal

`bun run e2e:agent` exits 0 with 61/61 passing AND the 4 quarantined files re-enabled (so 65+ tests in total). Smoke (`bun run test:e2e`) stays green. No new dependencies, no upstream `@aztec/wallet-sdk` fork (we work around upstream silent-drops with local probes + retries, not by patching upstream).

## 3. Top hypotheses (ranked, with code-level justification)

### H1 — Upstream `BackgroundConnectionHandler.activeSessions` is in-memory only, lost on SW restart [HIGHEST]

**Surface**: `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:171-181`:

```js
async handleEncryptedMessage(sessionId, encrypted) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
        return;                                          // ← silent drop
    }
    try {
        const message = await decrypt(session.sharedKey, encrypted);
        this.callbacks.onWalletMessage?.(session, message);
    } catch {
        // Decryption failed - ignore malformed message  ← silent swallow
    }
}
```

And the symmetric `sendResponse` at line 183-198. Both *silently return* on missing session, both *silently swallow* crypto errors.

**Why this is the top suspect**:
- The connect handshake exercises the discovery+key-exchange path (NOT encrypted, INTERNAL_KEY_EXCHANGE messages), which populates `activeSessions` (line 153). The 2nd RPC uses the encrypted path which depends on `activeSessions.get(sessionId)`. If `activeSessions` is empty (SW restarted) the message is silently dropped → playground hangs at 30s.
- MV3 SWs idle out after 30s of no events. Between handshake and 2nd RPC the dApp-side e2e harness can have a quiet ~10s window (popup waits, capability popup approval, etc.). If we go over the threshold, SW restarts, `initWalletSdkHandler` re-runs, but `activeSessions` starts empty.
- The Nulo `nulo:liveness` heartbeat at `runtime.ts:186-190` is a 10s `setInterval`. `setInterval` *does NOT keep MV3 SWs alive*. Only Chrome events do. `chrome.storage.session.set` *can* keep it alive (each call extends life by ~30s), but only if the heartbeat itself actually fires before idle. If `setInterval` is missed during idle (it is — `setInterval` doesn't restart timers across SW restarts), the SW can suspend.
- Specifically: at line 186 we register `clock.setInterval(...)` AFTER `services.start()`. If SW restarts, the interval handle is lost. The first liveness write (line 181) fires once on cold boot; the next would be at +10s, but that interval is dead-on-restart.

**Falsifiable predictions** (what probes will show):
- A probe at `BCH-DECRYPT-IN` will log the inbound 2nd-RPC message. A probe at `BCH-SESSION-LOOKUP-MISS` (added inside the monkey-patched `handleEncryptedMessage`) will fire when `activeSessions.get(sessionId)` returns undefined. If H1 is right, every cluster-A failure ends with `BCH-SESSION-LOOKUP-MISS` (and never reaches `BCH-DECRYPT-OUT`).
- A `SW-LIFECYCLE` probe will show `onStartup` events between handshake and 2nd RPC for cluster-A failures.

### H2 — `sessionQueues` head-of-line block from a single in-flight dispatch [SECOND]

**Surface**: `packages/extension/src/wallet/services/wallet-sdk/background.ts:181-189`:

```ts
onWalletMessage: (session, message) => {
    const key = session.sessionId
    const prev = sessionQueues.get(key) ?? Promise.resolve()
    const next = prev.then(() => handleWalletMessage(session, message, handler, dispatcher, profileService, logger))
    sessionQueues.set(key, next.catch(() => {}))
}
```

If the 1st `handleWalletMessage` (e.g. an early implicit `getAccounts` probe from the wallet-sdk during ECDH setup) hangs *inside* dispatcher, the 2nd message's `.then()` never fires. Result: 2nd RPC's onWalletMessage queues but never runs.

**Why second**: this is structurally a hang the user would see exactly as "handshake works, 2nd RPC hangs", but the `dispatcher.dispatch` path is straightforward (most flows return in ms) — the obvious hang sources (popup, PXE) are method-specific and *don't* apply to bytecode-trivial methods like `getChainInfo`, yet `meta-getChainInfo` is in cluster A. So while H2 is real, it doesn't fit *all* of A.

### H3 — Decryption queue (`decryptQueues` monkey-patch) ordering bug [THIRD]

**Surface**: `background.ts:202-213`:

```ts
const origDecrypt = (handler as any).handleEncryptedMessage.bind(handler)
const decryptQueues = new Map<string, Promise<void>>()
;(handler as any).handleEncryptedMessage = async (sessionId: string, encrypted: unknown) => {
    const prev = decryptQueues.get(sessionId) ?? Promise.resolve()
    const next = prev.then(() => origDecrypt(sessionId, encrypted))
    decryptQueues.set(sessionId, next.catch(() => {}))
    return next
}
```

If `origDecrypt` ever throws *outside* its own internal try/catch (e.g. before reaching the decrypt() call — say on `activeSessions.get(sessionId)` returning undefined in upstream code), then `next` rejects, and the catch in `next.catch(() => {})` swallows it. The Promise returned to caller (`return next`) is the rejected one — but the stash in `decryptQueues` is the catch-wrapped one. Subsequent messages chain off the catch-wrapped promise (which IS resolved) — so this works correctly. No bug here.

I included this in the probe set because if H2's head-of-line block exists, it could be in `decryptQueues` rather than `sessionQueues` — the probes at BCH-DECRYPT-IN/OUT will catch either.

---

## 4. Probe placements (cluster A) — concrete file + line refs

All probes gated on a Vite `define("__NULO_E2E_PROBE__", false)` constant; CI's `bun run e2e:agent` flips it to `true` via `scripts/e2e/agent.sh`. Probes emit through a single `probe(boundary, payload)` function that branches on the define so production tree-shakes them out.

| Probe | File | Line | Payload |
|---|---|---|---|
| **PG-OUT** | `packages/playground/src/lib/wallet.ts` | before line 128 (`wallet.requestCapabilities(...)`) AND before line 90 (`pending.confirm()`) AND inside `extractGrantedAccounts` post-result | `{ method, t }` |
| **PG-IN** | `packages/playground/src/lib/log.ts` | inside `logCall`, before `settleResult(...)` at line 15 (success) and line 18 (error) | `{ method, status, t, elapsedMs }` |
| **CS-RECV** | `packages/extension/src/content-script/content.ts` | inside `ContentScriptConnectionHandler.start`'s listener (need to wrap upstream — see §4.1) | `{ direction: 'page→sw' | 'sw→page', type, t }` |
| **BCH-RAW-IN** | `packages/extension/src/wallet/services/wallet-sdk/background.ts` | inside the `addContentListener` wrapper at line 112-128, before `listener(message, sender)` | `{ type: message.type, sessionId?, t }` |
| **BCH-DECRYPT-IN** | `packages/extension/src/wallet/services/wallet-sdk/background.ts` | inside the monkey-patch at line 205, BEFORE the prev.then() chain (so every entry is logged) | `{ sessionId, t, queueDepth: decryptQueues.size }` |
| **BCH-SESSION-LOOKUP-MISS** | `packages/extension/src/wallet/services/wallet-sdk/background.ts` | wrap `origDecrypt` so we can intercept the upstream `activeSessions.get(sessionId)` result. Cleanest way: before calling origDecrypt at line 207, log whether `(handler as any).activeSessions.has(sessionId)` is true. | `{ sessionId, found, activeCount, t }` |
| **BCH-DECRYPT-OUT** | same file, after `origDecrypt` resolves in line 207 | `{ sessionId, elapsedMs, t }` |
| **WB-IN** | `packages/wallet-bridge/src/dispatcher.ts` | dispatch method line 220, immediately after entry | `{ method: methodName, t }` |
| **WB-OUT** | `packages/wallet-bridge/src/dispatcher.ts` | wrap the body in a try/finally so we log both success and throw paths at line 253 | `{ method, status, elapsedMs, t }` |
| **EXEC-IN** | `packages/extension/src/wallet/services/execution/service.ts` | inside `executeOperations` at line 866, after `ensureInitialized()` | `{ kind: operation.kind, t }` |
| **EXEC-OUT** | same, end of for-loop body at line 999 (just before push) | `{ kind, status, elapsedMs, t }` |
| **BCH-SEND-WIRE** | `packages/extension/src/wallet/services/wallet-sdk/background.ts` | wrap `handler.sendResponse` at line 477 in a try around the `try { await handler.sendResponse(...) }`. ALSO log whether `(handler as any).activeSessions.has(sessionId)` immediately before to detect session loss between dispatch entry and response send. | `{ sessionId, found, messageId, t }` |
| **SW-LIFECYCLE** | `packages/extension/src/wallet/index.ts` | add a single `chrome.runtime.onStartup.addListener(() => probe('SW-LIFECYCLE', { event: 'onStartup', t: Date.now() }))` AND `chrome.runtime.onSuspend.addListener(...)` AND `onSuspendCanceled` | `{ event, t }` |

**Total: 9 distinct boundary marks** (some emitted at multiple call sites). Net commit: ~120 lines of probe code, all behind one constant.

### 4.1 Why I'm dropping main plan's SW-ALIVE setInterval (A.5)

`runtime.ts:186-190`'s `clock.setInterval(...)` already writes `nulo:liveness` every 10s. Adding another `setInterval` for probes does nothing extra to keep the SW alive (setInterval doesn't keep SWs alive), and it adds noise. SW-LIFECYCLE is the right signal — `chrome.runtime.onStartup` fires *only* when the SW boots after being suspended, which is the exact event we care about for H1.

### 4.2 How to log from inside the content script

`packages/extension/src/content-script/content.ts:11-20` instantiates the upstream `ContentScriptConnectionHandler`. We can wrap its `sendToBackground` and `addBackgroundListener` callbacks to log the relayed payload's `type` field. That's enough to see whether a page→SW or SW→page message is being lost in the relay (rare but possible — would falsify H1).

---

## 5. Probe placements (cluster B) — concrete file + line refs

| Probe | File | Line | Payload |
|---|---|---|---|
| **OFFSCREEN-MODULE-LOAD** | `packages/extension/src/offscreen/index.ts` | line 1 (very top, before any import) | `{ t }` |
| **OFFSCREEN-INIT-START** | same file | line 51 (before `createPxeOffscreen(...)`) | `{ t }` |
| **OFFSCREEN-INIT-DONE** | same file | line 56 (after createPxeOffscreen resolves) | `{ elapsedMs, t }` |
| **PXE-CREATE-START** | `packages/aztec-runtime/src/pxe/chain-runtime.ts` | line 75 (inside `createChainRuntime`, before `createPXE(...)`) | `{ chainId, profileId, t }` |
| **PXE-CREATE-DONE** | same file | line 93 (after createPXE resolves) | `{ chainId, elapsedMs, t }` |
| **REGISTRY-GETORINIT** | `packages/aztec-runtime/src/pxe/chain-runtime.ts` | line 129 (top of `getOrInit`) | `{ chainId, cached: !!existing, t }` |
| **NETWORK-SWITCH-START** | `packages/extension/src/wallet/services/network/service.ts` | find the `setActiveNetwork` method (need to grep — not yet read) and probe at entry | `{ chainId, t }` |
| **NETWORK-SWITCH-DONE** | same file | end of `setActiveNetwork` | `{ chainId, elapsedMs, t }` |
| **POPUP-NETWORK-WATCHER** | `packages/extension/src/popup/app.vue` | line 131 (network watcher entry) | `{ chainId, t }` |

The key data we want is: when does PXE-CREATE-START fire on first switch vs. subsequent? And is OFFSCREEN-MODULE-LOAD already done by the time NETWORK-SWITCH-START fires (i.e. is the offscreen iframe already created)?

**My strong prior**: the offscreen iframe is NOT created until first PXE call (see `PxeServiceClient.onReady` → `ensureOffscreenRunning` in `pxe/client.ts:14-18`). So on first `switchToLocalNetwork`, the sequence is:
1. User clicks Local Network in popup
2. SW handler emits `onActiveNetworkChanged`
3. Popup's network watcher re-fetches accounts via `accountService` (no PXE needed)
4. **(maybe)** something triggers a PXE op via the watcher — e.g. `accountStateService.getSenders` — which calls `PxeServiceClient.request` → `onReady` → `ensureOffscreenRunning` → first-time iframe load + bb.wasm + WASMSimulator + createPXE

Step 4's `createPXE` itself can take ~15s on cold IndexedDB (the comment at `runtime.ts:174-176` says exactly this for popup loading: "the wallet's argon2 KDF unlock + bb.js wasm boot can spike CDP latency past 3 minutes on cold first run"). Plus the offscreen iframe load itself, the OFFSCREEN_READY handshake (`READY_TIMEOUT_MS = 10_000` at `offscreen.ts:12`), plus the `simulator = new WASMSimulator()` instantiation + `createPXE(node, config, ...)`.

If this is right, the 30s is the *expected* cold-cache PXE init time. Real fix: pre-warm.

---

## 6. Cluster B real-fix candidates (ranked)

### F-B1 — Pre-create the offscreen iframe at SW boot (PXE-agnostic) [TOP PICK]

**Change**: at the end of `createWalletRuntime.start()` (`packages/extension/src/wallet/runtime.ts:191`), kick off `ensureOffscreenRunning()` as fire-and-forget. The offscreen iframe loads → its `index.ts` imports `createPxeOffscreen` → that imports `@aztec/bb.js` + `@aztec/simulator/client` + the noir-noirc_abi/acvm_js modules. The expensive part is the import graph, NOT the actual `createPXE(node, config)` call. After bootstrap the offscreen sits with `WASMSimulator` warm and ready.

**Why this works**: `createPXE` for a specific (profileId, chainId) is still lazy (done on first network-touching call). But the *cold-cache JS/WASM cost* is paid once on SW boot, not on first user network-switch. A first-switch then triggers `createPXE` against a warm import graph in 2-3s instead of 30s.

**Why this is the right level**: privacy-preserving — no network RPC happens, no PXE instance for any chain. The offscreen just has the *modules* loaded. We don't leak any account address or chainId to any RPC provider.

**Risk**: bb.js wasm init is heavy. Doing it at SW boot extends boot time. But `runtime.ts:93-98` already runs `BarretenbergSync.initSingleton` in parallel with config.load() at SW boot, so this concern is partly already accepted.

**Estimated impact**: 30s first-switch → ~3s first-switch.

### F-B2 — Pre-create PXE for the user's *currently active* network at SW boot

**Change**: after `initWalletSdkHandler`, dispatch a fire-and-forget PXE op for the user's persisted active-network (e.g. `getRegisteredAccounts` — read-only, no network RPC necessary because PXE serves from local IDB).

**Why second**: more work than F-B1 because we need to teach the SW about what "the user's active network" is at boot time (read `nulo:core:active-network@<profileId>` from storage). Also runs PXE op for an unspecified network — fine for active network, but feels overreach-y if there are multiple profiles.

**Risk**: if user has never used the wallet on the active network, this creates an empty PXE IndexedDB. Mostly harmless.

### F-B3 — Move `ensureOffscreenRunning` to popup `onMounted`

**Change**: in `packages/extension/src/popup/app.vue` (around the `initNetworks` / `initAccount` flow), call `ensureOffscreenRunning` early so by the time the user clicks a network-switch, the offscreen is up.

**Why third**: only fixes the case where the popup is open before the switch. Doesn't help dApp-initiated PXE-touching calls (e.g. registerSender from a dApp) when no popup has been opened.

I recommend **F-B1 alone**. If probes reveal that `createPXE` (not the import graph) is the dominant cost, escalate to F-B1 + F-B2.

---

## 7. Quarantined-file re-enable order

Main plan's "all at end" approach is too coarse. Better:

| File | After | Rationale |
|---|---|---|
| `data-registerSender.test.ts` | Cluster A fix lands + 1 probe re-confirmation run | Single dApp RPC. Cleanest single-test repro of cluster A — re-enabling early gives us a fast iteration loop for the fix. |
| `connect-locked-queue.test.ts` | Cluster A fix lands | Same surface as A. The skip reason in the file (`90s timeout`) suggests it's a queue-drain timing issue specific to the locked path, not just cluster A. Worth a separate look. |
| `fee-methods.test.ts` | Cluster B fix lands + 1 confirmation run | Uses `feeJuiceImportedExtension` which calls switchToLocalNetwork. Pure B cascade. |
| `token-management.test.ts` | After A AND B both land | Uses `tokenReadyExtension`. Mixed cascade — switchToLocalNetwork + importToken which crosses both clusters. |

**Phase G in my plan**: weave these in at the right point, not at the end. This is a behavior delta from main plan.

---

## 8. Adversarial review (REQUIRED)

### 8.1 Probe leakage

**Threat**: probes shipped to prod leak internal method names, sessionIds, chainIds, account addresses, queue depths. An attacker reading the browser console (or an attacker via a malicious co-installed extension's `chrome.devtools` access) can see protocol internals.

**Mitigation**:
- All probe call-sites read a single constant `__NULO_E2E_PROBE__` defined via Vite's `define` plugin. Default: `false`. Vite tree-shakes the call-sites.
- Hard verification: a CI step that runs `bun run --cwd packages/extension build && grep -c 'NULO_E2E_PROBE\\|\\[PROBE:' dist/chrome/**/*.js` — must return zero.
- Probe payloads NEVER include: account addresses, balances, raw RPC args, raw cleartext / ciphertext bytes. Only: method name, sessionId (UUID, not address-derived), timestamp, elapsed-ms, status, queue depth, boundary name.

### 8.2 SW keepalive scope creep

**Threat**: if H1 is right and the fix involves keeping the SW alive longer, an over-broad fix pins the SW alive while no dApp is connected. This extends the window in which capability grants live in memory (not on disk by design for any data we sanitize, but RAM-resident dApp session keys would persist longer). A local-attacker-with-RAM-access model (rare for an end user but real for shared-device or forensics scenarios) gets a bigger window.

**Mitigation**:
- Keepalive must be **scoped to active dApp sessions** (`handler.getActiveSessions().length > 0`). When all sessions terminate (`onSessionTerminated`), stop the keepalive.
- Use `chrome.alarms.create` with `periodInMinutes: 0.4` (24s — under the 30s SW idle threshold) rather than `setInterval` (which doesn't keep SWs alive anyway). `chrome.alarms` IS one of the events that keeps an SW alive.
- Document explicitly: the keepalive is for the duration of active dApp connections only. It's not a global "always-on SW" pattern.

### 8.3 Real fix for H1 — `activeSessions` restoration

The cleanest fix if H1 is confirmed:

**Option A** (preferred): When the SW restarts and an encrypted message arrives for an unknown sessionId, send back a structured `SESSION_DISCONNECTED` message to the dApp. The dApp's `@aztec/wallet-sdk` already handles this (via `InternalMessageType.SESSION_DISCONNECTED`). The dApp's e2e fixture would then re-discover and re-connect. This requires adding a small intercept around `handleEncryptedMessage`:

```ts
;(handler as any).handleEncryptedMessage = async (sessionId, encrypted) => {
    if (!(handler as any).activeSessions.has(sessionId)) {
        // SW restarted: tell the dApp to reconnect rather than silently dropping
        const tabId = inferTabId(encrypted) // need to extract from envelope
        if (tabId !== undefined) {
            chrome.tabs.sendMessage(tabId, {
                origin: 'BACKGROUND',
                type: 'SESSION_DISCONNECTED',
                sessionId,
            })
        }
        return
    }
    return origDecrypt(sessionId, encrypted)
}
```

The dApp side handles `SESSION_DISCONNECTED` by status-flipping and re-running discovery. e2e fixtures need to be aware — for `dappConnectedExtension`, a SESSION_DISCONNECTED arrival should auto re-trigger `connectPlayground()`. Test code stays clean; fixture handles the resilience.

**Option B**: Persist `activeSessions` to chrome.storage.session (cleared on browser close — appropriate lifetime for an SW-process-bound session key). On SW boot, rehydrate. **REJECTED** — `sharedKey` is the ECDH-derived AES key. Writing AES keys to `chrome.storage.session` puts them on disk-IPC channels (per Chrome's storage backing). Even though `storage.session` clears on browser close, this is sensitive material; the wire contract expected the key to live in SW memory only. Persisting it is a regression in the security model unless we encrypt it under the user's password — which adds a sync round-trip on every wake.

**Option C** (workaround): keep SW alive while at least one dApp session is active (per §8.2). **Preferred mitigation for cluster A** because it doesn't change the wire protocol, doesn't touch upstream `@aztec/wallet-sdk`, and matches the existing "long-lived dApp session" design intent.

### 8.4 PXE pre-warm privacy leak

**Threat**: F-B1 (pre-warm offscreen modules at SW boot) doesn't talk to any network RPC. Confirmed safe — no privacy leak. F-B2 (pre-create PXE for active network) creates an in-memory PXE bound to user's profileId + chainId; PXE doesn't auto-sync without an op being called against it, so still no leak. F-B3 (popup-side) is same as F-B2 timing-wise.

But: if a future maintainer reads "pre-warm PXE" and decides to *also* kick off a background sync (`getSyncedBlockHeader` or similar), they'd inadvertently leak the user's active-network choice to the RPC provider on every SW boot. **Mitigation**: add a code comment at the pre-warm site: `// DO NOT add network-touching ops here — see audit-opus.md §8.4`.

### 8.5 Cluster B "real fix" attack surface

**Threat**: pre-warming bb.js + simulator import graph at SW boot means an attacker who can OOM the SW (e.g. by causing many concurrent crypto ops) can crash it during a sensitive flow. Today, OOM-during-cold-init is unlikely because the SW is barely doing anything. Pre-warm moves the OOM window earlier and possibly into more sensitive flows (unlock, account creation).

**Mitigation**: keep pre-warm fire-and-forget. If it OOMs, the main service graph survives. If it succeeds, subsequent PXE-touching calls are faster. We don't AWAIT the pre-warm anywhere on a critical path.

### 8.6 Supply chain

No new deps. The Bun patches for `@aztec/noir-noirc_abi` + `@aztec/noir-acvm_js` (already on this branch) stay. `bun audit` advisory output is the same as PR #46's baseline.

### 8.7 Test-only code in production

The `E2E_REQUIRE_SETUP=1` env gate (added in this branch) only affects the test harness's exit code. Probes (this plan) gate on Vite `define` constants that compile-time eliminate. No test-only code paths ship to prod.

---

## 9. Phase plan

### Phase A — Cluster A diagnostic probes

Add `__NULO_E2E_PROBE__` Vite define (across `extension`, `wallet-bridge`, `playground`). Wire all probes from §4. Single commit: `test(e2e): add cluster A diagnostic probes (gated)`.

**Validation gate**: `bun run lint` + `bun run --cwd packages/extension build` still passes; probe build flag off by default.

### Phase B — Cluster B diagnostic probes

Add the §5 probes. Single commit: `test(e2e): add cluster B PXE-init probes`.

### Phase C — Probe-run + findings

Three runs:
1. **Full e2e:agent with probes on** — captures cluster A/B/C/D probe traces on every failing test. Faster than per-test if we want to confirm clustering. Saves to `/tmp/e2e-probe-baseline-$$.log`.
2. **Per-test isolated repros**: `meta-getChainInfo.test.ts`, `cap-request-basic.test.ts`, `sim-methods.test.ts` (the cluster-A samplers) AND `networks.test.ts` (cluster B).
3. **One run with HEADLESS=0** at the local machine if findings are ambiguous — visual confirmation of popup state.

Save findings to `implementations-plan/e2e-full-network-recovery/findings.md`. **Approval gate before Phase D**: present findings to user, get confirmation that H1 (or whichever hypothesis the data supports) is the right one to act on.

### Phase D — Cluster A fix

D1: apply the fix (likely Option C from §8.3 — chrome.alarms-based keepalive scoped to active sessions). New file: `packages/extension/src/wallet/services/wallet-sdk/sw-keepalive.ts`. Hook into `onSessionEstablished` / `onSessionTerminated` to start/stop the alarm.

D2: write a wallet-bridge or extension unit test that:
- Mocks the BackgroundConnectionHandler's `activeSessions` map
- Sends a wallet message
- Expects either a re-discovery prompt OR the keepalive to be active

D3: re-run the cluster-A samplers with probes still on. Confirm `BCH-SESSION-LOOKUP-MISS` no longer fires. If it does, fix is incomplete.

### Phase E — Cluster B fix

Apply F-B1 (pre-warm offscreen at SW boot). Single commit: `feat(wallet): pre-warm offscreen at SW boot to avoid 30s first-switch latency`.

Validation: cluster-B sampler (`networks.test.ts`) passes in <10s on first switch. PXE-CREATE-DONE probe shows <3s.

### Phase F — Cluster C + D

C: re-run `send-amount-clamp.test.ts` after A+B. If it passes, no work. If it fails, probe the specific failing assertion.

D: `session-reconnect (alwaysTrust=false)`. The `alwaysTrust` semantic in `wallet-sdk` controls whether the session can resume without re-verification. The test asserts a specific re-verify flow. Read the test + the SW's session-resumption code path (`pendingVerification` in `background.ts:76-90`, line 153-174). If it's a real bug, fix; otherwise add to known-flake list and accept the retry-x1.

### Phase G — Re-enable quarantined files (incremental)

Weave into D and E (per §7). Each file unquarantined gets its own commit: `test(e2e): re-enable <filename>`.

### Phase H — Strip probes + full validation

- Single commit: `test(e2e): remove diagnostic probes`. Drop the `__NULO_E2E_PROBE__` define + every probe call-site.
- Three back-to-back full e2e:agent runs. Target: 61/61 in 2 of 3, plus 4 quarantined re-enabled (so 65 tests effectively).
- Add the verification grep step to CI: `grep -c '__NULO_E2E_PROBE__\\|\\[PROBE:' dist/chrome/**/*.js` must be zero.
- Update PR #46 body with: final test counts, cluster breakdown, links to findings.md.

### Phase ordering ASCII

```
[ ] A — probes for cluster A           (commit)
[ ] B — probes for cluster B           (commit)
[ ] C — run + findings.md              (no commit, doc commit at H)
[ ] D — cluster A fix                  (D1 commit, D2 unit test commit, D3 re-run no commit)
[ ] G.1 — re-enable data-registerSender (commit)
[ ] G.2 — re-enable connect-locked-queue (commit)
[ ] E — cluster B fix                  (commit)
[ ] G.3 — re-enable fee-methods         (commit)
[ ] F — cluster C/D investigation       (commit if fix needed)
[ ] G.4 — re-enable token-management    (commit)
[ ] H — strip probes, validation, PR update
```

---

## 10. What `plan-main.md` got wrong (concrete)

### 10.1 §4 probe list misses the upstream silent-drop site

**Main plan says**: 5 boundaries — PG-OUT, WB-IN, BCH-RECV, BCH-SEND, PG-IN.

**Problem**: `BCH-RECV` = "the SW connection handler receives `WalletMessage` events" (main plan, §A.3). But `WalletMessage` only arrives in `onWalletMessage` AFTER successful decrypt. The silent-drop sites (`if (!session) return` at `node_modules/@aztec/wallet-sdk/dest/extension/handlers/background_connection_handler.js:173` and the decrypt-catch at line 179) are *before* `onWalletMessage` fires. If those drop a message, `BCH-RECV` never fires — main plan's probes can't distinguish "SW received nothing" from "SW received and silently dropped". My BCH-DECRYPT-IN + BCH-SESSION-LOOKUP-MISS probes do.

### 10.2 §6 hypothesis ranking is unranked

**Main plan says**: 6 hypotheses listed as equally plausible at §7's D.1-D.5.

**Problem**: connect-handshake.test.ts in `connect-dapp.test.ts:19-38` passes — it exercises the full discovery + KEX + verify flow. So whatever's broken in cluster A is specifically broken *after* the handshake succeeds, in the encrypted message path. That eliminates D.1 (SW idle between handshake + 2nd RPC — but this happens in the very test that succeeds, weakly), D.4 (postMessage drops — same shape as D.1), and the broad "session lifetime extension" of D.5. The ranking should be H1 (activeSessions loss on SW restart) > H2 (sessionQueues HOL block) > others. Codex will likely converge on a similar ranking once they read the upstream SDK.

### 10.3 §10 quarantined-file re-enable is "all at end"

**Main plan says**: "Phase G — Re-enable 4 quarantined files. Each in isolation."

**Problem**: by deferring all four to after probe-fix, we lose feedback during the fix iterations. `data-registerSender.test.ts` is literally the simplest dApp-side cluster-A repro (single registerSender RPC after connect). Re-enabling it AS PART OF cluster-A fix iteration means each fix attempt is validated against the simplest possible repro. My plan re-enables incrementally — adds 0 extra work and gives a 1-test repro for cluster A during fix iteration.

### 10.4 §13.1 probe leakage mitigation is grep-only

**Main plan says**: "a pre-merge check — `grep -r "PROBE:CLA:" packages/extension/src` must return zero."

**Problem**: this catches the probe string *in source* but not in the built bundle. The probe `define` constant might be the source guard but if a maintainer accidentally hard-codes `console.log("[PROBE:CLA:...]", ...)` instead of using the probe helper, grep against source flags it — but the bundle could still ship it. The bundle-grep is the actually-secure check. Add: `grep -c 'PROBE:CLA' packages/extension/dist/chrome/**/*.js` must be 0 in CI.

### 10.5 §14.1 says "wherever the SW entry is — confirm"

**Main plan says**: `packages/extension/src/wallet/background/main.ts` (or wherever SW entry is)`.

**Reality**: The SW entry is `packages/extension/src/wallet/index.ts`. Manifest's `service_worker` points there. The `runtime.ts` composition-root is what `index.ts` invokes. Main plan's vague "or wherever" tells me the agent didn't trace it. Confirmed by reading the manifest + index.ts at line 71-83.

### 10.6 §15 Open Question #3 already has an answer

**Main plan asks**: "PXE init timing — is it eager (on offscreen-iframe load) or lazy (on first PXE call)?"

**Answer**: it's LAZY at TWO LEVELS:
- (1) `PxeServiceClient.onReady` in `packages/extension/src/wallet/services/pxe/client.ts:16-18` calls `ensureOffscreenRunning()` only on first request → offscreen iframe doesn't exist until first PXE RPC.
- (2) Once the offscreen iframe is up, `createPxeOffscreen` initializes the service framework; the actual `createPXE(node, config)` for a specific (profileId, chainId) is lazy inside `ChainRuntimeRegistry.getOrInit` (`packages/aztec-runtime/src/pxe/chain-runtime.ts:129-156`).

So first-switchToLocalNetwork has to wait for: iframe creation + iframe-module-imports (bb.wasm, simulator wasm, noir-noirc_abi, noir-acvm_js) + createPxeOffscreen service-graph init + `createPXE` for the specific chain. The first three are 1-time per SW lifecycle; the last is once per (profile, chain). Hence "first switch slow, subsequent fast". Codex will likely reach the same conclusion.

### 10.7 §17 phase ordering has no commit-frequency guidance

**Main plan says**: list of `[ ]` phases without commit count per phase.

**Problem**: this branch is supposed to land as ONE PR with phased commits. Without commit guidance, an implementer doesn't know whether to batch all probes in one commit or split. My plan §9 specifies the commits per phase.

### 10.8 §13.4 cites a non-issue

**Main plan says**: "if Phase D.5 lands (channel session lifetime extension), we extend the window for replay attacks against the encrypted channel."

**Problem**: D.5 was speculative. The actual fix (per §8.3, Option C) doesn't extend the channel session lifetime — it keeps the SW alive so the existing in-memory session stays valid. The crypto session lifetime is determined by the wallet-sdk's own AES-GCM nonce/IV scheme + the session's logical lifetime, both unchanged.

---

## 11. Open questions before approval

1. **H1 confirmation**: should I prepare an Option-C-style fix (SW keepalive scoped to dApp sessions) *speculatively* during Phase D, OR strictly wait for Phase C findings? My recommendation: prep the implementation file in a branch but DO NOT land it until probes confirm. Otherwise we ship a defensive fix for the wrong cause.
2. **PXE pre-warm at SW boot** (F-B1): this adds bb.wasm + simulator wasm load to every SW cold-start. Worst case ~10s of CPU on weak hardware. Acceptable? The trade-off is: cold start slower; first-switch faster (the user-visible perf win). For dApp-heavy users this is huge. For users who never connect a dApp, this is an extra ~10s tax once per SW lifecycle.
3. **`connect-locked-queue.test.ts` original skip reason**: the file's TODO comment at line 18 says "discovery queue drain timing is brittle (90s timeout); needs a deterministic 'queued' signal from the extension before unlock". That's a different bug than cluster A. Should I treat it as a separate cluster D-bis with its own fix, or roll it into the cluster A fix? My recommendation: separate. Probe it with the same probe set in Phase A, but treat as its own surface.
4. **F-B1 OOM risk**: are we comfortable with bb.wasm + simulator wasm at SW boot? Or should F-B1 be feature-flagged so it can be reverted in prod if SW boot times regress on weak hardware?
5. **Probe gate constant name**: `__NULO_E2E_PROBE__` is global-scope-y. Alternative: per-package constants (`__NULO_EXT_E2E_PROBE__`, `__NULO_PG_E2E_PROBE__`). Per-package is safer (one stuck-on constant can't enable across the whole codebase) but more verbose. Vote: per-package.
6. **CI bundle-grep**: where does it live? My recommendation: a new step in the `Network e2e / Status` workflow that runs after `bun run build` and before any test, fail-fast on any `PROBE:` string in dist/. Reusable for future probe campaigns.

---

## 12. Done definition

Same as main plan's §18 with two additions:
- The `__NULO_E2E_PROBE__` Vite define constant exists and is documented (live in CLAUDE.md or a brief `e2e-probes.md` reference doc).
- The CI bundle-grep step is wired and passing on the umbrella PR.

---

## 13. Files to touch

### 13.1 Likely Cluster A touch points

- `packages/extension/src/wallet/services/wallet-sdk/background.ts` — probes + (if H1 confirmed) keepalive wiring
- `packages/extension/src/wallet/index.ts` — SW-LIFECYCLE probe
- `packages/wallet-bridge/src/dispatcher.ts` — WB-IN/OUT probes
- `packages/extension/src/wallet/services/execution/service.ts` — EXEC-IN/OUT probes
- `packages/extension/src/content-script/content.ts` — CS-RECV probe wrappers
- `packages/playground/src/lib/wallet.ts`, `packages/playground/src/lib/log.ts` — PG-OUT/IN probes
- **New**: `packages/extension/src/wallet/services/wallet-sdk/sw-keepalive.ts` (Phase D fix file)

### 13.2 Likely Cluster B touch points

- `packages/extension/src/offscreen/index.ts` — module/init probes
- `packages/aztec-runtime/src/pxe/chain-runtime.ts` — pxe-create probes
- `packages/extension/src/wallet/services/network/service.ts` — network-switch probes (need to find setActiveNetwork)
- `packages/extension/src/popup/app.vue` — popup-watcher probe
- `packages/extension/src/wallet/runtime.ts` — Phase E pre-warm hook (after `initWalletSdkHandler`, fire-and-forget `ensureOffscreenRunning`)

### 13.3 Build / infra

- `packages/extension/vite.config.ts` (or wherever Vite config lives) — register `__NULO_E2E_PROBE__` define
- `packages/playground/vite.config.ts` — same
- `packages/extension/scripts/e2e/agent.sh` — export `NULO_E2E_PROBE=1` AND wire it into the Vite build invocation
- `.github/workflows/_network-e2e.yml` (or wherever the network e2e workflow lives) — add the bundle-grep step

---

## 14. Estimated effort

- Phase A: 2-3h (probe wiring, careful gate constant)
- Phase B: 1-2h (smaller probe set)
- Phase C: 1-2h (3 runs + findings doc)
- Phase D: 4-6h (depending on H1 outcome; if it's Option C, ~3h; if upstream issue, larger)
- Phase E: 2-3h (pre-warm wiring + validation)
- Phase F: 0-3h depending on whether C/D pass after A+B
- Phase G: 30min per file (mostly running tests)
- Phase H: 1-2h (probe-strip + validation + PR body)

**Total**: ~15-25h. Single-engineer, ~2-3 working days.

---

## 15. Why I disagree with main plan's "Phase A starts with PG-OUT, ends with PG-IN" framing

Main plan's §4 lays probes from-dApp-outward (PG-OUT → WB-IN → BCH-RECV → BCH-SEND → PG-IN). The implicit assumption is that the bug is somewhere along the request *or* response path. But the upstream silent-drop at `handleEncryptedMessage:173` is BEFORE the dispatcher even sees the request. To catch it with main plan's probes, you'd see PG-OUT fire but nothing else — which proves SOMETHING was dropped between PG-OUT and BCH-RECV, but doesn't tell you WHICH of (CS forward, SW relay, decrypt, session lookup) failed. My probe set narrows it.

Concretely: a successful cluster-A probe trace under H1 would be:

```
PG-OUT method=requestCapabilities t=T0
CS-RECV direction=page→sw type=ENCRYPTED_MESSAGE t=T0+5ms
BCH-RAW-IN type=ENCRYPTED_MESSAGE sessionId=S1 t=T0+8ms
BCH-DECRYPT-IN sessionId=S1 queueDepth=0 t=T0+10ms
BCH-SESSION-LOOKUP-MISS sessionId=S1 found=false activeCount=0 t=T0+10ms     ← H1 confirmed
(nothing else fires; playground times out at T0+30s)
```

vs. H2:

```
PG-OUT method=requestCapabilities t=T0
... CS-RECV, BCH-RAW-IN, BCH-DECRYPT-IN, BCH-DECRYPT-OUT all fire ...
WB-IN method=requestCapabilities t=T0+15ms
(WB-OUT never fires)                                                          ← H2 confirmed (dispatcher hang)
```

vs. H4 (the response-relay-bug variant):

```
PG-OUT, CS-RECV, BCH-RAW-IN, BCH-DECRYPT-IN/OUT, WB-IN, WB-OUT, BCH-SEND-WIRE all fire
... but no PG-IN ever fires                                                  ← H4 (response lost)
```

Different traces → different hypotheses → different fixes. Main plan's probe set can't disambiguate H1 from H4.

---

## 16. Summary

This plan AGREES with main on: probe-first, real fix for B, phased single-PR commits, interactive gating, no merge today. It DIVERGES on: which specific probes to add (named upstream silent-drop sites), hypothesis ranking (H1 dominates), quarantine re-enable cadence (incremental not at-end), probe-leakage mitigation (bundle-grep not source-grep), cluster B fix approach (offscreen pre-warm at SW boot as the top candidate). Main's H1-equivalent (D.1 SW keepalive) is buried in the list of 6; my plan makes it the top suspect with code-level justification.

The minimum-viable change set:
1. Add probes per §4-5 (Phase A+B)
2. Run + analyze (Phase C)
3. Apply fix corresponding to confirmed hypothesis (Phase D OR a variant)
4. Pre-warm offscreen at SW boot for cluster B (Phase E)
5. Re-enable quarantined files incrementally (woven through D/E)
6. Strip probes, validate, update PR (Phase H)

Estimated 15-25 engineer-hours.
