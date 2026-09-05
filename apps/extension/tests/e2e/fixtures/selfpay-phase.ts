/**
 * Fixtures for the self-pay phase gate: a token whose minter is an EXTENSION account
 * (so `mint_to_private` — the hub claim's inner call — runs from that account and
 * enqueues its non-allow-listed public finalisation), and PrivateFPC fuel bridged for
 * that account. The account's keys live only in the extension, so anything that must
 * be SENT AS the account (the mint, the credit's `PrivateFPC.mint`) is driven through
 * the playground; the script side only deploys, bridges, claims and reads.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import type { AztecNode } from "@aztec/aztec.js/node"
import { ProtocolContractAddress } from "@aztec/aztec.js/protocol"
import type { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContract } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { GasFees } from "@aztec/stdlib/gas"
import { type AztecTestConfig, createSponsoredFeeOptions, createTestWallet, mintPublicTokens } from "./aztec"
import { bridgeForMint } from "./aztec-private-fpc-bridge"

type ScriptWallet = InstanceType<typeof EmbeddedWallet>

/** Matches `E2E_FEE_GAS` in `./aztec` (a ceiling; the sponsor pays the actual fee). */
const FEE_GAS = { maxFeesPerGas: new GasFees(10n ** 13n, 10n ** 13n) }

/** Serialize a node-fetched contract instance the way the playground's `registerContract`
 *  inputs expect it (Fr / AztecAddress / EthAddress as hex strings, bigints as decimal). */
export function serializeInstance(instance: unknown): string {
	return JSON.stringify(instance, (_k, x) => {
		if (typeof x === "bigint") return x.toString()
		if (x && typeof x === "object" && "toString" in x && typeof x.toString === "function") {
			const ctor = Object.getPrototypeOf(x)?.constructor?.name
			if (ctor === "Fr" || ctor === "AztecAddress" || ctor === "EthAddress") return x.toString()
		}
		return x
	})
}

export type MinterToken = { address: string; instanceJson: string }

/** Deploy a Token whose minter is `minter` (an extension account), paid by the sponsored FPC
 *  from a sandbox account. Returns the address and the instance JSON for the dApp side. */
export async function deployMinterToken(config: AztecTestConfig, minter: string): Promise<MinterToken> {
	const { wallet, accounts, node, cleanup } = await createTestWallet(config.nodeUrl)
	try {
		const deployer = accounts[0]
		if (!deployer) throw new Error("expected a sandbox-deployed account to deploy from")
		const fee = await createSponsoredFeeOptions(wallet)
		const { contract } = await TokenContract.deployWithOpts(
			{ method: "constructor_with_minter", wallet },
			"PhaseToken",
			"PHT",
			18,
			AztecAddress.fromStringUnsafe(minter),
			AztecAddress.ZERO,
		).send({ fee: { paymentMethod: fee.paymentMethod, gasSettings: FEE_GAS }, from: deployer })
		const instance = await node.getContract(contract.address)
		if (!instance) throw new Error(`deployed token ${contract.address.toString()} not found at the node`)
		return { address: contract.address.toString(), instanceJson: serializeInstance(instance) }
	} finally {
		await cleanup()
	}
}

/** `owner`'s PUBLIC balance on `token` (the transfer shape's oracle). Private balances — the
 *  mint shape's, and the PrivateFPC credit — are notes only the extension's PXE holds, so they
 *  are read through the playground's `executeUtility`, never from here. */
export async function readPublicTokenBalance(config: AztecTestConfig, token: string, owner: string): Promise<bigint> {
	const { wallet, accounts, cleanup } = await createTestWallet(config.nodeUrl)
	try {
		const from = accounts[0]
		if (!from) throw new Error("expected a sandbox-deployed account")
		const contract = await TokenContract.at(AztecAddress.fromStringUnsafe(token), wallet)
		const answer: unknown = await contract.methods.balance_of_public(AztecAddress.fromStringUnsafe(owner)).simulate({ from })
		const value = typeof answer === "object" && answer !== null && "result" in answer ? (answer as { result: unknown }).result : answer
		return BigInt(value as bigint | number | string)
	} finally {
		await cleanup()
	}
}

/** The canonical PrivateFPC instance (salt 1, deployer ZERO — the wallet's auto-discovery). */
export async function privateFpcInstance(): Promise<{ address: AztecAddress; artifact: unknown; instance: unknown }> {
	const { PrivateFPCContract } = await import("@alejoamiras/private-fee-juice/artifacts/private")
	// biome-ignore lint/suspicious/noExplicitAny: aztec-stdlib instance mismatch between the FPC package's pinned version and Nulo's
	const artifact = (PrivateFPCContract as any).artifact
	const instance = await getContractInstanceFromInstantiationParams(artifact, { salt: new Fr(1n), deployer: AztecAddress.ZERO })
	return { address: instance.address, artifact, instance }
}

export type PrivateFuel = {
	fpc: string
	/** The bridged amount (the L1 fee-asset handler's fixed mint). */
	amount: bigint
	/** Claimer-bound bridge secret and its salt (`derive_bridge_secret`). */
	secret: string
	salt: string
	leafIndex: string
}

/** Bridge Fee Juice to the PrivateFPC, bound to `claimer`, until the message is readable on L2.
 *  The claim itself is left to the caller: `fundPrivateFpcCredit` claims + hands the mint to
 *  the extension; the fuel path lets the extension's first transaction claim, mint and pay. */
export async function bridgePrivateFuel(
	config: AztecTestConfig,
	node: AztecNode,
	wallet: ScriptWallet,
	claimer: string,
): Promise<PrivateFuel> {
	const fpc = await privateFpcInstance()
	const claimerAddr = AztecAddress.fromStringUnsafe(claimer)
	const salt = Fr.random()
	const fee = await createSponsoredFeeOptions(wallet)
	const scriptAccount = (await wallet.getAccounts())[0]?.item
	if (!scriptAccount) throw new Error("expected a sandbox-deployed account")
	const { secret, claimAmount, leafIndex } = await bridgeForMint(node, fpc.address, claimerAddr, salt, 0n, () =>
		mintPublicTokens(wallet, config.tokenAddress, scriptAccount.toString(), 1n, config.minterAddress, fee),
	)
	return {
		fpc: fpc.address.toString(),
		amount: claimAmount,
		secret: secret.toString(),
		salt: salt.toString(),
		leafIndex: leafIndex.toString(),
	}
}

/** Claim bridged fuel to the PrivateFPC on L2 from a sandbox account (the claim is
 *  recipient-bound through the leaf, so the sender does not matter). After this the
 *  extension must send `PrivateFPC.mint(amount, salt, leafIndex)` AS the claimer. */
export async function claimPrivateFuel(wallet: ScriptWallet, fuel: PrivateFuel): Promise<void> {
	const { Contract } = await import("@aztec/aztec.js/contracts")
	const { FeeJuiceArtifact } = await import("@aztec/protocol-contracts/fee-juice")
	const fpc = await privateFpcInstance()
	// biome-ignore lint/suspicious/noExplicitAny: see privateFpcInstance
	await (wallet as any).registerContract(fpc.instance, fpc.artifact).catch(() => {})
	const fee = await createSponsoredFeeOptions(wallet)
	const scriptAccount = (await wallet.getAccounts())[0]?.item
	if (!scriptAccount) throw new Error("expected a sandbox-deployed account")
	const feeJuice = await Contract.at(ProtocolContractAddress.FeeJuice, FeeJuiceArtifact, wallet)
	await feeJuice.methods
		.claim(fpc.address, fuel.amount, Fr.fromString(fuel.secret), Fr.fromString(fuel.leafIndex))
		.send({ fee: { paymentMethod: fee.paymentMethod, gasSettings: FEE_GAS }, from: scriptAccount, wait: { timeout: 120 } })
}
