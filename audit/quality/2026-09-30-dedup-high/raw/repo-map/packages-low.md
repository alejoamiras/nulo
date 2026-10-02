# Repo map: packages-low (wallet-core, wallet-crypto, extension-messaging)

Prod LOC (tests excluded, `git ls-files`): wallet-core ~6.05k (of which ~2.05k is the BIP-39 wordlist array in `mnemonic.ts`, so ~4.0k real), wallet-crypto ~1.7k (122 lines are a vendored vectors JSON), extension-messaging ~2.9k. Layer order: wallet-core -> wallet-crypto -> extension-messaging -> aztec-runtime -> wallet-bridge -> apps/extension.
All three are `private`, `type: module`, raw `.ts` exports (no build), Apache-2.0. Test runner `bun --bun vitest run`.

---
## 1. packages/wallet-core (no runtime deps; devDeps: fake-browser, fast-check, jsdom, vitest)

### Module inventory (LOC, non-test)
| Path | LOC | Purpose |
|---|---|---|
| src/utils/mnemonic.ts | 2183 | bip39Words array (lines 2-2051, vendored from Azguard, Apache-2.0 header) + getMnemonic/canonicalizeMnemonic/getEntropy (~130 lines real code) |
| src/migration/migrator.ts | 453 | crash-safe storage migration engine (journal marker, footprint backup, staged commit, attempt counter, decision table) |
| src/testing/fake-browser-api.ts | 313 | in-memory BrowserApi (test-only, exported as `./testing`) |
| src/activity/causal.ts | 279 | causal/incarnation merge algebra for activity records (property-tested) |
| src/storage/entity_storage.ts | 267 | `EntityStorage` rows `${root}@${id}` over StorageArea |
| src/utils/rw-guard.ts | 191 | reader/writer guard, FIFO writers, 5 min drain watchdog |
| src/jobs/types.ts | 183 | job stage/error taxonomy (KNOWN_JOB_ERROR_KINDS, isTerminal) |
| src/utils/lock.ts | 169 | ticketed single-flight Lock, 5 min force-release watchdog |
| src/activity/model.ts | 126 | activity wire/model types + DecimalCounter |
| src/jobs/fsm.ts, jobs/error.ts | 106 / 72 | stage transition table; `normalizeError` job envelope |
| src/base/topology.ts, base/index.ts | 106 / 93 | ServiceCollection + topological startup phases, ServiceSpec/IService types |
| src/migration/types.ts, staging.ts | 105 / 71 | Migration/defineMigration types; staged write area |
| src/utils/{keyed-lock,alarm-dispatcher,event-handler,serialization,arrays,queue,encoding,errors,error-json,random,sleep,deferred}.ts | 72/64/62/58/53/50/39/29/24/~15/1/~20 | small pure helpers |
| src/ports/*.ts | ~330 total | BrowserApi/Alarms/Runtime/Window/Storage/Clock/BackgroundTicker port interfaces (types only) |
| src/storage/{value-storage,memory-storage-area,prefixed-entries}.ts | 45/31/~? | ValueStorage<T>, in-mem area, prefix scan |
| src/logger/interfaces.ts | 49 | ILogger + LogLevel |
| src/testing/{mock-clock,fake-background-ticker,listener-bag}.ts | 96/66/27 | test doubles |

### Entrypoints (package.json exports) and consumers (distinct prod files, apps/extension/src / other prod packages / test files)
`.` = empty barrel (`export {}`; 0 consumers, intentionally) | `./ports` 39/0/10 | `./utils` 94/7/58 | `./storage` 5/0/4 | `./migration` 9/0/10 | `./base` 1/3/3 (+11 imports inside extension-messaging) | `./logger` 10/7/26 | `./jobs` 24/1/13 | `./activity` 5/0/2 | `./testing` 2/0/58.
Consumers: apps/extension, wallet-crypto (utils only), extension-messaging (base, logger, utils, testing), aztec-runtime, wallet-bridge (declared in package.json).

### Trust boundaries
- `migration/migrator.ts`: reads/writes chrome.storage via injected store BEFORE unlock; backup blobs are attacker-controlled (hostile JSON); undeclared writes rejected at commit. Highest-stakes module here.
- `storage/entity_storage.ts`, `value-storage.ts`: persisted-shape writes; key encoding `${root}@${id}` is load-bearing for prefix wipes.
- `utils/serialization.ts`: `jsonStringify`/`jsonSanitize` (vendored from `@aztec/foundation/json-rpc`) - wire format for RPC results.
- `utils/mnemonic.ts`: mnemonic <-> entropy (secret handling; uses WebCrypto SHA-256 checksum).
- `utils/errors.ts` `getErrorMessage` is deliberately lenient/type-lying (comment says tracked "Q-01"); reaches the dApp wire and logger raw.
- `utils/random.ts`: `getRandomHex` over `crypto.getRandomValues` (id allocation).

### Libs
No runtime deps. dev: vitest 4.1.9, fast-check 4.9, @webext-core/fake-browser 2.0.1, jsdom 29, TS 6.0.3.

### Tests (21 colocated *.test.ts + 1 property test)
causal.property.test.ts (fast-check), migrator.test.ts, entity_storage/value-storage, lock/keyed-lock/rw-guard, topology/base, jobs fsm/types/error, encoding/errors/error-json/mnemonic, testing doubles. No test for: `activity/model.ts`/`scope.ts` directly, `serialization.ts`, `queue.ts`, `arrays.ts`, `random.ts`, `deferred.ts`, `staging.ts` (directly), `prefixed-entries.ts` (verify; only by filename, not by grep of imports).

### Generated / vendored
`src/utils/mnemonic.ts` lines 2-2051 (BIP-39 wordlist, Azguard-derived) - exclude from dup/quality LOC. `serialization.ts` partly vendored from aztec foundation json-rpc. No generated files.

---
## 2. packages/wallet-crypto (deps: @aztec/accounts|constants|foundation 5.2.0 exact, @nulo/wallet-core)

### Module inventory
| Path | LOC | Purpose |
|---|---|---|
| src/password-secret-box.ts | 266 | `PasswordSecretBox` seal/unseal/unsealWithPasshash; `ENCRYPTION_GUARD`/`PROFILE_AAD`/labels (3 TextEncoder labels) |
| src/session-secret-box.ts | 166 | `SessionSecretBox`: HKDF(token,salt)->AES-GCM wrap of `master||dek` pair (uses `Buffer` + bare `crypto`) |
| src/encryption-key.ts | 146 | `EncryptionKey` PBKDF2-SHA256 600k + AES-GCM, 1-byte version frame (also the npm-published class) |
| src/passkey-credential.ts | 119 | WebAuthn PRF -> HKDF master secret, `recoverFromCredentialData` |
| src/secret-types.ts | 117 | branded types (`Base64*`, `Passhash`, `MasterSecretBytes`, `ImportedKeysDek`) + `as*` casters |
| src/entropy-mac.ts | 102 | envelope MAC v3 (HKDF->HMAC) compute/verify |
| src/imported-account-key-box.ts | 77 | AES-GCM seal of imported signing key under HKDF(dek) |
| src/imported-keys-dek-box.ts | 73 | DEK generate + AES-GCM wrap/unwrap (`IMPORTED_DEK_AAD`) |
| src/mnemonic-master.ts, account-derivation.ts, derive-account-seed.ts | 62/40/31 | BIP-39 seed -> master -> Aztec account keys (BN254 reduction) |
| src/pxe-store-key.ts, dapp-session-mac-key.ts, dual-secret-hkdf.ts, wallet-fingerprint.ts | 45/25/28/42 | derived keys, all via `importDualSecretHkdfKey` except fingerprint |
| src/zeroize.ts, nulo-separators.ts, constants.ts | 49/23/10 | wipe helper; domain-separation labels; ENCRYPTION_GUARD/PRF label |
| src/index.ts (57) / src/public.ts (8) | | wallet-internal barrel / npm surface (`deriveNuloAccountKeys`, `deriveSigningKeyFromSeed`, `EncryptionKey`, type `Passhash`) |
| vectors/bip39-official-english.json | 122 | vendored official test vectors |

### Entrypoints
Single `.` -> `src/index.ts`. Separate published entry `src/public.ts` via `tsconfig.publish.json` (scripts/publish/). Consumers: 19 prod files in apps/extension/src, 6 in other prod packages, 20 test files.

### Trust boundaries (security-critical)
PBKDF2 600k iterations + AES-GCM (random 12-byte IV) in encryption-key/password-secret-box/session-secret-box/imported-*; HKDF-SHA256 with `nulo:*` labels (10 separate label constants across 8 files, plus `nulo-separators.ts` registry); passhash = silent-restore bearer; `zeroize()`; WebAuthn PRF; master `||` dek concatenation in `dual-secret-hkdf.ts` (32+32 length check). Frozen by vectors (`apps/extension/src/wallet/crypto/key-vectors.test.ts`) and `ATTACK-SURFACE.md`. `array_equals` (wallet-core, NOT constant-time) is used in password-secret-box for comparison (line ~40 import) - flag for bugs audit.

### Libs
WebCrypto only (PBKDF2/HKDF/AES-GCM/HMAC/SHA-256); `@aztec/foundation` (BN254 field math), `@aztec/accounts`, `@aztec/constants` all 5.2.0. `globals.d.ts` ambient `Buffer` decl (vite node-polyfill injects it) - README says "Uint8Array, never Buffer" but session-secret-box.ts:96-98 and wallet-fingerprint.ts:37 use `Buffer.from(...).toString(...)`.

### Tests (16): bip39-official-kat, reduction-entropy, nonce-uniqueness, zeroize + zeroize-sites, per-module tests. Missing direct tests: passkey-credential.ts (only via ext integration), secret-types.ts, derive-account-seed.ts (verify), constants.

### Generated/vendored: vectors/bip39-official-english.json (vendored, exclude).

---
## 3. packages/extension-messaging (dep: @nulo/wallet-core; peer zod ^4 optional; dev chrome-types, fake-browser)

### Module inventory
| Path | LOC | Purpose |
|---|---|---|
| src/errors.ts | 597 | `WalletError` + 23 subclasses, `walletErrorFromPayload` registry, `JournaledRejection`, disconnect predicates |
| src/core/base-client.ts | 382 | transport-agnostic client: correlation, timeouts, terminal records, disconnect handling |
| src/core/base-service.ts | 230 | transport-agnostic service: dispatch, event broadcast |
| src/offscreen/client.ts / service.ts | 180 / 88 | SW->offscreen `sendMessage` client (+telemetry) / server with keepalive |
| src/offscreen/telemetry.ts | 159 | terminal-state telemetry sinks (Noop/Logging/Memory) |
| src/background/client.ts / service.ts | 153 / 108 | popup<->SW port client (reconnect) / server |
| src/core/envelope-summary.ts | 115 | log-safe summary of envelopes (no payloads) |
| src/core/sender-auth.ts | 88 | `isBackgroundSender` (sender URL check) |
| src/core/{service-client-factory,error-response,rpc-methods,terminal-status,initialization,decode}.ts | 67/32/29/21/21/16 | shared glue |
| src/zod-helpers.ts, messages.ts, utils.ts, offscreen/messages.ts | 63/60/48/15 | validateParams/Result; wire types; wrap/unwrapParams; offscreen `from`/`to` extension |
| src/testing/{port-registry,transport-harness,setup}.ts | 162/149/17 | fake chrome.runtime.connect; harness (only `PortRegistry` exported via `./testing`) |

### Entrypoints / consumers (apps/extension/src / other prod / tests)
`.` empty barrel | `./background` 46/0/2 | `./offscreen` 1/2/5 | `./errors` 40/6/61 | `./messages` 0/1/6 | `./utils` 0/1/1 | `./zod` 4/0/1 | `./testing` 0/1/4. Dependents: apps/extension, aztec-runtime, wallet-bridge.

### Trust boundaries
- Message validation: `core/sender-auth.ts` (only trust background-context senders), `utils.ts` `unwrapParams` (arity cap 256, hostile `n`), `zod-helpers.ts`, `core/hardening.test.ts` pins the hostile-envelope cases.
- Error reconstruction from wire payload: `errors.ts walletErrorFromPayload` (name registry; unknown name -> fallback); `core/error-response.ts` builds response from raw thrown values (uses lenient `getErrorMessage`, can put non-string on wire).
- `resultIsJson` fallback path (client `JSON.parse`s result) in base-client/base-service; `jsonSanitize` before postMessage.
- Logging: `envelope-summary.ts` exists to keep payloads out of logs (Logging policy in CLAUDE.md).
- No storage writes in this package.

### Tests (13): client/service per transport, core.test, hardening, sender-auth, readiness, factory, errors, envelope-summary, utils, port-registry. No test for: zod-helpers.ts, offscreen/telemetry.ts, service-client-factory beyond its file, `decode.ts`, `initialization.ts` (verify).
### Generated/vendored: none. `background/service.ts` has a "Pattern adapted from Grego's port-server" attribution.

---
## 8. Similarity candidates (for dedup audit)

S1 **hex encoding re-implemented next to `bytesToHex`/`getRandomHex` (wallet-core `utils/encoding.ts`, `random.ts`)**:
- apps/extension/src/wallet/services/activity-protocol/coordinator.ts:48-52 `mintNonce()` = `crypto.getRandomValues(16)` + `[...bytes].map(toString(16).padStart)` == `getRandomHex(32)`.
- apps/extension/src/wallet/services/profile/spec.ts:103-107 `mintPxeGeneration()` same thing again (`Array.from(bytes, ...)`). Two copies of each other and of `getRandomHex(32)`.
S2 **base64 re-implemented next to `toBase64`/`fromBase64`**:
- packages/aztec-runtime/src/pxe/client.ts:208 `btoa(String.fromCharCode(...provision.key))` (the exact call-stack-overflow idiom encoding.ts documents avoiding) == `toBase64`.
- packages/aztec-runtime/src/pxe/service.ts:817 `Uint8Array.from(atob(..), c => c.charCodeAt(0))` == `fromBase64`.
- packages/wallet-crypto/src/session-secret-box.ts:96-98 and wallet-fingerprint.ts:37 use Node-style `Buffer.from(..).toString("base64"|"hex")` instead of `toBase64`/`bytesToHex` (same package already imports those helpers in 6 other files). The `zeroize` doc also mentions `tokenCopy` Buffer.
S3 **byte-array equality**: aztec-runtime/src/pxe/service.ts:848 `installed.every((b,i)=>b===key[i])` vs `array_equals` (wallet-core arrays.ts); apps/extension/scripts/extract-bb-wasm.ts:84 inline compare. Also NOTE `array_equals` is non-constant-time yet used by `password-secret-box.ts` (bugs audit).
S4 **sleep**: `wallet-core/utils/sleep.ts` exists; re-implemented inline in apps/extension/src/core/adapters/system-clock.ts:14 (legit: ClockPort impl), stores/app.store.ts:648, execution/gas-balance-reader.ts:227, wallet-sdk/test-ports.ts:17, e2e/migration-fixture.ts:41, plus ~20 `new Promise(r => setTimeout(r, N))` in apps/extension/tests/e2e/fixtures/*.
S5 **withTimeout**: apps/extension/src/stores/balances.store.ts:124 (exported, also auto-imported globally via auto-imports.d.ts); LogsViewer.vue:192 inline race; e2e fixtures journal.ts:327 and extension.ts:1078 `withTimeoutMessage`, chrome.ts:86 inline. No shared helper in wallet-core. `RpcTimeoutError` in extension-messaging is a separate concept but the timer logic is in base-client.ts:289.
S6 **AES-GCM seal/unseal triplicate inside wallet-crypto**: `imported-account-key-box.ts:27-71`, `imported-keys-dek-box.ts:38-61`, `session-secret-box.ts:53-90`, plus `encryption-key.ts`: each does importKey/HKDF->deriveKey AES-GCM + `getRandomValues(12)` + `[iv||ct]` framing with bare `12` literal; no shared `aesGcmSeal/Open`. `nonce-uniqueness.test.ts` is the guard. Dedup must NOT alter bytes (vector-frozen); high-risk refactor, candidate for "note, don't touch".
S7 **TextEncoder label constants**: 10 `new TextEncoder().encode("nulo:...")` label constants spread across 8 files vs `nulo-separators.ts` (registry that only lists some; `nulo-separators.test.ts` presumably pins). Check whether the registry covers dapp-session-mac/pxe-store/fingerprint/imported-dek/session-wrap.
S8 **error JSON projection**: `utils/error-json.ts baseErrorJson` shared by `serialization.ts` and `jobs/error.ts` (already consolidated; `baseErrorJson` has 0 non-defining prod consumers outside its package siblings; verify both call it). `errors.ts`: `getErrorMessage` vs `errorMessageFromUnknown` are two deliberate variants (documented), plus `getErrorData`. apps/packages define 15 more `extends Error` classes outside the registry and only 2 `extends WalletError` outside extension-messaging - review whether the 15 cross the wire (need registry) or are local.
S9 **messaging transports mirror each other**: `background/client.ts` (153) vs `offscreen/client.ts` (180) and `background/service.ts` (108) vs `offscreen/service.ts` (88) share base-client/base-service but still carry parallel timeout constants (`DEFAULT_RPC_TIMEOUT_MS` 60_000 vs `DEFAULT_REQUEST_TIMEOUT_MS` 90_000 vs `DEFAULT_INIT_TIMEOUT_MS` 30_000, `KEEPALIVE_INTERVAL_MS` 20_000, `WARN_AFTER_MS` 10_000) and parallel `messages.ts` types (offscreen version = base & {from,to}). Also overlap between `messages.ts` Response fields and `wallet-bridge` envelopes (not mapped here; cross-check with packages-mid mapper).
S10 **Lock family**: `wallet-core Lock`, `KeyedLock`, `ReadWriteGuard` vs `apps/extension/src/wallet/services/execution/execution-mutex.ts` (`ExecutionMutex`, own abort/capacity errors): same queue/watchdog concern, separately implemented; also `utils/queue.ts`.
S11 `utils/arrays.ts` `hasIntersectionByKeys` + private `safeStringify` (keys joined with `|`, collision-prone) - check consumers (single-consumer helper?).

## Dead-export candidates (zero consumers; evidence: `grep -lw <name>` over all non-test prod .ts/.vue/.js files, excluding the defining file; "own-pkg-only" means used only inside the package)
Method: per-name grep across `git ls-files` ts/vue/js minus tests and `.d.ts`; then again excluding `packages/<pkg>/`.

### Truly zero prod references (not even in-package), test refs in parens
wallet-core: `compareIncarnation`(0 tests), `sameIncarnation`(0), `ActivityScopeReset`(0), `ActivitySnapshotRecord`(0), `ActivityTombstone`(0), `InvalidActivityScopeError`(0), `scopesEqual`(0), `SubscriberErrorReporter`(0), `KeyedLockOptions`(0); test-only: `emptySourceState`, `applyMutation`, `applySnapshot`, `resetScope`, `liveRecords`, `ActivityRevision`, `LockTicket`, `MAX_READER_DRAIN_MS` (1 test file each).
  Note: the whole `./activity` subpath has 5 ext consumers but causal.ts functions (`applyMutation/applySnapshot/resetScope/liveRecords/emptySourceState`) are only reached by `causal.property.test.ts` - the merge algebra may be unused in prod (confirm who uses `./activity`: probably only types/scope helpers).
wallet-crypto: `ENCRYPTION_GUARD` (constants re-export only test; note it is also a documented frozen constant).
extension-messaging: `RequestContentLike`, `NameVouch`, `ErrorResponseContent`, `DEFAULT_INIT_TIMEOUT_MS` (exported, never imported elsewhere), `backgroundContextUrls`, `EventContent/RequestContent/ResponseContent` (messages.ts, type-only, used only inside the defining file), `sanitizeTelemetry`, testing-side `PostedRequest/PortRegistryOptions/FakePort`; test-only: `resetBackgroundContextUrls`, `RECEIVER_GONE_MESSAGE`, `connectServiceClient`, `silentLogger`, `makeSpyLogger`.

### Used only inside own package (no consumer in apps/ or other packages; over-exported or barrel-exposed)
wallet-core: DependencyCycleError/UnknownDependencyError/topologicalPhases/ServiceNode (re-exported via `./base` but the 1 ext consumer and 3 others may use ServiceCollection only), `canTransition`, `TERMINAL_STAGES`, `KNOWN_JOB_ERROR_KINDS`, `TerminalStage`, `RESERVED_KEYS`, `MigratorOptions`, `StagingArea`, `MigrationContext`, `MigrationFailure`, `baseErrorJson`, `DecimalCounter/ActivityMutation/ActivitySnapshot/ApplyDecision/SourceState`.
wallet-crypto: `DAPP_SESSION_MAC_LABEL`, `importDualSecretHkdfKey` (internal only, intended), `NULO_SEPARATOR_LABELS`, `PROFILE_AAD`, `EncryptedProfileSecret`, `PXE_STORE_KDF_LABEL`, `Base64Ciphertext`, `Base64SecretPrf`, `asPasshash` (all re-exported from index.ts, no outside importer).
extension-messaging: `BaseService`, `decodeResult`, `summarizeContent/summarizeMessage/describeUnregisteredName`, `awaitInitialized`, `isBackgroundSender`, `RequestTerminalStatus`, `RpcConnectError`, `CLIENT_DISCONNECTED_MESSAGE`, `WalletErrorPayload`, `remoteErrorFromResponseContent`, message type aliases, telemetry sink classes (`NoopTelemetrySink/LoggingTelemetrySink/MemoryTelemetrySink/TelemetrySink/RequestTelemetry`), `unwrapParams` (used only by service side).
Sub-path entries with ext=0 consumers: `@nulo/extension-messaging` and `@nulo/wallet-core` root barrels (empty by design), `extension-messaging/messages` (1 other-package consumer), `extension-messaging/utils` (1 other consumer). Caveat: name-based grep cannot distinguish same-named symbols (`EventMessage`/`RequestMessage` also defined in wallet-bridge).

---
## 9. For the later BUGS audit

State owners / concurrency:
- wallet-core `migration/migrator.ts`: durable journal marker + attempt counter + staged commit + pre-unlock; crash-window reasoning. Error-path heaviest module in wallet-core.
- wallet-core `utils/lock.ts`, `rw-guard.ts`, `keyed-lock.ts`: watchdog force-release can run a displaced holder's remaining code (documented); `maxHoldMs: null` convention; FIFO writer drain; `alarm-dispatcher.ts`, `event-handler.ts` (subscriber error swallowing).
- wallet-core `jobs/fsm.ts` + `error.ts`: transition table and `normalizeError` hostile-input handling; `IllegalTransitionError`, `JobCancelledSentinel`.
- wallet-core `activity/causal.ts`: incarnation/counter merge (property-tested); DecimalCounter string arithmetic.
- wallet-core `base/topology.ts`: cycle/unknown-dependency detection at startup.
- wallet-core `utils/mnemonic.ts`: checksum/entropy round trip; `canonicalizeMnemonic`.
- wallet-crypto: `session-secret-box.ts` (token/salt/iv generation, plaintext copies `tokenCopy`, zeroization on all paths, Buffer use), `password-secret-box.ts` (seal/unseal/passhash asymmetry, `array_equals` non-constant-time), `passkey-credential.ts` (PRF non-portability, recovery path), `entropy-mac.ts` (MAC compare: verify it is constant-time; `verifyEnvelopeMacV3`), `dual-secret-hkdf.ts` (length check then zeroize of `ikmBytes`), `zeroize.ts` (raw ArrayBuffer branch), `derive-account-seed.ts` (`assertCanonicalL1ChainId`), `mnemonic-master.ts`.
- extension-messaging `core/base-client.ts` (382; pending-request map, per-request timers, terminal records, reconnect-on-port-close, in-flight rejection with plain `Error("Client disconnected")`, `RpcConnectError` no-retry), `core/base-service.ts` (dispatch; `resultIsJson` path; errors to wire), `errors.ts walletErrorFromPayload` (unknown-name/forged-payload handling), `offscreen/client.ts` + `service.ts` (keepalive interval, `sendMessage` broker, receiver-gone detection, telemetry terminal-state once-only), `core/sender-auth.ts` (URL-prefix sender check; trust anchor for privileged RPC), `utils.ts` unwrapParams (hostile `n`), `core/error-response.ts` (lenient `getErrorMessage` leaks non-string onto the wire - acknowledged in a comment, tracked as "Q-01").
- Global mutable state: `sender-auth.ts` `backgroundContextUrls` module-level cache (+ reset fn for tests); `ENCRYPTION_GUARD` and label constants are frozen-by-vector (never edit).

Pre-read docs: packages/wallet-crypto/ATTACK-SURFACE.md, packages/wallet-crypto/README.md (invariants), packages/extension-messaging/README.md (failure taxonomy), packages/wallet-core/README.md (lock invariants).
