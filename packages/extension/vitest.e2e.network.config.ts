import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			// Force the node variant of the noir wasm wrappers. The patched
			// `exports.node` field works for Node's native resolver but
			// vite's SSR bundler picks the `module: "./web/..."` field on
			// darwin arm64 hosts, which throws `__wbindgen_malloc undefined`
			// the first time the simulator runs a private circuit. Direct
			// alias to the nodejs entry sidesteps vite's resolution entirely;
			// on hosts where vite's resolver works correctly (the CI Linux
			// runners) this is a no-op (alias points to the same file the
			// resolver would have picked anyway).
			"@aztec/noir-acvm_js": fileURLToPath(new URL("../../node_modules/@aztec/noir-acvm_js/nodejs/acvm_js.js", import.meta.url)),
			"@aztec/noir-noirc_abi": fileURLToPath(
				new URL("../../node_modules/@aztec/noir-noirc_abi/nodejs/noirc_abi_wasm.js", import.meta.url),
			),
		},
	},
	test: {
		include: ["tests/e2e/network/**/*.test.ts"],
		environment: "node",
		globalSetup: "./tests/e2e/global-setup.ts",
		testTimeout: 30_000,
		hookTimeout: 300_000, // 5min — tokenReadyExtension creates EmbeddedWallet + mints tokens
		fileParallelism: false,
		// Cross-file Chrome-state isolation: each test file gets its own forked
		// worker process. These two settings match the smoke config
		// (vitest.e2e.config.ts:33-34). On vitest 4.1.5 they are already the
		// runtime defaults, so this branch's pool/isolate change is effectively
		// documentation + future-proofing — it didn't fix any failure on its
		// own. The actual cross-file leak fix was the popup race fix in
		// handleSetActive + the test-helper detach retries; the explicit pool
		// value here just makes the intent obvious to readers and locks the
		// behavior in case a future vitest version shifts the default.
		pool: "forks",
		isolate: true,
		// 3 attempts per test. Mostly a guard against transient CI flake — the
		// rotating popup-timeout flakes documented in
		// implementations-plan/network-test-triage/full-suite-findings.md were
		// actually a Vue popup race (popup approve handler silently returning
		// when clicked before init completed). That race is fixed at the source
		// (see implementations-plan/network-followups/audit-codex-rootcause.md
		// for the investigation + fix); retry is just belt-and-suspenders now.
		retry: 2,
		// Node v24 enforces JSON import attributes; @aztec/accounts imports JSON without them.
		// Use the unstable loader to relax this check in the global setup process.
		server: {
			deps: {
				inline: [/@aztec/],
			},
		},
	},
})
