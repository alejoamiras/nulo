import { existsSync, readFileSync } from "node:fs"

const STYLESHEET_PATH = /\.(css|pcss|postcss|scss|sass|less|styl|stylus)$/i
const STYLE_BLOCK = /[?&]lang\.(css|pcss|postcss|scss|sass|less|styl|stylus)\b/i
const IMPORT = /@(?:import|use|forward)\s+(?:url\(\s*)?["']([^"']+)["']/g

export type ResolveStylesheet = (specifier: string, importer: string) => Promise<string | undefined>

/** A stylesheet module: a style file, or the style block of a Vue component. */
export function isStylesheet(id: string): boolean {
	return STYLESHEET_PATH.test(id.split("?")[0] ?? "") || STYLE_BLOCK.test(id)
}

/** What a stylesheet pulls in by `@import`, `@use` or `@forward`, as written. Remote URLs are not files. */
export function stylesheetSpecifiers(code: string): string[] {
	return [...code.matchAll(IMPORT)].flatMap(([, specifier]) =>
		specifier && !/^(https?:)?\/\//.test(specifier) && !specifier.startsWith("data:") ? [specifier] : [],
	)
}

/**
 * Every file a stylesheet inlines, transitively. A CSS pipeline resolves these inside itself, so
 * the package behind `@import "pkg/theme.css"` never becomes a module of any chunk and the
 * rendered-module walk cannot see it. Partials are followed from disk because they are not modules
 * either, and one of them can be the file that reaches into a package.
 */
export async function inlinedStylesheets(id: string, code: string, resolve: ResolveStylesheet): Promise<string[]> {
	const seen = new Set<string>()
	const queue = [{ importer: id.split("?")[0] ?? id, code }]
	for (let next = queue.shift(); next; next = queue.shift()) {
		for (const specifier of stylesheetSpecifiers(next.code)) {
			// Sass and Less accept `~pkg/file` for a package path.
			const resolved = (await resolve(specifier, next.importer)) ?? (await resolve(specifier.replace(/^~/, ""), next.importer))
			const file = resolved?.split("?")[0]
			if (!file || seen.has(file) || !existsSync(file)) continue
			seen.add(file)
			queue.push({ importer: file, code: readFileSync(file, "utf8") })
		}
	}
	return [...seen]
}
