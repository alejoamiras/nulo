/**
 * Node-only: turns a sandbox run's artifacts (`bun run --cwd packages/bridge-core sandbox:up
 * --artifacts <dir>`) into the local target + its manifest. Used by `vite.local.config.mts` at
 * config-eval time and by `verify-build-target.ts`; never imported by the app bundle.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type LocalTargetConfig, localTarget, type ToolsTarget } from "./network-targets"

interface Handle {
	nodeUrl: string
	rollupVersion: number
	walletChainId: number
	l1ChainId: number
}

export interface LocalRun {
	target: ToolsTarget
	config: LocalTargetConfig
	manifestJson: string
	/** The faucet record the sandbox deployed — must equal the app's committed `deployments.json`. */
	deploymentsJson: string
}

export interface LocalRunOptions {
	/** Where the browser suite serves the built app (exact hostname is integrity layer 5). */
	host?: string
	/** The test-wallet pages discovery probes. */
	webWalletUrls?: readonly string[]
}

export function loadLocalRun(artifactsDir: string, opts: LocalRunOptions = {}): LocalRun {
	const handle = JSON.parse(readFileSync(join(artifactsDir, "handle.json"), "utf8")) as Handle
	if (handle.l1ChainId !== 31337) throw new Error(`local target: the sandbox handle names L1 chain ${handle.l1ChainId}, expected 31337`)
	const config: LocalTargetConfig = {
		nodeUrl: handle.nodeUrl,
		rollupVersion: handle.rollupVersion,
		walletChainId: handle.walletChainId,
		host: opts.host ?? "127.0.0.1",
		webWalletUrls: opts.webWalletUrls ?? [],
	}
	return {
		target: localTarget(config),
		config,
		manifestJson: readFileSync(join(artifactsDir, "manifest.json"), "utf8"),
		deploymentsJson: readFileSync(join(artifactsDir, "deployments.json"), "utf8"),
	}
}

/** `NULO_SANDBOX_ARTIFACTS` (required), `NULO_TOOLS_HOST`, `NULO_TOOLS_WEB_WALLETS` (comma-separated). */
export function loadLocalRunFromEnv(env: NodeJS.ProcessEnv = process.env): LocalRun {
	const dir = env.NULO_SANDBOX_ARTIFACTS
	if (!dir) throw new Error("the local target needs NULO_SANDBOX_ARTIFACTS=<dir written by sandbox:up>")
	return loadLocalRun(dir, {
		host: env.NULO_TOOLS_HOST,
		webWalletUrls: (env.NULO_TOOLS_WEB_WALLETS ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	})
}
