# Updating the Aztec line and Noir

The checklist for bumping the Aztec / Noir dependency line. **`@aztec-labs/*` and `@aztec-foundation/*` are exact-pinned and bumped manually** (outside the 7-day min-age policy — see [`SECURITY.md`](./SECURITY.md) and [`CLAUDE.md`](./CLAUDE.md) § Dependency policy). A bump touches WASM resolution, native proving, on-chain identity invariants, and a runtime schema patch — none of which the type-checker or unit tests fully cover, so this doc is the human re-check list.

> **Convention:** any code that types against an Aztec package's shape (a PXE method signature, a wire type, an artifact field) MUST add an entry to **§ Types coupled to Aztec shapes** below, with `file:line`, so the next bump has a checklist. Round-2 phase R4 (P18b PXE descriptor) is the first to append here.

Current line: **`@aztec-labs/*` and `@aztec-foundation/*` = 6.0.0-rc.1**, with `@aztec-foundation/aztec-standards`, `@alejoamiras/private-fee-juice` and `@alejoamiras/presto` on the same line (Noir wasm packages `noir-acvm_js` / `noir-noirc_abi` carry Bun patches — see below). The 5.2.0 → 6.0.0-rc.1 bump, a scope move with a network reset and a new address regime, is `implementations-plan/nulo-v6/`.

## Before you bump
1. Read the upstream `@aztec-labs/aztec.js` + `@aztec-labs/pxe` changelog for the target version — note any renamed/removed exports, PXE method signature changes, or artifact-format changes.
2. Bump the exact pins in EVERY workspace `package.json` (root + `packages/*` + `apps/*`) — they must all match. The Aztec packages do not go through `bun update --latest` cleanly (Bun #25305); prefer editing the pins + `bun install` (targeted re-resolution). Bun #25305 is CLOSED on Bun 1.4 — deleting `bun.lock` is no longer the ritual and is now a last resort, since a full regen also re-gates every already-locked version against the min-age policy.
3. Also bump the `packageManager` Bun version drift check if the upgrade requires it.

## Coupling points to re-verify (the re-check list)
1. **Bun patches on Noir wasm** — `patches/@aztec-foundation%2Fnoir-acvm_js@<ver>.patch` + `patches/@aztec-foundation%2Fnoir-noirc_abi@<ver>.patch`. The patch filenames pin the version; on bump they must be re-generated/re-verified against the new package or they silently stop applying. Confirm `bun install` still applies them.
2. **Noir WASM resolution (darwin arm64 + browser)** — `apps/extension/vite.shared.ts:69` aliases `@aztec-foundation/noir-acvm_js` to the package's `nodejs/` entry (fixes `__wbindgen_malloc undefined`); `apps/extension/vite.config.ts:83` `dedupe` + `:299` `optimizeDeps.exclude` list the noir/bb wasm packages. If the package's internal entry layout changes, these paths break — re-check the `nodejs/` path exists.
3. **On-chain identity invariants** — `packages/aztec-runtime/src/pxe/artifact-class-id.ts` (class-id derivation) + the deferred class-id + address invariant fixture. A protocol-version bump can change contract class ids / addresses for NON-account contracts; re-derive and update THOSE fixtures, and confirm the token artifacts still resolve. **EXCEPTION — the Nulo ACCOUNT artifact + derived account addresses are FROZEN and are NEVER re-derived here** (see coupling #7): the account KAT (`derivation-vectors.test.ts`) + the freeze tests must stay green with ZERO vector/pin edits. A red account KAT means new-major territory, not a re-pin.
4. **`WalletSchema` runtime patch** — `packages/wallet-sdk-schema-patch/src/{apply,register}.ts` extends `@aztec-labs/wallet-sdk`'s `WalletSchema` with `registerToken` / `isTokenRegistered` / `grantPublicAuthwit`. If upstream changes `WalletSchema`'s shape or those method names, `apply.test.ts` + the wallet-bridge reachability pin (`packages/wallet-bridge/src/dispatcher.test.ts`) will catch it — but re-check the patch still composes.
5. **PXE seam** — `packages/aztec-runtime` PXE factory + client. PXE method signatures are an Aztec coupling surface; see § Types coupled to Aztec shapes.
6. **Native proving (Presto)** — the network-e2e installs the headless `presto-server` (tarball + binary SHA-256-pinned in `.github/workflows/_extension-network-e2e.yml`); `@alejoamiras/presto` exact-pins its own Aztec line, so it moves WITH the bump, and a headless-server bump may follow. `VITE_NULO_PRESTO_REQUIRED=1` makes a silent WASM fallback a hard fail.
7. **Frozen account surface — NOT bumped with the line** — `packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json` (vendored, digest-pinned), `frozen-artifact.ts` (sha256 + class-id pins), `instantiation-descriptor.ts` (frozen ctor name/args/salt/immutablesHash/deployer + digest), `address-freeze.ts` (append-only regime record + paired hardcoded test). A bump must leave the KAT (`derivation-vectors.test.ts`) and every freeze test green with ZERO vector or pin edits; the two **execution canaries** (`apps/extension/tests/e2e/network/frozen-account-canary.test.ts` and `passkey-execution-canary.test.ts`, run prover-ON via `bun run e2e:agent` on Chrome and on Firefox) are a MANDATORY bump gate — a red canary on either browser blocks the bump (see the `aztec-update` skill + CLAUDE.md "Account-address freeze").

## Types coupled to Aztec shapes
> Append here whenever you type against an Aztec package's type. Format: `- <type/signature> — <file:line> — <what breaks if the upstream shape changes>`.

**PXE seam (`packages/aztec-runtime/src/pxe/`) — the R4/P18b descriptor surface.** The method NAME/flag table is `descriptors.ts`; the SIGNATURES live in `spec.ts` + `ipxe.ts`; the response validation in `client.ts` + `schemas.ts`. On a bump, re-typecheck catches renames, but SEMANTIC changes (a field added to a result type, an opts default flipped) need eyeballing here:

- `Methods` (all 22 PXE signatures, incl. `provisionChainStoreKey`) — `packages/aztec-runtime/src/pxe/spec.ts:24-89` — params/returns type against `@aztec-labs/stdlib` (`ContractArtifact`, `EventSelector`, `FunctionCall`, `AztecAddress`, `CompleteAddress`, `ContractInstanceWithAddress`, `PartialAddress`, `NoteDao`, `BlockHeader`, `TxExecutionRequest`, `TxProvingResult`, `TxSimulationResult`, `TxProfileResult`, `UtilityExecutionResult`), `@aztec-labs/pxe/client/bundle` (`NotesFilter`, `PackedPrivateEvent`, `SimulateTxOpts`, `ExecuteUtilityOpts`, `ProfileTxOpts`), `@aztec-labs/aztec.js/wallet` (`PrivateEventFilter`), `@aztec-labs/foundation` (`Fr`). A renamed/reshaped upstream type breaks the whole seam's typecheck; a widened opts type can silently change wire behavior — diff the upstream type.
- `IPXE` (17-method in-process facade) — `packages/aztec-runtime/src/pxe/ipxe.ts:27` — same imports, promisified minus the `network` param; `descriptors.ts`'s `_IPXEMatchesTable` pins its key-set.
- Response zod pins in `PxeServiceClientBase` — `packages/aztec-runtime/src/pxe/client.ts:76-195` — `ContractInstanceWithAddressSchema`, `ContractArtifactSchema`, `CompleteAddress.schema`, `AztecAddress.schema`, `TxProvingResult.schema`, `TxProfileResult.schema`, `TxSimulationResult.schema`, `UtilityExecutionResult.schema`, `BlockHeader.schema`. An upstream schema shape change makes `parseAsync` REJECT valid responses at runtime (typecheck won't catch it) — the network e2e is the detector.
- `NoteDaoSchema` / `PackedPrivateEventSchema` / `NotesFilterSchema` — `packages/aztec-runtime/src/pxe/schemas.ts:11-42` — hand-built from `Note.schema`, `AztecAddress.schema`, `Fr.schema`, `TxHash.schema`, `BlockNumberSchema`, `inTxSchema()`, `EventSelector.schema`, `NoteStatus`; `NotesFilterSchema`/`PackedPrivateEventSchema` carry `satisfies ZodFor<...>` pins that break the build if the upstream type reshapes. `NoteDaoSchema` has NO satisfies pin (upstream `NoteDao` is a class) — re-verify its field list against upstream `NoteDao` manually.
- `PROVE_TX_TIMEOUT_MS` (30 min bb-proving ceiling) — `packages/aztec-runtime/src/pxe/client.ts:60-70` — not a type, but proving-duration coupled; re-validate if the proving backend changes.

**5.0.0-arc couplings (signing-key-root, OPFS store, canonical FPC):**

- `deriveNuloAccountKeys` / `deriveSigningKeyFromSeed` (NULO-ACCOUNT-KDF v1) — `packages/wallet-crypto/src/account-derivation.ts` — the FROZEN seed→signingKey→secretKey chain (`sha512ToGrumpkinScalar([seed, DomainSeparator.IVSK_M])` → `deriveSecretKeyFromSigningKey`). Types against `@aztec-labs/stdlib` key derivation; ANY upstream change to those functions shifts every account address. The two-regime reference vectors (`reference/aztec-5.0.0-stable/`) + the full-chain KAT (`packages/aztec-runtime/src/account/derivation-vectors.test.ts`) are the tripwire — regenerating them from the implementation under test is FORBIDDEN.
- `registerAccount(AccountPrivacyKeys, partialAddress)` — `packages/aztec-runtime/src/pxe/spec.ts` + `service.ts` — 5.0.0 replaced secret-key registration with the 4-secret + 2-public-key `AccountPrivacyKeys` shape; `nulo-account.ts` stores ONLY `secretKey` and re-derives at the seam. A reshape breaks registration for every profile.
- `createPXE options.store` (SQLite-OPFS injection) — `packages/aztec-runtime/src/pxe/opfs-store.ts` (`openChainStore`, 30s bounded open) + `chain-runtime.ts` (fail-closed `PXE_STORE_KEY_MISSING`) — upstream's default store IGNORES `dataDirectory` in the browser, shares one DB, and wipes it on rollup switch, so per-(profile, chain) store injection is MANDATORY. Also coupled: the `sqlite3mc-wasm-emit` vite plugin (`apps/extension/vite.config.ts`) that emits `assets/sqlite3.wasm` + the opfs async proxy UNHASHED (emscripten locateFile requests bare paths; a 404 = silent worker hang), and `PXE_DATA_SCHEMA_VERSION_PIN` (drift-tested mirror of upstream's store version stamp). **`@aztec-labs/sqlite3mc-wasm` is ALSO an explicit direct dependency of `apps/extension` (pinned to the same version `@aztec-labs/kv-store` consumes)** — an Aztec bump that moves `kv-store` MUST move this pin in lockstep; the guard is `apps/extension/scripts/layout-identity.test.ts` (lockstep realpath assertion), which reds on any skew.
- Canonical PrivateFPC derivation — `apps/extension/src/wallet/services/fpc/protocol-fpcs.ts` `PRIVATE_FPC_PARAMS` (salt `0x…01` from 5.0.0 on, deployer zero; the artifact is `@alejoamiras/private-fee-juice`'s, via the `@private-fpc-artifact` alias in `apps/extension/vite.shared.ts`), pinned to the canonical address by `protocol-fpcs.test.ts`. The contract is initializerless and private-only, so nothing is deployed at that address; unleashed's bridge credits Fee Juice to it. Any artifact, salt or upstream-derivation drift reds it on bump: re-pin only after reviewing the new artifact, and release only once unleashed's manifest names the same address — Fee Juice deposited to any other address is unrecoverable.
- Fee-juice claim phase semantics — `FeeJuice.claim_and_end_setup` is ONLY valid as the setup-phase fee payload: the wallet's `fjwc` strategy (`apps/extension/src/wallet/services/execution/fee/fee-juice-with-claim-strategy.ts`) prepends it (`apps/extension/src/wallet/utils/fee-juice.ts` `getFeeJuiceClaimPayload`) and builds with `AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM`. An app-phase claim under a sponsored fee MUST use plain `claim`. Live-caught on 5.0.0.

**5.0.1-arc couplings (standards swap, descriptor matching, incarnation fence):**

- Token-fn descriptor matching vs the standards artifact — `apps/extension/src/wallet/services/token/functions/descriptors.ts` (`matchesStructPath`: crate-prefix-tolerant struct-path compare) — noir namespaces ABI struct paths by the artifact's import chain (`authorization_contract::aztec::…::AztecAddress` in `@aztec-foundation/aztec-standards@5.0.1`), and 5.x `loadContractArtifact` splits public fns into `artifact.nonDispatchPublicFunctions`. On ANY standards bump run `descriptors-real-artifact.test.ts` — it pins all nine kinds against the REAL installed artifact and is the first thing that must go red on an ABI reshape. Probe through the package's own `Token.js` export, never the raw target JSON (the loaded shape differs). The approval card's transfer vocabulary (`apps/extension/src/utils/token-transfer-vocabulary.ts`) is derived from the same descriptors' `defaultNames` × `variants`, and `token-transfer-vocabulary.test.ts` pins the nine names with their arities and parameter names by hand — a renamed default or a re-shaped variant reds it on purpose.
- Token `constructor_with_minter` arity — 5.0.1 added a 5th `auth_contract` param. Coupled sites: `apps/extension/tests/e2e/fixtures/aztec.ts` (`deployTestToken`) and `fixtures/selfpay-phase.ts` (`deployMinterToken`), both passing `AztecAddress.ZERO`. An upstream arity change breaks every test-token deploy at once — the network e2e is the detector.
- Stale-anchor diagnostics matched by substring — `packages/aztec-runtime/src/pxe/stale-anchor.ts` (`isStaleAnchorMessage`) — three upstream strings: `possibly a reorg has occurred` (the shared tail of BOTH node wordings — `Block hash … not found when resolving query` in `@aztec-labs/aztec-node` `node_world_state_queries` and `Reference block … not found when querying contract` in its contract lookups; the node package is NOT installed client-side — grep the pinned toolchain under `$AZTEC_HOME/versions/<pin>/node_modules/@aztec-labs/aztec-node/dest` (`AZTEC_HOME` defaults to `~/.aztec`) on every bump), `not-yet-synchronized PXE` (`@aztec-labs/pxe` `anchor_block_store`), `RewindableRegister write originates behind` (aztec-nr, compiled into the `HandshakeRegistry` artifact). `stale-anchor.sources.test.ts` pins the two installed ones and `stale-anchor.real.test.ts` exercises the node wording against a reorged sandbox; a reworded diagnostic silently disables the resync-and-retry.
- `pxeGeneration` incarnation fence — `apps/extension/src/wallet/services/profile/spec.ts` (`Profile.pxeGeneration`, minted at EVERY row creation) ↔ `packages/aztec-runtime/src/pxe/{service,client,chain-runtime}.ts` (lifecycle map, `StoreKeyProvision`, `NetworkInfo.pxeGeneration`). Wire-coupled across SW↔offscreen (same build, no skew), but any new Profile-row construction site MUST mint a generation — grep `: Profile = {` on change.

**Sponsor funding probe (the fee card's verdict on a sponsor before the proof):**

- The node's admission rule — `apps/extension/src/wallet/services/execution/sponsor-funding.ts:30` — the node refuses a transaction whose fee payer's public Fee Juice, plus any setup-phase claim to that payer, is below `gasSettings.getFeeLimit().toBigInt()`, and accepts at equality (`@aztec-labs/p2p` `gas_validator.js`, `fee_payer_balance.js`; the package is not installed here, read the published tarball). A floor, a teardown term or a changed comparison makes the verdict wrong in one direction; `sponsor-funding.test.ts` pins the equality edge, and `fee-sponsor-funding.test.ts` (network e2e) checks the funded and unfunded sponsor against a real node.
- `GasSettings.getFeeLimit()` — same line — Σ `maxFeesPerGas × gasLimits`, teardown excluded, returning an `Fr`. It is not Nulo's displayed `maxFee`, which adds the teardown limits; a reshaped limit changes the comparison silently.
- `computeFeePayerBalanceStorageSlot(owner)` (`@aztec-labs/protocol-contracts/fee-juice`) — `apps/extension/src/wallet/utils/fee-juice-balance.ts:22` — the slot the node's check and the simulator read. `fee-juice-balance.test.ts` pins it equal to `deriveStorageSlotInMap(new Fr(1), owner)`, so a moved `balances` slot reds there instead of reading a wrong balance.
- `TxSimulationResult.publicInputs.feePayer` — `apps/extension/src/wallet/services/execution/fee/fpc-strategy.ts:97` — the payer the node validates, read from each path's final simulation. A renamed or relocated field drops every verdict without an error (no `sponsor`, the card behaves as it did before the probe); the structural test builds its simulations by hand, so only the network e2e sees it.
- `createSafeJsonRpcClient`'s `log` option over `AztecNodeApiSchema` — `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:96` — the adapter builds the read's client itself because `createAztecNodeClient` cannot pass a logger; without it the SDK's `warn` lines, which carry the reply body and the endpoint URL, reach the user's exportable log. `aztec-node-factory-adapter.test.ts` pins it. If `createAztecNodeClient` gains configuration (a versions check, batching), this client does not inherit it.

## 5.2.0-arc couplings (added by the 5.0.1 → 5.2.0 split-line bump)

- **A dual Aztec generation in one bundle is UNSHIPPABLE.** Upstream's `getVKIndex`
  (`noir-protocol-circuits-types/artifacts/vks/tree.ts`) discriminates with `instanceof`; two
  copies of that module make it silently treat the VK object as its own hash and abort with
  `VK index for [object Object] not found in VK tree` — before any proof is attempted. This is
  why `@alejoamiras/presto` must move WITH the line (it exact-pins its own
  Aztec deps) rather than being held. `scripts/aztec-hold-residue-check.ts` is the standing
  gate: it walks bun.lock's dependency graph and `realpath`-resolves from every consumer to
  prove the prover path (stdlib + bb-prover + noir-protocol-circuits-types) is single-generation.
- **E2E fixtures must build accounts from the FROZEN artifact.** Upstream recompiles
  `@aztec-labs/accounts` on toolchain changes (5.2.0 moved SchnorrAccount's class id), so
  `EmbeddedWallet.createSchnorrAccount` derives a different address than the wallet does.
  `apps/extension/tests/e2e/fixtures/aztec.ts` supplies a `FrozenArtifactWallet` whose
  `AccountContractsProvider` serves the vendored artifact for schnorr. Production is immune
  (no `createSchnorrAccount` call sites outside tests) — typecheck cannot see this, since
  `tests/e2e` is outside the tsconfig graph.
- **`BB_BINARY_PATH` is a footgun, not an optimization.** Presto's `find_bb` honours the
  variable before its versioned cache, so a version-mismatched seed proves every request with the
  wrong bb while the health body still says `bb_available: true`. CI runs the server unseeded.
- **Clear `<app>/node_modules/.vite` after any dependency-line swap** before the first e2e run —
  stale optimizer caches make dev-served apps fail to load with `.vite/deps/*.js does not exist`.
- `PXE_DATA_SCHEMA_VERSION` stayed 13 across 5.0.1→5.2.0 (no store wipe); `@aztec/viem` is an
  exact upstream alias at both versions; only `HandshakeRegistry` moved among canonical
  addresses; the `@aztec-labs/noir-contracts.js` Token/NFT/FPC/SponsoredFPC class ids DID shift, so
  the SponsoredFPC address is generation-dependent (both generations are deployed and funded on
  testnet — verify with a read-only balance probe before assuming).

## 6.0.0-rc.1-arc couplings (the scope move)

- **Two scopes, two upstreams.** `@aztec-labs/*` is built from `aztec-labs-eng/aztec-node`;
  `@aztec-foundation/bb.js`, the noir wasm pair and `l1-artifacts` still come from
  `AztecProtocol/aztec-packages`. `@aztec/viem` stays in the old scope. Both upstreams are the
  compare targets on a bump and the licence sources in `packages/third-party-notices/src/policy.ts`.
- **Sites keyed by package name, invisible to tsc**: the four version readers
  (`setup-aztec`, `docker-ci-like.sh`, `global-setup.ts` read the `@aztec-labs/aztec.js` pin;
  `vite.shared.ts` bakes `@aztec-labs/pxe` into `__AZTEC_VERSION__` and throws on a missing key),
  the chunking scopes in `scripts/vendor-chunks.ts`, the publish staging externals and the scope
  prefixes listed in the `aztec-update` skill. A rename that misses one fails open, not loud.
- **One return type per function.** `FunctionAbi.returnTypes` became `returnType?`, and
  `getFunctionReturnType` throws on more than one; the dApp wire shape `EncodedCallPayload`
  (`packages/wallet-bridge/src/call-shapes.ts`) follows, and `call-decoder.ts` decodes with
  `decodeEachFromAbi`. A function with no return now simulates to `undefined`, not `[]`.
- **`simulate()` answers `{ result, … }`.** A contract interaction's `simulate()` returns a
  `SimulationResult`; the e2e fixtures unwrap it (`unwrapSimulated` in
  `apps/extension/tests/e2e/fixtures/aztec.ts`), and a bare comparison against a bigint is always
  false.
- **The PXE data schema moved 13 → 16** (`PXE_DATA_SCHEMA_VERSION_PIN`,
  `packages/aztec-runtime/src/pxe/opfs-store.ts`); the stamp code is byte-identical.
- **bb.js's WASM must not inline.** `apps/extension/scripts/bb-fetch-code-shim.ts` matches bb.js's
  resolved browser fetcher and fails the build if it stays in the graph: inlined, the WASM chunks
  exceed the Firefox parse-limit guard. Every bb instance loads the `.wasm.gz` assets
  `bb-wasm-emit` writes.
- **Preloaded protocol contracts.** `createPXE`'s default provider registers MultiCall,
  AuthRegistry (moved address) and HandshakeRegistry; `pxe-provided.ts` follows it.

## Bridge couplings — moved to `alejoamiras/unleashed`

The any-ERC-20 bridge's Aztec couplings moved with the bridge to [`alejoamiras/unleashed`](https://github.com/alejoamiras/unleashed): hub ↔ factory, `tokenClassId` ↔ the standards `Token` artifact, hub → `ContractInstanceRegistry`, the split JS/Noir toolchain, token-list origin ↔ CSP, the `txe-server` lockfile and per-token wallet grants, plus the PrivateFPC deploy descriptor, its node-compat map and the deploy-intent tooling. Until unleashed is populated, read them in [`UPDATE.md` at the freeze commit](https://github.com/alejoamiras/nulo/blob/6611f8611100931fe266f6fd1dfff27e331e2897/UPDATE.md).

The wallet's testnet seeds (`TESTNET_TOKENS` in `default-tokens.ts`, which `price-map.ts` prices from) mirror unleashed's `tokens[].l2Token` for its current testnet generation, one per token, and the `aztec-update` skill's reset step re-points every one; changing a seed is an owner UI decision (CLAUDE.md § UI changes need explicit owner sign-off).

## After you bump — validation gate
- `bun run typecheck:all` (exit 0 — verify by exit code + grep, not `| tail`).
- `bun run test:all` (units across ALL workspaces — plain `bun run test` is extension-only and does NOT carry the account KAT + freeze suites) + `bun run build`.
- `bun run test:e2e` (smoke) + `bun run e2e:agent` (FULL network — includes both execution canaries). NOTE: `e2e:agent` LOCALLY does NOT enforce native proving (silent WASM fallback if no Presto is listening; the awaiting card then says "Proving in browser…"). "A WASM fallback is a hard fail" is true only in CI (`VITE_NULO_PRESTO_REQUIRED=1` in the prover-ON `canary` job of both browser lanes, which also asserts "Proving with Presto ✦" and reads the json report back so a skipped canary cannot pass) — that CI check is the authoritative gate. To run the canaries prover-ON locally, start `presto-server` with `PRESTO_ALLOW_ALL=1`, build with `VITE_NULO_PRESTO_REQUIRED=1`, and confirm a `Proving succeeded` log line (see the `aztec-update` skill).
- Confirm the class-id/address fixture still matches (coupling #3).
