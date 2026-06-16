# Phase 2 — F3 (queued-stall) root cause [IN PROGRESS]

## Code-grounded mechanism
F3's record reaches `queued` then never claims (`queued→pending`). The claim happens in `claimOrCreateDappExecuteJournal` (`claim-helper.ts:123`), which runs only AFTER `acquireSlot` returns (`dapp-send-executor.ts:283→304`). So **stuck at `queued` = `acquireSlot` never returned**. `acquireSlot` (`execution-lane.ts:211`) has exactly two await points before the claim:

- **(a) `resolveExecutionMutexKey(networkId)`** (`:217`) — the FIRST await, = `await getActiveProfile()` then `await getNetwork(networkId)` (`:188-192`). Runs BEFORE FIFO-enqueue + before the baton release. **Prime suspect**: for a single sendTx the lane mutex should be free, so a stall most likely means `getNetwork` (or `getActiveProfile`) hangs — a network/PXE/profile resolve that doesn't return under CI timing.
- **(b) `executionMutex.acquire` grant** (`:248`) — waits for the lane. Only stalls if the mutex is HELD and never released (would require a concurrent/leaked holder — surprising for a single tx in a fresh per-test browser).

## The disambiguator (readable from the instrument — no prod change)
`acquireSlot` calls `beginExecutionWait(queuedJournalId)` (`:231`) ONLY AFTER passing `resolveExecutionMutexKey`. `beginExecutionWait` starts a heartbeat that bumps the record's `updatedAt` every `EXECUTION_WAIT_HEARTBEAT_MS` (`:275-281`, `heartbeatExecutionWaiters` → `touchOperation`). Therefore, at the stall:

- **`updatedAt` is FRESH (recently bumped)** → execution PASSED `resolveExecutionMutexKey`, is heartbeating while waiting at `executionMutex.acquire` → **case (b)**.
- **`updatedAt` is STALE (≈ creation, ~test-duration old)** → never reached `beginExecutionWait` → stuck at **`resolveExecutionMutexKey` (a)** (`getNetwork`/`getActiveProfile` hang).

The Phase-1 `readDappExecuteRecordsFull` captures the full record (incl. timestamps), so the instrumented soaks' deep dump at the F3 stall will disambiguate (a) vs (b) directly. **No execution-lane logging exists** (confirmed — zero `logger.*` in the file), which is why the full-record `updatedAt` is the disambiguation channel rather than a log trail.

## Evidence in flight
- Instrumented soaks (on `80c309e`/`728bd78`): `27649235152` (in-sequence, 12 reps) + `27649347398` (isolation, 15 reps). Any F3 stall fires the deep dump → full record (updatedAt) + targets + resources.
- Local repro (`b1z2pu7of`): warmup + multi-account-from, proverless, retry=0 — tests the local-vs-CI axis (does F3 repro off-CI at all?).
- Predecessor-dependency: isolation vs in-sequence soak failure rates will show whether the stall needs the shard-5 predecessors (`_probe-warmup-effect` runs immediately before F3).

## Pending
Await soak/local evidence → read the stalled record's `updatedAt` → disambiguate (a)/(b) → codex synthesis → name root cause + fix direction. NOT yet concluded.
