# e2e-flake-fixes — two CI flakes root-caused, no timeout raised ✓

Owner ask (2026-09-05): fix the two flakes that hit PR #545 for real — "never fix them increasing
timeouts". Both were reproduced locally under `taskset -c 0,1` (the two-core envelope of a GitHub
runner), instrumented, and fixed at the mechanism. Lessons: `lessons/phase-1.md`.

## 1. `stopServiceWorker: the service-worker target was still alive 15s after close()` (smoke)

**Mechanism.** Puppeteer's `worker.close()` is `Target.attachToTarget` → `Target.closeTarget` →
`Target.detachFromTarget`. Chrome keeps a stopped service worker's DevTools host alive while ANY
session is attached and hands that same host to the worker's next start
(`ServiceWorkerDevToolsManager::WorkerStopped` parks it in `stopped_hosts_`; `WorkerStarting`
reuses it via `TakeStoppedHost`). An MV3 extension worker restarts within milliseconds of a stop —
a port disconnect or `tabs.onRemoved` is always pending — so whenever the stop lands before the
detach, the restarted worker inherits the original host: same target id, no `targetdestroyed`,
the 15 s wait expires. The sibling fingerprint (`Target.detachFromTarget: No session with given
id`) is the same race in the other order: the host was already gone when the detach arrived.

**Evidence.** `_probe-sw-stop` (scratch, not committed), 2 cores: `worker.close()` lost 3 stops in
16 (a second `closeTarget` 3 s later killed each within 15 ms — the worker was running under the
old host); an unattached `Target.closeTarget` from the browser session: 0 lost in 16.

**Fix.** `fixtures/helpers.ts` `stopServiceWorker` sends `Target.closeTarget` from a browser-level
CDP session with no worker session attached (target id from `Target.getTargets`, no private
`_targetId`) and asserts `success`. That removed the dominant race but not every one: any
transient session — Puppeteer auto-attaches to every starting worker before silently detaching —
can still park the host at the instant of the stop (1 residual in ~25 kills with the unattached
close alone). So the wait accepts a second proof next to the identity-keyed `targetdestroyed`: the
worker's `performance.timeOrigin`, read before the stop and, from 2 s after it, re-read on
whatever worker target is live — a newer value is a new instance under whatever host Chrome gave
it. Same 15 s budget; no timeout moved. The two inline mirrors (`sw-resilience.test.ts`,
`sw-restart-network.test.ts`) now import the helper — three copies of a primitive this subtle is
exactly how the next drift starts.

## 2. `wallet-locked-mid-session — Expected no popup but 1 new popup target(s) appeared: …#/popup/auth` (network)

**Mechanism.** `callExpectingNoPopup` diffed popup targets BY URL. An extension page that already
exists can change its URL while the dApp call runs: the lock's redirect
(`onActiveProfileChanged(undefined)` → `getProfiles()` RPC → `router.push("/popup/auth")`) lands
whenever that page's own RPC returns — under load, after the "before" snapshot. A page sitting on
`#/popup/register` before the call and on `#/popup/auth` after it is reported as a popup that
"appeared". No popup ever opened; the SW rejected the call with "Wallet is locked" as designed.

**Evidence.** `_probe-locked` (scratch), 2 cores: 2 false positives in 14; the captured timeline
shows `snapshot-before […#/popup/register]` → `CHANGED page …#/popup/auth` 38 ms later →
`snapshot-after` flags it as new, with the dApp result already `error`.

**Fix.** `fixtures/playground.ts` `callExpectingNoPopup` decides "new" by Target IDENTITY: the set
of targets alive before the action plus a `targetcreated` listener armed for its duration; a
candidate's URL is read at the end (a window may still be navigating when `targetcreated` fires).
A pre-existing page navigating is no longer a popup; a real popup is always caught, even when it
lands on a URL another page already has.

**The lingering page.** Every e2e browser carried the extension's first-run tab — opened by
`chrome.runtime.onInstalled` before `launchExtension` seeds `nulo:onboarding:completed` — on
`#/onboarding/welcome` or `#/popup/register`: an unowned extension realm that re-routes itself on
every lock and keeps one more client on the service worker. `launchExtension` now closes it (tab id
from `nulo:onboarding:tab-id` in session storage). The onboarding specs open their own tab via
`openOnboarding` and are unaffected (full smoke green with the change).

## Validation (all under `taskset -c 0,1`, `NULO_E2E_RETRY=0`)

- SW stop: `sw-restart-network` + `sw-resilience` + `imported-account-lifecycle` looped 8 rounds
  (~48 kills) — 8/8 green. Before the `timeOrigin` witness, the unattached close alone still lost
  1 round in 5.
- Locked session: the real `wallet-locked-mid-session` body with fresh sessions ×12 through the
  identity-keyed helper — 12/12 (`error` every time, no popup; one run even had the test's own
  just-closed popup still listed at snapshot time, which the identity diff ignores).
- Full smoke suite once on all cores: 29/30 files green; the one red is the
  `NULO_E2E_MIGRATION_FIXTURE` env contract this shell does not set (CI does).
- `bun run lint` exit 0. CI on the PR is the final gate.
