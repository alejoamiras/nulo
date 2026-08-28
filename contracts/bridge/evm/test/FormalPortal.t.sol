// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {NuloTokenPortal} from "../upstream/NuloTokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./PortalRoundtripFuzz.t.sol";

/// Symbolic proof for the portal's init-once guard, run by halmos (`check_` prefix), not forge.
///
/// The portal binds its outbox at initialize, and `withdraw` trusts that outbox to authorise
/// releases — so a portal that can be re-pointed after deployment can be drained. The guard closing
/// that had no test at all: deleting it from the real contract left the whole hermetic suite green,
/// because the test named for it asserted against a hand-written shim rather than the contract.
///
/// Two properties of the harness are load-bearing and easy to lose in a later edit:
///
/// 1. The proof calls `initialize` DIRECTLY, with no symbolic caller and no prank. This contract
///    deployed `locked`, so it is the immutable initializer and the call clears the deployer-only
///    guard to land on the init-once guard. A symbolic caller assumed `!= initializer` would let
///    every path exit through `NotInitializer` instead, leaving the proof green with the guard under
///    test deleted — passing for a reason unrelated to what it claims.
/// 2. Registry B must be fully operational, which `test_registryBRebindsEveryBinding` pins
///    permanently. If its rollup calls ever started reverting, the second `initialize` would revert
///    for that unrelated reason and the proof would still pass — a caught-looking mutation that was
///    never caught.
contract FormalPortalTest is Test {
    NuloTokenPortal internal locked;
    NuloTokenPortal internal fresh;
    FakeRegistry internal regA;
    FakeRegistry internal regB;
    CapturingInbox internal inboxB;
    CapturingOutbox internal outboxB;
    FakeRollup internal rollupB;

    address internal constant UNDERLYING_A = address(0xA11CE);
    bytes32 internal constant BRIDGE_A = bytes32(uint256(0x1111));

    function setUp() public {
        regA = new FakeRegistry(address(new FakeRollup(address(new CapturingInbox()), address(new CapturingOutbox()))));

        inboxB = new CapturingInbox();
        outboxB = new CapturingOutbox();
        rollupB = new FakeRollup(address(inboxB), address(outboxB));
        regB = new FakeRegistry(address(rollupB));

        locked = new NuloTokenPortal();
        locked.initialize(address(regA), UNDERLYING_A, BRIDGE_A);

        fresh = new NuloTokenPortal();
    }

    /// For every candidate underlying and L2 bridge, a second `initialize` on an already-initialized
    /// portal leaves all seven bound values untouched.
    ///
    /// The decisive assertion is the unwanted-success branch, not the comparisons: a second
    /// initialize that returns normally trips `assertTrue(false)` whatever it wrote, so the guard's
    /// deletion is caught even when the candidate arguments happen to equal what is already bound.
    /// `revert(...)` must never be used to signal here — halmos observes only forge-std assertion
    /// failures and EVM panics, so it would make this proof unfalsifiable.
    function check_initializedBindingsCannotChange(address candidateUnderlying, bytes32 candidateBridge) public {
        try locked.initialize(address(regB), candidateUnderlying, candidateBridge) {
            assertTrue(false, "re-initialized an already-initialized portal");
        } catch {
            assertEq(address(locked.registry()), address(regA), "registry rebound");
            assertEq(address(locked.underlying()), UNDERLYING_A, "underlying rebound");
            assertEq(locked.l2Bridge(), BRIDGE_A, "l2Bridge rebound");
            assertEq(address(locked.rollup()), regA.getCanonicalRollup(), "rollup rebound");
            assertEq(address(locked.outbox()), FakeRollup(regA.getCanonicalRollup()).getOutbox(), "outbox rebound");
            assertEq(address(locked.inbox()), FakeRollup(regA.getCanonicalRollup()).getInbox(), "inbox rebound");
            assertEq(locked.rollupVersion(), FakeRollup(regA.getCanonicalRollup()).getVersion(), "rollupVersion rebound");
        }
    }

    /// Positive control for the proof above: registry B really can bind a portal end to end. Without
    /// this, a registry B whose rollup calls reverted would make the proof vacuous — every path would
    /// reach the catch branch for the wrong reason — and nothing would say so.
    function test_registryBRebindsEveryBinding() public {
        fresh.initialize(address(regB), address(0xBEEF), bytes32(uint256(0x2222)));

        assertEq(address(fresh.registry()), address(regB), "registry");
        assertEq(address(fresh.underlying()), address(0xBEEF), "underlying");
        assertEq(fresh.l2Bridge(), bytes32(uint256(0x2222)), "l2Bridge");
        assertEq(address(fresh.rollup()), address(rollupB), "rollup");
        assertEq(address(fresh.outbox()), address(outboxB), "outbox");
        assertEq(address(fresh.inbox()), address(inboxB), "inbox");
        assertEq(fresh.rollupVersion(), rollupB.getVersion(), "rollupVersion");
    }
}
