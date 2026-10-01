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

## MERGED — and the base-staleness lesson (applies to Q22 too)
Q7 (#113) + Q22 (#108) initially went RED on network-e2e across multiple runs — always on the
suite's flaky tests (authwit-lifecycle, incoming-transfers, cancel-mid-prove, heavy jobs), a
moving target on tests neither arc touches. Root cause was NOT the arcs: both branches were
synced to dev@`4d245bb` (#114), which is **before #115** (`feat(auth-registry): … + network-e2e
de-flake`). #115 de-flaked exactly those tests. dev had advanced to `fb8f61d` (#117) — #117
"passed everything" because it sits on top of #115. Re-syncing both branches onto the **real
current dev** (`merge origin/dev` → fb8f61d) brought #115's de-flake into their base; the very
next CI run was **fully green** (8/8 network jobs on each). Then `gh pr merge --squash --admin`:
Q7 → `9e76a83`, Q22 → `67b613c`.

**Lesson:** a network-gated PR must be synced to the LATEST dev *including any de-flake commits*
before trusting (or judging) its network result. A stale base silently re-introduces already-fixed
flakes and looks like a fresh flake. Always `git merge-base --is-ancestor <de-flake-sha> HEAD`
before concluding "flaky."

LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-4.md
