# Rabby Wallet — Architecture Notes for Nulo

**Source tree analysed:** `(Rabby source tree)` (version 0.93.87 in
`src/manifest/chrome-mv3/manifest.json:5`). Rabby is a fork of MetaMask's keyring
controller heritage with a bespoke RPC pipeline, a hand-rolled MV2/MV3 dual build,
and a hard React/Redux popup. What follows is a senior-engineer reading: what
they actually shipped, why, what works, and what is fragile.

---

## 1. Manifest & entry points

Rabby ships **three** parallel manifests from a single source tree:

- `src/manifest/chrome-mv3/manifest.json` — Manifest V3 (the modern target)
- `src/manifest/chrome-mv2/manifest.json` — legacy MV2, still buildable
- `src/manifest/firefox-mv2/manifest.json` — Firefox

Build chooses one via `MANIFEST_TYPE` env var
(`build/webpack.common.config.js:41-43`); the resulting `dist/` differs per target.
This is not a one-line conditional — it's separate JSON files, separate output
directories (`paths.dist` vs `paths.distMv2`), and conditional copy patterns for
Trezor (`build/webpack.common.config.js:308-345`).

### MV3 vs MV2 differences worth noting

Compare `src/manifest/chrome-mv3/manifest.json` to `src/manifest/chrome-mv2/manifest.json`:

| Concern | MV2 | MV3 |
|---|---|---|
| Background | `"page": "background.html", "persistent": true` (line 31-33 of MV2) | `"service_worker": "sw.js"` (line 30-32 of MV3) |
| Action surface | `browser_action` | `action` |
| Permissions | `["storage", "unlimitedStorage", "activeTab", "notifications", "contextMenus"]` | adds `"scripting"`, `"alarms"`, `"offscreen"` |
| Host permissions | implicit (none declared) | explicit `"host_permissions": ["<all_urls>"]` |
| Web-accessible resources | flat array `["pageProvider.js"]` | structured `[{resources, matches}]` |
| CSP | `"script-src 'self' 'wasm-eval' https://www.google-analytics.com"` (string) | object form, drops Google Analytics, switches to `'wasm-unsafe-eval'` |
| pageProvider injection | listed in `web_accessible_resources` then injected from content-script | NOT manifest-declared content-script — registered programmatically via `chrome.scripting.registerContentScripts` with `world: "MAIN"` (sw.js:67-84) |

The MAIN-world content-script registration is forced because `world: "MAIN"`
inside the manifest had a Chromium bug (`https://bugs.chromium.org/p/chromium/issues/detail?id=634381`,
referenced in `_raw/sw.js:64-65`). Worth knowing — this same workaround applies
to Nulo if you ever ship a MAIN-world inpage script.

### Entry points (webpack `entry`, `build/webpack.common.config.js:59-68`)

```js
entry: {
  background: { import: 'src/background/index.ts', asyncChunks: false },
  'content-script': 'src/content-script/index.ts',
  pageProvider: 'src/content-script/page-provider.ts',
  ui: 'src/ui/index.tsx',
  offscreen: 'src/offscreen/scripts/offscreen.ts',
}
```

Note `asyncChunks: false` on `background` — they want **a single bundle** for the SW
because MV3 service workers cannot use dynamic `import()` reliably. The UI bundle is
shared across `popup.html`, `notification.html`, `index.html` (full tab),
`desktop.html`. Same JS, four HTML shells, view selection by URL.

### What's in `_raw/sw.js`

It is **hand-written**, 102 lines, **not** a webpack output. It's copied verbatim into
`dist/` via `CopyPlugin` (`build/webpack.common.config.js:301`). The webpack-built
`background.js` is *imported into* sw.js via `importScripts`. This split is deliberate:

```js
// _raw/sw.js:18-22
importScripts(
  '/webextension-polyfill.js',
  '/vendor/trezor/trezor-connect-webextension.js',
  '/background.js'
);
```

Why? Because `importScripts` is the only way for an MV3 SW to load a polyfill plus
a vendor module synchronously, before any handler runs — and because they do
not want webpack's chunking touching the SW boot code. The hand-written part
also installs lifecycle handlers eagerly (line 92-95 `self.addEventListener('install', …)`
and the synchronous `navigator.usb.addEventListener` on line 99) — these MUST
register on the initial evaluation per MV3 rules.

Worth stealing for Nulo: keep your SW entry hand-written (or extremely minimal) and
import the bundled background as a single side-effect script.

---

## 2. Service worker survival

Rabby's SW is killed at the usual MV3 ~30s idle. Their answers, layered:

### a) Offscreen heartbeat ping

`src/offscreen/scripts/offscreen.ts:13-19`:

```ts
const keepServiceWorkerAlive = () => {
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'ping' });
  }, 5 * 1000);
};
```

The offscreen doc lives forever (it's not subject to SW idle rules), and it pings
the SW every 5 seconds. The SW's `chrome.runtime.onMessage` listener
(in sw.js:51-54) responds and re-imports scripts if needed:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  importAllScripts();
  return false;
});
```

This is a **load-bearing hack**. The offscreen page itself was justified to Chrome as
"hardware wallet IFRAME_SCRIPTING" (`_raw/sw.js:42-43`), but its 5-second ping is
the de facto MV3 keep-alive. If Chrome ever tightens reasons or kills offscreen
during idle, Rabby's persistence model breaks.

### b) Long-lived ports

The popup, notification window, and tab pages all open a `chrome.runtime.connect`
port (see `src/utils/message/portMessage.ts:15-29`). As long as a port is alive,
Chrome resets the SW idle timer. `src/background/index.ts:336-431` is one giant
`runtime.onConnect` listener wiring `popup`, `notification`, `tab`, `desktop` ports
into the controller dispatcher.

### c) `chrome.alarms` (only for genuinely periodic work)

`src/background/index.ts:158-165` and similar in `metamaskModeService.ts:67-71`,
`syncChain.ts:76-84`. Used only for hour-scale tasks (telemetry, chain-list sync).
They explicitly fall back to `setInterval` on MV2:

```ts
// src/background/index.ts:157-171
if (isManifestV3) {
  browser.alarms.create(ALARMS_USER_ENABLE, { when: Date.now(), periodInMinutes: 60 });
  browser.alarms.create(ALARMS_SYNC_DEFAULT_RPC, { when: Date.now(), periodInMinutes: 60 });
} else {
  setInterval(() => { startEnableUser(); RPCService.syncDefaultRPC(); }, 1 * 60 * 60 * 1000);
}
```

### d) "SW alive?" probe in the UI

`src/ui/app.tsx:219-249`:

```ts
const checkSwAlive = () => {
  Promise.race([
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    browser.runtime.sendMessage({ type: 'ping' }),
  ])
    .then(() => console.log('[checkSwAlive] sw is alive'))
    .catch((e) => Sentry.captureException('sw is dead/inactive: ' + ...));
};
```

A diagnostic, not a fix. Tells them via Sentry when the SW is missing on UI
boot.

### State: in-memory vs persisted

Rabby keeps a hard split:

- **Encrypted-at-rest, persisted in `chrome.storage.local`:** the keyring vault
  (`vault` field set in `keyring/index.ts:988-992`), each service's `*Store`
  object (preference, permission, transactions, etc., via `createPersistStore`).
- **Persisted unencrypted in `chrome.storage.local`:** non-secret service stores
  (preference, RPC config, swap history). Auto-broadcast to UI on mutation
  (`utils/persistStore.ts:38-45`).
- **In `chrome.storage.session` (MV3-only, ephemeral, encrypted-at-rest by Chrome):**
  the *exported* vault key + salt (`background/utils/password.ts:36-50`). When the
  SW dies and re-spawns, this lets `tryUnlock` decrypt the vault without the user
  re-entering their password. This is the lock-survival trick.
- **In SW heap only:** `keyringService.password` (line 118 of keyring/index.ts),
  decrypted keyrings, `sessionMap` (per-tab dApp sessions, `service/session.ts:50`),
  notification queue (`service/notification.ts:86`), pending sign deferreds
  (`service/notification.ts:89` `currentRequestDeferFn`). All of these die on SW
  termination — except the password, which is reconstructed from `storage.session`.

### Boot sequence, cold start

`src/background/index.ts:107-225` — the `restoreAppState()` function. This runs on
**every** SW spawn:

1. `onInstall()` → check storage existence; if first-install, open user-guide tab.
2. `storage.get('keyringState')` → load encrypted vault into ObservableStore.
3. Subscribe `keyringService.store` → on every state mutation, write back to
   `storage.set('keyringState', value)` (line 110-111). One-line auto-persist.
4. Init openapi (mainnet + testnet HTTP clients).
5. `migrateData()` — runs through `src/migrations/index.ts`.
6. Init ~25 services serially (`customTestnetService.init()` … `innerDappFrameService.init()`).
7. **`walletController.tryUnlock()`** — attempts auto-unlock from session-stored key.
8. Start RPC cache (`rpcCache.start()`).
9. Set `appStoreLoaded = true`.
10. Roll periodic services (`transactionWatchService.roll()` etc.).
11. `subscribeTxCompleted()` to wire post-tx side effects.
12. Send `EXTENSION_MESSAGES.READY` to all tabs (re-establish content-script ports).

The UI bootstraps with a **gate** to avoid racing this:
`src/ui/app.tsx:200-217` polls `getBackgroundReady` every 100ms until the SW
responds. Without that gate, the popup would `connect()` against a half-init SW
and break. This is the kind of subtle race that Nulo's e2e tests have to fight, too.

---

## 3. Background composition

### Modules

- **Singleton services** in `src/background/service/` — 30+ files. Each exports a
  `new ServiceClass()` default. Index file `src/background/service/index.ts`
  re-exports them all as named exports. Names: `keyringService`,
  `preferenceService`, `permissionService`, `notificationService`,
  `transactionHistoryService`, etc.
- **Two controllers** in `src/background/controller/` — `wallet.ts` and `provider/`.
  - `WalletController` (`controller/wallet.ts`, **7055 lines** in one file) — the
    method bag exposed to the popup. One mega-class, all UI calls land here.
  - `providerController` (`controller/provider/controller.ts`, 2070 lines) — the
    method bag exposed to dApps via JSON-RPC. Methods are decorated with
    `@Reflect.metadata('APPROVAL', [...])`, `@Reflect.metadata('SAFE', true)`,
    `@Reflect.metadata('PRIVATE', true)` to declare approval/lock/private
    behaviour (`controller/provider/controller.ts:447, 580, 605, 1488, 1715` etc.).
    Read by `rpcFlow.ts`.

### Internal communication: a hand-rolled EventEmitter

`src/eventBus.ts` is **fifty lines**:

```ts
class EventBus {
  events: Record<string, Listener[]> = {};
  emit = (type, params) => { (this.events[type] || []).forEach(fn => fn(params)); };
  addEventListener = (type, fn) => { ... };
  removeEventListener = (type, fn) => { ... };
}
export default new EventBus();
```

That's it. No RxJS, no observables, no event types. **Strings, callbacks, no typing.**
This is used everywhere — `keyringService.emit('unlock')`, `eventBus.emit(EVENTS.broadcastToUI, ...)`,
`eventBus.addEventListener(EVENTS_IN_BG.ON_TX_COMPLETED, ...)`. Two distinct event
namespaces (`EVENTS` for UI-bound, `EVENTS_IN_BG` for SW-internal) declared in
`src/constant/`.

It is **not** lifecycle-aware. Listeners pile up in `events[type]`. If a service
re-registers on every SW spawn (which it does, since the SW heap is fresh) you
get clean state, but if you ever import a service module twice or refer to a
stale listener, leaks compound silently.

### The wallet/keyring/vault

The keyring system is a **direct fork of MetaMask's `KeyringController`** —
`src/background/service/keyring/index.ts:1` literally says
`/// fork from https://github.com/MetaMask/KeyringController/blob/master/index.js`.

Architecture (`keyring/index.ts:110-145`):

```ts
class KeyringService extends EventEmitter {
  keyringTypes: any[];               // class registry (HD, Simple, Ledger, …)
  store!: ObservableStore<any>;      // persisted (vault + booted + unencryptedKeyringData)
  memStore: ObservableStore<MemStoreState>;  // in-memory (isUnlocked, displayed keyrings)
  keyrings: any[];                   // in-memory decrypted keyring instances
  private password: string | null;   // in-memory password
}
```

Two stores per `@metamask/obs-store`. The `store` is the persisted vault
(loaded from `chrome.storage.local`); `memStore` is ephemeral state that the UI
subscribes to via the same observable interface.

Each keyring class is a per-vendor adapter. Notable:
- `@rabby-wallet/eth-simple-keyring` (private keys, MM fork)
- `@rabby-wallet/eth-hd-keyring` (BIP39 seed)
- `eth-watch-keyring` (watch-only)
- `eth-ledger-keyring`, `eth-trezor-keyring`, `eth-onekey-keyring`,
  `eth-bitbox02-keyring`, `eth-imkey-keyring`, `eth-keystone-keyring`,
  `eth-lattice-keyring` (hardware)
- `eth-walletconnect-keyring`, `eth-coinbase-keyring` (mobile)
- `eth-gnosis-keyring`, `eth-cobo-argus-keyring` (smart accounts)

13 keyring types, each implementing `serialize() / deserialize() / getAccounts() /
signTransaction() / signMessage()`. The `KeyringService` doesn't know what they
are — it dispatches via `getKeyringClassForType(type)` lookup
(`keyring/index.ts:1204-1206`).

### Lock / unlock flow

The lock model is rooted in two concepts that MUST be understood:

1. **booted** — has the user ever set a password? Stored as the encryption of the
   string `"true"` (`keyring/index.ts:142-144`). If decrypting `booted` with the
   submitted password succeeds, the password is correct. Pure marker; isolates
   password verification from vault content.
2. **vault** — the encrypted serialized array of all keyrings. Encrypted with
   the same password (`keyring/index.ts:982-986`).

#### `boot(password)` — first-ever password set

```ts
// keyring/index.ts:137-145
async boot(password: string) {
  if (this.isBooted()) throw new Error('is booted');
  this.password = password;
  const encryptBooted = await passwordEncrypt({ data: 'true', password });
  this.store.updateState({ booted: encryptBooted });
  this.memStore.updateState({ isUnlocked: true });
}
```

#### `submitPassword(password)` — later unlocks

```ts
// keyring/index.ts:446-463
async submitPassword(password: string) {
  await this.verifyPassword(password);     // decrypt `booted` with password
  this.password = password;
  this.keyrings = await this.unlockKeyrings(password);
  this.setUnlocked();
  if (!this.store.getState().unencryptedKeyringData) {
    await this.persistAllKeyrings();       // backfill if migrating from older schema
  }
}
```

#### `setLocked()` — wipe in-memory secrets

```ts
// keyring/index.ts:415-431
async setLocked() {
  this.keyrings.forEach(k => k.cleanUp?.());  // release transports (Ledger, etc.)
  this.password = null;
  passwordClearKey();                         // wipe storage.session
  this.memStore.updateState({ isUnlocked: false });
  this.keyrings = [];
  this.emit('lock');
}
```

#### `tryUnlock()` — silent SW-respawn unlock

```ts
// keyring/index.ts:465-476
async tryUnlock() {
  if (this.password || this.isUnlocked()) return;
  try {
    this.keyrings = await this.unlockKeyrings();  // password=undefined → use storage.session key
    this.setUnlocked();
  } catch (e) { /* user must enter password */ }
}
```

The trick is in `passwordEncrypt`/`passwordDecrypt` (`background/utils/password.ts`):
when called *with* a password, they call `@metamask/browser-passworder`'s
`encryptWithDetail` / `decryptWithDetail`, which return the derived key as
`exportedKeyString`. On MV3 with `persisted: true`, that key string and salt are
written to `chrome.storage.session` (lines 80-83, 124-126). On the next SW spawn,
`passwordDecrypt` with no password reads them back, calls `importKey` +
`decryptWithKey` (lines 134-145).

`storage.session` is encrypted on disk by Chrome and only available to the
extension process. **This is how Rabby stays "unlocked" across SW deaths**
without re-prompting the user every 30 seconds, while still complying with MV3
and never plaintext-persisting the password.

### Auto-lock

`src/background/service/autoLock.ts:6-60`. Set `autoLockAt` in `storage.session`,
and a `setTimeout` calls `onAutoLock`. If the SW dies, on respawn `syncAutoLockAt`
re-reads the deadline and re-arms the timer (or fires immediately if past). Clean
recovery pattern that survives SW termination.

---

## 4. UI ↔ Background

### Port-based RPC, but with a gorgeous Proxy

`src/ui/app.tsx:67-133` builds the popup's `wallet` object as a Proxy:

```ts
const portMessageChannel = new PortMessage();
const wallet = new Proxy({}, {
  get(obj, key) {
    switch (key) {
      case 'openapi':
        return new Proxy({}, { get(obj, key) {
          return (...params) => portMessageChannel.request({ type: 'openapi', method: key, params });
        }});
      // ... testnetOpenapi, fakeTestnetOpenapi
      default:
        return (...params) => portMessageChannel.request({ type: 'controller', method: key, params });
    }
  }
}) as WalletControllerType;
```

Then they `cast` it to `WalletControllerType` (the type of `WalletController`).
**Every method on the controller is callable from the UI as if it were local**:

```ts
const balance = await wallet.getAddressCacheBalance(address);
await wallet.sendRequest({ method: 'eth_sendTransaction', params: [...] });
```

No codegen, no schema, no IPC layer — just `Proxy + TypeScript structural typing`.
The price: every UI call becomes a port message round-trip. The benefit:
**zero ceremony** when adding a controller method.

### Transport: `PortMessage`

`src/utils/message/portMessage.ts:1-58` plus `src/utils/message/index.ts`:

- Wraps `chrome.runtime.connect` ports.
- `request(data)` adds an ident and parks a `{resolve, reject}` in `_waitingMap`
  (line 136-143 of message/index.ts).
- ID pool of 1000 (`_requestIdPool = [...Array(1000).keys()]`, line 132) — a
  hard ceiling on concurrent in-flight requests.
- Wraps everything in a single `pQueue` with concurrency 1000
  (`message/index.ts:10`) — keeps insertion order + lets you tune backpressure
  in one place.
- `dispose()` rejects all in-flight requests with `userRejectedRequest` — proper
  cleanup on unload (line 200-206 of message/index.ts).

### SW dispatch

`src/background/index.ts:336-431` — `runtime.onConnect` decides routing by `port.name`:

- **`popup` / `notification` / `tab` / `desktop`** ports route to `walletController`,
  `openapi`, `testnetOpenapi`, etc. (lines 343-399). UI-side
  the `wallet` Proxy emits `{type: 'controller', method, params}` and the SW
  applies it to `walletController[method]`.
- **No port name** (i.e. content-script connect) routes to `providerController`
  via `rpcFlow` (lines 433-510).

The dispatcher even has a **Firefox quirk shim**: `transformFunctionsToZero`
strips function-valued return fields because Firefox's structured-clone breaks
on them (line 381-395).

### Subscription / broadcast

Two complementary channels:

1. **`eventBus.emit(EVENTS.broadcastToUI, {method, params})`** in the SW →
   `boardcastCallback` (line 401-409) → `pm.send('message', {event: 'broadcast', data})`
   → all connected popup ports → on the UI side
   `portMessageChannel.on('message', data => ...)` (`src/ui/app.tsx:135-139`) →
   `eventBus.emit(data.data.type, data.data.data)`.
2. **`syncStateToUI(BROADCAST_TO_UI_EVENTS.storeChanged, ...)`** auto-fired by
   `createPersistStore` (`background/utils/persistStore.ts:32-48`) on every
   property mutation:

```ts
const store = new Proxy(tpl, {
  set(target, prop, value) {
    target[prop] = value;
    persistStorage(name, target);
    syncStateToUI(BROADCAST_TO_UI_EVENTS.storeChanged, {
      bgStoreName: name, changedKey: prop, partials: { [prop]: value },
    });
    return true;
  },
});
```

So **every service-store mutation triggers a typed UI broadcast** with a diff
payload. The UI-side hooks (e.g. `src/ui/hooks/backgroundState/useAccount.ts`)
subscribe to `BROADCAST_TO_UI_EVENTS.accountsChanged`, mutate Redux via
`dispatch.account.…`, and React re-renders. Three layers (mutation → broadcast
→ Redux → React) but they are decoupled and the `Proxy(set)` is the magic that
makes "setting a service field" automatically sync the UI.

### Redux

`src/ui/store.ts:13` — `init<RootModel>({ models, plugins: [selectPlugin()] })`
using `@rematch/core` (Redux on top with the rematch DSL — models, reducers,
effects). 30+ models in `src/ui/models/` (account, chains, transactions, swap,
bridge, …). The pattern: each model has effects that call
`wallet.someControllerMethod()` and reducers that consume the result.

This is **a lot of UI-side state plumbing**. Most of it just mirrors background
state. For Nulo with Pinia, you already have a lighter equivalent.

---

## 5. dApp ↔ Background

### Provider injection chain

```
inpage script (pageProvider.js, MAIN world, document_start)
    ↕  postMessage via @metamask/post-message-stream
content-script (content-script.js, ISOLATED world)
    ↕  chrome.runtime.connect() Port
service worker (background.js)
    → providerController(req)   →  middleware pipeline (rpcFlow.ts)
```

1. **Inpage** — the actual `window.ethereum` object. Built from
   `@rabby-wallet/page-provider` (`src/content-script/page-provider.ts:1`).
   In MV3, it's registered via `chrome.scripting.registerContentScripts`
   with `world: 'MAIN'` (`_raw/sw.js:67-84`); in MV2 it's injected by appending
   a `<script>` tag (`src/content-script/index.ts:24-35`).
2. **Content-script** — `src/content-script/index.ts:42-78`. Sets up a
   `BroadcastChannelMessage` (named `rabby-content-script`, target
   `rabby-page-provider`) on top of `WindowPostMessageStream`, plus a `PortMessage`
   to the SW. Forwards `bcm.listen → pm.request`. Sends `contentScriptConnected`
   to the inpage on setup, and re-establishes streams when the SW pings
   `EXTENSION_MESSAGES.READY` (line 81-90). On `beforeunload`, disposes both.
3. **SW dispatch** — content-script ports (no `port.name`) hit the no-name branch
   in `src/background/index.ts:433-511`. Builds a `Session` keyed on `tab.id +
   origin`, attaches the `PortMessage`, and feeds requests into `providerController`.

### Approval flow

For every RPC method the dApp can call, providerController declares its approval
intent via `@Reflect.metadata('APPROVAL', [type, condition, options])`
(`src/background/controller/provider/controller.ts:605, 1421, 1518, 1617, …`).

`rpcFlow.ts` is a koa-style middleware stack
(`src/background/utils/promiseFlow.ts:1-26`, `src/background/controller/provider/rpcFlow.ts:39-502`):

```ts
const flow = new PromiseFlow<{request, mapMethod, approvalRes}>();
flow
  .use(checkMethod)             // map snake_case → camelCase, lookup handler
  .use(checkLockState)          // if locked, request 'Unlock' approval
  .use(checkConnect)             // if not permitted, request 'Connect' approval
  .use(checkNeedApproval)        // if @APPROVAL meta exists, requestApproval()
  .use(processRequest)           // call the handler with approval result
  .callback();
```

For sign requests it gets fancy. `checkNeedApproval` calls
`notificationService.requestApproval({approvalComponent: 'SignTx', …})`
(`rpcFlow.ts:281-294`). That opens a dedicated **notification window** (a
chrome.windows popup, NOT a chrome.action popup), 400×600, positioned to the
right of the user's last-focused window (`src/background/webapi/window.ts:31-99`).

`requestApproval` returns a Promise that resolves when the user clicks "Approve" in
that window — this is the **deferred approval** pattern. The data passes through
`approval.resolve(data)` set inside `notificationService.requestApproval`
(`src/background/service/notification.ts:289-318`).

The window auto-closes if the user focuses another window (line 133-150 of
notification.ts) — except for whitelisted `QUEUE_APPROVAL_COMPONENTS` (Unlock,
SignTx, hardware-waiting, …) which can survive focus changes.

### Origin gating

`permissionService` tracks per-origin state (`isConnected`, default chain, last
sign time). Every providerController method (except `@Reflect.metadata('SAFE', true)`
ones — `eth_chainId`, `eth_blockNumber`, etc.) is gated behind `permissionService.hasPermission(origin)`.

There's also dApp-level rate-limiting/blocking (`notification.ts:435-495`):
3 rejections from the same origin within 60s → mark `isBlocked` for 60s.
**Nulo doesn't have this; worth stealing.**

---

## 6. Storage & vault

### Layers

| Layer | API | Encrypted? | Survives SW idle? |
|---|---|---|---|
| `chrome.storage.local` | `src/background/webapi/storage.ts` (Map cache + browser API) | only the `vault` blob; everything else cleartext | yes |
| `chrome.storage.session` | direct `Browser.storage.session.get/set` | yes (Chrome-internal) | yes (until extension reload / browser quit) |
| Dexie (IndexedDB) | `src/db/index.ts` | no | yes |
| in-memory (SW heap) | global JS variables | n/a | no |

### `chrome.storage.local` cache

`src/background/webapi/storage.ts` is **the world's smallest L1 cache**:

```ts
let cacheMap: Map<string, any>;
const get = async (prop) => {
  if (cacheMap) return cacheMap.get(prop);
  const result = await browser.storage.local.get(null);  // load EVERYTHING once
  cacheMap = new Map(Object.entries(result ?? {}));
  return prop ? result?.[prop] : result;
};
const set = async (prop, value) => {
  await browser.storage.local.set({ [prop]: value });
  cacheMap.set(prop, value);
};
```

It loads the **entire** `storage.local` on first read and keeps it as a `Map`. Every
subsequent `get` is sync-fast. This is fine for Rabby's volume (settings, small
caches) but would explode if Nulo shoves PXE-sized blobs into `storage.local`.
Use IndexedDB for anything heavy.

### `createPersistStore`

`src/background/utils/persistStore.ts` — already shown. **Proxy-wrapped object
that auto-persists on mutation and broadcasts to the UI**. Used by 25+ services.
Pattern is dead simple:

```ts
this.store = await createPersistStore<PreferenceStore>({
  name: 'preference',
  template: { /* defaults */ },
});
this.store.locale = 'en';   // auto-persists, auto-broadcasts
```

The **template merge** (line 25 `tpl = Object.assign({}, template, storageCache)`)
is the migration sleight-of-hand: any new field added to the template shows up
on next boot without an explicit migration. Old fields that no longer exist in
the template still survive in storage (a tiny leak, but cheap).

### Encrypted vault format

The vault is `@metamask/browser-passworder`'s output: PBKDF2 (default 600k
iterations) → AES-GCM. JSON-encoded `{ data, iv, salt }`. Two flavours:

1. **Vault contents:** `serializedKeyrings` (each `{type, data}`) →
   `passwordEncrypt({ data, password, persisted: true })` → string in `store.vault`.
2. **Booted marker:** `passwordEncrypt({ data: 'true', password })` → string in
   `store.booted`. No `persisted` flag, so the exported key isn't stashed in
   session storage — it only matters at unlock-time as a password verifier.

**Notable:** non-secret keyring types (Watch, Hardware, WalletConnect, etc.) are
ALSO persisted **unencrypted** alongside the vault as `unencryptedKeyringData`
(`keyring/index.ts:964-980`). This is a security/UX trade-off: post-lock the
wallet can still display "you have a Ledger account at 0x…" without the vault
unlocked. Nulo equivalent would be address+pubkey kept outside the encrypted
seed/key store.

### Dexie

`src/db/index.ts:13-31` — Dexie IndexedDB with **6 schema versions** and an
inline `upgrade(trans)` for v6 (annotates `is_small_tx` retroactively). Used for
heavy tabular data: token cache, NFT cache, balance history, tx history, sync
metadata. Queried by `db.<table>.where(...)`. Service workers can open Dexie
freely — no restriction there.

---

## 7. Long-running ops

### Signing

The notification service uses a **deferred-resolution Promise** held in SW heap:

```ts
// notification.ts:289-318 (paraphrased)
return new Promise((resolve, reject) => {
  const approval = { id: uuid, data, resolve, reject, ... };
  this.approvals.push(approval);
  this.openNotification(approval.winProps);
});
```

The popup window mounts, calls `wallet.getApproval()` to read `data`, then either
`wallet.resolveApproval(result)` or `wallet.rejectApproval(reason)`. Those map to
`notificationService.resolveApproval` (line 190) / `rejectApproval` (line 219),
which call the parked `resolve` / `reject`.

Cancellation: closing the popup window emits `windowRemoved`; `notification.ts:121-131`
calls `rejectAllApprovals` if `isManuallyClosed`. The `pm.dispose()` on the UI
side rejects all in-flight Promises with `userRejectedRequest` (`message/index.ts:200-206`).

### "Resend / retry" pattern

`notificationService.setCurrentRequestDeferFn(fn)` (line 419) parks a function
that the UI can replay. `wallet.resendSign(retry)` calls back through to the
parked deferred. `bgRetryTxMethods` in `rpcFlow.ts:355-395` mutates the approval
result (bump nonce or gas price by 1.3×) and re-dispatches. This is how
"Speed up" / "Cancel" tx UI works.

### Pending tx watching

`src/background/service/transactionWatcher.ts:52-99` — periodic poll
(`interval-promise`, 2-5s based on chain block time, line 18-44) calling
`eth_getTransactionReceipt`. When confirmed, it fires a Chrome notification and
emits `EVENTS_IN_BG.ON_TX_COMPLETED`. The `transactionBroadcastWatchService` is a
sibling that watches not-yet-mined txs.

### Race conditions

Two patterns of note:

- **`PQueue` for serialization:** `src/utils/message/index.ts:10` is one global
  `PQueue({concurrency: 1000})` — basically just guarantees insertion order. They
  also use `p-queue` inside `walletController` for transaction queuing
  (line 118 of wallet.ts).
- **Origin-level dedup:** `lockedOrigins`, `connectOrigins` Sets in
  `rpcFlow.ts:32-33` block parallel "Unlock"/"Connect" requests from the same dApp.
- **`walletController.tryUnlock`** is idempotent (early-returns if already
  unlocked) so re-spawn boot can call it without checks.

There is **no** generic AbortController plumbing. Cancellation is by-promise-rejection.

---

## 8. Provider/RPC layer

There is **no** monolithic `JsonRpcEngine` like MetaMask's. Rabby's RPC pipeline:

1. dApp calls `window.ethereum.request({method, params})`.
2. inpage → content-script (BroadcastChannel) → SW (Port) → `providerController(req)`
   in `src/background/controller/provider/index.ts`.
3. providerController dispatches to method handlers in
   `src/background/controller/provider/controller.ts` via reflective lookup
   (`underline2Camelcase(method)`).
4. For methods that have `@Reflect.metadata('APPROVAL', …)`, `rpcFlow.ts`
   wraps the handler in approval-window-wait middleware.
5. For `eth_subscribe`/`eth_unsubscribe`, a per-port `subscriptionManager`
   (`controller/provider/subscriptionManager.ts:9-59`) uses
   `@metamask/eth-json-rpc-filters` + `@metamask/eth-block-tracker` — that's the
   only piece they took from the upstream JSON-RPC ecosystem.
6. For unknown `eth_*` methods, fall through to `providerController.ethRpc(req)`
   (`rpcFlow.ts:62-64`) which dispatches via `RPCService` to either
   user-configured custom RPC, the chain's default RPC, or DeBank-hosted backend
   (some methods are listed in `BE_SUPPORTED_METHODS` and proxied via `openapi`).

### Multi-chain

Chain switching is per-origin (`permissionService.updateConnectSite(origin, {chain})`)
and per-account (preference). When chain changes,
`broadcastChainChanged(origin)` (controller/utils, called from many places)
emits `chainChanged` to that origin's connected sessions. `subscriptionManager`
listens for `rabby:chainChanged` and updates `provider.chainId` so subscriptions
reroute.

Chain definitions live in `@debank/common` (200+ chains) plus a `customTestnet`
service for user-added EVM chains.

### Caching

`src/background/utils/rpcCache.ts` (mentioned, not deeply read) is a TTL cache
for safe read methods (`eth_chainId`, `eth_blockNumber`, recently-used calls).
Started in `restoreAppState()` line 147. Reduces RPC load.

---

## 9. Migrations

Two parallel systems:

### a) `src/migrations/` — for `chrome.storage.local` shapes

Pattern (`src/migrations/index.ts:19-49`):

```ts
export default async function () {
  const currentDataVersion = (await storage.get('dataVersion')) || 0;
  for (const migration of sortedMigrations) {
    if (migration.version > currentDataVersion) {
      const result = await migration.migrator(currentData);
      // … apply result
      dataVersion = migration.version;
    }
  }
  await storage.set('dataVersion', dataVersion);
}
```

Each migration is a tiny module (`{version, migrator(data)}`):

```ts
// src/migrations/connectedSiteMigration.ts:3-29
export default {
  version: 3,
  async migrator(data) {
    if (!data.permission) return undefined;
    const hasIsConnected = data.permission.dumpCache.every(c => 'isConnected' in c.v);
    if (hasIsConnected) return data;
    return { permission: { dumpCache: data.permission.dumpCache.map(...) } };
  },
};
```

10 migrations across keys like `permission`, `preference`, `transactions`, `rpc`.
Migration runs **once at SW boot, after openapi init, before service inits**
(`background/index.ts:116`). Critical ordering — services read from storage
during `init()`, so the schema must be current first.

### b) Dexie versioning

`src/db/index.ts:15-31`:

```ts
db.version(1).stores(schemaV1);
db.version(2).stores(schemaV2);
db.version(3).stores(schemaV3);
db.version(4).stores(schemaV4);
db.version(5).stores(schema);
db.version(6).upgrade((trans) => { /* annotate is_small_tx */ });
```

Dexie handles upgrades automatically; v6 demonstrates an inline-migration where
data shape changes.

The two systems don't coordinate — Dexie schema and storage shape evolve
independently.

---

## 10. Build & tooling

### Webpack config standout patterns

`build/webpack.common.config.js`:

- **`asyncChunks: false` on the background entry** (line 62-63). Single bundle.
- **Per-entry `oneOf` ts-loader configurations** (lines 88-157) — the UI bundle
  uses an antd-import transformer + antd-dayjs-webpack-plugin, others don't.
- **Manual `tsStyledComponentTransformer`** (lines 17-39, 149-156) — gives each
  styled-component a deterministic id with `componentIdPrefix: 'rabby-'` so
  hydration is stable.
- **`webextension-polyfill` cache group with priority 100** (line 379-385) —
  forces it into a shared chunk so all entries reference the same instance.
- **Firefox-specific splitChunks rules** (lines 369-398) limiting size to 4MB —
  Firefox AMO has a 4MB-per-file limit, so they aggressively split for FF only.
- **`experiments: { asyncWebAssembly: true, topLevelAwait: true }`** (lines 402-405).
- **CopyPlugin manifest selection** (line 302-307) — copies the right
  manifest.json based on `MANIFEST_TYPE` env var.

### Production hardening

`build/webpack.pro.config.js`:

- **TerserPlugin with `pure_funcs: ['console.log', 'console.debug', 'console.info']`**
  (line 71) — logs are stripped from prod.
- **Sentry source map upload** (lines 20-33) gated on `process.env.sourcemap`.
- **`SecSDK` (`supplychain_security_sdk`)** (lines 35-62) — currently behind
  `false &&`, but implements LavaMoat-style "scuttle" hardening that locks down
  global mutation via Reflect/Proxy. Disabled but kept in tree.

### Build env flags

`process.env.MANIFEST_TYPE` — `chrome-mv2 | chrome-mv3 | firefox-mv2`. Drives the
manifest selection and several runtime branches via `isManifestV3`
(`src/utils/env.ts:24` reads from `browser.runtime.getManifest()` at runtime —
not env-var, so the same code adapts).

`process.env.RABBY_BUILD_ENV` — `dev | pro | debug | sourcemap`.

### Patches

`patches/` (yarn-patch-package format):
- `@coinbase+wallet-sdk` — Coinbase fixes
- `@debank+common` — chain-list adjustments
- `@ethereumjs+tx` — likely L2/EIP-7702 adjustments
- `@ledgerhq+hw-app-eth` — Ledger fixes
- `@metamask+eth-sig-util` — sig util adjustments
- `dom-align`, `typescript-plugin-styled-components` — UI/build

Sign of a mature codebase that doesn't shy from patching deps. Worth Nulo
adopting `patch-package` when it hits this stage.

### Test stack

Jest with `ts-jest` (`jest.config.js:46-53`). Tests in `__tests__/` mirror
`src/`. Minimal coverage — keyring service has the most (`__tests__/service/keyring.test.ts`),
plus migrations. Most of the wallet is untested at the SW level. They lean on
manual + Sentry.

---

## 11. What's worth stealing for Nulo

These are concrete, portable patterns. Annotated with a Nulo-mapping where
relevant.

### a) Hand-written `_raw/sw.js` + `importScripts(background.js)`

Already partially mirrored in Nulo (you have a hand-controlled SW entry). The
specific lesson is **putting the keep-alive `chrome.runtime.onMessage` listener
and `chrome.scripting.registerContentScripts` synchronously at top-level of the
non-bundled file**, so they survive cold-spawn races. If your `service-worker.ts`
is bundled, audit whether install/onMessage handlers register before the first
async tick.

### b) `storage.session` for the unlock survivor

The pattern in `background/utils/password.ts:36-83` — encrypt seed/keys with the
user password via PBKDF2, persist the encrypted blob to `chrome.storage.local`,
and **also stash the derived key in `chrome.storage.session`** so SW respawn
can decrypt without re-prompting. Nulo's wallet-crypto KDF + PasswordSecretBox
already supports this in principle — wire it through to `storage.session` if
you haven't. The auto-lock service (`autoLock.ts`) is the partner pattern: store
the deadline in session, re-arm on respawn.

Concrete file to study: `src/background/utils/password.ts:60-145`. Direct copy
pattern.

### c) `createPersistStore` (Proxy-based store)

`src/background/utils/persistStore.ts:1-65` — 60 lines that give you (a) typed
fields, (b) auto-persist on mutation, (c) auto-broadcast to UI, (d)
template-merge migration. Nulo's `EntityStorage` / `ValueStorage` could grow a
sibling for "small reactive object stores" with the same Proxy trick. Pinia
already gives you reactivity in the popup; what this pattern adds is
**broadcast on SW-side mutation** with diff payloads.

### d) The koa-style `PromiseFlow` middleware

`src/background/utils/promiseFlow.ts:9-26` is just **17 lines** wrapping `koa-compose`.
It's the right abstraction for a pipeline of `(ctx, next) => Promise<void>` that
gates RPC requests through lock-check, permission-check, approval-prompt,
handler. Nulo's `wallet-bridge` dispatcher could adopt this for AIP-1193 +
Aztec method gating without taking on a JSON-RPC engine.

For Nulo specifically, the equivalent layers would be: `aztec_*` method
identification → unlock check (is the wallet decrypted?) → origin permission
check → user-approval prompt for sensitive ops (sign/decrypt/send) → handler.

### e) `@Reflect.metadata` for declarative method policy

`provider/controller.ts:447-1951` — methods are decorated with `@Reflect.metadata('APPROVAL', [type, condition, options])` etc. Then `rpcFlow.ts` reads them via
`Reflect.getMetadata('APPROVAL', providerController, mapMethod)`. **Method handlers
self-declare their gating policy.** No central config, no switch statement.

For Nulo: each `aztec_*` method handler can declare `requiresUnlock`,
`requiresApproval`, `requiresPermission(origin)` via decorators. The dispatcher
becomes a generic gate runner.

### f) `Proxy`-based `wallet` controller proxy on the UI side

`src/ui/app.tsx:67-133` — `new Proxy({}, { get: (_, key) => (...args) => port.request({method: key, params: args}) })`.
Then cast to the controller's TS type. Zero IPC ceremony.

For Nulo, you have `ServiceClient<Methods, Events>` which is more typed. The
Rabby pattern is **less safe but cheaper**. The hybrid: keep your typed
`ServiceClient` for service-bound facets, add a generic `Proxy`-based "controller
RPC" for the long-tail of one-off methods so adding a method doesn't require
touching message types.

### g) Notification window for sensitive approvals

`background/webapi/window.ts:31-99` + `service/notification.ts`. Open a 400×600
popup window for sign/connect/unlock approvals **separate from the main popup**.
That window can survive focus changes (whitelist of approval components).
**This is the pattern users expect** — MetaMask, Rabby, Phantom all do it.

For Nulo: when a dApp triggers `aztec_decrypt` or `aztec_sendTx`, popup a
dedicated window so the popup popup can keep working. Nulo already has windows
infrastructure (`src/popup/windows/`). The missing piece is the deferred-Promise
queue (`requestApproval` returning a Promise that the window resolves).

### h) Migration-on-boot pattern

`src/migrations/index.ts:1-49` — versioned migrations sorted by version, applied
in order, gated by a single `dataVersion` key in storage. **Idempotent re-runs**
(if `dataVersion >= maxVersion`, skip).

Nulo already has `src/wallet/storage/migrate.ts` (mentioned in CLAUDE.md). The
Rabby pattern adds **per-key migrators** so each migration only touches the
storage shape it owns. Easier to reason about than a monolithic migrate
function.

### i) Origin-level rate-limiting

`service/notification.ts:435-495` — track per-origin rejection counts; auto-block
for 60s after 3 rejections. Zero-cost spam protection. Trivial to port.

### j) `transactionWatcher` with chain-aware polling intervals

`service/transactionWatcher.ts:18-44` — clamp poll interval to 2-5s based on the
chain's block interval. Survives SW respawn because the pending-tx state lives
in `createPersistStore` and `roll()` is called from `restoreAppState`. For Nulo
that's the same pattern: pending-tx state in storage, watcher restarts on every
SW boot.

---

## 12. What's over-engineered or fragile

### a) The 7055-line `WalletController` mega-class

`src/background/controller/wallet.ts` is **one class with hundreds of methods**.
No domain segmentation, no internal structure beyond `// region`-style
comments. Searching for a method requires `grep`. Methods routinely call each
other across unrelated domains. This is the worst code-smell in the entire
project.

For Nulo: keep your service-bound granularity (`AccountServiceClient`,
`ProfileService`, etc.) — do not collapse into one mega-controller. Rabby
clearly grew this organically and now can't refactor without pain.

### b) Untyped `eventBus`

`src/eventBus.ts` accepts any string and any payload. `EVENTS` and `EVENTS_IN_BG`
constants try to discipline this but TS doesn't enforce them. In a 7000-line
controller, a typo'd event name silently fails. Nulo: type your event bus or
prefer `Service.on*` typed event helpers.

### c) Two separate event namespaces, manually maintained

`EVENTS` for UI-bound, `EVENTS_IN_BG` for SW-internal. Nothing prevents using
them in the wrong place. A single typed bus per direction (`uiBus`, `bgBus`)
with discriminated unions would be safer.

### d) The `wallet` Proxy + cast-to-WalletControllerType

It's elegant but **lies about runtime safety**. There is no schema validation
between UI and SW. If you rename a controller method, the UI build still
compiles (because the cast hides errors) — until runtime, when the SW returns
"method not found". Build a runtime check (e.g. assert at startup that all
controller methods exist) or use a code-generated stub.

### e) Mixed `chrome.alarms` / `setInterval` branching

`src/background/service/syncChain.ts:67-90` registers both. In `MV3`, it adds an
`onAlarm` listener **inside** `resetTimer()` — every call to `roll()` registers a
new listener. Listener leak waiting to happen (the listener guards by alarm
name, so it functionally works, but the Set of listeners grows). Same pattern
in `metamaskModeService.ts`. Cleaner: register once globally in
`background/index.ts:548-556`.

### f) `clearAlarms()` on every SW spawn

`_raw/sw.js:3-10`:

```js
const clearAlarms = async () => {
  const alarms = await chrome.alarms.getAll();
  alarms.forEach((alarm) => {
    if (/^ALARMS/.test(alarm.name)) chrome.alarms.clear(alarm.name);
  });
};
```

They blanket-clear all `ALARMS*`-named alarms on every SW boot. Then `restoreAppState`
re-creates the ones it needs. This is defensive but **discards in-flight delays**
— a 60-min-period alarm with 50min remaining gets reset to 60min. Acceptable
for telemetry, broken for anything time-sensitive.

### g) Blanket `await browser.storage.local.get(null)` on first read

`background/webapi/storage.ts:14` reads the **entire** storage.local in one go and
caches it. On a wallet with 5MB of token cache, balance history, etc., that's a
big sync hit at SW boot. Nulo should keep storage hot data in IndexedDB and
restrict `chrome.storage.local` to small config + the encrypted vault.

### h) The MV2 codebase still ships

Maintaining `chrome-mv2` and `firefox-mv2` alongside MV3 is **a lot of
conditional code**. Every alarm handler, every offscreen interaction, every
session-storage call has an `if (isManifestV3)` branch. Rabby probably can't drop
MV2 because of Firefox lag. Nulo has the luxury of being **MV3-only** —
take it. `isManifestV3` shouldn't appear in your codebase.

### i) Chrome-Linux-Vivaldi quirks bleed everywhere

`src/background/service/notification.ts:133-150` has explicit checks for
`IS_VIVALDI`, `IS_LINUX`, `IS_CHROME && WINDOWS`. The notification window
focus-loss-rejects-approval logic does not work consistently across browsers,
so they sniff. Each browser-version regression adds a new branch. Architectural
flag: **focus-based UX is fragile**; consider explicit "Cancel" buttons + a
debounce window over implicit focus-loss handling.

### j) Sentry-as-postmortem

Several places (`ui/app.tsx:240`, `service/notification.ts:172-174`,
`service/keyring/index.ts:1089-1091`) capture exceptions to Sentry but **don't
recover**. Sentry is treated as a substitute for proper error boundaries. This
shows up especially in `keyringService` where a transport-error during signing
is reported but the user sees a hung UI. Nulo: explicit error states + UI
feedback over Sentry-dump.

### k) Untyped JSON-RPC pipeline

There is no `JsonRpcMiddleware`-style typed pipeline. `ProviderRequest` is an
ad-hoc shape (`controller/provider/type.ts`, ~22 lines). Method handlers have
no guarantee about params shape — they pluck and validate ad-hoc. For an
EVM wallet handling 50+ methods this is risky; for Nulo handling a smaller
Aztec method set it's manageable, but typed-method-handlers (one zod/valibot
schema per method) would catch a class of bugs at compile time.

### l) Single `notifiWindowId` global state

`service/notification.ts:87` tracks one window. If concurrent dApps trigger
approvals, the first dApp's window closes when the second one opens
(`openNotification` line 404-406). The approval queue (`approvals[]`) handles
this by rendering them sequentially in the new window, but the state machine
around `currentApproval`, `approvals`, `notifiWindowId`, `isLocked` is genuinely
hard to reason about — it's the source of multiple historical bugs visible in
Sentry-ignore lists. For Nulo, a smaller wallet, prefer **one approval at a time,
hard-block subsequent prompts** with a clear "Wallet busy" error to the second
dApp. Skip the queue entirely.

---

## Bottom line for Nulo

Rabby is a **good MV3 reference for the "how do I survive Chrome's SW model"**
problem. The standout patterns to port are: hand-written `sw.js` with
`importScripts`, `storage.session` for unlock-key survival, `createPersistStore`
Proxy + auto-broadcast, `PromiseFlow` middleware for RPC gating, decorator-driven
method policy, deferred-Promise approval windows, versioned migrations.

Rabby is a **bad reference for code organization**. Don't copy the 7000-line
controller. Don't copy the untyped event bus. Don't ship MV2 alongside MV3 if
you don't have to. Don't lean on Sentry as your error-boundary strategy.

Specifically, the keyring service split (`store` vs `memStore`,
`vault` vs `booted` vs `unencryptedKeyringData`, in-heap `password` field) is the
**single most valuable artifact** in this codebase — a battle-tested model for
"encrypted persistent + ephemeral + session-survivable" state. Read
`src/background/service/keyring/index.ts` lines 110-475 carefully before you
finalize Nulo's lock model.
