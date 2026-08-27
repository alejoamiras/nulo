// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

// In-project TEST SHIM for NuloTokenPortal's F-001 init-once guard. The deployed portal
// (upstream/NuloTokenPortal.sol) imports the real @aztec interfaces, whose transitive tree
// (IRollup -> FeeLib -> BlobLib) does NOT resolve in the bridge-evm Foundry project — so it is
// compiled/verified from the l1-contracts root, not here. This shim reproduces the portal's
// `initialize` guard + storage + the registry->rollup double-cast against MINIMAL LOCAL interfaces,
// so the always-on regression (PortalReinit.t.sol) proves the guard in-project with no RPC and no
// @aztec stack. It deliberately omits depositToAztec*/withdraw (the guard test never calls them;
// those bodies are exercised by the l1-root compile + the testnet canary). NOT a deployable artifact.

interface IHaveVersion {
    function getVersion() external view returns (uint256);
}

interface IRollupMin {
    function getOutbox() external view returns (address);
    function getInbox() external view returns (address);
    function getVersion() external view returns (uint256);
}

interface IRegistryMin {
    function getCanonicalRollup() external view returns (IHaveVersion);
}

contract NuloTokenPortalShim {
    error AlreadyInitialized();
    error NotInitializer();

    address public registry;
    address public underlying;
    bytes32 public l2Bridge;
    address public rollup;
    address public outbox;
    address public inbox;
    uint256 public rollupVersion;
    address public immutable initializer;

    constructor() {
        initializer = msg.sender;
    }

    /// Mirrors NuloTokenPortal.initialize: deployer-only guard, then init-once guard, then the
    /// registry->rollup double-cast.
    function initialize(address _registry, address _underlying, bytes32 _l2Bridge) external {
        if (msg.sender != initializer) revert NotInitializer();
        if (registry != address(0)) revert AlreadyInitialized();

        registry = _registry;
        underlying = _underlying;
        l2Bridge = _l2Bridge;

        IHaveVersion r = IRegistryMin(_registry).getCanonicalRollup();
        rollup = address(r);
        outbox = IRollupMin(address(r)).getOutbox();
        inbox = IRollupMin(address(r)).getInbox();
        rollupVersion = IRollupMin(address(r)).getVersion();
    }
}
