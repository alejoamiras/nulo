# dapp-popup-cancel-focus — blueprint light (2 arcs)

```
tier: light
driver: claude-code
code_review: off            # owner answer 2026-09-05: the codex fix loop is the review
eli5_mode: artifact
budget: recon 1 agent (sonnet); codex plan audit at high until explicit approve; codex post-impl loop ≤3 rounds per arc + 1 cross-arc pass
validation: typecheck + lint + vitest unit/component on every phase; no e2e (owner answer 2026-09-05)
recon: recon.md
```

## Summary

Two related gaps in the dApp approval popup (the window the wallet opens when a dApp sends a transaction):

1. **Cancelling the queued transaction from the extension does not close the popup.** The activity feed's
   cancel goes `cancelJob` → journal `queued → cancelled` and stops. The popup stays open, and clicking
   Approve there silently fails after the window closes (the claim helper refuses the cancelled record).
   Arc 1 makes the service worker (SW) react to the journal's `cancelled` transition: it flags the
   interaction, closes the popup, and rejects the dApp's promise with the structured `4001` cancel error
   the mid-prove cancel already produces. Owner decision: close immediately, no overlay.
2. **The popup can open on the wrong display / macOS Space and there is no way to bring it back.** Arc 2
   positions the popup inside the last-focused Chrome window at creation, and makes the "Queued" card in
   the activity feed clickable: a click asks the SW to focus the popup's window.

Arc 2 stacks on arc 1 (both touch `DappInteractionService`'s journal-id lookup and `WindowManager`).

## Assumptions

### Facts (verified)
- F1 The feed's cancel path is `TransactionAwaitingCard` `emit("cancel", jobId)` → `buildCancelHandler`
  (`recent-activity-handlers.ts:105-114`) → `ExecutionService.cancelJob` (`execution/service.ts:487-489`,
  RPC) → `ExecutionLane.cancelJob` (`execution-lane.ts:163-212`): profile-ownership gate, then
  `transitionOperation(jobId, { stage: "cancelled" })`, then abort a registered controller if any. While
  the popup is open the record is still `queued` and NO controller is registered — `acquireSlot`
  (`execution-lane.ts:243-264`) registers the pre-controller only after approval. Nothing on this path
  reaches `DappInteractionService` or `WindowManager`.
- F2 `DappInteractionService.cancelInteraction(cancellationToken)` (`dapp-interaction/service.ts:226-236`)
  has zero callers; every caller of `execute/requestCapabilities/discover` passes `cancellationToken`
  as `undefined` (`packages/wallet-bridge/src/dispatcher.ts:871-884, 926, 974, 1022`), so the token is
  always the interaction's own id (`service.ts:314`). A prior codex audit recorded the gap verbatim
  (`dapp-interaction-lock-fix-v1/audit-codex-post-impl.md:24`).
- F3 The journal record and the live interaction are linked by `hooks.queuedJournalId`: minted at
  message arrival (`wallet-sdk/background.ts:398-453`), threaded via `IExecutionHooks`
  (`services-contract.ts:71-75`), stored on the record (`dapp-interaction/spec.ts:64-81`), and already
  read by `execute()`'s pre-popup short-circuit (`service.ts:254-262`), which only covers a cancel
  that lands BEFORE the popup opens.
- F4 `OperationJournalService.transitionOperation` emits `onOperationUpdated` with the updated record
  under the journal mutex (`operation-journal/service.ts:297-332`). `DappInteractionService.init()`
  already holds `this.operationJournal` (`service.ts:82-89`). SW-service-to-SW-service event wiring in
  `init()` is an established pattern (`execution/service.ts:356-382` `wireCacheInvalidation`).
- F5 `WindowManager.cancel(handleId, reason: string)` → `_settle` rejects the handle promise with the
  bare string and calls `windows.remove` (`window-manager.ts:169-200`); a second settle on the same
  handle is ignored (`:172-176`); the interaction record is deleted in `handle.promise.finally`
  (`service.ts:318-320`). The dApp-facing envelope maps ONLY `Error` subclasses: `JobCancelledError` →
  `{ code: 4001, data: { walletErrorCode: "JOB_CANCELLED", jobId } }` (`error-envelope.ts:31-41`); a
  string falls to `UNCLASSIFIED_ERROR_MESSAGE` (`:132-140`). `JobCancelledError`'s ctor is
  `(message = "Transaction cancelled by user", details?: { jobId?: string })` (`errors.ts:122-128`).
- F6 On an SW-initiated `windows.remove`, the popup's `beforeunload` → `reject()` → `rejectInteraction`
  is a silent no-op once the record is gone (`service.ts:148-155`), and the execute window's `reject()`
  short-circuits when `isInteractionCancelled` is set (`execute/index.vue:472-480`), which the
  `onInteractionCancelled` broadcast + `isInteractionCancelled` replay set (`useDappInteractionPayload.ts:74-100`).
  Frozen oracles pin overlay/no-double-reject, not window closing (`execute/index.test.ts:411,423,528,557`).
- F7 `approveInteraction` refuses with `JobCancelledError` when `cancelledAt` is set, BEFORE claiming
  (`service.ts:97-114`, "first service claim wins"); the popup renders that refusal as the cancelled
  state, not an error banner (`execute/index.vue:417-423`).
- F8 `WindowPort` is `create/onRemoved/remove` only (`packages/wallet-core/src/ports/window-port.ts:12-29`);
  `CreateWindowOptions` has no `left/top`. Real adapter `chrome-browser-api.ts:161-181`; fake
  `fake-browser-api.ts:216-252` (+ `closeByUser`, `reset`). `WindowManager.openAndAwait` is the sole
  creator of approval AND passkey popups (`passkey/service.ts:122-128`), passes only
  `type/url/width/height`, and (dev) closes a window whose handle was lost mid-create (`window-manager.ts:83-97`).
- F9 Popup↔SW RPC methods are declared three times and compiler-checked: `Methods` (`spec.ts:105-120`),
  `defineRpcMethods` (`service.ts:54-60`), `definePassthroughsExhaustive` (`client.ts:23-29`). Ports from
  non-extension senders are refused (`extension-messaging/src/background/service.ts:44-47`), so these
  methods are reachable only from extension pages, never from a dApp or content script.
- F10 Prior art for focusing a window from popup code: `settings/advanced/index.vue:34-42`
  (`chrome.windows.update(id, { focused: true })`). The settled card is clickable via a root `div.row`
  with `cursor: pointer` and `@click.stop` on inner links (`modules/activity/TransactionCard.vue:188-212`);
  the parent binds `@click` on the component (`RecentActivityView.vue:844-853`).
- F11 Real validation commands: root `bun run typecheck` (vue-tsc over apps/extension), `bun run lint`
  (biome), `bun run test` (extension vitest on Bun), `bun run --cwd packages/wallet-core test|typecheck`,
  `bun run audit:vue` (typecheck:all + test + lint in parallel, then build) as the documented pre-PR gate.

### Inferences (unverified — for the audit to attack)
- I1 A `windows.remove` issued by the SW while the popup is mid-`init()` (before its `beforeunload`
  listener is attached) is harmless: the SW has already settled the handle, and the popup's later RPCs
  (`getInteractionPayload`, `rejectInteraction`) fail or no-op against a deleted record without side
  effects. The popup process dies with the window.
- I2 Chrome accepts `chrome.windows.update(id, { focused: true, drawAttention: true, state: "normal" })`
  in one call and, on macOS, switches to the Space holding the window. `drawAttention` is documented as
  taking effect only when the window is NOT focused, so combining it is safe; `state: "normal"` restores
  a minimized popup and is a no-op otherwise. To be confirmed on the owner's machine (Phase 4 lesson).
- I3 Leaving `cancelInteraction(cancellationToken)` and the `cancellationToken` field untouched is the
  right scope call: they are the (unwired) dApp-side cancel channel, not this bug, and removing them is
  churn codex can raise in the post-impl loop if it disagrees.
- I4 Centering the popup on the last-focused NORMAL window (`windowTypes: ["normal"]`) is the right
  anchor: the dApp tab lives in a normal window, and excluding `popup` windows avoids anchoring on
  another approval popup. Chrome clamps out-of-display coordinates, so no display-bounds query is needed.
- I5 A `queued` record is the only stage at which a card click can find a window: the popup closes on
  approve (`execute/index.vue:412`), and `pending+` records have no live interaction. The card is
  therefore clickable at `queued` only; at `queued` before the popup exists (session FIFO wait) the RPC
  returns `false` and the click is a visible no-op — acceptable.

### Asks (resolved 2026-09-05 with the owner)
- A1 Validation layers: fast layers + unit/component tests on every phase; no e2e.
- A2 `/code-review`: off.
- A3 Cancel UX: the popup closes immediately; the dApp gets the structured 4001 cancel. No overlay.
- A4 Arc 2 scope: click-to-refocus AND creation-time positioning.
- A5 Out of scope, declared: the popup's own Reject reaches the dApp as `UNCLASSIFIED_ERROR_MESSAGE`
  today (bare string, F5) although `UserRejectedError` exists unmapped. Unchanged by this plan; a
  one-line follow-up if the owner wants Reject → 4001 parity.

## Architecture & Implementation (compact)

**Reuse / location.** No new files except tests. Arc 1 lives entirely in `WindowManager` (accept an
`Error` as the cancel reason) and `DappInteractionService` (journal subscription + journal-keyed
lookup). Arc 2 extends the `WindowPort` contract in `wallet-core` and both adapters, adds two methods to
`WindowManager`, one RPC to `DappInteractionService`, one emit to `TransactionAwaitingCard`, one pure
handler builder, and one wiring line in `RecentActivityView`.

**Key interfaces.**
```ts
// wallet-core ports/window-port.ts (arc 2)
export interface CreateWindowOptions { type?; url; height?; width?; focused?; left?: number; top?: number }
export interface WindowBounds { left?: number; top?: number; width?: number; height?: number }
export interface UpdateWindowOptions { focused?: boolean; drawAttention?: boolean; state?: "normal" }
export interface WindowPort {
  create(options: CreateWindowOptions): Promise<CreatedWindow>
  onRemoved(listener): Unsubscribe
  remove(windowId: number): Promise<void>
  update(windowId: number, options: UpdateWindowOptions): Promise<void>          // new
  getLastFocused(): Promise<WindowBounds | undefined>                             // new; never throws
}
// window-manager.ts
cancel(handleId: string, reason: string | Error): void                            // arc 1: Error passes through to reject()
focus(handleId: string): Promise<boolean>                                         // arc 2
export function centerIn(anchor: WindowBounds | undefined, width: number, height: number): { left?: number; top?: number }  // arc 2, pure
// dapp-interaction spec.ts Methods (arc 2)
focusInteractionWindow(journalId: string): boolean
```

**Critical flow, arc 1 (cancel while the popup is open).**
1. Feed cancel → `ExecutionLane.cancelJob` → `transitionOperation(jobId, cancelled)` → journal emits
   `onOperationUpdated(record)` (F1, F4).
2. `DappInteractionService.init()` subscribes; on `record.progress.stage === "cancelled"` it calls
   `cancelInteractionForJournal(record.id)`: linear scan of `storage` for `hooks?.queuedJournalId ===
   record.id`; return if none or `cancelledAt` already set; set `cancelledAt` (first-claim-wins, F7);
   `emit("onInteractionCancelled", interaction.id)` (so a still-alive popup short-circuits its own
   reject, F6); `windowManager.cancel(interaction.handleId, new JobCancelledError("Transaction cancelled
   by user", { jobId: record.id }))`.
3. `WindowManager._settle` closes the window and rejects the handle promise with the Error instance →
   `handleSendTx` throws it → the wallet-sdk catch-all maps it to `4001 / JOB_CANCELLED` (F5) → the
   record leaves `storage` via the existing `finally` (F5).
4. Races: approve arriving after step 2 is refused by `cancelledAt` (F7). Approve arriving BEFORE step 2
   has already deleted the record (`service.ts:107`), so the scan finds nothing and the lane's
   controller + claim helper own the cancel (`claim-helper.ts:127-134`) — unchanged behavior.

**Critical flow, arc 2.** (a) `openAndAwait`: `await windows.getLastFocused()` (never throws) →
`centerIn(bounds, width, height)` → `create({ ..., left, top })`; if the handle was settled during the
await (timeout), skip the create. (b) Card click at `queued` → `buildFocusHandler(dappInteractionClient)`
→ RPC `focusInteractionWindow(jobId)` → scan by `hooks.queuedJournalId` → `windowManager.focus(handleId)`
→ `windows.update(windowId, { focused: true, drawAttention: true, state: "normal" })` → `true`; any miss →
`false`, never a throw.

**File-level change map.**
- Arc 1: `apps/extension/src/wallet/services/window-manager/window-manager.ts` (+test);
  `apps/extension/src/wallet/services/dapp-interaction/service.ts` (+test).
- Arc 2: `packages/wallet-core/src/ports/window-port.ts`; `packages/wallet-core/src/testing/fake-browser-api.ts`
  (+test); `apps/extension/src/core/adapters/chrome-browser-api.ts`; `window-manager.ts` (+test);
  `dapp-interaction/{spec,service,client}.ts` (+test); `components/composite/activity/TransactionAwaitingCard.vue`
  (+test); `popup/components/modules/general/recent-activity-handlers.ts` (+test);
  `popup/components/modules/general/RecentActivityView.vue`; `packages/wallet-core/README.md` if it
  enumerates `WindowPort` methods.

**Alternatives not taken.**
- Have `ExecutionLane.cancelJob` call `DappInteractionService` directly: inverts the dependency
  (`DappInteractionService` already depends on `ExecutionService`); the journal event is the existing
  decoupled seam and is emitted under the mutex that serializes cancel against claim.
- Broadcast `onInteractionCancelled` and let the popup close itself (`closeWindow()`): the broadcast is
  lost on a popup that has not subscribed yet, and the dApp promise would still hang until the popup
  acts. SW-side settle is the only path that closes the window AND rejects the promise atomically.
- Keep the string reason and map `"Transaction cancelled by user"` by text in the envelope: the
  envelope's own doc forbids text matching (`error-envelope.ts:125-131`).
- Raw `chrome.windows.*` from the feed for focus: the popup page does not know the approval window's id;
  only the SW's handle map does.

## Security & Adversarial Considerations

- **Threat model.** Two trust boundaries: dApp → SW (wallet-sdk messages via the content relay) and
  extension pages → SW (RPC ports). Neither arc adds a dApp-reachable surface: the journal subscription
  is SW-internal, and `focusInteractionWindow` is an internal RPC refused for non-extension senders (F9).
- **Cancel authority.** Unchanged: `ExecutionLane.cancelJob` gates on the active profile owning the
  record (`execution-lane.ts:174-177`). The new subscriber trusts only records the journal itself
  transitioned; it never accepts an id from a message.
- **Denial-of-approval.** A dApp cannot cancel another dApp's popup: the only cancel path is the user's
  click through the profile-gated RPC. A dApp cannot forge a journal `cancelled` transition.
- **Information exposure.** `focusInteractionWindow` returns a boolean; a guessed 16-hex journal id
  from another extension page would learn only "a popup exists". Window bounds from `getLastFocused`
  carry no page content and never leave the SW. No URLs or payloads are logged by the new code.
- **Wrong-window focus.** `focus(handleId)` acts only on the window id the manager created for that
  handle; `update` on a closed id rejects and is swallowed as `false`.
- **Input validation.** `journalId` is validated as a non-empty string at the RPC boundary (mirroring
  `rejectInteraction`'s id handling); the scan is over ≤ a handful of live records.
- **Supply chain / crypto / least privilege.** No new dependencies, no new permissions (`windows` API
  is already used), no CI/workflow changes, no secrets. N/A for crypto.

## Phases

Every gate runs the fast layers; commands are the repo's own (F11). "Green" = all commands exit 0 AND
the named new tests pass.

### Arc 1 — cancel closes the popup

#### Phase 1 — `WindowManager.cancel` carries an `Error`
- `cancel(handleId, reason: string | Error)`; `Handle.reject: (reason: unknown) => void`; `_settle`
  passes the value through unchanged. Existing string callers unaffected.
- Test (`window-manager.test.ts`): `cancel(handleId, err)` rejects `promise` with that SAME instance and
  still calls `windows.remove`; a string reason still rejects with the string.
- **Validation gate**: `bun run typecheck && bun run lint && bun run --cwd apps/extension test src/wallet/services/window-manager`
  → exit 0, new cases green. Layers: typecheck/lint · unit.

#### Phase 2 — journal-driven cancel in `DappInteractionService`
- `init()`: `this.operationJournal.onOperationUpdated.add((rec) => { if (rec.progress.stage === "cancelled") this.cancelInteractionForJournal(rec.id) })`.
- `cancelInteractionForJournal(journalId)` per the arc-1 flow (set `cancelledAt` → emit → `windowManager.cancel(handleId, new JobCancelledError(..., { jobId }))`). Idempotent.
- Tests (`dapp-interaction/service.test.ts`, existing harness): (1) live interaction with
  `hooks.queuedJournalId = J`, cancelled event for J → `windowManager.cancel` called once with the
  handle id and a `JobCancelledError` whose `details.jobId === J`, `onInteractionCancelled` emitted,
  `cancelledAt` set; (2) event for an unknown id → no calls; (3) record already approved (deleted) →
  no calls; (4) two events → one cancel; (5) approve after the cancelled event throws `JobCancelledError`
  (F7 still holds). Existing `error-envelope.test.ts` already pins `JobCancelledError → 4001`; add no
  duplicate.
- Docs: one sentence in `ARCHITECTURE.md`'s dApp-interaction/cancel description if it narrates the
  cancel path (check; skip if absent). Comments in code: the two invariants only (first-claim-wins order;
  why the Error instance, not a string).
- **Validation gate**: `bun run typecheck && bun run lint && bun run --cwd apps/extension test src/wallet/services/dapp-interaction src/wallet/services/window-manager src/wallet/services/wallet-sdk/error-envelope.test.ts`
  → exit 0. Then the arc gate: `bun run audit:vue` → exit 0. Layers: typecheck/lint · unit.
- **Arc boundary**: run the arc-1 codex loop (Post-implementation §), THEN `gh stack add`.

### Arc 2 — refocus from the Queued card + open on the right display

#### Phase 3 — `WindowPort` grows `update` + `getLastFocused`; `create` accepts `left/top`
- `wallet-core` port types as in the interfaces above; `ChromeWindowsAdapter.update` →
  `chrome.windows.update`; `getLastFocused` → `chrome.windows.getLastFocused({ windowTypes: ["normal"] })`
  wrapped so any throw or a window without bounds → `undefined`. `create` forwards `left/top`.
- `FakeWindowsAdapter`: record `creates: CreateWindowOptions[]` and `updates: Array<{ windowId; options }>`;
  a settable `lastFocused: WindowBounds | undefined`; `update` on a non-live id rejects (mirrors Chrome).
- Test (`fake-browser-api.test.ts`): the fake records `create` options and `update` calls; `update` on a
  closed id rejects.
- **Validation gate**: `bun run --cwd packages/wallet-core typecheck && bun run --cwd packages/wallet-core test && bun run typecheck && bun run lint`
  → exit 0. Layers: typecheck/lint · unit.

#### Phase 4 — `WindowManager` positions on open and can focus a handle
- `centerIn(anchor, width, height)` exported pure helper: `left = anchor.left + (anchor.width - width) / 2`,
  same for `top`, both floored and clamped at 0; `{}` when the anchor or any bound is missing.
- `openAndAwait`: await `getLastFocused()`; if the handle is gone (timeout during the await) return
  without creating; else `create({ ..., ...centerIn(...) })`.
- `focus(handleId)`: handle with a `windowId` → `update(windowId, { focused: true, drawAttention: true, state: "normal" })`
  → `true`; missing handle/window or an `update` rejection → `false`.
- Tests (`window-manager.test.ts`): with `lastFocused` set, `create` receives the centered `left/top`;
  without it, no `left/top`; timeout elapsing during the `getLastFocused` await → no `create` call
  and the promise rejects with the timeout; `focus` → `update` called with the exact options and
  `true`; `focus` on an unknown handle → `false`; `focus` when `update` rejects → `false`. Add `centerIn`
  cases: centered, clamped at 0, missing bounds → `{}`.
- Lesson to record: whether Chrome on the owner's Mac honors `focused + drawAttention + state` in one
  call and switches Space (I2) — owner-verified manually, since focus is not headless-observable.
- **Validation gate**: `bun run typecheck && bun run lint && bun run --cwd apps/extension test src/wallet/services/window-manager`
  → exit 0. Layers: typecheck/lint · unit.

#### Phase 5 — RPC + clickable Queued card
- `spec.ts` `Methods.focusInteractionWindow(journalId: string): boolean`; service implementation = scan by
  `hooks?.queuedJournalId` → `windowManager.focus(handleId)`; add the string to `defineRpcMethods` and
  the client passthrough list (F9).
- `TransactionAwaitingCard.vue`: new prop-free behavior — when `jobId && stage === "queued"`, the root is
  clickable (`cursor: pointer`, `role="button"`, `title="Show the approval window"`, Enter/Space via
  `@keydown`), emitting `("focus", jobId)`; the cancel button gets `@click.stop`. No copy change to the
  "Queued..." subtitle.
- `recent-activity-handlers.ts`: `buildFocusHandler(client: { focusInteractionWindow(id): Promise<boolean> })`
  → `(jobId) => { if (!jobId) return; client.focusInteractionWindow(jobId).catch(() => {}) }`.
- `RecentActivityView.vue`: instantiate `DappInteractionServiceClient` alongside the other clients,
  `@focus="onFocusInFlight"` on the journal-driven `TransactionAwaitingCard` only.
- Tests: card — `queued` + jobId click emits `focus` with the id; `proving` click emits nothing; cancel
  button click emits `cancel` only (no `focus`); handlers — `buildFocusHandler` calls through with the
  id and swallows a rejection, no-ops on a falsy id; service — `focusInteractionWindow` finds by journal
  id and returns the manager's boolean; unknown id → `false`.
- Docs: `packages/wallet-core/README.md` (if it lists `WindowPort` methods) and the extension's
  `ARCHITECTURE.md` popup-lifecycle paragraph get one sentence each.
- **Validation gate**: `bun run typecheck && bun run lint && bun run --cwd apps/extension test src/components/composite/activity src/popup/components/modules/general src/wallet/services/dapp-interaction`
  → exit 0. Then the arc gate: `bun run audit:vue` → exit 0. Layers: typecheck/lint · unit · component.
- **Arc boundary**: arc-2 codex loop, then the cross-arc pass (Post-implementation §).

## Post-implementation (self-contained — the implementing session executes THIS)

1. `/code-review` is **off** for this plan (front matter). Do not run it, on any arc.
2. **Per arc, at its boundary** (after the arc's phases are ✓ and BEFORE `gh stack add` opens the next
   arc): **codex audit** via `~/.claude/skills/codex/scripts/run-codex.sh <prompt> <worktree> high read-only`
   (fresh session, GPT-6 Astra at `high`), given: the ARC's diff (arc 1: `git diff origin/dev...HEAD`;
   arc 2: `git diff worktree-dapp-popup-cancel-focus...HEAD`), this plan.md, recon.md, the arc map
   ("this is arc N of 2; arc 2 builds `focusInteractionWindow` + positioning on arc 1's journal-keyed
   lookup and `cancel(Error)`"), and:
   - the adversarial/security ask: *"What could go wrong? What would an attacker target? What are we
     trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?"*
   - the no-over-engineering rule, verbatim: *"Report bugs and small, targeted improvements only. Do not
     propose speculative abstractions, extra configuration surface, new layers, or rewrites — the
     smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - the comment-quality rule, verbatim: *"Audit the comments for value per character. Flag any comment
     that narrates what the code visibly does, restates its line, references implementation plans /
     phases / reviews, or spends a paragraph where a sentence works — and flag places where a
     non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent
     context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Iterative fix loop**: verify each finding against the repo first (codex misreads), apply accepted
   fixes, commit on the arc branch, log round + verdict in `lessons/post-impl-arc-N.md`, then RESUME the
   same session (`resume-codex.sh <session-id> <followup> <codex-dir> high`) with the fix diff for a
   re-review. Stop when a round yields no new material finding. Still material after 3 rounds → surface
   to the owner.
4. **Final cross-arc integration pass** after arc 2's loop converges: a FRESH codex session over the net
   diff (`git diff origin/dev...HEAD` on the arc-2 branch) + both rules above + the cross-arc ask
   (seams between arcs, duplication across arcs, drift from this plan). Same loop-until-clean; fixes on
   the arc they belong to, then `gh stack sync` to cascade. Log in `lessons/post-impl-cross-arc.md`.
5. **Delivery** (below) — the FIRST time any PR is opened.

## Delivery

Two arcs, two stacked PRs via `gh stack` (installed: `github/gh-stack v0.0.1`). `code_review: off` on both.

| Arc | Phases | Branch | Stacks on |
|---|---|---|---|
| 1 `fix(dapp): cancelling a queued dApp tx closes its approval popup` | 1–2 | `worktree-dapp-popup-cancel-focus` (`gh stack init --adopt worktree-dapp-popup-cancel-focus --base dev`) | `dev` |
| 2 `feat(popup): approval window opens on the active display and refocuses from the Queued card` | 3–5 | `dapp-popup-cancel-focus/focus` (`gh stack add dapp-popup-cancel-focus/focus`) | arc 1 |

PR titles ≤ 93 chars (squash subject + ` (#NN)` must stay ≤ 100). Submit only after step 4 above:
`gh stack sync` (if `dev` moved) → `gh stack submit --auto` → `gh pr edit` each body (summary + test
evidence + the owner's manual focus check for arc 2) → `gh pr checks --watch`. Required gates on `dev`:
`quality-status`, `smoke-e2e-status`, `network-e2e-status`. `gh stack merge` is the owner's call. Then
mark the index entry and suggest `agent-worktree done dapp-popup-cancel-focus`.

## Audit log

_(filled by the codex plan audit)_

## Seeds

_(DRAFT until the approval gate; finalized after)_

ELI5 companion: _(Artifact URL recorded after publish; source `implementations-plan/dapp-popup-cancel-focus/eli5.html`)_

Recommended: `/goal` (completion is transcript-observable).

```
/goal All five phases marked ✓ in implementations-plan/dapp-popup-cancel-focus/plan.md (the phase headers in the file — not the chat), each ✓ backed by its validation gate reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/dapp-popup-cancel-focus/lessons/phase-N.md`; `/code-review` was NOT run (code_review: off); the codex fix loop converged for arc 1 at its boundary (before `gh stack add`), for arc 2 at its boundary, and for the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; a two-PR stack exists on GitHub created only after all three loops converged (`gh stack view` output in the transcript) with `gh pr checks` green on both; `bun run test` and `bun run lint` both report exit 0 in the transcript.
```

Alternative: `/loop 15m` — the blueprint skill's drive template with `<lint>` = `bun run lint`,
`<test>` = `bun run test`, multi-arc close-out per the Post-implementation section above.
