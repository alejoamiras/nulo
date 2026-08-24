# bridge-evm (Foundry)

L1 contracts for the Nulo Faucet→Bridge. Aztec L1 interfaces resolve to the
installed `@aztec/l1-artifacts` 4.2.0 sources via the `@aztec/` remapping in
`foundry.toml` — no `aztec-contracts` submodule needed (the version matches the
repo's pinned `@aztec/* 4.2.0`).

## Dependencies (not committed — see `.gitignore`)

`lib/` is gitignored. Install before building:

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts Uniswap/v4-core@v4.0.0
```

> **v4-core MUST be `@v4.0.0`** (commit `e50237c4…`, matching the holonym reference
> bridge). The fuel contracts (`UniswapFuelSwap.sol`, `DeployBridge.s.sol`'s
> `PoolSetupHelper`) use the pre-1.0 `IPoolManager.SwapParams` / `ModifyLiquidityParams`
> API; v4-core ≥1.0.0 moved those structs to `types/PoolOperation.sol`, so an unpinned
> `Uniswap/v4-core` install pulls latest and fails to compile. forge-std + OZ track
> latest (fine for these contracts).

## Build / test

The `@aztec/` remap resolves through `packages/bridge-core`'s installed
`@aztec/l1-artifacts`. Under the repo's isolated linker that package is NOT at the
repo-root `node_modules` the static `foundry.toml` remap assumes, so generate the
override file first (it is gitignored; `verify-l1.ts` does this automatically):

```bash
bun --cwd packages/bridge-core scripts/gen-remappings.ts   # writes remappings.txt
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

## Value-token hard-blockers (MUST clear before any non-testnet deployment)

This periphery is **testnet-only**. Two things are ratified for testnet but are hard blockers for a
value-bearing deployment — carried forward from the June bridge red-team + the A-1 sign-off:

- **A-1 — on-chain portal-binding is future work (both the bridge-only and fuel-only paths).** The
  router's `bridge(tokenPortal, …)` / `bridgeWithFuel` take the destination portal as a **parameter**;
  fuel-only reuses the same entrypoint pointed at the `FeeJuicePortal`. Nothing on-chain constrains
  which portal a caller may target — a malicious frontend could point a signed Permit2 witness at a
  hostile portal (a **generic-router phishing surface**). On testnet this is contained by the witness
  binding (the portal is inside the signed struct, so the user's wallet shows what they sign) + the
  faucet's hardcoded config. For a value token this MUST be hardened to an **on-chain allowlist of
  permitted portals** (or an immutable portal binding) so a signature can never be steered to an
  attacker-controlled portal. Applies to BOTH paths.
- **INFO-1 — `MintableERC20` is not a value token.** Its `mint` is permissionless (capped per tx) and
  every holder is treated as having granted canonical Permit2 infinite allowance. Faucet-by-design and
  **not** a theft path (Permit2 still needs the holder's signature), but a severe footgun if copied to a
  real asset. A value deployment MUST use a token with access-controlled mint and no forced allowance.
