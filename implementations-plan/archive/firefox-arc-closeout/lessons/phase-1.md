# Phase 1 — reproduce the hang as a permanent spec (red first)

Spec: `apps/extension/tests/e2e/network/inflight-call-background-death.test.ts` (`@requires-proverless`, three
tests, no browser skip). Fixture additions it rides on: `selectPgBundle` (`fixtures/playground.ts`),
`grantCapBundle` now selects its bundle through it (`fixtures/extension.ts`), `reconnectPlayground`
(`fixtures/send.ts`) and `unlockAfterBackgroundDeath` (`fixtures/helpers.ts`); `firefox-background-restart`'s
`unlockAndReconnect` was folded onto the same two helpers so the reconnect-from-the-same-page path exists once.

## The red run (unfixed tree, proverless, `--retry=0`, alone on the host)

Chrome, exit 1, `Test Files 1 failed (1)`, `Tests 3 failed (3)`, 168.72 s:

```
× a send parked in proving is rejected within seconds of the kill, then reconnects on the same page 47740ms
× an idle dApp's call that wakes a cold background is rejected within seconds, then reconnects on the same page 43166ms
× an idle dApp's call to a background that is already up is rejected at once, then reconnects on the same page 26860ms
Error: [inflight-call-background-death] sendTx did not settle within 30000 ms (background alive now: true)
Error: [inflight-call-background-death] getChainInfo did not settle within 30000 ms (background alive now: true)
Error: [inflight-call-background-death] getChainInfo did not settle within 3000 ms (background alive now: true)
```

Firefox 153.0.4 (geckodriver, BiDi), exit 1, `Test Files 1 failed (1)`, `Tests 3 failed (3)`, 176.26 s:

```
× a send parked in proving is rejected within seconds of the kill, then reconnects on the same page 50833ms
× an idle dApp's call that wakes a cold background is rejected within seconds, then reconnects on the same page 45340ms
× an idle dApp's call to a background that is already up is rejected at once, then reconnects on the same page 29201ms
Error: [inflight-call-background-death] sendTx did not settle within 30000 ms (background alive now: true)
Error: [inflight-call-background-death] getChainInfo did not settle within 30000 ms (background alive now: true)
Error: [inflight-call-background-death] getChainInfo did not settle within 3000 ms (background alive now: true)
```

Every failure is thrown from `rejectedWithin` (spec line 85) — nothing earlier failed on either browser: test 1
reached `stage === "proving"` with the execute popup closed, every `stopBackground` landed (a refusal throws
before the clock starts), and test 3's `waitForWorkerLiveness` saw the successor's fresh liveness value before
the 3 s clock started. The three tests together are the hang the plan exists for: an established page's
call outlives the background that knew its session, on both browsers, until the dApp's own 300 s ceiling.

Firefox's stdout carries the usual Gecko noise (`FormHandlerParent.sys.mjs … navigatedBrowsingContext is null`,
`ConduitsChild.sys.mjs … PortMessage for closed conduit`, `WebDriverWorkerListenerChild … can't access dead
object`) — the same lines every Firefox spec prints; none is a finding.

## What wakes Firefox — recorded, suggestive only (D17 / D21)

**Deviation from the plan's mechanism, and why.** The plan asked the diagnostic kills to land wholly before the
price alarm's first fire (3 min after boot) and to log the margin. That is unworkable: the journal reaper's
`nulo:journal:reap` alarm fires every minute, so no 30 s window sits reliably clear of an alarm. Codex's
first-listed option was taken instead: `quietKill` runs `chrome.alarms.clearAll()` in the last extension page
before closing it and stopping the background — so during the budget there is no alarm at all, and with no
extension page open the dApp's traffic is the only waker left. Recorded in the ledger as D17's adopted form.

**Observation.** With every alarm cleared and nothing opened, the successor is alive at the end of the 30 s
budget in every test on both browsers — including test 2, the idle-cold control, where the only traffic is the
dApp's heartbeat and its one call. So on Firefox the dApp's traffic does wake the event page; the pre-decided
"nothing boots" branch did not trigger and no second run was needed. **Limitation:** the spec samples the
successor once, at the timeout, not continuously — the time at which it first appears is not recorded. The
observation therefore answers the plan's (ii) ("does one appear at all" — yes) but not its (i); it is filed as
suggestive, and criterion 2 rests on Phase 2's rejection assertion, not on this.

## Other notes

- `stopBackground` on Firefox is the driver's polite termination; the spec never touches the privileged script.
- The plan's ledger said `staleSessionVerdict(envelope, tabId, sessionKnown: boolean)`; the implementation
  takes a predicate `(sessionId) => boolean` so the lookup runs only for the two session-bound types and only
  when there is a session id. Recorded here for the Phase 2 diff reviewer.
- The spec is committed with Phase 2, byte-for-byte as it ran here, never as a red commit.
