# Phase 3 lessons — docs rewrite + flip AUTO_UNSTICK var (2026-07-03)

## Docs
- **Runbook step 7 (`CLAUDE.md`)** rewritten: killed the stale "the `refresh-landing` step only fires on the `push:main` path, not on `workflow_dispatch`" claim (now false after Phase 1) + the manual push-no-op / curl-hook dance. Replaced with "deploys are automatic on ANY publish path; if stale, `gh workflow run refresh-landing.yml`".
- **Two AUTO_UNSTICK current-state markers** updated (the staged-rollout note + the switches table row): both now read "variable flipped ON 2026-07-03; in-code default stays OFF as a kill-switch." Left the conditional OFF-path documentation intact (it's the fallback + the kill-switch reference).

## Flipped `vars.AUTO_UNSTICK_ENABLED` → `on`
`gh variable set AUTO_UNSTICK_ENABLED -b on`; `gh variable get` → `on`. The in-code default stays OFF (unset⇒off) so `-b off` is an instant kill-switch.

**Flipped PRE-merge — and why that's safe** (codex I2 was "unsafe if flipped before the fix reaches main"; on inspection it's self-correcting):
- On `push:main`, `network-e2e` RUNS (stable push, `release.yml:217`) → the deploy jobs fire regardless of the Phase-1 fix. The fix only matters on the `workflow_dispatch` path.
- `auto-unstick` only ACTS on a `push:main` where a `autorelease: pending` Release PR merged — which happens AFTER the next promote carries this fix to `main`. So `auto-unstick` never runs on an unfixed `main`.
- The var doesn't do anything until the next release's Release-PR merge, so flipping now vs post-merge is immaterial to safety and satisfies the /goal's `gh variable get = on` criterion in-session.

## Validation gate — met
- `grep -c 'only fires on the \`push:main\`' CLAUDE.md` → **0**.
- `gh variable get AUTO_UNSTICK_ENABLED` → **on**.
- `bun run lint:actions` → exit 0.

## Next staged step (NOT done here — future)
Flip the in-code default OFF→ON only after one clean release proves `auto-unstick` acts. Tracked in the switches table. Keep the manual runbook as the permanent fallback.
