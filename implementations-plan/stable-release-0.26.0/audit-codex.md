# Audit — codex (stable-release-0.26.0)

- **Model:** gpt-5.6-sol · **effort:** xhigh · **sandbox:** read-only
- **Session:** `019f91c5-9a33-7e43-abd4-12023f79382e`
- **Caveat:** codex reported its local `gh` credential was invalid → all live-settings claims were re-verified by me against the workflow files before adoption.

## Round 1 verdict

> `reject (with blocking findings: freeze the release SHA; require all PR and live/provenance gates; repair or explicitly handle partial auto-unstick states)`

### Findings + disposition (full mapping in `plan.md` → ## Audit — codex)

**Adopted (verified real):**
- Freeze the release SHA (mutable promote head) → `RELEASE_SHA` pin (P1) + head-not-moved guard (P2.3).
- Release PR **and** sync PR each run full required CI incl network-e2e (~25–45m), not quality-only → P3 + P5 gates rewritten; timing note added. Verified: PRs to main always run network-e2e + smoke; the version bump touches `apps/extension/package.json`, matching the `extension-network` filter.
- `sync-main-to-dev` DAG position: `needs:[resolve,attach-assets]`, parallel to deploy/verify, push-only, advisory — NOT after verify-live. Verified against `release.yml` L442+. DAG + Fact #7 corrected.
- Faucet freshness: `apps/faucet/package.json` = `0.1.0` (independent of extension version); "serves 0.26.0" is wrong — check `buildId`/release SHA. Verified. P6 + Fact #8 corrected.
- Partial auto-unstick (tag→relabel→create-Release) can strand a green-looking assetless release → P4 detection gate (tag SHA == merge SHA, assets present, isPrerelease=false, non-placeholder body) + `workflow_dispatch` publish recovery.
- First-parent count is 21, not 23 (23 = total incl. sync merge). Verified `git rev-list --count --first-parent` = 21. Corrected.
- "Security sensitivity LOW" untenable for the ~48k-line shipped content (bridge Permit2, account-freeze, backup) → reframed: `light` scopes the release *mechanics*; content was gated per-PR; `/harden security` + testnet canary surfaced as Ask A2.
- Supply-chain overstated: mutable action tags; SHASUMS = self-consistency not provenance → Security §(c) softened with honest limits; SHA-pinning/provenance deferred (accepted risk).
- `mergedAt` doesn't prove merge method → 2-parent check added to P2/P3/P5 gates.

**Initially rejected in R1, then REVERSED in R2 (codex was right, I was wrong):**
- "verify-live defaults to `testnet.tools.nulo.sh`" — R1 I claimed the script targets `faucet.nulo.sh`. R2 verification of `scripts/release/verify-live-run.ts:91-92` shows `FAUCET_URL ?? "https://testnet.tools.nulo.sh"` — the R1 grep match (`faucet.nulo.sh`) was in a different file. `faucet.nulo.sh` serves a login page (line-22 comment), not `build.json`. **Adopted** — Fact #8 + Phase 6 corrected.

**Confirmed (no change):**
- Clean-path auto-unstick needs no manual 45s unstick; network-e2e runs on the promote PR but is OFF on the auto push:main publish; 3-merge order + merge-commit method correct; recon reuse correct; 0.26.0 computation sound.

## Round 2 (resume) verdict

> `conditional approve (with conditions: close the release-SHA, hostname, atomic-merge, and recovery gaps)`

"Most original blockers are properly closed." Four precise conditions — **all folded into `plan.md`** and marked closed in the plan's ## Audit table:
1. **Faucet pointer** — automated `verify-live` checks `testnet.tools.nulo.sh` (serves `build.json`); `faucet.nulo.sh` is a login page (manual/visual only). Fact #8 + Phase 6.1.
2. **SHA disambiguation** — `RELEASE_SHA` (pinned dev, pre-promotion) vs `TAG_SHA` (`git rev-list -n1 v0.26.0`, the Release-PR merge commit that the build + `buildId` derive from). Faucet freshness = `buildId` SHA-suffix == `TAG_SHA` first-8, NOT `RELEASE_SHA`. Phase 1.1 note + Phase 4 + Phase 6.
3. **Atomic merge** — `gh pr merge <n> --merge --match-head-commit "$RELEASE_SHA"` (flag verified present) closes the TOCTOU window the fetch/equality pre-check left open. Phase 2.4.
4. **Recovery hardening** — assetless-release `workflow_dispatch` republish is gated on `TAG_SHA == Phase-3 merge SHA` (never publish from a wrong/hostile tag); stale faucet + unset hook → the break-glass `refresh-landing.yml` SKIPS the faucet, so use a real Cloudflare dashboard/API redeploy. Phase 4.2 + Phase 6.1.

Non-blocking: DAG wording corrected (refresh-landing ∥ deploy-faucet → verify-live waits for both; sync-main-to-dev parallel to that branch).

**Net:** conditional approve with all conditions adopted → the plan is gate-eligible.
