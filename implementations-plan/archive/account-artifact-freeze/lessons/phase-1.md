# Phase 1 — Vendor the raw artifact, with provenance

## What shipped

- Vendored `SchnorrAccount.json` (byte-for-byte from `@aztec/accounts@5.0.1`) into
  `packages/aztec-runtime/src/account/artifacts/`, with `PROVENANCE.md` recording package,
  lockfile tarball integrity, extraction command, and sha256.
- `frozen-artifact.ts`: loads the vendored JSON at module init (`loadContractArtifact`), exports
  `FROZEN_ARTIFACT_SHA256` = `36562cde36667a43cc9c6d8cbfc18bcf0ac13cdc9f816720273350ee59a92a63`
  and `FROZEN_ACCOUNT_CLASS_ID` =
  `0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5`.
- `artifact-freeze.test.ts`: (a) vendored file digest pin; (b) post-load class-id pin via
  `getContractClassFromArtifact`.
- `nulo-account.ts` consumes `FrozenSchnorrAccountArtifact` at both artifact touchpoints
  (`this.artifact` + `getContractInstanceFromInstantiationParams`).
- KAT (`derivation-vectors.test.ts`) green with ZERO vector edits — the vendoring is
  address-equivalent (vendored class id == npm class id, verified before switching).

## Lessons

1. **jsdom cannot run bb.js poseidon2** — the extension's vitest run (jsdom) picks up
   `packages/aztec-runtime/src/**/*.test.ts` and the new freeze test crashed with
   `BBApiException: std::bad_cast`, the exact failure mode already documented for
   `derivation-vectors.test.ts`. Fix: same exclusion in `apps/extension/vitest.config.ts`; the
   test runs in aztec-runtime's own node-env suite via `test:all`. Any future account-freeze test
   that hashes (class id, init hash) must follow this pattern.
2. **Biome must never touch the vendored JSON** — `biome check` would reformat it and break the
   digest pin. Added `!**/packages/aztec-runtime/src/account/artifacts` to `biome.json` includes.
3. **Bundle impact (measured, chrome dist, bytes)**:
   - Baseline (npm eager artifact only): 77,015,160.
   - Vendored + eager `@aztec/accounts/schnorr` wrapper kept: 78,459,333 (**+1,444,173**) — the
     marker string appears 2× in the same offscreen chunk: confirmed double-bundle.
   - Vendored + wrapper switched to `@aztec/accounts/schnorr/lazy`: 77,688,237 (**+673,077** net).
     The npm copy is isolated in a lazily-split chunk (`SchnorrAccount-*.js`) whose dynamic import
     (`getContractArtifact`) is never called by our code, so it is never fetched/parsed at
     runtime; the eagerly-loaded bundle carries exactly ONE artifact copy — the vendored one
     (marker count 1 in the index chunk). Residual accepted cost: ~0.66 MB of dead lazy-chunk zip
     weight; upstream remains the auth-witness/signing provider (no shadow class).

## Validation gate

`bun run lint && bun run typecheck:all && bun run test:all` — see transcript (exit 0; KAT green
unchanged; aztec-runtime suite 11 files / 88 tests including the two new pins).
