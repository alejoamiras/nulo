/**
 * Smoke test for setupPreFundedAccount (WS3 W3.2).
 *
 * Validates the full L1→L2 + claim + mint flow end-to-end against a fresh
 * sandbox. If this passes, the fixture is ready to wire into
 * feeJuiceImportedExtension (W3.3).
 *
 * Run: bun run tests/e2e/scripts/check-setup-pre-funded.ts
 *
 * Requires the local Aztec sandbox + Anvil running.
 */
import { createTestWallet, setupPreFundedAccount, LOCAL_NODE_URL } from "../fixtures/aztec"

async function main(): Promise<void> {
	console.log("[setup-pre-funded] starting...")
	const { wallet, accounts, node, cleanup } = await createTestWallet(LOCAL_NODE_URL)
	const feePayerAddress = accounts[0]
	if (!feePayerAddress) {
		throw new Error("expected at least one sandbox-deployed test account")
	}

	try {
		const result = await setupPreFundedAccount(wallet, node, feePayerAddress)
		console.log("[setup-pre-funded] success!")
		console.log(`  accountAddress: ${result.accountAddress.toString()}`)
		console.log(`  masterBase64:   ${result.masterBase64}`)
	} finally {
		await cleanup()
	}
}

main().catch((err) => {
	console.error("[setup-pre-funded] error:", err)
	process.exit(1)
})
