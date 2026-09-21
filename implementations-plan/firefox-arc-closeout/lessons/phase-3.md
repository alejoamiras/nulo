# Phase 3 — docs for the behaviour, and arc 1's codex loop

## What landed

- `ARCHITECTURE.md` §8 — "When the background dies under a connected dApp": the reply, why the relay stays
  untouched (recovery from a *cold* background rides on the heartbeat; "at once" is the attached background),
  the four stated limits, and the deliberate asymmetry with F-B16's clean loss for a queued discovery.
- `.claude/skills/e2e-testing/SKILL.md` — §3 gains the same-page reconnect recipe (`unlockAfterBackgroundDeath`
  → `reconnectPlayground`, alarms cleared before the kill) and the Firefox wake nuance; ledger row 32 names the
  fingerprint (`did not settle within 30000 ms (background alive now: true)`), the mechanism and the fix.
- `apps/extension/tests/e2e/FIREFOX.md` — row 1 records that a connected dApp's heartbeat is an event that
  wakes the event page, and why the in-flight call is rejected within seconds there.

## Gate

- `cd ROOT && bun run audit:vue` → exit 0 (typecheck ∥ `Test Files 544 passed | 3 skipped (547)`, `Tests 6881
  passed | 4 skipped | 7 todo (6892)` ∥ lint, then the Chrome build).
- `cd ROOT && bun run test:ci-gating` → exit 0.

## Arc 1 codex loop

_Pending — the pass runs after the docs commit; the verdict and every finding's disposition go here._
