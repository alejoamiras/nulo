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
import { InboxAbi } from "@aztec/l1-artifacts"
import { type Abi, type Account, type Address, parseEventLogs, type PublicClient, type WalletClient } from "viem"
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
async function runDeposit(
	l1: L1Ctx,
	bridge: ContractBase,
	p: DepositParams,
	sendOpts: SendOpts,
	isPrivate: boolean,
	onStage?: (s: DepositFlowStage) => void,
): Promise<bigint> {
	const secret = Fr.random()
	const secretHash = await computeSecretHash(secret)
	// Private deposits hash mint_to_private(amount) — no recipient in the deposit args.
	const depositFn = isPrivate ? "depositToAztecPrivate" : "depositToAztecPublic"
	const depositArgs = isPrivate ? [p.amount, secretHash.toString()] : [p.recipient, p.amount, secretHash.toString()]
	const claimFn = isPrivate ? "claim_private" : "claim_public"
	const claim = (bridge.methods as Record<string, (...a: unknown[]) => { send: (o: unknown) => Promise<unknown> }>)[claimFn]

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
	const depositReceipt = await l1.pub.waitForTransactionReceipt({
		hash: await l1.wallet.writeContract({
			address: p.portal,
			abi: p.portalAbi,
			functionName: depositFn,
			args: depositArgs,
			account: l1.account,
			chain: l1.wallet.chain,
		} as never),
	})
	// The actual leaf index comes from the mined Inbox `MessageSent` event — never a
	// preflight simulate, which races with any concurrent deposit and yields an index
	// the L2 message won't match (claim then retries forever against the wrong leaf).
	const sent = parseEventLogs({ abi: InboxAbi, eventName: "MessageSent", logs: depositReceipt.logs })
	const event = sent[0] as { args?: { index?: bigint } } | undefined
	if (event?.args?.index === undefined) throw new Error("deposit tx emitted no Inbox MessageSent event")
	const leafIndex = event.args.index

	onStage?.("syncing")
	// Generous: a fresh PXE re-syncing a long-lived sandbox (many blocks) can lag.
	for (let i = 0; i < 80; i++) {
		try {
			await claim(AztecAddress.fromString(p.recipient), p.amount, secret, new Fr(leafIndex)).send(sendOpts as never)
			onStage?.("done")
			return leafIndex
		} catch {
			onStage?.("claiming")
			await new Promise((r) => setTimeout(r, 3000))
		}
	}
	throw new Error(`${claimFn} never succeeded (L1→L2 message not synced)`)
}

/** L1→L2 public deposit: mint → approve → depositToAztecPublic → poll-and-claim_public. */
export const depositPublic = (
	l1: L1Ctx,
	bridge: ContractBase,
	p: DepositParams,
	sendOpts: SendOpts,
	onStage?: (s: DepositFlowStage) => void,
): Promise<bigint> => runDeposit(l1, bridge, p, sendOpts, false, onStage)

/** L1→L2 private deposit: depositToAztecPrivate (no recipient in the content hash) → claim_private. */
export const depositPrivate = (
	l1: L1Ctx,
	bridge: ContractBase,
	p: DepositParams,
	sendOpts: SendOpts,
	onStage?: (s: DepositFlowStage) => void,
): Promise<bigint> => runDeposit(l1, bridge, p, sendOpts, true, onStage)
