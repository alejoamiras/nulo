# Phase 4 — Targeted main fix, then re-point main

## Decision: targeted CI fix to main, NOT a full promote
`dev` was 10 commits ahead of `main` (faucet design adoption, harden-quality, release-DX #149, …). A literal `release: promote dev → main` would have shipped all 10 as a release event — out of scope for a CI-gate fix. **User chose the targeted option:** a scoped `fix(ci)` merge-commit PR to main (#173) carrying ONLY the 3 workflow renames. The dev/main drift this creates is benign — when dev→main next promotes, both sides have `name: quality-status` (same final content) so the merge is conflict-free; the renames just no-op against each other.

## Re-point main (read-modify-write, `strict:true` preserved)
Mirrored the dev rollout via `repoint.sh main …` (extracted from `origin/dev` to `/tmp` since the script lives on dev, not on the main-based branch):
1. `add-union` — main `checks` = `{3 phantoms} ∪ {3 new pinned}`, **`strict:true` preserved** (the footgun the final-codex pass flagged: the update endpoint takes `{strict, checks}`; a blind PATCH would clobber main's up-to-date requirement). Dry-run first, confirmed `"strict": true` in the body.
2. Verified the 3 new names PRODUCE + are evaluated on #173's head (a `main`-targeted PR runs full network e2e since `BASE=main`).
3. `--admin` merge #173 (phantom gate still blocks → one final admin on main; merge-commit per main's ruleset). Signed branch commit (gpgsig header present).
4. `finalize` — drop phantoms → main `checks` = `{quality-status, network-e2e-status, smoke-e2e-status}`, `strict:true`.

## A real flake, caught and classified (not papered over)
On #173, `quality-status` first went **red** — `Unit tests / Vitest` failed on ONE test: `IncomingTransferService — public surface gating > getIncomingTransfers returns [] when incomingTransfersVisible=false`. Diagnosis:
- It's on **main's** code (green on dev's #171), so not caused by the name-only rename.
- The log showed `[sw:incoming-transfer] onAccountDeleted: failed to resolve networks: transport` + vitest hanging-assertion warnings → smells like a transport-mock timing flake, not a deterministic logic failure.
- **Classified by re-running** (`gh run rerun … --failed`): the re-run came back **success** → confirmed flake. Did NOT neutralize or skip it (per the non-negotiable-gates rule) — re-ran, it passed, moved on.

## Environment note
Mid-Phase-2 the live `gh`/`curl` calls started returning `EOF`/HTTP 000 (only `api.anthropic.com` reachable) — a captive WiFi was blocking github.com. `repoint.sh` is `set -e` + read-modify-write, so the failed GETs aborted before any PATCH → `dev` stayed safely in the union state, nothing half-applied. Resumed cleanly once the network was switched.

## Final state (verified live)
- `dev`:  `{quality-status, network-e2e-status, smoke-e2e-status}`, `strict:false`
- `main`: `{quality-status, network-e2e-status, smoke-e2e-status}`, `strict:true`
