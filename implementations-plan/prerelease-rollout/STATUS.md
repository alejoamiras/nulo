# Prerelease rollout — Status

**Branch**: `feat/release-prerelease` → PR into `dev`.
**Predecessor**: `implementations-plan/release-please-rollout/` (stable release flow shipped; v0.20.0–v0.20.2 released).

## Outcome

Adds a parallel prerelease flow from `dev` (`vX.Y.Z-rc[.N]` tags) without touching the stable flow. Plus an opportunistic fix to a drift in the stable manifest that both reviewers caught during planning.

| Commit | Surface |
|---|---|
| `chore(release-please): fix stable manifest drift (0.17.1 -> 0.20.2)` | `.release-please-manifest.json` (drift fix) |
| `feat(ci): add release-please prerelease config + manifest` | `.github/release-please-prerelease-config.json`, `.release-please-prerelease-manifest.json` |
| `feat(ci): add release-prerelease.yml + make network-e2e opt-in on dispatch` | `.github/workflows/release-prerelease.yml` (new), `.github/workflows/release.yml` (network-e2e opt-in) |
| `docs(claude): extend Release runbook with Prerelease (rc) procedure` | `CLAUDE.md` runbook |
| `docs(claude): correct prerelease pr merge type to squash` | `CLAUDE.md` fix-up (codex impl review) |

## Audit cycle

| Stage | Verdict | Notes |
|---|---|---|
| Research subagent — prerelease patterns | n/a | Sonnet investigated release-please prerelease config + real-world examples. Confirmed two-files-two-manifests required. |
| Research subagent — community fork | n/a | Sonnet investigated `release-please-oss/release-please-action@v5`. Conclusion: **does NOT fix the v4 abort bug** — same bundled release-please version, no relevant patches. No version of release-please-action escapes the bug. |
| Plan v1 | REJECT × 2 | Codex + Opus 4.7 both APPROVE-WITH-FIXES with the same critical finding (stable manifest drift) + 7 specific corrections. |
| Plan v2 | APPROVE / GO | All 8 fixes folded in. Codex final pass cleared it. |
| Implementation review | APPROVE-WITH-FIXES | One real bug (wrong merge type in prerelease subsection — fixed) + one CLAUDE.md compliance nit (commit subject case — accepted as precedent: commitlint passes; same call as in PR #9). |

## User decisions

- **Q1 — Prerelease suffix label**: `rc`. Tags: `v0.21.0-rc`, `v0.21.0-rc.1`, …
- **Q2 — Trigger cadence**: **manual `workflow_dispatch` only**. No auto-fire on push:dev — rc cuts are explicit decisions. `gh workflow run release-prerelease.yml --ref dev` opens the PR.
- **Q3 — Post-stable manifest reset**: manual procedure documented in CLAUDE.md (two-step: main→dev merge first, then prerelease manifest PR).
- **Q4 — Network-e2e on prereleases**: optional, **OFF by default** on workflow_dispatch. Stable push:main still auto-runs network-e2e. Pass `-f run_network_e2e=true` to opt in.
- **Q5 — Community fork investigation**: research only (not migration). Done. Fork doesn't fix our bug; no migration path.

## Gate results

- `actionlint` — green (CI on PRs touching workflows).
- `bun run audit:vue` — green (no extension code touched).
- Manual review of `git diff origin/dev..HEAD` against the v2 plan.

## Next steps (after this PR lands)

1. PR `feat/release-prerelease` → `dev`. CI runs, then squash-merge.
2. Promote `dev → main` via the usual promote PR.
3. First rc cut available via:
   ```bash
   gh workflow run release-prerelease.yml --ref dev
   ```
   (No eligible commits since v0.20.2 yet — release-please will open no PR until a feat/fix lands on dev.)

## Follow-ups (out of scope)

- **No upstream fix path** for the v4 abort bug across v3/v4/v5/community fork. The manual workaround is the long-term operational pattern unless we switch release tooling entirely (changesets, semantic-release, etc.). Not warranted today.
- Consider archiving the published `community-fork-research.md` + the abort-bug runbook into a `RELEASE-OPS.md` if the team grows beyond one person managing releases.
