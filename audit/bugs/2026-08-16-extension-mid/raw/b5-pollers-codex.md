<!-- codex session 01a00a8d-e115-7c43-b73c-d22d9aec4a0c -->

### Finding: Profile-switch race exposes the previous profile’s token balances

1. **Severity:** Critical
2. **Repro confidence:** High
3. **Type:** race; wrong result
4. **Counter-example:** Profile B unlocks and its `getTokensRaw(B)` read stalls. The user locks and unlocks profile C; C’s read completes first and populates `tokens` with C’s tokens. B’s older read then completes and repopulates the same map with B’s tokens. `this.profile` remains C, but `getTokenBalances()` now filters rows using B’s token IDs and can return B’s balances in C’s session.
5. **Violated invariant:** `TokenBalanceService.tokens` is documented and used as an active-profile-only ownership map. Balance reads must never admit rows belonging to a non-active profile.
6. **Failing path:** `SessionManager.open()` emits the profile transition at `apps/extension/src/wallet/services/profile/session-manager.ts:202-225` → `ProfileService` forwards it at `apps/extension/src/wallet/services/profile/service.ts:148-153` → `TokenBalanceService.onActiveProfileChanged()` clears and asynchronously rebuilds the shared map without an incarnation check at `apps/extension/src/wallet/services/token-balance/service.ts:240-248` → `getTokenBalances()` trusts that map for ownership filtering at `apps/extension/src/wallet/services/token-balance/service.ts:138-150`.
7. **Expected vs actual behavior:** Expected: only the latest active profile’s tokens can populate the ownership map and its balances can be returned. Actual: an older asynchronous handler can overwrite the latest profile’s map, returning balances from the wrong profile until another profile event or worker restart.
8. **Recommended fix:** Add a monotonically increasing profile-generation counter. Capture it synchronously at handler entry and populate a temporary map; commit that map only if both the generation and current profile still match. Clear the map when the profile becomes `undefined`.
9. **Instances:** `apps/extension/src/wallet/services/token-balance/service.ts:240-248`, with the resulting unsafe ownership reads at `apps/extension/src/wallet/services/token-balance/service.ts:138-150` and callback write/emit ownership checks at `apps/extension/src/wallet/services/token-balance/service.ts:103-107`.
10. **Certificate summary:** A concrete delayed-B/fast-C interleaving leaves `profile === C` while `tokens === B`, directly contradicting the module’s active-profile ownership contract.

### Finding: A profile switch permanently wedges queued balance refreshes

1. **Severity:** Major
2. **Repro confidence:** High
3. **Type:** state invariant violation; bad error path
4. **Counter-example:** While profile A is active, enqueue balance 7, creating pending task `t1`. Before the next one-second queue tick, switch to profile B. `TaskService` clears A’s tasks, but `BalanceJobQueue` retains `pendingTasks[7] = t1` and the queued balance. The tick dequeues balance 7 and `startTask(t1)` throws because the task no longer exists. Since this occurs before `syncBatch`’s `try/finally`, the queue item is lost and `pendingTasks[7]` remains forever. Every later refresh of balance 7 reuses the invalid task ID and fails identically.
5. **Violated invariant:** Every dequeued balance must terminate or release its `pendingTasks` entry; the map is only valid while its referenced `TaskService` record exists.
6. **Failing path:** `TokenBalanceService.refreshTokenBalance()` at `apps/extension/src/wallet/services/token-balance/service.ts:153-159` → `BalanceJobQueue.enqueue()` records the task at `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:89-95` → profile change clears task records at `apps/extension/src/wallet/services/task/service.ts:238-245` → `BalanceJobQueue.tick()` dequeues the batch at `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:111-125` → `syncBatch()` throws outside its cleanup region at `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:155-169`.
7. **Expected vs actual behavior:** Expected: a stale task reference is discarded or replaced and the balance remains refreshable. Actual: the balance is not projected, its pending marker is orphaned, and refreshes remain wedged for the rest of the service-worker lifetime.
8. **Recommended fix:** Place task startup inside the existing `try/finally`, and make the catch path tolerate missing task records. At minimum, the `finally` block must execute for failures from `startTask`/`startNewTask`. Clearing or invalidating queued jobs on profile change would additionally prevent projecting old-profile work.
9. **Instances:** The uncovered throw sites are `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:160-166`; cleanup that is consequently skipped is at `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:238-242`. The catch path’s unguarded `getTaskSync` at `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:229-236` is another missing-task failure under the same root condition.
10. **Certificate summary:** A normal enqueue followed by a profile switch leaves a task ID referencing a cleared in-memory ledger; task startup throws before the only cleanup block.

### Finding: A stale profile hydration can reinstall inactive-profile incoming-transfer pollers

1. **Severity:** Major
2. **Repro confidence:** High
3. **Type:** race; state invariant violation
4. **Counter-example:** Unlock profile B and delay `tokenService.getTokensRaw(B)` inside `hydrateSchedulers()`. Lock B and unlock C; C’s hydration completes and installs only C’s schedulers. B’s older hydration then resumes and appends B’s private-note and public-event schedulers after C’s clearing pass. Those B schedulers continue polling and scanning indefinitely while C is active.
5. **Violated invariant:** The scheduler maps are described as the polling surface for the current active profile; a lifecycle rebuild must converge to exactly that profile’s networks, accounts, and tokens.
6. **Failing path:** Profile transition invokes `IncomingTransferService.onActiveProfileChanged()` at `apps/extension/src/wallet/services/incoming-transfer/service.ts:298-300` → `hydrateSchedulers()` clears maps before asynchronous profile/network/token reads at `apps/extension/src/wallet/services/incoming-transfer/service.ts:715-729` → its stale continuation installs per-account schedulers at `apps/extension/src/wallet/services/incoming-transfer/service.ts:730-739` and public schedulers at `apps/extension/src/wallet/services/incoming-transfer/service.ts:740-743` → the intervals repeatedly enter `poll()`/`pollPublic()` at `apps/extension/src/wallet/services/incoming-transfer/service.ts:747-778`.
7. **Expected vs actual behavior:** Expected: completing a profile transition leaves pollers only for the latest active profile. Actual: an older hydration can install pollers for an inactive profile after the latest hydration has already cleared and rebuilt the maps.
8. **Recommended fix:** Give scheduler hydration its own generation token. Build the desired scheduler specification off-map, then under `serviceLock` verify the captured generation and active profile before replacing the maps. The existing `serviceEpoch` pattern can be extended, but it must guard the hydration continuation itself, not only scans that were already running.
9. **Instances:** Unguarded hydration call sites are `apps/extension/src/wallet/services/incoming-transfer/service.ts:291`, `:299`, `:334`, `:654`, and `:680`; stale scheduler commits occur at `:735-743`. `onTokenAdded()` independently captures a profile before awaits and later installs schedulers without revalidation at `:808-845`, sharing the same lifecycle-staleness root cause.
10. **Certificate summary:** Clearing occurs at hydration entry rather than commit, so a slow older rebuild can append obsolete pollers after a newer rebuild has established the correct state.

### Finding: Kill-switch restart can corrupt price refresh single-flight and timeout ownership

1. **Severity:** Major
2. **Repro confidence:** High
3. **Type:** race; bad retry-or-timeout
4. **Counter-example:** Refresh A passes its generation check and stalls in `await cache.set()`. Fiat display is disabled, which increments the generation, aborts the shared controller, and immediately clears `inflight`. It is then re-enabled and refresh B starts with a new controller. When A’s storage write resumes, its unconditional cleanup clears B’s `inflight` and controller. An alarm can consequently start refresh C concurrently; B’s timeout callback dereferences the shared controller and aborts C rather than B.
5. **Violated invariant:** Concurrent refresh callers must share exactly one request for the current generation, and each request’s timeout must abort only its own fetch.
6. **Failing path:** `onConfigUpdated()` invalidates shared state at `apps/extension/src/wallet/services/price/service.ts:203-220` → `refresh()` installs an unconditionally-cleared shared promise at `apps/extension/src/wallet/services/price/service.ts:273-282` → `doRefresh()` uses a shared controller in its timeout at `apps/extension/src/wallet/services/price/service.ts:297-301` → an old invocation unconditionally clears that controller at `apps/extension/src/wallet/services/price/service.ts:332-335`.
7. **Expected vs actual behavior:** Expected: an obsolete generation cannot mutate or clean up a newer refresh’s state, and every fetch has an independent ten-second timeout. Actual: refreshes overlap, a newer request may be spuriously aborted, and another request can lose timeout protection and remain in flight beyond the intended limit.
8. **Recommended fix:** Capture each `AbortController` in a local variable and have its timeout call `controller.abort()`. Clear `abortController` and `inflight` only when they still identify the completing invocation. Store the generation alongside the in-flight promise so new-generation callers do not join an obsolete request. Recheck generation after `await cache.set()` before updating watermarks or emitting.
9. **Instances:** Shared-state invalidation at `apps/extension/src/wallet/services/price/service.ts:208-210`; unconditional promise cleanup at `:279-281`; dynamically targeted timeout at `:298-301`; unconditional controller cleanup at `:332-335`; missing post-write generation check after `:314-316`.
10. **Certificate summary:** Generation invalidation allows a replacement request, but obsolete asynchronous cleanup is not identity-guarded and therefore mutates the replacement request’s bookkeeping.

## Non-findings considered

- Incoming-transfer `polling` and `publicPolling` do not remain stuck after scan failures: both removals are in `finally` blocks.
- Incoming-transfer scheduler maps are cleared by normal hydration and chain/profile cleanup; the report above is specifically about stale asynchronous rebuilds committing afterward.
- The runtime has no general service `stop()` contract, so the absence of an `IncomingTransferService.stop()` override is not independently reportable.
- Token-balance success and failure storage writes both synchronously consult `invalidatedBalanceIds` immediately before dispatch.
- Projector and storage failures occurring after `BalanceJobQueue.syncBatch()` enters its `try` do reach the existing `finally`; only task startup and missing-ledger failures escape it.
- `NetworkService.getNodeForUrl()` continuing to use a removed endpoint is documented behavior for submitted-transaction endpoint pinning, not a deleted-network cache correctness bug.
- Transaction dropped-watch entries are removed on non-dropped settlement, purge/ambiguity handling, and resurrection-window expiry.
- Ordinary simultaneous price alarm and popup refresh calls share `inflight`; the failure requires generation invalidation followed by a replacement refresh.
