# CI guide

Contributor-facing reference for what runs when, how to opt in to slow gates, how to release, and how to debug a failing PR. The implementation details (workflow YAMLs, composite actions, reusables) live in [`.github/`](./.github/); the design rationale + audits live in [`implementations-plan/ci-cd/`](./implementations-plan/ci-cd/).

## Branch model

- **`main`** — stable. Hot off this branch is the version we'd ship to users.
- **`dev`** — integration trunk. Day-to-day PRs land here.
- **Feature branches** (`feat/...`, `fix/...`, `docs/...`, `chore/...`) — short-lived, PR'd into `dev`. Auto-deleted on merge.
- **No long-lived feature branches.** A `dev → main` PR is the "promote to stable" step.

## What runs when

| Trigger | Workflow(s) | Wall time |
|---|---|---|
| Push to a feature branch (no PR) | local pre-commit hook only (biome + commitlint) | <1 s |
| Open / sync PR to `dev` | `pr-quick` always; `pr-smoke-e2e` + `pr-network-e2e` when their filters trip or their label is set | 3–10 min (`pr-quick`); +5–10 min each if smoke / network triggers |
| Open / sync PR to `main` | all three workflows above run unconditionally | 15–25 min total |
| Add the `e2e:smoke` or `e2e:network` label | the corresponding workflow runs (removing the label re-evaluates) | as above |
| Push to `main` | `release.yml` (release-please opens or updates a Release PR; merging it tags + creates the GitHub Release + attaches built artifacts) | 1–2 min for the PR refresh; 15–25 min for the publish run after merge |
| Click "Run workflow" on `release.yml` | re-publish artifacts for an existing tag (escape hatch) | 15–25 min |

### `pr-quick.yml`

Always runs on every PR. Lightweight gates:

- `commitlint` — every commit + the PR title must follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, etc.; lower-case subject).
- `lint-and-typecheck` — biome over the repo + `bun run typecheck:all` (vue-tsc across all packages).
- `unit-tests` — `bun run test:all` (vitest across all workspaces; `--if-present` skips `playground` + `landing`).
- `build-extension` — chrome + firefox builds.

The `Quality / Status` aggregator at the end is the required check on `main` / `dev` branch protection.

### `pr-smoke-e2e.yml`

Runs the smoke e2e suite (`vitest.e2e.config.ts`, 18 files / 67 tests, 7 currently quarantined for known flakes). No Aztec sandbox; just puppeteer driving the popup UI.

Triggers:
- **Always** on PRs to `main`
- **Auto** on PRs to `dev` whose diff touches the `smoke-surface` paths-filter (popup, components, manifest, the wallet services smoke exercises, build inputs, the harness, etc. — see [`pr-smoke-e2e.yml`](./.github/workflows/pr-smoke-e2e.yml) `filters:`)
- **Manual** by adding the `e2e:smoke` label

`Smoke e2e / Status` emits `pass` when the suite is skipped (no relevant changes / no label), so branch protection sees a green check either way.

### `pr-network-e2e.yml`

Runs the network e2e suite (anvil + Aztec sandbox + playground + the extension build) as a **5-shard parallel matrix** — each shard owns its own sandbox + ~9 of the 45 test files (deterministic SHA-1-of-filename distribution). Wall time ~10–15 min (vs ~35–45 min unsharded). Same trigger shape as `pr-smoke-e2e`, but with the `extension-network` filter (network-touching wallet code, runtime, bridge, playground, etc.) and the `e2e:network` label. See [`packages/extension/tests/e2e/README.md`](./packages/extension/tests/e2e/README.md#ci-sharding-5-way-matrix) for the shard-design rationale + the 2 quarantined slow tests.

#### Accelerator in CI

Each network-e2e shard installs and starts the headless **`accelerator-server`** binary (from the [`alejoamiras/aztec-accelerator`](https://github.com/alejoamiras/aztec-accelerator) repo) before the test agent fires. The wallet build is stamped with `VITE_NULO_ACCELERATOR_REQUIRED=1` so [`chain-runtime.ts`](./packages/aztec-runtime/src/pxe/chain-runtime.ts) constructs `ProductionPxeFactory` in **required-mode** — proving traffic MUST hit accelerator-server natively, never silently fall back to in-browser WASM. Layered enforcement:

- **Layer 1** (workflow) — `/health` preflight gates the run on `bb_available == true`. Server missing or unhealthy → red.
- **Layer 2** (wallet) — `chain-runtime.ts` does an eager `checkAcceleratorStatus()` at PXE creation + installs an `onPhase` callback that throws on `"fallback"` / `"denied"` phases. This is the per-test authority.
- **Layer 3** (workflow, advisory) — post-test step counts `Received /prove request` log lines in `/tmp/accelerator-server.log` and emits a notice + step-summary table. Does NOT gate.

**Production behavior is unchanged.** `VITE_NULO_ACCELERATOR_REQUIRED` is only set in `_network-e2e.yml`. Production builds get the default (`false`) → factory constructed without `onPhase` callback or preflight → SDK's silent WASM fallback path is preserved for end users without **Aztec Accelerator** (the desktop app) installed.

**Rollback flags** (both require repo write access; PR authors cannot toggle):
- `vars.NULO_E2E_DISABLE_ACCELERATOR=1` (Settings → Variables) — the emergency kill switch, affects all PR + dispatch runs until cleared.
- `workflow_dispatch` input `disable_accelerator: true` — single-run override for investigation.

**Bumping accelerator-server**: update `version` + `expected_sha256` in `.github/workflows/_network-e2e.yml`'s `setup-accelerator-server` step together. SHA-256 must be computed locally (`shasum -a 256` on a freshly downloaded tarball); the `.sha256` sidecar from the same release is a sanity check, not a security boundary. See [SECURITY.md](./SECURITY.md#binary-dependencies).

### `actionlint.yml`

Runs when any `.github/workflows/**`, `.github/actions/**`, or shell script changes. Lints the workflow YAML and shellchecks the scripts. Cheap; gate.

### `release.yml`

Two triggers in one workflow:

- **`push` to `main`** — runs `googleapis/release-please-action@v4`. release-please scans Conventional Commits since the last tag and opens or updates a Release PR titled `chore: release X.Y.Z`. The PR bumps `package.json` + appends to `CHANGELOG.md` + updates `.release-please-manifest.json`. The PR's commits are app-authenticated (verified) via `actions/create-github-app-token@v1` using the `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY` secrets. When the Release PR is merged, the next push-to-main run sees `release_created=true` and the same workflow continues: gates → build chrome + firefox → smoke against the zipped artifact → `attach-assets` (zip + SHASUMS + `gh release upload --clobber` + `gh release edit --notes-file` with git-cliff body) → Cloudflare Pages deploy hook → marketplace stubs (gated).

- **`workflow_dispatch`** — re-publish artifacts for an existing tag. Takes `tag` (e.g. `v0.20.0`), `dry_run` (default false), `run_network_e2e` (default true), and `publish_marketplaces` (default false). Skips `release-please`; runs `resolve` → gates → build → smoke → `attach-assets`. Useful when an asset upload failed mid-publish.

Marketplace publish (CWS + AMO) is stubbed until secrets are wired (`CWS_*` + `AMO_JWT_*`).

Config files: `.github/release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`. The git-cliff template at `cliff.toml` provides the final release-body content.

## Labels

| Label | Effect |
|---|---|
| `e2e:smoke` | Force-run smoke e2e on this PR. |
| `e2e:network` | Force-run network e2e on this PR. |

Adding the label triggers a fresh run; removing it re-evaluates the gate (so a stale failing check goes green if the filter doesn't trip).

## Local equivalents

Everything CI runs has a local equivalent:

| CI gate | Local command |
|---|---|
| lint | `bun run lint` |
| typecheck | `bun run typecheck:all` |
| unit tests | `bun run test:all` |
| build (chrome) | `bun run --cwd packages/extension build:chrome` |
| build (firefox) | `bun run --cwd packages/extension build:firefox` |
| smoke e2e | `bun run --cwd packages/extension test:e2e` |
| network e2e | `bun run e2e:agent` (NOTE: local runs do NOT use `accelerator-server`. The wallet's `AcceleratorProver` auto-detects the **Aztec Accelerator** desktop app on `127.0.0.1:59833` and uses it if available; otherwise WASM. CI specifically stamps `VITE_NULO_ACCELERATOR_REQUIRED=1` to enforce no-fallback — that's not set locally.) |
| one-shot pre-PR | `bun run audit:vue` (typecheck + units + lint + build) |

## Releasing

Releases are driven by `release-please`. The human touchpoint is a single click — merging the Release PR.

1. Confirm what you want to ship is on `main` (via the usual `release: promote dev → main` PR).
2. Wait for `release.yml` to run on the push to main. It opens (or updates) a Release PR titled `chore: release X.Y.Z`. The version comes from Conventional Commits since the last tag.
3. Review the Release PR. CI runs the normal `Quality / Status` check. Eyeball the proposed `CHANGELOG.md` diff + `package.json` bumps.
4. Merge the Release PR via the GitHub UI (merge commit).
5. The next push-to-main run of `release.yml` sees the release was created. The same workflow run continues: gates → build chrome + firefox → smoke → `attach-assets` (uploads zips + SHASUMS, overlays git-cliff release notes onto the GitHub Release body) → Cloudflare deploy hook.

Tag format is `v<X.Y.Z>` (forced by `include-v-in-tag: true` + `include-component-in-tag: false` in `.github/release-please-config.json`). Prerelease support (e.g. `v<X.Y.Z>-rc.<N>` from `dev`) is deferred to a follow-up PR.

### Forcing the next-version

release-please picks the next version from Conventional Commit types: `feat:` → minor, `fix:` → patch, `BREAKING CHANGE:` (in the body or footer) → major. To force a specific version mid-flight, add a `Release-As: X.Y.Z` footer to any commit on `main`.

### Re-publishing assets for an existing tag

If a release was tagged but the asset upload failed (e.g. transient `gh release upload` error), use the `workflow_dispatch` escape hatch:

1. GitHub Actions tab → `release.yml` → "Run workflow".
2. Fill in:
   - `tag` — e.g. `v0.20.0`. Required.
   - `dry_run` — leave **false** to actually upload; `true` previews without changing the release.
   - `run_network_e2e` — leave **true** in most cases. Disable only for emergency re-publishes where the network gate is known-good.
   - `publish_marketplaces` — leave **false** until the CWS + AMO secrets are wired.
3. The workflow skips `release-please`, fetches the tag, and re-runs gates → build → smoke → `attach-assets`. The Cloudflare hook is **skipped** on manual re-publishes (only fires on the original push-to-main release).

## Debugging a failing PR

1. Click the failing check in the PR conversation. The `status` aggregator job's first error line points at the underlying job.
2. Open the underlying job's log. Failures are surfaced via `::error::` annotations and tend to surface as a single line.
3. Match against the workflow source (`.github/workflows/...`) to confirm what step ran.
4. Re-run the failing job from the GitHub UI ("Re-run failed jobs") if you suspect a transient flake.

For smoke / network e2e specifically: failure artifacts (vitest output, `.e2e-state/`, sandbox logs) upload on failure. Download them from the run page's "Artifacts" section.

## Adding a new gate

1. If the gate is a single shell step, add it to an existing workflow's job.
2. If the gate is a whole job with its own runner / timeout / failure-artifact policy, create a reusable workflow at `.github/workflows/_<gate-name>.yml` and call it from the relevant top-level workflow(s).
3. Add it to the `status` aggregator's `needs:` list so failures propagate.
4. Update this file's "What runs when" matrix.

The reusables today are:
- `_lint-and-typecheck.yml` — biome + typecheck
- `_unit-tests.yml` — vitest workspace-wide
- `_build-extension.yml` — chrome + firefox (with optional version override)
- `_smoke-e2e.yml` — puppeteer smoke against `EXTENSION_PATH` or downloaded artifact
- `_network-e2e.yml` — Aztec sandbox + agent runner

Composite actions (step-level reuse):
- `setup-bun` — checkout + bun + lockfile cache + `bun install --frozen-lockfile`
- `setup-aztec` — Foundry + Aztec CLI matching the declared version, cached
- `setup-puppeteer` — `~/.cache/puppeteer` cache

## Known limitations

- **Smoke e2e is currently advisory on `main`** (not a required check) until the fixture-cleanup follow-up PR hardens cross-file Chrome teardown. See [`implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md`](./implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md) §5 for the deferral rationale.
- **Network e2e has 18 quarantined tests** via co-located `test.skip` / `describe.skip`. See [`implementations-plan/network-test-triage/plan.md`](./implementations-plan/network-test-triage/plan.md) for the cluster grid + un-skip criteria.
- **Marketplace publishing (Chrome Web Store, Firefox AMO)** is stubbed in `release.yml`. Enabling it requires wiring `CWS_*` + `AMO_JWT_*` secrets and replacing the Firefox `gecko.id` placeholder.

## See also

- [`.github/README.md`](./.github/README.md) — quick reference for the workflows + labels
- [`implementations-plan/ci-cd/plan.md`](./implementations-plan/ci-cd/plan.md) — original design + audits
- [`implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md`](./implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md) — smoke gating + branch cleanup design
- [`CLAUDE.md`](./CLAUDE.md) §"Quality gates" — what the AI assistants should know about gates
