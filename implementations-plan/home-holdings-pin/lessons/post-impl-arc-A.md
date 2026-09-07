# Arc A — post-implementation codex loop

Base `dev@2a3d2d87`; diff = phases 1–2 (`apps/extension/src` + `tests`). Astra at `high`, read-only,
session `01a0793e-ad76-7842-b60f-f74d9018c920`.

## Round 1 — verdict `reject`, five findings, all verified and taken

1. **High — `BalanceView.vue` stale fetch.** A fetch for account A resolving after the switch to B
   overwrote B's hero (inherited race; only the chain was re-checked after the await). Fix: a fetch
   generation, the scope captured before the await, the list cleared on every scope change, no fetch
   without an account. New case: two deferred fetches resolved out of order.
2. **High — Home rendered rows through the unguarded `TokenCard`.** A `"1.5"` balance survives
   classification as `unknown` and then threw in the card's `BigInt` computed; Arc B had the guarded
   card, Arc A did not. Fix: the hardened `TokenCard.vue` + its test moved down into Arc A (Arc B's
   commit carries the same content and rebases clean). New case: Home mounted with the REAL card
   and two hostile rows — a dash on each, the good row intact.
3. **Medium — `aggregateFiat` skipped a zero-balance row with invalid decimals** before checking
   validity → `partial: false`. Fix: invalid decimals count as a malformed holding. New case.
4. **Low — a malformed pin sorted by name among pins** instead of last. Fix: inside the pinned class
   an unknown row ranks behind every readable pin. New case (`A_BAD` vs `Z_GOOD`).
5. **Low — comments.** Two TokensView comments deleted (a workflow reference and a narration);
   `parseSide`'s contract corrected (absent → `0n`); plan.md's dispose-order sentence corrected to
   match the implementation and `send.vue` (composable disposed BEFORE its client disconnects).

Not taken: nothing. Codex's "looks fine" list (tabs, cap, count, overflow, both live-add guards,
no display-option readers, no new logging) matched the tree.

## Round 2 — verdict `approve with fixes`, four findings, all verified and taken

1. **Medium — a snapshot in flight could still overwrite a newer live event** (the generation only
   fenced other fetches). Fix: any in-scope balance event during a fetch marks it dirty; a dirty
   snapshot is discarded and refetched. New case: add during the fetch, then the empty first
   snapshot resolves → the hero keeps the funded figure and the fetch count is 2.
2. **Medium — clearing the list on a scope change showed `$0.00` (no caption) for the whole
   request.** Fix: an `isLoaded` flag; the figure and the partial caption render only once the
   scope's snapshot landed. New case: empty figure while deferred, the value after.
3. **Low — `TokenCard`'s never-synced branch won over the malformed branch** ("Loading balance…"
   for `updatedAt: 0` + `"1.5"`). Fix: the loading block also requires `!isMalformed`. New case.
4. **Low — plan.md's data-flow section had the other contradictory dispose sentence.** Corrected.

Codex confirmed the round-1 race test fails with the generation check removed.
