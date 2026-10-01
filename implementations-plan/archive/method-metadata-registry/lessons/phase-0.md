# Phase 0 — Worktree + frozen baseline

## Goal
Establish a green baseline so any later red is attributable; record the current six-table surface as the snapshot the parity test will pin.

## Outcome — ✓ (2026-06-15)
- `bun run --filter @nulo/wallet-bridge test` → **134 passed (2 files)**.
- `bun run typecheck:all` → exit 0.
- `bun run lint` → exit 0.

## Decisions
- **No separate git worktree.** The plan called for a parallel-safe e2e worktree, but I'm the only agent and `e2e:agent` (`scripts/e2e/agent.sh`) already allocates ephemeral ports + path-scoped cleanup, so it is parallel-safe from the main checkout. Working in-place on `feat/method-metadata-registry`. If a second agent ever runs e2e concurrently, spin a worktree then.
- **Snapshot literals live in the Phase 1 parity test**, not a Phase 0 artifact — the 18-method matrix in `plan.md` is the human-readable source; the test encodes it as frozen literals.

## Notes for Phase 1
- The suite that must stay green UNCHANGED: `dispatcher.test.ts` + `scope-enforcement.test.ts` (134 tests).
- Read both test files before writing the registry to (a) mirror their fixture/import patterns for the new parity + exhaustiveness tests, and (b) confirm which existing assertions pin the surface (F1 :1459-1544, retired-method :813/:817/:824, getRequiredCapability :830-831, getAccounts non-exempt :364/:374).
