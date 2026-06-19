# Aztec 4.2.0 → 5.0.0-rc.1 upgrade (protocol hard fork)

**Status:** APPROVED (2026-06-19) · **Tier:** mega-deep · **Scope:** everything (all TS packages + 3 Noir bridge crates + bridge TS), bridge-correct.

## Summary

Upgrade every Aztec-family dependency from the 4.2.0 line to 5.0.0-rc.1, a protocol **hard fork**: address derivation changes (PublicKeys point→hash + immutables_hash), Schnorr's signature challenge moves to Poseidon2, the PXE deletes pre-v6 local databases on first open, and large swaths of the Aztec.js / aztec-nr surface changed (fee/gas API, tx-receipt union, deploy construction-time params, node RPC, message delivery, protocol-contract demotions). All TS packages share one `bun.lock`, so they move together. Three external libs move in lockstep to their 5.0-aligned releases.

**Definition of done = the full network-e2e suite green on a real 5.0 sandbox, with native proving enforced on the canary shards** (transfers + tx-sendTx-default — the suite's real-proving locus by design; bulk shards run proverless per the established `_network-e2e.yml` architecture, see `e2e-proverless-stub`) **and no silent WASM fallback on any shard that declares native proving.** The `accelerator-server` binary **downloads the SDK-requested `bb` on demand** (bundling is only a first-prove optimization), so the existing binary line proves 5.0 — no external binary release is required; the CI pin just needs a refresh (Phase 0, lightweight). Existing local wallets and testnet Schnorr accounts break; per decision this is **documented, not migrated**.

## Why not a naive "bump everything then chase typecheck"

Five reasons shape the phasing (all verified):
1. **`fee-options.ts` is a copied file, not imported types** — a syntactically-valid port can be semantically wrong (under/overfund fees) and typecheck still passes. It must be re-derived from the 5.0 `base_wallet` source AND gained new test cases for the `txsLimits`/`gasUsed` path.
2. **The schema patch is a boot-time runtime guard, not a compile-time type** — if `WalletSchema`/`schemas` import paths moved, the service worker fails at init, invisible to typecheck. Verify import resolution in Phase 1.
3. **Noir compilation is a separate toolchain** and recompiled artifacts change computed class-ids → the `private-fuel.test.ts` address tripwire fires; sequence Noir compile + tripwire + constant-update atomically.
4. **The `minimumReleaseAge` gate blocks `bun install` itself** — the bunfig exclude must be the literal first action.
5. **bb.js WASM is build-extracted from `node_modules`** (not vendored) — a layout change at 5.0 fails the build emit, not typecheck.

## Ground truth (verified — see `research/01..05` + `lessons/phase-0`)

- Current pin: **4.2.0** everywhere (exact-pinned); **no 4.3.0** references in-repo.
- One `bun.lock` → no partial-version state.
- `@aztec/aztec.js@5.0.0-rc.1` published **2026-06-15** → blocked by the 7-day `minimumReleaseAge` gate until ~2026-06-22.
- `patchedDependencies` = exactly two: `@aztec/noir-noirc_abi@4.2.0`, `@aztec/noir-acvm_js@4.2.0`.
- `CURRENT_VERSION = 7` in `packages/extension/src/wallet/storage/migrate.ts`; the **PXE IndexedDB wipe is driven by `INDEXEDDB_WIPE_PREFIXES=["pxe/"]`** (migrate.ts:69,111–120), not `KEYS_TO_WIPE`.
- bb.js WASM is **build-extracted** via `packages/extension/scripts/extract-bb-wasm.ts` (reads `node_modules/@aztec/bb.js/dest/{node,browser}/...`, hash-asserts) — **no committed `.wasm.gz`**.
- `@aztec/viem@2.38.2` is a **separate version axis** (`extension/package.json:79` + `bridge-core/package.json:29` `viem: npm:@aztec/viem@2.38.2`) — must NOT bump.
- Wallet uses `createPXE` (not `EmbeddedWallet`) → AuthRegistry is **not** auto-preloaded in 5.0.
- `fee-options.ts` is a byte-for-byte copy of `base_wallet` fee logic that changed in 5.0.
- Schema patch (`registerToken`/`isTokenRegistered`/`grantPublicAuthwit`) duplicated in 3 files; pinned (presence+arity only) by `wallet-bridge/src/dispatcher.test.ts`. The silent-omission killer for the registry is `wallet-bridge/src/method-descriptors.test.ts`.
- Root `bun run test` is **extension-only**; wallet-bridge/bridge-core/faucet unit suites run via `bun run test:all` (`--filter '@nulo/*'`).
- `compile.sh` compiles only `token_minter_proxy` + `token_bridge` (keystone is a test bin, run via `aztec test`).
- `bridge-core/tsconfig.scripts.json` **excludes `deploy-sandbox.ts`** (deprecated local-sandbox path, pre-existing API-drift error).
- **accelerator-server downloads the requested `bb` on demand** (confirmed: v1.0.6 notes say bundling 4.3.1 means "no on-demand download on first prove" → a non-matching version IS downloaded; SDK exposes `needsDownload` + a `"downloading"` phase). So the existing binary line proves 5.0 by fetching 5.0's `bb` on first prove — **no external binary release needed**. CI pins binary v1.0.1 (extracted-binary SHA `d701837…` at `_network-e2e.yml:159`); latest is v1.0.6 → refresh the pin + SHA (Phase 0). The 5.0 SDK npm release intentionally ships no server binary (binary is its own 1.0.x line).
- Standards 5.0 Noir tag = **same tag as the TS tgz** (`prerelease-334c38d` serves both the tgz and the `src/token_contract` Noir directory).
- `https://install.aztec.network/5.0.0-rc.1/install` → 301 → `install.aztec-labs.com/...` (curl `-fsSL` follows).
- Accelerator SDK `5.0.0-rc.1` is well-formed; pulls a NEW transitive `@aztec/bb-prover@5.0.0-rc.1`.

## Version matrix

| dep | from | to | form |
|---|---|---|---|
| `@aztec/*` (all EXCEPT `@aztec/viem`) | `4.2.0` | `5.0.0-rc.1` | npm exact |
| `@aztec/viem` | `2.38.2` | **unchanged** | npm exact (separate axis) |
| `@alejoamiras/aztec-accelerator` | `4.2.0` | `5.0.0-rc.1` | npm exact (pulls `@aztec/bb-prover@5.0.0-rc.1`) |
| `@wonderland/aztec-fee-payment` | tgz `prerelease-215fd08` | tgz `prerelease-fb6f196` | GitHub release tgz |
| `@defi-wonderland/aztec-standards` | npm `4.2.0-aztecnr-rc.2` | tgz `prerelease-334c38d` | **npm → GitHub tgz** |
| Noir `aztec` + `token_portal_content_hash_lib` (3 crates) | `v4.2.0-aztecnr-rc.2` | 5.0 aztec-nr tag (confirm in P5) | git tag |
| Noir `token` (token_minter_proxy) | `prerelease-1ad0e28` | `prerelease-334c38d` | git tag (same as TS tgz) |
| accelerator-server binary (CI) | `v1.0.1` (4.x) | new 5.0 binary (Phase 0) | GH release + extracted-binary SHA |

---

## Phases

> Bottom-up by layer (`wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`; then faucet/playground/bridge). Cheap gates first; the **native-proving network-e2e ship gate (6B) is last and blocking**.

### Phase 0 — Refresh the CI accelerator-server pin (lightweight; NOT a blocker)

**Objective.** No external binary release needed — the accelerator-server downloads the SDK-requested `bb` on demand, so the existing binary line proves 5.0. Just refresh the CI pin and confirm the runner can do the first-prove download.

**Files / changes.** `.github/workflows/_network-e2e.yml:158-167`: bump `version` v1.0.1 → current (e.g. v1.0.6) + update the **extracted-binary SHA-256** (the trust anchor `setup-accelerator-server` verifies — NOT the tarball hash). Ensure the runner allows the first-prove `bb` download (network egress) or pre-warm it; the `"downloading"` phase adds latency to the first canary prove (acceptable).

**Validation gate.** Against a 5.0 sandbox, the pinned binary `/health` reports `bb_available=true` (after any on-demand download) and a native-proving canary tx proves successfully. Layers: CI config (folds into Phase 6B in practice). Can run anytime — does not block Phases 1–5.

### Phase 1 — Dependency bump + install hygiene + verification gates ✓ DONE

> Gate passed: `bun install --frozen-lockfile` exit 0; noir patches re-keyed to @5.0.0-rc.1 + apply (5.0 still needs them); import-resolution probes pass (WalletSchema/schemas/base-wallet exports/AcceleratorProver); bb.js extract paths intact; `typecheck:all` runs (106 errors catalogued → P2–P5). Notes: min-age glob unsupported → enumerated the 30-pkg @aztec closure; `checkAcceleratorStatus` gone from the 5.0 accelerator API (→ P2). See `lessons/phase-1.md`.

**Objective.** Move pins; make `bun install --frozen-lockfile` pass under the min-age gate; verify the patch + import-path + bb.js-extract + AcceleratorProver assumptions early (these are runtime/build failures invisible to typecheck).

**Files / changes.**
- `packages/{extension,aztec-runtime,bridge-core,faucet,playground,wallet-bridge,wallet-crypto}/package.json`: `@aztec/*` → `5.0.0-rc.1` **except `@aztec/viem` (leave 2.38.2)**; accelerator → `5.0.0-rc.1`; fee-payment → fb6f196 tgz; standards → 334c38d tgz (npm→URL).
- Root `package.json`: re-key both `patchedDependencies` `@4.2.0`→`@5.0.0-rc.1` + rename the patch files; **or delete** both if `node_modules/@aztec/noir-*/package.json` already has the `exports` field at 5.0.
- `bunfig.toml`: add temporary `minimumReleaseAgeExcludes` for all bumped `@aztec/*` + `@alejoamiras/aztec-accelerator` + the new transitive `@aztec/bb-prover` (NOT `@aztec/viem`); comment with removal date (~2026-06-22).
- `bun install` (delete `bun.lock` first per Bun #25305 if transitives don't re-resolve); commit `bun.lock`.

**Verification gate (all must pass before Phase 2).**
- `bun install --frozen-lockfile` exits 0; both noir patches apply (or confirmed unneeded).
- Import-resolution probes succeed (else fix paths now): `WalletSchema` from `@aztec/aztec.js/wallet`; `schemas` from `@aztec/stdlib/schemas`; `simulateViaNode`/`buildMergedSimulationResult`/`getGasLimits` from `@aztec/wallet-sdk/base-wallet`; `AcceleratorProver`/`checkAcceleratorStatus` from `@alejoamiras/aztec-accelerator`.
- `bun run build` reaches the bb-wasm emit step (extract-bb-wasm self-reports via a clear throw if bb.js@5.0 moved its `dest/{node,browser}/...` layout — fix the path constants if so).
- `bun run typecheck:all` RUNS; errors catalogued into Phases 2–5 (this gate does not require zero typecheck). Layers: install/build/resolution.

### Phase 2 — aztec-runtime core migration ✓ DONE

> Gate passed: aztec-runtime typecheck 0 errors; 32 tests pass (incl. 2 new fee `txsLimits` cases); lint clean. Headline: **zod v3→v4 bump** (repo pinned `^3.23.8`; @aztec 5.0 needs `^4`) cleared 44/53 errors. Fee fallback re-derived (defaults gasLimits from `txsLimits.gas`); auth-registry/mce/public-checks artifacts moved to `@aztec/standard-contracts/*`; `proveTx` options-bag; `accounts/schnorr/stub` path; initializer-undefined guards. See `lessons/phase-2.md`.

**Objective.** Green the core runtime; re-derive fee logic with real coverage of the new 5.0 path.

**Files / changes.**
- `src/account/fee-options.ts`: re-derive from 5.0 `@aztec/wallet-sdk/base-wallet` — `getGasLimits(gasUsed, Gas.from(txsLimits.gas), padding)`, `gasUsed` replaces `estimatedGas`, `GasSettings.fallback` requires explicit `gasLimits` (fetch `node.getNodeInfo().txsLimits.gas`), drop removed stdlib constants.
- `src/account/fee-options.test.ts`: re-green the 6 existing cases AND **add cases covering the new `txsLimits.gas` fallback + `gasUsed` path** (the existing tests don't model it — a types-pass port can mis-fund).
- `src/pxe/chain-runtime.ts`: pass `preloadedContractsProvider` incl. AuthRegistry + MultiCallEntrypoint (provider REPLACES the default); update `AcceleratorProver` wiring if its API moved; fix the `sdkAztecVersion: "4.2.0"` test mock → `5.0.0-rc.1`.
- `src/pxe/service.ts`: `proveTx(req,{scopes})`, `new SimulationOverrides({contracts})` (+ entries `{instance}` only), verify `getBlock`.
- `src/account/nulo-account.ts`: confirm PublicKeys/deriveKeys path (keep deriving via SDK `deriveKeys`; never hand-roll keys); `DefaultMultiCallEntrypoint`.
- `src/pxe/note-schemas.ts`: verify slots `0x1/0x3/0x7` vs new `artifact.storageLayout`.

**Validation gate.** `bun run --cwd packages/aztec-runtime typecheck` exit 0; `bun run --cwd packages/aztec-runtime test` green (esp. `fee-options.test.ts` incl. new cases); `bun run lint`. Layers: typecheck + unit + lint.

### Phase 3 — wallet-bridge + extension + schema patch + storage wipe

**Objective.** Green the extension + wallet-bridge; preserve the custom RPC contract; bump storage version with documented wipe.

**Files / changes.**
- `fast-path.ts:45`, `batched-view-simulation.ts:133`: re-point `@aztec/wallet-sdk/base-wallet` exports.
- getTxReceipt union narrowing: `transaction/service.ts:213` (+ enum map `:245-253`), `execution/dapp-send-executor.ts:407,596`, `auth-registry/service.ts:312`; the one `getTxEffect` site → `getTxReceipt(h,{includeTxEffect:true})`.
- GasSettings sites: `tx-request-builder.ts:46`, `fee-strategy.ts:41`, `embedded-fpc-cap.ts:66`, `fpc-strategy.ts:25`.
- Schema patch (extension copy `nulo-schema-patch.ts`): **manually inspect** whether 5.0 `WalletSchema` ships `registerToken`/`isTokenRegistered`/`grantPublicAuthwit` natively or with changed arg/return types — the arity guards pass silently on a same-arity-but-different-semantics upstream method. Update the copy AND make an explicit, recorded decision (in lessons) on hardening the guard beyond arity — e.g. assert the parameter schema + return shape, not just `items.length` — given 5.0's surface. ("Keep arity-only" is an allowed outcome, but it must be a recorded decision, not a default.)
- `packages/extension/src/wallet/storage/migrate.ts`: `CURRENT_VERSION` 7→8 + a v8 doc paragraph describing the hard-fork reset (live behavior, no milestone tags). The `pxe/`-prefix IndexedDB wipe re-fires automatically; additionally add token-balance/note caches to `KEYS_TO_WIPE`/`KEY_PREFIXES_TO_WIPE_LOCAL` (recompiled-artifact class-ids change). Update `ARCHITECTURE.md` wipe-scope doc (required when bumping `CURRENT_VERSION`).

**Validation gate.** `bun run audit:vue` (typecheck:all → extension test → lint → build) exit 0 **AND** `bun run test:all` green so the wallet-bridge suite runs — specifically `dispatcher.test.ts` + `method-descriptors.test.ts`; plus the extension slot tripwire `note/note-schemas.test.ts`. Layers: typecheck + unit (all pkgs) + component + lint + build.

### Phase 4 — faucet + playground migration

**Objective.** Green faucet + playground; re-pin deterministic deploy addresses offline; migrate faucet bridge runtime sites.

**Files / changes.**
- `packages/faucet/src/lib/nulo-schema-patch.ts` + `packages/playground/src/lib/nulo-schema-patch.ts`: mirror the Phase-3 schema-patch edits verbatim (3-copy rule).
- `packages/faucet/scripts/deploy.ts`: `EmbeddedWallet.create` option name — repo uses BOTH `{pxeConfig}` (here + bridge) and `{pxe}` (e2e fixture `aztec.ts:77`); **explicit checkpoint** — pick the 5.0-correct name and unify; DeployMethod construction-time params; `NO_FROM` constant if exported.
- Faucet bridge runtime (silent-semantic risk): `src/composables/useWithdraw.ts:53`, `src/composables/useDeposit.ts:431` — tx-receipt / membership-witness sites.
- `@defi-wonderland/aztec-standards` artifact alias paths (`vite.shared.ts` `@wonderland-token-artifact`) — verify the tgz `target/` layout.
- `packages/faucet/src/contracts/deployments.json`: re-pin Dripper/NULO/OLUN addresses **offline** (compute from the new artifact + salt via the deploy script's dry path; `verify-deployments.ts` is deterministic/offline — no live deploy needed).

**Validation gate.** `bun run audit:faucet` (typecheck:all → test:faucet → lint → **verify:deployments** → build:faucet) exit 0; `bun run --cwd packages/playground typecheck` **and** `build`. Layers: typecheck + unit + lint + build + offline deploy-verify.

### Phase 5 — Noir bridge recompile + bridge TS + manifests

**Objective.** Recompile the Noir crates against aztec-nr 5.0; green bridge-core TS; validate bridge end-to-end incl. its manifest + L1 verification surface.

**Files / changes.**
- `packages/bridge-aztec/{token_bridge,token_minter_proxy,keystone}/Nargo.toml`: `aztec` + `token_portal_content_hash_lib` → 5.0 aztec-nr tag; `token` (minter_proxy) → `prerelease-334c38d`.
- `token_bridge/src/main.nr`: migrate message API (`consume_l1_to_l2_message`/`message_portal`, `messages::delivery`, `MessageDelivery::*()`, `.with_sender`) per the 5.0 aztec-nr `context/` source.
- `packages/bridge-aztec/scripts/compile.sh`: update the `AZTEC_RC2` toolchain var → 5.0 toolchain; recompile `token_minter_proxy` + `token_bridge`; commit artifacts.
- `keystone` compiles/tests via `aztec test` in the crate (it is a test bin, NOT in compile.sh) — include it in the gate explicitly.
- `packages/bridge-core/src/flows.ts:186,190,198`: `getTxEffect`→`getTxReceipt({includeTxEffect})`, `MembershipWitness` field names.
- `bridge-core/scripts/*` (live testnet paths): DeployMethod construction-time; `SponsoredFeePaymentMethod` + `PrivateMintAndPayFeePaymentMethod` ctors; `private-fuel.ts` re-pin `PRIVATE_FPC_ADDRESS` if bytecode drifted (tripwire-driven). `deploy-sandbox.ts` is **deprecated + typecheck-excluded** — skip the initializerless change there (dead path); live scripts derive accounts from own secrets (no initializerless migration needed).
- Bridge deploy manifest (`deploy-manifest.ts`) + L1 source verification (`verify-l1.ts`) + faucet bridge static addresses (`bridge-deployments.ts`): re-pin/re-verify if standards/portal bytecode drifted.

**Validation gate.** `packages/bridge-aztec/scripts/compile.sh` compiles token_minter_proxy + token_bridge; `aztec test` green in keystone; `bun run --cwd packages/bridge-core typecheck` + `test` (incl. `private-fuel.test.ts` address tripwire + `DOM_SEP__FPC_BRIDGE_SECRET`); bridge `--smoke` (deposit/claim/withdraw/consume, per `bridge-aztec/README.md`) green on a 5.0 sandbox; `verify-l1` clean. Layers: noir-compile + typecheck + unit + bridge-e2e + L1-verify.

### Phase 6 — Network-e2e on real 5.0 (6A interim · 6B ship gate; unblocked — Phase 0 is just a pin refresh)

**6A — proverless interim validation (available now; NOT the ship gate).** With `vars.NULO_E2E_DISABLE_ACCELERATOR=1` / proverless, run `bun run e2e:agent` against a 5.0 sandbox (auto-derived from the `@aztec/aztec.js` pin via `setup-aztec`; the rc install endpoint is confirmed). Validates the protocol migration + sandbox compat + bridge flows without the binary. **Passing 6A does not satisfy the definition of done.**

**6B — native-proving ship gate (BLOCKING; uses the existing binary, which downloads 5.0's `bb` on demand).**
- Update `.github/workflows/_network-e2e.yml:159` extracted-binary SHA + version to the Phase-0 binary.
- The wallet build MUST be stamped `VITE_NULO_ACCELERATOR_REQUIRED=1` (agent.sh greps the stamp; chain-runtime required-mode throws on WASM fallback) AND the 5.0 accelerator-server must be running with `/health` `bb_available=true`. Running bare `e2e:agent` without the stamp + server would **silently pass on WASM** — explicitly disallowed as the ship proof.

**Validation gate.** 6A: proverless shards green incl. bridge smoke. **6B (definition of done): the full `Network e2e / Status` suite green, with the canary shards (transfers + tx-sendTx-default) running native proving — required-mode build stamp present, accelerator preflight `bb_available=true`, zero WASM fallback on the canaries. Bulk shards stay proverless by design (`e2e-proverless-stub`); native proving is the canaries' job — this matches the repo's proverless-bulk/native-canary architecture rather than forcing all-shards-native.** Layers: network-e2e-live + native proving.

### Phase 7 — Docs + min-age cleanup

**Files / changes.** `CLAUDE.md`, `ARCHITECTURE.md`, `CI.md`, release notes: document the PXE reset + dead Schnorr accounts; update the accelerator-server pin note. Follow-up PR (separate): remove the temporary `minimumReleaseAgeExcludes` once 5.0.0-rc.1 ages out (~2026-06-22).

**Validation gate.** `Quality / Status` green; actionlint clean (via the `actionlint.yml` CI workflow / `actionlint` binary — there is no `bun run lint:actions` script); docs reviewed. Layers: typecheck + lint + actionlint.

---

## Security & Adversarial Considerations

- **Cryptography.** Schnorr's challenge → Poseidon2 and PublicKeys point→hash are **upstream** (`@aztec/accounts`, `noir-lang/schnorr` v0.4.0, kernel circuits) — not rolled here. Threat: an account path bypassing `deriveKeys` could yield on-curve-unverified keys → unspendable notes (5.0 PXE note). Mitigation: `nulo-account.ts:53` derives via SDK `deriveKeys` (verified — no hand-rolled keys); keep the e2e fixture address-parity assertion (`aztec.ts:344`). The bridge `DOM_SEP__FPC_BRIDGE_SECRET` literal is `poseidon2HashBytes`-derived; the Poseidon2 **hash** params are stable (only the signature *challenge* moved + NEW separators were added for merkle/block/blob), so it likely doesn't change — but `private-fuel.test.ts` pins it as a tripwire regardless (rated MEDIUM here; the independent plan rated CRITICAL — see ledger).
- **Supply chain (corrected).** The 2 Wonderland deps install as **GitHub-release tarballs that carry NO integrity hash in `bun.lock`** (verified: lockfile records only the URL), and the Noir deps are **git tags outside `bun.lock` entirely**. So "exact URL + frozen lockfile" is NOT a cryptographic immutability guarantee. Real integrity controls: GitHub release assets (publisher-controlled, not append-only-immutable), the committed Noir artifacts, and the `private-fuel.test.ts` address tripwire (a tampered artifact changes the derived address → fails). Recommend recording the expected tgz SHA-256 out-of-band and re-checking on install. npm `@aztec/*` DO carry lockfile integrity hashes.
- **Accelerator trust anchor (corrected).** The CI trust anchor is the **extracted-binary SHA-256** verified by `setup-accelerator-server` on every run (`_network-e2e.yml:159`), NOT the tarball hash — Phase 0 must record the extracted-binary hash. The headless server binds `127.0.0.1` only. The 5.0 release should ship via a release job with `contents: write` scoped to that job.
- **Native-proving cannot silently degrade.** The 6B gate is meaningless unless the build carries `VITE_NULO_ACCELERATOR_REQUIRED=1` and the server is up — otherwise `chain-runtime` defaults to silent WASM. The gate wording enforces the stamp + preflight (this was the codex CRITICAL).
- **Schema-patch override risk.** Arity-only guards pass on a same-arity upstream method with different semantics → manual 5.0 `WalletSchema` inspection in Phase 3.
- **Hard-fork / protocol.** Address+key-hash derivation changes are reorg-equivalent on testnet; no replay risk (new chain). Storage 7→8 mechanically wipes stale PXE IDB (`pxe/` prefix) to avoid corrupt-state reads.

## Assumptions

**Facts (verified).**
- Version matrix incl. the **`@aztec/viem` carve-out** and the npm→tgz form change for standards (`research/04`, package.json lines cited).
- bb.js is **build-extracted, not vendored** (`extract-bb-wasm.ts`, `vite.config.ts:182`); no committed `.wasm.gz`.
- `patchedDependencies` content; `CURRENT_VERSION=7`; PXE wipe via `INDEXEDDB_WIPE_PREFIXES=["pxe/"]` (migrate.ts:69,111).
- Root `test` is extension-only; `test:all` runs the workspace; `compile.sh` skips keystone; `deploy-sandbox.ts` is deprecated + typecheck-excluded.
- Wonderland tgz deps have no lockfile integrity hash; accelerator trust anchor = extracted-binary SHA.
- **Standards 5.0 Noir tag = the TS tgz tag** (`prerelease-334c38d` serves both) — resolves the former Ask #3.
- **Install endpoint serves the rc** (301→aztec-labs; curl `-fsSL` follows).
- No 5.0 accelerator-server binary; CI pins v1.0.1; v1.0.6=4.3.1.

**Inferences → now explicit Phase gates (not loose assumptions).**
- `WalletSchema`/`schemas`/`base-wallet`-export import paths stable → **Phase 1 resolution probes**.
- `AcceleratorProver` API shape-compatible → **Phase 1 resolution probe** + Phase 2 typecheck.
- noir-wasm `exports` patch still needed vs upstream-fixed → **Phase 1** (inspect installed package.json; apply-or-delete).
- `EmbeddedWallet.create` option name (`pxeConfig` vs `pxe`) → **Phase 4 explicit checkpoint** (repo currently uses both shapes).
- base_wallet fee logic re-derivable AND correct → **Phase 2** with new `txsLimits` test cases.
- 5.0 aztec-nr git tag name + whether the bridge message-context API changed → **Phase 5** (read 5.0 `context/` source before compile).

**Asks — RESOLVED (2026-06-19).**
1. ~~5.0 accelerator-server binary sequencing~~ — **DISSOLVED.** User confirmed the accelerator-server downloads the requested `bb` on demand, so no external release is needed and 6B is unblocked now. Native-proving 6B remains the definition of done; Phase 0 is the lightweight pin refresh.
2. Min-age window — **add the temporary excludes now** (all bumped `@aztec/*` + `@alejoamiras/aztec-accelerator` + transitive `@aztec/bb-prover`; NOT `@aztec/viem`); start immediately rather than waiting for ~2026-06-22; follow-up PR removes them once aged out (Phase 7).
3. PR shape — **single feature-branch PR.** The one-`bun.lock` coupling means intermediate deps-only states don't compile, so a green-per-step stack into `dev` (which requires `Quality / Status` green per PR) isn't viable; land one PR when fully green. (Internal commit granularity still follows phases for reviewability.)
4. `/harden security` — recommended at pre-release time (touches crypto + supply chain); not scheduled now (expensive; pre-release only).

## Decision ledger

- **Chosen structure:** layer-bottom-up, cheap-gates-first, two-stage network-e2e (6A interim proverless / 6B native-proving ship gate), accelerator binary as an external Phase-0 prerequisite. Adopted from the main draft + the independent plan's two-stage idea.
- **Three independent plans:** main (Opus), independent planner (Sonnet — fable substitute, fable unavailable in env), codex audit. The independent plan acted as the contradiction-check and caught two real errors in the main draft (below).
- **Corrections folded (independent plan + codex, all repo-verified):** bb.js is build-extracted not vendored (dropped the stale re-vendor step); `@aztec/viem` carve-out; storage wipe is `pxe/`-prefix IDB not `KEYS_TO_WIPE`; gates must use `test:all` to hit wallet-bridge `method-descriptors.test.ts`+`dispatcher.test.ts`; extension `note-schemas.test.ts` is the slot tripwire; `verify:deployments` runs offline in Phase 4 (not deferred); `deploy-sandbox.ts` deprecated/excluded (initializerless descoped); compile.sh skips keystone; supply-chain claim corrected (tarballs not integrity-hashed); accelerator SHA = extracted-binary not tarball; fee gate needs new `txsLimits` test cases; `EmbeddedWallet.create` shape is an explicit checkpoint; `lint:actions` is not a real script.
- **Reframed (codex CRITICALs):** the native-proving ship gate (6B) is now explicitly enforced (build stamp + preflight + no-WASM); Ask #1 reframed from "accept WASM interim" to a merge-sequencing decision (native proving stays the bar).
- **Disputed:** `DOM_SEP__FPC_BRIDGE_SECRET` severity — independent/codex lean CRITICAL; I hold **MEDIUM** (Poseidon2 hash params are stable; only the signature challenge moved). Resolved by keeping the tripwire test as a hard gate regardless of severity label.
- **Partial pushback on codex (round 2):** codex wanted 6B to require full-suite native proving. Held the line that native proving is a **canary-shard** concern by the repo's deliberate design (`e2e-proverless-stub`: bulk shards proverless, canaries real-proving). Forcing all-shards-native would fight that architecture + balloon CI time. Reconciled by making the DoD wording match reality (suite green + native enforced on canaries) rather than expanding the requirement. Codex's underlying point (the DoD/6B text mismatched) was valid and is fixed; its proposed remedy (all-native) was not adopted.
- **User decision (2026-06-19) — APPROVED.** Plus a factual correction that dissolved the headline blocker: the accelerator-server **downloads the requested `bb` version on demand**, so no 5.0-specific binary release is needed (the research/codex framing of "no 5.0 binary → blocker" was wrong about the mechanism — bundling is only a first-prove optimization, confirmed by the v1.0.6 notes). Phase 0 downgraded to a CI pin refresh; Ask #1 dissolved; native-proving 6B unblocked now. Remaining decisions resolved by default per "approve everything else": min-age excludes added now (not waiting for 06-22); single feature-branch PR (lockfile coupling rules out a green-per-step stack); `/harden security` recommended at pre-release, not scheduled now.

## Audit verdicts

- **Codex (round 1, `xhigh`, session 019edf7b…):** **reject** — native-proving not enforced by the stated gate; plan permitted a WASM ship path; bridge/faucet manifest validation incomplete; several stale/non-real gates (bb.js vendoring, keystone compile, wallet-bridge tests, `lint:actions`). **All findings addressed in this revision** (re-audit pending below).
- **Independent planner (Sonnet, fable substitute):** structural agreement; contributed the two-stage e2e, the bb.js + viem corrections, and the schema-patch arity nuance.
- **Codex (round 2, re-audit, session 019edf7b…):** **conditional approve** — 8/10 round-1 findings RESOLVED; 3 tightening conditions, all now folded: (1) 6B "canary shards" vs "full native proving" mismatch → reconciled (see ledger: the repo's e2e is proverless-bulk + native-canary *by design*; DoD + 6B wording now both say "suite green + native proving enforced on the canaries", not all-shards-native — a grounded partial pushback on codex); (2) Ask 1(b) release boundary → added "first PR not promotable to a stable release until follow-up 6B passes; may land on `dev` only"; (3) schema-patch hardening → now a required recorded decision, not "consider". Verdict satisfied.

## Seeds

_(Finalized — approved 2026-06-19. Use exactly ONE per session — they don't compose. Recommended: `/loop` — the long CI / network-e2e waits across the phases fit interval-driving + codex-on-decisions better than a single completion condition.)_

**Recommended — `/loop 15m`:**

```
/loop 15m Drive implementations-plan/aztec-5.0-upgrade forward. Never idle waiting for my input. Each firing:
1. Reality check: read plan.md + lessons/ (authoritative, not the chat); `git status` + `git log --oneline -5`. PR? `gh pr view --json statusCheckRollup`. Else with CI: `gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId`.
2. Waiting on CI / network-e2e is fine — confirm progress (`gh run watch <id>` up to 10 min); use the wait to prep the next phase. Don't start conflicting work.
3. No task? Next pending phase from plan.md. After each edit run fast layers (`bun run lint` + touched pkg `typecheck`/`test`). Then commit → push.
4. Stuck / decision you'd bring to me? `/codex xhigh`, reach a defensible call, act, log in lessons/phase-N.md. Hard limits: never merge to main/release, never publish/deploy, never expand scope — surface + hold if a call needs crossing one.
5. Same step failed 5×? Stop; reassess with codex; continue down the agreed path.
6. Phase green = THE phase's validation gate in plan.md passes. Run it, paste result, mark ✓, file lessons, print `LESSONS_FILE=implementations-plan/aztec-5.0-upgrade/lessons/phase-N.md`, advance.
7. Phase 6B (native-proving) uses the existing accelerator-server (downloads 5.0 `bb` on demand). Never fake it with WASM — if the canary preflight shows `bb_available=false`, fix the CI pin/egress (Phase 0), don't disable proving.
8. All phases ✓? `/code-review max --fix` → commit separately → codex post-impl audit (`/codex xhigh`, net diff + adversarial/security ask) → address high/critical → wrap-up report. Surface + stop.
Keep the ASCII checklist visible each firing (plan.md is source of truth).
```

**Alternative — `/goal`:**

```
/goal All phases marked ✓ in plan.md, each ✓ backed by its phase's validation gate reported passing in the transcript; for each phase the agent printed `LESSONS_FILE=implementations-plan/aztec-5.0-upgrade/lessons/phase-N.md`; `/code-review max --fix` complete + committed; codex post-impl audit complete with high/critical findings addressed; `bun run test:all` and `bun run lint` both exit 0 in the transcript; Phase 6B native-proving network-e2e green — canary shards with required-mode build stamp + accelerator preflight `bb_available=true` + zero WASM fallback.
```
