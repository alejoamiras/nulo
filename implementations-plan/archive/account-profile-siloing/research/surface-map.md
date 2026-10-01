# Surface map — account-switch cross-account state leakage

Grounding artifact (Explore agent, file:line-verified against the worktree). Feeds the plan + audits.

## Central architectural fact

**No `watch` on `appStore.account` exists in `RecentActivityView.vue` or `activity.vue`.** The ONLY
reaction to an active-account switch in the popup is `apps/extension/src/popup/app.vue:87-96`:

```js
watch(() => appStore.account, () => {
    if (!appStore.account || !appStore.isLogined) return
    if (managers.transaction) { appStore.syncTransactions() }   // reloads appStore.transactions ONLY
})
```

`selectAccount` (`app.store.ts:71-76`) sets `account.value` + persists `nulo:ui:activeAccount` and
nothing else. The feed is mounted once (`general.vue:27`, `tokens/[id].vue:210`) with **no `:key`** on
the account → switching does NOT remount it → every view-local ref survives the switch, "corrected"
only by per-render account-scoped computeds (which are missing for two surfaces).

## Reactive state inventory (`RecentActivityView.vue`)

| State | Decl | Populated by | Account-scoped at render? |
|---|---|---|---|
| `executingTask` | :128 | onMounted getTasks :659; onExecutingTaskCreated/Updated :591/:600 | **NO** (orphan card) |
| `executingSubtasks` | :129 | task events | follows executingTask |
| `tokens` | :133 | loadTokens :137; onTokenAdded :145 | profile+chain, not account |
| `journalOps` | :202 | getOperations :665; onJournal{Added,Updated,Deleted} :522/:529/:536; resnapshot :556 | **YES** (`journalRecordInScope` :258) |
| `pendingCancelJobIds` | :253 Set | buildCancelHandler :254; cleared :483 | jobId-unique |
| `incomingTransfers` | `useIncomingTransfers.ts:52` | refresh :58; onAdded/Updated/Deleted :61/:66/:70 | **NO** (leak) |

`app.store.ts`: `account` :49, `accounts` :50, `awaitingTransactions` :129, `transactions` :130.
Switch mutators `setupActiveAccount` :55-70, `selectAccount` :71-76, `changeAccountVisibility` :77-92.
`syncTransactions` :153-157 reassigns `transactions.value`.

## Race windows

- **R1** journal mount snapshot: `getOperations({accountAddress: A})` :665 → on resolve `journalOps.value=…`
  with NO account re-check → B clobbered with A's records; `clearExecutingTaskIfRecentTerminalMatch()`
  :672 then runs against A's data.
- **R2** journal resnapshot on reconnect: same at :555-556, fired by `journalService.onConnected` :566.
- **R3** incoming refresh: `useIncomingTransfers.ts:55-59` captures `scope()` (A) then assigns after
  await, no re-check. AND `refresh` is never called on switch (not even destructured at :212).
- **R4 (CORE PRIVACY LEAK)** incoming live events: service polls **all** accounts (:414), broadcasts
  `onIncomingTransferAdded` to **all clients** with no recipient filter; composable `onAdded`
  (:61-65) appends **unconditionally**; render loop `recentActivityRows` :103-112 / `buildActivityRows`
  (`activity-rows.ts:62-73`) filters only by `props.token`, never by account. A tick for A paints into
  B's feed — even with no switch.
- **R5** executingTask mount replay: `isExecutingTask` :568 scopes UI transfers by `senderAddress===account`
  (:583) but does NOT scope dapp `ExecuteOperation` tasks (:571-580) → A's dapp task renders under B.
- **R6** executingTask live events: onExecutingTaskCreated/Updated set `executingTask` for any task
  passing (un-account-gated) `isExecutingTask`.
- **R7** `syncTransactions` out-of-order (`app.store.ts:153-157`): reassigns `transactions.value` with NO
  guard that `account.value` is still the requested one. `syncNetworkStatus` :110-119 DOES guard
  (`oldNetworkId !== network.value?.id` :116) — `syncTransactions` lacks the analogue.
- **R8** journal terminal-clear against stale account: `clearExecutingTaskIfRecentTerminalMatch()` :463 +
  `onJournal*` call `isMatchingTask(executingTask, op, appStore.account?.address)`; after a switch
  `executingTask` may be A's while active is B → false-clear / fail-to-clear (`recent-activity-handlers.ts:63-87`).

## Incoming-transfer emit path (end to end)

`EventHandler` broadcast over the messaging Port (NOT a store mutation). UI field = `incomingTransfers`
ref (`useIncomingTransfers.ts:52`).
1. Scheduler: one `setInterval` per `(networkId, accountAddress)` (`service.ts:376-378`, map :107).
   `hydrateSchedulers` :399-422 enumerates **all** accounts :414; called on init / onActiveProfileChanged
   :199 / onAccountAdded :203 / token add-del / clearProfile / clearChain. **NOT on UI account switch.**
2. Tick `poll` :555 → `scanContract` :574; `getNotesRaw` :586 unlocked; `epochAtStart = this.serviceEpoch` :580.
3. Per-note critical section :610-689 under `serviceLock`. Guard (:612-614):
   `if (this.serviceEpoch !== epochAtStart) return`. `serviceEpoch` bumped only by clear/delete/hydrate
   (`bumpServiceEpoch` at :400/:256/:516). **A UI switch bumps nothing** → guard never fires on switch.
4. Emit `onIncomingTransferPending` :658 / `onIncomingTransferAdded` :685 (+ setTrustAllow :324).
5. `emit` (`base-service.ts:128-132`) → broadcast to **every** connected client
   (`background/service.ts:84-93`), **no recipient filtering**.
6. Client :86-97 → local EventHandler (`incoming-transfer/client.ts:44-48`).
7. `onAdded` (`useIncomingTransfers.ts:61-65`) mutates `incomingTransfers.value`, **no account check**.

## What's correctly scoped vs what leaks

- Correctly scoped at render: journal rows (`journalRecordInScope` :258-267), `awaitingAccountTxs` :121,
  `isTokenAwaitingTx` :118.
- **Leaks:** incoming transfers (render loop unscoped, live-event path unscoped — the comment
  `activity-rows.ts:38-39` "already account-scoped at the service layer" is TRUE only for the initial
  load, FALSE for live events); orphan `executingTask` card (`hasOrphanExecutingTask` :427-431 never
  checks account).

## Account-scoping primitives that already exist

- `journalRecordInScope` (:258) — account+network+token gate, the correct primitive to generalize.
- `isMatchingTask` (`recent-activity-handlers.ts:77-87`) — `if (op.accountAddress !== activeAccount) return false`
  then kind+tokenId (transfer) / kind-only (dapp_execute). Scopes by *currently-active* account →
  mis-fires when `executingTask` belongs to the previous one.

## Test coverage + e2e helpers

- Unit: NONE cover switch isolation. `RecentActivityView.test.ts` mocks a fixed `account:{address:"0xacct"}`
  (:105). `useIncomingTransfers.test.ts` fixed scope account "a" (:25). `recent-activity-handlers.test.ts`
  has a pure-fn cross-account case (:109-110). `service.scenarios.test.ts` has account-lifecycle (:568-581)
  but no in-flight-tick-across-switch emit test. `app.store.test.ts` no switch-reset test.
- **e2e helpers EXIST**: `switchAccount(page, name)` (`helpers.ts:318-328`), `switchAccountByAddress`
  (:333-343), `createAccount` (:295-315), `getAccountAddress` (:287-292). Header trigger
  `data-testid="account-selector"` → `accounts-popup` → `account-item[data-account-name|address]`
  (`AccountsPopup.vue:63-74`). Used in `network/authwit-lifecycle.test.ts:123`.
- Gap: `accounts.test.ts` "switch between accounts" :47-77 asserts only storage changed + no errors —
  **no feed-isolation assertion**.

## Highest-signal fixes (Explore's summary)

1. Gate incoming by account: `useIncomingTransfers` `onAdded/onUpdated` (:61-69) + `recentActivityRows`
   incoming loop (:103-112) + `buildActivityRows` (`activity-rows.ts:62-73`); thread `accountAddress`,
   call `refresh()`/clear on switch. (R3, R4)
2. Add `watch(() => appStore.account)` in `RecentActivityView.vue` + `activity.vue` that clears
   `journalOps`/`executingTask`/`executingSubtasks`/`incomingTransfers`/`pendingCancelJobIds` + reloads,
   with a captured-account guard on each async resolution. (R1, R2, R5)
3. Gate orphan `executingTask` by account: `hasOrphanExecutingTask` :427 must require `executingTask`
   belongs to active account; account-scope the dapp branch of `isExecutingTask` :571-580. (R5, R6)
4. Account-capture guard in `syncTransactions` (`app.store.ts:153-157`) mirroring `syncNetworkStatus`. (R7)
