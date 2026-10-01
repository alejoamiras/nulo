# Phase 1 · The V6 line compiles

## Step 1 · The nulo-v5 freeze (2026-10-01)

- Freeze base: `97b88e76d444d9257c1a6b364ac6edeaf161bc16`
  (`refactor(account): freeze the nulo-v5 regime entry to literals`, signed).
- `REGIMES["nulo-v5"]` now holds the literals of `EXPECTED_REGIMES["nulo-v5"]`, including the KDF
  digest and the ack. The record no longer imports `frozen-artifact.ts` or
  `instantiation-descriptor.ts`, so loading it no longer loads the artifact.
- Gate on the V5 line: `bun run --cwd packages/aztec-runtime test` (35 files, 257 tests passed,
  2 skipped), `bun run typecheck:all` and Biome on the file, all exit 0.
- This SHA is the base of P1's `git diff --exit-code <freeze base> -- address-freeze.ts artifacts/`
  check, which stands in for the tests that import `frozen-artifact.ts` until P2 swaps the artifact.
