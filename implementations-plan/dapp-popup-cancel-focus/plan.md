# dapp-popup-cancel-focus — blueprint light (2 arcs)

```
tier: light
driver: claude-code
code_review: off            # owner answer 2026-09-05: the codex fix loop is the review
eli5_mode: artifact
budget: recon 1 agent (sonnet); codex plan audit at high until explicit approve; codex post-impl loop ≤3 rounds per arc + 1 cross-arc pass
validation: typecheck + lint + vitest unit/component/composition on every phase; no e2e (owner answer 2026-09-05)
recon: recon.md
approval: owner approved 2026-09-05 (unconditional, after codex r3 conditional approve); seeds final
```

## Summary

Two related gaps in the dApp approval popup (the window the wallet opens when a dApp sends a transaction):

1. **Cancelling the queued transaction from the extension does not close the popup.** The activity feed's
   cancel goes `cancelJob` → journal `queued → cancelled` and stops. The popup stays open, and clicking
   Approve there silently fails after the window closes (the claim helper refuses the cancelled record).
   Arc 1 makes the service worker (SW) react to the journal's `cancelled` transition: it flags the
   interaction, closes the popup, and rejects the dApp's promise with the structured `4001` cancel error
   the mid-prove cancel already produces. A journal re-read right after the interaction is registered
   closes the window in which a cancel lands before the subscription can see the interaction. Owner
   decision: close immediately, no overlay. Owner addition (2026-09-05): the popup's own Reject also
   reaches the dApp structured — `UserRejectedError` → `4001 / USER_REJECTED` — instead of the
   unclassified string it collapses to today.
2. **The popup can open on the wrong display / macOS Space and there is no way to bring it back.** Arc 2
   centers the popup on the last-focused normal Chrome window at creation (signed desktop coordinates
   preserved, so displays left of or above the primary work), and makes the "Queued" card in the
   activity feed clickable: a click asks the SW to focus the popup's window.

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
  read by `execute()`'s pre-popup short-circuit (`service.ts:254-262`). That read happens BEFORE two
  awaits (`isConfirmationNeeded`, `service.ts:264`; the interaction lock, `:295`) and the `storage.set`
  at `:321` — a cancel landing in that span is seen by neither the short-circuit nor a subscriber.
  `interaction()` exposes no registration boundary: it returns `pending`, which settles with the popup
  outcome (`:282, :323-327`), so `execute()` cannot act "after registration" — only `interaction()` can.
- F4 `OperationJournalService.transitionOperation` takes the transition lock, WRITES storage, THEN emits
  `onOperationUpdated` with the updated record (`operation-journal/service.ts:297-332`); `getOperation`
  is deliberately lock-free (`:86-87`), so a read is ordered against a transition only by storage
  linearizability (write complete → visible), never by the mutex. `DappInteractionService.init()`
  already holds `this.operationJournal` (`service.ts:82-89`). SW-service-to-SW-service event wiring in
  `init()` is an established pattern (`execution/service.ts:356-382` `wireCacheInvalidation`).
- F5 `WindowManager.cancel(handleId, reason: string)` → `_settle` rejects the handle promise with the
  bare string and calls `windows.remove` (`window-manager.ts:169-200`); a second settle on the same
  handle is ignored (`:172-176`); the interaction record is deleted in `handle.promise.finally`
  (`service.ts:323`), i.e. one microtask after the rejection. The dApp-facing envelope maps ONLY `Error`
  subclasses: `JobCancelledError` → `{ code: 4001, data: { walletErrorCode: "JOB_CANCELLED", jobId } }`
  (`error-envelope.ts:31-41`); a string falls to `UNCLASSIFIED_ERROR_MESSAGE` (`:132-140`).
  `JobCancelledError`'s ctor is `(message = "Transaction cancelled by user", details?: { jobId?: string })`
  (`errors.ts:122-128`). No serialization boundary sits between the handle promise and the wallet-sdk
  catch-all (`dispatcher.ts:871` → `background.ts:925-934`), so the instance survives.
- F6 On an SW-initiated `windows.remove`, the popup's `beforeunload` → `reject()` → `rejectInteraction`
  is a silent no-op once the record is gone (`service.ts:148-155`), and the execute window's `reject()`
  short-circuits when `isInteractionCancelled` is set (`execute/index.vue:472-480`). Frozen oracles pin
  overlay/no-double-reject, not window closing (`execute/index.test.ts:411,423,528,557`).
- F7 `approveInteraction` refuses with `JobCancelledError` when `cancelledAt` is set (`service.ts:107-115`)
  and with `"Invalid id"` when the record is gone (`:105-107`); both refuse BEFORE claiming, so
  execution never starts either way. After the new cancel settles the handle, the record is gone one
  microtask later (F5), so the typed refusal covers only that microtask; the untyped one covers the rest.
  The popup renders the typed refusal as the cancelled state (`execute/index.vue:417-423`) — moot once
  the window is being removed.
- F8 `WindowPort` is `create/onRemoved/remove` only (`packages/wallet-core/src/ports/window-port.ts:12-29`);
  `CreateWindowOptions` has no `left/top`. Real adapter `chrome-browser-api.ts:161-181`; fake
  `fake-browser-api.ts:216-252` (+ `closeByUser`, `reset`). `WindowManager.openAndAwait` returns its
  handle SYNCHRONOUSLY and chains `create` fire-and-forget (`window-manager.ts:51-120`); it is the sole
  creator of approval AND passkey popups (`passkey/service.ts:122-128`), passes only
  `type/url/width/height`, and (dev) compares handle IDENTITY after create and closes a window whose
  handle was lost mid-create (`:83-97, :110-114`). The slow-create tests advance the clock immediately
  after `openAndAwait()` (`window-manager.test.ts:269, 302`).
- F9 Popup↔SW RPC methods are declared three times and compiler-checked: `Methods` (`spec.ts:105-120`),
  `defineRpcMethods` (`service.ts:54-60`), `definePassthroughsExhaustive` (`client.ts:23-29`). Ports from
  non-extension senders are refused (`extension-messaging/src/background/service.ts:44-47`,
  `core/sender-auth.ts:17`): these methods are reachable from ANY page of this extension, never from a
  dApp or content script. `OperationJournalService.transitionOperation` is itself RPC-exposed
  (`operation-journal/service.ts:47`) with no profile check — an extension page can already move a
  record to `cancelled` directly; only `cancelJob` carries the profile gate (`execution-lane.ts:174-177`).
- F10 SW-side prior art for focusing a window: `wallet/utils/onboarding-tab.ts:32-38`
  (`chrome.windows.update(tab.windowId, { focused: true })`); popup-side: `settings/advanced/index.vue:34-42`.
  The settled card is clickable via a root `div.row` with `cursor: pointer` and `@click.stop` on inner
  links (`modules/activity/TransactionCard.vue:188-212`); the parent binds `@click` on the component.
  `RecentActivityView.vue` renders the journal-driven `TransactionAwaitingCard` at TWO sites (`:812`,
  `:871`) and disconnects its service clients in `onBeforeUnmount` (`:779-784`).
- F11 Real validation commands: root `bun run typecheck` (vue-tsc over apps/extension), `bun run lint`
  (biome + the complexity-baseline check), `bun run test` (extension vitest on Bun),
  `bun run --cwd packages/wallet-core test|typecheck`, `bun run audit:vue` (typecheck:all + test + lint
  in parallel, THEN `build`) as the documented pre-PR gate. A composition harness with a REAL
  `OperationJournalService` on `FakeBrowserApi` + a `ServiceCollection` of stubs exists
  (`execution/service.composition.test.ts:106-157`).

### Inferences (unverified — for the audit to attack)
- I1 A `windows.remove` issued by the SW while the popup is mid-`init()` (before its `beforeunload`
  listener is attached) is harmless: the SW has already settled the handle, and the popup's later RPCs
  (`getInteractionPayload`, `rejectInteraction`) fail or no-op against a deleted record without side
  effects. The popup process dies with the window.
- I2 Chrome accepts `chrome.windows.update(id, { focused: true, drawAttention: true, state: "normal" })`
  in one call (the API contract allows the combination); whether macOS then switches to the Space
  holding the window is UNPROVEN and owner-verified in Phase 4. `state: "normal"` restores a minimized
  popup and also exits a maximized/fullscreen one — acceptable for a 400×800 approval popup.
- I3 Leaving `cancelInteraction(cancellationToken)` and the `cancellationToken` field untouched is the
  right scope call: they are the (unwired) dApp-side cancel channel, not this bug.
- I4 Centering the popup on the last-focused NORMAL window (`windowTypes: ["normal"]`) is the right
  anchor: the dApp tab lives in a normal window, and excluding `popup` windows avoids anchoring on
  another approval popup. Desktop coordinates are SIGNED (a display left of or above the primary has
  negative `left`/`top`); the centering math must preserve the sign, never clamp. A popup larger than
  the anchor is centered on it, not fitted inside it. Chrome clamps to the display it lands on.
- I5 A `windows.remove` racing a `windows.update` (focus) on the same id: `update` rejects, `focus`
  returns `false`. No further hazard.

### Asks (resolved 2026-09-05 with the owner)
- A1 Validation layers: fast layers + unit/component/composition tests on every phase; no e2e.
- A2 `/code-review`: off.
- A3 Cancel UX: the popup closes immediately; the dApp gets the structured 4001 cancel. No overlay.
- A4 Arc 2 scope: click-to-refocus AND creation-time positioning.
- A5 IN SCOPE (owner, 2026-09-05: "let's do the one-line follow-up here too"): the popup's Reject
  reaches the dApp as `UNCLASSIFIED_ERROR_MESSAGE` today (bare string, F5). Phase 1 makes
  `rejectInteraction` reject with a `UserRejectedError` (`errors.ts:100-104`, CODE `USER_REJECTED`,
  already used popup-side for auth/export/import flows) and maps it in the envelope to
  `{ code: 4001, data: { walletErrorCode: "USER_REJECTED" } }` — distinct from `JOB_CANCELLED` for
  telemetry, as `errors.ts:116-119` documents; the wallet-bridge README's dApp recipe keys on
  `code === 4001`. Nothing SW-side string-matches the reject reason (searched `"User rejected"`: only
  the three popup callers and a journal display string). Discovery's catch-all is untyped
  (`background.ts:672-676`) and unaffected.
- A6 Card eligibility rule (decision, surfaced at the gate): the Queued card is clickable at stage
  `queued` only. A `queued` record does NOT prove a window exists — none in the pre-popup session-FIFO
  wait, and none after Approve while the request waits for the execution mutex (`service.ts:117`,
  `execution-lane.ts:278`). Those clicks return `false` and are visible no-ops. The alternative (a
  journal flag "popup open") adds a write on every popup open/close for a cosmetic gain; not taken.

## Architecture & Implementation (compact)

**Reuse / location.** No new files except tests. Arc 1 lives in `WindowManager` (accept an `Error` as
the cancel reason), `DappInteractionService` (journal subscription + a reconciliation read inside `interaction()` right
after registration + journal-keyed lookup; `rejectInteraction` wraps its reason in `UserRejectedError`) and the wallet-sdk
error envelope (one new mapping). Arc 2 extends the `WindowPort` contract in `wallet-core` and both
adapters, adds two methods to `WindowManager`, one RPC to `DappInteractionService`, one emit to
`TransactionAwaitingCard`, one pure handler builder, and the wiring in `RecentActivityView`.

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
  update(windowId: number, options: UpdateWindowOptions): Promise<void>          // new; rejects on a closed id
  getLastFocused(): Promise<WindowBounds | undefined>                             // new; never throws
}
// window-manager.ts
cancel(handleId: string, reason: string | Error): void                            // arc 1: the value reaches reject() unchanged
focus(handleId: string): Promise<boolean>                                         // arc 2
export function centerOn(anchor: WindowBounds | undefined, width: number, height: number): { left?: number; top?: number }  // arc 2, pure, signed
// dapp-interaction spec.ts Methods (arc 2)
focusInteractionWindow(journalId: string): boolean
```

**Critical flow, arc 1 (cancel while the popup is open).**
1. Feed cancel → `ExecutionLane.cancelJob` → `transitionOperation(jobId, cancelled)` → journal emits
   `onOperationUpdated(record)` (F1, F4).
2. `DappInteractionService.init()` subscribes; on `record.progress.stage === "cancelled"` it calls
   `cancelInteractionForJournal(record.id)`: linear scan of `storage` for `hooks?.queuedJournalId ===
   record.id`; return if none or `cancelledAt` already set; set `cancelledAt`;
   `emit("onInteractionCancelled", interaction.id)` (a still-alive popup short-circuits its own reject,
   F6); `windowManager.cancel(interaction.handleId, new JobCancelledError("Transaction cancelled by
   user", { jobId: record.id }))`.
3. `WindowManager._settle` closes the window and rejects the handle promise with the Error instance →
   `handleSendTx` throws it → the wallet-sdk catch-all maps it to `4001 / JOB_CANCELLED` (F5) → the
   record leaves `storage` via the existing `finally` one microtask later (F5).
4. **Registration gap (codex r1 High, r2 High).** `interaction()` registers the record after two awaits
   and exposes no registration boundary (F3), so the reconciliation lives INSIDE `interaction()`:
   immediately after `storage.set(id, interaction)` (still within `withLock`, or right after it — before
   `return pending`), and only when `hooks?.queuedJournalId` is set, it fires
   `void this.reconcileCancelledJournal(journalId)`: one lock-free `getOperation`; stage ≠ `queued` →
   `cancelInteractionForJournal(journalId)`; a failed read is logged and ignored. Fire-and-forget: the
   caller's `pending` is what rejects, promptly, through the settle — never the read. Ordering (no mutex
   involved, F4): the journal writes before it emits, and the reconciliation read starts after
   `storage.set`. A cancel whose event fired BEFORE registration has completed its write, so the read
   sees `cancelled`. A cancel whose write completes AFTER the read started emits after registration,
   so the subscription's scan finds the record. Either way exactly one path cancels; the other is an
   idempotent miss. The in-flight `create` then finds its handle settled and closes the window it made
   (F8, dev's fence). A failed reconciliation read does not orphan the window: the handle still owns
   it, Reject works, and an Approve is refused by the claim helper (step 5).
5. Races: Approve arriving after step 2 is refused (`cancelledAt` for one microtask, then `"Invalid
   id"`; F7). Approve arriving BEFORE step 2 — including DURING a still-pending reconciliation read —
   has already deleted the record (`service.ts:107`), so the scan finds nothing and the lane's
   controller + claim helper own the cancel (`claim-helper.ts:127-134`, pinned by
   `claim-helper.test.ts:250-258`, the already-cancelled-record case) — unchanged behavior; `cancelledAt` cannot guard a cancel not yet
   observed and is not asked to. A second `cancelled` event is a no-op (record gone or `cancelledAt`
   set). The popup's own `beforeunload` reject is a no-op (F6).

**Critical flow, arc 2.** (a) `openAndAwait` keeps returning `{ handleId, promise }` synchronously; the
async chain becomes `getLastFocused()` (never throws) → identity check `handles.get(handleId) === handle`
(a timeout during the lookup → skip `create`) → `create({ ..., ...centerOn(bounds, width, height) })` →
the EXISTING post-create identity check + orphan removal. (b) Card click at `queued` →
`buildFocusHandler(dappInteractionClient)` → RPC `focusInteractionWindow(jobId)` → scan by
`hooks.queuedJournalId` → the interaction's `payload.session.profileId` must equal the active profile
(else `false`; mirrors `cancelJob`'s gate) → `windowManager.focus(handleId)` →
`windows.update(windowId, { focused: true, drawAttention: true, state: "normal" })` → `true`; any miss or
rejection → `false`, never a throw.

**File-level change map.**
- Arc 1: `apps/extension/src/wallet/services/window-manager/window-manager.ts` (+test);
  `apps/extension/src/wallet/services/dapp-interaction/service.ts` (+unit test, +composition test);
  `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts` (+test).
- Arc 2: `packages/wallet-core/src/ports/window-port.ts`; `packages/wallet-core/src/testing/fake-browser-api.ts`
  (+test); `apps/extension/src/core/adapters/chrome-browser-api.ts`; `window-manager.ts` (+test);
  `dapp-interaction/{spec,service,client}.ts` (+test); `components/composite/activity/TransactionAwaitingCard.vue`
  (+test); `popup/components/modules/general/recent-activity-handlers.ts` (+test);
  `popup/components/modules/general/RecentActivityView.vue` (both render sites + client disconnect);
  `packages/wallet-core/README.md` if it enumerates `WindowPort` methods.

**Alternatives not taken.**
- Have `ExecutionLane.cancelJob` call `DappInteractionService` directly: inverts the dependency
  (`DappInteractionService` already depends on `ExecutionService`); the journal event is the existing
  decoupled seam and is emitted under the mutex that serializes cancel against claim.
- Broadcast `onInteractionCancelled` and let the popup close itself (`closeWindow()`): the broadcast is
  lost on a popup that has not subscribed yet, and the dApp promise would still hang until the popup
  acts. SW-side settle is the only path that closes the window AND rejects the promise atomically.
- Keep the string reason and map `"Transaction cancelled by user"` by text in the envelope: the
  envelope's own doc forbids text matching (`error-envelope.ts:125-131`).
- A tombstone keeping the record (with `cancelledAt`) alive after settle so a late Approve gets the
  typed refusal: preserves an overlay contract the owner discarded; `"Invalid id"` refuses just as hard.
- Raw `chrome.windows.*` from the feed for focus: the popup page does not know the approval window's id;
  only the SW's handle map does.

## Security & Adversarial Considerations

- **Trust boundaries.** dApp → SW (wallet-sdk messages via the content relay) and extension pages → SW
  (RPC ports, same-extension sender only, F9). Neither arc adds a dApp-reachable surface: the journal
  subscription is SW-internal, and `focusInteractionWindow` is an internal RPC.
- **What an extension page can already do.** Any page of this extension can call
  `transitionOperation` (F9) and move a record to `cancelled` without `cancelJob`'s profile gate. The
  new subscriber therefore fires on any `cancelled` transition an extension page produces, not only on
  the user's click — that is the EXISTING extension-page trust domain, stated here explicitly, not a
  new grant. The consequence of an abuse is a closed popup and a 4001 to the dApp: a denial of one
  approval, never an execution. Tightening `transitionOperation` is out of scope.
- **Cross-dApp.** A dApp cannot cancel another dApp's popup (no dApp-reachable path) and cannot forge a
  journal transition.
- **Focus RPC scoping.** `focusInteractionWindow` returns `false` unless the interaction's session
  profile is the active profile. That scopes the TARGET (only the active profile's popups can ever be
  raised), not the caller: same-extension sender auth does not bind a page to a profile, so a page
  opened under profile A that learns a profile-B journal id after a switch to B passes the check —
  and raises a window B is entitled to see. No caller-binding exists in the RPC layer today and none is
  added. It returns a boolean; a guessed 16-hex journal id learns only "a popup exists for the active
  profile".
- **Information exposure.** Window bounds from `getLastFocused` carry no page content and never leave
  the SW. No URLs or payloads are logged by the new code.
- **Wrong-window focus.** `focus(handleId)` acts only on the window id the manager created for that
  handle; `update` on a closed id rejects and is swallowed as `false` (I5).
- **Input validation.** `journalId` is validated as a non-empty string at the RPC boundary; the scan is
  over ≤ a handful of live records.
- **Supply chain / crypto / least privilege.** No new dependencies, no new permissions (`windows` API
  is already used), no CI/workflow changes, no secrets. N/A for crypto.

## Phases

Every gate runs the fast layers; commands are the repo's own (F11). "Green" = all commands exit 0 AND
the named new tests pass.

### Arc 1 — cancel closes the popup

#### Phase 1 — `WindowManager.cancel` carries an `Error`; Reject reaches the dApp as 4001 ✓
_(green 2026-09-05; `lessons/phase-1.md`. Gate note: root `bun run typecheck` lacks `vue-tsc` in a worktree — the equivalent `bun run --cwd apps/extension typecheck` is what every gate below means by "typecheck".)_
- `cancel(handleId, reason: string | Error)`; `Handle.reject: (reason: unknown) => void`; `_settle`
  passes the value through unchanged. Existing string callers unaffected (existing string-cancel test
  at `window-manager.test.ts:52` stays as the string case).
- `rejectInteraction(id, reason)`: `this.windowManager.cancel(handleId, new UserRejectedError(reason))`
  (A5). `error-envelope.ts`: `UserRejectedError` → `{ code: 4001, message, data: { walletErrorCode: UserRejectedError.CODE } }`,
  placed with the other classified throws.
- The reason string passed through is popup-authored today (the three windows pass the literal
  `"User rejected"`). The envelope forwards `error.message`, so a future caller must never route a
  dApp-influenced string into `rejectInteraction`'s reason — one comment at the mapping says so.
- Tests: `window-manager.test.ts` — `cancel(handleId, err)` rejects `promise` with that SAME instance
  (`toBe`) and still calls `windows.remove`. `error-envelope.test.ts` — `UserRejectedError` → 4001 +
  `USER_REJECTED`, mirroring the `JobCancelledError` case at `:16-23`. `dapp-interaction/service.test.ts` —
  `rejectInteraction` hands the manager a `UserRejectedError` carrying the reason.
  `packages/wallet-bridge/src/dispatcher.test.ts:133-146` — the capability-reject fixture throws a
  `UserRejectedError` instance and the test asserts the dispatcher rethrows that SAME instance
  (keeping its rejection-persistence assertions), so a future loss of the typed error is caught.
- **Validation gate**: `bun run typecheck && bun run lint && bun run --cwd apps/extension test src/wallet/services/window-manager src/wallet/services/wallet-sdk/error-envelope.test.ts src/wallet/services/dapp-interaction && bun run --cwd packages/wallet-bridge test`
  → exit 0, new cases green. Layers: typecheck/lint · unit.

#### Phase 2 — journal-driven cancel in `DappInteractionService` + post-registration reconciliation ✓
_(green 2026-09-05; `lessons/phase-2.md`. Arc gate: `audit:vue`'s parallel `test` leg timed out 20 untouched crypto/integration tests under load; the same four layers run sequentially are green — typecheck:all 14/14, lint, 5443/5443, build.)_
- `init()`: `this.operationJournal.onOperationUpdated.add((rec) => { if (rec.progress.stage === "cancelled") this.cancelInteractionForJournal(rec.id) })`.
- `cancelInteractionForJournal(journalId)` per the arc-1 flow step 2. Idempotent.
- `interaction()`: right after `storage.set`, and only with `hooks?.queuedJournalId`,
  `void this.reconcileCancelledJournal(journalId)` (flow step 4; never throws; fire-and-forget). The
  pre-popup short-circuit (`service.ts:254-262`) stays as the cheap early exit.
- Unit tests (`dapp-interaction/service.test.ts`, existing harness, handler invoked directly): (1) live
  interaction with `hooks.queuedJournalId = J`, cancelled event for J → `windowManager.cancel` called
  once with the handle id and a `JobCancelledError` whose `details.jobId === J`, `onInteractionCancelled`
  emitted, `cancelledAt` set; (2) unknown id → no calls; (3) record already deleted (approved) → no
  calls; (4) two events → one cancel; (5) Approve after the event and BEFORE cleanup throws
  `JobCancelledError` (the mocked manager never rejects, so the record persists — this pins the
  first-claim-wins order, F7); (6) registration-gap regression: the journal stub reports `cancelled` on
  the post-registration read (no event ever fires) → `windowManager.cancel` called once with a
  `JobCancelledError{jobId}`; (7) deferred-read/approval interleaving: the read is parked, Approve
  lands (record deleted, `executeOperations` invoked), the read then resolves `cancelled` → no manager
  cancel, no throw (the cancelled journal record is the claim helper's to refuse — already pinned by
  `claim-helper.test.ts:250-258`); (8) a rejecting read → no cancel, no throw, window still owned.
- Composition test (`dapp-interaction/service.composition.test.ts`, mirroring
  `execution/service.composition.test.ts:106-157`): REAL `OperationJournalService` on `FakeBrowserApi`,
  REAL `WindowManager` on the same `FakeBrowserApi.windows` + `MockClock`, `DappInteractionService`
  started through a `ServiceCollection` of stubs (`init()` wires the subscription for real). Two live
  interactions A and B (two `execute()` calls with distinct `queuedJournalId`s, both records created at
  `queued`); `transitionOperation(A, cancelled)` → `windows.remove` called with A's window id only →
  A's `execute()` promise rejects with a `JobCancelledError` carrying `jobId = A` → A's record is gone
  from `storage`, B's remains and B's window is open → a late `rejectInteraction(A)` is a no-op. Existing
  `error-envelope.test.ts` already pins `JobCancelledError → 4001`; add no duplicate.
- Docs: one sentence in `ARCHITECTURE.md`'s dApp-interaction/cancel description if it narrates the
  cancel path (check; skip if absent). Comments in code: the invariants only (why the Error instance;
  why the re-read after registration; first-claim-wins order).
- **Validation gate**: `bun run typecheck && bun run lint && bun run --cwd apps/extension test src/wallet/services/dapp-interaction src/wallet/services/window-manager src/wallet/services/wallet-sdk/error-envelope.test.ts`
  → exit 0. Then the arc gate: `bun run audit:vue` → exit 0 (includes the build). Layers: typecheck/lint ·
  unit · composition.
- **Arc boundary**: run the arc-1 codex loop (Post-implementation §), THEN `gh stack add`.

### Arc 2 — refocus from the Queued card + open on the right display

#### Phase 3 — `WindowPort` grows `update` + `getLastFocused`; `create` accepts `left/top` ✓
_(green 2026-09-05; `lessons/phase-3.md`)_
- `wallet-core` port types as in the interfaces above; `ChromeWindowsAdapter.update` →
  `chrome.windows.update`; `getLastFocused` → `chrome.windows.getLastFocused({ windowTypes: ["normal"] })`
  wrapped so any throw, or a window without numeric bounds, → `undefined`. `create` forwards `left/top`.
- `FakeWindowsAdapter`: record `creates: CreateWindowOptions[]` and `updates: Array<{ windowId; options }>`;
  a settable `lastFocused: WindowBounds | undefined`; `update` on a non-live id rejects (mirrors
  Chrome). The fake honors the port contract (`getLastFocused` never throws) — no throw switch.
- Tests: `fake-browser-api.test.ts` — the fake records `create` options and `update` calls; `update` on a
  closed id rejects. NEW `apps/extension/src/core/adapters/chrome-browser-api.test.ts` (sibling of
  `clock-ticker-adapter.test.ts`), driving `new RealChromeBrowserApi().windows`
  (`chrome-browser-api.ts:199-204`) against the `chrome` global the suite already stubs
  (`tests/vitest.setup.ts:89`): (a) `getLastFocused` calls `chrome.windows.getLastFocused` with
  `{ windowTypes: ["normal"] }` and returns the bounds; (b) a throwing `getLastFocused`, and a window
  with non-numeric bounds, both yield `undefined`; (c) `update` forwards `windowId` + options.
- **Validation gate**: `bun run --cwd packages/wallet-core typecheck && bun run --cwd packages/wallet-core test && bun run typecheck && bun run lint && bun run --cwd apps/extension test src/core/adapters/chrome-browser-api.test.ts`
  → exit 0 (codex r3 condition: the adapter tests run in THIS gate, not only at the arc gate). Layers:
  typecheck/lint · unit.

#### Phase 4 — `WindowManager` centers on open and can focus a handle ✓
_(green 2026-09-05; `lessons/phase-4.md`; owner Space-switch check pending, recorded there)_
- `centerOn(anchor, width, height)` exported pure helper: `left = round(anchor.left + (anchor.width - width) / 2)`,
  same for `top`; SIGNED, no clamping; `{}` when the anchor or any of its four bounds is missing.
- `openAndAwait` per the arc-2 flow (a): synchronous return preserved; `getLastFocused()` first; identity
  check `handles.get(handleId) === handle` BEFORE `create` (timeout during the lookup → no create); the
  existing post-create identity check + orphan removal untouched.
- `focus(handleId)`: handle with a `windowId` → `update(windowId, { focused: true, drawAttention: true, state: "normal" })`
  → `true`; missing handle/window or an `update` rejection → `false`.
- Tests (`window-manager.test.ts`): with `lastFocused` set, `create` receives the centered `left/top`
  (one positive-anchor case and one NEGATIVE-anchor case, e.g. `left: -1920, width: 1920` + popup 400 →
  `left: -1160`); without it, no `left/top`; timeout elapsing DURING the lookup → no `create` call and the promise rejects with the
  timeout; `focus` → `update` called with the exact options and `true`; unknown handle → `false`;
  `update` rejecting → `false`. `centerOn` unit cases: positive, negative, missing bounds → `{}` (the
  manager tests do not repeat the arithmetic). The existing slow-create tests (`:269`, `:302`) park
  AFTER creation starts (release the lookup, then advance the clock), since the lookup now precedes
  `create`; `flushCreate` gains the extra tick.
- Lesson to record (owner-verified, manual): does Chrome on the owner's Mac honor the combined
  `update` and switch Space (I2)?
- **Validation gate**: `bun run typecheck && bun run lint && bun run --cwd apps/extension test src/wallet/services/window-manager`
  → exit 0. Layers: typecheck/lint · unit.

#### Phase 5 — RPC + clickable Queued card ✓
_(green 2026-09-05; `lessons/phase-5.md`)_
- `spec.ts` `Methods.focusInteractionWindow(journalId: string): boolean`; service implementation = scan by
  `hooks?.queuedJournalId` → active-profile check against `payload.session.profileId` →
  `windowManager.focus(handleId)`; add the string to `defineRpcMethods` and the client passthrough list (F9).
- `TransactionAwaitingCard.vue`: when `jobId && stage === "queued"`, the root is focusable and clickable —
  `tabindex="0"`, `role="button"`, `title="Show the approval window"`, `cursor: pointer`; `@click` and a
  keydown handler for Enter/Space that acts ONLY when `event.target === event.currentTarget` (so the
  cancel button's own Enter/Space never bubbles into a focus) and calls `preventDefault` on Space;
  emits `("focus", jobId)`. The cancel button gets `@click.stop`. Otherwise no `tabindex`, no role, no
  cursor. No copy change to the "Queued..." subtitle.
- `recent-activity-handlers.ts`: `buildFocusHandler(client: { focusInteractionWindow(id): Promise<boolean> })`
  → `(jobId) => { if (!jobId) return; client.focusInteractionWindow(jobId).catch(() => {}) }`.
- `RecentActivityView.vue`: instantiate `DappInteractionServiceClient` alongside the other clients,
  disconnect it in `onBeforeUnmount` with them (`:779-784`), and bind `@focus="onFocusInFlight"` on BOTH
  journal-driven `TransactionAwaitingCard` sites (`:812`, `:871`), not on the orphan/fallback cards.
- Tests: card — `queued` + jobId click emits `focus` with the id; Enter and Space on the card emit
  `focus`; Enter on the cancel button emits `cancel` only; click on the cancel button emits `cancel`
  only; `proving` click emits nothing and the root carries no `tabindex`/`role`. handlers —
  `buildFocusHandler` calls through with the id, swallows a rejection, no-ops on a falsy id. service —
  `focusInteractionWindow` finds by journal id and returns the manager's boolean; unknown id → `false`;
  foreign profile → `false` and the manager is not called.
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
| 1 `fix(dapp): feed cancel closes the approval popup; reject reaches the dApp as 4001` | 1–2 | `worktree-dapp-popup-cancel-focus` (`gh stack init --adopt worktree-dapp-popup-cancel-focus --base dev`) | `dev` |
| 2 `feat(popup): approval window opens on the active display and refocuses from the Queued card` | 3–5 | `dapp-popup-cancel-focus/focus` (`gh stack add dapp-popup-cancel-focus/focus`) | arc 1 |

PR titles ≤ 93 chars (squash subject + ` (#NN)` must stay ≤ 100). Submit only after step 4 above:
`gh stack sync` (if `dev` moved) → `gh stack submit --auto` → `gh pr edit` each body (summary + test
evidence + the owner's manual focus check for arc 2) → `gh pr checks --watch`. Required gates on `dev`:
`quality-status`, `smoke-e2e-status`, `network-e2e-status`. `gh stack merge` is the owner's call. Then
mark the index entry and suggest `agent-worktree done dapp-popup-cancel-focus`.

## Audit log

- Codex round 1 (session `01a072e1-d77c-7200-b8f9-927bcf300e22`, GPT-6 Astra `high`): **reject**
  (blocking: a cancel landing between `execute()`'s journal read and the interaction's registration is
  seen by neither defense; clamping centered coordinates at zero breaks displays left of / above the
  primary). Adopted: post-registration journal re-read (flow step 4, Phase 2 + regression test); signed
  `centerOn` with a negative-anchor test; F6/F7 restated (typed refusal only until the `finally`
  deletes the record, then `"Invalid id"` — no tombstone); trust domain restated (any extension page can
  already `transitionOperation`; the subscriber proves state, not user intent) and `focusInteractionWindow`
  scoped to the active profile; both identity fences kept around the new pre-create await, slow-create
  tests park after creation starts; `tabindex`, self-targeted Enter/Space, Space `preventDefault`, both
  render sites, client disconnect; a composition test with the real journal + real manager, a
  registration-gap regression, keyboard-isolation cases; I5 rewritten as decision A6 (dead clicks
  possible in two windows); recon's false absence fixed (`onboarding-tab.ts:36` is SW-side focus).
  Rejected: a `ChromeWindowsAdapter` unit test (no harness for `chrome.*` adapters in the repo; the
  contract is pinned through the fake at the manager); tightening `transitionOperation`'s RPC (out of
  scope). Transcript: `audit-codex.md`.
- Codex round 2 (resumed): **reject** (blocking: `execute()` cannot observe registration — `interaction()`
  returns the settlement promise — so the r1 fix was unimplementable as written). Adopted: the
  reconciliation read moved INSIDE `interaction()` right after `storage.set`, fire-and-forget, never
  throwing (flow step 4); the ordering proof rewritten on write-before-emit + lock-free reads (F4),
  dropping the mutex and "faster than a click" claims; the deferred-read/approval interleaving and the
  failed-read case added as unit tests (7)(8); the `lastFocusedThrows` fake switch dropped for two
  real `ChromeWindowsAdapter` tests through `RealChromeBrowserApi().windows` + the suite's `chrome`
  stub; the focus-RPC guarantee restated as target-scoped, not caller-bound; recon's Absences line
  fixed. Owner scope addition (Reject → `UserRejectedError` → 4001, A5) added to Phase 1 between
  rounds 2 and 3 and sent to codex in round 3.
- Codex round 3 (resumed): **conditional approve** (condition: Phase 3's gate must run the new
  `chrome-browser-api.test.ts` — adopted, gate amended). Lows adopted: the wallet-bridge capability-reject
  fixture throws a `UserRejectedError` instance and asserts the same instance is rethrown
  (`dispatcher.test.ts:133-146`), gate extended with `bun run --cwd packages/wallet-bridge test`; the
  claim-helper reference corrected to the already-cancelled case (`:250-258`); recon's A5 row updated.
  Codex confirmed: the registration gap is closed for successful reads and best-effort under storage
  failure; fire-and-forget reconciliation keeps settlement prompt; capability Reject changes only the
  wire error, not rejection persistence (`dispatcher.ts:1098`; README already documents
  `4001 / USER_REJECTED` at `wallet-bridge/README.md:111`); discovery stays untyped; the pass-through
  message is safe for today's three literal callers (note added to Phase 1).

## Seeds

Final (2026-09-05): approved unconditionally at the gate; scope unchanged from the audited plan. Run the
seed from a session INSIDE this worktree (`agent-worktree resume dapp-popup-cancel-focus`).

ELI5 companion: Artifact `https://claude.ai/code/artifact/9f7c034e-1d73-4172-b378-5e3c61c6413d`
(source `implementations-plan/dapp-popup-cancel-focus/eli5.html` — redeploy the same file to update).

Recommended: `/goal` (completion is transcript-observable).

```
/goal All five phases marked ✓ in implementations-plan/dapp-popup-cancel-focus/plan.md (the phase headers in the file — not the chat), each ✓ backed by its validation gate reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/dapp-popup-cancel-focus/lessons/phase-N.md`; `/code-review` was NOT run (code_review: off); the codex fix loop converged for arc 1 at its boundary (before `gh stack add`), for arc 2 at its boundary, and for the final cross-arc pass — each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; a two-PR stack exists on GitHub created only after all three loops converged (`gh stack view` output in the transcript) with `gh pr checks` green on both; `bun run test` and `bun run lint` both report exit 0 in the transcript.
```

Alternative: `/loop 15m` — the blueprint skill's drive template with `<lint>` = `bun run lint`,
`<test>` = `bun run test`, multi-arc close-out per the Post-implementation section above.
