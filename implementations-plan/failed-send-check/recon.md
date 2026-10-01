# Recon: failed-send-check

Read at `48a97f4a` (the head of #718: `dev` `a7b1ff62` plus #718) and re-read after round 1 at
`f32b1e0a` (`dev` after #718; the same tree). #719 (merged as `85c4d20f`) was read for its Firefox record
(`implementations-plan/e2e-reliability-fixes/lessons/phase-6.md:76-87` and the `follow-ups.md`
entry that folds S2 into S1); it touches none of the code cited below. `git diff --stat origin/dev...origin/fix/send-amount-exact` edits
`AmountCard.vue`, `amount-field.ts`, `send-amount.ts`, `FeeCostReadout.vue` and their tests, and
also `popup/pages/send.test.ts` (which this plan re-pins) and the shared `implementations-plan/`
files (`follow-ups.md`, `index.md`, `lessons.md`): whichever merges second rebases.

## Reuse map

| Capability needed | Existing code (file:line at `48a97f4a`) | Verdict |
|---|---|---|
| The tx hash of a send, known before the broadcast | `ExecutionCoordinator.proveAndSend` journals `{ stage: "submitting", txHash }` before `sendTxTask` (`apps/extension/src/wallet/services/execution/execution-coordinator.ts:340-344`); the only four callers are `transfer-executor.ts:161` and `dapp-send-executor.ts:595`, `:709`, `:885` | adapt: the same patch also carries the endpoint URL, and it is written through a fail-closed `commitSubmitting` |
| A journal write the send can depend on | both closures swallow a failed transition (`transfer-executor.ts:113-121`, `execution-lane.ts:487-493`); the underlying `transitionOperation` throws (`operation-journal/service.ts:330-340`); both paths already refuse a send with no row (`transfer-executor.ts:132-136`, `claim-helper.ts:157`) | adapt: a `commitSubmitting` context member bound to the unswallowed transition; `ExecutionLane.commitJournal` beside `markJournal` |
| The endpoint a send used | every caller already computes `primaryEndpointUrl(network)` for its activity row (`transfer-executor.ts:200`, `dapp-send-executor.ts:524`, `:908`; helper `apps/extension/src/wallet/services/network/spec.ts:106-108`) | reuse-as-is: pass the same value into the `submitting` patch |
| Keeping the hash through `failed` | none: `_transitionLocked` replaces `progress` wholesale (`apps/extension/src/wallet/services/operation-journal/service.ts:357-363`); `JobProgress`'s failed variant has no field (`packages/wallet-core/src/jobs/types.ts:71`, zod `operation-journal/spec.ts:187`) | adapt: carry `txHash` and `submittedEndpointUrl` from `submitting` inside `_transitionLocked`, so every writer (transfer catch, dApp lane, reaper) gets it |
| A writer that changes a field inside a stage | `updateProvingBackend` re-reads under the transition lock and writes only while the stage still holds (`operation-journal/service.ts:414-432`) | adapt: `setSendCheck` follows the same shape for `failed` |
| Reading a receipt on the submitting endpoint only | `NetworkService.getNodeForUrl` never falls back to the active profile (`apps/extension/src/wallet/services/network/service.ts:772-802`), `reportEndpointFailure` (`:804-809`); `TransactionService.updateTx` uses them (`apps/extension/src/wallet/services/transaction/service.ts:439-455`) | reuse-as-is |
| Late-mine window and cadence | `DROPPED_RESURRECTION_WINDOW_MS`, `DROPPED_RECHECK_INTERVAL_MS` (`transaction/service.ts:50-56`) | reuse the two constants. The DROPPED debounce (`DROPPED_GRACE_MS`, `DROPPED_CONFIRMATIONS`, `trackDroppedStreak` `:411-427`) is NOT reused: DROPPED also means "this replica has not seen the hash" (`:37-49`), so the check never turns it into an answer |
| Session and deletion fencing for background work | `ProfileService.captureExecutionFence` / `isFenceLive` (`apps/extension/src/wallet/services/profile/service.ts:521-532`, `:548-554`), used by `fenceChecks` (`execution-coordinator.ts:143-152`) | reuse-as-is: one fence per tick, combined with the watcher's generation and the tracked entry into one guard after every await and inside the write; a refused write keeps the row tracked |
| Telling a lost port from a failure | `isClientDisconnectRejection` (`packages/extension-messaging/src/errors.ts:111`), matching the plain `Error("Client disconnected")` the Port client rejects with (`background/client.ts:80-96`) | reuse-as-is in the snack |
| Keeping a sender's own notes out of "Received" | `IncomingTransferService.collectInflightTxHashes` reads non-terminal journal rows only (`incoming-transfer/service.ts:2403-2417`) | adapt: also read failed rows' hashes |
| Aztec receipt status → wallet status | `getTxStatus` / `getTxExecutionResult`, private to `TransactionService` (`transaction/service.ts:508-540`) | adapt: move to exported pure functions beside the service, both consumers call them |
| A background loop that survives a closed popup | `TransactionService.runWorker` (1 s loop, skips while no profile is active, `transaction/service.ts:366-385`); `JournalReaper` is armed in `armPostStartWork` and its one-minute alarm wakes a closed-popup worker (`apps/extension/src/wallet/runtime.ts:607-645`, the comment at `:639-641`) | build new: `SendCheck`, a runtime component beside the reaper (not a Service), armed in the same function. Justification: no existing loop reads journal rows, and folding journal logic into `TransactionService` would couple two storage services that today do not know each other |
| Resume after a background restart | the reaper's boot sweep reads `getOperations({ isTerminal: false })` (`operation-journal/reaper.ts:180-218`); `TransactionService.init` re-arms Pending rows only, because a Dropped row's URL can come from a backup restore (`transaction/service.ts:115-125`); strict security mode is the default (`apps/extension/src/wallet/config/config.ts:26`) and persists no session bearer, and outside it only a password profile with a DEK gets one (`profile/session-manager.ts:300`) | adapt: `SendCheck.start()` scans failed rows and tracks every unresolved one inside its window; the reads resume once the profile is unlocked, which after a restart usually means the next unlock; the journal is not in backups, so the backup restriction does not apply |
| When a send counts as "went through" | `TransactionService.waitForTx` settles once the hash leaves the pending queue (`transaction/service.ts:223-237`); the watcher stops polling a mined tx (`:490-503`); `@aztec/stdlib` 5.2.0 has four mined statuses, `PROPOSED` to `FINALIZED` (`src/tx/tx_receipt.ts:22-42`), and a mined receipt requires `executionResult` (`:285`) | reuse the rule: the check answers at inclusion too; a prune after inclusion is caught by neither path (plan F-4) |
| Refreshing balances once a send is known to have landed | `TokenBalanceService.refreshAccountBalances` (`apps/extension/src/wallet/services/token-balance/service.ts:253`), today driven by `onTransactionUpdated` (`:604-621`) | reuse-as-is |
| Per-method RPC ceiling | `BaseServiceClient.getRequestTimeoutMs` (`packages/extension-messaging/src/core/base-client.ts:109`, `:353-357`); the PXE client overrides it for `proveTx` (`packages/aztec-runtime/src/pxe/client.ts:72`, `:100-108`) | reuse the hook: override it in `ExecutionServiceClient` (`apps/extension/src/wallet/services/execution/client.ts:13-17`) |
| Failure snack copy | `submitTransfer`'s catch (`apps/extension/src/popup/pages/send-submit.ts:85-95`), `transferFailureCopy` (`apps/extension/src/popup/utils/transfer-failure-copy.ts:10-13`), `detailsAction` already reads the failed record (`send-submit.ts:114-122`) | adapt: pick the sub from the record it already reads |
| Failure copy on the card and the journal page | `journalTerminalDisplay`, `categoricalLabel`, `failedSubtitleFor` (`apps/extension/src/utils/journal-state.ts:64-90`, `:185-229`, `:232-253`) | adapt: an outcome step before the kind switch |
| Success and pending visuals | `TransactionCard` uses `check-circle` green, `clock-circle` gray, `close-circle` red (`apps/extension/src/popup/components/modules/activity/TransactionCard.vue:76-86`); all three names are in `packages/design/src/internal/icons.json` | reuse-as-is; `TransactionTerminalCard` gains a `green` subtitle class beside `gray`/`amber`/`red` (`apps/extension/src/components/composite/activity/TransactionTerminalCard.vue:89-95`) |
| Live row updates in the popup | `RecentActivityView` and `activity.vue` already apply `onOperationUpdated` (`RecentActivityView.vue:567-568`, `activity.vue:99-100`); `journal/[id].vue` listens only for deletion (`apps/extension/src/popup/pages/journal/[id].vue:204-211`) and applies its scope predicate in `loadOp` (`:185-201`) | adapt: the journal page reloads through `loadOp` on an update for its id, so the scope predicate applies to every update |
| A lost-response proof without a sandbox | `execution/service.composition.test.ts` drives the real executor, coordinator and journal with a canned `proveTx` / `toTx` and a fake node `sendTx` (`:106-112`) | adapt: one more case, a `sendTx` that rejects after being called, then a real `SendCheck` |
| A held proof for e2e | `holdProofGate` / `releaseProofGate` (`apps/extension/tests/e2e/fixtures/proof-gate.ts`), auto-release after 20 s (`apps/extension/src/e2e/chrome-storage-proof-gate.ts:19`); `waitForSendRecord`, `readSendRecords` (`apps/extension/tests/e2e/fixtures/journal.ts:69`, `:91`); `LEGAL_ACCEPTANCE_KEY` (`packages/legal/src/status.ts:3`) | reuse-as-is |

Search trail for the absences: `rg "getTxReceipt"` finds `transaction/service.ts:449` (the only
poller), `dapp-send-executor.ts:741` and `:919` (one-shot reads after a send),
`incoming-transfer/service.ts:538` (a fee lookup for a known record) and
`auth-registry/service.ts:404` (a proven-tip wait); `rg "stage: \"failed\""` lists every
failed writer (`transfer-executor.ts:215`, `mark-failed-unless-cancelled.ts:29`, `execution-lane.ts:332`,
`:366`, `claim-helper.ts:168`, `dapp-interaction/service.ts:568`, `reaper.ts:202`, `token/service.ts:445`,
`wallet-sdk/queued-journal.ts:260`), and none keeps a hash; `rg "getRequestTimeoutMs"` finds only
the PXE override.

## Conventions to match

- A runtime component beside the reaper and the GC: constructor-injected services, `start()` /
  `stop()`, armed with zero awaits in `armPostStartWork` (`runtime.ts:598-606` states the order pin;
  `stop()` clears it like the reaper, `runtime.ts:164-175`).
- Journal writes under `transitionLock`, re-read inside the hold, emit `onOperationUpdated`
  (`operation-journal/service.ts:56-80`). A new load-then-write path must take the lock.
- The popup reaches the journal read-only and only for the active profile (`service.ts:119-131`,
  `spec.ts:363-371`); events go only to the active profile's ports (`service.ts:137-141`). The new
  writer stays in-process.
- Log at `debug` with named properties; the redaction walker scrubs `submittedEndpointUrl` to its
  origin by key (`apps/extension/src/wallet/logger/utils.ts:132`); a `txHash` is never logged above
  `debug` and never whole (TransactionService logs `hash.slice(0, 8)` at debug, `transaction/service.ts:430`).
- Copy constants live next to their helper and tests import them (`TRANSFER_FAILED_COPY` pattern).
- e2e: testids only, `@requires-proverless` for a held proof, retry 0.

## Collision and dedup risks

- `journal-state.ts` is also in `copy-polish`'s em-dash sweep (the interrupted context and
  `failedSubtitleFor`'s two dashed strings). This plan rewrites the interrupted context and writes
  every new string without a dash; `copy-polish` should rebase over it.
- `send-states` edits Send's fee card and token card; this plan does not touch `send.vue`
  (the ceiling lives in the client) and edits only `send-submit.ts` and `transfer-failure-copy.ts`.
- `TransactionService` is refactored only by extraction (its two private status mappers
  become exported functions); `service.dropped.test.ts` must stay green unchanged.
- The `failed` shape change is cross-package (`packages/wallet-core/src/jobs/types.ts` and the zod
  mirror). Pre-production: no migration (CLAUDE.md § Persisted-storage shape changes).
- The Terms wall's pin (`apps/extension/src/wallet/services/legal/call-sites.test.ts:29-40`) forbids
  any line between `assertLive()` and `node.sendTx`; nothing here edits `sendTxTask`. The
  fail-closed `submitting` write sits in `proveAndSend`, before `sendTxTask` is called.
- `TransactionTerminalCard.vue:3-28` and `journal/[id].vue:10-35` carry history-heavy header
  comments (milestone tags, "cousin of", restructure notes); both files are touched, so both
  headers are cut to their ownership and scope invariants.
