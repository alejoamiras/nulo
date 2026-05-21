# release-please rollout — plan v2.2

Branch: `feat/release-please-rollout` (off `origin/dev`).

**Changes from v2**: incorporates Codex's final-v2 review (`REJECT`) — five new items. The biggest delta: v2's `Q1 Option A` (bypass) is **dropped** because it doesn't solve Release-PR CI firing. v2.1 makes **GitHub App** the only Q1 path.

**Changes v2.1 → v2.2**: codex's re-review of v2.1 returned `APPROVE-WITH-FIXES` with three small items:
- `resolve.if` still allowed `workflow_dispatch` with empty `tag` to no-op green. **Fix**: broaden `resolve.if` to always run on `workflow_dispatch` and fail inside the script.
- "Auto-signed (web-flow)" wording was inaccurate. **Fix**: replaced with "App-authenticated bot-verified commits".
- `dry_run` workflow input was described as restored but not shown in the YAML snippet. **Fix**: explicit `workflow_dispatch.inputs.dry_run` block in the workflow header.

## 0. v2 → v2.1 deltas

1. **Release PR CI didn't fire**: with `GITHUB_TOKEN`, the auto-opened Release PR doesn't trigger `pr-quick.yml` → `Quality / Status` required check never runs → Release PR cannot be merged. **Fix**: use a GitHub App token via `actions/create-github-app-token@v1`. App-driven commits trigger downstream workflows AND are App-authenticated bot-verified commits. Solves chaining AND signing in one move. The bypass option in v2's Q1 is dropped.
2. **`resolve` was unsafe on manual republish**: shallow checkout had no tags; `git rev-list` could fall back to `github.sha` and publish wrong commit's assets. Empty `tag` input was silently skipped. **Fix**: explicit `git fetch --tags`, verify tag exists, fail loudly on empty input.
3. **`environment: production` was dropped**: secrets/approvals scoped to that environment would disappear. **Fix**: restore on `attach-assets` + marketplace jobs.
4. **CLAUDE.md was left stale**: still says "Releases happen via `gh workflow run release.yml`" (line 219) and main advances only via promote PRs (line 24). **Fix**: included as a commit in the rollout PR.
5. **`component-no-space` config gotcha**: `${component}` in `pull-request-title-pattern` can render with a leading space. **Fix**: add `component-no-space: true`.
6. **v2's `dry_run` workflow input was dropped**: codex flagged. **Fix**: restored as `workflow_dispatch.dry_run` input — when true, skip the actual `gh release upload`/`gh release edit` steps + skip Cloudflare hook (but still build + run gates).

Everything else from v2 stands. Items already fixed: force-version mechanism, flat outputs, extra-files for root sync, ref propagation, issues:write, --clobber, run_network_e2e control, Cloudflare gating, marketplace operator switch, signing-in-principle (now made concrete via GitHub App), workflow chaining (still solved via single-workflow architecture).

## 1. The GitHub App setup (Q1, now the ONLY path)

The user does these one-time steps in GitHub UI before the rollout PR merges:

1. **Create a new GitHub App** at `https://github.com/settings/apps` (or org-level if applicable). Name: `nulo-release-bot` (or similar).
2. Permissions:
   - Repository contents: **Read & Write** (push commits, create tags + releases).
   - Pull requests: **Read & Write** (open + label Release PRs).
   - Issues: **Read & Write** (release-please labels PRs as issues internally).
3. Subscribe to events: none (this App is a pusher, not a webhook receiver).
4. Generate a **private key** (`.pem` file) — download it.
5. Install the App on the `alejoamiras/nulo` repo.
6. Note the App's **App ID** (numeric) shown on the App's settings page.
7. Add two repo secrets:
   - `RELEASE_PLEASE_APP_ID` = the App ID.
   - `RELEASE_PLEASE_APP_PRIVATE_KEY` = the contents of the downloaded `.pem` file.

After these steps, the workflow uses `actions/create-github-app-token@v1` to generate ephemeral tokens for the release-please step.

## 2. Updated `.github/workflows/release.yml` (v2.1)

Key changes from v2:

```yaml
name: release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      tag:
        description: "Re-publish artifacts for an existing tag (e.g. v0.20.0). Skips release-please."
        required: false
        type: string
        default: ""
      dry_run:
        description: "Skip the actual gh release upload + body update + Cloudflare hook; build + gates still run."
        required: false
        type: boolean
        default: false
      run_network_e2e:
        description: "Run network e2e gate (~30-45 min). Disable only for emergency re-publish."
        required: false
        type: boolean
        default: true
      publish_marketplaces:
        description: "Enable Chrome Web Store + Firefox AMO publishing (stubs)."
        required: false
        type: boolean
        default: false

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  release-please:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
      version: ${{ steps.release.outputs.version }}
      sha: ${{ steps.release.outputs.sha }}
    steps:
      - name: Mint App token
        id: app
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.RELEASE_PLEASE_APP_ID }}
          private-key: ${{ secrets.RELEASE_PLEASE_APP_PRIVATE_KEY }}
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          config-file: .github/release-please-config.json
          manifest-file: .release-please-manifest.json
          token: ${{ steps.app.outputs.token }}        # ← App token: triggers downstream CI + auto-signs commits

  resolve:
    needs: release-please
    # Run on:
    # - push events where release-please created a release (release_created==true)
    # - all workflow_dispatch events (we validate the tag inside; no-op-green if empty is banned)
    if: |
      always() &&
      (needs.release-please.outputs.release_created == 'true' || github.event_name == 'workflow_dispatch')
    runs-on: ubuntu-latest
    timeout-minutes: 2
    outputs:
      tag: ${{ steps.r.outputs.tag }}
      version: ${{ steps.r.outputs.version }}
      sha: ${{ steps.r.outputs.sha }}
      is_prerelease: ${{ steps.r.outputs.is_prerelease }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          fetch-tags: true          # ← explicit tag fetch (fix for codex #2)
      - id: r
        env:
          TAG_FROM_PLEASE: ${{ needs.release-please.outputs.tag_name }}
          TAG_FROM_INPUT: ${{ github.event.inputs.tag }}
          IS_PUSH: ${{ github.event_name == 'push' }}
        run: |
          if [ "$IS_PUSH" = "true" ]; then
            TAG="$TAG_FROM_PLEASE"
          else
            TAG="$TAG_FROM_INPUT"
          fi
          if [ -z "$TAG" ]; then
            echo "::error::no tag resolved — workflow_dispatch requires the 'tag' input (e.g. v0.20.0), and push events need release-please to have created a release."
            exit 1
          fi
          if ! git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
            echo "::error::tag $TAG not found in repo (was the release-please commit fetched?)"
            exit 1
          fi
          SHA=$(git rev-list -n 1 "$TAG")
          VERSION="${TAG#v}"
          IS_PRE="false"
          case "$VERSION" in *-*) IS_PRE="true" ;; esac
          {
            echo "tag=$TAG"
            echo "version=$VERSION"
            echo "sha=$SHA"
            echo "is_prerelease=$IS_PRE"
          } >> "$GITHUB_OUTPUT"

  # ... lint-and-typecheck, unit-tests, network-e2e, build-chrome, build-firefox, smoke-against-artifact unchanged from v2 ...

  attach-assets:
    needs: [resolve, build-chrome, build-firefox, smoke-against-artifact]
    runs-on: ubuntu-latest
    timeout-minutes: 20
    environment: production       # ← restored (codex #3)
    permissions:
      contents: write
    env:
      VERSION: ${{ needs.resolve.outputs.version }}
      TAG: ${{ needs.resolve.outputs.tag }}
      DRY_RUN: ${{ github.event.inputs.dry_run || 'false' }}
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v6
        with: { ref: ${{ needs.resolve.outputs.sha }}, fetch-depth: 0 }
      - uses: ./.github/actions/setup-bun
      # ... download artifacts, zip, SHASUMS, git-cliff body (same as v2) ...
      - name: Upload assets + overwrite body
        if: env.DRY_RUN != 'true'
        run: |
          gh release upload "$TAG" \
            "dist/release/nulo-chrome-${VERSION}.zip" \
            "dist/release/nulo-firefox-${VERSION}.zip" \
            "dist/release/SHASUMS256.txt" \
            --clobber
          gh release edit "$TAG" --notes-file /tmp/release-notes.md
      - name: Dry-run preview (skip publish, show what would happen)
        if: env.DRY_RUN == 'true'
        run: |
          echo "DRY RUN — would have uploaded:"
          ls -la dist/release/
          echo "DRY RUN — would have set body to:"
          cat /tmp/release-notes.md

  refresh-landing:
    needs: [resolve, attach-assets]
    if: needs.resolve.outputs.is_prerelease == 'false' && github.event_name == 'push' && github.event.inputs.dry_run != 'true'
    # ... rest unchanged from v2 ...

  # publish-chrome-store + publish-firefox-amo: both get environment: production restored
```

Diff vs v2: `+ Mint App token step`, `+ token:` on release-please, `+ fetch-tags: true`, `+ tag-verify in resolve`, `+ environment: production on attach-assets / marketplaces`, `+ DRY_RUN handling on attach-assets + refresh-landing`.

## 3. Updated `.github/release-please-config.json`

Added `"component-no-space": true` (codex #5):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "@nulo/extension",
      "include-component-in-tag": false,
      "include-v-in-tag": true,
      "release-as": "0.20.0",
      "extra-files": [
        { "type": "json", "path": "packages/extension/package.json", "jsonpath": "$.version" }
      ],
      "changelog-sections": [
        { "type": "feat", "section": "Features" },
        { "type": "fix", "section": "Bug Fixes" },
        { "type": "perf", "section": "Performance" },
        { "type": "refactor", "section": "Refactoring", "hidden": true },
        { "type": "test", "section": "Tests", "hidden": true },
        { "type": "build", "section": "Build", "hidden": true },
        { "type": "ci", "section": "CI", "hidden": true },
        { "type": "chore", "section": "Misc", "hidden": true },
        { "type": "docs", "section": "Docs", "hidden": true }
      ]
    }
  },
  "pull-request-title-pattern": "chore: release ${component} ${version}",
  "component-no-space": true,
  "separate-pull-requests": false
}
```

## 4. CLAUDE.md update (commit in this rollout PR)

Targeted edits to two sections:

**§ Branching + merging** (~line 24): clarify that `main` releases are now driven by release-please's Release PR (which is itself a PR through main's rules), not by `gh workflow run release.yml`.

**§ Quality gates** (~line 219): replace "Releases happen via `gh workflow run release.yml`, never via human `chore: bump extension to X.Y.Z` commits" with text describing the new flow:
- Releases are auto-managed by release-please.
- A merge to `main` opens a Release PR (`chore: release @nulo/extension X.Y.Z`).
- Merging that Release PR triggers the tag + GitHub Release + asset upload + Cloudflare hook.
- `workflow_dispatch` on `release.yml` is the escape hatch for re-publishing assets to an existing tag.
- The human `chore: bump` rule still holds — never make hand-rolled version-bump commits.

## 5. Migration sequence (rollout PR commits)

Same as v2 plus one:

1. `chore(ci): seed CHANGELOG.md + .release-please-manifest.json`
2. `feat(ci): add release-please config`
3. `feat(ci): replace release.yml with single release-please-driven workflow`
4. `chore(ci): delete .release-it.json`
5. `chore(release-please): seed package.json baseline for 0.20.0 bootstrap`
6. `docs(claude): update release-policy section for release-please model` ← NEW

## 6. Q1 reframed (single path)

**Q1 — GitHub App setup**: required. The user does the 7-step setup in §1 before merging the rollout PR. Without the two App secrets in place, the workflow's first run will fail at the `Mint App token` step.

No alternative paths in v2.1. The "bypass" path is gone because it doesn't solve Release PR CI firing.

(If the user pushes back: the only other reasonable alternative is "do the release manually, skip the auto-release workflow entirely". That's not a release-please rollout — it's abandoning it.)

## 7. Q2 unchanged

Changelog sections visibility — same as v2.

## 8. Q3 unchanged

Defer prerelease-from-dev flow. Same as v2.

## 9. Risk

- **High → Mitigated**: signing + chaining + PR-CI firing. v2.1's GitHub App resolves all three.
- **Medium**: `release-as: 0.20.0` first-cycle behavior. Tested release-please pattern; smoke validated via the post-merge manual `workflow_dispatch` against `v0.17.1`.
- **Medium**: `environment: production` rules — if the production environment has required reviewers or wait timers, the auto-release flow may pause for human approval. **Mitigation**: pre-check the environment config; if it has approval gates, decide whether to keep or drop them for the auto-flow.
- **Low**: dry-run path. Skips the `gh release upload`/`gh release edit`/Cloudflare steps; builds + gates still run.
- **Low**: `component-no-space` cosmetic.

## 10. Estimated diff

| File | LOC delta |
|---|---|
| `.github/release-please-config.json` | +30 (new) |
| `.release-please-manifest.json` | +3 (new) |
| `CHANGELOG.md` | +15 (new, seeded) |
| `.github/workflows/release.yml` | ~ -150 / +210 (rewritten — bigger than v2 due to App-token step, fetch-tags, tag-verify, dry-run handling, env restoration) |
| `.release-it.json` | -25 (deleted) |
| `packages/extension/package.json` | +1 / -1 |
| `package.json` (root) | +1 / -1 |
| `CLAUDE.md` | ~ -10 / +20 |

**Net: +95 LOC, 1 new config file, 1 deleted config file, 1 rewritten workflow, 1 docs update.**

## 11. User-facing setup before merging this PR

1. Create the `nulo-release-bot` GitHub App (§1).
2. Install it on `alejoamiras/nulo`.
3. Add `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY` repo secrets.
4. Verify `environment: production` exists in the repo settings and has the secrets the workflow expects (`CLOUDFLARE_PAGES_DEPLOY_HOOK`, marketplace stubs).
5. Confirm Q2 (sections visibility) + Q3 (prerelease defer) preferences.
6. Approve this plan + the ELI5.

Only THEN do I implement.
