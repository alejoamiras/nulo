# Phase 6 — live verification + wrap-up

2026-07-29.
- Testnet tools: `/build.json` buildId `0.1.0+d4c0e97a` (== first 8 of TAG_SHA) and `nulo-build`
  meta identical ✓ (also covered by the run's advisory verify-live, green).
- Landing: nulo.sh serves 0.27.0 ✓ (release-selection check — the honest claim per audit).
- Release page re-check: 3 assets, hashes verified in Phase 4 ✓.
- Docs PR #340 opened (blueprint + execution record + index entry); quality-status green, CLEAN ✓.
- Mainnet tools host (Access-gated): OWNER spot-check requested (buildId suffix d4c0e97a + the
  ETHEREUM chip). Phase marked ✓ upon owner confirmation in-session.

Addendum (automated mainnet evidence + a finding):
- `tools.nulo.sh` → 302 (Cloudflare Access) as expected; but the OPEN production alias
  `nulo-tools-mainnet.pages.dev` serves `buildId 0.1.0+184f390b`, target mainnet, chainId
  4248422646 — the DEV SYNC-MERGE SHA, not TAG_SHA. Tree check: `git diff --quiet d4c0e97 184f390
  -- apps/faucet` (and all dep packages) → IDENTICAL, so the live mainnet tools content IS the
  released code; the stamp differs only because the deployment was triggered by the dev push.
- **FINDING (owner follow-up): the nulo-tools-mainnet CF project's production branch appears to
  track `dev`** — future dev pushes would deploy unreleased code to the mainnet tools domain.
  Surfaced to the owner rather than assumed deliberate; the plan's "mainnet buildId == TAG_SHA
  suffix" expectation is unsatisfiable while production tracks dev (this run: content verified
  identical instead — the gate's intent, not its letter).
- Still owner-only: the Access-domain routing check + the visual ETHEREUM-chip confirmation.

Close-out:
- OWNER CONFIRMED in-session: the mainnet tools site (through Access) renders the FROM chip as
  plain "ETHEREUM" — a string that exists only in the v0.27.0 build, so this is direct freshness
  proof for the released code on the custom domain (on top of the pages.dev buildId + the
  tree-identity check).
- CF production-branch finding: owner says tracking `dev` was DELIBERATE (two-network rollout) and
  is flipping the mainnet project's production branch to `main` now. Recorded; no issue filed.
- Phase 6 gate ✓ — all six phases green.
