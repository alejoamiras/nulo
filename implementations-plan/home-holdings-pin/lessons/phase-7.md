# Phase 7 — the full network suite, sharded

Run on the Mac, 2026-09-07, from the stack tip after the cross-arc codex loop.

## How it ran
- The plan's 2× option: shards 1/3/5 sequentially in this worktree, shards 2/4 sequentially in a
  second detached worktree (`git worktree add --detach … <tip>` + `bun install --frozen-lockfile`,
  ~5 s via the global cache), both in tmux with one log per shard. Concurrent shards from ONE
  worktree collide on the built `dist/` and the owned run lock; two worktrees do not.
- Result: 34 + 37 + 41 + 39 + 33 = 184 specs, 0 failures, every shard `EXIT=0`. Wall clock ≈ 1 h
  10 min for the pair (a single sequential run of five shards would have been roughly double).
- Shards 3/5 ran from the working tree that already carried the cross-arc round-2 fixes; shards
  1/2/4 ran the committed tip before them. The round-2/3 fixes are unit-gated and touch no e2e path.

## Lessons
- The worktree-isolation guard refuses `git -C <other worktree>` and `cd <other> && git …`; recreate
  the shard worktree from THIS worktree (`git worktree remove --force` + `git worktree add --detach`)
  instead of checking it out in place.
- Reap before you shard: the previous night's crawl came from an orphaned sandbox group, not from
  load (`lessons/phase-6.md`). `bun run e2e:reap` first, then launch.
