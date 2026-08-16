import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { DAPP_SESSION_SERVICE_NAME, type DappSession, type Events, type Methods } from "./spec"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface DappSessionServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class DappSessionServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onDappSessionAdded = new EventHandler<DappSession>()
	public readonly onDappSessionUpdated = new EventHandler<DappSession>()
	public readonly onDappSessionDeleted = new EventHandler<DappSession>()

	public constructor(name?: string) {
		super(DAPP_SESSION_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(DappSessionServiceClient.prototype, [
	"getDappSessions",
	"getDappSession",
	"addDappSession",
	"updateDappSession",
	"deleteDappSession",
	"setVerificationHash",
	"setTrustedVerification",
	"setAccountAliases",
	"setCapabilityGrants",
	"getCapabilityGrants",
	"setCapabilityRejections",
	"getCapabilityRejections",
])
