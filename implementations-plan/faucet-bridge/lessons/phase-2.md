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

## Deploy (P2 deploy orchestration — ✅ L1 layer fork-validated)
- ✅ `script/DeployBridge.s.sol` — deploys MintableERC20 (our USDC) + UniswapFuelSwap + SwapBridgeRouter; seeds the ETH/feeJuice + USDC/WETH V4 pools via the generic `PoolSetupHelper` (FeeAssetHandler.mint × N + unlock/modifyLiquidity/settle). Adapted from the Human-Tech deploy, minus the trusted-forwarder.
- ✅ `test/DeployBridge.fork.t.sol` — forks Sepolia (opt-in via `SEPOLIA_RPC_URL`; skips in CI) and runs the WHOLE deploy + both pool seeds against the **real PoolManager `0xE03A1074…` + the permissionless FeeAssetHandler**. **25 forge tests green.** Validates the L1 deploy/seed end-to-end without a broadcast.
- **Currency ordering:** `require(usdc < WETH)` — WETH `0xfFf9…` is near the top of the address space, so a CREATE-deployed token sorts below it ~always → USDC=currency0, reuse the reference price/ticks. The ETH/feeJuice pool already exists live (initialize no-ops, add can be single-sided); USDC/WETH is new (our token → initialize creates it, PM gains our USDC).
- Test gotcha: a Foundry `Test` contract needs `receive() external payable {}` to accept ETH swept back by the helper.

## Next
- TokenPortal + L2 token/bridge deploy via aztec.js (task #4); swap-path integration test (USDC→WETH→ETH→feeJuice through the router) alongside the bridge-core l1 layer (task #3); local sandbox harness (task #2).

## Gotcha
- Don't write `@aztec/...` inside `///`/`/** */` NatSpec — solc parses `@aztec` as a doc tag ("Documentation tag ... not valid"). Use "aztec" without the `@` in prose comments.

## Operator-gated (the live broadcast only — deploy LOGIC is fork-validated)
- The live-net **broadcast** of DeployBridge + the L2 deploys. The deployer key is now wired (`bridge-evm/.env`, `0xFcc2…`, 0.187 ETH). The deploy + seed logic itself is proven by the Sepolia fork test, so the broadcast is a mechanical step, not a risk.
