import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import {
	INCOMING_TRANSFER_SERVICE_NAME,
	type Events,
	type IncomingSyncStateChanged,
	type IncomingTransferPending,
	type IncomingTransferRecord,
	type IncomingTrustRecord,
	type Methods,
} from "./spec"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface IncomingTransferServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class IncomingTransferServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onIncomingTransferAdded = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferUpdated = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferDeleted = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferPending = new EventHandler<IncomingTransferPending>()
	public readonly onIncomingTrustChanged = new EventHandler<IncomingTrustRecord>()
	public readonly onIncomingSyncStateChanged = new EventHandler<IncomingSyncStateChanged>()

	public constructor(name?: string) {
		super(INCOMING_TRANSFER_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(IncomingTransferServiceClient.prototype, [
	"getIncomingTransfers",
	"getIncomingTransferById",
	"getReceiptFee",
	"getTrustState",
	"getSyncState",
	"setTrustAllow",
	"setTrustReject",
	"clearProfile",
	"clearChain",
	"replayPendingPrompts",
])
