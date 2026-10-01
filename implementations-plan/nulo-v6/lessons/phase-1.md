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

## Steps 2–5 · Pins, install, supply chain, patches (2026-10-01)

- **Codemod.** `tools/scope-codemod.ts` rewrote 308 tracked files (1,058 lines). Its first run left
  41 blocking survivors, all hand-edit sites: scope globs (`@aztec/*`), bare prefixes
  (`"@aztec/"`), Bun store paths (`@aztec+…`) and the patch keys. Seven history lines kept their
  `@aztec/<pkg>@5.x` citations, and the `NULO_KDF_SPEC` line is untouched. `biome format` on the
  277 touched code files fixed 3; `biome check` on them reports only 4 warnings that predate the
  bump.
- **Package map, checked on npm.** Every `@aztec/<pkg>` the repo names exists at `6.0.0-rc.1` under
  `@aztec-labs/`, except `bb.js`, `l1-artifacts`, `noir-acvm_js` and `noir-noirc_abi`
  (`@aztec-foundation/`). The rc.1 tree also resolves `noir-noir_codegen` and `noir-types` under
  `@aztec-foundation/` (they were `@aztec/` in 5.2.0), plus new foundation natives: `bb-avm-sim`,
  `cdb`, `ipc-runtime`, `wsdb` and their four platform builds each. `@aztec/builder` left the tree.
- **Install.** The four excludes went in, `bun install` resolved, the patches were regenerated
  under them, then the excludes came out: `bun install --frozen-lockfile --force` exits 0 with
  `bunfig.toml` equal to HEAD's. The held split line is gone: no `@aztec/*@5.0.1` entry remains.
- **Lockfile exceptions** (`lockfile-exception-diff.ts`, now scope-normalised and classifying by
  the resolved package, not the lock key): 2 changed, 3 added, 0 removed, all from
  `@aztec-foundation/bb.js@6.0.0-rc.1`'s new `proper-lockfile ^4.1.2` dependency.
  `proper-lockfile@4.1.2` (2021-01-25, hugomrdias) needs `retry ^0.12.0` and `signal-exit ^3.0.2`,
  so the root keys `retry` 0.13.1 → 0.12.0 (2018-04-09, tim-kos) and `signal-exit` 4.1.0 → 3.0.7
  (2022-02-03, isaacs), and their previous consumers keep their versions as nested copies
  (`async-retry/retry` 0.13.1, `foreground-child/signal-exit` 4.1.0). Accepted: old, widely used
  versions, no new publisher.
- **Provenance** (`verify-provenance.sh` with the new ref argument, after a sha512 check against
  `bun.lock`): all 22 attested names verify.
  - The 18 `@aztec-foundation/*` names other than Standards: `AztecProtocol/aztec-packages`
    `ci3.yml` at `refs/tags/v6.0.0-rc.1`, commit `d521f0d940d096fbea5b62010d9c9c70f1dc0fd2`.
  - `aztec-standards`: `AztecProtocol/aztec-standards` `release.yml` at the tag, commit
    `cdfba943f59ae50cfb46f8c5e16fcce72d9abb42`.
  - `private-fee-juice`: `alejoamiras/ecosystem-tooling` `release.yml` on `main`, commit
    `76199c5933aa8b7a76b31bd66a0687edc64afc24`.
  - `presto` and `presto-core`: signed by the reusable `.github/workflows/_publish-npm.yml` on
    `main`, called from `release-sdk.yml`, commit `bc3eeee07f4f238ccce27fe2a7a4d513d5899c10`. The
    certificate names the reusable workflow, not the caller, so passing `release-sdk.yml` fails
    with only "verifying with issuer sigstore.dev". The Security table now names the signer.
- **Publisher continuity** (A8): all 23 `@aztec-labs/*` names at rc.1 were published by
  `charlielye`, maintainers `charlielye`, `nchamo`, no attestation. `@aztec/viem@2.38.3`: publisher
  `spalladino`, maintainers `charlielye`, `jaosef`, `ludamad`, `spalladino`, no attestation
  (2.38.2 was `charlielye`); `@aztec-labs/ethereum@6.0.0-rc.1` pins that exact version.
- **Registry signatures.** A scratch project with the 25 direct names at their exact versions,
  `npm install --ignore-scripts`: `npm audit signatures` verifies all 427 packages, 92 of them
  attested.
- **Patches** (I6 holds): the rc.1 noir pair still ships `"module"`-only manifests, so
  `bun patch` regenerated both as `patches/@aztec-foundation%2Fnoir-{acvm_js,noirc_abi}@6.0.0-rc.1.patch`
  with the same `exports` block, and the four old files and keys are gone. The codemod had also
  rewritten two of the old patch files' contents; they were deleted anyway.
