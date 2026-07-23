import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import {
	INCOMING_TRANSFER_SERVICE_NAME,
	type Events,
	type IncomingTransferPending,
	type IncomingTransferRecord,
	type IncomingTrustRecord,
	type Methods,
} from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const INCOMING_TRANSFER_METHODS = [
	"getIncomingTransfers",
	"getIncomingTransferById",
	"getReceiptFee",
	"getTrustState",
	"setTrustAllow",
	"setTrustReject",
	"clearProfile",
	"clearChain",
	"replayPendingPrompts",
] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _IncomingTransferMethodsExhaustive =
	Exclude<keyof Methods, (typeof INCOMING_TRANSFER_METHODS)[number]> extends never
		? true
		: Exclude<keyof Methods, (typeof INCOMING_TRANSFER_METHODS)[number]>
const _incomingTransferMethodsExhaustive: _IncomingTransferMethodsExhaustive = true
void _incomingTransferMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface IncomingTransferServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class IncomingTransferServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onIncomingTransferAdded = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferUpdated = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferDeleted = new EventHandler<IncomingTransferRecord>()
	public readonly onIncomingTransferPending = new EventHandler<IncomingTransferPending>()
	public readonly onIncomingTrustChanged = new EventHandler<IncomingTrustRecord>()

	public constructor(name?: string) {
		super(INCOMING_TRANSFER_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(IncomingTransferServiceClient.prototype, INCOMING_TRANSFER_METHODS)
