// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test} from "forge-std/Test.sol";
import {NuloTokenPortalShim} from "./NuloTokenPortalShim.sol";

// F-001 regression (always-on, no RPC): proves NuloTokenPortal's init-once guard via the in-project
// shim. The original PoC (audit/.../poc/PortalReinit.t.sol) showed the LIVE canonical portal was
// permissionlessly re-initializable; this asserts the fork closes it. The live-bytecode fork variant
// against the NEW deployed portal lands as PortalReinit.fork.t.sol during the canary/cutover (B-canary/B6).

contract FakeRollup {
    function getOutbox() external view returns (address) {
        return address(this);
    }

    function getInbox() external view returns (address) {
        return address(this);
    }

    function getVersion() external pure returns (uint256) {
        return 1;
    }
}

contract FakeRegistry {
    address private _rollup;

    constructor(address rollup_) {
        _rollup = rollup_;
    }

    function getCanonicalRollup() external view returns (address) {
        return _rollup;
    }
}

contract PortalReinitTest is Test {
    function test_F001_initialize_is_once_only() public {
        NuloTokenPortalShim portal = new NuloTokenPortalShim();
        FakeRegistry reg = new FakeRegistry(address(new FakeRollup()));
        address usdc = address(0xA11CE);
        bytes32 bridge = bytes32(uint256(0x1111));

        // First init succeeds + wires storage (incl. the registry->rollup double-cast).
        portal.initialize(address(reg), usdc, bridge);
        assertEq(portal.underlying(), usdc, "first init sets underlying");
        assertEq(portal.l2Bridge(), bridge, "first init sets l2Bridge");
        assertEq(portal.rollupVersion(), 1, "first init derives rollup version");

        // Re-init — even by the initializer — reverts on the once-guard (canonical allowed it).
        FakeRegistry evil = new FakeRegistry(address(new FakeRollup()));
        vm.expectRevert(NuloTokenPortalShim.AlreadyInitialized.selector);
        portal.initialize(address(evil), address(0xDEAD), bytes32(uint256(0x6666)));

        // A non-initializer caller is rejected before the once-guard even matters.
        vm.prank(address(0xBAD));
        vm.expectRevert(NuloTokenPortalShim.NotInitializer.selector);
        portal.initialize(address(evil), address(0xDEAD), bytes32(uint256(0x6666)));

        // State is unchanged after the rejected re-init.
        assertEq(portal.underlying(), usdc, "underlying unchanged after rejected re-init");
        assertEq(portal.l2Bridge(), bridge, "l2Bridge unchanged after rejected re-init");
    }

    /// F-001 front-run regression: the deploy and initialize are separate transactions, so an
    /// attacker watching the mempool can try to bind THEIR registry first (whose fake outbox would
    /// drain every deposit). The deployer-only initializer guard must reject them while the honest
    /// initialize still succeeds afterwards.
    function test_F001_initialize_frontRun_reverts() public {
        NuloTokenPortalShim portal = new NuloTokenPortalShim();
        address usdc = address(0xA11CE);
        bytes32 bridge = bytes32(uint256(0x1111));

        // Attacker front-runs the FIRST initialize with their own registry.
        FakeRegistry evilReg = new FakeRegistry(address(new FakeRollup()));
        vm.prank(address(0xBAD));
        vm.expectRevert(NuloTokenPortalShim.NotInitializer.selector);
        portal.initialize(address(evilReg), usdc, bytes32(uint256(0xAAAA)));

        // Nothing bound by the rejected front-run.
        assertEq(portal.registry(), address(0), "front-run must not bind a registry");

        // The honest initializer (the deploying EOA == this test contract) still succeeds.
        FakeRegistry honestReg = new FakeRegistry(address(new FakeRollup()));
        portal.initialize(address(honestReg), usdc, bridge);
        assertEq(portal.underlying(), usdc, "honest init sets underlying");
        assertEq(portal.l2Bridge(), bridge, "honest init sets l2Bridge");
    }
}
