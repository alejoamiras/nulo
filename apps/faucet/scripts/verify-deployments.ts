/**
 * Verify that deployments.json's committed addresses match what
 * `getContractInstanceFromInstantiationParams` derives from the
 * stored constructor params + salts. If the constants drift from the
 * deploy script's output, wallet scope enforcement will reject every
 * `registerContract` call at connect time — failing here is cheaper.
 *
 * Lives outside vitest because bb.js's sync poseidon hash relies on a
 * WASM runtime init that jsdom doesn't provide. As a bun-run script
 * (Node), bb.js initializes on first call and the rebuild works.
 *
 * Wired into `audit:faucet` in the root package.json.
 */
import { readFileSync } from "node:fs"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenContractArtifact } from "@alejoamiras/aztec-standards/dist/src/artifacts/Token.js"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { DRIPPER, OLUN, rebuildDripperInstance, rebuildOlunInstance, rebuildNuloInstance, NULO } from "../src/contracts/deployments.js"

/**
 * Bridge-manifest verifier (L10 / fresh-audit F1): OPT-IN via `BRIDGE_MANIFEST`. Rebuilds the L2
 * proxy/token/bridge instances from the manifest's salts+args (same universal-deploy path as
 * deploy-bridge-testnet) and asserts they match the committed addresses — a new artifact that derives
 * a DIFFERENT address than committed would strand the cutover. Also asserts router/permit2/swapTarget
 * are present (C7 — bridge-only now requires them) and `privateClaimMode: "salt-v2"` (L9 interlock).
 * Runs against the CANDIDATE in Phase 6 (`BRIDGE_MANIFEST=…candidate.json`); unset ⇒ skipped, so the
 * default `audit:faucet` run (live manifest, pre-cutover) is unaffected.
 */
async function verifyBridgeManifest(path: string): Promise<boolean> {
	const m = JSON.parse(readFileSync(path, "utf8")) as {
		l1: { fuel?: { router?: string; permit2?: string; swapTarget?: string }; privateClaimMode?: string; portal: string }
		l2: {
			proxy: { address: string; salt: string; constructorArtifact: string }
			token: { address: string; salt: string; constructorArtifact: string; constructorArgs: [string, string, number] }
			bridge: { address: string; salt: string; constructorArtifact: string }
		}
	}
	const common = { publicKeys: PublicKeys.default(), deployer: AztecAddress.ZERO } as const
	const proxy = await getContractInstanceFromInstantiationParams(bridgeProxyArtifact, {
		...common,
		constructorArgs: [],
		salt: new Fr(BigInt(m.l2.proxy.salt)),
		constructorArtifact: m.l2.proxy.constructorArtifact,
	})
	const [name, symbol, decimals] = m.l2.token.constructorArgs
	const token = await getContractInstanceFromInstantiationParams(TokenContractArtifact, {
		...common,
		constructorArgs: [name, symbol, decimals, proxy.address],
		salt: new Fr(BigInt(m.l2.token.salt)),
		constructorArtifact: m.l2.token.constructorArtifact,
	})
	const bridge = await getContractInstanceFromInstantiationParams(tokenBridgeArtifact, {
		...common,
		constructorArgs: [proxy.address, EthAddress.fromString(m.l1.portal)],
		salt: new Fr(BigInt(m.l2.bridge.salt)),
		constructorArtifact: m.l2.bridge.constructorArtifact,
	})

	let ok = true
	const pin = (label: string, computed: string, committed: string) => {
		const good = computed.toLowerCase() === committed.toLowerCase()
		console.log(`[${good ? "OK" : "DRIFT"}] bridge.${label.padEnd(6)} computed=${computed} committed=${committed}`)
		if (!good) ok = false
	}
	pin("proxy", proxy.address.toString(), m.l2.proxy.address)
	pin("token", token.address.toString(), m.l2.token.address)
	pin("bridge", bridge.address.toString(), m.l2.bridge.address)

	if (!m.l1.fuel?.router || !m.l1.fuel?.permit2 || !m.l1.fuel?.swapTarget) {
		console.error("[FAIL] bridge manifest missing required router/permit2/swapTarget (C7)")
		ok = false
	}
	if (m.l1.privateClaimMode !== "salt-v2") {
		console.error(`[FAIL] bridge manifest privateClaimMode is ${m.l1.privateClaimMode ?? "absent"} (want "salt-v2" — L9 interlock)`)
		ok = false
	}
	return ok
}

async function main(): Promise<void> {
	const [dripper, usdc, eth] = await Promise.all([rebuildDripperInstance(), rebuildNuloInstance(), rebuildOlunInstance()])

	const checks: Array<{ name: string; computed: string; committed: string; ok: boolean }> = [
		{
			name: "dripper",
			computed: dripper.address.toString(),
			committed: DRIPPER.toString(),
			ok: dripper.address.equals(DRIPPER),
		},
		{
			name: "usdc",
			computed: usdc.address.toString(),
			committed: NULO.toString(),
			ok: usdc.address.equals(NULO),
		},
		{
			name: "eth",
			computed: eth.address.toString(),
			committed: OLUN.toString(),
			ok: eth.address.equals(OLUN),
		},
	]

	let allOk = true
	for (const c of checks) {
		const status = c.ok ? "OK" : "DRIFT"
		console.log(`[${status}] ${c.name.padEnd(8)} computed=${c.computed} committed=${c.committed}`)
		if (!c.ok) allOk = false
	}

	// L10 / F1: opt-in bridge-manifest verification (Phase 6 candidate). Unset ⇒ skipped.
	const bridgeManifest = process.env.BRIDGE_MANIFEST
	if (bridgeManifest) {
		console.log(`\n=== bridge manifest: ${bridgeManifest} ===`)
		if (!(await verifyBridgeManifest(bridgeManifest))) allOk = false
	}

	if (!allOk) {
		console.error(
			"\nFAIL: a manifest is out of sync with rebuild logic (or missing required bridge config).\n" +
				"Re-run the deploy and commit the regenerated JSON.\n",
		)
		process.exit(1)
	}

	console.log("\nAll committed addresses match the rebuilt instances.")
}

main().catch((err: unknown) => {
	console.error("verify-deployments failed:", err)
	process.exit(1)
})
