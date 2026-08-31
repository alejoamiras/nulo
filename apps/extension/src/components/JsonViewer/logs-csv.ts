import { type LogEntry, formatArg, formatLogData, getLogLevelName } from "./logs-format"

const MAX_CELL_LENGTH = 32_760

/**
 * Build CSV text from a list of log entries. Long data values are split
 * into MAX_CELL_LENGTH-wide cells with leading / trailing ellipses so
 * downstream spreadsheets (Excel cell limit is 32_767 chars) don't
 * truncate silently.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 17) — refactor when touched, never raise
export function buildLogsCsv(logs: LogEntry[]): string {
	const rows: [string, string, string, string][] = []

	for (const log of logs) {
		const time = new Date(log.timestamp).toISOString()
		const source = log.source
		const level = getLogLevelName(log.level)
		const data = computeData(log)

		if (data.length <= MAX_CELL_LENGTH) {
			rows.push([time, source, level, data])
			continue
		}

		let i = 0
		while (i < data.length) {
			const chunk = data.slice(i, i + MAX_CELL_LENGTH)
			const isFirst = i === 0
			const isLast = i + MAX_CELL_LENGTH >= data.length

			let chunkWithDots = chunk
			if (isFirst && !isLast) chunkWithDots = `${chunk}...`
			else if (!isFirst && !isLast) chunkWithDots = `...${chunk}...`
			else if (!isFirst && isLast) chunkWithDots = `...${chunk}`

			rows.push([time, source, level, chunkWithDots])
			i += MAX_CELL_LENGTH
		}
	}

	return [["time", "source", "level", "data"], ...rows]
		.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
		.join("\n")
}

function computeData(log: LogEntry): string {
	if (Array.isArray(log.data) && log.data.length) {
		return log.data
			.map(formatArg)
			.filter((x) => x !== undefined)
			.join(" ")
	}
	return formatLogData(log.data)
}
