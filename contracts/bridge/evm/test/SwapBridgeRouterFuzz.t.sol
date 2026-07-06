// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {SwapBridgeRouter, IUniswapFuelSwap} from "../src/SwapBridgeRouter.sol";
import {ITokenPortal} from "../src/interfaces/ITokenPortal.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {WitnessHarness} from "./WitnessHash.t.sol";
import {MockPermit2, MockTokenPortal, MockFeeJuicePortal, MockSwap} from "./SwapBridgeRouter.t.sol";

// ─── Fuzz-only mocks ─────────────────────────────────────────────────

/// A swap target whose (consumed, returned, transferred) behavior is set per call,
/// so a fuzzer can sweep the full lattice around the router's three fuel guards.
contract ConfigurableSwap is IUniswapFuelSwap {
    IERC20 public immutable fj;
    uint256 public consumed;
    uint256 public returned;
    uint256 public transferred;

    constructor(IERC20 _fj) {
        fj = _fj;
    }

    function set(uint256 c, uint256 r, uint256 t) external {
        consumed = c;
        returned = r;
        transferred = t;
    }

    function swap(address inputToken, uint256, uint256, PoolKey[] calldata, bool[] calldata)
        external
        override
        returns (uint256)
    {
        if (consumed > 0) IERC20(inputToken).transferFrom(msg.sender, address(this), consumed);
        if (transferred > 0) fj.transfer(msg.sender, transferred);
        return returned;
    }
}

/// A token portal that reports success but NEVER pulls the approved tokens — the
/// residue-strand shape of the generic-router phishing boundary (a caller-named
/// hostile `tokenPortal` that leaves the pulled tokens sweepable in the router).
contract NonPullingPortal is ITokenPortal {
    function depositToAztecPublic(bytes32, uint256, bytes32) external pure override returns (bytes32, uint256) {
        return (bytes32(uint256(0xDEAD)), 0);
    }

    function depositToAztecPrivate(uint256, bytes32) external pure override returns (bytes32, uint256) {
        return (bytes32(uint256(0xDEAD)), 0);
    }
}

// ─── Fuzz suite ──────────────────────────────────────────────────────

contract SwapBridgeRouterFuzzTest is Test {
    // decimals=0 + a 2^128-1 whole-token cap ⇒ a single mint() can fund any fuzzed
    // amount in [1, 2^128) without looping.
    MintableERC20 tok;
    MintableERC20 fj;
    MockPermit2 permit2;
    MockTokenPortal tokenPortal;
    MockFeeJuicePortal feePortal;
    MockSwap swap;
    SwapBridgeRouter router;
    WitnessHarness harness;

    bytes32 constant RECIPIENT = bytes32(uint256(0x1234));
    bytes32 constant FUEL_RECIPIENT = bytes32(uint256(0x5678));
    bytes32 constant SECRET = bytes32(uint256(0x5EC7E7));
    uint256 constant U128_MAX = type(uint128).max;

    function setUp() public {
        tok = new MintableERC20("TOK", "TOK", 0, U128_MAX);
        fj = new MintableERC20("FeeJuice", "FJ", 18, 1_000_000_000);
        permit2 = new MockPermit2();
        tokenPortal = new MockTokenPortal(IERC20(address(tok)));
        feePortal = new MockFeeJuicePortal(IERC20(address(fj)));
        swap = new MockSwap(IERC20(address(fj)));
        router = new SwapBridgeRouter(address(permit2), address(feePortal), address(swap));
        harness = new WitnessHarness();

        fj.mint(address(swap), 100_000 ether);
        tok.approve(address(permit2), type(uint256).max);
    }

    function _emptyRoute() internal pure returns (IUniswapFuelSwap.PoolKey[] memory p, bool[] memory d) {
        p = new IUniswapFuelSwap.PoolKey[](1);
        p[0] = IUniswapFuelSwap.PoolKey(address(0), address(0), 3000, 60, address(0));
        d = new bool[](1);
        d[0] = true;
    }

    function _permit() internal pure returns (SwapBridgeRouter.PermitParams memory) {
        return SwapBridgeRouter.PermitParams({nonce: 1, deadline: type(uint256).max, signature: hex"00"});
    }

    function _baseWitness() internal view returns (SwapBridgeRouter.BridgeWitness memory w) {
        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _emptyRoute();
        w = SwapBridgeRouter.BridgeWitness({
            tokenPortal: address(uint160(0x1111)),
            bridgeToken: address(uint160(0x2222)),
            totalAmount: 1_000_000,
            fuelAmount: 100_000,
            aztecRecipient: bytes32(uint256(0x1234)),
            fuelRecipient: bytes32(uint256(0x5678)),
            tokenSecretHash: bytes32(uint256(0x5EC7)),
            fuelSecretHash: bytes32(uint256(0xFEE)),
            minFuelOutput: 1 ether,
            routeHash: harness.hRoute(path, dirs),
            isPrivate: false,
            swapTarget: address(uint160(0x9ABC))
        });
    }

    // 1. Every one of the 12 witness fields must bind: mutating exactly one changes the hash.
    //    A field that hashes-but-doesn't-bind is invisible to the fixed-vector pin (WitnessHash.t.sol).
    function testFuzz_witnessTamperChangesHash(uint256 delta, uint8 whichRaw) public view {
        uint8 which = whichRaw % 12;
        SwapBridgeRouter.BridgeWitness memory w = _baseWitness();
        bytes32 base = harness.hWitness(w);

        if (which == 10) {
            w.isPrivate = !w.isPrivate; // bool: the flip is the mutation
        } else {
            vm.assume(delta != 0);
            if (which == 0) w.tokenPortal = address(uint160(uint256(uint160(w.tokenPortal)) ^ delta));
            else if (which == 1) w.bridgeToken = address(uint160(uint256(uint160(w.bridgeToken)) ^ delta));
            else if (which == 2) w.totalAmount ^= delta;
            else if (which == 3) w.fuelAmount ^= delta;
            else if (which == 4) w.aztecRecipient = bytes32(uint256(w.aztecRecipient) ^ delta);
            else if (which == 5) w.fuelRecipient = bytes32(uint256(w.fuelRecipient) ^ delta);
            else if (which == 6) w.tokenSecretHash = bytes32(uint256(w.tokenSecretHash) ^ delta);
            else if (which == 7) w.fuelSecretHash = bytes32(uint256(w.fuelSecretHash) ^ delta);
            else if (which == 8) w.minFuelOutput ^= delta;
            else if (which == 9) w.routeHash = bytes32(uint256(w.routeHash) ^ delta);
            else if (which == 11) w.swapTarget = address(uint160(uint256(uint160(w.swapTarget)) ^ delta));
        }
        assertTrue(harness.hWitness(w) != base, "witness field does not bind");
    }

    // 2. bridge() carries 100% of bridge-only + fuel-only volume after this plan: the portal must
    //    receive EXACTLY `amount` and the router must retain zero residue (residue == owner-sweepable
    //    == the theft-shaped failure mode).
    function testFuzz_bridgeAccounting(uint256 amount, bool isPrivate) public {
        amount = bound(amount, 1, U128_MAX);
        tok.mint(address(this), amount);

        SwapBridgeRouter.SimpleBridgeParams memory p = SwapBridgeRouter.SimpleBridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(tok),
            amount: amount,
            aztecRecipient: RECIPIENT,
            secretHash: SECRET,
            isPrivate: isPrivate
        });
        router.bridge(p, _permit());

        assertEq(tokenPortal.lastAmount(), amount, "portal amount mismatch");
        assertEq(tokenPortal.lastPrivate(), isPrivate, "privacy flag mismatch");
        if (!isPrivate) assertEq(tokenPortal.lastTo(), RECIPIENT, "recipient mismatch");
        assertEq(tok.balanceOf(address(router)), 0, "token residue");
        assertEq(tok.allowance(address(router), address(tokenPortal)), 0, "allowance residue");
    }

    // 3. The fuel split boundary: over the valid domain 0 < fuel < total the slices conserve exactly
    //    and leave zero residue. Integer edges (total==2/fuel==1, fuel==total-1) are the strand-a-wei risk.
    function testFuzz_fuelSplit(uint256 total, uint256 fuel) public {
        total = bound(total, 2, U128_MAX);
        fuel = bound(fuel, 1, total - 1);
        tok.mint(address(this), total);
        swap.setOutput(1, 0); // returns 1 wei FJ, >= the 1-wei floor below; pulls exactly `fuel`

        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _emptyRoute();
        SwapBridgeRouter.BridgeParams memory p = SwapBridgeRouter.BridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(tok),
            totalAmount: total,
            fuelAmount: fuel,
            aztecRecipient: RECIPIENT,
            fuelRecipient: FUEL_RECIPIENT,
            tokenSecretHash: SECRET,
            fuelSecretHash: SECRET,
            minFuelOutput: 1,
            path: path,
            zeroForOnes: dirs,
            isPrivate: false
        });
        router.bridgeWithFuel(p, _permit());

        assertEq(tokenPortal.lastAmount(), total - fuel, "bridge slice mismatch");
        assertEq(feePortal.lastAmount(), 1, "fuel slice mismatch");
        assertEq(tok.balanceOf(address(router)), 0, "token residue");
        assertEq(fj.balanceOf(address(router)), 0, "fj residue");
    }

    // 4. Generalize MaliciousPrefundSwap to the full behavior lattice of the owner-replaceable target:
    //    bridgeWithFuel succeeds IFF the swap consumed exactly fuelAmount, returned >= the signed floor,
    //    AND actually transferred >= what it returned. Any other combination must revert (no residue theft).
    function testFuzz_hostileSwapConsumption(uint256 consumed, uint256 returned, uint256 transferred) public {
        uint256 total = 1_000_000;
        uint256 fuel = 100_000;
        uint256 floor = 5 ether;
        consumed = bound(consumed, 0, fuel); // approval caps the pull at fuelAmount
        returned = bound(returned, 0, 50 ether);
        transferred = bound(transferred, 0, 50 ether);

        ConfigurableSwap evil = new ConfigurableSwap(IERC20(address(fj)));
        fj.mint(address(evil), 100 ether);
        router.setSwapTarget(address(evil));
        evil.set(consumed, returned, transferred);
        tok.mint(address(this), total);

        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _emptyRoute();
        SwapBridgeRouter.BridgeParams memory p = SwapBridgeRouter.BridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(tok),
            totalAmount: total,
            fuelAmount: fuel,
            aztecRecipient: RECIPIENT,
            fuelRecipient: FUEL_RECIPIENT,
            tokenSecretHash: SECRET,
            fuelSecretHash: SECRET,
            minFuelOutput: floor,
            path: path,
            zeroForOnes: dirs,
            isPrivate: false
        });

        bool shouldSucceed = (consumed == fuel && returned >= floor && transferred >= returned);
        if (shouldSucceed) {
            router.bridgeWithFuel(p, _permit());
            // The user's input token is FULLY consumed (no user-fund residue), and the router deposits
            // EXACTLY what the swap returned. A swap that over-transfers donates the excess FJ, which
            // strands as owner-sweepable residue (== transferred - returned) — the swap's loss, never
            // the user's; the router deposits `fuelReceived`, not the whole balance delta.
            assertEq(tok.balanceOf(address(router)), 0, "token residue on success");
            assertEq(feePortal.lastAmount(), returned, "router bridged != returned");
            assertEq(fj.balanceOf(address(router)), transferred - returned, "fj residue != swap over-donation");
        } else {
            vm.expectRevert();
            router.bridgeWithFuel(p, _permit());
        }
    }

    // 5. The newly-hot arbitrary-`tokenPortal` trust boundary. An HONEST portal leaves zero residue.
    //    A caller-named portal that never pulls strands the amount as owner-sweepable residue — the
    //    on-chain call TRUSTS the caller's portal, so only the faucet's manifest-pinning protects users
    //    (documented as the A-1 phishing surface; the on-chain allowlist is tracked follow-up work).
    function testFuzz_hostilePortal(uint256 amount) public {
        amount = bound(amount, 1, U128_MAX);

        // Honest portal → zero residue.
        tok.mint(address(this), amount);
        SwapBridgeRouter.SimpleBridgeParams memory ok = SwapBridgeRouter.SimpleBridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(tok),
            amount: amount,
            aztecRecipient: RECIPIENT,
            secretHash: SECRET,
            isPrivate: false
        });
        router.bridge(ok, _permit());
        assertEq(tok.balanceOf(address(router)), 0, "honest portal left residue");

        // Non-pulling hostile portal → the pulled amount strands in the router (the boundary is real;
        // nothing on-chain stops it — this asserts the surface exists, it is not a router bug).
        NonPullingPortal evil = new NonPullingPortal();
        tok.mint(address(this), amount);
        SwapBridgeRouter.SimpleBridgeParams memory bad = SwapBridgeRouter.SimpleBridgeParams({
            tokenPortal: address(evil),
            bridgeToken: address(tok),
            amount: amount,
            aztecRecipient: RECIPIENT,
            secretHash: SECRET,
            isPrivate: false
        });
        router.bridge(bad, _permit());
        assertEq(tok.balanceOf(address(router)), amount, "expected strand into router (trust boundary)");

        // Owner can recover the stranded residue via sweep (the safety valve).
        router.sweep(address(tok), address(this));
        assertEq(tok.balanceOf(address(router)), 0, "sweep did not clear residue");
    }
}
