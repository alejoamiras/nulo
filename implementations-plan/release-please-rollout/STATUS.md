# release-please rollout — Status

**Branch**: `feat/release-please-rollout` → PR into `dev`.
**Predecessor**: `implementations-plan/bug-fixes-batch-1/` (PR #9, merged into `dev`; promoted to `main` as PR #10; 0.20.0 release attempted via the old release-it workflow on 2026-05-20, failed).

## Outcome

Replaces `release-it` with `release-please` end-to-end. Single workflow, GitHub App-authenticated, branch-protection-compatible. Eight commits:

| # | Commit | Surface |
|---|---|---|
| 1 | `3110e5dd` chore(ci): seed CHANGELOG.md + .release-please-manifest.json | new config |
| 2 | `49c96757` feat(ci): add release-please config | new config |
| 3 | `fcc7c02f` feat(ci): replace release.yml with single release-please-driven workflow | workflow rewrite |
| 4 | `4c535438` chore(ci): delete .release-it.json | cleanup |
| 5 | `9527a14a` chore(release-please): seed package.json baseline for 0.20.0 bootstrap | version bump |
| 6 | `f0e04ecd` docs(claude): update release-policy section for release-please model | CLAUDE.md |
| 7 | `1add1133` fix(ci): gate attach-assets on network-e2e + refresh CI.md release section | impl-review fix |
| 8 | `f0b8b049` fix(ci): allow attach-assets to proceed when network-e2e is skipped | impl-review fix |

## Audit cycle

| Stage | Verdict | Notes |
|---|---|---|
| Plan v1 | REJECT × 2 | Codex + Opus 4.7 both caught two fatal flaws: signed-commits assumption + workflow chaining via GITHUB_TOKEN. |
| Plan v2 | REJECT | Single-workflow architecture + bypass plan. Codex caught 5 new items including "bypass doesn't solve PR-CI firing". |
| Plan v2.1 | APPROVE-WITH-FIXES | App token replaces bypass. Three items: resolve.if + "web-flow" wording + dry_run explicit. |
| Plan v2.2 | APPROVE / GO | All three patched. Implementation greenlit. |
| Implementation review | REJECT | One blocking (attach-assets didn't depend on network-e2e) + one doc (CI.md stale) + one hygiene (commit subject case). |
| Fix-up #1 | REJECT | Added network-e2e to needs, but that broke run_network_e2e=false path (skipped need propagates skip). |
| Fix-up #2 | APPROVE / GO | Explicit `always() + result` guards. Skipped needs no longer break dependents. |

Hygiene item (commit subject capitalization in `3110e5dd`) deliberately not taken — same precedent as PR #9's review: CLAUDE.md's literal "lower-case subject" reads stricter than the actual commitlint config, which only rejects pascal/start/upper case for the WHOLE subject. Proper nouns mid-subject pass commitlint.

## User decisions

- **Q1 — Signing strategy**: GitHub App. The user set up `nulo-release-bot` (App ID `3794748`), added `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY` repo secrets.
- **Q2 — CHANGELOG sections visibility**: all 13 Conventional Commit types visible (none hidden).
- **Q3 — Prerelease flow from dev**: deferred to follow-up PR.

## Gate results

- `bun run audit:vue` — green
- `bun run --cwd packages/landing build` — green
- `actionlint` — covered by CI on PR

## Next steps (after this PR lands)

1. Promote `dev → main` via the usual `release: promote dev → main` PR.
2. Push to main triggers `release.yml`. release-please opens a Release PR `chore: release X.Y.Z`.
3. Review the Release PR (CI runs Quality / Status). Merge it.
4. Tag `v0.20.0` is created + GitHub Release pushed. Same workflow run attaches Chrome + Firefox zips + SHASUMS + git-cliff release body + triggers Cloudflare deploy hook.

## Follow-ups (out of scope)

- ~~Remove `release-as: "0.20.0"` from `.github/release-please-config.json` after 0.20.0 ships.~~ Done in the v0.20.0 follow-up PR. From then on release-please picks the next version from Conventional Commit types.
- Prerelease flow from `dev` (Q3): add a parallel `release-please-prerelease.yml` keyed on push:dev with its own manifest.
- Marketplace publishing: wire `CWS_*` + `AMO_JWT_*` secrets + replace the Firefox `gecko.id` placeholder, then flip `publish_marketplaces=true` on a manual workflow_dispatch.
- Reconcile CLAUDE.md's "Subject line must be lower-case" wording with the actual commitlint config (or tighten the config to match the doc).
