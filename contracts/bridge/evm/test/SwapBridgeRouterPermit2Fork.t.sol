// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {UniswapFuelSwap} from "../src/UniswapFuelSwap.sol";
import {SwapBridgeRouter, IUniswapFuelSwap} from "../src/SwapBridgeRouter.sol";
import {PoolSetupHelper} from "../script/DeployBridge.s.sol";
import {ITokenPortal} from "../src/interfaces/ITokenPortal.sol";
import {IFeeJuicePortal} from "../src/interfaces/IFeeJuicePortal.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

interface IPermit2Domain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// Exposes the router's internal witness hash so the test can build the Permit2 digest
/// the contract will re-derive (cross-pinned to BRIDGE_WITNESS_TYPEHASH by WitnessHash.t.sol).
contract Harness is SwapBridgeRouter {
    constructor(address p2, address fjp, address swap) SwapBridgeRouter(p2, fjp, swap) {}

    function hWitness(BridgeWitness calldata w) external pure returns (bytes32) {
        return _hashBridgeWitness(w);
    }
}

/// Token leg is the canonical TokenPortal (deployed via viem in the sandbox, not Solidity), so
/// it's mocked; the fuel leg's FeeJuicePortal is mocked too. The SWAP (real Uniswap V4) and the
/// PERMIT2 witness-transfer (the #6 surface) are exercised against the REAL forked contracts.
contract MockTokenPortal is ITokenPortal {
    IERC20 public immutable token;
    uint256 public lastAmount;

    constructor(IERC20 _token) {
        token = _token;
    }

    function depositToAztecPublic(bytes32, uint256 amount, bytes32) external override returns (bytes32, uint256) {
        token.transferFrom(msg.sender, address(this), amount);
        lastAmount = amount;
        return (bytes32(uint256(0xABCD)), 0);
    }

    function depositToAztecPrivate(uint256 amount, bytes32) external override returns (bytes32, uint256) {
        token.transferFrom(msg.sender, address(this), amount);
        lastAmount = amount;
        return (bytes32(uint256(0x9012)), 0);
    }
}

contract MockFeeJuicePortal is IFeeJuicePortal {
    IERC20 public immutable fj;
    uint256 public lastAmount;

    constructor(IERC20 _fj) {
        fj = _fj;
    }

    function UNDERLYING() external view override returns (IERC20) {
        return fj;
    }

    function depositToAztecPublic(bytes32, uint256 amount, bytes32) external override returns (bytes32, uint256) {
        fj.transferFrom(msg.sender, address(this), amount);
        lastAmount = amount;
        return (bytes32(uint256(0xFEE)), 0);
    }
}

/// Forks Sepolia and drives the REAL Permit2 + REAL Uniswap V4 through bridgeWithFuel:
/// the happy path (signed witness transfer + swap USDC→…→FeeJuice + bridge) plus the
/// audit #6 cases — nonce replay and signature expiry both revert. Opt-in (skips without
/// SEPOLIA_RPC_URL).
contract SwapBridgeRouterPermit2ForkTest is Test {
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant FEE_JUICE = 0x762C132040fdA6183066Fa3B14d985ee55aA3C18;
    address constant FEE_ASSET_HANDLER = 0x5602c39A6E9C5AcE589F64F754927bcDa4f4BFc9;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant ETH_FJ_SQRT_PRICE = 7922816251426433759354395033600;
    int24 constant ETH_FJ_TICK_LOWER = 69060;
    int24 constant ETH_FJ_TICK_UPPER = 115140;
    uint160 constant USDC_WETH_SQRT_PRICE = 1728916962386276374966316084832192;
    int24 constant USDC_WETH_TICK_LOWER = 169800;
    int24 constant USDC_WETH_TICK_UPPER = 229800;

    bytes32 constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");

    uint256 userPk = 0xA11CE;
    address user;

    MintableERC20 usdc;
    UniswapFuelSwap swap;
    Harness router;
    MockTokenPortal tokenPortal;
    MockFeeJuicePortal fjPortal;
    PoolSetupHelper helper;

    receive() external payable {}

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        user = vm.addr(userPk);

        usdc = new MintableERC20("Nulo USDC", "USDC", 6, 1000);
        require(address(usdc) < WETH, "usdc must sort below WETH");
        swap = new UniswapFuelSwap(POOL_MANAGER, FEE_JUICE, WETH);
        fjPortal = new MockFeeJuicePortal(IERC20(FEE_JUICE));
        tokenPortal = new MockTokenPortal(IERC20(address(usdc)));
        router = new Harness(PERMIT2, address(fjPortal), address(swap));
        helper = new PoolSetupHelper(POOL_MANAGER, FEE_ASSET_HANDLER);

        _seedPools();
    }

    function _seedPools() internal {
        vm.deal(address(this), 2 ether);
        PoolKey memory ethFj = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(FEE_JUICE),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        helper.setup{value: 0.5 ether}(100, ethFj, ETH_FJ_SQRT_PRICE, ETH_FJ_TICK_LOWER, ETH_FJ_TICK_UPPER, 1e18);
        helper.sweep(address(0));
        helper.sweep(FEE_JUICE);

        for (uint256 i = 0; i < 10; i++) {
            usdc.mint(address(helper), usdc.maxMintPerTx());
        }
        deal(WETH, address(helper), 2 ether);
        PoolKey memory usdcWeth = PoolKey({
            currency0: Currency.wrap(address(usdc)),
            currency1: Currency.wrap(WETH),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        helper.setup(0, usdcWeth, USDC_WETH_SQRT_PRICE, USDC_WETH_TICK_LOWER, USDC_WETH_TICK_UPPER, 6e13);
    }

    // Route USDC -> WETH (our pool) -> ETH (unwrap at last boundary) -> FeeJuice (live pool).
    function _route() internal view returns (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) {
        path = new IUniswapFuelSwap.PoolKey[](2);
        path[0] = IUniswapFuelSwap.PoolKey(address(usdc), WETH, FEE, TICK_SPACING, address(0));
        path[1] = IUniswapFuelSwap.PoolKey(address(0), FEE_JUICE, FEE, TICK_SPACING, address(0));
        dirs = new bool[](2);
        dirs[0] = true; // USDC -> WETH
        dirs[1] = true; // ETH  -> FeeJuice
    }

    function _params(bool isPrivate, uint256 nonce, uint256 deadline)
        internal
        view
        returns (SwapBridgeRouter.BridgeParams memory p, SwapBridgeRouter.PermitParams memory permit)
    {
        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _route();
        p = SwapBridgeRouter.BridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(usdc),
            totalAmount: 10e6,
            fuelAmount: 2e6,
            aztecRecipient: bytes32(uint256(0x3333)),
            fuelRecipient: bytes32(uint256(0x4444)),
            tokenSecretHash: bytes32(uint256(0x5555)),
            fuelSecretHash: bytes32(uint256(0x6666)),
            minFuelOutput: 1,
            path: path,
            zeroForOnes: dirs,
            isPrivate: isPrivate
        });
        bytes memory sig = _sign(p, nonce, deadline);
        permit = SwapBridgeRouter.PermitParams({nonce: nonce, deadline: deadline, signature: sig});
    }

    function _sign(SwapBridgeRouter.BridgeParams memory p, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 witnessHash = router.hWitness(
            SwapBridgeRouter.BridgeWitness({
                tokenPortal: p.tokenPortal,
                bridgeToken: p.bridgeToken,
                totalAmount: p.totalAmount,
                fuelAmount: p.fuelAmount,
                aztecRecipient: p.aztecRecipient,
                fuelRecipient: p.fuelRecipient,
                tokenSecretHash: p.tokenSecretHash,
                fuelSecretHash: p.fuelSecretHash,
                minFuelOutput: p.minFuelOutput,
                routeHash: keccak256(abi.encode(p.path, p.zeroForOnes)),
                isPrivate: p.isPrivate,
                swapTarget: address(router.swapTarget())
            })
        );
        bytes32 permitTypehash = keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                router.BRIDGE_WITNESS_TYPE_STRING()
            )
        );
        bytes32 tokenPermissions = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, p.bridgeToken, p.totalAmount));
        bytes32 structHash =
            keccak256(abi.encode(permitTypehash, tokenPermissions, address(router), nonce, deadline, witnessHash));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IPermit2Domain(PERMIT2).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_bridgeWithFuel_realSwapAndPermit2() public {
        usdc.mint(user, 10e6);
        vm.prank(user);
        usdc.approve(PERMIT2, type(uint256).max);

        (SwapBridgeRouter.BridgeParams memory p, SwapBridgeRouter.PermitParams memory permit) =
            _params(false, 0, block.timestamp + 1 hours);

        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        router.bridgeWithFuel(p, permit);

        assertEq(before - usdc.balanceOf(user), 10e6, "pulled totalAmount via Permit2");
        assertEq(tokenPortal.lastAmount(), 8e6, "bridged totalAmount - fuelAmount to the token portal");
        assertGt(fjPortal.lastAmount(), 0, "swapped fuel into FeeJuice + deposited it");
    }

    function test_permit2NonceReplayReverts() public {
        usdc.mint(user, 20e6);
        vm.prank(user);
        usdc.approve(PERMIT2, type(uint256).max);

        (SwapBridgeRouter.BridgeParams memory p, SwapBridgeRouter.PermitParams memory permit) =
            _params(false, 0, block.timestamp + 1 hours);
        vm.prank(user);
        router.bridgeWithFuel(p, permit); // consumes nonce 0

        vm.prank(user);
        vm.expectRevert(); // Permit2 InvalidNonce — the bitmap bit is already set
        router.bridgeWithFuel(p, permit);
    }

    function test_permit2ExpiredDeadlineReverts() public {
        usdc.mint(user, 10e6);
        vm.prank(user);
        usdc.approve(PERMIT2, type(uint256).max);

        (SwapBridgeRouter.BridgeParams memory p, SwapBridgeRouter.PermitParams memory permit) =
            _params(false, 1, block.timestamp - 1); // deadline already passed
        vm.prank(user);
        vm.expectRevert(); // Permit2 SignatureExpired
        router.bridgeWithFuel(p, permit);
    }

    function test_bridgeWithFuelPrivate_realSwap() public {
        usdc.mint(user, 10e6);
        vm.prank(user);
        usdc.approve(PERMIT2, type(uint256).max);

        (SwapBridgeRouter.BridgeParams memory p, SwapBridgeRouter.PermitParams memory permit) =
            _params(true, 0, block.timestamp + 1 hours);
        vm.prank(user);
        router.bridgeWithFuel(p, permit);

        // Private token leg still bridges totalAmount - fuelAmount; the swap still fuels.
        assertEq(tokenPortal.lastAmount(), 8e6, "private: bridged remainder to the token portal");
        assertGt(fjPortal.lastAmount(), 0, "private: swapped fuel into FeeJuice");
    }

    function test_witnessTamperReverts() public {
        usdc.mint(user, 10e6);
        vm.prank(user);
        usdc.approve(PERMIT2, type(uint256).max);

        (SwapBridgeRouter.BridgeParams memory p, SwapBridgeRouter.PermitParams memory permit) =
            _params(false, 0, block.timestamp + 1 hours);
        // Tamper a witness-bound field AFTER signing — the router re-derives the witness from p,
        // so the Permit2 signature no longer matches and the transfer reverts: no relayer can
        // re-aim the funds (recipient/amount/route) after the user signs.
        p.aztecRecipient = bytes32(uint256(0xDEAD));
        vm.prank(user);
        vm.expectRevert();
        router.bridgeWithFuel(p, permit);
    }
}
