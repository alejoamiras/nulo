# `packages/aztec-runtime` — Package Map

Bun workspace package, no build step (`exports` map points straight at `.ts` sources). Sole consumer across the monorepo is `apps/extension`. `type: "module"`, tests via `vitest run` (146 tests, 16 files, all passing at time of scan). Every `@aztec/*` dependency is pinned to `5.0.1`.

## 1. Module inventory

| Path | Purpose | Non-test LOC |
|---|---|---|
| `src/index.ts` | Root barrel — empty (`export {}`); real exports live on subpaths. | 1 |
| `src/pxe/` | PXE lifecycle, chain-runtime registry, artifact/note-schema resolution, public-event indexing, the SW↔offscreen RPC service+client+proxy. The dominant module — 18 non-test files, ~4,050 LOC. | ~4,050 |
| `src/pxe/service.ts` | `PxeService` — the offscreen-resident PXE host: RPC dispatch, per-chain/per-profile concurrency guards, incarnation-generation fencing, orphan-store sweep, store-key provisioning. | 915 |
| `src/pxe/public-events.ts` | Public `Transfer` event fetch/decode/validate over `node.getPublicLogsByTags`, checkpoint/finalized tip resolution, node-direct token-class gate. | 410 |
| `src/pxe/chain-runtime.ts` | `ChainRuntime` (node+PXE pair for one chain), `ProductionPxeFactory` (real PXE boot incl. accelerator prover wiring), `ChainRuntimeRegistry` (per-`(profileId,chainId)` map). | 390 |
| `src/pxe/client.ts` | `PxeServiceClientBase` — SW-side RPC client: zod-validates every response, captures `pxeGeneration`, retries once on `PXE_STORE_KEY_MISSING`. | 335 |
| `src/pxe/artifact-registry.ts` | Resolves contract artifacts by class-id via a `pxe-local → known` policy; verifies + caches verified class-ids. | 213 |
| `src/pxe/opfs-store.ts` | Per-`(profile,chain)` encrypted SQLite-OPFS store open/close/enumerate/purge; schema/rollup version-stamp guard. | 222 |
| `src/pxe/descriptors.ts` | Single descriptor table (`rpc`/`ipxe`/`requiresNetwork` flags per method) driving `proxy.ts`'s generated methods and several compile-time consistency asserts. | 112 |
| `src/pxe/artifact-catalog.ts` | Shared per-key memoized loader for the 12 compiled-in artifacts (class-id computed once, shared by `known-artifacts.ts` and `note-schemas.ts`). | 108 |
| `src/pxe/spec.ts` | `Methods` — the full RPC contract type + `PXE_SERVICE_NAME`. | 120 |
| `src/pxe/proxy.ts` | `PXEProxy` — generates the per-network `IPXE` facade by installing curried methods on the prototype from `PXE_IPXE_METHODS`. | 66 |
| `src/pxe/artifact-class-id.ts` | Pure class-id recompute/compare helper + DI verifier interface. | 71 |
| `src/pxe/known-artifacts.ts` | Production loader assembling the compiled-in artifact map + SponsoredFPC instance. | 40 |
| `src/pxe/note-schemas.ts` | Static class-id → storage-slot → `NoteSchema` map for the 4 note-bearing bundled artifacts. | 90 |
| `src/pxe/async-memo.ts` | Generic async-memoization primitives (`memoizeAsync`, `memoizeAsyncBy`) — the shared retry-on-reject cache contract used everywhere else in `pxe/`. | 63 |
| `src/pxe/chain-coordinates.ts` | Codec for the `(profileId, chainId)` registry key / OPFS path — centralizes a persisted, load-bearing string format. | 37 |
| `src/pxe/effective-class.ts` | Preimage↔instance hydration + `ContractUpgradedError` for the 5.0.0 PXE/node class-split seam. | 42 |
| `src/pxe/ipxe.ts` | `IPXE` — the in-process, per-network facade type. | 52 |
| `src/pxe/schemas.ts` | Zod schemas for `NoteDao`, `PackedPrivateEvent`, `NotesFilter`. | 42 |
| `src/pxe/index.ts` | Subpath barrel for `./pxe`. | 34 |
| `src/account/` | Nulo's Schnorr account adapter + the frozen address-derivation surface. 6 non-test files, ~911 LOC. | ~911 |
| `src/account/nulo-account.ts` | `NuloAccount implements IAccountContract` — thin wrapper over `@aztec/accounts/schnorr`; owns key derivation, recursive payload chunking, first-tx multicall wrapping. | 217 |
| `src/account/instantiation-descriptor.ts` | Frozen constructor name/args/salt/immutablesHash/deployer — the non-artifact, non-key inputs to address derivation. | 87 |
| `src/account/fee-options.ts` | `completeFeeOptions` — shared gas-settings translator used by both the standard and extension "fast path" tx-construction routes. | 90 |
| `src/account/address-freeze.ts` | Append-only `AddressRegime` record (`REGIMES`, `V5_REGIME`) binding one artifact+descriptor+KDF combination per extension major. | 59 |
| `src/account/frozen-artifact.ts` | Loads the vendored `SchnorrAccount.json` into a `ContractArtifact`; publishes its sha256 + class-id constants. | 25 |
| `src/account/index.ts` | Subpath barrel + `IAccountContract` interface. | 46 |
| `src/account/artifacts/` | **Vendored, frozen** — `SchnorrAccount.json` (1.6MB / 12,848 lines) + `PROVENANCE.md`. Excluded from Biome formatting; excluded from this report's code review per task instructions. | n/a |
| `src/adapters/` | `AztecNodeFactoryAdapter` — the one production call site for `createAztecNodeClient`, with an RPC-scheme allowlist (https everywhere, http only loopback) and a bounded-probe method. | 69 |
| `src/ports/` | `NodeFactory` port interface (DI seam the adapter implements). | 35 |
| `src/utils/` | `makeFetchWithTimeout`/`makeSingleAttemptFetch` (AbortController-timeout JSON-RPC fetch wrapper) + `assertLiveChainIdentity`/`chainInfoFrom` (live-node vs. selected-network chain-identity check). | 179 |
| `src/offscreen/entry.ts` | `createPxeOffscreen` — Chrome-agnostic offscreen bootstrap; wires `PxeService` into a `ServiceCollection`. | 47 |

## 2. Entrypoints / public exports

`package.json#exports` — 7 subpaths, no default deep-import surface:

| Subpath | File | Notable exports |
|---|---|---|
| `.` | `src/index.ts` | empty |
| `./pxe` | `src/pxe/index.ts` | `ChainRuntime`, `ChainRuntimeRegistry`, `ProductionPxeFactory`, `ArtifactRegistry`, `defaultPolicy`, `loadProductionKnownArtifacts`, `loadProductionNoteSchemas`, `verifyArtifactClassId`/`DefaultArtifactClassIdVerifier`, `IPXE`, `PXE_SERVICE_NAME`/`Methods`, `PxeService`, `PxeServiceClientBase`, `PXEProxy`, zod schemas |
| `./pxe/public-events` | `src/pxe/public-events.ts` | `PRIVATE_ADDRESS_MAGIC_VALUE`, `PublicEventCursorSchema`, transfer-event types |
| `./account` | `src/account/index.ts` | `IAccountContract`, `NuloAccount` (via `export *`), `completeFeeOptions`, `AddressRegime`/`REGIMES`/`V5_REGIME`, `FrozenSchnorrAccountArtifact`, instantiation-descriptor exports |
| `./ports` | `src/ports/index.ts` | `NodeFactory` (type only) |
| `./adapters` | `src/adapters/index.ts` | `AztecNodeFactoryAdapter` |
| `./utils` | `src/utils/index.ts` | `makeFetchWithTimeout`, `DEFAULT_REQUEST_TIMEOUT_MS`, `assertLiveChainIdentity`, `chainInfoFrom` |
| `./offscreen/entry` | `src/offscreen/entry.ts` | `createPxeOffscreen` |

**Consumers.** Only `apps/extension` imports `@nulo/aztec-runtime` (60+ files under `apps/extension/src/wallet/services/`, `apps/extension/src/core/`, `apps/extension/src/offscreen/`, `apps/extension/src/accelerator/`, plus e2e fixtures/scripts under `apps/extension/tests/e2e/`). `packages/wallet-core` only *mentions* it in comments (`src/ports/index.ts`, `src/testing/index.ts`) — no actual import; Biome's dependency-cruiser-style rules (`biome.json`) explicitly forbid `wallet-core`, `wallet-crypto`, and `extension-messaging` from importing `@nulo/aztec-runtime` (one-directional dependency), and forbid `aztec-runtime` from importing `@nulo/wallet-bridge` or `@nulo/extension`.

Key extension-side consumption points: `apps/extension/src/offscreen/index.ts` calls `createPxeOffscreen`; `apps/extension/src/wallet/services/pxe/client.ts` subclasses `PxeServiceClientBase`; `apps/extension/src/wallet/services/execution/*` and `incoming-transfer/*` drive `IPXE`/`NuloAccount`/public-events types heavily.

## 3. Coupling surfaces

- **`pxe/service.ts` (915 LOC)** is the hub: imports from `async-memo`, `effective-class`, `chain-runtime`, `chain-coordinates`, `opfs-store`, `artifact-registry`, `known-artifacts`, `note-schemas`, `spec`, `schemas`, `public-events`, plus `@nulo/wallet-core/{base,logger,utils}` and `@nulo/extension-messaging/offscreen`. It is the file every other `pxe/` module ultimately feeds.
- **`pxe/client.ts` (335 LOC)** mirrors that fan-in on the client side (`chain-runtime`, `ipxe`, `spec`, `schemas`, `public-events`, `proxy`, plus `@nulo/wallet-core/{base,logger}` and `@nulo/extension-messaging/offscreen`).
- **`pxe/index.ts`** re-exports from 12 sibling files — the widest single-file fan-in by import count (not complexity).
- **`@aztec/*` dependency surface** (14 distinct `@aztec/*` + 1 `@aztec-foundation/*` package, import-site counts): `@aztec/stdlib/contract` (19), `@aztec/stdlib/abi` (18), `@aztec/foundation/curves/bn254` (18), `@aztec/stdlib/aztec-address` (13), `@aztec/pxe/client/bundle` (13), `@aztec/stdlib/interfaces/client` (12), `@aztec/stdlib/tx` (9), plus `@aztec/entrypoints/*`, `@aztec/accounts/schnorr/{lazy,stub}`, `@aztec/kv-store/sqlite-opfs`, `@aztec/simulator/client`, `@aztec/protocol-contracts/*`, `@aztec/standard-contracts/*`, `@aztec/noir-contracts.js/*`, `@aztec/pxe/config`, `@aztec-foundation/aztec-standards`. This is the largest coupling surface in the package by far — nearly every file touches at least one `@aztec/*` type.
- **Cross-package (`@nulo/*`) imports** are narrow and one-directional: `@nulo/wallet-core/{base,logger,utils}` (service.ts, client.ts, artifact-registry.ts, nulo-account.ts, offscreen/entry.ts), `@nulo/extension-messaging/offscreen` (service.ts, client.ts), `@nulo/wallet-crypto` (`deriveNuloAccountKeys`, nulo-account.ts only). `ReadWriteGuard` (the concurrency primitive `service.ts` builds its whole locking model on) is imported from `@nulo/wallet-core/utils`, not owned by this package.
- **Third-party non-`@aztec` deps used deep in `pxe/`**: `@alejoamiras/aztec-accelerator` (chain-runtime.ts prover), `@alejoamiras/private-fee-juice` (declared dep, artifact alias `@private-fpc-artifact` used in artifact-catalog.ts), a vite-alias raw-JSON import `@wonderland-token-artifact` (artifact-catalog.ts) — both `@ts-expect-error`-annotated non-npm-resolved imports.

## 4. State owners

| Owner | State variable(s) | Guard / lifecycle |
|---|---|---|
| `PxeService` (`pxe/service.ts`) | `chainGuards: Map<string, ReadWriteGuard>` (per `profileId:chainId`) | Lazily created in `getChainGuard`; **never removed** on `clearChainState` (reused if chain re-added); removed on `clearProfileState` by prefix scan. |
| `PxeService` | `profileBarriers: Map<string, ReadWriteGuard>` | Lazily created in `getProfileBarrier`; every chain op takes a READ; profile-destructive ops take WRITE (drains in-flight chain ops). Removed **only on successful** `clearProfileState`; retained on failure so a retry reuses it. |
| `PxeService` | `chainPurgeEpochs: Map<string, number>` | Bumped by `clearChainState` before disposing; `withPxeRead`/`withPxeWrite` snapshot the epoch at entry and refuse to re-create a runtime if the epoch moved mid-op (anti-resurrection). |
| `PxeService` | `storeKeys: Map<string, Uint8Array>` (per-profile 32-byte store encryption key) | In-memory only, never persisted; installed by `provisionChainStoreKey`, deleted (crypto-erase) at the start of `clearProfileState`'s try-block. |
| `PxeService` | `profileLifecycles: Map<string, {kind: "live"\|"deleting"\|"deleted", gen: string}>` | The "#281 D4" incarnation fence — `unseen → live(gen) → deleting(gen) → deleted(gen)`; marked `deleting` **synchronously before any await** in `clearProfileState`; checked in `assertGenerationCurrent` on every op and in `provisionChainStoreKey`. |
| `PxeService` | `stubClassRegistrations = memoizeAsyncBy<PXE, Fr>(..., new WeakMap())` | Per-PXE-instance memo of the stub-Schnorr-class registration (fee-estimation hot path); keyed via `WeakMap` so a torn-down PXE isn't pinned by its cached promise. |
| `ChainRuntimeRegistry` (`pxe/chain-runtime.ts`) | `runtimes: Map<string, ChainRuntime>` | Guarded contractually (not internally) — callers must hold the chain WRITE guard for `ensure`/dispose paths, chain READ for `peek`/`peekMatching`; `settleDisposals` re-adds any runtime whose `dispose()` threw so the SAH-pool lock retry handle isn't lost. |
| `ArtifactRegistry` (`pxe/artifact-registry.ts`) | `known: KnownArtifacts \| null`, `knownMemo = memoizeAsync<void>`, `verifiedClassIds: Set<string>` | `ensureKnown()` is the single memoized loader entry; `clear()` resets all three (called on profile delete). Documented hazard: a slow in-flight `knownMemo` load that resolves *after* a concurrent `clear()` still repopulates `known` (memo's identity-guard only covers rejections). |
| module-level in `pxe/artifact-catalog.ts` | `cache = new Map<CatalogKey, Promise<CatalogEntry>>()` wrapped by `memoizeAsyncBy` | Per-key memo, held at module scope (deliberately, so `_resetArtifactCatalogForTests` can `.clear()` the whole map — the shared helper's own `reset()` is per-key only). |
| module-level in `pxe/note-schemas.ts` | `schemasMemo = memoizeAsync<NoteSchemaMap>` | Module-level singleton cache; `_resetNoteSchemasForTests()` resets both this and the shared artifact-catalog cache. |
| module-level in `pxe/public-events.ts` | `transferTagMemo = memoizeAsync<Tag>`, `bundledTokenClassIdMemo = memoizeAsync<Fr>` | Module-level singletons (Poseidon-heavy, computed once); `_resetPublicEventMemosForTests()`. |
| `pxe/async-memo.ts` | (the primitive itself) `memoizeAsync`/`memoizeAsyncBy` | Reject-clears-the-slot contract, **identity-guarded** (`if (cached === entry) cached = undefined`) so a stale rejection handler can't clobber a newer promise a concurrent `reset()+retry` already installed. This is the shared contract underneath every cache above. |
| `PxeServiceClientBase` (`pxe/client.ts`) | `storeKeyProvider`, `generationProvider` (both optional callback fields) | Set once by the embedder via `setStoreKeyProvider`/`setGenerationProvider`; consumed in `request()`'s capture-then-retry logic. |
| `opfs-store.ts` | no persistent JS state, but each `openChainStore` call races a 30s `setTimeout` against the SQLite-worker open, and on timeout **leaks a background `.then()`** that closes the store if it resolves late (to release the SAH-pool lock). |
| Timers | `pxe/service.ts:deleteDb` (5s `onblocked` timeout), `pxe/opfs-store.ts:openChainStore` (30s worker-init timeout) | Both `clearTimeout` on settle; both convert a silent-hang failure mode into a loud, bounded error. |
| Subscriptions | `PxeService.init()` subscribes `this.profiles.onActiveProfileChanged.add(this.onActiveProfileChanged)` (currently a no-op by design — Phase 2 Week 3 deliberately stopped clearing runtimes on profile switch) | Never unsubscribed (service is a singleton for the process lifetime). |

## 5. Dependency graph (package-internal, one level deep)

```
pxe/index.ts        → chain-runtime, known-artifacts, artifact-registry, note-schemas,
                       artifact-class-id, ipxe, spec, public-events, service, client, proxy, schemas
pxe/service.ts       → async-memo, effective-class, chain-runtime, chain-coordinates,
                       opfs-store, artifact-registry, known-artifacts, note-schemas, spec,
                       schemas, public-events
pxe/client.ts        → chain-runtime, ipxe, spec, schemas, public-events, proxy
pxe/chain-runtime.ts → adapters/aztec-node-factory-adapter, ports/node-factory-port,
                       chain-coordinates, opfs-store
pxe/proxy.ts         → chain-runtime, client, descriptors, ipxe
pxe/descriptors.ts   → chain-runtime, ipxe, spec
pxe/spec.ts          → note-schemas, chain-runtime, public-events
pxe/artifact-registry.ts → async-memo, artifact-class-id, known-artifacts
pxe/known-artifacts.ts   → artifact-catalog
pxe/note-schemas.ts      → async-memo, artifact-catalog
pxe/artifact-catalog.ts  → async-memo
pxe/public-events.ts     → async-memo
pxe/opfs-store.ts        → chain-coordinates
offscreen/entry.ts   → pxe/chain-runtime, pxe/service
adapters/aztec-node-factory-adapter.ts → ports/node-factory-port, utils/fetch
account/index.ts     → pxe/ipxe, account/{nulo-account, fee-options, address-freeze,
                       frozen-artifact, instantiation-descriptor}
account/nulo-account.ts → pxe/ipxe, account/{fee-options, frozen-artifact, instantiation-descriptor}
account/address-freeze.ts → account/{frozen-artifact, instantiation-descriptor}
```

**No cycles found.** The graph is a clean DAG: `async-memo` and `chain-coordinates` are the lowest-level leaves; `service.ts`/`client.ts` are the highest-level roots within `pxe/`; `account/` depends one-way on `pxe/ipxe` only (never the reverse). `pxe/index.ts` and `account/index.ts` are pure re-export leaves at the top, not consumed internally by sibling files (only by external consumers via the subpath exports) — so they don't introduce a cycle either.

## 6. Frameworks / primitives

- **`@aztec/*` framework surface**: `createPXE`/`getPXEConfig` (`@aztec/pxe/client/bundle`, `@aztec/pxe/config`) for PXE boot; `createAztecNodeClient` (`@aztec/stdlib/interfaces/client`) for node RPC; `WASMSimulator` (`@aztec/simulator/client`) statically imported to dodge an MV3 dynamic-import failure; `DefaultAccountEntrypoint`/`DefaultMultiCallEntrypoint`/`AccountFeePaymentMethodOptions` (`@aztec/entrypoints/*`) for tx-request construction; `SchnorrAccountContract` (`@aztec/accounts/schnorr/lazy`) for signing; `AztecSQLiteOPFSStore`/`SqliteEncryptionError` (`@aztec/kv-store/sqlite-opfs`) for encrypted persistence; `AcceleratorProver` (`@alejoamiras/aztec-accelerator`) as the pluggable BB prover.
- **Concurrency primitives**: `ReadWriteGuard` (from `@nulo/wallet-core/utils`, not owned here) is the sole lock primitive — used as a two-level scheme (`chainGuards` per-chain, `profileBarriers` per-profile-as-write-barrier). `WeakMap`-backed async memo (`memoizeAsyncBy<PXE, Fr>`) for GC-safe per-instance caching. `Promise.allSettled` for tolerant multi-runtime disposal (`ChainRuntimeRegistry.settleDisposals`) with re-add-on-failure semantics. `Promise.race` against a `setTimeout` for the OPFS-store open bound. `AbortController`-based fetch timeout (`utils/fetch.ts`) layered under the SDK's own `retry`/`makeBackoff`.
- **IndexedDB usage**: legacy-generation cleanup only (`indexedDB.databases()`, `indexedDB.deleteDatabase()`), all in `pxe/service.ts` (`sweepOrphanStores`, `clearProfileState`, `deleteDb`) — explicitly described in comments as "rc.2-era", superseded by OPFS for live data.
- **OPFS usage**: `navigator.storage.getDirectory()` tree walk (`pxe/opfs-store.ts`'s `listChainStoreDirs`/`removeChainStoreDir`/`removeProfileStoreDirs`) is the *store registry itself* — no separate index — plus `AztecSQLiteOPFSStore.open(...)` for the actual encrypted per-chain SQLite pool.
- **Validation**: `zod` (`z`) is used pervasively for RPC boundary validation (`service.ts`, `client.ts`, `public-events.ts`, `schemas.ts`) — every `Methods` argument/return is parsed with `.schema.parseAsync` on both ends of the offscreen↔SW boundary.

## 7. Test surfaces

- **Location**: colocated `*.test.ts` next to source (`vitest run`, 16 test files / 146 tests, all passing).
- **Well covered**: `async-memo.ts`, `chain-runtime.ts`, `chain-coordinates.ts`, `descriptors.ts`, `opfs-store.ts`, `public-events.ts`, `service.ts` (via `service.test.ts` + the concern-scoped `client-capture.test.ts`, `stub-overrides.test.ts`, `incarnation-fence.test.ts`), `client.ts` (via `client-capture.test.ts` + `descriptors.test.ts`), `proxy.ts` (via `descriptors.test.ts`), `fee-options.ts`, `address-freeze.ts`, `instantiation-descriptor.ts`, `chain-identity.ts`, plus the account KAT (`derivation-vectors.test.ts`) and the artifact freeze (`artifact-freeze.test.ts`).
- **Untested (no direct or indirect `*.test.ts` coverage found in this package)**: `artifact-registry.ts`, `artifact-catalog.ts`, `known-artifacts.ts`, `note-schemas.ts`, `artifact-class-id.ts`, `effective-class.ts`, `ipxe.ts`, `spec.ts`, `schemas.ts`, `nulo-account.ts` (the `NuloAccount` class itself — only its frozen inputs are tested here), `frozen-artifact.ts` (loading logic, as opposed to `artifact-freeze.test.ts`'s digest pin), `adapters/aztec-node-factory-adapter.ts` (including the RPC scheme-allowlist logic `isAllowedRpcUrl`), `ports/node-factory-port.ts` (type-only), `offscreen/entry.ts`, `utils/fetch.ts`, the two `index.ts` barrels.
  - Note: `apps/extension/src/wallet/services/pxe/artifact-registry.test.ts` and `.../chain-runtime.test.ts` exist in the *consumer* app and exercise this package's `ArtifactRegistry`/`ChainRuntime` behavior end-to-end, partially offsetting the `artifact-registry.ts` gap from outside the package.
  - `NuloAccount`'s runtime behavior (as opposed to its address-derivation inputs) is stated by the README to be covered by the extension's e2e suite (`apps/extension/tests/e2e/network/`) against a real anvil + aztec sandbox, not by any unit test in this package.

## 8. Generated / vendored / fixture code

- **`src/account/artifacts/SchnorrAccount.json`** (1.6MB, 12,848 lines) — the vendored, byte-frozen Schnorr account compilation artifact per task instructions: **excluded from review**. Provenance documented in `src/account/artifacts/PROVENANCE.md`; digest-pinned by `src/account/artifact-freeze.test.ts`; excluded from Biome formatting (`biome.json` glob `!**/packages/aztec-runtime/src/account/artifacts`).
- No other generated code, snapshot fixtures, or build-output artifacts found under `src/` (no `dist/`, no `.generated.ts`, no snapshot directories).
- `pxe/artifact-catalog.ts` pulls in two other non-source-controlled raw-JSON artifacts via vite aliases (`@wonderland-token-artifact`, `@private-fpc-artifact`, both `@ts-expect-error`-annotated) — these are third-party npm-resolved artifacts, not vendored/frozen in-repo, but worth noting as artifact-shaped imports outside the normal `@aztec/*` package resolution.

## 9. Apparent duplication

- **`IndexedDB.deleteDatabase` promise wrapper, three near-identical inlinings** in `pxe/service.ts`: two ad-hoc versions inside `sweepOrphanStores` (lines ~242–267, one for arbitrary orphan DBs, one for the shared `keyval-store`) plus the extracted, timeout-hardened `deleteDb` private method (lines ~760–775) used everywhere else (`clearChainState`, `clearProfileState`). The two inline versions in `sweepOrphanStores` don't reuse `deleteDb` and differ subtly in `onblocked` behavior (resolve instead of timeout-then-reject) — a plausible refactor target, though the difference may be intentional (sweep is best-effort, not fail-closed).
- **Purge-epoch re-check boilerplate** duplicated between `withPxeRead` and `withPxeWrite` in `pxe/service.ts`: both independently compute `purgeEpochAtEntry` via `this.chainPurgeEpochs.get(this.chainKey(...)) ?? 0` and re-compare it before allowing `registry.ensure(...)` to proceed (lines 828/844 and 879/889) — same guard, two call sites, no shared helper.
- **Six independently-invented promise caches, later unified**: `async-memo.ts`'s own doc comment states it was "extracted from the six hand-rolled promise caches this directory grew independently" — i.e., the duplication was real and has already been refactored away into `memoizeAsync`/`memoizeAsyncBy`; the five current call sites (`artifact-catalog.ts`, `artifact-registry.ts`, `note-schemas.ts`, `public-events.ts` ×2, `service.ts`'s `stubClassRegistrations`) are the post-fix state, not a residual duplication.
- **`PXEProxy` (proxy.ts) vs. `PxeServiceClientBase` (client.ts)** are structurally similar (both are thin per-method forwarders over the same `Methods` surface), but `proxy.ts` is generated at runtime from `PXE_IPXE_METHODS` specifically so it does **not** duplicate `client.ts`'s hand-written, zod-validated method bodies — this is a deliberate non-duplication pattern (see descriptors.ts's stated design goal), not an instance of drift.

## 10. Error-path hotspots

- **`pxe/service.ts`** — the heaviest concentration of defensive logic in the package:
  - `withPxeRead`/`withPxeWrite` (lines ~816–904): a bounded retry loop (`MAX_RUNTIME_BIND_ATTEMPTS = 3`) for the peek→write-rebind→re-peek dance, wrapped in try/catch that routes failures through `logOpFailure` — which special-cases `PXE_STORE_KEY_MISSING` (downgraded to debug-log since it's a designed self-healing retry step) vs. every other failure (logged as error).
  - `sweepOrphanStores` (deferred, never on the init path — documented deadlock-avoidance reasoning) tolerates `onblocked` IndexedDB deletes by skipping rather than hanging.
  - `getContractInstance`: a three-way fallback cascade (PXE preimage → node lookup → known-bundle instance) where a `ContractUpgradedError` is deliberately **re-thrown even in best-effort mode** (would otherwise silently mask an on-chain upgrade), while every other node error degrades to "not found" only when `nodeBestEffort` is set.
  - `clearProfileState`/`provisionChainStoreKey`: generation-mismatch fencing with explicit `throw new Error(...)` on every disallowed lifecycle transition (5 distinct guarded throw sites) plus a `finally { barrier.leaveWrite() }` to guarantee lock release even on failure.
  - `deleteDb`: bounded (5s) `onblocked` → `setTimeout`-driven rejection instead of hanging forever.
- **`pxe/chain-runtime.ts`** — `ChainRuntime.dispose()` swallows a failed `pxe.stop()` (documented: "the caller is tearing down regardless"); `ProductionPxeFactory.createChainRuntime` wraps `buildRuntime` in try/catch that force-closes the just-opened store on **any** failure (`store.close().catch(() => {})`) to avoid leaking the exclusive SAH-pool lock; `ChainRuntimeRegistry.settleDisposals` uses `Promise.allSettled` + re-adds failed-dispose entries + throws an `AggregateError` so a partial teardown is never reported as success.
- **`pxe/opfs-store.ts`** — `openChainStore` races a 30s timeout against the SQLite-worker's un-timed-out open protocol, and on timeout still chains a background `.then()` to close the store if it resolves late; `SqliteEncryptionError` is mapped to a typed `WrongStoreKeyError`; a schema/rollup-version mismatch throws a typed `PxeStoreVersionMismatch` rather than wiping data (explicit "REFUSE, do not wipe" policy per D-B2v3).
- **`utils/fetch.ts`** — `AbortController`-based per-request timeout layered under the SDK's `retry`/`makeBackoff`, with explicit `NoRetryError` short-circuiting for 4xx responses.
- **`account/nulo-account.ts`** — comparatively little error handling; the one explicit throw (`ensureRegistered`) guards against a PXE-derived address mismatching the expected one — an integrity check, not a resilience mechanism.
- Overall pattern: retry/backoff logic clusters in `service.ts` (op-level) and `utils/fetch.ts` (transport-level); cleanup/teardown-tolerance clusters in `chain-runtime.ts` and `opfs-store.ts` (lock-leak avoidance is the recurring theme — nearly every catch block there exists specifically to avoid wedging the SAH-pool directory lock).