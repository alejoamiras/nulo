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
