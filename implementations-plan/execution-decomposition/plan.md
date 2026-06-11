# Execution Decomposition — plan

Arc: decompose `packages/extension/src/wallet/services/execution/` per quality-audit findings Q5+Q4+Q18+Q17+Q23 (`audit/quality/2026-06-11-ultra-50b45d/findings/verified.md`). Tier: `/blueprint deep` (blast radius HIGH — every send flow; security-adjacent — signing/proving/fee path).

**Delivery**: one arc branch (`feat/execution-decomposition`) off dev; each phase = contiguous checkpoint commits, independently revertable; ONE final PR to dev; RC build + manual QA before squash-merge.

**Done-conditions** (user-fixed):
(a) ONE extracted pipeline tail with all four send paths as callers;
(b) `execution/service.ts` ≤ ~1,200 lines with estimate-reuse + gas-balance caches in their own unit-tested modules;
(c) ZERO behavior change, proven by network e2e per phase; pre-existing quirks preserved verbatim (bug-pin rule);
(d) every extracted module ships colocated tests in the same checkpoint.

**Scope note on Q23**: in scope and attempted (Phase 7), with a pre-defined bail-out that is a USER-SURFACED decision point, not a silent descope — if Phase 7's gate fails twice, work stops and the bail decision comes back to the user with findings (contradiction-check fix CC2).

**Per-phase gate** (all phases unless noted): `bun run lint` + `bun run test` + `bun run e2e:agent` + codex parity review of the phase diff. High-signal e2e per phase listed inline.

## Phases

### Phase 0 ✓ — Characterization safety net (0.5-1d)
Pin behavior where extraction will occur, beyond existing e2e:
- Verify e2e journal-stage assertions (commit `989e4be`) cover all four send paths; add path coverage only if a gap exists.
- Baseline e2e run on the untouched branch tip (flake profile): one full `e2e:agent` pass recorded in `lessons/phase-0.md` so later phase failures can be triaged against a known-good baseline (restored from fable draft — CC7).
- Unit characterization: `fingerprintBaseFee`/`fingerprintFeeSettings` exact string output (byte-stable — estimate-reuse contract), `getEstimatedFee`, `getGasDetails`, `pickActionMethod`; ALL observable exits of `tryConsumeTransferEstimate` — TTL, input drift, profile drift, no primary endpoint, primary changed, base-fee changed, base-fee fetch failed, pending-hash drift (`service.ts:635-711`; audit R1-M1 corrected the earlier "six branches" undercount) — and `cancelJob`, via the private-field-injection pattern from `feesettings-invariant.test.ts`; gas-balance TTL + single-flight shape.
- **Structural fee-path parity fixtures** (audit R1-H2): deterministic tests feeding fixed inputs through each fee strategy + builder with fakes, asserting the projected outputs — gas settings, `maxFeesPerGas`, fee payment method shape, call ordering, authwit counts. These become the structural-parity net that e2e scenario-parity cannot provide; P2/P3 must keep them green unchanged.
- Record the parity contract in `lessons/phase-0.md`: facade baseline (2,302 lines), the four tail sites' exact argument variations (scopes arrays, addTransaction args, journal-marking differences at `service.ts:550-567, 1181-1190, 1976-1986, 2166-2176`).
Tests only; zero src change. Gate: lint + test + the recorded baseline `e2e:agent` pass as a REQUIRED P0 artifact (audit R1-M1 fixed the earlier "no e2e" contradiction). Revert: trivial.

### Phase 1 — Q17: resolver seam completion (0.5-1d)
Extend `contract-resolver.ts` with `ensureContractsRegistered(...)`, `findFunctionByName(...)`, `findFunctionBySelector(...)`; delete the re-inlined copies (fn lookup ×7, ensure-registered sites: `tx-request-builder.ts:113-125, 279-334` AND the second prologue at `tx-request-builder.ts:412-424` (CC7), `authwit-discoverer.ts:141-225`, `helpers/batched-view-simulation.ts:177-194, 499-590`, `service.ts:1434-1463`).
- **Error text is parameterized, not normalized** — `tx-request-builder` keeps `"Contract not found"`/`"Method not found"` verbatim; frozen strings survive.
- Lookup order stays exactly `functions` then `nonDispatchPublicFunctions`.
- Execution-owned closure only: token/fpc PXE-preamble adoption belongs to the service-fleet arc (decision ledger D6).
e2e focus: register-token, contracts-getClassMetadata, sim-methods. Revert: pure helper extraction, single-checkpoint drop.

### Phase 2 — Q18: internal objectification (1-1.5d)
Kill positional consumption BEFORE the dangerous extraction (ledger D1):
- `StandardTxRequestResult` 7-tuple + `NoFromTxRequestResult` 6-tuple (`tx-request-builder.ts:69-70`) + `FeeEstimateResult` 8-tuple (`fee/fee-strategy.ts:72-81`) → named result objects (`BuiltStandardTx` / `BuiltNoFromTx` / `FeeEstimate`).
- Update all index-consumers (`service.ts:538-545, 739-742, 1173-1177, 1967-1971, 2081`; fee strategies; `operation-planner.ts`). Kill every `built[N]` + `_`-placeholder destructure. Rationale: positional slots are same-typed (gas/teardown/fee) — a silent transposition costs user funds; named fields make it compiler-impossible AFTER the conversion.
- **Anti-transposition sentinel fixture** (audit R1-fable M3): the conversion itself is a hand-mapping the compiler cannot check — per-strategy fixtures with DISTINCT sentinel values in every same-typed slot (gas ≠ teardown ≠ fee), asserted on the named-object output in the same checkpoint. A transposition introduced during the conversion fails loudly instead of hiding inside the fee-multiplier tolerance that e2e accepts.
- Internal `TransferRequest` value object below the RPC seam for `executeTransfer`/`estimateTransferFee`/`buildTransferOperation`. **`spec.ts`/`client.ts` wire shape unchanged** (ledger D5 — REJECTED for this arc, not deferred).
- Bug pins required: FPC two-pass action mutation ordering, embedded-fee gas-cap behavior, `Unauthorized`/`Wallet locked` strings.
e2e focus: transfers, fee-methods, tx-sendTx-default. Revert: type-level churn, drop cleanly.

### Phase 3 — Q5: `proveAndSend` (1.5-2d) — the keystone
Make `execution-coordinator.ts` truthful (docblock :14-19 promises it): extract the `proveTxTask → toTx → sendTxTask → addTransaction → journal(submitted)` tail from the four sites into `coordinator.proveAndSend(ctx)`.
- The helper owns: stage transitions (`simulating/proving/submitting/succeeded|failed`), `checkCancelled` checkpoints, prove/send task wrappers, an **offchain-output extraction hook** (`wantOffchainOutput` callback receiving `provedTx` BETWEEN prove and `toTx()` — offchain extraction sits there on the dApp paths at `service.ts:1978-1980` and callers cannot reach `provedTx` otherwise; restored from fable draft, CC5), transaction-persistence callback, terminal journal update, cleanup callback.
- **Receipt handling stays caller-side** (CC5): the helper returns the txHash + hook outputs; wait-for-receipt shaping exists on only 2 of 4 paths (`service.ts:2000-2004, 2190-2194`) and remains in those callers. Helper contract test covers the return shape; receipt behavior is covered by e2e.
- **Failure handling stays caller-side too** (audit R1-fable M2): the helper owns the SUCCESS path only — stage transitions through `submitting` and the success terminal journal update. Catch blocks, failed-transitions, and rethrow shaping remain per-caller in this phase, because the divergences are real and verified: `maybeRethrowAsRpcCancel` vs raw-sentinel rethrow, task-completion ownership, txHash string-vs-`TxHash` return shapes. Unifying failure handling is a NOTED FOLLOW-UP, not part of this arc.
- **Variation is DATA, not branches**: `ctx.scopes` (the four sites differ: `[account.address]` / `+sendAdditionalScopes` / `scopesWithAccount`), record-builder callback, journal-marker callback. No op-kind conditionals inside the coordinator.
- Callers keep their own catch/finally + slot/claim handling (that moves in Phase 7, not here — one semantic axis per phase).
- Fix the coordinator header in the same commit. **Five named bug-pins from the fable draft** (CC7), most load-bearing: `executeSendTransaction` acquires NO execution slot today (`service.ts:1130-1212`) — preserve verbatim and do NOT harmonize with the slot-taking paths in P6/P7. **Named pin required in BOTH P3 and P6**: `no-slot-for-executeSendTransaction` test asserting zero lane/slot calls on that path (audit R1-M2).
- **Executable scope assertions** (audit R1-H1): unit tests asserting the EXACT scopes array passed to simulate/prove per path. NO_FROM alone has three distinct scope sites today — discovery sim uses `additionalScopes`, real sim uses `scopesWithAccount`, prove uses `scopesWithAccount` (`service.ts:2107-2124, 2155-2166`) — parity review alone cannot hold this; the assertions can.
- New `execution-coordinator.test.ts`: ordering, cancel-before-send means no broadcast, journal hash parity, helper return-shape contract (txHash + hook outputs).
e2e focus: transfers, tx-sendTx-default, tx-sendTx-feePayer, tx-sendTx-noFrom. Revert: `proveAndSend` is additive; callers re-inline (Phase 2 already gave them named shapes).

### Phase 4 — Q4a: estimate-reuse module (1d)
`transfer-estimate-reuse.ts`: `TransferEstimateReuseEntry` (inline at `service.ts:154-190`), cache map + TTL, `tryConsumeTransferEstimate` validation, fingerprint functions. Facade keeps thin delegation. Injected lazy lookups preserve rejection-branch laziness (fable).
Tests mirror the ACTUAL rejection branches characterized in Phase 0 — TTL expiry, input-field drift, **profile drift (`service.ts:659-663` — security-adjacent: an extraction dropping it passes every outcome-identical gate; audit R1-fable M1)**, no-primary-endpoint, primary-endpoint change, base-fee fingerprint drift, **base-fee fetch failure**, pending-hash drift, single-shot reuse, happy path. (CC4: the earlier draft listed an "actions-hash drift" test — the current contract has NO actions-hash check (`service.ts:641` area); adding one would be a silent behavior change. Characterize what exists; if the missing actions-hash check matters, it's a separate finding for a future arc, not this one.) CONSTRAINT: fingerprint strings byte-stable (Phase-0 pin is the lock).
e2e focus: transfers (estimate-reuse path). Revert: wiring-only.

### Phase 5 — Q4b: gas-balance module (1d)
`gas-balance-reader.ts`: cache + TTL + single-flight + `#computeGasBalances` (`service.ts:1504-1578`), preserving the `${networkId}:${account}` key and PrivateFpc invalidation. Facade wires the invalidation subscriptions (transaction.onTransactionUpdated `:383`, fpc events `:401-402`) targeting the module; registration order in `init()` unchanged.
Tests: TTL, single-flight coalescing, invalidation per event, keying. e2e focus: fee-methods. Revert: wiring-only.

### Phase 6 — Facade trim to ≤1,200 (1.5-2d)
With seams stable, move the remaining heavy bodies (ledger D4 — phase my draft missed; codex's split):
- `transfer-executor.ts` + `transfer-executor.test.ts` (popup transfer flow); `dapp-send-executor.ts` + `dapp-send-executor.test.ts` (dApp sendTx + NO_FROM) — test files named explicitly per done-condition (d) (CC3).
- **Executors receive slot/claim/cancel via an injected lane-shaped deps interface from day one** (`ExecutionLaneDeps`: acquireSlot, claimOrCreate, registerController, releaseAll) — Phase 7 then swaps the implementation BEHIND the interface instead of re-cutting executor control flow. This is the condition under which D3's "minor re-churn" claim is true (CC6; both contradiction checks demanded it).
- Relocate read/sim handler families if still needed for the line target (fable's Q4c).
- `ExecutionService` ends as: RPC facade + `executeOperations` dispatcher + collaborator wiring **+ (until Phase 7) the lane choreography it still owns** — the final facade shape lands only after P7 (CC1).
- **Chain-identity regression pins**: unit tests assert `assertLiveChainIdentity` is invoked on each moved path — e2e against an honest sandbox cannot catch their deletion (fable).
- This checkpoint is where old private helpers die — no compatibility shims left behind. Gate adds `wc -l service.ts` ≤ 1,200 (see Ask A1).
e2e focus: full suite. Revert: bodies inline again; public methods are thin delegates.

### Phase 7 — Q23: execution-lane seam (1.5-2d, bounded)
The riskiest semantics, deliberately last (ledger D3): new `execution-lane.ts` owning `activeControllers`, `executionMutex`, `executionWaiters`, begin/end/heartbeat of execution waits, `acquireExecutionSlot`, the `claimOrCreateDappExecuteJournal` wrapper, and `cancelJob`. Facade consumes a handle; executors adopt it.
- CONSTRAINTS (registry, verbatim): mutex no-timeout/no-force-release; FIFO baton release point (`onExecutionEnqueued`) unchanged; "transition journal first, abort second" preserved exactly; `JobCancelledSentinel` never crosses RPC (`rpc-cancel.ts` stays the boundary); journal FSM transition table untouched; sync-register invariant (controller registered before first await).
- Microtask-level race tests in `execution-lane.test.ts` + existing `claim-helper`/`execution-mutex`/journal race suites stay green untouched.
- **Moved-behavior tests beyond cancel/ordering** (final codex pass, Medium): the lane seam also carries capacity-rejection mapping (`ExecutionMutexCapacityError` → journal failed + `TooManyPendingError`, `service.ts:1327`) and queued-wait heartbeat/reaper protection (`service.ts:1349`). `execution-lane.test.ts` MUST include: capacity-reject maps to the same journal-failed + error shape; heartbeats fire while queued; a reaper-window assertion that a queued-then-running op is not reaped. These are adversarial-dApp backpressure + stuck-journal surfaces, not just races.
- **Bail-out (pre-defined)**: all four done-conditions already hold after Phase 6. If Phase 7's gate fails twice, STOP, surface to user with findings — do not force. Shipping without Phase 7 is a recorded outcome, not a failure.
Gate: full + heavy shards (cancel-mid-prove, concurrent-sendtx, concurrent-sendtx-confirm). Revert: checkpoint drop; `Methods.cancelJob` + journal shapes unchanged.

### Phase 8 — Arc close (1-1.5d)
`/code-review max --fix` (separate commits) → codex post-impl audit (net diff from arc baseline + code-review commit summary + this plan + adversarial ask) → fix loop → milestone-comment cleanup in touched regions only → docs (execution README/file map, coordinator docblock) → RC bump + build → **manual QA script**: popup transfer (public+private), standard dApp sendTx, embedded fee payer, NO_FROM path, **authwit revoke AND registry enable/disable toggle (the auth-registry slice of the `send_transaction` path — zero e2e coverage exists for these callers, so manual QA is their behavioral gate; audit R1-fable H1 as reframed by the final codex pass)**, cancel-mid-prove, concurrent sendTx FIFO, one SW-restart resume → final PR to dev.

**Total: ~9-12 focused days.** Schedule risk concentrated in Phases 3 and 7.

## Decision ledger

| # | Decision | Source | Rejected alternative + why |
|---|---|---|---|
| D1 | Q18 tuples BEFORE Q5 tail | main+fable (2-1) | codex wanted Q5 first ("churn before centralization"); overruled: tuple churn is compiler-verified + mechanical — exactly what should precede the dangerous extraction; positional same-typed slots are a funds-risk transposition hazard. Codex objection preserved for contradiction check. |
| D2 | Q17 resolver FIRST | fable+codex (2-1) | main had it fifth; overruled: additive, separately bail-able, shrinks every later diff. |
| D3 | Q23 lane LAST + bounded bail-out | main+fable (2-1) | codex wanted lane at phase 4 (before objectification + trim, avoids executor double-churn); overruled: risk-last wins for an arc whose #1 failure mode is stalling mid-arc — if lane bails, trim has landed and executors keep the (still-correct) old slot calls. Accepted cost: minor mechanical re-churn of executor call sites if Phase 7 lands. DISPUTED — flagged for contradiction check. |
| D4 | Dedicated facade-trim phase (P6) with flow-family executors | codex (shape) + fable (need) | main's draft had no trim phase — its ≤1,200 math didn't add up (~400 of ~1,100 lines). |
| D5 | Wire-side `TransferRequest` REJECTED for this arc | all three (action); fable (disposition) | Changing `spec.ts`/`client.ts` shapes is pure churn with e2e as the only net; internal seam objectifies, wrappers construct the object at the boundary. Rejected, not deferred — a future arc may revisit with its own justification. |
| D6 | Q17 closure is execution-owned only | codex ask, resolved by main | token/fpc PXE-preamble adoption = service-fleet arc; pulling those services onto an `execution/` helper is the wrong dependency direction. |
| D7 | Caches (P4-P5) after tail (P3) | main+fable (2-1) | codex wanted caches first (tests-before-behavior-move); partially honored via Phase 0 characterization; keystone-early wins for stall-resilience. |

**Unresolved disputes carried to contradiction check**: D1 (codex's churn-ordering objection), D3 (lane placement / double-churn trade-off).

### Contradiction-check outcomes (both checkers: "ledger needs fixes" — all applied)
| CC | Finding | Source | Fix applied |
|---|---|---|---|
| CC1 | P6 end-state wording overstated (lane logic still service-owned until P7) | codex | P6 end-state amended |
| CC2 | Q23 optionality contradicted "full arc" scope | codex | Scope note added: bail-out is a user-surfaced decision, not silent descope |
| CC3 | P6 executor test files unnamed (violates done-condition d) | codex | Test files named |
| CC4 | P4 "actions-hash drift" test names a check that DOESN'T EXIST — would be a silent behavior addition | codex | Removed; tests mirror actual rejection branches |
| CC5 | P3 spec hole: offchain extraction sits between prove and toTx; receipt shaping exists on only 2 of 4 paths | fable | `wantOffchainOutput` hook restored; receipt handling stays caller-side |
| CC6 | D3 only conditionally sound: "minor re-churn" requires lane-shaped deps interface in P6 | both | `ExecutionLaneDeps` injected from P6; D3 verdict now unconditional |
| CC7 | Silently dropped fable specifics: 5 named P3 pins (esp. no-slot-for-`executeSendTransaction`), P0 baseline e2e flake profile, second ensure-registered prologue (`tx-request-builder.ts:412-424`) | fable | All restored |
| — | D1 re-examined by both checkers given consolidated design: **sound** (FPC two-pass conversion control-flow identical; no new semantic trap) | both | No change |

## Assumptions

### Facts (verified against source by ≥1 planner, file:line)
- Coordinator has only 3 task wrappers; `proveAndSend` promised but absent (`execution-coordinator.ts:14-19, 43-100`).
- Four tail sites: `service.ts:550-567, 1181-1190, 1976-1986, 2166-2176`; scopes arrays differ per site.
- Tuples: `tx-request-builder.ts:69-70, 373, 477`; `fee/fee-strategy.ts:72-81` (8-slot); index-consumers `service.ts:538-545, 739-742, 1173-1177, 1967-1971, 2081`.
- Lookup/registration duplication: `tx-request-builder.ts:113-125, 279-334, 412-424`, `authwit-discoverer.ts:141-225`, `helpers/batched-view-simulation.ts:177-194, 499-590`, `service.ts:1434-1463` (audit R1-L1 synced this Fact with the corrected P1 scope).
- Claim/cancel fragility is documented in-code: `claim-helper.ts:144-163` (microtask interleaving), `cancelJob` transitions-then-aborts (`service.ts:836-866`), mutex no-timeout invariant (`execution-mutex.ts:5-29, 97-163`), journal `_transitionLocked` (`operation-journal/service.ts:216-299`).
- Facade = 2,302 lines; direct test surface thin (`feesettings-invariant.test.ts`, `fingerprints.test.ts`); no `execution-coordinator.test.ts` or `tx-request-builder.test.ts` today.
- e2e journal-stage assertions exist (commit `989e4be`); network suite covers transfers/sendTx/concurrent/cancel in CI shards.
- No storage-schema surface in scope (execution owns no EntityStorage shapes).

### Inferences (attack targets)
- ~~Scopes-array variation is the only semantic difference between the four tails besides record/journal args~~ **CORRECTED (audit R1-fable M2)**: additional per-path divergences are CONFIRMED — `maybeRethrowAsRpcCancel` vs raw-sentinel rethrow, task-completion ownership, txHash string-vs-`TxHash` return shapes. The helper therefore owns the success path only; failure handling stays caller-side (see Phase 3). Phase-0 characterization still documents the full divergence inventory before Phase 3 begins.
- Gas-balance invalidation can re-target the module without changing emission order.
- Mixing concurrency movement (Q23) with shape changes (Q18) in one checkpoint would create the repo's 6th half-done migration — hence one-semantic-axis-per-phase.
- e2e:agent + unit pins + STRUCTURAL fee-path parity fixtures (P0) + parity reviews are sufficient parity evidence; no full golden-file harness needed. (Audit R1-H2 corrected the earlier version of this inference, which contradicted the residual-risk list — structural fixtures now cover projected gas/fee/ordering shapes; the remaining byte-level residual is Ask A3.)

### Asks — ALL RESOLVED at approval (2026-06-11, user approved with all four recommendations)
- A1 → ≤1,200 is a HARD gate; dispatcher moves to its own module if needed.
- A2 → bail evidence: two failing gate logs + parity findings + root-cause hypothesis + recommendation.
- A3 → byte-level residual ACCEPTED; structural fixtures + constraint pins are the guard.
- A4 → auth-registry slice gated by unit pins + P8 manual QA this arc; dedicated e2e is a follow-up candidate.

Original ask text (for the record):
- **A1**: Is facade ≤1,200 a HARD gate (`wc -l` fails the phase) or a target with documented-overshoot escape hatch if the remainder is dispatcher-only RPC surface? **Recommendation**: hard gate; the dispatcher can move to its own module if needed.
- **A2** (audit R1): What evidence must accompany a Phase 7 bail decision? **Recommendation**: two failing gate logs, the parity-review findings, a lessons entry with root-cause hypothesis, and a recommendation (retry shape / defer to follow-up arc / drop).
- **A3** (audit R1): The structural fee-path parity fixtures (P0) cover projected gas settings, max fees, payment-method shape, call ordering, authwit counts — but NOT full byte-level `TxExecutionRequest` equality across every strategy. Accept that remaining residual for this arc? **Recommendation**: accept; a full golden-byte harness is its own project and the FPC/embedded constraint pins guard the highest-risk spots.
- **A4** (audit R1-fable H1, REFRAMED by final codex pass): coverage decision for the generic `send_transaction` path as a whole — its callers are the execution dispatcher (`service.ts:949`), dApp-confirmed operations via dapp-interaction (`dapp-interaction/service.ts:376`), and BOTH auth-registry flows (revoke + `setRegistryEnabled`, `auth-registry/service.ts:93`). The dApp-confirmed slice is exercised by the tx-sendTx e2e family; the **auth-registry slice has zero e2e coverage**. Options: (i) accept unit pins (no-slot, scopes, tail parity) + P8 manual QA covering revoke AND registry enable/disable as the behavioral gate for the uncovered slice, with an auth-registry e2e as follow-up candidate; (ii) write that e2e inside this arc (~1 day + fixture surface). **Recommendation**: (i) — and the manual QA step now names both auth-registry flows, not revoke only.

## Security & Adversarial Considerations

Threat model = refactor regression on the signing/proving/fee path (the money path), plus the adversarial actors it serves:
- **Cancel-after-broadcast**: a botched Phase 3/7 can move a `checkCancelled` past `toTx()`/`sendTxTask` — user cancels, tx still broadcasts (violates the 4001 contract). Mitigations: coordinator owns the checkpoints explicitly; cancel-before-send unit test; cancel-mid-prove e2e mandatory in P3/P7 gates.
- **Cancel black hole**: lane-seam regression where journal says `cancelled` but no controller was registered in time — prove continues, terminal state mis-classified. Mitigation: sync-register invariant + microtask race tests.
- **Wrong scopes in unified tail**: broader scopes than approved (privacy regression) or narrower (failure). Mitigation: scopes remain per-call-site data + EXECUTABLE per-path scope assertions (P3 — audit R1-H1 demoted "parity review diffs the expressions" to supporting evidence, not the mitigation). NOTE: `multi-account-from.test.ts:14-23` documents it does NOT exercise the second-account end-to-end claim — it is NOT counted as a mitigation unless its playground hook lands (out of scope for this arc; tracked as a follow-up candidate).
- **Mutex under-serialization**: two sendTx flows simulating against the same private-note state — correctness bug a malicious dApp can amplify via queue pressure. Mitigation: lane preserves mutex semantics verbatim; concurrent shards.
- **Fee-path drift**: FPC two-pass mutation or embedded-fee cap mishandling changes tx bytes / over-budgets max fees. Mitigation: byte-parity constraint honored (NO refactor of the two-pass shape — registry), strategy bug pins.
- **Chain-identity guard displacement**: `assertLiveChainIdentity` must not move later or become conditional — it defends against malicious/drifted RPC. Mitigation: per-path invocation pins (P6).
- **What gates do NOT cover** (accepted residual): byte-level `TxExecutionRequest` identity across every strategy (e2e proves scenario parity, not structural parity — FPC/embedded paths are the residual risk concentration); exhaustive restart/microtask interleavings (unit race tests are load-bearing, not e2e); fee drift within multiplier tolerance; Firefox build; >30min reaper horizons. Manual QA covers one SW-restart case.
- Supply chain: no new deps. Crypto: untouched. Least privilege: no CI/permissions changes.

## Test strategy
Phase-0 characterization pins (fingerprints byte-stability, rejection branches, tail parity contract) → per-extraction colocated tests in the same checkpoint (cache TTL/single-flight/invalidation, resolver lookup branches incl. lookup order, coordinator ordering + cancel + NO_WAIT semantics, lane microtask races) → `(BUG PIN)` tests for every preserved surprise (not comments) → existing helper suites are invariants (claim-helper, execution-mutex, contract-resolver, operation-planner, batched-view-simulation, rpc-cancel, embedded-fpc-cap) → e2e per phase with named high-signal files → heavy shards for P7 → RC manual QA script (P8). No new e2e files expected unless Phase 0 finds a path gap.

## Rollback story
One arc branch; checkpoint = contiguous commits + plan.md ✓ + lessons entry. Revert = drop the checkpoint (no storage migrations anywhere — hard constraint; a phase needing one is out of scope). Abandoning mid-arc leaves dev untouched; every landed checkpoint is shippable from the branch. Phase 7 has an explicit pre-defined bail-out.

## Audit verdicts

**Codex audit R1** (resumed planner session, post-contradiction-check): `conditional approve (with conditions: replace scope-review theater with executable scope assertions + real multi-account-from coverage; add structural fee-path parity evidence or explicit user acceptance of that residual; tighten Phase 0 characterization/gating and add the missing asks)`. All conditions applied: executable scope assertions (P3), multi-account-from demoted from mitigation status (Security section), structural parity fixtures (P0) + Ask A3, P0 exit-branch enumeration corrected + baseline e2e made a required artifact, Asks A2/A3 added, Facts synced (R1-L1). Transcript: `drafts/audit-codex-r1.md`.

**Fable audit R1** (fresh context): `conditional approve (with conditions: close-or-accept the executeSendTransaction e2e gap (H1/A2) incl. P6 destination + manual-QA step; fix the estimate-reuse branch enumeration and add profile-drift/fetch-failure tests (M1); pin the P3 helper failed-transition ownership contract (M2/A3); add the P2 anti-transposition sentinel fixture (M3))`. All conditions applied: revoke step added to P8 manual QA + Ask A4 surfaces the e2e gap decision; P4 test list now enumerates all exits incl. profile drift + fetch failure; P3 helper contract fixed to success-path-only ownership with caller-side failure handling (Inference corrected); P2 sentinel fixture added. Transcript: `drafts/audit-fable-r1.md`.

**Final fresh-context codex pass** (new session, full decision trail): `conditional approve (with conditions: replace A4 with a real coverage decision for generic send_transaction including dApp + both auth-registry callers, and add explicit Phase 7 acceptance/tests for capacity-reject + wait-heartbeat semantics)`. Both conditions applied: A4 reframed around the full caller set with the auth-registry slice identified as the uncovered gap (P8 manual QA extended to both auth-registry flows); Phase 7 test list extended with capacity-reject mapping, queued-wait heartbeat, and reaper-window assertions. Explicitly found no D1-D7 / CC1-CC7 reversals after source verification; A3 judged "a conscious residual, not theater". Transcript: `audit-codex.md`.

## Seeds (FINAL — approved scope, 2026-06-11)

### `/goal` (recommended)
```
/goal All phases 0-8 marked ✓ in implementations-plan/execution-decomposition/plan.md; for each phase the transcript shows LESSONS_FILE=implementations-plan/execution-decomposition/lessons/phase-N.md AND its gate results (bun run lint + bun run test exit 0; e2e:agent pass recorded for phases 1-7); every extracted module's colocated test file landed in the same checkpoint; /code-review max --fix applied and committed separately; codex post-impl audit complete with high/critical findings addressed; wc -l on execution/service.ts ≤ 1200 shown in transcript (HARD gate per A1); RC built and the manual QA script (incl. authwit revoke + registry toggle) delivered in chat. Constraints: zero behavior change (bug-pin rule), no storage migrations, single final PR to dev (never merge it autonomously), Phase 7 bail-out surfaces to the user with A2 evidence (two failing gate logs + parity findings + root-cause hypothesis + recommendation) instead of forcing.
```

### `/loop 15m` (fallback)
```
/loop 15m Drive implementations-plan/execution-decomposition forward. Never idle. Each firing: 1) Read plan.md + lessons/ (authoritative), git status, git log -5; PR exists? gh pr view --json statusCheckRollup. 2) CI in flight: gh run watch up to 10 min, use the wait to prep the next phase. 3) No task? Pick the next pending phase step (edit → bun run lint → bun run test → e2e:agent when the phase gate demands → commit checkpoint). 4) Non-trivial decision or stuck? /codex xhigh, decide together, log in lessons/phase-N.md; hard limits: never merge to dev/main, never publish, no scope beyond plan.md, Phase 7 bail-out goes to the user with A2 evidence. 5) Same step failed 5×? Stop and reassess with codex. 6) Phase gate green? Mark ✓ in plan.md, write lessons, print LESSONS_FILE=..., advance. 7) All phases ✓? /code-review max --fix → commit separately → codex post-impl audit → fix loop → RC build + manual QA script → wrap-up report with every contentious decision ELI5'd → surface and stop.
```
