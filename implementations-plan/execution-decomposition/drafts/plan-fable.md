# Execution decomposition — fable draft

Independent planner draft (fable). Inputs: `implementations-plan/execution-decomposition/brief.md`, `audit/quality/2026-06-11-ultra-50b45d/findings/verified.md` (Q4, Q5, Q17, Q18, Q23 + constraints registry), full source read of `packages/extension/src/wallet/services/execution/`.

## Thesis

Order the arc **mechanical-first, fragile-last**: Q17 (resolver helpers) → Q18-internal (tuples → named objects) → Q5 (one pipeline tail) → Q4 (caches out, handlers out) → Q23 (cancellation handshake), with a facade characterization harness *before* any extraction. Two opinionated calls that differ from the obvious plan:

1. **Q18 tuples land BEFORE the Q5 tail extraction.** The tail helper's signature is exactly the tuple payload. Extract the tail first and you write `proveAndSend` against `built[0]..built[7]` positional locals, then re-touch the helper and all four callers again when the tuples die — double churn on the single most dangerous function in the wallet. Tuples-first is compiler-verified (rename-only, zero control-flow change), and it converts the tail extraction from "8 same-typed positional slots crossing a function boundary" into "one named object" — eliminating the transposition hazard precisely where a silent swap (e.g. `gasLimits` ↔ `teardownGasLimits`) costs real fees.
2. **Q18 stops at the package boundary.** The internal tuple family (`StandardTxRequestResult`, `NoFromTxRequestResult`, `FeeEstimateResult`, the `processAztecJsPayload` triple) is grep-confirmed execution-internal (no consumer outside `execution/`). The 7-param transfer clump on the *RPC wire* (`spec.ts:18-27`, `client.ts:22-43`) stays positional: changing it churns spec + client + popup callers + the wire shape for zero unit-testability gain, and verified.md itself rates it "separate, broader API churn — not the smallest first step". Recorded as a Decision, not deferred ambiguity.

## Done-conditions → /goal-verifiable signals

| Done condition (brief §answers.2) | Verifiable signal |
|---|---|
| (a) ONE pipeline tail, 4 callers | `rg -c "coordinator.proveAndSend" packages/extension/src/wallet/services/execution/service.ts` = 4; `rg -c "proveTxTask\|sendTxTask" .../execution/service.ts` = 0; `execution-coordinator.ts` header no longer false (claims only what exists) |
| (b) `service.ts` ≤ ~1,200 lines; caches in own unit-tested modules | `wc -l .../execution/service.ts` ≤ 1200; `estimate-reuse.ts` + `gas-balance-cache.ts` exist with sibling `.test.ts`; `bun run test` runs both |
| (c) zero behavior change, e2e-proven per phase, quirks preserved | `bun run e2e:agent` green at every checkpoint; codex parity verdict logged per phase in `lessons/`; `(BUG PIN)` tests enumerate every preserved quirk (list in Phase notes below) |
| (d) every extracted module ships colocated tests in the same checkpoint | per-checkpoint review rule: a new `<name>.ts` without sibling `<name>.test.ts` in the same commit range fails the checkpoint; verify via `git diff --name-only <prev-checkpoint>..HEAD` |

## Phase plan

Delivery shape (fixed by brief): one branch (`refactor/execution-decomposition` off `dev`), stacked checkpoints, one final PR, RC build + manual QA before merge. Each phase ends in a checkpoint commit `refactor(execution): checkpoint N — <slug>`.

Per-phase gate (fixed by brief): `bun run lint` + `bun run test` + `bun run e2e:agent` + codex parity review of extracted-vs-original (verdict logged in `lessons/phase-N.md`).

### Phase 0 — Baseline + facade characterization harness (tests only, zero src change)

**Goal.** Green baseline of all gates at the branch point (so later failures are attributable, including the e2e flake profile), plus pre-extraction characterization of the three facade subsystems about to move. The facade has almost no direct tests — only `feesettings-invariant.test.ts` and `fingerprints.test.ts` touch `service.ts` exports. `feesettings-invariant.test.ts:27-34` already demonstrates the harness trick: construct `ExecutionService`, set protected/private fields via `as unknown as {...}` casts (no `any`), stub only the services each method touches.

**Tests to write (all keep passing unmodified through every later phase — they ARE the parity proof):**
- `tryConsumeTransferEstimate` (`service.ts:619-715`): all six rejection branches (TTL, input drift incl. `fingerprintFeeSettings` mismatch, profile drift, missing/changed primary endpoint, base-fee drift, base-fee fetch failure → conservative reject, pending-set drift) + single-shot delete-on-read (`:632`) + happy-path entry return. Stubs: profileService/networkService/transactionService field injection.
- `cancelJob` (`service.ts:836-867`): FSM-reject → signal dropped silently, controller NOT aborted; FSM-accept → abort + map delete; unknown id idempotence.
- `getGasBalances` (`service.ts:1476-1502`): TTL hit, `forceRefresh` bypass, single-flight dedup (two concurrent callers, one compute), in-flight cleanup on rejection. `#computeGasBalances` is unreachable (native-private) — mock `./helpers/get-view-simulation-deps` + `batchedViewSimulation` via `vi.mock`.
- Transaction-settle + PrivateFpc-mutation cache invalidation listeners (`service.ts:382-402`): pin the key-suffix match (`endsWith(":${tx.account}")`) and the full-clear on PrivateFpc.

**Files.** `service.characterization.test.ts` (new, colocated; survives the arc — at arc end, retarget imports if helpers moved, assertions unchanged). No src edits.
**Gate.** Full gate incl. one `e2e:agent` baseline run; record wall-time + any flaky test names in `lessons/phase-0.md`.
**Revert.** Trivially droppable (tests only).
**Effort.** 0.5–1 day.

### Phase 1 — Q17: complete the ContractResolver extraction

**Goal.** Kill the re-inlined lookup/registration families by extending the existing `ContractResolver` (per verified.md's refinement: extend, don't new-module). Three additions:
- `ensureRegistered(pxe, instances, artifacts)` — the `getContracts() → Set → registerContract` prologue (`tx-request-builder.ts:117-126` and `:412-424`, `helpers/batched-view-simulation.ts:183-192`, `service.ts:1434-1440`).
- `findFunctionByName(artifact, name)` — name-lookup (`tx-request-builder.ts:279-281`, `service.ts:1445-1446`, `authwit-discoverer.ts:149-151`; absorb the existing local at `batched-view-simulation.ts:577-579`).
- `findFunctionBySelector(artifact, selector)` — selector-scan loop (`tx-request-builder.ts:315-331`, `authwit-discoverer.ts:201-217`; absorb local at `batched-view-simulation.ts:581-591`).

**Constraint compliance (registry #6).** Helpers return `undefined`/perform; **throwing stays at call sites** so per-caller error strings survive byte-for-byte (`"Contract not found"` / `"Method not found"` in tx-request-builder vs `"Contract instance not found"` in resolver vs lowercase `"contract instance not found"` in token-service). No message parameterization needed if helpers never throw — strictly simpler than the audit's suggestion.

**Cross-service sub-step (separately committed, separately bail-able).** `token/service.ts:299-305,384-390` and `fpc/service.ts:255-261` share only the "if not in getContracts(), registerContract" step with locally-resolved instance/artifact. Convert to a tiny `ensureContractRegistered(pxe, address, {instance, artifact})` overload. If error-string or behavior variance makes this non-mechanical, bail on the sub-step: the execution-package sites alone resolve Q17's hot core; log the bail in `lessons/phase-1.md`.

**Files.** `contract-resolver.ts` (+tests in `contract-resolver.test.ts`), `tx-request-builder.ts`, `authwit-discoverer.ts`, `helpers/batched-view-simulation.ts`, `service.ts:1434-1446`; sub-step: `token/service.ts`, `fpc/service.ts`.
**Quirk pins.** `(BUG PIN)` if needed: selector-scan checks `artifact.functions` fully before `nonDispatchPublicFunctions` (ordering observable when a selector exists in both); `encoded_call` path *mutates* `action.type`/`action.isStatic` backfill (`tx-request-builder.ts:335-336`) — backfill stays at the call site, NOT in the resolver helper.
**Gate.** Standard. Parity review focus: lookup order + error-throw sites unchanged.
**Revert.** Self-contained; later phases don't depend on the helper names (they pass through them). Cleanly revertable even mid-stack.
**Effort.** 0.5 day.

### Phase 2 — Q18 (internal): named result objects replace positional tuples

**Goal.** Replace the execution-internal tuple family with named-field objects; kill `built[0]..built[7]` indexing and `_`-placeholder destructuring.

- `tx-request-builder.ts:69-70`: `StandardTxRequestResult` → `interface BuiltTxRequest { txRequest; node; pxe; account; network; nonce; txCalls }`; `NoFromTxRequestResult` → `BuiltNoFromTxRequest` (no `nonce`).
- `fee/fee-strategy.ts:72-81`: `FeeEstimateResult` 8-tuple → `interface EstimatedTxRequest extends BuiltTxRequest { feePaymentMethod }`. Update all four strategies + `buildAndEstimateTxRequest` (`service.ts:2265-2301`) + every consumer (`service.ts:538-545,739-742,894-895,903,1173-1177,1411,1801-1805,1849,1953-1956,1967-1971,2081`).
- `operation-planner.ts:153-156`: `processAztecJsPayload` triple → `{ actions, feePaymentMethod, feeOptions }`.

**FpcStrategy handling (constraint registry #3 — the load-bearing one).** `fpc-strategy.ts` is byte-parity-sensitive: the two-pass `op.actions` mutation (`:41,62,82`) and the `let [a,…] = …; [a,…] = …` re-binding (`:47,64`) must keep identical *execution order and values*. The tuple→object change converts re-binding destructure into `let built = await …; … built = await …` with field access — control flow identical, **no normalization into the single-pass family, no touching the unshift/splice sequence, the `originalActions` capture, or the `GasSettings` construction at `:69-74`**. Codex parity review for this phase is instructed to diff FpcStrategy statement-by-statement.

**Why before Q5** (argued in Thesis): the Q5 helper consumes exactly this payload; doing tuples second re-touches the freshly extracted tail + 4 callers. Also: this phase is the cheapest place in the arc to catch a transposition (compiler flags every field use), whereas post-Q5 the same mistake hides inside a helper boundary.

**Explicitly NOT in this phase (Decision):** `spec.ts`/`client.ts` RPC method signatures and the wire shape stay positional; `TransferEstimateReuseEntry`'s input clump is bundled in Phase 4 instead (it moves anyway).

**Files.** `tx-request-builder.ts`, `fee/fee-strategy.ts`, 4 strategy files, `operation-planner.ts`, `service.ts` (consumer lines only), `authwit-discoverer` build callback shapes (`service.ts:894,1953`).
**Tests.** Compiler is the main net; add one strategy-level shape test (each strategy returns all fields non-undefined on a stubbed builder) + keep `embedded-fpc-cap.test.ts`/`operation-planner.test.ts` green unmodified.
**Gate.** Standard. e2e focus runs: `fee-methods`, `tx-sendTx-sponsoredFpc`, `tx-sendTx-feePayer`, `transfers`.
**Revert.** Mechanical revert; conflicts only with Phase 1 in `tx-request-builder.ts` (disjoint hunks).
**Effort.** 0.5–1 day.

### Phase 3 — Q5: the real `proveAndSend` (one tail, four callers)

**Goal.** Build the `ExecutionCoordinator.proveAndSend` that `execution-coordinator.ts:15-19` falsely claims exists, and convert all four send paths. Fix the false header **in the same commit** — that doc is the repo's standing example of a half-done migration; this phase's first deliverable is making it true.

**Helper shape (from the four tails as actually written — `service.ts:548-599, 1179-1203, 1973-2004, 2163-2194`):**

```ts
type ProveAndSendArgs = {
  built: EstimatedTxRequest | (BuiltNoFromTxRequest & { nonce: Fr; feePaymentMethod: AccountFeePaymentMethodOptions })
  scopes: AztecAddress[]                  // transfer: [account]; aztec: [account, ...additionalScopes]; noFrom: scopesWithAccount
  txCalls: TxCall[]                       // transfer passes its hand-built activity shape (NOT builder txCalls — preserved verbatim, see pin)
  origin: LocalTxOrigin
  accountAddressForHistory: string        // transfer: input accountAddress; others: account.address.toString()
  wantOffchainOutput: boolean             // aztec + noFrom: true (timestamp + extractOffchainOutput between prove and toTx)
  checkCancelled: () => void
  markJournal: (progress: JobProgress, error?: JobError | null) => Promise<void>
  parentTask?: WrappedTask
}
// returns { txHash: TxHash, offchainOutput?: ... }
```

Owned sequence (identical across all four today): `checkCancelled → markJournal(proving, enteredProveAt) → proveTxTask → checkCancelled → [offchain extract] → toTx → markJournal(submitting, txHash) → checkCancelled → sendTxTask → addTransaction(...) → markJournal(succeeded, txHash)`.

**What deliberately stays per-caller** (this is where a naive plan over-generalizes and dies):
- All preparation (planner/builder/strategy/discovery/NO_FROM's mid-pipeline simulate+`finalizeGasLimits` at `service.ts:2155-2161`).
- **Catch/finally blocks.** They genuinely differ: `executeTransfer` calls `maybeRethrowAsRpcCancel` + `transferTask.fail` (`:600-606`; `rpc-cancel.ts:28-34` COVERAGE NOTE explicitly orders "preserve the call"); the three dApp paths rethrow the raw sentinel (classified upstream by `classifyOperationCatch`); aztec/noFrom additionally `releaseSlot()` in finally. Extracting the catch shape would change cancel semantics — out of scope.
- Slot acquisition + journal claim (`acquireExecutionSlot`/`claimOrCreateDappExecuteJournal`) — Q23's territory, untouched here.
- Receipt wait / `NO_WAIT` return shaping (`:2000-2004, 2190-2194`).
- The pre-tail `markJournal({stage:"simulating"})` placement (it brackets *preparation*, not the tail).

**Quirk pins (`(BUG PIN)` tests in this checkpoint):**
- Cancel between prove and submit drops the proof silently and never calls `sendTx` (pin at helper level with stub pxe/node — the e2e `cancel-mid-prove` covers only one timing window).
- `addTransaction` runs BEFORE `markJournal(succeeded)`; a thrown `addTransaction` therefore lands the journal in `failed` even though the tx is already broadcast — surprising, preserved.
- `markJournal` swallows journal-storage errors (log-only, `service.ts:1401-1408`) — the pipeline never fails on journal writes.
- `executeSendTransaction` acquires NO execution slot (only the two `aztec_sendTx` paths serialize; `service.ts:1130-1213` has no `acquireExecutionSlot`) — surprising vs the mutex doc's "both send paths", preserved + pinned as documentation-of-record.
- `executeTransfer` persists the transfer-only activity shape, not builder `txCalls` (`:561-596`) — fee-payload pollution pin.

**Files.** `execution-coordinator.ts` (+`execution-coordinator.test.ts` — new, the helper's unit tests with stubbed pxe/node/journal/transactionService), `service.ts` (4 call sites).
**Gate.** Standard. e2e focus: `transfers`, `tx-sendTx-*` (all five), `cancel-mid-prove`, `concurrent-sendtx*`, `batch-*`. Codex parity: side-by-side of each original tail vs helper call, instruction to verify stage-transition order and checkCancelled placement statement-by-statement.
**Revert.** Highest-value revert target; conflicts with Phase 2 consumer lines are expected — reverting Phase 3 alone is possible (helper + 4 call-site hunks), reverting Phase 2 after 3 is not (stacked rule: revert top-down).
**Effort.** 1–1.5 days. **This is the phase most likely to stall** (see self-check §below).

### Phase 4 — Q4a: estimate-reuse subsystem → `estimate-reuse.ts`

**Goal.** Move the transfer-estimate reuse cache out of the facade as a unit-testable class: `TransferEstimateReuseEntry` (`service.ts:154-190`), `fingerprintBaseFee`/`fingerprintFeeSettings` (`:192-224`), validation (`:619-715`), eviction + TTL (`:295-296, 812-823`), and the cache-write block inside `estimateTransferFee` (`:746-801`). Bundle the 7-field transfer-input clump as a named `TransferReuseInputs` type (the Q18 remainder).

**Design.** `class TransferEstimateReuseCache` with injected async lookups (`getActiveProfile`, `getNetwork`, `getNode`, `getPendingForAccount`, `logDebug`) — NOT eager snapshots, because rejection branches short-circuit (a TTL miss must not call `getNetwork`; laziness is observable via PXE/node traffic and the debug log stream). Fingerprint contract is pinned by `fingerprints.test.ts` — move the functions, keep a re-export from `service.ts` OR retarget the test imports (prefer retarget; `service.ts` export surface shrinks). Phase-0 characterization tests keep passing through the facade unmodified — that is the parity proof for this phase.

**Files.** `estimate-reuse.ts` (+`estimate-reuse.test.ts` — absorb/extend `fingerprints.test.ts`), `service.ts` (−~240 lines), `spec.ts` untouched.
**Gate.** Standard. e2e focus: `transfers` (reuse fast path), `send-amount-clamp`.
**Revert.** Disjoint from Phases 1–3 regions; surgically revertable.
**Effort.** 0.5–1 day.

### Phase 5 — Q4b: gas-balance subsystem → `gas-balance-cache.ts`

**Goal.** Extract TTL cache + single-flight dedup + invalidation API: fields (`service.ts:280-302` partial), listeners wiring (`:382-402` — facade keeps the *subscription*, cache exposes `invalidateAccount(account)` / `clear()`), `getGasBalances` orchestration (`:1476-1502`), and `#computeGasBalances` (`:1504-1575`) as an injected fetcher. The single-flight promise-map semantics (including `.finally` cleanup before set, and dedup-by-key) are the regression-sensitive part — the `project_getgasbalances_timeout_regression` memory documents the original stampede bug.

**Files.** `gas-balance-cache.ts` (+test: TTL, forceRefresh, single-flight, invalidation key-matching `endsWith(":${account}")`, PrivateFpc full-clear), `service.ts` (−~110 lines).
**Gate.** Standard. e2e focus: `fee-methods`, popup smoke (Send page mounts multiple concurrent callers).
**Revert.** Fully disjoint; surgically revertable.
**Effort.** 0.5 day.

### Phase 6 — Q4c: handler relocation to hit ≤1,200 (cohesive families, complete moves only)

**Goal.** The line target needs more than the caches (arithmetic below). Move two *complete* handler families to collaborator modules, verbatim, with the facade keeping one-line delegation and the `executeOperations` switch (`service.ts:914-1029`) staying put — it IS the RPC surface, and moving half a dispatcher is exactly the 6th-half-done-migration trap. Update the coordinator header's "Future work" list to match reality in the same commit.

- `handlers/registration-handlers.ts`: `executeRegisterContract/Sender/Token` (`service.ts:1033-1128`) + `executeSimulateTransaction/Utility` (`:1410-1474`).
- `handlers/aztec-read-handlers.ts`: the ten Aztec.js read/sim handlers (`:1579-1858`) + `executeAztecCreateAuthWit` (`:2207-2257`) + `pickActionMethod` (`:136-148`) where consumed.
- `getEstimatedFee`/`getGasDetails` (`:226-247`) move to a shared `helpers/fee-readout.ts` (consumed by Phase-3 coordinator + estimate paths).

**Line budget (arithmetic, from current 2,302):** Q5 tail ≈ −140 · estimate-reuse ≈ −240 · gas-balance ≈ −110 · registration+simulate ≈ −150 · aztec read family ≈ −300 · fee-readout ≈ −25 · import shrink ≈ −40 → ≈ 1,300, minus the Phase-7 slot/cancel move ≈ −150 → ≈ **1,150**. The ≤1,200 target must NOT depend on Phase 7 (the riskiest), so Phase 6 includes a check: if `wc -l` > 1,200 post-Phase-6, the remaining lever is moving `beginDappExecuteJournal` + `markJournal` + the waiter-heartbeat trio (mechanical, ~80 lines) into the Phase-7 module *early* — but never the dispatcher switch.

**`assertLiveChainIdentity` regression guard.** Three of the five call sites move in this phase (`service.ts:1651, 2136, 2219`; the other two live in `tx-request-builder.ts:112,456`). Add a pinning test: grep-count assertion (or unit test per handler with a drifted-nodeInfo stub) that each moved handler still rejects on chain-identity drift. This is V-01 territory — a dropped line here is a security regression that e2e against a *healthy* sandbox will NOT catch.

**Files.** `handlers/registration-handlers.ts`, `handlers/aztec-read-handlers.ts`, `helpers/fee-readout.ts` (all +tests — for verbatim moves, tests are thin construction/delegation + the chain-identity pins + decode-fallback pin for `executeSimulateUtility:1468-1473`), `service.ts`.
**Gate.** Standard. e2e focus: `contracts-*`, `data-*`, `meta-getChainInfo`, `sim-methods`, `register-token`, `token-add-auto-trust`.
**Revert.** Disjoint moves; surgically revertable.
**Effort.** 0.5–1 day.

### Phase 7 — Q23: cancellation/slot handshake module (bounded; bail-out defined)

**Goal.** The narrowest abstraction that makes the cross-file temporal coupling *owned* instead of incidental: a `cancellation-registry.ts` that owns `activeControllers` + registration/cleanup/abort (today a raw `Map` at `service.ts:308` shared by `cancelJob:836-867`, the four pipelines, `acquireExecutionSlot:1285-1347`, and `claim-helper.ts` via deps), and relocates `resolveExecutionMutexKey` + `acquireExecutionSlot` + the waiter-heartbeat trio (`:1256-1376`) into an `execution-slot.ts` collaborator beside `execution-mutex.ts`.

**Hard constraints honored (registry #19):**
- `claim-helper.ts:144-163` no-await invariant: the registry's `register(id, controller)` is **synchronous** (the Map write today); the claim-helper deps keep receiving the *same underlying Map* (or a registry façade whose `set` is sync) — no Promise-returning indirection, ever.
- `acquireExecutionSlot`'s synchronous-FIFO-enqueue-before-`onEnqueued` ordering (`service.ts:1308-1322`) and the mutex's enqueue-before-first-await (`execution-mutex.ts:97-120`) move verbatim, comments included. The journal side (`_transitionLocked` pre-abort awaits) is NOT touched.
- Capacity-reject → `markJournal(failed)` + `TooManyPendingError`, abort → `JobCancelledSentinel`, heartbeat membership spanning only the acquire wait — all preserved.

**New race tests (the actual payoff):** cancel-during-wait aborts acquire (exists partially in `execution-mutex.test.ts` — add the slot-level wrapper case); cancel-vs-claim with a microtask-precision harness pinning "controller present in map before any cancel-side abort can land"; capacity-reject fires `onEnqueued` exactly once (pin the documented harmless early-baton-advance, `service.ts:1318-1320`); heartbeat start/stop on first/last waiter.

**Bail-out (house 3-failure rule).** If the race tests can't deterministically pin the extracted shape after 3 attempts: stop, revert the Phase-7 src moves, keep only the race tests that pass against the *unmoved* code + a consolidated invariant doc block, log in `lessons/phase-7.md`. The arc's four done-conditions are already met after Phase 6 — this is the "stop here and still be better off" line, by construction.

**Files.** `cancellation-registry.ts`, `execution-slot.ts` (+tests), `service.ts` (−~150), `claim-helper.ts` deps type (only if the registry façade is adopted; else untouched).
**Gate.** Standard. e2e focus: `cancel-mid-prove`, `concurrency-rapid-fire`, `concurrent-sendtx*`, `connect-locked-queue`. Codex parity: instructed to verify zero new `await` on any path between journal transition and controller registration, and between mutex-`acquire()` invocation and `onEnqueued()`.
**Effort.** 1–2 days (or bail at ≤1 day).

### Phase 8 — Arc close

**Goal.** `/code-review max --fix` over the full stacked diff → codex post-impl audit (adversarial prompt per house rules) → fix round → RC build (`0.23.0-rc.next`) → manual QA script (send each fee kind; dApp sendTx standard/noFrom/sponsored; cancel mid-prove; concurrent sends; estimate→confirm reuse path) → docs: `execution/` section of the extension README, `ARCHITECTURE.md` §-pointer if the coordinator's role changed, `implementations-plan/index.md` entry, lessons closed out. PR to `dev` titled `refactor(execution): decompose execution service (Q4/Q5/Q17/Q18/Q23)`.

**Effort.** 1 day + QA turnaround.

## Test strategy

- **Characterization-first where reachable** (Phase 0): facade-level tests via the private-field-injection harness pattern already proven in `feesettings-invariant.test.ts:27-34`. These tests never change assertion content across the arc; they are the cross-phase behavioral anchor. Where true pre-extraction characterization is unreachable (the four tails — native-private flows needing pxe/node/account stubs that only exist once the helper boundary exists), the pin lands in the *same checkpoint* as the extraction (helper-level tests + codex statement-parity + e2e), which the brief's done-condition (d) demands anyway.
- **Bug-pin rule**: every surprising preserved behavior gets a `(BUG PIN)` test — enumerated per phase above (single-shot reuse delete, silent journal-write swallow, addTransaction-before-succeeded, no-slot-for-`executeSendTransaction`, onEnqueued-on-capacity-reject, selector-scan order, encoded_call backfill mutation).
- **Smallest-set discipline**: no per-handler delegation tests beyond the chain-identity and decode-fallback pins; the compiler + e2e own the mechanical moves. Target ≈ 60–80 new unit cases across the arc, not hundreds.
- **e2e**: full `e2e:agent` per phase (gate); the per-phase "focus" lists above are for *triage order* when a run goes red, not a subsetting of the gate.

## Security & Adversarial Considerations

This is the signing/proving/fee path; a refactor regression here moves user funds wrongly or breaks cancel semantics. Threat model = "what can a *plausible-looking* refactor diff silently change":

1. **Cancel-boundary deletion/reorder** — dropping one `checkCancelled` between prove and send broadcasts a tx the user cancelled. Mitigation: helper-level pin (Phase 3), `cancel-mid-prove` e2e, codex parity instructed on checkpoint placement. Residual: timing windows between boundaries are inherently unpinned.
2. **Chain-identity assertion loss (V-01 regression)** — 3 of 5 `assertLiveChainIdentity` sites move in Phase 6. e2e runs against an honest sandbox and will pass with the assertion deleted. Mitigation: per-handler drifted-nodeInfo unit pins + grep-count check in the Phase-6 gate.
3. **Fee-field transposition** — `gasLimits`↔`teardownGasLimits`, `feePerDaGas`↔`feePerL2Gas` are same-typed; e2e asserts balances within the fee-multiplier envelope, so a bounded overcharge passes. Mitigation: Phase 2 named fields (the structural fix), plus a frozen-`GasSettings` fixture test on `getGasDetails`/`getEstimatedFee` when they move (Phase 6).
4. **Estimate-reuse validation weakening** — any dropped rejection branch can serve a TxRequest built for different fee settings/endpoint/profile (the `fingerprintFeeSettings` collision class was a codex BLOCKING). Mitigation: Phase 0 pins all six branches *before* the move; laziness preserved by injected-lookup design.
5. **Mutex/FIFO ordering drift** — an innocent `await` inserted before `onEnqueued` or between cap-check and enqueue reintroduces the session-overtake / cap-bypass classes. Mitigation: Phase 7 race tests + parity instruction; mutex itself untouched all arc (no-timeout invariant, registry hard limit).
6. **FpcStrategy byte-parity** — registry #3; Phase 2 explicitly forbids touching mutation order; codex statement-diff gate.
7. **Journal FSM ordering** — marking `submitting` after `sendTx` (instead of before) changes the cancel-after-submit race the W2 fix closed (`spec.ts:71-80`). Helper pins stage order.

**What the gates do NOT cover (explicit residual risk):** fee-amount drift within the multiplier tolerance; journal-stage *timing* (only order is pinned — wall-clock-dependent reaper/heartbeat interplay is untestable in e2e at 10-min scale); offchain-output byte equivalence beyond what `tx-sendTx-feePayer`/`-sponsoredFpc` assert; log-only failure paths (swallowed `markJournal` errors produce no observable signal); SW-restart-during-phase-N interleavings (`sw-restart-network.test.ts` covers a fixed scenario only); and codex parity is a textual judgment, not a semantic proof — it will not catch emergent timing changes from moved `await` boundaries, which is why Phase 7 carries dedicated microtask-level tests instead of relying on parity review.

## Rollback story

- **Within the stack:** each checkpoint is 1–3 conventional commits ending in a `checkpoint N` commit. Reverting the *top* phase = `git revert <range>` (always clean). Reverting a *mid-stack* phase: Phases 1, 4, 5, 6, 7 touch regions disjoint from their successors and revert surgically; Phases 2→3 are coupled (3 builds on 2's types) and revert only top-down (3 then 2). This asymmetry is why the fragile phases sit late in the stack.
- **Whole-arc:** the arc lands as ONE squash-merge PR to dev → post-merge rollback is a single `git revert` of the squash commit. RC + manual QA gate before merge means dev never carries a partially-validated arc.
- **No data migrations anywhere** (no storage-shape changes in scope); rollback has no data-layer component. The journal FSM table, wire formats, and RPC signatures are unchanged by design, so an extension built from any checkpoint interoperates with existing storage.

## Effort estimate (single agent, includes per-phase e2e wall time ~30–45 min)

| Phase | Est. |
|---|---|
| 0 baseline + characterization | 0.5–1 d |
| 1 Q17 resolver | 0.5 d |
| 2 Q18 internal tuples | 0.5–1 d |
| 3 Q5 proveAndSend | 1–1.5 d |
| 4 Q4a estimate-reuse | 0.5–1 d |
| 5 Q4b gas-balance | 0.5 d |
| 6 Q4c handlers + line target | 0.5–1 d |
| 7 Q23 handshake (bounded) | 1–2 d (bail ≤1 d) |
| 8 close: reviews, RC, QA, docs | 1 d + QA |
| **Total** | **≈ 6–9 working days** |

## Assumptions

**Facts (verified against source):**
- `service.ts` is 2,302 lines; the four send pipelines at `service.ts:405-610` (transfer), `1130-1213` (sendTransaction), `1860-2015` (aztecSendTx), `2022-2205` (noFrom) share the prove→submit→record→journal tail; `execution-coordinator.ts:15-19` claims a `proveAndSend` that does not exist (file has only the 3 task wrappers).
- Tuple types (`tx-request-builder.ts:69-70`, `fee-strategy.ts:72-81`) and the `processAztecJsPayload` triple (`operation-planner.ts:156`) have zero consumers outside `packages/extension/src/wallet/services/execution/` (grep-verified).
- `executeSendTransaction` does NOT acquire the execution mutex; only the two `aztec_sendTx` paths do (`service.ts:1894, 2042` vs absence in `1130-1213`).
- Facade direct tests: only `feesettings-invariant.test.ts` (invariant via private-field harness) and `fingerprints.test.ts` (imports `fingerprintBaseFee`/`fingerprintFeeSettings` from `./service:14`).
- Q17 sites confirmed: prologue ×5 in execution pkg (`tx-request-builder.ts:117,412`; `batched-view-simulation.ts:183`; `service.ts:1434`) + array-variant ×3 in token/fpc (`token/service.ts:299,384`; `fpc/service.ts:255`); name-lookup ×4; selector-scan ×3 (one already factored locally at `batched-view-simulation.ts:577-591`).
- Constraint anchors in source: fpc two-pass mutation doc (`fpc-strategy.ts:10-23`); no-await invariant (`claim-helper.ts:144-163`); mutex no-timeout rationale (`execution-mutex.ts:5-10`); frozen error strings (`tx-request-builder.ts:16-25`, `contract-resolver.ts:14-22`); rpc-cancel preserve-the-call note (`rpc-cancel.ts:28-34`); journal global transition lock + `_transitionLocked` (`operation-journal/service.ts:52-72,212-227`).
- Network e2e suite covers all four pipelines + cancel + concurrency + fee kinds (`tests/e2e/network/`: `transfers`, `tx-sendTx-{default,noFrom,feePayer,multicall,sponsoredFpc,reject}`, `cancel-mid-prove`, `concurrent-sendtx{,-approve,-confirm}`, `fee-methods`, `concurrency-rapid-fire`).

**Inferences (moderate confidence):**
- The private-field characterization harness scales from the invariant test to `tryConsumeTransferEstimate`/`cancelJob`/`getGasBalances` (same construction trick, more stub fields; `#computeGasBalances` needs `vi.mock` of two module imports).
- Line-budget arithmetic lands ≤1,200 by Phase 6 without Phase 7 (estimated deltas; ±10%; lever identified if short).
- e2e fee assertions are tolerance-based (balance deltas under multiplier envelope), hence threat #3's residual.

**Asks (for the consolidation round / user):**
1. Confirm the Decision to keep RPC wire + `spec.ts`/`client.ts` signatures positional (Q18 step-2 out of scope). If overruled, it becomes Phase 6.5 with popup-caller churn and e2e as the only net.
2. Confirm the Q17 token/fpc sub-step is in-arc (it leaves the execution package; brief scope says "full arc Q5+Q4+Q18+Q17+Q23" which includes those instance sites, but it's the one place this arc edits non-execution services).
3. Phase-7 bail-out authority: pre-authorize the documented bail (revert moves, keep tests+docs) without a fresh consultation round, per the 3-failure rule.

## Adversarial self-check (required by brief)

**Where would a naive plan create the repo's 6th half-done migration?** Three traps: (1) moving *some* `executeOperations` handlers and leaving a dispatcher that routes to two worlds — avoided by moving only complete cohesive families and declaring the switch permanent RPC surface; (2) writing `proveAndSend` to cover "most" of the tail and leaving two paths on a "temporarily different" variant — avoided by defining the helper from the four real tails up front (Phase 3 shape above) and refusing to land the phase until all four call it; (3) stale headers — the repo's existing false `proveAndSend` doc proves the failure mode; every phase's checkpoint includes a doc-truth pass over headers it touched, same commit.

**Which phase stalls, and where is the stop-line?** Phase 3 is the likeliest stall (the four tails resist a clean shape exactly at the offchain-extract / receipt-wait / catch-semantics seams — pre-answered above, but reality may bite); Phase 7 is the likeliest *bail* (microtask-pinning is genuinely hard). The construction guarantees the stop-line: after Phase 6 all four done-conditions hold, so Q23 is upside, not obligation. If Phase 3 itself stalls past three attempts, the fallback is a narrower helper (prove→toTx→send only, journal marks staying caller-side) — still kills the 4-copy drift on the irreversible boundary, still satisfies done-condition (a) in spirit, recorded as a scope adjustment for the consolidator.
