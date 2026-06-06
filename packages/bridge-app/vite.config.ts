import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"

// bb.js threaded wasm requires cross-origin isolation (same as the faucet).
const COOP_COEP_HEADERS = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
}

// Default 5177 (faucet uses 5176); the e2e harness overrides per-worktree.
const BRIDGE_DEV_PORT = Number(process.env.BRIDGE_DEV_PORT) || 5177

export default defineConfig({
	server: {
		port: BRIDGE_DEV_PORT,
		strictPort: !process.env.BRIDGE_DEV_PORT,
		headers: COOP_COEP_HEADERS,
	},
	preview: { headers: COOP_COEP_HEADERS },
	resolve: {
		alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
		dedupe: ["@aztec/noir-noirc_abi", "@aztec/noir-acvm_js"],
	},
	plugins: [vue(), nodePolyfills({ globals: { Buffer: true, global: true, process: true } })],
})
