# `packages/wallet-bridge` — Module Map

`@nulo/wallet-bridge` (v0.2.0) is the dApp-facing RPC dispatch layer for the Nulo Aztec wallet extension: it narrows `@aztec/wallet-sdk` protocol messages into typed service calls and enforces per-session capability + scope authorization. Position in the stack per its README: `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`.

## 1. Module inventory

| Path | Purpose | LOC |
|---|---|---|
| `src/dispatcher.ts` | `WalletSdkDispatcher` — the single chokepoint: resolves method descriptors, enforces capability/scope, builds `Operation`s or routes to popup handlers (sendTx/registerToken/grantPublicAuthwit/createAuthWit/requestCapabilities/getAccounts/batch), unwraps `OperationResult`s. | 1368 |
| `src/method-descriptors.ts` | `METHOD_REGISTRY` — single source of truth per-method row (`capability`, `routing`, `scopeCheck`, `argSchema`, exempt flag); derives the six legacy parallel tables (`METHOD_CAPABILITY_MAP`, `EXEMPT_METHODS`, `METHOD_TO_KIND`, `NETWORK_ONLY_KINDS`, `ACCOUNT_KINDS`, `METHOD_SCOPE_CHECKER`); owns `assertKnownMethod` dispatch-entry guard. | 395 |
| `src/method-scope-checkers.ts` | Leaf module: per-method scope-check function bodies (`checkSendTx`, `checkSimulateTx`, `checkCreateAuthWit`, `checkGetAccounts`, etc.) referenced by both the registry and `scope-enforcement.ts`. | 419 |
| `src/scope-enforcement.ts` | `enforceScope` / `enforceScopeWithSession` entry points; owns the F-005 session-account-scope re-check (`validateAccountScopes`) over `scopes`/`additionalScopes` arrays. | 106 |
| `src/capability-map.ts` | Thin facade: `getRequiredCapability` / `isCapabilityExempt` over registry-derived maps. | 34 |
| `src/capabilities.ts` | Capability/scope wire types: `AccountsCapability`, `ContractsCapability`, `ContractClassesCapability`, `SimulationCapability`, `TransactionCapability`, `DataCapability`, `Scope`, `GrantedCapabilityRecord`, `RejectedCapabilityRecord`. | 69 |
| `src/services-contract.ts` | Structural interfaces the dispatcher consumes: `INetworkReader`, `IAccountReader`, `IExecutionRunner`, `IDappInteractionRunner`, `IDappSessionWriter`, `ITokenRegistryReader`, `IExecutionHooks`. | 109 |
| `src/session-types.ts` | `DappPermissions`, `AccessLevel` enum, `INetworkRef`/`IAccountRef`/`IDappSessionRef` structural session shapes. | 66 |
| `src/dapp-interaction-protocol.ts` | Wire request/result types for popup-driven interactions (`ExecutionParams`, `CapabilityParams`, `CapabilityResult`, per-op `*Request` types mapping `Operation` → CAIP-keyed wire shape). | 156 |
| `src/action.ts` | `Action` union (`AddCapsuleAction`, `AddPrivateAuthwitAction`, `AddPublicAuthwitAction`, `CallAction`, `EncodedCallAction`) — building blocks of `SendTransactionOperation.actions`. | 55 |
| `src/operation.ts` | `Operation` union (Nulo + Aztec.js interface kinds), `FeeOptions`, `GasLimits`, plus `DraftOperation` variants with optional `feeSettings`. | 219 |
| `src/operation-result.ts` | `OperationResult` union: `ok`/`failed`/`cancelled`/`skipped` variants. | 29 |
| `src/operation-validation.ts` | `requiresFeeSelection` / `assertExecutableOperation` — draft→executable `Operation` narrowing shared by materializer + popup. | 50 |
| `src/transaction-origin.ts` | `OriginType` enum (UI/DAPP), `TxOrigin`/`LocalTxOrigin`. | 21 |
| `src/fee.ts` | `FeePaymentMethod` union, `FeeSettings`, `GasBalances`, `TransferFeeEstimate` — fee protocol types shared with the popup. | 68 |
| `src/caip.ts` | CAIP-2/CAIP-10 helpers: `formatCaipChain`, `formatCaipAccount`, `parseCaipAccount`, `resolveNetworkByChainId`. Single source of truth for CAIP parsing in this package. | 70 |
| `src/authwit-content.ts` | `AuthwitContent` union (`call`/`encoded_call`/`intent`/`message_hash`). | 24 |
| `src/account-resolution.ts` | `resolveAuthorizedSessionAccount` — the shared wallet-order account-selection rule used by both the dispatcher's send path and (per its docstring) the journal. | 60 |
| `src/discovery-queue.ts` | `DiscoveryQueue` class — bounded FIFO of pending wallet-discovery requests while the wallet is locked (badge-updating side effects via `chrome.action`). | 111 |
| `src/types.ts` | `SessionContext` (chainId/profileId/origin/sessionId) — the dispatcher's per-call context. | 14 |
| `src/index.ts` | Barrel: `export * from` all 18 non-test modules. | 28 |

Test files (not counted above, see §7): `dispatcher.test.ts` (1965), `scope-enforcement.test.ts` (627), `method-descriptors.test.ts` (427), `account-order.characterization.test.ts` (122), `discovery-queue.test.ts` (74), `method-name.test.ts` (31).

## 2. Entrypoints / public exports

- **Package export**: `"."` → `./src/index.ts` (barrel re-exporting all 18 modules).
- **Primary RPC dispatch surface**: `WalletSdkDispatcher.dispatch(methodName, args, ctx, hooks?)` in `src/dispatcher.ts:390`. Every dApp-originated `@aztec/wallet-sdk` call (`sendTx`, `simulateTx`, `executeUtility`, `profileTx`, `createAuthWit`, `getAccounts`, `requestCapabilities`, `batch`, `registerContract`, `getContractMetadata`, `getContractClassMetadata`, `getPrivateEvents`, `registerSender`, `getAddressBook`, `getChainInfo`, plus Nulo-custom `registerToken`/`isTokenRegistered`/`grantPublicAuthwit`) flows through this single method. `assertKnownMethod` (`method-descriptors.ts:383`) is the fail-closed typed choke point that narrows the wire string to `MethodName`.
- **Consumer**: `apps/extension/src/wallet/services/wallet-sdk/background.ts` — instantiates `new WalletSdkDispatcher(networkService, accountService, executionService, dappInteractionService, dappSessionService, logger, { isTokenRegistered: ... })` and calls `dispatcher.dispatch(message.type, message.args, ctx, hooks)` inside `BackgroundConnectionHandler.onWalletMessage`. Also imports `DiscoveryQueue` and `SessionContext` from the same barrel.
- **Other real consumers** (grep-confirmed, non-worktree): `apps/extension/src/popup/windows/capabilities/build-items.ts`, `apps/extension/src/popup/windows/execute/{operation-validation,types}.ts`, `apps/extension/src/wallet/services/dapp-interaction/{materialize,spec}.ts`, `apps/extension/src/wallet/services/dapp-session/{capability-meta,spec}.ts`, `apps/extension/src/wallet/services/execution/{models/index,operation-estimate-reuse,operation-fingerprint,transfer-estimate-reuse,helpers/batched-view-simulation}.ts`, `apps/extension/src/wallet/services/execution/feesettings-invariant.test.ts`, `apps/extension/src/wallet/services/transaction/spec.ts`, `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts`, `apps/extension/src/wallet/utils/caip.ts`. All consumption is from `apps/extension` — no faucet/playground consumer (those get the Nulo-custom RPC schema only via the separate `@nulo/wallet-sdk-schema-patch` package, deliberately not `wallet-bridge` itself, per the README's "keeping it extension-internal" rationale).

## 3. Coupling surfaces

- **`dispatcher.ts` is the fan-out hub**: imports from 14 sibling internal modules (`account-resolution`, `caip`, `capabilities`, `capability-map`, `method-descriptors`, `dapp-interaction-protocol`, `operation`, `operation-result`, `scope-enforcement`, `method-scope-checkers`, `session-types`, `transaction-origin`, `types`, `services-contract`) plus 3 external packages (`@nulo/extension-messaging/errors`, `@nulo/wallet-core/logger` ×2 imports). At 1368 LOC it is by far the largest and most central file.
- **Cross-package imports found in `src/`**:
  - `@aztec/aztec.js/authorization`, `@aztec/aztec.js/contracts`, `@aztec/aztec.js/wallet`, `@aztec/foundation/curves/bn254`, `@aztec/stdlib/{abi,aztec-address,contract,tx}` — all confined to `operation.ts` (type-only, for `Operation` field typing).
  - `@aztec/wallet-sdk/extension/handlers` — `discovery-queue.ts` only (`BackgroundConnectionHandler`, `PendingDiscovery` types).
  - `@nulo/wallet-core/logger` — `dispatcher.ts` and `discovery-queue.ts` (`ILogger`, `LogLevel`).
  - `@nulo/extension-messaging/errors` — `dispatcher.ts` only (`CapabilityNotGrantedError`, `JobCancelledError`).
- **Deliberately absent**: no `@nulo/aztec-runtime` import anywhere in `src/`, and no `@nulo/extension` import. This is enforced by `biome.json`'s per-directory `noRestrictedImports` block for `packages/wallet-bridge/src/**` (lines ~299-312): `"@nulo/aztec-runtime": "wallet-bridge cannot import aztec-runtime (preserves the cleaner-than-claimed boundary verified during M3.7)"` and `"@nulo/extension": "wallet-bridge cannot import extension"`, both for the bare specifier and the `/*` subpath group. This is the architectural boundary the README calls out ("transport-shaped, not chain-shaped") and it is mechanically enforced, not just documented.
- **Design-level decoupling**: `services-contract.ts` defines narrowed structural interfaces (`INetworkReader`, `IAccountReader`, `IExecutionRunner`, `IDappInteractionRunner`, `IDappSessionWriter`, `ITokenRegistryReader`) so the dispatcher never imports concrete `@nulo/extension` service classes — real services satisfy these structurally at the `background.ts` wiring site.

## 4. State owners

- **`DiscoveryQueue.queue`** (`discovery-queue.ts:22`, `private queue: QueuedDiscovery[] = []`) — mutable in-memory FIFO of pending wallet-discovery requests received while locked. Guards: `PER_ORIGIN_CAP = 4` and `GLOBAL_CAP = 32` (F-04) checked in `enqueue()` before push; coalesces duplicate `(origin, chainId)` entries; `drain()` snapshots-then-clears (`this.queue.length = 0`) before processing, re-queuing the remainder if `processFn` reports the wallet re-locked mid-drain. No lock/mutex — single-threaded JS access, but note the `updateBadge()` side effect (`chrome.action.setBadgeText`/`setBadgeBackgroundColor`) fires directly from mutation points, coupling state changes to UI badge as a side channel.
- **`WalletSdkDispatcher` itself holds no mutable instance state** — it's a pure pass-through over injected service interfaces (`networkService`, `accountService`, `executionService`, `dappInteractionService`, `dappSessionService`, `tokenRegistryReader` — all `private readonly`). The actual session/capability-grant state lives OUTSIDE this package, in the extension's `DappSessionService` (accessed via `IDappSessionWriter`); the dispatcher only reads/writes it through that interface (`tryGetDappSessionByOriginAndChain`, `setCapabilityGrants`, `setCapabilityRejections`, `updateDappSession`, `setAccountAliases`).
- **Per-dispatch session snapshot** (`dispatch()` at `dispatcher.ts:396`): `const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(...)` is captured ONCE at entry and threaded through the whole call (documented as the "Phase 0.5" fix closing a TOCTOU window where 6 separate lookups could see divergent session state mid-dispatch, e.g. if the session was deleted concurrently). This is the closest thing to a consistency guard in the module — a single-read-then-thread pattern rather than a lock.
- **`pendingVerification`** (a `Set<string>` keyed by origin+chainId) lives in the consumer (`apps/extension/.../wallet-sdk/background.ts`), not in this package — flagged here only because it's the state most adjacent to `DiscoveryQueue`.

## 5. Dependency graph (one level deep, internal only)

```
index.ts        → (barrel; re-exports all 18 below)
dispatcher.ts    → account-resolution, caip, capabilities, capability-map,
                    method-descriptors, dapp-interaction-protocol, operation,
                    operation-result, scope-enforcement, method-scope-checkers,
                    session-types, transaction-origin, types, services-contract
capability-map.ts       → method-descriptors
scope-enforcement.ts    → capabilities, method-descriptors
method-descriptors.ts   → operation, method-scope-checkers
method-scope-checkers.ts → capabilities                         (leaf)
services-contract.ts    → capabilities, dapp-interaction-protocol,
                           operation, operation-result, session-types,
                           transaction-origin
dapp-interaction-protocol.ts → caip, operation, operation-result
operation.ts            → action, fee                     (+ external @aztec/*)
action.ts                → authwit-content
authwit-content.ts        → action                        ← CYCLE
session-types.ts        → capabilities
operation-validation.ts → operation
account-resolution.ts   → (none; pure functions over generic T)
caip.ts, capabilities.ts, fee.ts, transaction-origin.ts, types.ts,
discovery-queue.ts      → (leaves; no internal imports)
```

**Cycle found**: `action.ts ↔ authwit-content.ts` — `action.ts` imports `type AuthwitContent` from `authwit-content.ts` (for `AddPrivateAuthwitAction.content` / `AddPublicAuthwitAction.content`), and `authwit-content.ts` imports `type { CallAction, EncodedCallAction }` from `action.ts` (to build `CallAuthwitContent`/`EncodedCallAuthwitContent` as `Omit<CallAction/EncodedCallAction, "kind">`). Both imports are `import type`, so this is erased at build time and causes no runtime issue, but it is a genuine two-file type-level cycle.

No other cycles detected. The registry↔scope-enforcement cycle that `method-scope-checkers.ts` was explicitly extracted to break (per its own header comment) is confirmed avoided: `method-descriptors.ts` and `scope-enforcement.ts` both depend on `method-scope-checkers.ts`, but it depends back on neither (only on the leaf `capabilities.ts`).

## 6. Frameworks/primitives

- **No schema/validation library** (no Zod, no io-ts) is used inside `wallet-bridge` itself — validation is hand-rolled:
  - `MethodDescriptor.argSchema: ArgGuard` (`method-descriptors.ts:91`) — a pure pass/fail predicate over raw positional args (e.g. `argsRequestCapabilities`, `argsBatch`, `argsCreateAuthWit`, `argsOneRequired`, `argsTwoRequired`), deliberately non-mutating/non-coercing, run in `dispatch()` right after `assertKnownMethod` and before enforcement.
  - `assertAuthRelevantArgShape` (`dispatcher.ts:325`) — a second, F-08-labeled structural guard for `sendTx`/`profileTx`/`executeUtility`/`createAuthWit`/`registerToken`, explicitly documented as "not a complete WalletSchema parse" — full Zod validation stays downstream in the extension's execution layer.
  - `ScopeCheck` functions in `method-scope-checkers.ts` — per-method authorization predicates that throw on violation.
  - README explicitly states the real `@aztec/wallet-sdk` `WalletSchema` Zod validation happens outside this package; wallet-bridge validates "only the authorization-relevant fields."
- **`@aztec/wallet-sdk` surface used**: only two narrow import points — `discovery-queue.ts` imports `BackgroundConnectionHandler`/`PendingDiscovery` types from `@aztec/wallet-sdk/extension/handlers`; `operation.ts` imports auth/contract/wallet-option types (`CallIntent`, `IntentInnerHash`, `InteractionWaitOptions`, `PrivateEventFilter`, `ProfileOptions`, `SendOptions`, `SimulateOptions`, `ExecuteUtilityOptions`) purely for typing `Operation` variants — no runtime `WalletSchema` proxy/consumption inside this package (the schema-patch mechanism that mutates `WalletSchema` at runtime lives in the separate `@nulo/wallet-sdk-schema-patch` package, per the README's "Schema-patch contract" section). The README also documents three Nulo-custom RPCs patched onto `WalletSchema` at runtime: `registerToken`, `isTokenRegistered`, `grantPublicAuthwit`, all dispatched here but schema-defined elsewhere.
- **Method registry as a compile-time/runtime dual guard**: `METHOD_REGISTRY_SOURCE satisfies Record<string, MethodDescriptor>` + `MethodName = keyof typeof METHOD_REGISTRY_SOURCE` is the core primitive tying static typing to runtime dispatch — a genuinely distinctive pattern (registry-as-source-of-truth with derived tables computed once at module load).
- **Test framework**: `vitest` (declared in `package.json` devDependencies and `dependencies`... actually devDependency `"vitest": "^4.1.9"`).

## 7. Test surfaces

- **Location**: colocated `*.test.ts` next to the module under test (`src/*.test.ts`), matching the README's "Colocated `*.test.ts`" statement. Run via `bun run test` → `vitest run`.
- **Coverage impression** (by describe-block count as a rough proxy):
  - `dispatcher.test.ts` (1965 LOC, 103 `describe`/`it`/`test` blocks) — heavy, itemized coverage of `dispatcher.ts`: reject persistence, `handleBatch`, `unwrapOperationResult`, `handleGetAccounts`, capability field-diff re-consent (F-1.5), batch/sendTx hook isolation, `opts.from` resolution, `registerToken`/`isTokenRegistered`/`grantPublicAuthwit` reachability, F-006 fail-closed session handling, F-08 arg-shape guards, arg-guard tolerance. This is clearly the best-tested module and doubles as a security-fix regression suite (many `describe` blocks are literally named after F-00x/audit finding IDs).
  - `scope-enforcement.test.ts` (627 LOC, 99 blocks) — exercises `scope-enforcement.ts` + (indirectly) every checker in `method-scope-checkers.ts`: F-003/F-004/F-005 fixes, per-method scope checks for `registerContract`/`getContractMetadata`/`getContractClassMetadata`/`sendTx`/`simulateTx`/`executeUtility`/`profileTx`/`getPrivateEvents`/`createAuthWit`/`grantPublicAuthwit`, plus `isCreateAuthWitCoveredByTxOrSimulationScope`.
  - `method-descriptors.test.ts` (427 LOC, 27 blocks) — a "frozen authz oracle" per its own comment: parity with the pre-refactor parallel tables, structural invariants, exhaustiveness ("the silent-omission killer"), an "add-a-method proof," arg-guard ADD-only checks.
  - `method-name.test.ts` (31 LOC) — narrowly tests `assertKnownMethod` only (deliberately split out of `method-descriptors.test.ts` so that file "stays byte-UNEDITED").
  - `account-order.characterization.test.ts` (122 LOC) — pins the send-account-selection contract (`resolveAuthorizedSessionAccount` behavior as exercised through the dispatcher) so the queued-journal's independent resolution can't silently diverge.
  - `discovery-queue.test.ts` (74 LOC, 5 blocks) — lighter coverage of `DiscoveryQueue`.
- **Modules with no dedicated `*.test.ts` file** (only indirectly exercised via `dispatcher.test.ts` / `scope-enforcement.test.ts` fixtures, or not exercised at all within this package): `account-resolution.ts` (covered indirectly by `account-order.characterization.test.ts` and dispatcher tests, not unit-tested standalone), `action.ts`, `authwit-content.ts`, `caip.ts` (no `caip.test.ts` in this package — note `apps/extension/src/wallet/utils/caip.ts` has its own `caip.test.ts` but that's a *different*, extension-local CAIP module, not this one), `capabilities.ts` (types only), `capability-map.ts` (thin facade, exercised transitively), `dapp-interaction-protocol.ts` (types only), `fee.ts` (types only), `operation.ts` / `operation-result.ts` (types only), `operation-validation.ts` (`requiresFeeSelection`/`assertExecutableOperation` — no test file in this package; likely exercised by the consumer, `apps/extension/.../execute/operation-validation.test.ts`, which is a *different* file despite the similar name), `services-contract.ts` (interfaces only), `session-types.ts` (types + `AccessLevel` enum), `transaction-origin.ts` (types + enum), `types.ts` (type only).
- All test/fixture services (`IDappSessionWriter`, `INetworkReader`, etc.) are hand-built fakes inline in the test files — no shared mock/fixture module exists in `src/`.

## 8. Generated/vendored/fixture code

None found. `find` over the package (excluding `node_modules`/`dist`/`.turbo`) shows only hand-written `src/*.ts` + `package.json`/`README.md`/`tsconfig.json`. No `dist/` present in the working tree (build output not checked in), no `*.generated.*`, no `DO NOT EDIT` markers, no fixtures directory. Nothing to exclude.

## 9. Apparent duplication

- **Repeated per-capability-type "is this request already covered by existing grants" shape in `dispatcher.ts`** (lines ~176-299): `contractsRequestCovered`, `scopeCovers`, `transactionRequestCovered`, `simulationRequestCovered`, `dataRequestCovered`, `accountsCapsEqual`, all funneled through the `isCapabilityCovered` switch. Each function re-implements the same "does existing grant list satisfy the requested shape" pattern with slightly different field access per capability type. The module's own comments acknowledge this is intentionally field-aware for most types but TYPE-ONLY for `contractClasses` — an explicitly filed known gap (`wallet-sdk-capability-field-diff`). This cluster (14 matches for `isCapabilityCovered|RequestCovered|CapsEqual`) is the single largest concentration of near-duplicate logic in the package.
- **Near-identical scope-check bodies in `method-scope-checkers.ts`**: `checkGetContractMetadata` and `checkIsTokenRegistered` are structurally identical (both: `String(args[0])` → filter `ContractsCapability` grants → check `canGetMetadata && inAddressList`) — the module's own comment at `checkIsTokenRegistered` (line 96) explicitly notes "the same consent surface as getContractMetadata," i.e. the duplication is acknowledged/deliberate rather than accidental. Similarly `checkGetAddressBook` and `checkRegisterSender` (lines 369-388) are near-identical single-bit checks against `DataCapability.addressBook`, explicitly commented "(paired)".
- **`checkSimulationTransactions`/`checkTransactionCalls`** (lines 116-133 and 152-184) implement the same "every call in `exec.calls` must match some single granted scope" pattern twice — once for `transaction` capability (used by `sendTx`), once for `simulation.transactions` (used by `simulateTx`/`profileTx`), differing mainly in which capability field they read (`c.scope` vs. `c.transactions?.scope`) and in an extra F-08 null-guard added to the simulation variant only.
- **The dispatcher's popup-routed handlers** (`handleRegisterToken`, `handleGrantPublicAuthwit`, `handleCreateAuthWit`'s uncovered branch, `handleSendTx`) share a repeated "resolve session → resolve account via `resolveNetworkAndAccount` → format CAIP account → build a Request object → call `dappInteractionService.execute` → `unwrapResult`" skeleton — not literally copy-pasted (each builds a different `*Request` shape) but the same 5-step scaffold appears four times inline in `dispatcher.ts` rather than being factored into a shared private helper.
- **Draft-operation optionality**: `DraftAztecSendTxOperation` and `DraftSendTransactionOperation` in `operation.ts` (lines 205-212) are the same `Omit<X, "feeSettings"> & { feeSettings?: FeeSettings }` pattern applied twice to the two send-like kinds — small but a literal template repeated verbatim.

## 10. Error-path hotspots

- **`dispatcher.ts` has 4 `catch` blocks**, concentrated around two areas:
  1. `dispatch()`'s account-scope-set construction (line ~447): `try { sessionAccounts.add(parseCaipAccount(entry).address) } catch { /* pre-CAIP entry: keep as-is */ }` — tolerates legacy non-CAIP session entries.
  2. `handleRequestCapabilities()`'s popup call (line ~939): `try { result = await this.dappInteractionService.requestCapabilities(...) } catch (err) { ...persist rejection records for every delta item...; throw err }` — this is the most consequential error path: on popup reject/close it writes `RejectedCapabilityRecord`s via `dappSessionService.setCapabilityRejections` (cleanup/bookkeeping-on-failure) before re-throwing, so a rejected capability request is durably remembered (drives the "previously denied" badge on next request) even though the call itself fails.
- **Capability/scope rejection paths** (not exceptions caught, but explicit `throw` sites forming the authorization boundary):
  - `enforceCapability()` (`dispatcher.ts:1121`) — two `throw new CapabilityNotGrantedError(requiredType)` sites: one when `dappSession` is missing entirely (F-006 "fail-closed... Pre-fix, this returned [] and the dispatcher fell through to the sink with no grants" — a documented CVE-shaped regression closed), one when the required capability type isn't in `grantedTypes`.
  - `handleGetAccounts()` (`dispatcher.ts:527`) — three-way branch: session missing → plain `Error`; accounts grant exists but `session.accounts` empty → returns `[]` + `logger.log(Warn, "Desync: ...")` (self-healing degrade rather than throw); no grant → `throw new CapabilityNotGrantedError("accounts")`.
  - Every `method-scope-checkers.ts` `checkX` function throws a `Scope violation: ...` `Error` on mismatch — ~15 distinct throw sites, each hand-formats a diagnostic message naming the offending contract/function/address, which the README calls out as part of the byte-stable public error-string contract dApps substring-match on.
  - `checkRegisterContractClassDisabled` (`method-scope-checkers.ts:415`) unconditionally throws — the method is permanently denied at the scope layer rather than the dispatch layer, "the single source of truth; scope runs before routing, so no dispatcher branch is needed."
  - `handleBatch()` (`dispatcher.ts:603`) rejects `sendTx`/`registerToken` legs with a dedicated `Error` before any dispatch, to server-side-enforce a contract the Zod schema already enforces client-side — defense against a raw protocol client bypassing the SDK.
- **No `finally`/cleanup-on-success-path teardown** was found in this package (e.g., no explicit "release lock" cleanup) — the FIFO-baton release logic (`DispatchHooks.onExecutionEnqueued`) is a callback invoked by the *caller* (background.ts), not a try/finally owned here; the dispatcher's docstring is explicit that hooks must NOT propagate into recursive `batch` leg dispatches (`handleBatch` deliberately omits forwarding `hooks`) to avoid breaking the batch's sequential-completion contract — this is the closest thing to a "cleanup discipline" comment in the module, expressed as an omission rule rather than a try/finally.
- **`DiscoveryQueue`** has no try/catch of its own; error containment (stale-discovery rejection) is handled via explicit state checks (`discovery.status !== "pending"`, `now - discovery.timestamp > STALE_MS` → `handler.rejectDiscovery(...)`) rather than exceptions.