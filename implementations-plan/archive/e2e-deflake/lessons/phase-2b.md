# Phase 2 lessons — balance-settle signal (Fix 4) — GATE GREEN

## What raced, what signal now gates it

The old shape hammered `refreshBalances` up to 40× and scanned `document.body` for
"1,000" (false-positive-prone: `$1,000.00`, `11,000`), and — worse — an imported backup
already CARRIES the expected balance with a nonzero `updatedAt`, so a value-only wait
could pass with zero post-import/post-reopen sync. The gate is now: capture the
account's max `updatedAt` BEFORE refreshing (`captureBalanceBaseline`), then require a
row with `updatedAt > baseline` AND the exact raw `publicBalance`
(`waitForFreshBalanceRow`, ≤5 refreshes), then a card-scoped display assertion with the
fiat node excluded (`waitForTokenCardAmount`). Freshness proves the re-projection ran;
the exact row value proves it agreed with the chain; the scoped DOM assert keeps
projection→render proven.

## The starvation bug the gate's own diagnostics caught (design lesson)

First implementation re-kicked a refresh ONLY after observing a completed projection
(some row's `updatedAt` advancing past the last refresh). Red run dumped: the correct
row, `updatedAt` EXACTLY equal to the baseline, "after 1 refresh(es)" in 90s — a
projection that FAILS writes nothing (the token-balance pipeline persists no failure
record; the cold-start work added retry/degraded-cache to the GAS pipeline only), so
"attempt still running" and "attempt failed silently" are indistinguishable from
storage, and a write-gated retry starves forever after one silent failure. Fix: the
re-kick cadence also fires after a bounded 15s projection envelope (queue tick 1s +
≤12-row batch + margin) — the envelope bounds only WHEN TO RE-KICK; the acceptance
signal stays freshness + exact value. The missing failure record is logged in the
ledger as a product observability follow-up (sibling of the `isUpdating` dead branch).

Meta-lesson (process): the first red's failure block was lost to a clipped `tail` —
gate runs now tee full logs to timestamped files; the very next red was
fully diagnosable from its preserved dump. Never run a gate without preserving the
whole log.

## Gate evidence (2026-08-11)

- Post-cadence-fix (`2d116bf`): sw-restart + integrity green 3× consecutively
  (`NULO_E2E_RETRY=0`, proverless, solo; logs preserved at the session scratchpad
  `gate-logs/phase2-*.log`), 4/4 tests each.
- Pre-fix reds preserved: 1 clipped (undiagnosed — superseded by the diagnosed
  recurrence), 1 fully diagnosed (the starvation dump above).
- `bun run lint` + `bun run typecheck` clean.
