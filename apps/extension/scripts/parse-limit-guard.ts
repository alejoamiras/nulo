import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"

/**
 * Firefox's add-on linter refuses to parse a file of 5 MiB or more and reports it as an error —
 * so a file that size is also a file nobody scanned. 4.5 MiB leaves room for a dependency bump.
 */
export const PARSE_LIMIT_BYTES = 4_718_592

/** The extensions addons-linter hands to a parsing scanner; everything else is "binary" to it. */
const PARSED_EXTENSIONS = new Set([".html", ".htm", ".js", ".jsm", ".mjs", ".json", ".properties", ".ftl", ".dtd"])

export interface ShippedFile {
	file: string
	bytes: number
}

export const overParseLimit = (files: readonly ShippedFile[]): ShippedFile[] =>
	files.filter(({ file, bytes }) => PARSED_EXTENSIONS.has(path.extname(file).toLowerCase()) && bytes >= PARSE_LIMIT_BYTES)

function shippedFiles(root: string, dir = root): ShippedFile[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) return shippedFiles(root, full)
		return [{ file: path.relative(root, full), bytes: statSync(full).size }]
	})
}

/**
 * Reads the finished output directory rather than the bundle: the manifest plugin emits after
 * every other `generateBundle`, and `public/` is copied to disk without entering the bundle.
 */
export function parseLimitGuard(): Plugin {
	let outDir = ""
	return {
		name: "parse-limit-guard",
		apply: "build",
		enforce: "post",
		configResolved(config) {
			outDir = path.resolve(config.root, config.build.outDir)
		},
		closeBundle() {
			const tooLarge = overParseLimit(shippedFiles(outDir))
			if (!tooLarge.length) return
			const list = tooLarge.map(({ file, bytes }) => `${file} (${bytes} bytes)`).join(", ")
			throw new Error(`file(s) at or over the add-on linter's parse limit (${PARSE_LIMIT_BYTES} bytes): ${list}`)
		},
	}
}
