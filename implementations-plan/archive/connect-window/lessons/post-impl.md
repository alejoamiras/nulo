# Post-implementation · The codex loop

`/codex high` (GPT-6 Astra) over `git diff 85c4d20f...HEAD`, one session resumed each round:
`01a0eed3-4136-7a20-95ab-43eb4be0101c`. `/code-review` is off.

## Round 1, on `ca466b59`: changes requested

1. **Major, accepted.** `session-established.ts` deleted a new connection's marker on every exit,
   so a window removal that reached the gate after a failed establishment (a rejected hash write,
   a failed navigation, a profile skew, a session ended mid-validation) found nothing to
   tombstone. The SDK restores the approved discovery on termination (Fact 30), so a retry of that
   id read as a reconnect and, on a row a sibling had since marked "Always trust", established with
   no check window: the case § A3 step 6 closes for abandoned attempts. Verified red first: the new
   test `a failed establishment leaves a tombstone, so a retry on a row since marked trusted
   terminates` returned `true` on the retry (`session-established.test.ts`, the retry's
   assertion). Fix `ace0ef23`: only a successful establishment spends the marker
   (`settlePendingVerification`); every other exit tombstones it, and tab teardown deletes it as
   before. Five pins that expected the marker gone after a failure now expect the tombstone. A
   stale marker's retry now terminates too, where the base let it re-handshake as a reconnect:
   stale markers are unreachable while a reservation lives (its expiry, 65 s after the discovery,
   tombstones first), and a new Connect is a new request id either way.
2. **Minor, accepted.** The test that a sendTx arriving during a failed navigation is never
   dispatched nor journaled could not fail: the fake service graph lacked the execution fence,
   the deletion state, accounts, networks and the queued-wait hooks, and the message carried no
   chain. Fix `af1c8210`: the fake graph can journal and dispatch, and a control test sends the
   same message while the navigation succeeds. Red first: on the old fixture the control fails,
   `dispatch` called 0 times.
3. **Comment, accepted.** The removal buffer's bound also serves a connect window whose Allow
   queues for a slot, attached up to tens of seconds later; the tab teardown's TSDoc narrated its
   loops; `showVerifyWindow`'s comment repeated its body. Fix `673b3e66`.

Gates after the fixes: `bun --bun vitest run src/wallet/services/wallet-sdk/` 22 files, 243 tests
passed; the pre-commit `biome check`, path guard and complexity baseline passed on each commit
(the first attempt of `ace0ef23` failed the complexity budget at 17 and moved the settle into
`pending-verification.ts`).

## Round 2, on `673b3e66`: approve

Resumed the same session with the three fix commits and the rules again. Verdict: "None. The three
fixes address the accepted findings. No new material bugs, regressions, or comment issues found
across the full branch diff." No new material finding, so the loop stops here.

## Round 3, on `92eb2efd`: approve

The same session, resumed on 2026-09-30 on the two changes after round 2: the signed merge of
`dev` (`53b34c18`) and OK's switch to `refuseRepeatEnter` (`9eac9f47`). Verdict: "No findings.
Confidence: high from static review." Allow keeps its loading latch, the check installs no global
Enter handler and focuses nothing, OK still refuses a repeated, composing or IME-boundary Enter,
and the merge neither drops nor doubles a guard.

## Round 4, on `2c0a2c19`: changes requested, one minor finding

The same session, resumed on 2026-09-30 on the panel's changes (`92eb2efd..2c0a2c19`) with the
rules again, told that the UI choices are the owner's, delegated.

1. **Minor, accepted.** P8 said P6's specs had run again on both browsers, citing
   `lessons/phase-8.md`, which then held only the unit, lint and type checks: the browser runs
   were still going. Fixed in the commit that records this round: the log now gives the runs,
   their commands, the revision and the counts.

No production finding: "removing the inputs leaves no broken caller, labels remain
wallet-sourced, and shared-account chain mismatches still warn. The changed assertions detect the
previous behavior. F-4 through F-7 match the source; the contrast figures check out."

## Round 5, on `1a957fdd`: approve

Resumed with the fix. Verdict: "No findings. `1a957fdd` resolves round 4: P8 now records the
browser commands, tested revision, counts and outcomes." and "No new code, test or comment issues
found since `92eb2efd`." The loop stops here.
