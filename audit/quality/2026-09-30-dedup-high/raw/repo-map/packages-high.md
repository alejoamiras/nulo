# Repo map: packages-high (aztec-runtime, wallet-bridge, wallet-sdk-schema-patch, design, legal, resolve-asset, third-party-notices)

Branch dev @ 910a4def. LOC = non-test/story/generated lines from `git ls-files`. Import counts = files under `apps/extension/src` matching `@nulo/<pkg>` (other apps/pkgs noted).
Method for dead-export hunting: script over exported names (`export const|function|class|type|interface`) in each package's non-test src, grepped across `apps/**` + `packages/**` non-test files. Script is in the session scratchpad (not committed). Caveat: `scripts/` (repo root) was not in the scan.

| Package | Prod LOC | ext importing files | other consumers |
|---|---|---|---|
| aztec-runtime | ~5.1k | 51 | 2 pkgs |
| wallet-bridge | ~4.4k | 62 | none |
| design | ~4.9k (incl ~890 css, ~3.0k vue) | 70 | apps/landing (base.css only), third-party-notices (devDep) |
| third-party-notices | ~1.2k | 1 (vite config) | none |
| legal | ~260 | 16 | landing (`legal.ts`) |
| resolve-asset | ~177 | 7 | 2 pkgs, vite configs, scripts/publish |
| wallet-sdk-schema-patch | ~131 | 8 | wallet-bridge (dep), playground, tools |

Note: `apps/tools` does NOT import `@nulo/design` (no component/tag use in tools; per CLAUDE.md independence it has its own AppButton/Card/Tag/Toast primitives). Design has exactly ONE real consumer app (extension) plus landing CSS.

---
## 1. packages/aztec-runtime (PXE host + account adapter; offscreen-document side)
Deps: @nulo/{wallet-core,wallet-crypto,extension-messaging,resolve-asset}; @aztec/* 5.2.0 (accounts, aztec.js, pxe, simulator, kv-store, stdlib, noir-contracts.js, protocol-contracts, standard-contracts, bb.js), @alejoamiras/presto, aztec-standards, zod ^4.
Does NOT depend on wallet-bridge (by design).

### Modules
- `src/pxe/service.ts` 1031 LOC (LARGEST, monolith candidate): `PxeService extends Service`, long-lived PXE host, network add/remove hooks, per-profile store keys.
- `src/pxe/chain-runtime.ts` 452: `ChainRuntime`, `ProductionPxeFactory`, `ChainRuntimeRegistry` (per-chain PXE, presto prover wiring).
- `src/pxe/public-events.ts` 444: public transfer event scan + zod schemas + memo caches (module-level memos, `_resetPublicEventMemosForTests`).
- `src/pxe/client.ts` 400: `PxeServiceClientBase` (RPC client, store-key provision, recovery).
- `src/pxe/opfs-store.ts` 303: OPFS chain store open/remove/version stamp, `WrongStoreKeyError`, `ChainStoreWedgedError`, `PxeStoreVersionMismatch`.
- `src/account/nulo-account.ts` 246: `NuloAccount` (adapter over `@aztec/accounts/schnorr`; signing-key derivation, multicall, chunking).
- `src/pxe/artifact-registry.ts` 216, `artifact-catalog.ts` 108, `artifact-class-id.ts` 71, `effective-class.ts` 42, `known-artifacts.ts` 40, `note-schemas.ts` 90: artifact trust (class-id verification, catalog of compiled-in artifacts).
- `src/account/account-export.ts` 166 (account file export/format/regime digests), `fee-options.ts` 90, `address-freeze.ts` 92, `instantiation-descriptor.ts` 87, `frozen-artifact.ts` 25, `index.ts` 55 (exports + `IAccountContract`).
- `src/pxe/spec.ts` 131, `descriptors.ts` 113, `proxy.ts` 66, `ipxe.ts` 52, `schemas.ts` 43: typed RPC surface across offscreen boundary.
- `src/pxe/stale-anchor.ts` 65, `async-memo.ts` 63, `lifecycle-coordinator.ts` 45, `chain-coordinates.ts` 37, `prove-phase-sink.ts` 19.
- `src/utils/fetch.ts` 123 (timeout/single-attempt fetch), `chain-identity.ts` 75, `src/adapters/aztec-node-factory-adapter.ts` 120 (`AztecNodeFactoryAdapter`, RPC URL allowlist), `src/ports/node-factory-port.ts` 51, `src/offscreen/entry.ts` 50, `src/fee-juice.ts` 46 (`predictedWorstMinFees`).

### Entrypoints (package.json exports)
`.` (empty `export {}`), `./pxe` (17 ext importers), `./pxe/public-events` (8), `./account` (9), `./utils` (9), `./fee-juice` (4), `./ports` (2), `./adapters` (2), `./offscreen/entry` (1). Root `.` export is an empty module: zero consumers, dead entry.

### Trust boundaries
- ACCOUNT FREEZE (production invariant, CLAUDE.md): `account/address-freeze.ts` (append-only `REGIMES`, `V5_REGIME`, NULO_KDF_*), `frozen-artifact.ts` (sha256 + class id pins), `instantiation-descriptor.ts` (frozen ctor/args/salt; shared by address derivation AND first-tx ctor), `account-export.ts` (`EXPORT_REGIME_DIGESTS`, file format, zeroize). Tests hardcode every entry independently.
- Artifact trust: `artifact-registry` verifies class id before trusting (`verifyArtifactClassId`); `known-artifacts` compiled-in set.
- Node I/O: `aztec-node-factory-adapter` (`isAllowedRpcUrl`, bounded fetch, `SILENT_RPC_LOG`), `utils/chain-identity` (`assertLiveChainIdentity`: live node chainId vs selected network).
- RPC boundary: zod `NoteDaoSchema`, `PackedPrivateEventSchema`, `NotesFilterSchema`, public-event schemas (offscreen <-> SW messages).
- Storage: OPFS per-chain store, per-profile key provisioning, wrong-key and version-mismatch errors.

### Generated / vendored (exclude from LOC + dedup)
`src/account/artifacts/SchnorrAccount.json` (byte-exact vendored artifact; provenance in `artifacts/PROVENANCE.md`). `pxe/known-artifacts.ts` is thin loader (40 LOC). Dedup must never touch the vendored JSON.

### Tests
36 test files (src co-located): freeze KAT (`derivation-vectors`, `account-seed-vectors`, `artifact-freeze`, `address-freeze`, `instantiation-descriptor`), PXE pins (`boundary-refactor.pins`, `client-recovery.pins`, `public-events-warn.pins`), `stale-anchor.real.test.ts`, `opfs-store*`, `service*`. Package test = `bun --bun vitest run`.

### Similarity candidates
- `fee-juice.ts` `predictedWorstMinFees` re-implements upstream `@aztec/wallet-sdk BaseWallet.getMinFees` (documented); consumers in extension: `execution/fee/fee-strategy.ts`, `view-executor.ts`, `tx-request-builder.ts`, `transfer-estimate-reuse.ts`, `embedded-fpc-cap.ts`. Check whether extension re-derives min-fee padding (`MIN_FEE_PADDING` in `account/fee-options.ts`) separately.
- `utils/fetch.ts` timeout fetch vs other `AbortSignal.timeout`/fetch timeouts in extension (grep showed none in ext non-test: only aztec-runtime uses `makeFetchWithTimeout`), low dup risk.
- zod: `pxe/schemas.ts` + `public-events.ts` define schemas; extension has ~19 `spec.ts` files with `z.object` (contact, token, network, account...). Look for shared sub-schemas (address/field/hex) re-declared per spec.ts.
- `pxe/chain-runtime.ts` + `pxe/service.ts`: two registries of per-chain/per-profile runtime state (`ChainRuntimeRegistry` vs service maps); possible overlap. `lifecycle-coordinator` separate third piece.
- `pxe/client.ts` (400) vs `proxy.ts`/`descriptors.ts`/`spec.ts`: method-list defined in `PXE_METHOD_DESCRIPTORS` + `PXE_IPXE_METHODS`; check for parallel tables (same drift pattern wallet-bridge just fixed).
- Dead-export candidates (no non-test consumer outside package AND no intra-package use): `ACCOUNT_EXPORT_FORMAT/VERSION` (only self), `CompleteFeeOptionsConfig`, `PxeOffscreenDeps`, `PxeMethodDescriptor`, `PxeIpxeMethod`, `ProductionPxeFactoryOptions`, `PrestoEndpoint`, `OpenChainStoreOptions`, `AsyncMemoStore`, `CatalogKey/CatalogEntry`, `ArtifactNetworkContext`, `isAllowedRpcUrl` (self only, no tests), `SILENT_RPC_LOG`, `NULO_KDF_SPEC` (test-only), `PublicTransferEventSchema`, `getTransferLogTag`/`getBundledTokenClassId` (self+tests), `_resetPublicEventMemosForTests` (test-only). Most are type exports (low value). `ALL_CATALOG_KEYS`, `getCatalogEntry`, `assertNotUpgraded`, `NoteSchemaMap` used intra-package only but exported: over-exported, not dead.
- `./pxe` barrel exports that extension does not import: check `PXEProxy`, `NoteDaoSchema`, `PackedPrivateEventSchema`, `NotesFilterSchema` (intern-only per scan: no ext consumer) -> over-exported.

### For bugs audit
State owners: `PxeService` (chain/profile maps, store keys, prove state), `ChainRuntimeRegistry`, `ActiveProve`/`advanceProve` in chain-runtime, module-level memos (`async-memo`, `public-events`, `artifact-catalog`, `note-schemas` with `_reset*ForTests`), `PxeLifecycleCoordinator`, OPFS store dirs.
Error-path-heavy: `opfs-store.ts` (7 catch: wedged/timeout/version/wrong-key), `chain-runtime.ts` (4), `service.ts` (5, plus concurrency between network add/remove and prove), `stale-anchor.ts` (retry on message match `isStaleAnchorMessage`: string-matching on errors), `client.ts` recovery, `artifact-class-id.ts`, `fee-juice.ts` (error-message sniff for -32601), `account-export.ts` (import/parse of hostile files, zeroize).

---
## 2. packages/wallet-bridge (dApp-facing dispatcher; runs in SW)
Deps: @nulo/{wallet-core,extension-messaging,wallet-sdk-schema-patch}, @aztec/wallet-sdk (types + schema). No aztec-runtime dep. Single export `.` = `src/index.ts` (barrel, `export *` from 26 modules + selective from method-scope-checkers). 74 import statements across 62 extension files, all via bare `@nulo/wallet-bridge`.
DOC DRIFT: README + `index.ts` header say "dispatcher + initWalletSdkHandler wiring stay in @nulo/extension", but `src/dispatcher.ts` (1794 LOC) lives in the package; `WalletSdkDispatcher` exported from index.

### Modules
- `dispatcher.ts` 1794 (LARGEST in this scope; MONOLITH): `WalletSdkDispatcher` class at line 809; ~40 module-level helpers above it for capability request projection/coverage/delta (`projectKnownCapability`, `scopeCovers`, `*RequestCovered`, `computeCapabilityDelta`, `mergeGrantsAndRejections`, `collectNewGrants`, `assertAuthRelevantArgShape`, `unwrapOperationResult`). Capability-planning logic (lines ~185-760) is pure and separable from the class (~1000 LOC).
- `method-scope-checkers.ts` 440: per-method `check*` scope checks + `isAnyContractScope`, `coversAnyContract`, `effectiveGrants`, `readConsent`.
- `method-descriptors.ts` 398: single-source `METHOD_REGISTRY`; derives 6 tables (`deriveCapabilityMap`, `deriveExemptSet`, ...).
- `operation.ts` 222, `dapp-interaction-protocol.ts` 177, `services-contract.ts` 156 (I*Reader/Runner interfaces the extension implements), `discovery-queue.ts` 141 (bounded locked-wallet queue), `fee.ts` 111, `scope-enforcement.ts` 88, `fee-payer.ts` 70, `caip.ts` 70, `operation-validation.ts` 69, `capabilities.ts` 69, `session-types.ts` 68, `external-id.ts` 64 (module-level token Map), `account-resolution.ts` 60, plus small leaf files (action, operation-result, decoded-call, capability-map, scope-violation, field-address, call-shapes, authwit-content, types, transaction-origin, wallet-features).

### Trust boundaries (highest-risk surface in scope)
- dApp RPC ingress: `dispatcher.ts` narrows UNTRUSTED wallet-sdk args (`malformed()`, `assertAuthRelevantArgShape`, `scopeOf`, `patternOf`, `addressListOf`, `accountListOf`) into typed service calls; hand-rolled validation, not zod.
- Scope enforcement: `scope-enforcement.ts` + `method-scope-checkers.ts` (`enforceScope`, `enforceScopeWithSession`); every method must be in `METHOD_REGISTRY` (exhaustiveness test + dispatch-entry guard).
- Capability grant/widening logic (`computeCapabilityDelta`, `planAccountsWidening`, `ensureAccountsGrant`).
- Fee-payer detection `fee-payer.ts` (`CLAIM_AND_END_SETUP`, `FEE_JUICE_CONTRACT`), external-id tokens, discovery queue flood bound (F-04).
- Schema patch consumed indirectly (`@nulo/wallet-sdk-schema-patch/register` side-effect; reachability pinned by `dispatcher.test.ts`).

### Tests
13 co-located test files in src (`dispatcher.test.ts` pins reachability; method-descriptors exhaustiveness). Extension composition tests exercise it with fakes.

### Similarity candidates
- `field-address.ts` `FIELD_ADDRESS = /^0x[0-9a-fA-F]{64}$/` vs extension `utils/transfer-intent.ts:77 HEX_ADDRESS_RE` (identical regex). Other 64-hex validators likely in extension spec.ts/zod files: grep for `{64}`.
- Capability coverage logic (`contractsRequestCovered`, `scopeCovers`, `transactionRequestCovered`, `simulationRequestCovered`, `dataFieldsCovered`, `effectiveGrants`, `coversAnyContract` in method-scope-checkers) duplicated in spirit across dispatcher.ts (lines 204-283) and method-scope-checkers.ts; `isAnyContractScope` defined in checkers but dispatcher has its own `scopeOf/scopeCovers`; also extension `popup/windows/capabilities/permission-rows.ts` consumes them. Strong dedup candidate: same pattern/scope coverage computed in two places in-package.
- `isRecord` defined locally at `dispatcher.ts:307`; likely also in method-scope-checkers and elsewhere (grep `function isRecord`).
- `AccountKinds/NETWORK_ONLY_KINDS/...` derived tables: exported though consumed only by tests (see dead list).
- Dead / test-only exports (no non-test consumer anywhere in apps/packages): `RpcRequest` (ZERO uses anywhere, incl tests), `resetExternalIdTokensForTest`, `ACCOUNT_KINDS`, `METHOD_CAPABILITY_MAP`, `METHOD_TO_KIND`, `NETWORK_ONLY_KINDS`, `METHOD_SCOPE_CHECKER`, `deriveAccountKinds/CapabilityMap/ExemptSet/MethodToKind/NetworkOnlyKinds/ScopeCheckerMap`, `argsBatch/argsOneRequired/argsTwoRequired/argsRequestCapabilities/argsCreateAuthWit`, `assertKnownMethod`, `CLAIM_AND_END_SETUP(_SELECTOR)`, `FEE_JUICE_CONTRACT`, `isClaimAndEndSetup`, `DAPP_SELF_PAY_FEATURE`, all `check*` functions in method-scope-checkers (only via registry + tests), `projectKnownCapability`, `ungrantedAccounts`, `unwrapOperationResult`, `isCapabilityExempt`, `getRequiredCapability` (intra-only). Barrel `export *` hides that most of these are internal; the barrel is wider than consumed surface (extension uses ~a few dozen names).
- `fee.ts` 111 + `fee-payer.ts` 70 + aztec-runtime `account/fee-options.ts` 90 + extension `execution/fee/*`: three fee vocabularies; check for duplicate fee-payer/claim detection in extension `fee-strategy.ts` (grep found `CLAIM_AND_END_SETUP` only in wallet-bridge non-test, so extension reimplements or does not check).

### For bugs audit
State: `external-id.ts` module Map + counter (never pruned; `nextToken`), `discovery-queue.ts` (mutable queue, drain re-queue under lock race), dispatcher per-request closures with `DispatchHooks`. Error-path-heavy: dispatcher capability planning (partial grant merging, widening, rejection bookkeeping), `assertAuthRelevantArgShape`, scope checkers (malformed input must reject, never throw non-typed errors), `operation-validation.ts`.

---
## 3. packages/wallet-sdk-schema-patch (131 LOC)
`src/apply.ts` 117 (`applyNuloSchemaPatch(schema)`: mutates upstream `WalletSchema` in place adding `registerToken`, `isTokenRegistered`, `grantPublicAuthwit`, `getWalletFeatures`; fails loudly if upstream signature shape changed via `is*Shape` predicates), `src/register.ts` 14 (side-effect import). Exports: `./apply`, `./register`. Deps: @aztec/aztec.js, @aztec/stdlib, zod. Consumers: extension `wallet-sdk/background.ts` + 7 others (8 files), tools `createAztecWalletSession.ts`, playground `lib/wallet.ts`, wallet-bridge (dep).
Trust boundary: runtime monkey-patch of a third-party singleton (prototype-pollution-free but order-dependent: must be FIRST import). Inline `any` with biome-ignore.
Tests: 2 files (apply.test.ts). Similarity: `GRANT_CONTENT_SCHEMA {caller, contract, method, args}` duplicates the authwit content shape in wallet-bridge `authwit-content.ts` (27 LOC); `walletFeatures` names also in wallet-bridge `wallet-features.ts` (12 LOC). Check that feature-name strings are not declared twice.
Dead: none (`applyNuloSchemaPatch` used by register + tests; `register` by apps).
Bugs audit: shape predicates `is*Shape` rely on zod-internals (`_def`) of upstream; fragile on zod/aztec bump; re-registration/idempotency.

---
## 4. packages/design (shared Vue design system; ~4.9k LOC)
Deps: vue ^3.5 only (+ vue-tsc). No @nulo deps. Exports: `.` (barrel of 28 components + tokens + type unions), `./tokens`, `./base.css`, `./core/*`, `./ui/*`, `./composite/*`, `./composables/*`, `./testing`.
Consumers: extension (70 files; 50 via `@nulo/design` barrel, plus `/tokens`, `/testing`, `/composables/toast`; plus a `scripts/design-resolver.ts` unplugin resolver mapping bare tags to package SFCs), landing (`base.css` + `overrides.css`), third-party-notices (devDep for font claim). Tools app does not use it.

### Modules
- CSS: `src/utilities.css` 459, `src/base.css` 428 (hash-pinned; `*.drift.test.ts`).
- core: `Flex` 82, `Text` 84, `Icon` 103, `MaterialIcon` 32.
- ui: `Input` 427, `Button` 395, `ToastManagerBase` 299, `Tooltip` 271 (+`tooltip-placement.ts` 64), `Banner` 171, `Popover` 138, `SubPageHeaderBase` 125, `Toggle` 113, `Checkbox` 71, `Toast` 70, `BrutalistTitle` 70, `Spinner` 63, `RowAction` 60, `Skeleton` 53, `LoadingState` 47, `Badge` 47, `SectionLabel` 45, `Tag` 37, `Card` 19, `FieldWarning` 12.
- composite: `AddressDisplay` 69, `BalanceRow` 55, `EmojiGrid` 46, `DripButton` 34, `DisclaimerTag` 7.
- tokens pipeline: `token-contract.ts` 152 (source of truth) -> GENERATED `tokens.ts` 101 + `base.css` bits via `scripts/gen-tokens.ts` + `internal/render-{tokens,css}.ts` (`sanitize.ts`), `theme-contrast.ts` 123, `theme-vars.ts` 91, `severity.ts`, `color-names.ts`, `layout-names.ts`, `composables/toast.ts` 89, `composables/outside.ts` 61, `testing.ts` 9.
### Generated/vendored to exclude
`src/tokens.ts` (generated from token-contract; drift tests), `src/fonts/*.woff2` (5 font binaries, SHA-pinned by third-party-notices policy), `base.css` token block.
### Tests
48 test/story files: per-component tests, `mount-all.test.ts`, `boundary.test.ts` (no app imports), `tokens.drift/parity`, `utilities.drift`, `theme-contrast`, stories for Banner/Input/LoadingState/Popover/Spinner/ToastManagerBase/Tooltip.
### Similarity candidates (design vs extension)
- **AddressDisplay is duplicated**: `packages/design/src/composite/AddressDisplay.vue` (69, props address/head/tail, truncation `slice(0,head)…slice(-tail)`) vs extension-local `apps/extension/src/components/AddressDisplay.vue` (112, Azguard-derived, `trimAddress`, store-coupled) used by `ScopeAddress`, `ScopeClassId`, tx/received pages, account-state pages. Also `ScopeAddress.vue` 102 + `ScopeClassId.vue` 65 re-render address/copy UX. Check whether design's AddressDisplay has ANY ext consumer (resolver name `AddressDisplay` in ext resolves to the LOCAL file per CLAUDE.md discipline; design copy may be dead in ext).
- Design composites `BalanceRow`, `EmojiGrid`, `DripButton`, `DisclaimerTag` and ui `Card`, `Skeleton`, `RowAction`, `Tag`, `FieldWarning`: verify each has >=1 tag use in `apps/extension/src/**/*.vue` (my tag-grep was botched by shell error; redo with `grep -rlE "<Name[ >/]"`). Candidates for zero-consumer: DripButton/EmojiGrid/BalanceRow (extension never used a "Drip"; tools has its own AppButton/Card/Tag/Toast primitives, see CLAUDE.md "AppButton/Card/Tag/Toast tools primitives" which are now in the design package but unused by tools app import-wise).
- Extension keeps `components/ui/{Button,SubPageHeader,ToastManager}.vue` wrappers (intentional) and orphan stories (`Badge/BrutalistTitle/Checkbox/SectionLabel/Toggle.stories.ts`, `Button.stories.ts`) for primitives now living in design: stories in ext importing from design, dup with design stories (Banner, etc.). Also `RowTarget.vue`, `Dropdown/*`, `Popup/*`, `SearchField.vue` remain local (host-coupled; not dup).
- `design/src/composables/toast.ts` + `outside.ts` vs extension shims `composables/{toast,outside}.js` (named re-export shims, intentional).
- CSS: `utilities.css` 459 vs ext `src/design/*.scss` leftovers (`_base/_flex/_text` deleted per CLAUDE.md); check ext for residual utility classes duplicating `utilities.css`.
### For bugs audit
State: toast composable (module-level singleton), `outside` listeners, Tooltip/Popover placement + open state, Input (427, most stateful), ToastManagerBase timers. Focus order/keyboard (positive tabindex ban), Escape handling.

---
## 5. packages/legal (260 LOC)
`src/status.ts` 181 (`legalStatus` derivation, `LEGAL_HISTORY_LIMIT`, `LegalAcceptanceEntry`), `manifest.ts` 39 (`LEGAL_MANIFEST`, `LEGAL_SITE_ORIGIN`, `LegalVersion`), `document.ts` 28 (`parseVersionHistory`, `DocumentHeader`), `index.ts` 3. Exports `.` only; no runtime deps. Consumers: 16 ext files (LegalAcceptanceService, sheet, settings), landing `legal.ts`.
Trust boundary: stored acceptance record is untrusted (malformed = "missing", fail closed); Terms-only status; consent wording constants `CONSENT_LABEL`/`CONTINUE_LABEL`. Legal docs themselves in repo `legal/` (not this package; `legal/archive/` copies).
Tests: 3 files in src; they assert package == documents (manifest head, history table, archive copies).
Dead: `parseVersionHistory` (test-only), `LEGAL_HISTORY_LIMIT` (self+test), `LEGAL_SITE_ORIGIN` (intra-only), `DocumentHeader`, `LegalAcceptanceEntry` (types). Verify `document.ts` is only for the tests (src non-test consumer = none): candidate to move into test support.
Similarity: none significant. Bugs: `status.ts` parse of untrusted record, version comparison (semver minor/patch), history limit truncation.

---
## 6. packages/resolve-asset (177 LOC, single file `src/index.ts`)
Exports `.`: `resolvePackageRoot`, `resolvePackageAsset`, `resolveExportedAsset`, `assertPackageIdentity`, `isUnderNodeModules`, types. Anchored at caller (`from: import.meta.url`), scans `require.resolve.paths`, validates `package.json#name`; throws listing searched paths. Staged for npm as `@alejoamiras/nulo-resolve-asset` (`scripts/publish/`). Consumers: 7 ext files (vite/vitest/build configs, `apps/extension/scripts/*`), aztec-runtime, third-party-notices, tools vite config.
Tests: 1 file. Dead-ish: `assertPackageIdentity`, `isUnderNodeModules` have tests only in-package (used by `apps/extension/scripts/layout-identity.test.ts` and `scripts/publish/stage.test.ts`: live via scripts). `resolvePackageRoot` used internally.
Similarity: confirm no remaining `node_modules`-walking resolver copies ("six drifting copies" were replaced): `grep -rn "node_modules" apps/*/vite.config.ts apps/*/scripts scripts --include=*.ts`.
Bugs: lexical containment check on asset path (symlinks under isolated linker escape lexical check), error messages.

---
## 7. packages/third-party-notices (1212 LOC)
Build-time only (Vite plugin + generator). Exports `.`: `thirdPartyNotices` (plugin.ts 110), `generateNotices` (generate.ts 313), `POLICY`/`OVERRIDES`/`VENDORED`/`FONT_ALLOWED`/`FONT_ASSET` (policy.ts 333), collect.ts 79 (`bundleContents`, `workerIdentity`), packages.ts 150 (`moduleOrigin`, `owningPackage`, `licenceFiles`), stylesheets.ts 80 (`inlinedStylesheets`, `resolveStylesheet` spellings), spdx.ts 79 (SPDX parse/allow), check-minimum.ts 26 + `bin/check-minimum.ts` 29. Deps: devDeps @nulo/design, @nulo/resolve-asset. 1 consumer: extension vite chrome/firefox wrapper configs.
Trust boundary: gate policy; refuses unknown licences, missing metadata, stale/unused overrides, unclaimed assets/fonts (font claim bound to SHA-256). Loosening `ALLOWED`/`FONT_ALLOWED` or adding `OVERRIDES`/`VENDORED` without tagged upstream = weakening a gate. Exclude licence texts from LOC (none tracked in src; policy.ts holds vendored records).
Tests: 5 files. Dead: `parseMinimum/missingFromNotices/buildDirsFor` (used via `bin/check-minimum.ts`; tests only otherwise), `noticeNames`, `NOTICES_FILE`. Most "zero ext consumer" exports are intra-package (build tool).
Similarity: `spdx.ts` SPDX handling vs any SPDX/licence parsing in `scripts/` or `apps/extension/scripts` (grep `spdx`); `packages.ts` manifest walking vs resolve-asset (intentional dependency). Bugs: path canonicalization, regex on SPDX expressions, stylesheet `@import` resolution spellings.

---
## Cross-package dedup shortlist (priority)
1. wallet-bridge internal: capability/scope coverage in `dispatcher.ts` (lines ~204-283, 500-760) vs `method-scope-checkers.ts` (effectiveGrants/coversAnyContract/isAnyContractScope); plus split dispatcher.ts 1794 LOC.
2. design `AddressDisplay` vs extension `components/AddressDisplay.vue` (+ ScopeAddress/ScopeClassId): two implementations, same truncation semantics.
3. 64-hex address regex: wallet-bridge `field-address.ts` vs extension `utils/transfer-intent.ts` (+ grep `{64}` in ext spec.ts zod schemas).
4. Zod schema fragments across aztec-runtime `pxe/schemas.ts`/`public-events.ts`, extension ~19 `spec.ts`, schema-patch `GRANT_CONTENT_SCHEMA` vs wallet-bridge `authwit-content.ts`.
5. Over-wide barrels: wallet-bridge `index.ts` (`export *` of 26 files, ~60 names with no non-test external consumer), aztec-runtime `.` empty root export and `./pxe` barrel names; `RpcRequest` fully dead.
6. Design exports with possibly zero ext/tools tag use (verify): BalanceRow, EmojiGrid, DripButton, DisclaimerTag, Card, Tag, Skeleton, RowAction, FieldWarning, design `AddressDisplay`; ext orphan stories for design-owned primitives.
7. Stale docs: wallet-bridge README/index.ts header claims dispatcher lives in extension.
