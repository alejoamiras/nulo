# Nulo Wallet — Honest Self-Analysis

> Written for the comparative architecture study (sibling agents are analyzing Rabby, MetaMask, Grego's wallet in parallel). The brief: **be critical**, not promotional. Smell-test every choice.
>
> Reference points: master @ `65ea47a` (post-M6 close-out, 2026-05-08). 8 packages, 8000 LoC of services, 517 unit tests, ~166 e2e cases.

## TL;DR for the cross-comparison

Nulo got the **package boundaries** more right than most first-time wallets — biome `noRestrictedImports` per-package layer rules are real, enforced, and not aspirational (`biome.json:64-280`). The **port-based RPC pattern** between popup/SW/offscreen (`packages/extension-messaging/src/`) is competent, not copy-pasted from a tutorial.

But the wallet wears its first-time roots in three places:

1. **MV3 termination story is half-built.** A 10-second heartbeat (`runtime.ts:65-154`) keeps the SW alive while the popup is open, but there is no design for "popup closes mid-proof, SW dies, what happens to the dApp request" beyond hope and an offscreen ping. There's no alarms-based wake-up for the wallet-sdk handler; if the SW dies between discovery and key exchange the dApp times out.
2. **Master state lives in module globals.** The composition root (`runtime.ts:70`) returns a service collection but the popup-side `core.ts` constructs `*ServiceClient` instances at module eval time and stores them in a `managers` global. Test-friendly pattern at the top, untestable singleton glue at the bottom. `app.vue:140` openly comments that the `network` watcher and `initAccount()` race because both fire on profile load; the fix was a per-tuple async lock inside `AccountService` (`account/service.ts:113-130`), not fixing the dual trigger.
3. **The dispatcher monkey-patches `@aztec/wallet-sdk`.** `wallet-sdk/background.ts:178-186` overrides a private method (`handleEncryptedMessage`) to serialize per-session decryption because the upstream library uses `void this.handleEncryptedMessage(...)` (fire-and-forget), letting two messages race. The TODO says "remove if wallet-sdk adds a proper serialization API." This is a wallet shipping with `(handler as any).handleEncryptedMessage = …`. It works; it's also a load-bearing hack.

Six big things _are_ legitimately good:

1. The wallet-bridge / aztec-runtime / wallet-crypto / wallet-core / extension-messaging package split (every layer has biome boundary rules, all enforced).
2. The `PasswordSecretBox` extraction with the `ENCRYPTION_GUARD` round-trip + M2.6 cross-version vectors (`wallet-crypto/src/password-secret-box.ts`).
3. The strict-security-mode default (`SECURITY.md:48` — `passhash` is NOT persisted; A1 from AUDIT.md is fixed by design as of 0.13.9).
4. The `NuloAccount` adapter delegating to upstream `@aztec/accounts/schnorr` instead of forking a custom contract (`aztec-runtime/src/account/nulo-account.ts:30-76`).
5. The kernelless authwit discovery pattern for `NO_FROM` / DefaultEntrypoint sendTx (`execution/service.ts:1746-1789`) — this is genuinely Aztec-aware code.
6. M6 layer enforcement (L0-L6 + C0/C1) with biome rules. Most extensions don't even have a layer model.

The full list, by dimension, follows.

---

## 1. Manifest & entry points

`packages/extension/manifest/manifest.config.ts` (single source for both Chrome MV3 and Firefox MV2 — Firefox manifest sub-overrides at `manifest.firefox.config.ts`):

```ts
manifest_version: 3,
host_permissions: ["https://nulo.sh/"],
action: { default_popup: "src/popup/index.html#/popup/general" },
background: { service_worker: "src/wallet/index.ts", type: "module" },
side_panel: { default_path: "src/popup/index.html" },
content_scripts: [{ all_frames: true, js: ["src/content-script/content.ts"], matches: ["*://*/*"], run_at: "document_start" }],
permissions: ["alarms", "offscreen", "storage", "sidePanel", "unlimitedStorage"],
content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'" },
cross_origin_embedder_policy: { value: "require-corp" },
cross_origin_opener_policy: { value: "same-origin" },
```

Four entry points:

| Entry | File | Boot |
|---|---|---|
| **SW** | `src/wallet/index.ts` | `createWalletRuntime({...}).start()` |
| **Popup** | `src/popup/index.ts` | Vue + Pinia + hash router; eagerly opens profile + contact ports via `initAppServiceContext()` |
| **Content** | `src/content-script/content.ts` | Pure relay using upstream `@aztec/wallet-sdk` `ContentScriptConnectionHandler` |
| **Offscreen** | `src/offscreen/index.ts` | Boots `createPxeOffscreen` + responds to PING |

Good things about the SW shell (`packages/extension/src/wallet/index.ts`): the actual service-graph construction lives in `runtime.ts:70`; `index.ts` is a 56-line shell that wires real adapters and starts. This is composable; tests can construct a `WalletRuntime` with `FakeBrowserApi` (`runtime.ts:46-52` — `WalletRuntimeDeps` interface is the entire surface).

The content script is **9 lines of code** (`content-script/content.ts:1-22`) because it delegates the entire encrypted-channel protocol to upstream. This is the right call for a 4.x Aztec wallet — Rabby/MetaMask hand-roll their `inpage.js`, and the cost of doing so for an L2 wallet without browser-app distribution muscle is not worth it. Compared to MetaMask's content script (~hundreds of LoC) this is a different design philosophy.

CSP is `'wasm-unsafe-eval'` (required for Barretenberg WASM), `cross-origin-{opener,embedder}-policy` set to enable SharedArrayBuffer for proving — necessary for Aztec, atypical for EVM wallets.

## 2. Service worker architecture

### Boot sequence (`runtime.ts:76-155`)

```ts
const start = async (): Promise<void> => {
  if (started) return
  started = true
  // 1. Uninstall URL (zero-cost, runs even if rest fails)
  await browserApi.runtime.setUninstallURL(UNINSTALL_URL)
  // 2. Config + BB in parallel — neither depends on the other
  await Promise.all([config.load(), BarretenbergSync.initSingleton({...})])
  // 3. Storage migration (destructive, version-gated)
  await runStorageMigration(...)
  // 4. Service graph (sequential adds, concurrent .start())
  services.add(new AccountService(logger))
  // ... 20+ services
  await services.start()
  // 5. wallet-sdk handler (separate from service graph because it's protocol)
  initWalletSdkHandler(services, logger)
  // 6. Liveness write (immediate, then heartbeat)
  browserApi.storage.session.set({ "nulo:liveness": clock.now() })
  heartbeatHandle = clock.setInterval(() => { ... }, 10_000)
}
```

Comment: "**Heartbeat — keeps MV3 service worker alive long enough for cross-SW calls**" (`runtime.ts:148`). 10 second cadence, writes `nulo:liveness` to `chrome.storage.session`. Idle timer in MV3 is 30s, so a 10s storage write is easily enough. **But this is a keep-alive ONLY while the heartbeat is running**, which is from `start()` until... never? `stop()` is exposed (`runtime.ts:55-59`) but never called in production. So the SW can still be killed if Chrome decides to despite the storage write.

Recent commit `6145048 fix(sw): m6 phase 10b — restore immediate-first-write liveness contract` is telling: the original `setInterval` defers the first fire by `HEARTBEAT_INTERVAL_MS`, so on cold boot anything waiting on `nulo:liveness` saw a 10s gap. That gap fed e2e flakes. The fix: write immediately + `setInterval`. That this regressed during a composition-root extraction (commit `c67e4f0`) shows the MV3 liveness contract isn't well-isolated — it's a side-effect-laden invariant in the SW shell, easily lost in a refactor.

What state is in memory vs storage:

| State | Location | Survives SW restart? |
|---|---|---|
| Master `Fr` secret | `SessionManager.activeSession.secret` (in-memory) | **No** — and that's the point in strict mode |
| `passhash` (lenient mode only) | `chrome.storage.session` | Yes (until browser session ends) |
| Active profile id, lockedAt | `chrome.storage.session` (`nulo:core:session`) | Yes |
| All accounts | `chrome.storage.local` (`nulo:core:accounts`) | Yes |
| Networks | `chrome.storage.local` (`nulo:core:networks@<profileId>`) | Yes |
| TX history | `chrome.storage.local` (`nulo:core:txs`) | Yes |
| dApp sessions | `chrome.storage.local` | Yes |
| Logs | `chrome.storage.session` (`nulo:logs:*`) | Yes (rehydrated at SW start, `index.ts:48`) |
| PXE state | IndexedDB (`pxe/<profileId>/<chainId>`) | Yes |
| BB WASM | re-init each cold boot (`runtime.ts:91`) | No |

Re-init after termination: nothing wakes the SW. There's no `chrome.alarms.create({ periodInMinutes: 0.5 })` to keep it alive when no popup is open. The SW only re-spawns on Chrome's terms (popup open, content-script message arriving, alarms firing). The session-manager DOES use `chrome.alarms` for **proactive TTL lock fire** (`session-manager.ts:142, 561`) but that's the only alarm. **There's no "keep wallet ready for incoming dApp messages" alarm.** A dApp's first sendMessage will spawn the SW which re-runs the whole boot sequence: BB init (~hundreds of ms), storage migration check, service start, wallet-sdk handler init. The dApp's message lands AFTER `initWalletSdkHandler(services, logger)` is wired because `chrome.runtime.onMessage` queues messages until a listener exists, but profile-restore is also async and happens during `services.start()`. There's no explicit ordering guarantee between "wallet-sdk handler is ready" and "session is restored."

## 3. Service / ServiceClient pattern

`packages/extension-messaging/src/{background,offscreen}/{service,client}.ts` — this is the cleanest part of the codebase.

The base classes:

```ts
abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = {}> {
  private clients: chrome.runtime.Port[] = []
  // chrome.runtime.onConnect → onConnect → push to this.clients
  // request: dispatched via this.requests[method](...params); jsonSanitize'd
  // event: postMessage to all clients
  // error: WalletError subclasses round-trip via toPayload/walletErrorFromPayload
}

abstract class ServiceClient<TRequests, TEvents = {}> {
  // chrome.runtime.connect({ name: serviceName })
  // auto-reconnect on disconnect (onDisconnect → disconnect → connect)
  // 60s default request timeout (RpcTimeoutError)
  // auto-incrementing requestId (post-M3.1, ex-Math.random)
}
```

The good:

- **Typed RPC** — `MethodsMap` + `EventsMap` give `await client.request(method, ...args)` proper types end-to-end, with `Awaited<ReturnType<TRequests[T]>>` propagating. Single ergonomic surface.
- **Structured errors** — `WalletError` subclasses serialize their type + code + details so `instanceof InvalidPasswordError` works on the client (`messages.ts:46-49`, `errors.ts`). Auth UI matches on these (`auth.vue:65`).
- **Auto-reconnect** (`client.ts:89-92`): `onDisconnect → this.disconnect(); this.connect()` retries with 1-second backoff. Handles SW termination during a popup session.
- **Request timeout** (`client.ts:18, 162-168`) — 60s default, with a 10s warning via `setTimeout`, configurable per-client via `options.requestTimeoutMs`.
- **`jsonSanitize`** (`utils.ts`) — handles BigInts and class instances on the wire so the structured-clone algorithm doesn't barf.

The not-so-good:

- **`port!.postMessage(request)` non-null assertion** at `client.ts:176` — AUDIT.md A5, still open. Bug: between the `while (state !== Connected)` loop and the `port!.postMessage`, an `onDisconnect` handler can run and set `port = undefined`. The assertion lies. Race window is tight (microtask) but real. Three years of running with this hasn't bitten because re-connect is fast enough. Will bite eventually.
- **`ensureInitialized` polls every 500ms for up to 30s** (`service.ts:129-141`) — _it's a polling loop_:

  ```ts
  protected async ensureInitialized() {
    if (this.initialized) return
    let restMs = 30_000
    while (!this.initialized && restMs > 0) {
      await sleep(500); restMs -= 500
    }
    if (!this.initialized) throw new Error("Service not initialized")
  }
  ```

  This is ugly. Should be a Promise that resolves once init completes. The 500ms granularity adds latency; the 30s bound is arbitrary. But it works because services initialize quickly under normal conditions. _First-time-implementer smell._
- **No auth gating in the base class.** Each method handler is responsible for re-checking session/origin. There's no `@RequireUnlocked` decorator or middleware concept. AUDIT.md A2 (exportEncrypted requires no auth) lives in this gap.
- **No request streaming.** Long-running ops (proof generation) return one `Response` at the end. There's no progress channel — UI's task service does its own polling via `TaskService.onUpdated`. Workable, but the protocol could express "this method emits progress events keyed to its requestId."
- **The decryption-serialization monkey-patch** (`wallet-sdk/background.ts:178-186`) is the most embarrassing instance:

  ```ts
  const origDecrypt = (handler as any).handleEncryptedMessage.bind(handler)
  ;(handler as any).handleEncryptedMessage = async (sessionId: string, encrypted: unknown) => {
    const prev = decryptQueues.get(sessionId) ?? Promise.resolve()
    const next = prev.then(() => origDecrypt(sessionId, encrypted))
    decryptQueues.set(sessionId, next.catch(() => {}))
    return next
  }
  ```

  This monkey-patches the upstream `BackgroundConnectionHandler` to per-session-serialize decryption. Without it, two encrypted messages can race in decryption (`void this.handleEncryptedMessage(...)` in upstream is fire-and-forget). Result: corruption. **The fact that the dapp protocol's serialization correctness depends on monkey-patching upstream private methods is a load-bearing hack.** The TODO is "remove if wallet-sdk adds a proper serialization API." Until then, every wallet-sdk minor bump is a roulette.

Coverage: **every service inherits `Service` from `extension-messaging/background`** and exposes a typed client. 25 services, all consistent. Good.

## 4. Offscreen + PXE

`packages/extension/src/wallet/utils/offscreen.ts` — the offscreen lifecycle helper. 142 lines. Manages:

- **Singleton offscreen document** (Chrome enforces 1 per extension)
- **Health check via PING/PONG** (`HEALTH_CHECK_TIMEOUT_MS = 3_000`)
- **Ghost detection** — `chrome.offscreen.createDocument` throws "single offscreen document" even when `getContexts()` returns empty; the helper catches and retries once after `closeDocument()`
- **READY handshake** with 10s timeout (`READY_TIMEOUT_MS = 10_000`)
- **Concurrent-ensure dedup** via `offscreenPromise` module global

The pattern: `PxeServiceClient.onReady → ensureOffscreenRunning()` (`pxe/client.ts:11-17`). Every PXE call from the SW first ensures the offscreen is up. This means cold-start latency on first sendTx includes:

1. SW spawns (Chrome)
2. BB WASM init (~hundreds of ms)
3. Service graph startup
4. First call to PXE → `ensureOffscreenRunning` → spawn offscreen
5. Offscreen boots: `createPxeOffscreen({ profiles, logger })` (`offscreen/entry.ts:29-33`)
6. PXE service init runs orphan IndexedDB cleanup (`pxe/service.ts:71-104`)
7. Offscreen sends READY message
8. Original PXE call now executes

Each PXE call goes SW → ServiceClient → port → offscreen Service. Roundtrip is ~10ms when warm, **100s of ms when cold**. The offscreen never auto-closes — it lives as long as Chrome lets it (which is "indefinitely" because it has active service connections).

What's good:

- **All chrome.* lives in the extension shell, NOT the aztec-runtime package.** `aztec-runtime/src/offscreen/entry.ts` is chrome-free (`createPxeOffscreen({ profiles: IProfileReader, logger: ILogger })`). The extension's `offscreen/index.ts:40-43` constructs the chrome-bound `ProfileServiceClient` and passes it in via structural duck-typing on `IProfileReader`.
- **PXE is per-(profile, chain)** — `ChainRuntimeRegistry` keys by `${profileId}:${chainId}`. Switching networks doesn't tear down PXE; previously-used PXEs stay warm in IndexedDB. `pxe/service.ts:71-104` cleans up orphaned databases at init.
- **Health check + ghost-recovery in `ensureOffscreenRunning`** is real defensive work — Chrome's offscreen API has well-known quirks and the helper handles them.

What's sketchy:

- **No "warm PXE" pre-create.** The first dApp call after cold boot pays the full latency. Could pre-warm during SW idle, but doesn't.
- **PXE failure recovery is "throw and let the client retry."** No circuit-breaker, no auto-restart on serial failures. If PXE wedges (corrupted IndexedDB, BB WASM issue), the only fix is to manually full-reset.
- **`ReadWriteGuard`** (`pxe/service.ts:60`, `wallet-core/src/utils/read-write-guard.ts`) — serializes writes per-chain and parallelizes reads. Good idea, single-process concurrency model is sane. But reads CAN starve writes if a popup leaves a read in flight. Not pathological in practice; pathological in the shape of an attack.

## 5. Storage

`EntityStorage<T>` and `ValueStorage<T>` (`packages/wallet-core/src/storage/`). Both are flat key-value abstractions over `MinimalStorageArea`:

```ts
EntityStorage<T> {
  // root@id pattern; one storage entry per entity
  contains(id), get(id), set(id, entity), delete(id),
  getAll(), getKeys(), getValues(), findByPredicate(predicate)
}
ValueStorage<T> { get(), set(value), delete() }
```

`getAll/getKeys/getValues` call `storage.get()` with no args, which fetches **the entire storage namespace** and filters by prefix in JS (AUDIT.md A10). Performance degrades with storage size. Tx history could be 1000s of rows; balance history grows. Not a security issue, real-world performance issue.

Migrations (`storage/migrate.ts`):

```ts
const STORAGE_VERSION_KEY = "nulo:core:storage-version"
const CURRENT_VERSION = 3

const KEYS_TO_WIPE = ["nulo:core:accounts", "nulo:core:txs", ...]
const KEY_PREFIXES_TO_WIPE_LOCAL = ["nulo:core:networks@", ...]
const INDEXEDDB_WIPE_PREFIXES = ["pxe/"]

export async function runStorageMigration(log) {
  const result = await chrome.storage.local.get(STORAGE_VERSION_KEY)
  const version = result[STORAGE_VERSION_KEY] as number | undefined
  if (version === CURRENT_VERSION) return
  // wipe everything in the lists; reseed defaults on first read
  ...
  await chrome.storage.local.set({ [STORAGE_VERSION_KEY]: CURRENT_VERSION })
}
```

**Comment at the top: "This wallet has no production users, so the migration is a destructive wipe of the affected subtree."** This is honest. It is also a ticking timebomb — once production users exist, every storage version bump is "users lose their tx history" or "users lose their accounts" unless the migration logic gets rewritten. The current shape is fine for pre-launch; it becomes the most painful piece of tech debt the moment the wallet has paying users.

The seven popup files that bypass storage abstractions and use raw `chrome.storage.local.get/set/remove` (AUDIT.md A7) are still there. `app.store.ts:38, 47-49, 56-59` is the canonical example:

```ts
const setupActiveAccount = async () => {
  const activeAccountResult = await chrome.storage.local.get("nulo:ui:activeAccount")
  if ("nulo:ui:activeAccount" in activeAccountResult) {
    ...
  }
  account.value = accounts.value[0]
  await chrome.storage.local.set({ "nulo:ui:activeAccount": account.value?.address })
}
```

Hardcoded magic key strings, no abstraction. If a service rename happens, this silently breaks. AUDIT.md flags this; nothing has been done. (16 grep hits for `chrome.storage` in popup, post-trim from 23.)

## 6. Vault & key management

`packages/wallet-crypto/`:

- `EncryptionKey` (`encryption-key.ts`): PBKDF2-SHA256 with 600,000 iterations, AES-GCM 256, 12-byte IV from `crypto.getRandomValues`, salt derived as `SHA-256(IV)` (deterministic from IV — interesting choice; means the IV is the only entropy contribution). Format: `[1 version byte][12 byte IV][ciphertext]` base64-stored.
- `PasswordSecretBox` (`password-secret-box.ts`): the high-level KDF + AES wrapper. `seal/unseal/reseal/unsealWithPasshash`. Returns `null` on wrong password instead of throwing — the docstring at lines 8-37 maps this null to per-callsite errors. Not bad, but error semantics surface area is wide and load-bearing.
- `ENCRYPTION_GUARD` (`password-secret-box.ts:50`): an 8-byte known plaintext (`[6,11,20,20,22,4,20,22]`) sealed under the same key as the master secret. On unseal, decrypted-guard is compared byte-by-byte to the constant; mismatch = wrong password. The fixed value is **frozen** by M2.6 cross-version vectors and every profile on disk. Must never change without migration. **Comment is explicit, locked-in invariant.**
- `zeroize.ts` — explicit memory zero for cleanup. M4.6 introduced ownership semantics: caller-owns parameter buffers, internally-owned buffers zero in `finally`. The `unsealWithPasshash` doc explicitly says "**caller-owned**, this method does NOT zero them." Reading it shows real thought went into the buffer-ownership invariants — but this is fragile. One forgotten zeroize and you've leaked the master secret.

The unlock + restore flow:

1. User types password → `EncryptionKey.getPasshash(password)` → SHA-256 hash
2. `PasswordSecretBox.unseal(password, encrypted)` → derives PBKDF2 key from passhash → decrypts guard, compares, decrypts secret
3. `ProfileService` opens session via `SessionManager.open(profile, secretBuffer, passhash?)`
4. **Strict mode (default)**: `passhash` IS NOT persisted (`session-manager.ts:202`); `Fr` master secret lives in `activeSession.secret` (in-memory).
5. **Lenient mode**: `passhash` persisted to `chrome.storage.session` to allow silent re-unlock after SW termination.

The strict-mode default + the M4.5 alarm-based proactive TTL lock are the strongest things in the wallet. Lock invariants and corner cases (`session-manager.ts:519-545`) are explicitly thought through:

- Stale alarm (re-scheduled after refresh): gated via `alarm.scheduledTime === lockedAt`
- Toggle-strict-on mid-session: `clearPasshash()` mutates in-memory + storage with explicit ordering
- TTL change during active session: handled in `applyTtlChange()`
- Password profile restore + null unseal: silent close
- Passkey profile restore: skipped (browser requires user gesture)

The session-manager is a **579-line, doc-string-heavy, race-aware piece of code** with 16 distinct race comments. This is what production-grade looks like. It got there via M2/M3/M4 iteration, not by accident. _This is one of the legitimately good things._

The not-so-good:
- **Where does the unlocked secret live during a sendTx flow?** `ProfileService.getProfileSecret(profileId)` (called by `AccountService.deriveAccountSecret`) returns the `Fr` from `SessionManager.getSecret`. Account secret is then `poseidon2Hash([master, chainId, type, index])`. The master `Fr` is held the entire SW lifetime. There's no "ephemeral key for this tx only" pattern; the master is always derivable and always in memory while unlocked.
- **No HSM / hardware-key story.** No mention of WebCrypto's non-extractable keys. The PBKDF2 base key IS marked `extractable: false` (`encryption-key.ts:24`) but the derived AES key is also non-extractable. So the bytes don't escape — but the master `Fr` after decryption is plain bytes in JS heap.

## 7. dApp ↔ wallet

`packages/wallet-bridge/` (the dApp surface, post-M3.5 extraction):

- **Discovery + key exchange**: handled by upstream `@aztec/wallet-sdk`'s `BackgroundConnectionHandler` (`wallet-sdk/background.ts:88-160`). ECDH P-256, AES-256-GCM. **Nulo doesn't roll its own protocol** — strong choice.
- **Origin gating**: `validateContentScriptMessage` (zod-validated, `wallet-sdk/background.ts:97-107`) drops adversarial content-script envelopes. M4.1 hardening.
- **Approval flow**: dApp sends `requestCapabilities` → `WalletSdkDispatcher` → `DappInteractionService.requestCapabilities` → opens approval popup via `WindowManager` → user approves/rejects → `dappSessionService.setCapabilities`. Full loop is 5+ services deep but each link is small.
- **Session management**: `DappSessionService` stores per-origin session records with capability grants. `DiscoveryQueue` (`wallet-bridge/src/discovery-queue.ts`) holds discoveries while wallet is locked, drains on unlock.
- **CAIP-2 / CAIP-10 chain & account formatting** (`wallet-bridge/src/caip.ts`) — proper CAIP support. This is the right primitive for a multi-chain wallet, even though Aztec is the only chain.
- **Capability map** (`wallet-bridge/src/capability-map.ts`) maps method names to required capability classes, with `isCapabilityExempt` for chain-info etc. **Scope enforcement** (`wallet-bridge/src/scope-enforcement.ts`) checks per-method args against granted scopes (53 tests in `scope-enforcement.test.ts`). Both are the right design.

What's there:
- Method dispatch table (`dispatcher.ts:118-136`) maps wallet-sdk method names (`sendTx`, `simulateTx`, `registerToken`) to internal `Operation.kind`s (`aztec_sendTx`, ...).
- Per-session sequential message processing (`wallet-sdk/background.ts:85-87, 161-167`) — `sessionQueues` ensures messages from the same dApp don't process concurrently. This is THE critical correctness invariant; without it `executeUtility` can run before `registerContract` completes. Per-session FIFO is the right choice.

What's missing:
- **No batching at the protocol layer.** The dispatcher takes one method per request. There's no "execute these 3 ops atomically" entry point besides what the underlying ExecutionService offers.
- **No revoke flow visible to dApps.** dApp can't poke "do I still have permission?" — they have to call a method and handle revocation. Workable but thin.
- **The decrypt-queue monkey-patch** (already discussed). Most concerning piece in this domain.

## 8. Account adapter

`packages/aztec-runtime/src/account/nulo-account.ts:30-204`. Wraps upstream `@aztec/accounts/schnorr`. What's actually customized:

```ts
public static async new(secret: Fr, logger: ILogger): Promise<NuloAccount> {
  const signingKey = deriveSigningKey(secret)            // upstream — uses IVSK_M (TODO upstream)
  const keys = await deriveKeys(secret)
  const accountContract = new SchnorrAccountContract(signingKey)
  const { constructorName, constructorArgs } = await accountContract.getInitializationFunctionAndArgs()
  const instance = await getContractInstanceFromInstantiationParams(SchnorrAccountContractArtifact, {
    constructorArgs, constructorArtifact: constructorName, publicKeys: keys.publicKeys, salt: Fr.ZERO,
  })
  ...
}
```

Customizations:

1. **Salt pinned to `Fr.ZERO`** — deterministic re-creation from `(seed, chainId, type, index)`. Means index collision = address collision; not a problem for a single-user wallet but limits multi-account future where salt would let re-seal the same secret to a new address.
2. **Recursive payload chunking when `calls.length > APP_MAX_CALLS=5`** (`nulo-account.ts:120-125, 144-159`). Each chunk wraps via `entrypoint.wrapExecutionPayload`, gets its own outer-authwit. **This is genuine business value — Aztec's 5-call limit is a hard protocol cap, and the recursive wrap is the right pattern.**
3. **First-tx initialization wrapping** (`buildWithInitialization`, `nulo-account.ts:165-203`). When `initNullifier` doesn't exist yet, the tx wraps `[ctor, ...userPayload]` via `DefaultMultiCallEntrypoint` so the account is published AND the user's first call executes in one shot. Good UX.

What it pays for:
- **Uses upstream `deriveSigningKey(secret)`** which has an upstream TODO (`AztecProtocol/aztec-packages#5837`): the upstream comment says it should use a dedicated signing-key derivation but currently uses `IVSK_M`. **Nulo follows upstream's mistake by design** — when upstream fixes it, every existing account's signing key changes, which means every existing user's account address changes (because `publicKeys` feed into instance derivation). This is a wallet-eating migration. Status: queued behind upstream.
- **Pre-0.11.0 accounts wiped, no migration.** Storage migration v2 wiped all legacy accounts (CLAUDE.md is explicit; `migrate.ts` confirms). This was correct given Nulo had no users; it sets a precedent that the wallet can break account state when the on-chain contract changes.

The `NuloAccount.buildTxExecutionRequest` flow (`nulo-account.ts:102-138`) is clean. Recursive chunk loop, then `ensureRegistered`, then check `initNullifier`, then either `entrypoint.createTxExecutionRequest` or `buildWithInitialization`. **Reads well.**

## 9. UI architecture

Vue 3 + Pinia + vite-plugin-pages + auto-imports + `<script setup>`.

The M6 layer model (CLAUDE.md "M6 layer model" + `biome.json:104-280`):

```
[L0] design tokens → [L1] core primitives → [L2] ui primitives → [L3] composites
                                                                       ↓
                  [L4] feature modules → [L5] popups+windows → [L6] pages

[C0] pure utilities ──┐
                      ├── composables (ban service-client lifecycle in C0/C1)
[C1] service hooks ───┘
```

**These layers are biome-enforced.** A composable can't import a service client. A composite can't import a store. This is real. Most extension codebases with "design system" layers don't actually enforce them.

The good:
- **SFC ordering convention** (CLAUDE.md). Imports → macros → store → composables → router → reactive state → service clients → functions → watchers → lifecycle. Real teams document this; few enforce it. Nulo writes it as a convention; whether it's followed in every file is another matter (spot-check `popup/windows/execute/index.vue:1-72` — yes, it does follow).
- **Auto-imports** (vite config) for Vue APIs, Vue Router, composables, stores, components. Removes ~100 imports per page on average. Nice; cuts boilerplate.
- **Composable pattern with explicit `dispose()`** (CLAUDE.md "Cleanup order in `onBeforeUnmount`"). C1 composables do NOT own their own `onUnmounted` — the parent calls `dispose()` in the existing slot. Avoids the C1 vs parent unmount ordering issue.
- **Hard Rule #6 (testid preservation)**: every extraction preserves all `data-testid` verbatim. e2e selectors don't break during M6 refactors. Followed religiously across 12 sub-PRs.
- **Hard Rule #8 (BUG PIN test)**: when extracting a function, preserve buggy behavior verbatim, document with a test pin. Real grown-up engineering — separates structural moves from behavioral fixes.

The not-so-good:
- **Auto-imports make IDE refactoring fragile.** "Find references" misses auto-imported component usages because the SFC compiler resolves them at build time, not at TypeScript level. Workable; sometimes annoying.
- **Pinia stores still leak to popup pages** for some state (`useAppStore`, `usePopupStore`). The store's `chrome.storage.local.get` calls inside `app.store.ts:38, 47` are exactly the AUDIT.md A7 violation.
- **`app.vue` is the orchestration spaghetti.** Lines 105-145 are explicit comments about racing initial-load triggers (`onActiveProfileChanged` listener + `loadProfile` re-entry on `isBackgroundConnected` flip both fire `initAccount`). The fix lives server-side as `ensureDefaultAccount` idempotency + per-tuple lock; the popup-side dual-trigger is "we know it races, server handles it." This is firefighting, not designing-it-out.
- **The `confirm dialog promise upgrade` follow-up** (M6 STATUS.md) — `cacheStore.confirm.callback` pattern is used 30+ places. It's a 2018-era imperative API in a 2026 codebase. Promise-based ergonomics is a quality-of-life win that would simplify ~30 sites. Deferred.
- **9 console.error calls in popup files** (`useContactImportExport.ts`, `useFullBackupImport.ts`, `FeeSettingsCard.vue`). These bypass the LoggerService and surface in DevTools. AUDIT.md A3 was about SW-side; these are the popup-side equivalent.

## 10. Long-running ops (proof generation)

The end-to-end flow for a dApp `sendTx`:

1. dApp → content-script → SW: encrypted `sendTx` message
2. `wallet-sdk/background.ts:onWalletMessage` → `sessionQueues` (FIFO per session)
3. `WalletSdkDispatcher.dispatch("sendTx", args, ctx)` (`wallet-bridge/src/dispatcher.ts:188`)
4. `dispatcher.handleSendTx` → either silent (if pre-granted) or **opens approval popup** via `DappInteractionService.execute(params)` → `windowManager.create(...)` → wait
5. User approves → `DappInteractionService.approveInteraction(id, operations, origin)` → calls `executionService.executeOperations(operations, origin)`
6. `ExecutionService.executeOperations` → kicks off proof generation (kernelless discovery sim → real sim → finalize gas → prove → send)
7. Result returns up the chain, encrypted, back to dApp

The good:
- **Per-session FIFO at the wallet-sdk handler** (`wallet-sdk/background.ts:160-167`).
- **`TaskService` provides progress events** (`task/service.ts`) so the popup can show a spinner with intermediate states. Tasks have `WrappedTask` parent → child relationship for nested ops.
- **`OperationJournalService`** (`operation-journal/service.ts`) records every op with state transitions. Audit trail.
- **`Lock` with 5-minute force-release safety net** (`wallet-core/src/utils/lock.ts:38-44`). If a lock holder forgets to call `leave()`, the lock force-releases. **This is firefighting, but it's the right kind of firefighting** — one buggy code path won't wedge the entire profile mutex.

The not-so-good:
- **Approval popup timeout is 10 minutes** (`dapp-interaction/service.ts:42`). If the user walks away mid-proof, the dApp is hung for 10 minutes. The dApp can `cancelInteraction` via `cancellationToken`, but there's no protocol-level "I gave up" from the dApp side that auto-cleans.
- **No actual cancellation of in-flight proofs.** `cancellationToken` cancels the popup interaction (`dapp-interaction/service.ts:131-135`); it does NOT abort an active prove call. The cancel emits `onInteractionCancelled` which the popup observes — if the popup navigates away, the SW continues proving and the result is dropped. **No `AbortController` flows through prove**. Wastes user CPU. Search for `AbortController` returns 0 hits in the wallet directory.
- **No pre-flight estimation of "will this prove succeed?"** Sometimes proving fails after sim succeeds (gas estimate too tight, kernelless edge cases). User waits minutes for a failure. Some retry-with-bumped-gas heuristic would help.
- **The "what happens if the SW dies during prove" answer is "the user re-opens the popup, sees the request gone, dApp times out."** No persistent prove-state in `chrome.storage`; the in-flight TxRequest is in-memory only. Chrome MV3 is supposed to keep workers alive during active port connections, and the popup keeps a port open during the approval flow, so this is mostly OK — but if the popup also closes, the SW dies, and there's no recovery. The dApp must retry.

## 11. Migrations

Already covered in §5. `runStorageMigration` is a destructive wipe gated by `STORAGE_VERSION_KEY`. Three versions to date:
- v2: post-upstream-`SchnorrAccount` migration (wiped legacy accounts)
- v3: M4.10 network rework (wiped networks + UI active pointers + journal)

The pattern is: bump `CURRENT_VERSION`, add the keys/prefixes you want to wipe, ship. **It is not a real migration framework.** It's "if version differs, wipe these subtrees and let services re-seed defaults."

For pre-launch, this is fine. Post-launch, it's wallet-eating.

## 12. Testing posture

Numbers:
- **517 unit tests** (post-M2/M3/M6 coverage push from 55 baseline; AUDIT.md A6).
- **166 e2e cases** in Puppeteer-based vitest (from `tests/e2e/`).
- **`audit:vue` script** (`package.json:23`): `bun run typecheck:all && bun run test && bun run lint && bun run build` — sequential, fails fast.
- **Component test conventions** documented in CLAUDE.md (Vitest + `@vue/test-utils` + `createTestingPinia`, ≥5 cases for L1/L2 primitives, ≥10 for L3 composites/composables).

The good:
- **Service-client integration tests** (`profile/service.integration.test.ts:525 lines`, `account/repository.test.ts`, `passkey-recovery-coordinator.test.ts`).
- **Cross-version vectors for crypto** (`wallet-crypto/src/password-secret-box.test.ts` includes M2.6 V2 vectors). Means a future PBKDF2 change can't silently brick existing profiles.
- **Per-PR audit:vue gate**. The 4-step sequential gate is a real pre-PR ritual.
- **e2e test stabilization push** (commit `184f77b fix(e2e): post-m6 stabilization`). Fixed 4 flakes in one PR. Discipline.

The honest gaps:
- **No load tests, no soak tests.** What happens with 1000 accounts? 10000 tx history rows? Storage abstractions degrade linearly (§5). Not measured.
- **No fuzz tests for the wallet-sdk dispatcher.** Adversarial dApp messages: tested for the few scenarios in `scope-enforcement.test.ts`, not broadly fuzzed.
- **Lost Pixel (visual regression) skipped.** STATUS.md is explicit about the deferral and the skip-retrospective. Not bad, but means UI regressions from refactors rely on manual smoke matrices (also documented, also brittle).
- **Storybook works but there are 0 stories outside Button.** Histoire was the original choice, hit Vite-7 incompat, swap to Storybook 10 was forced. The pivot was 1 story (`Button.stories.ts`); the rest of the L1/L2/L3 primitives don't have stories yet.
- **Three known e2e flakes still in master** (`STATUS.md`): `contacts.test.ts > edit + delete contact` (popup-internal `waitForToast`), `appearance.test.ts > theme persists across nav` (popup-internal `navigateByHash`), `security.test.ts > auto-lock TTL change`. They predate M6; nobody has burned a PR on them.
- **`NewContactPopup` registerAsSender bug** (M6 STATUS.md follow-up) — defaults the toggle on, fails silently on networks where the contract isn't deployed. e2e helper `addContact` was patched 2026-05-08 to untick the toggle. The product bug is not fixed; e2e was unblocked. **This is the right priority order** (unblock the test gate, then schedule the product fix), but if it never gets scheduled it becomes a chronic.

## 13. Known pain points

Curated from CLAUDE.md, AUDIT.md, M6 STATUS.md, race comments:

### Open AUDIT items (post-M6 status)

- **A5** — `port!.postMessage(request)` non-null assertion race (`packages/extension-messaging/src/background/client.ts:176`). Not fixed.
- **A7** — 10 popup files still bypass storage abstractions with raw `chrome.storage.local.*`. Not fixed.
- **A10** — `EntityStorage.getAll/getKeys/getValues` fetch entire namespace + filter. Not fixed.
- **A16** — magic numbers throughout (PBKDF2 iterations is justified inline; others are not). Not addressed.
- **A18** — `service.onXyz.add(handler)` pattern duplicated in 9+ Vue components. Not extracted.

### Hard Rules from CLAUDE.md (carry-forward lessons)

- **Hard Rule #4 (cleanup order in `onBeforeUnmount`)**: profileService.disconnect() → interactionService.disconnect() → executionService.disconnect() → composable's dispose() → clearTimeouts → removeEventListener("beforeunload", reject). Service.disconnect MUST run before composable.dispose. **The lesson came from A11 — getting it wrong wedged tests.**
- **Hard Rule #6 (testid preservation)**: enforced across 12 M6 sub-PRs without breakage.
- **Hard Rule #8 (pre-existing bug pinning)**: extracted code preserves bugs verbatim, documents via test pins. The `humanizeOperationKind` underscore-replacement bug is the canonical example (M6 STATUS.md follow-up — "fix in a separate `fix(execute):` PR").
- **Composables MUST NOT own their own `onUnmounted`.** Parent calls `dispose()` in existing slot. Lesson from when composables added independent unmount and the cleanup order broke.

### Race conditions documented in code

- **AccountService per-tuple lock** (`account/service.ts:113-130`): without it, concurrent `createAccount` + `ensureDefaultAccount` produce duplicate accounts.
- **DappInteractionService detach-before-handoff** (`dapp-interaction/service.ts:91-92`): popup `onRemoved` event races with async execution that follows approval. Detach stops the listener.
- **SessionManager strict-toggle race** (`session-manager.ts:288-295`): clearing in-memory passhash before storage avoids re-persisting on concurrent refresh.
- **PasskeyService 5-min TTL alarm** (`passkey/service.ts:14`) for "popup crash, MV3 suspension races."
- **wallet-sdk per-session decryption serialization** (the monkey-patch).

### Deferred items in M6 STATUS.md

- ConfirmDialog promise-API upgrade (~30 sites).
- `NewSenderPopup` / `EditProfilePopup` decomposition (don't fit `EntityForm` pattern).
- Pre-existing humanize bug.
- `Button.vue` `large` variant has no padding (latent defect since Phase 2).
- Storybook light/dark theme switcher (light-theme PR prerequisite).
- `AmountCard.vue:79` hero amount input (defer to "HeroInput" primitive).
- `NewContactPopup` `registerAsSender` default-on bug (product bug, not yet fixed).

## 14. What we're proud of

These are not fluff. Each costs something to do right:

1. **Package boundaries enforced via biome `noRestrictedImports`** (`biome.json:64-280`). 8 packages, each with a layer rule, all enforced at lint time. Most "modular" wallet codebases rot to spaghetti within a year because the layering is documentation-only.
2. **`PasswordSecretBox` + cross-version vectors.** The encryption guard, the buffer ownership semantics, the M2.6 frozen vectors. A future cryptographic change can't silently brick existing profiles.
3. **Strict security mode default + alarm-based proactive TTL.** AUDIT.md A1 (passhash in session storage) is fixed by design as of 0.13.9.
4. **`NuloAccount` adapter pattern.** Wraps upstream `@aztec/accounts/schnorr` instead of forking. Recursive payload chunking, first-tx multicall wrapping, kernelless authwit discovery — these are non-trivial Aztec-aware features, not boilerplate.
5. **M6 layer model with biome enforcement.** L0-L6 + C0/C1 with concrete restrictions. The composable/service-client separation rule is rare and correct.
6. **`audit:vue` per-PR gate**, structured `WalletError` round-trip, typed RPC, `ContentScriptConnectionHandler` from upstream (no self-rolled protocol), `DiscoveryQueue` for locked-state queueing, port-based DI for testability (`FakeBrowserApi`).

## 15. What feels rickety / first-time-implementer

The honest list:

1. **`(handler as any).handleEncryptedMessage = …` monkey-patch** (`wallet-sdk/background.ts:181`). The "TODO: remove if wallet-sdk adds a proper serialization API" is the most quoted comment in the codebase. Until upstream fixes it, every wallet-sdk minor bump risks subtle correctness regressions.
2. **`port!.postMessage(request)` non-null assertion on a known race** (`extension-messaging/src/background/client.ts:176`). AUDIT.md A5, three years old. Hasn't bitten because reconnect is fast; will bite eventually.
3. **`ensureInitialized` polls every 500ms for up to 30s** (`extension-messaging/src/background/service.ts:129-141`). Should be a Promise. Workable, ugly.
4. **Master-state-in-module-globals on the popup side**: `managers.profile`, `managers.network`, etc. constructed at popup boot, mutated as profile/network change. Test-friendly at the SW edge, untestable singleton glue at the popup edge. `app.vue:140` fires the same `initAccount()` from two trigger paths and expects the SW-side per-tuple lock to dedup.
5. **No protocol-level cancellation of in-flight proofs.** `AbortController` is absent. User waits, dApp waits, SW chugs. Cancellation cancels the *popup interaction*, not the *prove*.
6. **No SW persistent state for in-flight tx.** If the SW dies mid-prove, the request is dropped. Real-world impact is small (popup keeps the port open) but the design has no backstop.
7. **Storage migrations are destructive wipes.** "This wallet has no production users" is the wallet-eating timebomb. Once users exist, every migration becomes a feature freeze.
8. **`EntityStorage.getValues()` fetches the entire chrome.storage namespace and filters in JS** (AUDIT.md A10). Linear-time degradation hidden behind `await`.
9. **Heartbeat is the sole keepalive** (`runtime.ts:148-154`). No alarms-based wake-up. Cold-boot a dApp message pays the full BB-WASM-init + service-graph latency.
10. **9 console.error calls in popup files** bypassing LoggerService (AUDIT.md A3 popup-side equivalent).
11. **10 popup files use raw `chrome.storage.local.*`** with hardcoded magic key strings (AUDIT.md A7).
12. **No actual offscreen pre-warming.** First PXE call after cold boot pays the full offscreen-create + READY-handshake latency (~hundreds of ms before any work starts).
13. **`Lock` force-release after 5 minutes** (`wallet-core/src/utils/lock.ts:37-44`). It's the right safety net; it's also a "we don't fully trust ourselves to call leave()" signal.
14. **Pre-existing `humanizeOperationKind` bug** (only replaces FIRST underscore — multi-underscore op names render incorrectly). Pinned via test, deferred since M6.
15. **3 known-flaky e2e tests** still on master (M6 STATUS.md). Documented; not fixed.
16. **`NewContactPopup` `registerAsSender` default-on silently fails on networks without the sender contract** (M6 STATUS.md, 2026-05-08). E2e was unblocked by patching the helper to untick the toggle; product bug remains.
17. **Auto-create-default-account watcher race in `app.vue`** (lines 105-145). Two trigger paths fire the same path; the fix lives server-side as idempotency. Hammer instead of stitch.
18. **The 7-line `confirm dialog callback` pattern** is the dominant UI confirmation flow (~30 sites). 2026 codebase, 2018 ergonomics.
19. **`appStore.profile = profiles[0]` fallback** (`popup/index.ts:96`) — implicit "first profile" semantics. Edge cases (corrupted profile, user deleted active during another tab session) underspecified.

---

## Appendix: package boundaries summary

For the cross-comparison table:

```
wallet-core              (foundation; pure ports + types; NO chrome.* via biome rule)
  ↑
wallet-crypto            (KDF + encryption; depends on wallet-core)
  ↑
extension-messaging      (RPC plumbing; depends on wallet-core)
  ↑
aztec-runtime            (PXE + account; depends on wallet-core + extension-messaging)
  ↑
wallet-bridge            (wallet-sdk dispatcher; depends on wallet-core + extension-messaging — NOT aztec-runtime)
  ↑
extension                (sink; can import anything below)
```

Inside `@nulo/extension`:
```
[L0] design tokens → [L1] core primitives → [L2] ui primitives → [L3] composites
                                                                       ↓
                  [L4] feature modules → [L5] popups+windows → [L6] pages
[C0] pure utilities, [C1] service hooks (orthogonal to L0-L6)
```

Both sets of layer rules are enforced via biome `noRestrictedImports` (`biome.json:64-280`); violations fail `bun run lint`.

## Appendix: numbers

- **Source**: ~32k LoC across 8 packages (per `find packages -name "*.ts" -o -name "*.vue" | xargs wc -l`)
- **Tests**: 517 unit + 166 e2e = 683 total
- **Services**: 25 (in `wallet/services/`)
- **Largest service**: `ExecutionService` at 1920 LoC — _too big_; explicit collaborator extraction (`OperationPlanner`, `ContractResolver`, `AuthwitDiscoverer`, `TxRequestBuilder`, `ExecutionCoordinator`, `*Strategy`) kept it below 2000 but it's the next M-arc decomposition target.
- **`@ts-ignore` in hand-authored source**: 0 (verified by AUDIT.md A12 grep, 2026-05-08).
- **`console.*` calls in src/ that bypass logger**: 31 (~9 in popup, ~3 in console-sniffer wiring, rest in tests/fixtures).
- **Race comments**: 16+ explicit "race" mentions across services. Documents thinking; also reveals the cost of the architecture.

Reference points across this document use `path/to/file.ts:LN` notation matching the master HEAD at `65ea47a`.
