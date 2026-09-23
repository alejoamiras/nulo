# Phase 3 — Flip to `linker = "isolated"` on the UNCHANGED v1 lockfile

## Baselines captured on hoisted (before the flip)

- Cold install (root node_modules removed, warm download cache): **0.99s** (hardlink backend on Linux ext4).
- WASM output hashes of the hoisted chrome build recorded (sqlite3.wasm, opfs proxy, barretenberg + threads .wasm.gz).

## The flip

- bunfig.toml: `linker = "isolated"`, comment rewritten (globalStore DELIBERATELY unset → per-project hardlinked store; CI never sees `links/`). `bun.lock` untouched (git shows no diff) — resolutions identical by construction.
- Cold isolated install: **0.27s** (958 packages; store dirs `node_modules/.bun/<pkg@ver>` real, workspace node_modules are symlink farms).

## Gate results (isolated)

- identity test 6/6 · resolver 14/14 (realpaths, patch markers on the patched noir packages, sqlite3mc lockstep — all hold on the symlink layout).
- `bun run audit:vue` exit 0 (4,597 tests; chrome build) · `bun run test:all` exit 0.
- Packaged-output assertions: WASM hashes **byte-identical** to the hoisted baseline; dist contains 0 symlinks; 0 files reference `/home/…` or `node_modules/.bun`.
- Dev-server smoke (fable condition): `vite dev` ready in 550ms; `/@vite/client` 200; popup `index.html` 200; the transformed entry `src/popup/index.ts` 200 and its imports resolve: workspace-package sources served via `/@fs/<abs>` → **200** (the feared `server.fs.allow` 403 on out-of-workspace realpaths did NOT occur), optimized deps `/node_modules/.vite/deps/*` → 200. (A raw `/@fs/…/node_modules/.bun/…` probe 404s — expected: vite serves optimized deps from `.vite/deps`, never raw store paths.)

## Incident: the dev-server smoke CLOBBERED dist/chrome (procedural, not a layout bug)

`vite dev` under @crxjs writes DEV loaders into the same `dist/chrome` outDir: `service-worker-loader.js` became `import 'http://localhost:8088/@vite/env' …`. The smoke e2e suite then loaded that extension with no dev server running → the service worker never booted → the fixture's 30s `nulo:liveness` gate timed out in every file → **29/32 files, 84 tests red**. Diagnosis path: TimeoutError at the liveness `waitForFunction` → all downstream `ctx.browser` undefined errors are consequences → inspected `dist/chrome/service-worker-loader.js` → dev-server URLs. Fix: `bun run build:chrome` (loader back to `import './assets/index.ts-…js'`, 0 dev-server refs), packaged-output assertions re-verified identical, smoke re-run.

**Standing rule (added to the Phase 3/4/5 gates)**: any dev-server smoke runs BEFORE the production build that e2e consumes, or is followed by a rebuild — never between build and e2e.

## Firefox build + fresh-checkout install timings (Phase 5 inputs, measured early)

- `build:firefox` under isolated: exit 0 (✓ built in 4.67s); dist/firefox: 0 symlinks, 0 leaked machine/store paths.
- Fresh-checkout cold installs (detached scratch worktree at HEAD, node_modules removed each run, warm download cache, Linux ext4):

| Mode | Wall | Notes |
|---|---|---|
| hoisted (`--linker=hoisted`) | **1.17s** | hardlink backend — already near-free on Linux |
| isolated, per-project store (the COMMITTED default) | **1.22s** | a wash vs hoisted |
| isolated + `globalStore = true` (opt-in), first populate | **0.28s** | one symlink per package |
| isolated + globalStore, store already populated | **0.36s** | ≈4× faster than hoisted |

Honest reading: the blog's "7× faster" is a macOS `clonefileat` + global-store story. On this host the committed default delivers NO install-speed win; the speed story exists ONLY in the opt-in global-store mode (~4×), which the posture memo keeps off the committed config (CI never touches `links/`). Arc B's justification therefore rests on correctness — phantom-dependency elimination, layout-agnostic tooling, executable identity guarantees — with the global store as a per-machine opt-in for worktree-heavy dev boxes. This reframing goes to the Phase 5 keep/abort convergence gate as-is.

Hygiene: the opt-in probe populated 910 entries in the REAL `~/.bun/install/cache/links` (a scratch bunfig override, not the repo's); purged afterwards so the machine's default state matches the committed posture. The scratch worktree was removed + pruned.

## Smoke result (production isolated build) + the ONE real layout consumer the inventory missed

Second smoke run (after the dev-clobber rebuild): **28 files pass, 104 tests pass, 2 fail** — both triaged:

1. `observability.test.ts` — **GENUINE layout consumer, missed by the recon inventory**: it spawned a child vitest via a hardcoded `resolve(pkgDir, "../../node_modules/.bin/vitest")` (repo-root `.bin`, which only exists when deps are hoisted) → ENOENT → `child.status === null`. Reproduced alone on a quiet host (so not concurrency). Fix: resolve from the extension workspace's own `node_modules/.bin/vitest` (vitest is its declared devDependency; the path holds under BOTH linkers). A repo-wide `.bin` sweep found no other repo-owned instance (the `global-setup.ts` hits are the separate aztec-up toolchain). The Phase 3 gate did exactly its job: the inventory was 6-of-7, and the executable gate caught the seventh.
2. `backup-migration.test.ts` — environmental: its own assertion text names the cause (repo build without `VITE_NULO_E2E_MIGRATION_FIXTURE=1` + runner without `NULO_E2E_MIGRATION_FIXTURE=1`, which `_smoke-e2e.yml` sets for repo-build runs). Rebuilt fixture-armed exactly as CI does.

Re-run of exactly those two files under CI conditions: **9/9 pass**. Phase 3 smoke leg: green.
