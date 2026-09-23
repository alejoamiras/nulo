import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { DummyLogger, type Log } from "@/wallet/logger"
import { EventHandler } from "@nulo/wallet-core/utils"
import { LOG_VIEWER_SERVICE_NAME, type Methods, type Events } from "./spec"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface LogViewerServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class LogViewerServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onLog = new EventHandler<Log>()

	public constructor() {
		super(LOG_VIEWER_SERVICE_NAME, new DummyLogger())
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(LogViewerServiceClient.prototype, ["getLogs", "clearLogs"])
