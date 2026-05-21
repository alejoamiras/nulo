# Review — prerelease rollout v1

## Verdict
APPROVE-WITH-FIXES

## Per-section findings
- §3 Architecture: The config keys are valid for manifest config on `release-please-action@v4`: `prerelease`, `prerelease-type`, and `versioning` are all in the upstream schema, and the docs say prerelease versioning only emits prerelease versions when `prerelease=true` ([schema](https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json), [manifest docs](https://raw.githubusercontent.com/googleapis/release-please/main/docs/manifest-releaser.md), [customizing docs](https://github.com/googleapis/release-please/blob/main/docs/customizing.md)). But the plan’s expected first bump is wrong: with baseline `0.20.2`, a `feat:` bump and `prerelease-type: "rc"` produce `0.21.0-rc`, not `0.21.0-rc.1`; upstream source and tests are explicit on this ([source](https://github.com/googleapis/release-please/blob/main/src/versioning-strategies/prerelease.ts), [tests](https://github.com/googleapis/release-please/blob/main/test/versioning-strategies/prerelease.ts)). The workflow reuse itself is sound: `resolve` turns the tag into `{tag, version, sha, is_prerelease}` and downstream jobs consume the SHA, so `gh workflow run release.yml --ref main -f tag=...` is safe for a dev tag ([release.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:81), [release.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:149), [release.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:281)).

- §4 Cycle diagram: `gh release create ... --target dev` is not the right thing to rely on. `gh` documents `--target` as branch or SHA, but GitHub’s Releases API says `target_commitish` is unused if the tag already exists; your runbook tags first, so the branch name does not control what gets released ([gh manual](https://cli.github.com/manual/gh_release_create), [REST docs](https://docs.github.com/en/rest/releases/releases?apiVersion=latest)). Prefer `--verify-tag` and either omit `--target` or pass the exact merge SHA.

- §5 CLAUDE.md update: Keep the publish command on `--ref main`, not `--ref dev`, so the rerun always uses the known stable workflow definition ([CLAUDE.md](/Users/alejoamiras/Projects/nulo/nulo-3/CLAUDE.md:354)). The post-stable reset also needs tightening: resetting only `.release-please-prerelease-manifest.json` on `dev` is unsafe if `package.json`/`CHANGELOG.md` on `dev` still reflect `0.21.0-rc.5`. Release-please has reopened PRs on manifest/version drift; merge `main` back into `dev` first, then reset the prerelease manifest ([issue #2172](https://github.com/googleapis/release-please/issues/2172)).

- §6 Test plan: The smoke test is wrong as written. A no-op docs tweak will usually not open a Release PR for a node repo; upstream says releasable units are `feat`, `fix`, and `deps`, while `docs` is only releasable for some languages ([README](https://raw.githubusercontent.com/googleapis/release-please/main/README.md)). Use a disposable `feat:`/`fix:` commit or an explicit `Release-As:` smoke test instead.

## Cross-cutting / missed items
1. The local repo does not match the carryover state: [.release-please-manifest.json](/Users/alejoamiras/Projects/nulo/nulo-3/.release-please-manifest.json:2) is still `0.17.1`, not `0.20.2`. Validate the actual implementation branch before coding to this plan.
2. Cloudflare is correctly blocked twice over for prereleases: by `is_prerelease == 'false'` and by `github.event_name == 'push'` ([release.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:281)).
3. Marketplace stubs are not prerelease-aware; they are only input-gated. That is acceptable, but the prerelease runbook must hardcode `publish_marketplaces=false` ([release.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:310)).
4. Q5 should stay out of this PR, but not be deferred far. The abort bug hits every rc, so the operational tax on `dev` will be much higher than on `main`.

## Verifiable claims to validate before merge
1. Decide whether the first prerelease should be `v0.21.0-rc` or `v0.21.0-rc.1`, then test the actual config that yields it.
2. Run one dry prerelease dispatch from `main` against a dev-only tag to confirm off-branch tag resolution works end-to-end in [release.yml](/Users/alejoamiras/Projects/nulo/nulo-3/.github/workflows/release.yml:81).
3. Prove the post-stable sync sequence: merge `main` back into `dev`, reset the prerelease manifest, and confirm no spurious Release PR opens.
4. Confirm the branch you will implement on really has stable baseline `0.20.2`; the current checkout does not.