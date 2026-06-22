// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {SwapBridgeRouter, IUniswapFuelSwap} from "../src/SwapBridgeRouter.sol";
import {ISignatureTransfer} from "../src/interfaces/ISignatureTransfer.sol";
import {ITokenPortal} from "../src/interfaces/ITokenPortal.sol";
import {IFeeJuicePortal} from "../src/interfaces/IFeeJuicePortal.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";

// ─── Mocks ───────────────────────────────────────────────────────────

contract MockPermit2 is ISignatureTransfer {
    bool public revertNext; // simulate a bad signature / witness mismatch

    function setRevert(bool v) external {
        revertNext = v;
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata details,
        address owner,
        bytes32,
        string calldata,
        bytes calldata
    ) external override {
        require(!revertNext, "MockPermit2: bad signature");
        IERC20(permit.permitted.token).transferFrom(owner, details.to, details.requestedAmount);
    }

    function permitTransferFrom(PermitTransferFrom calldata, SignatureTransferDetails calldata, address, bytes calldata)
        external
        pure
        override
    {
        revert("unused");
    }
}

contract MockSwap is IUniswapFuelSwap {
    IERC20 public immutable fj;
    uint256 public outAmount; // value returned
    uint256 public transferAmount; // FJ actually sent (0 => == outAmount)

    constructor(IERC20 _fj) {
        fj = _fj;
    }

    function setOutput(uint256 out_, uint256 transfer_) external {
        outAmount = out_;
        transferAmount = transfer_;
    }

    function swap(address inputToken, uint256 inputAmount, uint256, PoolKey[] calldata, bool[] calldata)
        external
        override
        returns (uint256)
    {
        IERC20(inputToken).transferFrom(msg.sender, address(this), inputAmount);
        fj.transfer(msg.sender, transferAmount == 0 ? outAmount : transferAmount);
        return outAmount;
    }
}

contract MaliciousPrefundSwap is IUniswapFuelSwap {
    IERC20 public immutable fj;

    constructor(IERC20 _fj) {
        fj = _fj;
    }

    // Satisfies the floor from its own FJ reserve WITHOUT pulling the input token - the
    // residue-theft vector the router's fuel-consumption require must close.
    function swap(address, uint256, uint256 minOutput, PoolKey[] calldata, bool[] calldata)
        external
        override
        returns (uint256)
    {
        fj.transfer(msg.sender, minOutput);
        return minOutput;
    }
}

contract MockTokenPortal is ITokenPortal {
    IERC20 public immutable token;
    uint256 public lastAmount;
    bytes32 public lastTo;
    bool public lastPrivate;
    uint256 public callCount;

    constructor(IERC20 _token) {
        token = _token;
    }

    function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32) external override returns (bytes32, uint256) {
        token.transferFrom(msg.sender, address(this), _amount);
        lastAmount = _amount;
        lastTo = _to;
        lastPrivate = false;
        return (bytes32(uint256(0xABCD)), callCount++);
    }

    function depositToAztecPrivate(uint256 _amount, bytes32) external override returns (bytes32, uint256) {
        token.transferFrom(msg.sender, address(this), _amount);
        lastAmount = _amount;
        lastTo = bytes32(0);
        lastPrivate = true;
        return (bytes32(uint256(0x9012)), callCount++);
    }
}

contract MockFeeJuicePortal is IFeeJuicePortal {
    IERC20 public immutable fj;
    uint256 public lastAmount;
    bytes32 public lastTo;

    constructor(IERC20 _fj) {
        fj = _fj;
    }

    function UNDERLYING() external view override returns (IERC20) {
        return fj;
    }

    function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32) external override returns (bytes32, uint256) {
        fj.transferFrom(msg.sender, address(this), _amount);
        lastAmount = _amount;
        lastTo = _to;
        return (bytes32(uint256(0xFEE)), 0);
    }
}

// ─── Tests ───────────────────────────────────────────────────────────

contract SwapBridgeRouterTest is Test {
    MintableERC20 usdc;
    MintableERC20 fj;
    MockPermit2 permit2;
    MockSwap swap;
    MockTokenPortal tokenPortal;
    MockFeeJuicePortal feePortal;
    SwapBridgeRouter router;

    bytes32 constant RECIPIENT = bytes32(uint256(0x1234));
    bytes32 constant FUEL_RECIPIENT = bytes32(uint256(0x5678));
    bytes32 constant SECRET = bytes32(uint256(0x5EC7E7));

    function setUp() public {
        usdc = new MintableERC20("USDC", "USDC", 6, 1_000_000_000);
        fj = new MintableERC20("FeeJuice", "FJ", 18, 1_000_000_000);
        permit2 = new MockPermit2();
        swap = new MockSwap(IERC20(address(fj)));
        tokenPortal = new MockTokenPortal(IERC20(address(usdc)));
        feePortal = new MockFeeJuicePortal(IERC20(address(fj)));
        router = new SwapBridgeRouter(address(permit2), address(feePortal), address(swap));

        // Fund the test (the "user") + the swap's FJ reserve; approve the mock Permit2.
        usdc.mint(address(this), 10_000 * 1e6);
        fj.mint(address(swap), 100_000 ether);
        usdc.approve(address(permit2), type(uint256).max);
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

    function _fuelParams(bool isPrivate) internal view returns (SwapBridgeRouter.BridgeParams memory p) {
        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _emptyRoute();
        p = SwapBridgeRouter.BridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(usdc),
            totalAmount: 1000 * 1e6,
            fuelAmount: 100 * 1e6,
            aztecRecipient: RECIPIENT,
            fuelRecipient: FUEL_RECIPIENT,
            tokenSecretHash: SECRET,
            fuelSecretHash: SECRET,
            minFuelOutput: 1 ether,
            path: path,
            zeroForOnes: dirs,
            isPrivate: isPrivate
        });
    }

    function test_bridgeWithFuelPublic() public {
        swap.setOutput(5 ether, 0);
        router.bridgeWithFuel(_fuelParams(false), _permit());
        assertEq(tokenPortal.lastAmount(), 900 * 1e6); // total - fuel
        assertEq(tokenPortal.lastPrivate(), false);
        assertEq(tokenPortal.lastTo(), RECIPIENT);
        assertEq(feePortal.lastAmount(), 5 ether);
        assertEq(feePortal.lastTo(), FUEL_RECIPIENT);
        // Router holds nothing afterwards.
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(fj.balanceOf(address(router)), 0);
    }

    function test_bridgeWithFuelPrivate() public {
        swap.setOutput(5 ether, 0);
        router.bridgeWithFuel(_fuelParams(true), _permit());
        assertEq(tokenPortal.lastAmount(), 900 * 1e6);
        assertEq(tokenPortal.lastPrivate(), true);
    }

    function test_balanceMismatchGuardReverts() public {
        // Returns 5 FJ but only transfers 4 → the readback guard must revert.
        swap.setOutput(5 ether, 4 ether);
        vm.expectRevert(bytes("SwapBridgeRouter: balance mismatch"));
        router.bridgeWithFuel(_fuelParams(false), _permit());
    }

    function test_insufficientFuelReverts() public {
        // The target honors its own logic but delivers below the user's SIGNED floor - the
        // ROUTER must be the one to revert (the target is owner-replaceable).
        swap.setOutput(0.5 ether, 0);
        vm.expectRevert(bytes("SwapBridgeRouter: insufficient fuel"));
        router.bridgeWithFuel(_fuelParams(false), _permit());
    }

    function test_prefundedTargetNotConsumingSliceReverts() public {
        // Hostile owner-set target: returns real FJ >= the floor but never pulls the AZLO
        // slice, which would strand it in the router as owner-sweepable residue.
        MaliciousPrefundSwap evil = new MaliciousPrefundSwap(IERC20(address(fj)));
        fj.mint(address(evil), 100 ether);
        router.setSwapTarget(address(evil));
        vm.expectRevert(bytes("SwapBridgeRouter: fuel not consumed"));
        router.bridgeWithFuel(_fuelParams(false), _permit());
    }

    function test_permit2RejectionReverts() public {
        permit2.setRevert(true);
        swap.setOutput(5 ether, 0);
        vm.expectRevert(bytes("MockPermit2: bad signature"));
        router.bridgeWithFuel(_fuelParams(false), _permit());
    }

    function test_simpleBridgePublic() public {
        SwapBridgeRouter.SimpleBridgeParams memory p = SwapBridgeRouter.SimpleBridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(usdc),
            amount: 500 * 1e6,
            aztecRecipient: RECIPIENT,
            secretHash: SECRET,
            isPrivate: false
        });
        router.bridge(p, _permit());
        assertEq(tokenPortal.lastAmount(), 500 * 1e6);
        assertEq(tokenPortal.lastPrivate(), false);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_simpleBridgePrivate() public {
        SwapBridgeRouter.SimpleBridgeParams memory p = SwapBridgeRouter.SimpleBridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(usdc),
            amount: 500 * 1e6,
            aztecRecipient: RECIPIENT,
            secretHash: SECRET,
            isPrivate: true
        });
        router.bridge(p, _permit());
        assertEq(tokenPortal.lastPrivate(), true);
    }

    function test_invalidFuelAmountReverts() public {
        SwapBridgeRouter.BridgeParams memory p = _fuelParams(false);
        p.fuelAmount = p.totalAmount; // fuel must be < total
        vm.expectRevert(bytes("SwapBridgeRouter: invalid fuelAmount"));
        router.bridgeWithFuel(p, _permit());
    }

    function test_sweepOnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        router.sweep(address(usdc), address(0xBEEF));
    }
}
