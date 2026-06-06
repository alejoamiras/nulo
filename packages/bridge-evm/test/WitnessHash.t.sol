// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Test, console2} from "forge-std/Test.sol";
import {SwapBridgeRouter, IUniswapFuelSwap} from "../src/SwapBridgeRouter.sol";

/// Exposes the internal witness/route hashing so the TS side (bridge-core/l1.ts)
/// can be pinned byte-for-byte against it (the L1 analogue of the content-hash
/// keystone — a Permit2 witness mismatch invalidates the signature).
contract WitnessHarness is SwapBridgeRouter {
    constructor() SwapBridgeRouter(address(uint160(1)), address(uint160(2)), address(uint160(3))) {}

    function hRoute(IUniswapFuelSwap.PoolKey[] calldata p, bool[] calldata d) external pure returns (bytes32) {
        return _hashRoute(p, d);
    }

    function hWitness(BridgeWitness calldata w) external pure returns (bytes32) {
        return _hashBridgeWitness(w);
    }
}

contract WitnessHashTest is Test {
    function test_logFixedHashes() public {
        WitnessHarness h = new WitnessHarness();

        IUniswapFuelSwap.PoolKey[] memory path = new IUniswapFuelSwap.PoolKey[](1);
        path[0] = IUniswapFuelSwap.PoolKey({
            currency0: address(uint160(0x05DC)),
            currency1: address(uint160(0x4E14)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        bool[] memory dirs = new bool[](1);
        dirs[0] = true;
        bytes32 routeHash = h.hRoute(path, dirs);

        SwapBridgeRouter.BridgeWitness memory w = SwapBridgeRouter.BridgeWitness({
            tokenPortal: address(uint160(0x1111)),
            bridgeToken: address(uint160(0x2222)),
            totalAmount: 1_000_000,
            fuelAmount: 100_000,
            aztecRecipient: bytes32(uint256(0x1234)),
            fuelRecipient: bytes32(uint256(0x5678)),
            tokenSecretHash: bytes32(uint256(0x5EC7)),
            fuelSecretHash: bytes32(uint256(0xFEE)),
            minFuelOutput: 1 ether,
            routeHash: routeHash,
            isPrivate: false
        });
        bytes32 witnessHash = h.hWitness(w);

        console2.log("ROUTE_HASH");
        console2.logBytes32(routeHash);
        console2.log("WITNESS_HASH");
        console2.logBytes32(witnessHash);
    }
}
