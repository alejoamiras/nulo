# MetaMask Extension Architecture Analysis

Independent analysis based only on the MetaMask extension repository at `(MetaMask source tree)`. I did not consult sibling writeups under `wallets-architecture-research/` before forming this view.

## 1. Manifest & entry points

MetaMask is not a single extension architecture. It is a matrix. The source manifests keep both MV2 and MV3 alive, and the final build rewrites some of the declared entry points. In source, MV3 declares a service worker entry at `service-worker.ts`, separates `contentscript.js` from `inpage.js`, and runs the page-provider script in the `MAIN` world; it also requests `offscreen`, `sidePanel`, and a sandbox page for Snaps (`snaps/index.html`) (`app/manifest/v3/_base.json:16-18`, `app/manifest/v3/_base.json:38-55`, `app/manifest/v3/_base.json:80-96`). MV2 stays on the old persistent `background.html` model and injects both `contentscript.js` and `inpage.js` together as ordinary content scripts (`app/manifest/v2/_base.json:3-6`, `app/manifest/v2/_base.json:31-37`).

The browser split is equally revealing. Chrome MV3 gets a side panel and modern CSP, but Firefox still falls back to a manifest-v2 persistent background page even under the `v3` variant directory (`app/manifest/v3/chrome.json:1-16`, `app/manifest/v3/firefox.json:1-25`). This is a concrete sign that MetaMask’s “architecture” is really a compatibility envelope, not one clean runtime model.

The build system adds another layer. The source manifest says `service-worker.ts`, but the build rewrites the actual MV3 background entry to `scripts/app-init.js` and prepends lockdown scripts to content scripts (`development/build/manifest.js:252-263`). That rewrite matters because the real shipped boot chain is `app-init.js` plus chunk imports, not a single raw TypeScript service worker file.

Build flavors are first-class too: package scripts support default, `flask`, `beta`, and test variants, while MV2 remains selectable with `ENABLE_MV3=false` (`package.json:9-30`, `package.json:35-48`). So the right mental model is not “MetaMask supports MV3”; it is “MetaMask carries multiple operational products behind one repo.”

## 2. Service worker architecture

MetaMask’s MV3 boot is dominated by one requirement: start listening before the worker finishes loading. Both `app/service-worker.ts` and the generated `app/scripts/app-init.js` install an `ExtensionLazyListener` immediately, before importing the heavy background bundle, and stash it on `globalThis.stateHooks` so later code can attach handlers after the fact (`app/service-worker.ts:9-17`, `app/scripts/app-init.js:11-25`). That is a pragmatic answer to MV3’s race: the browser can deliver `onInstalled` or `onConnect` while the wallet is still cold.

The worker also performs explicit liveness handshakes. On raw port connection it immediately posts `APP_INIT_LIVENESS_METHOD`; the background bundle later sends `BACKGROUND_LIVENESS_METHOD`, then waits for initialization to complete before sending `BACKGROUND_INITIALIZED_METHOD` and only then connects the full RPC/state channels (`app/service-worker.ts:47-69`, `app/scripts/background.js:605-644`). This is better than guessing whether the worker is “hung”: UI code can distinguish “service worker awake,” “background initialized,” and “state sync ready.”

Persistence and hydrate are relatively disciplined. `initialize()` creates the MV3 offscreen document early, installs connectivity listeners before any `await`, then loads persisted state, creates a cronjob storage manager, loads preinstalled snaps, and only then calls `setupController()` (`app/scripts/background.js:800-897`). `loadStateFromPersistence()` goes through `PersistenceManager`, runs versioned migrations, validates the post-migration shape, and handles both monolithic `data` storage and split-controller storage (`app/scripts/background.js:1044-1268`).

The keep-alive strategy is the most revealing compromise in the whole codebase. In MV3, if the user preference does not disable it, MetaMask writes a timestamp to `browser.storage.session` every two seconds “to keep the service worker alive” (`app/scripts/background.js:847-855`, `app/scripts/background.js:745-748`). This is not elegant. It is a survival tactic. For Nulo, that matters: if proof generation can take seconds or minutes, MetaMask’s code is strong evidence that long-running extension work should not rely on vanilla MV3 worker lifetime alone.

## 3. LavaMoat / SES

What LavaMoat buys here is concrete, not abstract. First, MetaMask can run under SES lockdown so language intrinsics are frozen and object mutation attacks get harder. Second, dependencies are granted capabilities through a policy file instead of full ambient authority. Third, in production/test builds the runtime can “scuttle” most of `globalThis`, leaving only an exception list accessible (`app/scripts/lockdown-run.js:1-20`, `development/build/index.js:95-192`, `lavamoat/webpack/mv3/main/policy.json:1-60`).

But the code also shows how much hand-work is required to make that true in a browser extension. `bootstrap.ts` explicitly runs outside LavaMoat just to set up global hooks and Sentry (`app/scripts/load/bootstrap.ts:1-13`). The non-LavaMoat path loads `ses` via `lockdown-install.js`, then calls `lockdown()` with `consoleTaming: 'unsafe'`, `errorTaming: 'unsafe'`, and `domainTaming: 'unsafe'` to preserve functionality (`app/scripts/lockdown-run.js:1-20`). Then `lockdown-more.js` manually hardens more globals, marks many properties non-configurable/non-writable, and works around LavaMoat scuttling behavior by checking `new Compartment().globalThis` and special-casing scuttled properties (`app/scripts/lockdown-more.js:1-105`).

The policy format is standard LavaMoat: a top-level `resources` map granting package-local package and global access, sometimes with notes about webpack optimization side effects (`lavamoat/webpack/mv3/main/policy.json:1-60`). The build flow wraps Browserify with `lavamoat-browserify`, injects `policy-load.js`, and copies both SES assets and LavaMoat runtimes into the final extension (`development/build/scripts.js:573-637`, `development/build/static.js:161-191`).

The honest cost is high. There are separate boot paths for LavaMoat and non-LavaMoat HTML/script loading (`development/build/scripts.js:1208-1228`, `app/scripts/app-init.js:98-109`). Production scuttling needs a very long exception list including `Proxy`, `Reflect`, `navigator`, `harden`, `fetch`, `setTimeout`, and many more (`development/build/index.js:98-161`). That does not mean LavaMoat is fake; it means the real security boundary is negotiated, not pure. MetaMask is buying a narrower blast radius for dependency compromise, but paying with build complexity, environment skew, bootstrap fragility, and harder debugging.

My verdict: for a wallet, LavaMoat/SES is serious defense-in-depth. It is also a sustained operational tax. Small teams should not copy it casually.

## 4. Controller architecture

The cleanest architectural idea in MetaMask is not `metamask-controller.js`; it is the messenger pattern under it. `getRootMessenger()` creates a single root bus (`app/scripts/lib/messenger.ts:11-37`). `initMessengerClients()` then initializes controllers in a declared order, creating per-controller restricted messengers and optional init-only messengers from `MESSENGER_FACTORIES`, and it throws if a controller is requested before being initialized (`app/scripts/messenger-client-init/utils.ts:77-207`). That last behavior matters: order dependence is explicit instead of accidental.

The restricted-messenger pattern is real least-privilege. For example, the NetworkController’s runtime messenger gets only `ConnectivityController:getState`, while its init messenger additionally gets a tiny set of metrics, feature-flag, and event subscriptions (`app/scripts/messenger-client-init/messengers/network-controller-messenger.ts:22-45`, `app/scripts/messenger-client-init/messengers/network-controller-messenger.ts:65-100`). This scales better than passing whole controller instances everywhere.

Repo-local controller code also shows how `BaseController` is meant to work. `AccountOrderController` extends `BaseController`, defines explicit state metadata including `persist` and `usedInUi` flags, and exposes method handlers through the messenger (`app/scripts/controllers/account-order.ts:1-109`). `ComposableObservableStore` then aggregates child controller state and uses `deriveStateFromMetadata` so persisted projections can omit non-persistent fields (`app/scripts/lib/ComposableObservableStore.js:1-98`, `app/scripts/lib/ComposableObservableStore.js:129-151`). `background.js` relies on that metadata when re-backing up controller state, and even asserts that controllers in backup-critical keys must extend `BaseController` and define metadata (`app/scripts/background.js:1601-1629`).

I cannot inspect `@metamask/base-controller` package internals from this repo snapshot, so I will not overclaim about `ComposableController` internals. What is visible is enough: MetaMask’s scaling story is “typed controller + metadata + restricted messenger + composable state projection.”

`metamask-controller.js` is both a principled wiring root and a god class. It is principled because it is the single place that defines controller init order, composes persisted vs in-memory state, and exposes shared transport/setup primitives (`app/scripts/metamask-controller.js:624-736`, `app/scripts/metamask-controller.js:1364-1495`). It is a god class because the same file also owns UI sync, provider transport, JSON-RPC engine construction, vault lifecycle, Snap routing, connection accounting, and event subscriptions (`app/scripts/metamask-controller.js:1912-1955`, `app/scripts/metamask-controller.js:7183-7601`, `app/scripts/metamask-controller.js:7732-8213`, `app/scripts/metamask-controller.js:4922-4973`). The wiring model is good. The concentration of responsibilities is not.

## 5. UI ↔ Background

The UI talks to the background over a single runtime port, but it does not treat that as one undifferentiated channel. `ui.js` wraps the port in `ExtensionPortStream`, multiplexes it into `controller`, `provider`, and `patch-store` substreams, and explicitly ignores the two liveness channels (`app/scripts/ui.js:104-121`, `app/scripts/ui.js:332-345`). That separation is important: provider traffic, control RPC, and state patching have different lifecycles and error semantics.

The boot ordering is disciplined. The UI waits for `START_UI_SYNC` before initializing the provider, because provider setup writes a global `ethereumProvider` that the rest of the UI assumes exists (`app/scripts/ui.js:121-147`, `app/scripts/ui.js:353-361`). On the background side, `setupControllerConnection()` sends the full initial state first, then turns on patch tracking at exactly the right point to avoid missed or duplicated updates (`app/scripts/metamask-controller.js:7399-7421`).

The most interesting piece is the patch store. MetaMask does not mirror the whole background state tree on every mutation. `setupPatchStoreConnection()` wraps `memStore` in a `PatchStore`, buffers deduplicated JSON patches, and only sends them once the UI signals readiness (`app/scripts/metamask-controller.js:7183-7314`). The UI-side `PatchStoreSubstreamConnection` handles both push notifications and explicit `getStatePatches` polling, and it rejects pending requests on disconnect so callers do not hang forever (`ui/store/patch-store-substream-connection.ts:41-260`).

Redux is deliberately secondary. The `metamask` slice is a flattened proxy of background state, Redux state is not persisted locally, and serializable/immutable checks are disabled for performance (`ui/store/store.ts:39-45`, `ui/store/store.ts:65-89`). That is a sane choice for a wallet extension: the background is the source of truth, and the UI is a projection layer.

## 6. dApp ↔ Background

The injected-provider path is stream plumbing first, RPC second. In MV3, the isolated-world content script decides whether to inject at all, handles prerender/BFCache edge cases, and restores or destroys streams on `pageshow`/`pagehide` (`app/scripts/contentscript.js:18-52`). The page-world `inpage.js` creates a `WindowPostMessageStream`, wraps it in `ObjectMultiplex`, and initializes the EIP-1193 provider in the page itself (`app/scripts/inpage.js:62-130`).

The important design detail is that MetaMask treats page context and extension context differently. In page context it intentionally avoids graceful shutdown handlers because the browser destroys the whole world on navigation anyway (`app/scripts/inpage.js:71-101`). In extension context it does the opposite: both the page mux and the extension mux proactively `end()` on transport shutdown because “Premature close” errors were the top Sentry issue (`app/scripts/streams/provider-stream.ts:56-98`, `app/scripts/streams/provider-stream.ts:125-172`). That is mature engineering: the same stream abstraction gets different lifecycle policy depending on which side owns cleanup.

Approval and permission flow are layered on top of this transport. `eth_requestAccounts` is essentially a compatibility wrapper around permissions, with a per-origin lock so concurrent requests fail fast instead of racing (`app/scripts/lib/rpc-method-middleware/handlers/request-accounts.ts:71-182`). `wallet_requestPermissions` rewrites legacy `eth_accounts` and `endowment:permitted-chains` requests into CAIP-25 form, then reconstructs legacy-looking granted permissions from the CAIP-25 caveat for backward compatibility (`app/scripts/lib/rpc-method-middleware/handlers/wallet-requestPermissions.ts:96-189`). One especially telling detail: a background permission API path still manually asks `ApprovalController` for approval and then calls `PermissionController.grantPermissions()` because the CAIP-25 permission factory is missing (`app/scripts/controllers/permissions/background-api.ts:322-363`). MetaMask’s modern permissions model is good, but compatibility debt leaks through.

## 7. KeyringController & vault

The keyring architecture is broader than “encrypted mnemonic.” `KeyringControllerInit` chooses different hardware bridges depending on MV2 vs MV3: iframe bridges in MV2, offscreen bridges in MV3. It also adds QR keyrings and Snap keyrings into the same controller (`app/scripts/messenger-client-init/keyring-controller-init.ts:57-115`). That is a practical unification layer: SRP, hardware, QR, and Snap-driven account providers all pass through one authority.

At-rest encryption is explicit. `encryptorFactory()` wraps `@metamask/browser-passworder` and forces PBKDF2 with a caller-specified iteration count; the keyring controller is initialized with `encryptorFactory(600_000)` (`app/scripts/lib/encryptor-factory.ts:17-122`, `app/scripts/messenger-client-init/keyring-controller-init.ts:110-115`). SnapController uses the same KDF strength for its own encrypted state (`app/scripts/messenger-client-init/snaps/snap-controller-init.ts:123-127`).

Vault lifecycle is centralized in `metamask-controller.js`, not hidden inside the keyring controller. Creating a new vault clears permissions, clears Snap state, resets account-tree state, and clears unapproved transactions before asking the multichain account service to create the wallet (`app/scripts/metamask-controller.js:4922-4973`). Restoring from mnemonic repeats the same reset discipline, then rebuilds accounts, reinitializes the account tree, and forwards selected accounts to the Snap keyring (`app/scripts/metamask-controller.js:5258-5352`).

Unlock is also broader than decrypt-and-go. `submitPasswordOrEncryptionKey()` waits for the offscreen document first, then unlocks the keyring, refreshes block data opportunistically, updates accounts, initializes multichain accounts, rebuilds the account tree, and asynchronously resyncs/aligns accounts to repair known Snap-account drift (`app/scripts/metamask-controller.js:5510-5568`). That is good operationally, but it also means “unlock” is a major workflow, not a cheap state flip.

One limit of this repo-only analysis: the exact serialized vault schema lives in `@metamask/browser-passworder`, not here. Repo-local evidence shows the stored vault is JSON containing at least a `salt`, because the session-login path parses the vault JSON and checks `jsonVault.salt` against `loginSalt` before submitting the encryption key (`app/scripts/metamask-controller.js:5592-5610`). I would not claim more than that from this snapshot.

## 8. JsonRpcEngine middleware

MetaMask’s EIP-1193 engine is classic `JsonRpcEngine`: a long ordered middleware chain where architecture lives in ordering, not in inheritance. The pipeline starts by annotating requests with origin, main-frame origin, selected network, tab ID, and frame ID; then comes logging, permission logging, tracing, origin throttling, execution-permission blocking, PPOM, dapp swap, trust signals, RPC method tracking, unsupported-method filtering, Snap permission helpers, legacy `eth_accounts`, permission enforcement, onboarding, non-EVM filtering, method dispatch, Snap methods, subscriptions, wallet-specific middleware, and finally the actual provider transport (`app/scripts/metamask-controller.js:7732-8213`).

That ordering is not arbitrary. MetaMask wants metadata and abuse controls early, permissionless compatibility shims before permission enforcement only where necessary, and actual RPC method implementation after permissions but before the provider fallback. The comment on `eth_accounts` being intentionally placed ahead of the permission middleware is a perfect example of compatibility-driven ordering (`app/scripts/metamask-controller.js:7884-7890`).

The CAIP multichain engine is a separate pipeline, not a thin variant. It begins with origin/tab/frame metadata and logging, gates methods to a small allowed set, requires the Snap multichain-provider permission where relevant, validates multichain method calls, dispatches session-based APIs, blocks legacy Ethereum account methods, supports onboarding, and only then runs invoked-method handlers and PPOM (`app/scripts/metamask-controller.js:8235-8445`). This is the right call architecturally: session-based multichain RPC really is a different protocol surface.

The upside of this model is extensibility. The downside is that the full ordering contract now lives in one giant file and is easy to break accidentally. For Nulo, the lesson is to keep the middleware idea but make the assembly more modular than MetaMask did.

## 9. Snaps

Snaps are present here, and in MV3 they are not “just iframes.” The MV3 manifest declares `snaps/index.html` as a sandbox page (`app/manifest/v3/_base.json:94-96`). The build then copies the Snap execution environment iframe assets into that path from `@metamask/snaps-execution-environments` (`development/build/static.js:198-210`). The offscreen document initializes `ProxySnapExecutor` against `./snaps/index.html`, alongside hardware wallet bootstrapping (`app/offscreen/offscreen.ts:20-27`, `app/offscreen/offscreen.ts:33-47`).

Execution topology depends on runtime. `ExecutionServiceInit` picks `OffscreenExecutionService` in MV3 when `chrome.offscreen` exists, and falls back to `IframeExecutionService` otherwise (`app/scripts/messenger-client-init/snaps/execution-service-init.ts:40-91`). Each Snap gets both an EIP-1193 provider path and a CAIP multichain provider path over a multiplexed stream (`app/scripts/messenger-client-init/snaps/execution-service-init.ts:51-66`).

Capabilities are explicit. `SnapControllerInit` passes the full set of environment endowment permissions, an exclusion map, feature flags, an encryptor, a mnemonic-seed hook, and onboarding/metrics hooks into `SnapController` (`app/scripts/messenger-client-init/snaps/snap-controller-init.ts:102-142`). Endowments include network access, cronjobs, RPC, WebAssembly, multichain provider, assets, protocol, and keyring capabilities, while `endowment:caip25` is explicitly excluded for now (`shared/constants/snaps/permissions.ts:1-27`).

This is sophisticated sandboxing, but it is also heavy. Snaps in MV3 require a sandbox page, an offscreen document, messenger plumbing, capability declarations, and special provider setup. The benefit is real extensibility with explicit endowments. The cost is that MetaMask effectively ships a platform inside the wallet.

## 10. Migrations

The migration system is one of the strongest parts of the architecture. `app/scripts/migrations/index.js` is an explicit ordered list from `002` through `207`, including point releases like `120.2`, `134.1`, and `183.1` (`app/scripts/migrations/index.js:11-248`). This is not glamorous, but it is operationally serious.

The `Migrator` does more than run numbered functions. It sorts migrations, distinguishes legacy migrations from “split state” migrations using a `MIGRATION_V2_START_VERSION` of `186`, and requires newer migrations to mutate state in place while reporting which controllers changed (`app/scripts/lib/migrator/index.js:18-123`). That changed-controller set then feeds directly into split persistence so MetaMask does not have to rewrite every controller key after every migration (`app/scripts/background.js:1247-1259`).

The migration examples show good hygiene. Migration `040` simply deletes obsolete `ProviderApprovalController` state after site connections moved to the permissions system (`app/scripts/migrations/040.js:5-23`). Migration `134.1` is much more defensive: it validates the presence and shape of account/network/token state step by step and reports anomalies to Sentry instead of corrupting state blindly (`app/scripts/migrations/134.1.ts:13-180`).

This runs on hydrate, before controller construction, inside `loadStateFromPersistence()` (`app/scripts/background.js:1103-1132`). For a wallet with evolving state schema, this is the right place. Nulo should copy this pattern almost wholesale.

## 11. Build & tooling

MetaMask’s build story is not tidy. The documented build system is still Gulp tasks plus Browserify/Babelify for source bundling (`development/build/README.md:17-23`). `development/build/scripts.js` wires `lavamoat-browserify`, bundle factoring, and policy-loader generation on top of that (`development/build/scripts.js:573-637`). At the same time, package scripts expose a parallel webpack/LavaMoat path, including separate policy-generation commands for MV2 and MV3 across build types (`package.json:10-18`).

MV3 adds a bespoke `app-init.js` bundle whose job is basically “boot the worker and import everything else.” The build injects environment variables for `USE_SNOW`, `APPLY_LAVAMOAT`, and the list of background chunk filenames, writes the result to `scripts/app-init.js`, and even mutates the generated runtime in tests to turn on initialization stats (`development/build/scripts.js:436-482`, `app/scripts/app-init.js:74-119`).

This architecture exists for understandable reasons: Firefox file-size constraints, LavaMoat policy generation, MV2/MV3 divergence, build-type divergence, and long-lived historical tooling. But the net result is high operational complexity. The codebase is not just a wallet; it is a compatibility and security build platform.

## 12. What Nulo should steal

First, steal the restricted messenger pattern. A root bus plus per-controller restricted messengers gives you explicit dependency declarations and prevents incidental coupling (`app/scripts/lib/messenger.ts:30-37`, `app/scripts/messenger-client-init/utils.ts:116-184`, `app/scripts/messenger-client-init/messengers/network-controller-messenger.ts:28-45`). For Nulo, this is especially useful when proof orchestration, PXE lifecycle, accounts, approvals, and network state all need to talk without becoming one blob.

Second, steal the migration framework. The combination of explicit ordered migrations, hydrate-time execution, and “changed controller” reporting after version `186` is exactly the kind of boring robustness an extension wallet needs (`app/scripts/lib/migrator/index.js:36-123`, `app/scripts/background.js:1129-1260`, `app/scripts/migrations/index.js:11-248`).

Third, steal the approval queue. `ApprovalController` is non-persisted, UI-driven, and explicitly excludes some approval types from rate limiting (`app/scripts/messenger-client-init/confirmations/approval-controller-init.ts:16-45`). Combined with permission flows that route through approval instead of letting RPC handlers ad-lib UI state, this is the correct abstraction boundary (`app/scripts/controllers/permissions/background-api.ts:322-363`).

Fourth, steal the patch-based UI sync model. MetaMask’s background is authoritative, the UI gets one initial state plus incremental patch updates, and disconnects are treated as first-class (`app/scripts/metamask-controller.js:7183-7314`, `ui/store/patch-store-substream-connection.ts:41-260`, `ui/store/store.ts:65-89`). For Nulo, this is much better than duplicating proof/task state machines independently in popup and service worker.

Fifth, steal the offscreen-island idea, but use it more intentionally than MetaMask’s keepalive hack. MetaMask already relies on offscreen documents for hardware and Snaps in MV3 (`app/scripts/offscreen.js:29-102`, `app/offscreen/offscreen.ts:20-27`, `app/scripts/messenger-client-init/snaps/execution-service-init.ts:68-77`). Nulo should use an offscreen or dedicated durable execution island for proof generation and PXE orchestration, rather than pretending the service worker alone is a safe place for minute-scale work.

## 13. What’s over-engineered or bloat

The clearest bloat is responsibility concentration. `metamask-controller.js` is the wiring root, RPC assembly point, UI sync layer, connection manager, wallet lifecycle manager, and Snap bridge all at once (`app/scripts/metamask-controller.js:624-736`, `app/scripts/metamask-controller.js:7183-7601`, `app/scripts/metamask-controller.js:7732-8213`, `app/scripts/metamask-controller.js:4922-4973`). That is too much power in one file, even if the underlying controller pattern is sound.

The second bloat source is matrix maintenance: MV2 and MV3, Chrome and Firefox, Browserify and webpack, LavaMoat and non-LavaMoat, default and Flask/Beta/Experimental builds (`app/manifest/v3/firefox.json:8-25`, `development/build/README.md:17-23`, `package.json:9-48`). Some of this is unavoidable for MetaMask’s install base. For a new wallet, copying this matrix would be a mistake.

Third, compatibility debt shows up everywhere in the provider path. There are EIP-1193 and CAIP provider engines, legacy provider/public-config channels in content-script streams, compatibility wrappers around `eth_requestAccounts`, and CAIP-25 translation back into legacy permission objects (`app/scripts/streams/provider-stream.ts:123-218`, `app/scripts/lib/rpc-method-middleware/handlers/request-accounts.ts:75-182`, `app/scripts/lib/rpc-method-middleware/handlers/wallet-requestPermissions.ts:100-189`). MetaMask needs this. Nulo probably does not, at least not initially.

Fourth, the MV3 keepalive is a red flag. Writing `browser.storage.session` every two seconds is evidence of a runtime model under strain, not a clean architectural solution (`app/scripts/background.js:847-855`). If your product depends on sustained computation, design around durable execution explicitly instead of normalizing this pattern.

Finally, LavaMoat is both genius and bloat. The security value is real. The number of escape hatches, environment-dependent paths, and manual hardening layers is also real (`app/scripts/lockdown-more.js:1-105`, `development/build/index.js:98-191`, `development/build/scripts.js:1208-1228`). It is a mature large-wallet choice, not an obvious default for a new team.

## Bottom line for Nulo

1. **Steal the messenger pattern, not the god class.** The restricted root-messenger/init-messenger architecture is MetaMask’s best scaling idea; `metamask-controller.js` is the cautionary tale (`app/scripts/messenger-client-init/utils.ts:88-184`, `app/scripts/metamask-controller.js:624-736`).
2. **Design long-running execution outside the service worker.** MetaMask’s offscreen usage is the useful pattern; its two-second timestamp keepalive is the warning (`app/scripts/offscreen.js:29-102`, `app/scripts/background.js:847-855`).
3. **Copy migrations and approval queues almost directly.** Both are boring, explicit, and exactly the kind of infrastructure wallets regret not building early (`app/scripts/lib/migrator/index.js:36-123`, `app/scripts/messenger-client-init/confirmations/approval-controller-init.ts:16-45`).
4. **Use patch-based background-to-UI sync.** It matches extension reality better than duplicating state machines in the popup, especially for proof progress and queued operations (`app/scripts/metamask-controller.js:7183-7314`, `ui/store/patch-store-substream-connection.ts:41-260`).
5. **Do not cargo-cult LavaMoat or the compatibility matrix.** MetaMask earns its complexity by scale, install base, and threat model. Nulo should adopt the specific security and architecture patterns it needs, not the whole operational burden (`development/build/index.js:95-192`, `package.json:9-48`).
