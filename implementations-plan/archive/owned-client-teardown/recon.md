# owned-client-teardown — recon

Base: `dev` @ `c543c18d`. Two read-only agents (a batched reuse sweep and a messaging-lifecycle
mapper), then the driver re-verified every fact below that the plan rests on. Line numbers are at
that commit.

## Reuse map

| Capability the fix needs | What exists (or the absence, with its search trail) | Verdict |
|---|---|---|
| One instance per JS document, created lazily | `apps/extension/src/utils/core.ts:92-112` — `initAppServiceContext()` memoises the profile/contact clients per document; `managers` is a lazy proxy over it | **adapt** — same memo idiom, one level down |
| The logger client and its redaction | `LoggerServiceClient` (`apps/extension/src/wallet/services/logger/client.ts:12-36`) runs `trim()` before `request("log", …)`; the comment at 21-33 explains why redaction must stay client-side | **reuse-as-is** |
| Port lifecycle: connect, auto-connect on request, reconnect on remote close | `packages/extension-messaging/src/background/client.ts:45-120` | **reuse-as-is** (competing outline: adapt) |
| Demoting the "Client disconnected" rejections of fire-and-forget log calls | `isClientDisconnectRejection` + the `onunhandledrejection` handlers in `apps/extension/src/wallet/logger/console-forwarding.ts:17-22` and `apps/extension/src/offscreen/index.ts:50-69` | **reuse-as-is** |
| An owned-resource `dispose()` convention | `ChainRuntime.dispose()` + `ChainRuntimeRegistry` (`packages/aztec-runtime/src/pxe/chain-runtime.ts:92-138, 371-426`) — OPFS store handles, re-add-on-failure semantics | not reused: different resource, different failure semantics |
| A test double that can count concurrent same-name ports | `apps/extension/tests/vitest.setup.ts:50-86` `mockPort` and `packages/extension-messaging/src/testing/transport-harness.ts:64-78` `mockClientPort` are both keyed by service name and **throw** on a second live port for the same name; searched `portCount\|openPorts\|listenerCount` in `apps/extension/tests` and `packages/extension-messaging/src` → no hits | **build new** — a counting stub local to the new test: the global harnesses cannot represent N live `logger` ports, and changing them would ripple into every extension test |
| A source-scan guard | `apps/extension/src/utils/log-payload-ban.test.ts`, `apps/extension/src/utils/storage-facade-ban.test.ts` | **adapt** — same scanner shape (if the guard survives audit) |
| E2E coverage of the log pipe or port counts | none: `runtime.onConnect\|chrome.runtime.connect\|serviceWorker` and `logger\|log-viewer\|developerMode\|debugMode` under `apps/extension/tests/e2e` hit only fixtures and unrelated specs | not built — the proof is unit-level; existing smoke + network suites are the regression net |
| A service-worker teardown hook | none: `IService` has no stop hook (`packages/wallet-core/src/base/index.ts:66-76` says so), `WalletRuntime.stop()` disposes no service (`apps/extension/src/wallet/runtime.ts:101-107`) | not needed — see the non-leaks below |
| A type for the log-context tags | `LogContext = "sw" \| "offscreen" \| "popup" \| "content"` (`packages/wallet-core/src/logger/interfaces.ts:19`), re-exported by `apps/extension/src/wallet/logger/index.ts`; found by the fresh codex pass | **build new** (`DocumentLogContext`) — the existing type lacks `"onboarding"`, which console forwarding already sends, and names contexts that never borrow a port logger |

## The leak, precisely

- **Every popup/onboarding/window service client owns a private logger.** 20 client classes build
  `super(NAME, new LoggerServiceClient(), name)`: operation-journal, dapp-session, passkey, task,
  network, account-state, dapp-interaction, note, config, contact, execution, fpc, auth-registry,
  token-balance, transaction, incoming-transfer, account, token, price, profile
  (`apps/extension/src/wallet/services/*/client.ts`). `LogViewerServiceClient` uses `DummyLogger`.
- **Three more standalone loggers**, each document-lifetime: `console-forwarding.ts:12` (one per
  popup/onboarding/window document, context `"popup"`/`"onboarding"`), `offscreen/index.ts:41`
  (`"offscreen"`, the offscreen console) and `offscreen/index.ts:102` (a second, context-less
  logger handed to `createPxeOffscreen`, typed `ILogger` at
  `packages/aztec-runtime/src/offscreen/entry.ts:23`). Total construction sites: **23** (the
  presto-migration arc-2 note said 28; the current count is 23).
- **Every log line is an RPC that auto-connects.** `BaseServiceClient.logDebug` →
  `ILogger.log(...)` (declared `void`, `packages/wallet-core/src/logger/interfaces.ts:30-32`) →
  `LoggerServiceClient.log` returns `this.request(...)`, which nobody awaits →
  `ensureTransportReady()` connects a Disconnected port (`background/client.ts:100-110`). There is
  no client-side level gate: `LoggerStore.logWithContext` drops `level < logLevel` in the service
  worker, after the round trip.
- **The owner never closes it.** `ServiceClient.disconnect()` (`background/client.ts:66-78`) closes
  its own port, rejects pending requests (each settle logs `← method`, `base-client.ts:276`), then
  logs `"Disconnected"` (76) — which itself (re)opens the logger port — and never references
  `this.logger`.
- **Service-worker cost per open port**: one slot in `Service.clients` (push at
  `background/service.ts:50`, splice on the port's own disconnect at 62), a Port object and two
  listeners on each end. `LoggerService` declares no events, so no broadcast fan-out.

### Growth inside one long-lived document (verified call sites)

| Trigger | Clients rebuilt | Logger ports left open per trigger |
|---|---|---|
| Any page / window mount (L5/L6 construct at setup, disconnect on unmount) | the page's clients | one per client per mount |
| Profile bootstrap, switch or re-login — `runBootstrapCore` (`composables/useProfileBootstrap.ts:120-141`) | network (`:58-60`), account (`:103-105`), transaction (`utils/core.ts:172-179`); old instances disconnected | 3 |
| Unlock — `refreshBalances` (`utils/core.ts:144-169`, called from `popup/pages/auth.vue:191`) | token-balance, disconnected in `finally` | 1 |
| Backup import / restore run (`composables/full-backup-restore.ts`, `composables/useFullBackupImport.ts`) | 6-8 clients; all disconnected except the account client (below) | 6-8 |

The presto-migration arc-2 codex round reproduced it directly: three connect/disconnect cycles on
a settings page left three logger ports open
(`implementations-plan/presto-migration/lessons/post-impl-arc-2.md:9`). A popup that closes after
a few seconds frees everything; the side panel (`manifest/manifest.config.ts:31-33`, which loads
`src/popup/index.html`), the fullscreen popup tab (`composables/fullscreenPopupSetting.ts`), the
onboarding tab and the log-viewer window are the long-lived documents where it accumulates.

### Outer account clients left connected (found by the Claude plan audit, verified)

Not inner loggers — the outer client itself is replaced or reused without a disconnect, so its own
port and its logger port both stay open:

| Site | What happens |
|---|---|
| `popup/pages/auth.vue:184` | every password unlock assigns `managers.account = new AccountServiceClient()` after bootstrap's `initAccount` already connected one (`composables/useProfileBootstrap.ts:103-105`); the old one is never disconnected |
| `popup/pages/profile/new-profile-helpers.ts:28` | profile creation does the same after waiting for the shell's bootstrap |
| `composables/useFullBackupImport.ts:495, 526-528` | the accounts stage disconnects its client, then `reconcileImportedAccounts` reconnects it and nothing closes it again (the comment at 526-527 says so) |

Each has an existing test that mocks `AccountServiceClient` (`popup/pages/auth.test.ts`,
`popup/pages/profile/new-profile-helpers.test.ts`, `composables/useFullBackupImport.test.ts` and
`.stages.test.ts`).

### Verified non-leaks (no change)

- **Service-worker services' `PxeServiceClient`s (nine)** — network, fpc, note, account-state,
  incoming-transfer, token-balance's `BalanceProjector`, execution (factory), token (factory,
  `token/service.ts:114` via `pxe/shallow-port.ts:36`), all built in `init()`, and the
  profile-deletion coordinator, built in its constructor (`profile-deletion/coordinator.ts:62-64`),
  itself constructed once (`runtime.ts:518`). `init()` runs once per worker because the runtime's
  start is single-flight (`runtime.ts:147`) and retry is vetoed before service registration
  (`runtime.ts:230`) — not because of `BaseService.start()`'s own guard, which sets `initialized`
  only after `init()` resolves (`base-service.ts:64-67`). They use the sendMessage transport (no
  port) and log to the in-process `LoggerStore`. Service-worker lifetime, one each.
- **App-lifetime Pinia clients** (`stores/balances.store.ts:230-236`, `stores/app.store.ts:162`) and
  the eager `managers.profile` / `managers.contact` — one per document by design.
- **The service worker never opens a port**: the only `chrome.runtime.connect(` call site is
  `background/client.ts:52`, and `registerServices()` hands every service the raw `LoggerStore`.

## Lifecycle invariants a change must preserve

1. `disconnect()` is both the public teardown and step one of reconnect-on-remote-close:
   `onDisconnect = () => { this.disconnect(); this.connect() }` (`background/client.ts:80-83`),
   pinned by `packages/extension-messaging/src/background/client.test.ts:511-556`.
2. There is no terminal state: Disconnected means both "never connected" and "closed on purpose"
   (`background/client.ts:151-156`), so any later `request()` — including a log line — reconnects.
3. The port client's `disconnect()` has no re-entrancy guard (66-78); the offscreen client's does
   (`packages/extension-messaging/src/offscreen/client.ts:53-59`).
4. `LoggerServiceClient` and `LoggerService` use `DummyLogger` as their own base logger, which is
   what stops logger-logs-about-itself recursion (`logger/client.ts:16`, `logger/service.ts:18`).
5. Redaction happens inside `LoggerServiceClient.log`, before `jsonSanitize`; any rerouted log path
   must still go through it.
6. A service-worker restart rejects every in-flight request on every port; the page handlers above
   demote the resulting unhandled "Client disconnected" rejections of fire-and-forget log calls to
   one debug line each.
7. CLAUDE.md's `onBeforeUnmount` cleanup order and the C1 composable rule govern the ~130 outer
   client call sites; neither knows about the inner logger.

## Hazards for any teardown design

1. **Reconnect flap**: a "close the logger on disconnect" hook also fires on every service-worker
   restart, and `connect()`'s `"Connected"` line reopens it in the same synchronous handler.
2. **Reopen by late lines**: settle logs and `"Disconnected"` are emitted inside the owner's own
   teardown; closing the logger before the last of them reopens it.
3. **Unhandled rejections on close**: closing a logger with in-flight log RPCs rejects them; the
   page handlers turn each into a debug log RPC on the console-forwarding logger.
4. **Double disconnect** re-logs and re-fires subscribers (latent: no caller disconnects twice
   today; `popup/windows/passkey/index.vue:55` is its window's only `disconnect()`).
5. **Shared instance closed by one borrower** silences every other borrower until the next line
   reconnects it.

## Test and convention constraints

- Both global port doubles reject a second same-name port; the extension one
  (`tests/vitest.setup.ts:50-86`) rejects it even after the first was disconnected, because its
  `disconnect` is a bare `vi.fn()`. A port-count proof needs its own counting stub, installed per
  test over the global `chrome` stub.
- Vitest does not mock a module that a setup file already imported, so a global per-test reset of
  a logger memo cannot live in `tests/vitest.setup.ts` without breaking
  `console-forwarding.test.ts`'s `vi.mock`.
- A `vi.mock` in the setup file (no import) does reach every test file; a test file's own
  `vi.mock` of the same module wins, and `vi.unmock` restores the real module (probe on this repo's
  vitest under Bun, 2026-09-16).
- Six test files build real service clients without mocking their modules
  (`network/client.test.ts`, `profile/client.test.ts:54`, `profile/client-subscribe.test.ts`,
  `profile/service.integration.test.ts`, `pxe/client.test.ts`, `task/client.test.ts`); tests that
  mount code which builds clients reach them too.
- `apps/extension/vitest.config.ts:82-86` inlines every `@nulo/*` package, so `vi.resetModules()`
  re-evaluates them too; a statically imported class then fails `instanceof` against the new graph.
- `apps/extension/tsconfig.json` has no `allowJs`/`checkJs`, and 149 of the 191 extension SFCs have
  no `lang="ts"`, so a TypeScript-only guard does not reach them.
- `apps/extension/src/wallet/services/logger/client.test.ts` covers redaction only, by patching
  `request`; no test exercises logger connect/disconnect.
- Tests that assert `disconnect` call counts on mocked outer clients (`utils/core.test.ts`,
  `popup/windows/execute/index.test.ts`, `popup/pages/settings/security/export/full.test.ts`,
  `composables/fullscreenPopupSetting.test.ts`, `popup/components/popups/NewSenderPopup.test.ts`)
  mock the outer client and are unaffected by where the logger comes from.
- `packages/extension-messaging` sits below `apps/extension` and knows nothing of
  `LoggerServiceClient`; a base-layer mechanism must stay `ILogger`-shaped.
- No living doc (READMEs, ARCHITECTURE.md, CLAUDE.md) describes the per-client logger pattern;
  only historical plan files mention `LoggerServiceClient`.

## Local e2e runner (for the validation plan)

- CI partitions the network suite into a 5-shard proverless pool (retry 0) excluding six files, two
  proverless heavy jobs and one prover-ON canary, aggregated by `extension-network-e2e-status`
  (`.github/workflows/pr-extension-network-e2e.yml:123-248`); the reusable job passes excludes as a
  bash array, retries only exit 86 and fails anything else immediately
  (`_extension-network-e2e.yml:227-268`).
- `bun run e2e:agent` resolves ports by bind-and-release before its build
  (`scripts/e2e/resolve-ports.ts:187-197`; a random window from 10000 to below the ephemeral floor),
  clears its boot sentinels first (`agent.sh:50`), and writes `boot-ready` only after anvil, the
  node and the playground are up and contracts are deployed (`tests/e2e/global-setup.ts:259-303`).
- A clean run's teardown SIGTERMs its groups, waits on each group leader (5 s, then SIGKILL) and
  deletes `owned.json` (`tests/e2e/global-setup.ts:803-819, 827-850`); `bun run e2e:reap` SIGTERMs
  what a surviving record lists, without waiting (`tests/e2e/reap.ts:22-36`).
- Two concurrent sandbox boots starved each other on this host on 2026-09-01 (one prover-ON); a
  proverless pair is unverified.

## Absence trails (reproducible from the repo root)

- No owned/shared-client primitive: `ownedClients|innerClient|childClient|nestedClient`,
  `Symbol.dispose|FinalizationRegistry|WeakRef`, `refCount|sharedLogger|borrowed|getLogger` over
  `apps/extension/src` and `packages/*/src` → none.
- No other `chrome.runtime.connect(` caller: `apps/extension/src`, `packages` (non-test) → only
  `background/client.ts`.
- `apps/playground` and `apps/tools` do not depend on `@nulo/extension-messaging`.
- No prior plan for this work: `LoggerServiceClient|logger leak|owned logger|port leak` under
  `implementations-plan/**/*.md` → only `presto-migration/lessons/post-impl-arc-2.md` (and
  historical mentions of the offscreen clients in `phase-2-followup-terminal-cards`,
  `transport-ready-handshake`, `M3`).
- `packages/extension-messaging/src/core/service-client-factory.ts` is passthrough-method codegen,
  unrelated to ownership.

## Out-of-scope observations (candidate follow-ups)

- Debug lines cross the wire before the level gate: every request emits `→ method` and
  `← method` log RPCs even with debug mode off.
- The port client's `disconnect()` is not idempotent (invariant 3); latent, no double-disconnect
  caller exists.
- The two fake-port harnesses duplicate each other and diverge on `disconnect()`.
