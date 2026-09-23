# Repo map — packages/aztec-runtime

Scope: `src/**/*.ts`, `*.test.ts` excluded. 32 non-test files, ~4184 LOC.

## 1) Module inventory

| Module | Path | Purpose | LOC |
|---|---|---|---|
| offscreen entry | `src/offscreen/entry.ts` | Chrome-agnostic offscreen bootstrap; wires `PxeService` | 47 |
| pxe service | `src/pxe/service.ts` | `PxeService` — long-lived PXE host, chain add/remove coordinator | 920 |
| pxe client | `src/pxe/client.ts` | Typed RPC client base + per-method zod response validation | 335 |
| pxe proxy | `src/pxe/proxy.ts` | Currying adapter: client → per-network `IPXE` facade | 66 |
| pxe ipxe | `src/pxe/ipxe.ts` | `IPXE` interface (per-network method surface) | 52 |
| pxe spec | `src/pxe/spec.ts` | `Methods` — full RPC contract type | 120 |
| pxe descriptors | `src/pxe/descriptors.ts` | Per-method exposure table (rpc/ipxe/requiresNetwork flags) | 112 |
| chain runtime | `src/pxe/chain-runtime.ts` | Per-chain PXE runtime + `ChainRuntimeRegistry` | 390 |
| chain coordinates | `src/pxe/chain-coordinates.ts` | Codec for `(profileId, chainId)` → registry key / data-dir string | 37 |
| opfs store | `src/pxe/opfs-store.ts` | Encrypted per-(profile,chain) SQLite-OPFS store lifecycle | 222 |
| artifact registry | `src/pxe/artifact-registry.ts` | Runtime artifact cache + class-id-verified resolution policy | 213 |
| artifact catalog | `src/pxe/artifact-catalog.ts` | Single source of compiled-in artifacts + class ids (dedup hub) | 111 |
| artifact class-id | `src/pxe/artifact-class-id.ts` | Class-id verification (hash artifact, compare to on-chain) | 71 |
| known artifacts | `src/pxe/known-artifacts.ts` | Production loader: 12 compiled artifacts + SponsoredFPC instance | 40 |
| note schemas | `src/pxe/note-schemas.ts` | Class-id+slot → note decode schema map | 97 |
| schemas (rpc) | `src/pxe/schemas.ts` | Zod schemas for RPC wire types (NoteDao, PackedPrivateEvent, NotesFilter) | 42 |
| effective class | `src/pxe/effective-class.ts` | Resolves current-vs-original contract class id (upgrade detection) | 42 |
| public events | `src/pxe/public-events.ts` | Public Transfer-event indexing (node-facing, cursor/tips) | 420 |
| pxe index | `src/pxe/index.ts` | Barrel re-export for `./pxe` subpath | 34 |
| nulo account | `src/account/nulo-account.ts` | `NuloAccount` adapter over `@aztec/accounts/schnorr` | 217 |
| fee options | `src/account/fee-options.ts` | Fee-payment selection helpers at tx-construction | 90 |
| address freeze | `src/account/address-freeze.ts` | Append-only regime record (artifact+descriptor+KDF pins) | 59 |
| frozen artifact | `src/account/frozen-artifact.ts` | Vendored Schnorr artifact + sha256/class-id pins | 25 |
| instantiation descriptor | `src/account/instantiation-descriptor.ts` | Frozen ctor name/args/salt/deployer for address derivation | 87 |
| account index | `src/account/index.ts` | Barrel + `IAccountContract` interface | 46 |
| node factory adapter | `src/adapters/aztec-node-factory-adapter.ts` | `AztecNodeFactoryAdapter` — sole `AztecNode` construction site | 69 |
| node factory port | `src/ports/node-factory-port.ts` | `NodeFactory` port abstraction | 35 |
| fetch util | `src/utils/fetch.ts` | Timeout-wrapped fetch mirroring the SDK's `defaultFetch` | 108 |
| chain identity util | `src/utils/chain-identity.ts` | Live-node vs stored chain-identity assertion (F-012) | 71 |
| adapters/ports/utils/root indexes | `src/{adapters,ports,utils,index}.ts` | Barrels | 1–3 each |

## 2) Public exports / entrypoints

Package exposes targeted subpaths (no single barrel):
`.` → `src/index.ts` (empty), `./pxe`, `./pxe/public-events`, `./account`, `./ports`, `./adapters`, `./utils`, `./offscreen/entry`.

Notable named exports: `PxeService`, `PxeServiceClientBase`, `PXEProxy`, `ChainRuntime(Registry)`, `ProductionPxeFactory`, `ArtifactRegistry`, `NuloAccount` (via `nulo-account.ts`), `IAccountContract`, `AztecNodeFactoryAdapter`, `NodeFactory`, `makeFetchWithTimeout`, `assertLiveChainIdentity`.

## 3) Coupling surfaces

- **`pxe/service.ts` (920 LOC, 11 intra-package imports)** — the grab-bag hub: pulls in spec, effective-class, chain-runtime, chain-coordinates, opfs-store, artifact-registry, known-artifacts, note-schemas, schemas. Largest file by far (2.5x next largest); highest fan-in AND fan-out.
- **`pxe/client.ts` (6 imports)** and **`pxe/proxy.ts` (4 imports)** — both depend on `chain-runtime`, `spec`/`ipxe`; proxy also depends on client's type + descriptors.
- **`pxe/chain-runtime.ts` (4 imports)** — bridges `adapters/` + `ports/` (cross-directory) into `pxe/`; also the file `service.ts` most depends on.
- **`account/nulo-account.ts` (4 imports)** — pulls together `fee-options`, `frozen-artifact`, `instantiation-descriptor`, and reaches across into `pxe/ipxe`.
- **`spec.ts`** acts as a re-export grab-bag: re-exports types sourced from `note-schemas.ts` and `public-events.ts` alongside its own `Methods` contract — a shared "one giant type surface" pattern.

## 4) One-level dependency sketch + cycles

```
offscreen/entry.ts   → pxe/service.ts, pxe/chain-runtime.ts
pxe/service.ts       → pxe/{spec,effective-class,chain-runtime,chain-coordinates,
                         opfs-store,artifact-registry,known-artifacts,note-schemas,schemas}
pxe/client.ts         → pxe/{chain-runtime,ipxe,spec,schemas,proxy}
pxe/proxy.ts          → pxe/{chain-runtime,client(type),descriptors,ipxe}
pxe/chain-runtime.ts  → adapters/aztec-node-factory-adapter.ts, ports/node-factory-port.ts,
                         pxe/{chain-coordinates,opfs-store}
pxe/spec.ts           → pxe/{chain-runtime(type),note-schemas(type),public-events(type)}
pxe/descriptors.ts    → pxe/{chain-runtime(type),ipxe,spec}
pxe/artifact-registry.ts → pxe/{artifact-class-id,known-artifacts}
pxe/known-artifacts.ts   → pxe/artifact-catalog.ts
pxe/note-schemas.ts      → pxe/artifact-catalog.ts
account/index.ts      → account/{nulo-account,fee-options,address-freeze,frozen-artifact,
                         instantiation-descriptor}, pxe/ipxe(type)
account/nulo-account.ts → account/{fee-options,frozen-artifact,instantiation-descriptor}, pxe/ipxe
account/address-freeze.ts → account/{frozen-artifact,instantiation-descriptor}
adapters/aztec-node-factory-adapter.ts → ports/node-factory-port.ts
```

No import cycles detected (all edges point toward smaller/leaf modules: `chain-coordinates`, `opfs-store`, `artifact-catalog`, `frozen-artifact`, `instantiation-descriptor`, `ipxe`, `spec` sit at or near the leaves). `pxe/` never imports `account/`; `account/` imports `pxe/ipxe` only (type-only in `index.ts`).

## 5) Frameworks / libs in use

`@aztec/*` (accounts, aztec.js, foundation, stdlib, pxe, entrypoints, protocol-contracts, noir-contracts.js, simulator, bb.js) pinned at `5.0.1`; `@alejoamiras/aztec-accelerator` + `@alejoamiras/private-fee-juice` (takeover packages); `@aztec-foundation/aztec-standards`; `zod` (schema validation, v4); `@nulo/wallet-core`, `@nulo/wallet-crypto`, `@nulo/extension-messaging` (internal workspace layers below this package). No UI framework — pure TS runtime library, consumed by the extension's offscreen document.

## 6) Generated / vendored paths to exclude

- `src/account/artifacts/SchnorrAccount.json` — vendored, byte-frozen contract artifact (never hand-edited; see `PROVENANCE.md` alongside it).
- `node_modules/` (package-local).
- No `dist/`, `.generated.ts`, or codegen output under `src/` — this package ships TS source directly (`exports` map points straight at `.ts` files).

## 7) Apparent duplication candidates

1. **`pxe/schemas.ts` vs `pxe/note-schemas.ts` vs `pxe/spec.ts`'s re-exports** — three files named around "schema" with distinct jobs (RPC-wire zod validation; note-decode field maps; type re-export hub). Not functionally duplicated today, but the naming overlap plus `spec.ts` re-exporting types *from* `note-schemas.ts` and `public-events.ts` makes the "schema" concept diffuse across 3+ files — a likely source of "where does this schema live" churn and a candidate for a consolidation/rename pass rather than a functional merge.
2. **`utils/fetch.ts` deliberately mirrors upstream `@aztec/foundation`'s `defaultFetch`** — the file's own header comment states it "mirrors the SDK's `defaultFetch` exactly (jsonStringify, NoRetryError for 4xx)" and re-implements the retry/backoff wiring locally to bolt on a timeout. This is a self-declared near-copy of external logic, not internal duplication — flag for future-upstream-diverges risk (if `defaultFetch`'s internals change, this copy silently drifts) rather than an immediate refactor.
3. **`ArtifactRegistry` (artifact-registry.ts) vs `ChainRuntimeRegistry` (chain-runtime.ts)** — both are hand-rolled `Map`-keyed registries with a lazy `ensure*()` populate-on-first-use method and a `get`. Different domains (artifacts vs per-chain PXE runtime instances), so not a true duplicate, but the same registry/cache shape is reimplemented twice with no shared base — worth a look if a third registry-shaped module appears.
4. **Already-deduplicated instance, re-check for regrowth**: `pxe/known-artifacts.ts` and `pxe/note-schemas.ts` both consume `pxe/artifact-catalog.ts` specifically *because* they used to independently import artifacts and hash class ids (per `artifact-catalog.ts`'s own header comment, documenting a prior near-duplication bug). No action needed now, but any NEW artifact-consuming module should route through the catalog too, or the same divergence risk returns.

Lowest-confidence / not real duplication (checked and ruled out): `pxe/chain-coordinates.ts` (key-string codec for data-dir naming) vs `utils/chain-identity.ts` (live chain-id trust verification) — names sound similar, logic is unrelated.
