# nulo-v6 — codebase recon

Read-only recon of `origin/dev` at `910a4def` (2026-09-30), by three Sonnet explorers (dependency-line pin surface; protocol churn, regime and chain cascade; naming, stores, docs and harness) plus live probes run by the planner. Paths are repo-relative. Verdicts: **reuse** (no change), **adapt** (edit in place), **new** (create). Hits under `implementations-plan/` and `audit/` are historical records and are never edited.

## Live facts (probed 2026-09-30)

| Fact | Value | How |
|---|---|---|
| V6 testnet node | `nodeVersion 6.0.0-rc.1`, `l1ChainId 11155111`, `rollupVersion 2914217885`, `realProofs true` | `node_getNodeInfo` on the owner's dRPC endpoint |
| V6 wallet chainId | `2904119610` = `(11155111 ^ 2914217885) >>> 0` | the `walletChainId` formula |
| V6 dRPC key | answers from `chrome-extension://…`, `moz-extension://…`, a web origin and no origin: not origin-restricted | `curl -H Origin:` × 4 |
| V5 testnet | still up, `nodeVersion 5.0.0`, `rollupVersion 1821665230` | `node_getNodeInfo` |
| `@aztec-labs/*`, `@aztec-foundation/*` `6.0.0-rc.1` | published 2026-09-23 17:21–20:10Z, so past the 7-day gate from 2026-09-30 ~20:10Z | npm registry `time` |
| `@alejoamiras/presto@6.0.0-rc.1`, `presto-core@1.2.1` | published 2026-09-29 03:17Z and 03:09Z (gates until 2026-10-06 03:17Z and 03:09Z); dist-tag `testnet` | npm |
| `@aztec-foundation/aztec-standards@6.0.0-rc.1` | published 2026-09-29 21:23Z (gate until 2026-10-06 21:23Z); dist-tag `rc`; no deps, no peers | npm |
| `@alejoamiras/private-fee-juice@6.0.0-rc.1` | published 2026-09-30 23:13Z, dist-tag `rc`, by GitHub Actions trusted publishing (gate until 2026-10-07 23:13Z); SLSA provenance from `ecosystem-tooling` `release.yml` on `main` at `76199c59`; peers `@aztec-labs/{aztec.js,protocol-contracts,stdlib}@6.0.0-rc.1`, no dependencies (re-probed 2026-10-01 00:01Z) | npm packument, attestations endpoint |
| `@aztec/viem` | `@aztec-labs/ethereum@6.0.0-rc.1` depends on `npm:@aztec/viem@2.38.3` (repo pins 2.38.2) | npm |
| Package map | every `@aztec/*` the repo uses exists at 6.0.0-rc.1 as `@aztec-labs/*`, except `bb.js`, `noir-acvm_js`, `noir-noirc_abi`, `l1-artifacts` → `@aztec-foundation/*` | npm |
| V6 API | `TxExecutionRequest(…, salt = Fr.random())`; `FunctionCall.returnType`; `decodeEachFromAbi` and `getFunctionReturnType` in `stdlib/abi`; `WalletSchema` still at `aztec.js/wallet` (16 keys); `aztec.js/protocol` exports `FeeJuiceContract`, `ProtocolContractAddress`; `protocol-contracts` and `standard-contracts` export `./*`, so `…/fee-juice`, `…/class-registry` etc. survive; `DomainSeparator.EVENT_LOG_TAG` survives | scratch install of the rc.1 packages |
| `noir-contracts.js@6.0.0-rc.1` | ships `SponsoredFPC`, `SchnorrAccount`, `MultiCallEntrypoint`, `HandshakeRegistry`; not `FeeJuice` | jsDelivr file list |
| V6 canonical SponsoredFPC | `0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b` (salt 0, class `0x2f85ee9e617266fd46d41e4f57a6209c52ab07114cf0fe154f13fc903da8f433`) is **deployed** on the V6 testnet; Presto's migration funded it with 1,000 FJ from a since-deleted key | `node.getContract` / `getContractClass` |
| V6 `SchnorrAccount` (noir-contracts.js) | class `0x010cc0891c8748de2009734bf117485efbaf3aad0be125f151b4e6744f8f1842`; `outputs.globals` carries named entries | scratch install |
| Presto native | app 1.1.3 proves V6 from a cold cache (Presto's closed `aztec-v6` plan); CI pins presto-server 1.1.2 | Presto repo, `_extension-network-e2e.yml` |
| Toolchain installer | `install.aztec.network/6.0.0-rc.1/install` → 200 via `install.aztec-labs.com` | `curl -L` |
| Local toolchain | `~/.aztec/versions/6.0.0-rc.1` is partial (no `bin/`, no forge/anvil); a complete isolated one lives under `~/.cache/aztec-toolchains/6.0.0-rc.1` (ecosystem-tooling built it, copying foundry 1.4.1 from 5.2.0 because foundryup refuses to run beside live anvils) | `ls` |
| Chrome item | `jlmiaokmjoicmclelpiiocdhncddkdmc` not public (`/detail/empty-title/…`): 0.28.0 pending review, submitted by hand; the listing name is the manifest `name`, not editable in the dashboard; "Cancel review" exists | public page + Chrome docs |
| AMO add-on | `wallet@nulo.sh`, name "Nulo V5", slug `nulo-v5`, `0.28.0.0` public, 1 daily user; name and slug are Developer Hub edits; slugs `nulo-v6`, `nulo`, `nulo-wallet` unused | AMO API |
| V6 `SchnorrAccount` artifact | `@aztec-labs/accounts@6.0.0-rc.1/artifacts/SchnorrAccount.json`: sha256 `4b4933a146a80872b184f47af22cd8ba3faa00f810d7a26217490c9d13507f94`, class `0x010cc089…1842`, `aztec_version 6.0.0-rc.1`; byte-identical to `noir-contracts.js`'s `schnorr_account_contract-SchnorrAccount.json` | scratch install, sha256 of both files |
| Gate timing, re-probed 2026-09-30 21:57Z | every `@aztec-labs/*` / `@aztec-foundation/*` rc.1 and `@aztec/viem@2.38.3` (published 09-18) are now past the gate; still gated: `presto@6.0.0-rc.1` + `presto-core@1.2.1` (until 10-06 03:17Z), `aztec-standards@6.0.0-rc.1` (until 10-06 21:23Z) | npm `time` |
| `private-fee-juice` (superseded by the row above) | rc.1 still unpublished at 21:57Z; `0.0.0-canary.g76199c5` (published 21:16Z, npm attestation present) exact-peers `@aztec-labs/{stdlib,aztec.js,protocol-contracts}@6.0.0-rc.1`, so the V6 build is in flight | npm |
| Presto rc.1 dependency set | `presto@6.0.0-rc.1` (MIT) exact-depends on `@aztec-labs/{stdlib,bb-prover,foundation}` and `@aztec-foundation/{noir-acvm_js,noirc_abi}` at rc.1, `presto-core@1.2.1` (MIT; deps `ms`, `@logtape/logtape ^2.3.2`); `presto-banners` is independent (repo pins 1.1.0; 1.2.0 published 09-25) | npm |
| `@logtape/logtape` | lock holds 2.3.3; the newest 2.3.x (2.3.10, 09-29) is gated, so resolution keeps an aged 2.3.x | npm |
| presto-server 1.1.3 | release `presto-v1.1.3` ships `presto-server-1.1.3-linux-x86_64.tar.gz` + `.sha256` | `gh release view` |
| `@alejoamiras/nulo-*` | `0.1.0` is on npm (`latest`) for all three, so a later version passes `check-digests.ts` as unlisted | npm |
| Upstream tag | `AztecProtocol/aztec-packages` tag `v6.0.0-rc.1` exists (`d521f0d9`) for the notices re-review | `gh api` |
| Provenance (added after the plan audits) | `@aztec-foundation/*@6.0.0-rc.1`: SLSA from `aztec-packages` `ci3.yml` at `refs/tags/v6.0.0-rc.1` (`d521f0d9`). `@aztec-labs/*@6.0.0-rc.1` and `@aztec/viem@2.38.3`: no attestation (404), no repository field; `@aztec-labs` published by `charlielye` (maintainers `nchamo`, `charlielye`), as `@aztec/pxe@5.2.0` was. Standards: `aztec-standards` `release.yml` at its tag (`cdfba943`); presto: `alejoamiras/presto` `release-sdk.yml` on main (`bc3eeee0`); private-fee-juice: `alejoamiras/ecosystem-tooling` `release.yml` on main (5.0.1 `c678a948`; rc.1 and the canary both `76199c59`) | npm attestations endpoint, packuments |
| `@aztec-labs` source | `aztec-labs-eng/aztec-node` at `v6.0.0-rc.1`: public, Apache-2.0 `LICENSE` (11,352 bytes, the same size as `barretenberg/LICENSE`), no NOTICE; `aztec-packages` has no `yarn-project/` and no NOTICE at its tag | `gh api` |
| Licences | unchanged in kind: `@aztec-labs/*` and `l1-artifacts` ship no licence field and no file (as `@aztec/*@5.2.0` did); `bb.js` MIT, `noir-acvm_js` MIT, `noir-noirc_abi` `MIT OR Apache-2.0`, all without a file; Standards MIT with a file | packuments and tarball listings |
| rc.2 | `@aztec-foundation/bb.js` and `l1-artifacts` `6.0.0-rc.2` published 2026-09-29 22:11–22:14Z (`prerelease`); no `@aztec-labs` rc.2; node still rc.1 at 23:10Z and again at 2026-10-01 00:01Z; both scopes' `latest` is a nightly | npm, `node_getNodeInfo` |
| Installer | `install.aztec.network/6.0.0-rc.1/install` answers 301 to `install.aztec-labs.com` | `curl -sI` |

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Bump runbook, pin surface, drift detectors | `.claude/skills/aztec-update/SKILL.md` (Branch B = this reset), `UPDATE.md`, `scripts/aztec-hold-residue-check.ts`, `scripts/lockfile-exception-diff.ts` | reuse + adapt (the skill is the source of truth; update it in place) |
| Scope rename of imports | none in repo; the unleashed and ecosystem-tooling plans used one-shot regex codemods | new, one-shot, not committed (searched `codemod`, `aztec-labs` across `scripts/`, `apps/*/scripts/`) |
| Version pin readers | `.github/actions/setup-aztec/action.yml:18`, `apps/extension/tests/e2e/global-setup.ts:45-59`, `apps/extension/scripts/e2e/docker-ci-like.sh:88` (`@aztec/aztec.js`), `apps/extension/vite.shared.ts:30` (`@aztec/pxe` → `__AZTEC_VERSION__`) | adapt (four key strings) |
| Account regime record | `packages/aztec-runtime/src/account/address-freeze.ts` (`REGIMES`, `V5_REGIME`, rules text with the pre-launch carve-out), `frozen-artifact.ts`, `instantiation-descriptor.ts`, `artifacts/SchnorrAccount.json` + `PROVENANCE.md` | adapt + new (V6 entry, V6 artifact) |
| Derivation vectors | generator only under `implementations-plan/key-model-v2/reference/` (5.0.1 deps); the plans-scaffolding branch relocates such assets to top-level `reference/<plan>/` | new: copy into `reference/nulo-v6/`, never import in place |
| Backup/export refusal of V5 | `backup-migration-registry.ts:74` `CURRENT_COMPAT_EPOCH = 4`; `account-export.ts:26-44` `EXPORT_REGIME_DIGESTS` | adapt (epoch 4→5; export digests follow the regime rebind) |
| Chain identity | `apps/extension/src/utils/chain-ids.ts`, `network/service.ts` `DEFAULT_SEEDS`, `components/ui/utils.ts`, `constants/explorers.ts`, `token/default-tokens.ts`, `price/price-map.ts` | adapt |
| Seed preflights | `apps/extension/scripts/seed-preflight.ts`, `seed-preflight-metadata.ts` | adapt (V6 URL/ids; drop Alpha) |
| PrivateFPC drift detector | `wallet/services/fpc/protocol-fpcs.ts` + `.test.ts` (address, salt, deployer, reviewed digest) | adapt (conscious re-pin) |
| SponsoredFPC default | `fpc/service.ts` derives it per chain; `fee-helpers.ts` `defaultSponsor`; no deployment check | reuse (V6 sponsor exists on testnet) |
| Presto version plumbing | `src/presto/client.ts:16`, `utils/presto-ui-state.ts:200`, `tests/e2e/fixtures/presto.ts:13-16`, CI presto-server pins, `SECURITY.md:412-448` pin-bump procedure | adapt |
| wallet-sdk schema patch | `packages/wallet-sdk-schema-patch` (4 methods), `wallet-bridge` dispatcher + descriptor parity tests | reuse logic, adapt pins and parity |
| Published npm packages | `scripts/publish/*`, `approved-digests.json`, `.github/workflows/publish-packages.yml` | reuse + adapt (new lockstep version, digests) |
| Store listing and art | `apps/extension/store/listing.md`, `templates/`, `scripts/store-art.ts`, `tests/e2e/store-captures.test.ts`, `scripts/store-listing.test.ts` | reuse tooling, adapt content |
| Store publish | `release.yml` `publish_chrome`/`publish_firefox`, `scripts/release/publish-{chrome-store,firefox-amo}*.ts`, `store-check.yml` | reuse (no name/slug in code; item id from `CWS_ITEM_ID`) |
| Legal documents | `legal/terms.md` (draft, `effective: null`), `packages/legal` manifest + tests | adapt in place (precedent #682, #683) |
| Release | release-please (`bump-minor-pre-major`: next is 0.29.0), auto-unstick, sync PR | reuse |

## 1. API churn in our code

- **`returnTypes` → `returnType`** (largest mechanical edit): `wallet/utils/fn.ts:37-38,64`; `utils/auth-registry.ts:43`; FPC handlers (`private-fpc-handler.ts:13`, `default-sponsored-fpc-handler.ts:14`); `token/functions/descriptors.ts` (matching by params + return arrays; its snapshot regenerates); `execution/authwit-discoverer.ts:170-221` (drop the `z.array(AbiTypeSchema)` parse at :221); `fast-path.ts:151`; `view-executor.ts:114-130,385`; `tx-request-builder.ts:547,577,614`; `execution/service.ts:1062`; `operation-planner.ts:157,217`; `helpers/batched-view-simulation.ts` (heaviest); `packages/wallet-bridge/src/call-shapes.ts:26` (`EncodedCallPayload.returnTypes?` is the dApp→SW→popup wire shape); `packages/aztec-runtime/src/account/instantiation-descriptor.ts:85`; playground `sections/authwit.ts`, `phase.ts`. Tests: about a dozen files listed in the raw recon.
- **`decodeFromAbi` single type**: `execution/call-decoder.ts:16,46-48` becomes `decodeEachFromAbi` (delete the arity shim); `aztec-runtime/src/pxe/public-events.ts:368`; the view/batched decoders; playground `phase.ts:162`.
- **Tx salt / protocol nullifier**: `tx-request-builder.ts:432` constructs `TxExecutionRequest` without a salt, so it gets `Fr.random()`. Standard path goes through upstream entrypoints (`nulo-account.ts:185,244`). A built request is reused between estimate and confirm (`transfer-estimate-reuse.ts:101`, `operation-estimate-reuse.ts:73`) and re-run only by `withStaleAnchorRetry`; one request proved once is one nullifier, which is benign. `execution-coordinator.ts:164,305-308` classifies an existing-nullifier error as `DuplicateInitializationError` only when initializing.
- **FeeJuice out of noir-contracts.js**: only `wallet/utils/fee-juice.ts:4` imports it, and its `feeJuiceArtifact` export has no consumers: delete it. `pxe/artifact-catalog.ts:5-7` imports `@aztec/protocol-contracts/{class-registry,fee-juice,instance-registry}`, which survive under `./*`. e2e fixtures (`fixtures/aztec.ts`, `selfpay-phase.ts`, `aztec-private-fpc-bridge.ts`) use `Contract.at(ProtocolContractAddress.FeeJuice, FeeJuiceArtifact, wallet)`.
- **MultiCallEntrypoint / HandshakeRegistry moved**: addresses come from the packages (`nulo-account.ts:30,243`, `artifact-catalog.ts:8,63`, `account-state/pxe-provided.ts:9-28`); `stale-anchor.sources.test.ts:16-24` reads dist-layout paths inside `@aztec/pxe` and the HandshakeRegistry artifact.
- **DOM_SEP**: only `public-events.ts:173` uses `DomainSeparator.EVENT_LOG_TAG` (survives); `wallet-crypto/src/nulo-separators.test.ts` re-runs its non-collision check over the new enum.
- **No impact**: `GasPrice`/`FeesPerGas` (no use), `TxRequest.hash()`, `computeProtocolNullifier`, direct `outputs.globals` access.
- **Artifacts rejected on load**: the vendored `SchnorrAccount.json` carries the old unnamed `outputs.globals` and `aztec_version 5.0.1`; the held PrivateFPC and standards Token JSONs are 5.0.1 builds too.
- **Version literals that red at the bump**: `utils/presto-ui-state.test.ts:171` ("Nulo needs 5.2.0"), `scripts/layout-identity.test.ts:20,36`, `packages/resolve-asset/src/index.test.ts:67-98`, `scripts/publish/stage.test.ts:357-358`, `scripts/vendor-chunks.test.ts:4,20`, `packages/aztec-runtime/src/pxe/opfs-store.ts:42` (`PXE_DATA_SCHEMA_VERSION_PIN = 13`, drift-tested against the installed PXE; mismatch refuses, never wipes), `store/remote-code.md` citations resolved by `store-listing.test.ts:116-136` against installed `@aztec+<pkg>` sources.

## 2. Account-address regime

- `REGIMES["nulo-v5"]` is built from the **live** module constants (`address-freeze.ts:70-86`): swapping the vendored artifact would silently rewrite the V5 entry. Step one is freezing V5 to literals identical to `EXPECTED_REGIMES["nulo-v5"]` in `address-freeze.test.ts`.
- `NULO_KDF_SPEC` (:58-65) is the digest preimage and embeds the text "upstream @aztec/accounts 5.0.1": never edit it; reuse the KDF only if regenerated key-level vectors are unchanged, otherwise append a new KDF id.
- Descriptor v1 (ctor `constructor`, salt 0, immutablesHash 0, deployer zero; symbolic args) is artifact-independent; the KAT is the real arg-order pin.
- Consumers to rebind: `account/service.ts:23,551`, `account-integrity/coordinator.ts:8,161`, `account-export.ts:26,40`, `artifact-freeze.test.ts`. Test fixtures that hardcode `"nulo-v5"` stay only where they model historical rows.
- Rules text (`address-freeze.ts:9-26`): one regime per major, append-only, with a pre-launch carve-out that lets a never-shipped major's entry be redefined in one reviewed commit until its first shipped build. V5 shipped (0.26–0.28 zips, both store submissions). V6's window closes at its first shipped build; a nightly prerelease from `dev` publishes zips daily.
- Vectors: `derivation-vectors.test.ts` and `account-seed-vectors.test.ts` read address-level fields; `wallet-crypto` tests read key-level fields from the same `vectors.json`. Key derivation consumes only the exact L1 chain id, so V5 and V6 testnet (both Sepolia) derive the same keys and different addresses.
- `artifact-freeze.test.ts`, `protocol-fpcs.test.ts`, `default-tokens.test.ts`, `register-contract.test.ts`, `descriptors-real-artifact.test.ts`, `note-schemas.test.ts` recompute class ids or addresses and change.

## 3. Chain cascade and network cutover

- `chain-ids.ts`: TESTNET pair → `2914217885`; MAINNET pair and `CHAIN_IDS.MAINNET` removed. Tracked auto-import typings (`src/types/auto-imports.d.ts`, `.eslintrc-auto-import.json`) list `MAINNET_*` and regenerate only on a Vite build (`lessons.md`: build before committing).
- `network/service.ts`: delete the Alpha V5 seed and `E2E_DEFAULT_ACTIVE_TESTNET`; Testnet unconditionally primary with the V6 URL. `VITE_NULO_E2E_DEFAULT_NET` is also set in `scripts/e2e/agent.sh:72-106`, `_extension-smoke-e2e.yml:98-101`, commented in `pr-extension-smoke-e2e.yml:121`, documented in the e2e-testing skill and `FIREFOX.md:5`. `ChainKind` keeps `"mainnet"` so a user-added network still parses.
- Mainnet-only branches that die: `FeeSettingsCard.vue:127,496-498` (`allowSponsored`, `private_fpc` default), `fee-helpers.ts:188,207` comments, `components/ui/utils.ts` (position/colour/name "Alpha V5"), `explorers.ts:35` (mainnet aztecscan), `default-tokens.ts` two mainnet seeds, `price-map.ts` mainnet rows, `known-contracts.test.ts` mainnet names.
- The V5 testnet USDC seed (`0x00242d87…6502`) and its price row are bound to unleashed's V5 generation: removed now, replaced by unleashed's V6 token once it exists.
- Literal hits: `"Alpha V5"` in 2 source files + ~16 test files + 3 e2e specs; `4248422646` / `1816023401` / `CHAIN_IDS.MAINNET` in ~30 test files (list in raw recon). `seeder.test.ts:164` and `service.composition.test.ts` use the mainnet cUSDC seed as a fixture.
- e2e premises that change: `network/networks.test.ts` (3 defaults → 2), `endpoints.test.ts:199-202` (opens the Alpha row), `network/backup-import-stalled-network.test.ts` (whole premise is a stalled Alpha beside Local), `backup-roundtrip.test.ts:24-32` (artifact-run carve-out exists because CI could not reach Alpha).
- `FEE_JUICE_BRIDGE_URL` (`fee-helpers.ts:299-303`) points at unleashed's testnet app: reuse; unleashed's own plan moves that app to V6.

## 4. Naming, stores, legal, docs

- `apps/extension/package.json:4` `displayName` is the single source for the manifest name, `document.title`, install page and HTML titles; `store-listing.test.ts:59` pins the Chrome title to it (the Firefox name is not pinned).
- `store/listing.md:122,158` (titles), `:192-194` reviewer notes ("opens on mainnet"), `:201-214` patch/alias claims tied to the current patches; `store/templates/tile.html` (`NULO V5` wordmark), `frame.html` (title); 7 PNGs show "NULO V5" or an "ALPHA V5" pill: regenerate with `STORE_CAPTURES=1` store-captures e2e (Chrome, built extension) then `bun scripts/store-art.ts`.
- `legal/terms.md` (draft, `effective: null`, only `«FILL» ` left is the effective date): `:13` "connects to Aztec mainnet by default", `:33-34` store URLs with slug `nulo-v5`, `:90`, `:164-166` "selects Aztec mainnet by default … real value". Precedent edits in place without a bump (#682, #683), but `legal/README.md` says every change bumps: owner confirms. `legal/privacy.md` (effective 1.0) has no V5 wording; § 5.1 stays true only if the default endpoint stays on the Developer's provider account.
- `README.md:8` ("Aztec mainnet is the default network…"), `BEFORE-LAUNCH.md:31-32,72-76`, `legal/README.md:31`, `CI.md:223` (store publishing "never run for real" is already false).
- CLAUDE.md: `:26` (mainnet USDC seed), `:109` (`V5_REGIME`), `:112` (extension-major strategy naming V6): keep the rule, record V6 as a one-time exception. `address-freeze.ts:16-23` repeats the policy.
- `settings/about.vue:64` "Alpha Testing" is a maturity label, not a network (owner call); `:67` shows `__AZTEC_VERSION__`, which will read `6.0.0-rc.1` (also written into backups as `aztec-version`, informational only).
- Landing: no V5, mainnet or store strings; CTAs use the GitHub release URL.
- Release pipeline carries no name or slug; the Chrome preflight refuses while a review is `PENDING_REVIEW` and may not even see a hand-made submission. AMO never frees a version number.

## 5. Harness and CI

- `global-setup.ts:45-75` requires `~/.aztec/versions/<pin>/{node_modules/.bin/aztec, bin/aztec-anvil, internal-bin/forge, internal-bin/anvil}`; spawn flags `:517-534`. It does not honour `AZTEC_HOME`.
- `tests/e2e/fixtures/aztec.ts`: `FrozenArtifactWallet` subclasses `EmbeddedWallet` with a 6-method `accountContracts` provider bound to 5.2.0's shape; FeeJuice via `Contract.at(...)`; `constructor_with_minter` arg shape. `tests/e2e` is outside the tsconfig graph: only running the suite finds breakage.
- `tests/e2e/fixtures/presto.ts:13-16` hardcodes `aztec_version: "5.2.0"`; CI pins presto-server 1.1.2 (`_extension-network-e2e.yml:179-189`).
- `scripts/ci-cd/canary-expectations.json` pins four files' exact titles; `frozen-account-canary.test.ts:4` says "frozen 5.0.1 account bytecode".

## 6. Collisions and planning memory

- **plans-scaffolding** (branch `plans-scaffolding-repoints`, unmerged) touches `CLAUDE.md`, `UPDATE.md`, `legal/README.md`, `address-freeze.ts` near :52, `biome.json`, root `package.json`, and relocates live-read plan assets into `reference/<plan>/`; it also enforces "code cites a live doc or a permalink, never a plan path". Put the V6 vectors in `reference/nulo-v6/` and cite no plan paths from code.
- **PR #669** (vitest 5 bump, stale since 2026-09-23) rewrites `bun.lock` and every workspace `package.json`: it conflicts with this bump's lockfile whichever lands second.
- **unleashed `aztec-v6`** holds at its phase 3 until `@alejoamiras/nulo-{wallet-crypto,resolve-asset,wallet-sdk-schema-patch}` exist on the V6 line, and its phase 5 needs this wallet's node host and V6 PrivateFPC address (its A1) and the dRPC key's restriction status (its A3: answered above, unrestricted).
- `lessons.md` is at 8,131 of 8,192 bytes: any promotion retires a line. Relevant entries: auto-import typings regenerate only on build (:20); `@aztec` in-process under `bun test` needs a warm cache (:8); timed tests under parallel load (:9); node-client retry semantics and the fee-juice import weight are tagged 5.2.0 and need re-verifying (:40-41).
- `follow-ups.md:5` **P1** (the first release after the tools extraction re-runs the `nulo-landing` build and curl-checks it) rides this release; `:6` (the mainnet USDC seed) resolves when the seed disappears.

## 7. Pin surface of the scope rename

Every `@aztec/*` package the repo uses moves to `@aztec-labs/*`, except `bb.js`, `noir-acvm_js`, `noir-noirc_abi` and `l1-artifacts`, which move to `@aztec-foundation/*`; `@aztec/viem` stays. The sites below break silently or fail open if the rename misses them, so they are listed individually.

- **Four version readers keyed by dependency name**: `.github/actions/setup-aztec/action.yml:18`, `apps/extension/scripts/e2e/docker-ci-like.sh:88` and `apps/extension/tests/e2e/global-setup.ts:45-59` read `@aztec/aztec.js`; `apps/extension/vite.shared.ts:30` reads `@aztec/pxe` into `__AZTEC_VERSION__ ?? "unknown"`. That define feeds the presto client (`src/presto/client.ts:16`, compared by exact string equality inside presto-core), the About page, and the backup envelope's `aztec-version`: a missed key gives "unknown", which silently disables native proving.
- **Substring matchers**: `vite.config.ts:104` (`bb-fetch-code-shim`, `importer?.includes("@aztec/bb.js/dest/browser/")`). If missed, the shim stops applying with no build error, and bb.js's dynamic `import()` of embedded WASM, which MV3 forbids, comes back.
- **Chunking (security-relevant)**: `apps/extension/scripts/vendor-chunks.ts:9,15`. `HEAVY_SCOPES` must gain the new scopes, or the Firefox parse-limit guard fails the build. `NEVER_GROUPED = {"@aztec/wallet-sdk"}` must become `@aztec-labs/wallet-sdk` in the same edit, or the web-accessible wallet-sdk chunk is silently regrouped. Test fixtures: `vendor-chunks.test.ts:4,9,10,20,27,30`, whose chunk slugs become `aztec-labs-*`.
- **Nine literal `"@aztec/"` prefixes** that pass vacuously or flood after the rename: `store-listing.test.ts:106`, `vendor-chunks.ts:9`, `presto-core-deps.test.ts:22`, `scripts/aztec-hold-residue-check.ts:78,87,109,119`, `scripts/lockfile-exception-diff.ts:30`, `scripts/publish/stage.ts:56`. Also `renovate.json:75` (`/^@aztec\//`), which must gain both scopes and stay the last rule (the audits dropped `presto-core` and `presto-banners`: no V6 coupling).
- **Published-package staging**: `scripts/publish/stage.ts:49-57` (`isBundledExternal`) and `:149` (`external: ["@aztec/*", "zod"]`) must accept both scopes together, or the import guard at `:170-181` throws. Tests: `stage.test.ts:35-38,140-145,211-212,357-358`. `packages.ts:41` puts `@aztec/aztec.js` in a staged description. There is no dist-tag and no prerelease path (`publish-packages.yml:82` accepts only X.Y.Z), so anything published is `latest`.
- **Patches**: four `patches/@aztec%2Fnoir-{acvm_js,noirc_abi}@{5.0.1,5.2.0}.patch` become two `@aztec-foundation%2F…@6.0.0-rc.1` files, if rc.1 still needs them. Regenerate them with `bun patch`. Bun drops unmatched `patchedDependencies` keys silently (root `package.json:52` has no lock entry today). The only proof that a patch applied is the `"node":` marker check in `layout-identity.test.ts:29-41` and `resolve-asset/src/index.test.ts:78-84`.
- **Vite and Vitest names**:
  - `vite.config.ts:82` (`resolve.dedupe`), `:227-249` (sqlite3mc emit), `:312-318` (`optimizeDeps.exclude`).
  - `vite.shared.ts:38-46,60-63`. The `noirAliases` keys are bare specifiers; a stale key silently drops the alias in both e2e configs.
  - `apps/playground/vite.config.ts:40`.
  - `inline: [/@aztec/]` in the two e2e configs still matches the new scopes.
- **String-named runtime resolution, invisible to tsc** (`@nulo/resolve-asset` and `require.resolve` call sites):
  - `scripts/extract-bb-wasm.ts:37`
  - `layout-identity.test.ts` (with `expectVersion "5.2.0"` at :20 and :36)
  - `ping-pong.test.ts:84`: reads upstream source `src/extension/handlers/internal_message_types.ts`, which must still ship.
  - `protocol-fpcs.test.ts:23`
  - `presto-licence.test.ts:15-21`
  - `opfs-store.test.ts:41`: reads `pxe/dest/storage/metadata.js`.
  - `stale-anchor.sources.test.ts:16,24`
  - `resolve-asset/src/index.test.ts`
  - `scripts/ci-cd/test-soak/lib.ts:6-17` (`RESOLVE_SPECS`)
- **Import volume**: 669 static imports in 216 files, 53 dynamic imports, 31 `vi.mock`/`importActual`, and 3 `.vue` files. Forms a naive `@aztec/` regex misses:
  - Bun store paths `@aztec+pkg@ver`: `vendor-chunks.test.ts:4,20`, `store-listing.test.ts:109`, `aztec-hold-residue-check.ts:99`.
  - `%2F` patch names.
  - Historical `@aztec/<pkg>@5.x` citations that must NOT be rewritten, because `@aztec-labs/<pkg>@5.x` never existed: `PROVENANCE.md:6-7,10`, `store/SOURCE-BUILD.md:68`, `batched-view-simulation.ts:91,454`, `pxe/service.ts:566`, `CHANGELOG.md`, the vendored `SchnorrAccount.json`, and `NULO_KDF_SPEC`'s "upstream @aztec/accounts 5.0.1" line (`address-freeze.ts:65`), which has no `@` before its version and is the KDF digest's preimage.
- **The existing codemod** (`implementations-plan/tools-extraction/tools/codemod.ts`) has a reusable skeleton (tracked files, binary skip, survivors report). Its "Modified from Azguard Wallet" exemption would skip 26 files carrying `@aztec/`, plus `stage.ts`, `stage.test.ts` and `policy.ts`, so that exemption must not be copied. Its `(?![\w-])` tail does not stop at `.`, so rules must use full names (`aztec.js`). Format only the touched files; never `biome check --write`, which converts `vi.fn(function …)` mocks and breaks about 95 tests.
- **Third-party notices refuse the build** by exact name plus `reviewedVersion`:
  - `packages/third-party-notices/src/policy.ts:81-86`: `AZTEC_TAG`, `NOIR_COMMIT`, sqlite3mc pin.
  - `:91-150`: 18 OVERRIDES names at 5.2.0, plus bb.js, the noir pair and sqlite3mc.
  - VENDORED `coveredBy` at `:191,219,241,246,251`.
  - `expected-minimum.txt:25-33`: the CI floor.
  - `legal-acceptance.test.ts:399`: expects `"@aztec/sqlite3mc-wasm@"`.

  `texts/` refresh only from the tagged upstream sources. The bundled set can change at rc.1; the build lists every violation at once.
- **CI**:
  - presto-server `1.1.2` is pinned in `_extension-network-e2e.yml:179-189` and `setup-presto-server/action.yml:28`. Moving to `1.1.3` means version plus both SHA-256 pins in one commit (SECURITY.md "Binary dependencies"). The log literals at `:357-359` must still match 1.1.3's.
  - The Aztec installer in `setup-aztec` is `curl | bash`, unpinned (existing risk).
- **Docs with state statements**, rewritten, not history:
  - `UPDATE.md:7`
  - `.claude/skills/aztec-update/SKILL.md:39-44`: the pin-surface grep sees only `@aztec/viem` after the rename, and the hold text retires.
  - `CLAUDE.md:36,100,107-112,141`
  - `SECURITY.md:56,152,326,572,586-588`: `586` names a stale `@alejoamiras/aztec-standards`.
  - `CI.md:122`, `ARCHITECTURE.md:30,167,205,213`, `README.md:17,45`, `.github/README.md:44`, `e2e-testing/SKILL.md:643-644`
  - Package READMEs. Stale `5.0.0-rc.2` statements: `aztec-runtime/README.md:64`, `wallet-bridge/README.md:318`, `wallet-sdk-schema-patch/README.md:40`.
  - `scripts/publish/README.md`, `readme/*.md`, `legal/README.md:58` (the Presto MIT claim names `5.2.0-revision.3`).
- **Version literals by class** (26 live files, 97 hits of `5.2.0`):
  - Real pins: 54.
  - Executable literals: `layout-identity.test.ts:20,36`, `resolve-asset/src/index.test.ts:67-98` (including the escaped `/5\.2\.0.*9\.9\.9/`), `stage.test.ts:357-358`, `aztec-hold-residue-check.ts:25`, `policy.ts:81,112-145`.
  - Coupled to the pin through `__AZTEC_VERSION__`: `presto-ui-state.test.ts:171`, `tests/e2e/fixtures/presto.ts:14-15`. A stale fixture yields `version-mismatch` in e2e.
  - Arbitrary self-consistent fixtures: update for readability.
- **Adaptable tools**:
  - `implementations-plan/isolated-linker-store/tools/phantom-sweep.ts`: checks that every import is declared, which catches a wrong scope assignment. Reuse as is.
  - `lockfile-exception-diff.ts`: normalise old to new scope before diffing, or every package reads as removed plus added.
  - `aztec-hold-residue-check.ts`: its hold logic ends with the move of the pair. Keep the graph-closure and physical-copy checks and retarget them to the new scopes, or retire the script and its runbook lines together.

## Absence claims and search trails

- No `@aztec-labs` package scope anywhere in code (`rg -e '@aztec-labs'` over apps, packages, infra, scripts: hosts only).
- No `GasPrice`/l1-tx-utils use (`rg 'GasPrice|l1-tx-utils|L1TxUtils|\bgasPrice\b'` over apps, packages, infra, scripts, .github).
- No direct `outputs.globals` access (`rg 'outputs\.globals|"globals"|\bglobals\b'`: vitest options and the vendored JSON only).
- Landing has no chain, version or store strings (`git grep -i -E 'v5|v6|alpha|mainnet|testnet|chromewebstore|addons\.mozilla' -- apps/landing`: 0).
- Release and store scripts carry no product name or slug (`git grep -E 'Nulo V5|nulo-v5|\bV5\b' -- .github scripts/release scripts/ci-cd`: one test fixture).
- No existing regime-append helper or `scripts/` vector generator (`rg -l 'derive-vectors|REGIMES\[' -- scripts packages apps`).
