import { describe, expect, test } from "vitest"
import { LogLevel } from "@/wallet/logger"
import { buildLogsCsv } from "./logs-csv"

const T = new Date("2026-01-15T10:20:30.450Z").getTime()

describe("JsonViewer/logs-csv", () => {
	test("emits a header row + one row per log", () => {
		const csv = buildLogsCsv([
			{ timestamp: T, source: "tx", level: LogLevel.Info, data: ["hi"] },
			{ timestamp: T, source: "tx", level: LogLevel.Warn, data: ["bye"] },
		])
		const lines = csv.split("\n")
		expect(lines).toHaveLength(3)
		expect(lines[0]).toBe('"time","source","level","data"')
	})

	test("escapes embedded double-quotes by doubling them", () => {
		const csv = buildLogsCsv([{ timestamp: T, source: "tx", level: LogLevel.Info, data: ['he said "hi"'] }])
		expect(csv).toContain('"he said ""hi"""')
	})

	test("uses ISO timestamp", () => {
		const csv = buildLogsCsv([{ timestamp: T, source: "x", level: LogLevel.Info, data: ["y"] }])
		expect(csv).toContain('"2026-01-15T10:20:30.450Z"')
	})

	test("level column shows the uppercase label", () => {
		const csv = buildLogsCsv([{ timestamp: T, source: "x", level: LogLevel.Error, data: ["boom"] }])
		expect(csv).toContain('"ERROR"')
	})

	test("splits oversized data into multiple rows with ellipses", () => {
		const big = "A".repeat(32_760 * 2 + 100)
		const csv = buildLogsCsv([{ timestamp: T, source: "x", level: LogLevel.Info, data: [big] }])
		const lines = csv.split("\n")
		// 1 header + 3 chunked rows
		expect(lines).toHaveLength(4)
		expect(lines[1]).toContain("...")
		expect(lines[1].endsWith('..."')).toBe(true)
		expect(lines[3].includes('"...')).toBe(true)
	})

	test("empty log list yields just the header row", () => {
		const csv = buildLogsCsv([])
		expect(csv).toBe('"time","source","level","data"')
	})

	test("non-array data is stringified into a single row", () => {
		const csv = buildLogsCsv([{ timestamp: T, source: "x", level: LogLevel.Info, data: { id: 1 } }])
		expect(csv).toContain('"{""id"":1}"')
	})

	test("null data yields an empty data cell", () => {
		const csv = buildLogsCsv([{ timestamp: T, source: "x", level: LogLevel.Info, data: null }])
		expect(csv).toContain('"INFO",""')
	})
})
