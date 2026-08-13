import { defineConfig } from "vitest/config"
import RetryErrorReporter from "./tests/e2e/retry-error-reporter"
import { noirAliases, srcDir } from "./vite.shared"

export default defineConfig({
	resolve: {
		alias: {
			"@": srcDir,
			// This runner includes tests/e2e/network/**, so it needs the same
			// node-variant noir aliases as vitest.e2e.network (single-owned in
			// vite.shared.ts). Their absence here was a "keep in sync" drift that
			// broke `e2e:all` on darwin with `__wbindgen_malloc undefined`.
			...noirAliases,
		},
	},
	test: {
		include: ["tests/e2e/**/*.test.ts"],
		environment: "node",
		globalSetup: "./tests/e2e/global-setup.ts",
		testTimeout: 30_000,
		// 5 min — `tokenReadyExtension` (and global-setup's contract deploy)
		// creates EmbeddedWallet + mints tokens. Same as vitest.e2e.network.config.ts.
		// 120s was too short and timed out during deploy on slower machines.
		hookTimeout: 300_000,
		fileParallelism: false,
		// Cross-file Chrome-state isolation: own forked worker per file. Mirrors
		// vitest.e2e.network + vitest.e2e.config (these were missing here — part
		// of the same keep-in-sync drift as the noir aliases).
		pool: "forks",
		isolate: true,
		// Match the network runner's retry budget (NULO_E2E_RETRY override, default 2).
		retry: process.env.NULO_E2E_RETRY ? Number(process.env.NULO_E2E_RETRY) : 2,
		// Default output plus the retained first-attempt errors of retried passes.
		reporters: ["default", new RetryErrorReporter()],
		// Node v24 enforces JSON import attributes; `@aztec/accounts` lazy
		// loaders import their .json artifacts without the `with: { type:
		// "json" }` attribute, so vanilla Node refuses them in global-setup
		// (contract deploy fails with `ERR_IMPORT_ATTRIBUTE_MISSING`).
		// Inline-transforming the `@aztec` packages routes them through
		// vitest's own transformer, which doesn't enforce the attribute.
		// Mirrors vitest.e2e.network.config.ts.
		server: {
			deps: {
				inline: [/@aztec/],
			},
		},
	},
})
