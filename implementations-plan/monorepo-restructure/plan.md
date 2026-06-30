# Monorepo restructure → `apps/` + `packages/` + `contracts/`

**Tier:** `deep` · **Status:** ✅ APPROVED (user, 2026-06-30 — **FLAT `packages/` layout** + all recommendations; CF dashboard access confirmed). Both audit legs `conditional approve` (opus + codex), all 10 findings + confirm-conditions folded. · **Branch (impl):** `refactor/monorepo-layout` off `dev` · **Authoring:** main + codex (`019f154a`) + opus-1M (Plan subagent), independent then consolidated.

## Summary
Reorganize the Bun monorepo from flat `packages/*` into role-based dirs in **ONE atomic, history-preserving (`git mv`) PR**. **Package names stay `@nulo/*`** — Bun resolves workspace deps by name, so no `@nulo/...` import statement changes. What moves: directories, the workspace glob, ~15 `--cwd` scripts, root `tsconfig` project references, biome `includes`/`noRestrictedImports` globs, ~12 `.github/` files (dorny filters + reusables + `release.yml` git-cliff + release-please `extra-files` + 2 composite actions), the CI **guard test**, a handful of **depth/relative-coupled test + config files**, the contracts' Foundry remapping + a JS→artifact import, and the operating docs. The archives (`implementations-plan/`, `audit/`, `architecture/codex-notes/`) are **frozen**, not rewritten.

## Why `deep` (rubric)
HIGH: **blast radius** (the just-rebuilt graph-derived CI gates + release pipeline touch every required check), **migration cost** (13 dirs + ~12 CI files + 13 biome globs + fragile depth-coupled tests). MODERATE: irreversibility (one squash commit → clean `git revert`; zero runtime/schema change), external coupling (release pipeline + rehearsal repo). LOW: novelty. → `deep`.

## Final layout — RECOMMENDED (flat `packages/`) + the contested alternative

**Identity invariant (the load-bearing property):** for every JS package, `dir basename == @nulo/<basename> == CI-filter segment`. The guard test (`behavior-gating.test.ts:21`) literally does `join(ROOT, "packages", pkg, "package.json")` where `pkg` is the name-suffix. Keeping `dir == name-suffix` keeps the guard, the 13 biome globs, the dorny filters, and tsconfig on a uniform `(apps|packages)/<basename>/...` shape.

```
apps/                         # deployable leaves (each builds an artifact)
  extension/   faucet/   landing/   playground/
packages/                     # shared libraries — FLAT; dir basename == @nulo/<basename>
  wallet-core/  wallet-crypto/  extension-messaging/  aztec-runtime/
  wallet-bridge/  bridge-core/  design/
contracts/
  bridge/  aztec/ (Noir)  evm/ (Foundry)     # non-JS; NOT workspace members
```
Workspace glob (`package.json:4-6`): `["packages/*"]` → `["apps/*", "packages/*"]`. Contracts deliberately excluded (no `package.json`; must not become members).

### ⚠️ Contested decision (your call at the gate): flat vs grouped `packages/`
You leaned toward **more nesting** (`packages/wallet/*`). The strongest independent analysis (opus) argues **against** sub-grouping `packages/`, and I find the argument compelling enough to make flat the **recommended** option — but this contradicts your lean, so it is the **#1 approval-gate decision**:

| Option | Form | Cost | Who |
|---|---|---|---|
| **A. Flat (recommended)** | `packages/wallet-core`, `packages/extension-messaging`, … | Lowest churn; preserves the guard's `packages/<name>` identity model; max greppability; `apps/packages/contracts` already gives meaningful nesting | opus |
| B. Grouped, short names | `packages/wallet/core`, `packages/wallet/messaging` (= `@nulo/extension-messaging`) | dir≠name mismatch on 3/5; forces a name→dir map in the guard + deepens 13 biome globs + 3 filters | codex |
| C. Grouped, full names | `packages/wallet/wallet-core`, `packages/wallet/extension-messaging` | Preserves dir==name; redundant (`wallet/wallet-core`); still deepens globs | main |

**Recommendation: A (flat).** For a high-blast-radius move, minimizing the path-coupling surface and keeping the guard's identity model intact outweighs the cosmetic grouping — and `contracts/bridge/{aztec,evm}` still gives you the nesting you asked about (free, since contracts aren't packages/guard/biome-coupled). **The phases + gates below are layout-agnostic** (same steps; only the path *strings* differ between A/B/C), so your gate choice does not re-plan anything. `bridge-core` stays flat (no group-of-one); `extension-messaging`/`aztec-runtime` stay flat (no forced "wallet" taxonomy).

## Decision ledger (provenance + rejected alternatives)
1. **Layout = flat `packages/` (A).** Source: opus (strongest), vs codex (B) / main (C). Contested → user decides at gate. `contracts/bridge/{aztec,evm}` nesting retained (free).
2. **Contracts are NOT zero-coupling** — CORRECTS opus's "move first, nothing references them." Verified (main): `packages/bridge-core/src/artifacts.ts:6-7` imports `../../bridge-aztec/token_{minter_proxy,bridge}/target/*.json` (compile-time, LOUD); `packages/bridge-evm/foundry.toml:14` remaps `@aztec/=../../node_modules/...` (depth-relative, **SILENT — no contract CI**). → contracts move adds a `forge build` gate + recomputes both.
3. **`dispatcher.test.ts` fix = minimal targeted (opus), not discover-root (codex).** With flat layout `wallet-bridge` stays at `packages/wallet-bridge/` (depth unchanged) → `resolve(__dirname,"../../..")` at `:1082` **stays as-is**; only the import *target prefixes* (`../../extension`→`../../../apps/extension`) + the `read("packages/…")` strings change. Codex's depth-robust "discover repo root" rewrite is noted as an **optional follow-up** (future-proofs the next move; more change-surface now → deferred).
4. **`method-descriptors.test.ts:212`** (opus-unique) folded — 2nd file with the same cross-package import; verified.
5. **`extension/vitest.config.ts:39-43`** (codex/opus) folded — relative sibling-lib includes `../wallet-core/src/**` … must become `../../packages/wallet-core/src/**` (extension's `test` run executes the lib suites; verified).
6. **`setup-aztec` + `setup-puppeteer` composite actions** (codex-unique, verified) read `packages/extension/package.json` → repath.
7. **`.gitignore` (6 entries)** + **release-please `extra-files`** (`packages/extension/package.json` → `apps/`) + **`release.yml:317` git-cliff `--include-path`** folded (all three independently found).
8. **Lockfile G2 caveat** (opus): `--frozen-lockfile` may reject the legitimate path relocation → ONE non-frozen `bun install`, eyeball the diff is **path-only (no version churn)**, commit, then frozen-verify.
9. **Deliberate biome-violation probe** (opus): Phase 3 introduces a known layer-import violation, confirms `lint` FAILS, reverts — proves the layer rules still bind after the glob re-point.
10. **CI.md `workflow_dispatch` doc nit** (codex, `:85` vs later) — fix opportunistically in Phase 8; non-blocking.

## Phases (one branch; commit-per-phase for review; squash-merge to dev)
Ordering: cheapest gates earliest; workspace never un-installable for >1 commit boundary; the riskiest edits (CI filters + guard, release, fragile tests) isolated into small reviewable commits while the 766-file extension move stays a pure `git mv` (R100 rename).

### Phase 0 — Green baseline (no changes)
`git switch -c refactor/monorepo-layout`; run `typecheck:all`, `lint`, `test:all`, `test:ci-gating`, `test:release`, `bun install --frozen-lockfile`.
**Gate G0:** all green on dev's tip BEFORE any move (else STOP — pre-existing drift). Record output.

### Phase 1 — ✓ DONE (code; forge gates env-deferred, see lessons/phase-1.md) — Move contracts + fix ALL their couplings (audit: the briefing's "two" was wrong — there are five)
`git mv packages/bridge-aztec contracts/bridge/aztec`; `git mv packages/bridge-evm contracts/bridge/evm` (pure-rename). Then (content commit) fix every `bridge-core` → contracts/faucet path:
- `bridge-core/src/artifacts.ts:6-7` relative import → new `contracts/bridge/aztec/…/target/*.json` (LOUD: typecheck).
- `contracts/bridge/evm/foundry.toml:14` `@aztec/=../../node_modules` → `../../../node_modules` (one level deeper; SILENT — no CI forge).
- **`bridge-core/src/router-abi.test.ts:7` (audit F1):** `ARTIFACT` points at `../../bridge-evm/out/…` then `describe.skipIf(!existsSync(ARTIFACT))` (`:33`) → after the move the path is stale → the ABI-pin test **SILENTLY SKIPS even if forge built**. Repath `ARTIFACT` to `contracts/bridge/evm/out/…`.
- **EVERY `bridge-core/scripts/*` path reader (audit F2, broadened by final-codex):** `portal-artifact.ts`, `deploy-bridge-testnet.ts`, `deposit-testnet.ts`, `deploy-sandbox.ts`, `smoke-existing-testnet.ts`, `smoke-swap-existing-testnet.ts`, `fuel-testnet.ts`, `verify-l1.ts` — every `join(here,"..","..","bridge-{evm,aztec}")` → `contracts/bridge/{evm,aztec}`, every `faucet/public/…` → `apps/faucet/public/…`. (Operational scripts — NOT CI-gated → SILENT; the completeness grep below is the catch, NOT hand-enumeration.)
- `bridge-aztec/*/Nargo.toml` sibling deps move together (no edit).
**Gate G1:** `bun install --frozen-lockfile` + `git diff --exit-code bun.lock` (clean — contracts aren't members); `typecheck:all` (artifacts.ts miss — LOUD); **`(cd contracts/bridge/evm && forge build)`** exit 0; **router-abi pin RUNS, not skips** — `bun run --filter '@nulo/bridge-core' test` and confirm the `router-abi pin (forge artifact)` describe **EXECUTED** (forge-build-THEN-test proves remap AND the ABI pin — F1: forge build alone is necessary-not-sufficient); **bridge-core completeness grep** — `rg 'bridge-evm|bridge-aztec|faucet/public' packages/bridge-core/scripts` returns ZERO old-path readers.

### Phase 2 — ✓ DONE — Move apps + re-point workspace glob (the install gate)
`git mv packages/{extension,faucet,landing,playground} apps/` (pure-rename commit — the 766-file extension lands here). Then (content commit) edit `package.json:4-6` glob → `["apps/*","packages/*"]`; run ONE non-frozen `bun install`, **eyeball `git diff bun.lock` = `@nulo/*` path strings only, zero version churn**, commit `bun.lock`.
**Gate G2:** `bun install --frozen-lockfile` exit 0 (stable); `bun pm ls` lists every `@nulo/*` by name AND the **count == expected 11 members** (a missing member = a glob that didn't match — codex); the lockfile diff is path-only (any version hunk = STOP, investigate — do not regenerate to dodge).

### Phase 3 — ✓ DONE — Root tooling: tsconfig refs + biome globs
`tsconfig.json:4-7` references → `apps/{extension,playground,landing,faucet}`. `biome.json`: `includes` (`:6-15`) add `apps/**` + repoint the 2 type-excludes (`:13-14`); of the 13 `noRestrictedImports` overrides, the **extension-internal** ones (`:309-311` core/ui/composite, `:345` modules, `:369` onboarding) → `apps/extension/...`; the **lib** ones stay `packages/...`.
**Gate G3:** `typecheck:all` (project refs resolve) + `lint` (overrides bind) green. **Probe:** temporarily add a known layer violation (e.g. `@/stores/app.store` import in `apps/extension/src/components/ui/`), confirm `lint` FAILS, revert — proves the rules still fire (R8).

### Phase 4 — ✓ DONE — The fragile depth/relative-coupled files
(content commit; see §Fragile-files):
- `packages/wallet-bridge/src/dispatcher.test.ts:753,1070,1417` + **`method-descriptors.test.ts:212`**: `import("../../extension/…")` → `import("../../../apps/extension/…")`.
- `dispatcher.test.ts:1082` `resolve(__dirname,"../../..")` — **LEAVE UNCHANGED** (wallet-bridge didn't move).
- `dispatcher.test.ts:1084-1086` `read("packages/{extension,faucet,playground}/…")` → `read("apps/…")`.
- `packages/extension/vitest.config.ts:39-43` (now `apps/extension/`): `../wallet-core/src/**` … → `../../packages/wallet-core/src/**` … (5 libs).
- `apps/extension/.storybook/main.ts:26` (**audit B3**): `../../design/src/**/*.stories…` → `../../../packages/design/src/…` — a LIVE sibling-lib glob (the briefing wrongly called cross-package vite/storybook refs "stale comments only"; storybook is NOT CI-gated → SILENT break; also review the `:33` alias block for sibling refs).
- Design-token CSS tests with relative `../design` paths (**audit F3**, LOUD — `test:all` catches): `apps/faucet/src/app.css.parity.test.ts:10` `../../design/src/base.css` → `../../../packages/design/…`; `apps/faucet/src/lib/theme-vars.test.ts:7` `join(process.cwd(),"../design/…")` → `../../packages/design/…`; `apps/extension/src/design/theme-vars.test.ts:7` similar. (The `app.css.parity.test.ts:7` comment "design is always at `packages/design`" is now stale — update it.)
**Gate G4:** `bun run --filter '@nulo/wallet-bridge' test` first (isolates geometry — the schema-patch reachability + the "three copies content-identical" canary at `:1079`), then `test:all` (proves the extension vitest still runs all 5 lib suites at the new relative paths).

### Phase 5 — ✓ DONE — CI filters + guard test (one commit, kept consistent)
Repoint dorny filters: app targets → `apps/<app>/**` (`pr-quick.yml`, `pr-smoke-e2e.yml`, `pr-network-e2e.yml`); lib entries stay `packages/<lib>/{src/**,package.json}`; `actionlint.yml:34,74` shell-script paths → `apps/extension/scripts`. Teach `scripts/ci-cd/behavior-gating.test.ts` the split: add `const APPS=new Set([...]); const dirOf=p=>APPS.has(p)?"apps":"packages"` and use it at `:21,57-58,88` (target globs → `apps/` for app targets; dep-lib globs stay `packages/`); `ROOT` (`:17`) unchanged (`scripts/` doesn't move). NO `!` negations. **Do NOT touch any `status:` job `name:`** (the required-check-mismatch trap).
**Gate G5:** `test:ci-gating` green (the guard re-proves filters↔graph at new paths — the validation loop); `lint:actions` green; `grep -rn "packages/(extension|faucet|playground|landing)" .github/workflows/` returns **zero** (independent witness).

### Phase 6 — ✓ DONE — release.yml + release-please + build reusables + setup actions
`release.yml:317` git-cliff `--include-path 'packages/extension/**'` → `'apps/extension/**'`; both `release-please-*config.json` `extra-files.path` → `apps/extension/package.json`; `_build-extension.yml`/`_build-faucet.yml`/`_smoke-e2e.yml`/`_network-e2e.yml` extension/faucet `--cwd` + `dist` paths → `apps/`; **`_lint-and-typecheck.yml` (audit B1+B2):** extend the `setForceLocal` forbid-grep scope (`:54-57`) from `packages/` → `apps/ packages/` (**BLOCKING** — else the accelerator-required boundary enforcement silently stops scanning the moved extension code, and it feeds the required `quality-status`), AND repath the tsbuildinfo cache `path` + `hashFiles` key (`:31-32`) to `apps/extension` (stale = silent permanent cache miss); **`setup-aztec/action.yml:18` + `setup-puppeteer/action.yml:10`** `packages/extension/package.json` → `apps/`; root `package.json` 15 `--cwd packages/{app}` scripts **+ the direct-path `e2e:agent` (`:21` `packages/extension/scripts/e2e/agent.sh`) + `typecheck` (`:27` `--project packages/extension/tsconfig.json`)** → `apps/` (final-codex) + `check:imports` (`:32`) `biome check packages/` → `biome check apps/ packages/` (**audit F4** — else `apps/` silently unlinted by that script); `.gitignore` 6 entries.
**Gate G6:** `build:chrome` + `build:firefox` + `build:faucet` exit 0 (emit `apps/.../dist`; the proverless/probe `dist` safety guards print `✓` not silently skip — R11); `test:release` green; **local git-cliff smoke** `bunx git-cliff --include-path 'apps/extension/**' --unreleased --strip header | head` yields NON-EMPTY notes (R2 catch); **B1 gate — assert the `setForceLocal` scan now covers `apps/extension`** (the forbid step's scope list includes `apps/`; a planted `setForceLocal` in `apps/extension/src/` must make the step FAIL).

### Phase 7 — ✓ DONE — e2e harness + smoke
Repoint `docker-ci-like.sh:88` (functional read of `packages/extension/package.json`); leave `agent.sh:14` + `check-derivation-parity.ts:29` (package-internal, depth-unchanged) — comments only; e2e fixture cross-ref comments.
**Gate G7:** `test:e2e` (smoke) green (relocated build + harness).

### Phase 8 — ✓ DONE — LIVE docs + archive freeze
Update `CLAUDE.md`, `ARCHITECTURE.md`, `CI.md` (+ the `:85` workflow_dispatch nit), `README.md`, `SECURITY.md`, 13 per-package READMEs, e2e README — app refs → `apps/`, lib refs stay `packages/`. FREEZE `implementations-plan/`/`audit/`/`architecture/codex-notes/`; add ONE dated note to `implementations-plan/README.md` (decoder ring).
**Gate G8:** `grep` finds no app-pointing-at-`packages/` in LIVE docs (archives untouched); `bash .githooks/pre-commit` clean.

### Phase 9 — Full pre-PR gate + PR + CI + rehearsal + merge
`bun install --frozen-lockfile`; `audit:vue`; `audit:faucet`; `test:ci-gating`; `test:release`; `test:e2e`. Open PR to `dev` (labels `e2e:smoke`+`e2e:network` — insurance against a mis-repointed filter; a broken filter then fails LOUD instead of skipping). Run the **release rehearsal** (§Rehearsal) in parallel.
**Gate G9:** `quality-status` + `smoke-e2e-status` + `network-e2e-status` green on the PR; inspect the `Detect changes`/`Decide` logs to confirm `run=true` (gates actually FIRED, not green-on-skip); rehearsal release succeeded. **Repo-wide completeness grep (the STRUCTURAL catch for the recurring "missed reader" class — 3 audit rounds kept finding more):** `rg --hidden 'packages/(extension|faucet|landing|playground|bridge-aztec|bridge-evm)\b' -g '!.git/**' -g '!implementations-plan/**' -g '!audit/**' -g '!architecture/**' -g '!wallets-architecture-research/**' -g '!node_modules' -g '!bun.lock'` returns ZERO live hits (libs legitimately keep `packages/<lib>`; only the 6 MOVED names are forbidden by old path — current worklist 46 files). **Codex confirm-conditions folded:** (a) the archive exclusion is narrowed to `architecture/codex-notes/**` — any stale ref under `architecture/{plan,my-notes,research}` is NOT hidden and must be classified live-or-archival in Phase 8; (b) **run this after each phase as INFORMATIONAL** (the count monotonically DECREASES as phases land — non-zero mid-flight is expected); **ZERO is the acceptance criterion only at this final G9.** This one gate would have caught F1/F2/F4 + every audit-found gap. Squash-merge.

## Fragile files (the bug-density map)
| File:line | Coupling | Action |
|---|---|---|
| `wallet-bridge/src/dispatcher.test.ts:753,1070,1417` + `method-descriptors.test.ts:212` | `import("../../extension/…")` | → `../../../apps/extension/…` |
| `dispatcher.test.ts:1082` | `resolve(__dirname,"../../..")` repo-root | **UNCHANGED** (wallet-bridge depth unchanged — the inverse-bug to avoid) |
| `dispatcher.test.ts:1084-1086` | `read("packages/{ext,faucet,pg}/…")` | → `apps/…` (canary: `:1079` triplicate-identity test) |
| `extension/vitest.config.ts:39-43` | `../wallet-core/src/**` ×5 libs | → `../../packages/<lib>/src/**` |
| `bridge-core/src/artifacts.ts:6-7` | `../../bridge-aztec/…/target/*.json` | → new `contracts/bridge/aztec/…` (LOUD: typecheck) |
| `bridge-evm/foundry.toml:14` | `@aztec/=../../node_modules/…` | → `../../../node_modules/…` (**SILENT**: forge-build gate) |
| `tsconfig.json:4-7` | 4 app project refs | → `apps/…` |
| `release.yml:317` | git-cliff `--include-path` | → `apps/extension/**` (**SILENT**: empty notes; git-cliff smoke + rehearsal) |
| `release-please-*config.json extra-files` | `packages/extension/package.json` | → `apps/…` (silent version-bump stop) |
| `behavior-gating.test.ts:17,21,57-58,88` | `packages/` prefix + ROOT | teach apps/packages split; ROOT unchanged |
| `setup-{aztec,puppeteer}/action.yml` | read `packages/extension/package.json` | → `apps/…` |

## CI strategy
The dorny filters + the guard are two views of one fact ("run a target's suite when any package in its transitive `@nulo/*` graph changes"). After the move: **app target globs → `apps/<app>/**`; dep-lib globs stay `packages/<lib>/{src/**,package.json}`** (no lib is an app). The guard (`test:ci-gating`, run in `_unit-tests.yml` inside `quality-status`) is the static graph↔filter proof — run locally (G5) AND on the PR. Independent witness: the literal `grep` for stale `packages/<app>` in workflows. Dynamic witness: the PR touches every package, so every required gate must FIRE (inspect `Decide` logs) — a non-firing gate is a visible hole. No `!` negations (the `some`-quantifier footgun). Never edit a `status:` job `name:`.

## Release rehearsal (`alejoamiras/nulo-release-rehearsal`, PRIVATE)
Port the **restructured** `release.yml` (with `:317` `apps/extension/**`), both release-please configs (`extra-files.path: apps/extension/package.json`) + a **stub `apps/extension/package.json`** (`{"name":"@nulo/extension","version":"0.23.0"}` — so the relocated `extra-files` write is actually exercised; release-please skips a missing extra-file silently), manifests, `CHANGELOG.md`, `scripts/release/*`, `cliff.toml`. Cut a rehearsal release (`feat:` → release-please PR → merge → v4 manual unstick → `gh workflow run release.yml -f tag=… -f dry_run=true`). **Proves:** release-please opens a correctly-titled PR using the relocated `extra-files` path; `resolve` derives the tag/version; `attach-assets` runs git-cliff with the new `--include-path` without arg error; `sync-main-to-dev` opens its PR; `test:release` passes. Builds are proven separately by the PR's own CI — together = full release-path coverage without cutting a real Nulo release.

## Docs: LIVE update, ARCHIVE freeze
Update the operating map (CLAUDE/ARCHITECTURE/CI/README/SECURITY + per-package READMEs) — app refs → `apps/`, lib refs stay. FREEZE the ~670 archival refs (`implementations-plan/`/`audit/`/`architecture/codex-notes/`): they're point-in-time records (rewriting falsifies the date-stamped repo state), pure churn (PR bloat + find/replace collateral), inert (outside every CI filter), and the repo's own rules treat plans/audits as history. One additive decoder-ring note in `implementations-plan/README.md`.

## Rollback
The move is ONE squash commit on `dev` → `git revert -m1 <sha>` (a clean inverse `git mv` + path-edit reversal), one CI cycle to restore. **Zero runtime/schema/published-artifact change** — no migration to unwind; the revert is purely source-tree. Pre-merge: delete the branch (dev untouched). Release breakage (empty notes / no version bump): artifacts are still correct (built from `apps/`); fix-forward via the `workflow_dispatch` republish escape hatch — which is why the rehearsal runs BEFORE the first real release on the restructured config.

## Security & Adversarial Considerations
- **No trust-boundary delta** → /harden correctly skipped. `wallet-core`'s `chrome.*` ban stays (`packages/wallet-core/src/**`, unmoved). The L0–L6 layer lattice is preserved; the extension-internal globs re-point to `apps/` and Phase 3's deliberate-violation probe PROVES the rules still bind (a silently-dead layer rule = latent regression).
- **#1 silent threat — a filter left at `packages/<app>/**`** after the dir moved → suite never trips → green-on-skip → broken code merges with green required checks (the `required-check-mismatch` class). Layered defense: guard test + literal workflow-grep + forced-label runs.
- **Production-safety e2e guards** (proverless-marker / probe-string absence in `dist`) move by path, not assertion; a mis-edited `dist` path makes `[ -d ] || continue` silently skip → leak could ship. Catch: G6 runs the real builds; verify the guard prints `✓`.
- **Supply chain**: G2 enforces a *path-only* `bun.lock` diff (tighter than usual) — a version hunk under cover of a "restructure" PR fails the gate. `minimumReleaseAge` not path-coupled.
- **Worst release case**: `release.yml:317` git-cliff miss → silent empty notes (no error). Two independent catches: Phase-6 git-cliff smoke + the rehearsal cut.

## Assumptions
**Facts** (verified this session): dep graph (per-package.json `@nulo` deps); Bun resolves members by name (Bun docs); workspace glob `["packages/*"]`; root tsconfig refs the 4 apps; biome 13 overrides (extension-internal at `:309-311,345,369`); **two** wallet-bridge fragile tests (`dispatcher.test.ts` + `method-descriptors.test.ts:212`); `dispatcher.test.ts:1082` ROOT depth stays (wallet-bridge unmoved); `extension/vitest.config.ts:39-43` 5 relative lib includes; `release.yml:317` git-cliff + both `extra-files`; guard hardcodes `packages/` (`:21,57-61,88`), ROOT from `import.meta.dir`; `setup-{aztec,puppeteer}` read extension package.json; **contracts ARE coupled** (`bridge-core/artifacts.ts:6-7` import + `bridge-evm/foundry.toml:14` remapping); no CI builds contracts; required checks `quality-status`/`smoke-e2e-status`/`network-e2e-status`; `quality-status` runs `test:ci-gating` via `_unit-tests.yml`.
**Inferences** (attack these): `bun.lock` legitimately changes (member path strings) and frozen-install may reject the relocation → one non-frozen install needed (G2); git-cliff emits empty notes silently on a non-matching include-path; the rehearsal `extra-files` write needs the stub to be faithful; no workflow consumes a filter via an un-mapped name.
**Asks** (user, at gate): **(1) flat vs grouped `packages/` — recommend FLAT (contradicts your nesting lean — decide).** (2) `contracts/bridge/{aztec,evm}` basenames drop the `bridge-` prefix — OK? (3) the rehearsal stub `apps/extension/package.json` acceptable? **(4) EXTERNAL — Cloudflare Pages dashboard (codex F5):** the landing + faucet CF projects have a dashboard-configured build root pointing at `packages/{landing,faucet}`; before the first release that deploys from the restructured `main`, YOU must update those roots → `apps/{landing,faucet}` (the repo can't; the deploy hook returns 2xx even with a stale CF root + `verify-live` is advisory → SILENT). Confirm CF dashboard access / that you'll do it. (Rollout/release-validation/harden already locked.)

## Audit verdicts
- **Fresh hostile audit — opus-1M (Plan subagent): `conditional approve`.** 3 mechanical conditions, all verified + folded: **B1** (BLOCKING) `_lint-and-typecheck.yml:54-57` `setForceLocal` forbid-grep scope `packages/` → `apps/ packages/` (a silent required-gate hole — the accelerator-boundary enforcement; Phase 6 + a B1 gate); **B2** `:31-32` tsbuildinfo cache `path`+`hashFiles` key → `apps/extension` (Phase 6); **B3** `.storybook/main.ts:26` sibling glob → `../../../packages/design/` (Phase 4). Confirmed SOUND: the flat-layout recommendation (guard does `join(ROOT,"packages",pkg)` at `:21`), `dispatcher.test.ts:1082` left unchanged, the contracts correction. Cleared false-alarms: `vite.shared.ts` node_modules depth-safe (root from both `packages/` and `apps/`), keystone Nargo sibling-relative, soak/prerelease workflows covered, `setup-accelerator-server` clean. → corrected the briefing's false "vite/storybook = stale comments only" claim.
- **Codex hostile audit: `reject`** → all blocking findings verified + folded: **F1** `router-abi.test.ts:7,33` silent ABI-pin skip (`describe.skipIf(!existsSync)` — Phase 1 + a runs-not-skips gate; proves `forge build` is necessary-not-sufficient); **F2** `bridge-core/scripts/{portal-artifact,deploy-bridge-testnet}.ts` hardcode `bridge-evm`/`bridge-aztec`/`faucet/public` (Phase 1); **F3** design CSS tests' relative `../design` (Phase 4); **F4** `check:imports` scans `packages/` only (Phase 6); **F5 (EXTERNAL)** Cloudflare Pages dashboard build-roots for landing+faucet point at `packages/*` — outside the repo; deploy hook returns 2xx while CF builds the stale root + `verify-live` is advisory → SILENT (new Ask + pre-release prerequisite, §External). G2 refined to assert all 11 `@nulo/*` members present. Confirmed SOUND: `dispatcher.test.ts:1082` unchanged, the contracts correction (was incomplete → now complete with F1/F2).
- **Final fresh-context codex pass: `reject` → resolved.** Two narrow inventory gaps, both folded: F2 broadened to ALL 8 `bridge-core/scripts/*` readers (Phase 1); root `e2e:agent`/`typecheck` direct paths (Phase 6). Codex confirmed everything else sound + **NO repo-side Cloudflare config** (F5 is genuinely external/dashboard). **Structural fix added:** the G9 repo-wide completeness grep asserting ZERO moved-path references remain (worklist = 46 live files) — this closes the recurring "incomplete inventory" class that triggered both rejects. **→ codex confirmation (resumed session `019f1560`): `conditional approve`** — both reject conditions verified resolved; 2 minor conditions folded into G9 (per-phase grep is informational with zero only at final G9; archive exclusion narrowed to `architecture/codex-notes/**`). "No remaining blocking implementation gap found."
- **Net audit trail:** 3 independent plans → opus `conditional approve` (B1–B3) → codex `reject` (F1–F5) → final codex `reject` (2 narrow gaps) → all 10 findings folded + a structural completeness gate added. The recurring theme — every round found more hidden path-readers — is itself the strongest argument for the G9 grep gate and the atomic-PR-with-per-phase-grep discipline.

## Seeds (FINAL — approved scope: FLAT layout + all recommendations)
**Recommended — `/goal`** (completion is transcript-observable):
```
/goal All phases ✓ in implementations-plan/monorepo-restructure/plan.md, each backed by its validation gate (G0–G9 as written) reported passing in the transcript; FLAT packages/ layout per the approved ledger; for each phase printed LESSONS_FILE=implementations-plan/monorepo-restructure/lessons/phase-N.md; bun.lock diff verified path-only with all 11 @nulo/* members present (G2); the contracts forge build + router-abi-pin-RUNS-not-skips gate (G1), the deliberate biome-violation probe (G3), the wallet-bridge isolated test (G4), the CI guard test:ci-gating + zero-stale-app-path workflow grep (G5), the local git-cliff non-empty smoke + the B1 setForceLocal-scan-covers-apps assertion (G6), and the G9 repo-wide completeness grep (zero moved-path refs, archive-excluded) all shown passing; the release rehearsal cut in nulo-release-rehearsal succeeded (stub apps/extension/package.json); `/code-review max --fix` applied + committed; codex post-impl audit done with high/critical addressed; PR opened with all 3 required checks (quality-status, smoke-e2e-status, network-e2e-status) green AND confirmed-fired (Decide logs run=true). Hard limits: never edit a status: job name:; never merge to main/release; the Cloudflare dashboard build-root flip is the USER's pre-release step, not mine.
```
**Alternative — `/loop 15m`:**
```
/loop 15m Drive implementations-plan/monorepo-restructure forward. Never idle. Each firing: read plan.md + lessons/; git status; the open PR's statusCheckRollup. Pick the next pending phase; after each edit run that phase's gate (the relevant test/build/lint) AND the G9 completeness grep (informational — count must trend to zero). Phase green (its G-gate passes) → mark ✓, file lessons/phase-N.md, print LESSONS_FILE=…, advance. Decisions → /codex xhigh, log verdict, act. Same step failed 5× → reassess with codex. Hard limits: never edit a status: job name:; never merge to main/release; never publish/deploy; the CF dashboard flip is the user's. All phases ✓ → /code-review max --fix → commit → codex post-impl audit → address high/critical → release rehearsal → report + stop.
```
> Run exactly ONE per session. Start the implementation session in an autonomous permission mode so the loop isn't permission-stalled.
