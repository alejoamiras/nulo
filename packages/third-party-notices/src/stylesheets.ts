import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path"

const STYLESHEET_PATH = /\.(css|pcss|postcss|scss|sass|less|styl|stylus)$/i
const STYLE_BLOCK = /[?&]lang\.(css|pcss|postcss|scss|sass|less|styl|stylus)\b/i
const AT_RULE = /@(?:import|use|forward)\s+([^;{}]+)/g
const TARGET = /url\(\s*(?:["']([^"']+)["']|([^)\s"']+))\s*\)|["']([^"']+)["']/g

export type ResolveStylesheet = (specifier: string, importer: string) => Promise<string | undefined>

/** A stylesheet module: a style file, or the style block of a Vue component. */
export function isStylesheet(id: string): boolean {
	return STYLESHEET_PATH.test(id.split("?")[0] ?? "") || STYLE_BLOCK.test(id)
}

/**
 * What a stylesheet pulls in by `@import`, `@use` or `@forward`, as written: quoted, `url("…")`,
 * bare `url(…)`, and comma lists. A string that is not a path (a Sass `with (...)` value) simply
 * fails to resolve later. Remote URLs are not files.
 */
export function stylesheetSpecifiers(code: string): string[] {
	// A Sass `with (...)` configuration holds values, not paths.
	const rules = [...code.matchAll(AT_RULE)].map(([, rule]) => (rule ?? "").replace(/\bwith\s*\([^)]*\)/g, ""))
	const targets = rules.flatMap((rule) => [...rule.matchAll(TARGET)])
	return targets
		.map(([, quotedUrl, bareUrl, quoted]) => quotedUrl ?? bareUrl ?? quoted ?? "")
		.filter((specifier) => specifier !== "" && !/^((https?:)?\/\/|data:|sass:)/.test(specifier))
}

const EXTENSIONS = ["", ".css", ".scss", ".sass", ".less", ".styl"]

/** The spellings a CSS, Sass or Less pipeline tries for one target: as written, with an extension, as a partial, as an index. */
function candidates(specifier: string): string[] {
	const dir = dirname(specifier)
	const partial = join(dir, `_${basename(specifier)}`)
	const bases = [specifier, partial, join(specifier, "index"), join(specifier, "_index")]
	return bases.flatMap((base) => EXTENSIONS.map((extension) => `${base}${extension}`))
}

const isFile = (path: string) => existsSync(path) && statSync(path).isFile()

async function follow(specifier: string, importer: string, resolve: ResolveStylesheet): Promise<string | undefined> {
	const bare = specifier.replace(/^~/, "")
	for (const candidate of candidates(bare)) {
		const local = isAbsolute(candidate) ? candidate : resolvePath(dirname(importer), candidate)
		if (isFile(local)) return local
		const resolved = (await resolve(candidate, importer))?.split("?")[0]
		if (resolved && isFile(resolved)) return resolved
	}
	return undefined
}

export interface InlinedStylesheets {
	files: string[]
	/** Imports nothing could follow, as `importer -> specifier`. They refuse the build: an import that cannot be followed cannot be attributed. */
	unfollowed: string[]
}

/**
 * Every file a stylesheet inlines, transitively. A CSS pipeline resolves these inside itself, so
 * the package behind `@import "pkg/theme.css"` never becomes a module of any chunk and the
 * rendered-module walk cannot see it. Partials are followed from disk because they are not modules
 * either, and one of them can be the file that reaches into a package.
 */
export async function inlinedStylesheets(id: string, code: string, resolve: ResolveStylesheet): Promise<InlinedStylesheets> {
	const seen = new Set<string>()
	const unfollowed: string[] = []
	const queue = [{ importer: id.split("?")[0] ?? id, code }]
	for (let next = queue.shift(); next; next = queue.shift()) {
		for (const specifier of stylesheetSpecifiers(next.code)) {
			const file = await follow(specifier, next.importer, resolve)
			if (!file) unfollowed.push(`${basename(next.importer)} -> ${specifier}`)
			if (!file || seen.has(file)) continue
			seen.add(file)
			queue.push({ importer: file, code: readFileSync(file, "utf8") })
		}
	}
	return { files: [...seen], unfollowed }
}
