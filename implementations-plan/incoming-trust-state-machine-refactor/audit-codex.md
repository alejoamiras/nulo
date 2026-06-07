# Audit Round 1

## Verdict
Reject.

## Critical

- **Ref-counted eviction is unsafe with `Lock` force-release.** `plan.md:47-54,413-417` assumes `releaseTripleLock(profileId, networkId, contract)` can safely look up the current map entry by key. It cannot once `Lock.enter()` can auto-`leave()` after 5 minutes (`packages/wallet-core/src/utils/lock.ts:37-43`). A timed-out holder can resume later, call `leave()` on the old lock object, then decrement/delete a newer lock instance recreated under the same key. Fix: have `withTripleLock` retain and release the exact entry object/token it acquired, or drop eviction unless `Lock` exposes a stable idle/ownership signal. Add a force-release + recreate regression.

## High

- **Removing `scanGenerations` leaves `onAccountDeleted` uncovered.** `onAccountDeleted` only tears down schedulers (`packages/extension/src/wallet/services/incoming-transfer/service.ts:184-201`). After Phase 4/5 deletes `isStale` and generation checks (`plan.md:261-267`), an in-flight `scanContract` already past `getNotesRaw()` can still persist rows for a deleted account. The lock does nothing here because account deletion never acquires it. Fix: keep an account-scoped invalidation barrier, or add account deletion into the sequencing model before deleting `scanGenerations`.

- **Phase 6 is not closed, and it changes behavior.** The two-pass wipe (`plan.md:317-335`) has no quiescence proof; a third scan can land between the second snapshot and second `acquireManyTriples`. It also emits `onIncomingTrustChanged(...unknown)` even though current `clearProfile/clearChain` emit nothing (`packages/extension/src/wallet/services/incoming-transfer/service.ts:327-336`; tests at `packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:915-1007`). That violates the plan’s “byte-identical” surface claim. Fix: either loop until empty behind a higher-scope barrier, or elevate the event-semantics change as an explicit user decision.

- **Notification-flooding analysis is incomplete.** The plan only covers duplicate notes (`plan.md:381-385`). It does not cover churn: `onTokenDeleted` resets trust to `unknown` (`packages/extension/src/wallet/services/incoming-transfer/service.ts:470-482`) and PopupManager dedups only within one pending cycle (`packages/extension/src/popup/components/popups/PopupManager.vue:108-154`). A malicious `register_token -> revoke -> register_token` loop can repeatedly reprompt. Cross-profile isolation is also omitted from the threat analysis even though it exists in the key (`packages/extension/src/wallet/services/incoming-transfer/repository.ts:25`). Fix: document profile isolation explicitly and add churn throttling/debounce or require product sign-off on repeated prompts.

## Medium

- **Phase 5 does not cover tx-state changes mid-scan.** `scanContract` snapshots `outgoingTxHashes` / `inflightTxHashes` before the note loop (`packages/extension/src/wallet/services/incoming-transfer/service.ts:563-565`), while Phase 5 only serializes deletion of rows that already exist (`plan.md:275-311`). If `onTransactionAdded` lands between note K and K+1, later notes from the same tx can still be inserted after the delete because the dedupe snapshot is stale. Fix: recheck tx suppression inside the per-note critical section or introduce a tx-hash tombstone.

- **State-machine soundness is still permissive.** Public `setTrustState` is still exposed (`packages/extension/src/wallet/services/incoming-transfer/service.ts:237-240`; `packages/extension/src/wallet/services/incoming-transfer/spec.ts:135`), and nothing prevents illegal transitions like `unknown -> blocked` or `blocked -> pending`. The plan acknowledges this but leaves it as a follow-up (`plan.md:387-389,528-532`). With imminent users, that should be an explicit decision, not a silent default. Fix: validate transitions in the locked helper or explicitly bless keeping the permissive API.

- **Assumptions drift.** F7 says `EventHandler.invoke` is “sync-fires-async”; it is actually synchronous and only ignores returned promises / swallows sync throws (`packages/wallet-core/src/utils/event-handler.ts:22-27`). I1 is also too confident: per-note locking can create O(notes × concurrent-account scans) queue entries because the chosen lock key excludes `accountAddress` (`plan.md:440-444,531-532`). Fix: downgrade confidence and add a contention test measuring allow/reject latency under multi-account bursts.

## Low

- **The lock primitive is now correctness-critical, but I found no tests for it.** I found no `lock.ts` tests under `packages/wallet-core/src`. Fix: add unit pins for FIFO ordering, force-release, double-`leave()`, and `finally` release after thrown work before making this refactor depend on it.

## Things that look fine

- Phase 1’s wrapper split is the right deadlock fix. I grepped `setTrustState` callers and only found the service self-calls plus client/spec surfaces; there is no current nested external caller to preserve.
- The “user blocks between notes 5 and 6” case is handled by the planned per-note live trust re-read plus `hidden = trustState !== "trusted"` (`plan.md:230-253`; `packages/extension/src/wallet/services/incoming-transfer/service.ts:771-789`).
- Phase 5’s contract-grouping assumption is benign: `contract` is write-once at record creation (`packages/extension/src/wallet/services/incoming-transfer/service.ts:778`) and later updates spread existing records without mutating it (`packages/extension/src/wallet/services/incoming-transfer/service.ts:277-278,603`).

## Round 2 (push-back)

### Verdict
Reject.

### Critical

- **Phase 6’s `isWiping` barrier is not race-tight, and it does not cover all writers.** `scanContract` checks `isWiping` **before** `withTripleLock` (`plan.md:262-267`). If `isWiping` flips after that check but before the lock is acquired, the scan can still run after the drain. Worse, the other writers shown in the plan do not check `isWiping` at all: `setTrustState/Allow/Reject` (`plan.md:73-106`), `replayPendingPrompts` (`plan.md:115-140`), `onTokenDeleted` (`plan.md:151-184`), `onAccountDeleted` (`plan.md:205-228`), and `onTransactionAdded` (`plan.md:347-375`). `repo.clearProfile()` snapshots keys once (`packages/extension/src/wallet/services/incoming-transfer/repository.ts:95-105`), so any post-snapshot write can survive the wipe. Fix: make wipe a real admission barrier checked **after lock acquisition** by every writer, or hold a higher-scope wipe lock around the whole clear.

- **The drain only covers triples already visible in `listTrust()`.** `clearProfile` drains `trustRows` only (`plan.md:399-402`). A first-discovery scan for a contract with no trust row yet, or a deleted-account scan for a contract with no persisted rows yet, is invisible to that drain. Combined with the pre-lock `isWiping` check, it can create the first trust/record during the wipe and survive because `repo.clearProfile()` is iterating an older key snapshot. This is the main failure mode Round 1 missed.

### High

- **The wipe reopens before scheduler teardown/rebuild.** `isWiping` is cleared before `hydrateSchedulers()` runs (`plan.md:407-410`). Old intervals are still alive until `hydrateSchedulers()` clears them in current code, so a queued poll can run in that gap and repopulate the just-cleared profile/chain. Keep the barrier up through scheduler teardown/rebuild, or stop schedulers first.

- **Phase 3.5 only wipes one resolved network, not all networks sharing the chain.** The new pseudocode calls `resolveNetworkByChainId(account.chainId)` once (`plan.md:209-210`), but the current `onAccountDeleted` path explicitly iterates all matching networks (`packages/extension/src/wallet/services/incoming-transfer/service.ts:188-200`). Rows for the deleted account on sibling networks survive. `onAccountAdded` itself is not the hole; same-triple locking does serialize add vs delete. The uncovered case is “deleted account + sibling network + no existing persisted row.”

### Medium

- **I over-asserted the `txDeleteInflight` regression in Round 1.** I did not prove that removing the per-hash guard causes duplicate delete emits across different contracts; the per-record `getRecord` re-check may still suppress that. The stronger criticism is different: the design changes from per-hash serialization to per-contract interleaving, so cross-contract delete order becomes nondeterministic and you still need an explicit multi-contract same-hash reentrancy test. The current suite only pins the single-contract case (`packages/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:836-870`).

- **The new per-note critical section is no longer “repo-bound + sync.”** `scanContract` now does `getTokensRaw`, `collectOutgoingTxHashes`, and `collectInflightTxHashes` inside the lock (`plan.md:267-277`). That invalidates the plan’s own cost framing and makes I1 materially weaker: a burst of notes on one contract can now hold the lock across multiple service reads per note, which is exactly where user-facing Allow/Reject latency will show up.

- **“No eviction” is still an adversarial memory-growth choice.** `plan.md:59` sizes the map using honest-user behavior (“hundreds”), but the threat model explicitly includes malicious dApps. A `register_token -> revoke` churn across many distinct contracts can force `tripleLocks` growth for the life of the service worker. That may still be acceptable, but it is not a naturally bounded set.

### Low

- **I was too anchored by the plan framing in Round 1.** I spent too much budget on notification churn and public `setTrustState`, and not enough attacking the user-locked concurrency shape itself. I am not reopening `single-PR` or `lock-per-triple`, but this revision shows the real risk surface is now the fine-grained lock choreography around wipes, not the API footguns.

- **`plan.md` is still internally inconsistent.** It still references dropped ref-count eviction and second-pass clear tests (`plan.md:39,434-436`). That is not cosmetic if this document is meant to drive implementation and test rewrites.
