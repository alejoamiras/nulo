/**
 * Resolve the dependency bundle that `batchedViewSimulation` needs. Pure
 * function (not a method on `ExecutionService` per the deprecation plan).
 * Callers pass their own service handles; this module just collects the
 * profile / network / account / PXE / node lookups into one call so the
 * helper stays a single-shot from outside.
 */

import type { AccountService } from "@/wallet/services/account/service"
import type { NetworkService } from "@/wallet/services/network/service"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { PxeServiceClient } from "@/wallet/services/pxe/client"
import type { ILogger } from "@/wallet/logger"
import type { ContractResolver } from "../contract-resolver"
import type { BatchedViewSimulationDeps } from "./batched-view-simulation"

export interface GetViewSimulationDepsServices {
	readonly profiles: ProfileService
	readonly networks: NetworkService
	readonly accounts: AccountService
	readonly pxeService: PxeServiceClient
	readonly contractResolver: ContractResolver
	readonly logger?: ILogger
}

/**
 * Resolves deps via `acquireBinding` (post-multi-rpc-failover) instead of
 * the deprecated `getNode` + `networkInfoFrom(network)` pair. The binding
 * goes through `_resolveBindingLocked`, which means:
 *   - The returned `node` is the LIVE active endpoint (snapback-honoring),
 *     not necessarily `endpoints[0]`.
 *   - The `pxe` is built against the same binding's URL (no split-brain
 *     where node and PXE point at different endpoints).
 *
 * For full failover engagement (failure reporting → classifier → cooldown),
 * the caller's `batchedViewSimulation` call should be wrapped in
 * `withBinding(chainId, ...)`. View simulations are read-only, so missing
 * failure reports just means the threshold doesn't tick for these
 * endpoints — no fund loss. We accept that tradeoff to keep the helper
 * signature minimal across the simulate-views refactor + multi-rpc merge.
 */
export async function getViewSimulationDeps(
	services: GetViewSimulationDepsServices,
	networkId: string,
	accountAddress: string,
): Promise<BatchedViewSimulationDeps> {
	const profile = await services.profiles.getActiveProfile()
	if (!profile) {
		throw new Error("Wallet locked")
	}
	const network = await services.networks.getNetwork(networkId)
	const account = await services.accounts.getAccountContract(profile.id, network.chainId, accountAddress)
	const binding = await services.networks.acquireBinding(network.chainId)
	const pxe = services.pxeService.getPXE(binding.info)
	return {
		pxe,
		node: binding.node,
		account,
		contractResolver: services.contractResolver,
		logger: services.logger,
	}
}
