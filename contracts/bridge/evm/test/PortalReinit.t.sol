// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {NuloTokenPortal} from "../upstream/NuloTokenPortal.sol";
import {CapturingInbox, CapturingOutbox, FakeRegistry, FakeRollup} from "./PortalRoundtripFuzz.t.sol";

/// Always-on regression for the init-once guard, against the REAL portal — the fast, readable
/// guard-level failure that still runs when halmos is not. Front-run coverage lives in
/// `BlackhatAudit.t.sol`; exhaustive input coverage in `FormalPortal.t.sol`.
contract PortalReinitTest is Test {
    function _registry() internal returns (FakeRegistry) {
        return new FakeRegistry(address(new FakeRollup(address(new CapturingInbox()), address(new CapturingOutbox()))));
    }

    function test_F001_initialize_is_once_only() public {
        NuloTokenPortal portal = new NuloTokenPortal();
        FakeRegistry reg = _registry();
        address usdc = address(0xA11CE);
        bytes32 bridge = bytes32(uint256(0x1111));

        portal.initialize(address(reg), usdc, bridge);
        assertEq(address(portal.underlying()), usdc, "first init sets underlying");
        assertEq(portal.l2Bridge(), bridge, "first init sets l2Bridge");
        assertEq(address(portal.rollup()), reg.getCanonicalRollup(), "first init derives the rollup");

        // Even the initializer cannot rebind — the canonical portal this forks from allows exactly
        // this, which is why the guard exists.
        FakeRegistry evil = _registry();
        vm.expectRevert(NuloTokenPortal.AlreadyInitialized.selector);
        portal.initialize(address(evil), address(0xDEAD), bytes32(uint256(0x6666)));

        assertEq(address(portal.registry()), address(reg), "registry unchanged after rejected re-init");
        assertEq(address(portal.underlying()), usdc, "underlying unchanged after rejected re-init");
        assertEq(portal.l2Bridge(), bridge, "l2Bridge unchanged after rejected re-init");
    }
}
