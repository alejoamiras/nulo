# Competing outline B — "Shell first, journal untouched"

Same target, different cut: land the visible shell in one pass and keep the journal engine and card exactly as they are, driving the dock from a thin read-only projection instead of extracting the card's state.

## Shape

- `AppShell.vue` becomes the grid (rail | main | dock). `RailNav`, `SectionHeader`, `DockStrip` as in plan A.
- **No `useJournalRecord` extraction.** The dock renders `ActivityRow` from a *projection* computed in a new `composables/useActivityFeed.ts` that reads `useBridgeJournal().records` + `runtime` and re-derives only what a row shows: stage (via the bridge-core `derive*Stage` functions), `busy`, `attention`, `blocked`, `completedAt`, phase word, age. Grouping = `busy → running; completedAt → done; else needs-you`, with `syncing`/`proving` idle records as running. No action gates are re-derived: the row's single button dispatches straight to `journal.runDepositClaim` / `runWithdrawConsume` for needs-you records that are not blocked and not owned by another account; every other case (retry wording, switch account, claim gas, discard) is left to the page card.
- **Activity page = today's `BridgeJournal` moved as-is** (cards, actions, empty state) into `ActivityView.vue`, with the first-visit state swapped in when there are no records. The dock is a second, read-mostly view of the same singleton; `BridgeJournal` stays the toast owner on the page and is `v-if`-mounted only on Activity — so the toast watcher runs only while the page is open. To keep completion toasts everywhere, the watcher moves out of `BridgeJournal` into `AppShell` (one call to a new `useCompletionToasts()` extracted verbatim).
- `StepStrip` vertical variant, `WizardShell` card head, glow budget, wallet chip flattening, responsive rules: as in plan A.

## Phases

1. Shell + rail + header + sections (+ `useShell`, `useDockState`) — gate: lint/typecheck/unit/smoke.
2. Dock with the projection feed + strip + badge — gate: lint/typecheck/unit/smoke.
3. Wizard card + stepper + glow budget — gate: lint/typecheck/unit/smoke + frozen-step diff empty.
4. Preview walk + docs.

## Where it wins

- Smaller diff on the 720-line card (zero) and the 86 card tests are not touched at all.
- The dock cannot regress the page's action logic because it does not share it.

## Where it loses

- Two derivations of "what can this record do" (the card's gates and the feed's simplified rule) drift: the dock may show CLAIM where the card would show RETRY or SWITCH, or hide an action the card offers. The plan-A extraction removes that class of bug.
- The completion-toast watcher moves out of the component that has owned it since the faucet plan; the "3b" smoke pin and `BridgeJournal.test.ts` toast tests move with it.
- The needs-you count (the badge) is computed from the simplified rule, so it can disagree with the number of CLAIM/FINISH buttons on the page.

## Verdict sought from the audits

Is the dedup in plan A worth touching the card, or is the projection's simplicity (and its accepted drift) the better trade for a testnet tool?
