import type { ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { DummyLogger, type LogLevel, type LoggerStore } from "@/wallet/logger"
import { LOGGER_SERVICE_NAME, type Methods } from "./spec"
import type { BatchEntry } from "./batching-forwarder"

export * from "./spec"

/** LoggerService implements the RPC surface only (wider signature with `context`).
 *  Callers that want the pure `ILogger` port (narrow `(source, level, ...data) => void`)
 *  should use `LoggerServiceClient`, which binds its ctor-provided context. */
export class LoggerService extends Service<Methods> implements ServiceSpec<Methods> {
	public static name = LOGGER_SERVICE_NAME

	private readonly _logger: LoggerStore

	public constructor(logger: LoggerStore) {
		super(LOGGER_SERVICE_NAME, new DummyLogger())
		this._logger = logger
	}

	public async log(context: string | undefined, source: string, level: LogLevel, ...data: unknown[]) {
		this._logger.logWithContext(context, source, level, ...data)
	}

	/** Process a batch in ONE handler turn — N entries, one event-loop wake. */
	public async logBatch(context: string | undefined, entries: BatchEntry[]) {
		for (const e of entries) this._logger.logWithContext(context, e.source, e.level, ...e.data)
	}
}
