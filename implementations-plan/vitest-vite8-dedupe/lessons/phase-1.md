# Phase 1 — Delete unused devtools dep + fix the test-script footgun

## Changes
- Removed `vite-plugin-vue-devtools` from `packages/extension/package.json` devDependencies (it was declared but imported by no vite config / Storybook / browser wrapper — codex caught this; re-verified).
- Removed the stale `_base.scss:4` comment (it described the now-deleted plugin's overlay-CSS injection).
- `@nulo/extension` `test`: `vitest` → `vitest run` (it was the only watch-mode test script in the workspace; cause of the `audit:vue`/`test:all` local hang).

## Result
- `bun install` diff: **69 package entries removed, 4 re-homed** (`@vue/devtools-kit`, `@vue/devtools-shared`, `perfect-debounce`) — those are still pulled by **pinia** + **vue-router** via `@vue/devtools-api`, so bun re-keyed them under their real consumers (not new packages). No `vite@7` added. Net supply-chain reduction (the plugin dragged in a babel + rollup-devtools subtree).
- Remaining `vite@7.3.2`: only under `vitest/vite` (bun.lock:2659) — the Phase 2 target.

## Preserved gotcha (from the deleted comment)
The removed comment encoded a real lesson worth keeping out of band: **never `@import "/node_modules/..."` (leading `/`) in SCSS** — `vite-plugin`'s postcss-import treats a leading `/` as filesystem-absolute on Linux, so it resolves on macOS dev but breaks production CSS resolution on Linux CI. Use relative or package-style import paths.

## Validation gate — PASS
- `bun install --frozen-lockfile` → exit 0
- devtools chain absent from `bun.lock` → `CHAIN-GONE`
- `bun run build` (extension chrome) → exit 0, built in 2.39s (nothing depended on the plugin)
- `bun run test:all` → exit 0, **no watch hang** (footgun fix confirmed); all 11 packages green (extension 2597·7 todo, faucet 413, design 249, wallet-bridge 154, extension-messaging 145, bridge-core 127·2 skip, wallet-core 93, aztec-runtime 34, wallet-crypto 23, landing 3).
