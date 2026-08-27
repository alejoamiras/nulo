// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";
import {NuloTokenPortal} from "../upstream/NuloTokenPortal.sol";
import {MintableERC20} from "../src/MintableERC20.sol";

/// Content-hash ROUNDTRIP fuzzing for the REAL NuloTokenPortal: for ARBITRARY inputs, the hash
/// the portal commits into the L1↔L2 message must equal an INDEPENDENT model
/// (`sha256(preimage) >> 8`, computed here without the aztec Hash lib — that lib is what the
/// portal itself uses, so asserting against it would be a tautology). The fixed-vector keystone
/// pins toolchain equality at three points; this fuzz pins the whole input domain.
contract PortalRoundtripFuzzTest is Test {
    CapturingInbox inbox;
    CapturingOutbox outbox;
    NuloTokenPortal portal;
    MintableERC20 usdc;

    // Independent truncation model: Aztec's sha256ToField drops the LAST byte.
    function _model(bytes memory preimage) internal pure returns (bytes32) {
        return bytes32(uint256(sha256(preimage)) >> 8);
    }

    function setUp() public {
        inbox = new CapturingInbox();
        outbox = new CapturingOutbox();
        FakeRollup rollup = new FakeRollup(address(inbox), address(outbox));
        FakeRegistry reg = new FakeRegistry(address(rollup));
        usdc = new MintableERC20("USDC", "USDC", 6, 1_000_000_000);
        portal = new NuloTokenPortal();
        portal.initialize(address(reg), address(usdc), bytes32(uint256(0x1111)));
        // Deposits pull from the caller; withdrawals pay out of the portal's balance.
        usdc.mint(address(this), 1_000_000 * 1e6);
        usdc.approve(address(portal), type(uint256).max);
        usdc.mint(address(portal), 1_000_000 * 1e6);
    }

    function testFuzz_depositPublic_contentHashMatchesIndependentModel(bytes32 to, uint256 amount, bytes32 secret) public {
        amount = bound(amount, 1, 1_000_000 * 1e6);
        (bytes32 key, uint256 index) = portal.depositToAztecPublic(to, amount, secret);
        // The independent part is sha256 + truncation; ABI padding comes from encodeWithSignature.
        bytes memory preimage = abi.encodeWithSignature("mint_to_public(bytes32,uint256)", to, amount);
        assertEq(inbox.lastContentHash(), _model(preimage), "public content hash drifted");
        assertEq(inbox.lastSecretHash(), secret, "secret hash not forwarded");
        assertEq(inbox.lastVersion(), portal.rollupVersion(), "rollup version not forwarded");
        assertEq(inbox.lastBridge(), bytes32(uint256(0x1111)), "l2Bridge actor mismatch");
        (key, index); // returned identity is informational only
    }

    function testFuzz_depositPrivate_contentHashMatchesIndependentModel(uint256 amount, bytes32 secret) public {
        amount = bound(amount, 1, 1_000_000 * 1e6);
        portal.depositToAztecPrivate(amount, secret);
        bytes memory preimage = abi.encodeWithSignature("mint_to_private(uint256)", amount);
        assertEq(inbox.lastContentHash(), _model(preimage), "private content hash drifted");
        assertEq(inbox.lastSecretHash(), secret, "secret hash not forwarded");
    }

    function testFuzz_withdraw_messageReconstructionMatchesIndependentModel(
        address recipient,
        uint256 amount,
        bool withCaller,
        address callerOnL1
    ) public {
        amount = bound(amount, 1, 1_000_000 * 1e6);
        recipient = address(uint160(bound(uint160(recipient), 1, type(uint160).max)));
        // The outbox guard lives on L2; locally any caller may drive reconstruction.
        address caller = withCaller ? callerOnL1 : address(0);
        vm.prank(caller);
        portal.withdraw(recipient, amount, withCaller, Epoch.wrap(7), 3, 42, new bytes32[](0));

        DataStructures.L2ToL1Msg memory m = outbox.lastMsg();
        bytes memory preimage = abi.encodeWithSignature("withdraw(address,uint256,address)", recipient, amount, caller);
        assertEq(m.content, _model(preimage), "withdraw content drifted");
        assertEq(m.sender.actor, bytes32(uint256(0x1111)), "sender actor != l2Bridge");
        assertEq(m.sender.version, portal.rollupVersion(), "sender version != pinned rollup version");
        assertEq(m.recipient.actor, address(portal), "recipient actor != portal");
        assertEq(m.recipient.chainId, block.chainid, "recipient chain id mismatch");
    }
}

// ─── Capturing fakes ─────────────────────────────────────────────────

contract CapturingInbox {
    bytes32 public lastContentHash;
    bytes32 public lastSecretHash;
    bytes32 public lastBridge;
    uint256 public lastVersion;
    uint256 private nextIndex;

    function sendL2Message(DataStructures.L2Actor calldata actor, bytes32 contentHash, bytes32 secretHash)
        external
        returns (bytes32 key, uint256 index)
    {
        lastContentHash = contentHash;
        lastSecretHash = secretHash;
        lastBridge = actor.actor;
        lastVersion = actor.version;
        key = keccak256(abi.encode(contentHash, secretHash));
        index = nextIndex++;
    }
}

contract CapturingOutbox {
    DataStructures.L2ToL1Msg private stored;

    // Explicit accessor: a public struct var's auto-getter flattens members instead of
    // returning the struct.
    function lastMsg() external view returns (DataStructures.L2ToL1Msg memory) {
        return stored;
    }

    function consume(DataStructures.L2ToL1Msg calldata message, Epoch, uint256, uint256, bytes32[] calldata) external {
        stored = message;
    }
}

contract FakeRollup {
    address public immutable inbox;
    address public immutable outbox;

    constructor(address inbox_, address outbox_) {
        inbox = inbox_;
        outbox = outbox_;
    }

    function getInbox() external view returns (address) {
        return inbox;
    }

    function getOutbox() external view returns (address) {
        return outbox;
    }

    function getVersion() external pure returns (uint256) {
        return 4242;
    }
}

contract FakeRegistry {
    address public rollup;

    constructor(address rollup_) {
        rollup = rollup_;
    }

    function getCanonicalRollup() external view returns (address) {
        return rollup;
    }
}
