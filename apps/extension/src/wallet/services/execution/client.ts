import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { documentLogger } from "@/wallet/services/logger/client"
import { EXECUTION_SERVICE_NAME, type Methods } from "./spec"

export * from "./spec"

/** A transport deadline for a transfer whose outcome the popup cannot know sooner: proving in the
 *  browser can take minutes. Past it the journal still holds the answer. */
const EXECUTE_TRANSFER_TIMEOUT_MS = 60 * 60_000

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface ExecutionServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class ExecutionServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods> {
	public constructor(name?: string) {
		super(EXECUTION_SERVICE_NAME, documentLogger(), name)
	}

	protected override getRequestTimeoutMs(method: keyof Methods): number {
		return method === "executeTransfer" ? EXECUTE_TRANSFER_TIMEOUT_MS : super.getRequestTimeoutMs(method)
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(ExecutionServiceClient.prototype, [
	"executeTransfer",
	"executeOperations",
	"getGasBalances",
	"peekGasBalances",
	"estimateTransferFee",
	"estimateOperationFee",
	"previewOperationAuthwits",
	"decodeCallsForDisplay",
	"cancelJob",
	"cancelEstimate",
	"getLastProveOutcome",
])
