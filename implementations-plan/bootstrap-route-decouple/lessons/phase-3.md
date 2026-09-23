# Phase 3 lessons — token-balance failure record + TokenCard states

## What landed

`syncFailure?: {at, message}` on `TokenBalanceRaw`/Info/schema; `BalanceJobQueue` writes it on
BOTH error paths via a live-row re-read (`writeSyncFailure` — a deleted row gets no failure
write, so failures can't resurrect rows), bounded at 200 chars, cleared by the next success;
failure commits emit `onTokenBalanceUpdated` with the COMPLETE info (the five listeners all
replace rows from the payload — codex M12). TokenCard: `isUpdating` renders as a pulsing dot
beside the visible amount (`token-balance-refreshing`); a persisted failure dims the last-known
amount + "Couldn't refresh" (`token-balance-failed`), suppressed while a retry is in flight.
The old "no storage write on error" and "no visual change" pins were consciously replaced;
the storage-codecs corpus pins the new optional field.

## Notes

- `isMinting`'s description branch shares the old dead-branch shape — NOTED for the ledger,
  not fixed here (plan scope).
- The token detail page (`tokens/[id].vue`) consumes failure emits safely (row replacement,
  balances unchanged) but renders no failure caption — the general list is the honest surface
  this arc ships; noted as follow-up if the detail page should mirror it.

## Gate evidence (2026-08-12)

`bun run test` 3998 → (post-phase-4: 4014) green; `test:components` 412/412;
lint + typecheck exit 0. Pins updated: `balance-job-queue.test.ts` (4 new cases),
`TokenCard.test.ts` (5 new cases), `storage-codecs.test.ts` corpus.
