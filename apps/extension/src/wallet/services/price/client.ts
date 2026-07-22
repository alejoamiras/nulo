import type { ServiceSpec } from "@/wallet/base"
import { ServiceClient } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { PRICE_SERVICE_NAME, type Events, type Methods, type PriceState } from "./spec"

export * from "./spec"
export { getPriceMapEntry, FEE_JUICE_ENTRY } from "./price-map"
export { formatUsdMicro, parseUsdToMicro, tokenAmountToUsdMicro, usdToTokenAmount } from "./convert"

export class PriceServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onQuotesUpdated = new EventHandler<PriceState>()

	public constructor(name?: string) {
		super(PRICE_SERVICE_NAME, new LoggerServiceClient(), name)
	}

	public getQuotes(): Promise<PriceState> {
		return this.request("getQuotes")
	}

	public refreshIfStale(): Promise<PriceState> {
		return this.request("refreshIfStale")
	}
}
