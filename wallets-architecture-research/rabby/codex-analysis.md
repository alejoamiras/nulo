# Rabby Wallet Architecture Analysis

Method: this is an independent code read of Rabby from `(Rabby source tree)`. I sampled aggressively rather than pretending to read 1,500 files. The analysis below is grounded in the repository files I inspected, with explicit citations. One important limit: the inpage provider implementation is not in this repo; `src/content-script/page-provider.ts` only imports the published package `@rabby-wallet/page-provider`, so anything about inpage internals beyond the bridge surface would be speculation and I am not doing that here (`src/content-script/page-provider.ts:1-2`).

## 1. Manifest & Entry Points

Rabby has one build graph but multiple runtime packaging targets. Webpack defines five primary entries: `background`, `content-script`, `pageProvider`, `ui`, and `offscreen`, mapping to `src/background/index.ts`, `src/content-script/index.ts`, `src/content-script/page-provider.ts`, `src/ui/index.tsx`, and `src/offscreen/scripts/offscreen.ts` respectively (`build/webpack.common.config.js:58-68`). It also emits multiple HTML shells: `popup.html`, `notification.html`, `index.html`, `desktop.html`, `background.html`, and `offscreen.html` (`build/webpack.common.config.js:252-287`). That is the first architectural tell: Rabby is not “a popup plus a background”; it is a multi-surface extension with a dedicated approval window, an optional desktop dapp surface, and an offscreen DOM host.

The MV3 manifest is conventional at first glance and unconventional in the details. It uses a service worker `sw.js`, content scripts at `document_start`, `scripting`, `alarms`, `offscreen`, `storage`, `notifications`, and `<all_urls>` host access, plus a web-accessible `pageProvider.js` (`src/manifest/chrome-mv3/manifest.json:2-32`, `src/manifest/chrome-mv3/manifest.json:33-83`). The MV2 manifest instead uses a persistent `background.html` page and does not need `scripting`, `alarms`, or `offscreen` because persistence solves the lifecycle problem directly (`src/manifest/chrome-mv2/manifest.json:2-33`, `src/manifest/chrome-mv2/manifest.json:58-69`). That split matters: the MV2 build is the “natural” architecture; the MV3 build is the adaptation layer.

`_raw/sw.js` is not a generated bundle. It is a hand-written static shim copied into the dist output by `CopyPlugin` alongside the chosen manifest (`build/webpack.common.config.js:299-307`). Its job is to do just enough work in top-level worker scope to satisfy MV3 constraints and then lazily load the real compiled background bundle with `importScripts('/webextension-polyfill.js', '/vendor/trezor/trezor-connect-webextension.js', '/background.js')` (`_raw/sw.js:12-26`). That means `sw.js` is effectively a bootstrap loader, not the application.

That bootstrap does four notable things. First, it clears alarms whose names start with `ALARMS`, presumably to avoid stale periodic jobs after reload (`_raw/sw.js:3-10`). Second, it creates `offscreen.html` with `IFRAME_SCRIPTING` justification for hardware wallet communication (`_raw/sw.js:29-47`). Third, it programmatically registers `pageProvider.js` into the MAIN world at `document_start`, which is a meaningful design choice because page-provider injection through MV3 manifest declarations has long had edge-case failures (`_raw/sw.js:62-84`). Fourth, it binds top-level worker listeners before importing the heavy bundle, including `runtime.onMessage`, `tabs.onActivated`, `install`, and a USB disconnect listener (`_raw/sw.js:49-60`, `_raw/sw.js:91-102`).

Architecturally, this is sharp: Rabby keeps the service worker’s first-evaluation script tiny and MV3-safe, and defers the actual app graph until something wakes it. The cost is that there are now two background layers to reason about: the raw worker shim and the compiled background application.

## 2. Service Worker Architecture

The core MV3 question is not “does Rabby have a service worker?” but “how does Rabby refuse to behave like one?” The answer is offscreen keepalive. `src/offscreen/scripts/offscreen.ts` initializes hardware-related bridges and then sends `chrome.runtime.sendMessage({ type: 'ping' })` every five seconds forever (`src/offscreen/scripts/offscreen.ts:7-19`). `_raw/sw.js` registers a top-level `runtime.onMessage` handler that calls `importAllScripts()` on every message (`_raw/sw.js:49-54`). Put together, that is the real keepalive path. The comment in `_raw/sw.js` says “keep the service worker alive when messages are received,” which understates what is happening: the offscreen document is actively generating those messages to keep the worker warm.

This is clever and brittle at the same time. Clever, because it gives Rabby near-persistent background behavior in MV3 without forcing every subsystem to become termination-safe. Brittle, because it depends on browser behavior that Chrome has periodically tightened, and because it solves “worker sleep” with “don’t let it sleep” instead of making long-running state rebuild cheap. For a wallet like Nulo, where proof generation is the long-running problem rather than USB bridge churn, this is probably not the right primary strategy.

Cold boot is explicit in `restoreAppState()`. The boot sequence is: run install logic, load `keyringState` from storage, restore the keyring observable store, initialize backend clients, run data migrations, initialize a long list of services, attempt `tryUnlock()`, start RPC cache and watchers, set hourly jobs, maybe initialize the onboarding guide, wire cache-expiry events, and finally notify tabs that the extension is ready again (`src/background/index.ts:107-225`). This is real rehydration logic, not a toy. Rabby is assuming the worker may come up from nothing and must reconstruct a usable world.

Warm boot is where the design gets more interesting. Rabby stores the vault itself in persistent `storage.local`, but for MV3 it also caches the derived encryption key material in `browser.storage.session`. `passwordEncrypt()` and `passwordDecrypt()` store or retrieve `exportedKey` and `salt` for the keyring vault, and a separate `perpsVault` key for the perps subsystem (`src/background/utils/password.ts:17-50`, `src/background/utils/password.ts:60-98`, `src/background/utils/password.ts:107-145`). `keyringService.tryUnlock()` then attempts to decrypt the persisted vault without a password after worker restart (`src/background/service/keyring/index.ts:465-476`, `src/background/service/keyring/index.ts:1010-1028`). That is the real MV3 survival mechanism for unlock state.

This distinction is important:

- Persistent across worker death: `storage.local` state, Dexie databases, `browser.storage.session` keys, alarms, and whatever content scripts/offscreen documents are still alive (`src/background/webapi/storage.ts:5-22`, `src/db/index.ts:13-31`, `src/background/utils/password.ts:17-50`).
- Lost across worker death: live ports, in-memory services, session maps, approval queues, event bus listeners, decrypted keyring instances, memory caches, and any open promises not backed by persistent state (`src/eventBus.ts:3-49`, `src/background/service/session.ts:49-135`, `src/background/service/notification.ts:75-90`).

Rabby partially compensates for that loss in two ways. First, extension UIs poll `runtime.sendMessage({ type: 'getBackgroundReady' })` until the worker says it is ready, then open their port connection (`src/ui/app.tsx:173-215`, `src/background/index.ts:212-220`). Second, after boot the worker sends `RABBY_EXTENSION_READY` to all tabs so content scripts can rebuild their background port connection after worker reactivation (`src/utils/message.ts:17-61`, `src/content-script/index.ts:71-90`).

That handshake is one of the best MV3 patterns in the repo. Rabby is explicitly acknowledging that content scripts outlive the worker and need a way to reconnect.

Rabby also uses session storage for auto-lock persistence. `AutoLockService` writes `autoLockAt` into `browser.storage.session`, reconstructs the timeout on startup, and calls `wallet.lockWallet()` if the deadline already passed while the worker was gone (`src/background/service/autoLock.ts:17-49`, `src/background/controller/wallet.ts:7048-7053`). That is a clean example of persisting the minimum session datum needed to restore security semantics.

## 3. Background Composition

The background is organized as a singleton service forest, not a formally layered runtime. `src/background/service/index.ts` re-exports dozens of singleton service instances including notification, keyring, permission, preference, session, openapi, watchers, swap, RPC, bridge, perps, lending, and more (`src/background/service/index.ts:1-30`). `src/background/controller/index.ts` then exposes two top-level controllers: `providerController` for dapp-facing RPC and `walletController` for extension/UI-facing operations (`src/background/controller/index.ts:1-2`).

This makes the codebase easy to grow and hard to reason about globally. Many services can import many other services, and there is relatively little enforcement of dependency direction. The upside is velocity. The downside is that lifecycle coupling gets hidden in initialization order, which is why `restoreAppState()` is such a monster (`src/background/index.ts:107-225`).

Internal communication is mostly primitive. `eventBus.ts` is a tiny untyped listener registry with `emit`, `once`, `addEventListener`, and `removeEventListener` (`src/eventBus.ts:1-49`). There is no typing, no backpressure, no scoped bus, no leak detection, and no replay. It is enough for broadcast-style coordination inside one live worker instance, but it is not a robust state propagation system. In MV3 that matters because the event bus has zero persistence story: worker death resets it completely.

Persistent background “stores” are often plain objects wrapped in a `Proxy` by `createPersistStore()`. Every property write mutates the in-memory object, writes the whole object back to `storage.local`, and broadcasts a `storeChanged` payload to the UI (`src/background/utils/persistStore.ts:16-61`). This is a deceptively powerful pattern: dead simple, easy to adopt, and good enough for many extension-scale stores. It is also blunt. Whole-object writes on every set are not free, and the granularity is whatever the service author happens to choose.

Vault and keyring state live in `keyringService`, which is explicitly a MetaMask-keyring-controller fork (`src/background/service/keyring/index.ts:1-4`). The service keeps decrypted keyrings and the active password in memory only, while the observable store carries persistent fields like `booted`, `vault`, `unencryptedKeyringData`, and `hasEncryptedKeyringData` (`src/background/service/keyring/index.ts:137-145`, `src/background/service/keyring/index.ts:943-999`). `setLocked()` clears transports, drops the password, clears session keys, empties in-memory keyrings, and emits `lock` (`src/background/service/keyring/index.ts:415-430`). `submitPassword()` verifies, decrypts the vault, rebuilds keyrings in memory, and emits the unlocked state (`src/background/service/keyring/index.ts:446-463`).

`walletController` wraps that lower-level machinery into user-facing state transitions. `unlock()` calls `keyringService.submitPassword`, broadcasts `unlock` to dapp sessions, refreshes extension icon state, and emits `UNLOCK_WALLET` to the UI (`src/background/controller/wallet.ts:1883-1906`). `lockWallet()` calls `setLocked()`, clears all `browser.storage.session` data in MV3, broadcasts `accountsChanged: []` and `lock` to sessions, flips the icon, and emits `LOCK_WALLET` to the UI (`src/background/controller/wallet.ts:1909-1920`). This state machine is simple, defensible, and security-oriented.

One underrated detail: keyring restoration reattaches hardware bridges and event listeners on every unlock. `_restoreKeyring()` conditionally injects MV3 offscreen bridges and wires WalletConnect, Coinbase, and Gnosis events back into the UI bus during deserialization (`src/background/service/keyring/index.ts:1055-1189`). That means unlock is not just “decrypt secrets”; it is “reconstruct the live object graph.”

## 4. UI ↔ Background

Rabby’s extension UI uses long-lived ports, not `sendMessage`, as its main RPC channel. `src/ui/app.tsx` creates a `PortMessage` channel, connects with a surface-specific port name (`popup`, `notification`, `tab`, or `desktop`), and exposes a `wallet` proxy that dynamically maps method calls into `{ type, method, params }` requests (`src/ui/app.tsx:65-133`, `src/ui/app.tsx:173-175`). There is no static schema layer. It is stringly typed RPC over runtime ports.

The background side mirrors that exactly. In `browser.runtime.onConnect`, ports named as UI surfaces are wrapped in `PortMessage`, and requests are dispatched by `type`: `broadcast`, `openapi`, `testnetOpenapi`, `fakeTestnetOpenapi`, or `controller` (`src/background/index.ts:335-399`). Broadcasts from background to UI are forwarded through the event bus into the port (`src/background/index.ts:401-428`). This is extremely dynamic. It is also thin, which keeps call overhead low.

The message transport itself is custom. `src/utils/message/index.ts` implements request IDs, request/response matching, error serialization, and a large `PQueue` concurrency cap; `portMessage.ts` is just the runtime-port adapter on top (`src/utils/message/index.ts:80-197`, `src/utils/message/portMessage.ts:15-50`). This is not a strongly-versioned RPC layer. It is a lightweight intra-extension bus.

State sync between background and UI is selective. Background services using `createPersistStore()` emit `storeChanged` notifications for changed keys (`src/background/utils/persistStore.ts:32-46`). The UI only subscribes to some of them and manually patches Rematch models for contact book, preference, whitelist, and currency (`src/ui/models/_uistore.ts:4-126`). That tells you Rabby is not doing full background-state mirroring into Redux. It is doing ad hoc state projection where needed.

That is a pragmatic choice, but it also means background/UI consistency depends on developers remembering to broadcast and remember to subscribe. There is no single source-of-truth synchronization protocol.

## 5. dApp ↔ Background

The dapp path is three-hop: inpage provider, content script bridge, background provider controller. But only two hops are visible in this repo. The inpage bundle is external (`src/content-script/page-provider.ts:1-2`). The content script constructs a `BroadcastChannelMessage` bridge between the page provider and itself, forwards requests over a background `PortMessage`, and recreates the port if the worker disappears (`src/content-script/index.ts:37-51`, `src/content-script/index.ts:62-90`). In MV3, MAIN-world provider injection is registered by the service worker with `chrome.scripting.registerContentScripts`; in MV2, the content script manually injects a `<script src="pageProvider.js">` tag (`_raw/sw.js:67-84`, `src/content-script/index.ts:24-35`, `src/content-script/index.ts:92-94`).

Background dapp ports are handled in the non-UI branch of `runtime.onConnect`. Rabby derives `origin` from `port.sender.url`, creates or reuses a session keyed by `tabId-origin`, strips most `$ctx` metadata for non-internal origins, binds the port to the session, and dispatches either subscription methods or the main `providerController` (`src/background/index.ts:433-510`, `src/background/service/session.ts:49-135`). Sessions can fan out events such as `accountsChanged` and `chainChanged` to all matching ports for an origin (`src/background/service/session.ts:88-126`).

Permission and approval flow live in `rpcFlow.ts`, which is one of the stronger pieces of design in the codebase. It uses a Koa-like `PromiseFlow` middleware pipeline rather than a giant `switch` (`src/background/utils/promiseFlow.ts:1-25`, `src/background/controller/provider/rpcFlow.ts:39-46`). The stages are: method mapping, lock gate, connect gate, approval gate, and execution/retry loop (`src/background/controller/provider/rpcFlow.ts:47-304`, `src/background/controller/provider/rpcFlow.ts:306-500`).

The lock gate is origin-aware and suppresses parallel unlock requests with a `lockedOrigins` set (`src/background/controller/provider/rpcFlow.ts:32-33`, `src/background/controller/provider/rpcFlow.ts:83-117`). The connect gate similarly suppresses concurrent connection prompts with `connectOrigins`, can auto-connect in some desktop-dapp cases, and persists connected-site metadata including chain and optional account (`src/background/controller/provider/rpcFlow.ts:118-210`). The approval gate uses metadata on provider controller methods to decide whether a UI prompt is required, normalizes malformed `personal_sign` parameter ordering, and populates missing transaction `chainId` from connected-site state (`src/background/controller/provider/rpcFlow.ts:211-304`).

The approval UI itself is window-based, not popup-based. `notificationService` maintains an approval queue, one current approval, badge counts, and focus-based rejection behavior (`src/background/service/notification.ts:42-54`, `src/background/service/notification.ts:75-151`, `src/background/service/notification.ts:300-411`). Notification windows are opened as `notification.html#route` popup windows positioned near the last focused browser window (`src/background/webapi/window.ts:45-111`). This separation is good architecture for dapp flows: approvals are independent of whether the main popup is open.

Origin gating is strict at the provider layer. `ethRpc` rejects unauthorized non-safe methods, and many provider methods read or write the connected-site chain/account association via `permissionService` (`src/background/controller/provider/controller.ts:448-546`, `src/background/controller/provider/controller.ts:548-603`). One important behavioral choice: `wallet_addEthereumChain` does not really support arbitrary chain addition. It only accepts chains Rabby already knows; otherwise it throws “This chain is not supported by Rabby yet” (`src/background/controller/provider/controller.ts:1715-1790`). That is a product choice masquerading as EIP support.

## 6. Storage & Vault

Rabby uses three storage tiers.

First, `browser.storage.local` for primary extension persistence. The wrapper in `src/background/webapi/storage.ts` memoizes the entire store into an in-memory `Map` after first read, then writes through on `set()` (`src/background/webapi/storage.ts:3-22`). Many services sit directly on this via `createPersistStore()` proxies (`src/background/utils/persistStore.ts:16-61`).

Second, `browser.storage.session` for MV3 session continuity. Rabby stores derived vault keys there for passwordless warm re-unlock, perps vault session keys under a separate namespace, and the auto-lock deadline (`src/background/utils/password.ts:17-50`, `src/background/utils/password.ts:80-98`, `src/background/service/autoLock.ts:17-49`). This is one of the repo’s most relevant patterns for Nulo.

Third, Dexie/IndexedDB for heavier caches and resumable sync state. The database schema has multiple versions and a data upgrade at version 6 (`src/db/index.ts:13-31`). History sync state is persisted through `syncDbService`, and `historyDbService` explicitly resumes unfinished “all history” syncs after restart by reading `pendingStartTime` and `pendingLatestTime` from Dexie-backed state (`src/db/services/historyDbService.ts:47-77`, `src/db/services/historyDbService.ts:153-246`). This is a much stronger long-running-job pattern than the simple local-storage-backed service stores.

The vault format is split between encrypted secrets and selectively clear metadata. `persistAllKeyrings()` serializes all keyrings, encrypts the whole set into `store.vault`, and also stores `unencryptedKeyringData` only for non-secret keyring types while omitting HD/simple keyrings from that cleartext list (`src/background/service/keyring/index.ts:943-999`). That is a practical compromise: preserve UX-relevant metadata without leaving seed-bearing material around.

The in-memory vs persistent split is clean where it matters. Decrypted keyrings, password, popup-open state, other-provider detection, session map, approval queue, and perps decrypted agent wallets are memory-only (`src/background/service/keyring/index.ts:141-145`, `src/background/service/preference.ts:185-189`, `src/background/service/session.ts:49-135`, `src/background/service/notification.ts:75-90`, `src/background/service/perps.ts:55-68`). Persistent stores hold only what is needed to rebuild or continue. That design discipline is good.

## 7. Long-Running Operations

Rabby is not built around “minutes-long proving,” but it does contain a few patterns for long or restart-sensitive work.

Signing flows are modeled as multi-stage approval-plus-execution jobs. After approval, `rpcFlow` creates a deferred execution function, optionally waits for a UI signing component to mount, supports retry mutation of nonce or gas for transaction resends, emits completion/failure events back to the UI, and can chain additional UI requests before final execution (`src/background/controller/provider/rpcFlow.ts:326-500`). This is a decent orchestration model for anything that has a human approval phase followed by asynchronous execution.

History sync is the best restart-safe long-running job in the repo. `syncWithAllHistoryApi()` writes “I am syncing” plus progress markers into persistent sync state before looping, updates those markers after each page, and clears them when done (`src/db/services/historyDbService.ts:153-246`). On the next boot, `sync()` checks those markers first and resumes before doing anything else (`src/db/services/historyDbService.ts:58-77`). For Nulo, this pattern is directly portable to proof-generation jobs or note-scan jobs.

The perps subsystem has a smaller but very good pattern: `unlockAgentWallets()` stores an `unlockPromise` in memory while decrypted agent wallets are being rebuilt, and readers call `getAgentWallet()` await that promise if necessary (`src/background/service/perps.ts:173-212`, `src/background/service/perps.ts:277-288`). That is honest engineering. The code acknowledges that rebuild is non-trivial and gives consumers an explicit readiness contract.

What Rabby does not really have is a general cancellation model. Approvals can be rejected by the user or by notification-window loss (`src/background/service/notification.ts:121-150`, `src/background/service/notification.ts:377-388`), and dapp requests can fail or retry within the sign pipeline (`src/background/controller/provider/rpcFlow.ts:350-403`), but there is no repository-wide abstraction for cancelable background jobs. If Nulo is going to run proofs for tens of seconds or minutes, that gap matters.

## 8. Provider / RPC Layer

Rabby does not use MetaMask’s `JsonRpcEngine` pattern internally. The closest equivalent is “controller methods plus middleware metadata.” Unknown `eth_*` and `net_version` requests fall through to `providerController.ethRpc()`, while named wallet/provider methods are normal controller methods annotated with `SAFE`, `PRIVATE`, or `APPROVAL` metadata (`src/background/controller/provider/rpcFlow.ts:47-72`, `src/background/controller/provider/controller.ts:448-546`). It is lighter than JsonRpcEngine and easier to trace at the method level.

There is also an internal `EthereumProvider` shim used for built-in flows. It subclasses `EventEmitter`, exposes EIP-1193-ish `request`, `send`, and `sendAsync`, and delegates most logic back into `providerController` or `wallet.sendRequest()` (`src/background/utils/buildinProvider.ts:19-137`, `src/background/utils/buildinProvider.ts:139-180`). This is a compatibility provider, not a formal middleware engine.

Multi-chain support is mostly permission-state plus RPC routing. Every connected site carries a selected chain, and `ethRpc()` resolves a `chainServerId` from that site state unless an internal caller overrides it (`src/background/controller/provider/controller.ts:464-489`). Mainnet-like chains go through either a custom RPC or a default RPC list/backend API; testnets go through `customTestnetService.getClient().request()` (`src/background/controller/provider/controller.ts:491-545`). `RPCService` can race transaction submission across fallback RPC URLs, but for many read methods it simply punts to Rabby’s backend API if the method is on a hardcoded whitelist or there are no RPC hosts (`src/background/service/rpc.ts:20-49`, `src/background/service/rpc.ts:175-217`).

That backend-assisted RPC strategy is practical and somewhat opinionated. It reduces client complexity, but it also means Rabby’s “wallet RPC” is partly a frontend to Rabby infrastructure rather than purely direct chain communication.

Subscriptions are bolted on with MetaMask’s filters package. `createSubscription()` wraps `@metamask/eth-json-rpc-filters/subscriptionManager` and a polling block tracker around Rabby’s internal provider (`src/background/controller/provider/subscriptionManager.ts:9-59`). That is a sensible reuse.

There is one suspicious wart in the connection path: `createSubscription(origin)` is called before the local `origin` variable is assigned from `port.sender.url` (`src/background/index.ts:437-464`). In a worker, global `origin` exists, so this probably compiles and runs, but it is very likely passing the worker’s own origin rather than the dapp origin into the subscription manager. I cannot prove runtime breakage from this read alone, but it is exactly the kind of hidden bug that singleton-heavy, stringly-typed background code breeds.

## 9. Migrations

Rabby’s migration system is straightforward for `storage.local` data. `src/migrations/index.ts` reads a fixed key list, gets `dataVersion`, sorts migrations by version, applies each newer migration in order, writes all resulting keys back, and then writes the new `dataVersion` (`src/migrations/index.ts:4-48`). That is simple and workable.

The good news is that migrations are explicit and versioned. The less good news is that they are somewhat loose in discipline. They operate over a partially typed bag of top-level stores, and many rely on `try/catch` fallbacks rather than stronger invariants. The weirdest example I found is `siteAccountMigration` version 9, which populates `permission.dumpCache[*].v.account` from `currentAccount`, followed immediately by `siteAccountMigrationEmpty` version 10, which removes that field by setting it back to `undefined` (`src/migrations/siteAccountMigration.ts:4-37`, `src/migrations/siteAccountMigrationEmpty.ts:4-32`). That may reflect a reverted product decision, but as a migration chain it reads like churn preserved forever.

Dexie schema evolution is separate and cleaner. The IndexedDB layer versions schemas explicitly and uses `db.version(6).upgrade(...)` for record-level transformation of history rows (`src/db/index.ts:13-31`).

## 10. What Nulo Should Steal

- Steal the “background ready” handshake. The worker explicitly announces readiness to both extension pages and content scripts, and the UI/content-script layers reconnect instead of assuming background permanence (`src/background/index.ts:209-220`, `src/utils/message.ts:17-61`, `src/ui/app.tsx:200-215`, `src/content-script/index.ts:71-90`). For MV3, this is table stakes.

- Steal the MV3 warm-unlock technique, but understand the trade. Caching the exported vault key and salt in `browser.storage.session` lets the worker die without forcing a password re-entry on every wake (`src/background/utils/password.ts:17-50`, `src/background/utils/password.ts:107-145`, `src/background/service/keyring/index.ts:465-476`). For Nulo, this is directly relevant if proof generation or PXE state causes worker churn.

- Steal the resumable-job pattern from history sync. Persist job progress before the loop, update progress after every chunk, and resume on the next boot (`src/db/services/historyDbService.ts:58-77`, `src/db/services/historyDbService.ts:153-246`). That is a much better fit for proving than pretending the worker will stay alive.

- Steal the `unlockPromise` pattern from perps. If a subsystem has an expensive post-unlock rebuild, store a promise representing that rebuild and make callers await readiness instead of racing a partially rebuilt memory graph (`src/background/service/perps.ts:173-212`, `src/background/service/perps.ts:277-288`).

- Steal the approval/execution separation in `rpcFlow`. Approval gathering, deferred execution, retry mutation, and completion broadcast are distinct phases (`src/background/controller/provider/rpcFlow.ts:211-304`, `src/background/controller/provider/rpcFlow.ts:326-500`). That is a solid base for “prove, then ask, then send” or “ask, then prove, then send,” depending on Nulo’s UX.

- Steal the dedicated notification window model. Tying dapp approvals to a popup is fragile; Rabby uses a separate `notification.html` surface managed by a window service (`src/background/service/notification.ts:153-176`, `src/background/webapi/window.ts:45-111`). For long proofs, a dedicated approval/progress surface is more honest than trying to squeeze everything into a transient popup.

## 11. What’s Over-Engineered or Fragile

- The offscreen ping keepalive is a hack. It works, but it is a policy gamble and not a principled answer to MV3 lifecycle (`src/offscreen/scripts/offscreen.ts:13-19`, `_raw/sw.js:49-54`). Nulo should assume the worker can die and design around that.

- `eventBus.ts` is too primitive for the amount of architecture leaning on it (`src/eventBus.ts:1-49`). It is fine for a small app. Rabby is not a small app.

- `createPersistStore()` writes the whole object on every property set (`src/background/utils/persistStore.ts:32-46`). That is extremely convenient and eventually becomes hidden I/O amplification.

- `syncChainService.resetTimer()` adds a new `browser.alarms.onAlarm` listener every call without removing the old one (`src/background/service/syncChain.ts:67-89`). Maybe it runs rarely enough not to matter. It is still sloppy lifecycle management.

- `RpcCache` fakes latest block numbers with random numbers every ten seconds (`src/background/utils/rpcCache.ts:19-32`). I understand the motive: cheap invalidation without hammering nodes. It is also semantically gross and can produce surprising cache behavior.

- The provider/UI RPC surface is dynamic string dispatch with little schema protection (`src/ui/app.tsx:69-133`, `src/background/index.ts:343-399`). Fast to develop, easy to drift, harder to refactor safely.

- The apparent `origin` bug in subscription creation is the kind of issue that emerges from implicit globals and broad singletons (`src/background/index.ts:437-464`). Even if harmless in practice, it is a smell.

## Bottom Line for Nulo

1. Do not copy Rabby’s “keep the worker alive at all costs” instinct. Copy its rehydration and reconnection patterns instead (`src/background/index.ts:107-225`, `src/utils/message.ts:17-61`).
2. Rabby’s best MV3 idea is warm-unlock through `browser.storage.session` plus explicit session rebuild (`src/background/utils/password.ts:17-50`, `src/background/service/keyring/index.ts:465-476`).
3. For Aztec proving, the model to steal is resumable jobs with persisted progress, not perpetual worker liveness (`src/db/services/historyDbService.ts:153-246`).
4. Separate approval UI from popup UI. Rabby’s notification-window architecture is the right family of pattern for long, interruptible wallet actions (`src/background/service/notification.ts:300-411`, `src/background/webapi/window.ts:105-111`).
5. Avoid Rabby’s untyped singleton sprawl. The app works, but a lot of its complexity is now coordination debt (`src/background/service/index.ts:1-30`, `src/eventBus.ts:1-49`).
