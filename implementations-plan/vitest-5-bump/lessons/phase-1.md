# Phase 1 — the bump commit (2026-09-21)

Outcome: **vitest 4.1.10 → 5.0.1 in all 14 workspaces; jsdom stays 29.1.1** (the 30.1.0 step was executed,
diagnosed as a Bun-only divergence and reverted on the owner's decision — § jsdom below). The stopgap
`deps.interopDefault: false` is gone with `vitest.base.ts`, its 15 spreads and the `biome.json` include;
`packages/resolve-asset` runs `bun --bun vitest run` through its own `vitest.config.ts`; `.vitest/` is
gitignored. No runtime-config key was added to any vitest config.

## Versions

| What | Value |
|---|---|
| Bun | 1.4.2 (744846f84) — every `test` script, `bun install`, `test:ci-gating` (`bun test`) |
| Node, host | 24.12.0 (`/usr/bin/node`) — used by nothing in this phase |
| Node, reference side | 24.21.0 via nvm (A3) — every Node execution here (`node-run.sh` wrapper on the scratchpad puts it first on PATH; a fresh shell still resolves the host binary) |
| vitest CLI | `bun --bun vitest --version` → `vitest/5.0.1 linux-x64 node-v26.3.0` in `apps/extension` and `packages/resolve-asset` (the `node-v26.3.0` is Bun's reported compat version) |
| vite | 8.2.1, unchanged (satisfies vitest 5's `^6.4.0 || ^7 || ^8`) |

## The age-gate exclude (local-only, deleted before the commit)

`bunfig.toml` carried, uncommitted, for the duration of the installs:

```toml
minimumReleaseAgeExcludes = ["vitest", "jsdom", "@vitest/mocker", "@vitest/spy", "@alejoamiras/presto", "@alejoamiras/presto-banners", "@alejoamiras/presto-core"]
```

| Name | Resolved | Published (UTC) | Why the gate named it |
|---|---|---|---|
| `vitest` | 5.0.1 | 2026-09-15 08:49 | the bump target (would have cleared 09-22) |
| `@vitest/mocker` | 5.0.1 | 2026-09-15 08:50 | `vitest` → `@vitest/mocker` (the one `@vitest/*` package v5 does not inline) |
| `@vitest/spy` | 5.0.1 | 2026-09-15 08:50 | `@vitest/mocker` → `@vitest/spy` (nested under mocker in the lock) |
| `jsdom` | 30.1.0 | 2026-09-17 00:57 | the second bump target (would have cleared 09-24) — attempt reverted, see § jsdom |
| `@alejoamiras/presto`, `-banners`, `-core` | already locked (5.2.0-revision.3, 1.1.0, 1.1.0) | young until 2026-09-25 22:10 | not bumped: a manifest edit re-gates the edited workspace's whole tree (CLAUDE.md § Dependency policy), and every vitest-bearing manifest was edited — the exclude only let the already-locked versions stay locked |

Each `bun install` was preceded by `bun install --ignore-scripts` + a lockfile diff read, then the real
install. The exclude was deleted, `git diff -- bunfig.toml` is **0 bytes**, and

```
bun install --frozen-lockfile --force   → exit=0   (995 packages installed, no gate message)
```

so a frozen install never re-gates the locked versions; nothing in this branch depends on the exclude.

## Provenance (registry attestation records, inspected — not verified cryptographically here)

Both bump targets carry two attestations each (`https://github.com/npm/attestation/tree/main/specs/publish/v0.1`
and `https://slsa.dev/provenance/v1`), fetched from `registry.npmjs.org/-/npm/v1/attestations/<pkg>@<ver>`:

| Package | SLSA subject sha512 (hex, leading) | = `bun.lock` integrity | Source | Workflow | Builder |
|---|---|---|---|---|---|
| vitest@5.0.1 | `880f799506ca124b…d08e` | YES | `github.com/vitest-dev/vitest` @ `refs/heads/main`, commit `03630a59…1106` | `.github/workflows/publish.yml` | `actions/runner/github-hosted` |
| jsdom@30.1.0 | `87f43e1fe2a69467…68aa` | YES | `github.com/jsdom/jsdom` @ `refs/tags/v30.1.0`, commit `556b11fc…dfb1` | `.github/workflows/publish.yml` | `actions/runner/github-hosted` |

Lifecycle scripts in the new tree: none in `vitest`, `@vitest/mocker`, `@vitest/spy`, `magic-string`,
`picomatch`, `tinybench`, `@jridgewell/sourcemap-codec`; `jsdom` declares `prepare: wireit`, which Bun does not
run for dependencies (`trustedDependencies` is undeclared; `bun pm default-trusted` does not list jsdom).
Maintainer fields were not compared — the diff read covered names, versions, publish dates and scripts.

## Lockfile diff against `25062c06` (final, after the jsdom revert)

Added: `vitest@5.0.1`, `@vitest/mocker@5.0.1` (+ nested `@vitest/spy@5.0.1`), `magic-string@1.3.1`
(2026-09-10), `picomatch@4.0.7` (2026-08-24), `tinybench@6.1.4` (2026-08-28),
`@jridgewell/sourcemap-codec@1.6.0` (2026-08-28). Storybook's `@vitest/{expect,spy,utils,pretty-format}@3.2.4`,
`chai@5.3.3` and `tinyrainbow@2.0.0` moved from nested-under-storybook to top-level keys (same versions —
vitest 4's 4.1.10 copies no longer occupy the names). Removed: the vitest 4 chain
(`@vitest/{expect,mocker,pretty-format,runner,snapshot,spy,utils}@4.1.10`), `@standard-schema/spec@1.1.0`,
`tinybench@2.9.0`, `tinyrainbow@3.1.1`. Twenty-odd nested `magic-string@0.30.21` / `picomatch@4.0.5` /
`sourcemap-codec@1.5.5` entries appear because the top-level names now resolve to the newer versions vitest
5 wants and every other consumer keeps its own — no version of theirs changed. The transitive set shrank
(vitest 5 inlines `@vitest/*` except mocker), as the plan expected. jsdom's tree is byte-identical to the
baseline: the reverted attempt had left `bidi-js` 1.0.3→1.1.0 and `@csstools/css-syntax-patches-for-csstree`
1.1.8→1.1.13 drifted (Bun keeps an already-locked version that still satisfies the range), so the lockfile was
restored from `25062c06` and re-resolved with only the vitest pins changed.

## Step 2(a) — vitest 5.0.1 on jsdom 29.1.1

`bun run test:all`: one red file, `packages/bridge-core/src/backup.test.ts` (6 tests) — `expect(...).rejects.toThrow(...)`
without `await`; vitest 5 fails an unawaited `resolves`/`rejects` assertion (vitest-dev/vitest#10868).
Classification: test-assumption bug (the assertions never ran under vitest 4). Fix: `await` at the 8 sites;
46/46 green. No `clearMocks` fallout anywhere. Vite prints `config uses features unsupported by configLoader:
'native'` twice per `test:all` (the extension's `vitest.config.ts` / `vite.shared.ts` /
`retry-error-reporter.ts` are ESM loaded through the CJS config loader) — a warning, behaviour unchanged;
noted as a follow-up.

## Step 2(b) — jsdom 30.1.0: a Bun-only divergence, reverted (STOP → owner)

With jsdom 30.1.0 installed, every jsdom-environment suite under `bun --bun vitest run` failed at worker start:

```
Error: [vitest-pool]: Failed to start forks worker for test files …
Caused by: TypeError: 'addEventListener' called on an object that is not a valid instance of EventTarget.
  jsdom lib/generated/idl/EventTarget.js:100 ← vitest catchWindowErrors ← jsdom env setup
```

The same file passed on Node 24.21.0 (`packages/wallet-crypto/src/nonce-uniqueness.test.ts`, 5/5).

**Mechanism, isolated without vitest.** vitest's jsdom environment creates `new JSDOM(html, { runScripts:
"dangerously", … })`, which makes jsdom build the window as `vm.createContext(vm.constants.DONT_CONTEXTIFY)`
and set `window._globalProxy = vm.runInContext("this", window)`; `dom.window` is that `_globalProxy`. jsdom 30
replaced the symbol-keyed wrapper brand (`wrapper[implSymbol]`) with a **private field** stamped through the
return-override trick (`class WrapperData extends ReturnValue { #impl … }`, `lib/generated/idl/utils.js`), and
every generated method checks `implForWrapperWithInterface(this ?? globalObject)` → `#impl in wrapper`. On Bun
the object `createContext` returns and the context's `this` are **two objects**: the brand is stamped on the
first, `window` is the second, a private field does not cross the proxy, so the check returns null and the
method throws. jsdom 29's symbol property crossed the proxy, which is why it works on both engines.

Standalone probe (`new JSDOM(html, { runScripts: "dangerously" })`, no vitest):

| Check | Bun 1.4.2 + jsdom 30.1.0 | Bun 1.4.2 + jsdom 29.1.1 | Node 24.21.0 + jsdom 30.1.0 |
|---|---|---|---|
| `window.addEventListener(...)` | **throws** | ok | ok |
| `window.dispatchEvent(...)` | **throws** | ok | ok |
| `document.addEventListener` / `new EventTarget()` | ok | ok | ok |
| `window._globalObject === window` | false | false | true |
| `window.globalThis === window` | false | false | true |

Without `runScripts` (no vm context) jsdom 30.1.0 works on Bun — which is not an option: vitest's environment
always passes it, and turning it off through `environmentOptions` changes what the environment executes.

Pure `node:vm` probe (no jsdom): `const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY)`; stamp a private
field on `ctx` via return override; then `ctx === vm.runInContext("this", ctx)` → Bun **false** / Node true;
brand present on `runInContext("this")` → Bun **false** / Node true; a plain property set on `ctx` is
readable through `this` on both (the proxy forwards properties, not private fields).

**Upstream.** oven-sh/bun#43671 "vitest jsdom environment with jsdom 30.1.0: forks worker fails to start
under bun (EventTarget brand check)" — filed 2026-09-21 by a third party, reproduced by the maintainers' bot
the same day with the same diagnosis ("in a `DONT_CONTEXTIFY` context, `this` is not the same object as
`globalThis` or the returned context; jsdom 30.1.0 depends on them being one object"); the named fix is
oven-sh/bun#34623 "node:vm: run DONT_CONTEXTIFY contexts directly against the real global", open since
2026-07-18, `REVIEW_REQUIRED`, unmerged at the time of writing. The report says jsdom 30.0.1 runs on Bun; 30.0.x
carries the `querySelectorAll` regression 30.1.0 fixed, so it was not tried. A related open bug,
oven-sh/bun#42331 (a Proxy in a `DONT_CONTEXTIFY` global's prototype chain, vitest `vmThreads`), does not apply
to this repo's `forks` pool. vitest-dev/vitest and jsdom/jsdom have no report of this.

**Decision (owner, 2026-09-21, asked with four options):** hold jsdom at 29.1.1 and ship vitest 5.0.1; jsdom
30 becomes a follow-up keyed to a Bun release that contains #34623. Rejected: waiting for the fix (the
vitest 5 work is otherwise ready), jsdom 30.0.1 (the selector regression), and `environmentOptions.jsdom`
workarounds (an engine workaround baked into six configs). Executed: the six `jsdom` pins back to `^29.1.1`,
`jsdom` dropped from the exclude, the lockfile restored from the baseline and re-resolved (see the lockfile
section), `bun run test:all` re-run on the final tree.

## I2 and the `fsModuleCache` path (verified against the installed 5.0.1)

- `experimental.viteModuleRunner?: boolean` at `vitest/dist/chunks/plugin.d.CN87HSxv.d.ts:4163` (resolved
  config: `viteModuleRunner: boolean`, `config.d.CU_b-wJj.d.ts:3753`); the Node-hooks path is the
  `native.*.js` chunk (`module.registerHooks`), which is why the never-flip rule stands on Bun.
- `fsModuleCache` help text: "…stored (default: `node_modules/.vitest-cache`)" (`chunks/cac.fSuRXrAx.js:1160-1162`);
  `doctor` reads `project.config.fsModuleCache === true`. Nothing in this repo sets either key.

## Gate (all on the final tree: vitest 5.0.1, jsdom 29.1.1, no exclude)

| Check | Result |
|---|---|
| `git diff -- bunfig.toml` | empty (0 bytes) |
| `bun install --frozen-lockfile --force` | exit 0, 995 packages, no gate message |
| `bun run lint` | exit 0 (33 pre-existing CSS warnings in the landing; `complexity-baseline check OK`) |
| `bun run typecheck:all` | exit 0, 0 `error TS` |
| `bun run test:all` | exit 0 — extension 542 files / 6840 tests (3 files, 4 tests skipped, 7 todo); tools 102 / 1461; bridge-core 46 (+3 skipped) / 437 (+9 skipped); aztec-runtime 33 (+1) / 246 (+2); design 39 / 327; wallet-bridge 10 / 279; wallet-core 21 / 247; extension-messaging 13 / 229; wallet-crypto 16 / 120; third-party-notices 5 / 65; legal 3 / 54; landing 4 / 40; resolve-asset 1 / 14; wallet-sdk-schema-patch 2 / 11; passkey-rp exit 0 |
| `bun run test:ci-gating` | exit 0 — 132 pass, 2 skip, 0 fail (134 tests, 11 files, 25.5 s) |
| `bun --bun vitest --version` | 5.0.1 (two workspaces) |
| `.vitest/` anywhere | none (`git status` clean of it) |

## Follow-ups (not in this plan)

- jsdom 30.x: re-attempt when a Bun release contains oven-sh/bun#34623; the six pins + the exclude procedure
  above are the whole change, and the standalone probe (`runScripts: "dangerously"`, `window.addEventListener`)
  is the 5-second pre-check before touching manifests.
- Vite `configLoader: 'native'` warning on the extension's ESM configs — harmless today; find out which loader
  vitest picks under `bun --bun` and whether `configLoader: "native"` in the config silences it.
