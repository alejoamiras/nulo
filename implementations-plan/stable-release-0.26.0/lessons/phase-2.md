# Phase 2 — promote dev → main (PR #320)

**Status:** ▶ in progress — network-e2e flake, re-running.

## Timeline
- PR #320 opened at `RELEASE_SHA=4e5435b`. Title 90 chars. 27/28 checks pass.
- `quality-status` ✓, `smoke-e2e-status` ✓.
- `network-e2e-status` ✗ (run `30060466482`) — **only shard 3/5 failed**, 1 test of 14.

## Failure #1 (classified: FLAKE → re-run)
- Test: `tests/e2e/network/backup-restore-sw-restart.test.ts › a SW restart mid-restore recovers or rolls back cleanly then retries — either way the account syncs on-chain`.
- Error: `[sw-restart-restore] recovery neither reached general nor rolled back within 240s`; parked at `#/popup/auth` (unlock screen), `lastUnlockErr: TimeoutError: Waiting failed: 10000ms exceeded`.
- **Why flake, not breakage:** timeout signature (not an assertion mismatch on balance/address/invariant); the recovery test simply didn't finish inside its 240s budget on a heavy proving+SW-lifecycle shard. 13/14 tests on shard 3 passed; the other 4 shards + quality + smoke green. Promote adds no code beyond dev, where this test already runs. CLAUDE.md: network-e2e flake → re-run, never neutralize.
- **Action:** `gh run rerun 30060466482 --failed` (re-runs shard 3 + the aggregator only). NO gate weakened, NO --admin.
- **Escalation rule:** if the SAME test times out again on re-run → treat as REAL breakage → STOP + surface, do NOT merge.
