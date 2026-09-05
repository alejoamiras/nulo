# Codex audit — round 1 (plan A vs outline B)

Session `01a0717e-2967-7a60-bd53-f3f3afd26b9c`, `gpt-5.6-sol` at `xhigh`, read-only, cwd = the tools-console worktree. Prompt: recon.md + plan.md + outline-b.md + the full audit packet (assumption attack, implementation critique, adversarial, gates). Factual claims re-verified by the main agent before adoption; see plan.md § Decision ledger.

---

## A. Assumption attack

### Facts

- **MED — `plan.md:152`; `send-smoke.test.ts:414-416`:** Fact 1 is half false. The smoke mounts `SendView` with only wallet panels stubbed and explicitly leaves the journal real; it makes no journal-testid assertion.

- **MED — `plan.md:156`; `BridgeJournalCard.test.ts:89-513`:** “86 tests” is false; the file has 42 `it` cases. More importantly, the cited `BridgeJournalCard.vue:184-265` covers stage/CLAIM/FINISH only. Switch, fuel recovery, reconciliation, destructive confirmation, and actions also live at `46-183` and `301-312`.

### Inferences

- **HIGH — `plan.md:163`; `BridgeJournalCard.vue:186-193`; `bridge-steps.ts:85-94`:** Inference 1 has no coherent shared state. The card defaults any record with `leafIndex` to `claimable`, while `stepperPhases` treats the same record with absent runtime as `syncing`. Plan A then proposes extracting the card state while classifying that same state as Running. Establish one canonical presentation rule first. “Needs you” should follow actual user action availability; otherwise the dock contradicts CLAIM.

- **HIGH — `plan.md:164`; `useBridgeJournal.ts:687-692,1460-1462`; `tools-smoke.test.ts:270-279`:** Inference 2 violates the explicit one-surface invariant. The smoke pins one journal list, not merely one toast watcher. Worse, clicking a foreground dock row switches to Activity, whose `visibleRecords` then hides the highlighted record. Use `visibleRecords` in the dock while Send is visible; the Activity page may use `records` because the foreground stepper is then hidden.

- **MED — `plan.md:126,165`:** Reload-opening and the 1100/760 breakpoints are design decisions, not established facts. Opening for an already-pending record contradicts both “hidden by default” and “enters Needs you.”

### Asks

- **HIGH — `plan.md:80,97`; `BridgeJournalCard.vue:452-465`:** Must the dock offer only the signed-off CLAIM affordance, or also RETRY/SWITCH/CLAIM GAS/DISCARD? DISCARD requires two-step confirmation and a private-secret warning.

- **MED — `plan.md:95-96,126`:** Confirm separately: foreground membership by section; whether initial stored Needs-you records auto-open; whether re-entering Needs you after retry may reopen.

- **MED — `SendView.vue:12-16`; `plan.md:49`:** Decide whether Activity/dock exists on bridge-placeholder networks. Moving journal initialization outside the `IS_PLACEHOLDER` gate changes the current “instantiate nothing” invariant.

## B. Implementation critique

- **HIGH — `outline-b.md:8,26-28`:** B’s simplified projection is wrong: it knowingly mislabels RETRY/SWITCH/fuel recovery and dispatches around established UI gates. Choose a hybrid: extract a **pure, side-effect-free record policy**, but build a dedicated dock feed.

- **HIGH — `plan.md:60,95`; `BridgeJournalCard.vue:46-56,165-183`:** Calling `useJournalRecord` inside a computed record map can repeatedly create watchers, timers, and per-instance recovery state. Extract pure derivation only; leave reconciliation, confirmation timers, and effect handlers in components/services.

- **HIGH — `plan.md:80,97`:** The interfaces do not compose: `ActivityAction` includes `discard`, but the proposed composable omits `onDiscard`; it also omits clear, claim-without-fuel, recovery error/busy, and confirmation state. Raw `acct` and UI labels leak presentation into policy.

- **MED — `plan.md:54-58`; `AppShell.vue:14-27`:** `section`, dock visibility, highlighting, and auto-open are one shell controller. Prefer AppShell-owned state exposed through provide/inject; keep only persisted preference helpers in the `useTheme` style. This avoids hostname initialization and session Sets leaking across mounts.

- **MED — `plan.md:91,112`; `BridgeJournal.vue:41-96`:** `density` turns restore, toast, empty-state, sorting, cards, groups, and row dispatch into one branching component. A dedicated `ActivityDock` reading the journal singleton is cleaner and safer for the complexity budget.

- **MED — `plan.md:125`; `BridgeJournal.vue:71-96`:** The toast scheme works only if the actual `BridgeJournal` remains mounted with `v-show`; hiding merely `ActivityDock` is insufficient if its journal is `v-if` on `open`. Add a hidden-dock completion test, or extract one `useCompletionToasts()` call into AppShell.

- **LOW — `plan.md:91`; `SectionLabel.vue:1-18`:** Import `SectionLabel`, not “SectionLabel-style.” Keep `BridgePhaseRail` compact for cards and reuse `stepperPhases`—not its markup—for dock phase words. Reusing `AccountSwitcher` is the correct seam.

## C. Adversarial/security

- **HIGH — `plan.md:97`; `BridgeJournalCard.vue:306-312,452-465`:** A one-click dock DISCARD could destroy the only private recovery blob. Never dispatch it directly.

- **MED — `plan.md:141,147`; `journal.ts:40-65`; `asset-label.ts:22-25`:** `blocked` is persisted attacker-controlled text, contrary to the plan. Journal `displaySymbol` is also rendered without `safeDisplay`; a compact dock without an address increases bidi/look-alike risk. Sanitize and cap all row strings.

- **LOW — `journal.ts:268-307`; `token-list.ts:112-166`; `vite.config.ts:105-123`:** Existing deep validation, fetch caps, Vue text rendering, CSP `frame-ancestors 'none'`, and no new dependencies contain the principal restore/token/XSS/clickjacking risks. Dock actions must still treat classification as display-only and rely on engine validation.

## D. Gates and sequencing

- **MED — `package.json:24`; `apps/tools/package.json:12-15`:** The listed commands exist and lint enforces both budgets.

- **HIGH — `plan.md:182-191`:** Phase 2 removes the current toast owner before Phase 3 adds the dock owner. Move the permanent toast owner in the shell phase.

- **MED — `SendView.test.ts:27-50`:** Phase 2 omits mandatory updates to tests that explicitly require the removed heading, wallets, and journal.

- **HIGH — `send-smoke.test.ts:414-431`:** Keeping `send-smoke` unchanged preserves wizard flows but cannot test header wallets, Activity navigation, dock ownership, or foreground handoff because it mounts `SendView` directly. Add an AppShell integration smoke while retaining this suite for frozen bodies.

- **MED — `plan.md:190-203`:** Add tests for initial-vs-transition auto-open, retry re-entry, cross-tab storage updates, foreground visibility by section, destructive confirmation, hidden completion toast, overlay keyboard/focus behavior, and all frozen testids. The preview walk must include 1100/760 boundaries and keyboard navigation.

VERDICT: conditional approve — conditions: use hybrid “pure shared record policy + dedicated dock feed,” resolve syncing/foreground/initial-auto-open semantics, preserve destructive confirmation, and add shell-level integration coverage