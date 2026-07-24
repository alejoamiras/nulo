# Plan — stable-release-0.26.0

**Blueprint tier:** `light` · **eli5_mode:** Artifact (primary) · **Worktree:** `stable-release-0.26.0`

## Summary

Cut stable **v0.26.0** by promoting the 23 dev-only commits (since `v0.25.0`) to `main`, letting the existing `release.yml` pipeline build + attach the Chrome/Firefox zips to a GitHub Release, and redeploy the two real web targets — **landing (`nulo.sh`)** and **faucet (`faucet.nulo.sh`)** — via their Cloudflare Pages hooks. This is **runbook execution, not code work**: no source files change; the only repo mutations are bot-authored (release-please version bump + CHANGELOG, and the sync-back). "Playground deployment" from the original ask was a false premise — the playground is a local e2e test harness with no deploy target (see `recon.md`); it is out of scope with nothing to do.

**Scope confirmed with user:** targets = landing + faucet (not playground); drive = **end-to-end** (I open+merge the promote PR, merge the release-please PR, merge the sync-back PR — i.e. I merge to `main` on your behalf, post-approval); version = **0.26.0 auto**. Store publishing is out (stub + opt-in).

## Why `light`

Phase 0.5 rubric — HIGH count = **0**:
- **Novelty** LOW — 6th+ run of a proven runbook (v0.21→v0.25 all shipped this way).
- **Blast radius** MODERATE-bounded — no marketplace publish (zips only sit on the GH Release), so no auto-update reaches users; gated by 3 required CI checks.
- **Irreversibility** MODERATE-bounded — a tag/Release is awkward to unpublish, but fixable; no data/schema/prod-state change.
- **Migration cost** LOW — pre-production, no user storage to migrate.
- **External coupling** MODERATE — Cloudflare + GitHub Actions + release-please, all automated and proven.
- **Security sensitivity** LOW — no new secrets; reuses the `nulo-release-bot` App token + existing CF hooks.

Bounded, single-runbook, low-risk → `light`.

## Architecture & Implementation (compact)

**Shape.** The "architecture" here is the release pipeline topology, reused verbatim. I drive only the three human decision points that GitHub reserves for a person (the three merges to `main`/`dev`); everything between them is automated by `release.yml`.

Critical flow (the DAG):
```
[me] open promote PR (dev→main)
      └─ CI: quality-status + network-e2e-status + smoke-e2e-status  (REQUIRED, ~25–45m)
[me] merge promote PR (merge-commit) ──► push:main
      └─ release.yml: release-please opens `chore(main): release 0.26.0`
[me] merge Release PR (merge-commit) ──► push:main
      └─ release.yml (AUTO_UNSTICK=on):
           auto-unstick → tag v0.26.0 + create Release + relabel
           resolve → lint/typecheck → unit-tests → build-chrome + build-firefox
                   → smoke-against-artifact → attach-assets (zips + SHASUMS + cliff notes)
                   → refresh-landing (nulo.sh) + deploy-faucet (faucet.nulo.sh)
                   → verify-live (advisory) → sync-main-to-dev opens `chore: sync main → dev`
[me] merge sync-back PR (merge-commit, NOT squash)
```

**File-level change map.** No hand-edited source. Bot-authored on the pipeline: `package.json` + `apps/extension/package.json` version → `0.26.0`, `CHANGELOG.md`, `.release-please-manifest.json` → `0.26.0` (Release PR); `.release-please-prerelease-manifest.json` → `0.26.0` (sync-back rebaseline). This plan dir (`implementations-plan/stable-release-0.26.0/`) is the only human-authored artifact and lands via its own docs PR to `dev`, decoupled from the release mechanics.

**Reused as-is (zero edits):** `release.yml` (all 17 jobs), `auto-unstick`, `refresh-landing`, `deploy-faucet`, `sync-main-to-dev`, `scripts/release/*`. See `recon.md`.

**Key "interface":** the required-check contract on `main` — `quality-status`, `network-e2e-status`, `smoke-e2e-status` (strict=true). These gate the promote PR; nothing merges to main until all three are green.

**Simpler alternative considered (rejected):** *"just merge the promote PR and let full automation ride, no plan."* Rejected — the three merges are irreversible-ish actions to `main` that warrant an explicit gate + a recorded pre-flight state, and the user asked for a blueprint. The plan adds ~0 mechanical steps over the runbook; its value is the current-state instantiation (exact version, exact deploy targets, the playground correction) + the approval checkpoint before I touch `main`.

## Phases

> Every phase's gate uses the project's REAL tooling — the GitHub Actions required checks + `gh` release inspection. No local build/test is on the critical path (CI owns gating); local `bun run audit:vue` is available as an optional pre-flight sanity check but is NOT required (dev's content already passed its per-PR gates).

### Phase 1 — Pre-flight verification (no writes to main)
1. Confirm `origin/dev` HEAD is the intended release content and each constituent PR merged green: `gh run list --branch dev --limit 5 --json conclusion,workflowName,displayTitle`.
2. Re-confirm invariants: main at `v0.25.0`, no promote/release PR already open (`gh pr list --state open --base main`), `AUTO_UNSTICK_ENABLED=on` (`gh variable list`).
3. Draft the promote PR title (≤93 chars) + body (release-note summary of the 23 commits).

**Validation gate** — Commands: the three `gh` reads above. Pass criteria: dev HEAD identified + its PRs green; **zero** open PRs into `main`; AUTO_UNSTICK=on. Layers: (meta/state verification — no build).

### Phase 2 — Promote `dev → main`
1. `gh pr create --base main --head dev --title "release: promote dev → main (…)" --body-file <summary>`.
2. Watch required checks: `gh pr checks <n> --watch` (network-e2e is the long pole, ~25–45m). **Flake → re-run the specific check; real breakage → STOP and surface** (do not weaken any gate).
3. Merge as **merge-commit**: `gh pr merge <n> --merge --delete-branch=false` (main ruleset = merge-only; GitHub web-flow-signs the merge).

**Validation gate** — Commands: `gh pr checks <n>` shows `quality-status`, `network-e2e-status`, `smoke-e2e-status` all `pass`; `gh pr view <n> --json state,mergedAt`. Pass criteria: all 3 required checks green; PR merged via merge-commit; `git ls-remote origin main` advanced. Layers: quality (lint+typecheck+unit+build) · smoke-e2e · **network-e2e-live (accelerator, prover-ON)**.

### Phase 3 — Merge the release-please Release PR
1. Within ~1 min of the push to main, release-please opens `chore(main): release 0.26.0`. Find it: `gh pr list --state open --base main --search "release 0.26.0 in:title"`.
2. Review the `CHANGELOG.md` diff + confirm the computed version is **0.26.0** (not an unexpected bump). Its own quality CI runs (App-token-triggered).
3. Merge as **merge-commit**: `gh pr merge <n> --merge`.

**Validation gate** — Commands: `gh pr view <n> --json title,files`; inspect CHANGELOG diff. Pass criteria: title version == `0.26.0`; CHANGELOG reflects the 23-commit set; PR merged via merge-commit. Layers: quality (the Release PR's own CI).

### Phase 4 — Auto-unstick + publish chain
1. The Release-PR merge re-triggers `release.yml`. With `AUTO_UNSTICK=on`, `auto-unstick` tags `v0.26.0` + creates the Release + relabels, then the publish chain runs. Watch: `gh run watch <run-id>` (~15–25m).
2. Do **not** intervene unless a job reds. If `auto-unstick` reds with "refusing to re-point" → a `v0.26.0` tag exists at a wrong commit (fail-closed by design) — STOP, investigate, surface. Fallback if AUTO_UNSTICK ever misfires: the CLAUDE.md manual 45s unstick.

**Validation gate** — Commands: `gh release view v0.26.0 --json assets -q '[.assets[].name]'`; `gh run view <run-id> --json jobs`. Pass criteria: Release lists `nulo-chrome-0.26.0.zip`, `nulo-firefox-0.26.0.zip`, `SHASUMS256.txt`; `smoke-against-artifact`, `attach-assets`, `refresh-landing`, `deploy-faucet` all `success`. Layers: unit · build (chrome+firefox) · smoke-against-real-artifact.

### Phase 5 — Merge the sync-back PR (`main → dev`)
1. `sync-main-to-dev` auto-opens `chore: sync main → dev (…)`. If labeled `needs-manual-resolution`, resolve the conflict on the sync branch FIRST (usually `CHANGELOG.md` / `bun.lock`).
2. Merge as **merge-commit, NOT squash**: `gh pr merge <n> --merge` (preserves main's release commit in dev's ancestry — the prerelease anchor needs it; the bot's manifest commit is App-signed → satisfies `required_signatures`, no `--admin`).

**Validation gate** — Commands: `gh pr view <n> --json title,mergedAt`; `git fetch origin dev && git show origin/dev:.release-please-prerelease-manifest.json`. Pass criteria: sync PR merged via **merge-commit**; dev's prerelease manifest rebaselined to `0.26.0`; dev's `package.json` version == `0.26.0`. Layers: quality (sync PR's own CI).

### Phase 6 — Live verification + wrap-up
1. `verify-live` (advisory) + manual: open `nulo.sh` and `faucet.nulo.sh`; confirm the faucet `index.html` `nulo-build` meta == `/build.json` `buildId`. If stale → re-fire `gh workflow run refresh-landing.yml -f target=both`.
2. Update `implementations-plan/index.md` (mark shipped). Log any deviations in `lessons/phase-N.md`. Open the plan-docs PR to `dev`; suggest `agent-worktree done stable-release-0.26.0` after it merges.

**Validation gate** — Commands: `curl -sI https://nulo.sh` (200) + visual check both sites. Pass criteria: both sites serve the 0.26.0 build; index.md updated. Layers: live-site smoke (manual/advisory).

## Security & Adversarial Considerations

- **Threat model.** The release act itself introduces no new trust surface: it publishes already-reviewed, already-CI-gated dev commits. Attack surface = (a) a malicious/broken commit riding the promote, (b) supply-chain drift in the built artifact, (c) credential exposure in the pipeline.
- **(a) Malicious/broken commit** — mitigated: each of the 23 commits landed via a squash PR that passed `quality-status` + (where relevant) smoke/network e2e; the promote PR **re-runs all three required checks against main's base** before any merge. No gate is weakened to merge faster (hard rule).
- **(b) Supply chain** — `bun install --frozen-lockfile` in CI; `minimumReleaseAge=604800` gate on npm deps; `@aztec/*` exact-pinned; the accelerator server binary is **SHA-256-pinned** in `_network-e2e.yml` and native proving is enforced (`VITE_NULO_ACCELERATOR_REQUIRED=1`) — silent WASM fallback is a hard fail. `SHASUMS256.txt` is attached so downstream can verify the zips.
- **(c) Least privilege / secrets.** The pipeline authenticates as the `nulo-release-bot` GitHub App (scoped), not a PAT. CF deploy hooks (`CLOUDFLARE_PAGES_DEPLOY_HOOK`, `CLOUDFLARE_FAUCET_DEPLOY_HOOK`) are repo/environment secrets — **names only** appear in YAML, never values; this plan creates/rotates **no** secrets. `contents: read` default at workflow top-level; write is job-scoped.
- **No marketplace publish** (`publish_marketplaces` stays false; jobs are `exit 1` stubs) → a bad build cannot auto-push to users' browsers. This is the single biggest blast-radius reducer and is preserved by NOT opting into marketplace publish.
- **Irreversibility caveat.** A pushed tag + GitHub Release is awkward to cleanly retract. Mitigation: the promote PR's full required-CI green is the go/no-go; `auto-unstick` is fail-closed on a wrong-commit tag. If a bad release ships, the response is a follow-up `0.26.1`, not a history rewrite (force-push is blocked on both branches).
- **Adversarial "what if" checked:** concurrent merge to main during the promote window → main is `strict:true`, so a diverged base blocks the merge until updated (nothing else merges to main here, so N/A in practice); `auto-unstick` racing a manual unstick → idempotent re-tag + fail-closed guards prevent a double/​wrong tag.

## Assumptions

**Facts (verified):**
1. dev is 23 commits ahead of main since `v0.25.0` — `git rev-list --count origin/main..origin/dev` = 23 (recon.md).
2. main required checks = `quality-status`, `network-e2e-status`, `smoke-e2e-status`, `strict:true` — live `gh api .../branches/main/protection/required_status_checks` (recon.md).
3. `AUTO_UNSTICK_ENABLED=on` — `gh variable list` (set 2026-07-03).
4. `release.yml` deploys landing + faucet only; **no playground deploy job** exists — job list + grep (recon.md).
5. `publish-chrome-store` / `publish-firefox-amo` are opt-in (`inputs.publish_marketplaces=='true'`) `exit 1` stubs — `release.yml` L494–536.
6. Version anchors all read `0.25.0`; 0.x `bump-minor-pre-major` → next stable `0.26.0` — `package.json`, `.release-please-manifest.json`.
7. main ruleset = merge-commit only; sync-back must be merge-committed to preserve release-commit ancestry — CLAUDE.md § Release runbook.

**Inferences (unverified, may be wrong — labelled for audit):**
- The promote PR's `network-e2e-status` will pass. Each constituent PR passed individually, but the combined dev-vs-main run is fresh and network e2e can flake. → Mitigation: re-run the specific flaky check; never weaken the gate.
- `auto-unstick` fires cleanly (proven on v0.24.0 + v0.25.0). → Mitigation: fail-closed guards + documented manual-unstick fallback.
- The sync-back merges without conflict (dev diverged from main only via the release). → Mitigation: `needs-manual-resolution` path resolves on the sync branch first.

**Asks (decisions needing the user):** NONE outstanding — playground premise, drive-depth, and version were all resolved in Phase 0. (Light floor: ≥5 Facts ✓, no silent Asks ✓.)

## Decision ledger (light — key calls)

- **Playground deploy → dropped** (false premise; it's a test harness). User confirmed landing + faucet.
- **Drive depth → end-to-end** (user chose; I merge to main post-approval). Alternative "open promote PR then stop" rejected by user.
- **Version → 0.26.0 auto** (no `Release-As` override). Alternative forced-version rejected by user.
- **Store publish → out** (stub + opt-in; forced by construction).

## Seeds

> For resuming/driving autonomously if this session drops mid-release. The work is dominated by long CI waits (promote network-e2e 25–45m, publish chain 15–25m), so a polling `/loop` fits best; `/goal` is the transcript-observable alternative. **Use exactly one per session — they don't compose.** Run inside the `stable-release-0.26.0` worktree (`agent-worktree resume stable-release-0.26.0`). Start in the intended permission mode so a loop doesn't stall on a prompt.

**Recommended — `/loop` (polling long CI is exactly its use case):**
```
/loop 10m Drive implementations-plan/stable-release-0.26.0/plan.md to a shipped v0.26.0. Never idle. Each firing: (1) read plan.md + lessons/ (authoritative state), `git fetch`, `gh pr list --base main`, `gh run list --limit 3`. (2) Execute the next unfinished phase's steps. Waiting on CI is fine — `gh pr checks <n> --watch` / `gh run watch <id>` up to ~45m for network-e2e; a red check = flake (re-run the specific check) or real breakage (STOP + surface), NEVER weaken a gate. (3) Merges to main/dev are the phase actions: promote PR + Release PR + sync-back all as MERGE-commits (never squash). (4) Phase green = its plan.md validation gate passes → mark ✓, log lessons/phase-N.md, print LESSONS_FILE=…, advance. (5) HARD STOPS: never publish to marketplaces, never force-push, never weaken a required check; if blocked, surface and hold. All phases ✓ + `gh release view v0.26.0` shows 3 assets + both sites serve 0.26.0 → write wrap-up and stop.
```

**Alternative — `/goal` (completion is transcript-observable):**
```
/goal All phases ✓ in implementations-plan/stable-release-0.26.0/plan.md, each backed by its validation gate reported passing in the transcript; the promote PR, the `chore(main): release 0.26.0` Release PR, and the `chore: sync main → dev` PR are all merged as MERGE-commits (verified via `gh pr view --json mergedAt`); `gh release view v0.26.0 --json assets` lists nulo-chrome-0.26.0.zip + nulo-firefox-0.26.0.zip + SHASUMS256.txt; `refresh-landing` + `deploy-faucet` jobs succeeded; nulo.sh + faucet.nulo.sh serve the 0.26.0 build. No required check was weakened; no marketplace publish; no force-push.
```
