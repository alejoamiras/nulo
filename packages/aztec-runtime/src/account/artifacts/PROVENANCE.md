# SchnorrAccount.json — provenance

Vendored raw compilation artifact for the Schnorr account contract: the frozen, address-bearing
input to Nulo account addresses (loaded by `../frozen-artifact.ts`). These are the `nulo-v6`
regime's bytes.

- **Source package**: `@aztec-labs/accounts@6.0.0-rc.1` (npm), file `artifacts/SchnorrAccount.json`.
  `@aztec-labs/noir-contracts.js@6.0.0-rc.1` ships the same bytes as
  `artifacts/schnorr_account_contract-SchnorrAccount.json`.
- **Lockfile tarball integrity** (`bun.lock` entry for `@aztec-labs/accounts@6.0.0-rc.1` at vendor
  time): `sha512-YMqpyglmiBZ5683chyiy0Nu+Pd9Opl4Y6fTh+oqDpoJ1wFC7cD+alfgOcAPNNMqna/lB6vjqOoQZ+CnL1vzMRA==`
- **Trust basis**: the package has no provenance attestation and no repository field. It is trusted
  on its npm registry signature (`npm audit signatures`) and its publisher: `charlielye`, with
  maintainers `charlielye` and `nchamo`, the same set as every `@aztec-labs/*` name at `6.0.0-rc.1`.
- **Extraction**: byte-for-byte copy of the installed package's file:
  `cp packages/aztec-runtime/node_modules/@aztec-labs/accounts/artifacts/SchnorrAccount.json packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json`
- **Vendored file sha256**: `4b4933a146a80872b184f47af22cd8ba3faa00f810d7a26217490c9d13507f94`
- **Contract class id of the loaded artifact**:
  `0x010cc0891c8748de2009734bf117485efbaf3aad0be125f151b4e6744f8f1842`
- **Previous regime**: the `nulo-v5` bytes (`@aztec/accounts@5.0.1`, sha256 `36562cde…2a63`, class
  id `0x0db53983…d0c5`) and their provenance stay readable on `dev` at
  `910a4defcbacbb4e76b53c1d57551a457b1d3fb0`:
  `git show 910a4defcbacbb4e76b53c1d57551a457b1d3fb0:packages/aztec-runtime/src/account/artifacts/PROVENANCE.md`.

This file is **not** bumped with the `@aztec-labs/*` line. Changing these bytes changes every
derived account address — that is an address-regime rotation, which ships only as a new extension
major (see the regime record in `../address-freeze.ts` and CLAUDE.md "Account-address freeze").

Pinned by `packages/aztec-runtime/src/account/artifact-freeze.test.ts` (file digest + loaded class
id) and by the full-chain KAT (`../derivation-vectors.test.ts`). The file is excluded from Biome
formatting so the bytes stay digest-exact.
