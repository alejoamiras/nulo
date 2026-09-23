/**
 * The package a module id belongs to and the module's path inside it — split at the last
 * `node_modules/` segment, so the isolated linker's `.bun/<pkg>@<ver>/node_modules/<pkg>` resolves
 * to `<pkg>`.
 */
const PACKAGE = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/

/** The proving, simulation and contract stack: what makes the offscreen page's bundle tens of MB. */
const HEAVY_SCOPES = ["@aztec/", "@noir-lang/", "@aztec-foundation/", "@alejoamiras/"]

/**
 * Whatever chunk holds `@aztec/wallet-sdk` is web-accessible to every page, because the content
 * script imports it — regrouping it would change what any site can read.
 */
const NEVER_GROUPED = new Set(["@aztec/wallet-sdk"])

const slug = (name: string): string => name.replace(/^@/, "").replace(/[^A-Za-z0-9]+/g, "-")

function heavyModule(moduleId: string): { pkg: string; file: string } | null {
	const id = moduleId.split("?")[0].replaceAll("\\", "/")
	const [, pkg, file] = PACKAGE.exec(id) ?? []
	if (!pkg || NEVER_GROUPED.has(pkg) || !HEAVY_SCOPES.some((scope) => pkg.startsWith(scope))) return null
	return { pkg, file }
}

/**
 * A JSON module imports nothing, so a chunk of its own can never join an import cycle. Named by
 * its whole path inside the package: two artifacts that share a base name must not share a chunk.
 */
export function artifactChunkName(moduleId: string): string | null {
	const found = heavyModule(moduleId)
	if (!found?.file.endsWith(".json")) return null
	return `${slug(found.pkg)}-${slug(found.file.slice(0, -".json".length))}`
}

export function packageChunkName(moduleId: string): string | null {
	const found = heavyModule(moduleId)
	return found && !found.file.endsWith(".json") ? slug(found.pkg) : null
}

/**
 * Chunks are cut along package boundaries, never by size. A size cut slices through the import
 * cycles inside a package, and two chunks that import each other leave one reading the other's
 * bindings as `undefined`. Package boundaries cross far fewer cycles but are no proof of none —
 * packages can depend on each other, and a group takes its modules' dependencies with it —
 * so `chunkCycleGuard` is what holds the line, not this grouping.
 *
 * Compiled circuits and contracts are megabytes apiece, so each JSON module is cut out first
 * (higher priority), before a package group can carry it along. `entriesAware` keeps a module out
 * of entries that never imported it, so nothing DOM-bound reaches the service worker.
 */
export const vendorChunkGroups = [
	{ name: artifactChunkName, test: (id: string) => artifactChunkName(id) !== null, priority: 2, entriesAware: true },
	{ name: packageChunkName, test: (id: string) => packageChunkName(id) !== null, priority: 1, entriesAware: true },
]
