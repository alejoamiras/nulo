import { getChainName } from "@/components/ui/utils"
import type { Network } from "@/wallet/services/network/client"

export interface DappChainView {
	chainId: number
	/** The profile's row name (honours a user rename), else the built-in label for the id. */
	name: string
	/** The profile's row for the dApp's chain — the switch target. Absent = nothing to switch to. */
	network?: Network
	/** True when the wallet's active network is a different chain than the dApp's. */
	mismatch: boolean
}

/** The session's chain (a decimal string on the row) against the profile's networks and the active one. */
export function resolveDappChain(sessionChainId: string, networks: readonly Network[], activeChainId: number | undefined): DappChainView {
	const chainId = Number(sessionChainId)
	const network = networks.find((n) => n.chainId === chainId)
	return {
		chainId,
		name: network?.name ?? getChainName(chainId),
		network,
		mismatch: activeChainId !== undefined && activeChainId !== chainId,
	}
}
