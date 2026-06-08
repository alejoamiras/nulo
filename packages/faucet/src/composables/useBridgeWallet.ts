import type { Wallet } from "@aztec/aztec.js/wallet"
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
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { buildBridgeManifest } from "@/lib/capabilities"
import { createAztecWalletSession } from "./createAztecWalletSession"

const APP_ID = "nulo-bridge"

async function buildBridgeCapabilityManifest() {
	const sponsoredFpc = await getSponsoredFpcInstance()
	return buildBridgeManifest({
		bridgeAddress: BRIDGE,
		tokenAddress: BRIDGE_TOKEN,
		proxyAddress: BRIDGE_PROXY,
		sponsoredFpcAddress: sponsoredFpc.address,
	})
}

async function registerBridgeContracts(w: Wallet): Promise<void> {
	const [proxyInst, tokenInst, bridgeInst] = await Promise.all([
		rebuildBridgeProxyInstance(),
		rebuildBridgeTokenInstance(),
		rebuildBridgeInstance(),
	])
	await w.registerContract(proxyInst, bridgeProxyArtifact)
	await w.registerContract(tokenInst, TokenContractArtifact)
	await w.registerContract(bridgeInst, tokenBridgeArtifact)
}

// Module-level singleton — the Bridge tab's own Aztec L2 session, independent of the faucet's.
const session = createAztecWalletSession({
	appId: APP_ID,
	buildManifest: buildBridgeCapabilityManifest,
	registerContracts: registerBridgeContracts,
})

export function useBridgeWallet() {
	return session
}

/** Test-only: clear state between cases. */
export const __resetBridgeWalletForTests = session.reset
