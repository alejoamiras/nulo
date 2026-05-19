import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
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
