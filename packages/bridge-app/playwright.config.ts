import { defineConfig } from "@playwright/test"

/**
 * Bridge-app L1↔L2 e2e against the LOCAL sandbox. Prereqs (manual for now):
 *   1. aztec + anvil sandbox running (node :8080, anvil :8545)
 *   2. `bun run deploy:sandbox` (in bridge-core) → writes public/{sandbox,token_bridge}.json
 * Then: `bun run --cwd packages/bridge-app test:e2e`. The in-browser PXE + the
 * cross-chain message sync make a single flow take ~1-2 min — hence the long timeouts.
 */
export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 300_000,
	expect: { timeout: 240_000 },
	fullyParallel: false,
	workers: 1,
	use: { baseURL: "http://localhost:5177", headless: true, trace: "retain-on-failure" },
	webServer: {
		command: "bun run dev",
		url: "http://localhost:5177",
		reuseExistingServer: true,
		timeout: 60_000,
	},
})
