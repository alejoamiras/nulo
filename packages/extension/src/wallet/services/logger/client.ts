import { ServiceClient } from "@nulo/extension-messaging/background"
import { DummyLogger, type ILogger, type LogLevel } from "@/wallet/logger"
import { LOGGER_SERVICE_NAME, type Methods } from "./spec"
import type { BatchEntry } from "./batching-forwarder"

export * from "./spec"

/** LoggerServiceClient implements the pure `ILogger` port. The transport
 *  `Methods` shape is wider (includes `context`); the client binds its
 *  ctor-provided context inside `log()`. We intentionally don't declare
 *  `implements ServiceSpec<Methods>` because the narrower `log` signature
 *  doesn't satisfy the wider transport spec. */
export class LoggerServiceClient extends ServiceClient<Methods> implements ILogger {
	private readonly context?: string

	public constructor(context?: string) {
		super(LOGGER_SERVICE_NAME, new DummyLogger())
		this.context = context
	}

	public log(source: string, level: LogLevel, ...data: unknown[]) {
		return this.request("log", this.context, source, level, ...data)
	}

	/** Ship a batch of buffered entries in one RPC (see {@link BatchEntry}). */
	public logBatch(entries: BatchEntry[]) {
		return this.request("logBatch", this.context, entries)
	}
}
