# Consolidated findings — `/harden bugs` (high), extension, 2026-09-30

Base: `dev` @ `910a4def`. Inputs: 14 raw cluster reports (b01–b07 × Claude + Codex, each with a cross-rebuttal), `raw/leads-from-quality-run.md`. The quality run's `consolidated.md` did not exist when this was written, so its "Incidental bugs" section is not included. Priors checked for recurrence: `2026-08-16-extension-mid` (B-ids), `2026-08-22-production-ready` (N-ids) + `adjudication-2026-08-24.md`.

Method: findings were deduplicated by root cause, failing invariant and boundary. Every disputed severity or reality claim was re-opened in source by the coordinator (preview TTL / confirm gating, dApp send wait, `profileTx` options, task-registry clear semantics, `ridesCodeChannel`, outbox drain, export slice order, `getNodeStatus`, seeder marker read, `ConfigStore.set`, approval-window close path, LogsViewer fetch). Severity is anchored to realistic likelihood, following the owner's "realistic scenarios only" rule.

## Summary

| ID | Title | Severity | Confidence | Found by | Effort |
|---|---|---|---|---|---|
| B-01 | dApp `sendTx` ignores its wait options and returns one immediate (PENDING/DROPPED) receipt | Major | high | both | M |
| B-02 | The 120 s preview snapshot is shorter than the approval's life, so authwit-bearing dApp sends hard-fail at Confirm | Major | high | claude (codex confirmed) | S |
| B-03 | `profileTx` omits `senderForTags`, so profiling any private-log-emitting tx throws | Major | high | codex (claude confirmed) | S |
| B-04 | A lock or profile switch during the balance-outbox drain deletes the sole refresh marker, leaving the balance stale | Major | moderate | codex (claude confirmed) | S |
| B-05 | Full-backup export is not bound to one profile, so activating another profile mid-export yields a checksum-valid mixed backup | Major | high (mechanism) / low (likelihood) | codex (claude reversed its non-finding) — cross-model severity disagreement | S |
| B-06 | A cleared task registry (profile switch) makes `WrappedTask` throw `Invalid task id`, which replaces the send's real outcome | Minor | high | both — cross-model severity disagreement | S |
| B-07 | Closing an approval window before its `beforeunload` hook is installed reaches the dApp as an unclassified failure instead of 4001 | Minor | high | both | S |
| B-08 | `OperationEstimateReuse.tryConsume` lets a transient fee-read error abort the send instead of falling back to a rebuild | Minor | high | both | S |
| B-09 | `getNodeStatus` lacks the local-kind carve-out, so an edited Local Network endpoint reads `InvalidChain` and is left out of backups | Minor | high | both — cross-model severity disagreement | S |
| B-10 | Queued incoming-trust prompts open on the lock screen and are drained with no decision applied | Minor | high | both | S |
| B-11 | A lock during popup boot turns a lock-induced bootstrap rejection into "startup failed" and hides the unlock form | Minor | high | codex (claude confirmed) — cross-model severity disagreement | S |
| B-12 | Account writers outside the deletion fence and row lock: `importAccount` after a profile purge, and `patchAccountField` after a chain purge | Minor | high | both — cross-model severity disagreement (patch variant) | S |
| B-13 | A late recovery-phrase export response starts countdown timers after unmount and redirects the user 5 min later | Minor | high | codex (claude confirmed) | S |
| B-14 | Config writes mutate memory before persisting; a failed write makes the same-value retry report success, and the Developer Mode cascade can persist a hidden Debug Mode | Minor | high (mechanism) / low (likelihood) | codex (claude confirmed) | S |
| B-15 | `updateFpcAddress` commits a pre-validation snapshot, undoing a concurrent rename or resurrecting a deleted FPC | Minor | high | codex (claude conceded) | S |
| B-16 | Capability approval commits and reports success after the session has expired | Minor | high | codex (claude confirmed) | S |
| B-17 | Popup account/profile commits run captured callbacks after awaits without a scope fence | Minor | moderate | codex (claude partial) — cross-model severity disagreement | S |
| B-18 | Receipt polling mutates the pending object before `txs.set`, so a failed write permanently suppresses the retry | Minor | high | codex (claude confirmed) | S |
| B-19 | Backup file-picker completions have no selection-generation fence | Minor | high (mechanism) / low (likelihood) | codex (claude partial) — cross-model severity disagreement | S |
| B-20 | A failed seed-marker read is turned into `{}` and written back, erasing other tokens' deletion tombstones | Minor | low | codex — cross-model disagreement (claude: defensible trade-off) | S |

**Count:** 0 Blocker · 0 Critical · 5 Major · 15 Minor. Dropped: 23 (see below; D-24 is a merge note, not a drop). Routed to security: 7.

---

## Findings

### B-01: [Major] dApp `sendTx` ignores its wait options and returns one immediate (PENDING/DROPPED) receipt

- **Type:** wrong result
- **Confidence:** high
- **Found by:** both (b01 C-2, X-1)
- **RECURRING?** Not in prior bug audits. Already known in `implementations-plan/any-erc20-bridge/lessons/phase-10.md` ("the extension's dApp executor honours only `NO_WAIT` and reads the receipt ONCE"), where one consumer works around it. It was never filed or pinned as intended: the test pins the call count with no `(BUG PIN)`.
- **Counter-example:** A dApp calls `wallet.sendTx(payload, {from})` with `wait` omitted (aztec.js's default) or with `{waitForStatus: CHECKPOINTED}`. After `proveAndSend` broadcasts, the executor calls `node.getTxReceipt(txHash)` once and returns `{receipt}`. That receipt is PENDING, or DROPPED on a load-balanced replica that has not yet seen the hash. The dApp's `await` resolves "successfully" with no block. A later revert or drop never reaches the dApp.
- **Violated invariant:** The upstream contract (`@aztec/aztec.js` `interaction_options.ts:125`, `wallet-sdk` `BaseWallet.sendTx` → `waitForTx`): `wait: undefined` waits for the receipt with defaults, a `WaitOpts` object waits with those options, and only `NO_WAIT` returns immediately. A revert throws unless `dontThrowOnRevert` is set.
- **Failing path:** `packages/wallet-bridge/src/dispatcher.ts:1133` → `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:754` (branches only on `NO_WAIT`) → `:757` single `getTxReceipt`; the NO_FROM path does the same at `:935`/`:938`.
- **Expected vs actual:** Expected: resolve once the requested status is reached, and throw on revert or timeout. Actual: returns the first receipt, often PENDING, so dependent dApp steps run before inclusion.
- **Recommended fix:** For non-`NO_WAIT`, await inclusion with upstream `waitForTx(node, txHash, opts)` (it honours `waitForStatus`, `timeout` and `dontThrowOnRevert`). Pass a timeout that fits inside the SDK's 300 s call ceiling (`ARCHITECTURE.md` §dApp liveness), or the dApp times out first. Consider reusing `TransactionService`'s DROPPED debounce for the replica-lag case.
- **Effort:** M (bounded wait + tests on both paths).
- **Instances:** `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:754,757,935,938`; pinned by `dapp-send-executor.test.ts` ("NO_WAIT returns txHash; wait returns receipt").
- **Source raw ids:** b01-execution-send-C-2, b01-execution-send-X-1.

### B-02: [Major] The 120 s preview snapshot is shorter than the approval's life, so authwit-bearing dApp sends hard-fail at Confirm

- **Type:** bad error path / timeout mismatch
- **Confidence:** high (coordinator re-read `preview-snapshots.ts:52-74`, `estimate-reuse-shared.ts:29`, `execute/index.vue:689-696`)
- **Found by:** claude (codex agreed in rebuttal)
- **RECURRING?** No.
- **Counter-example:**
  1. A dApp `aztec_sendTx` needs a private authwit from the user (e.g. `transfer_in_private` called by a DEX), fee kind `fj` or `fpc`.
  2. The estimate discovers authwit `h` and stashes `{discoveredHashes:[h]}` with the 120 s `ESTIMATE_REUSE_TTL_MS`.
  3. The user reads the card for more than 2 min. The SDK allows 300 s and the interaction 10 min.
  4. The user clicks Confirm. `take` returns `missing`, the rebuild rediscovers `h`, and `assertWithinPreview` throws "Fee estimate did not complete — retry the estimate".
  5. The popup has already closed, so the dApp request is dead.

  A second trigger needs no wait: Confirm is not disabled while `estimatingOps[i]` is true. Clicking right after a priority change, inside the 500 ms debounce, sends `previewId: undefined`, which gives the same `missing` failure.
- **Violated invariant:** The preview baseline ("never sign a witness the card did not show") treats `missing` as reachable only after a *failed* estimate (`preview-snapshots.ts` doc on `assertWithinPreview`). A completed estimate must not degrade into that branch while the approval is still live.
- **Failing path:** `apps/extension/src/wallet/services/execution/preview-snapshots.ts:30,52` (TTL shared with the reuse cache) → `dapp-send-executor.ts:704-705` (`missing` → no `reuseId`) → `:719` `assertWithinPreview` throws; NO_FROM `dapp-send-executor.ts:1031`; `apps/extension/src/popup/windows/execute/index.vue:689-696` (`confirm-disabled` ignores `estimatingOps`).
- **Expected vs actual:** Expected: Confirm signs exactly what the card listed, or waits for the in-flight estimate. Actual: terminal failure with a "retry the estimate" message and no window left to retry in. Ops with no discovered witness pass, so only authwit-bearing dApps are hit.
- **Recommended fix:**
  1. Give `PreviewSnapshots` its own TTL of at least `INTERACTION_TIMEOUT_MS`, or evict on interaction settle. It holds hashes only, so the 120 s bound on retained signed requests stays on the reuse cache. Codex notes the snapshot must also survive queued waiting for an execution slot, so evict-on-settle beats a longer fixed TTL.
  2. Disable Confirm while `estimatingOps[i] || previewingOps[i]` for `aztec_sendTx`.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/execution/preview-snapshots.ts:30,52,74`; `apps/extension/src/wallet/services/execution/estimate-reuse-shared.ts:29`; `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:413-421,704-719,1031`; `apps/extension/src/popup/windows/execute/index.vue:689-696` (and the `approve` delta construction).
- **Source raw ids:** b01-execution-send-C-1.

### B-03: [Major] `profileTx` omits `senderForTags`, so profiling any private-log-emitting tx throws

- **Type:** bad error path (feature broken)
- **Confidence:** high. The coordinator confirmed that `packages/aztec-runtime/src/pxe/service.ts:621-623` passes only `{profileMode, skipProofGeneration, scopes}`. The repo's own `proveTx` comment at `:481-484` states that PXE throws "Sender for tags is not set" when this field is absent, and upstream `pxe.ts:1107,1138` forwards the undefined value.
- **Found by:** codex (claude confirmed in rebuttal)
- **RECURRING?** No. It is the same omission the 5.0 bump fixed in `proveTx`/`simulateTx`, missed on the third sibling.
- **Counter-example:** A connected dApp calls `profileTx` for Token `transfer_to_private(recipient, 1n)` from account A (with balance, `profileMode: "gates"`). `executeAztecProfileTx` builds scopes `[A, ...]`, but `PxeService.profileTx` forwards no `senderForTags`. Private execution hits the sender lookup (`Option.none()`) and the call rejects.
- **Violated invariant:** `scopes[0]` is the tx sender and must be passed as `senderForTags` for any private-log-emitting execution (`service.ts:481-490`, `:582`).
- **Failing path:** `apps/extension/src/wallet/services/execution/view-executor.ts:403-407` → `packages/aztec-runtime/src/pxe/client.ts:300` → `packages/aztec-runtime/src/pxe/service.ts:621-623` → upstream `@aztec/pxe/src/pxe.ts:1138` → `private_execution_oracle.ts:195` → throw.
- **Expected vs actual:** Expected: a `TxProfileResult`. Actual: a rejection for most real private calls, since note-emitting calls need tags. Send and simulate are unaffected.
- **Recommended fix:** Add `senderForTags: scopes[0]` to the upstream `profileTx` options, and pin it with a test alongside the proveTx/simulateTx siblings.
- **Effort:** S
- **Instances:** `packages/aztec-runtime/src/pxe/service.ts:621-623`; entry `apps/extension/src/wallet/services/execution/view-executor.ts:403-407`.
- **Source raw ids:** b06-network-pxe-transport-X-2.

### B-04: [Major] A lock or profile switch during the balance-outbox drain deletes the sole refresh marker, leaving the balance stale

- **Type:** lost update / race
- **Confidence:** moderate. The mechanism was confirmed by the coordinator at `incoming-transfer/service.ts:2229-2296` and `token-balance/service.ts:238-247,455-461`. The trigger is timing-dependent.
- **Found by:** codex (claude confirmed; rated it Minor-to-Major)
- **RECURRING?** Yes, as a family: N-10 and B-04 are profile-context fences on balance projection. The file's own comments already call losing this marker "permanent until an unrelated refresh" (codex R1 High #4), but that fence only covers the transient-throw path.
- **Counter-example:**
  1. An incoming receipt raises profile A's balance from 1 to 2 tokens, and discovery writes an unanchored outbox row.
  2. `drainBalanceOutbox` captures profile A once (`:2230`) and then awaits `listOutbox`.
  3. The wallet locks (auto-lock or manual). `TokenBalanceService.onActiveProfileChanged(undefined)` synchronously clears `this.tokens` (`:455`).
  4. The drain resumes. The captured profile still matches the row key, so `requestBalanceRefresh` finds no token in the empty map and returns `{missing:true}`.
  5. The drain deletes the row (`:2274`). `isCurrent()` checks lock ownership, not the profile epoch.
  6. After unlock, `reconcile-pairs.ts:145` requeues only never-projected rows, and a rediscovered receipt does not recreate the marker. The balance stays at 1.

  The drain runs after every public poll (`:1065`), after tx handling (`:1307`) and at init (`:357`), so the window recurs for as long as the wallet is unlocked.
- **Violated invariant:** `requestBalanceRefresh` returns `{missing:true}` only on verified absence (its own doc), and outbox processing is active-profile-scoped (`incoming-transfer/service.ts:2215`). A cleared or rebuilding token map is not absence.
- **Failing path:** `apps/extension/src/wallet/services/incoming-transfer/service.ts:2230` (capture) → `:2243` (stale compare) → `:2259` `drainOutboxRow` → `:2296` `requestRefreshOrKeep` → `apps/extension/src/wallet/services/token-balance/service.ts:238-247` (`missing`) → `incoming-transfer/service.ts:2274` delete.
- **Expected vs actual:** Expected: the marker survives and is re-requested under the next active session. Actual: the marker is deleted, and a received amount is missing from the displayed balance until some unrelated refresh.
- **Recommended fix:** Return a retryable result (not `missing`) from `requestBalanceRefresh` when `this.profile` is unset or the map is mid-rebuild, and record `profileGeneration`. Re-check the active profile or `serviceEpoch` inside `drainOutboxRow` before the delete. One guard there covers all three call sites.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/incoming-transfer/service.ts:357,1065,1307,2230,2243,2269,2274,2296`; `apps/extension/src/wallet/services/token-balance/service.ts:238,244,455-461`; `apps/extension/src/wallet/services/token-balance/reconcile-pairs.ts:145` (no repair).
- **Source raw ids:** b04-incoming-balances-activity-X-1.

### B-05: [Major] Full-backup export is not bound to one profile, so activating another profile mid-export yields a checksum-valid mixed backup

- **Type:** silent corruption (latent) / race
- **Confidence:** high on mechanism, low on likelihood. Codex rated it Critical and Claude Major/low; the coordinator rates it **Major**, for the reasons below.
- **Found by:** codex (claude reversed its own non-finding in rebuttal)
- **RECURRING?** Yes, as a family: N-01 (export-side discipline) and the 08-22 "authority outlives its context" family. The unmount-generation fence added for N-01 does not cover profile activation.
- **Counter-example:**
  1. Window 1 exports profile A. Key material is fetched for an explicit id; the slices then run in sequence (`full-backup-helpers.ts:137-142`), each through `client.backup()` with no profile argument.
  2. Window 2 unlocks, creates or restores profile B mid-assembly. `app.vue:198-208` bootstraps B without unmounting the export page, so `gen === generation` stays true.
  3. The rest of the slices resolve the *active* profile (e.g. `account/service.ts:748-750`) and return B's rows. The checksum is valid, and the filename (`full.vue:375`) reads B's name.
  4. Worst variant: B activates between the account slice and the imported-keys slice. The backup then carries A's imported account with no signing key, and restore's reconcile deletes that keyless row (`account/service.ts:842,852`).
- **Likelihood analysis (why not Critical):** The export order is profile → account → imported-keys (fast storage reads, `full.vue:95-113`), so the key-loss variant needs the switch inside a millisecond gap. The broader mixed-slice variant spans the seconds of the later slices (e.g. account-state PXE reads), but still needs one person to finish a password or passkey unlock in a second window during that span. Nothing is lost from the live wallet. The damage is latent: it appears only if the user later depends on this backup. That is why it stays Major and not Potential Critical.
- **Violated invariant:** A full backup represents exactly one profile (`full-backup-helpers.ts:381` `normalizeAllIds` relies on this), and imported-account rows travel with their keys.
- **Failing path:** `apps/extension/src/popup/pages/settings/security/export/full.vue:193` (material for A) → `:295` (parameterless slice calls) → `apps/extension/src/utils/full-backup-helpers.ts:137` → `apps/extension/src/wallet/services/account/service.ts:750` (active-profile resolution) → `full.vue:296` (generation-only probe) → `apps/extension/src/popup/app.vue:198` (no unmount).
- **Expected vs actual:** Expected: the export completes for A or aborts. Actual: it reports success for a mixed-profile artifact.
- **Recommended fix:** Capture `appStore.profile.id` at start and make the `onSlice` probe `gen === generation && appStore.profile.id === startId`; capture the filename at start too. A stronger fix passes the captured id to each `backup()` and has the services reject a mismatch.
- **Effort:** S (probe), M (service-side id).
- **Instances:** `apps/extension/src/popup/pages/settings/security/export/full.vue:193,242,295,296,375`; `apps/extension/src/utils/full-backup-helpers.ts:137`. The slices that resolve the active profile: `apps/extension/src/wallet/services/profile/service.ts:2249`, `account/service.ts:663,748`, `token/service.ts:847`, `token-balance/service.ts:663`, `transaction/service.ts:508`, `auth-registry/service.ts:487`, `contact/service.ts:68,276`, `account-state/service.ts:206`.
- **Source raw ids:** b03-backup-restore-migration-X-1 (plus the claude rebuttal's filename addition).

### B-06: [Minor] A cleared task registry (profile switch) makes `WrappedTask` throw `Invalid task id`, which replaces the send's real outcome

- **Type:** bad error path (secondary: lost update)
- **Confidence:** high
- **Found by:** both (b01 C-3, X-2). Cross-model severity disagreement: codex Major (post-broadcast variant), claude Minor. The coordinator rates it **Minor**.
- **RECURRING?** Yes, as a pattern. N-16's fix taught `waitForTx` to tolerate a cleared registry via `task.exists`, but the execution pipeline's settlements were not given the same tolerance.
- **Counter-example:**
  - **Realistic variant:** a dApp send is proving (minutes). The user locks, then unlocks profile B on the lock screen. `TaskService.onActiveProfileChanged` clears the registry (`task/service.ts:237-241`; it clears only on a switch to a *different* profile, never on lock alone). The journal row was already `cancelled` by `abandonDeadSessions`. When proving returns, `task.complete()`/`task.fail()` throw `Invalid task id`, `classifyOperationCatch` throws again from `task.cancel()`/`task.fail()`, and the dApp gets "Invalid task id: …" instead of the documented cancellation.
  - **Rare variant (codex):** the switch lands during the `node.sendTx` RPC itself. The tx broadcasts, `task.complete()` throws, and `recordTransaction` never runs, so the tx has no activity row (`SendCheck` later marks the journal "sent"). This needs a lock plus an unlock of another profile inside one RPC, because `assertLive()` before the send refuses a locked session. That is not realistic, and it is why the finding is not Major.
- **Violated invariant:** Task bookkeeping must never replace an operation's outcome (`waitForTx` and `balance-job-queue` guard with `task.exists`/`hasTask`); the execution README promises "a swept send ends `cancelled` (the dApp gets the cancellation error)".
- **Failing path:** `apps/extension/src/wallet/services/task/service.ts:241` → `apps/extension/src/wallet/services/task/wrapped-task.ts:25-35` → `apps/extension/src/wallet/services/execution/execution-coordinator.ts:271,303,309` → `apps/extension/src/wallet/services/execution/rpc-cancel.ts:78-81`.
- **Expected vs actual:** Expected: the structured cancelled or failed result, with best-effort task updates. Actual: a raw internal error, and in the rare case an unrecorded broadcast.
- **Recommended fix:** Make `WrappedTask.complete/fail/cancel` no-ops when `!this.exists`, following the `waitForTx` idiom. That one guard covers every call site.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/task/wrapped-task.ts:25-35`; `apps/extension/src/wallet/services/execution/execution-coordinator.ts:271,303,309,355`; `apps/extension/src/wallet/services/execution/rpc-cancel.ts:78,81`; `apps/extension/src/wallet/services/execution/transfer-executor.ts:216,225`; `apps/extension/src/wallet/services/execution/service.ts:702`.
- **Source raw ids:** b01-execution-send-C-3, b01-execution-send-X-2.

### B-07: [Minor] Closing an approval window before its `beforeunload` hook is installed reaches the dApp as an unclassified failure instead of 4001

- **Type:** wrong result (error classification)
- **Confidence:** high (the coordinator confirmed `useDappApprovalWindow.ts:123-124` installs `beforeunload` only after `init()`, and that `window-manager.ts:259` rejects with a bare string)
- **Found by:** both (b05 C-1, X-2)
- **RECURRING?** No.
- **Counter-example:** A dApp `sendTx` or `requestCapabilities` opens the approval window. The user closes it with the OS close button while `init()` is still loading account or network data. No `rejectInteraction` RPC fires. `windows.onRemoved` → `_settleUserClose` → `handle.reject("Window closed by user.")` → `toWalletResponseError` falls through to the generic "could not process the request" error, with no 4001 and no `walletErrorCode`. The same happens after init whenever the page's unload RPC loses to `onRemoved` (a crash, or a browser quit).
- **Violated invariant:** A user refusal is `UserRejectedError` (4001), as the Reject button already produces. `error-envelope.ts` requires dApp-actionable errors to be classified.
- **Failing path:** `apps/extension/src/composables/useDappApprovalWindow.ts:123-124` → `apps/extension/src/wallet/services/window-manager/window-manager.ts:156,259` → `apps/extension/src/wallet/services/dapp-interaction/service.ts:488-493` → `apps/extension/src/wallet/services/wallet-sdk/background.ts:1211-1216` → `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:197`.
- **Expected vs actual:** Expected: 4001 USER_REJECTED. Actual: a generic wallet failure, so dApps show error UI or retry.
- **Recommended fix:** Reject user closes with `new UserRejectedError("Window closed by user.")`, or with a caller-supplied close error for dApp windows. Keep open failures generic, and update the `.rejects.toMatch` tests to check `.message`.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/window-manager/window-manager.ts:259`; affected interactions at `apps/extension/src/wallet/services/dapp-interaction/service.ts:432,441`. The timeout half (`window-manager.ts:126`) is dropped; see Dropped D-02.
- **Source raw ids:** b05-dapp-ingress-approval-C-1, b05-dapp-ingress-approval-X-2.

### B-08: [Minor] `OperationEstimateReuse.tryConsume` lets a transient fee-read error abort the send instead of falling back to a rebuild

- **Type:** bad error path
- **Confidence:** high
- **Found by:** both (b01 C-4, X-5; confirms quality lead q01)
- **RECURRING?** No (sibling asymmetry: `TransferEstimateReuse` catches the same call).
- **Counter-example:** Confirm a popup `aztec_sendTx` holding a valid `estimateId`. `predictedWorstMinFees(node)` throws a transient "block not found" (which it deliberately rethrows). The entry has already been popped, and the error escapes `tryConsume` → `resolveStandardBuild` → `runInSlot`, so the journal fails. A rebuild a moment later would have succeeded.
- **Violated invariant:** "A failed validation consumes the entry and the caller rebuilds" (`operation-estimate-reuse.ts:117`); the transfer twin rejects softly (`transfer-estimate-reuse.ts:205-208`).
- **Failing path:** `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:718,794` → `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:129` (consume) → `:161` (uncaught) → rebuild at `dapp-send-executor.ts:833` bypassed.
- **Expected vs actual:** Expected: a miss, then a rebuild. Actual: terminal failure after the popup has closed.
- **Recommended fix:** Wrap `:159-166` in a try/catch that returns `this.reject(...)`, as the transfer cache does.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:141,159-166`. Same shape, lower likelihood: `apps/extension/src/wallet/services/execution/transfer-estimate-reuse.ts:182,196` (`getNetwork`/`getNode`).
- **Source raw ids:** b01-execution-send-C-4, b01-execution-send-X-5, q01.

### B-09: [Minor] `getNodeStatus` lacks the local-kind carve-out, so an edited Local Network endpoint reads `InvalidChain` and is left out of backups

- **Type:** wrong result (secondary: silent omission in export)
- **Confidence:** high (the coordinator confirmed `network/service.ts:734` against `:753`)
- **Found by:** both (b06 C-1, X-1). Cross-model severity disagreement: codex Major (backup omission), claude Minor. The coordinator rates it **Minor**: Local Network is seeded in production builds, but it is a developer surface (`localhost`), and the omission is warn-logged.
- **RECURRING?** No.
- **Counter-example:** Edit the seeded Local Network endpoint from `http://localhost:8080` to `http://localhost:18080`. `updateEndpoint` accepts it (it passes the `local` hint). `getNodeStatus` then calls `_getChainId(url)` with no hint, the seed-URL comparison fails, and the probe returns the XOR composite (e.g. `31337 ^ 1 = 31336`) ≠ stored `0`, giving `InvalidChain`.
- **Violated invariant:** A local network's wallet chain id is `0` whatever its URL (`_getChainId` doc; `probeNodeStatus` at `:753` mirrors that carve-out explicitly).
- **Failing path:** `apps/extension/src/wallet/services/network/service.ts:734` → `:996-1010` → `:735`. Consumers: `apps/extension/src/stores/app.store.ts:495-499` (status dot); `apps/extension/src/wallet/services/account-state/service.ts:221` (backup omits the chain's contracts and senders); `:101` (sender export skips it).
- **Expected vs actual:** Expected: `Active`. Actual: `InvalidChain`, with a thinner full backup.
- **Recommended fix:** Call `_getChainId(primary.rpcUrl, network.kind)`, or factor out the shared carve-out.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/network/service.ts:734`.
- **Source raw ids:** b06-network-pxe-transport-C-1, b06-network-pxe-transport-X-1.

### B-10: [Minor] Queued incoming-trust prompts open on the lock screen and are drained with no decision applied

- **Type:** state invariant violation (secondary: lost update)
- **Confidence:** high
- **Found by:** both (claude as a functional bug; codex routed the disclosure to security and accepted the functional half in rebuttal)
- **RECURRING?** Yes, as a family: B-26 and B-28 (trust-queue handling).
- **Counter-example:**
  1. Two contracts are pending trust. Prompt A is open and B is queued.
  2. Auto-lock fires. `lockedState.seal()` calls `closeAll()`, and the `isOpened("incoming_trust")` watcher calls `dequeueNextPendingTrust()`, which has no `isLogined` check. The triple still matches (lock does not clear it), so prompt B opens over the lock screen.
  3. Allow or Block calls `captureTrustFence`, which rejects while locked. `setTrust*` returns `false`, and `decide` closes silently, which dequeues the next prompt.
  4. After unlock, replay no-ops: the network flips during bootstrap (`useProfileBootstrap.ts:56,71`, codex correction), but `replayedForKey` survives (`PopupManager.vue:177-180`). The contracts stay `pending` until the popup reopens.
- **Violated invariant:** No prompt while locked (`lockedState.seal` closes all popups; `SelectTokenPopup` mounts only while logged in). A trust decision needs an open session.
- **Failing path:** `apps/extension/src/popup/locked-state.ts:19-27` → `apps/extension/src/popup/components/popups/PopupManager.vue:76-101,293-298` → `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:103-110` → `IncomingTransferService.setTrustAllow/Reject` (`captureTrustFence` → `false`).
- **Expected vs actual:** Expected: the queue is retained, or replayed after unlock. Actual: prompts appear over the auth screen, every decision is a no-op, and the queue drains.
- **Recommended fix:** Return early from `dequeueNextPendingTrust` when `!appStore.isLogined`. Reset `replayedForKey` on lock (and not only the queue, since the intermediate missing-network step also purges queued entries at `:196-199`). Keep the prompt open when `decide` gets `false`.
- **Effort:** S
- **Instances:** `apps/extension/src/popup/components/popups/PopupManager.vue:76-101,177-180,196-199,293-298`; `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:103-110`.
- **Source raw ids:** b07-popup-boot-state-C-1 (plus codex b07 routed-to-security item).

### B-11: [Minor] A lock during popup boot turns a lock-induced bootstrap rejection into "startup failed" and hides the unlock form

- **Type:** race / bad error path
- **Confidence:** high
- **Found by:** codex (claude confirmed in rebuttal). Cross-model severity disagreement: codex Major, claude "Moderate". The coordinator rates it **Minor**: it needs a lock inside the ~1 s boot, and one RETRY click recovers.
- **RECURRING?** Yes, as a family: N-08 (boot/unlock continuations).
- **Counter-example:** The popup opens and starts bootstrapping active profile A. Auto-lock fires, or another window locks. The lock event routes to auth, and then a bootstrap RPC rejects with "Wallet locked". `resolveBootSession` maps that to `failed`. `reconcileLockedBoot` checks the event-seq fence only for `locked` results, so `applyBootOutcome` installs `bootOutcome = failed`, and `auth.vue` withholds the password/passkey form behind a failure banner.
- **Violated invariant:** `failed` means an *open* session whose activation failed (`BootSessionResult`). A newer lock event owns the state.
- **Failing path:** `apps/extension/src/popup/app.vue:311-324` → `apps/extension/src/popup/boot-session.ts:57-60` → `apps/extension/src/popup/reconcile-locked-boot.ts:39-40` → `apps/extension/src/popup/apply-boot-outcome.ts:42-44` → `apps/extension/src/popup/pages/auth.vue:63,248`.
- **Expected vs actual:** Expected: a usable unlock screen. Actual: a false "startup failed" that needs a retry.
- **Recommended fix:** Apply the event-seq supersession check to `failed` outcomes too, and settle retry bookkeeping as `event-superseded` does.
- **Effort:** S
- **Instances:** `apps/extension/src/popup/reconcile-locked-boot.ts:39-40`; `apps/extension/src/popup/boot-session.ts:57-60`; `apps/extension/src/popup/apply-boot-outcome.ts:42-44`.
- **Source raw ids:** b07-popup-boot-state-X-3.

### B-12: [Minor] Account writers outside the deletion fence and row lock: `importAccount` after a profile purge, and `patchAccountField` after a chain purge

- **Type:** race / state invariant violation (orphan rows)
- **Confidence:** high (both sides probed or traced it)
- **Found by:** both (b02 C-1 ≡ X-2, plus codex X-1). Cross-model severity disagreement: codex rated the patch variant Major; claude rated the whole finding Minor. The coordinator rates it **Minor**: it needs a second window acting on the same profile or chain within a short window, and nothing corrupts a live account.
- **RECURRING?** Yes. N-03 fenced `createAccountInternal`; `importAccount` is the unfenced sibling.
- **Counter-example:**
  - **(a) Import:** `importAccount(P, …)` passes the network lookup (`:487`), then awaits PBKDF2 plus bb-WASM key encryption (`:493`, ~0.3–1 s) with no lock held. Window 2 deletes P, and both phase 1 and the purge complete. Import resumes and writes the imported-key row (`:499`) and the Account row (`:513`). Both persist for an erased profile, and the orphan sweep keeps the key because its Account row exists. (Codex correction: deletion must land *after* `:487`, or the network lookup throws first.)
  - **(b) Patch:** a rename or visibility edit reads imported account A under its row lock (`:320-321`). Window 2 deletes chain C's network, and `clearChainState` removes A and its key with no row lock (`:154-156`). The edit writes A back (`:327`). After C is re-added, A is visible but signing throws "signing key missing" (`:370-371`).
- **Violated invariant:** A deletion is "atomic, awaited, privacy-erasing" (`ProfileService.deleteProfile`). Writers must capture the deletion epoch before awaiting and re-check it before writing (`ProfileDeletionState`; `createAccountInternal` `:249-284`). Imported Account and key rows stay paired (`imported-keys-repository.ts`).
- **Failing path:** (a) `apps/extension/src/wallet/services/account/service.ts:469,487,493,499,513`, with deletion at `apps/extension/src/wallet/services/profile/service.ts:1486,1512`. (b) `account/service.ts:303,307,320-327`, with deletion at `:154-156` via `apps/extension/src/wallet/services/network/service.ts:538`.
- **Expected vs actual:** Expected: the import rejects with "profile is being deleted", and the edit observes the row is gone. Actual: orphan sealed-key and account rows (a); a resurrected, unusable imported account (b).
- **Recommended fix:**
  - (a) Capture `deletion.capture(profileId)` and check `isReserved` before the first await. Call `assertCurrent` inside the tuple lock before *both* writes, which must be committed together (codex: a check before the key write alone leaves the gap before the Account write).
  - (b) Take the same per-row lock in `clearChainState`/`purgeForProfile` when deleting rows, or have `patchAccountField` re-read inside the lock and treat a missing row as gone.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/account/service.ts:469,493,499,513-519` (import); `:303,307,320-327` (patch); unlocked deletes at `:154-156,633,852`.
- **Source raw ids:** b02-profile-session-lifecycle-C-1, b02-profile-session-lifecycle-X-1, b02-profile-session-lifecycle-X-2.

### B-13: [Minor] A late recovery-phrase export response starts countdown timers after unmount and redirects the user 5 min later

- **Type:** resource leak (secondary: wrong navigation)
- **Confidence:** high (codex reproduced it with fake timers; claude confirmed)
- **Found by:** codex (claude confirmed)
- **RECURRING?** No. `full.vue` has this fence (N-01 era) and its `seed.vue` sibling does not.
- **Counter-example:** Click "Retrieve Recovery Phrase" and navigate back before the KDF-bound `exportMnemonic()` resolves (~1 s). `onScopeDispose(clear)` has already run. The continuation calls `countdown.start()` (`seed.vue:63`), which arms a timeout and interval that are never cleared. Five minutes later `handleClose()` pushes `/popup/settings/security/export`, wherever the user is.
- **Violated invariant:** Page-owned timers end with their scope; the full-export sibling fences async completion against unmount (`full.vue:276,416`).
- **Failing path:** `apps/extension/src/popup/pages/settings/security/export/seed.vue:59` → `:79` (unmount) → `apps/extension/src/composables/useSecretCountdown.ts:50` → `seed.vue:63` → `useSecretCountdown.ts:29` → `seed.vue:46`.
- **Expected vs actual:** Expected: the late result is discarded. Actual: an orphan interval, then an unexpected navigation.
- **Recommended fix:** Add an unmount generation check after the RPC in `handleUnlock`, and make `start()` a no-op after dispose.
- **Effort:** S
- **Instances:** `apps/extension/src/popup/pages/settings/security/export/seed.vue:55,63,79`; `apps/extension/src/composables/useSecretCountdown.ts:26,50`.
- **Source raw ids:** b03-backup-restore-migration-X-3.

### B-14: [Minor] Config writes mutate memory before persisting; a failed write makes the same-value retry report success, and the Developer Mode cascade can persist a hidden Debug Mode

- **Type:** wrong result / state invariant violation
- **Confidence:** high on mechanism (the coordinator re-read `config/store.ts:59-98` and `advanced/index.vue:108-137`); low on likelihood, since every path needs a `chrome.storage.local.set` rejection.
- **Found by:** codex (b02 X-3; b07 X-4 confirming lead q07). Claude initially listed both as non-findings and confirmed both in rebuttal.
- **RECURRING?** No.
- **Counter-example:**
  - **(a) Store:** `setValue("theme","dark")` sets memory to `dark` and emits `onUpdate` (so `SessionManager` applies a new `sessionTtl`/strict flag immediately on that key), then `storage.set` rejects. A retry with the same value hits the equality shortcut at `:61` and resolves without writing. After an SW restart, the setting reverts.
  - **(b) Cascade:** turning Developer Mode off persists `{developerMode:false}`. The un-awaited child `updateSetting("debugMode", false)` rejects and only toasts. Disk keeps `debugMode:true` while its toggle is hidden (`:87-91`), so after a restart `LoggerStore` runs debug-level logging with no visible control. Any later successful config write heals it, because `set` persists the whole object.
- **Violated invariant:** A setter that resolves has saved its value; disabling Developer Mode durably disables its dependents (`advanced/index.vue:124-127`).
- **Failing path:** (a) `apps/extension/src/wallet/services/config/service.ts:50-51` → `apps/extension/src/wallet/config/store.ts:61-66` (and `apply()` `:93-98`). (b) `apps/extension/src/popup/pages/settings/advanced/index.vue:108-127` → `store.ts:64-66` → `apps/extension/src/wallet/logger/store.ts:27`.
- **Expected vs actual:** Expected: the write persists or reports failure. Actual: a false success, and a hidden debug mode that survives restart.
- **Recommended fix:** In `set`/`apply`, persist a staged copy first, then swap memory and emit. In the popup, await the cascade, or add one `setValues({developerMode, indicateFailures, debugMode})` transaction.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/config/store.ts:61-66,93-98`; `apps/extension/src/wallet/services/config/service.ts:50-55,74`; `apps/extension/src/popup/pages/settings/advanced/index.vue:108-127,140-144`.
- **Source raw ids:** b02-profile-session-lifecycle-X-3, b07-popup-boot-state-X-4, q07 (developerMode lead).

### B-15: [Minor] `updateFpcAddress` commits a pre-validation snapshot, undoing a concurrent rename or resurrecting a deleted FPC

- **Type:** lost update / race
- **Confidence:** high
- **Found by:** codex (claude withdrew its "unrealistic" dismissal in rebuttal)
- **RECURRING?** No.
- **Counter-example:** Window 1 changes custom FPC F's address and waits on PXE validation. Meanwhile window 2 renames F to "New", or deletes it. Window 1 then takes the lock and upserts `{...existing, address}` from its stale snapshot: "Old" returns, or F is recreated.
- **Violated invariant:** Serialized mutations operate on the current row; `updateFpc` and `deleteFpc` re-read inside the lock.
- **Failing path:** `apps/extension/src/popup/components/popups/EditFpcPopup.vue:118` → `apps/extension/src/wallet/services/fpc/service.ts:330` (snapshot) → `:350-364` (PXE await) → `:375-377` (stale merge + upsert).
- **Expected vs actual:** Expected: keep the rename, and reject if the row was deleted. Actual: the rename is silently reverted, or the FPC is resurrected. The effect is cosmetic or user-deletable, so Minor.
- **Recommended fix:** Re-read the row inside the final lock, reject if it is missing, and merge only `address`.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/fpc/service.ts:330,375-377`.
- **Source raw ids:** b01-execution-send-X-3.

### B-16: [Minor] Capability approval commits and reports success after the session has expired

- **Type:** wrong result
- **Confidence:** high
- **Found by:** codex (claude confirmed, retracting its broader "expiry during popup" non-finding for capabilities)
- **RECURRING?** Related to B-14 (08-16: capability-grant persistence), but a different gap.
- **Counter-example:** A session expires at E. At E−5 s the dApp requests `{type:"data", addressBook:true}`, and the user approves at E+5 s. `applyCapabilityDecision` checks row existence only, persists the grant, and the dispatcher returns `granted`. The dApp's next `getAddressBook()` finds the session expired, deletes it, and fails.
- **Violated invariant:** Grants belong to a live session; the execute path re-reads the session after the popup (`executeAndResolve`).
- **Failing path:** `packages/wallet-bridge/src/dispatcher.ts:1355-1371` → `apps/extension/src/wallet/services/dapp-interaction/service.ts:228,435` → `apps/extension/src/wallet/services/dapp-session/service.ts:343,380` → next call at `:164,399`.
- **Expected vs actual:** Expected: refuse and require reconnection. Actual: "granted", then an immediate refusal. It self-heals on reconnect.
- **Recommended fix:** Check `expiry` inside `applyCapabilityDecision`'s existing lock before mutating. Do not call the lock-taking `isExpired()` there.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/dapp-session/service.ts:343`; caller `packages/wallet-bridge/src/dispatcher.ts:1362`.
- **Source raw ids:** b05-dapp-ingress-approval-X-1.

### B-17: [Minor] Popup account/profile commits run captured callbacks after awaits without a scope fence

- **Type:** race / state invariant violation
- **Confidence:** moderate (the mechanism is confirmed by both sides; the triggers need a second window to complete an unlock inside one or two RPCs)
- **Found by:** codex (claude partial). Cross-model severity disagreement: codex Major ×2, claude Minor/Nit. The coordinator rates it **Minor**.
- **RECURRING?** Yes, as a family: N-08 (auth.vue continuation), N-05 (superseded network watcher), B-09 (Select Profile bypass).
- **Counter-example:**
  - **(a)** `auth.vue` mount reads the remembered profile A, then awaits `getProfiles()`. Another window unlocks B, and this popup's activation handler installs B. The stale callback then assigns `appStore.profile = A` alongside B's authenticated state. `route-guard.ts` `lateDecision` has the same shape: it checks `!appStore.profile` only before its awaits.
  - **(b)** In A, picking account A2 goes through `commitScopeChange`, which awaits a journal refresh. Meanwhile A locks, B unlocks and bootstraps. The refresh discards its stale rows but returns normally, so the captured `selectAccount(A2)` runs and persists A2 to `nulo:ui:activeAccount` under profile B. The sibling `commitAccountTarget` checks `superseded()` at `app.store.ts:439`.
- **Violated invariant:** A newer activation wins, and a selection is bound to its originating profile and network.
- **Failing path:** (a) `apps/extension/src/popup/pages/auth.vue:200-209`; `apps/extension/src/popup/route-guard.ts:47-52`. (b) `apps/extension/src/popup/components/popups/AccountsPopup.vue:37` → `apps/extension/src/stores/app.store.ts:252-258,295` → `:376-380`.
- **Expected vs actual:** Expected: a stale commit is abandoned. Actual: a mismatched profile or account in the store until the next event.
- **Recommended fix:** Drop the redundant preference assignment in `auth.vue` (boot owns it) and fence `lateDecision` across its awaits. Give `commitScopeChange` a captured scope epoch and check it before invoking the callback, as `commitAccountTarget` does.
- **Effort:** S
- **Instances:** `apps/extension/src/popup/pages/auth.vue:200-209`; `apps/extension/src/popup/route-guard.ts:47-52`; `apps/extension/src/stores/app.store.ts:252-258,396-398`; `apps/extension/src/popup/components/popups/AccountsPopup.vue:37`; `apps/extension/src/popup/pages/settings/accounts/index.vue:40`; `apps/extension/src/popup/components/popups/NewAccountPopup.vue:80-82`; `apps/extension/src/popup/components/popups/SelectProfilePopup.vue:53-55`; `apps/extension/src/utils/guarded-network-activation.ts:62-64,76-78`.
- **Source raw ids:** b07-popup-boot-state-X-1, b07-popup-boot-state-X-2.

### B-18: [Minor] Receipt polling mutates the pending object before `txs.set`, so a failed write permanently suppresses the retry

- **Type:** state invariant violation
- **Confidence:** high on mechanism; the likelihood needs a transient storage write failure
- **Found by:** codex (claude confirmed)
- **RECURRING?** No. It shares a pattern with B-14(a): mutate-before-persist plus an equality shortcut.
- **Counter-example:** Tx H passes the DROPPED debounce. `updateTx` sets `tx.status = Dropped` on the object held in `pending`, and then `txs.set` rejects once. Every later poll sees `status === tx.status` at `:463` and returns early. Durable history stays `Pending`, H never moves to the resurrection watch, and waiters time out until a worker restart.
- **Violated invariant:** The pending and watch maps reflect committed status (`transaction/service.ts:488`).
- **Failing path:** `apps/extension/src/wallet/services/transaction/service.ts:375` → `:478-479` (mutation) → `:486` (reject) → `:463` (early return).
- **Expected vs actual:** Expected: retry the write. Actual: stuck until restart.
- **Recommended fix:** Build a next-state object, persist it, then swap the maps and emit.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/transaction/service.ts:463,478,486,495,498`.
- **Source raw ids:** b01-execution-send-X-4.

### B-19: [Minor] Backup file-picker completions have no selection-generation fence

- **Type:** race
- **Confidence:** high on mechanism (codex reproduced it in memory), low on likelihood
- **Found by:** codex (claude partial). Cross-model severity disagreement: codex Major, claude Minor. The coordinator rates it **Minor**: size-capped reads take milliseconds, and the OS picker is modal, so a second pick, a password entry and a restore start must all fit inside the first read.
- **RECURRING?** Related to N-13 (file readers), but a different gap.
- **Counter-example:** Pick backup A and leave its decompression or read pending. Pick B, which finishes first; enter B's password and start the restore. A's read then completes: the selection reverts to A, `restoreStatus` resets to `null`, and the passwords clear while B's restore runs. This reopens the re-entry guard at `:717`.
- **Violated invariant:** The selection reflects the latest pick, and a running restore keeps its latch.
- **Failing path:** `apps/extension/src/components/composite/import/ImportFullBackupForm.vue:58,64` → `apps/extension/src/composables/useFullBackupImport.ts:621-624,636,637,659-662,717`.
- **Expected vs actual:** Expected: a superseded read publishes nothing. Actual: it overwrites the newer selection and clears the latch.
- **Recommended fix:** Use a pick-generation token checked after each await and before every publication. Disable picking and submitting while a read is pending.
- **Effort:** S
- **Instances:** `apps/extension/src/composables/useFullBackupImport.ts:621,637,659,664,922,953`.
- **Source raw ids:** b03-backup-restore-migration-X-2.

### B-20: [Minor] A failed seed-marker read is turned into `{}` and written back, erasing other tokens' deletion tombstones

- **Type:** silent corruption (conditional)
- **Confidence:** low (it needs a `chrome.storage.local.get` rejection followed by a successful `set`)
- **Found by:** codex. Cross-model disagreement: claude calls it a defensible trade-off. The coordinator keeps it at **Minor/low**. The doc at `seeder.ts:670-678` justifies not *throwing* on hostile shape, but it does not justify overwriting a valid stored blob after a read error. The existing test covers malformed data only (`seeder.test.ts:384`).
- **RECURRING?** No.
- **Counter-example:** The marker holds a `deleted` tombstone for Clean USDC. The user deletes USD Coin. `updateMarker` → `readMarkerState` hits a rejected read and returns `{}`, and `set` persists only USD Coin's tombstone. The next seed pass re-adds Clean USDC.
- **Violated invariant:** User deletion is a permanent tombstone (`seeder.ts:300`).
- **Failing path:** `apps/extension/src/wallet/services/token/service.ts:604` → `apps/extension/src/wallet/services/token/seeder.ts:301,337` → `:683-686` (swallow) → `:342` (whole-blob write).
- **Expected vs actual:** Expected: abort the mutation on a read error. Actual: unrelated tombstones are dropped.
- **Recommended fix:** Let mutators (`updateMarker`, `retry`, `commitSeedResult`) see read *errors*, and keep the reset-to-empty only for malformed *shape*.
- **Effort:** S
- **Instances:** `apps/extension/src/wallet/services/token/seeder.ts:277-279,337-342,524,535-538,683-686`.
- **Source raw ids:** b04-incoming-balances-activity-X-2.

---

## Dropped (with reason)

| # | Item (raw id / lead) | Reason |
|---|---|---|
| D-01 | b05 C-2: `-32005 TOO_MANY_PENDING` unreachable end to end | **Documented and pinned.** `rpc-cancel.ts:82-90` deliberately keeps `TooManyPendingError` off the code channel, and `rpc-cancel.test.ts:110` asserts that no code is carried. Cross-model disagreement: claude calls it a bug and codex calls it pinned. It remains a doc-contradiction item: `execution-lane.ts:331` ("Surface to the dApp as -32005") and the `errors.ts` class doc say otherwise. Fix the docs, or ratify the contract and lift the pin. |
| D-02 | b05 C-1 timeout half (`window-manager.ts:126`) | Moot for SDK dApps: their 300 s call ceiling (`ARCHITECTURE.md:176`) expires before the 10-min interaction timeout. |
| D-03 | q13 LogsViewer 500 ms race | Designed step-down retry (1024→256→…→1, then throw) in a Developer-Mode-only viewer. The leaked timer is harmless. No wrong result. |
| D-04 | q02 `exportMnemonic` legacy error string | `seed.vue:59-67` treats any rejection as wrong-password; nothing matches on type. |
| D-05 | q13 `ImportedAccountUnusableError` / `TxConfirmationTimeoutError` identity lost over RPC | No cross-RPC consumer discriminates on class, and the messages survive. The in-process `instanceof` at `account/service.ts:391` runs before serialization. |
| D-06 | q03 `commitScannedNote` missing epoch re-check | Runs under the service lock, and bumpers that race it do not produce the wiped-profile write. Codex notes the profile-change bump is outside the lock, but no destructive interleaving was shown. |
| D-07 | q03 `parseNoteAmount` negative/hex | The input is always `BigInt(raw).toString()` of a u128. Unreachable. |
| D-08 | q04 `setActiveNetwork` with no primary endpoint | No normal writer produces the row, and the next `getNode` fails loudly. |
| D-09 | q05 `BalanceView.onBalanceAdded` no dedupe | The production Added emitter sends zero balances, so there is no fiat double-count. A duplicate row is transient and needs out-of-order delivery. Defense in depth only. |
| D-10 | q06 `RevokeAuthwitsPopup` `feeSetting` typo | Latent. Every reader is truthiness-based. Quality item. |
| D-11 | q07 `full.vue:375` filename separators | Every name entry path sanitizes separators. (B-05 covers the "wrong profile name in filename" variant.) |
| D-12 | q07 `full.vue:316` passkey Encrypt hides the recommendation | Intentional transition that reveals the password form. |
| D-13 | q08 `SecretUnlockSection` global classes | No currently broken page. Coupling or quality only. |
| D-14 | q09 `incomingRows` lacks `isForeignProfile` | Ingest is profile-, network- and account-scoped with a synchronous reset. Consistency hardening only. |
| D-15 | q09 `mint_to_commitment` titled "Mint" | A category label, not a wrong amount. Different contract from the approval parser. |
| D-16 | q11 `grantPublicAuthwit` inside a raw batch | Only a raw client that bypasses the SDK schema reaches it, and the popup still gates. No wrong result. |
| D-17 | q11 `queued-journal.ts:143` no chain-prefix filter | No normal writer creates a mixed-chain session row. |
| D-18 | q12 `AddressDisplay` copy timer | Dead component. |
| D-19 | q12 light-theme divider colour | Visual or design item, not a correctness bug. Route to the quality run. |
| D-20 | q13 `integrity.ts` dead base64 catch | Still fails closed. Quality item. |
| D-21 | b04 `ActivityProtocolCoordinator` scope-vs-source lock race | No production importer. Revisit when it is wired in. |
| D-22 | b06 node HTTP envelope (60 s × 4) exceeds the 90 s offscreen timeout | Delay only; the orphaned ops are idempotent reads. |
| D-23 | b03 export slices from different profiles (claude non-finding) | Superseded: promoted to B-05. |
| D-24 | q01, q07 dev-mode cascade | Not dropped. Merged into B-08 and B-14 respectively, and listed here only for traceability of the lead ledger. |

## Routed to security

1. `apps/extension/src/wallet/services/account/service.ts:320-330`: `patchAccountField` checks only `profileId`/`chainId`, not `address`. A transplanted row redirects a metadata write onto another account's row. Needs a storage writer. (q02; both.)
2. `apps/extension/src/wallet/config/store.ts:46-66`, `apps/extension/src/wallet/services/config/service.ts:38-40`: `sessionTtl` is validated only as `z.number()`, so a negative or non-finite value through `setValue` locks the wallet instantly or disables expiry. The RPC is open to any extension page. (claude b02.)
3. `apps/extension/src/wallet/services/profile/session-manager.ts:858-861`: a rejected refresh persist skips rescheduling the alarm, and the old alarm is discarded at `:828`. Proactive auto-lock is lost, though lazy expiry remains. (codex b02.)
4. `apps/extension/src/wallet/services/profile/service.ts:2015,2330`, `packages/wallet-crypto/src/password-secret-box.ts:223`: non-constant-time `array_equals` on secret-derived bytes. (q10; both.)
5. `packages/aztec-runtime/src/pxe/artifact-registry.ts:203-215`: `verifiedClassIds` is keyed by class id only and shared across profiles and chains, so a later `pxe-local` lookup skips re-verification. Needs a hostile store. (claude b06.)
6. `apps/extension/src/popup/components/popups/PopupManager.vue:76-101,293-298`: the incoming-trust prompt renders token and contract metadata over the lock screen. This is the disclosure half of B-10: the association with this wallet's receipts is private even though the address is public. (codex b07.)
7. `apps/extension/src/wallet/services/dapp-interaction/service.ts` `resolveInteraction`: does not check that the interaction kind is capability or discovery, so an extension page could resolve an execute interaction with an arbitrary result. Same-extension sender authentication is the stated boundary. (claude b05 aside.)

## Cross-cutting observations

1. **"Captured identity committed after an await" is still the dominant residual family**, as on 08-22. The instances this run are B-04 (drain captures the profile once), B-05 (export slices resolve the live profile), B-12 (import and patch writers), B-15 (FPC snapshot) and B-17 (auth, route guard, `commitScopeChange`). Most are multi-window profile or scope switches that are not fenced at the commit point. The generation or unmount fences already in place cover *page* lifetime, but not *profile* or scope identity. A shared compare-and-commit helper that carries `{profileId, scopeEpoch}` and is checked immediately before every write or callback would close these by construction.
2. **Sibling asymmetry is the cheapest bug source to sweep.** In six findings, the fix or guard exists on one twin and is missing on the other:

   | Guarded twin | Unguarded twin | Finding |
   |---|---|---|
   | `proveTx`/`simulateTx` | `profileTx` | B-03 |
   | `probeNodeStatus` | `getNodeStatus` | B-09 |
   | `TransferEstimateReuse` | `OperationEstimateReuse` | B-08 |
   | `createAccountInternal` | `importAccount` | B-12 |
   | `commitAccountTarget` | `commitScopeChange` | B-17 |
   | `waitForTx`'s `task.exists` | `WrappedTask` | B-06 |

   When a fix lands, grep for the twin. The reviewers flagged the same thing independently in b06.
3. **Mutate-before-persist plus an equality shortcut turns one failed write into a silent permanent no-op.** Instances: `ConfigStore.set/apply` (B-14) and `TransactionService.updateTx` (B-18). The pattern to adopt is stage, persist, then swap and emit.
4. **Error identity at the dApp boundary is inconsistent.** A user close reaches the dApp unclassified (B-07). `Invalid task id` replaces the documented cancellation (B-06). The `TOO_MANY_PENDING` docs promise a code that the pinned code channel never carries (D-01). One table owns what reaches the dApp (`error-envelope.ts` + `ridesCodeChannel`); every documented dApp-facing code should be either in it or deleted from the docs.
5. **Lifetime mismatches between cooperating timers.** B-02 has a 120 s preview TTL against a 300 s SDK ceiling and a 10-min interaction. B-01's fix must fit a bounded inclusion wait inside that same 300 s. B-10 has popup-side replay keys that survive lock and unlock. When one side's lifetime is set, the other side's should be checked in the same PR.
6. **Recurrence scorecard vs 08-22:** the N-03, N-08, N-10 and B-26 families each resurfaced on an unfixed sibling or neighbouring path (B-12, B-17, B-04, B-10). None of the 08-22 or 08-16 fixed findings regressed at the same site; the prior fixes B-02, B-03, N-07 and N-16 were each re-verified as holding by the codex b01 pass.
