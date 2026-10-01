# Phase 2 lessons — break-glass refresh-landing.yml (2026-07-03)

## The workflow
`.github/workflows/refresh-landing.yml` — `workflow_dispatch`-only, verb-prefixed per CI conventions. One `refresh` job, `environment: production`, `permissions: contents: read` (no checkout — it only curls), a `target` choice input (`both`|`landing`|`faucet`, default `both`). Each step mirrors `release.yml`'s deploy steps verbatim: retry/backoff curl, fail on non-2xx, fail if the landing secret is unset, but **notice-and-skip** if the faucet secret is unset (matching `deploy-faucet`'s unwired-secret handling).

## Validation gate — met
- `bun run lint:actions` → clean (exit 0). actionlint also shellchecks the `run:` blocks — clean.

## Post-merge confirmation (deferred, NOT blocking)
The live `gh workflow run refresh-landing.yml` smoke **cannot run pre-merge**: GitHub only exposes a `workflow_dispatch` trigger once the workflow exists on the **default branch** (dev). So the one-shot live curl is a post-merge confirmation, not a pre-merge gate. It IS genuinely idempotent/harmless when run (unlike the Phase-1 live-repro): it only re-fires the CF deploy hook → CF rebuilds `nulo.sh` at current `main` = same version, no release-asset mutation. The goal scopes Phase 2's gate to actionlint precisely because the live smoke is post-merge.

## Least privilege
No `actions/checkout`, so `permissions: contents: read` is already more than strictly needed — the job only POSTs to an external hook URL with a secret. An Actions-write actor triggering it gains, at most, a Cloudflare rebuild-from-current-main (no content injection, no new repo write). Consistent with `release.yml`'s deploy jobs.
