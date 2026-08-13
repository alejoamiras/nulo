# Phase 2 lessons — token list (threshold gate, dot, lock/globe, name subtitle)

## Base drift caught mid-phase

The worktree's TokenCard had evolved past the recon snapshot: bootstrap-route-decouple (#357/#358)
added `isRefreshing` (a bare `.pulse_dot` beside the amount) and `syncFailed` states. Consequences
folded in: the loading gate is `isInitialSync && !syncFailed`, and the catching-up dot's glow is
scoped to `.pulse_dot_wrap .pulse_dot` so the refreshing dot keeps its flat look.

## Test-harness gotchas (worth knowing next time)

- **Module mocks swallow re-exports.** `TokensView.test.ts` mocks the whole incoming-transfer client
  module; the view's new `BACKFILL_INDICATOR_THRESHOLD_BLOCKS` import would have been `undefined`
  (gate silently never true). Fixed by having the mock factory `vi.importActual` the SPEC module and
  re-export the real constant — production policy, not a drifting copy.
- **Auto-import doesn't resolve in every suite.** `BalanceView.test.ts` shallow mounts warn
  "Failed to resolve component: Icon" — the unplugin resolver isn't active there (it IS elsewhere).
  The breakdown test stubs `Icon` explicitly; `icon-stub[name=…]` selectors silently match nothing,
  so assert against your own stub's testid instead.
- **Tooltip in JSDOM**: stubbed with both slots rendered inline (`stub-tooltip-content`), per the
  plan — never drive hover against the teleport target.

## Gate result (2026-08-13)

- `bun run typecheck:all` → exit 0
- `bun run test` → 4036 passed (TokenCard 3 rewrites + name-subtitle case; TokensView threshold
  above/below + hostile-lag sweep (NaN/-5/3.5/∞/2^53/undefined) + caught-up-big-lag; BalanceView
  lock/globe breakdown net-new)
- `bun run --cwd packages/design test` → 299 passed (Tooltip focusin/focusout/delay-bypass/disabled ×4)
- `bun run lint` → 0 errors (fixed my own useOptionalChain warning; pre-existing count restored to 37)
