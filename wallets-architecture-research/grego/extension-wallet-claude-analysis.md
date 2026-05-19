# Grego's `extension-wallet` — Architecture Deep-Dive (for Nulo comparison)

**Subject:** `(Grego source tree)/extension-wallet/`
**Author of code under review:** Grego (author of `aztec.js`)
**Comparison target:** Nulo Wallet (`(project root)`)
**Sibling packages out of scope:** `app/`, `web/`, `extension/` (Electron flavour) — explicitly **not** analysed here.

This package is a self-contained MV3 Aztec wallet built on **WXT + React + MUI**, modelled on MetaMask. The repo positions it as the apples-to-apples comparator for Nulo. Surprisingly small at 28 source files: most heavy Aztec lifting lives in the sibling workspace `@demo-wallet/shared` — `extension-wallet/` is essentially a **transport host** that brings up the shared session manager inside an MV3 offscreen and exposes it over a typed RPC port.

Structurally this is a different design choice from Nulo:

| Concern | Grego (`extension-wallet/`) | Nulo |
| --- | --- | --- |
| Aztec runtime location | offscreen (one PXE per chain) | offscreen (`@nulo/aztec-runtime`) |
| Wallet logic location | `shared/` workspace (`InternalWallet`/`ExternalWallet`) | service worker services (`@nulo/extension`) |
| RPC plumbing | one Zod-typed `chrome.runtime.Port` (offscreen-side `PortServer`) | many `Service` / `ServiceClient` channels (`@nulo/extension-messaging`) |
| Vault | `VaultState` in offscreen, AES-GCM probe-only, KDF in offscreen | `wallet-crypto` (PasswordSecretBox) in SW |
| At-rest secrets | **plaintext in IndexedDB** (`shared/.../wallet-db.ts:145`) | encrypted via PasswordSecretBox |
| Session keying | `${chainId}-${version}` per-network, one PXE shared per session | per-network PXE in offscreen (M-series) |
| dApp wire | `@aztec/wallet-sdk/extension/handlers` (BackgroundConnectionHandler) | `@nulo/wallet-bridge` dispatcher |
| Build | WXT + Vite (yarn 4) | Vite + Bun workspaces |

Below: top-to-bottom walk-through, plus a headline "Aztec patterns" section since that's where Grego's authorship adds the most value.

---

## 1. Manifest & entry points

### Manifest (MV3)

`(Grego source tree)/extension-wallet/wxt.config.ts:45-75` declares:

- `permissions`: `storage`, `alarms`, `offscreen`, `webNavigation`. Notable: **no** `tabs` permission — `chrome.tabs.create()` works without it for extension-owned URLs, and `tabs.sendMessage` is allowed for known message routes.
- `host_permissions`: `*://*/*` so the content script's relay listeners can attach to any dApp origin.
- `content_security_policy.extension_pages`: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`. **Only `wasm-unsafe-eval`**, not `unsafe-eval`. This is the strict MV3 CSP — Grego works around the `function-bind` issue (see §9) instead of weakening it.
- `web_accessible_resources`: `approval.html`, `expanded.html`, `onboarding.html` are exposed to all pages so the SW can `chrome.windows.create` them. `popup.html` doesn't need to be there (it's the action popup).
- `key`: a fixed RSA pubkey baked into the manifest so the Chromium extension ID is stable across rebuilds. Comment says it was generated with `openssl genrsa 2048 | openssl rsa -pubout -outform DER | base64`.
- `browser_specific_settings.gecko.id`: explicit Firefox extension ID since Firefox doesn't derive it from the key field.

### Entry points (7 total)

| Entry | File | Purpose |
| --- | --- | --- |
| Service worker | `entrypoints/background.ts` | Router only. No wallet state, no PXE. |
| Content script | `entrypoints/content.ts` | 22 lines. Pure relay using `ContentScriptConnectionHandler` from `@aztec/wallet-sdk`. |
| Offscreen | `entrypoints/offscreen/main.ts` | Boots `WalletHost`. Hosts PXE + WalletDB + VaultState. |
| Popup | `entrypoints/popup/main.tsx` + `Popup.tsx` | 380px MUI surface: lock screen, discovery approval, emoji verification, status. |
| Approval window | `entrypoints/approval/main.tsx` | Per-request authorization dialog. Reuses `AuthorizationDialog` from `@demo-wallet/shared/ui`. |
| Expanded view | `entrypoints/expanded/main.tsx` | Full-screen UI. Re-uses `StandaloneShell` from shared. |
| Onboarding | `entrypoints/onboarding/Onboarding.tsx` | First-install wizard. Three-step: welcome → password → done. |

The popup is **deliberately tiny** (`Popup.tsx` is the only popup feature surface). Anything beyond lock/unlock/discovery/verify is delegated to the expanded view — same MetaMask split.

---

## 2. Service worker as router

`entrypoints/background.ts` (244 lines) is the entire SW. It holds **no wallet state** — only:

- a single `PortClient` ref that lazily connects to the offscreen (`background.ts:19,22-37`)
- a `pendingDappCount` counter for the auto-lock guard (`background.ts:20`)
- a closure over the wallet-sdk's `BackgroundConnectionHandler` (`background.ts:50`)

### `BackgroundConnectionHandler` — the dApp wire

`background.ts:50-149` constructs `new BackgroundConnectionHandler({ walletId, walletName, walletVersion }, transport, callbacks)`. The transport is a thin shim:

```ts
{
  sendToTab: (tabId, message) => browser.tabs.sendMessage(tabId, message),
  addContentListener: (handler) => browser.runtime.onMessage.addListener(handler),
}
```

Three callbacks:

1. **`onPendingDiscovery`** (`background.ts:57-67`): a dApp asked to connect. If `isAppRemembered(appId, origin, chainId, version)` matches a saved entry, auto-approve via `sessionHandler.approveDiscovery`. Otherwise pop the toolbar UI. **No wallet unlock check** at this stage — discovery is metadata-only.
2. **`onSessionEstablished`** (`background.ts:68-70`): post-handshake. Open the popup so the user can verify emoji.
3. **`onWalletMessage`** (`background.ts:71-148`): a dApp method call (`simulateTx`, `sendTx`, …) arrived. This is the meatiest path — see below.

### The dApp message path

```
dApp window
  ↓  postMessage / window.dispatchEvent (managed by ContentScriptConnectionHandler)
content script (entrypoints/content.ts)
  ↓  browser.runtime.sendMessage
SW: BackgroundConnectionHandler.onWalletMessage
  ↓  vault check → portClient.call("dapp.<methodName>", [session, message])
offscreen: WalletHost dispatches to dapp.<methodName> handler
  ↓  routes to ExternalWallet.<methodName>
PXE / WalletDB / authorization machinery (shared/)
  ↓  result
back through PortClient → sessionHandler.sendResponse → content → dApp
```

`background.ts:71-147` codifies four important policies in one block:

1. **Onboarding gate**: `if (!(await hasVaultMeta())) return error("Wallet not yet initialized — complete onboarding first")` (`background.ts:79-87`). Cleanly denies rather than half-handling.
2. **Locked-state UX nudge**: `if (!isUnlocked) chrome.action.openPopup().catch(() => chrome.windows.create(popup.html?reason=unlock-for-request))` (`background.ts:97-110`). Note: the dApp call **still proceeds**; the offscreen will reject it with `Error("Vault is locked")` (see `wallet-host.ts:209-211`). The popup is purely an unlock prompt; the dApp gets a clean error if the user doesn't unlock in time. Avoids a hang.
3. **Keep-alive ref-counting** (`background.ts:91-92, 144-146`): `acquireKeepAlive()` opens a port to the offscreen named `keep-alive` so the offscreen doesn't get terminated mid-call. Released in `finally`. The offscreen tracks the keep-alive port count separately from the data port set, so the Chrome's offscreen idle timer doesn't fire while a request is in flight.
4. **Activity bumping**: `bumpActivity()` resets the auto-lock alarm on every dApp message.

### Multiplexed `chrome.runtime.onMessage`

`background.ts:168-238` is a small switch over `msg.type` for SW-only requests from the popup:

- `ensure-offscreen` → bring the offscreen up (popup-side `PortClient` calls this before connecting)
- `offscreen-ready` → offscreen's boot signal (resolves the ready-gate; see §3)
- `get-pending-discoveries` / `approve-discovery` / `reject-discovery` / `get-active-sessions` — pure read-throughs to `sessionHandler.getPendingDiscoveries()` etc.

Notice this multiplex is **separate** from the `chrome.runtime.Port` traffic. Discovery state is held in-memory by `BackgroundConnectionHandler` (SW), while wallet state is in the offscreen — keeping the SW responsive without a port round-trip for discovery UI.

### `onAutoLockFired` (`background.ts:152-160`)

Auto-lock fires after the alarm. Two short-circuits:

- if `isApprovalWindowOpen()` or `pendingDappCount > 0`, **bump activity** and return — never lock during a flight or while the user's mid-approval.
- otherwise call `vault.lock` over the port.

---

## 3. Offscreen as the wallet host

`entrypoints/offscreen/main.ts` is 14 lines: instantiate `WalletHost`, start it, send `{ type: "offscreen-ready" }`. The "ready" message resolves a gate the SW awaits before letting UI surfaces connect (otherwise the popup's port arrives before the offscreen's `onConnect` listener is wired and immediately disconnects).

### `WalletHost`

`(Grego source tree)/extension-wallet/src/offscreen/wallet-host.ts:56-238`. Single class. Holds:

- `private vault = new VaultState()` — the lock state machine (§5).
- `private server: PortServer` — the port-side dispatch table.
- `private currentChainInfo: ChainInfo` — defaults to `{ chainId: 31337, version: 0 }` (localhost). Mutable; UI sets it via `network.set`.

The constructor builds a single `MethodHandlerMap` and registers it with `PortServer`. **No PXE is created here** — PXE creation is delegated to `getOrCreateSession()` from `@demo-wallet/shared/core` and is lazy: first dApp call (or first internal wallet method requiring a PXE) triggers it, then a per-(chainId, version) PXE is reused for the lifetime of the session (see `shared/src/wallet/session/session.ts:140-243`).

`vault.onChange` rebroadcasts lock state changes to all UI surfaces:

```ts
this.vault.onChange((state) => {
  if (state === "locked") this.server.broadcast("vault-locked", null);
  else this.server.broadcast("vault-unlocked", null);
});
```

This is how the popup and expanded surface observe lock state — they subscribe via `client.onBroadcast("vault-locked", ...)`.

### Offscreen lifecycle

`(Grego source tree)/extension-wallet/src/background/offscreen-lifecycle.ts:35-85` — `ensureOffscreen()`:

1. If `chrome.offscreen` exists (Chromium): `chrome.offscreen.hasDocument()`; if not, `createDocument({ reasons: ["DOM_PARSER"], justification: "Host wallet runtime (PXE, WalletDB, vault)" })`. Note the `DOM_PARSER` reason is a stand-in — Aztec doesn't actually parse DOM, but offscreen requires *some* approved reason.
2. **Firefox fallback**: `chrome.windows.create({ url, state: "minimized", focused: false })` (`offscreen-lifecycle.ts:73-79`). A persistent hidden window is the closest analogue Firefox offers since `chrome.offscreen` doesn't exist there. The window ID is cached in `firefoxOffscreenWindowId` and reused across calls.

The `ready-gate` (`offscreen-lifecycle.ts:18-33`) is critical:

```ts
// `chrome.offscreen.createDocument` resolves when the document is created,
// not after its scripts have run.
let readyPromise: Promise<void> | null = null;
let readyResolver: (() => void) | null = null;

function resetReadyGate() {
  readyPromise = new Promise((resolve) => { readyResolver = resolve; });
}

export function markOffscreenReady() {
  readyResolver?.();
  readyResolver = null;
}
```

`createDocument` resolves before the doc's scripts have run — without the ready-gate, the SW could return from `ensureOffscreen()` before `WalletHost.start()` has registered its `onConnect` listener. Pulled from a real bug. Each spawn cycle gets a fresh promise; the offscreen sends `{ type: "offscreen-ready" }` from `entrypoints/offscreen/main.ts:11`, the SW's `onMessage` handler routes that to `markOffscreenReady()` (`background.ts:177-181`).

### Keep-alive ports

`offscreen-lifecycle.ts:87-102` — ref-counted `acquireKeepAlive`/`releaseKeepAlive`. When count flips 0→1, opens a `chrome.runtime.connect({ name: KEEP_ALIVE_PORT_NAME })` port from the SW to the offscreen. When 1→0, disconnects it. The offscreen-side `PortServer` doesn't actually listen for that port name (`OFFSCREEN_PORT_NAME = "offscreen-wallet"` is the data port; `KEEP_ALIVE_PORT_NAME = "keep-alive"`), but Chrome's offscreen idle-shutdown logic counts any active runtime port as activity, so just opening it is enough.

---

## 4. Port-based RPC

The whole UI ↔ offscreen channel is **one** `chrome.runtime.Port`, multiplexed by method name. Three message kinds total.

### Envelope schema (Zod)

`(Grego source tree)/extension-wallet/src/ipc/port-envelope.ts:3-50`:

```ts
PortRequestSchema   = { kind: "request", id: string, method: string, args: unknown[] }
PortResponseSchema  = { kind: "response", id: string, ok: boolean,
                        result?: unknown, resultIsJson?: boolean,
                        error?: { message: string, stack?: string } }
PortBroadcastSchema = { kind: "broadcast",
                        event: "wallet-update" | "authorization-request"
                             | "proof-debug-export-request"
                             | "vault-locked" | "vault-unlocked",
                        payload: unknown }
PortMessageSchema   = z.discriminatedUnion("kind", [...])
```

Discriminated union → exhaustive narrowing on receive. Both `PortServer` and `PortClient` `safeParse` every inbound message; malformed messages are silently dropped (`port-server.ts:40-41`, `port-client.ts:83-91`). Zod is the **only** runtime validation layer in the IPC stack — everything else trusts that what came over the wire matches the schema.

### `PortServer` (`src/ipc/port-server.ts`)

Holds `Set<chrome.runtime.Port>` (multi-client; popup + expanded + approval can be open simultaneously). On `onMessage`, dispatch to `handlers[req.method]`, build a `PortResponse`, postMessage it back.

The interesting bit is the **JSON fallback** at `port-server.ts:46-88`:

```ts
try {
  port.postMessage(response);
} catch (err) {
  // postMessage failed with DataCloneError or similar. Wallet results
  // often contain class instances with `toJSON()` (Fr, AztecAddress,
  // TxSimulationResult) — JSON.stringify is more permissive than
  // structured clone for these. Fall back to a stringified result.
  port.postMessage({
    ...response,
    result: response.ok ? jsonStringify(response.result) : undefined,
    resultIsJson: response.ok,
  });
}
```

`jsonStringify` from `@aztec/foundation/json-rpc` handles BigInt → decimal string, Buffer → base64, Map/Set, plus respects `toJSON()`. The `resultIsJson` flag tells the client to `JSON.parse(msg.result)` to recover the value (`port-client.ts:101-105`). This is brilliant practical engineering — Aztec primitives like `TxSimulationResult` carry non-cloneable internal slots that structured-clone chokes on, and Grego's escape hatch lets the wallet ship without polyfilling every result type.

### `PortClient` (`src/ipc/port-client.ts`)

UI-side counterpart. State:

- `port: chrome.runtime.Port | null`
- `connecting: Promise<void> | null` — single-flight connect
- `pending: Map<id, { resolve, reject }>`
- `subscriptions: Map<event, Set<handler>>`

Connection is two-step (`port-client.ts:40-54`): send `{ type: "ensure-offscreen" }` over `chrome.runtime.sendMessage` to wake the offscreen, **then** `chrome.runtime.connect({ name: OFFSCREEN_PORT_NAME })`. Without the SW ping the port would arrive before any listener exists and disconnect. (The SW skips its own ping by passing `{ skipEnsureOffscreen: true }` since it knows it just brought the offscreen up — see `background.ts:25`.)

`onDisconnect` rejects all pending calls with `Error("Port disconnected")` (`port-client.ts:117-122`). Wired but no auto-reconnect; the next `call()` triggers re-`connect()` via the lazy guard at line 62.

### The 4 namespaces

`WalletHost.buildHandlers()` (`wallet-host.ts:77-142`) registers methods under prefixes:

- **`vault.*`** — `isInitialized`, `isUnlocked`, `initialize(pw)`, `unlock(pw)`, `lock`. Direct calls into `VaultState`.
- **`network.*`** — `set(chainId, version)`, `get()`. Updates `currentChainInfo`. Called by every UI surface as it mounts (`port-wallet-api.ts:28`).
- **`authorization.*`** — `getPending()`, `resolve(response)`. Cross-session aware: iterates over `getRunningSessionIds()` and unions `pendingAuthorizations` from each session's shared resources (`wallet-host.ts:103-137`). Critical because the dApp call's session (e.g. testnet) often differs from the UI's `currentChainInfo` (e.g. localhost).
- **`wallet.*`** — populated dynamically from `Object.keys(InternalWalletInterfaceSchema)` at `wallet-host.ts:154-192`. Each method routes to `InternalWallet.<name>` after a `vault.isUnlocked` guard.
- **`dapp.*`** — populated from `Object.keys(WalletSchema)` at `wallet-host.ts:199-237`. Each method routes to `ExternalWallet.<name>`. Receives `(session, message)` from the SW; `args = message.args`.

### Args revival via Zod (the tasty trick)

Port traffic is JSON-serialised. Aztec primitives (`Fr`, `AztecAddress`, `Buffer`) cross as their `toJSON` forms. The Zod schemas attached to each method already know how to parse those forms back into class instances — Grego pulls out the args parser once per method and reuses it (`wallet-host.ts:12-30`):

```ts
function makeArgsParser(methodSchema): ((args: unknown[]) => unknown[]) | undefined {
  if (!methodSchema || typeof methodSchema !== "object" || !("_def" in methodSchema)) return undefined;
  const def = (methodSchema as { _def: { args?: unknown } })._def;
  const argsSchema = def.args as ...;
  if (!argsSchema || typeof argsSchema.parse !== "function") return undefined;
  const expectedLen = argsSchema._def?.items?.length ?? 0;
  return (args: unknown[]) => {
    const padded = args.length < expectedLen
      ? [...args, ...Array(expectedLen - args.length).fill(undefined)]
      : args;
    return argsSchema.parse(padded);
  };
}
```

Two subtle things:

1. **Padding** is needed because `z.function().args(a, b, c.optional())` compiles to a fixed-length tuple of 3, even with the third slot optional — callers passing 2 args would otherwise trip a "min 3" error.
2. **Per-method memoisation** — the parser is built once when handlers are registered, not on each call.

### `chainInfo` revival

`wallet-host.ts:36-46` — `reviveChainInfo` reconstructs `Fr` instances from the hex-string forms that crossed the JSON port. Defensive narrowing:

```ts
const toFr = (v: unknown): Fr =>
  v instanceof Fr ? v
  : typeof v === "string" ? Fr.fromString(v)
  : new Fr(v as bigint | number | boolean);
```

`shared/src/wallet/session/session.ts:163-172` does the same for `rollupVersion` returned from `node.getNodeInfo()` — Grego notes the SDK's compile-time type doesn't always match the runtime value across versions.

---

## 5. Vault & lock state machine

### `VaultState` (`src/vault/vault-state.ts`)

Tiny class — 64 lines — wraps `unlockedKey: Uint8Array | null` and a Set of listeners.

```ts
isUnlocked(): boolean { return this.unlockedKey !== null; }
isInitialized(): Promise<boolean> { return hasVaultMeta(); }

async initialize(password: string): Promise<void> {
  if (await hasVaultMeta()) throw new Error("Vault already initialized");
  const kdfSalt = generateSalt();
  const kdfParams = DEFAULT_KDF_PARAMS;
  const key = await deriveKey(password, kdfSalt, kdfParams);
  const vaultProbe = await makeProbe(key);
  await writeVaultMeta({ kdfSalt, kdfParams, vaultProbe });
  this.unlockedKey = key;
  this.notify("unlocked");
}

async unlock(password: string): Promise<boolean> {
  const meta = await readVaultMeta();
  if (!meta) return false;
  const key = await deriveKey(password, meta.kdfSalt, meta.kdfParams);
  if (!(await verifyProbe(meta.vaultProbe, key))) return false;
  this.unlockedKey = key;
  this.notify("unlocked");
  return true;
}

lock(): void {
  if (!this.unlockedKey) return;
  this.unlockedKey.fill(0);   // best-effort wipe
  this.unlockedKey = null;
  this.notify("locked");
}
```

Three states: `uninitialized` (no `vaultMeta` in IndexedDB), `locked` (have meta, key not in memory), `unlocked` (key in memory). `lock()` zeroes the buffer before nulling — best-effort; doesn't help if the GC already moved the bytes.

### KDF (`src/vault/kdf.ts`)

Argon2id from `@noble/hashes/argon2`. Parameters: `m: 64 KiB, t: 3 iterations, p: 1` (`kdf.ts:13`). Comment says **"<500ms on a 2024 laptop"** but the test file (`kdf.test.ts:5`) has `KDF_TEST_TIMEOUT = 30_000` and a comment "production-grade Argon2id at DEFAULT_KDF_PARAMS runs ~2-5s per derivation under CI/sandbox load". So the budget is roughly half a second on warm hardware, several seconds in CI.

### Probe pattern

Instead of encrypting account secrets with the derived key, Grego only encrypts a **fixed plaintext**:

```ts
const PROBE_PLAINTEXT = new TextEncoder().encode("aztec-extension-wallet/probe/v1");
```

Stored as `{ iv, ciphertext }` (`kdf.ts:36-55`). On unlock, decrypt and compare bytes to the expected plaintext — if it matches, password was correct. Cheap, preserves the unlock UX without committing to an encryption-at-rest format yet.

### The plaintext-secrets caveat

This is the v1 caveat the README calls out:

> **At-rest encryption is deferred.** The vault uses Argon2id + a probe-based password check, but account secrets are stored in plaintext in IndexedDB. This is intentional pending the in-progress IndexedDB replacement; the lock UX is preserved so the surface area doesn't change when encryption is added later.

Confirmed at `shared/src/wallet/database/wallet-db.ts:145`:

```ts
await this.accounts.set(`${address.toString()}:sk`, secretKey.toBuffer());
```

The secret key bytes go straight into the kv-store map. The vault probe doesn't gate the data — it gates the *UI*. Anyone with disk access (or with extension dev access) can read the IndexedDB data while the wallet is "locked". Grego is open about this: lock is a UX layer, not a confidentiality layer, until at-rest encryption lands.

For Nulo this is a clear differentiator: `wallet-crypto`'s `PasswordSecretBox` actually encrypts vault contents.

### `vault-meta.ts`

`(Grego source tree)/extension-wallet/src/vault/vault-meta.ts:1-65`. Uses `@aztec/kv-store/indexeddb` (the same backend Aztec uses for PXE). Stores meta as a JSON string under the key `v1` in the `vault-meta` map. Serialises `Uint8Array` as `number[]` for JSON portability — no base64, no ArrayBuffer-typed-roundtrip ceremony.

The store is module-cached (`cachedStore`) — a single instance reused for the offscreen's lifetime. Sized at `dataStoreMapSizeKb: 1024`, way smaller than the PXE's 20GB store (`shared/src/wallet/session/session.ts:91`).

### State machine across surfaces

The popup's `vaultState` is `"uninitialized" | "locked" | "unlocked" | null` (the null is a brief loading state — `Popup.tsx:17-19`). Initial value: query both `vault.isInitialized` and `vault.isUnlocked` over the port (`Popup.tsx:90-102`). Updates via two broadcast subscriptions:

```ts
client.onBroadcast("vault-locked", () => setVaultState("locked"));
client.onBroadcast("vault-unlocked", () => setVaultState("unlocked"));
```

The expanded view does the same via a `key={epoch}` remount trick (`expanded/main.tsx:31-56`):

```ts
function ExpandedApp() {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => client.onBroadcast("vault-locked", () => setEpoch((e) => e + 1)), []);
  return <StandaloneShell key={epoch} ... />;
}
```

`StandaloneShell` only checks `isAlreadyUnlocked` at mount; bumping the key forces a remount on lock so the unlock screen reappears — cheap workaround for an upstream API limitation.

---

## 6. dApp ↔ wallet path

### Provider injection

Not in `extension-wallet/`. `ContentScriptConnectionHandler` from `@aztec/wallet-sdk/extension/handlers` handles this — it's the wallet-sdk's canonical content-script implementation, which injects whatever provider machinery the SDK ships. The content script (`entrypoints/content.ts`) is just:

```ts
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

This is a deliberate posture: outsource the dApp wire format to the SDK, build only the host. The flip side is that **whatever bug or quirk the SDK ships** is inherited verbatim — Grego doesn't get to polyfill behaviour at the content-script level. If you compare to Nulo's `@nulo/wallet-bridge`, Nulo owns the dispatcher (and types) directly.

### Origin gating

Implicit in the SDK: `BackgroundConnectionHandler.onPendingDiscovery` callback receives `{ requestId, appId, origin, chainInfo }`, and Grego's discovery flow keys remembered apps on the **(appId, origin, chainId, version)** quadruple — see `src/background/remembered-apps.ts:21-32`:

```ts
export async function isAppRemembered(
  appId: string, origin: string, chainId: string, version: string,
): Promise<boolean> {
  const apps = await getRememberedApps();
  return apps.some((a) =>
    a.appId === appId && a.origin === origin && a.chainId === chainId && a.version === version);
}
```

Storage is `chrome.storage.local` under `REMEMBERED_APPS_KEY = "rememberedApps"` (`shared/constants.ts:5`). Old format entries lacking `chainId/version` are filtered out (`remembered-apps.ts:18`) — graceful schema migration.

### SW-to-offscreen translation

`background.ts:113-127`:

```ts
const result = await client.call<unknown>(`dapp.${message.type}`, [session, message]);
const response: WalletResponse = {
  messageId: message.messageId,
  walletId: WALLET_ID,
  result,
};
await sessionHandler.sendResponse(session.sessionId, response);
```

The `message.type` becomes the method name — so a dApp's `simulateTx` request becomes a `dapp.simulateTx` port call. The offscreen-side handler unwraps `[session, message]`, revives `chainInfo`, finds (or creates) the per-(chainId, version) session via `getOrCreateSession`, then routes to `ExternalWallet.simulateTx(...message.args)` (`wallet-host.ts:208-235`).

### Active-session emoji verification

`Popup.tsx:131-187` — the popup imports `hashToEmoji` from `@aztec/wallet-sdk/crypto` and renders each active session's `verificationHash` as an emoji string (`Popup.tsx:172`). The user compares with the dApp's display; matching = handshake produced same shared secret on both sides = no MITM.

Verified state is stored in `chrome.storage.session` under `verifiedSessionIds`, which **resets on browser restart** (`Popup.tsx:50-64`) — security default: re-verify per browser session. Smart.

---

## 7. Approval flow

### The window queue (`src/background/approval-window.ts`)

40 lines. State:

```ts
const queue: ApprovalRequest[] = [];
let openWindowId: number | null = null;
```

`enqueueApproval(req)`:

1. dedup by id
2. push to queue
3. if no window open, `openNext()`

`openNext()`:

1. shift from queue
2. `chrome.windows.create({ url: approval.html?requestId=..., type: "popup", width: 400, height: 600, focused: true })`
3. cache the windowId

`chrome.windows.onRemoved` listener: when the approval window closes, set `openWindowId = null`, bump activity, then `openNext()` for the next queued request. Strict serialisation — only one approval window at a time. No design smell here; that's the safe default for a wallet (avoids batched-approval phishing).

### Trigger path

`background.ts:28-34`:

```ts
portClient.onBroadcast("authorization-request", (payload) => {
  const req = parseEventDetail(payload) as { id: string; type?: string };
  enqueueApproval({ id: req.id, type: req.type ?? "unknown" });
});
```

The SW subscribes to the offscreen's `authorization-request` broadcast. When `ExternalWallet.simulateTx` (or any operation that needs auth) calls `pendingAuthorizations.set(id, { promise, request })` and emits `authorization-request`, the SW receives the broadcast and enqueues an approval window.

### `parseEventDetail` (the `jsonStringify` quirk)

Important production detail at `src/ipc/parse-event-detail.ts`:

```ts
export function parseEventDetail(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}
```

The wallet emits events with `detail: jsonStringify(content)` (string), not the object directly. Without parsing first, `req.id` is undefined and the approval window opens with `?requestId=undefined`. The fix is one line in `background.ts:32` and one line in `port-wallet-api.ts:42` — but it's a class of bug worth pinning.

### `authorization.getPending` (one-shot, not broadcast-replay)

`approval/main.tsx:39-50`:

```ts
useEffect(() => {
  if (!requestId) return;
  void (async () => {
    const pending = await client.call<AuthorizationRequest[]>("authorization.getPending", []);
    const found = pending.find((r) => r.id === requestId);
    if (found) setRequest(found);
  })();
}, [client, requestId]);
```

The approval window queries `authorization.getPending` *once* at mount and finds its request by the `requestId` URL param. **It doesn't subscribe** to the `authorization-request` broadcast.

The README explicitly calls this out as a deliberate deviation from the design plan:

> Approval window uses `authorization.getPending` (one-shot read at mount) instead of a broadcast-replay mechanism. Avoids spamming every open UI surface with re-broadcasts of every pending auth.

Smart trade. Broadcast-replay would force every connected UI surface (popup + expanded + future sidepanel) to ignore-or-handle every pending auth even though only the approval window cares. One-shot read is N+1 round-trips at most on bursty workloads, but the path stays cleaner.

### Window-close = denial

`approval/main.tsx:53-72`:

```ts
useEffect(() => {
  function onUnload() {
    if (resolved.current || !request) return;
    const itemResponses: Record<string, AuthorizationItemResponse> = {};
    for (const item of request.items) {
      itemResponses[item.id] = { id: item.id, approved: false, appId: item.appId };
    }
    void client.call("authorization.resolve", [
      { id: request.id, approved: false, appId: request.appId, itemResponses },
    ]);
  }
  window.addEventListener("beforeunload", onUnload);
  ...
}, [client, request]);
```

User closes the window → fire a deny on `authorization.resolve` for every item. Comment is honest:

> Best-effort: postMessage on a port runs synchronously; the offscreen may or may not see it before the SW unloads us.

Without this, closing the window without clicking would leave the dApp call hanging until timeout.

### `authorization.resolve` cross-session

`wallet-host.ts:119-137`:

```ts
"authorization.resolve": async (responseRaw) => {
  const response = responseRaw as { id, approved, appId, itemResponses };
  const sessionIds = getRunningSessionIds();
  for (const sessionId of sessionIds) {
    const shared = await getSharedResources(sessionId);
    const pending = shared.pendingAuthorizations.get(response.id);
    if (pending) {
      pending.promise.resolve(response as never);
      shared.pendingAuthorizations.delete(response.id);
      return true;
    }
  }
  return false;
},
```

Iterates every running session looking for the request id. Mirrors `AuthorizationManager.resolveAuthorization` but operates directly on the shared map. Necessary because the approval window only has the requestId and doesn't know which session owns it.

---

## 8. Aztec patterns Grego uses (HEADLINE SECTION)

This is what Nulo most cares about. **Caveat upfront**: most of these patterns live in `@demo-wallet/shared`, not in `extension-wallet/` itself. `extension-wallet/` chooses to use shared as-is rather than re-implement. But these are still the patterns Grego maintains and ships into production, so they're the gold-standard reference.

### PXE creation

`shared/src/wallet/session/session.ts:72-121` — `defaultSharedResourcesFactory`:

```ts
const l1Contracts = await node.getL1ContractAddresses();
const rollupAddress = l1Contracts.rollupAddress;

const configOverrides: Partial<PXEConfig> = {
  dataDirectory: `./pxe-${rollupAddress}`,
  proverEnabled: true,
};

const options: PXECreationOptions = {
  loggers: { store, pxe, prover: createLogger("bb:native") },
  store: await createStore(`pxe-${rollupAddress}`, { dataDirectory, dataStoreMapSizeKb: 2e10 }, 2,
                          createLogger("pxe:data:lmdb")),
};

const walletDBStore = await createStore(`wallet-${rollupAddress}`, ...);
const db = WalletDB.init(walletDBStore, walletDBLogger);

const pxe = await createPXE(node, { ...getPXEConfig(), ...configOverrides }, options);
```

Key observations:

- **`@aztec/pxe/client/lazy`** — uses the WASM prover variant with lazy artifact loading (vs. `client/eager` or the heavy fully-bundled flavour). Right pick for browser/extension contexts.
- **One PXE per session, keyed by `${chainId}-${version}`** — `session.ts:175,178-186`. The comment explicitly warns: "multiple PXE instances sharing the same IndexedDB store cause Map/storage desync". This is a real Aztec footgun.
- **PXE store is namespaced by `rollupAddress`** (the L1 rollup contract address from `node.getL1ContractAddresses()`). Network upgrades that change rollup address create a fresh data dir; old data isn't accidentally migrated.
- **`proverEnabled: true`** — real proofs, not mock. Combined with `client/lazy`, that means the bb.js prover boots when first needed, not at PXE creation.
- **20GB store cap** (`dataStoreMapSizeKb: 2e10`) — generous. IndexedDB usually doesn't enforce hard quotas this aggressively, but the kv-store layer exposes the option.

### Kernel-less / `NO_FROM` / "from no address"

`shared/src/wallet/core/demo-wallet.ts:172-215` — `simulateViaEntrypoint`:

```ts
if (from === NO_FROM) {
  const entrypoint = new DefaultEntrypoint();
  txRequest = await entrypoint.createTxExecutionRequest(
    finalExecutionPayload,
    feeOptions.gasSettings,
    chainInfo,
  );
} else {
  const { type } = await this.db.retrieveAccount(from);
  const originalAccount = await this.getAccountFromAddress(from);
  const completeAddress = originalAccount.getCompleteAddress();
  const isEcdsa = type === "ecdsasecp256k1" || type === "ecdsasecp256r1";
  const stubAccount = isEcdsa
    ? createStubEcdsaAccount(completeAddress)
    : createStubSchnorrAccount(completeAddress);
  // ... uses stubAccount.createTxExecutionRequest
}
```

Two distinct paths:

1. **`NO_FROM` (kernel-less)** — `DefaultEntrypoint` from `@aztec/entrypoints/default`. No account, no signing. Used for read-only dApp flows where the dApp is fine sending a tx without binding to a particular wallet account. The UI surfaces this with a chip ("External entrypoint") and an alert ("This transaction uses an external entrypoint and does not execute from any of your accounts.") — see `shared/src/ui/components/authorization/AuthorizeSendTxContent.tsx:36-79`.
2. **Stub account simulation** — when `from` is set, build a `createStubSchnorrAccount` (or ECDSA stub) for that account's complete address, simulate via the stub. The stubs are real account contracts with stubbed signature paths so simulation runs without unlocking the real signing key. Real signing happens only at the proving stage.

The `NO_FROM` symbol comes from `@aztec/aztec.js/account` (`internal-wallet.ts:1`). Grego treats it as a first-class user-facing concept: chips, alerts, distinct authorization UX. Nulo doesn't currently expose this — worth considering if you want feature parity for "external entrypoint" dApp flows.

### `setPayer` / fee abstraction (`embeddedPaymentMethodFeePayer`)

The `simulateTx` and `sendTx` authorization items carry an optional `embeddedPaymentMethodFeePayer: AztecAddress` field (`shared/src/ipc/wallet-internal-interface.ts:133,203`). The semantics:

- The dApp can attach a **fee payment method** to the tx (via `walletFeePaymentMethod` in `ExecutionPayload` — see `demo-wallet.ts:179`). If the dApp's payment method has a `feePayer`, it gets surfaced as `embeddedPaymentMethodFeePayer`.
- The wallet UI shows a chip ("App pays fee") and an alert ("The app is providing the fee payment method for this transaction.") — `AuthorizeSendTxContent.tsx:62-84`. Distinct security signal: "this app says it's paying — verify before approving".

The actual fee logic lives in `completeFeeOptions` (referenced from `internal-wallet.ts:162,239` and `external-wallet.ts:127,151`). At the demo-wallet level (`demo-wallet.ts:179-182`):

```ts
const feeExecutionPayload = await feeOptions.walletFeePaymentMethod?.getExecutionPayload();
const finalExecutionPayload = feeExecutionPayload
  ? mergeExecutionPayloads([feeExecutionPayload, executionPayload])
  : executionPayload;
```

If a wallet-side fee payment method is in play (vs. an embedded dApp-provided one), its execution payload is merged in front of the user's payload. This is the standard pattern for paymaster-style flows.

### Auth witness creation

`shared/src/wallet/operations/create-authwit-operation.ts` — full operation type. Args: `[from: AztecAddress, messageHashOrIntent: IntentInnerHash | CallIntent]`. Result: `AuthWitness` from `@aztec/stdlib/auth-witness`.

The operation goes through `ExternalOperation`'s `check → prepare → authorize → execute` flow, presents an authorization dialog with the call intent (or raw inner hash), and produces an `AuthWitness` only after user approval.

For **simulation-time** auth witnesses (the case where simulating a tx surfaces required auth witnesses for operations on behalf of the user) — `internal-wallet.ts:181-198`:

```ts
const offchainEffects = collectOffchainEffects(simulationResult.privateExecutionResult);
const authWitnesses = await Promise.all(
  offchainEffects.map(async (effect) => {
    try {
      const authRequest = await CallAuthorizationRequest.fromFields(effect.data);
      return this.createAuthWit(authRequest.onBehalfOf, {
        consumer: effect.contractAddress,
        innerHash: authRequest.innerHash,
      });
    } catch {
      return undefined;
    }
  }),
);
for (const authwit of authWitnesses) {
  if (authwit) executionPayload.authWitnesses.push(authwit);
}
```

The pattern: simulate first, parse `offchainEffects` for `CallAuthorizationRequest` shapes, generate auth witnesses for each, then re-attach to the payload before proving. This is the canonical pre-prove auth-witness collection sequence and Grego implements it directly. (The `try/catch` swallowing failed parses is correct — not every offchain effect is an auth request.)

### Simulate vs. send/prove flow

Two-phase pattern, very explicit (`internal-wallet.ts:131-232,234-...`):

**Simulation phase:**
1. `accountManager.getDeployMethod()` → `request(opts)` → `ExecutionPayload`
2. `completeFeeOptions({ from, feePayer, gasSettings, forEstimation: true })` — note the `forEstimation: true` flag → permissive gas limits
3. `simulateViaEntrypoint(executionPayload, { from, feeOptions, additionalScopes, skipTxValidation: true })` — simulate against PXE
4. Collect auth witnesses from `simulationResult.privateExecutionResult` (above)
5. `getGasLimits(simulationResult)` → real gas estimate

**Send/prove phase (separate `sendTx` method, `internal-wallet.ts:234-`):**
1. Re-call `completeFeeOptions` *without* `forEstimation`
2. `createTxExecutionRequestFromPayloadAndFee(executionPayload, opts.from, fee)`
3. `pxe.proveTx(txRequest, scopes)` — the actual heavy lift
4. `provenTx.toTx()` → `aztecNode.sendTx(tx)`

The key insight: `simulate` and `send/prove` go through the **same** `completeFeeOptions` machinery but with different gas-limit policies. `forEstimation: true` lifts limits high enough that simulation doesn't fail on gas-limit checks; the real estimate from `getGasLimits` is then plumbed back into the actual send. Nulo should mirror this if it doesn't already — using the same sim-then-real-fee-options path means estimation can never silently diverge from the real send.

### Note discovery / syncing

Not visible in `extension-wallet/` itself or in shared's session module. `note discovery` and `syncNotes` are **PXE responsibilities** — once `createPXE(node, config)` is up, PXE handles note discovery internally. The wallet doesn't manually trigger sync.

What *is* visible: `proverEnabled: true` (`session.ts:79`) and `client/lazy` ensure the PXE can actually prove and lazy-load artifacts, but no manual `syncNotes` call appears anywhere. This matches current PXE design — discovery is automatic.

### `@aztec/wallet-sdk` vs. raw `@aztec/aztec.js`

`extension-wallet/`'s **direct** imports:

| From | What |
| --- | --- |
| `@aztec/wallet-sdk/extension/handlers` | `BackgroundConnectionHandler` (SW), `ContentScriptConnectionHandler` (CS) |
| `@aztec/wallet-sdk/types` | `WalletResponse` |
| `@aztec/wallet-sdk/crypto` | `hashToEmoji` |
| `@aztec/aztec.js/fields` | `Fr` |
| `@aztec/aztec.js/log` | `createLogger` |
| `@aztec/aztec.js/account` | `ChainInfo` (type only) |
| `@aztec/aztec.js/wallet` | `WalletSchema` (for dispatcher key enumeration) |
| `@aztec/foundation/json-rpc` | `jsonStringify` (for the port-server fallback) |

So **wallet-sdk** is used for the dApp wire (Background/Content handlers) and crypto helpers. **aztec.js** is used for primitive types and for the schema enumeration trick. **No `@aztec/pxe` import in `extension-wallet/`** — the offscreen pulls PXE only via the shared package.

`shared/`'s imports include `@aztec/pxe/client/lazy`, `@aztec/wallet-sdk/base-wallet` (`BaseWallet`), `@aztec/entrypoints/default` (`DefaultEntrypoint`), `@aztec/entrypoints/account` (entrypoint options), `@aztec/accounts/schnorr`, `@aztec/accounts/ecdsa`, `@aztec/accounts/stub/{schnorr,ecdsa}`. The `BaseWallet` from wallet-sdk is the parent of `DemoWallet` — Grego subclasses it and adds operation orchestration.

Layered view: `extension-wallet/` (host) → `shared/wallet/core/{Internal,External}Wallet` extends `DemoWallet` extends `@aztec/wallet-sdk/base-wallet`. The MV3 host is one layer above the wallet-sdk's recommended composition point.

### `registerAccount` / `registerSender`

- `registerAccount` — `shared/src/wallet/operations/register-contract-operation.ts:200`:
  ```ts
  await this.pxe.registerAccount(secretKey, await computePartialAddress(instance));
  ```
  Wrapped in a `RegisterContract`-style operation. Triggered when a foreign account contract instance is being registered with PXE so the wallet can decrypt its notes.
- `registerSender` — appears in two places:
  - **PXE registration**: `internal-wallet.ts:71` (`await this.pxe.registerSender(address)`) and `demo-wallet.ts:238` (auto-register stored senders on `getAddressBookInternal`).
  - **DB persistence**: `internal-wallet.ts:69` (`await this.db.storeSender(address, alias)`).

The pattern: store the sender alias in WalletDB *and* register with PXE. The auto-register-on-list pass at `demo-wallet.ts:233-242` is a guard against PXE state being newer than wallet-DB state (e.g. after a PXE wipe).

`internal-wallet.ts` skips authorization for `registerSender` (trusted GUI), `external-wallet.ts:299-300` requires authorization (`RegisterSenderOperation` runs the auth flow). Same surface, different trust levels.

### Schnorr account contract usage

`shared/src/wallet/core/demo-wallet.ts:91-104,148-153`:

```ts
case "schnorr":
  contract = new SchnorrAccountContract(Fq.fromBuffer(signingKey));
  break;
case "ecdsasecp256k1":
  contract = new EcdsaKAccountContract(signingKey);
  break;
case "ecdsasecp256r1":
  contract = new EcdsaRAccountContract(signingKey);
  break;
```

And the **stub-account** path used during simulation:

```ts
const isEcdsa = type === "ecdsasecp256k1" || type === "ecdsasecp256r1";
const artifact = isEcdsa ? StubEcdsaAccountContractArtifact : StubSchnorrAccountContractArtifact;
const stubConstructorArgs = type === "schnorr" ? [Fr.ZERO, Fr.ZERO] : [Buffer.alloc(32), Buffer.alloc(32)];
```

Three account contract types out of the box (`shared/src/wallet/database/wallet-db.ts:18`):

```ts
export const AccountTypes = ["schnorr", "ecdsasecp256r1", "ecdsasecp256k1"] as const;
```

Nulo currently ships only Schnorr (per CLAUDE.md). Multi-curve support would be additive but not architecturally complex given Grego's pattern.

The Schnorr signing key derivation isn't exposed at this layer — it's `Fq.fromBuffer(signingKey)` where `signingKey` is whatever was stored in the WalletDB during onboarding. The derivation that produced that signing key happens elsewhere (likely in onboarding/`StandaloneShell` from shared/ui).

---

## 9. Production gotchas Grego solved

### `function-bind` CSP issue

The big one. From `wxt.config.ts:26-37`:

```ts
// MV3 forbids `'unsafe-eval'` in CSP. The `function-bind` package (a
// transitive dep of `get-intrinsic` / `call-bind` and many others)
// dynamically constructs a bound function from a string to preserve
// `f.length` — that triggers CSP and breaks RPC response handling.
// Native `Function.prototype.bind` does the same thing without eval, so
// we alias both `function-bind` and its `/implementation` entry point
// (some deps import the latter directly) to a thin stub.
alias: [
  { find: /^function-bind$/, replacement: fnBindStub },
  { find: /^function-bind\/implementation$/, replacement: fnBindStub },
],
```

The stub itself (`src/shared/function-bind-stub.cjs`):

```js
"use strict";
var nativeBind = Function.prototype.bind;
function bind(that) { return nativeBind.apply(this, arguments); }
module.exports = bind;
```

Note: **CommonJS** (`.cjs`), because `function-bind` is consumed via `module.exports = fn` semantics (the module *itself* is the bind function). ESM `export default` would resolve to `{ default: fn }` under CJS interop and crash callers that do `bind.apply(...)`. Two regex aliases because some deps import `function-bind`, others import `function-bind/implementation` directly. Smart catch.

This bug is the kind of thing that's invisible until you ship to MV3 strict CSP and watch RPC responses fail to deliver. Grego clearly hit it and documented the fix.

### `nodePolyfills` for Aztec deps

`wxt.config.ts:12-24`:

```ts
plugins: [
  nodePolyfills({
    include: ["buffer", "process"],
    globals: { Buffer: true, process: true, global: false },
    protocolImports: false,
  }),
],
define: {
  "process.env.NODE_ENV": JSON.stringify("production"),
},
```

`@rollup/plugin-inject` injects `globalThis.Buffer` and `process` into every chunk so they survive code-splitting. A runtime shim in a single entry doesn't survive splitting — Aztec deps reach for these at module-init time, so they have to be globally available before any chunk runs. `global: false` because that one's not actually needed and `globalThis` already exists. `protocolImports: false` skips polyfills like `node:fs`, `node:path` — those genuinely don't have browser equivalents and forcing them in would silently mask "you imported the wrong thing" bugs.

`define`: `process.env.NODE_ENV` is still substituted at build time so dead-code elimination can strip dev branches even though the polyfill provides a `process` object at runtime. Belt-and-braces.

### MV3 wasm-unsafe-eval

Already covered in the manifest section (`script-src 'self' 'wasm-unsafe-eval'`). Aztec's bb.js prover is WASM, so `wasm-unsafe-eval` is required. `unsafe-eval` (the JS one) is not — that's what makes the function-bind workaround necessary.

### Schema-key enumeration vs. JS Proxy

Quoted from the README ("Known deviations"):

> `dapp.*` and `wallet.*` dispatch use explicit schema-key enumeration (not a JS `Proxy`). Rationale: spreading a Proxy into a plain object loses the `get` trap, defeating the dispatcher.

In practice (`wallet-host.ts:168,201`):

```ts
for (const methodName of Object.keys(InternalWalletInterfaceSchema)) {
  handlers[`wallet.${methodName}`] = async (...args) => { ... };
}
```

Naive alternative would be `{ ...new Proxy({}, { get: (_, k) => k.startsWith("wallet.") ? handler : undefined }) }`. But spreading a Proxy enumerates own keys at spread time — the `get` trap **never fires**. By the time `handlers[methodName]` is looked up, the Proxy's been flattened to a plain object with no keys. Production-grade trap.

This is the same gotcha that breaks Lodash-style `_.merge(plainObj, proxy)`. Grego documents it deliberately.

### `chrome.offscreen` ready-gate (covered in §3)

### JSON-stringify fallback for postMessage (covered in §4)

### `parseEventDetail` for jsonStringify'd events (covered in §7)

### Padding optional-args parser (covered in §4)

### `chrome.windows.onRemoved` → release approval queue (covered in §7)

### `verifiedSessionIds` in `chrome.storage.session` (resets on browser restart) (covered in §6)

That's a *lot* of subtle production fixes for a 28-file extension. Most are one to three lines, all are commented. This is the kind of code that pays for itself on day 30, not day 1.

---

## 10. UI

React + MUI dark mode. `createTheme({ palette: { mode: "dark" } })` is repeated in each entrypoint's `main.tsx` — could DRY but the current shape keeps each entry standalone.

### Page composition

- **Popup** is hand-rolled in `Popup.tsx` (330 lines including TODO comments where the design isn't final). Three feature surfaces in priority order:
  1. **Unverified active sessions** (emoji verification) — takes precedence.
  2. **Pending discoveries** — second priority.
  3. **Vault state UI** — locked / unlocked / uninitialized.
  Each TODO block reads as a design brief for the team to fill in (e.g. "8-25 lines of JSX is plenty for a v1"). Honest about being scaffold-quality.
- **Approval window** uses `AuthorizationDialog` from `@demo-wallet/shared/ui` — i.e. the same dialog the web wallet uses. Plumbs in a port-backed `walletAPI` via the `WalletContext.Provider` so dialog internals can call wallet methods over the port (`approval/main.tsx:102-110`).
- **Expanded view** uses `StandaloneShell` from `@demo-wallet/shared/ui`. **`extension-wallet/` does NOT re-implement this** — it really is reusing the shell from shared. The bridging layer is `walletApiFactory={(chainId, version) => makePortWalletApi(client, chainId, version)}` plus `verifyPin` / `setPin` / `isAlreadyUnlocked` / `hasExistingVault` callbacks (`expanded/main.tsx:35-55`). Big architectural lift from this — the expanded view is at parity with the web wallet UX for free.
- **Onboarding** is hand-rolled (`Onboarding.tsx`, 125 lines). Three-step Stepper. Validates min 8 char password, confirms match, calls `vault.initialize`.

### Lock-screen UX

`Popup.tsx:273-305`: TextField + Enter handler + error display + Unlock button. Minimal. Not a bug — popups are 380px wide.

### `makePortWalletApi` (the proxy)

`src/ui/port-wallet-api.ts:23-46`. This *is* a JS Proxy (the SAFE place to use one — only outbound, never spread):

```ts
return new Proxy({} as InternalWalletInterface, {
  get(_t, prop) {
    if (typeof prop !== "string" || prop === "then") return undefined;
    const event = EVENT_BY_METHOD[prop];
    if (event) {
      return (cb: (p: unknown) => void) =>
        client.onBroadcast(event, (raw) => cb(parseEventDetail(raw)));
    }
    return (...args: unknown[]) => client.call(`wallet.${prop}`, args);
  },
}) as InternalWalletInterface;
```

`prop === "then"` short-circuits — without it, code that does `await someWalletApi` would trip the Proxy and try to call a `wallet.then` method. Classic Promise interop bug.

`onWalletUpdate`, `onAuthorizationRequest`, `onProofDebugExportRequest` are *broadcast subscribers*, not method calls — handled separately via `EVENT_BY_METHOD` lookup. Everything else is an outbound port call.

`network.set` is fired eagerly on construction (line 28) so the offscreen knows which session this UI surface is bound to before any wallet method runs.

---

## 11. Storage

### IndexedDB usage

Two distinct stores at the **extension-wallet/** layer:

| Store | Backend | Purpose |
| --- | --- | --- |
| `vault-meta` | `@aztec/kv-store/indexeddb`, 1 MB cap | KDF salt, KDF params, vault probe ciphertext |
| (per-session) `pxe-${rollupAddress}` + `wallet-${rollupAddress}` | same backend, 20 GB cap each | PXE notes/contracts/etc, WalletDB (accounts, aliases, bridgedFeeJuice, interactions, authorizations, txPayloadData) |

`chrome.storage.local`: `rememberedApps`, `settings` (auto-lock minutes).
`chrome.storage.session`: `verifiedSessionIds`.

### What's persisted, what's not

**Persisted** (survive browser restart):
- vault meta (in `vault-meta` IndexedDB)
- per-session PXE state (notes, accounts, etc.)
- WalletDB: account secrets (plaintext), aliases, interactions, authorizations, tx payload data
- remembered apps
- settings (auto-lock minutes)

**Not persisted** (reset on browser restart):
- vault unlock state (in-memory `unlockedKey` only)
- verified session IDs (`chrome.storage.session`)
- approval window queue (in-memory in SW)
- active dApp sessions (live `BackgroundConnectionHandler` state)

### The plaintext-secrets caveat (re-emphasised)

`shared/src/wallet/database/wallet-db.ts:145`:

```ts
await this.accounts.set(`${address.toString()}:sk`, secretKey.toBuffer());
```

The vault probe encrypts a fixed plaintext only. Account secret keys go straight into IndexedDB. Anyone with disk access (or who can dump IndexedDB while the wallet is locked) can recover keys. This is documented in the README's "Caveats (v1)" section and is the most important security gap to call out.

Nulo's `wallet-crypto/PasswordSecretBox` (per CLAUDE.md) provides this missing layer.

---

## 12. What Nulo should STEAL — be SPECIFIC

Concrete file-line references and rationales.

1. **The single-port multiplexed RPC pattern.** Nulo's current design uses many `Service` / `ServiceClient` channels under `@nulo/extension-messaging`. Compare this with Grego's one Zod-discriminated-union envelope (`extension-wallet/src/ipc/port-envelope.ts:45-50`) and one `PortServer` / `PortClient` pair. Less framework, fewer channels, easier to reason about lifecycle. The whole IPC layer is ~250 lines including tests. *Verdict: Nulo's Service abstraction is more heavyweight than necessary if you know all your services live in one offscreen.*
2. **The structured-clone JSON fallback** (`port-server.ts:46-88`). Aztec primitives like `TxSimulationResult` blow up structured clone with non-cloneable internals; `jsonStringify` from `@aztec/foundation/json-rpc` handles them via `toJSON()`. Steal this verbatim.
3. **The Zod-args-parser-with-padding pattern** (`wallet-host.ts:12-30`). Reviving `Fr` / `AztecAddress` after a JSON port-hop is a chronic pain point; using the Zod schema attached to each method as the parser is elegant and eliminates per-method boilerplate. Padding for optional-args tuples is a small but real footgun.
4. **The offscreen ready-gate** (`offscreen-lifecycle.ts:18-33`). `chrome.offscreen.createDocument` resolves before scripts run; without an explicit ready signal from the offscreen, the SW's port-open races the offscreen's `onConnect` listener. Nulo should verify it has equivalent gating or risk intermittent first-call failures.
5. **The Firefox fallback for `chrome.offscreen`** (`offscreen-lifecycle.ts:67-85`). Hidden minimized window. Trivially small. Free Firefox support.
6. **The keep-alive ref-counting pattern** (`offscreen-lifecycle.ts:87-102`). Open a named runtime port from the SW to the offscreen during a flight, close it on completion. `pendingDappCount` in `background.ts:91-92,144-146` ensures the offscreen survives long-running operations.
7. **`function-bind-stub.cjs`** (`src/shared/function-bind-stub.cjs`). This is already production-tested. Even if Nulo doesn't currently hit the issue, it's six lines of insurance against a future transitive-dep update introducing it.
8. **The `parseEventDetail` helper** (`src/ipc/parse-event-detail.ts`). One-line guard against double-stringified event payloads. Zero-cost, prevents one class of "id is undefined" bugs.
9. **Cross-session `authorization.resolve`** (`wallet-host.ts:119-137`). Iterate all running sessions to find the request id. The dApp's session and the UI's session are often different chains; tying authorization to a specific session id at the call site means you have to thread it everywhere.
10. **The `authorization.getPending` one-shot read pattern** (`approval/main.tsx:39-50`). Better than broadcast-replay — every UI surface doesn't need to re-receive every pending auth.
11. **The "approve queue with single visible window" pattern** (`background/approval-window.ts`). 40 lines. Strict serialisation prevents batched-approval phishing.
12. **The "verified session ids in `chrome.storage.session`" pattern** (`Popup.tsx:50-64`). Re-verify per browser session is the right security default.
13. **`embeddedPaymentMethodFeePayer` UX** (`AuthorizeSendTxContent.tsx:36-86`) — distinct chip and alert when the dApp provides the payment method. Worth implementing if Nulo wants paymaster-style flows.
14. **`NO_FROM` UX** (`AuthorizeSendTxContent.tsx:36-79`) — distinct chip and alert when a tx executes from no account. Worth implementing if Nulo wants to support kernel-less / external-entrypoint flows from dApps.
15. **The `from === NO_FROM` simulation path** (`demo-wallet.ts:189-195`) using `DefaultEntrypoint` directly. Simple and matches upstream. If Nulo doesn't support this, dApps using kernel-less flows won't work.
16. **The simulate-collect-authwits-then-merge pattern** (`internal-wallet.ts:181-198`). Simulate first → parse `offchainEffects` → generate auth witnesses → re-attach → prove. Canonical. Nulo should verify this pipeline matches.
17. **`forEstimation` flag on `completeFeeOptions`** (`internal-wallet.ts:162-167`) — distinct gas-limit policy for simulation vs. real send via the same code path. Means estimation can never silently diverge from real send.
18. **The `key={epoch}` remount trick** (`expanded/main.tsx:31-56`) for surfaces whose root component only checks state at mount. Cheap and avoids touching upstream APIs.

---

## 13. What Nulo does that's BETTER

Honest both ways.

1. **At-rest encryption.** Grego's `extension-wallet` has a probe-only vault — `unlock()` decrypts a fixed plaintext but the actual secret keys at `wallet-db.ts:145` are written in plaintext. Nulo's `wallet-crypto/PasswordSecretBox` actually encrypts vault contents. This is the single largest security gap in `extension-wallet/` and the README is upfront about it being deferred.
2. **Layered package architecture with biome `noRestrictedImports` enforcement.** Per Nulo's CLAUDE.md, `wallet-core` → `wallet-crypto` → `extension-messaging` → `aztec-runtime` → `wallet-bridge` → `extension` is enforced at lint time. Grego's `extension-wallet/` is a flat set of folders inside one package; the layering between `extension-wallet/` and `shared/` exists but isn't lint-enforced.
3. **Vue's reactive auto-imports + Pinia stores.** Cleaner mental model than React's `useEffect` chains for this kind of state-heavy popup — Grego's `Popup.tsx:90-109` has nested IIFEs to coordinate three async fetches at mount. Nulo's `<script setup>` ordering convention (per CLAUDE.md) handles this without ceremony.
4. **Explicit dependency hierarchy for the dApp surface.** Nulo's `wallet-bridge` is a dedicated package with a typed dispatcher; Grego's `extension-wallet/` outsources this entirely to `@aztec/wallet-sdk/extension/handlers`. Trade-off: Nulo's approach is more code but more typed-safe and re-implementable; Grego's is less code but inherits whatever the SDK ships.
5. **Pre-commit / commit-msg hooks.** Nulo's setup forces conventional commits + biome on every commit. `extension-wallet/` doesn't have these (the wider grego-wallet repo has eslint+prettier+turbo.json but no commit hooks visible in `extension-wallet/`).
6. **Test placement convention.** Nulo enforces colocated `foo.test.ts` next to `foo.ts` with no `__tests__/` dirs (CLAUDE.md). Grego's `extension-wallet/` actually does the same (`port.test.ts`, `kdf.test.ts`, `vault-state.test.ts` are colocated), so this is parity, not betterness.
7. **Chrome+Firefox build matrix from one source.** Both wallets support this — Grego via WXT's `wxt -b firefox`, Nulo via its build scripts. Parity.
8. **Vue component test conventions** (CLAUDE.md M6 layer model). Nulo's L0–L6 enforced layers + composables policy is more rigorous than what `extension-wallet/` has: Popup.tsx is one big file with TODO blocks for design-not-yet-finalised. That's pragmatic for Grego ("ship the architecture, design later") but Nulo's stricter component model is better for long-term maintenance.
9. **Multi-network support via `@nulo/aztec-runtime`.** Grego's `WalletHost` carries one `currentChainInfo` mutated by `network.set`; concurrent multi-network operation depends on the shared session map but the offscreen-side `WalletHost` itself is single-network. Nulo's runtime is designed multi-network from the start.
10. **`@aztec/accounts/schnorr` adapter pattern** (Nulo's `NuloAccount`, per CLAUDE.md). Grego uses `SchnorrAccountContract` directly with `Fq.fromBuffer(signingKey)` and lets `AccountManager.create` do the rest. Nulo's adapter approach with explicit `DefaultAccountEntrypoint` + `DefaultMultiCallEntrypoint` + recursive >5-call chunking gives Nulo more control over multi-call semantics. Not strictly "better", but more explicit.

---

## 14. Trade-offs

Where Grego deliberately keeps things simple:

1. **One offscreen, one PortServer, one VaultState.** No service partitioning. Works well at this scale (28 files); would need refactor at 10x.
2. **One mutable `currentChainInfo` field on WalletHost.** No multi-network UI concurrency story — flipping networks in the popup affects all UI surfaces. Could break if the user has the popup on Network A and the expanded view on Network B simultaneously. Not a bug Grego has noted, but a real edge case.
3. **The `Popup.tsx` TODO blocks** (lines 133-156, 194-213, 245-260). Honest scaffold-grade UX. Will need design polish before any real release.
4. **No service worker state machine.** The SW is a router; that's the entire model. No retry logic, no queue persistence — if the SW gets killed mid-flight, in-flight calls just lose. The keep-alive ports help, but extreme idle scenarios (Chrome's MV3 timeout is 30s) could still bite.
5. **No tx history.** Whatever WalletDB tracks (`interactions` map at `wallet-db.ts:53`) is the only history surface. No UI yet for browsing past txs in the popup. Expanded view inherits whatever shared/ui ships.
6. **No notification API.** `chrome.notifications` is not requested in permissions. Background events (e.g. "tx confirmed") can't reach the user when the popup is closed.
7. **No periodic auto-update polling.** The wallet is push-only via the SDK's session events. Probably fine, but means the user only sees updates while a UI surface is open and connected.
8. **No multi-account-per-app scoping.** `getOrCreateSession(chainInfo, appId, ...)` keys by `appId`, but there's only one logical wallet per appId. Grego's UX doesn't currently expose "use account X for dApp A but account Y for dApp B".

Where scale would hurt:
- Adding new RPC namespaces requires touching `wallet-host.ts` directly (no plugin system).
- The schema-key enumeration trick assumes the schemas are known at build time. If you wanted to add user-pluggable methods, you'd need a different pattern.
- `chrome.windows.onRemoved` global listener for the approval queue (`approval-window.ts:6-13`) — works at one window, scales poorly if you ever wanted parallel approvals.
- The shared `pendingAuthorizations` map per-session iterating in `authorization.resolve` is O(N sessions × M pending). Fine at small N, wasteful at large N.

These are all "would refactor at 10x scale" concerns, not "broken today" concerns. Grego's design is well-suited to the current scope.

---

## Bottom line for Nulo

Five ranked takeaways:

1. **Steal the IPC layer wholesale.** Grego's single-port, Zod-discriminated-union, JSON-fallback design (`src/ipc/`) is ~250 lines including tests and replaces a lot of Nulo's `extension-messaging` framework. Specific files: `port-envelope.ts:1-54`, `port-server.ts:1-114`, `port-client.ts:1-123`. The `jsonStringify` fallback at `port-server.ts:46-88` is the single highest-leverage line of code in the whole package.
2. **Steal the offscreen ready-gate and Firefox fallback.** Both at `src/background/offscreen-lifecycle.ts:18-85`. ~70 lines. Eliminates a class of races and adds Firefox support for free.
3. **Steal the production CSP/polyfill workarounds.** `wxt.config.ts:12-44` (nodePolyfills + define), `src/shared/function-bind-stub.cjs` (six lines), `src/shared/polyfills.ts` (Buffer global). Even if Nulo doesn't currently hit the bugs, these are insurance against transitive-dep updates.
4. **Match Grego's deliberate `NO_FROM` and `embeddedPaymentMethodFeePayer` UX.** `AuthorizeSendTxContent.tsx:36-86`. Distinct chips and alerts for "external entrypoint" and "app pays fee" flows. Without these, Nulo silently allows kernel-less / dApp-paymaster txs without the user knowing.
5. **The plaintext-secrets caveat is Nulo's biggest win.** `wallet-db.ts:145` writes account secrets in plaintext. Nulo's `PasswordSecretBox` actually encrypts them. This is the headline differentiator and Grego is upfront about it being deferred.

## Aztec-specific recommendations

Patterns from Grego (mostly via `shared/`) that Nulo should adopt or verify it already has:

1. **One PXE per (chainId, version) session** keyed in a module-scoped Map (`shared/src/wallet/session/session.ts:134,140-243`). The comment at line 7 — "multiple PXE instances sharing the same IndexedDB store cause Map/storage desync" — is a real Aztec footgun. If Nulo creates more than one PXE per network, this is a latent bug.
2. **Use `@aztec/pxe/client/lazy`** (`session.ts:34`) — lazy artifact loading is right for browser/extension contexts.
3. **Namespace PXE store by L1 rollup address** (`session.ts:73,77,87-95`). `dataDirectory: pxe-${rollupAddress}`. Means rollup upgrades create fresh data dirs and don't accidentally migrate stale state.
4. **Auto-detect `version: 0`** by calling `node.getNodeInfo().rollupVersion` (`session.ts:163-172`). Defensive narrowing because `rollupVersion`'s shape varies across Aztec SDK versions.
5. **Stub-account simulation pattern** (`demo-wallet.ts:172-215`). For each `from` address, build a `createStubSchnorrAccount(completeAddress)` and simulate via the stub — real signing key never enters the simulation path.
6. **`DefaultEntrypoint` for `NO_FROM` flows** (`demo-wallet.ts:190-195`). When there's no account, use the kernel-less path directly.
7. **Simulate → collect authwits → merge → prove pipeline** (`internal-wallet.ts:181-198`):
   ```ts
   const offchainEffects = collectOffchainEffects(simulationResult.privateExecutionResult);
   const authWitnesses = await Promise.all(offchainEffects.map(async (effect) => {
     try {
       const authRequest = await CallAuthorizationRequest.fromFields(effect.data);
       return this.createAuthWit(authRequest.onBehalfOf, { consumer, innerHash });
     } catch { return undefined; }
   }));
   ```
   Canonical. Nulo should verify it has this exact shape.
8. **`forEstimation: true` flag on `completeFeeOptions`** (`internal-wallet.ts:162-167`) so simulation gas limits are permissive and the real send uses the simulated estimate. Single source of truth for gas policy.
9. **`registerSender` in WalletDB *and* PXE, with auto-re-register on list** (`demo-wallet.ts:233-242`). Keeps WalletDB and PXE in sync without manual reconciliation.
10. **Use the wallet-sdk's `BaseWallet` as the base class** for your `ExternalWallet`/`InternalWallet`. Grego's `DemoWallet extends BaseWallet` (`demo-wallet.ts:51`). Nulo currently has its own service hierarchy — verify whether `BaseWallet` would let you delete code.
11. **`@aztec/foundation/json-rpc`'s `jsonStringify`** for any IPC fallback. Handles BigInt, Buffer, Map/Set, `toJSON()`. Same wire format wallet-sdk uses internally.
12. **`hashToEmoji` from `@aztec/wallet-sdk/crypto`** (`Popup.tsx:3,172`) for verifying ECDH handshake hash. Nulo should use this for dApp-session verification UX rather than rolling its own.
13. **The `verificationHash` → emoji UI flow** (`Popup.tsx:131-187`). User-side handshake-integrity check. Cheap to add, real security signal.
