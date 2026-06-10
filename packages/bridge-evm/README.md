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

## Status

- ✅ `SwapBridgeRouter.sol` (Permit2 witness-bound `bridgeWithFuel`, keeping `isPrivate`),
  `UniswapFuelSwap.sol` (V4 multi-hop + WETH↔ETH unwrap restricted to the last boundary),
  `MintableERC20.sol` (capped mint), `interfaces/`, `mocks/MockSwapTarget.sol`.
- ✅ **32 forge tests** — unit (`SwapBridgeRouter.t.sol`, `RouteValidation.t.sol`,
  `WitnessHash.t.sol` = the Solidity/Noir/TS content-hash keystone) + **fork**
  (`DeployBridge.fork.t.sol` deploy+seed; `SwapBridgeRouterPermit2Fork.t.sol` drives the
  REAL Uniswap V4 + REAL Permit2 through `bridgeWithFuel`: public, private, nonce-replay,
  expiry, witness-tamper). All codex audit findings addressed.
- 🔒 The canonical `TokenPortal` is deployed via viem from `@aztec/l1-artifacts`
  (`bridge-core/scripts/deploy-sandbox.ts`), not Solidity — fork tests mock that one leg
  while the swap + Permit2 run against the real forked contracts.
- 🔒 Fork tests are opt-in (skip without `SEPOLIA_RPC_URL` in `.env`); a live testnet
  deploy additionally needs a funded `PRIVATE_KEY` (operator infra, not in CI).
