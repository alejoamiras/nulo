# Phase 4 — Q7: de-fork the vite/vitest config sprawl

Branch `refactor/q7-config-defork` off `dev` (10ae086, post-Q14). Last arc.

## Re-verified vs current dev (stale-snapshot guard)
- The "Keep in sync" duplication is real: `resolvePackageFile` is copy-pasted in `vite.config.ts` + `vitest.config.ts` (the latter's comment literally says "Keep in sync"); the `define` base block + the two artifact aliases are duplicated too.
- The sync **had drifted**: `vitest.e2e.all.config.ts` (covers `tests/e2e/**`, which INCLUDES network tests) lacked the noir aliases + `pool:"forks"`/`isolate`/`retry` that `vitest.e2e.network.config.ts` has → `e2e:all` would throw `__wbindgen_malloc undefined` on darwin and lacked Chrome-state isolation.
- The browser wrappers (`vite.{chrome,firefox}.config.mts`) **mutated the shared `viteConfig` singleton in place** (`viteConfig.plugins?.push(crx(...))`, `viteConfig.build.outDir = ...`).

## What shipped
- New `vite.shared.ts` single-owns: `resolvePackageFile`, `srcDir`, `sharedDefine` (the 5 `__X__`), `artifactAliases`, and `noirAliases` (with the host-specific `__wbindgen_malloc` comment — registry #16: the comment travels with the helper).
- `vite.config.ts`: imports those; `@`/`~`/`src` → `srcDir`; artifact entries → `...Object.entries(artifactAliases)` (array form); `define` → `{ ...sharedDefine, <build-only extras> }`. Noir stays in `dedupe` (build path), unchanged.
- `vitest.config.ts`: dropped its copy of `resolvePackageFile` + the duplicated define/artifact aliases; imports from shared.
- `vite.{chrome,firefox}.config.mts`: **`mergeConfig(viteConfig, { plugins: [crx(...)], build: { outDir } })`** — fresh config, no in-place mutation. mergeConfig concatenates plugins (crx still last) + merges build.
- e2e configs: `@` → `srcDir`; network + all use `...noirAliases`; **e2e:all drift fixed** (gains noir aliases + `pool:"forks"` + `isolate` + `retry`). smoke unchanged except `srcDir` (no noir/`@aztec` inline — it runs no circuits). Kept each config's distinct test settings inline rather than forcing a `mergeConfig` test-base (mergeConfig concatenates arrays — would corrupt `include`/`exclude`); the de-fork is via shared primitives, which is lower-risk and still single-owns the duplicated surface.

## Before/after verification (the registry #16 "diff resolved configs" constraint)
Behavioral proof (stronger than a config-object dump — proves actual build/test behavior):
| Check | Result |
|---|---|
| lint | exit 0 (53 pre-existing warnings; new file + configs clean) |
| full unit suite | 201 files / 2450 tests (vitest.config.ts refactor works) |
| build:chrome | exit 0 — `dist/chrome/{manifest.json,service-worker-loader.js}` + assets |
| build:firefox | exit 0 — `dist/firefox/manifest.json` + assets |
| **no cross-leak proof** | chrome manifest = `"service_worker"`; firefox manifest = `"scripts"` + `browser_specific_settings` → the two wrappers produce DISTINCT correct per-browser manifests (the in-place-mutation bug class is gone) |
| e2e configs load | all 3 `import()` resolve (aliases/noir/shared OK) |
| smoke (`test:e2e`) | 69/76; 1 file failed = `security.test.ts > change password` with `ConnectionClosedError` + `Cannot read 'browser'` — the documented Chrome-cascade flake (~17-file connection death). Re-ran `security.test.ts` ALONE (fresh connection) → 3/3 pass. Flake, not a Q7 regression. |

Network-e2e: GATED (proves the network config still resolves on CI). Push → label `e2e:network`.

LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-4.md
