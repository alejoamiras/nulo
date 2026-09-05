# Post-implementation codex loop — arc 2

## Arc gate (before the loop), 2026-09-05
- `bun run typecheck:all` → exit 0 (all 14 workspaces).
- `bun run lint` → exit 0.
- `bun run test`: two full runs at vitest's default worker count reported 1–2 failures, ALL of them
  30 s timeouts in `profile/service.integration.test.ts` (a different test each time), plus 5–7
  "Failed to start forks worker … Timeout waiting for worker to respond" — i.e. files that never
  ran. Load average on the shared machine was 12–13 during both runs (other sessions + the terminal
  rendering); the same tests pass alone in about a second. Re-run with
  `bun run --cwd apps/extension test --maxWorkers=3` → **437 files, 5467 tests, exit 0, 77 s**.
- `bun run build` (chrome) → `✓ built in 2.28s`, exit 0.

Lesson: on this shared machine the default fork count starves PBKDF2-heavy integration tests and
even worker start-up. `--maxWorkers=3` is the reliable form of the same gate; the earlier parallel
`audit:vue` failure in arc 1 was the same phenomenon.

## Codex loop
Session, prompt and rounds recorded below as they happen.
