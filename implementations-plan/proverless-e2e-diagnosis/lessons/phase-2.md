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
- **Deep-dump full record at the stall:** `{"stage":"queued","createdAt":1781645673546,"updatedAt":1781645673546,"attempts":0,"error":null,"title":"transfer_public_to_public"}`. **createdAt === updatedAt** ⇒ the `beginExecutionWait` heartbeat never ran ⇒ stalled SOMEWHERE BEFORE it. **Codex correction (anti-over-pin):** this does NOT uniquely mean `resolveExecutionMutexKey` — the `dapp-interaction/service.ts:128` preflight (`getActiveProfile` + `refreshSession`) runs before `executeOperations`/`acquireSlot` and is equally consistent with the untouched record. Exact await point (preflight `refreshSession` vs `resolveExecutionMutexKey`) = **TBD**; both are pre-`executionMutex.acquire`.
- **SW log trail at the stall = 50 of 50 entries are `context:offscreen, source:pxe` block_synchronizer** ("Updated pxe last block to 117911/117912/…", chainId 11155111, blockNumber ~117911). The offscreen PXE is consumed synchronizing a large block backlog.

**Root cause (high confidence on the WHAT; exact await-point TBD):** the sendTx's execution-start never advances the record past `queued` within the 90s budget, correlated with the offscreen PXE churning a large block backlog. Codex confirmed `getActiveProfile`/`getNetwork` are **SW-local** (no direct PXE dependency — `profile/service.ts:88`, `network/service.ts:204`), so the mechanism is **INDIRECT SW backpressure**: the offscreen floods the SW with logger RPCs during block-sync, delaying the SW's small storage awaits (preflight + `resolveExecutionMutexKey`) — NOT a direct PXE call inside execution-start. **Intermittent** (depends on the PXE backlog when the sendTx fires). **Proverless-EXPOSED**, not caused: real proving time used to absorb this window. **NOT machine resource-starvation** (resources measured idle — see F1/F2 dumps), **NOT CDP** — the discredited prior theory is positively refuted.

**Fix direction (for the fix blueprint, NOT done here):** treat as **PXE readiness / warmup** — gate the first sendTx on PXE block-sync settle, and/or warm the offscreen PXE before the test acts, and/or reduce the offscreen→SW logger-RPC chatter during sync. The high block backlog on the local sandbox is the lever, not the execution-lane key resolution.

## F2 link hypothesis
F2 (`authwit-consume-smoke`) uses the SAME 2-account fixture and its grant is a sendTx — so F2's "result never settles" may be the SAME queued-stall surfaced via `waitForPgResult` instead of `waitForDappExecuteWorked`. The F2 soak's deep dump (now wired into waitForPgResult) will confirm/refute F2≡F3.

## Codex consult (session in `bi75gmgd8`) — verdict logged
**"Partly sound, but over-pinned."** Adopted in full:
- `createdAt===updatedAt` proves "never reached `beginExecutionWait`", NOT "stalled in `resolveExecutionMutexKey`" — the `dapp-interaction` preflight (`getActiveProfile`+`refreshSession`, `service.ts:128`) is an equally-consistent stall site.
- `getActiveProfile`/`getNetwork` are SW-local; the PXE backlog does not DIRECTLY block them → mechanism is indirect SW event-loop/message backpressure, not a direct PXE dependency.
- The synchronizer yields (per-block logs reach the SW), so it's not a non-yielding busy-loop.
- chainId 11155111 ≠ remote Sepolia; it's local-sandbox L1 metadata. PXE warmup/backlog theory still plausible.
- Fix = PXE readiness/warmup, not execution-lane key resolution.

To pin the exact await point WITHOUT a production change: the SW-worker-read instrument fix (this firing) now lets the deep dump read the SW log trail from any caller — a re-dispatched soak's trail should show whether `refreshSession`/preflight logged before the stall. (A precise pin would otherwise need timing logs in the SW path — a fix-phase activity.)

## Status
**Phase 2 success criterion MET** for F3: reproduction (CI ~2/3 isolation) + the stall point bounded (pre-`executionMutex.acquire`, before the heartbeat) + a named root-cause mechanism (indirect SW backpressure from offscreen PXE block-sync, proverless-exposed; resource-starvation refuted with data) + a fix direction (PXE warmup/readiness). Exact await-point (preflight vs key-resolve) is a refinement deferred to the fix blueprint. Will mark Phase 2 ✓ in plan.md after the F2≡F3 confirmation (same mechanism via the consume sendTx) from the re-dispatched SW-worker-instrumented soak.
