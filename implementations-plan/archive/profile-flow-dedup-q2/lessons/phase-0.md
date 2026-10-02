# Phase 0 — Baseline capture

Branch: `refactor/profile-flow-dedup-q2` off `dev`. AFK autonomous run.

## Baseline (clean checkout, before any change)
| Check | Command (from `packages/extension`) | Exit | Result |
|---|---|---|---|
| typecheck | `bun run typecheck` (`vue-tsc --noEmit`) | 0 | clean |
| lint | `bun run lint` (`biome check src/`) | 0 | 42 warnings (pre-existing), 2 infos — non-failing |
| unit | `bunx vitest run` | 0 | **196 files passed / 1 skipped; 2398 tests passed / 7 todo** |

Smoke e2e (`bun run test:e2e`) not run at baseline this turn — deferred to Phase 4 (and the other agent is touching network-e2e; smoke is hermetic but I'll check ports first).

## Notes
- zsh (not bash): `${PIPESTATUS[0]}` doesn't work; capture exit via `cmd > log 2>&1; echo $?`.
- The 42 lint warnings are pre-existing (mostly `noUnusedImports` infos in tests + the `new`-mock arrow-factory notes). Not mine; gate is "no NEW failures."
- Gate definition for every later phase: typecheck 0 + lint 0 + the relevant `vitest run` green with no regression vs the 2398 baseline.

LESSONS_FILE=implementations-plan/profile-flow-dedup-q2/lessons/phase-0.md
