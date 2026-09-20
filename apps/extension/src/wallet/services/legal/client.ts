import { ServiceClient } from "@nulo/extension-messaging/background"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ServiceSpec } from "@/wallet/base"
import { documentLogger } from "@/wallet/services/logger/client"
import {
	LEGAL_ACCEPTANCE_SERVICE_NAME,
	type Events,
	type LegalAcceptanceRecord,
	type LegalStatus,
	type LegalSurface,
	type Methods,
} from "./spec"

export * from "./spec"

export class LegalAcceptanceServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onAcceptanceChanged = new EventHandler<LegalStatus>()

	public constructor(name?: string) {
		super(LEGAL_ACCEPTANCE_SERVICE_NAME, documentLogger(), name)
	}

	public getStatus(): Promise<LegalStatus> {
		return this.request("getStatus")
	}

	public getRecord(): Promise<LegalAcceptanceRecord | null> {
		return this.request("getRecord")
	}

	public accept(surface: LegalSurface): Promise<LegalAcceptanceRecord> {
		return this.request("accept", surface)
	}
}
