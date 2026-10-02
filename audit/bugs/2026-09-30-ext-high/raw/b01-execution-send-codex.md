# b01-execution-send — codex

Scope read: Focused source and test excerpts from:

- `CLAUDE.md`, `ARCHITECTURE.md`, `implementations-plan/lessons.md`; supplied repo maps, quality leads, both prior bug reports, and the August 24 adjudication.
- `apps/extension/src/wallet/services/execution/{README.md,service.ts,execution-coordinator.ts,dapp-send-executor.ts,transfer-executor.ts,execution-lane.ts,operation-estimate-reuse.ts,transfer-estimate-reuse.ts,estimate-reuse-shared.ts,operation-fingerprint.ts,rpc-cancel.ts,mark-failed-unless-cancelled.ts}`.
- `apps/extension/src/wallet/services/execution/fee/{fee-strategy.ts,fee-juice-strategy.ts,fee-juice-with-claim-strategy.ts,embedded-strategy.ts,fpc-strategy.ts}`.
- `apps/extension/src/wallet/services/fpc/{service.ts,spec.ts,handlers/private-fpc-handler.ts,handlers/default-sponsored-fpc-handler.ts}`.
- `apps/extension/src/wallet/services/transaction/{service.ts,spec.ts,client.ts,receipt-status.ts}`, `task/{service.ts,wrapped-task.ts}`, and `operation-journal/{service.ts,reaper.ts,gc.ts,send-check.ts}`.
- Relevant execution and transaction tests, including `execution-coordinator.test.ts`, `dapp-send-executor.test.ts`, `operation-estimate-reuse.test.ts`, `service.characterization.test.ts`, `transaction/service.test.ts`, and `transaction/service.dropped.test.ts`.
- Handoff excerpts from `dapp-interaction/service.ts`, `packages/wallet-bridge/src/dispatcher.ts`, `packages/aztec-runtime/src/fee-juice.ts`, `packages/wallet-core/src/storage/entity_storage.ts`, `EditFpcPopup.vue`, and the FPC settings page.
- Installed Aztec SDK send/wait contracts, `BaseWallet.sendTx`, extension-provider dispatch, and node receipt declarations.

Source inspection only; no tests run and no files written.

## b01-execution-send-X-1: [Major] dApp sends return before the requested confirmation

**Title:** dApp sends ignore confirmation-wait options.

**Severity:** Major.

**Repro confidence:** High.

**Type:** Wrong result.

**Counter-example:** A dApp calls `sendTx` with `wait: undefined`, or `{ waitForStatus: CHECKPOINTED }`. The node accepts the transaction into its mempool; the immediate receipt is `PENDING`. Nulo resolves the send with that pending receipt.

**Violated invariant:** The installed SDK contract says omitted `wait` waits with defaults, and an options object requests a confirmation wait: `apps/extension/node_modules/@aztec/aztec.js/src/contract/interaction_options.ts:125`. `wait_opts.ts:13` specifies the requested minimum inclusion status.

**Failing path:** `packages/wallet-bridge/src/dispatcher.ts:1133` dispatches the send → `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:723` proves/submits → `:754` distinguishes only `NO_WAIT` → `:757` reads one receipt and returns it. The default-entrypoint path repeats this at `:935` and `:938`. No receipt-wait loop follows in the dispatcher or SDK provider.

**Expected vs actual behavior:** Expected: wait for the requested inclusion status, honoring timeout and revert options. Actual: return the first receipt, potentially pending, dropped during propagation, or below the requested status. Dependent dApp actions can consequently run before confirmation.

**Recommended fix:** Use the upstream `waitForTx` helper from `@aztec/aztec.js/node` for both waiting branches, passing the supplied options; retain immediate return for `NO_WAIT`.

**Instances:** `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:754`, `:757`, `:935`, `:938`.

## b01-execution-send-X-2: [Major] Profile switching after broadcast skips transaction recording

**Title:** Cleared progress tasks turn successful broadcasts into failures.

**Severity:** Major.

**Repro confidence:** High.

**Type:** Bad error path; secondary: race.

**Counter-example:** Profile A is active and a send has reached `await node.sendTx(tx)`. While the node response is delayed, the user switches to profile B in another wallet window. `TaskService` clears A’s tasks. The node then resolves successfully. `task.complete()` throws `Invalid task id`; the catch’s `task.fail()` throws again.

**Violated invariant:** An issued broadcast remains recordable after its authorizing session ends. This is explicitly asserted by `apps/extension/src/wallet/services/execution/execution-coordinator.test.ts:332`. The sibling `TransactionService.waitForTx` already treats vanished tasks as disposable bookkeeping.

**Failing path:** `apps/extension/src/wallet/services/task/service.ts:241` clears tasks during the awaited send → `execution/execution-coordinator.ts:303` completes the missing task → `task/service.ts:180` throws → `execution-coordinator.ts:309` throws while failing that same task → `proveAndSend` never reaches transaction recording at `:355`.

**Expected vs actual behavior:** Expected: persist the successful broadcast and finish the journal despite the discarded progress UI. Actual: the send rejects, its transaction row is missing, and the journal is failed by the caller. `SendCheck` can later annotate the journal as sent, but does not recreate the transaction record.

**Recommended fix:** Make settlement of removed tasks non-throwing, following `waitForTx`’s existing approach. Apply this to outer send-task settlements too, so progress bookkeeping cannot replace the broadcast outcome.

**Instances:** Primary failure: `apps/extension/src/wallet/services/execution/execution-coordinator.ts:303`, `:309`. Same unsafe post-send settlement: `execution/transfer-executor.ts:216`, `:225`; `execution/service.ts:702` and its failure settlement through `execution/rpc-cancel.ts:81`. Registry invalidation: `task/service.ts:241`.

## b01-execution-send-X-3: [Major] Address edits overwrite concurrent FPC changes

**Title:** FPC address updates commit a stale row after validation.

**Severity:** Major.

**Repro confidence:** High.

**Type:** Lost update; secondary: race.

**Counter-example:** A custom sponsored FPC has `{id: F, name: "Old", address: A}`. Window 1 starts changing its address to valid sponsor B and waits for PXE validation. Window 2 renames F to `"New"` and receives success. Window 1 resumes and writes `{...existing, address: B}`, restoring `"Old"`. Alternatively, window 2 deletes F; window 1 recreates the deleted row.

**Violated invariant:** Serialized mutations must operate on the current row. The sibling `updateFpc` and `deleteFpc` read and validate the row inside the lock; `updateFpcAddress` does not.

**Failing path:** `apps/extension/src/popup/components/popups/EditFpcPopup.vue:118` → `apps/extension/src/wallet/services/fpc/service.ts:330` snapshots the row → `:350` awaits validation while a rename (`:319`) or deletion (`:394`) commits → `:375` acquires the lock → `:376` merges from the old snapshot → `:377` upserts it.

**Expected vs actual behavior:** Expected: preserve a concurrent rename, or reject an update whose row was deleted. Actual: silently undo the rename or resurrect the deleted FPC.

**Recommended fix:** Re-read and validate ownership/existence inside the final lock. Merge the address into that fresh row, rejecting if the identity relevant to validation changed.

**Instances:** `apps/extension/src/wallet/services/fpc/service.ts:330`, `:375`, `:376`, `:377`. Both counter-examples share this single stale-write site.

## b01-execution-send-X-4: [Minor] Failed receipt persistence permanently suppresses retries

**Title:** Receipt polling mutates its comparison state before persistence succeeds.

**Severity:** Minor.

**Repro confidence:** High.

**Type:** State invariant violation; secondary: bad error path.

**Counter-example:** Transaction H remains dropped after the 60-second grace and three consecutive dropped observations. On the first accepted dropped result, `txs.set` rejects because of a temporary storage failure. Storage subsequently recovers, and the node continues reporting `DROPPED`.

**Violated invariant:** The pending/watch maps must reflect committed transaction status. The canonical-membership contract is documented at `apps/extension/src/wallet/services/transaction/service.ts:488`.

**Failing path:** `runWorker` at `transaction/service.ts:375` calls `updateTx` → `:479` mutates the object already stored in `pending` to `Dropped` → persistence at `:486` rejects before map cleanup → subsequent polls return early at `:463` because the receipt matches the mutated object.

**Expected vs actual behavior:** Expected: retry the failed write, persist `Dropped`, and move H to the slow resurrection watch. Actual: durable storage still says `Pending`, H remains in the fast pending queue, no update event fires, and confirmation waits time out. Recovery requires a different receipt status or worker restart.

**Recommended fix:** Construct a separate next-state object, persist it first, then update the in-memory maps and emit. Preserve the previous comparison state when persistence fails.

**Instances:** `apps/extension/src/wallet/services/transaction/service.ts:463`, `:478`, `:486`, `:495`, `:498`. One shared receipt-update implementation.

## b01-execution-send-X-5: [Minor] Transient fee validation aborts estimate-backed sends

**Title:** Operation estimate reuse throws instead of falling back to rebuilding.

**Severity:** Minor.

**Repro confidence:** High.

**Type:** Bad error path.

**Counter-example:** Confirm a standard `aztec_sendTx` with matching, unexpired estimate and preview IDs. All identity checks pass. The fee-prediction RPC throws `"block not found"` once; subsequent calls would succeed. `tryConsume` propagates the exception, so the approved send fails without attempting the fresh build.

**Violated invariant:** `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:117` states that failed validation consumes the entry and the caller rebuilds, except for the explicit foreign-profile rejection. The transfer cache handles fee-read errors as misses at `transfer-estimate-reuse.ts:208`.

**Failing path:** `dapp-send-executor.ts:718` → `resolveStandardBuild` at `:794` → `operation-estimate-reuse.ts:129` consumes the entry → uncaught fee fetch at `:161` rejects → the rebuild at `dapp-send-executor.ts:833` is bypassed → `runInSlot` fails the journal at `:267`.

**Expected vs actual behavior:** Expected: discard the unverifiable estimate and attempt a fresh build with fresh fee validation. Actual: abort the send and require another user attempt.

**Recommended fix:** Catch fee-validation errors locally and return a cache miss, matching `TransferEstimateReuse`. Preserve the explicit session/profile rejection and the fresh builder’s fee-validation requirements.

**Instances:** `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:161`; propagation site `execution/dapp-send-executor.ts:794`.

## Leads adjudicated

- **q01-wallet-execution-claude:** Confirmed → **b01-execution-send-X-5**. The current failing fee-fetch line is `operation-estimate-reuse.ts:161`.
- **q13-cross-primitives-claude, `TxConfirmationTimeoutError` portion:** Rejected as a correctness finding. No production consumer discriminates on this class; `waitForTx` is internal, and loss of its prototype has no demonstrated incorrect behavior. The account-error portion belongs outside this cluster.

## Routed to security

None identified with a complete certificate in this review.

## Non-findings considered

- Popup transfers taking no execution slot are explicitly intentional in `execution/README.md`; not reported.
- Prior **B-02** is fixed: `executeSendTransaction` now uses `runInSlot`.
- Prior **B-03** is fixed: the boot reaper excludes records created during the current worker lifetime.
- Prior **N-07** is addressed by queued-wait heartbeats; the reaper also uses conditional transitions.
- Prior **N-16** is fixed: `waitForTx` now has a deadline and tolerates cleared progress tasks.
- Failing interrupted operations on worker restart is intentional; submitting hashes survive failure for receipt checking.
- Journal GC retaining failed/cancelled records is intentional.
- PrivateFPC’s two-pass estimation and FPC-specific custom-limit handling are explicitly documented behavior.
- The `TxConfirmationTimeoutError` transport lead has no concrete failing consumer, as adjudicated above.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

- **b01-execution-send-C-1 — Agree, high confidence.** Preview expiry returns `missing`, which rejects rediscovered witnesses at `apps/extension/src/wallet/services/execution/preview-snapshots.ts:52` and `:74`; confirmation ignores estimation progress at `apps/extension/src/popup/windows/execute/index.vue:689`. The rejection correctly protects authorization; the lifecycle mismatch is the bug. Retain the baseline through queued execution too: merely extending its TTL to the popup timeout does not cover waiting for an execution slot.
- **b01-execution-send-C-2 — Agree on the bug; disagree with the preferred fix.** Both branches return one immediate receipt. `TransactionService.waitForTx` only waits for removal from `pending` (`apps/extension/src/wallet/services/transaction/service.ts:259`), including removal for dropped transactions, and does not enforce requested confirmation status or revert handling. Use upstream `waitForTx` with the caller’s options. Major, high confidence.
- **b01-execution-send-C-3 — Partially agree: severity is understated.** The post-broadcast variant deserves **Major**: missing-task completion at `apps/extension/src/wallet/services/execution/execution-coordinator.ts:303` prevents transaction recording at `:355`, despite successful broadcast. A short triggering window does not reduce the consequence to an error-message defect. High confidence.
- **b01-execution-send-C-4 — Agree, high confidence for the fee-fetch counter-example.** The uncaught prediction call at `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:161` prevents fallback. Avoid extending the certificate to every `getNetwork`/`getNode` rejection without a separate recoverable counter-example.

**2. Rejected leads I consider real**

- **FPC concurrent edits:** Claude’s “unrealistic” rejection conflicts with the explicitly scoped two-window scenario. Address validation awaits PXE after snapshotting at `apps/extension/src/wallet/services/fpc/service.ts:330`; the stale upsert at `:377` overwrites a completed rename or resurrects a row deleted at `:394`. This is **X-3**, high confidence.
- **q13 timeout-error identity:** Agree with rejection; no production class-discriminating consumer establishes incorrect behavior.

**3. What Claude missed that I found**

- **b01-execution-send-X-3:** The FPC stale-write finding remains valid, including the stronger deletion/resurrection counter-example above.
- **b01-execution-send-X-4:** A rejected dropped-status persistence write leaves the pending-map object already mutated (`apps/extension/src/wallet/services/transaction/service.ts:479`, `:486`). Subsequent unchanged dropped receipts hit the equality return at `:463`, so recovered storage is never retried, history remains pending, and confirmation waits time out. Minor, high confidence.
- **X-1, X-2 and X-5** overlap Claude’s **C-2, C-3 and C-4**, respectively.

**4. What both missed**

No additional independent finding established in this light pass.