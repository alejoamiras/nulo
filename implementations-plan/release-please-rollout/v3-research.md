# release-please-action @v3 — viability research

## Latest v3 version + release-please bundled

**v3.7.13** — released 2023-11-06. Bundles **release-please v15.13.0** (confirmed via `package.json` dep `"release-please": "^15.13.0"`). Runs on Node 16. No deprecation notice in the release tag.

## v3 → v4 changes that might be relevant

- v4 upgraded to release-please **v16** (then v17 by v4.4+) and rewrote the action in TypeScript (Node 20).
- v4 removed the `command` input; manifest mode is now the only path (no more `manifest` / `manifest-pr` command strings).
- v4 renamed `default-branch` → `target-branch` (breaking input rename).
- v4 dropped ~40 flat config inputs in favor of manifest-file + config-file only.
- The abort logic ("untagged, merged release PRs outstanding") already existed in release-please v15.13.0 inside `createPullRequests()` — it was not introduced by v4.
- The component-mismatch guard (`"PR component: X does not match configured component: Y"`) exists verbatim in `src/strategies/base.ts` at both v15.13.0 and v17.6.0. It is not a v4/v16 regression.

Sources: action v3 `index.js` at tag v3.7.13; action v4 `action.yml`; release-please `src/strategies/base.ts` at both v15.13.0 and v17.6.0; release-please `src/manifest.ts` at both tags.

## Does v3 have Bug 1 (outstanding abort)?

**YES — same bug, same code path.**

`release-please/src/strategies/base.ts` lines 563-571 in v15.13.0 contain the identical component-mismatch guard that powers Bug 1:

```
"PR component: ${branchName.component} does not match configured component: ${branchComponent}"
```

When this guard fires, `buildReleases()` returns `undefined` for that PR. `createReleases()` then produces zero releases. In v3, `outputReleases([])` never calls `core.setOutput('release_created', true)` — same outcome as v4.

The "untagged, merged release PRs outstanding" abort in `createPullRequests()` is also present in v15.13.0 (manifest.ts line 820-824), triggered if any merged PR still carries `autorelease: pending`. This is the secondary symptom seen after the first run fails.

Issue #817 and #656 both report the abort error against **v3** directly. Issue #443 reports it as a v3 regression vs v2. There are zero reports of users successfully escaping Bug 1 by downgrading from v4 to v3.

## Does v3 require the v4 workarounds (group-pull-request-title-pattern, target-branch, etc.)?

**Partially different, but the underlying title-pattern bug is the same.**

- `group-pull-request-title-pattern` (Bug 2): this config key lives in release-please core, not the action wrapper. It exists in v15.13.0. The same missing-`${version}` default applies. The workaround (set both `pull-request-title-pattern` and `group-pull-request-title-pattern` explicitly) is needed in v3 too.
- `target-branch`: v3 uses `default-branch` instead. Our workflow currently uses `target-branch:` — that input would be silently ignored by v3, meaning the branch would be detected from the GitHub API default branch. If `main` is the default branch on the repo, this likely works; if not, it would open PRs on the wrong branch.
- `config-file` / `manifest-file`: both supported in v3 (confirmed via action.yml).

## Compatibility with our setup

- **App-token via `actions/create-github-app-token@v1`**: works. v3 takes a plain `token:` string input with no restrictions on source. Any bearer token accepted.
- **`manifest-file` + `config-file` inputs**: still supported in v3 (confirmed from action.yml at v3.7.13).
- **Branch protection (signed commits, PR-only)**: compatible — v3 creates PRs and tags via the GitHub API using the provided token, same as v4. Branch protection applies to the merge, not the action itself.
- **`target-branch` input**: NOT supported in v3; must change to `default-branch` or omit (auto-detected). If `main` is the repo default branch this is a no-op difference, but the input rename is a required change.

## Recommendation

**Don't downgrade — same bug, no escape.**

The component-mismatch root cause (`PR component does not match configured component`) exists in release-please v15.13.0 in the same file and same logic path as v17. The abort guard and the `release_created`-never-true outcome are identical in v3. There is no evidence in any GitHub issue that a v4→v3 rollback resolved this; the earliest filed reports (#443, #656, #817) already name v3 as the broken version.

Downgrading also introduces a required input rename (`target-branch` → `default-branch`), drops Node 20 support, and pins to a release that has not received updates since November 2023.

The correct fix remains what you have already partially applied: ensure the merged PR title contains `${version}` so the title-parse succeeds, and manually resolve any stuck `autorelease: pending` PRs so the abort guard clears. Tracking issue for the root cause: [release-please-action#1205](https://github.com/googleapis/release-please-action/issues/1205) / [release-please#2712](https://github.com/googleapis/release-please/issues/2712) — both open as of the research date, unfixed in all versions including v5.
