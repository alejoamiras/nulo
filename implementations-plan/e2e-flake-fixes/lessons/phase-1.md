# Phase 1 — reproduce, instrument, fix (2026-09-05)

## Method

Neither flake reproduced on the 30-core host (12/12 and 8/8 clean). Both reproduced under
`taskset -c 0,1` — the amplifier `mac-identity-binding/lessons/phase-2-smoke-deflake.md` already
recorded — with scratch probe specs (kept out of the tree; copies in the session scratchpad) that
logged every Puppeteer `targetcreated` / `targetchanged` / `targetdestroyed`, a browser-level CDP
session's `Target.*` events, and `Target.getTargets` samples.

## Flake 2 — `stopServiceWorker … still alive 15s after close()`

- Run 1 (`worker.close()`, 8 iterations): 1 lost stop. Run 2 (16): 3 lost. In every lost case
  `worker.close()` returned in <30 ms, the SW target kept its id with `attached=false`, and a
  second `Target.closeTarget` 3 s later destroyed it within 15 ms — so the worker was RUNNING under
  the original DevTools host, and the first stop had been consumed by an instance that then
  restarted.
- Chromium (`service_worker_devtools_manager.cc`): `WorkerStopped` moves the host to
  `stopped_hosts_` (raw pointers — the host dies with its last `scoped_refptr`, i.e. when no
  DevTools session is attached); `WorkerStarting` reuses it via `TakeStoppedHost`. Puppeteer's
  `WebWorker.close()` for a service worker is attach → `closeTarget` → `detachFromTarget`; its own
  comment says the detach exists "to allow the worker to stop". The two orderings of stop vs
  detach are the two CI fingerprints (reuse → "still alive"; host gone first → "No session with
  given id").
- Run 4 (unattached `closeTarget` from `browser.target().createCDPSession()`, 16): 0 lost — but
  that run also had `ServiceWorker.enable` on the offscreen document's session, a confound; the
  real-helper loop with the unattached close alone still lost 1 round in 5. Puppeteer's own
  TargetManager comment names the residual: "being attached to service workers will prevent them
  from ever being destroyed. Therefore, we silently detach" — its auto-attach → `Runtime.
  runIfWaitingForDebugger` → `Target.detachFromTarget` dance runs on EVERY worker start (browser-
  and page-level), so a session can be attached at the instant of any stop. Hence the second
  proof: `performance.timeOrigin` of the worker global, which only a new instance changes.
- With the witness: 8/8 rounds (~48 kills) green under 2 cores, retry 0.
- `ServiceWorker.enable` is page-scoped: it is not on the browser target session (the probe's
  first attempt failed with "'ServiceWorker.enable' wasn't found").
- The failing test's retries (`retry x2`) can never pass: attempt 1 locks the wallet, and attempts
  2–3 start with `waitForHash("#/popup/general")` against a locked popup — the two 15 s
  `TimeoutError`s in the log. Retries on state-mutating specs are a false comfort, not a fix.

## Flake 1 — `Expected no popup but 1 new popup target(s) appeared: …#/popup/auth`

- 14 iterations under 2 cores: 2 false positives. Every browser carries a third page besides
  Chrome's `about:blank` and the playground: the extension's first-run tab, opened by
  `chrome.runtime.onInstalled` (`wallet/index.ts:29` → `openOrFocusOnboardingTab`), sitting on
  `#/onboarding/welcome` or, when the flag seeding wins the race, on `#/popup/register`.
- Timeline of a failure: `snapshot-before […#/popup/register]` → the lock redirect lands on that
  page 38 ms later (`CHANGED …#/popup/auth`) → `snapshot-after` sees a URL it had not seen → "new
  popup". The dApp result was already `error` ("Wallet is locked"): the product behaved.
- `callExpectingNoPopup` keyed "new" on URL strings. Now: Target identity + a `targetcreated`
  listener for the action's duration, URLs read at the end.
- `launchExtension` now closes the first-run tab (id from `nulo:onboarding:tab-id` in session
  storage, polled ≤5 s because `openOrFocusOnboardingTab` stores it after `tabs.create`). The e2e
  suites bypass onboarding by design; the tab was an unowned extension realm in every test.

## Dead ends worth not repeating

- Reading the SW's log ring (`readSwLogTrail`) after the locked call returned `[]` — the SW has
  nothing to say because nothing went wrong on its side.
- Static reasoning about lock ordering (`SessionManager.close()` is memory-first, dispatch gates on
  `requireActiveProfile`) was correct and therefore could not explain the popup; the answer was
  in the test harness, not the product.
