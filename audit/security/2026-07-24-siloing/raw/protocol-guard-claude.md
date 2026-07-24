# Security audit — Cluster C (durable causal protocol) + Cluster D (in-flight-send guard, journal locking, dApp account resolver)

Auditor: Claude (adversarial pass). Base: `git diff dev...HEAD` on `worktree-account-profile-siloing`.

## Wiring status (read this before weighing anything in Cluster C)

`packages/wallet-core/src/activity/causal.ts` (`applyMutation` / `applySnapshot` / `resetScope` / `liveRecords`) and
`apps/extension/src/wallet/services/activity-protocol/coordinator.ts` (`ActivityProtocolCoordinator`) have **no production
importer on this branch** — the only importers are `causal.property.test.ts` and `coordinator.test.ts`. Verified by
grep across `apps/` + `packages/`. Only `activityScopeKey` (`scope.ts`) is production-wired
(`stores/activity.store.ts:98,122,144,190,199`).

Consequence: every Cluster C defect below is a **latent design defect with no live exploit path today**. They are
reported because the brief asked the specific questions and because the code is staged for wiring, and they are
severity-capped at Low for that reason. Cluster D is fully production-wired.

**Working-tree drift note:** while this audit ran, another session modified `queued-journal.ts`, `activity.store.ts`
and `app.store.ts` in the working tree (uncommitted). Findings are stated against the audited commit (HEAD); where an
uncommitted edit already addresses an instance, it is called out inline.

---

## F1 — A connected dApp can hold the account-switch guard on at will, and the documented escape hatch (cancel) is unreachable in the configuration the attacker picks

**1. Title:** dApp-controllable `queued` journal records drive a profile-wide account-switch block whose cancel affordance is account+network-scoped.

**2. Impact / exploitability factors**
- *Violated:* **Availability** (the user cannot switch accounts), and, in a privacy wallet, an **integrity-of-compartmentalization** effect: the attacker pins the user to whichever account is active, which is the exact control a user reaches for when they want to stop transacting from an identity a dApp knows.
- *Blast radius:* one profile, all of its accounts, for as long as the attacker keeps a session open. No funds move; no secrets leak.
- *Attack vector:* remote (the dApp page), over the established wallet-sdk channel.
- *Complexity:* low — send `sendTx` messages on a timer.
- *Privileges required:* an approved dApp session with a `transaction` capability grant (i.e. a dApp the user has already connected and transacted with) and an unlocked wallet.
- *User interaction:* none beyond the one-time connect. The attacker does **not** need the user to approve anything.

**3. Evidence confidence:** high (every hop is a read line, no inference).

**4. OWASP / CWE:** OWASP A01:2021 Broken Access Control (untrusted party influencing a trusted-UI decision); CWE-770 Allocation of Resources Without Limits or Throttling; CWE-1088 Synchronous Access of Remote Resource without Timeout is *not* it — the closer secondary is CWE-841 Improper Enforcement of Behavioral Workflow.

**5. TRACE**

1. Untrusted input enters: a `sendTx` `WalletMessage` from the dApp origin —
   `apps/extension/src/wallet/services/wallet-sdk/background.ts:263` (`onWalletMessage`), dispatched to
   `background.ts:283-293`.
2. Before any approval UI, a journal record is created at stage `queued`:
   `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:95` → gates at `:102-112` (active profile, session
   exists, `transaction` grant) → caps at `:141-157` (8/session, 32 global) → `journal.createOperation({ kind:
   "dapp_execute", …, initialStage: { stage: "queued" } })` at `queued-journal.ts:173-183`.
3. That record is durable in `chrome.storage.local` (`operation-journal/service.ts:96-98`) and is fanned out to the
   popup via `onOperationAdded` (`service.ts:210`).
4. The popup's guard ingests it: `apps/extension/src/composables/useInFlightSend.ts:30-32` (event subscriptions),
   `:40` (`journal.getOperations({ profileId })`), `:59` (`hasInFlightSend(ops.value, appStore.profile?.id)`).
5. The predicate returns true for it: `apps/extension/src/utils/in-flight-send.ts:18` (`queued` ∈ `IN_FLIGHT_STAGES`),
   `:21` (`dapp_execute` ∈ `SENDING_KINDS`), `:35-38` — the filter is **`op.profileId === profileId` only**; account,
   network and origin are not considered.
6. Harm manifests: `apps/extension/src/popup/components/popups/AccountsPopup.vue:38-41` — every account row click is
   refused with a toast and `appStore.selectAccount` (`:43`) is never reached.
7. The escape hatch does not exist in the attacker-chosen configuration: the cancel button lives on
   `TransactionAwaitingCard`, rendered from `RecentActivityView.vue:786`/`:845` over `renderedInFlightOps` (`:346`) ←
   `inFlightJournalOps` (`:293-303`) ← `journalRecordInScope(op)` (`:278-291`), whose first line is
   `if (op.accountAddress !== appStore.account?.address) return false` (plus network at `:288`). The record blocking
   the switch is filed under the dApp's session account / the dApp's chain, so when the user is on any other account
   or network **no card renders and there is nothing to cancel**.
8. Self-clearing is bounded but re-armable: `operation-journal/reaper.ts:77` gives stage `queued` a 10-minute grace
   window; the attacker re-arms by sending another message.

**6. Missing control**
The block and the remedy must be scoped identically. Either (a) scope `hasInFlightSend` to the **active scope**
(profile + account + network) so the blocking record is always the one the user can see and cancel, or (b) keep the
profile-wide block but make the toast actionable — navigate to / render the blocking record regardless of active
scope (the plan's §9.2 explicitly promised "a link to the pending card"; it was not implemented), or (c) exclude
`queued` records that were created by a dApp and not yet claimed by the user-facing handler from the predicate (they
represent an *unapproved* request, not an in-flight send — the guard's stated purpose is "work already under way …
building and proving", which a `queued` record by definition is not).

**7. Concrete exploit story**
User has profile P with accounts A (dApp-authorized) and B (fresh, for private receipts). They connected `evil.xyz`
weeks ago and granted the `transaction` capability for A. The user is currently on account B.

`evil.xyz` runs, on page load and every 60 s: `wallet.sendTx({ calls: [ … ] })`. Each call creates a `queued`
`dapp_execute` record for account A (`queued-journal.ts:173`). Message #1's approval popup opens in a separate
window; the user closes it, which fails only that record. Messages #2-#8 never reach the handler until the FIFO baton
advances (`background.ts:295-309`), so they sit at `queued`. The user opens **Switch Account** and clicks A — refused:
"Finish or cancel your pending transaction first". They look at the activity feed: it is empty of in-flight cards,
because every blocking record names account A while B is active (`RecentActivityView.vue:279`). They cannot cancel
what is not rendered, and they cannot switch to A to render it. The wallet stays pinned to B (or to whatever account
was active) for as long as `evil.xyz` keeps a tab open.

**8. Preconditions**
Approved dApp session for the origin on the chain (`dappSession.accounts` non-empty), a `transaction` capability
grant (`queued-journal.ts:111`), unlocked wallet with an active profile (`:102`), and the user's active account or
network differing from the record's for the "unreachable cancel" amplification (the block itself applies regardless).

**9. Why existing mitigations fail**
- The per-session (8) and global (32) caps (`queued-journal.ts:35-37,145,154`) bound *how many* records exist, not
  *how long* — one is enough to hold the guard.
- The reaper (`reaper.ts:77`) clears a record after 10 minutes, but nothing rate-limits new `sendTx` messages, so the
  hold renews indefinitely.
- The boot sweep (`reaper.ts:118-130`) only runs at service-worker start; an active dApp channel keeps the SW alive.
- Wallet **lock** is deliberately not blocked (`in-flight-send.ts:11-12`), but locking does not terminalize the
  records either — after unlock the same rows are still `queued` and still block.
- The one thing that does clear the block today is the *unguarded* Manage Accounts switch path — which is F3, i.e. a
  second bug, not a control.

**10. Instances (same root cause: block scope ⊃ remedy scope)**
- `apps/extension/src/utils/in-flight-send.ts:35-38` — profile-scoped predicate.
- `apps/extension/src/composables/useInFlightSend.ts:40,59` — profile-scoped fetch/compute.
- `apps/extension/src/popup/components/popups/AccountsPopup.vue:38-41` — consumer with a non-actionable toast.
- `apps/extension/src/popup/components/modules/general/RecentActivityView.vue:278-291,293-303` — scope-narrowed cancel
  surface.
- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:173-183` — the dApp-reachable producer of the state
  the guard keys on.

---

## F2 — The shared account resolver is fed inputs derived by two different rules, so the journal record and the actual sender can name different accounts

**1. Title:** `tryCreateQueuedJournal` and `WalletSdkDispatcher.resolveNetworkAndAccount` call one resolver with divergently-derived `requestedFrom` and `walletAccounts`, defeating the "filed under the account it is sent from" claim.

**2. Impact / exploitability factors**
- *Violated:* **Integrity** of the wallet's own transaction history / attribution (a send from account B is recorded
  against account A), and, via F1's mechanism, **availability** (the in-flight card is rendered under an account the
  user may not be on, so it is neither visible nor cancellable while it blocks switching).
- *Blast radius:* one operation record per malicious request; unbounded in count.
- *Attack vector:* remote (dApp), one wire-legal field.
- *Complexity:* low (`{ from: ["0x…"] }` instead of `{ from: "0x…" }`).
- *Privileges required:* approved session authorizing **≥ 2** accounts.
- *User interaction:* the user still approves the send in the fee popup, and that popup shows the *dispatcher-resolved*
  account — so the user is not deceived at approval time; the falsified record is the durable history entry.

**3. Evidence confidence:** high for the `from`-coercion instance (both code paths read the same `args[1]`, with
demonstrably different coercion); high for the visible/hidden instance as it existed at HEAD (already patched in the
working tree); low for the chain-filter instance (reachability depends on whether a stored `DappSession.accounts` can
ever hold a foreign-chain CAIP, which I did not establish).

**4. OWASP / CWE:** OWASP A04:2021 Insecure Design; CWE-1289 Improper Validation of Unsafe Equivalence in Input;
CWE-20 Improper Input Validation (type confusion via implicit `String()` coercion); CWE-778 Insufficient Logging
(secondary — the durable record is the log, and it is wrong).

**5. TRACE (primary instance — `from` coercion)**

1. Untrusted input enters as `args[1].from` of a `sendTx` message: `background.ts:263` → `:283-293`.
2. Journal side: `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:70-75` —
   `if (typeof from !== "string" || from === "NO_FROM") return undefined`. A JSON array `["0xB"]` is **not** a string,
   so `extractSendFrom` returns `undefined` = "no explicit sender".
3. That `undefined` reaches the shared resolver at `queued-journal.ts:121-125` →
   `packages/wallet-bridge/src/account-resolution.ts:58` — the no-`from` branch → **first wallet-ordered
   session-authorized account** (call it A).
4. The record is created naming A: `queued-journal.ts:173-183` (`accountAddress`).
5. Dispatcher side, same `args[1]`: `packages/wallet-bridge/src/dispatcher.ts:643-649` —
   `isNoFromRequest(rawOpts.from)` is `from === "NO_FROM"` (`:163-165`) → false; `rawOpts.from == null` → false;
   therefore `requestedFrom = String(["0xB"])` → `"0xB"`.
6. Resolver, explicit branch: `account-resolution.ts:53-55` matches account **B** (session-authorized) → `ok`.
7. `dispatcher.ts:667` rewrites `opts.from = account.address` = B, and the operation executes as B.
8. Harm: the durable record still says A. Nothing re-checks it — `claim-helper.ts:78-175` claims the record by id and
   only transitions its stage; `operation-journal/service.ts:296-303` writes `progress/error/terminalAt/updatedAt`
   only; `setOperationMeta` (`:322-346`) touches title/subtitle only. `accountAddress` is never corrected for the
   record's whole lifetime, including the terminal card.

**TRACE (second instance — visible vs hidden account list, as committed at HEAD)**

1. `queued-journal.ts:120` (HEAD): `accountSvc.getAccounts(activeProfile.id, chainId, true)` → `all = true` →
   `apps/extension/src/wallet/services/account/service.ts:91` `(all || x.visible)` → **includes hidden accounts**.
2. `packages/wallet-bridge/src/dispatcher.ts:1356`: `this.accountService.getAccounts(ctx.profileId, network.chainId)`
   → `all` undefined → **visible only**.
3. Both lists are index-sorted (`service.ts:94`), so with a hidden account at a lower index the two sides pick
   different defaults for the same no-`from` request → same divergence as above, and the record names an account the
   UI cannot even select (`AccountsPopup.vue:31` and `settings/accounts/index.vue:27` both filter `a.visible`), so the
   in-flight card is unreachable in **every** UI state while it blocks switching (F1).
4. *Status:* an uncommitted working-tree edit changes this line to `getAccounts(activeProfile.id, chainId)` with a
   comment naming exactly this divergence. The instance is real at the audited commit and is addressed in the tree.

**6. Missing control**
The shared resolver removed the *decision* duplication but left the *input derivation* duplicated. Push the input
derivation into the shared module too: one exported `extractRequestedFrom(opts)` used by both sides (rejecting
non-string `from` identically — refuse, do not coerce with `String()`), and one exported way to obtain
`walletAccounts` (same `all` flag, same chain filter). Failing that, a defensive equality check at claim time —
compare the queued record's `accountAddress` against the dispatcher-resolved account and either correct it or refuse
the claim — would make a divergence non-silent (`claim-helper.ts:78`).

**7. Concrete exploit story**
User grants `evil.xyz` accounts A (index 0) and B (index 1). The dApp calls
`sendTx({calls:[…]}, { from: ["0xB…"] })`. The queued card and, after approval, the whole durable history entry are
filed under **A**; the transaction is signed and broadcast from **B**. The user's own wallet history now attributes a
B transaction to A. If the user is sitting on B at the time, the in-flight card (filed under A) never renders, so the
send cannot be cancelled from the feed while `hasInFlightSend` blocks them from switching to A to find it.

**8. Preconditions**
Session authorizing ≥ 2 accounts; `transaction` capability granted (else `queued-journal.ts:112` returns early and no
record is created at all — the dispatcher still sends, so the divergence degrades to "no record"); the named account
must be session-authorized (an unauthorized one is correctly refused at `account-resolution.ts:55`).

**9. Why existing mitigations fail**
- `resolveAuthorizedSessionAccount` is provably correct in isolation (it does refuse an out-of-session explicit
  `from` — see Verified non-findings) — the bug is entirely in what it is handed.
- `queued-journal.ts:126-129` refuses to journal an *unresolvable* sender, but the coerced case resolves fine on both
  sides; they just resolve differently.
- `background.ts:694-707` only terminalizes a `queued` record when the dispatch **throws**; the array-`from` case does
  not throw (it resolves to a real authorized account).
- Zod validation of `sendTx` args happens in the upstream SDK on the dApp side; a raw protocol client bypasses it —
  the repo already acknowledges this exact bypass at `dispatcher.ts:603-618`.

**10. Instances (root cause: shared decision, unshared inputs)**
- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:70-75` vs
  `packages/wallet-bridge/src/dispatcher.ts:163-165,649` — `from` extraction/coercion.
- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:120` (HEAD) vs
  `packages/wallet-bridge/src/dispatcher.ts:1356` — `all` flag on `getAccounts`.
- `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts:119` (no CAIP chain filter) vs
  `packages/wallet-bridge/src/dispatcher.ts:1327-1333` (`getSessionAccountAddresses` filters by
  `aztec:<chainId>:`) — third input axis; flagged as hardening, reachability not established.

---

## F3 — The switch guard is applied at one of four call sites that change the active account, so the invariant it is the sole enforcement of ("active is constant for a send's lifetime") does not hold

**1. Title:** `hasInFlightSend` gates only `AccountsPopup`; Manage Accounts, hide-account and create-account all move the active account unguarded.

**2. Impact / exploitability factors**
- *Violated:* **Integrity** of the plan's §9.1 invariant, which is what replaced the abort-on-drift machinery — every
  "active-now" read in the execution path is justified by this invariant holding at *all* switch intents, not one.
  Also **availability**: the asymmetry creates a reachable state where the user is locked out of switching back with
  no visible way out.
- *Blast radius:* the active profile; user-driven, not attacker-driven (an attacker uses F1 to create the in-flight
  state, then the user's own second switch path does the rest).
- *Attack vector:* local UI.
- *Complexity:* trivial — the guarded popup itself links to the unguarded page (`AccountsPopup.vue:61`).
- *Privileges required:* the user.
- *User interaction:* required.

**3. Evidence confidence:** high for the enforcement gap (four call sites, one guard, all read). Moderate for the
downstream signing impact: I traced the send path and the account address is threaded explicitly
(`send.vue:300-309` snapshots `appStore.account.address` before any await; `tx-request-builder.ts:113-116` and
`:381-386` take `op.accountAddress`; only `requireActiveProfile` and `execution-lane.ts:188-192` read active-now, and
those are profile-level). So today the gap does **not** demonstrably produce a wrong-account signature — but the
design document treats the guard as the reason those reads are safe, and any future active-now account read inherits
an unenforced invariant.

**4. OWASP / CWE:** CWE-841 Improper Enforcement of Behavioral Workflow; CWE-693 Protection Mechanism Failure
(incomplete mediation — one of N paths guarded).

**5. TRACE**

1. Guard, the only one: `apps/extension/src/popup/components/popups/AccountsPopup.vue:38-41`.
2. Unguarded path 1: `AccountsPopup.vue:60-63` (`handleManageAccounts`) routes to
   `apps/extension/src/popup/pages/settings/accounts/index.vue:30-32` → `appStore.selectAccount(acc)` with no
   predicate — the guarded popup literally offers the bypass as a button.
3. `apps/extension/src/stores/app.store.ts:67-72` — `selectAccount` mutates `account.value` and persists
   `nulo:ui:activeAccount`; nothing here consults the journal.
4. Unguarded path 2: `apps/extension/src/stores/app.store.ts:73-88` — `changeAccountVisibility(acc, false)` reassigns
   `account.value` at `:82` when the hidden account was active; reachable from
   `settings/accounts/index.vue:39-44` mid-send.
5. Unguarded path 3: `apps/extension/src/popup/components/popups/NewAccountPopup.vue:55-60` — `appStore.account =
   account` plus the persisted key; reachable from `AccountsPopup.vue:117-125` ("New account") while the same popup is
   refusing switches.
6. Harm manifests: `apps/extension/src/stores/app.store.ts:132-148` — `activeScope` recomputes and
   `activity.activateScope(scope)` swaps the feed; the in-flight record for the old account is now filtered out of
   `inFlightJournalOps` (`RecentActivityView.vue:278-303`), while `hasInFlightSend` (profile-scoped,
   `in-flight-send.ts:35-38`) still returns true — so the *return* switch through `AccountsPopup` is now blocked and
   the card offering "cancel" is not rendered anywhere.

**6. Missing control**
Move the predicate below the UI: have `appStore.selectAccount` (and the `changeAccountVisibility` reassignment, and
`NewAccountPopup`'s direct assignment) consult the same `hasInFlightSend` source and refuse, so the guard cannot be
bypassed by reaching a different screen. A guard implemented in one `.vue` handler is not an invariant.

**7. Concrete exploit story**
User starts a transfer from account A (`send.vue:322`), navigates back, opens Switch Account, is refused, clicks
"Manage accounts" in the very same popup, and taps account B — the switch goes through. The in-flight A card
disappears from the feed. They now try to switch back to A through Switch Account and are blocked by the toast that
tells them to cancel a transaction that no screen will render. Their remaining options are: wait out the send, or
wait out the reaper.

**8. Preconditions**
A non-terminal `transfer`/`dapp_execute` record for the active profile (their own send, or F1's dApp-created one).

**9. Why existing mitigations fail**
The e2e that pins this behaviour (`apps/extension/tests/e2e/network/in-flight-send-guard.test.ts:53-60`,
`attemptSwitch`) drives the popup only, so the three unguarded paths are green by omission.

**10. Instances**
- `apps/extension/src/popup/pages/settings/accounts/index.vue:30-32`
- `apps/extension/src/stores/app.store.ts:80-87` (`changeAccountVisibility` active-account reassignment)
- `apps/extension/src/popup/components/popups/NewAccountPopup.vue:55-60`
- (guarded, for contrast) `apps/extension/src/popup/components/popups/AccountsPopup.vue:38-43`

---

## F4 — `deleteOperation` is now lock-serialized but the two bulk journal purges are not, so a concurrent transition resurrects rows that a profile/chain deletion just removed

**1. Title:** `clearChainState` / `purgeForProfile` delete outside `transitionLock`, re-opening the exact
delete-vs-transition race the new `deleteOperation` lock closes.

**2. Impact / exploitability factors**
- *Violated:* **Confidentiality of deletion / integrity** — a journal row that survives "delete profile" retains
  `origin` (the dApp URL), `accountAddress`, `recipientAddress`, `amountRaw`, `title`, `subtitle` and `profileId` of
  a profile the user believes is gone, in plaintext in `chrome.storage.local`.
- *Blast radius:* one row per race win; the row is orphaned (its profile no longer exists) so nothing deletes it
  later — the reaper only *fails* non-terminal records (`reaper.ts:170-180`), it never deletes.
- *Attack vector:* local/timing; an attacker who can drive dApp traffic (F1) can raise the odds by keeping a
  transition in flight while the user deletes the profile.
- *Complexity:* medium — needs a transition's load→write window (`service.ts:236-304`) to straddle the purge.
- *Privileges required:* a connected dApp for the amplified version; none for the accidental version.
- *User interaction:* the user performs the delete.

**3. Evidence confidence:** moderate-high. The window is small (both sides are `chrome.storage.local` round-trips) but
it is precisely the window the diff's own comment says must be closed, and the bulk paths are demonstrably outside
the lock.

**4. OWASP / CWE:** CWE-362 Concurrent Execution using Shared Resource with Improper Synchronization (TOCTOU);
CWE-212 Improper Removal of Sensitive Information Before Storage or Transfer.

**5. TRACE**

1. The new control: `apps/extension/src/wallet/services/operation-journal/service.ts:424-438` — `deleteOperation`
   takes `transitionLock` "so a transition that has already read the row [cannot] write it back after the delete and
   resurrect it" (`:427-428`).
2. The contract the class now advertises: `service.ts:77-81` — "*Every* path that reads a row and then writes (or
   deletes) it takes this lock".
3. Violation 1: `service.ts:148-156` `clearChainState` → `purgeRows(records, (r) => this.storage.delete(r.id), …)`
   with **no** `transitionLock.enter()`. Called from the chain-purge cascade at `service.ts:112`.
4. Violation 2: `service.ts:161-169` `purgeForProfile` → same shape, no lock. Called by the profile-deletion
   coordinator.
5. The racing writer: `service.ts:227-232` → `_transitionLocked` at `:236` loads the row, `:304` writes it back. The
   lock it holds excludes `deleteOperation` but **not** `clearChainState`/`purgeForProfile`.
6. Harm: `storage.set(id, updated)` at `:304` lands after `storage.delete(record.id)` at `:153`/`:166` → the row
   re-materializes under a `profileId` that no longer has a profile. `purgeRows`
   (`apps/extension/src/wallet/services/purge-rows.ts:23-27`) iterates a *snapshot* taken at `:150`/`:163`, so it
   never revisits it.

**6. Missing control**
Take `transitionLock` around the load+delete loop in both bulk purges (or, if holding it for a long loop is
unacceptable, re-check-and-delete under the lock per row). The class comment at `service.ts:77-81` should then be
true rather than aspirational.

**7. Concrete exploit story**
User has a dApp mid-`sendTx` (record in `proving`). They delete the profile from settings.
`purgeForProfile` snapshots the rows and starts deleting; the executor's `submitting → succeeded` transition, already
past its `_loadValidated` read, writes its row back a few milliseconds after the purge deleted it. The profile is
gone from every list, but `nulo:journal@<id>` still holds `{profileId: "<deleted>", origin: "https://evil.xyz",
accountAddress: "0x…", recipientAddress: "0x…", amountRaw: "…"}` forever.

**8. Preconditions**
A non-terminal operation transitioning concurrently with a profile or chain purge.

**9. Why existing mitigations fail**
`purgeRows`'s doc (`purge-rows.ts:6-11`) explicitly leaves locking to the caller ("any `this.lock.enter()/leave()` …
stay visibly caller-side"), and these two callers do not take it. The reaper cannot clean up after this: it
transitions to `failed` (`reaper.ts:170-190`) and never deletes.

**10. Instances**
- `apps/extension/src/wallet/services/operation-journal/service.ts:148-156` (`clearChainState`)
- `apps/extension/src/wallet/services/operation-journal/service.ts:161-169` (`purgeForProfile`)
- (correct, for contrast) `service.ts:429-437`, `:328-345`, `:369-377`, `:227-232`

---

## F5 — `advance()` wedges permanently and grows without bound on any allocation that never settles (dormant)

**1. Title:** An `allocate` with no matching `settle`/`abandon` pins `committed` below the gap forever and turns
`settled` into an unbounded array in a storage row.

**2. Impact / exploitability factors**
- *Violated:* **Availability** (storage growth; a permanently stale watermark) and **integrity** (a watermark that
  never advances means `installSnapshot`'s "absence is authoritative at the watermark" never applies, so records
  deleted server-side are never removed from a client's view — a deleted activity row that will not go away).
- *Blast radius:* one `(scope, source)` row, permanently, once triggered — and the trigger is routine.
- *Attack vector:* none needed; MV3 service-worker termination between `allocate` and the caller's `settle` is the
  normal failure mode this protocol exists to survive.
- *Complexity/privileges/interaction:* n/a — self-inflicted.
- **Dormant:** no production caller exists on this branch (see Wiring status).

**3. Evidence confidence:** high on the mechanism; the impact is contingent on the wiring that does not exist yet.

**4. OWASP / CWE:** CWE-770 Allocation of Resources Without Limits or Throttling; CWE-400 Uncontrolled Resource
Consumption; CWE-459 Incomplete Cleanup.

**5. TRACE**

1. `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:168-177` — `allocate` durably increments
   `allocated` and returns; the doc at `:161-167` states the caller "MUST follow up with `settle` … or `abandon`, or
   the watermark stalls at the gap".
2. Nothing enforces or recovers that: there is no scan reconciling `allocated` against `committed ∪ settled`
   anywhere in the file, and no caller exists to own the obligation.
3. `coordinator.ts:195-204` `record` → `advance` at `:201`.
4. `coordinator.ts:66-75` `advance`: `while (settled.has(increment(committed)))` — a missing sequence N stops the
   walk permanently; `:73` keeps every settled sequence `> committed`, so each later operation appends one more
   string to the row and none is ever consumed.
5. Harm surfaces at `coordinator.ts:207-211` (`watermark` returns the frozen `committed`) and, once wired, at
   `packages/wallet-core/src/activity/causal.ts:229-234` (the absence-is-authoritative sweep is gated on
   `held.seq <= watermark`, so it stops doing anything) and `causal.ts:76-78` (coverage never grows).
6. Secondary: `advance` is O(n log n) in `settled` per settle (`coordinator.ts:73`), with n unbounded.

**6. Missing control**
Either make the allocation self-healing — persist an outstanding-allocation set and reconcile at service start
(the boot sweep already exists for the journal: `reaper.ts:118-130`) — or cap `settled` and force `committed` forward
past a gap older than a bounded age, or drop the allocate/settle split in favour of allocating at commit time.

**7. Concrete exploit story**
Not attacker-driven. A user sends a transaction; the coordinator allocates seq 5; Chrome suspends the service worker
before the row write completes. On the next SW lifetime the wallet keeps working, but `committed` for that
`(scope, source)` is stuck at 4 forever: every subsequent transaction appends to `settled`, the row grows
monotonically in `chrome.storage.local`, and every snapshot this scope ever publishes claims authority over nothing.

**8. Preconditions**
The protocol is wired to a producer; one allocation fails to settle or abandon.

**9. Why existing mitigations fail**
`abandon` (`coordinator.ts:191-193`) exists but must be called by the same execution that just died; the abort path
it depends on is exactly the one MV3 termination skips. `retireScope` (`:143-158`) resets counters but is an explicit
user-level event (chain purge / account re-add), not a recovery path.

**10. Instances**
- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:66-75` (`advance`)
- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:168-177` (`allocate` — the unenforced
  obligation)
- `apps/extension/src/wallet/services/activity-protocol/spec.ts:46-56` (`ActivityCounterRow.settled` — unbounded by
  schema)

---

## F6 — `purgeProfile` is the only coordinator method that takes no lock, so a concurrent `currentIncarnation` leaves rows behind after a profile is deleted (dormant)

**1. Title:** Unsynchronized `getAll`-then-delete in `purgeProfile` races the scope-locked minting path.

**2. Impact / exploitability factors**
- *Violated:* **Confidentiality of deletion** — an `nulo:core:activity-incarnations` / `-counters` / `-tombstones`
  row keyed by a JSON scope key containing the deleted `profileId`, `networkId` and account address survives the
  purge; and **integrity**, because a restored profile that reuses the id inherits a stale incarnation/counter.
- *Blast radius:* residual metadata rows (identifiers, not balances or secrets).
- *Attack vector:* local timing.
- *Complexity:* high (needs a mint concurrent with the purge sweep).
- **Dormant:** `purgeProfile` has no production caller on this branch.

**3. Evidence confidence:** moderate (the race is structural; no live caller to demonstrate it).

**4. OWASP / CWE:** CWE-362 (TOCTOU); CWE-459 Incomplete Cleanup.

**5. TRACE**

1. Every other coordinator method serializes: `coordinator.ts:126` (`withScope`), `:145`, `:170`, `:197`, `:216`,
   `:239` — and the file's own lock-order contract is stated at `:9-15`.
2. `coordinator.ts:255-267` `purgeProfile` takes **no** lock: it reads `incarnations.getAll()` at `:259` and
   `store.getAll()` at `:263`, then deletes.
3. Racing writer: `coordinator.ts:124-133` `currentIncarnation` mints and writes a row for a scope of the same
   profile under the *scope* lock — which `purgeProfile` does not hold, so the two interleave freely.
4. Harm: a row created after the `getAll()` snapshot is never visited; it persists keyed by
   `JSON.stringify([profileId, networkId, chainId, address])` (`packages/wallet-core/src/activity/scope.ts:53`) for a
   profile that no longer exists.

**6. Missing control**
Acquire the scope lock per key inside the loop (the file's own §"Multi-scope work sorts scope keys before acquiring"
rule at `:13-15` describes the discipline it then does not follow here), or re-run the sweep until it converges.

**7. Concrete exploit story**
Profile deletion runs `purgeProfile("p1")`; between its `getAll()` and its deletes, a still-running incoming-transfer
poll calls `currentIncarnation` for `p1`'s scope, minting a fresh row. Deletion reports success; the row remains.

**8. Preconditions** Wiring plus a concurrent producer during deletion.

**9. Why existing mitigations fail** `purgeScope` (`:237-246`) *is* locked, but `purgeProfile` does not delegate to it
— it re-implements the sweep locklessly.

**10. Instances**
- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:255-267`

---

## Verified non-findings (probes the brief asked for that came back clean)

- **`purgeProfile`'s prefix match is NOT forgeable by a hostile `profileId`.** `coordinator.ts:256-257` builds
  `` `[${JSON.stringify(profileId)},` `` and the key is `JSON.stringify([profileId, …])` (`scope.ts:53`). JSON string
  encoding is injective and escapes `"` and `\`, and the encoding of `profileId` always terminates in an unescaped
  `"` immediately followed by `,` in the array form — so `enc(A)+","` can only prefix a key whose first element is
  exactly A. A profile id of `a","b` encodes as `"a\",\"b"`, which cannot alias `"a"`. Neither cross-profile deletion
  nor a missed self-match is reachable.
- **`resolveAuthorizedSessionAccount` does refuse an out-of-session explicit `from`.**
  `packages/wallet-bridge/src/account-resolution.ts:53-55` returns `{ ok:false, reason:"not-authorized" }` rather than
  falling through to the default; `dispatcher.ts:1370-1371` converts that to a throw. The refactor preserves the
  pre-diff semantics exactly (see the removed branch in `git diff dev...HEAD -- packages/wallet-bridge/src/dispatcher.ts`).
  The defect is in the *inputs* (F2), not this function.
- **Taking `transitionLock` in `deleteOperation`/`setOperationMeta` introduces no deadlock or lock-order inversion.**
  `Lock` is non-reentrant with a 5-minute force-release (`packages/wallet-core/src/utils/lock.ts:4,36-43`), so
  re-entry would matter — but the only call made while holding it is `this.emit(...)`
  (`operation-journal/service.ts:341,434`), and `emit` is synchronous and never awaits a listener
  (`packages/extension-messaging/src/core/base-service.ts:128-132`), so a listener that calls back into the journal
  merely queues behind the current holder. Observed acquisition order is one-directional in every path I traced:
  `queuedCreationLock` (`queued-journal.ts:139`) → journal methods that take no lock (`countOperations`,
  `createOperation`); execution mutex (`execution-lane.ts:217`) → `transitionLock` (`claim-helper.ts:126`); nothing
  takes a scope/profile/queued lock *while holding* `transitionLock`. No inversion found.
- **`compareCounter`/`BigInt` cannot be made to throw from persisted state through the coordinator.** Every row is
  parsed through `^\d+$` schemas before use (`activity-protocol/spec.ts:14,52-56,63-65`), and JS `$` is a strict
  end-anchor (no trailing-newline hole). The residual hazards are (a) a schema-invalid row reading back as `undefined`
  and silently resetting a counter to `EMPTY_COUNTER` (`coordinator.ts:172,199`), and (b) `tombstone()`'s
  `row.tombstones[recordId]` prototype-chain read at `coordinator.ts:219` returning a `Function` for
  `recordId === "toString"`, which would throw inside `compareCounter`. Neither is reported as a finding: both need
  local-store tampering or an attacker-chosen `recordId`, and no production producer supplies either — but (b) is
  cheap to harden (`Object.hasOwn` or a `Map`).
- **`activityScopeKey`'s throw path is not reachable from untrusted data on the wired path.** `app.store.ts:132-143`
  validates every component (including `Number.isSafeInteger(chainId) && chainId >= 0`) before constructing a scope,
  and the only other constructor is `txScope` (`activity.store.ts:64-71`) over locally-produced `Tx` rows.
</content>
</invoke>
