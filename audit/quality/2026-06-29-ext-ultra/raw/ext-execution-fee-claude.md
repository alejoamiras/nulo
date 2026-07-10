# Quality audit — `extension/wallet-services-execution` (+ fee)

Scope: `packages/extension/src/wallet/services/execution/**` (all `.ts` except `*.test.ts`).
Lens: typing + dedup. Cluster size: ~30 src files, ~6.3k LOC.

Note on counts: there are **zero** `as unknown as` double-casts and **zero** `any` type
usages in production code in this cluster (all `any` grep hits are in prose comments).
The typing debt here is single-`as` narrowing casts, not double-cast escapes.

---

### EXEC-Q1 Discriminated unions re-narrowed by `as`-casts instead of `switch (x.kind)` / type-guard filters
- Smell: Switch Statements + analog **Cast-as-Narrowing** (mapping: the union already carries
  a `kind` literal discriminant, so the narrowing the casts perform is exactly what TS does for
  free in a `switch`/`if (x.kind === …)`; the cast *replaces* type-system narrowing and silences
  it). Several instances are outright **redundant** — the compiler has already narrowed.
- Lens: typing
- Maintenance impact: structural
- Blast radius: 3 files (dapp-send-executor, operation-planner, contract-resolver); the union
  definitions live in `@nulo/wallet-bridge` (`operation.ts`, `action.ts`, `authwit-content.ts`)
  and are consumed cluster-wide.
- Instances (ALL):
  - `Operation`-narrowing casts (post-guard, **redundant** — TS narrows via the `kind` discriminant):
    - `dapp-send-executor.ts:140` `(operation as AztecSendTxOperation).exec`
    - `dapp-send-executor.ts:141` `(operation as AztecSendTxOperation).opts ?? {}`
    - `dapp-send-executor.ts:146` `[...(operation as SendTransactionOperation).actions]`
    - `dapp-send-executor.ts:151` `{ ...operation, actions: [...actions] } as SendTransactionOperation`
    - `dapp-send-executor.ts:164` `{ ...operation, … } as SendTransactionOperation`
  - `Operation`-narrowing casts via the weaker `"exec" in operation` test (a `switch (operation.kind)` removes both):
    - `operation-planner.ts:266` `(operation as AztecSendTxOperation).exec?.calls?.length`
    - `operation-planner.ts:267` `(operation as AztecSendTxOperation).exec.calls.map(…)`
  - Callback-param casts (the discoverer's `BuildTxRequestFn` param is typed to the structural
    input shape, then cast to the nominal op):
    - `dapp-send-executor.ts:154` `op as SendTransactionOperation`
    - `dapp-send-executor.ts:352` `o as SendTransactionOperation`
  - `Action` → `AuthwitContent` casts forced by `Array.filter` NOT narrowing element type
    (a typed type-guard predicate, or one `for…of` + `switch`, removes all four):
    - `contract-resolver.ts:90` `(x as AddPrivateAuthwitAction).content as CallAuthwitContent`
    - `contract-resolver.ts:94` `(x as AddPrivateAuthwitAction).content as EncodedCallAuthwitContent`
    - `contract-resolver.ts:99` `(x as AddPublicAuthwitAction).content as CallAuthwitContent`
    - `contract-resolver.ts:104` `(x as AddPublicAuthwitAction).content as EncodedCallAuthwitContent`
  - Downcast-after-widen (**redundant** — `fn` is declared `Fn`, whose abstract
    `buildArgs(...args: unknown[]): unknown[]` already accepts the 3-arg call; the variant cast
    buys nothing):
    - `operation-planner.ts:111` `(fn as TransferPrivateFn).buildArgs(…)`
    - `operation-planner.ts:119` `(fn as TransferPrivateToPublicFn)?.buildArgs(…)`
    - `operation-planner.ts:127` `(fn as TransferPublicFn)?.buildArgs(…)`
    - `operation-planner.ts:135` `(fn as TransferPublicToPrivateFn)?.buildArgs(…)`
- Evidence: `Operation = RegisterContractOperation | … | AztecSendTxOperation`
  (`wallet-bridge/src/operation.ts:14`) and `Action = … | CallAction | EncodedCallAction`
  (`wallet-bridge/src/action.ts:5`) and `AuthwitContent = CallAuthwitContent | … `
  (`wallet-bridge/src/authwit-content.ts:3`) are all textbook discriminated unions keyed on a
  `readonly kind: "<literal>"` field. In `estimateOperationFee` the throw-guard at
  `dapp-send-executor.ts:131` already narrows `operation` to
  `SendTransactionOperation | AztecSendTxOperation`, and `if (operation.kind === "aztec_sendTx")`
  (138) narrows each branch to a single member — so the casts on 140/141/146 re-assert a type the
  compiler has already inferred.
- Why it harms future change: a cast is a standing instruction to the compiler to stop checking.
  If a wallet-bridge op/action variant gains, loses, or renames a field, every one of these sites
  keeps compiling green and fails at runtime instead of at `tsc`. The `filter().map(cast)` form in
  `contract-resolver.extractContracts` is the most brittle: add a new authwit-bearing action kind
  and the extractor silently omits its contract address (no compile error), so its contract never
  registers and the build throws `"Contract not found"` at a confusing distance.
- Refactoring: *Replace Conditional with Polymorphism* is overkill here; the right move is
  *Replace Type Cast with Exhaustive Switch* — drop the casts in `estimateOperationFee`/
  `extractPrimaryMethod` (the discriminant already narrows), and rewrite `extractContracts` as a
  single `for (const a of actions) switch (a.kind) { … }` (or a `(a): a is …Action =>` type-guard
  filter). Drop the `fn as Transfer*Fn` downcasts entirely. Net: ~15 casts gone, exhaustiveness
  restored (a missing `case` becomes a `tsc` error).
- Effort: hours
- Confidence: high

---

### EXEC-Q2 The four dApp/transfer send pipelines duplicate the slot→journal→try/catch/finally scaffold, the post-send record closure, and the authwit-discovery block
- Smell: Long Method + Duplicate Code (the three `DappSendExecutor` execute methods are 60–180
  LOC each, and `executeAztecSendTx` vs `executeNoFromSendTx` are ~85% identical in their
  non-domain scaffolding).
- Lens: dedup
- Maintenance impact: architectural
- Blast radius: 2 files (`dapp-send-executor.ts`, `transfer-executor.ts`); the scaffold also reaches
  `execution-lane.ts` (acquireSlot/claim/markJournal) and `execution-coordinator.ts` (proveAndSend).
- Instances (ALL):
  - **Post-send `recordTransaction` closure** — `addTransaction(origin, chainId, address, txCalls,
    nonce, feePaymentMethod, hash, primaryEndpointUrl(network), getEstimatedFee(txRequest),
    getGasDetails(txRequest))` (10 positional args) + `if (pendingPublicAuthwits.length) …
    recordPendingAuthwits`:
    - `dapp-send-executor.ts:230-246` (executeSendTransaction)
    - `dapp-send-executor.ts:386-402` (executeAztecSendTx) — byte-identical to the above
    - `dapp-send-executor.ts:577-589` (executeNoFromSendTx) — variant: `Fr.ZERO` nonce,
      `EXTERNAL` method, no pending-authwit tail
    - `transfer-executor.ts:206-237` — 4th variant (hardcoded transfer-only `txCalls`)
  - **acquire-slot → hoist `journalId` → try { claimOrCreateJournal → checkCancelled →
    markJournal("simulating") → … } catch { markFailedUnlessCancelled } finally { deleteController;
    releaseSlot }** scaffold:
    - `dapp-send-executor.ts:291-417` (executeAztecSendTx)
    - `dapp-send-executor.ts:444-604` (executeNoFromSendTx) — same scaffold, different middle
  - **Cancel/finally tail** (`markFailedUnlessCancelled(error, journalId, lane)` + `if (journalId)
    deleteController` + `releaseSlot()`):
    - `dapp-send-executor.ts:249-254`, `:410-416`, `:597-603`
  - **Private-authwit discovery block** (`discoverPrivateAuthwits({ …op, actions:[…] }, async (o,
    method) => buildStandard(o as SendTransactionOperation, method))` → `if (len) actions.push(…)`):
    - `dapp-send-executor.ts:150-162` (estimateOperationFee)
    - `dapp-send-executor.ts:348-362` (executeAztecSendTx)
  - **checkCancelled closure** (`controller?.signal.aborted ⇒ throw new JobCancelledSentinel(…)`)
    appears verbatim 4×: `dapp-send-executor.ts:204-206`, `:322-324`, `:473-475`;
    `transfer-executor.ts:130-132`.
- Evidence: `executeAztecSendTx` (257) and `executeNoFromSendTx` (424) differ only in the
  domain core (standard build+discovery vs kernelless discovery + inline `feeOpts`); the
  ~40 LOC of slot/journal/cancel orchestration wrapping each is copy-paste. The coordinator
  already extracted the prove→send tail (`proveAndSend`), proving the team's own appetite for this
  shape — the *front half* (slot+claim+cancel) was left un-extracted.
- Why it harms future change: this is the cluster's load-bearing concurrency/cancel scaffold, and
  its own JSDoc (`dapp-send-executor.ts:16-27`) lists "frozen ordering invariants (do not
  reorder)". A fix to one invariant (e.g. moving the `markJournal("simulating")` checkpoint, or
  changing the `releaseSlot` ordering) must be hand-applied to 2–3 near-identical copies and
  re-verified against each — exactly the Shotgun-Surgery failure mode where copies drift and one
  path leaks a mutex slot (wedging the `(profileId, chainId)` lane until SW restart, per the
  module's own warning).
- Refactoring: *Form Template Method* / *Extract Method* — a single
  `lane.withExecutionSlot(op, origin, hooks, async ({ journalId, checkCancelled, markJournal }) =>
  domainCore)` higher-order wrapper owns acquire/claim/try/catch/finally once; the three execute
  bodies shrink to their domain core + a shared `recordTransaction` builder
  (`buildActivityRecorder(deps, { origin, network, txCalls, nonce, feePaymentMethod,
  pendingPublicAuthwits })`). The authwit-discovery block becomes one private method.
- Effort: days
- Confidence: high

---

### EXEC-Q3 Single-pass fee strategies (`fj` / `fjwc` / `embedded`) are a copy-paste template kept in lockstep by structural-parity tests
- Smell: Duplicate Code + analog **Dedup-by-Convention** (mapping: the three impls are not unified
  in code; they are held identical by `strategies-structural.test.ts` — a test whose stated job is
  to fail when the copies diverge, i.e. the test exists *because* the duplication is fragile).
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 4 files (3 strategy impls + the 2 parity test fixtures that pin them).
- Instances (ALL):
  - `fee/fee-juice-strategy.ts:17-36` — `startEstimateTask` → `buildStandard(PREEXISTING)` →
    `suggestGasLimits` → `simulateTxTask({simulatePublic:true,skipFeeEnforcement:true,
    scopes:[account.address]})` → `finalizeGasLimits` → `task.complete()` →
    `return { ...built, feePaymentMethod }`; `catch { task.fail(error); throw error }`.
  - `fee/fee-juice-with-claim-strategy.ts:20-44` — identical skeleton; deltas: `unshift` claim
    payload before build (27), `FEE_JUICE_WITH_CLAIM` method.
  - `fee/embedded-strategy.ts:24-53` — identical skeleton; deltas: `applyEmbeddedFpcGasCap`
    between suggest and simulate (38), `1` multiplier (46), computed `embeddedMethod`.
  - (`fee/fpc-strategy.ts` is a genuine two-pass build and is NOT part of this duplication —
    correctly distinct.)
  - Lockstep guards: `fee/strategies-structural.test.ts`, `fee/fee-structural-parity.test.ts`.
- Evidence: the try-body of all three is the same `build → [optional pre/mid hook] → suggest →
  simulate(<the exact same opts literal>) → finalize → return {...built, method}` sequence with the
  same `catch { task.fail; throw }`. The simulate-opts object literal
  (`{ simulatePublic: true, skipFeeEnforcement: true, scopes: [account.address] }`) is repeated
  verbatim at `fee-juice-strategy.ts:25`, `fee-juice-with-claim-strategy.ts:33`,
  `embedded-strategy.ts:41`.
- Why it harms future change: adding a fee kind = copy the skeleton + author a new parity fixture;
  changing the shared sequence (e.g. a new cancel checkpoint, a sim-opts field, a task-step name)
  = edit N copies and keep the parity test in sync. `fpc-strategy.ts:35` already shows the failure
  mode — the per-impl `if (kind !== "fpc") throw` guard re-validates a discriminant the dispatcher
  (`service.ts:712`) already keyed the map on (the `FeeStrategy.kind` field is the contract), so the
  guard is dead defensive code copied per strategy.
- Refactoring: *Form Template Method* — a `SinglePassFeeStrategy` base owns the
  `build→suggest→simulate→finalize→return` body; subclasses supply only
  `{ paymentMethod, feeMultiplier, mutateActions?(ctx), preSimulate?(txRequest, fee, node) }`. The
  shared simulate-opts literal becomes one constant. The `strategies-structural.test.ts` collapses
  to testing the base once + the three hook configs, removing the per-strategy parity burden the
  repo-map flagged.
- Effort: hours
- Confidence: moderate (the repo *deliberately* standardizes these via parity tests; this is a
  cost-reduction call, not a defect — but the cost is real and recurring per new fee kind).

---

### EXEC-Q4 Stringly-typed `EncodedCallAction.type` / `returnTypes` forces `as FunctionType` casts and mutating field-backfill across the build + authwit paths
- Smell: Primitive Obsession + analog **Stringly-Typed** (mapping: `type` carries a `FunctionType`
  enum value but is declared `string`; `returnTypes` carries ABI types but is `unknown[]` — both
  force a cast/re-parse at every consumer instead of being the domain type at the boundary).
- Lens: typing
- Maintenance impact: structural
- Blast radius: cross-package — the loose decl is in `@nulo/wallet-bridge`
  (`action.ts:52,54`); the casts/re-parses + backfill mutations land in 2 execution files.
- Instances (ALL):
  - Root loose decl: `wallet-bridge/src/action.ts:52` `type?: string`,
    `wallet-bridge/src/action.ts:54` `returnTypes?: unknown[]` (on `EncodedCallAction`; mirrored on
    `EncodedCallAuthwitContent` via `Omit<EncodedCallAction,"kind">`, `authwit-content.ts:10`).
  - `tx-request-builder.ts:318` `action.type as FunctionType` (in the `encoded_call` build case).
  - `tx-request-builder.ts:308-309` mutating backfill `action.type = fn.functionType;
    action.isStatic = fn.isStatic` onto the input action.
  - `authwit-discoverer.ts:216` `content.type as FunctionType`.
  - `authwit-discoverer.ts:220` `await z.array(AbiTypeSchema).parseAsync(content.returnTypes)` —
    a runtime re-parse forced only because `returnTypes` is `unknown[]`.
  - `authwit-discoverer.ts:204-207` mutating backfill of `content.name/type/isStatic/returnTypes`.
- Evidence: `FunctionType` is a string-backed enum (the code relies on this at
  `fast-path.ts:99` `obj.type !== FunctionType.PUBLIC` surviving JSON round-trip), so the wire
  *could* be typed `type?: FunctionType` with no serialization change — the `string` is a missed
  opportunity, not a constraint. The cast then propagates: `action.type as FunctionType` at the
  `FunctionCall` constructor.
- Why it harms future change: every consumer of `EncodedCallAction.type` must cast and every
  consumer of `returnTypes` must re-parse; a typo'd type string (or a non-enum value) is never
  caught at the boundary, only deep inside `FunctionCall` construction. The mutate-the-input
  backfill (`action.type = …`) compounds it — the action is both input and scratch space, so the
  cast hides that the field is sometimes absent and lazily filled.
- Refactoring: *Replace Primitive with Type* — narrow `EncodedCallAction.type` to
  `FunctionType` and `returnTypes` to `AbiType[]` in wallet-bridge (Zod-parse once at the dispatcher
  seam where dApp input enters), deleting the two `as FunctionType` casts and the `z.array(
  AbiTypeSchema)` re-parse. The backfill stays but operates on typed fields.
- Effort: hours (cross-package — touches wallet-bridge + the schema-parse seam; coordinate with the
  `nulo-schema-patch` reachability test).
- Confidence: moderate

---

## Out-of-focus notes (not scored as quality findings)

- **Acknowledged @aztec-boundary casts (not flagged):** `dapp-send-executor.ts:406,409,593,596`
  `… as SendReturn<InteractionWaitOptions>` (4× — the same `{ txHash | receipt, ...offchainOutput }`
  shape cast to an upstream conditional type), `view-executor.ts:128` `result as AbiDecoded`,
  `view-executor.ts:279` `rawCalls as never`, `fast-path.ts:196` `… as PartialGasSettingsRPC |
  undefined`, `fast-path.ts:212` `[] as TxSimulationResult[]`. These narrow to opaque upstream
  generics with no in-repo discriminant; they are forced at the library boundary, not avoidable
  noise. The 4× `as SendReturn` is mild dedup (one `buildSendReturn(txHash|receipt, offchainOutput)`
  helper would collapse it) but the cast itself is not removable without an upstream type change.
- **`ExecutionService` (service.ts, 725 LOC) is borderline Large Class but deliberately so:** the
  executors (transfer/dapp-send/view) and lane/coordinator/planner are already extracted; what
  remains inline is the `executeOperations` 22-case dispatcher (355-470) + 6 register/authwit
  handlers (474-687). `execution-coordinator.ts:7-19` documents keeping those handlers on the facade
  as an explicit scope decision. Worth a periodic re-check (the 6 handlers are a Divergent-Change
  surface), but consistent with the cluster's documented composition-root pattern — not scored.
- **Correctness (other focus, FYI):** `view-executor.ts:99-100` re-runs `resolver.resolveInstance`
  + `resolveArtifact` immediately after the identical pair at 93-94 inside the `if (!registered…)`
  block — a redundant double PXE round-trip on the cold path, not a quality smell per se.

## Summary
5 findings (4 scored + boundary/Large-Class notes). Highest value: **EXEC-Q2** (the four send
pipelines duplicate the load-bearing slot/journal/cancel scaffold + record closure 3–4×, an
architectural Shotgun-Surgery risk on the concurrency path); runner-up **EXEC-Q1** (discriminated
unions re-narrowed by ~15 `as`-casts, several redundant, defeating exhaustiveness on the
dApp→execution operation boundary).
