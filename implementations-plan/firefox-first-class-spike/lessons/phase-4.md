# Phase 4 — Firefox driver + feasibility probes

## Prerequisites on a developer machine (checked before writing the probes)

- **Firefox**: Puppeteer's cache already holds `linux-stable_153.0.4` (and `152.0.4`). 153.0.4 is the build the spike's passkey ceremony actually ran against, which is what makes "153 is the exercised line" a fact rather than a claim.
- **geckodriver 0.37.1** is present from the spike but **not on `PATH`**, and there is no repo script that installs it. Its binary sha256 is `f831b7e61454804e8a307edd951bf8a5f373efe3f718e75454a6485a51f6e39f` — the value the CI composite action pins, alongside the tarball digest.

The driver therefore reads `GECKODRIVER` and falls back to `geckodriver` on `PATH`. A bare fallback that is not installed produces an `ENOENT` from `spawn`, which reads as a crash rather than a missing prerequisite — the driver must say which binary it wanted and how to get it.

## Shape of the hybrid

One Firefox, two channels against **one** session:

- geckodriver owns a WebDriver **classic** session, requested with `webSocketUrl: true` so it also exposes BiDi.
- Puppeteer attaches over that BiDi socket through a transport that answers `session.new` and `session.end` locally. Firefox rejects a second `session.new` with "Maximum number of active sessions", and ending the session from the BiDi side would pull the floor out from under the still-open classic channel.
- The classic channel is what carries the two things BiDi has no module for: the **WebAuthn virtual authenticator** (the passkey fixtures) and **window handles** (windows the extension opened itself).

The classic session is held in a `WeakMap` keyed by the `Browser`, reached through `classicSessionFor(browser)`, so nothing on the shared launch interface has to know the channel exists and the Chrome driver stays unaware of it.

## Ownership, and the mistake worth recording

Teardown must kill exactly what a launch started: this host runs many agents, and `pkill -f geckodriver` would take down a neighbour's run while looking to that run like its browser crashed. So a launch records its process-group leader pid plus that pid's `/proc/<pid>/stat` start time, which is what makes a **recycled pid** detectable.

The first version of `reapOrphanLaunches` was wrong in exactly the way the rule exists to prevent: it killed any recorded process that was still alive — including a sibling agent's. A record is an orphan only when the **owning test run** is gone, so records now carry the owner's pid and start time too, and a record whose owner is alive is skipped. Both properties are pinned by unit tests that spawn real detached process groups (`scripts/e2e/webdriver-ownership.test.ts`), including the case that would have killed the sibling.

Profiles are deleted only after exit is confirmed, and they live on real disk rather than `/tmp`: a profile a killed Firefox still holds open is pinned in RAM as a deleted-but-open file, which is how one failed run becomes host-wide memory pressure.

## Ports

Two are needed (geckodriver HTTP + the BiDi websocket). They come from the repo's existing `reservePort()` in `scripts/e2e/resolve-ports.ts`, now exported: it draws from a static window **below** the OS ephemeral floor, so the port cannot be handed to an outgoing connection in the gap between reservation and bind. The reservations are held until immediately before `spawn`, which is a much smaller gap than the build-length one that function was originally written to survive.

## What the probes found that the spike did not

The spike drove an extension page it found already open. The suite's fixtures *create* their pages, and every step of that was a Chrome assumption nobody had written down. Each of these cost one full probe run to find; they are in the order they appeared.

1. **No `service_worker` target.** `settleLaunchedExtension` discovered the extension id from the service-worker target. Firefox MV3 runs a background *script*, so the wait burned its whole 30 s. `installAddon` returns the manifest id, not the per-profile UUID the pages are served from; the authority for that UUID is the profile's own `extensions.webextensions.uuids` pref in `prefs.js`, which Firefox flushes within about two seconds. An open `moz-extension://` window is the fallback. → `driver.discoverExtensionId`.
2. **Remote navigation to `moz-extension://` is refused** on both channels ("Navigation to … is not allowed in this context"). Firefox now limits WebDriver navigation to web-safe schemes unless the remote agent has system access (`isWebdriverSafeNavigationURL`, in its `remote/` sources). geckodriver rejects `-remote-allow-system-access` when it arrives through capabilities; its own `--allow-system-access` flag is the only way in.
3. **A BiDi `navigate` into the extension strands the `Page`.** The tab swaps into the extension process, the navigation does land, and the promise never settles. The same navigation over the classic channel returns in ~150 ms and the same `Page` stays usable, because a classic window handle and a BiDi context id are the same string in Firefox. → `driver.gotoExtensionPage`, serialized, since a classic session has ONE current window.
4. **The popup closes itself — and this one is the app, not the driver.** On a wallet with no profile and onboarding unfinished, the popup opens the onboarding tab and calls `window.close()`. Chrome ignores that call on a tab no script opened, which is the only reason "use the popup as a scratch page" ever worked; Firefox honours it, and the page died ~400 ms after loading. This looked like "BiDi cannot script extension pages" for several experiments, and Firefox's sources even contain a filter that seems to say so (`isExtensionContext`, Bug 1755014). It was wrong: the onboarding page opened the same way was scriptable forever, and the classic handle list showed the popup tab simply gone. **When a page dies, ask the other channel whether the window still exists before theorising about the protocol.** Preload scripts do not run in extension documents, so `close()` cannot be stubbed. → `driver.openScratchPage` raises the onboarding flag from the (already mounted) first-run tab before the popup loads; the launch fixture sets that same flag a moment later anyway, so the order changes and the settled state does not.
5. **`waitForTarget` never matches a URL.** A window is born `about:blank`, `targetcreated` carries that, and there is no `targetchanged`. `targets()` does list the window with its real URL. → `driver.waitForTarget` polls `targets()` on Firefox.
6. **A window that closes itself is never reported closed.** No `close` event, `isClosed()` stays false, and the target stays in `targets()`. Every approval window ends by closing itself. → `driver.isPageGone` asks the classic handle list. The BiDi error for a command against such a window is "no such frame", which the fixtures' CDP-worded detach matchers did not recognise. → `driver.targetGone`.

## Probe T's four behaviours, as measured

| Behaviour the plan required of a Firefox finder | Result |
|---|---|
| (i) transient-window detection from creation events, not snapshots | **holds unchanged** — `targetcreated` fires, and the target object keeps the last URL it loaded after its window is gone, which is what `callExpectingNoPopup` reads |
| (ii) request identity | **holds** — the polling finder takes the same predicate, request id included |
| (iii) readiness | **holds** — `waitForPopup`'s main-frame and liveness waits run unchanged after the finder returns |
| (iv) a synchronous inventory | **holds** — `targets()` is a synchronous read of Puppeteer's own map |

So Probe T prints its documented FAIL (three Puppeteer facilities that do not work over BiDi) and the finder rebuild the plan budgeted for turned out to be one polling function.

## Debt the seam guard now pins

`scripts/e2e/browser-seam.test.ts` gained two exact, shrink-only maps: service-worker target tests (5 sites in 4 files) and direct `browser.waitForTarget` calls (the Chrome-only worker wait, and the probe that measures it on purpose). Five `page.goto(extensionUrl(…))` sites in test files, and the `about:blank` bounce in `openPopup`'s fallback path, are still unported — Phases 5 and 6 own them.

## Gate result

`bun run lint` and `bun run typecheck` exit 0. `NULO_E2E_BROWSER=firefox bun run e2e:agent:probes` on Firefox 153.0.4 with geckodriver 0.37.1:

| Probe | Result |
|---|---|
| T | documented FAIL — `waitForTarget` by URL, `targetcreated` with the URL and `targetchanged` do not work over BiDi; listing, typing, scripting, the seam finder and transient-window capture all hold, and the test passes |
| 1 | PASS — account creation, content-script discovery, `discover` and `verify` windows found and driven by `data-testid` |
| 2 | PASS — `execute` window found, its one `aztec_sendTx` op read, approved |
| 3 | PASS — under `VITE_NULO_PRESTO_REQUIRED=1` the awaiting card named Presto, the dApp got a `txHash`, and the Presto server's own log recorded 1 `/prove` request, 1 succeeded |
| R | PASS — storage survives a relaunch on the same profile; teardown leaves no geckodriver, no Firefox, no ownership record and no owned profile |

Probe 3 ran as its own invocation (the proverless and Presto-required builds are mutually exclusive in `agent.sh`), against a `presto-server` started in its own process group and refused if port 59833 was already taken — that port is fixed by the wallet build, so it cannot be claimed from the registry, only declined.

No kill criterion fired.

One thing the runs left behind that the driver could not have cleaned: a probe test that vitest times out never reaches its own `finally`, so its caller-owned profile directory stays. That is the probe's file, not the driver's — the driver deliberately never deletes a directory it was handed.
