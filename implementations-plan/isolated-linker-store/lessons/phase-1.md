# Phase 1 — B1: @nulo/resolve-asset + consumer hardening (hoisted)

## Built

- `packages/resolve-asset` (no deps, bottom layer): `resolvePackageRoot` (3-attempt: package.json → bare `.` under require → `entry` subpath ascent), `resolvePackageAsset`, `resolveExportedAsset`, `assertPackageIdentity` (+`lockstepVia`), `isUnderNodeModules`. 14 unit tests against the REAL packages (pxe's no-`.`, sqlite3mc's import-only-`.`, patched-noir attempt-2, lockstep).
- All 6 walker copies replaced (vite.shared.ts canonical wrapper keeps the `resolvePackageFile(pkg, file)` signature so call sites didn't churn; bridge-core script + test, aztec-runtime test, extract-bb-wasm, the sqlite3mc emission → `resolveExportedAsset`).
- `noirAliases` → resolver-based. `fuel-testnet.ts` dead path fixed (renamed package + resolver). Phantoms declared: `@aztec/sqlite3mc-wasm: "5.0.1"` (extension) + `zod` (bridge-core); `@nulo/resolve-asset` edges added (extension, bridge-core, aztec-runtime dev). Minimal v1-preserving lockfile diff (+16 lines) — B1 is frozen-installable (codex B-2).
- `gen-remappings.ts` (atomic write, forge-version-recorded effective-mapping assertion) + wired at verify-l1.ts startup; remappings.txt gitignored; foundry.toml comment documents the mechanism; portal-artifact.ts deliberately unwired (builds in l1-artifacts' own root).
- Identity test `apps/extension/scripts/layout-identity.test.ts` (6 assertions, extension + cross-workspace anchors, lockstep, patch markers) — runs in the aggregated suite forever.
- UPDATE.md: sqlite3mc explicit-pin row + the lockstep-guard pointer.

## Found along the way

- **vite-node rewrites `import.meta.url` to `http://localhost:3000/@fs/<abs>` in jsdom-transformed test files** — createRequire rejects it. Fixed IN the resolver (`toFileAnchor`: `/@fs/` URLs normalize losslessly; non-@fs http throws with guidance). The fable audit's dev-server `/@fs/` warning materialized a phase early, in tests — the resolver is now robust to it everywhere.
- **`bun run --parallel` failure semantics**: when ONE leg fails, the siblings die with exit 130 (SIGINT) — in `audit:vue` output the REAL failure is the `Exited with code 1` line, not the 130s. Two "mystery" 130 runs were actually a biome FORMAT error (error-level, unlike the repo's 30-odd warnings) in the two new test files. `bunx biome check --fix` on them; lint green (36 warnings, all pre-existing files).
- Host forge note: no `~/.aztec/current/bin/forge` on this machine; PATH forge (`~/.foundry/bin/forge`, v1.7.1) used. `forge remappings` CONFIRMED the generated `@aztec/` mapping takes precedence (Fact 8 now empirical). `forge build` skipped environmental: `contracts/bridge/evm/lib/` (forge deps) not populated on this host — operational prerequisite, not a code defect.

## Gate (all under machine bun 1.4.0, hoisted layout)

`bun run audit:vue` exit 0 (4,597 tests incl. the 6 identity assertions; chrome build ✓) · `bun run test:all` exit 0 · resolver 14/14 · `bun install --frozen-lockfile` no changes · `bun test scripts/release/ scripts/ci-cd/` 94/94 · `bun run lint:actions` 0 · `bun run lint` 0 · gen-remappings + `forge remappings` assertion ✓ (forge 1.7.1) · forge build: environmental skip (lib unpopulated), logged.
