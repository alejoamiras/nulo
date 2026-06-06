// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {UniswapFuelSwap} from "../src/UniswapFuelSwap.sol";
import {SwapBridgeRouter} from "../src/SwapBridgeRouter.sol";
import {PoolSetupHelper} from "../script/DeployBridge.s.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// Forks Sepolia so the deploy + V4 pool seed run against the REAL PoolManager,
/// WETH, FeeJuice, and the permissionless FeeAssetHandler. Opt-in: skips unless
/// SEPOLIA_RPC_URL is set (forge auto-loads it from .env locally; absent in CI).
contract DeployBridgeForkTest is Test {
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant FEE_JUICE = 0x762C132040fdA6183066Fa3B14d985ee55aA3C18;
    address constant FEE_ASSET_HANDLER = 0x5602c39A6E9C5AcE589F64F754927bcDa4f4BFc9;
    address constant FEE_JUICE_PORTAL = 0xd3361019E40026ce8a9745c19e67Fd3ACC10d596;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant ETH_FJ_SQRT_PRICE = 7922816251426433759354395033600;
    int24 constant ETH_FJ_TICK_LOWER = 69060;
    int24 constant ETH_FJ_TICK_UPPER = 115140;

    receive() external payable {} // accept ETH swept back from the helper

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
    }

    function test_deployWiringAndSeedEthFeeJuicePool() public {
        vm.deal(address(this), 2 ether);

        MintableERC20 usdc = new MintableERC20("Nulo USDC", "USDC", 6, 1000);
        UniswapFuelSwap swap = new UniswapFuelSwap(POOL_MANAGER, FEE_JUICE, WETH);
        SwapBridgeRouter router = new SwapBridgeRouter(PERMIT2, FEE_JUICE_PORTAL, address(swap));
        PoolSetupHelper helper = new PoolSetupHelper(POOL_MANAGER, FEE_ASSET_HANDLER);

        // Wiring assertions (public immutables).
        assertEq(address(router.swapTarget()), address(swap), "router.swapTarget");
        assertEq(address(router.feeJuicePortal()), FEE_JUICE_PORTAL, "router.feeJuicePortal");
        assertEq(address(router.permit2()), PERMIT2, "router.permit2");
        assertEq(usdc.decimals(), 6, "usdc decimals");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(FEE_JUICE),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        // 100 mints = 100k FJ; seed 0.5 ETH at 1e18 liquidity (reference params).
        // The pool already exists live (Holonym seeded it), so initialize no-ops
        // and modifyLiquidity adds to it — the add can be single-sided depending
        // on the live price, so we assert the helper PROVIDED liquidity (consumed
        // ETH and/or FJ) rather than checking the PoolManager's aggregate balance.
        helper.setup{value: 0.5 ether}(100, key, ETH_FJ_SQRT_PRICE, ETH_FJ_TICK_LOWER, ETH_FJ_TICK_UPPER, 1e18);

        uint256 helperFj = IERC20(FEE_JUICE).balanceOf(address(helper)); // 100k FJ minus deposited
        uint256 helperEth = address(helper).balance; // 0.5 ETH minus deposited
        assertTrue(helperFj < 100_000 ether || helperEth < 0.5 ether, "seed provided liquidity");

        // Sweep returns leftovers to the deployer (no stranded balance).
        helper.sweep(address(0));
        helper.sweep(FEE_JUICE);
        assertEq(IERC20(FEE_JUICE).balanceOf(address(helper)), 0, "helper FJ swept");
        assertEq(address(helper).balance, 0, "helper ETH swept");
    }
}
