# CI/CD bring-up plan

> **Audit status**: this plan has been reviewed by two independent auditors (codex `xhigh` + opus 4.7). Their full responses live in [`audit-codex.md`](./audit-codex.md) and [`audit-opus.md`](./audit-opus.md). Where they agreed, the plan has been updated in place; where they disagreed, the open-question list (§11) calls it out. Decisions tagged **[R]** were reconciled after the audit pass.

## Mandate (from user, paraphrased)

The repo has **zero CI today**. We are professionalizing it. The end state is:

1. **Two long-lived branches**: `main` (stable, was `master`) and `dev` (day-to-day).
2. **Smart per-PR gates**: detect which packages changed and only run their relevant gates. PRs to `dev` get the **cheap+fast** lane (lint, typecheck, units, build, smoke e2e). PRs to `main` get **everything** including the **network e2e** suite. PRs to `dev` may opt-in to network e2e with an `e2e:network` label.
3. **Manual release workflow** that bumps the version, generates a changelog, builds Chrome + Firefox installers, attaches them to a GitHub Release, and tags. From `main` the release is marked `--latest`; from `dev` it's a `--prerelease`.
4. **Stub** the future Chrome Web Store + Firefox AMO publish step — reserve secret names, leave the job disabled.
5. **Commit + branch-push hooks**: keep the existing local pre-commit / commit-msg hooks; add server-side equivalents (actionlint, commitlint on the PR).
6. Use the patterns proven out in `(aztec-accelerator source tree)` (paths-filter, status aggregator, reusable workflows, composite actions).

The plan was sent to **codex** and an **opus 4.7 audit agent**; their feedback lives in `audit-codex.md` and `audit-opus.md` alongside this file. Reconciled decisions are folded back into this document before any work starts.

---

## 0. Repository facts we are designing around

| Fact | Where verified | Implication |
|---|---|---|
| `master` is current default; `dev` does **not** exist | `gh repo view --json defaultBranchRef` | Phase 0 renames + creates `dev`. |
| Repo is **private** + on **free tier** | `gh api repos/.../rulesets` → 403 "Upgrade to GitHub Pro or make this repository public" | **No branch protection / required-checks via API** until Phase 5 flips visibility to public (Alejo's Q1 decision). |
| Bun is the package manager; commitlint + biome enforced locally | `package.json`, `.commitlintrc.json`, `.githooks/`, `biome.json` | Server-side checks mirror the local hooks. |
| 8 workspaces, one shippable artifact (`@nulo/extension`) | `packages/` listing | Single-package release model. Internal packages stay at `0.1.0` and are not versioned independently. |
| Conventional commits enforced via commitlint | `.commitlintrc.json` extending `config-conventional` | Conventional Commits → drives changelog generation via `changelogen`. |
| Smoke e2e (`vitest.e2e.config.ts`) needs no Aztec sandbox | `packages/extension/vitest.e2e.config.ts` | Runs on ubuntu-latest with puppeteer + a chrome build. |
| Network e2e (`vitest.e2e.network.config.ts`) needs anvil + aztec sandbox + playground via `e2e:agent` | `packages/extension/scripts/e2e/agent.sh` | Needs aztec CLI installed; we mirror accelerator's `setup-aztec` composite action. |
| Network e2e is currently **46/66 passing**; 18 known failures tracked in `implementations-plan/network-test-triage/plan.md` | `tests/e2e/README.md`, `network-test-triage/plan.md` | **CRITICAL**: we cannot make the full network suite a hard gate until triage closes. Plan handles this; see §3.2 + Open Question #2. |
| Aztec version is auto-detected from `packages/extension/package.json` dependencies (currently `4.2.0`) | accelerator's `setup-aztec/action.yml` (we mirror that approach) | We auto-detect and cache by version key. |
| Extension version is currently `0.14.9`, bumped via manual `chore: bump extension to X.Y.Z` commits | `git log -- packages/extension/package.json` | Release workflow automates this; manual chore commits go away. |
| Build outputs: `packages/extension/dist/chrome/` (dir, exists locally), `dist/firefox/` (dir, only configured in `vite.firefox.config.mts:18` — not present until `build:firefox` runs) | `dist/` listing | Release workflow runs both builds, then zips. |
| **`packages/extension/manifest/manifest.config.ts:6-12`** parses the source version into a Chrome-legal 4-int. The current regex `replace(/[^\d.-]+/g, "")` + `split(/[.-]/)` turns `0.15.0-rc.1` into `"0.15.0."` (trailing dot — verified: `bun -e` produces `0.15.0.`). **Chrome rejects this.** First prereleases will fail to install. | Verified via `bun -e` against the live regex | **[R-S1]** Release workflow must normalize prerelease versions before build OR the regex must be fixed. See §3.3 step 3. |
| `bun run test:all` filters `@nulo/*` workspaces with `--if-present`, so packages without a `test` script (`playground`, `landing`) are silently skipped. Confirmed in root `package.json:12-16`. | root `package.json` | A naive 8-way matrix of `bun run --cwd packages/<x> test` would crash on `playground`/`landing`. The reconciled design (§3.1) calls `bun run test:all` from root and avoids the matrix. |
| Network e2e captures subprocess output to stdout/stderr only — `/tmp/aztec-node.log` and `/tmp/anvil.log` do **not** exist as files (verified: no `/tmp/` writes in `global-setup.ts`). | `grep "/tmp/" packages/extension/tests/e2e/global-setup.ts` | **[R-Codex#4]** Failure-artifact upload step must redirect subprocess stdout to files explicitly, or rely on vitest's reporter output. |
| Firefox manifest has `gecko.id = "{}"` (placeholder) | `manifest/manifest.firefox.config.ts` | AMO signing eventually requires a real gecko ID. Captured as a release-readiness TODO. |

---

## 1. Branch model + protection

### 1.1 Long-lived branches

```
main  ←  PR  ←  dev  ←  PR  ←  feature/* | fix/* | chore/* | docs/*
                  │
                  └──── network e2e gated by base-branch OR `e2e:network` label
```

- `main` = stable, what we'd ship to users.
- `dev` = integration trunk; default base for daily PRs.
- Feature branches PR into `dev` (the new default).
- A `dev → main` PR is the "promote to stable" step. It triggers the full quality bar (incl. full network e2e) and is the typical input to the release workflow.
- Hotfix to `main` directly is permitted but treated like any other main-targeted PR (full gates).

### 1.2 Rename + default

Phase 0 steps (one-time):

1. `git branch -m master main` locally, push, `gh repo edit alejoamiras/nulo --default-branch main`.
2. Open-PRs retargeting handled by GitHub automatically on default-branch rename.
3. Update references in repo: `biome.json` `vcs.defaultBranch`, `CLAUDE.md` text, any plan docs.
4. `git checkout -b dev` from `main`, push, set as the *suggested* base for new PRs (we can't make it default + force protection without Pro).

### 1.3 Branch protection **[RESOLVED — Q1=A]**

**Decision (Alejo): make the repo public.** Unlocks free branch protection on `main` + `dev`.

Enforced rules (configured in Phase 5 after the public-readiness sweep):

**On `main`:**
- Required status check: `pr-quick / status` (aggregate from §3.1).
- Required status check: `pr-network-e2e / status` (aggregate from §3.2).
- Block force-pushes.
- Block deletion.
- Require linear history (no merge commits — squash or rebase only).
- Require at least 1 review on PRs (optional — defer until team grows).

**On `dev`:**
- Required status check: `pr-quick / status`.
- Block force-pushes.
- Block deletion.

**Public-repo readiness checklist** (run *before* `gh repo edit --visibility public`, as part of Phase 5):

- Scan repo history for accidentally-committed secrets: `gitleaks detect --source . --no-banner` (or equivalent).
- Confirm `.env*` files are gitignored (they are — `.gitignore` already covers).
- Review `implementations-plan/**/*.md` for anything not appropriate to publish (vendor names under NDA, infra IPs).
- Confirm `LICENSE.md` + `SECURITY.md` are present (they are).
- Add a `README.md` "Contributing" section pointer post-public.
- The `.github/CODEOWNERS` file from Phase 0b stays valid post-public.

### 1.4 Labels **[R]** (trimmed after audit)

Phase 0 creates only the labels we will actually consume:

| Label | Purpose |
|---|---|
| `e2e:network` | Force-run network e2e on a `dev`-targeted PR. |
| `skip:smoke-e2e` | Escape hatch for docs-only PRs that incidentally touch the extension. Off by default. |

**Dropped from the original draft** (both audits agreed):

- `release:major/minor/patch/prerelease` — `release.yml` takes an exact `version` input; labels never become workflow values, so they're dead weight.
- `area:*` cosmetic labels — noise on a solo repo. Re-introduce when the team grows past two.

---

## 2. Change detection

A single `dorny/paths-filter@v4` step at the top of each workflow produces named outputs. Downstream jobs gate on them.

### 2.1 Filter definitions

```yaml
# Shared in every workflow that uses change detection.
filters: |
  # Core foundation — changes here ripple into everything downstream.
  core-foundation:
    - 'packages/wallet-core/**'
    - 'packages/wallet-crypto/**'
    - 'packages/extension-messaging/**'
    - '!packages/{wallet-core,wallet-crypto,extension-messaging}/**/*.md'
  # Aztec runtime — pulls everything below + drives the extension.
  aztec-runtime:
    - 'packages/aztec-runtime/**'
    - '!packages/aztec-runtime/**/*.md'
  # dApp dispatcher.
  wallet-bridge:
    - 'packages/wallet-bridge/**'
    - '!packages/wallet-bridge/**/*.md'
  # The shippable extension.
  extension:
    - 'packages/extension/**'
    - '!packages/extension/**/*.md'
  # Network-sensitive paths inside extension and runtime — drive auto-network-e2e.
  extension-network:
    - 'packages/extension/src/wallet/services/network/**'
    - 'packages/extension/src/wallet/services/execution/**'
    - 'packages/extension/src/wallet/services/fpc/**'
    - 'packages/extension/src/wallet/services/dapp-interaction/**'
    - 'packages/extension/src/wallet/services/dapp-session/**'
    - 'packages/extension/src/offscreen/**'
    - 'packages/extension/tests/e2e/network/**'
    - 'packages/extension/tests/e2e/fixtures/**'
    - 'packages/extension/scripts/e2e/**'
    - 'packages/extension/vitest.e2e.network.config.ts'
    - 'packages/extension/vitest.e2e.all.config.ts'
    - 'packages/aztec-runtime/**'
    - 'packages/wallet-bridge/**'
    - 'packages/playground/**'
  # Local sandbox dApp.
  playground:
    - 'packages/playground/**'
    - '!packages/playground/**/*.md'
  # Marketing landing.
  landing:
    - 'packages/landing/**'
    - '!packages/landing/**/*.md'
  # Workflow + composite-action changes — trigger actionlint + force a full run.
  workflows:
    - '.github/workflows/**'
    - '.github/actions/**'
  # Root-level config changes — force full re-validation.
  root-config:
    - 'package.json'
    - 'bun.lockb'
    - 'biome.json'
    - 'tsconfig.json'
    - '.commitlintrc.json'
    - '.githooks/**'
```

### 2.2 Downstream effects

| Affected filter | Triggers |
|---|---|
| `core-foundation` OR `root-config` OR `workflows` | full quality gates on every package |
| `aztec-runtime` | typecheck + units in `aztec-runtime`; full extension gates |
| `wallet-bridge` | typecheck + units in `wallet-bridge`; full extension gates |
| `extension` (any) | extension typecheck, units, build, smoke e2e |
| `extension-network` (any) | **also runs network e2e** — even on PRs to `dev` |
| `playground` | playground typecheck + build; trigger network e2e (playground is part of the network harness) |
| `landing` | landing typecheck + build; on push to main, deploys (deferred) |

The `extension-network` filter is the auto-include for network e2e on `dev` PRs. The `e2e:network` label is the *manual* opt-in.

---

## 3. Workflows

### 3.1 `pr-quick.yml` — fast lane (every PR, any base) **[R]** (simplified after audit)

Triggered on `pull_request: { branches: [main, dev], types: [opened, reopened, synchronize, labeled, unlabeled] }`. Concurrency-grouped per PR so superseded pushes cancel old runs.

**Both audits flagged the original 8-way matrix as premature**. Start simple; collect timing data; introduce a matrix only when one or two packages prove disproportionately slow.

Jobs (v1) — each delegated to a reusable workflow (§4.2):

1. **`detect`** — `paths-filter@v4` outputs the filters defined in §2.1. **[R-S3]** Pin `ref: ${{ github.event.pull_request.head.sha }}` because we use the `pull_request` event (not `pull_request_target` — see §3.2 for why).
2. **`commitlint`** — checks PR commits + PR title against `@commitlint/config-conventional` (uses `wagoid/commitlint-github-action@v6` or equivalent). Inline (small enough to not warrant a reusable).
3. **`lint-and-typecheck`** — `uses: ./.github/workflows/_lint-and-typecheck.yml`. Runs biome + `bun run typecheck:all`. ~30 s.
4. **`unit-tests`** — `uses: ./.github/workflows/_unit-tests.yml`. Runs `bun run test:all`. ~1–2 min.
5. **`build-extension`** — `uses: ./.github/workflows/_build-extension.yml` with `target: both`. Runs only if any filter under `extension` / `aztec-runtime` / `wallet-bridge` / `core-foundation` / `root-config` / `workflows` tripped.
6. **`smoke-e2e`** — `uses: ./.github/workflows/_smoke-e2e.yml` `needs: [build-extension]`. No Aztec sandbox.
7. **`status`** — `if: always()` aggregator. Mirrors the accelerator pattern: explicitly fails if any of the above are `failure` or `cancelled`. Skipped jobs (because the filter didn't trip) count as pass. **This is the required status check enforced by branch protection (§1.3).**

Splitting `_lint-and-typecheck.yml` from `_unit-tests.yml` lets the lint failure (30 s) appear on the PR before the slower units finish — sharper feedback loop. Matches the accelerator pattern of one job per gate.

Removed from v1 (and good follow-ups when the simple shape stops scaling):

- 8-package typecheck/unit matrix — codex called this "increases YAML complexity, runner fan-out, and skip logic before you have any timing data proving the simpler pipeline is too slow."
- Inline `actionlint` job — it duplicates the standalone `actionlint.yml`. Keep only the standalone (§3.4).

Expected wall time: **5–10 min** depending on what's affected. Without smoke e2e (docs-only PR): ~2–4 min.

### 3.2 `pr-network-e2e.yml` — network lane **[R-§5]** (rewritten after audit)

**Original design used `pull_request_target` to handle label-triggered runs.** Both auditors flagged this as the wrong tool — `pull_request_target` runs in the target-branch's workflow context with `GITHUB_TOKEN` write scopes available, and this job builds + executes PR-controlled code (`bun install`, `e2e:agent` script, the wallet bundle itself). That is the classic "pwn-request" shape. The fix is the simpler trigger.

Trigger:

```yaml
on:
  pull_request:
    branches: [main, dev]
    types: [opened, reopened, synchronize, labeled]
  workflow_dispatch:
```

Gating logic inside the job (no security gymnastics needed because we're on `pull_request`, not `pull_request_target`):

```yaml
needs: detect
if: >
  github.event_name == 'workflow_dispatch'
  || github.base_ref == 'main'
  || contains(github.event.pull_request.labels.*.name, 'e2e:network')
  || (github.base_ref == 'dev' && needs.detect.outputs['extension-network'] == 'true')
permissions:
  contents: read       # default-deny everything else
  pull-requests: read
```

Steps — **simplified after audit, because `agent.sh` already does all the port + build + grep-assert work**:

1. Composite action `setup-bun`.
2. Composite action `setup-aztec` (installs Foundry + Aztec CLI matching `@aztec/aztec.js` from `packages/extension/package.json`, cached by version). The cache key already invalidates on version change (verified in `aztec-accelerator/.github/actions/setup-aztec/action.yml:45-52`).
3. `bun run e2e:agent` — drives the whole chain: port allocation, wallet rebuild, bundle URL grep, vitest run. **Do not duplicate prebuild steps** — codex caught that the original §3.2 was "redundant at best, inconsistent at worst" (`agent.sh:18-52` already covers it).
4. **Failure artifacts**: capture vitest junit + the agent's stderr stream by tee'ing the `bun run e2e:agent` output to a log file, then upload that file + `.e2e-state/` directory contents on failure. **[R-Codex#4]** — we cannot upload `/tmp/aztec-node.log` because `global-setup.ts` never writes one; redirect explicitly or rely on the streamed-to-stdout output captured by Actions.

**Handling the 18 known failures (R-User pushback on the allow-list approach)**: skip co-located, not centralized. Use vitest's native `describe.skip` / `test.skip` directly in the failing test files, with a header comment that points at the triage cluster. From the cluster grid in `implementations-plan/network-test-triage/plan.md:33-52`:

| File | Failures | Skip shape |
|---|---|---|
| `tests/e2e/network/transfers.test.ts` | 8 / 8 (cluster A) | `describe.skip` at top |
| `tests/e2e/network/fee-methods.test.ts` | 5 / 5 (clusters A+B) | `describe.skip` at top |
| `tests/e2e/network/token-management.test.ts` | 1 / 1 (cluster A) | `describe.skip` at top |
| `tests/e2e/network/data-registerSender.test.ts` | 1 / 1 (cluster E) | `describe.skip` at top |
| `tests/e2e/network/contacts-sender.test.ts` | 3 / 4 (clusters C+D) | `test.skip` × 3 on specific cases |

Each `skip` carries a comment of the form:

```ts
// SKIP: cluster A (tokenReadyExtension importToken cascade).
// See implementations-plan/network-test-triage/plan.md — un-skip on cluster fix.
describe.skip("transfers — full suite", () => { ... })
```

**Why this beats an allow-list file:**

- The "this is broken" knowledge lives next to the test.
- Vitest reports skipped tests in run output; no custom post-processor needed.
- Network suite is a **hard gate** from day 1 — there is no informational mode. Failures are real failures.
- Un-quarantine is a one-line PR (delete `.skip`).
- Partial-cluster fixes naturally migrate `describe.skip` → individual `test.skip`.

Branch-protection-wise, the network e2e job's exit code is binary: pass or fail. No allow-list bookkeeping.

**Concurrency**: `group: network-e2e-${{ github.head_ref }}`, `cancel-in-progress: true`. The agent script's per-worktree isolation makes parallel runs *safe* in principle, but cancelling supersedes is cheaper than running two against the same PR.

### 3.3 `release.yml` — manual installer release **[R]** (rewritten after audit)

Triggered only by `workflow_dispatch`. Locked to maintainers via `environment: production` (Open Question #5: this works even on free tier; required reviewers gate appears when we upgrade or go public).

Inputs:

```yaml
inputs:
  version:
    description: "Semver to release (e.g. 0.15.0 or 0.15.0-rc.1)"
    required: true
    type: string
  channel:
    description: "stable (main only) or prerelease (dev only)"
    required: true
    type: choice
    options: [stable, prerelease]
  dry_run:
    description: "Build + assemble locally. NO tag, NO branch push, NO GitHub Release."
    required: false
    type: boolean
    default: false
```

Phases:

1. **validate** — semver regex; assert `channel=stable` only on `main`, `channel=prerelease` only on `dev`. Compute the git tag (`v<version>`).
2. **gate** — re-invokes the quality bar (`bun run typecheck:all`, `bun run test:all`, `bun run lint`, `bun run build`, smoke e2e). For stable channel, also runs the network e2e composite (using the quarantine allow-list). Failures abort.
3. **version normalize + bump [R-S1]** — derive the Chrome-legal version explicitly. For `0.15.0` → manifest version `0.15.0.0`; for `0.15.0-rc.1` → manifest version `0.15.0.1` (label-numeric only) **and** rejected by Chrome's strict mode if anyone touches the regex without thinking. Implementation options ranked best-first:
   - **Preferred**: rewrite `manifest.config.ts:6-12` to use `replace(/[^\d.]+/g, "")` (strip the dash and rc/alpha/beta entirely), then split on `.` only. `0.15.0-rc.1` → `["0","15","0","1"]` → manifest version `0.15.0.1`. The label index becomes the rc number; deterministic + Chrome-legal.
   - Alt: keep the regex; release workflow passes a `MANIFEST_VERSION` env var the manifest reads when set. Adds indirection.
   - The release workflow writes `version` verbatim into `packages/extension/package.json` (the human-facing version), and the manifest config derives the Chrome-legal form from it. `version_name` keeps the full semver including suffix.
4. **changelog [R-§7]** — use **git-cliff** (Rust single binary, no install needed via `orhun/git-cliff-action@v4`) with a `cliff.toml` scoped to `packages/extension/**`. Output goes to `packages/extension/CHANGELOG.md` and a short release-notes excerpt to a temp file used by `gh release create`. Decision change vs. v1 of the plan: codex argued that since `workflow_dispatch` takes an exact version anyway, the value of `changelogen`'s auto-bump disappears. git-cliff cleanly separates "render the unreleased section as markdown" from the bump step, so a failed publish leaves a recoverable state.
5. **build** — `bun run --cwd packages/extension build:chrome` + `build:firefox`. Zip: `nulo-chrome-<version>.zip`, `nulo-firefox-<version>.zip`. Compute SHA-256 (`SHASUMS256.txt`).
6. **post-build smoke** — `unzip` the chrome zip into a temp dir; `diff -r dist/chrome unzipped/` to confirm the artifact matches the build output byte-for-byte (catches a corrupt zip in <2 s). Plus: re-run `bun run test:e2e` with `EXTENSION_PATH=/tmp/unzipped` (smoke harness must accept this env var — see §9 phase-2 work; currently hardcoded to `../../dist/chrome` at `tests/e2e/global-setup-smoke.ts:7`).
7. **tag + release (skipped when `dry_run`)** — push the release branch + tag; `gh release create v<version>` with `--latest` (stable) or `--prerelease`, body = git-cliff's unreleased-section output, assets = both zips + `SHASUMS256.txt`. **[R-Codex#1]** When `dry_run: true`, this phase is fully skipped — no branch push, no tag, no draft release. The zips + sums are uploaded as **workflow run artifacts** (24-h retention) for eyeballing. Nothing permanent escapes a dry run.
8. **marketplace stubs** — two jobs `publish-chrome-store` and `publish-firefox-amo` with `if: false # TODO(MARKETPLACE)`. Each documents required secrets (`CWS_*` / `AMO_JWT_*`). These never run; the wiring is visible.

**Removed from the original plan (R-§8)**: the auto post-release "bump main to v<next>" PR. Both auditors agreed: not worth `PAT_TOKEN` for one file in a wallet repo. The next normal PR to `dev` does the trivial bump.

Concurrency: `group: release`, `cancel-in-progress: false`. We never cancel a half-published release.

### 3.4 `actionlint.yml` — workflow + shell lint

Mirror accelerator's `actionlint.yml` 1:1. Triggers on `pull_request: { branches: [main, dev] }`. Runs only if `workflows` filter trips. Lints `.github/**/*.yml` and shell scripts in `packages/extension/scripts/**`. **[R]** This is the *only* place actionlint lives — the original draft had it duplicated as a step inside `pr-quick.yml`. Codex flagged the duplicate; we dropped the inline job.

### 3.5 ~~`dependabot.yml`~~ **[DEFERRED — Alejo's call]**

Alejo will handle dependency bumps manually at his own cadence. Skipped from this bring-up. Easy to add later (≤30 min) when desired — drop a `.github/dependabot.yml` adapted from the accelerator's: npm weekly with `@aztec/*` ignored + github-actions weekly.

No `cargo` ecosystem here (no Rust).

### 3.6 `landing-deploy.yml` (deferred / stub)

The accelerator has S3+CloudFront deploys for the landing page. Nulo's landing is in-repo but not deployed yet. Leave a stub workflow guarded by `if: false` that documents the AWS secrets pattern. **Out of scope for this CI bring-up** unless user wants it in.

### 3.7 New gates added after audit **[R]**

Three small high-ROI gates the audits surfaced. Each is a checked-in script invoked from `pr-quick.yml` when its trigger condition trips. None requires new infra.

1. **Manifest version normalization + Chrome-legal check** — `scripts/ci/check-manifest-policy.ts`. Asserts:
   - the derived chrome `manifest.json` `version` matches `^\d+\.\d+\.\d+\.\d+$` (catches S1 at PR time)
   - the new `version` in `packages/extension/package.json` is `>=` the most recent git tag's version
   - `host_permissions`, `permissions`, `optional_permissions`, and `content_security_policy` haven't drifted from a checked-in fixture file `manifest.policy.json`
   Triggered: whenever the `extension` filter trips.
2. **Bundle size budget** — `scripts/ci/check-bundle-size.ts`. After `build:chrome`, runs `du -sb dist/chrome` and fails (or warns at 80%) against a checked-in budget. Initial budget: **25 MB** (head-room over today's bundle size).
3. **CSP regression snapshot** — folded into #1 above. The fixture covers `content_security_policy.extension_pages`, `cross_origin_embedder_policy`, `cross_origin_opener_policy`. One slip and a known-bad wallet ships.

**Out of v1**: SBOM, license report, license-allowlist. Both auditors agreed these are higher-cost-than-value pre-public-release.

---

## 4. Reusable workflows + composite actions **[R-User pushback]** (accelerator-grade shape)

The audits initially pushed me to collapse most reusable workflows into composites. The user pushed back: the accelerator has 5 reusable workflows for one product because each earns its keep (multiple callers, full-job complexity, secret-inheritance boundary). I was over-correcting. Returning to that shape — every reusable below has **at least two callers** and a clear input contract.

### 4.1 Composite actions (`.github/actions/`)

Used for *step-level* reuse — these are short setup fragments that go inside a job, not whole jobs.

- **`setup-bun`** — checkout, `oven-sh/setup-bun@v2`, cache `~/.bun/install/cache` keyed on `bun.lockb`, `bun install --frozen-lockfile`. Single source of truth for the basic toolchain. **Inputs**: `ref` (defaults to `github.ref`). Mirrors the structure inside `aztec-accelerator/.github/actions/setup-aztec/action.yml:13-23`.
- **`setup-aztec`** — Foundry + matching Aztec CLI install, cached by version. Detects the version from `packages/extension/package.json` `@aztec/aztec.js`. **Inputs**: `skip_cli` (boolean — skip when the test points at a remote node). Direct adaptation of `aztec-accelerator/.github/actions/setup-aztec/action.yml` adjusted for our package path.
- **`setup-puppeteer`** — caches `~/.cache/puppeteer` keyed on `packages/extension/package.json` so the bundled Chromium download doesn't redownload every run. **No inputs**.

### 4.2 Reusable workflows (`.github/workflows/_*.yml`)

Used for *job-level* reuse — each is a whole job with its own runner, timeout, failure artifact policy, and secret-inheritance contract. **[R-User pushback + naming option A]**: split `quality-quick` into two so lint failures surface in 30 s without waiting for unit tests.

| Reusable | Inputs | Optional secrets | Callers |
|---|---|---|---|
| **`_lint-and-typecheck.yml`** | `ref` | — | `pr-quick.yml`, `release.yml` (pre-publish gate) |
| **`_unit-tests.yml`** | `ref` | — | `pr-quick.yml`, `release.yml` (pre-publish gate) |
| **`_build-extension.yml`** | `ref`, `version_override` (for release builds), `target` (`chrome` \| `firefox` \| `both`) | — | `pr-quick.yml`, `release.yml` (build phase) |
| **`_smoke-e2e.yml`** | `ref`, `extension_path` (defaults to repo's `dist/chrome`) | — | `pr-quick.yml`, `release.yml` (post-build smoke against the unzipped artifact) |
| **`_network-e2e.yml`** | `ref`, `aztec_node_url` (defaults to localhost; future-proofs remote-network runs) | `SPONSORED_FPC_SALT` | `pr-network-e2e.yml`, `release.yml` (stable-channel gate) |

Each reusable owns:

- Its own `runs-on` and `timeout-minutes` sizing.
- Its own `concurrency` group when needed (e.g. network e2e cancels in-progress; quality-quick does not).
- Its own failure-artifact uploads (vitest logs, build outputs, captured subprocess streams).
- A single job named after the workflow so the check name reads naturally (e.g. `pr-quick / quality-quick`).

This matches accelerator's `_e2e-app.yml` (parameterized `test_script` + `aztec_node_url` + optional `SPONSORED_FPC_SALT` secret) shape verbatim. The result is that `pr-quick.yml` is ~40 lines of orchestration — a `detect` job, four `uses: ./.github/workflows/_*.yml` calls, and a `status` aggregator. Readability scales with the surface, not against it.

### 4.3 Top-level workflows

Once §4.2 is in place, the top-level workflows are thin:

- **`pr-quick.yml`** — detect + commitlint inline + 4 reusable calls (quality-quick, build-extension, smoke-e2e, optional network-e2e via filter) + status aggregator.
- **`pr-network-e2e.yml`** — detect + one reusable call (network-e2e) + status.
- **`actionlint.yml`** — standalone, no reusable needed (single job).
- **`release.yml`** — validate + reusable calls in sequence (quality-quick, network-e2e on stable, build-extension with `version_override`, smoke-e2e against zipped artifact) + publish step + marketplace stubs.

---

## 5. Versioning + changelog **[R — composed stack after research expansion]**

### 5.1 Tooling decision: `release-it` (orchestrator) + `git-cliff` (notes) + `gh release create` (transport)

After both audits agreed weakly on `git-cliff` and Alejo pushed back to widen the search, codex did a deeper landscape review (`implementations-plan/ci-cd/changelog-tooling-research.md`). The reframe: **this is a release-orchestrator question, not a changelog-generator question.** Top tools evaluated:

| Tool | Stars | Verdict |
|---|---|---|
| **`release-it`** | 8.9k | **Chosen as orchestrator.** Built for `workflow_dispatch` + explicit version. `--no-increment` for clean rerun after partial failure. JS, runs under Bun. |
| **`git-cliff`** | 11.8k | **Chosen as notes engine.** Rust binary (zero install via `orhun/git-cliff-action@v4`), deepest template control, deterministic output. Pairs perfectly with release-it. |
| `release-please` | 6.9k | Quality is high, but PR-first model is overhead for one-button manual release. |
| `semantic-release` | 23.7k | "No human in the release" model is anti-our-model. |
| `auto` (intuit) | 2.4k | Has the cleanest CWS plugin, but PR-label-driven release flow doesn't match our shape. |
| `changesets` | 11.8k | Multi-package overkill; contributor changeset files are overhead for one shipped artifact. |
| `changelogen` | 1.2k | Fine for v1 simplicity. Less template control than git-cliff. Lower activity. |
| `knope` | 169 | Promising but small ecosystem signal. Defer until v2. |

Real-world wallet/extension signals codex pulled:
- **MetaMask Extension + Mobile** use custom `MetaMask/action-create-release-pr` — they trust no off-the-shelf orchestrator. We don't have the budget for custom.
- **Rabby** has custom build automation; no off-the-shelf release tool.
- **Rainbow** uses `release-it`, but only inside a *subpackage*. Validates release-it for component-scoped release flows.

### 5.2 Why composed > monolithic

- **One coordinator**: `release-it` owns version bump + tag + push + GH release in a recoverable orchestration. `--no-increment` lets us re-run after partial failure.
- **One note generator**: `git-cliff` renders release-quality markdown from Conventional Commits with deterministic templates. Output is wallet-grade and reviewable.
- **One transport**: `gh release create` (used internally by release-it's GitHub plugin, but we can also invoke directly for clarity).
- **Marketplace stays separate** — no release tool has trusted first-party CWS/AMO integration. We wire `chrome-webstore-upload-cli` + `web-ext` as separate `after:release` hooks in release-it OR as separate jobs in `release.yml`.

### 5.3 Convention

- Version is given **explicitly** as a `workflow_dispatch` input. No commit-driven auto-bump.
- Only `packages/extension/package.json` is bumped. Internal `0.1.0` packages stay frozen.
- Tag format: `v<X.Y.Z>`. Prerelease: `v<X.Y.Z>-rc.<N>`. Manifest normalization in §3.3 step 3 handles Chrome-legal mapping.
- Manifest version normalization stays in `packages/extension/manifest/manifest.config.ts` — codex correctly flagged it as a **product build concern, not a release-tool concern.**

### 5.4 Changelog file **[R]**

- **Only** `packages/extension/CHANGELOG.md`. Repo root README links to it.

### 5.5 Release workflow body (sketch)

```bash
# 1. Generate release notes (deterministic, reviewable)
git-cliff --tag "v$VERSION" --unreleased --strip header > /tmp/release-notes.md

# 2. Orchestrate bump + tag + push + GH release
release-it "$VERSION" --ci \
  --no-npm \
  --github.releaseNotes="$(cat /tmp/release-notes.md)" \
  --github.assets="dist/nulo-chrome-$VERSION.zip,dist/nulo-firefox-$VERSION.zip,dist/SHASUMS256.txt" \
  ${CHANNEL_IS_PRERELEASE:+--github.preRelease}
```

Configuration lives in `.release-it.json` at repo root; `cliff.toml` at repo root for git-cliff.

---

## 6. Commit + pre-push gates

The local hooks already exist (`.githooks/pre-commit` = `biome check --staged`; `.githooks/commit-msg` = `commitlint --edit`). They auto-install via `prepare` in root `package.json`. We **keep them**.

We do **not** add a pre-push hook. The PR check is the same lint+typecheck+units, server-side. Adding pre-push doubles the work locally and slows iteration. We rely on:

- The pre-commit `biome check --staged` (fast, focused).
- The commit-msg commitlint check (instant).
- The server-side `pr-quick.yml` for the rest.

If we later want a pre-push fast-fail: a single `bun run check:fast` wrapper that runs `biome check` + `typecheck:all` would be the right shape, but is out of scope here.

---

## 7. Secrets register

Created up front via `gh secret set --repo alejoamiras/nulo`:

| Secret | Used by | Phase |
|---|---|---|
| (none — all current workflows run on `GITHUB_TOKEN` only) | pr-quick, pr-network-e2e, actionlint, release | 1 |
| `CWS_CLIENT_ID` | `release.yml` → publish-chrome-store stub | future |
| `CWS_CLIENT_SECRET` | same | future |
| `CWS_REFRESH_TOKEN` | same | future |
| `CWS_EXTENSION_ID` | same | future |
| `AMO_JWT_ISSUER` | `release.yml` → publish-firefox-amo stub | future |
| `AMO_JWT_SECRET` | same | future |
| `SPONSORED_FPC_SALT` | network e2e if we ever point at a non-localhost Aztec node | optional |

No npm token required (no public publishing).

---

## 8. Phase plan **[R]** (re-sequenced after audit)

Each phase ends with a **green CI run on a real PR** before the next phase starts. Iterative validation per Alejo's memory rule.

### Phase 0a — rename + dev branch (≈15 min)

- `git branch -m master main` locally; push; `gh repo edit --default-branch main`.
- Create `dev` branch from `main`.
- Update `biome.json` `vcs.defaultBranch` `master` → `main`. Update README + CLAUDE.md references.
- Scan for stragglers: `rg -nF master packages/ tests/ scripts/ implementations-plan/` and update.
- **Stop here**. Verify a fresh clone has `main` as default.

### Phase 0b — labels + CODEOWNERS (≈10 min)

- Create only the labels we will consume: `e2e:network`, `skip:smoke-e2e`. **No `release:*`, no `area:*`** (audit-reconciled, §1.4).
- Add `.github/CODEOWNERS` with `@alejoamiras` as catch-all.

### Phase 1 — bootstrap workflows (≈2 h)

- Add composite actions: `setup-bun`, `setup-aztec`, `setup-puppeteer`.
- Add `actionlint.yml` (standalone, the only place actionlint lives — §3.4).
- Add `pr-quick.yml` (detect + commitlint + lint + status; no typecheck/units/build/smoke yet).
- Open a throwaway docs PR to `dev`. Confirm `pr-quick` runs green.
- **Validate**: introduce a deliberate workflow YAML syntax error in a follow-up PR; confirm `actionlint.yml` catches it.

### Phase 2 — typecheck + units + build + smoke e2e (≈3 h)

- Extend `pr-quick.yml`: `typecheck` job (one job, `bun run typecheck:all`); `unit-tests` job (one job, `bun run test:all`); `build-extension` job; `smoke-e2e` job depending on `build-extension`.
- **Required prerequisite [R-Codex#7]**: extend `tests/e2e/global-setup-smoke.ts` to accept an `EXTENSION_PATH` env var (override of the current hardcoded `../../dist/chrome`). Needed by release smoke in Phase 4.
- Open a PR that touches `wallet-core` to verify upstream-change propagation. Open a docs-only PR to verify the typecheck job runs (fast) but smoke skips.
- **Validate**: kill a unit test in `wallet-crypto`, confirm the workflow fails and `status` aggregates to red.

### Phase 3a — quarantine the 18 known failures (≈1 h, gates day 1 hardness)

- Apply `describe.skip` at file level on `transfers.test.ts`, `fee-methods.test.ts`, `token-management.test.ts`, `data-registerSender.test.ts`.
- Apply `test.skip` on the 3 specific failing cases in `contacts-sender.test.ts`.
- Each skip carries a comment of the form `SKIP: cluster <X>. See implementations-plan/network-test-triage/plan.md — un-skip on cluster fix.`
- **Validate locally** *before* CI wiring: `bun run e2e:agent` exits clean with the skips in place and N tests reported as skipped.

### Phase 3b — network e2e workflow wiring (≈2 h)

- Add `_network-e2e.yml` reusable workflow (§4.2 shape: inputs `ref`, `aztec_node_url`; optional secret `SPONSORED_FPC_SALT`; ubuntu-latest, 45 min timeout, failure-artifact upload).
- Add `pr-network-e2e.yml` using `pull_request` (NOT `pull_request_target`) with the label + base-branch + filter logic from §3.2. `permissions: { contents: read, pull-requests: read }`.
- First run: `workflow_dispatch` on a known-green ref to shake out cache + setup behavior.
- Dial in the Aztec CLI install cache: warm hit on second run.
- **Validate**: open a PR to `dev` touching `packages/extension/src/wallet/services/network/**`; confirm auto-trigger via filter.
- **Validate**: open an unrelated PR; add `e2e:network` label; confirm it triggers.

### Phase 4a — release dry-run (≈2 h)

- Add `release.yml` with `dry_run: true` *default-on for first runs*.
- Run `dry_run=true` against `dev` with version `0.14.10-rc.0`. **No tag, no branch push, no release** — only workflow run artifacts containing the zips (per the rewritten §3.3 step 7).
- Inspect the workflow's manifest version output to **confirm the S1 fix** (`0.14.10-rc.0` → manifest `0.14.10.0`).
- Run a stable-channel dry-run from `main` with `0.14.10-rc.0` and confirm validate step rejects it (channel/branch mismatch).

### Phase 4b — first real prerelease (≈30 min)

- **Only after Phase 4a's manifest output is verified Chrome-legal** [R-S1].
- `dry_run=false` from `dev` with `0.14.10-rc.1`. Expect: GH prerelease appears, both zips attached, `CHANGELOG.md` updated on a `release/v0.14.10-rc.1` branch, tag pushed.
- **Validate**: download the chrome zip, load it as unpacked in Chrome, register a profile, confirm `version_name` shows `0.14.10-rc.1`.

### Phase 5 — new gates + docs + go public (≈1.5 h)

- ~~Add `dependabot.yml`~~ **[DEFERRED]** — Alejo handles dep bumps manually for now.
- Add the three audit-recommended gates (new — §3.7 above):
  1. Manifest policy snapshot test (asserts CSP + permissions match a checked-in fixture).
  2. Manifest version monotonicity + Chrome-legal regex check (script invoked from `pr-quick.yml` when the extension filter trips).
  3. Bundle size budget (`du -sb dist/chrome` against a 25 MB ceiling).
- Update `CLAUDE.md` Quality gates section. Add `.github/PULL_REQUEST_TEMPLATE.md`. Add `.github/README.md` describing the status matrix.
- **[NEW — Q1=A]**: secret-sweep and visibility flip.
  1. Run `gitleaks detect --source . --no-banner` (or equivalent) to confirm no secrets are committed in history.
  2. Manually skim `implementations-plan/**/*.md` for anything not appropriate to publish.
  3. Confirm `LICENSE.md` + `SECURITY.md` are present and current.
  4. `gh repo edit alejoamiras/nulo --visibility public --accept-visibility-change-consequences`.
  5. Configure branch protection on `main`:
     - Required status checks: `pr-quick / status`, `pr-network-e2e / status`.
     - Block force-pushes, deletion. Require linear history.
  6. Configure branch protection on `dev`:
     - Required status check: `pr-quick / status`. Block force-pushes, deletion.
  7. Verify enforcement: open a deliberately-red PR; confirm GitHub greys out the merge button.

### Phase 6 — marketplace stubs + cleanup (≈30 min)

- Confirm the `if: false` stubs in `release.yml` lint clean.
- Deprecate the human `chore: bump extension to X.Y.Z` commits in CLAUDE.md.

---

## 9. Tests + validation per phase

| Phase | Validation method | Pass criteria |
|---|---|---|
| 0 | `gh repo view`, `git ls-remote --heads` | `main` default, `dev` exists, labels visible |
| 1 | docs-only PR, intentionally-broken workflow PR | actionlint catches workflow break; commitlint catches a bad commit subject |
| 2 | targeted-broken unit test in `wallet-crypto`; docs-only PR | only `wallet-crypto`'s job fails; docs PR's matrix mostly skips |
| 3 | `workflow_dispatch` run on green ref; PR touching network code; PR with `e2e:network` label | network suite triggers correctly in all three modes; expected pass-rate matches local (46/66) |
| 4 | `release.yml dry_run=true`; real prerelease | draft + then real prerelease appears with correct assets + changelog body |
| 5 | open a deliberate-red PR after enabling protection; verify GitHub greys out the merge button | enforcement works |
| 6 | inspect `release.yml` with actionlint | stubs lint clean with `if: false` |

Existing tests that must continue to pass:

- `bun run audit:vue` (typecheck + units + lint + build) — this is now mostly redundant with CI but stays as the local one-shot gate.
- `bun run test:e2e` (smoke) — `pr-quick.yml`'s smoke-e2e job is this same script.
- `bun run e2e:agent` (network) — `pr-network-e2e.yml` runs this same script unchanged. The 46/66 baseline must hold.

Tests to add (in repo, not CI):

- `scripts/check-versioning.ts` — asserts that `packages/extension/manifest/manifest.config.ts` derives version from `package.json` (already does — this just pins the invariant).
- One new smoke e2e (`tests/e2e/release-artifact.test.ts`) that runs against a passed-in `EXTENSION_PATH` env var. Used by phase 6 release smoke. Equivalent to existing smoke tests but parameterized on path.

---

## 10. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Branch protection unavailable on free private repo | Confirmed | Q1 resolved: Phase 5 flips repo to public after a secrets sweep, then configures protection on `main` + `dev`. |
| Network e2e 18 known failures keep us in `continue-on-error` mode forever | Medium | Phase 3 exit criteria includes a *date or count* for flipping the flag — set to "≤6 known failures" not a date |
| Aztec CLI install caching is fragile (large download) | Medium | Cache key by version; mirror accelerator's working pattern; consider mirroring the install tarball to S3 later |
| Firefox extension signing requires AMO account + gecko ID | Medium | Stubbed; gecko ID `{}` must be replaced before AMO submission |
| Headless puppeteer Chrome on ubuntu runners flaky | Low | Use the same anti-throttle flags the local smoke suite already uses (see `e2e/README.md` § Helper conventions) |
| Release workflow opens a PR using `GITHUB_TOKEN` which can't trigger other workflows | High | Either use a PAT (`PAT_TOKEN` secret as accelerator does) for the post-release bump PR, or accept that the bump PR's own CI doesn't run (the bump itself is trivial — version + changelog) |
| Manual `chore: bump extension to ...` commits clash with automated bumps | High | Phase 6 documents the deprecation; existing pattern is replaced |
| `pull_request_target` for label-triggered workflows is a known security risk if you check out the PR's code | High | Documented: the label-triggered job checks out the *target branch's* workflow code but builds the PR head. Or: simpler, only allow label-trigger on PRs from non-forks. Since we're private, no fork risk today. |

---

## 11. Open questions — **all resolved**

| Question | Resolution |
|---|---|
| Q1 — Branch protection path | **A. Make repo public.** Unlocks free branch protection; sweep for secrets + sensitive plan markdown before flipping. |
| Q2 — Network e2e quarantine encoding | Resolved by user pushback: **co-located `describe.skip` / `test.skip`** in the test files, no allow-list infra. Network suite is a hard gate from day 1. |
| Q3 — Release tooling | After expanded research: **`release-it` (orchestrator) + `git-cliff` (notes) + `gh release create` (transport)**. Composed stack, recoverable per-step, marketplace publishing stays as separate composable jobs. |
| Reusable workflow naming | **Option A — split** `_lint-and-typecheck.yml` + `_unit-tests.yml`. Sharper feedback loop (lint failures show up in 30 s without waiting for units). |
| Single CHANGELOG location | `packages/extension/CHANGELOG.md` only. |
| Tag prefix | `v<X.Y.Z>`. |
| Release workflow access | `environment: production` gate. |
| Promote-to-main PR after release | Skip. |
| Smoke on `release/*` branches | Covered by `release.yml` post-build smoke once `EXTENSION_PATH` override lands. |
| Aztec version bump workflow | Defer. |

---

## 12. Out of scope (explicit non-goals)

- Auto-publishing to Chrome Web Store and Firefox AMO (stubbed only).
- Auto-deploying the landing page (accelerator does this — we defer).
- Multi-package independent versioning (changesets-style).
- A Slack/Discord notification on release (easy to bolt on later).
- Coverage reporting / codecov integration.
- Performance / bundle-size regression checks (worth adding; not for the first cut).
- Storybook visual regression (chromatic) — `bun run build-storybook` lands but no upload yet.
- Browser cross-version matrix testing (we test latest stable Chrome only).
- Per-PR preview deploys of the landing page.

---

## 13. Files we will add / change **[R-User pushback]** (final shape)

```
.github/
  workflows/
    # Top-level (thin orchestration; each calls reusables below)
    pr-quick.yml                 (new — detect + commitlint + 3 reusables + status)
    pr-network-e2e.yml           (new — detect + _network-e2e + status; pull_request trigger)
    actionlint.yml               (new — standalone)
    release.yml                  (new — workflow_dispatch only, environment: production)
    # Reusable workflows (each parameterized + at least 2 callers — §4.2)
    _lint-and-typecheck.yml      (new — biome + bun run typecheck:all)
    _unit-tests.yml              (new — bun run test:all)
    _build-extension.yml         (new — chrome + firefox build with version_override; runs check-manifest-policy + check-bundle-size)
    _smoke-e2e.yml               (new — chrome build + puppeteer smoke against EXTENSION_PATH input)
    _network-e2e.yml             (new — Aztec sandbox + agent run + failure-artifact capture; SPONSORED_FPC_SALT optional secret)
  actions/
    setup-bun/action.yml         (new, composite — checkout + bun + cache + install)
    setup-aztec/action.yml       (new, composite — Foundry + Aztec CLI by detected version)
    setup-puppeteer/action.yml   (new, composite — ~/.cache/puppeteer warm cache)
  CODEOWNERS                     (new)
  PULL_REQUEST_TEMPLATE.md       (new)
  # dependabot.yml             (DEFERRED — Alejo handles manually)
  README.md                      (new — explains the gate matrix + which reusable runs when)
biome.json                       (edit: vcs.defaultBranch master → main)
README.md                        (edit: master → main; add CI badge)
CLAUDE.md                        (edit: master → main; expand Quality gates section; deprecate human bump commits)
.release-it.json                 (new — release-it config: orchestrator)
cliff.toml                       (new — git-cliff config: release-note templating)
packages/extension/CHANGELOG.md  (new — initialized on first release)
packages/extension/manifest/manifest.config.ts        (edit: regex fix for prerelease versions [R-S1])
packages/extension/tests/e2e/global-setup-smoke.ts    (edit: accept EXTENSION_PATH env var [R-Codex])
packages/extension/tests/e2e/network/transfers.test.ts        (edit: describe.skip — cluster A)
packages/extension/tests/e2e/network/fee-methods.test.ts      (edit: describe.skip — clusters A+B)
packages/extension/tests/e2e/network/token-management.test.ts (edit: describe.skip — cluster A)
packages/extension/tests/e2e/network/data-registerSender.test.ts (edit: describe.skip — cluster E)
packages/extension/tests/e2e/network/contacts-sender.test.ts  (edit: test.skip × 3 — clusters C+D)
packages/extension/scripts/ci/check-manifest-policy.ts        (new — snapshot test for CSP + permissions)
packages/extension/scripts/ci/check-bundle-size.ts            (new — 25 MB ceiling check)
implementations-plan/ci-cd/
  plan.md                        (this file)
  audit-prompt.md                (the auditor brief)
  audit-codex.md                 (codex's audit response — first pass)
  audit-opus.md                  (opus 4.7's audit response)
  changelog-tooling-research.md  (codex's second pass — release-tool landscape)
  status.md                      (rolling status per phase — added by Phase 0a)
```

**Removed from earlier drafts:**
- ~~`run-network-e2e/action.yml`~~ — promoted back to `_network-e2e.yml` reusable workflow (per user pushback; matches accelerator's `_e2e-app.yml` pattern).
- ~~`.known-failures.txt`~~ — replaced by co-located `describe.skip` / `test.skip` in the test files.
- ~~`parse-network-e2e-results.ts`~~ — no allow-list = no post-processor needed.

That's the full bring-up. Implementation starts after Alejo signs off on the remaining open questions in §11.
