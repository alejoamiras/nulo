// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

// [F-G] BLACKHAT PoC — UniswapFuelSwap settlement vs route shapes, proven against the REAL
// Sepolia V4 PoolManager (deployed bytecode; no v4-core source import → no solc pin clash).
//
// HISTORY: pre-fix, the route [{X/native}, {native/FJ}] passed _validateRoute (the mid-path
// native hop looks "continuous": outI == inNext == address(0)) but Case-C settlement took WETH
// against a NATIVE-ETH delta — the swap always reverted. The delta-driven settlement fix makes
// the shape execute CORRECTLY: mid-path native deltas net to zero and need no transfer, so the
// swap is exact-in/exact-out with no residue. These tests pin that behavior on the real PM.

import {Test} from "forge-std/Test.sol";
import {UniswapFuelSwap} from "../src/UniswapFuelSwap.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

// Uniswap V4 PoolManager on Sepolia (same deployment the bridge rides).
address constant CANONICAL_PM = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

contract MinimalWETH {
    string public name = "WETH";
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[t] += a;
        return true;
    }

    function withdraw(uint256 a) external {
        balanceOf[msg.sender] -= a;
        (bool ok,) = msg.sender.call{value: a}("");
        require(ok);
    }
}

contract V4Seeder is IUnlockCallback {
    IPoolManager public immutable pm;
    bytes public lastErr;
    bool public lastOk;

    constructor(IPoolManager _pm) {
        pm = _pm;
    }

    receive() external payable {}

    function seed(PoolKey calldata key, int24 lower, int24 upper, int256 liquidity) external payable {
        // Mirror DeployBridge.s.sol's PoolSetupHelper exactly: initialize (idempotent) then unlock.
        try pm.initialize(key, TickMath.getSqrtPriceAtTick(0)) returns (int24) {} catch {}
        pm.unlock(abi.encode(key, lower, upper, liquidity));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm));
        (PoolKey memory key, int24 lower, int24 upper, int256 liquidity) =
            abi.decode(data, (PoolKey, int24, int24, int256));
        (BalanceDelta delta,) = pm.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: liquidity, salt: 0}),
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

    function _pay(Currency c, uint256 owed) internal {
        if (Currency.unwrap(c) == address(0)) {
            pm.settle{value: owed}();
        } else {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(pm), owed);
            pm.settle();
        }
    }
}

/// Exposes UniswapFuelSwap._validateRoute for direct probing.
contract SwapHarness is UniswapFuelSwap {
    constructor(address pm, address fj, address weth_) UniswapFuelSwap(pm, fj, weth_) {}

    function exposeValidate(address inputToken, PoolKey[] calldata path, bool[] calldata dirs) external view {
        _validateRoute(inputToken, path, dirs);
    }
}

contract BlackhatV4ForkTest is Test {
    MintableERC20 tokenX;
    MintableERC20 mockFj;
    MinimalWETH weth;
    IPoolManager pm;
    UniswapFuelSwap fuelSwap;
    SwapHarness harness;
    V4Seeder seeder;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        pm = IPoolManager(CANONICAL_PM);
        tokenX = new MintableERC20("X", "X", 18, 1_000_000_000);
        mockFj = new MintableERC20("FJ", "FJ", 18, 1_000_000_000);
        weth = new MinimalWETH();
        fuelSwap = new UniswapFuelSwap(address(pm), address(mockFj), address(weth));
        harness = new SwapHarness(address(pm), address(mockFj), address(weth));
        seeder = new V4Seeder(pm);

        // Pool A: native ETH / X — selling X means zeroForOne=false (X is currency1).
        PoolKey memory poolA = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(tokenX)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        // Pool B: native ETH / FJ — selling native means zeroForOne=true.
        PoolKey memory poolB = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(mockFj)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        // Depth budget: y_depth ~= L * dSqrtP / 2^96; L=1e24 -> ~8.2e23 wei per side.
        tokenX.mint(address(seeder), 1_000_000_000 ether);
        mockFj.mint(address(seeder), 1_000_000_000 ether);
        vm.deal(address(seeder), 1_000_000 ether);
        seeder.seed(poolA, -12_000, 12_000, 1e24);
        seeder.seed(poolB, -12_000, 12_000, 1e24);
    }

    function _hostilePath() internal view returns (PoolKey[] memory path, bool[] memory dirs) {
        path = new PoolKey[](2);
        path[0] = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(tokenX)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        path[1] = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(mockFj)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        dirs = new bool[](2);
        dirs[0] = false; // sell X (currency1 of pool A)
        dirs[1] = true; // sell native (currency0 of pool B)
    }

    /// THE GAP: validation ACCEPTS the unexecutable route.
    function test_FG_validationAcceptsUnsettleableRoute() public view {
        (PoolKey[] memory path, bool[] memory dirs) = _hostilePath();
        harness.exposeValidate(address(tokenX), path, dirs); // no revert = accepted
    }

    /// Post-fix, the previously-hostile shape SETTLES EXACTLY: X in → FJ out, nothing stranded.
    function test_FG_midNativeRouteSettlesExactly() public {
        (PoolKey[] memory path, bool[] memory dirs) = _hostilePath();
        tokenX.mint(address(this), 100 ether);
        tokenX.approve(address(fuelSwap), 100 ether);
        uint256 fjBefore = mockFj.balanceOf(address(this));
        uint256 xBefore = tokenX.balanceOf(address(this));
        uint256 out = fuelSwap.swap(address(tokenX), 100 ether, 1 wei, path, dirs);
        assertGt(out, 0, "route must produce output");
        assertEq(mockFj.balanceOf(address(this)) - fjBefore, out, "caller receives exactly the reported output");
        assertEq(tokenX.balanceOf(address(this)), xBefore - 100 ether, "caller paid exactly the input");
        // No residue anywhere: the swap contract must hold zero of every touched asset.
        assertEq(tokenX.balanceOf(address(fuelSwap)), 0, "no X dust in the swap contract");
        assertEq(mockFj.balanceOf(address(fuelSwap)), 0, "no FJ dust in the swap contract");
        assertEq(address(fuelSwap).balance, 0, "no ETH dust in the swap contract");
    }

/// Sanity: a LEGIT all-native-final route (single-hop WETH→native→FJ) still works on the
    /// canonical PM — proving the harness itself is sound and only the hostile shape fails.
    function test_FG_sanity_legitSingleHopNativeRouteExecutes() public {
        PoolKey[] memory path = new PoolKey[](1);
        path[0] = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(mockFj)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        bool[] memory dirs = new bool[](1);
        dirs[0] = true; // sell native for FJ

        weth.deposit{value: 10 ether}();
        weth.approve(address(fuelSwap), 10 ether);
        uint256 out = fuelSwap.swap(address(weth), 10 ether, 1 wei, path, dirs);
        assertGt(out, 0, "legit native route must execute");
        assertEq(mockFj.balanceOf(address(this)), out, "caller receives FJ");
    }
}

contract RawSwapper is IUnlockCallback {
    IPoolManager public immutable pm;

    constructor(IPoolManager _pm) {
        pm = _pm;
    }

    receive() external payable {}

    function go(PoolKey calldata key, bool zeroForOne, uint256 amt) external returns (int128 o0, int128 o1) {
        bytes memory ret = pm.unlock(abi.encode(key, zeroForOne, amt));
        (o0, o1) = abi.decode(ret, (int128, int128));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm));
        (PoolKey memory key, bool zfo, uint256 amt) = abi.decode(data, (PoolKey, bool, uint256));
        BalanceDelta delta = pm.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zfo,
                amountSpecified: -int256(amt),
                sqrtPriceLimitX96: zfo ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        if (d0 < 0) _pay(key.currency0, uint256(uint128(-d0)));
        if (d1 < 0) _pay(key.currency1, uint256(uint128(-d1)));
        if (d0 > 0) pm.take(key.currency0, address(this), uint256(uint128(d0)));
        if (d1 > 0) pm.take(key.currency1, address(this), uint256(uint128(d1)));
        return abi.encode(d0, d1);
    }

    function _pay(Currency c, uint256 owed) internal {
        if (Currency.unwrap(c) == address(0)) {
            pm.settle{value: owed}();
        } else {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(pm), owed);
            pm.settle();
        }
    }

    function fund(Currency c, uint256 amt) external {
        if (Currency.unwrap(c) != address(0)) {
            IERC20(Currency.unwrap(c)).transfer(address(pm), amt);
            pm.sync(c);
            pm.settle();
        } else {
            pm.settle{value: amt}();
        }
    }
}
