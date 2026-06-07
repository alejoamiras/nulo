import type { Wallet } from "@aztec/aztec.js/wallet"
import { DripperContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { DRIPPER, ETH, rebuildDripperInstance, rebuildEthInstance, rebuildUsdcInstance, USDC } from "@/contracts/deployments"
import { getSponsoredFpcInstance } from "@/contracts/sponsored-fpc"
import { buildFaucetManifest } from "@/lib/capabilities"
import { createAztecWalletSession } from "./createAztecWalletSession"

const APP_ID = "nulo-faucet"

async function buildFaucetCapabilityManifest() {
	const sponsoredFpc = await getSponsoredFpcInstance()
	return buildFaucetManifest({
		dripperAddress: DRIPPER,
		usdcAddress: USDC,
		ethAddress: ETH,
		sponsoredFpcAddress: sponsoredFpc.address,
	})
}

async function registerFaucetContracts(w: Wallet): Promise<void> {
	const [dripperInst, usdcInst, ethInst] = await Promise.all([rebuildDripperInstance(), rebuildUsdcInstance(), rebuildEthInstance()])
	await w.registerContract(dripperInst, DripperContractArtifact)
	await w.registerContract(usdcInst, TokenContractArtifact)
	await w.registerContract(ethInst, TokenContractArtifact)
}

// Module-level singleton — one tab = one faucet connection.
const session = createAztecWalletSession({
	appId: APP_ID,
	buildManifest: buildFaucetCapabilityManifest,
	registerContracts: registerFaucetContracts,
})

export function useWalletConnection() {
	return session
}

/** Test-only: clear state between cases. */
export const __resetWalletConnectionForTests = session.reset

export { extractGrantedAccounts } from "./createAztecWalletSession"
export type { ConnectStatus, GrantedAccount } from "./createAztecWalletSession"
