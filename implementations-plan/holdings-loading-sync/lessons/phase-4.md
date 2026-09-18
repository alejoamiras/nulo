# Phase 4 — hero total

**Gate (2026-09-17):** `bun run lint` exit 0 · `bun run typecheck:all` exit 0 · `bun run --cwd apps/extension test src/popup/components/modules/general/BalanceView` 1 file / 24 tests passed (14 existing, unchanged, + 10 new). Beyond the gate: `bun run --cwd apps/extension test src/popup` 94 files / 885 tests passed.

## Inference I3 — verified, no fix needed

Both terminal projection paths persist `syncFailure` onto the row: the per-row error (`balance-job-queue.ts` `applyProjectedError` → `writeSyncFailure`) and the whole-batch projector throw (`failBatchOnProjectorError` → `writeSyncFailure`). A transient failure with retry budget left deliberately writes nothing — it is not terminal, a retry is parked. The only silent skips are rows fenced out (deleted, foreign-profile, superseded generation), which are not rows the hero is waiting on; never-projected rows that survive a worker death are re-queued by `reconcile-pairs`. The 12 s cap bounds whatever is left.

## What landed

- `heroPending = (balances not loaded ∨ seed status not loaded ∨ a row with updatedAt === 0 and no syncFailure ∨ a default pending|seeding) ∧ cap not elapsed`.
- One 12 s cap per scope (restarted on mount and on every account/chain change). After it, one question decides the figure: did any snapshot succeed for this scope? Yes → the aggregate of what is known (a loaded empty list is a real `$0.00`). No — rejected or still unanswered → `—` (`balance-hero-unknown`), never `$0.00`.
- `BalanceView` now has the same three-state snapshot as `TokensView`: a rejection is retried once after 2 s and again on reconnect, and a refetch inside a scope keeps the rows it has. Before this, every reconnect blanked the hero.
- Skeleton 150×40 under `balance-hero-loading`, `aria-busy` on the figure's container; "priced assets only" only ever accompanies a shown aggregate.
- The token page's hero is untouched (pinned by a test that feeds it every "pending" signal at once).

## Lessons

- **The cap is per scope, not per pending episode.** Re-arming it whenever something becomes pending again would let a slow default re-hide a total the user has already read. After the cap a late row simply changes the number.
- `markDirty` no longer checks `isLoaded`: the fetch resets the flag when it starts, so an event outside a fetch is a no-op by construction.
- Existing fixtures carry no `updatedAt`, so `updatedAt === 0` is false for them and all 14 existing cases passed without edits — the new rule cannot hide a figure for a row shape that merely lacks the field.

## Open for the owner (goes in the PR body)

- The `—` state is the one UI item added after the owner's selections (plan § Asks). It renders only when the balance list could not be read at all for 12 s.
- The `Skeleton` primitive keeps the gas card's existing shimmer (surface-high → surface, 1.5 s) rather than the canvas's (surface-low → surface-high, 1.4 s eased), so adopting it changed nothing on the gas card. The new skeletons therefore differ from the canvas by that shimmer tone only.
