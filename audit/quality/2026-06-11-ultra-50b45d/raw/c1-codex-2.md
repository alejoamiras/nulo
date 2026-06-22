## F1: ExecutionService still concentrates too many unrelated responsibilities
1. Title: ExecutionService still concentrates too many unrelated responsibilities.
2. Smell name: Large Class (Fowler), with Divergent Change: transfer UX, dApp execution queuing, journal/cancel lifecycle, Aztec RPC adapters, gas-balance caching, and fee-strategy dispatch all change the same class.
3. Maintenance impact bucket: architectural/structural. Blast radius: 1 central file, but it is the execution entry point for most wallet actions. Change frequency: high; `packages/extension/src/wallet/services/execution/service.ts` changed 9 times since 2026-03-11.
4. Concrete evidence: the class owns 11 service refs plus caches/mutex/waiters at `packages/extension/src/wallet/services/execution/service.ts:252-335`; transfer estimate/execute flows at `405-823`; operation dispatch at `914-1029`; dApp journal/queue/cancel helpers at `1215-1408`; gas-balance reads at `1476-1575`; Aztec RPC handlers at `1033-1858` and `2207-2257`; fee-strategy dispatch at `2265-2300`.
5. Why it harms future change: changing one concern, like journal stages, queued dApp send behavior, or tx-history recording, forces edits inside the same 2300-line facade that also owns unrelated RPC adapters and caches, increasing merge conflicts and review surface.
6. Smallest safe refactoring: Extract Class. Split the facade into at least a journaled execution runner, a dApp lane/queue manager, and an Aztec RPC adapter, while keeping only RPC binding and service wiring in the facade.
7. What disappears: unrelated state clusters and helper methods stop cohabiting one file; future work no longer starts with “open the 2300-line execution facade”.
8. Instances: `packages/extension/src/wallet/services/execution/service.ts:249-2300`.

## F2: Four send paths duplicate the same journaled execution pipeline
1. Title: Four send paths duplicate the same journaled execution pipeline.
2. Smell name: Duplicate Code (Fowler). This is also a form of Shotgun Surgery because any stage-lifecycle change has to be replicated across four flows.
3. Maintenance impact bucket: structural. Blast radius: 4 execution methods in the hottest file in the cluster. Change frequency: high; the containing file changed 9 times since 2026-03-11.
4. Concrete evidence: `executeTransfer` repeats controller setup, `simulating`/`proving`/`submitting` journal transitions, `proveTxTask`, `sendTxTask`, `addTransaction`, failure marking, and controller cleanup at `service.ts:421-609`. The same pipeline appears in `executeSendTransaction` at `1130-1212`, `executeAztecSendTx` at `1908-2014`, and `executeNoFromSendTx` at `2056-2204`. `ExecutionCoordinator` only wraps per-step tasks at `execution-coordinator.ts:49-99`; it does not own this repeated end-to-end flow.
5. Why it harms future change: adding a new stage, moving a cancellation checkpoint, or changing how tx history is recorded requires synchronized edits in four places, which invites drift between UI transfers, standard dApp sends, and `default_entrypoint` sends.
6. Smallest safe refactoring: Form Template Method / Extract Method into a shared `runExecutionPipeline(...)` helper with callbacks for op-specific build, scopes, and post-send return shaping.
7. What disappears: repeated controller bookkeeping, repeated journal stage choreography, and repeated prove/send/history/catch/finally scaffolding.
8. Instances: `packages/extension/src/wallet/services/execution/service.ts:421-609`, `1130-1212`, `1908-2014`, `2056-2204`; supporting under-extraction at `packages/extension/src/wallet/services/execution/execution-coordinator.ts:49-99`.

## F3: Cancellation depends on cross-file temporal coupling
1. Title: Cancellation depends on cross-file temporal coupling.
2. Smell name: Temporal coupling (named close analog). This maps to Change Preventers because cancel behavior relies on a specific order of journal transitions, controller registration, and mutex release spread across modules rather than one encapsulated abstraction.
3. Maintenance impact bucket: structural. Blast radius: 3 production modules plus every dApp send path. Change frequency: medium-high; `service.ts` changed 9 times since 2026-03-11, `claim-helper.ts` 2 times, and `execution-mutex.ts` 2 times.
4. Concrete evidence: `cancelJob` first transitions the journal and only then aborts the controller at `service.ts:836-866`; `acquireExecutionSlot` pre-registers controllers, heartbeats waiters, and conditionally deletes controller entries at `service.ts:1285-1346`; `claimOrCreateDappExecuteJournal` has separate fresh/create/claim paths mutating the same `activeControllers` map at `claim-helper.ts:82-165`, and its own comment explicitly says correctness depends on microtask interleaving at `144-163`; `ExecutionMutex.acquire` adds another ordering contract for abort-vs-release at `execution-mutex.ts:97-163`.
5. Why it harms future change: a refactor to queued-journal claiming, cancel semantics, or waiter cleanup must preserve several timing assumptions spread across files, so reviewers have to reason about interleavings instead of a single state machine API.
6. Smallest safe refactoring: Extract Class / Introduce State Object for a `CancelableExecutionHandle` that owns journal id, controller lifecycle, acquire/wait lifecycle, and cancel semantics behind one interface.
7. What disappears: shared mutable `activeControllers` choreography, duplicated `set`/`delete` logic, and timing comments standing in for enforceable ownership boundaries.
8. Instances: `packages/extension/src/wallet/services/execution/service.ts:836-866`, `1285-1346`; `packages/extension/src/wallet/services/execution/claim-helper.ts:82-165`; `packages/extension/src/wallet/services/execution/execution-mutex.ts:97-163`.

## F4: Tx-building results are coupled through anonymous position-based tuples
1. Title: Tx-building results are coupled through anonymous position-based tuples.
2. Smell name: Data Clumps (Fowler), with Primitive Obsession: the same build-result bundle is passed around as raw tuple slots instead of a named object.
3. Maintenance impact bucket: structural. Blast radius: service facade, tx builder, fee strategy family. Change frequency: medium in hot code; `service.ts` changed 9 times since 2026-03-11, `tx-request-builder.ts` 2 times, `fee-strategy.ts` 2 times.
4. Concrete evidence: `StandardTxRequestResult` and `NoFromTxRequestResult` are defined as tuples at `tx-request-builder.ts:69-70`; `FeeEstimateResult` is an 8-slot tuple at `fee/fee-strategy.ts:72-81`. Call sites destructure different positional subsets at `service.ts:538-545`, `739-742`, `894-895`, `903`, `1173-1177`, `1411`, `1801-1806`, `1849`, `1967-1971`, `2081`; strategy impls repeat the same tuple contract at `fee/fee-juice-strategy.ts:20-34`, `fee/fee-juice-with-claim-strategy.ts:28-42`, `fee/embedded-strategy.ts:35-51`, `fee/fpc-strategy.ts:47-85`.
5. Why it harms future change: adding or reordering one returned value forces coordinated edits across every destructure, and the existing `_node` / `_pxe` placeholders show many callers only need subsets but still depend on slot order.
6. Smallest safe refactoring: Replace Array with Object / Introduce Parameter Object such as `BuiltTxContext` and `EstimatedTxContext`.
7. What disappears: positional coupling, underscore placeholder locals, and brittle “slot 5 is nonce” knowledge spread across files.
8. Instances: `packages/extension/src/wallet/services/execution/tx-request-builder.ts:69-70`, `88-93`, `373`, `385-477`; `packages/extension/src/wallet/services/execution/fee/fee-strategy.ts:72-81`; `packages/extension/src/wallet/services/execution/service.ts:538-545`, `739-742`, `894-895`, `903`, `1173-1177`, `1411`, `1801-1806`, `1849`, `1967-1971`, `2081`; `packages/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts:20-34`; `packages/extension/src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts:28-42`; `packages/extension/src/wallet/services/execution/fee/embedded-strategy.ts:35-51`; `packages/extension/src/wallet/services/execution/fee/fpc-strategy.ts:47-85`.

## F5: Three single-pass fee strategies repeat the same scaffolding
1. Title: Three single-pass fee strategies repeat the same scaffolding.
2. Smell name: Duplicate Code (Fowler). This is a form of Shotgun Surgery because shared fee-estimation policy changes require touching multiple strategy classes.
3. Maintenance impact bucket: structural/local. Blast radius: 3 strategy files plus the shared helper surface. Change frequency: low individually since 2026-03-11 (`fee-juice-strategy.ts`, `fee-juice-with-claim-strategy.ts`, and `embedded-strategy.ts` each changed once), but the duplication sits on a shared policy seam.
4. Concrete evidence: each method starts with `startEstimateTask`, then calls `txBuilder.buildStandard`, `suggestGasLimits`, `simulateTxTask`, `finalizeGasLimits`, and identical `task.complete()` / `task.fail(error)` handling. See `fee/fee-juice-strategy.ts:17-38`, `fee/fee-juice-with-claim-strategy.ts:20-46`, and `fee/embedded-strategy.ts:24-55`.
5. Why it harms future change: if the simulation opts, task wrapping, or post-sim gas-finalization policy changes, the same edit has to be repeated across three classes that differ only in a small before-sim customization.
6. Smallest safe refactoring: Extract Template Method or a higher-order helper in `fee-strategy.ts` for the single-pass family, with hooks for pre-build action mutation and pre-sim gas adjustment.
7. What disappears: repeated build/simulate/finalize/error scaffolding and the need to keep three almost-identical methods in sync.
8. Instances: `packages/extension/src/wallet/services/execution/fee/fee-juice-strategy.ts:17-38`; `packages/extension/src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts:20-46`; `packages/extension/src/wallet/services/execution/fee/embedded-strategy.ts:24-55`.

## F6: Contract-registration policy is copy-pasted across execution entry points
1. Title: Contract-registration policy is copy-pasted across execution entry points.
2. Smell name: Duplicate Code (Fowler). This becomes Shotgun Surgery because any change to “how a contract becomes simulation-ready in PXE” requires edits in several unrelated helpers.
3. Maintenance impact bucket: structural. Blast radius: 4 production entry points across 3 files. Change frequency: medium; `batched-view-simulation.ts` changed 3 times since 2026-03-11 and `tx-request-builder.ts` changed 2 times, while `service.ts` is a 9-touch hotspot.
4. Concrete evidence: `buildStandard` resolves instances/artifacts and registers missing contracts at `tx-request-builder.ts:113-125`; `buildNoFrom` repeats the same pattern at `404-424`; `batchedViewSimulation` repeats it at `helpers/batched-view-simulation.ts:177-191`; `executeSimulateUtility` reimplements the single-contract variant at `service.ts:1434-1439` and then immediately re-resolves the same instance/artifact again at `1442-1443`.
5. Why it harms future change: if PXE registration rules, caching, logging, or validation evolve, builders and read helpers must all be updated together, and the duplication has already caused extra work in `executeSimulateUtility`.
6. Smallest safe refactoring: Extract Method into `ContractResolver` or a dedicated `PxeContractRegistrar` with `ensureRegistered(pxe, addresses)` and `ensureRegistered(pxe, address)` entry points.
7. What disappears: repeated `getContracts` / `resolveInstances` / `resolveArtifacts` / `registerContract` loops and the redundant double-resolution in `executeSimulateUtility`.
8. Instances: `packages/extension/src/wallet/services/execution/tx-request-builder.ts:113-125`, `404-424`; `packages/extension/src/wallet/services/execution/helpers/batched-view-simulation.ts:177-191`; `packages/extension/src/wallet/services/execution/service.ts:1434-1443`.

## Non-findings
- `packages/extension/src/wallet/services/execution/spec.ts` and `client.ts` were not flagged; the `spec/service/client` triple is an explicit house convention and these two files are thin wrappers.
- `ExecutionMutex` itself was not flagged as a Large Class; the class is cohesive and well-scoped, and the smell is the lifecycle coupling around it in F3.
- `ContractResolver` was not flagged as Lazy Class or Data Class; it is already paying down real duplication from call sites.
- `executeOperations`'s large switch was considered, but I rejected it as a separate finding because the higher-cost root causes are already captured by F1 and F2 rather than by the dispatch syntax alone.
- No dead-code finding was emitted; the scoped production files all have direct call sites or are part of the explicit execution service surface, and I did not find a safe no-registration/no-reference proof for any candidate.

## Out-of-scope observations
None.