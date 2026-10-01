# release-please-action @v4 — prerelease patterns

## Native prerelease support summary

- **`prerelease: true`** in config enables prerelease versioning; GitHub Releases get the `prerelease` API flag (not "Latest"). Default `false`.
- **`prerelease-type: "rc"`** sets the suffix label. Combined with `versioning: "prerelease"`, produces `0.21.0-rc.1 → 0.21.0-rc.2`. Without it you get a bare numeric append — avoid.
- **`versioning: "prerelease"`** is the versioning strategy key (set in config, not `versioning-strategy`). Bumps the counter for patch commits; bumps base + resets counter for feat/breaking.
- **No separate `release-type` variant** for prereleases. Use same `release-type: "node"` and layer `prerelease: true` + `versioning: "prerelease"` on top.
- **Known issue** ([#2447](https://github.com/googleapis/release-please/issues/2447)): changing `prerelease-type` mid-series doesn't auto-reset the counter. Use `release-as` to force the transition version explicitly.

---

## Config approach: TWO config files (recommended)

Commit **both** config files to `main` and reference them by path via the `config-file` action input. One workflow step runs with the stable config, another with the prerelease config.

```
.github/release-please-config.json             ← existing stable config
.github/release-please-prerelease-config.json  ← new (prerelease: true, versioning: "prerelease")
```

This avoids branch drift: both configs are always readable from the default branch. The action `config-file` input takes any repo-relative path.

---

## Manifest approach: TWO manifests (required)

Sharing one manifest is unsafe: the stable flow would see the last prerelease version (e.g. `0.21.0-rc.3`) as its base and produce a nonsensical bump.

- Stable: `.release-please-manifest.json` → stays at `0.20.2` throughout the rc cycle.
- Prerelease: `.release-please-prerelease-manifest.json` → advances `0.21.0-rc.1`, `0.21.0-rc.2`, …

Release-please has **no semantic understanding** that `rc.3` is part of the `0.21.0` series. The stable flow reads only its own manifest and computes the next bump independently. You sync them manually at promotion (see lifecycle).

---

## Version scheme + tag format

- Tags: `v0.21.0-rc.1`, `v0.21.0-rc.2`, … (with `include-v-in-tag: true`)
- Suffix format depends on `prerelease-type`. With `"rc"`: `0.21.0-rc.1`. With `"dev"`: `0.21.0-dev.1`. Without `prerelease-type`: `0.21.0.1` (just a numeric append — avoid this, it's unusual semver).
- Counter: **auto-incremented** by the strategy. Each merged prerelease Release PR bumps it. No manual counter management needed.
- GitHub Release: marked as `prerelease: true` via the API → NOT shown as "Latest". Confirmed in [`src/manifest.ts`](https://github.com/googleapis/release-please/blob/main/src/manifest.ts) which passes `release.prerelease` directly to `github.createRelease`.

---

## Stable → prerelease lifecycle

```
dev branch                           main branch
────────────────────────────────     ───────────────────────────────
feat commit on dev
  → RP opens "release 0.21.0-rc.1"
  → merge → tag v0.21.0-rc.1         stable manifest stays 0.20.2
    prerelease manifest: 0.21.0-rc.1  GH Release: prerelease=true
  → more commits → rc.2, rc.3…
  → dev → main PR merged
                                      RP opens "release 0.21.0" PR
                                      (reads stable manifest 0.20.2)
                                      → merge → tag v0.21.0
                                        GH Release: prerelease=false "Latest"
                                        stable manifest: 0.21.0
  ← MANUAL: reset prerelease
    manifest to 0.21.0
```

---

## Does the v4 abort bug apply to prereleases?

**YES — same bug, same workaround.**

The abort fires when release-please finds a merged PR with `autorelease: pending` but no git tag. This logic is branch-agnostic. The prerelease flow runs it identically. Because the action triggers on every `dev` push (more frequent than `main`), there's more exposure. Recovery: push the tag, relabel to `autorelease: tagged`, `workflow_dispatch`. Issues [#1205](https://github.com/googleapis/release-please-action/issues/1205) and [#2712](https://github.com/googleapis/release-please/issues/2712) remain open.

---

## Real-world examples

**1. chrisbenincasa/tunarr** — [config-prerelease.json](https://github.com/chrisbenincasa/tunarr/blob/main/release/release-please-config-prerelease.json) + [workflow](https://github.com/chrisbenincasa/tunarr/blob/main/.github/workflows/release-please.yml)

Node project. Two configs + two manifests under `release/`. Single workflow, two action steps with `if: github.ref == 'refs/heads/main'` / `refs/heads/dev` guards. Uses `prerelease-type: "dev"` + `versioning: "prerelease"`. On the community fork (`release-please-oss@v5`).

**2. FusionAuth/fusionauth-android-sdk** — [prerelease-config.json](https://github.com/FusionAuth/fusionauth-android-sdk/blob/main/.github/prerelease-config.json) + [release.yml](https://github.com/FusionAuth/fusionauth-android-sdk/blob/main/.github/workflows/release.yml)

SDK project (Android). `.github/prerelease-config.json` with `prerelease: true`, `prerelease-type: "rc"`. Separate prerelease manifest. Post-release step gated on `contains(tag_name, 'rc')`. Also on `release-please-oss@v5` pinned by SHA.

---

## Recommendation for our setup

**Three new files** (all committed to `main`):

```
.github/release-please-prerelease-config.json      ← new
.github/.release-please-prerelease-manifest.json   ← new, init { ".": "0.20.2" }
.github/workflows/release-dev.yml                  ← new
```

**Prerelease config** — copy stable config, change:
```json
{
  "release-type": "node",
  "prerelease": true,
  "prerelease-type": "rc",
  "versioning": "prerelease",
  "packages": { ".": { ...same package-name, include-v-in-tag, extra-files, changelog-sections... } },
  "pull-request-title-pattern": "chore${scope}: release${component} ${version}",
  "group-pull-request-title-pattern": "chore${scope}: release${component} ${version}",
  "separate-pull-requests": false
}
```

**`.github/workflows/release-dev.yml`:**
```yaml
name: release-please (dev / prerelease)
on:
  push:
    branches: [dev]
  workflow_dispatch:
jobs:
  release-please:
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write }
    steps:
      - uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ secrets.RELEASE_PLEASE_APP_ID }}
          private-key: ${{ secrets.RELEASE_PLEASE_APP_PRIVATE_KEY }}
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ steps.app-token.outputs.token }}
          config-file: .github/release-please-prerelease-config.json
          manifest-file: .github/.release-please-prerelease-manifest.json
      # publish step: if: always() && needs.release-please.result == 'success' && steps.release.outputs.releases_created
```

Keep `release.yml` for `main` unchanged. The two workflows are fully independent — separate config, manifest, and per-PR labels. Label collision is not a risk.

**After each stable cut**: manually reset the prerelease manifest to the new stable version so the next rc series starts from the correct base.

---

## Open questions / risks

- **`googleapis/release-please-action@v4` maintenance status**: both real-world examples use the community fork `release-please-oss/release-please-action@v5`. That fork was created because the googleapis action went unmaintained after v4. Verify current status — if archived, the community fork is a drop-in with identical inputs and is actively receiving fixes.
- **Branch protection on `dev`**: the App token already satisfies signed-commit requirements for the stable flow. Same token works for prerelease. No extra setup needed.
- **Prerelease manifest sync at promotion**: manual step after each stable cut. If skipped, first rc of the next series will still be `0.21.0-rc.1` (restarting from stale base) — not a hard error, just misleading.
- **`prerelease-type` mid-series change** ([#2447](https://github.com/googleapis/release-please/issues/2447)): switching from one suffix to another (e.g. `dev` → `rc`) does not auto-reset the counter. Use `release-as: "0.21.0-rc.1"` in config as a one-time override.
- **v4 abort bug on `dev`**: applies identically. Expect it after the first prerelease merge. Same manual recovery: push the tag, relabel to `autorelease: tagged`, `workflow_dispatch`.
