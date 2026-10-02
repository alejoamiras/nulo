# Phase 0 — Housekeeping + baselines

- `implementations-plan/index.md`: added the missing
  `incoming-trust-state-machine-refactor` entry (shipped PR #75; the
  bridge-arc entries had crowded it out of the index).
- `(BUG PIN — replaced in Phase 1)` added to `execution-lane.test.ts`:
  cancelJob currently cancels regardless of profile ownership (active
  profile p1 cancels a job while no ownership data is consulted). The
  Phase-1 change will replace this pin with the profile-scoped no-op
  pins, making the behavior change visible as a pin REPLACEMENT.

## Gate (as written in plan.md)

- `bun run lint` exit 0 ✓
- `bun run --cwd packages/extension vitest run src/wallet/services/execution/execution-lane.test.ts` → 6 passed ✓
