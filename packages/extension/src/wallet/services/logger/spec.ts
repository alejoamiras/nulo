import type { LogLevel } from "@/wallet/logger"
import type { BatchEntry } from "./batching-forwarder"

export const LOGGER_SERVICE_NAME = "logger"

export type Methods = {
	/**
	 * Proxies the data to the app logger
	 * @param context Execution context ("offscreen" | "popup" | etc.)
	 * @param source Log source (service name)
	 * @param level Log level
	 * @param data Data
	 */
	log(context: string | undefined, source: string, level: LogLevel, ...data: unknown[]): void
	/**
	 * Batched variant — ships many buffered entries in ONE RPC, processed in a
	 * single SW handler turn, so a high-volume producer (the offscreen PXE
	 * block-synchronizer) can't flood the SW event loop with one RPC per line.
	 */
	logBatch(context: string | undefined, entries: BatchEntry[]): void
}
