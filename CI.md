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
| Open / sync PR to `dev` | `pr-quick` always; `pr-extension-smoke-e2e` + `pr-extension-network-e2e` when their filters trip or their label is set | 3–10 min (`pr-quick`); +5–10 min each if smoke / network triggers |
| Open / sync PR to `main` | all three workflows above run unconditionally | 15–25 min total |
| PR touching `contracts/bridge/**` | `bridge-contracts` (`bridge-contracts-status`, advisory today) | 5–10 min |
| PR touching the tools graph (`apps/tools/**`, the bridge contracts, `packages/bridge-core/**`, its dep libs) or labeled `e2e:tools` | `pr-tools-e2e` (`tools-e2e-status`, advisory today): 6 shards, each on its own sandbox | 15–25 min |
| Add the `e2e:extension-smoke` or `e2e:extension-network` label | the corresponding workflow runs (removing the label re-evaluates) | as above |
| Push to `main` | `release.yml` (release-please opens or updates a Release PR; merging it tags + creates the GitHub Release + attaches built artifacts) | 1–2 min for the PR refresh; 15–25 min for the publish run after merge |
| Click "Run workflow" on `release.yml` | re-publish artifacts for an existing tag (escape hatch) | 15–25 min |

### `pr-quick.yml`

Always runs on every PR. Lightweight gates:

- `commitlint` — Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, …; lower-case subject, 100-char header cap). On PRs to `dev`: every commit in `base..head`. On PRs to `main`: **skipped** — the promote PR's merge subject is an intentional non-conventional release-note line (`release: promote dev → main …`, > 100 chars, no `release` type by design), the bot Release PR (`chore(main): release X.Y.Z`) is reliably conventional anyway, and the dev squash subjects in the range are already-merged + immutable (re-linting them spuriously failed required `Quality` on long historical subjects).
- `lint-and-typecheck` — biome over the repo + `bun run typecheck:all` (vue-tsc across all packages).
- `unit-tests` — `bun run test:all` (vitest across all workspaces; `--if-present` skips only `playground`, which has no `test` script — `landing` has one and runs). Every workspace `test` script is `bun --bun vitest run`, so the suites execute on the pinned Bun (`setup-bun`), not on the runner image's ambient Node; the Puppeteer e2e jobs still run vitest under Node.
- `build-extension` — chrome + firefox builds, uploaded as the `extension-chrome` / `extension-firefox` artifacts (7-day retention) with the version stamped `X.Y.Z-pr.<N>` (`version_suffix`). The advisory `preview-comment` job keeps ONE sticky comment on the PR linking to them, edited in place on every push (a run whose head the PR has since moved past leaves the comment alone, so a slow run never overwrites a newer one) — download, unzip, **Load unpacked**. Same-repo PRs only; `continue-on-error` and not in `quality-status`'s `needs`, so it can red neither the run nor the gate. Logic in `scripts/ci-cd/preview-comment.ts`.

The `quality-status` aggregator at the end is the required check on `main` / `dev` branch protection (the bare job/check-run name; the old required context `Quality / Status` was a phantom that never matched a produced check — see [CLAUDE.md § Branching](./CLAUDE.md#branching--merging) and `implementations-plan/required-check-mismatch/`).

### `pr-extension-smoke-e2e.yml`

Runs the smoke e2e suite (`vitest.e2e.config.ts`, 18 files / 67 tests, 7 currently quarantined for known flakes). No Aztec sandbox; just puppeteer driving the popup UI.

Triggers:
- **Always** on PRs to `main`
- **Auto** on PRs to `dev` whose diff touches the `smoke-surface` paths-filter (popup, components, manifest, the wallet services smoke exercises, build inputs, the harness, etc. — see [`pr-extension-smoke-e2e.yml`](./.github/workflows/pr-extension-smoke-e2e.yml) `filters:`)
- **Manual** by adding the `e2e:extension-smoke` label

`extension-smoke-e2e-status` emits `pass` when the suite is skipped (no relevant changes / no label), so branch protection sees a green check either way. It is a **required** check on both `dev` and `main` once each branch's cut-over has run (see "Check names and the protection runbook"). `dev` was cut over on 2026-09-09; **`main`'s cut-over is still pending** and must run right before the next promote merges — until then `main` requires the legacy `smoke-e2e-status`, which nothing produces.

### `pr-extension-network-e2e.yml`

Runs the network e2e suite (anvil + Aztec sandbox + playground + the extension build) as a **5-shard parallel matrix** — each shard owns its own sandbox + ~9 of the 45 test files (deterministic SHA-1-of-filename distribution). Wall time ~10–15 min (vs ~35–45 min unsharded). Same trigger shape as `pr-extension-smoke-e2e`, but with the `extension-network` filter (network-touching wallet code, runtime, bridge, playground, etc.) and the `e2e:extension-network` label. See [`apps/extension/tests/e2e/README.md`](./apps/extension/tests/e2e/README.md#ci-sharding-5-way-matrix) for the shard-design rationale + the 2 quarantined slow tests.

#### Presto in CI

Each prover-ON network-e2e lane installs and starts the headless **`presto-server`** binary (from the [`alejoamiras/presto`](https://github.com/alejoamiras/presto) repo) before the test agent fires. The wallet build is stamped with `VITE_NULO_PRESTO_REQUIRED=1` so [`chain-runtime.ts`](./packages/aztec-runtime/src/pxe/chain-runtime.ts) constructs `ProductionPxeFactory` in **required-mode** — proving traffic MUST hit presto-server natively, never silently fall back to in-browser WASM. Required mode is also the only place plaintext HTTP is representable: the headless server is HTTP-only, so the factory derives `httpsOnly: false` from the mode; production always passes `httpsOnly: true`. Layered enforcement:

- **Layer 1** (workflow) — `/health` preflight gates the run on `bb_available == true`. Server missing or unhealthy → red.
- **Layer 2** (wallet) — `chain-runtime.ts` does an eager `checkPrestoStatus()` at PXE creation (the error names the SDK's `reason` and, for `secure-connection-unavailable`, its `diagnosis`) + installs an `onPhase` guard that throws on `fallback` / `denied` / `secure-connection-unavailable` / `version-mismatch`. This is the per-test authority.
- **Layer 3** (workflow) — post-test step counts `Received /prove request` and `Proving succeeded` lines in `/tmp/presto-server.log`, prints `PROVE_SUCCESS=<n>` and a step-summary table, and **fails the `canary` lane** when there were zero successful native proofs. On soak/dispatch lanes (`shard_label: soak-N`) it only reports — the in-test assertion in `tx-sendTx-default` (`data-backend="presto"` + the exact subtitle, keyed on the build stamp) is what a prover-ON soak enforces.

**Production behavior.** `VITE_NULO_PRESTO_REQUIRED` is only set in `_extension-network-e2e.yml`, and [`_build-extension.yml`](./.github/workflows/_build-extension.yml) fails a production build whose bundle carries `NULO_PRESTO_REQUIRED_BUILD_STAMP`. Production builds prove over HTTPS only (Presto's desktop app serves `https://127.0.0.1:59834` once its Encrypted Connection setup is done) with the SDK's silent WASM fallback for users without Presto.

**Rollback flags** (both require repo write access; PR authors cannot toggle):
- `vars.NULO_E2E_DISABLE_PRESTO=1` (Settings → Variables) — the emergency kill switch, affects all PR + dispatch runs until cleared.
- `workflow_dispatch` input `disable_presto: true` — single-run override for investigation.

**Origin gate.** The server denies non-localhost browser origins by default, and the wallet proves from `chrome-extension://<id>` — unknowable before Chrome loads the unpacked build — so the start step sets `PRESTO_ALLOW_ALL=1` on the **server process only** (never at job level). Safe on a loopback-only server on a single-tenant, ephemeral runner where fork PRs receive no secrets; never on a self-hosted runner. It bypasses Presto's per-origin approval prompt by design — that path is exercised by the manual Mac check, not CI.

**Release-metadata token.** Before downloading a `bb` version it has not cached, Presto looks up that release asset's published SHA-256 on the GitHub API and refuses to run an unverified prover. Anonymous callers share a 60-request-per-hour budget keyed to the source address, which Actions runners exhaust between themselves; the lookup then fails with `Cannot verify bb v<x>: no digest available from GitHub API` and the shard produces no proofs at all. The start step therefore passes the workflow's own `secrets.GITHUB_TOKEN` to the **server process only**, under a renamed variable so it does not reach the rest of the step. Read access to a public repository's releases is the whole requirement, so the default token is enough and a fork PR's read-only one works too. Presto refuses redirects on that request (`presto` PR #46), so the credential reaches `api.github.com` and nowhere else. A cached version needs no lookup, so this matters on the first run after a `bb` bump or a cold cache. **The token needs `presto-server` ≥ 1.1.2** (the pinned build): 1.1.1 sent the lookup with no `Authorization` header and ignored the variable, so the canary failed intermittently with the message above — each failed proof a failed test. A pin below that line makes the lookup anonymous again. When requests outnumber proofs, the assert step prints the server's WARN/ERROR lines in the job log and the step summary; the full log is in the `network-e2e-logs-<shard>` failure artifact (`e2e-testing` skill, flake ledger #31).

**Coexistence.** Presto and the retired Aztec Accelerator desktop app share the wire protocol on the same port: a still-running Accelerator answers a Presto client and the wallet cannot tell them apart. Quit or uninstall Aztec Accelerator before installing Presto.

**Bumping presto-server**: update `version`, `expected_tarball_sha256` and `expected_sha256` in `.github/workflows/_extension-network-e2e.yml`'s `setup-presto-server` step together. Both hashes are computed locally from the release assets; the `.sha256` sidecar from the same release is a transfer-integrity check, not a security boundary. See [SECURITY.md](./SECURITY.md#binary-dependencies).

#### Proverless network e2e (the two-build split)

Most network-e2e files run against a **proverless** wallet build (`_extension-network-e2e.yml` input `proverless: true` → `NULO_E2E_PROVERLESS=1`): [`chain-runtime.ts`](./packages/aztec-runtime/src/pxe/chain-runtime.ts) sets `proverEnabled:false`, so the PXE skips BB-SNARK generation — kernel simulation + on-chain submission stay real, and the local node accepts the fake `ChonkProof.random()` proof. This makes the shard pool fast and CDP-stable. Presto is forced OFF for proverless jobs (`proverless` ⊥ `VITE_NULO_PRESTO_REQUIRED`).

A few **STUB** tests (`cancel-mid-prove`, `concurrent-sendtx-{approve,confirm}`) need a controllable prove window — proverless prove collapses to sub-second, too fast to observe sequencing/cancel. They run proverless and drive a `ProofGate` (a `chrome.storage.session` barrier, key `nulo:e2e:proof-gate`, injected into the **SW** `ExecutionCoordinator.proveTxTask` — the offscreen document has no `chrome.storage`) to hold the tx at `proving` deterministically, then release.

**Real BB proving stays covered** by the `network-e2e-canary` job (prover-ON, presto-server): `transfers` (wallet UI, waits through real prove → mine) + `tx-sendTx-default` (dApp, waits through real prove → submit — the node validates a real proof at `node.sendTx`; playground hard-codes `wait: "NO_WAIT"` so block-mine isn't awaited).

**Production safety.** `NULO_E2E_PROVERLESS` is a **double-opt-in** build flag (`VITE_NULO_E2E_PROVERLESS` + `VITE_NULO_E2E_PROVERLESS_CONFIRM`; fail-closed throw if exactly one is set). The proverless branch + barrier are dead-code-eliminated from prod (referenced only inside `if (E2E_PROVERLESS)`); [`_build-extension.yml`](./.github/workflows/_build-extension.yml) asserts the build stamp + `nulo:e2e:proof-gate` key are ABSENT from every shipped `dist/{chrome,firefox}`. See [`implementations-plan/e2e-proverless-stub/`](./implementations-plan/e2e-proverless-stub/plan.md).

### `pr-extension-smoke-e2e-firefox.yml` / `pr-extension-network-e2e-firefox.yml`

The two extension suites again, on Firefox. Each is a twin of its Chrome caller — same paths filter (re-pointed at its own file, plus `.github/actions/setup-geckodriver/**`), same labels, same shard / heavy / canary shape — calling the same reusable workflow with `browser: firefox`, which adds [`setup-geckodriver`](./.github/actions/setup-geckodriver/action.yml) (SHA-256-pinned tarball + binary), installs the Firefox revision the locked Puppeteer pins, builds `dist/firefox` and runs the suite with `NULO_E2E_BROWSER=firefox`. Differences from the Chrome callers, all deliberate: **draft PRs skip** (the gate's first test; `ready_for_review` re-runs it), `pull-requests: read` is granted to the `changes` job only, and the canary omits `frozen-account-canary` — one of the ten files that are Chrome-only by capability (they kill the MV3 service worker or arm CDP Fetch; Firefox has neither) and skip whole-file on Firefox. Aggregators: `extension-smoke-e2e-firefox-status`, `extension-network-e2e-firefox-status`, the same exact-state shape.

**Advisory.** Neither is in a required set, and `nightly.yml` / `release.yml` run their Firefox jobs (`network-e2e*-firefox`, `smoke-firefox-against-artifact`) outside every aggregator's and publish step's `needs`. A red advisory job still turns the *run* red — read the `status` job. Advisory is not free: on a PR that trips both filters the two workflows start fifteen more jobs (nine suites, six control) that queue against the required lanes for the same runners, and `release.yml`'s Firefox smoke holds the `release` concurrency slot until it ends (a 20-minute execution timeout; time queued for a runner is on top), so it can delay the *next* release, never fail this one. `scripts/ci-cd/behavior-gating.test.ts` pins the parity with the Chrome lanes (filters, file lists, retry, matrix), the absence of any Firefox job from a `needs`, the `chrome` default of the shared `browser` input, and that the two browser caches share no key prefix; `decide-gate.test.ts` executes the draft rule. Promotion is staged (CLAUDE.md § Staged-rollout switches). How the suite drives Firefox and what differs: [`apps/extension/tests/e2e/FIREFOX.md`](./apps/extension/tests/e2e/FIREFOX.md).

### `bridge-contracts.yml`

The any-ERC-20 bridge's PR gate: `contracts` paths-filter → `_bridge-contracts.yml` (forge hermetic suite, halmos proofs, keystone nargo vectors, hub artifact parity, the sole-consumer static guard, the `integration` job — `packages/bridge-core`'s sandbox suite on a fresh anvil + local network, its node and anvil logs uploaded on failure — and the `txe` job, the hub's Noir tests under the TXE oracle) → `bridge-contracts-status`. Same exact-state aggregator shape as the extension gates. Not in the required set yet.

### `pr-tools-e2e.yml`

The tools app's browser gate: the real UI in Chromium against an embedded wallet-sdk test wallet (three profiles: a plain wallet, one that routes a dApp-named self-payer, one with the Nulo RPCs) and an injected EIP-1193 Ethereum wallet, on a per-shard sandbox (anvil + `aztec start --local-network` + a bridge generation). `tools-e2e` paths-filter (the tools graph, the bridge contracts, `packages/bridge-core/**` whole — its scripts are the harness — and the pipeline's own files) OR the `e2e:tools` label → `_tools-e2e.yml` × 6 shards (`--shard=i/4`; `setup-bun` → `setup-aztec` at bridge-core's pin → forge build → `setup-playwright` → `bun run e2e:tools`; 30-minute cap; traces + logs uploaded on failure) → `tools-e2e-status`, the same exact-state aggregator as the other gates. The extension never enters this workflow and tools never enters the extension's: each product proves itself against *a* counterpart, not the other product (CLAUDE.md § Two products, one repo). Suite layout and rules: `apps/tools/tests/browser/README.md`.

### Check names and the protection runbook

Every aggregator check is named after the product it gates — `quality-status` (repo-wide), `extension-smoke-e2e-status`, `extension-network-e2e-status`, `bridge-contracts-status`, `tools-e2e-status`. Branch protection matches those names literally, so a rename is a two-step owner action per branch, scripted in `scripts/ci-cd/required-checks.sh`: `print --branch <b> --json > <file>` (read-only; review the file), then `--apply --branch <b> --expect <file>` right before merging the rename (it refuses if the live protection drifted since the review, touches only `required_status_checks`, keeps `strict` and unrelated checks, verifies the write and prints the rollback). `--add a,b` appends new required checks the same way. `scripts/ci-cd/behavior-gating.test.ts` pins each PR workflow's aggregator name. The legacy labels `e2e:smoke` / `e2e:network` are still honored alongside `e2e:extension-smoke` / `e2e:extension-network` until the next stable cut.

### `actionlint.yml`

Runs when any `.github/workflows/**`, `.github/actions/**`, or shell script changes. Lints the workflow YAML and shellchecks the scripts. Cheap; gate.

### `release.yml`

Two triggers in one workflow:

- **`push` to `main`** — runs `googleapis/release-please-action` (v5, SHA-pinned). release-please scans Conventional Commits since the last tag and opens or updates a Release PR titled `chore: release X.Y.Z`. The PR bumps `package.json` + appends to `CHANGELOG.md` + updates `.release-please-manifest.json`. The PR's commits are app-authenticated (verified) via `actions/create-github-app-token@v1` using the `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY` secrets. When the Release PR is merged, the next push-to-main run *should* see `release_created=true` and continue — but the v4 abort bug means it usually doesn't (release-please logs "untagged, merged release PRs outstanding" and leaves `release_created` false). The **`auto-unstick`** job handles that: when `release_created != 'true'` on a `push`, it detects the merged `autorelease: pending` Release PR at `github.sha`, creates the tag + empty release + relabels, and feeds `resolve` (`unstuck=true` + the tag) so the chain continues in the same run. It's gated by `vars.AUTO_UNSTICK_ENABLED` (**default OFF** — while off the job runs but no-ops, so the manual unstick in [CLAUDE.md § Release runbook](./CLAUDE.md#release-runbook) is still needed; see there for the staged-rollout flip). Once a release is unstuck (auto or manual), the same workflow continues: gates → build chrome + firefox → smoke against the zipped artifact → `attach-assets` (zip + SHASUMS + `gh release upload --clobber` + `gh release edit --notes-file` with git-cliff body) → **landing + tools Cloudflare Pages deploy hooks** (`refresh-landing` + `deploy-tools`) → **`verify-live`** (advisory) → the store uploads (opt-in inputs, see below). A stable push also runs **`sync-main-to-dev`** (advisory, push-only): it opens the `chore: sync main → dev` PR that carries the release bump + `CHANGELOG` back into `dev` and re-baselines the prerelease manifest — clean PRs await your squash-merge, conflicts are labeled `needs-manual-resolution` (see [CLAUDE.md § After a stable cut](./CLAUDE.md#after-a-stable-cut-promotes-to-main)).

- **`workflow_dispatch`** — re-publish artifacts for an existing tag. Takes `tag` (e.g. `v0.20.0`), `dry_run` (default false), `run_network_e2e` (default false), `publish_chrome` and `publish_firefox` (both default false). Skips `release-please`; runs `resolve` → gates → build → smoke → `attach-assets`. The landing + tools deploy hooks + `verify-live` now ALSO fire on a non-dry-run `workflow_dispatch` (so a republish refreshes the sites + re-checks them). Useful when an asset upload failed mid-publish.

**`deploy-tools`** mirrors `refresh-landing` against `CLOUDFLARE_TOOLS_DEPLOY_HOOK`; until that secret is wired it **skips (doesn't fail)** — the tools app still auto-deploys via its CF dashboard Git-integration (the A5 cutover that disables the dashboard side is deferred). **`verify-live`** fetches `nulo.sh` + `tools.nulo.sh` (cache-busted, bounded retry) and asserts both serve THIS release — the tools app's `index.html` `nulo-build` meta must match `/build.json`'s `buildId` (split-cache guard) and the `chainId` must equal the wallet's testnet id — **fail-closed**. It's **advisory** (not in the `status` aggregator) until proven on the first clean real release, then promoted to required.

**Store uploads** are opt-in `workflow_dispatch` inputs, never automatic: `gh workflow run release.yml --ref main -f tag=vX.Y.Z -f publish_chrome=true`. Both publish jobs gate on `always() && !cancelled()`, the input, `resolve` + `attach-assets` success, `is_prerelease == 'false'` and `resolve`'s `on_main` output (the tag's commit is an ancestor of `origin/main`: `--ref` authenticates the workflow file, not the tag it checks out). `publish-chrome-store` is **keyless**: `environment: chrome-web-store` (variables `CWS_WIF_PROVIDER`, `CWS_SERVICE_ACCOUNT`, `CWS_PUBLISHER_ID`, `CWS_ITEM_ID`, `CWS_PUBLISH_TYPE`; no secret), `permissions: id-token: write`, `google-github-actions/auth` exchanges the job's OIDC token through Google Workload Identity Federation for a ten-minute access token on the service account linked in the Chrome Web Store dashboard, and `scripts/release/publish-chrome-store-run.ts` verifies the zip's checksum line, preflights `fetchStatus`, uploads, polls if the upload is async and publishes with `blockOnWarnings`. A `dry_run=true` dispatch verifies the zip and prints the plan without authenticating. `publish-firefox-amo` is a loud stub until the Firefox arc lands. **`store-check.yml`** (`workflow_dispatch`, input `store`) proves a store credential read-only — one `fetchStatus` in the store's environment, no upload — and is deliberately not an input of `release.yml`, whose non-dry dispatch re-uploads assets and fires deploy hooks.

Config files: `.github/release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`. The git-cliff template at `cliff.toml` provides the final release-body content.

### `nightly.yml`

The repo's only scheduled workflow: every night at 03:23 UTC it builds current `dev` and publishes a **prerelease** GitHub Release (`v<version>-nightly.<YYDDD>`, e.g. `v0.27.0-nightly.26233`) with the chrome + firefox zips + SHASUMS256.txt, so people can install the latest state of dev without a maintainer hand-off. Nightlies are marked pre-release and never take the "Latest" badge from stable releases. Also dispatchable manually (`force` bypasses the quiet-day skip; `dry_run` runs all gates but skips the publish).

- **Version scheme**: `<dev package.json version>-nightly.<YY+day-of-year>`. Chrome/Firefox cap each manifest version component at 65535 and `manifest.config.ts` strips non-numerics, so a calendar date would overflow — YYDDD keeps every component valid while `version_name` shows the full string. Same-day re-runs advance the code (`…26234`) instead of appending `.1` (a fifth component is an invalid manifest).
- **Gates are hard**: lint+typecheck → unit → full network suite (same shape as the PR gate: 5 proverless shards + 2 heavy jobs + real-proving canary) → chrome+firefox builds with the nightly version override → smoke against the built artifact. The tag + release are created only after everything is green, so a red night publishes nothing.
- **Flake policy** differs deliberately from the PR gate: the network suite runs at its config-default retry 2 (the PR gate forces 0 for honesty) plus the built-in infra-boot retry. A nightly absorbs flakes; a PR must surface them.
- **Quiet-day skip**: if the newest `v*-nightly.*` tag already points at dev HEAD, the run no-ops green.
- **Stable notes are protected**: `release.yml` passes `--ignore-tags '^v[0-9]+\.[0-9]+\.[0-9]+-nightly'` to git-cliff so nightly tags never act as range boundaries for a stable release's notes (without it, a stable cut the day after any nightly would only document the last ~24h). The nightly's own notes intentionally use the previous nightly as their boundary — a daily delta.
- **Interrupted-publish recovery**: `gh release create` makes the tag before assets finish uploading; a cancelled run can leave partial assets, and the quiet-day skip will then match that sha. Re-dispatch with `force=true` (publishes under a fresh date-code tag) or heal in place: rebuild the zips locally and `gh release upload <tag> …--clobber`.
- Schedules fire from the workflow file on the default branch (`dev`) — the trigger is inert on feature branches until merged.

## Labels

| Label | Effect |
|---|---|
| `e2e:extension-smoke` | Force-run smoke e2e on this PR — Chrome and (unless the PR is a draft) Firefox. |
| `e2e:extension-network` | Force-run network e2e on this PR — Chrome and (unless the PR is a draft) Firefox. |

Adding the label triggers a fresh run; removing it re-evaluates the gate (so a stale failing check goes green if the filter doesn't trip).

## Local equivalents

Everything CI runs has a local equivalent:

| CI gate | Local command |
|---|---|
| lint | `bun run lint` |
| typecheck | `bun run typecheck:all` |
| unit tests | `bun run test:all` |
| build (chrome) | `bun run --cwd apps/extension build:chrome` |
| build (firefox) | `bun run --cwd apps/extension build:firefox` |
| smoke e2e | `bun run --cwd apps/extension test:e2e` |
| network e2e | `bun run e2e:agent` (NOTE: local runs do NOT use `presto-server`. The wallet's `PrestoProver` probes the **Presto** desktop app over HTTPS on `127.0.0.1:59834` and uses it if available; otherwise WASM. CI specifically stamps `VITE_NULO_PRESTO_REQUIRED=1` to enforce no-fallback — that's not set locally.) |
| one-shot pre-PR | `bun run audit:vue` (typecheck + units + lint + build) |

## Releasing

Releases are driven by `release-please`. The human touchpoint is a single click — merging the Release PR.

1. Confirm what you want to ship is on `main` (via the usual `release: promote dev → main` PR).
2. Wait for `release.yml` to run on the push to main. It opens (or updates) a Release PR titled `chore: release X.Y.Z`. The version comes from Conventional Commits since the last tag.
3. Review the Release PR. CI runs the normal `quality-status` check. Eyeball the proposed `CHANGELOG.md` diff + `package.json` bumps.
4. Merge the Release PR via the GitHub UI (merge commit).
5. The next push-to-main run of `release.yml` sees the release was created. The same workflow run continues: gates → build chrome + firefox → smoke → `attach-assets` (uploads zips + SHASUMS, overlays git-cliff release notes onto the GitHub Release body) → Cloudflare deploy hook.

Tag format is `v<X.Y.Z>` (forced by `include-v-in-tag: true` + `include-component-in-tag: false` in `.github/release-please-config.json`). Prerelease (rc) support **exists** — `v<X.Y.Z>-rc[.N]` cut from `dev` via [`release-prerelease.yml`](./.github/workflows/release-prerelease.yml); see [`CLAUDE.md`](./CLAUDE.md) § Release runbook (Prerelease).

### Forcing the next-version

release-please picks the next version from Conventional Commit types: `feat:` → minor, `fix:` → patch, `BREAKING CHANGE:` (in the body or footer) → major. To force a specific version mid-flight, add a `Release-As: X.Y.Z` footer to any commit on `main`.

### Re-publishing assets for an existing tag

If a release was tagged but the asset upload failed (e.g. transient `gh release upload` error), use the `workflow_dispatch` escape hatch:

1. GitHub Actions tab → `release.yml` → "Run workflow".
2. Fill in:
   - `tag` — e.g. `v0.20.0`. Required.
   - `dry_run` — leave **false** to actually upload; `true` previews without changing the release.
   - `run_network_e2e` — leave **true** in most cases. Disable only for emergency re-publishes where the network gate is known-good.
   - `publish_chrome` / `publish_firefox` — leave **false** unless this republish is the store submission; each runs in its protected environment and only for a stable tag on `main`.
3. The workflow skips `release-please`, fetches the tag, and re-runs gates → build → smoke → `attach-assets`. The Cloudflare hook is **skipped** on manual re-publishes (only fires on the original push-to-main release).

## Debugging a failing PR

1. Click the failing check in the PR conversation. The `status` aggregator job's first error line points at the underlying job.
2. Open the underlying job's log. Failures are surfaced via `::error::` annotations and tend to surface as a single line.
3. Match against the workflow source (`.github/workflows/...`) to confirm what step ran.
4. Re-run the failing job from the GitHub UI ("Re-run failed jobs") if you suspect a transient flake.

For smoke / network e2e specifically: failure artifacts (vitest output, `.e2e-state/`, sandbox logs) upload on failure. Download them from the run page's "Artifacts" section.

## CI gating — derived from the dependency graph

The `pr-quick` / `pr-extension-smoke-e2e` / `pr-extension-network-e2e` `changes` jobs use `dorny/paths-filter` to skip work on PRs that can't affect a given target. **These filters are derived from the workspace dependency graph, not hand-curated** — a suite/build runs whenever any package its target is built from changes:

- **Built targets** (`extension`, `tools`, `playground`) → gated on the **whole package** (`apps/<target>/**`), so no build input (manifest, vite/tsconfig configs, `public/` assets, scripts, the e2e harness) can ever be silently missed.
- **Dependency libraries** (`wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge`, `design`, `bridge-core`) → gated on their consumed surface (`packages/<dep>/src/**` + `package.json`); their own README/docs stay out of the gate.
- Plus repo-wide build inputs (`package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, **`patches/**`**) + each suite's harness/workflow files.

**Two hard rules:**

1. **Never use a bare `!` negation pattern.** `dorny/paths-filter` defaults to `predicate-quantifier: some` (a file matches a filter if it matches ANY pattern), so a bare `!packages/x/**/*.md` matches *every file that isn't that md* → the filter silently becomes `**` and fires on every PR. Exclude by listing positive paths only (or, for true subset-exclusion, picomatch extglobs — never a bare `!`).
2. **Gate on the graph.** When the extension (or tools) gains a new `@nulo/*` dependency, add it to the relevant filters. [`scripts/ci-cd/behavior-gating.test.ts`](./scripts/ci-cd/behavior-gating.test.ts) recomputes each target's transitive graph from `package.json` and **fails CI** (via the `test:ci-gating` step in `_unit-tests.yml`) if a gate doesn't cover it, or if a `!` negation reappears — so the lists can't silently rot. The gates intentionally **over-trigger** (a colocated `*.test.ts`/`*.stories.ts` edit under `src/` runs the e2e suites) — the safe direction: err toward running, never skipping.

History + the dual-audit trail: [`implementations-plan/paths-filter-negation-fix/`](./implementations-plan/paths-filter-negation-fix/plan.md).

## Adding a new gate

1. If the gate is a single shell step, add it to an existing workflow's job.
2. If the gate is a whole job with its own runner / timeout / failure-artifact policy, create a reusable workflow at `.github/workflows/_<gate-name>.yml` and call it from the relevant top-level workflow(s).
3. Add it to the `status` aggregator's `needs:` list so failures propagate.
4. Update this file's "What runs when" matrix.

The reusables today are:
- `_lint-and-typecheck.yml` — biome + typecheck
- `_unit-tests.yml` — vitest workspace-wide
- `_build-extension.yml` — chrome + firefox (with optional version override)
- `_extension-smoke-e2e.yml` — puppeteer smoke against `EXTENSION_PATH` or downloaded artifact
- `_extension-network-e2e.yml` — Aztec sandbox + agent runner

Composite actions (step-level reuse):
- `setup-bun` — checkout + bun + lockfile cache + `bun install --frozen-lockfile`
- `setup-aztec` — Foundry + Aztec CLI matching the declared version, cached
- `setup-puppeteer` — `~/.cache/puppeteer` cache

## Known limitations

- **Extension smoke e2e is required on both `dev` and `main`** (as `extension-smoke-e2e-status`). Its fixtures can still flake (cross-file Chrome teardown — see [`implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md`](./implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md) §5); treat a red smoke like any gate — flake → re-run, breakage → fix — never neutralize it.
- **Extension network e2e has 18 quarantined tests** via co-located `test.skip` / `describe.skip`. See [`implementations-plan/network-test-triage/plan.md`](./implementations-plan/network-test-triage/plan.md) for the cluster grid + un-skip criteria.
- **Firefox Add-ons publishing** is still a loud stub in `release.yml` (`publish_firefox`); the Chrome Web Store job is wired keyless (see § `release.yml`). The Firefox `gecko.id`, `wallet@nulo.sh`, is final.

## See also

- [`.github/README.md`](./.github/README.md) — quick reference for the workflows + labels
- [`implementations-plan/ci-cd/plan.md`](./implementations-plan/ci-cd/plan.md) — original design + audits
- [`implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md`](./implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md) — smoke gating + branch cleanup design
- [`CLAUDE.md`](./CLAUDE.md) §"Quality gates" — what the AI assistants should know about gates
