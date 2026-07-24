# SchnorrAccount.json — provenance

Vendored raw compilation artifact for the Schnorr account contract: the frozen, address-bearing
input to Nulo account addresses (loaded by `../frozen-artifact.ts`).

- **Source package**: `@aztec/accounts@5.0.1` (npm)
- **Lockfile tarball integrity** (`bun.lock` entry for `@aztec/accounts@5.0.1` at vendor time):
  `sha512-IeHbWmvXtus4D6LoMLhkahkxdPGf42tUGVY8Qs4gpFvcPhoHwkfDRie/RlBKAkhiGjMJytkZLnq7rqxkNEMzYQ==`
- **Extraction**: byte-for-byte copy of `artifacts/SchnorrAccount.json` from the installed package:
  `cp node_modules/@aztec/accounts/artifacts/SchnorrAccount.json packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json`
- **Vendored file sha256**: `36562cde36667a43cc9c6d8cbfc18bcf0ac13cdc9f816720273350ee59a92a63`
- **Contract class id of the loaded artifact**:
  `0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5`

This file is **not** bumped with the `@aztec/*` line. Changing these bytes changes every derived
account address — that is an address-regime rotation, which ships only as a new extension major
(see the regime record in `../address-freeze.ts` and CLAUDE.md "Account-address freeze").

Pinned by `packages/aztec-runtime/src/account/artifact-freeze.test.ts` (file digest + loaded class
id) and by the full-chain KAT (`../derivation-vectors.test.ts`). The file is excluded from Biome
formatting so the bytes stay digest-exact.
