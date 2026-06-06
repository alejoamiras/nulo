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

## Next (authoring — live-net-independent, validatable with mocks)
- `SwapBridgeRouter` (strip attestation, keep `isPrivate`) + mock-based forge tests (reuse the reference's MockPermit2/MockSwap/MockPortal pattern).
- Canonical-`TokenPortal` deploy script (authored; running it is operator-gated).

## Operator-gated (NOT runnable in sandbox)
- Actual on-chain **deploys** (Sepolia deployer key) + L2 token redeploy behind `token_minter_proxy` + V4 pool seeding (`FeeAssetHandler.mint` × N for ~1000 FJ each).
