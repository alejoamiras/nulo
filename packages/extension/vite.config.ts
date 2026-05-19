import { existsSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"

/** Resolve a file inside an npm package, bypassing its `exports` field.
 *  Walks up from this config file to find the package in any node_modules. */
function resolvePackageFile(pkg: string, file: string): string {
	const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
	let dir = fileURLToPath(new URL(".", import.meta.url))
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ...parts, file)
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
}
import usePages from "vite-plugin-pages"
import useAutoImport from "unplugin-auto-import/vite"
import useComponents from "unplugin-vue-components/vite"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import packageJson from "./package.json"
import { extractBbWasm } from "./scripts/extract-bb-wasm"

export default defineConfig({
	server: {
		port: 8088,
		strictPort: true,
		hmr: {
			port: 8088,
		},
		// Headers needed for bb WASM to work in multithreaded mode
		headers: {
			"Cross-Origin-Embedder-Policy": "require-corp",
			"Cross-Origin-Opener-Policy": "same-origin",
		},
	},
	resolve: {
		// Array form (not object) is required because the function-bind aliases
		// at the bottom need anchored regex `find` patterns. Vite forwards this
		// to @rollup/plugin-alias which only matches RegExp via array entries.
		alias: [
			{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
			{ find: "~", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
			{ find: "src", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
			{ find: "@assets", replacement: fileURLToPath(new URL("src/assets", import.meta.url)) },
			{
				find: "@private-fpc-artifact",
				replacement: resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
			},
			{
				find: "@wonderland-token-artifact",
				replacement: resolvePackageFile("@defi-wonderland/aztec-standards", "artifacts/target/token_contract-Token.json"),
			},
			{
				find: "@alejoamiras/aztec-accelerator",
				replacement: resolvePackageFile("@alejoamiras/aztec-accelerator", "dist/index.js"),
			},
			// Resolve the polyfill's Buffer shim to an absolute path. Rollup's
			// inject (used by `nodePolyfills({ globals: { Buffer: true } })`)
			// rewrites naked Buffer references into an import from this path;
			// without an alias, resolution fails when the source file lives
			// in a workspace package that doesn't directly depend on the
			// polyfill plugin (e.g. wallet-core).
			{
				find: "vite-plugin-node-polyfills/shims/buffer",
				replacement: resolvePackageFile("vite-plugin-node-polyfills", "shims/buffer/dist/index.js"),
			},
			// Force detect-node to return false so @aztec/foundation's pino logger
			// uses the browser transport instead of Node.js worker-thread transport.
			// Without this, the node-polyfills process shim makes detect-node think
			// we're in Node.js, causing pino.transport() to fail with "window is not defined".
			{ find: "detect-node", replacement: fileURLToPath(new URL("./src/shims/detect-node.ts", import.meta.url)) },
			{ find: "comlink", replacement: "comlink" },
			{ find: "debug", replacement: "debug" },
			// CSP-safe replacement for the upstream `function-bind` package and
			// its `/implementation` entry point. The upstream constructs a bound
			// function from a dynamic string to preserve `f.length`, which MV3
			// rejects under our `script-src 'self' 'wasm-unsafe-eval'` policy.
			// Native `Function.prototype.bind` does the same thing without
			// dynamic code construction; the stub is a 22-line CJS module that
			// just delegates. Aliased BOTH `function-bind` (the package entry)
			// and `function-bind/implementation` (some upstream consumers
			// import the implementation entry directly). Anchored regex so
			// neighboring packages like `function-bind-other-thing` are not
			// accidentally rewritten.
			{ find: /^function-bind$/, replacement: fileURLToPath(new URL("./src/shims/function-bind-stub.cjs", import.meta.url)) },
			{
				find: /^function-bind\/implementation$/,
				replacement: fileURLToPath(new URL("./src/shims/function-bind-stub.cjs", import.meta.url)),
			},
		],
		// Force Vite to resolve these WASM-binding packages to a single copy.
		// Multiple nested versions exist in node_modules (rc.2 in simulator/pxe,
		// rc.4 hoisted). Without dedup, initAbi() and abiEncode() end up in
		// different module scopes, so the WASM instance variable is never shared.
		dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
	},
	css: {
		preprocessorOptions: {
			scss: {
				loadPaths: [fileURLToPath(new URL("./src/assets/styles", import.meta.url))],
				quietDeps: true,
			},
		},
	},
	plugins: [
		// Replace bb.js fetchCode module to eliminate dynamic import() of embedded WASM.
		// Chrome MV3 service workers forbid import() at runtime. Our shim uses fetch()
		// against the WASM files in /assets/ instead. Predicate scopes to the *browser*
		// graph only — node and node-cjs trees keep their stock fetcher.
		{
			name: "bb-fetch-code-shim",
			enforce: "pre",
			resolveId(source, importer) {
				if (
					importer?.includes("@aztec/bb.js/dest/browser/") &&
					source.includes("fetch_code/browser") &&
					source.endsWith("index.js")
				) {
					return fileURLToPath(new URL("./src/shims/bb-fetch-code.ts", import.meta.url))
				}
			},
		},
		vue(),

		usePages({
			dirs: [
				{
					dir: "src/pages",
					baseRoute: "common",
				},
				{
					dir: "src/setup/pages",
					baseRoute: "setup",
				},
				{
					dir: "src/popup/pages",
					baseRoute: "popup",
				},
				{
					dir: "src/popup/windows",
					baseRoute: "windows",
				},
			],
		}),

		useAutoImport({
			imports: [
				"vue",
				"vue-router",
				{
					"webextension-polyfill": [["*", "browser"]],
				},
			],
			dts: "src/types/auto-imports.d.ts",
			dirs: ["src/composables/", "src/stores/", "src/utils/"],
			// Rewrites compiled _ctx.<name> template references to resolve against the
			// auto-import registry so {{ trimAddress(...) }} works without explicit
			// imports in every SFC. Plugin runs enforce:"post" internally — must stay
			// after vue() in the plugin chain.
			vueTemplate: true,
			eslintrc: {
				enabled: true,
				filepath: "src/types/.eslintrc-auto-import.json",
			},
		}),

		useComponents({
			dirs: ["src/components"],
			dts: "src/types/components.d.ts",
		}),

		{
			name: "assets-rewrite",
			enforce: "post",
			apply: "build",
			transformIndexHtml(html, { path }) {
				const assetsPath = relative(dirname(path), "/assets").replace(/\\/g, "/")
				return html.replace(/"\/assets\//g, `"${assetsPath}/`)
			},
		},

		{
			name: "wasm-content-type",
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					if (req.url?.endsWith(".wasm")) {
						res.setHeader("Content-Type", "application/wasm")
					}
					next()
				})
			},
		},

		// Source the bb.js WASM directly from `node_modules/@aztec/bb.js` so a
		// dependency bump auto-updates both variants. See
		// `scripts/extract-bb-wasm.ts` for the why + the threads/single
		// extraction strategy + the hash-divergence assertion.
		{
			name: "bb-wasm-emit",
			apply: "build",
			generateBundle() {
				const { single, threads } = extractBbWasm()
				this.emitFile({
					type: "asset",
					fileName: "assets/barretenberg.wasm.gz",
					source: single,
				})
				this.emitFile({
					type: "asset",
					fileName: "assets/barretenberg-threads.wasm.gz",
					source: threads,
				})
			},
			// Dev server: serve the same files via a middleware so `vite dev`
			// matches the built behavior. Without this, dev would 404.
			configureServer(server) {
				const cache = (() => {
					try {
						return extractBbWasm()
					} catch (e) {
						server.config.logger.error(`bb-wasm-emit: failed to extract bb.js WASM at dev startup: ${(e as Error).message}`)
						return null
					}
				})()
				server.middlewares.use((req, res, next) => {
					if (!cache) return next()
					if (req.url === "/assets/barretenberg.wasm.gz") {
						res.setHeader("Content-Type", "application/gzip")
						res.end(Buffer.from(cache.single))
						return
					}
					if (req.url === "/assets/barretenberg-threads.wasm.gz") {
						res.setHeader("Content-Type", "application/gzip")
						res.end(Buffer.from(cache.threads))
						return
					}
					next()
				})
			},
		},

		// ── Process handling: three deliberate layers ─────────────────────
		//
		// `process` references in source / dependencies are handled by THREE
		// coordinated mechanisms. Don't add a fourth without understanding
		// how they interact, or you'll re-introduce bugs that cost weeks of
		// debugging.
		//
		// 1. `define: { "process.browser": true, "process.env": <JSON> }`
		//    (further down). Esbuild substitutes the literal source tokens
		//    `process.browser` and `process.env` at parse time. Compile-time.
		// 2. `alias: { "detect-node": "./src/shims/detect-node.ts" }` (above).
		//    Forces `detect-node` to return false at module level so pino's
		//    Node.js transport branch is dead before runtime. Without this,
		//    the polyfill's `process` would convince detect-node we're in
		//    Node, and pino would try to load worker-threads.
		// 3. `nodePolyfills({ globals: { Buffer: true } })` below. Runtime
		//    polyfill via Rollup's inject — rewrites naked `Buffer`
		//    identifiers to import the polyfill. Buffer is genuinely needed
		//    at runtime because Aztec deps reach for it at module-init time.
		//
		// We DELIBERATELY do NOT add `process: true` to the polyfill globals.
		// It would create a runtime `process` global object whose shape
		// disagrees with the compile-time `define` substitution: `process.X`
		// reads via bracket notation or via `globalThis.process` would
		// escape `define` and fall through to the polyfill's empty
		// `process.env`. The two would diverge silently. The current
		// three-layer split is what produces a working browser bundle.
		nodePolyfills({
			include: ["buffer", /*"crypto",*/ "net", "path", "stream", "tty", "vm", "util"],
			// Make a naked `Buffer` identifier auto-import the polyfill at
			// build time. Required because wallet-core's serialization.ts
			// uses naked `Buffer` (no import) — see its docstring for why.
			globals: { Buffer: true },
		}),
	],
	build: {
		// Disable module preload polyfill — it references `window.dispatchEvent`
		// which doesn't exist in Chrome MV3 service workers.
		modulePreload: false,
		target: "esnext",
		// Skip gzip-size reporting in CI only. With ~78 MB of output and big
		// wasm assets, the gzip pass adds 5–15 s per build for log lines no
		// CI consumer reads. Local builds keep the report for manual bundle
		// inspection during release prep.
		reportCompressedSize: !process.env.CI,
		rollupOptions: {
			input: {
				offscreen: "src/offscreen/index.html",
				popup: "src/popup/index.html",
				setup: "src/setup/index.html",
			},
		},
	},
	optimizeDeps: {
		include: ["pino", "vue", "webextension-polyfill"],
		exclude: ["@aztec/bb.js", "@aztec/noir-acvm_js", "@aztec/noir-noirc_abi", "vue-demi"],
		esbuildOptions: {
			target: "esnext",
		},
	},
	define: {
		__VERSION__: JSON.stringify(packageJson.version),
		__SENTINEL__: JSON.stringify(packageJson.sentinel),
		__AZTEC_VERSION__: JSON.stringify(packageJson.dependencies["@aztec/pxe"] ?? "unknown"),
		__NAME__: JSON.stringify(packageJson.name),
		__DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
		"import.meta.env.HTML_TITLE": JSON.stringify(packageJson.displayName),
		"process.browser": true,
		"process.env": JSON.stringify({
			LOG_LEVEL: "verbose",
			BB_WASM_PATH: "/assets/barretenberg.wasm.gz",
		}),
	},
})
