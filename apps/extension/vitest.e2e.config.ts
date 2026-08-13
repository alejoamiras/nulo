import { defineConfig } from "vitest/config"
import RetryErrorReporter from "./tests/e2e/retry-error-reporter"
import { srcDir } from "./vite.shared"

export default defineConfig({
	resolve: {
		alias: {
			"@": srcDir,
		},
	},
	test: {
		include: ["tests/e2e/*.test.ts"],
		exclude: ["tests/e2e/network/**"],
		environment: "node",
		globalSetup: "./tests/e2e/global-setup-smoke.ts",
		// Hosted GitHub Actions runners are consistently 3-5x slower than local
		// for multi-step user flows (change-password, backup-export, etc.).
		// 60s lets those breathe without masking real bugs (a deadlock will
		// still hit the ceiling). Locally these all finish in <10s anyway.
		testTimeout: 60_000,
		hookTimeout: 90_000,
		fileParallelism: false,
		// Cross-file Chrome-state isolation on hosted CI: each test file gets
		// its own forked worker process so orphan processes from earlier files
		// cannot leak into the next file's puppeteer launch. Without this,
		// after ~17 sequential files, the next file occasionally inherits a
		// broken Chrome connection — manifests as cascading `Connection
		// closed` / `Navigating frame was detached` errors.
		//
		// Vitest 4: `poolOptions.forks.{singleFork,isolate}` is no longer in
		// the runtime schema. `fileParallelism: false` already forces
		// `maxWorkers = 1`, and `isolate: true` is the default — together
		// these give the same per-file isolation guarantee.
		pool: "forks",
		isolate: true,
		// Two retries on top of process isolation. Real bugs fail three times
		// in a row deterministically; flakes generally don't. The cost is at
		// most 2× run time on the failing test (per the retry semantics).
		// Empirical: dropping to retry:1 surfaced 4 fresh failures per run
		// against the documented "~17 sequential files Chrome cascade" path.
		// The second retry is doing real work, not masking.
		retry: 2,
		// Default output plus the retained first-attempt errors of retried passes.
		reporters: ["default", new RetryErrorReporter()],
	},
})
