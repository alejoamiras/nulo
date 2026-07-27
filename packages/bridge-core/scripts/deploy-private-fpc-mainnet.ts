/**
 * MAINNET (Alpha) PrivateFPC deploy — the mainnet sibling of deploy-private-fpc-testnet.ts. Same
 * canonical derivation (PRIVATE_FPC_SALT, deployer ZERO → the pinned network-independent address);
 * the fee delta is structural: no SponsoredFPC exists on mainnet, so the FUNDED L2 deployer
 * (resolveDeployerKeys("mainnet"), fee juice claimed by the conductor's group 3) pays the deploy.
 *
 * Gate first (fail-closed): AZTEC_NODE_URL=<alpha> bun scripts/check-fpc-version.ts --mode predeploy
 * Run:                      bun scripts/deploy-private-fpc-mainnet.ts
 * Idempotent — exits early if the pinned instance already exists.
 */

import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { PrivateFPCContract } from "@alejoamiras/private-fee-juice/artifacts/private"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { PRIVATE_FPC_ADDRESS, PRIVATE_FPC_SALT } from "../src/private-fuel"
import { resolveDeployerKeys } from "./deployer-keys"

const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://lb.drpc.live/aztec-mainnet/Ak_eT5HA2kbyqamqGTF702cdsdWqLTIR8YdadmahlY6k"

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`
	const node = createAztecNodeClient(NODE_URL)
	const pinned = AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)

	if (await node.getContract(pinned)) {
		console.log(`PrivateFPC already deployed at ${PRIVATE_FPC_ADDRESS} — nothing to do.`)
		return
	}

	// The conductor's L2 deployer — its claimed public fee-juice balance pays this deploy.
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const { secret, salt } = resolveDeployerKeys("mainnet")
	const { signingKey, secretKey } = await deriveNuloAccountKeys(secret)
	const manager = await ewallet.createSchnorrAccount(secretKey, salt, signingKey)
	const from = (await manager.getAccount()).getAddress()
	// node.getContract serves instances at a LATER finalization stage than the CHECKPOINTED wait the
	// conductor used — a freshly-deployed account operates (it proved the whole trio) minutes before
	// it is visible here. Bounded wait for the proving lag; a never-visible account is a real error.
	let visible = false
	for (let i = 0; i < 100 && !visible; i++) {
		visible = (await node.getContract(from)) !== undefined && (await node.getContract(from)) !== null
		if (!visible) {
			if (i === 0) console.log(`L2 deployer ${from} not yet visible via getContract — waiting out the proving lag…`)
			await new Promise((r) => setTimeout(r, 12_000))
		}
	}
	if (!visible) throw new Error(`L2 deployer ${from} never became visible — run the conductor's L2 group first; STOP`)
	console.log(`L2 deployer ${from.toString()} pays via fee juice`)

	console.log(`deploying PrivateFPC (canonical salt, deployer ZERO)… (${mins()})`)
	const result = await PrivateFPCContract.deploy(ewallet as never, {
		salt: Fr.fromHexString(PRIVATE_FPC_SALT),
		universalDeploy: true,
	}).send({
		fee: { paymentMethod: preexistingFeeJuicePayment(from) },
		from,
	} as never)
	const got = result.instance.address.toString()
	if (got !== PRIVATE_FPC_ADDRESS) {
		throw new Error(`deployed address ${got} != pinned ${PRIVATE_FPC_ADDRESS} — artifact/pin mismatch, investigate`)
	}
	console.log(`✅ PrivateFPC live at ${got} (${mins()})`)
	console.log("   Next: check-fpc-version --mode require-deployed, then the dust canary.")
}

await main()
