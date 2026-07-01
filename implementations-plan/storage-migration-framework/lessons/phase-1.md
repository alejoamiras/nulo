# Phase 1 — Engine (`packages/wallet-core/src/migration/`)

## Pre-flight: dev moved under the plan (monorepo restructure)
Branched `feat/storage-migration-framework` off **current** origin/dev (`9d04629`), which was **37 commits** ahead of where planning started. The big one: **PR #186 restructured the monorepo to a FLAT `apps/` + `packages/` layout** (deployable leaves under `apps/`, shared libraries under `packages/`).

Re-map applied to the plan (mechanical, design unchanged):
- `packages/extension/` → **`apps/extension/`** (the extension is now an app). Internal structure preserved (`src/wallet/`, `src/composables/`, `src/popup/`).
- `packages/wallet-core/` → **unchanged** — so **all of Phase 1 is unaffected** by the restructure.
- `manifest.config.ts` moved (no longer at `apps/extension/manifest.config.ts`) — re-find when Phase 3/6 needs the `unlimitedStorage` citation.
- `.github/workflows/_build-extension.yml` → still present (Phase 4 negative-grep target).
- biome `includes`/`noRestrictedImports` globs are on the new layout — Phase 3's static facade ban targets `apps/extension/**`.

## Phase 1 goal
Pure, `chrome.*`-free migration engine in `packages/wallet-core/src/migration/`: `Migration` type (+ `breaking`, footprint), `Migrator` with the §3.3 crash-safe journal (running-first barrier → atomic backup+sentinel → batched-diff+tombstones → stamp → clear; restore-before-retry; resume-on-prep-crash), fail-closed + durable bounded-retry, marker validation + decision table, injected data-source/backup/version ports, run-twice idempotency harness.

## Log
- (kickoff) Verified `packages/wallet-core/src/migration/` does not exist yet; `storage-port.ts` (`StorageArea`/`StoragePort`) is the port the engine builds on. Zod is in-tree (verify before use). Starting with the type definitions + a test-first Migrator.
