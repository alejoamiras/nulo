# Phase 2 · The V6 account regime

## Step 1 · The rc.1 artifact (2026-10-01)

- `packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json` is now a byte-exact copy of
  `@aztec-labs/accounts@6.0.0-rc.1/artifacts/SchnorrAccount.json`: sha256
  `4b4933a146a80872b184f47af22cd8ba3faa00f810d7a26217490c9d13507f94`.
  `@aztec-labs/noir-contracts.js@6.0.0-rc.1/artifacts/schnorr_account_contract-SchnorrAccount.json`
  hashes the same.
- Class id `0x010cc0891c8748de2009734bf117485efbaf3aad0be125f151b4e6744f8f1842`, computed the way
  `artifact-freeze.test.ts` computes it (`loadContractArtifact`, then
  `getContractClassFromArtifact`) under plain `bun`, never `bun test`. It matches Fact 7's
  `0x010cc089…1842`.
- `PROVENANCE.md` records the lockfile integrity (`sha512-YMqpyglm…vzMRA==`, the same in the root
  lock and in `reference/nulo-v6/bun.lock`) and the A8 trust basis from phase 1. Publisher
  `charlielye`, maintainers `charlielye` and `nchamo`, no attestation; `npm audit signatures`
  verified it in the 25-name scratch install.
- V5's bytes stay readable at `910a4defcbacbb4e76b53c1d57551a457b1d3fb0`, the dev commit the
  worktree branched from (#735). The freeze base `97b88e76` lives on this branch and leaves with the
  squash, so the provenance names the dev commit instead. Verified there: sha256 `36562cde…2a63`,
  an ancestor of both `HEAD` and `origin/dev`.
- P1's freeze diff (`git diff --exit-code 97b88e76 -- address-freeze.ts artifacts/`) is retired
  here. It stood in for the artifact tests until this swap, which changes both paths on purpose.

## Step 2 · Descriptor v1 carries over (I3)

- The constructor is still `constructor`, and its user-level parameters are unchanged:
  `signing_pub_key_x` and `signing_pub_key_y`, `Field`, private. Noir moved `1.0.0-beta.22+c57152f9`
  → `1.0.0-rc.3+5a7ee9bf`. The comparison read both raw JSONs, with no Aztec code loaded.
- rc.1's `ContractInstantiationData` still takes every input the descriptor freezes: constructor
  name, constructor args, `salt`, `publicKeys`, `deployer`, `immutablesHash`. Its one other input,
  `skipArgsDecoding`, is unset, so the init hash takes the ABI-encoding path, which is the identity
  for two `Field` arguments. The instance carries `version: 2`, from upstream.
- No descriptor v2. The KAT is the standing proof: Nulo's frozen path derives upstream's oracle
  address on all three reference rows.

## Steps 3–4 · `reference/nulo-v6` and the KDF checkpoint (D17)

- `reference/nulo-v6/` is a copy of the key-model-v2 generator: `@aztec-labs/*@6.0.0-rc.1` pins,
  its own `bun.lock`, and its own `bunfig.toml` stating the 7-day gate (no excludes), because the
  project sits outside the root workspace. The install log shows the gate acting:
  `@aws-sdk/client-s3` 3.1144.0 → 3.1139.0, `fast-xml-parser` 5.11.2 → 5.11.1, `@smithy/core`
  3.35.1 → 3.35.0. 386 packages.
- The generator reads `SchnorrAccount.json` from its own `node_modules`, refuses any sha256 but
  `4b4933a1…`, and builds the instances from those bytes. Upstream's oracle derives from the
  package's own module graph, so the per-row address equality also proves the two agree.
- Nothing else sees the project: the root workspaces are `apps/*`, `packages/*` and `infra/*`;
  Biome's includes and the root tsconfig's references omit `reference/`; every lockfile script
  reads the root `bun.lock` by fixed path; Renovate's disabled Aztec rule covers `@aztec-labs/*`.
- **Checkpoint: pass.** All 169 key-level leaves equal key-model-v2's (bip39 12, unicode 3,
  separators 4, salt 1, chain 1, account seeds 90, signing chain 34, full chain 24), and 0
  differ. The 9 address-level leaves all moved. The checker exits 1 when one `secretKey` is
  mutated, so it is not vacuous.
- The checkpoint is now a standing test: `derivation-vectors.test.ts` asserts that the two
  references agree on every key-level value.
- Two generator runs are byte-identical, and so are the two gate runs against the committed file.

## Steps 5–6 · The regime and its tests

- `REGIMES["nulo-v6"]` holds literals plus its ack. `V6_REGIME` replaces `V5_REGIME`, so nothing in
  this major can bind to the V5 entry, which stays as history. Rebound: `account/service.ts`,
  `account-integrity/coordinator.ts`, `account-export.ts`, `artifact-freeze.test.ts`.
- Rules text: the binding name; "shipped" defined as store-published (A1); and V6 as the one
  exception to the new-extension half, reusing V5's store items because V5 never had users (D1).
  `NULO_KDF_SPEC` is untouched. Its "upstream @aztec/accounts 5.0.1" line still describes the
  derivation, which the checkpoint shows did not move.
- `CURRENT_COMPAT_EPOCH` 4 → 5. Four valid-backup fixtures moved with it: the two composable tests
  and two e2e helpers (`import-drivers.ts`, `passkey-backup.test.ts`). Otherwise P5's suites would
  build backups the gate refuses. The epoch doc comment says the blob shape is epoch 4's, so the
  "epoch-4 shape" comments elsewhere stay true.
- `account-export.test.ts` refuses a genuine V5 file: the key-model-v2 first signing-chain row,
  the V5 digests, and a checksum from the export's own canonicalization. It is refused on
  `regime`. The same file relabelled `nulo-v6` is refused on `artifactSha256`, so the digests gate
  the file, not the label.
- `regimeId` fixtures: records this build writes now read `nulo-v6` (the coordinator and
  runtime-mismatch assertions, the barrier fixture, four profile integration records). The
  repository fixture stamped `walletVersion` 0.26.0 keeps `nulo-v5`. It models a V5-written row,
  which a V6 update over the reused store item can meet.
- Recon §2's other recomputing suites pass unchanged, because they derive from the installed
  artifacts: `register-contract.test.ts`, `descriptors-real-artifact.test.ts`,
  `note-schemas.test.ts`.

## Validation gate (2026-10-01)

- `bun run --cwd packages/aztec-runtime test`: 35 files and 259 tests pass. The skipped file is
  `stale-anchor.real.test.ts`, gated on a real network.
- `bun run --cwd packages/wallet-crypto test`: 16 files, 120 tests.
- `bun run --cwd apps/extension test src/wallet/services/account src/wallet/services/account-integrity src/wallet/services/backup src/wallet/crypto src/composables/useFullBackupImport`:
  20 files, 342 tests.
- `typecheck:all` 0; `lint` 0, with the same 28 warnings and 3 infos as phase 1; Biome is clean on
  the 20 touched files.
- The generator, run twice: both runs byte-identical to the committed `vectors.json`.
- Not in the gate, run to classify what is red: `test:all` exits 1 on 3 tests in 2 files, both
  owned by later phases. `protocol-fpcs.test.ts` (address, reviewed sha256) is P3's re-pin, and
  `default-tokens.test.ts` (the per-seed class check) is P4's. Every other workspace is green. The
  51 extension suites that were dark under P1 now load and pass: 628 files, with 3 skipped by
  their own environment gates.
