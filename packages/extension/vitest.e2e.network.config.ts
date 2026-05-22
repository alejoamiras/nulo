import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
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
		// Two default retries across all network tests. The network suite
		// runs 40+ files against a single long-lived anvil+aztec sandbox;
		// under cumulative load the puppeteer 15s target-wait inside
		// waitForPopup occasionally drops with a generic `Timed out after
		// waiting 15000ms`. Tests pass deterministically in isolation. The
		// "rotating flake" pattern in implementations-plan/network-test-triage/
		// full-suite-findings.md documents this. retry: 1 covers single-drop;
		// observed runs show occasional 2-consecutive-drop on the same test
		// (data-addressBook), so retry: 2 gives the budget needed. Smoke
		// config uses retry: 2 for the same reason.
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
