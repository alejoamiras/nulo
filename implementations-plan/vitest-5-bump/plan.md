# vitest-5-bump — vitest 5.0.1 (jsdom held at 29.1.1), the interop stopgap retired, the harvest measured

---
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: default (recon 1 agent; codex at high)
status: v5 — 2026-09-21, approved (`/goal` set), **Phase 1 ✓, Phase 2 ✓, Phase 3 ✓** (matrix commit `93b95f06`: 15 × `COMPARE OK` + `landing` recorded Bun-only by design — its tests render with `Bun.markdown.html`, so the Node reference is red on every run; owner's call 2026-09-21, gate amended below, D11 — and one same-commit re-run of the `extension` pair after a contention timeout on the Node reference, classified environment; owner's call 2026-09-22, D12; `lessons/phase-3.md`). **jsdom 30.1.0 is held back at 29.1.1**: under `bun --bun vitest` every jsdom-environment worker dies at setup (`'addEventListener' called on an object that is not a valid instance of EventTarget`) because Bun's `vm.createContext(vm.constants.DONT_CONTEXTIFY)` returns an object that is not the context's `this` — jsdom 30 stamps its new private-field wrapper brand on the one and hands out the other as `window` (jsdom 29's symbol-keyed brand crossed the proxy; a private field cannot). Reproduced standalone without vitest, and with pure `node:vm`; Node 24.21 is unaffected. Upstream: oven-sh/bun#43671 (filed 2026-09-21, reproduced by the maintainers' bot), fix PR oven-sh/bun#34623 open since 2026-07-18, unmerged. Per the Phase 1 taxonomy (Bun-only divergence → STOP) the owner decided 2026-09-21: hold jsdom, ship vitest 5.0.1; jsdom 30 is a follow-up keyed to a Bun release that contains the fix (D10; evidence in `lessons/phase-1.md`). Every "jsdom 30" below is the original scope, left for the record. Earlier: DRAFT v4 — 2026-09-21, codex r1 conditional approve (6 blocking, 5 non-blocking) + r2 conditional approve (3 corrections) folded in, none rejected; owner answers 2026-09-21: A2 = move, A3 = yes, and **the 7-day age gate is bypassed for `vitest` and `jsdom` at the owner's explicit direction** ("let's install both and use both, don't leave anything scheduled for later") — nothing waits for 09-24; A1 still at the default (10); codex r3 on this revision: conditional approve, its five points folded (ledger R3-1..R3-5); awaiting owner approval. ELI5 Artifact: https://claude.ai/artifact/2quNqEZdVVPJiEsyFQmfEC (source: eli5.html in this dir — the durable copy; the first publish at a different URL was deleted server-side minutes later; republish the same path to update)
baseline: 25062c06 (dev, after #657)
worktree: .claude/worktrees/vitest-5-bump · branch worktree-vitest-5-bump
---

## Summary

Every unit/component suite in this repo runs `bun --bun vitest run` on vitest **4.1.10**, with one line of
debt: `vitest.base.ts` sets `deps: { interopDefault: false }` because vitest 4's CJS interop mistakes Bun's
ES-module namespaces for CJS and drops named exports (zod's `z`). Upstream fixed that in vitest-dev/vitest#10363,
shipped in **5.0.0**; the stopgap's own comment names its retirement: delete the key and re-run the Bun soak
matrix. vitest 5.0.1 (2026-09-15) and jsdom 30.1.0 (2026-09-17) are the current majors; they would clear the
repo's 7-day age gate on **09-22** and **09-24** — the owner has directed that the gate be bypassed for both
now (the documented exclude mechanism, with the exclude gone from the PR), so the whole plan runs today.

This plan bumps vitest 4→5 and jsdom 29→30 across all 14 vitest-bearing workspaces (14 `vitest` pins, 6
`jsdom` pins), deletes the stopgap, folds the one workspace that never joined the Bun-runtime convention
(`packages/resolve-asset`) into it, and re-records the runtime-parity evidence on vitest 5 with the existing
fail-closed soak tool — **16 suites × 2 engines** at one matrix commit, 10 runs per suite as the plan's
default pending A1 (an exception to the 30-run bar, recorded as such; 30 for the one suite whose *runtime*
changes). Along the way
it keeps what vitest 5 gives for free (mock clearing between tests, unawaited-assertion failures, a GitHub job
summary, `configDefaults.reporters`), adopts `vi.when()` where a mock keys on its arguments, and lets
`vitest doctor` *measure* `isolate: false` / `fsModuleCache` — this PR records the numbers; a runtime-config
change, if the numbers ever justify one, is a follow-up under the 30-run bar. One PR; no product code moves;
no UI surface changes.

**Done** = vitest 5.0.1 locked through the owner-authorized age-gate exception (A4) — jsdom stays 29.1.1 (v5, D10) — with no
exclude in any commit and `bun install --frozen-lockfile --force` clean; no `interopDefault` anywhere and
`vitest.base.ts` gone with its 15 spreads and its `biome.json` include; `packages/resolve-asset` runs
`bun --bun vitest run` through a `vitest.config.ts` of its own; the soak matrix (16 suites, both engines, one commit, after a frozen install) compares green
with the compacts committed under the tool's baseline home; `test:all` ×5, `audit:vue`, the Node smoke e2e and
`test:ci-gating` green at that commit; a `workflow_dispatch` of `pr-quick.yml` bound to it green; the codex
fix loop converged **before** the PR exists; the PR's `quality-status`, `extension-smoke-e2e-status`,
`extension-network-e2e-status` and `tools-e2e-status` green (the last two via labels); docs state vitest 5
and record this bump's run-count exception without changing the standing bar.

## Why this tier (Phase 0.5 rubric)

Novelty LOW (the repo did vitest 3→4 + Vite 8 in `vitest-vite8-dedupe`, and built the soak protocol in
`vitest-on-bun`), blast radius MED-LOW (a bad bump reds `quality-status` for every PR, but it is one revert
of 20 manifest lines + the lockfile), irreversibility LOW, migration cost LOW (13 grep-verified breaking
changes, 0 needing product-code rewrites, one with unknown test fallout — #10373), external coupling LOW (two
dev-only packages), security LOW-MED (supply-chain only; the age gate is bypassed by owner decision A4 and
the residual is worked with provenance inspection, a scripts-off first install and `bun pm diff`). Zero HIGH →
`light`, confirmed. Budget: recon 1 agent (done), `/code-review` off, codex at `high`.

## Recon → design (see [recon.md](recon.md))

- The bump touches no product code: 14 `vitest` pins, 6 `jsdom` pins, one config key, one workspace's
  convention, `.gitignore`. Every vitest-5 removal (`vitest/reporters`, `test.sequential`, `poolOptions`,
  benchmark API, `@vitest/expect` as a package, …) is unused here.
- The stored 4.1.10 baselines cannot serve as the reference side: `compareSummaries` refuses any
  `gitSha` / `lockfileSha256` / `vitestVersion` / `runs` mismatch (`scripts/ci-cd/test-soak/lib.ts:291-305`),
  and the committed compacts carry no per-test inventory anyway. So "Bun candidate vs stored Node baselines"
  is not something the tool can do — both engines are re-recorded at the matrix commit. The reduction the
  owner asked for lands on the run count. From the committed medians, 10 runs cost ≈ 21 min (Node) + 15 min
  (Bun) sequential for the 12 known suites; the four added suites (extension `test:components`, `legal`,
  `third-party-notices`, `resolve-asset`) add a few minutes.
- Four suites have no soak history (the three packages above, and extension `test:components`, which the
  original 12 omitted); the matrix grows to 16 rather than silently under-covering them.
- The evidence home moves with the tool: `scripts/ci-cd/test-soak/baselines/` (`BASELINES_DIR` points there;
  `compare`'s dirty-tree exclusion follows it). The 4.1.10 compacts stay in git history under
  `implementations-plan/vitest-on-bun/lessons/baselines/`, replaced by a pointer file naming the commit that
  holds them; the two stale `faucet*.json` names become `tools*.json`. (A2 — decided: move.)
- The vitest-5 renames of `$var` test titles (12 sites) shift inventory ids — harmless once both sides are
  recorded on v5, and the reason the old inventories are only a name-diff reference.

## Architecture & Implementation

**Nothing new is built.** The change is manifests + one shared config seam + one convention fold + evidence.

1. **Manifests** — `vitest: "^5.0.1"` in the 14 workspaces that declare it (`apps/{extension,landing,tools}`,
   `packages/{aztec-runtime,bridge-core,design,extension-messaging,legal,resolve-asset,third-party-notices,wallet-bridge,wallet-core,wallet-crypto,wallet-sdk-schema-patch}`);
   `jsdom: "^30.1.0"` in the 6 that declare it (`apps/{extension,tools}`,
   `packages/{design,extension-messaging,wallet-core,wallet-crypto}`) — **v5: attempted, then reverted to
   `^29.1.1` in all six after the Bun finding (status line, D10); the lockfile was restored from the baseline
   before re-resolving so no jsdom transitive drifted along**. `vite` stays (8.2.1 satisfies v5's
   peer). No `@vitest/*` package is added. **The install bypasses the 7-day gate on the owner's direction**,
   through the mechanism CLAUDE.md § Dependency policy documents: `minimumReleaseAgeExcludes` names exactly
   `vitest`, `jsdom`, and only those transitives the gate refuses **and** these two versions actually require
   (each listed in `lessons/phase-1.md` with its resolved version, publish date and dependency chain — not
   every name the resolver mentions). The first install runs with **`--ignore-scripts`**; the lock is checked
   to resolve exactly `5.0.1` / `30.1.0` (the carets admit a later release published meanwhile — a different
   version is a STOP, not a shrug); `bun pm diff` on the lockfile is read for new transitives, changed
   maintainers, any new or changed lifecycle script and any `trustedDependencies` change (the repo declares
   none, so Bun runs no dependency scripts outside its built-in default-trusted list — `bun pm
   default-trusted`); only then the real `bun install`. The exclude is **deleted before the commit** — the PR
   carries no exclude, and `bun install --frozen-lockfile --force` proves a frozen install never re-gates the
   locked versions. The two tarballs' npm provenance attestations are **inspected, not cryptographically
   verified** by us (no npm lockfile for `npm audit signatures`, no sigstore CLI on the host): the registry's
   attestation record for each tarball is fetched, its subject digest compared to the lockfile's integrity
   hash, and its source repository / workflow read for `vitest-dev/vitest` and `jsdom/jsdom` — a
   registry-asserted binding, stated as such.

2. **`vitest.base.ts`** — delete `deps: { interopDefault: false }` and its comment. Nothing else is adopted
   into `sharedTest` in this PR (D4), so the object is empty: the file, its **15** `...sharedTest` spreads
   with their `import { sharedTest }` lines, and the `"vitest.base.ts"` entry in `biome.json`'s `includes`
   are deleted rather than kept as a ceremonial seam (D1); the next shared option recreates it in one commit.

3. **`packages/resolve-asset`** — `"test": "bun --bun vitest run"` and a `vitest.config.ts` in the repo's
   shape (`test: { environment: "node" }`). This is a **runtime flip** for that suite, so it is soaked at the
   30-run bar (≈ 1 s per run — under a minute per engine).

4. **`.gitignore`** (root) — `.vitest/` (v5's shared artifact dir: reporter outputs, attachments).
   (`fsModuleCache`, if ever enabled, writes under `node_modules/.vitest-cache` per v5's types — codex r1 —
   verified against the installed types in Phase 1; not `.vitest/`.)

5. **Soak evidence home** (A2) — `BASELINES_DIR` → `scripts/ci-cd/test-soak/baselines`; the dir carries
   `node/`, `bun/`, `full/.gitignore` (`*` + `!.gitignore`, as today); compacts named by current workspace
   (`tools.json`, `tools-smoke.json`, `extension-components.json`, `legal.json`, `third-party-notices.json`,
   `resolve-asset.json`, …). `implementations-plan/vitest-on-bun/lessons/baselines/` is replaced by a
   `README.md` pointing at the new home and at the last commit holding the 4.1.10 record. The constant is
   the only tool edit; `cli.test.ts` gains no pin for it (none exists today either).

6. **Harvest** (Phase 2, each item measured or verified, never assumed):
   - `clearMocks` default **on** (clears call history, not implementations or stubbed globals) — no opt-out;
     a test that fails because it read calls made by an earlier test is a test-isolation bug and is fixed as such.
   - Unawaited `resolves`/`rejects` fail the test — no opt-out; offenders are test bugs.
   - `vi.when()` — **preferred**, not mandated, where a mock keys on its arguments and the v4 conditional's
     fallback is passthrough; the 17 candidate sites are rewritten only where the chain reads better and the
     fallback / once-semantics are preserved (`onUnmatched` defaults to passthrough; a conditional that threw
     on unknown input keeps `'throw'`). CLAUDE.md's Vue-test conventions gain one sentence saying so.
   - `configDefaults.reporters` (`vitest/config`) replaces the hand re-added `github-actions` entry in
     `apps/extension/vite.shared.ts` `e2eReporters()` — `[...configDefaults.reporters, new RetryErrorReporter()]`
     keeps the auto-added CI annotations without the env check. Node e2e only; proven by the smoke run.
   - `vitest doctor` — **measure only, in this PR**: run once per suite at Phase 1's commit on Bun
     (`bun --bun vitest doctor`; doctor spawns with `process.execPath`, so `--bun` is what makes it Bun — if it
     does not run there, measure on Node and label it indicative), three repeats on the extension aggregate,
     cold vs warm noted (doctor's numbers are warm; `fsModuleCache` gets a priming run). Numbers →
     `lessons/phase-2.md`. **No `isolate` / `fsModuleCache` / pool change ships in this PR**: such a change is
     a runtime change under the 30-run bar and order-variation checks, and the expected answer here is "no"
     (`isolate: false` shares `window` and module state across files with per-file `vi.stubGlobal`;
     `fsModuleCache` helps reruns, not cold CI). A follow-up plan adopts one only with these numbers behind it.
   - GitHub job summary — verified on the PR's `unit-tests` job (the `github-actions` reporter is auto-added
     for the unit configs, which set no `reporters`).
   - `--repeats` — one line in the soak tool's header comment as the in-process first probe before a
     cross-process soak.

7. **Docs** — CLAUDE.md § Working in this repo (the vitest paragraph: vitest 5, stopgap gone, the never-flip
   `experimental.viteModuleRunner` rule re-verified against 5.0.1's types, **the 30-run bar unchanged**, with
   one sentence naming this plan as the recorded 10-run exception for a same-runtime version bump, and the
   baseline home); `implementations-plan/vitest-on-bun/lessons/upstream-vitest-interop.md` gets its "retired by
   vitest-5-bump, 2026-09-xx, `<sha>`" line; `packages/bridge-core/src/test/setup.ts`'s stale "jsdom provides
   DOM" comment is corrected; CI.md's unit-tests line if it names a version; `implementations-plan/index.md`.

**Not in scope, stated:** any runtime-config change (`isolate`, pools, `fsModuleCache` — measured here,
adopted elsewhere); collapsing the per-workspace runs into one root `projects` config (a topology change
with its own evidence shape); coverage, browser mode, benchmarks, `@vitest/ui`; the three Node-only
`test:watch` scripts (they stay on Node per `vitest-on-bun/lessons/phase-1.md`); the Node e2e configs' pool
shape; `audit/bugs/2026-08-22-production-ready/proofs/vitest.config.ts` (historical evidence, not a
workspace); Renovate config (the `test-runner` group already covers `vitest` + `jsdom`).

**UI impact:** none. No user-visible surface is touched.

## Security & Adversarial Considerations

- **Supply chain — the gate is bypassed, deliberately and narrowly, on the owner's direction.** The 7-day
  gate exists for the window between a compromised publish and its discovery (the 2026-05 `@tanstack/*` worm
  was live for minutes and caught within days); vitest 5.0.1 is 6 days old and jsdom 30.1.0 is 4 days old at
  install time, so this bump forgoes 1 and 3 days of that window respectively. Codex r1 objected to running
  young code even on a throwaway lockfile (B3); the owner has since decided the trade-off the other way, and
  the decision is recorded here as the owner's, not the plan's. What limits the exposure: the exclude names
  the packages exactly and lives only until the install (never in the PR); both tarballs carry npm
  **provenance attestations** whose registry record is inspected before install — subject digest against the
  lockfile integrity, source repository against the expected project; a missing, mismatched or foreign-repo
  attestation is a STOP — and this is metadata inspection of a registry-asserted binding, not a signature
  verification performed here; the first install is scripts-off (`--ignore-scripts`) and `bun pm diff` on
  the lock is read for new transitive packages, maintainers, lifecycle scripts and `trustedDependencies`
  (none declared; Bun runs dependency scripts only for those and its built-in default-trusted list) before
  the real install (vitest 5 *bundles* its own dependencies — #10685 — so the transitive set should shrink;
  a growth is a finding); the resolved versions are checked to be exactly 5.0.1 / 30.1.0; `bun audit` runs
  in CI.
- **`.vitest/` must never be committed.** The JSON/JUnit reporters and attachments land there in v5; a
  reporter file can carry console output, and the logging policy forbids payloads in logs precisely because
  they leak into bug reports. Gitignored at the root before the first v5 run.
- **The soak tool is CI-executed code** (`test:ci-gating`); the only edit is a path constant. No new spawn
  surface, no env-var injection (the design rule from `vitest-on-bun`).
- **Test-isolation regressions are the attack on this change**: `clearMocks` now runs between tests, so a
  test that *passed because* a previous test had primed a mock reveals itself as red — that is the desired
  failure; the taxonomy forbids opting out. #10373 (DOM assignments propagate to the jsdom window) can
  change what a test that replaces `window.addEventListener` observes — its failures are **classified, not
  presumed** test bugs (Phase 1 step 4).
- **Fail-closed evidence.** The matrix-commit rule (every executable byte at one SHA, after a frozen install)
  and `compare`'s meta checks are what stop a "the soak was green on a slightly different tree" argument; the
  PR HEAD may differ from the matrix commit only by `**/*.md` and the baseline JSONs, and CI's
  `workflow_dispatch` is bound to the matrix SHA.
- **Node floor.** jsdom 30's `engines` (`^22.22.2 || ^24.15.0 || >=26`) is above the host's 24.12; every Node
  execution in this plan (the soak fixtures in `test:ci-gating`, doctor on Node if it comes to that, the Node
  reference side, the Node smoke e2e) runs on a Node that satisfies it, and the actual versions — host, and
  what CI's runners resolved — are recorded in `lessons/phase-1.md`. A reference recorded on one supported
  Node version proves Bun-vs-that-Node parity; it does not prove another Node version. (v5: with jsdom
  held at 29.1.1 no engines range needs the floor any more; the Node side still runs on the recorded 24.21.0.)

## Assumptions

**Facts (verified 2026-09-21)**

- F1 `vitest.base.ts:8-13` is the only `interopDefault` in the repo; **15** configs spread `sharedTest` (the three
  Node e2e configs, `packages/resolve-asset` (no config) and `audit/bugs/…/proofs/vitest.config.ts` — a historical
  artifact outside `test:all` — do not); `biome.json` `includes` names `vitest.base.ts` explicitly.
- F2 vitest 5.0.1 published 2026-09-15 08:49 UTC; jsdom 30.1.0 published 2026-09-17 00:57 UTC (`bun pm view … time`);
  `minimumReleaseAge = 604800` → they would clear on 09-22 / 09-24 (bypassed per A4). jsdom 30.0.x has the
  `querySelectorAll` regression fixed in 30.1.0. Both tarballs carry npm provenance attestations
  (`bun pm view vitest@5.0.1 dist --json` / `jsdom@30.1.0`: `attestations.provenance` present, 2026-09-21).
- F3 vitest 5.0.1 peers: `vite ^6.4.0 || ^7 || ^8` (locked 8.2.1), `@types/node ^22 || >=24`; engines Node ≥ 22.12
  (host 24.12.0). jsdom 30 engines `^22.22.2 || ^24.15.0 || >=26`. CI: only `setup-aztec` pins Node (`setup-node@v7`,
  `node-version: 24` — resolves a cached or latest 24.x, not guaranteed newest); `_unit-tests.yml` (Bun) and the
  smoke workflow set no Node and use the runner image's.
- F4 `compareSummaries` → `checkMeta` requires equal `gitSha`, `lockfileSha256`, `vitestVersion`, `cwd`, `script`,
  `runs`, reference `runtimeMode: "node"`, candidate `"script"`, and a clean tree outside `BASELINES_DIR`
  (`lib.ts:291-305`, `cli.ts:39,343`). `gitDirty` is stamped per summary at soak time — an edit to any tracked
  file during the matrix (a lessons `.md` included) dirties every later summary.
- F5 Committed baselines: 12 per engine, `vitestVersion 4.1.10`, `runs 30`, commit `e10cc91e`; `faucet.json` /
  `faucet-smoke.json` are `apps/tools` `test` / `test:e2e`; no `extension-components`, `legal`, `third-party-notices`,
  `resolve-asset`. Median wall-clock per run: extension 83.6 s (Node) / 55.1 s (Bun); all others ≤ 14 s.
- F6 `packages/resolve-asset/package.json:12` is `"test": "vitest run"` with no vitest config (created #454, before #459).
- F7 The soak launcher appends `--retry=0 --reporter=default --reporter=json --outputFile=<tmp>/results.json
  --reporter=<runtime-reporter.mjs>` LAST (`cli.ts:150-157`), so v5's `.vitest/json/output.json` default is never used.
- F8 Grep-verified zero exposure to: nested `vi.mock`/`vi.hoisted`, `.sequential(`, `toThrow("")`, `VITEST_*_ID`,
  `Temporal.`, `toMatchFileSnapshot`, `@vitest/*` imports, removed `vitest/*` entry points, `vitest.workspace.*`.
  12 `$var`-titled `test.each`/`describe.each` sites; 15 held-then-awaited `.rejects` assertions.
- F9 `apps/extension/tests/vitest.setup.ts:79-84` clears mocks and stubs in `afterEach`; no other workspace does.
- F10 `pr-quick.yml` has `workflow_dispatch` (line 4) and its `unit-tests` job runs unconditionally; a manifest edit
  trips the `root-config` filter and therefore every build job.
- F11 The repo commits `audit-*.md` and `eli5.html` (387 / 146 tracked files; `implementations-plan/README.md`); the
  blueprint skill's `implementations-plan/.gitignore` scaffold is not applied here.
- F12 #10373 exposure (codex r1): `apps/extension/src/composables/useDappApprovalWindow.test.ts:63-64,81-82` and
  `apps/extension/src/popup/windows/capabilities/index.test.ts:165-166` assign spies to `window.addEventListener` /
  `removeEventListener` and restore the natives by assignment; 10 `Object.defineProperty(window|globalThis|…)` sites and
  24 test files assign into `window`/`globalThis`/`document` (most are `document.body.innerHTML = ""`).
- F13 Detection power of N independent retry-0 runs against a per-run flake rate p: 1 − (1 − p)^N — at N=10,
  65 % for p=10 %, 40 % for p=5 %; at N=30, 96 % and 79 %. The `test:all` ×5 fan-out and the real-runner
  dispatch exist because no N here is proof.

**Inferences (unverified — the audit attacked these; the residue is stated)**

- I1 `bun --bun vitest run` on 5.0.1 works on Bun 1.4.2 for every suite once the stopgap is gone. vitest 5 bundles its
  dependencies (#10685) and changed how warm modules reach workers (#10708/#10742, Node compile cache opt-in).
  Phase 1's single run per suite is the first test; the matrix is the proof.
- I2 `experimental.viteModuleRunner` still exists in 5.0.1 and defaults `true` (codex r1: verified in tagged v5
  source); the never-flip rule stays true because Bun still lacks `module.registerHooks`.
- I3 The `Reporter` (`onTestCaseResult`) and `globalSetup` (`TestProject.provide`, default-export teardown)
  contracts are unchanged in v5 (codex r1: verified in tagged source) — typecheck + the Node smoke e2e run prove it here.
- I4 jsdom 30.1.0 would run on Node 24.12 in practice, but no Node execution in this plan is done below the floor.
- I5 `vitest doctor` runs under `bun --bun` (it spawns with `process.execPath`; unverified on Bun — fallback stated in §6).

**Asks (owner decisions surfaced at the gate)**

- A1 **Run count** — *open*. "Runs" = how many times each suite is executed per engine at the matrix commit;
  more runs, better odds of catching an intermittent test (F13). The Phase 0 answer chose "10 runs, Bun vs
  stored Node baselines"; the tool cannot compare across versions (F4), so both engines are re-recorded.
  Default: **10 runs as this bump's recorded exception** (≈ 50 min unattended), 30 for `resolve-asset` (a
  runtime flip), the standing 30-run bar in CLAUDE.md untouched. Say `30` for the whole matrix (≈ 2 h 30 min,
  unattended) — the driver's recommendation, since the host is otherwise idle.
- A2 **Baseline home move** — **decided 2026-09-21: move** to `scripts/ci-cd/test-soak/baselines/` (D2).
- A3 **Host Node ≥ 24.15** — **decided 2026-09-21: yes**, installed via `nvm` before Phase 1; the resolved
  version is recorded (24.21.0; v5: no longer required by any engines range, kept as the Node reference version).
- A4 **Age gate** — **decided 2026-09-21: bypass** for `vitest` and `jsdom` now (Implementation §1, Security).
  Executed for `vitest` (+ `@vitest/mocker`, `@vitest/spy`, the chain the gate named); the `jsdom` exclude
  served the attempt and left with the revert. Every exclude was local-only and is gone (`lessons/phase-1.md`).
- A5 **jsdom 30 under Bun** — **decided 2026-09-21: hold at 29.1.1**, ship vitest 5.0.1 (status line, D10).

## Phases and validation gates

`RUNS=10` unless A1 changes it (`resolve-asset`: 30). Every command runs from the worktree root. There is no
early probe: the owner's gate decision (A4) makes the real install available today, and a two-step install
(vitest first, jsdom second, `bun run test:all` between them) gives the same vitest-vs-jsdom split of the
fallout at no extra cost.

### Phase 1 ✓ — the bump commit (2026-09-21; step 2(b) attempted and reverted — `lessons/phase-1.md`)

Preconditions: Node ≥ 24.15 on PATH (A3), versions recorded (`node --version`, `bun --version`); the two
tarballs' provenance records inspected and quoted in `lessons/phase-1.md`.

1. **Before any v5 run**, so the first run is the real target and not a third variable: `.gitignore` gets
   `.vitest/`; `vitest.base.ts` loses the stopgap key, then the file, its 15 spreads + imports and the
   `biome.json` include go (D1); `packages/resolve-asset` gets its script + config.
2. Pins as in Implementation §1, **in two steps**: (a) the 14 `vitest` pins + the local exclude →
   `bun install --ignore-scripts` → `bun pm diff` + resolved-version check → `bun install` →
   `bun run test:all` (vitest fallout, recorded, and it must be green — after the taxonomy — before jsdom is
   added); (b) the 6 `jsdom` pins + the exclude → the same four steps (jsdom fallout, recorded). Then
   **delete the exclude**, `bun install --frozen-lockfile --force` (proves the lock holds without it); the
   exclusion list, chains and diff review noted in `lessons/phase-1.md`.
3. Targeted probes before each full run: the #10373 sites (F12), the `Object.defineProperty(window…)` sites, the
   discover/approval-window lifecycle tests, `wallet-crypto`'s KATs, the tools `useTheme`/`matchMedia` tests —
   each run alone first so its fallout is read in isolation. Then the taxonomy for every red: test-assumption
   bug → fix; a vitest-5 or jsdom-30 behavior change the test correctly relied on → adapt the test to the new
   contract and say which change; Bun-only divergence → STOP for the owner; never `skipIf(process.versions.bun)`,
   never `clearMocks: false`, never `deps.interopDefault`.
4. Verify I2 against `node_modules/.bun/vitest@5.0.1/…/dist` types and the `fsModuleCache` path claim; quote both
   in `lessons/phase-1.md`.

Gate: `git diff -- bunfig.toml` empty and `bun install --frozen-lockfile --force` clean (no exclude, no
re-gate) · `bun run lint` · `bun run typecheck:all` · `bun run test:all` (all 14 workspaces on Bun, one run
each) · `bun run test:ci-gating` (its soak fixtures run on both engines) · `bun --bun vitest --version` prints
5.0.1 in a workspace · `git status` shows no `.vitest/`.

### Phase 2 ✓ — harvest, measured (2026-09-21; `lessons/phase-2.md` — doctor numbers, six `vi.when` sites, two reverted)

1. `vitest doctor` per suite (Bun; extension aggregate ×3), cold vs warm noted; numbers → `lessons/phase-2.md`.
   Nothing is adopted from it in this PR (D4).
2. `vi.when` rewrites where they read better, semantics preserved; `bun --bun vitest run <file>` per touched file.
3. `e2eReporters()` on `configDefaults.reporters`.
4. Docs (Implementation §7) and the CLAUDE.md convention sentence.
5. Any `clearMocks` / unawaited-assertion fallout not already caught in Phase 1.

Gate: `bun run lint` · `bun run typecheck:all` · `bun run test:all` · `bun run audit:vue` (typecheck ∥ unit ∥
lint, then build) · `NODE_OPTIONS=--dns-result-order=ipv4first bun run test:e2e` (Node smoke; proves the
Node-side `Reporter`/`globalSetup` contracts, I3, and the `configDefaults` change) · `bun run test:ci-gating`.

### Phase 3 ✓ — the matrix commit (2026-09-22; `lessons/phase-3.md` — 15 × `COMPARE OK` + landing Bun-only by design; the extension pair re-run once at the same commit)

Preconditions: every change is committed (the matrix commit); `bun install --frozen-lockfile` at that commit
(clean); the host is idle (load < 4 for 3 min); Node ≥ 24.15 on PATH; the launch is detached
(`setsid nohup … &`). **No edit to any tracked file while the matrix runs** — `gitDirty` is stamped per
summary (F4); lessons are written after the last soak. Resume rule: a step is skipped only when a *complete,
successful* summary exists at the same commit, lockfile hash, vitest version, runtime identity and run count;
anything else re-runs.

For each of the 16 suites `S` = `(cwd, script, name, runs)`:
`apps/extension test extension` · `apps/extension test:components extension-components` ·
`apps/tools test tools` · `apps/tools test:e2e tools-smoke` · `apps/landing test landing` ·
`packages/resolve-asset test resolve-asset` (**30**) ·
`packages/{aztec-runtime,bridge-core,design,extension-messaging,legal,third-party-notices,wallet-bridge,wallet-core,wallet-crypto,wallet-sdk-schema-patch} test <name>`:

```
bun scripts/ci-cd/test-soak/cli.ts soak --cwd <cwd> --script <script> --runtime node   --runs <runs> --out scripts/ci-cd/test-soak/baselines/full/node/<name>.json
bun scripts/ci-cd/test-soak/cli.ts soak --cwd <cwd> --script <script> --runtime script --runs <runs> --out scripts/ci-cd/test-soak/baselines/full/bun/<name>.json
bun scripts/ci-cd/test-soak/cli.ts compare scripts/ci-cd/test-soak/baselines/full/node/<name>.json scripts/ci-cd/test-soak/baselines/full/bun/<name>.json
bun scripts/ci-cd/test-soak/cli.ts compact scripts/ci-cd/test-soak/baselines/full/node/<name>.json --out scripts/ci-cd/test-soak/baselines/node/<name>.json
bun scripts/ci-cd/test-soak/cli.ts compact scripts/ci-cd/test-soak/baselines/full/bun/<name>.json  --out scripts/ci-cd/test-soak/baselines/bun/<name>.json
```

Then, at the same commit: `bun run test:all` ×5 (the concurrent CI shape) · `bun run audit:vue` ·
`NODE_OPTIONS=--dns-result-order=ipv4first bun run test:e2e` · `bun run test:ci-gating` ·
`gh workflow run pr-quick.yml --ref worktree-vitest-5-bump` then `gh run view <id> --json jobs,headSha` with
`headSha` == the matrix commit and every job green.

**Dispositions.** A red **Node reference** run is not Bun evidence and is not waved through — and it is
not presumed a flaky test either (codex r2): it is **reproduced and classified first** (run the file alone
on Node, then ×5; read the failure). A demonstrated test bug → fix, new matrix commit. A deterministic
vitest-5/jsdom-30 regression, an environment failure (Node version, host load, a leaked process) or a
product defect → **owner disposition**, with the reproduction in `lessons/phase-3.md`. An assertion is never
adapted merely to get green. A `COMPARE FAILED` is read per problem line: inventory membership (a test that
exists on one engine only), per-id status records, failure deltas, resolution parity — each is a finding to
explain, never an allowlist edit.

Gate: 15 × `COMPARE OK` plus `landing`, whose Bun soak is green and whose Node reference is red by design on
every run (`apps/landing/scripts/legal-pages.ts` renders with `Bun.markdown.html` and throws on any other
runtime — amended from "16 ×" at the owner's direction, 2026-09-21, D11); each **full report** (meta lines,
inventory digests, resolution lines, wall-clock) pasted into `lessons/phase-3.md` — the wall-clock lines compare Node-v5 to Bun-v5 on this host and say
nothing about v4→v5; a v4 comparison, if wanted, is the stored 4.1.10 medians against the new ones, labelled
indicative (different day, possibly different load) · the five fan-outs green · the dispatch green at the
matrix SHA · 32 compacts committed (a `**/*.md` + baseline-JSON-only commit on top of the matrix commit).

**Re-run rule:** any later change to an executable byte (a test, a config, `package.json`, `bun.lock`, the
soak tool, `biome.json`) is a new matrix commit and repeats this phase in full.

### Phase 4 — review loop, then the PR

1. **Codex fix loop first** (`/codex` at `high`, GPT-6 Astra): one adversarial review of the whole diff from
   `25062c06` against this plan and `recon.md` — is any failure fixed by weakening a test, is `clearMocks` /
   unawaited-assertion / #10373 fallout hidden, does the evidence bind to HEAD, did the harvest change semantics.
   Apply what holds, rebut what doesn't in the ledger; hard stop at 3 rounds → surface. **Any executable fix
   re-runs Phase 3** before the next round.
2. Then `gh pr create` (title ≤ 93 chars, e.g. `chore(deps): bump vitest 5.0.1, retire the interop stopgap; jsdom 30 held (bun#43671)`),
   then labels `e2e:extension-network` and `e2e:tools` **after** the PR exists (a label at create time cancels the
   sibling run and leaves a red check).

Gate: the loop converged (a resumed codex pass with no new material findings, quoted); `quality-status`,
`extension-smoke-e2e-status`, `extension-network-e2e-status`, `tools-e2e-status` green at HEAD; the
`unit-tests` job shows the vitest job summary (harvest verification, screenshot in the PR body).

## Post-implementation

1. The codex loop is Phase 4 step 1 — it runs before the PR, per the repo's "open the PR only after the
   quality loops have converged" rule. `/code-review`: off (Phase 0 answer).
2. **No over-engineering**: no new abstraction for "future bumps"; the soak tool changes by one constant; the
   harvest adopts nothing without a number or a failing test behind it, and no runtime-config change at all.
3. **Comment quality**: comments cite the upstream mechanism (PR numbers) or the invariant; no "bumped in
   vitest-5-bump" provenance in code (git carries it); the stopgap's comment is deleted, not amended.
4. Lessons in `lessons/phase-{1,2,3}.md` (written between phases, never during a matrix);
   `implementations-plan/index.md` entry updated at each status change; `agent-worktree status vitest-5-bump
   "<phase>"` at each gate.

## Delivery

One arc, one PR into `dev` (squash). A stack is not forbidden by the matrix rule, but every arc would carry
its own matrix and nothing here is separable without one. Merging is the owner's call. After merge:
`agent-worktree done vitest-5-bump`; the `upstream-vitest-interop.md` retirement line and the index entry
carry the merged SHA.

## Decision ledger

| # | Decision | Default | Rationale |
|---|---|---|---|
| D1 | `vitest.base.ts` when nothing shared remains | delete file + 15 spreads/imports + `biome.json` include | an empty seam is a comment that says "nothing"; one commit recreates it |
| D2 | Baseline home | `scripts/ci-cd/test-soak/baselines/` (A2) | evidence lives with the tool that reads it; optional, small |
| D3 | `clearMocks` | keep v5 default (on) | isolation is the point; the extension already had it |
| D4 | `isolate` / `fsModuleCache` / pool | **measure only**; adoption is a follow-up under the 30-run bar | a runtime change needs the runtime-change bar, not a bump's exception (codex r1 #2/#4) |
| D5 | Matrix size | 16 suites, both engines; 10 runs (A1) except `resolve-asset` at 30 | the four never-soaked suites cost minutes; the runtime flip gets the flip's bar |
| D6 | Root `projects` topology | out of scope | a different evidence shape; its own plan |
| D7 | Early probe | **dropped** (v4) — superseded by A4: the real install runs now, in two steps for the vitest/jsdom split | the owner bypassed the gate; a probe on top of that is pure duplication |
| D9 | Age gate (A4) | bypass for `vitest` + `jsdom`, exclude local-only, deleted before the commit, provenance read first | owner's decision 2026-09-21, recorded as such; codex r1 B3's objection stands on the record |
| D8 | Review-loop order | codex loop before `gh pr create` | repo rule; the prior protocol's order (codex r1 #5) |
| D10 | jsdom 30.1.0 under Bun (v5) | **held at 29.1.1**; vitest 5.0.1 ships alone; jsdom 30 re-attempted when a Bun release carries oven-sh/bun#34623 | Bun-only divergence per the Phase 1 taxonomy (oven-sh/bun#43671); 30.0.1 runs on Bun but carries the `querySelectorAll` regression 30.1.0 fixed; disabling jsdom's vm context via `environmentOptions` is an engine workaround baked into six configs — both rejected; owner's call 2026-09-21 |
| D11 | `landing` in the matrix (Phase 3) | **recorded Bun-only by design**: Bun soak green, Node reference quoted red-by-design; gate amended from 16 to 15 × `COMPARE OK` + landing; CLAUDE.md says landing's tests need Bun | `legal-pages.ts:120` uses `Bun.markdown.html` (added 2026-09-19, #627) — 28/40 tests throw on Node on every run, deterministic; a Node-side workaround would change the code under test to satisfy a reference engine CI never uses; owner's call 2026-09-21 |
| D12 | A red Node reference in the `extension` pair (Phase 3) | **re-run the pair at the same commit** (no tracked edit; the discarded attempt's compare + reproduction kept in `lessons/phase-3.md`) | run 2/10 timed out (5 s) in a fresh `import()` at host load 48–65 and leaked a listener into the next test; the file alone on Node was 6/6 green — environment, per the Phase 3 dispositions; the re-run was 10/10 on both engines with identical digests; owner's call 2026-09-22 |

### Codex round 1 (GPT-6 Astra, high) — `conditional approve`

| # | Finding | Disposition |
|---|---|---|
| B1 | 16 suites / 32 compacts, 14 vitest pins, not 15/30/12; the stored 12 omitted `test:components` | **folded** — counts fixed throughout; `extension-components` added to the matrix |
| B2 | 10 runs must not become a standing rule; `resolve-asset` is a runtime flip; D4 would be a runtime change; power at 10 is 65 %/40 % | **folded** — 10 is this bump's recorded exception, CLAUDE.md's bar stays 30, `resolve-asset` at 30, D4 → measure only (F13) |
| B3 | Phase 1a executes young code; discarding the lockfile does not undo the exposure | **folded in v2/v3** (probe on gate-cleared versions, no exclude), then **overridden by the owner in v4** (A4/D9): the gate is bypassed for `vitest` + `jsdom` by explicit direction; the objection stays on the record, the mitigations are in Security |
| B4 | D4's threshold is insufficient (warm measurements, extension-only, no order variation); the wall-clock lines cannot show v4→v5 | **folded** — D4 measure-only; speedup claim removed; v4 comparison labelled indicative |
| B5 | Restore the full evidence procedure: frozen install at the matrix commit, full compare output, no edits during the matrix, strict resume, Node-reference disposition, review before PR | **folded** — Phase 3 preconditions/dispositions/gate; Phase 4 reordered (D8) |
| B6 | #10373 (DOM assignments propagate to the jsdom window) has concrete exposure; do not presume test bugs | **folded** — F12, recon table row, Phase 1 step 4 targeted probes + classification |
| N1 | Node prerequisite before any Node execution; record actual versions; CI Node is not uniform | **folded** — Phase 1 precondition, F3, Security § Node floor |
| N2 | jsdom 30 extra changes (computed style, observer ordering, post-close behaviour); randomness change says nothing about `crypto.subtle` | **folded** — targeted probe list; recon row corrected |
| N3 | D2 is optional; the claimed `cli.test.ts` pin does not exist | **folded** — claim removed; A2 stands as the owner's call |
| N4 | `vi.when` as a recommendation preserving semantics; `clearMocks` clears history only; `fsModuleCache` lives in `node_modules/.vitest-cache`; `configDefaults.reporters` is worth adopting | **folded** — §6 harvest reworded; `.gitignore` claim corrected; `configDefaults` added |
| — | "What looks fine": `checkMeta` read correctly; D1, D3, `--repeats`, deferring root projects; I2/I3 verified in tagged source; one PR sensible | noted |

### Codex round 2 (resumed, high) — `conditional approve`, three corrections

| # | Finding | Disposition |
|---|---|---|
| R2-1 | B5 folded incorrectly: a red Node reference was auto-classified as a flaky test; it may be a deterministic regression, an environment failure or a product defect | **folded** — Phase 3 dispositions: reproduce + classify first; test bug → fix + new matrix; anything else → owner disposition; assertions never adapted for green |
| R2-2 | Phase 1a's rollback restored manifests + lockfile but not the stopgap, and did not reinstall — fixes "proven on v4" would have run on a mismatched tree | **folded in v3**, then **moot in v4**: Phase 1a was dropped when the owner bypassed the gate (D7/D9) |
| R2-3 | D1 bookkeeping: 15 spreads, not 17 (driver re-counted: 15); their imports and the `biome.json` `includes` entry go too; the Done criterion still had `resolve-asset` spreading the deleted seam | **folded** — counts fixed in plan + recon; F1; Done; Implementation §2–3 |
| — | B1–B4, B6, N1–N4 folded satisfactorily; D1 (delete) and D2 (move, owner's call) need no reversal | noted |

### Codex round 3 (resumed, high) — plan v4 (owner's gate bypass) → `conditional approve`, five points

| # | Finding | Disposition |
|---|---|---|
| R3-1 | Exclude only the transitives these versions require, with resolved version, date and chain; check the lock resolves exactly 5.0.1 / 30.1.0 (carets admit a later release) | **folded** — Implementation §1, Phase 1 step 2 |
| R3-2 | The script mitigation came after the first test run: install with `--ignore-scripts` first, inspect changed lifecycle scripts, then permit | **folded** — scripts-off first install + `bun pm diff` before the real install; the repo declares no `trustedDependencies` (driver-verified), so Bun runs dependency scripts only for its built-in default-trusted list |
| R3-3 | Attestation presence/fields is metadata inspection, not cryptographic verification — verify, or say so | **folded** — stated as registry-asserted binding (digest vs lockfile integrity, source repo), not verification; `npm audit signatures` is unavailable without an npm lockfile and no sigstore CLI is on the host |
| R3-4 | Retire the stopgap and add `.vitest/` to `.gitignore` before the first vitest-only run, not after both installs | **folded** — Phase 1 step 1 |
| R3-5 | Stale claims: "clean-gate install" (Done), "handled by the age gate" (tier), "owner-approved" ten runs while A1 is open | **folded** — all three rewritten |
| — | Dropping Phase 1a loses nothing given the two-step install; the exclude-free final gate is correct; no 09-24 wait remains | noted |
