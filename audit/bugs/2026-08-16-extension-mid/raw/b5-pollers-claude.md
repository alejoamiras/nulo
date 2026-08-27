# Findings: cluster b5-pollers (incoming-transfer, token-balance, price, network, transaction, note, account, account-state, token)

### Finding: Profile switch while a token-balance refresh is queued permanently jams that balance's sync (orphaned `pendingTasks` entry)

**Severity:** Critical

**Repro confidence:** high

**Type:** lost update (primary) / resource leak (secondary — orphaned map entry + stuck `Processing` task)

**Counter-example:**
1. Profile A is active. Any balance-affecting event enqueues a refresh for `TokenBalanceRaw` id `42` — e.g. `TokenBalanceService.refreshTokenBalance(42)`, `onTokenUpdated`, `onTransactionUpdated`, or the incoming-transfer causal-ack `requestBalanceRefresh(...)`. `BalanceJobQueue.enqueue()` (`apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:89-95`) sees no existing `pendingTasks` entry, calls `this.tasks.createNewTask(...)` (a `TaskStatus.Pending` row in `TaskService`), and records `pendingTasks.set(42, taskId)`.
2. Before the next 1s ticker fires, the user switches the active profile to B (a routine action). `ProfileService.onActiveProfileChanged` fires synchronously to all subscribers (`packages/wallet-core/src/utils/event-handler.ts:22-28`). `TaskService.onActiveProfileChanged` (`apps/extension/src/wallet/services/task/service.ts:238-246`) sees a genuine profile change and runs `this.tasks.clear()` **unconditionally on every task**, including id `taskId` that was just minted for balance `42`. `TokenBalanceService.onActiveProfileChanged` (`apps/extension/src/wallet/services/token-balance/service.ts:240-248`) only rebuilds `this.tokens` — it never touches `BalanceJobQueue`'s internal `queue`/`pendingTasks`.
3. The still-queued item for balance `42` is untouched by the profile switch (nothing clears `queue`), so the next tick dequeues it and calls `syncBatch([tb42, …])` (`balance-job-queue.ts:155`).
4. The pre-`try` task-start loop (`balance-job-queue.ts:159-167`) runs: `taskId = this.pendingTasks.get(42)` is still set (stale), so it calls `this.tasks.startTask(taskId)`. `TaskService.getTaskById` (`apps/extension/src/wallet/services/task/service.ts:179-185`) throws `Invalid task id: …` because the task no longer exists (cleared in step 2).
5. This throw happens **before** `syncBatch`'s `try { … } finally { for (const tb of batch) this.pendingTasks.delete(tb.id) }` (`balance-job-queue.ts:169`, finally at `238-242`) is ever entered, so the cleanup never runs. It propagates to `tick()`'s own try/catch (`balance-job-queue.ts:116-126`), which only logs and ends the tick — the whole batch (every id iterated up to and including `42`) is lost from `queue` (already `dequeue()`d — `packages/wallet-core/src/utils/queue.ts:38-44` removes it from both `items` and the dedup `keys` set) with `pendingTasks` still pointing at a now-nonexistent task id for each of them.
6. Any future `enqueue(tb42)` sees `pendingTasks.has(42) === true` and skips minting a fresh task (`balance-job-queue.ts:90-93`), so it only re-queues the balance via `priorityPass`. The next tick hits the identical `startTask(staleTaskId)` throw again. This repeats **forever** — balance `42` (and any batch-mate iterated before it in that first failing tick) can never sync again for the remainder of the service-worker's life; only an SW restart resets the in-memory maps.

**Violated invariant:** the module doc says `pendingTasks` "prevents double-creation of a TaskService record" (`balance-job-queue.ts:10-13`) and assumes a `pendingTasks` entry always names a live task. Nothing keeps that assumption true across `TaskService.tasks.clear()`, which the codebase itself performs on every profile switch. A sibling consumer of the exact same hazard, `IncomingTransferService.readTaskState` (`apps/extension/src/wallet/services/incoming-transfer/service.ts:1885-1897`), already treats a vanished/invalid task id as `"missing"` via a `try/catch` around `getTaskSync` — establishing the correct defensive pattern that `BalanceJobQueue.syncBatch`'s task-start loop does not follow.

**Expected vs actual:** Expected — a profile switch mid-refresh should, at worst, cause that one refresh attempt to be retried (a fresh task minted next tick), since `TokenBalanceService` already treats a profile switch as invalidating its cached `tokens` map. Actual — the balance permanently stops syncing (stale `privateBalance`/`publicBalance`/`updatedAt` shown forever) with the orphaned batch's task stuck at `Processing` in `TaskService` and a matching `error`-level log line on every single tick from then on.

**Recommended fix:** the smallest safe change is defense-in-depth at both ends:
- In `BalanceJobQueue.onActiveProfileChanged`-equivalent (there isn't one today) — have `TokenBalanceService.onActiveProfileChanged` (`service.ts:240-248`) also call a new `this.queue.reset()` that clears `queue`/`pendingTasks`, mirroring the `this.tokens.clear()` it already does for the same event.
- Harden `syncBatch`'s task-start loop (`balance-job-queue.ts:159-167`) to mirror `readTaskState`'s established pattern: wrap `startTask`/`startNewTask` per item in `try/catch`, and on failure fall back to minting a fresh task (as if `pendingTasks` had no entry) rather than letting the exception escape the function before `finally` can run.

**Instances (same root cause: an externally-held `TaskService` task-id reference silently invalidated by `tasks.clear()` on profile switch):**
- `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:159-167` (task-start loop, outside `try`/`finally`) — primary, permanent-jam instance described above.
- `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:238-242` (the `finally` that is skipped when the above throws).
- `apps/extension/src/wallet/services/token/service.ts:361` / `401-406` (`updateToken` holds a `WrappedTask` across the `fetchTokenMetadata` await; if the profile switches mid-await, `task.complete()` throws inside the `try`, and the `catch` block's `task.fail(error)` throws again for the same reason, masking the original error and leaving `updateToken`'s promise rejecting with a confusing "Invalid task id" instead of the real failure). Self-recovering (no persistent map), so lower impact than the primary instance.
- `apps/extension/src/wallet/services/token/service.ts:541` / `629-634` (`parseTokenInterface`, same pattern across several PXE awaits).

---

### Finding: `PriceService`'s single-flight `inflight` guard can be clobbered by a stale generation's `finally`, allowing a duplicate concurrent CoinGecko fetch

**Severity:** Minor

**Repro confidence:** moderate

**Type:** race (violates the documented single-flight invariant); no data corruption (writes stay gated by generation checks)

**Counter-example:**
1. A refresh is in flight: `refresh()` (`apps/extension/src/wallet/services/price/service.ts:276-283`) sets `this.inflight = P0 = doRefresh(gen0).finally(() => { this.inflight = undefined })`.
2. Before `P0` settles, the user flips "show fiat values" off then immediately back on (a normal double-toggle, or a config restore that briefly disables/re-enables it). `onConfigUpdated`'s kill-switch branch (`price/service.ts:206-213`) runs `this.generation += 1; this.abortController?.abort(); this.inflight = undefined` — manually clearing the reference to `P0` while it is still pending.
3. The re-enable branch (`price/service.ts:214-221`) immediately calls `refresh(gen=1)` again: since `this.inflight` now reads `undefined`, it proceeds to set `this.inflight = P1 = doRefresh(1).finally(() => { this.inflight = undefined })`.
4. `P0`'s aborted fetch rejects shortly after; `doRefresh`'s catch correctly no-ops on the stale generation (`price/service.ts:325`), but `P0`'s own `.finally(() => { this.inflight = undefined })` still fires — and at that moment `this.inflight` holds `P1`, not `P0`. The callback unconditionally clears it anyway, wiping the reference to the still-in-flight `P1`.
5. A third caller (e.g. a popup connecting and calling `refreshIfStale()`) now sees `this.inflight === undefined` and starts a **second** concurrent `doRefresh(1)`, in violation of the doc comment "Serialized refresh: concurrent callers share one in-flight request" (`price/service.ts:273-275`).

**Violated invariant:** single-flight refresh coalescing (explicitly documented at `price/service.ts:273-275`).

**Failing path:** `onConfigUpdated` (kill-switch) → `service.ts:210` manual `this.inflight = undefined` → `refresh()` (`service.ts:276`) starts `P1` → old `P0`'s `.finally` (`service.ts:279-281`) fires later and clobbers the `P1` reference.

**Expected vs actual:** Expected — at most one CoinGecko request in flight at a time. Actual — under this narrow but plausible toggle-off/toggle-on interleaving, two concurrent requests can fire. Impact is bounded: `mergeMonotonic` (`price/service.ts:363-380`) and the generation checks make the eventual cache write safe/idempotent, so this is wasted network traffic / rate-limit risk, not data corruption.

**Recommended fix:** capture the promise identity in the `finally`, e.g. `const mine = P0; ... .finally(() => { if (this.inflight === mine) this.inflight = undefined })`, so a stale generation's completion can never clear a newer in-flight promise.

**Instances:** `apps/extension/src/wallet/services/price/service.ts:203-223` (kill-switch handler) interacting with `service.ts:276-283` (`refresh`).

---

## Non-findings considered

- `incoming-transfer` `schedulers`/`publicSchedulers` setInterval leak on service "stop": no explicit `Service.stop()` lifecycle exists in this codebase (MV3 SW teardown discards the whole JS context, taking the intervals with it), so there is no live "add without matching stop-time clear" bug — every lifecycle-driven clear path I traced (`onAccountDeleted`, `onTokenDeleted`, `hydrateSchedulers`, `clearProfile`/`clearChain`) correctly pairs `clearInterval` with map deletion.
- `incoming-transfer` `polling`/`publicPolling` Set stuck `true` on a thrown poll: both `poll()` (`service.ts:939-960`) and `pollPublic()` (`service.ts:793-806`) delete the guard key in a `finally`, so a thrown scan cannot strand the reentrancy guard.
- `token-balance` `invalidatedBalanceIds` TOCTOU fence: verified the fence is checked synchronously immediately before every `repo.set` write in both `writeSyncFailure` and `syncBatch` (`balance-job-queue.ts:145-146, 205-210`), matching the doc comment exactly.
- `network` `transientNodes` serving a connection for a deleted network via `getNodeForUrl`: this is an explicitly documented design choice (`network/service.ts:578-600`) — pending-tx polling is intentionally pinned to the submitted URL independent of network-row lifecycle; `getNode(chainId)` (the row-scoped accessor) is properly serialized against `deleteNetwork` via the same `Lock`.
- `network` `transientNodes` failure counter never reset on a later success: causes an occasional harmless node-object rebuild after 3 stale failures age out; no observable wrong behavior.
- `transaction` `droppedWatch`/`droppedNextCheckAt` never cleaned on tx settle via another path: traced every writer (`updateTx`'s locked commit, `purgeForAccounts`, `restore`'s create-only guard, `addTransaction`'s duplicate-hash rejection) — all three maps are consistently kept in sync on every code path that can retire a hash.
- `ClockTickerAdapter` overlapping tick fire while a previous tick is still running: the `running`/`pending` coalescing flags (`core/adapters/clock-ticker-adapter.ts:22-48`) prevent concurrent `tick()`/`onAlarmTick()` invocations and contain thrown errors, so no unhandled-rejection or double-drain path exists.
- `incoming-transfer` `getReceiptFee`'s in-memory `feeCache` populated after a concurrent `clearProfile`/`clearChain`: the epoch-capture-before-cache-write pattern (`service.ts:443, 468-470`) plus the `finally`-scoped re-evict in both clear paths (`service.ts:655-661, 681-686`) closes the window correctly.
- `incoming-dust` `isReceiptAboveDustThreshold`/`usdThresholdToMicro`: verified fail-open behavior for non-finite/negative thresholds, unparseable/negative amounts, and rate-conversion throws — no counter-example found.
- `account/service.ts` `tupleLocks` map entries are never actually removed (the `finally` cleanup body is a documented no-op) — considered as a potential unbounded-growth leak, but the key space is bounded by `(profileId, chainId, type)` combinations actually used, which is small; no correctness impact. Filed under Quality handoffs instead.

## Quality handoffs

- `apps/extension/src/wallet/services/account/service.ts:179-197` — `serializePerTuple`'s cleanup `finally` block is dead code (empty branch with a comment admitting it never removes the map entry); either implement real ref-counted cleanup or drop the vestigial `finally` for clarity.