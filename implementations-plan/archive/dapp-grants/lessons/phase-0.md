# Phase 0 · Plan in the tree

- Branch `fix/dapp-grants` cut from `origin/dev` at `85c4d20f`; `bun install --frozen-lockfile`
  clean.
- `plan.md` and `recon.md` copied in unchanged: the only link in either file is `plan.md`'s link to
  `recon.md`, which is committed beside it, and neither file carries a machine path.
- One line added to `implementations-plan/index.md`, after the wave's other active plans.

Gate:

- `bun scripts/ci-cd/plans/check.ts`: exit 0, no finding in this plan's files (the three report-only
  path-token findings predate it).
- `bun run lint`: exit 0 (existing warnings only; complexity-baseline check OK).
