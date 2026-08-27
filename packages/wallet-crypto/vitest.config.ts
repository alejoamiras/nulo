import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"
import { sharedTest } from "../../vitest.base"

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		...sharedTest,
		globals: true,
		environment: "jsdom",
	},
})
