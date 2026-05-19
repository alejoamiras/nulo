# Nulo wallet: critical architecture review

Review scope: source-read review of `(project root)`, formed independently without reading sibling analyses under `wallets-architecture-research/`. I did not treat `AUDIT.md` as ground truth; I used it as one more artifact after reading the code. The overall verdict is: this is not a toy anymore, but it is still too optimistic about MV3 liveness and too synchronous for Aztec-grade proof latency. The codebase is disciplined in places that most first wallets ignore, but the long-running-ops story is still the thing most likely to fail in production. (`CLAUDE.md:7-18`, `packages/extension/src/wallet/runtime.ts:76-155`, `packages/extension/src/wallet/services/execution/service.ts:334-495`)

## 1. Manifest & entry points

The extension surface is cleanly split: MV3 service worker at `src/wallet/index.ts`, popup at `src/popup/index.html#/popup/general`, offscreen PXE at `src/offscreen/index.html`, and a content script injected on `*://*/*` at `document_start` in all frames. That is architecturally coherent, but the content-script blast radius is large: every page, every iframe, earliest injection point. That is normal for wallet discovery, but it materially increases the surface area of any bridge bug. (`packages/extension/manifest/manifest.config.ts:15-33`)

Boot order on cold SW start is: shell-level logger/console hooks, construct runtime, rehydrate logs, then `runtime.start()`. Inside `runtime.start()`, Nulo sets the uninstall URL, loads config and Barretenberg in parallel, runs the destructive storage migration, registers ~20 services, starts them, wires the wallet-sdk background handler, and only then writes the `nulo:liveness` heartbeat. That order is sensible: the liveness bit means "runtime is actually wired", not just "worker JS evaluated". (`packages/extension/src/wallet/index.ts:21-55`, `packages/extension/src/wallet/runtime.ts:80-155`)

The popup entry also shows intent: it eagerly opens profile/contact ports via `initAppServiceContext()`, installs router guards, and mounts a single large `App.vue` orchestrator. That is workable, but it means the popup still behaves like a thick client, not a thin observer over a background job model. (`packages/extension/src/popup/index.ts:40-49`, `packages/extension/src/popup/App.vue:75-116`)

## 2. Service worker architecture

The biggest hard truth: Nulo still does not have a truly convincing MV3 termination story. The code comments call the 10s `nulo:liveness` storage write a "heartbeat" and even mention "keepalive cadence", but writing to `chrome.storage.session` is not a real survival contract. It is an observability signal, not a wake/survival primitive. Even the internal port docs are honest that interval-based background work does not survive suspension. (`packages/extension/src/wallet/runtime.ts:64-66`, `packages/extension/src/wallet/runtime.ts:134-154`, `packages/wallet-core/src/ports/background-ticker-port.ts:21-31`)

Cold-start recovery is partial, not holistic. Good news: password sessions can silently restore from session storage, pending txs are rebuilt from storage on boot, and the operation journal survives SW restarts because it lives in `chrome.storage.session`. Bad news: tasks are memory-only, proof execution is not resumable, and `stop()` only clears the heartbeat because there is still "no mechanism" to dispose services. That means the lifecycle model is still closer to "boot a singleton and hope Chrome is polite" than to a supervisor with deterministic restart semantics. (`packages/extension/src/wallet/services/profile/service.ts:49-65`, `packages/extension/src/wallet/services/profile/session-manager.ts:21-47`, `packages/extension/src/wallet/services/transaction/service.ts:48-62`, `packages/extension/src/wallet/services/operation-journal/service.ts:39-46`, `packages/extension/src/wallet/runtime.ts:54-59`, `packages/extension/src/wallet/runtime.ts:157-162`)

The transaction poller is also still just an infinite `while (true) { ... sleep(1000) }` loop inside the worker. That is simple, but it means receipt tracking disappears whenever MV3 suspends the SW and only resumes on the next wake. Pending txs are recoverable; timely tx-state updates are not guaranteed. (`packages/extension/src/wallet/services/transaction/service.ts:57-62`, `packages/extension/src/wallet/services/transaction/service.ts:176-193`)

There is one real use of `chrome.alarms`: proactive session TTL locking. That part is solid. But the broader "survive MV3" machinery is underdeveloped. The alarms port docs mention offscreen keepalive bookkeeping, yet the only concrete alarm consumer I found is `SessionManager`. So the code has one reliable wake-up path for auto-lock, but not for transaction polling, proof supervision, or offscreen reaping. (`packages/wallet-core/src/ports/alarms-port.ts:2-9`, `packages/extension/src/wallet/services/profile/session-manager.ts:121-143`, `packages/extension/src/wallet/services/profile/session-manager.ts:527-578`)

## 3. Service / ServiceClient pattern

The base RPC pattern is not the problem. Typed `Service` / `ServiceClient` boundaries between popup, SW, and offscreen are the right abstraction for a wallet that must span MV3 and an offscreen PXE process. The background base class is straightforward and sane. The offscreen base class also has a real idea behind it: every long offscreen request sends 20s keepalive pings back to the SW so Chrome does not idle-kill the worker mid-proof. (`packages/extension-messaging/src/background/service.ts:10-127`, `packages/extension-messaging/src/offscreen/service.ts:10-18`, `packages/extension-messaging/src/offscreen/service.ts:65-105`)

But the pattern is still too leaky and too hand-managed in the popup. `ServiceClient.request()` waits for a connected port, then does `this.port!.postMessage(request)` after an async loop; the open null-deref race called out in `AUDIT.md` is still real. If `onDisconnect` flips the state between the wait loop and the `postMessage`, the request can explode in exactly the seam you do not want exploding. (`packages/extension-messaging/src/background/client.ts:127-177`, `AUDIT.md:67-72`)

The other smell is over-distribution. The transport abstraction makes sense across process boundaries. It makes much less sense when every popup page/module/composable is hand-rolling client ownership. `FeeSettingsCard.vue`, `BalanceView.vue`, `send.vue`, `execute/index.vue`, `App.vue`, and `useFullscreenPopupSetting()` all still instantiate or juggle clients directly. The `managers` proxy is explicitly typed as always-populated even though it can be `undefined` at runtime. That is not a robust architecture; it is a compatibility shim that leaks statefulness everywhere. (`packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:124-139`, `packages/extension/src/popup/components/modules/general/BalanceView.vue:107-175`, `packages/extension/src/popup/pages/send.vue:196-217`, `packages/extension/src/popup/windows/execute/index.vue:66-92`, `packages/extension/src/popup/App.vue:75-116`, `packages/extension/src/composables/fullscreenPopupSetting.ts:22-41`, `packages/extension/src/utils/core.ts:33-49`, `packages/extension/src/utils/core.ts:97-107`)

One more uncomfortable point: the topology engine is better than the service graph that uses it. `ServiceCollection.start()` can do phased startup, but undeclared services still land in phase 0, and the runtime comments still admit startup is "concurrent". I found exactly one wallet service that declares dependencies. So the mechanism exists, but adoption is not there. (`packages/wallet-core/src/base/index.ts:54-69`, `packages/wallet-core/src/base/topology.ts:4-12`, `packages/extension/src/wallet/runtime.ts:100-103`, `packages/extension/src/wallet/services/contact/service.ts:18-19`)

## 4. Offscreen + PXE

The offscreen bootstrap is one of the stronger parts of the codebase. `PxeServiceClient` forces `ensureOffscreenRunning()` before every request, `ensureOffscreenRunning()` checks `chrome.runtime.getContexts()`, pings an existing document, kills zombie documents, handles Chrome's "single offscreen document" ghost case, and waits for an explicit READY handshake. This is serious MV3 engineering, not hand-wavy wishful thinking. (`packages/extension/src/wallet/services/pxe/client.ts:9-18`, `packages/extension/src/wallet/utils/offscreen.ts:40-140`, `packages/extension/src/offscreen/index.ts:8-15`, `packages/extension/src/offscreen/index.ts:35-47`)

The failure mode is not bootstrap, it is recovery semantics. Offscreen requests are one-shot message exchanges. The offscreen service itself admits that if the SW is dead when it tries to send the response, the response is simply lost and the client times out. There is no replay, no durable job ID, and no attach-later semantics. For proofs that may take minutes, that is a real architectural gap. (`packages/extension-messaging/src/offscreen/service.ts:99-105`, `packages/extension-messaging/src/offscreen/client.ts:167-213`)

Inside PXE, the really important issue is serialization. `PxeService` wraps `simulateTx`, `proveTx`, `executeUtility`, `profileTx`, `getPrivateEvents`, `register*`, and even some read-like note/event paths behind one `ReadWriteGuard`. The guard is global to the service, not partitioned per chain or per profile. In other words: if one tab is proving on chain A, another tab simulating on chain B can still be blocked behind the same write lock. For Aztec, that is too coarse. (`packages/aztec-runtime/src/pxe/service.ts:58-68`, `packages/aztec-runtime/src/pxe/service.ts:202-255`, `packages/wallet-core/src/utils/rw-guard.ts:21-47`)

## 5. Storage

Storage is cleanly split by intent: profiles/accounts/networks/txs/dapp sessions live in `chrome.storage.local`; session state and operation journal live in `chrome.storage.session`; PXE state lives in IndexedDB under `pxe/<profile>/<chain>`. That is a reasonable layout. The problem is not placement, it is the cost of some abstractions and the destructiveness of the migration policy. (`packages/extension/src/wallet/services/account/service.ts:23`, `packages/extension/src/wallet/services/network/service.ts:109`, `packages/extension/src/wallet/services/dapp-session/service.ts:29`, `packages/extension/src/wallet/services/operation-journal/service.ts:41-46`, `packages/aztec-runtime/src/pxe/chain-runtime.ts:74-92`)

`EntityStorage` is still a blunt instrument. `getAll()`, `getKeys()`, and `getValues()` call `storage.get()` with no key filter, pull the entire namespace, then filter by prefix. That is acceptable when the repo is young, but it will age badly if tx history, balances, notes, or dapp sessions grow. `AUDIT.md` is right to keep this open. (`packages/wallet-core/src/storage/entity_storage.ts:65-94`, `AUDIT.md:102-107`)

Nulo also still bypasses its own storage abstraction in places that matter. `NetworkService` stores the active-network pointer via raw `chrome.storage.local` keys, and popup modules like `FeeSettingsCard.vue` and `BalanceView.vue` still read/write raw local-storage maps directly. That undercuts the otherwise decent storage model by scattering key semantics through UI code. (`packages/extension/src/wallet/services/network/service.ts:40-41`, `packages/extension/src/wallet/services/network/service.ts:688-696`, `packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:135-143`, `packages/extension/src/popup/components/modules/general/BalanceView.vue:192-239`, `AUDIT.md:79-85`)

## 6. Vault & key management

The crypto package is better than I expected from a first wallet. Password encryption is PBKDF2-SHA256 at 600k iterations with AES-GCM, a versioned ciphertext format, and a fixed encrypted guard value to distinguish wrong-password from garbage. Passkey wallets derive their master secret through HKDF with explicit domain separators. These are not amateur mistakes. (`packages/wallet-crypto/src/encryption-key.ts:1-27`, `packages/wallet-crypto/src/password-secret-box.ts:44-67`, `packages/wallet-crypto/src/passkey-credential.ts:18-21`, `packages/wallet-crypto/src/passkey-credential.ts:53-69`)

The security problem is operational, not primitive choice. Password sessions still persist `passhash` into `chrome.storage.session` unless strict mode is enabled. That hash is a bearer-equivalent input to `EncryptionKey.fromPasshash()`. `AUDIT.md` is correct: whoever gets session storage gets the decryption path. The code documents this honestly, but honesty does not remove the risk. (`packages/extension/src/wallet/services/profile/session-manager.ts:95-101`, `packages/extension/src/wallet/services/profile/session-manager.ts:177-218`, `packages/wallet-crypto/src/encryption-key.ts:87-100`, `AUDIT.md:35-48`)

There is a second, simpler gap: `exportEncrypted(id)` still returns the encrypted secret blob with no auth check at all. That is not internet-exploitable from a dApp, but it is still a bad local boundary. (`packages/extension/src/wallet/services/profile/service.ts:507-517`, `AUDIT.md:42-49`)

Also, the unlocked secret lives in memory as an `Fr` on `activeSession`, and the project's own zeroize helper explicitly says `Fr` internals cannot be zeroed. So closing the session clears references, but not deterministically the underlying secret bytes. That is normal in JS, but it means "leak-resistant" should not be oversold. (`packages/extension/src/wallet/services/profile/session-manager.ts:16-20`, `packages/extension/src/wallet/services/profile/session-manager.ts:169-175`, `packages/wallet-crypto/src/zeroize.ts:13-24`)

## 7. dApp ↔ wallet

This area is materially stronger than a naive first implementation. The content script is a pure relay; the background validates content-script envelopes before forwarding them to the upstream wallet-sdk handler; sessions are keyed by exact origin; discovery requests are deduplicated; and there is explicit per-method capability enforcement plus per-call scope enforcement. Those are good instincts. (`packages/extension/src/content-script/content.ts:1-22`, `packages/extension/src/wallet/services/wallet-sdk/content-script-validator.ts:1-24`, `packages/extension/src/wallet/services/wallet-sdk/background.ts:97-115`, `packages/extension/src/wallet/services/dapp-session/service.ts:72-91`, `packages/wallet-bridge/src/dispatcher.ts:188-220`, `packages/wallet-bridge/src/scope-enforcement.ts:1-25`)

But there are still brittle seams. `requestCapabilities()` runtime-casts `manifest.capabilities` to `Record<string, unknown>[]` instead of actually parsing it. The scope layer is real; the manifest schema layer is still half-trusted. (`packages/wallet-bridge/src/dispatcher.ts:367-380`)

The other red flag is the monkey-patch of the upstream `BackgroundConnectionHandler` private decryption method to serialize session decryptions. It is a pragmatic fix for a real race, but it is still a monkey-patch of private internals in a security boundary. That is not a place you want long-term coupling. (`packages/extension/src/wallet/services/wallet-sdk/background.ts:175-193`)

## 8. Account adapter

The actual `NuloAccount` implementation is not where `CLAUDE.md` says it is. `CLAUDE.md` points to `packages/extension/src/wallet/services/account/contracts/nulo-account.ts`, but the real source is in `packages/aztec-runtime/src/account/nulo-account.ts`; under the old path I found only a test. That documentation drift matters because this is one of the most security-sensitive files in the repo. (`CLAUDE.md:181-190`, `packages/aztec-runtime/src/account/nulo-account.ts:1-204`)

The adapter itself is appropriately thin. It derives the signing key from the master secret, pins salt to `Fr.ZERO` for deterministic recreation, chunks oversized payloads through the account entrypoint, and wraps first-use deployment plus app calls through `DefaultMultiCallEntrypoint`. This is the right kind of Aztec-specific customization: minimal but deliberate. (`packages/aztec-runtime/src/account/nulo-account.ts:63-76`, `packages/aztec-runtime/src/account/nulo-account.ts:102-138`, `packages/aztec-runtime/src/account/nulo-account.ts:140-203`)

This is worth keeping. The risk here is not "too much custom account logic"; it is upstream drift. If Aztec changes signing-key derivation or first-tx semantics, this wrapper is exactly where you will feel it first. (`CLAUDE.md:183-191`, `packages/aztec-runtime/src/account/nulo-account.ts:63-76`)

## 9. UI architecture

M6 is real. The layer model is documented in `CLAUDE.md`, enforced in Biome, and backed by a large amount of decomposition work. That is already better than most wallet frontends. (`CLAUDE.md:44-92`, `implementations-plan/M6/STATUS.md:9-20`)

But the smell test is: the rules are stronger than the code's current obedience to them. `CLAUDE.md` and `implementations-plan/M6/conventions.md` both say service composables must not own `connect()` / `disconnect()` or their own unmount lifecycle. `useFullscreenPopupSetting()` still creates its own `ConfigServiceClient`, fetches on mount, and disconnects on unmount. `useDappInteractionPayload()` also installs `onScopeDispose()` itself. That is not catastrophic, but it means the layer model is still partly aspirational. (`CLAUDE.md:80-85`, `CLAUDE.md:132-149`, `implementations-plan/M6/conventions.md:48-55`, `implementations-plan/M6/conventions.md:125-140`, `packages/extension/src/composables/fullscreenPopupSetting.ts:22-41`, `packages/extension/src/composables/useDappInteractionPayload.ts:73-117`)

There is also plain documentation drift. The conventions doc still talks about Histoire and `*.story.vue`, while `STATUS.md` says Storybook 10 replaced Histoire and uses `*.stories.ts`. That is not a runtime bug, but it is a process smell: the conventions layer is not fully synchronized with the toolchain it governs. (`implementations-plan/M6/conventions.md:82-91`, `implementations-plan/M6/conventions.md:142-153`, `implementations-plan/M6/STATUS.md:72-90`)

## 10. Long-running ops

This is the most important section, and this is where Nulo is still too fragile for Aztec.

First problem: popup-to-SW RPC defaults to 60 seconds. `ExecutionServiceClient` does not override that default. Aztec proof generation is explicitly treated in this codebase as a 60s+ class of work, and the offscreen client itself had to raise its own timeout to 90 seconds for PXE calls. That means the popup can time out before the SW finishes a healthy proof flow. (`packages/extension-messaging/src/background/client.ts:11-18`, `packages/extension/src/wallet/services/execution/client.ts:17-20`, `packages/extension-messaging/src/offscreen/client.ts:10-18`)

Second problem: timeout is not cancellation. When `send.vue` calls `executeTransfer()`, it immediately navigates away and leaves a promise chain running. If that chain rejects on client timeout, the UI shows "Simulation failed, transaction not sent". But the SW request is not aborted, and the background service can keep proving and eventually submit anyway. That is a classic split-brain UX bug waiting to happen. (`packages/extension/src/popup/pages/send.vue:258-280`, `packages/extension-messaging/src/background/client.ts:157-181`, `packages/extension/src/wallet/services/execution/service.ts:444-490`)

Third problem: canceled estimations are not actually canceled. `useFeeEstimation()` just bumps a stale counter; it does not abort the underlying async work. Since `simulateTx()` runs under PXE's write lock, stale fee estimates can continue burning the single PXE lane and delay real proofs. In a proof-heavy wallet, that is not a minor inefficiency; it is real head-of-line blocking. (`packages/extension/src/composables/useFeeEstimation.ts:52-90`, `packages/aztec-runtime/src/pxe/service.ts:217-255`)

Fourth problem: concurrency is globally serialized inside PXE. If a user opens three tabs and submits three txs, Nulo does not have a parallel-proof story. Everything proof/simulation-shaped queues behind one service-wide write guard. Add the 60s popup timeout and 90s offscreen timeout, and the third caller is at serious risk of timing out while the system is merely busy, not broken. (`packages/aztec-runtime/src/pxe/service.ts:58-68`, `packages/aztec-runtime/src/pxe/service.ts:202-255`, `packages/wallet-core/src/utils/rw-guard.ts:24-46`)

Fifth problem: recovery after SW death is not resumability. The operation journal preserves state labels like `planned`, `proving`, `submitting`, `submitted`, `failed`, but it does not persist enough execution intent to reconstruct and continue a proof. Tasks are in-memory only. Transaction polling only starts once a tx hash exists. So if the SW dies mid-proof, you can recover a stuck label, not the work itself. (`packages/extension/src/wallet/services/operation-journal/service.ts:23-29`, `packages/extension/src/wallet/services/operation-journal/service.ts:73-116`, `packages/extension/src/wallet/services/task/service.ts:31-45`, `packages/extension/src/wallet/services/task/service.ts:237-245`, `packages/extension/src/wallet/services/transaction/service.ts:57-62`, `packages/extension/src/wallet/services/transaction/service.ts:176-193`)

Sixth problem: the `default_entrypoint` dApp path is even less mature. The code explicitly says journal coverage is deferred, then runs a special kernelless discovery simulation path with no durable operation record at all. That is an advanced Aztec path with weaker observability than the basic UI transfer flow. (`packages/extension/src/wallet/services/execution/service.ts:1617-1623`, `packages/extension/src/wallet/services/execution/service.ts:1701-1825`)

Bottom line: Nulo has progress visibility, not a real long-running job architecture.

## 11. Migrations

The migration story is brutally honest: `CURRENT_VERSION = 3`, and any version mismatch wipes legacy accounts, txs, token balances, active-network pointers, the session-scoped operation journal, and all PXE/keyval IndexedDB state. Profiles and passkeys are preserved, but operational state is not. This is defensible for a pre-production wallet; it is not something you can carry into a real user base. (`packages/extension/src/wallet/storage/migrate.ts:1-30`, `packages/extension/src/wallet/storage/migrate.ts:41-85`, `packages/extension/src/wallet/runtime.ts:96-99`)

The dangerous part is timing: migration runs before any service starts. So on a version bump, there is no chance to recover or transform in-flight operational data first. The system destroys it, then boots. That is fine only while you are still comfortable saying "this version boundary nukes your tx/network state". (`packages/extension/src/wallet/runtime.ts:96-99`, `packages/extension/src/wallet/storage/migrate.ts:47-84`)

## 12. Testing posture

The testing story is meaningfully better than the stereotype of a first wallet. The project has real component conventions, an `audit:vue` gate, a large M6 testing/reporting trail, and explicit SW resilience coverage in the M6 status log. I would not call this under-tested in the broad sense. (`CLAUDE.md:93-130`, `implementations-plan/M6/STATUS.md:9-20`, `implementations-plan/M6/STATUS.md:193-208`, `AUDIT.md:73-91`, `AUDIT.md:155-168`)

The honest gap is that the hardest failures here are not visual or unit-shape failures. They are lifecycle failures: multi-tab proving queues, MV3 cold starts during proof, popup timeouts on healthy background work, stale-estimate contention, and offscreen response loss if the SW dies. I did not find a durable-job test model that convincingly exercises those scenarios. The tests prove decomposition discipline better than they prove production liveness. (`packages/extension/src/composables/useFeeEstimation.ts:52-90`, `packages/extension-messaging/src/background/client.ts:157-181`, `packages/extension-messaging/src/offscreen/service.ts:99-105`, `packages/aztec-runtime/src/pxe/service.ts:202-255`)

## 13. Known pain points

The repo leaves a very clear paper trail of what has hurt already: carry-from-A11 cleanup-order rules, explicit bug pins, the recent `fix(sw): m6 phase 10b — restore immediate-first-write liveness contract`, and a further `post-m6 stabilization` commit right after M6 was declared done. That does not mean the team is sloppy. It means the architecture is still settling under real user flows. (`CLAUDE.md:132-149`, `implementations-plan/M6/STATUS.md:9-20`, `implementations-plan/M6/STATUS.md:186-210`)

`AUDIT.md` is also unusually candid. It still lists passhash persistence, unauthenticated `exportEncrypted`, the port null-deref race, direct popup `chrome.storage` usage, and `EntityStorage` whole-namespace scans as open issues. The fact that these are documented is good. The fact that several of them still exist months later means the team has correctly prioritized some work, but the remaining debt is real debt, not theoretical lint. (`AUDIT.md:35-48`, `AUDIT.md:67-85`, `AUDIT.md:102-107`)

## 14. What’s worth keeping

Several patterns are actually solid and should survive refactors.

- The runtime composition root is good. The shell is thin, dependencies are explicit, and the worker does not hide its I/O behind random module globals. (`packages/extension/src/wallet/index.ts:1-18`, `packages/extension/src/wallet/runtime.ts:46-76`)
- The offscreen bootstrap and zombie-recreate logic are better than average MV3 engineering. (`packages/extension/src/wallet/utils/offscreen.ts:40-140`)
- The dApp bridge is not hand-wavy. There is real origin, capability, and scope logic. (`packages/extension/src/wallet/services/dapp-session/service.ts:72-91`, `packages/wallet-bridge/src/dispatcher.ts:188-220`, `packages/wallet-bridge/src/scope-enforcement.ts:90-150`)
- The Aztec account wrapper is thin and focused instead of inventing a custom protocol surface. (`packages/aztec-runtime/src/account/nulo-account.ts:63-76`, `packages/aztec-runtime/src/account/nulo-account.ts:120-203`)
- The team documents hard-earned rules instead of pretending abstractions are automatically safe. That cultural habit is valuable. (`CLAUDE.md:106-149`, `AUDIT.md:12-22`)

## 15. What’s rickety / first-time-implementer / likely to bite in production

The rickety parts are mostly lifecycle and control-plane issues, not cryptographic primitives.

- The system still behaves like synchronous RPC wrapped around asynchronous proof jobs. Aztec wants a queued job model; Nulo mostly still wants a request/response model. (`packages/extension/src/wallet/services/execution/client.ts:17-20`, `packages/extension/src/wallet/services/execution/service.ts:334-495`)
- The popup is too stateful and too transport-aware. You can feel the architecture leaking into UI code in `FeeSettingsCard.vue`, `BalanceView.vue`, `App.vue`, and `utils/core.ts`. (`packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:145-175`, `packages/extension/src/popup/components/modules/general/BalanceView.vue:192-239`, `packages/extension/src/popup/App.vue:130-170`, `packages/extension/src/utils/core.ts:39-43`)
- The security defaults are still softer than they should be for a wallet: persisted passhash by default, and unauthenticated encrypted export. (`packages/extension/src/wallet/services/profile/session-manager.ts:202-206`, `packages/extension/src/wallet/services/profile/service.ts:507-517`)
- The service graph talks like a topology-managed system but still boots largely as concurrent phase-0 singletons. (`packages/wallet-core/src/base/index.ts:61-69`, `packages/extension/src/wallet/runtime.ts:100-103`)
- Long-running ops are progress-tracked, not truly supervised. That will not survive enough real-world tab churn, browser idling, and proof latency without more redesign. (`packages/extension/src/wallet/services/operation-journal/service.ts:23-29`, `packages/extension/src/wallet/services/task/service.ts:31-45`, `packages/extension/src/wallet/services/execution/service.ts:1617-1825`)

## Top 10 things Nulo should change, ranked by impact × effort

1. Replace synchronous popup→SW execution calls with durable job submission + observation, especially for prove/send flows.
2. Raise or eliminate the 60s popup RPC timeout for execution paths immediately; right now healthy work can look like failure. (`packages/extension-messaging/src/background/client.ts:11-18`, `packages/extension/src/wallet/services/execution/client.ts:17-20`)
3. Persist enough execution intent to recover or explicitly tombstone stuck `proving` jobs after SW death; the current journal is too shallow. (`packages/extension/src/wallet/services/operation-journal/service.ts:73-116`)
4. Stop persisting `passhash` by default. Make strict security the default, or redesign restore. (`packages/extension/src/wallet/services/profile/session-manager.ts:193-206`)
5. Add authentication to `exportEncrypted()` now. This is cheap and overdue. (`packages/extension/src/wallet/services/profile/service.ts:507-517`)
6. Partition PXE concurrency at least per `(profileId, chainId)`, or introduce an explicit queue with backpressure rather than a single global write lock. (`packages/aztec-runtime/src/pxe/service.ts:58-68`, `packages/aztec-runtime/src/pxe/service.ts:202-255`)
7. Wire real cancellation tokens through fee estimation and proof/simulation orchestration. Stale-counter invalidation is not enough. (`packages/extension/src/composables/useFeeEstimation.ts:52-90`, `packages/extension/src/wallet/services/execution/execution-coordinator.ts:49-99`)
8. Fix the background client null-deref race and stop normalizing transport fragility into UI cleanup folklore. (`packages/extension-messaging/src/background/client.ts:127-177`, `AUDIT.md:67-72`)
9. Extract a `UIStateService` or equivalent and delete the remaining raw `chrome.storage` calls from popup code. (`packages/extension/src/popup/components/modules/send/FeeSettingsCard.vue:135-143`, `packages/extension/src/popup/components/modules/general/BalanceView.vue:192-239`)
10. Bring the docs back in sync with reality: real `NuloAccount` path, Storybook vs Histoire, and the actual long-running-ops contract. (`CLAUDE.md:181-190`, `implementations-plan/M6/conventions.md:82-91`, `implementations-plan/M6/STATUS.md:72-90`)

## Aztec-specific recommendations

- Treat proof generation as a durable background job, not an RPC call. Aztec latency makes that architectural shift mandatory, not optional.
- Separate "discover authwits / simulate" traffic from "prove" traffic in queueing terms. Right now stale fee estimates can compete with real user submissions for the same PXE lane. (`packages/extension/src/composables/useFeeEstimation.ts:52-90`, `packages/aztec-runtime/src/pxe/service.ts:217-255`)
- Add explicit UI backpressure. If proofs are globally serialized, tell the user they are in a queue instead of pretending parallel submit is real concurrency.
- Persist reconstruction inputs for `default_entrypoint` / kernelless flows too. That path is currently the least observable one even though it is one of the most Aztec-specific. (`packages/extension/src/wallet/services/execution/service.ts:1617-1825`)
- Add multi-tab, multi-proof, cold-SW-mid-proof tests. For this wallet, those are first-class correctness tests, not exotic stress tests.
- Keep the thin custom account adapter model. That is the right Aztec posture. The missing piece is job control and liveness, not a fancier account contract. (`packages/aztec-runtime/src/account/nulo-account.ts:43-203`)
