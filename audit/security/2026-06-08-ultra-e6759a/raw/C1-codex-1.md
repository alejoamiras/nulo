# C1 — dApp-bridge dispatcher + scope enforcement (Codex xhigh Pass 1)

## Findings

### 1. Accounts are disclosed even when the `accounts` grant sets `canGet: false`
**Impact factors:** Confidentiality and authorization. Blast radius is every account address and alias the user selected for that dApp session on the current chain. Exploitability is low-complexity: a malicious dApp only needs the user to approve an `accounts` grant and select accounts; no extra privileges are required.

**Evidence confidence:** high

**OWASP / CWE mapping:** OWASP A01 Broken Access Control; CWE-862 Missing Authorization

**Trace:** dApp-supplied manifest with `type: "accounts"` and `canGet: false` enters `requestCapabilities()` at `packages/wallet-bridge/src/dispatcher.ts:235-236` and `packages/wallet-bridge/src/dispatcher.ts:504-510` -> approved `selectedAccounts` are merged into `session.accounts` at `packages/wallet-bridge/src/dispatcher.ts:614-631` -> the response path still emits `accounts: [...]` even while echoing `canGet: false` at `packages/wallet-bridge/src/dispatcher.ts:689-713` and returns it at `packages/wallet-bridge/src/dispatcher.ts:665-669` -> the same dApp can later call `getAccounts()`, which returns `session.accounts` immediately at `packages/wallet-bridge/src/dispatcher.ts:288-297` and `packages/wallet-bridge/src/dispatcher.ts:325-337` without any `canGet` check. The UI also hides the explicit "Read your account addresses" bullet when `canGet === false` at `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:47-50`, while the accounts capability is not rendered as a normal permission card in the capabilities popup at `packages/extension/src/popup/windows/capabilities/index.vue:294-309`.

**Missing control:** The dispatcher never authorizes `AccountsCapability.canGet` before returning account data. `canGet` is treated as metadata, not as an enforced read permission.

**Exploit story:** 1. A malicious dApp requests an `accounts` capability with `canGet: false` and some other legitimate reason to share accounts, such as `registerToken` or `canCreateAuthWit`. 2. The user selects one or more accounts in the popup. 3. The dispatcher stores those selections in `session.accounts`. 4. `requestCapabilities()` immediately returns the selected account addresses and aliases in the `granted` payload anyway. 5. If needed, the dApp can call `getAccounts()` later and the dispatcher will return the same accounts again, still without enforcing `canGet`.

**Preconditions:** The user approves an `accounts` capability request and selects at least one account.

**Why mitigations fail:** `getAccounts` is exempt from top-level capability checks in `packages/wallet-bridge/src/capability-map.ts:14`, and the method-specific handler only checks whether an `accounts` grant exists at all, not whether that grant allowed reading accounts. The response builder for `requestCapabilities()` similarly injects the account list regardless of `canGet`.

**Instances:** `packages/wallet-bridge/src/capability-map.ts:14`; `packages/wallet-bridge/src/dispatcher.ts:288-297`; `packages/wallet-bridge/src/dispatcher.ts:325-337`; `packages/wallet-bridge/src/dispatcher.ts:614-631`; `packages/wallet-bridge/src/dispatcher.ts:658-669`; `packages/wallet-bridge/src/dispatcher.ts:689-713`; `packages/extension/src/components/composite/capabilities/CapabilityDetailPanel.vue:47-50`; `packages/extension/src/popup/windows/capabilities/index.vue:294-309`

### 2. `getPrivateEvents` accepts unauthorized `eventFilter.scopes` and forwards them to PXE
**Impact factors:** Confidentiality and authorization. Blast radius is private events for any locally registered account on the same chain, as long as the dApp already has `data.privateEvents` access to the target contract. Exploitability is low-complexity and silent after the initial grant.

**Evidence confidence:** high

**OWASP / CWE mapping:** OWASP A01 Broken Access Control; CWE-862 Missing Authorization

**Trace:** dApp calls `getPrivateEvents(eventMetadata, eventFilter)` with an allowed `contractAddress` but attacker-chosen `eventFilter.scopes` -> `dispatch()` performs only type-level grant checking at `packages/wallet-bridge/src/dispatcher.ts:227-232` and `packages/wallet-bridge/src/dispatcher.ts:729-743` -> `enforceScope()` only validates `eventFilter.contractAddress` at `packages/wallet-bridge/src/scope-enforcement.ts:153-167` -> the unvalidated `eventFilter` is materialized unchanged into the operation at `packages/wallet-bridge/src/dispatcher.ts:788-793` -> the operation is executed at `packages/extension/src/wallet/services/execution/service.ts:969-970` and the full `eventFilter` is forwarded to PXE at `packages/extension/src/wallet/services/execution/service.ts:1638-1640`. The only account-scope validator I found is `checkScopesPermissions()` at `packages/extension/src/wallet/services/dapp-interaction/service.ts:423-426`, but the wallet-sdk dispatcher path for `getPrivateEvents` never invokes it.

**Missing control:** The dispatcher never checks that every address in `eventFilter.scopes` is present in the dApp session's allowed account list.

**Exploit story:** 1. The user grants a dApp `data.privateEvents` access for contract `C`. 2. The dApp learns another wallet account address on the same chain, `B`, that was never shared with the dApp. 3. It calls `getPrivateEvents` for contract `C` but sets `eventFilter.scopes = [B]`. 4. The bridge accepts the request because `contractAddress` is in-scope. 5. PXE returns private events for `B`, leaking data from an account outside the dApp's authorized session scope.

**Preconditions:** Another account on the same profile/chain exists and has private events for the allowed contract; the dApp knows that address; the user previously granted `data.privateEvents` for that contract.

**Why mitigations fail:** The bridge's scope checker treats contract scope as sufficient. The codebase does contain an "Unauthorized scopes" check, but only in the popup interaction service path, not in the wallet-sdk dispatcher path used here.

**Instances:** `packages/wallet-bridge/src/scope-enforcement.ts:153-167`; `packages/wallet-bridge/src/dispatcher.ts:227-232`; `packages/wallet-bridge/src/dispatcher.ts:729-743`; `packages/wallet-bridge/src/dispatcher.ts:788-793`; `packages/extension/src/wallet/services/dapp-interaction/service.ts:359-361`; `packages/extension/src/wallet/services/dapp-interaction/service.ts:423-426`; `packages/extension/src/wallet/services/execution/service.ts:969-970`; `packages/extension/src/wallet/services/execution/service.ts:1638-1640`

### 3. Extra scope lists on simulation / utility / send paths bypass the session account allow-list
**Impact factors:** Confidentiality and authorization, with possible integrity impact on `sendTx` because the widened scopes are also used during proving. Blast radius is any additional local account on the same chain whose address the dApp supplies in `opts.scopes` or `opts.additionalScopes`. Exploitability is low-complexity once the dApp has a valid simulation or transaction grant for an allowed contract/function; `simulateTx`, `executeUtility`, and `profileTx` are silent, and the `sendTx` approval popup does not surface these extra scope lists.

**Evidence confidence:** moderate

**OWASP / CWE mapping:** OWASP A01 Broken Access Control; CWE-862 Missing Authorization

**Trace:** dApp sends `simulateTx(..., { additionalScopes: [...] })`, `executeUtility(call, { scopes: [...] })`, `profileTx(..., { additionalScopes: [...] })`, or `sendTx(..., { additionalScopes: [...] })` -> `dispatch()` only checks contract/function targets via `packages/wallet-bridge/src/scope-enforcement.ts:90-107`, `packages/wallet-bridge/src/scope-enforcement.ts:109-129`, and `packages/wallet-bridge/src/scope-enforcement.ts:132-150` after `packages/wallet-bridge/src/dispatcher.ts:227-232` -> the dispatcher forwards the unvalidated scope-bearing options unchanged via `packages/wallet-bridge/src/dispatcher.ts:401-417`, `packages/wallet-bridge/src/dispatcher.ts:419-432`, and `packages/wallet-bridge/src/dispatcher.ts:829-856` -> `sendTx` also passes through `validateSession()` in `packages/extension/src/wallet/services/dapp-interaction/service.ts:340-385`, but that validator checks only the primary account and method, not `additionalScopes` -> execution sinks feed the attacker-supplied addresses into PXE: `simulateTx` at `packages/extension/src/wallet/services/execution/service.ts:1803-1819`, `executeUtility` at `packages/extension/src/wallet/services/execution/service.ts:1832-1835`, `profileTx` at `packages/extension/src/wallet/services/execution/service.ts:1846-1851`, standard `sendTx` proving at `packages/extension/src/wallet/services/execution/service.ts:1966-1967`, and NO_FROM `sendTx` discovery/proving at `packages/extension/src/wallet/services/execution/service.ts:2098-2153`.

**Missing control:** No wallet-sdk dispatcher path validates `opts.scopes` or `opts.additionalScopes` against `session.accounts`.

**Exploit story:** 1. The user grants a dApp simulation access for a contract/function that is legitimately in-scope. 2. The dApp submits `executeUtility` or `simulateTx` using its authorized account `A`, but includes another wallet account `B` in `opts.scopes` or `opts.additionalScopes`. 3. The bridge validates only the contract/function target, not the extra scope list. 4. PXE executes the call with the widened scope set, so the contract can read or depend on private state from `B` even though `B` was never shared with the dApp. 5. For `sendTx`, the same widened scope list reaches proof/discovery, so the dApp can attempt a transaction with broader private-state scope than the session allowed.

**Preconditions:** Another account exists in the same profile and chain; the dApp knows that account's address; the allowed contract/function can read or otherwise act on data from the supplied extra scope addresses.

**Why mitigations fail:** The bridge's per-call scope logic only reasons about target contracts/functions. The only explicit `"Unauthorized scopes"` helper in the codebase is limited to the private-events validator and is not reused here.

**Instances:** `packages/wallet-bridge/src/scope-enforcement.ts:90-107`; `packages/wallet-bridge/src/scope-enforcement.ts:109-129`; `packages/wallet-bridge/src/scope-enforcement.ts:132-150`; `packages/wallet-bridge/src/dispatcher.ts:382-432`; `packages/wallet-bridge/src/dispatcher.ts:829-856`; `packages/extension/src/wallet/services/dapp-interaction/service.ts:340-385`; `packages/extension/src/wallet/services/execution/service.ts:1803-1819`; `packages/extension/src/wallet/services/execution/service.ts:1832-1835`; `packages/extension/src/wallet/services/execution/service.ts:1846-1851`; `packages/extension/src/wallet/services/execution/service.ts:1966-1967`; `packages/extension/src/wallet/services/execution/service.ts:2098-2153`

### 4. Deleting or expiring the stored dApp session does not revoke network-only capability-gated methods on the live wallet-sdk channel
**Impact factors:** Authorization bypass after disconnect or expiry. Blast radius is the current profile and chain for every network-only method that depends on capabilities: confidentiality for `getPrivateEvents` and `getAddressBook`, and integrity for `registerSender` / `registerContract`. Exploitability is low-complexity for a dApp that already holds a live encrypted wallet-sdk session; user interaction is required only for the original connection and the later disconnect/expiry event.

**Evidence confidence:** high

**OWASP / CWE mapping:** OWASP A01 Broken Access Control; CWE-862 Missing Authorization

**Trace:** the user disconnects a connected app from settings at `packages/extension/src/popup/pages/settings/connected-apps/[id].vue:120-126`, which deletes only the stored `DappSession` at `packages/extension/src/wallet/services/dapp-session/service.ts:274-283` -> background transport cleanup only happens on wallet-sdk `onSessionTerminated` at `packages/extension/src/wallet/services/wallet-sdk/background.ts:184-187`, so the existing `ActiveSession` remains usable -> subsequent encrypted wallet messages are still accepted at `packages/extension/src/wallet/services/wallet-sdk/background.ts:189-245` and routed through `handleWalletMessage()` at `packages/extension/src/wallet/services/wallet-sdk/background.ts:495-528` -> `enforceCapability()` explicitly returns an empty grant set when `tryGetDappSessionByOriginAndChain()` misses at `packages/wallet-bridge/src/dispatcher.ts:735-736` -> `dispatch()` then continues to build and execute network-only operations at `packages/wallet-bridge/src/dispatcher.ts:265-269`, `packages/wallet-bridge/src/dispatcher.ts:755-758`, and `packages/wallet-bridge/src/dispatcher.ts:780-814` -> privileged sinks still run, for example `aztec_getPrivateEvents` at `packages/extension/src/wallet/services/execution/service.ts:1638-1640`, `aztec_getAddressBook` at `packages/extension/src/wallet/services/execution/service.ts:1655-1660`, `aztec_registerSender` at `packages/extension/src/wallet/services/execution/service.ts:1650-1652`, `aztec_registerContract` at `packages/extension/src/wallet/services/execution/service.ts:1663-1705`, `aztec_getContractMetadata` at `packages/extension/src/wallet/services/execution/service.ts:1589-1635`, and `aztec_getContractClassMetadata` at `packages/extension/src/wallet/services/execution/service.ts:1578-1586`.

**Missing control:** Missing-session capability enforcement does not fail closed for network-only methods, and the background service never tears down `ActiveSession`s when the underlying `DappSession` is deleted or expires.

**Exploit story:** 1. A user connects a dApp and grants it `data` or `contracts` capability. 2. The user later disconnects that app from Settings, or the stored dApp session expires. 3. The website keeps its tab open, so its encrypted wallet-sdk transport session remains live. 4. The malicious dApp immediately calls a network-only method such as `getPrivateEvents`, `getAddressBook`, or `registerContract`. 5. Because `enforceCapability()` treats the missing stored session as "let the handler deal with it," and these handlers do not re-check session existence, the method still executes after revocation.

**Preconditions:** A live wallet-sdk `ActiveSession` already exists for the dApp tab, and the user disconnects the stored session or lets it expire without the tab losing its transport session.

**Why mitigations fail:** The design separates wallet-sdk transport sessions from stored dApp sessions, but revocation only deletes the latter. The dispatcher assumes non-exempt methods will perform their own missing-session checks; the network-only capability-gated methods do not.

**Instances:** `packages/wallet-bridge/src/dispatcher.ts:729-743`; `packages/wallet-bridge/src/dispatcher.ts:755-814`; `packages/extension/src/popup/pages/settings/connected-apps/[id].vue:120-126`; `packages/extension/src/wallet/services/dapp-session/service.ts:274-283`; `packages/extension/src/wallet/services/dapp-session/service.ts:291-306`; `packages/extension/src/wallet/services/wallet-sdk/background.ts:184-187`; `packages/extension/src/wallet/services/wallet-sdk/background.ts:189-245`; `packages/extension/src/wallet/services/wallet-sdk/background.ts:495-528`; `packages/extension/src/wallet/services/execution/service.ts:1578-1586`; `packages/extension/src/wallet/services/execution/service.ts:1589-1640`; `packages/extension/src/wallet/services/execution/service.ts:1650-1705`

## Non-findings
- `batch` does not bypass popup gating for `sendTx` or `registerToken`; the dispatcher rejects those legs server-side at `packages/wallet-bridge/src/dispatcher.ts:349-364`, and nested batches recurse through the same check.
- Prototype-style method names such as `__proto__` or `constructor` do not reach any privileged dispatcher property or service call in this cluster; they only turn into errors through map lookups.
- Session lookup is correctly keyed by active profile plus `(origin, chainId)` in `packages/extension/src/wallet/services/dapp-session/service.ts:85-99`; I found no cross-network session bleed between the same origin on different chains.
- `registerToken` does validate the dApp-supplied account against the session allow-list before popup handoff at `packages/wallet-bridge/src/dispatcher.ts:456-477`; I found no silent substitution of an unauthorized account there.
- The reviewed token-metadata popups render `name` and `symbol` through Vue interpolation, not HTML sinks, at `packages/extension/src/popup/windows/execute/OperationCard.vue:213-236` and `packages/extension/src/popup/components/popups/TokenMetadataPopup.vue:84-97`; I found no concrete script-injection path from token metadata in this cluster.
- `getAccounts` before any accounts grant correctly fails closed with `CapabilityNotGrantedError` at `packages/wallet-bridge/src/dispatcher.ts:309-316`; I found no pre-grant account disclosure path.
