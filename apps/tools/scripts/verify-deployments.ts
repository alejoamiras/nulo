/**
 * Verify that a deployments json's committed addresses match what
 * `getContractInstanceFromInstantiationParams` derives from the
 * stored constructor params + salts. If the constants drift from the
 * deploy script's output, wallet scope enforcement will reject every
 * `registerContract` call at connect time — failing here is cheaper.
 *
 *   bun apps/tools/scripts/verify-deployments.ts [--config <path>]
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
 * Wired into `audit:tools` in the root package.json.
 */
import { readFileSync } from "node:fs"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { EthAddress } from "@aztec/foundation/eth-address"
import { assertManifestTokensDerive, parseManifestV2 } from "@nulo/bridge-core"
import { tokenBridgeHubArtifact } from "@nulo/bridge-core/artifacts"
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

/**
 * Bridge-manifest verifier, OPT-IN via `BRIDGE_MANIFEST`. Re-derives the hub from its recorded
 * salt + constructor args and every token from the hub + its words, and asserts both match the
 * committed addresses — an artifact that derives a different address than committed would strand
 * the cutover. Unset ⇒ skipped, so the default run against the live manifest is unaffected.
 *
 * `bridge: null` is the legal placeholder the app renders as such (the build gate runs this against
 * BOTH targets' live manifests); refusing a placeholder is promotion's job (`promotion.ts`), not
 * the build's.
 */
async function verifyBridgeManifest(path: string): Promise<boolean> {
	const m = parseManifestV2(JSON.parse(readFileSync(path, "utf8")))
	if (!m.bridge) {
		console.log(`[OK] ${m.network} manifest is a placeholder (bridge: null) — nothing to derive`)
		return true
	}
	const hub = m.bridge.l2.hub
	const [classId, factory, guardian] = hub.constructorArgs as [string, string, string]
	const derived = await getContractInstanceFromInstantiationParams(tokenBridgeHubArtifact, {
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.ZERO,
		constructorArgs: [Fr.fromHexString(classId), EthAddress.fromString(factory), AztecAddress.fromStringUnsafe(guardian)],
		salt: Fr.fromHexString(hub.salt),
		constructorArtifact: hub.constructorArtifact,
	})
	const hubOk = derived.address.toString().toLowerCase() === hub.address.toLowerCase()
	console.log(`[${hubOk ? "OK" : "DRIFT"}] bridge.hub    computed=${derived.address.toString()} committed=${hub.address}`)
	try {
		await assertManifestTokensDerive(m)
		for (const t of m.bridge.tokens) console.log(`[OK] bridge.token  ${t.displaySymbol.padEnd(6)} ${t.l2Token}`)
	} catch (e) {
		console.error(`[DRIFT] ${e instanceof Error ? e.message : String(e)}`)
		return false
	}
	return hubOk
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

	const bridgeManifest = process.env.BRIDGE_MANIFEST
	if (bridgeManifest) {
		console.log(`\n=== bridge manifest: ${bridgeManifest} ===`)
		if (!(await verifyBridgeManifest(bridgeManifest))) allOk = false
	}

	if (!allOk) {
		console.error(
			"\nFAIL: a manifest is out of sync with rebuild logic (or missing required bridge config).\n" +
				"Regenerate the candidate with the generation conductor and re-verify.\n",
		)
		process.exit(1)
	}

	console.log("\nAll committed addresses match the rebuilt instances.")
}

main().catch((err: unknown) => {
	console.error("verify-deployments failed:", err)
	process.exit(1)
})
