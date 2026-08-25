// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Vm} from "forge-std/Vm.sol";
import {SwapBridgeRouter, IUniswapFuelSwap} from "../src/SwapBridgeRouter.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {RecordingPermit2, MockSwap, MockTokenPortal, MockFeeJuicePortal} from "./BlackhatAudit.t.sol";

/// Cross-call INVARIANT suite for SwapBridgeRouter: a handler drives randomized
/// bridge/bridgeWithFuel/donate/sweep/rotate sequences and the suite asserts state that must
/// hold after EVERY sequence:
///
///   I1  The router holds NOTHING beyond attacker donations (per token).
///   I2  Conservation: every wei Permit2-pulled is accounted as fuel-swap input OR portal
///       deposit — no third destination exists.
///   I3  The fee portal received exactly what the swaps reported.
contract SwapBridgeRouterInvariantTest is Test {
    RouterHandler internal handler;

    function setUp() public {
        handler = new RouterHandler();
        // Foundry calls ONLY the handler during runs; the invariants read through it.
        targetContract(address(handler));
    }

    /// I1 — donations are the only residue a hostile observer can create.
    function invariant_routerHoldsNothingBeyondDonations() public view {
        assertEq(handler.routerUsdc(), handler.ghostDonatedUsdc() - handler.ghostSweptUsdc(), "usdc residue != donations");
        assertEq(handler.routerFj(), handler.ghostDonatedFj() - handler.ghostSweptFj(), "fj residue != donations");
    }

    /// I2 — pull-side conservation measured against OBSERVED sinks (not ghost bookkeeping):
    /// every wei Permit2 pulled must sit at a real sink (token portal | swap target), and the
    /// fee portal must hold exactly what swaps reported.
    function invariant_pulledIsFullyAccounted() public view {
        assertEq(handler.tokenPortalBalance(), handler.ghostTokenDeposited(), "token portal != cumulative deposits");
        assertEq(handler.swapTargetBalance(), handler.ghostFuelSwapped(), "swap target != cumulative fuel slices");
    }

    /// I3 — reported swap output == what actually landed in the fee portal.
    function invariant_feePortalReceivedExactlyReportedOutput() public view {
        assertEq(handler.feePortalBalance(), handler.ghostFjOut(), "fee portal balance != cumulative reported output");
    }
}

contract RouterHandler is StdUtils {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MintableERC20 public usdc;
    MintableERC20 public fj;
    RecordingPermit2 public permit2;
    MockSwap public swap;
    MockTokenPortal public tokenPortal;
    MockFeeJuicePortal public feePortal;
    SwapBridgeRouter public router;

    address public immutable user;

    uint256 public ghostDonatedUsdc;
    uint256 public ghostDonatedFj;
    uint256 public ghostSweptUsdc;
    uint256 public ghostSweptFj;
    uint256 public ghostPulled;
    uint256 public ghostTokenDeposited;
    uint256 public ghostFuelSwapped;
    uint256 public ghostFjOut;
    uint256 private nonce;
    address[] public swapTargets;

    bytes32 constant RECIPIENT = bytes32(uint256(0x1234));
    bytes32 constant FUEL_RECIPIENT = bytes32(uint256(0x5678));
    bytes32 constant SECRET = bytes32(uint256(0x5EC7E7));

    constructor() {
        usdc = new MintableERC20("USDC", "USDC", 6, 1_000_000_000);
        fj = new MintableERC20("FeeJuice", "FJ", 18, 1_000_000_000);
        permit2 = new RecordingPermit2();
        swap = new MockSwap(IERC20(address(fj)));
        swapTargets.push(address(swap));
        tokenPortal = new MockTokenPortal(IERC20(address(usdc)));
        feePortal = new MockFeeJuicePortal(IERC20(address(fj)));
        // Handler deploys → handler owns the router (sweep authority lives here).
        router = new SwapBridgeRouter(address(permit2), address(feePortal), address(swap));

        user = address(0xDA0);
        usdc.mint(address(this), 1_000_000_000 * 1e6);
        usdc.mint(user, 1_000_000_000 * 1e6);
        fj.mint(address(swap), 1_000_000_000 ether); // == cap, ok
        usdc.approve(address(permit2), type(uint256).max);
        vm.prank(user);
        usdc.approve(address(permit2), type(uint256).max);
        swap.setOutput(1 ether, 0); // honest default: report == transfer
    }

    // ─── Actions (foundry feeds random seeds) ────────────────────────

    function bridgeWithFuel(uint256 seed) external {
        uint256 total = bound(seed % 1000, 2, 1000) * 1e6;
        uint256 fuel = bound((seed >> 10) % 997, 1, total - 1);
        bool isPrivate = (seed >> 4) % 2 == 0;
        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _route();
        vm.prank(user);
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
                isPrivate: isPrivate
            }),
            _permit()
        );
        ghostPulled += total;
        ghostTokenDeposited += total - fuel;
        ghostFuelSwapped += fuel;
        ghostFjOut += 1 ether;
    }

    function bridge(uint256 seed) external {
        uint256 amount = bound(seed % 997, 1, 1000) * 1e6;
        bool isPrivate = (seed >> 3) % 2 == 0;
        vm.prank(user);
        router.bridge(
            SwapBridgeRouter.SimpleBridgeParams({
                tokenPortal: address(tokenPortal),
                bridgeToken: address(usdc),
                amount: amount,
                aztecRecipient: RECIPIENT,
                secretHash: SECRET,
                isPrivate: isPrivate
            }),
            _permit()
        );
        ghostPulled += amount;
        ghostTokenDeposited += amount;
    }

    /// Attacker dust/value donation — must NEVER distort user accounting (delta checks).
    function donate(uint256 seed) external {
        uint256 amt = bound(seed % 991, 1, 500) * 1e6;
        if ((seed >> 5) % 2 == 0) {
            usdc.transfer(address(router), amt);
            ghostDonatedUsdc += amt;
        } else {
            fj.transfer(address(router), amt);
            ghostDonatedFj += amt;
        }
    }

    /// Owner safety valve: sweeps FULL residue of one token back to the handler.
    function sweep(uint256 seed) external {
        bool usdcSide = (seed >> 6) % 2 == 0;
        if (usdcSide) {
            uint256 bal = usdc.balanceOf(address(router));
            router.sweep(address(usdc), address(this));
            ghostSweptUsdc += bal;
        } else {
            uint256 bal = fj.balanceOf(address(router));
            router.sweep(address(fj), address(this));
            ghostSweptFj += bal;
        }
    }

    /// Pool-migration rotation: a fresh honest target; pending sigs die (witness drift) but the
    /// mock permit2 accepts regardless, so sequences keep flowing.
    function rotateSwap(uint256 seed) external {
        seed;
        MockSwap next = new MockSwap(IERC20(address(fj)));
        fj.mint(address(next), 1_000_000_000 ether);
        next.setOutput(1 ether, 0);
        router.setSwapTarget(address(next));
        swapTargets.push(address(next));
        swap = next;
    }

    // ─── Invariant read-backs ────────────────────────────────────────

    function routerUsdc() external view returns (uint256) {
        return usdc.balanceOf(address(router));
    }

    function routerFj() external view returns (uint256) {
        return fj.balanceOf(address(router));
    }

    function tokenPortalBalance() external view returns (uint256) {
        return usdc.balanceOf(address(tokenPortal));
    }

    /// Slices land on whichever target was live at swap time; rotations strand nothing —
    /// old targets keep their earned slices, so the sink check sums across all of them.
    function swapTargetBalance() external view returns (uint256) {
        uint256 total;
        for (uint256 i = 0; i < swapTargets.length; i++) total += usdc.balanceOf(swapTargets[i]);
        return total;
    }

    function feePortalBalance() external view returns (uint256) {
        return fj.balanceOf(address(feePortal));
    }

    // ─── Internals ───────────────────────────────────────────────────

    function _route() internal pure returns (IUniswapFuelSwap.PoolKey[] memory p, bool[] memory d) {
        p = new IUniswapFuelSwap.PoolKey[](1);
        p[0] = IUniswapFuelSwap.PoolKey(address(0), address(0), 3000, 60, address(0));
        d = new bool[](1);
        d[0] = true;
    }

    function _permit() internal returns (SwapBridgeRouter.PermitParams memory) {
        nonce += 1;
        return SwapBridgeRouter.PermitParams({nonce: nonce, deadline: type(uint256).max, signature: hex"00"});
    }
}
