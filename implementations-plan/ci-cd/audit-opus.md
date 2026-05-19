# Audit — CI/CD bring-up plan (opus 4.7)

Reviewed against the actual scripts/configs in `packages/extension/` and the accelerator references. Strong-opinions edition.

---

## 1. Showstoppers

**S1. `manifest_version` regression risk on every release** — `packages/extension/manifest/manifest.config.ts:6-12` parses the source `version` with `replace(/[^\d.-]+/g, "")` then splits on `.` or `-`. A semver like `0.15.0-rc.1` becomes `["0","15","0","rc","1"]` → `version: "0.15.0.rc"`. Chrome rejects any `version` field that isn't four dotted unsigned ints. **`release.yml` Phase 3 (bump) writes the input verbatim into `package.json`, then Phase 4 builds — the Chrome zip for any prerelease will fail to install.** The plan never addresses this. Fix: in Phase 3, before `bun run build:chrome`, derive a separate Chrome-legal version string (`0.15.0` for `0.15.0-rc.1`) and either patch the manifest plugin or set a `VITE_MANIFEST_VERSION` env var the manifest config reads. Or change the regex to `replace(/[^\d.]+/g, "")` first.

**S2. `pr-network-e2e.yml` `pull_request_target` checkout is implicit** — §3.2 lists steps but doesn't show the `actions/checkout` step. The default `actions/checkout` under `pull_request_target` checks out the **target branch's** commit, not the PR head. The workflow currently **needs the PR head's code** to test the change. If you `checkout` `github.event.pull_request.head.sha`, you have re-introduced the classic pwn-request hole (see §5). The plan needs to be explicit: which ref are we checking out, and how is `bun install` constrained?

**S3. `paths-filter@v4` with `pull_request_target`** — `dorny/paths-filter@v4` will, with default config, diff against the *target* branch (the PR's base). With `pull_request_target` the workflow context's `github.sha` is the base branch tip, not the PR head — `paths-filter` won't see the PR's changes unless you pass `ref: ${{ github.event.pull_request.head.sha }}`. Without that, every `extension-network` filter check is false and the auto-trigger never fires for `dev`-targeted PRs. Test this in Phase 3.

**S4. Reusable workflow `_quality-matrix.yml` cannot consume `needs.detect.outputs`** — §3.1 implies `_quality-matrix.yml` gates the matrix by per-package filter. A `workflow_call` reusable can take inputs but the *matrix* must be built inside the reusable from those inputs. Detect → reusable means passing an `affected-packages` JSON array as an input and building the matrix off it. Sketch this out before Phase 2 starts or the abstraction will not work.

**S5. `bun.lockb` vs `bun.lock`** — accelerator's `release-accelerator.yml:106` keys on `bun.lock` (text lockfile). Nulo's repo: confirm whether the file is `bun.lockb` (binary) or `bun.lock` (text, default since Bun 1.2). Audit prompt says `bun.lockb`. If wrong, hashing `bun.lockb` in `setup-bun/action.yml` will silently never produce cache hits. **Verify before Phase 1.**

**S6. `concurrency` cancels release runs from `dev`** — `release.yml` uses `group: release, cancel-in-progress: false` (§3.3). Good. But the `pre-build` quality re-invocation runs *as the same workflow*. If you also trigger a release from `dev` while one from `main` is mid-flight, they queue serially — fine — but `pr-quick.yml`'s concurrency group also keys per-PR. A release-PR's `pr-quick` will not cancel even though it should be redundant once the release is in-flight. Not blocking; flag and revisit after Phase 4.

---

## 2. Sequencing risk

Phase 0 (rename `master` → `main`) and Phase 1 (add workflows) are conflated. Do them in this order with hard gates:

1. **Phase 0a (rename + dev only)** — rename, default-branch, biome.json `defaultBranch`, push `dev`. Stop. Verify locally and on a fresh clone that nothing else is hardcoded to `master`. The codebase searches I'd run: `rg -nF master` across `packages/extension/scripts/**`, `tests/e2e/**`, README files. **Blast radius:** if `master` is hardcoded in build scripts, every `pr-quick.yml` run on `dev` breaks the moment Phase 1 lands.
2. **Phase 0b (labels + CODEOWNERS)** — separate commit, after 0a is verified.
3. **Phase 1 (workflows)** — only after 0a + 0b are merged and a docs-only PR shows green.

**Move Phase 2's `build-extension` ahead of `smoke-e2e`** in `pr-quick.yml` — the plan lists them as sibling jobs in §3.1 but smoke depends on a built `dist/chrome/`. Either explicit `needs: [build-extension]` or `smoke` re-builds. If sibling, you'll waste minutes on every smoke job re-doing what build did.

**Split Phase 3 (network e2e)** into 3a "wire workflow with `continue-on-error: true`" and 3b "tune the Aztec install cache key + warm cache". 3a's revert is one file; 3b's revert is annoying cache-key churn. Putting them in one phase makes "did the install cache work?" inseparable from "did the gating logic fire correctly?".

**Phase 4 should land `dry_run: true`-only first** (the plan does this — good). But §8 says "Switch to a real `dry_run: false` prerelease from `dev`" before §11 sign-off. Don't. The first real release is the moment manifest parsing (S1) breaks. Either fix S1 first or accept a broken prerelease zip. Order: Phase 4a dry-run only → fix S1 → Phase 4b first real prerelease.

---

## 3. Missing gates — top 3 by ROI

1. **Manifest version monotonicity + Chrome-legal check.** A 30-line script: assert `packages/extension/package.json` version > the latest git tag's version, and assert `manifest.config.ts`'s derived `version` matches `^\d+\.\d+\.\d+\.\d+$`. Wires into `pr-quick.yml` whenever `extension` filter trips. **ROI:** catches S1 at PR time, not at release time. Implementation: ~1 hour.
2. **CSP/manifest regression diff.** The repo has tight `content_security_policy` + `cross_origin_*` headers (`manifest.config.ts:35-43`). One slipped `'unsafe-eval'` ships a known-bad wallet. A snapshot test that asserts the built `dist/chrome/manifest.json` `content_security_policy` field equals a checked-in fixture. **ROI:** wallet-grade. Implementation: ~30 min.
3. **Bundle size budget on the build job.** Cheap: `du -sb dist/chrome | awk '{print $1}'` against a checked-in budget (e.g. 25 MB max). Fail or warn if exceeded. **ROI:** catches accidental WASM duplication early; the @aztec ecosystem ships large noir bundles. Implementation: ~15 min.

Skip SBOM + license-check for v1 — both are real but cost a day each, and the private-repo audience doesn't yet need them. Add post-release when going public.

---

## 4. Over-engineering

**The plan has too many reusable workflows for the size of the surface.** `_quality-matrix.yml` is fine. `_network-e2e.yml` is overkill — `pr-network-e2e.yml` + `release.yml` each call the same setup once. Inline the steps into a composite action (`run-network-e2e`) instead. Two reusables for one product is a code-smell.

**3 composite actions is fine** — `setup-bun`, `setup-aztec`, `setup-puppeteer` are each non-trivial. Don't trim.

**Matrix over 8 packages for `typecheck` is too much.** `bun run typecheck:all` from root is one job, runs fast (the audit gate `bun run audit:vue` already does this), and gives one log to read. Matrix overhead (8 × `bun install` + cache restore) is 2-3 min wasted per PR. Keep the matrix for **`unit-tests`** (where per-package isolation matters when one fails) and collapse `typecheck` to a single job. Saves runner cost.

**Labels register is too rich.** `release:major/minor/patch/prerelease` only matter if the release workflow actually consumes them — and §5.2 says the bump rule is auto from commit history. Drop `release:*` labels unless §11 Open Question #4 is resolved in favor of label-driven semver overrides. `area:*` cosmetic labels are noise on a one-developer repo — add them when the team grows.

**`changelogen --no-commit --no-tag` then manual tag is fine** but the post-build smoke (§3.3 step 5) is over-engineered. Phase 5 of release re-runs vitest against the extracted zip. The smoke suite already runs in `pr-quick.yml` on the same code. The marginal value here is "did the zip step damage the bundle?" — a 30-line `unzip + diff -r dist/chrome unzipped-chrome` would catch it for free. Skip the full vitest re-run.

---

## 5. `pull_request_target` security — **NOT SAFE AS WRITTEN**

§3.2's gating logic checks for the `e2e:network` label but the workflow has no explicit defense against:

1. **Evil PR adds `.github/workflows/pr-network-e2e.yml` modification in the PR**, then a maintainer labels the PR with `e2e:network`. `pull_request_target` runs the *target branch's* workflow file but `actions/checkout` defaults to *target branch* code — fine — except the workflow then does `bun install` against the PR's `bun.lockb` if you ever checkout the head, or runs `bun run e2e:agent` which loads `packages/extension/tests/e2e/**` that the PR controls. **The PR's test code becomes RCE on the runner with `GITHUB_TOKEN`'s write scope.**

The plan's §10 mitigation row says "only allow label-trigger on PRs from non-forks. Since we're private, no fork risk today." This is **not sufficient**. The wallet is high-value; an insider PR (compromised maintainer credentials, repo collaborator going rogue) is a real threat for a wallet codebase. Don't lean on "private = safe."

**Required fixes:**

- **Add an explicit allow-list gate**: before any checkout, a step `if: github.event.pull_request.author_association != 'OWNER' && github.event.pull_request.author_association != 'MEMBER'` exits non-zero. The `e2e:network` label-add must be paired with an explicit `author_association` check, not a label check alone.
- **Or use the `pull_request` event with the merge-queue pattern**: contributor's PR pushes a `synchronize` event → reviewer comments `/run network-e2e` → a `repository_dispatch` workflow triggered by a `workflow_dispatch` from the reviewer (not the PR author) runs the suite on the merge ref. This is more work but is the GitHub-recommended pattern (see [securing GitHub Actions workflows](https://docs.github.com/en/actions/security-guides)).
- **Never use the PR head's workflow code**. The workflow file `pr-network-e2e.yml` must come from the target branch. The plan implies this but doesn't enforce it.
- **Strip `GITHUB_TOKEN` permissions to the minimum**. Add `permissions: { contents: read, pull-requests: write }` at the job level. Default `permissions: write-all` on a label-triggered `pull_request_target` is the same exploit shape.

Without these, this is a wallet-codebase pwn-request. Block Phase 3 until §3.2 ships with the gate + token scoping written into the workflow.

---

## 6. Network e2e baseline handling

`continue-on-error: true` until ≤6 known failures is **the wrong shape**. Two reasons:

1. **No regression detection.** With `continue-on-error: true`, the suite passing 40/66 next week (a real regression to 6 *new* failures + the 18 *known* failures = 24) is indistinguishable from 46/66. The gate is informational; the noise hides the signal.
2. **Date pressure incentive.** "≤6 known failures" rewards the most aggressive bucketization (calling things flakes that aren't). It's the wrong reward function.

**Better:** **explicit allow-list of failing test names.** Maintain `packages/extension/tests/e2e/network/.known-failures.txt` (already implicit via the triage plan's cluster grid). The CI job's exit code is computed as: "any failure NOT in the allow-list is fatal; any pass that IS in the allow-list is fatal (flake-stripping)". This turns the suite into a regression detector immediately, even while triage continues. When the list shrinks to zero, the suite hard-gates by deletion.

This is ~40 lines of bash post-processing the vitest junit output. Cost: 2-3 hours. Massive ROI: catches new regressions starting day 1.

Codex will likely propose `vitest --retry=N` instead — push back. Retries hide real bugs (this is in the network-test-triage anti-scope, §"Anti-scope"). The allow-list approach respects that.

---

## 7. Changelogen choice

**Disagree softly. I'd pick `git-cliff`.**

Reasons:
- `changelogen` is a unjs (Nuxt-adjacent) project with one maintainer cadence and 1k stars. `git-cliff` is more widely used, Rust, single static binary (no `bun install changelogen` needed in CI), highly templated.
- The plan's only real `changelogen` value-prop is "bumps `package.json` and generates `CHANGELOG.md` from Conventional Commits." `git-cliff` does the changelog half and **leaves the bump explicit** (a one-line `bun pm version <ver>` in the workflow). Separating those concerns means a release that fails between bump-and-changelog leaves a recoverable state.
- The plan's §5.1 dismissal of `git-cliff` as "heavier setup" is wrong. A single `cliff.toml` plus `git cliff --tag v$VERSION --unreleased --strip header` is one step.
- `git-cliff` keeps working when you eventually split internal packages onto their own changelogs (footer-based scoping). `changelogen` is single-package by design.

That said: `changelogen` is *fine* for v1. This is not a showstopper. Reverse the decision only if you want zero unjs-org dependencies on the release path.

**Explicit dismissal endorsement:** the plan's rejection of `changesets` (multi-package overkill), `release-please` (auto-PR noise), and `semantic-release` (npm-publish-centric) is correct.

---

## 8. Release post-bump strategy

**Agree with the plan: skip the auto post-release bump PR.**

The accelerator's `bump-source` job at `release-accelerator.yml:409-481` patches `tauri.conf.json` + `Cargo.toml`. Nulo only has `package.json` to bump. The single-file change is so small that **the human (or the next feat PR's automated bump on the release branch) handles it without ceremony**.

Also: the accelerator pattern requires a `PAT_TOKEN` (line 462, 416) because `GITHUB_TOKEN`-created PRs don't trigger workflow runs. Adding `PAT_TOKEN` is a fresh secret with broad scope (`repo` write). For a wallet repo, that's another credential to rotate and another exploit target. **Not worth it for one file.**

What the plan should explicitly say: "after a stable release, the next feat PR to `dev` bumps version to next-patch + 1 as part of its normal commit. No automation." Codify in PR template.

If you ever need the bump automation: don't use `PAT_TOKEN`; use a [GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) with `actions: write` + `contents: write` scoped to this repo only. That's the modern pattern; PAT is legacy.

---

## 9. Open Question recommendations

1. **Branch protection** — **C (advisory-only)** for now, **A (go public)** when first stable releases. Public-and-private branch protection differs only in pricing; the ruleset YAML is identical. Don't pay for Pro.
2. **Network e2e baseline** — Switch from "≤6 known failures" to **allow-list approach (§6 above)**. Hard-gate the suite minus the allow-list immediately.
3. **Single vs dual changelog** — **Single (`packages/extension/CHANGELOG.md` only)**. Repo-root `CHANGELOG.md` rots. README links to the package one. Less to maintain.
4. **Tag prefix** — **`v<X.Y.Z>`**. Yagni on `@nulo/extension@<X.Y.Z>`. If we ever publish a second artifact, retag at that point.
5. **Release workflow access** — **lock `workflow_dispatch` to maintainers via `environment: production`** even on free. The environment exists; reviewers don't (free-tier limit) but the gate is still there for when you upgrade. Costs nothing.
6. **Promote-to-main PR on stable release** — **Skip** (per §8 above). `dev → main` PRs handle it.
7. **Smoke e2e on `release/*` branches** — **Yes**, but it's already covered by §3.3 step 5. No additional work.
8. **Aztec version bump workflow** — **Defer**. Aztec major-version bumps in this repo have been quarterly-ish, and each one needs hand-tuning. A workflow that automates the easy 80% is wrong because the manual 20% is where bugs land. Build it when there's a clear pattern.

---

## Bottom line

Plan is structurally sound and the phasing is rational. **Three things block landing as written**: S1 (manifest version on prereleases), §5 (`pull_request_target` security), and §6 (network e2e regression detection). Fix those three before Phase 3 starts. Everything else is polish — including the changelogen vs git-cliff choice, which is taste, not safety.
