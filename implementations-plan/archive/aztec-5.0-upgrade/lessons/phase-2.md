# Phase 2 — aztec-runtime core migration ✓

Gate: `bun run --cwd packages/aztec-runtime typecheck` → 0 errors; `test` → 32 pass (incl. new fee cases); biome lint clean.

## The dominant finding: zod v3 → v4 (cross-cutting)
@aztec/stdlib 5.0 (+ foundation, aztec.js) requires **zod ^4**; the repo directly pinned **zod ^3.23.8** in `aztec-runtime`, `extension`, `extension-messaging`. Result: two zod copies in the lock (3.25.76 + 4.4.3) → every `ZodFor<AztecAddress>` (v4 shape, `$ZodTypeInternals`/`ZodPipe`) was incompatible with the repo's `ZodTypeAny` (v3). **Bumping the 3 pins to `^4` cleared 44 of aztec-runtime's 53 errors** and will also clear the schema-patch errors in P3 + the "1 error" in low-level packages. This is the single biggest lever in the whole migration. (A stale zod@3 copy still resolves for some non-@aztec transitive — harmless; the repo packages now resolve v4.)
- ⚠️ zod v4 has API changes (esp. `z.function().args().returns()`). The schema-patch (P3/P4) uses that and will need a v4-shape rewrite — TS2345 already flags it.

## The 9 substantive API fixes
- **fee-options.ts** (THE hotspot): re-derived `completeFeeOptions` from 5.0 base_wallet — estimation keeps optional gasLimits; the real-send fallback now fills `gasLimits` from `node.getNodeInfo().txsLimits.gas` (`new Gas(daGas, l2Gas)`) when the dApp declared none (`...overrides, gasLimits: overrides.gasLimits ?? maxTxGasLimits`). Skipped base_wallet's `assertGasLimitsWithinNetworkLimits` (the node's GasLimitsValidator is the backstop; explicit-over-limit fails at send). Added 2 new test cases (txsLimits default + explicit-wins + estimation-skips-fetch).
- **known-artifacts.ts**: auth_registry / multi_call_entrypoint / public_checks were DEMOTED from protocol contracts → import `AuthRegistryArtifact`/`MultiCallEntrypointArtifact`/`PublicChecksArtifact` from `@aztec/standard-contracts/{auth-registry,multi-call-entrypoint,public-checks}` (was `@aztec/protocol-contracts/...`). ContractClassRegistry/InstanceRegistry/FeeJuice stay in `@aztec/protocol-contracts` (still protocol contracts, compacted to addrs 1-3).
- **service.ts**: `proveTx(req, scopes)` → `proveTx(req, { scopes })` (ProveTxOpts bag). `@aztec/accounts/stub/schnorr` → `@aztec/accounts/schnorr/stub` (path order flipped; sibling `ecdsa/stub` likewise).
- **nulo-account.ts**: `getInitializationFunctionAndArgs()` is now `{...} | undefined` (the initializerless-account concept) → guard with a throw on the standard Schnorr path (it always has an initializer).

## Corrections to earlier notes
- **`checkAcceleratorStatus` is NOT gone** — the Phase-1 grep only scanned `index.d.ts` top-level exports; it's a method on `AcceleratorProver` and `chain-runtime.ts:180` typechecks fine. AcceleratorProver API is intact.

## Still ahead (routed)
- zod v4 `z.function` rewrite in the 3 schema-patch copies → P3/P4.
- TS2307 cannot-find-module elsewhere (P3 extension, P5 bridge) — likely more moved subpaths (message-delivery rename, etc.).

LESSONS_FILE=implementations-plan/aztec-5.0-upgrade/lessons/phase-2.md
