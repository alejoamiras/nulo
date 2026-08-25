// ESM resolution probe, run OUTSIDE any test process and anchored at a workspace directory:
//   bun  resolve-esm.mjs <wsDir> <spec...>                                     (Bun.resolveSync)
//   node --experimental-import-meta-resolve resolve-esm.mjs <wsDir> <spec...>  (import.meta.resolve)
// Prints one JSON object: { engine, resolves: { [spec]: { esm } | { error } } }.
import { pathToFileURL } from "node:url"

const [wsDir, ...specs] = process.argv.slice(2)
if (!wsDir || specs.length === 0) {
	console.error("usage: resolve-esm.mjs <wsDir> <spec...>")
	process.exit(2)
}
const isBun = typeof Bun !== "undefined"
const parent = pathToFileURL(wsDir.endsWith("/") ? wsDir : `${wsDir}/`).href
const resolves = {}
for (const spec of specs) {
	try {
		resolves[spec] = { esm: isBun ? Bun.resolveSync(spec, wsDir) : import.meta.resolve(spec, parent) }
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? String(error.code) : "ERR_RESOLVE"
		const message = error instanceof Error ? error.message : String(error)
		resolves[spec] = { error: `${code}: ${message}` }
	}
}
console.log(JSON.stringify({ engine: isBun ? "bun" : "node", resolves }))
