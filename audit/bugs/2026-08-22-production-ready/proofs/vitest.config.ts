import { defineConfig } from "vitest/config"
import { artifactAliases, sharedDefine, srcDir } from "../../../../apps/extension/vite.shared"

export default defineConfig({
	resolve: {
		alias: {
			"@": srcDir,
			...artifactAliases,
		},
	},
	define: sharedDefine,
	server: {
		deps: {
			inline: [/^@nulo\//],
		},
	},
	test: {
		globals: true,
		environment: "node",
		include: ["*.proof.test.ts"],
	},
})
