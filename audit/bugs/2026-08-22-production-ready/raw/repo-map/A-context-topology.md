# Map A — Process/context topology (extension)

> Mapper A (explore agent), 2026-08-22. Repo-relative paths. Note: returned output began mid-map (§1 + early phase-0 rows truncated in transit); coverage below is §2c onward.

## Service worker boot — service registration (phase order from `dependencies` arrays)

### Phase 0 (registration order, parallel start)

| # | Service | Registered | File | Purpose |
|---|---|---|---|---|
| 14 | `ProfileService` | `runtime.ts:247-248` | `wallet/services/profile/service.ts` | Profiles CRUD, unlock/lock, secret material, session TTL (passing `browserApi` activates SessionManager's proactive auto-lock — comment at `runtime.ts:242-246`), `pxeGeneration`, deletion tombstones |
| 15 | `TaskService` | `:275` | `wallet/services/task/service.ts` | Anchored long-running tasks (e.g. authwit-revoke steps) with typed statuses/results |
| 16 | `TokenService` | `:276` | `wallet/services/token/service.ts` | Token metadata registry per profile/chain |
| 17 | `TransactionService` | `:278` | `wallet/services/transaction/service.ts` | Transaction records, status transitions, tx events |
| 18 | `PasskeyService` | `:290` | `wallet/services/passkey/service.ts` | WebAuthn passkey ceremonies via `WindowManager` popups (5-min hard timeout, `passkey/service.ts:6-9`) |

(Phase-0 rows 1–13 were in the truncated head of the agent's reply; recoverable on demand from `runtime.ts` registration order.)

### Phase 1

| Service | Registered | Deps | File | Purpose |
|---|---|---|---|---|
| `ContactService` | `runtime.ts:222` | `[Profile]` (`contact/service.ts:35`) | `wallet/services/contact/service.ts` | Address book contacts (+ sender attribution via active networks) |
| `PriceService` | `:241` | `[Config, Profile]` (`price/service.ts:70`) | `wallet/services/price/service.ts` | USD quotes w/ TTL + clock-skew guards; deliberately absent from dApp dispatcher wiring |
| `TokenBalanceService` | `:277` | `[Profile, Token]` (`token-balance/service.ts:41`) | `wallet/services/token-balance/service.ts` | Cached balance rows + refresh projection |
| `AccountIntegrityCoordinator` | `:296` | `[Profile, Account]` (`account-integrity/coordinator.ts:43`) | `wallet/services/account-integrity/coordinator.ts` | Frozen-address pre-open verifier + operation-time mismatch sink |

### Phase 2

| Service | Registered | Deps | File | Purpose |
|---|---|---|---|---|
| `IncomingTransferService` | `:281-289` | 11 services (`incoming-transfer/service.ts:101-117`, incl. phase-1 TokenBalance + Price) | `wallet/services/incoming-transfer/service.ts` | Incoming-transfer detection, trust state, dust filter, polling |

### Phase 3

| Service | Registered | Deps | File | Purpose |
|---|---|---|---|---|
| `ProfileDeletionCoordinator` | `:292-293` | 12 services (`profile-deletion/coordinator.ts:31-44`) | `wallet/services/profile-deletion/coordinator.ts` | Started LAST; awaited cross-service purge executor registered as ProfileService deletion delegate; resumes crashed-mid-cleanup deletions |

Non-service collaborator: `WindowManager` constructed at `runtime.ts:221`, NOT in collection — shared `chrome.windows.*` helper for PasskeyService + DappInteractionService (`window-manager/window-manager.ts:1-8`).

## Offscreen supervision — `src/wallet/utils/offscreen.ts`

- Entry: `ensureOffscreenRunning()` (`offscreen.ts:337-344`) — module-level single-flight gate (`ensureInFlight`, `:327-334`).
- Sequence (`doEnsureOffscreenRunning`, `:346-404`):
  1. Join predecessor's in-flight close (`pendingClose`, `:352`); closes serialized through one `closeTail` (`trackedClose`, `:134-144`).
  2. Probe existence (`isOffscreenAlreadyRunning`, `:314-324`): Chromium `chrome.runtime.getContexts`; Firefox trusts module-local window id.
  3. Health check (`isOffscreenHealthy`, `:163-187`): `OFFSCREEN_PING` broadcast, await PONG within `HEALTH_CHECK_TIMEOUT_MS = 3_000` (`:15`). Zombie ⇒ teardown via `trackedClose` (`:359-361`).
  4. Create under monotonic **pass fence** `passSeq` (`:152`): each pass captures `++passSeq`; a timed-out pass may not close-and-retry into a successor's document (`:246-264`). Chromium ghost-document + loading race handled by one gated close-and-retry (`:250-264`). Ready gate: `READY_TIMEOUT_MS = 10_000` (`:16`, armed `:374`) races `createDocument` (`Promise.race`, `:385`); `creating` deliberately NOT awaited post-READY (accepted benign race, `:392-398`).
- Readiness contract: offscreen arms its PING listener immediately but **withholds PONG until PXE services initialized** (`src/offscreen/index.ts:17-23`; `shouldRespondPong`, `offscreen.ts:93-95`). `servicesReady = true` only after `await createPxeOffscreen(...)` (`index.ts:100-119` → real `ServiceCollection.start()` of PxeService — `packages/aztec-runtime/src/offscreen/entry.ts:43-47`); `OFFSCREEN_READY` sent last (`index.ts:122`). Ready-gate timeout fences the pass, kills the half-initialized document through the close tail, rejects (`onOffscreenTimeout`, `offscreen.ts:106-123`).
- Firefox fallback (no `chrome.offscreen` — manifest stripped, `manifest.firefox.config.ts:4-12`): same page in a minimized unfocused window carrying `?instance=<per-SW-lifetime token>` (`offscreen.ts:268-297`). Adoption broadcasts `OFFSCREEN_ADOPT_INSTANCE`; stale token self-closes (`isSupersededByAdopt`, `:71-81`; listener `src/offscreen/index.ts:32-38`). Known limitation: after SW restart the in-memory window id is lost → old window leaks (no `tabs` permission) — documented `offscreen.ts:304-312`, `:189-198`.

## Popup mount path

1. `popup/index.ts:7-22` — console forwarded to `LoggerServiceClient` (Port client); `onunhandledrejection` demotes SW-restart disconnect churn to Debug.
2. `popup/index.ts:40` — `initAppServiceContext()` eagerly connects Profile+Contact Port clients (`utils/core.ts:69-75`); `managers` otherwise lazy Proxy (`core.ts:103-113`). `network`/`transaction`/`account` stay null until unlock assigns them (`core.ts:77-85`); `requireNetwork/Transaction/Account` throw if read early (`core.ts:121-135`).
3. Router guard `popup/index.ts:55-101`: passkey-interaction bypass, register↔auth redirects, `isAuthRequired` gating on `isLogined`/`isSessionChecked`, lazy profile hydration via `getProfiles()` + `getLastActiveProfileId()`. Mount `:103`.
4. `app.vue` `onBeforeMount` (`:193-200`): `await router.isReady()` → `configService.getProps()` → `loadProfile()` (`:156-191`): subscribes profile events, bootstraps active profile via `bootstrapActiveProfile` (advance to `/popup/general` only if session survived), else `/popup/auth` or `/popup/register`. `watch(isBackgroundConnected)` re-runs `loadProfile()` after every SW reconnect (`:248-255`).
5. Activation chain in `composables/useProfileBootstrap.ts`: per-profile single-flight + generation fences (`:30-132`) — `initNetworks` disconnect-and-replace managers.network (`:57-59`), initAccount likewise (`:93-95`), then transaction service init (`utils/core.ts:166-173`) + tx sync. Clients replaced not leaked; `configService.disconnect()` in `onBeforeUnmount` (`app.vue:257-260`).
6. Migration gate: UI storage access ONLY via `@/utils/storage`, every accessor awaits `migrationIdle()` — no timeout (`utils/storage.ts:1-79`). `MigrationBarrier.vue` (mounted `app.vue:277`) reads reserved `nulo:schema:*` raw (allowlisted `:5-10`). Post-crash work gates additionally on SW liveness: `awaitLivenessAdvance(baseline, ceiling)` (`utils/background-liveness.ts:43-94`), e.g. backup-import recovery (`composables/useFullBackupImport.ts:953-954`).

## Message plumbing inventory

| Conversation | Transport | Server side | Timeouts / retries |
|---|---|---|---|
| Popup/onboarding/offscreen → SW services | Long-lived Ports named per service (`packages/extension-messaging/src/background/client.ts:52`); envelope Request/Response/Event | Each service subscribes `onConnect` at ctor (`background/service.ts:33-35`); foreign/tab senders rejected (`:44-47`); event fan-out to all ports (`:84-93`); explicit `rpcMethods` allowlist (`core/base-service.ts:87-97`) | Default RPC timeout 60 s (`background/client.ts:16`), warn-only at 10 s (`:19`); deadline starts BEFORE transport-ready (`core/base-client.ts:107-113`); auto-reconnect on port loss (`client.ts:80-83`), connect retry sleep 1 s (`:61`), `waitForConnection` polls 300 ms (`:113-121`) |
| SW → offscreen (PXE calls) | One-shot `chrome.runtime.sendMessage` with `from`/`to` routing (`extension-messaging/src/offscreen/client.ts:135-137`; reply filter `:59-65`) | Offscreen `Service` matches `message.to === name`, trusted-sender gate, replies to requester (`offscreen/service.ts:37-53`) | Default 90 s (`offscreen/client.ts:19`); `proveTx` overridden to 30 min (`packages/aztec-runtime/src/pxe/client.ts:52-69`); keepalive pings every 20 s during invoke (`offscreen/service.ts:72-79`); readiness hook `onReady → ensureOffscreenRunning()` (`wallet/services/pxe/client.ts:43-45`) + synchronous `requestAlreadyReady` bypass (`offscreen/client.ts:111-133`); offscreen→SW events dropped silently if SW dead (`offscreen/service.ts:65-70`) |
| dApp ⇄ content script ⇄ SW | postMessage/MessagePort handled by wallet-sdk inside CS; CS→SW leg one-shot sendMessage (`content-script/content.ts:11-20`) | SW module-scope relay listener (`content-message-relay.ts:75-106`) buffers validated top-frame discovery requests pre-boot (global 32 / per-origin 4 / 5 s max age, `:44-53`), flushes FIFO when SDK handler attaches (`background.ts:157-166`, `content-message-relay.ts:115-127`); iframe senders rejected unless build flag | Buffer caps + freshness budget instead of timers; live-path discovery expiry ~55 s stamped at flush |
| Offscreen lifecycle control | Strings over sendMessage both directions: PING/PONG/READY/KEEPALIVE/ADOPT_INSTANCE (`offscreen.ts:1-8`) | Offscreen PING responder (`offscreen/index.ts:18-23`); adopt listener (`:32-38`) | Health ping 3 s; ready gate 10 s |
| Onboarding Done → SW | One-shot `{type:"nulo:open-toolbar-popup", windowId}` (`wallet/index.ts:37-49`) | Direct `chrome.action.openPopup` | None (fire-and-forget, returns false) |

Asymmetry note: the offscreen itself calls back into SW over the Port transport (`offscreen/index.ts:101` constructs Port-based ProfileServiceClient) — SW⇄offscreen traffic rides BOTH transports depending on direction/initiator.

## Init-order hazard candidates (file:line; analysis deferred to scan phase)

1. Port listeners attach late: services subscribe `onConnect` only at construction inside `doStart` (`runtime.ts:213-296`) — after migration (`:143-186`) and config/BB `Promise.all` (`:195-205`). Ports opened during that window hit no listener; mitigated by client retry loops but first-boot RPCs bounce.
2. Fire-and-forget boot tail: `deletionCoordinator.resumePending` (`runtime.ts:315-317`), `reaper.start()` (`:326`), `journalGc.start()` (`:332`), session-storage probe IIFE (`:338-348`), initial liveness write (`:365-367`) — all `.catch`-logged, none awaited.
3. Liveness semantics: first `nulo:liveness` write happens only after SDK-handler install (`runtime.ts:350-367`); readers between SW wake and that write observe a stale value (documented contract, `background-liveness.ts:4-15`).
4. Offscreen init vs ready gate: PONG withheld until `createPxeOffscreen` resolves; init > 10 s gate ⇒ teardown of still-initializing document — handled, but slow environments thrash create/kill cycles.
5. Provider closures capture pre-start services (`runtime.ts:256-274`): safe only because invoked lazily per-RPC — a pre-start call meets uninitialized ProfileService (fallback: `ensureInitialized`, `packages/wallet-core/src/base/index.ts:21-31`).
6. Null-until-unlock managers read by app.vue watchers before assignment (`app.vue:88-131` vs `core.ts:77-85`); truthiness-guarded; `.vue` files not strict-null-checked (`core.ts:41-49`) — convention-enforced only.
7. Alarm ticks serialize behind full boot (`index.ts:91-98` shim forwards tick only after `runtime.start()` settles); slow boot delays ticks and a **vetoed** boot keeps the rejected memo, rejecting every tick for the worker's lifetime (`single-flight-start.ts:8-15`).
8. Relay drain keyed on ATTACH not boot success (`content-message-relay.ts:23-27`): failed boot never attaches → buffered discoveries die with the worker (bounded, deliberate).
9. `journalBootCutoff` captured pre-`services.start()` (`runtime.ts:298-305`) protects mid-startup ops from reaper sweep — correctness depends on cutoff staying ahead of any journal-writing RPC going live.
