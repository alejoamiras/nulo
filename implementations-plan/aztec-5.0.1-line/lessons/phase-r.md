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

## Pre-R smoke findings (user manual test, 2026-07-19) — both fixed in #288 (`3f4785f` on dev)

1. **registerContract void-conformance (connect-blocking)**: 5.0.1 WalletSchema returns
   `Promise<void>`; our handler returned the instance → dApp-side `z.void()` ZodError killed the
   faucet handshake. THE CI BLIND SPOT: unit tests never execute the dApp-side wallet-sdk
   validator, and the one e2e that does (`contracts-register`) asserted `["ok","error"]` — the
   ZodError fired on every CI run as status "error" and was ACCEPTED. Now strict "ok" + a bb-free
   unit pin. Lesson: conformance to an externally-owned schema needs a pin against that schema;
   an assertion that tolerates "error" isn't a test, it's a mute button.
2. **authwit warning UX**: floating icon+text above the account picker → first-class deselectable
   card ("Act on your behalf", risk high); deselection strips `canCreateAuthWit` from the grant
   (`buildGrantedAccountsCap`, pure + pinned). Display info deliberately NOT a CAPABILITY_LABELS
   key (dApp-controlled `cap.type` lookup would render a fake type as recognized/default-ON).

Also: local smoke rig needed a secure origin — raw tailnet-IP HTTP is not a secure context
(COOP ignored, `crypto.randomUUID` absent). Fixed via Tailscale Serve HTTPS in front of the vite
preview (`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` for the host allowlist; no repo config).
