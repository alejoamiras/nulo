# Phase 2 follow-up v4 — drop retry, persist amount, keep terminal forever, fix dupe + clash

**Status:** plan v4 — codex v3 partial-yes; mount/reconnect snapshot hole patched; concurrency invariant documented; ready to implement
**Branch target:** `feat/phase-2-durable-jobs` (continuation from `8e9206ff`)

## Five QA-driven changes

User retested v0.15.4 and surfaced 5 issues. Each is a separate concern; some interact.

### Issue 1 — Drop retry entirely

**User's argument:** retry button is asymmetric (transfer-only) which feels arbitrary, AND it doesn't actually retry — it just opens the Send page fresh. Removing it unifies UX between transfer and dApp interrupts.

**Decision:** Remove all retry plumbing. The Phase 3 work (`b5f9txcyc` build) is reverted.

Concretely:
- `journal-state.ts`: drop `retryable: boolean` from `JournalTerminalDisplay`.
- `TransactionTerminalCard.vue`: drop `retryable` prop, `defineEmits(["retry"])`, and the refresh button + slot fill.
- `RecentActivityView.vue` + `TransactionsList.vue`: drop `@retry` listeners + `buildRetryHandler` import.
- `recent-activity-handlers.ts`: drop `buildRetryHandler` + `RetryRouter` type.
- Tests: drop 7 retry-related cases (4 journal-state + 3 terminal-card + 2 retry-handler).

### Issue 2 — Terminal transfer cards show no info (no amount)

The card currently shows `title` (token symbol for transfers, humanized op title for dapp_execute), `subtitle`, `originLabel`. For a transfer's Cancelled/Interrupted card: just `"USDC"` + `"Cancelled"`. No amount, no recipient, no anything else.

**Root cause:** journal record persists `tokenId` but NOT `amount`. The terminal card has no data source for "5.00 USDC".

**Fix:**

Extend `NewOperationInput` + `OperationRecord` with `amount?: string` (BigInt-as-string for type safety across the IPC boundary). `executeTransfer` passes `amount.toString()` at create-time. The popup's `journalTerminalCardProps` reads `op.amount` + `op.tokenId` and computes display amount + symbol via the token's decimals (same `balanceFormatted` util already used by the awaiting card path).

No real migration needed (memory `feedback_no_data_migrations.md`: "wipe + reseed instead"). v6 storage gate already wipes the journal on upgrade. We bump to v7 to trigger one more wipe — pre-v7 records won't have `amount`, optional field handles that gracefully anyway.

Optional storage bump argument: the field is `optional` so the wipe isn't strictly necessary. We could just add the field and let pre-existing records render without amount. Less invasive. Q1 below.

### Issue 3 — Asymmetry: retry on transfer but not on dApp tx feels wrong

Already addressed by Issue 1 (drop retry entirely). No separate work.

### Issue 4 — Terminal cards disappearing after 5 min is confusing

User: "what the hell, why did they disappear?". Correct critique — the 5-min window was a row-budget compromise that the user hadn't anticipated.

**Decision:** terminal records stay in `RecentActivityView` forever (subject to the row budget). Archives already did this.

Concretely:
- Drop `TERMINAL_VIEW_WINDOW_MS` + `nowTick` from `RecentActivityView.vue`.
- `recentlyTerminalJournalOps` filter loses the `now - op.terminalAt < WINDOW` clause.
- Sort newest-first; cap is the existing 3-row budget. Terminal records count toward the cap.

Row-budget UX consequence: when a user has 4 cancelled transfers in their recent history, only the top 3 show on the home / token page. Older cancelled records visible in Archives (same convention as settled txs).

Open question (Q2): should the merge be "in-flight cards always at top, then terminals + settled merged by recency in remaining slots", or "in-flight first, then terminals (newest first), then settled (filling remainder)" — i.e., is the order structural or chronological?

**Current (structural):** awaiting → all terminals → settled. Easy to implement; familiar pattern.

**Proposed (chronological):** awaiting → mixed by recency → cap at 3.

Chronological is what the user almost certainly expects when terminals live forever (a 1-month-old cancelled shouldn't push out a 1-day-old settled tx). Going with chronological. Implementation = unified row model like the Archives `activity.vue` already uses.

### Issue 5 — Duplicate render during cancel (v3 — imperative clear)

**v2 was wrong.** Codex caught: the structural rule `executingTask && no in-flight journal record` is unsound because:
- Tasks start BEFORE the journal in `executeTransfer` (`service.ts:369` task; `:379` journal). Brief task-first window would suppress the awaiting card prematurely.
- `executeNoFromSendTx` (the `default_entrypoint` aztec_sendTx path) has NO journal record at all — rule permanently suppresses the legitimate awaiting card for those ops.

**v3 — imperative clear.** When a journal event fires `onOperationUpdated` for a record transitioning to terminal AND that record matches the current `executingTask`, clear `executingTask` immediately. TaskService's eventual `onTaskUpdated` (after the SW's catch block runs) is a no-op once we've cleared.

Pure, testable, and only fires when both conditions hold (terminal AND match). The task-first window has no terminal records to trigger on; the no-journal path has no journal events at all. Both broken cases from v2 don't fire.

```js
// In RecentActivityView.vue's onJournalUpdated handler:
function onJournalUpdated(op) {
  const idx = journalOps.value.findIndex((x) => x.id === op.id)
  if (idx !== -1) journalOps.value[idx] = op
  else journalOps.value = [op, ...journalOps.value]

  // v3 cancel-dupe fix: when an in-flight op transitions to terminal,
  // clear the matching executingTask in the same tick. Eliminates the
  // race window where both the new terminal card and the lingering
  // awaiting card render.
  if (op.terminalAt !== null && executingTask.value && isMatchingTask(executingTask.value, op)) {
    executingTask.value = null
    executingSubtasks.value = []
  }
}
```

The match helper (pure, extract to `recent-activity-handlers.ts`):

```ts
export function isMatchingTask(task: TaskRecord, op: OperationRecord, activeAccount: string | undefined): boolean {
  if (op.accountAddress !== activeAccount) return false
  if (op.kind === "transfer") {
    return task.content?.kind === ContentKind.Transfer && task.content?.tokenId === op.tokenId
  }
  if (op.kind === "dapp_execute") {
    return task.content?.kind === ContentKind.ExecuteOperation
  }
  return false
}
```

This is `O(1)` per event, runs only on terminal transitions (rare), and the match conditions are tight enough to prevent false positives.

### Issue 5 — Duplicate render during cancel (v2 — DEPRECATED)

Repro: click Cancel → cancelled terminal card appears immediately → previous awaiting card also still visible for a few seconds → both render until the TaskService task catches up and `executingTask` clears.

**Root cause:** the awaiting card has TWO independent data sources:
- `executingTask` (TaskServiceClient) — in-memory, updated when the SW task fails/completes
- `topJournalOp` (OperationJournalServiceClient) — durable, updated via journal events

When `cancelJob` fires:
1. SW transitions journal → `cancelled` (fast).
2. Journal event fires; popup observes; terminal card renders.
3. SW prove pipeline catches `JobCancelledError`, calls `transferTask.fail(error)` (slower).
4. Task event fires; popup observes; `executingTask` clears; awaiting card disappears.

Between steps 2 and 4: both cards render.

**Fix:** suppress the executingTask-driven awaiting card when a matching terminal journal record exists within the last few seconds. Match heuristic: same `accountAddress` + journal record `terminalAt` within ~5s. Catches the race window. After 5s, executingTask will naturally clear from the TaskService event.

```ts
const suppressTaskAwaiting = computed(() => {
  if (!executingTask.value) return false
  if (!nowTick.value) return false // useTicker dependency
  const cutoff = nowTick.value - 5000
  return terminalJournalOps.value.some(
    (op) => op.terminalAt !== null && op.terminalAt > cutoff && op.accountAddress === appStore.account?.address
  )
})
```

Note: we still need `useTicker` for the suppression decay (else the suppression is sticky for the lifetime of any matching terminal). 1-second tick is enough.

Alternative (deeper fix): make `ExecutionService.cancelJob` call `taskService.failTask(taskId, JobCancelledError)` too so both sources transition synchronously. But the popup-side fix is non-invasive and just as effective.

### Issue 6 — Cancel X clashes with amount column

User: "The X button for cancelling looks awesome on transactions... But on transferring funds (send) it clashes with the amount being sent... It's almost impossible to see."

**Root cause:** absolute top-right action button + flex-column amount text both occupy the right edge top corner.

**Fix:** when the layout's `#actions` slot is filled, add top padding to `.amount_col` so the amount text drops below the action button. The action button keeps its top-right position; the amount visibly shifts down by ~16px when actions are present.

```vue
<Flex ... :class="[$style.wrapper, $slots.actions && $style.has_actions]">
```

```css
.has_actions .amount_col {
  padding-top: 18px;
}
```

Visual cost: the awaiting transfer card grows by ~18px vertically when the cancel button is shown. This is acceptable — the card is naturally taller during the in-flight phase anyway (visual weight matches the importance of "active operation"). Once the card transitions to terminal (settled / cancelled / failed), `#actions` is no longer filled, padding drops back, card returns to standard height.

Q3 below: is 18px the right amount? Or use a CSS grid layout instead (cleaner separation of slot regions)?

## Test plan

Per user direction: succinctness, value-focused, no over-coverage.

### Unit + component tests

| File | Net change | Cases |
|---|---|---|
| `journal-state.test.ts` | -4, +1 | Drop the 4 `retryable` cases. Add 1: amount field flows through display when present. |
| `journal-state.ts` | (no test, code-only) | Drop `retryable` field |
| `TransactionTerminalCard.test.ts` | -3 | Drop the 3 retry-button cases. Tests for amount + amountSymbol already exist. |
| `TransactionAwaitingCard.test.ts` | (no net change) | Existing 5 cancel cases still cover the surface. The has_actions padding is style-only — no JS behavior to test. |
| `recent-activity-handlers.test.ts` | -2 | Drop the 2 retry-handler cases. |
| **New** wire-test for journal-amount → balanceFormatted | +1 in `journal-state.test.ts` or popup-handler test | Pin the conversion path |
| **New** suppress-task-awaiting test | +1 (or 2) | Pure helper extracted to `recent-activity-handlers.ts`: `shouldSuppressTaskAwaiting(executingTask, terminalOps, now)`. Tests: returns true when matching terminal within window; false otherwise. |

**Net delta:** −9, +3 cases. Total reduction in test surface (retry was over-engineered for what it delivered).

### E2E tests

Skip new e2e (codex's earlier call). The wire-tests + manual smoke cover the regression matrix.

### Manual QA scenarios

1. Cancel a UI transfer with amount visible → terminal Cancelled card shows token + amount + "Cancelled" subtitle. **No duplicate awaiting card.**
2. Cancel during proving → as above; cancel X disappears before submit by hide-at-stage rule.
3. SW-restart-mid-prove on UI transfer → Interrupted card shows token + amount + "Transaction was interrupted". **No retry button** (verify removal).
4. Terminal cards stick around — no 5-min disappearance.
5. Amount column on awaiting transfer card with X button → X clearly visible at top-right; amount text shifted down ~18px; no overlap.

## Rollout

Five commits, smallest-first:

1. **Drop retry** — Phase 3 revert. Net code reduction; no new behavior to introduce risk.
2. **Drop 5-min window + chronological merge** — `RecentActivityView` row-model refactor.
3. **Persist amount on journal record** — schema extension, executeTransfer + render path.
4. **Suppress duplicate during cancel race** — pure helper + popup wire.
5. **Fix amount/cancel-X visual clash** — `has_actions` style modifier in layout.

Each commit independently passes `bun run audit:vue`. Bump `0.15.4 → 0.15.5` in the final commit.

## Open decisions (3 questions for user)

- **Q1.** Journal-schema bump: persist `amountRaw` + `recipientAddress` fields. **v2 resolution: bump v6 → v7 + wipe** (Plan subagent's call). Argument: pre-v7 records would show no amount even after the fix lands, confusing during QA; the wipe is already in place (just bump the constant); no production users. Optional-field approach left existing dev-test records in a degraded state.

- **Q2.** Merge order in `RecentActivityView`: structural (awaiting → all terminals → settled) or chronological (awaiting → mixed-by-recency)? **Proposal:** chronological. Matches what users expect when terminals live forever.

- **Q3.** Visual fix for X+amount clash: padding-shift on amount column (my v1) OR padding-right on wrapper to reserve action-button space (Plan subagent). **v2 resolution: padding-right on wrapper.** Argument: shifting the amount column DOWN is visually weird (the column "drops" when an action button appears); padding-right preserves the column-based row layout and reserves rightmost ~36px for actions cleanly.

## v2 consolidation deltas (from Plan subagent disagreements)

Six material changes vs. my v1 draft:

1. **Persist `recipientAddress` alongside `amountRaw`.** Subagent: "the user's complaint is 'no amount, no recipient'. Persisting only amount solves half the problem." Both fields are in scope at the `createOperation` call site. Add both, store recipient for future detail-view use (not rendered yet — card layout has no recipient row today).

2. **Field naming: `amountRaw` not `amount`.** Plain `amount` would shadow the BigInt parameter elsewhere. Suffix `Raw` documents "this is a serialized bigint string", consistent with the `balanceFormatted(rawAmount, decimals, length)` utility's parameter name.

3. **v7 storage bump (Q1 resolved).** See above.

4. **Row cap 3 → 5.** Subagent: "with terminals living forever, 3 is too tight. A user who cancels and retries a few times legitimately accumulates 3+ terminal cards before a settled tx comes in." Popup is ~600px tall; 5 rows ≈ 300px leaves room for headers and bottom nav. Cap=5 fits without scrolling.

5. ~~**Duplicate-render fix: structural computed, not time-based heuristic.**~~ **(v3: REPLACED.)** Codex hard-caught: subagent's `isExecutingTaskJournalTerminal = !inFlightJournalOps.length` is broken because (a) tasks are created BEFORE journals in `executeTransfer` (`:369` vs `:379`) — would suppress legitimate task-first windows, and (b) `executeNoFromSendTx` has no journal at all — would permanently suppress those awaiting cards. v3 replaces with imperative clear in `onJournalUpdated`: when a journal event fires for a terminal record matching the current executingTask, clear executingTask. Only fires on actual terminal transitions; can't hit the broken cases.

6. **Visual-clash fix: padding-right on wrapper** (Q3 resolved). Reserves rightmost ~36px for the action button. Amount column shifts left rather than down.

## Revised commit order (Plan subagent's; schema-first)

1. **Persist amountRaw + recipientAddress on transfer journal records** — schema + executeTransfer; v6→v7 bump in `migrate.ts`. (Unblocks Phase 2.)
2. **Display amount on terminal transfer cards** — `journalTerminalCardProps` resolves `op.amountRaw + op.tokenId` → formatted amount via `balanceFormatted`. Same change in `TransactionsList.terminalCardProps` (Archives). Thread `tokensById` from `activity.vue` (Archives needs a token lookup the page doesn't currently have).
3. **Terminal cards forever in RecentActivityView** — drop `TERMINAL_VIEW_WINDOW_MS` + `nowTick` + `useTicker` import. Simplify `recentlyTerminalJournalOps` filter. Bump cap 3 → 5. Apply chronological merge (Q2).
4. **Suppress duplicate awaiting during cancel** — add `isExecutingTaskJournalTerminal` computed; gate the executingTask `v-if`.
5. **Visual fix — padding-right on wrapper when actions slot is filled** — single CSS modifier on `TransactionCardLayout`.
6. **Drop retry surface entirely** — pure deletion across 6 files; ~−9 tests net (4 journal-state retryable + 3 terminal-card retry + 2 retry-handler).

Each commit independently passes `bun run audit:vue`. Bump `0.15.4 → 0.15.5` in the final commit (or in a dedicated commit if cleaner).

## Test plan (v2 consolidated)

| File | Net change | Cases |
|---|---|---|
| `spec.ts` schemas | — | type-only |
| `operation-journal/service.test.ts` | +1 | create-operation accepts amountRaw + recipientAddress |
| `journal-state.test.ts` | -4 -2 +1 | Drop the 4 `retryable` cases + retryable assertions in toEqual blocks. Net code reduction in journal-state util has no new test surface (amount lookup is consumer-side). |
| `TransactionTerminalCard.test.ts` | -3 | Drop the 3 retry-button cases. Existing amount-flow case already covers the new display path. |
| `TransactionCardLayout.test.ts` (NEW) | +1 | wrapper has `wrapper_has_actions` class when actions slot is filled. Pin for the clash-fix invariant. |
| `recent-activity-handlers.test.ts` | -2 +1-2 | Drop retry-handler cases. Add `shouldSuppressTaskAwaiting` if extracted to pure helper. |
| Archives-side amount path | (covered by component test) | balanceFormatted utility is well-tested elsewhere |

**Net delta:** −9 tests + ~2 new = significant test surface reduction. The retry tests were the cost of an over-engineered feature; their removal balances the new tests for the schema + clash-fix changes.

### E2E

Skip new e2e (codex's prior call holds). Manual QA matrix on the build covers the regression.

### Manual QA scenarios (v2)

1. Cancel a UI transfer → terminal Cancelled card shows token + amount + "Cancelled" subtitle. **No duplicate awaiting card.**
2. SW-restart-mid-prove on UI transfer → Interrupted card shows token + amount + "Transaction was interrupted". **No retry button.**
3. Cancelled / Interrupted cards stay visible until browser restart (not 5 min auto-disappear). Visible in both RecentActivityView and Archives.
4. Awaiting transfer card with X button → X clearly visible at top-right; amount text shifted LEFT (column had `padding-right: 36px`); no overlap.
5. Long-running activity (3+ cancelled + 1 in-flight + 1 settled) → cap=5 visible, oldest dropped.

## v4 corrections (post-codex re-sanity)

Codex v3 re-check verdict: **partial yes.** Fixed both v2 hard bugs. Two new findings:

### v4 Should fix — mount / reconnect snapshot path

The v3 imperative clear runs in `onJournalUpdated` event handler. But if the journal record is **already terminal** when the popup mounts (user cancelled → closed popup → reopened later), the event never fires — the snapshot just loads it. `executingTask` stays set; duplicate would reappear.

**Fix:** extract the clear logic to a helper that runs in three places:

1. `onJournalUpdated` (event path, v3)
2. After `getOperations()` in `onMounted` (initial snapshot)
3. After `getOperations()` in `resnapshotJournal` (`onConnected` reconnect path)

```js
function clearExecutingTaskIfMatchingTerminal() {
  if (!executingTask.value) return
  const account = appStore.account?.address
  const match = journalOps.value.find(
    (op) => op.terminalAt !== null && isMatchingTask(executingTask.value!, op, account),
  )
  if (match) {
    executingTask.value = null
    executingSubtasks.value = []
  }
}
```

Called after every journalOps mutation. Cheap (linear scan of journalOps, bounded by row budget). Idempotent — running it twice with same data is a no-op.

### v4 acknowledgment — concurrency heuristic (codex Nice)

`isMatchingTask` matches `dapp_execute` by kind alone, and `transfer` by tokenId alone. If two same-account dApp ops execute concurrently, a terminal event on op A would false-clear executingTask even if it's currently B.

**v4 decision: document as known limitation, don't strengthen now.**

Rationale:
- The popup tracks ONE `executingTask` at a time (the latest). Concurrent dApp ops are rare in practice (each dApp request opens its own approval window; user serializes them).
- Consequence of false-clear: brief flicker — the executingTask gets cleared by the wrong terminal event, then the TaskService's next `onTaskUpdated` re-populates it within a frame or two. Visual cost, not state corruption.
- Strict identity match would require plumbing `journalId` through to TaskService task content — a bigger surface change. Worth doing as a follow-up if QA shows concurrency-driven flicker; punt for now.

Documented as a comment on `isMatchingTask`:

```ts
/**
 * Match an executingTask to a journal op for the cancel-dupe fix.
 *
 * KNOWN LIMITATION: matches by kind + tokenId (transfers) / kind alone
 * (dapp_execute). For concurrent same-account ops (rare — dApp approval
 * windows serialize user-side), a terminal event on op A could false-
 * clear executingTask when it's currently B. Consequence: brief flicker
 * before TaskService re-syncs. If concurrency-driven flicker shows up
 * in QA, strengthen this by plumbing a journalId onto task content.
 */
```

### v4 new tests

- Snapshot-path regression: mount the view with `executingTask` set AND a matching terminal journal record pre-loaded → `clearExecutingTaskIfMatchingTerminal` clears the task. Without this test, the v3-style fix would re-pass while the snapshot path silently breaks.
- (Documented invariant only — no test for the concurrency case since the behavior is "best-effort match, flicker on collision". Adding a test would lock in the false-clear behavior; better to leave as documented limitation.)

## v3 corrections (post-codex pre-impl audit)

Codex flagged 1 hard + 3 should-fix items:

**Hard fix — duplicate-render rule:** see Issue 5 v3 above. Replaced structural-computed with imperative-clear + match helper.

**Should-fix corrections:**

- **v7 wipe rationale:** Codex pointed out it's not about crash — `balanceFormatted(undefined, …)` returns `"0"` silently, which renders as a fake "0 USDC" on the card. The wipe is correct; the rationale was understated. Wipe path itself is clean (only `nulo:journal@*` keys; already in `KEY_PREFIXES_TO_WIPE_SESSION`).

- **Cap=5 framing:** Codex noted the home page already scrolls (`general.vue:37`). Cap=5 is fine but the framing is "more rows visible WHEN you scroll", not "fits without scrolling". Adopted in messaging.

- **Retry-removal scope > 6 files:** Codex enumerated specific references at:
  - `TransactionsList.vue:69` (retryable: false override)
  - `journal-state.ts:63` (interface field)
  - `RecentActivityView.vue:21` (buildRetryHandler import) + L?? (onRetryTerminal call + @retry listeners)
  - `recent-activity-handlers.ts:20` (RetryRouter + buildRetryHandler)
  - `TransactionTerminalCard.vue:55` (retryable prop + retry button)
  - Plus stories + tests
  
  Implementation will grep `retryable\|buildRetryHandler\|RetryRouter\|@retry` before commit to ensure exhaustive removal.

**v3 added tests:**

- `isMatchingTask` helper (pure, in `recent-activity-handlers.ts`): match by tokenId for transfers, by kind for dapp_execute, no match for account mismatch.
- Regression test for "task-first window": executingTask exists but no journal record yet → `isMatchingTask` returns false (nothing to match against), awaiting card renders.
- Regression test for "no-journal path": dapp_execute_default_entrypoint with executingTask but no journal record ever → awaiting card renders for its lifetime.
- Degraded-data test: terminal transfer card with missing `amountRaw` field (pre-v7 record) — verify `journalTerminalCardProps` skips the amount + amountSymbol assignment when `amountRaw` is undefined (don't render `0 USDC` ghost amount).

Net test delta from v3: +3 cases on top of v2's revised count.

## Workflow status

1. ✅ Investigation done.
2. ✅ Me + Plan subagent draft plans in parallel.
3. ✅ Consolidate (v2).
4. ✅ Codex pre-impl review (v2 → hard bug → v3).
5. ✅ Codex re-sanity (v3 → partial yes; Should + Nice → v4).
6. ⏳ **Next:** ELI5 + user approval, then implement v4.
7. Codex post-implementation review.
8. Implement fixes.
9. Bump version, build, manual QA.
