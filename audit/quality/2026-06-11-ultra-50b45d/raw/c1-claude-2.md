# C1 — execution service — Claude instance 2

Scope audited: `packages/extension/src/wallet/services/execution/**` (facade + extracted collaborators + fee/ + helpers/ + models/ + spec/client). Map ref `raw/repo-map/extension-wallet.md` §5 — verified against source: facade is 2302 LOC with 11 service refs + 6 collaborators; the four >100-line methods exist as claimed; no `service.test.ts` for the facade; service.ts is the repo's #1 hotspot (9 changes in 3 months).

## F1: Journaled send pipeline duplicated across four execute methods — the collaborator that was supposed to own it documents a method that does not exist

1. **Title:** Four near-identical journal/cancel/prove/submit pipelines in the facade; `ExecutionCoordinator`'s doc promises a shared `proveAndSend` that was never implemented.

2. **Smell name:** Duplicate Code + Long Method (Fowler bloaters/dispensables), compounded by a misleading comment (doc drift). `execution-coordinator.ts:17-19` says the class owns "`proveAndSend` — the shared 'prove → toTx → send → addTransaction → mark journal submitted' sequence, called 4 times in the facade with minor op-specific variation" — `grep -rn proveAndSend packages/` returns only that comment. The class has only the three task wrappers.

3. **Impact bucket:** structural. Blast radius: 1 file, but it is `service.ts` — the most-changed file in the repo (9 changes/3mo per git log; map §8 agrees). Every cancel-semantics, journal-FSM, or stage-ordering change must be applied 4× (the recent durable-jobs + cancel arcs did exactly this; the V-01 arc touched 3 of the 4 paths).

4. **Concrete evidence:** the shared skeleton (markJournal(simulating) → checkCancelled → build → markJournal(proving) → proveTxTask → checkCancelled → toTx → markJournal(submitting) → checkCancelled → sendTxTask → addTransaction → markJournal(succeeded); catch: sentinel-rethrow + markJournal(failed); finally: controller cleanup [+ releaseSlot]) appears in:
   - `executeTransfer` service.ts:405-610 (~205 lines)
   - `executeSendTransaction` service.ts:1130-1213
   - `executeAztecSendTx` service.ts:1860-2015 (~155 lines)
   - `executeNoFromSendTx` service.ts:2022-2205 (~183 lines)
   Verbatim sub-duplicates inside the family:
   - `checkCancelled` closure defined 4× with identical bodies: service.ts:467-469, 1161-1163, 1925-1927, 2072-2074.
   - `executeTransfer` defines a local `markJournal` closure (service.ts:452-459) byte-equivalent to the private method `this.markJournal` (service.ts:1401-1408) — the method exists and the closure still doesn't use it.
   - Catch template `if (error instanceof JobCancelledSentinel) throw error; await markJournal(failed); throw` 3×: service.ts:1204-1212, 2005-2014, 2195-2204 (executeTransfer uses the `maybeRethrowAsRpcCancel` variant at 600-609).
   - NO_WAIT/receipt return tail verbatim 2×: service.ts:2000-2004 vs 2190-2194.
   - acquire-slot + claim + post-claim-cancel-check preamble near-verbatim 2×: service.ts:1894-1930 vs 2042-2077.
   - Authwit-discovery adapter lambda (`buildStandard` → `DiscoverContext`) verbatim 2×: service.ts:893-897 and 1952-1958.

5. **Why it harms future change:** any change to the cancel checkpoint protocol, journal stage ordering, or the controller-cleanup contract must be replayed in 4 places that have already drifted in small ways (one path uses `maybeRethrowAsRpcCancel`, three use the inline sentinel check; one defines markJournal locally). The repo's own recent history shows the cost: the codex-v3 "slot would leak and wedge the lane" fix had to be applied twice (comments at 1901-1905 and 2049-2053 are copies of each other). A fifth send-shaped operation will be written by copy-paste, inheriting whichever copy the author happens to open.

6. **Smallest safe refactoring:** Form Template Method (Fowler) — implement the `proveAndSend` the coordinator's doc already specifies: a function taking `{journalId, controller, txRequest, node, pxe, scopes, parentTask, buildTxCalls()}` plus per-path hooks, and Extract Method for the `checkCancelled` factory and the catch/finally template. Then fix or delete the stale paragraph in `execution-coordinator.ts:14-19`.

7. **What disappears:** ~120-150 lines of four-way duplication; the local/method `markJournal` twin; the two verbatim NO_WAIT tails and discovery lambdas; the doc/implementation contradiction in the coordinator.

8. **Instances:** packages/extension/src/wallet/services/execution/service.ts:405-610, 452-459, 467-469, 893-897, 1130-1213, 1161-1163, 1401-1408, 1860-2015, 1925-1927, 1952-1958, 2000-2004, 2022-2205, 2072-2074, 2190-2194; packages/extension/src/wallet/services/execution/execution-coordinator.ts:14-19.

## F2: ExecutionService facade is still a Large Class hosting four unrelated subsystems

1. **Title:** After the 19-file extraction, the 2302-line facade still owns the estimate-reuse cache, the gas-balance cache, the execution-wait heartbeat, and 16 per-op handlers.

2. **Smell name:** Large Class (Fowler bloater). Secondary: Divergent Change — the file changes for unrelated reasons (fee-estimate reuse, gas-balance UX, mutex backpressure, new dApp RPC kinds).

3. **Impact bucket:** structural. Blast radius: 1 file + every PR that touches execution. Change frequency: highest in the repo (9/3mo). The facade has **no service-level test** (verified: no `service.test.ts`; map §5/§7 agree) — precisely because instantiating it requires the full 11-service graph, so each in-facade subsystem is untestable in isolation while every extracted sibling (mutex, fast-path, claim-helper, planner) has its own test file.

4. **Concrete evidence:** four self-contained subsystems live in facade state (service.ts:252-335):
   - **Estimate-reuse subsystem** (~260 lines): `TransferEstimateReuseEntry` type 154-190, `fingerprintBaseFee`/`fingerprintFeeSettings` 195-224, cache field 295-296, `tryConsumeTransferEstimate` 619-715, cache write 752-801, `evictStaleEstimateReuseEntries` 816-823. Touches facade state only via the Map.
   - **Gas-balance subsystem** (~130 lines): TTL cache + single-flight maps 280-302, invalidation hooks in init 382-402, `getGasBalances` 1476-1502, `#computeGasBalances` 1504-1575.
   - **Execution-wait heartbeat bookkeeping**: waiters set + timer 327-335, `beginExecutionWait`/`endExecutionWait`/`heartbeatExecutionWaiters` 1349-1376, `acquireExecutionSlot` 1285-1347.
   - **The 22-kind dispatcher + 16 `executeX` handlers** 914-1029 and onward.
   The module also hosts 5 module-level free functions (141-247) that belong with the subsystems they serve.

5. **Why it harms future change:** every new concern defaults into service.ts because it is the only home for cross-cutting state, which is how a file already extracted 19 times grew back to 2302 lines. The lack of a facade test means each addition is verified only via e2e; reviewers must re-derive which of the four subsystems a diff touches.

6. **Smallest safe refactoring:** Extract Class (Fowler) ×2, following the house pattern already proven by `execution-mutex.ts`/`fast-path.ts`: (a) `TransferEstimateReuse` collaborator owning the entry type, fingerprints, consume/evict/write (deps: profileService, networkService, transactionService — all passable); (b) `GasBalanceReader` owning cache + single-flight + the two balance reads. Both become unit-testable without the service graph.

7. **What disappears:** ~390 lines from the hotspot file; the untestability of the two cache subsystems; the temptation to keep parking new state on the facade.

8. **Instances:** packages/extension/src/wallet/services/execution/service.ts:141-247, 154-190, 195-224, 252-335, 382-402, 619-715, 752-801, 816-823, 1285-1376, 1476-1575.

## F3: Positional 6/7/8-tuples as the build-pipeline currency, consumed by magic index

1. **Title:** `FeeEstimateResult`, `StandardTxRequestResult`, `NoFromTxRequestResult` are positional tuples of 6-8 heterogeneous values; one consumer reads them as `built[5]`, `built[7]`.

2. **Smell name:** Data Clumps + Primitive Obsession (Fowler bloaters) — a recurring group of values (`txRequest, node, pxe, account, network, nonce, txCalls, feePaymentMethod`) travels as an anonymous positional tuple instead of an object. `fee-strategy.ts:17-24` documents the shape as deliberate "minimal-diff" extraction debt.

3. **Impact bucket:** structural. Blast radius: 7 files (service.ts, tx-request-builder.ts, fee-strategy.ts + 4 strategy impls), ~15 construct/destructure sites. Change frequency: fee-strategy.ts 2/3mo, tx-request-builder.ts 2/3mo, service.ts 9/3mo.

4. **Concrete evidence:**
   - Magic-index consumption: service.ts:538-545 — `txRequest = built[0] … nonce = built[5]; feePaymentMethod = built[7]` (silently skipping `built[6]`). Reordering or inserting a tuple element type-checks at several sites and mis-binds here only if two slots share a type.
   - Underscore-position skipping: service.ts:739 `[txRequest, _node, _pxe, _account, network, nonce, _txCalls, feePaymentMethod]`, service.ts:903 `[txRequest]`, service.ts:1411 `[txRequest, _, pxe, account]`, service.ts:1849 `[txRequest, node, pxe]`.
   - Tuple definitions: fee-strategy.ts:72-81 (8-tuple), tx-request-builder.ts:69-70 (7- and 6-tuple).
   - Construct sites: tx-request-builder.ts:373, 477; fee-juice-strategy.ts:34; fee-juice-with-claim-strategy.ts:42; fpc-strategy.ts:85; embedded-strategy.ts:51.
   - Other destructures: service.ts:894, 1173, 1801, 1953, 1967, 2081; fpc-strategy.ts:47, 64 (re-destructures all 7 twice); fee-juice-strategy.ts:20; fee-juice-with-claim-strategy.ts:28; embedded-strategy.ts:35.

5. **Why it harms future change:** adding one value to the build result (the next `timestamp`/`offchainOutput`-style need) forces re-signing every strategy and re-counting positions at ~15 sites; the `built[7]` site fails silently, not loudly. The fee-strategy doc itself defers the fix to "when the coordinator owns the post-send flush point" — a milestone that hasn't arrived in the file's 2-change/3mo lifetime.

6. **Smallest safe refactoring:** Introduce Parameter Object on the return side (Fowler; a.k.a. Replace Tuple with Object): `type BuiltTx = { txRequest; node; pxe; account; network; nonce; txCalls; feePaymentMethod }` (nonce optional for the NoFrom variant). Mechanical, behavior-preserving, removes positions entirely.

7. **What disappears:** all magic indices and underscore placeholders; the 3 parallel tuple type aliases; the risk class of silent slot mis-binding on reorder.

8. **Instances:** packages/extension/src/wallet/services/execution/fee/fee-strategy.ts:72-81; packages/extension/src/wallet/services/execution/tx-request-builder.ts:69-70, 373, 477; packages/extension/src/wallet/services/execution/service.ts:538-545, 739, 894, 903, 1173, 1411, 1801, 1849, 1953, 1967, 2081; packages/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts:20,34; fee/fee-juice-with-claim-strategy.ts:28,42; fee/fpc-strategy.ts:47,64,85; fee/embedded-strategy.ts:35,51.

## F4: The assert-then-derive chain-identity ritual is hand-replayed at 8 sites — and the V-01 fix had to chase them in two commits

1. **Title:** `assertLiveChainIdentity(network, nodeInfo)` followed by `{ chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }` is an unenforced two-step ritual duplicated across 5 files.

2. **Smell name:** Shotgun Surgery (Fowler change-preventer) + Temporal coupling (named analog: the assert MUST precede the derivation, but nothing enforces the pairing — each site re-implements it by convention). The Shotgun Surgery mapping is empirical: one logical change (rebind chain identity at sinks) required edits across 6 locations in commit b44aac1, and commit 1e7ad89 exists because the first sweep *missed two more sites* (`executeNoFromSendTx`, `executeAztecGetChainInfo`) — found only by a second audit round.

3. **Impact bucket:** structural (borderline architectural — the missing helper belongs in `@nulo/aztec-runtime/utils` next to `assertLiveChainIdentity`). Blast radius: 5 files in this cluster + the aztec-runtime package boundary. Change frequency: the ritual was modified across 6+ files within one week (Jun 8 commits).

4. **Concrete evidence:**
   - Assert sites: tx-request-builder.ts:112, 456; fast-path.ts:179; authwit-discoverer.ts:108; batched-view-simulation.ts:248; service.ts:1651, 2136, 2219.
   - ChainInfo-literal sites (9): authwit-discoverer.ts:109, 169-172, 240-243, 254-257; service.ts:1652, 2137, 2220-2223; fast-path.ts:180-183; batched-view-simulation.ts:249-252.
   - Unpaired derivations: authwit-discoverer.ts:169-172, 240-243, 254-257 build the literal from a `nodeInfo` asserted earlier *in a different function* (tx-request-builder.ts:112) — the temporal coupling spans a call boundary with no type-level link.
   - Each site also re-carries the same threading boilerplate: `network: { chainId: number }` fields added to `DiscoverContext` (authwit-discoverer.ts:51-55), `FastPathDeps` (fast-path.ts:132-135), `BatchedViewSimulationDeps` (batched-view-simulation.ts:150-153) in the same commit — three identical doc comments included.

5. **Why it harms future change:** the next sink site (a 10th derivation) can compile and pass review without the assert — exactly the failure mode that already happened twice during the V-01 arc. Any change to the identity model (e.g. adding rollup-version drift tolerance) re-runs the same 8-site sweep.

6. **Smallest safe refactoring:** Extract Function (Fowler): `assertedChainInfo(network, nodeInfo): ChainInfo` in `@nulo/aztec-runtime/utils` that asserts and returns the literal. Replace the 8 paired sites; for the 3 unpaired authwit-discoverer sites, accept the derived `ChainInfo` as a parameter instead of raw `nodeInfo` so the unasserted path becomes unrepresentable.

7. **What disappears:** 9 copies of the literal; the convention-only pairing; the "missed sink site" class of follow-up fix; three duplicated `network: { chainId }` dep-threading doc blocks.

8. **Instances:** packages/extension/src/wallet/services/execution/tx-request-builder.ts:107-112, 453-456; packages/extension/src/wallet/services/execution/fast-path.ts:176-183; packages/extension/src/wallet/services/execution/authwit-discoverer.ts:105-109, 169-172, 240-243, 254-257; packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:244-252; packages/extension/src/wallet/services/execution/service.ts:1647-1652, 2132-2137, 2216-2223.

## F5: Artifact function-lookup and PXE contract-registration loops re-inlined in four files while the shared helpers already exist

1. **Title:** `findFunctionByName`/`findFunctionBySelector` exist as module-private helpers in batched-view-simulation.ts but are re-implemented inline in tx-request-builder, authwit-discoverer, and the facade; the resolve→register-unregistered-contracts loop is copied 4×.

2. **Smell name:** Duplicate Code (Fowler dispensable). The selector variant is also Inappropriate Intimacy with the artifact shape: two files independently re-implement the "scan functions + nonDispatchPublicFunctions, compute selector per candidate, backfill missing fields onto the mutable input" block nearly verbatim.

3. **Impact bucket:** structural. Blast radius: 4 files. Change frequency: tx-request-builder 2/3mo, batched-view-simulation 3/3mo, authwit-discoverer 2/3mo. `ContractResolver`'s own JSDoc (contract-resolver.ts:2-4) states its purpose is to "consolidate contract-instance + artifact resolution logic that would otherwise be duplicated" — the consolidation stopped one level short.

4. **Concrete evidence:**
   - **find-by-name** (`artifact.functions.find(name) ?? artifact.nonDispatchPublicFunctions.find(name)`): batched-view-simulation.ts:577-579 (helper), tx-request-builder.ts:279-281, authwit-discoverer.ts:149-151, service.ts:1445-1446.
   - **find-by-selector** (await `FunctionSelector.fromNameAndParameters` per candidate across both arrays): batched-view-simulation.ts:581-591 (helper), tx-request-builder.ts:315-331, authwit-discoverer.ts:201-217.
   - **Backfill block** (selector-lookup then mutate input with `name/type/isStatic[/returnTypes]`): tx-request-builder.ts:302-337 vs authwit-discoverer.ts:187-225 — near-verbatim twins including the "Method not found" throws.
   - **register-unregistered loop** (`getContracts()` → Set → for-each instance → `registerContract`): tx-request-builder.ts:117-126, tx-request-builder.ts:412-424, batched-view-simulation.ts:183-192, service.ts:1434-1441 (single-contract variant).

5. **Why it harms future change:** the upstream artifact shape (`nonDispatchPublicFunctions`) is `@aztec/*`-pinned and bumped manually; the next upstream rename/merge of those arrays is a 7-site edit across 4 files instead of 2 functions. The duplicated backfill blocks have already accumulated a subtle difference (tx-request-builder leaves `returnTypes` empty at :339; authwit-discoverer backfills it at :224) that a maintainer must re-derive each time.

6. **Smallest safe refactoring:** Move Function (Fowler) — promote `findFunctionByName`/`findFunctionBySelector` from batched-view-simulation.ts into `ContractResolver` (or a sibling export in the same module) and replace the 5 inline copies; Extract Function `ensureContractsRegistered(pxe, instances, artifacts, log)` for the 4 register loops.

7. **What disappears:** 5 inline lookup copies, 4 register loops, the two divergent backfill twins' shared scanning core (~90 lines), and the per-file exposure to upstream ABI-shape drift.

8. **Instances:** packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:183-192, 577-591; packages/extension/src/wallet/services/execution/tx-request-builder.ts:117-126, 279-281, 302-337, 412-424; packages/extension/src/wallet/services/execution/authwit-discoverer.ts:149-151, 187-225; packages/extension/src/wallet/services/execution/service.ts:1434-1441, 1445-1449.

## F6: Four parallel implementations of "primary display method" extraction, two of which bypass the shared heuristic

1. **Title:** `planner.extractPrimaryMethod`, module-level `pickActionMethod`, and two inline `exec.calls.find(c => c?.name)?.name` copies all derive the same journal/task title — and the inline pair skips the `pickPrimaryMethod` fee-filter heuristic.

2. **Smell name:** Duplicate Code (Fowler) with demonstrated divergence; the `pickActionMethod → [{method}] → pickPrimaryMethod` chain at service.ts:1151→1156→1230 is also a Middle Man-ish double application (the heuristic runs on a list of one that was itself pre-picked).

3. **Impact bucket:** local-to-structural (2 files in scope, 4 sites + 1 out-of-scope cousin). Change frequency: this label logic was touched in the journal-card unification arc; service.ts 9/3mo.

4. **Concrete evidence:**
   - operation-planner.ts:240-256 `extractPrimaryMethod` — handles both `actions` and `exec.calls` shapes via `pickPrimaryMethod` (used only at service.ts:931).
   - service.ts:141-148 `pickActionMethod` — re-implements the `actions` branch of the above (same carriers loop, same `pickPrimaryMethod` call); its header comment explains a layering constraint that applies equally to the planner copy.
   - service.ts:1914 and service.ts:2061 — verbatim twin inlines `(Array.isArray(op.exec?.calls) ? op.exec.calls.find((c) => c?.name)?.name : undefined) ?? undefined`. These take the *first named call* rather than `pickPrimaryMethod`'s FEE_METHODS-filter + mint heuristic (utils/primary-method.ts:41-49), then feed a single-element array into `beginDappExecuteJournal`/claim → `pickPrimaryMethod` (service.ts:1230), which can no longer apply its filter because the list was pre-collapsed.
   - Out-of-scope cousin (noted, not counted): `extractPrimaryMethodFromSendTx` in wallet-sdk/queued-journal.ts:172.

5. **Why it harms future change:** `FEE_METHODS` exists precisely because journal titles showed fee-entrypoint names instead of user intent (utils/primary-method.ts:1-6). A future fix to that heuristic lands in `pickPrimaryMethod` and silently does nothing for the two inline sites, which re-introduce the original bug class for multi-call dApp sends. Four sites must be discovered and updated for any title-derivation change.

6. **Smallest safe refactoring:** Inline Function on `pickActionMethod` into `planner.extractPrimaryMethod` usage (or vice versa — keep one), and Replace Inline Code with Function Call at service.ts:1914/2061 using the planner method, passing the full call list through to `pickPrimaryMethod`.

7. **What disappears:** three of four implementations; the heuristic divergence between Nulo-path and aztec-path journal titles; the double-application chain.

8. **Instances:** packages/extension/src/wallet/services/execution/operation-planner.ts:240-256; packages/extension/src/wallet/services/execution/service.ts:141-148, 931, 1151-1157, 1230, 1914-1919, 2061-2067.

## F7: ~49 milestone/audit-arc vocabulary references in production comments, violating the repo's own comment policy

1. **Title:** Comments cite plan milestones, audit rounds, and reviewer identities ("codex audit BLOCKING #1", "plan-v4 Branch 5", "Phase 2 follow-up v4", "opus post-impl F5", "M1.1", "codex R5") — including a PR tag inside a runtime log string.

2. **Smell name:** Comments-as-deodorant (Fowler dispensable), specifically the history-reference subclass the repo's CLAUDE.md bans outright ("No milestone, plan, PR, phase, or stage tags… No referencing the current task, PR, or caller — that belongs in the PR description and rots in the codebase"). The sanctioned exceptions (`AUDIT [A-Z]\d+` markers like `F-012 / A-01 V-01`, live-behavior "phase N") are NOT counted here.

3. **Impact bucket:** cosmetic, but high-count and concentrated in the hotspot file. Blast radius: 6 production files, ~49 occurrences (grep over non-test files: service.ts 17 codex/opus refs alone; claim-helper.ts 4; spec.ts 1; rpc-cancel.ts 1; embedded-fpc-cap.ts 1; batched-view-simulation.ts 1; plus plan-v4/M1.1/Phase-2-followup/PR-8c variants).

4. **Concrete evidence (representatives):**
   - service.ts:153 "see plan-v4 Branch 5"; :165-166 "(codex audit NICE-TO-HAVE #2)"; :205 "Codex audit BLOCKING #1"; :270 "(codex final-pass FC6)"; :437 "Phase 2 follow-up v4:"; :706 "(codex audit SHOULD-FIX #2 partial…)"; :853 "codex-W1W2-review fix"; :1146 "(M1.1)"; :1905 "(codex v3 engine-audit blocker)"; :1929 "opus post-impl F2 catch".
   - claim-helper.ts:6 "proven correct via codex rounds 3-5"; :22 "(codex R5)"; :162 "(opus post-impl F5)".
   - fast-path.ts:220 — **runtime log string** `"[PR 8c] fast-path failed, falling back to standard path"` ships a PR tag to user-visible logs.
   - spec.ts:78 "codex W2 review fix".

5. **Why it harms future change:** these references point at conversation artifacts (codex round numbers, plan branch names) that a future contributor cannot resolve, while burying the actual invariant the comment is supposed to convey. The repo documents this exact rot mode; the execution cluster is its largest violation surface.

6. **Smallest safe refactoring:** Rewrite Comment (catalog-adjacent: Fowler's "Extract Function and rename" guidance for deodorant comments doesn't apply — here the fix is editing each comment to state the invariant and drop the provenance tag, e.g. "codex audit BLOCKING #1" → keep the explanation of the JSON.stringify pitfall, delete the tag). Fix the `[PR 8c]` log prefix to a stable source tag.

7. **What disappears:** unresolvable provenance pointers in the hottest files; the precedent that makes each new audit arc add more.

8. **Instances:** packages/extension/src/wallet/services/execution/service.ts (27 matches: 153, 165-166, 176, 205, 270, 294, 437, 681, 700, 706, 748, 759, 853, 879, 1146, 1905, 1929, 1944, 2056, 2075 et al.); claim-helper.ts:6, 22, 94, 162; spec.ts:78; rpc-cancel.ts:60; fee/embedded-fpc-cap.ts:60; helpers/batched-view-simulation.ts:229; fast-path.ts:220.

## F8: Orphaned JSDoc — the claim-helper wrapper's doc block sits above an unrelated function

1. **Title:** The doc comment for `claimOrCreateDappExecuteJournal` (service-side wrapper) is stranded above `resolveExecutionMutexKey`, 120 lines away from the function it describes.

2. **Smell name:** Comments (Fowler dispensable) — misleading-by-placement. A doc block describing one function attached to another is worse than no comment.

3. **Impact bucket:** cosmetic. Blast radius: 1 file. The mutex-key/claim region was edited in the v3 arc that introduced the orphan.

4. **Concrete evidence:** service.ts:1247-1255 ("Claim a pre-allocated queued journal record… This thin wrapper just binds `this.*` dependencies…") is immediately followed at 1256-1261 by a *second* JSDoc for `resolveExecutionMutexKey`, which is the function actually declared at 1262. The wrapper the first block describes is declared at service.ts:1378. Two stacked doc blocks where only the second binds; IDE hover on `resolveExecutionMutexKey` shows the wrong doc.

5. **Why it harms future change:** anyone reading or refactoring `resolveExecutionMutexKey` first parses nine lines about journal claiming; anyone reading the real wrapper at 1378 finds it undocumented and may re-document it, forking the text.

6. **Smallest safe refactoring:** Move Comment (Slide Statements analog) — relocate service.ts:1247-1255 to directly above line 1378.

7. **What disappears:** the wrong-doc-on-hover artifact and the duplicate-documentation risk.

8. **Instances:** packages/extension/src/wallet/services/execution/service.ts:1247-1261, 1378.

## F9: Dead filter condition in `ContractResolver.resolveArtifacts`

1. **Title:** `.filter((x) => !artifacts.has(...))` runs against a map that is provably empty at that point.

2. **Smell name:** Dead Code (Fowler dispensable).

3. **Impact bucket:** local. Blast radius: 1 function. contract-resolver.ts changed 1×/3mo.

4. **Concrete evidence:** contract-resolver.ts:111 creates `const artifacts = new Map(...)` (empty); lines 116-120 then build `classIds` from `[...instances.values()].filter((x) => !artifacts.has(x.currentContractClassId.toString()))` — the predicate is always true since nothing has been inserted into `artifacts` yet; deduplication is already done by the surrounding `new Set(...)`. No DI/reflective registration is relevant (plain local variable).

5. **Why it harms future change:** the filter implies an incremental-cache behavior that doesn't exist; a future reader extending the resolver toward caching may assume the dedup-against-previous-results semantics is already wired.

6. **Smallest safe refactoring:** Remove Dead Code — drop the `.filter(...)` link in the chain.

7. **What disappears:** a misleading no-op predicate.

8. **Instances:** packages/extension/src/wallet/services/execution/contract-resolver.ts:116-120.

## Non-findings

- **`executeOperations` 22-case switch (service.ts:936-1014)** — considered Switch Statements; rejected: it is a 1:1 type-narrowed dispatch over a wire union, each arm a single delegation; a handler map would trade compile-time narrowing for indirection with no duplication removed.
- **`spec.ts`/`service.ts`/`client.ts` triple** — house convention, excluded by the prompt.
- **`ExecutionMutex` as a bespoke lock vs `@nulo/wallet-core` `Lock`** — considered Alternative Classes with Different Interfaces; rejected: the divergence (no timeout/force-release) is the entire point and is documented with rationale (execution-mutex.ts:5-10).
- **`FpcStrategy` mutation-based two-pass (`unshift`/`splice`)** — considered for refactor; rejected: documented as load-bearing byte-parity behavior with an explicit do-not-refactor warning (fpc-strategy.ts:10-23).
- **fj/fjwc/embedded strategy skeleton similarity** — considered Form Template Method; rejected: bodies are ~20 lines each and the differences (pre-step, finalize args) are the essence; collapsing them would couple the four kinds the strategy split exists to separate. The repeated `{ simulatePublic: true, skipFeeEnforcement: true, scopes: [account.address] }` literal (6×) is a marginal data clump not worth a shared constant given the option types differ per call.
- **`extractContracts` six chained filter+concat passes (contract-resolver.ts:44-69)** — O(6n) style preference, no duplication or coupling consequence.
- **Duplicate `logDebug` + `logError` pairs for the same failure (service.ts:1540-1541, 1567-1568)** — trivial double-logging, below threshold.
- **`cancelJob` semantics documented twice (spec.ts:63-83 and service.ts:825-855)** — the client doc correctly `{@link}`s the spec; the service copy is borderline acceptable as implementation commentary; folded conceptually under F7's history-tag cleanup rather than a separate finding.
- **`GAS_BALANCE_TTL_MS` / `ESTIMATE_REUSE_TTL_MS` both 5 min** — coincidental equal constants, not config sprawl (different knobs, both locally named).
- **`models/index.ts` re-export barrel** — C3 scope per the cluster plan (re-export shim family); not double-reported here.

## Out-of-scope observations

- `executeSendTransaction` (service.ts:1130) does not acquire the `(profileId, chainId)` execution slot while both `aztec_sendTx` paths do — potential private-note interleaving exposure for the Nulo-native dApp path; correctness, not quality.
- `// TODO: filter by chainId` at service.ts:1661 (`executeAztecGetAddressBook`) — acknowledged behavior gap returning cross-chain contacts to dApps.
- `estimateReuseCache` retains live `TxExecutionRequest` objects in SW memory with eviction only on subsequent writes (service.ts:793) — bounded but write-triggered; memory/perf concern.
- `coerceAmount`'s doc (coerce-amount.ts:4-10) flags that the RPC layer's `bigint` signatures are runtime lies after `jsonSanitize` — a cross-package typing-honesty issue belonging to the C5 messaging cluster.
