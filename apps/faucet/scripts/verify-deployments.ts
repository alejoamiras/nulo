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
import { DRIPPER, OLUN, rebuildDripperInstance, rebuildOlunInstance, rebuildNuloInstance, NULO } from "../src/contracts/deployments.js"

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

	if (!allOk) {
		console.error(
			"\nFAIL: deployments.json is out of sync with rebuild logic.\n" +
				"Re-run `bun run deploy:testnet[:dry]` and commit the regenerated JSON.\n",
		)
		process.exit(1)
	}

	console.log("\nAll committed addresses match the rebuilt instances.")
}

main().catch((err: unknown) => {
	console.error("verify-deployments failed:", err)
	process.exit(1)
})
