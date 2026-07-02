# Architecture

How Nulo Wallet is wired. Companion to per-package READMEs (which cover surface area inside one package) and to [`CLAUDE.md`](./CLAUDE.md) (operating rules, not architecture).

## 1. Process boundaries

A running extension lives in four browser contexts:

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                   chrome runtime (MV3)                          │
   │                                                                 │
   │  ┌──────────────────┐        ┌────────────────────────────────┐ │
   │  │  Service Worker  │ ◄──────┤  Popup UI (Vue 3)              │ │
   │  │  (background)    │        │  apps/extension/src/popup/ │ │
   │  │  src/wallet/     │        └────────────────────────────────┘ │
   │  └─────────┬────────┘                                           │
   │            │ chrome.runtime.connect / chrome.runtime.sendMessage│
   │            │                                                    │
   │  ┌─────────▼──────────────┐    ┌─────────────────────────────┐  │
   │  │  Offscreen document    │    │  Content script             │  │
   │  │  (PXE host)            │    │  src/content-script/        │  │
   │  │  src/offscreen/        │    │  Injects in-page bridge for │  │
   │  │  Runs Aztec PXE inside │    │  dApp discovery + RPC.      │  │
   │  │  hidden window/document│    └──────────┬──────────────────┘  │
   │  └────────────────────────┘               │ window.postMessage  │
   │                                           ▼                     │
   └─────────────────────────────────────┐  ┌─────────────────────┐  │
                                         │  │   dApp web page     │  │
                                         │  │  @aztec/wallet-sdk  │  │
                                         │  └─────────────────────┘  │
                                         └───────────────────────────┘
```

Entry points:

| Context | File | Owns |
|---|---|---|
| Service Worker | `apps/extension/src/wallet/index.ts` | Every background service; storage; the wallet-sdk dispatcher. |
| Popup UI | `apps/extension/src/popup/index.ts` | Vue 3 app; Pinia stores; service-clients. |
| Content Script | `apps/extension/src/content-script/content.ts` | dApp bridge — postMessage ↔ runtime. |
| Offscreen | `apps/extension/src/offscreen/index.ts` | PXE; protocol-contract artifacts; key derivation that needs full WebCrypto. |

## 2. Package layer hierarchy

Each package can import only the layers below it. Enforced via biome `noRestrictedImports` overrides (see `biome.json`); violations fail `bun run lint`.

```
wallet-core         (foundation; pure ports + types; NO chrome.*)
  ↑
wallet-crypto       (KDF + encryption; depends on wallet-core)
  ↑
extension-messaging (RPC plumbing; depends on wallet-core)
  ↑
aztec-runtime       (PXE + account; depends on wallet-core + extension-messaging)
  ↑
wallet-bridge       (wallet-sdk dispatcher; depends on wallet-core + extension-messaging — NOT aztec-runtime)
  ↑
extension           (sink; can import anything below)
```

`wallet-bridge` deliberately does NOT depend on `aztec-runtime`: the bridge is transport-shaped (dispatching protocol messages to typed service calls), not chain-shaped. Keeping it Aztec-runtime-free is what allows the dispatcher to live in the service worker and the PXE to live in the offscreen document.

Inside `@nulo/extension`, additional rules enforce the L0–L6 component model (see [`CLAUDE.md`](./CLAUDE.md) for the layer rules).

## 3. Message flow — Service / ServiceClient / OffscreenService

Background services and the popup talk over a typed RPC layer defined in `@nulo/extension-messaging`:

```
POPUP (Vue UI)                        BACKGROUND (Service Worker)
ServiceClient<Methods, Events>   ←→   Service<Methods, Events>
   chrome.runtime.connect()           ports.get(name).onMessage
   RequestMessage / ResponseMessage   replies via the same port
   EventMessage (subscriptions)
```

Base classes:

- `packages/extension-messaging/src/background/service.ts` — server-side base.
- `packages/extension-messaging/src/background/client.ts` — client-side base.
- `packages/extension-messaging/src/messages.ts` — wire schema.

For the service worker → offscreen direction, the same pattern repeats with `OffscreenService` / its client (`packages/extension-messaging/src/offscreen/`) on top of `chrome.runtime.sendMessage`. The offscreen-side telemetry sidecar tracks per-request lifecycle so terminal-state events fire even when ports drop.

`Error` instances are reconstructed across the wire — comparing error messages on the client must use `err instanceof Error && err.message === "..."`, not `err === "..."`.

## 4. State surface

- **Background services** hold authoritative state and emit `EventHandler` events. The popup pulls current state on mount via service-client method calls and subscribes to relevant events.
- **Pinia stores** in the popup (`apps/extension/src/stores/`) cache visible state (`appStore`, `popupStore`, `cacheStore`). They are not the source of truth — services are.
- **`chrome.storage.local`** holds persistent records (profiles, networks, FPCs, accounts, contacts, tokens, dApp sessions). Entity rows are keyed `${root}@${id}`.
- **`chrome.storage.session`** holds the active `Session` mirror AND the in-flight operation journal — both survive SW suspensions but are cleared when the browser session ends. The journal stores `nulo:journal@<id>` records via `OperationJournalService` (`apps/extension/src/wallet/services/operation-journal/service.ts`); stale ops after a browser reboot aren't actionable, so this is the right tier.
- **Operation journal model** (Phase 2 + Phase 2.5). Every long-running operation creates a record with a 7-stage FSM (`pending → simulating → proving → submitting → succeeded/failed/cancelled`, plus a `simulating → succeeded` no-prove shortcut for non-tx kinds). Three kinds today: `transfer`, `dapp_execute` (full FSM + on-chain `txHash`), `token_import` (no-prove shortcut, no `txHash`). The kind ↔ `txHash` invariant is enforced at `transitionOperation`. Sibling `JournalReaper` marks stuck non-terminal records as failed; `JournalGC` caps terminal records at 50 per `(profileId, accountAddress)` on a 60-min alarm. Activity feed renders one card per in-flight journal op (newest on top, older below); token-import surface is a sibling `TokenImportRow` in the tokens view. The substrate is intentionally extensible — adding a new kind requires adding the enum variant + the `kind ↔ txHash` branch + a renderer; the FSM table stays unchanged.
- **PXE** writes its own IndexedDB under the offscreen document (`pxe/...` databases). The wipe migration nukes these on storage-version bumps.

## 5. Storage versioning + destructive migration

`apps/extension/src/wallet/storage/migrate.ts` runs on first unlock after the SW boots. It compares the stored `nulo:core:storage-version` against `CURRENT_VERSION` (currently 9 — `v8` for the Aztec 5.0.0-rc.1 hard fork, where account/contract address derivation + the Schnorr scheme changed; `v9` for the rc.2 testnet redeploy, where the rollupVersion/derived chainId moved and every contract class-id shifted. Both wipe stored accounts/balances/PXE DBs; users re-register). If the version is older, the migration:

1. Wipes a known set of `KEYS_TO_WIPE` and `KEY_PREFIXES_TO_WIPE_LOCAL` / `_SESSION`.
2. Deletes PXE IndexedDB databases (`pxe/...` prefix + `keyval-store`).
3. Writes the new version key.

The wallet has no production users, so each version bump is a destructive wipe — `getOrInitNetworks()` and friends reseed defaults on next access. Pre-0.11.0 wallets are not migratable.

Wipe scope per version is documented at the top of `migrate.ts`. When bumping `CURRENT_VERSION`, add a paragraph to that doc block explaining the schema change and what gets wiped.

**Per-row storage resilience** (Phase 2+ Bundle 1). `EntityStorage` (`packages/wallet-core/src/storage/entity_storage.ts`) wraps every `JSON.parse` in a per-row try/catch: a byte-malformed row used to throw and poison every reader of the namespace; now bad rows are logged with a truncated payload preview, deleted, and skipped from iteration. The journal service layers on top with `OperationRecordSchema.safeParse` in a `_loadValidated` helper — schema-invalid records get the same drop-and-skip treatment so downstream FSM code never sees a malformed record.

## 6. Offscreen lifecycle

The offscreen document hosts the Aztec PXE. The service worker creates and supervises it via `apps/extension/src/wallet/utils/offscreen.ts`:

- `ensureOffscreenRunning()` is the entry point. It first checks `isOffscreenAlreadyRunning()` (Chromium: `chrome.runtime.getContexts`; Firefox: a module-local `firefoxOffscreenWindowId`).
- If a document exists, it pings it via `isOffscreenHealthy()`. A non-responsive ("zombie") offscreen is torn down and recreated.
- A creation in flight is shared — concurrent callers all await the same `offscreenPromise`. A `READY_TIMEOUT_MS` watchdog converts a stuck create into a thrown error.

Firefox MV3 has no `chrome.offscreen` API, so the implementation falls back to a hidden `chrome.windows` window. SW restart on Firefox resets the in-memory tracker; rediscovery would require a `tabs` permission, which the manifest deliberately avoids. The trade-off is documented in `offscreen.ts`.

## 7. Profile + session model

Two profile types: **password** and **passkey**. Each uses a different derivation chain (see `@nulo/wallet-crypto`) to produce the same master-secret shape; downstream code is agnostic.

`SessionManager` (`apps/extension/src/wallet/services/profile/session-manager.ts`) owns the in-memory `ActiveSession` and its persisted `Session` mirror in `chrome.storage.session`. Properties:

- **Session storage** survives MV3 service-worker suspensions but is cleared when the browser session ends. The popup can reconnect mid-session without re-prompting.
- **In-memory only**: the raw master secret (`Fr`). Never persisted.
- **`restore()` runs once at init** — silently re-hydrates the session, never emits `onActiveProfileChanged`. Subscribers pull via `getActive()` at mount.
- **TTL-aware**: `since + ttl` past → silent drop, storage cleaned.
- **Wrong credentials / corrupted ciphertext** → silent close, same as TTL.
- **Lock-agnostic**: SessionManager performs no locking of its own. Callers (the `ProfileService` facade) serialize via its lock.

Strict security mode (default ON) prevents the passhash bearer from ever being persisted to `chrome.storage.session`. With strict mode ON, any SW recycle (Chrome's idle-suspend within the same browser session, a full browser close, or an explicit kill) forces a fresh password unlock — the session restore short-circuits because there is no bearer to silently re-derive the master secret from. See `apps/extension/tests/e2e/sw-resilience.test.ts` for the SW-stop-and-respawn coverage.

A **late-activation** pattern is used for full-backup restore: `ProfileService.restore()` writes the profile and stashes the recovered secret in a `pendingRestoreSecrets` map without opening a session. The caller restores backup data, then calls `finalizeRestore()` which opens the session. This avoids racing `app.vue`'s `onActiveProfileChanged → ensureDefaultAccount` against the import's writes.

## 8. dApp session + capability surface

dApps interact via `@aztec/wallet-sdk` over a postMessage-bridged encrypted channel. Wiring lives in:

- `apps/extension/src/wallet/services/wallet-sdk/background.ts` — sets up `BackgroundConnectionHandler` from the SDK. Owns discovery, key exchange, message routing.
- `packages/wallet-bridge/src/dispatcher.ts` — the typed dispatcher. Receives wallet messages, narrows protocol shapes via Zod, enforces session scope, and delegates to typed service calls.
- `packages/wallet-bridge/src/capability-map.ts` — declarative map of every capability the wallet exposes (~17 RPCs + 4 special). Determines which RPCs need user approval vs auto-approve, which open a popup vs run silently.
- `packages/wallet-bridge/src/scope-enforcement.ts` — re-checks per-message scope against the granted session (call-intent targets, fee-payer constraints, chainId, accounts).

A `DappSession` is per-`(origin, chainId, profileId)`. When the dApp's profile or chain changes, the session is revoked and re-approval is required. Auto-approve runs when an active session matches the discovery request.

Capability *bundles* — the playground's helper concept for grouping capabilities into a single approval gesture — are a test-harness construct and live in `apps/playground/`. The wallet does not model bundles internally; they are sugar over `requestCapabilities`.

## 9. Concurrency model

Two primitives:

- **`Lock`** (`apps/extension/src/wallet/utils/lock.ts`) — single-flight queue per service. Methods that mutate service state acquire the lock; readers and writers serialize behind it. Includes a `MAX_HOLD_MS` force-release to avoid deadlocks.
- **`ReadWriteGuard`** (`packages/wallet-core/src/utils/rw-guard.ts`) — multi-reader / single-writer guard. `read(fn)` runs in parallel with other reads; `write(fn)` drains readers, then runs exclusively. Manual `enterWrite()` / `leaveWrite()` for destructive ops that span multiple awaits (profile switch / delete). Writers have FIFO priority — a reader arriving while a writer is queued waits behind that writer. Force-release at `MAX_READER_DRAIN_MS` is a debuggability aid, not a correctness path.

Service startup is **phase-ordered**, not parallel: `ServiceCollection.start()` (`packages/wallet-core/src/base/index.ts`) runs services in topological phases derived from each service's `dependencies` array. Phase 0 runs everything with no declared deps in parallel; each subsequent phase awaits the previous. Cycles and unknown deps throw named errors at boot.

## 10. Auth + crypto model

`@nulo/wallet-crypto` owns every security-critical derivation:

- `EncryptionKey` — PBKDF2 + AES-GCM framed ciphertext.
- `PasswordSecretBox` — password-based wrap around `EncryptionKey`. Stores `passhash` (a public, deterministic hash of the password's KDF output) so a session can be silently re-derived without re-prompting.
- `PasskeyCredential` — WebAuthn PRF → HKDF master-secret. Cross-extension / cross-device portability is limited by browser PRF non-portability (see `implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md`).

All derivation chains are **vector-locked** by `apps/extension/src/wallet/crypto/key-vectors.test.ts`. Any change to wallet-crypto must keep those vectors passing byte-identically. The KDF rev-key (`ENCRYPTION_GUARD`) is a frozen constant: changing it bricks every existing wallet.

Buffer ownership is explicit. Secret material is allocated as `Uint8Array<ArrayBuffer>` (never `Buffer`), zeroed on drop via the `zeroize()` helper.

## 11. Account contract

The wallet uses the upstream `@aztec/accounts/schnorr` account contract — there is no custom Noir source in this repo. A thin adapter (`packages/aztec-runtime/src/account/nulo-account.ts`, class `NuloAccount`) wraps it:

- Derives the Schnorr signing key via upstream `deriveSigningKey(secret)` (currently uses `DomainSeparator.IVSK_M`; upstream has an open TODO to replace this — see `AztecProtocol/aztec-packages#5837`).
- Uses `DefaultAccountEntrypoint` for app-payload encoding and authwit signing.
- Uses `DefaultMultiCallEntrypoint` for first-tx initialization wrapping (`ctor + app` payload via the protocol `MULTI_CALL_ENTRYPOINT_ADDRESS`).
- Recursively chunks payloads with more than 5 calls: each chunk is wrapped through `entrypoint.wrapExecutionPayload()` so every nesting layer gets its own outer-authwit hash.
- Pins the instantiation salt to `Fr.ZERO` for deterministic address recreation from seed + index.

The on-chain class is whatever `SchnorrAccountContractArtifact` maps to in the pinned `@aztec/accounts` release.

## 12. Fee-payment model

The wallet supports three fee-payment shapes:

- **Native fee** — user pays in the network's native fee asset.
- **Sponsored** — a configured Sponsored FPC address pays. Address is editable in settings.
- **FPC** — a fee-paying contract pays in a registered fee asset.

Fee-method selection persists per `(profileId, networkId, accountAddress)`. A storage migration drops the saved selection when the FPC schema changes so a dangling FPC id from a pre-v4 record cannot resolve to a stale handler.

The private-cold-start fee-payment path (private mint + pay-fee combined for an uninitialized account) is not yet wired. The gap is tracked separately; tests that depend on it remain skipped.

## 13. Build artifacts

`bun run build` produces a Chrome MV3 bundle at `apps/extension/dist/chrome/`. `bun run build:firefox` produces a Firefox MV3 bundle at `dist/firefox/`. Manifests are configured per-target in `apps/extension/manifest/`; the Firefox manifest drops the `offscreen` permission (no Chromium offscreen API) and substitutes a hidden-window strategy.

Vite env propagation: e2e network suites pass `VITE_LOCAL_NETWORK_RPC_URL=http://localhost:<aztec-port>` so the wallet's "Local Network" preset points at the per-worktree sandbox. The build wrapper greps the bundle for the URL and fails fast if the env didn't substitute.

`noExplicitAny` is enforced as a biome error. Use `unknown` and cast at usage sites; suppress with `// biome-ignore lint/suspicious/noExplicitAny: <reason>` only for genuinely untyped boundaries (the `MethodsMap` constraint in `wallet-core/base` is the canonical example).

## 14. Test taxonomy

| Suite | Config | Scope | Aztec sandbox? |
|---|---|---|---|
| Unit | Per-package: `wallet-core`, `wallet-crypto`, `extension-messaging`, `extension` ship a `vitest.config.ts`; `wallet-bridge` and `aztec-runtime` run on the default vitest config. | Colocated `*.test.ts`. Pure logic, mocks via `@webext-core/fake-browser`, `FakeBrowserApi` from `wallet-core/testing`. | No. |
| Component | `apps/extension/vitest.config.ts` (filtered via `bun run test:components`) | Vue SFC tests via `@vue/test-utils`. `chrome.*` stubbed by `tests/vitest.setup.ts:88-113`. | No. |
| Smoke e2e | `apps/extension/vitest.e2e.config.ts` | `tests/e2e/*.test.ts` — popup UI flows. | No. |
| Network e2e | `apps/extension/vitest.e2e.network.config.ts` | `tests/e2e/network/**` — drives the playground dApp against a real anvil + aztec sandbox. | Yes (per worktree). |
| Full e2e | `apps/extension/vitest.e2e.all.config.ts` | Smoke + network. | Yes. |

Run commands:

```bash
bun run test                  # Unit + component (vitest)
bun run test:e2e              # Smoke
bun run e2e:agent             # Network — parallel-safe per worktree
bun run audit:vue             # One-shot pre-PR: typecheck → test → lint → build
```

`bun run audit:vue` deliberately **excludes** e2e tests — that gate is for fast, isolated correctness. Smoke e2e is a separate command; network e2e is its own infrastructure (see [`apps/extension/tests/e2e/README.md`](./apps/extension/tests/e2e/README.md) for the parallel-safe agent runner, port allocation, and reuse-vs-cold-start logic).

Coverage minimums for component / composable tests, the `chrome.*` stubbing, and the e2e helper conventions all live in [`CLAUDE.md`](./CLAUDE.md).
