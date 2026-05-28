**Verdict**: `needs-revision`

**Completeness gaps**
- `P0` — The plan never pins the journal/FSM state for “approved but waiting on execution.” The desired UX says T2 shows **Queued** after approval, but the open questions assume it sits in `pending`. Those are different designs. If it sits in `pending`, the reaper kills it after **2 minutes**, not 10, per [reaper.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/operation-journal/reaper.ts:72).
- `P0` — The execution-mutex primitive is underspecified. If the author reuses the repo’s current [Lock](/Users/alejoamiras/Projects/nulo/nulo-1/packages/wallet-core/src/utils/lock.ts:4), it force-releases after 5 minutes, while proving is explicitly allowed to run much longer ([reaper.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/operation-journal/reaper.ts:66)). That breaks correctness.
- `P0` — Cancel while waiting on the exec mutex is not solved. Without an abortable acquire, T2 cancel does not surface 4001 promptly; it waits until T1 finishes.
- `P1` — “Popup approved” is too vague a baton boundary. Release should happen only after the **background** has a validated executable payload and has enqueued it for execution. Raw UI click is too early.
- `P1` — Layer A fixes current behavior, but not the regression surface. Plumbing `submitting.txHash` at the four TODO sites like [execution/service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/execution/service.ts:1803) is necessary; add an invariant or integration pin so future callers cannot reintroduce bare `submitting`.
- `P1` — The proposed tx-hash mitigation test is wrong. [AztecNode.sendTx](/Users/alejoamiras/Projects/nulo/nulo-1/node_modules/@aztec/stdlib/src/interfaces/aztec-node.ts:369) returns `Promise<void>`, not a hash.
- `P2` — “Parallel popups” is underspecified. The desired UX is sequential approval windows overlapped with background execution, not necessarily multiple execute windows open at once.

**Architectural risks**
- FIFO release should move to “approved payload captured in background,” not “user clicked approve.”
- The popup/execution split mostly already exists in [approveInteraction](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/dapp-interaction/service.ts:88) and [executeAndResolve](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/dapp-interaction/service.ts:124). The risky part is the new execution queue, not the popup handoff itself.
- Lock ordering must be explicit. Safe shape: wait for exec mutex first, then claim `queued -> pending`, then run execution. Cancel path must not hold journal state while waiting on the exec mutex.
- SW restart is not addressed. Current boot reap fails all non-terminal records. If that remains the rule, say so explicitly for approved-but-not-started T2.
- The plan’s reaper question is based on a false premise: `pending` does get swept today, and very aggressively.

**Adversarial findings**
- Popup-local state looks mostly isolated already: request data is keyed by `requestId` in [useDappInteractionPayload.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/composables/useDappInteractionPayload.ts:60) and fee state is local in [execute/index.vue](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/popup/windows/execute/index.vue:55). The real shared-state risk is background-side session/global state plus any new waiter registry.
- Capability-grant leakage is less about execute popups inheriting fee/account UI state and more about session-global grants/aliases being mutated while multiple requests are alive.
- `submitting.txHash` can silently fail again if propagation drifts. The right pin is consistency across `submitting`, `TransactionService.addTransaction`, and `succeeded`, plus a live recent-activity suppression test. Not `sendTx()` return value.
- If the new mutex wait is not abortable, a malicious or hung node can hold T2 hostage even after user cancel.
- Burst flood caveat survives only if the author keeps the current queued-record cap semantics in [queued-journal.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/wallet-sdk/queued-journal.ts:31) and defines how approved waiters count against them.

**Test plan gaps**
- Unit: dedicated exec-queue tests for FIFO fairness, per-account isolation, abort while waiting, and waiter cleanup.
- Unit/integration: explicit test for the approved-waiting stage decision. If T2 stays `queued` until mutex acquisition, pin that.
- Integration: make the disappearing-card fix live in [RecentActivityView.vue](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/popup/components/modules/general/RecentActivityView.vue:49), not just synthetic handler tests.
- Integration: add a cheap baton-boundary test at the background/dispatcher seam; the repo already has `session-baton` and hook tests to build on.
- E2E: the standard shard budget is not cleared. [concurrent-sendtx.test.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/tests/e2e/network/concurrent-sendtx.test.ts:35) already says the full approval-path companion likely exceeds today’s budget. You need a fallback now.

**Split recommendation**: `ship-as-A-then-B`

Layer A is mechanical and should ship first. Layer B changes concurrency boundaries, cancellation semantics, reaper semantics, and CI cost all at once. Bundling is defensible only if the author first rewrites the plan around an exact execution-queue contract.

**The one thing**
- Do not approve this plan until the author specifies the exact contract of the new per-account execution queue: which stage approved waiters live in, how mutex acquire is aborted on cancel, and what lock primitive is used. If they use the repo’s current `Lock`, the queue is wrong by construction.