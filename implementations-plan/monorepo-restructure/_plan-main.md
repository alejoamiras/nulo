# Monorepo restructure — MAIN agent independent draft

(One of three independent drafts. Consolidated into `plan.md` after codex + opus return.)

## Target tree (my proposal)
Convention: **directory = package's `@nulo/` local name (full), nested under family group dirs.** Rationale: the #1 safety property of this move is a *mechanical* package-name ↔ path mapping — the guard test (`behavior-gating.test.ts`) and every path-coupled tool derive paths from names; a `dir≠name` mismatch (e.g. `packages/wallet/messaging` = `@nulo/extension-messaging`) is a standing footgun. Accept the `packages/wallet/wallet-core` redundancy as the cost of an unambiguous map. Singletons with no family stay flat (no group-of-one dirs except where it buys a coherent story).

```
apps/
  extension/   faucet/   landing/   playground/
packages/
  wallet/                         # the extension engine stack (layer chain)
    wallet-core/   wallet-crypto/   extension-messaging/
    aztec-runtime/   wallet-bridge/
  bridge/
    bridge-core/                  # pairs with contracts/bridge/* — coherent "bridge" story
  design/                         # shared UI singleton — flat
contracts/
  bridge/
    aztec/   evm/                 # Noir + Foundry (non-JS)
```
Open: `bridge-core` as `packages/bridge/bridge-core` (group-of-one) is justified ONLY by pairing with `contracts/bridge/*`; flat `packages/bridge-core` is the alternative. Flag for the audit.

## Phases (atomic PR — one branch `refactor/monorepo-layout`; each phase gated)

### Phase 0 — Baseline + mapping
Branch off dev. Confirm a GREEN pre-move baseline. Write `name→old-path→new-path` map (the single source of truth driving every later edit; also feeds the guard-test update).
**Gate:** `typecheck:all` + `lint` + `test:all` exit 0 on the untouched branch; map committed.

### Phase 1 — Move dirs + workspace glob
`git mv` every package to its new home. Update root `package.json` `workspaces` to globs matching the tree (`apps/*`, `packages/wallet/*`, `packages/bridge/*`, `packages/design`). `bun install` to re-record member paths. NO source edits.
**Gate:** `git status` shows renames (history preserved); `bun install --frozen-lockfile` exit 0; `bun pm ls` lists all `@nulo/*` by name; `git diff bun.lock` is path-only (no version churn).

### Phase 2 — Fragile path-coupled CODE
- `packages/.../wallet-bridge/src/dispatcher.test.ts`: recompute (a) relative cross-package imports `../../extension/...` for the NEW geometry (extension moved to `apps/`, wallet-bridge moved to `packages/wallet/`), (b) the hardcoded path strings `read("packages/extension/...")` → new app/lib paths, (c) `resolve(__dirname,"../../..")` repo-root depth (wallet-bridge is now 1 level deeper → `../../../..`).
- root `tsconfig.json` 4 project `references` → `apps/{extension,faucet,landing,playground}`.
- e2e fixtures/scripts (`agent.sh`, `docker-ci-like.sh`, `fixtures/*`, `check-derivation-parity.ts`), stale-able vite comments.
**Gate:** `typecheck:all` + `lint` + `test:all` exit 0 (dispatcher.test.ts + schema-patch drift test GREEN at new paths).

### Phase 3 — Tooling configs
`biome.json` (13 `noRestrictedImports` overrides + `includes` + type-excludes + `!**/*.svg`) → new paths; root `package.json` `--cwd packages/<x>` scripts → new paths.
**Gate:** `lint` exit 0 (overrides resolve + still enforce the layer bans — spot-check one cross-layer import still errors); `bun run build` (a `--cwd` script) runs; `typecheck:all` green.

### Phase 4 — CI filters + GUARD TEST (critical)
Update dorny filters in every workflow + `release.yml` git-cliff `--include-path` + `_build-*`. Teach `scripts/ci-cd/behavior-gating.test.ts` the apps/packages/contracts split (the name→path map). NO `!` negations.
**Gate:** `bun test scripts/ci-cd/behavior-gating.test.ts` exit 0 (the guard re-proves filters match the graph at new paths — the built-in validation loop); `bun run lint:actions` exit 0. *Dynamic proof deferred to Phase 8: the PR touches EVERY package, so every required gate's filter must fire — a non-firing gate is visibly "expected/missing".*

### Phase 5 — LIVE docs + archival freeze
Update operating docs: `CLAUDE.md`, `ARCHITECTURE.md`, `CI.md`, `README.md`, `SECURITY.md`, 13 per-package `README.md`, e2e README, `implementations-plan/README.md`. FREEZE archives (`implementations-plan/<old>`, `audit/`, `architecture/codex-notes/`) — add ONE note to `implementations-plan/README.md` that pre-cutover paths are historical.
**Gate:** grep finds no stale old-layout path in LIVE docs; pre-commit (`check-no-brand.sh`) passes.

### Phase 6 — Builds + e2e
5 builds (chrome/firefox/faucet/playground/landing) + `test:e2e` (smoke) + `e2e:agent` (network).
**Gate:** 5 builds exit 0; smoke + network e2e green locally.

### Phase 7 — Release rehearsal
Port restructured `release.yml` + release-please config into `alejoamiras/nulo-release-rehearsal`; cut a rehearsal release; confirm orchestration (unstick → tag → release → sync-main-to-dev).
**Gate:** rehearsal tag + GitHub Release created; sync PR opened; no orchestration step references a dead path.

### Phase 8 — PR + CI + merge
Push, open PR (labels `e2e:smoke`+`e2e:network`).
**Gate:** `quality-status` + `smoke-e2e-status` + `network-e2e-status` green; guard test green in CI; **every required gate actually fired** (the all-package diff proves no silent filter gap). Squash-merge.

## Rollback
Pre-merge: abandon the branch. Post-merge: the move is ONE squash commit → `git revert <sha>` restores the prior layout wholesale (`git mv` is symmetric; the revert moves dirs back + restores every config). Atomicity makes the revert clean. The rehearsal + full-PR-CI-fire make post-merge revert improbable.

## Security & Adversarial
- **Silent CI-gate gap** (top threat): a filter that no longer matches a package → its tests silently stop gating later PRs. Mitigations: the guard test (static graph-consistency) + the PR's own all-package CI fire (dynamic) + a post-merge spot check (touch one file per package on a throwaway branch, confirm the right job triggers).
- **Release breakage**: a repath botches tag/asset/deploy. Mitigation: the rehearsal cut.
- **Supply chain**: `bun install` must produce a path-ONLY `bun.lock` diff (no version moves); `--frozen-lockfile` in CI. No dep changes in this PR.
- **Least privilege**: the move touches NO secrets/OIDC/permissions — assert every workflow's `permissions:` block is byte-unchanged.
- **Contracts tooling** (under-explored): `contracts/bridge/{aztec,evm}` carry Foundry (`foundry.toml`) + Noir (`Nargo.toml`) with their OWN path assumptions (remappings, lib paths, CI). Moving them may break contract build/test independent of the JS graph.

## Assumptions
**Facts** (verified): dep graph (per-package.json `@nulo` deps); the live path-coupling inventory (rg); guard-test behavior (read `behavior-gating.test.ts`); Bun resolves workspace deps by NAME not path (Bun docs + standard); root tsconfig has 4 app project-references; dispatcher.test.ts's three path-coupling modes (read).
**Inferences** (attack these): contracts dirs have path-coupled Foundry/Noir tooling NOT yet inventoried; the rehearsal repo currently mirrors release.yml faithfully; no workflow consumes a filter via a name I haven't mapped; `git mv` rename-detection survives the depth change for review.
**Asks**: dir-naming convention (full-name vs short) — I propose full-name; `bridge-core` grouped vs flat — flag. (Layout/rollout/release/harden already resolved by the user.)

## ADDENDUM — Contracts coupling (verified; briefing under-covered)
- `packages/bridge-core/src/artifacts.ts` imports compiled Noir artifacts by RELATIVE path: `../../bridge-aztec/token_{minter_proxy,bridge}/target/*.json`. After the move (bridge-core → `packages/bridge/bridge-core`, bridge-aztec → `contracts/bridge/aztec`) this becomes a deep cross-tree climb (`../../../../contracts/bridge/aztec/...`). COMPILE-TIME import → typecheck/build catches a miss (**LOUD**). Phase 2 recomputes it. (Smell: a JS package reaching into a non-package contract dir for committed artifacts — note, don't refactor here.)
- `packages/bridge-evm/foundry.toml` remaps `@aztec/=../../node_modules/@aztec/l1-artifacts/...` — a DEPTH-relative climb to root `node_modules`. `bridge-evm` → `contracts/bridge/evm` adds one level → must become `../../../node_modules/...`. **NOT CI-gated** (no workflow runs `forge`) → a missed update is a **SILENT local-build break**. → Phase 2 contracts sub-step must run `forge build` to verify.
- `bridge-aztec/*/Nargo.toml` deps are SIBLING-relative (`../token_minter_proxy`) → survive the whole-dir move (siblings move together). Fine.
- The committed `target/*.json` artifacts move WITH bridge-aztec; only the importer's path changes. No CI builds the contracts → contract correctness isn't PR-gated; rely on local `forge build` + the typecheck of the artifact import.

## Ranked risks
1. Silent required-gate filter gap (the `required-check-mismatch` class) — guard test + all-package fire.
2. **Foundry `@aztec/` remapping depth break — SILENT (no contract CI); needs an explicit `forge build` gate.**
3. `bridge-core/artifacts.ts` cross-tree relative import to `contracts/bridge/aztec` — loud (build), but deep + ugly; recompute carefully.
4. `dispatcher.test.ts` `../../..` depth miscount — explicit recompute + test gate.
5. Release-pipeline repath miss — rehearsal cut.
6. Reviewer fatigue on a giant PR — committed name→path map + "renames-only commit, then config commits" ordering inside the PR.
