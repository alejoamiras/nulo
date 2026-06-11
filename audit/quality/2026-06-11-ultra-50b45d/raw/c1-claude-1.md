# C1 — execution service — Claude instance 1

Scope audited: `packages/extension/src/wallet/services/execution/**` (facade + extracted collaborators + fee/ + helpers/ + models/ + spec/client; tests scanned for harness duplication only). All map claims verified against source.

## F1: The journal/cancel/prove/submit pipeline is duplicated four times in the facade — and the coordinator's doc comment claims an extraction that was never made

1. **Title:** Send-pipeline scaffolding duplicated ×4 in `ExecutionService`; `ExecutionCoordinator` documents a `proveAndSend` that does not exist.

2. **Smell name:** Duplicate Code (Fowler, Dispensables), with a side of Comments-as-deodorant (the coordinator's header advertises the missing extraction). The missing refactoring is Form Template Method.

3. **Impact bucket:** structural. Blast radius: 2 files (`service.ts`, `execution-coordinator.ts`), ~250 duplicated lines across the 4 pipelines. Change frequency: `service.ts` is the hottest file in wallet services — 9 commits in the last 3 months (top of the hotspot list); 3 of the 4 pipeline copies were touched by the recent cancel-semantics and V-01 arcs.

4. **Concrete evidence:** Four methods repeat the same skeleton — create/claim journal record → register AbortController in `activeControllers` → define a local `checkCancelled` closure → mark `simulating` → build → mark `proving` → `proveTxTask` → `checkCancelled` → `toTx` → mark `submitting` → `sendTxTask` → `addTransaction` (9 positional args) → mark `succeeded` → catch (sentinel rethrow vs mark `failed`) → finally (delete controller [+ release slot]):
   - `executeTransfer` — `packages/extension/src/wallet/services/execution/service.ts:405-610` (pipeline tail 548-609)
   - `executeSendTransaction` — `service.ts:1130-1213`
   - `executeAztecSendTx` — `service.ts:1860-2015` (tail 1973-2014)
   - `executeNoFromSendTx` — `service.ts:2022-2205` (tail 2160-2204)

   Sub-duplications inside the same root cause:
   - `checkCancelled` closure ×4: `service.ts:467-469`, `1161-1163`, `1925-1927`, `2072-2074` (identical 3 lines).
   - `executeTransfer` defines a local `markJournal` closure (`service.ts:452-459`) that is byte-equivalent to the private method `markJournal` (`service.ts:1401-1408`) used by the other three.
   - The authwit-discovery + `buildStandard`-adapter closure is duplicated between `estimateOperationFee` (`service.ts:891-900`) and `executeAztecSendTx` (`service.ts:1952-1963`).
   - The 9-arg `addTransaction` call repeated at `service.ts:567-596`, `1190-1200`, `1986-1996`, `2176-2186`.

   The codebase already names this duplication: `execution-coordinator.ts:15-19` says the coordinator owns "`proveAndSend` — the shared 'prove → toTx → send → addTransaction → mark journal submitted' sequence, called 4 times in the facade". `grep -rn proveAndSend` over the cluster returns only that comment — the method was never implemented; only the three thin task wrappers moved.

5. **Why it harms future change:** every change to the pipeline contract must be replicated 4×, and the recent history shows it being missed: the cancel-after-submit fix, the `simulating`-before-build ordering fix, and the slot-leak fix each had to be applied per-copy (the inline comments at `service.ts:1905`, `2052`, `1944` each say "mirrors the standard path" / "codex v3 engine-audit blocker" — i.e., a reviewer caught a copy that had drifted). Adding a new journal stage, changing the cancel checkpoint policy, or altering the `addTransaction` record shape currently means 4 edits + 4 manual consistency checks, with no facade-level test to catch a missed copy.

6. **Smallest safe refactoring:** Form Template Method / Extract Method — implement the documented `ExecutionCoordinator.proveAndSend(ctx)` covering mark-proving → prove → toTx → mark-submitting → send → addTransaction → mark-succeeded, parameterized by the two genuine variation points (offchain-output extraction, receipt-wait). Separately Extract Method for the controller-register/`checkCancelled`/finally-cleanup trio (e.g. `withCancellableJournal(journalId, fn)`). Inline `executeTransfer`'s local `markJournal` closure into a call to the existing method first (Inline Function) — that one is zero-risk.

7. **What disappears:** ~200 of the ~250 duplicated lines; the 4-way consistency obligation on every pipeline change; the lying coordinator doc comment; the class of "copy N didn't get the fix" bugs the audit arcs kept finding.

8. **Instances:** `service.ts:405-610`, `service.ts:1130-1213`, `service.ts:1860-2015`, `service.ts:2022-2205`, `service.ts:452-459` vs `service.ts:1401-1408`, `service.ts:467-469`/`1161-1163`/`1925-1927`/`2072-2074`, `service.ts:891-900` vs `service.ts:1952-1963`, `execution-coordinator.ts:15-19` (stale doc).

## F2: Two self-contained cache subsystems live inline in the 2302-line facade, untestable as units

1. **Title:** Estimate-reuse cache (~270 LOC) and gas-balance cache (~170 LOC) embedded in `ExecutionService` instead of extracted classes.

2. **Smell name:** Large Class + Divergent Change (Fowler, Bloaters / Change Preventers). The facade changes for unrelated reasons: send-pipeline semantics, fee-estimate caching policy, and balance-read caching policy all land in the same file.

3. **Impact bucket:** structural. Blast radius: 1 file directly, but it is the 2302-LOC hotspot (9 commits/3mo) and the map confirms **no `service.test.ts` exists** — the only tested fragments are the two exported fingerprint functions (`fingerprints.test.ts` imports `fingerprintBaseFee`/`fingerprintFeeSettings` from `service.ts`).

4. **Concrete evidence:**
   - Estimate-reuse subsystem: entry type `TransferEstimateReuseEntry` (`service.ts:154-190`), module-level fingerprint helpers (`service.ts:195-224`), TTL + map fields (`service.ts:295-296`), the 6-gate consume path `tryConsumeTransferEstimate` (`service.ts:619-715`), the write-side block inside `estimateTransferFee` (`service.ts:752-801`), and `evictStaleEstimateReuseEntries` (`service.ts:816-823`). That is a cohesive cache with its own invariants (single-shot consumption, TTL, 6 drift gates) spread across ~650 lines of facade.
   - Gas-balance subsystem: TTL cache + single-flight map fields (`service.ts:280-302`), invalidation listeners wired in `init` (`service.ts:382-402`), `getGasBalances` dedup shell (`service.ts:1476-1502`), `#computeGasBalances` (`service.ts:1504-1575`).
   - `grep -rn "tryConsumeTransferEstimate|estimateReuseCache" --include="*.test.ts"` over the cluster returns nothing: the gate logic (profile drift, endpoint drift, base-fee drift, pending-set drift, TTL) has zero unit coverage because exercising it requires instantiating the full 11-dependency facade.

5. **Why it harms future change:** any change to reuse-gate policy (e.g. the deferred "PXE rebuild detection" noted at `service.ts:705-706`) or cache-invalidation policy must be made inside the giant facade and can only be validated via network e2e. The repo's own house rule ("if a unit can't be unit-tested in isolation, it's too big") is violated by exactly these two subsystems — the rest of the execution dir was already decomposed into 12 tested helpers, making the residual facade bloat a maintained decision rather than an accident.

6. **Smallest safe refactoring:** Extract Class ×2 — `TransferEstimateReuseCache` (owning entry type, fingerprints, consume/write/evict; facade injects `profileService`/`networkService`/`transactionService` lookups as functions) and `GasBalanceReader` (cache + single-flight + invalidation hooks). Both are mechanical moves; the fingerprint functions are already pure exports.

7. **What disappears:** ~440 LOC from the facade; the "only testable through the full service" status of the 6 reuse gates and the single-flight logic; one of the two reasons `service.ts` keeps appearing at the top of the hotspot list.

8. **Instances:** `service.ts:154-224`, `service.ts:280-302`, `service.ts:295-296`, `service.ts:382-402`, `service.ts:619-715`, `service.ts:752-823`, `service.ts:1476-1575`.

## F3: Live-chain-identity rebind is re-implemented at every sink — adding a sink means remembering a 3-line ritual

1. **Title:** `getNodeInfo() → assertLiveChainIdentity(network, nodeInfo) → { chainId: new Fr(...), version: new Fr(...) }` duplicated across 8 sites in 5 files.

2. **Smell name:** Shotgun Surgery (Fowler, Change Preventers) + Duplicate Code. One conceptual operation ("give me asserted ChainInfo for this network's live node") is scattered, so a policy change touches N files.

3. **Impact bucket:** structural. Blast radius: 5 files, 8 assert sites + 9 ChainInfo-literal constructions. Change frequency: directly evidenced — the two most recent commits on this branch are `fix(execution): assertLiveChainIdentity at all sink sites (V-01)` and `fix(execution): rebind chain identity at NO_FROM + getChainInfo`, i.e. the same cross-cutting edit had to be applied sink-by-sink, twice, because no shared helper exists.

4. **Concrete evidence:** assert sites (grep-verified): `tx-request-builder.ts:112`, `tx-request-builder.ts:456`, `service.ts:1651`, `service.ts:2136`, `service.ts:2219`, `authwit-discoverer.ts:108`, `fast-path.ts:179`, `helpers/batched-view-simulation.ts:248`. ChainInfo literal `{ chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }` constructed at `service.ts:1652`, `service.ts:2137`, `service.ts:2220-2223`, `authwit-discoverer.ts:109`, `authwit-discoverer.ts:168-172`, `authwit-discoverer.ts:239-243`, `authwit-discoverer.ts:253-257`, `fast-path.ts:180-183`, `helpers/batched-view-simulation.ts:249-252`. Note the temporal-coupling variant: `authwit-discoverer.ts` message-hash methods (`:168`, `:239`, `:253`) consume a caller-passed `nodeInfo` whose assertion happened in a *different file* (`tx-request-builder.ts:112`) — the invariant "nodeInfo has been asserted" is enforced by convention, not by type or construction.

5. **Why it harms future change:** every new code path that derives chain identity from a live node must independently remember the assert — the V-01 commit history proves that paths get missed (NO_FROM and getChainInfo were retro-fitted). If the assertion's signature or policy changes (e.g. adding rollup-version tolerance), 8 sites change. The audited-by-convention `nodeInfo` parameter handoff means a future caller of `computeCallMessageHash` can silently skip the assert.

6. **Smallest safe refactoring:** Extract Function — `resolveLiveChainInfo(network, node): Promise<ChainInfo>` (does getNodeInfo + assert + construct) in `helpers/` or `@nulo/aztec-runtime/utils` next to `assertLiveChainIdentity`. Sites that need raw `nodeInfo` too can use a variant returning both. Optionally wrap the result in a branded `AssertedChainInfo` type so message-hash helpers demand proof-of-assert at compile time (Introduce Parameter Object analog).

7. **What disappears:** 8 copies of the ritual; the "did you remember the assert?" review burden on every new sink; the cross-file temporal coupling in `authwit-discoverer.ts`.

8. **Instances:** `tx-request-builder.ts:107-112`, `tx-request-builder.ts:453-463`, `service.ts:1646-1652`, `service.ts:2132-2137`, `service.ts:2216-2223`, `authwit-discoverer.ts:105-109`, `authwit-discoverer.ts:168-172`, `authwit-discoverer.ts:239-243`, `authwit-discoverer.ts:253-257`, `fast-path.ts:176-183`, `helpers/batched-view-simulation.ts:244-252`.

## F4: 8-positional-tuple and 7-positional-tuple return shapes force `_`-placeholder destructuring and numeric indexing at every consumer

1. **Title:** `FeeEstimateResult` (8-tuple) and `StandardTxRequestResult`/`NoFromTxRequestResult` (7-/6-tuple) instead of named-field objects.

2. **Smell name:** Data Clumps + Primitive Obsession (Fowler, Bloaters) applied to return values — the same 7-8 values always travel together positionally; consumers must know index semantics by heart.

3. **Impact bucket:** structural. Blast radius: 8 files — `fee/fee-strategy.ts` (type), all 4 strategy impls, `tx-request-builder.ts`, `service.ts` (6 consume sites), plus `authwit-discoverer.ts`'s adapter shape. Change frequency: `fee-strategy.ts` 2 commits/3mo, `service.ts` 9.

4. **Concrete evidence:**
   - `fee/fee-strategy.ts:72-81` defines the 8-tuple; its own doc comment (`:17-24`) concedes the shape is "minimal-diff... preserved verbatim" and defers the typed bundle to "when [the coordinator] owns the post-send flush point".
   - `tx-request-builder.ts:69-70` defines the 7- and 6-tuples; the file header (`:34-40`) documents "Return-shape parity" as a frozen constraint.
   - Consumer damage: `service.ts:539-545` reads `built[0]`, `built[1]`…`built[7]` by raw index (skipping `built[6]`); `service.ts:739-742` destructures `[txRequest, _node, _pxe, _account, network, nonce, _txCalls, feePaymentMethod]` (4 throwaway placeholders); `service.ts:903` takes `[txRequest]` and discards 7 positions; `fee/fpc-strategy.ts:47-68` re-destructures all 7 names twice with a `let` + leading-semicolon re-assignment; `service.ts:1411` uses `[txRequest, _, pxe, account]`.

5. **Why it harms future change:** adding one field (e.g. the offchain-output timestamp both aztec send paths currently recompute) means re-signing 4 strategies + 2 builders and re-counting positions at ~10 destructure sites; misordering two same-typed positions (`node`/`pxe`, `nonce`/`txCalls`) compiles fine and fails at runtime. The `built[7]`-style indexing in `executeTransfer` is exactly the read that silently breaks when a position shifts.

6. **Smallest safe refactoring:** Replace tuple with object (Fowler: Introduce Parameter Object, applied to the return) — `type BuiltTx = { txRequest; node; pxe; account; network; nonce; txCalls; feePaymentMethod }`. Mechanical: each `return [a,b,c…]` becomes `return {a,b,c…}`; destructures become named picks (and the `_`-placeholders simply disappear). No call-ordering or behavior change.

7. **What disappears:** positional-index knowledge at 10+ sites; the 4 throwaway `_` bindings; the `built[N]` magic numbers; the compile-silent transposition hazard; the apology comments in both file headers.

8. **Instances:** `fee/fee-strategy.ts:72-81`, `tx-request-builder.ts:69-70`, `tx-request-builder.ts:373`, `tx-request-builder.ts:477`, `service.ts:538-545`, `service.ts:739-742`, `service.ts:903`, `service.ts:1173-1177`, `service.ts:1411`, `service.ts:1967-1971`, `service.ts:2081`, `fee/fee-juice-strategy.ts:20-34`, `fee/fee-juice-with-claim-strategy.ts:28-42`, `fee/fpc-strategy.ts:47-85`, `fee/embedded-strategy.ts:35-51`.

## F5: The 7-field transfer-request clump rides through 8 signatures

1. **Title:** `(networkId, accountAddress, tokenId, transferType, recipientAddress, amount, feeSettings)` repeated as loose positional parameters across spec, client, service, and planner.

2. **Smell name:** Data Clump + Long Parameter List (Fowler, Bloaters).

3. **Impact bucket:** structural. Blast radius: 5 in-cluster files plus every popup caller of `executeTransfer`/`estimateTransferFee` (the clump crosses the RPC wire). Change frequency: this surface gained a parameter recently (`precomputedEstimateId`, making `executeTransfer` 8 positional params) — i.e., the clump is actively growing.

4. **Concrete evidence:** the identical ordered field list appears in: `spec.ts:18-27` (`Methods.executeTransfer`), `spec.ts:48-56` (`Methods.estimateTransferFee`), `client.ts:22-43`, `client.ts:53-63`, `service.ts:405-414`, `service.ts:717-725`, `operation-planner.ts:71-79` (`buildTransferOperation`), `service.ts:620-629` (`tryConsumeTransferEstimate`'s `inputs` object — the one place it already congealed into an object), and `service.ts:154-162` (`TransferEstimateReuseEntry`'s leading fields). The clump is also re-spread at call sites `service.ts:476-485`, `525-533`, `729-737`.

5. **Why it harms future change:** adding the next transfer attribute (a memo, a deadline, a token-version) requires editing 8 signatures + N call sites in lockstep, across an RPC boundary where positional drift between client and service does not type-fail (both sides change together or the wire call misbinds). Two same-typed adjacent strings (`accountAddress`, `recipientAddress`) are a standing transposition hazard at every call site.

6. **Smallest safe refactoring:** Introduce Parameter Object — `TransferRequest` in `models/` (`{ networkId, accountAddress, tokenId, transferType, recipientAddress, amount, feeSettings }`), accepted by both RPC methods and `buildTransferOperation`; `tryConsumeTransferEstimate.inputs` already demonstrates the shape. Wire compatibility is a single-arg object instead of 7 positionals — both ends in the same PR.

7. **What disappears:** 8-way signature lockstep; the transposition hazard; the duplicate field-by-field comparison block in `tryConsumeTransferEstimate` (`service.ts:642-653`) can become a single fingerprint of the object.

8. **Instances:** `spec.ts:18-27`, `spec.ts:48-56`, `client.ts:22-43`, `client.ts:53-63`, `service.ts:405-414`, `service.ts:620-629`, `service.ts:717-725`, `operation-planner.ts:71-79`, `service.ts:154-162`.

## F6: `ContractResolver` extraction stopped halfway — artifact-function lookup and ensure-registered loops are still copy-pasted around it

1. **Title:** Function-lookup (by name ×4, by selector ×3) and the register-unknown-contracts loop (×4) duplicated across the files that already share `ContractResolver`.

2. **Smell name:** Duplicate Code (Fowler). `contract-resolver.ts:2-4` states its purpose is to "consolidate contract-instance + artifact resolution logic that would otherwise be duplicated" — the consolidation is incomplete.

3. **Impact bucket:** structural. Blast radius: 4 files. Change frequency: `batched-view-simulation.ts` 3 commits/3mo, `tx-request-builder.ts` 2.

4. **Concrete evidence:**
   - Find-by-name (`artifact.functions.find(name) ?? artifact.nonDispatchPublicFunctions.find(name)`): `tx-request-builder.ts:279-281`, `authwit-discoverer.ts:149-151`, `service.ts:1445-1446`, and `helpers/batched-view-simulation.ts:577-579` (`findFunctionByName` — already extracted, but module-private).
   - Find-by-selector (double loop computing `FunctionSelector.fromNameAndParameters` over both arrays): `tx-request-builder.ts:315-334`, `authwit-discoverer.ts:201-217`, `helpers/batched-view-simulation.ts:581-591` (`findFunctionBySelector` — same private-helper situation).
   - Ensure-registered loop (`pxe.getContracts() → Set → for each unregistered instance → pxe.registerContract({instance, artifact})`): `tx-request-builder.ts:117-126`, `tx-request-builder.ts:412-424`, `helpers/batched-view-simulation.ts:183-192`, and the single-contract variant `service.ts:1434-1440` — which additionally calls `resolveInstance`+`resolveArtifact` twice back-to-back (`service.ts:1436-1437` then `1442-1443`).
   - All three error strings ("Contract not found" / "Contract artifact not found" / "Method not found") are documented as frozen contract in three different file headers (`tx-request-builder.ts:20-22`, `contract-resolver.ts:14-21`, `batched-view-simulation.ts:58-59`) — the same frozen strings maintained in triplicate.

5. **Why it harms future change:** the lookup rule ("search `functions`, then `nonDispatchPublicFunctions`") is a single upstream-driven policy; when upstream adds a third function bucket or changes selector derivation, 7 sites need the same edit and the three frozen-error-string contracts need re-verifying in three places. `batched-view-simulation.ts` already paid the extraction cost — the helpers just weren't shared.

6. **Smallest safe refactoring:** Move Function — promote `findFunctionByName`/`findFunctionBySelector` from `batched-view-simulation.ts` into `ContractResolver` (or a sibling `artifact-lookup.ts`), and Extract Method `ContractResolver.ensureRegistered(pxe, instances, artifacts)` for the loop. Error strings stay verbatim (they already match across copies).

7. **What disappears:** 6 redundant copies of the lookup policy; 3 copies of the registration loop; the triple-maintained frozen-string documentation; the consecutive double-resolve in `executeSimulateUtility`.

8. **Instances:** `tx-request-builder.ts:117-126`, `tx-request-builder.ts:279-281`, `tx-request-builder.ts:315-334`, `tx-request-builder.ts:412-424`, `authwit-discoverer.ts:149-151`, `authwit-discoverer.ts:201-217`, `service.ts:1434-1446`, `helpers/batched-view-simulation.ts:183-192`, `helpers/batched-view-simulation.ts:577-591`.

## F7: The profile→network→account→node→PXE context preamble is re-inlined at 8 sites even though `getViewSimulationDeps` already extracts it — and the copies have drifted ("Unauthorized" vs "Wallet locked")

1. **Title:** Execution-context resolution preamble duplicated across facade handlers and builders; one copy throws a different error string.

2. **Smell name:** Duplicate Code (Fowler) with observable drift; the drift is the early symptom of Shotgun Surgery on any future change to context resolution.

3. **Impact bucket:** structural. Blast radius: 4 files, 9 sites. Change frequency: `service.ts` 9 commits/3mo; `get-view-simulation-deps.ts` 2.

4. **Concrete evidence:** the sequence `getActiveProfile → throw on missing → getNetwork(networkId) → getAccountContract(profile.id, chainId, address) [→ getNode → getPXE(networkInfoFrom(network))]` appears at:
   - `helpers/get-view-simulation-deps.ts:32-39` — the canonical extraction (used by only 2 callers)
   - `service.ts:518-523` (executeTransfer reuse branch), `service.ts:1425-1432` (executeSimulateUtility), `service.ts:1738-1746` (executeAztecSimulateTx), `service.ts:1830-1836` (executeAztecExecuteUtility), `service.ts:2208-2215` (executeAztecCreateAuthWit)
   - `tx-request-builder.ts:98-105` (buildStandard), `tx-request-builder.ts:391-397` (buildNoFrom)
   - partial variants: `service.ts:1262-1265` (resolveExecutionMutexKey), `operation-planner.ts:80-83`.

   Drift evidence (grep-verified): the no-profile guard throws `"Wallet locked"` at 8 sites but `"Unauthorized"` at `operation-planner.ts:82` — and `operation-planner.ts:9-10` has to document the divergent string as a frozen quirk. `tryConsumeTransferEstimate`'s consume path and the cache-write path each re-resolve profile/network/node again (`service.ts:659-682`, `768-770`) because there is no shared context object to pass down.

5. **Why it harms future change:** a change to context resolution (e.g. scoping account lookup by a new key, adding a lock-state check, standardizing the user-facing locked error) means hunting 9 inline copies; the two different error strings already mean popup error-handling must match both. New handlers keep being written by copying a neighbor (the 5 facade copies are not historical residue — `executeAztecCreateAuthWit` and the reuse branch are recent code).

6. **Smallest safe refactoring:** Move Function + rename — generalize `getViewSimulationDeps` into `resolveExecutionContext(services, networkId, accountAddress)` (it already returns exactly the needed bundle) and call it from the 7 full-sequence sites. Keep `operation-planner.ts`'s `"Unauthorized"` string by passing the error factory or keeping its guard local (the string is pinned).

7. **What disappears:** 7 inline copies (~6 lines each); the future possibility of a third error-string variant; repeated profile/network re-resolution inside single logical operations.

8. **Instances:** `helpers/get-view-simulation-deps.ts:32-39`, `service.ts:518-523`, `service.ts:1262-1265`, `service.ts:1425-1432`, `service.ts:1738-1746`, `service.ts:1830-1836`, `service.ts:2208-2215`, `tx-request-builder.ts:98-105`, `tx-request-builder.ts:391-397`, `operation-planner.ts:80-83`.

## F8: The task execute-around wrapper (`startSubtask|startNewTask` → try → `complete()` → catch `fail()`+rethrow) is hand-rolled 9 times

1. **Title:** TaskService lifecycle wrapping duplicated across builders, coordinator, and all four fee strategies.

2. **Smell name:** Duplicate Code (Fowler); the missing refactoring is the classic "execute-around method" (a named analog of Extract Method for resource-bracketing — see Beck/Fowler's Execute Around Method pattern).

3. **Impact bucket:** local (each instance is small and within one function), but with 9 instances across 6 files. Change frequency: fee strategies 1-2 commits/3mo each.

4. **Concrete evidence:** the exact bracket `const task = parentTask ? parentTask.startSubtask(step) : tasks.startNewTask(step); try { …; task.complete(); return r } catch (error) { task.fail(error); throw error }` appears at: `tx-request-builder.ts:94-96/372-377`, `tx-request-builder.ts:386-388/476-481`, `execution-coordinator.ts:57-66`, `execution-coordinator.ts:76-86`, `execution-coordinator.ts:89-99`, `fee/fee-juice-strategy.ts:18-38`, `fee/fee-juice-with-claim-strategy.ts:25-46`, `fee/fpc-strategy.ts:43-89`, `fee/embedded-strategy.ts:32-55`. Half of the bracket is already extracted (`startEstimateTask`, `fee/fee-strategy.ts:199-202`) — the try/complete/fail half was not.

5. **Why it harms future change:** any change to task-failure semantics (e.g. distinguishing `cancel()` from `fail()` at these inner layers, the exact symmetry `rpc-cancel.ts:57-60` calls "load-bearing") requires 9 coordinated edits; a missed copy produces the mismatched-task-state UX bug that file warns about.

6. **Smallest safe refactoring:** Extract Method — `withTaskStep<T>(tasks, label, parentTask, fn: (task) => Promise<T>): Promise<T>` next to `startEstimateTask`; each instance collapses to one call.

7. **What disappears:** ~80 lines of try/catch boilerplate; the 9-way consistency obligation on complete/fail semantics.

8. **Instances:** `tx-request-builder.ts:94-96`, `tx-request-builder.ts:372-377`, `tx-request-builder.ts:386-388`, `tx-request-builder.ts:476-481`, `execution-coordinator.ts:57-66`, `execution-coordinator.ts:76-86`, `execution-coordinator.ts:89-99`, `fee/fee-juice-strategy.ts:18-38`, `fee/fee-juice-with-claim-strategy.ts:25-46`, `fee/fpc-strategy.ts:43-89`, `fee/embedded-strategy.ts:32-55`.

## F9: Primary-method extraction exists in four shapes — two of which skip the fee-method filter the shared helper exists to enforce

1. **Title:** `pickActionMethod` (facade), `OperationPlanner.extractPrimaryMethod`, and two inline `exec.calls.find(c => c?.name)?.name` one-liners all derive "the primary method" independently.

2. **Smell name:** Duplicate Code with drift (Fowler); borderline Feature Envy — the facade copies envy the action/call data that `OperationPlanner` already owns the projection for.

3. **Impact bucket:** local. Blast radius: 2 files, 4 sites. Change frequency: both files touched in the last 3 months.

4. **Concrete evidence:**
   - `service.ts:141-148` (`pickActionMethod`) is byte-equivalent to the first branch of `operation-planner.ts:241-248` (`extractPrimaryMethod`) — same loop, same carrier projection, same `pickPrimaryMethod` call. The justifying comment (`service.ts:138-140`) explains why it can't live in `primary-method.ts` (layering), but not why it can't reuse the planner, which is in the same package, already imported, and already instantiated on the facade.
   - `service.ts:1914` and `service.ts:2061` use a third shape: `(Array.isArray(op.exec?.calls) ? op.exec.calls.find((c) => c?.name)?.name : undefined)` — unlike `extractPrimaryMethod`'s exec branch (`operation-planner.ts:249-254`), this takes the first *named* call without routing through `pickPrimaryMethod`, i.e. without the `FEE_METHODS` filter. `packages/extension/src/utils/primary-method.ts:2-6` explicitly warns that journal-title sites "must filter these out — otherwise the popup shows 'Sponsored unconditionally'… while a tx is proving". The duplicated inline copies are exactly such journal-title sites.

5. **Why it harms future change:** the projection rule (which call is "primary", which methods are wallet noise) is one policy; today it must be updated in 4 places with 2 already diverged. Anyone extending `FEE_METHODS` will fix the planner path and silently miss the two inline journal-title sites.

6. **Smallest safe refactoring:** Inline Function on `pickActionMethod` (replace with `this.planner.extractPrimaryMethod(op)`), and Replace Inline Code with Function Call at `service.ts:1914`/`2061` (use `extractPrimaryMethod`, which already handles the exec-calls shape).

7. **What disappears:** 3 redundant projections; the fee-filter drift; the layering-apology comment.

8. **Instances:** `service.ts:136-148`, `service.ts:1151`, `service.ts:1914`, `service.ts:2061`, `operation-planner.ts:240-256`.

## F10: Comments anchored to transient audit transcripts and plan milestones throughout the cluster

1. **Title:** ~30 comments reference codex/opus review rounds, plan branches, and milestone tags that future readers cannot resolve.

2. **Smell name:** Comments (Fowler, Dispensables) — specifically comments whose referent is outside the repo and decaying; also a direct violation of the house rule in CLAUDE.md ("No milestone, plan, PR, phase, or stage tags", with only `AUDIT [A-Z]\d+`-style security markers sanctioned — the `F-012 / A-01 V-01` markers are fine and are NOT flagged here).

3. **Impact bucket:** cosmetic. Blast radius: 6 files. Change frequency: high — these comments sit inside the hottest file and get copied along with the pipeline duplication (F1).

4. **Concrete evidence (grep-verified):** `service.ts:153` ("see plan-v4 Branch 5"), `:164`/`:176`/`:658`/`:665`/`:681`/`:705` ("codex audit NICE-TO-HAVE #2 / SHOULD-FIX #2/#3"), `:270` ("codex final-pass FC6"), `:289`/`:747` ("plan-v4 Branch 5"), `:304`/`:423`/`:436`/`:461`/`:826`/`:2056` ("Phase 2", "Phase 2 follow-up v4"), `:850` ("codex-W1W2-review fix"), `:1087` ("Opus F4"), `:1145` ("(M1.1)"), `:1905`/`:1944`/`:2052` ("codex v3 engine-audit blocker"), `:1928`/`:2075` ("opus post-impl F2"); `claim-helper.ts:6` ("codex rounds 3-5"), `:22` ("codex R5"), `:162` ("opus post-impl F5"); `spec.ts:66`/`:78` ("Phase 2", "codex W2 review"); `fee/embedded-fpc-cap.ts:60` ("pre-PR-74 audits"); `helpers/batched-view-simulation.ts:7` ("retired in #56"), `:229` ("codex H2"); and `fast-path.ts:220` ships `"[PR 8c]"` inside a **runtime log string**, not even a comment.

5. **Why it harms future change:** the rationale these tags point at lives in chat transcripts and per-session audit files that aren't addressable from the code; a maintainer reading "codex v3 engine-audit blocker" gets a citation instead of a reason and must either trust it blindly or re-derive the invariant. The substantive invariant text around them is good — the tags are pure decay. The `[PR 8c]` log prefix will outlive PR 8c in user-facing diagnostics.

6. **Smallest safe refactoring:** Rewrite Comment (deodorant removal): keep the invariant sentence, delete the transcript citation; where the rationale only exists in the transcript, move one summarizing sentence into the comment. Drop `[PR 8c]` from the log string. Zero behavior change.

7. **What disappears:** ~30 dead references; the precedent that causes new code to keep citing review rounds (the newest pipeline copies already inherited the habit).

8. **Instances:** `service.ts:153,164,176,270,289,304,423,436,461,658,665,681,705,747,826,850,1087,1145,1905,1928,1944,2052,2056,2075`, `claim-helper.ts:6,22,162`, `spec.ts:66,78`, `fee/embedded-fpc-cap.ts:60`, `helpers/batched-view-simulation.ts:7,229`, `fast-path.ts:220`.

## Non-findings

- **`executeOperations` 22-case switch (`service.ts:936-1014`)** — considered Switch Statements; rejected: discriminated-union dispatch where each case is a single delegation is idiomatic TS, preserves exhaustiveness narrowing, and a handler map would trade that away for no duplication win.
- **spec/service/client triple** — house convention, excluded by prompt; the duplication cost it does carry is covered concretely under F5 (transfer clump) only.
- **`FpcStrategy` mutate-unshift-splice sequence (`fee/fpc-strategy.ts:62-82`)** — considered; rejected: explicitly documented as load-bearing byte-parity with the pre-strategy pipeline; refactoring it is a behavior-verification task, not a safe cleanup.
- **`ExecutionMutex` as a bespoke primitive** — considered Reinvented Wheel vs `@nulo/wallet-core` `Lock`; rejected: the header documents a real requirement difference (no force-release timeout) that the shared Lock cannot satisfy.
- **`resolveArtifacts` no-op filter (`contract-resolver.ts:118`)** — `.filter((x) => !artifacts.has(...))` can never exclude anything (`artifacts` is empty at that point); genuine micro dead-code but a one-line deletion below findings threshold.
- **Unused `_logger` ctor deps (`execution-coordinator.ts:46`, `authwit-discoverer.ts:65`)** — dead fields (grep: no `this._logger` reads); trivial.
- **`additionalScopes = Array.isArray(op.opts.additionalScopes) ? … : []` ×4 (`service.ts:1809,1852,1975,2107`)** — micro-duplication; one-line helper, below threshold on its own (absorbed if F1 lands).
- **Per-test `makeDeps` harnesses (claim-helper/fast-path/bvs tests)** — considered harness duplication; rejected: each builds genuinely different dependency shapes; no shared-fixture extraction would pay for itself.
- **`coerceAmount` boundary shim** — considered Primitive Obsession at the wire; rejected: single well-documented helper already extracted with tests.
- **fj/fjwc/embedded strategy skeleton similarity beyond the task wrapper** — considered Form Template Method; rejected as a standalone finding: the residual difference per strategy (payment enum, payload injection, gas cap, multiplier) is the legitimate variation the Strategy pattern exists for; the truly mechanical shared part is exactly F8's wrapper.

## Out-of-scope observations

- The inline primary-method picks at `service.ts:1914`/`2061` skip the `FEE_METHODS` filter — possible wrong in-flight journal title when a dApp payload leads with a fee call (correctness, not flagged; duplication aspect covered in F9).
- `claim-helper.ts:155-162` self-describes its controller-registration ordering as "correctness-by-microtask-interleaving... fragile against future refactors" — concurrency-correctness risk, out of scope.
- `executeSimulateUtility` resolves the same instance+artifact twice in a row (`service.ts:1436-1443`) — redundant PXE round-trips (performance); the code-shape aspect is in F6.
- `#computeGasBalances` logs each failure twice back-to-back (`service.ts:1540-1541`, `1567-1568`) — log noise, trivial.
