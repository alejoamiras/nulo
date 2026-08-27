# Repo map: extension-messaging + wallet-core + wallet-crypto

Dependency direction (no cycles): `wallet-core` (leaf) ← `wallet-crypto`, `wallet-core` ← `extension-messaging`.
`wallet-crypto` and `extension-messaging` do not depend on each other.

## 1. Module inventory (excl. `*.test.ts`)

### packages/extension-messaging/src (2170 LOC)
| Path | Purpose | LOC |
|---|---|---|
| `errors.ts` | `WalletError` hierarchy (11 subclasses), payload round-trip | 344 |
| `core/base-client.ts` | Shared request-correlator core (pending map, timeout, settle) | 300 |
| `testing/transport-harness.ts` | Port/sendMessage fakes for client/service tests | 244 |
| `core/base-service.ts` | Shared service-side request lifecycle (RPC guard, 3-tier send) | 220 |
| `background/client.ts` | `ServiceClient` over `chrome.runtime.Port` (popup↔SW) | 173 |
| `offscreen/telemetry.ts` | Terminal-status telemetry sinks for offscreen client | 168 |
| `offscreen/client.ts` | `ServiceClient` over `sendMessage` (SW↔offscreen) | 151 |
| `background/service.ts` | `Service` over Port (fan-out to N popup clients) | 107 |
| `zod-helpers.ts` | `validateParams`/`validateResult` (optional zod peer) | 63 |
| `offscreen/service.ts` | `Service` over sendMessage + SW keepalive | 80 |
| `messages.ts` | `MessageType` enum + envelope shapes | 57 |
| `utils.ts` | `wrapParams`/`unwrapParams` | 48 |
| `core/service-client-factory.ts` | Factory helper for client construction | 43 |
| `core/rpc-methods.ts` | `defineRpcMethods<T>()` RPC-surface declarator | 29 |
| `core/error-response.ts` | `buildErrorResponseContent` (WalletError→wire) | 25 |
| `core/sender-auth.ts` | `isTrustedInternalSender` (F-09 sender check) | 23 |
| `core/initialization.ts` | `awaitInitialized` poll helper | 21 |
| `index.ts` | Barrel (empty, docs-only) | 18 |
| `testing/setup.ts` | Test bootstrap | 17 |
| `core/decode.ts` | `decodeResult` (JSON-fallback decode) | 16 |
| `offscreen/messages.ts`, `background/index.ts`, `offscreen/index.ts` | Envelope re-exports / barrels | 23 |

### packages/wallet-core/src (5358 LOC)
| Path | Purpose | LOC |
|---|---|---|
| `utils/mnemonic.ts` | BIP-39 wordlist + mnemonic encode/decode | 2160 |
| `migration/migrator.ts` | Storage-migration engine (runs registry, backups) | 388 |
| `testing/fake-browser-api.ts` | Fake `chrome.*` surface (storage/runtime/windows/alarms) | 296 |
| `activity/causal.ts` | Causal-order activity-log merge | 267 |
| `utils/rw-guard.ts` | `ReadWriteGuard` — reader/writer concurrency guard | 203 |
| `jobs/types.ts` | Durable-job type surface | 154 |
| `storage/entity_storage.ts` | `EntityStorage<T>` keyed-row CRUD | 163 |
| `activity/model.ts` | Activity-log record model | 126 |
| `jobs/fsm.ts` | Job finite-state-machine | 106 |
| `base/topology.ts` | Service topology / dependency graph | 105 |
| `testing/mock-clock.ts` | Fake timers | 96 |
| `migration/types.ts` | Migration DSL types (`defineRowMapMigration` etc.) | 100 |
| `jobs/error.ts` | `normalizeError` — hostile-input-safe `JobError` envelope | 72 |
| `utils/lock.ts` | `Lock` — FIFO mutex with force-release | 69 |
| `base/index.ts` | `ServiceCollection` + base types | 71 |
| `activity/scope.ts` | Activity scoping helpers | 59 |
| `utils/serialization.ts` | Circular-safe JSON helpers | 57 |
| `testing/fake-background-ticker.ts` | Fake alarm-driven ticker | 66 |
| `utils/arrays.ts` | `array_max`/`array_equals` etc. | 53 |
| `utils/queue.ts` | `Queue<TKey,TValue>` — dedup FIFO | 50 |
| `logger/interfaces.ts` | `ILogger`/`LogLevel` | 49 |
| `ports/runtime-port.ts` | `chrome.runtime` port interface | 68 |
| `utils/encoding.ts` | `bytesToHex`/`toBase64`/`fromBase64` | 39 |
| `ports/background-ticker-port.ts`, `storage-port.ts`, `alarms-port.ts`, `window-port.ts`, `clock-port.ts`, `browser-api.ts` | I/O boundary interfaces | ~171 |
| `utils/event-handler.ts` | `EventHandler<T>` pub/sub | 29 |
| `utils/errors.ts` | `getErrorMessage`/`errorMessageFromUnknown` | 29 |
| `utils/error-json.ts` | `baseErrorJson` | 24 |
| `migration/staging.ts` | Migration backup staging | 70 |
| others (`ports/*`, `storage/*`, `utils/random.ts`, `utils/sleep.ts`, index barrels) | small (≤44 LOC each) | ~140 |

### packages/wallet-crypto/src (846 LOC)
| Path | Purpose | LOC |
|---|---|---|
| `password-secret-box.ts` | Password-based wrap around `EncryptionKey` | 200 |
| `session-secret-box.ts` | Session-key wrap (unlock-session persistence) | 135 |
| `encryption-key.ts` | PBKDF2 + AES-GCM framed ciphertext | 127 |
| `secret-types.ts` | Branded base64/hex secret types | 105 |
| `passkey-credential.ts` | WebAuthn PRF → HKDF master-secret | 86 |
| `zeroize.ts` | Best-effort buffer zeroing | 49 |
| `index.ts` | Public barrel (only package with real exports) | 41 |
| `account-derivation.ts` | Nulo account key derivation from seed | 38 |
| `pxe-store-key.ts` | PXE-store KDF | 34 |
| `globals.d.ts` | ambient types | 21 |
| `constants.ts` | KDF labels | 10 |

## 2. Public exports

- **extension-messaging**: barrel is intentionally empty (`export {}`); real surface is subpath exports — `./background`, `./offscreen` (`Service`/`ServiceClient` pairs), `./errors`, `./messages`, `./utils`, `./zod`.
- **wallet-core**: same empty-barrel + subpath pattern — `./ports`, `./utils`, `./storage`, `./migration`, `./base`, `./logger`, `./jobs`, `./activity`, `./testing`.
- **wallet-crypto**: single `.` export, real barrel — `EncryptionKey`, `PasswordSecretBox`, `SessionSecretBox`, `PasskeyCredential`, `deriveNuloAccountKeys`, `deriveSigningKeyFromSeed`, `derivePxeStoreKey`, `zeroize`, branded secret types.

## 3. Coupling surfaces + cross-package deps

- `extension-messaging` → `@nulo/wallet-core` (`workspace:*`): imports `ILogger`/`LogLevel`, `EventHandler`, `jsonSanitize`/`jsonStringify`, `sleep`, `getErrorMessage`, `getRandomHex`, and base types (`EventsMap`, `MethodsMap`, `IService`, `ServiceCollection`).
- `wallet-crypto` → `@nulo/wallet-core` (`workspace:*`): imports `toBase64`/`fromBase64`, `array_equals` from `utils`. Correctly reuses wallet-core's encoders rather than reimplementing (no duplication here).
- `wallet-crypto` → `@aztec/{accounts,constants,foundation}` (external, not part of this cluster).
- `extension-messaging` ↔ `wallet-crypto`: **no direct coupling** — they only share `wallet-core` as a common base.
- Both `extension-messaging` client transports (`background/client.ts`, `offscreen/client.ts`) extend `BaseServiceClient` and both service transports extend `BaseService` — this is the *intra*-package coupling surface the base classes were built to absorb.

## 4. Frameworks/libs

- No UI framework in any of the three (headless kernel + messaging + crypto).
- `extension-messaging`: `chrome.*` typings (`chrome-types`), optional peer `zod` (`^4`), `@webext-core/fake-browser` (dev/test).
- `wallet-core`: no runtime deps; devDeps only (`fast-check` for property tests, `@webext-core/fake-browser`, `jsdom`).
- `wallet-crypto`: `@aztec/accounts` / `@aztec/constants` / `@aztec/foundation` (Aztec math), Web Crypto (`crypto.subtle`) — no npm crypto lib.
- All three: `vitest`, `typescript`.

## 5. Apparent duplication candidates (audit focus)

1. **`errors.ts` WalletError subclass boilerplate (extension-messaging, 344 LOC file).** 11 subclasses (`RpcTimeoutError`, `RpcDisconnectedError`, `UserRejectedError`, `JobCancelledError`, `CapabilityNotGrantedError`, `TooManyPendingError`, `ValidationError`, `InvalidPasswordError`, `AccountAddressInconsistencyError`, `RestoreTornError`, `ProfileIdConflictError`) each repeat the identical 3-line ctor tail: `this.name = "X"; Object.setPrototypeOf(this, X.prototype)`. Classic extract-a-helper (or base-class ctor) candidate — ~30 duplicated lines total.

2. **Client-side error-shaping quartet duplicated between `background/client.ts` and `offscreen/client.ts`.** Both subclasses implement `makeRemoteError` (byte-identical body: `remoteErrorFromResponseContent(content)`), `makeTimeoutError`, `makeSendFailureError`, and `makeDisconnectError` (byte-identical: `new Error(CLIENT_DISCONNECTED_MESSAGE)`) with only the interpolated message string differing between the two `makeTimeoutError`/`makeSendFailureError` bodies. The offscreen file's own comment ("parity with the background transport") names this. Note: `BaseServiceClient`/`BaseService` themselves are a **already-deduplicated** template-method pair (explicit doc comment: "owns the mechanics that were duplicated and drift-prone across the two forks") — this quartet is the residual duplication the base-class refactor left behind.

3. **Lock-like concurrency primitives split across `utils/lock.ts` (`Lock`, 69 LOC) and `utils/rw-guard.ts` (`ReadWriteGuard`, 203 LOC), both in wallet-core.** Both independently implement: a named+logger ctor, a force-release timer keyed off a max-hold constant, FIFO waiter queues via callback/deferred arrays, and near-identical debug-log phrasing ("Lock: force-released…" / "ReadWriteGuard: force-released…"). Not a copy-paste duplicate (different concurrency shape — simple mutex vs. reader/writer), but the force-release-timer + FIFO-waiter-queue skeleton is reimplemented rather than shared, and is a candidate for a common "guarded resource with a debug-logged force-release" base.

Minor/lower-confidence: `jobs/error.ts` (`normalizeError`, wallet-core) and `errors.ts` (`WalletError`, extension-messaging) both build a "hostile-input-safe error envelope" independently (different target shapes — storage `JobError` vs. wire `WalletErrorPayload` — so likely not worth merging, but worth a second look during triage).
