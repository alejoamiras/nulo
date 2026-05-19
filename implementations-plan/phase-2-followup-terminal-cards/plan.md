# Phase 2 follow-up: journal terminal-state cards + log cleanup

**Status:** plan v2 — codex-reviewed, ready to implement
**Branch target:** `feat/phase-2-durable-jobs` (continuation from `f7c6a2ab`)
**Severity:** UX gap — terminal journal records (cancelled / failed) silently disappear from the popup; user cannot tell what happened. Plus log noise cleanup.

## Two scopes in this plan

### Scope A — Terminal state cards (real UX)

Today the activity area only renders:
- `TransactionAwaitingCard` for in-flight journal records (`terminalAt === null`)
- `TransactionCard` for on-chain transactions from `TransactionService`

Journal records that terminate WITHOUT producing an on-chain tx (cancel pre-submit, SW-restart-killed prove, prover error, network error, etc.) are filtered out by `inFlightJournalOps`. The card vanishes, user has no idea what happened.

### Scope B — `[offscreen:pxe] Error: Client disconnected` boot log spam

14× repeated error log every SW restart. Cosmetic, pre-existing (not Phase 2), but loud. Worth fixing while we're already touching this area.

## Scope A — design

### 3 visual states (collapse 9 `JobError.kind` variants)

User-validated mapping from journal record state → display:

| Visual state | Maps from | Color | Icon | Tone |
|---|---|---|---|---|
| **Cancelled** | `progress.stage === "cancelled"` OR `error.kind === "user_rejected"` | neutral gray | `circle-minus` | "You did this on purpose" |
| **Interrupted** | `error.kind ∈ { sw_restart_post_prove, stale_on_resume, stuck_proving }` | amber | `refresh-cw` | "Recoverable — try again" |
| **Failed** | `error.kind ∈ { network, simulation, prover, popup_bound, transfer, dapp_execute, unknown, ... }` (catch-all) | red | `close-circle` | "Something went wrong" |

The **Interrupted** state is the central new concept — distinguishes "wallet was interrupted" from "your tx was bad."

### Copy

User-locked copy from the discussion:
- **Interrupted subtitle:** `"Transaction was interrupted"`
- **Cancelled subtitle:** `"Cancelled"`
- **Failed subtitle:** kind-specific where useful, generic `"Transaction failed"` fallback:
  - `network` → `"Network error"`
  - `simulation` → `"Simulation failed"`
  - `prover` → `"Couldn't generate proof"`
  - `popup_bound`, `transfer`, `dapp_execute`, `unknown`, anything else → `"Transaction failed"`

Title row stays the same as the in-flight card (token symbol for transfers; humanized `op.title` for dapp_execute).

### Lifetime — option (c): activity area window + Archives forever

User-locked decision:

- **Activity area** (`RecentActivityView` on home/token pages): shows terminal journal records whose `terminalAt` is within the last **5 minutes**, alongside in-flight + recent on-chain settled. After 5 min they age out of this view.
- **Archives** (the existing `/popup/activity` page, "View Archives" link): shows ALL journal terminal records forever, alongside the existing `TransactionService`-driven settled tx list. Grouped by date like the current `TransactionsList`.

5-minute window rationale: long enough for "I closed the popup, came back, the tx was cancelled while I was away → I see what happened on reopen". Short enough that the activity area doesn't fill up with old failure cards over normal use.

## Scope A — implementation

### New files

1. **`packages/extension/src/utils/journal-state.ts`** (+ colocated `.test.ts` + `.stories.ts`)

   Pure mapping function. No Vue, no chrome.*, no service clients — testable in isolation.

   ```ts
   export type JournalTerminalVisualState = "cancelled" | "interrupted" | "failed"

   export interface JournalTerminalDisplay {
     state: JournalTerminalVisualState
     subtitle: string
     icon: string         // material icon name
     color: "gray" | "amber" | "red"
   }

   /** Maps a TERMINAL journal record (`terminalAt !== null`) to its display
    *  shape. Returns null if the record is non-terminal or succeeded — those
    *  paths are handled elsewhere (in-flight card / on-chain TransactionCard). */
   export function journalTerminalDisplay(op: OperationRecord): JournalTerminalDisplay | null
   ```

   Tests: one case per kind in the documented `JobError.kind` set, plus the `progress.stage === "cancelled"` branch, plus the "ignore succeeded" branch, plus unknown-kind fallback to Failed.

2. **`packages/extension/src/components/composite/activity/TransactionTerminalCard.vue`** (+ colocated `.stories.ts`)

   Mirrors `TransactionAwaitingCard.vue` shape. Wraps `TransactionCardLayout` so field positions stay byte-identical with the other activity cards. Props:

   ```ts
   defineProps<{
     title: string
     subtitle: string
     icon: string
     color: "gray" | "amber" | "red"
     originLabel?: string | null
     amount?: string | null
     amountSymbol?: string | null
   }>()
   ```

   Renders state icon (instead of spinner / status icon) in the badge slot. Subtitle goes in the `#secondary` slot.

   Storybook: 3 stories — `Cancelled`, `Interrupted`, `Failed` — one per visual state, with realistic title/subtitle/originLabel combinations.

### Modified files

3. **`packages/extension/src/popup/components/modules/general/RecentActivityView.vue`** (v2 codex correction: respect existing row budget)

   - Add a `TERMINAL_VIEW_WINDOW_MS = 5 * 60_000` constant.
   - Compute `recentlyTerminalJournalOps` parallel to `inFlightJournalOps`: filter records where `terminalAt !== null && now - terminalAt < WINDOW`, sorted newest first. Use the existing `useTicker(60_000)` for time-based reactivity.
   - **Row budget**: the existing code at L40-46 caps settled tx rows at 2 (if any awaiting card is rendered) or 3 (none). Adding `v-for` terminal cards uncapped would balloon the module — codex caught this. The new rule: terminal-card rows COUNT toward the same ~3-row visual budget. Replace the existing cap calc with:
     ```ts
     const inFlightCount = (executingTask.value ? 1 : 0) + (showJournalAwaiting.value ? 1 : 0)
     const terminalCount = recentlyTerminalJournalOps.value.length
     const fallbackAwaiting = props.token ? isTokenAwaitingTx.value : awaitingAccountTxs.value.length > 0
     const usedSlots = inFlightCount + terminalCount + (fallbackAwaiting ? 1 : 0)
     const cap = Math.max(0, 3 - usedSlots)  // settled rows fill the remainder
     return filtered.slice(0, cap)
     ```
   - Render `<TransactionTerminalCard>` for each in `recentlyTerminalJournalOps`, mapping via `journalTerminalDisplay()`. Template order: in-flight awaiting → terminal-recent → settled chain txs (newest at top).
   - Filter inherits the existing account + network scoping from `inFlightJournalOps`.

4. **`packages/extension/src/popup/pages/activity.vue`** + new helper (v2 codex correction: discriminated row model)

   The existing `TransactionsList.vue` (L20-51) assumes every row has `updatedAt`, `hash`, and is clickable into `/popup/tx/:hash`. Journal terminal records have no `hash` (cancelled / failed pre-submit never produced one; SW-restart killed ones never broadcast). A "lightly extend" approach would break the row contract.

   v2 design — build a discriminated row model in `activity.vue`, hand a typed list to a slightly-refactored `TransactionsList`:

   ```ts
   // activity.vue
   type ActivityRow =
     | { type: "tx"; key: string; sortKey: number; tx: Transaction }
     | { type: "journal"; key: string; sortKey: number; op: OperationRecord }
   ```

   Where `sortKey` is `tx.updatedAt` or `op.terminalAt` (we filter to terminal-only journal rows here — non-terminal journal records still live in RecentActivityView). `key` is a stable `tx:${hash}` / `journal:${id}` so Vue keys don't collide.

   Sort by `sortKey` desc; group by `DateTime.fromMillis(sortKey).toFormat(...)` — same date convention as today.

   `TransactionsList.vue` becomes thin: it receives `ActivityRow[]` and renders either `<TransactionCard>` (type="tx") or `<TransactionTerminalCard>` (type="journal"). The route navigation (`router.push('/popup/tx/:hash')`) only applies to the "tx" branch; "journal" rows are non-clickable (no detail page exists for journal terminals yet — out of scope here).

   `activity.vue` instantiates `OperationJournalServiceClient`, fetches all terminal records for the active profile, merges with `TransactionService` txs into the typed row list. Subscribes to journal updates for live changes.

### Tests (v2 expanded per codex)

- **`journal-state.test.ts`** — covers every kind ExecutionService actually emits in the wild, not just the documented "canonical" set:
  - All documented `JobError.kind` values: `user_rejected`, `popup_bound`, `sw_restart_post_prove`, `stale_on_resume`, `stuck_proving`, `network`, `simulation`, `prover`, `unknown`
  - Live catch-alls that `executeTransfer` / `executeAztecSendTx` actually pass through `normalizeError`: `transfer`, `dapp_execute` (`service.ts:546, 1120`) — these flow into the Failed state.
  - `progress.stage === "cancelled"` branch (no `error.kind` required)
  - Succeeded record returns null (the function is for terminal-non-success only)
  - In-flight record returns null
  - Null-error edge: `terminalAt !== null` but `error === null` (impossible by FSM invariant but guard against it anyway)
  - Unknown-kind fallback (e.g. `kind: "future_kind"`) → Failed with generic copy
- **`TransactionTerminalCard.test.ts`** — colocated unit test mirroring the `TransactionAwaitingCard.test.ts` pattern (10+ cases): renders title; renders subtitle; renders the right icon per `color` prop; renders originLabel chip when supplied; suppresses chip when null; amount + amountSymbol render; testId is present. Storybook auto-doc still gets the 3 visual permutations.
- **`TransactionTerminalCard.stories.ts`** — 3 stories (Cancelled / Interrupted / Failed). Lost Pixel snapshots when M6 phase 10 lands.
- **No `journal-state.stories.ts`** — codex caught this: it's a pure function with no visual. Storybook isn't the right tool.
- **RecentActivityView / activity.vue** — no new tests (no harness for these views today); manual smoke via the dev server.

### Manual QA scenarios

After implementation:
1. **Cancel pre-submit:** start a send, hit Cancel during proving → card flips to neutral-gray `Cancelled`.
2. **SW restart mid-prove:** the v0.15.2 repro flow → card now shows amber `Interrupted` with "Transaction was interrupted" instead of disappearing.
3. **Network error during prove:** trigger by killing the RPC mid-prove (or stubbing) → red `Failed` with "Network error" if the error normalizer picks `network`.
4. **Card ages out:** wait 5 min, refresh popup → terminal card gone from home, present in Archives.
5. **Archives shows both:** open `/popup/activity` → see journal terminal records + on-chain settled, correctly date-grouped.

## Scope B — implementation (v2 corrected)

**Codex v2 correction:** plan v1 targeted the wrong file. The disconnect cascade lives in `packages/extension-messaging/src/background/client.ts:69-87` (the SW↔popup/offscreen *port-based* client), NOT `offscreen/client.ts` (RPC-via-sendMessage from SW into offscreen).

### Actual source of the spam

When the SW dies:

1. The offscreen page hosts `ProfileServiceClient` + `LoggerServiceClient` (see `packages/extension/src/offscreen/index.ts:18,41-42`). Both are *background-port* clients (they extend `ServiceClient` from `extension-messaging/background`).
2. Their `chrome.runtime.connect` ports get an `onDisconnect` event.
3. `disconnect()` at `background/client.ts:69` calls `entry.reject(new Error("Client disconnected"))` for every pending request (L80).
4. Each rejection has no caller `.catch()` because most calls into these clients are fire-and-forget (e.g. `LoggerServiceClient.log(...)` called from the console-sniffer in offscreen/index.ts, returns a promise nothing awaits).
5. The unhandled rejections fire `self.onunhandledrejection` in `offscreen/index.ts:27`, which logs `[offscreen:pxe] Error: Client disconnected` for each.

The 14× count = number of pending log/profile RPCs the offscreen had outstanding when the SW died.

`disconnect()` itself already logs the high-level event at `Debug` level (L85: `this.logDebug("Disconnected")`) — that's fine. The noise is purely from the cascade of unhandled rejections.

### Fix

**(B1, corrected) Filter "Client disconnected" in the offscreen's `onunhandledrejection` handler.**

In `packages/extension/src/offscreen/index.ts:27-33`, check whether the rejection's message is `"Client disconnected"` (the canonical message from `background/client.ts:80`). If so, demote to `Debug` log (or skip entirely). All other unhandled rejections still log as `Error` — we're suppressing only the known-benign cascade.

This is structurally honest: the rejection IS expected behavior at SW restart, the callers (LoggerServiceClient.log fire-and-forget) genuinely don't care, and the noise is the only problem.

```ts
// offscreen/index.ts
self.onunhandledrejection = (e: PromiseRejectionEvent) => {
  try {
    // Known-benign cascade: when the SW port closes, every pending
    // background-port RPC rejects with "Client disconnected". Most
    // are fire-and-forget callers (LoggerServiceClient.log from the
    // console-sniffer) that don't attach .catch handlers. The
    // rejection is the expected unwind, not a real failure — log
    // at Debug instead of Error so we don't spam the activity log.
    const reason = e.reason as unknown
    if (reason instanceof Error && reason.message === "Client disconnected") {
      logger.log("pxe", LogLevel.Debug, "background port closed; pending RPCs rejected")
      return
    }
    logger.log("pxe", LogLevel.Error, getErrorData(e.reason))
  } catch {
    // Logger itself may fail if SW is dead — don't cascade
  }
}
```

### Tests

Add a focused test for the new branch. Hard to test the actual unhandledrejection path without a full browser context, but we CAN test the predicate logic: extract the "is this a benign cascade rejection?" check into a tiny exported helper (`isBenignSwDisconnect(reason: unknown): boolean`) and unit-test it. Cases:
- `new Error("Client disconnected")` → true
- `new Error("other failure")` → false
- non-Error reason → false
- null / undefined → false

That gives us regression coverage on the filter without needing to simulate the unhandled-rejection event.

## Rollout (v2)

Four commits, smallest first:

1. **B1 — onunhandledrejection filter** (corrected target). Touches `offscreen/index.ts` + `isBenignSwDisconnect` helper + 4-case test. Tiny diff, lowest risk; immediately quiets the boot log.
2. **A.1 — `journal-state.ts` util** (pure function + 14-case test). Zero coupling, zero integration. No Storybook (per codex — pure function).
3. **A.2 — `TransactionTerminalCard.vue`** + colocated `.test.ts` (10+ cases) + `.stories.ts` (3 visual permutations). Still no integration.
4. **A.3 — wire into `RecentActivityView` + `activity.vue` + thin refactor of `TransactionsList`** to accept the discriminated row model. Integration step; manual QA after this lands.

Each commit independently passes `bun run audit:vue` (typecheck + test + lint + build).

## Out of scope (for this plan)

- The deeper "transient toast on popup mount when last tx ended in failure" UX — user deferred. Can revisit after the activity-area surfacing lands and we see usage.
- Anything that mutates the executable wallet-bridge `Operation` types or the existing FSM.
- Lost Pixel visual-regression assertions (waits on M6 phase 10 framework).
- e2e coverage for the new card (manual QA covers it; e2e for journal terminal states is a Phase 2.5+ thing).

## Codex v1 review — consolidated

**Verdict:** UX direction sound; one hard correctness bug + two under-scoped integration risks in v1.

| # | Concern | Resolution |
|---|---|---|
| 1 | Scope B targeted wrong file. The "Client disconnected" cascade comes from `background/client.ts:80`, not `offscreen/client.ts`. Offscreen-side `ProfileServiceClient` / `LoggerServiceClient` are background-port clients. | Rewrote Scope B: filter in offscreen's `onunhandledrejection` handler via `isBenignSwDisconnect` predicate. Added test scope. |
| 2 | `TransactionsList` can't be "lightly extended" — it assumes hash + click-into-detail. Journal terminal rows have no hash. | Added discriminated row model `ActivityRow = {type:"tx"} | {type:"journal"}` computed in `activity.vue`. `TransactionsList` renders branch per type. |
| 3 | Popup row-budget concern: existing cap caps settled rows at 2 when an awaiting card is present; adding v-for terminal cards bypasses the budget. | Added explicit cap formula treating terminal-card slots as counting toward the 3-row visual budget. |
| 4 | Test scope too light: util should cover `transfer` / `dapp_execute` catch-alls too; `TransactionTerminalCard` warrants colocated `.test.ts` per `TransactionAwaitingCard` precedent. | Expanded `journal-state.test.ts` cases; added colocated `TransactionTerminalCard.test.ts`. Dropped util Storybook story (pure function). |

**Endorsed:** 3 visual states, 5-min window over click-to-dismiss, separate component over parameterizing `TransactionCard`, don't split `stuck_proving` into a 4th UI state.

## Codex v1 review questions — answered

1. Is the **3-state collapse** the right level of granularity, or should `Interrupted` be split further (e.g. `stuck_proving` as its own state vs. SW-restart)?
2. Lifetime: is 5 min the right window, or should we tie it to a different signal (e.g. dismissal-on-click; one-card-per-mount; etc.)?
3. Should `TransactionTerminalCard` be a new component, or can it be parameterized into the existing `TransactionCard` (which already has a reverted/red state)?
4. Is **B1 (log demote)** strictly correct, or are there legitimate "Client disconnected" events that we'd want to keep as `Error` (not Debug)? Specifically: SW-internal disconnects vs. session-ending disconnects.
5. Test scope: is Storybook-only sufficient for the new component, or do we also want a colocated `.test.ts` mounting via `@vue/test-utils`?
6. Anything missed re: implementation order, breaking changes, or coupling I'm not seeing?
