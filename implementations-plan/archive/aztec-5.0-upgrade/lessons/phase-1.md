# Phase 1 — Dependency bump + install hygiene ✓

## What landed
- All 7 package.json bumped `@aztec/* → 5.0.0-rc.1` (perl); `@aztec/viem` carve-out automatic (it's pinned 2.38.2, didn't match the `4.2.0` regex). accelerator → 5.0.0-rc.1; fee-payment → fb6f196 tgz; standards npm `4.2.0-aztecnr-rc.2` → fb… → `prerelease-334c38d` tgz.
- bunfig `minimumReleaseAgeExcludes`: enumerated the full 30-package @aztec 5.0 closure + accelerator.
- noir-wasm patches re-keyed `@4.2.0` → `@5.0.0-rc.1` (renamed files); both still needed (5.0 still ships `module: ./web/...` with no `exports`), both apply cleanly.
- `bun.lock` updated; 57 packages.

## Hard-won install lessons (save the next bump hours)
- **`minimumReleaseAgeExcludes` does NOT support globs.** `@aztec/*` was silently ignored — the gate still blocked every @aztec package by exact name. Must enumerate.
- **Bun gates frozen-lockfile installs of pinned <min-age versions** (this repo's Bun 1.3.13) — so CI `bun install --frozen-lockfile` needs the excludes too, not just the first resolve.
- **Bun #25305:** the gate also blocks NEW transitive @aztec packages on a fresh resolve (builder, key-store, noir-types, noir-protocol-circuits-types, native, world-state, telemetry-client, blob-lib, sqlite3mc-wasm, standard-contracts, noir-noir_codegen).
- **Resolution recipe used:** `bun install --minimum-release-age=0` once (trusted first-party + URL-pinned tgz) to get a complete lock, then extracted the full @aztec closure from `bun.lock` (`grep -oE '"@aztec/[...]"' bun.lock | sort -u`) and enumerated it in bunfig. `bun install --frozen-lockfile` then passes (CI-ready).
- **bb.js is build-extracted (not vendored)** — confirmed all three `extract-bb-wasm.ts` source paths exist at bb.js@5.0.0-rc.1 (`dest/node/.../barretenberg-threads.wasm.gz`, `dest/browser/.../fetch_code/browser/barretenberg{,-threads}.js`). No path-constant changes needed.

## Verification probes (Phase 1 gate)
- `@aztec/aztec.js/wallet` subpath + `WalletSchema` ✓; `@aztec/stdlib/schemas` ✓; `@aztec/wallet-sdk/base-wallet` + `getGasLimits`/`simulateViaNode`/`buildMergedSimulationResult` ✓ (base-wallet surface intact); `@alejoamiras/aztec-accelerator` `AcceleratorProver` + `AcceleratorPhase` ✓.
- ⚠️ **`checkAcceleratorStatus` is GONE** from the accelerator 5.0 `index.d.ts` — API changed. Phase 2 must read the 5.0 accelerator types + fix `chain-runtime.ts:180`.

## Typecheck catalog (106 errors → phase routing)
- @nulo/extension: 85 → **P3**
- @nulo/aztec-runtime: 53 → **P2**
- @nulo/faucet: 28 → **P4**
- @nulo/wallet-bridge: 13 (incl. schema-patch via extension copy) → **P3**
- @nulo/playground: 13 → **P4**
- @nulo/bridge-core: 3 → **P5**
- wallet-crypto / wallet-core / landing / extension-messaging / design: 1 each → investigate in P2 (likely a shared @aztec/foundation type surfacing once per package).
- Codes: TS2345 (46, arg-type — schema patch Zod `.args()`, fee sigs), TS2740 (30, missing props — type shapes), TS2339 (13, removed/renamed members), **TS2307 (8, cannot-find-module — moved imports; identify per phase)**, TS1360 ×4.
- Schema-patch breakage confirmed: `ZodFor<AztecAddress>` no longer assignable to `z.function().args(...)` tuple → P3 schema-patch type fix (all 3 copies).

LESSONS_FILE=implementations-plan/aztec-5.0-upgrade/lessons/phase-1.md
