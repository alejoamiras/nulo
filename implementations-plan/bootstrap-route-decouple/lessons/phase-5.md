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

## CI incident during the PR gate (2026-08-12 20:51–21:05 UTC) — not our code

All 8 network jobs failed twice with three surface signatures (noirup script saved as a 503
HTML page; `curl (56)` on the accelerator tarball; aztec node crashing at boot with
`ERR_MODULE_NOT_FOUND: @napi-rs/snappy-wasm32-wasi`). Root cause chain: `snappy@7.4.0`
published 13:36 UTC → CI's FRESH aztec-5.0.1 toolchain install (cache miss; local runs use the
pre-existing repo-pinned `~/.aztec` and never see this) resolves it un-pinned → during a
registry/CDN blip the cold native tarball (`@napi-rs/snappy-linux-x64-gnu@7.4.0`) 503'd → npm
skips optional deps SILENTLY (fail-soft) → snappy's loader falls back to the WASI package,
which is never installed for linux → node dead at boot, health check eats 90s, exit 86.

Diagnosis discipline that worked: read the FIRST error under the noise ("Address already in
use" was secondary), correlate publish timestamps (`registry.npmjs.org/<pkg> | .time`) against
the failure window, then probe the exact tarball before rerunning. Zero test failures in any
attempt — rerun-not-neutralize per the gates rule.

**Correction after attempt 4** (three reruns kept failing): the outage was only the trigger
window — the breakage is DETERMINISTIC. A bare local `npm install snappy@7.4.0` reproduced the
exact CI error with the native package present: 7.4.0's loader unconditionally reaches the
`@napi-rs/snappy-wasm32-wasi` fallback, which npm never installs on linux. Every fresh
toolchain install was dead on arrival regardless of network health; reruns could never go
green. Fix: a load-check-gated pin step in `.github/actions/setup-aztec` that replaces snappy
with 7.3.3 by direct tarball extraction (npm-free; no-op on healthy caches; fail-loud
re-check), dry-run against a simulated broken tree before pushing. Lessons: (1) when reruns
fail with the SAME signature twice, stop assuming "transient" and reproduce locally; (2) the
CI sandbox toolchain has NO min-age gate (unlike the repo's bunfig 7-day gate) — un-pinned
transitives of `aztec-up` walk straight in on publish day. (Route to `aztec-update` skill.)
