# Phase 3 lessons — density + decimals

## Formatter drift (plan vs current dev)

The plan targeted `GasBalanceCard.vue`'s inline `maxDecimals: 4`, but #343's stale-while-revalidate
rework consolidated formatting into the shared `formatGasBalance` in `@/utils/fee-estimation`, used
by BOTH the home gas card and the send-flow FeeSettingsCard. Blanket 4→2 would have degraded the
send fee card (a 0.0012 FJ fee balance would read "0.00" — sub-cent amounts carry signal there).
Resolution: `formatGasBalance(raw, maxDecimals = 4)` — single source kept, the home card passes 2
explicitly. Owner's spec said "on the homepage", so scope holds.

## Applied

- Home gas card: 2 decimals (`GasBalanceCard.vue` passes `formatGasBalance(raw, 2)`); gas card
  padding-top 16→12.
- `general.vue` section gap 24→16.
- `TransactionCardLayout.vue` `.wrapper` padding 8→6 (shared: home + Activity page + token detail —
  owner-approved app-wide density).
- `BalanceView` hero margins 32/16→22/10, actions margin-top 16→12.

## Gate result (2026-08-13)

- `bun run typecheck:all` → exit 0
- `bun run test` → 4040 passed (new: GasBalanceCard fractional truncation "42.1239→42.12 FJ" +
  boundary "42.12 stays"; fee-estimation default-4 + explicit-2 formatter cases)
- `bun run lint` → 0 errors (37 pre-existing warnings unchanged)
- Design package untouched this phase (no design-test run required by the gate; last green at 299)
