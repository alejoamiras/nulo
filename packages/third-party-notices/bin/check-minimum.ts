import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildDirsFor, missingFromNotices, parseMinimum } from "../src/check-minimum.ts"
import { NOTICES_FILE } from "../src/plugin.ts"

function main(args: readonly string[]): number {
	const [target, distRoot] = args
	if (!target || !distRoot || args.length !== 2) {
		console.error("usage: check-minimum.ts <chrome|firefox|both> <dist-root>")
		return 2
	}
	const buildDirs = buildDirsFor(target, distRoot)
	const minimum = parseMinimum(readFileSync(fileURLToPath(new URL("../expected-minimum.txt", import.meta.url)), "utf8"))
	let status = 0
	for (const dir of buildDirs) {
		// A missing file throws: a build without notices must not pass by having nothing to compare.
		const missing = missingFromNotices(readFileSync(join(dir, NOTICES_FILE), "utf8"), minimum)
		if (missing.length === 0) {
			console.log(`✓ ${dir}/${NOTICES_FILE} names all ${minimum.length} expected components`)
			continue
		}
		console.error(`${dir}/${NOTICES_FILE} is missing: ${missing.join(", ")}`)
		status = 1
	}
	return status
}

process.exit(main(process.argv.slice(2)))
