import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import { nuloComponentsPlugin } from "./scripts/components-plugin"

const COOP_COEP_HEADERS = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
}

// Dev server port. Defaults to 5176 for local DX; the e2e network harness
// overrides this per-worktree via FAUCET_DEV_PORT so parallel agents don't
// collide. strictPort is only on for local dev — when the harness picks a
// port, Vite must be allowed to bind to whatever it allocates.
const FAUCET_DEV_PORT = Number(process.env.FAUCET_DEV_PORT) || 5176

export default defineConfig({
	server: {
		port: FAUCET_DEV_PORT,
		strictPort: !process.env.FAUCET_DEV_PORT,
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
		nuloComponentsPlugin({ dts: "src/types/components.d.ts" }),
		nodePolyfills({
			// Aztec packages reach for `process` at module top-level via util/path
			// shims. Without these the bundle throws ReferenceError before mount.
			globals: { Buffer: true, global: true, process: true },
		}),
	],
})
