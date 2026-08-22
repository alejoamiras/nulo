# Map C — Transport + dApp surface

> Mapper (explore agent), 2026-08-22. Repo-relative paths.

Scope note: postMessage/MessagePort/ECDH mechanics of the dApp↔extension protocol live inside @aztec/wallet-sdk (not read here). Everything below is Nulo-owned source.

## 1. `packages/extension-messaging`

### Wire schema
- `src/messages.ts:4-8` — MessageType: Event=1 / Request=2 / Response=3; envelopes {type, content}.
- Request content `{requestId, method, params}` (`:26-32`). Response content (`:39-57`): flat `error` always present on failure (legacy clients), structured `errorPayload` only for WalletError throws, `resultIsJson` marks JSON-stringified fallback.
- Offscreen envelopes add `{from, to}` routing (`src/offscreen/messages.ts:8-15`).
- Params positional tuples wrapped with explicit arity `{0..n-1, n}` because JSON drops undefined keys (`src/utils.ts:16-22`, MAX_RPC_ARITY=256); unwrapping honors `n` only when sane integer within cap, else contiguous-prefix read (`:34-48`).

### Shared client correlator (`src/core/base-client.ts`)
- Per-instance monotonic ids; one pending map with resolve/reject/method/timeout/warn timers in single entry.
- Request lifecycle (`request()` :101-186): deadline computed BEFORE awaiting transport readiness so connection establishment covered by same budget (`:108-113`). Remaining budget becomes timeout timer inside Promise executor (`:130-151`).
- Wire send: sync throw caught at `:176-183`; async rejection fire-and-forget at `:167-174`. Both settle early via idempotent `settle`.
- `handleResponse` (`:193-215`): unknown requestId → warn+drop; error fields → typed reject; malformed resultIsJson payload → fail-closed reject instead of leaking to timeout (`:206-212`).
- `settle` (`:255-271`) single terminal path: clears both timers, deletes entry, settles promise, emits exactly one TerminalRecord. Late/duplicate responses and disconnect races silent no-ops.
- Event dispatch hardening: handler must be EventHandler instance AND not reserved name — forged message cannot drive onConnected/onDisconnected.
- Readiness await never exceeds deadline (`awaitReadyWithinDeadline :277-295`).

### Error serialization
- `WalletError.toPayload()` → {code, message, details} (`errors.ts:41-43`). Prototype identity fixed via Object.setPrototypeOf so instanceof survives reconstruction despite minification.
- Client rebuild `walletErrorFromPayload()` code-switch (`:295-329`), unknown codes → generic WalletError preserving code.
- Domain codes: RpcTimeoutError, RpcDisconnectedError, UserRejectedError, JobCancelledError (EIP-1193 4001 mapping), CapabilityNotGrantedError (message text is public contract, never interpolate origin/session/address), TooManyPendingError, ValidationError, AccountAddressInconsistencyError / RestoreTornError marked NEVER surfaced verbatim to dApps.
- Teardown contract: plain Error "Client disconnected" constant + isClientDisconnectRejection.

### Port-based client/server (`src/background/`)
- Client default timeout 60s, warn after 10s. connect() retry loop with 1s sleep (`:45-64`); disconnect() removes listeners + rejects all pending; port drop auto-reconnects. Port send captures local ref against concurrent teardown (AUDIT A5). Readiness fast-path preserves synchronous-send timing; else 300ms poll loop.
- Service: multi-port fan-out; connect filter = port name match + isTrustedInternalSender (F-09); listener hygiene on disconnect; events broadcast to every port with per-port try/catch; framework RPCs backup/restore reserved.
- Sender auth (`core/sender-auth.ts:17-23`): sender.id === chrome.runtime.id AND url absent or under own extension base URL. Discriminator is sender.url NOT sender.tab.

### Service-side core (`src/core/base-service.ts`)
- Explicit RPC-surface guard (D10): method must be registered in rpcMethods or frameworkRpcMethods or dropped; defineRpcMethods makes under-registration a compile error. requestId must be positive safe integer; malformed params get clean ValidationError reply rather than hanging caller.
- 3-tier response send (`:140-164`): structured clone → jsonStringify+resultIsJson → error response → drop.
- `emit` (`:128-132`): sanitize payload, wire fan-out, then local handler invocation.
- Optional Zod boundary helpers per-service opt-in (`zod-helpers.ts:38-63`).

### Orphan points (messaging)
Every pending request carries hard timer; rejectAllPending covers teardowns. Remaining silent-drop paths: invalid-envelope requests dropped with log (caller runs out its timer), offscreen events lost when SW dead (`offscreen/service.ts:67-69` swallows), responses arriving after client disconnect dropped at handleResponse entry-miss. No event subscribe/unsubscribe protocol — events fan out to ALL connected clients; "unsubscription" = disconnect() only.

### Offscreen variant (`src/offscreen/`)
- Client: one-shot sendMessage; default timeout 90s, long ops override per-method. Per-client uid = random hex(8). Routing (`onMessageListener :59-65`): accept if message.to === uid OR (Event && from === this.service && to === undefined). Envelope re-check requires from === this.service. Terminal telemetry always recorded exactly once. Sanitizer strips everything but whitelisted static detail categories.
- `requestAlreadyReady` bypass (`:99-117`) deliberately non-async readiness to keep zero microtask gap between authority check and wire.
- Service: sender-gated listener; keepalive pings "OFFSCREEN_KEEPALIVE" every 20s during any invocation to reset Chrome's ~30s SW idle timer (cleanup in base's finally). Responses addressed to requester's from; events broadcast from: name, to: undefined.

## 2. Content-script bridge

- `content.ts:11-20` — thin bootstrap constructing upstream ContentScriptConnectionHandler with sendMessage sender and permanent onMessage listener (document lifetime, never removed). No private keys touch this script; discovery, MessageChannel creation, key-exchange relay, encrypted relay are upstream-owned.
- **Cold-wake module-scope relay** (`wallet-sdk/content-message-relay.ts`):
  - MV3 problem: waking message delivered once at top-level execution — only module-scope listeners receive it; SDK handler attaches late (tail of runtime.start()).
  - `registerContentMessageRelay()` (`:75-106`) must be called synchronously at SW-entry top level, logger-free.
  - Live path: single listener forwards to attached transport wrapper keyed on message's self-declared `origin === "content-script"` field (`:83-88`).
  - Pre-boot discovery buffer (`:90-104`): admission stricter than live path — subframe rejected, Zod envelope validated, only discovery-request type buffered; caps global 32 / per-origin 4 / 5 s max age, keyed on sender.origin ?? sender.url ?? "unknown".
  - Freshness: CONTENT_RELAY_MAX_AGE_MS = 5_000 sized so relay residence + downstream 55s cutoff ≤ dApp's 60s window. Flush drops stale entries (`attachContentListener :115-127`, staleness check `:121-123`); buffer snapshotted+cleared BEFORE callbacks run so synchronous throw can't replay delivered entries; re-attach idempotent replacement.
  - Single-listener ownership load-bearing: a second chrome listener double-delivers; duplicate discovery's coalesce→reject would delete its twin's queued entry; duplicate secure-message double-journals a sendTx.
- **Origin/envelope validation** (`content-script-validator.ts`):
  - ContentScriptMessageSchema (`:51-59`): literal origin:"content-script", type enum subset [discovery-request, key-exchange-request, secure-message, disconnect-request, ping], content intentionally unknown.
  - Three-way verdict passthrough/valid/invalid (drop). Explicitly documented as noise-reduction, NOT a security boundary.
  - isSubframeSender: subframe iff tab !== undefined && frameId !== 0. Rationale: upstream attributes origin via sender.tab?.url (top-frame URL), iframe would inherit parent grants.

## 3. Wallet-SDK integration (`wallet-sdk/background.ts`)

- Schema patch first import (`:28`) adds registerToken/isTokenRegistered/grantPublicAuthwit to WalletSchema; signature-drift guard throws on upstream shape change.
- Handler construction `:145-337`: walletId/name/version/icon, NOOP_LOGGER, sendToTab via chrome.tabs.sendMessage.
- **Content listener wiring** (`addContentListener :157-211`): does NOT register own chrome listener — attaches to cold-wake relay; wrapper applies F-001 subframe rejection (build-time flag NULO_ALLOW_IFRAME_DAPPS, env-only by design) then Zod-validates envelopes.
- **Discovery queue** (`@nulo/wallet-bridge/discovery-queue.ts`):
  - DISCOVERY_STALE_MS = 55s just inside SDK's 60s window (~5s delivery margin); isDiscoveryExpired MUST be re-checked before every approval and durable write.
  - Locked-wallet queue: coalesce duplicates by (origin,chainId) returning false, per-origin cap 4, global cap 32, reject-new; badge reconcile at construction because badge state survives SW kill while queue boots empty; drain re-reads clock per entry since earlier popup awaits can age later ones; lock mid-drain re-queues remainder.
  - Unlocked-path popup caps same values (`background.ts:445-446`, enforced `:561-570`).
- **handleDiscovery** (`:458-650`): locked → enqueue, reject on enqueue-false so upstream unbounded pendingDiscoveries map doesn't leak one entry per hostile requestId. Returning-user auto-approve lookup (origin, chainId)-keyed — no cross-chain trust bleed. Duplicate-discovery coalescing waits on pending popup promise keyed `${origin}|${chainId}`, then RE-CHECKS session existence so declined twin isn't inherited. Popup dedupe map cleanup in finally. Freshness re-checked pre-write and post-write via approveOrRollbackDiscoverySession (deletes rolled-back session best-effort, undoes pendingVerification if approval didn't land — `discovery-approval.ts:35-61`). Dapp-controlled strings sanitized: sanitizeWireString(rawAppName, 64) bidi defense.
- **Session establishment guards**: establishmentStatus map records validation promise synchronously BEFORE first await (`:230-240`); onWalletMessage gates dispatch on it and re-checks promise identity after awaiting so termination-during-wait drops message (`:266-274`). `session-established.ts:51-103`: fail-closed body — missing DappSession row (revoked between approve and key exchange) terminates live session; verify window carries THIS session's hash in URL so concurrent overwrite can't show wrong emojis; any persist/window failure terminates; pendingVerification cleared in finally incl. early return. ChainId derivation XOR convention `chainInfoToChainId`.
- **Encrypted-channel routing** (`onWalletMessage :249-335`): per-session FIFO via baton primitive (idempotent release); sendTx releases early on execution-enqueue hook, safety-net finally(releaseFifo) for other paths; queued-journal record created concurrently on ARRIVAL (not behind baton) gated on establishment, sendTx-only — batch excluded by design (TODO at `:281-282`); queue tail stored as baton.catch(()=>{}).
- Decrypt serialization monkey-patch over upstream fire-and-forget: per-session KeyedLock({maxHoldMs:null}) around private handleEncryptedMessage (`:341-353`; Q-08 no-watchdog noted).
- **Session revocation triggers**: (a) onDappSessionDeleted → terminate matching live sessions tuple-matched (origin,chainId) — multi-tab aware; (b) tab close → terminateForTab; (c) cross-origin navigation guard documented MOSTLY DEAD due to tabs-API URL visibility, whole-branch fail-closed catch; (d) establishment failure; (e) TTL expiry.
- Unlock drains queued discoveries (`:392-423`; lock mid-drain returns false → requeue).
- Response path `handleWalletMessage` (`:665-751`): requireActiveProfile gate ("Wallet is locked"), ctx built from session, hooks ride as internal 4th arg so batch-leg recursion can't leak them, BigInt-safe toJsonSafe recursion with cycle guard, structured EIP-1193 error envelope (JobCancelled→4001, CapabilityNotGranted→4100, RpcTimeout/RpcDisconnected→-32603 generic messages to avoid method-name oracle / false 4900 teardowns, TooManyPending→-32005, AccountAddressInconsistency fully generic), failed-before-claim journal transition queued→failed.

## 4. `packages/wallet-bridge`

- Method table — single source `method-descriptors.ts` registry (`:170-308`); capability-map/scope tables derived; dispatch-entry choke point assertKnownMethod rejects prototype names via Object.hasOwn, frozen "Unsupported wallet method".

| Method | Capability | Approval class |
|---|---|---|
| getChainInfo | exempt | none (public meta) |
| requestCapabilities | exempt | capabilities popup |
| batch | exempt | legs individually enforced; popup methods banned server-side (`dispatcher.ts:613-617`) |
| createAuthWit | accounts | silent sign if CallIntent covered by tx/sim scope, else confirm popup; raw-Fr hash rejected |
| registerToken | accounts | always popup (+ anti-phishing gate `dapp-interaction/service.ts:492-500`) |
| getAccounts | accounts | requires canGet=true; pre-grant throws structured CapabilityNotGrantedError |
| isTokenRegistered | contracts | reader, contracts grant + canGetMetadata scope |
| registerContract / getContractMetadata | contracts | scope-checked, direct |
| getContractClassMetadata | contractClasses | scope-checked |
| registerContractClass | contractClasses | DISABLED — denied at scope-check |
| simulateTx / profileTx | simulation | scope-checked, direct |
| executeUtility | simulation | scope-checked, direct |
| sendTx | transaction | popup via DappInteractionService (fee selection) |
| grantPublicAuthwit | transaction | popup; same tx-scope gate |
| getPrivateEvents / getAddressBook / registerSender | data | addressBook sub-bit required for latter two |

- Validation points: dispatcher-level pure predicates (argSchema per descriptor, run before enforcement); structural auth-shape guard; scope checkers tolerate/coerce per historical pins; full Aztec-object parsing deliberately downstream (execution-layer Zod).
- Dispatch sequence (`dispatch :389-508`): capture DappSession ONCE at entry to close TOCTOU across six former lookups → known-method → argSchema → shape guard → enforceCapability (`:1107-1162`: exempt skip; missing session fail-closed throw; grant-type miss throws CapabilityNotGrantedError) → enforceScopeWithSession building approved-account set carrying BOTH CAIP and raw-hex forms or plain enforceScope → route.
- scope-enforcement.ts: enforceScope maps method→checker (prototype-safe); enforceScopeWithSession additionally validates exec.scopes / opts.scopes / opts.additionalScopes / eventFilter.scopes against session accounts even when calls-array checks short-circuit empty. Checker bodies: empty function name never matches any scope including "*"; tx coverage requires ONE cap to cover every call of tx; simulation entries null-guarded; createAuthWit intent taxonomy: CallIntent checked vs union of tx+sim.transactions scopes, IntentInnerHash checked consumer-at-any-function, raw Fr rejected outright.
- grantPublicAuthwit path (`dispatcher.ts:801-846`): session resolve → account validated through shared resolveNetworkAndAccount (distinct not-authorized/no-accounts errors) → builds send_transaction op with single add_public_authwit action → routed through DappInteractionService popup WITH originKey: ctx.origin so per-origin backpressure applies to grants too.
- Bridge-side revocation: CapabilityNotGrantedError fail-closed on missing row; applyCapabilityDecision merges deltas against LATEST row under one lock so concurrent revoke fails cleanly with no half-written grants; rejected delta widens persist as rejections preserving older narrower grants.

## 5. DappInteractionService / approval UI plumbing

- Popup open: under service Lock guarding ONLY id-mint + window-open + registration (`interaction() :248-294` — returning pending promise from inside closure would hold lock through whole user interaction); 128-bit interaction id; window opened via WindowManager at #/windows/{execute|capabilities|discover}?requestId=<id>; hooks stashed on record to survive popup handoff.
- Hard ceiling: INTERACTION_TIMEOUT_MS = 10min.
- Double-click/latch protections: first service claim wins — approveInteraction refuses if cancelledAt set, deletes record as commit point, detaches window handle before async execution so onRemoved can't race settlement; resolveInteraction mirrors refusal; cancel writes durable flag BEFORE broadcast so popups that haven't subscribed replay it, late mounts re-read via isInteractionCancelled + composable replay; execute-path short-circuit throws JobCancelledError before opening popup for already-cancelled queued request; UI latch: approve() guarded by isCancelled/isLoading/initComplete/non-empty operations/tokenMetadataLoading/fee-selected gates (`popup/windows/execute/index.vue:352-367`).
- Profile-drift guard: approval executes only if active profile still matches session's profileId (executeAndResolve `:173-179`, silent path `:297-300`); confirmation needed when accessLevel ≥ session.confirmationLevel OR wallet-fee-payer absent OR register_token; operation-kind→AccessLevel table (`:512-555`, createAuthWit = Transactions so popup-routed authwits hit confirmation gate).
- Session/permission re-validation per operation: account membership, CAIP-vs-string chain comparison fix, legacy methods-list semantics.
- Silent path materializes ops through shared materializer with drift assertion, fast-forwards journal queued→pending immediately before executeOperations so pre-execute throws stay catchable by background safety net.
- WindowManager: handles keyed by random handleId NEVER kind — concurrent same-kind windows supported; settled-latch makes settle/cancel/detach idempotent; detach stops timeout+listener WITHOUT settling so approval-owned execution can settle later; window-create failure and missing id settle with rejection.
- Persistence: chrome.storage.local root nulo:core:dappSessions — rows carry permissions/accounts/accountAliases/capabilityGrants/capabilityRejections/verificationHash/trustedVerification/confirmationLevel/chainId/expiry; MAC-integrity layer wraps EntityStorage (F-12, mac-storage.ts); 7-day TTL enforced lazily; TTL expiry emits onDappSessionDeleted which tears down live wallet-sdk channels. Related roots: authwit registry nulo:core:auth-registry + nulo:core:auth-registry-enabled, journal nulo:journal.

## 6. Hazard candidates noticed while mapping (file:line only)

- `content-script/content.ts:15` — permanent onMessage listener forwards ALL messages to upstream handler; page-side postMessage origin validation entirely upstream.
- `content-message-relay.ts:83` — routing discriminator is self-declared message.origin string field, not sender-derived (pre-boot admission compensates; live path trusts upstream filtering).
- `tab-lifecycle.ts:56` — cross-origin nav termination mostly dead (URL visibility); stale ActiveSessions rely on realm teardown, not revocation.
- `background.ts:350` — decrypt KeyedLock maxHoldMs null: hung decrypt stalls that session's channel indefinitely (Q-08 acknowledged in-comment).
- `background.ts:347-353` — monkey-patch of upstream private method; breaks silently on SDK bump.
- `background.ts:641-649` — catch-all in handleDiscovery treats ANY popup/storage error as rejection (fail-closed but masks real faults).
- `method-scope-checkers.ts:122,158` — empty calls array short-circuits tx/sim call-scope checks (account-scope wrapper compensates).
- `dispatcher.ts:666` — rawOpts = args[1] ?? {} cast; opts fields beyond shape guard flow unvalidated into fee/entrypoint handling.
- `discovery-queue.ts:101` — drain resolves queued entries via handler.getPendingDiscovery(requestId); dApp-controlled requestId collision surface is upstream-owned.
- `dapp-interaction/service.ts:193` — cancelInteraction linear-scans storage values.
- `popup/windows/execute/index.vue:374-391` — approve mapper casts Draft→Operation via `as unknown` after predicate gates (runtime safety net only).
- `useDappInteractionPayload.ts:95` — cancelled-state replay .catch(() => false) can miss raced cancel until broadcast arrives.
- `background/client.ts:50-63` — connect() retries forever, no backoff cap (bounded only by per-request deadlines).
- `offscreen/client.ts:61` — event acceptance for to === undefined means any same-named-service event reaches every offscreen client instance (fan-out by design; no scoping).
