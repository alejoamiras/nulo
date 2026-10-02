# Harden Report: bugs

- **Repo:** nulo
- **Date:** 2026-09-30
- **Effort:** high
- **Run ID:** 2026-09-30-ext-high
- **Models:** Phase 1 map: Sonnet ×6 · Phase 2 scans: Claude Sonnet + Codex GPT-6 Astra xhigh per cluster · Phase 2.5 light cross-rebuttal, both directions · Phase 3 coordinator: Opus 5.5 · Phase 4 verifiers: Sonnet ×2 + Codex GPT-6 Astra xhigh · writer: Opus 5.5
- **Scope:** `apps/extension` + the 10 tracked `packages/*`. Excluded: `apps/landing`, `apps/playground`, infra, the untracked `apps/tools` + `packages/bridge-core` leftovers, generated and vendored files. Tests were read as evidence only.
- **Base:** `dev` @ `910a4def`

## Executive summary

The run found 23 correctness bugs: 0 Blocker, 0 Critical, 4 Major and 19 Minor. Nothing loses funds or corrupts the live wallet. The four Major findings all sit on the dApp and backup surfaces. **B-01**: a dApp that awaits `sendTx` is told "done" the moment the tx is broadcast, before inclusion, and never learns of a later revert or drop. **B-02**: an approval card read for more than two minutes cannot be confirmed if the dApp request needs a private authwit. **B-03**: `profileTx` fails for ordinary private calls because it omits `senderForTags`, which its two siblings pass. **B-05**: a full-backup export can silently mix two profiles if the user activates another profile in a second window mid-export. B-05 is rare, but the damage is a backup that reports success and then fails at restore, the worst moment to find out.

The Minor set is dominated by one family already seen on 2026-08-22: an identity captured before an `await` is committed after it without a fence (B-04, B-05, B-12, B-15, B-17). The cheapest wins are sibling asymmetries, where one twin already carries the guard and the other does not (B-03, B-06, B-08, B-09, B-12, B-17, B-21). Each is a one- to ten-line change that copies an existing helper. B-07 (closing an approval window reaches the dApp as a generic failure instead of "user rejected") is the most commonly hit Minor, because it also fires when a dApp request arrives while the wallet is locked and the user closes the lock screen.

Recommended order: (1) B-03, B-09, B-08 and B-06 together, since each is an afternoon and follows the same "copy the twin" pattern. (2) B-01 and B-02 as one dApp-send PR, since both must fit inside the SDK's 300 s call ceiling. (3) B-05 with an activation-sequence fence, not a profile-id compare. (4) B-07 and B-10 before the next store listing, since they are the most visible Minors. The remaining Minors can be batched by family (see Cross-cutting observations).

Stakeholder report: https://claude.ai/artifact/9XX4h4nrhZRAR2tSKvEZ4J (source: `report.html` in this directory; the same page covers both the quality and bugs runs)

## Methodology

**Shape.** Map-reduce, coordinator-of-specialists. Phase 1 mapped the repo (six Sonnet mappers, output in `raw/repo-map/`). Phase 2 scanned seven clusters, each with one Claude and one Codex agent working independently from the same brief. Phase 2.5 had each family rebut the other's cluster report. Phase 3, the coordinator, deduplicated by root cause, re-opened every disputed claim in source, and anchored severity to realistic likelihood. Phase 4 had two Claude verifiers and one Codex verifier re-derive the top 10 findings independently (own counter-example first, then compare). The writer adjudicated every verifier disagreement against source (`findings/verified.md`).

**Clusters** (built by state owner plus call graph):

| Cluster | Owner / call graph |
|---|---|
| b01-execution-send | execution pipeline, fee strategies, estimate reuse, journal, tasks, transactions, FPC |
| b02-profile-session-lifecycle | profiles, sessions, accounts, config, passkey, legal, session TTL and lock alarms |
| b03-backup-restore-migration | backup export/import/restore, storage migration, export pages |
| b04-incoming-balances-activity | incoming transfers, tokens, token balances, notes, activity rows |
| b05-dapp-ingress-approval | wallet-sdk background, dApp interaction/session, window manager, `wallet-bridge` dispatcher, approval windows |
| b06-network-pxe-transport | network, PXE, offscreen, Presto, `extension-messaging`, `wallet-core` locks and jobs |
| b07-popup-boot-state | popup shell, boot/guard helpers, stores, `PopupManager`, send/auth/onboarding pages |

**Context cap.** Each agent traced at most about four functions of inter-procedural context inside its cluster. It could cross a cluster boundary only along a handoff edge (service client → background handler, bus request → offscreen handler, emit → listener, alarm → handler, popup registry → component, composable ← disposing parent), reading the target's signature and its one immediate handler.

**Negative list** (not reported): security issues (routed separately), style, strict-TS-catchable type errors, "could be cleaner" suggestions without a counter-example, behaviour documented as intentional (including `(BUG PIN)` tests unless the impact exceeds the pin), test/demo/fixture/migration code that is not production-wired, framework defaults without a concrete failure, dead-code claims, quality concerns, and absurd-scale scenarios (the owner's realistic-scenarios rule). Every finding needed a counter-example, a violated invariant and a file:line failing path; low-confidence items were not reported.

**Deviations, stated honestly:**

- One Claude and one Codex agent per cluster, as specified.
- The bugs clusters were built by state owner plus call graph (7 clusters) and reused the concurrent quality run's repo map instead of a dedicated bugs map.
- The Claude cluster scans ran concurrently with the quality run.
- Quality-run incidental bugs were triaged in a separate addendum (`findings/addendum-quality-incidentals.md`), because the bugs coordinator ran before the quality coordinator finished. The addendum added B-21, B-22 and B-23. B-21 and B-22 came from those leads, and B-23 is a coordinator discovery made while checking B-22's consumers. These three were not in the Phase 4 top 10.
- 23 findings exceed the ~1.2 per cluster density target (about 8 expected). Codex at xhigh found roughly twice as many as Claude Sonnet, and the cross-rebuttals confirmed most of them, so the set was not trimmed to hit a quota.
- Only the top 10 were independently verified. B-11 to B-23 carry coordinator confidence only; each finding below says which.

## Findings

Sorted by severity, then by realistic likelihood. IDs are stable from `findings/consolidated.md`.

### B-01: [Major] dApp `sendTx` ignores its wait options and returns one immediate receipt

- **Impact:** Major
- **Confidence:** high · independently verified (Claude + Codex agree)
- **Mapping:** wrong result
- **Found by:** Claude + Codex
- **Instances:** `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:754,757` (standard), `:935,938` (NO_FROM); pinned without a `(BUG PIN)` by `dapp-send-executor.test.ts:436-460`
- **Description:** The upstream contract (`@aztec/wallet-sdk` `BaseWallet.sendTx`) waits for inclusion unless the caller passes `NO_WAIT`, honours `waitForStatus`/`timeout`/`dontThrowOnRevert`, and throws on revert. Nulo's executor branches only on `NO_WAIT`, then reads the receipt once, straight after broadcast.
- **Trace:** `packages/wallet-bridge/src/dispatcher.ts:1133-1149` returns the executor result unchanged → `dapp-send-executor.ts:754` (`NO_WAIT` test) → `:757` single `node.getTxReceipt` → PENDING, or DROPPED on a lagging load-balanced replica.
- **Why it matters:** This is the default path for every dApp that awaits `.send()`. The dApp proceeds before any block exists, and a revert or drop never reaches it. It is already known in `implementations-plan/any-erc20-bridge/lessons/phase-10.md`, where one consumer works around it.
- **Recommended fix:** One shared helper for both arms that calls upstream `waitForTx(node, txHash, opts)`, passing `op.opts.wait` through when it is an object and keeping `NO_WAIT` immediate. Cap the timeout below the SDK's 300 s call ceiling, and reuse `TransactionService.waitForTx`'s DROPPED debounce (`transaction/service.ts:237`) for replica lag. Keep "confirmation timed out" distinct from "not submitted".
- **Effort estimate:** M (1–2 days, both arms plus tests)

### B-02: [Major] The 120 s preview snapshot is shorter than the approval's life, so authwit-bearing dApp sends hard-fail at Confirm

- **Impact:** Major
- **Confidence:** high · independently verified (Claude + Codex agree; effort settled at M)
- **Mapping:** bad retry-or-timeout (lifetime mismatch)
- **Found by:** Claude (Codex confirmed)
- **Instances:** `apps/extension/src/wallet/services/execution/preview-snapshots.ts:30,52,74`; `estimate-reuse-shared.ts:29`; `dapp-send-executor.ts:413-421,704-719,1031`; `apps/extension/src/popup/windows/execute/index.vue:689-698` (`:confirm-disabled`)
- **Description:** The authwit preview snapshot ("never sign a witness the card did not show") shares the reuse cache's 120 s TTL, but the approval window lives 10 min and the SDK call 300 s. After two minutes, `take` returns `missing`, the rebuild rediscovers the authwit, and `assertWithinPreview` throws "Fee estimate did not complete — retry the estimate" after the window has already closed. A second trigger needs no wait: Confirm is not disabled while a re-estimate is in flight, so a click inside the 500 ms debounce after a priority change sends no `previewId`.
- **Trace:** `preview-snapshots.ts:52` (`missing`) → `dapp-send-executor.ts:704-705` (no `reuseId`) → `:719` → `preview-snapshots.ts:74` throws; NO_FROM at `:1031`. Interaction timeout: `dapp-interaction/service.ts:62`.
- **Why it matters:** Any dApp that needs a private authwit from the user (a DEX or escrow calling `transfer_in_private`) fails terminally for a user who reads carefully. Ops without discovered witnesses are unaffected.
- **Recommended fix:** Give `PreviewSnapshots` its own `SingleShotTtlCache` of at least `INTERACTION_TIMEOUT_MS`, drop the `builtAt` age check in `take`, and evict on interaction settle so it survives hand-off and queueing. Keep 120 s on the reuse cache. Disable Confirm (and guard the handler) while `estimatingOps[i] || previewingOps[i]`.
- **Effort estimate:** M (about a day)

### B-03: [Major] `profileTx` omits `senderForTags`, so profiling ordinary private calls throws

- **Impact:** Major
- **Confidence:** high · independently verified (Claude confirmed; Codex partial, scope narrowed)
- **Mapping:** bad error path (feature broken), sibling asymmetry
- **Found by:** Codex (Claude confirmed)
- **Instances:** `packages/aztec-runtime/src/pxe/service.ts:621-623`; entry `apps/extension/src/wallet/services/execution/view-executor.ts:403-407`
- **Description:** `proveTx` (`service.ts:501`) and `simulateTx` (`:584`) pass `senderForTags: scopes[0]`, and the file's own comment (`:481-490`) says 5.x fails without it. `profileTx` passes only `{profileMode, skipProofGeneration, scopes}`. The PXE oracle returns `None`, and the Noir note-delivery code then throws whenever it needs the default sender. That covers Token `transfer_to_private` and private transfers; calls with an explicit sender override are not affected (Codex correction).
- **Trace:** `view-executor.ts:403-407` → `packages/aztec-runtime/src/pxe/client.ts:300` → `service.ts:621-623` → upstream `pxe.ts:1138` → `private_execution_oracle.ts:195` (`None`) → `messages/delivery/mod.nr:150-152` throws.
- **Why it matters:** A whole dApp RPC (`aztec_profileTx`, used for gate counts and gas estimation) is broken for common private calls. Send and simulate are fine.
- **Recommended fix:** Add `senderForTags: scopes[0]` at `service.ts:621-623`, parsed as the siblings do, and pin it with a unit test next to the proveTx/simulateTx pins.
- **Effort estimate:** S (2–4 hours)

### B-05: [Major] Full-backup export is not bound to one profile; activating another profile mid-export yields a checksum-valid mixed backup

- **Impact:** Major
- **Confidence:** high on mechanism, low on likelihood · independently verified (Codex: Critical; Claude: Minor; writer: Major)
- **Mapping:** silent corruption (latent), race
- **Found by:** Codex (Claude reversed its own non-finding in rebuttal)
- **Instances:** `apps/extension/src/popup/pages/settings/security/export/full.vue:193,295,296,375`; `apps/extension/src/utils/full-backup-helpers.ts:137-151`; slices that resolve the active profile at call time: `wallet/services/profile/service.ts:2249`, `account/service.ts:664,750`, `token/service.ts:847`, `token-balance/service.ts:663`, `transaction/service.ts:508`, `auth-registry/service.ts:487`, `contact/service.ts:68,276`, `account-state/service.ts:206` (under `apps/extension/src/`)
- **Description:** Key material is fetched for profile A by explicit id, but every data slice then calls `backup()` with no profile argument and reads whichever profile is active. `SessionManager.open` can replace A with B directly (`profile/session-manager.ts:318-338`), and `popup/app.vue:198-218` re-bootstraps without unmounting the export page, so its only fence (an unmount generation) passes. The filename reads B's name at download.
- **Trace:** `full.vue:193` (A's material) → `:295` parameterless slices → `full-backup-helpers.ts:137` → `account/service.ts:750` (`requireActiveProfile` → B) → `full.vue:296` generation-only probe → sealed with a valid checksum.
- **Why it matters:** The export reports success. The file then carries A's keys with B's rows, and at restore imported accounts without keys are dropped (`account/service.ts:837-858`) and the mixed rows fail or restore partially. The user learns the backup is bad only when they need it. It is Major rather than Critical because the realistic trigger is deliberate concurrent multi-window work: the toolbar popup closes on blur, so the export must run in a detached popup window while the user finishes creating or restoring another profile elsewhere within the seconds of assembly.
- **Recommended fix:** Capture an activation sequence (bumped on every `onActiveProfileChanged`, or the session serial) at start, make the `onSlice` probe `gen === generation && seq === startSeq`, and capture the filename at start. Do not compare profile ids at the end, which misses an A→B→A switch. The durable fix passes the captured profile id to each `backup()` and has services reject a mismatch.
- **Effort estimate:** S (frontend fence) · M (service-bound id)

### B-07: [Minor] Closing an approval window before its `beforeunload` hook exists reaches the dApp as an unclassified failure instead of 4001

- **Impact:** Minor
- **Confidence:** high · independently verified (Claude + Codex agree; Claude broadened it)
- **Mapping:** wrong result (error classification)
- **Found by:** Claude + Codex
- **Instances:** `apps/extension/src/wallet/services/window-manager/window-manager.ts:259`; listener install at `apps/extension/src/composables/useDappApprovalWindow.ts:118-121,124`; affected interactions at `apps/extension/src/wallet/services/dapp-interaction/service.ts:432,441`
- **Description:** Only the page's `beforeunload` → `reject()` RPC turns a close into `UserRejectedError`. It is installed after the session wait, after `init()`, and never on the locked path (which redirects to auth and returns first). Otherwise `windows.onRemoved` rejects with the bare string "Window closed by user.", which the envelope maps to the generic wallet failure.
- **Trace:** `window-manager.ts:156,259` → `dapp-interaction/service.ts:466-493` → `wallet-sdk/background.ts:1211-1216` → `wallet-sdk/error-envelope.ts:197`.
- **Why it matters:** Closing an approval window is a normal way to say no, and the locked-wallet variant is common. dApps then show error UI or retry instead of treating it as a refusal.
- **Recommended fix:** Add an optional `onUserClose?: () => Error` to `OpenAndAwaitOpts`. The dApp interaction passes `() => new UserRejectedError("Window closed by user.")`, and the passkey caller (`passkey/service.ts:119`) keeps its string. Update the `.rejects.toMatch` tests.
- **Effort estimate:** S (2–4 hours)

### B-22: [Minor] `AddressDisplay` renders its address only at mount, so an unkeyed list shows the wrong addresses after a search

- **Impact:** Minor
- **Confidence:** high · not independently verified (coordinator confidence; writer spot-checked)
- **Mapping:** wrong result (display)
- **Found by:** Codex (quality-run lead; coordinator supplied the reachable consumer)
- **Instances:** `apps/extension/src/components/AddressDisplay.vue:68-90`; consumer `apps/extension/src/popup/pages/settings/advanced/account-state/contracts/index.vue:77,83` (no `:key`); at-risk index-keyed lists `apps/extension/src/popup/windows/execute/OperationCard.vue:240-255`, `CallArguments.vue:75-84`
- **Description:** `displayedAddress` and the contact name are derived from `props.address` inside `onMounted`, with no watch. When the contracts search filters `[C1, C2, C3]` to `[C3]`, Vue patches row 0 in place and it keeps showing C1.
- **Trace:** `contracts/index.vue:27-29,68,77,83` → `AddressDisplay.vue:68-90`.
- **Why it matters:** A search result names the wrong contract. It is a developer-facing settings page today, but the same component renders authwit consumers in the approval window (routed to security as a possible wrong-spender display).
- **Recommended fix:** Make `displayedAddress` a `computed`, resolve the contact name in `watch(() => props.address, …, {immediate: true})` with a latest-wins guard, and add `:key="contract"` (and `:key="sender"` on the senders list).
- **Effort estimate:** S

### B-23: [Minor] The received-transfer page loads only on mount, so "View" from a receipt page keeps showing the previous receipt

- **Impact:** Minor
- **Confidence:** high · not independently verified (coordinator discovery; writer spot-checked)
- **Mapping:** wrong result (display)
- **Found by:** Claude (coordinator)
- **Instances:** `apps/extension/src/popup/pages/received/[id].vue:143-181`; same shape, no current trigger: `apps/extension/src/popup/pages/tx/[id].vue`
- **Description:** On receipt A, a new arrival shows the "Received … · View" snack (`composables/useArrivals.ts:106-108`). View pushes `/popup/received/B`. `<RouterView>` renders `<component :is>` with no key (`popup/app.vue:485-487`), so the page instance is reused, `onMounted` does not rerun, and nothing watches `route.params.id`.
- **Trace:** `useArrivals.ts:365` → `popup/app.vue:90,485-487` → `received/[id].vue:143-145`.
- **Why it matters:** The URL says B while the amount, sender and token show A. The user may read A's amount as B's.
- **Recommended fix:** Move the load into a function keyed by `route.params.id`, run it from `watch(() => route.params.id, load, {immediate: true})` with a latest-wins token, and reset per-id state. Alternatively, key this route's component by the param.
- **Effort estimate:** S

### B-09: [Minor] `getNodeStatus` lacks the local-kind carve-out, so an edited Local Network reads `InvalidChain` and is left out of backups

- **Impact:** Minor
- **Confidence:** high · independently verified (Claude + Codex agree)
- **Mapping:** wrong result, sibling asymmetry
- **Found by:** Claude + Codex
- **Instances:** `apps/extension/src/wallet/services/network/service.ts:734`
- **Description:** `probeNodeStatus` (`:751-753`) and endpoint edits (`:600,647`) treat a `local` network's wallet chain id as 0 whatever its URL. `getNodeStatus` calls `_getChainId(url)` without the kind hint, so after moving Local Network to another port it gets the XOR composite and reports `InvalidChain`.
- **Trace:** `network/service.ts:734` → `:996-1010` → `:735`; consumers `apps/extension/src/stores/app.store.ts:495-499` (status dot) and `apps/extension/src/wallet/services/account-state/service.ts:101,221-228` (backup skips that chain's contracts and senders, warn-logged).
- **Why it matters:** A developer using a custom local port sees a false red status, and their full backup quietly lacks that chain's recovery data.
- **Recommended fix:** `_getChainId(primary.rpcUrl, network.kind)`, or share the `effective` computation with `probeNodeStatus`.
- **Effort estimate:** S (1–3 hours)

### B-10: [Minor] Queued incoming-trust prompts open on the lock screen and drain with no decision applied

- **Impact:** Minor
- **Confidence:** high · independently verified (Claude + Codex agree; Claude broadened it)
- **Mapping:** state invariant violation, lost update
- **Found by:** Claude + Codex
- **Instances:** `apps/extension/src/popup/components/popups/PopupManager.vue:76-101,177-180,196-199,293-298`; `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:103-110`
- **Description:** Lock closes all popups without clearing the profile/network/account triple. The close watcher then dequeues the next trust prompt, with no login check, over the lock screen. Allow or Block is refused by the service fence (returns `false`), the prompt closes, and the queue drains. After unlock the stale `replayedForKey` suppresses replay, even for a single prompt closed by the lock.
- **Trace:** `popup/locked-state.ts:19-27` → `PopupManager.vue:293-298` → `:76-101` → `IncomingTrustPopup.vue:103-110` → `incoming-transfer/service.ts:620-638,680-681`; unlock: `composables/useProfileBootstrap.ts:56,71` → `PopupManager.vue:196-199,177-180`.
- **Why it matters:** Auto-lock with pending tokens shows a prompt that ignores the user's choice, then forgets it until the popup reopens. The service correctly refuses the decision, so there is no security impact.
- **Recommended fix:** Gate ingress, dequeue and replay on `appStore.isLogined`, reset `replayedForKey` on lock, and replay once the unlocked triple is ready. Do not keep `false`-result prompts open universally: `false` also means a deleted token, and it would be a visible UI change needing owner sign-off.
- **Effort estimate:** S (4–6 hours)

### B-21: [Minor] Popup profile creation waits for `isLogined` forever after a failed bootstrap

- **Impact:** Minor
- **Confidence:** high on mechanism, moderate on likelihood · not independently verified (coordinator confidence; writer spot-checked)
- **Mapping:** bad error path (hang), sibling asymmetry
- **Found by:** Codex (quality-run lead, Claude confirmed)
- **Instances:** `apps/extension/src/popup/pages/profile/new-profile-helpers.ts:25-27`
- **Description:** `activateCreatedProfile` loops `while (!appStore.isLogined) await sleep(100)`. If the new profile's bootstrap throws (a worker restart rejecting an in-flight RPC, or a failed default-account or network init), `runFencedBootstrap` records `bootstrapFailure` and toasts, but `isLogined` never flips.
- **Trace:** `popup/pages/profile/new.vue:66` → `new-profile-helpers.ts:25-27`, while `popup/app.vue:199-214` → `popup/profile-bootstrap.ts:23-26` records a failure nothing on this path reads; latch at `composables/useProfileCreateFlow.ts:103-104`.
- **Why it matters:** "Creating…" spins forever and the page accepts no input; only closing the popup recovers. The unlock path's `awaitProfileActivation` (`composables/unlockWait.ts:32-60`) is already bounded and releases on `bootstrapFailure`.
- **Recommended fix:** Replace the loop with `await awaitProfileActivation(appStore, profile.id, <bound>)`; on `BootstrapFailedError`/`UnlockTimeoutError`, reset `isCreating` and surface the error.
- **Effort estimate:** S

### B-08: [Minor] `OperationEstimateReuse.tryConsume` lets a transient fee-read error abort the send instead of rebuilding

- **Impact:** Minor
- **Confidence:** high (defect), moderate (reach) · independently verified (Claude + Codex agree)
- **Mapping:** bad error path, sibling asymmetry
- **Found by:** Claude + Codex
- **Instances:** `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:141,159-166`; lower likelihood, same shape: `transfer-estimate-reuse.ts:182,196` (`getNetwork`/`getNode`)
- **Description:** The cached entry is consumed first (`:129`), then `predictedWorstMinFees` runs with no catch. It deliberately rethrows a transient "block not found" (`packages/aztec-runtime/src/fee-juice.ts:25-32`), which escapes and skips the rebuild. The transfer twin catches the same call and rejects softly.
- **Trace:** `dapp-send-executor.ts:718,794` → `operation-estimate-reuse.ts:129,161` → rebuild at `dapp-send-executor.ts:833` bypassed.
- **Why it matters:** A node blip at Confirm fails an approved send after the popup has closed. The rebuild reads the same fee milliseconds later, so the fallback only helps when the blip clears in between.
- **Recommended fix:** Wrap only `:159-166` in try/catch returning `this.reject(...)`, as `transfer-estimate-reuse.ts:196-210` does. Keep `SessionEndedError` a throw.
- **Effort estimate:** S (2–4 hours)

### B-11: [Minor] A lock during popup boot turns a lock-induced bootstrap rejection into "startup failed" and hides the unlock form

- **Impact:** Minor
- **Confidence:** high · not independently verified (coordinator confidence)
- **Mapping:** race, bad error path
- **Found by:** Codex (Claude confirmed)
- **Instances:** `apps/extension/src/popup/reconcile-locked-boot.ts:39-40`; `apps/extension/src/popup/boot-session.ts:57-60`; `apps/extension/src/popup/apply-boot-outcome.ts:42-44`
- **Description:** The lock event routes to auth, then a bootstrap RPC rejects with "Wallet locked". `resolveBootSession` maps it to `failed`, and the event-seq supersession check applies only to `locked` results, so `bootOutcome = failed` wins and `auth.vue` hides the password/passkey form behind a failure banner.
- **Trace:** `popup/app.vue:311-324` → `boot-session.ts:57-60` → `reconcile-locked-boot.ts:39-40` → `apply-boot-outcome.ts:42-44` → `popup/pages/auth.vue:63,248`.
- **Why it matters:** A false "startup failed" on the unlock screen; one Retry recovers. It needs a lock inside the roughly one-second boot.
- **Recommended fix:** Apply the event-seq supersession check to `failed` outcomes too, settling retry bookkeeping as `event-superseded` does.
- **Effort estimate:** S

### B-13: [Minor] A late recovery-phrase export response starts countdown timers after unmount and redirects the user 5 min later

- **Impact:** Minor
- **Confidence:** high · not independently verified (coordinator confidence; Codex reproduced it with fake timers)
- **Mapping:** resource leak, wrong navigation
- **Found by:** Codex (Claude confirmed)
- **Instances:** `apps/extension/src/popup/pages/settings/security/export/seed.vue:55,63,79`; `apps/extension/src/composables/useSecretCountdown.ts:26,50`
- **Description:** Navigating back before the KDF-bound `exportMnemonic()` resolves disposes the countdown, then the continuation calls `countdown.start()`, arming timers that are never cleared. Five minutes later `handleClose()` pushes the export route wherever the user is. `full.vue` has the unmount fence; `seed.vue` does not.
- **Trace:** `seed.vue:59` → `:79` (unmount) → `useSecretCountdown.ts:50` → `seed.vue:63` → `useSecretCountdown.ts:29` → `seed.vue:46`.
- **Why it matters:** An unexplained jump to the export settings page five minutes later.
- **Recommended fix:** An unmount-generation check after the RPC in `handleUnlock`, and make `start()` a no-op after dispose.
- **Effort estimate:** S

### B-04: [Minor] A lock or profile switch during the balance-outbox drain deletes the sole refresh marker, leaving the balance stale

- **Impact:** Minor
- **Confidence:** high on mechanism, low on likelihood · independently verified (Codex: Major; Claude: Minor; writer: Minor)
- **Mapping:** lost update, race
- **Found by:** Codex (Claude confirmed)
- **Instances:** `apps/extension/src/wallet/services/incoming-transfer/service.ts:357,1065,1307,2230,2259,2274,2296`; `apps/extension/src/wallet/services/token-balance/service.ts:238-247,455-472`; no repair at `token-balance/reconcile-pairs.ts:145`
- **Description:** The drain captures the profile once. A lock clears `TokenBalanceService.tokens` synchronously, so `requestBalanceRefresh` reports `{missing:true}` for a pair that exists, and the drain deletes the only durable refresh marker. `isCurrent()` checks lock ownership, not profile identity.
- **Trace:** `incoming-transfer/service.ts:2230` → `:2259` → `:2296` → `token-balance/service.ts:238-247` → `incoming-transfer/service.ts:2274` delete.
- **Why it matters:** A just-received amount can be missing from the displayed balance. An immediate unlock does not heal it, since unlock only refreshes balances at least 30 min old (`apps/extension/src/utils/core.ts:148-167`). Opening the token page, the Tokens menu Refresh, the next settled tx, or a later unlock does. The trigger is a lock inside a drain's few storage awaits while an unanchored row exists; after unlock the poll's network scan runs before the drain, so the post-unlock race does not occur in practice.
- **Recommended fix:** Have `requestBalanceRefresh` return a retryable result (or throw, which `requestRefreshOrKeep` already keeps) when `this.profile` is unset or the map is mid-rebuild, by capturing `profileGeneration`. Optionally re-check the active profile before the delete.
- **Effort estimate:** S

### B-06: [Minor] A cleared task registry makes `WrappedTask` settlement throw, so a broadcast tx can go unrecorded

- **Impact:** Minor
- **Confidence:** high · independently verified (Claude: Minor; Codex: Major; writer: Minor, Codex's symptom correction adopted)
- **Mapping:** bad error path, lost update, sibling asymmetry
- **Found by:** Claude + Codex
- **Instances:** `apps/extension/src/wallet/services/task/wrapped-task.ts:25-35`; `apps/extension/src/wallet/services/execution/execution-coordinator.ts:271,273,303,309,355`; `rpc-cancel.ts:78,81`; `transfer-executor.ts:216,225`; `execution/service.ts:702`
- **Description:** A switch to a different profile clears the task registry (`task/service.ts:241`), after which `complete/fail/cancel` throw `Invalid task id` (`:177-181`). If the switch lands while `node.sendTx` is in flight, `task.complete()` throws after the broadcast, `task.fail()` throws again, and `recordTransaction` never runs. The dApp does not see the error: the old session is terminated (`wallet-sdk/profile-switch-teardown.ts:121-145`) and late responses are suppressed (`wallet-sdk/background.ts:1235-1246`).
- **Trace:** `task/service.ts:241` → `execution-coordinator.ts:302-303` → `:309` → `:355` skipped.
- **Why it matters:** A sent tx with no activity row for its profile. The chain, the journal (via `SendCheck`) and the balance are right. It needs a profile activation completed in a second surface during one send RPC.
- **Recommended fix:** `WrappedTask.complete/fail/cancel` become no-ops when `!this.exists`, following `transaction/service.ts:250`. Keep `TaskService`'s strict APIs.
- **Effort estimate:** S (3–6 hours)

### B-16: [Minor] Capability approval commits and reports success after the session has expired

- **Impact:** Minor
- **Confidence:** high · not independently verified (coordinator confidence)
- **Mapping:** wrong result
- **Found by:** Codex (Claude confirmed)
- **Instances:** `apps/extension/src/wallet/services/dapp-session/service.ts:343`; caller `packages/wallet-bridge/src/dispatcher.ts:1362`
- **Description:** `applyCapabilityDecision` checks row existence only. An approval clicked after expiry persists the grant and returns `granted`; the dApp's next call finds the session expired and fails.
- **Trace:** `dispatcher.ts:1355-1371` → `dapp-interaction/service.ts:228,435` → `dapp-session/service.ts:343,380` → next call at `:164,399`.
- **Why it matters:** "Granted" then an immediate refusal; it self-heals on reconnect.
- **Recommended fix:** Check `expiry` inside `applyCapabilityDecision`'s existing lock before mutating (not via the lock-taking `isExpired()`).
- **Effort estimate:** S

### B-12: [Minor] Account writers outside the deletion fence and row lock: `importAccount` after a profile purge, `patchAccountField` after a chain purge

- **Impact:** Minor
- **Confidence:** high · not independently verified (coordinator confidence)
- **Mapping:** race, state invariant violation (orphan rows), sibling asymmetry
- **Found by:** Claude + Codex
- **Instances:** `apps/extension/src/wallet/services/account/service.ts:469,493,499,513-519` (import); `:303,307,320-327` (patch); unlocked deletes at `:154-156,633,852`
- **Description:** (a) `importAccount` awaits PBKDF2 plus key encryption with no lock or deletion epoch; if the profile is deleted meanwhile, it writes an orphan key and Account row. `createAccountInternal` (`:249-284`) has the fence. (b) A rename reads an imported account under its row lock while a chain purge deletes it without that lock; the rename writes it back, so after the chain is re-added the account is visible but signing fails with "signing key missing".
- **Trace:** (a) `account/service.ts:487,493,499,513` vs `profile/service.ts:1486,1512`. (b) `account/service.ts:320-327` vs `:154-156` via `network/service.ts:538`.
- **Why it matters:** Orphan sealed-key rows for an erased profile (a privacy-erasure promise), or a resurrected unusable account. Needs a second window acting within a short window.
- **Recommended fix:** (a) Capture `deletion.capture(profileId)` before the first await and `assertCurrent` inside the tuple lock before both writes, committed together. (b) Take the per-row lock in `clearChainState`/`purgeForProfile`, or re-read inside the lock in `patchAccountField` and treat a missing row as gone.
- **Effort estimate:** S

### B-17: [Minor] Popup account/profile commits run captured callbacks after awaits without a scope fence

- **Impact:** Minor
- **Confidence:** moderate · not independently verified (coordinator confidence)
- **Mapping:** race, state invariant violation, sibling asymmetry
- **Found by:** Codex (Claude partial)
- **Instances:** `apps/extension/src/popup/pages/auth.vue:200-209`; `apps/extension/src/popup/route-guard.ts:47-52`; `apps/extension/src/stores/app.store.ts:252-258,396-398`; `apps/extension/src/popup/components/popups/AccountsPopup.vue:37`; `apps/extension/src/popup/pages/settings/accounts/index.vue:40`; `apps/extension/src/popup/components/popups/NewAccountPopup.vue:80-82`; `apps/extension/src/popup/components/popups/SelectProfilePopup.vue:53-55`; `apps/extension/src/utils/guarded-network-activation.ts:62-64,76-78`
- **Description:** (a) `auth.vue`'s mount assigns the remembered profile A after awaiting `getProfiles()`, after another window has activated B. (b) `commitScopeChange` awaits a journal refresh, then runs the captured `selectAccount(A2)` under profile B. `commitAccountTarget` checks `superseded()` (`app.store.ts:439`); `commitScopeChange` does not.
- **Trace:** (a) `auth.vue:200-209`, `route-guard.ts:47-52`. (b) `AccountsPopup.vue:37` → `app.store.ts:252-258,295` → `:376-380`.
- **Why it matters:** A mismatched profile or account in the store, and a persisted `nulo:ui:activeAccount` for the wrong profile, until the next event.
- **Recommended fix:** Drop the redundant assignment in `auth.vue` (boot owns it), fence `lateDecision` across its awaits, and give `commitScopeChange` the same captured-epoch check as `commitAccountTarget`.
- **Effort estimate:** S

### B-15: [Minor] `updateFpcAddress` commits a pre-validation snapshot, undoing a concurrent rename or resurrecting a deleted FPC

- **Impact:** Minor
- **Confidence:** high · not independently verified (coordinator confidence)
- **Mapping:** lost update, race
- **Found by:** Codex (Claude conceded)
- **Instances:** `apps/extension/src/wallet/services/fpc/service.ts:330,375-377`
- **Description:** The row is snapshotted before the PXE validation await and upserted as `{...existing, address}` afterwards. A rename or delete from another window in between is reverted or undone. `updateFpc` and `deleteFpc` re-read inside the lock.
- **Trace:** `popup/components/popups/EditFpcPopup.vue:118` → `fpc/service.ts:330` → `:350-364` → `:375-377`.
- **Why it matters:** Cosmetic or user-deletable; the rename silently reverts.
- **Recommended fix:** Re-read inside the final lock, reject if missing, and merge only `address`.
- **Effort estimate:** S

### B-19: [Minor] Backup file-picker completions have no selection-generation fence

- **Impact:** Minor
- **Confidence:** high on mechanism, low on likelihood · not independently verified (coordinator confidence)
- **Mapping:** race
- **Found by:** Codex (Claude partial)
- **Instances:** `apps/extension/src/composables/useFullBackupImport.ts:621,637,659,664,922,953`; picker at `apps/extension/src/components/composite/import/ImportFullBackupForm.vue:58,64`
- **Description:** If backup A's read is still pending when the user picks B, enters B's password and starts the restore, A's late completion reverts the selection to A, resets `restoreStatus` and clears the passwords, reopening the re-entry guard at `:717`.
- **Trace:** `ImportFullBackupForm.vue:58,64` → `useFullBackupImport.ts:621-624,636-637,659-662,717`.
- **Why it matters:** A restore could be started twice. Size-capped reads take milliseconds and the OS picker is modal, so the whole sequence must fit inside one read.
- **Recommended fix:** A pick-generation token checked after each await; disable pick and submit while a read is pending.
- **Effort estimate:** S

### B-14: [Minor] Config writes mutate memory before persisting; a failed write makes the retry report success, and the Developer Mode cascade can persist a hidden Debug Mode

- **Impact:** Minor
- **Confidence:** high on mechanism, low on likelihood · not independently verified (coordinator confidence)
- **Mapping:** wrong result, state invariant violation
- **Found by:** Codex (Claude confirmed in rebuttal)
- **Instances:** `apps/extension/src/wallet/config/store.ts:61-66,93-98`; `apps/extension/src/wallet/services/config/service.ts:50-55,74`; `apps/extension/src/popup/pages/settings/advanced/index.vue:108-127,140-144`
- **Description:** (a) `set` updates memory and emits before `storage.set`; if the write rejects, a same-value retry hits the equality shortcut and resolves without writing, so the setting reverts on SW restart. (b) Turning Developer Mode off persists it, but the un-awaited child `debugMode:false` write can fail, leaving debug logging on disk with its toggle hidden.
- **Trace:** (a) `config/service.ts:50-51` → `config/store.ts:61-66`. (b) `advanced/index.vue:108-127` → `store.ts:64-66` → `wallet/logger/store.ts:27`.
- **Why it matters:** A false "saved"; debug-level logging with no visible control after restart. Both need a `chrome.storage.local.set` rejection; any later successful config write heals (b).
- **Recommended fix:** Persist a staged copy first, then swap memory and emit. Await the cascade or write `{developerMode, indicateFailures, debugMode}` in one `setValues`.
- **Effort estimate:** S

### B-18: [Minor] Receipt polling mutates the pending object before `txs.set`, so a failed write suppresses the retry

- **Impact:** Minor
- **Confidence:** high on mechanism · not independently verified (coordinator confidence)
- **Mapping:** state invariant violation
- **Found by:** Codex (Claude confirmed)
- **Instances:** `apps/extension/src/wallet/services/transaction/service.ts:463,478,486,495,498`
- **Description:** `updateTx` sets `tx.status` on the object held in `pending`, then `txs.set` rejects once; every later poll sees an equal status at `:463` and returns early.
- **Trace:** `transaction/service.ts:375` → `:478-479` → `:486` → `:463`.
- **Why it matters:** Durable history stays Pending, the tx never enters the resurrection watch, and waiters time out until a worker restart. Needs a transient storage failure.
- **Recommended fix:** Build the next state, persist it, then swap maps and emit.
- **Effort estimate:** S

### B-20: [Minor] A failed seed-marker read is turned into `{}` and written back, erasing other tokens' deletion tombstones

- **Impact:** Minor
- **Confidence:** low · not independently verified (coordinator confidence; Claude calls it a defensible trade-off)
- **Mapping:** silent corruption (conditional)
- **Found by:** Codex
- **Instances:** `apps/extension/src/wallet/services/token/seeder.ts:277-279,337-342,524,535-538,683-686`
- **Description:** `readMarkerState` swallows a read error as `{}`, and mutators write the whole blob back, so deleting USD Coin during a failed read drops Clean USDC's tombstone and the next seed pass re-adds it.
- **Trace:** `token/service.ts:604` → `seeder.ts:301,337` → `:683-686` → `:342`.
- **Why it matters:** A token the user deleted reappears. Needs a `get` rejection followed by a successful `set`.
- **Recommended fix:** Let mutators see read errors; keep the reset-to-empty only for malformed shape.
- **Effort estimate:** S

## Findings NOT pursued (with reasoning)

- D-01 `-32005 TOO_MANY_PENDING` never reaches the dApp: documented and pinned (`rpc-cancel.ts:82-90`, `rpc-cancel.test.ts:110`); the contradicting docs (`execution-lane.ts:331`, `errors.ts`) need fixing, not the code.
- D-02 approval-window 10-min timeout half of B-07: moot, since the SDK's 300 s ceiling expires first.
- D-03 LogsViewer 500 ms fetch race: a designed step-down retry in a Developer-Mode-only viewer; no wrong result.
- D-04 `exportMnemonic` legacy error string: every rejection is treated as wrong password; nothing matches on type.
- D-05 error-class identity lost over RPC: no cross-RPC consumer discriminates on class, and messages survive.
- D-06 `commitScannedNote` missing epoch re-check: runs under the service lock; no destructive interleaving shown.
- D-07 `parseNoteAmount` negative or hex input: input is always a u128 `toString()`; unreachable.
- D-08 `setActiveNetwork` with no primary endpoint: no normal writer produces such a row, and the next `getNode` fails loudly.
- D-09 `BalanceView.onBalanceAdded` no dedupe: the Added emitter sends zero balances; no fiat double-count.
- D-10 `RevokeAuthwitsPopup` `feeSetting` typo: every reader is truthiness-based; quality item.
- D-11 export filename separators: every name entry path sanitizes them.
- D-12 passkey Encrypt hides the recommendation: an intentional transition.
- D-13 `SecretUnlockSection` global classes: no broken page; coupling only.
- D-14 `incomingRows` lacks `isForeignProfile`: ingest is scoped with a synchronous reset.
- D-15 `mint_to_commitment` titled "Mint": a category label, not a wrong amount.
- D-16 `grantPublicAuthwit` inside a raw batch: only a schema-bypassing raw client reaches it, and the popup still gates.
- D-17 `queued-journal.ts:143` no chain filter: no normal writer creates a mixed-chain session row.
- D-18 design `AddressDisplay` copy timer: dead component.
- D-19 light-theme divider colour: visual, routed to quality.
- D-20 `integrity.ts` dead base64 catch: still fails closed.
- D-21 `ActivityProtocolCoordinator` lock race: no production importer.
- D-22 node HTTP envelope exceeds the 90 s offscreen timeout: delay only; the orphaned reads are idempotent.
- D-23 Claude's export-slices non-finding: superseded by B-05.
- QB-05 `changeProfileName` on a tombstoned row: pinned by a `(BUG PIN)`; the profile is hidden from every UI.
- QB-11 `RecentActivityView` reconnects ports after unmount: two leaked ports until the popup closes; no wrong result.
- QB-13 `SelectFpcPopup` double client: dead, since nothing opens `select_fpc`.
- QB-14 json/logger windows skip `onClose`: the lock that navigates away also closes the window.
- QB-18 `connected-apps/[id].vue` clients never disconnected: listener-free port leak freed on popup close.
- QB-22 LogsViewer editor never prunes: Developer-Mode window shows more history, not wrong history.
- QB-23 LogsViewer clear failure drops the log stream: toast shown; reopening restores it.
- QB-24 LogsViewer document listeners survive unmount: the window's document dies with the component.
- QB-26 onboarding applies `"system"` theme: a one-frame cosmetic flash on the next popup paint.
- QB-29 `useDappApprovalWindow` re-adds `beforeunload` after dispose: the interaction is already settled by then.
- QB-30 `EventHandler.invoke` iterates the live array: the only in-dispatch removal is a sole listener; latent, routed to quality as hardening.
- QB-33 third-party-notices collector on watch rebuild: only `dev:firefox` watches; release builds are one-shot.
- QB-34 design `Popover` listeners after unmount: sole consumer is the logger window, whose document dies with it.
- QB-39 console-sniffer replays buffered lines at the wrong level: diagnostic fidelity only, during synchronous module evaluation.

Routed to security (not findings here): `patchAccountField` row-transplant, unvalidated `sessionTtl`, lost proactive auto-lock alarm on a failed refresh persist, non-constant-time `array_equals` on secret-derived bytes, `verifiedClassIds` keyed by class id only, trust-prompt metadata disclosure over the lock screen (B-10's disclosure half), `resolveInteraction` not checking interaction kind, and the approval-window authwit rows rendered through the non-reactive `AddressDisplay` under index keys (B-22's security half).

## Cross-cutting observations

1. **Captured identity committed after an `await` is still the dominant family.** B-04, B-05, B-12, B-15 and B-17 all capture a profile, row or scope, await, and write without re-checking. The existing fences cover *page* lifetime (unmount generations) but not *profile or scope* identity. A shared compare-and-commit helper carrying `{profileId, activationSeq}`, checked immediately before each write or callback, would close these by construction. B-05 shows why it must be a sequence and not an id: an A→B→A switch passes an id compare.

2. **Sibling asymmetry is the cheapest bug source to sweep.** Seven findings are a guard present on one twin and missing on the other:

   | Guarded twin | Unguarded twin | Finding |
   |---|---|---|
   | `proveTx` / `simulateTx` | `profileTx` | B-03 |
   | `probeNodeStatus` | `getNodeStatus` | B-09 |
   | `TransferEstimateReuse` | `OperationEstimateReuse` | B-08 |
   | `createAccountInternal` | `importAccount` | B-12 |
   | `commitAccountTarget` | `commitScopeChange` | B-17 |
   | `waitForTx`'s `task.exists` | `WrappedTask` | B-06 |
   | `awaitProfileActivation` (unlock) | `activateCreatedProfile` (create) | B-21 |

   When a fix lands, grep for its twin in the same PR.

3. **Mutate-before-persist plus an equality shortcut turns one failed write into a permanent silent no-op** (B-14, B-18). Adopt stage, persist, then swap and emit.

4. **Mount-only derivation in reused components** (B-22, B-23, and the same shape in `tx/[id].vue`). The popup's `<RouterView>` does not key by route, and several lists are unkeyed or index-keyed, so any component that derives state in `onMounted` shows stale data when Vue reuses it. Derive from props or params reactively, and key lists by identity.

5. **Error identity at the dApp boundary is inconsistent.** A user close is unclassified (B-07), and the `TOO_MANY_PENDING` docs promise a code the pinned channel never carries (D-01). One table owns what reaches the dApp (`error-envelope.ts` + `ridesCodeChannel`); every documented dApp-facing code should be in it or deleted from the docs.

6. **Lifetime mismatches between cooperating timers.** B-02 pairs a 120 s snapshot with a 300 s SDK call and a 10-min interaction; B-01's fix must fit a bounded wait inside the same 300 s; B-10's replay key outlives a lock. When one side's lifetime is set, check the other side in the same PR.

7. **Recurrence vs 2026-08-22 and 2026-08-16.** The N-03, N-08, N-10 and 08-16 B-26 families each resurfaced on an unfixed sibling or neighbouring path (B-12, B-11/B-17, B-04, B-10). No previously fixed finding regressed at its original site; the prior fixes B-02, B-03, N-07 and N-16 were re-verified as holding.
