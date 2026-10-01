# Phase 0 · Plan in the tree

- **Worktree.** Built in a harness-created agent worktree on branch `feat/layout-polish`, cut from
  `origin/dev` at `85c4d20f` (#719 merged). `agent-worktree register layout-polish` refused it by
  design: it registers only `.claude/worktrees/<slug>` on branch `worktree-<slug>`. The harness
  owns this worktree's lifecycle, so no manifest row was written.
- **Plan landing.** `plan.md` and `recon.md` copied from the audited package; the front matter's
  `worktree:` line and P0.1 now name the harness worktree. Nothing else changed: the plan's one link
  (`recon.md`) is committed beside it, and it holds no absolute path.
- **Overlap recheck at P0.** `origin/dev` is still `85c4d20f`. None of `hygiene`, `amount-honesty`
  or `copy-polish` has a remote branch yet (`git ls-remote --heads origin` shows none), so nothing
  to merge. The one wave-2 branch on the remote, `fix/send-amount-exact` (unmerged, waiting on
  its owner Ask), shares three files with this plan: `BalanceView.vue` and `BalanceView.test.ts`,
  where it only moves the `hero-fit`/`hero-ruler` imports to `@/utils/` (lines far from L7's), and
  `index.md`/`follow-ups.md`, where it appends in the same groups. Textual overlap only; whichever
  lands second merges `dev`.
- **Gate.** `bun scripts/ci-cd/plans/check.ts` exit 0 (0 enforced; 3 report-only `path-token`
  findings, all pre-existing and outside this plan); `bun run lint` exit 0 (complexity-baseline
  check OK). ✓
