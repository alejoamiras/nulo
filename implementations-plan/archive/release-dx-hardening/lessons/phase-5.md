# Phase 5 — Deploys + live smoke (built via the fallback, no test repo)

## Context
The user was AFK at the Phase-4 test-repo gate (cron auto-firing, no answer). Per the loop's explicit "Phases 4-7 … if it yak-shaves, fall back to unit + dry_run + the staged rollout, **don't block**", and since the test-repo path is blocked on the human gate (a hard limit I won't cross), I proceeded on the **fallback**: build on the branch, unit-tested scripts + actionlint, no test repo, no secret wired, no real release, `main` untouched. Crosses no hard limit; reversible.

## What shipped
- **`scripts/release/verify-live-run.ts`** (`390b8713`) — I/O runner around the pure `verifyLive`: cache-busted GETs of `faucet/`, `faucet/build.json`, `landing/`, bounded retry (rides CDN propagation), **fail-closed**. Injectable `fetch`/`sleep`; 8 unit tests (split-cache, retry-rides-it-out, persistent-unreachable, unparseable-json, wrong-chainId, non-200). + a `import.meta.main` CLI entry the job runs.
- **`release.yml`**: (a) `refresh-landing` now also fires on `workflow_dispatch` (was push-only); (b) NEW `deploy-faucet` job (mirrors refresh-landing against `CLOUDFLARE_FAUCET_DEPLOY_HOOK`, **skips-not-fails when unwired** so an unset secret never blocks a release); (c) NEW `verify-live` job calling the runner; (d) `deploy-faucet` added to the `status` aggregator.
- **CI.md** release-chain description updated (DOC PRIORITY).

## Two staged-rollout decisions (cautious, repo-consistent)
- **`verify-live` ships ADVISORY** — deliberately NOT in the `status` aggregator. It's a fail-closed check shipped UNREHEARSED (no test repo), so it reports red without blocking the required check until proven on the first clean real release; a 1-line follow-up then adds it to `status`'s needs. Mirrors the repo's "smoke advisory until hardened" + the `AUTO_UNSTICK_ENABLED` staging.
- **`deploy-faucet` skips when unwired** — `CLOUDFLARE_FAUCET_DEPLOY_HOOK` is the user's gated secret (I did NOT wire it). Until then the faucet still auto-deploys via the CF dashboard Git-integration; the A5 cutover (disable the dashboard side) is the user's deferred task — double-deploy accepted, not blocked.

## What the fallback skipped (tracked)
The test-repo rehearsal of the deploy-hook ordering + a forced verify-live PASS/FAIL against throwaway sites. The end-to-end proof is deferred to the **staged real release** (verify-live observed green there, then promoted to required). If the user later picks "go", the branch can still be rehearsed in a test repo before that.

## Gate — GREEN (fallback scope)
- `bun test scripts/release/` (incl. verify-live-run) → all green; `bun run lint:actions` → exit 0 (release.yml + new jobs' shell clean).
- Test-repo rehearsal: SKIPPED (fallback). Real-release end-to-end: deferred (staged).
