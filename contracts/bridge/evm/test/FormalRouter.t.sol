// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {SwapBridgeRouter, IUniswapFuelSwap} from "../src/SwapBridgeRouter.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {RecordingPermit2, MockSwap, MockTokenPortal, MockFeeJuicePortal} from "./BlackhatAudit.t.sol";

/// SYMBOLIC checks (run with `halmos`, not forge): function arguments are symbolic, so each
/// check proves its property over the WHOLE input domain, not sampled points like fuzzing.
///
///   check_bridge_conservesUserFunds          — plain bridge: exact-in, exact-deposit, zero residue
///   check_bridgeWithFuel_conservesUserFunds  — fueled bridge: split accounting holds for ANY split
///   check_sweep_and_setSwapTarget_areOwnerOnly — authority boundaries
///
/// Threat model note: Permit2 is a success-always mock (signature validity is Permit2's own
/// domain, pinned by the real-fork tests), and the swap target is the HONEST mock (reports ==
/// transfers, consumes exactly its input). The properties proven are the router's OWN
/// accounting guarantees under those semantics.
contract FormalRouterTest is Test {
    MintableERC20 usdc;
    MintableERC20 fj;
    RecordingPermit2 permit2;
    MockSwap swap;
    MockTokenPortal tokenPortal;
    MockFeeJuicePortal feePortal;
    SwapBridgeRouter router;

    address constant USER = address(0xDA0);
    bytes32 constant RECIPIENT = bytes32(uint256(0x1234));
    bytes32 constant FUEL_RECIPIENT = bytes32(uint256(0x5678));
    bytes32 constant SECRET = bytes32(uint256(0x5EC7E7));

    uint256 constant USER_BALANCE = 1_000_000 * 1e6;

    function setUp() public {
        usdc = new MintableERC20("USDC", "USDC", 6, 1_000_000_000);
        fj = new MintableERC20("FeeJuice", "FJ", 18, 1_000_000_000);
        permit2 = new RecordingPermit2();
        swap = new MockSwap(IERC20(address(fj)));
        tokenPortal = new MockTokenPortal(IERC20(address(usdc)));
        feePortal = new MockFeeJuicePortal(IERC20(address(fj)));
        router = new SwapBridgeRouter(address(permit2), address(feePortal), address(swap));

        usdc.mint(USER, USER_BALANCE);
        fj.mint(address(swap), 100_000 ether);
        vm.prank(USER);
        usdc.approve(address(permit2), type(uint256).max);
        swap.setOutput(1 ether, 0);
    }

    function _route() internal pure returns (IUniswapFuelSwap.PoolKey[] memory p, bool[] memory d) {
        p = new IUniswapFuelSwap.PoolKey[](1);
        p[0] = IUniswapFuelSwap.PoolKey(address(0), address(0), 3000, 60, address(0));
        d = new bool[](1);
        d[0] = true;
    }

    function _permit() internal returns (SwapBridgeRouter.PermitParams memory) {
        return SwapBridgeRouter.PermitParams({nonce: 1, deadline: type(uint256).max, signature: hex"00"});
    }

    /// For ANY amount the user can afford, a plain bridge moves EXACTLY that amount to the
    /// portal, leaves NOTHING in the router, and takes nothing else from the user.
    function check_bridge_conservesUserFunds(uint128 amountRaw) public {
        uint256 amount = bound(uint256(amountRaw), 1, USER_BALANCE);

        uint256 userBefore = usdc.balanceOf(USER);
        uint256 portalBefore = usdc.balanceOf(address(tokenPortal));

        vm.prank(USER);
        router.bridge(
            SwapBridgeRouter.SimpleBridgeParams({
                tokenPortal: address(tokenPortal),
                bridgeToken: address(usdc),
                amount: amount,
                aztecRecipient: RECIPIENT,
                secretHash: SECRET,
                isPrivate: false
            }),
            _permit()
        );

        assertEq(usdc.balanceOf(USER), userBefore - amount, "user delta != amount");
        assertEq(usdc.balanceOf(address(tokenPortal)) - portalBefore, amount, "portal deposit != amount");
        assertEq(usdc.balanceOf(address(router)), 0, "router retained tokens");
    }

    /// For ANY affordable total and ANY valid fuel split, the fueled bridge deposits
    /// total−fuel to the token portal, swaps exactly fuel through the target, lands the
    /// reported output in the fee portal, and strands nothing anywhere.
    function check_bridgeWithFuel_conservesUserFunds(uint128 totalRaw, uint128 fuelRaw) public {
        uint256 total = bound(uint256(totalRaw), 2, USER_BALANCE);
        uint256 fuel = bound(uint256(fuelRaw), 1, total - 1);

        uint256 userBefore = usdc.balanceOf(USER);
        uint256 portalBefore = usdc.balanceOf(address(tokenPortal));
        uint256 feePortalBefore = fj.balanceOf(address(feePortal));

        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _route();
        vm.prank(USER);
        router.bridgeWithFuel(
            SwapBridgeRouter.BridgeParams({
                tokenPortal: address(tokenPortal),
                bridgeToken: address(usdc),
                totalAmount: total,
                fuelAmount: fuel,
                aztecRecipient: RECIPIENT,
                fuelRecipient: FUEL_RECIPIENT,
                tokenSecretHash: SECRET,
                fuelSecretHash: SECRET,
                minFuelOutput: 1 ether,
                path: path,
                zeroForOnes: dirs,
                isPrivate: false
            }),
            _permit()
        );

        assertEq(usdc.balanceOf(USER), userBefore - total, "user delta != total");
        assertEq(usdc.balanceOf(address(tokenPortal)) - portalBefore, total - fuel, "token leg != total - fuel");
        assertEq(fj.balanceOf(address(feePortal)) - feePortalBefore, 1 ether, "fuel leg != reported output");
        assertEq(usdc.balanceOf(address(router)), 0, "router retained bridge token");
        assertEq(fj.balanceOf(address(router)), 0, "router retained fee juice");
    }

    /// Authority boundary: sweep is unreachable for any non-owner, and a failed attempt
    /// mutates nothing. (try/catch, not vm.expectRevert — halmos does not support the latter.)
    function check_sweep_revertsForNonOwner(address caller) public {
        vm.assume(caller != router.owner());
        usdc.mint(address(router), 5 * 1e6);
        uint256 balBefore = usdc.balanceOf(address(router));
        vm.prank(caller);
        try router.sweep(address(usdc), caller) {
            revert("sweep succeeded for a non-owner");
        } catch {
            assertEq(usdc.balanceOf(address(router)), balBefore, "rejected sweep mutated state");
        }
    }

    /// Authority boundary: swap-target rotation is unreachable for any non-owner.
    function check_setSwapTarget_revertsForNonOwner(address caller) public {
        vm.assume(caller != router.owner());
        MockSwap next = new MockSwap(IERC20(address(fj)));
        vm.prank(caller);
        try router.setSwapTarget(address(next)) {
            revert("setSwapTarget succeeded for a non-owner");
        } catch {
            assertTrue(true);
        }
    }
}
