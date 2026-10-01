import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"

/** bb.js's browser fetcher. With no `wasmPath` it `import()`s the WASM inlined as a data-URI module
 *  over the add-on linter's parse limit, so that module ships unless the fetcher is replaced. */
export const BB_BROWSER_FETCHER = /\/@aztec-foundation\/bb\.js\/dest\/browser\/barretenberg_wasm\/fetch_code\/browser\/index\.js$/

const BB_BROWSER_TREE = "/@aztec-foundation/bb.js/dest/browser/"

// Not `new URL(literal, import.meta.url)`: Vite rewrites that form into a served asset URL.
export const BB_FETCH_CODE_SHIM = join(dirname(fileURLToPath(import.meta.url)), "../src/shims/bb-fetch-code.ts")

/** Graph modules that are bb.js's own browser fetcher: any one means the shim missed it. */
export const unshimmedFetchers = (ids: Iterable<string>): string[] => [...ids].filter((id) => BB_BROWSER_FETCHER.test(id))

/**
 * Routes bb.js's browser fetcher to `src/shims/bb-fetch-code.ts`, which fetches the `.wasm.gz`
 * assets `bb-wasm-emit` writes. It matches the resolved file, never the specifier: bb.js reaches
 * the fetcher through `fetch_code/index.js`'s re-export, and a specifier match went dead unnoticed.
 */
export function bbFetchCodeShim(): Plugin {
	return {
		name: "bb-fetch-code-shim",
		enforce: "pre",
		async resolveId(source, importer) {
			if (!importer?.includes(BB_BROWSER_TREE)) return null
			const resolved = await this.resolve(source, importer, { skipSelf: true })
			return resolved && BB_BROWSER_FETCHER.test(resolved.id) ? BB_FETCH_CODE_SHIM : null
		},
		generateBundle() {
			const missed = unshimmedFetchers(this.getModuleIds())
			if (missed.length) this.error(`bb-fetch-code-shim missed ${missed.join(", ")}: its inlined WASM would ship`)
		},
	}
}
