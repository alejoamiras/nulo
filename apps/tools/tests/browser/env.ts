/**
 * One run's coordinates, resolved by `scripts/e2e/agent.sh` and read here by the config, the global
 * setup and the fixtures. Nothing boots in-process: the sandbox is the CLI's, the two servers are
 * Playwright's `webServer`s over builds the runner produced.
 */
import { join } from "node:path"

export interface RunEnv {
	/** `handle.json`, `manifest.json`, `deployments.json` — written by `sandbox:up`. */
	artifactsDir: string
	toolsPort: number
	toolsDist: string
	toolsOrigin: string
	testWalletPort: number
	testWalletDist: string
	testWalletOrigin: string
	/** Where a run keeps its own state (ports, owned pids, traces). */
	stateDir: string
}

function required(name: string): string {
	const v = process.env[name]
	if (!v) throw new Error(`tools browser suite: ${name} is not set — run it through scripts/e2e/agent.sh`)
	return v
}

export function runEnv(): RunEnv {
	const artifactsDir = required("NULO_SANDBOX_ARTIFACTS")
	const toolsPort = Number(required("NULO_TOOLS_PORT"))
	const testWalletPort = Number(required("NULO_TEST_WALLET_PORT"))
	return {
		artifactsDir,
		toolsPort,
		toolsDist: required("NULO_TOOLS_DIST"),
		toolsOrigin: `http://127.0.0.1:${toolsPort}`,
		testWalletPort,
		testWalletDist: required("NULO_TEST_WALLET_DIST"),
		testWalletOrigin: `http://127.0.0.1:${testWalletPort}`,
		stateDir: process.env.NULO_E2E_STATE_DIR ?? join(artifactsDir, ".."),
	}
}

/** The wallet URLs the local tools build lists, one per profile — the strings baked into its bundle. */
export function webWalletUrls(env: Pick<RunEnv, "testWalletOrigin">): string[] {
	return ["plain", "selfpay", "full"].map((p) => `${env.testWalletOrigin}/?profile=${p}`)
}
