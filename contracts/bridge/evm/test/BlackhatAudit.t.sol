// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

// ─────────────────────────────────────────────────────────────────────────────
// BLACKHAT AUDIT SUITE — adversarial PoCs against the bridge contracts.
// Every test is an ATTACK attempt; PASS = the attack outcome asserted in its name.
// Findings legend:
//   [F-A] portal first-init front-run → brick + (if address published) full drain
//   [F-B] donation-grief NEUTRALIZED by delta checks (defense holds)
//   [F-C] hostile swapTarget: inflated report / short transfer / no-consume → caught
//   [F-D] hostile swapTarget reentrancy into router → fail-closed
//   [F-E] fee-on-transfer bridgeToken → DoS (informational)
//   [F-F] swapTarget migration invalidates pending signatures (fail-closed liveness)
//   [F-G] UniswapFuelSwap accepts a route it cannot settle ({X/native},{native/FJ})
//         → CurrencyNotSettled at unlock exit (fail-closed, self-DoS only)
//   [F-H] minFuelOutput=0 is signable → contract permits dust fuel (user-signed)
// ─────────────────────────────────────────────────────────────────────────────

import {Test, stdError} from "forge-std/Test.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";
import {SwapBridgeRouter, IUniswapFuelSwap} from "../src/SwapBridgeRouter.sol";
import {ISignatureTransfer} from "../src/interfaces/ISignatureTransfer.sol";
import {ITokenPortal} from "../src/interfaces/ITokenPortal.sol";
import {IFeeJuicePortal} from "../src/interfaces/IFeeJuicePortal.sol";
import {MintableERC20} from "../src/MintableERC20.sol";
import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@oz/utils/ReentrancyGuard.sol";
import {NuloTokenPortal} from "../upstream/NuloTokenPortal.sol";

uint256 constant MAX_UINT = type(uint256).max;

// ═══════════════════════════ shared mocks ═══════════════════════════

contract RecordingPermit2 is ISignatureTransfer {
    bytes32 public lastWitness;
    uint256 public lastAmount;
    bool public revertNext;

    function setRevert(bool v) external {
        revertNext = v;
    }

    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata details,
        address owner,
        bytes32 witness,
        string calldata,
        bytes calldata
    ) external override {
        require(!revertNext, "RecordingPermit2: bad signature");
        lastWitness = witness;
        lastAmount = details.requestedAmount;
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
    uint256 public outAmount;
    uint256 public transferAmount; // 0 => == outAmount
    address public reenterTarget;
    bytes public reenterCalldata;

    constructor(IERC20 _fj) {
        fj = _fj;
    }

    function setOutput(uint256 out_, uint256 transfer_) external {
        outAmount = out_;
        transferAmount = transfer_;
    }

    function armReenter(address target, bytes calldata call) external {
        reenterTarget = target;
        reenterCalldata = call;
    }

    function swap(address inputToken, uint256 inputAmount, uint256, PoolKey[] calldata, bool[] calldata)
        external
        override
        returns (uint256)
    {
        if (reenterTarget != address(0)) {
            (bool ok, bytes memory ret) = reenterTarget.call(reenterCalldata);
            if (!ok) assembly { revert(add(ret, 32), mload(ret)) } // bubble the real reason
        }
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
    uint256 public callCount;

    constructor(IERC20 _token) {
        token = _token;
    }

    function depositToAztecPublic(bytes32, uint256 _amount, bytes32) external override returns (bytes32, uint256) {
        token.transferFrom(msg.sender, address(this), _amount);
        return (bytes32(uint256(0xABCD)), callCount++);
    }

    function depositToAztecPrivate(uint256 _amount, bytes32) external override returns (bytes32, uint256) {
        token.transferFrom(msg.sender, address(this), _amount);
        return (bytes32(uint256(0x9012)), callCount++);
    }
}

contract MockFeeJuicePortal is IFeeJuicePortal {
    IERC20 public immutable fj;

    constructor(IERC20 _fj) {
        fj = _fj;
    }

    function UNDERLYING() external view override returns (IERC20) {
        return fj;
    }

    function depositToAztecPublic(bytes32, uint256 _amount, bytes32) external override returns (bytes32, uint256) {
        fj.transferFrom(msg.sender, address(this), _amount);
        return (bytes32(uint256(0xFEE)), 0);
    }
}

/// Fee-on-transfer ERC20: 10% tax on every transfer/transferFrom.
contract FeeOnTransferERC20 {
    string public name = "FoT";
    string public symbol = "FOT";
    uint8 public constant decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        return _t(msg.sender, to, a);
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        return _t(f, to, a);
    }

    function _t(address f, address to, uint256 a) private returns (bool) {
        balanceOf[f] -= a;
        balanceOf[to] += (a * 90) / 100;
        return true;
    }
}

// ═══════════════════════ attacker infra for the portal front-run ═══════════════════════

contract FakeInbox {
    uint256 public nextIndex;

    function sendL2Message(DataStructures.L2Actor calldata, bytes32 contentHash, bytes32 secretHash)
        external
        returns (bytes32 key, uint256 index)
    {
        key = keccak256(abi.encode(contentHash, secretHash));
        index = nextIndex++;
    }
}

contract FakeOutbox {
    // Accepts ANY consume — the attacker fully controls their fake rollup's outbox.
    function consume(DataStructures.L2ToL1Msg calldata, Epoch, uint256, uint256, bytes32[] calldata) external pure {}
}

contract FakeRollup {
    FakeInbox public inbox = new FakeInbox();
    FakeOutbox public outbox = new FakeOutbox();

    function getInbox() external view returns (address) {
        return address(inbox);
    }

    function getOutbox() external view returns (address) {
        return address(outbox);
    }

    function getVersion() external pure returns (uint256) {
        return 1;
    }
}

contract FakeRegistry {
    address public rollup;

    constructor() {
        rollup = address(new FakeRollup());
    }

    function getCanonicalRollup() external view returns (address) {
        return rollup;
    }
}

// ═══════════════════════ THE SUITE ═══════════════════════

contract BlackhatAuditTest is Test {
    MintableERC20 usdc;
    MintableERC20 fj;
    RecordingPermit2 permit2;
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
        permit2 = new RecordingPermit2();
        swap = new MockSwap(IERC20(address(fj)));
        tokenPortal = new MockTokenPortal(IERC20(address(usdc)));
        feePortal = new MockFeeJuicePortal(IERC20(address(fj)));
        router = new SwapBridgeRouter(address(permit2), address(feePortal), address(swap));

        usdc.mint(address(this), 10_000 * 1e6);
        fj.mint(address(swap), 100_000 ether);
        usdc.approve(address(permit2), type(uint256).max);
        swap.setOutput(1 ether, 0); // honest default: report == transfer
    }

    function _route() internal pure returns (IUniswapFuelSwap.PoolKey[] memory p, bool[] memory d) {
        p = new IUniswapFuelSwap.PoolKey[](1);
        p[0] = IUniswapFuelSwap.PoolKey(address(0), address(0), 3000, 60, address(0));
        d = new bool[](1);
        d[0] = true;
    }

    function _permit(uint256 nonce) internal pure returns (SwapBridgeRouter.PermitParams memory) {
        return SwapBridgeRouter.PermitParams({nonce: nonce, deadline: MAX_UINT, signature: hex"00"});
    }

    function _fuelParams(bool isPrivate) internal view returns (SwapBridgeRouter.BridgeParams memory p) {
        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _route();
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

    // ─────────────────────────── [F-A] portal init front-run ───────────────────────────

    /// The deploy conductor sends `deploy portal` and `initialize portal` as TWO separate txs.
    /// Pre-fix, an attacker front-running the initialize bricked the deployment — and a poisoned
    /// address that got published would have been a full drain (fake registry → attacker outbox).
    /// The deployer-only initializer guard must reject the front-run while the honest initialize
    /// still succeeds. (The drain chain itself is unreachable post-guard; kept documented in
    /// implementations-plan/bridge-hardening/audit-blackhat.md.)
    function test_FA_portalInitFrontRun_reverts() public {
        MintableERC20 realUsdc = new MintableERC20("Circle USDC", "USDC", 6, 1_000_000_000);
        NuloTokenPortal portal = new NuloTokenPortal();

        // 1. Attacker front-runs the FIRST initialize with their own registry → rejected.
        FakeRegistry evilReg = new FakeRegistry();
        vm.prank(address(0xBAD));
        vm.expectRevert(NuloTokenPortal.NotInitializer.selector);
        portal.initialize(address(evilReg), address(realUsdc), bytes32(uint256(0xAAAA)));
        assertEq(address(portal.registry()), address(0), "front-run must not bind a registry");

        // 2. The honest initializer (the deploying EOA == this test contract) succeeds.
        FakeRegistry honestReg = new FakeRegistry();
        portal.initialize(address(honestReg), address(realUsdc), bytes32(uint256(0xBBBB)));
        assertEq(address(portal.registry()), address(honestReg), "honest init binds the registry");

        // 3. Post-init, deposits flow to the honest binding and re-init stays impossible.
        realUsdc.mint(address(0xBEEF), 1000e6);
        vm.startPrank(address(0xBEEF));
        realUsdc.approve(address(portal), 1000e6);
        portal.depositToAztecPublic(RECIPIENT, 1000e6, SECRET);
        vm.stopPrank();
        assertEq(realUsdc.balanceOf(address(portal)), 1000e6, "victim funds held by the honest portal");
        vm.prank(address(0xBAD));
        vm.expectRevert(NuloTokenPortal.NotInitializer.selector);
        portal.initialize(address(evilReg), address(realUsdc), bytes32(uint256(0xCCCC)));
    }

    // ─────────────────────── [F-B] donation-grief neutrality ───────────────────────

    function test_FB_donationGriefIsNeutralized() public {
        usdc.mint(address(0xBAD), 500 * 1e6);
        vm.prank(address(0xBAD));
        usdc.transfer(address(router), 500 * 1e6);
        fj.mint(address(0xBAD), 3 ether);
        vm.prank(address(0xBAD));
        IERC20(address(fj)).transfer(address(router), 3 ether);

        uint256 portalBefore = usdc.balanceOf(address(tokenPortal));
        uint256 feePortalBefore = fj.balanceOf(address(feePortal));

        router.bridgeWithFuel(_fuelParams(false), _permit(1));

        assertEq(usdc.balanceOf(address(tokenPortal)) - portalBefore, 900 * 1e6, "token leg exact despite donation");
        assertEq(fj.balanceOf(address(feePortal)) - feePortalBefore, 1 ether, "fuel leg exact despite donation");
        assertEq(usdc.balanceOf(address(router)), 500 * 1e6, "donated residue untouched (owner-sweepable)");
    }

    // ─────────────────────── [F-C] hostile swapTarget accounting ───────────────────────

    function test_FC_inflatedReportShortTransfer_reverts() public {
        swap.setOutput(2 ether, 0.5 ether);
        vm.expectRevert(bytes("SwapBridgeRouter: balance mismatch"));
        router.bridgeWithFuel(_fuelParams(false), _permit(1));
    }

    function test_FC_prefundedNoConsume_reverts() public {
        MaliciousPrefundSwap hostile = new MaliciousPrefundSwap(IERC20(address(fj)));
        router.setSwapTarget(address(hostile));
        fj.mint(address(hostile), 10 ether);
        vm.expectRevert(bytes("SwapBridgeRouter: fuel not consumed"));
        router.bridgeWithFuel(_fuelParams(false), _permit(1));
    }

    // ─────────────────────── [F-D] reentrancy via swap target ───────────────────────

    function test_FD_swapTargetReentersBridge_failClosed() public {
        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _route();
        SwapBridgeRouter.SimpleBridgeParams memory sp = SwapBridgeRouter.SimpleBridgeParams({
            tokenPortal: address(tokenPortal),
            bridgeToken: address(usdc),
            amount: 50 * 1e6,
            aztecRecipient: RECIPIENT,
            secretHash: SECRET,
            isPrivate: false
        });
        bytes memory inner = abi.encodeWithSelector(
            router.bridge.selector, sp, SwapBridgeRouter.PermitParams({nonce: 7, deadline: MAX_UINT, signature: hex"00"})
        );
        swap.armReenter(address(router), inner);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        router.bridgeWithFuel(_fuelParams(false), _permit(1));
    }

    // ─────────────────────── [F-E] fee-on-transfer DoS ───────────────────────

    function test_FE_feeOnTransferToken_DoS() public {
        FeeOnTransferERC20 fot = new FeeOnTransferERC20();
        fot.mint(address(this), 10_000 ether);
        fot.approve(address(permit2), MAX_UINT);

        // The portal must hold the SAME token being bridged. The shared fixture portal is bound to
        // USDC, so bridging `fot` through it made the deposit leg fail on a missing USDC allowance
        // — a failure that has nothing to do with the transfer tax, and that stayed green with the
        // tax removed entirely.
        MockTokenPortal fotPortal = new MockTokenPortal(IERC20(address(fot)));

        (IUniswapFuelSwap.PoolKey[] memory path, bool[] memory dirs) = _route();
        SwapBridgeRouter.BridgeParams memory p = SwapBridgeRouter.BridgeParams({
            tokenPortal: address(fotPortal),
            bridgeToken: address(fot),
            totalAmount: 1000 ether,
            fuelAmount: 100 ether,
            aztecRecipient: RECIPIENT,
            fuelRecipient: FUEL_RECIPIENT,
            tokenSecretHash: SECRET,
            fuelSecretHash: SECRET,
            minFuelOutput: 1 ether,
            path: path,
            zeroForOnes: dirs,
            isPrivate: false
        });

        // The haircut is taken twice — once pulling to the router, once paying the swap target —
        // so the router is short of the amount the deposit leg then tries to move, and the token's
        // balance subtraction underflows. Pinned rather than left as a bare expectRevert, which
        // cannot tell failing closed on the tax from failing for any other reason.
        vm.expectRevert(stdError.arithmeticError);
        router.bridgeWithFuel(p, _permit(2));
    }

    // ─────────────────────── [F-F] migration changes the signed witness ───────────────────────

    /// Named for what it can actually prove. `RecordingPermit2` records the witness it is handed
    /// and never verifies a signature against it, so nothing here demonstrates a pre-migration
    /// signature being REJECTED afterwards — only that `swapTarget` is one of the hashed witness
    /// fields, so rotating it changes what a user would have to sign.
    function test_FF_migrationChangesSignedWitness() public {
        router.bridgeWithFuel(_fuelParams(false), _permit(1));
        bytes32 witnessBefore = permit2.lastWitness();

        MockSwap newSwap = new MockSwap(IERC20(address(fj)));
        fj.mint(address(newSwap), 100_000 ether);
        newSwap.setOutput(1 ether, 0);
        router.setSwapTarget(address(newSwap));

        router.bridgeWithFuel(_fuelParams(false), _permit(9));
        bytes32 witnessAfter = permit2.lastWitness();

        assertTrue(witnessBefore != witnessAfter, "witness must drift with swapTarget");
    }

    // ─────────────────────── [F-H] minFuelOutput=0 is signable ───────────────────────

    function test_FH_zeroMinFuelOutput_permitsDust() public {
        SwapBridgeRouter.BridgeParams memory p = _fuelParams(false);
        p.minFuelOutput = 0;
        swap.setOutput(1 wei, 0);
        router.bridgeWithFuel(p, _permit(1));
        assertEq(fj.balanceOf(address(feePortal)), 1 wei, "dust fuel deposited");
    }
}
