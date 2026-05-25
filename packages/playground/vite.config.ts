import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vite"
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
 *   PLAYGROUND_PORT             — server port, default 5174
 *   VITE_DISABLE_HMR=1          — disables HMR + file watcher (auto when NODE_ENV=test)
 *   NULO_E2E_KEY_EXCHANGE_MS    — e2e-only: override upstream wallet-sdk
 *                                 KEY_EXCHANGE_TIMEOUT_MS (default 2000). Set
 *                                 to validate the cold-SW vs upstream-timeout
 *                                 hypothesis. Production builds: leave unset.
 */
const port = Number(process.env.PLAYGROUND_PORT ?? 5174)
const disableHmr = process.env.VITE_DISABLE_HMR === "1" || process.env.NODE_ENV === "test"
const e2eKeyExchangeMs = process.env.NULO_E2E_KEY_EXCHANGE_MS

/**
 * E2E-only patch that rewrites the hardcoded 2s ECDH key-exchange timeout
 * inside `@aztec/wallet-sdk/dest/extension/provider/extension_provider.js`.
 *
 * Scoped to the playground build only (the wallet extension imports a different
 * submodule, `@aztec/wallet-sdk/extension/handlers`, and is unaffected). Gated
 * on `NULO_E2E_KEY_EXCHANGE_MS` — production builds skip the plugin entirely
 * and ship the upstream 2s default.
 *
 * Runs as BOTH a vite transform (for HMR/source mode) AND an esbuild plugin
 * inside `optimizeDeps.esbuildOptions.plugins` (so the pre-bundled chunk also
 * contains the patched constant). Either path alone misses cases:
 *   - vite transform alone: pre-bundle skips it.
 *   - esbuild plugin alone: would miss source-served imports in dev.
 *
 * Validates whether the cold-MV3-SW vs upstream-2s race is the true root cause
 * of the `connectPlayground:awaitVerifyPopup` timeouts we hit on sharded CI.
 * See implementations-plan/network-followups/audit-codex-rootcause-{3,5}.md.
 */
const KEY_EXCHANGE_TARGET = "/@aztec/wallet-sdk/dest/extension/provider/extension_provider.js"
const KEY_EXCHANGE_PATTERN = /const KEY_EXCHANGE_TIMEOUT_MS = 2000;/
function patchKeyExchange(source: string, timeoutMs: string): { code: string; changed: boolean } {
	const next = source.replace(KEY_EXCHANGE_PATTERN, `const KEY_EXCHANGE_TIMEOUT_MS = ${timeoutMs}; // nulo-e2e-only`)
	return { code: next, changed: next !== source }
}

function walletSdkKeyExchangePlugin(timeoutMs: string): Plugin {
	let loggedVite = false
	let loggedEsbuild = false
	return {
		name: "nulo-e2e-wallet-sdk-key-exchange-patch",
		enforce: "pre",
		transform(code, id) {
			if (!id.includes(KEY_EXCHANGE_TARGET)) return null
			const { code: next, changed } = patchKeyExchange(code, timeoutMs)
			if (!changed) return null
			if (!loggedVite) {
				console.log(`[playground:vite] patched wallet-sdk KEY_EXCHANGE_TIMEOUT_MS=${timeoutMs} (vite transform)`)
				loggedVite = true
			}
			return { code: next, map: null }
		},
		config() {
			return {
				optimizeDeps: {
					esbuildOptions: {
						plugins: [
							{
								name: "nulo-e2e-wallet-sdk-key-exchange-patch-esbuild",
								setup(build) {
									build.onLoad(
										{ filter: /@aztec\/wallet-sdk\/dest\/extension\/provider\/extension_provider\.js$/ },
										(args) => {
											const source = readFileSync(args.path, "utf8")
											const { code: next, changed } = patchKeyExchange(source, timeoutMs)
											if (!changed) return null
											if (!loggedEsbuild) {
												console.log(
													`[playground:vite] patched wallet-sdk KEY_EXCHANGE_TIMEOUT_MS=${timeoutMs} (esbuild optimizeDeps)`,
												)
												loggedEsbuild = true
											}
											return { contents: next, loader: "js" }
										},
									)
								},
							},
						],
					},
				},
			}
		},
	}
}

export default defineConfig({
	plugins: [
		...(e2eKeyExchangeMs ? [walletSdkKeyExchangePlugin(e2eKeyExchangeMs)] : []),
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
