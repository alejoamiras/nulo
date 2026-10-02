# q01-wallet-execution — claude

Scope read: `apps/extension/src/wallet/services/execution/` (fee/{fee-strategy,fee-juice-strategy,fee-juice-with-claim-strategy,fpc-strategy,embedded-strategy,build-fee-strategies}.ts, dapp-send-executor.ts in full, transfer-executor.ts, authwit-discoverer.ts, discovery-probe.ts, discovered-authwit.ts, discovery-aware-estimator.ts (head), estimate-reuse-shared.ts, transfer-estimate-reuse.ts, operation-estimate-reuse.ts, execution-lane.ts (acquireSlot onward), mark-failed-unless-cancelled.ts, rpc-cancel.ts, view-executor.ts (chain-info, handle resolution, head), fast-path.ts (chainInfo), helpers/batched-view-simulation.ts (chainInfo), service.ts:280-470 and 1010-1030); `services/fpc/service.ts:200-460`; cross-boundary reads of `packages/aztec-runtime/src/utils/chain-identity.ts`, `packages/aztec-runtime/src/fee-juice.ts`, `services/network/spec.ts`, and the fence-commit sites in `services/{contact,dapp-session,token,network,operation-journal}/service.ts`. `transaction/` and `task/` skimmed only (lock `try/finally` shape is the already-reported 2026-08-14 Q-01; no new duplication seen). Not read in depth: view-executor.ts body, tx-request-builder.ts, claim-helper.ts, gas-balance-reader.ts, call-decoder.ts, operation-planner.ts, execution-mutex.ts.

Change-frequency reference (commits since 2026-06-01 / all time): dapp-send-executor 27, service.ts 30, transfer-executor 17, fee-strategy 11, fpc-strategy 9, execution-lane 8, view-executor 7, discovery-probe 2, authwit-discoverer 6.

## q01-wallet-execution-C-1: Three copies of the "offchain effects -> live chain identity -> authwit message hashes" decode loop, already drifted

**Smell:** Duplicate Code (semantic, not just token) with Divergent Change risk: a security-relevant algorithm re-implemented per caller.

**Maintenance impact:** structural; blast radius 3 files (+ `discovered-authwit.ts` that was already extracted for the record shape only); change frequency dapp-send-executor 27 / authwit-discoverer 6 / discovery-probe 2 commits since June. The algorithm is the F-012/A-01 V-01 anti-drifted-RPC guard, so a fix must land in all copies or one path silently loses it.

**Evidence:** Each copy does the same thing: `collectOffchainEffects(privateExecutionResult)` -> early-return if empty -> `node.getNodeInfo()` -> `assertLiveChainIdentity(network, nodeInfo)` -> `chainInfo = {chainId: new Fr(l1ChainId), version: new Fr(rollupVersion)}` -> per effect `try { CallAuthorizationRequest.fromFields; computeAuthWitMessageHash({consumer, innerHash}, chainInfo); toDiscoveredAuthwit } catch { skip }`.
- `authwit-discoverer.ts:110-139` (standalone classic discovery; no dedup).
- `discovery-probe.ts:66-96` (folded probe; adds a `seen` dedup by message hash and injectable crypto seams, and its header says it "byte-mirrors" the discoverer loop).
- `dapp-send-executor.ts:1000-1019` (`discoverNoFromAuthwits`; no dedup, names its local `nodeInfo2`).
Drift already present: only the probe deduplicates identical hashes; only the probe has test seams; the NO_FROM copy has the simulate call inline. The 2026-08-16 prior audit did not list this.

**Why it harms future change:** If upstream changes `CallAuthorizationRequest.fromFields`/hash signature, or the team decides to dedup or cap the effect count (a dApp-controlled loop bound), three places change and the NO_FROM one has no dedicated unit seam. The probe header's "byte-mirrors" comment is the tell that the copy is maintained by convention.

**Smallest safe refactoring:** Extract Function `decodeAuthwitEffects(effects, {node, network}, crypto?)` returning `{ record, messageHash }[]` (live-identity assert inside, dedup optional via a `seen` set param) into `execution/discovered-authwit.ts` (same file already hosts the shared record mapper; no layer issue). The three callers keep their own simulation and their own action/record shaping. Fold the injectable `DiscoveryProbeCrypto` seam into the shared function so all three become unit-testable.

**What disappears:** ~2 x 20 lines of loop + the `nodeInfo2`/`chainInfo` boilerplate; one try/catch-skip block x2.

**Instances:** `authwit-discoverer.ts:110-139`, `discovery-probe.ts:66-96`, `dapp-send-executor.ts:1000-1019`.

## q01-wallet-execution-C-2: `chainInfoFrom` exists in `@nulo/aztec-runtime` but 6 of 8 call sites re-inline it

**Smell:** Duplicate Code / re-implemented helper that already exists in a lower package (cross-package duplication; both sides opened).

**Maintenance impact:** structural-local; blast radius 6 files in execution/ (+ the package); change frequency moderate (service.ts 30 commits, view-executor 7, fast-path, batched-view).

**Evidence:** `packages/aztec-runtime/src/utils/chain-identity.ts:73-75` exports `chainInfoFrom(nodeInfo)` returning `{chainId: new Fr(l1ChainId), version: new Fr(rollupVersion)}` (and re-exported from `utils/index.ts:2`). It is used only at `tx-request-builder.ts:303` and `helpers/batched-view-simulation.ts:204`. The same object literal is hand-written at:
- `authwit-discoverer.ts:119` (plus the three `{chainId: new Fr(nodeInfo.l1ChainId), version: ...}` literals at `:174-177`, `:224-227`, `:238-241`)
- `discovery-probe.ts:79`
- `dapp-send-executor.ts:1005`
- `view-executor.ts:213`
- `fast-path.ts:227-230`
- `service.ts:1020-1023`
- `helpers/batched-view-simulation.ts:362-365` (in the same file that already uses `chainInfoFrom` at `:204`)
Every one of those sites is immediately preceded by `getNodeInfo()` + `assertLiveChainIdentity(network, nodeInfo)` (`authwit-discoverer:115-118`, `view-executor:207-213`, `fast-path:217-230`, `service:1017-1023`, `batched:358-365`), i.e. a second, unnamed clump.

**Why it harms future change:** The doc on `chainInfoFrom` says the signing path must pass an asserted `nodeInfo`; the whole point of the helper is one place to add e.g. a `chainId` encoding change. With 6 inline copies, a change (or an added validation inside the helper) is silently skipped by most callers.

**Smallest safe refactoring:** Replace the literals with `chainInfoFrom(nodeInfo)` (mechanical), then Extract Function `liveChainInfo(node, network): Promise<ChainInfo>` in `packages/aztec-runtime/src/utils/chain-identity.ts` = `getNodeInfo` + `assertLiveChainIdentity` + `chainInfoFrom`, for the 5 sites that do all three. C-1's shared decoder then calls it.

**What disappears:** ~6 x 3-5 lines of literal + the `getNodeInfo/assert` pair at 5 sites; one phantom "almost-helper".

**Instances:** listed above (8 literals across 7 files; 2 correct usages excluded).

## q01-wallet-execution-C-3: Fee strategies repeat the same choreography 5x (task wrapper, stubbed-first-sim rebuild block, sim-option literal, finalize tail)

**Smell:** Duplicate Code + Missing Template Method (Fowler: Form Template Method). The polymorphic `FeeStrategy` was introduced to replace a switch, but the shared skeleton was not hoisted.

**Maintenance impact:** structural; blast radius 4 strategy files + `fee-strategy.ts`; fee/gas estimation is the correctness-critical path and is edited regularly (fpc-strategy 9 commits, fee-strategy 11, since June). Five of the jscpd top rows (25, 23-line class at fpc-strategy:178-202 vs :283-307; fee-juice vs fpc 21 lines) are this.

**Evidence:**
1. `startEstimateTask` ... `try { ...; task.complete(); return ... } catch (e) { task.fail(e); throw e }` is hand-written in `fee-juice-strategy.ts:25-74`, `fee-juice-with-claim-strategy.ts:79-102`, `embedded-strategy.ts:32-51`, `fpc-strategy.ts:136-201`, `fpc-strategy.ts:207-306`.
2. The folded-probe block ("`ctx.probe` -> `extractEffects` -> if discovered or `isInitWrapped` -> push discovered, abort-check, `buildStandard`, `suggestGasLimits`, re-sim with `{simulatePublic:true, skipFeeEnforcement:true, scopes:[account]}`") appears three times: `fee-juice-strategy.ts:36-58`, `fpc-strategy.ts:162-176` (fast path), `fpc-strategy.ts:232-257` (two-pass; differs only by not requiring `discovered.length` to rebuild). They differ in payment-method enum and the `discovered.length ||` condition, nothing else.
3. The validated re-sim option literal `{ simulatePublic: true, skipFeeEnforcement: true, scopes: [built.account.address] }` is written 7 times (`fee-juice:54`, `fjwc:93`, `embedded:42`, `fpc:172, 254, 280`, plus `probedFirstSimOpts`' else-branch in `fee-strategy.ts:170`), even though `probedFirstSimOpts(undefined, built)` returns exactly that object.
4. `fpc-strategy.ts:177-200` vs `:283-302`: maxFee compute -> `splice(0, len, ...getFeePayload(maxFee), ...originalActions, ...discovered)` -> `finalizeGasLimits(node, txRequest, sim, padding, baseFees, undefined, undefined, built.txsLimits)` -> return `{...built, feePaymentMethod: EXTERNAL, ...sponsorOf(...)}` is byte-identical twice; `originalActions`/`multiplier`/`startEstimateTask` preambles are also duplicated (`:134-136` vs `:205-207`).

**Why it harms future change:** Adding a new fold rule (for example, how an init-wrapped build is handled, or a new abort checkpoint) means editing three blocks that must stay in lock-step; the file headers already document that the two FPC paths must keep byte-parity with each other, which a shared function would enforce structurally instead of by comment. A new payment kind copies 40 lines of scaffold.

**Smallest safe refactoring:** (a) Extract Function `withEstimateTask(deps, parentTask, fn)` in `fee/fee-strategy.ts` owning start/complete/fail. (b) Extract Function `foldProbedSim(ctx, built, simulated, rebuild)` in `fee/fee-strategy.ts` returning `{built, simulatedTx, discovered}` with `rebuild` as a callback for the payment method; callers keep the path-specific condition via a flag. (c) Have all strategies call `probedFirstSimOpts(undefined, built)`/a named `VALIDATED_SIM_OPTS(built)` for the second sim. (d) Extract Method `commitFpcEstimate(ctx, fpc, built, simulatedTx, baseFees, originalActions, discovered)` inside `FpcStrategy` for item 4. Keep the load-bearing action-array mutation order exactly (comment at `fpc-strategy.ts:64-70`).

**What disappears:** roughly 100 lines across the five strategy bodies; 5 try/catch wrappers; 7 literal option objects.

**Instances:** `fee/fee-juice-strategy.ts:25-74`; `fee/fee-juice-with-claim-strategy.ts:79-102`; `fee/embedded-strategy.ts:32-51`; `fee/fpc-strategy.ts:133-201`, `:204-306`; `fee/fee-strategy.ts:157-171`.

## q01-wallet-execution-C-4: dApp-send pipelines and the two fee-estimate flows repeat the same scaffolding inside `dapp-send-executor.ts` and against `transfer-executor.ts`

**Smell:** Duplicate Code (inside one 1107-line class) + Long Method residue after `runInSlot`; Parallel copies of estimate choreography between two executors (Alternative Classes with Different Interfaces in the estimate-stash step).

**Maintenance impact:** structural; blast radius 2 files (+ `service.ts` wiring); dapp-send-executor is the most-edited file in the cluster (27 commits since June, transfer-executor 17). jscpd rows 23, 22, 6 here.

**Evidence (within `dapp-send-executor.ts`):**
- `getCalls` thunk, byte-identical including its 3-line comment: `:348-354` (`executeAztecSendTx`) and `:874-880` (`executeNoFromSendTx`); a third variant `pickActionMethod` at `:84-91` / `:247-255` for `send_transaction`.
- `wantOffchainOutput: (provedTx) => { timestamp = ...anchorBlockHeader.globalVariables.timestamp; return extractOffchainOutput(...) }`: `:406-410` and `:914-917`.
- The tail `if (op.opts.wait === "NO_WAIT") return {txHash, ...offchainOutput}; receipt = await node.getTxReceipt(txHash); return {receipt, ...offchainOutput}`: `:425-429` and `:935-939`.
- NO_FROM's `recordTransaction` (`:918-932`) re-spells the same 12 positional `addTransaction` arguments as `sentTxRecorder` (`:196-222`); the only intentional differences are `Fr.ZERO` nonce, `EXTERNAL` method and no pending-authwit write. 12 positional args of mixed `string` types (note `SentTx` needs `AddTransactionArgs[n]` index types to survive a reorder) is a Long Parameter List that invites a transposition bug.
- `checkCancelled = () => { if (signal?.aborted) throw new JobCancelledSentinel("") }` is redefined in `estimateOperationFee` (`:295-297`), `previewOperationAuthwits` (`:40-42` of that method), `TransferExecutor.estimateFee` (`transfer-executor.ts:350-352`), plus the inline `if (signal?.aborted)` in `discovery-aware-estimator.ts:128` and 4 times in the strategies (`fpc:166,243,266`, `fee-juice:43`).

**Evidence (across executors, estimate + stash):** `TransferExecutor.estimateFee` (`transfer-executor.ts:343-430`) and `DappSendExecutor.estimateOperationFee` + `stashOperationEstimate` (`dapp-send-executor.ts:285-328`, `:440-520`) both: cancel-check -> capture fence -> build -> `probeSponsorFunding` -> cancel-check -> `BigInt(getEstimatedFee)` -> same result object (`maxFee`, `maxFeeFormatted`, `gasDetails`, `sponsorFunding`) -> eligibility `kind === "fj" || kind === "fpc"` -> find primary endpoint -> `fingerprintBaseFee` of built `maxFeesPerGas` -> `requireActiveProfile` -> `getPendingForAccount(...).map(hash)` -> best-effort try/catch stash. The "snapshot" half (primary endpoint + base fee fingerprint + pending hashes + profile id) is the producer for exactly what `tryConsume` validates, so the producer and validator of the same five facts live in three files.

**Why it harms future change:** The recurring prior finding (see C-5) already established that the reuse snapshot must match the validator; adding a sixth snapshot fact (e.g. the FPC identity was added to only one side) means editing both stashes and both validators. A change to offchain-output extraction (e.g. a new `SendReturn` field) means two edits inside one class.

**Smallest safe refactoring:** Extract Function `sendReturnTail(op, node, txHash, offchainOutput)` and `extractOffchainOutputFrom(provedTx)` as module-level functions in `dapp-send-executor.ts`; hoist `primaryMethodCalls(op.exec)` for the two identical thunks; give `sentTxRecorder` a `{ nonce, feePaymentMethod, recordAuthwits }` variant so NO_FROM reuses it. Put `captureReuseSnapshot(built, {accountAddress, profileId, getPendingForAccount})` (returns `{primaryEndpointId, primaryEndpointUrl, baseFeeFingerprint, pendingHashes}` or undefined) in `estimate-reuse-shared.ts`, used by both executors. A shared `throwIfAborted(signal)` in `mark-failed-unless-cancelled.ts`'s neighbor (`rpc-cancel.ts`) removes the closure copies.

**What disappears:** ~60 lines in dapp-send-executor, ~20 in transfer-executor, 3+ closure definitions.

**Instances:** as cited above.

## q01-wallet-execution-C-5: RECURRING (prior: 2026-08-16 extension-mid "Transfer/OperationEstimateReuse duplicate Code") estimate-reuse consume ladders still share ~40 lines of validation and already diverged

**Smell:** Duplicate Code with Data Clumps; partially remediated (Q-10 extracted `SingleShotTtlCache` and `pendingHashesChanged` into `estimate-reuse-shared.ts`), the validators were deliberately left separate.

**Maintenance impact:** structural; blast radius 2 reuse files + the two executors' reuse arms; change frequency low on the reuse files, but they guard "sign a cached request" so divergence is costly.

**Evidence:** Still duplicated after the partial fix:
- TTL gate after `consume` already swept by the store: `transfer-estimate-reuse.ts:148-151` vs `operation-estimate-reuse.ts:108-110` (the store's own TTL check plus `Date.now() - builtAt > ESTIMATE_REUSE_TTL_MS` is a third time, `estimate-reuse-shared.ts:47`).
- Profile check `entry.profileId !== fence.profileId -> SessionEndedError`: `transfer:167`, `operation:119`.
- Primary-endpoint identity compare (`find(primaryEndpointId)`, id + rpcUrl): `transfer:173-182`, `operation:121-124`. Plus the stash-side `find` at `transfer-executor.ts:377`, `dapp-send-executor.ts:470`.
- Base-fee re-derivation: `transfer:190-207` (with try/catch -> reject, and a `new GasFees(basis.feePerDaGas, basis.feePerL2Gas)` re-wrap) vs `operation:170-175` (no try/catch, no re-wrap). The multiplier expression `priorityLevel ? PRIORITY_MULTIPLIERS[priorityLevel] : DEFAULT_FEE_MULTIPLIER` is written at `transfer:200-202`, `operation:170`.
- Pending-tx check: `transfer:211-216`, `operation:126-128` (both now call the shared comparator; the `map(tx => tx.hash)` remains duplicated).
- The reuse-hit "re-resolve live handles" arm is also copied: `transfer-executor.ts:298-316` vs `dapp-send-executor.ts:796-819`: `getNetwork -> getNode -> getPXE -> assertFence -> getAccountContract -> fenceChecks().assertLive()` in the same security-sensitive order.
- `fingerprintBaseFee` lives in `transfer-estimate-reuse.ts:44` and is imported by `operation-estimate-reuse.ts` and `dapp-send-executor.ts:57` from the *transfer* file (wrong home).
Divergence evidence: the transfer ladder rejects softly when the fee fetch fails; the operation ladder lets it throw (see Incidental bugs).

**Why it harms future change:** The owner already accepted the ladder order as load-bearing, so the remaining win is moving the *pure steps* (not the ordering) into named functions so a change to, say, endpoint identity (adding `chainId`) is one edit.

**Smallest safe refactoring:** In `estimate-reuse-shared.ts`: Extract Functions `primaryEndpointDrift(network, entry): string | undefined`, `baseFeeDrift(node, feeSettings, fingerprint): Promise<string | undefined>` (folds the try/catch and re-wrap), `multiplierFor(feeSettings)`, and move `fingerprintBaseFee` there. Each ladder keeps its own step order and its own reject wording. Extract `resolveLiveHandles(deps, fence, networkId, accountAddress)` (Move Function into `execution-coordinator.ts` beside `fenceChecks`) for the two reuse arms.

**What disappears:** ~35 duplicated lines, one wrong-home export, and the divergence.

**Instances:** as cited.

## q01-wallet-execution-C-6: The fenced-commit sequence (assertCurrent -> write -> re-check -> compensate) is hand-written in 7 row-service commit points

**Smell:** Shotgun Surgery / Duplicate Code (security-invariant scaffolding copied per call site); crosses the cluster boundary along `fpc/service.ts` but the pattern is repo-wide in `wallet/services`.

**Maintenance impact:** architectural (a deletion-fence invariant that must be correct everywhere); blast radius 6 service files (fpc, contact, dapp-session, network, token, and the network-liveness variant); change frequency low per file but any change to the deletion-fence protocol touches all.

**Evidence (both sides read):** the sequence `deletion.assertCurrent(profileId, epoch)` -> [optional `isNetworkLive` assert] -> `await storage.set(row)` -> `if (!deletion.isCurrent(...)) { await storage.delete(id); throw new Error(`profile ${id} deleted`) }`:
- `fpc/service.ts:230-238` (`registerAndStoreProtocolFpc`) and `:293-302` (`addFpc`): identical, including the "network deleted" arm; this pair is jscpd row 8 lines and is inside this cluster.
- `contact/service.ts:116-123`
- `dapp-session/service.ts:203-210`
- `network/service.ts:325-330`, `:494-499`
- `token/service.ts:413-422` (with a further network-leg compensate after it)
The error string `` `profile ${fence.profileId} deleted` `` is itself copied at each site.

**Why it harms future change:** When the fence protocol changes (for instance a typed `ProfileDeletedError`, which the code already has for sessions via `SessionEndedError`, or an added post-set network check in every site as token already does), 7+ sites need separate, easy-to-miss edits, and an omission produces the orphaned-row bug class this code was written to prevent.

**Smallest safe refactoring:** Extract Function `fencedSet(storage, deletion, fence, id, row, {networkLive?})` (plus `id` and row accessor) into `wallet/services/` next to `restore-rows.ts`/`id-allocators.ts` (the row-service shared helpers), throwing one typed error. Start with the two `fpc/service.ts` call sites and the rest as follow-ups by owning cluster.

**What disappears:** ~6 lines x 7 sites and a scattered string literal.

**Instances:** `fpc/service.ts:230-238,293-302`; `contact/service.ts:116-123`; `dapp-session/service.ts:203-210`; `network/service.ts:325-330,494-499`; `token/service.ts:413-422`.

## Non-findings considered

- `execution/estimate-reuse-shared.ts` `SingleShotTtlCache`: prior Q-10 fix, correctly shared; not re-flagged beyond C-5's residue.
- `TransferExecutor.markJournal` (boolean, local closure) vs `ExecutionLane.markJournal` (void): documented-deliberate divergence in `mark-failed-unless-cancelled.ts` header (`transitionJournal`, "transfer" context, RPC-cancel conversion); keeps its own catch.
- `markFailedUnlessCancelled` / `failureKind` / `classifyOperationCatch` / `maybeRethrowAsRpcCancel`: already the shared layer; no duplication.
- `execution/service.ts` executor-wiring lambdas (`service.ts:339-350` vs `:394-404`; ~12 identical ports in `TransferExecutorDeps` and `DappSendExecutorDeps`): real repetition, but it is the documented composition-root DI and `init()` was split into wire* methods after the 2026-08-16 Long Method finding; folding ports into one shared object is a small gain and risks the "same instance" identity constraints. Noted, not filed.
- `DappSendExecutorLane` mirror of `ExecutionLane` method signatures (`:96-123`): indexed-type seam by design, noted in the header; not flagged.
- `FpcStrategy` header's 70-line doc and `fee-strategy.ts` `finalizeGasLimits`/`resolveLimitLimb`: complexity, not duplication; `finalizeGasLimits` over-cap messages repeat a format string three times (`:231-240`, `:298-301`, `:337-340`) but each has a distinct subject; only ~12 lines, below threshold.
- `suggestGasLimits` 3-branch `GasSettings` constructors (`fee-strategy.ts:187-210`): parallel branches over 2 optional inputs; acceptable, below threshold.
- `fpc/service.ts` `addFpc`/`updateFpcAddress` PXE-lookup preamble (`:266-279` vs `:350-366`): differing error copy and validation by intent; small.
- `fpc/service.ts` `updateFpc`/`deleteFpc`/`getFpc`/`getFpcImpl` preambles (`ensureInitialized` + `requireActiveProfile` + `requireOwnedRow`): pattern used across all row services (documented service convention).
- Lock `try { enter() } finally { leave() }` pairs in `transaction/service.ts`, `fpc/service.ts`: already reported 2026-08-14 Q-01; not re-derived.
- `client.ts` files of execution/fpc/transaction/task: 2026-08-14 Q-05, documented triad.
- jscpd `fpc/service.ts:309-314` vs `:384-389` (6 lines): generic preamble, incidental.
- jscpd `dapp-send-executor.ts:105-113` vs `execution-lane.ts:450-458`, `:86-91` vs `operation-planner.ts:240-245`, `:156-161` vs `transfer-executor.ts:77-82`: signature-type copies along the lane-seam interface (`acquireSlot`/`claimOrCreateJournal` signatures mirrored on purpose); incidental.
- jscpd `embedded-strategy.ts:38-46` vs `fee-juice-with-claim-strategy.ts:35-42` (9 lines): the same sim+finalize tail; folded into C-3 item 3, no separate finding.
- `view-executor.ts` `network -> account -> pxe` triple at `:87-90,:250-254,:342-344` and transfer/dapp reuse arms: same clump as C-5's resolveLiveHandles; view-executor uses different services (`deps.networkService`) and was not read in depth, left out.
- `transaction/` and `task/` (`task/service.ts`, `wrapped-task.ts`): skimmed, no concrete duplicate found beyond prior reports.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:169-175` — counter-example: confirm an `aztec_sendTx` popup approval with a valid `estimateId` while the node's `getPredictedMinFees`/`getCurrentMinFees` call throws a transient error (for example "block not found", which `predictedWorstMinFees` deliberately rethrows, `fee-juice.ts:26-33`). `tryConsume` has no try/catch around the fee fetch, so the error escapes instead of returning `undefined` (the documented "caller rebuilds" contract; `TransferEstimateReuse.tryConsume` catches the same call and rejects softly, `transfer-estimate-reuse.ts:205-208`). The entry was already consumed, so the send aborts with the raw node error rather than rebuilding.

## Cross-rebuttal (claude on codex)

**1. Codex findings**
- X-1 (authwit decode x3): agree. Same as C-1; `authwit-discoverer.ts:110`, `discovery-probe.ts:70`, `dapp-send-executor.ts:1000` hold the same loop. Codex's extraction seam (ordered `{record, messageHash}` pairs, probe dedup stays in caller) is sound. C-1 additionally documents the drift between copies, which Codex only hints at.
- X-2 (fee re-sim and FPC tail): partially agree. It overlaps C-3 items, and the two FPC tails (`fpc-strategy.ts:178-197` vs `:283-302`) are real. But the re-simulation predicate differs per branch (Codex concedes this), so a shared "post-build stage" needs a policy parameter. That risks a flag-driven helper, so the FPC tail extraction is the safe half. The discovery/re-sim half is lower confidence than "high".
- X-3 (selector/name binding x6): agree, after re-reading all six sites. Five are the same missing-function + `name !== undefined && name !== fn.name` pair (`tx-request-builder.ts:340` and `:587`, `authwit-discoverer.ts:197`, `service.ts:1043`, `view-executor.ts:367`). `fast-path.ts:135-140` differs: it requires the name (`call.name !== fn.name`) and its lookup sits in a `catch { return null }`, so the validator needs a missing-name policy and the await must stay outside it. Codex states both. The wording differs only by context, so this is a clean, security-adjacent "scope violation" rule with six owners. Claude missed it.
- X-4 (12-positional `addTransaction`): agree. `transaction/service.ts:155-170` has 12 positional params, and `dapp-send-executor.ts:125-138` indexes `AddTransactionArgs[0|3|5|11]`, so the order leaks into a second type. The optional tail (`fence`, `networkId`) invites same-typed swaps. It is a Long Parameter List rather than duplication, but a real change-amplifier at churn 27. Claude missed it.
- Codex's incidental bug (`fpc/service.ts:330,375-377`, stale `existing` snapshot across the PXE lookup): plausible and not contradicted. It is for the bugs run, not quality.

**2. What Codex missed that Claude found (still stand by)**
- C-2: `chainInfoFrom` exists in `@nulo/aztec-runtime` but 6 of 8 call sites re-inline it. Codex only touches chain identity inside X-1.
- C-3: the fee-strategy task-wrapper, sim-option literal and finalize-tail repetition. Codex covers only part of it (X-2).
- C-4: the dApp-send pipeline and fee-estimate scaffolding repeated between `dapp-send-executor.ts` and `transfer-executor.ts`. Codex dismissed it as short return-shaping and option literals. I still file it, at lower severity.
- C-5: RECURRING. The estimate-reuse consume ladders share about 40 lines of validation and have already diverged. Codex treated the 2026-08-16 Q-10 fix as complete. It fixed the cache storage and pending-set mechanics, not the validation ladders, and Codex itself notes the ladders remain.
- C-6: the fenced-commit sequence (assertCurrent, write, re-check, compensate) is hand-written at 7 row-service commit points. Codex never left the execution/fpc/transaction/task directories.

**3. What both missed**
- **Duplicate Code, contract-class integrity check:** `execution/service.ts:834-837` and `:981-984` are the same `getContractClassFromArtifact` + `contractClass.id !== instance.currentContractClassId` guard, with the same error string, in two registerContract paths. A security invariant is written twice. Extract `assertArtifactMatchesInstance`.
- **Data Clump (instance to artifact hop):** `resolveInstance` followed by `resolveArtifact(instance.currentContractClassId.toString())` appears at `fast-path.ts:129-130`, `view-executor.ts:93-94` and `view-executor.ts:365-366`. `ContractResolver` should own one `resolveArtifactForAddress(pxe, address)`. Only the X-3 sites sit next to it, and neither audit noticed the hop.
