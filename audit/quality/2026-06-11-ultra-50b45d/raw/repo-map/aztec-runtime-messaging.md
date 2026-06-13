# Map — @nulo/aztec-runtime + @nulo/extension-messaging

Mapper: Fable Explore subagent. aztec-runtime 4 commits, extension-messaging 3 (history starts 2026-05-19).

## aztec-runtime

### Inventory
pxe/service.ts **507** (PxeService: per-chain ReadWriteGuard + per-profile write barrier, orphan-IndexedDB cleanup, ~19 RPC methods each zod-parsing) · pxe/chain-runtime.ts 278 (**three classes**: ChainRuntime, ProductionPxeFactory, ChainRuntimeRegistry) · pxe/artifact-registry.ts 213 · pxe/client.ts 202 (PxeServiceClientBase, zod-rehydrates results, proveTx 30-min override) · pxe/proxy.ts 103 (PXEProxy 1:1 delegation, 18 methods) · pxe/note-schemas.ts 99 · pxe/spec.ts 81 (19-method wire contract) · pxe/known-artifacts.ts 75 · pxe/artifact-class-id.ts 71 · pxe/ipxe.ts 50 (IPXE interface) · pxe/schemas.ts 42 · account/nulo-account.ts 213 · account/fee-options.ts 77 (completeFeeOptions) · account/index.ts 41 (IAccountContract) · adapters/aztec-node-factory-adapter.ts 57 (+ isAllowedRpcUrl F-011) · ports/node-factory-port.ts 25 · offscreen/entry.ts 47 · utils/fetch.ts 98 · utils/chain-identity.ts 58 (F-012).

### Consumed externally (all from extension)
IPXE 7+ · assertLiveChainIdentity 5 · IAccountContract 6 · NuloAccount · completeFeeOptions + PartialGasSettingsRPC · PxeServiceClientBase · createPxeOffscreen + ProductionPxeFactory · AztecNodeFactoryAdapter · NodeFactory · canonicalSlotHex/NoteSchema/NoteFieldType. Test-only: ArtifactRegistry, ChainRuntime(Registry), defaultPolicy etc.

### Dead-export candidates (zero external refs)
MIN_FEE_PADDING (own test only) · loadProductionNoteSchemas + _resetNoteSchemasForTests (**zero call sites anywhere**) · NoteSchemaMap/NoteFieldSchema · DefaultArtifactClassIdVerifier/verifyArtifactClassId/ClassIdVerifyLogger · loadProductionKnownArtifacts (internal only) · KnownArtifacts · NoteDaoSchema/PackedPrivateEventSchema/NotesFilterSchema · PxeService/IProfileReader (reached only via createPxeOffscreen) · makeFetchWithTimeout/DEFAULT_REQUEST_TIMEOUT_MS · LiveNodeChainInfo/SelectedNetworkChainInfo · ArtifactPolicy/ArtifactSource/ProductionPxeFactoryOptions · **isAllowedRpcUrl** (exported but NOT re-exported by adapters/index; doc says "exportable for other call sites"; zero refs).
Dead methods: ChainRuntimeRegistry.peek() (:195, zero callers), ChainRuntimeRegistry.clear() (test-only), ArtifactRegistry.clear() (:130, zero callers; service.ts:483-486 documents deliberately NOT calling it).

### Near-duplicates within aztec-runtime
- **FIVE parallel enumerations of the ~19-method PXE surface**: spec.ts Methods, ipxe.ts IPXE, service.ts impl, client.ts impl, proxy.ts delegation — plus 6th extension shim re-export. Adding one method touches all.
- withPxeRead/withPxeWrite (service:429-447 vs 449-468) near-identical.
- Promise-wrapped indexedDB.deleteDatabase ×3 in service.ts (133-141, 148-157, 416-424) + fire-and-forget at 487-491.
- [SYNC-DEBUG] preflight duplicated in proveTx (271-277) and simulateTx (290-297).
- `${profileId}:${chainId}` key built independently in PxeService.chainKey (102-104) and ChainRuntimeRegistry.key (188-190); prefix-scan deletion loops duplicated (service:478-481, chain-runtime:265-275).
- Three lazy-init-with-retry-reset idioms: ArtifactRegistry.ensureKnown (99-112), note-schemas module cache (64-94, "matches ArtifactRegistry pattern"), ChainRuntimeRegistry.initPromises (214-229).
- NetworkInfo declared independently in BOTH chain-runtime.ts:42-46 and artifact-registry.ts:13-17.

### Upstream mirrors (drift surfaces, all claims documented)
1. completeFeeOptions — "byte-for-byte" mirror of BaseWallet.completeFeeOptions (base_wallet.js:128-160). 2. MIN_FEE_PADDING mirror of private minFeePadding. 3. NuloAccount.buildTxExecutionRequest repeats the claim. 4. utils/fetch — mirrors SDK defaultFetch "exactly" + timeout. 5./6. getSyncedBlockHeader mirrors BaseWallet.simulateTx (in service.ts AND ipxe.ts). 7. simulateTx stub override verified against @aztec/accounts stub. 8. skipKernels pinned to pxe.js:627. 9. ChainRuntime.dispose verified against upstream. 10. README invariants on schnorr wrap.

## extension-messaging

### Inventory
background/service.ts 226 (Service base: port fan-out, A6 jsonStringify fallback trySendJsonFallback, backup/restore stubs) · background/client.ts 263 (ServiceClient: correlation, 60s timeout, typed Rpc errors, auto-reconnect) · offscreen/service.ts 187 (sendMessage routing, 20s keepalive, **inline** A6 fallback) · offscreen/client.ts 297 (uid routing, onReady hook, getRequestTimeoutMs hook, telemetry; **rejects with plain strings not Errors**) · offscreen/telemetry.ts 168 · errors.ts 246 (WalletError + 9 subclasses + payload dispatch) · messages.ts 57 · utils.ts 21 (wrapParams/unwrapParams) · zod-helpers.ts 63 · lazy-listener.ts 129 · subscribe-with-snapshot.ts 88 · testing/setup.ts 17.

### Consumed
/background Service 22 + ServiceClient 21 (42 subclasses in extension) · /offscreen 1 production consumer each (aztec-runtime pxe) · /errors heavily · /zod 5 · /messages — external imports are **all tests**.

### Dead-export candidates
**Entire /lazy-listener subpath** (0 refs outside package) · **Entire /subscribe-with-snapshot subpath** (0 imports; extension profile/client.test.ts:38 re-implements a local same-named helper!) · /utils subpath (internal-only) · walletErrorFromPayload/WalletErrorPayload (tests only) · DEFAULT_RPC_TIMEOUT_MS (test only) · sanitizeTelemetry/NoopTelemetrySink/RequestTerminalStatus · EventContent/RequestContent/ResponseContent · DEFAULT_REQUEST_TIMEOUT_MS.

### Duplication within package + into extension
- Background vs offscreen CLIENT: two full parallel correlation implementations (background/client:134-227 vs offscreen/client:176-245) with DIVERGENT error surfaces (typed WalletError vs plain strings, no errorPayload reconstruction offscreen).
- Background vs offscreen SERVICE: A6 fallback twice (extracted method vs inline catch); **ensureInitialized verbatim-duplicated** (background/service:187-199 vs offscreen/service:158-170); emit near-duplicated.
- logDebug/logInfo/logWarn/logError quadruplet copy-pasted in all four base classes (~15 LOC ×4).
- OFFSCREEN_KEEPALIVE magic string duplicated: offscreen/service.ts:13 (not exported) vs extension wallet/utils/offscreen.ts:4.
- Package's own base-class tests live in extension (wallet/base/{background,offscreen}/client.test.ts, errors.test.ts, zod-helpers.test.ts). Inversion: the two best-tested in-package modules (lazy-listener 203, subscribe-with-snapshot 217 test LOC) are the two with ZERO production consumers; the 973 LOC of base classes carry zero in-package tests.

## Conventions (both)
Subpath-only exports, root "." empty; raw TS, private. Layer discipline biome-enforced. Structural-typing decoupling (IProfileReader inline; NetworkInfo declared twice). Zod-parse at wire. WalletError convention (static CODE, setPrototypeOf, registration in payload switch; stable messages = public contract). DI seams as ctor options. @aztec/* pinned 4.2.0.

## Hotspots
errors.ts 3 (growth axis = new error classes) · PXE quartet (service/client/spec/chain-runtime) moves together — consistent with 5-surface duplication.

## Size outliers
service.ts 507 (~1.8× next; mixes RPC dispatch + concurrency + IndexedDB lifecycle + debug instrumentation) · offscreen/client 297 · chain-runtime 278 (3 classes) · background/client 263 · errors 246.
