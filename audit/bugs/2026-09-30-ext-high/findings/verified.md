# Phase 4 verification, adjudicated: `/harden bugs` (high), extension, 2026-09-30

Base: `dev` @ `910a4def`. Inputs: `consolidated.md` (B-01…B-20), `addendum-quality-incidentals.md` (B-21…B-23), `verify-claude-A.md` (B-01…B-05), `verify-claude-B.md` (B-06…B-10), `verify-codex.md` (B-01…B-10). Where the two verifier families disagreed, the writer re-opened source; the evidence read is cited in each record.

Severity anchors (from the scan preamble): Blocker = persistent loss or crash on a common path; Critical = high impact under realistic but conditional conditions; Major = user-visible feature behaviour; Minor = limited impact or rare conditions. The owner's "realistic scenarios only" rule governs likelihood.

## Verdict table (top 10)

| ID | Claude verifier | Codex verifier | Final verdict | Final severity | Confidence |
|---|---|---|---|---|---|
| B-01 | confirmed, Major | confirmed, Major | confirmed | Major | high |
| B-02 | confirmed, Major | confirmed, Major | confirmed | Major | high |
| B-03 | confirmed, Major | partial, Major | confirmed, scope narrowed | Major | high |
| B-04 | partial, Minor | confirmed, Major | confirmed | Minor | high (mechanism), low (likelihood) |
| B-05 | partial, Minor | confirmed, Critical | confirmed | Major | high (mechanism), low (likelihood) |
| B-06 | confirmed, Minor | partial, Major | confirmed, symptom corrected | Minor | high |
| B-07 | confirmed (broader), Minor | confirmed, Minor | confirmed, broadened | Minor | high |
| B-08 | confirmed, Minor | confirmed, Minor | confirmed | Minor | high (defect), moderate (reach) |
| B-09 | confirmed, Minor | confirmed, Minor | confirmed | Minor | high |
| B-10 | confirmed (broader), Minor | confirmed, Minor | confirmed, broadened | Minor | high |

---

## B-01: dApp `sendTx` ignores its wait options and returns one immediate receipt

- **Final verdict:** confirmed. **Severity:** Major. **Confidence:** high. **Effort:** M (1–2 days).
- **Disagreement record:** none. Both verifiers confirmed Major independently, and both read the installed `@aztec/wallet-sdk` `BaseWallet.sendTx`, which calls `waitForTx` unless `NO_WAIT`.
- **Corrected trace:** `packages/wallet-bridge/src/dispatcher.ts:1133-1149` unwraps the executor result only → `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:754` branches only on `NO_WAIT` → `:757` one `node.getTxReceipt(txHash)` straight after broadcast (PENDING, or DROPPED on a lagging replica). NO_FROM arm: `:935-939`. The broadcast itself records without waiting (`execution-coordinator.ts:354-357`).
- **Instances:** `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:754,757,935,938`. Pinned without a `(BUG PIN)` by `dapp-send-executor.test.ts:436-460`.
- **Refined fix:** one helper (for example `awaitDappReceipt(node, txHash, wait)`) used by both arms. It passes `op.opts.wait` through to upstream `waitForTx` when it is an object, uses defaults when it is `undefined`, keeps `NO_WAIT` immediate, and caps the timeout below the SDK's 300 s call ceiling. Reuse `TransactionService.waitForTx`'s DROPPED debounce (`transaction/service.ts:237`) for replica lag. Keep "confirmation timed out" distinct from "not submitted" (codex).
- **Test:** both arms, receipt stub PENDING, PENDING, then MINED/CHECKPOINTED. Assert the call resolves only on the requested status, and that a REVERTED receipt throws unless `dontThrowOnRevert`.

## B-02: the 120 s preview snapshot outlives neither the approval nor a fast Confirm

- **Final verdict:** confirmed. **Severity:** Major. **Confidence:** high (first trigger); moderate (the second, fast-Confirm trigger was read, not traced through `approve`).
- **Disagreement record:** effort only. Claude S, codex M. **Call: M (about a day)**, because codex's fix correctly requires the snapshot to survive the approval hand-off and queued waiting for an execution slot, plus gating both the button and the handler.
- **Corrected trace:** `apps/extension/src/wallet/services/execution/preview-snapshots.ts:30,52` (TTL shared with the reuse cache, `ESTIMATE_REUSE_TTL_MS`, `transfer-estimate-reuse.ts:39`; timer delete at `estimate-reuse-shared.ts:29`) → `dapp-send-executor.ts:704-705` (`missing`, no `reuseId`) → rebuild rediscovers the authwit → `:719` `assertWithinPreview` throws at `preview-snapshots.ts:74`. NO_FROM: `dapp-send-executor.ts:1031`. The interaction lives 10 min (`dapp-interaction/service.ts:62`); the window has already closed (`popup/windows/execute/index.vue:519`). `:confirm-disabled` (`index.vue:689-698`) has no `estimatingOps`/`previewingOps` term. An SW restart empties the map and gives the same result.
- **Refined fix:** give `PreviewSnapshots` its own `SingleShotTtlCache` of at least `INTERACTION_TIMEOUT_MS`, drop the `builtAt` age check in `take`, and evict on interaction settle. The snapshot is hashes only, so the 120 s bound stays on the reuse cache that retains signed requests. Add `estimatingOps[i] || previewingOps[i]` to Confirm's disabled state and guard the handler. Keep the authwit comparison unchanged.
- **Test:** fake timers. Stash `[h]`, advance 121 s, confirm a send whose rebuild rediscovers `[h]`, assert it signs. `preview-snapshots.test.ts`: still `found` at 5 min.

## B-03: `profileTx` omits `senderForTags`

- **Final verdict:** confirmed, with scope narrowed. **Severity:** Major. **Confidence:** high. **Effort:** S (2–4 h).
- **Disagreement record:** Claude confirmed as stated. Codex: partial, because the PXE oracle returns `Option.none()` (`private_execution_oracle.ts:195`) rather than throwing; the throw is in the Noir message-delivery code when the *default* sender is required (`messages/delivery/mod.nr:150-152`, reached from `uint_note.nr:122-127`), and an explicit-sender path (`mod.nr:149`) exists. **Call:** codex's correction is adopted. The claim becomes "profiling fails for any private call whose note delivery uses the default sender", which includes the standard Token `transfer_to_private` and private transfers. That is still most real private calls, so Major stands (both verifiers rated Major).
- **Corrected trace:** `apps/extension/src/wallet/services/execution/view-executor.ts:403-407` (scopes `[A, …]`) → `packages/aztec-runtime/src/pxe/client.ts:300` → `packages/aztec-runtime/src/pxe/service.ts:621-623` passes `{profileMode, skipProofGeneration, scopes}` only; siblings `proveTx` (`:501`) and `simulateTx` (`:584`) pass `senderForTags: scopes[0]`, documented at `:481-490`. Upstream `BaseWallet.profileTx` passes it (`base_wallet.js:365`).
- **Refined fix:** add `senderForTags: scopes[0]` at `service.ts:621-623`, parsed exactly as the siblings do.
- **Test:** a `PxeService.profileTx` unit test asserting the forwarded options include `senderForTags === scopes[0]`, beside the existing sibling pins; optionally one real-node case behind the existing skip-env pattern (`view-executor.test.ts:354-375` mocks PXE and cannot see this).

## B-04: a lock during the balance-outbox drain deletes the sole refresh marker

- **Final verdict:** confirmed. **Severity: Minor** (codex Major, Claude Minor). **Confidence:** high on mechanism, low on likelihood. **Effort:** S.
- **Disagreement record:** Codex rated Major/high and noted that unlock only refreshes balances at least 30 min old (`apps/extension/src/utils/core.ts:148-167`), so a recently projected stale balance survives an unlock. Claude rated Minor: ms-wide window, short-lived rows, self-healing. **Writer's source check:**
  - The mechanism is exact: `drainBalanceOutbox` captures the profile once (`incoming-transfer/service.ts:2230`); `TokenBalanceService.onActiveProfileChanged` clears `tokens` synchronously (`token-balance/service.ts:455,461`) before an `await getTokensRaw`; `requestBalanceRefresh` then reports `{missing:true}` (`:238-247`); `isCurrent()` is a lock-handoff ticket, not a profile epoch, so the row is deleted (`incoming-transfer/service.ts:2274`).
  - The post-unlock variant does not race in practice. The incoming service re-hydrates on profile change (`:360-362`), its first poll scans the PXE or node before draining (`:1290-1307`, `:1053-1065`), and the token map rebuild is one storage read. The live window is therefore a lock or profile switch landing inside a drain's few storage awaits, while an unanchored row exists.
  - The stale balance heals on opening that token's page (`popup/pages/tokens/[id].vue:76`), on the Tokens menu Refresh (`TokensView.vue:263,438`), on the next settled tx, or at the 30-min staleness refresh on a later unlock (`popup/pages/auth.vue:194`). Codex is right that an immediate unlock does not heal it.
  - **Call: Minor.** A received amount can be missing from the displayed balance for up to about 30 min, but the trigger is a ms-scale timing coincidence and no funds or durable records are affected.
- **Instances:** `apps/extension/src/wallet/services/incoming-transfer/service.ts:357,1065,1307,2230,2259,2274,2296`; `apps/extension/src/wallet/services/token-balance/service.ts:238-247,455-472`; no repair at `token-balance/reconcile-pairs.ts:145`.
- **Refined fix:** producer side first. `requestBalanceRefresh` returns a retryable result (or throws, which `requestRefreshOrKeep` already maps to "keep") when `this.profile` is unset or the map is mid-rebuild (capture `profileGeneration`). Optionally re-check the active profile id right before the delete in `drainOutboxRow`.
- **Test:** `token-balance/service.test.ts`: after `onActiveProfileChanged(undefined)`, `requestBalanceRefresh` must not return `missing` for a stored pair. Plus an incoming-transfer test parking a drain across a lock and asserting the row survives.

## B-05: full-backup export is not bound to one profile

- **Final verdict:** confirmed. **Severity: Major** (codex Critical, Claude Minor, coordinator Major). **Confidence:** high on mechanism, low on likelihood. **Effort:** S (frontend activation fence), M (service-bound profile id).
- **Disagreement record:** Codex: Critical, because an apparently successful recovery artifact can be unusable. Claude: Minor, because it needs a rare cross-window timing, the damage is latent, and nothing is lost from the live wallet. **Writer's source check:**
  - Mechanism confirmed. Key material is fetched for the explicit `appStore.profile.id` (`popup/pages/settings/security/export/full.vue:193`), then the slices call `client.backup()` with no profile (`:295`; `utils/full-backup-helpers.ts:137-142`), which resolve the *active* profile (`wallet/services/account/service.ts:664,750`, `requireActiveProfile`). `SessionManager.open` replaces a live session and emits the new profile with no intervening lock (`profile/session-manager.ts:318-338`), and `popup/app.vue:198-218` re-bootstraps without unmounting, so the only fence (`gen === generation`, bumped on unmount) holds. The filename reads the live profile name at download (`full.vue:375`).
  - Likelihood is low. A lock unmounts the page (safe). The toolbar popup closes on blur, so the export has to be running in a detached popup window (for example the one onboarding opens, `onboarding/app.vue:41-48`), while the user finishes creating or restoring profile B in a second surface during the seconds of slice assembly. That is deliberate concurrent multi-window work, not an accident of normal use.
  - Impact is on the recovery artifact only, and it is silent until the worst moment. The export reports success with a valid checksum. At restore, keyless imported accounts are dropped (`account/service.ts:837-858`, reported as dropped) and mixed rows either fail integrity checks or restore partially. The owner weighs "a backup that silently cannot recover what it claims" heavily, which puts it above Minor.
  - **Call: Major, not Critical.** Critical requires realistic conditions; this needs two concurrent surfaces and a completed profile activation inside a seconds-wide window. Not labelled "Potential Critical" because the uncertainty is about likelihood, not about the mechanism.
- **Refined fix (codex's point adopted):** comparing `appStore.profile.id` at the end misses an A→B→A switch mid-export. Fence on an activation counter instead: capture a store-level sequence bumped on every `onActiveProfileChanged` (or the session serial) at start, and make the `onSlice` probe `gen === generation && seq === startSeq`; capture the filename at start. The durable fix passes the captured profile id to every `backup()` and has services reject a mismatch.
- **Instances:** `apps/extension/src/popup/pages/settings/security/export/full.vue:193,295,296,375`; `apps/extension/src/utils/full-backup-helpers.ts:137-151`; slices resolving the active profile: `wallet/services/profile/service.ts:2249`, `account/service.ts:664,750`, `token/service.ts:847`, `token-balance/service.ts:663`, `transaction/service.ts:508`, `auth-registry/service.ts:487`, `contact/service.ts:68,276`, `account-state/service.ts:206` (all under `apps/extension/src/`).
- **Test:** pause between the account and imported-keys slices, emit an activation of B without unmounting, resume; assert `AssemblyAbortedError` and no downloadable payload.

## B-06: a cleared task registry makes `WrappedTask` settlement throw

- **Final verdict:** confirmed, with the dApp-visible symptom corrected. **Severity: Minor** (codex Major, Claude Minor). **Confidence:** high. **Effort:** S.
- **Disagreement record:** Claude: Minor; the dApp gets "Invalid task id" instead of the 4001 cancellation, and the post-broadcast variant needs lock plus unlock inside one RPC. Codex: Major; the dApp symptom is wrong (the old session is terminated and late responses are suppressed), but the post-broadcast variant needs only a direct activation of B from another window, and it leaves a broadcast tx with no activity record. **Writer's source check:**
  - Codex is right on both corrections. `wireProfileSwitchTeardown` terminates sessions bound to the old profile (`wallet/services/wallet-sdk/profile-switch-teardown.ts:121-145`), and `background.ts:1235-1246` suppresses a response when the switch epoch moved. `SessionManager.open` replaces a session directly (`session-manager.ts:318-338`), so no lock is needed.
  - The real consequence is therefore the post-broadcast gap: `sendTxTask` awaits `node.sendTx` (`execution-coordinator.ts:302`), `task.complete()` throws `Invalid task id` (`:303`; `task/service.ts:177-181,241`), `task.fail` throws again (`:309`), and `recordTransaction` (`:355`) never runs. The chain, the journal (via `SendCheck`) and the balance are right; the activity row is missing.
  - **Call: Minor.** The window is the duration of one `node.sendTx` RPC (typically sub-second), and it needs a profile activation completed in a second surface at that moment. The effect is one missing history row, not wrong funds.
- **Instances:** `apps/extension/src/wallet/services/task/wrapped-task.ts:25-35`; `apps/extension/src/wallet/services/execution/execution-coordinator.ts:271,273,303,309,355`; `apps/extension/src/wallet/services/execution/rpc-cancel.ts:78,81`; `apps/extension/src/wallet/services/execution/transfer-executor.ts:216,225`; `apps/extension/src/wallet/services/execution/service.ts:702`.
- **Refined fix:** `WrappedTask.complete/fail/cancel` become no-ops when `!this.exists` (the idiom at `transaction/service.ts:250`). Leave `start/startSubtask` and `TaskService`'s strict APIs throwing.
- **Test:** `wrapped-task.test.ts` settles after a registry clear without throwing; a coordinator test resolves a delayed send after a real profile switch and asserts `recordTransaction` still runs.

## B-07: closing an approval window before `beforeunload` is installed is not a 4001

- **Final verdict:** confirmed, broadened. **Severity:** Minor. **Confidence:** high. **Effort:** S.
- **Disagreement record:** none on verdict or severity. Claude added a variant the finding missed, confirmed by the writer: when the wallet is locked, `start()` returns at the auth redirect before installing the listener (`composables/useDappApprovalWindow.ts:118-121,124`), so closing the lock screen of an approval window also reaches the dApp as a generic failure. Codex adds that installing the hook earlier is not sufficient, because unload delivery is fallible.
- **Corrected trace:** `apps/extension/src/wallet/services/window-manager/window-manager.ts:156,259` (`handle.reject("Window closed by user.")`, a bare string) → `apps/extension/src/wallet/services/dapp-interaction/service.ts:466-493` → `apps/extension/src/wallet/services/wallet-sdk/background.ts:1211-1216` → `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:197` (unclassified). Explicit Reject builds `UserRejectedError` (`dapp-interaction/service.ts:250`), mapped to 4001 at `error-envelope.ts:48-55`.
- **Refined fix:** add an optional `onUserClose?: () => Error` to `OpenAndAwaitOpts`; `dapp-interaction/service.ts:466` passes `() => new UserRejectedError("Window closed by user.")`. The passkey caller (`wallet/services/passkey/service.ts:119`) keeps the current string. Update the `.rejects.toMatch` window-manager tests.
- **Test:** fire the fake `windows.onRemoved` for an execute interaction's window and assert the wire error is 4001 `USER_REJECTED`.

## B-08: a transient fee-read error in `OperationEstimateReuse.tryConsume` aborts the send

- **Final verdict:** confirmed. **Severity:** Minor. **Confidence:** high (defect), moderate (reach). **Effort:** S.
- **Disagreement record:** none. Claude's caveat is kept: the rebuild calls the same fee read milliseconds later (`fee/fee-strategy.ts:289`, `fpc-strategy.ts:177`), so the fallback only helps when the blip clears between the two reads. Codex: the helper's rethrow is correct (substituting fees could underprice), so the fix belongs in the cache.
- **Corrected trace:** `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:129` (entry consumed) → `:159-161` (`predictedWorstMinFees` rethrows, `packages/aztec-runtime/src/fee-juice.ts:25-32`) → escapes `dapp-send-executor.ts:794`; the rebuild at `:833` is skipped.
- **Refined fix:** wrap only `:159-166` in try/catch returning `this.reject(...)`, as `transfer-estimate-reuse.ts:196-210` does. Keep `SessionEndedError` (`:139`) and `getNetwork`/`getNode` failures as throws.
- **Test:** fee read rejects once in `tryConsume` → resolves `undefined`, entry consumed; confirm then rebuilds and sends.

## B-09: `getNodeStatus` lacks the local-kind carve-out

- **Final verdict:** confirmed. **Severity:** Minor. **Confidence:** high. **Effort:** S (1–3 h).
- **Disagreement record:** none between verifiers (the scan-phase codex Major was already settled at Minor by the coordinator; both verifiers agree).
- **Corrected trace:** `apps/extension/src/wallet/services/network/service.ts:734` calls `_getChainId(primary.rpcUrl)` with no kind hint → the composite at `:996-1010` → `:735` `InvalidChain`. `updateEndpoint` passes the hint (`:600,647`), and `probeNodeStatus` applies the carve-out (`:751-753`). Consumers: `apps/extension/src/stores/app.store.ts:495-499` (status dot); `apps/extension/src/wallet/services/account-state/service.ts:101,221-228` (backup omits that chain's contracts and senders, warn-logged).
- **Refined fix:** `_getChainId(primary.rpcUrl, network.kind)` at `:734`, or share the `effective` computation with `probeNodeStatus`.
- **Test:** seed Local Network, move it to a custom port, assert both status methods report `Active` (extends `network/service.test.ts:826-852`).

## B-10: queued incoming-trust prompts open on the lock screen and drain with no decision

- **Final verdict:** confirmed, broadened. **Severity:** Minor. **Confidence:** high (flow); moderate on the exact unlock ordering (read, not run).
- **Disagreement record:** none on verdict or severity. Claude broadened step 4: a single open prompt closed by the lock is also not replayed after unlock, because `replayedForKey` survives. **Fix disagreement:** the consolidated fix said "keep the prompt open when `decide` gets `false`". Codex says not universally, since `false` also means a deleted token; Claude says it is optional and a visible UI change needing owner sign-off. **Call:** drop that part. Gating plus a replay reset fixes the bug without changing any screen.
- **Corrected trace:** `apps/extension/src/popup/locked-state.ts:19-27` (`closeAll`, triple not cleared) → `apps/extension/src/popup/components/popups/PopupManager.vue:293-298` (close watcher) → `:76-101` `dequeueNextPendingTrust` (no login check) → `IncomingTrustPopup.vue:103-110` → `incoming-transfer/service.ts:620-638,680-681` (fence refuses, returns `false`) → prompt closes. After unlock the network cycles (`composables/useProfileBootstrap.ts:56,71`), the queue is purged (`PopupManager.vue:196-199`), and replay no-ops on the stale `replayedForKey` (`:177-180`).
- **Refined fix:** gate ingress, dequeue and replay on `appStore.isLogined`; reset `replayedForKey` when the session locks or the triple becomes incomplete; replay once the unlocked triple is ready.
- **Test:** `PopupManager.test.ts`: two pending payloads, lock → nothing opens; unlock with the network cycling → replay runs again.
- **Effort:** S.

---

## Not independently verified: coordinator confidence only

These were not in the Phase 4 top 10. They carry the coordinator's re-read (B-11…B-20) or the addendum's source check (B-21…B-23), and severities are as consolidated. The writer spot-checked the load-bearing lines of B-21, B-22 and B-23 (`new-profile-helpers.ts:25-27`, `AddressDisplay.vue:68-90`, the unkeyed `v-for` at `contracts/index.vue:77`, the unkeyed `<component :is>` at `popup/app.vue:485-487`, and the mount-only load at `received/[id].vue:143-145`), and all matched.

| ID | Title | Severity | Coordinator confidence |
|---|---|---|---|
| B-11 | Lock during popup boot shows "startup failed" instead of the unlock form | Minor | high |
| B-12 | `importAccount` after a profile purge and `patchAccountField` after a chain purge write orphan rows | Minor | high |
| B-13 | Late recovery-phrase export starts timers after unmount and redirects 5 min later | Minor | high |
| B-14 | Config writes mutate memory before persisting; hidden Debug Mode after a failed cascade | Minor | high (mechanism) / low (likelihood) |
| B-15 | `updateFpcAddress` commits a stale snapshot | Minor | high |
| B-16 | Capability approval commits after session expiry | Minor | high |
| B-17 | Popup account/profile commits run callbacks after awaits without a scope fence | Minor | moderate |
| B-18 | Receipt polling mutates before `txs.set`; a failed write suppresses the retry | Minor | high |
| B-19 | Backup file-picker completions have no selection-generation fence | Minor | high (mechanism) / low (likelihood) |
| B-20 | Failed seed-marker read written back as `{}` erases tombstones | Minor | low |
| B-21 | Popup profile creation waits on `isLogined` forever after a failed bootstrap | Minor | high (mechanism) / moderate (likelihood) |
| B-22 | `AddressDisplay` renders only at mount; unkeyed contracts search shows wrong addresses | Minor | high |
| B-23 | Received-transfer page loads only on mount; "View" from a receipt page shows the old receipt | Minor | high |

## Final counts

23 findings: 0 Blocker · 0 Critical · 4 Major (B-01, B-02, B-03, B-05) · 19 Minor. B-04 moved from Major to Minor in this adjudication.
