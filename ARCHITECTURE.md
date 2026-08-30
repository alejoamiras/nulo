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
- **`chrome.storage.session`** holds the active `Session` mirror — survives SW suspensions, cleared when the browser session ends.
- **The operation journal lives in `chrome.storage.local`** (`nulo:journal@<id>` via `OperationJournalService`, `apps/extension/src/wallet/services/operation-journal/service.ts`). It originally used session storage ("stale ops post-reboot aren't actionable"), but terminal records ARE the user's history — the browser-exit wipe was erasing failed/cancelled history users expected to keep, so the durability tier changed (2026-06-05). The reaper still fails surviving non-terminal records on SW restart.
- **Operation journal model** (Phase 2 + Phase 2.5). Every long-running operation creates a record with a 7-stage FSM (`pending → simulating → proving → submitting → succeeded/failed/cancelled`, plus a `simulating → succeeded` no-prove shortcut for non-tx kinds). Three kinds today: `transfer`, `dapp_execute` (full FSM + on-chain `txHash`), `token_import` (no-prove shortcut, no `txHash`). The kind ↔ `txHash` invariant is enforced at `transitionOperation`. Sibling `JournalReaper` marks stuck non-terminal records as failed; `JournalGC` caps terminal records at 50 per `(profileId, accountAddress)` on a 60-min alarm. Activity feed renders one card per in-flight journal op (newest on top, older below); token-import surface is a sibling `TokenImportRow` in the tokens view. The substrate is intentionally extensible — adding a new kind requires adding the enum variant + the `kind ↔ txHash` branch + a renderer; the FSM table stays unchanged.
- **Price feed** (`PriceService`, `apps/extension/src/wallet/services/price/`): USD quotes for a STATIC (chainId, contract) → CoinGecko-id map (`price-map.ts` — Aztec-native assets proxy to Ethereum tickers: cUSD → USDC, Fee Juice → AZTEC). One batched keyless request for the full id set (never holdings-derived), only while a profile session is unlocked (3-min alarm dispatched from a module-scope listener in `wallet/index.ts`; cleared on lock). Quotes validate against per-id sanity bands at write AND read, expire after 15 min vs min(local, provider) timestamps, and are served through the single `getUsableQuote` path — executors read cache-or-nothing (no fetch is ever triggered by transaction activity). `Config.showFiatValues` is the kill-switch (Settings → Appearance): off aborts in-flight fetches (generation counter), clears the alarm + cache, and hides every fiat surface. No price means the fiat element is ABSENT — never a fake $0.00. Not exposed to dApps (pinned by test).
- **Token-balance rows** (`TokenBalanceService`, `apps/extension/src/wallet/services/token-balance/`): one row per `(token, account)` pair, created by the `onAccountAdded` / `onTokenAdded` handlers and read by the assets view filtered to the ACTIVE account — so a token with no row is invisible, and one stuck at `updatedAt === 0` renders as a permanent "Loading balance…". Both states are what an MV3 worker death inside `createTokenBalance` leaves behind (before `repo.set`, or after it and before `enqueue`). A **create-only reconcile** runs at the tail of `init()` and of `onActiveProfileChanged`: one `getAccountsRaw(profileId)` + one `repo.getAll()`, diffed by the pure `reconcile-pairs.ts`, creating missing pairs and re-queueing never-projected rows. Create-only is deliberate — an unexplained row may belong to another profile, may precede its token during a restore, or may be inside a draining chain purge, and the row schema carries neither profile nor chain to tell them apart. **Every path that allocates a row id holds one service-level `Lock` constructed with `maxHoldMs: null`** (both live handlers, both sweeps, `restore()`'s batch, and both deletion paths — `onTokenDeleted` and `purgeForTokens`, which do not allocate but must not interleave with a creation): allocation is `max+1` over the live key space and event subscribers dispatch un-awaited, so unserialized creators compute the same id and the later write silently overwrites. `restore()` shares the lock but NOT the ensure path — full-backup slices land before profile activation, so their token ids are absent from the active map by design. The root enables `requireKeyIdentityMatch` in `"numeric"` mode; the mode is load-bearing, since the default `"string"` mode would reject every numeric-id row.
- **Default-token seeding** (`TokenSeeder` + `default-tokens.ts`, `apps/extension/src/wallet/services/token/`): on unlock, active-network change, **and account creation**, missing entries from the built-in seed list are added through a single-pass validated snapshot — register-free instance read → pinned `currentContractClassId` + address check → one metadata simulation → bounds/symbol pins → `addSeededToken` persists THAT exact snapshot (journal `origin: "seed"`, "Default token"). Markers under `nulo:core:token-seeded@<profileId>` carry attempt caps (3, refreshed once per extension version) and user-deletion tombstones that SURVIVE chain purges — deleting a default then re-adding the network does not resurrect it. Seed pins are captured by `apps/extension/scripts/seed-preflight.ts`; re-run it on network resets. **All three triggers are load-bearing:** the profile- and network-change ones both fire before a chain's first account row exists (the popup creates networks, then accounts — `useProfileBootstrap`, and `network-switch.ts` on a switch to an account-less chain), so without the account trigger a fresh profile's seeds skip at the zero-accounts guard and nothing re-runs them. The seed list itself is resolved once per pass via `TokenSeederDeps.getSeeds()`; armed e2e builds swap in a `chrome.storage.session`-backed list that REPLACES the shipped one (see the extension's e2e README).
- **PXE** writes its own IndexedDB under the offscreen document (`pxe/...` databases). PXE state is OUTSIDE the storage-migration framework's scope — it is Aztec-owned and rebuilt on protocol resets, not field-migrated.

## 5. Storage versioning + data-preserving migration

When a release changes the shape of a persisted `chrome.storage.local` record (add / rename / remove a field, restructure), existing users' data is **transformed in place by a numbered migration — never wiped**. (The pre-launch wipe-on-bump model and its `migrate.ts` are gone; the wallet launched its current shape as **schema v1**.)

**The engine** — `@nulo/wallet-core/migration` (pure, `chrome.*`-free, fully unit-tested) — applies migrations where `version > persisted nulo:schema:version`, each under a crash-safe journal:

1. Set the durable `nulo:schema:running` marker (doubles as the UI barrier, below).
2. Snapshot the migration's **declared footprint** into a single-key atomic backup.
3. Run `up(ctx)` — writes accumulate in a staging buffer (read-your-writes), never mid-migration.
4. Commit the staged diff, stamp `nulo:schema:version = N` (per-migration checkpoint), clear the journal.

A throw never advances the version; the next boot **restores the backup, then retries** (a durable, footprint-excluded attempt counter bounds retries). Interrupted boots converge: `running` + valid backup ⇒ restore-then-rerun; `running` without a backup ⇒ the crash predated any write. The marker decision table fails closed: a corrupt/out-of-range version — or the legacy `nulo:core:storage-version` key without a schema version — refuses to guess (`needs-recovery`), never init-and-skip. Fresh installs stamp the max version and run nothing.

**Pre-production rule**: while the wallet has no production users, shape changes do NOT get migrations — the launch baseline absorbs them and devs reinstall fresh (see CLAUDE.md § Persisted-storage shape changes for the full rule and its flip-at-launch).

**The registry** — `apps/extension/src/wallet/storage/migrations/` (baseline v1; copy `template.ts` to add `NNN-*.ts`, declare the exact read/write footprint, keep `up` idempotent — the harness runs every migration twice — and set `breaking: false` only if the new code genuinely tolerates the old shape). The migrator runs in `runtime.ts` as the FIRST storage action — before `config.load()`, so a config-reshaping migration can't be shadowed by an already-loaded config.

**Failure UX**: a breaking failure (or `needs-recovery`) persists `nulo:schema:blocked` and refuses to start services — `MigrationBarrier.vue` (both shells) renders a funds-are-safe recovery screen. An additive failure persists `nulo:schema:degraded` and boots with a dismissible warning. Healthy boots clear both.

**The UI barrier**: popup/onboarding pages are separate JS contexts that read `chrome.storage.local` outside the SW, so a page opened mid-migration could read a pre-migration row and write the old shape back. ALL UI storage access goes through the migration-aware facade (`apps/extension/src/utils/storage.ts`), which blocks on the `running` marker; `storage-facade-ban.test.ts` statically enforces that no raw `chrome.storage.local` access exists outside the allowlist. The barrier engages only on the rare boot right after an update that ships a migration.

**What migrations do NOT cover**: crypto/KDF/vector rotations — the migrator runs pre-unlock and has no password to re-encrypt with (see `packages/wallet-crypto/README.md`); those are re-encrypt-on-next-unlock or a documented reset. PXE IndexedDB — protocol-reset concern, out of scope. `chrome.storage.session` — ephemeral, can't be tracked by a durable version.

**Backup-import migration** — `apps/extension/src/wallet/services/backup/` (see its README for the full contract). When a full backup exported at an OLDER `backup-schema-version` is imported, its slices are migrated forward BEFORE the service-by-service restore: normalize slices into an in-memory scratch store in the exact live key/value format (the pinned `BACKUP_SLICE_REGISTRY` maps `serviceName → root/value descriptor`), seed `nulo:schema:version` from the blob, run the REAL `Migrator` over the same `realMigrations` the live boot applies, denormalize back into slices. Pure + in-memory: a failure rejects the import with zero live state touched. Only migrations authored in the **backup-safe declarative form** (`defineRowMapMigration` — a finite data-only DSL: `rename`/`drop`/`retype`/`remapValues`/`addDefault`, structurally row-local, WeakSet-branded + frozen) can run over a backup; an imperative `defineMigration` in range BLOCKS import with a re-export message, as do migrations touching the block-listed roots (`nulo:core:profiles`, `nulo:core:auth-registry-enabled`). Trust gates in `useFullBackupImport`: checksum over the ORIGINAL body first, then the non-migratable `compat-epoch`, then the `backup-schema-version` range — never a recomputed post-migration checksum. Guardrails: `footprint-coverage.test.ts` (registry coverage + metamorphic per-row invariance + the `IMPORT_BLOCKING_ACK` explicit-release-decision chokepoint) and the registry/migrator unit suites.

**E2E proof**: a build-stamped fixture migration (`VITE_NULO_E2E_MIGRATION_FIXTURE=1`, tree-shaken from prod builds and grep-guarded in `_build-extension.yml`) drives real cold boots in `tests/e2e/migration.test.ts` — transform+checkpoint, fail-closed→recovery→retry, the mid-flight barrier, and crash-mid-migration convergence. The same stamp arms a DECLARATIVE backup fixture (v9001, contact field-rename) that `tests/e2e/backup-migration.test.ts` drives through the real import UI (smoke) and `tests/e2e/network/backup-migration-roundtrip.test.ts` proves on-chain functional (network) — every future real backup-schema migration inherits this coverage.

**Per-row storage resilience** (Phase 2+ Bundle 1). `EntityStorage` (`packages/wallet-core/src/storage/entity_storage.ts`) wraps every `JSON.parse` in a per-row try/catch: a byte-malformed row used to throw and poison every reader of the namespace; now bad rows are logged with a truncated payload preview, deleted, and skipped from iteration. (Migration reads are the deliberate exception: the engine's `ctx` THROWS on a malformed row — fail-closed — rather than dropping it, since mid-migration the backup may be the only copy.) The journal service layers on top with `OperationRecordSchema.safeParse` in a `_loadValidated` helper — schema-invalid records get the same drop-and-skip treatment so downstream FSM code never sees a malformed record.

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

- **`Lock`** (`packages/wallet-core/src/utils/lock.ts`) — single-flight queue per service. Methods that mutate service state acquire the lock; readers and writers serialize behind it. Ownership-ticketed: `enter()` returns a per-grant `LockTicket` and `leave(ticket)` no-ops for anyone but the current owner, so the 5-minute force-release watchdog (there to avoid deadlocks; disable with `maxHoldMs: null` for by-design long holds) cannot let a displaced holder release its successor's turn.
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

Fee USD figures are priced at the LIVE AZTEC rate (1 FJ = 1 AZTEC) from the price feed — cache-or-nothing at estimate time; with no usable quote the USD figure is omitted (the pre-2026-07 hardcoded 0.02 rate is gone). Displays label the rate as "today's" (historical fees are valued at current spot).

Fee-method selection persists per `(profileId, networkId, accountAddress)`. A storage migration drops the saved selection when the FPC schema changes so a dangling FPC id from a pre-v4 record cannot resolve to a stale handler.

The private-cold-start fee-payment path (private mint + pay-fee combined for an uninitialized account) is not yet wired. The gap is tracked separately; tests that depend on it remain skipped.

## 13. Build artifacts

`bun run build` produces a Chrome MV3 bundle at `apps/extension/dist/chrome/`. `bun run build:firefox` produces a Firefox MV3 bundle at `dist/firefox/`. Manifests are configured per-target in `apps/extension/manifest/`; the Firefox manifest drops the `offscreen` permission (no Chromium offscreen API) and substitutes a hidden-window strategy.

Vite env propagation: e2e network suites pass `VITE_LOCAL_NETWORK_RPC_URL=http://localhost:<aztec-port>` so the wallet's "Local Network" preset points at the per-worktree sandbox. The build wrapper greps the bundle for the URL and fails fast if the env didn't substitute.

`noExplicitAny` is enforced as a biome error. Use `unknown` and cast at usage sites; suppress with `// biome-ignore lint/suspicious/noExplicitAny: <reason>` only for genuinely untyped boundaries (the `MethodsMap` constraint in `wallet-core/base` is the canonical example).

## 14. Test taxonomy

| Suite | Config | Scope | Runtime | Aztec sandbox? |
|---|---|---|---|---|
| Unit | Per-package `vitest.config.ts` in every workspace (`wallet-core`, `wallet-crypto`, `extension-messaging`, `design`, `bridge-core`, `extension`, `faucet`, and minimal explicit-`node` configs for `wallet-bridge`, `aztec-runtime`, `wallet-sdk-schema-patch`, `landing`); all spread `sharedTest` from the root `vitest.base.ts`. | Colocated `*.test.ts`. Pure logic, mocks via `@webext-core/fake-browser`, `FakeBrowserApi` from `wallet-core/testing`. | Bun (`bun --bun vitest run`) | No. |
| Component | `apps/extension/vitest.config.ts` (filtered via `bun run test:components`) | Vue SFC tests via `@vue/test-utils`. `chrome.*` stubbed by `tests/vitest.setup.ts:88-113`. | Bun | No. |
| Faucet jsdom smoke | `apps/faucet/vitest.e2e.config.ts` (`bun run --cwd apps/faucet test:e2e`) | In-process `App.vue` mount with a fake wallet provider — no browser. | Bun | No. |
| Smoke e2e | `apps/extension/vitest.e2e.config.ts` | `tests/e2e/*.test.ts` — popup UI flows. | Node (Puppeteer) | No. |
| Network e2e | `apps/extension/vitest.e2e.network.config.ts` | `tests/e2e/network/**` — drives the playground dApp against a real anvil + aztec sandbox. | Node (Puppeteer) | Yes (per worktree). |
| Full e2e | `apps/extension/vitest.e2e.all.config.ts` | Smoke + network. | Node (Puppeteer) | Yes. |

Run commands:

```bash
bun run test                  # Unit + component (vitest)
bun run test:e2e              # Smoke
bun run e2e:agent             # Network — parallel-safe per worktree
bun run audit:vue             # One-shot pre-PR: typecheck → test → lint → build
```

`bun run audit:vue` deliberately **excludes** e2e tests — that gate is for fast, isolated correctness. Smoke e2e is a separate command; network e2e is its own infrastructure (see [`apps/extension/tests/e2e/README.md`](./apps/extension/tests/e2e/README.md) for the parallel-safe agent runner, port allocation, and reuse-vs-cold-start logic).

Coverage minimums for component / composable tests, the `chrome.*` stubbing, and the e2e helper conventions all live in [`CLAUDE.md`](./CLAUDE.md).
