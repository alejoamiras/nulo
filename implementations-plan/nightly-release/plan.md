# nightly-release

Nightly extension prereleases from `dev`, published to GitHub Releases by a scheduled workflow.

## Problem

There is no easy way to hand people "the latest build". Stable releases lag `dev` by days-to-weeks (promote → release-please → publish), and rc cuts are manual. Anyone asked to try current `dev` needs a maintainer to build + zip + send.

## Decisions (owner-confirmed 2026-08-21)

1. **Per-day tagged prereleases** — `v<version>-nightly.<YYDDD>` tags accumulate; each nightly is its own prerelease GitHub Release with history preserved. (Rolling-tag alternative rejected: owner wants history.)
2. **Hard gate, all suites** — lint+typecheck, unit, full network e2e (5 proverless shards + heavy fee-methods + heavy concurrent + real-proving canary), chrome+firefox build, smoke against the built artifact. Release uploads only if everything is green.
3. **Quiet-day skip** — when the newest `v*-nightly.*` tag already points at dev HEAD, the run no-ops green. Manual dispatch can force a rebuild.

## Version scheme

Chrome and Firefox cap every manifest `version` component at 65535, and `apps/extension/manifest/manifest.config.ts` derives that field by stripping non-numerics from the package version. A calendar date (`20260821`) would overflow the last component → invalid manifest → broken build. So:

- Version = `<dev package.json version>-nightly.<YYDDD>` — e.g. `0.27.0-nightly.26233` for 2026-08-21 (day-of-year 233).
- Manifest mapping yields `0.27.0.26233` (valid); `version_name` / About page show the full string.
- Same-day re-run collision: the tag-existence loop advances the date-code (`…26234`, `…26235`). Appending `.1` would produce a fifth manifest component (invalid).

## Pipeline

New workflow `.github/workflows/nightly.yml`. Triggers: `schedule` cron `23 3 * * *` (03:23 UTC, off the :00 peak-load mark) + `workflow_dispatch` (inputs: `force`, `dry_run`). First scheduled workflow in the repo; fires from dev because dev is the default branch.

Jobs (all reuse existing reusable workflows; no new build/test logic):

1. **resolve** — explicit `origin/dev` checkout (identical behavior from schedule or dispatch from any branch). Computes base version, date-code, tag; collision loop via `git ls-remote`; quiet-skip compares newest nightly tag's sha to origin/dev HEAD.
2. **Gates at the pinned sha** — `_lint-and-typecheck.yml`, `_unit-tests.yml` → network suite in the `pr-network-e2e.yml` shape (5 shards proverless + fee-methods + concurrent-sendtx-confirm + canary real-proving; accelerator kill-switch respected) → `_build-extension.yml` ×2 with `version_override` → `_smoke-e2e.yml` against the chrome artifact.
3. **Flake policy** — network suite runs at config-default retry 2 (the PR gate forces `0` for honesty; a nightly wants absorption) plus the built-in exit-86 infra-boot retry; smoke has retry 2 baked into its vitest config.
4. **publish-nightly** — only after all gates green: zip as `nulo-chrome-$VERSION.zip` / `nulo-firefox-$VERSION.zip` + `SHASUMS256.txt` (existing convention), git-cliff notes scoped to `apps/extension/**` since the previous tag (nightly tags match `cliff.toml`'s `tag_pattern` so ranges chain naturally), `gh release create --prerelease --target $SHA`. Tag + release are created only here — a red night strands nothing.
5. **status** aggregator (house pattern). Concurrency group `nightly`, cancel-in-progress (a newer run supersedes a stale in-flight one).

Skip propagation follows the `release.yml` lesson: reusable workflows need `if: always() && needs.resolve.result == 'success' && …` guards or a skipped ancestor skips the whole chain.

## Validation

- `bun run lint:actions` locally (actionlint + shellcheck on inline scripts).
- Live dry-run on the feature branch before PR: `gh workflow run nightly.yml --ref worktree-nightly-release -f dry_run=true` — full gates run, publish skipped. Watch green.
- Post-merge: first scheduled run observed next morning.

## Codex review round (2026-08-21, session 01a024d5)

Pre-merge review by codex (`gpt-5.6-sol`, xhigh) on the first implementation. Findings + dispositions:

- **HIGH — stable release notes truncation** (accepted, fixed): `cliff.toml`'s `tag_pattern = "v[0-9].*"` would make nightly tags range boundaries for `release.yml`'s `--unreleased` generation — a stable cut the day after any nightly would document only the last ~24h. Verified against git-cliff docs (`ignore_tags` folds ignored tags' commits into the next section). Fix: `--ignore-tags '^v[0-9]+\.[0-9]+\.[0-9]+-nightly'` added to `release.yml`'s cliff args; the nightly's own invocation keeps nightly boundaries (daily delta by design).
- **MEDIUM — rc-window base version** (accepted, fixed): during an rc series dev carries e.g. `0.28.0-rc.1`; the manifest numeric-strip yields `0.28.0.1`, so a nightly suffix produced a five-component (invalid) manifest every night of the window. Fix: resolve normalizes the base to its `MAJOR.MINOR.PATCH` prefix and fails loudly if none.
- **MEDIUM — publish guard not fail-closed against skipped gates** (accepted, fixed): `!contains(failure/cancelled)` tolerated hypothetical skipped needs; now enumerates `== 'success'` for all nine gates.
- **MEDIUM — write-token exposure** (partially adopted): `GH_TOKEN` scoped from job level to the `gh release create` step only. The suggested action SHA-pinning of `orhun/git-cliff-action@v4` was REJECTED for this PR — mutable major tags are the repo-wide convention (`actions/checkout@v7` etc.); pinning one action in isolation is churn without a boundary change.
- **LOW — ls-remote error read as tag-absence** (accepted, fixed): probe output captured via command substitution so a network error aborts under `set -e` instead of reading as absence.
- **LOW — cron off the :00 mark** (accepted, fixed): moved to `23 3 * * *` per GitHub's peak-load guidance; docs synced.
- **MEDIUM — interrupted publish not self-healing** (adopted as documentation): behavior kept (fresh date-code tag on force re-dispatch); recovery path documented in CI.md rather than adding idempotent-create complexity.
- **Presentation duplication in release body** (accepted, fixed): composed header minimized to date/sha/warning — cliff's output already carries the `## <version>` heading + install block whenever `--tag` is passed.

## Delivery

Single PR to `dev`: `chore(ci): nightly extension prereleases from dev`. Docs updated in the same PR (CI.md, .github/README.md, CLAUDE.md CI-conventions line).
