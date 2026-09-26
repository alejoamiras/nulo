# Phase 5 · Parity and arc gate ✓

P5.1's captures were taken before this round: 14 surfaces on Chrome and on Firefox, outside the
repo with their manifest. None of the fixes below changes what a capture shows. The icon's
pointer pass-through, the leaving card's controls and the senders glyph look the same at rest,
and none of the other fixes touches a captured state.

## Arc fix loop

### Round 1 · codex · changes-requested (high)

GPT-6 Astra, session `01a0d7e5-f11d-7982-968c-b68e49a09382`, on `3e664578..681dcd83`. The
coordinator accepted all nine findings. Each fix is its own commit, and each test was written
first and shown red on the pre-fix code, except where a row says otherwise.

| # | Severity | Finding | Fix (commit) |
|---|---|---|---|
| 1 | major | A token add resumed after `readTip()` restored `trusted` and wrote a pending floor on a token, network or profile deleted meanwhile (`incoming-transfer/service.ts`) | The section rechecks `isCurrent()` and the token's registration before either write (`a086b6a1`) |
| 2 | major | During a same-kind replacement, View or × on the still-interactive leaving card ran the new snack's action or closed it (`ToastManagerBase.vue`) | Each control is bound at render to its card's snack id and does nothing once that snack is not the one shown (`0939539a`) |
| 3 | minor | The activity icon box, positioned for its badge, painted above the stretched link, so a press on it opened nothing (`TransactionCardLayout.vue`) | `pointer-events: none` on the icon box and badge; a real-pointer press at the icon's centre in `rows.test.ts`; the icon gains the `activity-icon` testid (`e4d2f678`) |
| 4 | minor | Home, then another route, then Home again within 2.6 s replayed an already-claimed arrival (`useArrivals.ts`) | Leaving a route retires the windows judged on it (`90abe890`) |
| 5 | minor | An older token lookup could install its chip over a newer one, including after a Home, elsewhere, Home round trip (`useArrivals.ts`) | A chip installs only in presentation order and only on the route visit that presented it (`06493aa1`) |
| 6 | minor | The contact Ctrl-click case swallowed the destination wait and only logged where the tab went (`rows.test.ts`) | The swallowed wait and the log are gone. The title and assertions claim only what the row builds: a modified click on the row's deep link, left to the browser, a new tab, and the origin still on Contacts. Send is not asserted, since the cold-tab landing is held for the owner (`b4d12e9a`) |
| 7 | minor | A zero-value receipt got the green row, the chip and a "Received 0 …" snack (`useArrivals.ts`) | `isArrivalEligible` requires an amount above zero, and an unparsable amount counts as none, so the service's claim refuses it too. UI impact row 14, sign-off pending (`95b547a7`) |
| 8 | minor | Copying a sender swapped the focused `RowAction` for a span for 2 s, dropping keyboard focus (`senders/index.vue`) | The button stays and switches its glyph. Inline styles keep the check's look (no pointer, green through the hover and focus fill). A press while the check shows copies nothing, as the span did (`45a2338e`) |
| 9 | minor | `arrival-state.ts`'s header promised that a receipt sent after a floor lands above it; `snackbar.test.ts` still called the copy target an svg | Both corrected (`40965ced`) |

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

The same session, on `681dcd83..4a456a55`. The coordinator accepted all four findings and asked
each fix to cover every await between its check and its write, since round 3 is the last. Each fix
is its own commit, and each test was shown red on the pre-fix code, except row 4 (comments only).

| # | Severity | Finding | Fix (commit) |
|---|---|---|---|
| 1 | major | Round 1's recheck raced. The add read `isCurrent()` before awaiting the token's registration, and `setTrust` awaits its own read before it writes. A section the watchdog displaced while a delete ran could still restore trust (`incoming-transfer/service.ts`, `repository.ts`) | The registration read runs first. `setTrust` takes a fence and reads it after its own read, so each write reads ownership after its last await; the floor's write already did (`c9bf88f7`) |
| 2 | major | The lock event awaited `getProfiles()` before it closed the snack, moved the epoch and cleared `isLogined`. The header's Lock left the snack up until that handler finished (`popup/app.vue`) | In `popup/locked-state.ts`, the seal runs before the lookup and the sequence guard covers only the landing. The seal closes popups and the snack, moves the epoch, clears `isLogined` and drops activity and in-flight sends. A `flush: "sync"` watcher on `isLogined` closes the snack and moves the epoch when the header marks the popup locked. Routing and the locked screen are unchanged (`22b7602d`) |
| 3 | minor | A Deleted event while `afterRead` waited left the captured rows intact, so the assignment reinstalled the receipt (`useIncomingTransfers.ts`) | Each read collects the ids deleted while it is in flight, the service read's wait included, and drops them from its rows. A later read is unaffected (`906605cd`) |
| 4 | minor | The zero-amount comment and UI impact row 14 called dust an ordinary row that never arrives | "like dust" and "as dust is" are gone and the zero rule stays (`691ff701`) |

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

The same session, on `4a456a55..1ff23b27` and then the whole arc, `3e664578..1ff23b27`:

> The four findings are closed; no new material findings. … VERDICT: approve — confidence: high

It raised two non-blocking comment cleanups, both applied in `7eea0b33`:

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

## Parity

The parity Artifact is https://claude.ai/artifact/2NDQYMuPhFWyE5yMjht1LN. It places each P5.1
capture, Chrome and Firefox, beside its shot:

- the success and error snacks on History (`10-snackbar`), and the snack above the nav (`10-round1`);
- Home and History rows at rest, hovered and focused (`11-rows`);
- the arrival, with and without reduced motion (`12-arrival`), and its snack on Settings (`12-incoming`);
- the undrawn S-1, S-2 and K-1 surfaces.

The driver and the fable leg listed every difference, the pre-existing ones included. The page's
"Your calls" holds 13 questions for the owner, none decided here:

1. S-1: on a page without the nav, a snack covers the footer button.
2. A snack that opens under a resting pointer waits until the pointer moves.
3. The snack's × and View show no focus ring (the hash-pinned `base.css` sets `button { outline: none }`).
4. With fiat values off, Home shows no chip.
5. Two rows outside the plan's list: Settings → Advanced → Logs, and the Revoke authorizations
   expand icon.
6. A Ctrl-clicked contact row's new tab loses its deep link at start-up.
7. History's received rows read "Token" and "+1,000,00" with no dollar value (older than this batch).
8. The received row differs from the drawing (older).
9. Home's balance counts the dollar total (A-1′).
10. The error snack has no "Details" (S-8).
11. The execute window's snack overhangs its 360px column by 4px on each side.
12. Over a sheet that covers the nav, the snack keeps the nav's 76px inset.
13. Older layout differences around this batch's surfaces.

Beside them is the sign-off pending list: S-1 to S-16, K-1, R-1 to R-7, A-1′ and A-2 to A-16.

## The gate

Every P5 command ran at retry 0 on `b6aa6e4d`, the arc's tip before the restack; the reader check
ran on the restacked `d818b293`. The restack put arc 3's copy fix (`e1504b97`) and its record
(`3e664578`) under this arc, so `b6aa6e4d` became `e13071ea`. That fix changes two sentences no
e2e spec reads (`dapp-hostname-warning`, `import-seed-note`), their two unit tests and the
drawings. The local gates and both smoke suites ran again on the restacked tip (last table).

| P5 | What | Result | Time |
|---|---|---|---|
| 2 | `bun run lint` | exit 0 | 1 s |
| 2 | `bun run typecheck:all` | exit 0 | 38 s |
| 2 | `bun run test:all` | exit 0 | 111 s |
| 2 | `bun run test:ci-gating` | exit 0 | 23 s |
| 2 | `bun run build` | exit 0 | 25 s |
| 2 | `bun run --cwd apps/extension build-storybook` | exit 0 | 8 s |
| 3 | Network, Chrome prover on: P5.3's files without `@requires-proverless`, plus `account-balance-orphans` and `imported-account-execution` (9 files) | 21 passed; exit 0 | 885 s |
| 3 | Network, Chrome proverless: `incoming-arrival`, `account-switch-isolation` | 9 passed; exit 0 | 534 s |
| 3 | Network, Firefox proverless: the same 11 files | 30 passed; exit 0 | 1,219 s |
| 4 | `incoming-arrival`, three runs per browser in its gate mode | 7 of 7 in every run; exit 0 | 397 to 457 s a run |
| 2 | Smoke, Chrome, the gate's build | 38 files passed, 3 skipped; 152 tests passed, 7 skipped; exit 0 | 846 s |
| 4 | `snackbar`, `rows`, `contacts`, `security-reset` on Chrome, three runs through the scratch retry-0 config | 4 files, 15 tests in every run; exit 0 | 73 to 77 s a run |
| 2 | Smoke, Firefox, the gate's build | 39 files passed, 2 skipped; 148 tests passed, 11 skipped; exit 0 | 1,204 s |
| 4 | the same four on Firefox, three runs | 4 files, 15 tests in every run; exit 0 | 93 to 97 s a run |
| 5 | `bun run e2e:reap` | nothing to reap; exit 0 | |

`security-reset` is the smoke spec that calls `waitForProfilePurged`, the helper at
`helpers.ts:1895` whose comment this arc changed. Its three network callers
(`profile-reimport-matrix`, `opfs-storage`, `backup-restore-integrity`) are in the reader check.

### Every reader of the snack and the incoming card

P5.3 asks for the network list to be re-checked against every reader. A script walked the e2e tree
from each line that calls `waitForToast(` or reads `tx-incoming-card`, up through every helper
and fixture containing one, to the specs that reach them. The helpers are `importToken`,
`importTokenAndWaitForBalance`, `sendTransfer`, `fillSendForm` and `confirmImport`. The fixtures
are `tokenReadyExtension`, `feeJuiceReadyExtension`, `feeJuiceImportedExtension`,
`firstTwoAccountsFixture`, `dappConnectedExtensionWithFirstTwoAccountsCap` and
`dappConnectedExtensionWithFirstTwoAccountsContractsCap`.

- **Smoke: 7 readers** (`account-import-export`, `accounts`, `backup-imported-account`,
  `imported-account-lifecycle`, `profile-rename`, `security`, `snackbar`), all in the full smoke
  runs above.
- **Network: 37 readers.** Nine were in the gate's files: all of them except `connect-dapp` and
  `tx-sendTx-selfPay`, which P5.3 lists for the execute window's error path. The other 28 ran on
  `d818b293`, retry 0, in each browser's gate mode: `account-switch-live-session`,
  `authwit-consume-smoke`, `authwit-lifecycle`, `auto-lock-defers-while-proving`,
  `backup-migration-roundtrip`, `backup-restore-integrity`, `backup-restore-sw-restart`,
  `balance-row-reconciliation`, `execute-scope-account`, `fiat-send`, `frozen-account-canary`,
  `holdings`, `home-cap`, `in-flight-send-guard`, `multi-account-from`, `opfs-storage`,
  `pin-to-home`, `price-fixture`, `profile-reimport-matrix`, `profile-switch-sweeps-transfer`,
  `receive-unregistered`, `selfpay-phase`, `send-amount-clamp`, `send-picker`,
  `sim-from-selfpay`, `token-add-auto-trust`, `tokens`, `transfers`.

| Run | Files | Result | Time |
|---|---|---|---|
| Chrome, prover on | 25 | 31 passed; exit 0 | 1,744 s |
| Chrome, proverless: the three `@requires-proverless` files (`auto-lock-defers-while-proving`, `backup-restore-sw-restart`, `profile-switch-sweeps-transfer`) | 3 | 5 passed; exit 0 | 306 s |
| Firefox, proverless | 28 | 27 passed and 1 skipped, `backup-restore-sw-restart` (Chrome-only by design, `CHROME_ONLY.backgroundKillUnderPage`); 33 tests passed, 3 skipped; exit 0 | 1,687 s |
| `bun run e2e:reap` | | nothing to reap; exit 0 | |

The two commits made during the run (`6bfe0de7`, `62199fba`) change only docs.
`backup-restore-integrity`, the known public-network flake (program Follow-ups), passed in both
browsers.

### On the restacked tip

On `62199fba`, the stack's arc 4 tip. Its code is `e13071ea`'s; the commits after it change only
docs.

| What | Result | Time |
|---|---|---|
| `bun run lint` | exit 0 | 2 s |
| `bun run typecheck:all` | exit 0 | 43 s |
| `bun run test:all` | exit 0 | 129 s |
| `bun run test:ci-gating` | exit 0 | 26 s |
| `bun run build` | exit 0 | 31 s |
| `bun run --cwd apps/extension build-storybook` | exit 0 | 13 s |
| Smoke, Chrome, the gate's build | 38 files passed, 3 skipped; 152 tests passed, 7 skipped; exit 0 | 876 s |
| Smoke, Firefox, the gate's build | 39 files passed, 2 skipped; 148 tests passed, 11 skipped; exit 0 | 1,109 s |
| `bun run e2e:reap` | nothing to reap; exit 0 | |
