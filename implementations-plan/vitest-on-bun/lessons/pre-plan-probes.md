# Pre-plan probes — Arc C (vitest-on-bun)

Run 2026-08-24 in the `vitest-on-bun` worktree (base `origin/dev` 6fe41b46, hoisted linker, vitest 4.1.10, Bun 1.4.0, Node 24.18.0 via nvm) BEFORE drafting the plan, so the plan rests on measured facts. Every command is the package's real `test` invocation with `--bun` added (`bun run --cwd <pkg> --bun vitest run`).

## 1. Feasibility spikes — one run each, retry-0

| Suite | Env | Node | Bun (`--bun`) | Verdict |
|---|---|---|---|---|
| `apps/landing` | node (config-less) | 3/3, 115 ms | 3/3, 89 ms | identical |
| `packages/bridge-core` | node (+ heavy Aztec/WASM graph) | 27 files / 223 tests (4 skipped), 4.44 s | 27 / 223, 3.47 s | identical |
| `packages/wallet-crypto` | jsdom | 14 / 112, 5.99 s | 14 / 112, 5.16 s | identical |
| `apps/extension` aggregate | jsdom (+ 6 cross-included packages) | (baseline pending) | **124 files failed / 248 passed; 11 tests failed / 2820 passed**, 33 s | ONE root cause — § 3 |

No side-effect writes in the tree after any run (`git status` clean; the extension config runs `unplugin-auto-import` with `dts: false`).

## 2. Worker identity — the workers run on Bun, not just the launcher

Scratch probe (`--root <scratch>`; a plain-object vitest config; test prints `process.execPath` / `process.versions`):

| Launcher | pool | worker `execPath` | `process.versions.bun` | `process.versions.node` | `typeof Bun` |
|---|---|---|---|---|---|
| `bun run vitest` | threads | `~/.nvm/…/v24.18.0/bin/node` | – | 24.18.0 | undefined |
| `bun run --bun vitest` | threads | `~/.bun/bin/bun` | 1.4.0 | 26.3.0 (compat string) | object |
| `bun run --bun vitest` | forks | `~/.bun/bin/bun` | 1.4.0 | 26.3.0 | object |

The worker `execArgv` under both runtimes: `--experimental-import-meta-resolve --require …/vitest/suppress-warnings.cjs --conditions node --conditions development` — Bun accepts them.

## 3. The extension failure: ONE interop defect, fully characterised

Every failing file raises the same shape — `TypeError: undefined is not an object (evaluating 'z.object')` (13×), `z.function` (2×), `z.string` (2×), `z.tuple`, `z.custom` — all from `import { z } from "zod"` in INLINED workspace code (27 non-test source modules across `apps/extension/src` + `packages/wallet-sdk-schema-patch`; the 124 failing files are their transitive test closure). It reproduces deterministically in isolation (`apply.test.ts` alone fails).

Diagnostic probe inside vitest (`import * as ns from "zod"; import { z } from "zod"`):

| Runtime | `typeof z` | `Object.keys(ns).length` | `ns.default` | `import.meta.resolve("zod")` |
|---|---|---|---|---|
| Node | object | 240 (incl. `z`, `default`) | object (238 keys) | `…/zod/index.js` |
| Bun | **undefined** | **238** (no `z`, no `default`) | object (238 keys) | `…/zod/index.js` (same file) |

Same file is loaded on both runtimes; Bun's *native* `import("zod")` / `require("zod")` both expose `z` (240 keys). So the loss happens in vitest's externalized-module interop, not in Bun's loader:

- `node_modules/vitest/dist/module-evaluator.js:241-246` `shouldInterop(path, mod)`: `!path.endsWith(".mjs") && "default" in mod` — zod's `index.js` (`"type": "module"`) has a `default`, so interop applies (the code carries a `TODO: should also skip .js with type="module"`).
- `module-evaluator.js:336-349` `interopModule(mod)`: `defaultExport = mod.default`; **`if ("__esModule" in defaultExport) { mod = defaultExport; … }`**. zod's default export is itself an ES-module namespace object (`export default z` where `z` is `import * as`). Under Node `"__esModule" in <namespace>` is `false`; **under Bun it is `true`** — Bun deliberately lets `__esModule` resolve on namespace objects (a 1.1.32-era change made to fix a Vite regression; see the Bun v1.1.32 release notes). vitest therefore replaces the whole module with its `default` (238 keys) and the named export `z` is gone.

Positive controls (probe inside the extension config, Bun runtime): `test.deps.interopDefault: false` → `z` present, 240 keys; `server.deps.inline: ["zod"]` (vite transforms zod instead of externalizing) → `z` present, 240 keys.

Dependency-free reproducer (scratch, 5 files): a `node_modules/ns-default-lib` whose `index.js` does `import * as impl from "./impl.js"; export * from "./impl.js"; export { impl as z }; export default impl`, and a test `import { z } from "ns-default-lib"; expect(typeof z).toBe("object")`. Node: pass. Bun 1.4.0: `typeof z=undefined … "__esModule" in ns.default=true`. **Bug class**: any externalized ESM package whose `default` export is a module namespace (or any object Bun answers `"__esModule" in` for) loses its other named exports under `bun --bun vitest`. This is upstream-reportable to vitest (`interopModule` should test `Object.hasOwn(defaultExport, "__esModule") && defaultExport.__esModule === true`, or honour its own TODO) and cross-referenced to Bun.

## 3b. Full aggregate with the countermeasure applied — both runtimes, one run each

`apps/extension` aggregate with `test.deps.interopDefault: false` layered over the real config (`mergeConfig`; nothing else changed), the throwing diagnostic probe still present (it is the ONLY red in both rows):

| Runtime | Files | Tests | Duration (the two runs were concurrent — contended, indicative only) |
|---|---|---|---|
| Node 24 | 372 passed / 1 failed (probe) / 2 skipped (375) | 4635 passed / 1 (probe) / 2 skipped / 7 todo (4645) | 131.9 s |
| Bun 1.4.0 | 372 passed / 1 failed (probe) / 2 skipped (375) | 4635 passed / 1 (probe) / 2 skipped / 7 todo (4645) | 115.9 s |

Identical file and test sets on both runtimes; `interopDefault: false` regresses nothing under Node on 4,635 tests. Single run — the retry-0 flake baseline is still owed before any flip.

## 3c. Every remaining suite, single run, sequential (no contention) — default configs, no countermeasure

| Suite | Env | Node | Bun (`--bun`) | Verdict |
|---|---|---|---|---|
| `apps/extension` aggregate (baseline, no override) | jsdom | 372 files / 4635 tests | (see § 3: 124 files red without the countermeasure; 372/4635 with it) | interop |
| `packages/wallet-bridge` | node (config-less) | 6 / 210 | **2 files red** (`dispatcher`, `method-descriptors`) — `z.function` | interop |
| `packages/wallet-sdk-schema-patch` | node (config-less) | 1 / 5 | **1 file red** — `z.function` | interop |
| `packages/aztec-runtime` (incl. the 7 bb.js-WASM node-only files the aggregate excludes — `apps/extension/vitest.config.ts:52-70`) | node (config-less) | 20 / 189 | 20 / 189 | identical |
| `packages/wallet-core` | jsdom | 19 / 233 | 19 / 233 | identical |
| `packages/extension-messaging` | jsdom | 11 / 188 | 11 / 188 | identical |
| `packages/design` (Vue SFC) | jsdom | 37 / 313 | 37 / 313 | identical |
| `apps/faucet` unit (Vue SFC + component resolver) | jsdom | 53 / 542 | **6 files red** — `z.function` | interop |
| `apps/faucet` `vitest.e2e.config.ts` (jsdom in-process smoke, no browser) | jsdom | 3 / 15 | **3 files red** — `z.function` | interop |

Every Bun failure in the repo is the ONE interop rule from § 3, reached through `@nulo/wallet-sdk-schema-patch/src/apply.ts` (`z.function(...)` at module top level). The config-less packages hit it too: a workspace package resolves through the `node_modules` symlink to a path OUTSIDE `node_modules`, so vitest inlines its source and its `import { z } from "zod"` goes through the module runner. bb.js WASM under the node environment (aztec-runtime's own suite, the files the jsdom aggregate excludes) is identical on Bun.

## 3d. Watch mode under Bun (I3, partial)

`timeout 40 bun run --cwd packages/design --bun vitest --reporter=dot`: watch mode boots on Bun, the initial pass is 37 files / 313 tests, and after SIGTERM no vitest process of this run survives (`pgrep` shows only another worktree's unrelated e2e run). Edit → rerun → Ctrl-C is still owed as the plan's watch smoke; boot + initial run + clean death are verified.

## 4. What this means for the plan

- The extension flip is NOT blocked by 124 independent failures — it is blocked by one interop rule with two proven config-level countermeasures. Which one (repo-wide `deps.interopDefault: false` vs per-config `server.deps.inline: ["zod"]` vs holding the extension on Node until an upstream fix) is a plan-time decision for the codex gate, decided on the full-suite evidence under BOTH runtimes with the candidate applied (runs in progress at the time of writing).
- Everything else measured so far (node control, heavy WASM node graph, leaf jsdom, both pools) is identical between runtimes — consistent with the dossier's claim, and consistent with "the vitest claim is not a jsdom certification": the flake baseline still has to be run.
