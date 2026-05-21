# Prerelease rollout — plan v2

Builds on v1 (`/tmp/prerelease-rollout/plan-v1.md`) and consolidates Codex (`APPROVE-WITH-FIXES`) + Opus 4.7 (`APPROVE-WITH-FIXES`) reviews. Both reviewers independently caught the same critical drift; codex added four specific corrections about versioning, gh-release-target semantics, ref pinning, and the post-stable reset sequence.

## 0. v1 → v2 deltas

| # | v1 said | v2 says | Source |
|---|---|---|---|
| 1 | Init prerelease manifest at `0.20.2`; stable manifest unmentioned. | **Fix the stable manifest drift in this PR**: bump `.release-please-manifest.json` from `0.17.1` → `0.20.2` (currently stale because every stable release shipped via manual recovery, which doesn't touch the manifest). Then init the prerelease manifest at `0.20.2`. Both start coherent. | Opus + codex; verified `cat .release-please-manifest.json` = `{ ".": "0.17.1" }` |
| 2 | First prerelease will be `0.21.0-rc.1`. | First prerelease will be **`0.21.0-rc`** (no number suffix). Counter starts at `0.21.0-rc.1` on the SECOND iteration. | codex cited [release-please/src/versioning-strategies/prerelease.ts](https://github.com/googleapis/release-please/blob/main/src/versioning-strategies/prerelease.ts) + [tests](https://github.com/googleapis/release-please/blob/main/test/versioning-strategies/prerelease.ts) |
| 3 | Manual recovery: `gh release create v0.21.0-rc.1 --target dev --prerelease ...` | Manual recovery: `gh release create v0.21.0-rc --verify-tag --prerelease ...` (omit `--target`; the tag already exists so `target_commitish` is ignored anyway). | codex cited [gh manual](https://cli.github.com/manual/gh_release_create) + [REST docs](https://docs.github.com/en/rest/releases/releases) |
| 4 | Workflow_dispatch republish: `--ref dev` or `--ref main` either works. | **Always `--ref main`** — uses the known-stable workflow definition. dev's workflow file might lag during a promote cycle. | codex |
| 5 | Post-stable reset = update `.release-please-prerelease-manifest.json` on `dev`. | Post-stable reset = (a) merge `main` → `dev` FIRST so `package.json`/`CHANGELOG.md` on dev reflect the new stable, (b) THEN reset the prerelease manifest. Otherwise release-please can reopen PRs on the drift. | codex cited [release-please#2172](https://github.com/googleapis/release-please/issues/2172) |
| 6 | Smoke test = push a no-op commit. | Smoke test = use a disposable `feat:` commit (or `Release-As:` footer). `docs:`/`chore:` won't open a Release PR for a Node project. | Opus + codex cited [release-please README](https://raw.githubusercontent.com/googleapis/release-please/main/README.md) |
| 7 | JSONC comments in example config. | Strip `// ← NEW` comments at implementation time — release-please's parser is strict JSON. | Opus |
| 8 | Q5 (community fork) deferred. | Q5 deferred but **flagged as the immediate next investigation** if the abort tax on prereleases is painful. Cadence on dev is much higher than main. | codex |

## 1. The plan (full restate, v1-text-plus-v2-deltas)

### Goals + non-goals — unchanged from v1.

### 3. Architecture

**New files** (committed to `main`, propagated to `dev` via the next promote PR):

```
.github/release-please-prerelease-config.json     # new (prerelease config)
.release-please-prerelease-manifest.json          # new (init: { ".": "0.20.2" })
.github/workflows/release-prerelease.yml          # new (dev-only release-please opener)
```

**Modified files**:

```
.release-please-manifest.json                     # 0.17.1 → 0.20.2 (drift fix)
CLAUDE.md                                         # Release runbook gains a "Prerelease" subsection
```

**Unchanged**: `release.yml`, `.github/release-please-config.json`.

### 3b. Prerelease config (real JSON, no comments)

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "@nulo/extension",
      "include-component-in-tag": false,
      "include-v-in-tag": true,
      "prerelease": true,
      "prerelease-type": "rc",
      "versioning": "prerelease",
      "extra-files": [
        { "type": "json", "path": "packages/extension/package.json", "jsonpath": "$.version" }
      ],
      "changelog-sections": [
        { "type": "feat", "section": "Features" },
        { "type": "fix", "section": "Bug Fixes" },
        { "type": "perf", "section": "Performance" },
        { "type": "refactor", "section": "Refactoring" },
        { "type": "test", "section": "Tests" },
        { "type": "build", "section": "Build" },
        { "type": "ci", "section": "CI" },
        { "type": "chore", "section": "Misc" },
        { "type": "docs", "section": "Docs" },
        { "type": "deps", "section": "Dependencies" },
        { "type": "style", "section": "Styles" },
        { "type": "revert", "section": "Reverts" },
        { "type": "infra", "section": "Infrastructure" }
      ]
    }
  },
  "pull-request-title-pattern": "chore${scope}: release${component} ${version}",
  "group-pull-request-title-pattern": "chore${scope}: release${component} ${version}",
  "separate-pull-requests": false
}
```

### 3c. Manifest baselines

```json
// .release-please-manifest.json          (stable — was 0.17.1, drift fixed)
{ ".": "0.20.2" }

// .release-please-prerelease-manifest.json (prerelease — new)
{ ".": "0.20.2" }
```

Both at `0.20.2` (the last shipped stable tag). First feature commit on dev → release-please opens a Prerelease PR for `0.21.0-rc` (no number; counter starts at the next iteration).

### 3d. `release-prerelease.yml`

```yaml
name: release-please (dev / prerelease)

on:
  push:
    branches: [dev]
  workflow_dispatch:

concurrency:
  group: release-prerelease
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Mint App token
        id: app
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.RELEASE_PLEASE_APP_ID }}
          private-key: ${{ secrets.RELEASE_PLEASE_APP_PRIVATE_KEY }}
      - uses: googleapis/release-please-action@v4
        with:
          config-file: .github/release-please-prerelease-config.json
          manifest-file: .release-please-prerelease-manifest.json
          target-branch: dev
          token: ${{ steps.app.outputs.token }}
```

Minimal. Just the release-please-action call. No publish chain here — reuses `release.yml` via `workflow_dispatch` per the runbook.

### 3e. CLAUDE.md runbook extension

The existing `### Release runbook` becomes:

```
### Release runbook

#### Stable release (from main)
… existing 8 steps, unchanged …

#### Prerelease (rc) from dev
1. Land features on dev as usual.
2. release-prerelease.yml runs automatically. release-please opens a
   Prerelease PR titled `chore(dev): release X.Y.Z-rc[.N]` (no number
   on the first rc of a new minor; rc.1 on the second, rc.2 on the
   third, etc.).
3. Review + merge the Prerelease PR via the GitHub UI (merge commit).
4. release-prerelease.yml runs again on the merge commit. Expected:
   same v4 abort bug as stable. Downstream skipped because no
   `release_created`.
5. Manual unstick (45 seconds):
   PR_NUM=<the Prerelease PR number>
   VERSION=<e.g. 0.21.0-rc>
   MERGE_COMMIT=$(gh pr view "$PR_NUM" --json mergeCommit -q '.mergeCommit.oid')
   git fetch origin dev
   git tag -a "v$VERSION" "$MERGE_COMMIT" -m "Release $VERSION"
   git push origin "v$VERSION"
   gh pr edit "$PR_NUM" --add-label "autorelease: tagged" \
                        --remove-label "autorelease: pending"
   gh release create "v$VERSION" --verify-tag --prerelease \
                                 --title "v$VERSION" \
                                 --notes "Filled by publish run."
6. Run the publish chain via the STABLE workflow's escape hatch:
   gh workflow run release.yml --ref main \
     -f tag="v$VERSION" -f dry_run=false \
     -f run_network_e2e=true -f publish_marketplaces=false
   (--ref main is intentional — always use the known-stable workflow
   definition for the publish chain.)
7. Verify:
   gh release view "v$VERSION" --json isPrerelease,assets \
     -q '{prerelease:.isPrerelease, assets:[.assets[].name]}'
   Expected: prerelease=true, three assets (chrome zip, firefox zip,
   SHASUMS256.txt).
8. Cloudflare hook does NOT fire for prereleases (intentional — the
   landing points at stable releases only). No manual step.

#### After a stable cut promotes to main
The prerelease manifest must be re-baselined to the new stable version,
otherwise the next rc series starts from a stale base.

1. Merge `main` back into `dev` (regular promote-back PR with merge
   commit) so package.json + CHANGELOG.md on dev reflect the new
   stable. This is REQUIRED before step 2; otherwise release-please can
   reopen old Release PRs on the drift (see release-please#2172).
2. Open a small PR to `dev` updating
   `.release-please-prerelease-manifest.json` to the new stable
   version (e.g. { ".": "0.21.0" }).
3. Merge it. The next push to dev → next rc series starts from the
   correct base.
```

### 6. Test plan

Local: actionlint on the new workflow YAML (CI gate). `bun run audit:vue` (no extension code touched but confirms nothing breaks).

Post-merge smoke test:
1. On a dev branch, make a `feat: smoke test prerelease workflow` commit (test commit, removable later). Push to dev as a feature PR + merge.
2. Watch `release-prerelease.yml` fire on the push to dev (the merge commit).
3. Confirm release-please opens a Prerelease PR titled `chore(dev): release 0.21.0-rc`. Verify the body + manifest diff.
4. **Close the PR without merging** to leave dev state clean. Verify release-please cleans up its own branch.
5. (When the next REAL feat lands on dev and you want to cut an rc) follow the full runbook.

## 7. Open questions (refined)

**Q1 — `prerelease-type` label**:
- **`rc`** (proposed default) — universal release-candidate semantics. Tags: `v0.21.0-rc`, `v0.21.0-rc.1`, `v0.21.0-rc.2`.
- **`dev`** — "dev iteration". Tags: `v0.21.0-dev`, `v0.21.0-dev.1`, ...
- **`beta`** / **`alpha`** — implies multi-stage maturity model.

**Q2 — Trigger cadence**:
- **Auto on every push to dev** (default) — release-please updates the same Prerelease PR per push. Merge when ready to cut an rc.
- **`workflow_dispatch` only** — manual cut, but the existing Prerelease PR machinery is the natural fit; manual-only adds friction.

**Q3 — Post-stable manifest reset**:
- **Manual** (default, hardened with the main→dev step from codex review) — small PR per stable cut, documented in runbook.
- **Automated** — needs a small workflow that listens for stable tags + opens a manifest-reset PR. More moving parts.

**Q4 — Run network-e2e on prereleases?**
- **YES** (default) — rc.N should be QA-ready against the network gate.
- **NO** — saves 30-45 min per rc. Ships untested.

**Q5 — Community fork investigation** (`release-please-oss/release-please-action@v5`):
- **Defer past this PR** (default) — ship the prerelease flow first against the known-quirky `googleapis/release-please-action@v4`. If the abort tax is painful, that's the trigger for switching.
- **Try in this PR** — replace the action on BOTH stable + prerelease workflows simultaneously. Higher blast radius if the fork has its own quirks. Saves a future PR if it works.

## 8. Migration commits

1. `chore(release-please): fix stable manifest drift (0.17.1 → 0.20.2)` — 1-line bump in `.release-please-manifest.json`. Independent of prerelease work; lands first.
2. `feat(ci): add release-please prerelease config + manifest` — adds `.github/release-please-prerelease-config.json` + `.release-please-prerelease-manifest.json`.
3. `feat(ci): add release-prerelease.yml workflow (dev / rc cuts)` — the new workflow file.
4. `docs(claude): extend Release runbook with Prerelease (rc) subsection + post-stable reset` — CLAUDE.md update.

Four commits, ~110 LOC net, zero changes to `release.yml` or the stable config.

## 9. Risk

- **Low**: the prerelease workflow is isolated from stable. Worst case: it has a bug and Prerelease PRs don't open. Stable releases keep working.
- **Medium**: v4 abort bug exposure is HIGHER on prereleases. If frequency hurts, that's the signal to investigate Q5 (community fork).
- **Low**: post-stable reset friction. The codex-corrected two-step sequence (merge main→dev first, then reset manifest) is documented; missing it = next rc series starts wrong but recoverable.
- **Low**: first-rc version `v0.21.0-rc` (no number) may surprise. Documented in runbook + this plan.
- **Low**: existing stable manifest drift fix (commit 1) is a 1-liner with no behavior change until the next push-to-main, which already wouldn't have opened a stable Release PR (no feat/fix since v0.20.2).
