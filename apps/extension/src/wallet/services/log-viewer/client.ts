import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { DummyLogger, type Log } from "@/wallet/logger"
import { EventHandler } from "@nulo/wallet-core/utils"
import { LOG_VIEWER_SERVICE_NAME, type Methods, type Events } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const LOG_VIEWER_METHODS = ["getLogs", "clearLogs"] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _LogViewerMethodsExhaustive =
	Exclude<keyof Methods, (typeof LOG_VIEWER_METHODS)[number]> extends never
		? true
		: Exclude<keyof Methods, (typeof LOG_VIEWER_METHODS)[number]>
const _logViewerMethodsExhaustive: _LogViewerMethodsExhaustive = true
void _logViewerMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface LogViewerServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class LogViewerServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onLog = new EventHandler<Log>()

	public constructor() {
		super(LOG_VIEWER_SERVICE_NAME, new DummyLogger())
	}
}
definePassthroughs<Methods>(LogViewerServiceClient.prototype, LOG_VIEWER_METHODS)
