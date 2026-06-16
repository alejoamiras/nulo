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

## Root cause — EVIDENCED (instrumented soak 27649347398, iter 2)
- **Reproduces in ISOLATION on CI (~2/3 iterations); NOT predecessor-dependent** (multi-account-from alone stalls). NOT reproducible on the fast local Mac → CI-environment/timing-specific.
- **Deep-dump full record at the stall:** `{"stage":"queued","createdAt":1781645673546,"updatedAt":1781645673546,"attempts":0,"error":null,"title":"transfer_public_to_public"}`. **createdAt === updatedAt** ⇒ the `beginExecutionWait` heartbeat never ran ⇒ stalled at **case (a): `resolveExecutionMutexKey`** (`getActiveProfile`/`getNetwork`), BEFORE FIFO-enqueue — NOT at `executionMutex.acquire`.
- **SW log trail at the stall = 50 of 50 entries are `context:offscreen, source:pxe` block_synchronizer** ("Updated pxe last block to 117911/117912/…", chainId 11155111, blockNumber ~117911). The offscreen PXE is consumed synchronizing a large block backlog.

**Root cause (high confidence, pending codex mechanism-pin):** execution-start (`resolveExecutionMutexKey`) is starved/blocked while the offscreen PXE churns a large block backlog, so the `dapp_execute` record never leaves `queued` within the 90s budget. **Intermittent** because it depends on how far behind the PXE block-sync is when the test fires the sendTx. **Proverless-exposed**, not proverless-caused: real proving time used to absorb this PXE-sync window; collapsing it to fake-proof speed surfaced the stall. **NOT machine resource-starvation, NOT CDP** — the discredited prior theory is now positively refuted by the captured trail.

**Fix direction (preliminary — for the fix blueprint, NOT done here):** gate the sendTx on PXE-synced/ready (a warmup that awaits block-sync settle), and/or decouple `resolveExecutionMutexKey` from the busy offscreen context (cache profile/network), and/or widen the F3 budget. The high block number (117911) + chainId 11155111 on a "local" sandbox suggests the e2e PXE syncs a large backlog — a sandbox/warmup config lever worth checking.

## F2 link hypothesis
F2 (`authwit-consume-smoke`) uses the SAME 2-account fixture and its grant is a sendTx — so F2's "result never settles" may be the SAME queued-stall surfaced via `waitForPgResult` instead of `waitForDappExecuteWorked`. The F2 soak's deep dump (now wired into waitForPgResult) will confirm/refute F2≡F3.

## Pending
Codex (`bi75gmgd8`) to pin the precise SW-vs-offscreen starvation mechanism + confirm getNetwork's PXE dependency + refine the fix direction. Then mark Phase 2 ✓.
