# Release-pipeline hardening — deploy jobs skip on `workflow_dispatch`

**Status:** DRAFT (2026-07-03) — `/blueprint light`, Phase 0 answers locked. Awaiting codex audit + approval gate.
**Tier:** `light`. Rubric: novelty LOW (the `always()` pattern already lives in this file), blast radius MODERATE (breaks the *release process*, not the shipped extension), irreversibility LOW (CI is revertible; the flip is a repo variable), migration NONE, external coupling MODERATE (Cloudflare hooks — unchanged, only *when* they fire), security LOW (no new secrets/privilege). Zero HIGH → `light`.

## What this is
A targeted fix + hardening for the release pipeline, motivated by the `stable-release-0.24.0` cut where `nulo.sh` stayed on v0.23.0 after a `workflow_dispatch` publish and needed a manual Cloudflare-API deploy to unstick.

**Root cause (verified):** `refresh-landing` (`release.yml:348`) and `deploy-faucet` (`release.yml:377`) are missing the `always() && …result=='success'` guard that every upstream job carries. On a `workflow_dispatch` publish, **several ancestors skip** — `release-please` (push-only, `release.yml:50`), `auto-unstick` (push-only), and `network-e2e` (off unless `run_network_e2e=true`, `release.yml:213-219`). GitHub's skip-propagation through the needs-graph (documented at `release.yml:184-190`; expressions without a status function get implicit `success()`, and skipped ancestors propagate) then skips the two deploy jobs too — *even though their direct need `attach-assets` succeeded* (`attach-assets` survives via its own `always()` at `release.yml:260`). The fix does not depend on WHICH ancestor skipped; `always()` is the documented override. So every manual-unstick + `workflow_dispatch` publish leaves the landing/faucet un-refreshed. `verify-live` (`release.yml:415`) already has `always()`, so it correctly runs and *fails* against the stale site — the red was the symptom, not the bug.

**Scope (user-locked):** Core fix + break-glass workflow. **Excluded:** the `fetch-latest-release.ts` asset-less fallback (low value — `auto-unstick` collapses the empty-Release window to seconds; tracked as a note, not built).

## Phase 1 ✓ — `always()` guards on the two deploy jobs (root-cause fix)
_Done 2026-07-03: guard on refresh-landing:349 + deploy-faucet:381, verify-live untouched, actionlint clean, 8-case logic-review passed. See [lessons/phase-1.md](lessons/phase-1.md)._
- **`refresh-landing` (`release.yml:348`)** and **`deploy-faucet` (`release.yml:377`)**: prepend a guard mirroring `attach-assets`, so a skipped ancestor no longer skips them, while staying fail-closed on a real failure or a cancellation:
  ```yaml
  if: |
    always() && !cancelled() &&
    needs.resolve.result == 'success' &&
    needs.attach-assets.result == 'success' &&
    needs.resolve.outputs.is_prerelease == 'false' &&
    (github.event_name == 'push' || github.event_name == 'workflow_dispatch') &&
    github.event.inputs.dry_run != 'true'
  ```
  - `needs.attach-assets.result == 'success'` is the fail-closed guard — never deploy off a broken/asset-less release.
  - `!cancelled()` (codex Low) — a user-cancelled run can't later fire the deploy hooks.
- **`verify-live` (`release.yml:414`) — LEAVE UNCHANGED.** (codex **High**, reversing the draft.) It already has `always()` + `attach-assets` success, so it RUNS when the deploys skip and correctly fails against a stale site — that's the safety net that caught this very bug. Adding `needs.refresh-landing.result=='success'` guards would make it *skip* instead, hiding the skip-regression class (verify-live is advisory / not in `status`, and `status` treats `skipped` as OK at `release.yml:552-569`). Do NOT touch it.
- **Do NOT touch** the `is_prerelease` / event / `dry_run` semantics — only add the `always() && !cancelled()`+`success` prefix. Prerelease tags still skip the deploys (correct — the landing tracks stable only).

**Validation gate:**
- `bun run lint:actions` (actionlint) → exit 0.
- **Logic-review** (default proof — the change is deterministic + codex-confirmed `always()` is the documented remedy): walk each guard combination and confirm the deploys run on `(push||dispatch)` stable non-dry-run with `attach-assets` success, and skip on prerelease / dry-run / failed-or-cancelled attach-assets.
- **OPTIONAL live-repro** (surfaced at the approval gate — the user reconfirms given the corrected risk framing): `gh workflow run release.yml --ref <branch> -f tag=v0.24.0 -f dry_run=false -f run_network_e2e=false -f publish_marketplaces=false`, then `gh run view <id> --json jobs` shows `refresh landing` + `deploy faucet` = **`success`** (not `skipped`) despite `network-e2e=skipped`. ⚠️ **This is a production republish of v0.24.0, NOT a no-op** (codex Medium): `attach-assets` re-clobbers the shipped zips/SHASUMS + re-sets the release body + re-fires the deploy hooks. Low real-risk (no consumers pin v0.24.0; same version; `nulo.sh` stays v0.24.0) but it mutates a shipped artifact — hence optional. The next real `0.24.1` release proves the fix live for free.
- Layers: lint (actionlint) + logic-review [+ optional live-CI dispatch].

## Phase 2 ✓ — break-glass standalone `refresh-landing.yml`
_Done 2026-07-03: `workflow_dispatch`-only, target input, contents:read, actionlint clean. Live-dispatch smoke deferred post-merge (workflow_dispatch needs the default branch). See [lessons/phase-2.md](lessons/phase-2.md)._
- New workflow `.github/workflows/refresh-landing.yml`, **`workflow_dispatch` only**, verb-prefixed per CI conventions. One job, `environment: production`, minimal `permissions:` (`contents: read`), that curls the deploy hook(s) — mirroring `release.yml:356-372`'s step (retry/backoff, fail on non-2xx, fail if the secret is unset).
- A `target` choice input (`landing` | `faucet` | `both`, default `both`): curls `CLOUDFLARE_PAGES_DEPLOY_HOOK` and/or `CLOUDFLARE_FAUCET_DEPLOY_HOOK`. The faucet hook may be unset → mirror `deploy-faucet`'s notice-and-skip (`release.yml:389-394`), don't fail.
- Purpose: a stuck landing after any dispatch republish (or any reason) becomes a one-command `gh workflow run refresh-landing.yml` — no CF token, no account ID, no dashboard, no full rebuild.

**Validation gate:**
- `bun run lint:actions` → exit 0.
- `gh workflow run refresh-landing.yml -f target=landing` (after merge, or on-branch via `--ref`) → the run's curl step reports HTTP 2xx + a new Cloudflare production deployment appears / `nulo.sh` rebuilds. (This workflow's only real test IS the live curl — it has no dry-run.)
- Layers: lint (actionlint) + live-CI (a real dispatch that triggers a CF deploy).

## Phase 3 ✓ — docs rewrite + flip the `AUTO_UNSTICK_ENABLED` variable
_Done 2026-07-03: runbook step 7 rewritten (stale claim gone, grep=0), 2 current-state markers updated, `AUTO_UNSTICK_ENABLED` flipped ON (var=on, code-default OFF). Flipped pre-merge — safe per I2. See [lessons/phase-3.md](lessons/phase-3.md)._
- **`CLAUDE.md` § Release runbook step 7** ("Cloudflare landing redeploy"): the manual push-no-op / curl-hook / CF-API dance is obsolete — rewrite to "the landing + faucet now deploy automatically on **any** publish path (`push:main` AND `workflow_dispatch`) after the Phase-1 fix; if ever stuck, `gh workflow run refresh-landing.yml`". Remove the stale claim that `refresh-landing` "only fires on the `push:main` path, not on `workflow_dispatch`".
- **Division-of-labor + staged-rollout-switches tables**: note the `always()` fix; update the `AUTO_UNSTICK_ENABLED` switch row to reflect it's being flipped ON (default still OFF in-code as a kill-switch).
- **Flip the variable (post-merge step, per Q2):** `gh variable set AUTO_UNSTICK_ENABLED -b on`. Keep the workflow's in-code default OFF (unset ⇒ off) — the flip is via the repo variable only, so it stays an instant kill-switch. The code default flips to ON only after ONE release proves `auto-unstick` acts cleanly (a later, separate change — noted, not done here).

**Validation gate:**
- `grep -c "only fires on the \`push:main\`" CLAUDE.md` → 0 (stale claim gone).
- `gh variable get AUTO_UNSTICK_ENABLED` → `on` (done after the PR merges).
- `bun run lint:actions` → exit 0 (whole-PR).
- Layers: lint + repo-state (variable) + doc-grep.

## Security & Adversarial Considerations
- **Threat model — the break-glass workflow curls a deploy-hook *secret* on `workflow_dispatch`.** Trigger requires Actions *write* (repo collaborator). Impact is bounded: the hook triggers a Cloudflare rebuild *from the current `main` git state* — an attacker with write can't inject content via this workflow (CF builds from the repo, not from workflow input), and can already push to branches. So it adds no meaningful privilege. `environment: production` (matching `release.yml`'s deploy jobs) inherits that environment's protections.
- **Least privilege:** the new workflow gets `permissions: contents: read` (it only needs the secret + a checkout-free curl). No `contents: write`, no token beyond the hook secret. Reuses existing `CLOUDFLARE_*_DEPLOY_HOOK` secrets — **no new credentials**.
- **The `always()` fix is fail-CLOSED, not open:** the added `needs.attach-assets.result == 'success'` means the deploy jobs run in *strictly fewer* dangerous cases than a naive `always()` — a failed/cancelled `attach-assets` (broken or asset-less release) now provably blocks the deploy. This is a security *improvement* over a hypothetical unguarded always().
- **Supply chain:** no new deps; the workflow uses `curl` (already in `release.yml`). Pin `actions/*` to the repo's existing major versions.
- **Adversarial review ask for the audit:** could the `always()` change make a deploy fire off a prerelease, a dry-run, or a failed build? (It must not — the `is_prerelease=='false'`, `dry_run!='true'`, and `attach-assets=='success'` guards remain.) Can the break-glass workflow be abused to spam CF deploys or leak the hook? Is `contents: read` truly sufficient?

## Assumptions
### Facts (verified)
- **F1** — `refresh-landing` (`release.yml:348`) + `deploy-faucet` (`release.yml:377`) `if:` blocks start at `needs.resolve.outputs.is_prerelease == 'false' &&` with **no `always()`**. (read)
- **F2** — `attach-assets` (`release.yml:259-263`) HAS `always() && needs.resolve.result=='success' && !contains(needs.*.result,'failure') && !contains(needs.*.result,'cancelled')`, with a comment (256-258) explaining it exists to survive a skipped `network-e2e`. (read)
- **F3** — `network-e2e` (`release.yml:213-219`) runs on stable `push:main` OR when `run_network_e2e=='true'`; **skips on a `workflow_dispatch` that doesn't opt in**. (read)
- **F4** — `resolve` (`release.yml:175-176`) sets `is_prerelease='false'` for any tag without a `-` (e.g. `v0.24.0`), on BOTH push and dispatch. So `is_prerelease` is NOT why the deploys skipped. (read)
- **F5** — empirically, on dispatch re-fire run `28667683653` (`run_network_e2e=false`): `attach-assets=success`, `network-e2e=skipped`, `refresh landing=skipped`. (gh run view)
- **F6** — `verify-live` (`release.yml:414-419`) already carries `always()` + `needs.attach-assets.result=='success'`; it is NOT part of the skip bug. It is currently ADVISORY (not in the `status` aggregator, `release.yml:409-413`). (read)
- **F7** — `CLOUDFLARE_PAGES_DEPLOY_HOOK` + `CLOUDFLARE_FAUCET_DEPLOY_HOOK` are repo secrets; only `release.yml` references them; there is NO standalone `workflow_dispatch`-able workflow that curls them. (grep + `gh secret list`)
- **F8** — the `auto-unstick` job (`release.yml:99-101`) is gated by `vars.AUTO_UNSTICK_ENABLED`, currently unset (OFF); on stable `push:main`, `network-e2e` runs, so the deploy jobs fire there even pre-fix. (read + `gh variable list` returned empty)

### Inferences (unverified — audit please)
- **I1** — with `always() && !cancelled()`+success guards, `refresh-landing`/`deploy-faucet` will FIRE on a dispatch republish where an ancestor skipped (mirrors `attach-assets`, which does exactly this today). Codex: sound; validate live if the optional live-repro is run.
- **I2** — flipping `AUTO_UNSTICK_ENABLED` ON is safe to do now (after the fix merges to dev), NOT gated on the fix reaching `main`. Codex flagged "unsafe if flipped before the fix reaches main"; on inspection it's **self-correcting** two ways: (a) on `push:main`, `network-e2e` RUNS (stable push, `release.yml:217`) so the deploys fire regardless of the fix; (b) the fix reaches `main` via the promote (push:main #1) BEFORE the Release-PR merge where `auto-unstick` acts (push:main #2), so `auto-unstick` never runs on an unfixed `main`.
- **I3 (corrected)** — the optional live-repro is a **production republish of v0.24.0**, not a no-op: `attach-assets` re-clobbers the shipped zips/SHASUMS + re-sets the release body + re-fires the deploy hooks (`release.yml:329-334`). No tag mutation, no marketplace (`publish_marketplaces=false`). Low real-risk (no consumers pin v0.24.0), but it mutates a shipped artifact — which is why the live-repro is optional, not the default gate.

## Audit verdicts
- **Codex (xhigh, session `019f28d2…`): conditional approve.** Conditions folded: (High) dropped the `verify-live` change — leave it alone; (Low) added `!cancelled()`; (Medium) re-labeled the live-repro as a production republish + downgraded it to optional; (Medium) softened the mechanism attribution. I2 "unsafe" clarified as self-correcting. Full transcript: [audit-codex.md](audit-codex.md).

### Asks (resolved — no silent assumptions)
- Scope → **Core + break-glass** (fetch-fallback excluded). Auto-unstick → **var ON now, code-default OFF**. Validation → **actionlint + live-repro dispatch**. All three resolved via Phase-0 `AskUserQuestion`.

## Post-implementation hardening
Not warranted. This is a targeted CI-config fix, not a whole-codebase surface. No `/harden` scheduled. (The related `verify-live` → `status` promotion and the `auto-unstick` code-default flip are their OWN staged switches, already tracked in `CLAUDE.md` — out of scope here.)

## Decision ledger
- **Scope: Core + break-glass, fetch-fallback OUT.** The `fetch-latest-release.ts` asset-less fallback guards the unstick→attach window, which `auto-unstick` shrinks to seconds — low value for the churn. Rejected for this plan; noted as a latent idea.
- **Auto-unstick: variable-only flip, code-default stays OFF.** Keeps an instant kill-switch (no PR to disable) and respects staged-rollout ("prove the auto path on one release before making it the default").
- **Validation: live-repro dispatch over logic-review-only.** The whole point is non-recurrence; a real dispatch that reproduces the skip condition is the only thing that actually proves the fix. Accepted the ~15-20 min + one idempotent redeploy as the cost.
- **verify-live: strengthen, don't rewrite.** It already works; only add explicit deploy-success gating. Its `always()` stays.

## Seeds (DRAFT — finalized post-approval)
Recommended: `/goal` (completion is fully transcript-observable — lint exit codes, a grep, a variable read).

**`/goal`:**
```
/goal All 3 phases marked ✓ in implementations-plan/release-pipeline-hardening/plan.md, each backed by its gate in the transcript: P1 — `bun run lint:actions` exit 0 + a printed logic-review of the refresh-landing/deploy-faucet guards; P2 — refresh-landing.yml passes `bun run lint:actions`; P3 — `grep -c "only fires on the \`push:main\`" CLAUDE.md` = 0 AND `gh variable get AUTO_UNSTICK_ENABLED` = on. For each phase print `LESSONS_FILE=implementations-plan/release-pipeline-hardening/lessons/phase-N.md`. Then `/code-review max --fix` applied + committed separately; codex post-impl audit done with high/critical addressed; `bun run lint:actions` exit 0; PR opened to dev. Never touch verify-live's always(); never weaken a gate.
```

**`/loop` (fallback):**
```
/loop 15m Drive implementations-plan/release-pipeline-hardening forward. Never idle. Each firing: read plan.md + lessons/; `git status`; if a PR exists `gh pr view --json statusCheckRollup` (no --watch). Take the next pending phase, run its gate (actionlint / logic-review / grep+var), mark ✓ in plan.md, file lessons/phase-N.md + print its path. Stuck or a fork? `/codex xhigh`, decide, log it — never neutralize a gate, never touch verify-live's always(), never merge to main. All phases ✓ → `/code-review max --fix` (commit separately) → codex post-impl audit → open PR to dev → surface + stop.
```
