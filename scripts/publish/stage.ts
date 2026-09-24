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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import type { BunPlugin } from "bun"
import { PACKAGES, type PublishedPackage, packageByDir } from "./packages"

export const REPO_ROOT = resolve(import.meta.dir, "../..")
const REPOSITORY = "alejoamiras/nulo"
const VERSION_RE = /^\d+\.\d+\.\d+$/
const AZGUARD_NOTICE = /^\/\/ Modified from Azguard Wallet \(/
const MODULE_COMMENT = /^\/\/ (\S+\.ts)$/
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

/** Entries import each other by their emitted file, so a package with two entries ships one copy of the shared code. */
function siblingEntriesExternal(entryFiles: Map<string, string>): BunPlugin {
	return {
		name: "sibling-entries-external",
		setup(build) {
			build.onResolve({ filter: /^\.\.?\// }, (args) => {
				const target = resolve(dirname(args.importer), args.path)
				const emitted = entryFiles.get(target) ?? entryFiles.get(`${target}.ts`)
				return emitted ? { path: emitted, external: true } : undefined
			})
		},
	}
}

async function bundle(pkg: PublishedPackage, pkgRoot: string, distDir: string): Promise<string[]> {
	const entryFiles = new Map(pkg.entries.map((e) => [join(pkgRoot, e.source), `./${basename(e.source, ".ts")}.js`]))
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
	const written: string[] = []
	for (const [output, meta] of Object.entries(outputs)) {
		const file = resolve(distDir, output)
		const notices = new Set<string>()
		for (const [input, { bytesInOutput }] of Object.entries(meta.inputs)) {
			if (bytesInOutput === 0) continue
			const firstLine = readFileSync(resolve(input), "utf8").split("\n", 1)[0] ?? ""
			if (AZGUARD_NOTICE.test(firstLine)) notices.add(firstLine)
		}
		const code = readFileSync(file, "utf8")
		assertModuleComments(pkg, code)
		writeFileSync(file, [...notices, code].join("\n"))
		written.push(file)
	}
	return written
}

/** The bundler labels each module with its cwd-relative path; anything but `packages/<pkg>/src/…` means a wrong cwd. */
function assertModuleComments(pkg: PublishedPackage, code: string): void {
	for (const line of code.split("\n")) {
		const path = MODULE_COMMENT.exec(line)?.[1]
		if (path !== undefined && !/^packages\/[a-z0-9-]+\/src\//.test(path)) {
			throw new Error(`${pkg.dir}: bundle names a module outside packages/*/src: ${path}`)
		}
	}
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
	const siblings = new Set(pkg.entries.map((e) => `./${basename(e.source, ".ts")}.js`))
	const names = new Set<string>()
	for (const file of files) {
		for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
			const name = importedPackage(pkg, siblings, path)
			if (name !== undefined) names.add(name)
		}
	}
	return names
}

function emitDeclarations(pkg: PublishedPackage, pkgRoot: string, distDir: string): void {
	const tsc = join(pkgRoot, "node_modules/typescript/bin/tsc")
	const run = Bun.spawnSync([process.execPath, tsc, "-p", join(pkgRoot, "tsconfig.publish.json"), "--outDir", distDir], {
		cwd: pkgRoot,
		stdout: "pipe",
		stderr: "pipe",
	})
	if (run.exitCode !== 0) throw new Error(`${pkg.dir}: tsc failed\n${run.stdout.toString()}${run.stderr.toString()}`)
}

/** The source's Azguard modification notice, when it carries one: declarations are derived from it too. */
function azguardNoticeOf(sourceFile: string): string | undefined {
	if (!existsSync(sourceFile)) return undefined
	const firstLine = readFileSync(sourceFile, "utf8").split("\n", 1)[0] ?? ""
	return AZGUARD_NOTICE.test(firstLine) ? firstLine : undefined
}

/** Node ESM resolves relative imports inside declarations as it does in JS: extensions are required. */
function withExplicitExtensions(distDir: string, text: string): string {
	return text.replace(RELATIVE_SPECIFIER, (_, lead, quote, spec: string) => {
		if (/\.(js|json)$/.test(spec)) return `${lead}${quote}${spec}${quote}`
		const suffix = existsSync(join(distDir, spec, "index.d.ts")) ? "/index.js" : ".js"
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
			if (spec?.startsWith(".")) queue.push(join(dirname(file), spec.replace(/\.js$/, ".d.ts")))
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
 * Rewrites the emitted declarations for Node ESM, drops the ones no entry reaches, and heads each
 * Azguard-derived one with its source's notice. Returns the bare package names the kept ones reference.
 */
function finishDeclarations(pkg: PublishedPackage, pkgRoot: string, distDir: string): Set<string> {
	const declarations = new Map(
		readdirSync(distDir)
			.filter((f) => f.endsWith(".d.ts"))
			.map((f) => [f, withExplicitExtensions(distDir, readFileSync(join(distDir, f), "utf8"))] as const),
	)
	const reachable = reachableDeclarations(pkg, declarations)
	const names = new Set<string>()
	for (const [file, text] of declarations) {
		if (!reachable.has(file)) {
			rmSync(join(distDir, file))
			continue
		}
		for (const name of declarationPackages(pkg, file, text)) names.add(name)
		const notice = azguardNoticeOf(join(pkgRoot, "src", file.replace(/\.d\.ts$/, ".ts")))
		writeFileSync(join(distDir, file), notice === undefined ? text : `${notice}\n${text}`)
	}
	return names
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
		if (name === "zod") {
			deps.push([name, spec])
		} else if (VERSION_RE.test(spec)) {
			peers.push([name, spec])
		} else {
			throw new Error(`${pkg.dir}: ${name} is pinned as "${spec}"; @aztec/* peers must be exact`)
		}
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
		sideEffects: pkg.sideEffects.length > 0 ? [...pkg.sideEffects] : false,
		...dependencies,
		// A publish without CI's OIDC identity fails instead of shipping unattested bytes.
		publishConfig: { access: "public", provenance: true },
	}
}

/** Stages `pkg` into `<outRoot>/<pkg.dir>/`, replacing whatever was there. */
export async function stagePackage(pkg: PublishedPackage, version: string, outRoot: string): Promise<StagedPackage> {
	if (!VERSION_RE.test(version)) throw new Error(`version must be X.Y.Z, got "${version}"`)
	if (realpathSync(process.cwd()) !== realpathSync(REPO_ROOT)) {
		throw new Error(`run from the repository root (${REPO_ROOT}), not ${process.cwd()}`)
	}
	for (const entry of pkg.entries) {
		if (!/^src\/[^/]+\.ts$/.test(entry.source)) throw new Error(`${pkg.dir}: entry ${entry.source} must sit directly in src/`)
	}
	const pkgRoot = join(REPO_ROOT, "packages", pkg.dir)
	const out = resolve(outRoot, pkg.dir)
	const distDir = join(out, "dist")
	rmSync(out, { recursive: true, force: true })
	mkdirSync(distDir, { recursive: true })

	const js = await bundle(pkg, pkgRoot, distDir)
	const names = bundleImports(pkg, js)
	emitDeclarations(pkg, pkgRoot, distDir)
	for (const name of finishDeclarations(pkg, pkgRoot, distDir)) names.add(name)

	const manifest = manifestFor(pkg, version, dependencyFields(pkg, pkgRoot, names))
	writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
	copyFileSync(join(REPO_ROOT, "LICENSE"), join(out, "LICENSE"))
	copyFileSync(join(REPO_ROOT, "NOTICE"), join(out, "NOTICE"))
	copyFileSync(join(import.meta.dir, "readme", `${pkg.dir}.md`), join(out, "README.md"))
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
