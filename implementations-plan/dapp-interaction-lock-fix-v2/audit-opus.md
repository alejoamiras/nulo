# Opus subagent audit — v0 plan

Independent dual-audit pair (with codex `xhigh`) on the original v2 plan that bundled Layer A + Layer B. Both audits independently landed on **needs-revision** and **split into A+B**. The user accepted the split: v2 = Layer A only; Layer B deferred to v3.

This transcript captures opus's verbatim findings.

---

**Verdict: needs-revision (blocker-adjacent on Layer B).** Layer A is shovel-ready. Layer C is sensibly scoped. Layer B as currently sketched contains an unforced architectural error and ~3 hand-waved invariants that have to be nailed down before approval. **Split Layer B into a third PR.** Detailed reasoning below.

---

## Completeness gaps

**[P0] Layer B's "where the baton actually releases" is wrong as written.** The plan says "Move the FIFO baton release from `onTxRequestFinalized` (current) to 'popup approved' (after interaction phase)." This conflates two distinct moves:

1. **Release baton after popup approval, before exec.** This is what the user-facing UX needs — popup #2 opens immediately after popup #1 is approved.
2. **Release baton after `buildAndEstimateTxRequest` finalizes.** This is what *PR #53 already ships*. Layer B regresses this if "popup approved" replaces it.

The current release at `onTxRequestFinalized` lets T1's tx-build run in parallel with T2's tx-build (modulo PXE serialization at `withPxeWrite`). If you move release to popup-approval, you're keeping T2's tx-build *blocked behind T1's full popup-interaction phase + tx-build*, which is *worse* than today — T2's popup waits not just for T1's user approval but also for T1's `buildAndEstimateTxRequest`. The plan-text's diagram contradicts itself: "popup 2 appears IMMEDIATELY" after popup 1 approved, AND T1's card shows "Estimating fee + Simulating" — meaning T1's build is still in progress when popup 2 opens. The only way both are true is if the baton releases at popup-approval AND the dispatcher slot has been freed AND T2's handler is free to start its own interaction phase concurrent with T1's execution phase.

What you actually want is **two-baton or per-phase release**: the FIFO baton governs *handler entry into the interaction phase*. Once popup #1 is approved (interaction phase complete), release that baton so T2's handler can run *its* interaction phase. T1's *execution* phase then runs gated by a new per-account exec mutex; T2 will eventually queue behind that mutex post-approval.

Rewrite Step 11/12: the baton release at `onTxRequestFinalized` is the *execution-phase* signal; you need an *interaction-phase* release wired into `approveInteraction`. Two distinct signals, both forwarded as separate hooks.

**[P1] "Per-account execution mutex" is underspecified.** Where does it live? `ExecutionService` is the natural owner, but `executeOperations` already lock-free fans through many op kinds. A new `Map<accountAddress, Lock>` in ExecutionService with eviction-on-leave semantics is the minimum. The plan also doesn't say what the lock key is — `accountAddress` alone or `(profileId, accountAddress, networkId)`? PR #53's `journalRecordInScope` filters by both `accountAddress` and `networkId`, so concurrent sendTx on the same account but different networks would currently surface fine; gating on `accountAddress` only would over-serialize. Use the tuple.

**[P1] Cancellation propagation through the new exec mutex is not specified.** Plan says "Cancel should still produce 4001 / JOB_CANCELLED at the dApp boundary. Pin in tests." But the mechanism isn't there: today `cancelJob` transitions the journal to `cancelled`, and `claimOrCreate` rechecks before claiming. With T2 *between* claim-helper's transition (queued → pending) and the new exec mutex's acquire, where does the cancel land? At minimum, T2 needs to `await mutex.acquire()` inside an `AbortSignal`-aware wrapper that throws `JobCancelledSentinel` if `controller.signal.aborted`. Add this to the plan or it will become a post-impl audit P0.

**[P2] Reaper coverage for "pending-too-long" is hand-waved.** The plan acknowledges T2-approved-but-waiting sits in `pending`, not `queued`. The existing reaper only sweeps `queued` (PR #53) and `proving` (pre-existing `stuck_proving`). Without an explicit pending-stage reaper window, an SW restart with T1 mid-prove and T2 holding the exec mutex slot leaves T2's journal at `pending` forever after recovery. Add: pending-stage reaper sweep with a tighter window than `INTERACTION_TIMEOUT_MS` (since pending is *after* user approval — should be bounded by reasonable proving time, e.g. 5 min).

[NOTE: codex's audit corrected this — `pending` DOES get swept aggressively. Opus's premise here was wrong; codex's correction is in `audit-codex.md`.]

**[P2] Approval-path e2e wall-time budget not actually verified.** The plan says "Targets the standard SHA-1 matrix shard distribution per user's CI-cost preference" but doesn't do the arithmetic. From `pr-network-e2e.yml`: each shard timeout is 30 min, fee-methods.test.ts is ~6 min on its own at 5 tests / 4 fee-juice tx flows. A `prove × 2` concurrent test will roughly double that worst case for one file = 10-12 min on the shard host. Probably fine at N=5 but only because fee-methods is split out as `network-e2e-heavy`. If the new test gets SHA-1-sharded onto the same shard as `multi-account-from.test.ts` (~slow, deferred-slow quarantined) the budget gets tight. **Either:** (a) gate on `NULO_E2E_SKIP_DEFERRED_SLOW` for the prove-prove variant and keep a popup-shape-only variant in the matrix, or (b) move to `network-e2e-heavy` alongside fee-methods. Don't hand-wave.

**[P2] "Reserve a true orphan fallback ONLY for the case where `executingTask` exists AND has NO matching journal record" — verify if reachable today.** Layer A item 2 says "verify if this path is reachable today; if not, drop it entirely." This *is* the right hedge — but `hasOrphanExecutingTask` (RecentActivityView.vue:369) already exists for this scenario and it's used. Audit the call sites: today the orphan path is hit when TaskService has an entry but no journal record matches it. Post-W5 (where journal is source of truth) the orphan should be vanishingly rare. Decide: drop or keep — the plan needs an answer, not "verify during implementation."

---

## Architectural risks

**Anti-suggestion (the simpler architecture).** I'd argue the plan over-engineers Layer B. The simpler architecture:

> Keep the FIFO baton release at `onTxRequestFinalized` as PR #53 ships it. Don't touch the baton. Instead, give `DappInteractionService` its own per-session interaction queue — when `interaction()` runs, it acquires the session's interaction-queue slot, opens popup #1, awaits approval, releases the slot. The handler's `dispatcher.dispatch` still gates on the FIFO baton for execution-phase entry; the interaction-phase doesn't block the next handler from also entering interaction-phase.

This gives you popup #2 opening immediately after popup #1's *approval* without moving the baton boundary, without inventing a per-account exec mutex, and without splitting `DappInteractionService.execute()`. The exec-phase serialization that the plan attributes to the new mutex *already happens at PXE's `withPxeWrite`* per the existing comment in `executeAztecSendTx`. You don't need a second serialization layer.

The risk this anti-suggestion misses: if popup #2 opens with stale account / fee preset / capability cache from popup #1's interaction context, you'd leak state. But the popup itself reads fresh state from services on mount; nothing flows between popups unless you intentionally pass it. Concretely: what would actually break?

Strong recommendation: **prototype the simpler design** in a one-day spike before committing to the split-execute architecture. If it works, ship it. If not, fall back to the planned design with the gaps above closed.

**Deadlock between exec mutex and journal mutex.** If T2 is holding the exec mutex and waits for the journal mutex (via `markJournal` or `transitionOperation`), and T1 is holding the journal mutex and waits for... no, that can't happen because T1's exec is what released its journal-mutex slot. *But*: if `claimOrCreateDappExecuteJournal` takes the journal mutex to claim (queued → pending) and then needs to acquire the exec mutex, the lock order is: journal → exec. As long as no other code path holds exec and then awaits journal, you're safe. Walk every code path that touches the journal under the exec mutex; document the lock order in `ExecutionService` JSDoc.

**SW restart while T2 holds the exec mutex.** Mutex is in-memory only. On SW restart: T1 was in `proving`/`submitting` (durable journal stage), T2 is in `pending` (durable). After restart, no in-memory mutex exists. Reaper picks up T1 and T2 as non-terminal — for T1 in `proving`, `stuck_proving` reaper fires; for T2 in `pending`, today's reaper would *not* fire (no pending-stage coverage). Recovery: SW boot needs to either reap pending records *that lack an in-flight execution path* (impossible to detect without an explicit "is being processed" flag on the record) or set a `pending`-stage reaper window. The latter is simpler — add a 5 min pending reaper.

[NOTE: codex's audit corrected this — pending IS swept already. See codex's transcript.]

**Out-of-order popup approval.** User approves popup #2 *before* popup #1 (which is the parallel-popup model). T2's approveInteraction fires → T2's handler tries to acquire the per-account exec mutex → T1 still holds it. Now T1's user-facing popup is still open. Does the popup #1 approval landing later still cleanly Cancel T2's wait? The plan needs to spell out: T2's wait on the exec mutex is *cancellable* via T2's AbortController. When the user clicks "Cancel" on T2's queued card, `cancelJob` transitions T2 to `cancelled` AND aborts T2's controller → mutex.acquire() throws → JobCancelledSentinel → 4001. Spell this out explicitly in the plan.

---

## Concurrent-popup adversarial findings

**Two `DappInteraction` records exist simultaneously** — per the plan's premise. Vectors:

- **Capability checks**: `validateSession` runs per-`execute()` call at the top, reads `DappSession` at that moment, then closes over it. If popup #1's `validateSession` ran when the session had `cap:sendTx`, but the user revokes the capability between popup #1 and popup #2 opening (via the wallet UI), popup #2 would run its own `validateSession` against the *current* session and correctly reject. **Safe** — each interaction has its own session snapshot.

- **Account selection**: account is part of the operation payload (`OperationRequest.account` → resolved via `parseCaipAccount`). dApp picks the account; wallet doesn't mutate selection across interactions. **Safe.**

- **Fee preset cache**: fee-method selection persists per `(profileId, networkId, accountAddress)` — the popup reads from `FeePreferencesService` on mount. If popup #1's user changes the fee preset before approving, popup #2 (opening later) inherits the new preset. **Behaviorally fine** — this is what the user just asked for. *But*: the dApp sees the new fee method on the second tx without warning. Worth a unit test.

- **Signer state / passhash**: the session lives at the `ProfileService` layer. `refreshSession()` is called inside `executeAndResolve` before execution. If popup #2's approval lands while popup #1's `refreshSession` is mid-flight, both refresh against the same session manager. The session manager already has its own lock (per `ARCHITECTURE.md` §7). **Safe.**

- **Payload encoding / random nonces (PR #53 work)**: `Fr.random()` for the per-tx nonce in `tx-request-builder.ts:126`. Each `buildAndEstimateTxRequest` call gets its own `txRequest` with its own random nonce. As long as the exec mutex actually serializes `buildAndEstimateTxRequest` calls, the nonces are independent. **Safe under the exec mutex; would race without it.** Worth pinning in a test.

- **Singleton service clients**: popup #1 and popup #2 are *separate windows* with separate Vue app instances. Service clients are per-window. No singleton cross-talk.

- **`WindowManager.handleId` / `handleId` collisions**: handle IDs come from `getRandomHex` (now 128 bits per PR #53). Statistically safe.

- **`storage.set(id, interaction)` race**: `DappInteractionService.storage` is a `Map`; concurrent `interaction()` calls take `this.lock.enter()` (the Lock at `service.ts:55`). If you split popup-interaction-from-execution and keep this lock around the storage write only, you're fine. **But** Layer B's text doesn't say what happens to this lock — it's currently serializing popup creation. Removing it without a replacement re-introduces concurrent storage writes. Spell out.

---

## `submitting.txHash` correctness

**`tx.getTxHash()` IS the canonical hash** that `node.sendTx(tx)` accepts and the chain indexes by. The aztec stack's `getTxHash` is deterministic over the proven tx bytes; the node never recomputes a different hash on receipt. Risk of drift is essentially zero unless the upstream `@aztec/stdlib` Tx class changes its hash algorithm — which would be a backward-incompatible upstream change you'd catch in `bun audit` / dep bumps long before it shipped.

Verifying this in the codebase: `service.ts:527`, `:1164`, `:1815`, `:1990` all read `tx.getTxHash()` *after* `provedTx.toTx()` and pass `.toString()` to `transactionService.addTransaction` and to `markJournal({ stage: "succeeded", txHash })`. The `kind ↔ succeeded.txHash` invariant in `operation-journal/service.ts:245-261` already enforces non-empty txHash on succeeded transitions for transfer + dapp_execute. So the canonical-hash assertion is **implicit in the existing codebase** — the same `tx.getTxHash().toString()` shows up at both the `submitting` and `succeeded` transitions; if they disagreed, half the wallet would already be broken.

**Test to pin this**: not a full network round-trip. A unit test in `recent-activity-handlers.test.ts` (or a new `submitting-hash.test.ts`) that constructs a fake `OperationRecord` with `progress: { stage: "submitting", txHash: "0xabc" }` and a fake chain tx with `hash: "0xabc"`, asserts `filterPendingDoubleRender` drops it. Plus the implicit invariant: any `submitting → succeeded` transition where `succeeded.txHash !== submitting.txHash` is a bug worth a journal-service test. Add this assertion to `transitionOperation`'s validation: when transitioning from `submitting` (with non-empty txHash) to `succeeded`, the txHashes must match. That's the canonical-hash pin the plan asks for.

**Verdict on the txHash plumbing: low risk, but add the `submitting→succeeded.txHash matches` invariant assertion to `transitionOperation`** as part of Layer A. That's the actual pin against silent drift.

---

## Split vs bundle

**Recommendation: split into A+C as PR #54, then B as PR #55.**

Reasoning:

1. **PR #53 was large.** User explicitly flagged PR-size concern. Bundling three intertwined changes (txHash + UX refactor + e2e + Layer B's architectural split) recreates the same review fatigue.

2. **Layer A is mechanically simple and fully solves codex P1.** Four call-site changes, one filter refactor, one invariant pin, and the orphan-path question resolved. ~150 LOC. Reviewable in 30 minutes.

3. **Layer B is architecturally ambiguous (see above).** The split-popup-from-execution change is the biggest mechanical change in the plan and has the most open questions. It deserves its own PR with its own review cycle, its own audit transcript, and the parallel-popup e2e living *in that PR* rather than getting buried under Layer A's review.

4. **Layer C straddles.** The approval-path e2e is best landed with Layer B because that's the test of Layer B's new boundary. Until Layer B exists, the test would only re-verify what PR #53 already covers.

5. **Risk asymmetry.** Layer A is a bug fix to a bug already in production (the filter no-op). Shipping it fast unblocks the "disappearing card" regression that codex flagged as a real user-visible defect. Layer B is a UX optimization for a flow that *works correctly today, just slowly* (popup #2 waits for popup #1's full tx-build). Different urgency, different shape, different review burden.

The counter-argument for bundling: "we'd touch the same files twice." True for `execution/service.ts` (txHash sites + exec mutex addition). Acceptable cost — Layer B's mutex addition is additive and won't conflict with Layer A's txHash plumbing.

---

## Test gaps

- **Missing**: a unit test pinning `submitting.txHash === succeeded.txHash` invariant at `transitionOperation`. Add as part of Layer A.
- **Missing**: a unit test for `filterPendingDoubleRender` with two concurrent journal records both at `submitting` stage with distinct txHashes — covers the multi-pending case the v1 blanket-suppress was masking.
- **Missing in Layer B**: cancellation while T2 holds exec-mutex wait. Per-account exec mutex must be cancel-aware; needs a unit test.
- **Missing in Layer B**: SW restart with T2 in `pending` stage. Recovery path test.
- **Missing in Layer C**: the approval-path e2e doesn't enumerate the "popup 2 opens within X ms of popup 1 approval" bound. Pin the bound (suggest 1s) so a regression that pushes T2's popup back to after T1's full prove cycle fails the test.
- **Wall-time budget for prove × 2**: needs `NULO_E2E_SKIP_DEFERRED_SLOW` gate OR move to `network-e2e-heavy`. Plan must pick one before approval.
- **Missing**: silent-path concurrency. Two `aztec_sendTx` with self-paid fee (silent path, no popup) arriving concurrently. Does the per-account exec mutex correctly serialize them? The plan doesn't mention the silent path's interaction with the new mutex.

---

## The one thing

**Spike the simpler architecture before committing to split-popup-from-execution.** Specifically: a 1-day prototype where the FIFO baton stays where PR #53 puts it (releasing at `onTxRequestFinalized`), and you ONLY add a per-session interaction queue inside `DappInteractionService` so popup #2 can open immediately after popup #1's *approval* (not after popup #1's full prove). If that gets the user-requested UX, you skip inventing the per-account exec mutex, the queued-vs-pending reaper distinction, the deadlock analysis between two mutex layers, and you keep Layer B's diff to <100 LOC.

If the spike fails — e.g. because the dispatcher's per-message FIFO actually does block popup-creation in a way the trace will reveal — *then* you have a reasoned justification for the planned architecture and you carry the spike's trace into Layer B's audit-codex.md to short-circuit codex's first round.

This is the kind of decision worth burning one day on before sinking a 3-PR sequence into it.
