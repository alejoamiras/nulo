import { isClientDisconnectRejection } from "@nulo/extension-messaging/errors"
import { getErrorData } from "@nulo/wallet-core/utils"
import { consoleMethods, LogLevel } from "@/wallet/logger"
import { LoggerServiceClient } from "@/wallet/services/logger/client"

/**
 * Routes a page's console output and unhandled rejections into the log pipe under `client`'s tag. A
 * service-worker restart rejects every in-flight request with the disconnect error while the clients
 * reconnect, so those land at debug rather than one error line per request.
 */
export function installConsoleForwarding(client: string): LoggerServiceClient {
	const logger = new LoggerServiceClient(client)
	const hooks = self as unknown as Record<string, (...args: unknown[]) => void>
	for (const [method, level] of consoleMethods) {
		hooks[`nuloOn${method}`] = (...args: unknown[]) => logger.log("ui", level, ...args)
	}
	self.onunhandledrejection = (e: PromiseRejectionEvent) => {
		const level = isClientDisconnectRejection(e.reason) ? LogLevel.Debug : LogLevel.Error
		logger.log("ui", level, getErrorData(e.reason))
	}
	return logger
}
