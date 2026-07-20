/**
 * Verify that a deployments json's committed addresses match what
 * `getContractInstanceFromInstantiationParams` derives from the
 * stored constructor params + salts. If the constants drift from the
 * deploy script's output, wallet scope enforcement will reject every
 * `registerContract` call at connect time — failing here is cheaper.
 *
 *   bun apps/faucet/scripts/verify-deployments.ts [--config <path>]
 *
 * Default target is the committed LIVE src/contracts/deployments.json;
 * `--config` points it at a candidate (candidate-first: the P6 redeploy
 * verifies deployments.candidate.json through the SAME derivation the app
 * will later trust, before `promote` touches the live file).
 *
 * Lives outside vitest because bb.js's sync poseidon hash relies on a
 * WASM runtime init that jsdom doesn't provide. As a bun-run script
 * (Node), bb.js initializes on first call and the rebuild works.
 *
 * Wired into `audit:faucet` in the root package.json.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
	type DeploymentsJson,
	rebuildDripperInstanceFrom,
	rebuildTokenInstanceFrom,
	type TokenDeployment,
} from "../src/contracts/deployments.js"

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONFIG = join(here, "..", "src", "contracts", "deployments.json")

function parseConfigPath(argv: string[]): string {
	const i = argv.indexOf("--config")
	if (i < 0) return DEFAULT_CONFIG
	const p = argv[i + 1]
	if (!p) {
		console.error("--config requires a path")
		process.exit(1)
	}
	return p
}

function findToken(data: DeploymentsJson, symbol: "NULO" | "OLUN"): TokenDeployment {
	const t = data.tokens.find((t) => t.constructorArgs.symbol === symbol)
	if (!t) throw new Error(`deployments json missing token: ${symbol}`)
	return t
}

async function main(): Promise<void> {
	const configPath = parseConfigPath(process.argv.slice(2))
	const data = JSON.parse(readFileSync(configPath, "utf8")) as DeploymentsJson
	console.log(`verifying ${configPath}`)

	const nuloRecord = findToken(data, "NULO")
	const olunRecord = findToken(data, "OLUN")
	const [dripper, nulo, olun] = await Promise.all([
		rebuildDripperInstanceFrom(data.dripper),
		rebuildTokenInstanceFrom(nuloRecord),
		rebuildTokenInstanceFrom(olunRecord),
	])

	const checks: Array<{ name: string; computed: string; committed: string }> = [
		{ name: "dripper", computed: dripper.address.toString(), committed: data.dripper.address },
		{ name: "nulo", computed: nulo.address.toString(), committed: nuloRecord.address },
		{ name: "olun", computed: olun.address.toString(), committed: olunRecord.address },
	]

	let allOk = true
	for (const c of checks) {
		const ok = c.computed.toLowerCase() === c.committed.toLowerCase()
		console.log(`[${ok ? "OK" : "DRIFT"}] ${c.name.padEnd(8)} computed=${c.computed} committed=${c.committed}`)
		if (!ok) allOk = false
	}

	if (!allOk) {
		console.error(
			"\nFAIL: the deployments json is out of sync with rebuild logic.\n" +
				"Re-run `bun run deploy:testnet[:dry]` and re-verify the regenerated candidate.\n",
		)
		process.exit(1)
	}

	console.log("\nAll committed addresses match the rebuilt instances.")
}

main().catch((err: unknown) => {
	console.error("verify-deployments failed:", err)
	process.exit(1)
})
