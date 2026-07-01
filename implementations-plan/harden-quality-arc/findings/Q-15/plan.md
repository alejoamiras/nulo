# P17 / Q-15 — dedup execution send-path slot/journal/record scaffolding

**Tier:** deep (concurrency-critical, single-package but high irreversibility — a slot leak wedges the lane until SW restart).
**Status:** CONSOLIDATED (codex session `019f1c9b`, xhigh). opus Plan leg env-blocked (2× background Plan+opus subagents returned 0 tool_uses / leaked-boilerplate results — environmental, not retried further). Cross-model coverage = main leg + codex adversarial + post-impl codex audit. Scope SHRANK per codex — see ledger.

## Finding
`apps/extension/src/wallet/services/execution/` send paths repeat acquire-slot, claim-journal, cancellation, the `simulating` checkpoint, catch/finally slot-release, transaction recording, and Aztec payload/fee normalization. Refactoring: Form Template Method → `withExecutionSlot(...)` owns journal/cancel/finally; shared `recordTransaction`/addTransaction-args builder; shared `projectFeeOptions`; reuse the planner's `extractPrimaryMethod`.

## STEP 1 re-verify (vs HEAD e4c70c9) — CONFIRMED, partially pre-shrunk
- `executeAztecSendTx` (dapp-send-executor.ts:257-417) and `executeNoFromSendTx` (424-604) share a byte-near-identical `acquireSlot → hoist journalId → try{claim + checkCancelled + markJournal(simulating)} catch{markFailedUnlessCancelled} finally{deleteController + releaseSlot}` scaffold. **Real, high-value dup.**
- `recordTransaction` closure (10-arg `addTransaction(...)` + conditional `recordPendingAuthwits`) copy-pasted 4× (dapp 230-246, 386-402, 577-589; transfer 206-237). Shapes differ (txCalls source, nonce, feePaymentMethod, pendingPublicAuthwits). **Partial dup.**
- `processAztecJsPayload` (operation-planner.ts:169-254) is ALREADY shared. `extractPrimaryMethod` (260-276) ALREADY exists. So the "payload parse" dup is NARROWER than the finding implies: only the NO_FROM inline `feeOpts` (dapp 492-501) re-implements the planner's feeOptions projection (227-244), and there are 3 inline primaryMethod extractors (planner has the canonical one).
- **Do-NOT-harmonize signals (respect):** transfer-executor.ts:11-18 ("NO execution slot — Do NOT harmonize with the dApp-send flow"); executeSendTransaction is slot-less by design (invariant #10).

## Frozen invariants (constraint registry — preserve byte-for-byte behavior)
1. acquireSlot BEFORE journal claim / any PXE work (baton releases inside acquireSlot via onEnqueued).
2. `journalId` hoisted OUTSIDE try so catch+finally run even if claim/post-claim-checkCancelled throws — else `releaseSlot()` is skipped → lane wedges until SW restart.
3. `simulating` marked BEFORE authwit discovery/build.
4. onEnqueued fires after mutex.acquire is called, before grant awaited (execution-lane.ts:246-248).
5. Mutex has NO timeout / force-release.
6. cancelJob transitions journal FIRST, aborts SECOND.
7. JobCancelledSentinel never crosses RPC boundary (rpc-cancel.ts is the caller-side conversion).
8. Sync-register pre-acquire controller before mutex acquire's first await.
9. Transfer flow: NO slot. Do NOT fold in.
10. executeSendTransaction (send_transaction): NO slot. Must stay slot-less (adding one = concurrency-semantics change, a fail-closed change → out of scope, HARD LIMIT).

## Final seam (consolidated — codex-adjudicated)
- **`private runInSlot<T>(params, run): Promise<T>` on `DappSendExecutor`** (NOT `withExecutionSlot` on the lane — codex: the lane owns primitives (mutex/registry/claim/journal); a closure-runner would make it own executor control flow and weaken the lane-shaped-deps seam). Signature:
  `runInSlot<T>({ networkId, accountAddress, origin, hooks, calls }, run: (ctx: { journalId, checkCancelled, markJournal }) => Promise<T>): Promise<T>`.
  Body owns ONLY the invariant-critical scaffold, NOT the simulating checkpoint:
  `acquireSlot → hoist journalId → try{ claimOrCreateJournal → build checkCancelled + markJournal closures → checkCancelled() (the post-claim one, present in BOTH paths today) → return run({journalId, checkCancelled, markJournal}) } catch{ markFailedUnlessCancelled(err, journalId, this.deps.lane) } finally{ if(journalId) deleteController(journalId); releaseSlot() }`.
  Each path's `run` closure does its OWN `markJournal({stage:"simulating"})` at its exact current point (standard: AFTER opts.from validation + processAztecJsPayload; NO_FROM: right after entry) — the template must NOT bake it in (codex: a fixed point changes standard's invalid-from/parse failures to `pending→simulating→failed`, and ADDS a NO_FROM post-simulating checkCancelled that doesn't exist today).
  Keep `markFailedUnlessCancelled` SYNCHRONOUS (its sentinel throw); do not wrap in a new async helper (changes cancel microtask timing).
- **DROPPED (codex — behavior-change traps, not byte-for-byte):**
  - `buildAddTransactionArgs` — `primaryEndpointUrl`/`getEstimatedFee`/`getGasDetails` currently evaluate INSIDE recordTransaction (post-send); a builder that pre-computes them changes failure timing.
  - `extractPrimaryMethod` reuse — planner falls back to `selector`; the inline extractors are name-only, so selector-only calls would newly render the selector instead of `"Transaction"`. Leave the 2 inline extractors as-is.
- **DEFERRED / conditional:** `projectFeeOptions` — only if PARAMETERIZED for the two real NO_FROM-vs-planner differences (NO_FROM omits `maxPriorityFeesPerGas`; NO_FROM uses `detectEmbeddedFeePayment(...) ?? "fpc"` fallback, planner has no fallback). Marginal clarity win vs. parameterization noise — DROP unless the extraction stays obviously byte-identical. Not required for the phase to close.
- executeSendTransaction + transfer stay OUT (invariants #9, #10).
- **Net P17 = extract `runInSlot` + the oracle.** The fee/primaryMethod/addTransaction "dedups" are dropped as unsafe. This is the Q-14 pattern again: the audit shrinks the finding to its genuinely-mechanical core.

## The oracle (behavior-preservation proof)
BEFORE refactoring: add characterization tests that spy on a fake lane and assert the EXACT call sequence for each slot path:
`acquireSlot → claimOrCreateJournal → markJournal(simulating) → [run work] → (happy: proveAndSend.recordTransaction) → deleteController → releaseSlot`
AND each throw path (claim throws / run throws mid-build / run throws in proveAndSend / recordTransaction throws): assert `markFailedUnlessCancelled` called once + `deleteController` + `releaseSlot` STILL run (no slot leak). Keep green + UNEDITED across the refactor.
**codex #5 — ordering spy alone is INSUFFICIENT. ADD:**
- A **real-lane concurrency test** (real ExecutionLane, not a spy): two same-network `runInSlot` calls; block the first's `run`; assert (a) `onEnqueued` fires for the second WHILE it waits, (b) the second's `run` does NOT start until the first's `finally` releases. Pins invariants #1/#4/#5.
- **cancel-during-wait** (abort the pre-controller mid-acquire → JobCancelledSentinel, slot released) and **cancel-after-claim** (abort post-claim → checkCancelled throws → markFailedUnlessCancelled skips the failure transition, slot still released) THROUGH the extracted `runInSlot`.
This is the P17 proof (concurrency-ordering analogue of the trust-boundary frozen-oracle discipline).

## Security & Adversarial Considerations
- **Threat model:** the attacker surface here is a malicious/buggy dApp issuing concurrent sendTx to force an interleave (nullifier double-spend) or a cancel-race to wedge/leak a slot. The mutex + FIFO + slot-leak-freedom ARE the defense; the refactor must not weaken them.
- **Primary risk = introduced slot leak** (a throw path that skips releaseSlot) → DoS of the (profileId,chainId) lane until SW restart. Mitigated by the oracle's throw-path assertions.
- **Secondary risk = a dropped checkCancelled** → a cancel that used to surface now doesn't (or vice versa), changing when JobCancelledSentinel fires. Mitigated by the ordering oracle + invariant #2/#6/#7 review.
- No crypto, no new trust boundary, no new external input. No supply-chain surface (no new deps).

## Assumptions
**Facts (verified):** file:line refs above read at HEAD e4c70c9. processAztecJsPayload + extractPrimaryMethod already shared (planner 169-276). transfer + executeSendTransaction slot-less (headers + code).
**Inferences (attack these):** (a) the 2 slot paths' catch/finally are behaviorally identical → hoistable; (b) baking markJournal(simulating)+checkCancelled into the template does not change NO_FROM's cancel-surfacing window — NEEDS codex confirmation (open question above); (c) buildAddTransactionArgs is net-positive — LOW confidence, may drop.
**Asks (surface, don't assume):** none for the owner yet — all resolvable via codex/opus. If codex says the full extraction isn't worth the risk (brief #7), I scope down to projectFeeOptions + extractPrimaryMethod only and log that decision (not an owner escalation — within the finding).

## Ordered steps (FINAL)
1. **Oracle first (against CURRENT code):** add the characterization ordering + throw-path tests for both slot paths, the real-lane concurrency test, and cancel-during-wait + cancel-after-claim. Gate: `bun run --cwd apps/extension test` (execution dir) green with UNCHANGED source. This proves the oracle pins today's behavior before any edit.
2. **Extract `runInSlot`** (private on DappSendExecutor), migrate `executeAztecSendTx` — its `run` closure keeps `opts.from` validation + processAztecJsPayload + its own `markJournal(simulating)` at line-341 point, then authwit + build + proveAndSend. Gate: oracle green UNEDITED + lint + typecheck:all + full `@nulo/extension` suite.
3. **Migrate `executeNoFromSendTx`** to `runInSlot` — its `run` closure keeps `markJournal(simulating)` at entry (no added post-simulating checkCancelled). Gate: oracle green UNEDITED + full suite.
4. **(Optional) `projectFeeOptions`** only if it stays obviously byte-identical (parameterized for the 2 NO_FROM diffs). Else skip. Gate: full suite.
5. Per-arc tail: `/code-review max --fix` → codex post-impl audit (session `019f1c9b` resume) → fix loop.
6. Gate PR `qa/Q-15-execution-slot-template`: pr-quick + pr-smoke-e2e + pr-network-e2e via workflow_dispatch. Green → plain squash-merge, NO --admin.

## Validation gate (every phase)
`bun run lint` + `bun run typecheck:all` + `bun run --cwd apps/extension test` (execution dir). Full-suite before push. PR gate: pr-quick + pr-smoke-e2e + pr-network-e2e via workflow_dispatch on `qa/Q-15-execution-slot-template`. TRUST-note: this is NOT a trust-boundary phase — the proof is the characterization oracle + full unit/network green, not a frozen authz oracle.

## Decision ledger
Sources: main-agent leg (draft) + codex `019f1c9b` (xhigh, adversarial). opus leg env-blocked (0 tool_uses ×2) — noted, not counted.
- **Seam** → `runInSlot` PRIVATE on DappSendExecutor. (codex: keep the lane a primitives-only state machine; a closure-runner on the lane weakens the lane-shaped-deps seam. Main leg had proposed lane-side; codex's argument wins.)
- **markJournal(simulating) placement** → NOT baked into the template; each path owns it at its current point. (codex: fixed point changes standard's invalid-from/parse failures `pending→failed`→`pending→simulating→failed`, and adds a NO_FROM post-simulating checkCancelled that doesn't exist today.)
- **buildAddTransactionArgs** → DROP. (codex: endpoint/fee/gas helpers evaluate inside recordTransaction post-send; a pre-builder changes failure timing. Transfer's txCalls are intentionally transfer-only.)
- **extractPrimaryMethod reuse** → DROP; leave 2 inline extractors. (codex: planner falls back to selector; inline is name-only → selector-only calls would stop showing "Transaction".)
- **projectFeeOptions** → DEFER/optional; only if byte-identical after parameterizing NO_FROM's omitted priority-fees + `?? "fpc"` default. Not required to close the phase.
- **Full extraction vs scope-down** → SCOPE DOWN to `runInSlot` + oracle. The fee/method/args dedups are unsafe; the slot scaffold is the genuine mechanical win.
- **Oracle sufficiency** → single-thread ordering INSUFFICIENT alone; ADD real-lane concurrency (onEnqueued-while-waiting + second-run-gated-on-release) + cancel-during-wait + cancel-after-claim through runInSlot. (codex #5.)
- **Slot-leak safety** → draft try/finally starts immediately after acquire → release runs on every post-acquire throw (verified). Watch the `release`/`releaseSlot` binding name; claim-throws-before-journalId skips deleteController exactly as today (pre-controller cleaned by claim-helper/cancelJob).
