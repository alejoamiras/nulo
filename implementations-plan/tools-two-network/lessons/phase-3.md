# Phase 3 — Schema + build integrity

## Phase 3a — Atomic `l1.fuel` core/swap split (the codex round-3 HIGH)

**Commit:** `52b139f` · **Status:** ✓ (bridge-core typecheck 0 / 185 tests; faucet typecheck 0 / 509; lint 0).

### The split (derived from real field consumption, not the plan's guess)
- **`core`** (required when `fuel` present) = `router`, `permit2`, `swapTarget`, **`feeJuicePortal`**.
  `feeJuicePortal` is a *router constructor arg* (`verify-l1` `routerArgs = [permit2, feeJuicePortal,
  swapTarget]`), so it's a core dep — the plan had it unplaced.
- **`swap`** (optional; testnet-only) = `poolManager`, `quoter`, `weth`, `feeJuice`, `pools`,
  `slippageBps`, `minFuelFj`.
- `feeJuice.feeAssetHandler` → optional (mainnet BYO-$AZTEC, no permissionless handler).

### Migrated in ONE commit (the "atomic" requirement)
- **Typed consumers** (compiler-caught): `candidate-schema.ts` (the split), `live-intent.ts`
  (fuel.core.* + guarded the now-optional feeAssetHandler checks), `bridge-deployments.ts` (reads
  `core`, flattens core+swap into the unchanged `BRIDGE_FUEL` — so the **9 app consumers are
  untouched** and `BRIDGE_FUEL` auto-hides when swap absent), + the two colocated tests.
- **Untyped consumers** (grep-caught — codex round-3's misses, invisible to typecheck because they
  `JSON.parse`): `verify-l1.ts` (router always verified; UniswapFuelSwap verify gated on `swap`),
  `deploy-bridge-testnet.ts` (the rollup-coupled + env overrides now land INSIDE `core`),
  `fuel-testnet.ts` + `smoke-swap-existing-testnet.ts` (extract `core`/`swap` + guard swap present),
  `verify-deployments.ts` (`m.l1.fuel?.core?.*`).
- **Live `testnet-bridge.json`** migrated via a python round-trip (addresses preserved exactly).

### Gate
- **grep-completeness**: `\b(fuel|l1.fuel?).(router|swapTarget|permit2|feeJuicePortal|poolManager|
  quoter|weth|feeJuice|pools|slippageBps|minFuelFj)\b` minus `.core`/`.swap` → **zero hits**.
- Schema tests: live manifest still parses; a **bridge-only (core-only, no swap/no feeAssetHandler)
  manifest parses**; `fuel` without `core` rejects; the mutation-path tests moved to core/swap.
- The compiler-guided strategy worked exactly: typecheck listed every typed break; grep listed the
  untyped ones. Do NOT rely on "live manifest parses" alone — it's true while a untyped `JSON.parse`
  consumer still reads a moved field (that's why the grep gate exists).

### Gotchas
- `bridge-deployments.ts`'s `BRIDGE_FUEL` presence now keys off `fuel?.swap` (not `fuel`), so a
  bridge-only mainnet manifest yields `BRIDGE_FUEL === undefined` → swap UI hidden. The CORE fields
  are exported separately (`BRIDGE_ROUTER`/`PERMIT2`/`SWAP_TARGET`) for the `bridge()` path.
- `CandidateManifest.l1.fuel` in `deploy-manifest.ts` is deliberately `Record<string,unknown>` (loose
  — the schema is the strict gate), so a test reading `manifest.l1.fuel.core.x` needs a cast.
- biome flags `delete` in tests as an INFO (non-blocking); the existing schema test already used it,
  so the new mainnet-shape/missing-core tests keep the same `delete` style for consistency.

## Phase 3b — REMAINING (not yet done)
Config factory + `buildMetaPlugin(target)` + `build.json`; add `l1ChainId`/`walletChainId`,
`privateFpc` block, token `source` discriminant to the schema (additive/optional); the
target↔manifest↔node + hostname↔target startup assertions. These are the "two-network build" heart —
tracked as the next unit.
