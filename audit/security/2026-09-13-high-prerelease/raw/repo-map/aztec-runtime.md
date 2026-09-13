# `packages/aztec-runtime` — repo map

## 1. Module inventory (~4,734 non-test LOC)

**`src/account/`** (752 LOC)
| File | LOC | Purpose |
|---|---|---|
| `nulo-account.ts` | 245 | `NuloAccount`: adapter over `@aztec/accounts/schnorr`; `new`/`fromSigningKey`, first-tx multicall wrapping, recursive payload chunking, tx-execution-request building. |
| `frozen-artifact.ts` | 25 | Loads + pins vendored `SchnorrAccount.json` by sha256 + class id. |
| `instantiation-descriptor.ts` | 87 | Frozen ctor name/args/salt/immutablesHash/deployer. |
| `address-freeze.ts` | 92 | Append-only regime record. |
| `account-export.ts` | 158 | NULO-ACCOUNT-EXPORT v1: build/serialize/parse/encrypt/decrypt of a signing key. |
| `fee-options.ts` | 90 | `completeFeeOptions`: `GasSettings` translator. |
| `index.ts` | 55 | Barrel + `IAccountContract`. |
| `artifacts/SchnorrAccount.json` | 1.63 MB | Vendored, byte-frozen. `artifacts/PROVENANCE.md`. |

**`src/pxe/`** (3,631 LOC)
| File | LOC | Purpose |
|---|---|---|
| `service.ts` | 974 | `PxeService`: per-(profile,chain) PXE host; concurrency guards, generation fencing, orphan sweep, 25 RPC bodies. |
| `client.ts` | 381 | `PxeServiceClientBase`: typed client; zod response validation, missing-store-key recovery, per-method timeouts. |
| `public-events.ts` | 445 | Public `Transfer`-event fetch/decode/validate; node-direct token-class gate. |
| `chain-runtime.ts` | 390 | `ChainRuntime`/`ChainRuntimeRegistry`/`ProductionPxeFactory`; wires accelerator prover. |
| `artifact-registry.ts` | 216 | Policy-driven artifact resolution with mandatory class-id verification. |
| `opfs-store.ts` | 303 | Encrypted per-(profile,chain) OPFS SQLite store. |
| `spec.ts` | 120 | `Methods` RPC contract + `PXE_SERVICE_NAME`. |
| `descriptors.ts` | 112 | `PXE_METHOD_DESCRIPTORS` exposure table. |
| `artifact-catalog.ts` | 108 | 12 compiled-in artifact class ids. |
| `note-schemas.ts` | 90 | class-id→slot→`NoteSchema` map. |
| `proxy.ts` | 66 | `PXEProxy` per-network `IPXE` facade. |
| `artifact-class-id.ts` | 71 | `verifyArtifactClassId` recompute-and-compare. |
| `async-memo.ts` | 63 | memoize-with-retry. |
| `lifecycle-coordinator.ts` | 45 | per-chain purge-epoch fence. |
| `ipxe.ts` | 52 | `IPXE` interface. |
| `effective-class.ts` | 42 | preimage/instance effective class + upgrade rejection. |
| `schemas.ts` | 42 | `NoteDao`/`PackedPrivateEvent`/`NotesFilter` zod. |
| `known-artifacts.ts` | 40 | compiled-in artifacts + SponsoredFPC instance. |
| `chain-coordinates.ts` | 37 | `(profileId, chainId)` key codec. |
| `index.ts` | 34 | Barrel. |

**`src/adapters/`** (70) — `aztec-node-factory-adapter.ts`: sole `createAztecNodeClient` site + `isAllowedRpcUrl`.
**`src/ports/`** (36) — `node-factory-port.ts`: `NodeFactory` (`createNode`/`probeChainId`).
**`src/utils/`** (197) — `fetch.ts` (timeout+retry), `chain-identity.ts` (`assertLiveChainIdentity`/`chainInfoFrom`).
**`src/offscreen/`** (47) — `entry.ts`: `createPxeOffscreen`.

## 2. Entrypoints
- Subpath exports: `./pxe`, `./pxe/public-events`, `./account`, `./ports`, `./adapters`, `./utils`, `./offscreen/entry`.
- RPC handlers: `PxeService` (`pxe/service.ts:76-102`) `defineRpcMethods<Methods>()` — 25 methods: `getContractInstance, getContractArtifact, getNoteSchemas, registerAccount, registerSender, getSenders, removeSender, getRegisteredAccounts, registerContractClass, registerContract, getContracts, getNotes, proveTx, profileTx, simulateTx, executeUtility, getPrivateEvents, getSyncedBlockHeader, getBlockTimestamp, getPublicTokenTransferEvents, getPublicScanTips, getPublicTokenClassStatus, clearChainState, clearProfileState, provisionChainStoreKey`. `PxeService extends Service<Methods>` from `@nulo/extension-messaging/offscreen` — the base class is the message-handler boundary.
- `PXE_METHOD_DESCRIPTORS` (`descriptors.ts:43-69`) exposure table; dispatch allowlist stays hand-written (`descriptors.ts:7-11`).
- `createPxeOffscreen` (`offscreen/entry.ts:43-47`) called from `apps/extension/src/offscreen/index.ts:6-7`.
- `PXEProxy` (`pxe/proxy.ts`) via `PxeServiceClientBase.getPXE(network)` (`client.ts:211-213`) → `NuloAccount`.
- `NodeFactory` port implemented by `AztecNodeFactoryAdapter`.
- No `chrome.*` (only comments `offscreen/entry.ts:10-12`, `artifact-class-id.ts:14`).
- Consumers in `apps/extension/src` (32 files): `core/adapters/index.ts`, `wallet/services/network/service.ts`, `wallet/services/pxe/client.ts`, `offscreen/index.ts`, `wallet/services/account/service.ts`, `wallet/services/account-integrity/coordinator.ts`, `wallet/services/execution/{service,tx-request-builder,fast-path,dapp-send-executor,transfer-executor,view-executor,contract-resolver,authwit-discoverer,discovery-probe,fee/embedded-fpc-cap,helpers/*}.ts`, `wallet/services/incoming-transfer/{service,public-event-indexer,spec}.ts`, `wallet/services/note/service.ts`, `wallet/utils/{fn,index}.ts`, `accelerator/config.ts`, `e2e/{config,chrome-storage-proof-gate}.ts`, `utils/received-display.ts`.

## 3. Trust boundaries

**Untrusted input:**
- dApp contract artifacts via `aztec_registerContract` → `PxeService.registerContract` (`service.ts:434-456`): (a) class-id recompute for non-compiled-in (`artifact-registry.ts:203-215` `verifyAndCache` → `artifact-class-id.ts:52-71`); (b) address consistency `service.ts:449-454` (`"registerContract address mismatch"`).
- Node RPC responses zod-revalidated: `service.ts:318,364,386,397,430,444-445,479,494,522,539,573-575,582,585,596,621,641`; `client.ts:220-356`.
- Public event logs: `public-events.ts` `validatePageOrdering` (`:335-364`), `pinnedBoundExceedsCheckpointed` (`:298-311`), `decodePublicTransfer` (`:367-389`).
- RPC endpoint URL: `isAllowedRpcUrl` (`adapters/aztec-node-factory-adapter.ts:32-47`, checked `:51-54`, `:59-62`) — `https:` any host; `http:` only `localhost`/`127.0.0.1`/`[::1]`.
- Live node identity: `assertLiveChainIdentity` (`utils/chain-identity.ts:53-61`) — compares `(l1ChainId, rollupVersion)` composite vs stored `chainId`. **Documented gap (`:20-24`): NOT applied at `nulo-account.ts` `buildTxExecutionRequest`** (no `networkInfo` in scope).

**Secrets:**
- `NuloAccount.new(seed, logger)` (`nulo-account.ts:62-67`) → `deriveNuloAccountKeys(seed)` → `{signingKey, secretKey}`.
- `NuloAccount.fromSigningKey` (`:77-80`) → `deriveSecretKeyFromSigningKey`.
- Signing key consumed `:86` (`new SchnorrAccountContract(signingKey)`), `:89`, `:232`; never stored as its own field — inside `signingAccountContract` (`:54`). Comment `:48-50`: "the derived privacy secret key (NEVER the seed and NEVER the signing key): it is the only key material this class hands to the PXE."
- Privacy secret key → `pxe.registerAccount(this.secretKey, ...)` (`:106`); `PxeService.registerAccount` (`service.ts:379-400`, comment `:381-385`).
- Signing-key plaintext export: `account-export.ts` `AccountExportV1.signingKey` (`:57-58`), `buildAccountExport` (`:84-94`), `serializeAccountExport` (`:97-99`); `encryptAccountExport`/`decryptAccountExport` (`:146-158`) via `EncryptionKey.fromPassword`. Posture `:16-20`: "the plaintext checksum is CORRUPTION DETECTION, not authentication."
- PXE store key (32 B): `PxeService.provisionChainStoreKey` (`service.ts:775-806`, `this.storeKeys` `:143`); client `StoreKeyProvision`/`storeKeyProvider` (`client.ts:77-123`); crosses the wire base64 (`client.ts:200`), zeroized `client.ts:207`; `opfs-store.ts:112-114` copies before hand-off. Fail-closed `chain-runtime.ts:140-146` (`PXE_STORE_KEY_MISSING`).
- No `chrome.storage.*` writes.

**External calls:** `AztecNodeFactoryAdapter` (`:55,65`); `utils/fetch.ts` (`DEFAULT_REQUEST_TIMEOUT_MS = 60_000`, `:18`); accelerator `AcceleratorProver` `{host, port}` (`chain-runtime.ts:7,228-229`). Node methods: `getPublicLogsByTags`, `getBlock`, `getBlockData`, `getContract`, `getNodeInfo`, `getCurrentMinFees`, `getNullifierMembershipWitness`, `getL1ContractAddresses`, `getBlockHashMembershipWitness`, `getBlockNumber`.

**Storage writes:** encrypted OPFS SQLite via `opfs-store.ts`; legacy IndexedDB cleanup `service.ts:227-311` (delete only).

**Integrity fences (not authz):** `assertGenerationCurrent` (`service.ts:858-869`); store-key gate `chain-runtime.ts:140-146`; artifact class-id gate.

## 4. Dependency graph
- `account/nulo-account.ts` → `pxe/ipxe.ts`, `fee-options.ts`, `frozen-artifact.ts`, `instantiation-descriptor.ts`; `@nulo/wallet-crypto`, `@nulo/wallet-core/logger`, `@aztec/*`.
- `account/index.ts` → `pxe/ipxe.ts`, `fee-options.ts` (the one `account/ → pxe/` edge).
- `account/account-export.ts` → `address-freeze.ts`, `frozen-artifact.ts`, `instantiation-descriptor.ts`; `@nulo/wallet-crypto` (`EncryptionKey`), `@nulo/wallet-core/utils`.
- `pxe/service.ts` → async-memo, chain-runtime, chain-coordinates, opfs-store, artifact-registry, lifecycle-coordinator, known-artifacts, note-schemas, spec, schemas, public-events, effective-class; `@nulo/wallet-core/base`, `@nulo/extension-messaging/offscreen`, `ReadWriteGuard`.
- `pxe/chain-runtime.ts` → adapters, ports, chain-coordinates, opfs-store; `@alejoamiras/aztec-accelerator`, `@aztec/pxe`, `@aztec/kv-store`, `@aztec/simulator`.
- `pxe/client.ts` → chain-runtime (type), ipxe, spec, schemas, public-events, proxy; `ServiceClient`.
- `pxe/artifact-catalog.ts` → 2 vite-aliased raw JSON imports (`@wonderland-token-artifact`, `@private-fpc-artifact`, `apps/extension/vite.shared.ts:35-40`).
- Handoffs: `offscreen/entry.ts:44-46` registers `PxeService` into `ServiceCollection`; `PxeServiceClientBase.request()` (`client.ts:125-160`) → transport → `PxeService` body; `network/service.ts:220` defaults `nodeFactory ?? new AztecNodeFactoryAdapter()`; `chain-runtime.ts:130` same.

## 5. Frameworks / libs
`@aztec/*` 5.2.0; `@alejoamiras/aztec-accelerator` 5.2.0; `@alejoamiras/private-fee-juice` 5.0.1; `@aztec-foundation/aztec-standards` 5.0.1; `zod ^4.4.3` pervasive; `@aztec/kv-store/sqlite-opfs`. Curve/hash via `@aztec/foundation`. `node:crypto` tests only.

## 6. Test surfaces
Well covered: address-freeze KATs, `service.ts` (6 test files), chain-runtime, opfs-store, public-events, client. **Thin:** `artifact-registry.ts` / `artifact-class-id.ts` — no colocated test; extension test injects fake verifiers, so **`verifyArtifactClassId` (`artifact-class-id.ts:52-71`) has zero direct unit-test references repo-wide**. `note-schemas.ts`, `artifact-catalog.ts`, `known-artifacts.ts` — no colocated tests. `nulo-account.ts` — `nulo-account.test.ts` 62 lines, one branch; **recursive payload chunking (`chunkHead`, `APP_MAX_CALLS`) has no unit test** (network e2e only). `account-export.test.ts` 65 lines happy path + basic tamper.

## 7. Generated / vendored
`account/artifacts/SchnorrAccount.json` — vendored, production-wired (`frozen-artifact.ts:25`). `@wonderland-token-artifact` / `@private-fpc-artifact` aliases — production-wired, track installed npm versions. `implementations-plan/key-model-v2/reference/vectors.json` — test-only external fixture.

## 8. Security-relevant invariants (quoted)
- README `:57-62`: upstream schnorr account only; "Salt is `Fr.ZERO`"; "Class-id verification is required … a security gate"; "Payload chunking is recursive … Chunk-size changes ripple through authwit signing"; "PXE state is per-chain"; "Pinned aztec versions … `5.0.0-rc.2`" (stale; actual 5.2.0).
- `CLAUDE.md` § Account-address freeze `:81-89` (one regime per major, append-only; artifact never bumped with `@aztec`; canary; handled mismatch state).
- `instantiation-descriptor.ts:40-47`: "this digest is SYMBOLIC w.r.t. constructor-arg MARSHALLING … the KAT is the load-bearing control."
- `address-freeze.ts:9-19`: append-only rules, KDF v1→v2 redefinition history.
- `nulo-account.ts:48-50`: PXE gets only the privacy secret key.
- `account-export.ts:16-20`: checksum is corruption detection, not authentication.
- `pxe/service.ts:381-385`: seam wire carries only the derived privacy secret key.
- `adapters/aztec-node-factory-adapter.ts:1-21`: F-011 RPC-URL allowlist.
- `utils/chain-identity.ts:1-24`: F-012 check; **gap at `buildTxExecutionRequest` (deferred follow-up)**.
- `opfs-store.ts:1-26`, `:186-200`: encryption mandatory; "THROW `PxeStoreVersionMismatch` … NEVER `store.clear()`".
- `chain-runtime.ts:140-146`: fail-closed without store key.
- `descriptors.ts:7-11`: dispatch allowlist hand-written, never derived.
- `effective-class.ts:1-25`: upgraded instance → fail explicitly.
- `public-events.ts:83-90, 409-419`: dropped page is suspect, not end-of-stream; token-class gate checks `finalized` anchor + pinned `checkpointed` hash.
