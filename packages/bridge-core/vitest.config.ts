import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["./src/test/setup.ts"],
		// The integration suite boots a live sandbox; it runs from vitest.integration.config.ts only.
		exclude: ["node_modules", "test/integration/**"],
	},
})
