# Phase 0 · Plan in the tree

- **Worktree.** Built in a harness-created agent worktree on branch `chore/copy-polish`, cut from
  `0f37ab78`, the top of stack #729 (the tree the plan's Facts were read at); `git status` was clean
  and `HEAD` equalled that SHA before the first edit. `agent-worktree register` refused the
  worktree under the plan's slug (the directory is not `.claude/worktrees/copy-polish`) and under
  the directory's own name (the branch is not `worktree-agent-…`). Not forced; the manifest carries
  no row for this build.
- **`bun install --frozen-lockfile`** at the root: 993 packages, exit 0.
- **The stack landed before the first edit.** `git fetch origin dev` showed `dev` at `94ef1b11`
  (#726), and `git diff --quiet 0f37ab78 origin/dev` exited 0: the eight squash commits carry
  `0f37ab78`'s exact tree. `origin/dev` was merged in at once with a signed merge commit
  (`SSH_AUTH_SOCK= git merge --no-ff origin/dev`), which changed no file, so every phase and the
  codex diff (`dev...HEAD`) sit on the real base. The front matter's `base:` says so.
- **Plan landing.** `plan.md` and `recon.md` copied from the audited package; the front matter's
  `worktree:` and `base:` lines now name the harness worktree and the landed base. Nothing else
  changed: the plan's one link (`recon.md`) is committed beside it, and neither file holds an
  absolute path. Its index line joins the recent block at the top of `index.md`.

## Gate

- `bun scripts/ci-cd/plans/check.ts`: exit 0; 3 findings, all report-only and pre-existing
  (`path-token` in three files this plan does not touch), 0 enforced.
- `bun run lint`: exit 0 (28 warnings and 3 infos, all pre-existing; the complexity-baseline check
  OK). ✓
