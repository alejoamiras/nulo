# Phase 5 — Source package and reproducibility

## What changed

- Root `package.json`: `prepare` is `git rev-parse --git-dir >/dev/null 2>&1 && git config core.hooksPath .githooks || true`. Reproduced first: the old `git config core.hooksPath .githooks` exits 128 in an unpacked archive and takes `bun install` down with it.
- `apps/extension/scripts/source-rebuild.sh`: the one procedure a reviewer runs (version check against the tree, exact Bun check against `packageManager`, `PUPPETEER_SKIP_DOWNLOAD=1 bun install --frozen-lockfile`, `build:firefox`). `store/SOURCE-BUILD.md` invokes it and explains it, so there is no second copy of the commands.
- `.github/workflows/source-rebuild.yml`: one resolved SHA; the shipped bytes from exactly one of two mutually exclusive reference jobs (release asset for a tag, `_build-extension.yml` for a bare commit); `git archive` unpacked under `$RUNNER_TEMP` on x86_64 and on `ubuntu-24.04-arm`; `compare` fails on any difference. Carries a TEMPORARY branch-scoped `push:` trigger until Arc 2's loop converges (a new workflow cannot be dispatched before it exists on the default branch).

## Findings

- **The build is deterministic.** Two clean rebuilds of `git archive HEAD` outside the repo (Bun 1.4.2, the workstation) and the worktree's own `build:firefox`: `diff -rq` empty across all three pairs. In CI both architectures are byte-identical to the fresh reference build. Nothing needed fixing: no hashes, timestamps or ordering leak into `dist/firefox`.
- **Resources** (`/usr/bin/time -v`): workstation 2.24 / 2.32 GB peak RSS, 6 s wall with a warm cache; GitHub runners cold: x86_64 1.76 GB / 16.9 s, ARM64 2.10 GB / 22.0 s. Recorded in `SOURCE-BUILD.md` § Resources. Far under Mozilla's 10 GB.
- Local rebuild recipe (session-local `.playwright-mcp/local-rebuild.sh`, not committed): archive HEAD twice into the scratch directory, prefix `PATH` with an unpacked Bun 1.4.2 (`bun-linux-x64.zip`, SHA-256 `36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913`), run the script under `/usr/bin/time -v`, diff the two outputs and the worktree's `dist/firefox`.
- Bun's `bun-version-file: package.json` input on `oven-sh/setup-bun` reads `packageManager`, so the workflow pins nothing itself.

## Validation gate

| Layer | Command | Result |
|---|---|---|
| lint | `bun run lint` | exit 0 |
| actionlint | `bun run lint:actions` | exit 0 |
| shellcheck | `shellcheck apps/extension/scripts/source-rebuild.sh` | exit 0 |
| local rebuild ×3 | `.playwright-mcp/local-rebuild.sh` at `5d58c67e` | `rebuild-a exit=0`, `rebuild-b exit=0`, `diff a-b: 0 differences`, `diff a-worktree: 0 differences` |
| CI rebuild | push `c67d19bca2bd39503873a03b062b80f55d9605d0` (and, after the Arc 2 round-1 fixes, `fae07730` → run **35670945252**, green, Node 22.23.2 on both runners) → `gh run list --workflow source-rebuild.yml --event push --commit c67d19bc…` → run **35669743682**; `gh run watch 35669743682 --exit-status` | exit 0: `rebuild on x86_64` success, `rebuild on ARM64` success, `compare rebuilds with the shipped tree` success ("identical to the shipped tree" ×2) |

`LESSONS_FILE=implementations-plan/chrome-store-launch/lessons/phase-5.md`
