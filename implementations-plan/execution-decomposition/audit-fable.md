# Audit — fable r1 (fresh auditor, no prior involvement)

Scope: `implementations-plan/execution-decomposition/plan.md` vs actual source in
`packages/extension/src/wallet/services/execution/`. Every file:line cited below was
re-verified against the working tree at audit time, not taken from the plan or from
`audit/quality/2026-06-11-ultra-50b45d/findings/verified.md`.

Method: read all four send-path bodies in full (`service.ts:405-610, 1130-1213,
1860-2015, 2022-2205`), the coordinator, builder, fee-strategy, claim-helper,
execution-mutex, rpc-cancel, contract-resolver, authwit-discoverer, the journal
`_transitionLocked` counterpart, the existing test surface, and the network e2e suite
inventory; cross-checked the constraints registry.

---

## Findings by severity

### HIGH

**H1 — The fourth send path (`executeSendTransaction`) has ZERO network-e2e coverage; every
phase gate's "zero behavior change, proven by network e2e" is false comfort for it.**

Verified production callers of `executeSendTransaction` (`service.ts:1130`):
- the `executeOperations` dispatcher case (`service.ts:950`) — but **nothing in
  `wallet-bridge` constructs a `send_transaction` operation** (only the type exists at
  `packages/wallet-bridge/src/operation.ts:80`); no dApp request reaches this case today;
- `auth-registry/service.ts:111,153` (`revokeAuthwits` / `setRegistryEnabled`) — direct
  calls, bypassing the dispatcher entirely.

Grep of `packages/extension/tests/e2e/` finds **no test exercising revoke/registry flows**
(`revokeAuthwit|Revoke|authwits` → no e2e hit). The journal-stage assertions from commit
`989e4be` cover the dApp `aztec_sendTx` family (`tx-sendTx-*`, `cancel-mid-prove`,
`concurrent-*`), and `transfers.test.ts` carries **no** journal assertion either. The Phase 8
manual-QA script also omits authwit revoke. So when Phase 3 rewires this path's tail through
`proveAndSend`, the only nets are the coordinator unit test and a codex diff review —
no end-to-end execution of the path at any phase. This is also the path carrying the
plan's most load-bearing bug pin (acquires NO execution slot — verified: no
`acquireExecutionSlot` call in `service.ts:1130-1213`), and a direct caller (auth-registry)
that does not pass through `classifyOperationCatch`, so its sentinel/error surface differs
from the dispatcher path.

Fix: Phase 0 must either (a) add a network e2e driving `revokeAuthwits` end-to-end (which
falsifies the test-strategy line "No new e2e files expected unless Phase 0 finds a path gap"
— the gap exists, verified now, so budget for it), or (b) record an explicit user-approved
acceptance that path 4 is covered by unit contract tests only. This is a user decision —
surface it as an Ask (see A2 below), don't resolve it silently inside Phase 0.

### MEDIUM-HIGH

**M1 — Phase 0/4 misstate the estimate-reuse rejection contract: "six rejection branches" is
wrong, and the Phase 4 test list omits the profile-drift check — the one security-adjacent
branch.**

`tryConsumeTransferEstimate` (`service.ts:619-715`) has, by direct count: missing-entry
(`:633`), TTL (`:636-639`), input drift (`:642-653`), **profile drift (`:659-663`)**,
no-primary-endpoint (`:668-671`), endpoint-changed (`:672-675`), base-fee drift (`:692-695`),
base-fee-fetch-failure conservative reject (`:696-700`), pending-set drift (`:707-712`).
That is 8–9 distinct rejections (7 even with generous grouping). Phase 4's enumerated tests
("input-field drift, endpoint change, base-fee fingerprint drift, pending-hash drift, TTL
expiry, single-shot reuse, happy path") cover six and **omit profile drift and the
fetch-failure conservative reject entirely**. Consequence: an extraction that silently drops
the profile check (added precisely to stop cross-profile reuse confusion — see the codex
NICE-TO-HAVE #2 comment at `service.ts:163-167, 655-663`) passes every stated gate: the
e2e rebuild fallback is outcome-identical, and the listed unit tests never exercise the
branch. The plan's own CC4 shows the right instinct (don't test checks that don't exist);
apply the dual: test every check that DOES exist.

Fix: Phase 0 characterization must enumerate ALL rejection branches by reading the function
(record the count in `lessons/phase-0.md`); Phase 4's test list adds profile-drift and
fetch-failure-reject cases. One-line plan edit each.

**M2 — Phase 3's helper contract is internally contradictory about who owns the `failed`
terminal transition, and Inference I1 ("scopes are the only semantic difference besides
record/journal args") is false as stated.**

Plan text: the helper owns "stage transitions (`simulating/proving/submitting/succeeded|failed`)"
and "terminal journal update", while two lines later "Callers keep their own catch/finally".
Both cannot hold. Verified divergences across the four catch paths:
- `executeTransfer` converts the sentinel at the method level via
  `maybeRethrowAsRpcCancel(error, transferTask)` then marks failed + `transferTask.fail`
  (`service.ts:600-606`);
- the three dApp paths rethrow `JobCancelledSentinel` raw WITHOUT marking failed
  (`service.ts:1205-1208, 2006-2009, 2196-2199`) and rely on the dispatcher's
  `classifyOperationCatch` (`service.ts:1019`, `rpc-cancel.ts:67-74`) — except the
  auth-registry direct calls, which bypass the dispatcher (see H1);
- task lifecycle: transfer completes its own task inside the tail (`:598`); dApp paths leave
  the operationTask to `executeOperations`;
- txHash representation: string (`:560, 1189`) vs `TxHash` object inside `SendReturn`
  (`:1985, 2175`).

The FSM (`cancelled` is terminal; `_transitionLocked` → `assertCanTransition`) backstops the
worst case, but a helper that marks `failed` on the sentinel path changes journal/FSM error
logging and — combined with H1's uncovered path — has no gate behind it.

Fix: pin the contract in the plan BEFORE implementation: helper owns
`proving/submitting/succeeded` transitions only; `failed`/cancel classification stays in each
caller's catch verbatim (status quo); the coordinator unit test asserts the helper performs
NO journal write when the wrapped pipeline throws. Restate I1 honestly: scopes + record/journal
args + catch/task/return-shape divergences, with the latter staying caller-side.

### MEDIUM

**M3 — Phase 2's gate cannot catch the regression Phase 2 exists to prevent: a transposition
introduced DURING the tuple→object rewrite.**

Named fields make future transpositions compile-impossible — but the conversion itself is a
hand-mapping of `built[5]`→`.nonce`, `built[7]`→`.feePaymentMethod`
(`service.ts:538-545`), and inside the four strategies, of same-typed gas slots
(`gasLimits` vs `teardownGasLimits`, both `Gas`; `finalizeGasLimits` at
`fee/fee-strategy.ts:162-195`). A swap there compiles, and the plan's own residual-risk list
concedes e2e tolerates fee drift within the multiplier envelope. The Phase 0 pins on
`getEstimatedFee`/`getGasDetails` (`service.ts:227-247`) test the readers, not the strategy
construction.
Fix: in the Phase 2 checkpoint, add one fixture per strategy with **pairwise-distinct
sentinel values** for every same-typed slot (gas/teardown/fee each a distinct prime), asserted
end-to-end through the new named object into `getGasDetails` output. Cheap, mechanical, closes
the exact hazard D1 cites as the funds risk.

**M4 — Phase 6 never says where `executeSendTransaction`'s body lands.**

The named executors are `transfer-executor.ts` (popup transfer) and `dapp-send-executor.ts`
(dApp sendTx + NO_FROM). Path 4 is neither: popup/auth-registry-origin, journals as
`dapp_execute`, takes no slot (pinned). If it lands in `dapp-send-executor` next to two
slot-taking siblings, it is one harmonization away from the exact regression the P3 pin
exists to prevent — and per H1 nothing executes it in CI. Fix: name its destination in the
plan (recommendation: keep it on the facade or in `transfer-executor` as the second
popup-origin path; do NOT co-locate with the slot-taking executors) and carry the no-slot
pin assertion into whichever module owns it.

### LOW

**L1 — Facts-section precision (verified):**
- `tx-request-builder.ts:279-334` is the **fn-lookup** family (name `:279-284`, selector-scan
  `:315-334`), not an "ensure-registered site" as the Phase 1 sentence groups it. The real
  ensure-registered prologues are `:117-126` and `:412-424`. Sites all exist; labels merged.
- Index-consumer list is a subset: `service.ts:894-895, 903, 1411, 1953-1956` also
  index-destructure builder/strategy tuples (all named in verified.md Q18 but not in the
  plan). Harmless in practice — the type change breaks every consumer at compile time — but
  the Facts section claims completeness it doesn't have.
- `planner.processAztecJsPayload` returns a 3-tuple consumed via `_`-placeholder destructure
  at `service.ts:880, 1936`; Phase 2 promises to "kill every `_`-placeholder destructure" but
  names only the three builder/strategy types. Either convert it too or scope the sentence.
- `cancelJob` is `service.ts:836-867` (cited 836-866). Trivial.
- Fn-lookup ×7 checks out exactly: name-lookup ×4 (`tx-request-builder.ts:280`,
  `service.ts:1446`, `authwit-discoverer.ts:150`, `batched-view-simulation.ts:578`) +
  selector-scan ×3. Tuple arities 7/6/8 verified (`tx-request-builder.ts:69-70`,
  `fee/fee-strategy.ts:72-81`). Coordinator promise-vs-absence verified
  (`execution-coordinator.ts:14-19` docblock, only 3 wrappers at `:43-100`). Facade is
  exactly 2,302 lines. No EntityStorage/chrome.storage in `execution/`. Commit `989e4be`
  exists. `submitting → cancelled` FSM rejection confirmed (`spec.ts:73-80`,
  `operation-journal/service.ts:227+`). These Facts hold.

**L2 — Phase 1: per-caller error strings are pinned only as helper parameters; the strings are
dApp-visible wire behavior.** A caller passing the wrong (but valid) string compiles and
passes helper unit tests; only a caller-side assertion catches it. Add one characterization
assertion per call site for `"Contract not found"`/`"Method not found"` (Phase 0 or Phase 1
colocated tests), since e2e error-text assertions are sparse.

**L3 — Phase 1: `ensureContractsRegistered` consolidation has two preserved quirks worth
explicit pins:** (a) `pxe.registerContract({ instance, artifact: artifacts.get(...) })`
passes **possibly-undefined** artifact through (`tx-request-builder.ts:121-124, 417-420`,
`batched-view-simulation.ts:185-190`) — a helper that "fixes" this with a throw is a behavior
change; (b) `service.ts:1434-1443` resolves lazily (only when unregistered) then re-resolves
unconditionally at `:1442-1443` — a unified always-resolve helper changes PXE call
counts/ordering on that path. Pin or parameterize; note in the parity review.

**L4 — Phase 0 is under-scoped in its own terms.** `transfers.test.ts` has no journal-stage
assertions (verified by grep), so the "add path coverage only if a gap exists" branch WILL
fire even before considering H1; "0.5-1d, tests only" is optimistic if any e2e writing lands
in P0.

### NIT

**N1 — Rollback wording.** "Each phase independently revertable" is only true top-down in the
stack (P2's named shapes are load-bearing for P3's `ctx`; reverting P2 alone after P3 lands is
not a checkpoint drop). Say "revertable in reverse stack order".

**N2 — Phase 5 is sound as written.** Both invalidation hooks verified
(`service.ts:383-391` tx-settle suffix-match, `:398-402` PrivateFpc clear), single-flight +
TTL at `:1476-1502`, `#computeGasBalances` at `:1504-1575`. The suffix-match
(`key.endsWith(':${tx.account}')`) is a preserved quirk — carry it verbatim, fixed-length
addresses make it safe.

---

## Ask 1 — Adversarial / security review

What an attacker (or entropy) targets post-refactor, in order:

1. **The dark path** (H1). `executeSendTransaction` is the only tail caller with no e2e, no
   manual-QA step, and a direct caller that bypasses `classifyOperationCatch`. Any tail
   regression here ships blind. The residual-risk list does NOT acknowledge this — that is
   its one material honesty gap.
2. **Cancel-after-broadcast ordering.** The protection is layered: `cancelJob` transitions
   journal first and drops the signal if FSM rejects (`service.ts:855-866`), and the pipeline
   interleaves `toTx → markJournal(submitting, txHash) → checkCancelled → sendTxTask`
   uniformly across all four sites (verified). The P3 coordinator test must pin this exact
   interleaving (prove → check → hook → toTx → journal(submitting+hash) → check → send), not
   just "ordering" generically — `submitting→cancelled` being FSM-illegal means a reorder of
   the journal write vs the last checkpoint silently changes which cancels are honored.
   Mitigations otherwise real: cancel-mid-prove e2e exists; cancel-before-send unit test named.
3. **Estimate-reuse cache as a stale-state oracle** (M1). The rejection branches ARE the
   defense against confirming a TxRequest built under different conditions (payment method,
   profile, endpoint, base fee, note set). The Security section never mentions this component;
   its silent-degradation mode (drop a check → always "valid") is invisible to every stated
   gate. Treat the branch set as a security surface, not a cache detail.
4. **Fee transposition during P2** (M3) — the accepted "fee drift within multiplier tolerance"
   residual and the P2 rewrite hazard compose badly; the sentinel-value fixture closes it.
5. **Scopes**: mitigation is real, not theater — scopes stay per-site data, `multi-account-from`
   e2e exists, and the NO_FROM dedup construction (`service.ts:2107-2115`) stays caller-side
   until P6. Parity-review-diffs-the-four-expressions is process, but it's backstopped by e2e.
6. **Lane seam (P7)**: constraints registry is verbatim-correct against source (mutex
   no-timeout `execution-mutex.ts:5-10`; sync FIFO enqueue before first await `:113-120`
   matching the baton comment at `service.ts:1308-1321`; claim-helper no-await invariant
   `claim-helper.ts:144-163`; `_transitionLocked` counterpart confirmed). Microtask race tests
   + heavy shards + pre-defined bail-out = adequate. The known residual (correctness-by-
   microtask-interleaving) is honestly carried.
7. **Chain-identity pins (P6)**: right call and correctly motivated — of the five
   `assertLiveChainIdentity` sites, `service.ts:2136` sits inside code that MOVES
   (`executeNoFromSendTx` → dapp-send-executor) and an honest sandbox e2e cannot detect its
   deletion. Keep the per-path invocation pins.
8. Supply chain/crypto/CI claims: verified trivially true (no new deps, no crypto, no
   workflow changes in scope).

Residual-risk list verdict: honest on byte-parity, interleavings, fee tolerance, Firefox,
reaper horizons; **dishonest by omission** on the path-4 e2e blindness and on the reuse-cache
branch set. Add both.

## Ask 2 — Assumption attack

**Facts**: F-claims verified and largely accurate (see L1 for the precision list). Two
misstatements that matter: the "six rejection branches" undercount (M1 — it drives a test
plan), and the implied completeness of the e2e parity net for "all four send paths"
(H1 — `e2e journal-stage assertions exist` is true but covers the dApp family only; transfers
lack journal assertions; path 4 lacks any driver).

**Inferences**: I1 (scopes-only divergence) is FALSE as stated — see M2 for the verified
divergence list; the design mostly absorbs it but the plan text must stop asserting it,
because Phase 0's "MUST be confirmed by characterization" check will otherwise be marked
"confirmed" by an implementer reading only the happy path. I2 (gas-balance re-target) safe.
I3 (one-axis-per-phase) sound. I4 (e2e+pins+parity sufficient; no golden-file harness) —
sufficient EXCEPT for path 4 and the P2 conversion step; with H1+M3 conditions applied, I
agree no golden-file harness is needed.

**Asks**: A1 (hard ≤1,200 gate) — agree with the recommendation: hard gate, dispatcher moves
to its own module if needed. Two asks are missing and must be user-decided at approval:
- **A2 (new)**: close the path-4 e2e gap (new revoke-flow network e2e in P0) vs. explicitly
  accept unit-only coverage for `executeSendTransaction`. Affects P0 scope/estimate and the
  test-strategy "no new e2e files" claim.
- **A3 (new)**: P3 helper failure-ownership contract (M2): helper owns success-side
  transitions only; `failed`/cancel classification stays caller-side. Approve the contract
  before P3, not during.

## Ask 3 — Phase-gate sufficiency

| Phase | Most-likely regression | Does the stated gate catch it? |
|---|---|---|
| P0 | mischaracterization (wrong branch count) | NO as written — fix via M1; otherwise fine (tests-only) |
| P1 | error-string drift at a call site; PXE call-count change at `service.ts:1434-1463`; quirk "fixes" (undefined-artifact pass-through) | PARTIAL — full e2e:agent runs per phase and `sim-methods`/`register-token` exercise the hot sites, but string parity needs caller-side pins (L2) and the quirks need explicit bug pins (L3) |
| P2 | transposition during the hand-mapping | NO — fee drift within multiplier tolerance is an accepted e2e residual; needs the sentinel-value fixture (M3). Compiler + named fields only protect AFTER the conversion is correct |
| P3 | checkpoint reorder / journal-write reorder; tail regression on path 4 | PARTIAL — ordering/cancel unit tests + cancel-mid-prove e2e are real for 3 of 4 paths; path 4 dark (H1); pin the exact submit-boundary interleaving (security §2) |
| P4 | silently dropped rejection branch | NO for profile-drift/fetch-failure (M1) — e2e rebuild fallback is outcome-identical, listed unit tests skip those branches. YES for the listed six |
| P5 | dropped/reordered invalidation | YES — per-event unit tests + fee-methods e2e; emission-order preserved by init() constraint |
| P6 | guard deletion; slot-release leak; wrong executor home for path 4 | MOSTLY — chain-identity pins are exactly right; concurrent shards in the full suite catch lane wedges; path-4 destination unspecified (M4) |
| P7 | claim/cancel interleaving break | YES within stated limits — heavy shards + microtask race tests + verbatim constraints + bounded bail-out; residual honestly recorded |
| P8 | UX-level regressions on uncovered flows | PARTIAL — manual QA script must add an authwit-revoke step (H1) |

Where e2e green is false comfort, concretely: path 4 everywhere; estimate-reuse rejection
branches (fallback masks deletion); fee transposition within multiplier tolerance;
chain-identity guard deletion against an honest sandbox (plan already knows this one);
error-string drift (dApp-visible, rarely asserted in e2e).

---

## Conditions for approval

1. (H1/A2) Resolve the `executeSendTransaction` coverage gap as an explicit user decision in
   the plan: new revoke-flow network e2e in Phase 0, or recorded acceptance of unit-only
   coverage; add authwit-revoke to the Phase 8 manual-QA script either way; name the path-4
   body's P6 destination (M4).
2. (M1) Correct Phase 0's rejection-branch count to the verified set and add profile-drift +
   base-fee-fetch-failure rejection tests to Phase 4's list.
3. (M2/A3) Pin the Phase 3 helper contract: helper owns proving/submitting/succeeded; failed/
   cancel classification and task lifecycle stay caller-side verbatim; restate Inference I1
   with the verified divergence list.
4. (M3) Add the per-strategy distinct-sentinel-value fixture to the Phase 2 checkpoint.

conditional approve (with conditions: close-or-accept the executeSendTransaction e2e gap (H1/A2) incl. P6 destination + manual-QA step; fix the estimate-reuse branch enumeration and add profile-drift/fetch-failure tests (M1); pin the P3 helper failed-transition ownership contract (M2/A3); add the P2 anti-transposition sentinel fixture (M3))
