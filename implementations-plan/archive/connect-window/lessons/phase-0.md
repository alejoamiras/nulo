# Phase 0 · Setup and the plan landing

- **Build worktree**: `.claude/worktrees/agent-abd7e3e0bd78c92f8`, relative to the canonical clone,
  a harness-created agent worktree on branch `feat/connect-window`.
- **Base**: `origin/dev` at `85c4d20f`, the plan's own base; nothing to re-verify.
- `bun install --frozen-lockfile`: exit 0.
- `agent-worktree register` refused twice: under the slug (the directory is not
  `.claude/worktrees/connect-window`) and under the directory's name (the branch is not
  `worktree-<dir>`). Renaming the branch would break the plan's branch name, so the manifest row is
  left to the driver.
- The plan lands as `plan.md` and `recon.md`. Its one link (`recon.md`) is committed beside it.
  Edits on landing: the front matter's worktree line; one line declaring that a path starting
  `src/` is under `apps/extension/`; the driver's decision on Verify's OK (Decision ledger, driver
  2026-09-29) carried into § A1, § Security, the change map, P5 step 3 and Delivery's overlaps.
- One line added to `implementations-plan/index.md`, under the wave-1 plans.
- Owner answers at build start: none. O1 (a) and O2 (a) are built as recommended; O1 (b) and O2 (b)
  are captured from local capture-only branches; P8 stays open.

## Gate

- `bun scripts/ci-cd/plans/check.ts`: exit 0 (3 report-only path-token findings, all in files this
  plan does not touch, 0 enforced).
- `bun run lint`: exit 0 (29 warnings and 3 infos, none in the plan's files; complexity-baseline
  check OK).
