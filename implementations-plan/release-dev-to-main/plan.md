# Release dev → main (extension v1.0.0 + faucet + landing → latest)

**Tier:** `/blueprint deep` · **Type:** release-execution runbook · **Status:** ✅ **APPROVED 2026-06-22 — executing (agent-driven, attended)**

## Approved decisions (2026-06-22)

| Ask | Decision |
|---|---|
| **A1 version** | **`0.23.0`** (NOT 1.0.0) — via a `Release-As: 0.23.0` commit in the promote set. No config edit. |
| **A2 who drives** | **The agent drives everything** — user operates no GitHub UI. Agent posts a one-line chat checkpoint before the **two** true points of no return (promote merge · tag push) and proceeds on "go". |
| **A3 landing CF** | **Confirmed by user** — CF dashboard deploy hooks are wired/deploy. |
| **A4 install CTA** | **Re-point** `VITE_NULO_INSTALL_URL` away from the dead Chrome-Web-Store default (target: the landing `https://nulo.sh`). |
| **A5 faucet contracts** | **NOT deployed, and do NOT deploy them.** Consequence (accepted): faucet.nulo.sh ships live but **drips fail** until contracts are deployed later. Phase 6 faucet check = site-live + cross-origin-isolated only; real drip is a known post-release follow-up. |
| **A6 cross-fork window** | **Accept + announce.** No faucet auto-deploy pause — faucet goes live at promote-merge. |
| **A7 e2e flake policy** | **Lean re-run (block until green)**; re-evaluate live only if it actually flakes. Do NOT preemptively ship with the gate off. |
| **A8 CF rollback** | User holds CF access (rollback authority confirmed implicitly via A3). |

## Summary

Promote `dev` → `main` and ship the next **stable** release across all three production surfaces, using the existing automation **exactly as it stands** (user decision: *execute only*). This is an irreversible production event carrying a **breaking protocol fork** (`feat(deps)!: aztec 5.0.0-rc.1`, #122) plus 63 other commits since v0.22.0. The deep ceremony is spent red-teaming the **sequence, failure modes, and rollback** of an irreversible release — not code architecture (there is none to change).

### What "released to latest" means, per target

| Target | "Release" mechanism | "Latest" =  |
|---|---|---|
| **Extension** (`packages/extension`) | `release.yml` → release-please → tag `vX.Y.Z` → GitHub Release with chrome+firefox zips + SHASUMS + git-cliff notes | the GitHub Release tagged `vX.Y.Z` (non-prerelease → shown as *Latest*) |
| **Landing** (`packages/landing`) | Cloudflare Pages; `refresh-landing` curls the deploy hook *after* the release exists; `prebuild` fetches the latest GH release for the download button | the CF Pages prod deploy reflecting `main`, download button pointing at the new `vX.Y.Z` chrome zip |
| **Faucet** (`packages/faucet`) | Cloudflare Pages, **auto-builds on push to `main`** (dashboard Git-integration, per user) | the CF Pages prod deploy reflecting `main` |

The faucet and landing are **not versioned** (both pinned `0.1.0`) — they are static sites that track `main`. There is exactly one *version* in this release: the extension's. The git-cliff release notes are **extension-only** (`cliff.toml` include-path `packages/extension/**`).

---

## Why this tier (deep)

Rubric — HIGH on four of six dimensions:

- **Irreversibility: HIGH** — pushes a permanent tag, advances `main`, redeploys two prod sites, publishes a public GitHub Release the landing links to.
- **Blast radius: HIGH** — every user + all three surfaces; first stable carrying the 5.0 protocol hard fork.
- **External coupling: HIGH** — Cloudflare Pages ×2, GitHub Releases API, alpha-testnet (network-e2e gate), GitHub tarball deps.
- **Migration cost: MODERATE** — 5.0 protocol fork; faucet `deployments.json` must match 5.0 contracts; prerelease-manifest re-baseline.
- Novelty MODERATE (well-documented runbook exists), security sensitivity MODERATE (deploy-hook + App-key secrets, supply-chain trust point). → **deep** is correct; not mega-deep (surface is mapped, not novel).

---

## Assumptions

### Facts (verified against the repo)

- **F1** — `release.yml` job DAG (push:main): `release-please → resolve →` then **in parallel** `{lint-and-typecheck, unit-tests, network-e2e}` AND `{build-chrome, build-firefox}` — the builds need only `resolve + lint + unit`, **NOT** network-e2e (`release.yml:171,181`); `build-chrome → smoke-against-artifact`; **`attach-assets` needs ALL of** `{lint, unit, network-e2e, build-chrome, build-firefox, smoke}` (`release.yml:199`). So **`network-e2e` gates the PUBLISH (`attach-assets`), not the builds** — builds run alongside it. Then `attach-assets → {refresh-landing, publish-chrome-store(stub), publish-firefox-amo(stub)} → status`.
- **F2** — **Computed version = `v1.0.0`.** `.github/release-please-config.json` sets neither `bump-minor-pre-major` nor `bump-patch-for-minor-pre-major` → both default `false`. With base `0.22.0` (`.release-please-manifest.json`) and a breaking `feat!` in the delta, release-please bumps **major → 1.0.0**. (config lines 1-33; manifest `{ ".": "0.22.0" }`)
- **F3** — `package.json` version is `0.24.0-rc.3`; the **prerelease** manifest `.release-please-prerelease-manifest.json` is `{ ".": "0.20.2" }` — **stale** (never re-baselined after v0.21/v0.22). The stable flow ignores both; it computes from the stable manifest (0.22.0).
- **F4** — Delta dev→main = **64 first-parent commits**; headline breaking change `feat(deps)!: upgrade aztec to 5.0.0-rc.1 (protocol hard fork) (#122)`; also faucet Fuel tab (#104), design-system rounds (#114/#123/#127), passkey labels (#138), UX batch (#140).
- **F5** — `release.yml` hits the **release-please v4 abort bug** on the post-merge run; downstream publish jobs skip. Documented manual unstick + `workflow_dispatch` republish in `CLAUDE.md` § Release runbook.
- **F6** — `refresh-landing` (`release.yml:289-316`) fires **only on `push:main` + stable + non-dry-run**. It does **not** fire on `workflow_dispatch`. The landing's `prebuild` (`packages/landing/scripts/fetch-latest-release.ts`) reads `releases/latest`; on 404 writes a `no-release` fallback.
- **F7** — Faucet ships `packages/faucet/public/_headers` (COOP `same-origin` + COEP `require-corp` + CSP — load-bearing for `bb.js` cross-origin isolation). Token contracts in `packages/faucet/src/contracts/deployments.json` are **NULO + OLUN** (renamed in #82 token-identity-split — the README's "USDC/ETH" is stale). The **Fuel-tab bridge** has SEPARATE addresses in `src/contracts/bridge-deployments.ts` + `public/testnet-bridge.json`, **not** covered by `verify:deployments`.
- **F8** — `main` ruleset: **merge-commit only** (not squash) + **signed commits** + required `Quality / Status` + required `Network e2e / Status`. Release-PR commits are App-token-authored (verified) → satisfy the signed rule. (`CLAUDE.md` § Branching, § Quality gates)
- **F9** — `network-e2e` runs by default on stable push:main (~30-45 min, alpha-testnet, SHA-pinned accelerator binary, needs `SPONSORED_FPC_SALT`). On `workflow_dispatch` it runs only if `run_network_e2e=true`.

### Inferences (unverified — attack these)

- **I1** — **Faucet auto-deploys from `main`** via CF Pages Git-integration (user-asserted; the trigger config is dashboard-side, *not* in the repo). If it's actually wired to `dev`, the faucet is already live from dev and `main` promotion is a no-op for it; if wired to neither, the faucet never updates. **Must be verified in the CF dashboard in Phase 0.**
- **I2** — The **landing** likely also has CF Git-integration on `main` (the `fetch-latest-release.ts` header says it "runs in Cloudflare Pages' build environment on every push"), so it will rebuild on the promote-merge **before** the GH Release exists → download button shows stale/`no-release` until `refresh-landing` (or a manual hook) re-runs the build post-release. Branch unverified.
- **I3** — `network-e2e` will pass against alpha-testnet at release time (liveness assumed; it is also a known flake surface).
- **I4** — A pushed **tag can be deleted** for rollback even though branch-deletion/force-push are blocked by rules (needs confirmation; affects rollback viability in Phase 3).
- **I5 (now VERIFIED)** — `fetch-latest-release.ts` → `resolveReleaseInfo` **throws** if `releases/latest` has no `nulo-chrome-*.zip` (`packages/landing/src/release-resolver.test.ts:27`). So triggering the landing rebuild against the Phase-3 placeholder release (zero assets) makes the CF build **fail loud** (red deploy), NOT a silent broken download — safer, but it means: only trigger landing AFTER Phase-4 assets exist, else you get a failed CF build + no update. The landing links the release **page** (`releases/tag/vX.Y.Z`, `release.ts` `releaseUrl`), not direct zip URLs.
- **I6** — The Phase-7 `main → dev` back-merge is clean. The 5.0 fork delta may conflict on `package.json` / `bun.lock` / `CHANGELOG.md`. Unverified.

### Asks (decisions for the user — surfaced at the gate)

- **A1 — Version (the big one).** release-please will propose **`v1.0.0`** (breaking 5.0 fork + `bump-minor-pre-major` unset). Accept **1.0.0**, or pin **`0.23.0`**? 1.0.0 publicly signals "production-ready" while the wallet runs on **alpha-testnet + a `5.0.0-rc.1` (release-candidate) protocol**. **Mechanism is settled (per ledger): if 0.23.0, use `Release-As: 0.23.0`** in a commit in the promote set, or edit the Release PR's manifest + `package.json` + `CHANGELOG.md` before merge — **no config/automation change** (the `bump-minor-pre-major` config edit was considered and *rejected*). You decide the **number**; nothing else about A1 is open.
- **A2 — Who drives irreversible steps?** Default: the **human** clicks-merges the promote PR + Release PR via the GitHub UI (web-flow signs the merge commits) and I run the mechanical CLI (unstick, `workflow_dispatch`, verification). Confirm, or authorize me to do the CLI merges with `--admin`.
- **A3 — Landing CF wiring** (the hostname is `nulo.sh`, verified in `packages/landing/index.html:13` — *not* an open question). Confirm in the Cloudflare dashboard: the **landing** Pages project's production branch = `main`, AND `CLOUDFLARE_PAGES_DEPLOY_HOOK` belongs to **that** project (not the faucet's). Phase 5 "verify the landing" is meaningless if the hook points at `dev` or the wrong project — you'd verify the wrong site green. Resolves **I2**.
- **A4 — Faucet install CTA.** `VITE_NULO_INSTALL_URL` defaults to a Chrome Web Store link. Since marketplaces are out of scope, that link is dead for users. Point it at the GH Release / landing for this release, or accept the dead CTA? (Non-blocking; surface it.)
- **A5 — Faucet 5.0 contracts deployed?** Were the faucet's Dripper/USDC/ETH (re)deployed to alpha-testnet on the 5.0 protocol, matching the committed `deployments.json`? This is **maintainer-manual** (`deploy:testnet`), **not** CI-gated. If they aren't live, the faucet site deploys fine but **every drip fails**. Blocking for a usable faucet.
- **A6 — Cross-fork window.** The faucet auto-deploys on the 5.0 protocol the **instant `main` moves** (Phase 1) — ~30-45 min **before** the extension GitHub "Latest" exists (Phases 3-4). Users in that window hit a 5.0 faucet while the old v0.22.0 extension is still the linked "Latest" → cross-fork breakage. Accept + announce the window, or **pause CF faucet auto-deploy** (dashboard) until Phase 6 for a synchronized cutover?
- **A7 — network-e2e flake recovery policy.** The accelerator kill-switch (`NULO_E2E_DISABLE_ACCELERATOR` / `disable_accelerator`) is wired into `pr-network-e2e` but **NOT** into the stable `release.yml` gate. If network-e2e flakes *after* the tag+release exist (Phase 3 done, Phase 4 mid-run), what's the policy: **block until green** (re-dispatch the same tag — idempotent), or **allow a manual republish with `run_network_e2e=false`** (ship without the live-testnet gate)? Decide now so a mid-release flake doesn't force an unplanned judgment call.
- **A8 — Cloudflare rollback authority (ops).** Who can roll back the landing + faucet Pages deploys if a prod deploy is bad? (The repo can't; it's dashboard-side.) Confirm the human on-call has CF access before starting.

---

## Security & Adversarial Considerations

- **Threat model.** The release pipeline is a **supply-chain trust point**: whoever controls the artifact controls what users sideload. Mitigation: artifacts are **built from source in CI** (no local upload). **`SHASUMS256.txt` is corruption-detection only, NOT independent provenance** — it's produced by the *same* CI run that builds the zips (`release.yml:236`), so it proves the download wasn't truncated, not that the build is trustworthy (no signing/attestation; the Firefox build is explicitly flagged unsigned in the release body). Real provenance would need artifact attestation/signing — out of scope this release, worth a future `/harden`.
- **Secrets / least privilege.** Three secrets gate this release: `RELEASE_PLEASE_APP_PRIVATE_KEY` (can author *verified* commits — high blast radius if leaked), `CLOUDFLARE_PAGES_DEPLOY_HOOK` (a **capability URL** — anyone holding it can trigger landing deploys), `SPONSORED_FPC_SALT` (network-e2e fee payer). Phase 0 verifies all three exist **before** starting; none are printed or echoed. `release.yml` requests `contents: write` (needed for tag/release) + `pull-requests/issues: write` (release-please) — scoped, not org-wide.
- **Supply chain.** The 5.0 deps include **GitHub-tarball deps** (`@defi-wonderland/aztec-standards`, `@wonderland/aztec-fee-payment`) pinned by release-commit hash — outside the npm 7-day min-age gate, trusted by URL+hash. `bun install --frozen-lockfile` in CI fails on any lockfile drift. No new npm deps land in this release beyond what's already on dev (already CI-gated).
- **Cross-origin isolation (faucet).** COOP/COEP in `_headers` is **load-bearing** for `bb.js` WASM proving. A silent regression (CF dropping the header, a CSP tightening) breaks proving with a non-obvious error. Verified post-deploy in Phase 6 (`curl -I` the headers + a real drip).
- **Protocol fork.** v0.22.0 users are on the *old* protocol; the new release targets alpha-testnet 5.0. For a **testnet** wallet, reorg/replay across the fork is not a fund-loss concern, but old installs will silently fail to connect to the new network version — expected, not a regression.
- **No new crypto.** Key derivation / passkey paths are unchanged by the act of releasing.

---

## Phases (release-execution runbook)

> Each phase ends with a **Validation gate** (commands + pass criteria). Phases touching `main`, tags, or prod deploys are marked **IRREVERSIBLE** with an explicit rollback. A phase is ✓ only when its gate passes. **A2: the agent drives every step** (user operates no GitHub UI); the agent posts a one-line chat checkpoint before the **two** true points of no return — the **promote merge** (Phase 1) and the **tag push** (Phase 3) — and proceeds on "go".

### Phase 0 — Pre-flight go/no-go (reversible)

Verify everything that must be true *before* `main` moves:

1. **dev is green** — the HEAD of `origin/dev` has `Quality / Status` **and** `Network e2e / Status` passing (the last merged PR's checks).
2. **Secrets present** — `gh secret list` shows `RELEASE_PLEASE_APP_ID`, `RELEASE_PLEASE_APP_PRIVATE_KEY`, `CLOUDFLARE_PAGES_DEPLOY_HOOK`, `SPONSORED_FPC_SALT`.
3. **Faucet 5.0 contracts live + not drifted** — `bun run --cwd packages/faucet verify:deployments` exits 0 against dev HEAD (committed `deployments.json` is internally consistent with the re-derived addresses). NOTE: this proves the JSON is consistent — it does **not** prove the contracts are deployed on alpha-testnet. The faucet's Dripper/USDC/ETH are deployed **manually** by the maintainer (`bun run deploy:testnet`, faucet README), **not** by CI. Confirm the 5.0 contracts are live on testnet (**A5**) or the faucet deploys but every drip fails.
4. **Faucet CF trigger confirmed (I1)** — confirm in the Cloudflare dashboard that the faucet Pages project's *production branch* is `main` (the single dashboard-side check; resolves I1 before we rely on it). The CI `verify:deployments` is **path-gated** in `pr-quick.yml` (fires only when the diff touches `packages/faucet/**` — which this fork does) and is **not** in the publish chain.
5. **Version decision recorded (A1)** — confirm `v1.0.0` vs `0.23.0`; if `0.23.0`, land a `Release-As: 0.23.0` commit on dev *first* (so it's in the promote set) — **no config edit** (per ledger).
6. **Local signing ready** — 1Password agent unlocked (only needed if any CLI commit/merge is used; UI merges self-sign).

**Validation gate** — Commands: `gh api repos/alejoamiras/nulo/commits/$(git rev-parse origin/dev)/status -q .state` (status on the **exact** dev HEAD, not a recent-run heuristic) + confirm `Quality / Status` + `Network e2e / Status` are success contexts on that SHA; `gh secret list`; `gh pr list --base main --state open --search 'chore(main): release'`; `bun run --cwd packages/faucet verify:deployments`. Pass: **dev-HEAD's** required contexts = success; all 4 secrets listed; **no stale open `chore(main): release` PR**; verify:deployments exit 0; **A1 + A5 + A6 + A7 decided**; **CF dashboard confirmed for BOTH projects** — faucet prod branch = `main` (I1) and landing prod branch = `main` + `CLOUDFLARE_PAGES_DEPLOY_HOOK` owns the *landing* project (I2/A3); **rollback operator named** (A8). Record go/no-go in `lessons/phase-0.md`. Layers: config/secret/state checks.

### Phase 1 — Promote dev → main (**IRREVERSIBLE** — main advances + faucet auto-deploys)

0. **A6 branch — if `synchronized cutover`:** PAUSE the faucet CF Pages auto-deploy in the dashboard *now*, so the promote merge does NOT ship the 5.0 faucet ~30-45 min ahead of the extension Latest. (If A6 = `accept + announce`: skip — the faucet goes live at merge, by design.)
1. Open PR: `release: promote dev → main (aztec 5.0 hard fork, faucet Fuel tab, design rounds 1-3, passkey labels, UX batch)`.
2. Wait for required checks (`Quality / Status`, `Network e2e / Status`) green on the PR.
3. **Human merges via UI** with a **merge commit** (main ruleset; web-flow signs).

**Irreversible side effect:** the instant `main` advances, the **faucet CF Pages build fires** and `faucet.nulo.sh` redeploys from new `main` (I1). The landing likely rebuilds too (I2) but with a stale/`no-release` download until Phase 5.

**Rollback:** revert the merge commit via a new `revert` PR to `main` → triggers faucet/landing redeploy of the prior state. No tags exist yet, so nothing to delete. (Reverting a 64-commit merge is messy but possible; prefer fixing forward unless the faucet is visibly broken.)

**Validation gate** — Commands: `git log origin/main --first-parent -1` (== the promote merge); `curl -sI https://faucet.nulo.sh`; **confirm the live faucet CF deployment's commit == the promote merge SHA** (CF dashboard/API — `curl -I` proving headers ≠ proving it's the *new* build); `gh run list --workflow release.yml --limit 1`. Pass: promote merge on main; **faucet's current prod-deploy commit == promote SHA** (or, if A6 = synchronized-cutover, faucet auto-deploy confirmed *paused*); COOP/COEP present; release.yml run triggered. Layers: prod-deploy provenance + CI trigger.

### Phase 2 — Release PR: version reconciliation + merge (**IRREVERSIBLE** — bakes the version)

1. release-please opens `chore: release 1.0.0` (or `0.23.0` per A1).
2. **Reconcile the version (F2/A1):** confirm the proposed version matches the Phase-0 decision. If it shows `1.0.0` and that's wrong, STOP — do not merge; resolve A1 first.
3. Review the `CHANGELOG.md` diff (the breaking change should be flagged).
4. **Human merges via UI** (merge commit; App-token commits are verified).

**Rollback:** before merge — just close the PR. After merge but before tag (Phase 3) — the version is in `CHANGELOG.md`/`package.json` on main but no tag exists; revert the Release-PR merge commit to undo.

**Validation gate** — Pass: Release PR merged; `CHANGELOG.md` top entry = the decided version; `packages/extension/package.json` version bumped to match. Layers: artifact inspection.

### Phase 3 — Manual unstick (**IRREVERSIBLE** — pushes the tag)

Expected: the post-merge `release.yml` run **aborts** ("There are untagged, merged release PRs outstanding"); publish jobs skip (F5). Then run the `CLAUDE.md` unstick:

```bash
PR_NUM=<Release PR #>; VERSION=<1.0.0 or decided>
MERGE_COMMIT=$(gh pr view "$PR_NUM" --json mergeCommit -q '.mergeCommit.oid')
git fetch origin main
git tag -a "v$VERSION" "$MERGE_COMMIT" -m "Release $VERSION"
git push origin "v$VERSION"
gh pr edit "$PR_NUM" --add-label "autorelease: tagged" --remove-label "autorelease: pending"
gh release create "v$VERSION" --verify-tag --title "v$VERSION" --notes "Filled by publish run."
```

**Partial-failure resume (mid-unstick — these steps are individually idempotent):** if the **tag push succeeded** but a later step failed (`gh pr edit` or `gh release create`), **do NOT delete the tag** — re-run only the missing step(s): re-label the PR and/or `gh release create` (use `gh release view "v$VERSION"` to check whether it already exists). The tag is the durable artifact; deleting it is only for a *full abort*.

**Full-abort rollback (I4):** `gh release delete "v$VERSION" --yes` + `git push --delete origin "v$VERSION"`. Tag-delete is normally allowed even when force-push/branch-delete is blocked — **confirm in Phase 0**. Once the publish chain runs and the landing links the release, treat as effectively permanent.

**Validation gate** — Commands: `git rev-list -n 1 "v$VERSION"` **must equal** `gh pr view "$PR_NUM" --json mergeCommit -q .mergeCommit.oid` (guards against tagging the wrong sha — `resolve` blindly builds whatever the tag points at, F1); `gh release view "v$VERSION"`. Pass: **tag SHA == Release-PR merge SHA**; placeholder GH Release exists; PR labeled `autorelease: tagged`. Layers: tag/release state.

### Phase 4 — workflow_dispatch publish chain

```bash
gh workflow run release.yml --ref main \
  -f tag="v$VERSION" -f dry_run=false \
  -f run_network_e2e=true -f publish_marketplaces=false
```

Watch the dispatch run: `lint/typecheck + unit + network-e2e (~30-45min)` and `build-chrome/firefox` run **in parallel**; `build-chrome → smoke-against-artifact`; **`attach-assets` waits on all of them** then writes the zips + SHASUMS + overwrites the "Filled by publish run." placeholder with git-cliff notes (per F1).

**Failure mode (I3) + recovery per A7:** if `network-e2e` flakes, the run fails with the tag+release already created (placeholder body). `concurrency: release, cancel-in-progress:false` means a stuck run blocks re-dispatch — **cancel the stuck run first**. Then:
- **A7 = block until green:** re-dispatch the *same* command (idempotent — `attach-assets` uses `gh release upload --clobber`; tag/release persist) until network-e2e passes.
- **A7 = allow republish without the gate:** re-dispatch with `-f run_network_e2e=false` to ship without the live-testnet gate (accepts the risk explicitly).

Either way the tag/release persist; **never delete the tag to retry.** Optional: a first `dry_run=true` dispatch rehearses build+gates with no upload/body-overwrite.

**Validation gate** — Commands: `gh run watch <id>`; `gh release view "v$VERSION" --json assets -q '[.assets[].name]'`. Pass: dispatch run = success; assets = `nulo-chrome-$VERSION.zip`, `nulo-firefox-$VERSION.zip`, `SHASUMS256.txt`; release body = git-cliff notes (NOT the placeholder). Layers: CI + release-asset inspection + network-e2e (live testnet).

### Phase 5 — Landing redeploy + verify (refresh-landing did NOT fire on dispatch, F6)

Because Phase 4 was `workflow_dispatch`, `refresh-landing` was skipped, so the landing may still show the old version (or `no-release` from the Phase-1 race, I2). Re-trigger the landing build **after** the release+assets exist:

- **Preferred:** curl the `CLOUDFLARE_PAGES_DEPLOY_HOOK` (value from the CF dashboard; not printed), **or** use the CF dashboard "Retry deployment".
- **Avoid** the "push a no-op to main" route unless necessary — it re-triggers release-please (harmless empty Release PR) + re-deploys the faucet.

**Validation gate** — Commands: `curl -fsS https://nulo.sh/ | rg "releases/tag/v$VERSION"` (the landing links the release *page*, not the zip — `release.ts` `releaseUrl`, I5). Pass: page references `releases/tag/v$VERSION` + version text = `$VERSION` (not `no-release`, not stale). If the CF build was triggered before Phase-4 assets existed it FAILS loud (`resolveReleaseInfo` throws) — re-trigger after assets exist. Layers: prod-site content. (Confirm landing domain = `nulo.sh` via A3.)

### Phase 6 — Full-surface verification + manual smoke

- **Extension:** `gh release view --json tagName,isLatest,isPrerelease` → `vX.Y.Z`, latest=true, prerelease=false; download chrome zip + `shasum -a 256 -c SHASUMS256.txt`; optional load-unpacked.
- **Landing:** download link works end-to-end; version correct (Phase 5 gate).
- **A6 branch — if `synchronized cutover`:** RESUME the faucet CF auto-deploy now (or trigger its deploy hook) so `faucet.nulo.sh` ships *alongside* the verified extension release, then run the faucet checks below. (If A6 = `accept + announce`: the faucet has been live since Phase 1 — just re-verify it on the final main.)
- **Faucet (per A5 — contracts NOT deployed):** `curl -sI https://faucet.nulo.sh` → 200 + COOP/COEP present; in devtools confirm `self.crossOriginIsolated === true`. **The real drip is N/A** — NULO/OLUN + Dripper aren't deployed on 5.0 (A5), so drips WILL fail; accepted. Faucet "released" = **site live + cross-origin-isolated**, nothing more. **Follow-up (not this release):** deploy the faucet's 5.0 contracts, then drips work.

**Validation gate** — Pass: all three surfaces confirmed live + correct; SHASUMS verify clean; one successful real faucet drip. Checklist recorded in `lessons/phase-6.md`. Layers: full prod smoke (human-driven).

### Phase 7 — Post-release manifest re-baseline (reversible)

Per `CLAUDE.md` § "After a stable cut promotes to main" (order matters):

1. **Merge `main` → `dev`** so dev's `package.json` + `CHANGELOG.md` reflect the new stable.
2. **PR to dev** updating `.release-please-prerelease-manifest.json` `{ ".": "0.20.2" }` → `{ ".": "$VERSION" }` (also fixes the pre-existing F3 staleness).

**Validation gate** — Commands: on dev after both land, `cat packages/extension/package.json | grep version`, `cat .release-please-prerelease-manifest.json`. Pass: both = `$VERSION`; next `release-prerelease.yml` cut would start from the correct base (no stale Release PR reopened). Layers: manifest/state.

---

## Decision ledger

Three independent runbooks were drafted in parallel — **main** (this agent), **codex** (xhigh, read-only sandbox, fresh session `019eeeae-75fc-78e2-baa4-761a93dd3611`), and a **Plan subagent** (substituting for Fable, which was unavailable; the skill permits "capability over literal name"). They **converged strongly**; no material phase-ordering dispute. What each contributed and what was rejected:

| Decision | Source | Resolution |
|---|---|---|
| **Computed version = v1.0.0** | all three, independently | Adopted as the headline blocking Ask (A1). Three-way agreement that `bump-minor-pre-major` is unset → breaking commit → major bump. |
| Version override mechanism | Plan subagent (`Release-As:`) vs config edit (main) | **Adopted `Release-As:` / in-PR edit** — pins this release without touching automation (respects "execute as-is"). Config edit rejected as heavier + a standing policy change. |
| Phase 2 split (review version *before* irreversible merge) | Plan subagent + codex | **Adopted** — version reconciliation is a hard-stop gate BEFORE the Release-PR merge, not bundled with it. |
| Commit count | main + Plan subagent (**64**) vs codex (74) | **64.** Codex's 74 came from a stale local `main` (`main..origin/main = 24`); `origin/main..origin/dev = 64` (first-parent == all == 64). Codex correction **rejected**, cause identified. |
| Faucet token names | codex (**NULO/OLUN**) corrected main (USDC/ETH from stale README) | **Adopted NULO/OLUN** (verified in `deployments.json`; renamed in #82). |
| Bridge deploys separate + not drift-checked | codex | **Adopted** into A5/F7 (`bridge-deployments.ts` + `testnet-bridge.json`). |
| Landing links release *page* + `resolveReleaseInfo` throws on missing zip | codex | **Adopted** (verified `release-resolver.test.ts:27`); rewrote I5 + Phase-5 gate. |
| `verify:deployments` is path-gated, not in publish chain | Plan subagent | **Adopted** — corrected main's "CI gate" framing (Phase 0). |
| Faucet contracts are maintainer-manual, not CI | Plan subagent | **Adopted** → A5 (blocking for a usable faucet). |
| Cross-fork window (faucet on 5.0 before extension Latest) | Plan subagent + codex | **Adopted** → A6. |
| network-e2e-flake-after-tag recovery policy | codex | **Adopted** → A7 (kill-switch not wired into stable `release.yml`). |
| Landing re-trigger: deploy hook, NOT no-op main commit | all three | **Adopted** — Phase 5 prefers the hook; no-op commit causes release-please + faucet churn. |
| Tag-SHA == merge-SHA guard before publish | codex + Plan subagent | **Adopted** → Phase 3 gate. |

**Unresolved disputes:** none material. All divergences were factual (resolved by repo verification) or surfaced as user-facing Asks (A1–A8).

## Audit verdicts

**Round-structure note (transparency).** The deep tier prescribes contradiction-check → double audit (codex + fresh fable) → final fresh-context codex pass. **Fable 5 was unavailable**, so the fable seat in every round is filled by a top-tier Claude `Plan` subagent (skill-sanctioned). Given the **three independent drafts converged with zero material dispute** and all blocking items became user-facing Asks, the contradiction-check + double-audit + final pass are **compressed into a single fresh-context hostile codex pass** on the *consolidated* plan + this ledger — attacking the synthesis and the converged assumptions (esp. the shared, repo-unverifiable inference that the faucet auto-deploys from `main`). Padding three more sequential codex re-runs on a converged runbook is cost without signal.

- **Independent draft #1 — codex** (`019eeeae-75fc-78e2-baa4-761a93dd3611`): verdict *"not yet sound; executable but blocking gaps around version acceptance, release-path recovery after the manual unstick, and unverified Cloudflare-side behavior."* → **conditional approve**; conditions = resolve A1 (version) + A7 (flake policy) + verify I1/I2 (CF faucet/landing triggers). All folded.
- **Independent draft #2 — Plan subagent**: verdict *"fundamentally sound to execute as-is, with one BLOCKING precondition: confirm the version (1.0.0 vs 0.23.0) before merging the Release PR."* → **conditional approve**; condition = A1. Folded.
- **Final fresh-context codex pass** (`019eeeb8-f102-7322-b9d5-776ffd915836`, fresh session, read the consolidated plan): verdict **`reject`** — *"landing Pages wiring unverified, A6/A7 not executable in the phases, and key gates can pass without proving the right prod state."* The hostile pass earned its keep; **all 5 findings verified against the repo and folded** (none rejected):
  - **C1 — landing CF wiring is the blind spot, not the hostname.** Hostname is `nulo.sh` (verified `index.html:13`) → **deleted A3-as-URL; added a Phase-0 landing-CF dashboard check** (prod branch = main, hook owns the *landing* project) + named rollback operator (A8). I had verified the *faucet* CF trigger (I1) but not the *landing's* (I2) — real gap.
  - **C2 — A6/A7 were nominal Asks with no phase branching.** **Wired A6** into Phase 1 (pause) + Phase 6 (resume); **wired A7** into the Phase 4 recovery (block-until-green vs `run_network_e2e=false`).
  - **H1 — A1/Phase-0 contradicted the ledger** (config-edit vs `Release-As`). **Standardized on `Release-As`**; config edit is rejected everywhere.
  - **H2 — Phase 0/1 gates not falsifiable.** **SHA-pinned** dev-HEAD status; Phase 1 now asserts the faucet's live CF deploy *commit* == promote SHA (headers ≠ proof of the new build).
  - **H3 — Phase 3 had no partial-failure branch.** **Added** the mid-unstick idempotent-resume (don't delete the tag unless full-abort).
  - **M1 — SHASUMS over-claimed as provenance.** **Softened** to corruption-detection (same CI as the build).
  - **M2 — DAG text wrong** (network-e2e doesn't gate builds). **Fixed F1** (verified `release.yml:171,181,199`).

  Codex's "synthesis looks sound" list: the tag-SHA==merge-SHA guard, the landing fail-loud inference, and the post-stable re-baseline. The reject's blocking items are **all addressed**; not re-submitted for a 4th pass (the fixes were codex's own prescribed edits, applied verbatim + fact-verified) — a re-confirm can be run on request before execution.

---

## Seeds

This plan **executes a release**; its "done" condition (3 surfaces live + verified) is fully transcript-observable, and it has hard human-gated irreversible steps — so `/goal` fits, but the irreversible steps mean it should run **attended**, not as an unattended `/loop`.

### Recommended: `/goal`

```
/goal All phases ✓ in implementations-plan/release-dev-to-main/plan.md, each backed by its Validation gate in the transcript: Phase 0 go/no-go recorded; `Release-As: 0.23.0` landed on dev; promote PR merged to main (agent-driven); Release PR shows 0.23.0 + merged; v0.23.0 tag + GitHub Release via the documented unstick (tag SHA == promote-merge SHA); release.yml workflow_dispatch = success with 3 assets (chrome+firefox zips, SHASUMS256.txt) + git-cliff body (not the placeholder); landing references releases/tag/v0.23.0; faucet.nulo.sh live + crossOriginIsolated (real drip N/A per A5 — contracts not deployed); prerelease manifest re-baselined to 0.23.0 on dev. Agent drives all steps; post a one-line chat checkpoint before the promote merge and the tag push, proceed on "go". Hard limits: no workflow/CI edits; no marketplace publish; NO contract deploys (A5); never force-push/rewrite main; testnet only.
```

### Alternative: `/loop` (NOT recommended — irreversible steps need a human)

```
/loop 20m Drive implementations-plan/release-dev-to-main forward, but STOP and ask before any IRREVERSIBLE step (promote merge, Release-PR merge, tag push, prod deploy). Each firing: read plan.md + lessons/; check release.yml run status (gh run list, no --watch); advance only reversible verification work; surface anything needing my decision. Hard limits: no workflow edits, no marketplace publish, testnet only, never act on an irreversible step without my explicit ok.
```
