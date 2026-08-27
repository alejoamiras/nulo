/**
 * Pure logger interfaces shared across `@nulo/wallet-core` consumers.
 *
 * Only the interface + enum + type declarations live here — anything a
 * wallet-core consumer (`Lock`, `ReadWriteGuard`, …) needs to type its
 * logger parameter. The chrome-backed `LoggerStore` impl (which uses
 * `chrome.storage.session`) lives in `@nulo/extension`.
 */

import type { EventHandler } from "../utils/event-handler"

export enum LogLevel {
	Debug = 0,
	Info = 1,
	Warn = 2,
	Error = 3,
}

export type LogContext = "sw" | "offscreen" | "popup" | "content"

export type Log = {
	id: number
	timestamp: number
	source: string
	level: LogLevel
	context?: LogContext
	data: unknown[]
}

export interface ILogger {
	log(source: string, level: LogLevel, ...data: unknown[]): void
}

export interface ILoggerStore extends ILogger {
	onLog: EventHandler<Log>
	get(count: number, fromId?: number): Log[]
	clear(): void | Promise<void>
}

/** Console → LogLevel mapping table. Used by the logger adapter in
 *  extension to route console.* calls to the appropriate LogLevel. */
export const consoleMethods: [string, LogLevel][] = [
	["trace", LogLevel.Debug],
	["debug", LogLevel.Debug],
	["log", LogLevel.Info],
	["info", LogLevel.Info],
	["warn", LogLevel.Warn],
	["error", LogLevel.Error],
]
