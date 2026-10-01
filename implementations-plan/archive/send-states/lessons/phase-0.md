# Phase 0 · Plan in the tree

## Setup

- Worktree: `.claude/worktrees/agent-a31fedc3668370d81`, a harness-created agent worktree, not the
  plan's `.claude/worktrees/send-states`. The front matter says so.
- Branch `feat/send-states` off `origin/dev` at `85c4d20f`; `HEAD` equal to `origin/dev`, tree
  clean. `bun install --frozen-lockfile`: 993 packages, lockfile unchanged.
- `agent-worktree register send-states` refused (the directory is not `.claude/worktrees/send-states`),
  and registering under the directory's own name refused too (the branch is not
  `worktree-agent-a31fedc3668370d81`). The manifest row is skipped; nothing depends on it.

## The plan lands

- `plan.md` and `recon.md` copied from the drafting package. Nothing else: no audit transcript,
  codex prompt or response, outline or driver note.
- One rewrite: the front matter's `worktree:` line, which named a directory this build does not
  use. The one link (`recon.md`) is committed beside the plan; every path is repo-relative.
- One line in `implementations-plan/index.md`, after the last active entry.
