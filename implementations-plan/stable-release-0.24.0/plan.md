# First stable release on the new pipeline — `v0.24.0`

**Status:** APPROVED (2026-07-02) — implementing, starting Phase 0. **`AUTO_UNSTICK_ENABLED` stays OFF** (user-confirmed; manual unstick + manual self-signed sync). codex audit done (reject → all 5 findings verified + folded, incl. Phase 0 pre-flight blockers).
**Tier:** `light` (runbook-execution of an already-validated pipeline + one small pre-flight code fix). Rubric leans `mid` (blast radius + external coupling HIGH — prod Cloudflare deploys + new testnet); accepted `light` per user, mitigated by: the prerelease work already live-proved the cut→unstick→publish chain, the testnet config is user-confirmed valid (Q2), and every phase has a hard gate + rollback.

## What this is
The **first STABLE release** since the release-pipeline rebuild. Promote `dev → main`, let release-please cut **`0.24.0`** (auto: 4 feats + 10 fixes since `v0.23.0`), manual-unstick, publish, deploy prod, sync back. It ships **Aztec `5.0.0-rc.2` + the new-testnet redeploy (#248)**. Chosen: straight to stable (no interim rc.1); testnet config already validated → full auto deploy.

## Why the first one is special (the value-add over the plain runbook)
This release is the FIRST to exercise, live, everything the prerelease fix built + one thing it couldn't:
1. **`#186` (`apps/` restructure) lands on `main` via the promote** → **heals the `--ref` divergence**. main's `release.yml` + `_build-extension.yml` become `apps/extension`, matching the `v0.24.0` tag's code, so the stable publish uses **`--ref main`** correctly (the prerelease had to use `--ref dev` precisely because main was still `packages/extension`). MUST verify main is `apps/` before firing the publish.
2. **`AUTO_UNSTICK_ENABLED` stays OFF** (its first real chance to matter): the v4 abort → **manual unstick** (tag + relabel + empty release). Per the runbook, prove the flag-OFF path once here; flip it ON only after.
3. **The merge-based sync runs live for the first time on a stable release** — with the **commitlint-skip for sync PRs (#223)** + a **verified manifest commit** → the sync PR merges with a plain **`--merge` (no `--admin`, no squash)**. NUANCE: because `AUTO_UNSTICK` is OFF, the sync doesn't auto-fire (it needs `push:main`+`attach-assets`; the `workflow_dispatch` publish is neither) → I open it **manually** and sign the manifest re-baseline commit with **my SSH key** (verified). So this release validates the sync MECHANISM (merge-not-squash + commitlint-skip + verified-commit satisfies `required_signatures`), but NOT the **App-token** signing path (#228) — that runs only when the *automated* sync fires (a later AUTO_UNSTICK-ON release). #228 stays unit-tested + throwaway-validated until then.
4. **verify-live** checks `nulo.sh` + `faucet.nulo.sh` serve `0.24.0`; the **faucet must serve the new testnet** (chain-id single-sourced in `apps/faucet/src/lib/chain-constants.ts`).

## Phase 0 — Pre-flight fixes (codex blockers, BEFORE the promote)
- **(codex F1) Fix the stale `verify-live` chain-guard.** `scripts/release/chain-guard.ts` hardcodes the OLD testnet (`TESTNET_ROLLUP_VERSION=4239416255` → wallet `4229590296`); #248 moved the faucet to the NEW testnet in `apps/faucet/src/lib/chain-constants.ts` (`2787991301` → `2793892258`). `verify-live-run.ts:11` imports the stale value → a CORRECT new-testnet faucet deploy would red `verify-live`. Fix (drift-proof, single-source): `chain-guard.ts` **imports** `TESTNET_L1_CHAIN_ID` + `TESTNET_ROLLUP_VERSION` from `../../apps/faucet/src/lib/chain-constants` (standalone, verified importable) instead of re-declaring them; keep `walletChainId`/`assertTestnetIdentity`. Update `chain-guard.test.ts` + `verify-live*.test.ts` to the new numbers (or assert against the imported constant). PR to dev → merge (so the promote carries it to main).
- **(codex F2) Delete the stale `release-please--branches--main`.** It exists at `8dac5373` with `{".":"0.23.1"}` + the OLD `packages/` layout (an abandoned 0.23.1 attempt, 8 days old) — a real poison risk for the fresh cut. `git push origin --delete release-please--branches--main`; confirm no open `autorelease: pending` PR to `main` (verified: none open now).
- **Validation gate** — `bun test scripts/release/` green (chain-guard now single-sourced + tests updated); `git show origin/dev:scripts/release/chain-guard.ts | grep -c "from .*chain-constants"` ≥1; the stale branch is gone (`git ls-remote --heads origin release-please--branches--main` → empty). Layers: unit + repo-state.

## Phase 1 — Promote `dev → main`
- Confirm dev is release-ready: required checks green on dev tip (Phase 0's chain-guard PR merged), stable manifest `0.23.0`, `git merge-base --is-ancestor 50b4145a origin/dev` still true (ancestry intact).
- Open **`release: promote dev → main (aztec 5.0.0-rc.2 + new testnet, apps/ restructure, prerelease pipeline)`** PR. Resolve any `CHANGELOG.md`/manifest/`bun.lock` conflicts favoring dev's state. **Merge-commit** (main's ruleset = merge-only).
- **Validation gate** — the promote PR's required checks (`quality-status`, `network-e2e-status`, `smoke-e2e-status`) all green (network-e2e runs the full suite — flake→re-run, never neutralize). After merge: `git show origin/main:.github/workflows/_build-extension.yml | grep -c apps/extension` ≥1 (main is now `apps/` → `--ref main` is safe). Layers: live-CI (full network-e2e) + a structural grep.

## Phase 2 — Release PR → manual unstick → publish → deploy
- release-please opens **`chore(main): release 0.24.0`** within ~1 min. Review the `CHANGELOG.md` diff (bounded to since `v0.23.0`, includes the new-testnet + rc-lineage entries). **Merge-commit** it.
- **Expected v4 abort** on the post-merge `release.yml` run (AUTO_UNSTICK OFF → `auto-unstick` no-ops). **Manual unstick:** `git tag -a v0.24.0 <merge_commit> -m "Release 0.24.0"` + push, relabel the Release PR `autorelease: pending → tagged`, `gh release create v0.24.0 --verify-tag --title v0.24.0 --notes "…"` (NO `--prerelease` — this is stable).
- **Publish chain:** `gh workflow run release.yml --ref main -f tag=v0.24.0 -f dry_run=false -f run_network_e2e=true -f publish_marketplaces=false` (**`run_network_e2e=true`** — codex F3: workflow_dispatch defaults it OFF; a production stable cut re-runs the full network e2e against the built artifact. `--ref main` is correct now — Phase 1 landed `apps/` on main; marketplaces stay stubbed). Builds chrome+firefox + smoke-against-artifact + attach zips/SHASUMS.
- **Prod deploy:** stable (non-`-rc` tag) → Cloudflare `refresh-landing` (nulo.sh) + faucet deploy fire; `verify-live` runs (now non-stale after Phase 0).
- **Validation gate (HARD, codex F5)** — (1) `gh release view v0.24.0 --json isPrerelease,assets` → `isPrerelease:false` + `nulo-chrome-0.24.0.zip` · `nulo-firefox-0.24.0.zip` · `SHASUMS256.txt`. (2) **Human live-site smoke is a HARD release-complete gate** (NOT just the advisory `verify-live`, which can be green-when-skipped + `deploy-faucet` can no-op if `CLOUDFLARE_FAUCET_DEPLOY_HOOK` is unset → stale build): open `nulo.sh` (loads, links point at v0.24.0) AND `faucet.nulo.sh` — its `/build.json` `buildId` must equal the page's `nulo-build` meta (split-cache freshness) AND a real faucet action must resolve against the **new** testnet (chainId `2793892258`, no "No network configured…"). The release is NOT "done" until this passes. Layers: live-release + full network-e2e + mandatory human live smoke.

## Phase 3 — Post-release sync `main → dev` + rc re-baseline
- The `sync-main-to-dev` job does NOT fire (AUTO_UNSTICK OFF → the `workflow_dispatch` publish is not the `push:main`+`attach-assets` it needs). **Open the sync manually:** branch `sync/main-to-dev-v0.24.0` off `origin/main` at the release commit, write `.release-please-prerelease-manifest.json` = `{".":"0.24.0"}`, commit it **signed with my SSH key** (verified — a manual local sync can't use the App token, so I sign it, exactly like the prerelease one-time ancestry fix), push, open the `→ dev` PR.
- **Merge the sync PR with `--merge` (NOT squash, NO `--admin`):** the commitlint-skip (#223) fires (head `sync/main-to-dev*`), and my signed manifest commit satisfies `required_signatures`. Live proof of the sync mechanism (the App-token path #228 is exercised on a later AUTO_UNSTICK-ON release).
- **Validation gate** — `git merge-base --is-ancestor <v0.24.0 sha> origin/dev` → ancestor (dev has main's 0.24.0 release commit); `git show origin/dev:.release-please-prerelease-manifest.json` = `{".":"0.24.0"}`; a `release-please … --dry-run` on dev now previews **`0.25.0-rc.0`** (next rc series cuts clean). The sync merged with plain `--merge`, no `--admin`. Layers: lint (commitlint-skip fired) + live dry-run.

## Security & Adversarial Considerations
- **Threat model:** a production release + prod deploys. Risks: a wrong/duplicate tag, shipping a broken testnet config to prod, or an unintended marketplace publish. Mitigations: `publish_marketplaces=false` (stubs); the tag is created deliberately in the manual unstick with `--verify-tag`; the testnet config is user-validated (Q2); `verify-live` + a manual site smoke gate Phase 2.
- **Least privilege:** the release uses the existing App-token + `CLOUDFLARE_PAGES_DEPLOY_HOOK` secret; no new credentials. The publish jobs keep their scoped permissions. No `--admin` anywhere (the sync's App-signed commit removed the last need).
- **Supply chain:** ships `@aztec/* 5.0.0-rc.2` (pinned, #248) + the `bun.lock` on dev (frozen-install-verified in CI). No new deps introduced by the release itself.
- **Rollback:** a bad release → the landing/faucet redeploy from a prior good commit (Cloudflare keeps deploy history); a bad tag → delete + re-cut (no consumers pin `v0.24.0` yet). The extension zips are attached to the Release, not auto-pushed to stores (stubs).

## Assumptions
**Facts (verified this session):**
- dev tip = `#248` (aztec 5.0.0-rc.2 + new-testnet redeploy); its `quality`/`network-e2e`/`smoke` statuses are green. main = `17408da6` (v0.23.0-era, **pre-#186** → still `packages/extension`).
- 4 feats + 10 fixes since `v0.23.0` on dev → release-please computes **`0.24.0`** (minor). Stable manifest `0.23.0`; prerelease manifest `0.24.0-rc.0`; `v0.24.0-rc.0` already published.
- `50b4145a` (v0.23.0) is an ancestor of dev (the prerelease-fix ancestry holds).
- **The `v0.24.0-rc.0` tag does NOT poison the stable cut (Q2 PROVEN):** a stable-channel `release-please --dry-run` against dev yields `title: chore(…): release 0.24.0`, `compare/v0.23.0...v0.24.0`, "updating from 0.24.0-rc.0 to 0.24.0", 56 commits bounded — the `-rc` is correctly dropped.
- `#228` (App-signed sync commit) + `#223` (commitlint-skip) + `#226` (`--ref` runbook fix) are merged on dev.
**Inferences (to confirm in-flight):**
- The promote `dev→main` lands `#186` on main → `--ref main` publish works. *Verified by the Phase 1 grep gate before firing the publish.* **Q1 build-ordering PROVEN:** `build-chrome`/`build-firefox` gate on `resolve.result=='success'`, and `resolve` only produces a publishable sha when `release_created=='true'` OR a `tag` input is passed. So NOTHING builds on the promote push nor the Release-PR-merge push (release-please aborts → no `release_created`); the build runs ONLY on the explicit `workflow_dispatch --ref main -f tag=v0.24.0`, which is post-promote (main already `apps/`). The prerelease `ENOENT` can't recur here. (dev `_build-extension.yml`: 9 `apps/` refs; main: 0 → still `packages/` until the promote.)
- #248's network-e2e (local sandbox) passing ⇒ the SDK/dep works; the **live-testnet** correctness rests on the user's Q2 "already validated". *Confirmed by the Phase 2 live-site smoke.*
- ~~The promote may conflict given dev's divergence.~~ **Q6 PROVEN CLEAN:** a local `git merge --no-commit --no-ff origin/dev` onto `origin/main` merged with **exit 0, zero conflicts** (1244 files auto-merged — mostly #186's `packages/→apps/` moves). Keep the favor-dev fallback only in case `dev` advances before the real promote.
**Asks (resolved at the gate / already answered):**
- Sequence = straight to stable (answered). Testnet gate = already-validated, full auto deploy (answered). `AUTO_UNSTICK_ENABLED` stays **OFF** for this first release (runbook default; flip ON only after) — confirm at the gate.

## Post-implementation hardening
Not a `/harden` pass. After this clean flag-OFF release proves the wiring end-to-end, the deliberate follow-ups are: (a) `gh variable set AUTO_UNSTICK_ENABLED -b on`; (b) promote `verify-live` into the `status` aggregator (per the staged-rollout switches). Both are one-line, out of scope here.

## Decision ledger
- **Straight to stable 0.24.0** (no interim rc.1) — user-chosen; dev is ready + #248 green.
- **Full auto prod deploy** — testnet config user-validated; verify-live + manual site smoke as the check.
- **`--ref main` for the publish** — correct BECAUSE Phase 1's promote lands `apps/` on main first (unlike the prerelease, which needed `--ref dev`).
- **AUTO_UNSTICK OFF** — first stable proves the manual path; flip after.
- **Sync merged with plain `--merge`** — first live use of the App-signed commit (#228) + commitlint-skip (#223); no `--admin`.

## Audit verdicts
- Codex (light plan audit, session `019f2469-1a36-7303-943f-d67afaac779f`): **reject** → all 5 findings verified against the live repo + addressed:
  - **F1 (stale verify-live chain-guard) — CONFIRMED, ADOPTED:** `chain-guard.ts`=`4239416255` vs `chain-constants.ts`=`2787991301` (#248). → **Phase 0** single-sources chain-guard from chain-constants.
  - **F2 (stale `release-please--branches--main`) — CONFIRMED, ADOPTED:** exists at `8dac5373` with `{".":"0.23.1"}` + `packages/` layout. → **Phase 0** deletes it.
  - **F3 (`run_network_e2e=true` on publish) — ADOPTED:** added to the Phase 2 publish command.
  - **F4 (manual-sync signing overstated) — ALREADY FIXED** before the audit: the plan already opens the sync manually + signs with my SSH key (AUTO_UNSTICK-off → the App path doesn't run). codex independently confirmed the catch.
  - **F5 (verify-live advisory + faucet no-op) — ADOPTED:** the human live-site smoke is now a HARD release-complete gate in Phase 2.
  - **Q1 (`--ref main` ordering):** codex agrees it's safe only post-promote — matches my Phase-1 grep gate + the build-gating proof (nothing builds until the post-promote workflow_dispatch).
  - **Q2 (rc.0 poisoning):** codex agrees the rc tag itself is fine; the `0.23.1` stale branch was the real poison risk (→ F2). My dry-run already proved the stable cut = `0.24.0`.
  - codex couldn't verify live repo state (its `gh` token was invalid); I verified every finding directly.

## Seeds
*(Finalized after approval — see eli5.html.)*
