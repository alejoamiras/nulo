// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import "forge-std/Script.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {UniswapFuelSwap} from "../src/UniswapFuelSwap.sol";
import {SwapBridgeRouter} from "../src/SwapBridgeRouter.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@oz/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

interface IFeeAssetHandler {
    function mint(address) external;
}

interface IWETH {
    function deposit() external payable;
}

/**
 * @notice V4 pool seeder (generic): batch-mints FeeJuice via the permissionless
 *         FeeAssetHandler, initializes a pool (idempotent), seeds liquidity through
 *         the PoolManager.unlock callback, and sweeps leftovers. Verbatim pattern
 *         from the Human-Tech bridge — it's asset-agnostic.
 */
contract PoolSetupHelper is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable pm;
    address public immutable feeAssetHandler;
    address public immutable deployer;

    constructor(address _pm, address _feeAssetHandler) {
        pm = IPoolManager(_pm);
        feeAssetHandler = _feeAssetHandler;
        deployer = msg.sender;
    }

    receive() external payable {}

    function setup(
        uint256 mintCount,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external payable {
        require(msg.sender == deployer, "not deployer");
        for (uint256 i = 0; i < mintCount; i++) {
            IFeeAssetHandler(feeAssetHandler).mint(address(this));
        }
        try pm.initialize(key, sqrtPriceX96) returns (int24) {} catch {}
        pm.unlock(abi.encode(key, tickLower, tickUpper, liquidityDelta));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(pm), "only pm");
        (PoolKey memory key, int24 tickLower, int24 tickUpper, int256 liquidityDelta) =
            abi.decode(data, (PoolKey, int24, int24, int256));

        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );

        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        if (d0 < 0) _pay(key.currency0, uint256(uint128(-d0)));
        if (d1 < 0) _pay(key.currency1, uint256(uint128(-d1)));
        if (d0 > 0) pm.take(key.currency0, address(this), uint256(uint128(d0)));
        if (d1 > 0) pm.take(key.currency1, address(this), uint256(uint128(d1)));
        return "";
    }

    function _pay(Currency currency, uint256 owed) internal {
        if (Currency.unwrap(currency) == address(0)) {
            pm.settle{value: owed}();
        } else {
            pm.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(pm), owed);
            pm.settle();
        }
    }

    function sweep(address token) external {
        require(msg.sender == deployer, "not deployer");
        if (token == address(0)) {
            uint256 bal = address(this).balance;
            if (bal > 0) payable(deployer).transfer(bal);
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) IERC20(token).safeTransfer(deployer, bal);
        }
    }
}

/**
 * @notice Deploys the Nulo bridge EVM layer + seeds V4 pools.
 *
 *   1. MintableERC20 — OUR faucet USDC (the SAME asset bridged + fauceted on L2)
 *   2. UniswapFuelSwap(PoolManager, feeJuice, WETH)
 *   3. SwapBridgeRouter(Permit2, feeJuicePortal, swap)
 *   4. Pools: ETH/feeJuice (native) + USDC/WETH, so the fuel slice routes
 *      USDC→WETH→(unwrap)→ETH→feeJuice or ETH→feeJuice directly.
 *
 * The canonical TokenPortal + the L2 token/bridge are deployed by the aztec.js
 * script (it owns the portal init + L2 wiring); this script logs the addresses
 * that script consumes. Run against Sepolia or `anvil --fork-url $SEPOLIA_RPC_URL`.
 */
contract DeployBridge is Script {
    using SafeERC20 for IERC20;

    // ── Sepolia canonical addresses (from research/recon-testnet.md) ──
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant FEE_JUICE = 0x762C132040fdA6183066Fa3B14d985ee55aA3C18;
    address constant FEE_ASSET_HANDLER = 0x5602c39A6E9C5AcE589F64F754927bcDa4f4BFc9;
    address constant FEE_JUICE_PORTAL = 0x7C4176bFF969c9417e42F9CB921100145911CC84;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // ── ETH/feeJuice pool (~10,000 FJ per ETH), from the reference ────
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant ETH_FJ_SQRT_PRICE = 7922816251426433759354395033600;
    int24 constant ETH_FJ_TICK_LOWER = 69060;
    int24 constant ETH_FJ_TICK_UPPER = 115140;

    // ── USDC/WETH pool (~2,100 USDC per WETH), currency0=USDC(6dec) < WETH ──
    uint160 constant USDC_WETH_SQRT_PRICE = 1728916962386276374966316084832192;
    int24 constant USDC_WETH_TICK_LOWER = 169800;
    int24 constant USDC_WETH_TICK_UPPER = 229800;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 mintCount = vm.envOr("FEE_MINT_COUNT", uint256(100));
        uint256 ethSeed = vm.envOr("ETH_SEED", uint256(0.5 ether));
        int256 ethFjLiquidity = int256(vm.envOr("ETH_FJ_LIQUIDITY", uint256(1e18)));

        vm.startBroadcast(pk);

        MintableERC20 usdc = new MintableERC20("Nulo USDC", "USDC", 6, 1000);
        console.log("MintableERC20 (USDC):", address(usdc));

        UniswapFuelSwap swap = new UniswapFuelSwap(POOL_MANAGER, FEE_JUICE, WETH);
        console.log("UniswapFuelSwap:", address(swap));

        SwapBridgeRouter router = new SwapBridgeRouter(PERMIT2, FEE_JUICE_PORTAL, address(swap));
        console.log("SwapBridgeRouter:", address(router));

        PoolSetupHelper helper = new PoolSetupHelper(POOL_MANAGER, FEE_ASSET_HANDLER);
        console.log("PoolSetupHelper:", address(helper));

        // ETH/feeJuice pool (native ETH = currency0 since address(0) < any token).
        PoolKey memory ethFjKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(FEE_JUICE),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        helper.setup{value: ethSeed}(mintCount, ethFjKey, ETH_FJ_SQRT_PRICE, ETH_FJ_TICK_LOWER, ETH_FJ_TICK_UPPER, ethFjLiquidity);
        console.log("ETH/feeJuice pool seeded");

        helper.sweep(address(0));
        helper.sweep(FEE_JUICE);

        // ── USDC/WETH pool (new pool — our token, so initialize creates it) ──
        // WETH (0xfFf9…) sits near the top of the address space, so a CREATE-
        // deployed token is below it with overwhelming probability → USDC is
        // currency0, matching the reference orientation. Bump the deployer nonce
        // on the rare miss.
        require(address(usdc) < WETH, "USDC must sort below WETH (currency0)");
        uint256 wethSeed = vm.envOr("WETH_SEED", uint256(2 ether));
        int256 usdcWethLiquidity = int256(vm.envOr("USDC_WETH_LIQUIDITY", uint256(6e13)));

        // Over-provision the helper (10k USDC); modifyLiquidity takes what it needs, rest swept.
        for (uint256 i = 0; i < 10; i++) usdc.mint(address(helper), usdc.maxMintPerTx());
        IWETH(WETH).deposit{value: wethSeed}();
        IERC20(WETH).safeTransfer(address(helper), wethSeed);

        PoolKey memory usdcWethKey = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(WETH),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        helper.setup(0, usdcWethKey, USDC_WETH_SQRT_PRICE, USDC_WETH_TICK_LOWER, USDC_WETH_TICK_UPPER, usdcWethLiquidity);
        console.log("USDC/WETH pool seeded");

        helper.sweep(address(usdc));
        helper.sweep(WETH);

        vm.stopBroadcast();
    }
}
