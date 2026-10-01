import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { BB_FETCH_CODE_SHIM, bbFetchCodeShim, unshimmedFetchers } from "./bb-fetch-code-shim"
import { resolveBbFile } from "./extract-bb-wasm"

type Resolver = { resolve: (source: string, importer: string) => Promise<{ id: string } | null> }
type ResolveId = (this: Resolver, source: string, importer: string | undefined) => Promise<string | null>

const resolveId = bbFetchCodeShim().resolveId as unknown as ResolveId
const relative: Resolver = { resolve: async (source, importer) => ({ id: resolve(dirname(importer), source) }) }
const route = (source: string, importer: string) => resolveId.call(relative, source, importer)

const specifiers = (file: string) => [...readFileSync(file, "utf8").matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? "")

describe("bbFetchCodeShim", () => {
	test("replaces the fetcher on the path the installed bb.js takes to it", async () => {
		const reexport = resolveBbFile("dest/browser/barretenberg_wasm/fetch_code/index.js")
		const routed = await Promise.all(specifiers(reexport).map((specifier) => route(specifier, reexport)))
		expect(routed).toContain(BB_FETCH_CODE_SHIM)
	})

	test("leaves the rest of the browser tree and the whole node tree alone", async () => {
		const wasmEntry = resolveBbFile("dest/browser/barretenberg_wasm/index.js")
		const nodeReexport = resolveBbFile("dest/node/barretenberg_wasm/fetch_code/index.js")
		expect(await route("./fetch_code/index.js", wasmEntry)).toBeNull()
		expect(await route("./browser/index.js", nodeReexport)).toBeNull()
	})

	test("the build check flags only bb.js's own browser fetcher", () => {
		const store = "/repo/node_modules/.bun/@aztec-foundation+bb.js@6.0.0-rc.1/node_modules/@aztec-foundation/bb.js/dest"
		const browserFetcher = `${store}/browser/barretenberg_wasm/fetch_code/browser/index.js`
		const nodeCopy = `${store}/node/barretenberg_wasm/fetch_code/browser/index.js`
		expect(unshimmedFetchers([browserFetcher, nodeCopy, BB_FETCH_CODE_SHIM])).toEqual([browserFetcher])
	})
})
