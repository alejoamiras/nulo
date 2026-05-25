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
 * E2E-only transform that rewrites the hardcoded 2s ECDH key-exchange timeout
 * inside `@aztec/wallet-sdk/dest/extension/provider/extension_provider.js`.
 *
 * Scoped to the playground build only (the wallet extension imports a different
 * submodule, `@aztec/wallet-sdk/extension/handlers`, and is unaffected). Gated
 * on `NULO_E2E_KEY_EXCHANGE_MS` — production builds skip the plugin entirely
 * and ship the upstream 2s default.
 *
 * Validates whether the cold-MV3-SW vs upstream-2s race is the true root cause
 * of the `connectPlayground:awaitVerifyPopup` timeouts we hit on sharded CI.
 * See implementations-plan/network-followups/audit-codex-rootcause-{3,5}.md.
 */
function walletSdkKeyExchangePatch(timeoutMs: string): Plugin {
	let patched = false
	return {
		name: "nulo-e2e-wallet-sdk-key-exchange-patch",
		enforce: "pre",
		transform(code, id) {
			if (!id.includes("/@aztec/wallet-sdk/dest/extension/provider/extension_provider.js")) {
				return null
			}
			const next = code.replace(
				/const KEY_EXCHANGE_TIMEOUT_MS = 2000;/,
				`const KEY_EXCHANGE_TIMEOUT_MS = ${timeoutMs}; // nulo-e2e-only`,
			)
			if (next === code) return null
			if (!patched) {
				console.log(`[playground:vite] patched wallet-sdk KEY_EXCHANGE_TIMEOUT_MS=${timeoutMs}`)
				patched = true
			}
			return { code: next, map: null }
		},
	}
}

export default defineConfig({
	plugins: [
		...(e2eKeyExchangeMs ? [walletSdkKeyExchangePatch(e2eKeyExchangeMs)] : []),
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
