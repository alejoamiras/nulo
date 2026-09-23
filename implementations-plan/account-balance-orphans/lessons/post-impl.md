# Post-implementation — review + codex fix loop

## /code-review medium --fix (own pass)

Two findings, fixed in `ea33ba10`:
1. `purgeForAccounts` emit decoration guarded by `tokens.has(id)` alone — a reused id's
   successor could decorate the delete event. Now identity-checked.
2. `requestBalanceRefresh`'s bare pair-find could pick a transient stale duplicate and
   false-report `{missing}` → outbox row deleted while a canonical row exists. Now finds
   the identity-matching row.

## Codex post-impl audit (resumed session, xhigh) — round 1: `reject`

One blocking High + 4 findings, ALL verified true against source before adoption:

- **High**: `purgeForTokens` purges by bare token id; a RESUMED profile deletion (tombstone
  holds ids; resume runs post-startup) after a crash + id reuse erases a successor
  profile's rows and evicts its live-map entry. Pre-existing hazard the new schema makes
  fixable → `purgeForTokens(tokenIds, profileId)`: typed + raw passes profile-scoped
  (old-shape rows left to the legacy sweep), map eviction only when the current holder
  belongs to the purged profile; coordinator threads `profileId`. Regression test:
  successor's row + live-map entry survive.
- **Medium**: emit-before-delete in both purges violated the repo-wide delete-before-emit
  purge invariant → reordered (fence → delete → identity-guarded emit).
- **Low**: projector's SECOND token lookup (projectChunk cache) dropped the identity guard
  → cache stores the token only when `rowMatchesToken` holds.
- **Low**: relink chain-authority had no regression pin (same-chain fixtures) → new test:
  old row claims chain 1 (allow-listed), restored says chain 2 → dropped.
- **Low**: six stale/provenance comments corrected ("shape unchanged", "cannot express
  chain scoping", "Create-only … neither profile nor chain", two "no profileId" claims,
  "final-codex ordering").

Fixes committed as `a7f401d6`; full services+composables suites, typecheck, lint green.

## Round 2 — verdict: `approve`

"The fixes match the intended behavior. No production correctness findings remain."
Codex explicitly ratified the raw-pass old-shape skip and ruled `profileId` equality the
RIGHT live-map eviction condition (tombstones carry ids, not identities; the deleted
profile id stays reserved + write-fenced, so a stricter identity check could strand a
deleted profile's holder). One Low comment nit (a test comment mislabeled fail-closed
debris as sweep-bound) fixed in the PR-open commit. Loop converged in 2 rounds.
