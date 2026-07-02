# Monorepo restructure — planning briefing (shared factual base)

> Working context for the planning agents. The plan is a **directory reorganization, not a code rewrite**: package NAMES stay `@nulo/*` (Bun resolves workspace deps by name, not path), so cross-package imports are UNAFFECTED. Only directories + path-coupled tooling/docs move.

## Locked decisions (user, this session)
- **Layout**: `apps/` (deployable leaves) + `packages/` (shared libs, family-sub-grouped) + `contracts/bridge/{aztec,evm}` (Noir + Foundry; non-JS, not in the workspace graph).
- **Rollout**: ATOMIC — ONE PR `git mv`s everything + updates every ref. (The CI filters reference apps+libs together, so this is the natural atomic unit.)
- **Release validation**: REHEARSAL CUT — mirror the restructured release config into `alejoamiras/nulo-release-rehearsal` (PRIVATE throwaway mirroring `release.yml`'s orchestration) + cut a real rehearsal release; the restructure PR's own CI proves the app-build path changes.
- **/harden**: SKIPPED (mechanical move; no new trust boundary/secret/auth surface).
- History-preserving `git mv`.

## Dependency graph (verified via each package.json's `@nulo/*` deps)
```
wallet-core      (foundation; no @nulo deps; chrome.* banned)
wallet-crypto    -> wallet-core
extension-messaging -> wallet-core
aztec-runtime    -> extension-messaging, wallet-core
wallet-bridge    -> extension-messaging, wallet-core   (deliberately NOT aztec-runtime)
bridge-core      -> wallet-crypto                       (consumed by FAUCET)
design           (no @nulo deps; shared UI: extension + faucet)
extension (app)  -> aztec-runtime, design, extension-messaging, wallet-bridge, wallet-core, wallet-crypto
faucet (app)     -> bridge-core, design
playground (app) -> (none; @aztec direct; dApp test harness — network-e2e gates on it)
landing (app)    -> (none; standalone static site)
bridge-aztec / bridge-evm  -> NON-JS (Noir / Foundry); NOT workspace members
```
SHARED libs (>1 consumer): **wallet-core, wallet-crypto** (extension + faucet-via-bridge-core), **design** (extension + faucet). → they cannot live under any single app.

## Proposed target layout (REFINE; names stay `@nulo/*`)
```
apps/   extension/  faucet/  landing/  playground/
packages/
  wallet/  core/ crypto/ messaging/ aztec-runtime/ bridge/   (the engine stack)
  bridge-core/    design/
contracts/bridge/  aztec/ (Noir)  evm/ (Foundry)
```
OPEN design Qs the plan MUST resolve (do NOT silently assume):
1. **dir-name vs package-name convention.** `packages/wallet/messaging` would hold `@nulo/extension-messaging` — a cosmetic mismatch. Options: dir = package's last hyphen-segment (core/crypto/bridge clean; messaging/aztec-runtime loose); keep full dir names (`packages/wallet/extension-messaging`); or accept the mismatch. **Renaming the PACKAGES is OFF THE TABLE** — it changes import statements repo-wide and breaks the "names don't move" safety.
2. Does `bridge-core` get a `packages/bridge/` group-of-one or stay flat `packages/bridge-core`?
3. Do `extension-messaging`/`aztec-runtime` belong under "wallet" (they're extension-support libs — loose fit)? Alternative group name?

## CI gating (JUST rebuilt — #181 graph-derived gates + #185 negation fix — THE central risk)
- dorny/paths-filter gates are graph-derived but **hardcoded globs** (`packages/<name>/**`, `packages/<dep>/src/**`, `packages/<dep>/package.json`) in: `pr-quick.yml`, `pr-smoke-e2e.yml`, `pr-network-e2e.yml`, `_build-extension.yml`, `_build-faucet.yml`, `actionlint.yml`, reusable `_*.yml`.
- **GUARD TEST `scripts/ci-cd/behavior-gating.test.ts`** reads the workspace graph and asserts each filter contains the right `packages/<target>/**` etc. It **hardcodes the `packages/` prefix** (≈ lines 58/60/61/88). It is BOTH the safety net (catches filter↔graph drift — a built-in validation loop) AND a thing-to-update (must learn the apps/ vs packages/ vs contracts/ split).
- **NO `!` negations** (the dorny `some`-quantifier footgun; see `implementations-plan/paths-filter-negation-fix/`).

## LIVE path-coupling surface (MUST update — precise)
- `package.json` (root): `workspaces` glob + ~12 `--cwd packages/<x>` scripts.
- `tsconfig.json` (root): 4 project `references` → `packages/{extension,playground,landing,faucet}` (the apps).
- `biome.json`: 13 `noRestrictedImports` path overrides (`packages/<x>/src/**`) + 2 type-dir excludes + `includes` globs + `!**/*.svg`.
- `.github/`: ~12 files — dorny filters, `_build-extension`/`_build-faucet`, `release.yml` git-cliff `--include-path 'packages/extension/**'` (line 317), 2 `release-please-*config.json`.
- `scripts/ci-cd/behavior-gating.test.ts` (the guard).
- **`packages/wallet-bridge/src/dispatcher.test.ts` — MOST FRAGILE**: (a) relative cross-package imports `import("../../extension/src/.../nulo-schema-patch")`; (b) hardcoded path strings `read("packages/extension/src/...")` + faucet + playground; (c) `resolve(__dirname, "../../..")` repo-root computation that depends on the package's nesting DEPTH. apps moving + this lib moving both change the relative geometry.
- schema-patch triplicate: `packages/{extension,faucet,playground}/.../nulo-schema-patch.ts` (3 identical, pinned by the test above).
- e2e: `packages/extension/scripts/e2e/{agent.sh,docker-ci-like.sh}`, `tests/e2e/fixtures/{playground,dappSession}.ts`, `check-derivation-parity.ts`.
- vite configs: mostly self-relative (`@`→`./src`); only stale-able comments cross-reference siblings.
- LIVE docs: `CLAUDE.md`, `ARCHITECTURE.md`, `CI.md`, `README.md`, `SECURITY.md`, 13 per-package `README.md`, `packages/extension/tests/e2e/README.md`, `implementations-plan/README.md`.

## ARCHIVAL (FREEZE — do NOT rewrite)
`implementations-plan/<old plans>` (~567 refs), `audit/` (~91), `architecture/codex-notes/` (~14), `wallets-architecture-research/`. Point-in-time records; rewriting falsifies history + is massive churn. Proposal: leave as-is; optionally one note in `implementations-plan/README.md` that pre-cutover paths are historical.

## Validation layers (REAL, from the repo)
`typecheck:all` · `lint` · `test:all` · `test:components` · `audit:vue` · `behavior-gating.test.ts` (filter↔graph guard) · `test:e2e` (smoke/Puppeteer) · `e2e:agent` (network; anvil+aztec+playground; parallel-safe) · 5 builds (chrome/firefox/faucet/playground/landing) · `bun install --frozen-lockfile`. CI required: `quality-status`, `smoke-e2e-status`, `network-e2e-status` (dev+main). Release: `release.yml` `dry_run` + the rehearsal repo.

## Rehearsal repo (alejoamiras/nulo-release-rehearsal, PRIVATE)
Throwaway mirror of `release.yml` ORCHESTRATION: has `.github/workflows/release.yml`, `.release-please-manifest.json`, `CHANGELOG.md`, `package.json`, `scripts/`. NO app packages → validates release-please + manual-unstick + tag/release creation + sync-main-to-dev, NOT app builds. Use: port the restructured release.yml + release-please config in, cut a rehearsal release, confirm orchestration survives the repath.

## What the plan must deliver
Concrete, **phased** plan with: per-phase validation gates (real commands + pass criteria); explicit intra-PR sequencing (git mv → workspace glob → frozen install → tooling → CI+guard → docs → builds → e2e → rehearsal → open PR); fragile-spot handling (dispatcher.test.ts, tsconfig refs, release.yml git-cliff, the guard test); a concrete ROLLBACK story; the LIVE-vs-ARCHIVAL doc decision; Security & Adversarial + Assumptions sections; decision ledger. "Validation loops on steps" = run the fast+relevant gates after each meaningful sub-step, not only at the end. Atomic = ONE branch, but each sub-step is independently verified before the next.
