import vue from "@vitejs/plugin-vue"
import useAutoImport from "unplugin-auto-import/vite"
import { defineConfig } from "vitest/config"
import { sharedTest } from "../../vitest.base"
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
		...sharedTest,
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
			"../../packages/wallet-core/src/**/*.test.ts",
			"../../packages/wallet-crypto/src/**/*.test.ts",
			"../../packages/extension-messaging/src/**/*.test.ts",
			"../../packages/aztec-runtime/src/**/*.test.ts",
			"../../packages/wallet-bridge/src/**/*.test.ts",
			"../../packages/wallet-sdk-schema-patch/src/**/*.test.ts",
		],
		exclude: [
			"tests/e2e/**",
			"node_modules/**",
			// Needs bb.js WASM poseidon2 (deriveSecretKeyFromSigningKey + address derivation),
			// which crashes under jsdom (`BBApiException: std::bad_cast` — the same limitation
			// that defers V4/V10 in key-vectors.test.ts). It runs in aztec-runtime's OWN suite
			// (node environment) via `test:all`.
			"../../packages/aztec-runtime/src/account/derivation-vectors.test.ts",
			// Same bb.js WASM limitation (poseidon2HashWithSeparator in the account-seed fan-out
			// + full-chain address derivation). Runs in aztec-runtime's own node-env suite via `test:all`.
			"../../packages/aztec-runtime/src/account/account-seed-vectors.test.ts",
			// Same bb.js WASM limitation (NuloAccount address derivation in the round-trip KATs).
			"../../packages/aztec-runtime/src/account/account-export.test.ts",
			// Same bb.js WASM limitation (poseidon2 in the class-id hash) plus node-only fs
			// digest reads. Runs in aztec-runtime's own node-env suite via `test:all`.
			"../../packages/aztec-runtime/src/account/artifact-freeze.test.ts",
			// Same bb.js WASM limitation (address derivation + init-hash poseidon2) + node crypto.
			// Runs in aztec-runtime's own node-env suite via `test:all`.
			"../../packages/aztec-runtime/src/account/instantiation-descriptor.test.ts",
			// Node-only (fs + import.meta.url file resolution — jsdom's URL isn't file-scheme).
			// Runs in aztec-runtime's own node-env suite via `test:all`.
			"../../packages/aztec-runtime/src/pxe/opfs-store.test.ts",
			// Live bb.js WASM poseidon2 (computeLogTag for the Transfer tag + the class-id hash in the
			// D2 gate), which crashes under jsdom (`BBApiException: std::bad_cast` — same limitation as
			// the account vectors above). Runs in aztec-runtime's own node-env suite via `test:all`.
			"../../packages/aztec-runtime/src/pxe/public-events.test.ts",
		],
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
