# Planning lessons — shell-identity-fences (batch 6)

## Codex plan audit round 1 (session `01a03882-ebef-7ee0-bcf9-5e63fc914bc5`, xhigh, fresh): REJECT — six findings

1. N-05 as drafted under-implements the fence: capture the FULL `{profileId, networkId, chainId}` scope at entry and compare LIVE scope after every await IN ADDITION to the generation (pre-flush watcher windows); hold the freshly-created account client in a local (not re-dereference mutable `managers.account`); guard immediately before the awaited `syncTransactions` (internally scope-fenced — an outer post-check can't cancel it).
2. My claimed N-08 error behavior is FALSE at current code: the timeout throw lands in a generic branch that silently returns — no toast exists; the latch releases but silently. And wrapping bootstrap in app.vue only prevents the unhandled rejection — the waiter still hangs to timeout. Codex: add an identity-keyed failure SIGNAL (or await/join bootstrap) — reopens Alternative C in bounded form.
3. The 15 s bound is ungrounded: transport RPC bound is 60 s and the analogous import handshake allows 30 s. Also: null-guard `activeProfile?.id`, require `isLogined` in the guard, and RE-CHECK after the `setLastActiveProfileId` await (:128) — A can pass the first guard, park there, resume after B activates, and replace B's managers.
4. N-23: `network.id` is the right identity (records carry networkId; chainId aliases rows). Equality guards don't stop A→B→A — per-loader GENERATIONS. NEW finding: TaskService clears only on PROFILE change, so a same-address NETWORK switch reloads `getTasks()` and address-only `isExecutingTask` accepts the OLD network's transfer; `loadTokens()` shares the gap.
5. N-09: inventory ruled substantively safe and grep-complete except `core.ts:10`'s stale public-API comment; the e2e assertion drops are correct; new-profile-helpers.test.ts's ORDERING pin should be REPLACED (active-account-storage-before-route), not deleted.
6. Test strategy silently revertible: ten primitive tests can't prove app.vue wires the fence — EXTRACT the watcher orchestration into a testable unit and pin deferred rapid switches, profile drift, ABA. Smoke/network happy paths are not discriminating.

Holding rev 2 until the parallel Fable audit lands.

## Fable plan audit round 1 (parallel): APPROVE-WITH-CHANGES — eight findings, all adopted

Highlights: the check-after-assign trap in my own fence wording (a literally-followed plan ships a broken fence green); the never-falsy scopeKey (template-stringified undefined kills the not-ready guard and RPC-storms bootstrap); rev 1's false claim about auth.vue's catch→toast (no toast exists; a blanket one would regress deliberately-silenced benign classes); the 30 s empirical envelope; and the decisive find — `waitForProfileActive` already exists, tested, and replaces the hand-rolled wait + guard in one call. Full transcript in audit-fable.md.

Cross-audit observations: zero contradictions between the two round-1 legs — every finding overlapped or complemented. Two adjudicated calls logged in the ledger: (1) bootstrap-failure waiter signaling — codex's signal/join vs fable's bounded-wait + shell toast → fable's smaller shape adopted; (2) codex's newly-found cross-network task gap → OUT of scope (adjudicated-Low finding; requires a TransferContent schema change), watcher-clear improvement kept, residual documented — flagged for final-pass ratification.

Meta-lesson: the plan-audit round caught THREE false claims in my own rev 1 (the catch→toast path, the scopeKey shape, the "existing pattern" fidelity) — all from writing plan prose against remembered rather than re-read code. Rev-1 plans must quote, not paraphrase, the code they patch.
