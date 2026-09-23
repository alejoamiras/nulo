// Vitest reporter that records WHICH engine ran a soak run. It writes `runtime.json` next to
// vitest's own configured JSON output, so no environment variable reaches the test process.
// The launcher spawns its workers with its own `process.execPath`, so this record is the
// runtime record for the whole run.
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export default class RuntimeReporter {
	onInit(ctx) {
		const configured = ctx.config.outputFile
		const jsonFile = typeof configured === "string" ? configured : configured?.json
		if (!jsonFile) throw new Error("runtime-reporter: vitest has no JSON outputFile configured")
		const record = {
			execPath: process.execPath,
			versions: process.versions,
			pool: ctx.config.pool,
			maxWorkers: ctx.config.maxWorkers ?? null,
		}
		writeFileSync(join(dirname(jsonFile), "runtime.json"), JSON.stringify(record))
	}
}
