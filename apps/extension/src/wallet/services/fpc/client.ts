import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Events, FPC_SERVICE_NAME, type FpcInfo, type Methods } from "./spec"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface FpcServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class FpcServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onFpcAdded = new EventHandler<FpcInfo>()
	public readonly onFpcUpdated = new EventHandler<FpcInfo>()
	public readonly onFpcDeleted = new EventHandler<FpcInfo>()

	public constructor(name?: string) {
		super(FPC_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(FpcServiceClient.prototype, [
	"getFpcs",
	"getFpc",
	"addFpc",
	"updateFpc",
	"updateFpcAddress",
	"deleteFpc",
])
