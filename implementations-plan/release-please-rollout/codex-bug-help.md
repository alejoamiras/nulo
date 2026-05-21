# Diagnosis — release-please title substitution

## Root cause
This is not a placeholder-syntax bug. It is a **manifest merged-PR config-path mismatch**: with `separate-pull-requests: false`, release-please builds the final Release PR title from **`group-pull-request-title-pattern`**, not from `pull-request-title-pattern`. Your root `pull-request-title-pattern` is read for per-package candidate PRs, then discarded when the manifest merge step emits the real PR title, which defaults to `chore: release ${branch}` => `chore: release main`. Source: [`src/plugins/merge.ts`](https://github.com/googleapis/release-please/blob/203919b5638144b1011a308bfce8b8b5c271a7c1/src/plugins/merge.ts), [`src/manifest.ts`](https://github.com/googleapis/release-please/blob/203919b5638144b1011a308bfce8b8b5c271a7c1/src/manifest.ts), [`docs/manifest-releaser.md`](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md), and open bug [`#2712`](https://github.com/googleapis/release-please/issues/2712).

## Ranked fixes (most likely to work first)
1. **Fix A**: add top-level `"group-pull-request-title-pattern": "chore${scope}: release${component} ${version}"`.  
Why this might work: this is the setting the merged manifest PR actually uses; it replaces the internal fallback `MANIFEST_PULL_REQUEST_TITLE_PATTERN = 'chore: release ${branch}'`. Cite: [`src/plugins/merge.ts`](https://github.com/googleapis/release-please/blob/203919b5638144b1011a308bfce8b8b5c271a7c1/src/plugins/merge.ts), [`src/manifest.ts`](https://github.com/googleapis/release-please/blob/203919b5638144b1011a308bfce8b8b5c271a7c1/src/manifest.ts), [`#2712`](https://github.com/googleapis/release-please/issues/2712).

2. **Fix B**: change `"separate-pull-requests": true`.  
Why this might work: it bypasses the manifest merge-title path entirely, so `pull-request-title-pattern` is used directly by the package/root strategy. Cite: [`docs/manifest-releaser.md`](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md) (“group-pull-request-title-pattern has no effect when `separate-pull-requests` is `true`”), [`src/strategies/base.ts`](https://github.com/googleapis/release-please/blob/203919b5638144b1011a308bfce8b8b5c271a7c1/src/strategies/base.ts).

3. **Fix C**: if you want grouped PRs but do not care about component text, set `"group-pull-request-title-pattern": "chore: release ${version}"`.  
Why this might work: merged-release parsing only truly needs `${version}` to recover the release version; this avoids the `main`-only fallback. Cite: [`src/util/pull-request-title.ts`](https://github.com/googleapis/release-please/blob/203919b5638144b1011a308bfce8b8b5c271a7c1/src/util/pull-request-title.ts), [`#2712`](https://github.com/googleapis/release-please/issues/2712).

## Verdict
I would try **Fix A** first. It matches the actual code path you are on, preserves grouped PR behavior, and directly addresses why you keep getting `chore: release main`.