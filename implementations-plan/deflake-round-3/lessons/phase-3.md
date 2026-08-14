# Phase 3 — the kill that never killed

## The task

Un-skip the four SW-lifecycle tests in `apps/extension/tests/e2e/sw-resilience.test.ts`.
Their skip notes blamed "intrinsically flaky on hosted CI (Chrome internal timing)" and
said to un-skip "when the helper waits on something deterministic", which round 2's causal
liveness gates appeared to satisfy.

## Step 1 — un-skip and run: deterministic, not flaky

Three solo runs, `--retry=0`, identical every time: tests 1, 3 and 4 passed; test 2
("strict mode default ON … expect lock screen on respawn") failed at
`waitForHash(page2, "#/popup/auth", 15_000)`. A months-old skip note asserting flakiness
was refuted by three runs.

## Step 2 — measure the primitive

`stopServiceWorker` used CDP `Runtime.terminateExecution`. A probe measured what it does:

```
[probe] service_worker target NEVER disappeared within 10s
[probe] post-kill hash=#/popup liveness delta=10000 session=present
```

The session record survives, the wallet stays unlocked, and `nulo:liveness` advances by
exactly `HEARTBEAT_INTERVAL_MS` — so the "fresh heartbeat" every post-kill gate waits for
is the surviving worker's own tick. (The target line is the WEAKEST of the three: polling
`browser.targets()` by URL every 200 ms could in principle miss a fast destroy/create.
What settled it was step 3's side-by-side comparison on target IDENTITY, plus the session
record surviving — which a genuine cold boot cannot produce under strict mode.)

That explained all four results at once: test 1 locks explicitly, test 3 expects the
unlocked outcome, test 4 only needs liveness to advance within 10s — all satisfied with
nothing restarted. Test 2 was the sole test whose assertion required a real restart, and
therefore the sole failure.

## Step 3 — the real primitive (codex review)

Chrome documents `worker().close()` for testing service-worker termination with Puppeteer;
for a service-worker target puppeteer implements it as `Target.closeTarget` + detach.
Measured side by side:

| primitive | target id | session record | liveness delta |
|---|---|---|---|
| `Runtime.terminateExecution` | unchanged | present | exactly 10 000 ms (heartbeat) |
| `worker().close()` | **changes** | **gone** | 2 404 ms (cold-boot write) |

The same review killed my proposed alternative — relaunching the browser, as
`migration.test.ts` does — because Chrome clears `storage.session` on browser restart,
which would destroy test 3's bearer-survival premise. Worth recording: my replacement was
wrong for a reason I had not considered, and the correct one was already documented.

`stopServiceWorker` now arms a `targetdestroyed` listener BEFORE closing and resolves only
when the destroyed `Target` is object-identical to the one it closed — public API, no
`_targetId` read, and immune to a fast replacement being mistaken for the original
surviving. Without that assertion the tests silently go back to passing against a worker
that never died.

## Step 4 — what the real kill exposed

**Test 2 passes for the first time.** Under strict mode the bearer-less session is
`silentClose`d on cold boot, so the popup lands on `/popup/auth` — exactly the contract
the test was written to pin, finally exercised.

**Test-order coupling, previously invisible.** Tests 3 and 4 opened with
`waitForHash(general)` and had been inheriting an unlocked wallet — because nothing had
ever locked it. With a genuine kill, test 2 correctly leaves the wallet locked and they
failed at their first wait. They now establish that precondition themselves.

**Test 4's stopwatch measured nothing.** It started after `openPopup`, which already waits
for the background to connect — i.e. for the very write being timed. It now starts once
termination has completed and before the popup is opened, so the elapsed is an upper bound
on respawn-to-liveness and can actually catch the `setInterval`-only regression it exists
for.

## Step 5 — test 3's setup never happened either

With the real kill, test 3 still failed. Its premise is "strict mode OFF", which it
establishes by posting to ConfigService over `chrome.runtime.sendMessage`. But wallet
services listen on PORTS: the SW's only `onMessage` listener (`src/wallet/index.ts`)
returns `false` and handles one unrelated message. A probe confirmed it — the call resolves
with no reply, and `nulo:config` (written by `ConfigStore.set` via `ValueStorage`) is never
created. Strict mode stays ON, so the silent restore the test asserts cannot occur.

It "passed" for years only because the old kill left the worker running, so nothing needed
restoring.

**Disposition:** all four ship un-skipped. Test 3 now drives the real Settings → Security
toggle (`strict-security-toggle`) through its confirmation dialog and ASSERTS the flag
actually flipped before depending on it — a setup step that silently no-ops is precisely
what made the test vacuous, so the assertion is the point. Its old justification for going
around the UI ("independent of layout changes") bought nothing: it made the test independent
of the behaviour it was testing.

## Still using the primitive that does not kill

`sw-restart-network.test.ts` is converted here. Two network tests are NOT, and are ledgered:
`network/frozen-account-canary.test.ts` (stage 5) and
`network/backup-restore-sw-restart.test.ts` — the latter's entire premise is a mid-restore
crash that, on the old primitive, never happens. Converting them changes what they exercise
and needs its own network evidence run, so it is a follow-up rather than a silent edit here.

## Lessons

1. **A passing test is a claim, not evidence, until you know why it passes.** Three of these
   four were green for reasons unrelated to their subject. Re-running them, at any count,
   could never have revealed that — only measuring the primitive did.
2. **Verify the tool does what its name says.** Two arcs hardened waits layered on
   `terminateExecution` without checking whether it terminates. One 20-line probe answered
   it, and a second probe answered the config toggle the same way.
3. **Fixing a no-op setup step surfaces every assumption that leaned on it.** The real kill
   immediately exposed test-order coupling and a second dead setup path. Expect a queue of
   discoveries, not one fix.
4. **"Deterministic failure" and "flake" are cheap to distinguish** — three identical solo
   runs — and the skip note had asserted the wrong one for months.
5. **Check the storage key before concluding from a storage read.** My first config probe
   read `nulo:core:config`; the real key is `nulo:config`, so its "undefined before and
   after" proved nothing. Same error class as the `ValueStorage` JSON-string assumption in
   phase 2, twice in one arc.
