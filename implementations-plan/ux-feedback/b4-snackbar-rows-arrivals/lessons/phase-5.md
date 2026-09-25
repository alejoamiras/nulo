# Phase 5 · Parity and arc gate (in progress)

P5.1's captures were taken before this round: 14 surfaces on Chrome and on Firefox, outside the
repo with their manifest. None of the fixes below changes what a capture shows. The icon's
pointer pass-through, the leaving card's controls and the senders glyph look the same at rest,
and none of the other fixes touches a captured state.

## Arc fix loop

### Round 1 · codex · changes-requested (high)

GPT-6 Astra, session `01a0d7e5-f11d-7982-968c-b68e49a09382`, on `e84d784b..7681b0af`. The
coordinator accepted all nine findings. Each fix is its own commit, and each test was written
first and shown red on the pre-fix code, except where a row says otherwise.

| # | Severity | Finding | Fix (commit) |
|---|---|---|---|
| 1 | major | A token add resumed after `readTip()` restored `trusted` and wrote a pending floor on a token, network or profile deleted meanwhile (`incoming-transfer/service.ts`) | The section rechecks `isCurrent()` and the token's registration before either write (`58d52f89`) |
| 2 | major | During a same-kind replacement, View or × on the still-interactive leaving card ran the new snack's action or closed it (`ToastManagerBase.vue`) | Each control is bound at render to its card's snack id and does nothing once that snack is not the one shown (`a6696fd3`) |
| 3 | minor | The activity icon box, positioned for its badge, painted above the stretched link, so a press on it opened nothing (`TransactionCardLayout.vue`) | `pointer-events: none` on the icon box and badge; a real-pointer press at the icon's centre in `rows.test.ts`; the icon gains the `activity-icon` testid (`5d1991b5`) |
| 4 | minor | Home, then another route, then Home again within 2.6 s replayed an already-claimed arrival (`useArrivals.ts`) | Leaving a route retires the windows judged on it (`00693528`) |
| 5 | minor | An older token lookup could install its chip over a newer one, including after a Home, elsewhere, Home round trip (`useArrivals.ts`) | A chip installs only in presentation order and only on the route visit that presented it (`ca25a48b`) |
| 6 | minor | The contact Ctrl-click case swallowed the destination wait and only logged where the tab went (`rows.test.ts`) | The swallowed wait and the log are gone. The title and assertions claim only what the row builds: a modified click on the row's deep link, left to the browser, a new tab, and the origin still on Contacts. Send is not asserted, since the cold-tab landing is held for the owner (`a14218d6`) |
| 7 | minor | A zero-value receipt got the green row, the chip and a "Received 0 …" snack (`useArrivals.ts`) | `isArrivalEligible` requires an amount above zero, and an unparsable amount counts as none, so the service's claim refuses it too. UI impact row 14, sign-off pending (`4fd72062`) |
| 8 | minor | Copying a sender swapped the focused `RowAction` for a span for 2 s, dropping keyboard focus (`senders/index.vue`) | The button stays and switches its glyph. Inline styles keep the check's look (no pointer, green through the hover and focus fill). A press while the check shows copies nothing, as the span did (`11759261`) |
| 9 | minor | `arrival-state.ts`'s header promised that a receipt sent after a floor lands above it; `snackbar.test.ts` still called the copy target an svg | Both corrected (`ac9ed02b`) |

What each failing-first test showed:

1. **The service scenario.** "A token deleted while its add reads the tip gets neither trust nor a
   floor back" found `{ state: "trusted", arrivalFloorPending: true }` on the deleted contract.
   After the fix, two existing floor tests failed. They added tokenB, which their token stub never
   listed, while the real `addToken` persists the token before it emits. They now register it.
2. **`ToastManagerBase.test.ts`**, with 0.15 s transitions and stepped rAF. View on the leaving
   card A recorded `["B"]`, B's action. × on it left `toast` empty, because it closed B.
3. **`rows.test.ts` on Chrome**, retry 0, on a build without the CSS. `elementFromPoint` at the
   icon's centre was `activity-icon`, not the row (`tx-card`).
4. **Two `useArrivals` cases.** The returning row carried `data-arriving="true"` again: Home →
   Settings → Home, and History → Home → History.
5. **Two `useArrivals` cases.** The older presentation's chip (`note:p|n|7`) replaced the newer one
   (`…|8`), and a lookup held across the round trip installed its chip on the return.
6. **Test-only, so there is no product code to go red.**
   - A probe on the pre-edit spec logged what the new tab reports. On Chrome it was the deep link,
     then `#/popup/auth`, then `#/popup/general` (the held cold-boot bounce). On Firefox it was only
     `about:blank`.
   - The new tab's URL can therefore be witnessed on Chrome only, and on Firefox only through a
     new `BrowserDriver` capability. That was not added: it is scope. The spec's comment says why
     the click remains the witness.
7. **`isArrivalEligible`** returned true for `"0"`. The `useArrivals` case opened one snack for
   the zero receipt.
8. **The new `senders/index.test.ts`**, on the pre-fix page: the copy button was gone after the
   press (`expect(copy().element).toBe(button)` on an empty wrapper).
   - The first draft failed at mount on both pages: `RowAction` and `Flex` do not resolve in a page
     test and rendered as unknown elements.
   - Rerunning on the fixed page caught that. The test registers them, and the red was re-shown on
     the pre-fix page copied in from `git show`.
9. **Comments only**; no test.

Rejected: none. Row 6 adapts the coordinator's example: the deep-link URL is asserted nowhere,
for the reason above.

Gate after the round:

| Command | Exit | Duration |
|---|---|---|
| `bun run lint` (29 warnings, 3 infos, none in changed files) | 0 | 1 s |
| `bun run typecheck:all` | 0 | 39 s |
| `bun run test:all` (extension 7,408 passed, 4 skipped, 7 todo; design 393; every workspace green) | 0 | 111 s |
| `bun run test:ci-gating` (138 pass, 2 skip) | 0 | 23 s |
| `network/incoming-arrival.test.ts`, Chrome, proverless, `NULO_E2E_RETRY=0` (7 tests) | 0 | 432 s |
| the same on Firefox (7 tests) | 0 | 394 s |
| Chrome smoke build with the gate's flags | 0 | 10 s |
| `snackbar`, `rows`, `contacts` specs on Chrome, retry 0 through a scratch config spreading `vitest.e2e.config.ts` (14 tests) | 0 | 61 s |
| Firefox smoke build with the gate's flags | 0 | 9 s |
| the same three specs on Firefox, retry 0 (14 tests) | 0 | 80 s |

Probes during the round, all with the scratch retry-0 config:
- `rows.test.ts` on Chrome: red before fix 3, green after it.
- The contact case on Chrome and Firefox, for row 6's URL question.
- `rows.test.ts` on Firefox after fix 6: green.

The smoke builds and specs ran after the network runs, since `e2e:agent` rebuilds `dist/`.

### Round 2 · codex · changes-requested (high)

The same session, on `7681b0af..8b501fd5`. The coordinator accepted all four findings and asked
each fix to cover every await between its check and its write, since round 3 is the last. Each fix
is its own commit, and each test was shown red on the pre-fix code, except row 4 (comments only).

| # | Severity | Finding | Fix (commit) |
|---|---|---|---|
| 1 | major | Round 1's recheck raced. The add read `isCurrent()` before awaiting the token's registration, and `setTrust` awaits its own read before it writes. A section the watchdog displaced while a delete ran could still restore trust (`incoming-transfer/service.ts`, `repository.ts`) | The registration read runs first. `setTrust` takes a fence and reads it after its own read, so each write reads ownership after its last await; the floor's write already did (`f46b502e`) |
| 2 | major | The lock event awaited `getProfiles()` before it closed the snack, moved the epoch and cleared `isLogined`. The header's Lock left the snack up until that handler finished (`popup/app.vue`) | In `popup/locked-state.ts`, the seal runs before the lookup and the sequence guard covers only the landing. The seal closes popups and the snack, moves the epoch, clears `isLogined` and drops activity and in-flight sends. A `flush: "sync"` watcher on `isLogined` closes the snack and moves the epoch when the header marks the popup locked. Routing and the locked screen are unchanged (`dd424d55`) |
| 3 | minor | A Deleted event while `afterRead` waited left the captured rows intact, so the assignment reinstalled the receipt (`useIncomingTransfers.ts`) | Each read collects the ids deleted while it is in flight, the service read's wait included, and drops them from its rows. A later read is unaffected (`c1b96b60`) |
| 4 | minor | The zero-amount comment and UI impact row 14 called dust an ordinary row that never arrives | "like dust" and "as dust is" are gone and the zero rule stays (`41ab7142`) |

Every await between a check and its write, and what covers it:

1. **The token add**, under the service lock:
   - the tip read and the section's trust read come before the registration read;
   - the registration's network and token reads are covered by the fence inside `setTrust` and by
     `moveArrivalFloorLocked`'s own `isCurrent()`;
   - `setTrust`'s read of the stored row is followed by its fence;
   - the floor's trust read is followed by `isCurrent()`, and `setArrivalFloor` does not await
     before it writes.
2. **The lock event** has one await, `getProfiles()`. The seal runs before it; only the profile
   list and the route wait behind it and the sequence guard. On the header's Lock, `readForLock()`
   and the confirm come before the decision, so the popup is not locked yet. The mark and the
   watcher act at the decision.
3. **The refresh** has two, the service read and `afterRead`. A delete in either is dropped from
   that read's rows.

What each failing-first test showed:

1. **`service.scenarios.test.ts`** pauses at each of five awaits, across a watchdog handoff and a
   delete of the token. The five are the section's trust read, the registration's network read, its
   token read, the trust write's own read and the floor's trust read. Before the fix, the token-read
   and trust-write pauses left `trusted` on the deleted token. The other three already passed; the
   network-read one because the token read after it sees the delete. In **`repository.test.ts`**, a
   fence that turns false while `setTrust` reads the stored row still wrote it.
2. **`locked-state.test.ts`**, run first against the module in the old order, with the lookup held
   unresolved. The snack was still open, the epoch unmoved and `isLogined` true, and the superseded
   case showed the same. In the header case, a watcher without `flush: "sync"` left the snack open
   in the tick of the mark; the old code had no hook on that path at all. The rejected-lookup and
   unlock cases passed on both.
3. **`useIncomingTransfers.test.ts`**, holding the service read, then `afterRead`: the row deleted
   meanwhile came back (`["a", "b"]`, not `["b"]`).
4. **Comments only**; no test.

Rejected: none. Left as they were: `setTrustAllow` and `setTrustReject` still write trust without
a fence. It is the pattern of row 1 on the Allow and Reject paths, and it predates this batch.

The dust question. A receipt above zero that the dust filter lets through while it fails open
renders and can play. The plan intends that: its Security section says the filter "fails open when
config, token, network or a fresh quote is unavailable (`service.ts:533-564`), which is its existing
contract: then a dust receipt renders, and it can play once (A-11)". Row 32 of the plan audit's first
round records the same. Nothing new was built.

No fix changes a P5.1 capture. The lock seal and the dropped delete act on states no capture holds,
so nothing was recaptured.

Gate after the round:

| Command | Exit | Duration |
|---|---|---|
| `bun run lint` (29 warnings, 3 infos, none in changed files) | 0 | 1 s |
| `bun run typecheck:all` | 0 | 40 s |
| `bun run test:all` (extension 7,421 passed, 4 skipped, 7 todo; design 393; every workspace green) | 0 | 111 s |
| `bun run test:ci-gating` (138 pass, 2 skip) | 0 | 24 s |
| `network/incoming-arrival.test.ts`, Chrome, proverless, `NULO_E2E_RETRY=0` (7 tests) | 0 | 440 s |
| the same on Firefox (7 tests) | 0 | 399 s |
| Chrome smoke build with the gate's flags | 0 | 22 s |
| `snackbar`, `rows`, `contacts`, `security-reset`, `wallet-lock` and `auth-flows` on Chrome, retry 0 through the scratch config (20 tests) | 0 | 106 s |
| Firefox smoke build with the gate's flags | 0 | 25 s |
| the same six specs on Firefox, retry 0 (20 tests) | 0 | 156 s |

`wallet-lock` and `auth-flows` are the smoke specs that drive the header's Lock.

### Round 3 · codex · approve (high)

The same session, on `8b501fd5..918e2669` and then the whole arc, `e84d784b..918e2669`:

> The four findings are closed; no new material findings. … VERDICT: approve — confidence: high

It raised two non-blocking comment cleanups, both applied in `7f36b4e7`:

1. **`service.scenarios.test.ts`**: the mock's comment said it reads its fence after its own read,
   but it checks the fence before a synchronous map read. The repository test covers the real async
   boundary. The comment is back to its earlier floor-field note.
2. **`popup/locked-state.ts`**: the doc listed the calls right under it. One sentence now says why
   the seal precedes any await. The repeated fallback comment in the lookup's `catch` is gone.

`setTrustAllow` and `setTrustReject` still write trust with no ownership fence. The pattern
predates this arc and is outside its diff. It is listed with the plan's Delivery follow-ups, for
`implementations-plan/follow-ups.md` at close.

Gate after the cleanups (comments only, so no e2e):

| Command | Exit | Duration |
|---|---|---|
| `bun run lint` (29 warnings, 3 infos, none in changed files) | 0 | 1 s |
| `bun run typecheck:all` | 0 | 18 s |
| `bun run test:all`, first run | 1 | 119 s |
| `bun run test:all`, rerun (extension 7,421 passed, 4 skipped, 7 todo; every workspace green) | 0 | 112 s |

The first `test:all` hit three timeouts. They were in `presto/client.test.ts` and
`wallet-sdk/content-message-relay.test.ts`, whose cases each run `vi.resetModules()` and a cold
dynamic import on a 5 s budget. The host load average was 85 to 98 on 192 cores. Neither file
imports anything this round touched, both passed alone (9 tests, 159 ms), and the tools-extraction
lessons record the same timeouts under load. That makes it the known load flake, not a regression,
so the rerun is the gate.
