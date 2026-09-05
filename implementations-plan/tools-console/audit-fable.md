# Fable audit — round 1 (plan A vs outline B)

Reviewer: the independent top-tier Claude planning subagent (Fable). Read recon.md, plan.md, outline-b.md and the touched code. Verdict at the end. Line citations were re-verified by the main agent before adoption (see plan.md § Decision ledger).

## A. Assumption attack

**Facts**
- LOW `plan.md` Facts 1–9 — cited lines check out (`SendView.vue:42`, `tools-smoke.test.ts:270-279`, `SendWizard.vue:974`, `useBridgeJournal.ts:1462`, `BridgeJournalCard.vue:184-265`, 86 card tests, resolver `Flex` only, `frame-ancestors 'none'` at `vite.config.ts:115`). One stale comment worth knowing: `useBridgeJournal.ts:1460` still says "completed-and-graced cards are hidden"; code only excludes `activeFlowId`.
- MED plan states "the card gates CLAIM on `syncing`". Wrong frame: `BridgeJournalCard.vue:189` passes `claimable: rt.claimable ?? !!rec.leafIndex`, so an idle record with a leaf derives `claimable`, never `syncing`. `syncing` for idle records exists only in `bridge-steps.ts:88` (`deriveSendDepositStage(rec, { claimable: rt.claimable })`). Two derivations already disagree; the plan's classifier picks a stage the extracted state never yields.

**Inferences**
- HIGH Inference 1 — reject. `rt.claimable` is written only inside a live claim (`useBridgeJournal.ts:825`) and `syncBlock` only inside the countdown (`:1038-1042`); the lock cleanup at `:635` clears `busy/step/stepDetail` only, so `syncBlock` is stale evidence after any run. After a reload `resumeSessionWork` (`:1450-1456`) skips non-session-live records. Result: an idle leaf-bearing deposit sits in **Running** forever, never badges, never auto-opens, while the page card shows CLAIM. The dock must follow the card: `busy → running; completedAt → done; else needs-you`.
- HIGH Inference 2 — the "3b" pin is not the risk; the Activity page is. `SendView` is `v-show`-hidden on Activity, so the stepper is off screen, yet the page keeps `visibleRecords` and hides the foregrounded record: the one running send vanishes from the page named Activity. Both lists must read `records` and mark the foreground; `BridgeJournal.test.ts:125` flips accordingly.
- MED — the foregrounded record with `attention` set counts as needs-you: stepper RETRY (accent) + dock CLAIM (accent) + auto-open for a record already on screen. Exclude the foreground id from the count and auto-open while `section === 'send'`.
- MED — reload resets `seenNeedsYou`, and a `blocked` record is needs-you forever (`BridgeJournalCard.vue:203`), so the dock force-opens on every load until DISCARD. Key the seen-set on `id+updatedAt` and persist it beside the preference, or exempt blocked records.

**Asks silently assumed**
- HIGH `ActivityAction` includes `"discard"` and recon rows say "DISCARD only", yet the dock "shows none of them". If a needs-you row renders DISCARD, it is one click with no arm step (`BridgeJournalCard.vue:46-56,306-312`) on a private deposit's only secret. Decide: blocked/stuck rows show a word ("Blocked") and route to the page.
- MED — whether auto-open persists `open=true`. If it writes the preference, an auto event overrides the user's choice on the next reload. Auto-open should be session-only.

## B. Implementation critique

- HIGH `useJournalRecord` as a *composable* instantiated in "a `computed` map keyed by id" is unsafe: the card's state includes `watch` (`BridgeJournalCard.vue:50-56,165-171`, the latter `immediate` and network-hitting) and `useNow`. Watchers created inside a computed getter run outside any effect scope, never stop, and are re-created on every re-evaluation; `reconcileFuelConsumed` would fire once per surface. Fix: extract a **pure** `recordState(record, rt, wallet)` into `lib/` (no watchers, no `discardArmed`/`fuelRecovering`); card and row wrap it in computeds and keep their own UI state; the reconcile watcher stays in the card. That keeps A's single decision table without B's drift and without lifecycle hazards.
- HIGH contradiction: "hidden → `DockStrip`" unmounts the `BridgeJournal toasts=true` owner in the *default* state; completion toasts for backgrounded sends are lost. The watcher (`BridgeJournal.vue:71-96`) is not a rendering concern; `BridgeJournal.test.ts:6-7` already documents its zombie fragility. Take B's move: `useCompletionToasts()` called once from `AppShell`; drop the `toasts` prop and the `data-toasts` test attribute (a production hook that exists only for a test).
- MED `density` is a false seam. Dock and page share nothing but the singleton: different sort, no RESTORE, no header, different empty. Make `ActivityDock` its own component over `useActivityFeed()` + `lib/activity.ts`; leave `BridgeJournal` as the page list.
- MED `useShell.section` as a module singleton replaces the per-mount `tab` ref (`AppShell.vue:22`). `tools-smoke.test.ts:171-175` resets modules by hand and 3b leaves `section='send'` for test 4. Add `__resetShellForTests`/`__resetDockStateForTests` and call them.
- LOW `switchLabel`/`age` (copy, clock) leak into a state interface; classify should take `ownedByOther: boolean`, not `acct`.
- LOW N compact rails on the Activity page each pulse; criterion 3 needs the compact rail pulse-free and `prefers-reduced-motion` honoured.
- Reuse: `BridgePhaseRail compact`, `SectionLabel`, `AccountSwitcher` are correctly kept; no duplication found. Complexity: `classify` written as a flat early-return table stays under 15; the risk is `ActivityDock`'s watch+grouping+overlay if written in one setup block of helpers.

## C. Adversarial / security

- HIGH — one-click DISCARD in the dock (above).
- MED — dock row CLAIM/SWITCH must honour `opsBusy` like `BridgeJournalCard.vue:369,417`; `switchActiveAccount` rejects while busy, but an enabled no-op button is still wrong.
- LOW — cross-tab `storage` reload (`useBridgeJournal.ts:298-301`) makes another tab's needs-you auto-open this tab's dock; acceptable, document it.
- Trust boundaries hold: records are quarantined on load (`:293`), `nulo:tools-dock` is allowlisted, all record strings render as text, CSP unchanged, no new deps.

## D. Gates + sequencing

- MED the frozen-step diff runs only at Phase 4; Phase 2 edits `SendView`/`WizardShell` neighbours. Run it at every gate.
- MED Phase 1 touches the card that `send-smoke` renders but skips `<smoke>`; add it (cheap).
- MED missing tests: (1) a completion toasts while dock hidden on Faucet; (2) classify parity pin vs the card's `showClaim/showFinish` per recon row; (3) foreground record listed on Activity and excluded from count; (4) dock hide moves focus to the strip; (5) a testid sweep for `RailNav`/`DockStrip`/`ActivityRow` (`testid-coverage.test.ts` is send-scoped).
- LOW repo rule says `bun run audit:vue` before a UI PR; Phase 5 runs `build:testnet` only.
- Ordering: move `useCompletionToasts` to Phase 1 so the owner invariant holds at every phase boundary.

## E. Verdict

VERDICT: conditional approve — conditions: hybrid = plan A's structure with (1) `useJournalRecord` replaced by a pure `recordState()` in `lib/` (no watchers) shared by card and row; (2) classify follows the card exactly (drop the `syncing` refinement); (3) B's `useCompletionToasts()` in `AppShell`, `toasts` prop and `data-toasts` removed; (4) `ActivityDock` as its own component, no `density` prop; (5) both lists read `records`, mark the foreground, exclude it from count/auto-open on Send; (6) no DISCARD in the dock; (7) test resets for the new singletons and the missing tests in D.
