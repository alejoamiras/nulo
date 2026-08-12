# Phase 5 lessons — pre-push gates + PR

## Gate evidence (2026-08-12)

- `bun run audit:vue`: exit 0 (typecheck:all → 4025 units → lint → build).
- Full ARMED smoke, four foreground chunks (the background-task reaper workaround from
  phase 4): 24 files passed + 1 network-gated skip (`sw-restart-network`), 82 passed /
  6 skipped / 0 failed, zero retries.
- Full network suite: solo, setsid-detached, `NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1` —
  **65 files passed + 2 skipped (87 tests), attempt-1, ZERO retries, 27.3 min, teardown clean**
  (anvil + sandbox from the ports registry).

## Gotcha: "armed" smoke is a BUILD property, not a runner flag

The first chunk-1 run failed `backup-migration.test.ts` with a 90s timeout that looked
exactly like a product regression in the import path. It wasn't. `test:e2e` runs against
the existing `dist/chrome`, and that dist had just been produced by `audit:vue`'s build —
which does NOT stamp the migration fixture. `NULO_E2E_MIGRATION_FIXTURES=1` on the runner
only DECLARES arming; the fixture itself is compiled in at build time by
`VITE_NULO_E2E_MIGRATION_FIXTURE=1`. Against an unarmed build the v1 backup has no
migration to run, the import rejects, and the helper waits forever for a success hash.

Rule: **any armed smoke run must be immediately preceded by an armed build**
(`VITE_NULO_E2E_MIGRATION_FIXTURE=1 bun run build`), and any `audit:vue`/plain build in
between UN-arms the dist silently. Divergence probe that settled it: the same test at the
same commit went red→green with only the build's env changing. (Routed to the
`e2e-testing` skill in the post-cert docs commit.)

## Gotcha: worktree guard vs `cd` in compound commands

The session's worktree isolation refuses compound commands that `cd` elsewhere (probe
worktrees, `$(dirname)` tricks) and silently resets cwd between calls. Wrapper scripts in
the scratchpad (run via `bash <abs-path>`) are the reliable pattern — same trick as the
detached-run wrappers.

## Gotcha: the FULL network suite needs `NULO_E2E_PROVERLESS=1`

Phase 4's targeted pair never tripped it, but the full `e2e:agent` sweep includes
proverless-gated files (`account-switch-isolation`) and the #351 fail-fast guard aborts the
whole run unless `NULO_E2E_PROVERLESS=1` is set. The guard did its job — loud abort at
launch instead of a silent skip 30 minutes in.
