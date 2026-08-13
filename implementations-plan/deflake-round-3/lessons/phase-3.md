# Phase 3 — `Runtime.terminateExecution` does not kill the service worker

## The task

Un-skip the four SW-lifecycle tests in `apps/extension/tests/e2e/sw-resilience.test.ts`.
Their skip notes said they were "intrinsically flaky on hosted CI (Chrome internal
timing)" and should be un-skipped "when the helper waits on something deterministic" —
which deflake-round-2's causal liveness gates appeared to satisfy.

## What three solo runs showed (retry=0, same build, same machine)

Identical in all three:

| # | test | result |
|---|---|---|
| 1 | lock → kill SW → unlock → general | pass (12.6s / 12.7s / 12.6s) |
| 2 | strict mode default ON: unlock → kill SW → expect lock screen | **fail** (15s wait for `#/popup/auth`) |
| 3 | strict mode OFF: … → kill SW → silent restore | pass (4.8s / 5.3s / 5.3s) |
| 4 | liveness lands within HEARTBEAT_INTERVAL_MS of respawn | pass (10.0s / 9.8s / 9.8s) |

Deterministic, not flaky. And the ONE failing test is the only one whose assertion
requires a cold restart to have happened.

## Direct measurement of the primitive

A throwaway probe terminated the worker and observed the target, the heartbeat and the
session:

```
[probe] pre-kill target url=chrome-extension://<id>/service-worker-loader.js liveness=1786663269669
[probe] service_worker target NEVER disappeared within 10s
[probe] post-kill hash=#/popup liveness=1786663279669 (delta=10000) session=present
```

Three facts, each decisive:

1. **The target never disappears.** `Runtime.terminateExecution` aborts the currently
   running script; it does not terminate this worker.
2. **The liveness delta is exactly `HEARTBEAT_INTERVAL_MS` (10 000 ms).** The "fresh
   heartbeat" that every post-kill gate waits for is the SURVIVING worker's next
   ordinary tick — not evidence that a replacement booted.
3. **The session record survives and the wallet stays unlocked**, which is why test 2
   (strict mode must land on `/popup/auth` after a real restart) fails: there was no
   restart to lock it.

That also explains why the other three pass. Test 1 locks explicitly, so auth appears
whether or not the worker died. Test 3 expects the unlocked outcome, which is exactly
what "nothing restarted" produces. Test 4 asserts only that liveness advances within
10s — which the heartbeat does unprompted.

## Disposition: stay skipped, with the real reason recorded

The goal said to un-skip after a local retry=0 proof, and to re-skip only with a ledgered
mechanism. The proof failed, and worse than a red: **un-skipping as-is would add three
tests that cannot fail for the reason they claim to test.** Passing tests that assert
nothing are more expensive than skipped ones, because they buy false confidence.

So the four stay skipped, and their skip notes now carry the measurement instead of the
"intrinsically flaky" guess, plus the path to un-skipping: use the primitive
`migration.test.ts` already proves — close the browser and relaunch on the same
persistent `userDataDir`, which IS the crash these tests describe. That requires giving
this file a per-test profile dir rather than the shared file-scoped browser, which is a
real rewrite of all four and out of this arc's named scope.

## Correction to deflake-round-2's claim (live inaccuracy, now fixed)

Round 2 hardened two post-kill gates from truthy to strictly-newer-than-pre-kill and
described the result as proof that "the replacement worker booted". Given the above, that
framing is wrong: a strictly-newer heartbeat arrives from the surviving worker within
10s. The gates are still an improvement — a truthy check passes instantly against a stale
value, while strictly-newer at least proves the worker is live and writing now — but they
do not prove a respawn.

Comments corrected in `sw-restart-network.test.ts` and
`network/frozen-account-canary.test.ts`. **Neither test's assertion is invalidated:**
network/endpoint persistence and frozen-account re-derivation both hold across a
terminate + fresh popup. Only the restart framing was overstated.

## Lessons

1. **A test that passes tells you nothing until you know WHY it passes.** Three of these
   four were green for a reason unrelated to their subject, and no amount of re-running
   would have revealed it. The failing one was the informative one.
2. **Verify the primitive, not just the wait built on it.** Round 2 and round 3 both
   hardened waits layered on `terminateExecution` without checking whether it does what
   its name says. One 20-line probe answered it.
3. **"Deterministic failure" is a different diagnosis from "flake", and cheap to
   distinguish** — three identical solo runs. The skip note had asserted flakiness for
   months without that check.
