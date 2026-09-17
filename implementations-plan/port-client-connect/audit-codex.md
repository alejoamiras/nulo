# Codex audit — port-client-connect

## Round 1 — plan v1 (`eead88fd`), GPT-6 Astra, `high`, read-only, session `01a0b06d-1eb7-7421-a378-f4055995b4b4`

Prompt: the standard packet (adversarial / security, assumption attack, implementation critique, test plan) over `plan.md` + `recon.md` + the touched files. Verbatim response:

## A. Adversarial / security

**A1 — High; confidence: high. Immediate logger failures create an unbounded rejection feedback loop.**

`documentLogger().log()` returns an unhandled RPC promise (`apps/extension/src/wallet/services/logger/client.ts:33,42,49`). The popup/onboarding rejection handler logs that rejection through the same logger (`apps/extension/src/wallet/logger/console-forwarding.ts:17–21`). The offscreen handler does likewise; its synchronous `try/catch` cannot catch a rejected promise (`apps/extension/src/offscreen/index.ts:50–68`).

With the proposed readiness throw, a failed logger connection immediately rejects → the global handler logs → another connection immediately rejects → repeat. `DummyLogger` prevents internal synchronous logging recursion; it does **not** prevent this asynchronous feedback. The existing timeout bounds the frequency of this particular feedback path; this change removes that delay.

The contrary claim at `implementations-plan/port-client-connect/plan.md:96–98` is false. Contain logger transport rejections at the document-logger boundary without logging them through that same transport. Attaching a non-throwing rejection handler while returning the original promise preserves explicitly awaited rejection behavior, including S3.

**A2 — Low; confidence: high about the unsupported guarantee; unknown about unverified browser failures. F3 overstates Chrome’s contract.**

`plan.md:226–228` treats “only permanent synchronous failures” as a documented guarantee. Chrome documents a synchronous Port return and asynchronous disconnection when the destination does not exist; it does not promise an exhaustive permanent-only exception taxonomy. A malformed extension ID and a syntactically valid but absent extension are different cases. [Chrome runtime reference](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-connect), [Chromium’s connect implementation](https://chromium.googlesource.com/chromium/src/+/7123808bcdc60787d4363b46787d528adbb7145e/extensions/renderer/api/runtime_hooks_delegate.cc).

I cannot verify a transient **native synchronous throw for this exact valid, same-extension invocation**. Worker sleep is not a verified counterexample. Describe fail-fast as the chosen policy, not a universal browser guarantee. The request becomes terminal; the document/client does not—Phase 1 explicitly permits a later successful open (`plan.md:272`).

## B. Assumption attack

### Facts

**B1 — Low; confidence: high. F10’s proposed correction still describes the wrong error.**

Changing the README’s `PortDisconnectedError` to `RpcDisconnectedError` would leave its in-flight-disconnect claim false (`plan.md:177,244–245`). Disconnect rejects with plain `Error("Client disconnected")`; `RpcDisconnectedError` represents send failure (`packages/extension-messaging/src/core/base-client.ts:331–343`). Both contracts are explicitly tested (`packages/extension-messaging/src/background/client.test.ts:69–86`). Document them separately.

**B2 — Low; confidence: high. Recon miscounts calls and misses another port fake.**

The requested grep yields **27 executable production calls: eight awaited, nineteen floating**. Recon’s 28 includes the prose `.connect()` reference at `apps/extension/src/composables/usePopupEntity.ts:58`; correct `recon.md:25`.

Separately, `apps/extension/src/wallet/services/logger/client.test.ts:36–52` installs another independently implemented, microtask-answering port. The three-consumer migration does not achieve G4’s “exactly one” claim (`plan.md:49`). Either migrate this small helper too or explicitly narrow G4.

### Inferences

**B3 — Low; confidence: high. I1’s evidence is misstated, although successful-open timing need not change.**

Not every awaited connect is immediately followed by a request/subscription:

- `apps/extension/src/popup/pages/activity.vue:157` ends the mount callback.
- `apps/extension/src/popup/windows/json/index.vue:36` is followed by unload-handler registration.
- The incoming/config connections include event-only purposes: `RecentActivityView.vue:761,766` and `PopupManager.vue:260,265`, under their respective component directories.

The other awaited sites are `apps/extension/src/popup/components/popups/NewTokenPopup.vue:184` and `apps/extension/src/stores/app.store.ts:248`.

These callers establish subscriptions through connection side effects. On failure, resolving `connect()` now allows subsequent code to proceed where it previously waited; event-only clients have no guaranteed subsequent request to reopen the port. Narrow I1 to preserving **successful-open** ordering and explicitly accept the changed failed-open behavior.

**B4 — Low; confidence: high. I2 and I3 claim more than their evidence supports.**

I2 should likewise say successful-open timing is unchanged. The current hook returns a readiness promise whenever state is not Connected, including Disconnecting (`packages/extension-messaging/src/background/client.ts:107–109`); the proposal returns void for that state (`plan.md:74,86–87`). I found no production caller proving this reentrant case occurs, so it does not justify retaining Connecting or introducing another mechanism.

I3 references an assertion that does not exist. S3 checks replacement ports, rejection and answers, but **never checks `localDisconnects`** (`apps/extension/src/wallet/services/logger/client.ports.test.ts:187–205`). Its current counter counts local `disconnect()` calls even after remote closure (`:52–55,88–96`). Preserve or document that meaning; do not cite nonexistent coverage.

### Asks

**B5 — High; confidence: high. “None” overlooks the logger containment dependency.**

A1 requires a small production change outside the listed file map (`plan.md:165–179,257–260`). Include that necessary containment and its regression test explicitly. If production logger changes are excluded by the owner’s scope, surface A1 as a blocker rather than silently shipping the feedback loop.

## C. Implementation critique

**C1 — Med; confidence: high. The architecture does not produce its promised request-failure diagnostic.**

`ensureTransportReady()` calls `openPort()` directly; its catch only throws. Logging exists exclusively in public `connect()` (`plan.md:67–87`). Consequently, request-triggered failure logs **zero** connection errors, contradicting G1, the per-request logging claim, and the rationale for deferring terminal telemetry (`plan.md:44–45,96,191–194`).

Log once at the shared open-failure boundary and avoid double logging in `connect()`, with A1 contained first. Also, logging the proposed wrapper loses Chrome’s cause: `trim()` projects an Error to its outer name/message and drops `details.cause` (`apps/extension/src/wallet/logger/utils.ts:169–174,196`). Pass the original cause through the existing error-redaction path if that diagnostic is required.

Keeping `connect()` non-rejecting avoids changing nineteen floating callers. Removing Connecting is appropriate for the synchronous open path. A separate `RpcConnectError` can distinguish opening from send failure; reusing `RpcDisconnectedError` would also inherit existing caller interpretations, including restore’s worker-liveness wait (`apps/extension/src/composables/full-backup-restore.ts:479–491`). Neither a new state nor a new terminal-status mechanism is needed to fix this finding.

**C2 — Med; confidence: high. `closeAll(name)` must close a snapshot, not iterate the live Set.**

Remote close removes a port, invokes its listeners, and those listeners synchronously open a replacement (`apps/extension/src/wallet/services/logger/client.ports.test.ts:66–70,88–91`; `packages/extension-messaging/src/background/client.ts:80–82`). Iterating the live Set directly would visit newly inserted replacements and repeatedly close/reconnect them.

Specify snapshot semantics at `plan.md:127–129`: close only the ports live when the call began. The existing reconnect tests depend on this (`packages/extension-messaging/src/background/client.test.ts:526,548`).

**C3 — Med; confidence: high. The shared fake needs explicit compatibility constraints beyond recording calls.**

At `plan.md:122–143`, require:

- The per-name mock receives the **original envelope as argument zero**, synchronously. `lastRequestId()` and out-of-order correlation inspect that exact shape (`packages/extension-messaging/src/background/client.test.ts:103–107,129–131`).
- `mockImplementationOnce` must control the actual send and prevent answering when it throws; A5 relies on this (`:393–398`).
- Manual mode must never auto-answer. Microtask replies must remain tied to their originating port.
- The `/testing` barrel must not import/re-export the hook-installing harness. Importing that harness from extension setup would register its hook before setup’s own `beforeEach`, reversing the current winning order (`packages/extension-messaging/src/testing/transport-harness.ts:196–211`; `apps/extension/tests/vitest.setup.ts:99–125`).

Name-based `deliver()` broadcasts are compatible with existing single-client helper usage, but cannot independently address two same-name clients whose request IDs collide (`packages/extension-messaging/src/core/base-client.ts:85`). Document that limitation.

Keep `connectServiceClient()` separate as planned: service tests deliberately send malformed requests and inspect Response/Event envelopes; request-only registry validation must not intercept those (`packages/extension-messaging/src/background/service.test.ts:102–107,258–276,285–300`).

## D. Test plan

**D1 — High; confidence: high. The six proposed cases miss A1.**

Add one regression using the real document logger with a throwing connect and the forwarding path. Verify failed logging does not generate additional unhandled logging attempts. Current forwarding tests mock logging with a non-rejecting `vi.fn`, hiding the failure (`apps/extension/src/wallet/logger/console-forwarding.test.ts:6–10,46–57`).

**D2 — Med; confidence: high. Strengthen existing cases rather than multiplying them.**

For Phase 1’s first case (`plan.md:269–270`), assert rejection before advancing timers, zero pending entries, no added timers, and exactly one diagnostic. Advancing five seconds without another connect call does not independently prove “no timer.”

Extend the existing reconnect case with a throwing replacement open: old requests still reject with `"Client disconnected"`, no retry timer remains, and a later request can reopen successfully.

For Phase 2 (`plan.md:281–283`), fold snapshot-close/reconnect into the two-port case, and close a port **after posting but before its queued answer** in the closed-port case. Merely posting to an already closed port does not test suppression of an outstanding answer.

The three Phase 1 cases are distinct. Phase 2’s independence and remote-close cases overlap enough to absorb these checks. Existing A5/correlation tests already cover mock compatibility; existing service tests run under both configurations provide the hook-order gate (`apps/extension/vitest.config.ts:30,42`). No additional generic harness suite is needed.

## E. Verdict

reject (with blocking findings: A1 — immediate logger-RPC rejection creates an unbounded unhandled-rejection feedback loop, and the plan omits containment and regression coverage)
## Round 2 — plan v2 (`e40cce80`), resumed session

Prompt: re-review v2 against every round-1 finding; four targeted checks (A1 closure, C1 closure, test discrimination, self-consistency). Verbatim response:

## A. Adversarial / security

No remaining A1 blocker found. **Confidence: high.** The catch at `plan.md:154` handles the original rejection; its empty callback produces a fulfilled branch. Returning `line` preserves rejection for explicit awaiters, including S3 (`apps/extension/src/wallet/services/logger/client.ports.test.ts:191–196`).

Both handlers discard the logger’s returned promise without creating another rejecting branch (`apps/extension/src/wallet/logger/console-forwarding.ts:21`; `apps/extension/src/offscreen/index.ts:62,65`). Their feedback paths therefore stop. An external awaiter could create its own unhandled rejection, but the handler’s resulting log line is contained.

## B. Assumption attack

- **Low; confidence: high — The permanent-failure guarantee remains elsewhere.** `implementations-plan/port-client-connect/plan.md:20–22,255–256` still asserts all synchronous failures are permanent/no transient case exists, contradicting revised F3 at `:300–305`. Apply the policy wording consistently.

- **Low; confidence: high — The existing deadline is 60 seconds, not 30.** Correct `plan.md:30–31,279–281,464`. `LoggerServiceClient` supplies no timeout override (`apps/extension/src/wallet/services/logger/client.ts:15–16`); its inherited default is `60_000` (`packages/extension-messaging/src/background/client.ts:16,42`). Also avoid presenting a precise loop cadence as measured evidence; this review has only established the feedback path statically.

- **Low; confidence: high — `settled` is not an explicit logger awaiter.** The claim at `plan.md:267` is incorrect. That array contains promises scheduling fake responses, not promises returned by `logger.log()` (`apps/extension/src/wallet/services/logger/client.test.ts:46–50`). S3 supplies the actual rejection-preservation evidence.

- **Low; confidence: high — The reentrancy explanation names the wrong mechanism.** `plan.md:116` says a rejection callback runs inside `disconnect()`. Promise rejection handlers run later. A synchronous overridden `onTerminal` hook could reenter during settlement (`packages/extension-messaging/src/core/base-client.ts:274–275`). Remove the unsupported “only reachable” explanation.

## C. Implementation critique

No remaining C1 defect found for the intended Chrome-error path. **Confidence: high.** `openPort()` logs once before throwing (`plan.md:93–96`); public `connect()` adds no second log (`:81–82`). Folding the cause’s message into the wrapper preserves Chrome’s reason through the name/message projection (`:134`; `apps/extension/src/wallet/logger/utils.ts:169–174`). Original cause identity and stack are discarded, but neither is required by G1.

**Low; confidence: high — Update the existing logger contract comment alongside containment.** The current comment explicitly promises delivery to the unhandled-rejection handler (`apps/extension/src/wallet/services/logger/client.ts:42–43`). The file map currently mentions only adding the catch (`plan.md:235`).

## D. Test plan

The strengthened Phase 1 assertions distinguish the intended implementation from today’s retrying code. The request cannot reject before timer advancement today; the new logging assertion also catches v1’s missing request-path log (`plan.md:359–367`).

The containment test’s **specified ordering matters** (`plan.md:368–372`):

- Today, its first-macrotask checks can pass while the logger request remains pending. The final rejection assertion fails or times out; that alone does not isolate containment.
- With v1’s immediate rejection, leaving the promise unobserved until after the macrotask should fail through Vitest’s unhandled-error reporting.
- With v2, the boundary handles it, and the later explicit await still rejects.

Do not attach the test’s rejection assertion before the macrotask: that would mask missing containment. These are static conclusions; no tests were run.

**Low; confidence: high — Preserve failure injection during Phase 3.** `plan.md:368–369,397` ambiguously replaces the throwing stub with the shared registry, whose `connectStub` always opens a port (`:187–188`). Keep the throwing override after migration; otherwise the test no longer exercises a failed open.

## E. Verdict

approve