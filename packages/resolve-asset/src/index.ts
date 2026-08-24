import { existsSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Layout-agnostic package location. Resolution is anchored at the DECLARING
 * workspace (the caller passes its own `import.meta.url` as `from`), so the
 * result is correct under BOTH the hoisted and the isolated linker — the
 * workspace's own node_modules (real dir or symlink farm) satisfies it, and
 * no repo-root hoisting is ever assumed. This package exists because six
 * independent copies of a root-walking resolver drifted apart; see
 * implementations-plan/isolated-linker-store/recon.md.
 */
export interface ResolveOptions {
	/** The caller's `import.meta.url` (or an absolute file path) — anchors resolution at the declaring workspace. */
	from: string
	/**
	 * Exported subpath to anchor root-discovery when the package's exports map
	 * blocks `./package.json` AND has no usable `.` export (e.g. `@aztec/pxe`
	 * exports only subpaths; `@aztec/sqlite3mc-wasm`'s `.` is import-condition-only).
	 */
	entry?: string
}

/**
 * Normalizes an anchor into something `createRequire` accepts. Callers pass
 * `import.meta.url`, which is a `file:` URL under Node/Bun — but under a
 * vite-node transform (vitest jsdom env, the vite dev server) it can be an
 * `http://<host>/@fs/<abs-path>` URL. `/@fs/` embeds the real filesystem path,
 * so it normalizes losslessly.
 */
function toFileAnchor(from: string): string {
	if (from.startsWith("file:")) return fileURLToPath(from)
	const fsMarker = from.match(/^https?:\/\/[^/]+\/@fs(\/.*)$/)
	if (fsMarker?.[1]) return decodeURIComponent(fsMarker[1])
	if (from.startsWith("http://") || from.startsWith("https://")) {
		throw new Error(
			`resolve-asset: anchor ${from} is a served URL without an /@fs/ filesystem path — pass a file: URL or absolute path instead`,
		)
	}
	return from
}

function baseDirOf(from: string): string {
	return dirname(toFileAnchor(from))
}

function ascendToPackageRoot(startFile: string, pkg: string): string {
	let dir = dirname(startFile)
	while (dir !== dirname(dir)) {
		const manifest = join(dir, "package.json")
		if (existsSync(manifest)) {
			try {
				const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name
				if (name === pkg) return dir
			} catch {
				// Unparseable package.json mid-ascent (e.g. a fixture); keep climbing.
			}
		}
		dir = dirname(dir)
	}
	throw new Error(`resolve-asset: walked to filesystem root without finding the package.json of ${pkg}`)
}

/**
 * Absolute path of `pkg`'s package root, resolved from the declaring workspace.
 * Tries `<pkg>/package.json` first; on an exports-map block, resolves the
 * `entry` subpath (required in that case) and ascends to the matching root.
 */
export function resolvePackageRoot(pkg: string, options: ResolveOptions): string {
	const require = createRequire(toFileAnchor(options.from))
	// Attempt 1: packages whose exports map does not block ./package.json (or have none).
	try {
		return dirname(require.resolve(`${pkg}/package.json`))
	} catch {
		// Attempt 2: exports-mapped packages whose "." satisfies the require
		// condition set (the patched @aztec/noir-* shape: "." with a node condition).
		try {
			return ascendToPackageRoot(require.resolve(pkg), pkg)
		} catch {
			// Attempt 3: packages with NO usable "." under require (@aztec/pxe has no
			// "." at all; @aztec/sqlite3mc-wasm's "." is import-condition-only) —
			// the caller must anchor via an exported subpath.
			if (!options.entry) {
				throw new Error(
					`resolve-asset: ${pkg} blocks ./package.json and its "." export is unusable under require; ` +
						`pass an { entry } anchor — an exported subpath such as { entry: "./vendor/jswasm/sqlite3.wasm" }.`,
				)
			}
			const anchor = require.resolve(`${pkg}/${options.entry.replace(/^\.\//, "")}`)
			return ascendToPackageRoot(anchor, pkg)
		}
	}
}

/**
 * Absolute path of a file inside `pkg`. The file does NOT need to be exported —
 * the package root is found first, then `assetPath` is joined onto it. Throws
 * if the resulting file does not exist (a missing asset must fail loudly at
 * config-load time, not at bundle-serve time).
 */
export function resolvePackageAsset(pkg: string, assetPath: string, options: ResolveOptions): string {
	const root = resolvePackageRoot(pkg, options)
	const resolved = join(root, assetPath)
	if (!existsSync(resolved)) {
		throw new Error(`resolve-asset: ${pkg} resolved to ${root} but ${assetPath} does not exist inside it`)
	}
	return resolved
}

/**
 * Direct resolution of an EXPORTED subpath (condition-less asset exports like
 * `@aztec/sqlite3mc-wasm`'s `./vendor/jswasm/*`). Prefer this over
 * resolvePackageAsset when the asset itself is in the exports map.
 */
export function resolveExportedAsset(pkg: string, subpath: string, options: ResolveOptions): string {
	const require = createRequire(toFileAnchor(options.from))
	return require.resolve(`${pkg}/${subpath.replace(/^\.\//, "")}`)
}

export interface IdentityOptions extends ResolveOptions {
	/** Assert the resolved package.json version equals this exactly. */
	expectVersion?: string
	/** Relative file that must exist AND contain this marker (e.g. a patch marker). */
	mustContain?: { file: string; marker: string }
	/**
	 * Lockstep guard: re-resolve the same package anchored INSIDE this
	 * intermediary package and assert both resolutions realpath to the same
	 * directory. Catches a future manifest/pin skew between a direct
	 * declaration and the copy an intermediary consumes.
	 */
	lockstepVia?: string
}

export interface IdentityReport {
	root: string
	realRoot: string
	version: string
	lockstepRealRoot?: string
}

/**
 * Verifies a package's on-disk identity from the caller's workspace and
 * returns the evidence. Throws with a precise message on any mismatch —
 * these assertions are the executable form of the layout migration's
 * "right file from the right package" guarantee.
 */
export function assertPackageIdentity(pkg: string, options: IdentityOptions): IdentityReport {
	const root = resolvePackageRoot(pkg, options)
	const realRoot = realpathSync(root)
	const manifest = JSON.parse(readFileSync(join(realRoot, "package.json"), "utf8")) as {
		name?: string
		version?: string
	}
	if (manifest.name !== pkg) {
		throw new Error(`resolve-asset: identity mismatch — ${root} claims to be ${manifest.name}, expected ${pkg}`)
	}
	const version = manifest.version ?? ""
	if (options.expectVersion && version !== options.expectVersion) {
		throw new Error(`resolve-asset: ${pkg} is ${version}, expected ${options.expectVersion}`)
	}
	if (options.mustContain) {
		const target = join(realRoot, options.mustContain.file)
		if (!existsSync(target)) {
			throw new Error(`resolve-asset: ${pkg} is missing ${options.mustContain.file}`)
		}
		if (!readFileSync(target, "utf8").includes(options.mustContain.marker)) {
			throw new Error(`resolve-asset: ${pkg}/${options.mustContain.file} lacks the expected marker`)
		}
	}
	const report: IdentityReport = { root, realRoot, version }
	if (options.lockstepVia) {
		const viaRoot = resolvePackageRoot(options.lockstepVia, { from: options.from })
		// Anchor inside the intermediary so ITS dependency edge does the resolving.
		const viaAnchor = join(viaRoot, "package.json")
		const lockstepRoot = resolvePackageRoot(pkg, { from: viaAnchor, entry: options.entry })
		const lockstepReal = realpathSync(lockstepRoot)
		report.lockstepRealRoot = lockstepReal
		if (lockstepReal !== realRoot) {
			throw new Error(
				`resolve-asset: lockstep violation — ${pkg} resolves to ${realRoot} directly but to ${lockstepReal} through ${options.lockstepVia}. ` +
					`A pin/manifest skew has split the copies.`,
			)
		}
	}
	return report
}

/** True when `path` (a resolved file/dir) lies inside some node_modules directory of `root`. */
export function isUnderNodeModules(path: string): boolean {
	return path.split(sep).includes("node_modules")
}

export { baseDirOf as _baseDirOfForTests }
