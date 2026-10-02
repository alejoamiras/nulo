# Phase 3 · private-fee-juice 6.0.0-rc.1 and the protocol FPC pins

## Step 1 · The pin (2026-10-01)

- `apps/extension`, `packages/aztec-runtime` and `apps/playground` each pin
  `@alejoamiras/private-fee-juice@6.0.0-rc.1`, and `bun.lock` resolves it at
  `sha512-GwKXLlITPinKY11Mp4DJK+sZ96tby1I5Z4sWa6JYfeVX2CBnYuIwCNLXRNnE1z2NCIQXLdUaSUXKrxAZuRGasQ==`.
  Phase 1's lessons record its provenance: `alejoamiras/ecosystem-tooling` `release.yml` on
  `main`, commit `76199c5933aa8b7a76b31bd66a0687edc64afc24`.

## Step 2 · Review of the rc.1 PrivateFPC (I1)

- **Base.** The 5.0.1 tarball (`npm pack`, integrity `sha512-3a7pDk1y…KRKOzQ==`) reproduces the
  reviewed canonical sha256 `7dd0ff19…8f1b`, so the comparison starts from the artifact reviewed
  for 5.0.1. Its attested commit is `c678a948b284c849f60bbe665aaec4088c4d193d`.
- **ABI.** The raw JSONs were compared with no Aztec code loaded. Both have the same eight
  functions (`balance_of`, `mint`, `mint_and_pay_fee`, `pay_fee`,
  `recurse_subtract_balance_internal`, `offchain_receive`, `sync_state`, `public_dispatch`).
  - Each function keeps its unconstrained flag and custom attributes (`abi_private`, `abi_utility`,
    `abi_public`, `abi_only_self`), its user-level parameters, and every non-protocol return type.
  - The seven `PrivateFPC::<fn>_abi` structs the loader reads are identical.
  - Storage keeps `balances` at slot 1, and the content is byte-identical. rc.1 only names the
    global (`STORAGE_LAYOUT_PrivateFPC`), the same toolchain change Fact 7 records for the account
    artifact.
  - What moved is protocol-owned: the private-context `inputs` parameter and the
    `PrivateCircuitPublicInputs` return struct, plus Noir `1.0.0-beta.22` → `1.0.0-rc.3`.
- **Source.** `c678a948...76199c59` is 11 commits and 155 files, most of them the new
  `quota-paymaster` package and CI. Six touch the contract's build:
  - No `.nr` source of the PrivateFPC changed.
  - Its two `Nargo.toml`s move `aztec` and `balance_set` from
    `AztecProtocol/aztec-packages@v5.0.1` (`noir-projects/aztec-nr/…`) to
    `aztec-labs-eng/aztec-nr@v6.0.0-rc.1`, where aztec-nr now lives.
  - `nargo-deps.lock.json` locks `aztec-nr@v6.0.0-rc.1` at `88ff1ded43051ed5393150799f4308aeda46e94a`
    and `aztec-packages@v6.0.0-rc.1` at `d521f0d9…` (the commit phase 1 verified for the
    `@aztec-foundation/*` attestations). It adds `poseidon` and `sha256` v0.3.0 pins and keeps
    `keccak256` v0.1.3.
  - The rest is nargo-ref tooling.
  - The package's TS fee-payment helpers, which the playground uses, change only by the scope
    rename and by dropping `returnTypes: []` for V6's `returnType`.
- **Verdict: behaviour unchanged.** The contract's own code and user-level interface are
  identical, and the only change is the V6 framework under it. No stop, no codex consult.

## Step 3 · The re-pin

- `protocol-fpcs.test.ts`: the address moves to
  `0x0b3bc795b5c077b57920d590ecc163af18705554abf7164cb0f8c52850943c08` (salt 1, deployer zero), and
  the reviewed sha256 to `7092f28d73832aeff38bb7e4c01e88ee8b9c15993e869d22d73c74d0916f67c6`. The
  runtime-copy equality stays. The address equals the package's own `canonical-deployment.json`
  (`aztecVersion` 6.0.0-rc.1, `expectedAddress` the same), which the publisher's compute script
  asserts, so the two independent derivations agree.
- New pin: `deriveSponsoredFpc()` gives salt zero, deployer zero and
  `0x06a9fa0208c78509921b0487a6b5cd5c2e93baf17de1a18d310f65a3cc1d924b`, the SponsoredFPC Fact 8
  verified deployed and funded on the V6 testnet. Green, so no HOLD.
- **For unleashed:** the canonical PrivateFPC on the V6 line is
  `0x0b3bc795b5c077b57920d590ecc163af18705554abf7164cb0f8c52850943c08`.

## Step 4 and the validation gate (2026-10-01)

- `bun install --frozen-lockfile --force` with no exclude line: exit 0.
- `bun run --cwd apps/extension test src/wallet/services/fpc`: 2 files, 9 tests.
- `typecheck:all` 0; `lint` 0, with the same 28 warnings and 3 infos.
- `bun scripts/aztec-hold-residue-check.ts`: passed, one generation.
- `git grep -n '0.0.0-canary' -- '*package.json' bun.lock`: no hits (exit 1).
- `build:chrome` and `build:firefox`: 0, with no tracked file changed.
