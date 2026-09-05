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
