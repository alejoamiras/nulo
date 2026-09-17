# Phase 6 — close out

Run on `worktree-approval-scope-follow-execution` at `01502d7e` plus the plan commits (arc 3's head). The two-PR popup stack was gated on its own branches before it opened.

## Validation gate — reported passing

| Gate | Result |
|---|---|
| `bun run test:e2e` (smoke), armed source build mirroring `_extension-smoke-e2e.yml` | **exit 0** — 32 files passed / 1 skipped, 123 tests passed / 6 skipped |
| `bun run audit:vue` | **exit 0** — every package typechecks, 6271 tests passed (504 files, 3 skipped), lint clean with the complexity baseline unchanged, Vite build ok |
| `bun run e2e:agent tests/e2e/network/execute-scope-chain.test.ts` | **exit 0** on `b2ce424a` (arc 2's final code), solo, retry 0 |
| `bun run e2e:agent tests/e2e/network/execute-scope-account.test.ts` | **exit 0** on `b2ce424a`, solo, retry 0 — follow, decline and lock contention |
| `bun run e2e:agent tests/e2e/network/batch-mixed.test.ts` | **exit 0** on `e8d98d3b` and again on `01502d7e` (arc 3's final code), solo, retry 0 |
| CI on the stack | PR #614 and PR #615: every check passing (`quality-status`, `extension-smoke-e2e-status`, `extension-network-e2e-status`, `tools-e2e-status`) |

## Attempts

1. **Smoke run 1 — invalid invocation, not a regression.** A bare `bun run test:e2e` reused the `dist/chrome` that `e2e:agent` had just built for the network run (Local Network RPC baked in, no migration fixture). `import-dead-rpc.test.ts` lost three cases and `backup-migration.test.ts` tripped its own fixture-arming contract ("unarmed runs are allowed ONLY against a release artifact"). Neither file touches anything arc 3 changes. The run was stopped by its own process group.
2. **Smoke run 2 — armed, green.** Rebuilt with `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1`, grepped both token-seed markers in `dist/chrome`, then `NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.

**Lesson:** the smoke suite and the network suite share one `dist/chrome` per worktree. After any `e2e:agent` run the smoke needs its own armed rebuild; the plan's bare `bun run test:e2e` line is only correct on a fresh armed build.

## Delivery state

- **Stack #616, open and ready for review:** PR #614 `fix(popup): release the scope freeze for dapp sends and clear it on lock` (base `dev`) and PR #615 `feat(execute): show the transaction's scope and follow it after confirming` (base arc 1). Opened only after the arc 1, arc 2 and cross-arc codex loops converged.
- **Arc 3, pushed but PR not opened:** `fix(execution): fence authwits and refuse sends without a journal record`. Its codex loop converged, but plan.md §Copy carries no owner sign-off on the Send-screen refusal copy (Ask 3), so the PR stays unopened by design. The code ships no new copy in the meantime (`send.vue` keeps its fixed failure toast).
- `implementations-plan/index.md` on this branch carries the same row as the stack's branches, byte for byte, so the three PRs cannot conflict on it.

## For the owner

- Ask 3 needs a sign-off naming the Send-screen toast, quoted in plan.md §Copy; then `gh pr create` from `worktree-approval-scope-follow-execution` with the prepared body.
- Arc 1's codex loop ran two rounds past the three-round guideline (logged in `lessons/phase-0.md`); arcs 2, 3 and the cross-arc pass each converged in two.
- plan.md and the lessons folder diverge across the three branches by design (each arc logs its own phase). Whichever PR merges second will need a trivial plan-folder merge.
