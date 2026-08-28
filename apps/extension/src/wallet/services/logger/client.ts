import { ServiceClient } from "@nulo/extension-messaging/background"
import { DummyLogger, type ILogger, type LogLevel, trim } from "@/wallet/logger"
import { LOGGER_SERVICE_NAME, type Methods } from "./spec"

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
		// Redact HERE, before the RPC serializes.
		//
		// `request()` runs `jsonSanitize` over its params, which flattens an Error to a plain
		// `{name, message, stack}`, expands a typed array into a numeric object, and turns Map/Set
		// into arrays. By the time `LoggerStore.trim()` sees this data in the service worker, every
		// shape it knows how to collapse is already gone — so a stack, or raw key bytes, survive.
		// Popup, onboarding and offscreen all log through this client, which is three of the four
		// contexts: without this, most of the redaction below is bypassed.
		//
		// Deliberately NOT in `BaseServiceClient.request()`: that is the generic path for EVERY
		// client, and redacting there would rewrite live `RestoreSecret` params and break profile
		// restore. The SW re-trims on arrival, which is harmless — trim is stable over its own
		// output.
		return this.request("log", this.context, source, level, ...(trim(data) as unknown[]))
	}
}
