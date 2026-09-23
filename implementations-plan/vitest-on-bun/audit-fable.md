# Fable audit transcript — vitest-on-bun (Arc C)

## Round 1 — 2026-08-24 — plan v1 + competing outline (Plan agent on Fable, read-only)

Packet: adversarial/security + assumption-attack + implementation critique (a–h) + gates. The agent verified claims against `module-evaluator.js`, `pr-quick.yml`, the workspace manifests and ran its own `bun -e`/`node -e` checks.

### Verdict (verbatim)

VERDICT: conditional approve — conditions: (1) fix the self-contradictory soak pass rule (rate-aware, tool-defined `failedRun`); (2) soak the real `test` script, not a composed `vitest run`; (3) define the extension shard mechanically and prefer N=30 full; (4) add a `gh workflow run pr-quick.yml --ref <branch>` runner check to the Phase 1 and Phase 4 gates; (5) add a Bun-only deterministic-failure protocol that forbids runtime-conditional skips.

### Findings (verbatim, lightly de-indented)

**1. Adversarial / security**
- Med — CI runner never exercised before the PR. Every gate is local; `_unit-tests.yml` uses only `setup-bun` (no `setup-node`), so today's "Node" in CI is the runner image's unpinned Node, while your baseline is nvm 24.18. `pr-quick.yml:4,148-151` already supports `workflow_dispatch` → `full=true`; one dispatch per flip phase gives real-runner evidence (pool sizing, memory, I5/I6) without opening the PR. Bonus for the PR body: post-flip the test runtime becomes *pinned* (`setup-bun/action.yml:17`) — a reproducibility gain.
- Med — gate integrity inside the tool. vitest's JSON reporter has no test id for collection errors, unhandled errors or a crashed worker; define `failedRun = exit≠0 ∨ !success ∨ missing JSON ∨ per-run timeout` (the plan names none, and a hung Bun worker would hang the whole soak loop).
- Low — `--bun` rewrites `node` on PATH for the entire process tree (`bun run --help`: "via symlinking node"). Verified no unit test spawns processes (grep `child_process|execSync|spawnSync` over test files: 0) — record that as a Fact; it is the actual blast-radius boundary.
- Low — resolver trust shift. Four externalized deps declare a `"bun"` export condition and load different entry files under Bun: `isows` (`package.json:23`, viem's WS shim), `msgpackr` (`:41,57,73`, pulled by `@aztec/*`), `@logtape/logtape`, `axios`. Not a defect (prod is the browser) but list it under "what we trust".
- Low — committed baselines would carry absolute paths (`testResults[].name`) → home-dir leak and non-portable compares. Relativize ids to the workspace; record `gitSha`, runtime versions, vitest version.
- Looks fine: zero deps; `quality-status` needs `unit-tests` (unconditional, `pr-quick.yml:240-245`) and `build-faucet` (`_build-faucet.yml:44`) — unchanged producers; script edits hit the existing `package.json` filters (`pr-quick.yml:80-121`).

**2. Assumption attack**
- Facts. F1 slightly misstated: extension-messaging is `vitest run --passWithNoTests`, landing has a `pretest` — both matter for condition (2). F3 verified; reproduced: `bun -e` gives `"__esModule" in ns` = true / `Object.hasOwn` = false, Node false/false, so the proposed upstream fix is sound. F5 says 7 bb.js files; probes § 3c says 6 — the config has 7 (`apps/extension/vitest.config.ts:52-70`); fix the probes doc. F8: `NULO_FUZZ_RUNS` is a run-count knob, not a skip guard. F9 line numbers correct. F10 correct — which makes the Phase 5 gate text ("scripts are linted") wrong: `biome.json:6-16` excludes `scripts/**`.
- Inferences. Missing inference: `interopDefault: false` is *not* "native semantics on both runtimes" — with interop on, named access falls back to `mod[prop] ?? defaultExport?.[prop]` (`module-evaluator.js:86-93`); with it off you get each runtime's own CJS named-export synthesis (Node: cjs-module-lexer; Bun: runtime enumeration). The "identical on 4,635 tests" claim covers the aggregate only; faucet ×2, bridge-core, design, landing are unverified on Node with the flag — Phase 0 must stay before any flip. I4 verified (`apps/faucet/src/test/setup.ts:6` is a no-op on both). I1 is honest only with its power stated: N=30 detects a ≥10 % flake with 96 % confidence, a 5 % one with 78 %; N=10 detects ≥25 % with 94 %. Also: vitest 4.1's `experimental.viteModuleRunner` defaults true (`cli-api.BK8pd4xc.js:9263`), so Bun's missing `module.registerHooks` (verified undefined; `module.register` is a no-op) is never hit — but flipping `viteModuleRunner:false` would be Bun-incompatible (`native.DPzPHdi5.js:49-50`); document as a never-flip.
- Asks. A1–A3 fine in-plan. Surface to the owner: (i) the runtime-pinning consequence (CI Node was never pinned); (ii) what to do if a package must stay on Node (Done criterion changes); (iii) whether `implementations-plan/**/baselines/*.json` (~13 files) is acceptable repo content.

**3. Implementation critique**
- (a) Root plain `vitest.base.ts` with `interopDefault:false`: right. Note nobody type-checks it or any `vitest.config.ts` (no tsconfig includes them) — status quo, not a regression.
- (b) Per-script `--bun`: right. `[run] bun = true` would also move `cross-env NODE_OPTIONS=--max-old-space-size=16000 vite build`, storybook and Puppeteer. Verified `bun --bun vitest` resolves the bin from a workspace dir (execPath = bun, `versions.bun` 1.4.0), so plan and probe spellings are equivalent.
- (c) Six phases vs one flip: plan's structure with the alt's discipline — wall-clock identical either way; keep one commit per package flip carrying its soak evidence so `git revert` per package is trivial.
- (d) Single PR acceptable given (c); split only if the extension soak stalls.
- (e) Flip `test:watch` after the smoke: right — a Node watch loop against Bun CI is exactly the split-result confusion the plan warns about; the smoke must also confirm no orphan `bun` workers after Ctrl-C (shared host).
- (f) Tool: home is fine (`bun test scripts/ci-cd/` recurses; use a `test-soak/` subdir). Wrong boundary: the tool composes its own `vitest run`; it should run `bun run [--bun] --cwd <ws> test -- --reporter=json --outputFile=…` so the exact CI string (incl. `pretest`, `--passWithNoTests`, the flipped script) is what gets soaked. Simpler identity check than a separate `--root` sentinel: pass a tiny custom reporter by path that writes `process.execPath`/`versions` on `onInit` — attached to every run, not a pre-run. Keep set-based comparison, add per-id rates. Guard the CLI with `import.meta.main`.
- (g) Shard: the five hand-picked paths cover 7 of the 37 `useFakeTimers` files in the aggregate (e.g. all `src/composables/*`, `stores/balances.*`, `transaction/*`, `wallet-core/src/utils/lock.test.ts` are outside). Define it mechanically (`grep -rl 'useFakeTimers\|vi.waitFor'` over the include set, ≈40 files) and run N=30 full if an unattended hour is affordable. `../../packages/...` filters do match.
- (h) Already covered by the suites: pools, transform server, hoisted mocks. Moot: cross-file fake-timer leak — forks + `isolate:true` gives a fresh process per file. Verified now: nextTick/microtask/immediate/timeout order is identical on both runtimes. Still owed: source-map sentinel (Bun stack format differs) — make it a permanent sentinel file, not "edit a real test and revert".

**4. Gates**
- All named commands exist. Contradiction: Phase 0 says a non-zero Node baseline "becomes the bar", Phase 1 requires Bun `failedRuns: 0`. Rule: Bun failing-id set ⊆ Node's and per-id and total failures ≤ Node's; any excess → root-cause before proceeding. Add N=5 of `bun run test:all` — the only contended-mode command CI actually runs. Deterministic Bun-only failure protocol: reproduce solo → minimal `bun -e`/`node -e` diff → classify: test assumption (message text, stack shape, `process.versions`) → fix the test runtime-agnostically in its own commit and re-soak on Node; product/dep divergence (KAT mismatch, module semantics) → package stays on Node, reproducer in lessons, Done criterion and PR body amended. Never `skipIf(process.versions.bun)` — that is a silent gate weakening.

**Looks fine**: interop diagnosis and countermeasure; zero-dep/zero-YAML posture; Phase 0-before-flip ordering; codex-corrected package order; retry-0 by construction; the e2e fence; `bunfig` rejection reasoning; rollback story.

### Disposition

See `lessons/gate-convergence.md` (fable round) — folded into plan v3 together with codex round 2.
