# Cluster C2 — execution pipeline + journal + fees (slot/FSM/fence lens)

> Scanner: general agent, 2026-08-22. NOTE: agent output arrived partially garbled (it responded as if reviewing a draft); findings below are reconstructed from its substantive content and require adjudication-level verification.

## C2-1 — Session-FIFO queued dApp requests exceed the reaper's queued grace when head-of-line approval sits >10 min → silently auto-cancelled

**Severity:** Major (candidate) | **Repro confidence:** moderate — NEEDS VERIFICATION | **Type:** bad retry-or-timeout / false failure

**Claim:** queued-journal records created at message ARRIVAL (tryCreateQueuedJournal) sit at `queued` stage while the session FIFO serializes behind the head-of-line request. The lane's wait-heartbeat (executionWaiters, execution-lane.ts:287-302) bumps updatedAt only for records waiting INSIDE acquireSlot — not for requests queued upstream in wallet-sdk sessionQueues. If the head popup sits open ~10 min (user away), ≥2 same-session queued records' updatedAt goes stale; reaper's queued grace is 10 min (reaper.ts:72-82) → marks them failed (stuck_queued). When their turn comes, claim-helper sees stage=failed → JobCancelledSentinel → dApp gets cancellation despite never being rejected by user or capacity.

**Fix direction per scanner:** heartbeat session-FIFO waiters (extend executionWaiters mechanism to queued records at claim time), or key grace on createdAt + handler-started flag instead of updatedAt. Do NOT reap-on-FIFO-position (reintroduces crash-detection the grace exists for).

## C2-2 — Controller-map leak in runInSlot on genuine claim-storage error

**Severity:** Low | **Repro confidence:** high code-path | **Type:** resource leak
If claimOrCreateJournal throws a genuine storage error from claim-helper.ts:203, journalId stays undefined so finally skips deleteController — but acquireSlot already registered preController under queuedJournalId (execution-lane.ts:240-243). Sentinel paths safe (cancelJob deletes entry); this path leaks until later cancelJob or SW death. Slot itself releases fine.
**Fix:** deleteController in catch for the queuedJournalId when claim threw.

## C2-3 — Unbounded waitForTx hang

Same as C1-2 (converged): transaction/service.ts:221-227 while(this.pending.has(hash)) sleep(100) no timeout; revokeAuthwits/setRegistryEnabled spin forever holding open subtask.

## Verified clean (per scanner)

- ExecutionMutex abort-splice FIFO/depth accounting: conservative over-count only.
- GasBalanceReader dual-epoch fencing: forced refreshes serialize through single-flight; no stale-overwrites-fresh interleaving.
- EstimateCancelRegistry settle-vs-cancel admission + stash-then-settle race closure (covers transfer-executor.ts:267-298 post-checkCancelled stash awaits).
- GC succeeded-eviction: feed filters out succeeded journal cards at RecentActivityView.vue:316-318.
- Boot-cutoff capture order: runtime.ts:304 precedes services.start().
- Fee-strategy clone depth: array-slot mutation only, fresh clone per dispatch.
- FSM reachability of every executor transition: all proving entries come via simulating.

## Adjudication TODO
- Verify C2-1 end-to-end myself (queued stage → reaper grace → stuck_queued transition → claim rejection) before accepting.
