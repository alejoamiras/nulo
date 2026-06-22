import vue from "@vitejs/plugin-vue"
import useAutoImport from "unplugin-auto-import/vite"
import { defineConfig } from "vitest/config"
import { artifactAliases, sharedDefine, srcDir } from "./vite.shared"

export default defineConfig({
	// Vue plugin + auto-import: required so vitest can compile *.vue
	// SFCs and resolve auto-imported identifiers (RouterLink from
	// vue-router, ref/computed from vue, etc.) the same way the
	// production build does.
	plugins: [
		vue(),
		useAutoImport({
			imports: ["vue", "vue-router"],
			dts: false,
		}),
	],
	resolve: {
		alias: {
			"@": srcDir,
			...artifactAliases,
		},
	},
	define: sharedDefine,
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: "./tests/vitest.setup.ts",
		// Pick up co-located tests in extracted @nulo/* workspace packages
		// (same pattern as source-first exports — no per-package vitest
		// config, extension remains the single test runner).
		include: [
			"src/**/*.test.ts",
			// e2e infra helpers that are pure TS (no sandbox) — e.g. the
			// boot-failure classifier. The sandbox-bound specs under tests/e2e/**
			// stay excluded below; only co-located script unit tests run here.
			"scripts/**/*.test.ts",
			"../wallet-core/src/**/*.test.ts",
			"../wallet-crypto/src/**/*.test.ts",
			"../extension-messaging/src/**/*.test.ts",
			"../aztec-runtime/src/**/*.test.ts",
			"../wallet-bridge/src/**/*.test.ts",
		],
		exclude: ["tests/e2e/**", "node_modules/**"],
		// Inline workspace @nulo/* packages so vite processes their TS
		// source entry points instead of externalizing them (default
		// vitest behavior for node_modules, which breaks on
		// source-first exports with no dist build).
		server: {
			deps: {
				inline: [/^@nulo\//],
			},
		},
	},
})
