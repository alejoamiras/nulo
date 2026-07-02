import { LogLevel } from "@/wallet/logger"
import { capitalize } from "@/utils"

export interface LogEntry {
	id?: number
	timestamp: number
	source: string
	level: number
	data: unknown
}

export function getLogLevelName(level: number): string {
	switch (level) {
		case LogLevel.Debug:
			return "DEBUG"
		case LogLevel.Info:
			return "INFO"
		case LogLevel.Warn:
			return "WARN"
		case LogLevel.Error:
			return "ERROR"
		default:
			return String(level)
	}
}

export function formatArg(arg: unknown): unknown {
	if (Array.isArray(arg)) {
		if (!arg.length) return ""
		return arg.map(formatArg)
	}

	if (typeof arg === "object" && arg !== null) {
		try {
			return JSON.stringify(arg)
		} catch {
			return String(arg)
		}
	}

	return arg
}

export function formatLogData(data: unknown): string {
	if (!data) return ""
	if (Array.isArray(data) && data.length) {
		return data
			.map(formatArg)
			.filter((x) => x !== undefined)
			.join(" ")
	}
	return String(formatArg(data) ?? "")
}

export function formatSingleLog(log: LogEntry): string {
	const date = new Date(log.timestamp)
	const time = `${date.toTimeString().slice(0, 8)}.${date.getMilliseconds().toString().padStart(3, "0")}`
	return `[${time}] [${log.source}] ${getLogLevelName(log.level)}: ${formatLogData(log.data)}`
}

export function formatLogs(logs: LogEntry[]): string {
	return logs.map(formatSingleLog).join("\n")
}

/**
 * Pretty-print a filter key (`source`, `level`) for the popover menu.
 * Source values like "wallet-sdk" become "Wallet Sdk", except for the
 * three protocol acronyms (FPC/PXE/RPC) which stay all-caps.
 */
export function getDisplayName(kind: "source" | "level", value: string): string {
	if (kind === "source") {
		if (value === "undefined") return `(${value})`
		return value
			.split("-")
			.map((v) => {
				if (v === "fpc" || v === "pxe" || v === "rpc") return v.toUpperCase()
				return capitalize(v)
			})
			.join(" ")
	}
	return capitalize(value.toLowerCase())
}
