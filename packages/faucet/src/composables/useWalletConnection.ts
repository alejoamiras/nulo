import type { Wallet } from "@aztec/aztec.js/wallet"
import { DripperContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import {
	BRIDGE,
	BRIDGE_PROXY,
	BRIDGE_TOKEN,
	rebuildBridgeInstance,
	rebuildBridgeProxyInstance,
	rebuildBridgeTokenInstance,
} from "@/contracts/bridge-deployments"
import { DRIPPER, ETH, rebuildDripperInstance, rebuildEthInstance, rebuildUsdcInstance, USDC } from "@/contracts/deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { buildCombinedManifest } from "@/lib/capabilities"
import { createAztecWalletSession } from "./createAztecWalletSession"

const APP_ID = "nulo-faucet"

async function buildCapabilityManifest() {
	const sponsoredFpc = await getSponsoredFpcInstance()
	return buildCombinedManifest({
		dripperAddress: DRIPPER,
		usdcAddress: USDC,
		ethAddress: ETH,
		bridgeAddress: BRIDGE,
		tokenAddress: BRIDGE_TOKEN,
		proxyAddress: BRIDGE_PROXY,
		sponsoredFpcAddress: sponsoredFpc.address,
	})
}

async function registerAllContracts(w: Wallet): Promise<void> {
	const [dripperInst, usdcInst, ethInst, proxyInst, tokenInst, bridgeInst] = await Promise.all([
		rebuildDripperInstance(),
		rebuildUsdcInstance(),
		rebuildEthInstance(),
		rebuildBridgeProxyInstance(),
		rebuildBridgeTokenInstance(),
		rebuildBridgeInstance(),
	])
	await w.registerContract(dripperInst, DripperContractArtifact)
	await w.registerContract(usdcInst, TokenContractArtifact)
	await w.registerContract(ethInst, TokenContractArtifact)
	await w.registerContract(proxyInst, bridgeProxyArtifact)
	await w.registerContract(tokenInst, TokenContractArtifact)
	await w.registerContract(bridgeInst, tokenBridgeArtifact)
}

// Module-level singleton — ONE Aztec session shared by both the Faucet and Bridge tabs. The two tabs
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
export type { ConnectStatus, GrantedAccount } from "./createAztecWalletSession"
