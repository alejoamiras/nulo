# Phase 2 — Dedupe Vitest onto Vite 8 via a declarative override

## Change
- Added to root `package.json`: `"overrides": { "vite": "^8.0.0" }`.

## Result
- `bun.lock` diff = exactly: `+overrides {vite: ^8.0.0}` and **removed** the `vitest/vite` (`vite@7.3.2`) entry plus its `vitest/vite/postcss` + `vitest/vite/rollup` children. vitest now resolves the hoisted `vite@8.0.11`.
- Single `vite@8.0.11` in the tree; **no** incidental app bump to 8.1.0 (the `^8.0.0` override resolved to the already-pinned aged-out 8.0.11). Zero `vite@7` anywhere.

## GOTCHA (important) — bun does not prune nested orphans on incremental install
After `bun install` applied the override, **`bun.lock` was already correct** (no `vite@7`, no `vitest/vite` subtree), but the on-disk `node_modules` still contained stale nested `vite@7.3.2` dirs (under vitest + the *deleted* devtools packages, whose dirs also lingered from Phase 1). So an incremental `bun install` leaves orphan nested dirs behind. Consequence: Phase 1's `test:all` had actually run vitest against the leftover 7.3.2 on disk, not vite 8.

**Fix / discipline:** verify dependency-graph claims against the **lockfile** (source of truth); verify the **physical** `node_modules` only after a clean `rm -rf node_modules && bun install --frozen-lockfile`. After the clean reinstall, `find node_modules -path '*/vite/package.json'` showed a single `8.0.11`, vitest used the hoisted copy, and all devtools dirs were gone. **CI is unaffected** — it checks out fresh, so `--frozen-lockfile` installs exactly the (correct) lockfile.

## Validation gate — PASS (after the clean reinstall)
- `bun install --frozen-lockfile` → exit 0
- nested vite under vitest → gone (uses hoisted); devtools dirs → ALL-GONE
- `find … vite/package.json` → single `8.0.11`
- `rg '"vite@7' bun.lock` → NO-VITE7 · `rg '"vitest/vite' bun.lock` → NO-VITEST-VITE-SUBTREE
- `bun run test:all` → exit 0, all 11 packages green, **identical counts to vite 7** (extension 2597, faucet 413, design 249, wallet-bridge 154, extension-messaging 145, bridge-core 127·2 skip, wallet-core 93, aztec-runtime 34, wallet-crypto 23, landing 3) → dedupe is behavior-neutral
- `bun run typecheck:all` → exit 0 (12) · `bun run lint` → exit 0 (54 pre-existing warnings, no errors)
