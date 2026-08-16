<!-- codex session 01a00a8c-21bb-75b3-992c-6922180f113d -->

### Finding: Boot reaper can fail a newly started live operation

1. **Severity:** Critical
2. **Repro confidence:** High
3. **Type:** Race; secondary: state invariant violation
4. **Counter-example:** On a cold service-worker start, delay `alarms.create()`. `createWalletRuntime` invokes `reaper.start()` without awaiting it, then installs the wallet-SDK handler. Start a transaction and create its `pending` journal row before resolving `alarms.create()`. When the promise resolves, the unconditional boot sweep includes the new row and transitions it to `failed`, although its transaction pipeline is live in the current worker.
5. **Violated invariant:** `JournalReaper.start()` assumes every non-terminal row observed by its boot sweep predates the current worker. The comment explicitly says this is true “by construction,” but startup does not prevent current-lifetime operations from being created before the sweep takes its snapshot.
6. **Failing path:** `createWalletRuntime.start()` launches but does not await the reaper and continues exposing request handling ([runtime.ts:267](apps/extension/src/wallet/runtime.ts:267), [runtime.ts:295](apps/extension/src/wallet/runtime.ts:295)) → `JournalReaper.start()` suspends on alarm creation and later requests an unconditional sweep ([reaper.ts:117](apps/extension/src/wallet/services/operation-journal/reaper.ts:117), [reaper.ts:130](apps/extension/src/wallet/services/operation-journal/reaper.ts:130)) → `reap()` reads all current non-terminal rows without a startup cutoff and transitions the new row to `failed` ([reaper.ts:168](apps/extension/src/wallet/services/operation-journal/reaper.ts:168), [reaper.ts:200](apps/extension/src/wallet/services/operation-journal/reaper.ts:200)) → subsequent execution transitions are rejected and swallowed by `ExecutionLane.markJournal()` ([execution-lane.ts:362](apps/extension/src/wallet/services/execution/execution-lane.ts:362)).
7. **Expected vs actual:** Expected: only rows created before this worker’s startup are failed unconditionally. Actual: a live transaction created during the startup race is shown as failed; cancellation subsequently fails its FSM transition, while the underlying pipeline may continue and submit the transaction.
8. **Recommended fix:** Capture a boot cutoff before starting the reaper and have the unconditional sweep process only records with `createdAt < cutoff`. This is safer than relying solely on awaiting `start()`, because service RPC listeners are constructed before this point. Awaiting the initial sweep before publishing liveness and installing the SDK handler is useful additional ordering protection.
9. **Instances:** [runtime.ts:268](apps/extension/src/wallet/runtime.ts:268), [reaper.ts:121](apps/extension/src/wallet/services/operation-journal/reaper.ts:121), [reaper.ts:168](apps/extension/src/wallet/services/operation-journal/reaper.ts:168).

### Finding: Generic “not found” errors silently downgrade inclusion-safe fee prediction

1. **Severity:** Major
2. **Repro confidence:** Moderate
3. **Type:** Bad error path; secondary: wrong result
4. **Counter-example:** Supply a node whose `getPredictedMinFees()` rejects with `Error("Block 123 not found")` during a transient synchronization or reorganization condition, while `getCurrentMinFees()` returns `GasFees(1n, 1n)`. `predictedWorstMinFees()` treats the unrelated “not found” text as proof that the RPC method is unsupported and returns the current fee.
5. **Violated invariant:** The function’s documented contract says only old-node/unsupported-method failures may fall back; transient RPC failures must propagate because current fees are not an inclusion-safe substitute.
6. **Failing path:** Fee construction or reuse validation calls `predictedWorstMinFees()` → `node.getPredictedMinFees()` throws → the catch tests the entire error against `/not found|.../` ([fee-juice.ts:39](packages/bridge-core/src/fee-juice.ts:39), [fee-juice.ts:46](packages/bridge-core/src/fee-juice.ts:46)) → the generic substring matches and `getCurrentMinFees()` is returned ([fee-juice.ts:50](packages/bridge-core/src/fee-juice.ts:50)).
7. **Expected vs actual:** Expected: a block/state/endpoint “not found” error propagates and aborts fee construction. Actual: the wallet silently commits a potentially lower current-fee cap, allowing the subsequently proven transaction to be rejected as base fees rise.
8. **Recommended fix:** Prefer a structured JSON-RPC method-not-found code such as `-32601`. If only text is available, match an anchored, method-specific message naming `getPredictedMinFees`, rather than generic phrases such as `not found` or `not supported`.
9. **Instances:** [fee-juice.ts:50](packages/bridge-core/src/fee-juice.ts:50).

## Non-findings considered

- ExecutionMutex counters do not drift on ordinary rejection or abort paths: increments occur after capacity checks, and aborted waiters chain their idempotent release to the prior baton.
- The 35-minute live-proving reap can mark an unusually slow operation failed, but this threshold and the 40-minute behavior are explicitly characterized as intentional.
- `executeSendTransaction` and popup transfers bypass the execution mutex, but the zero-slot behavior is explicitly pinned and documented as intentional.
- Active, parked, post-settle, and double estimate cancellation paths correctly abort or evict once; unknown-token cancellation is deliberately a silent no-op.
- A cancel overtaking estimate admission was considered, but the normal popup path sends both requests over an ordered Port and profile lookup is serialized; no moderate-confidence ordinary-use interleaving was established.
- Gas-balance profile switching is fenced by `evictAll()`, including prevention of stale in-flight write-back.
- Estimate-reuse caches bind profile, endpoint, pending transactions, fee basis, and—in the operation cache—exact chain and FPC identity.
- `coerceAmount` accepts unsafe integer-valued JavaScript numbers, but the rounding has already occurred before this function receives the runtime number; no distinct in-function wrong-result counter-example was established.