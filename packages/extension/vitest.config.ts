import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import useAutoImport from "unplugin-auto-import/vite"
import { defineConfig } from "vitest/config"
import packageJson from "./package.json"

/** Resolve a file inside an npm package bypassing its `exports` field.
 *  Mirrors the helper in vite.config.ts — vitest doesn't share Vite's
 *  plugin pipeline for these artifact aliases, so we re-declare them
 *  here. Keep in sync. */
function resolvePackageFile(pkg: string, file: string): string {
	const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
	let dir = fileURLToPath(new URL(".", import.meta.url))
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ...parts, file)
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
}

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
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"@private-fpc-artifact": resolvePackageFile("@wonderland/aztec-fee-payment", "target/private_contract-PrivateFPC.json"),
			"@wonderland-token-artifact": resolvePackageFile(
				"@defi-wonderland/aztec-standards",
				"artifacts/target/token_contract-Token.json",
			),
		},
	},
	define: {
		__VERSION__: JSON.stringify(packageJson.version),
		__SENTINEL__: JSON.stringify(packageJson.sentinel),
		__AZTEC_VERSION__: JSON.stringify(packageJson.dependencies["@aztec/pxe"] ?? "unknown"),
		__NAME__: JSON.stringify(packageJson.name),
		__DISPLAY_NAME__: JSON.stringify(packageJson.displayName),
	},
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
