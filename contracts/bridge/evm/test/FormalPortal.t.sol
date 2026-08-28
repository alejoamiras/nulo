// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {NuloTokenPortal} from "../upstream/NuloTokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./PortalRoundtripFuzz.t.sol";

/// Symbolic proof for the portal's init-once guard, run by halmos (`check_` prefix), not forge.
/// The portal binds its outbox at initialize and `withdraw` trusts that outbox to authorise releases,
/// so a portal that can be re-pointed after deployment can be drained.
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
    /// portal is rejected by the init-once guard and leaves all seven bound values untouched.
    ///
    /// Two properties keep this falsifiable, and both are easy to undo by accident:
    /// - No symbolic caller. This contract deployed `locked`, so a direct call clears the
    ///   deployer-only guard and lands on the guard under test. A caller assumed `!= initializer`
    ///   would exit every path through `NotInitializer`, staying green with the guard deleted.
    /// - The catch matches the guard's selector. A bare `catch` treats any revert as evidence, so a
    ///   fixture that failed for its own reasons would look like the guard holding.
    /// Signal failure with assertions only — halmos cannot observe `revert(string)`.
    function check_initializedBindingsCannotChange(address candidateUnderlying, bytes32 candidateBridge) public {
        try locked.initialize(address(regB), candidateUnderlying, candidateBridge) {
            assertTrue(false, "re-initialized an already-initialized portal");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), NuloTokenPortal.AlreadyInitialized.selector, "rejected for the wrong reason");
            assertEq(address(locked.registry()), address(regA), "registry rebound");
            assertEq(address(locked.underlying()), UNDERLYING_A, "underlying rebound");
            assertEq(locked.l2Bridge(), BRIDGE_A, "l2Bridge rebound");
            assertEq(address(locked.rollup()), regA.getCanonicalRollup(), "rollup rebound");
            assertEq(address(locked.outbox()), FakeRollup(regA.getCanonicalRollup()).getOutbox(), "outbox rebound");
            assertEq(address(locked.inbox()), FakeRollup(regA.getCanonicalRollup()).getInbox(), "inbox rebound");
            assertEq(locked.rollupVersion(), FakeRollup(regA.getCanonicalRollup()).getVersion(), "rollupVersion rebound");
        }
    }

    /// Registry B really can bind a portal end to end, so the proof above exercises a registry that
    /// works rather than one that happens to revert.
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
