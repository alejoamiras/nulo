// Phantom-dependency sweep: for every workspace, collect bare-specifier imports in
// src/ (+ scripts/, tests/ where present) and report packages NOT declared in that
// workspace's package.json (dependencies + devDependencies + peerDependencies).
//
// BLIND SPOT: this reads SOURCE. Build-time plugin injections (e.g. vite-plugin-node-polyfills
// rewriting `Buffer` into an import of "vite-plugin-node-polyfills/shims/buffer" in every
// module) never appear in source — only a clean-room build (fresh install, no hoisted root
// copies) surfaces those. Treat CI as that clean room.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const workspaces = [...readdirSync(join(root, "apps")).map((d) => `apps/${d}`), ...readdirSync(join(root, "packages")).map((d) => `packages/${d}`)]
// Matches: static import/export-from (incl. MULTILINE specifier lists — `[^'"]*?` spans
// newlines), side-effect imports, require(), require.resolve(), dynamic import(), and
// vi.mock()/jest.mock()/mock.module() targets. Still SOURCE-only (see BLIND SPOT above).
const IMPORT_RE =
	/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'".][^'"]*)['"]|(?:^|\n)\s*import\s*['"]([^'".][^'"]*)['"]|require(?:\.resolve)?\(\s*['"]([^'".][^'"]*)['"]\s*\)|import\(\s*['"]([^'".][^'"]*)['"]\s*\)|(?:vi|jest)\.mock\(\s*['"]([^'".][^'"]*)['"]|mock\.module\(\s*['"]([^'".][^'"]*)['"]/g
const BUILTIN = /^(node:|bun:|bun$|fs$|path$|url$|crypto$|os$|child_process$|module$|util$|events$|stream$|buffer$|http$|https$|net$|zlib$|assert$|process$|worker_threads$|readline$|tty$|dns$|vm$|perf_hooks$|string_decoder$|timers$|querystring$|constants$|async_hooks$|diagnostics_channel$|inspector$)/

function pkgOf(spec: string): string {
	if (spec.startsWith("@")) { const [s, n] = spec.split("/"); return `${s}/${n}` }
	return spec.split("/")[0] as string
}
function walk(dir: string, out: string[]) {
	for (const e of readdirSync(dir)) {
		if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue
		const p = join(dir, e)
		const st = statSync(p)
		if (st.isDirectory()) walk(p, out)
		else if (/\.(ts|mts|cts|tsx|vue|js|mjs|cjs)$/.test(e)) out.push(p)
	}
}
for (const ws of workspaces) {
	let manifest: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
	try { manifest = JSON.parse(readFileSync(join(root, ws, "package.json"), "utf8")) } catch { continue }
	const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
	const files: string[] = []
	for (const sub of ["src", "scripts", "tests", "manifest", ".storybook"]) { try { if (statSync(join(root, ws, sub)).isDirectory()) walk(join(root, ws, sub), files) } catch {} }
	for (const f of readdirSync(join(root, ws))) if (/\.(ts|mts|config\.[cm]?ts)$/.test(f)) files.push(join(root, ws, f))
	const phantoms = new Map<string, Set<string>>()
	for (const f of files) {
		const src = readFileSync(f, "utf8")
		for (const m of src.matchAll(IMPORT_RE)) {
			const spec = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6]) as string
			if (!spec || BUILTIN.test(spec) || spec.startsWith("@/") || spec.startsWith("~/") || spec.startsWith("virtual:")) continue
			const pkg = pkgOf(spec)
			if (pkg === manifest.name || declared.has(pkg)) continue
			if (!phantoms.has(pkg)) phantoms.set(pkg, new Set())
			phantoms.get(pkg)?.add(f.replace(`${root}/`, ""))
		}
	}
	if (phantoms.size) {
		console.log(`\n## ${ws} (${manifest.name})`)
		for (const [pkg, where] of phantoms) console.log(`  ${pkg}  ←  ${[...where].slice(0, 3).join(", ")}${where.size > 3 ? ` (+${where.size - 3})` : ""}`)
	}
}
console.log("\nsweep done")
