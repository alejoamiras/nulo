# Phase 2 — Docs + dossier corrections — lessons

Commit `0fcd004f` (docs only): CLAUDE.md "Working in this repo" bullet (runtime, stopgap + retirement trigger, `viteModuleRunner` never-flip, the soak bar), `CI.md:29` (landing IS run; runtime pinned by `setup-bun`), `ARCHITECTURE.md` §14 (runtime column, the faucet jsdom smoke row, the complete per-workspace config list), `packages/bridge-core/README.md:35` (vitest-under-Bun ≠ `bun:test`), `implementations-plan/bun-1.4-adoption/adoption-map.md` (stale pin-surface line, `Bun.$` overstatement, Arc C status + faucet's place in the order).

## Validation gate (as written in plan.md)

| Check | Result |
|---|---|
| `bun run lint` | 0 errors (33 warnings / 11 infos, pre-existing) |
| `bun run test:ci-gating` | 37/37 |
| `git diff --name-only <matrix commit>..HEAD` allowlisted only | at `0fcd004f`: yes — `*.md` + `lessons/baselines/**/*.json` only |
| `git diff --stat 6fe41b46..HEAD -- . ':!implementations-plan'` vs the change map | 45 files, +948/−22 — exactly the map: `vitest.base.ts`, 4 new + 8 modified configs, `biome.json`, 11 manifests, `scripts/ci-cd/test-soak/**`, `packages/bridge-core/README.md`; `bun.lock` and `.github/**` untouched |

## Re-gate — PASSED at the final matrix commit `e10cc91e`

The post-implementation loop changed executable files after the first matrix (`f5caac58` NUL-separator escapes; `0d4dbac8` + `a7260587` codex rounds 1–2; `985ab08f` the test-randomness fix found by matrix attempt 2). By the matrix commit rule the whole Phase 1 gate was re-run at `e10cc91e` (see `phase-1.md`: frozen install, 12 × 2 × 30 soaks, 12 compares OK, `test:all` ×5, `audit:vue`, `build:faucet`, armed smoke, ci-gating 42/42, dispatch 32813986423 `quality-status: success`). Then this gate, re-asserted at PR HEAD:

- `bun run lint` + `bun run test:ci-gating`: exit 0 (inside the re-gate).
- `git diff --name-only e10cc91e..HEAD`: 27 paths, **0 outside the documentation allowlist** (`*.md` + `lessons/baselines/{node,bun}/*.json` — the 24 refreshed compact summaries, `phase-1.md`, `phase-2.md`, `plan.md`, `index.md`).
- `git diff --stat 6fe41b46..HEAD -- . ':!implementations-plan'`: 48 files, +1446/−27 — the change map exactly (`vitest.base.ts`, 12 configs, 11 manifests, `biome.json`, the soak tool + fixtures + tests, CLAUDE.md/CI.md/ARCHITECTURE.md/bridge-core README, the one `fix(test)`); `bun.lock` and `.github/**` untouched (0 paths).


LESSONS_FILE=implementations-plan/vitest-on-bun/lessons/phase-2.md
