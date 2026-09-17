# Audit — same-family leg (Claude Opus 5, `Plan` subagent) on plan rev 1

Run in parallel with the codex leg, against plan.md **rev 1**. Several findings (I3, I6b) had
already been fixed independently in rev 2 by the time this report landed — two reviewers converging
on the same fix. Verdict and disposition are recorded in plan.md §Decision ledger.

---

## 1. Adversarial / security

**A1 — CRITICAL/HIGH: the follow hands a connected dApp the wallet's default *signing* scope.**
The plan puts the wallet's own send flow Out of scope with "it always builds against the active
scope and cannot mismatch." That is precisely the hazard, not the defence. After a follow, the
active scope is whatever the dApp's operation named. A site holding grants on accounts A and B
routes one trivial approved operation through B; the wallet is now on B, the user's next manual Send
defaults to B, and nothing re-confirms. Not key compromise, but a dApp choosing a signing default
through a click the user believes was only about that dApp's transaction. Demand either an
after-the-fact signal on the next popup open, or an owner decision that this is acceptable.

**A2 — HIGH: the follow moves the viewed scope *into* the scope where the dApp's own journal records
live, re-opening a hole `in-flight-send.ts` documents as deliberately closed.**
`apps/extension/src/utils/in-flight-send.ts:41-44` states the guard is scoped to the *viewed*
account "because a dApp can journal a queued send before any approval, so that gap would hand any
connected site an indefinite hold on account switching." `wallet/services/wallet-sdk/queued-journal.ts:206-218`
creates `kind: "dapp_execute"` records at `initialStage: {stage:"queued"}` — and `"queued"` is in
`IN_FLIGHT_STAGES` (`in-flight-send.ts:18`) — carrying the *session's* accountAddress + networkId,
before any approval, capped at 8/session + 32 global, reaped only after a 10-minute grace
(`operation-journal/reaper.ts:78`). Post-follow the user IS viewing that scope, so those records make
`hasInFlightSend` true there, which refuses `useNetworkActivation.activate` **and** every
`commitScopeChange`-wrapped switch: account (`AccountsPopup.vue:36`, `settings/accounts/index.vue:40`),
profile (`SelectProfilePopup.vue:51`), new account (`NewAccountPopup.vue:79`). One approval buys a
dApp up to ten minutes of pinning the user in a scope of its choosing, renewable. The scoping
decision that closed this hole assumed the viewed scope is *user*-chosen; the follow makes it
dApp-chosen.

**A3 — MEDIUM: banner state is partly dApp-selectable, and the selectable state is the one that
suppresses the signal.** `multi-chain` is **unreachable**: sessions are per-`(origin, chainId)` and
`dapp-interaction/service.ts:578-593` (`checkMethodPermission`) throws `"Unauthorized method/chain"`
for any operation whose CAIP chain ≠ `session.chainId`. A dApp *can* force `multi-signer` by padding
the batch with a cheap second-signer op (`aztec_createAuthWit`, `simulate_utility`) on another
granted account — and `multi-signer` both suppresses the follow and tells the user "your wallet
stays where it is." That reproduces the exact complaint this feature exists to fix. Cheap
mitigation: when the batch has N signers but exactly one *send-like* signer, take the account axis on
that signer.

**A4 — MEDIUM: the follow is invisible to every other open wallet realm.** No popup code subscribes
to `NetworkService.onActiveNetworkChanged`. The only reactor is `popup/app.vue:104-125`, a realm-local
`watch(() => appStore.network, createNetworkSwitchHandler(...))`. `useSyncedRef` is used solely for
`loggerWindowId`. An open popup keeps rendering the pre-follow scope until it re-bootstraps.

**A5 — LOW, plan is right: banner text provenance holds.** Names come from wallet-owned
`Account.name` / `Network.name`; Vue interpolation, no HTML sink. Caveat: `OperationScopeView`'s bare
`chainNames: string[]` / `signerNames: string[]` erase provenance, so a later edit can route dApp text
in without tripping any test. Carry the `Network`/`Account` rows instead.

**A6 — LOW, plan is right: the follow cannot be aimed off-profile.** `resolveNetworkByChainId` throws
when no row exists (`packages/wallet-bridge/src/caip.ts:64-70`), `setActiveNetwork` does
`requireOwnedRow(..., profile.id)`, `getAccount` is profile+chain scoped. Wrinkle:
`resolveNetworkByChainId` returns `networks[0]` when several rows share a chainId, so the follow can
activate a *different row* (different RPC endpoint) than the one the user configured for that chain.

## 2. Assumption attack

### Facts

- **Fact 6 (in-flight guard) — HOLDS**, verified against `execution-lane.ts` `beginJournal` and
  `queued-journal.ts`. **But the plan pins the wrong risk.** `hasInFlightSend` is
  `!state.ready.value || inFlightHasSend(...)` (`app.store.ts:167-175`) — it **fails closed**. A
  `"blocked"` result also means "the journal hadn't answered yet". That is the case to pin.
- **Fact 2 — over-claimed, and it moots an Ask.** `approveInteraction` calls
  `this.executeAndResolve(interaction, ...)` **un-awaited** (`dapp-interaction/service.ts:170-197`).
  The follow always runs before any operation executes. Withdraw Ask 2; restate the Fact.
- **Fact 4 — true but misdirecting.** The reaction that matters is not the event: `activateNetworkGuarded`
  assigns `store.network` in the calling realm, and window routes are children of `app.vue`, so
  `createNetworkSwitchHandler` fires **inside the execute window** — account-client replacement,
  `getAccounts`, possibly `ensureDefaultAccount`, `setupActiveAccount`, `syncTransactions` with
  backoff retries — all in a window whose next statement is `chrome.windows.remove`.
- **Fact 3 — wrong citation.** `activity.vue:67` is `useIncomingTransfers`' scope. The feed's scope
  is `appStore.activeScope` (`app.store.ts:470-481`). Claim survives, citation doesn't.
- **Fact 1 — true, but misses the invariant that halves the design:** every op resolves to
  `session.chainId`. Single-chain is enforced, not incidental.

### Inferences

- **Inference 2 — conclusion right, mechanism wrong.** No foreign realm reacts at all; the realm
  that re-selects is the execute window itself. Account-first survives there only because
  `setupActiveAccountRun` returns early on finding the signer (`app.store.ts:392-396`).
- **Inference 1 — FALSE as stated.** The network half *is* an activation in this realm and triggers
  `setupActiveAccountRun`, which writes the same key. In the states where the account pointer is
  *not* written (chain + N signers; chain + hidden signer), that run reaches `accounts[0]` — loaded
  `includeHidden = true` — or is killed by window close. **The durable account pointer's final value
  after a chain follow is timing-dependent.**
- **"A refusal skips BOTH halves" is unsatisfiable under account-first**: `commitScopeChange`
  re-checks after an awaited `refreshInFlight()`, and activation can also return `"stale"` or
  `"unconfirmed"` — all after the account pointer is written.
- **Unstated:** `appStore.network` / `appStore.account` populate *asynchronously* in the execute realm
  (`useProfileBootstrap`). The resolver has no "active scope unresolved" row, so first paint can claim
  a mismatch that isn't, or hide one that is.

### Asks

- Withdraw Ask 2. Ask 1 is fair.
- Surface: (a) should a dApp-induced scope move be announced after the fact (A1 + A4)? (b) is the
  queued-record pinning of A2 acceptable? (c) should `multi-signer` with exactly one send-like signer
  follow that signer (A3)?

## 3. Implementation critique

**I1 — HIGH: the reuse is rejected on a false premise.** Sharing `chain-mismatch.ts` would not mean
re-encoding. `ExecutionPayload.session` is an unmodified `DappSession` (`dapp-interaction/spec.ts:83-86`)
carrying `chainId: string` (`dapp-session/spec.ts:49`); execute already assigns it to `session.value`.
`resolveDappChain(session.chainId, appStore.networks, appStore.network?.chainId)` returns the
rename-aware name, the exact follow target, and the mismatch flag. With A3's single-chain invariant,
**the entire chain axis is `resolveDappChain`.** The conclusion the no-shared-dir convention supports
is "promote it to `@/utils` now that there is a second caller," not "write a second resolver."

**I2 — HIGH: the six-state machine is over-fitted.** `multi-chain` is unreachable; `chainNames: string[]`
exists only to feed it. What remains is chain-differs (a boolean) and a signer set ∈ {none,
one-matching, one-differing, many}.

**I3 — HIGH: reusing `useNetworkActivation` leaks three things the plan says it doesn't want** —
(a) it assigns `appStore.network` → the `app.vue` cascade in a dying window; (b) it toasts on
`"blocked"` / `"unconfirmed"` unconditionally; (c) it serializes on a module-level tail shared with
nothing else in this realm. The honest primitive: check `hasInFlightSend`, then
`requireNetwork().setActiveNetwork(id)` and `storageLocalSet(...)`, touching no store refs.
*(Already adopted independently in rev 2.)*

**I4 — MEDIUM: which network client?** The window's own `NetworkServiceClient` is disconnected in
`init()`'s `finally`. The follow must use the realm-shared `requireNetwork()`.

**I5 — MEDIUM: the hidden-signer carve-out is illusory on the chain axis** under a store-mutating
activation — `setupActiveAccountRun` picks `accounts[0]` from an `includeHidden = true` list.

**I6 — MEDIUM: gates.** (a) Phases 2/3 mount against a mocked store and mocked activation — the
riskiest behaviour is structurally invisible to them. (b) **Phase 4's chain assertion is wrong**:
asserting `network-button` on an already-open page fails for a reason unrelated to the feature;
assert on `chrome.storage.local` and/or re-`openPopup(ctx)`. *(Already adopted in rev 2.)*
(c) Phase 5 is a regression sweep, not a gate on the feature.

**I7 — LOW, defend against further churn:** colocating the account-axis helper; declining
`useAccountActivation`; the isolated try/catch; routing the write through `@/utils/storage`;
`Banner`'s single action; rejecting the service-worker variant.

**Build instead:** reuse `resolveDappChain` for the chain axis; ~20 lines of signer comparison in
`execute/scope-mismatch.ts` with no state enum; the follow as two guarded durable writes touching no
store ref; network-then-account; Phase 4 asserts on storage plus a freshly opened popup.

## 4. Verdict

conditional approve (with conditions: (1) resolve the unsatisfiable "a refusal skips both halves"
invariant; (2) account for `app.vue`'s realm-local network watcher firing inside the closing execute
window, and test that `nulo:ui:activeAccount` is not clobbered by `setupActiveAccountRun`'s
`accounts[0]` branch; (3) reuse `resolveDappChain` for the chain axis or rebut the single-chain
invariant at `dapp-interaction/service.ts:578-593`, and drop `multi-chain` as unreachable; (4) fix
Phase 4's `network-button` assertion; (5) surface to the owner the dApp-chosen default signing scope
(A1) and the queued-journal scope pinning (A2); (6) withdraw Ask 2 and restate Fact 2)


---

# Audit — same-family leg (Claude Fable 5.1, `Plan` subagent, static) on plan rev 6

Run 2026-09-17 against `origin/dev` @ `0e9d9ce2` (the prerequisite `profile-fenced-execution`
merged). Briefed with rev 6, `recon.md`, the earlier audit rounds, and eight explicit attack
surfaces (the new Facts 25–32, the Phase 0 cache reset, the Phase 5 authwit fence, the guarded
facade write, reuse vs `recon.md`, delivery shape, adversarial, comment-leak). Dispositions are in
`plan.md` §Decision ledger, "Round 5".

**Verdict: conditional approve** — conditions: (a) fix Phase 0's cache-reset test spec so it no
longer implies a change to `commitScopeChange`/`refreshInFlightOps`; (b) drop or re-scope the Phase
0 "consumer test" (it already exists verbatim); (c) Phase 5's statement before `createAuthWit` uses
the synchronous `isFenceLive`, and `execution/README.md` joins the change map.

## Findings (most severe first)

1. **MEDIUM — Phase 0 test spec contradicts "No change to `commitScopeChange`" (verified).** Plan
   §Phase 0 / §File map: "admits a profile pick **without** a journal round-trip (`getOperations` is
   not called)". But `app.store.ts:211-219` calls `await refreshInFlight()` unconditionally once the
   cached check passes, and `refreshInFlightOps` (`:224-274`) only skips the read when `profile` is
   absent — which a lock leaves set (Fact 26, `app.vue:174-183`). So the round-trip *always*
   happens; it is also what makes the empty cache safe: when locked the SW gate returns `[]`
   (`operation-journal/service.ts:127`), and every cached reader (`useNetworkActivation.ts:24`,
   `NewNetworkPopup.vue:79`, `NewAccountPopup.vue:62`) is an early-out ahead of a guarded commit. As
   written, the test fails; resolved the wrong way (skip the read while `!isLogined`) it removes the
   only refresh that closes the guard for every consumer. Fix: assert the pick is admitted and that
   the refresh ran (`getOperations` called with the old profile id, answered `[]`); keep
   `commitScopeChange` untouched.

2. **MEDIUM — Phase 0's "consumer test" duplicates an existing case (verified).**
   `service.composition.test.ts:503-522` already is "a dApp send parked at its slot-key lookup, then
   a switch to another profile: refused, failed/session_ended under p1, never proved" — the exact
   assertions the plan specifies. Adding a copy violates the plan's own no-duplication rule and
   makes a gate out of a duplicate. Fix: cite that case as the pin; write nothing.

3. **MEDIUM — Phase 5's last check leaves the gap the README closed for `node.sendTx` (verified,
   inferred impact).** Plan puts `await assertFence(fence)` immediately before
   `account.createAuthWit` (`service.ts:1023`). `assertFence` runs under `runExclusive`
   (`profile/service.ts:534-544`); a `lockActiveProfile` queued on that lock can acquire it in the
   microtask gap after release, and `close()` clears the session before its first await — the README
   (`execution/README.md:72-77`) uses exactly this to justify `isFenceLive` as *the statement before*
   the irreversible call. The account handle already holds derived key material
   (`account/service.ts:351-352`, `getProfileSecret` → `sessionManager.getSecret`), so signing after
   the gap succeeds. Fix: `assertFence` after the account lookup (deletion check), then
   `if (!isFenceLive(fence)) throw new SessionEndedError()` as the literal statement before
   `createAuthWit`.

4. **LOW — Phase 5 changes a documented contract without touching the doc (verified).**
   `README.md:63-64`: "silent authwits omit `authorizedFence`, and their dispatch arms never consume
   it" — false after Phase 5. Add the README to the change map (Capture bullet, entry-contract
   bullet).

5. **LOW — Inference 8 is incomplete; the "aligned with `clearActivity()`" claim is inexact
   (verified).** `isLogined` also flips false in `Header.vue:24-28` (*before* the
   `lockActiveProfile` RPC, so the cache empties while the session is still live — harmless only
   because of #1's refresh) and `settings/security/reset.vue:86`. `clearActivity()` is an explicit
   call in `enterLockedState` (`app.vue:180`), not a watcher. Smallest pattern-consistent fix:
   `appStore.resetInFlight()` beside `clearActivity()` rather than a new `isLogined` watcher in the
   tracker; keep the `→ true` re-read (it *is* load-bearing: a same-profile unlock hits
   `commitAccountTarget`'s fast path, `app.store.ts:369-372`, which never refreshes). Specify
   `ready = false` before that re-read (matching `:187`) so the fail-closed claim holds by
   construction, not timing.

6. **LOW — the `getSessionHandle` alternative is stated incoherently.** "Compared inside `unless`"
   needs the *current* handle — an RPC — inside a predicate that must be synchronous to sit before
   `set`. The decline is right; the reason given ("one RPC before approval") is not the reason. Also
   specify what a skipped `storageLocalSet(items, { unless })` resolves to (boolean or typed skip)
   so a future caller can tell.

7. **LOW — line drift in Facts 18/32/30 despite "where the prerequisite did not move them".**
   `execution-lane.ts` `origin: "dapp"` is `:149` (plan `:136`); `transfer-executor.ts`
   `origin: "popup"` is `:235` (plan `:231`); `createAndRegisterFresh` is `:151-158`.

8. **LOW — Fact 8 / "read cold, it is `true`" premise is false in the execute realm.**
   `useProfileBootstrap` sets `appStore.profile`, whose `immediate` watcher (`:184-191`) connects
   and reads. The explicit `refreshInFlight()` is still right as a fresh answer; the sentence should
   not claim the follow would otherwise never fire.

9. **LOW — comment-leak risks.** The header spec for `in-flight-send.ts` narrates the lock dialog
   (Header's concern) — keep the header on the predicate. Phase 3 case text ("the case rev 4 could
   not have passed", "codex r4 #1") must not become test names or comments.

## What looks fine (checked)

Facts 25–32 hold at the cited symbols (`profile/service.ts:520/534/548/557/561`,
`app.vue:164/176/174-183`, `app.store.ts:184-191/211-219/224-274`, `service.ts:103/645/760-762/954-1023`,
`dispatcher.ts:975-999`, `transfer-executor.ts:109-124/227-262`, `claim-helper.ts:151-158`,
`SelectProfilePopup.vue:51`, journal gate `:119-131/137-141`). Facts 2, 3, 5, 6, 10, 11, 20–24
hold. The guarded facade write closes r4 #1: after `migrationIdle()` resolves, `unless()` and `set`
are in one synchronous continuation; only a dispatched `set` is unretractable, as stated. Keeping
`aztec_createAuthWit` out of `FENCED_OPERATION_KINDS` is right — `service.fence-entry.test.ts:63`
pins the fence-less silent batch; arm-internal capture mirrors `:715/:757`;
`executeAztecCreateAuthWit` has one caller and is not RPC-exposed. Resolving the account by
`fence.profileId` fails closed on lock/switch (`getSecret` throws "Profile locked"). Cache reset
reopens nothing: the picker is unreachable until `enterLockedState`, and by then the SW answers
`[]`. No green path throws under Phase 5 (Inference 9 holds).

## Ask 1 / Ask 2

Two PRs is the right count but the plan pairs by verb, not layer: Phase 0 is popup-side (`stores/`,
`utils/`) and is the urgent fix (the picker regression is live on dev); Phase 5 is SW-side and
carries the e2e-heavy `batch-mixed` gate. Prefer arc 1 = Phase 0 as `fix(popup): …` (unit-gated,
merges fastest), arc 2 = Phases 1–4 on it, and Phase 5 + Ask 2 as an *unstacked* `fix(execution)`
PR off dev — nothing in arcs 1–2 depends on it. If the owner wants exactly two, keep the plan's
pairing but retitle honestly and accept the popup fix waits on execution e2e. Ask 2: fold, but with
Phase 5, not Phase 0. The dApp site is already throw-safe (`dapp-send-executor.ts:258-271` handles
a pre-claim throw, releases the slot, yields a failed envelope). The transfer site is not:
`createTransferJournal` is awaited at `:109`, *outside* the `try` at `:126`, so a bare `throw`
leaves `transferTask` (started `:107`) never failed — a stuck header task. Move the call inside the
`try` (or fail the task explicitly). The refusal copy is a UI change and needs recorded owner
sign-off before the PR opens.
