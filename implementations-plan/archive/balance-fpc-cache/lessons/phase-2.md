# Phase 2 lessons — the balances store

- **Two real design bugs surfaced by the audited case list on first run** (17/19):
  1. Leg flights needed EPOCH scoping like raw flights — a post-switch ensure was silently *joining* a pre-switch hung leg flight (deadlock under the fence). The audits mandated epoch-stamping for raw flights; the same rule turned out to apply one level up. Keyed `legFlights` by `${key}|${leg}|${epoch}`.
  2. LRU self-eviction: `entryFor` touched the LRU AFTER `evictIfNeeded`, so a brand-new key (untouched, sorts oldest) could evict itself mid-ensure — surfacing as a bogus `EnsureSuperseded`. Touch moved before eviction.
- **Importing the real app.store into a plain store test drags chrome.storage** (`useSyncedRef` at store setup). Mocked app.store with a `reactive` stand-in — the balances store only watches `profile`.
- **Late-attached rejection expectations under fake timers read as unhandled rejections** in the full-suite run (audit:vue flags them even when all tests pass). Attach `expect(p).rejects...` / `.catch` at promise creation, before any timer advance.
- Divergence from plan text, deliberate: `subscribe` does NOT auto-fire `ensure` (the cards call it explicitly on mount — same per-mount RPC, no hidden magic, and it sidesteps the subscribe/peek race codex flagged). Constants/`withTimeout` still imported from fee-helpers; the physical move is Phase 5 cleanup. Both flagged for the post-impl codex round.
- Validation: store suite 20/20 (every mandated case: epoch fence A→B→A + supersede-cancel, raw reuse across timeout, forced non-join, capability traffic matrix, retryDebt lifecycle incl. coexistence + forced-failure, display/verified split, late-peek guard, LRU exemption, sync belt). Gate `bun run audit:vue` exit 0 (3778 tests).
