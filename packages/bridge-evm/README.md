# bridge-evm (Foundry)

L1 contracts for the Nulo Faucet→Bridge. Aztec L1 interfaces resolve to the
installed `@aztec/l1-artifacts` 4.2.0 sources via the `@aztec/` remapping in
`foundry.toml` — no `aztec-contracts` submodule needed (the version matches the
repo's pinned `@aztec/* 4.2.0`).

## Dependencies (not committed — see `.gitignore`)

`lib/` is gitignored. Install before building:

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts Uniswap/v4-core
```

> Follow-up: pin exact versions (these were vendored from the reference bridge
> for the initial scaffold). Decide submodules vs vendored-and-committed for CI.

## Build / test

```bash
forge build
forge test
```

## Status (P1 in progress)

- ✅ Scaffold + `UniswapFuelSwap.sol` + `interfaces/{ISignatureTransfer,ITokenPortal}.sol`
  copied verbatim from the reference and **compiling** (`forge build` green).
- ⏳ Pending: deploy an instance of the **canonical `TokenPortal`** (from
  `@aztec/l1-artifacts` — do NOT hand-roll; it already ships the clean
  public/private/withdraw-by-Epoch interface), `SwapBridgeRouter` (minus the
  `isPrivate`-attestation coupling, keeping the `isPrivate` witness for private
  token bridging per the full-parity decision), `MintableERC20` (capped mint +
  Permit2 `allowance()` pre-approve), seed scripts, and the **keystone
  content-hash equality test** (Solidity vs Noir — the one guard the TXE can't
  provide). See `implementations-plan/faucet-bridge/plan.md` P1–P2.
- 🔒 Live-net steps (recon `getNodeInfo` go/no-go, deploys, network e2e) need a
  testnet node URL + Sepolia deployer key (operator infra) — not runnable in CI/sandbox.
