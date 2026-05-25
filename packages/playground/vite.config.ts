import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"

/**
 * Playground dev server config.
 *
 * Port + HMR are env-configurable so e2e runs can:
 *  1) Use a non-default port (default 5174 might be busy from another impl).
 *  2) Disable HMR so saves don't fire `chrome.tabs.onUpdated` and terminate
 *     live dApp sessions mid-test.
 *
 * Node polyfills are required because @aztec/aztec.js + @aztec/wallet-sdk
 * pull in `util`, `buffer`, `events` etc. that reference `process` /
 * `Buffer` at module-eval time. Without these the bundle ReferenceError's
 * before main.ts ever runs.
 *
 * Env:
 *   PLAYGROUND_PORT     — server port, default 5174
 *   VITE_DISABLE_HMR=1  — disables HMR + file watcher (auto when NODE_ENV=test)
 */
const port = Number(process.env.PLAYGROUND_PORT ?? 5174)
const disableHmr = process.env.VITE_DISABLE_HMR === "1" || process.env.NODE_ENV === "test"

export default defineConfig({
	plugins: [
		nodePolyfills({
			include: ["buffer", "stream", "util", "events", "process"],
			globals: { Buffer: true, process: true, global: true },
		}),
	],
	server: {
		port,
		strictPort: true,
		host: "localhost",
		hmr: disableHmr ? false : undefined,
		watch: disableHmr ? { ignored: ["**"] } : undefined,
	},
	clearScreen: false,
	optimizeDeps: {
		exclude: ["@aztec/bb.js", "@aztec/noir-acvm_js", "@aztec/noir-noirc_abi"],
	},
})
