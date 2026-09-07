import type { ServiceSpec } from "@/wallet/base"
import { ServiceClient } from "@nulo/extension-messaging/background"
import { validateParams, validateResult } from "@nulo/extension-messaging/zod"
import type { ZodType } from "zod"
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

	/** Validates outgoing params and the incoming result against the method's schema; the raw
	 *  params (not zod's copy) are what go over the wire. */
	private async call<K extends keyof Methods & keyof typeof NetworkMethodSchemas>(
		method: K,
		params: Parameters<Methods[K]>,
	): Promise<ReturnType<Methods[K]>> {
		const schema = NetworkMethodSchemas[method] as { params: ZodType<unknown>; result: ZodType<unknown> }
		validateParams(schema.params, params, method)
		const result = await this.request(method, ...params)
		return validateResult(schema.result, result, method) as ReturnType<Methods[K]>
	}

	public async getOrInitNetworks(): Promise<Network[]> {
		return this.call("getOrInitNetworks", [])
	}

	public async getNetworks(chainId?: number): Promise<Network[]> {
		return this.call("getNetworks", [chainId])
	}

	public async getNetwork(id: string): Promise<Network> {
		return this.call("getNetwork", [id])
	}

	public async addNetwork(name: string, rpcUrl: string): Promise<Network> {
		return this.call("addNetwork", [name, rpcUrl])
	}

	public async renameNetwork(id: string, name: string): Promise<Network> {
		return this.call("renameNetwork", [id, name])
	}

	public async deleteNetwork(id: string): Promise<Network> {
		return this.call("deleteNetwork", [id])
	}

	public async setActiveNetwork(id: string): Promise<Network> {
		return this.call("setActiveNetwork", [id])
	}

	public async getActiveNetwork(): Promise<Network | null> {
		return this.call("getActiveNetwork", [])
	}

	public async getPrimaryNetwork(): Promise<Network | null> {
		return this.call("getPrimaryNetwork", [])
	}

	public async setActiveForProfile(profileId: string, networkId: string): Promise<string> {
		return this.call("setActiveForProfile", [profileId, networkId])
	}

	public async addEndpoint(networkId: string, label: string | undefined, rpcUrl: string): Promise<NetworkEndpoint> {
		return this.call("addEndpoint", [networkId, label, rpcUrl])
	}

	public async updateEndpoint(
		networkId: string,
		endpointId: string,
		label: string | undefined,
		rpcUrl: string,
	): Promise<NetworkEndpoint> {
		return this.call("updateEndpoint", [networkId, endpointId, label, rpcUrl])
	}

	public async deleteEndpoint(networkId: string, endpointId: string): Promise<NetworkEndpoint> {
		return this.call("deleteEndpoint", [networkId, endpointId])
	}

	public async setPrimaryEndpoint(networkId: string, endpointId: string): Promise<Network> {
		return this.call("setPrimaryEndpoint", [networkId, endpointId])
	}

	public async getNodeStatus(networkId: string): Promise<NodeStatus> {
		return this.call("getNodeStatus", [networkId])
	}

	public async probeNodeStatus(networkId: string, timeoutMs: number): Promise<NodeStatus> {
		return this.call("probeNodeStatus", [networkId, timeoutMs])
	}
}
