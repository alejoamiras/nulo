# Grego's Aztec wallet — architectural deep-dive

**Source tree analysed:** `(Grego source tree)`
**Author context:** Grego is the developer of `@aztec/aztec.js` itself, so PXE-usage choices in this repo can be treated as canonical.

The repo is a Yarn 4 / Turbo monorepo with five separate "wallet flavors" (per `README.md:18-30`) sharing a single `shared/` core that contains `ExternalWallet`, `InternalWallet`, `WalletDB`, every `*-operation.ts`, the `AuthorizationManager`, and the `DecodingCache`. Three of those flavors ship as runnable apps and are the focus of this document:

1. **`app/` — Electron desktop app** with a worker-thread PXE host bridged to a separate browser extension via Native Messaging.
2. **`extension/` — relay browser extension** (WXT). No business logic. Talks to `app/` over Native Messaging.
3. **`extension-wallet/` — self-contained extension** (also WXT). Same `shared/` core, but PXE runs in the extension's offscreen document. Coexists with `extension/` (different `WALLET_ID`s, both surface in the wallet-sdk discovery UI per `README.md:30`).

The remaining flavors (`web/` standalone + iframe) reuse the same `shared/` core for cookie-synced web-wallets — out of scope here, but the cookie-encryption logic at `web/src/wallet/sync-cookies.ts:184-228` (PBKDF2 + AES-GCM + chunked cookies for accounts/contacts/capabilities) is the reason `shared/` is so disciplined about being host-agnostic.

> The "browser extension wallet" lens promised by the assignment is a partial fit: in `extension/` the SW is a pure relay (the meaty case), but `extension-wallet/` shows the same author's offscreen-document approach for comparison. I treat both — the Native-Messaging path is the headline, the offscreen path is the contrast.

---

## 1. Cross-process architecture

End-to-end, the request path from a dApp running on `https://app.example` to the Electron host has six hops:

```
+----------+    in-page    +----------+    runtime    +-------+   stdio   +-------+   unix   +----------+   utility    +----------+
|  dApp    |  ECDH+AES-GCM | content  |   .sendMsg    |  SW   | length-   | native|  socket  | Electron |   process    |  wallet  |
|  page    | <-----------> |  script  | <-----------> |       | prefix    |  host | <------> |   main   | MessagePort  |  worker  |
+----------+   wallet-sdk  +----------+    JSON       +-------+   JSON    +-------+   newln  +----------+    ports     +----------+
                              relay         relay      relay     LE u32     relay   delim       relay        binary       PXE +
                                                                                                                          sched
```

Each hop has its own protocol; nothing inside the wallet ever does a single-socket end-to-end RPC.

### Hop 1 — dApp ↔ content script (in-page)

Driven entirely by `@aztec/wallet-sdk` from outside the repo. The content script in this repo is an explicit non-actor (12 lines):

```ts
// extension/entrypoints/content.ts:14-23
export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    const handler = new ContentScriptConnectionHandler({
      sendToBackground: (message) => browser.runtime.sendMessage(message),
      addBackgroundListener: (listener) => browser.runtime.onMessage.addListener(listener),
    });
    handler.start();
  },
});
```

The `ContentScriptConnectionHandler` (from `@aztec/wallet-sdk/extension/handlers`) handles the discovery handshake (the wallet-sdk emits a discovery event via `window.dispatchEvent`, the content script re-emits to the SW, the SW returns wallet metadata). After discovery + ECDH, the dApp encrypts every payload before posting; the content script never sees plaintext. The whole content script is one `start()` call — that's the security argument and it's correct.

### Hop 2 — content script ↔ SW (extension runtime)

`browser.runtime.sendMessage` / `onMessage`. The SW (`extension/entrypoints/background.ts:125-197`) wraps an SDK `BackgroundConnectionHandler` that handles the heavy lifting: parsing wallet messages, tracking pending discoveries, storing active sessions, exchanging session IDs, holding the wallet-side ECDH keypair. The SW only injects four callbacks (`onPendingDiscovery`, `onSessionEstablished`, `onSessionTerminated`, `onWalletMessage`) and a transport pair (`sendToTab`, `addContentListener`). On a real RPC call (`onWalletMessage`), it stamps a session-id into a `pendingRequests: Map<string, string>` (messageId → sessionId, line 46) and forwards the *raw* SDK message to the native host:

```ts
// extension/entrypoints/background.ts:182-195
onWalletMessage: (session, message) => {
  console.log("Processing RPC call:", message.type);
  if (nativePort) {
    pendingRequests.set(message.messageId, session.sessionId);
    nativePort.postMessage(message);
  } else {
    sessionHandler.sendResponse(session.sessionId, {
      messageId: message.messageId,
      walletId: WALLET_ID,
      error: { message: "Wallet backend not connected" },
    });
  }
}
```

Reverse direction is symmetric (line 384-409): the SW runs every native-host frame through `ChunkReassembler.process()` (handles the 1 MB native-messaging cap), looks up the sessionId by `response.messageId`, and routes back to the SDK with `sessionHandler.sendResponse(sessionId, response)`.

### Hop 3 — SW ↔ native host (stdio length-prefix)

`browser.runtime.connectNative("com.aztec.keychain")`. The native-messaging wire format is "4-byte LE uint32 length + UTF-8 JSON." The native host implements the spec by hand at `app/src/native-host/stdio.ts:99-160`. The 1 MB cap on incoming messages is real (Chrome enforces it) — the host *splits* outgoing payloads into ~900 KB chunks, marked with `__chunked: true, chunkId, chunkIndex, totalChunks, data`, and reassembles on the SW side via `ChunkReassembler` (`extension/utils/chunk_reassembler.ts:73-114`) with a 30 s stale-chunks GC (`cleanup()` line 119). Inbound — i.e. the SW sending to the host — the spec allows up to 4 GB in one frame, so no chunking on that direction.

### Hop 4 — native host ↔ Electron (unix socket / named pipe + newline JSON)

The native host is a tiny binary spawned by Chrome (`app/src/native-host/index.ts:29-78`). Its only job is "bridge stdio to a socket":

- macOS/Linux: `~/keychain/wallet.sock` (Unix domain socket)
- Windows: `\\.\pipe\aztec-keychain-wallet`

Path resolution lives in `app/src/shared/paths.ts:11-21`. Wire format is **newline-delimited JSON** — different from the stdio format on purpose, because the unix socket has no inherent message framing and JSON-with-`\n` is the cheapest sane delimiter. The IPC client (`app/src/native-host/ipc-client.ts:123-143`) buffers partial reads and splits on `\n`. Reconnect is built in: `ECONNREFUSED` / `ENOENT` retry with `reconnectDelay * attempts` backoff, max 10 attempts (line 76-89).

Crucially the host keeps **zero state** other than the reconnect counter — every message it sees flows through unchanged. There is one carve-out though, processed by the Electron main: `{type: "focus-app"}` (`app/src/main.ts:179-189`) bypasses the wallet worker and calls `focusMainWindow()` directly. That's the "wallet wants attention" channel.

### Hop 5 — Electron main ↔ wallet worker (`MessagePortMain`)

The main process spawns the worker as an Electron `utilityProcess.fork()` and hands it three `MessageChannelMain` ports:

```ts
// app/src/main.ts:294-317
const { port1: externalPort1, port2: externalPort2 } = new MessageChannelMain();
const { port1: internalPort1, port2: internalPort2 } = new MessageChannelMain();
const { port1: walletLogPort1, port2: walletLogPort2 } = new MessageChannelMain();

const ipcServer = createIpcServer(externalPort1);
externalPort1.start();
// ... env hand-over ...
const wallet = utilityProcess.fork(join(__dirname, "wallet-worker.js"), [], { env: filteredEnv });
wallet.postMessage({ type: "ports" }, [externalPort2, internalPort1, walletLogPort1]);
```

So:

- `externalPort` carries dApp-originated messages (relayed from the unix socket).
- `internalPort` carries wallet-UI-originated messages (renderer ↔ main ↔ worker).
- `walletLogPort` proxies pino logs out of the worker.

Inside the worker, `process.parentPort.once("message", ...)` (`app/src/workers/wallet-worker.ts:276-278`) destructures the three ports out of `message.ports` and `port.start()`s each. Routing per port:

```ts
// app/src/workers/wallet-worker.ts:281-307 (external port)
externalPort.on("message", async (event) => {
  const { origin, content } = event.data;
  if (origin !== "native-host") return;
  const messageContent = JSON.parse(content);
  const { type, messageId, args, appId, chainInfo } = messageContent;
  if (appId === "this") throw new Error("External messages cannot have this as appId");
  const wallets = await init(parsedChainInfo, appId, internalPort, logPort);
  handleEvent(externalPort, wallets.external, WalletSchema, type, messageId, args, userLog);
});
```

`appId === "this"` is a sentinel — the renderer uses it to mean "internal request, no scope" (lines 308-349). External messages from dApps are explicitly forbidden from claiming that.

### Hop 6 — Renderer ↔ main process (Electron IPC + preload)

`contextBridge.exposeInMainWorld("walletAPI", ...)` at `app/src/ipc/preload.ts:7-91` exposes 23 internal methods. Each is `ipcRenderer.invoke("methodName", stringifiedArgs)`. Main-process handlers (`app/src/main.ts:353-380`) iterate a hard-coded list and forward each into a `WalletInternalProxy` whose only job is to write through the internalPort. Events go the other way: the main process listens for `wallet-update` / `authorization-request` / `proof-debug-export-request` on the internalPort and `mainWindow.webContents.send(...)` them to the renderer (lines 342-351).

The hop count is large but every layer is doing one specific job. The reason it works is that `shared/src/wallet/core/external-wallet.ts` and `internal-wallet.ts` only see fully-decrypted, JSON-parsed method dispatch — every concern below them (encryption, framing, chunking, socket reconnect, port plumbing) is somebody else's problem.

---

## 2. Browser-extension role

In the Native-Messaging flavor, **the SW is a relay** — there's no real business logic in there. What it tracks (per `extension/entrypoints/background.ts`):

- Native port lifecycle + autoreconnect (`connect()` line 377; `setTimeout(connect, 1000)` on disconnect, line 445).
- Pending requests `Map<messageId, sessionId>` (line 46) so it can route async responses back to the right SDK session.
- Per-network "remembered apps" list in `chrome.storage.local` (key `rememberedApps`, lines 11-122). Schema: `{appId, origin, rememberedAt, chainId, version}`. The chainId+version pair gates auto-approval — explicit design choice from the comment at line 31-40 ("apps are only auto-approved for the same network they were originally approved on").
- Action badge with pending-discovery count (`updateBadge()` line 220).
- Popup IPC for status, sessions, discoveries, remembered-apps CRUD (the `PopupMessageType` enum + handlers).
- Disconnect / cleanup wiring on tab close + nav (lines 231-239).
- Pruning + disconnect-broadcast on backend disconnect (lines 423-441).

It also orchestrates: when a discovery arrives and the app is remembered for that network, auto-approve; otherwise open the popup so the user sees it (lines 146-162).

What it does *not* do:

- No private-key handling.
- No key derivation, no signing, no encryption.
- No PXE access (it's an extension SW, can't run PXE there at all in this flavor).
- No dApp-call validation other than `messageId` lookup.

The hard rule: if the connection drops, the SW broadcasts `error: {type: DISCONNECT, message: "Wallet backend disconnected"}` to every active session and `clearAll()`s the SDK state (lines 426-443). Sessions are not allowed to outlive the backend.

In `extension-wallet/` the SW takes on more — see §10.

**WXT framework choices.** Both flavors use WXT (`extension/wxt.config.ts`, `extension-wallet/wxt.config.ts`) to autoload entrypoints, generate manifests and run dev with a custom Chrome user-data-dir. Both pin a `key:` to the manifest (`extension/wxt.config.ts:11`, `extension-wallet/wxt.config.ts:68`) so the extension ID is deterministic — required for native messaging (the manifest's `allowed_origins` must list `chrome-extension://<id>/`) and for the extension-wallet to compute its ID at the call site. The `extension/` flavor permissions are minimal: `["nativeMessaging", "storage", "webNavigation"]`. `extension-wallet/` adds `["alarms", "offscreen"]` and a custom CSP because Aztec deps need `wasm-unsafe-eval`. There's an aliasing trick at `extension-wallet/wxt.config.ts:33-37` — `function-bind`'s `Function.bind`-with-string-Function-construction trips MV3 CSP, so it's aliased to a stub.

---

## 3. Encryption layer

I cannot find the dApp ↔ wallet encryption details *in this repo* — the entire ECDH+AES-GCM pipeline lives inside `@aztec/wallet-sdk` (out of tree). All the local code does is:

- Provide transports (`sendToBackground`, `addBackgroundListener` on the dApp side; `sendToTab`, `addContentListener` on the SW side; the latter at `extension/entrypoints/background.ts:131-134`).
- Receive a `verificationHash` per session that the popup renders as emojis for the user to compare with what the dApp displays. The comment at `extension-wallet/entrypoints/background.ts:225-228` confirms that's the security signal: "the ECDH handshake produced the same shared secret on both sides."

What I *can* infer from the surrounding code:

- The wallet-side keypair lives in the SW (the comment at `extension/entrypoints/content.ts:6-13` says "All encryption/decryption happens in the background script (service worker)" / "Content script only forwards opaque encrypted payloads"). Where it's *generated* and how it's *rotated* is an SDK question I cannot answer from this tree.
- The dApp-side keypair lives in the dApp page (handled by the wallet-sdk).
- Compression happens before encryption end-to-end (`app/src/main.ts:140` — "Compression is handled at the SDK level (compress before encrypt, decompress after decrypt)") so the native host doesn't need to know.

The native host is told nothing about encryption at all. It sees ciphertext-bearing JSON, copies bytes to a socket, copies bytes back. That's the security argument for the relay model: the only place a private key plaintext exists is the Electron worker, behind two process boundaries (main → utilityProcess) and a unix socket from the OS-level extension sandbox.

The `extension-wallet/` flavor reuses *exactly* the same SDK handshake (`new BackgroundConnectionHandler(...)` at `extension-wallet/entrypoints/background.ts:50`) so the verification-emoji UX is identical — the only difference is what's on the other side of `onWalletMessage`.

There is also **vault encryption** (separate concern — at-rest password lock). It only exists in `extension-wallet/`:

```ts
// extension-wallet/src/vault/kdf.ts:13-34
export const DEFAULT_KDF_PARAMS: KdfParams = { m: 64 * 1024, t: 3, p: 1 };
const KEY_LEN = 32;
const SALT_LEN = 16;
const PROBE_PLAINTEXT = new TextEncoder().encode("aztec-extension-wallet/probe/v1");
// argon2id from @noble/hashes
export async function deriveKey(password, salt, params): Promise<Uint8Array> {
  return argon2id(new TextEncoder().encode(password), salt, { ...params, dkLen: KEY_LEN });
}
```

The vault does an argon2id KDF + a probe-encrypt-decrypt cycle for password verification (`makeProbe` / `verifyProbe` at lines 48-71). **But: the README candidly notes (`extension-wallet/README.md` "Caveats v1") that account secrets are still stored in plaintext in IndexedDB**; the lock UX is in place but actual at-rest encryption "is deferred." That's a real gap to be aware of when comparing to Nulo.

The Electron flavor doesn't have a password lock at all — the threat model is "Electron app is the trust root, OS user account is the security boundary." It relies on Electron's `EnableCookieEncryption: true` fuse (`app/forge.config.ts:128`) for any secrets persisted via cookies, but accounts are stored unencrypted in LMDB inside `~/keychain/`.

---

## 4. PXE lifecycle

PXE creation is **lazy, single-instance per session, shared across apps**. The session key is the canonical sessionId `${chainId}-${version}` (auto-detecting `version` from the node when the input is `Fr.ZERO`, see below). Implementation lives in two places:

- `app/src/workers/wallet-worker.ts:53-220` — the Electron version, using `@aztec/pxe/server` + LMDB.
- `shared/src/wallet/session/session.ts:145-243` — the host-agnostic browser version, using `@aztec/pxe/client/lazy` + IndexedDB.

The Electron `init()`:

```ts
// app/src/workers/wallet-worker.ts:75-138
let session = RUNNING_SESSIONS.get(sessionId);
const walletExists = session?.wallets.has(appId);

if (!session) {
  const pxeInit = (async () => {
    const l1Contracts = await node.getL1ContractAddresses();
    const rollupAddress = l1Contracts.rollupAddress;
    const keychainHomeDir = join(homedir(), "keychain");
    const configOverrides: Partial<PXEConfig> = {
      dataDirectory: resolve(keychainHomeDir, `./pxe-${rollupAddress}`),
      proverEnabled: true,
    };
    const options: PXECreationOptions = {
      // pino loggers proxied over the log port…
      store: await createStore(`pxe-${rollupAddress}`, 2, { dataDirectory, dataStoreMapSizeKb: 2e10 }, log),
      proverOrOptions: { backend: BackendType.NativeUnixSocket, bbPath: process.env.BB_BINARY_PATH },
    };
    const walletDBStore = await createStore(`wallet-${rollupAddress}`, 2, { ... });
    const db = WalletDB.init(walletDBStore, walletDBLogger);
    const pxe = await createPXE(node, { ...getPXEConfig(), ...configOverrides }, options);
    return { pxe, node, db, pendingAuthorizations: new Map() };
  })();
  session = { sharedResources: pxeInit, wallets: new Map() };
  RUNNING_SESSIONS.set(sessionId, session);
}
```

Three things to highlight:

- `pxeInit` is stored as a **`Promise`** in `session.sharedResources` (the type is `Promise<{...}>` per line 42-47), so concurrent `init()` calls for the same sessionId await the same in-flight initialization. No double-create races.
- The PXE store is **keyed by `rollupAddress`**, not chainId. So upgrading the rollup contract resets the local PXE LMDB. Same for the wallet DB (`wallet-${rollupAddress}`).
- The proving backend is **`BackendType.NativeUnixSocket`** + a `bb` (`barretenberg`) binary path. PXE talks to the prover over its own unix socket — that's why Electron Forge has to extra-resource-bundle `bb` (see `app/forge.config.ts:42`) and ASAR-unpack natives.

**Why one PXE per session, hard rule.** The CLAUDE.md fragment at lines 53-71 of the wallet repo's CLAUDE.MD spells it out:

> Multiple PXE instances per session causes JavaScript Maps to get out of sync with LMDB, leading to `Cannot read properties of undefined (reading 'getValuesAsync')` errors.

This is the exact symptom from the upstream Aztec note-storage: the in-memory `Map` cache and the LMDB iterator state diverge if two PXE instances both think they own the store. The wallet-worker's session map is the only reason that doesn't happen in practice. The session.ts version says the same thing more concisely (line 8-10). **For Nulo, this is the single most important takeaway from §4: never instantiate two PXEs against the same store, even briefly.**

**Version auto-detection.** When the dApp passes `chainInfo.version === Fr.ZERO`, both implementations call `node.getNodeInfo()` and substitute `rollupVersion` (Electron version: `app/src/workers/wallet-worker.ts:66-69`). The browser version is more defensive about the *type* of `rollupVersion` because the SDK shape has shifted across versions:

```ts
// shared/src/wallet/session/session.ts:163-173
if (chainInfo.version.equals(new Fr(0))) {
  const { rollupVersion } = await node.getNodeInfo();
  const raw: unknown = rollupVersion;
  const versionFr = raw instanceof Fr
    ? raw
    : typeof raw === "string"
      ? Fr.fromString(raw)
      : new Fr(raw as bigint | number | boolean);
  chainInfo = { ...chainInfo, version: versionFr };
}
```

A canonical sessionId is then returned to the caller; the comment at `session.ts:142-148` explicitly says "callers should prefer this `sessionId` over recomputing one from the input `chainInfo` because version auto-detection happens inside this function." That solves an issue Nulo will hit if version 0 is treated as a sentinel.

**Per-app wallet pairs.** Once the shared PXE exists, `init()` creates per-appId `(ExternalWallet, InternalWallet)` pairs sharing the *same* `pxe`, `node`, `db`, and `pendingAuthorizations` map. This is the wallet-per-app authorization isolation discussed in §5.

---

## 5. Wallet-per-app authorization isolation

Each `appId` gets its own `ExternalWallet` instance — but **they share** PXE, node, DB, and the pending-auths map. Worker code:

```ts
// app/src/workers/wallet-worker.ts:144-216
if (!walletExists) {
  const internalInit = async () => {
    const externalWallet = new ExternalWallet(
      sharedResources.pxe, sharedResources.node, sharedResources.db,
      sharedResources.pendingAuthorizations, appId, chainInfo, externalWalletLogger);
    const internalWallet = new InternalWallet(
      sharedResources.pxe, sharedResources.node, sharedResources.db,
      sharedResources.pendingAuthorizations, appId, chainInfo, internalWalletLogger);
    // wire wallet-update / authorization-request / proof-debug-export-request to internalPort
    return { external: externalWallet, internal: internalWallet };
  };
  session.wallets.set(appId, internalInit());
}
```

The `ExternalWallet` derives its scope from `this.appId` (the constructor arg, stored as a protected field on `DemoWallet` at `shared/src/wallet/core/demo-wallet.ts:67`). Every persistent authorization key is then prefixed: `${appId}:${storageKey}` (see `WalletDB.storePersistentAuthorization` at `shared/src/wallet/database/wallet-db.ts:294-297`).

What's the scope of an `appId`? It comes from the dApp's manifest — embedded by the SDK during the discovery handshake. Two dApps at different origins get different `appId`s and therefore separate authorization sets. Two dApps at the same origin but with different `appId`s (e.g. `app.example/uniswap` vs `app.example/aave` if they declare different IDs) get separate sets too. The "remembered apps" entry uniquely keys on `(appId, origin, chainId, version)` for the same reason (`extension/entrypoints/background.ts:32-40`).

The `InternalWallet` has the same shape but always uses `appId === "this"` (sentinel for "trusted internal request, skip authz"). When the renderer sends a `resolveAuthorization` message in response to a user dialog, the worker recovers the **original** appId from the response payload because the user is approving on behalf of an *external* request:

```ts
// app/src/workers/wallet-worker.ts:323-340
const appId =
  type === "resolveAuthorization" && args[0].appId !== "this"
    ? args[0].appId
    : originalAppId;

const wallet =
  type === "resolveAuthorization" && appId !== "this" ? wallets.external : wallets.internal;
```

That's the only place in the worker where internal/external wires cross. Elegant carve-out.

---

## 6. Capability-based authorization

This is one of the standout sections. The wallet implements **capability manifests** as a stable, declarative permission model — six types (`accounts`, `contracts`, `contractClasses`, `simulation`, `transaction`, `data`) — with persistent grants in LMDB and *progressive wildcard matching* against incoming operations. The full type list and storage-key encoding are at the top of CLAUDE.MD (lines 89-154 of the wallet's CLAUDE.MD). The flow:

### 6a. `requestCapabilities` operation

`shared/src/wallet/operations/request-capabilities-operation.ts:38-419` is a 3-phase ExternalOperation. The `check` phase (line 58-160) computes the storage keys from the manifest, queries `db.checkAuthorizationKeys(appId, allKeys)`, and **early-returns the `WalletCapabilities` response if all non-transaction caps are already granted**. Crucially:

- Transaction capabilities never count toward "all granted" — line 71-74. (CLAUDE.MD policy: tx caps always require approval per-tx.)
- Pre-registered contracts in PXE get auto-promoted to "granted" (lines 89-103). If the user already registered a contract via UI, dApps that ask for `registerContract:0x123` get an implicit grant.
- If `nonTxMissingCount === 0`, reconstruct the granted set from stored data (lines 113-156) — for `accounts`, the stored data carries the actual address list, not just "yes/no."

The `prepare` phase computes which capabilities are new for display, walks contract address sets to pre-resolve their friendly names through `DecodingCache.getAddressAlias` (lines 326-330), and builds an `existingGrants` map for the UI to render checkbox states correctly. `requestAuthorization` triggers the UI dialog and stores both the grants and the per-app **authorization behavior**: `mode: "strict" | "permissive"` and `duration` (default 30 days) at line 387-389.

### 6b. AuthorizationManager — the runtime check

Every external operation calls `authorizationManager.requestAuthorization([items])` with `persistence: { storageKey, persistData }`. The manager (`shared/src/wallet/managers/authorization-manager.ts:41-180`):

1. For each item with persistence, checks exact match first, then **progressive wildcard** (lines 218-256):
   - `simulateTx:0x123:swap` → `simulateTx:0x123:*` → `simulateTx:*`
   - `registerContract:0x123` → `registerContract:*`
2. Auto-approves items whose keys are all already authorized; collects the unsatisfied ones.
3. Tracks **all** requested keys in `__requested__` (line 203-216) so the Apps tab UI shows everything the dApp ever asked for, even if the user denied.
4. Strict mode: rejects unauthorized items entirely except for `requestCapabilities` (lines 110-124) — that's the only meta-operation always allowed.
5. Otherwise dispatches an `AuthorizationRequestEvent`, awaits user response, and on approval persists the new grants (lines 149-170).

The `pendingAuthorizations` map is shared across all wallets in the session, which means **a single user dialog can resolve authorizations for either external or internal callers** simply by checking the appId on the response (the resolver finds the entry by request id, not by which wallet emitted it).

### 6c. The 4-phase `ExternalOperation` pattern

`shared/src/wallet/operations/base-operation.ts:38-206` codifies a 4-phase contract: `check → createInteraction → prepare → requestAuthorization → execute`, with an `executeStandalone()` orchestrator that wraps everything in unified error handling (lines 175-205). Key invariants:

- `check()` can early-return; if so, no interaction is created — important for `registerContract` returning the existing instance instead of re-prompting.
- `prepare()` is **side-effect-free** — comment at line 18-19, repeated as Design Principle #3 in CLAUDE.MD: "users might deny, never persist during prepare." `simulate-tx-operation.ts:177` *does* call `db.storeTxPayloadData` from prepare, which is technically a violation but reasonable (the simulation result is needed for trace display even if execution is denied).
- `execute()` does the actual side effect (PXE call, persistent state mutation).
- `requestAuthorization()` creates the dialog — single ID + `pendingAuthorizations.set(...)` + dispatch + await.

A nice property: every operation can run *standalone* via `executeStandalone(...)` *or* be batched. The `batch()` in ExternalWallet (lines 350-611 of `external-wallet.ts`) explicitly stages all phases in lockstep — Phase 0 (Check + early returns), Phase 1 (Create interactions), Phase 2 (Prepare), Phase 3 (Request authorization with all items in one dialog), Phase 4 (Execute approved). One user dialog per batch; if any item's prepare throws, only that item fails and the rest can proceed if approved.

---

## 7. Aztec patterns Grego uses (HEADLINE)

This is where the "Grego is the aztec.js author" angle pays off the most. The patterns I see here are subtle and not obviously documented elsewhere.

### 7a. "Kernel-less" via stub account contracts (the simulation trick)

The phrase "kernel-less" doesn't appear in this codebase at all — but the **technique** is here, just under a different name. It's "simulation via a stub account entrypoint that bypasses real account auth." The relevant code is `DemoWallet.buildAccountOverrides()` and `DemoWallet.simulateViaEntrypoint()`:

```ts
// shared/src/wallet/core/demo-wallet.ts:139-165
protected async buildAccountOverrides(scopes: AztecAddress[]): Promise<ContractOverrides> {
  const accounts = await this.db.listAccounts();
  const filtered = accounts.filter((acc) => scopes.some((addr) => addr.equals(acc.item)));
  for (const account of filtered) {
    const { type } = await this.db.retrieveAccount(account.item);
    const isEcdsa = type === "ecdsasecp256k1" || type === "ecdsasecp256r1";
    const artifact: ContractArtifact = isEcdsa
      ? StubEcdsaAccountContractArtifact
      : StubSchnorrAccountContractArtifact;
    const stubConstructorArgs =
      type === "schnorr" ? [Fr.ZERO, Fr.ZERO] : [Buffer.alloc(32), Buffer.alloc(32)];
    const instance = await getContractInstanceFromInstantiationParams(artifact, {
      salt: Fr.random(),
      constructorArgs: stubConstructorArgs,
    });
    contracts[account.item.toString()] = { instance, artifact };
  }
  return contracts;
}
```

```ts
// shared/src/wallet/core/demo-wallet.ts:172-226
protected override async simulateViaEntrypoint(executionPayload, opts) {
  // …
  const accountOverrides = await this.buildAccountOverrides(scopes);
  const overrides = new SimulationOverrides(accountOverrides);

  let txRequest;
  if (from === NO_FROM) {
    const entrypoint = new DefaultEntrypoint();
    txRequest = await entrypoint.createTxExecutionRequest(
      finalExecutionPayload, feeOptions.gasSettings, chainInfo,
    );
  } else {
    const { type } = await this.db.retrieveAccount(from);
    const originalAccount = await this.getAccountFromAddress(from);
    const completeAddress = originalAccount.getCompleteAddress();
    const isEcdsa = type === "ecdsasecp256k1" || type === "ecdsasecp256r1";
    const stubAccount = isEcdsa
      ? createStubEcdsaAccount(completeAddress)
      : createStubSchnorrAccount(completeAddress);
    txRequest = await stubAccount.createTxExecutionRequest(
      finalExecutionPayload, feeOptions.gasSettings, chainInfo, executionOptions);
  }
  const result = await this.pxe.simulateTx(txRequest, {
    simulatePublic: true, skipFeeEnforcement, skipTxValidation, overrides, scopes,
  });
}
```

The stubs are official Aztec exports (`@aztec/accounts/stub/schnorr` and `@aztec/accounts/stub/ecdsa`). Each "stub" account is a contract artifact whose entrypoint simply *accepts any signature* — it doesn't actually verify one. By:

1. Building a `ContractOverrides` map that swaps every in-scope account's contract for a stub at the same address (different contract class id),
2. Wrapping that as `SimulationOverrides`,
3. Calling `pxe.simulateTx(req, { overrides, ... })`,

the simulation runs *against the same on-chain state* but the entrypoint check is no-op'd. The wallet doesn't have to provide a real signature for simulation. That's what the upstream comment at `demo-wallet.ts:168-170` calls "bypass real account authorization" — and what the rest of the ecosystem informally calls "kernel-less simulation" (because the kernel circuit doesn't have to run with the real signing key). Real signatures only get produced in `prove`/`send`, after user approval.

This is a technique Nulo should adopt verbatim — **including the upstream stub artifacts**, not custom ones. That's what makes it work.

### 7b. `NO_FROM` for sender-less / unauthenticated execution

Imported from `@aztec/aztec.js/account` as a sentinel value. Used in three distinct ways:

1. **Account deployment** (`internal-wallet.ts:151-157`): the deployment tx itself can't be sent *from* the account being deployed (it doesn't exist yet on-chain). `from: NO_FROM` lets the wallet build a tx with a generic entrypoint:
   ```ts
   const opts: DeployAccountOptions = { from: NO_FROM, skipClassPublication: true, skipInstancePublication: true };
   const executionPayload = await deployMethod.request({ ...opts, deployer: AztecAddress.ZERO });
   ```
2. **Sender-less simulation** (`demo-wallet.ts:189-195`): `if (from === NO_FROM) { use new DefaultEntrypoint() ... }` — uses the protocol's `DefaultEntrypoint` (multi-call address) directly, no account contract involved at all. For utility-call simulation when the dApp doesn't care which account "signs."
3. **Persistent storage / display** (`simulate-tx-operation.ts:132`): `const simulationOrigin = opts.from === NO_FROM ? AztecAddress.ZERO : opts.from;` — when the simulation has no "from," the public-static optimisation path uses `AztecAddress.ZERO` as the origin.

This pattern is one of the most useful Aztec-specific things in the wallet, and it's encoded as a *type-level sentinel* via `NO_FROM` rather than a magic address. Nulo should mirror that.

### 7c. Public-static fast path via `simulateViaNode`

```ts
// shared/src/wallet/operations/simulate-tx-operation.ts:121-161
const { optimizableCalls, remainingCalls } =
  extractOptimizablePublicStaticCalls(executionPayload);

let blockHeader: BlockHeader;
try {
  blockHeader = await this.pxe.getSyncedBlockHeader();
} catch {
  blockHeader = (await this.node.getBlockHeader())!;
}

const [optimizedResults, normalResult] = await Promise.all([
  optimizableCalls.length > 0
    ? simulateViaNode(this.node, optimizableCalls, simulationOrigin, chainInfo, gasSettings,
                      blockHeader, opts.skipFeeEnforcement ?? true,
                      (a) => this.decodingCache.getAddressAlias(a))
    : Promise.resolve([]),
  remainingCalls.length > 0
    ? this.simulateViaEntrypoint({ ...executionPayload, calls: remainingCalls }, { ... })
    : Promise.resolve(null),
]);
const simulationResult = buildMergedSimulationResult(optimizedResults, normalResult);
```

The technique: any **public + static** call (read-only public function) can be simulated by the **node** directly — no PXE involvement, no kernel circuit, no account proof. `extractOptimizablePublicStaticCalls`, `simulateViaNode`, and `buildMergedSimulationResult` are all `@aztec/wallet-sdk/base-wallet` exports. The wallet partitions the calls, runs both halves in parallel, then merges. For dApps that mix a pure-public read with a private write (common in DeFi: read pool state, then submit private swap), this can shave seconds off simulation. Nulo should plumb this exact split.

A quiet detail: `pxe.getSyncedBlockHeader()` falls back to `node.getBlockHeader()` if PXE is not yet synced — so the public-static path can run before the private path's prerequisites are ready (line 127-130).

### 7d. Fee abstraction: `feePayer`, sponsored fees, embedded payment methods

The `executionPayload.feePayer` field is a stable Aztec-protocol concept (someone other than `from` can pay fees). The wallet propagates it through every layer (`hashExecutionPayload` includes `feePayer` in the hash at `simulation-utils.ts:45-47`; titles strip "fee/payment/sponsor_unconditionally" calls at line 95-101 to avoid noisy display). The `FeeOptions` used in `simulateViaEntrypoint` are built by `completeFeeOptions(...)`:

```ts
// shared/src/wallet/operations/simulate-tx-operation.ts:114-119
const feeOptions = await this.completeFeeOptions({
  from: opts.from,
  feePayer: executionPayload.feePayer,
  gasSettings: opts.fee?.gasSettings,
  forEstimation: true,
});
```

`completeFeeOptions` lives in `BaseWallet` (from `@aztec/wallet-sdk/base-wallet`). The wallet constructs **two flavors**: `forEstimation: true` (high gas limits to avoid OOG during estimation) and the final pass with estimated gas limits derived from `getGasLimits(simulationResult)`:

```ts
// shared/src/wallet/operations/send-tx-operation.ts:185-204
const feeOptions = await this.completeFeeOptions(opts.from, executionPayload.feePayer, opts.fee?.gasSettings);
const estimated = getGasLimits(prepared.executionData!.simulationResult);
const gasSettings = GasSettings.from({
  ...opts.fee?.gasSettings,
  maxFeesPerGas: feeOptions.gasSettings.maxFeesPerGas,
  maxPriorityFeesPerGas: feeOptions.gasSettings.maxPriorityFeesPerGas,
  gasLimits: opts.fee?.gasSettings?.gasLimits ?? estimated.gasLimits,
  teardownGasLimits: opts.fee?.gasSettings?.teardownGasLimits ?? estimated.teardownGasLimits,
});
```

User-provided gas overrides win; otherwise estimated values are used. There's a wallet-side `walletFeePaymentMethod` referenced at `demo-wallet.ts:179` that gets prepended to the execution payload (`mergeExecutionPayloads([feeExecutionPayload, executionPayload])`). I cannot see the implementation here — it's an SDK abstraction — but the wallet supports the upstream "wallet pays the fees" via that hook. The "embedded fee payer" (when the *dApp* passes its own `feePayer` in the payload) is detected and surfaced in the title:

```ts
// shared/src/wallet/utils/simulation-utils.ts:93-101
if (embeddedPaymentMethodFeePayer) {
  const callName = call.name?.toLowerCase() || "";
  if (callName.includes("fee") || callName.includes("payment") || callName.includes("sponsor_unconditionally")) {
    return false;
  }
}
```

There's also explicit support for **bridged FeeJuice** with an LMDB-backed stack (`pushBridgedFeeJuice` / `popBridgedFeeJuice` at `wallet-db.ts:77-123`). FeeJuice is the Aztec native fee token; bridging is an L1-claim flow. The stack design lets multiple in-flight claims queue up.

### 7e. AuthWit creation: when, where, by whom

Three separate authwit code paths:

1. **External, dApp-initiated `createAuthWit`** (`shared/src/wallet/operations/create-authwit-operation.ts`): explicit user dialog every time, never persisted ("each authwit requires separate approval" comment at line 47-48). Decodes the `CallIntent` for display (caller, contract, function, args) — this is what the user sees.
2. **Internal, send-tx-flow authwits** (`shared/src/wallet/operations/send-tx-operation.ts:171-181`): when the *transaction* is approved, the wallet automatically creates authwits for each `callAuthorizations` in the simulation result, *without* a separate dialog (CLAUDE.MD: "Internal auth witness for call authorizations → no dialog (tx already approved)"). This is the right call — the user already saw the calls in the simulation trace; re-asking would be friction.
3. **Internal, deploy-account flow** (`shared/src/wallet/core/internal-wallet.ts:182-199`): same pattern but applied to off-chain effects collected from a deploy simulation, calling `CallAuthorizationRequest.fromFields(effect.data)` and creating authwits per request. Used to bootstrap an account that has registered some pre-deploy auth requirements.

The signing happens in the account contract's `createAuthWit` method (`shared/src/wallet/core/external-wallet.ts:175-181` for the external case → delegates to `account.createAuthWit(messageHashOrIntent, this.chainInfo)`).

### 7f. Simulation vs proof split

Hard split:

- **Simulation = prepare phase**, runs in `simulateViaEntrypoint` with stubs, returns `TxSimulationResultWithAppOffset` (custom subclass that tracks where the user's app code starts in the call stack — useful for filtering wallet-added calls in trace display).
- **Proving = execute phase**, runs in `pxe.proveTx(txRequest, scopes)` (`send-tx-operation.ts:271-273`). Real account, real signing key, real kernel.
- **Sending = `aztecNode.sendTx(tx)`**.
- **Mining wait = `waitForTx(aztecNode, txHash, { waitForStatus: TxStatus.PROPOSED })`**.

When proving fails, the wallet **automatically generates profile data** (`pxe.profileTx(...)` with `profileMode: "execution-steps", skipProofGeneration: true`) and emits a `proof-debug-export-request` event so the UI can offer the user a `.msgpack` export (`send-tx-operation.ts:281-307`). This is a dev-experience win that's worth porting.

Each phase reports progress through `emitProgress("PROVING")`, `emitProgress("SENDING", txHash)`, `emitProgress("MINING")`, `emitProgress("SENT")` (via the interaction manager → wallet-update event → renderer). The renderer can show a real-time progress badge per interaction.

### 7g. First-tx initialization wrapping

I can't find an explicit "ctor + app multi-call entrypoint trick" in this codebase — but there is the **deploy + first-tx-from-deployed-account** flow:

```ts
// shared/src/wallet/core/internal-wallet.ts:131-216 (excerpted)
async deployAccount(address: AztecAddress): Promise<void> {
  const { secretKey, salt, signingKey, type } = await this.db.retrieveAccount(address);
  const accountManager = await this.getAccountManager(type, secretKey, salt, signingKey);
  const deployMethod = await accountManager.getDeployMethod();
  const opts: DeployAccountOptions = {
    from: NO_FROM,
    skipClassPublication: true,
    skipInstancePublication: true,
  };
  const executionPayload = await deployMethod.request({ ...opts, deployer: AztecAddress.ZERO });
  // …simulate, build authwits from offchainEffects, estimate gas…
  await this.sendTx(executionPayload, sendOptions, interaction);
  await this.db.markAccountDeployed(address);
}
```

`AccountManager.getDeployMethod()` returns the deployment intent. The wallet uses `from: NO_FROM` (no signing required for deploy) + `skipClassPublication: true` + `skipInstancePublication: true` — those flags tell the SDK *not* to publish a separate class/instance setup tx, because the account contract's first call already does it implicitly. The deploy is then sent through the same `sendTx` codepath as any other tx.

The "ctor + app multi-call wrapping" Nulo's CLAUDE.md describes (`MULTI_CALL_ENTRYPOINT_ADDRESS` chunking, recursive >5-call splits) is **not present** in Grego's wallet. The reason is that this wallet always uses the upstream `DefaultEntrypoint` / `DefaultMultiCallEntrypoint` directly when needed, and the SDK handles the wrapping internally. Nulo's situation is different because Nulo uses the canonical `@aztec/accounts/schnorr` adapter and explicitly orchestrates the multi-call path itself. The patterns aren't directly portable.

### 7h. Note discovery, syncing, registerAccount/registerSender

`registerSender` at the PXE level happens in two places:

- `shared/src/wallet/core/demo-wallet.ts:232-243` — `getAddressBookInternal()` reconciles `db.listSenders()` with `pxe.getSenders()`, calling `pxe.registerSender(...)` for any DB sender PXE doesn't yet know about. This is run on every `getAddressBook` call so the PXE state stays in sync.
- `shared/src/wallet/operations/register-sender-operation.ts:114` — explicit user-initiated registration.

`registerAccount` happens in `register-contract-operation.ts:200`:

```ts
if (secretKey) {
  await this.pxe.registerAccount(secretKey, await computePartialAddress(instance));
}
```

Triggered when registering a contract that is itself an account (passes the secretKey + the partial address derived from the instance). That's how external dApps can register *new* accounts the wallet didn't create.

Note discovery / syncing — there is **no explicit `syncNotes` call** in this codebase. PXE's note synchronization happens automatically as part of `pxe.simulateTx`, `pxe.proveTx`, etc. The wallet doesn't have to drive it manually. There's also `pxe.getSyncedBlockHeader()` (used in the simulation fast-path) which exposes the current sync point.

### 7i. Pre-computation tricks

The big one: `AccountManager.create(this, secret, contract, salt)` followed by `getInstance()` — this uses `salt` as the deterministic instantiation salt for the address. The wallet stores `salt` per-account in LMDB (`wallet-db.ts:146`) so the same `(secret, salt)` pair always derives the same address. This is the same idea Nulo's `Fr.ZERO` salt does, but here the salt is per-account (not pinned to zero), letting one secret instantiate multiple addresses.

The DecodingCache (`shared/src/wallet/decoding/decoding-cache.ts`) is another pre-computation pattern worth highlighting: three caches (instance, artifact, address alias) with the explicit rule "only cache successfully resolved data, never fallback values" (CLAUDE.MD Design Principle #2). When `getAddressAlias(address)` is called repeatedly on the same address, it doesn't keep falling through to the `0x123...` shortened-address fallback — it caches that *no* alias was found and returns the fallback once.

---

## 8. Wallet worker

Lives at `app/src/workers/wallet-worker.ts`. Spawned via Electron's `utilityProcess.fork()` (`app/src/main.ts:313-315`) — that's a Node-runtime worker with `nodeIntegration: false` semantics (no DOM, no `chrome.*`). Lifetime: spawned at app `ready`, killed in `app.on("will-quit")` (line 327). On unexpected exit:

```ts
// app/src/main.ts:319-322
wallet.on("exit", () => {
  console.error("wallet process died");
  process.exit(1);
});
```

That's the entirety of the crash policy: **the main process kills itself if the worker dies**. There's no automatic restart. That's deliberate — restarting wouldn't recover any of the in-memory PXE state, so might as well take the whole app down and let the user relaunch. The unhandled-rejection / uncaught-exception handlers inside the worker (`wallet-worker.ts:258-274`) just log; they don't try to recover.

Memory ceiling: not configured. The data store map size is `2e10` KB = ~20 GB (`wallet-worker.ts:99`, repeated for the wallet DB at line 115). That's an LMDB virtual-memory map allocation, not actual RAM. For the JS process itself the only ceiling is Node's default `max-old-space-size`.

The worker is **single-threaded** for everything PXE-related. The pino logger is created via `createProxyLogger` (`app/src/utils/logger.ts`) which posts log events back to the main process over `walletLogPort` so logs end up in `~/keychain/aztec-keychain-debug.log` regardless of which process produces them. There's an environmental hack to satisfy pino's transport detection:

```ts
// app/vite.main.config.ts:78-91
"process.env": JSON.stringify({
  JEST_WORKER_ID: "1",  // make pino think we're in jest, force sync transport
  LOG_LEVEL: "verbose",
  // … paths …
}),
```

This is the kind of detail that's only obvious if you've shipped Electron + pino before.

---

## 9. State / storage

LMDB everywhere on the Electron side. The browser (extension-wallet, web) uses IndexedDB for both PXE and the wallet DB. `WalletDB.init` opens six maps:

```ts
// shared/src/wallet/database/wallet-db.ts:60-65
const accounts = store.openMap<string, Buffer>("accounts");
const aliases = store.openMap<string, Buffer>("aliases");
const bridgedFeeJuice = store.openMap<string, Buffer>("bridgedFeeJuice");
const interactions = store.openMap<string, Buffer>("interactions");
const authorizations = store.openMap<string, Buffer>("authorizations");
const txPayloadData = store.openMap<string, string>("txPayloadData");
```

PXE has its own LMDB at `~/keychain/pxe-${rollupAddress}` with note sync data, contract artifacts, encrypted notes per account.

Key encoding patterns:

- Accounts: `${address}:sk`, `${address}:salt`, `${address}:type`, `${address}:signingKey`, `${address}:deployed`. Multi-key ID rather than serializing the whole account.
- Aliases: `accounts:${alias}` and `senders:${alias}` map to addresses (so listing requires a prefix scan).
- Authorizations: `${appId}:${storageKey}` (line 295). Capability storage keys per type encoded per CLAUDE.MD §"Capability Types".

**Migrations**: there's a `2` argument to `createStore(..., 2, ...)` in both `wallet-worker.ts:95` and `session.ts:93` — that's the schema version. I did not find migration code in this tree, only the version pin. That's a known weak spot.

**Backups**: none built in. The Electron wallet is keyed by the OS user's `~/keychain/` directory. The browser flavors use IndexedDB and rely on the cookie-sync code in `web/src/wallet/sync-cookies.ts:184-228` (compress + AES-GCM-with-PBKDF2-key + base64 + chunked across numbered cookies) for transport between browsers / origins. That's a *web*-specific feature and cleverly avoids the cookie size limit.

---

## 10. UI

### Electron renderer

Pure React (`@vitejs/plugin-react-swc`) with `@emotion/react` and `@mui/material` (`web/package.json` lines 28-37). The renderer is the same for the Electron app and the standalone web wallet: `shared/src/ui/App.tsx` is the master component, `StandaloneShell.tsx` (`shared/src/ui/StandaloneShell.tsx`) wraps it for the embed and `expanded` cases. The renderer:

- Doesn't import any Aztec types directly except for *protocol primitives* (`AztecAddress`, `Fr`, etc.) and the `WalletInteraction` event type.
- Talks to the wallet through `walletAPI.*` injected via `contextBridge.exposeInMainWorld(...)` in the preload (`app/src/ipc/preload.ts:7`).
- Receives wallet events via `walletAPI.onWalletUpdate(cb)`, `walletAPI.onAuthorizationRequest(cb)`, `walletAPI.onProofDebugExportRequest(cb)`.

The authorization UI (`AuthorizeCapabilitiesContent.tsx`, `AppAuthorizationCard.tsx`, `AuthorizeSendTxContent.tsx`, `AuthorizeSimulateTxContent.tsx` per CLAUDE.MD §UI) is reused across all flavors. Each surface for a capability type has indeterminate-state checkboxes and 500 ms-debounced auto-save — no apply button, the persistence happens as the user types.

### Vite configs (four of them, here's why)

- `vite.main.config.ts` — Electron main process. Builds `src/main.ts` for Node runtime. Defines `process.env` at compile time so embedded paths work in both dev and packaged modes.
- `vite.preload.config.ts` — Electron preload. Empty `defineConfig({})` because preload runs in a sandboxed renderer context and Vite's defaults are correct.
- `vite.worker.config.ts` — wallet worker. **Externalizes `@aztec/kv-store/lmdb-v2` and `@aztec/bb.js`** because Electron's ASAR packing can't handle their native components — they're copied raw via the Forge `packageAfterCopy` hook (`forge.config.ts:44-90`).
- `vite.renderer.config.ts` — Electron renderer. SWC + emotion JSX, plus a `vite-plugin-node-polyfills` patch (`nodePolyfillsFix`) to fix a path-resolution bug in the polyfill plugin.

The reason for four configs: the four contexts (main / preload / worker / renderer) have *different* runtime constraints and Vite has to be told about each independently. Forge's `VitePlugin` wires them up by calling each per-target.

### Extension renderers

Both extension flavors are React via `@wxt-dev/module-react`. The relay extension's popup is `extension/entrypoints/popup/App.tsx` (~600 lines, manages discovery approvals + active sessions + remembered apps). The self-contained extension has *four* React entrypoints (popup, expanded, approval, onboarding), each with its own HTML and main.tsx. The expanded view *reuses* `StandaloneShell` from the shared package — same UI, different host.

---

## 11. Build tooling

- **Yarn 4 workspaces** (`package.json:5-11`) — `app`, `web`, `shared`, `extension-wallet`. The relay `extension/` is intentionally **not** a workspace member (it has its own `yarn.lock`) because it ships independently and depends on `@aztec/wallet-sdk` as a normal npm package. Same for `extension-wallet/` — this README claims it's a workspace member but it has its own `wxt.config.ts` and isolated install. (The repo's own `package.json` lists `extension-wallet` as a workspace, but `extension` is not — that asymmetry is deliberate.)
- **Turbo** as the monorepo task runner. Tasks: `build` (depends on `^build`), `lint`, `test`, `typecheck`, `dev` (persistent, no cache). Outputs cached to `dist/**` and `out/**`. `turbo.json:1-23`.
- **Electron Forge** with `VitePlugin` + `AutoUnpackNativesPlugin` + `FusesPlugin`. Fuses include `EnableCookieEncryption: true`, `EnableNodeCliInspectArguments: false`, `OnlyLoadAppFromAsar: true` (`forge.config.ts:125-133`). Production hardening that Nulo doesn't currently have (it's a browser extension).
- **WXT** for both extensions. Auto-generates manifests, runs an isolated Chrome profile in dev, supports Firefox out of the box (extension-wallet falls back to a hidden minimized window for offscreen on Firefox — see `extension-wallet/src/background/offscreen-lifecycle.ts:67-85`).
- **ESLint + Prettier** at the root (`eslint.config.js`, `.prettierrc`-equivalent). Standard.
- **vitest** for shared/web/extension-wallet. The `extension/` flavor uses `tsc --noEmit` only.
- **Native host build**: a separate `yarn build:native-host` script (run from `app/`). The output binary is platform-specific (`darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64`) and copied to `app/dist/native-host/${platform}-${arch}/`.

---

## 12. What Nulo should steal — be specific

In rough priority order:

1. **Stub-account simulation overrides for "kernel-less" simulation.** Adopt the `ContractOverrides` + `SimulationOverrides` pattern from `shared/src/wallet/core/demo-wallet.ts:139-226`. Use the upstream `@aztec/accounts/stub/schnorr` and `@aztec/accounts/stub/ecdsa` artifacts. Replace any custom signing-during-simulation with stub accounts + `pxe.simulateTx(req, { overrides, scopes, simulatePublic: true, skipFeeEnforcement, skipTxValidation })`. This eliminates the need to either (a) ask the user for password during simulation or (b) cache the unlocked signing key in memory longer than necessary.

2. **`NO_FROM` sentinel for sender-less calls.** Import from `@aztec/aztec.js/account` and use it for: account deployments, utility-function simulation, and any "show me what this would do" UI flow. Pair with `if (from === NO_FROM) { use new DefaultEntrypoint() ... }` so the simulation doesn't need a from-address at all (`demo-wallet.ts:189-195`).

3. **Public-static fast path.** `extractOptimizablePublicStaticCalls` + `simulateViaNode` from `@aztec/wallet-sdk/base-wallet`. Run in parallel with the private path (`Promise.all`), merge with `buildMergedSimulationResult`. Massive speedup for read-heavy dApps (`simulate-tx-operation.ts:121-164`).

4. **One PXE per chainId-version, ever.** Don't accidentally instantiate two by, e.g., creating one in the SW and another in the offscreen. Pin the singleton with a Promise so concurrent first-callers await the same init. Key the PXE store by `rollupAddress` rather than `chainId` so rollup upgrades don't collide.

5. **Capability manifests with progressive wildcard matching.** The `AuthorizationManager` design (`shared/src/wallet/managers/authorization-manager.ts:218-256`) is far better than ad-hoc per-call approvals. Storage keys like `simulateTx:0x123:swap` matched against `simulateTx:0x123:*` and `simulateTx:*` are cheap to evaluate and cleanly map to UI checkboxes. Combined with strict / permissive mode and per-app duration, it handles 90% of the real-world dApp permission shapes. The `__requested__` key tracking (line 199-216) is the right move for the Apps tab UI even if the user denied something.

6. **The 4-phase `ExternalOperation` pattern.** `check → createInteraction → prepare → requestAuthorization → execute` with unified error handling and `setCurrentInteraction` for progress reporting. The cost is 100 lines of base-class plumbing; the payoff is that every operation (15+ in the codebase) has the same structure, can be batched, can early-return from check, and can emit progress without per-operation boilerplate. Nulo's existing operation surface is somewhat ad-hoc; this would normalize it.

7. **Batch with all-items-in-one-dialog.** `external-wallet.ts:350-611` runs all 4 phases in lockstep across a batch, building a single `AuthorizationItem[]` for the dialog. One user click resolves N operations. This is the pattern dApps need for "approve + swap" type flows where two or more authorizations are conceptually one decision.

8. **Pending authorizations as a per-session shared `Map<requestId, {promise, request}>`.** `wallet-worker.ts:122-128`. Both internal and external wallets see the same map; whoever resolves first wins. Combined with the `appId === "this"` recovery trick (`wallet-worker.ts:323-340`), this lets the wallet UI act on behalf of the dApp without duplicating the resolution path.

9. **Per-app-per-network "remembered apps" auto-approve.** `extension/entrypoints/background.ts:11-122`. Don't trust `(appId, origin)` alone — bind to `(appId, origin, chainId, version)`. Otherwise an app remembered on testnet auto-approves on mainnet, which is exactly the kind of bug that would haunt you forever.

10. **Auto-generate proof-debug data on proving failure.** `send-tx-operation.ts:281-307`. `pxe.profileTx(req, { profileMode: "execution-steps", skipProofGeneration: true })` → serialize → base64 → emit event → UI offers `.msgpack` save. Free dev-experience win.

11. **DecodingCache rule "only cache resolved data, never fallback."** `shared/src/wallet/decoding/decoding-cache.ts`. If you cache the shortened-address fallback, you'll never resolve the real name later. Trust the cache only for hits; let misses re-resolve.

12. **`ChunkReassembler` for native-messaging-style chunked frames.** Even if Nulo doesn't go to native messaging, the chunking is cheap to implement (`extension/utils/chunk_reassembler.ts:73-114`) and useful any time you have a 1 MB-ish frame cap on a transport. SW ↔ offscreen via `chrome.runtime.sendMessage` has limits too; this generalizes.

13. **`ChainInfoSchema = z.object({chainId: schemas.Fr, version: schemas.Fr})`** + JSON-revival shim on every IPC boundary. `wallet-worker.ts:34-37` for the schema; `extension-wallet/src/offscreen/wallet-host.ts:37-46` for the revival. Aztec primitives don't survive JSON round-trips by default (Fr → hex string), and forgetting to revive them at the right boundary is the kind of bug that takes hours to find.

---

## 13. Trade-offs of the Electron-host approach vs Nulo's offscreen-host approach

### What's gained

- **Real Node.js runtime.** No `nodePolyfills` workaround for `Buffer`/`process`/`global`. No CSP gymnastics to allow `wasm-unsafe-eval` (Nulo and `extension-wallet` both pay this tax). Direct access to LMDB via `@aztec/kv-store/lmdb-v2`, which is way faster and more durable than IndexedDB.
- **No service-worker lifecycle pain.** SWs go to sleep; offscreen documents close on idle; persistent connection ports help but don't eliminate. The Electron worker stays up for the app's lifetime. Long-running operations (a 30-second proof) are not at risk of the worker context being torn down mid-operation.
- **Native prover.** `BackendType.NativeUnixSocket` + the `bb` binary (`wallet-worker.ts:103-105`) — faster than WASM. Tens of percent on simulation, much more on proving.
- **Multi-origin isolation by appId at the protocol level.** Sessions are keyed by `chainId-version`, wallets by `appId`. The same Electron app handles multiple dApps simultaneously without sharing PXE state per-app or per-origin (other than the deliberately shared L1 state).
- **Cookie/IndexedDB independence.** The wallet's data is in `~/keychain/`, not in any browser profile. Browser reset / extension reinstall doesn't delete keys.
- **Production hardening via Electron fuses.** `EnableCookieEncryption`, `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`, etc. (`forge.config.ts:125-133`). Browser extensions don't have these knobs.

### What's lost

- **Install friction.** The user has to download and run an installer (or `.app`/`.exe`/`.deb`/`.rpm`). Then install the browser extension. Then deal with native-messaging manifest setup *if* it's a dev build (the manual `sudo` step from the README) or auto-install at first launch in production (which itself needs a code-signed app on macOS). Compare to "click 'Add to Chrome' → done" for the offscreen flavor.
- **Update path.** Two updates to coordinate (extension + app), with a version-skew window in between.
- **Cross-OS surface.** Each new platform is a port. The `native-host/index.ts` already handles the macOS / Linux / Windows split (Unix sockets vs named pipes), but every binary needs to be cross-built and code-signed.
- **No mobile.** Electron doesn't run on iOS / Android. The browser-extension flavor at least *could* run in mobile browsers (Firefox Android, Edge Android, Kiwi).
- **More moving parts.** Six hops vs Nulo's "SW ↔ offscreen ↔ PXE." More logs to read when something breaks. The native-host log + the Electron debug log + the extension's SW console + the dApp's console.
- **Memory footprint.** Electron + Chrome + wallet-worker is at minimum 250–400 MB resident. A pure-extension wallet is ≤ 50 MB.
- **More privileged attack surface.** Anything in the wallet-worker can read `~/keychain/`; anything in the main process can spawn the worker. The browser-extension model is sandboxed by the browser more aggressively (though both have the "can read shared session data" property).

### Could Nulo move to Electron without rewriting everything?

The shape of `shared/` in Grego's repo is the answer: **yes, if the wallet logic is host-agnostic to begin with**. Specifically:

- `ExternalWallet` / `InternalWallet` / `WalletDB` / `AuthorizationManager` / all `*-operation.ts` files have **zero `chrome.*` references and zero `electron.*` references**. That is the prerequisite. They depend only on `@aztec/pxe/server` (Electron) or `@aztec/pxe/client/lazy` (browser) — chosen by the host wrapper.
- Each host has a thin entrypoint: `app/src/workers/wallet-worker.ts` for Electron (165 lines including the message dispatch); `extension-wallet/src/offscreen/wallet-host.ts` for browser (240 lines including handler registration); `web/src/wallet/wallet-service.ts` for web. Each builds the same `ExternalWallet` / `InternalWallet` from the same shared resources, with host-specific PXE creation + transport.

The cost for Nulo to add an Electron flavor would be:

- **2-3 weeks**: Native host binary, IPC server in main, MessagePortMain plumbing, Electron Forge setup, native-messaging manifest installer.
- **1-2 weeks**: Refactoring Nulo's currently chrome.*-bound services into the layer hierarchy you already have (wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension). The discipline is already most of the way there per Nulo's CLAUDE.md.
- **1 week**: Cross-platform packaging + signing.

The biggest single porting cost is **whatever currently uses `chrome.runtime` / `chrome.storage` / `chrome.offscreen`** — those calls have to be replaced by transport-injected interfaces (Grego's pattern: pass `sendToTab` / `addContentListener` / `postMessage` callbacks into the SDK instead of calling `browser.runtime.*` inline). If Nulo's M6 layer model is already enforcing that boundary, this is almost free; if not, it's measurable but bounded refactoring.

The case *against* moving: install friction, mobile lockout, distribution overhead. Unless Nulo specifically wants the LMDB / native-prover / always-on benefits, the offscreen approach gets you 80% of the gains for 20% of the integration cost.

The case *for*: if Aztec's prover takes >10 seconds in WASM and ~2 seconds with `bb` native, and your users notice, the Electron path is the only way to close that gap. Grego clearly bet on this.
