import path from "node:path"

/** The package a module id belongs to — the last `node_modules/` segment, so the isolated linker's `.bun/<pkg>@<ver>/node_modules/<pkg>` resolves to `<pkg>`. */
const PACKAGE = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//

/** The proving, simulation and contract stack: what makes the offscreen page's bundle tens of MB. */
const HEAVY_SCOPES = ["@aztec/", "@noir-lang/", "@aztec-foundation/", "@alejoamiras/"]

/**
 * Whatever chunk holds `@aztec/wallet-sdk` is web-accessible to every page, because the content
 * script imports it — regrouping it would change what any site can read.
 */
const NEVER_GROUPED = new Set(["@aztec/wallet-sdk"])

const slug = (name: string): string => name.replace(/^@/, "").replace(/[^A-Za-z0-9]+/g, "-")

function heavyPackageOf(moduleId: string): { id: string; pkg: string } | null {
	const id = moduleId.split("?")[0].replaceAll("\\", "/")
	const pkg = PACKAGE.exec(id)?.[1]
	if (!pkg || NEVER_GROUPED.has(pkg) || !HEAVY_SCOPES.some((scope) => pkg.startsWith(scope))) return null
	return { id, pkg }
}

/** A JSON module imports nothing, so a chunk of its own can never join an import cycle. */
export function artifactChunkName(moduleId: string): string | null {
	const found = heavyPackageOf(moduleId)
	if (!found?.id.endsWith(".json")) return null
	return `${slug(found.pkg)}-${slug(path.basename(found.id, ".json"))}`
}

export function packageChunkName(moduleId: string): string | null {
	const found = heavyPackageOf(moduleId)
	return found && !found.id.endsWith(".json") ? slug(found.pkg) : null
}

/**
 * Chunks are cut along package boundaries, never by size: package dependencies form a DAG, so the
 * chunks do too. A size cut ignores import cycles inside a package, and two chunks that import
 * each other leave one reading the other's bindings as `undefined`. Compiled circuits and
 * contracts are megabytes apiece, so each JSON module is cut out first — a group otherwise takes
 * its modules' dependencies with it. `entriesAware` keeps a module out of entries that never
 * imported it, so nothing DOM-bound reaches the service worker.
 */
export const vendorChunkGroups = [
	{ name: artifactChunkName, test: (id: string) => artifactChunkName(id) !== null, priority: 2, entriesAware: true },
	{ name: packageChunkName, test: (id: string) => packageChunkName(id) !== null, priority: 1, entriesAware: true },
]
