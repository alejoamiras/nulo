# q11-pkg-high — claude

Scope read: `packages/wallet-bridge/src/{dispatcher,method-scope-checkers,method-descriptors,scope-enforcement,account-resolution,field-address,fee-payer,operation-validation,capability-map,operation,dapp-interaction-protocol,action,authwit-content,call-shapes,decoded-call,caip,wallet-features}.ts`; `packages/aztec-runtime/src/{fee-juice.ts, account/{nulo-account,fee-options}.ts, adapters/aztec-node-factory-adapter.ts, utils/{fetch,chain-identity}.ts, pxe/{service,client,chain-runtime,descriptors,proxy,ipxe,spec,async-memo,artifact-registry,public-events(1-200)}.ts}`; `packages/legal/src/{status,document}.ts`; `packages/resolve-asset/src/index.ts`; `packages/third-party-notices/src/{packages,collect,stylesheets}.ts`; `packages/wallet-sdk-schema-patch/src/apply.ts`. Cross-checked in `apps/extension/src`: `wallet/services/wallet-sdk/queued-journal.ts`, `wallet/services/execution/{utils/fee-detection,fee/*,transfer-estimate-reuse,operation-estimate-reuse,service}.ts`, `utils/chain-ids.ts`, `wallet/services/network/service.ts`, `wallet/utils/fee-juice*.ts`, `utils/tx-enrichment.ts`, `popup/windows/capabilities/*`. Not read in depth: `pxe/{opfs-store,artifact-catalog,note-schemas,stale-anchor,lifecycle-coordinator}.ts`, `account/{account-export,address-freeze,instantiation-descriptor}.ts`, `third-party-notices/{generate,policy,plugin}.ts` (frozen/policy surfaces, no duplication lead). Note: `jscpd-production.md` covers extension src only, so it gave no leads for this cluster; every finding below is semantic.

## q11-pkg-high-C-1: Grant-matching rules implemented twice in wallet-bridge (coverage planner vs enforcement)

**Smell:** Duplicate Code (semantic), with Shotgun Surgery as the consequence: an authorization matching rule must be edited in two modules or they silently disagree.

**Maintenance impact:** structural, security-adjacent. Blast radius: `dispatcher.ts`, `method-scope-checkers.ts` (+ the ext popup that mirrors both). Change frequency: `dispatcher.ts` 34 commits all-time, 29 since 2026-06-01; `method-scope-checkers.ts` 8 since 2026-06-01.

**Evidence:**
- Pattern match: `scopeCovers` (`dispatcher.ts:219-230`) re-derives, per requested pattern, `(ep.contract==="*" || sameFieldAddress(ep.contract, rp.contract)) && (ep.function==="*" || ep.function===rp.function)`. That is exactly `matchesPattern(contract, fn, pattern)` (`method-scope-checkers.ts:38-43`) called with `rp.contract`/`rp.function`. The doc comment on `scopeCovers` says coverage "deliberately mirrors enforcement's shape", i.e. the author knew they must stay equal.
- Address-list membership: `contractsRequestCovered` (`dispatcher.ts:204-217`, inner `e.contracts==="*" || e.contracts.some(sameFieldAddress…)`) and `privateEventsCovered` (`dispatcher.ts:263-271`, same shape over `privateEvents.contracts`) are both `inAddressList(addr, list)` (`method-scope-checkers.ts:57-60`) plus an outer `every`/`some`.
- `grantsOfType` exists twice with different typings: `dispatcher.ts:686-688` (typed by `Capability["type"]`) and `method-scope-checkers.ts:62-64` (untyped cast). Same filter+map.
- The `any-contract` predicate is a third statement of "what does a scope reach": `isAnyContractScope`/`coversAnyContract` (`method-scope-checkers.ts:405-425`).

**Why it harms future change:** adding a scope dimension (e.g. a per-function arg constraint, a new wildcard form, a change to how the empty function name is treated — `matchesScope` refuses `fn===""`, `scopeCovers` does not) means editing both the enforcement path and the "does a re-prompt happen" path. If only enforcement changes, the wallet stops re-prompting for grants it will then refuse (or the reverse: approves silently a widening enforcement would have refused). Today the two already differ on the empty-name guard.

**Smallest safe refactoring:** Extract Function / Move Function. Create one leaf `grant-matching.ts` in `wallet-bridge/src` (imports only `field-address`, `capabilities`) exporting `matchesPattern`, `inAddressList`, `grantsOfType<K>`; rewrite `scopeCovers` as `requested.every(rp => existing.some(ep => matchesPattern(String(rp.contract), rp.function, ep)))` and the two address-coverage helpers over `inAddressList`. Keep `method-scope-checkers` a leaf (the registry acyclicity note in its header still holds since the new file is also a leaf).

**What disappears:** roughly 30 lines across `scopeCovers`, `contractsRequestCovered`, `privateEventsCovered`, one `grantsOfType`; two parallel spellings of the wildcard rule collapse to one.

**Instances:** `packages/wallet-bridge/src/dispatcher.ts:204-217`, `:219-230`, `:263-271`, `:686-688`; `packages/wallet-bridge/src/method-scope-checkers.ts:38-43`, `:57-60`, `:62-64`.

## q11-pkg-high-C-2: "Which account does this sendTx act as" derived independently in wallet-bridge and the extension

**Smell:** Duplicate Code (semantic) / Shotgun Surgery. The resolution rule itself was already extracted (`resolveAuthorizedSessionAccount`), but its two inputs are still re-derived on each side, and the code comments say divergence causes a mis-filed activity record.

**Maintenance impact:** structural. Blast radius: `wallet-bridge` (dispatcher) + extension execution + journal (3 modules). Change frequency: dispatcher 29 commits since June; `queued-journal.ts` touched by the same arcs.

**Evidence:**
- `opts.from` normalization ("absent or `NO_FROM` means wallet picks, else `String(from)`"): `requestedFromOf` + private `isNoFromRequest` (`packages/wallet-bridge/src/dispatcher.ts:185-193`, comment: "inlined here so the dispatcher stays decoupled"); `extractSendFrom` (`apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84-89`, comment: "Mirrors the dispatcher's normalization exactly ... A stricter rule here would diverge"); and a third, exported `isNoFromRequest` (`apps/extension/src/wallet/services/execution/utils/fee-detection.ts:18-20`) with its own test. The `"NO_FROM"` literal is compared in all three.
- Session address set: `sessionAccountsOf` (`dispatcher.ts:439-449`, CAIP + raw, all chains), `getSessionAccountAddresses` (`dispatcher.ts:1730-1736`, chain-prefix filtered raw addresses), and `queued-journal.ts:143` (`new Set(dapp.accounts.map(parseCaipAccount…address))`, NOT chain-filtered). The journal side has already drifted (no chain filter) from the dispatcher side it claims to mirror.

**Why it harms future change:** a new sentinel (another NO_FROM-like value) or a change to how CAIP session entries map to addresses must be made in three places; missing the journal copy files the queued record under a different account than the one the dispatcher sends from, which is the exact bug `account-resolution.ts` was created to end.

**Smallest safe refactoring:** Move Function to the lowest shared layer. `wallet-bridge/src/account-resolution.ts` already is the shared rule; add `NO_FROM`, `requestedSenderOf(opts)` and `sessionAddressesOf(session, chainId)` there, export via the barrel; have the dispatcher, `queued-journal.ts` and `fee-detection.ts` import them (extension already depends on wallet-bridge). Drop the inlined copies and the "mirrors" comments.

**What disappears:** 2 duplicate helper definitions, 1 duplicate test, 3 "must mirror" comments; the chain-filter drift becomes impossible.

**Instances:** `packages/wallet-bridge/src/dispatcher.ts:185-193`, `:439-449`, `:1730-1736`; `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:84-89`, `:143`; `apps/extension/src/wallet/services/execution/utils/fee-detection.ts:18-20`.

## q11-pkg-high-C-3: Popup-routed dispatcher handlers repeat one scaffold; routing and batch-ban live outside the registry

**Smell:** Duplicate Code + Switch Statements (an if-ladder keyed on method name next to a registry that already owns per-method facts). `RECURRING (prior: 2026-08-16 Q-01, dispatcher bullet "4 popup/execution routing paths repeating a 5-step scaffold verbatim")` — still present, file since grew.

**Maintenance impact:** structural. Blast radius: `dispatcher.ts` + `method-descriptors.ts`. Change frequency: 29 commits since June.

**Evidence:** `handleSendTx` (`dispatcher.ts:1105-1148`), `handleRegisterToken` (`:1228-1252`), `handleGrantPublicAuthwit` (`:1263-1305`) and the popup leg of `handleCreateAuthWit` (`:1158-1206`) each do: `requireSession` → `String(args[n])` → `resolveNetworkAndAccount` → `formatCaipAccount(ctx.chainId, account.address)` → build one request → `dappInteractionService.execute({sessionId: dappSession.id, operations:[op]}, …)` → `unwrapResult(results[0])`. `unwrapResult` itself (`:1790-1792`) is a pure Middle Man over the exported `unwrapOperationResult`. Separately, which methods are popup-gated is stated in three places: `routeHandlerMethod`'s if-ladder (`:915-975`), `handleBatch`'s hard-coded `"sendTx" || "registerToken"` ban (`:1072-1090`), and the registry (`routing: {via:"handler"}` with prose `note`s, `method-descriptors.ts`).

**Why it harms future change:** a new popup method means a fifth copy of the scaffold plus edits to the ladder and (if it must be refused in a batch) the ban list; the ban list is already stale (see Incidental bugs).

**Smallest safe refactoring:** Extract Function `private runPopupOperation(ctx, dappSession, requestedAccount, build: (caip) => OperationRequest, extra?)` covering steps 1-6; inline `unwrapResult`. Add `popupGated?: true` (and optionally `handler: HandlerName`) to `MethodDescriptor` so `handleBatch` derives its refusal set from `METHOD_REGISTRY`, and the ladder becomes a lookup.

**What disappears:** ~60 lines of scaffold, one wrapper method, one hard-coded name list.

**Instances:** `packages/wallet-bridge/src/dispatcher.ts:915-975`, `:1072-1090`, `:1105-1148`, `:1158-1206`, `:1228-1252`, `:1263-1305`, `:1790-1792`.

## q11-pkg-high-C-4: Legacy-IndexedDB deletion hand-wrapped three ways, with the "keyval-store only when no PXE DB remains" rule written twice in `PxeService`

**Smell:** Duplicate Code (with inconsistent policies, a correctness-adjacent drift risk). `RECURRING (prior: 2026-08-16 Q-01, pxe/service.ts bullet: "indexedDB.deleteDatabase is hand-wrapped 3x with 3 different onblocked policies")` — unchanged.

**Maintenance impact:** structural inside one 1,031-line class. Blast radius: `packages/aztec-runtime/src/pxe/service.ts` only. Change frequency: 25 commits since June (hottest file in the cluster after the dispatcher).

**Evidence:**
- `sweepLegacyIndexedDbs` pxe loop: `new Promise` around `indexedDB.deleteDatabase`, `onblocked` warns and resolves false (`service.ts:285-297`).
- Same function, keyval-store tail: same promise wrapper, `onblocked` warns and resolves (no result) (`:309-320`).
- `deleteDb` (`:866-884`): same wrapper, `onblocked` starts a timeout that rejects.
- The rule "delete the shared `keyval-store` only when no `PXE_DATA_DIR_ROOT` DB remains" is implemented at `:302-321` (boot sweep) and again at `:780-792` (`clearProfileState`), each with its own `indexedDB.databases()` re-list and `startsWith` filter.

**Why it harms future change:** the blocked-handling policy (skip vs wait vs reject) differs by call site without a named reason; changing one (for example making the boot sweep retry, or tightening the keyval guard because a new profile-scoped DB appears) means finding all three and both emptiness checks. The keyval rule protects a surviving profile's PXE, so a missed copy corrupts data, not UI.

**Smallest safe refactoring:** Extract Function into `pxe/legacy-idb.ts`: `deleteIdb(name, onBlocked: {skip: true} | {waitMs: number})` and `deleteSharedKeyvalIfNoPxeDbs(deleteIdb)`; `service.ts` calls them at the three sites. If the rc.2-era pre-OPFS data is no longer possible on any install, the better move is deleting the legacy sweep entirely (owner call; could not verify install population).

**What disappears:** two of three promise wrappers and one of two emptiness checks (~35 lines), or ~90 lines if the legacy sweep is retired.

**Instances:** `packages/aztec-runtime/src/pxe/service.ts:285-297`, `:302-321`, `:780-792`, `:866-884`.

## q11-pkg-high-C-5: Wallet composite chain-id formula `(l1ChainId ^ rollupVersion) >>> 0` written four times; the named helper sits in the wrong layer

**Smell:** Duplicate Code (primitive formula) + layering inversion that forced it: the helper lives in the extension, the lower package could not import it.

**Maintenance impact:** structural (chain identity is a security anchor: storage scoping and the drifted-endpoint refusal both key on it). Blast radius: `aztec-runtime` (2), extension (2). Change frequency: low on the formula, but it changes on every network-identity rework (mainnet pin was stale once per `chain-ids.ts` header).

**Evidence:** `walletChainId()` is defined at `apps/extension/src/utils/chain-ids.ts:12-14`. Inline re-statements: `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101` (`probeChainId`), `packages/aztec-runtime/src/utils/chain-identity.ts:59` (`liveComposite`), and `apps/extension/src/wallet/services/network/service.ts:1010` — which already imports from `@/utils/chain-ids` at `:24` yet does not use `walletChainId`.

**Why it harms future change:** if the composite definition changes (a wider id, a salt), the probe (what gets stored), the drift check (what gets compared against stored) and the extension seed constants must all change together; a missed copy makes `assertLiveChainIdentity` refuse every signing attempt, or worse accept a mismatched one.

**Smallest safe refactoring:** Move Function. Put `walletChainId` in `packages/aztec-runtime/src/utils/chain-identity.ts` (exported via `@nulo/aztec-runtime/utils`, already imported by 9 extension files); make `utils/chain-ids.ts` re-export it; replace the three inline expressions.

**What disappears:** 3 inline formulas, one implicit cross-layer contract.

**Instances:** `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:101`; `packages/aztec-runtime/src/utils/chain-identity.ts:59`; `apps/extension/src/wallet/services/network/service.ts:1010`; definition `apps/extension/src/utils/chain-ids.ts:12-14`.

## q11-pkg-high-C-6: "Inclusion-safe base fee × priority multiplier" recomputed at five sites that must match byte for byte

**Smell:** Duplicate Code (semantic) / Shotgun Surgery. `predictedWorstMinFees` (aztec-runtime) centralizes the basis but not its composition with the multiplier, so the estimate-reuse caches re-derive what the builders committed and compare fingerprints.

**Maintenance impact:** structural. Blast radius: 5 files under `apps/extension/src/wallet/services/execution/`, plus `aztec-runtime/src/fee-juice.ts` as the missing home. Change frequency: fee pipeline is an active arc (fee-strategy/estimate-reuse files changed repeatedly since June).

**Evidence:** `maxFeesPerGas = (await predictedWorstMinFees(node)).mul(multiplier)` at `execution/fee/fee-strategy.ts:286-290`, `execution/fee/fpc-strategy.ts:177` and `:261`, `execution/operation-estimate-reuse.ts:160-161`, and `execution/transfer-estimate-reuse.ts:195-202` (the last re-wraps `new GasFees(basis.feePerDaGas, basis.feePerL2Gas)` and its comment says it must "reproduce the exact `GasFees.mul` product the build finalized"). The multiplier resolution `priorityLevel ? PRIORITY_MULTIPLIERS[level] : DEFAULT_FEE_MULTIPLIER` is itself repeated in the two reuse files (`operation-estimate-reuse.ts:160`, `transfer-estimate-reuse.ts:198-200`) and a third form at `execution/service.ts:1103` + `fpc-strategy.ts:135`, `:206` (`ctx.feeMultiplier ?? DEFAULT_FEE_MULTIPLIER`).

**Why it harms future change:** any change to the basis (clamping, a minimum floor, a per-network bias) or to the multiplication (rounding) must be applied identically to the builder and to both drift checks; a mismatch does not fail loudly, it produces a permanent "base fee drift" rejection that silently disables estimate reuse.

**Smallest safe refactoring:** Extract Function `committedMaxFees(node, multiplier): Promise<GasFees>` (does the re-wrap + `mul`) in `aztec-runtime/src/fee-juice.ts` beside `predictedWorstMinFees`, and `resolveFeeMultiplier(priorityLevel?)` next to `DEFAULT_FEE_MULTIPLIER` in the execution fee module; replace the five call sites.

**What disappears:** 5 inline compositions, 3 multiplier ternaries; the "must match finalizeGasLimits" comments become unnecessary.

**Instances:** `apps/extension/src/wallet/services/execution/fee/fee-strategy.ts:286-290`; `.../fee/fpc-strategy.ts:135`, `:177`, `:206`, `:261`; `.../operation-estimate-reuse.ts:160-161`; `.../transfer-estimate-reuse.ts:195-202`; `.../service.ts:1103`; helper home `packages/aztec-runtime/src/fee-juice.ts:16-46`.

## q11-pkg-high-C-7: Speculative `ArtifactRegistry` policy machinery and a no-op profile subscription (dead surface in aztec-runtime and wallet-bridge)

**Smell:** Speculative Generality + Dead Code. `RECURRING (prior: 2026-08-16 Q-01, pxe/service.ts bullet: "ArtifactRegistry extensibility hook ... exactly one caller and zero configuration" and "IProfileReader.onProfileDeleted — zero production readers")`.

**Maintenance impact:** local, but paid on every read of a 1,031-line file and a trust-boundary class (class-id verification). Blast radius: `artifact-registry.ts`, `service.ts`, `index.ts`. Change frequency: `artifact-registry.ts` 4 commits since June.

**Evidence (dead-code grep, no DI/auto-import/registry covers these; `aztec-runtime` has no reflective registration and `./pxe` barrel consumers were grepped across `apps/**` and `packages/**`):**
- `setPolicy`, `getPolicy`, `defaultPolicy`, `ArtifactPolicy.order/byClassId`, `ArtifactSource`: `artifact-registry.ts:22-35`, `:96-104`, `:165-166`; the only non-definition references are the barrel re-export (`pxe/index.ts:14`) and `apps/extension/src/wallet/services/pxe/artifact-registry.test.ts:104,123`. Production constructs the registry once with no policy (`service.ts:170`), so the order is always `["pxe-local","known"]` and `byClassId` is always unset.
- `ArtifactNetworkContext.chainId` is documented "kept for future per-chain policy hooks" and the `_network` parameter of `resolve` is never read (`artifact-registry.ts:13-18`, `:157-163`); passed at `service.ts:371`.
- `hasKnownClassId` (`:122-125`) and `clear()` (`:134-139`): zero non-test callers anywhere (the doc says "Called during onProfileDeleted", but nothing subscribes).
- `this.profiles.onActiveProfileChanged.add(this.onActiveProfileChanged)` (`service.ts:221`) registers a handler whose body is an empty async function with only a comment (`:1022-1030`); `IProfileReader.onProfileDeleted` (`:72`) and `onActiveProfileChanged` (`:73`) are required interface members with no production reader.
- `RpcRequest` in `packages/wallet-bridge/src/method-descriptors.ts:376-379`: zero references in `apps/**`, `packages/**`, tests or docs.

**Why it harms future change:** a reader of `resolve` must reason about a policy space that cannot occur; `IProfileReader` forces every fake in the offscreen entry and tests to supply events nobody consumes.

**Smallest safe refactoring:** Remove Dead Code / Inline: drop the policy type, setters, `_network` parameter, `hasKnownClassId`, `clear()` (or keep `clear` only if a caller is added), the empty handler and its subscription, the two `IProfileReader` events, and `RpcRequest`. Adjust the two policy tests.

**What disappears:** roughly 60 lines plus 2 tests and 2 interface members.

**Instances:** `packages/aztec-runtime/src/pxe/artifact-registry.ts:13-35`, `:96-104`, `:122-125`, `:134-139`, `:157-166`; `packages/aztec-runtime/src/pxe/service.ts:69-74`, `:221`, `:1022-1030`; `packages/aztec-runtime/src/pxe/index.ts:14`; `packages/wallet-bridge/src/method-descriptors.ts:376-379`.

## q11-pkg-high-C-8: `dispatcher.ts` keeps accreting: 1,794 lines, ~575 of them pure capability-planning functions above the class

**Smell:** Large Class / Divergent Change. `RECURRING (prior: 2026-08-16 Q-01, "God-service accretion recurs across 5 core services")` — the file was 1,368 LOC then; it is 1,794 now (+31%) with the recommended `CapabilityConsentCoordinator` extraction never done.

**Maintenance impact:** architectural. Blast radius: the single dApp RPC ingress for the whole wallet. Change frequency: 34 commits all-time, 29 since 2026-06-01 (highest in the cluster).

**Evidence:** module-level pure block `dispatcher.ts:~185-760` (coverage predicates, projectors `CAPABILITY_PROJECTORS`, `computeCapabilityDelta`, `planAccountsWidening`, `mergeGrantsAndRejections`, `collectNewGrants`, `consentDecision`, `accountsAdditions`) has no dependency on `this` or any service; the class (`:809-1794`) then mixes method routing, four popup handlers, capability negotiation, and operation construction. The block is also where C-1's duplicates live, so C-1 cannot be fixed cleanly while the two halves sit in different files.

**Why it harms future change:** every capability-policy edit (frequent: the file's commit log is mostly consent/widening/projection fixes) lands in the same file as unrelated routing edits, so review diffs are long and concurrent arcs conflict.

**Smallest safe refactoring:** Move Function (no class extraction needed): `capability-planning.ts` for the pure block, exporting `computeCapabilityDelta`, `mergeGrantsAndRejections`, `projectRequestedCapabilities`, `projectKnownCapability`, `dataFieldsCovered`, `ungrantedAccounts`; the dispatcher imports them. Combine with the `grant-matching.ts` leaf from C-1. Tests that import these names from `dispatcher` move with the exports.

**What disappears:** ~575 lines leave `dispatcher.ts` (→ ~1,200); no behaviour change.

**Instances:** `packages/wallet-bridge/src/dispatcher.ts:185-760` (extractable block), `:809-1794` (class).

## q11-pkg-high-C-9: `isRecord` re-implemented eight times, plus a ninth near-variant

**Smell:** Duplicate Code (utility re-implemented where a shared home exists).

**Maintenance impact:** cosmetic-to-local, but it sits in trust-boundary validators where the exact predicate matters (array exclusion). Blast radius: 8 files across 2 packages + extension. Change frequency: incidental.

**Evidence:** identical `typeof v === "object" && v !== null && !Array.isArray(v)`: `packages/wallet-bridge/src/dispatcher.ts:307`, `.../method-scope-checkers.ts:395`, `.../method-descriptors.ts:115` (named `isPlainRecord`), `apps/extension/src/popup/windows/capabilities/permission-rows.ts:253`, `.../details-table.ts:88`, `apps/extension/src/composables/usePinnedTokens.ts:24`, `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:32`. Near-variant WITHOUT the array check, same file as the first: `dispatcher.ts:767` (`isObj` inside `assertAuthRelevantArgShape`); `packages/legal/src/status.ts:66` (`isPlainObject`, prototype check, intentionally stricter). No shared export exists in `@nulo/wallet-core` or `@nulo/extension-messaging` (grepped `function isRecord|isPlainObject|isObject`).

**Why it harms future change:** two of the copies in one file accept arrays and non-arrays as "object" with different meanings; tightening or loosening one (for example to reject prototype-bearing objects, as `legal` does) means hunting ~20 inline `typeof … === "object" && … !== null` sites as well.

**Smallest safe refactoring:** Extract Function `isRecord` into `@nulo/wallet-core/utils` (lowest package all three consumers already depend on) and import it; keep `legal`'s stricter guard as is (`legal` has no runtime deps by design).

**What disappears:** 7 definitions; `dispatcher.ts:767` becomes the shared function (verify the array-accepting behaviour is not relied on by the exec-payload guard first).

**Instances:** listed above.

## q11-pkg-high-C-10: Init-nullifier existence check duplicated inside `NuloAccount`

**Smell:** Duplicate Code (local).

**Maintenance impact:** cosmetic. Blast radius: `packages/aztec-runtime/src/account/nulo-account.ts`. Change frequency: frozen surface (changes only with the account regime).

**Evidence:** `buildTxExecutionRequest` (`nulo-account.ts:172-173`) computes `computeSiloedPrivateInitializationNullifier(this.address, this.instance.initializationHash)` then `node.getNullifierMembershipWitness("latest", …)`; `requiresInitialization` (`:192-195`) does the identical two calls and compares to `undefined`. The doc on `requiresInitialization` says it "reuses the same" check, but by copy, not by call; the first site additionally needs `initWitness` only as a boolean.

**Why it harms future change:** if the anchor changes from `"latest"` (for example to a checkpointed block) one copy will be missed on an account-freeze-adjacent path.

**Smallest safe refactoring:** Replace Inline Code with Function Call: `const needsInit = await this.requiresInitialization(node)` in `buildTxExecutionRequest`.

**What disappears:** 3 lines, one duplicated anchor literal.

**Instances:** `packages/aztec-runtime/src/account/nulo-account.ts:172-174`, `:192-195`.

## Non-findings considered

- PXE method surface enumerated in `spec.ts` `Methods`, `descriptors.ts` (26 rows), `service.ts` `defineRpcMethods` (26 names), `client.ts` (26 wrappers), `ipxe.ts` (18 signatures): Shotgun-Surgery-shaped, but every link is compile-pinned (`_TableMatchesMethods`, `_IPXEMatchesTable`, `definePassthroughsExhaustive`-style exhaustiveness on `defineRpcMethods`, proxy curry assert) and the service allowlist is documented as a deliberate hand-written trust boundary; drift fails the build, not production. Six void `client.ts` wrappers could use `definePassthroughs`, too small to report.
- `public-events.ts` interface + zod schema pairs (`PublicTransferEvent`/`PublicTransferEventSchema`, etc.): duplicated shape, but each schema is `satisfies z.ZodType<Interface>`, so drift is a compile error.
- `method-descriptors.ts` six `derive*` functions and pre-computed tables (many consumed only by tests): thin derivations over one registry, the documented single-source design; the barrel breadth is over-export, not duplication.
- `assertAuthRelevantArgShape` vs `argSchema` guards vs the `check*` scope checkers each validating `exec.calls`: layered on purpose per the registry docs (pinned error strings owned by the checker); kept out because merging risks changing dApp-visible messages.
- `wallet-sdk-schema-patch`: four `(schema, is*Shape, signature string)` triples restate each schema's structure twice, but the predicates exist to detect upstream zod-internals drift, which a derived check could not do; 131 LOC.
- `AztecNodeFactoryAdapter`: four repeated `isAllowedRpcUrl` + throw preludes (3 lines each, different message prefixes): below the reporting threshold.
- `third-party-notices` `readManifest` vs `readNestedManifest`, `resolve-asset` two `startsWith(root + sep)` containment checks: near-identical, but the error semantics differ deliberately (throw vs `incomplete`; resolved vs realpath root).
- `legal/src`: no semantic duplicates in the repo (`parseVersion` is the only semver parser; `parseVersionHistory`/`hasPlaceholders` are consumed by landing scripts and tests, so not dead).
- `fee-juice.ts` `predictedWorstMinFees` re-implementing upstream `BaseWallet.getMinFees`: documented and intentionally different (independent DA/L2 maxima); `MIN_FEE_PADDING` has one production use (`completeFeeOptions`). The fee-juice address is derived via `AztecAddress.fromNumberUnsafe(FEE_JUICE_ADDRESS)` in three extension files plus a hex literal in `fee-payer.ts` ("pinned by test"); `fee-juice.ts` loads the artifact at init so it cannot be shared with the others, so left alone.
- `AddressDisplay`, `@nulo/design`: out of this cluster (packages-high design file).
- Async memo-with-retry idiom: the prior Q-04 duplication is fixed (`async-memo.ts` adopted by 6 call sites); purge-epoch fence now goes through `PxeLifecycleCoordinator`; `action.ts`/`authwit-content.ts` cycle fixed via `call-shapes.ts`. Skipped as fixed.
- `field-address.ts` regex vs `transfer-intent.ts:77`, `usePinnedTokens.ts:13`, `send-submit.ts:11` (each `{64}` hex check): similar token, different validity contracts (case-insensitive + field-modulus bound vs lower-case only vs tx-hash), not one rule.

## Incidental bugs noticed (for the bugs run)

- `packages/wallet-bridge/src/dispatcher.ts:1072-1090` — `handleBatch` refuses only `sendTx` and `registerToken`, but `grantPublicAuthwit` (Nulo-custom, popup-routed through `dappInteractionService.execute`, `:1263-1305`) is also popup-gated; a raw protocol client (bypassing the SDK's Zod batch schema, which the comment itself says is the only other barrier) sending `batch([{name:"grantPublicAuthwit", args:[…]}])` opens an approval popup inside the batch leg, the exact situation the ban comment says it closes. Low severity (the popup still gates the grant).
- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:143` — session address set is built from ALL `dapp.accounts` CAIP entries without the chain-prefix filter the dispatcher applies (`dispatcher.ts:1730-1736`); counter-example: a session row holding an entry `aztec:<other-chain>:0xA` alongside `aztec:<this-chain>:0xB`, request with `opts.from = 0xA` resolves to 0xA for the journal record but the dispatcher rejects it as not authorized, leaving a queued record filed under an account the send never goes out as. Needs confirmation that a session row can hold cross-chain entries (rows are keyed per origin+chain, so likely unreachable; low confidence).

## Cross-rebuttal (claude on codex)

**1. Codex findings**
- X-1 (scope matching duplicated): agree; same as C-1. Codex's caveat is right (keep enforcement's empty-function-name rejection, `method-scope-checkers.ts:45-54`, and requested-wildcard rules out of the shared predicate).
- X-2 (artifact-catalog triple inventory): partially agree. Verified at `artifact-catalog.ts:35-47/58-71/74-87`. The `Record<CatalogKey, ...>` already forces the table to match the union, so only the enumeration can drift (silently omitting a key). That is a real but small, single-file gain (about 25 lines, no cross-module reach); I would rank it below C-1 through C-6. Deriving from `Object.keys` must keep the documented "known-artifact resolution order" (insertion order does this).
- X-3 (cursor comparator duplicated): agree, and Claude missed it. `public-events.ts:192-197` and `public-event-indexer.ts:50-55` are byte-identical bodies, and the extension copy is even exported. The fix (a leaf module in aztec-runtime) is correct.
- X-4 (dispatcher owns capability policy): agree; same as C-8. Codex's "Divergent Change" label fits better than Claude's line-count framing.
- X-5 (ArtifactRegistry speculative policy): agree; same as C-7. Codex's source check matches: no production `setPolicy`/`getPolicy`, only test calls at `artifact-registry.test.ts:104,123`. Codex's scope is narrower: it omits `hasKnownClassId`/`clear()`, the empty `onActiveProfileChanged` subscription (`service.ts:221`, `:1022-1030`) and the dead `RpcRequest` (`method-descriptors.ts:376-379`). Those extra dead items still stand.
- Codex's watch-rebuild bug in `third-party-notices/src/plugin.ts` is plausible from the description. I did not read `plugin.ts` in depth, so I can neither confirm nor dispute it.

**2. What Codex missed that Claude found (still stands)**
- C-2: the sendTx acting-account derivation exists independently in wallet-bridge and the extension. Codex only checked `resolveNetworkAndAccount` and the permission-UI helpers, not this pair.
- C-3: the popup-routed handler scaffold is repeated, with routing and the batch-ban outside the registry.
- C-4: legacy-IndexedDB deletion is hand-wrapped three ways, and the "keyval-store only when no PXE DB remains" rule is written twice in `PxeService`.
- C-5: the composite chain-id formula `(l1ChainId ^ rollupVersion) >>> 0` is written four times and the named helper sits in the wrong layer. This is a cross-layer value that must match exactly, so it is the highest-risk item Codex missed.
- C-6: the inclusion-safe base fee times priority multiplier is recomputed at five sites.
- C-9: `isRecord` is re-implemented eight times. Codex's non-finding argues legal parsing needs a stricter predicate. That covers at most the legal variant (the "ninth near-variant"), not the other eight.
- C-10: the init-nullifier existence check is duplicated inside `NuloAccount`.

**3. What both missed**
- No new item with file:line evidence that I can stand behind. I did not re-sweep source beyond verifying Codex's X-2 and X-3. The unread frozen and policy surfaces (`account-export.ts`, `address-freeze.ts`, `third-party-notices/{generate,policy}.ts`) remain unexamined by Claude, and I saw no sign Codex looked at them for duplication either.
