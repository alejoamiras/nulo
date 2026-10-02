# release-please-oss/release-please-action@v5 — viability research

## Maintainer + history

- **Org**: `release-please-oss` (https://github.com/release-please-oss), created 2025-08-20. Based in Poland; contact email on the org is `yevhenii@afanasiev.dev`.
- **Repo created**: 2025-08-20 (https://github.com/release-please-oss/release-please-action). The org does NOT appear to be a GitHub fork (no `parent` field in the API response) — it was manually re-pushed from `googleapis/release-please-action@v4.2.0`.
- **Active maintenance**: yes. 8 releases shipped since Aug 2025; latest is v6.0.1 (2026-04-22). Recent commits as recently as 2026-05-04. Renovate bot auto-bumps deps. OpenSSF Scorecard added. CI uses vitest, biome, rolldown. One external contributor (Ömer) merged a fix in v6.0.1 — not just a solo project.
- **Second repo**: `release-please-oss/release-please` (https://github.com/release-please-oss/release-please) exists but is a mirror of `googleapis/release-please` at v17.6.0 with zero independent releases and no divergent commits. It is not a patched fork of the library.
- **Trust signals**: 14 stars, 2 forks — very small community footprint. Not backed by any company.

## Bundled release-please version

The action's `package.json` specifies `"release-please": "^17.1.3"`. The resolved version in the lockfile is **17.6.0** (same as what `googleapis/release-please-action@v5.0.0` bundles). The `release-please` library itself comes from the **upstream `googleapis/release-please` npm package** — the fork does not ship or patch its own library. The `release-please-oss/release-please` GitHub repo is 2 commits behind `googleapis/release-please:main` and has no independent npm releases.

## Bug-fix claims

**The fork does NOT claim to fix the abort bug we're hitting.**

The closest fix in the fork's changelog is v6.0.1's "reuse single Manifest instance for releases and pull requests" ([#41](https://github.com/release-please-oss/release-please-action/issues/41)), which reduces redundant GitHub API calls when `draft: true` is set. It is a performance fix, not a correctness fix.

Our exact failure mode — `⚠ Expected 1 releases, only found 0` / `⚠ There are untagged, merged release PRs outstanding - aborting` — is tracked in:
- `googleapis/release-please-action#1205` (https://github.com/googleapis/release-please-action/issues/1205): still open, zero comments, filed after the fork launched
- `googleapis/release-please#2712` (https://github.com/googleapis/release-please/issues/2712): still open in the upstream library

Issue 1205 is an exact description of our configuration: single-package Node repo, `include-component-in-tag: false`, component mismatch between release phase and PR phase. The fork has made no commits that touch the manifest loading or component-matching logic that drives this bug.

## API compatibility with googleapis@v4

- **Inputs**: almost identical. The fork adds two inputs not in googleapis v4: `bootstrap-sha` and `config-overrides-json`. It drops `versioning-strategy` and `release-as` (those are v4-only inputs that were removed in the fork's v5 baseline). All four inputs our workflow uses (`config-file`, `manifest-file`, `target-branch`, `token`) are present and behave identically.
- **Outputs**: identical for our use case (`release_created`, `tag_name`, `version`, `releases_created`). The fork's README documents the same output set as googleapis v4/v5. Note: neither fork nor googleapis v5 defines outputs in `action.yml` — they are set dynamically via `@actions/core.setOutput()`; this is normal and works the same.
- **Config schema**: same. Our `release-please-config.json` uses the standard googleapis schema; the fork consumes the same upstream `release-please` library, so config format is identical. (The `$schema` URL in our config pointing to `googleapis/release-please/main/schemas/config.json` remains valid.)
- **Runtime**: both the fork (v6+) and googleapis v5 run on `node24`. Our current googleapis v4 ran on `node20`. Either upgrade would bump the runtime.

## Real-world adoption

Only ~8 unique repos found in GitHub code search using `release-please-oss/release-please-action`:

1. `chrisbenincasa/tunarr` — https://github.com/chrisbenincasa/tunarr/blob/main/.github/workflows/release-please.yml — uses v5.0.0, separate stable + pre-release configs
2. `jl-cmd/claude-code-config` — publish workflow
3. `louis-thevenet/brokerX` — bump workflow
4. `mrostamii/rancher-mcp-server` — release-please workflow
5. `dbehnke/allstar-nexus` — release-please workflow
6. `nlemoine/gulp-tasks` — publish workflow

None of the adopters are high-profile projects. FusionAuth (mentioned in the prior research pass) was NOT found in the current code search, suggesting they may have reverted or changed their workflow.

## Migration risk

**Medium.**

Reasons for "medium" rather than "low":
- The fork does NOT fix our bug. It consumes the same `release-please@17.6.0` library that still has issues 2712 and 1205 open. Migrating buys us the performance fix in v6.0.1 and the `config-overrides-json` escape hatch, but does not cure the abort loop we're manually unsticking after every release.
- Node24 runtime is an upgrade from our current node20 (googleapis v4). Low risk, but a change.
- The `config-overrides-json` input is the most interesting new feature: it lets you pass raw JSON to override any release-please config option not exposed as an action input, which could be a workaround path for our component mismatch.
- The fork is maintained by a single individual with an external contributor or two. If the maintainer loses interest, the fork stalls.
- The `release-please-oss/release-please` mirror repo is 2 commits behind upstream and has no releases — the action consumes the upstream npm package, so library fixes land automatically when the maintainer bumps the dep.
- Migration is a one-line `uses:` change; no workflow restructuring needed.

## Open issues worth knowing

1. `googleapis/release-please-action#1205` — our exact abort bug; still open as of research date; the fork has not addressed it. (https://github.com/googleapis/release-please-action/issues/1205)
2. `googleapis/release-please#2712` — the upstream library bug driving the abort; still open. (https://github.com/googleapis/release-please/issues/2712)
3. `release-please-oss/release-please-action` has 3 open issues at time of research, all appear to be auto-generated (Renovate Dependency Dashboard + automated dist build PR). No user-filed bug reports — could indicate low usage or hidden issues.
4. `googleapis/release-please-action#1169` — `draft: true` performance regression (API call explosion). The fork's v6.0.1 Manifest-reuse fix directly addresses this. Relevant only if we ever enable draft releases.

## Recommendation

**Do not migrate to resolve the abort bug — investigate the config-level workaround instead.**

The fork does not fix the root cause. Both `googleapis` and `release-please-oss` consume the same upstream `release-please` library where issues 2712 and 1205 are open. The abort is caused by a component-matching failure in the library's manifest code, not in the action wrapper.

Our `release-please-config.json` already explicitly sets `"pull-request-title-pattern"` and `"group-pull-request-title-pattern"` with `${version}` — the standard mitigation for issue 2712 — yet we still hit the abort. This points to the deeper `include-component-in-tag: false` + single-package component-mismatch path described in issue 1205.

**The correct next step** is to test whether `googleapis/release-please-action@v5` (released 2026-04-22, bundles the same `release-please@17.6.0`) resolves the bug, since it is the official upstream that now runs on node24 and includes several library-level fixes from 17.2.x–17.6.x. If that still aborts, the `config-overrides-json` escape hatch in the community fork could be explored to pass a component override — but that is a workaround, not a fix.

If migration to the community fork is decided despite the above, it is a **low-effort, drop-in change** (one `uses:` line, no config restructuring). The fork is actively maintained and API-compatible. Accept the small bus-factor risk given the single maintainer.
