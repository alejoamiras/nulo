import { existsSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Layout-agnostic package location. Resolution is anchored at the DECLARING
 * workspace (the caller passes its own `import.meta.url` as `from`), so the
 * result is correct under BOTH the hoisted and the isolated linker — the
 * workspace's own node_modules (real dir or symlink farm) satisfies it, and
 * no repo-root hoisting is ever assumed. This package exists because six
 * independent copies of a root-walking resolver drifted apart; see
 * implementations-plan/isolated-linker-store/recon.md.
 *
 * Discovery deliberately IGNORES exports maps: the whole point is reaching
 * unexported files (wasm binaries, contract artifacts, storage internals) of
 * exactly-pinned packages. Instead of guessing exported entries and ascending
 * from resolved files, it scans `require.resolve.paths(pkg)` — Node's
 * DOCUMENTED ordered package-search locations for the anchor — for the first
 * directory whose `<pkg>/package.json` exists and names the right package.
 */
export interface ResolveOptions {
	/** The caller's `import.meta.url` (or an absolute file path) — anchors resolution at the declaring workspace. */
	from: string
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

/**
 * Absolute path of `pkg`'s package root, resolved from the declaring
 * workspace's ordered search paths. Never consults exports maps and never
 * walks from a resolved file — the first search location with a validated
 * `package.json` wins, which under the isolated linker is the anchor
 * workspace's own (declared-deps-only) node_modules.
 */
export function resolvePackageRoot(pkg: string, options: ResolveOptions): string {
	const require = createRequire(toFileAnchor(options.from))
	const searchPaths = require.resolve.paths(pkg) ?? []
	for (const base of searchPaths) {
		const root = join(base, pkg)
		const manifest = join(root, "package.json")
		if (!existsSync(manifest)) continue
		try {
			const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name
			if (name === pkg) return root
		} catch {
			// Unparseable manifest in a search location; keep scanning.
		}
	}
	throw new Error(
		`resolve-asset: ${pkg} not found in any package-search location of ${toFileAnchor(options.from)} — ` +
			`is it a DECLARED dependency of that workspace? Searched:\n  ${searchPaths.join("\n  ")}`,
	)
}

/**
 * Absolute path of a file inside `pkg`. The file does NOT need to be exported —
 * the package root is found first, then `assetPath` is joined onto it. Throws
 * if the resulting path escapes the package root or does not exist (a missing
 * asset must fail loudly at config-load time, not at bundle-serve time).
 */
export function resolvePackageAsset(pkg: string, assetPath: string, options: ResolveOptions): string {
	const root = resolvePackageRoot(pkg, options)
	const resolved = normalize(join(root, assetPath))
	if (!resolved.startsWith(root + sep) && resolved !== root) {
		throw new Error(`resolve-asset: asset path ${assetPath} escapes the package root of ${pkg}`)
	}
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
		const lockstepReal = realpathSync(resolvePackageRoot(pkg, { from: viaAnchor }))
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

/** True when `path` (a resolved file/dir) lies inside some node_modules directory. */
export function isUnderNodeModules(path: string): boolean {
	return path.split(sep).includes("node_modules")
}
