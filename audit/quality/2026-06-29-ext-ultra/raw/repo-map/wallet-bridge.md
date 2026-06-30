# Repo map — `packages/wallet-bridge`

> Phase-1 map for `/harden quality` (ultra). Read-only. Lens: **TYPING quality** + **DEDUP**.
> Paths are repo-relative. Line refs are at time of mapping (branch `dev-quality`).

`@nulo/wallet-bridge` v0.2.0 — the dApp-facing bridge. Routes every `@aztec/wallet-sdk`
method call into typed internal service calls, owns the capability map + per-message scope
enforcement, and projects sessions→accounts. Transport-shaped, NOT chain-shaped: deliberately
does **not** depend on `@nulo/aztec-runtime` or `@nulo/extension` (biome-enforced, `biome.json:287-301`).

---

## 1. Module inventory

19 source files (`src/*.ts`, non-test), 5,573 LOC incl. tests. Sizes drive the cluster split.

| File | LOC | Role | Layer |
|---|---|---|---|
| `src/dispatcher.ts` | 1236 | **The dispatcher.** Routing, all method handlers, capability-coverage helpers, requestCapabilities flow, wire→Operation building. | core |
| `src/method-scope-checkers.ts` | 386 | Leaf: per-method scope-check bodies + matchers (`matchesScope`, `inAddressList`, `grantsOfType`). | leaf |
| `src/method-descriptors.ts` | 270 | **SSOT** `METHOD_REGISTRY` + 6 `derive*` tables (capability/exempt/kind/network/account/scope-checker). | near-leaf |
| `src/operation.ts` | 191 | Internal `Operation` discriminated union (18 kinds) + fee/gas types. Imports `@aztec/*`. | model |
| `src/dapp-interaction-protocol.ts` | 156 | Wire `*Request` shapes (CAIP-keyed `Omit<…Operation>`); `Execution/Capability Params/Result`. | model |
| `src/scope-enforcement.ts` | 106 | `enforceScope` / `enforceScopeWithSession` (F-005 account-scope) over derived checker map. | mid |
| `src/services-contract.ts` | 109 | Structural consumer ifaces (`INetworkReader`, `IAccountReader`, `IExecutionRunner`, `IDappInteractionRunner`, `IDappSessionWriter`, `ITokenRegistryReader`, hooks). | contract |
| `src/discovery-queue.ts` | 78 | `DiscoveryQueue` class. **Only runtime/side-effecting leaf** — touches `chrome.action.*` (73-76). | runtime |
| `src/caip.ts` | 70 | CAIP-2/10 format+parse (SSOT) + `resolveNetworkByChainId`. | leaf |
| `src/capabilities.ts` | 69 | `Capability` union (6 variants) + grant/reject records + `Scope`/`ScopePattern`. | model |
| `src/fee.ts` | 67 | `FeePaymentMethod` union, `FeeSettings`, `GasBalances`, `TransferFeeEstimate`. | model |
| `src/session-types.ts` | 66 | `IDappSessionRef`/`INetworkRef`/`IAccountRef`, `AccessLevel` enum, `DappPermissions`. | model |
| `src/action.ts` | 55 | `Action` union (6 kinds). | model |
| `src/capability-map.ts` | 34 | Thin facade: `getRequiredCapability`/`isCapabilityExempt` over derived tables. | facade |
| `src/operation-result.ts` | 29 | `OperationResult<T>` union (ok/failed/cancelled/skipped). | model |
| `src/index.ts` | 26 | Barrel (`export *` from 16 modules). | barrel |
| `src/authwit-content.ts` | 24 | `AuthwitContent` union (4 kinds). | model |
| `src/transaction-origin.ts` | 21 | `OriginType` enum + `LocalTxOrigin`. | model |
| `src/types.ts` | 14 | `SessionContext`. | model |

Tests: `dispatcher.test.ts` (1712), `scope-enforcement.test.ts` (568), `method-descriptors.test.ts` (286).

---

## 2. Public exports

Barrel re-exports everything (`src/index.ts:11-26`). Notable public surface:
- **Class** `WalletSdkDispatcher` (7-arg positional ctor; `tokenRegistryReader` optional).
- **Fns** `unwrapOperationResult`, `enforceScope`, `enforceScopeWithSession`, `getRequiredCapability`,
  `isCapabilityExempt`, all `derive*` + 15 `check*` checkers, `caip` helpers.
- **Class** `DiscoveryQueue`.
- **Types** `Operation`/`OperationKind` (18 kinds), `Capability` (6), `Action` (6), `AuthwitContent` (4),
  `OperationResult`, all `*Request`, `SessionContext`, the 6 `I*` service contracts, `MethodDescriptor`.
- **Enums (values)** `AccessLevel`, `OriginType`.
- `METHOD_REGISTRY` + 6 derived tables (`METHOD_CAPABILITY_MAP`, `EXEMPT_METHODS`, `METHOD_TO_KIND`,
  `NETWORK_ONLY_KINDS`, `ACCOUNT_KINDS`, `METHOD_SCOPE_CHECKER`).

Barrel is broad (`export *`) — no curated public/internal split; every helper is reachable by consumers.

---

## 3. Trust boundary (dApp ↔ wallet RPC)

This package **is** the trust boundary. Flow:

```
dApp → encrypted wallet-sdk channel → BackgroundConnectionHandler (in @nulo/extension, decrypts)
     → dispatcher.dispatch(methodName: string, args: unknown[], ctx: SessionContext, hooks?)
```

Everything crossing the boundary is **untyped**: `methodName: string`, `args: unknown[]`. The dispatcher
is the single chokepoint (README invariant). Gate sequence in `dispatch()` (`dispatcher.ts:275-375`):
1. `tryGetDappSessionByOriginAndChain` once at entry (F-006 TOCTOU fix — was 6 lookups).
2. `Object.hasOwn(METHOD_REGISTRY, methodName)` → reject unknown/prototype names (`toString`, …).
3. `enforceCapability` (type-level grant check; fail-closed `CapabilityNotGrantedError` on missing session).
4. `enforceScopeWithSession` / `enforceScope` (per-operation contract/function scope + F-005 per-account allow-list).
5. Route (handler if-cascade, else `METHOD_TO_KIND` → `buildOperation` → `executionService`).

Audit markers carried in registry + checkers (paired with tests): **F-003** (getAccounts needs
`canGet`), **F-004** (getAddressBook/registerSender need `addressBook`), **F-005** (account-scope arrays),
**F-006** (fail-closed missing session), **F1** (grantPublicAuthwit needs transaction cap or gate is dead),
**A1** (isTokenRegistered), **D7/D8** registry invariants. `registerContractClass` is deliberately
hard-denied at scope-check (`checkRegisterContractClassDisabled`, `:382`).

`registerToken` / `sendTx` / `grantPublicAuthwit` are popup-gated (route through `IDappInteractionRunner`).
Attacker-controllable strings (token name/symbol) shown next to contract address in popup (README).

---

## 4. Internal deps (intra-package)

```
caip ─┐
capabilities ─┐                         method-scope-checkers (leaf)
              ├─ method-descriptors ────┤        ▲
operation ────┘   (SSOT registry)       │        │ derives checker map
                       ▲                 │   scope-enforcement
        capability-map ┘ (facade)        │        ▲
                       ▲                 ▼        │
                       └──────── dispatcher ──────┘
                                    │ consumes
                          services-contract, dapp-interaction-protocol,
                          session-types, operation-result, transaction-origin, fee
```

The registry↔scope cycle is broken by putting checker **bodies** in the leaf `method-scope-checkers`
(depended-on, never depending back). `dispatcher.ts` imports the derived `METHOD_TO_KIND` /
`NETWORK_ONLY_KINDS` / `ACCOUNT_KINDS` / `METHOD_REGISTRY` directly.

---

## 5. External libs

- **`@aztec/wallet-sdk` 5.0.0-rc.1** — `WalletSchema` (runtime-patched), `BackgroundConnectionHandler`,
  `PendingDiscovery` (`discovery-queue.ts:1`).
- **`@aztec/aztec.js` / `@aztec/stdlib` / `@aztec/foundation` 5.0.0-rc.1** — type-only in `operation.ts`
  (`ExecutionPayload`, `FunctionCall`, `AztecAddress`, `Fr`, `CallIntent`, opts types).
- **`@nulo/wallet-core/logger`** (`ILogger`, `LogLevel`), **`@nulo/extension-messaging/errors`**
  (`CapabilityNotGrantedError`, `JobCancelledError`).
- **`chrome-types`** (dev) — `chrome.action` in `discovery-queue.ts`.
- **No `zod` dependency in this package.** zod lives only in the three external `nulo-schema-patch.ts`
  copies (see §9). The README's schema-patch contract is about files OUTSIDE this package.

> **Doc drift (minor):** README §"Not in batch" says pin `@aztec/wallet-sdk == 4.2.0`; actual is
> `5.0.0-rc.1` (`package.json`, schema-patch headers). Stale README line.

---

## 6. Test surfaces

- `method-descriptors.test.ts` (19 tests): **parity** (each `derive*` === frozen table), **structural
  invariants** (kind partition total+disjoint, method→kind injective, D7 XOR), **exhaustiveness** —
  "(i) every patched WalletSchema method ↔ descriptor", "(ii) every dispatch() handler literal has a
  descriptor", scope-coverage allowlist. This is the silent-omission guard.
- `scope-enforcement.test.ts` (89 blocks): per-method scope (registerContract, getContractMetadata,
  createAuthWit, sendTx/simulateTx/executeUtility/profileTx, grantPublicAuthwit), F-003/4/5, retired
  methods, edge cases.
- `dispatcher.test.ts` (85 blocks): requestCapabilities reject-persistence + field-aware delta,
  handleBatch, unwrapOperationResult, handleGetAccounts plan-v3 contract, sendTx opts.from multi-account,
  registerToken/isTokenRegistered/grantPublicAuthwit reachability, F-006 fail-closed, Phase-0.5 TOCTOU,
  contracts/scope field-diff re-consent. **Imports the extension's schema-patch copy** to pin cross-package drift.

All tests run against fakes implementing the `I*` contracts — no chain/runtime. Coverage is dense on
authz/scope; thinner on the wire→Operation cast layer (`buildNetworkOperation`/`buildAccountOperation`)
and the requestCapabilities merge/replacement logic.

---

## 7. EXCLUDE paths

- `node_modules/`, `dist/` (build output), `tsconfig.json`, `package.json`.
- `src/*.test.ts` — map as test surface (§6), exclude from refactor units.
- The three `nulo-schema-patch.ts` copies live in **other packages** (extension/faucet/playground) — they
  are NOT wallet-bridge source, but are the #1 cross-package dedup target (§9). Flag, don't refactor in-place.

---

## 8. Proposed Phase-2 clusters (stably named)

| Cluster | Files | One-line scope |
|---|---|---|
| **`wallet-bridge/dispatcher`** | `dispatcher.ts` (+ test) | Routing, all method handlers, capability-coverage helpers, requestCapabilities flow, wire→Operation building. The 1236-LOC mega-unit; primary hotspot target. |
| **`wallet-bridge/method-registry`** | `method-descriptors.ts`, `capability-map.ts` (+ descriptors test) | SSOT registry + derived tables + thin capability facade. |
| **`wallet-bridge/scope-enforcement`** | `scope-enforcement.ts`, `method-scope-checkers.ts` (+ scope test) | Per-method + per-account scope gates and matchers. |
| **`wallet-bridge/protocol-model`** | `operation.ts`, `operation-result.ts`, `dapp-interaction-protocol.ts`, `capabilities.ts`, `action.ts`, `authwit-content.ts`, `fee.ts`, `caip.ts`, `session-types.ts`, `types.ts`, `transaction-origin.ts`, `services-contract.ts`, `discovery-queue.ts`, `index.ts` | Type/model leaf layer + structural contracts + the `chrome`-touching `DiscoveryQueue` outlier. |

**Cross-cutting (not a cluster, flag separately):** `nulo-schema-patch` triplication spanning
`packages/extension`, `packages/faucet`, `packages/playground`.

---

## 9. Typing + dedup hotspots (the lens)

### TYPING (high → low)

1. **`args: unknown[]` positional RPC contract + `methodName: string` — no discriminated union on RPC
   method kind.** Every handler hand-indexes `args[0]`/`args[1]` and casts. **~33 real casts in
   `dispatcher.ts`** (+10 `as const`), **10 in `method-scope-checkers.ts`**, plus scope-enforcement. The
   wire boundary has zero schema validation on the wallet side (validation lives in the external
   schema-patch). Top structural typing debt — a `RpcRequest` discriminated union (`{ method; args }` per
   method) would collapse most casts and make `buildOperation` exhaustive.
2. **7 `as unknown as` double-casts** (the worst smell): `dispatcher.ts:731,740,748,754,758` (the
   requestCapabilities per-type delta cascade, `cap as unknown as XCapability`), `:881` (`replacementFor`
   fallback), `:1146` (`executeUtility` opts). Each is a place the real `Capability`/`Operation` union is
   thrown away and re-asserted.
3. **Loose protocol types** in `dapp-interaction-protocol.ts`: `CapabilityParams.manifest: unknown`,
   `delta: unknown[]`, `existingGrants: unknown[]`; `CapabilityResult.granted: unknown[]`. Plus the
   dispatcher-local `CapabilityManifest = { capabilities?: unknown[]; [k:string]: unknown }` (`:240`).
   `AccountsCapability.accounts: { alias; item: unknown }[]` (`capabilities.ts:20`) — `item` should be a
   CAIP/address type.
4. **`Record<string, unknown>` as a capability/payload stand-in — 13 sites in `dispatcher.ts`**
   (`:509,534,704,824,924,927,928,930,945,1135,1144,1154`). The `Capability` discriminated union exists
   but the request/grant/enrich paths bypass it and re-cast per access.
5. **Field-level casts in the wire→Operation switches** (`buildNetworkOperation` `:1078`,
   `buildAccountOperation` `:1127`): every branch does `args[N] as SomeOp["field"]` — type-unsafe seam
   with no validation; tests are thin here.

### DEDUP (high → low)

1. **Cross-package triplication of `nulo-schema-patch.ts`** (extension 119 LOC / faucet / playground;
   **bodies byte-identical**, only header comments differ — confirmed by `diff`). Pinned by a single
   reachability test in `dispatcher.test.ts`. Shared-package was explicitly rejected (README) to avoid
   third-party consumers — but the dedup risk (add a 4th custom RPC = edit 3 files + test) is real and the
   audit should weigh it. **#1 cross-package target.**
2. **Coverage-vs-enforcement parallel logic.** `dispatcher.ts` request-time coverage
   (`scopeCovers` `:188`, `contractsRequestCovered` `:173`, `transactionRequestCovered` `:200`,
   `simulationRequestCovered` `:207`, `dataRequestCovered` `:223`, `accountsCapsEqual` `:235`)
   **deliberately mirrors** call-time enforcement in `method-scope-checkers.ts` (`matchesScope`,
   `inAddressList`, per-type `check*`). Two per-capability-type implementations of "does grant cover
   target", kept in sync by hand (comments literally say "mirrors enforcement's shape"). High-value
   abstraction/dedup target.
3. **The same 6 capability types are switched on in ≥3 places** with no shared per-type strategy:
   (a) requestCapabilities delta cascade (`:727-761`), (b) the coverage fns, (c) `enrichGrantedCapabilities`
   (`:922`), plus (d) the scope checkers. A `Capability["type"]`-keyed handler table would unify them.
4. **`dispatch()` handler if-cascade — partial SSOT.** Registry routing `via:"handler"` is **opaque**
   (no handler reference), so `dispatch()` re-hardcodes 7 string-equality branches
   (`requestCapabilities/getAccounts/isTokenRegistered/batch/sendTx/registerToken/grantPublicAuthwit`,
   `:327-363`) AFTER resolving the descriptor. Metadata is centralized; handler routing is not →
   Switch-Statement smell. A `handler` discriminant carrying a handler key would close it.
5. **Account-resolution duplication (3×):** `handleRegisterToken` (`:586`), `handleGrantPublicAuthwit`
   (`:634`), and `resolveNetworkAndAccount` (`:1195`) all repeat resolveNetwork → getAccounts →
   `getSessionAccountAddresses` → find session-authorized account → throw "not authorized".
6. **`opts: { ...(args[1] as Record<string, unknown>) ?? {}, from: accountAddress }` triplicated** across
   `simulateTx`/`executeUtility`/`profileTx` in `buildAccountOperation` (`:1135,1144,1154`).
7. **Trivial indirection:** `WalletSdkDispatcher.unwrapResult` (`:1233`) is a one-line private wrapper of
   exported `unwrapOperationResult`.

### Long Method
- `handleRequestCapabilities` ~222 LOC (`:694-916`) — delta + popup + merge + replacement
  (`replacementFor`) + rejection-tracking + reload + enrich, all inline. **Biggest single method smell.**
- `dispatch()` ~100 LOC (`:275-375`).
