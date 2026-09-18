import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

export interface InstalledPackage {
	name: string
	version: string
	/** The declared licence as one SPDX-shaped string; legacy object and array forms are folded into it. */
	license: string | undefined
	dir: string
	/** A different named package found between the module and the installation root. */
	embedded?: string
}

export type ModuleOrigin = "third-party" | "first-party" | "external" | "virtual"

const NODE_MODULES = "/node_modules/"
const CODE_EXTENSION = /\.([cm]?[jt]sx?|json|html?|css|wasm)$/i
const LICENCE_FILE = /^(licen[sc]e|copying|unlicense)([-._][\w.-]*)?$/i
const NOTICE_FILE = /^notice([-._][\w.-]*)?$/i

/** Bundler ids use forward slashes on every platform; filesystem paths on Windows do not. */
const toPosix = (path: string) => path.replace(/\\/g, "/")

/** The filesystem path behind a bundler module id, or `undefined` when the id is not path-shaped. */
export function modulePath(id: string): string | undefined {
	const bare = toPosix(id.replace(/^\0+/, "").split("?")[0] ?? "")
	return bare.startsWith("/") || /^[A-Za-z]:\//.test(bare) ? bare : undefined
}

/**
 * Where a module's code comes from. Only a file inside `workspaceRoot` and outside every
 * `node_modules` is first-party; a real file anywhere else is `external` and must not vanish.
 */
export function moduleOrigin(path: string, workspaceRoot: string): ModuleOrigin {
	if (path.includes(NODE_MODULES)) return "third-party"
	if (path.startsWith(`${toPosix(workspaceRoot).replace(/\/$/, "")}/`)) return "first-party"
	return existsSync(path) ? "external" : "virtual"
}

function legacyLicence(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry
	if (typeof entry !== "object" || entry === null) return undefined
	const { type } = entry as { type?: unknown }
	return typeof type === "string" ? type : undefined
}

/** npm's pre-SPDX forms (`{ type }`, `licenses: [...]`) still declare a licence; an array offers a choice. */
function declaredLicence(manifest: Record<string, unknown>): string | undefined {
	const single = legacyLicence(manifest.license)
	if (single !== undefined) return single
	if (!Array.isArray(manifest.licenses)) return undefined
	const listed = manifest.licenses.map(legacyLicence)
	if (listed.length === 0 || listed.includes(undefined)) return undefined
	return listed.length === 1 ? listed[0] : `(${listed.join(" OR ")})`
}

function readManifest(dir: string): Omit<InstalledPackage, "embedded"> | undefined {
	const file = join(dir, "package.json")
	if (!existsSync(file)) return undefined
	const raw: unknown = JSON.parse(readFileSync(file, "utf8"))
	if (typeof raw !== "object" || raw === null) return undefined
	const manifest = raw as Record<string, unknown>
	const { name, version } = manifest
	if (typeof name !== "string" || typeof version !== "string") return undefined
	return { name, version, license: declaredLicence(manifest), dir }
}

/**
 * The installed package that owns `path`: the manifest at the installation root, the directory
 * `node_modules/<name>` or `node_modules/@scope/<name>` names. A nearer manifest is never trusted
 * to be the owner, since a package can carry anything in a subdirectory; a nearer manifest naming
 * a DIFFERENT package is reported as `embedded`.
 * @throws when the installation root has no manifest for the name its directory carries.
 */
export function owningPackage(path: string): InstalledPackage {
	const base = path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length
	const segments = path.slice(base).split("/")
	const expected = segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? "")
	const root = path.slice(0, base) + expected
	const owner = readManifest(root)
	if (owner?.name !== expected) throw new Error(`no package.json naming "${expected}" at its installation root`)
	for (let dir = dirname(path); dir.length > root.length; dir = dirname(dir)) {
		const nested = readManifest(dir)
		if (nested && nested.name !== owner.name) return { ...owner, embedded: `${nested.name}@${nested.version}` }
	}
	return owner
}

export interface LicenceFiles {
	/** Files that can carry the permission text itself. */
	licences: string[]
	/** Attribution files reproduced alongside, which never stand in for a licence. */
	notices: string[]
}

function textFiles(dir: string, pattern: RegExp): string[] {
	return readdirSync(dir)
		.filter((entry) => pattern.test(entry) && !CODE_EXTENSION.test(entry))
		.filter((entry) => statSync(join(dir, entry)).isFile() && readFileSync(join(dir, entry), "utf8").trim() !== "")
		.sort()
}

/** Non-empty, non-code licence and notice files at the package root, each in code-point order. */
export function licenceFiles(dir: string): LicenceFiles {
	return { licences: textFiles(dir, LICENCE_FILE), notices: textFiles(dir, NOTICE_FILE) }
}
