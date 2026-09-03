// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapBridgeRouter} from "../src/SwapBridgeRouter.sol";
import {UniswapFuelSwap} from "../src/UniswapFuelSwap.sol";
import {GenerationDeployer} from "./DeployGeneration.s.sol";

interface IERC20Metadata {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface IFeeJuicePortalView {
    function UNDERLYING() external view returns (address);
}

/// Minimal V4Quoter surface (v4-periphery IV4Quoter) — nonpayable by design; the pre-flight
/// probe calls it OUTSIDE the broadcast so it only ever runs in simulation, never as a tx.
interface IV4Quoter {
    struct QuoteExactSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }

    function quoteExactInputSingle(QuoteExactSingleParams calldata params)
        external
        returns (uint256 amountOut, uint256 gasEstimate);
}

/**
 * @notice MAINNET L1 legs WITH swap-fuel: UniswapFuelSwap + SwapBridgeRouter, bound to the
 *         canonical Permit2, the canonical Uniswap V4 PoolManager, and the live Aztec
 *         FeeJuicePortal. Mainnet does not SEED pools — the fuel route RIDES the existing
 *         canonical liquidity (USDC → WETH, unwrap, native-ETH → AZTEC), so this script's
 *         job is to prove that route is alive before anything deploys: a quoter dust-probe
 *         of the exact route shape runs in the pre-flight and fails the simulation closed.
 *         Pool discovery (which fee tiers actually quote) lives in
 *         packages/bridge-core/scripts/discover-mainnet-fuel.ts — run it first; the tier
 *         defaults below are its 2026-07-27 findings, env-overridable on drift.
 *
 *         The NuloTokenPortal + the L2 trio stay with the aztec.js conductor (they
 *         interleave with L2 wiring); this script owns the pure-L1 bundle, gaining
 *         forge's simulate-before-broadcast, `--resume`, and `--verify`.
 *
 * REHEARSAL (no funds): run against a mainnet fork first —
 *   anvil --fork-url $ETH_RPC_URL &
 *   PRIVATE_KEY=<anvil-funded-key> EXPECTED_DEPLOYER=<its address> \
 *     forge script script/DeployBridgeMainnet.s.sol --rpc-url http://localhost:8545 --broadcast
 * The same in-script assertions (chain id, Circle USDC identity, portal binding, the live
 * route probe, router/swap readbacks) run in rehearsal and in the real deploy.
 *
 * REAL DEPLOY (Phase 8 — owner go required):
 *   forge script ... --rpc-url $ETH_RPC_URL --broadcast --slow --verify --private-key $PK
 */
contract DeployBridgeMainnet is GenerationDeployer {
    // ── Canonical mainnet addresses ──────────────────────────────────────────
    /// Permit2 singleton — same address on every chain.
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// Circle's official Ethereum USDC (proxy) — https://developers.circle.com/stablecoins/usdc-contract-addresses
    address constant CIRCLE_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    /// Canonical WETH9.
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    /// Uniswap V4 — docs.uniswap.org/contracts/v4/deployments (verified live by the discovery
    /// script AND re-proven here by the pre-flight route probe on every run).
    address constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;

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
        // Fee tiers of the canonical pools the route rides — the discovery script's findings
        // (USDC/WETH 500/10, native-ETH/AZTEC 10000/200); override on drift, never blindly.
        uint24 tokenWethFee = uint24(vm.envOr("TOKEN_WETH_FEE", uint256(500)));
        int24 tokenWethSpacing = int24(int256(vm.envOr("TOKEN_WETH_SPACING", uint256(10))));
        uint24 ethFjFee = uint24(vm.envOr("ETH_FJ_FEE", uint256(10000)));
        int24 ethFjSpacing = int24(int256(vm.envOr("ETH_FJ_SPACING", uint256(200))));

        // ── Pre-flight (fails the SIMULATION, before any broadcast) ──────────
        // The broadcaster MUST be the plan-pinned mainnet signer (PLAN_PINNED_L1_SIGNERS.mainnet,
        // live-intent.ts) — passed as EXPECTED_DEPLOYER by the conductor/operator. envAddress has no
        // default, so an unset pin fails closed: no arbitrary PRIVATE_KEY can deploy + own the router.
        address expectedDeployer = vm.envAddress("EXPECTED_DEPLOYER");
        require(vm.addr(pk) == expectedDeployer, "broadcaster != EXPECTED_DEPLOYER (plan-pinned signer) - STOP");
        require(block.chainid == 1, "mainnet (or a mainnet fork) only");
        require(PERMIT2.code.length > 0, "Permit2 has no code - wrong chain?");
        require(CIRCLE_USDC.code.length > 0, "Circle USDC has no code - wrong chain?");
        require(WETH.code.length > 0, "WETH has no code - wrong chain?");
        require(POOL_MANAGER.code.length > 0, "V4 PoolManager has no code - wrong chain?");
        require(V4_QUOTER.code.length > 0, "V4 Quoter has no code - wrong chain?");
        // Circle USDC identity sanity (D12's L1 half): the canonical proxy answers as USDC/6.
        require(IERC20Metadata(CIRCLE_USDC).decimals() == 6, "USDC decimals != 6");
        require(keccak256(bytes(IERC20Metadata(CIRCLE_USDC).symbol())) == keccak256("USDC"), "USDC symbol mismatch");
        require(keccak256(bytes(IERC20Metadata(WETH).symbol())) == keccak256("WETH"), "WETH symbol mismatch");
        // The FeeJuicePortal must be the live pair: portal.UNDERLYING() == the fee asset.
        require(feeJuicePortal.code.length > 0, "FeeJuicePortal has no code");
        require(IFeeJuicePortalView(feeJuicePortal).UNDERLYING() == feeJuiceAsset, "portal UNDERLYING != fee asset");
        // The route the app will sign against must quote RIGHT NOW: 0.01 USDC through the exact
        // two-hop shape (token → WETH, then native-ETH → fee asset). An initialized-but-drained
        // pool fails here, before any deployment exists to point at it.
        uint256 probeOut = _probeRoute(feeJuiceAsset, tokenWethFee, tokenWethSpacing, ethFjFee, ethFjSpacing);
        console.log("route probe: 0.01 USDC quotes to (fee-asset wei):", probeOut);

        vm.startBroadcast(pk);

        UniswapFuelSwap swapTarget = new UniswapFuelSwap(POOL_MANAGER, feeJuiceAsset, WETH);
        console.log("UniswapFuelSwap:", address(swapTarget));

        SwapBridgeRouter router =
            new SwapBridgeRouter(PERMIT2, feeJuicePortal, address(swapTarget), _resolveFactory());
        console.log("SwapBridgeRouter:", address(router));

        vm.stopBroadcast();

        // ── Post-deploy readbacks (fail the run if the wiring is wrong) ──────
        require(address(router.permit2()) == PERMIT2, "readback: router.permit2");
        require(address(router.feeJuicePortal()) == feeJuicePortal, "readback: router.feeJuicePortal");
        require(address(router.swapTarget()) == address(swapTarget), "readback: router.swapTarget");
        require(router.owner() == vm.addr(pk), "readback: router.owner != deployer");
        require(address(swapTarget.poolManager()) == POOL_MANAGER, "readback: swapTarget.poolManager");
        require(swapTarget.feeJuice() == feeJuiceAsset, "readback: swapTarget.feeJuice");
        require(swapTarget.weth() == WETH, "readback: swapTarget.weth");
        require(swapTarget.owner() == vm.addr(pk), "readback: swapTarget.owner != deployer");

        console.log("chainid:", block.chainid);
        console.log("FeeJuicePortal:", feeJuicePortal);
        console.log("manifest swap block: poolManager/quoter/weth above; pools tokenWeth fee/spacing:");
        console.log(uint256(tokenWethFee), uint256(int256(tokenWethSpacing)));
        console.log("pools ethFj fee/spacing:");
        console.log(uint256(ethFjFee), uint256(int256(ethFjSpacing)));
        console.log("all readbacks OK");
    }

    /// @dev Chained dust quote along the exact route shape the router validates (WETH-native
    ///      discontinuity on the final boundary). Reverts — failing the simulation — if either
    ///      hop cannot quote or quotes to zero.
    function _probeRoute(
        address feeJuiceAsset,
        uint24 tokenWethFee,
        int24 tokenWethSpacing,
        uint24 ethFjFee,
        int24 ethFjSpacing
    ) internal returns (uint256 fjOut) {
        require(CIRCLE_USDC < WETH, "USDC !< WETH - route direction assumption broken");
        (uint256 wethOut,) = IV4Quoter(V4_QUOTER).quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: PoolKey({
                    currency0: Currency.wrap(CIRCLE_USDC),
                    currency1: Currency.wrap(WETH),
                    fee: tokenWethFee,
                    tickSpacing: tokenWethSpacing,
                    hooks: IHooks(address(0))
                }),
                zeroForOne: true,
                exactAmount: 10_000, // 0.01 USDC
                hookData: ""
            })
        );
        require(wethOut > 0, "route probe: USDC->WETH hop quotes to zero - STOP");
        (fjOut,) = IV4Quoter(V4_QUOTER).quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: PoolKey({
                    currency0: Currency.wrap(address(0)),
                    currency1: Currency.wrap(feeJuiceAsset),
                    fee: ethFjFee,
                    tickSpacing: ethFjSpacing,
                    hooks: IHooks(address(0))
                }),
                zeroForOne: true,
                exactAmount: uint128(wethOut),
                hookData: ""
            })
        );
        require(fjOut > 0, "route probe: ETH->feeAsset hop quotes to zero - STOP");
    }
}
