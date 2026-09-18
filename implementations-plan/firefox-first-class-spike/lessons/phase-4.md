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
4. **The popup closes itself — and this one is the app, not the driver.** On a wallet with no profile and onboarding unfinished, the popup opens the onboarding tab and calls `window.close()`. Chrome ignores that call on a tab no script opened, which is the only reason "use the popup as a scratch page" ever worked; Firefox honours it, and the page died ~400 ms after loading. This looked like "BiDi cannot script extension pages" for several experiments, and Firefox's sources even contain a filter that seems to say so (`isExtensionContext`, Bug 1755014). It was wrong: the onboarding page opened the same way was scriptable forever, and the classic handle list showed the popup tab simply gone. **When a page dies, ask the other channel whether the window still exists before theorising about the protocol.** Preload scripts do not run in extension documents, so `close()` cannot be stubbed. → `driver.openScratchPage` settles a fresh profile through a second **onboarding** page instead: in exactly the state where the popup closes itself (flag unset, no profile) the onboarding page is the inert one. A first version raised the onboarding flag early from the first-run tab so the popup would survive; that was a race by construction — the onboarding app reads the flag in an *async* `onMounted`, after its welcome CTA is already visible, so the write could land mid-read and make that tab replace itself with a popup window. It passed every run it was given. It was found by checking an assumption the review brief had listed as unverified, not by a failure.
5. **`waitForTarget` never matches a URL.** A window is born `about:blank`, `targetcreated` carries that, and there is no `targetchanged`. `targets()` does list the window with its real URL. → `driver.waitForTarget` polls `targets()` on Firefox.
6. **A window that closes itself is never reported closed.** No `close` event, `isClosed()` stays false, and the target stays in `targets()`. Every approval window ends by closing itself. The first fix was a `driver.isPageGone` that asked the classic handle list, used by the two close-waits in `popups.ts`. The review pointed out that it fixed two consumers out of more than twenty: every `targets()` count and every stale-target selection in the network suite would still be wrong. The fault is in what Puppeteer is told, so that is where it is fixed — the driver already owns the BiDi transport, and it now watches the handle list and injects the `browsingContext.contextDestroyed` Firefox omits (a context must have been *listed* first and then missed twice, so a window BiDi announced before the classic channel listed it is never mistaken for a closed one; pinned by unit tests). `targets()`, `isClosed()` and the `close` event are truthful again, `isPageGone` left the seam, and `popups.ts` went back to Chrome's original code. The BiDi error for a command against such a window is "no such frame", which the fixtures' CDP-worded detach matchers did not recognise. → `driver.targetGone`.

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

## Review round 1 (codex, GPT-6 Astra, `high`) — request changes, all nine findings taken

No Chrome regression was found; both Highs were in teardown. What changed, and what it taught:

- **A leader's exit is not its group's exit.** geckodriver can die on SIGTERM while the Firefox it started lives on, and the first `ownsProcess` judged by the leader alone — which would have deleted a profile under a running browser, the exact deleted-but-open leak this module exists to prevent. It now answers for the group: leader alive ⇒ compare start times; leader gone ⇒ `kill(-pgid, 0)`, because the kernel does not reissue a pid that still names a live process group. An identity that cannot be read is refused rather than recorded as `""`, which matched nothing and so read as "gone".
- **A deadline in the caller cannot interrupt a fetch that is already outstanding.** Every classic request carries its own, and `close()` releases the launch in a `finally`.
- **A record is a file any process can write, and it named a directory to delete recursively.** Deletion is now bounded by what a driver could have created (parent is exactly the profile root, name starts `profile-`), and a record must be well-formed and filed under its own pid to be acted on at all.
- **Probe R overstated itself.** It compared two schema versions that could both have been `undefined`, never asserted the origin, measured the first-run tab after the fixture had already cleaned it up, and asserted that *no* ownership record existed on a host where another agent's is legitimate. Re-measured properly: the extension **origin survives** a relaunch on the same profile (so the origin-keyed PXE store does too), and a relaunch opens **0** first-run tabs.
- The seam guard had four ordinary-syntax bypasses (`browser["waitForTarget"]`, a renamed destructure, `!==`, and a false positive on the loader string in a log line). Each is now a test case.

All five probe lines were re-run on the post-review commit and hold.

## Review round 2 — the round-1 ownership fix was itself wrong

- **Numbers cannot carry identity across an unattended interval.** "The kernel does not reissue a pgid while the group lives" is true and beside the point: an orphan's record sits on disk for exactly the interval in which its group can empty and its number be handed to a stranger, whose own leader may then exit — at which point "leaderless but alive" authorised killing the stranger. Identity is now a random marker in the launch's environment (`NULO_E2E_LAUNCH`), which geckodriver and Firefox inherit and `/proc/<pid>/environ` reports. A stranger cannot carry it, a child that `setsid`s out of the group still does, and a launch whose Firefox did not inherit it fails at launch rather than leaking later. Pid plus start time survives only for the *owner*, which is compared and never signalled.
- **Containment is a filesystem fact, not a string fact.** `path.resolve` folds `link/..` away as text while the kernel follows `link` first, and a record could also name another launch's perfectly well-formed profile. A profile is deleted only if its real path sits directly in the real profile root and it holds a marker file matching the record's.
- **"Never listed" cannot mean "never closed".** A verify window can open, be approved and close between two handle reads; requiring a prior sighting left that target stale for good. Unlisted contexts are now reported after 8 consecutive misses (listed ones after 2), and the open-context snapshot is taken before the handle read so a window born during the read is not charged a miss.
- The launch record is built before the profile or the process exists, so every acquisition failure leaves through the same `releaseLaunch`.

## Review rounds 3 and 4 — converged

Round 3 left one Medium and one Low: a whole `/proc` scan sat between finding a pid and signalling it, and a profile whose marker file failed to write was unclaimable. The marker is now re-read for each pid immediately before its signal, and an unstamped profile is rolled back. The remaining read-to-signal gap can only be closed with a pidfd, which neither Node nor Bun exposes; the reviewer accepted that residual for a test harness. Round 4: "no new material findings".

## Accepted risk to confirm with the owner: `--allow-system-access`

Firefox refuses remote navigation to `moz-extension://` without it, so the suite cannot run otherwise. It grants the remote agent chrome-privileged access to the browser's parent process, and geckodriver's HTTP port and the BiDi socket are unauthenticated on `127.0.0.1` — so for the life of a test run, any local process that can reach loopback can execute privileged code as the user running the tests. "The keys are throwaway" is not the justification; the justification is that the hosts this runs on (a single-user agent box, a single-tenant CI runner) already give every local process that power. It must not be run on a shared multi-user machine.
