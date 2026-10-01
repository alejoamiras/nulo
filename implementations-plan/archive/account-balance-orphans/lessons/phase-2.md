# Phase 2 — complete identity enforcement + reconcile hardening

## What landed

- `rowMatchesToken` widened to structural identity types so the pure `reconcile-pairs`
  module shares the ONE predicate without importing the storage codec types.
- `reconcilePlan`: `ReconcileToken`/`ReconcileRow` carry full identity; a row counts
  toward a desired pair only on full identity; new `staleIdentity` output (live token at
  the id + this profile + mismatch), with foreign-profile and no-live-token rows
  deliberately excluded (the fable carve-out).
- `service.ts` — 13 sites now go through the predicate: queue wiring, `getTokenBalances`,
  `getTokenBalance` (singular — was fail-open), `refreshTokenBalance`,
  `requestBalanceRefresh`, `refreshAccountBalances`, `onTokenUpdated`,
  `onTransactionUpdated`, `backup()` (full-identity join, not profileId-only),
  `ensurePairsHoldingLock` occupancy (mismatched rows no longer hold the slot),
  reconcile stale-identity delete (fence → delete, before repair, no emit —
  the rows were never renderable), log line.
- `balance-job-queue`: `isRowEmittable` takes the row (4 call sites), doc updated.
- `balance-projector`: identity guard added at token resolution (see note below).
- Dead `existsByTokenAndAccount` deleted (repo, repo test, queue-test fake).

## Gate evidence

- lint 0 errors · typecheck 0 errors · `src/wallet/services/` full run + composable
  suite green (see transcript; 1864-test dir run).

## Findings

- **The identity filters found a latent fixture lie**: the B-05 generation-fence test
  seeded profile B's balance row with profile A's identity (factory default). Under
  fail-closed filtering the row correctly vanished — the fixture, not the code, was
  wrong. Exactly the class of pin the plan predicted for `cross-profile-isolation`'s
  `as`-casts (those were stamped with real identity in the same pass).
- **Test-authoring gotchas**: `TokenBalanceInfo.token` is the decorated TokenInfo object,
  not the FK; and a "shared address" test must use an address the account fake actually
  lists, or the reconcile mints a third canonical row and the assertion misreads it.
- The service-level P2 describe pins: dead-incarnation row → deleted + id fenced +
  canonical pair created + only it renders; no-live-token row → left in storage, never
  rendered; shared address → foreign profile's row untouched and invisible.
