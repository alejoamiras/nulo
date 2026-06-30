# Repo map — `packages/aztec-runtime`

`/harden quality` (ultra) Phase 1. Lens: **typing quality** (`any`/`unknown` misuse,
loose @aztec/* wrappers, primitive obsession, missing discriminated unions, SDK-boundary
casts) and **dedup** (duplicated logic/types).

**Purpose.** Wraps the Aztec SDK / PXE / account / chain runtime for the wallet. Owns
the long-lived PXE host (one per `(profileId, chainId)`), the cross-process RPC surface
between the SW and the offscreen document, class-id-verified artifact resolution, and
`NuloAccount` (thin adapter over `@aztec/accounts/schnorr` with payload chunking + fee
translation). Runs inside the offscreen document; chrome-agnostic by design (no `chrome.*`).

Stack position: `… → extension-messaging → aztec-runtime → wallet-bridge → extension`.
Depends on `wallet-core` + `extension-messaging`; deliberately NOT on `wallet-bridge`.

> **Doc drift (flag).** `README.md:62` says aztec deps are "currently 4.2.0"; `package.json`
> pins `5.0.0-rc.1` across all `@aztec/*`. Inline comments also cite `@aztec/pxe@4.2.0`
> (`service.ts:363`). README file-map omits `subset.ts`, `schemas.ts`, `utils/chain-identity.ts`.

---

## 1. Module inventory (25 source files, 5 colocated tests)

### pxe/ (transport + service + chain + artifacts — the bulk)
| File | LOC | Role |
|---|---|---|
| `pxe/service.ts` | 551 | `PxeService` — RPC method host. 21 methods, two-level concurrency (per-chain `ReadWriteGuard` + per-profile barrier), orphan-DB GC, profile-delete cascade, inbound zod validation. |
| `pxe/client.ts` | 203 | `PxeServiceClientBase` — SW-side RPC transport. Outbound zod rehydration per method; `proveTx` 30-min timeout override. |
| `pxe/proxy.ts` | 104 | `PXEProxy` — curries a client+network into a single-network `IPXE`. |
| `pxe/ipxe.ts` | 51 | `IPXE` interface — in-process per-network facade (18 methods). |
| `pxe/spec.ts` | 82 | `Methods` RPC type (21 methods) + `PXE_SERVICE_NAME`. |
| `pxe/subset.ts` | 61 | `PXE_SUBSET_METHODS` + compile-time assertions pinning `IPXE`≡subset⊂`Methods`. |
| `pxe/schemas.ts` | 43 | zod schemas: `NoteDaoSchema`, `PackedPrivateEventSchema`, `NotesFilterSchema`. |
| `pxe/chain-runtime.ts` | 305 | `ChainRuntime`, `ProductionPxeFactory` (accelerator/required/proverless modes), `ChainRuntimeRegistry`. |
| `pxe/artifact-registry.ts` | 214 | `ArtifactRegistry` — policy-ordered (`pxe-local`/`known`) artifact resolution + verified-class-id cache. |
| `pxe/artifact-class-id.ts` | 72 | `verifyArtifactClassId` + `DefaultArtifactClassIdVerifier` (DI port). Poseidon recompute vs expected `Fr`. |
| `pxe/known-artifacts.ts` | 76 | `loadProductionKnownArtifacts` — 12 compiled-in artifacts + SponsoredFPC instance. |
| `pxe/note-schemas.ts` | 99 | `loadProductionNoteSchemas` — static `classId→slot→NoteSchema` map for note rendering. |
| `pxe/index.ts` | 25 | barrel. |

### account/
| File | LOC | Role |
|---|---|---|
| `account/nulo-account.ts` | 222 | `NuloAccount implements IAccountContract`. Salt=`Fr.ZERO`, recursive `APP_MAX_CALLS` chunking, deploy+first-call multicall, authwit. |
| `account/fee-options.ts` | 91 | `completeFeeOptions` — RPC fee → `GasSettings` translator (shared standard+fast path). |
| `account/index.ts` | 42 | `IAccountContract` interface + re-exports. |

### adapters/ ports/ utils/ offscreen/
| File | LOC | Role |
|---|---|---|
| `adapters/aztec-node-factory-adapter.ts` | 58 | `AztecNodeFactoryAdapter` + `isAllowedRpcUrl` — sole `createAztecNodeClient` call site; RPC-scheme allowlist (F-011). |
| `ports/node-factory-port.ts` | 26 | `NodeFactory` port. |
| `utils/fetch.ts` | 99 | `makeFetchWithTimeout` — SDK `defaultFetch` clone + AbortController timeout + retry. |
| `utils/chain-identity.ts` | 59 | `assertLiveChainIdentity` (F-012 chain-spoofing defense, composite `l1ChainId ^ rollupVersion`). |
| `utils/index.ts`, `adapters/index.ts`, `ports/index.ts` | — | barrels. |
| `offscreen/entry.ts` | 48 | `createPxeOffscreen` — boots `PxeService` in offscreen via `ServiceCollection`. |
| `index.ts` | 1 | root barrel — `export {}` (empty; subpath exports only). |

---

## 2. Public exports (what the extension imports)
Subpath exports (no single barrel): `.` (empty), `./pxe`, `./account`, `./ports`,
`./adapters`, `./utils`, `./offscreen/entry`.

- **PXE**: `PxeService`, `IProfileReader`, `PxeServiceClientBase`, `PXEProxy`, `IPXE`,
  `Methods`, `PXE_SERVICE_NAME`, `NotesFilter`, `NoteDaoSchema`, `PackedPrivateEventSchema`,
  `NotesFilterSchema`, `ChainRuntime`, `ChainRuntimeRegistry`, `ProductionPxeFactory`,
  `PxeFactory`, `NetworkInfo`, `ArtifactRegistry`, `defaultPolicy`, `ArtifactPolicy`,
  `ArtifactSource`, note-schema types + loaders, class-id verifier types.
- **Account**: `NuloAccount`, `IAccountContract`, `completeFeeOptions`, `MIN_FEE_PADDING`,
  `PartialGasSettingsRPC`, `CompleteFeeOptionsConfig`.
- **Adapters/ports/utils**: `AztecNodeFactoryAdapter`, `isAllowedRpcUrl` (via file, not barrel),
  `NodeFactory`, `makeFetchWithTimeout`, `assertLiveChainIdentity`.
- **Offscreen**: `createPxeOffscreen`, `PxeOffscreenDeps`.

`NetworkInfo` (`{profileId, chainId, rpcUrl}`) is the structural seam the extension's
`Network` satisfies; intentionally declared inline (the `@/` alias doesn't resolve here).

---

## 3. Trust / external boundary
- **SW ↔ offscreen RPC** (`extension-messaging`): inbound args zod-parsed in `service.ts`;
  outbound results zod-rehydrated in `client.ts`. JSON round-trip strips class instances.
- **Aztec node RPC** (`createAztecNodeClient` over `makeFetchWithTimeout`): untrusted endpoint.
  Defenses: `isAllowedRpcUrl` scheme allowlist (https + loopback http only) at the adapter
  AND network/spec.ts schema; `assertLiveChainIdentity` against chain spoofing (NOTE: README
  + `chain-identity.ts:21` say it is NOT applied inside `nulo-account.ts:buildTxExecutionRequest`
  — known gap).
- **dApp-supplied artifacts**: every artifact returned by `ArtifactRegistry.resolve` (pxe-local
  branch) has its class-id Poseidon-recomputed vs expected (`artifact-class-id.ts`); mismatch →
  skip source. Hard security gate.
- **dApp-supplied fee settings**: `PartialGasSettingsRPC` fields typed `unknown`; validated only
  by `Gas.from`/`GasFees.from` throwing (fee-options.ts).
- **`@alejoamiras/aztec-accelerator`**: external prover server; required-mode preflight + onPhase
  hard-fail gate (CI only).

---

## 4. Internal deps
- `wallet-core`: `ServiceCollection`, `Service`/`ServiceClient` base, `ServiceSpec`, `ReadWriteGuard`,
  `ILogger`/`LogLevel`.
- `extension-messaging/offscreen`: `Service`, `ServiceClient`, `defineRpcMethods`.
- Intra-package: `pxe/*` self-references; `account` → `pxe/ipxe`; `chain-runtime` → `adapters` →
  `ports` + `utils/fetch`. `offscreen/entry` → `pxe/service` + `chain-runtime`.

---

## 5. Libs (`@aztec/*`, all `5.0.0-rc.1`)
`@aztec/accounts` (schnorr + schnorr/stub), `@aztec/aztec.js/wallet` (`PrivateEventFilter`),
`@aztec/bb.js`, `@aztec/entrypoints` (account/multicall/encoding/interfaces),
`@aztec/foundation` (curves/bn254 `Fr`, json-rpc, retry, schemas, branded-types),
`@aztec/noir-contracts.js` (FPC/NFT/SponsoredFPC/Token), `@aztec/protocol-contracts`,
`@aztec/standard-contracts`, `@aztec/pxe` (client/bundle + config), `@aztec/simulator/client`,
`@aztec/stdlib` (abi/auth-witness/aztec-address/block/contract/gas/hash/interfaces/keys/note/tx).
Plus `@alejoamiras/aztec-accelerator`, two `@defi-wonderland`/`@wonderland` tarball deps, `zod ^4`.
tsconfig `strict: true`, `skipLibCheck: true`.

---

## 6. Test surfaces (5 colocated `*.test.ts`; no vitest.config — uses repo root)
- `pxe/service.test.ts` — `getContractInstance` cascade (pxe→node→known) + `nodeBestEffort`. Mocks JSON-alias loaders. Heavy `as unknown as` private-field pokes.
- `pxe/chain-runtime.test.ts` — `ProductionPxeFactory` default/required/proverless modes; mocks accelerator + createPXE.
- `pxe/subset.test.ts` — pins 18-method subset + SW-only exclusions.
- `account/fee-options.test.ts` — 8 cases incl. malformed-input throw + `MIN_FEE_PADDING` pin.
- `utils/chain-identity.test.ts` — composite XOR match/drift/local-skip.
**Coverage gaps:** no unit tests for `nulo-account.ts` (chunking, deploy-wrap — relies on network e2e),
`artifact-registry`/`artifact-class-id`, `client.ts`/`proxy.ts` rehydration, `fetch.ts` timeout,
`isAllowedRpcUrl`, the concurrency guards in `service.ts`.

---

## 7. EXCLUDE paths
`node_modules/`, raw JSON artifacts pulled via vite aliases (`@wonderland-token-artifact`,
`@private-fpc-artifact` — not in this package), generated/compiled `@aztec/*` types.
Tests excluded from production-cast counts but in scope for test-quality notes.

---

## 8. Proposed Phase-2 clusters (5, stably named)

1. **`aztec-runtime/pxe-transport`** — `spec.ts`, `ipxe.ts`, `proxy.ts`, `client.ts`,
   `subset.ts`, `schemas.ts`, `service.ts`. The RPC surface + method host + concurrency.
2. **`aztec-runtime/chain-runtime`** — `chain-runtime.ts` (ChainRuntime, factory, registry).
3. **`aztec-runtime/artifacts`** — `artifact-registry.ts`, `artifact-class-id.ts`,
   `known-artifacts.ts`, `note-schemas.ts`.
4. **`aztec-runtime/account`** — `nulo-account.ts`, `fee-options.ts`, `account/index.ts`.
5. **`aztec-runtime/node-adapter`** — `adapters/`, `ports/`, `utils/fetch.ts`,
   `utils/chain-identity.ts`, `offscreen/entry.ts`, root `index.ts`.

---

## 9. Typing + dedup hotspots (ranked)

### DEDUP
- **[HIGH] 5-way hand-maintained PXE method duplication.** The same ~20 methods are declared in
  `spec.ts` (`Methods`), `ipxe.ts` (`IPXE`), `proxy.ts` (`PXEProxy` body), `client.ts`
  (`PxeServiceClientBase` body, with per-method zod), `service.ts` (`PxeService` body, with
  per-method zod). `subset.ts` pins only 3 boundaries via type asserts and explicitly concedes
  "full mapped-type derivation … is a larger step." Adding/changing one RPC = edit 5 files +
  update subset list. The single biggest maintainability surface. Candidate: derive `IPXE`/proxy
  from `Methods` via mapped type (strip `network`, promisify); generate or table-drive the zod map.
- **[HIGH] Artifact/class-id computation duplicated across two loaders.** `known-artifacts.ts` and
  `note-schemas.ts` both import the same JSON aliases (`@wonderland-token-artifact`,
  `@private-fpc-artifact`), both `loadContractArtifact` + `getContractClassFromArtifact` on
  Token/NFT/Wonderland/PrivateFPC. Class-ids for the same 4 artifacts are Poseidon-hashed twice,
  in two cache regimes (shared-promise vs module-promise). Consolidate to one artifact catalog.
- **[MED] Duplicate type name `NetworkInfo`.** `chain-runtime.ts` (`{profileId,chainId,rpcUrl}`)
  and `artifact-registry.ts` (`{chainId}`) define different shapes under the same name; the
  registry's is barely used (`_network` ignored in `resolve`). Rename or drop.
- **[MED] `${profileId}:${chainId}` key + `${profileId}:` prefix logic duplicated.**
  `service.ts:chainKey` vs `ChainRuntimeRegistry.key`; prefix-scan in `service.onProfileDeleted`
  vs `registry.disposeProfile`. Centralize the key codec.
- **[MED] IndexedDB `deleteDatabase` Promise-wrapper repeated 3×** with slightly different
  onblocked handling (`service.ts` init ×2, `clearChainState`, plus fire-and-forget in
  `onProfileDeleted`). Extract one helper.
- **[LOW] `[SYNC-DEBUG]` block duplicated** verbatim in `service.proveTx` and `service.simulateTx`.
- **[LOW] `new SchnorrAccountContract(deriveSigningKey(secret))` + `getInitializationFunctionAndArgs`**
  done in both `NuloAccount.new` and `buildWithInitialization` (nulo-account.ts).

### TYPING
- **[HIGH] `ProductionPxeFactory` modes are boolean flags, not a discriminated union.**
  `required` / `proverless` / default with a *runtime* mutual-exclusion throw in the ctor
  (`chain-runtime.ts:114`). A DU (`{kind:"production"} | {kind:"required",host,port} | {kind:"proverless"}`)
  would make the illegal combo a compile error and remove the `host?/port?` optional sprawl.
- **[MED] SDK-boundary casts.** `client.ts:144` `as unknown as NoteDao[]` (zod yields POJOs, not
  `NoteDao` instances — documented, but consumers silently lose class methods);
  `chain-runtime.ts:82` `this.pxe as unknown as {stop?}` (PXE type omits `stop`);
  `chain-runtime.ts:125` `} as PXEConfig` (partial config cast); `fee-options.ts` ×4
  `as Parameters<typeof Gas/GasFees.from>[0]` laundering `unknown` RPC fields.
- **[MED] Inconsistent rehydration on the result path.** Every `client.ts` method zod-parses its
  result EXCEPT `getNoteSchemas` (`(result ?? {}) as Record<…>`) and `getBlockTimestamp`
  (`Number(result)`). The two SW-only methods skip the validation discipline applied everywhere else.
- **[MED] `unknown`-typed boundary bags.** `PartialGasSettingsRPC` (all 4 fields `unknown`,
  defended by throw-on-parse) and `IProfileReader.onActiveProfileChanged` handler arg `(profile: unknown)`.
  Defensible at trust boundaries but worth a typed wrapper.
- **[LOW] Primitive obsession.** `chainId: number`, `profileId: string`, `rpcUrl: string`, the
  composite `(l1ChainId ^ rollupVersion) >>> 0` chainId, and `getBlockTimestamp`'s bare
  `number | undefined` epoch-seconds all travel unbranded across the package and the RPC seam.
- **[LOW] 4× `@ts-expect-error` on raw-JSON vite-alias imports** (`known-artifacts.ts`,
  `note-schemas.ts`) — unavoidable but a typed `declare module "@*-artifact"` shim would remove them.
- **Positive examples (keep as patterns):** `isAllowedRpcUrl`'s `{ok:true}|{ok:false,reason}` DU;
  `subset.ts`'s compile-time `Equal<>` assertions; `artifact-class-id.ts`'s DI-port verifier.
