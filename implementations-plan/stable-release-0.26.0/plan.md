# Plan — stable-release-0.26.0

**Blueprint tier:** `light` · **eli5_mode:** Artifact (primary) · **Worktree:** `stable-release-0.26.0`
**ELI5 Artifact:** https://claude.ai/code/artifact/508c40a6-2e5e-4a52-b943-90f39990edd2 (source: `implementations-plan/stable-release-0.26.0/eli5.html` — redeploy that path to update in place)

## Summary

Cut stable **v0.26.0** by promoting the dev-only commits (**23 total / 21 first-parent merged PRs** since `v0.25.0`) to `main`, letting the existing `release.yml` pipeline build + attach the Chrome/Firefox zips to a GitHub Release, and redeploy the two real web targets — **landing (`nulo.sh`)** and **faucet (`faucet.nulo.sh`)** — via their Cloudflare Pages hooks. This is **runbook execution, not code work**: no source files change; the only repo mutations are bot-authored (release-please version bump + CHANGELOG, and the sync-back rebaseline). "Playground deployment" from the original ask was a false premise — the playground is a local e2e test harness with no deploy target (see `recon.md`); it is out of scope with nothing to do.

**Scope confirmed with user:** targets = landing + faucet (not playground); drive = **end-to-end** (I open+merge the promote PR, merge the release-please PR, merge the sync-back PR — i.e. I merge to `main`/`dev` on your behalf, post-approval, at a pinned dev SHA); version = **0.26.0 auto**. Store publishing is out (stub + opt-in).

> **⏱ Timing reality (corrected after codex audit):** this is NOT a quick cut. **Three** separate PRs each incur the **full required CI including live network-e2e (~25–45 min each)** — the promote PR *and* the release-please Release PR (both PRs to `main`, which always runs network-e2e) *and* the sync-back PR (its `apps/extension/package.json` bump matches the `extension-network` path filter). Plus the publish chain (~15–25 min). **Realistic wall-clock ≈ 1.5–2.5 h**, dominated by CI waits — hence the `/loop` seed. No gate is skipped to go faster (hard rule).

## Execution status — ✓ SHIPPED (v0.26.0)

- [✓] **Phase 1** — SHA frozen `RELEASE_SHA=4e5435b`; JIT pre-flight green.
- [✓] **Phase 2** — promote PR #320 merged `e61849c` (merge-commit, 2 parents); network-e2e shard-3 flake re-run→passed; release-please opened #321.
- [✓] **Phase 3** — Release PR #321 merged `bffaad2` (merge-commit, 2 parents) = `TAG_SHA`; CHANGELOG verified; first CI batch cancelled/superseded (not breakage), live batch green.
- [✓] **Phase 4** — release.yml run 30062111294 success: auto-unstick tagged v0.26.0 (→TAG_SHA), 3 assets, isPrerelease=false, real git-cliff body, landing+faucet deployed, verify-live green, marketplace publish skipped.
- [✓] **Phase 5** — sync-back PR #322 merged `1da3377` (merge-commit, 2 parents); dev now 0.26.0, prerelease manifest `{".":"0.26.0"}`.
- [✓] **Phase 6** — live verified: nulo.sh serves v0.26.0; faucet `buildId=0.1.0+bffaad26` (==TAG_SHA); verify-live job green.

**All `/goal` conditions met:** 3 merges all merge-commits w/ 2 parents (`e61849c`/`bffaad2`/`1da3377`); release has 3 assets + isPrerelease=false + real body; tag→TAG_SHA; sites fresh by SHA; no gate weakened (shard-3 flake re-run, never neutralized); no marketplace publish; no force-push; promote merged only at pinned `RELEASE_SHA` (atomic `--match-head-commit`).

## Why `light`

Phase 0.5 rubric — HIGH count = **0** for the *release-cutting task* (novelty LOW: 6th+ run of a proven runbook, v0.21→v0.25; migration cost LOW: pre-production; external coupling MODERATE but automated; blast/irreversibility MODERATE-bounded: no marketplace publish so no auto-update reaches users, tags are fixable).

**Security-sensitivity nuance (codex).** The *shipped content* is NOT low-stakes — the 23 commits include bridge Permit2 / recipient-committed private claims (#260), account-identity freezing (#303), backup/storage behavior, and production faucet changes (~48k additions). But each was threat-modeled + gated at its own feature PR; a release cut does not re-audit them. `light` scopes the **release mechanics**, not a content re-audit. Whether to run a `/harden security` pass or a live testnet bridge/faucet canary *before* promoting is a deliberate user decision surfaced at the gate (see Assumptions → Asks). Tier stays `light` for the mechanics.

## Architecture & Implementation (compact)

**Shape.** The "architecture" is the release-pipeline topology, reused verbatim. I drive only the three human decision points GitHub reserves for a person (the three merges); everything between is automated by `release.yml`.

Critical flow (**corrected DAG** — `sync-main-to-dev` runs in parallel with deploy/verify off `attach-assets`, NOT after `verify-live`):
```
[me] open promote PR (dev→main) at pinned SHA
      └─ REQUIRED CI: quality-status + smoke-e2e-status + network-e2e-status  (~25–45m; network always runs on main-PRs)
[me] merge promote PR (merge-commit) ──► push:main
      └─ release.yml: release-please opens `chore(main): release 0.26.0`
[me] merge Release PR (merge-commit) ──► push:main
      │    (the Release PR ALSO runs all 3 required checks incl full network-e2e, ~25–45m, before this merge)
      └─ release.yml (AUTO_UNSTICK=on) on push:main:
           auto-unstick → tag v0.26.0 + create Release + relabel PR
           resolve → lint/typecheck → unit-tests → build-chrome + build-firefox
                   → smoke-against-artifact → attach-assets (zips + SHASUMS + cliff notes)
                        ├─ (refresh-landing ∥ deploy-faucet) → verify-live (advisory; waits for BOTH deploys)
                        └─ sync-main-to-dev → opens `chore: sync main → dev`
                             (parallel to the whole deploy/verify branch; needs:[resolve,attach-assets]; push-only)
[me] merge sync-back PR (merge-commit, NOT squash — after its OWN required CI incl network-e2e, ~25–45m)
```

**File-level change map.** No hand-edited source. Bot-authored on the pipeline: `package.json` + `apps/extension/package.json` version → `0.26.0`, `CHANGELOG.md`, `.release-please-manifest.json` → `0.26.0` (Release PR); `.release-please-prerelease-manifest.json` → `0.26.0` (sync-back rebaseline). This plan dir is the only human-authored artifact, landing via its own docs PR to `dev`, decoupled from the release mechanics.

**Reused as-is (zero edits):** `release.yml` (all jobs), `auto-unstick` + `scripts/release/auto-unstick*.ts`, `refresh-landing`, `deploy-faucet`, `sync-main-to-dev` + `scripts/release/open-sync-pr*.ts`, `verify-live` + `scripts/release/verify-live-run.ts`. See `recon.md`.

**Key "interface":** the required-check contract — `quality-status`, `network-e2e-status`, `smoke-e2e-status` (main `strict:true`). All three gate every PR to main (and the sync PR to dev via path match). Nothing merges until they're green.

**Simpler alternative considered (rejected):** *"merge the promote PR and let full automation ride, no plan."* Rejected — three irreversible-ish merges warrant an explicit gate + a recorded, **frozen** pre-flight SHA, and the user asked for a blueprint. The plan adds ~0 mechanical steps over the runbook; its value is the current-state instantiation (exact version, deploy targets, the playground correction, the corrected timing/DAG) + the approval checkpoint before I touch `main`.

## Phases

> Gates use the project's REAL tooling — the GitHub Actions required checks + `gh` release inspection. No local build/test is on the critical path (CI owns gating). **JIT-recheck discipline (codex):** re-verify live settings (AUTO_UNSTICK, branch protection, ruleset) at Phase 1 — the recon snapshot is not authoritative for live config.

### Phase 1 — Pre-flight + freeze the release SHA (no writes to main)
1. **Pin the approved dev SHA:** `git fetch origin dev && git rev-parse origin/dev` → record as `RELEASE_SHA`. The promote is authorized for **this exact SHA**; the approval is bound to it. (Distinct from `TAG_SHA` — see Phase 4 — which is the *Release-PR merge commit on main* that the tag + the built artifacts + the faucet `buildId` derive from. `RELEASE_SHA` ≠ `TAG_SHA`; a correct build will NOT match `RELEASE_SHA`.)
2. Re-confirm live invariants JIT: main at `v0.25.0` (`git ls-remote --tags origin | grep v0.25.0`); **zero** open PRs into `main` (`gh pr list --state open --base main`); `AUTO_UNSTICK_ENABLED=on` (`gh variable list`); required checks on main still = the three (`gh api .../branches/main/protection/required_status_checks`).
3. Advisory sanity (NOT the authoritative gate — the promote PR's own CI is): `gh run list --branch dev --limit 5`. The real proof of releasability is Phase 2's required checks, not historical run-list.
4. Draft the promote PR title (≤93 chars) + body (release-note summary of the 21 merged PRs).

**Validation gate** — Commands: the `git rev-parse` + the four JIT reads. Pass criteria: `RELEASE_SHA` recorded; main at v0.25.0; **zero** open PRs into main (or, if #49-style PRs exist, confirmed unrelated + not merging); AUTO_UNSTICK=on; 3 required checks present. Layers: state verification (no build).

### Phase 2 — Promote `dev → main` (at pinned SHA)
1. `gh pr create --base main --head dev --title "release: promote dev → main (…)" --body-file <summary>`.
2. Watch required checks: `gh pr checks <n> --watch` — **network-e2e ~25–45m** (accelerator, prover-ON). Flake → re-run the specific check; real breakage → **STOP + surface** (never weaken a gate).
3. **Head-not-moved guard (codex — release scope is mutable):** immediately before merge, `git fetch origin dev && [ "$(git rev-parse origin/dev)" = "$RELEASE_SHA" ]`. If dev advanced, STOP — the approved content changed; re-review the new commits before proceeding (or the heavier option: cut a `release-0.26.0` branch at `RELEASE_SHA` and PR *that* → main for an immutable head).
4. Merge as **merge-commit, atomically SHA-matched (codex — closes the TOCTOU window)**: `gh pr merge <n> --merge --match-head-commit "$RELEASE_SHA"` (GitHub refuses the merge server-side if the head no longer equals `RELEASE_SHA`, so the fetch/equality check in 2.3 is a pre-check, not the guarantee; main ruleset = merge-only; GitHub web-flow-signs it).

**Validation gate** — Commands: `gh pr checks <n>`; the `--match-head-commit` merge (its own success IS the atomic guarantee); `gh pr view <n> --json state,mergeCommit`; verify 2 parents: `git rev-list --parents -n1 <mergeCommit> | wc -w` == 3. Pass criteria: all 3 required checks green; merge accepted only while head == `RELEASE_SHA`; PR merged as a true merge-commit (2 parents); `main` advanced. Layers: quality · smoke-e2e · **network-e2e-live (prover-ON)**.

### Phase 3 — Merge the release-please Release PR (ALSO full CI)
1. Within ~1 min of the push to main, release-please opens `chore(main): release 0.26.0`. Find it: `gh pr list --state open --base main`.
2. Review the `CHANGELOG.md` diff + confirm computed version == **0.26.0** (not an unexpected bump).
3. **Wait for its OWN required CI (codex):** this is a PR to main → it runs `quality-status` + `smoke-e2e-status` + **`network-e2e-status` (~25–45m)**, NOT quality alone. All three must be green.
4. Merge as **merge-commit**: `gh pr merge <n> --merge`.

**Validation gate** — Commands: `gh pr view <n> --json title,files`; CHANGELOG diff; `gh pr checks <n>`; 2-parent check on the merge. Pass criteria: title version == `0.26.0`; CHANGELOG reflects the release set; **all 3 required checks green**; merged as merge-commit. Layers: quality · smoke-e2e · network-e2e-live.

### Phase 4 — Auto-unstick + publish chain (+ partial-failure handling)
1. The Release-PR merge re-triggers `release.yml`. With `AUTO_UNSTICK=on`, `auto-unstick` tags `v0.26.0` + creates the Release + relabels, then resolve → build → smoke-against-artifact → attach-assets → landing/faucet deploy. Watch: `gh run watch <run-id>` (~15–25m). (network-e2e is OFF on this auto push:main publish — `smoke-against-artifact` is the gate.)
2. **Partial-auto-unstick guard (codex):** the sequence is tag → relabel → create-Release. If it half-completes, a rerun can no-op on the missing `autorelease: pending` label OR leave `unstuck=false` so `resolve` skips → **a tag/Release can exist with NO assets ("green-looking stranded release")**. Detection = the Phase-4 gate below. **Recovery is gated on tag integrity (codex): FIRST assert `TAG_SHA` (`git rev-list -n1 v0.26.0`) == the Phase-3 Release-PR merge commit. Only if it matches** force the publish chain: `gh workflow run release.yml --ref main -f tag=v0.26.0 -f dry_run=false`. **If the tag sits at any other commit → STOP; do NOT publish artifacts from a wrong/hostile tag.** If `auto-unstick` itself reds with "refusing to re-point" → same condition (fail-closed) — STOP + investigate.

**Validation gate (hardened — codex)** — Commands: `gh release view v0.26.0 --json tagName,isPrerelease,body,assets`; cross-check tag SHA == Release-PR merge SHA (`git rev-list -n1 v0.26.0` == Phase-3 mergeCommit); `gh run view <run-id> --json jobs`. Pass criteria: Release exists with **all three assets** (`nulo-chrome-0.26.0.zip`, `nulo-firefox-0.26.0.zip`, `SHASUMS256.txt`); `isPrerelease=false`; release body is the git-cliff notes, **not** the "Filled by publish run." placeholder; **tag SHA == Release-PR merge SHA**; `smoke-against-artifact` + `attach-assets` + `refresh-landing` succeeded; `deploy-faucet` succeeded **(note: a green deploy-faucet may be an intentional no-op if `CLOUDFLARE_FAUCET_DEPLOY_HOOK` is unset — the dashboard Git-integration deploys it instead; confirm liveness in Phase 6, don't infer it from a green job)**. Layers: unit · build (chrome+firefox) · smoke-against-real-artifact.

### Phase 5 — Merge the sync-back PR (`main → dev`, ALSO full CI)
1. `sync-main-to-dev` auto-opens `chore: sync main → dev (…)` (push-only; advisory). If labeled `needs-manual-resolution`, resolve the conflict on the sync branch FIRST (usually `CHANGELOG.md` / `bun.lock`).
2. **Wait for its OWN required CI (codex):** the sync diff carries the `apps/extension/package.json` 0.25.0→0.26.0 bump → matches the `extension-network` + `smoke-surface` path filters on dev → **network-e2e + smoke run (~25–45m)**, plus quality. All three green before merge.
3. Merge as **merge-commit, NOT squash**: `gh pr merge <n> --merge` (preserves main's release commit in dev's ancestry — the prerelease anchor needs it; the bot's manifest commit is App-signed → `required_signatures` satisfied, no `--admin`).

**Validation gate** — Commands: `gh pr checks <n>`; `gh pr view <n> --json mergeCommit`; 2-parent check (`git rev-list --parents -n1 <mergeCommit> | wc -w` == 3); `git fetch origin dev && git show origin/dev:.release-please-prerelease-manifest.json` + `origin/dev:package.json`. Pass criteria: all 3 required checks green; merged as a true **merge-commit (2 parents)**, not squash; dev's prerelease manifest rebaselined to `0.26.0`; dev `package.json` version == `0.26.0`. Layers: quality · smoke-e2e · network-e2e-live.

### Phase 6 — Live verification + wrap-up (freshness by SHA, not version)
1. `verify-live` (advisory, `scripts/release/verify-live-run.ts`) does the automated check. **URL reality (codex, verified at `verify-live-run.ts:91-92`):** it checks `LANDING_URL ?? https://nulo.sh` and `FAUCET_URL ?? https://testnet.tools.nulo.sh` — the faucet build check defaults to **`testnet.tools.nulo.sh`** (which serves `build.json`), NOT `faucet.nulo.sh` (a login page that does not serve `build.json`; line-22 comment). **Faucet freshness = build fingerprint, not version (codex):** the faucet app is independently versioned `0.1.0`, so "serves 0.26.0" is meaningless — the check is `build.json` `buildId` whose SHA suffix == **`git rev-list -n1 v0.26.0` (i.e. `TAG_SHA` = the Release-PR merge commit), first 8 chars** — NOT `RELEASE_SHA`. Manual: open `nulo.sh` (v0.26.0 build) + `faucet.nulo.sh` (visual only — it's the login page, so don't expect `build.json` there). **If the faucet build is stale AND `CLOUDFLARE_FAUCET_DEPLOY_HOOK` is unset, `refresh-landing.yml -f target=both` SKIPS the faucet (codex)** — in that case use a real Cloudflare dashboard/API redeploy, not the break-glass workflow. Landing-only stale → `gh workflow run refresh-landing.yml -f target=landing`.
2. Update `implementations-plan/index.md` (mark shipped). Log deviations in `lessons/phase-N.md`. Open the plan-docs PR to `dev`; suggest `agent-worktree done stable-release-0.26.0` after it merges.

**Validation gate** — Commands: `curl -sI https://nulo.sh` (200); `curl -s https://testnet.tools.nulo.sh/build.json` → `buildId` SHA-suffix == `git rev-list -n1 v0.26.0 | cut -c1-8`; visual on both sites. Pass criteria: landing serves the 0.26.0 build; the faucet-build `buildId` matches `TAG_SHA` (not a stale build); index.md updated. Layers: live-site smoke (manual/advisory).

## Security & Adversarial Considerations

- **Threat model.** The release *act* publishes already-reviewed, already-CI-gated dev commits; it introduces little NEW trust surface. Attack surface: (a) content riding the promote, (b) a mutable release scope, (c) supply-chain of the built artifact + the Actions runner, (d) credential exposure, (e) irreversibility.
- **(a) Content** — each of the 21 merged PRs passed `quality-status` + (where relevant) smoke/network e2e; the promote PR **re-runs all three against main's base**. Bridge Permit2 (#260) / account-freeze (#303) / backup logic shipped here were threat-modeled at their PRs; a `/harden security` pass or live testnet canary before promoting is an available (user-decided) extra layer — see Asks.
- **(b) Mutable release scope (codex, adopted).** The promote PR head tracks live `dev`; a merge during its CI window silently changes approved content. Mitigation: pin `RELEASE_SHA` at Phase 1, guard `origin/dev == RELEASE_SHA` immediately before merge (Phase 2.3), abort + re-review if it moved. Only #49 (unrelated) is open, so churn risk is low but not zero.
- **(c) Supply chain (claim softened per codex).** `bun install --frozen-lockfile`; `minimumReleaseAge=604800` npm gate; `@aztec/*` exact-pinned; accelerator binary **SHA-256-pinned** in `_network-e2e.yml`, native proving enforced (`VITE_NULO_ACCELERATOR_REQUIRED=1`), silent WASM fallback = hard fail. **Honest limits:** GitHub Actions here use **mutable major-version tags** (`release-please-action@v4`, `git-cliff-action@v4`, etc.), not commit SHAs; `SHASUMS256.txt` is generated by the same runner that built the zips, so it proves the two zips are **self-consistent from one build, not independent provenance**. Pinning actions to SHAs + build provenance/attestation is a real hardening item, **explicitly out of scope for this cut** (accepted risk, flagged for a future pass).
- **(d) Least privilege / secrets.** Pipeline authenticates as the scoped `nulo-release-bot` GitHub App, not a PAT. CF deploy hooks are repo/environment secrets — **names only** in YAML, never values; this plan creates/rotates **no** secrets. `contents: read` default at top level; write is job-scoped (`sync-main-to-dev` gets `contents: write` + `pull-requests: write`, minimal for its task).
- **(e) Irreversibility.** A pushed tag + Release is awkward to retract. Mitigations: promote-PR required-CU green is the go/no-go; `auto-unstick` is fail-closed on a wrong-commit tag; the Phase-4 gate rejects a stranded assetless release. A bad ship → follow-up `0.26.1`, never a history rewrite (force-push blocked on both branches). No marketplace publish → a bad zip cannot auto-reach users (single biggest blast-radius reducer; preserved by keeping `publish_marketplaces=false`).

## Assumptions

**Facts (verified):**
1. dev is ahead of main by **23 total / 21 first-parent** commits since `v0.25.0` — `git rev-list --count [--first-parent] origin/main..origin/dev` = 23 / 21 (corrected per codex; recon.md).
2. main required checks = `quality-status`, `network-e2e-status`, `smoke-e2e-status`, `strict:true`; PRs to main run **all three always** — live `gh api` + CLAUDE.md § Branching. (Live setting — JIT-recheck at Phase 1.)
3. `AUTO_UNSTICK_ENABLED=on` — `gh variable list` (set 2026-07-03). (Live setting — JIT-recheck.)
4. `release.yml` deploys landing + faucet only; **no playground deploy job** — job list + grep (recon.md).
5. `publish-chrome-store` / `publish-firefox-amo` are opt-in (`inputs.publish_marketplaces=='true'`) `exit 1` stubs — `release.yml` L494–536.
6. Version anchors read `0.25.0`; 0.x `bump-minor-pre-major` → next stable `0.26.0` — `package.json`, `.release-please-manifest.json`.
7. `sync-main-to-dev` `needs:[resolve,attach-assets]`, push-only, advisory, runs **parallel** to deploy/verify (not after verify-live) — `release.yml` L442+ (corrected DAG per codex).
8. `apps/faucet/package.json` version = `0.1.0`, independent of the extension version. `verify-live-run.ts:91-92` defaults `LANDING_URL=https://nulo.sh` and **`FAUCET_URL=https://testnet.tools.nulo.sh`** (serves `build.json`); `faucet.nulo.sh` is a login page and does NOT serve `build.json` (line-22 comment). Freshness = `build.json` `buildId` SHA-suffix == `TAG_SHA` (the Release-PR merge commit), first 8 chars — **not** "serves 0.26.0", **not** `RELEASE_SHA` (both corrections per codex, verified in the file).

**Inferences (unverified — labelled for audit):**
- The promote / Release / sync PRs' `network-e2e` will pass. Each constituent PR passed individually, but each of these three is a fresh combined run and network e2e can flake. → Mitigation: re-run the specific flaky check; never weaken the gate.
- `auto-unstick` fires cleanly (proven v0.24.0 + v0.25.0). → Mitigation: fail-closed wrong-tag guard + the Phase-4 partial-failure detection + `workflow_dispatch` publish fallback (codex hardened this).
- The sync-back merges without conflict. → Not assumed safe; handled by the `needs-manual-resolution` path (Phase 5.1).

**Asks (surfaced at the approval gate — not silently assumed; per codex):**
- **A1 — approval binds all three merges at the pinned SHA?** You chose "drive end-to-end", which I read as: one approval authorizes the promote merge, the Release-PR merge, and the sync-back merge, all at `RELEASE_SHA`. Confirm — or tell me to pause for a checkpoint before any specific merge.
- **A2 — pre-promote content assurance beyond CI?** Given the bridge/account-freeze/backup content, do you want a `/harden security` pass and/or a **live testnet bridge+faucet canary** run *before* I promote — or is the per-PR gating + required CI sufficient for this cut? (Default if you don't say: rely on existing per-PR gating + required CI; no extra canary.)

*(Light floor: ≥5 Facts ✓ (8); no **silent** Asks ✓ — the two Asks are explicit at the gate.)*

## Audit — codex (light tier, single pass)

Session `019f91c5-9a33-7e43-abd4-12023f79382e` · transcript `audit-codex.md`. Codex ran with an invalid `gh` credential, so every live-settings claim was re-verified by me against the workflow files before adoption.

**Initial verdict:** `reject (with blocking findings: freeze the release SHA; require all PR + live/provenance gates; repair/handle partial auto-unstick states)`.

| Finding | Verdict | Disposition |
|---|---|---|
| Release scope mutable — pin dev SHA | valid | **Adopted** — `RELEASE_SHA` pin (P1) + head-not-moved guard (P2.3). |
| Release PR + sync PR also run full network-e2e (not quality-only) | valid, verified | **Adopted** — P3 + P5 gates rewritten; timing note added. |
| sync-back DAG position wrong (parallel off attach-assets) | valid, verified | **Adopted** — DAG + Fact #7 corrected. |
| Faucet freshness ≠ "serves 0.26.0" (faucet is 0.1.0; check SHA/buildId) | valid, verified | **Adopted** — P6 + Fact #8. |
| Partial auto-unstick → stranded assetless release | valid | **Adopted** — P4 detection + `workflow_dispatch` recovery + tag/asset/placeholder gates. |
| First-parent count 21 not 23 | valid, verified | **Adopted** — summary + recon corrected. |
| "Security sensitivity LOW" untenable for shipped content | valid | **Adopted** — reframed (mechanics vs content); `/harden`/canary surfaced as Ask A2. |
| Supply-chain overstated (mutable action tags; SHASUMS=consistency) | valid | **Adopted** — Security §(c) softened + honest limits stated. |
| Merge-method not proven by `mergedAt` — check 2 parents | valid | **Adopted** — 2-parent check in P2/P3/P5 gates. |
| `verify-live` faucet check "defaults to testnet.tools.nulo.sh" | **valid, verified (I was wrong to reject in R1)** | **Adopted** — confirmed `verify-live-run.ts:92` `FAUCET_URL ?? "https://testnet.tools.nulo.sh"`; `faucet.nulo.sh` is a login page. Fact #8 + P6 corrected. |
| Clean-path needs no manual unstick; network-e2e on promote-PR not push:main; 3-merge order+method correct; recon reuse correct | confirmed | No change — matches plan. |

**Round-2 (resume) verdict:** `conditional approve` (session resume `019f91c5…`). Four conditions, **all folded in**:
1. Faucet pointer is `testnet.tools.nulo.sh` (automated) vs `faucet.nulo.sh` (login page, manual) → Fact #8 + P6.1 corrected.
2. `RELEASE_SHA` (pinned dev) ≠ `TAG_SHA` (Release-PR merge / build / `buildId`) named separately; faucet freshness checks `buildId` SHA-suffix == `TAG_SHA` first-8 → P1.1 note + P4 + P6.
3. Atomic merge — `gh pr merge --match-head-commit "$RELEASE_SHA"` (flag verified to exist) → P2.4, closes the TOCTOU window.
4. Recovery hardened — assetless-release republish gated on `TAG_SHA == Phase-3 merge SHA`; stale-faucet+unset-hook → real CF redeploy not the skipping break-glass → P4.2 + P6.1.

Non-blocking DAG wording (refresh-landing ∥ deploy-faucet → verify-live; sync parallel to that branch) → A&I DAG corrected. **Conditions closed → gate-eligible.**

## Decision ledger (light)

- **Playground deploy → dropped** (false premise; test harness). Confirmed landing + faucet.
- **Drive depth → end-to-end** at a pinned SHA (user chose). Alternative "open promote PR then stop" rejected by user.
- **Version → 0.26.0 auto** (no `Release-As`). Forced-version rejected by user.
- **Store publish → out** (stub + opt-in).
- **Release-SHA freeze → adopted** (codex) over "let it ride on live dev".
- **Supply-chain SHA-pinning / provenance → deferred** (accepted risk, out of scope for this cut).

## Seeds

> For resuming/driving autonomously if this session drops mid-release. Work is dominated by long CI waits (three ~25–45m network-e2e cycles + a ~15–25m publish chain), so a polling `/loop` fits best; `/goal` is the transcript-observable alternative. **Use exactly one per session — they don't compose.** Run inside the `stable-release-0.26.0` worktree (`agent-worktree resume stable-release-0.26.0`). Start in the intended permission mode so a loop doesn't stall on a prompt.

**Recommended — `/loop` (polling long CI is exactly its use case):**
```
/loop 10m Drive implementations-plan/stable-release-0.26.0/plan.md to a shipped v0.26.0. Never idle. Each firing: (1) read plan.md + lessons/ (authoritative state), `git fetch`, `gh pr list --base main`, `gh run list --limit 3`. (2) Execute the next unfinished phase. Waiting on CI is fine — `gh pr checks <n> --watch` / `gh run watch <id>` up to ~45m for network-e2e; red check = flake (re-run the specific check) or real breakage (STOP + surface), NEVER weaken a gate. (3) The three merges (promote, Release PR, sync-back) are the phase actions: ALL merge-commits (never squash); before the promote merge, verify `origin/dev == RELEASE_SHA` (abort+resurface if it moved); after each, verify the merge commit has 2 parents. (4) Each of the three PRs runs full required CI incl network-e2e — wait for all 3 checks green each time. (5) Phase green = its plan.md validation gate passes → mark ✓, log lessons/phase-N.md, print LESSONS_FILE=…, advance. (6) HARD STOPS: never publish to marketplaces, never force-push, never weaken a required check; if blocked, surface and hold. Done = all phases ✓ + `gh release view v0.26.0` shows 3 assets + isPrerelease=false + non-placeholder body + landing/faucet fresh by SHA → write wrap-up and stop.
```

**Alternative — `/goal` (completion is transcript-observable):**
```
/goal All phases ✓ in implementations-plan/stable-release-0.26.0/plan.md, each backed by its validation gate reported passing in the transcript; the promote PR, the `chore(main): release 0.26.0` Release PR, and the `chore: sync main → dev` PR all merged as MERGE-commits verified to have 2 parents; `gh release view v0.26.0 --json assets,isPrerelease,body` shows nulo-chrome-0.26.0.zip + nulo-firefox-0.26.0.zip + SHASUMS256.txt, isPrerelease=false, and a non-placeholder git-cliff body; tag SHA == Release-PR merge SHA; refresh-landing + deploy-faucet jobs succeeded and nulo.sh + faucet.nulo.sh are fresh by release SHA. No required check was weakened; no marketplace publish; no force-push; the promote merged only while origin/dev == the pinned RELEASE_SHA.
```
