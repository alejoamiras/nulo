# Security Map: packages/wallet-bridge

**THIS IS THE dApp ↔ WALLET BRIDGE.** Primary attack surface for dApp-driven exploits.

## Module inventory

| Module | Purpose | Language | LOC |
|---|---|---|---|
| `dispatcher.ts` | Central dispatch layer routing wallet-sdk RPC methods to typed service calls; enforces capabilities & scope per-message. | TypeScript | 921 |
| `scope-enforcement.ts` | Per-message re-check: validates call-intent targets, fee-payer, chainId, accounts against session grants. | TypeScript | 297 |
| `capability-map.ts` | Declarative map of method name → required capability type; categorizes exempt vs gated methods. | TypeScript | 56 |
| `capabilities.ts` | Capability & scope types: accounts, contracts, simulation, transaction, data, etc. | TypeScript | 69 |
| `dapp-interaction-protocol.ts` | Wire schemas for dApp ↔ wallet interactions: accounts, register, send, simulate, verify, metadata. | TypeScript | 156 |
| `services-contract.ts` | Structural interfaces the dispatcher consumes. Keeps bridge extension-agnostic. | TypeScript | 104 |
| `session-types.ts` | DappSession shape, per-`(origin, chainId, profileId)` keying; AccessLevel enum. | TypeScript | 66 |
| `caip.ts` | CAIP-2/CAIP-10 parsing & formatting; single source of truth for `aztec:<chainId>` and account identifiers. | TypeScript | 70 |
| `operation.ts` | Operation model variants (AztecSendTx, RegisterToken, Simulate*, etc.) flowing through dispatcher → execution. | TypeScript | 191 |
| `operation-result.ts` | OperationResult union | TypeScript | 29 |
| `transaction-origin.ts` | LocalTxOrigin type (OriginType.DAPP carrying dApp origin name). | TypeScript | 21 |
| `fee.ts` | Fee-payment-method protocol types (native, FPC, sponsored). | TypeScript | 67 |
| `discovery-queue.ts` | Discovery-request queue for handling pending discoveries when wallet unlocks. | TypeScript | 78 |

## Entrypoints (PUBLIC ATTACK SURFACE)

### RPC Methods Exposed to dApps

All routing flows through `dispatcher.dispatch(methodName, args, ctx)` (line 227–270).

| Method | Handler | Capability | Popup | Notes |
|---|---|---|---|---|
| `getChainInfo` | direct | Exempt | No | Metadata only |
| `getAccounts` | `handleGetAccounts(ctx)` | Exempt | No | Throws 4100 if `accounts` cap not granted |
| `requestCapabilities` | `handleRequestCapabilities(manifest, ctx)` | Exempt | Yes | Opens popup |
| `batch` | `handleBatch(methods, ctx)` | Exempt | No | Sequential; blocks `sendTx` and `registerToken` |
| `sendTx` | DappInteractionService | `transaction` | Yes | Fee selection + confirmation |
| `simulateTx` | ExecutionService | `simulation` | No | Silent; scope-enforced |
| `executeUtility` | ExecutionService | `simulation` | No | Silent; scope-enforced |
| `profileTx` | ExecutionService | `simulation` | No | Silent; scope-enforced |
| `registerToken` | DappInteractionService | `accounts` | Yes | Pre-fetches metadata; RPC custom to Nulo |
| `createAuthWit` | ExecutionService | `accounts` | No | Silent; scope-enforced |
| `registerContract` | ExecutionService | `contracts` | No | Silent; scope-enforced |
| `getContractMetadata` | ExecutionService | `contracts` | No | Silent; scope-enforced |
| `registerSender` | ExecutionService | `data` | No | Silent; no scope checker |
| `getAddressBook` | ExecutionService | `data` | No | Silent; no scope checker |
| `getPrivateEvents` | ExecutionService | `data` | No | Silent; scope-enforced |
| `getContractClassMetadata` | ExecutionService | `contractClasses` | No | Silent; scope-enforced |

### Dispatcher Routing Logic

**Single chokepoint**: `dispatcher.dispatch(methodName, args, ctx, hooks?)`.

1. **Capability enforcement** (line 229–232): `enforceCapability(methodName, ctx)` + `enforceScope(methodName, args, grants)`.
2. **Special paths**: requestCapabilities, getAccounts, batch, sendTx, registerToken.
3. **General path**: Map via `METHOD_TO_KIND` table → buildOperation → ExecutionService.

### Schema Patch: `registerToken` Custom RPC

**Three inline copies (drift pinned by `dispatcher.test.ts`)**:
1. Extension: `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts`
2. Faucet: `packages/faucet/src/lib/nulo-schema-patch.ts`
3. Playground: `packages/playground/src/lib/nulo-schema-patch.ts`

Each: side-effect only, patches `WalletSchema.registerToken` at module load, schema = `z.function().args(AztecAddress, AztecAddress).returns(z.void())`.

## Trust boundaries (everything here is a trust boundary)

### Origin Extraction & Validation ⚠️

**Where origin comes from**:
- **Upstream wallet-sdk's `BackgroundConnectionHandler`** — decrypts wallet-sdk protocol; extracts dApp origin from the encrypted session's discovery request or key exchange
- **SessionContext.origin** — passed to dispatcher by the background message handler

**Trust model**:
- Origin is extracted by **upstream wallet-sdk** from the dApp's postMessage discovery broadcast (NOT from `chrome.runtime.MessageSender.url`)
- The wallet-sdk handler validates the dApp's origin via ECDH session binding + verification popup
- Once `SessionContext.origin` is in scope, used as keying field: `tryGetDappSessionByOriginAndChain(ctx.origin, String(ctx.chainId))`
- **No re-validation within the dispatcher**: dispatcher trusts `ctx.origin` for all lookups

**Critical gap**: If upstream wallet-sdk has an origin-extraction bug (case sensitivity, subdomain confusion, trailing-slash normalization), the dispatcher perpetuates it.

### Per-Origin Session Storage

**Keying**: `(origin, chainId, profileId)` tuple
- **Accounts stored**: `dappSession.accounts[]`
- **Aliases**: `dappSession.accountAliases?: Record<string, string>`
- **Capability grants**: `dappSession.capabilityGrants` — authoritative source for what methods the dApp can call
- **Capability rejections**: `dappSession.capabilityRejections` — tracks user rejections

**Invariant**: Accounts and grants are decoupled — revoking an `accounts` grant does NOT wipe `dappSession.accounts`.

### Method Authorization

**Type-level capability check** (enforceCapability, line 729–744):
1. If method is exempt (getChainInfo, requestCapabilities, batch, getAccounts) → skip
2. Look up required capability type via `getRequiredCapability(methodName)` (capability-map.ts)
3. If method unknown → return empty grants; let dispatch() error
4. Look up session via `tryGetDappSessionByOriginAndChain`
5. Check if required capability type is in `dappSession.capabilityGrants` → throw if not

**Scope-level check** (enforceScope, scope-enforcement.ts):
- Per-method validators: `checkRegisterContract`, `checkGetContractMetadata`, `checkGetContractClassMetadata`, `checkTransactionCalls`, `checkSimulationCalls`, `checkPrivateEventsContracts`
- **Pass-through methods** (registerSender, getAddressBook): no scope checker
- **No per-call re-check within a batch**: batch dispatcher loops are sequential; each leg gets its own dispatch() call

### Confirmation Popups

**Methods requiring popups**: `requestCapabilities`, `sendTx`, `registerToken`
**Methods explicitly silent**: All `aztec_*` methods except those above
- Hard-coded in `capability-map.ts`
- Not configurable per-session
- Batch explicitly forbids popup-gated methods

### Input Validation

- Dispatcher input: args are raw `WalletMessage.args` from wallet-sdk (untyped `unknown[]`)
- **No explicit zod schema validation at dispatcher level**
- Handlers assume args match the WalletSchema; upstream wallet-sdk `ExtensionWallet` proxy likely zod-validates before encrypting
- Scope enforcement validates execution payload structure; expects `exec.calls` to be array

**Gap**: No upstream zod schema guard at the dispatcher boundary.

### Replay / Nonce / Sequence Protection

**At the dispatcher level**: None. Does NOT check message nonces, duplicate request detection, or time-of-flight bounds.

**At the wallet-sdk layer** (upstream): Encrypted channel has built-in replay protection via AEAD-GCM with unique nonces.

### Cross-dApp Isolation

**Session keying**: per-`(origin, chainId, profileId)` — exact origin match (no wildcards).
**Account list isolation**: Each dApp's session has its own `accounts[]` array.

**Gap**: If dApp spoofs origin (browser compromise or content script compromise), dispatcher cannot detect it. Trust boundary is **entirely upstream** in wallet-sdk's origin extraction.

### The `registerToken` RPC: Parsing & Pre-Approval Display ⚠️

**Signature**: `(account: AztecAddress, token: AztecAddress) => Promise<void>`

**Flow**:
1. dApp calls `wallet.registerToken(account, token)`
2. Dispatcher routes to `handleRegisterToken()` via DappInteractionService.execute()
3. Before opening popup, extension's DappInteractionService pre-fetches token metadata via `parseTokenInterface(token, networkId)`:
   - On-chain ABI parsing → gets `name`, `symbol`, `decimals`
4. Popup displays: contract address (from dApp), metadata (from on-chain contract), account being registered against
5. User clicks Allow/Deny
6. On Allow: wallet stores `(profileId, networkId, token)` in watchlist

**Trust model**:
- The **address** comes from the dApp (untrusted)
- The **metadata** (name/symbol/decimals) comes from querying the on-chain contract at that address (attacker-controlled if they deployed the contract)
- **No validation** that the address is a legit token contract
- **No validation** that the metadata matches any trusted registry
- **UX defense**: address shown alongside metadata, user *could* verify in block explorer, but phishing tokens can still be registered (e.g., "USDC" contract at 0xdead... vs the real USDC at 0xc0f...)

## Dependency graph

**Workspace imports:**
- `@nulo/wallet-core` — foundation types, logger, storage, utils
- `@nulo/extension-messaging` — RPC types, JobCancelledError, CapabilityNotGrantedError

**Deliberately NOT imported:**
- `@nulo/aztec-runtime` — enforced via biome `noRestrictedImports`
- Any extension service classes — kept extension-agnostic via `services-contract.ts` interfaces

**External:**
- `@aztec/aztec.js` — WalletSchema, artifacts
- `@aztec/foundation`, `@aztec/stdlib`, `@aztec/wallet-sdk`
- `zod` (for the three schema-patch files)

**Who consumes wallet-bridge:** `@nulo/extension` only.

## Frameworks

- **zod**: schema patch files; not bridge types themselves
- **@aztec/wallet-sdk**: BackgroundConnectionHandler, ExtensionWallet proxy, encrypted channel protocol
- **@aztec/aztec.js**: WalletSchema

## Test surfaces

- **dispatcher.test.ts** (822 LOC): requestCapabilities, handleBatch sequential dispatch + popup-method blocking, capability enforcement + merging logic. Schema-patch reachability check imports extension's patch directly.
- **scope-enforcement.test.ts** (392 LOC): All scope checks for contract, metadata, class, send, simulate, executeUtility, privateEvents.

**Notable gaps:**
- No sender-validation tests (origin spoofing scenarios)
- No cross-origin contamination tests
- No replay-attack tests (outside bridge scope; upstream wallet-sdk + PXE responsibility)
- No malformed-CAIP-input tests at dispatcher level

## Generated / vendored / dev-only

Three inline copies of `nulo-schema-patch.ts` (extension, faucet, playground) — drift pinned by `dispatcher.test.ts`.

Manual update required if new Nulo-custom RPC is added: all three copies + new reachability test.

---

## Summary for Phase 2 agents

The wallet-bridge is a **pure dispatcher** — security model depends entirely on **upstream origin validation** (wallet-sdk) and **downstream execution enforcement** (extension services). The three greatest surface risks:

1. **Origin spoofing**: If upstream wallet-sdk has an origin-extraction bug, sessions can be hijacked across origins.
2. **Phishing tokens via registerToken**: No on-chain registry validation; metadata comes directly from attacker's contract.
3. **Schema-patch drift**: If the three inline copies diverge, registerToken may become unreachable or malformed.
