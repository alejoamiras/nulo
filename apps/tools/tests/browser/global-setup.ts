/**
 * Proves the run is coherent before a browser opens: the handle names the sandbox the builds were
 * made for, and the faucet record the sandbox deployed is the one the app commits (universal
 * deploys — deployer ZERO, fixed salts — so the addresses are the same on every chain).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { readHandle } from "@nulo/bridge-core/sandbox"
import { runEnv } from "./env"

const canonical = (json: string) => JSON.stringify(JSON.parse(json), Object.keys(JSON.parse(json)).sort())

export default function globalSetup(): void {
	const env = runEnv()
	const handle = readHandle(env.artifactsDir)
	if (handle.l1ChainId !== 31337) throw new Error(`the sandbox handle names L1 chain ${handle.l1ChainId}, expected 31337`)
	const build = JSON.parse(readFileSync(join(env.toolsDist, "build.json"), "utf8")) as { target?: string; chainId?: number }
	if (build.target !== "local" || build.chainId !== handle.walletChainId) {
		throw new Error(`the tools build in ${env.toolsDist} is ${build.target}/${build.chainId}, not local/${handle.walletChainId}`)
	}
	const committed = readFileSync(new URL("../../src/contracts/deployments.json", import.meta.url), "utf8")
	const deployed = readFileSync(join(env.artifactsDir, "deployments.json"), "utf8")
	if (canonical(committed) !== canonical(deployed)) {
		throw new Error(
			"the sandbox's deployments.json differs from apps/tools/src/contracts/deployments.json — the drip record is no longer universal",
		)
	}
}
