---
plan: pxe-timer-throttling
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon inline + 4 sonnet research agents (owner-requested); foreign reviewer at high; code-review off (standing owner directive)
status: IN PROGRESS 2026-09-21 — phases 1–2 ✓, phase 3 pending
---

# The Firefox PXE host: a frame of the background page, not a throttled window

**Goal.** A Firefox user's wallet is not slowed by Firefox's background-timer throttling. Today a dApp `sendTx`
takes 25.7 s on a real Firefox against 3.0 s on the same Firefox with throttling switched off (88.3 s against
65.7 s with real in-browser proving; Chrome measured 3.8 s), and the e2e suite hides it with three launch
prefs. After this plan the throttled number matches the unthrottled one, the prefs are gone, and the suite
runs under the throttling users have. Five sends per host under real throttling, every one settling `ok`: window 18.3–27.9 s, frame
1.5–5.0 s. The numbers establish the mechanism and its size on one Linux host, not a benchmark.

**Cause (measured, [`spike/README.md`](./spike/README.md)).** Firefox has no `chrome.offscreen`, so the PXE page
lives in a minimized window. Firefox clamps a hidden window's timers to one per second, and
`@aztec/foundation`'s JSON-RPC client sends every batch through `setTimeout(sendBatch, 0)` — so every node
call costs a second. That call site is the dominant delay (the keepalive intervals are late too, harmlessly);
the prover itself is unaffected.

**Fix.** Load the same PXE page as an `<iframe>` of the Firefox background page. The background page is
`visible` and unthrottled, the frame inherits that, and native timers are native again. No timer is
replaced, upstream batching runs as written, Chrome is untouched, and the production change stays inside the
three Firefox branches of one file; the rest is tests that pin it.

**Owner decisions (2026-09-21).** Delete the masking prefs. The other hidden-window warts are out of scope
(this fix happens to remove them). A worker-timer shim was the owner's first pick, with the question of what it
would do to batching; the measured answer (it fragments batches and monkeypatches the engine host) and the
frame result led to a proving round — the owner's call — which the frame host passed, and then a confidence
round (spread, natural suspension, termination mid-proof, headed) before this plan was finalized.
`/code-review` off.

**UI impact.** Firefox only: the minimized "Nulo" window — a taskbar / dock entry the user could focus or
close — no longer exists. No popup, onboarding or approval surface changes. Needs the owner's explicit
sign-off, quoted in the PR body (Assumptions → Asks).

Read [`recon.md`](./recon.md) first: the reuse map and what the outside world does.

## Architecture & Implementation

### Shape

`apps/extension/src/wallet/utils/offscreen.ts` already dispatches on `hasOffscreenApi()`. Chrome's branch
is not touched. The Firefox branch swaps its host:

| | Today | After |
|---|---|---|
| create | `chrome.windows.create({ url: page?instance=<token>, state: "minimized", focused: false })` | `document.createElement("iframe")`, `src = page?instance=<generation>`, appended to the background document |
| tracker | `firefoxOffscreenWindowId: number \| null` | `firefoxOffscreenFrame: { element: HTMLIFrameElement; generation: string } \| null` |
| already running? | tracker non-null | `firefoxOffscreenFrame?.element.isConnected === true` — attachment only; readiness is still the READY gate and the PING/PONG check |
| close | `chrome.windows.remove(id)` | `element.remove()` |
| stale-host defence | one token per background lifetime: URL `?instance=`, `OFFSCREEN_ADOPT_INSTANCE` broadcast, self-close listener in the PXE page | one token per *frame*: READY and PONG count only when `sender.url` carries the live frame's generation. The broadcast and the self-close listener are deleted — a frame cannot outlive the document that owns it |

Everything above the branch is shared and unchanged: the single-flight `ensureOffscreenRunning`, the
PING/PONG health check, the READY gate and its 10 s timeout, and the serialized `trackedClose()` tail.

### Key interfaces

`OFFSCREEN_ADOPT_INSTANCE` and `isSupersededByAdopt` leave `offscreen.ts`; `src/offscreen/index.ts` drops the
listener that used them. `onOffscreenReady` and the health check's `onPong` gain one Firefox-only condition,
through one shared predicate: on top of today's extension-id + path authentication, a tracked frame is
connected and the sender URL's `instance` parameter equals its generation; a missing or malformed URL is a
refusal, never a throw. A READY or PONG sent by a frame that was then removed must not open its successor's
gate or pass its successor's health check (a late PONG would re-create the adopt-before-ready fault the PONG
gate exists to stop). Chrome has no generation and keeps today's check. `isSenderAtUrl` (`packages/extension-messaging/src/core/sender-auth.ts`) is
unchanged — it ignores the query string and does not discriminate on `sender.tab`. The frame's real sender
shape, captured in the spike: `{ contextId, documentId, envType, id, origin, url }` — no `tab`, no `frameId`;
the window host's carried `tab` and `frameId: 0`. URL identity authenticates both; nothing may key on
`frameId`.

### Control flow on Firefox (critical path)

1. A PXE request reaches `ensureOffscreenRunning()` in the background page.
2. No connected frame → arm the READY gate → `createOffscreenFirefox()` appends the frame, synchronously.
3. The PXE page boots inside the frame, initialises, sends `OFFSCREEN_READY`; the gate resolves.
4. Requests flow over `chrome.runtime.sendMessage` exactly as before: a frame is its own extension context,
   so messages between it and its parent are delivered (measured: the full network suite).
5. READY timeout or a failed health check → `trackedClose()` → `frame.remove()` → next pass recreates.
6. Background page terminated → the frame dies with it → the next wake starts from step 1 with a null tracker
   and nothing to rediscover or leak.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/wallet/utils/offscreen.ts` | Firefox create / close / already-running on a frame; the token becomes per-frame and READY is matched against it; delete `OFFSCREEN_ADOPT_INSTANCE`, `isSupersededByAdopt`, the window tracker and the SW-restart-leak caveats; doc comments rewritten to the live behaviour |
| `apps/extension/src/offscreen/index.ts` | delete the `?instance=` adopt listener and its import |
| `apps/extension/src/wallet/runtime.ts` | comment only, at the heartbeat: on Firefox it is also what keeps the PXE host alive (the frame dies with the background page) |
| `apps/extension/src/wallet/utils/offscreen.test.ts` | adopt-broadcast suite deleted; Firefox suite rewritten on the real jsdom `document` (the extension's vitest environment), one case per failure mode: create appends exactly one frame and no `windows.create`; a connected frame whose page never sends READY (404 / init failure) is removed at the timeout and the next ensure creates a fresh one; a frame detached behind the tracker's back is not "running"; a failed PING closes and recreates; a READY carrying a *previous* generation does not open the live gate, and a PONG carrying one does not pass the health check; a sender with no URL or a malformed one is refused without throwing; a second ensure reuses a healthy frame. Sender-auth cases use the two captured Firefox sender shapes (frame: no `tab`, no `frameId`; window: both) in both directions |
| `apps/extension/tests/e2e/network/firefox-background-restart.test.ts` (new, Firefox-only) + `terminateBackground()` on the Firefox driver | the host's one lifetime rule, pinned by assertions (not printed): the background's and the PXE's creation identities both change across the termination, zero frames right after it, then unlock → the dApp reconnects → `requestCapabilities` and one `sendTx` settle with status `ok` (`assertPgOk` — the playground helper resolves on `error` too) → exactly one host. Follows `frozen-account-canary` stage 5's recipe; termination goes through the suite's existing privileged `chromeScript` (`extension.terminateBackground()`) |
| `apps/extension/tests/e2e/fixtures/browser/firefox-rpc-intercept.ts` | comment at `:14` names "the PXE window's" channel — corrected |
| `apps/extension/tests/e2e/fixtures/browser/index.ts` (`BrowserDriver`) + `chrome.ts` + `firefox.ts` | one new driver method, `pxeHostState()` → `{ count, visibility }`: Chrome from `runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })` plus the document's own `visibilityState`; Firefox from the background page's frames. A browser difference lives on `BrowserDriver`, per `FIREFOX.md` |
| `apps/extension/tests/e2e/network/pxe-host-state.test.ts` (new) | after one dApp `sendTx` that settled `ok`: exactly one PXE host, and it reports `visible`, on both browsers. `visible` is the property that keeps timers unthrottled — the assertion that fails if a future change hides the host again, without a wall-clock threshold that would flake (a guard for this regression, not a speed guarantee). The same spec reads the BUILT manifest (`chrome.runtime.getManifest()` from an extension page) and asserts no `web_accessible_resources` pattern, wildcards included, matches the PXE page — the source-manifest unit test cannot see the entries the build plugin emits for content-script chunks |
| `apps/extension/tests/e2e/fixtures/browser/firefox.ts` | delete the three `dom.*timeout*` prefs and their comment; the remaining launch prefs move to an exported constant (`capabilities()` resolves the Firefox binary, so a test cannot call it); comments at `:326`, `:348` that name the minimized PXE window corrected |
| `apps/extension/scripts/e2e/firefox-driver.test.ts` | new assertion over that constant: no key matches `timeout` or `throttl` — the suite may not mask timer throttling again |
| `apps/extension/scripts/e2e/browser-seam.test.ts` | comment at `:353` corrected (no behaviour change) |
| `packages/extension-messaging/src/core/sender-auth.ts` | comments only: the Firefox host is a frame, no longer tab-hosted |
| `apps/extension/manifest/manifest.firefox.config.ts` | comment only |
| `ARCHITECTURE.md` (§1 diagram label, §6, builds paragraph), `apps/extension/tests/e2e/FIREFOX.md`, `.claude/skills/chrome-extension-debug/SKILL.md` | the host, its lifetime rule, and the rows the window used to explain |
| `implementations-plan/index.md`, `lessons/phase-N.md` | index row; per-phase lessons |

Not touched: Chrome's branch, the manifests' permissions, `apps/tools/**`, `packages/bridge-core/**`, any
workflow file, the harness's Firefox workarounds (`newPage` opening a window, the focus handling). Those
workarounds were caused by the minimized window and are now belt-and-braces; removing them is a separate,
riskier change with no user value.

### Non-obvious mechanics

- **Why the frame is fast.** Timer throttling keys on document visibility. A frame takes its visibility from
  its top-level document; the Firefox background page reports `visible` (measured) and so does the frame.
- **Why the pass fence goes.** B-17's fence on the Firefox path guarded the gap between an awaited
  `windows.create` and the tracker assignment. Appending a frame is synchronous: there is no gap. The shared
  close tail and the READY timeout stay.
- **What keeps it alive.** Two existing mechanisms reset Firefox's 30 s event-page idle timer (extension API
  activity resets it since Firefox 121 — Mozilla bug 1844041; the floor here is 153): the background's 10 s
  `storage.session` heartbeat, armed at the end of boot, and the PXE page's 20 s message to the background
  while a request is in flight. Measured: six minutes idle with a dApp tab and five with none and a live frame —
  same background, same PXE instance; and the control — a build without the heartbeat is suspended by Firefox
  within two minutes, frame included, so the heartbeat is load-bearing and a live frame keeps nothing alive.
  The heartbeat's comment in `runtime.ts` gains that sentence (it names only MV3 today). Evidence, not a
  guarantee: memory pressure, an extension update or a crash still ends the background.
- **The lifetime contract.** The PXE host lives at most as long as the background page (a failed health
  check or a READY timeout replaces it earlier, as today). When the background
  ends, the wallet comes back *locked* — strict security mode drops the session on any background death, on
  both browsers, by design — and the PXE cold-starts on the first request after unlock. Measured end to end
  (forced `extension.terminateBackground()`, and Firefox's own suspension with the heartbeat off): zero frames
  afterwards; unlock → dApp reconnect → `sendTx` settles `ok` in 7.4 s / 7.1 s on exactly one new frame. Terminated 5 s into the journal's `proving`
  stage: no transfer observed before recovery, the recovery send settles `ok` (67.8 s, one frame), exactly one
  transfer on chain in total, and the journal closes the interrupted operation as `failed`. The window host under the same sequences keeps its old window alive as an orphan,
  accumulates hidden windows (4 → 6), and its recovery send fails the suite's 10 s fee-estimate budget —
  throttling again. Chrome differs only in that its offscreen document survives a worker restart;
  the user-visible sequence (locked → unlock → continue) is the same. Written into `ARCHITECTURE.md` §6 and
  pinned by the Firefox background-restart spec.
- **When the background page ends.** Firefox quitting or restarting (its own updates included); the extension
  being updated, reloaded, or disabled and re-enabled; the extension process crashing or being killed by the
  OS; and the 30 s event-page idle suspension, which the heartbeat prevents while the background is up
  (measured both ways). Hours-long uptime and laptop sleep / wake are not measured. None is a new failure for
  the user: each already locks the wallet on both browsers, and the only addition is a PXE cold start after
  the unlock the user has to do anyway (7.4 s from unlock to a completed send, measured).
- **Append target.** `document.body ?? document.documentElement` — the generated background page may run its
  module before `body` exists; the spike used this form.

### Trade-offs and alternatives not taken

| Alternative | Measured / found | Why not |
|---|---|---|
| Worker-backed timer shim in the offscreen page (both browsers) | works: 25.7 → 3.0 s | replaces global timers in the engine host; RPC batches 28 → 35 per real-proving sendTx; needs a dead-worker fallback; changes Chrome's production host for no Chrome gain; leaves the window |
| `bun patch` the batch timer in `@aztec/foundation` | not run | a per-version patch on the `aztec-update` pin surface; every other timer in the page stays clamped |
| Ship Firefox as Manifest V2 (what MetaMask and Rabby do) | Mozilla has no MV2 sunset | `@crxjs/vite-plugin` refuses MV2 (`dist/index.mjs:2348`): a second build pipeline, manifest and API surface — the divergence this plan exists to avoid |
| Run the PXE in the background page's own context | not run | `runtime.sendMessage` does not loop back to its sender: a second transport |
| Keep the window as a fallback if the frame cannot be created | — | a second Firefox path no test exercises, still carrying the bug; a missing `document` throws loudly instead |
| Silent audio to exempt the window from throttling | the one source-confirmed Firefox exemption | a hack with a tab audio indicator |

## Phases

One arc. Local Firefox runs need `GECKODRIVER=<path to geckodriver>` and
`bun x puppeteer browsers install firefox`; every e2e command below is run with `--retry=0`, alone on the host.

### Phase 1 — Host the PXE page in a frame of the background page ✓ (2026-09-21, [lessons](./lessons/phase-1.md))

Steps: rewrite the three Firefox branches; make the token per-frame and match READY against it; delete the
adopt broadcast and its listener; rewrite the unit suite (failure modes listed in the change map); correct the
comments in `offscreen.ts`, `sender-auth.ts` and the Firefox manifest.

Assumptions this phase rests on: the background page always has a `document` on Firefox (Fact 8); messaging
reaches a same-page frame (Fact 3); no other module imports the deleted exports (checked in step 1 by
`bun run typecheck:all`).

**Validation gate**
- Commands: `bun run lint` · `bun run typecheck:all` · `bun run --cwd apps/extension test -- src/wallet/utils/offscreen.test.ts src/wallet/services/pxe/client.test.ts` · `bun run test:all` ·
  `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts --retry=0` ·
  `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts --retry=0`
- Pass: every command exits 0; the Firefox run is still on the masked fixture here (the prefs go in Phase 2),
  so this gate proves the host works, not yet that it is fast.
- Layers: lint/typecheck · unit · network e2e (one spec, both browsers).

### Phase 2 — Stop masking the throttling ✓ (2026-09-21, [lessons](./lessons/phase-2.md))

Steps: delete the three prefs; add the guard assertion to `firefox-driver.test.ts`; add `pxeHostState()` to
the driver and the host-state spec; add `terminateBackground()` and the Firefox background-restart spec (both
new specs sit in the shared file list and skip by browser inside the file, so the Firefox lane still runs
exactly its Chrome twin's files — `behavior-gating.test.ts`); correct the fixture and seam-guard comments.

Assumptions: nothing else in the suite depended on unthrottled background timers (Fact 5 — the proving round
ran both full suites without the prefs); `runtime.getContexts` is available to Chrome's suite build (checked
in the step; the fallback is counting offscreen targets through the existing CDP session).

**Validation gate**
- Commands: `bun run lint` · `bun run --cwd apps/extension test -- scripts/e2e/firefox-driver.test.ts scripts/e2e/browser-seam.test.ts` ·
  Firefox smoke — `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run build:firefox`
  then `NULO_E2E_BROWSER=firefox NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e -- --retry=0` ·
  Firefox network, proverless — `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 bun run e2e:agent --retry=0` ·
  Firefox, real proving — `NULO_E2E_BROWSER=firefox bun run e2e:agent tests/e2e/network/tx-sendTx-default.test.ts --retry=0` ·
  Chrome, the two new specs — `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/pxe-host-state.test.ts tests/e2e/network/firefox-background-restart.test.ts --retry=0`
  (host-state passes; the restart spec reports skipped)
- Pass: exit 0 everywhere; the host-state spec reports one `visible` host on both browsers; the restart spec
  passes on Firefox; smoke shows 0 failed (the spike's reference is 128 passed / 16 skipped); network
  shows 0 failed (reference 117 / 15). A failure is diagnosed before any re-run; a genuine flake is re-run
  once and logged in lessons; a throttling-caused failure in a *test page* (not the wallet) is surfaced to the
  owner rather than re-masked.
- Layers: unit (guards) · smoke e2e · network e2e (full, proverless) · network e2e (one real proof).

### Phase 3 — Docs, index, follow-ups

Steps: `ARCHITECTURE.md` (§1 label, §6 host + lifetime rule, builds paragraph); `FIREFOX.md` (the throttling
row goes; the tab-placement and focus rows say what they now guard against); the debug skill's host line;
index row; record the follow-ups below in `lessons/phase-3.md`.

**Validation gate**
- Commands: `bun run audit:vue` · `bun run test:ci-gating` · `bun run lint:actions`
- Pass: all exit 0. Layers: lint/typecheck · unit · build.

### Follow-ups recorded, not done here

1. **Port the background-kill specs to Firefox.** Ten files are Chrome-only because only Chrome could kill its
   background. The spike reaches Firefox's `extension.terminateBackground()` through the suite's privileged
   `chromeScript`, and this plan lands that as one driver method with one spec. Moving `stopServiceWorker`
   behind `BrowserDriver` and un-skipping the files that do not also need CDP Fetch (`cold-wake-discovery`,
   `connect-locked-queue-sw-restart`, `sw-restart-network`, `sw-resilience`, the canaries' restart stage) is
   its own plan: each file carries Chrome target assumptions to unpick. (The spike's first two restart runs
   "failed" on both hosts because the spec never unlocked the wallet a restart locks — a test error, not a
   product bug; recorded in `spike/README.md` so nobody rediscovers it.)
2. **An interrupted dApp call never settles.** When the background dies mid-request, the dApp's pending
   `sendTx` is still unsettled after 120–180 s instead of rejecting — identical on both Firefox hosts, not run on Chrome.
   An observation for the port in follow-up 1, which is where a Chrome comparison would come for free.
3. **The upstream batch timer.** Informational only (owner: no upstream action). Any Aztec wallet that hosts
   the PXE in a hidden Firefox page has this slowdown.

## Security & Adversarial Considerations

- **Threat model.** Unchanged actors: a hostile web page, a hostile dApp, a compromised same-extension page.
  Two separate protections, neither changed: the PXE page is not in `web_accessible_resources`, so no web page
  can *load or frame* it (a gate below checks the built Firefox manifest); and *messages* from content scripts
  are refused by sender authentication (`sender-auth.ts`), not by web-accessibility. The CSP has no
  `frame-src` and the frame runs under the same script / WASM policy as the window did.
- **Same-origin parent and child.** The background page and the PXE frame can script each other directly.
  Same-extension pages in the same (non-private) context could already reach the background through
  `extension.getBackgroundPage()`; private-browsing and container contexts are isolated from it, before and
  after. Secrets the PXE holds stay in the same extension process they are in today.
- **Removing the adopt broadcast (F-10).** It closed exactly one hole: a PXE window leaked across a background
  restart kept answering broadcasts beside its replacement. A frame cannot leak — it is destroyed with its
  document (measured: after a forced termination, zero frames, no PXE responder; the window host left its old
  window alive). It never gave the background exclusive authority: a same-extension page can still open
  another tab or frame at the PXE URL, which would answer broadcasts and pass URL authentication. That trust
  boundary is unchanged and stays documented in `isOffscreenDocumentSender`.
- **Stale lifecycle messages.** A frame removed on READY timeout or a failed health check may still have a
  READY or a PONG in flight. The per-frame generation check makes its successor ignore both.
- **Availability.** A user can no longer close or focus the PXE host; the leaked-window second host can no
  longer occur.
- **Least privilege / supply chain / crypto.** No permission added or removed, no dependency added, no
  cryptography touched. `windows` use on Firefox shrinks to the approval windows.
- **Logging.** No new log lines; the deleted listener logged nothing.
- **Defeating a browser policy.** The fix does not evade throttling of a hidden page; it stops hiding the
  page. The background page's visibility is Firefox's own design for MV3 event pages.

## Assumptions

**Facts**
1. Real throttling costs 25.7 s vs 3.0 s (proverless) and 88.3 s vs 65.7 s (real proving) per dApp `sendTx` — `spike/results.jsonl` arms A, B, E0, E1. Five sends per arm under real throttling, each asserted `ok`: window 27.9 · 26.7 · 19.1 · 23.8 · 18.3 s, frame 5.0 · 1.5 · 1.8 · 1.7 · 1.5 s, ranges disjoint — arms V7-window, V9-iframe (the first frame spread, V-iframe, fired its repeats inside the wallet's `DUPLICATE_INITIALIZATION` window and measured refusals; V9 spaces them).
2. The dominant late timer is `setTimeout(sendBatch, batchWindowMS)` with `batchWindowMS = 0` — `@aztec/foundation/dest/json-rpc/client/safe_json_rpc_client.js:61,162`, `@aztec/stdlib/dest/interfaces/aztec-node.js:371`; call-site histogram in arms C, E1 (the remainder is the 20 s keepalive interval).
3. Framed in the background page the PXE page reports `visible`, native `setTimeout(0)` ≈ 1 ms, sendTx 2.2 s / 65.7 s, and the unmodified transport carries the full suites — arms F1, F2 and the proving round. Headed under Xvfb: the same (`visible`, ≈ 1 ms, 2.0–5.2 s) while the minimized window is `hidden` at ≈ 1,000 ms — arms H-*.
4. Two keepalives exist — the 10 s `storage.session` heartbeat (`apps/extension/src/wallet/runtime.ts:113,258`, armed at the end of boot) and the PXE page's 20 s in-flight message (`packages/extension-messaging/src/offscreen/service.ts:79`). Six minutes idle with a dApp tab and five with none kept the same background and PXE frame — arms L-iframe, L5-iframe. Without the heartbeat Firefox suspends the background, frame included, within two minutes — arm S-iframe.
5. Both full Firefox suites pass at retry 0 on the frame host with the masking prefs off — 128 / 16 smoke, 117 / 15 network.
6. Chrome's offscreen document reports `visible` and shows no throttling — arm D.
7. Firefox floor is 153 — `apps/extension/manifest/manifest.firefox.config.ts` (`strict_min_version`).
8. The Firefox background is a page, not a worker (`background.scripts`, `persistent: false`, same file) — it has a `document`; the spike appended to it.
9. No production users: a host change needs no migration, and the PXE's IndexedDB is keyed by origin, which does not change — `CLAUDE.md` § Persisted-storage shape changes.
10. `@crxjs/vite-plugin` 2.7.1 rejects Manifest V2 — `dist/index.mjs:2348`.
11. A background death locks the wallet by design on both browsers (`tests/e2e/network/cold-wake-discovery.test.ts:72`, `frozen-account-canary.test.ts` stage 5). On the frame host, forced termination, Firefox's own suspension and termination mid-`proving` all recover through unlock → reconnect → a `sendTx` asserted `ok` on exactly one new frame (7.4 s, 7.1 s, 67.8 s); mid-proof: zero transfers before recovery, one in total, journal `failed` + `succeeded` — arms L7-iframe, S7-iframe, M7-iframe (L5 / S / M are the same runs before the harness asserted status). The window host under the same sequences orphans its window, accumulates windows, and fails the recovery send on the throttled fee estimate — arms L5-window, M-window.
12. READY reaches the background from the frame as `{ contextId, documentId, envType, id, origin, url }` with the `?instance=` query in `url`, no `tab`, no `frameId` — arm L3-iframe onward.
13. The SOURCE manifest declares no `web_accessible_resources` (`apps/extension/src/manifest.test.ts:38`); the build plugin adds entries for content-script chunks (that test's own comment, `:34`), so only a check on the built manifest can say the PXE page is not among them.

**Inferences** (attack these)
- macOS and Windows behave like Linux. The mechanism is Firefox-wide (throttling keys on document visibility; the background page is `visible` by design), but Firefox also lowers a background *process's* OS priority on some platforms; unmeasured. No Windows host exists for this project — an accepted gap (Ask A4); macOS gets the owner's headed check before merge.
- The full prover-ON heavy lanes and the real-proving canary behave like the two real proofs measured (CI's Firefox lanes on the PR will say).
- AMO review has no objection to a framed extension page inside the background page.
- Deleting the pass fence on the Firefox path is safe because frame creation is synchronous; the per-frame READY generation covers the one asynchronous edge left.
- The window host was not cross-origin isolated either (the frame is not; proving time is identical).
- A dApp call interrupted by a background death never settling is the same on Chrome (observed on both Firefox hosts; not run on Chrome).

**Asks** (answered at the approval gate, 2026-09-21; the owner's words quoted)
- A1. Sign-off on the UI impact: the minimized Nulo window disappears on Firefox. — Owner: "so it looks like chrome?" Answered yes: Chrome's offscreen document never had a window, taskbar or dock entry, and Firefox now matches it. Owner: "approved then". **Signed off** — the PR body quotes this exchange.
- A2. Tier `light` and the fix shape "frame host, window path deleted (no fallback)". — Owner: "Everything else ok". **Approved.**
- A3. The Firefox background-restart spec and `terminateBackground()` driver method ride in this plan; porting the other background-kill specs stays a follow-up. — Owner: "Everything else ok". **Approved.** *Implementation note (Phase 2):* the spec ends the background with the public `runtime.reload()` rather than the privileged termination call — see [`lessons/phase-2.md`](./lessons/phase-2.md) § Deviation; the assertions are as planned, and the mechanism is an open ask for the owner.
- A4. Accept the lifetime contract and the platform gap (no Windows measurement). — Owner: "yes, sure... But when would that background page close?" **Accepted**; the question is answered in § Non-obvious mechanics ("When the background page ends").

## Delivery

Single arc, one branch (`worktree-pxe-timer-throttling`), one PR into `dev`, plain `gh pr create`.
`code_review: off`.

| Arc | Phases | Stacks on | PR title |
|---|---|---|---|
| 1 | 1–3 | `dev` | `fix(firefox): host the pxe page in a background-page frame, not a throttled window` |

The PR body quotes the owner's UI sign-off, carries the before / after table, and states the follow-ups.
**Delivered** = PR open with `quality-status`, `extension-smoke-e2e-status`, `extension-network-e2e-status`
green **and** both advisory Firefox aggregators green (they now run under real throttling, heavy lanes and
the real-proving canary included). The owner merges, after a headed check on a build sent with `send-to-mac`:
no Nulo window in the dock, a passkey profile creates and unlocks, one send completes.

## Post-implementation

Run by the implementing session, in this order, after Phase 3 is green. `code_review` is `off`: `/code-review`
is not part of this plan and is not run.

1. **Codex audit** — `/codex high` (under tmux, never while `audit:vue` or `test:all` runs), with: the net diff
   from the plan baseline, this plan, and these asks verbatim —
   *"What could go wrong? What would an attacker target? What are we trusting that we shouldn't?"* ·
   *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
   configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code
   works and is clear, leave it alone."* ·
   *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does,
   restates its line, references implementation plans / phases / reviews, or spends a paragraph where a
   sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't
   have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few,
   dense, and exact."* Tell codex not to run vitest e2e configs, builds or workflows.
2. **Fix loop** — verify each claim against the repo, apply what holds, commit, log the round in
   `lessons/`, resume the *same* codex session with the fix diff. Repeat until a round reports no new
   material findings. Three rounds still producing material findings → stop and surface it.
3. **Delivery** — only now open the PR (`gh pr create`, body as above), then `gh pr checks --watch`. A red
   check is a flake to re-run once after diagnosis, or breakage to fix — never made advisory. Do not merge.

## Audit verdicts

Light tier: one foreign-reviewer audit (Codex, GPT-6 Astra, `high`), full packet (adversarial, assumption
attack, implementation critique), then one resume of the same session on the revision. Transcripts:
[`audit-codex.md`](./audit-codex.md).

| Round | Verdict |
|---|---|
| 1 | **conditional approve** — correct the lifecycle evidence, add failure and performance gates, record owner acceptance of the remaining lifetime risk |
| 2 (resume) | **conditional approve** — evidence must assert `ok` sends, not settlement; PONG needs the generation check too; the manifest gate must read the built manifest; narrow the interruption claims; the owner's Asks stay open by definition |

**Adopted**

| Finding | What changed |
|---|---|
| R1 High — the "ten minutes idle" claim compared two absent PXEs | harness requires present identities; re-measured with a live host (arms L5-*); Fact 4 and the README corrected, the vacuous row called out |
| R1 High — the heartbeat claim was unqualified, the second keepalive missing from recon | recon lists both; arm S-iframe isolates the heartbeat (without it Firefox suspends the background, frame included, within two minutes); "stays alive" became a lifetime contract; comment at the heartbeat |
| R1 High — recovery was never exercised with a recreated PXE | it was a test error (a restart locks the wallet; the spec never unlocked) — rewritten on the canary's recipe; forced, natural and mid-proof terminations measured; one restart spec + driver method join the plan (Ask A3); acceptance of the contract is Ask A4 |
| R1 Medium — performance wording (masked Firefox vs Chrome; "every late timer") | reworded; five-send spread measured (arms V-*), headed run (arms H-*) |
| R1 Medium — sender shape unpinned | both Firefox sender shapes captured and pinned in unit tests, both directions; nothing keys on `frameId` |
| R1 Medium — "a second host cannot exist" | narrowed: only the leaked-window case is eliminated; the same-extension-page boundary is restated |
| R1 Medium — CSP / messaging / private contexts conflated | Security section rewritten |
| R1 Medium — `isConnected` is attachment, not readiness; failure modes untested | jsdom suite, one case per failure mode |
| R1 Medium + R2 Medium — stale READY, then stale PONG | per-frame generation matched on READY and PONG through one predicate; malformed URL refuses without throwing |
| R1 Medium — passing suites do not enforce the performance claim | `pxe-host-state.test.ts` on both browsers: exactly one host, `visible`. Codex R2: a defensible guard for this regression, not a speed guarantee — worded so |
| R1 Low — another stale comment (`firefox-rpc-intercept.ts:14`) | in the change map |
| R2 High — the spike's "ok" meant "settled": `waitForPgResult` resolves on `error` too | every spike send now asserts status `ok`; the recovery and spread arms re-run (round 7, arms L7 / S7 / M7 / V7); the permanent specs use `assertPgOk` and assert identities and host count |
| R2 Medium — the manifest gate read the source manifest | the host-state spec reads the built manifest through `chrome.runtime.getManifest()` and matches patterns, wildcards included, against the PXE page |
| R2 Medium — interruption claims too strong | the kill is now gated on the journal's `proving` stage; balance read before and after recovery and asserted; wording is "no additional transfer observed" and "unsettled after N s" |
| R2 — lifetime is "at most" the background's | worded so |

**Rejected**

| Finding | Why |
|---|---|
| Extension reload / update gates | a reload destroys every extension context on either host; nothing host-specific to test |
| Private-window gates | extensions are off in private windows by default, and the host change does not alter that isolation. Codex R2: would not insist |
| Windows timing check | no Windows machine exists for this project; recorded as an accepted gap (Ask A4). macOS gets the owner's headed check before merge. Codex R2: would not insist |
| A separate run with the masking prefs kept | Chrome's lanes are the unthrottled control, and keeping the prefs anywhere is what the owner decided against. Codex R2: would not insist |
| A per-probe nonce on PING/PONG | generation identifies the host, which is the fault to stop; with one tracked frame the only stale PONG left is an earlier answer from the SAME live frame, which is still a truthful "healthy"; a nonce adds a wire field for nothing |

**Open by definition:** codex's third condition — the owner's recorded acceptance — is Asks A1–A4 at the gate below.

## Seeds

ELI5 Artifact: https://claude.ai/artifact/FHHZSbVgssYzRPPo4ZuQqq (private) · source `implementations-plan/pxe-timer-throttling/eli5.html`.
Use exactly one per session — they do not compose. Start inside the plan's worktree: `agent-worktree resume pxe-timer-throttling`.

**`/goal` (recommended for this plan)**

```
/goal All three phases marked ✓ in implementations-plan/pxe-timer-throttling/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/pxe-timer-throttling/lessons/phase-N.md`; `/code-review` was NOT run (code_review is off); the codex fix loop converged over the whole diff, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; one PR into dev exists, created only AFTER the loop converged, its body quoting the owner's UI sign-off recorded under Ask A1 in plan.md (`gh pr view` output in the transcript) with quality-status, extension-smoke-e2e-status, extension-network-e2e-status and both Firefox aggregators green; `bun run audit:vue`, `bun run test:ci-gating` and `bun run lint:actions` report exit 0. Never merged; Chrome's branch of offscreen.ts, apps/tools/**, packages/bridge-core/** and every workflow file untouched; the three dom.*timeout* prefs never re-added; every e2e send asserted with assertPgOk, never bare settlement; no red check made advisory.
```

**`/loop` (fallback)**

```
/loop 15m Drive implementations-plan/pxe-timer-throttling forward. Never idle waiting for my input. Each firing:
1. Reality check: read plan.md and lessons/ (authoritative — not the chat); rebuild the task list from plan.md's phase headers if empty; `git status`, `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup`.
2. Waiting on CI is fine — confirm it is progressing; use the wait to review the diff. Do not start conflicting work.
3. No task in hand? Take the next pending step from plan.md. After each meaningful edit run `bun run lint` and the touched unit tests. Commit (signed, conventional, lower-case subject) and push the branch.
4. Stuck, or facing a decision you would bring to me? `/codex high` with full context (under tmux; never while audit:vue or test:all runs; tell it not to run e2e configs or builds); log consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, never touch Chrome's branch of offscreen.ts, apps/tools/**, packages/bridge-core/** or any workflow file, never re-add the dom.*timeout* prefs, never make a red check advisory, never count a settled dApp result as a success (assertPgOk).
5. Same step failed 5 times? Stop retrying; reassess with codex.
6. Phase green = that phase's validation gate in plan.md passes (e2e runs alone on the host, --retry=0). Paste the result, mark ✓ in plan.md, file lessons, print `LESSONS_FILE=implementations-plan/pxe-timer-throttling/lessons/phase-N.md`.
7. All phases ✓? Post-implementation per plan.md: codex audit over the net diff with the adversarial, no-over-engineering and comment-quality asks → fix → resume the same session until a round finds nothing material (3 rounds still churning → surface and stop). Only then `gh pr create` into dev with the body plan.md describes (quoting the UI sign-off under Ask A1), `gh pr checks --watch`, write the wrap-up. Surface and stop. Do not merge.
```
