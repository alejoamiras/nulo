# v3-followups plan — codex audit (xhigh, read-only)

Verdict: sound-with-changes. Transcript:

**Verdict**

`sound-with-changes`

**Findings**

- **P1 cap key**
  Pure per-lane cap `(profileId, chainId)` is the wrong default if the reject is hard-fail. Today a hostile dApp can already cause delay; this plan would upgrade that into a cross-dApp reject primitive against innocent origins. That threat is real enough to justify extra complexity.
  
  The best design is a third option: keep the **shared FIFO lane**, but cap each **origin’s contribution** inside that lane, and separately keep a coarser **total lane cap** for memory/backpressure. If forced to choose only `(a)` vs `(b)`, choose `(b)`, but key it by **origin/grant principal**, not raw `sessionId`, or a hostile site can reopen sessions/tabs to multiply quota.

- **P1 depth accounting**
  The conservative abort accounting (`prior.finally(release)`) is the safer choice. It can temporarily over-count and reject a request that would have fit, but it does **not** let the cap be bypassed, and it should not permanently wedge the lane unless the prior holder is already wedged, in which case the lane is dead anyway.
  
  Immediate decrement is riskier because any guard bug becomes an under-count bug, and under-count is worse than over-count here: it admits `> N` or underflows. I would explicitly test middle-waiter abort, tail abort, repeated abort signal, reject-before-enqueue, and no-negative-depth / key-GC invariants.

- **P1 reject plumbing**
  `-32005` is defensible. It is JSON-RPC-ish rather than EIP-1193-native, but “limit exceeded” is the closest standard bucket. The real contract is `data.walletErrorCode = "TOO_MANY_PENDING"` plus a stable message with no origin/profile detail.
  
  The journal terminalization reasoning is **not fully correct as written**. It is true for popup flows where the preallocated record is still `queued`, but it is false for the **silent path**: that path can fast-forward the record `queued -> pending` before execution starts. If capacity reject happens before claim, `journalId` stays undefined, `markJournal(failed)` no-ops, and the background catch only terminalizes records still at `queued`, so the card can stick at `pending` until reaper grace expires. This needs an explicit cleanup on the capacity-reject path for the unclaimed `queuedJournalId`.

- **P2 spike-first**
  The spike + fallback is the right control. Do the spike first, timebox it, and do not let it block P1.
  
  But the current hypothesis is incomplete: the existing NO_FROM test is not merely “unreliable in sandbox.” The current test payload is `transfer_public_to_public`, and the code path explicitly rejects that because `DefaultEntrypoint` only supports **exactly one private function**. So the first spike question is not balance/deploy/authwit; it is: **what single private call are we actually using?**
  
  Plausible path: switch the target call to a private token function such as `transfer_public_to_private` or another single-call private transfer, then determine whether deploy, public balance, private note state, and authwit are sufficient for deterministic `ok`. The spike should prove single-tx success repeatedly and only then move to the concurrent both-confirm test.

- **Over/under-scope**
  P1 and P2 should be split. P1 is a behavior/security/backpressure change; P2 is test-infra research with real feasibility risk. Bundling them makes review worse and lets a flaky or hard sandbox problem hold up the more actionable fix.
  
  The main sequencing issue is that the cap principal decision is not a detail; it is the design fulcrum. Resolve that before implementation. I would not start with pure per-lane and “disconnect the hostile dApp” unless you explicitly accept cross-origin hard-failure as product behavior.

- **Adversarial / security**
  With pure per-lane cap, the attack is obvious: hostile dApp A fills the shared lane, then dApp B gets deterministic `-32005`. That is a clean cross-origin griefing tool.
  
  If you key quotas by `sessionId`, attacker bypass is also obvious: reconnect/open fresh tabs and mint new sessions. Key by origin/grant principal instead.
  
  The conservative over-count can be abused only to extend temporary fullness until the current holder finishes; that is acceptable. The immediate-decrement variant creates the much worse class: underflow / cap bypass / counter corruption.
  
  The current plan also risks a UI grief bug on silent-path rejects by leaving a `pending` card behind. That is not catastrophic, but it is user-visible and attacker-triggerable.

**Recommendation**

Pick **hybrid `(shared FIFO) + per-origin contribution cap + total lane cap`**. If you insist on choosing only `(a)` or `(b)`, choose **`(b)`**, but make it **origin-scoped**, not session-scoped.

That gives you the important property you want: one dApp cannot monopolize a shared PXE lane, while the mutex ordering and chainGuard alignment stay unchanged. It is the smallest design that addresses the actual adversarial problem without turning the cap itself into a cross-dApp denial primitive.
---

## Final pass (revised plan)

Verdict: changes-needed → integrated (originKey = canonical origin not display-name; originKey required; spike proves end-to-end confirm). Transcript:

**Verdict**

`changes-needed`

**Findings**

1. High: the plan’s chosen principal is not actually `LocalTxOrigin.name` in the current sendTx paths. The popup path passes dApp display name at [index.vue](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/popup/windows/execute/index.vue:358), and the silent path does the same at [service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/dapp-interaction/service.ts:329). The canonical non-spoofable principal already used for session scoping is the browser origin / `dappMetadata.url` at [service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/dapp-session/service.ts:85) and the wallet-bridge origin at [dispatcher.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/wallet-bridge/src/dispatcher.ts:266). Meanwhile `origin.name` is already user-facing UI data for journal/tx labels at [service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/execution/service.ts:1216) and [tx-detail-helpers.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/popup/components/modules/tx/tx-detail-helpers.ts:74). So “use `LocalTxOrigin.name` as `originKey`” is not faithful to the current model; it would either key the quota on spoofable display names or regress UI strings to raw origins. Thread a separate canonical `originKey`.

2. Medium: the optional `originKey?` branch is unnecessary and makes the counter design sloppier than it needs to be. Every current caller that reaches `acquireExecutionSlot` is dApp `aztec_sendTx` at [service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/execution/service.ts:1851) and [service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/execution/service.ts:1995); UI `send_transaction` does not use this path. Make `originKey` required for P1, or use an explicit sentinel if you later extend the mutex to non-dApp callers.

**Answers**

1. Yes, the dual-cap accounting is sound with conservative over-count, provided three invariants hold: increment only after passing both caps, capacity reject mutates nothing, and release is the sole decrement path. The existing abort chaining at [execution-mutex.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/execution/execution-mutex.ts:59) plus the current abort tests at [execution-mutex.test.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/execution/execution-mutex.test.ts:88) support that. Decrementing both in one idempotent release is correct only if both were incremented. If `originKey` can be absent, decrement origin conditionally or, better, stop making it optional for this PR.

2. `LocalTxOrigin.name` is not the right principal as the code stands. It is display text on popup/silent sendTx, not canonical origin. The right principal is the actual session origin (`ctx.origin` / `dappMetadata.url`). For non-dApp origins: current scope does not need that branch. If you add it later, prefer a sentinel principal over `undefined`.

3. Yes, cap-reject-before-controller-registration plus explicit `queuedJournalId` terminalization is the right fix. It is required because the background safety net only terminalizes still-`queued` records at [background.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/wallet-sdk/background.ts:551), while the silent path can already be `pending` at [service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/dapp-interaction/service.ts:315). I do not see another remaining card leak if that explicit failure happens on both standard and NO_FROM acquire-reject paths.

4. `transfer_public_to_private` is plausible. `buildNoFrom` only requires exactly one top-level private call at [tx-request-builder.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/extension/src/wallet/services/execution/tx-request-builder.ts:423). The subtlety is that “accepted by DefaultEntrypoint” is weaker than “deterministically confirms”: that private call may still enqueue public work internally, so the spike must verify end-to-end state prerequisites, not just function type.

5. Aside from the origin/display-name split and the unnecessary optional-origin branch, the consolidation is faithful and the revised P1/P2 split is correct. No new blocker beyond that.