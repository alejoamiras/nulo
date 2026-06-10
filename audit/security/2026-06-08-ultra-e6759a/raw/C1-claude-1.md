# C1 — dApp-bridge dispatcher + scope enforcement (Claude Opus Pass 1)

## Findings

### Finding 1 — `getAccounts` exempt from capability enforcement bypasses `canGet:false` field on `accounts` grant

**Title**: `getAccounts` returns session accounts even when the `accounts` capability was explicitly granted with `canGet:false` — authority-escalation bypass of the only sub-field gating account-disclosure.

**Impact factors**:
- CIA+A: **Confidentiality** + **Authorization**. The dApp obtains the list of session-authorized addresses (CAIP-10 form) that the user explicitly de-selected on the `canGet` field at consent time.
- Blast radius: any dApp with an `accounts` grant, regardless of `canGet` value. The user thinks they granted "you can authwit but cannot read addresses" yet the dApp can list addresses.
- Exploitability: AV:Network / AC:Low / PR:None / UI:None (already-granted session). The dApp just calls `getAccounts` after the user grants `accounts` with `canGet:false`.

**Evidence confidence**: **high** — concrete trace, no inferred control-flow.

**OWASP / CWE mapping**: A01:2021 Broken Access Control — **CWE-863** (Incorrect Authorization), **CWE-285** (Improper Authorization).

**Trace** (source → sink):
1. Source: dApp wire call `getAccounts()` → `WalletSdkDispatcher.dispatch(methodName="getAccounts", …)` at `packages/wallet-bridge/src/dispatcher.ts:227`.
2. `enforceCapability("getAccounts", …)` at `packages/wallet-bridge/src/dispatcher.ts:229` → `isCapabilityExempt("getAccounts")` at `packages/wallet-bridge/src/capability-map.ts:14` returns `true` because `"getAccounts"` is in the `EXEMPT_METHODS` set → returns `[]` immediately.
3. `enforceScope` is skipped at `packages/wallet-bridge/src/dispatcher.ts:230-232` because `grants.length === 0`. Note: `METHOD_SCOPE_CHECKER` in `packages/wallet-bridge/src/scope-enforcement.ts:269-279` also has no entry for `getAccounts`.
4. Dispatch routes to `handleGetAccounts(ctx)` at `packages/wallet-bridge/src/dispatcher.ts:288`.
5. Fast-path branch at `packages/wallet-bridge/src/dispatcher.ts:295-297`: `if (dappSession.accounts && dappSession.accounts.length > 0) return this.formatSessionAccounts(...)`. No read of `g.capability.canGet`.
6. Sink: `formatSessionAccounts` at `packages/wallet-bridge/src/dispatcher.ts:325-337` returns `Array<{ alias, item: address }>` — the session's authorized addresses.

**Missing control**: `handleGetAccounts` never inspects the `canGet` field on any `accounts`-typed grant before returning addresses. The `accountsCapsEqual` helper (`dispatcher.ts:146-148`) and the popup UI both read `canGet`, but the actual access decision does not.

**Exploit story**:
1. User has Nulo extension and visits a malicious dApp `https://evil.example`.
2. dApp calls `requestCapabilities({ capabilities: [{ type: "accounts", canGet: false, canCreateAuthWit: true }] })`.
3. User reviews popup; UI says "create authwits only, will not read your addresses." User approves.
4. Dispatcher persists `{ capability: { type: "accounts", canGet: false, canCreateAuthWit: true, accounts: [{alias, item}] }, grantedAt: … }`.
5. dApp immediately calls `getAccounts()`. Dispatcher returns the full address list.
6. dApp now has a per-user persistent identifier (CAIP-10 addresses) it was told it would not get.

**Preconditions**: An `accounts` capability is granted (any value of `canGet`, including `false`), and `dappSession.accounts` is non-empty. Both are conditions the dApp can force by requesting `accounts` capability via the standard flow.

**Why mitigations fail**:
- `enforceCapability` cannot guard: `getAccounts` is hard-coded exempt at `capability-map.ts:14`.
- The popup-displayed `canGet:false` badge is purely cosmetic — the actual access decision ignores it.
- `formatSessionAccounts` redacts nothing — every CAIP address whose prefix matches `aztec:<chainId>:` is returned (`dispatcher.ts:330-336`).
- Tests in `dispatcher.test.ts` exercise the desync (empty-accounts) path and the no-grant path but never the `canGet:false` path (test file `packages/wallet-bridge/src/dispatcher.test.ts:340-418`).

**Instances**:
- `packages/wallet-bridge/src/capability-map.ts:14` — exemption set
- `packages/wallet-bridge/src/dispatcher.ts:230-232` — scope-gate-skipped condition
- `packages/wallet-bridge/src/dispatcher.ts:288-317` — `handleGetAccounts` (no `canGet` read)
- `packages/wallet-bridge/src/dispatcher.ts:325-337` — `formatSessionAccounts` (no `canGet` read)
- `packages/wallet-bridge/src/scope-enforcement.ts:269-279` — `METHOD_SCOPE_CHECKER` missing `getAccounts` entry

---

### Finding 2 — `additionalScopes` / `opts.scopes` passed straight through to PXE without authorization check, allowing cross-account private-state read

**Title**: `simulateTx`, `profileTx`, `executeUtility` accept an arbitrary `opts.additionalScopes` (or `opts.scopes`) array that PXE interprets as "addresses whose private state and keys are accessible during execution." The dispatcher copies this through to the executor with NO validation against the session's authorized accounts.

**Impact factors**:
- CIA+A: **Confidentiality** + **Authorization**. A dApp authorized for account A can request PXE to make private notes / keys of account B (a wallet-owned account NOT in the session) accessible to the simulated function, then exfiltrate the data via the function's return value.
- Blast radius: every wallet user with ≥2 accounts on the same chain who connects any dApp; the attacker is the dApp.
- Exploitability: AV:Network / AC:Low / PR:None (granted dApp) / UI:None. Silent — no popup gate exists for simulateTx / profileTx / executeUtility.

**Evidence confidence**: **high** — direct trace from dispatcher → executor → PXE, with PXE documentation confirming the semantic.

**OWASP / CWE mapping**: A01:2021 Broken Access Control — **CWE-863** (Incorrect Authorization), **CWE-200** (Exposure of Sensitive Information to an Unauthorized Actor), **CWE-275** (Permission Issues).

**Trace** (source → sink):
1. Source: dApp wire call `simulateTx(exec, opts)` with `opts.additionalScopes = [victim_address]` → `WalletSdkDispatcher.dispatch("simulateTx", args, ctx)`.
2. `enforceCapability` permits because `simulation` capability is granted; `enforceScope("simulateTx", …)` only inspects `exec.calls` (`scope-enforcement.ts:109-130`) — `opts.additionalScopes` is NEVER read.
3. `buildAccountOperation("aztec_simulateTx", args, …)` at `packages/wallet-bridge/src/dispatcher.ts:831-838`:
   ```ts
   opts: { ...((args[1] as Record<string, unknown>) ?? {}), from: accountAddress } as AztecSimulateTxOperation["opts"],
   ```
   The dApp-supplied `additionalScopes` survives the spread; only `from` is overwritten.
4. Sink: `ExecutionService.executeAztecSimulateTx` at `packages/extension/src/wallet/services/execution/service.ts:1803-1817`:
   ```ts
   const additionalScopes = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
   return pxe.simulateTx(txRequest, { …, scopes: [account.address, ...additionalScopes] }, [account.address.toString()])
   ```
   PXE's `scopes` parameter is documented as "addresses whose private state and keys are accessible during private execution" (`node_modules/@aztec/pxe/dest/pxe.d.ts:196`).
5. Same path for `aztec_profileTx` at `service.ts:1846-1851` and `aztec_executeUtility` at `service.ts:1832-1835` (executeUtility reads `op.opts.scopes` directly — also pristine from the dApp).

**Missing control**: `enforceScope` (or the dispatcher's per-method handler) must filter `opts.additionalScopes` / `opts.scopes` against `getSessionAccountAddresses(dappSession, chainId)` and reject any element not in the session's authorized list. The same logic that `handleRegisterToken` already applies for `args[0]` (`dispatcher.ts:466-477`) must be applied here.

**Exploit story**:
1. User has two accounts on chain `aztec:677868`: `Account-Personal` and `Account-Treasury` (the Treasury holds high-value private notes).
2. User connects `https://innocuous-faucet.example`. dApp asks for `accounts` capability scoped to `Account-Personal` only and `simulation` capability for a benign contract. User approves.
3. dApp calls `executeUtility({ to: <attacker_utility_contract>, name: "read_private_state" }, { scopes: [Account-Treasury_address] })`.
4. `attacker_utility_contract.read_private_state` simulates against `scopes = [Account-Treasury]` and returns balance/note data as the utility's return value.
5. Dispatcher's `enforceScope("executeUtility", …)` checks `c.utilities?.scope` covers `attacker_utility_contract:read_private_state` (the dApp pre-approved this scope). Passes. No check on `opts.scopes`.
6. PXE evaluates the utility with `Account-Treasury` in scopes; the return value flows back to the dApp.
7. dApp now knows `Account-Treasury`'s private balance / note state.

**Preconditions**:
- User has ≥2 accounts on the same chain.
- User granted the dApp at least `simulation` capability with `utilities.scope` covering one attacker-deployed utility contract.
- No popup re-prompt is required on subsequent `executeUtility` calls — the user only sees the popup once at `requestCapabilities` time.

**Why mitigations fail**:
- `enforceScope`'s `checkExecuteUtility` (`scope-enforcement.ts:132-151`) only inspects `args[0]` (the call target). `args[1]` (opts) is untouched.
- `checkSimulationTransactions` (`scope-enforcement.ts:109-130`) and `checkTransactionCalls` (`scope-enforcement.ts:90-107`) only inspect `args[0].calls`. `args[1]` (opts) is untouched.
- The downstream Zod parse at `executeAztecExecuteUtility` (`service.ts:1834`) is only a type validation — `z.array(AztecAddress.schema).parseAsync(op.opts.scopes)` accepts any well-formed addresses, including arbitrary attacker-chosen ones.
- The dispatcher's `handleRegisterToken` already demonstrates the right pattern (validate against `sessionAddresses`) but it's only applied to the `registerToken` `args[0]`, not to `opts.scopes` on the silent simulation methods.
- No popup gates `simulateTx`, `profileTx`, or `executeUtility`.

**Instances** (all sharing the root cause: `opts.scopes` / `opts.additionalScopes` is dApp-controlled and unvalidated):
- `packages/wallet-bridge/src/dispatcher.ts:831-838` (`aztec_simulateTx` build)
- `packages/wallet-bridge/src/dispatcher.ts:839-849` (`aztec_executeUtility` build)
- `packages/wallet-bridge/src/dispatcher.ts:850-857` (`aztec_profileTx` build)
- `packages/wallet-bridge/src/scope-enforcement.ts:109-130` (`checkSimulationTransactions` ignores opts)
- `packages/wallet-bridge/src/scope-enforcement.ts:132-151` (`checkExecuteUtility` ignores opts)
- `packages/wallet-bridge/src/scope-enforcement.ts:90-107` (`checkTransactionCalls` ignores opts; also reachable via `sendTx`, which has the popup gate but still doesn't filter additionalScopes)
- `packages/extension/src/wallet/services/execution/service.ts:1803-1817` (sim sink)
- `packages/extension/src/wallet/services/execution/service.ts:1832-1835` (utility sink)
- `packages/extension/src/wallet/services/execution/service.ts:1846-1851` (profile sink)
- `packages/extension/src/wallet/services/execution/service.ts:2098-2116` (NO_FROM sendTx scopes)

---

### Finding 3 — `registerToken` popup renders on-chain `name` / `symbol` strings with no length cap, no Unicode normalization, no BIDI/confusable filter

**Title**: The token-import confirmation popup pulls `name` and `symbol` strings straight from on-chain (`getNameFn` / `getSymbolFn`) and renders them via Vue `{{ }}` interpolation. While Vue auto-escapes HTML, the strings can contain RIGHT-TO-LEFT OVERRIDE (U+202E), Unicode confusables, zero-width characters, and arbitrary length — enough to spoof a well-known token in the approval UI.

**Impact factors**:
- CIA+A: **Integrity** (user-decision integrity) — the user's "do I want this token in my wallet" decision is made against attacker-controlled UI.
- Blast radius: every dApp-initiated `registerToken` call. After approval the spoofed token is persisted to the user's profile (`packages/extension/src/wallet/services/token/service.ts:164-182`) and later appears in TokenCard rows + balance views with the same unsanitized strings.
- Exploitability: AV:Network / AC:Low / PR:None (granted dApp with `accounts` cap) / UI:Required (one popup click).

**Evidence confidence**: **high** — XSS is mitigated by Vue auto-escape, but the visual-spoofing vector is direct.

**OWASP / CWE mapping**: A04:2021 Insecure Design + **CWE-1007** (Insufficient Visual Distinction of Homoglyphs), **CWE-451** (User Interface Misrepresentation of Critical Information), **CWE-20** (Improper Input Validation).

**Trace** (source → sink):
1. Source: dApp deploys a token contract whose `getName` returns `"USDC‮[reversed evil text]"` or `"USDC " + " ".repeat(10000)` or Greek/Cyrillic homoglyphs like `"USDＣ"` (U+FF23 fullwidth Latin C).
2. dApp calls `registerToken(account, token_address)` → `WalletSdkDispatcher.dispatch("registerToken", …)` (`packages/wallet-bridge/src/dispatcher.ts:256-258`).
3. `handleRegisterToken` (`dispatcher.ts:456-494`) validates the account and routes through `DappInteractionService.execute` for popup confirmation.
4. The execute popup fires `tokenService.previewTokenMetadata(networkId, accountAddress, contractAddress)` at `packages/extension/src/popup/windows/execute/index.vue:280`.
5. `previewTokenMetadata` (`packages/extension/src/wallet/services/token/service.ts:460-473`) calls `fetchTokenMetadata` which uses PXE to simulate the on-chain `getName` / `getSymbol` (`service.ts:495-507`). The raw return values are passed through verbatim.
6. The result is bound into `tokenMetadata` (`packages/extension/src/popup/windows/execute/index.vue:281`) and rendered into `OperationCard.vue:222-237`:
   ```vue
   <Text data-testid="register-token-symbol">{{ tokenMetadata.symbol }}</Text>
   <Text data-testid="register-token-name">· {{ tokenMetadata.name }}</Text>
   ```
7. Sink: the user sees the spoofed strings inside the approval popup, decides to approve. The same strings persist into `token.name` and `token.symbol` and later flow into journal subtitles (`token/service.ts:163`), TokenCard headers, and balance views.

**Missing control**:
- No `Math.min(MAX_LEN, …)` truncation of `name` / `symbol`.
- No `String.prototype.normalize("NFKC")` or stripping of BIDI overrides (`‪`-`‮`, `⁦`-`⁩`), zero-width chars (`​`-`‍`, `﻿`), or other control codepoints.
- No homoglyph detection (the existing `useDappHostname.isSuspicious` check for non-ASCII characters at `packages/extension/src/composables/useDappHostname.ts:19-27` exists for the dApp hostname — that protection is NOT applied to token name/symbol).
- No trusted-registry cross-check (Phase 1 pre-finding explicitly noted no registry validation).

**Exploit story**:
1. Attacker deploys a token contract with `getName` returning `"USDC"` (Cyrillic `С` U+0421 instead of Latin C) and `getSymbol` returning `"USDC"` (same trick).
2. Attacker dApp at `https://swap-platform.example` is already trusted (or fresh-installed; the user is in a hurry).
3. dApp calls `registerToken(user_account, malicious_contract_address)`.
4. Popup opens. User sees `register-token-symbol: "USDC" · USDC (some name)` — visually indistinguishable from real USDC. The contract-address row IS shown below (good defense), but a hurried user clicks "Allow."
5. The malicious token is now in the user's wallet listed alongside real USDC. User sends future swap quotes / approvals targeting the spoofed contract.

A second variant: the dApp registers a token with `name = "USDC" + "‮" + "evil text"`. The U+202E flips the trailing text to right-to-left in any subsequent rendering surface that doesn't strip it.

**Preconditions**:
- dApp has the `accounts` capability granted (required to call `registerToken` per `capability-map.ts:20`).
- User is presented with the registerToken popup and clicks Allow.
- (No additional config; works for every fresh dApp install.)

**Why mitigations fail**:
- Vue's `{{ }}` escapes HTML entities (`<`, `>`, `&`, `"`, `'`) so XSS is blocked — but Unicode confusables and BIDI overrides are NOT HTML entities. They pass through Vue's escape unchanged.
- The "contract address renders below as a separate prop row" comment at `OperationCard.vue:214-219` acknowledges the threat ("symbol/name come straight from the on-chain contract and are attacker-controllable") but the only mitigation is "render the address too." A hurried user does not read every hex address.
- `previewTokenMetadata`'s comment at `service.ts:457-458` repeats the warning but writes no code to address it.
- No length cap means a contract returning a 100 KB string would either crash the popup or overflow the layout, potentially hiding the contract-address row.

**Instances**:
- `packages/extension/src/wallet/services/token/service.ts:495-507` — raw name/symbol passthrough
- `packages/extension/src/wallet/services/token/service.ts:460-473` — `previewTokenMetadata` (no normalization)
- `packages/extension/src/wallet/services/token/service.ts:163-181` — persistence of unsanitized strings
- `packages/extension/src/popup/windows/execute/index.vue:280-281` — pre-fetch bind
- `packages/extension/src/popup/windows/execute/OperationCard.vue:222-237` — popup render
- (Also leaks into TokenCard headers + balance UIs via the same persisted strings, but those are out-of-cluster.)

---

### Finding 4 — `data` capability has no scope-checker for `getAddressBook` and `registerSender`; sub-field `addressBook?: boolean` is never enforced

**Title**: `getAddressBook` and `registerSender` both map to the `data` capability (`capability-map.ts:38-40`), but `enforceScope` registers no checker for either, and `handleGetAccounts`/`handleRegisterSender` paths read no `addressBook` field. A dApp granted `data` capability solely for `privateEvents` access can read the entire address book and register arbitrary senders without ever reaching the `addressBook` sub-grant.

**Impact factors**:
- CIA+A: **Confidentiality** (read-out of stored sender addresses + aliases, including senders shared across many dApps) and **Integrity** (write of new senders into the user's address book by an unauthorized dApp).
- Blast radius: every dApp granted any `data` capability — even one explicitly scoped to a single `privateEvents.contracts: [oneAddr]`.
- Exploitability: AV:Network / AC:Low / PR:None (granted dApp) / UI:None — silent.

**Evidence confidence**: **high** — direct map + scope-checker absence.

**OWASP / CWE mapping**: A01:2021 Broken Access Control — **CWE-863** (Incorrect Authorization), **CWE-285** (Improper Authorization).

**Trace** (source → sink):
1. Source: dApp wire call `getAddressBook()` → `dispatch("getAddressBook", [], ctx)`.
2. `enforceCapability("getAddressBook")`: `isCapabilityExempt` false → `getRequiredCapability` returns `"data"` (`capability-map.ts:38`). Session must have a `data` grant — any shape suffices.
3. `enforceScope("getAddressBook", …)`: `METHOD_SCOPE_CHECKER` (`scope-enforcement.ts:269-279`) has no `getAddressBook` entry → silently pass-through, no `c.addressBook` check.
4. Dispatch resolves to `buildNetworkOperation("aztec_getAddressBook", …)` (`dispatcher.ts:802-803`), then `executionService.executeOperations`. Operation kind allowed regardless of `c.addressBook` value.

Same pattern for `registerSender` (`capability-map.ts:40`) with no scope checker — a dApp can register arbitrary `(address, alias)` rows into the user's address book.

**Missing control**: `enforceScope` must add checkers for `getAddressBook` (verify some `data` grant has `addressBook: true`) and `registerSender` (verify the same, or a separate flag). Without this, the `DataCapability.addressBook?: boolean` field on `capabilities.ts:49` is decorative.

**Exploit story**:
1. dApp requests `data` capability with only `privateEvents: { contracts: ["0xfoo"] }`. User approves — believes the dApp can only read events from one contract.
2. dApp calls `getAddressBook()` → returns the full saved-senders list (every alias + address the user has ever stored, often including a contact's full identity disclosed across multiple dApps).
3. dApp calls `registerSender("0xattacker", "Vitalik")` — silently writes a misleading alias. Future incoming-transfer UIs may render the attacker's address with the spoofed alias.

**Preconditions**: Any `data` grant exists, regardless of which sub-fields the user actually toggled.

**Why mitigations fail**:
- `enforceCapability` is type-only — it gates on `data` being granted, not on sub-fields.
- `enforceScope` is the layer that's supposed to check sub-fields, but it has no entry for either method.
- The popup-displayed sub-grant UI is decorative — the actual enforcement code does not read it.

**Instances**:
- `packages/wallet-bridge/src/capability-map.ts:38-40` — both methods map to "data"
- `packages/wallet-bridge/src/scope-enforcement.ts:269-279` — `METHOD_SCOPE_CHECKER` missing entries
- `packages/wallet-bridge/src/capabilities.ts:47-51` — `addressBook?: boolean` field unused
- `packages/wallet-bridge/src/dispatcher.ts:802-803` — `getAddressBook` builds operation regardless

---

### Finding 5 — Empty `exec.calls` array bypasses scope enforcement on `sendTx` / `simulateTx` / `profileTx`, leaving `opts.additionalScopes` as the dApp's only effect — used in combination with Finding 2

**Title**: `checkTransactionCalls` and `checkSimulationTransactions` both early-return on `calls.length === 0` as "vacuously true." But the rest of `opts` (including `additionalScopes`, `feePayer`, `authWitnesses`, `skipFeeEnforcement`) still rides into the executor. A dApp can send a `sendTx({calls:[]}, {additionalScopes:[victim_addr]})` to silently leak Finding 2's vector without even needing a permissible utility contract in scope.

**Impact factors**:
- CIA+A: **Confidentiality** + **Authorization**. Compounds Finding 2 by removing the "you must have a permissible contract in scope" precondition.
- Blast radius: identical to Finding 2 but with a much smaller attacker footprint — they need no deployed contract.
- Exploitability: AV:Network / AC:Low / PR:None / UI:Required (sendTx triggers the popup — but the popup renders zero calls, which may render as "nothing to review" and lower the user's suspicion).

**Evidence confidence**: **moderate** — `sendTx` does pass through the popup gate (so the user sees something), but `simulateTx` and `profileTx` are silent. The bypass is conditional on the user clicking "Allow" on an empty-calls popup OR on the dApp calling `simulateTx` / `profileTx` silently.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-754** (Improper Check for Unusual or Exceptional Conditions), **CWE-863** (Incorrect Authorization).

**Trace**:
1. dApp wire call `simulateTx({ calls: [] }, { additionalScopes: [victim_addr] })` → `dispatch("simulateTx", …)`.
2. `enforceScope("simulateTx", …)` → `checkSimulationTransactions` at `scope-enforcement.ts:115-130`:
   ```ts
   if (calls.length === 0) return // Vacuously true — no calls to restrict
   ```
3. Scope check passes without examining `additionalScopes` at all.
4. `buildAccountOperation("aztec_simulateTx", …)` spreads `opts` into the operation — Finding 2's path.
5. Sink: PXE receives `scopes = [account, victim_addr]`. Result returned to dApp.

**Missing control**: When `exec.calls.length === 0`, the call must still validate `opts.additionalScopes` / `opts.scopes` (the unused-call-path is precisely when the dApp's only payload IS the scopes-side-channel).

**Exploit story**: Same as Finding 2, but the dApp doesn't need a permissible utility/transaction scope. It just sends an empty-calls payload with a malicious `additionalScopes`.

**Preconditions**:
- Same as Finding 2, with `simulation` (or `transaction`) capability granted in any shape — even an empty scope `[]`.

**Why mitigations fail**:
- The "vacuously true" comment at `scope-enforcement.ts:96` and `:115` accepts that no calls = no restriction, but doesn't notice that other dApp-controlled inputs (scopes, authwits) still execute downstream.

**Instances**:
- `packages/wallet-bridge/src/scope-enforcement.ts:96-97` (`checkTransactionCalls` early-return)
- `packages/wallet-bridge/src/scope-enforcement.ts:115-116` (`checkSimulationTransactions` early-return)
- Tested explicitly at `packages/wallet-bridge/src/scope-enforcement.test.ts:140-143` ("empty calls array passes (vacuously true)") — the test pins the bypass.

---

## Non-findings

- **Prototype-pollution via `methodName = "__proto__"` / `"constructor"`** — `METHOD_TO_KIND[methodName]` returns `Object.prototype` (or the constructor function) for these strings, but `NETWORK_ONLY_KINDS.has(kind)` and `ACCOUNT_KINDS.has(kind)` both return false for non-string values, and the fallback `throw new Error("Unhandled operation kind")` fires. Same in `getRequiredCapability`: returns a truthy function, fails `grantedTypes.has(requiredType)`, throws. No bypass observed.
- **CAIP parser malformed inputs (extra colons, missing colons, non-numeric chainId)** — `parseCaipAccount` checks `parts.length !== 3`, namespace match, empty chainId, `Number.isFinite + isInteger`, and empty address. All malformed inputs throw before reaching any sink. Inputs only arrive via session.accounts (wallet-controlled) and dApp args[0] for `registerToken` (and the dispatcher uses `String(args[0])` which doesn't go through `parseCaipAccount`).
- **`batch` popup-gated method bypass** — `handleBatch` at `dispatcher.ts:360-364` explicitly rejects legs named `sendTx` and `registerToken` server-side; the dApp-side SDK ALSO Zod-blocks per the docstring at `:350-358`. The redundancy is correct.
- **Sequential batch dispatcher per-leg scope re-check** — `handleBatch` recurses into `dispatch()` per leg, which re-runs `enforceCapability` + `enforceScope`. Verified by the batch-hooks-isolation test at `dispatcher.test.ts:535-576`.
- **Stale session with revoked grants still seeing `dappSession.accounts`** — `handleGetAccounts` re-reads the session via `tryGetDappSessionByOriginAndChain` on every call (`dispatcher.ts:289`). Grant revocation would clear `accounts` and the desync path returns []. No stale read observed.
- **`OperationResult` parsing — non-WalletError reaching dApp** — `unwrapOperationResult` only emits `JobCancelledError`, plain `Error`, or `Error("Operation was skipped")` (`dispatcher.ts:119-130`). `toWalletResponseError` further normalizes (`extension/src/wallet/services/wallet-sdk/error-envelope.ts`). No path produces an unintended structured detail leak — verified via `error-envelope.test.ts`.
- **Cross-(origin, chainId) session bleed** — `tryGetDappSessionByOriginAndChain(origin, chainId)` is the only lookup; the chainId IS part of the key. Verified via the dispatch context flow at `background.ts:516-521`.
- **Same-origin confused-deputy for `registerToken`** — `handleRegisterToken` does validate the dApp-supplied account against `sessionAddresses` (`dispatcher.ts:466-477`) and rejects unauthorized accounts. Test pin exists at `dispatcher.test.ts:735-775`.
- **Origin extraction re-validation in dispatcher** — Phase 1 noted upstream-trusted; the dispatcher relies on `BackgroundConnectionHandler` for ECDH origin verification. No way for the dispatcher to re-verify without re-implementing the cryptographic key exchange — out of cluster scope.
- **Nonce / replay protection at dispatcher** — Phase 1 noted upstream-trusted (encrypted channel via wallet-sdk). Out of cluster scope to re-implement.
