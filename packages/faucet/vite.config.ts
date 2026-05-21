import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"

const COOP_COEP_HEADERS = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
}

export default defineConfig({
	server: {
		port: 5176,
		strictPort: true,
		// bb.js threaded wasm requires cross-origin isolation. Same headers
		// ship in production via public/_headers (Cloudflare Pages).
		headers: COOP_COEP_HEADERS,
	},
	preview: {
		headers: COOP_COEP_HEADERS,
	},
	resolve: {
		alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
		// Multiple nested versions of these WASM-binding packages can exist
		// in node_modules. Without dedup, initAbi() and abiEncode() end up
		// in different module scopes and the WASM instance never resolves.
		// Same shape as packages/extension/vite.config.ts:108.
		dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
	},
	plugins: [
		vue(),
		nodePolyfills({
			// Aztec packages reach for `process` at module top-level via util/path
			// shims. Without these the bundle throws ReferenceError before mount.
			globals: { Buffer: true, global: true, process: true },
		}),
	],
})
