/**
 * Full L1↔L2 bridge flow orchestrations — the logic the frontend drives and the
 * sandbox smoke proves, in one place. Each takes a connected L1 (viem) context +
 * an L2 bridge Contract + the deployed addresses, runs the cross-chain dance, and
 * reports stage transitions for the loading bar. Framework-agnostic (no Vue).
 *
 * The proven reference for these sequences is `scripts/deploy-sandbox.ts --smoke`.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import type { ContractBase } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { Fr } from "@aztec/aztec.js/fields"
import type { Abi, Account, Address, PublicClient, WalletClient } from "viem"
import type { SendOpts } from "./l2"

/** The connected L1 surface the flows need (a viem wallet + public client + account). */
export interface L1Ctx {
	pub: PublicClient
	wallet: WalletClient
	account: Account
}

export interface DepositParams {
	usdc: Address
	portal: Address
	usdcAbi: Abi
	portalAbi: Abi
	/** L2 recipient (AztecAddress hex). */
	recipient: string
	amount: bigint
}

/** Bridge-flow stages, surfaced to the UI for the loading bar + step labels. */
export type DepositFlowStage = "approving" | "depositing" | "syncing" | "claiming" | "done"

/**
 * L1→L2 public deposit: mint → approve → `depositToAztecPublic` → poll-and-
 * `claim_public` (retry until the L1→L2 message syncs into an L2 block). Returns
 * the message leaf index. Mirrors the proven deposit-public smoke.
 */
export async function depositPublic(
	l1: L1Ctx,
	bridge: ContractBase,
	p: DepositParams,
	sendOpts: SendOpts,
	onStage?: (s: DepositFlowStage) => void,
): Promise<bigint> {
	const secret = Fr.random()
	const secretHash = await computeSecretHash(secret)
	const write = (functionName: string, args: unknown[]) =>
		l1.wallet.writeContract({
			address: p.portal,
			abi: p.portalAbi,
			functionName,
			args,
			account: l1.account,
			chain: l1.wallet.chain,
		} as never)

	onStage?.("approving")
	await l1.pub.waitForTransactionReceipt({
		hash: await l1.wallet.writeContract({
			address: p.usdc,
			abi: p.usdcAbi,
			functionName: "mint",
			args: [l1.account.address, p.amount],
			account: l1.account,
			chain: l1.wallet.chain,
		} as never),
	})
	await l1.pub.waitForTransactionReceipt({
		hash: await l1.wallet.writeContract({
			address: p.usdc,
			abi: p.usdcAbi,
			functionName: "approve",
			args: [p.portal, p.amount],
			account: l1.account,
			chain: l1.wallet.chain,
		} as never),
	})

	onStage?.("depositing")
	const args = [p.recipient, p.amount, secretHash.toString()]
	const sim = await l1.pub.simulateContract({
		address: p.portal,
		abi: p.portalAbi,
		functionName: "depositToAztecPublic",
		args,
		account: l1.account,
	} as never)
	const leafIndex = BigInt((sim.result as [string, bigint])[1])
	await l1.pub.waitForTransactionReceipt({ hash: await write("depositToAztecPublic", args) })

	onStage?.("syncing")
	for (let i = 0; i < 40; i++) {
		try {
			await bridge.methods
				.claim_public(AztecAddress.fromString(p.recipient), p.amount, secret, new Fr(leafIndex))
				.send(sendOpts as never)
			onStage?.("done")
			return leafIndex
		} catch {
			onStage?.("claiming")
			await new Promise((r) => setTimeout(r, 3000))
		}
	}
	throw new Error("claim_public never succeeded (L1→L2 message not synced)")
}
