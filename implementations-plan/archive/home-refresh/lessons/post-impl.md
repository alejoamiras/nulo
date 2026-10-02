# Post-implementation review loop — home-refresh

## /code-review max --fix (own pass over the net diff)

Two findings, fixed in a separate commit (`fix(home): theme-safe dot glow via color-mix, document
threshold-crossing precedence`):
1. **Real bug**: the dot's glow `box-shadow` hardcoded the DARK theme's bone rgba — invisible/wrong
   in light theme (the dot itself already used `var(--nulo-accent)`). Fix:
   `color-mix(in srgb, var(--nulo-accent) 35%, transparent)`.
2. Readability: the `>=`-vs-`!==` precedence-reliant crossing comparison. Parens were REJECTED by
   the pre-commit biome formatter (it strips redundant parens) — documented with a comment instead.
   Lesson: clarity-parens fights the formatter here; comment or restructure, don't parenthesize.

Verified pre-existing (NOT touched, per no-over-engineering): TokenCard's `hasPrivate`/`hasPublic`/
`DateTime`/`handleRefreshBalance` dead symbols predate this diff at the fork point.

## Codex post-impl audit (fresh session, gpt-5.6-sol @ xhigh)

Round 1: **approve**, zero production/security bugs. Explicitly validated: coverage-watermark
monotonicity across completed/partial/dropped branches, reconciliation override, both-way threshold
crossings, snapshot-before-dedup ordering, TokensView safe-integer gate, clipboard sanitize/await/
failure path, base.css hash legitimacy, untouched e2e helpers. Two Low test-hardening asks:
1. `PublicScanCursorSchema` round-trip pinning `lastCoveredBlock` + `reconciling` (the in-memory
   test seeding bypasses the repository's parse — a schema regression would have stayed green).
2. Same-bucket drift case should also assert `getSyncState()` advanced (the always-fresh-snapshot
   invariant, directly pinning their round-1 finding).

Both applied (`test(incoming): pin schema round-trip of coverage watermark + always-fresh snapshot
lag`; scenarios file 122 green). Round 2 (resumed with the fix diff): **"No new material findings…
converged."**

Loop converged in one round.
