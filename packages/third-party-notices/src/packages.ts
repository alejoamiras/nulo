import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, sep } from "node:path"

export interface InstalledPackage {
	name: string
	version: string
	/** The `license` field when it is a string; legacy object/array forms read as absent. */
	license: string | undefined
	dir: string
}

const NODE_MODULES = `${sep}node_modules${sep}`
const LICENCE_FILE = /^(licen[sc]e|copying|notice)([.-].*)?$/i

/**
 * The filesystem path behind a bundler module id, or `undefined` for a virtual module.
 * Rolldown ids are real paths, so a workspace package never carries a `node_modules` segment.
 */
export function modulePath(id: string): string | undefined {
	const bare = id.replace(/^\0+/, "").split("?")[0] ?? ""
	return bare.startsWith(sep) || /^[A-Za-z]:[\\/]/.test(bare) ? bare : undefined
}

export function isThirdPartyPath(path: string): boolean {
	return path.includes(NODE_MODULES)
}

function readManifest(dir: string): InstalledPackage | undefined {
	const file = join(dir, "package.json")
	if (!existsSync(file)) return undefined
	const raw: unknown = JSON.parse(readFileSync(file, "utf8"))
	if (typeof raw !== "object" || raw === null) return undefined
	const { name, version, license } = raw as Record<string, unknown>
	// Nested `{ "type": "module" }` markers are not the package; keep walking.
	if (typeof name !== "string" || typeof version !== "string") return undefined
	return { name, version, license: typeof license === "string" ? license : undefined, dir }
}

/**
 * The installed package that owns `path`: the nearest ancestor manifest carrying a name and a
 * version, never looking above the `node_modules` directory the file sits in.
 * @throws when no such manifest exists — an unattributable module is not silently dropped.
 */
export function owningPackage(path: string): InstalledPackage {
	const boundary = path.slice(0, path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length - 1)
	for (let dir = dirname(path); dir.length > boundary.length; dir = dirname(dir)) {
		const found = readManifest(dir)
		if (found) return found
	}
	throw new Error(`no owning package.json found for bundled module ${path.slice(boundary.length + 1)}`)
}

/** Licence, copying and notice files at the package root, in code-point order. */
export function licenceFiles(dir: string): string[] {
	return readdirSync(dir)
		.filter((entry) => LICENCE_FILE.test(entry) && statSync(join(dir, entry)).isFile())
		.sort()
}
