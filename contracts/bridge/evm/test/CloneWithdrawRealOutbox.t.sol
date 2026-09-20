// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {IRegistry} from "@aztec/governance/interfaces/IRegistry.sol";
import {Outbox} from "@aztec/core/messagebridge/Outbox.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Errors} from "@aztec/core/libraries/Errors.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";

import {PortalFactory} from "../src/PortalFactory.sol";
import {TokenPortalImpl} from "../src/TokenPortalImpl.sol";
import {CapturingInbox, FakeRegistry, FakeRollup} from "./mocks/AztecFakes.sol";
import {PlainERC20} from "./mocks/MetadataERC20s.sol";

/// A clone withdrawing through Aztec's REAL Outbox — membership proof and nullifier bitmap
/// included — instead of the capturing fake, which accepts anything any number of times. Only the
/// rollup is faked: it is the one party allowed to insert a root.
///
/// The proven epoch holds a two-leaf tree: leaf 0 pays alice 200 and is bound to `relayer` as the
/// L1 caller, leaf 1 pays bob 300 and anyone may deliver it.
contract CloneWithdrawRealOutboxTest is Test {
    bytes32 internal constant HUB = bytes32(uint256(0x4B));
    uint256 internal constant VERSION = 4242;
    uint256 internal constant CHECKPOINTS = 3;
    uint256 internal constant RESERVE = 1_000;
    Epoch internal constant EPOCH = Epoch.wrap(7);

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal relayer = makeAddr("relayer");
    address internal mallory = makeAddr("mallory");

    Outbox internal outbox;
    FakeRollup internal rollup;
    PortalFactory internal factory;
    TokenPortalImpl internal portal;
    PlainERC20 internal token;
    bytes32 internal aliceLeaf;
    bytes32 internal bobLeaf;
    bytes32 internal root;

    function setUp() public {
        CapturingInbox inbox = new CapturingInbox();
        // The Outbox and the rollup name each other in their constructors.
        address rollupAddr = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        outbox = new Outbox(rollupAddr, VERSION);
        rollup = new FakeRollup(address(inbox), address(outbox));
        assertEq(address(rollup), rollupAddr, "rollup address prediction");

        factory = new PortalFactory(IRegistry(address(new FakeRegistry(rollupAddr))), HUB, makeAddr("guardian"));
        token = new PlainERC20("Tok", "TOK");
        portal = TokenPortalImpl(factory.createPortal(address(token)));
        assertEq(address(portal.OUTBOX()), address(outbox), "clone is wired to the real outbox");
        token.mint(address(portal), RESERVE);

        aliceLeaf = _leaf(address(portal), alice, 200, relayer);
        bobLeaf = _leaf(address(portal), bob, 300, address(0));
        root = _parent(aliceLeaf, bobLeaf);
        vm.prank(rollupAddr);
        outbox.insert(EPOCH, CHECKPOINTS, root);
    }

    function test_provenMessagesPayOnce() public {
        uint256 supply = token.totalSupply();
        vm.prank(relayer);
        portal.withdraw(alice, 200, true, EPOCH, CHECKPOINTS, 0, _path(bobLeaf));
        vm.prank(mallory);
        portal.withdraw(bob, 300, false, EPOCH, CHECKPOINTS, 1, _path(aliceLeaf));
        _assertBalances(200, 300, RESERVE - 500);
        assertEq(token.totalSupply(), supply, "a withdrawal moves tokens, it never mints or burns");
        assertEq(token.balanceOf(relayer) + token.balanceOf(mallory), 0, "delivering a message pays nothing");

        vm.expectRevert(abi.encodeWithSelector(Errors.Outbox__AlreadyNullified.selector, EPOCH, 2));
        vm.prank(relayer);
        portal.withdraw(alice, 200, true, EPOCH, CHECKPOINTS, 0, _path(bobLeaf));

        // A longer proof of the same epoch re-publishes the same leaves under a new root: the
        // nullifiers are per epoch, not per root.
        vm.prank(address(rollup));
        outbox.insert(EPOCH, CHECKPOINTS + 1, root);
        vm.expectRevert(abi.encodeWithSelector(Errors.Outbox__AlreadyNullified.selector, EPOCH, 3));
        portal.withdraw(bob, 300, false, EPOCH, CHECKPOINTS + 1, 1, _path(aliceLeaf));
        _assertBalances(200, 300, RESERVE - 500);
    }

    function test_callerBoundMessage_onlyItsCallerDelivers() public {
        _expectInvalidRoot(_leaf(address(portal), alice, 200, mallory), bobLeaf, 0);
        vm.prank(mallory);
        portal.withdraw(alice, 200, true, EPOCH, CHECKPOINTS, 0, _path(bobLeaf));

        _expectInvalidRoot(_leaf(address(portal), alice, 200, address(0)), bobLeaf, 0);
        vm.prank(mallory);
        portal.withdraw(alice, 200, false, EPOCH, CHECKPOINTS, 0, _path(bobLeaf));
        _assertBalances(0, 0, RESERVE);

        // A refused attempt nullifies nothing: the bound caller still delivers.
        vm.prank(relayer);
        portal.withdraw(alice, 200, true, EPOCH, CHECKPOINTS, 0, _path(bobLeaf));
        _assertBalances(200, 0, RESERVE - 200);
    }

    function test_rejectsWhatTheTreeDoesNotHold() public {
        _expectInvalidRoot(_leaf(address(portal), mallory, 300, address(0)), aliceLeaf, 1);
        portal.withdraw(mallory, 300, false, EPOCH, CHECKPOINTS, 1, _path(aliceLeaf));

        _expectInvalidRoot(_leaf(address(portal), bob, 301, address(0)), aliceLeaf, 1);
        portal.withdraw(bob, 301, false, EPOCH, CHECKPOINTS, 1, _path(aliceLeaf));

        // Bob's leaf presented at alice's position hashes the pair in the wrong order.
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.MerkleLib__InvalidRoot.selector, root, _parent(bobLeaf, aliceLeaf), bobLeaf, 0
            )
        );
        portal.withdraw(bob, 300, false, EPOCH, CHECKPOINTS, 0, _path(aliceLeaf));

        vm.expectRevert(abi.encodeWithSelector(Errors.Outbox__NothingToConsumeAtEpoch.selector, Epoch.wrap(8)));
        portal.withdraw(bob, 300, false, Epoch.wrap(8), CHECKPOINTS, 1, _path(aliceLeaf));

        vm.expectRevert(abi.encodeWithSelector(Errors.Outbox__NothingToConsumeAtEpoch.selector, EPOCH));
        portal.withdraw(bob, 300, false, EPOCH, CHECKPOINTS - 1, 1, _path(aliceLeaf));
        _assertBalances(0, 0, RESERVE);
    }

    /// The message names its portal, so a proof for one clone cannot drain another's reserve.
    function test_anotherClonesProofIsUseless() public {
        PlainERC20 rich = new PlainERC20("Rich", "RICH");
        TokenPortalImpl other = TokenPortalImpl(factory.createPortal(address(rich)));
        rich.mint(address(other), RESERVE);

        _expectInvalidRoot(_leaf(address(other), bob, 300, address(0)), aliceLeaf, 1);
        other.withdraw(bob, 300, false, EPOCH, CHECKPOINTS, 1, _path(aliceLeaf));
        assertEq(rich.balanceOf(address(other)), RESERVE, "other reserve");
        assertEq(rich.balanceOf(bob), 0, "bob in the other token");
    }

    function _leaf(address portal_, address recipient, uint256 amount, address callerOnL1)
        private
        view
        returns (bytes32)
    {
        return Hash.sha256ToField(
            DataStructures.L2ToL1Msg({
                sender: DataStructures.L2Actor(HUB, VERSION),
                recipient: DataStructures.L1Actor(portal_, block.chainid),
                content: Hash.sha256ToField(
                    abi.encodeWithSignature("withdraw(address,uint256,address)", recipient, amount, callerOnL1)
                )
            })
        );
    }

    function _parent(bytes32 left, bytes32 right) private pure returns (bytes32) {
        return Hash.sha256ToField(bytes.concat(left, right));
    }

    function _path(bytes32 sibling) private pure returns (bytes32[] memory path) {
        path = new bytes32[](1);
        path[0] = sibling;
    }

    function _expectInvalidRoot(bytes32 leaf, bytes32 sibling, uint256 index) private {
        bytes32 computed = index == 0 ? _parent(leaf, sibling) : _parent(sibling, leaf);
        vm.expectRevert(abi.encodeWithSelector(Errors.MerkleLib__InvalidRoot.selector, root, computed, leaf, index));
    }

    function _assertBalances(uint256 aliceHolds, uint256 bobHolds, uint256 reserve) private view {
        assertEq(token.balanceOf(alice), aliceHolds, "alice");
        assertEq(token.balanceOf(bob), bobHolds, "bob");
        assertEq(token.balanceOf(address(portal)), reserve, "reserve");
    }
}
