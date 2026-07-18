# Phase R — release + public acceptance (lessons)

## R-prep: the two release-gating folds landed ahead of the cut (2026-07-18)

Landed on dev BEFORE the release so R1's promote carries them to main:

- **(a) `verify-live` → required**: added to `release.yml`'s `status` aggregator (`needs` + result
  loop); name/comment de-advisoried. The staged-rollout flip the plan marked "due".
- **(b) `faucet-hook-preflight`**: new job right after `resolve` (stable, non-dry-run publishes
  only; `environment: production` so env-scoped secrets are visible) that hard-fails when
  `CLOUDFLARE_FAUCET_DEPLOY_HOOK` is unwired. `deploy-faucet` now needs it, and its own
  absent-hook branch flipped from notice-skip to error (unreachable post-preflight; red there
  means a secret-scoping bug). The silent dashboard-Git-integration fallback is retired — it
  stranded faucet deploys on `workflow_dispatch` republishes (no push:main → Git-integration
  never fires).

**Discovery**: `CLOUDFLARE_FAUCET_DEPLOY_HOOK` is wired NOWHERE today (not a repo secret; the
`production` environment has zero secrets). The faucet has been riding the dashboard
Git-integration only. Consequence: the next stable publish reds at the preflight until the user
wires the secret — surfaced as a pre-R ask (only the user can create secrets).

CLAUDE.md's runbook/troubleshooting/staged-rollout rows updated in the same PR.

## Gate state

R NOT started — execution is user-gated ("test it before approving R"): the user is manually
smoke-testing the local rig (extension dist/chrome build + faucet preview of the 583168d tree,
`buildId 0.1.0+583168df`, chainId 1816023401, verify:deployments green) before giving the go.
