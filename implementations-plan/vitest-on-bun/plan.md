# vitest-on-bun — Arc C of the Bun 1.4 adoption (`/blueprint mid`)

Status: DRAFT v4 — codex rounds 1–3 and fable round 1 folded (see [lessons/gate-convergence.md](lessons/gate-convergence.md)); awaiting the fresh-context codex pass. `eli5_mode: artifact` — ELI5 Artifact: https://claude.ai/code/artifact/8086907e-ab23-4627-a33a-d8553df5cf53 (source: `implementations-plan/vitest-on-bun/eli5.html`; redeploy the same path to update).

## Goal

Run every workspace Vitest suite on the **Bun runtime** — `bun --bun vitest run` — with proof, from retry-0 repeated-run baselines taken at the same commit on both runtimes, that Bun is no flakier than Node, and land it as one reviewable PR that leaves CI YAML untouched. The Puppeteer e2e layer (extension smoke/network) stays on Node in this arc.

**Done** = the eleven workspace `test` scripts (ten packages + the extension aggregate) plus extension `test:components` and the faucet jsdom smoke (`test:e2e`) run under Bun; every phase gate passed as written; the unit-layer soak tool exists and its own failure modes are proven by `test:ci-gating` on every CI run; a `workflow_dispatch` of `pr-quick.yml` on the branch is green on the real runner; docs state the runtime; the vitest/Bun interop stopgap carries its retirement trigger; PR open, required gates green, codex loop converged. If a genuine Bun defect forces a package to stay on Node, that is an explicit STOP for the owner (abort vs reduced-scope replanning) — not a silent scope cut.

## Why this tier (Phase 0.5 rubric)

Novelty MED (first Bun-runtime test execution here, de-risked by the dossier + pre-plan probes), blast radius MED (`quality-status` depends on `test:all`; a bad flip reds every PR — reversible per package by one script line), irreversibility LOW, migration cost LOW, external coupling MED (a real vitest×Bun interop defect — fixed upstream in vitest 5 beta, stopgapped here), security LOW. One MED-HIGH dimension → `mid` (dossier tier confirmed).

## Recon → design (see [recon.md](recon.md); probes in [lessons/pre-plan-probes.md](lessons/pre-plan-probes.md))

- CI never names `vitest`; `test:all` fans out to each package's `test` script (packages run concurrently) → the flip is script strings, no workflow change.
- Every Bun failure in the repo is ONE vitest interop rule (`interopModule` tests `"__esModule" in mod.default`; Bun answers `true` for ES-module namespaces; zod@4's namespace default loses `z`). Upstream fixed it in vitest PR #10363 (issue #10359, shipped in 5.0.0-beta.3) — not in our locked 4.1.10. `test.deps.interopDefault: false` is the stopgap: it fixes Bun and is test-set-identical on Node (extension aggregate 372 files / 4,635 tests on both runtimes).
- The probes de-risked the package order: after the stopgap, every suite is green on Bun on a single run. So the effort goes into ONE strong gate (fail-closed soak matrix at one clean commit, inventory-exact comparison, the CI-shaped concurrent fan-out repeated, and a real-runner dispatch) rather than six sequential rollouts.
- No soak harness, coverage, or consumed reporters exist → the gate tooling is a small new script; coverage parity is out of scope by evidence.

## Architecture & Implementation

**Proposed architecture.** Three small pieces, no new package, no dependency changes.

1. **`vitest.base.ts`** (repo root) — one plain object, no imports (resolvable identically under the hoisted and the isolated linker):
   ```ts
   /** Shared `test` options every workspace vitest config spreads in. */
   export const sharedTest = {
   	// STOPGAP until the installed vitest contains vitest-dev/vitest#10363 (≥ 5.0.0-beta.3):
   	// Bun's ES-module namespace objects answer `"__esModule" in ns` (Node: false), so vitest 4's
   	// default interop replaces an externalized module by its `default` — zod@4's default IS a
   	// namespace and `z` vanishes. Off, named exports of CJS deps follow each runtime's own loader
   	// (no vitest fallback); the Node soak baselines prove nothing here depends on that fallback.
   	// Retire: delete this key and re-run the Bun soak matrix.
   	deps: { interopDefault: false },
   } as const
   ```
   Every workspace `vitest.config.ts` spreads it: `test: { ...sharedTest, globals: true, environment: "jsdom", … }`. The four config-less workspaces (`aztec-runtime`, `wallet-bridge`, `wallet-sdk-schema-patch`, `landing`) get a minimal config that ALSO pins `environment: "node"` explicitly. `experimental.viteModuleRunner` stays at its default (`true`): `false` would route through `module.registerHooks`, which Bun lacks — a documented never-flip. `biome.json` `files.includes` gains `vitest.base.ts` and `scripts/ci-cd/test-soak/**` so the new code is linted/formatted (`scripts/**` is otherwise excluded).

2. **`scripts/ci-cd/test-soak/`** — the fail-closed unit-layer soak driver: `cli.ts` (guarded by `import.meta.main`), `lib.ts` (pure: parse vitest JSON → inventory; merge runs; compare; metadata checks; the run loop takes an explicit launcher argv), `lib.test.ts` (`bun:test`), `runtime-reporter.ts` (a vitest reporter passed by absolute path), `fixtures/` (tiny vitest projects: `crash`, `hang`, `unhandled-rejection`, `no-json`, `passing`), `cli.test.ts` (`bun:test`; runs the real run loop against each fixture with a short timeout and asserts `failedRuns > 0` / `timedOut: true` / `missingJson: true` — the gate is proven able to fail on every CI run via `test:ci-gating`). Fixtures are executed through a workspace that DECLARES vitest — `bun --no-install run --cwd apps/landing vitest run --root <abs fixture dir>` — never from the root, which declares no vitest (under the isolated linker a root-anchored launch would not resolve it; the `--root` launch was probed in the pre-plan work).
   - Invocation: `bun scripts/ci-cd/test-soak/cli.ts soak --cwd <workspace> --script <name=test> --runtime script|node --runs N --out <dir> [--timeout <min>] [-- <vitest filters>]` and `… compare <a.json> <b.json>`.
   - `--runtime script` (the default, and the ONLY mode for Bun evidence) runs the REAL script: `bun --no-install run --cwd <ws> <script> -- <filters> <enforced flags>` — so `pretest`, `--passWithNoTests` and the flipped `bun --bun vitest run` string are exactly what is soaked. `--runtime node` is the same-commit Node reference with the same lifecycle: it reads the script's value, requires it to match the strict grammar `bun --bun vitest run( <token>)*` (tokens without shell metacharacters; anything else → refuse), runs `pre<script>` first if declared (`bun --no-install run --cwd <ws> pre<script>`; a non-zero exit = a failed run, as `bun run` would fail the script), then `bun --no-install run --cwd <ws> vitest run <tokens> -- <filters> <enforced flags>` (Node by shebang), then `post<script>` if declared — the pre-flip CI string at the same commit. The tool refuses to label a summary Node when the reporter reports `versions.bun`, and vice versa.
   - Enforced flags are appended LAST (`--retry=0 --reporter=default --reporter=json --outputFile=<tmpDir>/results.json --reporter=<abs runtime-reporter.ts>`); forwarded filters may not contain reserved flags (`--retry`, `--reporter`, `--outputFile`, `--root`, `--config`, `--pool*`, `--watch`) — rejected up front.
   - Each run: `node:child_process.spawn` (argv array, no shell, `detached: true` = its own process group, stdio captured), a timer that on expiry kills the GROUP (`process.kill(-pid, "SIGKILL")`) and marks the run `timedOut`; SIGINT/SIGTERM handlers forward the same group kill and exit non-zero; `mkdtemp` output dir removed after parsing. `failedRun := exitCode ≠ 0 ∨ !json.success ∨ JSON missing/unparseable ∨ timedOut`.
   - `runtime-reporter.ts` (`onInit`): writes `{ execPath, versions, resolves }` to the path in `SOAK_RUNTIME_OUT`. `resolves[spec] = { esm, cjs }`, workspace-anchored (correct under both linkers), for `zod`, `@aztec/foundation/curves/bn254`, `@aztec/stdlib/abi`, `@aztec/aztec.js/wallet`, `@aztec/bb.js`, `vue`, `jsdom`, `isows`, `msgpackr`, `@logtape/logtape`, `axios`. `esm` is what vitest's externalized imports actually use: on Bun `Bun.resolveSync(spec, <ws dir>)`; on Node `import.meta.resolve(spec, pathToFileURL(<ws dir> + "/"))`, which needs `--experimental-import-meta-resolve` — the tool sets `NODE_OPTIONS=--experimental-import-meta-resolve` for the Node reference runs (Bun ignores it). `cjs` is `createRequire(join(cwd, "package.json")).resolve(spec)` for comparison. An unresolvable spec is `{ error }` (expected where the workspace does not depend on it); a MISSING `esm` record on either side fails the compare (no evidence ≠ evidence). The launcher spawns its workers with its own `execPath` (verified: workers report `versions.bun` under both pools when the launcher is Bun), so the launcher record is the runtime record.
   - Summary JSON: `{ meta: { tool: "test-soak@1", argv, cwd (repo-relative), script, runtimeMode, gitSha, gitDirty (computed with `lessons/baselines/**` excluded), runtime: {execPath, versions}, vitestVersion, pool, maxWorkers, runs, timeoutMin }, runs: [{ exitCode, wallMs, timedOut, missingJson, collected, passed, failed, skipped, todo, failing: string[], inventoryDigest }], inventory: Record<testId, { statuses: Record<status, number>, observations: number, failures: number }>, inventoryDigest, failedRuns, resolves }`, `testId = <workspace-relative file> :: <full test name>`; no absolute paths anywhere in the file.
   - `compare a b` exits **non-zero** unless ALL hold: same `gitSha`, same `vitestVersion`, same `cwd`/`script`/filters/`runs`; `a.meta.runtime.versions.bun` is absent and `b`'s is present (Node reference vs Bun candidate); identical inventories (same ids, same status set) with `observations === runs` for every id in BOTH; `b.failedRuns === 0`; no id with `b.failures > a.failures`. It prints the per-id delta, wall-clock min/median/p95 for both, and every differing `resolves.esm` entry (the four packages that declare a `"bun"` export condition — `isows`, `msgpackr`, `@logtape/logtape`, `axios` — MAY resolve differently; every difference, expected or not, is written up in the phase lessons before a gate is called green, and any difference outside those four is investigated as a potential behaviour change).
   - Committed artefacts are the summaries WITHOUT the full `inventory` map (`meta`, per-run rows, `inventoryDigest`, failing ids with counts, `resolves`); the full files stay in the gitignored `lessons/baselines/full/` for the local compare. Process spawning stays on `node:child_process` (Arc D owns `Bun.spawn`).

3. **Script flips** — every workspace `test` (`vitest run` → `bun --bun vitest run`; extension-messaging keeps `--passWithNoTests`; landing keeps its `pretest`), extension `test:components`, faucet `test:e2e` (the jsdom in-process smoke run by `_build-faucet.yml:44`) — **one commit per workspace**, so `git revert` is per package. `test:watch` (faucet, bridge-core, design) flips in the same commit as its package ONLY if that package's watch smoke passes (start → edit a test → observe the rerun → Ctrl-C → no `bun` worker survives, `pgrep`); otherwise it stays on Node with a one-line comment. **Untouched**: extension `test:e2e`/`test:e2e:all`, root `test:e2e:*`, `agent.sh`, `observability.test.ts` (Puppeteer/Node layer).

**Key interfaces / types.** `sharedTest` is a `const` object typed by inference (no `vitest` import → no runtime resolution from the root). The soak summary schema above is internal to the tool and its tests; baselines live under `implementations-plan/vitest-on-bun/lessons/baselines/{node,bun}/` (compact, committed) and `…/baselines/full/` (gitignored).

**Data & control flow (critical path).** `bun run test:all` → `bun run --filter '@nulo/*' --if-present test` (concurrent) → per package `bun --bun vitest run` → Bun executes `node_modules/vitest/vitest.mjs` and spawns `forks` workers with `process.execPath = bun` → vite transforms; the module runner imports externalized deps with `interopDefault: false` → results. `--bun` also puts a `node` symlink to Bun on the PATH of that process tree — the blast-radius boundary; no unit test spawns a process (Fact F12), so nothing else moves.

**File-level change map.**

| Change | Files |
|---|---|
| add | `vitest.base.ts`; `packages/{aztec-runtime,wallet-bridge,wallet-sdk-schema-patch}/vitest.config.ts`; `apps/landing/vitest.config.ts`; `scripts/ci-cd/test-soak/{cli.ts,lib.ts,lib.test.ts,cli.test.ts,runtime-reporter.ts,fixtures/**}`; `implementations-plan/vitest-on-bun/{lessons/phase-N.md, lessons/baselines/{node,bun}/*.json, lessons/baselines/full/.gitignore, tools/probes/sourcemap.sentinel.ts}` |
| modify (spread `sharedTest`) | `apps/{extension,faucet}/vitest.config.ts`, `apps/faucet/vitest.e2e.config.ts`, `packages/{bridge-core,design,extension-messaging,wallet-core,wallet-crypto}/vitest.config.ts` |
| modify (scripts, one commit each) | `package.json` of the 11 workspaces: `test`; plus extension `test:components`, faucet `test:e2e`; conditionally the three `test:watch` |
| modify (docs/config) | `biome.json` (includes), `CLAUDE.md` (Working in this repo: runtime + rule + soak bar), `CI.md:29`, `ARCHITECTURE.md` §14 (runtime column + the missing config rows), `packages/bridge-core/README.md:35`, `implementations-plan/bun-1.4-adoption/adoption-map.md` (stale pin-surface line, `Bun.$` overstatement, faucet in the order, Arc C status), `implementations-plan/index.md` |
| untouched by design | all `.github/**`, e2e configs, `agent.sh`, `observability.test.ts`, `bunfig.toml`, tsconfigs, `bun.lock` |

**Algorithms / non-obvious mechanics.** (i) The interop rule and why the stopgap is a class fix (any externalized ESM package whose `default` is an object Bun answers `"__esModule" in` for is collapsed; inlining zod hides one instance). (ii) Both matrices are taken at the SAME clean commit (HEAD after the flip commits): Bun via the real scripts, Node via the same-commit reference mode — the comparator's provenance checks are therefore exact, not approximate. (iii) The comparator compares complete inventories with per-run observation counts and per-id failure counts, so fewer collected tests, a test missing from some runs, changed skip/todo, or a deterministic Bun failure hiding behind a rare Node flake all fail closed. (iv) Statistical power, stated honestly: N=30 retry-0 detects a ≥10 % per-run flake with 96 % confidence and a 5 % one with 78 %; it is the agreed sampling budget, not proof of zero flakiness — which is why the concurrent `test:all` fan-out is ALSO repeated ×5 and a real-runner dispatch is required. (v) The extension aggregate is soaked N=30 FULL on both runtimes (≈1 h each, unattended) — no hand-picked shard.

**Trade-offs & alternatives not taken.**
- *`bunfig.toml` `[run] bun = true`* (outline B) — rejected: flips vite (incl. `cross-env NODE_OPTIONS=… vite build`), storybook, puppeteer and every Node-shebang tool at once, crossing the owner's e2e boundary; per-script `--bun` is explicit and revertable per line.
- *`server.deps.inline: ["zod"]`* — rejected as the primary fix: per-config, transforms ~240 zod modules per worker, hides the class. Kept as the documented fallback.
- *Wait for vitest 5 / bump to the beta* — rejected for this arc: a prerelease bump across 11 workspaces is its own review under the 7-day gate; the stopgap has a retirement trigger.
- *A `@nulo/vitest-config` workspace package* — rejected: dependency edges in 11 manifests + lockfile churn for one object; a root plain object is layout-proof at zero cost.
- *Six per-package phases each with its own gate* (plan v1) — rejected after audit: the probes de-risked the order; sequential phases add ceremony without isolation. One flip phase (per-package commits) gated by the full matrix at one commit.
- *Two stacked PRs (foundation → flips)* — rejected: the foundation is NOT inert (it changes Node interop semantics) and must ship with its evidence.
- *Node baselines BEFORE the flip commit* (plan v2) — rejected: two SHAs make provenance incomparable; the same-commit reference mode replaces it.
- *A pre-run `--root` sentinel for runtime identity* (plan v2) — rejected: relative roots and root-anchored resolution do not work from workspace cwds or under the isolated linker; a workspace-anchored reporter attached to every run replaces it.
- *A hand-picked race/timer shard* (plans v1–v2) — rejected: it covered 7 of 37 fake-timer files; N=30 full is affordable unattended.
- *Per-package `test:bun` scripts alongside `test`* — rejected: two runtimes per package is the split-result confusion recon warned about.

## Phases

### Phase 0 — Foundation (no runtime change)

- Add `vitest.base.ts`; spread it into every config; add the four minimal configs (explicit `environment: "node"`); `biome.json` includes.
- Add `scripts/ci-cd/test-soak/` (cli, lib + tests, reporter, fixtures + cli tests).
- Add `implementations-plan/vitest-on-bun/tools/probes/sourcemap.sentinel.ts` (a permanent one-file sentinel project: one deliberately failing assertion; run via `vitest run --root <abs dir>` under each runtime, the reported `file:line` must match the source — recorded in the phase lessons).
- Delete the untracked probe configs left by the pre-plan probes; add `lessons/baselines/full/.gitignore`.
- **Interop-stopgap regression check on Node, every suite**: `bun run test:all` (all 11 workspaces, concurrent) and `bun run --cwd apps/faucet test:e2e` must be green with the base spread in — the evidence that nothing in the repo depends on vitest's interop fallback (the aggregate alone was verified in the probes).

Validation gate — commands: `bun run lint && bun run typecheck:all && bun run test:all && bun run --cwd apps/faucet test:e2e && bun run test:ci-gating` (the last runs `lib.test.ts` + `cli.test.ts`, i.e. the crash/hang/unhandled/no-json fixtures prove the tool reports failure). Pass: all exit 0. Layers: lint/typecheck · unit (all workspaces) · bun:test.

### Phase 1 — Flip + full matrix at one commit + real-runner dispatch

- Per-workspace flip commits (11 `test` scripts; extension `test:components`; faucet `test:e2e`; the three `test:watch` conditionally after their watch smokes). HEAD after the last flip commit is the **matrix commit**; the tree must be clean when the soaks run.
- Soak matrix at the matrix commit, both runtimes, retry-0, sequential (one soak at a time): for each of `apps/landing`, `packages/wallet-bridge`, `packages/wallet-sdk-schema-patch`, `packages/aztec-runtime`, `packages/bridge-core`, `packages/wallet-core`, `packages/wallet-crypto`, `packages/extension-messaging`, `packages/design`, `apps/faucet` (`--script test`), `apps/faucet` (`--script test:e2e`), `apps/extension` (`--script test`): `--runs 30 --runtime node` → `lessons/baselines/node/<name>.json` and `--runs 30 --runtime script` → `lessons/baselines/bun/<name>.json`; then `compare` for all 12 pairs.
- `for i in 1 2 3 4 5; do bun run test:all || exit 1; done` (the concurrent CI shape under Bun).
- Push the branch and dispatch the real runner: `gh workflow run pr-quick.yml --ref worktree-vitest-on-bun` (dispatch forces `full=true`, `pr-quick.yml:149-151`). Bind the evidence to the matrix commit, race-proof: `gh run list --workflow pr-quick.yml --event workflow_dispatch --branch worktree-vitest-on-bun --json databaseId,headSha,status,conclusion` → the run whose `headSha` equals the matrix commit; `gh run watch <id>`; `gh run view <id> --json jobs` → the job named `quality-status` has `conclusion: success`. "Latest run" or the run-level conclusion is not evidence.
- **Matrix commit rule (provenance).** All Phase 1 evidence is bound to ONE commit. Any change after it to anything executable or configuration — a test, a source file, a `vitest.config.ts`, `vitest.base.ts`, a `package.json`, the soak tool, `biome.json` — invalidates the matrix: re-run the full matrix (both runtimes, all 12 suites), the `test:all` ×5 loop and the dispatch at the new commit. This includes fixes from the post-implementation code-review/codex loop. The final PR HEAD may differ from the matrix commit ONLY by the documentation allowlist: `*.md` anywhere, `implementations-plan/**` (incl. the committed baseline summaries), `CLAUDE.md`, `CI.md`, `ARCHITECTURE.md`. The PR body names the matrix commit.

Validation gate — commands: the 12 Node soaks, the 12 Bun soaks, the 12 `compare`s, the `test:all` ×5 loop, `bun run audit:vue`, `bun run build:faucet`, `bun run test:e2e` (extension smoke — still Node, proves the untouched path), `bun run lint && bun run typecheck:all && bun run test:ci-gating`, and `gh run watch <dispatch run id>` → `gh run view <id> --json conclusion`. Pass: every Node summary has `failedRuns: 0` (a non-zero Node reference is a pre-existing unit-layer flake → **STOP**, owner disposition — a flake budget is policy); every Bun summary's `meta.runtime.versions.bun` is `1.4.0` and every Node summary's is absent; every `compare` exits 0; `test:all` ×5 all exit 0; `audit:vue`, `build:faucet`, smoke e2e, lint/typecheck, ci-gating exit 0; the dispatched run bound to the matrix commit has a `quality-status` job with `conclusion: success`; every `resolves.esm` difference is written up and every difference outside the four `"bun"`-condition packages is investigated. **Failure procedure (a Bun-only failure is a migration blocker, never a flake to retry)**: reproduce solo → minimal `bun -e` / `node -e` diff → classify: (a) a Node-specific test assumption (message text, stack shape, `process.versions`) → make the test runtime-neutral in its own commit — which, per the matrix commit rule, means the FULL matrix, the ×5 loop and the dispatch are re-run at the new commit; (b) a product/dependency divergence (a KAT mismatch, module semantics) → revert that package's flip commit, keep a minimal reproducer in `lessons/`, and **STOP for the owner** (abort vs reduced-scope replanning — the Done criterion changes). **Never** `skipIf(process.versions.bun)` or any runtime-conditional skip — that is a silent gate weakening. Layers: unit/component (all) · build · smoke e2e · lint/typecheck · bun:test · real CI runner.

### Phase 2 — Docs + dossier corrections

- CLAUDE.md "Working in this repo": one bullet — unit/component suites run on the Bun runtime via `bun --bun vitest run`; e2e stays Node; the interop stopgap, its retirement trigger and the `viteModuleRunner` never-flip; the soak tool and the N=30 retry-0 same-commit bar as the standard for any future runtime change.
- `CI.md:29` (landing is included; runtime note; the runtime is now PINNED by `setup-bun` where Node was runner-ambient), `ARCHITECTURE.md` §14 runtime column + the three missing config rows, `packages/bridge-core/README.md:35` clarification (vitest-under-Bun ≠ `bun:test`), adoption-map corrections + Arc C status, `implementations-plan/index.md`.

Validation gate — `bun run lint && bun run test:ci-gating`; `git diff --stat 6fe41b46..HEAD -- . ':!implementations-plan'` reviewed against the change map (nothing outside it; `bun.lock` and `.github/**` untouched). Pass: exit 0, map matches. Layers: lint · bun:test.

## Security & Adversarial Considerations

- **Threat model.** Test infrastructure only: which JavaScript engine executes the existing test code. No new network surface, no secrets, no build-output change (`vite build` scripts untouched — production bundles stay Node-driven and the product runs in the browser).
- **Supply chain.** Zero dependency changes; `bun.lock` untouched; the 7-day min-age and `--frozen-lockfile` CI unaffected. `bun --no-install` in the soak tool forbids Bun's auto-install during a soak. `bun --bun` executes the already-installed `vitest` bin — the bytes CI installs.
- **What we trust that we should name.** (a) Bun's resolver may select `"bun"` conditional exports — four externalized packages declare one (`isows`, `msgpackr`, `@logtape/logtape`, `axios`); their entry files differ under Bun, recorded by the reporter and expected in the compare; anything else that differs is investigated. (b) `--bun` symlinks `node` to Bun for the process tree; no unit test spawns a process (F12). (c) `interopDefault: false` removes vitest's named-export fallback for CJS deps; each runtime's own loader then decides — the same-commit Node references on every suite are the proof nothing depends on the fallback.
- **Evidence integrity.** Committed baselines are self-attesting, so every summary carries provenance (argv, repo-relative cwd, script, runtime mode, git SHA + dirty flag, runtime record from the reporter, vitest version, pool/workers, per-run exit codes and inventory digests) and the comparator refuses SHA/version/runtime-identity/argument drift; both matrices come from one clean commit; no absolute paths in committed files (the pre-commit brand/path guard also enforces it).
- **Least privilege.** No workflow permission changes (no YAML changes at all). No new CI variables. The `workflow_dispatch` uses the existing `pr-quick.yml` with its existing permissions.
- **Gate integrity.** The three required checks keep being produced by the same jobs; nothing becomes advisory. The soak tool is a local/plan gate, not a CI gate — it never weakens or replaces `quality-status`; its own ability to fail is asserted by `test:ci-gating` on every CI run. Runtime-conditional skips are forbidden.
- **Crypto tests under a second engine.** wallet-crypto's KATs mix `node:crypto` (`hkdfSync`, `createHash`) with WebCrypto; a KAT mismatch is a wrong answer, never a flake — a hard stop (failure procedure (b)).
- **Run isolation.** Soaks run one at a time in the owning worktree; each child is its own process group, killed as a group on timeout/signal; temp dirs are per run under the OS temp dir and removed; nothing under a shared fixed path; no port or service is involved.

## Assumptions

**Facts (verified).**
1. Every workspace `test` script is `vitest run` (extension-messaging: `vitest run --passWithNoTests`; landing has a `pretest`); `test:all` = `bun run --filter '@nulo/*' --if-present test` (`package.json:31`), concurrent; `_unit-tests.yml:25` runs it; no workflow YAML names `vitest` (recon).
2. `bun --bun vitest run` runs the launcher AND workers on Bun 1.4.0 under both `threads` and `forks` (probes § 2); `bun run --cwd <ws> test -- --reporter=json --outputFile=<f>` forwards the flags through the script and runs `pretest` (checked on landing: JSON written, 3 tests).
3. Bun answers `"__esModule" in <ESM namespace>` = `true` (`Object.hasOwn` = false); Node = `false` (probes § 3; fable re-verified). vitest 4.1.10's `interopModule` (`node_modules/vitest/dist/module-evaluator.js:336-349`) collapses on that test; `shouldInterop` (`:241-246`) applies to `.js`+`type:module` files. Upstream fixed it in #10363 (5.0.0-beta.3).
4. With `deps.interopDefault: false` the extension aggregate is 372 files / 4,635 tests / 2 skipped / 7 todo on BOTH runtimes — test-set-identical (probes § 3b); without it Bun fails 124 files, all `z.*` on undefined.
5. Single Bun runs are identical to Node for landing, bridge-core, wallet-crypto, aztec-runtime (incl. the 7 bb.js-WASM node-only files the aggregate excludes, `apps/extension/vitest.config.ts:52-70`), wallet-core, extension-messaging, design; wallet-bridge/schema-patch/faucet fail only on the interop rule (probes § 1, § 3c).
6. No coverage tooling is declared, resolved, configured or invoked anywhere; no reporter output is consumed by CI (recon).
7. Unit CI installs Bun only (`_unit-tests.yml` → `setup-bun`); the Node that runs vitest today is the runner image's ambient, unpinned Node (locally 24.18.0 via nvm) — after the flip the test runtime is pinned by `setup-bun/action.yml:17`. Node 24 is pinned only by `setup-aztec` for the Aztec CLI; puppeteer e2e is a separate, Node-only layer.
8. No unit test or vitest config reads a `.env` file; three `process.env` reads are CI/dev-injected skip guards and one (`NULO_FUZZ_RUNS`) is a run-count knob (recon).
9. vitest 4.1.10 (lockfile; manifests say `^4.1.9`), vite 8.1.4, jsdom 29.1.1 (`bun.lock:2243, 2235, 1631`); `experimental.viteModuleRunner` defaults `true` (`cli-api.*:9263`) and `false` needs `module.registerHooks`, absent on Bun (`native.*:49-50`).
10. `scripts/ci-cd/*.test.ts` run in CI via `test:ci-gating` (`_unit-tests.yml:38-48`; `bun test scripts/ci-cd/` recurses into subdirectories); `scripts/**` is outside biome's includes (`biome.json:6-16`).
11. Watch mode boots on Bun, completes an initial pass (design 37/313) and leaves no orphan after SIGTERM (probes § 3d).
12. No unit-layer test file spawns a process (`child_process|execSync|spawnSync` over test files: 0 — fable's grep), so `--bun`'s `node`→Bun PATH rewrite has no consumer beyond vitest itself.
13. `pr-quick.yml` has `workflow_dispatch` (line 4) and a dispatch forces `full=true` (149-151); nextTick/microtask/immediate/timeout ordering is identical on both runtimes (fable's probe); forks + `isolate: true` gives each test file a fresh process (no cross-file fake-timer leak by construction).

**Inferences (unverified — attack these).**
- I1. N=30 retry-0 soaks will show zero failures on Bun for every suite (single runs were identical; the race-dense suites are the risk). A hypothesis with stated power, not an expectation: the gate is fail-closed.
- I2. `interopDefault: false` regresses nothing in the suites the aggregate does not cover (faucet ×2, bridge-core, landing, design's own run) — Phase 0's Node runs verify before any flip.
- I3. Watch mode survives edit → rerun → Ctrl-C on Bun for the three packages; otherwise those `test:watch` scripts stay on Node.
- I4. `apps/faucet/src/test/setup.ts`'s `process` shim is a no-op on both runtimes (fable verified: `typeof globalThis.process` is defined under vitest's jsdom env on both).
- I6. vitest's pool sizing under Bun on the CI runner may differ from Node's — a difference can cause races/OOM/worker exits, not just timing; hence sizing is recorded, the concurrent `test:all` fan-out is repeated ×5, and the real runner is dispatched.

**Asks.**
- A1 (technical, codex-converged): `interopDefault: false` repo-wide via the root object — chosen.
- A2 (technical, codex-converged): one PR; foundation commit + per-package flip commits + docs commit — chosen.
- A3 (technical, converged codex+fable): `test:watch` flips only behind a passing watch smoke per package — chosen.
- A4 **Owner**: the defect is fixed upstream (#10363, 5.0.0-beta.3) — comment on #10359 to request a 4.x backport, or wait for vitest 5 stable; the stopgap is retired when the installed vitest contains the fix.
- A5 **Owner**: a non-zero Node reference (a pre-existing unit-layer flake) stops the arc for your disposition.
- A6 **Owner (already ruled in the goal)**: e2e stays on Node this arc; `@aztec/*` untouched; required checks untouched.
- A7 **Owner (raised only if it happens)**: a genuine Bun defect that keeps a package on Node changes the Done criterion — abort vs reduced-scope replanning.
- FYI **Owner**: after the flip the CI test runtime is pinned (Bun 1.4.0 via `setup-bun`) where before it was the runner image's unpinned Node — a reproducibility gain worth knowing.

## Decision ledger

| Decision | Chosen | Rejected alternatives (why) | Source |
|---|---|---|---|
| Countermeasure for the interop defect | `test.deps.interopDefault: false` via a root plain-object base, with the retirement trigger tied to vitest #10363 and the `viteModuleRunner` never-flip | inline zod (per-config, hides the class); wait for / bump to vitest 5 beta (its own review); `@nulo/vitest-config` package (11 dependency edges) | plan v1 + codex r1 + fable (a) |
| How scripts flip | per-script `bun --bun`, one commit per workspace | outline B `[run] bun = true` (flips vite/storybook/puppeteer, crosses the e2e boundary); a single flip commit (no per-package revert) | codex r1 (High) + fable (b)(c) |
| Rollout shape | foundation phase → one flip phase gated by the full matrix at ONE clean commit + `test:all` ×5 + real-runner dispatch → docs | six per-package phases (ceremony without isolation); outline B's one big gate WITH `[run] bun` | codex r1 + fable (c)(4) |
| PR topology | one PR | two stacked PRs (the foundation is not inert on Node) | codex r1 |
| Baseline provenance | both matrices at the same clean commit: Bun via the real scripts, Node via the same-commit reference mode (`bun --bun ` stripped); `gitDirty` ignores `lessons/baselines/**` | Node baselines before the flip commit (two SHAs → incomparable); a tested-input digest (machinery for no gain) | codex r2 (High) |
| What is soaked | the REAL `test` script (`pretest`, `--passWithNoTests`, the flipped string) | a composed `vitest run` (not the CI string) | fable (2) |
| Runtime identity + resolution evidence | a vitest reporter passed by path, attached to every run, resolving from the workspace's `package.json` with real subpaths | a pre-run `--root` sentinel (relative root, root-anchored resolution, root exports that do not exist) | fable (f) + codex r2 (High) |
| Child-process control | async `spawn` + `detached` process group + timer + group kill; enforced flags last; reserved flags rejected; `outputFile` inside the temp dir | `spawnSync` (cannot forward signals or kill the worker group; timeout kills only the direct child) | codex r2 (High/Med) |
| Gate acceptance rule | identical inventories with per-run observations + `failedRuns: 0` + no per-id regression + provenance/runtime-identity match; `compare` exits non-zero; `failedRun := exit≠0 ∨ !success ∨ missing JSON ∨ timeout` | "no failing id absent from Node's" (misses fewer collected tests, skip/todo changes, tests missing from some runs, masked deterministic failures) | codex r1–r2 + fable (1) |
| Extension gate | N=30 FULL aggregate on both runtimes | N=10 full + a hand-picked shard (covered 7 of 37 fake-timer files) | fable (g), superseding codex r1 |
| Explicit probes | source-map sentinel (permanent file); the tool's failure modes as permanent `bun:test` fixtures | cross-file fake-timer + nextTick ordering probe (moot: fresh process per file; ordering verified identical) | fable (h), amending codex r1 |
| Non-zero Node reference | STOP, owner disposition | "becomes the bar" (a flake budget is policy) | codex r1 + fable |
| A package that must stay on Node | STOP for the owner (abort vs reduced scope) | silently amend Done | codex r2 |
| `test:watch` | flip behind a passing per-package watch smoke | flip unconditionally (codex: untested); leave on Node unconditionally (fable: split-result confusion) | codex I3 ↔ fable (e), resolved |
| Committed evidence | compact summaries (no full inventory, no absolute paths); full files gitignored | full JSON in the repo (~13 large files, absolute paths) | fable (iii) |
| Upstream action | none to file; owner chooses backport-request vs wait | file a new issue (duplicate of #10359) | codex r1 — verified |
| Post-matrix provenance | ONE matrix commit; any executable/config change after it (incl. post-impl review fixes) re-runs the full matrix + ×5 loop + dispatch; PR HEAD may differ only by a documentation allowlist | re-soak only the touched workspace (breaks "one clean commit") | codex r3 (High) |
| Node reference lifecycle | strict script grammar + explicit `pre<script>`/`post<script>` execution | bare stripped command (skips landing's `pretest`) | codex r3 |
| Resolution evidence | ESM resolution (`Bun.resolveSync` / `import.meta.resolve(spec, wsURL)` under `--experimental-import-meta-resolve`) + CJS alongside; missing ESM record fails the compare | `createRequire().resolve` only (measures the CJS resolver vitest does not use for externalized imports) | codex r3 |
| Dispatch evidence | the run bound by workflow + event + branch + `headSha == matrix commit`, and the `quality-status` JOB conclusion | "latest run" / run-level conclusion (can attach another dispatch) | codex r3 |
| Fixture execution | through `apps/landing` (declares vitest) with `--root <fixture>` | root-anchored launch (no vitest at the root under the isolated linker) | codex r3 |

Unresolved disagreements after codex r1–r3 and fable r1: none.

## Audit verdicts

- Codex round 1 (session `01a035c3-…`): **conditional approve** — all conditions adopted.
- Fable round 1: **conditional approve** — all conditions adopted; the one conflict (`test:watch`) resolved by the conditional flip.
- Codex round 2 (resumed, v2): **conditional approve** — all conditions adopted in v3.
- Codex round 3 (resumed, v3): **conditional approve** — five refinements, all adopted in v4; "no new owner ask is needed beyond those already recorded".
- Fresh-context codex final pass: pending.

## Post-implementation

Executed by the implementing session from THIS section (self-contained):

1. **`/code-review max --fix`** on the whole implementation diff (single arc: `git diff 6fe41b46..HEAD -- . ':!implementations-plan'`) → skim the applied fixes → commit them SEPARATELY from implementation commits (`fix(review): …`).
2. **Codex audit** (`/codex xhigh`, fresh session): the net diff from plan baseline, a summary of the code-review commits, this plan.md + the decision ledger, the adversarial/security ask ("what could go wrong, what would an attacker target, what are we trusting that we shouldn't, where are the supply-chain / least-privilege weaknesses"), and verbatim:
   - *No-over-engineering rule:* "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - *Comment-quality rule:* "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Iterative fix loop**: verify codex's factual claims against the repo first; apply accepted fixes; commit; log the round (consult + verdict) in `lessons/post-impl.md`; RESUME the same codex session with the fix diff for re-review. Repeat until a round yields no new material findings. Still material after 3 rounds → stop and surface to the owner (scope smell).
4. **Re-gate if the loop touched anything executable** (matrix commit rule): any code-review or codex fix outside the documentation allowlist invalidates the Phase 1 evidence → re-run the full matrix, the `test:all` ×5 loop and the dispatch at the new HEAD, and refresh the committed baseline summaries, BEFORE delivery.
5. **Delivery** (below) — the FIRST time a PR is opened.

## Delivery

Single arc → one branch (`worktree-vitest-on-bun`), one PR to `dev` via `gh pr create` — opened only after the loop above converges. Title (≤ 93 chars, conventional): `feat(test): run every vitest suite on the bun runtime (interop stopgap, soak baselines)`. Body: what flipped, the interop rule + upstream status in three sentences, the baseline table (Node vs Bun, 12 suites, same commit), the real-runner dispatch result, what stayed on Node and why, the owner asks (A4) and the FYI (pinned runtime). Then `gh pr checks --watch`; merging is the owner's.

Rollback: revert a package's flip commit; the base object stays (semantics proven on Node on every suite).

## Seeds (DRAFT — finalized after the approval gate)

```
/goal All phases (0–2) marked ✓ in implementations-plan/vitest-on-bun/plan.md (the per-phase headers in the file, not the chat), each ✓ backed by its phase's validation gate as written there reported passing in the transcript (12 Node + 12 Bun soak summaries at one commit with failedRuns: 0, 12 `compare`s exiting 0, test:all ×5 green, the dispatched pr-quick.yml quality-status success); for each phase the agent has printed `LESSONS_FILE=implementations-plan/vitest-on-bun/lessons/phase-N.md`; `/code-review max --fix` complete with findings applied and committed separately; the codex fix loop converged — a resumed codex pass reporting no new material findings, quoted in the transcript; ONE PR to dev exists, created only after convergence (`gh pr view` output in the transcript) with quality-status green; `bun run test:all` and `bun run lint` both exit 0 in the transcript. Reserved for the owner: merging, the upstream backport request, a non-zero Node reference, a package that must stay on Node, anything touching @aztec/* or required checks.
```

```
/loop 15m Drive implementations-plan/vitest-on-bun forward. Never idle waiting for my input. Each firing: (1) read plan.md + lessons/ (authoritative), `git status`, `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup`. (2) Waiting on a soak, a dispatch or CI is fine — confirm it is progressing; use the wait to prepare the next step. (3) No task in hand? take the next pending step from plan.md; after each edit run `bun run lint` + the touched workspace's `bun run --cwd <ws> test`; commit → push. (4) A decision you'd bring to me? call `/codex xhigh` with full context, iterate to a defensible decision, act, log the consult in lessons/phase-N.md; never merge, never post upstream, never touch @aztec/* or required checks; a non-zero Node reference or a package that must stay on Node → stop and surface. (5) Same step failed 5×? stop, reassess with codex. (6) Phase green = its validation gate in plan.md passes as written: paste the result, mark ✓, write the lessons entry, print `LESSONS_FILE=…`, advance. (7) All phases ✓? run the Post-implementation section (code-review → codex loop → delivery), write the wrap-up (every codex-debated decision with ELI5 context), surface and stop.
```
