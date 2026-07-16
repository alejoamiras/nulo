/**
 * One-shot after a testnet reset: universally deploy the PrivateFPC at the CANONICAL salt
 * (`PRIVATE_FPC_SALT`, `0x…01` from 5.0.0 onward), deployer ZERO, so its address matches the
 * pinned `PRIVATE_FPC_ADDRESS` in `src/private-fuel.ts`. The deployment is permissionless (the
 * derivation binds no deployer), idempotent (exits early if the instance already exists),
 * and fee-paid by a throwaway account via the network's SponsoredFPC.
 *
 * Run: bun run scripts/deploy-private-fpc-testnet.ts   (no env needed beyond AZTEC_NODE_URL override)
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { PrivateFPCContract } from "@alejoamiras/aztec-fee-payment/artifacts/private"
import { PRIVATE_FPC_ADDRESS, PRIVATE_FPC_SALT } from "../src/private-fuel"

const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`
	const node = createAztecNodeClient(NODE_URL)
	const pinned = AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)

	if (await node.getContract(pinned)) {
		console.log(`PrivateFPC already deployed at ${PRIVATE_FPC_ADDRESS} — nothing to do.`)
		return
	}

	// Throwaway account; the SponsoredFPC pays its deployment AND the FPC deploy.
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const secret = Fr.random()
	// 5.0.0-typed seam: wallet-crypto pins @aztec 5.0.0 (runtime-compatible patch drift vs our 5.0.1)
	const { signingKey, secretKey } = await deriveNuloAccountKeys(secret as never)
	const manager = await ewallet.createSchnorrAccount(secretKey as never, Fr.random(), signingKey as never)
	const l2account = await manager.getAccount()

	const sponsored = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
	})
	try {
		await ewallet.registerContract(sponsored, SponsoredFPCContract.artifact)
	} catch {}
	const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsored.address) }

	if (!(await node.getContract(l2account.getAddress()))) {
		console.log(`deploying the throwaway account (sponsored, real proof)… (${mins()})`)
		const deployMethod = await manager.getDeployMethod()
		await deployMethod.send({ fee, from: "NO_FROM" as never } as never)
		console.log(`account deployed (${mins()})`)
	}

	// The CANONICAL salt (PRIVATE_FPC_SALT, fixed from 5.0.0 onward) + universalDeploy (deployer
	// ZERO) reproduces the pinned derivation. The EmbeddedWallet
	// itself is the `Wallet` for the deploy (the account object lacks getContractClassMetadata —
	// same pattern as the faucet's deploy.ts); the account only supplies `from` + pays via sponsored.
	console.log(`deploying PrivateFPC (canonical salt, deployer ZERO)… (${mins()})`)
	const result = await PrivateFPCContract.deploy(ewallet as never, {
		// 5.0.0-typed seam: @alejoamiras/aztec-fee-payment pins @aztec 5.0.0 (no 5.0.1 published)
		salt: Fr.fromHexString(PRIVATE_FPC_SALT) as never,
		universalDeploy: true,
	}).send({
		fee,
		from: l2account.getAddress(),
	} as never)
	const got = result.instance.address.toString()
	if (got !== PRIVATE_FPC_ADDRESS) {
		throw new Error(`deployed address ${got} != pinned ${PRIVATE_FPC_ADDRESS} — artifact/pin mismatch, investigate`)
	}
	console.log(`✅ PrivateFPC live at ${got} (${mins()})`)
}

await main()
