# Phase 2 — harvest, measured (2026-09-21)

Everything here is on top of the Phase 1 commit `06a404d8` (vitest 5.0.1, jsdom 29.1.1). Nothing runtime-shaped
ships: no `isolate`, `pool`, `fsModuleCache`, `clearMocks` or `deps.*` key was added to any vitest config (D4).

## What was adopted

- **`configDefaults.reporters`** replaces the hand-rolled `github-actions` re-add in
  `apps/extension/vite.shared.ts` `e2eReporters()`: `[...configDefaults.reporters, new RetryErrorReporter()]`.
  Verified by printing it from `apps/extension` under Bun: `["minimal"]` in this (agent-driven) shell,
  `["minimal","github-actions"]` with `GITHUB_ACTIONS=true`. vitest 5 computes the default as
  `[isAgent ? "minimal" : "default", ...(GITHUB_ACTIONS === "true" ? ["github-actions"] : [])]` (`std-env`'s
  `isAgent`), so a human terminal and CI get `default` exactly as before, an agent session gets `minimal` —
  the same choice the unit configs, which set no `reporters`, already make. The soak driver passes
  `--reporter=default --reporter=json …` explicitly, so the matrix never sees this default.
- **`vi.when`** at six of the seventeen candidate sites — the ones where a mock is keyed on ONE argument and the
  rest is a plain default: `account-state/service.test.ts` (three `getSenders` stubs, one of them a per-network
  rejection), `FeeSettingsCard.test.ts` (`getFpcs` keyed on chainId), `incoming-transfer/service.scenarios.test.ts`
  (two `getValue` stubs that fail only the visibility key). Shape: `fn.mockResolvedValue(default)` first, then
  `vi.when(fn).calledWith(x).thenResolve(y)` / `.thenReject(err)`. Two `getGasBalances` sites were rewritten and
  **reverted**: the production call is `getGasBalances(networkId, address, forceRefresh?)` — three arguments,
  the last possibly `undefined` — and `calledWith` compares the whole argument array, so
  `calledWith(expect.any(String), "0xacct")` never matched (two red tests) and no asymmetric matcher expresses
  "a third argument or none". The remaining nine stay as they are: map lookups over a table
  (`configValues[key]`), closures over mutable stub state (`makeConfigStub`), side-effect recorders, or
  variadic passthroughs — none reads better as a `calledWith` chain.
- **Semantics of `vi.when` (read from `vitest/dist/chunks/index.m3L2HgmY.js`)**: behaviors match in definition
  order, first match wins; an unmatched call falls through to `spy.getMockImplementation()` **as captured when
  `vi.when` was applied** — the mock's implementation at that moment, not the spied-on original — or to
  `onUnmatched` (`'throw'` or a function); `undefined` if the mock had none. A second `vi.when(spy)` captures the
  first dispatcher as its fallback, so repeated calls layer rather than replace. Hence the convention sentence
  in CLAUDE.md: set the default first.
- **`clearMocks` / unawaited assertions**: no fallout beyond Phase 1's `backup.test.ts`.

## Baseline home (A2 / D2)

`BASELINES_DIR` → `scripts/ci-cd/test-soak/baselines`; `full/.gitignore` moved with `git mv`; the 24 vitest-4.1.10
compacts were `git rm`'d (last commit holding them: `06a404d8`) and the old directory now holds a `README.md`
pointing here. The CLI's `--out` creates parent directories (`mkdirSync(..., { recursive: true })`), so `node/`
and `bun/` appear with Phase 3's first compact. One header-comment line on `--repeats` as the in-process first
probe. `test:ci-gating` green after the constant change (132 pass, 2 skip).

## Docs

- CLAUDE.md § Working in this repo — the vitest paragraph: vitest 5, no shared base config, the stopgap's
  retirement, the never-flip rule re-verified against 5.0.1's types, the jsdom-29 hold with its Bun issue and
  the standalone pre-check, the baseline home, and the 30-run bar unchanged with this bump's 10-run exception
  named as such.
- CLAUDE.md § Vue component test conventions — one bullet on argument-keyed mocks (`vi.when`, default first).
- `implementations-plan/vitest-on-bun/lessons/upstream-vitest-interop.md` — "Retired by vitest-5-bump,
  2026-09-21, `06a404d8`" (the fixture in that note was never committed; the suites are the check).
- `packages/bridge-core/src/test/setup.ts` — **no edit**: recon misattributed the "jsdom provides DOM" comment;
  it lives in `apps/tools/src/test/setup.ts`, where the tools app does run jsdom, and bridge-core's own comment
  (the `self.crypto` alias for the node environment) is accurate.
- CI.md names no vitest version — no edit.

## Gate (final tree, before the commit)

| Check | Result |
|---|---|
| `bun run lint` | exit 0 (after one Biome format fix on the `getFpcs` chain; 33 pre-existing warnings) |
| `bun run typecheck:all` | exit 0 (inside `audit:vue`; the extension also alone) |
| `bun run test:all` | first run: one contention timeout (below); re-run alone: exit 0, 0 failures |
| `bun run audit:vue` | exit 0 — extension 542 files green, build 8.9 s |
| Node smoke e2e | first run against `audit:vue`'s **unarmed** dist: `backup-migration` (fixture-arming contract) and `fiat-display` (live prices reached from a non-testnet default) red — both invocation, not vitest (the smoke `global-setup` never builds; the e2e skill's armed build is required); re-run against `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 build:chrome` with `NULO_E2E_MIGRATION_FIXTURE=1`, Node 24.21.0: **exit 0 — 34 files passed, 2 skipped; 137 tests passed, 7 skipped; 953 s** (I3: the `Reporter` and `globalSetup` contracts and the `configDefaults` change hold on Node) |
| `bun run test:ci-gating` | exit 0 — 132 pass, 2 skip |

## One contention timeout, classified

The first Phase 2 `bun run test:all` was launched while `audit:vue` (its own extension run + the build) was still
executing; `apps/extension/src/presto/client.test.ts` "returns one PrestoClient per module instance" timed out
at 5 s on its cold `await import("./client")` after `vi.resetModules()` (the tools suite in the same window
reported 772 s of transform time across its workers). Alone: 5/5 green in ~1 s; the Phase 1 run on an idle
host was green; the same test is what doctor's `fsModuleCache` priming run timed out on. Classification:
environment (host contention on a cold transform of the presto module graph), not a vitest-5 behaviour change
— the test predates the bump and its timeout is the default. The gate's `test:all` below is the uncontended
re-run; Phase 3's `test:all ×5` is where a recurrence would become a finding.

## `vitest doctor` (measure only, D4)

Run at commit `06a404d8` with `bun --bun vitest doctor` in each workspace (`--config vitest.e2e.config.ts` for
`tools-smoke`, `src/components` for `extension-components`, `--passWithNoTests` for `extension-messaging`),
sequentially on an otherwise idle 192-core host, 2026-09-21 20:56–21:48 UTC. Doctor runs every alternative
under `--bun` too (it spawns `process.execPath`), so these are Bun numbers. Each row is doctor's own **min of
3 runs** (2 for `bridge-core`, **1** for the extension aggregate — doctor drops the repeats on long suites),
and its numbers are *warm* for the baseline and *priming* for `fsModuleCache` (the cache is written during the
measured run). The extension aggregate was measured twice (two doctor passes; the plan asked for three repeats,
which doctor's own min-of-N gives on every other suite). **Nothing is adopted** — every row below is an input to
a future runtime-change plan under the 30-run bar, not a decision.

| Suite | baseline (forks · isolate) | `pool: threads` | `isolate: false` | `fsModuleCache: true` | doctor's recommendation |
|---|---|---|---|---|---|
| legal | 0.61 s | 0.54 (−11 %) | 0.64 (+5 %) | 0.54 (−11 %) | threads |
| resolve-asset | 0.74 s | 0.57 (−22 %) | 0.52 (−30 %) | 0.48 (−35 %) | fsModuleCache |
| wallet-sdk-schema-patch | 0.72 s | 0.63 (−13 %) | 0.60 (−16 %) | 0.57 (−21 %) | fsModuleCache |
| third-party-notices | 0.79 s | 0.74 (−6 %) | 0.85 (+7 %) | 0.68 (−14 %) | fsModuleCache |
| landing | 0.61 s | 0.60 (−1 %) | 0.61 (±0) | 0.52 (−14 %) | fsModuleCache |
| wallet-crypto (jsdom) | 6.51 s | 10.65 (+64 %) | 7.06 (+8 %) | 6.36 (−2 %) | keep |
| extension-messaging (jsdom) | 1.55 s | 1.66 (+7 %) | 1.47 (−5 %) | 1.25 (−19 %) | fsModuleCache |
| wallet-core (jsdom) | 1.66 s | 2.00 (+20 %) | 1.44 (−13 %) | 1.37 (−17 %) | fsModuleCache |
| wallet-bridge | 1.09 s | 1.09 (±0) | 1.08 (−1 %) | 1.00 (−9 %) | keep |
| design (jsdom) | 2.59 s | 5.97 (+131 %) | 2.29 (−12 %) | 1.62 (−37 %) | fsModuleCache |
| aztec-runtime | 2.19 s | 3.88 (+77 %) | 2.63 (+20 %) | 1.75 (−20 %) | fsModuleCache |
| bridge-core (min of 2) | 15.09 s | 17.09 (+13 %) | 8.19 (−46 %) | 7.31 (−52 %) | fsModuleCache |
| tools-smoke (jsdom) | 8.13 s | 8.24 (+1 %) | 7.47 (−8 %) | 5.17 (−36 %) | fsModuleCache |
| tools (jsdom) | 9.26 s | **failed** | 9.86 (+6 %) | 6.48 (−30 %); `maxWorkers: 79` on top 6.81 | fsModuleCache |
| extension-components (jsdom) | 4.85 s | **failed** | 4.79 (−1 %) | 2.10 (−57 %) | fsModuleCache |
| extension, pass 1 (min of 1) | 86.84 s | **failed** | 86.97 — **fails under a shuffled file order** | **failed** | keep |
| extension, pass 2 (min of 1) | 84.36 s | **failed** | 88.21 — **fails under a shuffled file order** | 116.98 (+39 %) | keep |

What the failures are:

- `pool: 'vmThreads'` / `'vmForks'` fail on **every jsdom suite** with `TypeError: Proxy is not allowed in the
  global prototype chain` (`module-evaluator.js:347 getDefaultRequestStubs`) — oven-sh/bun#42331, the other open
  Bun `node:vm` bug (a Proxy in a `DONT_CONTEXTIFY` global's prototype chain). Doctor only tries the vm pools
  where a DOM environment is configured; the node-environment suites never see them.
- `pool: 'threads'` on the three largest jsdom suites (`tools`, `extension-components`, `extension`): the run
  hangs and doctor kills it (`[vitest-pool]: Timeout terminating threads worker …`, "the run was killed after
  exceeding 347s - several times the baseline duration"). Bun's `worker_threads` under vitest's threads pool
  is not a usable pool for this repo today; where it does run (the small suites) it is slower on every jsdom
  suite (+7 % to +131 %).
- `isolate: false` on the extension aggregate: the same wall-clock, and doctor's shuffled-order check finds
  tests that depend on isolation (`packages/aztec-runtime/src/pxe/service-sweep.test.ts` "a genuinely orphaned
  profile dir … IS removed" — `removeProfileStoreDirs` never called once another file's module state is
  shared). This is the answer the plan predicted (per-file `vi.stubGlobal` and shared `window` state); it is
  also a useful signal about the suite, not just the option.
- `fsModuleCache: true` on the extension aggregate: pass 1 red — `src/presto/client.test.ts` "a fresh module
  instance (a new page context) gets its own client" timed out at 5 s (`vi.resetModules()` + a dynamic import
  while the cache was being primed); pass 2 green but **+39 %** on the priming run. The cache's payoff is on
  reruns, which the plan already discounted for cold CI; the 30–57 % wins on the mid-size suites are priming
  runs too, so they understate the warm gain and say nothing about a CI runner that starts cold every time.
- `maxWorkers: 79` (doctor's own candidate on the two largest suites): +1 % / +11 % on the extension, −27 % vs
  baseline on `tools` only in combination with `fsModuleCache`. Worker count is not the bottleneck here.

Reading: the only candidate with a consistent, large, engine-safe effect is `fsModuleCache`, and only on warm
reruns — a local-loop convenience, not a CI change, and it needs its own plan (the cache dir, its invalidation,
the `vi.resetModules` interaction above, and the 30-run matrix). `isolate: false` is ruled out for the extension
by the shuffled-order failure; `threads` is ruled out on Bun outright; the vm pools are blocked on Bun.
