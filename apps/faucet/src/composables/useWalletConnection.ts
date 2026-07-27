import type { Wallet } from "@aztec/aztec.js/wallet"
import { DripperContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import {
	BRIDGE,
	BRIDGE_PROXY,
	BRIDGE_TOKEN,
	rebuildBridgeInstance,
	rebuildBridgeProxyInstance,
	rebuildBridgeTokenInstance,
} from "@/contracts/bridge-deployments"
import { DRIPPER, NULO, OLUN, rebuildDripperInstance, rebuildNuloInstance, rebuildOlunInstance } from "@/contracts/deployments"
import { getPrivateFpc } from "@/contracts/private-fpc"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { buildCombinedManifest } from "@/lib/capabilities"
import { createAztecWalletSession } from "./createAztecWalletSession"

const APP_ID = "nulo-faucet"

async function buildCapabilityManifest() {
	const sponsoredFpc = await getSponsoredFpcInstance()
	// The faucet tokens (Dripper/NULO/OLUN) are universal deploys (deployer ZERO, fixed salts), so
	// the SAME addresses exist on BOTH networks — the grant includes them everywhere. The PrivateFPC +
	// FEE_JUICE + auth-registry grants keep private fuel and private-fuel-paid claims working (DP6).
	// The FPC is registered on both networks, so both grants must include it — the earlier bridge-only
	// manifest omitted it and would have broken the mainnet grant vs the unconditional FPC
	// registration (codex post-impl HIGH-1).
	return buildCombinedManifest({
		bridgeAddress: BRIDGE,
		tokenAddress: BRIDGE_TOKEN,
		proxyAddress: BRIDGE_PROXY,
		sponsoredFpcAddress: sponsoredFpc.address,
		dripperAddress: DRIPPER,
		usdcAddress: NULO,
		ethAddress: OLUN,
	})
}

async function registerAllContracts(w: Wallet): Promise<void> {
	// The bridge trio + PrivateFPC + the faucet's Dripper/NULO/OLUN all exist on both networks now
	// (universal deploys — identical addresses per salt+args).
	const [proxyInst, tokenInst, bridgeInst] = await Promise.all([
		rebuildBridgeProxyInstance(),
		rebuildBridgeTokenInstance(),
		rebuildBridgeInstance(),
	])
	const [dripperInst, nuloInst, olunInst] = await Promise.all([rebuildDripperInstance(), rebuildNuloInstance(), rebuildOlunInstance()])
	await w.registerContract(dripperInst, DripperContractArtifact)
	await w.registerContract(nuloInst, TokenContractArtifact)
	await w.registerContract(olunInst, TokenContractArtifact)
	await w.registerContract(proxyInst, bridgeProxyArtifact)
	await w.registerContract(tokenInst, TokenContractArtifact)
	await w.registerContract(bridgeInst, tokenBridgeArtifact)
	// The PrivateFPC must be pre-registered so the no-fuel-claim gate's private Fee-Juice balance read
	// works under 5.0.1 — the wallet only auto-registers it when a tx uses it as fee payer, which is too
	// late for the pre-claim read. See @/contracts/private-fpc.
	const { instance: privateFpcInst, artifact: privateFpcArtifact } = await getPrivateFpc()
	await w.registerContract(privateFpcInst, privateFpcArtifact)
}

// Module-level singleton - ONE Aztec session shared by both the Faucet and Bridge tabs. The two tabs
// are the same origin = the same app to the wallet, so a single combined manifest is granted once;
// connect on either tab and the other inherits the connection + the full grant (no second prompt).
const session = createAztecWalletSession({
	appId: APP_ID,
	buildManifest: buildCapabilityManifest,
	registerContracts: registerAllContracts,
})

export function useWalletConnection() {
	return session
}

/** Test-only: clear state between cases. */
export const __resetWalletConnectionForTests = session.reset

export { extractGrantedAccounts } from "./createAztecWalletSession"
export type { ConnectStatus, DiscoveredWallet, GrantedAccount } from "./createAztecWalletSession"
