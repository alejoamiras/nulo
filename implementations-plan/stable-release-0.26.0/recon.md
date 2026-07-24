# Recon — stable-release-0.26.0

Read-only terrain map for cutting stable **v0.26.0** (`dev → main`). Snapshot base: `origin/dev` HEAD `4e5435b` (#318), `origin/main` at `v0.25.0`. Captured against the live repo + GitHub API, not a blank slate.

## What exists (reuse-as-is — this is a runbook execution, not new code)

| Piece | Where | Purpose | Reuse verdict |
|---|---|---|---|
| Stable release pipeline | `.github/workflows/release.yml` | `push:main` → release-please → **auto-unstick** → resolve → gates → build chrome+firefox → smoke → attach-assets → landing/faucet deploy → verify-live → sync-main-to-dev | **Reuse as-is.** No edits. |
| Auto-unstick | `release.yml` job `auto-unstick` + `scripts/release/auto-unstick*.ts` | Does the historical 45s manual tag+publish automatically | **Reuse.** `vars.AUTO_UNSTICK_ENABLED=on` (confirmed live) → self-unsticks. |
| Landing deploy | `release.yml` job `refresh-landing` | CF Pages hook → `nulo.sh` | **Reuse.** Fires automatically on the `push:main` publish. |
| Faucet deploy | `release.yml` job `deploy-faucet` | CF Pages hook (or dashboard Git-integration fallback) → `faucet.nulo.sh` | **Reuse.** Automatic on `push:main`. |
| Sync-back | `release.yml` job `sync-main-to-dev` + `scripts/release/open-sync-pr*.ts` | Opens `chore: sync main → dev` (+ prerelease-manifest rebaseline) | **Reuse.** Auto-opens; I merge-commit it. |
| Release runbook | `CLAUDE.md` § Release runbook | Source-of-truth procedure + troubleshooting table | **Follow verbatim.** This plan is the current-state instantiation of it. |
| Prior worked examples | `implementations-plan/{stable-release-0.24.0,release-pipeline-hardening,release-prerelease-fix,required-check-mismatch}/` | Precedent for the same cut | Precedent for plan shape + failure modes. |

## Collision / premise corrections (what the naive request got wrong)

- **"Playground deployment" is a false premise.** `apps/playground/README.md`: *"Test dApp used by the network e2e suite"*, runs `localhost:5174`, **no deploy config** (no wrangler/CF/pages/vercel), appears in workflows only as a CI test harness (`pr-quick.yml`, `pr-network-e2e.yml`). It is **never deployed on a release**. Corrected with the user → real targets are **landing + faucet**, both already automatic in `release.yml`. Nothing playground-related to do.
- **Store publishing is NOT part of a release.** `publish-chrome-store` / `publish-firefox-amo` are `if: inputs.publish_marketplaces == 'true'` AND are `exit 1` stubs. "Extension build" = build the two zips + attach to the GitHub Release. No browser auto-update reaches users from this cut — de-risks blast radius/irreversibility.

## Facts that shape the steps

- dev is **23 commits ahead of main** (first-parent) since `v0.25.0`; contains `feat:` commits (#319, #316, #315, #309, #306, #302, #260, #305) → **minor bump → 0.26.0** (0.x caps any BREAKING to minor via `bump-minor-pre-major`).
- Version anchors all read `0.25.0`: root `package.json`, `apps/extension/package.json`, `.release-please-manifest.json`, `.release-please-prerelease-manifest.json`. Latest tag `v0.25.0`.
- **Required checks on `main`** (live, app-id pinned): `quality-status`, `network-e2e-status`, `smoke-e2e-status`; `strict: true` (branch-up-to-date REQUIRED on main). All three run on a PR to main. `main` ruleset = **merge-commit only** (no squash).
- dev HEAD `4e5435b` (#318) — feature PRs #315–#319 each squash-merged (green-gated). dev contains main's history via the last sync (#298 / `04e5728`), so a `dev → main` PR is up-to-date w.r.t. main.
- **No release/promote PR in flight.** Only open PR is #49 (`feat/multi-rpc-failover → dev`), unrelated — leave it alone.
- `AUTO_UNSTICK_ENABLED = on` (set 2026-07-03). `NULO_E2E_DISABLE_ACCELERATOR` not set (accelerator required in network e2e).

## Conventions to match

- Promote PR title: `release: promote dev → main (<short content summary>)` — becomes the main merge-commit subject; write it like a release note. Merge-**commit**, not squash.
- Sync-back PR merged with **merge commit** (`gh pr merge --merge`), never squash — preserves main's release commit in dev ancestry (the prerelease anchor needs it).
- Keep PR-title length ≤ ~93 chars (squash appends ` (#NN)`; commitlint header-max-length=100). Promote/sync are merge-commits so less sensitive, but keep tidy.
