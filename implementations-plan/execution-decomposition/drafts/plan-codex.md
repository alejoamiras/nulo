# Execution Decomposition Plan Draft

**Ordering**
Start with the lowest-risk seam deepening, then centralize behavior, then tackle concurrency, then objectify shapes, then do the final facade trim. Concretely: `Q17` before `Q5`, `Q5` before `Q23`, `Q23` before `Q18`, and the line-count-driven `Q4` facade split last. `Q18` tuple→object goes **after** `Q5`: the extracted pipeline can take a private named input object immediately, but changing tuple contracts first would spray churn through every fee strategy and builder path before the duplicated lifecycle is even centralized. Doing `Q23` after `Q5` isolates the most dangerous refactor last among behavior changes: first get one prove/send tail, then move the claim/cancel ordering contract behind one seam.

## Phases

### 1. Resolver seam completion (`01-resolver-seams`)
Goal: finish the half-done execution-local extraction by extending `contract-resolver.ts` with the missing helpers and deleting repeated contract/function lookup logic from execution callsites.

Files:
- `packages/extension/src/wallet/services/execution/contract-resolver.ts`
- `packages/extension/src/wallet/services/execution/contract-resolver.test.ts`
- `packages/extension/src/wallet/services/execution/tx-request-builder.ts`
- `packages/extension/src/wallet/services/execution/authwit-discoverer.ts`
- `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts`
- `packages/extension/src/wallet/services/execution/service.ts` (`executeSimulateUtility` only)

Shape:
- Add `ensureContractsRegistered(...)`, `findFunctionByName(...)`, `findFunctionBySelector(...)`.
- Parameterize error text instead of normalizing it; `tx-request-builder` throws `"Contract not found"` / `"Method not found"` while `contract-resolver` itself freezes different strings.
- Keep lookup order exactly `functions` then `nonDispatchPublicFunctions`.

Gate:
- Mandatory: `bun run lint`, `bun run test`, `bun run e2e:agent`, codex parity review.
- New/updated unit focus: `contract-resolver.test.ts`, `batched-view-simulation.test.ts`, `authwit-discoverer` coverage for lookup branches.

Revert:
- Pure helper extraction, no schema/wire/storage migration.
- Safe single-checkpoint revert; later phases should not delete the old resolver entrypoints.

### 2. Cache/state extractions (`02-caches`)
Goal: remove the two self-contained stateful subsystems from `service.ts` first: transfer-estimate reuse and gas-balance cache/single-flight.

Files:
- `packages/extension/src/wallet/services/execution/service.ts`
- New `packages/extension/src/wallet/services/execution/transfer-estimate-reuse.ts`
- New `packages/extension/src/wallet/services/execution/transfer-estimate-reuse.test.ts`
- New `packages/extension/src/wallet/services/execution/gas-balance-reader.ts`
- New `packages/extension/src/wallet/services/execution/gas-balance-reader.test.ts`
- `packages/extension/src/wallet/services/execution/fingerprints.test.ts`

Shape:
- Move `TransferEstimateReuseEntry`, `fingerprintBaseFee`, `fingerprintFeeSettings`, `tryConsumeTransferEstimate`, stash/evict logic out of the facade.
- Move `getGasBalances` cache, TTL, single-flight, and invalidation wiring out of the facade, preserving the `${networkId}:${account}` key and `PrivateFpc` invalidation behavior.

Gate:
- Mandatory gate plus targeted unit tests for TTL expiry, single-shot reuse, input drift rejection, base-fee fingerprint drift, pending-hash drift, single-flight dedup, and private-FPC invalidation.
- Add `(BUG PIN)` tests wherever preserved surprise is intentional rather than “cleaned up”.

Revert:
- No persisted-format change.
- Revert is import/wiring only; callers stay on the same public methods.

### 3. Single prove/send tail (`03-pipeline-tail`)
Goal: make `execution-coordinator.ts` truthful by adding the one shared pipeline tail and moving all four send paths onto it.

Files:
- `packages/extension/src/wallet/services/execution/execution-coordinator.ts`
- New `packages/extension/src/wallet/services/execution/execution-coordinator.test.ts`
- `packages/extension/src/wallet/services/execution/service.ts`

Shape:
- Add `proveAndSend(...)` to `ExecutionCoordinator`.
- The helper owns: stage changes `simulating/proving/submitting/succeeded|failed`, `checkCancelled` checkpoints, `proveTxTask`, `toTx()`, `sendTxTask`, transaction persistence callback, terminal journal update, and cleanup callback.
- Each caller supplies only the path-specific pieces: build/pre-sim work, tx-history call shape, offchain-output extraction, and whether to wait for receipt.

Gate:
- Mandatory gate plus new coordinator tests for ordering, “cancel before send means no broadcast”, journal hash parity, and “NO_WAIT returns txHash while wait path returns receipt”.
- E2E signals to watch most closely: `transfers.test.ts`, `tx-sendTx-default.test.ts`, `tx-sendTx-feePayer.test.ts`, `tx-sendTx-noFrom.test.ts`.

Revert:
- Keep `simulateTxTask`, `proveTxTask`, and `sendTxTask` unchanged; `proveAndSend` is additive.
- Revert puts the four tails back in-place without affecting public methods or storage.

### 4. Claim/cancel lane seam (`04-execution-lane`)
Goal: take the dangerous cross-file ordering contract out of `ExecutionService` by introducing one collaborator that owns queueing, waiter heartbeats, controller registration, queued-journal claim/create, and `cancelJob`.

Files:
- New `packages/extension/src/wallet/services/execution/execution-lane.ts`
- New `packages/extension/src/wallet/services/execution/execution-lane.test.ts`
- `packages/extension/src/wallet/services/execution/service.ts`
- `packages/extension/src/wallet/services/execution/claim-helper.ts`
- `packages/extension/src/wallet/services/execution/execution-mutex.ts`
- `packages/extension/src/wallet/services/operation-journal/service.ts` only if a test seam is needed, not for behavior changes

Shape:
- Move `activeControllers`, `executionMutex`, `executionWaiters`, `begin/end/heartbeatExecutionWait`, `acquireExecutionSlot`, `claimOrCreateDappExecuteJournal` wrapper, and `cancelJob` into the lane manager.
- `ExecutionService` becomes a consumer of a higher-level handle, not the owner of the microtask choreography.
- Preserve the no-timeout invariant and the “transition journal first, abort second” rule exactly.

Gate:
- Mandatory gate plus `claim-helper.test.ts`, `execution-mutex.test.ts`, `operation-journal/service.test.ts` race cases, and new lane-manager tests.
- E2E focus: `cancel-mid-prove.test.ts`, `concurrent-sendtx.test.ts`, `concurrent-sendtx-confirm.test.ts`.

Revert:
- No storage schema or FSM transition-table change.
- Revert is safe because `Methods.cancelJob` and journal shapes remain unchanged.

### 5. Internal objectification (`05-object-contracts`)
Goal: eliminate positional tuples and internal transfer-parameter clumps without changing the RPC transport yet.

Files:
- `packages/extension/src/wallet/services/execution/tx-request-builder.ts`
- New `packages/extension/src/wallet/services/execution/tx-request-builder.test.ts`
- `packages/extension/src/wallet/services/execution/fee/fee-strategy.ts`
- `packages/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts`
- `packages/extension/src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts`
- `packages/extension/src/wallet/services/execution/fee/fpc-strategy.ts`
- `packages/extension/src/wallet/services/execution/fee/embedded-strategy.ts`
- `packages/extension/src/wallet/services/execution/service.ts`
- `packages/extension/src/wallet/services/execution/operation-planner.ts`

Shape:
- Replace `StandardTxRequestResult`, `NoFromTxRequestResult`, and `FeeEstimateResult` with named result objects.
- Introduce an internal `TransferRequest` value object below the RPC seam and route `executeTransfer` / `estimateTransferFee` / `buildTransferOperation` through it.
- Keep `spec.ts` and `client.ts` stable in this arc unless explicitly approved; wrappers can construct the internal object immediately.

Gate:
- Mandatory gate plus new builder and strategy tests.
- Required bug pins: FPC two-pass action mutation ordering, embedded-fee gas-cap behavior, and preserved `Unauthorized`/`Wallet locked`/fee-setting error strings.

Revert:
- Keep compatibility adapters until the final trim checkpoint lands.
- No wire-format migration in this phase.

### 6. Final facade trim (`06-facade-trim`)
Goal: use the stabilized seams to move the remaining heavy method bodies off `ExecutionService` and bring `service.ts` under the line-count target.

Files:
- `packages/extension/src/wallet/services/execution/service.ts`
- New `packages/extension/src/wallet/services/execution/transfer-executor.ts`
- New `packages/extension/src/wallet/services/execution/transfer-executor.test.ts`
- New `packages/extension/src/wallet/services/execution/dapp-send-executor.ts`
- New `packages/extension/src/wallet/services/execution/dapp-send-executor.test.ts`

Shape:
- `ExecutionService` ends as RPC facade + dispatcher + collaborator wiring.
- Transfer execution and dApp send execution move behind dedicated modules that already depend on the cache, resolver, coordinator, and lane seams.
- Do not create another half-migration: this checkpoint is where old private helpers die and the facade line count is measured.

Gate:
- Mandatory gate plus `wc -l service.ts <= 1200`.
- End-of-arc gate: `bun run audit:vue`, `/code-review max --fix`, codex post-impl audit, RC build, manual QA.

Revert:
- Public service methods remain as thin delegates, so reverting this checkpoint only inlines bodies again.
- No storage/wire change here either.

## Goal Mapping

- `/goal a` one extracted pipeline tail: verifiable when all four paths delegate to one `ExecutionCoordinator.proveAndSend` implementation and `service.ts` no longer contains four copies of `proveTxTask -> toTx -> sendTxTask -> addTransaction`.
- `/goal b` `service.ts <= ~1200` and caches extracted: verifiable by `wc -l` and presence of tested cache modules.
- `/goal c` zero behavior change: verifiable by per-phase `bun run lint`, `bun run test`, `bun run e2e:agent`, codex parity review, and final RC/manual QA.
- `/goal d` every extracted module ships with colocated tests: verifiable by new `*.test.ts` files landing in the same checkpoint as each new module.

## Test Strategy

- Preserve today’s quirks unless there is an explicit product decision to change them. Every preserved surprise gets a `(BUG PIN)` test, not a comment.
- Add missing unit nets exactly where this arc is weakest today: `execution-coordinator`, `tx-request-builder`, cache modules, and the new lane/executor modules.
- Treat the existing helper suites as invariants, not suggestions: `claim-helper.test.ts`, `execution-mutex.test.ts`, `contract-resolver.test.ts`, `operation-planner.test.ts`, `batched-view-simulation.test.ts`, `rpc-cancel.test.ts`, `embedded-fpc-cap.test.ts`.
- Use the network e2e suite as the behavior gate per checkpoint, but read the high-signal scenarios first: `transfers.test.ts`, `cancel-mid-prove.test.ts`, `concurrent-sendtx.test.ts`, `concurrent-sendtx-confirm.test.ts`, `tx-sendTx-default.test.ts`, `tx-sendTx-feePayer.test.ts`, `tx-sendTx-noFrom.test.ts`, `fee-methods.test.ts`.
- Final manual QA should replay the same surfaces with an RC build: popup transfer flow, standard dApp sendTx, embedded fee payer, default-entrypoint/no-from path, cancel-mid-prove, and concurrent sendTx FIFO.

## Assumptions

**Facts**
- `ExecutionService` is 2302 lines and owns gas-balance cache, estimate-reuse cache, active controllers, execution mutex, and waiter heartbeats in one file (`service.ts:280-335`, `service.ts:620-823`, `service.ts:1262-1408`, `service.ts:1476-1575`).
- `ExecutionCoordinator` currently wraps only simulate/prove/send task steps; the header claims a `proveAndSend` extraction that does not exist (`execution-coordinator.ts:1-19`, `execution-coordinator.ts:49-99`).
- The four send paths duplicate the prove/send/journal tail in `executeTransfer`, `executeSendTransaction`, `executeAztecSendTx`, and `executeNoFromSendTx` (`service.ts:405-610`, `service.ts:1130-1213`, `service.ts:1860-2015`, `service.ts:2022-2205`).
- Tuple surfaces are real and hot: `buildStandard`/`buildNoFrom` return tuples (`tx-request-builder.ts:69-70`, `tx-request-builder.ts:373`, `tx-request-builder.ts:477`), fee strategies return an 8-slot tuple (`fee/fee-strategy.ts:72-81`), and the facade still reads by index (`service.ts:538-545`, `service.ts:739-742`, `service.ts:1173-1177`, `service.ts:1967-1971`, `service.ts:2081`).
- Contract/function lookup and PXE registration are duplicated across execution helpers (`tx-request-builder.ts:113-125`, `tx-request-builder.ts:279-334`, `authwit-discoverer.ts:141-225`, `helpers/batched-view-simulation.ts:177-194`, `helpers/batched-view-simulation.ts:499-590`, `service.ts:1434-1463`).
- The cancel/claim ordering contract is explicitly fragile: `claim-helper.ts` warns that correctness depends on microtask interleaving (`claim-helper.ts:144-163`), `cancelJob` transitions before aborting (`service.ts:836-866`), the mutex has a no-timeout invariant (`execution-mutex.ts:5-29`, `execution-mutex.ts:97-163`), and the journal serializes transitions under `_transitionLocked` (`operation-journal/service.ts:216-299`).
- Direct facade test surface is thin: `feesettings-invariant.test.ts` hits `ExecutionService` entry invariants and `fingerprints.test.ts` imports pure helpers from `service.ts`; there is no colocated `execution-coordinator.test.ts` or `tx-request-builder.test.ts` today.

**Inferences**
- Extracting concurrency behavior and data-shape changes in the same checkpoint would create exactly the repo’s “sixth half-done migration”: too much semantic movement, not enough isolatable blame.
- The safest first-order refactors are the ones that let us add tests before moving behavior: resolver helpers and stateful caches.
- The public RPC surface for `executeTransfer` is not the right first place to solve Q18; the real risk is the internal tuple fanout through fee strategies and builder callbacks.
- If `Q17` must close outside execution too, `contract-resolver.ts` likely belongs in a neutral seam before `token/service.ts` or `fpc/service.ts` adopt it; pulling those services into an `execution/` helper is the wrong dependency direction.

**Asks**
- Does arc acceptance require the non-execution `Q17` sites in `token/service.ts` and `fpc/service.ts`, or is execution-owned closure sufficient for this PR?
- Is changing `Methods.executeTransfer` / `ExecutionServiceClient.executeTransfer` to a parameter object allowed in this arc, or should the RPC transport stay stable and only the internal seam objectify?
- Is the `<= ~1200` target measured on raw file lines, or is modest overshoot acceptable if the facade is semantically thin and the remaining code is dispatcher-only?

## Security & Adversarial Considerations

- A botched `Q5` extraction can reintroduce the worst failure mode in this subsystem: a user-cancelled tx still broadcasting because a cancel checkpoint moved past `toTx()` or `sendTxTask()`.
- A botched `Q23` extraction can create a silent cancel black hole: the journal says `cancelled`, but no controller was registered in time, so prove continues and later phases mis-classify the terminal state.
- An incorrect mutex refactor can under-serialize the `(profileId, chainId)` PXE runtime and let two sendTx flows simulate against the same private-note state. That is a correctness bug first, but it is attacker-relevant because a malicious dApp can amplify queue pressure and timing races.
- Mishandling `FpcStrategy` or embedded-fee parity can change tx bytes or over-budget max fees. The user-visible symptom may be “random revert,” but the root cause is wallet-side fee-path drift on the signing/proving path.
- `assertLiveChainIdentity` must not move later in the build path or become conditional. A malicious or drifted RPC is exactly what those guards defend against.
- E2E plus parity review do **not** prove byte-level `TxExecutionRequest` identity across every strategy. They prove scenario parity, not structural parity. The highest-risk places remain FPC two-pass mutation and embedded-fee gas-setting paths.
- E2E plus parity review also do **not** exhaust restart/microtask interleavings. They are necessary, not sufficient, for the claim/cancel seam; the unit race tests remain load-bearing.
- If `Q17` spills into token/fpc, current coverage is materially weaker there. That expansion should not be smuggled in under an execution-only checkpoint without new tests.

## Effort Estimates

- Phase 1: 0.5 to 1 day.
- Phase 2: 1 to 1.5 days.
- Phase 3: 1.5 to 2 days.
- Phase 4: 1.5 to 2 days.
- Phase 5: 1 to 1.5 days.
- Phase 6: 1.5 to 2 days.
- Gates, parity reviews, RC, and manual QA: 1.5 to 2 days.

Total: roughly 8 to 12 engineering days, with the main schedule risk in phases 3 and 4 and the main review risk in phase 5 if RPC-surface churn is attempted instead of staying internal.