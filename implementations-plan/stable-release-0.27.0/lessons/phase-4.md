# Phase 4 — auto-unstick + publish chain

2026-07-29. Run 30461003914 (push:main after #338) — fully green, zero intervention; the recovery
table was never consulted. auto-unstick tagged + created the release in-run; network-e2e skipped
(owner decision), marketplaces skipped (publish_marketplaces=false); sync-main-to-dev + both deploy
hooks + advisory verify-live all succeeded in the same run.

Gate (fail-closed && chain): peeled `git rev-list -n1 v0.27.0` == TAG_SHA `d4c0e97a…` ✓;
isPrerelease=false, isDraft=false ✓; assets exactly {SHASUMS256.txt, nulo-chrome-0.27.0.zip,
nulo-firefox-0.27.0.zip} ✓; body real (402 chars, git-cliff overlay) ✓; downloaded all three and
`sha256sum -c SHASUMS256.txt` → both zips OK ✓. Gate ✓.
