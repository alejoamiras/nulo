# Phase 5 — Docs + network e2e

## Work
- **ARCHITECTURE.md §5** rewritten: "Storage versioning + destructive migration" → "Storage versioning + data-preserving migration" — the engine's journal sequence, the registry + `template.ts` how-to, migrate-before-`config.load()`, the failure UX (`blocked`/`degraded`), the UI barrier + static facade ban, the explicit NOT-covered list (crypto pre-unlock, PXE, session, backups-queued-follow-up), and the e2e fixture proof. Fixed the stale "runs on first unlock" claim (it runs at SW boot, first storage action).
- **ARCHITECTURE.md §4**: journal tier corrected (session → **local**, with the 2026-06-05 durability rationale — the doc drift codex caught); PXE bullet no longer references the deleted wipe migration.
- **`packages/wallet-core/README.md`**: `src/migration/` added to the file map.
- **`implementations-plan/M4/DECISIONS.md`**: M4.7 marked **SUPERSEDED** by this plan, with an honest note on how the re-opened design resolved its 3 blockers differently (single global version vs per-collection; boot-single-flight + facade vs shared lock registry; wipe deleted outright).
- `wallets-architecture-research/` deliberately untouched (frozen archive, like implementations-plan history).
- (`apps/extension/README.md` + `packages/wallet-crypto/README.md` were already rewritten in Phase 2, co-located with the `migrate.ts` deletion, per the audit's sequencing condition.)

## Gate
- `typecheck:all` ✓ 12/12 packages.
- biome errors-only across the whole real source tree ✓ clean.
- Full extension unit suite + prod build + final DCE grep: (appended below).
- Network e2e (`bun run e2e:agent`): (appended below).

## Incident: first network run — 27/71 failed, ALL environmental (self-inflicted)
The first `e2e:agent` run failed 27 tests (persistent cluster: `approveExecute` → `execute-confirm-btn` 10s click-timeouts + dApp RPC errors), which looked exactly like a facade regression in `FeeSettingsCard` (it mounts only in network flows — invisible to units/smoke). Triage before blame paid off:
1. The chain itself was healthy (mints verified on-chain mid-run), pointing at the wallet UI stage.
2. **Standalone repro of a failing test on the SAME build passed the full flow in 75s** — no regression.
3. Root cause: **resource starvation** — I ran the full smoke suite, the 2679-test unit suite, prod builds, AND a dev-worktree build in parallel with the network run (bb.js proving + several headless Chromes + vite builds). 10s `clickByTestId` budgets don't survive that. A second contributor: `[aztec-node] Error: Address already in use (os error 48)` at startup — another agent's aztec network lives on this machine (registry: ecosystem-tooling @ 8080); an internal aztec sub-port collided, though the node still sequenced.

**Lesson (hard rule): the network e2e gate runs on a QUIET machine — never overlap it with builds or other suites.** Full-suite rerun clean; result below.

## Gate results (final)
- Full extension unit suite ✓ 2679 · prod build ✓ · final DCE grep ✓ (fixture absent).
- **Network e2e (`bun run e2e:agent`) ✓ GREEN — 70 passed | 1 skipped (53/54 files)** on a quiet machine. (The recurring `[aztec-node] Address already in use` startup line is benign — present in green runs too; an aztec-internal auxiliary port colliding with another agent's long-lived network.)
