/**
 * Resolve the dependency bundle that `batchedViewSimulation` needs. Pure
 * function (not a method on `ExecutionService` per the deprecation plan).
 * Callers pass their own service handles; this module just collects the
 * profile / network / account / PXE / node lookups into one call so the
 * helper stays a single-shot from outside.
 */

import type { AccountService } from "@/wallet/services/account/service"
import type { NetworkService } from "@/wallet/services/network/service"
import { networkInfoFrom } from "@/wallet/services/network/service"
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
	const node = await services.networks.getNode(network.chainId)
	const pxe = services.pxeService.getPXE(networkInfoFrom(network))
	return {
		pxe,
		node,
		network,
		account,
		contractResolver: services.contractResolver,
		logger: services.logger,
	}
}
