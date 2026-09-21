---
plan: firefox-arc-closeout
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 2 agents (done); codex high (GPT-6 Astra); fable leg = Plan agent; no /code-review (owner's standing directive)
base: dev 60da5d66
status: APPROVED by the owner 2026-09-21 (rev 4) — implementing. Audits: fable conditional approve; codex reject (rev 1) → reject (fresh, rev 2) → conditional approve (rev 3), its three conditions met in rev 4
---

# firefox-arc-closeout

Close the Firefox arc. Three follow-ups came out of `firefox-background-kill` (#661); the owner's calls
(2026-09-21) are quoted where they bind the plan:

1. **A dApp call in flight when the background dies stays unanswered** (210 s measured on both browsers).
   Owner: *"Fail fast, reconnect"* — the pending call is rejected within seconds, the dApp learns it is
   disconnected and reconnects as it does today; no session keys persisted.
2. **The two execution canaries run on Firefox** — owner: *"PR lane + nightly"*; the passkey canary's CI gap
   (it has never run with real proving in CI) is *"Fix it here"*; on an `@aztec` bump *"Yes, red Firefox blocks
   too"*.
3. **The one-round-trip residual in Firefox's `stopBackground`** — owner: *"Drop it"*. Recorded as consciously
   accepted in the closing ledger; nothing else happens to it. The privileged script body is never authored or
   edited by a session (a safety stop, not a permission), which is why closing it would have needed the owner's
   own lines.

Housekeeping the owner chose: the merged `firefox-background-kill` worktree is removed (done at homing); the
index rows are flipped and a closing ledger is written (Phase 7).

**The owner's standing requirement for this plan**: both browsers are stable today; the plan must not let a bug
back in or let QA drift, and its nuances must be explained in plain language (the ELI5). That is § Regression
fences, and it is the first success criterion.

**UI impact: none.** No popup surface changes. The wallet's existing amber "Interrupted" card already covers the
interrupted send (recon); Phase 1's spec asserts it still appears. If any phase finds a user-visible change is
needed, it stops and asks the owner.

**Coverage is never reduced by this session's own decision.** Any point at which a spec, a stage or a browser
would have to be skipped to get green is a stop: diagnose, record the mechanism, and bring the owner an explicit
disposition.

## Success criteria

1. Nothing that is green today goes red: both browsers' smoke and network suites, every background-kill spec,
   the Chrome canary shard, `quality-status`.
2. A dApp call in flight when the background dies is **rejected within seconds** — target ≤ 15 s *measured* on a
   visible tab with the SDK's default 5 s heartbeat and a background that boots — and the dApp reconnects **on
   the same page** and a fresh send lands. The permanent spec hard-asserts ≤ 30 s and records the measured
   value; a measurement above 15 s on either browser goes to the owner with alternative C as the remedy. Per
   browser: on Firefox the test opens nothing between the kill and the rejection; on Chrome the successor
   starts on its own within milliseconds. The criterion is the rejection inside the budget — *what* woke
   Firefox is a Phase 1 diagnosis, not a claim this plan asserts (D21).
3. A dApp that was idle when the background died has its **next** call rejected, and reconnects. Two cases,
   both tested (decision ledger D15): **background already up** (Chrome restarts by itself; any browser once
   something woke it) → rejected **at once**, asserted under the 5 s heartbeat so only the `secure-message`
   branch can have answered; **the call itself wakes a cold background** (Firefox) → the cold-start relay drops
   that waking call like every pre-attach non-discovery message, and the call's own heartbeat is answered — the
   same seconds budget as criterion 2.
4. A healthy session is **never** disconnected by the new code. Pinned at the real wrapper.
5. Both canaries run prover-ON on both browsers in the PR lanes and nightly; no network spec can silently sit
   in the wrong proving pool again, and **no canary can silently stop executing**: CI reads the run's own
   results and fails the canary job if a listed file did not run, or ran with a skipped test. Pinned across all
   four lanes.
6. The written rule (CLAUDE.md, skills, FIREFOX.md, CI.md) and what CI runs change in the same commit.

## Regression fences

What is stable, and the test that reds if it moves. Every phase gate re-runs the fences its diff can reach.

| Stable today | Fence |
|---|---|
| Cold-wake discovery still reaches the discover popup (the relay is **not** edited by this plan) | `network/cold-wake-discovery.test.ts`, both browsers; `content-message-relay` unit tests untouched and green |
| A killed background drops the locked discovery queue cleanly (F-B16) | `network/connect-locked-queue-sw-restart.test.ts`, both browsers |
| Background death locks the wallet (strict mode) and recovery goes *through* the lock | `sw-resilience.test.ts`, `network/firefox-background-restart.test.ts` |
| Order of checks in the content wrapper — subframe, then schema, then everything else — and a live session's PING→PONG | **new `background.transport.test.ts`**: runs `initWalletSdkHandler` with the **real** SDK handler and a relay that captures the attached listener (the existing `background.admission.test.ts` and `background.init-order.pins.test.ts` mock the handler and the relay, so they cannot see the wrapper — both audits). Cases in Phase 2 |
| The SDK still ignores an unknown session and still names the message `session-disconnected` | `ping-pong.test.ts` (the existing real-handler pin) gains the wire-literal drift pin and the content-script no-port pin |
| No wallet presence leak to a page without an **approved discovery** | that no-port pin: the content-script handler posts nothing for a `session-disconnected` whose port it does not hold; a port exists only from `DISCOVERY_APPROVED` on |
| The single-listener rule; legal guard call-sites; log payload ban; storage facade ban | their own pins — which is why Phase 2's gate runs the **full** `bun run test`, not one directory |
| Same-page reconnect after a disconnect | the new spec reconnects **without reloading the dApp** (a reload would green a broken reconnect — codex) |
| Smoke runs the code under test | every smoke gate rebuilds first; smoke does not build, so a stale `dist` would green old code (fable) |
| A canary that is listed actually executes — a future `skipIf`, a renamed file or an early-exiting run cannot hide behind another spec's proofs (`PROVE_SUCCESS` is counted across the whole job) | **new `Assert canary results` step** in `_extension-network-e2e.yml`, every `canary*` job, all four lanes: reads vitest's JSON report and fails unless every file in the job's `test_files` is present, has **0 skipped / todo**, and each **named substantive test** (`canary-expectations.json`) reported `passed` — a passing setup-contract test cannot stand in for a deleted canary; its script is unit-tested against a captured report; pin (e) keeps the step and its wiring in place (codex, final pass) |
| Chrome's canary shard proves for real and fits its job budget | `Assert presto activity` (`PROVE_SUCCESS`) + the measured job duration (Phase 6); both split-path holes closed in advance (below) |
| The seam stays the only home of a browser difference | `browser-seam.test.ts`: `credentialOutlivesPage` joins the reads banned in `fixtures/**` and `helpers/**` outside the driver files |
| Every new test can fail | each new pin gets a recorded mutation check (break the code, see red, restore) in the phase's lessons file |

## Architecture & Implementation

### Item 1 — answer a session this background does not know

**What happens today (verified in the installed `@aztec/wallet-sdk` 5.2.0).** The dApp PINGs every 5 s while a
call is in flight (`extension_wallet.ts`; the interval is a dApp-side option, 5 s by default; a failed PING is
caught and the timer keeps running). A restarted background has an empty `activeSessions` map, so `handlePing`
and `handleEncryptedMessage` drop the message silently; the dApp gives up only at its own 300 s ceiling. The SDK
already has the right message — `session-disconnected`, sent **unencrypted** by `terminateSession()` — and the
dApp side already rejects everything in flight on receiving it (`ExtensionWallet.handleDisconnect`). But
`terminateSession()` returns early for a session the *current* handler does not hold, so after a restart nothing
can send it.

**The change.** In the one place every content-script message passes **once the listener is attached** — the
wrapper `buildContentTransport` hands to `attachContentListener` (`wallet-sdk/background.ts`) — after the
existing subframe and schema checks, on a **validated** content-script envelope only:

```
if type ∈ {"ping", "secure-message"}            // only messages that presuppose an established session
   and envelope.sessionId is a string
   and sender.tab.id is a number                // the browser's value, never the envelope's
   and the handler exists and handler.getSession(sessionId) is undefined
then
   sendToTab(sender.tab.id, { origin: "background", type: "session-disconnected", sessionId })
   // and do not forward: the SDK would only drop it
else
   forward as today                             // including "the handler is not there yet"
```

- New module `wallet-sdk/stale-session.ts`: a small **decision helper** `staleSessionVerdict(envelope, tabId,
  sessionKnown)` returning `"forward" | { disconnectTab, sessionId }` — it takes the already-validated envelope,
  the browser-supplied tab id and a boolean, so it has no handler dependency — plus the wire literal
  `SESSION_DISCONNECTED = "session-disconnected"`, hardcoded with a citation of the SDK's `InternalMessageType`
  (not exported; the convention `content-script-validator.ts` already uses).
- `buildContentTransport(logger)` becomes `buildContentTransport(logger, sessionKnown)`, where `sessionKnown` is
  a closure over `state.late.handler` — the transport is built before the handler exists, so the lookup must be
  lazy; an undefined handler answers "forward". Handler methods stay arrow-wrapped, as today.
- The send reuses the transport's own `sendToTab` (its receiver-gone handling included). One debug-level log
  line, object-argument, `describeExternalId(sessionId)` — a connected dApp pings every 5 s, so nothing above
  `debug` (the legal-refusal precedent).
- **No pending-discovery guard** (decision ledger D1): the SDK registers the session synchronously *before* it
  sends the key-exchange response, and the dApp only creates its wallet object after that response, so no honest
  message can name a session the handler is about to have. Every other unknown-session case — the wallet
  terminated it, a profile switch, a tab that re-discovered — is one where the dApp *should* hear "disconnected";
  a repeat is harmless (the content script has already closed the port and posts nothing), and a dApp that
  missed the first one recovers instead of hanging.
- **The relay is not edited** (D15). Pre-attach it drops every non-discovery message, as today
  (`content-message-relay.ts:93`). So a PING or a call that *wakes* a cold background is itself lost, and the
  next PING — the dApp heartbeats while any call is in flight — is the one answered. Recovery from a cold
  background is therefore heartbeat-dependent by design; rejection "at once" is a statement about an attached
  background. The cost of the alternative (C) is an edit to the pinned cold-wake fix; the owner sees this choice
  at the approval gate.

**Flow after the change.** background dies → (Chrome: a successor starts at once; Firefox: the dApp's next PING
wakes one) → boot → the next PING reaches the wrapper → unknown session → `session-disconnected` to that tab →
the content script forwards `DISCONNECT` over the page's MessagePort → the dApp SDK rejects every in-flight
promise (`"Wallet disconnected"`) and fires `onDisconnect` → the playground shows disconnected → the user
reconnects on the same page (the wallet is locked by strict mode, so the reconnect goes through unlock, as
today). Expected latency ≈ first PING (≤ 5 s) + 5 s × ⌈boot / 5 s⌉.

**Limits, stated and documented, not fixed here:**
- A dApp on an SDK with no heartbeat, or with a long custom interval, has nothing on the wire to answer; its
  pending call ends at its own timeout. Its **next** call is rejected at once if the background is up by then;
  if that call is what wakes a cold background (Firefox), it is dropped pre-attach and also ends at its own
  timeout, and the call after it is rejected at once. B is the named remedy if such dApps turn out to matter.
- A hidden tab's timers are throttled by the browser (down to about one tick a minute), so "within seconds"
  is a statement about a visible tab.
- An *invalidated extension context* (the add-on was reloaded or updated under the page) cannot be repaired from
  the background: the content script's `sendMessage` has no receiver. Unchanged by this plan.
- A handshake in progress when the background dies ends at the dApp's own discovery / key-exchange timeouts
  (F-B16's "clean loss").

### Item 2 — the canaries on Firefox, and the proving pools pinned

- `network/frozen-account-canary.test.ts`: drop `describe.skipIf(isFirefox)`; reword the one comment that names
  the offscreen re-boot. Recon: it already closes every extension page before `stopBackground` and wakes the
  successor with a fresh popup.
- `network/passkey-execution-canary.test.ts`: on Chrome the virtual authenticator is scoped to the anchor
  popup's page, so the popup stays open across the kill; on Firefox it is session-scoped (`firefox.ts` creates it
  on the session; "a credential outlives the window that made it", `FIREFOX.md`) and the kill is declined under
  an open extension page. The difference goes on the driver as a readonly fact, like `kind` and `scheme`:
  `BrowserDriver.credentialOutlivesPage` (Chrome `false`, Firefox `true`). Where `true` the spec closes the anchor
  popup before `stopBackground` and opens a new one for the fresh ceremony; where `false` it behaves exactly as
  today. **Stage 4 must pass on Firefox.** If it does not, that is a stop (see "Coverage is never reduced"): the
  lessons file records the mechanism actually observed, and the owner decides — no skip, early return or
  re-labelled reason lands without their call.
- CI lists (`pr-extension-network-e2e.yml`, `pr-extension-network-e2e-firefox.yml`, `nightly.yml`): the canary
  job's `test_files` becomes the same four files on both browsers — `transfers`, `tx-sendTx-default`,
  `frozen-account-canary`, `passkey-execution-canary` — and the sharded pool's `exclude_files` gains the passkey
  canary in **every** lane. The false Firefox comment goes.
- `scripts/ci-cd/behavior-gating.test.ts`: `CHROME_ONLY_CANARY` and its two `.filter(...)` go — a Firefox lane
  runs **exactly** its Chrome twin's files. New pins, over **all four lanes** (PR ×2, nightly ×2):
  (a) every `tests/e2e/network/*-canary.test.ts` on disk is in the `test_files` of a job whose
  `with.proverless` is not `true` — "prover-ON" is defined by that input, not by the job being dedicated (today's
  check would accept a proverless heavy job); (b) each such file is also in that lane's `exclude_files`; (c) each
  lane's `exclude_files` equals the union of its dedicated lists (the partition check that today reads only the
  Chrome PR file); (d) every suite job in an aggregator's `needs` appears as `needs.<job>.result` in that
  aggregator's script (today only `needs` is pinned, so a job can be red under a green required check — fable);
  (e) `_extension-network-e2e.yml` carries the `Assert canary results` step, keyed on the same `canary*` label
  match as the zero-proofs check, and every lane's canary job is labelled so it fires.
- **Executed, not just listed** (D16). `e2eReporters()` (`apps/extension/vite.shared.ts`) adds vitest's built-in
  `json` reporter when `NULO_E2E_RESULTS_FILE` is set — no new dependency; unset, local runs are unchanged. The
  reusable workflow sets it for `canary*` jobs and then runs `scripts/ci-cd/assert-canary-results.ts <report>
  <test_files…>`: every listed file present, 0 skipped / todo, and **every test title that
  `scripts/ci-cd/canary-expectations.json` names for that file reported `passed`** — else exit 1 naming the file
  and the test. "≥ 1 passed" is not enough: each canary file also holds a setup-contract test that would keep
  passing if the canary itself were deleted or never registered (D19). The expectations file lists, per file,
  the substantive test's title; two pins keep it honest — every title in it appears in its spec's source (a
  rename updates it in the same commit), and every `*-canary.test.ts` on disk plus every file in a canary job's
  `test_files` has an entry. All four listed files skip only on a missing sandbox config
  (`test.skipIf(!hasConfig)`), which CI always has, so zero is the honest number. The script's unit test
  (`test:ci-gating`) feeds it reports captured from a real run: clean; one test skipped; one file absent; and
  the canary's entry removed while its contract test still passes.
- `CHROME_ONLY.canary` is removed from `fixtures/browser/index.ts`; two reasons remain:
  `backgroundKillUnderPage`, `cdpFetch`. Chrome-only files: four → two.
- **Budget.** One `presto-server` per job serializes proofs and the job has `timeout-minutes: 30`. Phases 4–5
  record each canary's local prover-ON wall time per browser and **sum them with the two send specs' before any
  workflow edit**, so the required Chrome job does not discover a timeout on the PR. On the PR the measure is the
  job's duration as GitHub reports it, the slower browser, the maximum over at least two runs. **Pre-decided:**
  above 22 minutes the job is split into `canary` (the two send specs) and `canary-accounts` (the two canaries).
  The split path edits, in one commit: the three callers, **`_extension-network-e2e.yml`** (its zero-proofs check
  matches the label `canary` exactly today — it becomes a `canary*` prefix match, so the new job cannot escape
  it — codex), every aggregator's `needs` **and** result loop (PR ×2, nightly), `behavior-gating.test.ts`'s
  hard-coded nightly job names, and pin (d). No timeout is raised; a job that times out is a red check, diagnosed,
  never retried into green.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/wallet/services/wallet-sdk/stale-session.ts` (+ `.test.ts`) | new — the decision helper, the wire literal, its table test |
| `apps/extension/src/wallet/services/wallet-sdk/background.ts` | `buildContentTransport` takes the lazy `sessionKnown` and applies the verdict after validation |
| `apps/extension/src/wallet/services/wallet-sdk/background.transport.test.ts` | new — the real wrapper, the real SDK handler |
| `apps/extension/src/wallet/services/wallet-sdk/ping-pong.test.ts` | + the wire-literal drift pin, + the content-script no-port pin (no parallel pins file) |
| `apps/extension/tests/e2e/network/inflight-call-background-death.test.ts` | new — `@requires-proverless`; template `lock-cancels-dapp-send.test.ts` |
| `apps/playground/**` | only if a `data-testid` the spec needs is missing (connection state, the pending call's outcome) |
| `apps/extension/tests/e2e/network/{frozen-account,passkey-execution}-canary.test.ts` | un-skip; the passkey one reads the driver fact |
| `apps/extension/tests/e2e/fixtures/browser/{index,chrome,firefox}.ts` | `credentialOutlivesPage`; `CHROME_ONLY.canary` removed. **The privileged function's body is not touched** |
| `apps/extension/scripts/e2e/browser-seam.test.ts` | the new fact joins the banned reads outside the driver files |
| `.github/workflows/{pr-extension-network-e2e,pr-extension-network-e2e-firefox,nightly}.yml` | the canary and exclude lists; on the split path also `_extension-network-e2e.yml` and the aggregators |
| `.github/workflows/_extension-network-e2e.yml` | the `Assert canary results` step + `NULO_E2E_RESULTS_FILE` for `canary*` jobs (always); the zero-proofs prefix match (split path only) |
| `apps/extension/vite.shared.ts` | `e2eReporters()` adds vitest's `json` reporter when `NULO_E2E_RESULTS_FILE` is set |
| `scripts/ci-cd/assert-canary-results.ts` (+ `.test.ts`, run by `test:ci-gating`), `scripts/ci-cd/canary-expectations.json` | new — the per-file "named test passed, zero skips" assertion and the titles it requires |
| `scripts/ci-cd/behavior-gating.test.ts` | pins (a)–(e) |
| `CLAUDE.md`, `CI.md`, `.github/README.md`, `UPDATE.md`, `ARCHITECTURE.md` (session model), `apps/extension/tests/e2e/FIREFOX.md`, `.claude/skills/{e2e-testing,aztec-update}/SKILL.md` | the rule, the bump gate, the fail-fast behaviour and its limits |
| `implementations-plan/index.md`, `implementations-plan/firefox-arc-closeout/closing-ledger.md` | index flips; what is done vs only time-gated |

Nothing under `apps/tools/**`, `packages/bridge-core/**`, the content script, the manifest (no new permission),
`content-message-relay.ts`, or any storage shape.

### Alternatives (the competing outline is B)

- **A — reactive reply in the attached wrapper (chosen).** No new state, no new permission, one decision helper;
  bounded by the dApp's heartbeat and the background's boot. Also answers an idle dApp's next call — at once
  when the background is up, one heartbeat later when that call is what wakes it (D15).
- **B — proactive push at boot.** Persist `{sessionId, tabId}` (no keys) to `chrome.storage.session` at session
  establishment, delete on termination, and at boot send `session-disconnected` to each. Real advantages: on
  **Chrome**, where a successor starts within milliseconds of the death, the push would land in about one boot
  time with no heartbeat needed; it covers dApps with no heartbeat whenever *anything* boots the background; it
  tells every tab at once. On Firefox it cannot cause the boot, so there it gains at most one heartbeat. Costs:
  a new persisted record with four writers to keep in step (establish / terminate / profile switch / tab close)
  and a boot hook. Both audits keep A for this bounded task; B stays the named next step if no-heartbeat dApps
  turn out to matter.
- **C — also answer pre-attach, from the relay** (before attach no session can exist, so any PING is stale). It
  could reuse the relay's existing validation without buffering anything. Rejected as **scope control, not
  security**: the relay is the cold-wake fix and is pinned; C is the remedy offered to the owner if the measured
  rejection exceeds 15 s on either browser.
- **D — content-script-side detection.** The content script is 22 lines of SDK wiring that discards
  `sendMessage`'s result; detection there means forking SDK behaviour. Rejected.
- **E — leave it to the dApp's timeout (document only).** The owner rejected it.

## Phases

Arc 1 = Phases 1–3 (product). Arc 2 = Phases 4–7 (canaries, CI, rule, closeout).

**How every e2e gate runs** (the commands below are written once here): alone on the host, `--retry=0`, from a
detached script + Monitor; no edit to `src/**`, fixtures or a running spec while a run is active. `ROOT` = the
worktree root, `EXT` = `apps/extension`.
- Network, proverless: `cd ROOT && NULO_E2E_PROVERLESS=1 [NULO_E2E_BROWSER=firefox] bun run e2e:agent <files> --retry=0`
  (the runner builds the wallet itself).
- Network, **prover-ON**: the same without `NULO_E2E_PROVERLESS` (native `presto-server` on this host).
- Smoke: `cd EXT && VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run build` (Chrome) or `… bun run build:firefox`, **then**
  `cd EXT && NULO_E2E_MIGRATION_FIXTURE=1 [NULO_E2E_BROWSER=firefox] bun run test:e2e -- <files> --retry=0`.
- Firefox needs `GECKODRIVER` set. A gate's pass line is `Test Files N passed (N)` with the stated test counts;
  **no skip is allowed unless the gate names it**.

### Phase 1 — reproduce the hang as a permanent spec (red first)

`network/inflight-call-background-death.test.ts` (`@requires-proverless`, no browser skip), three tests:

1. **In flight.** Connect the playground with the transaction capability, `holdProofGate`, send, approve (the
   execute popup closes itself), wait for the send to park in proving, confirm no extension page is open, record
   the background identity, `stopBackground` — within the proof gate's 20 s safety release — then **open
   nothing**. Assert, by `data-testid` only: the playground's pending call settles as an error within 30 s (the
   measured time is logged) and the playground reports disconnected. Then, **without reloading the dApp**: open
   the popup, unlock, reconnect from the same page, `releaseProofGate`, a fresh send lands (`assertPgOk`); the
   wallet's activity shows the interrupted record.
2. **Idle, cold background.** Nothing in flight: `stopBackground`, **open nothing**, one call from the dApp
   straight away → it rejects within the same 30 s budget (on Firefox this call is what wakes the background and
   is dropped pre-attach — its heartbeat is what gets answered; on Chrome it may land either side of the attach)
   → same-page reconnect → a send lands.
3. **Idle, background up.** Nothing in flight: `readLivenessBaseline`, `stopBackground`, open the popup (the
   wake), then `waitForWorkerLiveness` — the successor writes liveness **after** `initWalletSdkHandler`
   (`runtime.ts:253-255`), so a fresh liveness value means the content listener is attached; the popup's locked
   screen would not, because service RPCs go live earlier, during `services.start()` (codex). Only then start
   the clock: one call from the dApp → it rejects **within 3 s**, shorter than the 5 s heartbeat, so no PING can
   have answered for it: this is the only end-to-end proof of the `secure-message` branch → same-page reconnect
   → a send lands.

**Gate.** Layers: lint · e2e-live-network (both browsers).
- `cd ROOT && bun run lint` → exit 0; `cd EXT && bun run test -- scripts/e2e` → green (the seam scan sees the
  new spec).
- Against the **unfixed** tree, both browsers, proverless: each of the three tests fails on its rejection
  assertion — *and on nothing earlier*: the run must show the send parked (test 1) and the old background
  confirmed gone. The six failure lines go in `lessons/phase-1.md`. The spec is committed with Phase 2,
  unchanged, never as a red commit.
- **What wakes Firefox — a recorded diagnosis, not an assertion.** A successor being alive does not prove the
  heartbeat woke it: the price alarm is registered at module scope and wakes the background too
  (`src/wallet/index.ts:96`). So the Firefox red run records, over the **whole 30 s budget** and not one sample:
  (i) test 1 — in flight, heartbeat running — the time at which a new background identity first appears; (ii) a
  control — idle dApp, nothing in flight, nothing opened, same window — whether one appears at all. The alarm
  is periodic (3 min, first fire one period after boot — `price/service.ts:27,258`), so recording its period is
  not enough: **both diagnostic kills must land with their whole 30 s window before the alarm's first fire**,
  and the run logs background boot time, kill time and the margin; a run whose setup overran the margin is
  repeated, not interpreted. Alive in (i) and not in (ii), both inside the margin → the dApp's traffic is the
  likely cause — recorded as *suggestive*, since no criterion rests on it. Anything else → inconclusive, and
  said so; the rejection assertion in Phase 2 is the evidence that counts.
- **Pre-decided Firefox branch:** if in (i) no successor appears within the budget, **reproduced on a second
  run** — the dApp's traffic does not wake an event page — no wallet-side design can help, because nothing
  boots. Stop and tell the owner; the proposed disposition is that the Firefox leg wakes the successor by
  opening the popup and asserts rejection within the budget *of that wake*, with criterion 2 restated per
  browser.

### Phase 2 — the reply, its fences, the spec green

`stale-session.ts` + its table test (unknown + `ping` → disconnect verdict; unknown + `secure-message` → same;
known → forward; `discovery-request` / `key-exchange-request` / `disconnect-request` → forward; no tab id →
forward; no `sessionId` → forward); the `background.ts` wiring; **`background.transport.test.ts`** — real
`initWalletSdkHandler`, real SDK handler, a relay that captures the listener, a fake `chrome.tabs.sendMessage`:

| Case | Expected |
|---|---|
| subframe sender, any type | nothing sent, not forwarded (also with `VITE_NULO_ALLOW_IFRAME_DAPPS=1`: forwarded, and an unknown session there is answered in the sender's tab only) |
| malformed envelope | nothing sent |
| non-content-script message | passthrough, nothing sent |
| unknown session, top frame, `ping` / `secure-message` | exactly one `session-disconnected` to `sender.tab.id`, SDK handler not invoked |
| the same again | one more, identical (idempotent, no state) |
| a session id that belongs to **another tab's** live session | forwarded (it is known) — no disconnect to either tab |
| live session (established through the real handler), `ping` | PONG to its tab, no disconnect |
| a key exchange in progress, then its first `secure-message` | never a disconnect |
| the wallet terminated a session (its approved discovery is restored, `:402-412`) and the tab **missed** that disconnect; the tab's next `ping` | one `session-disconnected` — the case the removed guard (D1) would have suppressed |
| a page **chose** its discovery `requestId` (it becomes the session id): equal to another tab's **live** session → `ping` from the choosing tab | forwarded (known); no disconnect reaches either tab |
| the same, equal to a **dead** id | the reply goes to the choosing tab only — the browser's `sender.tab.id` — never to the tab that once held it |
| `tabs.sendMessage` rejects "receiver gone" | swallowed, as today |
| handler not yet assigned | forwarded |

`ping-pong.test.ts` gains: the installed SDK's `InternalMessageType.SESSION_DISCONNECTED` equals the literal
(read from the package source through `@nulo/resolve-asset`); a real `ContentScriptConnectionHandler` posts
nothing to the page for a `session-disconnected` whose port it does not hold, and holds a port only after
`DISCOVERY_APPROVED`.

**Gate.** Layers: typecheck/lint · unit (whole repo) · e2e-live-network (both browsers).
- `cd ROOT && bun run lint && bun run typecheck` → exit 0.
- `cd ROOT && bun run test` → exit 0 (the log-payload, legal, storage and admission pins live outside the touched
  directory). Each new pin's mutation check recorded — at minimum: the verdict moved above the subframe check →
  `background.transport.test.ts` red; the literal changed → `ping-pong.test.ts` red.
- Network, proverless, **Chrome and Firefox**, all passed, 0 skipped except Firefox's restart spec on Chrome:
  `network/inflight-call-background-death` (3 tests; the Phase 1 file byte-for-byte), `network/cold-wake-discovery`,
  `network/connect-locked-queue-sw-restart`, `network/balance-row-reconciliation`, `network/session-reconnect`,
  `network/lock-cancels-dapp-send`, `network/firefox-background-restart`.
- Smoke (build first), both browsers: `sw-resilience` (its two known skips named), `sw-restart-network`.
- The measured time-to-rejection per browser is recorded; above 15 s on either → stop, owner, alternative C.

### Phase 3 — docs for the behaviour

`ARCHITECTURE.md` (session model: what a dApp sees when the background dies, the four stated limits, why this
differs from F-B16), the e2e skill's ledger, `FIREFOX.md` if a Firefox nuance was learned.

**Gate.** `cd ROOT && bun run audit:vue && bun run test:ci-gating` → exit 0. Then **Arc 1's codex loop** (see
Post-implementation) before Phase 4 starts.

### Phase 4 — the frozen-account canary on Firefox

Un-skip, reword the comment.

**Gate.** Layers: lint · e2e-live-network with **real proving**, both browsers.
- `cd ROOT && bun run lint` → exit 0; `cd EXT && bun run test -- scripts/e2e` → green.
- Prover-ON, `tests/e2e/network/frozen-account-canary.test.ts`, Chrome and Firefox → `Test Files 1 passed (1)`,
  `Tests 2 passed (2)` — the agent-runner contract test and the canary itself, named in the output — **0
  skipped**; wall time recorded per browser.

### Phase 5 — the passkey canary on Firefox

`credentialOutlivesPage` on the three driver files; the spec reads it; the seam scan bans it elsewhere.

**Gate.** Layers: lint · unit · e2e-live-network with real proving, both browsers.
- `cd ROOT && bun run lint`; `cd EXT && bun run test -- scripts/e2e` → green, debt maps unchanged or smaller.
- Prover-ON, `tests/e2e/network/passkey-execution-canary.test.ts`, Chrome and Firefox → `Tests 2 passed (2)`
  (contract test + the canary), **0 skipped, all four stages run on both** (each stage's step line in the
  output); on Chrome the popup stays open across the kill exactly as today. Wall times
  recorded, and the four-file sum per browser compared with the 22-minute rule **before** Phase 6.

### Phase 6 — CI lists and the pool pins

The three callers, the reusable workflow's `Assert canary results` step with its script and the `json`
reporter switch, `behavior-gating.test.ts` pins (a)–(e), `CHROME_ONLY.canary` removed; the split path if the sum
already says so.

**Gate.** Layers: lint · CI-gating unit · actionlint.
- `cd ROOT && bun run lint && bun run test:ci-gating && bun run lint:actions` → exit 0;
  `cd EXT && bun run test -- scripts/e2e` → green (the e2e tree is outside `typecheck`, so lint and the seam
  tests are its static gate).
- Mutation checks recorded: a canary removed from one lane's list → red; a canary left in a sharded pool → red;
  a canary job given `proverless: true` → red; a job in `needs` but missing from the result loop → red; the
  results step removed or its label match narrowed → red.
- The results assertion proven against a **real** report, both browsers, before it is trusted: one local
  prover-ON canary run with `NULO_E2E_RESULTS_FILE` set → the script exits 0; the same report with
  `describe.skip` put on a canary (a scratch run, never committed) → exits 1 naming the file; a report from a
  run that omitted a listed file → exits 1; the clean report with the canary's entry deleted and its contract
  test left passing → exits 1. Those captured reports become the unit test's fixtures.
- Job duration is read on the PR (Delivery) — slower browser, max of ≥ 2 runs — against the 22-minute rule.

### Phase 7 — the rule, the bump gate, the closeout

Committed **with** Phase 6's pins where they state the same fact. A checklist in `lessons/phase-7.md` ticks every
place recon found the rule — `FIREFOX.md` row; `CLAUDE.md` (Firefox-lanes bullet; § Account-address freeze: on a
bump PR the Firefox canary job must be green too and a red one holds the bump — a written rule, not a required
check); `CI.md`; `.github/README.md`; `UPDATE.md` (both mentions); `e2e-testing` skill (the Chrome-only count,
the passkey stage-4 note, the ledger); `aztec-update` skill (the count, the runbook's Firefox check) — and a
final `grep` for "Chrome-only", "four files" and "canary" confirms no stale sentence is left.
`closing-ledger.md`: done / consciously accepted (the `stopBackground` residual; heartbeat-dependent recovery
from a cold background; no-heartbeat dApps; hidden tabs; context invalidation; the handshake window) / noted
for a later look, outside this arc (a page choosing a discovery `requestId` equal to another tab's live session
— SDK behaviour that exists today) / only time-gated (14 and 30 green nightlies before the Firefox
lanes can become required; the first release's `smoke-firefox-against-artifact`; the AMO gecko id the owner still
confirms). Index: `firefox-background-kill` completed, this plan in review; the previous plan's Ask A1 marked
superseded here.

**Gate.** `cd ROOT && bun run audit:vue && bun run test:ci-gating && bun run lint:actions` → exit 0. Then **Arc
2's codex loop**, then the cross-arc pass.

## Security & Adversarial Considerations

- **Threat model.** Content scripts run in every frame of every origin (`all_frames: true`); any page can cause
  envelopes to reach the background. The new code adds one *outbound* message, to the **sender's own tab** as
  the browser reports it, carrying only the `sessionId` from a schema-validated envelope. It reads no storage,
  persists nothing, needs no permission (`tabs.sendMessage` to `sender.tab.id` works without `"tabs"`).
- **A page chooses its session id, but cannot change it afterwards.** The SDK makes the discovery's `requestId`
  — a page-supplied value — the session id (`background_connection_handler.ts:278-281`). What a page cannot do
  is override the id a port captured: only *discovery* crosses `window.postMessage`; everything after travels
  over a MessagePort whose `sessionId` the content script closed over. Isolation therefore rests on three
  things, none of them id secrecy: the user's **approval** (no port without one), the **browser-supplied**
  `sender.tab.id` as the only reply destination, and the content script's **port match** on receipt. The
  transport test carries the chosen-id cases. (A page picking an id equal to another tab's live session is an
  SDK-level question that exists today, untouched by this change; it is noted in the closing ledger as a
  follow-up to examine, not widened into this plan.)
- **Presence / fingerprinting.** `tabs.sendMessage` reaches every frame's content script in the tab; each posts
  `DISCONNECT` only over a port it holds, and a port exists only from `DISCOVERY_APPROVED` on. A frame present
  at an approval already received the wallet's info then (the existing F-002 broadcast), so the reply discloses
  nothing new; a page with no approved discovery sees nothing. SDK behaviour, therefore pinned, and re-checked
  by that pin on every `@aztec` bump.
- **Cross-session disconnect.** Naming another tab's live session forwards (it is known); naming a dead one
  sends the reply to the *sender's* tab, where no port matches. Subframes are rejected before the verdict; with
  the build-time iframe escape hatch on, a subframe's reply still lands only in its own tab, and only a frame
  holding the port acts on it — for a session that is already dead.
- **Flood.** One `tabs.sendMessage` per admitted message, possibly delivered to several frames; no buffer, no
  state growth. An honest SDK stops after the first reply (the port closes). A hostile page can keep sending,
  at the cost every message already has today; debug-level logging is not rate limiting and is not claimed to be.
- **False disconnect is the real risk** (availability): excluded by the SDK's registration order, fenced at the
  real wrapper (live PING → PONG; first message after a key exchange), and exercised by the whole network suite
  on both browsers, every call of which crosses the edited wrapper.
- **Fail closed.** Unknown session + session-presupposing message → disconnect. Handler absent, or anything
  else → today's path.
- **Logging.** Object arguments only; `describeExternalId`; never the origin or URL; `debug`.
- **CI / supply chain.** No new dependency, action or secret; `contents: read` stays; the canary job keeps the
  SHA-256-pinned `presto-server`. No timeout is raised, no check becomes advisory, and the two ways a split
  could have weakened a gate (the label-keyed zero-proofs check; an aggregator loop missing a job) are closed
  and pinned. The Firefox lanes stay advisory by the existing staged rollout; the bump rule is written policy.
- **The privileged Firefox script** is not touched by any phase.

## Assumptions

**Facts** (verified against the tree at `60da5d66` / the installed SDK 5.2.0; both audits re-verified them)
1. `terminateSession()` sends `session-disconnected` unencrypted and returns early for an unknown session
   (`background_connection_handler.ts:389-414`); `handlePing` drops an unknown session silently (`:236-246`).
2. `getSession` is public on the handler (`:449`).
3. **Once attached**, every content-script message passes `buildContentTransport`'s wrapper after the subframe
   and schema checks (`wallet-sdk/background.ts:292-361`); pre-attach the relay drops everything but discovery
   (`content-message-relay.ts:93`). `CONTENT_SCRIPT_MESSAGE_TYPES` already lists `ping` and `secure-message`.
4. The SDK registers the session (`activeSessions.set`, `:330`) synchronously before it sends the key-exchange
   response (`:339`); the dApp creates its wallet object only after that response (`extension_provider.ts:66-85`).
5. The content script opens a page port on `DISCOVERY_APPROVED` (`content_script_connection_handler.ts:164-170`)
   and ignores a `session-disconnected` for a port it does not hold (`:236-244`).
6. The passkey canary is named in no workflow and is not in any sharded pool's `exclude_files`.
7. Firefox's virtual authenticator is session-scoped (`firefox.ts`, `FIREFOX.md:36`).
8. `behavior-gating.test.ts` pins `CHROME_ONLY_CANARY` to the frozen canary only; its partition check reads only
   the Chrome PR lane; the aggregators' result loops are hand-written and unpinned.
9. `_extension-network-e2e.yml`'s zero-proofs check fires only for `SHARD_LABEL = "canary"`.
10. `background.admission.test.ts` and `background.init-order.pins.test.ts` mock the SDK handler and the relay;
    no unit test installs the wrapper today.
11. Chrome starts a successor within milliseconds of a background death; Firefox only on the add-on's next event
    (`fixtures/browser/index.ts`, the `stopBackground` contract).
12. The session id is the page-supplied discovery `requestId` (`background_connection_handler.ts:278-281`).
13. The price alarm's listener is registered at module scope and wakes the background
    (`apps/extension/src/wallet/index.ts:96`) — a wake source other than the dApp.
14. Each canary file holds two tests, the agent-runner contract test and the canary
    (`frozen-account-canary.test.ts:38,82`; `passkey-execution-canary.test.ts:49,91`); the two send specs skip
    only on `!hasConfig`.
15. `PROVE_SUCCESS` is counted across the whole job's `presto-server` log (`_extension-network-e2e.yml:341-374`),
    so it cannot say *which* spec proved.
16. The successor's first liveness write follows `initWalletSdkHandler` (`src/wallet/runtime.ts:253-255`), while
    service RPCs go live earlier, in `services.start()` (`:243`); `readLivenessBaseline` /
    `waitForWorkerLiveness` already exist in `tests/e2e/fixtures/helpers.ts` and the kill specs use them.
17. The price alarm is periodic at 3 minutes with no initial delay override (`price/service.ts:27,258`).

**Inferences** (unverified — each has the phase that proves or kills it)
1. On Firefox the dApp's heartbeat `runtime.sendMessage` wakes a new event page. Supporting evidence:
   `cold-wake-discovery` passes on Firefox and wakes the background the same way. Phase 1 records it **with a
   control for the price alarm**; the branch if false is pre-decided and needs a second run.
2. A `DISCONNECT` that arrives while a call is parked in proving reaches the dApp's `handleDisconnect` and
   rejects it — read in the SDK, proven only by Phase 2's green spec.
3. The playground reconnects on the same page after `onDisconnect`. If it cannot for a reason outside this plan,
   that is a stop, not a reload.
4. Firefox completes a fresh WebAuthn ceremony in a **new** popup after a background kill (Phase 5; a failure is
   a stop).
5. Four prover-ON files fit the canary job's budget on both browsers (Phases 4–5 sum, Phase 6 measures; the
   split is pre-decided and its two holes pre-closed).
6. Vitest's `json` report marks a skipped test distinguishably from a passed one for `describe.skipIf`,
   `test.skipIf` and `test.todo` (Phase 6 proves it on a real report before the script is trusted).

**Asks** — resolved by the owner on 2026-09-21: fail fast + reconnect; both canaries on the PR lane and
nightly; fix the passkey CI gap here; a red Firefox canary holds a bump; drop the residual; tier `mid`;
housekeeping as chosen. **The approval gate, 2026-09-21** — the owner, verbatim: *"(1) leave it alone. (2)
sounds good. (3) yes. (4) ok. approved"* — that is: (1) D15, the cold-start relay stays untouched and recovery
from a *cold* background rides on the dApp's heartbeat (alternative C is not taken); (2) the scope as listed;
(3) validation on both browsers and two stacked PRs the owner merges; (4) the three pre-declared stops. **None
open.** Three *conditional* owner calls are pre-declared as stops, not assumed: rejection measured
above 15 s (→ C); the dApp's traffic does not wake Firefox, twice (→ per-browser criterion); passkey stage 4
fails on Firefox (→ disposition).

## Decision ledger

Dual audit of rev 1, 2026-09-21: codex — **reject** (blocking: ineffective transport fences; a failure-triggered
canary skip; proof enforcement lost on the split path); fable — **conditional approve** (six conditions).
Transcripts: `audit-codex.md`, `audit-fable.md`. Every High is adopted; nothing High is rejected.

| # | Finding (source) | Decision |
|---|---|---|
| D1 | The pending-discovery guard: codex — remove it, it suppresses recovery when the first disconnect was missed; fable — keep it, every case it covers is redundant, never wrong | **Removed.** Both agree a reply in those cases is never wrong and the handshake cannot trigger it (Fact 4); without the guard a dApp that missed the wallet's own disconnect recovers, and the helper loses a dependency. **Ruled on by the fresh final pass: "removal is correct; high confidence"** — no honest first PING or call precedes registration, and a restored approved discovery does not make the old channel usable. Its missed-disconnect case joins the transport test |
| D2 | The named subframe/malformed fence mocks the wrapper away (both, High) | Adopted: `background.transport.test.ts` with the real handler; case table in Phase 2 |
| D3 | The split path escapes the zero-proofs check (codex, High) and can hide a red job behind a green aggregator (fable, High) | Adopted: `_extension-network-e2e.yml` in the change map (prefix match), result loops + nightly named, pin (d) |
| D4 | The passkey fallback reduces coverage without the owner (codex, High); as written it is a silent partial pass under the wrong reason (fable) | Adopted: no fallback. Stage 4 must pass on Firefox or the session stops for the owner |
| D5 | A reload before reconnect masks a broken same-page reconnect (codex, High) | Adopted: no reload; an idle-dApp test added (fable) for the `secure-message` branch |
| D6 | 15 s as a hard assertion has no margin at retry 0 in a required lane (fable); scope it to default heartbeat / booted background (codex) | Adopted: hard ≤ 30 s, measured value recorded, 15 s judged from numbers; criterion 2 rescoped and split per browser |
| D7 | Phase 1 cannot by itself prove the heartbeat wakes Firefox (both) | Adopted: the red run records successor liveness; the Firefox branch is pre-decided |
| D8 | "Prover-ON" must mean `proverless` is not true; pin all four lanes and the exclude lists (fable); assert real execution (codex) | Adopted as pins (a)–(c). Rev 2 answered "real execution" with local passed counts plus `PROVE_SUCCESS > 0` and no new CI assertion — **superseded by D16** |
| D9 | Gates: smoke needs a build; run the whole `bun run test`; cwd and env spelled out; Phase 6 needs lint + seam tests (both) | Adopted |
| D10 | House the SDK pins in the existing `ping-pong.test.ts`; template + `@requires-proverless` for the spec; ban the new driver fact in helpers (fable) | Adopted |
| D11 | Security text: ports come from discovery approval, not key exchange; flood wording; "pure" is wrong for a helper with lookups (both) | Adopted; the helper now takes a boolean |
| D12 | B and C were argued with wrong facts — Chrome restarts at once; C is scope control, not security (codex) | Adopted: both rewritten; A stays (both auditors) |
| D13 | Hidden-tab throttling, custom heartbeat intervals, context invalidation (both) | Adopted as stated limits in the plan, the docs and the closing ledger |
| D14 | 22 minutes: define the measure; sum local times first (fable) | Adopted |

**Final pass on rev 2, fresh codex session, 2026-09-21 — reject** (blocking: the idle-call guarantee contradicts
the untouched relay; a canary can silently stop executing). Every claim verified in the tree; all adopted as
rev 3:

| # | Finding (final pass) | Decision |
|---|---|---|
| D15 | **High.** The relay drops every pre-attach non-discovery message, so on Firefox an idle dApp's first call wakes the background and is discarded; "rejected at once" and the no-heartbeat limit were wrong, and the idle test could pass through a PING | Adopted. The contract is split: *attached* → at once, tested under the heartbeat interval (3 s < 5 s) so only `secure-message` can answer; *cold* → heartbeat-dependent, tested in the seconds budget. The relay stays untouched (the driver's recommendation — the cold-wake fix is pinned and hard-won); the choice against alternative C is **shown to the owner at the approval gate**, not left for the implementer to discover |
| D16 | **High.** `PROVE_SUCCESS` is job-wide; a future `skipIf` on one canary passes every placement pin while another spec supplies the proofs | Adopted: the `Assert canary results` step (vitest's own `json` report → every listed file ran, ≥ 1 passed, 0 skipped), unit-tested script, pin (e), mutation checks, proven on a real report first. Supersedes D8's "no new CI assertion" |
| D17 | **Medium.** A live successor does not prove the heartbeat woke it (the price alarm wakes too); one absent sample does not prove it cannot | Adopted: whole-budget observation, an idle control, the alarm period recorded; the owner stop needs a reproduced absence. The permanent spec asserts the rejection, not the waker |
| D18 | **Medium.** A page *can* choose its session id (it is the discovery `requestId`); **Low:** the frozen canary gate said `1 passed` for a two-test file | Adopted: the security argument rebuilt on approval + browser tab id + port match; chosen-id cases in the transport test; the pre-existing SDK question noted for the closing ledger, not widened into scope. Gate counts corrected for both canaries |

**Re-verdict on rev 3, the same session — conditional approve**, three conditions, each verified in the tree
and adopted as written (rev 4):

| # | Condition | Decision |
|---|---|---|
| D19 | **High.** "≥ 1 passed per file" still accepts a deleted canary, because each canary file's setup-contract test keeps passing | Adopted: the step requires each **named** substantive test `passed` (`canary-expectations.json`), with pins tying the names to the spec sources and to the job lists, and a fixture for exactly that mutation |
| D20 | **Medium.** The popup's locked screen does not imply the content listener is attached — service RPCs go live in `services.start()`, the SDK handler later | Adopted: test 3 waits on `waitForWorkerLiveness` (written after `initWalletSdkHandler`) before starting its 3 s clock; the inference is replaced by Fact 16 |
| D21 | **Medium.** Recording the alarm's period does not control when it fires; two 30 s windows can straddle it | Adopted: both diagnostic kills land wholly before the alarm's first fire, margins logged, overruns repeated; the result is labelled suggestive and **criterion 2 no longer claims what woke Firefox** |

Rejected alternatives: B, C, D, E (above). Unresolved between the auditors: none — D1 is ruled. Codex's
standing verdict: **conditional approve, all three conditions met in rev 4.**

## Post-implementation — the codex loop is the review (`code_review: off`, so `/code-review` is not run)

**Per arc, at the arc boundary, while the arc is the stack tip** (Arc 1 after Phase 3, before `gh stack add`;
Arc 2 after Phase 7):

1. **Codex audit**: `/codex` at `high` (GPT-6 Astra), read-only, **under tmux with the response file
   monitored**, never concurrent with `audit:vue` / `test:all`; the prompt says "do not run the vitest e2e
   configs, builds or workflows". If the default login is out of headroom, `CODEX_ACCOUNT=best` (as this plan's
   own audit had to). Give it the arc's diff, this plan, the ledger, and the arc map ("arc 1 of 2; arc 2 adds the
   canaries and CI lists"). Ask for adversarial review — what an attacker page gains, any path to a false
   disconnect, any presence leak, any drift between the written rule and the workflow lists, any fence that does
   not exercise what it claims — and include verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
     configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code
     works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly does,
     restates its line, references implementation plans / phases / reviews, or spends a paragraph where a
     sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't
     have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few,
     dense, and exact."*
2. **Fix loop**: verify each claim against the tree, apply the accepted fixes, re-run the gates the fix can
   reach, commit, log the round in `lessons/`, **resume the same session** on the fix diff. Converged = a resumed
   pass reporting no new material findings, quoted in lessons. **Hard stop at 3 rounds — put the call to the
   owner**, do not run a fourth alone.
3. After both arcs: one **fresh** codex session over the net diff from `60da5d66`, asking for cross-arc issues
   (seams, duplication, drift from this plan); same loop.
4. **Delivery** — the first time any PR exists.

Dispositions for an unattended session: never idle; a decision normally brought to the owner goes to codex
first and is logged — **except the pre-declared stops, which always go to the owner**; hard limits stay hard —
never merge, never push to `dev`/`main`, never widen scope, never make a red check advisory, never skip or
narrow a test to get green, never author or edit the privileged script body (nor delegate it).

## Delivery

| Arc | Phases | Branch | Stacks on | `/code-review` |
|---|---|---|---|---|
| 1 — fail-fast on background death | 1–3 | `worktree-firefox-arc-closeout` | `dev` | off |
| 2 — canaries on Firefox, pools pinned, closeout | 4–7 | `firefox-arc-closeout-canaries` | arc 1 | off |

`gh stack init --adopt worktree-firefox-arc-closeout`; at the boundary `gh stack add
firefox-arc-closeout-canaries`; at Delivery `gh stack submit --auto --open`, then `gh pr edit` each body
(titles are Conventional Commits ≤ 93 chars; arc 1 `fix(wallet-sdk): …`, arc 2 `test(e2e): …`; each body quotes
the owner's calls, states `UI impact: none`, and ends with the Claude Code line). Watch `quality-status`,
`extension-smoke-e2e-status`, `extension-network-e2e-status` and both Firefox aggregators on **both** PRs; read
the canary job's duration off arc 2's runs and apply the 22-minute rule. A red check is diagnosed first,
re-run once if a genuine flake, fixed if breakage, never made advisory. **Merging is the owner's call**, and
`gh stack merge` lands everything below the named PR.

## Seeds

**Final — the owner approved on 2026-09-21 and chose `/goal`.** Use exactly one per session — setting one
replaces the other. Run inside this worktree (`agent-worktree resume firefox-arc-closeout`). The ELI5 carries
the same two strings.

**Chosen — `/goal`** (every condition is checkable from the transcript):

```
/goal All seven phases marked ✓ in implementations-plan/firefox-arc-closeout/plan.md (the phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript, on BOTH browsers wherever the gate says so, with the stated passed counts and no skip the gate does not name; for each phase `LESSONS_FILE=implementations-plan/firefox-arc-closeout/lessons/phase-N.md` printed; every new pin's mutation check recorded in lessons; `/code-review` NOT run (code_review: off); the codex fix loop converged for arc 1 (after phase 3, before `gh stack add`), for arc 2 (after phase 7) and for the fresh cross-arc pass — each evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript, hard stop at 3 rounds with the call put to the owner; the two stacked PRs exist on GitHub, created only AFTER all loops converged (`gh stack view` in the transcript), with quality-status, extension-smoke-e2e-status, extension-network-e2e-status and both Firefox aggregators green on both; `bun run audit:vue`, `bun run test:ci-gating` and `bun run lint:actions` exit 0. Never merged. The three pre-declared stops in plan.md go to the owner, never to codex. No test, stage or browser skipped or narrowed to get green; no red check made advisory; no timeout raised; `content-message-relay.ts`, the manifest, `apps/tools/**` and `packages/bridge-core/**` untouched; the privileged Firefox script body neither authored nor edited, nor delegated.
```

**Alternative — `/loop`:**

```
/loop 15m Drive implementations-plan/firefox-arc-closeout forward. Never idle waiting for my input. Each firing: (1) read plan.md and lessons/ — they are the state, not the chat; rebuild the task list from plan.md's phase headers if empty; `git status`, `git log --oneline -5`; if PRs exist, `gh stack view`. (2) A detached e2e run in flight? Let it finish — never edit src/**, fixtures or a running spec meanwhile; e2e runs alone on the host, --retry=0, from a detached script + Monitor. (3) No task in hand? Take the next pending step; after each meaningful edit run `bun run lint` and the touched unit tests; commit signed, conventional, small. (4) A decision I'd normally make? Consult /codex at high under tmux (never alongside audit:vue; CODEX_ACCOUNT=best if the login is out of headroom), log the consult and verdict in lessons — EXCEPT the three pre-declared stops in plan.md, which always come to me. (5) Same step failed 5 times? Stop retrying and reassess with codex. (6) Phase green = its validation gate in plan.md passes, both browsers where it says so; paste the result, mark ✓ in plan.md, write lessons, print `LESSONS_FILE=…/lessons/phase-N.md`. After phase 3: arc 1's codex loop to convergence (3-round hard stop → me), THEN `gh stack add firefox-arc-closeout-canaries`. (7) All ✓: arc 2's codex loop, then a FRESH codex pass over the net diff from 60da5d66 for cross-arc issues; only then `gh stack submit --auto --open`, edit both PR bodies, watch the five aggregators on both PRs, apply the 22-minute rule to the canary job. Report and stop. Hard limits: never merge, never push to dev/main, never widen scope, never skip or narrow a test to get green, never make a red check advisory, never raise a timeout, never author, edit or delegate the privileged Firefox script body.
```

ELI5 companion: a private Artifact — https://claude.ai/artifact/Bw9x8GH5F3dn9EvUiqCqny — source `eli5.html`
beside this file (republish that file to update the same URL).
