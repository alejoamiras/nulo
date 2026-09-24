#!/usr/bin/env bun
/**
 * Stages workspace packages as their public npm packages, ready for `npm pack`:
 *
 *   bun scripts/publish/stage.ts <dir>... --version X.Y.Z [--out <root>]
 *
 * writes `<root>/<dir>/` (default root `dist-publish/`): an ESM bundle per entry with `@aztec/*` and
 * `zod` left as bare imports, declarations rewritten for Node ESM resolution, a generated manifest
 * (exact `@aztec/*` peers taken from the workspace pins), README, LICENSE and NOTICE. Run it from
 * the repository root: the bundler names each module by its cwd-relative path, so any other cwd
 * would change the bytes the approved digests bind and could leak a local path into a tarball.
 */
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { BunPlugin } from "bun"
import { VERSION_RE } from "./check-digests"
import { PACKAGES, type PublishedPackage, packageByDir } from "./packages"

export const REPO_ROOT = resolve(import.meta.dir, "../..")
/** Present in every directory this script created; nothing without it is ever deleted. */
export const STAGING_MARKER = ".nulo-staged"
const REPOSITORY = "alejoamiras/nulo"
const EXACT_PIN_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const RANGE_RE = /^\^?\d+\.\d+\.\d+$/
const AZGUARD_NOTICE = /^\/\/ Modified from Azguard Wallet \(/
/** Metafile input keys are cwd-relative, and the cwd is the repository root. */
const SOURCE_INPUT = /^packages\/[a-z0-9-]+\/src\//
const RELATIVE_SPECIFIER = /((?:from|import)\s*\(?\s*)(["'])(\.{1,2}\/[^"']+)\2/g
const DECLARATION_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g

export interface StagedPackage {
	/** Absolute path of the staged package directory. */
	path: string
	manifest: Record<string, unknown>
}

/** `@scope/name` or `name` from a bare specifier (`@aztec/foundation/crypto/sha512` → `@aztec/foundation`). */
export function packageNameOf(specifier: string): string {
	const parts = specifier.split("/")
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
}

function isBundledExternal(name: string): boolean {
	return name.startsWith("@aztec/") || name === "zod"
}

const emittedName = (source: string) => `${basename(source, ".ts")}.js`

function isInside(child: string, parent: string): boolean {
	const rel = relative(parent, child)
	return rel === "" || !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
}

function lexists(path: string): boolean {
	try {
		lstatSync(path)
		return true
	} catch {
		return false
	}
}

/**
 * `realpath` of a path whose tail may not exist yet, so a symlinked parent cannot hide where it
 * lands; a dangling symlink on the way throws rather than resolving to wherever it would point.
 */
function realPathAllowingMissing(path: string): string {
	const missing: string[] = []
	let at = resolve(path)
	while (!lexists(at) && dirname(at) !== at) {
		missing.unshift(basename(at))
		at = dirname(at)
	}
	return join(realpathSync(at), ...missing)
}

/** Replaces `out` only when it is a staging directory, never anything in the repository but `dist-publish/`. */
function prepareOut(out: string): void {
	const real = realPathAllowingMissing(out)
	const repo = realpathSync(REPO_ROOT)
	if (isInside(real, repo) && !isInside(real, join(repo, "dist-publish"))) {
		throw new Error(`refusing to stage into ${relative(repo, real) || "."}: inside the repository only dist-publish/ is replaced`)
	}
	if (existsSync(out) && readdirSync(out).length > 0 && !existsSync(join(out, STAGING_MARKER))) {
		throw new Error(`refusing to replace ${out}: it has no ${STAGING_MARKER}, so this script did not create it`)
	}
	rmSync(out, { recursive: true, force: true })
	mkdirSync(join(out, "dist"), { recursive: true })
	writeFileSync(join(out, STAGING_MARKER), "")
}

/** Entries import each other by their emitted file, so a package with two entries ships one copy of the shared code. */
function siblingEntriesExternal(entryFiles: Map<string, string>): BunPlugin {
	return {
		name: "sibling-entries-external",
		setup(build) {
			build.onResolve({ filter: /^\.\.?\// }, (args) => {
				const target = resolve(dirname(args.importer), args.path)
				const emitted = entryFiles.get(target) ?? entryFiles.get(`${target}.ts`) ?? entryFiles.get(target.replace(/\.js$/, ".ts"))
				return emitted ? { path: `./${emitted}`, external: true } : undefined
			})
		},
	}
}

/**
 * Only workspace source may be inlined, each file into one bundle: anything else is third-party code
 * shipped without its licence or dependency entry, a builtin polyfill, or a second copy of a module.
 * Returns the Azguard notices of the inlined sources, per output.
 */
function inlinedNotices(pkg: PublishedPackage, outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }>) {
	const owner = new Map<string, string>()
	const notices = new Map<string, Set<string>>()
	for (const [output, meta] of Object.entries(outputs)) {
		const inlined = Object.entries(meta.inputs)
			.filter(([, { bytesInOutput }]) => bytesInOutput > 0)
			.map(([input]) => input)
		for (const input of inlined) {
			if (!SOURCE_INPUT.test(input)) throw new Error(`${pkg.dir}: ${output} inlines ${input}; only packages/*/src may be bundled`)
			const other = owner.get(input)
			if (other !== undefined) throw new Error(`${pkg.dir}: ${input} is inlined into both ${other} and ${output}`)
			owner.set(input, output)
		}
		const found = inlined.map((input) => azguardNoticeOf(resolve(REPO_ROOT, input)))
		notices.set(output, new Set(found.filter((n) => n !== undefined)))
	}
	return notices
}

async function bundle(pkg: PublishedPackage, pkgRoot: string, distDir: string): Promise<string[]> {
	const entryFiles = new Map(pkg.entries.map((e) => [join(pkgRoot, e.source), emittedName(e.source)]))
	const result = await Bun.build({
		entrypoints: [...entryFiles.keys()],
		outdir: distDir,
		format: "esm",
		target: pkg.target,
		external: ["@aztec/*", "zod"],
		naming: "[name].[ext]",
		plugins: [siblingEntriesExternal(entryFiles)],
		metafile: true,
	})
	if (!result.success) throw new Error(`${pkg.dir}: bundle failed\n${result.logs.join("\n")}`)
	const outputs = result.metafile?.outputs ?? {}
	const expected = [...entryFiles.values()].map((f) => `./${f}`).sort()
	if (JSON.stringify(Object.keys(outputs).sort()) !== JSON.stringify(expected)) {
		throw new Error(`${pkg.dir}: bundle emitted ${Object.keys(outputs).join(", ")}, expected exactly ${expected.join(", ")}`)
	}
	const written: string[] = []
	for (const [output, notices] of inlinedNotices(pkg, outputs)) {
		const file = resolve(distDir, output)
		writeFileSync(file, [...notices, readFileSync(file, "utf8")].join("\n"))
		written.push(file)
	}
	return written
}

/** The package a bundle import needs installed, or undefined when it needs none; throws on anything else. */
function importedPackage(pkg: PublishedPackage, siblings: Set<string>, path: string): string | undefined {
	if (siblings.has(path)) return undefined
	if (path.startsWith("node:")) {
		if (pkg.target === "node") return undefined
		throw new Error(`${pkg.dir}: browser bundle imports ${path}`)
	}
	const name = packageNameOf(path)
	if (!isBundledExternal(name)) {
		throw new Error(`${pkg.dir}: bundle imports ${path}, which is neither @aztec/*, zod nor a sibling entry`)
	}
	return name
}

/** Bare package names the bundle imports; throws on anything a consumer could not install. */
function bundleImports(pkg: PublishedPackage, files: string[]): Set<string> {
	const transpiler = new Bun.Transpiler({ loader: "js" })
	const siblings = new Set(pkg.entries.map((e) => `./${emittedName(e.source)}`))
	const names = new Set<string>()
	for (const file of files) {
		for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
			const name = importedPackage(pkg, siblings, path)
			if (name !== undefined) names.add(name)
		}
	}
	return names
}

/** Declarations only, into their own directory, whatever `tsconfig.publish.json` says. */
function emitDeclarations(pkg: PublishedPackage, pkgRoot: string, typesDir: string): void {
	const tsc = join(pkgRoot, "node_modules/typescript/bin/tsc")
	const flags = ["--outDir", typesDir, "--declaration", "--emitDeclarationOnly", "--declarationMap", "false", "--removeComments"]
	const run = Bun.spawnSync([process.execPath, tsc, "-p", join(pkgRoot, "tsconfig.publish.json"), ...flags], {
		cwd: pkgRoot,
		stdout: "pipe",
		stderr: "pipe",
	})
	if (run.exitCode !== 0) throw new Error(`${pkg.dir}: tsc failed\n${run.stdout.toString()}${run.stderr.toString()}`)
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
function filesUnder(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((f) => statSync(join(dir, f)).isFile())
		.map((f) => f.split(sep).join("/"))
		.sort()
}

/** The source's Azguard modification notice, when it carries one: declarations are derived from it too. */
function azguardNoticeOf(sourceFile: string): string | undefined {
	if (!existsSync(sourceFile)) return undefined
	const firstLine = readFileSync(sourceFile, "utf8").split("\n", 1)[0] ?? ""
	return AZGUARD_NOTICE.test(firstLine) ? firstLine : undefined
}

/** Node ESM resolves relative imports inside declarations as it does in JS: extensions are required. */
function withExplicitExtensions(typesDir: string, file: string, text: string): string {
	return text.replace(RELATIVE_SPECIFIER, (_, lead, quote, spec: string) => {
		if (/\.(js|json)$/.test(spec)) return `${lead}${quote}${spec}${quote}`
		const suffix = existsSync(join(typesDir, dirname(file), spec, "index.d.ts")) ? "/index.js" : ".js"
		return `${lead}${quote}${spec}${suffix}${quote}`
	})
}

/** Declarations reachable from the entries' own; tsc also emits one per imported source file. */
function reachableDeclarations(pkg: PublishedPackage, declarations: Map<string, string>): Set<string> {
	const reachable = new Set<string>()
	const queue = pkg.entries.map((e) => `${basename(e.source, ".ts")}.d.ts`)
	for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
		if (reachable.has(file)) continue
		const text = declarations.get(file)
		if (text === undefined) throw new Error(`${pkg.dir}: tsc emitted no ${file}`)
		reachable.add(file)
		for (const [, spec] of text.matchAll(DECLARATION_SPECIFIER)) {
			if (spec?.startsWith(".")) queue.push(join(dirname(file), spec.replace(/\.js$/, ".d.ts")).split(sep).join("/"))
		}
	}
	return reachable
}

/** Bare package names a declaration references; throws on a private or uninstallable one. */
function declarationPackages(pkg: PublishedPackage, file: string, text: string): string[] {
	if (text.includes("@nulo/")) throw new Error(`${pkg.dir}: ${file} references a private @nulo/* package`)
	const names: string[] = []
	for (const [, spec] of text.matchAll(DECLARATION_SPECIFIER)) {
		if (spec === undefined || spec.startsWith(".")) continue
		const name = packageNameOf(spec)
		if (!isBundledExternal(name)) throw new Error(`${pkg.dir}: ${file} references ${spec}`)
		names.push(name)
	}
	return names
}

/**
 * Moves the declarations the entries reach from `typesDir` into `distDir`, rewritten for Node ESM
 * and headed with their source's Azguard notice; the rest are dropped. Returns them and the bare
 * package names they reference.
 */
function finishDeclarations(pkg: PublishedPackage, pkgRoot: string, typesDir: string, distDir: string) {
	const emitted = filesUnder(typesDir)
	const stray = emitted.filter((f) => !f.endsWith(".d.ts"))
	if (stray.length > 0) throw new Error(`${pkg.dir}: tsc emitted ${stray.join(", ")}`)
	const declarations = new Map(emitted.map((f) => [f, withExplicitExtensions(typesDir, f, readFileSync(join(typesDir, f), "utf8"))]))
	const reachable = reachableDeclarations(pkg, declarations)
	const names = new Set<string>()
	for (const file of reachable) {
		const text = declarations.get(file) ?? ""
		for (const name of declarationPackages(pkg, file, text)) names.add(name)
		const notice = azguardNoticeOf(join(pkgRoot, "src", file.replace(/\.d\.ts$/, ".ts")))
		mkdirSync(dirname(join(distDir, file)), { recursive: true })
		writeFileSync(join(distDir, file), notice === undefined ? text : `${notice}\n${text}`)
	}
	rmSync(typesDir, { recursive: true, force: true })
	return { declarations: reachable, names }
}

function sortedRecord(entries: [string, string][]): Record<string, string> {
	return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/**
 * `@aztec/*` become exact peers (the consumer must share one instance of each: `Fr`, `WalletSchema`
 * and the zod schemas are compared by identity); zod stays a dependency at the workspace's range.
 */
function dependencyFields(pkg: PublishedPackage, pkgRoot: string, names: Set<string>) {
	const workspace = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string> }
	const declared = workspace.dependencies ?? {}
	const peers: [string, string][] = []
	const deps: [string, string][] = []
	for (const name of names) {
		const spec = declared[name]
		if (spec === undefined)
			throw new Error(`${pkg.dir}: the bundle needs ${name}, which packages/${pkg.dir}/package.json does not declare`)
		const [list, pattern, shape] = name === "zod" ? [deps, RANGE_RE, "a ^X.Y.Z range"] : [peers, EXACT_PIN_RE, "an exact version"]
		if (!pattern.test(spec)) throw new Error(`${pkg.dir}: ${name} is declared as "${spec}"; it must be ${shape}`)
		list.push([name, spec])
	}
	return {
		...(deps.length > 0 ? { dependencies: sortedRecord(deps) } : {}),
		...(peers.length > 0 ? { peerDependencies: sortedRecord(peers) } : {}),
	}
}

function manifestFor(pkg: PublishedPackage, version: string, dependencies: object): Record<string, unknown> {
	const exportsMap = Object.fromEntries(
		pkg.entries.map((e) => {
			const base = basename(e.source, ".ts")
			return [e.subpath, { types: `./dist/${base}.d.ts`, default: `./dist/${base}.js` }]
		}),
	)
	const sideEffects = pkg.entries.filter((e) => e.sideEffect).map((e) => `./dist/${emittedName(e.source)}`)
	return {
		name: pkg.name,
		version,
		description: pkg.description,
		license: "Apache-2.0",
		author: "Alejo Amiras",
		repository: { type: "git", url: `git+https://github.com/${REPOSITORY}.git`, directory: `packages/${pkg.dir}` },
		bugs: { url: `https://github.com/${REPOSITORY}/issues` },
		type: "module",
		exports: exportsMap,
		files: ["dist", "NOTICE"],
		sideEffects: sideEffects.length > 0 ? sideEffects : false,
		...dependencies,
		// Only a default (a CLI flag overrides it); the package's 2FA-and-no-tokens setting is the boundary.
		publishConfig: { access: "public", provenance: true },
	}
}

/** npm keeps each file's mode in the tarball, so the caller's umask would otherwise move the digests. */
function normalizeModes(dir: string): void {
	chmodSync(dir, 0o755)
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) normalizeModes(path)
		else chmodSync(path, 0o644)
	}
}

/** Stages `pkg` into `<outRoot>/<pkg.dir>/`, replacing the previous staging there. */
export async function stagePackage(pkg: PublishedPackage, version: string, outRoot: string): Promise<StagedPackage> {
	if (!VERSION_RE.test(version)) throw new Error(`version must be canonical X.Y.Z, got "${version}"`)
	if (realpathSync(process.cwd()) !== realpathSync(REPO_ROOT)) {
		throw new Error(`run from the repository root (${REPO_ROOT}), not ${process.cwd()}`)
	}
	for (const entry of pkg.entries) {
		if (!/^src\/[^/]+\.ts$/.test(entry.source)) throw new Error(`${pkg.dir}: entry ${entry.source} must sit directly in src/`)
	}
	const pkgRoot = join(REPO_ROOT, "packages", pkg.dir)
	const out = resolve(outRoot, pkg.dir)
	const distDir = join(out, "dist")
	prepareOut(out)

	const js = await bundle(pkg, pkgRoot, distDir)
	const names = bundleImports(pkg, js)
	emitDeclarations(pkg, pkgRoot, join(out, ".types"))
	const types = finishDeclarations(pkg, pkgRoot, join(out, ".types"), distDir)
	for (const name of types.names) names.add(name)
	const shipped = [...pkg.entries.map((e) => emittedName(e.source)), ...types.declarations].sort()
	if (JSON.stringify(filesUnder(distDir)) !== JSON.stringify(shipped)) {
		throw new Error(`${pkg.dir}: dist holds ${filesUnder(distDir).join(", ")}, expected exactly ${shipped.join(", ")}`)
	}

	const manifest = manifestFor(pkg, version, dependencyFields(pkg, pkgRoot, names))
	writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
	copyFileSync(join(REPO_ROOT, "LICENSE"), join(out, "LICENSE"))
	copyFileSync(join(REPO_ROOT, "NOTICE"), join(out, "NOTICE"))
	copyFileSync(join(import.meta.dir, "readme", `${pkg.dir}.md`), join(out, "README.md"))
	normalizeModes(out)
	return { path: out, manifest }
}

function parseArgs(argv: string[]): { dirs: string[]; version: string; outRoot: string } {
	const dirs: string[] = []
	let version = ""
	let outRoot = join(REPO_ROOT, "dist-publish")
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? ""
		if (arg === "--version") version = argv[++i] ?? ""
		else if (arg === "--out") outRoot = resolve(argv[++i] ?? "")
		else if (arg === "--all") dirs.push(...PACKAGES.map((p) => p.dir))
		else dirs.push(arg)
	}
	if (dirs.length === 0 || version === "") {
		throw new Error("usage: bun scripts/publish/stage.ts <dir>...|--all --version X.Y.Z [--out <root>]")
	}
	return { dirs, version, outRoot }
}

if (import.meta.main) {
	const { dirs, version, outRoot } = parseArgs(process.argv.slice(2))
	for (const dir of dirs) {
		const staged = await stagePackage(packageByDir(dir), version, outRoot)
		console.log(`staged ${staged.manifest.name}@${version} → ${relative(REPO_ROOT, staged.path)}`)
	}
}
