import type { ServiceSpec } from "@/wallet/base"
import { ServiceClient } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import {
	INCOMING_TRANSFER_SERVICE_NAME,
	type Events,
	type IncomingTransferPending,
	type IncomingTransferRecord,
	type IncomingTrustRecord,
	type IncomingTrustState,
	type Methods,
} from "./spec"

export * from "./spec"

export class IncomingTransferServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onIncomingTransferAdded = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferUpdated = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferDeleted = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferPending = new EventHandler<IncomingTransferPending>()
	public readonly onIncomingTrustChanged = new EventHandler<IncomingTrustRecord>()

	public constructor(name?: string) {
		super(INCOMING_TRANSFER_SERVICE_NAME, new LoggerServiceClient(), name)
	}

	public getIncomingTransfers(
		profileId: string,
		networkId: string,
		accountAddress: string,
		tokenId?: number,
	): Promise<IncomingTransferRecord[]> {
		return this.request("getIncomingTransfers", profileId, networkId, accountAddress, tokenId)
	}

	public getTrustState(profileId: string, networkId: string, contract: string): Promise<IncomingTrustState> {
		return this.request("getTrustState", profileId, networkId, contract)
	}

	public setTrustState(profileId: string, networkId: string, contract: string, state: IncomingTrustState): Promise<void> {
		return this.request("setTrustState", profileId, networkId, contract, state)
	}

	public setTrustAllow(profileId: string, networkId: string, contract: string): Promise<boolean> {
		return this.request("setTrustAllow", profileId, networkId, contract)
	}

	public setTrustReject(profileId: string, networkId: string, contract: string): Promise<boolean> {
		return this.request("setTrustReject", profileId, networkId, contract)
	}

	public clearProfile(profileId: string): Promise<void> {
		return this.request("clearProfile", profileId)
	}

	public clearChain(profileId: string, networkId: string): Promise<void> {
		return this.request("clearChain", profileId, networkId)
	}

	public replayPendingPrompts(profileId: string, networkId: string, accountAddress: string): Promise<void> {
		return this.request("replayPendingPrompts", profileId, networkId, accountAddress)
	}
}
