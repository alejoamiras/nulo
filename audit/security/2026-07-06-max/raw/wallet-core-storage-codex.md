CLUSTER: wallet-core-storage

## Findings

### [1] Unsigned `DappSession` rows can mint dApp grants and suppress approvals

**Impact factors**: Authorization and integrity violation, with confidentiality exposure for account/private-data reads. Blast radius is a single browser profile/user whose extension storage is tampered with. Sensitive data includes account addresses, wallet-local dApp grants, and potentially private event/address-book surfaces; integrity impact includes unauthorized dApp capability state and silent execution of self-paid dApp operations. Exploitability: local/extension-storage tampering plus network dApp interaction; attack complexity low once storage write is available; privileges required high for the storage write, none for the dApp call after the forged row exists; user interaction none after the wallet is unlocked and the malicious page connects.

**Evidence confidence**: high

**OWASP / CWE mapping**: OWASP A01:2021 Broken Access Control; CWE-863 Incorrect Authorization; CWE-345 Insufficient Verification of Data Authenticity; CWE-502 Deserialization of Untrusted Data.

**Trace**: Tampered `chrome.storage.local` rows enter through the real storage adapter with no authenticity metadata at `apps/extension/src/core/adapters/chrome-browser-api.ts:39` and `apps/extension/src/core/adapters/chrome-browser-api.ts:44`. `EntityStorage` deserializes each row with `JSON.parse(raw as string) as T` at `packages/wallet-core/src/storage/entity_storage.ts:47` and `packages/wallet-core/src/storage/entity_storage.ts:49`, and `getValues()` returns parsed entities without schema or integrity checks at `packages/wallet-core/src/storage/entity_storage.ts:103` and `packages/wallet-core/src/storage/entity_storage.ts:110`. The dApp-session table is backed by that storage at `apps/extension/src/wallet/services/dapp-session/service.ts:53`; `tryGetDappSessionByOriginAndChain()` filters the parsed values only by active profile, `dappMetadata.url`, and `chainId` at `apps/extension/src/wallet/services/dapp-session/service.ts:100`, `apps/extension/src/wallet/services/dapp-session/service.ts:106`, and `apps/extension/src/wallet/services/dapp-session/service.ts:111`. A matching forged row is treated as an existing session and auto-approves discovery without the connect popup at `apps/extension/src/wallet/services/wallet-sdk/background.ts:486` and `apps/extension/src/wallet/services/wallet-sdk/background.ts:488`. Later RPC dispatch reloads the same stored session at `packages/wallet-bridge/src/dispatcher.ts:281`, trusts `dappSession.capabilityGrants` at `packages/wallet-bridge/src/dispatcher.ts:1016`, and uses those grants for capability/scope enforcement at `packages/wallet-bridge/src/dispatcher.ts:299` and `packages/wallet-bridge/src/dispatcher.ts:320`. For account disclosure, a forged `accounts` grant with `canGet: true` passes the checker at `packages/wallet-bridge/src/method-scope-checkers.ts:322` and `packages/wallet-bridge/src/method-scope-checkers.ts:325`, then `handleGetAccounts()` returns the session accounts at `packages/wallet-bridge/src/dispatcher.ts:400` and `packages/wallet-bridge/src/dispatcher.ts:434`. For execution, `DappInteractionService` revalidates against the same forged session row at `apps/extension/src/wallet/services/dapp-interaction/service.ts:346`, `apps/extension/src/wallet/services/dapp-interaction/service.ts:378`, and `apps/extension/src/wallet/services/dapp-interaction/service.ts:421`; it compares the stored `confirmationLevel` without enum/range validation at `apps/extension/src/wallet/services/dapp-interaction/service.ts:442` and `apps/extension/src/wallet/services/dapp-interaction/service.ts:443`, enters the silent path at `apps/extension/src/wallet/services/dapp-interaction/service.ts:195`, and executes operations without an approval window at `apps/extension/src/wallet/services/dapp-interaction/service.ts:335`.

**Missing control**: Persisted authorization rows are not authenticated, MACed, versioned with a verified schema, or constrained at load time. In particular, storage does not reject forged `capabilityGrants`, `accounts`, `permissions`, `expiry`, or out-of-range `confirmationLevel`, and the stored session id is not bound cryptographically to `(profileId, origin, chainId)`.

**Exploit story / violation scenario**:
1. An attacker with write access to the extension’s local storage creates `nulo:core:dappSessions@evil` with valid JSON:
   ```json
   {
     "id": "evil",
     "profileId": "<active-profile-id>",
     "chainId": "<current-chain-id>",
     "dappMetadata": { "url": "https://evil.example", "name": "Evil" },
     "permissions": [{ "methods": [] }],
     "accounts": ["aztec:<current-chain-id>:<victim-account-address>"],
     "confirmationLevel": 999,
     "expiry": 4102444800000,
     "capabilityGrants": [
       { "capability": { "type": "accounts", "canGet": true, "accounts": [] }, "grantedAt": 1 },
       { "capability": { "type": "transaction", "scope": "*" }, "grantedAt": 1 }
     ]
   }
   ```
2. The user later visits `https://evil.example` while the wallet is unlocked.
3. Discovery finds the forged row and calls `approveDiscovery()` without showing the connect approval.
4. `getAccounts` succeeds because the forged `accounts.canGet` grant is trusted.
5. A self-paid `sendTx` with a defined fee payer can pass the capability and dApp-interaction checks; the forged `confirmationLevel: 999` makes `accessLevel >= confirmationLevel` false, so the silent execution path is used instead of an approval popup.

**Preconditions**: The attacker or a corrupted component must be able to write the extension’s `chrome.storage.local` namespace or modify the browser profile storage on disk. The forged row must match the active `profileId`, target origin, and chain id. For silent execution, the wallet must be unlocked, the forged account must exist, and the dApp must supply operation parameters that satisfy the existing materializer and fee gates.

**Why mitigations fail**: `EntityStorage` only catches malformed JSON and deletes parse failures; a syntactically valid forged row is accepted as `T`. TypeScript `DappSession`/`AccessLevel` types are erased at runtime. Dispatcher method metadata, `Object.hasOwn`, `checkGetAccounts`, and `enforceScopeWithSession` validate the dApp request against the stored grants, but do not verify that the grants were produced by a prior user approval. `DappInteractionService.validateSession()` also checks against the same forged stored session, and the confirmation gate trusts the stored numeric `confirmationLevel`.

**Instances**: `packages/wallet-core/src/storage/entity_storage.ts:49`; `packages/wallet-core/src/storage/entity_storage.ts:103`; `apps/extension/src/wallet/services/dapp-session/service.ts:53`; `apps/extension/src/wallet/services/dapp-session/service.ts:68`; `apps/extension/src/wallet/services/dapp-session/service.ts:79`; `apps/extension/src/wallet/services/dapp-session/service.ts:100`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:486`; `packages/wallet-bridge/src/dispatcher.ts:281`; `packages/wallet-bridge/src/dispatcher.ts:1016`; `apps/extension/src/wallet/services/dapp-interaction/service.ts:443`.

### [2] Malformed `ValueStorage` rows abort wallet startup

**Impact factors**: Availability violation. Blast radius is one user/profile; a persistent malformed `nulo:config` row can keep the background runtime from starting, and a malformed `nulo:core:session` row can fail service initialization during restore. Data sensitivity is low, but wallet availability is security-relevant because the user cannot operate or lock/unlock normally through the broken service graph. Exploitability: local/extension-storage tampering; attack complexity low; privileges required high for storage write or browser-profile tampering; user interaction none.

**Evidence confidence**: high

**OWASP / CWE mapping**: OWASP A05:2021 Security Misconfiguration / A08:2021 Software and Data Integrity Failures; CWE-248 Uncaught Exception; CWE-20 Improper Input Validation; CWE-502 Deserialization of Untrusted Data.

**Trace**: `ValueStorage.get()` reads the raw storage slot at `packages/wallet-core/src/storage/value-storage.ts:18` and directly calls `JSON.parse(res[this.root] as string)` with no `try/catch`, delete, or fallback at `packages/wallet-core/src/storage/value-storage.ts:21`. `ConfigStore` stores `nulo:config` through `ValueStorage` at `apps/extension/src/wallet/config/store.ts:10`, and `load()` awaits `this.storage.get()` without handling parse errors at `apps/extension/src/wallet/config/store.ts:17` and `apps/extension/src/wallet/config/store.ts:18`. Runtime startup awaits `config.load()` before registering/starting services at `apps/extension/src/wallet/runtime.ts:95` and `apps/extension/src/wallet/runtime.ts:97`; service startup is later at `apps/extension/src/wallet/runtime.ts:149`, so a malformed config row aborts before services start. The top-level service worker catches `runtime.start()` only to log the failure at `apps/extension/src/wallet/index.ts:80` and `apps/extension/src/wallet/index.ts:81`, leaving the bad row in place. The same parser backs session restore: `SessionManager` creates `ValueStorage<Session>` for `nulo:core:session` at `apps/extension/src/wallet/services/profile/session-manager.ts:137` and `apps/extension/src/wallet/services/profile/session-manager.ts:138`, `restore()` parses it at `apps/extension/src/wallet/services/profile/session-manager.ts:335` and `apps/extension/src/wallet/services/profile/session-manager.ts:336`, and `ProfileService.init()` awaits restore at `apps/extension/src/wallet/services/profile/service.ts:122` and `apps/extension/src/wallet/services/profile/service.ts:130`. `BaseService.start()` marks a service initialized only after `init()` returns at `packages/extension-messaging/src/core/base-service.ts:63` and `packages/extension-messaging/src/core/base-service.ts:66`, so the thrown parse aborts service graph startup.

**Missing control**: `ValueStorage` lacks the malformed-row containment that `EntityStorage.parseOrDelete()` implements. It should catch parse failures, log bounded metadata, delete or quarantine the bad scalar row, and return a safe default/`undefined` according to the caller’s policy.

**Exploit story / violation scenario**:
1. An attacker or corrupted extension context writes a non-JSON string such as `{bad` into `chrome.storage.local["nulo:config"]`.
2. On the next service-worker start, `ConfigStore.load()` calls `ValueStorage.get()`.
3. `JSON.parse` throws, `runtime.start()` rejects before services are started, and the top-level catch only logs the error.
4. Because the malformed row remains in persistent storage, every restart hits the same failure until storage is manually repaired or wiped.

A parallel session-storage variant is `chrome.storage.session["nulo:core:session"] = "{bad"`, which causes `SessionManager.restore()` to throw during `ProfileService` initialization and abort the service phase.

**Preconditions**: The attacker/corruption must be able to write `chrome.storage.local["nulo:config"]` or `chrome.storage.session["nulo:core:session"]`. For the persistent config variant, the row survives service-worker restarts.

**Why mitigations fail**: The per-row malformed JSON defense exists only in `EntityStorage` at `packages/wallet-core/src/storage/entity_storage.ts:47`; `ValueStorage` does not use it. Runtime’s top-level `.catch()` logs but does not repair or delete the malformed row. `SessionManager.restore()` comments cover TTL, wrong credentials, and corrupted ciphertext, but the unhandled JSON parse occurs before those restore policies can run.

**Instances**: `packages/wallet-core/src/storage/value-storage.ts:21`; `apps/extension/src/wallet/config/store.ts:10`; `apps/extension/src/wallet/config/store.ts:18`; `apps/extension/src/wallet/services/profile/session-manager.ts:138`; `apps/extension/src/wallet/services/profile/session-manager.ts:336`.