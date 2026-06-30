# Monorepo Restructure Plan

## Target Tree

Package names stay unchanged; `package.json#name` is the authority. I would use semantic grouped directory names, accepting that some leaf dirs differ from package names, and make tooling use an explicit package-name-to-path map.

```text
apps/
  extension/        # @nulo/extension
  faucet/           # @nulo/faucet
  landing/          # @nulo/landing
  playground/       # @nulo/playground

packages/
  design/           # @nulo/design
  wallet/
    core/           # @nulo/wallet-core
    crypto/         # @nulo/wallet-crypto
    messaging/      # @nulo/extension-messaging
    aztec-runtime/  # @nulo/aztec-runtime
    bridge/         # @nulo/wallet-bridge
  bridge/
    core/           # @nulo/bridge-core

contracts/
  bridge/
    aztec/          # former packages/bridge-aztec, non-workspace
    evm/            # former packages/bridge-evm, non-workspace
```

Decision: `bridge-core` gets `packages/bridge/core`, not flat. The bridge domain now has both reusable JS and non-JS contracts, so a bridge group is clearer than a permanent top-level exception. `extension-messaging` and `aztec-runtime` live under `packages/wallet/` because they are wallet-engine support libraries in the enforced package hierarchy, even if their names are extension/Aztec-flavored.

## Grounding

The current repo assumes `packages/*` workspaces in root `package.json:4-6`, app references in `tsconfig.json:3-7`, Biome path overrides in `biome.json:56-395`, and graph-derived dorny filters with hardcoded `packages/<name>` paths in `pr-quick.yml:45-110`, `pr-smoke-e2e.yml:34-67`, and `pr-network-e2e.yml:40-74`. The guard test hardcodes that same assumption at `scripts/ci-cd/behavior-gating.test.ts:56-62` and `:86-89`, while CI actually runs it in `_unit-tests.yml:38-45`.

## Phase 0: Preflight Inventory

Commands:

```bash
git status --short
bun install --frozen-lockfile
bun run test:ci-gating
bun run test:release
rg -n "packages/(extension|faucet|playground|wallet-core|wallet-crypto|extension-messaging|aztec-runtime|wallet-bridge|bridge-core|bridge-aztec|bridge-evm)" .
```

Pass criteria: clean or intentionally understood worktree, frozen install succeeds, current CI guard/release tests pass, and the path-coupling inventory is captured before moving.

## Phase 1: History-Preserving Moves

Use one branch and `git mv` only:

```bash
mkdir -p apps packages/wallet packages/bridge contracts/bridge
git mv packages/extension apps/extension
git mv packages/faucet apps/faucet
git mv packages/landing apps/landing
git mv packages/playground apps/playground
git mv packages/wallet-core packages/wallet/core
git mv packages/wallet-crypto packages/wallet/crypto
git mv packages/extension-messaging packages/wallet/messaging
git mv packages/aztec-runtime packages/wallet/aztec-runtime
git mv packages/wallet-bridge packages/wallet/bridge
git mv packages/bridge-core packages/bridge/core
git mv packages/bridge-aztec contracts/bridge/aztec
git mv packages/bridge-evm contracts/bridge/evm
```

Update root workspaces to exact grouped globs, for example:

```json
"workspaces": [
  "apps/*",
  "packages/design",
  "packages/wallet/*",
  "packages/bridge/*"
]
```

Update root scripts from `packages/extension` / `packages/faucet` to `apps/extension` / `apps/faucet`, including `e2e:agent` and `typecheck` (`package.json:8-35` today).

Validation:

```bash
bun install
bun install --frozen-lockfile
bun -e 'const fs=require("fs"); const expected={"apps/extension":"@nulo/extension","apps/faucet":"@nulo/faucet","apps/landing":"@nulo/landing","apps/playground":"@nulo/playground","packages/design":"@nulo/design","packages/wallet/core":"@nulo/wallet-core","packages/wallet/crypto":"@nulo/wallet-crypto","packages/wallet/messaging":"@nulo/extension-messaging","packages/wallet/aztec-runtime":"@nulo/aztec-runtime","packages/wallet/bridge":"@nulo/wallet-bridge","packages/bridge/core":"@nulo/bridge-core"}; for (const [p,n] of Object.entries(expected)){const j=JSON.parse(fs.readFileSync(`${p}/package.json`,"utf8")); if(j.name!==n) throw new Error(`${p}: ${j.name} != ${n}`)}'
```

Pass criteria: lockfile is valid after workspace relocation, and every package name is unchanged.

## Phase 2: Local Tooling and Fragile Tests

Update:

- `tsconfig.json` references to `apps/{extension,playground,landing,faucet}`.
- `biome.json` includes to cover `apps/**` plus grouped `packages/**`; update every override path.
- `.gitignore` entries for extension e2e state, external files, bridge sandbox output, and faucet generated deploy artifacts.
- `apps/extension/vitest.config.ts` cross-package includes currently at `packages/extension/vitest.config.ts:38-42`; new paths should target `../../packages/wallet/...`.
- `apps/extension/vite.shared.ts` comments at old `packages/extension` paths; its `../../node_modules` aliases remain depth-equivalent because `apps/extension` is still two levels below root.

For `packages/wallet/bridge/src/dispatcher.test.ts`, do not preserve the old depth assumptions. Replace the three relative imports at current `dispatcher.test.ts:753`, `:1070`, and `:1417` with a helper that resolves from a discovered repo root, then imports the extension schema patch by absolute file URL or a single root-relative helper. Replace the root calculation at `:1082` and hardcoded reads at `:1084-1086` with `apps/extension/...`, `apps/faucet/...`, and `apps/playground/...`. This directly handles the schema-patch triplicate described in `CLAUDE.md:57-60`.

Validation:

```bash
bun run --cwd packages/wallet/bridge test -- src/dispatcher.test.ts
bun run typecheck:all
bun run lint
```

Pass criteria: schema-patch reachability and content-identical tests pass, and type/lint see both apps and packages.

## Phase 3: CI Filters and Guard

Rewrite `scripts/ci-cd/behavior-gating.test.ts` around a discovered package path map, not `packages/${name}`. The map should be computed from root workspaces and assert the expected final paths above. Then `assertGraphCovered()` checks:

- built targets: `${pathOf(target)}/**`
- dependency libs: `${pathOf(dep)}/src/**` and `${pathOf(dep)}/package.json`

Update dorny filters with positive-only globs, no `!` negations (`CI.md:162-165`):

- extension built target: `apps/extension/**`
- faucet built target: `apps/faucet/**`
- playground harness: `apps/playground/**`
- landing: `apps/landing/**`
- wallet libs: `packages/wallet/{core,crypto,messaging,aztec-runtime,bridge}/...`
- bridge core: `packages/bridge/core/...`
- design: `packages/design/...`

Also update path-coupled CI outside dorny: `_build-extension.yml:41-97`, `_build-faucet.yml:35-50`, `_smoke-e2e.yml:54-68`, `_network-e2e.yml:296-352`, `_lint-and-typecheck.yml:29-80`, `setup-aztec/action.yml:18`, `setup-puppeteer/action.yml:10`, release-please extra-files at `.github/release-please-config.json:11-13` and prerelease config `:14-16`, and `release.yml` git-cliff include path at `release.yml:313-318`.

Validation:

```bash
bun run test:ci-gating
bun run lint:actions
bun run test:release
```

Pass criteria: guard proves filters match the graph through the new path map, no forbidden negations exist, actionlint/shellcheck pass, and release scripts still pass.

## Phase 4: Builds and E2E

Run fast gates after CI/tooling, then full gates:

```bash
bun run test:all
bun run test:components
bun run audit:vue
bun run --cwd apps/faucet verify:deployments
bun run build:chrome
bun run build:firefox
bun run build:faucet
bun run --cwd apps/playground build
bun run --cwd apps/landing build
bun run test:e2e
bun run e2e:agent
```

Pass criteria: all commands pass. If smoke/network flakes, rerun the same SHA; do not weaken required gates. `CLAUDE.md:336-341` explicitly treats `quality-status`, `smoke-e2e-status`, and `network-e2e-status` as non-negotiable.

## Phase 5: Live Docs, Archive Freeze

Update live docs: `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `CI.md`, `SECURITY.md` where path references are operational. Also update per-package READMEs because they are live package surfaces.

Freeze old `implementations-plan/**`, `audit/**`, `architecture/codex-notes/**`, and research archives. `implementations-plan/README.md:38-47` says plans stay as historical “why” records; bulk rewriting old paths would falsify that context and create huge review noise. Add one note to `implementations-plan/README.md` saying pre-restructure paths in archived plans are historical.

## Phase 6: PR and CI Acceptance

Open one atomic PR. Because this PR touches workflows and app paths, smoke and network should run without labels. Inspect the `Detect changes` and `Decide` logs to confirm `run=true`, not merely that required status jobs ended green by skip. Required pass criteria:

```bash
gh pr checks <PR> --watch
```

Must show green `quality-status`, `smoke-e2e-status`, and `network-e2e-status`, with extension/faucet builds actually run.

## Release Rehearsal

In `alejoamiras/nulo-release-rehearsal`, port the restructured release orchestration: `.github/workflows/release.yml`, release-please configs, manifests, `CHANGELOG.md`, relevant `scripts/release/*`, setup action stubs, and a minimal `apps/extension/package.json` release metadata stub if allowed. That stub is necessary to prove the repathed release-please `extra-files` path; without it, the rehearsal does not test one of the riskiest path moves.

Cut a real rehearsal release: land a conventional commit, let release-please open the PR, merge it, perform the manual unstick if `AUTO_UNSTICK_ENABLED` is off, then dispatch `release.yml` against the tag. Proof: release PR opens, version file updates at the new path, tag and GitHub Release are created, publish chain reaches attach/update body, and sync-main-to-dev opens or reports the expected dry-run/sandbox equivalent.

## Rollback

Before merge: reverse the `git mv` map on the branch, rerun `bun install --frozen-lockfile`, `bun run test:ci-gating`, and the affected build/e2e gates.

After squash-merge to `dev`: revert the single squash commit with a normal revert PR. Do not partially revert only filters or only docs; the directory move and path-coupled tooling are one unit. If the rehearsal repo created bad tags/releases, delete only the rehearsal artifacts.

## Security & Adversarial Considerations

No new auth, secret, or trust boundary is introduced, so `/harden` stays skipped. The adversarial surface is CI/release skipping: a wrong dorny glob can make a required check green while not running, exactly the class of issue called out in `CLAUDE.md:29-32`. The guard test is therefore part of the implementation, not a nice-to-have.

Worst release failure: `release.yml` builds artifacts from `apps/extension` but git-cliff still filters `packages/extension/**`, producing empty or misleading release notes, or release-please stops bumping the extension version because extra-files still points to the old path.

## Assumptions

Facts: package names stay `@nulo/*`; current package graph matches manifests; contracts are non-workspace; required PR checks are `quality-status`, `smoke-e2e-status`, and `network-e2e-status`.

Inferences: Bun will accept exact workspace paths/globs for `apps/*`, `packages/design`, `packages/wallet/*`, and `packages/bridge/*`; `bun install --frozen-lockfile` is the authority.

Asks: confirm the minimal `apps/extension/package.json` stub is acceptable in the rehearsal repo. If not, the rehearsal cannot prove release-please extra-file repathing.

## Ranked Risks

1. CI filter/path map mismatch silently skips smoke/network while required statuses pass.
2. Release pipeline uses old extension paths and ships wrong version metadata or empty notes.
3. `dispatcher.test.ts` schema-patch imports fail after package depth changes.
4. Workspace globs miss nested packages, so `--filter '@nulo/*'` under-tests.
5. Docs become mixed live/archival truth and future agents follow stale paths.
6. Briefing undercounts path couplings: setup actions, `.gitignore`, extension Vitest cross-package includes, and release-please configs also move.
7. `CI.md` has a live-doc inconsistency: workflow_dispatch hooks are described as firing at `CI.md:85` but later as skipped at `CI.md:143`; fix while updating docs.