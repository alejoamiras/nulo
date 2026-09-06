# audit-codex — dapp-popup-cancel-focus

Foreign reviewer: Codex (GPT-6 Astra, `high`, read-only). Session `01a072e1-d77c-7200-b8f9-927bcf300e22`.

## Round 1 — prompt

```
I'm the driver (Claude Code) for a blueprint plan in this repo (a Chrome extension wallet for Aztec: Vue + TypeScript, Bun workspaces). You are the foreign reviewer. I want a critical, adversarial audit of the PLAN before implementation starts. Do not validate it — attack it.

Read these first (paths are relative to the cwd you were started in, which is the plan's git worktree on a clean `origin/dev` base):
- `implementations-plan/dapp-popup-cancel-focus/plan.md` — the plan under review
- `implementations-plan/dapp-popup-cancel-focus/recon.md` — the codebase recon it was built on (reuse map + search trails for every absence claim)

Then read the code the plan cites. Key files:
- `apps/extension/src/wallet/services/dapp-interaction/service.ts`, `spec.ts`, `client.ts`, `service.test.ts`
- `apps/extension/src/wallet/services/window-manager/window-manager.ts` (+ `.test.ts`)
- `apps/extension/src/wallet/services/execution/execution-lane.ts` (`cancelJob`, `acquireSlot`), `claim-helper.ts`
- `apps/extension/src/wallet/services/operation-journal/service.ts` (`transitionOperation`, events)
- `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts`, `background.ts` (catch-all around line 925)
- `packages/wallet-bridge/src/dispatcher.ts` (`handleSendTx` ~line 871), `services-contract.ts` (`IExecutionHooks`)
- `packages/wallet-core/src/ports/window-port.ts`, `packages/wallet-core/src/testing/fake-browser-api.ts`, `apps/extension/src/core/adapters/chrome-browser-api.ts`
- `apps/extension/src/composables/useDappApprovalWindow.ts`, `useDappInteractionPayload.ts`, `apps/extension/src/popup/windows/execute/index.vue`
- `apps/extension/src/components/composite/activity/TransactionAwaitingCard.vue` (+ `.test.ts`), `apps/extension/src/popup/components/modules/general/recent-activity-handlers.ts`, `RecentActivityView.vue`
- `packages/extension-messaging/src/errors.ts` (`JobCancelledError`, `UserRejectedError`), `packages/extension-messaging/src/background/service.ts` (sender gate)

## The problem being solved (owner's report)
1. Cancelling a queued dApp transaction from the extension's activity feed ("Queued" card → cancelJob → journal `queued → cancelled`) leaves the dApp approval popup window open. Nothing tells `DappInteractionService`/`WindowManager`. Clicking Approve afterwards closes the popup and the execution fails against the cancelled journal record.
2. On a multi-display / multi-Space Mac the approval popup opens on the wrong display and there is no way to bring it back.

## Owner decisions already made (not up for debate — critique the plan under them)
- Two stacked arcs: arc 1 = cancel closes the popup + rejects the dApp with the structured 4001 `JOB_CANCELLED`; arc 2 = click-to-refocus from the Queued card + position the popup inside the last-focused normal Chrome window at creation.
- Cancel UX: the popup closes immediately (no "cancelled" overlay).
- Validation: typecheck + lint + vitest unit/component tests only; no e2e.
- `/code-review` off; the codex post-impl loop is the review.

## What I want from you — four asks, one packet
1. **Adversarial / security**: What could go wrong? What would an attacker (a hostile dApp, another extension page, a racing second request) target? What are we trusting that we shouldn't? Any least-privilege / supply-chain / permission weaknesses? (Phrase as defending the wallet.)
2. **Assumption attack**: Attack the plan's Assumptions section. Which Facts are misstated (check the cited lines)? Which Inferences (I1–I5) are unsafe? Which Asks were silently assumed instead of surfaced? Return findings under Facts / Inferences / Asks buckets.
3. **Implementation critique**: Critique the Architecture & Implementation. Is the journal-event subscription in `DappInteractionService.init()` the right seam, or is there a simpler / more idiomatic pattern in this codebase? Wrong abstraction or boundary? Do the new `WindowPort` interfaces leak? Does any of it duplicate or ignore what `recon.md` found reusable? What would you build differently, and why? Specifically pressure-test: (a) the race matrix in "Critical flow, arc 1" step 4 (cancel vs approve vs popup `beforeunload`); (b) rejecting the interaction promise with a `JobCancelledError` INSTANCE through `WindowManager.cancel(handleId, string | Error)` versus alternatives; (c) whether `openAndAwait` awaiting `getLastFocused()` before `create` introduces a new timing hazard with the timeout/identity check that dev's `window-manager.ts:83-97` already handles; (d) the card being clickable only at stage `queued`; (e) whether the `focusInteractionWindow` RPC should exist or whether an existing surface already covers it.
4. **Recon check**: does the plan build on the reuse map in `recon.md`, or does it duplicate/ignore something recon found? Are any of recon's absence claims wrong (re-test them: grep yourself)?

Also: the test plan per phase — is it the SMALLEST set that proves the behavior AND the expected failures, or is anything missing/redundant? Are the validation-gate commands real (check `package.json` scripts at root, `apps/extension`, `packages/wallet-core`)?

Be critical. Find problems before you validate anything. If the approach is fundamentally wrong, say so. If it holds, say that — only after genuinely trying to break it.

## Response shape (≤ 900 words)
1. One-line verdict in EXACTLY one of these formats: `approve` | `conditional approve (with conditions: ...)` | `reject (with blocking findings: ...)`.
2. Findings, each tagged `[High|Medium|Low]` and bucketed: Security / Facts / Inferences / Asks / Implementation / Recon / Tests. Cite file:line for every factual claim.
3. "Looks fine" list (brief).
```

## Round 1 — response

reject (with blocking findings: cancellation can escape registration; coordinate clamping defeats multi-display placement)

Confidence: high on code findings; unknown on actual macOS Space switching. Paths below abbreviate `apps/extension/src/` as `ext/` and the reviewed plan directory as `plan/`.

1. **[High] Implementation — cancellation can miss both defenses.** `execute()` reads the journal, then awaits `isConfirmationNeeded()`, then awaits the interaction lock before registering the interaction. A cancellation during those awaits finds no interaction; creation subsequently opens an uncancelled popup. The initial journal check does **not** close this gap (`ext/wallet/services/dapp-interaction/service.ts:254,264,295,321`). Add registration followed by a journal reconciliation, with the subscription covering subsequent transitions; ensure approval cannot bypass reconciliation. Pin cancellation while confirmation checking is parked.

2. **[High] Inferences — I4’s implementation recreates the display bug.** Clamping absolute `left/top` to zero discards valid negative desktop coordinates on monitors left of or above the primary monitor (`plan/plan.md:254`). Preserve signed coordinates. For example, an anchor at `left=-1920,width=1920` with popup width `400` centers at `-1160`, not `0`. Replace the “clamped at zero” test with negative-coordinate cases. An oversized popup also cannot literally fit “inside” a smaller anchor; describe positioning as centering.

3. **[Medium] Facts — F6/F7 overstate cancellation replay guarantees.** The proposed cancellation settles the real handle; its `finally` deletes the interaction (`ext/wallet/services/dapp-interaction/service.ts:323`). A later approval therefore usually encounters `"Invalid id"` at line 107, rather than `JobCancelledError` at line 115; replay returns false after deletion at line 239. Execution still cannot start, but Phase 2’s retained-flag/typed-refusal expectations are misleading with a mocked manager. Specify refusal before cleanup versus missing-record refusal afterward. Do not introduce tombstones merely to preserve an overlay contract the owner discarded.

4. **[Medium] Security — the journal event proves state, not user authorization.** Same-extension sender authentication is real (`packages/extension-messaging/src/core/sender-auth.ts:17`), but `transitionOperation` itself is RPC-exposed and lacks `cancelJob`’s active-profile ownership check (`ext/wallet/services/operation-journal/service.ts:47,297`; `ext/wallet/services/execution/execution-lane.ts:174`). Thus another trusted extension page can trigger cancellation directly; the “only cancel path is the user’s click” claim is false. State the existing broad extension-page trust explicitly. The new focus RPC likewise lacks profile scoping; consider returning false for locked/foreign-profile interactions to defend against stale-page focus stealing.

5. **[Medium] Implementation — preserve both identity fences around the new await.** Keep `openAndAwait()` returning its handle synchronously. After bounds lookup, compare `handles.get(handleId) === handle`, not membership; retain the existing post-create identity check and orphan removal (`ext/wallet/services/window-manager/window-manager.ts:51,90,110`). Cancellation can happen during either lookup or creation. Existing slow-create tests must park **after creation starts**, because they currently advance time immediately after `openAndAwait()` (`window-manager.test.ts:269,302`).

6. **[Medium] Implementation — keyboard and parent wiring are incomplete.** Phase 5 specifies `role="button"` and keydown handling but no `tabindex`; `@click.stop` alone does not stop a cancel button’s Enter/Space keydown bubbling into card focus (`plan/plan.md:274`; `ext/components/composite/activity/TransactionAwaitingCard.vue:82`). Add conditional keyboard focusability, self-targeted activation, and Space default prevention. Wire both journal-card render sites, at `ext/popup/components/modules/general/RecentActivityView.vue:812,871`, and disconnect the new client alongside existing clients at line 779.

7. **[Medium] Tests — substitute behavioral coverage for mock choreography.** The service harness bypasses `init()` and mocks settlement (`ext/wallet/services/dapp-interaction/service.test.ts:45`). Add one initialized-service/real-manager composition test proving journal event → correct window removal → original promise’s structured cancellation → cleanup, with a second interaction unaffected and late `rejectInteraction` harmless. Add the registration-gap regression, keyboard isolation, and Chrome-adapter filtering/failure fallback. Reuse existing string-cancel coverage (`window-manager.test.ts:52`); helper and manager centering tests need not repeat every arithmetic case.

8. **[Low] Asks — distinguish assumptions from owner decisions.** I5 silently accepts dead clicks. Besides pre-popup FIFO waiting, an approved request can remain queued while awaiting execution with its interaction already deleted (`ext/wallet/services/dapp-interaction/service.ts:117`; `ext/wallet/services/execution/execution-lane.ts:278`). Queued-only is a reasonable eligibility rule, not proof a window exists. I2’s combined options are permitted by [Chrome’s API contract](https://developer.chrome.com/docs/extensions/reference/api/windows#method-update), but Space switching is unproven; `state:"normal"` also exits maximized/fullscreen states. Keep that limitation explicit.

9. **[Low] Recon — mostly sound, one false absence.** SW-side window focusing already exists in `ext/wallet/utils/onboarding-tab.ts:36`, contradicting `plan/recon.md:32`. Re-search confirmed no production cancellation-token callers, journal subscriber, or existing journal-to-window focus RPC (`dapp-interaction/service.ts:226`; `spec.ts:105`). Gate scripts exist; root lint additionally checks complexity, and `audit:vue` includes a build beyond the stated validation layers (`package.json:24,38`; `apps/extension/package.json:23`; `packages/wallet-core/package.json:19`).

Looks fine:

- Journal subscription is the appropriate decoupled seam (`operation-journal/service.ts:332`; `execution/service.ts:356`).
- Passing an Error instance through the local handle is appropriate; no serialization boundary intervenes (`dispatcher.ts:871`; `error-envelope.ts:32`).
- Approval-first cancellation already uses cancelled results reconstructed into `JobCancelledError` (`execution/rpc-cancel.ts:69`; `dispatcher.ts:159`).
- The bounded WindowPort extension and new focus RPC fit existing ownership; leaving unused token plumbing untouched is reasonable.

## Round 2 — follow-up prompt (resumed session)

```
Round 2. I revised the plan against all nine of your findings. Re-read `implementations-plan/dapp-popup-cancel-focus/plan.md` (fully rewritten) and the corrected `recon.md` row on window focus, then re-review under the same four asks (adversarial/security, assumption attack, implementation critique, recon check) plus the test plan.

What changed, finding by finding:
1. Registration gap → new "Critical flow, arc 1" step 4 + Phase 2: after `interaction()` registers the record, `execute()` re-reads the journal (only with `hooks.queuedJournalId`); stage ≠ queued → `cancelInteractionForJournal`. Subscription covers cancels after registration; the re-read covers cancels before; the journal mutex orders them. The in-flight `create` then finds its handle settled and dev's fence closes the window it made. Unit regression test (6) added.
2. Clamping → `centerOn` is signed, no clamping; negative-anchor test (`left: -1920, width: 1920` + 400 → `-1160`); wording "centered on", not "inside" (I4 rewritten).
3. F6/F7 → restated: the typed `JobCancelledError` refusal covers only the microtask before the `finally` deletes the record; `"Invalid id"` after. No tombstone (listed under alternatives not taken). Unit test (5) is explicitly the pre-cleanup case with the mocked manager.
4. Security → trust domain restated: any extension page can already `transitionOperation` to `cancelled` (F9 now records `operation-journal/service.ts:47`), the subscriber proves state not user intent; consequence bounded to a denied approval. `focusInteractionWindow` now checks the interaction's `payload.session.profileId` against the active profile → `false` otherwise.
5. Identity fences → arc-2 flow (a) + Phase 4: synchronous return kept; identity compare (`handles.get(handleId) === handle`) after the lookup, existing post-create check + orphan removal untouched; slow-create tests park after creation starts; `flushCreate` gains a tick.
6. Keyboard/parent wiring → Phase 5: `tabindex="0"` + `role="button"` only at `queued`; Enter/Space handled only when `event.target === event.currentTarget`; `preventDefault` on Space; `@click.stop` on the cancel button; both render sites (`:812`, `:871`); client disconnected at `:779-784`. Tests for Enter on the cancel button emitting `cancel` only.
7. Tests → Phase 2 gains a composition test mirroring `execution/service.composition.test.ts:106-157` (real journal on FakeBrowserApi + real WindowManager on the same FakeBrowserApi + `ServiceCollection` of stubs so `init()` wires the subscription for real): two interactions, cancel A → A's window removed, A's `execute()` promise rejects with `JobCancelledError{jobId:A}`, cleanup, B untouched, late `rejectInteraction(A)` harmless. Registration-gap regression and keyboard isolation added. A `ChromeWindowsAdapter` unit test is REJECTED: `core/adapters/` has no harness for `chrome.*` adapters (only `clock-ticker-adapter.test.ts`); the never-throws/filtering contract is pinned at the manager through the fake (`lastFocusedThrows` switch). Tell me if you think that rejection is wrong.
8. I5 → rewritten as owner decision A6 (queued-only eligibility; dead clicks possible pre-popup and post-approve pre-claim), surfaced at the gate. I2 keeps the Space-switching limitation explicit and notes `state:"normal"` exits maximized/fullscreen.
9. Recon → the `onboarding-tab.ts:36` SW-side precedent is now recorded; validation note mentions lint's complexity check and `audit:vue`'s build.

Be as critical as in round 1. Verify the new step-4 reconciliation actually closes the gap you found (walk the interleavings: cancel before `isConfirmationNeeded`, during the lock wait, between `storage.set` and the re-read, after the re-read). Check that the composition test as specified is buildable with the existing harness pieces (`ServiceCollection`, `FakeBrowserApi.windows`, `MockClock`, `OperationJournalService(logger, api)`), and that `DappInteractionService.init()` can be driven through `collection.start()` given its `services.get(...)` list at `service.ts:82-89`.

Response shape (≤ 700 words): one-line verdict in EXACTLY one of `approve` | `conditional approve (with conditions: ...)` | `reject (with blocking findings: ...)`; then findings tagged [High|Medium|Low] and bucketed (Security / Facts / Inferences / Asks / Implementation / Recon / Tests) with file:line; then "looks fine".
```

## Round 2 — response

reject (with blocking findings: post-registration reconciliation still lacks an implementable registration boundary)

Confidence: high. `P` = `implementations-plan/dapp-popup-cancel-focus`; `S` = `apps/extension/src/wallet/services`.

1. **[High] Implementation — `execute()` cannot await registration through the existing interface.** `interaction()` returns the eventual approval/execution result, adopting `pending`; awaiting it waits for settlement, not `storage.set` (`S/dapp-interaction/service.ts:282,321,327`). Calling it without awaiting also does not establish registration because its lock acquisition awaits. Therefore `P/plan.md:187,286` still permits implementing the original gap. Put reconciliation **inside `interaction()` after registration**, or explicitly expose registration separately from settlement. Specify rejection handling while reconciliation runs: cancellation must promptly reject the original caller even if the journal read is delayed; a failed read must not orphan the window.

2. **[Medium] Facts / Inferences — the ordering proof is wrong.** `getOperation()` is explicitly lock-free (`S/operation-journal/service.ts:86,401`); the mutex does not order this read against approval. Nor must storage I/O finish before a popup loads (`P/plan.md:193`). With a correct registration boundary:
   - Cancellation before confirmation checking or during lock acquisition is recovered by reconciliation.
   - Cancellation between registration and reconciliation, or afterward, is caught by the subscription.
   - Approval during reconciliation deletes the interaction before the scan (`S/dapp-interaction/service.ts:117`); `cancelledAt` cannot guard a cancellation not yet observed.

   Remove the speed assumption. Add a deferred-read/approval interleaving proving the existing claim-helper cancellation path preserves the result (`S/execution/claim-helper.ts:127`). A stub that merely returns `cancelled` on its second call does not test these boundaries.

3. **[Medium] Tests — rejecting the adapter test is unjustified.** A fake cannot establish that production passes `windowTypes:["normal"]` or catches Chrome failures. `RealChromeBrowserApi().windows` already exposes the concrete adapter, and the test setup already stubs `chrome` (`apps/extension/src/core/adapters/chrome-browser-api.ts:199`; `apps/extension/tests/vitest.setup.ts:89`). Two small tests can verify filtered lookup and failure/missing-bounds fallback. Replace the fake’s `lastFocusedThrows` machinery with those tests: it contradicts the declared never-throws port contract and tests a different layer (`P/plan.md:318,321`). No new harness abstraction is needed.

4. **[Low] Security — the profile check scopes the target, not the caller.** The claim that a stale profile-A page cannot focus profile B’s popup is too strong: after switching to B, that page can supply B’s journal ID and pass the proposed check (`P/plan.md:249`). Same-extension sender authentication does not bind pages to profiles (`packages/extension-messaging/src/core/sender-auth.ts:17`). Keep the useful target-profile guard, but describe its actual guarantee; no broader authorization redesign is required.

5. **[Low] Recon — the correction is incomplete.** The reuse row is corrected, but `P/recon.md:32` still asserts no SW-side `windows.update`. Re-running the search finds `S/../utils/onboarding-tab.ts:36`. Remove the contradictory absence claim.

**Looks fine**

- **The composition harness is buildable by source inspection.** Register stubs for Profile, Network, Account, DappSession and Execution, plus the real journal and interaction service (`S/dapp-interaction/service.ts:82`). `collection.start()` invokes service initialization (`packages/wallet-core/src/base/index.ts:65`; `packages/extension-messaging/src/core/base-service.ts:64`). Include `getProfiles` for journal creation and `tryGetDappSession` for `execute()`; force confirmation (`S/operation-journal/service.ts:228`; `S/dapp-interaction/service.ts:418,508`). Fake windows and MockClock satisfy the manager’s constructor.
- Signed centering, both identity fences, keyboard isolation, both render sites and client cleanup address the prior findings (`P/plan.md:330,355,363`).
- Journal subscription and Error-instance propagation remain appropriate; no additional architectural layer is warranted.
- Gate commands exist, including complexity checking and the build (`package.json:24,38`; `apps/extension/package.json:22`; `packages/wallet-core/package.json:19`). A6 now states the dead-click tradeoff explicitly (`P/plan.md:139`).

## Round 3 — follow-up prompt (resumed session)

```
Round 3. Re-read `implementations-plan/dapp-popup-cancel-focus/plan.md` and `recon.md`. Changes since round 2, by your finding:

1. [High] Registration boundary → the reconciliation now lives INSIDE `interaction()`, immediately after `storage.set(id, interaction)` and before `return pending`: `void this.reconcileCancelledJournal(journalId)` (only with `hooks?.queuedJournalId`), fire-and-forget, one lock-free `getOperation`, stage ≠ queued → `cancelInteractionForJournal`, a failed read logged and ignored. The caller's `pending` is what rejects promptly (via the settle), never the read. A failed read leaves the window owned by its handle (Reject works; Approve is refused by the claim helper). See F3 (registration boundary fact) and "Critical flow, arc 1" step 4.
2. [Medium] Ordering proof → rewritten on F4 (journal writes storage THEN emits; `getOperation` is lock-free, `operation-journal/service.ts:86-87`): a cancel whose event preceded registration has completed its write, so the post-`storage.set` read sees `cancelled`; a cancel whose write completes after the read started emits after registration, so the subscription's scan finds the record. Mutex and "faster than a click" claims removed. Step 5: Approve during a pending reconciliation deletes the record → scan miss → claim helper refuses (`claim-helper.ts:127-134`, pinned by `claim-helper.test.ts:130-136`). Unit tests (7) deferred-read/approval interleaving and (8) rejecting read added.
3. [Medium] Adapter tests → adopted. `lastFocusedThrows` dropped (the fake honors the never-throws contract). New `apps/extension/src/core/adapters/chrome-browser-api.test.ts` drives `new RealChromeBrowserApi().windows` against the suite's stubbed `chrome` global: `windowTypes:["normal"]` forwarded + bounds returned; throwing / non-numeric bounds → `undefined`; `update` forwards. Phase 3.
4. [Low] Focus RPC → restated as target-scoped (only the active profile's popups can be raised), explicitly NOT caller-bound; no redesign.
5. [Low] recon.md Absences line corrected (`onboarding-tab.ts:36` and `settings/advanced/index.vue:37` are the two `windows.update` hits; neither goes through the port).

NEW SCOPE from the owner between rounds (please review it too): A5 is now IN scope. Phase 1 adds one line in `rejectInteraction` — `this.windowManager.cancel(handleId, new UserRejectedError(reason))` — and one envelope mapping in `wallet-sdk/error-envelope.ts`: `UserRejectedError` → `{ code: 4001, message, data: { walletErrorCode: "USER_REJECTED" } }`, kept distinct from `JOB_CANCELLED` per `errors.ts:116-119`. Tests: envelope case mirroring the `JobCancelledError` one; `rejectInteraction` hands the manager a `UserRejectedError`. I verified nothing SW-side string-matches the reject reason (only the three popup callers and a journal display string) and discovery's catch-all is untyped (`background.ts:672-676`). Attack this: does routing capability/discovery rejections through a typed 4001 change any dApp-visible contract that a test or the wallet-bridge README pins? Is `message` from the popup leak-free enough to pass through (it is wallet-authored: "User rejected")?

Same four asks, same rigor. Walk the interleavings once more against the NEW placement. Then give the verdict in EXACTLY one of: `approve` | `conditional approve (with conditions: ...)` | `reject (with blocking findings: ...)`. ≤ 600 words; findings tagged and bucketed with file:line; then "looks fine".
```

## Round 3 — response

conditional approve (with conditions: run the new Chrome adapter tests in Phase 3’s validation gate)

Confidence: high. `P` = `implementations-plan/dapp-popup-cancel-focus`; `S` = `apps/extension/src/wallet/services`.

- **[Medium] Tests — Phase 3 does not execute its new adapter tests.** The gate runs wallet-core tests, typecheck and lint, while `chrome-browser-api.test.ts` belongs to the extension suite (`P/plan.md:343,349`). Append `bun run --cwd apps/extension test src/core/adapters/chrome-browser-api.test.ts`. The later arc gate would catch failures, but Phase 3 could currently be marked green without testing its production adapter.

- **[Low] Tests — strengthen an existing capability test instead of adding another harness.** Change the rejection fixture to throw a `UserRejectedError` instance and assert that the dispatcher rejects with that same instance, retaining the rejection-persistence assertions (`packages/wallet-bridge/src/dispatcher.test.ts:133`). Its current message-only assertion would miss future loss of the structured error type.

- **[Low] Facts / Recon — two stale references remain.** Recon still calls Reject mapping out of scope (`P/recon.md:13`). The cited `claim-helper.test.ts:130` exercises cancellation during scope refiling; the direct already-cancelled-record regression is at `S/execution/claim-helper.test.ts:250`. These are documentation corrections, not architectural objections.

**Looks fine**

- **The registration gap is now closed for successful reads.** Cancellation before confirmation checking or during the interaction-lock wait is recovered by the post-registration read: an event emitted before registration follows a completed journal write. Cancellation between registration and the read, during the read, or after it is covered by the subscriber (`S/operation-journal/service.ts:331,401`; `P/plan.md:191`). Duplicate observation settles once. Approval winning first deletes the interaction and delegates cancellation to the existing claim path (`S/dapp-interaction/service.ts:117`; `S/execution/claim-helper.ts:127`). No popup-speed assumption remains.
- **Fire-and-forget reconciliation preserves prompt settlement.** A delayed read cannot hold the caller’s result hostage. Ignoring a failed read leaves an owned window and the existing claim-time cancellation check; it does mean automatic closure is best-effort under storage failure, as the plan now acknowledges (`P/plan.md:195`).
- **Capability Reject intentionally changes the wire error, without changing rejection persistence.** The dispatcher persists denied capabilities and rethrows the original error (`packages/wallet-bridge/src/dispatcher.ts:1098`). The README already documents `4001 / USER_REJECTED` (`packages/wallet-bridge/README.md:111`); the existing test asserts rejection and persistence, not a string wire envelope (`dispatcher.test.ts:142`).
- **Discovery does not become a structured 4001 response.** Its catch discards the exception and calls `rejectDiscovery(requestId)` (`S/wallet-sdk/background.ts:673`). The plan correctly leaves this transport unchanged.
- **The message is safe for current callers.** Execute, capabilities and discovery all pass the literal `"User rejected"` (`apps/extension/src/popup/windows/execute/index.vue:478`, `capabilities/index.vue:274`, `discover/index.vue:130`). This supports passing today’s message; it does not make arbitrary future RPC reasons safe automatically.
- Signed centering, identity checks, target-profile scoping and the corrected focus reuse map remain sound. No additional abstraction, permission or dependency is needed.
