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
		// worker process so puppeteer browser + chrome.storage.local + SW state
		// from earlier files cannot leak into the next file's launch. Without
		// this, dApp tests deterministically pass in isolation but fail when
		// run later in the same suite — the previous file's leftover browser
		// connection + SW session state stays in worker memory and breaks the
		// next file's encrypted-channel setup.
		//
		// The smoke config (vitest.e2e.config.ts:33-34) has carried this since
		// the open-source initial import. It was never propagated to the
		// network config — likely a migration miss when vitest 4 dropped
		// poolOptions.forks.{singleFork,isolate} from the runtime schema.
		// Confirmed via diagnostic test in implementations-plan/e2e-full-network-recovery/findings.md.
		pool: "forks",
		isolate: true,
		// Node v24 enforces JSON import attributes; @aztec/accounts imports JSON without them.
		// Use the unstable loader to relax this check in the global setup process.
		server: {
			deps: {
				inline: [/@aztec/],
			},
		},
	},
})
