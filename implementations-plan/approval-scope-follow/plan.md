# Approval scope follow

The execute window names the scope a transaction runs in, and takes the wallet there after you confirm.

```yaml
driver: claude-code
tier: mid
eli5_mode: artifact
eli5_url: https://claude.ai/artifact/9hbMQqUuJuhmWVzmBgWfYv   # rev 6 republish (2026-09-17); the two earlier artifacts were deleted on claude.ai
code_review: off      # owner's standing directive — the codex fix loop is the review
harden: not scheduled # Phase 0 touches a guard; its own tests + the codex loop cover it
revision: 6           # rev 1 rejected (codex); rev 2 cond. approved (fable); rev 3 cond. approved (codex r2); rev 4 rejected (codex r3, fresh); rev 5 rejected (codex r4, fresh); rev 6 drafted 2026-09-17 after the prerequisite merged; see §Decision ledger
status: approved      # rev 6 approved by the owner 2026-09-17 ("approved.") after D7 and the ELI5 republish; Ask 3 (the Send-screen refusal copy) still open — blocks the execution PR only
```

## Summary

A dApp's transaction executes in the scope the dApp pinned — its chain, its signer account — which
has nothing to do with where the wallet happens to be looking. When the two differ, the user
confirms, the window closes, and the wallet shows a feed scoped somewhere else: no pending row, no
balance move. It reads as a failed transaction.

The fix is one informational `Banner` in the execute window naming the difference, and a **follow**:
on a successful approval, before the window closes, the wallet's two durable scope pointers are
written to match the transaction, so the next time the wallet is opened it is looking at the right
place. A single text action declines the follow.

The audits found that following the transaction walks the user into a scope where the dApp's own
queued journal records live, which would freeze account/profile/network switching (§Phase 0). The
freeze is narrowed to the wallet's own sends, which are the only ones it ever protected.

UX approved by the owner on 2026-09-16 (see `eli5_url`): info tone only, no checkbox, opt-out
present, follows **network and signer account**. Owner decisions from the audit round are in
§Decision ledger.

**Rev 6 (2026-09-17).** The prerequisite `profile-fenced-execution` (PRs #610/#611) has merged:
every send runs under the fence of the session that authorized it, a session end cancels the sends
it authorized, and the lock button asks before it cancels. That plan hands this one four follow-ups,
which rev 6 absorbs alongside the codex round-4 findings:

1. **The popup that locked keeps stale in-flight rows** — the lock-screen profile picker refuses
   every pick until the popup is reopened (measured in that plan's Phase 6), and a same-profile
   unlock leaves the Send freeze holding the stale row (read statically). Phase 0.
2. **The `utils/in-flight-send.ts` header** describes a guard that no longer exists in that form.
   Phase 0.
3. **Authwit signing is outside the fence** — `aztec_createAuthWit`, popup-approved or silent, reads
   no fence and signs after awaited work. Phase 5.
4. **A send whose journal record cannot be created runs unregistered** — Phase 5 (D7).

## Scope

**In**

- **Phase 0**: narrow the in-flight-send guard to wallet-origin sends (`utils/in-flight-send.ts`);
  reset the popup's in-flight cache when its session ends and re-read it on unlock
  (`stores/app.store.ts`); rewrite the guard's header for the guard that exists after the
  prerequisite.
- **Phase 5**: sign authwits under the authorizing fence (`execution/service.ts`,
  `executeAztecCreateAuthWit`).
- The execute window: a banner over two axes (chain, account), and a post-approval write of the
  active-network and active-account pointers.
- A guarded write on the storage facade, `storageLocalSet(items, { unless })`, so the follow's
  account write is fenced *inside* the facade's barrier (codex r4 #1).
- Compare network **rows** (`network.id`), not chain ids — the feed keys on `networkId` (Fact 22).
  `capabilities/chain-mismatch.ts` stays where it is; its `chainId` comparison is the wrong key here.
- Unit + component + two network e2e tests, smoke, `audit:vue`.

**Out**

- The capabilities window's pre-approval switch — unchanged in behaviour; only its import path moves.
- The wallet's own send flow — it snapshots the active scope into its arguments (`send.vue:333`) and
  stays guarded.
- Cross-scope activity (surfacing another chain's transactions in the current feed).
- **Live propagation into an already-open wallet view.** No such mechanism exists (Fact 4);
  building one is a different change. See §Known limitations.
- The pre-existing gap where bootstrap can select a hidden account (Fact 9). This plan must not
  *aim* at one; fixing the general case is separate work.
- An after-the-fact "your wallet moved" notice. Owner decided (ledger D2) that the banner's
  announcement before Confirm is sufficient.

## Known limitations (deliberate, owner-visible)

- The follow writes durable pointers. It does **not** move a wallet view that is already open — the
  extension has no cross-realm scope propagation. In practice the approval window takes focus, which
  closes the browser-action popup, so the next open reads the new pointers. A wallet page open in a
  *tab* keeps showing the old scope until reloaded.
- After a follow, the wallet's active account is the one the dApp's transaction used, so the next
  manual Send defaults to it. Owner-accepted (ledger D2): the user confirmed a transaction as that
  account seconds earlier and the banner said the wallet would move there.
- Two network rows on one chain is **not a supported configuration** — `NetworkService` refuses a
  second row for a chain at creation (`network/service.ts`, `ERR_DUPLICATE_CHAIN`). The row
  comparison is defensive: a delete-and-recreate can leave records stamped with a row id that no
  longer exists, and comparing rows rather than chain ids keeps the feed's key and the banner's key
  the same one. If two rows ever coexist, the dApp's operations and journal records carry the first
  row for the chain (`queued-journal.ts:165-166`, `wallet-bridge/src/caip.ts:64-70`), and a wallet
  viewing the second sees a `chain` mismatch naming both. (Rev 4 compared chain ids; codex r4 #4.)
- **The two pointer writes are not atomic — concurrent follows are serialized, other writers are not.**
  Every follow runs inside `navigator.locks.request("nulo:scope-follow", …)`, so two approval windows
  confirming at once land as two complete pairs, last pair wins. What the lock cannot cover: a popup
  bootstrapping (`setupActiveAccountRun` → `accounts[0]` fallback) or a manual switch landing
  *between* the two writes still yields a pair nobody chose (network Y, account X). The user's next
  switch repairs it; nothing signs or moves without a further approval. Owner-accepted (ledger D5).
  **A Web Lock is released when its holder terminates**: a window closed or crashed between the two
  writes leaves the same partial pair, and the next window's follow proceeds normally — while a
  worker RPC the dead window had already dispatched (`setActiveNetwork`) still completes on its own,
  after the lock is gone. The lock orders concurrent follows; it does not make a pair atomic and it
  does not cancel work in flight. `closeWindow(true)` stays after the awaited lock so the common
  path never closes mid-pair (codex r4 #3, r5 #3). Verification is split by what each layer can see:
  the unit test with a queued `navigator.locks` mock pins the app's ordering; Phase 4's
  lock-contention step holds the real lock from another extension page and observes the follow
  pending behind it (`navigator.locks.query()`), then completing on release — live proof that the
  lock is a real cross-realm lock the follow contends for. Non-interleaving itself is not observable
  in the e2e harness (one chain, Fact 15: two concurrent follows can only differ on the account
  axis, and a complete pair and an interleaved one then look the same), and holder termination
  between the two writes has no deterministic trigger without test-only hooks, so both stay
  documented rather than exercised.
- **Persistence failures are indeterminate and there is no rollback.** `setActiveNetwork` persists
  before it refreshes the node handle and emits, so an RPC rejection can arrive after the durable
  write landed; the account write can likewise fail after the network write succeeded. The account
  pointer is then left as it was: a network failure before the durable write leaves the old chain;
  one after it leaves the new chain with the remembered account, which the next open keeps if it
  exists there and otherwise replaces with that chain's first account (`setupActiveAccountRun`) —
  degraded, not corrupt, self-correcting on the next switch. A blind rollback could overwrite a
  newer selection, so none is attempted. The network write itself is decided under the lock from
  the live row, not from the view the window resolved earlier: a follow that ran first may have
  moved the wallet, and an account written under another follow's chain is exactly the mixed pair
  the lock exists to prevent (codex arc 2 #1).
- **`origin === "popup"` means the popup Send, not "every wallet-initiated send".** The lane journals
  the wallet's own auth-registry revoke/enable sends as `origin: "dapp"` (`execution-lane.ts`);
  Phase 0 releases their freeze too. Safe for account/network (they carry explicit identifiers); the
  profile axis is no longer this plan's to guard — every send is bound to its authorizing session
  by the prerequisite (Fact 25), and Phase 0 pins that with one consumer test.
- **The in-flight cache reset on lock is a UI cache reset, not a journal truth.** A send the sweep
  leaves alone (already `submitting`, Fact 27) is gone from the popup's rows after the lock even
  though its record is still non-terminal for a moment. The Send freeze it protected was against
  scope changes *in that popup*, which the lock has already invalidated; the executor never reads
  the popup's cache. The re-read on unlock restores the truthful set before any scope change is
  attempted.
- **A read's snapshot can overwrite a newer event (pre-existing, every refresh).** `getOperations`
  answers from a storage read inside the worker; an update landing between that read and the reply
  emits its event first (same port, FIFO), and the older snapshot then replaces it. The window is
  the worker's storage latency; the row's next event corrects it, and a snapshot landing after the
  row's terminal event leaves a stale refusal until the next profile change, reconnect or lock
  (`commitScopeChange` does not re-read past its cached refusal). The unlock read is the one
  refresh this plan adds, and a `submitting` send outlives the lock's sweep, so that read re-reads
  when an event moved the rows while it was pending (codex arc-1 round 3). The profile-change,
  reconnect and `commitScopeChange` reads keep the window they always had; merging by `updatedAt`
  in the tracker's publish is the fix if it ever bites, out of this plan's scope.
- **Batch padding is dearer, not impossible.** A dApp can no longer force `multi-signer` with a free
  `aztec_createAuthWit` on a second account; it still can with a second *send-like* operation on a
  second account, which costs it a real transaction (and need not succeed). Multi-signer ambiguity is
  then genuine, and the banner names the chain only.

## State machine

**Sessions are single-chain.** `checkMethodPermission` (`dapp-interaction/service.ts:578-593`) throws
`"Unauthorized method/chain"` for any operation whose chain differs from `session.chainId`, so every
operation in a payload shares one chain — and, in a stable profile, one **row**: every operation's
`network` is `resolveNetworkByChainId(...)`, the first row for that chain, which is also the row the
dApp's journal records are stamped with (`queued-journal.ts:165-166`); a profile holds one row per
chain (`ERR_DUPLICATE_CHAIN`, §Known limitations). The chain axis is therefore the boolean
`ops[0].network.id !== appStore.network?.id` — row identity, the exact key the activity feed filters
on (`activity.store.ts:97`), so a row deleted and recreated under the popup's snapshot reads as a
mismatch rather than as silent agreement. There is no multi-chain state.

**Signers.** `uniqueSignerAccounts(operations)` — the window's existing notion, the same one feeding
`SignerIdentityStrip`, so the banner can never disagree with the strip. Operations with no account
contribute nothing here. The **follow account** is the single signer when there is exactly one; when
there are several, it is the single *send-like* signer (`aztec_sendTx` / `send_transaction`) if
exactly one exists. This closes the griefing path where a dApp pads a batch with a cheap
second-signer read (`aztec_createAuthWit`, `simulate_utility`) to suppress the follow and have the
banner reassure the user that "your wallet stays where it is".

| Chain differs? | Signers | Follow account? | State | Follows |
|---|---|---|---|---|
| no | 0 or 1 matching active | — | none | nothing |
| **yes** | any | resolved | `chain` | network + account |
| **yes** | many, no single send-like | none | `chain` (names chain only) | network only |
| no | 1, ≠ active | resolved | `account` | account |
| no | many, single send-like ≠ active | resolved | `account` | account |
| no | many, no single send-like | none | `multi-signer` | nothing |

Declining flips `chain` → `chain-declined` and `account` → `account-declined`; both keep the `info`
tone and drop the follow. Window-local, never persisted.

**Active scope unresolved.** `appStore.network` / `appStore.account` populate asynchronously in the
execute realm (`useProfileBootstrap`). Until both are known the resolver returns `undefined` and no
banner renders — first paint must not claim a mismatch that isn't, or hide one that is.

**Hidden signer.** When the follow account's row is not `visible`, the account half is skipped and the
banner names the chain only (a hidden account is never named or aimed at).

### Copy (owner-approved)

| State | Title | Body | Action |
|---|---|---|---|
| `chain` | `Runs on {opChain}` | `Your wallet is on {account} · {chain}. It switches to {opAccount} · {opChain} after you confirm, so you can watch the transaction.` | `Stay on {chain}` |
| `chain-declined` | `Runs on {opChain}` | `Your wallet stays on {account} · {chain}. This still executes — you just won't see it in your balances or activity.` | `Switch after confirming` |
| `account` | `Signed by {opAccount}` | `Your wallet is on {account}. It switches to {opAccount} after you confirm, so you can watch the transaction.` | `Stay on {account}` |
| `account-declined` | `Signed by {opAccount}` | `Your wallet stays on {account}. This still executes — you just won't see it in your balances or activity.` | `Switch after confirming` |
| `multi-signer` | `Signed by {n} accounts` | `{names}. Each operation is signed by its own account; your wallet stays where it is.` | — |

When there is no follow account, `chain` names chains only. When no operation sends (`readOnly`), the
trailing "so you can watch the transaction" is dropped (ledger D3). Names are the rows' own
`Network.name` / `Account.name` — a user's rename reads back as their own label.

## Architecture & Implementation

### Proposed architecture

0. **The guard**, `apps/extension/src/utils/in-flight-send.ts`: `isInFlightSend` additionally
   requires `op.origin === "popup"`. `origin` is a required top-level field on every journal record
   (`operation-journal/spec.ts`: `"popup" | "dapp" | "seed"`). Every consumer — `commitScopeChange`,
   `useNetworkActivation`, `NewAccountPopup`, `NewNetworkPopup`, and since the prerequisite the lock
   button's `approvedSendsInFlight` count — reads the store's computeds over these predicates.
   `isApprovedSendInFlight` (the lock dialog's and the auto-lock deferral's predicate) is **not**
   narrowed: a lock cancels dApp sends too, so they must keep counting there. The header is
   rewritten: the guard no longer exists because a send "reads the active profile and account while
   it builds" (the fence binds it now, Fact 25); it exists because the *popup transfer* snapshots
   the popup's active scope into its arguments (`send.vue`), and only the popup's own view can
   change that scope under it. Cancelling clears the guard through the journal event, and the lock
   path (below) clears it directly.
0b. **The cache reset**, `apps/extension/src/stores/app.store.ts` (the in-flight tracker): the
   tracker's rows are a per-popup cache of the journal, refreshed only when `profile.id` changes
   (Fact 27), and the sweep's cancel events never reach a locked popup (Fact 28). A lock does not
   change the profile (`enterLockedState`, Fact 26), and neither does unlocking
   the same profile, so the rows a lock cancelled stay in the cache and `commitScopeChange`'s
   cached short-circuit refuses every scope change in that popup. Fix, in two explicit calls
   beside the ones that already exist: `enterLockedState` calls `appStore.resetInFlight()` next to
   `appStore.clearActivity()` — rows emptied, tracker *ready* (a locked popup has nothing in flight
   to protect, the sweep has cancelled it, and `!ready` would fail closed and refuse the picker
   exactly as before); the two unlock sites in `useProfileBootstrap.ts` (`:171`, `:195`, the only
   writers of `isLogined = true`) lower `ready` and call `refreshInFlight()`, because a same-profile
   unlock changes no `profile.id` and `commitAccountTarget`'s fast path never refreshes. The picker's
   `commitScopeChange` then passes its cached check, runs its unconditional `refreshInFlight()`
   (`:215`), which the locked worker answers with `[]` (Fact 33), and admits the pick; a same-profile
   unlock reads the truthful set before the Send screen consults it. No change to
   `commitScopeChange`, to the selector, or to the freeze's predicate: this is the cache's
   lifecycle, made explicit at the same sites as the activity cache's. (`Header.vue:26` and
   `reset.vue:86` also flip `isLogined` before their lock RPC; both reach `enterLockedState` through
   the lock event, so the reset lands there, once.)
   **Late reads.** `refreshInFlightOps` discards a finished read only when `profile.id` moved
   (`app.store.ts:271-273`); a lock moves nothing, so a read started before the lock — the lock
   button's own `readForLock` (`Header.vue:33-42`) is one, and it keeps running after its 3 s budget
   expires — can land *after* `resetInFlight()` and put the cancelled rows back, re-arming the
   refusal for good; symmetrically, a read issued while locked can land after the unlock refresh
   and blank it (codex r5 #2). So the tracker carries a read generation: `resetInFlight()` and the
   unlock refresh bump it, every read captures it at issue, and a read that finishes under another
   generation writes nothing — success or error. `commitScopeChange`'s own refresh is unchanged;
   this is the same stale-answer rule the tracker already applies to profile changes, extended to
   the two new lifecycle edges.
1. **No chain resolver is promoted.** `capabilities/chain-mismatch.ts` compares chain ids, which is
   right for a session grant and wrong for a feed keyed on `networkId` (Fact 22). Execute already
   holds each operation's resolved row (`op.network`); the row *is* the answer.
2. **The scope resolver**, colocated: `apps/extension/src/popup/windows/execute/scope-mismatch.ts`.
   Pure; row identity for the chain axis, the signer rules above for the account axis.
3. **The banner**, in `execute/index.vue` above *Requested operations*: the auto-registered `Banner`
   (`variant="info"`, `direction="vertical"`, `wide`) with its single `action` carrying the toggle.
4. **The follow**, in `execute/index.vue`, called from `approve()` after `approveInteraction(...)`
   resolves and before `closeWindow(true)`, in its own `try/catch`.

### Key interfaces

```ts
// execute/scope-mismatch.ts
export interface ScopeView {
  /** The operations' row (every op shares it — single-chain sessions, first-row resolution). */
  network: Network
  /** `network.id !== active.networkId` — row identity, the feed's key; two rows on one chain differ. */
  networkMismatch: boolean
  signers: Account[]                   // uniqueSignerAccounts(operations)
  /** The single signer, else the single send-like signer; absent otherwise. */
  followAccount?: Account
  /** followAccount exists, differs from the active account, and the row matches. */
  accountMismatch: boolean
  /** No operation sends a transaction — the watch-it clause is dropped. */
  readOnly: boolean
}

export function resolveOperationScope(
  operations: readonly OperationLike[],
  active: { networkId?: string; accountAddress?: string },
): ScopeView | undefined              // undefined while the active scope is unresolved, or no operations
```

Rows, not strings — `Network` / `Account` carry their provenance, so a later edit cannot route dApp
text into the banner without changing a type. The window's template derives `data-state` from the
view + a `followDeclined` boolean ref, the one new piece of window state.

### The follow — exact sequence

```
followScope(view)                       [isolated try/catch, never rethrows]
  0. lifecycle generation:  gen = lifecycle.n, captured BEFORE `await approveInteraction(...)`
                            bumped by: onActiveProfileChanged (any value) · isLogined → false · dispose
     stillOurs = () => lifecycle.n === gen
     return when   !stillOurs()          ← the approval resolved into a different lifecycle
  1. return when   no follow | followDeclined
  2. await navigator.locks.request("nulo:scope-follow", async () => {
       await appStore.refreshInFlight({ invalidate: true })  ← settle re-read: the guard fails
                                          CLOSED and cannot answer from a snapshot an event overtook
       live = () => stillOurs() && !appStore.hasInFlightSend  ← a send can BEGIN during any await
                                          below; the subscription keeps it live, so re-ask each write
       return when   !live()
       activeId = await requireNetwork().getActiveNetwork()?.id   ← the LIVE row under the lock
       return when   !live()
  3.   chain axis:   when activeId !== view.network.id
                     await requireNetwork().setActiveNetwork(view.network.id)
                     └─ on throw: return — the account pointer is NOT written
       return when   !live()
  4.   account axis: when followAccount && followAccount.visible
                     await storageLocalSet({ "nulo:ui:activeAccount": followAccount.address },
                                           { unless: () => !live() })
                     ← the facade checks `unless` AFTER its own barrier, immediately before
                       `chrome.storage.local.set`; a lifecycle bump during the barrier wait skips
                       the write. What no fence can retract: a write already dispatched to Chrome.
     })
```

Why each line is the way it is:

- **The lifecycle generation (0), not `appStore.profile`.** Every `await` is a point where the
  wallet can lock or switch profile; the window shell's `onActiveProfileChanged` guard
  (`useDappApprovalWindow.ts:102-104`) rejects and closes, but does not cancel this continuation.
  Two reasons the store ref is the wrong fence: `app.vue` awaits `getProfiles()` before it flips
  `isLogined` (Fact 21), so the store lags the lock event; and `storageLocalSet` awaits
  `migrationIdle()` before writing (`storage.ts:73-76`), and `migrationIdle()` re-reads storage on
  **every** call (`storage.ts:32-34`), so a caller-side await of it fences nothing — the facade's
  own await is a fresh suspension point (codex r4 #1). So the generation is bumped synchronously in
  the event handlers, and the facade gains the guarded form `storageLocalSet(items, { unless })`:
  the predicate runs after the barrier, immediately before `chrome.storage.local.set`, inside the
  facade. Tested against the real facade by suspending the chrome stub's `get`. `nulo:ui:activeAccount`
  is a global key; a write landing after a profile switch would stamp a foreign profile's address
  (bootstrap falls back to `accounts[0]` — benign, but wrong).
  *Alternative declined:* fencing on the worker's session serial (`ProfileService.getSessionHandle()`,
  Fact 29) instead of this realm's lifecycle generation. `unless` must be synchronous — it runs in
  the same continuation as `set` — so it can only compare against a handle already in hand, and
  the *current* handle is an RPC. The comparison would therefore be as stale as the last time this
  realm asked, which is exactly the property the generation has without the RPC. Kept: the
  generation. The guarded write returns `false` when it skipped, so a caller can tell.
- **The Web Lock (2).** `navigator.locks` is same-origin across extension pages and workers; two
  approval windows confirming together serialize into two whole pairs instead of interleaving. First
  use in the codebase (Fact 23); no polyfill — every supported Chrome ships it.

- **`refreshInFlight({ invalidate: true })` first.** `hasInFlightSend` is `!ready || …`
  (`app.store.ts:168-176`). In the execute realm `useProfileBootstrap` sets `appStore.profile`,
  whose `immediate` watcher (`:184-191`) connects and reads, so the tracker is usually warm by
  Confirm — but "usually" is timing, and a cold read answers `true` and silently suppresses the
  follow. The invalidating refresh makes the answer fresh by construction rather than by boot order,
  and takes arc 1's settle path so an empty snapshot an event overtook cannot admit the follow
  (codex cross-arc #1). The guard filters the shared journal by THIS window's account and network —
  it is not a global popup-transfer lock; a send on the window's own scope closes it, and because a
  send can begin during any later await, the guard is re-asked before the network write and folded
  into the account write's `unless` (codex cross-arc #2).
- **Network first.** A failed network write can never leave a lone account write behind.
- **`requireNetwork()`**, the realm-shared client — the window's own `NetworkServiceClient` is
  disconnected in `init()`'s `finally`.
- **A direct service call, not `useNetworkActivation`.** The composable assigns `appStore.network`,
  and `app.vue` — the shared shell for every route, `windows-*` included — watches that ref with
  `createNetworkSwitchHandler`, which re-fetches accounts (`includeHidden: true`), may
  `ensureDefaultAccount`, then calls `setupActiveAccount()` — which writes `nulo:ui:activeAccount` on
  its fallback path. In a closing window that races our write and, in the states where we
  deliberately don't write the account (no follow account, hidden signer), stamps the pointer with an
  arbitrary `accounts[0]`. Writing the durable pointer directly never moves this realm's store, so
  the handler never wakes. Both audits arrived at this independently.
- **The account half writes the pointer only**, not `appStore.selectAccount` — same reason.
- **No toast.** The window is closing; a toast there is invisible.

### Data & control flow

```
init()  → operations resolved; session.value = payload.session
        → view = resolveOperationScope(operations, session.chainId, appStore.networks,
                   { chainId: appStore.network?.chainId, accountAddress: appStore.account?.address })
        → banner renders from view + followDeclined (nothing until view is defined)

Confirm → approve() guards (unchanged) → approveInteraction(requestId, deltas)
        → followScope(view)
        → closeWindow(true)
```

`approveInteraction` deletes the pending record and calls `executeAndResolve` **un-awaited**
(`dapp-interaction/service.ts:170-197`). The follow therefore runs *concurrently* with execution,
not before or after it; it is triggered by the wallet *accepting* the request, and a transaction that
later fails is still one the user should be looking at.

### File-level change map

| File | Change |
|---|---|
| `src/utils/in-flight-send.ts` | `isInFlightSend` requires `origin === "popup"`; `Pick` widened; header rewritten; `isApprovedSendInFlight` unchanged |
| `src/utils/in-flight-send.test.ts` | cases: popup transfer blocks · dapp_execute no longer blocks · seed no longer blocks · scoping rules unchanged for popup · `isApprovedSendInFlight` still counts a dApp send |
| `src/stores/app.store.ts` | the in-flight tracker exposes `resetInFlight()` (rows empty, ready) and carries a read generation that `resetInFlight()` and the unlock refresh bump; a read finishing under an older generation writes nothing |
| `src/popup/app.vue` | `enterLockedState` calls `appStore.resetInFlight()` beside `clearActivity()` |
| `src/composables/useProfileBootstrap.ts` | the two `isLogined = true` sites lower `ready` and call `refreshInFlight()` |
| `src/stores/app.store.test.ts` | extended — `commitScopeChange` admits with a `dapp_execute` record held at `proving`, refuses with a popup `transfer` there; after `resetInFlight()` the next `commitScopeChange` admits (refresh still called once, answered `[]`); the unlock re-read fails closed while `ready` is low and refuses when it returns a popup `transfer` |
| `src/utils/storage.ts` + `.test.ts` | `storageLocalSet(items, { unless })` returns `Promise<boolean>` (`false` = skipped); the predicate runs after `migrationIdle()`, before `chrome.storage.local.set`; tested by suspending the chrome stub's `get` |
| `src/wallet/services/wallet-sdk/background.ts` (+ test) | the wire handler captures `captureExecutionFence()` at entry in place of its profile read and sets `ctx.fence` |
| `packages/wallet-bridge/src/types.ts`, `services-contract.ts` | `SessionContext.fence?` (structural); `IExecutionRunner.executeOperations` gains an `undefined` fifth placeholder and `authorizedFence` sixth, matching the extension service's positions |
| `packages/wallet-bridge/src/dispatcher.ts` (+ test) | the covered `createAuthWit` branch requires `ctx.fence` for `ctx.profileId` and forwards it as argument six (position pinned) |
| `src/wallet/services/execution/service.ts` | `aztec_createAuthWit` joins `FENCED_OPERATION_KINDS`; the arm consumes `authorizedFence`: account by `fence.profileId`, `assertFence` after the lookup, `isFenceLive` as the statement before `account.createAuthWit` |
| `src/wallet/services/execution/service.fence-entry.test.ts` | extended — a popup-approved authwit signs under the approval's fence; a fence-less DAPP authwit is refused at entry; a session end before `assertFence`, or between it and the signing statement, throws `SessionEndedError` and signs nothing |
| `src/wallet/services/execution/README.md` | "Capture" and "Two entry contracts" bullets: the wire handler captures at entry for silent authwits; `aztec_createAuthWit` is a fenced kind |
| `src/popup/windows/execute/scope-mismatch.ts` + `.test.ts` | **new** — `resolveOperationScope` |
| `src/popup/windows/execute/index.vue` | banner + `followDeclined` + `followScope()` in `approve()` |
| `src/popup/windows/execute/scope-follow.test.ts` | **new** — banner states, both toggles, the follow, patterned on `capabilities/chain-switch.test.ts` |
| `src/popup/windows/execute/index.test.ts` | extended — the follow cannot fail an approval; does not run on reject |
| `tests/e2e/fixtures/helpers.ts` | **new** `waitForTxCardByHash(page, hash, timeout)` |
| `tests/e2e/network/execute-scope-chain.test.ts` | **new** |
| `tests/e2e/network/execute-scope-account.test.ts` | **new** |
| `src/wallet/services/execution/transfer-executor.ts` (+ test) | `createTransferJournal` throws when no record is created and runs inside the build `try`, so the refusal fails the header task; header comment drops "best-effort" |
| `src/wallet/services/execution/claim-helper.ts` (+ test, `dapp-send-executor.test.ts`) | `createAndRegisterFresh` throws in place of the `{journalId: undefined}` return; the caller already releases the slot and yields the failed envelope; header comment drops "best-effort" |

Nothing in `discover/` or `@nulo/design` is modified. The only service sources touched are
`execution/service.ts`'s authwit arm and the two journal-creation helpers (Phase 5); the builder,
the lane and the sweep are the prerequisite's and stay as merged.

### Trade-offs and alternatives not taken

- **Leave the guard alone and accept the freeze.** After the follow the user sits in the dApp's scope
  where its queued records live; switching account/profile/network is refused for the life of the
  transaction, or up to ~10 minutes against a hostile site (8 records/session, reaped after 10 min,
  renewable). Rejected by the owner (ledger D1): it re-opens a hole `in-flight-send.ts:41` was
  written to close, and the wallet looks broken while it holds.
- **Follow the network only.** Sidesteps the freeze (the record matches on account *and* network)
  but abandons the account axis and re-creates the empty-feed bug. Rejected.
- **`useNetworkActivation` for the network half** — the reuse recon recommended, declined for the
  cascade above. What we lose is its persist-failure reconciliation, which repairs the *in-memory*
  view — worth nothing in a window that is closing.
- **Reusing `resolveDappChain` for the chain axis.** Adopted in rev 3, dropped in rev 5. It compares
  chain ids; the feed compares row ids (`activity.store.ts:97`), and a row id can change under the
  popup's snapshot (delete and recreate) while the chain id does not. Execute already resolves each
  operation's row, so the axis is one `id` comparison and needs no resolver at all. (Rev 1/2's *reason* for not reusing it — "would need CAIP re-encoding" —
  was false; the right reason is the key.)
- **A six-state enum with `multi-chain`.** Unreachable given single-chain sessions; a state, a copy
  row, a `data-state` value and a test class for something no dApp can produce. Dropped.
- **Follow inside the service worker.** Durable against a dying window, one place for every approval
  type — but a layer violation (`nulo:ui:activeAccount` is UI-owned), and it would not fix the
  open-view limitation either. Carried as the competing outline.
- **`useAccountActivation`.** The two existing call sites want the in-memory move *and* a toast; this
  one wants neither.
- **Switching before Confirm**, **a footer checkbox**, **remembering a decline** — rejected as before.
- **An after-the-fact notice on next open.** Offered to the owner, declined (D2).

## Security & Adversarial Considerations

**Threat model.** The execute window is an anti-phishing surface. Everything it renders is
attacker-influenced *content*; nothing it renders may be attacker-controlled *authority*.

- **The banner's inputs are wallet-derived rows.** `Network.name` / `Account.name` from the wallet's
  own tables, never dApp session metadata (`accountAliases` are user-typed and flow *to* the dApp,
  never back). Vue interpolation, no HTML sink. The view type carries rows, not strings.
- **The follow cannot be aimed off-profile.** `resolveNetworkByChainId` throws with no row
  (`wallet-bridge/src/caip.ts:64-70`), `setActiveNetwork` does `requireOwnedRow(…, profile.id)`
  (`network/service.ts:572`), `getAccount` is profile+chain scoped, and the account pointer is
  resolved on bootstrap against *that profile's* list.
- **Scope mutation requires a user-initiated approval.** Never on reject, cancel, a failed approval,
  or a silently-executed request.
- **The dApp-chosen signing default** (a site with grants on A and B routes one trivial op through B
  to make B the wallet's active account). Owner-accepted (D2): the user confirmed a transaction as
  that account and was told the wallet would move there; the Send screen shows the active account.
- **The switch freeze (Phase 0).** Following walks the user into the scope holding the dApp's queued
  `dapp_execute` records (`queued-journal.ts:206-218`, created *before* approval at stage `queued`,
  8/session + 32 global, reaped after 10 min). Under the current guard those freeze every scope switch.
  Narrowing the guard to `origin === "popup"` is safe because the guard protects a send that "reads
  the active profile and account while it builds" — the wallet's own flow, which snapshots the active
  scope (`send.vue:333`). dApp execution runs service-worker-side under a per-`(profileId, chainId)`
  lane (`execution-lane.ts`) against the stored request, resolving network and account from the
  payload's CAIP identifiers; nothing in `wallet/` reads `nulo:ui:activeAccount`, and `getActiveNetwork`
  is read only by the token seeder. Moving the view cannot corrupt it. **Profile is handled by the
  prerequisite** (D6, merged): every send runs under an `ExecutionFence {profileId, epoch, session}`
  captured at authorization; the builder, both estimate-reuse arms, the post-prove step and the
  statement before `node.sendTx` assert it, a session end throws the typed `SessionEndedError`, and
  the sweep cancels the ended session's sends before `submitting` (Fact 25). A profile switch during
  a dApp build therefore fails closed by construction, from any account, and Phase 0 pins it from
  this plan's side with **one consumer test**: a dApp send parked mid-build across a profile switch
  rejects with `SessionEndedError` and its record ends `failed/session_ended` under the original
  profile. The rev-5 composition pin and D4's builder fix are superseded.
- **Authwits under the fence (Phase 5).** `executeAztecCreateAuthWit` awaits the active profile,
  the network, the account contract and the node before `account.createAuthWit` (Fact 30); none of
  those awaits is fenced, so a lock-and-unlock or a profile switch between approval and signing
  signs under whichever session is live. The popup-approved path already hands the arm an
  `authorizedFence` it ignores. The silent path is worse than "unfenced": the wire handler
  (`wallet-sdk/background.ts:1036-1079`) awaits the active profile, then the dispatcher awaits
  network and account resolution (`dispatcher.ts:987`), then `executeOperations` awaits
  `ensureInitialized` (`service.ts:644`) — and the handler's response guard deliberately lets a
  same-profile lock/unlock through (`background.ts:1104-1114`). A fence captured *in the arm* would
  therefore be the session live after those awaits, which may be a re-unlock, not the session the
  request arrived under (codex r5 #1). Fix, in three parts:
  1. **Capture where the request is authenticated.** The wire handler already reads the active
     profile at entry; it captures `captureExecutionFence()` there instead (same acceptance, yields
     `profileId`), before any awaited resolution, and carries it on `SessionContext` as `fence`
     (`wallet-bridge/src/types.ts`; a structural `{profileId, epoch, session}` type in the bridge —
     the bridge cannot import the extension's `ExecutionFence`). `dispatch("batch")` forwards `ctx`
     to its legs, so a batch's legs share the batch's entry fence, which is what "one authorization"
     means.
  2. **Forward it.** `handleCreateAuthWit`'s covered branch asserts `ctx.fence.profileId ===
     ctx.profileId` (the identity guard's question, asked of the fence) and passes the fence as
     `authorizedFence`. Positions matter: the extension's `ExecutionService.executeOperations` takes
     `(operations, origin, hooks?, hooks?, approvals?, authorizedFence?)` — the fence is the
     **sixth** argument — while `IExecutionRunner` (`services-contract.ts:77-84`) declares four, and
     `background.ts:187` hands the dispatcher the service itself, with no adapter. So the bridge
     interface declares the fifth parameter as an `undefined` placeholder (the approvals slot the
     bridge never fills) and the fence sixth, and the covered branch calls
     `executeOperations([op], origin, undefined, undefined, undefined, ctx.fence)`; a
     `dispatcher.test.ts` case pins the argument position. No other dispatcher path reads
     `ctx.fence`.
  3. **Consume it, never capture it.** The arm takes `authorizedFence` as required for a DAPP
     origin: `aztec_createAuthWit` **joins** `FENCED_OPERATION_KINDS` (Fact 31), because after (2)
     every production authwit path supplies a fence — the popup approval from `executeAndResolve`,
     the silent branch from the entry capture — and an arm-side capture would re-open exactly the
     gap above. The account is resolved as `getAccountContract(fence.profileId, …)`, followed by
     `await assertFence(fence)`; the **statement before** `account.createAuthWit` is the synchronous
     `isFenceLive` (the two-check shape of the send paths). The prerequisite's entry-contract pin
     ("the dispatcher's fence-less reads, registrations and silent authwits run") loses
     `aztec_createAuthWit` from its fence-less batch and gains the inverse case.
  The check is the fence, not the sweep: an authwit has no journal record and nothing to cancel.
  What stays outside: a UI-origin authwit (none exists today) would capture at entry like the
  auth-registry sends.
  **Provenance quirk, acknowledged and tested:** `ExecutionLane.beginJournal` hardcodes
  `origin: "dapp"` (`execution-lane.ts:149`) for everything routed through the lane — including the
  wallet's own auth-registry revocations and registry-enable changes (`auth-registry/service.ts`,
  sent with `OriginType.UI`). Phase 0 releases their freeze too. That is correct: they pass explicit
  `networkId` + `accountAddress` and never read the active scope. Only the popup transfer
  (`transfer-executor.ts:235`, `origin: "popup"`) is built from the active scope, and only it stays
  guarded. The lane's hardcoded origin is a separate cleanup, not this plan's.
- **Griefing the banner.** A dApp can mismatch on every transaction to train the user to ignore the
  banner — mitigated by the `info` tone never spending the alarm colour. Padding a batch to force
  `multi-signer` now costs a real second-account send instead of a free read (single send-like
  signer rule); the suppressed follow is the honest outcome when two accounts genuinely send.
- **Hidden accounts are never aimed at.** Init-time `visible` snapshot; a user hiding the signer
  between `init()` and Confirm yields a hidden account becoming active — an annoyance, not an
  authority change. Accepted. The general bootstrap gap (Fact 9) is pre-existing and out of scope.
- **No new persistence, dependency, or crypto.** The account write goes through `@/utils/storage`;
  raw `chrome.storage.local` in popup code is banned and scanner-enforced.

## Assumptions

### Facts (verified against `origin/dev` @ `0e9d9ce2`, the merge of the prerequisite; Facts 1–24 carry rev 5's line numbers where the prerequisite did not move them)

1. Each operation resolves its own `Network` and `Account` from CAIP identifiers
   (`execute/index.vue` → `buildOperationsFromPayload`; `resolveNetworkByChainId` = the first row for
   the chain, `wallet-bridge/src/caip.ts:64-70`); execution never consults the active **account or
   network**. For **profile**, the build no longer re-reads the active one: `resolveBuildContext`
   takes the `ExecutionFence` and resolves the account as the fence's profile's
   (`tx-request-builder.ts:117-132`), and the lane's mutex key is built from the fence. (Rev 1–4
   said "never consults the active scope" — false for profile at the time; rev 5's correction is
   itself superseded by the prerequisite.)
2. `approveInteraction` deletes the record, detaches the window, and calls `executeAndResolve`
   un-awaited (`dapp-interaction/service.ts:170-197`). "Approval succeeded" means "claimed", not
   "executed"; the follow and the execution run concurrently.
3. The activity feed's scope is `appStore.activeScope` = `{ profileId, networkId, chainId, accountAddress }`
   (`app.store.ts:470-481`). (Rev 1–2 cited `activity.vue:67`, which is the incoming-transfers scope.)
4. **No UI subscribes to `onActiveNetworkChanged`.** `app.vue:110` watches its own realm's
   `appStore.network`. A durable write from another realm moves nothing already open.
5. `app.vue` is the single shell for every route (`<RouterView>` at :434; :378 special-cases
   `windows-` names); its network-switch handler is live inside the execute window's realm.
6. `createNetworkSwitchHandler` (`popup/network-switch.ts:67`) loads accounts `includeHidden: true`,
   may `ensureDefaultAccount`, then `setupActiveAccount()` — which writes `nulo:ui:activeAccount` on
   its fallback path.
7. The active account is the single global key `nulo:ui:activeAccount`, written through
   `@/utils/storage`, read by `setupActiveAccountRun` on bootstrap and after a network change.
8. `hasInFlightSend` (`in-flight-send.ts:48`) matches records by viewed `accountAddress` and, when both
   present, `networkId`; a record with no `networkId` is a wildcard. The store's computed is
   `!state.ready.value || …` (`app.store.ts:167`) — **fails closed until the tracker has read the
   journal**. The tracker refreshes on profile changes and inside `commitScopeChange`; a window realm
   that has done neither reads it cold, so the follow refreshes explicitly.
9. `setupActiveAccountRun` selects remembered-else-`accounts[0]` with no visibility filter.
10. `OperationRecord.origin` is required, `"popup" | "dapp" | "seed"` (`operation-journal/spec.ts:60,66`).
    `tryCreateQueuedJournal` creates `dapp_execute` records with `origin: "dapp"` at stage `queued`
    carrying the session's account + network (`queued-journal.ts:206-218`).
11. Sessions are single-chain: `checkMethodPermission` throws on any chain ≠ `session.chainId`
    (`dapp-interaction/service.ts:578-593`).
12. `ExecutionPayload.session` is the unmodified `DappSession` (`chainId: string`); execute assigns it
    to `session.value`. `appStore.networks` is populated in the execute realm.
13. `Banner` renders exactly one `action`, globally auto-registered.
14. `capabilities/chain-switch.test.ts` is a working template for a banner plus an async side effect.
15. The e2e harness boots exactly one chain; `Testnet` / `Alpha V5` are remote-RPC preset rows.
16. `tx-card` carries `data-tx-hash`; `waitForPgResult(page, "sendTx", …)` returns that hash.
17. `bun run lint` includes the complexity ratchet (cognitive 15 / 80 lines).
18. Journal provenance: `ExecutionLane.beginJournal` hardcodes `origin: "dapp"` for every lane send
    (`execution-lane.ts:149`), including UI-initiated `executeSendTransaction` calls from
    `auth-registry/service.ts`; the popup transfer alone is journaled `origin: "popup"`
    (`transfer-executor.ts:235`). `"seed"` producers create `token_import` records, which
    `SENDING_KINDS` already excludes.
19. The lane stamps journal records with the authorization-time `profileId` and epoch, and — since
    the prerequisite — registers each controller under the fence's **session serial**
    (`ExecutionLane.registerInFlight`), refusing a dead one. `abandonDeadSessions`
    (`execution-lane.ts:225`) cancels, journal first, the ended session's records still in
    `PRE_SUBMIT_STAGES` (`:64` — `queued`, `pending`, `simulating`, `proving`; `submitting` is left
    to the broadcast check). Rev 5's "nothing re-checks the active profile once the build has
    started" is no longer true.
20. `storageLocalSet` awaits `migrationIdle()` and then writes with no further check
    (`utils/storage.ts:73-76`); `migrationIdle` is exported (`:32`).
21. On lock, `app.vue` awaits `managers.profile.getProfiles()` (`:164`) before setting
    `appStore.isLogined = false` (`:176`); `useDappApprovalWindow.onActiveProfileChanged`
    (`:102-104`) rejects the window synchronously on the event, but cancels no continuation.
22. The activity feed's membership test compares `profileId`, **`networkId`**, `chainId` and
    `accountAddress` (`activity.store.ts:95-102`). The dApp's queued record carries
    `networkId: getNetworksRaw(profileId, chainId)[0].id` (`queued-journal.ts:165-166, 213`) — the
    first row for the chain, the same rule as the popup's `resolveNetworkByChainId`.
23. `navigator.locks` is not used anywhere in `apps/extension/src` or `packages/` today.
24. `execution/service.composition.test.ts` drives the real `ExecutionService` graph with a
    `profileChanged` `EventHandler`; the prerequisite added the cases that end a real session
    mid-send (lock, expiry, switch, lock-and-reopen) and assert `SessionEndedError` plus the
    `failed/session_ended` record — the template for Phase 0's consumer test.
25. **The fence, as merged.** `ExecutionFence = {profileId, epoch, session}`;
    `ProfileService.captureExecutionFence()` (`profile/service.ts:520`), `assertFence()` (`:534`,
    awaited under the facade lock, throws `SessionEndedError` — `extension-messaging/src/errors.ts:288`,
    dApp code `SESSION_ENDED`, 4900), `isFenceLive()` (`:548`, synchronous). Both dApp entries
    (`executeAndResolve`, `silentInteraction`) capture at authorization and pass `authorizedFence`
    to `executeOperations` (`dapp-interaction/service.ts:257-297, 461-529`).
26. **Lock does not clear the popup's profile.** `enterLockedState` (`popup/app.vue:174-182`) sets
    `isLogined = false`, calls `appStore.clearActivity()`, replaces `profiles` and routes to
    `/popup/auth`; `appStore.profile` is untouched.
27. **The in-flight tracker's only refresh trigger is `profile.id`** (`app.store.ts:184-191`,
    `watch(() => profile.value?.id, …)`); its rows are emptied only when the profile is absent, the
    journal connect fails, or a read fails (`:224-273`). `commitScopeChange` short-circuits on the
    cached value before its refresh (`:211-219`). So after a lock, `hasInFlightSend` keeps answering
    from the pre-lock rows; the picker's `commitScopeChange` (`SelectProfilePopup.vue:51`) is refused
    and toasts "Finish or cancel your pending transaction first".
28. **The sweep runs after the session has closed**, and the journal answers reads and forwards
    events only for the active profile, so the popup that locked never receives the cancel events
    for its rows (measured in the prerequisite's Phase 6).
29. `ProfileService.getSessionHandle()` (`profile/service.ts:561`) returns `"<workerId>:<serial>"`
    for the live session, `undefined` when locked; `peekLiveSerial()` (`:557`) is the synchronous
    form. `lockActiveProfile(handle)` closes nothing when a different session is open.
30. **The authwit arm is unfenced.** `executeAztecCreateAuthWit` (`execution/service.ts:954-1023`)
    awaits `requireActiveProfile`, `getNetwork`, `getAccountContract(profile.id, …)`, `getNode`,
    `getNodeInfo` and a contract-instance read before `account.createAuthWit(messageHash)` (`:1023`);
    the `dispatchOperation` arm (`:760`) drops the `authorizedFence` the popup path passes. The
    dispatcher's silent branch (`wallet-bridge/src/dispatcher.ts:990-999`) calls
    `executeOperations([op], {type: DAPP})` with no fence and no await before it.
31. `FENCED_OPERATION_KINDS = {send_transaction, aztec_sendTx, register_token}`
    (`execution/service.ts:103`); `executeOperations` throws for a DAPP-origin batch holding one of
    them without `authorizedFence` (`:645`). The dispatcher's reads, registrations, simulations and
    silent authwits omit the fence, and their arms never consume it (the prerequisite's post-PR CI
    regression and fix).
32. **Unregistered sends.** `createTransferJournal` (`transfer-executor.ts:227-262`) logs a failed
    record creation and returns `{journalId: undefined, controller: undefined, live: true}`; the
    transfer proceeds with no record and no controller (`:109-124`). It is awaited at `:109`,
    **outside** the `try` that begins at `:126`, after `startNewTask` at `:107` — so a bare `throw`
    there would leave the header task never failed. `createAndRegisterFresh`
    (`claim-helper.ts:151-158`) does the same for the dApp path, where the caller
    (`dapp-send-executor.ts:258-271`) already handles a pre-claim throw: slot released, failed
    envelope. Both header comments call the creation "best-effort".
33. **A locked worker answers journal reads with `[]`.** `OperationJournalService.invoke`
    (`operation-journal/service.ts:119-131`) gates `getOperations` on the active profile: none →
    `[]`; a filter for another profile → `[]`. So a refresh from a locked popup empties the cache
    *if it runs*; what keeps the stale rows is `commitScopeChange`'s cached check ahead of it.
34. `appStore.isLogined` writers: `false` at `popup/app.vue:176` (`enterLockedState`),
    `components/Header.vue:26`, `settings/security/reset.vue:86`; `true` only at
    `composables/useProfileBootstrap.ts:171,195`.

### Inferences (unverified — attack these)

1. **Within this realm, nothing else writes `nulo:ui:activeAccount` during the follow** — no code
   path re-runs `setupActiveAccountRun` because `appStore.network` never changes here. Across
   realms, follows serialize on the Web Lock; a bootstrapping popup or a manual switch does not take
   it, so a write of theirs can land between or after ours (§Known limitations, Ask 2). Rev 4's "the
   signer lands last" is withdrawn.
5. **Releasing the freeze on lane-journaled UI sends is safe for account and network** (auth-registry
   revoke / enable pass explicit `networkId` + `accountAddress`, Fact 18). For profile they run
   under their own captured fence (the prerequisite's auth-registry entries capture before their
   first read).
6. **Emptying the tracker on lock loses nothing the freeze protects.** After the lock, the only
   scope changes that popup can make are the picker's profile pick and, after a same-profile
   unlock, account/network switches; the sweep has cancelled every pre-`submitting` send of the
   ended session, and a `submitting` one is milliseconds from terminal. The re-read on unlock
   closes the window for a send admitted by the *new* session before the popup's first scope
   change. Unverified: the store test in Phase 0 asserts the unlock re-read runs before
   `commitScopeChange` can answer.
8. **Every lock reaches `enterLockedState` through its latest handler.** `isLogined` has three
   `false` writers — `enterLockedState` (`app.vue:176`), `Header.vue:26` (before its
   `lockActiveProfile` RPC) and `settings/security/reset.vue:86` — and the latter two lock the
   worker, whose lock event lands in `enterLockedState`. A superseded handler returns early
   (`app.vue:168`, the event sequence check) and the newest one runs the cleanup, so one
   `resetInFlight()` there covers every path; a lock that never fires the event would leave stale
   rows, and none is known. A service-worker restart that drops the journal
   connection already re-reads through `onConnected` (Fact 27). The two `true` writers are both in
   `useProfileBootstrap.ts` (Fact 34).
9. **A fenced authwit changes no green path.** The popup-approved authwit runs under the approval's
   own fence, which is live unless the user locked or switched between Confirm and signing; the
   silent authwit runs under the fence captured when its wire request was authenticated, and the
   only awaits between that capture and the checks are the handler's and dispatcher's resolutions
   and `ensureInitialized` — no user step. So `assertFence`/`isFenceLive` only ever throw where the
   old code would have signed under a session other than the one the request arrived under.
   `batch-mixed` (Phase 5's live gate) exercises the silent path end to end.
7. **A lock reaches the window as `onActiveProfileChanged(undefined)`** — that is what
   `useDappApprovalWindow.ts:103` treats as "reject". The follow additionally watches
   `appStore.isLogined` so a lock arriving by another route still bumps the generation.
2. **The e2e recipe works**: connect via a fixture that switches to Local Network (funded, granted),
   `switchToNetwork(page, "Testnet")`, drive the transaction. Assumes a funded Local Network account
   survives the wallet pointing elsewhere and fee estimation is unaffected by the active network.
3. **A `visible: false` follow account is rare enough** to handle by skipping rather than re-reading
   the row at approve time.
4. **No popup-origin `dapp_execute` record exists today**, so the Phase 0 predicate change is
   observationally "dApp records stop blocking" and nothing else. `SENDING_KINDS` is left as is.

### Asks

D1–D7 record the owner's decisions. Asks 1–2 of this revision (delivery shape; folding the
fail-closed journal creation) were decided as D7, both the way the two review legs recommended.
One remains, non-blocking for approval and blocking for the execution PR:

3. **The Send screen's refusal copy** (Phase 5, `UI impact`). When the wallet cannot record a
   transfer before starting it, the Send screen shows a toast and nothing is sent. Proposed:
   **"Couldn't start this transaction. Nothing was sent — try again."** Sign-off is recorded here
   and quoted in the execution PR before it opens. The dApp side needs no copy: the dApp receives
   the standard failure envelope.

## Phases

### Phase 0 — narrow the freeze to wallet sends ✓

`isInFlightSend` requires `op.origin === "popup"` **alongside** `SENDING_KINDS` (kind is what the
operation does, origin is who started it; dropping `dapp_execute` from the kinds would substitute
one for the other). Tests in `utils/in-flight-send.test.ts` — every fixture given an explicit
`origin`: a popup `transfer` in the viewed scope blocks at each guarded stage; a `dapp_execute`
(origin `dapp`) in the viewed scope does not; a lane-journaled UI send (`dapp`-origin,
`send_transaction`-shaped, the auth-registry case) does not; a `seed` record does not; a mixed set
of popup + dApp records in one scope blocks iff the popup one is in flight; the account/network
scoping and the wildcard rule are unchanged for popup records.

**Deterministic in-flight proof (store level, `app.store.test.ts`).** Seed the tracker with a
`dapp_execute` record in the viewed scope held at `proving` — non-terminal, never advanced — and
assert `commitScopeChange` admits an account switch, a network switch and a profile switch; seed a
popup `transfer` at `proving` in the same scope and assert each is refused. This, not the e2e, is
the gate for "the freeze is released against a genuinely in-flight dApp record".

**The cache reset (store level, `app.store.test.ts`).** Seed the tracker with a popup `transfer`
at `proving` in the viewed scope, the journal fake answering `getOperations` with `[]` from now on
(the locked worker's answer, Fact 33); call `resetInFlight()`; assert `hasInFlightSend` is `false`
and `approvedSendsInFlight` is `0` at once, and that `commitScopeChange` **admits** a profile pick
— with `getOperations` called once for the old profile id (the unconditional refresh at `:215`
still runs; the cached short-circuit is what the reset unblocks). Then the unlock half: lower
`ready`, have the fake answer a popup `transfer` at `proving`, call `refreshInFlight()`; assert
`hasInFlightSend` was `true` while `ready` was low and the next `commitScopeChange` refuses. Assert
the profile-id watcher's behaviour is unchanged. Resolving the first case by skipping the refresh
while locked is the wrong fix: that refresh is the only one every cached reader
(`useNetworkActivation`, `NewNetworkPopup`, `NewAccountPopup`) shares. **Late reads, both orders:**
a read issued before `resetInFlight()` whose `getOperations` resolves (with the popup `transfer`)
after it leaves the rows empty; a read issued while locked whose answer (`[]`) lands after the
unlock refresh resolved (with a popup `transfer`) leaves that transfer in place; a late read that
*rejects* changes neither `rows` nor `ready`.

**The prerequisite's fence, from this plan's side.** No new test: `service.composition.test.ts`
(`:503-522`, "a dApp send parked at its slot-key lookup, then a switch to another profile / a lock:
refused, failed/session_ended under p1, never proved") already pins exactly the behaviour Phase 0
relies on. The gate runs that file and cites the case; a red there is a regression in the
prerequisite, which stops this plan until it is understood.

**The header.** `in-flight-send.ts`'s doc comment describes the predicate: the popup transfer
snapshots the popup's active scope into its arguments, so only that popup's own scope change can
move the ground under it, and the guard holds that scope still; dApp sends carry their own
identifiers and are bound to their session by the fence, so the guard does not count them. Nothing
about the lock dialog (that is `Header.vue`'s concern) and no workflow references.

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/utils/in-flight-send.test.ts src/stores src/wallet/services/execution/service.composition.test.ts`
- `cd <worktree root> && bun run typecheck && bun run lint`
- Pass: all exit 0, no edits under `execution/`; every existing store/guard test still green.
- Layers: typecheck · lint · unit

### Phase 1 — the resolvers ✓

New `execute/scope-mismatch.ts` + exhaustive tests: every row of the state table, the single-send-like
rule, **two send-like signers on two accounts → no follow account (including when the second
operation is one that will fail — the resolver cannot know)**, zero operations → `undefined`,
`readOnly`, `visible: false`, unresolved active scope → `undefined`, **two rows on one chain: the
operations' row ≠ the active row → `networkMismatch`, banner names both rows**, same row → no chain
axis, and the banner text uses the rows' current names (a renamed row reads by its new name).

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/popup/windows/execute/scope-mismatch.test.ts`
- `cd <worktree root> && bun run typecheck && bun run lint`
- Pass: all exit 0, complexity ratchet included.
- Layers: typecheck · lint · unit

### Phase 2 — the banner ✓

`data-testid="execute-scope-banner"` + `data-state`; the action carries
`data-testid="execute-scope-action-btn"`. `followDeclined`. Component tests for every state, both
toggle directions, no banner while the active scope is unresolved, and no state renders
`variant="warning"`.

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/popup/windows/execute`
- `cd <worktree root> && bun run typecheck && bun run lint`
- Pass: §Copy verbatim per state; frozen-oracle pins in `index.test.ts` green.
- Layers: typecheck · lint · unit/component

### Phase 3 — the follow ✓

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/popup/windows/execute`
- Cases that must pass:
  - fires on a successful approval; not on reject, a failed approval, or when declined;
  - a throwing follow still reports a successful approval and still closes the window;
  - **`refreshInFlight()` is awaited before `hasInFlightSend` is read** (a cold tracker does not
    suppress the follow);
  - `hasInFlightSend === true` skips **both** writes;
  - a `setActiveNetwork` rejection skips the account write;
  - `visible: false` skips the account write, still switches the network;
  - **`appStore.network` and `appStore.account` are never assigned by the follow**;
  - the network write goes through `requireNetwork()`, not a window-local client;
  - the lifecycle generation is captured before `approveInteraction` is awaited; a profile change
    or lock that resolves *during* the approval call aborts the whole follow;
  - `onActiveProfileChanged` (any value, `undefined` included) and `isLogined → false` each bump the
    generation synchronously — asserted without awaiting anything;
  - a profile change landing during `refreshInFlight()` or during `setActiveNetwork` aborts before
    the next write;
  - **a profile change landing while the follow is suspended inside the storage facade** — against
    the real `storageLocalSet(items, { unless })`, suspend the chrome stub's `get` (which
    `migrationIdle()` awaits on every call), fire the profile event, resolve it — results in **no**
    `chrome.storage.local.set` call. This is the case rev 4 could not have passed, and the one rev 5's
    caller-side `migrationIdle()` did not close (codex r4 #1); `storage.test.ts` pins the facade
    half (predicate evaluated after the barrier, `set` skipped when it returns true, called when
    false, and the plain call unchanged);
  - both writes run inside `navigator.locks.request("nulo:scope-follow", …)`; with a mocked
    `navigator.locks` that queues callbacks, two follows started together produce two whole pairs in
    request order, never an interleaved pair. jsdom has no `navigator.locks` — the test setup stubs
    it; the code has no runtime fallback and needs none;
  - `setActiveNetwork` rejecting *after* its durable write (simulated) leaves the account pointer
    untouched and the approval successful; `storageLocalSet` rejecting after a successful network
    write does the same — no rollback is attempted in either case.
- `cd <worktree root> && bun run typecheck && bun run lint`
- Layers: typecheck · lint · unit/component

### Phase 4 — e2e ✓

`waitForTxCardByHash` in `fixtures/helpers.ts`, then two network tests. **Every post-confirm
assertion is against `chrome.storage.local` and/or a freshly-opened popup, never a page that was
already open** (§Known limitations).

- `execute-scope-chain.test.ts` — connect funded on Local Network, `switchToNetwork(page, "Testnet")`,
  drive a dApp `sendTx`, assert `data-state="chain"`, confirm; assert the active-network row and
  `nulo:ui:activeAccount` moved; `openPopup(ctx)` and assert `network-button` reads `Local Network`
  and the tx hash is a `tx-card` in Activity — no manual switching.
- `execute-scope-account.test.ts` — two accounts on one session, wallet active on A, dApp sends
  `from` B. (i) *follow*: assert `data-state="account"`, confirm, open a fresh popup, assert the
  pointer is B; then, while the dApp's `tx-awaiting-card` is present with a non-terminal
  `data-stage`, `switchAccountByAddress(page, A)` and assert it succeeds. **Live confirmation, not
  the gate**: proving may finish before the switch is attempted, in which case this only exercises
  the terminal case the old guard already allowed. The deterministic proof is Phase 0's store test
  against a record held at `proving`; this step `console.info`s whether it caught the window and
  never fails on missing it. Then switch back to B and assert the transaction is visible under B.
  (ii) *decline*: click the action, assert `data-state="account-declined"`, confirm, assert the
  pointer is still A and the transaction is absent from A's feed; `switchAccountByAddress(page, B)`
  and assert it is there. (iii) *lock contention, observed*: from another extension page (the
  popup opened with `openPopup(ctx)`, via `page.evaluate`) hold the real lock —
  `navigator.locks.request("nulo:scope-follow", () => new Promise(r => { window.__release = r }))` —
  then drive a dApp `sendTx` `from` B and confirm it. Assert, while the holder is held: the approval
  resolved (the follow never blocks the approval), the execute window is still open (its
  `closeWindow(true)` waits behind the lock), `nulo:ui:activeAccount` is still A, and
  `navigator.locks.query()` from the holder page lists one *pending* request for
  `nulo:scope-follow`. Release the holder; assert the window closes and the pointer is B. This
  proves the lock is a real cross-realm lock the follow contends for, with one chain and no
  production hook. It does not exercise interleaving or mid-pair termination (§Known limitations),
  and does not try.

**Validation gate**
- `cd <worktree root> && bun run e2e:agent tests/e2e/network/execute-scope-chain.test.ts`
- `cd <worktree root> && bun run e2e:agent tests/e2e/network/execute-scope-account.test.ts`
- Pass: both green at retry 0; triage flake-vs-break per the e2e README, never neutralize. Run solo.
- Layers: e2e against the live sandbox

### Phase 5 — authwits under the fence, and no unregistered sends ✓

Two independent fixes in the execution layer, shipped as one unstacked PR (D7). Delivered on
`worktree-approval-scope-follow-execution` (`e8d98d3b`, `01502d7e`); `lessons/phase-5.md` carries
the gate output and the arc's review loop. One deviation from the plan below: the node read, the
chain rebind and the message-hash resolution moved verbatim into a private
`resolveAuthWitMessageHash(op, network)` so the arm stays under the cognitive-complexity budget
with the fence gate **inlined** — a first cut extracted the gate into an async helper instead, and
the codex loop caught that awaiting it reopened the very microtask gap the synchronous check
closes. The gate is two statements followed directly by `account.createAuthWit`, nothing between.

**A. Authwits under the fence.** Three parts, as §Security lays out. **(1) Entry capture**: the wire handler in
`wallet-sdk/background.ts` replaces its entry `requireActiveProfile` read with
`profileService.captureExecutionFence()` (same acceptance, `profileId` comes from the fence) and
sets `ctx.fence`; `SessionContext` (`wallet-bridge/src/types.ts`) gains the optional structural
field. **(2) Forward**: `handleCreateAuthWit`'s covered branch throws the dispatcher's usual
session error when `ctx.fence` is absent or `ctx.fence.profileId !== ctx.profileId`, and passes it
as the **sixth** argument of `executeOperations` — `IExecutionRunner` (`services-contract.ts:77-84`)
gains an `undefined` fifth placeholder (the approvals slot) and the fence sixth, matching the
extension service the dispatcher is handed directly (`background.ts:187`); the position is pinned
in `dispatcher.test.ts`.
**(3) Consume**: `dispatchOperation`'s `aztec_createAuthWit` arm passes `authorizedFence` through;
`aztec_createAuthWit` joins `FENCED_OPERATION_KINDS`, so a DAPP-origin authwit without a fence is
refused at entry like a send; the arm resolves the account as `getAccountContract(fence.profileId,
…)` (no `requireActiveProfile`; the lookup fails closed on a locked profile because `getSecret`
throws), then `await this.profileService.assertFence(fence)` (the awaited check, deletion
included); the **statement before** `account.createAuthWit(messageHash)` is the synchronous
`if (!this.profileService.isFenceLive(fence)) throw new SessionEndedError()`. The awaited
`assertFence` alone is not enough there: it runs under `runExclusive`, a queued `lockActiveProfile`
can take the lock in the gap after it releases, and the account handle already holds derived key
material, so a signing after that gap succeeds — the reason the prerequisite made `isFenceLive` the
statement before `node.sendTx`. The chain rebind, the artifact resolution and the scope checks
between are untouched. The execution README's "Capture" and "Two entry contracts" bullets change
with it: the wire handler captures at entry for the dispatcher's silent authwits, and
`aztec_createAuthWit` is a fenced kind.

Tests. `service.fence-entry.test.ts` (the prerequisite's entry-contract file): a DAPP batch carrying
`authorizedFence` signs with that fence's profile and never calls `getActiveProfile`; a fence-less
DAPP `aztec_createAuthWit` is refused at entry with no capture and no signing (the existing
fence-less batch case drops `aztec_createAuthWit` from its list — reads, registrations and
simulations still run); a session end after the capture (the fake's `assertFence` throws
`SessionEndedError`) rejects and `createAuthWit` is never called; a session end between
`assertFence` and the signing statement (the fake's `isFenceLive` returns `false` after
`assertFence` resolved) rejects the same way. `dispatcher.test.ts`: the covered branch forwards
`ctx.fence`; a missing or foreign-profile fence is refused before `executeOperations` is called;
the uncovered branch (popup) is unchanged. **As delivered**, the wire-handler unit test was not
written: `handleWalletMessage` is module-private with no mock-friendly seam, and exporting it for a
test alone is a production change for test convenience. The entry capture is pinned instead by the
`batch-mixed` network e2e (a real covered authwit through the real wire handler → dispatcher → arm;
without the entry capture `ctx.fence` is undefined and the covered branch refuses, so the e2e reds)
together with the dispatcher tests, which require a production-supplied `ctx.fence`. Codex r5 #1's
lock-and-unlock scenario is covered at the arm by a bare-prototype test (`service.fence-entry.test.ts`):
`isFenceLive` returning `false` after `assertFence` resolved rejects `SessionEndedError` with
`createAuthWit` uncalled. Mutations, each failing a test: drop `assertFence`; drop the `isFenceLive`
statement; resolve the account from the active profile instead of the fence; capture in the arm
instead of at entry (reds the e2e and the covered-authwit dispatcher tests); remove
`aztec_createAuthWit` from `FENCED_OPERATION_KINDS`.

**B. No unregistered sends** (Fact 32; the prerequisite's follow-up, D7). A send whose journal
record cannot be created is refused before any build, instead of running with no activity card and
no controller.
- **Popup transfer** (`transfer-executor.ts`): `createTransferJournal` moves inside the `try` that
  wraps the build, so a refusal enters the existing failure handling — the header task ends
  `failed`, the Send screen shows the toast (`UI impact`, Ask 3) — and it throws when
  `createJournalOperation` returned nothing. Nothing about the fence's `live: false` exit changes.
- **dApp claim** (`claim-helper.ts`, `createAndRegisterFresh`): `if (!id) throw` in place of the
  `{journalId: undefined, controller: undefined}` return; the caller (`dapp-send-executor.ts:258-271`)
  already handles a pre-claim throw — releases the slot and both controller keys, yields the failed
  envelope. The dApp sees the standard failure envelope.
- Both helpers' header comments drop "best-effort".
- Tests: `transfer-executor.test.ts` — a failing `createJournalOperation` rejects before
  `buildAndEstimate` or `tryConsume` is called, and the task ends `failed`, not stuck;
  `claim-helper.test.ts` / `dapp-send-executor.test.ts` — a failing `createFreshRecord` rejects
  before any build, the slot is released and the envelope is failed. Mutation, each failing a
  test: restore either fall-through.
- `UI impact`: Send screen, failure toast only, copy per Ask 3; no layout or row change. **As
  delivered**, the refusal ships no new copy: `send.vue` shows its existing fixed toast
  ("Simulation failed, transaction not sent") on any `executeTransfer` rejection and never renders
  the error's text, so the user sees the pre-existing generic toast until Ask 3's copy is signed
  off and wired — which is why the execution PR waits on Ask 3.

**Validation gate**
- `cd apps/extension && bun --bun vitest run src/wallet/services/execution src/wallet/services/dapp-interaction src/wallet/services/wallet-sdk`
- `cd <worktree root> && bun run --cwd packages/wallet-bridge test`
- `cd <worktree root> && bun run typecheck && bun run lint`
- `cd <worktree root> && bun run e2e:agent tests/e2e/network/batch-mixed.test.ts` (the dispatcher's
  silent authwit path, live) — run solo.
- Pass: all exit 0.
- Layers: typecheck · lint · unit · e2e

### Phase 6 — close out ✓

Regression sweep, not a feature gate — but required before the PR.

**Validation gate**
- `cd <worktree root> && bun run test:e2e`
- `cd <worktree root> && bun run audit:vue`
- Pass: both exit 0.
- Layers: typecheck · lint · unit · build · smoke e2e

## Competing outline (for the audits)

**"Follow in the service worker."** The dapp-interaction service writes both pointers on resolution;
the popup contributes a boolean. More durable, one place for every approval type — at the cost of a
layer violation and a wider blast radius, and it does **not** solve the open-view limitation either.
Rejected; carried so the audits can argue it rather than rediscover it.

## Decision ledger

### Owner decisions (2026-09-16, after the audits)

| # | Decision | Chosen |
|---|---|---|
| D1 | The post-follow switch freeze (fable A2) | **Narrow the guard to wallet-origin sends** — Phase 0. Rejected: accept the freeze; network-only follow. |
| D2 | The dApp-chosen signing default (fable A1) | **Accept** — the user approved a transaction as that account and was told the wallet would move. Rejected: an after-the-fact notice. |
| D3 | Read-only payloads (rev-1 Ask 1) | Keep the banner, drop the "watch the transaction" clause. |
| D4 | A red Phase 0 profile-switch pin (codex r3 #2; rev-5 Ask 1) | **Pre-authorize the builder fix inside Phase 0** (`resolveBuildContext` takes the fence's `profileId`). Rejected: hold Phase 0 for a separate plan; ship regardless. |
| D5 | Residual mixed-pointer pair after the Web Lock (codex r3 #3; rev-5 Ask 2) | **Accept as a known limitation.** Rejected: extend the lock into `app.store.ts` / `network-switch.ts`. |
| D6 | Profile axis of Phase 0 (codex r4 #2; rev-5 Ask 3) | **Prerequisite plan first**: `profile-fenced-execution` binds every send path to its authorization-time fence (typed drift error, confirm dialog before a profile switch cancels in-flight work). Supersedes D4. Rejected: split the freeze by axis (UI keeps compensating for a missing SW invariant); expand D4 inside this plan (execution hardening riding in a banner PR). **Done** — merged 2026-09-17 (`7f08d802`, `0e9d9ce2`). |
| D7 | Delivery shape and the fail-closed journal creation (rev-6 Asks 1–2; 2026-09-17) | **Shape (b)** — three PRs by layer: Phase 0 alone as `fix(popup)`, the banner stacked on it, the execution work unstacked. **Fold** fail-closed journal creation into the execution PR with the authwit fence (Phase 5). ELI5 republished at the `eli5_url` above (2026-09-17). Rejected: two PRs by verb; a separate fail-closed PR. |

### Round 1 — codex (GPT-6 Astra, `high`), session `01a0aacd-…` → **reject** (on rev 1)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | HIGH — cross-window propagation does not exist | yes | Adopted: Fact 4, §Known limitations, e2e asserts on storage + fresh popup |
| 2 | HIGH — account-write-first contradicts "blocked skips both" | yes | Adopted: network first, direct `setActiveNetwork` |
| 3 | HIGH — hidden-account protection incomplete | yes | Adopted in part: never aim; general gap out of scope |
| 4 | MEDIUM — Fact 6 overstated (missing `networkId` wildcard) | yes | Adopted: Fact 8 narrowed |
| 5 | Ask 1 pre-implementation; Ask 2 covers total failure | — | Ask 1 → D3; Ask 2 withdrawn (moot, Fact 2) |
| 6 | Specify zero signers / `default_entrypoint` | yes | Adopted: signer definition |
| 7 | Gates can't see ordering; account e2e proves only decline | fair | Adopted: Phase 3 cases, positive follow e2e |
| 8 | Reconsider the service-worker outline | — | Rejected: doesn't fix the open-view gap either |

### Round 1 — fable (Claude Opus 5, `Plan`) → **conditional approve** (on rev 1)

| # | Finding | Verified | Disposition |
|---|---|---|---|
| A1 | CRIT/HIGH — dApp-chosen signing default | yes | Surfaced → **D2 accept**; recorded in Security + Known limitations |
| A2 | HIGH — follow re-opens the queued-record switch freeze | yes (`queued-journal.ts:206-218`, `in-flight-send.ts:41`) | Surfaced → **D1**; **Phase 0 added** |
| A3 | MEDIUM — `multi-chain` unreachable; `multi-signer` dApp-selectable to suppress the follow | yes (`service.ts:578-593`) | Adopted: state dropped; single-send-like-signer rule |
| A4 | MEDIUM — follow invisible to open realms | yes | Same as codex #1 |
| A5 | LOW — bare strings erase provenance | fair | Adopted: view carries rows |
| A6 | LOW — `networks[0]` when rows share a chain id | yes | Documented in Known limitations |
| F6 | Fact 6 holds but the guard **fails closed** until refreshed | yes (`app.store.ts:167`) | **Adopted — `refreshInFlight()` first**; without it the follow never fires |
| F2 | Fact 2 over-claimed; `executeAndResolve` un-awaited | yes | Adopted: Fact 2 restated, Ask 2 withdrawn |
| F4 | Fact 4 misdirecting — the `app.vue` cascade fires inside the execute window | yes | Adopted: Facts 5–6, the direct-call design (already in rev 2) |
| F3 | Wrong citation for the feed scope | yes | Adopted: Fact 3 |
| I1 | HIGH — `resolveDappChain` reuse rejected on a false premise | yes (`session.chainId` is on the payload) | **Adopted in rev 3; superseded in rev 5** (codex r3 #4 — the feed keys on the row, not the chain) |
| I2 | HIGH — six-state enum over-fitted | yes | Adopted: boolean chain axis + signer set |
| I3 | HIGH — `useNetworkActivation` leaks the cascade + toasts | yes | Already adopted in rev 2 (convergent with codex #2) |
| I4 | MEDIUM — which network client | yes | Adopted: `requireNetwork()` named in the sequence + a test |
| I5 | MEDIUM — hidden-signer carve-out illusory under a store-mutating activation | yes for rev 1 | Moot under the direct-call design; the pre-existing bootstrap gap stays documented |
| I6 | MEDIUM — mocked gates can't see the cascade; Phase 4 asserted on a stale page | yes | Adopted: no-store-mutation test; storage + fresh-popup assertions |
| — | Unstated: active scope populates asynchronously | yes | Adopted: `undefined` until resolved, no banner |

### Round 2 — codex re-review of rev 3 (resumed session) → **conditional approve**

Prior blocking findings: #1 resolved; #2 resolved ("does not make the two writes atomic" — now a
stated limitation); #3 partially — hidden-account activation is *accepted*, not *prevented*, and the
ledger says so.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | HIGH — the account write can outlive its profile (lock / switch during an await) | yes — the shell guard rejects + closes but does not cancel the continuation | **Adopted**: profile fence captured at approval, re-checked before each write; Phase 3 cases |
| 2 | HIGH — "last write wins" does not describe a two-key update; two follows can interleave into a mixed pair | yes | **Accepted as a limitation**, not repaired: separate realms, both writes are the user's intents, next switch repairs; the "race-free" inference is withdrawn |
| 3 | MEDIUM — persistence failures are indeterminate (network persists before it emits) | yes (`service.ts:567-578`) | **Adopted**: behaviour defined (no rollback, degraded-not-corrupt), both cases in Phase 3 |
| 4 | MEDIUM — journal `origin` does not mean "UI-initiated": the lane hardcodes `dapp` for auth-registry sends | yes (`execution-lane.ts:136`, `auth-registry/service.ts:280`) | **Adopted**: acknowledged in Security, Fact 18, Inference 5, a Phase 0 test; provenance cleanup deferred |
| 5 | MEDIUM — profile safety during dApp execution needs its own evidence | partly | **Rejected as a new test**: Phase 0 changes who can trigger the interleave, not what happens; Facts 19 + Inference 6 record the existing evidence. Open for the fresh pass to re-judge |
| 6 | MEDIUM — the Phase 0 e2e switched after the send completed, proving nothing | yes | **Adopted**: the switch is attempted while `tx-awaiting-card` is non-terminal; unit tests carry the proof |
| 7 | Keep `origin` alongside `SENDING_KINDS`; give fixtures explicit origins; test mixed records + all stages | — | **Adopted** in Phase 0 |
| 8 | Corrections: the tracker also refreshes on profile change; follow runs *concurrently* with execution | yes | **Adopted**: Fact 8 softened, Fact 2 restated |

### Round 3 — fresh-context codex pass on rev 4 (GPT-6 Astra, `high`, new session) → **reject**

"Rev 4 still overstates its safety guarantees." Two blocking, four medium; all six verified against
source, all six adopted in rev 5.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | HIGH — `appStore.profile` is no fence for persistence: `storageLocalSet` awaits `migrationIdle()` then writes unchecked; `app.vue` clears the store only after `getProfiles()` | yes (`storage.ts:73-76`, `app.vue:164-176`) | **Adopted**: lifecycle generation bumped synchronously in the event handlers, captured before the approval await; the follow awaits `migrationIdle()` itself and re-checks before `storageLocalSet`; Phase 3 suspends a test inside the facade |
| 2 | HIGH — rejecting the execution regression was wrong: Fact 1 is false for profile (`tx-request-builder.ts:214`, lane mutex key), Fact 19 is a deletion epoch | yes | **Adopted, rev 4's call reversed**: Facts 1/19 corrected, Inference 6 demoted to a hypothesis, Phase 0 gains a composition pin on the parked-build profile switch (auth-registry entry included); a red pin routes to Ask 1 |
| 3 | MEDIUM — mixed persistence understated; "only a storage lock" is false — Web Locks coordinate same-origin realms | yes (no `navigator.locks` usage; API available) | **Adopted**: follows serialize on `navigator.locks`; ordering tested; the residual (bootstrap / manual writer) is Ask 2 |
| 4 | MEDIUM — same chain, two rows: resolver compared `chainId`, feed keys on `networkId` → no follow, feed still empty | yes (`activity.store.ts:97`, `queued-journal.ts:165-166`) | **Adopted**: the chain axis is row identity (`op.network.id`); `resolveDappChain` is no longer reused (reversal below) |
| 5 | MEDIUM — batch padding reduced, not closed: a second send-like op still suppresses the account follow | yes | **Adopted**: limitation reworded, two-send-like case tested incl. a failing secondary |
| 6 | MEDIUM — Phase 4's switch test passes on a missed window | yes | **Adopted**: the gate is Phase 0's store test against a record held at `proving`; the e2e step is labelled supplementary |
| — | `origin === "popup"` ≠ "all UI sends" ≠ "all profile-sensitive execution"; say so | — | **Adopted** in §Known limitations |

**Reversal of fable r1 I1** (reuse `resolveDappChain`): adopted in rev 3, superseded here. The
capabilities resolver answers "is the wallet on the dApp's *chain*?" — right for a session grant;
the feed asks "is the wallet on the dApp's *row*?". Reusing it would have carried the wrong key into
the one place the key matters.

### Round 4 — fresh-context codex pass on rev 5 (GPT-6 Astra, `high`, new session) → **reject**

"Rev 5 does not close both blockers." All four findings verified against source. The plan is
**parked** on D6; rev 6 folds #1, #3, #4 and re-bases Phase 0 on the prerequisite's typed drift
error when that plan has merged.

| # | Finding | Verified | Disposition (rev 6) |
|---|---|---|---|
| 1 | HIGH — `migrationIdle()` re-reads storage on **every** call (`storage.ts:32-34`), so awaiting it caller-side then calling `storageLocalSet` still leaves an unfenced await inside the facade | yes | **Adopt**: the facade gains a guarded write — `storageLocalSet(items, { unless })` checks the predicate after its barrier, immediately before `chrome.storage.local.set`; tested against the real facade by suspending the chrome stub's `get`. Fence prevents *subsequent* writes; a dispatched SW RPC cannot be retracted — stated |
| 2 | HIGH — the pin + D4 cover one read site; execution reads the active profile at `execution-lane.ts:175,220`, `tx-request-builder.ts:214,372`, `dapp-send-executor.ts:452,782` (estimate reuse bypasses the builder), NO_FROM; the acceptance criteria contradicted themselves; Fact 24's parked case is gas-cache, the harness hardcodes p1 | yes | **Superseded by D6**: the prerequisite plan binds all of them and ships the composition pins; Phase 0 here becomes popup-only guard + one consumer test asserting the typed drift error |
| 3 | MEDIUM — Web Locks release on holder termination; a window closing/crashing between the two writes leaves a partial pair; a queue mock proves app ordering, not cross-window locking | yes | **Adopt** as a Known limitation; `closeWindow(true)` stays after the awaited lock |
| 4 | MEDIUM — two rows on one chain is refused at creation (`network/service.ts:479`, `ERR_DUPLICATE_CHAIN`); "always the same row" is unjustified across delete/recreate timing | yes | **Adopt**: limitation reworded — row comparison is defensive, not a supported configuration |
| — | Facts 20, 21, 23 correct; Inference 7 supported (`lockActiveProfile()` wiring); D5 needs no further Ask | — | noted |

### Rev 6 (2026-09-17) — what changed and why

The prerequisite merged to `dev` as `7f08d802` + `0e9d9ce2` (stack #612). Rev 6:

- **Applies codex r4 #1, #3, #4** as their dispositions above say: the guarded facade write (Phase
  3, `storage.ts`), the Web Lock holder-termination limitation, the two-rows wording.
- **Replaces rev 5's Phase 0 profile pin** (r4 #2, superseded by D6) with one consumer test on the
  merged fence; D4's builder fix is withdrawn — the builder already takes the fence.
- **Absorbs the prerequisite's four follow-ups**: the stale in-flight cache on lock (Phase 0, root
  cause Facts 26–28), the `in-flight-send.ts` header (Phase 0), the authwit fence (Phase 5, Fact
  30), fail-closed journal creation (Phase 5 by D7, Fact 32).
- **Re-verifies every fact** against the merged tree; Facts 1 and 19 corrected again, 25–32 added.
- **Delivery decided** (D7): three PRs by layer; fail-closed journal creation folded into the
  execution PR.
- **Both earlier ELI5 artifacts were deleted on claude.ai**; the gate republished it with the rev 6
  changes (the picker regression, the authwit fence, the fail-closed refusal).

Review legs for rev 6: the fable leg runs on **Fable 5.1** (the plan's earlier fable round was Opus
5); then a fresh codex pass, since r4 rejected rev 5 and rev 6 must answer it.

### Round 5 — fable (Claude Fable 5.1, `Plan` subagent, static) on rev 6 → **conditional approve**

Conditions, all adopted in this revision: (a) the Phase 0 cache test must not imply a change to
`commitScopeChange` or `refreshInFlightOps`; (b) drop the duplicate "consumer test"; (c) Phase 5's
last statement is `isFenceLive`, and the execution README joins the change map. Full report:
`audit-fable.md`, round 5.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | MEDIUM — the Phase 0 test spec ("admits without a journal round-trip") contradicts the code: `commitScopeChange` refreshes unconditionally once the cached check passes (`app.store.ts:215`); skipping that refresh while locked would remove the one refresh every cached reader shares | yes | **Adopted**: the test asserts the pick is admitted *and* the refresh ran (answered `[]`, Fact 33); `commitScopeChange` untouched |
| 2 | MEDIUM — the Phase 0 "consumer test" duplicates `service.composition.test.ts:503-522` verbatim | yes | **Adopted**: no new test; the gate cites the existing case |
| 3 | MEDIUM — `assertFence` right before `createAuthWit` leaves the microtask gap the prerequisite closed for `node.sendTx` with `isFenceLive`; the account handle already holds derived keys, so a signing after the gap succeeds | yes (`profile/service.ts:534-544`, README) | **Adopted**: `assertFence` after the lookup, `isFenceLive` as the statement before `createAuthWit`; a fourth test + mutation |
| 4 | LOW — Phase 5 changes the README's documented entry contract without touching it | yes (`README.md:63-64`) | **Adopted**: README in the change map |
| 5 | LOW — Inference 8 incomplete (`Header.vue:26`, `reset.vue:86` also flip `isLogined`); "aligned with `clearActivity()`" is inexact — that is an explicit call, not a watcher; the unlock re-read is load-bearing (`commitAccountTarget`'s fast path never refreshes) and needs `ready = false` first | yes | **Adopted**: explicit `resetInFlight()` in `enterLockedState`; explicit lowered-`ready` refresh at the two unlock sites (Fact 34); Inference 8 rewritten |
| 6 | LOW — the `getSessionHandle` alternative was declined for the wrong reason (`unless` is synchronous; the current handle is an RPC); the guarded write's skip result unspecified | fair | **Adopted**: reason rewritten; returns `false` on skip |
| 7 | LOW — line drift in Facts 18/30/32 | yes | **Adopted** |
| 8 | LOW — "read cold, the follow would never fire" is false in the execute realm (the bootstrap's `immediate` watcher warms the tracker) | yes | **Adopted**: reworded — the refresh makes the answer fresh by construction, not by boot order |
| 9 | LOW — comment-leak risks: the header spec narrated the lock dialog; Phase 3 case text names review rounds | fair | **Adopted**: header spec kept to the predicate; the Phase 3 text is plan prose, test names carry behaviour only |
| — | Asks: three PRs paired by layer (Phase 0 `fix(popup)` first); fold Ask 2 into Phase 5's PR, mind the transfer site's `try` placement | — | Recorded as Ask 1 (b) and in Ask 2 for the owner |

Checked and holding per the report: Facts 25–32 at their symbols; keeping `aztec_createAuthWit`
out of `FENCED_OPERATION_KINDS` *under an arm-side capture* (superseded by the codex round below,
which moves the capture to the wire entry and makes the kind fenced); the guarded facade write
closes r4 #1; the cache reset reopens nothing (the picker is unreachable until `enterLockedState`,
by which time the worker answers `[]`); no green path throws under Phase 5.

### Round 6 — fresh-context codex pass on rev 6 (GPT-6 Astra, `high`, new session `01a0afd4-…`, static) → **reject**

"Rev 6 closes the original storage/profile blockers, but leaves a silent-authwit authorization gap
and an incomplete cache reset." Round-4 status per codex: #1 closed, #2 closed, #3 not closed
(no cross-window evidence), #4 not closed editorially. All four findings verified against source
and adopted below; the resumed session re-reviews the result (loop round 2).

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | HIGH — an arm-side capture for the silent authwit is too late: the wire handler awaits the active profile (`background.ts:1036`), the dispatcher awaits network/account resolution (`dispatcher.ts:987`), `executeOperations` awaits `ensureInitialized` (`service.ts:644`), and the response guard deliberately passes a same-profile lock/unlock (`background.ts:1104-1114`) — so a covered request parked in those awaits captures the *new* session and both checks pass | yes | **Adopted, Phase 5 redesigned**: the wire handler captures the fence at entry in place of its profile read and carries it on `SessionContext`; the covered branch validates it against `ctx.profileId` and forwards it; `aztec_createAuthWit` joins `FENCED_OPERATION_KINDS` and the arm never captures; a parked-handler test across a same-profile re-unlock pins the scenario |
| 2 | MEDIUM — `refreshInFlightOps` discards a late read only on a `profile.id` change (`app.store.ts:271-273`); a read issued before the lock (`Header.vue`'s `readForLock` keeps running past its budget) can land after `resetInFlight()` and restore the cancelled rows; a locked-time read can land after the unlock refresh and blank it | yes | **Adopted**: a read generation bumped by `resetInFlight()` and the unlock refresh; a read finishing under an older generation writes nothing, success or error; both orders tested |
| 3 | MEDIUM — r4 #3 asked for cross-window evidence; a queue mock proves app ordering only, and holder termination leaves a dispatched worker RPC running | yes | **Adopted in part**: the surviving-RPC wording; a two-window step in Phase 4 pinning cross-realm lock acquisition and liveness (no deadlock). **Not adopted** as an ordering or termination test: with one chain in the harness two follows differ only on the account axis, so a complete pair and an interleaved one are indistinguishable, and termination between the two writes has no deterministic trigger without test-only hooks — recorded in §Known limitations |
| 4 | LOW — contradictions: §Security still said `assertFence` right before signing; §State machine claimed operations always share one row; §Trade-offs said a profile can hold two rows on one chain | yes | **Adopted**: all three passages aligned (the two-check shape; "in a stable profile, one row"; a row *id* can change under the snapshot) |
| — | Inference 8 too absolute: superseded lock handlers return at `app.vue:168`; execute windows share the store implementation in their own realm | yes | **Adopted**: Inference 8 reworded; the execute realm's tracker is reset by its own shell the same way |
| — | Asks: prefer (b); fold Ask 2 into the execution PR, entering the transfer's task-failure handling; pin refusal-before-proving and task cleanup at both sites | — | Recorded in Asks 1–2 |

**Round 2 (resumed) → conditional approve**: "align the runner's argument positions and correct
the browser-test claim." Both adopted; "No further material problem identified in this static
pass."

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | MEDIUM — the fence is the extension service's **sixth** parameter (approvals fifth); `IExecutionRunner` has four and the dispatcher is handed the service directly (`background.ts:187`), so "one trailing parameter" would either fail typecheck or land the fence in the approvals slot and reject every silent authwit | yes | **Adopted**: `undefined` fifth placeholder, fence sixth, call spelled out, position pinned in `dispatcher.test.ts` |
| 2 | LOW — the two-window step would pass with the lock removed, and `concurrent-sendtx-confirm` opens its second window only after approving the first | yes | **Adopted**: replaced by a lock-contention step — hold the real lock from another extension page, observe the follow pending via `navigator.locks.query()` and the window held open, release, observe completion |
| — | #1's redesign closes the gap given argument six; batch legs inheriting the entry fence is correct for silent authwits and popup authwits keep their approval-time fence; #2 closes the races; #4 corrected; #3's partial adoption acceptable on ordering and termination | — | noted |

**Round 3 (resumed) → approve**: "Approve — both remaining conditions are satisfied. Confidence:
high." / "No new material findings." The codex loop on rev 6 has converged.

## Post-implementation

Executed by whichever session finishes the phases. `code_review` is `off` — do **not** run
`/code-review`; the codex loop is the review.

1. **Codex audit** (`/codex high`) over the net diff from the plan baseline, with plan.md, this
   section, the adversarial/security ask — **explicitly including Phase 0's guard change and cache
   reset, and Phase 5's authwit fence and fail-closed refusal** — and,
   verbatim:
   *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
   extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
   problem. If code works and is clear, leave it alone."*
   and
   *"Audit the comments for value per character. Flag any comment that narrates what the code
   visibly does, restates its line, references implementation plans / phases / reviews, or spends a
   paragraph where a sentence works — and flag places where a non-obvious invariant or constraint
   deserves a comment it doesn't have. Comments are permanent context every future reader, human or
   LLM, pays to re-read: they must be few, dense, and exact."*
2. **Iterative fix loop**: verify each finding against the repo before acting, apply the accepted
   ones, commit, log the round in `lessons/phase-N.md`, then RESUME the same codex session with the
   fix diff for a re-review. Repeat until a round yields no new material findings. Still material
   after 3 rounds → stop and surface. Run codex under `tmux` with a `Monitor` on its response file —
   a background-Bash codex run gets killed by the harness's low-memory watchdog — and never
   concurrently with `audit:vue`.
3. **Delivery** per §Delivery — the first time any PR is opened.

## Delivery

**Decided (D7): shape (b)** — three PRs paired by layer: a two-PR stack for the popup, one
unstacked PR for the execution layer. Delivery order 0 → 1–4 → 5 → 6.

- **Arc 1 — Phase 0**: branch `worktree-approval-scope-follow` → `dev`.
  Title (≤93 chars): `fix(popup): release the scope freeze for dapp sends and clear it on lock`.
  Unit-gated; fixes the lock-screen picker regression live on `dev`; can merge first and alone.
- **Arc 2 — Phases 1–4**: branch `worktree-approval-scope-follow-banner`, stacked on arc 1.
  Title: `feat(execute): show the transaction's scope and follow it after confirming`.
  Attaches screenshots of the banner states; quotes the owner's copy sign-off (2026-09-16).
- **Arc 3 — Phase 5**: branch `worktree-approval-scope-follow-execution` → `dev`, **unstacked**.
  Title (78 chars): `fix(execution): fence authwits and refuse sends without a journal record`.
  Carries the `batch-mixed` e2e gate; quotes the owner's sign-off on the refusal copy (Ask 3) —
  **not opened until that sign-off exists**.
- Each PR: its own codex loop at its boundary; the stack gets a cross-arc pass.
  `gh stack submit --auto --open` for the stack, `gh pr create` for arc 3, each only after its
  loops converge (`--auto` opens drafts otherwise); then `gh pr checks --watch`.
- Required gates on `dev`: `quality-status`, `extension-network-e2e-status`,
  `extension-smoke-e2e-status`. The owner merges; the implementing session never does.

## Seeds

Final for delivery shape (b) (D7). Arc 3's PR additionally waits on the Ask 3 sign-off; the
implementing session records the quote in plan.md's Copy section before opening it.

```
/goal All phases (0–6) marked ✓ in implementations-plan/approval-scope-follow/plan.md, each ✓ backed by its phase's validation gate reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/approval-scope-follow/lessons/phase-N.md in the transcript; /code-review was NOT run (code_review: off); the codex fix loop converged for arc 1 (Phase 0) at its boundary, for arc 2 (Phases 1–4) at its boundary, for the stack's cross-arc pass, and for arc 3 (Phase 5) at its boundary — each evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the two-PR stack into dev and the unstacked execution PR exist, created only after that convergence and, for the execution PR, only after the owner's refusal-copy sign-off is quoted in plan.md (gh stack view and gh pr view output in the transcript); bun run audit:vue, the smoke suite and the three network e2e files (execute-scope-chain, execute-scope-account, batch-mixed) report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/approval-scope-follow forward. Never idle waiting for my input. Each firing: read plan.md and lessons/ as authoritative state, rebuild the task list from plan.md's phase headers if empty, run git status and git log --oneline -5. No task in hand? Start the next pending phase in delivery order (0, then 1–4, then 5, then 6); after each meaningful edit run the fast layers (cd apps/extension && bun --bun vitest run <touched dir>, then bun run typecheck && bun run lint from the worktree root), then commit and push. Stuck, or facing a decision you'd bring to me? Call /codex high (under tmux, never concurrent with audit:vue) and argue it out, then act and log the consult in lessons/phase-N.md. Same step failed 5 times? Stop retrying and reassess with codex. Phase green means THE PHASE'S VALIDATION GATE in plan.md passes — run it, paste the result, mark ✓, file the lessons entry, print LESSONS_FILE=..., advance. Arc 1 (Phase 0) done? Run its codex loop, then gh stack init and branch arc 2 on it; Phases 1–4 done? Run arc 2's loop and the cross-arc pass, then gh stack submit --auto --open. Phase 5 done on its own unstacked branch? Run its loop; open its PR with gh pr create only once plan.md quotes my sign-off on the refusal copy — otherwise leave it unopened and say so. Every codex pass carries the no-over-engineering and comment-quality rules verbatim and names Phase 0's guard change and cache reset and Phase 5's fence and fail-closed refusal explicitly; fix, resume, loop until clean (3 rounds max), then gh pr checks --watch. Hard limits: never merge, never publish, never touch commitScopeChange's contract or the lock-screen selector's behaviour beyond what Phase 0 states, never expand scope beyond plan.md.
```
