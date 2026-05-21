# Review — prerelease rollout v1 (Opus 4.7)

## Verdict
APPROVE-WITH-FIXES — architecture is correct, but the baseline manifest version and one `gh release create --target` value are wrong, and §3d's "reuse release.yml" assumes `--ref main` will resolve a `dev`-only tag, which it won't.

## Per-section findings

- **§3 Architecture** — correct three-file split. Configs and manifests must be paired (not shared); the research at `/tmp/release-please/prerelease-research.md` lines 26-34 and the FusionAuth + tunarr examples confirm. Plan correctly puts both configs on `main` so both branches always see them.

- **§3b Config** — `prerelease: true`, `prerelease-type: "rc"`, `versioning: "prerelease"` are valid. The release-please schema (`schemas/config.json`, fetched 2026-05-21) marks all three as `ReleaserConfigOptions` properties, available both top-level AND per-package. `customizing.md` explicitly lists `"prerelease"` in the versioning enum. Putting them per-package (under `packages["."]`) matches tunarr's working config verbatim and matches the existing stable config's layout (everything per-package). Good. One nit: the inline JSONC comment `// ← NEW: ...` on lines 65-67 is fine in the plan doc but must not land in `release-please-prerelease-config.json` — release-please's JSON parser will reject comments. The Edit when this lands needs to strip them.

- **§3c Manifest** — **WRONG baseline**. Plan says init `{ ".": "0.20.2" }`. The current `.release-please-manifest.json` reads `{ ".": "0.17.1" }` (file:1-3). The stable manifest never advanced — release-please was unstuck via the manual recovery path for 0.20.0/0.20.1/0.20.2, which never updates the manifest. Setting the prerelease manifest to `0.20.2` is the *right* intent (we want the next rc bumped from the most recent shipped tag, not from a stale `0.17.1`), but the plan doesn't acknowledge that the stable manifest is also stale and that this whole "manual reset after stable cut" problem already exists for stable. Worth calling out in §0 + the runbook.

  Also: with `feat:` commits since v0.20.2, release-please would compute `0.21.0-rc.1`. But `git log v0.20.2..origin/dev --format="%s"` shows ONLY one commit on dev since v0.20.2: `docs(claude): add Release runbook` (#34). That's not a feat or fix, so release-please will open NO Release PR on the first push to dev. The smoke test in §6 step 1 ("push a no-op commit") will not fire a Release PR unless that commit is `feat:` or `fix:`. Mention this in the smoke test or use a `chore!:` / `feat:` test commit.

- **§3d Workflow** — Minimal release-please-action call is correct. The reuse-`release.yml` path has a bug: line 173 says `gh workflow run release.yml --ref main -f tag=v0.21.0-rc.1`. `release.yml`'s resolve job (file:96-117) does `actions/checkout@v6` with `fetch-depth: 0` + `fetch-tags: true` then `git rev-parse --verify "refs/tags/$TAG"`. The tag `v0.21.0-rc.1` will live on a commit on `dev` only, not reachable from `main`. `fetch-tags: true` fetches all tags, so `git rev-parse` will succeed — the tag object resolves regardless of which branch its target commit is on. **BUT** downstream jobs like `lint-and-typecheck`, `unit-tests`, and `_build-extension.yml` consume `needs.resolve.outputs.sha`, which is `git rev-list -n 1 v0.21.0-rc.1` (file:117). That returns the dev-commit SHA. Reusable workflows checkout by SHA, not branch, so they should work. **Confirm during implementation** by dry-running a prerelease against a real dev tag — there may be branch-protection or actions checkout edge cases. Lean on the existing `dry_run=true` input to validate end-to-end before a real rc.

- **§3e Prerelease marking** — Plan is right that `attach-assets` only does `gh release upload --clobber` + `gh release edit --notes-file` (file:262-270), never `gh release create`. The manual recovery step at line 169 needs `--prerelease` and `--target dev`. **`--target dev` is correct** for prereleases (the commit lives on dev). The plan correctly uses `dev` at line 170. Good.

- **§4 Cycle diagram** — Accurate. Two nits: (a) the diagram says `--ref main` for the workflow_dispatch call — see §3d finding above; (b) the post-stable manifest reset (`0.21.0` → prerelease manifest) is described correctly but missing from the cycle's terminal arrow back into "more rc.N commits" — after reset the *next* rc series uses the new base. Fine.

- **§5 CLAUDE.md update** — Plan to extend the existing `### Release runbook` (CLAUDE.md:329). Comment-style check: the existing runbook uses imperative steps + paste-ready bash, no milestone tags, no absolute paths, repo-relative paths only. Plan must follow the same — no `M*`, no `A11.*`, no `pre-A11`, no PR/phase refs (per CLAUDE.md "Code-comment style" + "Implementation plans" lines 213+). The plan doc itself is clean here.

## Cross-cutting findings

1. **Stale stable manifest** is the root issue behind the §3c baseline confusion. `0.17.1` → `0.20.2` drift exists on the stable manifest itself. Either fix the stable manifest as part of this PR (a 1-line bump to `0.20.2`) so both manifests start coherent, or document the drift explicitly in §0.

2. **JSONC comments in `release-please-prerelease-config.json`** — the plan shows `// ← NEW` comments in the example JSON (§3b lines 65-67). Strip these at implementation time; release-please's parser is strict JSON.

3. **Q5 (community fork) — defer is correct**. The `release-please-oss/release-please-action@v5` fork shares the same bundled release-please 17.6.0 (per CLAUDE.md:373) and `customizing.md` v17.x docs apply identically. Switching one action while introducing a new flow doubles the variables. Defer is right.

4. **Smoke test commit type** (§6): a no-op `chore:`/`docs:` commit won't open a Release PR. Either use `feat: smoke test prerelease workflow` or note that the first real PR-ready test happens on the first feat/fix landing.

5. **Concurrency group**: plan correctly uses `release-prerelease` (separate from stable's `release`). Good — prevents mutual cancellation.

6. **App-token scope**: same App is used for both flows (CLAUDE.md:334). The App must be installed on `dev` with `pull-requests: write` + `contents: write` (already is, per the stable rollout STATUS). No extra setup. Plan should state this explicitly under "prerequisites already done".

## Verifiable claims to validate before merge

1. Confirm `release-please-action@v4` (bundled release-please 17.3.0) accepts `versioning: "prerelease"` in `ReleaserConfigOptions` (per-package). Docs are silent on which 17.x versions support it; tunarr ships it on the community fork; verify by dry-running our v4 setup against a feature branch tag.
2. Confirm `gh workflow run release.yml --ref main -f tag=v0.21.0-rc.1` resolves a tag whose commit lives on `dev` (test with `dry_run=true`).
3. Confirm `--target dev` on `gh release create` does not run afoul of `dev`'s branch-protection ruleset (signed-commits is on `dev` per CLAUDE.md:113).
4. Confirm `release-please-prerelease-config.json` has no trailing comments after the plan's JSONC examples are translated to real JSON.
5. Confirm baseline: should be the latest shipped stable tag (`0.20.2`), not the stale stable manifest (`0.17.1`). Plan picks `0.20.2` — keep that, but acknowledge in the plan's §0 that stable manifest drift exists separately.
