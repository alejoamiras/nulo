# Claude audit — plan v1

Run 2026-09-16 on Opus 5 (1M context): the Fable 5.1 attempt stopped before its first read on this
account's Fable usage limit (HTTP 429), so the blueprint's Opus fallback filled the Claude leg. Read-only;
no tests, builds or e2e run. Verbatim report follows.

---

conditional approve (with conditions: make the local network gate mirror CI's lanes and fix its shard sequencing; add an Ask for the three outer account-client port leaks instead of implying unlock/import port growth is gone; correct the claim that the private constructor covers `.vue` files, or strengthen the guard; make the proof test's S4 and post-reset imports safe)
design pick: lead — it fixes the ownership bug without touching the reconnect state machine every port client shares (`packages/extension-messaging/src/background/client.ts:66-83`), gives each context one replacement port on a service-worker restart, needs nothing from the `onBeforeUnmount` ordering, and costs two test adaptations.

## Findings

1. **Med — the local network gate contradicts A2 and I6.**
   - `NULO_E2E_PROVERLESS=1 bun run e2e:agent --shard=K/3` shards the whole network directory. That includes the six files CI keeps out of its proverless pool (`.github/workflows/pr-extension-network-e2e.yml:169`): three prover-ON canaries and three heavy files CI isolates because of queue pressure.
   - `transfers.test.ts:39` and `frozen-account-canary.test.ts:88` only `skipIf(!hasConfig)`. They don't refuse a proverless build; they run on fake proofs. So "a second red blocks the phase" can block on lanes CI runs differently.
   - "Each shard in its own tmux session" conflicts with "boot at most two sandboxes at once".
   - Fix: append `--exclude tests/e2e/network/<f>.test.ts` for all six (agent.sh forwards its args to vitest, `apps/extension/scripts/e2e/agent.sh:207`). Optionally add a fourth, sequential proverless run of the three heavy files. Start shards 1 and 2, and start shard 3 when one exits.

2. **Med — scope: three outer clients still leak a port on the triggers the plan names.**
   - `apps/extension/src/popup/pages/auth.vue:184` replaces `managers.account` on every password unlock without disconnecting it. `initAccount` has just connected that client (`composables/useProfileBootstrap.ts:103-106`), and `composables/unlockWait.ts:21` shows the wait resolves only after bootstrap finishes.
   - `popup/pages/profile/new-profile-helpers.ts:28` does the same on profile creation.
   - `composables/useFullBackupImport.ts:528` reconnects the accounts-stage client and never closes it; the comment at 526-527 admits this. That contradicts recon's "backup import… all disconnected".
   - The lead design fixes only the logger half of each leak. These are outer clients, so don't widen scope silently.
   - Fix: add Ask A3 (three one-line disconnects: fold in now, or follow up). Keep the PR from claiming unlock/import port growth is solved. The leak is visible in the code but not confirmed at runtime.

3. **Low — the private constructor doesn't guard most SFCs.**
   - `apps/extension/tsconfig.json` sets neither `allowJs` nor `checkJs`. 149 of 191 SFCs have no `lang="ts"`, and `.js` files aren't in `include`.
   - The repo already notes that `.vue` reads aren't compiler-guarded (`utils/core.ts:40-43`).
   - So the plan's "`.vue` files included" (Key interface, F12) is wrong, and it is the stated reason for rejecting recon's scan guard.
   - The realistic regression site, a new `services/*/client.ts`, is TypeScript and is covered.
   - Fix: correct the claim and accept the hole explicitly. Or stop exporting the class as a value (a module-level function plus `export type { LoggerServiceClient }`); Rollup's missing-export error then enforces it in JS SFCs too.
   - Not verified: I did not run typecheck.

4. **Low — proof-test mechanics.** S1/S2 are not vacuous: `connect()` → `logDebug` → the logger's `ensureTransportReady` → `chrome.runtime.connect` all run synchronously (`background/client.ts:52-56,107`). Four things still need care:
   - (a) S4: a log line still unanswered when `remoteClose` fires is rejected by `disconnect()` (`background/client.ts:74`) with no handler. Vitest reports the unhandled rejection and the run exits non-zero. Flush microtasks before the remote close.
   - (b) `vi.resetModules()` also re-evaluates the inlined `@nulo/*` packages (`apps/extension/vitest.config.ts:82-86`). Classes imported statically before the reset won't `instanceof`-match; import every value after the reset. The idiom itself has precedent (`wallet-sdk/content-message-relay.test.ts:15,26`).
   - (c) Deliver answers only to listeners attached at delivery time, and skip closed ports. Otherwise `handleResponse` logs "Invalid response received" (`core/base-client.ts:197`) and adds traffic.
   - (d) The pins are green in phase 1, so save their red output against the phase-2 code in the lessons file before flipping them.

5. **Low — recon errors repeated in the plan.**
   - The service worker has 9 `PxeServiceClient`s, not 8: `token/service.ts:114` (via `pxe/shallow-port.ts:36`) is missing. It is built in `init()`, so it is still not a leak.
   - There is no passkey "double disconnect": `popup/windows/passkey/index.vue:55` is the only `disconnect()`, and there is no hide/show.
   - The side panel (`manifest/manifest.config.ts:31-33`) is another long-lived `popup/index.html` document.

6. **Low — only a test uses `installConsoleForwarding`'s return value.** `popup/index.ts:3` and `onboarding/index.ts:10` ignore it; only `console-forwarding.test.ts:30` reads `.tag`. Return `void` and have the test assert that the mocked `forDocument` received the tag.

## Facts / Inferences / Asks

**Facts**
- F1–F5, F7, F8, F10, F11: verified. F13: not re-checked.
- F6: true, but the count is 9 (finding 5).
- F9 is imprecise. The extension harness throws on any second port with the same name within a test, live or already closed, because its `disconnect` is a bare `vi.fn()` (`tests/vitest.setup.ts:59`). Only the messaging harness frees the slot (`transport-harness.ts:74-78`).
- F12: the include globs are right, but "so the private constructor is enforced" is false for JS SFCs and `.js` files.

**Inferences**
- I1: safe for production builds. It is one Rollup build over four HTML inputs (`vite.config.ts:312-317`), both import paths resolve to one file, and the service worker never reaches it. It does not hold in vite dev/HMR (a re-evaluated module gets a second memo; dev only) or in tests (the memo lasts across every test in a file). The plan should say both.
- I2: verified. No subclass reads `this.logger`, nothing reaches into a client's logger, and `IProfileReader` has no `disconnect` (`aztec-runtime/src/pxe/service.ts:69-74`).
- I3: plausible; each message is handled independently, so one port adds no head-of-line blocking. Not verified.
- I4: holds. Add that the shared logger keeps the first test's stale fake port for the rest of that file. No existing test captures `logger` traffic or counts `runtime.connect` calls (grep).
- I5: not verified.
- I6: false (finding 1).

**Asks**
- A1: agree.
- A2: agree, but the command has to implement it (finding 1).
- Add A3: the outer account-client leaks (finding 2).
- Add A4: accept the SFC hole in the constructor guard, or stop exporting the class value (finding 3).

## Adversarial answers
- **Disconnecting or poisoning the shared logger:** no production path reaches the instance (grep: no `.logger.disconnect`, no casts). The test's `request` patch (`logger/client.test.ts:19`) stays inside its own file under vitest's default per-file isolation. If the extension context is invalidated, `connect()` keeps retrying and every log line starts an unbounded `waitForConnection` poll (`background/client.ts:112-119`). That already happens today; the lead design turns N retry loops into one.
- **Service-worker reachability:** the only `runtime.connect` call is `background/client.ts:52`. Service-worker code imports the 20 client modules only with `import type` (`execution/fee/embedded-fpc-cap.ts:69`, `utils/create-passkey-profile.ts:3`), and `wallet/logger/index.ts` doesn't re-export console-forwarding.
- **Two memos in one document:** only in dev/HMR and in tests (I1).
- **Redaction and sender gate:** unchanged. `trim()` still runs inside the same `log()` before `request()` → `jsonSanitize`. `isTrustedInternalSender` still checks each port, from the same document URL. No new permission or message type.

## Looks fine
- The lead design's lazily created memo avoids temporal-dead-zone errors in import cycles. Keeping `DummyLogger` as the base logger still prevents logging recursion, and `packages/extension-messaging` needs no change.
- The critique of the competing outline is accurate: the async tail after `disconnect()`, three loggers left in the offscreen document, and the pinned `client.test.ts:511-556`.
- The offscreen document ends with 2 logger ports; each action window and the side panel with at most 2.
- The service worker's PXE clients are one per worker (`base-service.ts:64-67`; a failed boot is not retried, `wallet-core/src/base/index.ts:82-89`).
- The smoke command matches `_extension-smoke-e2e.yml:69-105`. The phase 1–2 gate commands exist (`package.json:13,17,26,32,33`). The PR title is 78 characters.
- One memo per context (two ports) instead of one port with a per-call context is a sound trade-off; the other option saves only one port per document.

---

# Claude review — plan v3 (round 2)

Run 2026-09-17 on Fable 5.1 (the model the round-1 seat was meant for), at the owner's request
("review this plan that was done by Opus, and chime in with your own opinion"). Read-only; the load-
bearing claims re-verified against the code. Verbatim report follows; its four changes are applied
as plan v4 (D26–D29).

---

**Verdict: conditional approve on Phases 1–3; cut Phase 4 to smoke + CI.** The design is right and
the change is small; the plan is about three times heavier than the diff, and nearly all of that
weight sits in Phase 4.

**What's right (verified against the code)**

- Document-scoped sharing is the correct ownership fix. `ServiceClient.disconnect()`
  (`packages/extension-messaging/src/background/client.ts:66-78`) closes its own port and then logs
  through the logger it never closes, so any per-client fix has to reach into the reconnect state
  machine. Sharing sidesteps it.
- Unexported class over private constructor: correct, because 149 SFCs are untyped.
- The setup-file silent logger is better justified than the plan says. The global port stub
  (`apps/extension/tests/vitest.setup.ts:50-86`) **throws on a second port with the same name**,
  and `connect()` catches that and loops `sleep(1000)` forever in `Connecting`. So today any unit
  test that connects two clients leaves a permanent 1 s retry loop running for the rest of the
  file. The mock fixes a pre-existing wart, not just the new stale-singleton risk. Worth stating in
  the PR body.
- A3 fold-in with `??=`: agree. Disconnect-then-replace would reject the network-switch handler's
  in-flight calls (`apps/extension/src/popup/network-switch.ts:66-73`).

**What I'd change, ranked**

1. **Phase 4 (high confidence).** CI's required gate runs the identical 7-workload partition at
   retry 0 on the PR. Reproducing it locally with two lanes, a sibling worktree, three shell
   scripts, SIGKILL escalation and a baseline-worktree classification tree is ~120 lines of the
   plan's most fragile procedure, for a change that touches no network, PXE or dApp path. The
   owner's own directives cut both ways here: "prefer CI over exhaustive local runs" and "network
   e2e runs alone; concurrent host load mass-fails it" — the latter is exactly codex's D18
   objection, and codex is right on the merits. Recommendation: smoke locally (it drives the real
   popup's logger in a real Chrome — that's the meaningful local check), push, let CI decide. If a
   local network pass is wanted anyway: one sequential pool run (5 shards back to back, CI's
   excludes, no lane B, no baseline worktree, heavy/concurrent left to CI). That dissolves D18 and
   halves the plan. The owner chose "local network e2e with shards" at Phase 0; this asks them to
   reconsider that answer.
2. **One port per document, not one per context (moderate).** `ILogger` is a single method
   (`packages/wallet-core/src/logger/interfaces.ts:30`). One shared client plus three-line
   context-bound views removes the `Map`, the `DocumentLogContext | undefined` key and half of S4,
   and codex round 1 suggested exactly this. Not a blocker — two ports vs one is marginal — but it
   is the simpler shape.
3. **Drop the pin-then-flip dance in Phases 1–2 (low stakes).** `(BUG PIN)` is the repo's
   convention for bugs *preserved* across a PR. Writing pins at 5/50 only to flip them in the next
   phase is test churn; the red output in `lessons/phase-1.md` already proves the leak. Write the
   fixed assertions, watch them fail, fix, done.
4. **The proof test's fake port is a third hand-rolled harness.**
   `packages/extension-messaging/src/testing/transport-harness.ts` already has per-service port
   mocking with disconnect-frees-the-slot semantics. It lacks counting and auto-answer, so it can't
   be used as-is, but the plan's A1 follow-up ("one shared fake-port harness") is now a three-way
   duplication. Either extend the messaging harness with counting now, or accept the third copy
   explicitly in the ledger.

**Severity check, so the effort is calibrated:** the leak is bounded by document lifetime, so it
only accumulates in long-lived documents — the side panel and onboarding tab across profile
switches, unlocks and imports. Popups die and Chrome closes their ports. Real, worth fixing, not
urgent — another reason the validation should lean on CI rather than a half-day of local
orchestration.

---

**Applied as v4.** On item 4, a second look showed both existing doubles are single-slot-per-service
by contract (a second same-name port throws — the exact opposite of what a leak proof must count),
so extending either would change what their transport suites rely on; the third double is accepted
explicitly instead (D29) and A1's consolidation follow-up now covers three. Item 1 became D26 with
Ask A5; items 2 and 3 became D27 and D28.
