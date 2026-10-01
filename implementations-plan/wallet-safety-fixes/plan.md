---
plan: wallet-safety-fixes
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Opus 5.5 subagent
eli5_mode: artifact
eli5: https://claude.ai/artifact/AwdUMz4EYvyU2Kgoh9W9Td
branch: fix/wallet-safety-fixes
worktree: a harness-created agent worktree (its path is recorded in lessons/phase-0.md)
base: dev @ 624117cd
---

## Outcome

- **Date:** 2026-09-29. **Status:** closed, awaiting archive: delivered as #717 on
  `fix/wallet-safety-fixes`, not yet merged. The owner picked O1 (a) on 2026-09-28 and gave the
  blanket sign-off for UI impact rows 2 to 4 and R1 on 2026-09-29: "Sign off all" (P7).
- **Shipped** in #717, A1 to A5 as planned, P0 to P7:
  - A1: only the focused Revoke or Send button confirms the two authwit popups, and a repeat or
    composing Enter confirms nothing; `DropdownRoot`'s Enter clicks only an item of its menu; the
    form popups on `usePopupEntity` ignore a repeat or composing Enter; CLAUDE.md states the rule.
  - A2: the three `createAuthWit` refusals carry fixed text, with no request value.
  - A3: `setTrustAllow`, `setTrustReject` and the token add's auto-trust write only in the session
    and the profile incarnation that decided them.
  - A4: every deletion path removes `nulo:ui:pinnedTokens@<profileId>`, and a pin writes nothing
    once its scope has changed.
  - A5: the journal id comment states the id's real width and cites no review.
  - From the codex loop: the token add's last fence deletes its row only while it owns the lock,
    and `unhideLocked`'s comment states its partial stop.
- **Gates at delivery:** P6's final gate on `00e5b013` (`lessons/phase-6.md`): lint,
  `typecheck:all`, `test:all`, `test:ci-gating` and `build` exit 0; the three network specs at
  retry 0, 4 of 4 tests on Chrome (prover on) and on Firefox (proverless), none skipped; the new
  case's flake bar three of three per browser; smoke green on both browsers at retry 0; codex
  approve in two rounds of three. After the merge of `dev` at `f51ec001` (`7f8d0835`, which
  brought in #716's address comparisons in the scope checkers): lint, `typecheck:all`,
  `test:all` and `test:ci-gating` exit 0, and the three network specs on Chrome at retry 0,
  4 of 4 tests, none skipped.
- **Dropped:** nothing.
- **Open items:** none left here. F-1 to F-7 are in `follow-ups.md` § Wallet safety, and four
  lessons are in `lessons.md` (§ CI & gates, § E2E, § Extension runtime).
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.
- **Shipped**: #717.

# Wallet safety fixes

Four security and privacy fixes and one comment, from the ux-feedback program's follow-ups
(`implementations-plan/ux-feedback/plan.md` § Follow-ups), as one PR off `dev`:

- **A1** · Enter confirms the Revoke authwits and authwit-registry popups from any control.
- **A2** · The older `createAuthWit` refusals interpolate request values into their messages.
- **A3** · `setTrustAllow`, `setTrustReject` (and `onTokenAdded`) write trust with no lifecycle fence.
- **A4** · `nulo:ui:pinnedTokens@<profileId>` outlives its profile.
- **A5** · The operation journal's id comment states the wrong width and cites a review.

Recon: [`recon.md`](recon.md). Competing outline: `outline-alt.md` (local, not committed).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner, 2026-09-28: "Can you ultracode 1 to 5 + security
and privacy + test rliability + trivial? Assigning blueprinting level to each of those and just
needing me to answer the open questons that it may come."

- **Scope**: A1 to A5 above. The driver's framing, quoted in the brief: "Technical, which I'd do
  without a UI sign-off … the Enter-confirms bug; the `createAuthWit` refusals that write request
  values into Error logs (you said "defer to afterwards"); two trust writes with no ownership
  check; a pinned-tokens key left behind when a profile is deleted." The owner added: "We should
  also include the "Enter confirms on the revoke-authwits and authwit-registry popups."" For A2
  the owner said on 2026-09-24: "Yes. Defer to afterwards."
- **Out**: the page-level bare-Enter handlers that send nothing (recon § Inventory); every other
  interpolating refusal in `method-scope-checkers.ts` (Ask C4); dApp-facing error codes for scope
  refusals; keys orphaned before this PR (pre-production: they stay, devs reinstall); the
  address-keyed fee maps (follow-up F-1); widening the journal id; moving pin writes into a
  background service; the dApp windows' confirm buttons (follow-up F-6).
- **Constraints**: pre-production, no migrations; complexity budgets hold with no new acceptance;
  no new dependency; the logging policy and `log-payload-ban.test.ts`; the storage facade rule;
  existing testids verbatim.
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: typecheck and lint, unit, component, CI-gating scripts, build; smoke e2e
  on Chrome and Firefox (the form popups' shared composable and `DropdownRoot` change); the network
  specs that open the two authwit popups and the token add's auto-trust spec, on Chrome and
  Firefox.
- **Decisions**: UI and product asks go to the owner, each with a recommendation; technical asks
  are decided with `/codex high` and logged in `lessons/`.
- **Delivery**: single arc, one PR off `dev`.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 1 | Every fix reuses a pattern already in the tree (a lock fence, the execution fence, the `TokenDeleted` payload, a sentinel test, a purge step, the facade's `unless`) |
| Blast radius | 2 | One composable used by 15 popups; the dropdown primitive; the dispatcher's refusal texts; the incoming trust machine and the token-add event; the deletion cascade and its boot resume |
| Irreversibility | 1 | Code and tests only; no stored shape changes |
| Migration cost | 0 | Pre-production: nothing to migrate |
| External coupling | 1 | The dApp error wire is unchanged (it already carries a constant) |
| Security sensitivity | 3 | Transaction confirmation, log redaction, trust state, deletion residue |

`mid`: security-sensitive but bounded, with known patterns; `deep` would buy nothing the dual
audit does not, and the owner's standing cap is "never blueprint more than mid, to keep our
credits safe".

## Outcome & Quality Bar

For whom: a person managing authwits from the keyboard; a person who deletes a profile, or
re-imports one; whoever reads an exported log or a bug report.

Excellent means:

1. **No key sends a transaction the person did not aim at the confirm button.** In the two authwit
   popups, Enter on ×, a fee method, a priority button, a popup layered over it or anything
   outside the popup does that control's own thing; only a deliberate press on the focused Revoke
   or Send button confirms. A held Enter on it sends once, and a repeat or composing Enter that
   first lands on it idle sends nothing. A component test that fails on `624117cd` proves each
   case, and a network e2e, whose red run is recorded, proves it in both browsers.
2. **A refusal never carries the request.** The three `createAuthWit` refusals are fixed text; a
   sentinel placed in every request field appears nowhere in the thrown error (message and stack
   included), any logger call at any level, or the dApp's response.
3. **A trust decision lands only in the session and the incarnation that made it.** An Allow or
   Reject (or a token add's auto-trust) that a lock, a profile switch or a profile deletion
   overtook before its trust write, whether it queued behind the cascade, was reading the tip, or
   was displaced by the lock's watchdog, writes no trust row, moves no floor, un-hides no record,
   and returns `false`; a token add trusts only for the profile that added the token. A decision
   already written finishes its floor and un-hide unless its section was displaced or its
   profile's deletion began. A same-id re-import never inherits any of it.
4. **Deleting a profile removes every profile-keyed UI key**, on every deletion path. A pin or a
   cleanup that races the deletion in a popup that has not yet seen it can recreate the
   pinned-tokens key; that residual is stated in § A4 and goes to the owner. A new profile-keyed
   UI key has to be registered, or a test fails (its limits stated in § A4).

Good enough: the page-level Enter handlers that send nothing keep their behaviour; the other
refusal texts keep their detail (Ask C4); the address-keyed fee maps
(`nulo:ui:feePaymentMethods`, `nulo:ui:sendFeePaymentMethods`) keep a deleted profile's account
addresses on the resume and torn-reap paths and when the popup closes mid-delete (follow-up F-1);
a pin or cleanup racing a deletion can leave the pinned-tokens key (§ A4); an Allow the watchdog
displaced mid-un-hide leaves receipts hidden (UI impact row 4); the dApp windows' confirm buttons
keep plain native activation (follow-up F-6).

## UI impact

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | Revoke authwits and Change account authwits registry popups, keyboard | Once fees are set, any Enter that reaches the document confirms: on the header's ×, a fee method in the open menu (which then sends with the method picked *before* it), a priority button, or the page behind the popup where focus rests at open → only the focused Revoke / Send button confirms (Enter or Space, the button's own activation), and a repeat or composing Enter that first lands on it idle confirms nothing. Enter on another control does only that control's action. Nothing drawn changes | **O1 (a), the owner's pick** (P7) |
| 2 | The 13 form popups on `usePopupEntity`'s default (New/Edit Account, Contact, Endpoint, Fpc, Network, Profile, Sender, Token) | Enter in a field submits, including the Enter that commits an IME composition and each auto-repeat of a held Enter → the same, except a composing Enter and a repeat, which submit nothing | **the owner's blanket sign-off, 2026-09-29** (P7) |
| 3 | The incoming trust prompt (Allow, Block) | A choice sent just before a lock or a profile switch is already dropped today, except in a short window after its registration check reads the active profile, or when the lock or switch is undone (unlock, switch back) while an Allow reads the chain tip; then it lands → it is always dropped: no success toast, the contract stays pending, and the prompt comes back later on that profile | **the owner's blanket sign-off, 2026-09-29** (P7) |
| 4 | Receipts of a contract whose Allow the lock's watchdog displaced (a stall of five minutes or more inside the lock) | The displaced Allow resumes and un-hides every receipt, even after a Block that ran in its place → it stops: a later Block keeps the rest hidden, and with no later Block the contract stays trusted with its remaining receipts hidden and nothing un-hides them. Receipts an Allow already un-hid stay visible after a later Block, before and after | **the owner's blanket sign-off, 2026-09-29** (P7) |

Nothing else a user sees changes: A2's messages reach no screen (Fact 13); `DropdownRoot`'s Enter
changes nothing while its focus trap holds (Fact 32); a token add that completes after a switch
away from its profile no longer trusts the other profile's contract, and its own profile keeps
today's first-receive prompt (§ A3); a profile restored under a deleted one's id no longer shows
the deleted profile's pins, which is what A4 is for (its race residual is R1 below); A5 has no
surface.

### UI asks for the owner (built as recommended, both answered)

- **O1 · Which Enter confirms the two authwit popups.** As sent to the owner: **(a) only the
  focused Revoke/Send button confirms; (b) Enter also confirms when nothing is focused.**
  Recommended and built: (a), as the dApp approval windows already work (no window installs a
  document Enter, recon § Inventory). A keyboard user Tabs to Revoke or Send (the trap reaches it,
  Fact 10) and presses Enter or Space. (b) keeps "press Enter to send" for a person who clicked
  the sheet, at the cost of a rule a later control can break by being non-focusable. Confidence:
  moderate. On the sign-off page with a short capture of each (Tab to the button and Enter; Enter
  on ×), next to the blanket sign-off for UI impact row 2.
- **The blanket sign-off** (answered 2026-09-29, P7) covers UI impact rows 2 to 4 and this
  residual list, one line each:
  - R1 · A pin or a token-deletion cleanup that races a profile deletion, in a popup that has not
    yet seen it, can recreate that profile's pinned-tokens key; a later restore of the same
    profile id then shows those pins, and otherwise the key stays as an orphan (§ A4).

## Architecture & Implementation

### A1 · Enter in the transaction popups

- **Class boundary.** A document-level Enter that can broadcast or sign exists only where
  `usePopupEntity`'s `submitKey` is overridden (recon § Inventory): `RevokeAuthwitsPopup.vue:151`
  and `ChangeAuthwitsRegistryPopup.vue:92`. The fix removes the override from the composable's
  API, so no consumer can install one again. One indirect route also exists: `DropdownRoot`'s
  document Enter clicks whatever is focused (Fact 32), hardened below. The confirm button's native
  activation is then the one keyboard path, and a held or composing Enter can reach it idle once
  focus moves there, so both confirms cancel such an Enter (below).
- **`usePopupEntity` (`apps/extension/src/composables/usePopupEntity.ts`)**:
  - `UsePopupEntityHandlers.submit` becomes optional. Without it, no `keydown` listener is
    installed; `onShow`/`onHide` and their ordering are unchanged.
  - `UsePopupEntityOptions.submitKey` is deleted. `submitWaitsForShow` stays (form popups use it).
  - New export `isRepeatOrComposing(e)`: `e.repeat || e.isComposing || e.keyCode === 229`, with
    one line of why: an IME boundary keydown can report `isComposing` false with `keyCode` 229
    (MDN). `isPopupSubmitKey` refuses such an event before its input/textarea rule (Ask C1). The
    composable's exports feed the generated `auto-imports.d.ts` (Fact 41).
  - Comments: the ones that describe the override (`:17-18`, `:39-41`, `:50`) go; `submit`'s says
    in one sentence that a popup without a form field has no Enter shortcut, its confirm button
    being the keyboard path. The `Q-07` / `Q-14` tags go. The header block (`:44-65`) shrinks to
    its ordering contract: listener installed before `onShow`, removed before `onHide`, and removed
    on scope dispose; the "behaviour-preserving vs the hand-rolled copies" history goes.
- **`RevokeAuthwitsPopup.vue`, `ChangeAuthwitsRegistryPopup.vue`**:
  - `usePopupEntity` keeps `onShow`/`onHide`; `submit`, `submitWaitsForShow` and `submitKey` go,
    with the "a global Enter confirms" comments (`RevokeAuthwitsPopup.vue:129-130`,
    `ChangeAuthwitsRegistryPopup.vue:81`).
  - The Revoke content button's `@keydown.enter.stop` and its comment (`:205`, `:210`) go: nothing
    listens for Enter above it any more, and its test still holds.
  - The handler latches' comments drop "keydown" as a route (`RevokeAuthwitsPopup.vue:72-73`,
    `ChangeAuthwitsRegistryPopup.vue:51-52`). The paragraphs that explain the `.value` dereference
    and its pre-fix history, with their `Codex audit-codex-rootcause-8` references
    (`RevokeAuthwitsPopup.vue:75-78`, `ChangeAuthwitsRegistryPopup.vue:54-57`), are deleted.
  - **The confirm buttons** (`RevokeAuthwitsPopup.vue:261-269`,
    `ChangeAuthwitsRegistryPopup.vue:129-137`) gain a `@keydown.enter` handler that calls
    `preventDefault()` when `isRepeatOrComposing(e)`, so a held or composing Enter that first
    reaches the idle, focused confirm cannot activate it. `Button` forwards the listener to its
    native element (Fact 33). A deliberate press still activates; a held one sends once, as the
    first press latches the handler (Fact 33) and the guard cancels the repeats.
- **`DropdownRoot.vue:230-232`**: the Enter branch clicks the active element only when it is inside
  the open menu (`dropdown.value?.$el.contains(document.activeElement)`). While the focus trap
  holds, focus is always there, so intended behaviour does not change; it matters only when the
  trap's backstop left focus outside (`:167-179`), where it would otherwise click the popup's
  confirm or × (Ask C6). Nothing else in the primitive changes.
- **Nothing changes in** `PopupHeader`, `FeeSettingsCard`, `FeePriorityRow`, `DropdownItem` or
  `Popup`.
- **CLAUDE.md § Keyboard & focus order** gains one bullet (Ask C6): "A popup that sends a
  transaction or signs has no document-level Enter: its confirm button is the keyboard path and
  ignores a repeat or composing Enter (`isRepeatOrComposing`)."

### A2 · The three `createAuthWit` refusals

- **Where they go today.** A scope refusal is a plain `Error` thrown by `enforceScope` inside
  `dispatch` (`dispatcher.ts:895-906`) and caught only in `handleWalletMessage`, where
  `response.error = toWalletResponseError(error)` (`background.ts:1172`) is
  `UNCLASSIFIED_ERROR_MESSAGE` for any plain `Error` (`error-envelope.ts:176-191`), and the
  Error-level line logs `response.error`, not `error` (`background.ts:1178-1183`). So at
  `624117cd` neither the log nor the dApp receives these messages (Fact 13). The follow-up's
  premise ("`background.ts` logs the message at Error") held when batch 5 read it through
  `projectError`; the code logs the envelope. The fix is still worth making: the messages are one
  classification or one `logger.log(…, error)` away from the log store, and the sentinel pins
  both the throw and the sink.
- **The change** (`packages/wallet-bridge/src/method-scope-checkers.ts`, the three `throw`s only):
  - `:287` → `"Scope violation: createAuthWit account not permitted by granted accounts scope"`
  - `:302-304` → `"Scope violation: createAuthWit call not permitted by granted transaction or simulation scope"`
  - `:317-319` → `"Scope violation: createAuthWit inner-hash consumer not permitted by granted transaction or simulation scope"`
  - They stay plain `Error`s with no `details`, so nothing enumerable carries a value. The prefix
    keeps `scope-enforcement.test.ts`'s matches green.
  - The locals that only fed the messages are unchanged (`from` is also used by the check);
    `checkCreateAuthWit`'s complexity does not rise.
- **The dApp.** Unchanged: it gets the constant today and after. Whether a dApp should get a
  classified "scope violation" code is a wire decision outside this package.
- **Overlap.** `grant-check-address-case` edits `matchesPattern` (`:38-40`) in the same file;
  this package touches only `:287`, `:302-304`, `:317-319`.

### A3 · Fenced trust writes

- **Where a write outlives its decision** (Facts 15-19, 28-29, 38-40). Today's registration read,
  at the top of each locked section, already refuses a profile that is locked, being deleted or
  not the active one at that moment: `isTokenStillRegistered` reads `getNetwork`, which requires
  the active profile to own the row (Fact 40). So a setter queued behind the cascade's
  `clearProfile` (`coordinator.ts:122`) cannot write today, because the deletion reserves the id
  and closes its session before the cascade runs. What gets past that read:
  1. *A change between the read and the write.* A lock, a switch or a deletion that lands during
     `getTokensRaw` or during `repo.setTrust`'s own read (`repository.ts:131`).
  2. *A change that reverses during the tip read.* `setTrustAllow` and `onTokenAdded` await
     `readTip` (a node RPC) before the lock (`incoming-transfer/service.ts:612-615`,
     `:1120-1122`). A lock and re-unlock, a switch away and back, or a deletion followed by a
     same-id re-import unlocked meanwhile (when its network row keeps the id) leaves the read
     passing; deletion epochs do not move for a lock or a switch (Fact 38).
  3. *Watchdog handoff.* A section stalled past the 5-minute watchdog is displaced; the next waiter
     (the cascade's `clearProfile`, a `clearChain`, a token delete, or a successor Reject) runs,
     and the stalled section resumes and writes, or un-hides records after a successor blocked the
     contract.
  4. *The token add's owner.* `onTokenAdded` takes the active profile after an await while the
     emit carries no owner (Fact 39). An add made on A that completes after a switch to B
     auto-trusts B's matching contract, because the registration read runs for B and compares
     contract and chain. An ordinary switch right after adding a token reaches it.

  The setters' id is caller-fixed, so their row lands on the profile that asked; after a deletion,
  backup re-import reuses a freed id (Fact 27), so a successor incarnation can inherit a decision
  it never made: `blocked` silently hides incoming transfers of that token, `trusted` skips the
  first-receive prompt. The scenario fake's `getNetwork` ignores the active profile (Fact 40), so
  P3's red runs test the fence alone.
- **The fence** (`service.ts`, one private helper used by both setters and `onTokenAdded`):
  - Captured as the first await, before `readTip`: `this.profileService.captureExecutionFence()`
    (`profile/service.ts:521-530`). A throw ("Wallet locked") returns `false`, and so does a fence
    whose `profileId` differs from the caller's.
  - Two synchronous predicates, each read immediately before its write with no await between:
    - `live = () => isCurrent() && this.profileService.isFenceLive(fence)` guards the decision,
      the trust write (`repo.setTrust(…, live)`, which reads its fence after its own read,
      `repository.ts:131-133`). `isFenceLive` checks the session serial, the active profile and
      the deletion epoch (`profile/service.ts:549-555`). A fence captured before a deletion reads
      false once it begins, and none can be captured while the id is reserved (Fact 38), so no
      separate `isReserved` term.
    - `kept = () => isCurrent() && deletion.isCurrent(fence.profileId, fence.epoch)`, with
      `deletion` from `getDeletionState()` (`profile/service.ts:1340`), guards the follow-through:
      the arrival floor move (`moveArrivalFloorLocked`'s `isCurrent` argument becomes `kept`) and
      each un-hide `upsertRecord` in `setTrustAllow`.
  - Why two: the decision needs the session that made it; once it is written, a lock or a switch
    must not strand the receipts the person accepted, so the follow-through stops only for a
    displaced section or a deletion (§ Decision ledger, for the confirmation). Its events stay in
    their profile: the popup's feeds accept a record only in the live scope
    (`useIncomingTransfers.ts:115-127`).
  - A refused trust write returns `false` at once, before any follow-through.
  - Comments: one sentence at the helper for the two predicates. The paragraph at
    `service.ts:635-637`, which explains the `getRecord` re-check by tests that mutate the map,
    becomes the invariant: a deleted profile's id can come back through a restore, so each write
    proves that its section still holds the lock and that its profile is the incarnation that
    allowed it.
  - The scenario tests' profile stub gains `captureExecutionFence`, `isFenceLive` and
    `getDeletionState` over a real `ProfileDeletionState` and a session serial (Fact 29).
- **Token add ownership** (the `TokenDeleted` precedent, `token/spec.ts:263-269`):
  - `token/spec.ts` gains `TokenAdded = TokenInfo & { profileId: string }` beside `TokenDeleted`,
    with a one-line comment: the same reason, for additions. `TokenDeleted`'s comment loses
    "(finding C)". `Events.onTokenAdded` becomes `TokenAdded`, and so do the service's and the
    client's handlers (`token/service.ts:91`, `token/client.ts:15`).
  - The emit (`token/service.ts:431`) becomes
    `{ ...getTokenInfo(token), profileId: token.profileId }`, preceded by a synchronous
    `isCurrent(fence.profileId, fence.epoch)` after the last network await (`:427`): the token lock
    has the default watchdog (`:97`), so an add stalled there can resume after a deletion and a
    same-id restore, and its handler would then capture the successor's fence. A refused recheck
    compensates the row and throws, as the check at `:418-421` does.
  - `incoming-transfer`'s `onTokenAdded` drops `getActiveProfile()` and its comment
    (`service.ts:1102-1106`). It captures the fence first, which takes the facade lock as today's
    `getActiveProfile()` does (`profile/service.ts:507`), and returns when the capture throws or
    `fence.profileId !== token.profileId`. Every read and write then uses `token.profileId`, under
    the two predicates above. When the row is already `trusted` it writes no trust, so it reads
    `live()` after the registration read and returns if the session moved, before any
    follow-through; the branch that writes trust keeps the repository's own fence.
  - Consumers that keep compiling unchanged, all typed `TokenInfo`: `token-balance`, which
    re-reads the row and checks its owner (Fact 39), and the popup's `send.vue:89-91`,
    `activity.vue:138` and `RecentActivityView.vue:176`. `settings/tokens/index.vue:35` also stays,
    but its comment (`:37-40`) says the payload carries no `profileId`; it shrinks to its
    surviving reason: resync re-reads through the scoped fetch, which is always correct.
  - Residual: an add that completes after a switch away from its profile does not auto-trust. That
    profile's first receipt of the token shows the trust prompt, today's prompt, so nothing is
    trusted silently.
  - The payload stays inside the extension: no dApp path subscribes to token events (Fact 39), as
    with `TokenDeleted`.
- **Return value.** `_setTrustStateLocked` returns whether it wrote. Either setter returns `false`
  when any fenced write was refused, which the spec already defines as "caller should suppress the
  success toast" (`spec.ts:339-348`); the spec's doc comment gains "or a lock, a profile switch or
  the profile's deletion overtook the write".
- **The interaction contract:**
  - Any identity switch closes an unanswered prompt (`PopupManager.vue:190-223`), and a lock
    closes every popup (Fact 42).
  - A choice already sent proceeds across an account-only or network switch: the row is keyed by
    profile, network and contract, and the network id is the caller's.
  - A lock or a profile switch before the trust write refuses it, and the setter returns `false`,
    so no success toast. The row stays `pending`, and `replayPendingPrompts` asks again later on
    that profile: at the next popup open, or on switching back (Facts 31, 42).
  - After the trust write, an Allow finishes its floor and un-hide unless the watchdog displaced
    it or a deletion began.
  - The re-ask is the only visible change: UI impact row 3, under the blanket sign-off.
- **Order inside `setTrustAllow`: unchanged** (trust, floor, un-hide; Ask C8, option (b)). The
  trust row exists when the floor moves, which needs one (`service.ts:835`), and the fence stops a
  displaced section from writing after a successor. The residual, reachable only through a
  watchdog stall of five minutes or more inside the lock (UI impact row 4): an Allow displaced
  mid-un-hide, with no Block after it, leaves `trusted` with its remaining receipts hidden and no
  path to un-hide them, the state a storage failure mid-loop already leaves today; and receipts it
  already un-hid stay visible after a later Block (Inference 5). P3 pins the first as a
  `(BUG PIN)`; follow-up F-4.

### A4 · Profile-keyed UI keys at deletion

- **Owner: the coordinator.** Every deletion path runs `ProfileDeletionCoordinator.purge`
  (Fact 22), which already purges every profile-bearing root it knows. The reset page's two
  removals (`reset.vue:85-87`) are the address-keyed fee maps, not profile-keyed keys, and stay
  (follow-up F-1).
- **New module `apps/extension/src/utils/profile-ui-keys.ts`**, the single enumerable definition:
  - `PROFILE_UI_KEY_PREFIXES`, today `["nulo:ui:pinnedTokens@"]`; each prefix ends in `@`.
  - `pinnedTokensKey(profileId)`, moved here from `popup/constants/storage-keys.ts:9` (the wallet
    imports `@/utils/*`, never `@/popup/*`, Fact 24), built from its prefix.
  - `profileUiKeys(profileId)`: every prefix plus the id. The purge removes these exact keys, so
    `p1`'s never touches `p10`'s.
  - `usePinnedTokens.ts` and its test import from here. `src/utils/` is an auto-import directory,
    so the generated `auto-imports.d.ts` gains the module's exports (Fact 41).
- **The purge step.** The coordinator's constructor takes a `StorageArea` (the runtime passes
  `browserApi.storage.local`, `runtime.ts:525`). `purge` removes `profileUiKeys(profileId)` in one
  `remove` call after `networks.purgeForProfile` and before `pxe.clearProfileState`
  (`coordinator.ts:129-130`). Idempotent, awaited, and a throw propagates like every other step,
  so the tombstone stays and the resume retries. The class doc's "It owns NO storage" becomes "It
  owns no rows", and "(finding D)" leaves its header (`:23`).
- **Late writes** (Fact 30). A popup that has not yet seen the deletion can write the key after
  the purge. `writeMap` takes the facade's existing `unless` option; `pinOp` and `unpinOp` pass
  `() => !ctx.live()`, so the scope is re-checked after the barrier, immediately before the write
  (`utils/storage.ts:73-83`), and a skipped pin returns `"stale"`. The deletion cleanup stays
  unfenced, as its doc says.
- **The residual** (each point checked at `usePinnedTokens.ts:224-241`; R1 on the owner's residual
  list; follow-up F-5):
  - The deletion cleanup writes only when the contract it removes is in the map it just read
    (`:229-231`).
  - A cleanup whose read precedes the purge and whose write follows it recreates the key. So does
    a pin whose scope still matched at the barrier.
  - The key then holds at most that profile's own pinned contracts that were not yet cleaned.
  - A later restore of the same profile id inherits them (filtered against its tokens, `:63-68`).
    Otherwise the key stays as an orphan.
  - The window is one read-to-write gap in a popup that has not yet seen the deletion.
- **The class guard.** `profile-ui-keys.scan.test.ts`:
  - Complete membership: every function the module exports whose name ends in `Key` builds
    `prefix + id` for exactly one registered prefix, and every prefix has one builder.
  - Scan of `apps/extension/src/**/*.{ts,js,vue}` (tests excluded): outside the module, any
    `nulo:ui:` string built with `${` or `+`, and any `useSyncedRef(` whose argument is built with
    `${` or `+` (it prefixes `nulo:ui:` at runtime, Fact 36), fails. A count keeps it
    non-vacuous (`pinnedTokensKey` found in the module).
  - Its limits, in the file header: a key assembled through a variable or a helper elsewhere, or
    a new UI-key helper other than `useSyncedRef`, gets past it; the registry test does not see a
    builder written outside the module.
- **Other `@<profileId>` keys, checked** (Fact 23): the token-seeded marker, the active network,
  the integrity blocked and verified records, the restore-pending marker and the tombstone are
  already removed on every path. `nulo:ui:lastActiveProfile` is a single pointer whose readers
  tolerate a missing profile. The fee maps are keyed by account address, which two profiles can
  share, so they cannot be pruned per profile (follow-up F-1).
- **Pre-production.** No migration: keys orphaned before this PR stay; devs reinstall.

### A5 · The journal id comment

`operation-journal/service.ts:289-291` becomes one line, verified against the allocator
(Fact 25): "16 hex characters (64 bits), twice the default width: defense in depth against id
collisions between concurrent dApp interactions." No code change; the id is not widened.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/composables/usePopupEntity.ts` (+ test) | optional `submit`, no `submitKey`, `isRepeatOrComposing` with the `keyCode` 229 fallback, comments |
| `apps/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue` (+ test) | no document Enter, the confirm's repeat/composing guard, comments |
| `apps/extension/src/popup/components/popups/ChangeAuthwitsRegistryPopup.vue` (+ test) | no document Enter, the confirm's repeat/composing guard, comments; the test's `Button` stub disables from `disabled` only |
| `apps/extension/src/components/ui/Dropdown/DropdownRoot.vue` (+ test) | Enter clicks only inside the open menu |
| `apps/extension/tests/e2e/network/popup-escape-layered.test.ts` | one test (Ask C3) |
| `CLAUDE.md` | one bullet (Ask C6) |
| `packages/wallet-bridge/src/method-scope-checkers.ts` (+ `method-scope-checkers.test.ts`) | three fixed texts; sentinel test |
| `apps/extension/src/wallet/services/wallet-sdk/background.refusal-log.test.ts` (new) | sink sentinel |
| `apps/extension/src/wallet/services/incoming-transfer/service.ts`, `spec.ts` (+ `service.scenarios.test.ts`) | the fence helper (decision and follow-through), the token add's owner check, comments |
| `apps/extension/src/wallet/services/token/spec.ts`, `service.ts`, `client.ts` | `TokenAdded`, carrying `profileId` |
| `apps/extension/src/popup/pages/settings/tokens/index.vue` | a comment the payload change makes false |
| `apps/extension/src/utils/profile-ui-keys.ts` (new, + scan test) | the registry |
| `apps/extension/src/popup/constants/storage-keys.ts` | `pinnedTokensKey` leaves |
| `apps/extension/src/composables/usePinnedTokens.ts` (+ test) | import path; `unless` on pin/unpin writes |
| `apps/extension/src/wallet/services/profile-deletion/coordinator.ts` (+ test), `apps/extension/src/wallet/runtime.ts` | purge step, storage injected |
| `apps/extension/src/types/auto-imports.d.ts` | regenerated: the new exports under `src/composables/` and `src/utils/` |
| `apps/extension/src/wallet/services/operation-journal/service.ts` | comment |
| `implementations-plan/wallet-safety-fixes/`, `implementations-plan/index.md` | plan, recon, lessons; index line |

### Trade-offs and alternatives not taken

- **Keep a global Enter and teach controls to mark theirs** (`defaultPrevented`): fails open, and a
  native button cannot mark its Enter without cancelling its own activation. `outline-alt.md`
  develops it; both audit legs preferred the main outline.
- **Option (b) for O1** (Enter with nothing focused): kept as the owner's alternative.
- **A lint or scan rule banning `document.addEventListener("keydown")` in popups**: the type
  change already makes the override impossible through the composable, and a scan would need an
  allowlist longer than the rule.
- **A typed `ScopeViolationError` for A2**: a class is how a message gets classified and passed
  to the dApp and the log; exactly the path this change guards against.
- **A3: `isFenceLive` on the follow-through writes too**: with today's order, a lock mid-Allow
  would leave accepted receipts hidden under `trusted` with no way back (§ Decision ledger).
- **A3: the token add fenced by the active profile's fresh epoch**: fixes nothing about
  attribution (codex final 2); the event's own `profileId` does.
- **A4: pin writes through a background service with incarnation checks** (codex round 1): it
  moves a popup UI-state module across the process boundary, beyond this brief (follow-up F-5).
- **A4 owned by `TokenService.purgeForProfile`**: also on every path, but the key is a UI
  preference, not a token row, and the next profile-keyed UI key would not be a token's.

## Security & Adversarial Considerations

- **Threat model.**
  - A1: no attacker is needed; a misdirected Enter is enough. Enabling the registry makes every
    previously issued authwit executable again (`ChangeAuthwitsRegistryPopup.vue:114-117`), so an
    Enter on × can hand a dApp holding an old authwit the power to consume it. An Enter on a fee
    method sends with the method picked before it (Fact 5): a person moving to a private method
    can pay publicly and reveal the address. A revoke spends fees. The extension's popup is its
    own document, so no web page can inject the key; the risk is the wallet's own routing,
    including `DropdownRoot`'s click on whatever holds focus and a held or composing Enter that
    lands on an idle confirm after focus moves.
  - A2: the refusal names the account, the contract and function, or the consumer, linking the
    person's account to a dApp's request. The log is CSV-exportable and is how a bug report
    leaves the device (CLAUDE.md § Logging policy). Today the sink carries a constant (Fact 13);
    the change closes the path before a refactor opens it.
  - A3: a trust decision applied after the person locked, left the profile or deleted it, or
    applied to another profile. Today's registration read refuses most of these at the start of
    the section (§ A3). What remains: a change between that read and the write, a change that
    reverses during the tip read (a same-id re-import unlocked meanwhile among them), the watchdog
    handoff, and the token add, which an ordinary switch right after adding a token reaches.
    Consequence: funds hidden, or the spam prompt skipped, on a profile that never chose it.
  - A4: residue: a deleted profile's pinned contracts reveal which tokens it held, to anyone who
    reads `chrome.storage.local`, and today a same-id re-import inherits them (filtered against
    its tokens, `usePinnedTokens.ts:63-68`, so harmless on screen). After the purge only § A4's
    race can leave them: at most that profile's own uncleaned pins, until a same-id restore
    inherits them, or indefinitely as an orphan.
- **Input validation.** Unchanged: `argSchema` and `assertAuthRelevantArgShape` still run before
  the checkers (`dispatcher.ts:885-891`); the stored pin map stays sanitized on read.
- **Least privilege, cryptography, supply chain.** No permission, credential, crypto or
  dependency changes. The coordinator gains a `StorageArea`, the same one every SW service holds.
- **Logging.** No log line added. A2's sentinel test asserts every logger call's arguments. The
  token-add payload gains `profileId`, an id the popup already holds, on an internal event no dApp
  receives.
- **Storage.** No shape change; one removal on delete.
- **Escape.** Untouched: nothing is approved by Escape, before or after.

## Assumptions

### Facts (verified at `624117cd` by reading the file)

1. `usePopupEntity` installs a `document` `keydown` listener on show and calls `submit` for any
   event its `submitKey` accepts; the default `isPopupSubmitKey` requires Enter on an input or
   textarea target (`usePopupEntity.ts:9-13`, `:73-76`, `:80-82`).
2. Only two consumers override `submitKey`, both with a bare `e.key === "Enter"`:
   `RevokeAuthwitsPopup.vue:151`, `ChangeAuthwitsRegistryPopup.vue:92` (`rg submitKey`).
3. Their `submit` sends a transaction: `revokeAuthwits` (`RevokeAuthwitsPopup.vue:103-107`),
   `setRegistryEnabled` (`ChangeAuthwitsRegistryPopup.vue:63`), guarded only by the loading
   latch, the fee check and (revoke) the error gate (`:71-79`, `:134-136`; `:50-58`).
4. The header × is a native `<button>` whose click emits `onClose` (`PopupHeader.vue:20-29`); its
   Enter `keydown` bubbles to `document` before its click activation.
5. Fee method items are `DropdownItem`s (`tabindex="0"`, `DropdownItem.vue:8-13`) teleported to
   `#dropdown` (`DropdownRoot.vue:270`), activated on Enter by the menu's own `document` listener,
   added when the menu opens (`DropdownRoot.vue:121-122`, `:223-232`). The popup's listener was
   added at show, earlier; listeners on one target run in registration order, so the popup
   submits before the item's click changes the fee.
6. `FeePriorityRow` renders native buttons (`FeePriorityRow.vue:25-33`) when
   `effectiveMethod && !feeJuiceMissing` (`popup/components/modules/send/FeeSettingsCard.vue:826`).
7. `Popup`'s trap leaves focus where it was by default (`initialFocus` default `false`,
   `Popup.vue:24-28`, `:66-73`), so at open focus sits on the opener or the body.
8. No file under `popup/windows/` installs a document key listener (`rg keydown`).
9. The Revoke content button's `@keydown.enter.stop` exists because Enter revoked; its test pins
   "opens the content once and revokes nothing" (`RevokeAuthwitsPopup.vue:204-211`,
   `RevokeAuthwitsPopup.test.ts:150-168`).
10. Tab inside the registry popup reaches `registry-toggle-submit` within ten presses
    (`popup-escape-layered.test.ts:57-65`).
11. The three `createAuthWit` refusals interpolate the account (`method-scope-checkers.ts:287`),
    `fn@contract` (`:302-304`) and the consumer (`:317-319`); all are plain `Error`s.
12. Tests match those refusals only by `/Scope violation/` and `/structured call intent/`
    (`scope-enforcement.test.ts:449-554`); no e2e or playground file matches a refusal text.
13. A scope refusal propagates from `enforceScope` (`dispatcher.ts:895-906`) to
    `handleWalletMessage`'s catch; `response.error` is `UNCLASSIFIED_ERROR_MESSAGE` for a plain
    `Error` (`background.ts:1172`, `error-envelope.ts:176-191`, `:199`), and the Error-level line
    logs `response.error` (`background.ts:1178-1183`). The queued-journal write that records
    `getErrorMessage(error)` runs for top-level `sendTx` only (`background.ts:487-490`,
    `:1185-1186`). So neither log nor dApp receives the three messages today.
14. Batch 5's pattern: `ValidationError("Malformed ${type} capability", { capabilityType })`
    (`dispatcher.ts:414-423`) and its sentinel test (`dispatcher.test.ts:2073-2091`).
15. `setTrustAllow` and `setTrustReject` call `_setTrustStateLocked` without a fence
    (`incoming-transfer/service.ts:619`, `:654`); `onTokenAdded` passes `isCurrent` (`:1128`);
    `repo.setTrust` reads the fence after its own read and writes nothing when it is false
    (`repository.ts:131-133`), pinned by `repository.test.ts:91`.
16. The service lock is a `Lock` with the default 5-minute watchdog (`service.ts:252`;
    `lock.ts:4`, `:36`), whose force-release admits the next waiter while the displaced section
    keeps running; the timer nulls the ticket first, so `isCurrent` is false from then on whether
    or not a successor exists (`lock.ts:84-92`, `:141-160`).
17. `setTrustAllow`'s un-hide loop writes each record with no `isCurrent` check
    (`service.ts:632-645`); it is the only writer of `hidden: false` for a contract's records.
18. `pinnedTokensKey` is `nulo:ui:pinnedTokens@${profileId}` (`popup/constants/storage-keys.ts:9`),
    written by `usePinnedTokens` (`usePinnedTokens.ts:177-178`); `reset.vue` removes only
    `nulo:ui:feePaymentMethods` and the send selections (`reset.vue:85-87`); `purge` has no step
    for it (`coordinator.ts:116-131`).
19. `purge` runs `incoming.clearProfile` (`coordinator.ts:122`), which wipes trust under the
    service lock (`service.ts:673-700`), before `tokens.purgeForProfile` (`:128`), whose deletes
    emit nothing (`token/service.ts:817-821`).
20. The coordinator is built with a logger only (`runtime.ts:525`).
21. `NetworkService.purgeForProfile` removes its per-profile key with
    `browserApi.storage.local.remove` (`network/service.ts:50-51`, `:918`).
22. Every deletion path runs `delegate.runFor`: the live delete (`profile/service.ts:1512`), the
    torn-import reap through `deleteProfile(id, tornGuard)` (`:1462`), the resume (`:1590`);
    `profile/service.integration.test.ts:1786-2060` pins each routing.
23. The other per-profile keys are removed on every path: the token-seeded marker
    (`seeder.ts:363-365`, `:667-669`, via `token/service.ts:805`), the active network
    (`network/service.ts:918`), the integrity records (`profile/service.ts:1501-1502`,
    `:1587-1588`), the restore-pending marker (`:1507`, `:1583`).
24. Wallet code imports `@/utils/*` (e.g. `@/utils/chain-ids`, four files) and never `@/popup/*`.
25. `nextRandomId(storage, 16)` calls `getRandomHex(16)`, which draws `ceil(16 / 2)` = 8 bytes and
    returns 16 hex characters, 64 bits; the default length is 8 (`operation-journal/service.ts:292`,
    `id-allocators.ts:48-54`, `wallet-core/src/utils/random.ts:9-15`).
26. The journal id reaches the dApp as `jobId` (`dapp-interaction/service.ts:150`,
    `error-envelope.ts:37-45`); creates are serialized under the journal's transition lock
    (`operation-journal/service.ts:244-257`).
27. Backup re-import reuses a freed profile id, as the journal's create documents
    (`operation-journal/service.ts:266-267`) and the queued-journal path guards
    (`queued-journal.ts:120-124`).
28. `setTrustAllow` and `onTokenAdded` read the tip before taking the lock
    (`incoming-transfer/service.ts:612-615`, `:1120-1122`); `setTrustReject` enters the lock
    directly (`:650-652`).
29. `beginDeletion` reserves the id and bumps its epoch under the facade lock before the cascade
    runs (`profile-deletion-state.ts:58-63`, `profile/service.ts:1486-1488`); `release` drops only
    the reservation, so the epoch survives into a same-id re-import (`profile-deletion-state.ts:45-54`);
    `getDeletionState()` exposes the shared instance (`profile/service.ts:1340-1342`). The
    scenario tests' profile stub has none of `captureExecutionFence`, `isFenceLive` or
    `getDeletionState` (`service.scenarios.test.ts:163-173`).
30. `storageLocalSet` reads `unless` after the migration barrier, immediately before the write
    (`utils/storage.ts:73-83`); `usePinnedTokens`' `writeMap` passes none (`usePinnedTokens.ts:177-180`),
    after `pinOp`'s last scope check (`:118-123`); the deletion cleanup has no scope check by design
    (`:224-241`). Reads await the same barrier (`utils/storage.ts:68-71`).
31. `replayPendingPrompts` re-emits the prompt for every `pending` row with records, on popup
    (re)connect (`service.ts:1478-1515`); `PopupManager`'s trust-changed consumer reacts only to
    `unknown` (`PopupManager.vue:146-151`); arrival eligibility reads floors, not trust state
    (`arrival-state.ts:42-70`); `moveArrivalFloorLocked` writes nothing without a stored row
    (`service.ts:835`), and a prompt is raised only after its `pending` row is written (`:1402-1403`).
32. `DropdownRoot`'s Enter clicks `document.activeElement` without checking it is in the menu
    (`DropdownRoot.vue:230-232`); its focus trap's backstop can leave focus unheld (`:167-179`).
33. Both handlers latch on `isLoading` before their first await (`RevokeAuthwitsPopup.vue:71-82`,
    `ChangeAuthwitsRegistryPopup.vue:50-61`). `Button` renders one native element whose `disabled`
    attribute follows its `disabled` prop only (`packages/design/src/ui/Button.vue:103`) and whose
    `aria-busy` follows `loading` (`:104`); both confirm buttons pass `:loading="isLoading"` and a
    `:disabled` that includes `isLoading` (`RevokeAuthwitsPopup.vue:267-268`,
    `ChangeAuthwitsRegistryPopup.vue:135-136`). Attributes and listeners reach that element: the
    base keeps default inheritance on its single root (`Button.vue:98-106`), and the extension
    wrapper binds `$attrs` onto the base in both branches (`components/ui/Button.vue:15`, `:36`,
    `:56`).
34. The registry popup closes only in `finally`, after `setRegistryEnabled` resolves
    (`ChangeAuthwitsRegistryPopup.vue:63-78`), which waits for the transaction to be mined and
    proven (`auth-registry/service.ts:358-366`). The e2e spec skips without network configuration
    (`popup-escape-layered.test.ts:18-19`, `:37`).
35. `RevokeAuthwitsPopup.test.ts`' `mountAndOpen` mounts unattached unless asked
    (`RevokeAuthwitsPopup.test.ts:95`).
36. `useSyncedRef` prefixes `nulo:ui:` at runtime (`composables/syncedRef.js:5-8`).
37. The fee maps are keyed by account address (`FeeSettingsCard.vue:293-296`) and removed only by
    the reset page, after the live delete returns (`reset.vue:85-87`).
38. `captureExecutionFence` reads the active session under the facade lock and throws "Wallet
    locked" when there is none or its id is reserved (`profile/service.ts:521-530`); `isFenceLive`
    answers synchronously from the session serial, the active profile and the deletion epoch
    (`:549-555`). `isCurrent(id, epoch)` compares the stored epoch
    (`profile-deletion-state.ts:75-77`) and `beginDeletion` bumps it (`:58-63`), so an epoch
    captured before a deletion reads false once it begins; nothing but a deletion moves it, so a
    lock or a switch leaves it. Every unlock, a switch included, opens a new session serial
    (`profile/service.ts:1321`, `session-manager.ts:336`), as does a restore (`:656`).
39. `onTokenAdded` takes the active profile after an await
    (`incoming-transfer/service.ts:1102-1107`) and its registration read compares contract and
    chain for that profile (`:660-671`); the add's emit carries no owner (`token/service.ts:431`),
    while `TokenDeleted` adds one for the same reason (`token/spec.ts:263-269`, emitted at
    `token/service.ts:215`, `:614`). `token-balance` re-reads the row and checks its owner
    (`token-balance/service.ts:483-500`, the check at `:492`). No dApp path subscribes to token
    events (`wallet-sdk/background.ts` references none).
40. The registration read refuses a profile that is locked, reserved or not active:
    `isTokenStillRegistered` calls `getNetwork` (`incoming-transfer/service.ts:660-671`), which
    requires the active profile to own the row (`network/service.ts:427-433`), and
    `getActiveProfile` answers nothing for a reserved id (`profile/service.ts:505-512`); the
    deletion reserves the id and closes its session before the cascade (`:1486-1493`, `:1512`).
    Network ids are fresh per network (`network/service.ts:933`). The scenario fake's `getNetwork`
    ignores the active profile (`service.scenarios.test.ts:212`).
41. Every export under `src/composables/` and `src/utils/` is auto-imported and listed in the
    tracked, generated `src/types/auto-imports.d.ts` (`apps/extension/vite.config.ts:125-126`).
42. Only the incoming trust prompt calls the setters (`PopupManager.vue:99-100`). A lock closes
    every popup (`app.vue:176`, `locked-state.ts:19-28`), and one popup instance does not replay
    the triple it replayed last (`PopupManager.vue:173-188`), so after a lock and unlock the
    re-ask waits for the next popup open or a switch away and back. Records live in plain
    `storage.local` (`repository.ts:1-17`), so today a lock does not stop an Allow's un-hide.
43. jsdom 29.1.1 (`apps/extension/package.json:103`, locked in `bun.lock`), the extension's vitest
    environment (`apps/extension/vitest.config.ts:29`), takes `repeat`, `isComposing` and `keyCode`
    in `KeyboardEventInit` and exposes each on the event
    (`jsdom/lib/generated/idl/KeyboardEvent.js`).

### Inferences (unverified; audits attack these)

1. With the `keyCode === 229` fallback MDN recommends, a composing Enter is refused in Chrome and
   Firefox, including a boundary keydown that reports `isComposing` false (MDN; not run here).
2. Today's bug reproduces in a browser: Enter on a priority button or a fee method in the registry
   popup starts the toggle. The component test shows the handler call; the e2e (Ask C3) is the
   first browser proof.
3. A background-level sentinel test is green before the A2 change (Fact 13). If it is red, the
   sink needs the fix too, and P2 says so before continuing.
4. No production caller relies on `setTrustAllow`/`Reject` returning `true` after a refused
   write; `PopupManager.vue:99-100` hands the result to the trust popup, which suppresses its toast
   on `false` (`spec.ts:339-348`, `IncomingTrustPopup.vue:112-115`).
5. A later Block reaches a contract an Allow already un-hid only through a second prompt for the
   same triple (another popup instance) or a successor after a watchdog handoff; `setTrustReject`
   never re-hides (`service.ts:650-657`), so those receipts stay visible (UI impact row 4).
6. A token add's `profileId`, plus the fence its handler captures, names the incarnation that
   added the token: the emit runs inside the token lock (`token/service.ts:371`, `:431`), which
   the cascade's token purge also takes (`:815`), and the facade lock is FIFO
   (`packages/wallet-core/src/utils/lock.ts:58-61`, `:166`). So a handler that starts after a
   deletion began captures before that deletion's release (`profile/service.ts:1526-1529`) and is
   refused while the id is reserved. The token lock's watchdog breaks this for an add stalled after
   its last deletion check, which the emit's recheck covers (§ A3).
7. Puppeteer sends a second `keyboard.down("Enter")` on a held key as a repeat in Chrome (CDP
   `autoRepeat`) and in Firefox (WebDriver BiDi, a key already pressed). P6 records the event's
   `repeat` in the page, so a driver that sends none fails the step instead of passing it.

### Asks

**Owner**

- **O1 · Which Enter confirms the two authwit popups.** (a) only the focused Revoke/Send button
  confirms; (b) Enter also confirms when nothing is focused. Recommendation: (a). Confidence:
  moderate. (§ UI asks.) The blanket sign-off for UI impact row 2 goes on the same page.
  **Answered:** Owner pick on the decision page, 2026-09-28 (confirmed in chat: "done"): O1 (a).
- **Blanket sign-off**: UI impact rows 2 to 4 and the residual list (§ UI asks).
  **Answered:** the owner, 2026-09-29: "Sign off all" (P7).

**Codex** (the final fresh pass's decisions; the confirmation checks C5's follow-through and C8)

- **C1 · Default predicate guards** (`!e.repeat`, `!e.isComposing` for the 13 form popups).
  Final: amend with the IME boundary guard and its regression. Built: the `keyCode === 229`
  fallback in the shared `isRepeatOrComposing`, one test. The behaviour change stays under the
  owner's blanket sign-off (UI impact row 2).
- **C2 · `submitKey` removed, not narrowed.** Final: approve.
- **C3 · A browser test for A1.** Final: amend: arm a persistent mutation observation before each
  key; keep the execution and skip counts. Built as P6 step 1.
- **C4 · Widen A2 to every interpolating refusal in the file.** Final: approve the scoped deferral
  (follow-up F-2): the `sendTx` text reaches the queued journal row, which the journal page renders
  (`popup/pages/journal/[id].vue:137`), so changing it changes a surface.
- **C5 · The session fence.** Final: amend as its finding 1. Settled: the execution fence guards
  the trust decision (§ A3). For the confirmation: the follow-through writes read the lock and the
  incarnation only (§ Decision ledger).
- **C6 · The CLAUDE.md bullet and the `DropdownRoot` hardening.** Final: approve. The bullet now
  also names the confirm's repeat/composition guard (codex final 3).
- **C7 · A4's registry and scan.** Final: amend the lifetime claim and its test as its finding 4;
  approve the exact-id removal. Built: the purge alone, the residual stated (§ A4).
- **C8 · What an interrupted Allow leaves behind.** Final: amend as its finding 6. Chosen: option
  (b), today's order; the residuals go to the owner (UI impact row 4), P3 pins the no-successor
  state as a `(BUG PIN)`, and F-4 tracks a repair. The confirmation checks it.

### Plan audit ledger

Round 1 ran in parallel; both legs saw this plan, `recon.md` and `outline-alt.md`. The final
fresh pass read the revised plan, `recon.md` and the brief, owing round 1 nothing.

- `/codex high` round 1 (GPT-6 Astra, session `01a0e977-3bc9-7c23-ace2-d33307ead92a`):
  **conditional approve**, confidence high (conditions: its findings 1-7).
- Opus 5.5 (same-family leg): **conditional approve** (conditions F1-F4).
- `/codex high` final fresh pass (GPT-6 Astra, session `01a0e990-bf6e-78c1-879a-cca27a1a5efc`):
  **conditional approve**, confidence high (conditions: its findings 1-7 and the C3 amendment).
  Its confirmation (the same session, resumed): **conditional approve**, confidence high. The
  split fence holds once trust is written, the reachability correction holds, and C8 (b) is the
  smallest bounded change. Its two new findings are rows 27 and 28, applied by the driver.

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex 1 + Opus F1 | major / high | `isCurrent` alone misses a setter queued behind `clearProfile`, and an Allow whose pre-lock tip read spans the deletion and a same-id re-import | accepted: deletion-aware fence captured at entry (§ A3), on trust, floor and un-hide writes; C5 flipped; red tests in P3 |
| 2 | codex 1 (sub-point) | major | also bind the write to the live session (`captureExecutionFence` / `isFenceLive`) | disputed: § Decision ledger; the final fresh pass settles it |
| 3 | codex 1 (sub-point) | major | account-switch cancellation needs an owner decision | rejected: trust is profile-wide by design (`service.ts:621-622`); nothing account-scoped exists to cancel |
| 4 | Opus F1 (rider) | high | `onTokenAdded` has the same exposure | accepted: same helper, same file (§ A3) |
| 5 | Opus F2 | medium | a watchdog stop leaves `trusted` with records hidden and no un-hide path | accepted: Ask C8 with options, (c) recommended and built; P3 pins the no-successor case |
| 6 | codex 2 (confirm controls) | major | cancel repeat and composition keys at the two confirm buttons | rejected: both handlers latch before their first await and `Button` is natively disabled while loading, never a composition target (Fact 33); a P1 test pins a held Enter sending once |
| 7 | codex 2 (dropdown) | major | `DropdownRoot` clicks any focused element on Enter | accepted: clicks only inside the open menu, one unit test (§ A1) |
| 8 | codex 4 (P1) | major | unattached mounts let bubbling tests pass today | accepted: `attachTo: document.body` where bubbling matters, and each test asserts the control's own action ran |
| 9 | codex 4 (P3) | major | the scenario fake's `setTrust` never awaits a read, so parking `getTrust` pauses nothing | accepted: P3 parks on awaits the fake has (`getTokensRaw`, `getRecord`, the tip reader); the repo's read-then-fence stays pinned by `repository.test.ts:91` |
| 10 | codex 4 (P6) + Opus F3 | major / medium | the submit's presence after Enter proves nothing; the red run sends a real transaction; the spec can skip | accepted: `aria-busy` never appears over a settle window; the red run's transaction finishes before teardown; execution counts recorded, a skip is not a pass |
| 11 | codex 3 | major | a late pin write or a queued cleanup can recreate the purged key | amended: the facade's `unless` on pin/unpin writes plus a boot sweep of unregistered ids, instead of moving pins into a background service (a process-boundary change beyond this brief) |
| 12 | codex 5 | minor | the sink sentinel's `JSON.stringify` hides `Error.message` and `stack` | accepted: explicit normalization, every logger call at every level, dispatch/log/response asserted, refusal branch pinned |
| 13 | codex 6 + Opus F5 | minor / low | the scan does not prove registry completeness and misses `useSyncedRef`, `+` and `.js` | accepted: complete-membership test, widened scan, limits stated, p1/p10 exactness, three routings covered |
| 14 | codex 7 (sign-off) | minor | row 2 has no recorded sign-off; P7 and Delivery disagree | accepted: row 2 under the owner's blanket sign-off; one delivery boundary in P7, Approval and Delivery |
| 15 | codex 7 (comments) + Opus F6 | minor / low | obsolete `.value` paragraphs, a long composable header, "finding D", stale test headers and `(Q-07)` | accepted: all deleted or rewritten (§ A1, § A4, P1); one sentence at the new fence |
| 16 | Opus F4 | medium | "no per-profile UI key" overclaims: the address-keyed fee maps survive resume and reap | amended: claim narrowed to profile-keyed keys, residue named in Good enough, follow-up F-1 (pruning by address is unsafe; a global wipe would change those paths) |
| 17 | Opus F7 | low | A5's new reason does not explain the width | accepted: width plus the original collision rationale, no citation |
| 18 | codex (fact check) | minor | Fact 6's condition is `effectiveMethod && !feeJuiceMissing` | accepted: Fact 6 corrected, path fixed |
| 19 | codex final 1 | major | C5: deletion epochs survive a lock, an unlock and a switch; bind the write to the live session, and resolve the prompt-closing contract apart from row scope | accepted: `captureExecutionFence` first, the caller's profile matched, `isFenceLive` before the trust write, no `isReserved` term (Fact 38); § A3 states the interaction contract; UI impact row 3. Amended: the floor and un-hide read the lock and the incarnation only, so a lock mid-Allow cannot strand accepted receipts (§ Decision ledger) |
| 20 | codex final 2 | major | `onTokenAdded` reads the active profile after an await, so an add on A can auto-trust B's same contract | accepted: `TokenAdded` carries `profileId` (the `TokenDeleted` precedent) and the handler's fence must match it; the A→B test in P3; residual stated in § A3 |
| 21 | codex final 3 | major | a repeat or composing Enter first reaching an idle confirm activates it; IME boundary events can report `isComposing` false; Fact 33 misstates `Button`; no nested-popup test | accepted: a `@keydown.enter` guard on both confirms through the shared `isRepeatOrComposing` with the `keyCode` 229 fallback, also in `isPopupSubmitKey`; repeat-only, composing and 229 tests; Fact 33 corrected; the nested-popup case in P1 |
| 22 | codex final 4 | major | the boot sweep cannot bound a late pin: a same-id restore before the restart keeps it | amended: the sweep, its test and its wiring dropped (it also read the whole store at every background start); the exact-id purge and the `unless` kept; the residual stated in § A4 and § Security, R1 on the owner's residual list, follow-up F-5 |
| 23 | codex final 5 | minor | P4's red test passes today: reads also await the barrier | accepted: the marker is raised at the `knownContracts` seam after the map read, and the test waits for the write barrier before switching the scope |
| 24 | codex final 6 | minor | C8's reorder skips the floor when no trust row exists; Inference 5 accepts a visible residual without sign-off | amended: option (b) instead of repairing (c), so today's order keeps the floor and (c) is removed (repairing it needs a new pending-row write); both residuals on UI impact row 4 under the blanket sign-off; the no-successor test becomes a `(BUG PIN)`; follow-up F-4 |
| 25 | codex final 7 | minor | the `getRecord` paragraph at `service.ts:635-637` is test-specific; the new ordering needs a comment | accepted: the paragraph becomes the deletion and revival invariant; option (b) adds no ordering to comment |
| 26 | codex final (C3) | minor | arm the observation before input, since polling after it can miss a transient busy state | accepted: a `MutationObserver` armed before each key and kept through its handling; execution and skip counts kept |
| 27 | codex confirm 1 | major | an add stalled in its last `isNetworkLive` can outlive the token lock's watchdog, a deletion and a same-id restore, then emit; its handler captures the successor's fence | accepted: a synchronous deletion-epoch recheck right before the emit, compensating the row (§ A3); Inference 6 corrected; the watchdog regression in P3 |
| 28 | codex confirm 2 | minor | the already-trusted token-add branch writes no trust, so no `live()` check runs before its floor move | accepted: that branch reads `live()` after registration and returns if the session moved; the P3 case |

### Decision ledger

- **Outline**: the main outline (remove the document Enter, keep native button activation) over
  `outline-alt.md` (mark Enter at each control, keep the global Enter, two PRs); both legs agreed:
  the alternative fails open and changes three shared primitives.
- Rejected alternatives: § Trade-offs.
- **Settled · the session fence (C5)**: the final pass sided with codex. Deletion epochs do not
  move across a lock, an unlock or a switch (Fact 38), so only the execution fence ties a write to
  the session that authorized it. Built as § A3.
- **C8 · option (b) over (c)**: (c) skips the floor when no trust row exists (`service.ts:835`),
  and keeping it needs a new pending-row write; (b) writes trust first, so the row exists when the
  floor moves. Its residuals go to the owner (UI impact row 4).
- **The boot sweep, dropped** (codex final 4): membership cannot tell incarnations apart, since a
  same-id restore before a restart keeps the key, and it read the whole local store at every
  background start.
- **For the confirmation:**
  - *The follow-through fence.* Plan: the trust write reads `isFenceLive`; the floor move and the
    un-hides read the lock and the incarnation only. With (b), a session fence there turns a lock
    mid-Allow into row 4's state, a route today's code lacks (Fact 42), and breaks the contract
    that a refused choice stays `pending`. Codex (final 1): `isFenceLive` immediately before
    writes.
  - *Reachability.* The registration read already refuses a locked, reserved or inactive profile
    (Fact 40), so round 1's queued-behind-the-cascade race cannot write in production; § A3 and
    § Security now name what gets past that read. The fence design does not change.

### Follow-ups

- **F-1 · Address-keyed fee maps outlive a profile off the live path.** `nulo:ui:feePaymentMethods`
  and `nulo:ui:sendFeePaymentMethods` hold `{ [address]: … }` (`FeeSettingsCard.vue:293-296`);
  only `reset.vue:85-87` removes them, after the live delete returns, so the resume and torn-reap
  paths (and a popup closed mid-delete) leave the deleted profile's addresses. Pruning by address
  is unsafe (two profiles can share one); moving the global wipe onto the other paths changes
  their behaviour. Needs its own decision.
- **F-2 · The other interpolating refusals** in `method-scope-checkers.ts` (Ask C4), including the
  `sendTx` text the journal page renders.
- **F-3 · The page-level bare-Enter handlers** (recon § Inventory), none of which sends or signs.
- **F-4 · A repair path for an Allow the watchdog displaced mid-un-hide** (UI impact row 4): a
  `trusted` contract with hidden receipts has nothing that un-hides them (`service.ts:617-645`;
  only `setTrustAllow` writes `hidden: false`, Fact 17). Candidates: re-run the un-hide on replay,
  or write a `pending` row before the floor so the floor-first order stops skipping it
  (`service.ts:835`).
- **F-5 · Profile-keyed UI keys fenced by incarnation, or a sweep at a cheaper point** (codex
  final 4): a pin or cleanup racing a deletion can recreate `nulo:ui:pinnedTokens@<id>`, and a
  same-id restore inherits it (`usePinnedTokens.ts:224-241`, `profile/service.ts:1526-1529`,
  `operation-journal/service.ts:266-267`).
- **F-6 · The dApp windows' confirm buttons** accept a repeat or composing Enter that lands on them
  idle, as the two authwit confirms did (codex final 3). No window focuses its confirm by itself
  (the one `.focus()` under `popup/windows/` is an input, `capabilities/AccountSelectRow.vue:45`),
  so reaching one needs focus moved there with Enter held; `isRepeatOrComposing` would cover them.
- **F-7 · The add's other two compensations delete by id without lock ownership** (codex round 1
  on the build): `persistToken`'s post-set deletion and network checks delete `token.id` even when
  the watchdog displaced the section, so a same-id restore's row can go there too. Unlike the last
  fence, that row may postdate the purge's snapshot, so skipping the delete can orphan it; the
  choice needs its own decision.

## Approval

Approved for build by the final pass's confirmation (conditional approve, confidence high; its two
findings applied, rows 27 and 28). The owner picked O1 (a), as built, and signed off UI impact
rows 2 to 4 and R1 on 2026-09-29 (P7), with the scope above unchanged. The delivery boundary
below is met: both answers are quoted in P7.

**Delivery boundary** (the same rule in P7 and Delivery): the PR opens and CI runs while the
owner's answers are pending, but it does not merge until the owner's O1 answer and the blanket
sign-off are quoted in this plan.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/wallet-safety-fixes/lessons/phase-N.md`. Unit and component
commands run from the workspace named. Every phase writes its failing test first and records the
red run in its lessons file before the fix. A test listed as a pin is green before and after; a
`(BUG PIN)` pins a residual the fix leaves, so it is red until the fix lands (P3).

### P0 · Plan in the tree ✓

1. First commit: `implementations-plan/wallet-safety-fixes/` (`plan.md`, `recon.md`) and one line
   in `implementations-plan/index.md`.

Gate: `bun run lint`, `bun run test:ci-gating` exit 0 (the plans check reads the new directory).

### P1 · No Enter confirms a transaction popup from another control (A1) ✓

1. Red, in `RevokeAuthwitsPopup.test.ts` and `ChangeAuthwitsRegistryPopup.test.ts`, mounted with
   `attachTo: document.body`, fees set. A control is pressed with `pressOn` (the `keydown`, then
   the click a browser's activation dispatches unless a handler cancelled the key), which gains
   the event's init so a case can set `repeat`, `isComposing` or `keyCode` (Fact 43); the
   registry test gets its own copy (two copies, under the three-copies rule). Each case also
   asserts the control's own action ran:
   - Enter on the header's close button sends nothing and emits `onClose` once. The
     `PopupHeader` stub renders a `<button data-testid="popup-close-btn">`.
   - Enter on a control inside the fee card (the stub's button) sends nothing; the stub's own
     handler ran.
   - Enter on an element outside the popup, standing for a teleported menu item
     (`[data-dropdown-item]` appended to `document.body`), sends nothing.
   - Enter with nothing focused (on `document.body`) sends nothing.
   - Nested popup: Enter in the input of a second `usePopupEntity` form popup (a test harness with
     one input) shown over this one submits that popup once and sends nothing here.
   - Repeat-only entry: focus moves onto the idle confirm, then only `repeat: true` keydowns
     arrive: nothing is sent.
   - A composing Enter on the idle confirm (`isComposing: true`), and one with `keyCode: 229` and
     `isComposing: false`: nothing is sent.
   - Run on `624117cd`: all red (the popup sends). Recorded.
2. The composable, the two popups and `DropdownRoot` as § A1.
3. Green, and the existing pins rewritten to the button route:
   - Enter and Space on the focused submit (`pressOn`) send exactly once.
   - A held Enter on the focused submit (a first `keydown`, then several with `repeat: true`)
     sends exactly once (Fact 33; a pin).
   - A second press while in flight sends nothing.
   - An error keeps the Revoke button disabled and a press sends nothing.
   - The content button: Enter and Space open the content once and send nothing (kept).
   - The registry test's `Button` stub sets `disabled` from `disabled` only
     (`ChangeAuthwitsRegistryPopup.test.ts:66-69`), as the real primitive (Fact 33) and the
     Revoke stub do.
   - "Enter fires … when all chunks have fee set" and "non-Enter keys are ignored" go.
   - Both files' headers are rewritten to what they now pin, with no plan reference.
4. `usePopupEntity.test.ts`: the `submitKey` block goes; new: without `submit`, no `keydown`
   listener is added and `onShow`/`onHide` still run in order; Enter in an input with
   `repeat: true`, with `isComposing: true`, or with `keyCode: 229` and `isComposing: false`
   submits nothing; a plain Enter in an input submits once (kept). The `(Q-07)` describe name
   loses its tag.
5. `DropdownRoot` unit test: with the menu open and focus on an element outside it, Enter clicks
   nothing; with focus on an item, Enter clicks it (kept). Red on `624117cd` for the first case.
6. CLAUDE.md bullet (C6), through the `update-docs` skill.

Gate:
- `bun --bun vitest run src/composables/usePopupEntity.test.ts src/popup/components/popups/
  src/components/ui/Dropdown/` from `apps/extension`: exit 0, with the step-1 and step-5 cases
  green.
- `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.
- Layers: typecheck, lint, unit, component.

### P2 · Refusals carry no request value (A2) ✓

1. Sink pin first, `apps/extension/src/wallet/services/wallet-sdk/background.refusal-log.test.ts`,
   harness as `background.legal.test.ts:17-39`: `dispatch` rejects with the real error
   `checkCreateAuthWit` throws for a sentinel-filled request (one case per refusal, each asserting
   the thrown message starts with that refusal's prefix, so the intended branch ran). Asserted:
   `dispatch`, `log` and `sendResponse` were each called; every `log` call at every level, and the
   response, serialized with a normalizer that expands any `Error` (own properties plus `message`
   and `stack`, recursively), contain no sentinel. Run on `624117cd` and record the result
   (expected green, Inference 3; if red, stop and extend § A2 to the sink).
2. Red, `packages/wallet-bridge/src/method-scope-checkers.test.ts`: "no request value reaches a
   createAuthWit refusal": `SENTINEL-…` placed in `from`, the call's `to` and `name`, and the
   inner hash's `consumer`, against grants that refuse each; for each thrown error,
   `JSON.stringify({ ...err, message: err.message, stack: err.stack })` has no sentinel. Red on
   `624117cd`.
3. The three messages as § A2. Green.

Gate:
- `bun --bun vitest run src/method-scope-checkers.test.ts src/scope-enforcement.test.ts
  src/dispatcher.test.ts` from `packages/wallet-bridge`: exit 0.
- `bun --bun vitest run src/wallet/services/wallet-sdk/ src/utils/log-payload-ban.test.ts` from
  `apps/extension`: exit 0.
- `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.
- Layers: typecheck, lint, unit.

### P3 · A trust write lands only in its session and incarnation (A3) ✓

1. Red, `service.scenarios.test.ts`. The profile stub gains `captureExecutionFence`,
   `isFenceLive` and `getDeletionState` over a real `ProfileDeletionState` and a session serial,
   mirroring `profile/service.ts:521-555`: a lock ends the serial, a switch or an unlock starts a
   new one, and deleting the active profile bumps its epoch and ends its session (`:1486-1493`).
   Parking points are awaits the fake has (its `setTrust` awaits no read,
   `service.scenarios.test.ts:93-101`; the real read-then-fence is `repository.test.ts:91`), and
   the fake's `getNetwork` ignores the active profile (Fact 40), so each case tests the fence
   alone:
   - *Queued behind the cascade:* `clearProfile("p1")` parked inside the lock; Allow and Reject
     called, then `p1`'s deletion begins; release: no trust row for `p1`, both return `false`.
     Called after the deletion began, each returns `false` at the capture.
   - *Pre-lock:* Allow parked in the tip read while `p1` is deleted, and again with a same-id
     re-import unlocked before resuming: no row, `false`.
   - *Session:* a profile switch, and a lock, each while Allow waits in the tip read and while
     Allow or Reject waits in the registration read (`getTokensRaw`): the row stays `pending`,
     `false`.
   - *Watchdog handoff:* Allow and Reject each parked in `tokenService.getTokensRaw` → the
     watchdog fires → a successor `clearProfile("p1")` completes → resume: no row, `false`.
   - *Successor Reject:* Allow parked in the un-hide loop's `getRecord` → handoff → a successor
     Reject completes → resume: the remaining records stay hidden, trust stays `blocked`, `false`.
   - *(BUG PIN) no successor* (C8), named and commented per CLAUDE.md's bug-pin convention: Allow
     parked in `getRecord` → the watchdog fires, nothing waits → resume: trust stays `trusted`,
     the records after the parked one stay hidden, `false`, and `replayPendingPrompts` emits
     nothing for the contract.
   - *Token add after a switch:* the contract registered under `p1` and `p2`; `p1`'s add is
     emitted after the switch to `p2`: neither profile's trust row changes.
   - *Token add during a deletion:* `onTokenAdded` parked in the tip read while `p1` is deleted:
     no trust row, no floor.
   - *Already trusted:* a `trusted` row, and a profile switch while the token add waits in the
     registration read: the floor is unchanged.
   - *Stale add after a watchdog release* (`token/service.test.ts`): `addToken`'s last
     `isNetworkLive` parked → the token lock's watchdog fires → `p1` deleted and restored with the
     same id → resume: no `onTokenAdded` emitted, the row compensated, no trust row.
   - Red on `624117cd`: each case writes today, and the bug pin is red because today's displaced
     Allow keeps un-hiding.
   - A pin: a lock while Allow waits in `getRecord` after its trust write: the floor and every
     un-hide land, `true`.
2. The change as § A3: the fence helper; `TokenAdded` in `token/spec.ts`, `service.ts` and
   `client.ts`; the comments (`incoming-transfer/spec.ts`, `service.ts:635-637`, `token/spec.ts`,
   `settings/tokens/index.vue:37-40`).
3. Green. The existing token-add tests' payloads gain `profileId: "p1"` (the `tokenAdd` helper,
   `service.scenarios.test.ts:4756`, and the four direct invokes at `:2291`, `:2339`, `:2513` and
   `:2556`), with no assertion changed; every other existing Allow, Reject and token-add test is
   unchanged.

Gate:
- `bun --bun vitest run src/wallet/services/incoming-transfer/ src/wallet/services/token/
  src/wallet/services/token-balance/` from `apps/extension`: exit 0.
- `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.
- Layers: typecheck, lint, unit.

### P4 · Deletion removes profile-keyed UI keys (A4) ✓

1. Red, `coordinator.test.ts`, over a fake `StorageArea` seeded with `pinnedTokensKey("p1")` and
   `pinnedTokensKey("p10")`: `runFor("p1", …)` (the entry the live delete, the resume and the torn
   reap all use, Fact 22) removes exactly `p1`'s key, after `networks` and before `pxe`; `p10`'s
   stays; a throwing `remove` propagates. Red on `624117cd` (no such step).
2. `profile-ui-keys.ts`; `pinnedTokensKey` moved; the coordinator step and its constructor
   argument; `runtime.ts` passes `browserApi.storage.local`.
3. `usePinnedTokens.test.ts`:
   - Red: a pin parked at the awaited `knownContracts` seam, after its map read and scope check
     (`usePinnedTokens.ts:114-119`). The migration marker is raised there and the pin released;
     the test waits until its write reaches the barrier (the facade's `migrationIdle` listener is
     attached), then switches the scope and clears the marker: the pin writes nothing and returns
     `"stale"`. Red on `624117cd`, where it writes the old scope's key and returns `"pinned"`. With
     the scope unchanged, the same pin lands.
   - A pin: a deletion cleanup that runs after the purge (no stored key) writes nothing
     (`usePinnedTokens.ts:229-231`).
   - The existing tests pass with the new import.
4. `profile-ui-keys.scan.test.ts` (C7): complete membership, the widened scan, the count, the
   header stating its limits.

Gate:
- `bun --bun vitest run src/wallet/services/profile-deletion/ src/composables/usePinnedTokens.test.ts
  src/utils/profile-ui-keys.scan.test.ts src/utils/storage-facade-ban.test.ts
  src/wallet/services/profile/service.integration.test.ts` from `apps/extension`: exit 0.
- `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.
- Layers: typecheck, lint, unit.

### P5 · The journal id comment (A5) ✓

1. `operation-journal/service.ts:289-291` as § A5.

Gate: `bun run lint` exit 0; `git diff` for the file shows comment lines only.

### P6 · Browser proof and the arc gate ✓

1. C3's test in `tests/e2e/network/popup-escape-layered.test.ts`. Open the registry popup and wait
   for the live submit (`waitForSubmitLive`). Before each key, arm a `MutationObserver` in the
   page on `registry-toggle-submit`'s `aria-busy`, kept armed through that key's handling and a
   2-second settle, so a busy state however brief is recorded (polling after the key can miss it;
   `aria-busy` follows `loading`, which the handler sets before its first await, Fact 33). The
   keys: Enter on a focused `send-fee-priority-<level>`; ArrowDown to a method in the open fee
   menu and Enter (the menu closes: the item's own action ran); then Enter held down on a priority
   button, focus moved to the submit, and a second `keyboard.down("Enter")`, whose `repeat` a
   page listener records (Inference 7), before `keyboard.up`. No observer may record `aria-busy`.
   Red on `624117cd` on that signal, recorded; on the red run, wait for the popup to close (the
   sent transaction completes) before teardown. The file header's "No transaction is sent" holds
   on the fixed code.
2. Every row of the local gates: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`.
3. Smoke e2e on Chrome and Firefox: the migration-fixture build per browser, then
   `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.
4. Network e2e, retry 0, `NODE_OPTIONS=--dns-result-order=ipv4first`:
   `tests/e2e/network/popup-escape-layered.test.ts`, `tests/e2e/network/authwit-lifecycle.test.ts`
   and `tests/e2e/network/token-add-auto-trust.test.ts` (a real token add reaching the fenced
   handler) on Chrome (prover on) and Firefox (`NULO_E2E_PROVERLESS=1`).
5. Flake bar: `popup-escape-layered.test.ts`, three consecutive retry-0 runs per browser.
6. `bun run e2e:reap`.

Gate: all of the above exit 0; each run's summary in `lessons/phase-6.md` with its executed,
passed and skipped counts. A skipped network spec (no network configuration, Fact 34) is not a
pass.
Layers: typecheck, lint, unit, component, CI-gating, build, e2e, e2e-live-network.

### P7 · The owner's sign-off ✓

1. One page for the owner with O1 (both options, a short capture of each: Tab to Send and Enter;
   Enter on ×) and one blanket sign-off for UI impact rows 2 to 4 and the residual list.
2. Record the answers here. If the owner picks (b), that is a new phase: the nothing-focused rule
   in the two popups (container-scoped, repeat- and composition-safe), its tests, P6's gates again.

Answers:
- O1: Owner pick on the decision page, 2026-09-28 (confirmed in chat: "done"): O1 (a). No new
  phase.
- The blanket sign-off (UI impact rows 2 to 4, R1): the owner, 2026-09-29, answered the question
  "Wallet-safety blanket sign-off: do these four behaviour changes read right? Nothing drawn
  changes", which listed UI impact rows 2, 3 and 4 and residual R1: "Sign off all".

Gate: the delivery boundary (§ Approval): the PR may open before this gate; it does not merge
until the owner's O1 answer and the blanket sign-off are quoted in this plan.

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P6 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't?"), and these
   two rules, verbatim in the first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/phase-6.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc, one branch `fix/wallet-safety-fixes`, one PR off `dev`, plain `gh pr create`
  after the loop converges; then `gh pr checks --watch`.
- Title: `fix(security): enter confirms only the focused button; fence trust; purge profile keys`
  (≤ 93 characters).
- Commits: conventional, lower-case, signed; at least one per phase, fixes separate.
- PR body: summary, the UI impact table, O1 and the blanket sign-off with its residual list as
  **pending** (or the owner's answers), the red-before-green evidence per phase, the A2 premise
  correction (Fact 13), test evidence with e2e counts.
- **Overlap.** `ux-owner-picks` rewrites `send.vue`'s `onTokenAdded` body (`send.vue:89-91`); this
  PR changes only the event's payload type and edits no `send.vue` line, so no textual conflict is
  expected. `grant-check-address-case` shares `method-scope-checkers.ts` (§ A2).
- **Merge boundary** (§ Approval): not merged until the owner's O1 answer and the blanket sign-off
  are quoted in this plan. Merging is the owner's call.
- Closing the plan: the `## Outcome` block, lessons promoted, follow-ups F-1 to F-7 moved to
  `implementations-plan/follow-ups.md`, in the same PR.

## Seeds

DRAFT until approval.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/wallet-safety-fixes/plan.md. Done when the transcript shows every phase ✓ in plan.md with its validation gate reported passing, the red run recorded before each fix, LESSONS_FILE=implementations-plan/wallet-safety-fixes/lessons/phase-N.md printed per phase, P6's e2e counts recorded with no skipped network spec, a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. Never merge: the PR waits for the owner's O1 answer and blanket sign-off. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/wallet-safety-fixes/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step; write its failing test first and record the red run; after each edit run bun run lint and the phase's vitest command; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner. Phase gate green: paste it, mark ✓, print LESSONS_FILE. A skipped network spec is not a pass. All phases ✓: the Post-implementation loop, then gh pr create and gh pr checks --watch, then report and stop. Never merge; the PR waits for the owner's answers; hard limits stay hard.
```

Use exactly one per session.
