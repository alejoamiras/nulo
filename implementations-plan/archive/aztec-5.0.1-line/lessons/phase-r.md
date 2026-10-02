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

## R EXECUTED — v0.25.0 shipped (2026-07-20)

R ran on the SIMPLIFIED pipeline (the #287 folds were reverted in #295 first — see the
over-engineering lesson). Sequence: promote dev→main (#296, merge-commit) → release-please
Release PR (#297) → auto-unstick tagged v0.25.0 → publish chain → back-sync (#298, merge-commit).

Two real snags, both recovered without weakening a gate:

1. **network-e2e infra flake CANCELLED the first publish (push:main).** The `release.yml`
   network-e2e agent ran ~30 min (tests passing — cancel-mid-prove ✓ at 15:22), then GitHub
   cancelled it at the ~30-min mark (job timeout / an "infra boot exit 86" retry on a shard). The
   cancel cascaded: attach-assets SKIPPED → the tag + GitHub release existed but with ZERO assets.
   RECOVERY (documented): re-fire the publish against the existing tag via
   `gh workflow run release.yml --ref main -f tag=v0.25.0 -f dry_run=false`. On workflow_dispatch,
   network-e2e is OFF by default — and that's CORRECT here, not gate-dodging: this exact code
   already passed network-e2e on the promote PR (#296) that put it on main, so re-rolling the flaky
   30-45min gate on the republish only risks the same flake. The republish went fully green
   (assets + deploys + verify-live). **FRAGILITY worth a targeted fix (see below).**

2. **back-sync #298 blocked by commitlint.** The back-sync PR necessarily carries the
   `release: promote dev → main` commit into dev, where commitlint is strict (PRs to main relax
   it). `release` was NOT in `.commitlintrc.json`'s type-enum despite the runbook MANDATING that
   subject → type-enum fail. FIX (root cause, no admin bypass): added `release` to the enum on the
   sync branch itself, so #298's own commitlint re-ran green AND the fix landed on dev. Future
   back-syncs won't hit this.

Confirmations: the faucet redeploys fine via Cloudflare's dashboard Git-integration on push (the
#287 hook preflight was unnecessary); verify-live (now advisory) confirmed the live sites serve
0.25.0; my release commits were SSH-signed (no backfill needed).

### FRAGILITY — network-e2e on the publish path can strand a release (open recommendation)
The release publish chain re-runs the flaky 30-45min network-e2e on push:main, and its
cancellation/timeout takes the WHOLE release down mid-attach (half-created release: tag + empty
release, needing a manual republish). But that gate already passed on the promote PR that created
the commit. A targeted fix (NOT speculative — it bit us this release): on the push:main publish
path, either (a) drop the redundant network-e2e re-run, or (b) don't hard-gate attach-assets on it.
Deferred to the user's decision — flagged, not implemented (respecting the ship-simple lesson).
