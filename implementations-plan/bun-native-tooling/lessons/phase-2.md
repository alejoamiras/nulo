# Phase 2 — Docs + dossier corrections — lessons

## Delivered

- `packages/bridge-core/README.md`: the scripts table gains `verify:l1` (with the forge resolution order and a pointer to the operator runbook); a "Key invariants" bullet states the rule — scripts spawn ONLY through `scripts/run.ts`, argv arrays never shell strings, the `check: false` contract, `FORGE_BIN`/`CAST_BIN`, the three boundaries of the no-argv guarantee, and "argv closes shell injection, not a hostile flag".
- `packages/bridge-core/.env.example`: `CAST_BIN` documented next to `FORGE_BIN`, each with its resolution order.
- `implementations-plan/bun-1.4-adoption/adoption-map.md`: Arc D marked implemented as Node-API hardening with the declined premise and the three corrected claims (`Bun.$` in the release scripts; `kill()` return type; `spawnSync` semantics); open question 4 (`--no-orphans`) resolved with the descendant-tree semantics and the clearing probe's location.
- `implementations-plan/index.md`: the arc's row (PR number added at delivery).

No CLAUDE.md change: the rule is package-local (README), and the repo-level ruleset already routes spawning discipline to the run-isolation material.

## Validation gate (as written in plan.md) — PASSED

| Check | Result |
|---|---|
| `bun run lint` | 0 errors (33 warnings / 11 infos pre-existing repo-wide) |
| `bun run test:all` | exit 0 — all 11 workspace suites (`bun run --filter '@nulo/*' --if-present test`) |
| `git diff --name-only <last Phase 1 commit 4b56f517>..HEAD` + the working tree | `implementations-plan/bun-1.4-adoption/adoption-map.md`, `implementations-plan/index.md`, `packages/bridge-core/.env.example`, `packages/bridge-core/README.md`, this file, `plan.md` — `*.md` + `.env.example` only |

LESSONS_FILE=implementations-plan/bun-native-tooling/lessons/phase-2.md
