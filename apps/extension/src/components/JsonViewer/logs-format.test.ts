import { describe, expect, test } from "vitest"
import { LogLevel } from "@/wallet/logger"
import { formatArg, formatLogData, formatLogs, formatSingleLog, getDisplayName, getLogLevelName } from "./logs-format"

describe("JsonViewer/logs-format", () => {
	test("getLogLevelName maps LogLevel enum to UPPERCASE strings", () => {
		expect(getLogLevelName(LogLevel.Debug)).toBe("DEBUG")
		expect(getLogLevelName(LogLevel.Info)).toBe("INFO")
		expect(getLogLevelName(LogLevel.Warn)).toBe("WARN")
		expect(getLogLevelName(LogLevel.Error)).toBe("ERROR")
	})

	test("getLogLevelName falls through to the raw level for unknown values", () => {
		expect(getLogLevelName(99 as unknown as number)).toBe("99")
	})

	test("formatArg JSON-stringifies plain objects", () => {
		expect(formatArg({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}')
	})

	test("formatArg returns empty string for empty arrays", () => {
		expect(formatArg([])).toBe("")
	})

	test("formatArg recursively walks nested arrays", () => {
		expect(formatArg([1, [2, 3]])).toEqual([1, [2, 3]])
	})

	test("formatArg passes primitives through unchanged", () => {
		expect(formatArg("hi")).toBe("hi")
		expect(formatArg(42)).toBe(42)
		expect(formatArg(null)).toBe(null)
	})

	test("formatLogData joins array entries with spaces", () => {
		expect(formatLogData(["a", "b", "c"])).toBe("a b c")
	})

	test("formatLogData returns empty for empty arrays + null/undefined", () => {
		expect(formatLogData([])).toBe("")
		expect(formatLogData(null)).toBe("")
		expect(formatLogData(undefined)).toBe("")
	})

	test("formatSingleLog renders the canonical [time] [source] LEVEL: data shape", () => {
		const fixed = new Date("2026-01-15T10:20:30.450Z").getTime()
		const out = formatSingleLog({ timestamp: fixed, source: "tx", level: LogLevel.Info, data: ["hello"] })
		// Time portion uses local zone via toTimeString; assert structural shape only.
		expect(out).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[tx\] INFO: hello$/)
	})

	test("formatLogs joins entries with newlines", () => {
		const t = Date.now()
		const out = formatLogs([
			{ timestamp: t, source: "a", level: LogLevel.Info, data: ["x"] },
			{ timestamp: t, source: "b", level: LogLevel.Warn, data: ["y"] },
		])
		expect(out.split("\n")).toHaveLength(2)
		expect(out).toContain("[a] INFO: x")
		expect(out).toContain("[b] WARN: y")
	})

	test("getDisplayName('source', value) hyphen-splits and Capitalizes each segment", () => {
		expect(getDisplayName("source", "wallet-sdk")).toBe("Wallet Sdk")
		expect(getDisplayName("source", "account-state")).toBe("Account State")
	})

	test("getDisplayName preserves FPC/PXE/RPC as all-caps", () => {
		expect(getDisplayName("source", "fpc")).toBe("FPC")
		expect(getDisplayName("source", "pxe")).toBe("PXE")
		expect(getDisplayName("source", "rpc")).toBe("RPC")
	})

	test("getDisplayName parenthesizes 'undefined' source", () => {
		expect(getDisplayName("source", "undefined")).toBe("(undefined)")
	})

	test("getDisplayName for level lower-cases then capitalizes", () => {
		expect(getDisplayName("level", "DEBUG")).toBe("Debug")
		expect(getDisplayName("level", "INFO")).toBe("Info")
	})
})
