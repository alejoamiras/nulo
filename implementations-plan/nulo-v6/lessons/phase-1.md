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
- **Clean reinstall.** Stale 5.2.0 entries in the isolated store could resolve an undeclared import
  locally and hide a phantom dependency, so the tree was reinstalled from empty before the sweeps.

## Step 6 · Name-keyed sites (2026-10-01)

- The residue check (D14) now gates one generation: no held roots, `presto`, `private-fee-juice`
  and `aztec-standards` as single-generation roots, every `@aztec-labs/*` and `@aztec-foundation/*`
  lock entry on `6.0.0-rc.1`, and nothing locked from the retired scope but `@aztec/viem`.
  `bun scripts/aztec-hold-residue-check.ts` passes.
- `store/remote-code.md` cites upstream source lines; each citation was re-anchored to rc.1's
  sources (seven line ranges moved, no claim changed).

## Step 7 · Third-party notices (2026-10-01)

- **Where the `@aztec-labs` packages come from.** They carry no `repository` and no licence field.
  `aztec-labs-eng/aztec-node` is public, has the `v6.0.0-rc.1` tag, and holds `yarn-project/*`
  under the `@aztec-labs/*` names; `aztec-packages` at its rc.1 tag no longer has
  `yarn-project/stdlib`. The override cites `aztec-node`'s root LICENSE, and its text is now
  `texts/aztec-node.Apache-2.0.txt` (byte-identical to the old file and to the tagged source).
- **bb.js and the noir pair stay on `aztec-packages`**, whose `ci3.yml` signs them (step 4). The noir
  submodule at the tag is `5a7ee9bf5ed8973076df7bb0d2b723024db09ae7`. Every cited licence text is
  byte-identical to `texts/`; neither repository has a NOTICE file.
- **sqlite3mc did not move.** rc.1's `vendor/jswasm` (`sqlite3.wasm`, the OPFS proxy, `SHA256SUMS`)
  is byte-identical to 5.2.0's, and its README states the same 2.3.5 / 3.53.2 pin and archive
  sha256, so only `reviewedVersion` changed.
- **A newly bundled package: `@aztec-foundation/l1-artifacts`.** One module of it renders:
  `l1-contracts/scripts/network-defaults.json` (2.8 kB), reached through
  `@aztec-labs/ethereum/dest/config.js` ← stdlib's network-consensus config ← the PXE config ←
  `packages/aztec-runtime/src/pxe/chain-runtime.ts` (traced with a scratch build plugin). 5.2.0's
  `@aztec/ethereum` carried the same defaults as a generated module of its own, so the data is not
  new; its owning package is. The package ships no licence field or file and embeds the
  `@aztec/l1-contracts@0.1.0` manifest, which declares Apache-2.0 and has no licence file either
  (its Solidity sources are SPDX Apache-2.0). The shipped JSON is byte-identical to the tag. Added:
  an override and a vendored component, both on the `aztec-packages` root LICENSE (new
  `texts/aztec-packages.Apache-2.0.txt`, copied from the tag), and both names on the floor.
  `ALLOWED` is untouched.

## The bb.js shim, found by the parse-limit guard (2026-10-01)

- With the notices passing, the Chrome build failed `parse-limit-guard`:
  `aztec-foundation-bb-js~barretenberg{,-threads}` chunks of 5,233,713 and 5,235,941 bytes, over the
  4.5 MiB guard (and 9 kB under the add-on linter's own 5 MiB).
- They are bb.js's WASM inlined as data-URI modules. `bb-fetch-code-shim` should have replaced the
  fetcher that imports them, and it never matched, in 5.2.0 either: bb.js reaches its browser
  fetcher through `fetch_code/index.js`'s `export * from './browser/index.js'`, and neither
  specifier contains `fetch_code/browser`. A scratch build of each version's
  `barretenberg_wasm` entry emitted the inlined chunks for both; 5.2.0's were 4.14 MB, under the guard.
- That path was live: the WASM fallback prover (`createChonkProof` →
  `Barretenberg.initSingleton(this.options)`) passes no `wasmPath`. Only the `BarretenbergSync`
  singleton (`apps/extension/src/wallet/runtime.ts:452`) passes `/assets/barretenberg.wasm.gz`.
- **Fix, no gate loosened.** The shim moved to `apps/extension/scripts/bb-fetch-code-shim.ts`. It
  matches the resolved file instead of a specifier shape, and its `generateBundle` fails the build
  when bb.js's own browser fetcher is still in the graph. Every bb instance now loads the
  `.wasm.gz` assets `bb-wasm-emit` writes (byte-checked against the inlined payload by
  `extract-bb-wasm.ts`), and each build drops about 10.5 MB. The old predicate turns the new test
  red. Runtime proof is the network suites (P3, P5): every simulation and both canaries load bb.js.
- This settles the "dead shim" entry noted earlier for the owner: the bump made the fix mandatory,
  so it is no longer a choice.

## Steps 8–10 · API churn, the fixture, the sweeps (2026-10-01)

- **API churn.**
  - `FunctionAbi.returnTypes` became `returnType?`. rc.1's `loadContractArtifact` still writes
    both (`returnTypes: returnType ? [returnType] : []`), and `getFunctionReturnType` throws on
    more than one.
  - `FunctionCall` carries `returnType`; its schema still accepts a legacy `returnTypes` and
    `toJSON()` re-emits it, so the wire stays dual-shaped upstream.
  - `decodeFromAbi(undefined, …)` returns `undefined` where 5.2.0's `decodeFromAbi([], …)` returned
    `[]`, so a utility with no return value now simulates to `undefined`, as upstream's own
    `simulate` does. `call-decoder.ts` uses `decodeEachFromAbi`, and its arity shim is gone.
  - The PXE data schema moved 13 → 16 (`opfs-store.ts:42`); the store's stamp code is byte-identical.
  - AuthRegistry moved to `0x1ec33912…c3c5`, with the same slots (reject_all 1, approved_actions 2).
  - The dead `feeJuiceArtifact` export is deleted.
  - rc.1 dropped `getDefaultStandardPreloadedContracts()` and the historical handshake addresses;
    `createPXE`'s default `preloadedContractsProvider` registers MultiCall, AuthRegistry and
    HandshakeRegistry, and `pxe-provided.ts` follows it.
  - The token characterization snapshot was regenerated and proven equal to the mechanical
    `returnTypes: [x]` → `returnType: x` transform of the old one, so nothing else moved.
- **Fork-class re-diffs.**
  - `fee-options.ts`: only upstream's comment changed. Simulated txs are exempt from gas-limit
    admission (`isValidTx` with `isSimulation: true`), so ours now names the node's inbound
    validation as the backstop. stdlib's `gas.js` and `gas_fees.js` are identical.
  - Private-return nesting: rc.1 only caches its recursive zod schema; the walk is unchanged.
  - aztec.js's single-interaction `simulate` now reads the public return past the public fee calls a
    dApp's `request()` prepended. That is dApp-side; `ExecutionPayload` did not change.
  - Entrypoints: `returnTypes` → `returnType`, plus one moved source path in a comment.
- **Tests and the probe method.** Scalar, tuple and empty returns now run on the utility, public and
  private paths. The builder and the authwit discoverer get the lying fields, and the approval card
  gets a wire-shaped call plus a hostile copy (`OperationCard.wire.test.ts`). Each new test turned
  red when its sink was reverted. Foundation's poseidon takes `BarretenbergSync` when `self` exists,
  which throws `BBApiException: std::bad_cast` under vitest's jsdom. So hashing tests run in the node
  environment, and jsdom tests stub `FunctionSelector.fromNameAndParameters` with real selectors
  computed once with plain `bun` (`transfer_private_to_private` is `0xedc09d49` on the rc.1
  standard Token).
- **Deviation:** the plan names `authwit-discoverer.test.ts`; the lying-fields case lives in
  `authwit-discoverer.real.test.ts`, the node-environment sibling, because it needs a real hash.
- **Step 9:** `tests/e2e/fixtures/presto.ts` reads `aztec_version` and `available_versions` from
  `apps/extension/package.json`'s `@aztec-labs/pxe` pin, the key `__AZTEC_VERSION__` is baked from.
- **Step 10:** the phantom sweep prints nothing for `@aztec-labs/`, `@aztec-foundation/` or
  `@aztec/`; its other lines are vite aliases and `packages/design`'s storybook import, unchanged.
  `@aztec+` and `@aztec%2F` return nothing. `@aztec/` survivors, by class:
  - `@aztec/viem`, the one package the line keeps in the old scope (five sites);
  - versioned historical citations: two in `batched-view-simulation.ts`, one in
    `pxe/service.ts`, and `address-freeze.ts:63`, the frozen `NULO_KDF_SPEC` line;
  - `@aztec/l1-contracts` in `policy.ts` and `expected-minimum.txt`: the name rc.1's own nested
    manifest declares, which the notices embed check must match verbatim.
- **The freeze diff caught the codemod.** `a2e1bf47` had rewritten `artifacts/PROVENANCE.md`'s
  vendor-time `cp node_modules/@aztec/accounts/…` line. It records how the 5.0.1 artifact was
  extracted, so it was restored from the freeze base; P2 rewrites the file.

## Validation gate (2026-10-01)

- `bun install --frozen-lockfile --force`, `bunfig.toml` equal to HEAD with no exclude: exit 0.
- `typecheck:all` 0; `lint` 0 (the 28 warnings and 3 infos sit in files the bump does not touch).
- `test:release` failed three `zip-reproducible` cases on this host, which has no `zip`. With
  Info-ZIP 3.0 from Ubuntu's `zip_3.0-13ubuntu0.2` (fetched by `apt-get download`, extracted into
  scratch, on `PATH` for that one command): 162 pass, 0 fail, exit 0. CI's runner ships `zip`.
- `test:ci-gating` 0 (244 pass).
- `build:chrome` and `build:firefox` 0; `check-minimum` names all 37 components in both. Neither
  dist has an inlined bb WASM or an `aztec-labs-wallet-sdk*` chunk, and the About chunk bakes
  `6.0.0-rc.1` beside `0.28.0`.
- Playground build 0. The landing's prebuild first hit GitHub's unauthenticated rate limit (403);
  no token was passed, and the rerun after the limit reset exited 0.
- Package suites: wallet-bridge 508, wallet-sdk-schema-patch 11, resolve-asset 14,
  third-party-notices 66, wallet-crypto 120, all passing. The extension's `scripts/`, `src/presto/`,
  `src/wallet/crypto/` and `src/popup/windows/execute/`: 38 files, 325 tests, all passing.
- Freeze diff against `97b88e76`: exit 0. Residue check: passed. Supply chain: steps 2–5 above.
- Not in the gate, run to classify what is red: `test:all` exits 1, and each failure belongs to a
  later phase.
  - 9 aztec-runtime suites and 51 extension suites fail to load with `Could not generate contract
    artifact for SchnorrAccount: … 'storageExport.kind'`: the frozen 5.0.1 artifact under rc.1's
    loader, dark until P2 (Fact 7).
  - `protocol-fpcs.test.ts` (artifact sha256, derived address): P3's deliberate re-pin.
  - `default-tokens.test.ts`, the per-seed class check: P4.

## Found on the way, not caused by the bump

- `mintPublicTokens` (`apps/extension/tests/e2e/fixtures/aztec.ts`) compares `simulate()`'s
  result object with `0n`, so its zero-balance guard can never fire.
- `call-decoder.test.ts`'s "a selector is the truth" passes vacuously under jsdom: hashing throws,
  so every name misses.
- The standard Token's `transfer_private_to_private` takes `_nonce`, which the transfer
  vocabulary never corroborates, so the card shows decoded rows instead of the transfer row. Same
  on 5.2.0; an owner UI call.

All three are in plan.md's Follow-ups for close-out.
