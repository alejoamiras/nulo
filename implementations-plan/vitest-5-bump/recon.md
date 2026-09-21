# vitest-5-bump — recon (Phase 0.4)

Read-only sweep of `dev` at `25062c06` (one `Explore` agent over the repo + upstream research on vitest 5.0.x / jsdom 30.x), consolidated by the driver. Paths are repo-relative.

## Reuse map

| Capability the plan needs | What exists | Verdict |
|---|---|---|
| A single seam for shared vitest options | `vitest.base.ts` — `sharedTest` (one key: `deps: { interopDefault: false }`, the vitest-4 stopgap), spread by **15** configs (every unit/component config; not the three Node e2e configs, not the historical `audit/bugs/…/proofs` config); named explicitly in `biome.json` `includes` | **delete with the stopgap** — nothing shared remains once the key goes (the harvest ships no runtime-config key), so the file, the 15 spreads + imports and the biome include go; the next shared option recreates it |
| Per-workspace vitest configs | 18 real configs (13 workspaces incl. the three Node e2e configs, `apps/tools/vitest.e2e.config.ts`, `packages/bridge-core/vitest.integration.config.ts`); 6 soak fixture configs | **reuse-as-is** — no config re-declares `deps`; nothing to rewrite for v5 (no `poolOptions`, `coverage`, `browser`, `sequence`, `experimental`, `environmentOptions`, `vitest.workspace.*`, `defineProject`/`mergeConfig` anywhere) |
| Runtime-parity evidence (the gate for any test-runtime change) | `scripts/ci-cd/test-soak/` — `soak` / `compare` / `compact`, fail-closed, inventory-exact; its own failure modes proven by `bun run test:ci-gating` on every CI run | **reuse-as-is** — the tool needs no change for v5 (it passes `--outputFile` explicitly, so v5's new `.vitest/json/output.json` default never applies); only the constant `BASELINES_DIR` (`cli.ts:39`) names the evidence home |
| Stored soak baselines | `implementations-plan/vitest-on-bun/lessons/baselines/{node,bun}/*.json` — 12 compacts per engine, all `vitestVersion: "4.1.10"`, `runs: 30`, commit `e10cc91e` | **adapt** — reusable as a *name-diff* reference only. `compareSummaries` → `checkMeta` (`lib.ts:291-305`) requires identical `gitSha`, `lockfileSha256`, `vitestVersion`, `runs` on both sides, so a vitest-5 candidate can never be compared against them; both engines must be re-recorded at the matrix commit. Two files carry the pre-rename workspace name (`faucet.json` / `faucet-smoke.json` = `apps/tools` `test` / `test:e2e`) |
| A workspace-wide launcher | `test:all` → `bun run --filter '@nulo/*' --if-present test` (what `_unit-tests.yml` runs, unconditionally on every PR) | **reuse-as-is** |
| Bun-runtime convention (`bun --bun vitest run` + `sharedTest`) | 13 of the 14 vitest-bearing workspaces follow it | **adapt** — `packages/resolve-asset` has neither a `vitest.config.ts` nor `--bun` (`package.json:12` is `vitest run`; created in #454, before the runtime arc #459, never folded in). `packages/legal` and `packages/third-party-notices` follow the convention (added in #627/#641) but were never soak-baselined; neither was the extension's `test:components` script |
| Mock hygiene between tests | `apps/extension/tests/vitest.setup.ts:79-84` — `afterEach` → `vi.unstubAllGlobals()` + `vi.clearAllMocks()` + `sendMessageMock.mockClear()`; no other workspace clears mocks centrally | **reuse-as-is** — v5's `clearMocks: true` default makes every workspace behave like the extension already does |
| Custom reporters | `apps/extension/tests/e2e/retry-error-reporter.ts` (class implementing `Reporter`, `onTestCaseResult`, types from `vitest/node`) via `e2eReporters()` in `apps/extension/vite.shared.ts:72` (re-adds `github-actions` by hand because explicit `reporters` suppresses the auto-added one); `scripts/ci-cd/test-soak/runtime-reporter.mjs` (`onInit(ctx)` only) | **reuse-as-is** — v5 keeps the Reported Tasks API and `vitest/node`; typecheck is the proof |
| `globalSetup` contract | `apps/extension/tests/e2e/global-setup{,-smoke}.ts`, `packages/bridge-core/test/integration/global-setup.ts` — `TestProject` from `vitest/node`, `project.provide`, default-export-returns-teardown | **reuse-as-is** |
| Node-side DOM/global shims | `apps/tools/src/test/setup.ts`, `packages/bridge-core/src/test/setup.ts` (same `process`/`global`/`Buffer` shim; the bridge-core copy's comment says "jsdom provides DOM" although that workspace runs `environment: "node"`), `packages/extension-messaging/src/testing/setup.ts` (fake-browser reset) | **reuse-as-is** (+ one stale-comment fix) |
| Renovate grouping | `renovate.json:30` `test-runner` group: `vitest`, `@vitest/coverage-v8`, `@vue/test-utils`, `jsdom` | **reuse-as-is** — nothing new to install (no `@vitest/*` package is a direct dependency; storybook's nested `@vitest/*@3.2.4` is its own and untouched) |
| The prior major-bump precedent | `implementations-plan/vitest-vite8-dedupe/`, `vitest-vite-bumps/`, `dependency-hardening/` Phase 5 — vitest 3→4 broke arrow-function constructor mocks; `biome.json:76-82` already turns `useArrowFunction` off for test globs | **reuse-as-is** as the failure taxonomy template |
| An age-gate-respecting install | `bunfig.toml` `minimumReleaseAge = 604800`; a `package.json` edit re-gates young locked versions (SECURITY.md, #656) | **reuse-as-is** — sets the calendar below |

No `build new` entries: the bump adds no tooling.

## Version facts (upstream, verified 2026-09-21)

| Package | Locked | Target | Published | Passes the 7-day gate |
|---|---|---|---|---|
| `vitest` | 4.1.10 (manifests say `^4.1.9`) | **5.0.1** | 2026-09-15 08:49 UTC | **2026-09-22 08:49 UTC** |
| `vitest` | | 5.0.0 | 2026-09-03 | already |
| `jsdom` | 29.1.1 | **30.1.0** | 2026-09-17 00:57 UTC | **2026-09-24 00:57 UTC** |
| `jsdom` | | 30.0.1 | 2026-07-29 | already — but 30.0.0/30.0.1 carry a `querySelectorAll` regression fixed only in 30.1.0 (first-compound-matches-self returns nothing), so 30.0.x is not a target |
| `vite` | 8.2.1 | unchanged | | v5 peer `^6.4.0 \|\| ^7 \|\| ^8` ✓ |
| Node (local `/usr/bin/node`) | 24.12.0 | | | vitest 5 needs ≥ 22.12 ✓; **jsdom 30 `engines.node` is `^22.22.2 \|\| ^24.15.0 \|\| >=26`** — 24.12 is below the floor (Bun ignores `engines`; every Node execution in the plan — the soak fixtures in `test:ci-gating`, the Node reference side, the Node smoke e2e — needs a Node ≥ 24.15 on the host). CI is not uniform: only `.github/actions/setup-aztec` sets Node (`setup-node@v7`, `node-version: 24`, which resolves a cached or latest 24.x — not guaranteed newest); `_unit-tests.yml` runs on Bun and the smoke workflow uses the runner image's Node. Actual versions get recorded, not assumed |

`vitest` is declared in **14** `package.json` files (`apps/{extension,landing,tools}` + 11 packages), `jsdom` in 6 — 20 manifest edits.

`@vitest/runner` and `@vitest/expect` are inlined into `vitest` in v5 (no 5.x `@vitest/runner` exists); nothing in the repo imports `@vitest/*` directly (0 hits). Entry points used: `vitest/config` (18), `vitest/node` (4) — both survive v5; the removed ones (`vitest/coverage`, `vitest/reporters`, `vitest/environments`, `vitest/snapshot`, `vitest/runners`, `vitest/suite`, `vitest/mocker`) are unused.

## vitest 5.0.0 breaking changes vs this repo (grep-verified)

| Change (PR) | Repo exposure | Consequence |
|---|---|---|
| `clearMocks: true` by default (#10613) | 230 test files assert call history; extension already clears in `afterEach`; other workspaces don't | Behavior change is a **test-isolation improvement** — keep the default; a test that depended on calls carried over from an earlier test fails and gets fixed, never `clearMocks: false` |
| Unawaited `resolves`/`rejects`/`toMatchFileSnapshot` fail the test (#10868) | 15 lines hold a `.rejects` assertion in a variable to await later (e.g. `apps/extension/src/stores/balances.store.test.ts:198,617`) — those ARE awaited; `toMatchFileSnapshot` unused | Catches silently-vacuous assertions; any real offender is a test bug to fix |
| `test.for/each` `$var` titles lose their quotes (#10170) | 12 sites interpolate `$name`/`$site`/`$label`… (`apps/extension/src/components/Header.test.ts:148`, `packages/bridge-core/src/claim-secret.test.ts:52`, `scripts/ci-cd/decide-gate.test.ts:79`, …) | Test **ids change** → the stored 4.1.10 inventories differ by name for those tests; irrelevant once both sides are re-recorded on v5 |
| Hoisted `vi.mock`/`vi.hoisted` outside top level throw (#10460) | 0 indented `vi.mock(`/`vi.hoisted(` | none |
| `test.sequential` / `describe.sequential` removed (#10198) | 0 hits | none |
| `-t` uses `>` separator (#10686) | no script passes `-t` | none |
| `VITEST_POOL_ID` / `VITEST_WORKER_ID` 1-based | 0 hits in source | none |
| `toThrow("")` matches any error | 0 hits | none |
| Class mocks keep the implementation's prototype | 13+ files use `vi.fn(function () { return mock })` (constructor returns an explicit object → unaffected) | verify by running; no rewrite expected |
| Config file no longer looked up from ancestors (#10428) | root has no `vitest.config.*`; `packages/resolve-asset` has no config and never found one either | none — but resolve-asset gets a config anyway (convention) |
| Reporter outputs default to `.vitest/` (#10232) | soak passes `--outputFile` explicitly; no script uses `--reporter=json` otherwise | add `.vitest/` to `.gitignore` (root) |
| `expect.poll` rejects on timeout (#10233) | 8 sites, all Node e2e / Playwright specs | intended semantics; none rely on a hang |
| Temporal mocked with fake timers (#10654) | 0 `Temporal.` hits | none |
| DOM assignments propagate to the jsdom/happy-dom window; `populateGlobal` returns descriptors (#10373) | `apps/extension/src/composables/useDappApprovalWindow.test.ts:63-64,81-82` and `apps/extension/src/popup/windows/capabilities/index.test.ts:165-166` replace `window.addEventListener`/`removeEventListener` with spies and restore the natives by assignment; 10 `Object.defineProperty(window\|globalThis\|…)` sites; 24 test files assign into `window`/`globalThis`/`document` (mostly `document.body.innerHTML = ""`) | **fallout unknown** (codex r1) — these are targeted probes in Phase 1, classified per red, never presumed test bugs |
| Fix: cjs interop for truthy `__esModule` (#10363) | **the stopgap's retirement trigger** (`vitest.base.ts:8-13`, `implementations-plan/vitest-on-bun/lessons/upstream-vitest-interop.md`) | delete `deps: { interopDefault: false }`; the Bun soak proves the zod-style failure class stays fixed (a 5-file reproducer is preserved in that lessons file) |
| `experimental.viteModuleRunner` | never written; CLAUDE.md says never flip to `false` (needs `module.registerHooks`, absent on Bun) | re-verify the key still exists in 5.0.1's `ResolvedConfig` types after install; the never-flip rule stands either way |

## vitest 5 / jsdom 30 features — harvest candidates

| Feature | Fit here | Verdict |
|---|---|---|
| `clearMocks` default on | every workspace gains the extension's mock hygiene for free | **adopt** (by not opting out) |
| Unawaited async assertions fail | catches vacuous tests | **adopt** (by not opting out) |
| `vi.when(spy).calledWith(x).thenReturn(y)` (#10174) | 17 `mockImplementation((arg) => …)` lines branch on their arguments | **adopt where it reads better**, at those sites only; new tests use it for argument-keyed mocks (convention line in CLAUDE.md) |
| `vitest doctor` — runs the suite under alternative configs (`isolate: false`, pools, `fsModuleCache`) and reports measured deltas | 16 suites, `pool: "forks"` everywhere, `isolate` default | **measure only in this PR** (codex r1): doctor's numbers are warm and it spawns with `process.execPath`; a runtime-config change is a 30-run-bar change with order-variation checks — a follow-up plan, if the numbers justify one. Expected answer "no": a jsdom suite with per-file `vi.stubGlobal` state is the obvious `isolate:false` casualty |
| `fsModuleCache` (opt-in, persists transformed modules under `node_modules/.vitest-cache` per v5's types — codex r1; verified at install) | speeds reruns; CI runners are cold; `test:watch` is Node-only | **measure only** (same as above) |
| GitHub Actions job summary from the `github-actions` reporter (#10891) | auto-added when `GITHUB_ACTIONS` is set and no explicit `reporters` — true for every unit config; the e2e configs re-add it by hand | **free** — verify it appears on the bump PR's `unit-tests` job; a custom title is optional |
| `configDefaults.reporters` exported from `vitest/config` (#10219) | `apps/extension/vite.shared.ts:72` `e2eReporters()` re-adds `github-actions` by hand behind a `GITHUB_ACTIONS` check | **adopt** — `[...configDefaults.reporters, new RetryErrorReporter()]`; Node e2e configs only, proven by the smoke run (codex r1) |
| `--repeats N` (in-process repetition) | flake hunting inside one process; the soak covers cross-process | note in the soak README as the cheap first probe; no plan step |
| `-p` shorthand, nested projects, shared Vite server between inline projects | the repo runs one vitest process per workspace via `bun run --filter`; that per-process shape IS what CI and the soak measure | **not harvested** — collapsing into one root `projects` run is a different plan (topology change, new evidence shape) |
| `test.for`, `Temporal` mocking, benchmark API, browser mode, coverage changes, UI auth, `toMatchTextContent` | unused surfaces | none |
| jsdom 30.x: perf (DOM construction, mutations, `getComputedStyle`, event dispatch), memory (observers, listeners), `CSS.escape`/`CSS.supports`, `QuotaExceededError` for oversized `crypto.getRandomValues()`; behaviour shifts in computed-style serialization, mutation-observer ordering, retained DOM references after `window.close()`, suppressed post-close activity | 7 jsdom suites; `wallet-crypto` calls `getRandomValues` with small buffers (the change says nothing about `crypto.subtle`, so the KATs are run as targeted probes, not assumed) | free where it is free; the lifecycle/style tests and the KATs are on Phase 1's targeted-probe list. The soak's wall-clock lines compare Node-v5 to Bun-v5 only — they cannot show a v4→v5 delta |
| jsdom 30.0.0: Node floor `^22.22.2 \|\| ^24.15.0` | local Node 24.12 | host prerequisite for the Node reference side |

## Conventions to match

- Configs stay tiny: `test: { ...sharedTest, environment, setupFiles, include/exclude, server.deps }`; comments cite the upstream mechanism (issue/PR numbers) rather than restating docs.
- Never `skipIf(process.versions.bun)`; a Bun-only red is (a) a test-assumption bug → fix + re-run the matrix at the new commit, or (b) a real divergence → STOP for the owner (`implementations-plan/vitest-on-bun/plan.md` taxonomy).
- The **matrix-commit rule**: every executable byte (tests, configs, `package.json`, `bun.lock`, the soak tool, `biome.json`) binds to ONE commit; PR HEAD may differ from it only by `**/*.md` and the baseline JSONs. A post-implementation review fix that touches an executable re-runs the matrix.
- Soak hygiene (`vitest-on-bun/lessons/phase-1.md`): idle host (load < 4 for 3 min before starting), fully detached launch (`setsid nohup … &`), no `NODE_OPTIONS` on the reference side, fixtures named `*.fixture.ts`.
- No blanket `biome check --write` across test trees (three past incidents rewrote function-expression mocks into arrows; the `useArrowFunction: off` override is scoped to test globs, but the habit stays).
- Repo convention for plan artifacts: `audit-*.md` and `eli5.html` are **committed** (387 audit files, 146 eli5 files tracked; `implementations-plan/README.md`) — this repo does not carry the blueprint skill's `implementations-plan/.gitignore` scaffold, deliberately.

## Collision / dedup risks

1. `packages/resolve-asset` is invisible to a config-walking bump and half-visible to a `package.json` grep (version bumps, runtime doesn't) — handle it by name.
2. `packages/legal`, `packages/third-party-notices`, `packages/resolve-asset` and the extension's `test:components` have never been soaked — the matrix grows from 12 to 16 suites, or the omission is explicit.
3. `BASELINES_DIR` (`cli.ts:39`) hardcodes the vitest-on-bun lessons dir and `compare` refuses a dirty tree outside it — new evidence written anywhere else fails `compare` unless the constant moves with it.
4. `faucet.json` / `faucet-smoke.json` name a workspace that no longer exists — rename in the same re-baseline.
5. `audit/bugs/2026-08-22-production-ready/proofs/vitest.config.ts` (historical red-proof evidence, not a workspace, not in `test:all`) does not spread `sharedTest`; it resolves whatever vitest the lock picks — out of scope, stated.
6. The interop stopgap and the bump are one change: bumping without deleting the key leaves a comment that lies; deleting without the Bun soak breaks the standing protocol.

## Search trail for absence claims

`vitest.workspace.*` / `defineWorkspace` / `defineProject` / `mergeConfig` / `poolOptions` (outside one comment + one reserved-flag test) / `coverage:` / `typecheck:` / `browser:` / `experimental` / `sequence:` / `environmentOptions` / `happy-dom` / `@vitest/browser` / `@vitest/coverage-*` / `import … from "jsdom"` / `test.for(` / `test.concurrent` / `onTestFinished` / `vi.waitUntil` / `test.extend(` / `expect.extend(` / `toMatchInlineSnapshot` / `toMatchFileSnapshot` / `startVitest` / `createVitest` / `VITEST_POOL_ID` / `.sequential(` / `toThrow("")` / `Temporal.` / indented `vi.mock(`/`vi.hoisted(` / `from "@vitest/` — each grepped over `apps packages scripts contracts infra vitest.base.ts` with `**/*.{ts,mts,mjs,vue}` (node_modules and `.claude/worktrees` excluded); `contracts/**` and `infra/passkey-rp` run no vitest (Foundry / Noir / `bun test`); `apps/playground` has no test script.
