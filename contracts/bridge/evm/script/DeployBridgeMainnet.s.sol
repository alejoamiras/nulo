// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {InertSwapTarget} from "../src/InertSwapTarget.sol";
import {SwapBridgeRouter} from "../src/SwapBridgeRouter.sol";

interface IERC20Metadata {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface IFeeJuicePortalView {
    function UNDERLYING() external view returns (address);
}

/**
 * @notice MAINNET bridge-only L1 legs: InertSwapTarget + SwapBridgeRouter, bound to the
 *         canonical Permit2 and the live Aztec FeeJuicePortal. Swap-fuel is DISABLED on
 *         mainnet (DP2) — the router serves `bridge()` only; the witness-bound swapTarget
 *         slot is filled by the provably-reverting stub (DP8).
 *
 *         The NuloTokenPortal + the L2 trio stay with the aztec.js conductor (they
 *         interleave with L2 wiring); this script owns the pure-L1 bundle, gaining
 *         forge's simulate-before-broadcast, `--resume`, and `--verify` (D21).
 *
 * REHEARSAL (no funds): run against a mainnet fork first —
 *   anvil --fork-url $ETH_RPC_URL &
 *   forge script script/DeployBridgeMainnet.s.sol --rpc-url http://localhost:8545 --broadcast \
 *     --private-key <anvil-funded-key>
 * The same in-script assertions (chain id, Circle USDC identity, portal binding, stub
 * inertness, router readbacks) run in rehearsal and in the real deploy.
 *
 * REAL DEPLOY (Phase 8 — owner go required):
 *   forge script ... --rpc-url $ETH_RPC_URL --broadcast --slow --verify --private-key $PK
 */
contract DeployBridgeMainnet is Script {
    // ── Canonical mainnet addresses ──────────────────────────────────────────
    /// Permit2 singleton — same address on every chain.
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// Circle's official Ethereum USDC (proxy) — https://developers.circle.com/stablecoins/usdc-contract-addresses
    address constant CIRCLE_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    // ── Aztec mainnet (Alpha) L1 contracts — node-derived, env-overridable ───
    // Defaults read live from node_getNodeInfo (2026-07-24, rollupVersion 4248422647). The
    // conductor SHOULD pass fresh values (FEE_JUICE_PORTAL / FEE_JUICE_ASSET) read from the
    // node at run time; the UNDERLYING() cross-check below fails closed on any stale pair.
    address constant DEFAULT_FEE_JUICE_PORTAL = 0xaf73Dd51D1eb8a079BB097f39c832cDD00ac691c;
    address constant DEFAULT_FEE_JUICE_ASSET = 0xA27EC0006e59f245217Ff08CD52A7E8b169E62D2;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address feeJuicePortal = vm.envOr("FEE_JUICE_PORTAL", DEFAULT_FEE_JUICE_PORTAL);
        address feeJuiceAsset = vm.envOr("FEE_JUICE_ASSET", DEFAULT_FEE_JUICE_ASSET);

        // ── Pre-flight (fails the SIMULATION, before any broadcast) ──────────
        require(block.chainid == 1, "mainnet (or a mainnet fork) only");
        require(PERMIT2.code.length > 0, "Permit2 has no code - wrong chain?");
        require(CIRCLE_USDC.code.length > 0, "Circle USDC has no code - wrong chain?");
        // Circle USDC identity sanity (D12's L1 half): the canonical proxy answers as USDC/6.
        require(IERC20Metadata(CIRCLE_USDC).decimals() == 6, "USDC decimals != 6");
        require(keccak256(bytes(IERC20Metadata(CIRCLE_USDC).symbol())) == keccak256("USDC"), "USDC symbol mismatch");
        // The FeeJuicePortal must be the live pair: portal.UNDERLYING() == the fee asset.
        require(feeJuicePortal.code.length > 0, "FeeJuicePortal has no code");
        require(IFeeJuicePortalView(feeJuicePortal).UNDERLYING() == feeJuiceAsset, "portal UNDERLYING != fee asset");

        vm.startBroadcast(pk);

        InertSwapTarget stub = new InertSwapTarget();
        console.log("InertSwapTarget:", address(stub));

        SwapBridgeRouter router = new SwapBridgeRouter(PERMIT2, feeJuicePortal, address(stub));
        console.log("SwapBridgeRouter:", address(router));

        vm.stopBroadcast();

        // ── Post-deploy readbacks (fail the run if the wiring is wrong) ──────
        require(address(router.permit2()) == PERMIT2, "readback: router.permit2");
        require(address(router.feeJuicePortal()) == feeJuicePortal, "readback: router.feeJuicePortal");
        require(address(router.swapTarget()) == address(stub), "readback: router.swapTarget != stub");
        require(router.owner() == vm.addr(pk), "readback: router.owner != deployer");
        // The stub is INERT: any call reverts (bridgeWithFuel would revert atomically).
        (bool ok,) = address(stub).staticcall(abi.encodeWithSignature("swap(address,uint256)"));
        require(!ok, "stub did not revert - NOT inert");
        require(address(stub).code.length > 0, "stub has no code");

        console.log("chainid:", block.chainid);
        console.log("FeeJuicePortal:", feeJuicePortal);
        console.log("all readbacks OK - manifest core: router/permit2/swapTarget/feeJuicePortal above");
    }
}
