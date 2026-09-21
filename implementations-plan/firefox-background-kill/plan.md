---
plan: firefox-background-kill
tier: light
driver: claude-code
eli5_mode: none (owner asked for a follow-up PR, not a blueprint run)
code_review: off
budget: no recon agents (the terrain is mapped in pxe-timer-throttling); foreign reviewer at high; code-review off (standing owner directive)
status: DRAFT 2026-09-21 — scoped by the pxe-timer-throttling session, handed to a fresh session; not started
---

# Kill the Firefox background alone: the privileged termination behind the seam, and the port

**Goal.** The e2e suite can end the Firefox background page *by itself* — popups, content scripts and
`storage.session` untouched, the way Firefox ends an event page on memory pressure or a crash — and the
specs that today run only on Chrome because only Chrome could kill its background run on Firefox too.
Afterwards `firefox-background-restart.test.ts` pins what its plan asked for (the PXE frame dies with the
background alone), and the Chrome-only list in `FIREFOX.md` shrinks to the CDP-Fetch file and whatever the
owner keeps Chrome-only on purpose.

**Follow-up of** [`pxe-timer-throttling`](../pxe-timer-throttling/plan.md) (merged to dev 2026-09-21, #659,
`2540271a`). That plan's Ask A3 named the privileged termination; its implementing session could not author
the helper (a safety stop, not worked around — [`lessons/phase-2.md`](../pxe-timer-throttling/lessons/phase-2.md)
§ Deviation) and shipped the restart spec on the public `runtime.reload()`. **The owner chose the follow-up:**
"let's merge the PR, babysit merging it and do it on a follow-up PR with codex iteration loop as review"
(2026-09-21). That is this plan.

**The mechanism** is the spike's: Firefox's own background-termination call, reached through the suite's
privileged geckodriver channel (`session.chromeScript`, already used by `firefox-action-popup.ts` and
`firefox-frame-script.ts`). It is recorded in
[`pxe-timer-throttling/spike/spike.patch`](../pxe-timer-throttling/spike/spike.patch) and the spike's README;
`actionPopupContext(browser)` yields the `{ session, addonId }` it needs. Confirmed on Firefox 153 in the spike.

## What exists (no recon agents — the pxe-timer-throttling session mapped this tree)

| Capability | Where it is today | Verdict |
|---|---|---|
| Kill the Chrome background | `tests/e2e/fixtures/helpers.ts` `stopServiceWorker(ext)` — unattached `Target.closeTarget`, two proofs of "gone" (`targetdestroyed` or a newer worker `performance.timeOrigin`), 15 s budget; guarded by `assertChromeOnly("backgroundKill", …)` | **adapt**: becomes the Chrome side of one `BrowserDriver` method; body unchanged |
| Privileged Firefox channel | `fixtures/browser/firefox-frame-script.ts` (`evaluateViaFrameScript`, `LOCATE_BACKGROUND_PAGE`), `firefox.ts` `evaluateInBackgroundPage`, `backgroundIdentity` (`{ timeOrigin, hosts }` — the background's `performance.timeOrigin` and its frames' `src`) | **reuse-as-is** for locating and identifying the background; the termination is a new `chromeScript` body beside them |
| "Is the background back" on Chrome | `findServiceWorkerTarget(ext)` (helpers.ts) and direct `browser.waitForTarget` (the seam's `WORKER_DEBT` / `WAIT_DEBT` sites: `helpers.ts` ×2/×1, `journal.ts` ×1, `chrome-rpc-intercept.ts` ×1, `network/cold-wake-discovery.test.ts` ×1) | **adapt**: a driver `backgroundAlive(ext)` / `waitForBackground(ext, …)` pair; Firefox answers from `extension.views` (a view with `viewType === "background"`) |
| Recovery gate after a kill | `readLivenessBaseline(page)` + `waitForWorkerLiveness(page, afterTs)` on `storage.session` `nulo:liveness` — run in an extension page, browser-neutral | **reuse-as-is** (a Firefox background-only termination keeps `storage.session`, so the strictly-newer gate works unchanged) |
| Unlock-then-recover recipe | `firefox-background-restart.test.ts` `unlockAndReconnect` + `fixtures/send.ts` `sendDefaultTx` | **reuse-as-is** |
| Reload of an extension page | `reloadExtensionPage` (classic channel; BiDi strands the page) — `RELOAD_DEBT` still lists `imported-account-lifecycle.test.ts` and both canaries | **adapt** in the ported files |
| The Chrome-only marker | `CHROME_ONLY.backgroundKill` / `.cdpFetch` (`fixtures/browser/index.ts`) on nine + one files; `FIREFOX.md` "ten files are Chrome-only"; `behavior-gating.test.ts` pins each Firefox lane to its Chrome twin's *file list* (an in-file skip lifted changes no list) | **adapt**: `backgroundKill` stays for what the owner keeps Chrome-only (Ask A1), the ported files lose their `describe.skipIf(isFirefox)` |

The nine `backgroundKill` files, what each carries beyond the kill, and the phase that ports it:

| File | Kills | Other Chrome assumptions | Phase |
|---|---|---|---|
| `sw-resilience.test.ts` (264 lines, 4 cases) | 5 | none; case 4 *times* the first heartbeat after a respawn (Ask A2) | 2 |
| `sw-restart-network.test.ts` (77) | 1 | none | 2 |
| `network/connect-locked-queue-sw-restart.test.ts` (73) | 1 | none | 2 |
| `network/cold-wake-discovery.test.ts` (92) | 1 | one `service_worker` target read (`WORKER_DEBT`) | 2 |
| `network/balance-row-reconciliation.test.ts` (95) | 1 | none | 2 |
| `imported-account-lifecycle.test.ts` (151) | 1 | one direct `page.reload()` (`RELOAD_DEBT`) | 2 |
| `network/backup-restore-sw-restart.test.ts` (478) | 2 | none found by grep; read it before porting | 2 |
| `network/frozen-account-canary.test.ts` (300) | 1 | two worker-target reads, one `page.reload()`; CLAUDE.md: "both canaries stay Chrome-only" | Ask A1 (default: not ported) |
| `network/passkey-execution-canary.test.ts` (261) | 1 | same shape as the frozen canary | Ask A1 (default: not ported) |

`import-dead-rpc.test.ts` is `cdpFetch` (the one spec that *redirects* a request); it stays Chrome-only and is out of scope.

## Scope

**In:** one seam method that ends the background on either browser and one that reports whether a background
is alive; the restart spec swapped onto it; the seven non-canary `backgroundKill` files running on Firefox;
the seam debt maps shrunk to what remains; docs. **Out:** any production code (`apps/extension/src/**` is not
touched — a Firefox background that dies alone already locks the wallet by design and recovers, as the spike
and the reload spec showed); the canaries unless Ask A1 says otherwise; the CDP-Fetch file; a fix for the
unsettled dApp call (Ask A3 — measured and recorded here, fixed elsewhere); Chrome's kill semantics (the
Chrome body moves, it does not change); anything under `apps/tools/**`, `packages/bridge-core/**` or
`.github/workflows/**`.

**UI impact:** none. Fixture and spec code only; no screen, copy, row or format changes.

## Non-obvious mechanics (read before phase 1)

- **A terminated event page does not come back until something wakes it.** Chrome restarts a closed MV3
  worker within milliseconds; Firefox restarts an event page on its next event (a popup opening a port, a
  runtime message, an alarm). So "the old background is gone" and "a new background is up" are two waits on
  Firefox, and the spec decides what wakes it (opening the popup is the natural wake, and it is also what the
  recovery recipe does first). Whether the 10 s liveness heartbeat is an alarm (which would wake it) or an
  interval (which dies with it) is a fact to establish in phase 1 and write into `FIREFOX.md`.
- **`storage.session` survives a background-only termination on both browsers; only a reload clears it.**
  The wallet still comes back locked: strict security mode drops the session on any background death
  (`sw-resilience` case 3 proves it on Chrome, where the storage also survived). `waitForLockScreen` ("record
  gone, popup on `/popup/auth`") is therefore expected to hold under the privileged kill too — verify, do not
  assume; if the record is cleared by the *new* background rather than by the death, the wait must follow the
  wake, not precede it.
- **`backgroundIdentity` throws while no background view exists** (the frame script finds no
  `viewType === "background"` view). `waitForNewBackground` in the restart spec already tolerates that by
  catching and polling; a `backgroundAlive` driver method should return `false` there, never throw.
- **A live popup outlives the kill on Firefox as on Chrome** (it is its own extension page); its port to the
  background drops and it reconnects to the new one. `sw-resilience` case 2 is the spec for that.
- **`runtime.reload()` keeps the temporary add-on's UUID; so does a termination.** `extensionId` in the
  fixtures stays valid across both.
- **The privileged channel needs geckodriver's `--allow-system-access`** — already on in `firefox.ts`'s launch.
- **A background death locks the wallet by design** on both browsers; a locked wallet queues dApp requests and
  opens no window. Every ported case that sends after a kill unlocks first — the Chrome files already do.
- **Every e2e send is asserted with `assertPgOk`** (settlement alone is not a pass); the ported files keep
  whatever they assert today.

## Phases

Each phase: implement → gate → `LESSONS_FILE=implementations-plan/firefox-background-kill/lessons/phase-N.md`
→ commit (signed, conventional, lower-case subject ≤ 100 chars) → next. Every e2e gate runs **alone on the
host, `--retry=0`, proverless** (`bun run e2e:agent <files>` from `apps/extension`, `NULO_E2E_BROWSER=firefox`
for the Firefox leg). Never edit `src/**`, fixtures or the running spec while a detached run is in its build
step. Never run two cwd-changing shell calls in parallel.

### Phase 1 — the seam method and the restart spec

- `BrowserDriver.stopBackground(ext)`: Chrome = today's `stopServiceWorker` body moved into `chrome.ts`
  (the `assertChromeOnly` line goes; behaviour and budgets identical); Firefox = the spike's privileged
  termination through `chromeScript`, resolving when the old background view is gone (`extension.views` has
  no `background` view, or `backgroundIdentity` reports a different `timeOrigin`), with a budget and a named
  error like Chrome's.
- `BrowserDriver.backgroundAlive(ext)`: Chrome = `findServiceWorkerTarget(ext) !== undefined`; Firefox = the
  background view exists. `helpers.ts` keeps `stopServiceWorker` / `findServiceWorkerTarget` as thin
  re-exports of the driver (so call sites in this phase do not move), or the call sites move — the seam
  test's `WORKER_DEBT` / `WAIT_DEBT` maps shrink accordingly in the same commit.
- `firefox-background-restart.test.ts`: lines 83–86 (`openPopup` → `runtime.reload()` → close) become the
  driver call; the header paragraph (lines 69–71) says the background alone was ended; assertions unchanged
  (new identity, zero hosts, locked, unlock → reconnect → send `ok`, one new visible host with a new
  generation). Add the one assertion the reload could not make: the dApp page's content script and an
  already-open popup survive the kill (open the popup *before* the kill, assert it shows the lock screen
  *after*, as `sw-resilience` case 2 does on Chrome).
- Unit: `scripts/e2e/browser-seam.test.ts` (the debt maps), `scripts/e2e/firefox-driver.test.ts` (the prefs
  guard must still pass — no launch pref is added).

**Gate:** `bun run lint`; `bun run --cwd apps/extension test -- scripts/e2e/browser-seam.test.ts scripts/e2e/firefox-driver.test.ts`;
`network/firefox-background-restart.test.ts` + `network/pxe-host-state.test.ts` on Firefox; `pxe-host-state`
+ `sw-resilience.test.ts` on Chrome (proves the moved Chrome body). All exit 0.

### Phase 2 — port the seven files

For each file in the table above: replace the kill with the driver call (already true if phase 1 kept the
re-export), replace worker-target reads with `backgroundAlive` / the liveness gate, replace the direct
`page.reload()` with `reloadExtensionPage`, lift `describe.skipIf(isFirefox)`, keep every assertion. Where a
case cannot hold on Firefox by mechanism (Ask A2), skip that *case* with a one-line reason naming the
mechanism — never the file. Shrink `WORKER_DEBT` / `WAIT_DEBT` / `RELOAD_DEBT` to the exact remainder.
Measure follow-up 2 of the previous plan on both browsers (a `sendTx` interrupted by the kill: does it
reject, and after how long) and record the numbers in the lessons — no fix here (Ask A3).

**Gate:** `bun run lint`; the seam test; **each ported file on Firefox and on Chrome**, proverless,
`--retry=0`, one browser at a time. A file red on Firefox is diagnosed before anything is re-run; a Chrome
regression is a stop (the Chrome body was not supposed to change).

### Phase 3 — docs, index, lessons

`apps/extension/tests/e2e/FIREFOX.md` (the "ten files" row → what remains Chrome-only and why; the host row's
"background-only termination is a recorded follow-up" clause goes; a heartbeat-wake fact if phase 1
established one); `fixtures/browser/index.ts` `CHROME_ONLY.backgroundKill` text (it no longer says "Firefox
exposes no background context"); `ARCHITECTURE.md` §6 (the spec sentence); `.claude/skills/e2e-testing/SKILL.md`
and `chrome-extension-debug/SKILL.md` where they say the kill is Chrome-only; the previous plan's follow-ups 1
and 2 marked done/measured in `pxe-timer-throttling/lessons/phase-3.md`; `implementations-plan/index.md` row;
this file's status.

**Gate:** `bun run audit:vue`, `bun run test:ci-gating`, `bun run lint:actions` — all exit 0.

## Asks

- A1. **The canaries.** CLAUDE.md rules "both canaries stay Chrome-only". Default: **not ported** here; the seam
  makes porting them a later, separate decision (a Firefox frozen-account canary under real proving would
  double the canary shard). — Owner: _pending_.
- A2. **A case that cannot hold on Firefox by mechanism** (e.g. `sw-resilience` case 4 if the event page does
  not respawn unprompted) skips that case in-file with the mechanism named, not the file. Default: **yes**.
  — Owner: _pending_.
- A3. **The unsettled dApp call** (previous plan's follow-up 2): measured on both browsers and recorded; a
  product change is its own plan. Default: **yes**. — Owner: _pending_.
- A4. **Local gate = the touched files on both browsers; the full suites run on CI** (the owner's standing
  preference; the previous plan's 63-minute local battery is not repeated). Default: **yes**. — Owner: _pending_.

Silence on an ask = the default; the fresh session does not wait on them.

## Security & Adversarial Considerations

- **Nothing here ships.** The privileged termination lives in the e2e fixtures and runs only under
  geckodriver's `--allow-system-access` on a throwaway profile; `apps/extension/src/**` is untouched, so the
  extension's attack surface, `web_accessible_resources` and the PXE host's generation check are exactly what
  #659 landed. `bun run test:ci-gating` and the build's negative bundle-grep still prove no fixture reaches a
  production bundle.
- **The kill is a crash simulation, not a new capability for a page.** A web page cannot call it; a
  same-extension page could not either (it is a parent-process call). The spec shows what the wallet does
  when the background dies without warning — the security-relevant property is that it *locks* (strict mode),
  and every ported case asserts recovery *through* the lock, never around it.
- **Fail closed in the harness.** `stopBackground` throws by name when the browser lists no background (as
  `stopServiceWorker` does today), never waits out a budget to report a slow browser; `backgroundAlive`
  returns `false` rather than throwing, so a wait on it ends at its own deadline with its own message.
- **Ownership.** The Firefox launch is still torn down through `ctx.close()` / `ownership.ts` by marker; the
  termination touches only the add-on under test, found by its `addonId`, never a process.
- **Guards that must stay green:** `firefox-driver.test.ts` (no pref matching `timeout` or `throttl`),
  `browser-seam.test.ts` (debt maps shrink only), `behavior-gating.test.ts` (no workflow file changes).

## Post-implementation — the codex iteration loop is the review

`code_review: off` (standing owner directive). After phase 3's gate:

1. **Codex fix loop** over the whole net diff (`git diff dev...HEAD`): `/codex` at `high` (GPT-6 Astra), read-only
   sandbox, **under tmux with the response file monitored** (the harness kills background codex runs), never
   concurrent with `audit:vue` / `test:all`; the prompt says "do not run the vitest e2e configs, builds or
   workflows". Ask for an adversarial review: what a background-only kill can leave behind (ports, pending
   dApp calls, the frame), Chrome behaviour drift in the moved body, seam-debt honesty, skipped cases. Adopt
   or refute each finding, commit the fixes, **resume the same session** on the fix diff; converged = a
   resumed pass reporting no new material findings (quote it in `lessons/phase-3.md`). Hard stop at 3 rounds
   — surface instead.
2. **Then** one PR into `dev` (`gh pr create`, title a Conventional Commit ≤ 93 chars, body: what the seam
   does per browser, the per-file port table, the follow-up-2 numbers, the owner's instruction quoted above,
   asks A1–A4 with their answers or defaults, `UI impact: none`), ending with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. The Firefox network lane is the gate that
   matters; watch `gh pr checks` until `quality-status`, `extension-smoke-e2e-status`,
   `extension-network-e2e-status`, `extension-smoke-e2e-firefox-status` and
   `extension-network-e2e-firefox-status` are green. A red check is diagnosed first, re-run once if a genuine
   flake, fixed if breakage — never made advisory. **Never merge** — the owner does.

## Delivery

Single arc, one branch (`worktree-firefox-background-kill`, from dev `2540271a`), one PR into `dev`.

## Handoff — why a fresh session runs this

The pxe-timer-throttling session was stopped by a safety filter when it read the spike's privileged termination
script and did not work around the stop; it wrote this plan and cannot write the helper. Start a **new** session
in this worktree (`agent-worktree resume firefox-background-kill`, or `claude` from the worktree) and seed it with:

```
/goal All three phases marked ✓ in implementations-plan/firefox-background-kill/plan.md (the per-phase headers in the file), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/firefox-background-kill/lessons/phase-N.md`; `/code-review` was NOT run; the codex fix loop converged over the whole diff, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; one PR into dev exists, created only AFTER the loop converged, its body quoting the owner's instruction recorded in plan.md (`gh pr view` output in the transcript), with quality-status, extension-smoke-e2e-status, extension-network-e2e-status and both Firefox aggregators green; `bun run audit:vue`, `bun run test:ci-gating` and `bun run lint:actions` report exit 0. Never merged; apps/extension/src/**, apps/tools/**, packages/bridge-core/** and every workflow file untouched; no launch pref added; the canaries untouched unless Ask A1 says port; every e2e send asserted with assertPgOk; the seam debt maps only shrink; no red check made advisory.
```
