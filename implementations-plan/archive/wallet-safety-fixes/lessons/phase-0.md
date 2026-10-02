# Phase 0 · Plan in the tree

- Worktree: `.claude/worktrees/agent-ad939da8492a2b5ee`, a harness-created agent worktree.
- Branch `fix/wallet-safety-fixes`, cut from `origin/dev` at `b172f0ca`. The plan's Facts were
  verified at `624117cd`; the two commits between (#710, #711) touch infra, release workflows,
  `CI.md`, `CLAUDE.md`'s landing lines, `bun.lock` and another plan's index line, none of the
  files this plan edits.
- `bun install --frozen-lockfile` at the root: 993 packages, exit 0.
- `agent-worktree register` refused the worktree: the helper requires the directory and the branch
  to follow its `worktree-<slug>` naming chain, and a harness-created agent worktree follows
  neither. Not forced; the manifest carries no row for this build.
- The plan lands from its package as `plan.md` and `recon.md`; its one link (`recon.md`) is
  committed alongside it. Its `eli5:` line points at the program's published ELI5 page. The index
  line sits under `ux-feedback`, beside the other follow-up plans of that program.
- Gate: `bun run lint` exit 0; `bun run test:ci-gating` exit 0 (244 pass, 2 skip, 0 fail);
  `bun scripts/ci-cd/plans/check.ts` exit 0 (5 report-only `path-token` findings, all in files that
  predate this plan; one, `RevokeAuthwitsPopup.test.ts:9`, goes when P1 rewrites that header).
