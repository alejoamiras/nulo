# Phase 2 follow-up — card affordances: icons + Cancel + Retry

**Status:** plan v3 — user UX override on placement (icon-only top-right); dissolves Q2 copy debate
**Branch target:** `feat/phase-2-durable-jobs` (continuation from `bbbaac6c`)
**Severity:** UX gaps surfaced by QA on v0.15.3.

## Three user-reported issues

| # | Report | Root cause |
|---|---|---|
| 1 | "The Interrupted card doesn't have an icon (the Confirmed and Processing ones do)" | The icon names I shipped (`refresh-cw`, `circle-minus`) do not exist in `packages/extension/src/assets/icons.json`. The Icon component silently renders an empty `<path>` when `icons[name]` is undefined — no error, just no glyph. The Failed state's `close-circle` happens to be valid, which is why I didn't catch it during smoke. |
| 2 | "No Retry button on the Interrupted card" | `TransactionTerminalCard` is purely presentational today — no action affordance. Phase 2 Week 5 design didn't include retry; the user expects one. |
| 3 | "No Cancel button (so I can't test the cancel state)" | `TransactionAwaitingCard` is purely presentational. `ExecutionService.cancelJob(jobId)` has existed on the SW since W2 but the popup never calls it. Cancel was previously only triggerable from a hypothetical "user closes the popup mid-flow" path — there's no UI surface. |

## Investigation summary

`Icon.vue` reads SVG path data from `@/assets/icons.json` keyed by lowercase-first-letter name. Missing names return `undefined`, which renders an `<svg>` with `<path d="undefined">`, hence the empty box.

Confirmed valid icon names (from `icons.json`): `cancel`, `close-circle`, `refresh`, `refresh-circle`, `restart`, `check-circle`, `clock-circle`. The Phase 2 W5 commit used invented names that look like Material Icons but aren't in this project's set.

`ExecutionService.cancelJob(jobId): void` signature (`packages/extension/src/wallet/services/execution/spec.ts:Methods`) — currently fire-and-forget; SW transitions the journal to `cancelled` (or no-ops if FSM rejects the transition for `submitting`+ records). No popup caller today.

Send page route: `/popup/send?tokenId=X` is the convention (seen in `ActionButtonsView.vue:19`, `SplittedBalancesView.vue:58`). Suitable for the Retry navigation target.

## Scope

**In scope:**
- Fix the icon bug (Phase 1).
- Add a Cancel surface to in-flight journal cards (Phase 2).
- Add a Retry surface to Interrupted terminal cards for UI-initiated transfers (Phase 3).

**Out of scope (explicit deferrals):**
- Retry on Failed cards — first iteration only covers Interrupted (per the "retry when it might help" rule). Failed retry is a separate UX call (does it help for `network`? `simulation`? per-kind).
- Retry on dApp-initiated cards — the wallet can't replay a dApp request; no useful action.
- Late-cancel feedback (toast when cancel arrives during `submitting` and gets dropped) — defer; first iteration relies on the journal's natural transition to drive the UI.

## Icon decisions (Phase 1)

Three icons need real names. Two principles drive the choice:

1. **Consistency with existing badge family.** `TransactionCard` uses `check-circle` / `close-circle` / `clock-circle` for settled/reverted/pending. Staying in the `*-circle` family for terminal states preserves visual unity. But the `cancel` icon (a literal X) breaks family for the Cancelled badge specifically — and that's intentional, because Cancelled is semantically distinct from Failed.

2. **Differentiable shapes.** If Cancelled and Failed both used `close-circle` (just different colors), they'd be hard to distinguish at a glance.

Proposal:

| State | Icon name | Rationale |
|---|---|---|
| Cancelled | `cancel` | The literal "cancel" symbol — semantic match, breaks shape parity with Failed for clarity. |
| Interrupted | `refresh-circle` | Refresh = "try again", in the badge `*-circle` family. Visually echoes the retry action. |
| Failed | `close-circle` | Existing convention for failure/reverted; no change needed (the actually-valid name I shipped). |

Open question (Q1 below): user might prefer `close-circle` for Cancelled too (with color = gray) for stricter family consistency. Listing this as a decision question.

## Cancel button (Phase 2)

### UX

Position: **right side of the secondary row** in `TransactionAwaitingCard`. Same row as the subtitle ("Generating proof…") and originLabel chip. Small text-link styling — visually quiet, never the primary affordance on the card.

Copy: **"Cancel"** (1 word). Matches existing patterns in the dApp approval popups. Considered alternatives:
- "Stop" — clearer that it interrupts an action vs. dismissing a record. Slightly nonstandard for tx flows.
- "Cancel" — universal pattern; user might briefly wonder "cancel what?" but context makes it obvious.

I lean Cancel. Q2 below.

### Visibility rule

Render the button iff:
- The card is journal-driven (i.e. `showJournalAwaiting` branch in `RecentActivityView`, NOT the `executingTask` branch — `executingTask` has no jobId today).
- The parent passes a non-null `jobId` prop.

For the `executingTask` branch: the underlying task has no journal id; cancelling it would mean cancelling the TaskService task, which is a different surface. Out of scope. (We could plumb a jobId into the executingTask path in a follow-up.)

For `awaitingAccountTxs` fallback awaiting cards (no associated journal record): no Cancel button.

### Late-cancel handling

The SW's `cancelJob` silently no-ops when the FSM rejects `submitting → cancelled`. The card stays awaiting; the journal will transition naturally to `succeeded` / `failed` driven by the SW prove pipeline. Card flips to that terminal state on the next journal event.

This means: click Cancel during prove → card flips to Cancelled within ~100ms (journal IPC roundtrip). Click Cancel during submitting → card stays awaiting until the tx settles, then flips to Succeeded or Failed. No mid-state UI.

Acceptable for v1. A `Cancelling…` intermediate state or "couldn't cancel" toast can be a follow-up if QA shows confusion.

### Wire-up

`TransactionAwaitingCard` adds:
- Prop: `cancellable: boolean` (default false) + `jobId: string | null` (default null)
- Emit: `cancel` event (no payload — parent already has the jobId in context)
- Template: secondary row gains a `<button @click="emit('cancel')">Cancel</button>` element, rendered iff `cancellable && jobId`. Styled as a quiet text link.

`RecentActivityView`:
- Import `ExecutionServiceClient`
- Instantiate at module scope alongside the other services
- Pass `cancellable + jobId` to the `showJournalAwaiting` `TransactionAwaitingCard` instance
- Listen to `@cancel` → call `executionService.cancelJob(topJournalOp.value.id)`
- `onBeforeUnmount` disconnects `executionService` too

## Retry button (Phase 3)

### Scope

Render the Retry button iff:
- Visual state is `interrupted` (NOT cancelled, NOT failed)
- Operation kind is `transfer` (UI-initiated, has a `tokenId` we can pre-select on Send page)

**Why not dApp-execute interrupted:** the wallet doesn't have the original `ExecutionPayload` to replay. The dApp would need to re-issue the request.

**Why not failed:** generic Failed could mean simulation failed (retry won't help), network failed (retry might help), prover failed (retry might help). Without per-kind nuance, a blanket Retry on Failed risks user frustration. Deferred to a follow-up that handles per-kind retry semantics.

### UX

Position: same secondary-row right placement as Cancel. Both cards stay visually parallel.

Copy: **"Try again"**. Mirrors the subtitle's "Transaction was interrupted" tone — both lean conversational/non-blaming. Considered "Retry" (shorter, more dev-y) but the wallet leans toward plain-English voice.

Q3 below.

### Action

`router.push({ path: "/popup/send", query: { tokenId: op.tokenId } })`. User lands on the Send page with the same token preselected; recipient + amount fields blank (we don't persist those on the journal record — would require a schema expansion that's out of scope here).

Acceptable v1: user has to re-enter recipient + amount. The token preselection saves ~half the typing. Q4 below asks whether to persist more retry context on the journal record.

### Wire-up

`journal-state.ts` util gains a `retryable: boolean` field on `JournalTerminalDisplay`:
- `interrupted` + `op.kind === "transfer"` → `retryable: true`, plus exposes `op.tokenId` via the existing record passed to the caller
- everything else → `retryable: false`

`TransactionTerminalCard`:
- Prop: `retryable: boolean` (default false)
- Emit: `retry` event
- Template: secondary row gains `<button v-if="retryable" @click="emit('retry')">Try again</button>`

`RecentActivityView` + `TransactionsList`:
- Pass `retryable` per-record (from the util)
- Pass the record to the parent on `@retry`
- Parent: `router.push({ path: "/popup/send", query: { tokenId: op.tokenId } })`

## UX copy summary

| Where | Copy | Alternatives considered |
|---|---|---|
| Cancel button | **Cancel** | Stop |
| Retry button | **Try again** | Retry |
| Interrupted subtitle (unchanged) | Transaction was interrupted | — |
| Cancelled subtitle (unchanged) | Cancelled | — |
| Failed subtitle (unchanged) | per-kind: Network error / Simulation failed / Couldn't generate proof / Transaction failed | — |

## Test plan

**Principle (per user direction):** succinctness. One assertion per behavior. Negative cases where they distinguish a real bug from a "we got lucky" pass. No double-coverage of internal helpers via component tests if a unit test already pins them.

### Unit tests (component-level)

**`packages/extension/src/utils/journal-state.test.ts`** — add to the existing 16-case suite:
- `retryable: true` for `interrupted` + `transfer` kind
- `retryable: false` for `interrupted` + `dapp_execute` kind
- `retryable: false` for `cancelled`
- `retryable: false` for `failed` (any kind)

4 new cases.

**`packages/extension/src/components/composite/activity/TransactionAwaitingCard.test.ts`** — add:
- Renders `Cancel` button when `cancellable: true && jobId: string`
- Does NOT render the button when `cancellable: false`
- Does NOT render the button when `cancellable: true && jobId: null` (defensive)
- Clicking the button emits `cancel`

4 new cases.

**`packages/extension/src/components/composite/activity/TransactionTerminalCard.test.ts`** — add:
- Renders `Try again` button when `retryable: true`
- Does NOT render the button when `retryable: false`
- Clicking the button emits `retry`

3 new cases.

**Update existing `TransactionTerminalCard.test.ts`** to use the new icon names (currently asserts `circle-minus` / `refresh-cw` — wrong, but tests still pass because the assertion matches the same wrong string the component renders). Switch expected icon names to `cancel` / `refresh-circle`.

**Update existing `Storybook` stories** for the same icon names.

**Total: 11 new + 3 modified test cases.** That's not over-coverage — each adds one piece of regression protection.

### E2E tests

After consideration, **no new e2e tests for this iteration.**

Rationale:
- Cancel pre-submit is already manually-QA'd path; SW `cancelJob` has unit coverage in `feesettings-invariant.test.ts` family (well, in service.ts implicit via Phase 2 W2 tests).
- Retry button is a one-liner `router.push` — no useful integration to catch beyond the component test.
- Adding a network e2e for `cancel mid-prove` would take 5+ min per run and the regression risk is low (cancelJob is well-isolated).
- User principle: tests have value when they prove the implementation works. The 11 unit cases above prove it. Network e2e doesn't add value here proportional to its cost.

**Existing e2e tests** — none should break. The cancel + retry surfaces are additive UI; nothing they exercise changes contract-wise. We'll run `bun run test:e2e` (non-network) once during validation to confirm no incidental breakage.

### Manual QA scenarios

1. **Cancel pre-submit**: start a send, click Cancel during "Generating proof". Card flips to Cancelled within ~100ms.
2. **Cancel late (submitting)**: very tight timing window; click Cancel right as the prove completes. Expected: card stays awaiting, then transitions to Succeeded (chain) or Failed naturally. No mid-state weirdness.
3. **Retry from interrupted (transfer)**: trigger SW-restart-mid-prove on a UI transfer. Click "Try again" on the resulting Interrupted card. Navigates to Send page with the same token preselected.
4. **Retry button absent on Interrupted dApp**: SW-restart-mid-prove on a dApp swap. Verify Interrupted card shows but NO "Try again" button (dApp can't be replayed).
5. **Icon rendering**: visual check — Cancelled shows `cancel` glyph, Interrupted shows `refresh-circle`, Failed shows `close-circle`. No more empty badge box.

## Rollout

Three commits in order:

1. **Phase 1** — Icon name fixes in `journal-state.ts` + Storybook stories + existing tests. Pure correctness fix; no new tests. ~5 min of work.
2. **Phase 2** — Cancel button on awaiting card + wire in `RecentActivityView`. 4 new unit tests.
3. **Phase 3** — Retry button on terminal card + wire in `RecentActivityView` + `TransactionsList` + extend `journal-state.ts` with `retryable` flag. 7 new unit tests.

Each commit independently passes `bun run audit:vue`.

Bump version `0.15.3 → 0.15.4` in the final commit.

## v2 changes (post-audit consolidation)

### Hard fixes folded in

**H1 — Cancel button never shows for UI transfers (both audits flagged).**
v1 plan said "Cancel button only on the journal-driven awaiting branch". But `RecentActivityView` template renders `executingTask` first (`v-if`) and journal second (`v-else-if`). For UI transfers, both exist simultaneously, so `executingTask` wins and the Cancel button never appears for the most cancellable flow.

**v2 fix:** Re-architect the awaiting render. The journal record is canonical for "in-flight" (per the W5 doc at L181-196 of the file). `executingTask` becomes pure subtitle enrichment. Concretely: render `<TransactionAwaitingCard>` whenever `topJournalOp` exists, using the journal record for title/originLabel/cancellable+jobId; use `executingTask`'s subtask labels for `subtitle` ONLY (fall back to stage-derived subtitle otherwise). The `executingTask`-only branch becomes legacy fallback for the rare case where a task exists without a journal record.

**H2 — Cancel-during-submitting silent no-op (both audits flagged).**
v1 plan said "silently no-op + journal flips naturally". Both audits called this out as user-hostile (the QA path that's actually likely to happen).

**v2 fix (codex's call — cleaner than opus's toast):** Hide the Cancel button when `topJournalOp.progress.stage === "submitting"`. The popup already knows the stage; the FSM forbids `submitting → cancelled` anyway. Removing the affordance is structurally honest — there's nothing to cancel anymore.

**H3 — Retry emit payload missing (opus flagged).**
v1 implied a no-arg emit; parent would have to re-lookup the op. v2: `emit("retry", op)`. Parent receives the OperationRecord directly and routes `/popup/send?tokenId=op.tokenId`.

### Should-fix folded in

- **defineEmits explicit.** Add `const emit = defineEmits(["cancel"])` / `["retry"]` to the cards. Prevents attribute fallthrough onto root.
- **Untyped `defineProps({...})` convention.** Match the existing TransactionAwaitingCard pattern (no `lang="ts"`, no `PropType<X | null>`). Spell out `{ type: String, default: null }` shape for the implementor.
- **Icon constants.** Extract to `const ICONS = { cancelled: "cancel", interrupted: "refresh-circle", failed: "close-circle" } as const` inside `journal-state.ts`. Prevents another invented-name regression. (opus N2)
- **Stale spec comment.** `execution/spec.ts:72-76` still describes the pre-W2 contradictory cancel behavior. Update to describe current contract. (codex catch)
- **3 added unit cases (opus S7) + 2 wire-tests (codex M4):**
  - `journal-state.test.ts`: icon-name regression pin per state (catches future invented-name).
  - `journal-state.test.ts`: retry payload includes tokenId for interrupted-transfer.
  - `RecentActivityView`: `@cancel` calls `executionService.cancelJob(topJournalOp.id)` with the *current* id captured at emit-time.
  - `RecentActivityView`: `@retry` calls `router.push({ path: "/popup/send", query: { tokenId } })`.
- **New Storybook story for `TransactionAwaitingCard` with `cancellable: true`** (opus N1).

### Endorsed without change

- 3-phase rollout (icons → cancel → retry).
- 5-minute terminal window on home; Archives forever.
- Retry restricted to `interrupted + op.kind === "transfer"`. Don't retry dApp-execute (no replay path). Don't retry Failed in v1.
- Inline secondary-row placement for Cancel + Retry buttons (top-right is owned by the badge + title-trailing slot).
- `journalRecordInScope` network gate.
- Token-only retry context — don't expand the journal schema to persist recipient + amount. The user came back to a 5-min-old card; re-entry is acceptable.

### Out of scope for v2 (explicit deferrals)

- Retry surface inside Archives (`TransactionsList`). Codex's point: the row model + `activity.vue` would need to plumb the emit through. Keep Archives display-only for now — users in History are looking at "what happened", not deciding "what to do next". If feedback suggests otherwise, add in a v3.
- Retry on Failed cards. Per-kind retry semantics (network → retry helps; simulation → won't help) need their own UX cut.

## v3 changes — placement override

User overrode the v2 placement (both auditors had picked inline secondary-row). User's argument: secondary row is already tight (subtitle + originLabel chip + potential button = 3 elements competing for ~280px). Top-right icon button is space-efficient and matches universal close/retry affordance conventions.

### Revised placement

- **Cancel surface (awaiting card):** absolute-positioned icon button at top-right corner of the card. Icon: <code>close</code> (X glyph, gray). 16-18px icon inside a 32px hit area (a11y). aria-label: <code>"Cancel transaction"</code>.
- **Retry surface (terminal card):** same absolute-positioned slot. Icon: <code>refresh</code> (rotating arrow, accent color). 32px hit area. aria-label: <code>"Retry transaction"</code>.
- **Layout impact:** TransactionCardLayout adds an `#actions` slot positioned absolute top-right (8px from top + right edges). Cards that don't use the slot render unchanged.
- **Amount-column overlap:** UI transfer cards have an amount column on the right (e.g. `5.00 USDC`). The top-right action button will sit above the amount text. We accept slight visual overlap; alternative is to add 24px of top padding to the amount column when actions are present (defer to first visual test).

### Resolved by the icon-only choice

| Concern | v2 status | v3 resolution |
|---|---|---|
| Q2 "Cancel vs Stop" copy | Open user decision | **Dissolved.** Icon-only, no visible text. aria-label = "Cancel transaction" (standard accessibility convention). Opus's "overloaded with dApp reject" concern doesn't apply when no word is shown. |
| Codex's "top-right reads as dismiss" critique | Argued for inline | **Mitigated.** With distinct glyphs (X vs refresh), the user reads the action by icon meaning, not by position-implied "dismiss". The X on an in-flight card unambiguously means "stop this thing"; refresh on an interrupted card unambiguously means "try again". |
| Opus's "top-right owned by badge" critique | Argued for inline | **Different position.** The badge is in the LEFT activity-icon column (on the icon corner). The amount column lives in the right column. The action button at the card root's top-right corner doesn't conflict with badge — it overlays the top of the amount column (acceptable trade-off, see above). |
| 32px hit-target a11y concern (opus S5) | Required regardless of placement | **Carries over.** 32px hit area is non-negotiable. |

### Layout decision

Add an `#actions` slot to `TransactionCardLayout.vue`. Cards that need an affordance fill it:

```html
<!-- TransactionCardLayout -->
<Flex ... :class="$style.wrapper">
  ...existing left/title/amount structure...
  <div v-if="$slots.actions" :class="$style.actions">
    <slot name="actions" />
  </div>
</Flex>
```

Styling: `.actions { position: absolute; top: 8px; right: 8px; }`. Wrapper becomes `position: relative`.

The cards register a button into the slot only when their respective conditional fires:
- Awaiting: `cancellable && jobId && stage !== "submitting"`
- Terminal: `retryable` (i.e., interrupted + transfer)

### Re-audit?

Considered. Decision: **no.** Both auditors approved the broader plan. The placement change is a single isolated UX call within a clear scope (top-right icon vs inline link). Auditor concerns about top-right (codex's "reads as dismiss", opus's "owned by badge") were both addressed above. If implementation reveals issues during manual QA, we iterate.

## Resolved decisions (v3 — final)

Decision matrix carried forward to the ELI5 HTML — these are the choices to confirm with the user before implementation:

| # | Question | v1 proposal | v3 resolution | Source |
|---|---|---|---|---|
| Q1 | Cancelled badge icon | `cancel` | `cancel` | both audits |
| Q2 | Cancel button copy | `Cancel` | **No visible text (icon-only)**. aria-label: `"Cancel transaction"` | dissolved by v3 placement |
| Q3 | Retry button copy | `Try again` | **No visible text (icon-only)**. aria-label: `"Retry transaction"` | dissolved by v3 placement |
| Q4 | Retry context | Token-only | Token-only | both audits |
| Q5 | Late-cancel feedback | Silent transition | Hide button at `submitting` | codex M2 |
| Q6 | Cancel on executingTask-only cards | Out of scope | Re-architect: journal primary; executingTask is enrichment | both audits flagged H3 |
| Q7 | Retry on Failed | Defer | Defer | both audits |
| Q8 | Button placement | Secondary-row inline | **Top-right icon button** (32px hit area) | user UX call |
| Q9 | E2E network test | Skip | Skip + 2 wire-tests in RecentActivityView | codex M4 |

**All questions resolved.** No remaining user decisions before implementation kicks off.

## Approval gate

User-facing ELI5 HTML to confirm the v2 resolutions, with one surfaced decision (Q2 copy choice) flagged for explicit user pick. After approval → 3 commits per rollout above.
