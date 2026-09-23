import { ServiceClient } from "@nulo/extension-messaging/background"
import { DummyLogger, type ILogger, type LogLevel, trim } from "@/wallet/logger"
import { LOGGER_SERVICE_NAME, type Methods } from "./spec"

export * from "./spec"

/** The `context` tags extension documents put on their log lines. */
export type DocumentLogContext = "popup" | "onboarding" | "offscreen"

/** The document's one port to the logger service. Not exported: a client that built its own
 *  would hold a port nothing closes (`ServiceClient.disconnect()` closes the client's port and
 *  then logs through the logger), one per client for the document's life. We intentionally
 *  don't declare `implements ServiceSpec<Methods>`: `log` here takes the context per call. */
class LoggerServiceClient extends ServiceClient<Methods> {
	public constructor() {
		super(LOGGER_SERVICE_NAME, new DummyLogger())
	}

	public log(context: DocumentLogContext | undefined, source: string, level: LogLevel, ...data: unknown[]) {
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
		return this.request("log", context, source, level, ...(trim(data) as unknown[]))
	}
}

let shared: LoggerServiceClient | undefined

/**
 * This document's logger, tagging its lines `context`. Every view shares one client whose port
 * the first line opens and Chrome closes with the document; callers never disconnect it.
 *
 * A failed line never becomes an unhandled rejection: the pages' rejection handlers log through
 * this same logger, so on a page whose port cannot open each failure would log the next one, for
 * the life of the page. The request promise itself is returned, so a caller that awaits a line
 * still sees it reject.
 */
export function documentLogger(context?: DocumentLogContext): ILogger {
	return {
		log(source, level, ...data) {
			shared ??= new LoggerServiceClient()
			const line = shared.log(context, source, level, ...data)
			line.catch(() => {})
			return line
		},
	}
}

/** Forgets the shared client without disconnecting it, for tests that assert on logger traffic. */
export function _resetDocumentLoggerForTests(): void {
	shared = undefined
}
