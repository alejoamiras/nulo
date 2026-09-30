---
plan: connect-window
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Opus 5.5 subagent
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: feat/connect-window
worktree: a harness-created agent worktree (its path is recorded in lessons/phase-0.md)
base: 85c4d20f (dev after #719; of the files this plan changes or cites, #719 edited only `tests/e2e/fixtures/extension.ts` and `fixtures/browser/index.ts`, away from the lines cited; Facts 20 and 26 re-verified there)
---

## Outcome

- **Date:** 2026-09-29, updated 2026-09-30. **Status:** closed, awaiting archive: delivered on
  `feat/connect-window`, not yet merged. Under the owner's delegation of 2026-09-29, a panel of two
  Opus 5.5 evaluators and Codex decided O1 (a), O2 (b) worded "No account shared", and the blanket
  rows, and added one copy fix; P8 records each as delegated, and the owner confirmed each on
  2026-09-30 (P8). Every option and every blanket row is pictured on the owner's page.
- **Shipped:** ux-feedback's 4B and the emoji check's header, P0 to P7 as planned. After Allow the
  connect window waits in the connect screen's loading look, then the worker loads the emoji check
  into that window and focuses it; the verify slot holds the waiting window until its removal;
  every exit before the check closes the window and tombstones the attempt's marker, and only a
  successful establishment spends one; the check's header names the account and the network by
  name; OK refuses a repeat Enter through keyboard-guards' `refuseRepeatEnter`. The codex loop
  added one fix (a failed establishment tombstones its marker), a success-path control for the
  never-dispatched test, and three comment edits. After the panel, the check's header reads "No
  account shared" beside the session's network until an account is shared, and the connect page's
  revoke line names Settings → Connected Apps.
- **Gates at delivery:** lint, `typecheck:all`, `test:all`, `test:ci-gating` and `build` exit
  0 on the final commit. On the merged head `9eac9f47`, at retry 0 and in three shards: smoke on
  Chrome (166 tests: 159 passed, 7 skipped) and Firefox (155 passed, 11 skipped); the network
  suite on Chrome (140 prover-on tests: 135 passed, 5 skipped, after one load flake's rerun; the
  18 proverless ones passed) and Firefox (158: 151 passed, 7 skipped); the armed reorg spec on
  both (on Firefox its race did not land, so the canary skipped itself); the flake bar three of
  three per browser. Every skip is in the declared or opt-in
  inventory, and the same suite ran green on `494cb9e3` before the merge (`lessons/phase-7.md`).
  Codex approve in two rounds of three, and on the merge in a third (`lessons/post-impl.md`).
  After the panel's changes (`lessons/phase-8.md`): the five local gates exit 0 on `2c0a2c19`;
  smoke in three shards on Chrome (166: 159 passed, 7 skipped) and Firefox (155 passed, 11
  skipped), as at P7; the 12 connect and verify network specs on Chrome (16: 15 passed, 1
  skipped) and Firefox (16 passed); codex round 4 found one gap in the records, fixed, and round
  5 approved.
- **Dropped:** nothing.
- **Open items:** none left here. F-1 to F-7 are in `follow-ups.md` § Connecting a dApp (F-4 to
  F-7 from the panel, which also widened F-1 and F-2); the two ux-feedback entries this plan
  resolves, and keyboard-guards' FU-2 (Verify's OK), are deleted from it. One lesson is in
  `lessons.md` § CI & gates; the per-browser navigation finding stays in `lessons/phase-6.md`,
  since `lessons.md` sits at its budget.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

# One connect window

Two follow-ups from the ux-feedback program, as one PR off `dev`:

- **4B · one connect window.** After Allow, the connect window stays open and turns into the
  emoji check once the secure channel is up, instead of closing so the service worker opens a
  second window. The permission window stays its own window. Today a connect pops up to three Nulo
  windows; this merges the first two. Design: round 1's "A + B" drawing
  (`implementations-plan/ux-feedback/design/mocks/src/parts/04-window-placement.html`, block
  "A + B", and `design/mocks/src/r2/i4.html`). Record: `implementations-plan/ux-feedback/plan.md`
  § Follow-ups ("its own blueprint (it touches the verify path); round 1's "A + B" drawing is its
  design").
- **The emoji check's header.** It reads "NO ACCOUNT" before an account is chosen, and
  "chain 0" instead of the network's name on a reconnect (batch 2's parity capture). Record:
  `implementations-plan/follow-ups.md` § ux-feedback: owner decisions.

Recon: [`recon.md`](recon.md). Competing outline: `outline-alt.md` (local, not committed).
A path starting `src/` is under `apps/extension/`, unless a command names another workspace.

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner's standing instructions for this program:

- 2026-09-28: "Can you ultracode 1 to 5 + security and privacy + test rliability + trivial?
  Assigning blueprinting level to each of those and just needing me to answer the open questons
  that it may come."
- 2026-09-29: "Feel free to leverage the gh cli to merge away the branches that you understand are
  ready and feel confident on their implementation. Continue then with ultracodeing the
  follow-ups."
- 2026-09-28: "FYI: use opus5.5 instead of fable please."
- 2026-09-29: "let's cover realistic scenarios lol." and "for next documents please put how it's
  going to look on each choice you are giving me".

For 4B itself, 2026-09-23: "B (one connect window) is a follow-up arc, not this one"
(`implementations-plan/ux-feedback/plan.md` § Follow-ups).

- **Scope**: 4B and the header fix above. The emoji check keeps its content, its toggle, its OK
  and its meaning: a comparison aid, as today (§ Security).
- **Out**: a "doesn't match" action on the emoji check (F-1); a wallet-enforced confirmation
  before dispatch (F-3); merging the permission window into the flow (the drawing keeps it
  separate: "the app asks for them on its own schedule, and possibly never"); the discover
  window's own header (F-2); any change to trusted-reconnect behaviour; the window budgets'
  numbers.
- **Constraints**: pre-production, no migrations; complexity budgets hold with no new acceptance;
  no new dependency and no new manifest permission; the logging policy and
  `log-payload-ban.test.ts`; the storage facade rule; existing testids verbatim; the playground
  stays generic (CLAUDE.md § The wallet repo).
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Validation layers**: typecheck and lint, unit, component, CI-gating, build; smoke e2e on Chrome
  and Firefox (the popup pages and the e2e fixtures change); the network suite on Chrome and
  Firefox, because the shared connect fixture changes; a flake bar for the specs this plan adds or
  changes.
- **Decisions**: UI and product asks go to the owner; technical asks are decided with
  `/codex high`. Every Ask carries a recommendation, a confidence and a label.
- **Delivery**: single arc, one PR off `dev` on `feat/connect-window`, plain `gh pr create` after
  the codex loop converges. Merge by the driver under the owner's standing authorization, once
  every required check is green on the head, every UI surface carries the owner's quoted sign-off
  and the codex loop has converged.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 2 | A window that changes owner mid-flow (the approval popup's handle gives it to the connection flow) and a navigation the service worker has never done |
| Blast radius | 2 | The verify path, the window budget, the approval-window manager, the connect page, and the e2e connect fixture every network spec rides |
| Irreversibility | 1 | Code and tests only; no stored shape changes |
| Migration cost | 0 | Pre-production: nothing to migrate |
| External coupling | 1 | Browser window and tab APIs on two engines; the wallet-sdk handshake is untouched |
| Security sensitivity | 3 | The emoji check is the person's comparison that the page holds this channel (B-06, B-13) |

The rubric sits at the `mid`/`deep` line (9 of 18, a 3 in security). It stays `mid`, under the
owner's cap "never blueprint more than mid, to keep our credits safe", because the scope is held
tight: one window, one route change driven by the service worker, the existing verify page reused
for the check, and the permission window, the check's semantics and the discover header left
alone (F-1, F-2, F-3 name what would push it to `deep`).

## Outcome & Quality Bar

For whom: a person connecting a dApp to Nulo for the first time, with the dApp's own "verify the
grid" modal on screen, comparing two grids of emojis; and a person reconnecting a remembered but
untrusted dApp.

Excellent means:

1. **One Nulo window from Connect to OK.** After Allow the same window, in the same spot, shows
   the emoji check, focused; no second emoji window appears. The permission window opens whenever
   the app asks, as today, which can be while the check is still on screen. A network e2e on
   Chrome and Firefox records every window created and fails on `85c4d20f`.
2. **The grid in that window is this connection's, always.** It derives from the hash the service
   worker writes for this session only. Two dApps connecting at once, a second connect from the
   same origin and a reconnect each show their own grid; the e2e matches the window's grid against
   the dApp's own hash.
3. **No new connection establishes without its check window, and no window outlives its
   attempt.** Every exit between Allow and the check (Reject, closing the window, a lost channel,
   a slow approval, a full window budget, the dApp's tab closing, a lock or a profile switch)
   rejects the discovery or terminates the session, closes the window, cancels the attempt's
   pending-verification marker so no later establishment of it can succeed (whatever the row's
   trust flag says by then), and frees the budget slot only when the window is gone. A held
   Enter on Allow submits once and approves nothing else; Escape approves nothing.
4. **The check's header names who and where.** No bare "NO ACCOUNT" before an account is shared
   (after the panel: "NO ACCOUNT SHARED" and the session's network), and the network's name
   ("Local Network" on chain 0) instead of "chain N" on every reconnect.

Good enough: the waiting state reuses the connect screen's own loading look (Allow spins, Deny is
disabled, the status dot orange), with no new copy; the check stays a comparison aid and closing
it keeps the session, as today (R1); a reconnect's check stays its own window; a dApp that stalls
without closing its tab, or whose tab navigates away, leaves the window waiting until its slot
expires (R2).

## UI impact

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | The connect flow's windows | Allow closes the connect window and a second Nulo window, the emoji check, opens focused in the same corner → the same window waits (today's loading look held: Allow spins, Deny disabled, orange status dot), then shows the emoji check and takes focus; OK closes it. Under O1 (a) a two-step bar sits under the header on the connect screen (step 1) and on the check (step 2) | **O1 (a), delegated; the owner confirmed 2026-09-30** |
| 2 | The emoji check's header before an account is shared (every new connection, and a reconnect of a dApp that never asked for accounts) | "NO ACCOUNT", no network → "NO ACCOUNT SHARED · Local Network": the session's network by name, never in orange (O2 (b) as the panel worded it; (a) named the active account) | **O2 (b), delegated; the owner confirmed 2026-09-30** |
| 3 | The emoji check's header on a reconnect with shared accounts | "ACCOUNT 1 · chain 0" (or `chain 1816023401` on testnet); two accounts: "2 ACCOUNTS · MIXED" in orange → "ACCOUNT 1 · Local Network"; "2 ACCOUNTS · Local Network", orange only when an account sits on another chain | **O2, delegated; the owner confirmed 2026-09-30** |
| 4 | A connect that fails after Allow (a slow Allow, a full window budget, a lost channel, the dApp's tab closed, the window closed before the approval's writes finished) | The connect window has already closed and nothing more appears → the waiting window closes (with the tab, for a closed tab; when the refusal lands otherwise, at most about 65 s after the connect began); the end state is the same, the window just leaves later | **blanket, delegated; the owner confirmed 2026-09-30** |
| 5 | Closing the waiting window after the approval landed | Not possible today (the window closed itself at Allow) → the channel is terminated, the Allow stands (the connection is remembered, as today once Allow is clicked), and the next Connect shows the reconnect's own emoji check | **blanket, delegated; the owner confirmed 2026-09-30** |
| 6 | The connect screen's revoke line | "You can revoke this connection any time from Settings → General → Sessions.", a screen that does not exist → "… from Settings → Connected Apps." | **the panel's one fix, delegated; the owner confirmed 2026-09-30** |

Unchanged: the Deny path, the emoji check's content, toggle and OK, the permission window, the
reconnect's own emoji window (other than rows 2 and 3), trusted reconnects (no window), the
connect screen before Allow except O1 (a)'s bar and row 6's line. The playground's hidden hash
element (§ P6) is a test hook with no visible surface and needs no sign-off.

### UI asks for the owner (decided by the panel under the owner's delegation, P8; the owner confirmed them)

- **O1 · The one window's states, as built from the "A + B" drawing.** Options: **(a) with a
  two-step progress bar under the header (step 1 on Connect and while waiting, step 2 on the emoji
  check)**; **(b) no bar: the window only changes its content.** The drawing's "Nulo · Connect
  2 / 2" label is its schematic caption, like "Nulo · Permissions": no text ships in either
  option. Recommended and built: (a), because the drawing the owner picked shows the bar and it
  tells the person the window moved on rather than changed app. (b) is quieter and has one fewer
  element. Confidence: moderate. Delegated decision: (a), as built (P8).
- **O2 · The emoji check's header before an account is shared.** Options: **(a) the active
  account and the session's network ("ACCOUNT 1 · Local Network"); when the session's network is
  not the active one, the same label in orange, since that account sits on another chain**;
  **(b) "NOT SHARED YET · Local Network".** Both then show the shared account(s) and the network,
  and replace "chain N" and "MIXED" with the network's name. Recommended and built: (a): in the
  one window the account label stays the same from Connect to the check, as the permission window
  shows it. (b) is stricter about what the dApp holds and never names an account on another
  chain, at the cost of a label that changes mid-window. Confidence: moderate. Delegated
  decision: (b), worded "No account shared", now built (P8).
- **The blanket sign-off** covers UI impact rows 4 and 5 and these residuals, each pictured in P8:
  - R1 · The emoji check stays a comparison aid, as today: the dApp confirms on its own side,
    OK only records "Always trust" and closes, and closing without OK keeps the session.
  - R2 · A dApp that stops answering after the approval without closing its tab, or whose tab
    navigates to another page, leaves the window waiting until its slot expires, at most about
    65 seconds after the connect began, then it closes. (The worker cannot see a navigation's
    URL without the `tabs` permission, which this plan does not add; Fact 31.)

  Delegated decision: signed, with the copy fix of UI impact row 6 (P8).

## Architecture & Implementation

### A1 · The one window's states

| State | Route | What shows | Exits |
|---|---|---|---|
| S0 Connect | `/windows/discover` | Today's connect screen (O1 a: step bar, step 1) | Deny, close, the dApp cancelling, a lock or switch, the 10-minute timeout: all as today (the interaction is rejected, the window closes) |
| S1 Waiting | `/windows/discover` | S0 with Allow spinning and disabled, Deny disabled, the status dot orange | the channel comes up → S2; any exit in § A3's table → the window closes and the discovery is rejected or the session terminated |
| S2 Emoji check | `/windows/verify?sessionId=…&verificationHash=…&isReconnect=false` | Today's verify page, same window, same bounds, refocused (O1 a: step 2) | OK (with "Always trust" if set) → closed; closing → closed, the session stays (R1); a lock, as in today's verify window (Fact 28), keeps the window, its slot and the channel, but the shell replaces the check with the unlock screen |
| S3 Closed | none | nothing | the budget slot frees when the window's removal arrives |

Keyboard. S1: Allow's `disabled` attribute and `approve()`'s guard both read `isLoading`, which
stays true after a successful Allow (§ A5), so a held or repeated Enter submits once and reaches
no control afterwards; disabled-and-loading keeps the loading look (Fact 22). S2: nothing is
focused (the Allow button that held focus is gone), and no file under `popup/windows/` installs a
document key listener (Fact 17), so Enter and Escape act on nothing. OK itself ignores a repeat or
composing Enter (Decision ledger, driver 2026-09-29); `keyboard-guards` (wave 2 stage B) guards the
other dApp windows' confirm buttons.

### A2 · Connect paths and the windows each shows

| Path | Today | After |
|---|---|---|
| A new dApp, unlocked | connect window, then a verify window; the permission window whenever the dApp asks | one connect window (S0 → S1 → S2); the permission window whenever the dApp asks |
| A new dApp while locked | queued; after unlock, as above | queued; after unlock, one connect window |
| A second connect for the same `(origin, chain)` while the first's window is open | waits on it, then its own verify window while the row is untrusted (`approveAfterPopup`, Fact 12) | unchanged; the first's window shows the first's grid |
| A remembered, untrusted dApp | its own verify window | unchanged, with the new header |
| A remembered, trusted dApp | no window | no window |
| Deny, or Terms not current | window closes, or no window | unchanged |

So the verify window stays for reconnects and for the twin, and for a new connection whose
connect window the service worker holds no id for (Decision ledger, realism).

### A3 · Who owns the switch, and how the window learns the channel is up

The service worker owns it end to end; the page is passive after Allow and never navigates
itself. There is no polling: establishment pushes the route change.

1. **Hand-over at Allow.** The page calls `resolveInteraction(requestId, { approved: true })` as
   today, then drops its `beforeunload` reject and stays in S1 instead of closing
   (`discover/index.vue:112-113` today). In the service, when the STORED interaction's payload is
   a `DiscoveryPayload` and `result.approved === true`, the interaction settles through
   `WindowManager.handOver`: it settles the promise, stops watching and forgets the window
   without removing it, handing its id to the awaiting caller. Any other kind or answer settles
   and closes as today; the page's result shape never picks the branch. The caller receives
   `DiscoveryOutcome = { approved: true, windowId }` built from the handle, never from the page's
   object (a page cannot name a window).
2. **Bind to the tab, then attach at admission.** Right after the hand-over, `runDiscoveryPopup`
   records `{ tabId: discovery.tabId, windowId }` under the request id in `state.handedOver`, and
   deletes that entry in its `finally`; this is what lets a closed tab find a window that is
   still queued, before any marker or reservation exists (Fact 31). It then reserves the slot as
   today (`admitAsync`, `background.ts:983-998`; while it queues, the window stays in S1 and
   still counts in the connect-popup cap, Fact 25) and attaches the window to the reservation:
   `reservation.attach(windowId)`. A window already closed (its removal buffered, Fact 10) fails
   the attach: the discovery is rejected. From here the reservation owns the window.
3. **Every exit before approval closes the window, and a closed window refuses the approval.**
   `runDiscoveryPopup`'s `finally` closes an unattached connect window; an attached one closes
   through the reservation when `persistAndApprove` gives its slot back (`releaseIfUnstarted`,
   `persistAndApprove`'s `finally`). The approval's durable writes can wait on storage
   (Fact 34), so a person can close the window while they run: the removal releases the
   reservation, and `approveOrRollbackDiscoverySession` rechecks it immediately before it sets
   the marker (a new `attemptOpen()` argument, false once `reservation.abandoned`, beside
   `isDiscoveryExpired`): a closed or cancelled attempt takes the existing rollback (the new row
   deleted, the discovery rejected) with its own log reason, and no marker is ever set for it.
   The recheck and the marker write run with no await between them.
4. **Establishment shows the check.** `handleSessionEstablished` calls one dispatch helper,
   `showVerifyWindow`, where it calls `openVerifyWindow` today, so it gains no branch: a
   reservation in `standby` goes to `showVerifyInConnectWindow` (claim the standby window,
   `windows.navigate(windowId, verifyWindowUrl(...))`, adopt, then a best-effort
   `windows.update(windowId, { focused: true })`); any other reservation opens a window as today.
   A navigation rejection is replaced by a fixed `Error("verify window could not be shown")`
   before it can reach the catch that logs `err` (`session-established.ts:161-166`), as
   `openVerifyWindow` does (`:209-211`). One `verifyWindowUrl` builds both URLs.
5. **Every exit after approval closes it too**: a termination (`onSessionGone` → `cancel`), the
   dApp's tab closing (below), the slot's expiry (the fallback for a tab that navigated away,
   Fact 31), a failed navigation, and every B-13 early return, which already give the slot back
   in `finally` (`session-established.ts:169-173`).
6. **An abandoned attempt's marker becomes a tombstone, not a gap.** The SDK keeps an approved
   discovery alive until its tab tears down and restores it on every termination, so the same
   session id can establish again at any later time (Fact 30). Deleting an abandoned attempt's
   marker would let that late establishment read as a reconnect, and a row another connection
   had meanwhile marked "Always trust" would skip the check (`session-established.ts:150`).
   So the gate's `released(id)` hook calls `cancelPendingVerification(markers, id)`, which marks
   an existing entry `cancelled: true` (a no-op when establishment already consumed it).
   Establishment's first check becomes `marker && isPendingVerificationDead(marker)` (cancelled
   or stale, `session-established.ts:96`), so a tombstoned id terminates whatever the row's trust
   flag says, and `finally` deletes the entry only when it is not a tombstone, so a retry of that
   id terminates too. A new Connect is a new request id and is unaffected: a legitimately
   trusted reconnect still skips the check. `onTabTeardown(tabId)` closes every
   `state.handedOver` window of the tab (best effort), cancels the reservation of every marker of
   the tab (`admission.onSessionGone(id)`, which closes a standby window), then deletes the tab's
   markers, tombstones included, as today: `terminateForTab` has dropped the tab's discoveries by
   then, so no establishment of those ids can follow (Fact 30).

Exits between Allow and the check, and what each does:

| Exit | Who sees it | Result |
|---|---|---|
| The person closes the window while the Allow queues for a slot | `onRemoved` → the gate buffers it | the attach fails, the discovery is rejected |
| The person closes the window while the approval's writes run | `onRemoved` → the reservation; `attemptOpen()` before the marker | the new row is deleted, the discovery rejected, no marker set |
| The person closes the window after the approval landed | `onRemoved` → the reservation | the slot frees, the marker is tombstoned; establishment, now or on any retry of that id, terminates (B-13); the row stays (UI row 5) |
| Lock or profile switch | the page's shell guard (Fact 16) | the page closes the window: as the three rows above; before the approval, `persistAndApprove`'s profile check also refuses |
| The Allow came past the 55 s cutoff | `rejectIfExpired` | discovery rejected, window closed |
| The window budget is full | `admitAsync` → queued, then rejected or expired | the window stays in S1 while queued; rejected or expired: discovery rejected, window closed |
| The approval did not land, or a durable write failed | `persistAndApprove` / `approveOrRollbackDiscoverySession` | discovery rejected, the slot given back, the window closed |
| The dApp's tab closes, while the Allow queues or after it | `tabs.onRemoved` → `onTabTeardown` | the handed-over window (queued) or the reservation's window (standby) closes at once; the discovery is gone with the tab; the tab's markers deleted |
| The dApp never completes key exchange, its tab still open, or its tab navigates to another page | the slot's expiry, `deadline + RESERVATION_GRACE_MS` (Fact 11); a navigation reaches no listener (Fact 31) | the window closes, the marker is tombstoned (R2) |
| Establishment refuses (no row, profile skew, stale marker, the session died mid-validation, the hash write failed) | `handleSessionEstablished` | terminated as today; the slot's `finally` closes the window |
| The navigation fails | `showVerifyInConnectWindow` | the window is adopted and closed, the session terminated, dispatch refused (establishment returns false) |
| The session ends during the navigation | `cancel` on an in-flight claim | the arriving window is closed on adoption, the session is already gone |

### A4 · The reservation's standby state

`WindowReservation` (`verify-admission.ts:51-132`) gains two states and keeps its invariant: a
slot is released only when its window is gone.

```
unstarted --attach(w)--> standby(w)            (a buffered removal of w: released, attach → false)
standby   --claimStandby()--> in-flight(w)     (returns w; markInFlight() refuses a standby slot)
in-flight --adopt(w)--> opened | abort         (unchanged)
standby   --releaseIfUnstarted | cancel | expiry--> closing(w)   (the gate's closeWindow(w))
standby | closing --windowRemoved(w)--> released
```

- `markInFlight()` accepts only `unstarted`, so `openVerifyWindow` can never open a second window
  against a standby slot: it throws and the session terminates.
- The gate takes `hooks: { closeWindow(windowId), released(id) }` in its constructor, wired in
  `initWalletSdkHandler`: `closeWindow` is best effort (`windows.remove(...).catch(() =>
  undefined)`), `released` tombstones the id's marker (§ A3 step 6).
- `abandoned` is true in `closing` and `released`: the approval's recheck reads it (§ A3 step 3).
- `serve()`'s expiry sweep and `nextWake()` treat `standby` like `unstarted`
  (`verify-admission.ts:271`, `:305`), so a window nobody establishes closes on time.
- A failed navigation adopts and closes (the window may still be open), so the slot frees on its
  removal and never while it shows.

### A5 · The connect page

- `approve()`: after `resolveInteraction` resolves, `completeInteraction()` (the listener removal
  `closeWindow(true)` does today, split out) and no `closeWindow`. `isLoading` is reset only in
  the `catch`, so it stays true in S1: Allow's spinner, `approve()`'s guard (`:109`), Deny's
  disabled state and the orange status dot (`stripStatus`, Fact 22) all hold with no second
  flag, and `:confirm-disabled` gains `isLoading` so Allow's own `disabled` attribute holds too.
- The shell's profile guard is unchanged: a lock or switch during S1 closes the window.
- Comments in the touched code keep only what the code cannot say: the trust-anchor readiness gate
  (`discover/index.vue:33-39`, `:88-92`, `:100-105`) and the shell's cleanup order
  (`useDappApprovalWindow.ts:1-29`) lose their reviewer history, plan links and narration; the
  hand-over gains one line: the window id comes only from the service's handle, and a cleanup
  never touches a successor reservation. On the verify page the narrating comments at
  `verify/index.vue:36`, `:163`, `:169`, `:191`, `:198` and `:211` go. `handleSessionEstablished`'s
  TSDoc (`session-established.ts:50-66`) keeps two invariants in a few lines: the check's grid
  comes from this session's own hash in the URL, never the shared row; and a session whose hash
  could not be persisted or whose check window could not be shown is terminated before any
  message is dispatched. Its history ("the prior leak") and the word "unverified", which reads
  as an enforced check, go.
- Option (a) of O1: a two-segment `ConnectStepBar.vue` (`step: 1 | 2`, `aria-hidden`, since the
  content already says which step this is), under the header on the connect page and on the
  verify page when `isReconnect=false`. It lives beside the two windows that use it
  (`src/popup/windows/ConnectStepBar.vue`, imported explicitly, an L5-local piece like
  `execute/SignerIdentityStrip.vue`), not in `src/components/`. No copy. For capture only, the
  builder renders option (b) by leaving the bar out.

### A6 · The emoji check's header

A pure helper, `popup/windows/verify/header-labels.ts`, computes both labels from wallet-local
data only (never the dApp's metadata), so they are tested without mounting:

- **Network**: the session's network name, `resolveDappChain(session.chainId, appStore.networks,
  undefined).name`, in every branch (chain 0 resolves "Local Network", `getChainName` covers an
  unconfigured chain). It replaces `chain ${acc.chainId}` and "MIXED". `warn` is true when a
  shared account parses to another chain than the session's.
- **Account**: one shared account resolved → its name; several → "N accounts"; shared but
  unresolved → the trimmed address (today); none shared → "No account shared" (O2 (b), as the
  panel worded it; P8). The labels read neither the active account nor the active network.
- The verify page passes these to `IdentityStrip` as today (`verify/index.vue:184-188`);
  `resolveSigners` is unchanged.

### Key interfaces

```ts
// packages/wallet-core/src/ports/window-port.ts
/** Load `url` in the window's tab. Rejects when the window or its tab is gone. The browser's
 *  error can carry the URL: callers never log or surface it. */
navigate(windowId: number, url: string): Promise<void>

// src/wallet/services/dapp-interaction/spec.ts
/** What `discover()` resolves with: the page's answer plus, for an approval, the window the
 *  connection flow now owns. `windowId` is set by the service from its handle, never by the page. */
export type DiscoveryOutcome = DiscoveryResult & { windowId?: number }

// src/wallet/services/window-manager/window-manager.ts
/** Settle with `value(windowId)` and give the window to the caller: it is neither watched nor removed. */
handOver<T>(handleId: string, value: (windowId: number | undefined) => T): void

// src/wallet/services/wallet-sdk/verify-admission.ts
WindowReservation.attach(windowId: number): boolean
WindowReservation.claimStandby(): number | undefined
WindowReservation.abandoned: boolean   // closing or released
new VerifyAdmissionGate(clock, hooks: { closeWindow(windowId: number): void; released(id: string): void })

// src/wallet/services/wallet-sdk/pending-verification.ts
export type PendingVerificationEntry = { at: number; profileId: string; tabId: number; cancelled?: true }
/** Tombstone `id`'s marker if it exists: its attempt was abandoned, so no establishment of it may succeed. */
export function cancelPendingVerification(markers: Map<string, PendingVerificationEntry>, id: string): void
/** A cancelled or stale marker: establishment terminates on it. */
export function isPendingVerificationDead(entry: PendingVerificationEntry, now?: number): boolean
/** Establishment is done with `id`'s marker: deleted unless it is a tombstone. */
export function consumePendingVerification(markers: Map<string, PendingVerificationEntry>, id: string): void

// src/wallet/services/wallet-sdk/discovery-approval.ts
approveOrRollbackDiscoverySession(args: { /* today's fields */ attemptOpen: () => boolean }): Promise<boolean>

// src/wallet/services/wallet-sdk/background.ts (SdkHandlerState)
handedOver: Map<string, { tabId: number; windowId: number }>   // request id → the waiting window, until runDiscoveryPopup settles

// src/wallet/services/wallet-sdk/session-established.ts
export function verifyWindowUrl(dappSessionId: string, verificationHash: string, isReconnect: boolean): string
SessionEstablishedDeps.windows: Pick<WindowPort, "create" | "remove" | "getLastFocused" | "navigate" | "update">
```

`DiscoveryDeps` gains `closeWindow(windowId)`. The chrome adapter's `navigate`: `chrome.tabs.query({
windowId })`, then `chrome.tabs.update(tab.id, { url })`; a window with no tab rejects.

### Data and control flow (the critical path)

```
page Allow ─resolveInteraction─▶ DappInteractionService (stored kind = discovery, approved)
  ─handOver─▶ discover() = {approved, windowId}
runDiscoveryPopup: handedOver.set → rejectIfExpired → admitAsync → reservation.attach(windowId)
  → persistAndApprove → approveOrRollback: attemptOpen() and fresh, then marker set,
    approveDiscovery                                               (page shows S1 meanwhile)
SDK key exchange → onSessionEstablished → handleSessionEstablished: every gate as today, stamp
  → needsVerification → showVerifyWindow: reservation.status === "standby"
  → showVerifyInConnectWindow: claimStandby → navigate(windowId, verifyWindowUrl(row id, this
    session's hash, false)) → adopt(windowId) → focus               (window shows S2)
OK → verify page closes the window → onRemoved → reservation released (marker already gone)
```

A resolved navigation, like a resolved `create` today, proves the window exists and was sent this
URL, not that the grid rendered; the component test and the e2e prove the rendering.

### File-level change map

| File | Change |
|---|---|
| `packages/wallet-core/src/ports/window-port.ts` | `navigate` |
| `packages/wallet-core/src/testing/fake-browser-api.ts` (+ `fake-browser-api.test.ts`) | `FakeWindowsAdapter.navigate` (records; rejects for a gone id) |
| `apps/extension/src/core/adapters/chrome-browser-api.ts` (+ `chrome-browser-api.test.ts`) | `ChromeWindowsAdapter.navigate` |
| `src/wallet/services/window-manager/window-manager.ts` (+ test) | `handOver`; a pin for the orphan close (Fact 24) |
| `src/wallet/services/dapp-interaction/spec.ts`, `service.ts` (+ `service.test.ts`) | `DiscoveryOutcome`; an approved discovery, by stored kind, hands its window over |
| `src/wallet/services/wallet-sdk/verify-admission.ts` (+ test) | `standby`, `closing`, `attach`, `claimStandby`, `abandoned`, the two hooks |
| `src/wallet/services/wallet-sdk/pending-verification.ts` (+ test) | `cancelled`, `cancelPendingVerification`, `isPendingVerificationDead` |
| `src/wallet/services/wallet-sdk/discovery-approval.ts` (+ test) | `attemptOpen()` rechecked beside `isDiscoveryExpired`, before the marker |
| `src/wallet/services/wallet-sdk/background.ts` | the gate's hooks; `DiscoveryDeps.closeWindow`; `state.handedOver`; attach in `runDiscoveryPopup`, the unattached close in its `finally`; `attemptOpen` passed from `persistAndApprove`; `onTabTeardown` closes the tab's handed-over windows and cancels its reservations before deleting its markers |
| `src/wallet/services/wallet-sdk/test-services.ts` | a new row keyed by the origin `addDappSession` receives (`dappMetadata.url`), not the fixed one |
| `src/wallet/services/wallet-sdk/background.connect-window.test.ts` (new) | the hand-over through the SDK callbacks, with the REAL `wireTabLifecycle` over a `chrome.tabs` stub that captures its listeners (as `tab-lifecycle.test.ts:27` does): every exit, abandonment, two origins at once, the twin, a full budget |
| `src/wallet/services/wallet-sdk/session-established.ts` (+ test) | `verifyWindowUrl`, `showVerifyWindow`, `showVerifyInConnectWindow`; the dead-marker check and the tombstone-keeping `finally`; TSDoc trimmed |
| `src/wallet/services/wallet-sdk/test-ports.ts` | `navigate` on the inert port |
| `src/composables/useDappApprovalWindow.ts` (+ its test) | `completeInteraction()` split out of `closeWindow(true)`; header comment trimmed |
| `src/popup/windows/discover/index.vue` (+ `index.test.ts`, `index.lifecycle.test.ts`) | S1 instead of closing; `isLoading` held; Allow disabled while loading; comments trimmed; the step bar (O1 a); both tests' `Button` stubs made faithful (Fact 32) |
| `src/popup/windows/verify/index.vue`, `header-labels.ts` (new, + tests), `index.test.ts` (new) | the header; the step bar (O1 a); narrating comments removed; OK refuses a repeat or composing Enter |
| `src/popup/windows/ConnectStepBar.vue` (new, + test) | O1 (a) only |
| `apps/playground/src/lib/wallet.ts`, its state and markup | record `pending.verificationHash` on a testid'd hidden element |
| `apps/extension/tests/e2e/fixtures/popups.ts` | `approveConnect(ctx, discoverPage)` |
| `apps/extension/tests/e2e/fixtures/extension.ts` | `connectPlayground` through `approveConnect` |
| `apps/extension/tests/e2e/network/connect-one-window.test.ts` (new) | § P6 |
| `tests/e2e/network/`: `connect-locked-queue`, `cold-wake-discovery`, `session-reconnect-flood`, `session-tabClose`, `session-reconnect`, `session-profileSwitch`, `session-tabNavigate`, `window-placement` (`.test.ts`) | each new-connection `waitForPopup(…, "verify")` after Allow becomes `approveConnect` (Fact 20) |
| No change, reconnect waits | `fixtures/send.ts` (`reconnectPlayground`), `frozen-account-canary`, `passkey-execution-canary`, and the reconnect waits in `session-tabClose`, `session-reconnect`, `session-tabNavigate`, `window-placement` |
| `implementations-plan/connect-window/`, `implementations-plan/index.md` | plan, recon, lessons; index line |

### Trade-offs and alternatives not taken

- **The page switches itself** on a payload the service worker pushes (`outline-alt.md`): no new
  port method and no browser navigation, but it keeps the hand-over and the standby state and adds
  a long-lived RPC waiter registry, and the hash reaches the page through a message instead of the
  URL the worker writes. Neither transport proves the grid rendered. Ask C1.
- **Render the grid inside the connect page** without a route change: a second copy of the
  verify page's B-06 read path and trust toggle. Rejected: one page shows the check.
- **Close the connect window and open the verify window at its bounds**: item 4 A already puts
  both in one corner; it is still two windows, which is what the owner asked to remove.
- **The page reports its own window id at Allow**: a page-supplied id would let any extension
  page aim the check at another window. The id comes from the handle.
- **A connect-window registry in `background.ts`** beside the reservation: two owners of one
  window's lifetime. Ask C2.

## Security & Adversarial Considerations

- **What the check is, and stays.** The emoji check is a comparison aid in the wallet-sdk's model:
  the person compares the grid the dApp shows with the wallet's, and the dApp confirms on its own
  side (`apps/playground/src/lib/wallet.ts:93-94`, `pending.confirm()`); the wallet's OK only
  records "Always trust" and closes (`verify/index.vue:75-80`), and the channel is live once
  establishment returns (`session-established.ts:150-157`). This plan keeps that exactly. The
  security the check gives is the person's comparison; a wallet-enforced "they match" click would
  add a click, not a comparison, and would make every dApp wait on the wallet (F-3). The plan
  therefore claims nothing an enforced check would need: a dApp can dispatch, and ask for
  permissions, while the check is on screen, as today.
- **Threat model.** The targets are: a window showing another session's grid, a new connection
  that establishes with no check window at all, a window left behind by a dead attempt, and a
  page steering the worker at a window it does not own.
  - *Wrong grid (B-06).* The connect window is bound to one discovery twice over, both on the
    service-worker side: the interaction carries the discovery's request id as its cancellation
    token (`background.ts:973`), and the window id travels in that one `discover()` call's result
    to that one reservation, keyed by the same request id (the session id,
    `verify-admission.ts:32`). The route's hash is written by the worker from
    `session.verificationHash` (`session-established.ts:199`), the page reads it from its URL
    (`verify/index.vue:143`). Two origins at once, the same-origin twin and a reconnect are unit
    tests; the e2e matches the window's grid to the dApp's own hash.
  - *No check window (B-13).* Every exit in § A3's table rejects the discovery or terminates the
    session, and closes the window. `markInFlight` refusing a standby slot means no path opens a
    second window against the slot or skips the navigation, and a failed navigation terminates
    with no message dispatched. A window closed during the approval's writes refuses the
    approval (§ A3 step 3), and an abandoned attempt's tombstone makes every later establishment
    of its id terminate, even after another connection set "Always trust" on the shared row
    (§ A3 step 6). What stays true today and is not claimed away: a still-open S2 keeps its
    reservation, and closing or locking it keeps the channel (R1).
  - *Leftovers.* An abandoned attempt's window closes with its tab or at the slot's expiry; its
    tombstone lives until the tab closes or the worker restarts, which is exactly as long as the
    SDK can replay that id (Fact 30).
  - *Window confusion.* The hand-over is chosen by the stored interaction's kind, never the
    page's answer, and the worker navigates only a window its own handle created, only to its own
    `chrome.runtime.getURL(...)`. A page calling `resolveInteraction` with a `windowId`, or a
    capability window answering `{ approved: true }`, changes nothing (P3 tests).
  - *Keyboard.* A held Enter on Allow submits once, and OK ignores a repeat or composing Enter
    (§ A1); nothing new listens for Enter or Escape at the document.
  - *Budget.* Before admission the kept window counts in the connect-popup cap (4 per origin, 32
    global, Fact 25) exactly as today's pre-Allow window; after it, it holds the verification
    slot the verify window held (`VERIFY_WINDOWS_PER_ORIGIN = 2`), from attach until it is gone.
    An origin never holds more windows than today; a P3 test holds a waiting window under a full
    verification budget.
- **Header data.** Both labels come from wallet-local account and network data, never the dApp's
  metadata; a component test with a hostile dApp name (bidi and zero-width characters, 64
  characters) pins that the header shows neither.
- **Input validation.** Unchanged at every trust boundary; `DiscoveryOutcome.windowId` is never
  read from the page.
- **Least privilege.** No manifest permission: the worker already calls `chrome.tabs.update`
  without `tabs` (`src/wallet/utils/onboarding-tab.ts:34`); Inference 1 covers the query and
  Firefox.
- **Logging.** No new log line carries a URL, a hash or an id other than through
  `describeExternalId`; `navigate`'s rejection never reaches a logger (§ A3 step 4), and a P4 test
  injects a rejection carrying the URL and asserts that no logger call holds the hash or the row id.
- **Cryptography and supply chain.** None: `hashToEmoji` (`@aztec/wallet-sdk/crypto`) and the
  handshake are unchanged; no dependency.

## Assumptions

### Facts (verified at `48a97f4a` by reading the file; the base `85c4d20f` has the same tree for every file cited except the two e2e fixtures #719 edited, re-read there for Facts 20 and 26)

1. After Allow the page resolves, then closes its own window (`src/popup/windows/discover/index.vue:112-113`);
   the service detaches and settles (`src/wallet/services/dapp-interaction/service.ts:216-218`),
   and `_settle` removes the window too (`src/wallet/services/window-manager/window-manager.ts:263-267`).
2. The verify slot is reserved after Allow, before the session row is written
   (`src/wallet/services/wallet-sdk/background.ts:985-998`), and a new session starts with no
   accounts (`:1034-1037`).
3. The marker is request-keyed and set just before the approval
   (`src/wallet/services/wallet-sdk/discovery-approval.ts:61-62`); a new connection always needs
   the check (`session-established.ts:77-78`, `:150`).
4. Within establishment, the verify window opens only against a reserved slot, else the session
   terminates (`session-established.ts:154-155`), and its URL carries this session's hash
   (`:198-200`, B-06 pinned at `session-established.test.ts:98-106`).
5. B-13, within establishment: failures terminate; the marker is cleared and an unstarted slot
   given back in `finally` (`session-established.ts:158-173`; pins `session-established.test.ts:108-132`).
6. `session-established.test.ts` passes at `48a97f4a` (21 tests, run alone with
   `bun --bun vitest run` from `apps/extension`; re-run by the same-family audit).
7. `WindowPort` can create, watch, remove, focus and read bounds, and cannot navigate
   (`packages/wallet-core/src/ports/window-port.ts:39-55`); the worker already calls
   `chrome.tabs.update` with no `tabs` permission (`src/wallet/utils/onboarding-tab.ts:34`;
   permissions `apps/extension/manifest/manifest.config.ts:46`).
8. A reservation is released only when its window is removed; an unstarted one is reclaimed after
   `expiresAt` (`verify-admission.ts:12-15`, `:114-126`, `:271`).
9. `markInFlight` accepts only `unstarted` (`verify-admission.ts:80-84`).
10. A removal nobody owns yet is buffered and consumed by the next `adopt` of that id
    (`verify-admission.ts:92-96`, `:190-200`); `onRemoved` feeds the gate (`background.ts:134`).
11. The discovery deadline is 55 s after the dApp's request
    (`packages/wallet-bridge/src/discovery-queue.ts:16`, `background.ts:700`), and a reservation's
    `expiresAt` is that deadline plus `RESERVATION_GRACE_MS` = 10 s (`verify-admission.ts:28`, `:250`).
12. A second connect for the same `(origin, chain)` waits on the first's popup and is approved with
    no marker (`background.ts:776-781`, `:894-925`, `approveAdmitted` `:814-839`), so its
    establishment is not a new connection: it opens its own verify window only while the row is
    untrusted (`session-established.ts:150`), and none once the first's check set "Always trust".
13. A termination calls `onSessionGone` (`background.ts:441-442`), which cancels the reservation
    (`verify-admission.ts:107-112`, `:186-188`).
14. The check's header is `IdentityStrip` fed by the verify page: "No account" when no account is
    shared (`src/popup/windows/verify/index.vue:43`), `chain ${acc.chainId}` for one account
    (`:50`), "MIXED" for several (`:52`), and the label is uppercased
    (`src/components/composite/IdentityStrip.vue:70`). The connect and permission windows use
    `DappStatusStrip` with the active account and network (`discover/index.vue:144-148`,
    `capabilities/index.vue:376-379`, fallback `DappStatusStrip.vue:20`).
15. `resolveDappChain` returns the configured network's name, else `getChainName`, and handles
    chain 0 (`src/popup/windows/capabilities/chain-mismatch.ts:15-24`; `chain-mismatch.test.ts:42`).
16. The shell's guard rejects on an undefined or different profile
    (`src/composables/useDappApprovalWindow.ts:102-104`), a lock emits `undefined`
    (`src/wallet/services/profile/service.ts:934`), and discover's `reject` closes the window
    (`discover/index.vue:128-132`).
17. The `beforeunload` reject is added after init and removed only by `closeWindow(true)` or
    `dispose` (`useDappApprovalWindow.ts:79`, `:95-100`, `:131`, `:136`); no file under
    `src/popup/windows/` adds a key listener (`rg keydown`, tests excluded).
18. Closing the verify window only frees its slot: nothing else listens for its removal
    (`background.ts:134`), and OK sets the trust flag if asked, then closes
    (`verify/index.vue:75-80`).
19. `DiscoveryResult` is `{ approved: boolean }`, supplied by the page through
    `resolveInteraction` (`src/wallet/services/dapp-interaction/spec.ts:101-103`, `:115`), which
    serves discover, capability and execute windows alike and settles the result as given
    (`service.ts:203-219`).
20. `connectPlayground` waits for a NEW verify target after Allow
    (`apps/extension/tests/e2e/fixtures/extension.ts:356-366`); `connect-dapp` rides it. Ten spec
    files wait on `"verify"`. New-connection waits after Allow: `connect-locked-queue.test.ts:45`,
    `cold-wake-discovery.test.ts:82`, `session-reconnect-flood.test.ts:34`,
    `session-tabClose.test.ts:33`, `session-reconnect.test.ts:43`,
    `session-profileSwitch.test.ts:50`, `session-tabNavigate.test.ts:35`,
    `window-placement.test.ts:220`. Reconnect waits: `session-tabClose.test.ts:47`,
    `session-reconnect.test.ts:66`, `session-tabNavigate.test.ts:58`,
    `window-placement.test.ts:245`, `frozen-account-canary.test.ts:227`,
    `passkey-execution-canary.test.ts:207` (both after a reload of a remembered session) and
    `fixtures/send.ts:14` (`reconnectPlayground`).
21. The playground confirms the channel at once and keeps no hash
    (`apps/playground/src/lib/wallet.ts:93-94`); `PendingConnection.verificationHash` is public
    (`@aztec/wallet-sdk` 5.2.0, `dest/manager/types.d.ts:13-24`).
22. `Button`'s `loading` does not disable it; `disabled` sets the attribute and `tabindex=-1`, and
    disabled-and-loading keeps the loading look (opacity 0.8 both,
    `packages/design/src/ui/Button.vue:102-105`, `:158-161`, `:368-370`). `approve()` resets
    `isLoading` in `finally` (`discover/index.vue:123-125`) and guards on it (`:109`);
    `stripStatus` reads only `isLoading` (`useDappApprovalWindow.ts:89-93`).
23. A pending-verification marker is deleted only by establishment's `finally`
    (`session-established.ts:170`), the approval's rollback (`discovery-approval.ts:63`) and tab
    teardown (`background.ts:157`, `tab-lifecycle.ts:52-55`); `onSessionTerminated`
    (`background.ts:441-447`) and a reservation's expiry (`verify-admission.ts:271`) delete none.
    The SDK's key-exchange failure never calls `onSessionEstablished`.
24. A window whose handle settled before its `create` resolved is closed on arrival
    (`window-manager.ts:143-146`).
25. The unlocked connect-popup caps are 4 per origin and 32 in all (`background.ts:695-696`,
    counted at `:934`), over `pendingDiscoveryPromises`, whose entry `runDiscoveryPopup` holds until
    its `finally` (`:1001`), after admission and the approval.
26. Over BiDi a window is born `about:blank` and no event reports its URL
    (`apps/extension/tests/e2e/fixtures/browser/index.ts:93-96`); `window-placement.test.ts:269`
    skips a Firefox-only case on Chrome, and `CHROME_ONLY` declares whole-file Firefox skips
    (`fixtures/browser/index.ts:182-185`).
27. The unit harness's fake stores every new row under one fixed origin
    (`src/wallet/services/wallet-sdk/test-services.ts:35`) and mocks tab lifecycle away
    (`background.admission.test.ts:48`).
28. A lock tears down no channel (`profile-switch-teardown.ts:123`), and the verify page has no
    profile guard (`verify/index.vue:119-178`), so a lock leaves today's verify window, its slot
    and its channel in place; but the window's shell handles the lock (`src/popup/app.vue:219`)
    and routes it to `/popup/auth` or `/popup/register` (`src/popup/locked-state.ts:29-32`), so
    the check's content does not survive the lock.
29. `WindowPort.update` can focus a window (`window-port.ts:50`); the approval popups' own focus
    call uses it (`window-manager.ts:194-203`).
30. The SDK keeps an approved discovery until its key exchange, and restores it as approved on
    every `terminateSession`, so the same session id can establish again later; only
    `terminateForTab` drops a tab's discoveries (`@aztec/wallet-sdk` 5.2.0,
    `dest/extension/handlers/background_connection_handler.js:132-149`, `:159-199`, `:236-259`,
    `:260-271`). A marker-less establishment of a trusted row skips the check
    (`session-established.ts:150`).
31. `onTabTeardown` runs only from `tabs.onRemoved` (`tab-lifecycle.ts:52-55`); the `onUpdated`
    branch sees only established sessions and gets no URL for an ordinary origin without the
    `tabs` permission (`:26-38`, `:61-65`). Before the approval a queued attempt has no marker
    (`background.ts:983-998`; `discovery-approval.ts:61`).
32. Both discover test files stub `Button` with `:disabled="disabled || loading"`
    (`discover/index.test.ts:162`, `index.lifecycle.test.ts:205`); the real `Button` disables
    only on `disabled` (`packages/design/src/ui/Button.vue:103`).
33. The flood spec remembers its origin before its reconnects (`session-reconnect-flood.test.ts:29-35`),
    and a remembered `(origin, chain)` skips the connect window (`background.ts:752-755`). A
    mounted verify page reads its row only at mount (`verify/index.vue:151-156`).
34. The approval's durable writes can wait on storage contention or a suspended worker
    (`discovery-approval.ts:10-19`), and the marker is set only after them (`:61`).

### Inferences (unverified; audits attack these)

1. `chrome.tabs.query({ windowId })` returns the approval popup's tab id, and `chrome.tabs.update`
   loads the extension's own URL in it, on Chrome and Firefox, with no `tabs` permission. P6's e2e
   on both browsers is the proof. **Verified by P6 on both browsers.**
2. A `tabs.update` whose URL differs only in the fragment is a same-document navigation that
   vue-router's hash history follows (the same-family audit traced vue-router 4's null-state
   `popstate` handling). If either engine reloads instead, S2 still renders (the verify page reads
   only its URL), and the `beforeunload` reject is already gone (§ A5). P6 records which happened
   per browser. **Verified by P6: the same document on Chrome and on Firefox**
   (`lessons/phase-6.md`).
3. The handle's `windowId` is set before any page can answer Allow: Allow waits on init's round
   trips (`discover/index.vue:84-93`), which start after the window exists.
4. A session's shared accounts are on its chain (grants are chain-scoped), so "MIXED" never held
   in practice; `warn` stays for an account on another chain.
5. Key exchange lands well under a second after the approval on a local machine, so S1 is usually
   brief; it lasts as long as a full verification budget holds the Allow in the queue, which is
   how P8 captures it. Nothing is decided on this inference.
6. No production caller other than `runDiscoveryPopup` reads `discover()`'s result
   (`rg "\.discover\("`, confirmed by both audits), so widening it to `DiscoveryOutcome` is local.

### Asks

**Owner** (§ UI asks; one decision page after the build, P8)

- **O1 · The one window's states**: (a) the two-step progress bar; (b) no bar.
  Recommendation: (a). Confidence: moderate.
- **O2 · The check's header before an account is shared**: (a) the active account and the
  session's network, orange when they differ; (b) "Not shared yet" and the network. Both name the
  network on reconnects. Recommendation: (a). Confidence: moderate.
- **Blanket sign-off**: UI impact rows 4 and 5, residuals R1 and R2.

**Codex** (round 1, then the final fresh pass; both recorded, the final one binds)

- **C1 · How the window switches.** Worker navigation (`WindowPort.navigate`) or the page
  switching itself (`outline-alt.md`). Round 1: **amend**: the worker, without claiming its
  resolution proves the grid rendered. Final: **approve**, keeping that caveat. Applied
  (§ Data and control flow).
- **C2 · Where the kept window's lifetime lives.** Round 1: **approve** the `standby` state in
  `WindowReservation`. Final: **amend** with the cancellation guarantees of its findings 1 to 3.
  Applied: the approval's recheck (§ A3 step 3), the tombstone (step 6), the tab binding (step 2).
- **C3 · Closing the waiting window when the dApp's tab goes away.** Round 1: **amend**: decide the
  cleanup technically, route visible timing to the owner. Final: **amend**: the claimed
  immediate cleanup was not implemented for a queued attempt or a navigation. Decided: the
  handed-over window is bound to its tab from the hand-over (§ A3 step 2) and closes on
  `tabs.onRemoved`, queued or standby; a navigation reaches no listener, so the slot's expiry is
  its fallback, stated in R2 and pictured. A closed tab then closes the window at once, which is
  what a person sees today, so there is no timing ask.
- **C4 · The e2e call sites.** Codex: **approve** (both passes) moving the new-connection waits to
  `approveConnect`; the reconnect waits stay (Fact 20).
- **C5 · The playground records the handshake's hash.** Codex: **approve** (both passes); it is
  standard wallet-sdk surface, per attempt, and a hidden test hook that needs no UI sign-off.

### Plan audit ledger

Round 1 ran in parallel; both legs saw this plan, `recon.md` and `outline-alt.md`. The final
fresh pass reads the revised plan, `recon.md` and the brief.

- `/codex high` round 1 (GPT-6 Astra, session `01a0edcd-82bd-7372-8bea-5f25f5bb929c`): **reject**,
  confidence high.
- Opus 5.5 (same-family leg): **conditional approve**, confidence moderate-high.
- `/codex high` final fresh pass (GPT-6 Astra, fresh context, session
  `01a0edee-1916-7f42-98e8-08a5111191c5`): **conditional approve**, confidence high, conditions 1
  to 7 (rows Z1 to Z7, all applied). Its re-check of round 1: X1 holds once Z6 corrects the lock;
  X2 was incomplete (Z1 to Z3); X3 + F5 and X4 + F1 + F8 hold, their proof needing Z4; X5 was
  partial (Z4); X6, X7 + F2, F4, F6, F7, F9 and F11 hold; X8 needed Z7; F3's realism rejection and
  F10's recipe failed (Z1, Z5).

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| X1 | codex | major | The plan claims a check that cannot be skipped or pre-answered, which an advisory check cannot give; permission requests can arrive before OK; a lock keeps established channels | amended (driver's call): every enforced-check claim removed; § Security states the check stays a comparison aid; wallet-enforced confirmation is F-3 with its reasoning; A2 and Outcome 1 let the permission window open while the check shows; S2 and Fact 28 state the lock behaviour. Owner routing disputed (Decision ledger) |
| X2 | codex | major | An abandoned handshake (no establishment) leaks its `pendingVerification` marker | accepted: § A3 step 6 (the gate's `released` hook deletes the marker; `onTabTeardown` cancels the tab's reservations first); P4 tests abandonment without establishment, then a late establishment (terminated) and a retry (Fact 23). Deletion superseded by a tombstone: Z2 |
| X3 + F5 | both | major | S1's Allow stays keyboard-actionable (loading does not disable, `finally` resets `isLoading`), and the orange dot never shows because `stripStatus` reads only `isLoading` | accepted: `isLoading` reset only in `catch`, `connecting` flag dropped, Allow's `disabled` gains `isLoading` with no visual change (Fact 22); P5 and P6 test a repeated Enter through Allow → S1 → S2 |
| X4 + F1 + F8 | both | major | The browser proof is blind on Firefox (`about:blank` targets), never holds Enter across the transition, and the failed navigation's URL-bearing error can reach a Warn log | accepted: windows recorded with `chrome.windows.onCreated` from an extension page and `getCurrent` ids, identical on both engines; held-Enter assertion in P6; the navigation error replaced by a fixed one and a P4 sentinel test on every logger call; failed-navigation no-dispatch and marker assertions in P4 |
| X5 | codex | minor | P3 asserts navigation before P4 builds it; the fake stores rows under one origin and stubs tab lifecycle; "none skipped" is impossible; pins labelled as red tests | accepted: navigation assertions moved to P4; `test-services.ts` keys rows by the given origin and the new test captures `wireTabLifecycle` (Fact 27); P6/P7 gate an explicit skip inventory (Fact 26); pins labelled as pins |
| X6 | codex | minor | C3 decides visible timing; blanket rows are text-only; O2 (a) can pair the active account with another network; the playground hook needs no UI sign-off | amended: C3 decided technically with no lingering window, so no timing ask (driver's rule); every blanket row pictured in P8; O2 (a) shows the mismatch in orange and P8 pictures it; the playground row left the UI table |
| X7 + F2 | both | minor | Fact 12 overstates the twin, Fact 20 miscounts and moves reconnect call sites (`fixtures/send.ts`, both canaries), the "2 windows" budget is the verification cap only | accepted: Facts 12 and 20 corrected, the change map splits new-connection from reconnect waits, § Security cites both caps (Fact 25), a P3 test holds a waiting window under a full verification budget |
| X8 | codex | minor | Touched code carries reviewer history and narrating comments | accepted: § A5 trims them and adds the one hand-over invariant |
| F3 | Opus | low | A window closed after attach but before `approveDiscovery` still approves and keeps the row | amended: the attach-to-approve gap is milliseconds of durable writes (realism line); the realistic case, closing S1 after the approval, is stated (the Allow stands, the row stays, the next Connect shows the reconnect's check), pictured as UI row 5 and pinned in P4. Realism line overturned: Z1 |
| F4 | Opus | low | "Unchanged: the connect screen before Allow" contradicts O1 (a)'s bar on S0 | accepted: S0's bar is in UI row 1; the Unchanged line excepts it |
| F6 | Opus | low | The hand-over must key on the stored interaction's kind, not the page's result | accepted: § A3 step 1; P3 adds a capability `{ approved: true }` case |
| F7 | Opus | low | Two realism lines are wrong: an orphan create is closed, and an idle port does not keep a Chrome worker alive | accepted: both lines corrected (Facts 24; the 10 s shell poll); P3 pins the orphan close |
| F9 | Opus | low | The navigated window is not refocused; today's check opens focused | accepted: best-effort focus after adoption (§ A3 step 4, Fact 29), asserted in P6 |
| F10 | Opus | low | P8's S1 capture races a sub-second key exchange | amended: S1 is captured built, from a connect queued behind a full verification budget, which holds S1 deterministically |
| F11 | Opus | low | "As drawn" is ambiguous about the drawing's "Connect 2 / 2" label | accepted: O1 says it is a schematic caption and no text ships |
| Z1 | codex final | major | Closing the window while the approval's durable writes wait deletes nothing, then `approveOrRollback` sets a marker no reservation will ever expire; F3's "milliseconds" realism line does not hold (Fact 34) | accepted (driver's call): `attemptOpen()` rechecked right before the marker, with no await between; a closed or cancelled attempt rolls back (row deleted, discovery rejected); the realism line removed; P3 tests a deferred write, a removal, then the write completing; UI row 4 names the case |
| Z2 | codex final | major | Deleting an abandoned attempt's marker lets a late establishment read as a reconnect and skip the check once a sibling set "Always trust" (Fact 30) | accepted: the `released` hook tombstones the marker instead (`cancelled`), establishment terminates on a dead marker whatever the trust flag, `finally` keeps the tombstone, tab teardown deletes it when the SDK drops the tab's discoveries; a new request id is unaffected, so a trusted reconnect still skips (§ A3 step 6); P4 adds the sibling-trust, retry and trusted-reconnect cases |
| Z3 | codex final | major | Tab teardown fires only on `tabs.onRemoved`, cannot see a navigation, and finds no marker for an attempt still queued; the test captured the callback instead of the listener | accepted: `state.handedOver` binds the window to its tab from the hand-over, `onTabTeardown` closes it; navigation is stated as the expiry fallback (R2, Fact 31); the new test runs the real `wireTabLifecycle` over a `chrome.tabs` stub and fires its `onRemoved` listener, queued and standby |
| Z4 | codex final | minor | Gates that pass without proof: the discover tests' `Button` stubs disable on `loading`; P6 never checks `repeat`; P4 never injects a message during the failed navigation; unchanged cases labelled red-first | accepted: both stubs made faithful (Fact 32); P6 records `KeyboardEvent.repeat` in `sessionStorage` and requires a `true`; P4 injects a `sendTx` during the failed navigation and asserts no dispatch and no queued journal record; P3's denial, capability and execute cases and P5's `JobCancelledError` and failed-Allow cases labelled pins |
| Z5 | codex final | minor | P8's S1 recipe cannot reach the connect window: the flood setup remembers the origin first (Fact 33) | amended: codex's two recipes need a second network or eight windows on a one-network rig; P8 instead holds the origin's two slots with two open reconnect checks, forgets the app in Settings (a mounted check keeps its window and slot), then connects anew from a third tab; the capture asserts the discover route and S1 first |
| Z6 | codex final | minor | Fact 28 omits that the shell routes a locked window to auth or register | accepted: Fact 28 and A1's S2 row separate the kept window, slot and channel from the replaced content; semantics unchanged |
| Z7 | codex final | minor | Comment cleanup misses narration on the verify page and history in `handleSessionEstablished`'s TSDoc | accepted: § A5 lists `verify/index.vue:36`, `:163`, `:169`, `:191`, `:198`, `:211` and trims `session-established.ts:50-66` to its two invariants |

### Decision ledger

- **Outline**: the main outline, worker-driven navigation of the kept window with a `standby`
  reservation, confirmed by both legs (codex C1 amend, C2 approve; Opus agrees), over
  `outline-alt.md`, which keeps the same hand-over and adds a waiter registry.
- Rejected alternatives: § Trade-offs.
- **Settled by the final pass, for the driver**: *who decides whether the check stays advisory.*
  Ours (driver's call): the SDK's model makes the check a comparison the person performs and the
  dApp confirms; 4B merges two windows and keeps that model, so wallet-enforced confirmation is
  F-3, not an owner Ask, and the owner page names "the emoji check stays a comparison aid, as
  today" in one blanket line with a screenshot (R1). Round-1 codex: make it an owner decision
  with pictures of both outcomes. Final pass: today's semantics stay; OK only writes optional
  trust and closes (`verify/index.vue:75`), the playground confirms on its own side
  (`apps/playground/src/lib/wallet.ts:93`); the pictured blanket line suffices, and an
  enforcement UI is outside this PR. No point remains disputed.
- **Realism** (no fix, no test, no owner question):
  - A worker restart while the window waits: since Chrome 114 an idle port does not keep the
    worker alive, but the window's shell polls `getActiveProfile()` every 10 s
    (`popup/app.vue:404`) and the wait is 65 s at most; Firefox does not end its event page while
    an extension page is open (CLAUDE.md § In CI, Firefox lanes). Not addressed.
  - `handOver` with no window id: needs a page that answers Allow before its own window's
    `create` resolved (Inference 3). The window manager then closes the orphan window
    (Fact 24) and the check opens in its own window as today. Not addressed beyond P3's pin.
  - Withdrawn by the final pass: "the person closing the window in the milliseconds between attach
    and `approveDiscovery`". The writes can wait on storage (Fact 34) and closing right after
    Allow is ordinary; fixed in § A3 step 3 (Z1).
  - A tombstone outliving its use: it lives until its tab closes or the worker restarts, one
    small entry per abandoned attempt in a tab that stays open, and it can only ever refuse its
    own id. Not addressed.
  - Back (Alt+Left) in S2 returns to the dead discover route: `init` fails into "Something went
    wrong", nothing can re-approve, the slot stays held until the window closes. Not addressed.
  - A cross-origin request-id collision letting one dApp's approval ride another's Allow: exists
    today and needs a guess of a random id. Not this plan's.
  - A same-origin twin connecting at the same moment as the first: realistic but uncommon; its
    path is unchanged and one unit test holds it (§ A2).
- **Realistic, in scope**: two dApps on different origins connecting at once (two tabs); an Allow
  past the 55 s cutoff; a full window budget (the flood spec); a lock or switch while waiting; a
  closed waiting window, before, during and after the approval's writes; a dApp tab closed while
  waiting, queued or not; a late establishment of an abandoned attempt after another connection
  trusted the row; a repeated Enter on Allow; a dApp on another network than the active one (O2).
- **The brief's "closing the window at any stage fails closed"**, narrowed with evidence: closing
  in S0 or S1 before the approval rejects the discovery; after the approval it terminates the
  channel and keeps the row (UI row 5); closing S2 keeps the session, as closing today's verify
  window does (Fact 18, R1).
- **The brief's "no state lets a dApp skip or pre-answer the check"**: withdrawn by the driver;
  the check stays advisory (§ Security, F-3).
- **Verify's OK ignores a repeat or composing Enter** (driver, 2026-09-29). The two plans
  disagreed: this plan's Delivery said `keyboard-guards` guards `verify-confirm-btn`, while
  keyboard-guards' plan leaves Verify to this PR (its FU-2), since this PR rewrites the window. This
  PR takes it. When the branch merges `origin/dev` before the final gate, OK uses keyboard-guards'
  shared `refuseRepeatEnter` if it is on `dev`; otherwise the existing `isRepeatOrComposing`
  predicate, and the PR body says it moves to the shared export once keyboard-guards lands. One
  unit test either way. It changes nothing a person sees. Resolved at delivery: keyboard-guards
  reached `dev` first and was merged into the branch before the final gate, so OK uses
  `refuseRepeatEnter`, and keyboard-guards' FU-2 left `follow-ups.md`.
- **The panel's delegated decisions** (2026-09-30): O1 (a), O2 (b) worded "No account shared",
  the blanket rows signed, one copy fix; Codex's waiting-state copy and its claim about the
  captures' size declined. Votes, dissent and reasons are in P8; the owner confirmed them on
  2026-09-30.

### Follow-ups

- **F-1 · A "doesn't match" action on the emoji check.** Today the check is advisory (§ Security):
  a person whose grids differ cannot refuse from the wallet, and closing keeps the channel. A
  control that terminates the session and forgets its `DappSession` row is a security and UI
  change for both the one window and the reconnect's window; owner decision, own plan. Its copy
  overstates today's check: "to confirm a secure connection" and "Always trust" (with "Skip
  verification on reconnect") read as more than OK recording the toggle and closing, and the
  toggle skipping the check on reconnect (`verify/index.vue:194`, `:203-204`). The panel
  recommends moving F-1 up: closing the check keeps the session even when the grids differ.
- **F-2 · The connect window's header names the active network, not the dApp's.** `DappStatusStrip`
  shows `appStore.network?.name` (`discover/index.vue:144-148`), so a dApp connecting on another
  chain than the one Home shows gets the check's network name at S2 and the active one at S0. The
  permission window already names the dApp's chain in its body (`capabilities/index.vue:86`, `:387`).
  Under O2 (b) the check's header has no mark either when the session's network is not the
  active one.
- **F-3 · Wallet-enforced confirmation before dispatch.** Today dispatch proceeds once
  establishment returns (`session-established.ts:150-157`, `background.ts:475`) and the dApp
  confirms on its side (`apps/playground/src/lib/wallet.ts:93-94`). Gating dispatch on the
  wallet's OK would add a click, not a comparison, and make every wallet-sdk dApp wait on the
  wallet; it changes the protocol's model, so it is recorded, not planned. Pairs with F-1.
- **F-4 · The waiting window still says the dApp "wants to connect to your wallet" after Allow**
  (`discover/index.vue:149`). The panel declined Codex's "Connecting to your wallet…" and
  "CONNECTING…" for this PR, since the wait is usually under a second. A copy change.
- **F-5 · The step bar's empty half barely shows in dark theme:** `--nulo-border` (#231f1c) on
  `--app-bg` (#0a0908) is 1.22:1, and 1.36:1 in light (`ConnectStepBar.vue`,
  `packages/design/src/base.css`).
- **F-6 · A failed wait closes with no message.** A queued Allow's window closes at the
  discovery's deadline, about 55 s after Connect, and a standby one when its slot expires 10 s
  after that deadline (`verify-admission.ts:306`, `:329`, `:341-344`); neither says why, and only
  the dApp shows an error.
- **F-7 · The swap to the check is likely not announced to screen readers.** The content changes
  in place with no live region, the check moves no focus (on purpose; `verify/index.test.ts` pins
  it), and the window's title stays the same (`src/popup/index.html:10`). Not tried with a screen
  reader.

F-1 to F-3 moved at delivery, and F-4 to F-7 after the panel, to
`implementations-plan/follow-ups.md` § Connecting a dApp.

## Approval

The final fresh codex pass: conditional approve, its seven conditions applied (Z1 to Z7).
The owner approved scope and tier with their answers on 2026-09-30: "I just want this to be
merged in general." **Delivery
boundary**: the PR opens and CI runs while the owner's answers are pending; it merges only once
the owner's own answers to O1, O2 and the blanket sign-off are quoted in P8. The panel's
delegated decisions there do not count as those answers.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/connect-window/lessons/phase-N.md`. Unit and component commands
run from the workspace named (`apps/extension` unless stated). Every phase writes its failing test
first and records the red run on `85c4d20f` before the fix; a test labelled a pin is green before
and after.

### P0 · Plan in the tree ✓

1. First commit: `implementations-plan/connect-window/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`.

Validation gate:
- Commands: `bun run lint`, `bun scripts/ci-cd/plans/check.ts`.
- Pass criteria: both exit 0.
- Layers: lint, CI-gating.

### P1 · The window port can navigate ✓

Assumptions: Facts 7, 29; Inference 1 (proven in P6).

1. `WindowPort.navigate` with its TSDoc; `ChromeWindowsAdapter.navigate` (query by window id, update
   the first tab, reject when there is none); `FakeWindowsAdapter.navigate` (records the call,
   rejects for an id it does not hold); the inert `fakeSdkPorts` gains it.
2. Tests: the adapter against a stubbed `chrome` (the tab found is updated with the URL; no tab
   rejects, and the rejection carries no URL of the adapter's making); the fake (records, rejects a
   gone id).

Validation gate:
- Commands: `bun --bun vitest run src/core/adapters/chrome-browser-api.test.ts` from
  `apps/extension`; `bun --bun vitest run src/testing/fake-browser-api.test.ts` from
  `packages/wallet-core`; `bun run typecheck:all`; `bun run lint`.
- Pass criteria: all exit 0.
- Layers: typecheck, lint, unit.

### P2 · A reservation can hold a waiting window ✓

Assumptions: Facts 8 to 11, 13, 23, 30.

1. Red, in `verify-admission.test.ts`: attach then removal releases; a removal buffered before
   attach makes `attach` return false and releases; `cancel`, `releaseIfUnstarted` and expiry on a
   standby slot call `closeWindow` once and hold the slot until the removal; `claimStandby` returns
   the id once; `markInFlight` refuses a standby slot; `windowsHeld` counts a standby slot;
   `abandoned` is false in `unstarted` and `standby`, true in `closing` and `released`;
   `released(id)` fires once per release, from every state.
2. Red, in `pending-verification.test.ts`: `cancelPendingVerification` marks an existing entry and
   creates none for an absent id; `isPendingVerificationDead` is true for a cancelled entry and a
   stale one, false for a fresh one; `deletePendingVerificationForTab` deletes the tab's
   tombstones too.
3. Build § A4 and the `pending-verification.ts` helpers. The one gate-constructor helper in each
   test file (`verify-admission.test.ts:27`, `session-established.test.ts:38`) gains the hooks; no
   other existing test changes.

Validation gate:
- Commands: `bun --bun vitest run src/wallet/services/wallet-sdk/verify-admission.test.ts
  src/wallet/services/wallet-sdk/pending-verification.test.ts
  src/wallet/services/wallet-sdk/session-established.test.ts`; `bun run typecheck:all`;
  `bun run lint`.
- Pass criteria: all exit 0; the existing tests green with only the two constructor helpers edited.
- Layers: typecheck, lint, unit.

### P3 · Allow hands the window to the connection ✓

Assumptions: Facts 1, 2, 12, 19, 24, 25, 27, 30, 31, 34; Inferences 3, 6.

1. Red, in `window-manager.test.ts`: `handOver` resolves with `value(windowId)`, never calls
   `remove`, and a later `onRemoved` or timeout settles nothing. Pin: a handle settled before its
   `create` resolved closes the arriving window.
2. Red, in `dapp-interaction/service.test.ts`: an approved discovery resolves `discover()` with the
   handle's `windowId` and removes no window; a page-supplied `windowId` in the result is ignored;
   a capability interaction answered `{ approved: true }` settles and closes as today. Pins, green
   before and after: a denial still settles and closes; an execute `resolveInteraction` is
   unchanged.
3. Red, in `discovery-approval.test.ts`: `attemptOpen()` false takes the rollback (row deleted,
   discovery rejected, no marker, `approveDiscovery` never called) with its own log reason; true
   approves as today. Pin: the expiry rollback unchanged.
4. `test-services.ts`: `addDappSession` keys its row by the metadata's `url`.
5. Red, in the new `background.connect-window.test.ts` (the `background.admission.test.ts`
   harness with the popup fake answering `{ approved: true, windowId }`, except that
   `./tab-lifecycle` is NOT mocked: `chrome.tabs.onRemoved` / `onUpdated` are stubbed to capture
   their listeners, as `tab-lifecycle.test.ts:27` does, and the tests fire the captured
   `onRemoved` listener): an approved connection attaches window 41 to a standby reservation and
   creates nothing; each pre-approval exit of § A3's table closes 41 and rejects the discovery
   (closed while queued, the Allow past the cutoff, a changed profile, an approval that did not
   land); with `setCapabilityGrants` held on a deferred promise, removing window 41 and then
   resolving the write rejects the discovery, deletes the row and leaves no marker; with the
   origin's two verification slots held, a third Allow keeps its window in S1 (nothing closed,
   `queued` = 1), attaches when a slot frees, and closes with a rejection when the queue expires;
   the dApp's tab removed while that third Allow is queued closes its window at once; the tab
   removed after the approval closes 41 and deletes the marker.
6. Build § A3 steps 1 to 3 and step 6 (the gate's hooks wired: `closeWindow`, and `released`
   tombstoning the marker; `state.handedOver`; `attemptOpen`; the tab teardown).

Validation gate:
- Commands: `bun --bun vitest run src/wallet/services/window-manager/window-manager.test.ts
  src/wallet/services/dapp-interaction/service.test.ts
  src/wallet/services/wallet-sdk/discovery-approval.test.ts
  src/wallet/services/wallet-sdk/background.connect-window.test.ts
  src/wallet/services/wallet-sdk/background.admission.test.ts`; `bun run typecheck:all`;
  `bun run lint`.
- Pass criteria: all exit 0; the new tests red on `85c4d20f`, recorded; the pins green on both.
- Layers: typecheck, lint, unit.

### P4 · Establishment shows the check in that window ✓

Assumptions: Facts 3 to 5, 9, 10, 12, 23, 30.

1. Red, in `session-established.test.ts`: **(B-06 PIN)** a standby reservation is navigated to a
   URL carrying this session's hash, then focused, and nothing is created; a failed navigation,
   rejecting with an error that carries the URL, terminates, returns false, leaves no fresh marker
   for the id (deleted, or tombstoned if the removal landed first),
   closes the window, frees the slot on its removal, and no logger call holds the hash or the row
   id; the window closed during the wait terminates the session (no claimable window); the
   session ended during the navigation closes the adopted window and returns false; a cancelled
   marker terminates even on a trusted row, and `finally` keeps it, while a consumed fresh marker
   is deleted as today. Pins: a marker-less reconnect still creates its own window; a stale marker
   still terminates; every existing B-06, B-13, placement and profile-binding test unchanged and
   green.
2. Red, in `background.connect-window.test.ts`: the approved connection establishes with one
   `navigate` to window 41 and no `create`; two origins connecting at once, established in reverse
   order, navigate 41 and 42 with their own hashes; the twin of a pending popup opens its own
   window with its own hash while 41 shows the first's; the window closed after the approval
   terminates on establishment and keeps the row; while the failed navigation's rejection is
   held, a `sendTx` wallet message for that session arrives through `onWalletMessage`, and after
   it settles the dispatcher was never called and no queued journal record exists; abandonment
   without establishment (the slot's expiry, and separately a lock closing the window) tombstones
   the marker, then a sibling connection of the origin sets "Always trust" on the row, and a late
   establishment of the abandoned id terminates with no window, as does a second retry of that
   id; a new discovery from the origin is admitted as a reconnect with its own window, and once
   the row is trusted a new discovery establishes with no window (the trusted skip unchanged).
3. Build § A3 steps 4 and 5: `verifyWindowUrl` (used by both paths), `showVerifyWindow` and
   `showVerifyInConnectWindow` beside `openVerifyWindow`; step 6's establishment side
   (`isPendingVerificationDead` at `session-established.ts:96`, the tombstone-keeping `finally`);
   the TSDoc trim (§ A5). Step 6's wiring landed in P3; its abandonment tests live here because
   they end in an establishment.

Validation gate:
- Commands: `bun --bun vitest run src/wallet/services/wallet-sdk/`; `bun run typecheck:all`;
  `bun run lint`.
- Pass criteria: all exit 0; the new tests red on `85c4d20f`, recorded; the pins green on both.
- Layers: typecheck, lint, unit.

### P5 · The connect page waits; the check's header names who and where ✓

Assumptions: Facts 14 to 17, 22, 28, 32; Inference 4.

1. First, both files' `Button` stubs bind `:disabled="disabled"` as the real `Button` does
   (Fact 32), keeping `data-loading`, so an Allow that only spins reads as enabled; any existing
   case that leaned on the old stub is named in the lessons file. Red, in `discover/index.test.ts`
   and `index.lifecycle.test.ts`: after a resolved Allow, no `windows.remove`, the `beforeunload`
   listener is removed, Allow stays loading and carries the `disabled` attribute, Deny disabled,
   `stripStatus` is `loading`; a second `approve()` (a repeated Enter) calls `resolveInteraction`
   no second time and sets no error; a profile change while connecting closes the window. Pins,
   green before and after: a raced `JobCancelledError` still shows the cancelled overlay
   (`index.test.ts:363`), and a failed Allow re-enables it. The frozen-oracle cases that pin
   `closeWindow(true)` after Allow are updated in the same commit, each edit named in the lessons
   file.
2. Red, in `verify/header-labels.test.ts`: chain 0 names "Local Network"; testnet's id names
   "Testnet"; an unconfigured chain names `Aztec:<id>`; no shared account gives the active
   account (O2 a), in orange when the active network is not the session's; one, two and
   unresolved shared accounts; `warn` for an account on another chain. Fixtures are wire-shaped:
   CAIP accounts `aztec:0:0x` + 64 hex below the BN254 modulus (`0x` + `0a` × 32), a 64-hex
   verification hash.
3. `verify/index.test.ts` (new): mounted with those fixtures and a hostile dApp name (bidi and
   zero-width characters, 64 characters), the header shows the wallet-local labels and neither
   the name nor any part of it; the grid shows the URL's hash and not the row's; nothing is
   focused after mount, and no `keydown` listener is added to `document` or `window`; a repeat or
   composing Enter on OK is cancelled and a plain one is not (Decision ledger, driver 2026-09-29).
4. Build § A5 and § A6, and `ConnectStepBar.vue` with one test: step 1 fills one segment, step 2
   both, and the bar is `aria-hidden`.
5. `bun run build`, so any regenerated file under `src/types/` is committed with the change.

Validation gate:
- Commands: `bun --bun vitest run src/popup/windows/discover src/popup/windows/verify
  src/popup/windows/ConnectStepBar.test.ts src/composables/useDappApprovalWindow.test.ts`;
  `bun run typecheck:all`; `bun run lint`; `bun run build`.
- Pass criteria: all exit 0; the new tests red on `85c4d20f`, recorded; no diff in
  `src/types/` after the build.
- Layers: typecheck, lint, component, unit, build.

### P6 · One window, proven in both browsers ✓

Assumptions: Facts 20, 21, 26, 29; Inferences 1, 2.

1. Playground: record `pending.verificationHash` on a hidden element
   (`data-testid="pg-verification-hash"`) before `confirm()`.
2. `approveConnect(ctx, discoverPage)` in `fixtures/popups.ts`, engine-agnostic: read the page's
   own window id and the popup-window count (`chrome.windows.getCurrent` / `getAll({ windowTypes:
   ["popup"] })`, evaluated in the discover page), click Allow, wait in the same page for
   `#/windows/verify` and `verify-emoji-grid`, assert the same window id and the same count,
   return the page (it then goes to `approveVerify` as today).
3. The eight new-connection waits and `connectPlayground` move to it (Ask C4, Fact 20); the
   reconnect waits stay on `waitForPopup(…, "verify")`. `window-placement.test.ts:220`: the check
   keeps the connect window's id and top-right bounds instead of opening a verify window.
4. `network/connect-one-window.test.ts` (new), with an extension control page (as
   `window-placement.test.ts:49` opens one) that records `chrome.windows.onCreated` from before
   Connect: Connect; in the discover page install a capture-phase `keydown` recorder that appends
   each event's `repeat` to `sessionStorage` (which survives the navigation, in-document or
   reload); focus Allow and hold Enter (repeated `keyboard.down`, which both engines deliver with
   `repeat: true`, `implementations-plan/lessons.md` § E2E) until the check shows, then release;
   read the recorder in the check and fail unless it holds at least one `repeat === true`; the window's page shows the check, is the focused window, and shows no error;
   the page's grid text equals `hashToEmoji` of the playground's recorded hash; Enter and Escape
   pressed in the check leave it open and the "Always trust" toggle off; OK closes it; the
   recorder saw exactly one popup window, the connect window; `requestCapabilities` then opens the
   permission window as the one further window. Red on `85c4d20f` (a second window opens),
   recorded.
5. Record in `lessons/phase-6.md`, per browser, whether the navigation stayed in the document or
   reloaded (Inference 2): a `window` marker set before Allow and read in the check.

Validation gate:
- Commands: `bun run build`, then network e2e, retry 0:
  `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/connect-one-window.test.ts tests/e2e/network/connect-dapp.test.ts tests/e2e/network/connect-deny.test.ts tests/e2e/network/window-placement.test.ts tests/e2e/network/session-reconnect.test.ts tests/e2e/network/session-reconnect-flood.test.ts`,
  then the same files with `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1`; `bun run e2e:reap`.
- Pass criteria: every file passes on both browsers; the skipped tests are exactly the declared
  inventory (on Chrome, `window-placement`'s `FIREFOX_ONLY.windowRefocus` case; on Firefox, any
  `CHROME_ONLY` file) and any other skip fails the gate; each run's executed, passed and skipped
  counts in `lessons/phase-6.md`.
- Layers: e2e-live-network.

### P7 · The arc gate ✓

1. Every local gate: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`.
2. Smoke e2e on Chrome and Firefox: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`,
   then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.
3. The whole network suite, since `connectPlayground` changed: `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent`
   (prover on; the `@requires-proverless` files again with `NULO_E2E_PROVERLESS=1`), then
   `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent`.
4. Flake bar: `connect-one-window.test.ts`, `window-placement.test.ts` and `connect-dapp.test.ts`,
   three consecutive retry-0 runs per browser.
5. `bun run e2e:reap`.

Validation gate:
- Commands: steps 1 to 5.
- Pass criteria: all exit 0; the full suites' counts in `lessons/phase-7.md`; a skip outside the
  declared `CHROME_ONLY` / `FIREFOX_ONLY` / proverless inventory is a failure; a failure outside
  this plan's files is re-run once and logged as a flake or fixed.
- Layers: typecheck, lint, unit, component, CI-gating, build, e2e, e2e-live-network.

### P8 · The owner's sign-off

1. One page for the owner with O1, O2 and the blanket sign-off, every option and every blanket
   row pictured (built screenshots unless stated; the builder renders the non-recommended option
   on a capture-only branch that never merges):

| Ask | Option | State | Browser | Theme | Source |
|---|---|---|---|---|---|
| O1 | (a) bar, (b) no bar | S0 Connect | Chrome, Firefox | light | built screenshot |
| O1 | (a), (b) | S1 Waiting | Chrome | light | built screenshot. Recipe: connect the playground once (untrusted); open two more playground tabs and Connect in each, leaving both reconnect checks open (the origin's two slots held); forget the app in Settings → Connected apps (`src/popup/pages/settings/connected-apps/[id].vue`), which leaves the mounted checks and their slots in place (Fact 33); Connect in a fourth tab, which is a new connection, and Allow. Before capturing, assert the window is on `#/windows/discover`, Allow is loading and disabled, and it is still so 2 s later |
| O1 | (a), (b) | S2 Emoji check | Chrome, Firefox | light; Chrome dark | built screenshot |
| O1 | both | the windows on screen: today (two) → after (one) → after OK (none) | Chrome | light | built screenshots at the browser window's size, beside the "A + B" drawing (`design/mocks/build.py` output) |
| O2 | (a), (b) | new connection, no account shared, session on the active network | Chrome | light, dark | built screenshot |
| O2 | (a), (b) | new connection, no account shared, session on testnet while Local Network is active | Chrome | light | built screenshot from a capture-only branch that feeds the verify page a testnet session (the local rig runs one network) |
| O2 | (a), (b) | reconnect, one shared account, Local Network | Chrome, Firefox | light | built screenshot |
| O2 | (a), (b) | reconnect, two shared accounts | Chrome | light | built screenshot |
| O2 | today | new connection and reconnect | Chrome | light | built screenshot at `85c4d20f` |
| Blanket | row 4: a connect that fails after Allow | S1 (the O1 S1 recipe), then the screen once the queued Allow expired and the window closed; and the dApp's tab closed during S1, with the window gone at once | Chrome | light | built screenshots |
| Blanket | row 5: the waiting window closed after the approval | the next Connect's reconnect check | Chrome | light | built screenshot |
| Blanket | R1: the check stays a comparison aid | S2 as built (the O1 S2 capture), with one line: the dApp confirms on its own side, OK only records "Always trust" | Chrome | light | built screenshot |
| Blanket | R2: a dApp stalled with its tab open, or whose tab navigated away | S1 (same capture as O1 S1), with the 65 s bound in one line | Chrome | light | built screenshot |

2. Record the answers here, quoted. An option other than the recommended one is a new step in this
   phase: build it, rerun P5's gate and P6's specs on both browsers.

Validation gate:
- Commands: `bun scripts/ci-cd/plans/check.ts`.
- Pass criteria: exit 0; the owner's answers quoted below. The PR may open before this gate; it
  does not merge until they are.
- Layers: CI-gating.

**Delegated decisions, 2026-09-30. Not the owner's sign-off.** The owner, away, on 2026-09-29:
"any chance your resolve auditing with Codex and Opus5.5 subagents the open artifacts? Ask those
subagents to be evaluators on the ux/ui/copies. Use your knowledge about my previous decisions
too." The driver's panel, two Opus 5.5 evaluators (an interaction lens and a craft lens) and Codex
(session `01a0efb9-ecf8-7311-8051-7d50a082b025`), decided on the decision page
(https://claude.ai/artifact/BhKeRRWz5rPWz72jkdHucR). The owner can overturn any of it, and the
branch does not merge on it.

- **O1: (a), the two-step bar, as built.** Unanimous.
- **O2: (b), two to one, worded "No account shared".** For: Codex and the craft evaluator. Against:
  the interaction evaluator, who preferred (a) for a header that stays the same from Connect to
  the check. "No account shared" replaces "Not shared yet": it names what is missing, and "yet"
  implies the app will ask. Before any account is shared the check's header reads "NO ACCOUNT
  SHARED" and the session's network ("NO ACCOUNT SHARED · Local Network") in the label's usual
  style, with no orange mark, as (b) was pictured; once accounts are shared, the network's name
  replaces "chain N" and "MIXED", as built. The connect screen's own header is unchanged.
- **Blanket (rows 4 and 5, R1, R2): signed, two to one.** Codex would block until the check's
  sentence and "Always trust" are reworded. They are today's strings, outside this PR, so they
  are follow-ups (F-1).
- **One fix rides with this PR:** the connect screen's revoke line sent people to "Settings →
  General → Sessions", a screen that does not exist; it now names "Settings → Connected Apps"
  (`settings/index.vue:142`), UI impact row 6.
- **Declined:** Codex's waiting-state copy ("Connecting to your wallet…", "CONNECTING…"), because
  the wait is usually under a second (F-4); and Codex's claim that the captures are the wrong
  size, because the dApp windows open 400 wide (`src/wallet/services/dapp-interaction/service.ts:468`).

Built per step 2 (O2 (b) and the revoke line), then P5's gate and P6's specs rerun on both
browsers: `lessons/phase-8.md`.

**The owner's sign-off, 2026-09-30.** On the decision page
(https://claude.ai/artifact/BhKeRRWz5rPWz72jkdHucR) the owner answered O1 (a), O2 (b) and the
blanket "signed", then wrote: "Okei, ive answered everything on the artifacts." Each surface in
§ UI impact now carries the owner's own answer.

Captures: every row above, taken on 2026-09-29 from this branch and, for the options not built
and for today's windows, from five local capture-only branches that were never pushed. They go on
the owner's page. After the panel, the surfaces it changed were taken again on 2026-09-30 from this
branch and, for the testnet session, from one more local capture-only branch.

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P7 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't? Can the window
   show another session's grid, can a new connection establish with no check window, can a window
   or a marker outlive its attempt, can a page steer the worker at a window it does not own?"),
   and these two rules, verbatim in the first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/post-impl.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc, one branch `feat/connect-window`, one PR off `dev`, plain `gh pr create` after the
  loop converges; then `gh pr checks --watch`.
- Title: `feat(connect): one connect window shows the emoji check after allow` (≤ 93 characters).
- Commits: conventional, lower-case, signed; at least one per phase, fixes separate.
- PR body: summary; the UI impact table; O1, O2 and the blanket sign-off as **pending** (or the
  owner's answers, quoted); the P8 captures; the red-before-green evidence per phase; the
  navigation behaviour per browser (P6 step 5); e2e counts.
- **Overlaps.** `keyboard-guards` (wave 2 stage B) guards the dApp windows' confirm buttons
  through `DappApprovalFooter`, `discover-allow-btn` included, and leaves `verify-confirm-btn` to
  this PR (its FU-2; Decision ledger, driver 2026-09-29). This PR adds `isLoading` to Allow's
  `disabled` and OK's repeat-Enter refusal, so whichever lands second resolves one line of
  `discover/index.vue`, by a signed merge of `origin/dev`. `dapp-grants` shares no file. #719 is in the base (`85c4d20f`); its one line of
  `tests/e2e/fixtures/extension.ts` (`:117`) sits away from `connectPlayground`.
- **Merge**: by the driver under the owner's standing authorization (2026-09-29, Phase 0), once
  every required check is green on the head, the owner's own O1, O2 and blanket answers are
  quoted in P8, and the codex loop has converged. Never `--admin`.
- Closing the plan: the `## Outcome` block, lessons promoted, F-1, F-2 and F-3 moved to
  `implementations-plan/follow-ups.md`, and the two ux-feedback entries this plan resolves deleted
  from it, in the same PR.

## Seeds

DRAFT until approval.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/connect-window/plan.md. Done when the transcript shows every phase P0 to P7 ✓ in plan.md with its validation gate reported passing, the red run on 85c4d20f recorded before each fix, LESSONS_FILE=implementations-plan/connect-window/lessons/phase-N.md printed per phase, P6's and P7's e2e counts recorded on Chrome and Firefox with no skip outside the declared CHROME_ONLY / FIREFOX_ONLY / proverless inventory, the navigation behaviour per browser recorded, a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. The PR merges only after the owner's O1, O2 and blanket answers are quoted in P8. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/connect-window/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step; write its failing test first and record the red run on 85c4d20f; after each edit run bun run lint and the phase's vitest command; commit and push the branch. One e2e:agent at a time; bun run e2e:reap after the last. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner. Phase gate green: paste it, mark ✓, print LESSONS_FILE. A skip outside the declared inventory is not a pass. All phases ✓ through P7: the Post-implementation loop, then gh pr create and gh pr checks --watch, then the P8 page for the owner. Merge only once the owner's answers are quoted in P8; never --admin; hard limits stay hard.
```

Use exactly one per session.
