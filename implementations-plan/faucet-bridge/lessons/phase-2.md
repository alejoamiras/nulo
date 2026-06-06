# Phase 2 — L1 contracts (canonical portal + router + faucet token)

**Status:** IN PROGRESS (unblocked by the P1 recon GO — real addresses known, see `research/recon-testnet.md`).

## Approach (R2-informed)
- **TokenPortal:** deploy an INSTANCE of the canonical `@aztec/l1-artifacts` `TokenPortal` (do NOT hand-roll) — `initialize(registry=0xa0bf…, underlying=<MintableERC20>, l2Bridge=<token_bridge>)`. ABI-compatible by lineage; the keystone already pins the content-hashes.
- **SwapBridgeRouter:** adapt from the reference minus the attestation params; KEEP `isPrivate` (witness + branch) wired to the clean `depositToAztecPrivate`.
- **MintableERC20:** new (capped permissionless mint + Permit2 `allowance()` pre-approve).
- **UniswapFuelSwap:** add `hooks == address(0)` + hop-continuity to `_validateRoute` (R2 mandatory edit).

## Done
- ✅ `MintableERC20.sol` + 7 forge tests (cap enforcement at/over, permissionless, Permit2 pre-approve for every holder, non-Permit2 allowance normal, decimals).
- ✅ `UniswapFuelSwap._validateRoute` hardened (R2 mandatory): every hop must be hookless (`hooks==address(0)`) + hop-continuity (each hop's output feeds the next input; the WETH<->native-ETH unwrap is the one allowed discontinuity). 6 forge tests (single/two-hop pass, hooks rejected, discontinuity rejected, native-unwrap passes, last-hop-must-be-FJ). `forge test` green (16 total incl. keystone + MintableERC20).

- ✅ `SwapBridgeRouter.sol` authored — attestation stripped, `isPrivate` KEPT + witness-bound (private branch → clean `depositToAztecPrivate(amount, secretHash)`; public → `depositToAztecPublic`). Keeps the witness machinery, `forceApprove`-to-zero, the `UNDERLYING()` readback + balance-mismatch guard, sweep, `setSwapTarget`. Uses **local minimal `IFeeJuicePortal`/`ITokenPortal` interfaces** — pulling the deep aztec l1-artifacts source tree hit missing remappings (`@aztec-blob-lib`) + solc allowed-dirs (the `../../node_modules` remapping escapes the Foundry root). `forge build` green; the 16 existing tests still pass.

- ✅ `SwapBridgeRouter` mock tests: 8 (bridgeWithFuel + bridge × public/private, balance-mismatch guard, Permit2 rejection, invalid-fuelAmount, sweep-onlyOwner) via inline MockPermit2/MockSwap/MockTokenPortal/MockFeeJuicePortal. **24 forge tests total** (keystone 3 + MintableERC20 7 + RouteValidation 6 + SwapBridgeRouter 8).

## Next (authoring — live-net-independent)
- Canonical-`TokenPortal` deploy script (`forge script` that deploys a TokenPortal instance + `initialize(registry, underlying, l2Bridge)` + the router/swap wiring). Authorable; running it is operator-gated (Sepolia deployer key). After it, the P2 contract layer is complete (on-chain deploy is the operator step).

## Gotcha
- Don't write `@aztec/...` inside `///`/`/** */` NatSpec — solc parses `@aztec` as a doc tag ("Documentation tag ... not valid"). Use "aztec" without the `@` in prose comments.

## Operator-gated (NOT runnable in sandbox)
- Actual on-chain **deploys** (Sepolia deployer key) + L2 token redeploy behind `token_minter_proxy` + V4 pool seeding (`FeeAssetHandler.mint` × N for ~1000 FJ each).
