# Phase 0 · Plan in the tree

- The plan and its recon were drafted and audited outside the tree and copied in at this commit.
  The audit transcript stays local; its verdict and every finding are in `plan.md` § Plan audit
  ledger.
- **The audit.** `/codex high` round 1 rejected the first draft with six findings. Findings 1 and
  3 to 6 changed the plan: the validator strips commas only from a grouped whole part, the Max leg
  blurs the amount input itself, five claims were corrected, and the tests drive the real input
  handler and blur into the real validator. Finding 2, the float input cap, went to the owner as
  Ask A-2 and was declined on 2026-09-29.
- **Worktree.** The harness created `.claude/worktrees/agent-aebc0e1f9a38c8a3b` on
  `fix/send-amount-exact`. `agent-worktree register` refuses it (the helper wants the directory to
  match the slug), so the workspaces manifest has no row for this build.
- **Base.** The branch was fast-forwarded from `f51ec001` to `a7b1ff62` (#717) before this first
  commit; #717 edits none of the files this plan edits.
- **The index line** sits after `grant-check-address-case`, not after the last closed row:
  `git merge-file` against `feat/ux-owner-picks`' index, which adds its own row after
  `wallet-safety-fixes`, merges clean there and conflicts one line lower.
- **Gate.** `bun scripts/ci-cd/plans/check.ts` exit 0 (three report-only path-token findings, all
  in files this plan does not touch); `bun run lint` exit 0.
- **Overlap probe**, after the plan commit and before any code commit: `git merge-tree
  --write-tree HEAD origin/feat/ux-owner-picks` (at `33b19cb3`) exits 0 with no conflict.
