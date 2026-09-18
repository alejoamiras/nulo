import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

/** A manifest that names a package: the installation root's, or one found below it. */
export interface NamedManifest {
	name: string
	version: string
	/** The declared licence as one SPDX-shaped string; legacy object and array forms are folded into it. */
	license: string | undefined
	/** A licence declaration is present but is not something this reader can state as a string. */
	malformedLicence: boolean
}

export interface InstalledPackage extends NamedManifest {
	dir: string
	/** Every other named manifest between the module and the installation root, nearest first. */
	nested: NamedManifest[]
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

// Everything written into the notices inventory is one line: a manifest field carrying a line
// break or a tab could otherwise forge a row of it.
const PACKAGE_NAME = /^(@[\w.~-]+\/)?[\w.~-]+$/
const PACKAGE_VERSION = /^[\w.+-]+$/
const LICENCE_EXPRESSION = /^[A-Za-z0-9.+() -]+$/

function licenceOf(entry: unknown): string | undefined {
	const value = typeof entry === "object" && entry !== null ? (entry as { type?: unknown }).type : entry
	return typeof value === "string" && LICENCE_EXPRESSION.test(value) ? value : undefined
}

/**
 * npm's pre-SPDX forms (`{ type }`, `licenses: [...]`) still declare a licence; an array offers a
 * choice. A declaration that is present and unreadable is `malformed`, never "absent": absence is
 * what an override may fill, and an unreadable declaration could be hiding anything.
 */
function declaredLicence(manifest: Record<string, unknown>): Pick<NamedManifest, "license" | "malformedLicence"> {
	const declarations = [manifest.license, manifest.licenses].filter((field) => field !== undefined)
	if (declarations.length === 0) return { license: undefined, malformedLicence: false }
	const [first] = declarations
	const listed = (Array.isArray(first) ? first : [first]).map(licenceOf)
	if (listed.length === 0 || listed.includes(undefined)) return { license: undefined, malformedLicence: true }
	return { license: listed.length === 1 ? listed[0] : `(${listed.join(" OR ")})`, malformedLicence: false }
}

function readManifest(dir: string): (NamedManifest & { dir: string }) | undefined {
	const file = join(dir, "package.json")
	if (!existsSync(file)) return undefined
	const raw: unknown = JSON.parse(readFileSync(file, "utf8"))
	if (typeof raw !== "object" || raw === null) return undefined
	const manifest = raw as Record<string, unknown>
	const { name, version } = manifest
	// A bare `{ "type": "module" }` marker names nothing and is not a package.
	if (typeof name !== "string" || typeof version !== "string") return undefined
	if (!PACKAGE_NAME.test(name) || !PACKAGE_VERSION.test(version)) {
		throw new Error(`${file.split("/node_modules/").at(-1)}: name or version is not a single well-formed token`)
	}
	return { name, version, ...declaredLicence(manifest), dir }
}

/**
 * The installed package that owns `path`: the manifest at the installation root, the directory
 * `node_modules/<name>` or `node_modules/@scope/<name>` names. A nearer manifest is never trusted
 * to be the owner, since a package can carry anything in a subdirectory; every one found on the
 * way up is returned in `nested` for the caller to hold against the reviewed records.
 * @throws when the installation root has no manifest for the name its directory carries.
 */
export function owningPackage(path: string): InstalledPackage {
	const base = path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length
	const segments = path.slice(base).split("/")
	const expected = segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? "")
	const root = path.slice(0, base) + expected
	const owner = readManifest(root)
	if (owner?.name !== expected) throw new Error(`no package.json naming "${expected}" at its installation root`)
	const nested: NamedManifest[] = []
	for (let dir = dirname(path); dir.length > root.length; dir = dirname(dir)) {
		const found = readManifest(dir)
		if (found)
			nested.push({ name: found.name, version: found.version, license: found.license, malformedLicence: found.malformedLicence })
	}
	return { ...owner, nested }
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
