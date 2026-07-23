# Planning brief — account-switch cross-account isolation (item 3 / PR-D)

You are producing an INDEPENDENT implementation plan for a bug fix in the **Nulo** repo — a Chrome
extension Aztec wallet (Vue 3 + TypeScript, Bun, Vitest + Puppeteer e2e). Draft against this brief;
another planner (codex) and the main agent are drafting the same task in parallel — diversity is the
point, so commit to a clear approach and defend it.

## The bug (item 3, deliberately split from the wallet-ux-fixes PR as the highest-risk item)

On **account switch** within a profile, the transaction feed leaks state across accounts:

1. **Stale history** — the feed briefly (or persistently) shows the PREVIOUS account's transactions
   after switching.
2. **Incoming-transfer leak (PRIVACY, the core issue)** — the incoming-transfer poller runs a
   singleflight scheduler per `(networkId, accountAddress)`. An in-flight tick / emission for account
   A can land AFTER the user switches to account B and paint A's received transfers into B's active
   feed. This is a cross-account privacy leak, not cosmetics.
3. **Task/cancellation mis-scoping** — `clearExecutingTaskIfPendingCancelTerminal`,
   `pendingCancelJobIds`, and `onTxAdded`'s awaiting-placeholder cleanup are keyed on "whatever account
   is active now", so an A-side cancellation/terminal event can clear B's executing task.
4. **Data-model gap (root cause)** — `awaitingTransactions` / `journalOps` / `executingTask` are held
   as flat active-view state, NOT keyed by account. A late async result from A has nowhere to go but
   the active view. This gap is what makes 1–3 possible.

### Surfaces (verify line numbers yourself; the tree may have shifted)

- `apps/extension/src/popup/components/modules/general/RecentActivityView.vue` (~878 lines) — the feed
  component. Already has PARTIAL scoping: `op.accountAddress !== appStore.account?.address` guards, a
  `scope: () => ({ profileId, networkId, account })`, `isMatchingTask(..., appStore.account?.address)`.
  The gap is the RACE WINDOW during switch + the flat state model.
- `apps/extension/src/popup/components/modules/general/recent-activity-handlers.ts` (~114 lines).
- `apps/extension/src/wallet/services/incoming-transfer/service.ts` (~841 lines) — per-
  `(networkId, accountAddress)` singleflight scheduler; comments already mention detecting a "stale
  snapshot" in the per-note critical section. Understand its emit path to the UI.
- `apps/extension/src/popup/pages/activity.vue` — the full-page feed (shares the `scope`/reload logic
  "verbatim" with RecentActivityView per a comment).
- `apps/extension/src/components/composite/activity/*` + `modules/activity/{TransactionCard,TransactionsList}.vue`.
- The app store (`src/stores/app.store.ts`): `account`, `accounts`, `awaitingTransactions`.

## Decided scope (from the user)

- **All four facets are IN scope**, including the data-model gap.
- **Depth is the central open question.** The user's words: *"[structural] is the right approach but it
  would mean changing EVERYTHING and scares me a lot. Do the research and if it's too high risk… IDK."*
  So: evaluate BOTH — (A) targeted race-guards (captured-generation token bumped on switch; every async
  result checks its captured generation before mutating view state; incoming-transfer emissions filtered
  by active account at INGEST; hard state reset on switch) vs (B) structural per-account state model
  (`Map<accountAddress, {awaiting, journalOps, executingTask, pendingCancelJobIds}>`; active view =
  the active account's slice; late results write to their OWN slice, never the active one). **Aim your
  recommendation at a STAGED path that de-risks the big-bang** — if structural is right, sequence it so
  each phase is independently shippable + tested, not one scary rewrite. If structural is genuinely too
  risky, recommend targeted-guards with the risk stated explicitly.
- **Validation: maximal.** All layers gate the phases: component/unit (Vitest), smoke e2e
  (`bun run test:e2e`), AND a dedicated **network e2e** (`bun run e2e:agent`) that switches accounts
  under LIVE incoming-transfer polling and asserts NO cross-account leak + NO stale history. The user
  explicitly wants this wallet "very thoroughly tested."
- **No `/harden`**; the post-impl audit will be 2–3 independent codex auditors instead of one.

## Required plan shape (all sections mandatory)

- **Phases**, each ending in a concrete **Validation gate** (exact commands from REAL tooling +
  pass criteria + layers exercised). Real commands: `bun run lint`, `bun run typecheck` /
  `typecheck:all`, `bun run test` (unit+component), `bun run test:components`, `bun run test:e2e`
  (smoke), `bun run e2e:agent` (network, parallel-safe, owns anvil+aztec+playground per worktree).
  Early phases build any missing test scaffold (e.g. the account-switch e2e helper) BEFORE the phases
  that depend on it.
- **Security & Adversarial Considerations** — threat model of the cross-account leak: what an attacker
  (a malicious dApp, a crafted incoming note, a same-profile multi-account user) could exploit; least
  privilege; input validation at the incoming-transfer trust boundary; Aztec-specific (a note authored
  by anyone can be an incoming transfer — treat sender as untrusted).
- **Assumptions** — Facts (with file:line) / Inferences (labelled) / Asks (surface, don't assume).
- Staged-structural vs targeted-guards **trade-off analysis** with a clear recommendation + risk rating.
- A **network-e2e test design** for proving no leak under live polling (how to force the race
  deterministically: switch while a poll for A is in-flight; assert B's feed never shows A's transfer).

## Adversarial + assumption-attack asks (answer these in your plan)

- What could go wrong? What would an attacker target? What are we trusting that we shouldn't
  (sender identity, note provenance, event ordering, PXE emission timing)?
- Attack the Assumptions: which Facts are misstated, which Inferences unsafe, which Asks are being
  silently assumed?
- Where does the STAGED structural approach still leave a race window mid-migration? Can a phase that's
  "independently shippable" actually leak between phases?
- Concurrency correctness: is a captured-generation token sufficient, or are there emit paths that
  bypass it (direct store mutation from the service, SW-side events, watchers firing out of order)?
- Test adequacy: can the network e2e DETERMINISTICALLY reproduce the race, or will it be flaky? If
  flaky, is it worth having?

Respond with a complete `plan.md`-shaped document.
