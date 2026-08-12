import type { ServiceSpec } from "@/wallet/base"
import { ServiceClient } from "@nulo/extension-messaging/background"
import { validateParams, validateResult } from "@nulo/extension-messaging/zod"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import {
	type Events,
	type Methods,
	type Network,
	type NetworkEndpoint,
	NETWORK_SERVICE_NAME,
	NetworkMethodSchemas,
	type NodeStatus,
} from "./spec"

export * from "./spec"

/**
 * Every public method validates outgoing params before calling `this.request`
 * and validates the incoming result before returning. Validation failures
 * throw `ValidationError` so consumers can `instanceof` against it.
 */
export class NetworkServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onNetworkAdded = new EventHandler<Network>()
	public readonly onNetworkUpdated = new EventHandler<Network>()
	public readonly onNetworkDeleted = new EventHandler<Network>()
	public readonly onActiveNetworkChanged = new EventHandler<Network>()
	public readonly onPrimaryEndpointChanged = new EventHandler<{ networkId: string; endpointId: string }>()
	public readonly onChainPurged = new EventHandler<{ profileId: string; chainId: number }>()

	public constructor(name?: string) {
		super(NETWORK_SERVICE_NAME, new LoggerServiceClient(), name)
	}

	public async getOrInitNetworks(): Promise<Network[]> {
		validateParams(NetworkMethodSchemas.getOrInitNetworks.params, [], "getOrInitNetworks")
		const result = await this.request("getOrInitNetworks")
		return validateResult(NetworkMethodSchemas.getOrInitNetworks.result, result, "getOrInitNetworks")
	}

	public async getNetworks(chainId?: number): Promise<Network[]> {
		validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
		const result = await this.request("getNetworks", chainId)
		return validateResult(NetworkMethodSchemas.getNetworks.result, result, "getNetworks")
	}

	public async getNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.getNetwork.params, [id], "getNetwork")
		const result = await this.request("getNetwork", id)
		return validateResult(NetworkMethodSchemas.getNetwork.result, result, "getNetwork")
	}

	public async addNetwork(name: string, rpcUrl: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.addNetwork.params, [name, rpcUrl], "addNetwork")
		const result = await this.request("addNetwork", name, rpcUrl)
		return validateResult(NetworkMethodSchemas.addNetwork.result, result, "addNetwork")
	}

	public async renameNetwork(id: string, name: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.renameNetwork.params, [id, name], "renameNetwork")
		const result = await this.request("renameNetwork", id, name)
		return validateResult(NetworkMethodSchemas.renameNetwork.result, result, "renameNetwork")
	}

	public async deleteNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.deleteNetwork.params, [id], "deleteNetwork")
		const result = await this.request("deleteNetwork", id)
		return validateResult(NetworkMethodSchemas.deleteNetwork.result, result, "deleteNetwork")
	}

	public async setActiveNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.setActiveNetwork.params, [id], "setActiveNetwork")
		const result = await this.request("setActiveNetwork", id)
		return validateResult(NetworkMethodSchemas.setActiveNetwork.result, result, "setActiveNetwork")
	}

	public async getActiveNetwork(): Promise<Network | null> {
		validateParams(NetworkMethodSchemas.getActiveNetwork.params, [], "getActiveNetwork")
		const result = await this.request("getActiveNetwork")
		return validateResult(NetworkMethodSchemas.getActiveNetwork.result, result, "getActiveNetwork")
	}

	public async getPrimaryNetwork(): Promise<Network | null> {
		validateParams(NetworkMethodSchemas.getPrimaryNetwork.params, [], "getPrimaryNetwork")
		const result = await this.request("getPrimaryNetwork")
		return validateResult(NetworkMethodSchemas.getPrimaryNetwork.result, result, "getPrimaryNetwork")
	}

	public async setActiveForProfile(profileId: string, networkId: string): Promise<string> {
		validateParams(NetworkMethodSchemas.setActiveForProfile.params, [profileId, networkId], "setActiveForProfile")
		const result = await this.request("setActiveForProfile", profileId, networkId)
		return validateResult(NetworkMethodSchemas.setActiveForProfile.result, result, "setActiveForProfile")
	}

	public async addEndpoint(networkId: string, label: string | undefined, rpcUrl: string): Promise<NetworkEndpoint> {
		validateParams(NetworkMethodSchemas.addEndpoint.params, [networkId, label, rpcUrl], "addEndpoint")
		const result = await this.request("addEndpoint", networkId, label, rpcUrl)
		return validateResult(NetworkMethodSchemas.addEndpoint.result, result, "addEndpoint")
	}

	public async updateEndpoint(
		networkId: string,
		endpointId: string,
		label: string | undefined,
		rpcUrl: string,
	): Promise<NetworkEndpoint> {
		validateParams(NetworkMethodSchemas.updateEndpoint.params, [networkId, endpointId, label, rpcUrl], "updateEndpoint")
		const result = await this.request("updateEndpoint", networkId, endpointId, label, rpcUrl)
		return validateResult(NetworkMethodSchemas.updateEndpoint.result, result, "updateEndpoint")
	}

	public async deleteEndpoint(networkId: string, endpointId: string): Promise<NetworkEndpoint> {
		validateParams(NetworkMethodSchemas.deleteEndpoint.params, [networkId, endpointId], "deleteEndpoint")
		const result = await this.request("deleteEndpoint", networkId, endpointId)
		return validateResult(NetworkMethodSchemas.deleteEndpoint.result, result, "deleteEndpoint")
	}

	public async setPrimaryEndpoint(networkId: string, endpointId: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.setPrimaryEndpoint.params, [networkId, endpointId], "setPrimaryEndpoint")
		const result = await this.request("setPrimaryEndpoint", networkId, endpointId)
		return validateResult(NetworkMethodSchemas.setPrimaryEndpoint.result, result, "setPrimaryEndpoint")
	}

	public async getNodeStatus(networkId: string): Promise<NodeStatus> {
		validateParams(NetworkMethodSchemas.getNodeStatus.params, [networkId], "getNodeStatus")
		const result = await this.request("getNodeStatus", networkId)
		return validateResult(NetworkMethodSchemas.getNodeStatus.result, result, "getNodeStatus")
	}

	public async probeNodeStatus(networkId: string, timeoutMs: number): Promise<NodeStatus> {
		validateParams(NetworkMethodSchemas.probeNodeStatus.params, [networkId, timeoutMs], "probeNodeStatus")
		const result = await this.request("probeNodeStatus", networkId, timeoutMs)
		return validateResult(NetworkMethodSchemas.probeNodeStatus.result, result, "probeNodeStatus")
	}
}
