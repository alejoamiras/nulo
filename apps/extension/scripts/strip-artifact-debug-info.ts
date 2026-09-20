import { realpathSync } from "node:fs"
import { type Plugin, normalizePath } from "vite"

interface CompiledFunction {
	debug_symbols?: string
}

/**
 * A compiled contract artifact carries its Noir sources (`file_map`) and per-function opcode
 * locations (`debug_symbols`), which only put source snippets into simulation error traces. A JSON
 * import is one module, so the bundler cannot split it, and with them a token artifact alone
 * exceeds the size above which Firefox's add-on linter refuses to parse a file. The result is the
 * shape `@aztec/stdlib` itself uses for "no debug info": it skips the trace, it does not throw.
 * The class id depends on neither field.
 */
export function withoutDebugInfo(artifactJson: string): string {
	const artifact = JSON.parse(artifactJson)
	const functions = (artifact.functions as CompiledFunction[]).map((fn) => ({ ...fn, debug_symbols: "" }))
	return JSON.stringify({ ...artifact, functions, file_map: {} })
}

/** Package files resolve through workspace symlinks; Vite hands plugins the real path. */
const canonical = (file: string): string => normalizePath(realpathSync(file))

/**
 * Strips debug info from exactly the given artifact files. Fails the build when one of them was
 * never transformed: a path that stopped matching would otherwise ship the full artifact silently.
 */
export function stripArtifactDebugInfo(artifactFiles: readonly string[]): Plugin {
	const targets = new Set(artifactFiles.map(canonical))
	const seen = new Set<string>()
	let building = false
	return {
		name: "strip-artifact-debug-info",
		enforce: "pre",
		configResolved(config) {
			building = config.command === "build"
		},
		transform(code, id) {
			const file = normalizePath(id.split("?")[0])
			if (!targets.has(file)) return
			seen.add(file)
			return { code: withoutDebugInfo(code), map: null }
		},
		buildEnd(error) {
			if (error || !building) return
			const missed = [...targets].filter((file) => !seen.has(file))
			if (missed.length) this.error(`contract artifact(s) never reached the debug-info strip: ${missed.join(", ")}`)
		},
	}
}
