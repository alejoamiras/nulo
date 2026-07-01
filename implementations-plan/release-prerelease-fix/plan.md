# Fix the release-please prerelease (rc) flow

**Status:** Phase 1 DONE (2026-06-30) — full lifecycle validated in the throwaway; **mechanism re-decision pending** (Phase 1 proved the originally-chosen "bypass-actor-via-PR-merge" is INFEASIBLE — see below). Versioning fix (rc.0 + ancestry) confirmed end-to-end (rc.0→rc.1→stable). codex conditional-approve, all 5 findings adopted.

**⚠ Phase 1 overturned the original mechanism choice.** A squash-only `dev` ruleset HARD-BLOCKS a PR merge-commit for EVERYONE — not bypassable by `--admin` NOR by a bypass actor (triply confirmed in `lessons/phase-2.md`). **Re-decided 2026-06-30: mechanism = (2a) allow `["squash","merge"]` on dev + sync via PR-merge.** The existing PR-based sync job merges (not squashes); humans keep squash by convention + the merge-button default (not ruleset-enforced). Rejected: (2-direct) bot direct-push (preserves strict enforcement but more rework, no PR conflict UI). Either way dev gains periodic sync-merge commits — inherent to the fix, so the enforcement purity 2a sacrifices is largely already gone.
**Tier:** `light` (bounded: a 1-line config change + a branch-ancestry/sync correction). ONE decision exceeds "config-only" — the `dev` merge-policy needed to land the history-preserving sync (see Asks); flagged at the gate.

## The problem (diagnosis), with hard proofs

Cutting a prerelease (rc) from `dev` produces the wrong result: **version `0.23.0` (no bump, no `-rc`)** + a CHANGELOG regenerated from **genesis** (186 commits). PR #189 is the broken cut (open, must not merge).

**Root cause (codex-diagnosed, then verified + dry-run-reproduced this session): broken branch ancestry, not a config knob.**
- `v0.23.0` points at commit `50b4145a` ("chore(main): release 0.23.0", #145), which lives **only on `main`** — `git merge-base --is-ancestor 50b4145a origin/dev` → **NOT an ancestor**.
- Cause: the `#146` "re-baseline dev to 0.23.0" main→dev sync was **squashed** (dev's ruleset forces squash), so dev got the 0.23.0 *content* but not main's release commit in its history.
- So release-please finds the `v0.23.0` tag but can't locate its SHA in `dev` → `commitsAfterSha` returns everything (genesis) → "⚠ No latest release pull request found" → 186-commit changelog; and an old `Release-As: 0.23.0` footer (`e4618d08`, #142) then pins the version to `0.23.0`.
- **`versioning: "prerelease"` is CORRECT** (codex + dry-run): in release-please 17.3.0 it cold-starts from a stable base (feat → `0.24.0-<type>`); the failure was ancestry, not the strategy. Config variants (drop `versioning`, add `last-release-sha`) were dry-run-tested and did NOT fix it — confirming it's ancestry, not a knob.

**PROOF (dry-run, release-please@17.3.0, `tmp/rp-test-c`):** with `50b4145a` made an ancestor (history-preserving `-s ours` merge of `main`, dev content unchanged) + `prerelease-type: "rc.0"`:
```
Considering: 43 commits        # (not 186 — bounded to since v0.23.0)
title: chore(...): release 0.24.0-rc.0
## [0.24.0-rc.0](compare/v0.23.0...v0.24.0-rc.0)
```
Clean version + changelog; the old `Release-As: 0.23.0` (before the anchor) no longer interferes.

## The fix (correct, no monkey-patch)

1. **`prerelease-type: "rc" → "rc.0"`** in `.github/release-please-prerelease-config.json` (so the series is `0.24.0-rc.0`, `-rc.1`, … with a counter — `"rc"` alone gives a counter-less `0.24.0-rc`).
2. **`dev` must contain `main`'s release commit in its ancestry** — land a **history-preserving** main→dev merge (NOT a squash) so `50b4145a` (and future release commits) are ancestors of `dev`. **This FUNDAMENTALLY requires a non-squash merge onto `dev`**: a squash (or cherry-pick) creates a NEW commit with no parent-link to `50b4145a`, so the SHA never becomes reachable — the version content lands but the anchor doesn't. The one-time immediate fix establishes `50b4145a` in dev's history.
3. **Forward process (the recurring root cause)**: `release.yml:457` documents that the `sync-main-to-dev` PR is **squash-merged** ("satisfied by the GitHub-signed UI squash-merge") — that squash is exactly what drops main's release commit from dev's ancestry on EVERY release. Fix: the sync PR must land as a **merge commit**. Since dev's ruleset is squash-only, this needs a deliberate mechanism (the one real decision — see Asks).
4. **Signed-commit constraint (codex F1 — load-bearing):** dev requires **signed commits**. A squash hid this — GitHub web-flow-signs the squash commit. A **merge** brings the sync branch's own commit onto dev; today `open-sync-pr-run.ts` creates it via a plain Actions `git commit` (UNSIGNED) → a merge would be **rejected** by the signed-commit rule. So the merge-commit sync MUST produce a verified commit: (i) the **one-time** fix — I create the `-s ours` merge locally signed with my SSH key (verified) via a PR, or admin-bypass signatures; (ii) the **forward** job — create the merge via the GitHub API/Git Data path (App commits are verified) OR have the chosen bypass mechanism also bypass signatures. This pairs with the ruleset decision below.
5. **Update the runbook + sync code/tests (codex F2):** `CLAUDE.md` (Release runbook) and `scripts/release/open-sync-pr*.ts` PR body/comment currently say "squash-merge". Left unchanged they recreate the bug. Flip all release docs, the sync PR text, and the unit tests to require a **merge-commit** sync.
- NOT done (rejected monkey-patches): manually pre-seeding the prerelease manifest to `0.24.0-rc.0`; a permanent `Release-As`/`last-release-sha` in config; deleting the historical `Release-As: 0.23.0`.

### Phase 1 — Full-lifecycle validation in the `nulo-release-rehearsal` throwaway
Real cuts (not dry-runs — increment + promotion need real tags) prove the WHOLE lifecycle before any real-repo change. In the throwaway: establish a stable base tag + a `dev` with the broken (squashed) ancestry to mirror the bug, then apply the fix and cut: **`X.Y.0-rc.0` → `X.Y.0-rc.1` (second cut, real tag) → promote to stable `X.Y.0`**, exercising `release-prerelease.yml` + the manual unstick + `release.yml` publish escape-hatch.
- **Validation gate** — in the throwaway: rc.0 PR shows the correct `-rc.0` + a since-baseline changelog; after tagging rc.0, a second cut yields `-rc.1`; a stable promote from the throwaway's `main` yields `X.Y.0` (rc tags ignored). All three observed. Layers: live-CI (throwaway).

### Phase 2 — Apply the fix to the real repo
(a) Config PR to `dev`: `prerelease-type: "rc.0"`. (b) **Mechanism 2a**: add `"merge"` to dev's ruleset `allowed_merge_methods` (→ `["squash","merge"]`). (c) Establish the ancestry (one-time): a signed `git merge -s ours origin/main` on a branch off dev (keeps dev's tree, brings `50b4145a` into ancestry), opened as a PR + merged with `--merge` (now allowed). (d) Forward fix: flip `sync-main-to-dev` + `scripts/release/open-sync-pr*.ts` PR text + its unit tests + the `CLAUDE.md` runbook from "squash-merge" to "**merge-commit**" (codex F2). (e) Document that while `AUTO_UNSTICK_ENABLED` is OFF the post-stable sync is **manual** — `sync-main-to-dev` only fires on the `push:main` after `attach-assets`, which the manual unstick's `workflow_dispatch` path does NOT hit (codex F3). Real `main` is signed, so a real merge introduces only verified commits (codex F1 satisfied); the one-time `-s ours` merge is signed with my SSH key.
- **Validation gate** — config valid JSON + `bun test scripts/release/` (the flipped sync unit tests) green + actionlint clean if workflow touched; `git merge-base --is-ancestor 50b4145a origin/dev` → ancestor; the landed sync merge commit shows `verified` (`git log --show-signature` / `gh` verification); a real-`dev` `release-please ... --dry-run` prints `release 0.24.0-rc.0` with a since-`v0.23.0` changelog. Layers: lint + unit + live dry-run.

### Phase 3 — Re-cut + publish the real `v0.24.0-rc.0`
Re-fire `release-prerelease.yml` (updates #189 to the correct `0.24.0-rc.0`) → review → merge → manual unstick (AUTO_UNSTICK is OFF) → `release.yml` publish escape-hatch (build chrome+firefox + smoke + attach assets; prereleases skip the Cloudflare deploys). **Preflight (codex F5):** assert no existing `v0.24.0-rc.0` tag/release, #189 not yet merged, and dispatch `release.yml` only with a `-rc.`-bearing tag (Cloudflare jobs skip on the hyphen). The `extra-files` stamp targets `apps/extension/package.json` — VERIFIED present on origin/dev (`@nulo/extension` 0.23.0) post-#186 restructure; correct.
- **Validation gate** — `gh release view v0.24.0-rc.0 --json isPrerelease,assets` → `isPrerelease: true` + the chrome/firefox zips + SHASUMS. Layers: live release.

## Security & Adversarial Considerations
- **Threat model**: release tooling. The danger is a wrong/duplicate tag or an unintended STABLE/production release. Mitigations: prereleases skip the Cloudflare prod deploys (no `nulo.sh`/`faucet.nulo.sh` change); the throwaway proves the lifecycle first; the manual unstick keeps a human in the loop (AUTO_UNSTICK stays OFF for this).
- **Branch policy**: relaxing `dev` to allow merge commits (for syncs) slightly weakens the "dev stays linear" guarantee — feature PRs stay squash by convention, but the ruleset can't enforce per-PR. The recommended bypass-actor mechanism (1) avoids this — only the release bot gains the merge-commit path; humans stay squash-only-enforced. Surfaced as the Ask. No token/secret/permission changes; the publish uses the existing `release.yml` least-privilege jobs.
- **Signed-commit integrity (codex F1)**: the merge-commit sync must NOT smuggle an unsigned commit onto `dev`. The fix requires the sync commit be **verified** (SSH/GPG for the one-time local merge; App/Git-Data API for the automated job), so the signed-commit rule stays a real gate — we are NOT weakening it, we are making the merge satisfy it. If the chosen mechanism is "bypass signatures," that bypass is scoped to the bot's sync PR only, never humans.
- **Supply chain**: no dep changes; `release-please-action@v4` unchanged.

## Assumptions
**Facts (verified this session):**
- `v0.23.0` = `50b4145a` (on `main` only); `git merge-base --is-ancestor 50b4145a origin/dev` → NOT an ancestor.
- `#146` "re-baseline dev to 0.23.0" was a squash → lost main's history into dev.
- Dry-run with the ancestry fixed + `prerelease-type: rc.0` → `0.24.0-rc.0`, 43-commit since-`v0.23.0` changelog (PROOF above).
- `versioning: "prerelease"` cold-starts correctly in 17.3.0; the two alternative config levers (drop `versioning`, `last-release-sha`) did NOT fix it (dry-run tested).
- `e4618d08` (#142) carries `Release-As: 0.23.0` but is before the anchor → excluded once ancestry is fixed.
- **The forward bug is evidenced in code:** `release.yml:457` states the `sync-main-to-dev` PR is **squash-merged** ("dev's signed-commits rule is satisfied by the GitHub-signed UI squash-merge"); `scripts/release/open-sync-pr.ts` opens the PR + labels mergeability but never controls the merge METHOD → the human squash drops main's release commit. This recurs every release until fixed.
- PR #189 (`chore(dev): release 0.23.0`, base `dev`, head `release-please--branches--dev`, label `autorelease: pending`) is the broken cut — OPEN, must NOT merge; re-firing `release-prerelease.yml` updates it in place.
- `release-prerelease.yml`: `workflow_dispatch`-only, `config-file: .github/release-please-prerelease-config.json`, `manifest-file: .release-please-prerelease-manifest.json`, `target-branch: dev`, App-token-authenticated (verified).
- Prerelease manifest = `0.23.0`; stable manifest = `0.23.0`; `prerelease: true`, `prerelease-type: "rc"`, `versioning: "prerelease"`, `bump-minor-pre-major: true` (the live config).
- `extra-files` (both configs) targets `apps/extension/package.json` — VERIFIED present on origin/dev (`@nulo/extension`, `0.23.0`); #186 restructured the repo to `apps/`+`packages/`+`contracts/`. release-please uses `createIfMissing: false`, so a WRONG path FAILS the PR update (not a silent miss) — the path is correct, no change needed. (My local checkout was 3 commits behind origin/dev when first read; codex caught it — see `lessons/phase-1.md`.)
**Inferences (Phase 1 throwaway settles):**
- rc.0 → rc.1 increment + stable promotion work once a real `v0.24.0-rc.0` tag exists (dry-run can't prove this — no tag; codex says they do). *Throwaway real cuts confirm.*
- The history-preserving sync introduces no content change on `dev` (`-s ours` keeps dev's tree; dev is already content-ahead of main). *Confirmed in the `tmp/rp-test-c` merge.*
**Asks — RESOLVED at the gate (2026-06-30): mechanism = (1) bypass actor for the release bot.** `nulo-release-bot` gets a `dev` ruleset bypass so it (and the one-time fix) can land a merge-commit sync; humans stay squash-only-enforced. The one-time ancestry fix uses the same bypass (or my signed local merge via a bypassed PR). Phase 1 still verifies the `--admin --merge` fallback in the throwaway as defense in depth.
- **(historical) How to permit the non-squash main→dev sync given `dev`'s squash-only ruleset?** (covers BOTH the one-time immediate fix and the recurring forward sync — same obstacle). Three mechanisms considered:
  - **(1) Bypass actor (RECOMMENDED):** add the release App (`nulo-release-bot`) to dev's ruleset **bypass list**; the `sync-main-to-dev` job merges its PR with `--merge`. Human feature PRs stay squash-only-enforced; only the bot can land the merge-commit sync. Cleanest + fully automatable + preserves dev's linear-history guarantee for humans.
  - **(2) Relax dev ruleset to allow merge-commits (for everyone):** simplest to configure, but dev no longer *enforces* squash for feature PRs (relies on the merge-button default + convention) — weakens the linear-history guarantee the required-check work established.
  - **(3) Per-release admin `--merge`:** keep squash-only, `gh pr merge --merge --admin` each release. Manual + relies on `--admin` honoring `--merge` over a squash-only ruleset (**UNVERIFIED — Phase 1 throwaway settles this**, since the throwaway mirrors dev's ruleset).
  - For the **immediate one-time** ancestry fix: a one-time admin/bypass merge-commit of a main→dev PR (or briefly toggle dev's allowed-merge-methods, merge, toggle back). The throwaway tells us whether `--admin --merge` works under squash-only before we touch real dev.

## Post-implementation hardening
Not a `/harden` pass. The throwaway-validated lifecycle + the runbook update (history-preserving sync) are the hardening of the release process.

## Decision ledger
- **Root cause = branch ancestry, not config** (codex + dry-run). `versioning: prerelease` kept (correct); `prerelease-type` → `rc.0` (counter).
- **Fix = history-preserving main→dev sync** (the squashed sync was the bug, evidenced at `release.yml:457`). No manifest pre-seed / no permanent Release-As (monkey-patches, rejected).
- **Establishing ancestry FUNDAMENTALLY needs a non-squash merge onto dev** (squash/cherry-pick break the parent-link) → the dev squash-only ruleset must be deliberately bypassed for syncs. Not avoidable via config.
- **Validate the full lifecycle in the throwaway with real tags** (dry-run can't — proven: a tag-less manifest bump goes haywire).
- **Open: the dev non-squash-sync mechanism** — recommend (1) release-bot as ruleset bypass actor (keeps human squash-only enforcement); (2) relax-for-all and (3) per-release admin `--merge` are the alternatives. Throwaway verifies whether `--admin --merge` works under squash-only.
- **`extra-files` path is correct** (`apps/extension/package.json` post-#186 restructure) — verified on origin/dev, no change needed.

## Audit verdicts
- Codex (research consult, session for the fix): gave the diagnosis + fix (dual-channel sound; ancestry is the bug; `rc.0`; history-preserving sync) — **verified empirically**.
- Codex (light plan audit, session `019f19d4-540d-7b11-a405-676886c46aa3`): **conditional approve**. 5 findings — all ADOPTED: F1 signed-commit rule on the merge sync (added to fix #4 + Security); F2 flip runbook/sync-code/tests from squash→merge (fix #5 + Phase 2c); F3 AUTO_UNSTICK-off → manual stable sync (Phase 2d); F4 verify stable changelog in rehearsal (already Phase 1); F5 Phase-3 preflight (added). **Codex also caught a stale-checkout error**: it read `origin/dev` (post-#186 `apps/` restructure) while my local working tree was 3 commits behind showing `packages/` — its `extra-files: apps/extension/package.json` was correct; I fast-forwarded local→origin/dev and corrected the plan. (Codex's only miss: it couldn't live-test `--admin --merge` or run a dry-run — both deferred to the Phase 1 throwaway.)

## Seeds
*(Finalized after approval — see eli5.html.)*
