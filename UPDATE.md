# Updating `@aztec/*` and Noir

The checklist for bumping the Aztec / Noir dependency line. **`@aztec/*` is exact-pinned and bumped manually** (outside the 7-day min-age policy — see [`SECURITY.md`](./SECURITY.md) and [`CLAUDE.md`](./CLAUDE.md) § Dependency policy). A bump touches WASM resolution, native proving, on-chain identity invariants, and a runtime schema patch — none of which the type-checker or unit tests fully cover, so this doc is the human re-check list.

> **Convention:** any code that types against an `@aztec` shape (a PXE method signature, a wire type, an artifact field) MUST add an entry to **§ Types coupled to `@aztec` shape** below, with `file:line`, so the next bump has a checklist. Round-2 phase R4 (P18b PXE descriptor) is the first to append here.

Current line: **`@aztec/* = 5.2.0`** (Noir wasm packages `noir-acvm_js` / `noir-noirc_abi` carry Bun patches — see below). The Noir contract source (Nargo tags, `contracts/bridge/aztec/scripts/compile.sh`, committed `target/*.json`), `@aztec-foundation/aztec-standards` and `@alejoamiras/private-fee-juice` are HELD at 5.0.1 — a deliberate split line, see `implementations-plan/aztec-5.2.0-js-line/`.

## Before you bump
1. Read the upstream `@aztec/aztec.js` + `@aztec/pxe` changelog for the target version — note any renamed/removed exports, PXE method signature changes, or artifact-format changes.
2. Bump the exact pins in EVERY workspace `package.json` (root + `packages/*` + `apps/*`) — they must all match. `@aztec/*` does not go through `bun update --latest` cleanly (Bun #25305); prefer editing the pins + `bun install` (targeted re-resolution). Bun #25305 is CLOSED on Bun 1.4 — deleting `bun.lock` is no longer the ritual and is now a last resort, since a full regen also re-gates every already-locked version against the min-age policy.
3. Also bump the `packageManager` Bun version drift check if the upgrade requires it.

## Coupling points to re-verify (the re-check list)
1. **Bun patches on Noir wasm** — `patches/@aztec%2Fnoir-acvm_js@<ver>.patch` + `patches/@aztec%2Fnoir-noirc_abi@<ver>.patch`. The patch filenames pin the version; on bump they must be re-generated/re-verified against the new package or they silently stop applying. Confirm `bun install` still applies them.
2. **Noir WASM resolution (darwin arm64 + browser)** — `apps/extension/vite.shared.ts:63` aliases `@aztec/noir-acvm_js` to the package's `nodejs/` entry (fixes `__wbindgen_malloc undefined`); `apps/extension/vite.config.ts:79` `dedupe` + `:286` `optimizeDeps.exclude` list the noir/bb wasm packages. If the package's internal entry layout changes, these paths break — re-check the `nodejs/` path exists.
3. **On-chain identity invariants** — `packages/aztec-runtime/src/pxe/artifact-class-id.ts` (class-id derivation) + the deferred class-id + address invariant fixture. A protocol-version bump can change contract class ids / addresses for NON-account contracts; re-derive and update THOSE fixtures, and confirm the token artifacts still resolve. **EXCEPTION — the Nulo ACCOUNT artifact + derived account addresses are FROZEN and are NEVER re-derived here** (see coupling #7): the account KAT (`derivation-vectors.test.ts`) + the freeze tests must stay green with ZERO vector/pin edits. A red account KAT means new-major territory, not a re-pin.
4. **`WalletSchema` runtime patch** — `packages/wallet-sdk-schema-patch/src/{apply,register}.ts` extends `@aztec/wallet-sdk`'s `WalletSchema` with `registerToken` / `isTokenRegistered` / `grantPublicAuthwit`. If upstream changes `WalletSchema`'s shape or those method names, `apply.test.ts` + the wallet-bridge reachability pin (`packages/wallet-bridge/src/dispatcher.test.ts`) will catch it — but re-check the patch still composes.
5. **PXE seam** — `packages/aztec-runtime` PXE factory + client. PXE method signatures are an `@aztec` coupling surface; see § Types coupled to `@aztec` shape.
6. **Native proving (accelerator)** — the network-e2e installs `accelerator-server` (SHA-256-pinned in `.github/workflows/_network-e2e.yml`); a proving-backend bump may need a matching accelerator build. `VITE_NULO_ACCELERATOR_REQUIRED=1` makes a silent WASM fallback a hard fail.
7. **Frozen account surface — NOT bumped with the line** — `packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json` (vendored, digest-pinned), `frozen-artifact.ts` (sha256 + class-id pins), `instantiation-descriptor.ts` (frozen ctor name/args/salt/immutablesHash/deployer + digest), `address-freeze.ts` (append-only regime record + paired hardcoded test). A bump must leave the KAT (`derivation-vectors.test.ts`) and every freeze test green with ZERO vector or pin edits; the **frozen-account execution canary** (`apps/extension/tests/e2e/network/frozen-account-canary.test.ts`, run prover-ON via `bun run e2e:agent`) is a MANDATORY bump gate — a red canary blocks the bump (see the `aztec-update` skill + CLAUDE.md "Account-address freeze").

## Types coupled to `@aztec` shape
> Append here whenever you type against an `@aztec` type. Format: `- <type/signature> — <file:line> — <what breaks if the upstream shape changes>`.

**PXE seam (`packages/aztec-runtime/src/pxe/`) — the R4/P18b descriptor surface.** The method NAME/flag table is `descriptors.ts`; the SIGNATURES live in `spec.ts` + `ipxe.ts`; the response validation in `client.ts` + `schemas.ts`. On a bump, re-typecheck catches renames, but SEMANTIC changes (a field added to a result type, an opts default flipped) need eyeballing here:

- `Methods` (all 22 PXE signatures, incl. `provisionChainStoreKey`) — `packages/aztec-runtime/src/pxe/spec.ts:24-89` — params/returns type against `@aztec/stdlib` (`ContractArtifact`, `EventSelector`, `FunctionCall`, `AztecAddress`, `CompleteAddress`, `ContractInstanceWithAddress`, `PartialAddress`, `NoteDao`, `BlockHeader`, `TxExecutionRequest`, `TxProvingResult`, `TxSimulationResult`, `TxProfileResult`, `UtilityExecutionResult`), `@aztec/pxe/client/bundle` (`NotesFilter`, `PackedPrivateEvent`, `SimulateTxOpts`, `ExecuteUtilityOpts`, `ProfileTxOpts`), `@aztec/aztec.js/wallet` (`PrivateEventFilter`), `@aztec/foundation` (`Fr`). A renamed/reshaped upstream type breaks the whole seam's typecheck; a widened opts type can silently change wire behavior — diff the upstream type.
- `IPXE` (17-method in-process facade) — `packages/aztec-runtime/src/pxe/ipxe.ts:27` — same imports, promisified minus the `network` param; `descriptors.ts`'s `_IPXEMatchesTable` pins its key-set.
- Response zod pins in `PxeServiceClientBase` — `packages/aztec-runtime/src/pxe/client.ts:76-195` — `ContractInstanceWithAddressSchema`, `ContractArtifactSchema`, `CompleteAddress.schema`, `AztecAddress.schema`, `TxProvingResult.schema`, `TxProfileResult.schema`, `TxSimulationResult.schema`, `UtilityExecutionResult.schema`, `BlockHeader.schema`. An upstream schema shape change makes `parseAsync` REJECT valid responses at runtime (typecheck won't catch it) — the network e2e is the detector.
- `NoteDaoSchema` / `PackedPrivateEventSchema` / `NotesFilterSchema` — `packages/aztec-runtime/src/pxe/schemas.ts:11-42` — hand-built from `Note.schema`, `AztecAddress.schema`, `Fr.schema`, `TxHash.schema`, `BlockNumberSchema`, `inTxSchema()`, `EventSelector.schema`, `NoteStatus`; `NotesFilterSchema`/`PackedPrivateEventSchema` carry `satisfies ZodFor<...>` pins that break the build if the upstream type reshapes. `NoteDaoSchema` has NO satisfies pin (upstream `NoteDao` is a class) — re-verify its field list against upstream `NoteDao` manually.
- `PROVE_TX_TIMEOUT_MS` (30 min bb-proving ceiling) — `packages/aztec-runtime/src/pxe/client.ts:60-70` — not a type, but proving-duration coupled; re-validate if the proving backend changes.

**5.0.0-arc couplings (signing-key-root, OPFS store, canonical FPC, deploy intent):**

- `deriveNuloAccountKeys` / `deriveSigningKeyFromSeed` (NULO-ACCOUNT-KDF v1) — `packages/wallet-crypto/src/account-derivation.ts` — the FROZEN seed→signingKey→secretKey chain (`sha512ToGrumpkinScalar([seed, DomainSeparator.IVSK_M])` → `deriveSecretKeyFromSigningKey`). Types against `@aztec/stdlib` key derivation; ANY upstream change to those functions shifts every account address. The two-regime reference vectors (`implementations-plan/aztec-5.0.0-stable/reference/`) + the full-chain KAT (`packages/aztec-runtime/src/account/derivation-vectors.test.ts`) are the tripwire — regenerating them from the implementation under test is FORBIDDEN.
- `registerAccount(AccountPrivacyKeys, partialAddress)` — `packages/aztec-runtime/src/pxe/spec.ts` + `service.ts` — 5.0.0 replaced secret-key registration with the 4-secret + 2-public-key `AccountPrivacyKeys` shape; `nulo-account.ts` stores ONLY `secretKey` and re-derives at the seam. A reshape breaks registration for every profile.
- `createPXE options.store` (SQLite-OPFS injection) — `packages/aztec-runtime/src/pxe/opfs-store.ts` (`openChainStore`, 30s bounded open) + `chain-runtime.ts` (fail-closed `PXE_STORE_KEY_MISSING`) — upstream's default store IGNORES `dataDirectory` in the browser, shares one DB, and wipes it on rollup switch, so per-(profile, chain) store injection is MANDATORY. Also coupled: the `sqlite3mc-wasm-emit` vite plugin (`apps/extension/vite.config.ts`) that emits `assets/sqlite3.wasm` + the opfs async proxy UNHASHED (emscripten locateFile requests bare paths; a 404 = silent worker hang), and `PXE_DATA_SCHEMA_VERSION_PIN` (drift-tested mirror of upstream's store version stamp). **`@aztec/sqlite3mc-wasm` is ALSO an explicit direct dependency of `apps/extension` (pinned to the same version `@aztec/kv-store` consumes)** — an Aztec bump that moves `kv-store` MUST move this pin in lockstep; the guard is `apps/extension/scripts/layout-identity.test.ts` (lockstep realpath assertion), which reds on any skew.
- Canonical PrivateFPC descriptor — `packages/bridge-core/src/private-fuel.ts` (`PRIVATE_FPC_ADDRESS`, `PRIVATE_FPC_SALT = 0x…01` from 5.0.0 on) + `private-fpc-canonical.json` (artifactSha256) + `scripts/check-fpc-version.ts` (exact-version + digest + live-class gate). On bump, the rebuilt-address tripwires fire on ANY artifact/salt drift — every rebuild site must use `PRIVATE_FPC_SALT` (a salt-0 stray in `fuel-testnet.ts` was live-caught by its own tripwire this arc).
- Fee-juice claim phase semantics — `FeeJuice.claim_and_end_setup` is ONLY valid as the fee payload (setup phase, where `FeeJuicePaymentMethodWithClaim` places it); an app-phase claim under a sponsored fee MUST use plain `claim` (`apps/tools/src/composables/fuelClaim.ts`, `useDeposit.ts`). Live-caught by the direct-FJ canary on 5.0.0.
- Deploy-intent tooling — `packages/bridge-core/scripts/live-intent.ts` (plan-pinned signer, caps, candidate digest, privileged readbacks, tree gate) + `candidate-schema.ts` (strict zod manifest) + the testnet canaries (`fee-juice-canary-testnet.ts`, `drip-canary-testnet.ts`). A NETWORK RESET re-runs the whole arc under these; see the `aztec-update` skill.

**5.0.1-arc couplings (standards swap, descriptor matching, compat map, incarnation fence):**

- Token-fn descriptor matching vs the standards artifact — `apps/extension/src/wallet/services/token/functions/descriptors.ts` (`matchesStructPath`: crate-prefix-tolerant struct-path compare) — noir namespaces ABI struct paths by the artifact's import chain (`authorization_contract::aztec::…::AztecAddress` in `@aztec-foundation/aztec-standards@5.0.1`), and 5.x `loadContractArtifact` splits public fns into `artifact.nonDispatchPublicFunctions`. On ANY standards bump run `descriptors-real-artifact.test.ts` — it pins all nine kinds against the REAL installed artifact and is the first thing that must go red on an ABI reshape. Probe through the package's own `Token.js` export, never the raw target JSON (the loaded shape differs).
- Token `constructor_with_minter` arity — 5.0.1 added a 5th `auth_contract` param. Coupled sites: `apps/extension/tests/e2e/fixtures/aztec.ts` (deployTestToken), `apps/tools/scripts/deploy.ts` (+ record `constructorArgs.authContract`), `apps/tools/src/contracts/deployments.ts` (`rebuildTokenInstanceFrom` REQUIRES `authContract`; pre-5.0.1 records fail targeted). An upstream arity change breaks derivation everywhere at once — the tools app `verify-deployments` gate is the detector.
- FPC node-compat map — `packages/bridge-core/src/private-fpc-canonical.json` `compatibleNodeVersions` (digest-keyed, HUMAN-curated) + `network` identity pins; consumed by `scripts/check-fpc-version.ts` (`--mode predeploy|require-deployed`). A new artifact digest REQUIRES a fresh compat entry (fails closed); the live v5 testnet returns `"result": null` for an absent `node_getContract` (the `!("result" in body)` branch in `rpcOptional` is dead; correctness rests on `body.result ?? undefined`).
- `pxeGeneration` incarnation fence — `apps/extension/src/wallet/services/profile/spec.ts` (`Profile.pxeGeneration`, minted at EVERY row creation) ↔ `packages/aztec-runtime/src/pxe/{service,client,chain-runtime}.ts` (lifecycle map, `StoreKeyProvision`, `NetworkInfo.pxeGeneration`). Wire-coupled across SW↔offscreen (same build, no skew), but any new Profile-row construction site MUST mint a generation — grep `: Profile = {` on change.

## 5.2.0-arc couplings (added by the 5.0.1 → 5.2.0 split-line bump)

- **A dual `@aztec` generation in one bundle is UNSHIPPABLE.** Upstream's `getVKIndex`
  (`noir-protocol-circuits-types/artifacts/vks/tree.ts`) discriminates with `instanceof`; two
  copies of that module make it silently treat the VK object as its own hash and abort with
  `VK index for [object Object] not found in VK tree` — before any proof is attempted. This is
  why `@alejoamiras/aztec-accelerator` must move WITH the line (it exact-pins its own
  `@aztec` deps) rather than being held. `scripts/aztec-hold-residue-check.ts` is the standing
  gate: it walks bun.lock's dependency graph and `realpath`-resolves from every consumer to
  prove the prover path (stdlib + bb-prover + noir-protocol-circuits-types) is single-generation.
- **E2E fixtures must build accounts from the FROZEN artifact.** Upstream recompiles
  `@aztec/accounts` on toolchain changes (5.2.0 moved SchnorrAccount's class id), so
  `EmbeddedWallet.createSchnorrAccount` derives a different address than the wallet does.
  `apps/extension/tests/e2e/fixtures/aztec.ts` supplies a `FrozenArtifactWallet` whose
  `AccountContractsProvider` serves the vendored artifact for schnorr. Production is immune
  (no `createSchnorrAccount` call sites outside tests) — typecheck cannot see this, since
  `tests/e2e` is outside the tsconfig graph.
- **`BB_BINARY_PATH` is a footgun, not an optimization.** The accelerator's `find_bb` returns a
  seed unconditionally (alejoamiras/aztec-accelerator#352), so a version-mismatched seed proves
  every request with the wrong bb while the log shows a download of the right one. CI runs the
  server unseeded.
- **Clear `<app>/node_modules/.vite` after any dependency-line swap** before the first e2e run —
  stale optimizer caches make dev-served apps fail to load with `.vite/deps/*.js does not exist`.
- `PXE_DATA_SCHEMA_VERSION` stayed 13 across 5.0.1→5.2.0 (no store wipe); `@aztec/viem` is an
  exact upstream alias at both versions; only `HandshakeRegistry` moved among canonical
  addresses; the `@aztec/noir-contracts.js` Token/NFT/FPC/SponsoredFPC class ids DID shift, so
  the SponsoredFPC address is generation-dependent (both generations are deployed and funded on
  testnet — verify with a read-only balance probe before assuming).

## After you bump — validation gate
- `bun run typecheck:all` (exit 0 — verify by exit code + grep, not `| tail`).
- `bun run test:all` (units across ALL workspaces — plain `bun run test` is extension-only and does NOT carry the account KAT + freeze suites) + `bun run build`.
- `bun run test:e2e` (smoke) + `bun run e2e:agent` (FULL network — includes the frozen-account canary). NOTE: `e2e:agent` LOCALLY does NOT enforce native proving (silent WASM fallback if no accelerator). "A WASM fallback is a hard fail" is true only in CI (`VITE_NULO_ACCELERATOR_REQUIRED=1` in the prover-ON `network-e2e-canary` job) — that CI check is the authoritative gate. To run the canary prover-ON locally, start `accelerator-server`, build with `VITE_NULO_ACCELERATOR_REQUIRED=1`, and confirm a `/prove` request (see the `aztec-update` skill).
- Confirm the class-id/address fixture still matches (coupling #3).
