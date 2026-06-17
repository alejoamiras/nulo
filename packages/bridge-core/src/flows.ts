/**
 * Full L1↔L2 bridge flow orchestrations — the logic the frontend drives and the
 * sandbox smoke proves, in one place. Each takes a connected L1 (viem) context +
 * an L2 bridge Contract + the deployed addresses, runs the cross-chain dance, and
 * reports stage transitions for the loading bar. Framework-agnostic (no Vue).
 *
 * The proven reference for these sequences is `scripts/deploy-sandbox.ts --smoke`.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { type ContractBase, waitForProven } from "@aztec/aztec.js/contracts"
import { computeSecretHash } from "@aztec/aztec.js/crypto"
import { Fr } from "@aztec/aztec.js/fields"
import type { createAztecNodeClient } from "@aztec/aztec.js/node"
import { computeL2ToL1MembershipWitness } from "@aztec/stdlib/messaging"
import { InboxAbi } from "@aztec/l1-artifacts"
import { type Abi, type Account, type Address, type Hex, parseEventLogs, type PublicClient, type WalletClient } from "viem"
import { type BridgeWitness, bridgeWitnessPermitTypedData, hashRoute, type PoolKey } from "./l1"
import type { SendOpts } from "./l2"
import { PRIVATE_FPC_ADDRESS } from "./private-fuel"

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
 * Persistence hooks so a crash/refresh between the (irreversible) deposit and the
 * claim can't strand funds: the secret is saved BEFORE broadcast, the leaf index
 * once the deposit lands, and the record cleared on a successful claim. The caller
 * (the app) owns the storage + encryption via `recovery.ts`/`recovery-crypto.ts`.
 *
 * SECURITY (F-007): a PRIVATE claim is BEARER — whoever holds `secretHex` can claim the deposit
 * to any recipient (the private content hash omits the recipient). Integrators MUST seal `secretHex`
 * at rest and MUST NEVER log it, place it in a URL, or persist it in plaintext; a leak makes the
 * deposit→claim window front-runnable. (Recipient-commitment, which would bind the recipient on-chain
 * and remove the bearer property, is backlog.)
 */
export interface RecoveryHooks {
	onSecret?: (r: { secretHex: string; secretHashHex: string; isPrivate: boolean }) => void
	onDeposited?: (leafIndex: bigint) => void
	onClaimed?: () => void
}

async function runDeposit(
	l1: L1Ctx,
	bridge: ContractBase,
	p: DepositParams,
	sendOpts: SendOpts,
	isPrivate: boolean,
	onStage?: (s: DepositFlowStage) => void,
	recovery?: RecoveryHooks,
): Promise<bigint> {
	const secret = Fr.random()
	const secretHash = await computeSecretHash(secret)
	// Persist the secret BEFORE any irreversible L1 tx — a lost preimage strands the deposit.
	recovery?.onSecret?.({ secretHex: secret.toString(), secretHashHex: secretHash.toString(), isPrivate })
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
	recovery?.onDeposited?.(leafIndex)

	onStage?.("syncing")
	// Generous: a fresh PXE re-syncing a long-lived sandbox (many blocks) can lag.
	for (let i = 0; i < 200; i++) {
		try {
			await claim(AztecAddress.fromString(p.recipient), p.amount, secret, new Fr(leafIndex)).send(sendOpts as never)
			recovery?.onClaimed?.()
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
	recovery?: RecoveryHooks,
): Promise<bigint> => runDeposit(l1, bridge, p, sendOpts, false, onStage, recovery)

/** L1→L2 private deposit: depositToAztecPrivate (no recipient in the content hash) → claim_private. */
export const depositPrivate = (
	l1: L1Ctx,
	bridge: ContractBase,
	p: DepositParams,
	sendOpts: SendOpts,
	onStage?: (s: DepositFlowStage) => void,
	recovery?: RecoveryHooks,
): Promise<bigint> => runDeposit(l1, bridge, p, sendOpts, true, onStage, recovery)

type AztecNodeClient = ReturnType<typeof createAztecNodeClient>

/** L2→L1 withdraw finalization stages, surfaced to the UI for the loading bar. */
export type WithdrawFlowStage = "proving" | "consuming" | "done"

/** What the L1 Outbox `withdraw` consume needs: the L1 recipient + amount + the canonical portal. */
export interface WithdrawConsumeParams {
	recipientL1: Address
	amount: bigint
	portal: Address
	portalAbi: Abi
	/** Seconds to wait for the burn's epoch to prove (aztec.js default 600 — raise for slow networks like the live testnet). */
	provenTimeoutSec?: number
}

/**
 * Finalize an L2→L1 withdraw once the `exit_to_l1` tx has landed on L2: wait for it to be
 * proven, build the L2→L1 membership witness, and consume it on the L1 Outbox via the portal's
 * `withdraw`. Identical for public + private exits — only the L2 burn authwit (done by the
 * caller before the exit) differs. The sandbox smoke runs exactly this tail for both flows.
 */
export async function consumeWithdrawal(
	l1: L1Ctx,
	node: AztecNodeClient,
	exitReceipt: { txHash: unknown },
	p: WithdrawConsumeParams,
	onStage?: (s: WithdrawFlowStage) => void,
): Promise<void> {
	onStage?.("proving")
	await waitForProven(node, exitReceipt as never, (p.provenTimeoutSec ? { provenTimeout: p.provenTimeoutSec } : undefined) as never)
	const eff = await node.getTxEffect(exitReceipt.txHash as never)
	if (!eff) throw new Error("no tx effect for exit")
	const messageHash = eff.data.l2ToL1Msgs[0]
	if (!messageHash) throw new Error("no L2→L1 message in exit tx")
	const wit = await computeL2ToL1MembershipWitness(node, messageHash, exitReceipt.txHash as never, 0)
	if (!wit) throw new Error("L2→L1 witness not available")
	const path = wit.siblingPath.toBufferArray().map((b: Buffer) => `0x${b.toString("hex")}` as `0x${string}`)
	onStage?.("consuming")
	const req = await l1.pub.simulateContract({
		address: p.portal,
		abi: p.portalAbi,
		functionName: "withdraw",
		args: [p.recipientL1, p.amount, false, BigInt(wit.epochNumber), wit.leafIndex, path] as never,
		account: l1.account,
	})
	await l1.pub.waitForTransactionReceipt({ hash: await l1.wallet.writeContract(req.request as never) })
	onStage?.("done")
}

/** One-tx swap+fuel bridge stages, surfaced to the UI for the loading bar. */
export type SwapFlowStage = "signing" | "swapping" | "syncing" | "done"

/** Inputs for the headline `bridgeWithFuel`: swap `fuelAmount` of `bridgeToken` → Fee Juice, bridge the rest. */
export interface SwapBridgeParams {
	router: Address
	routerAbi: Abi
	permit2: Address
	tokenPortal: Address
	bridgeToken: Address
	totalAmount: bigint
	fuelAmount: bigint
	aztecRecipient: Hex
	fuelRecipient: Hex
	minFuelOutput: bigint
	path: PoolKey[]
	zeroForOnes: boolean[]
	isPrivate: boolean
	/** The router's current swap target — witness-bound (F-004); a setSwapTarget voids this signature. */
	swapTarget: Address
	/** PRIVATE fuel only — the injected bridge secret `deriveBridgeSecret(salt, claimer)`. Omitted ⇒
	 *  `Fr.random()` (correct for recipient-bound PUBLIC fuel). A random secret on the private path
	 *  would strand the Fee Juice forever: the claimer must reconstruct it from `msg_sender` inside
	 *  `PrivateFPC.mint_and_pay_fee`. The caller derives it (it owns the salt + claimer + persistence). */
	fuelSecret?: Fr
	nonce: bigint
	deadline: bigint
	chainId: number
}

/** What the L2 side needs after the L1 swap+bridge lands: the two claim secrets + leaf indices. */
export interface SwapBridgeResult {
	tokenSecretHex: string
	fuelSecretHex: string
	tokenLeafIndex: bigint
	fuelLeafIndex: bigint
	fuelReceived: bigint
}

/**
 * Persist BOTH claim secrets BEFORE the irreversible bridgeWithFuel; record leaf indices once it lands.
 *
 * SECURITY (F-007): same bearer contract as {@link RecoveryHooks} — `tokenSecretHex`/`fuelSecretHex`
 * are bearer for the PRIVATE path. Seal at rest; NEVER log/URL/plaintext-persist them.
 */
export interface SwapRecoveryHooks {
	onSecrets?: (r: { tokenSecretHex: string; fuelSecretHex: string; aztecRecipient: Hex; isPrivate: boolean }) => void
	onBridged?: (r: { tokenLeafIndex: bigint; fuelLeafIndex: bigint }) => void
}

/**
 * The headline one-tx flow: sign a Permit2 witness-bound transfer, then call the router's
 * `bridgeWithFuel` — which pulls the token, swaps `fuelAmount` for Fee Juice, deposits the FJ to
 * L2, and bridges the remaining tokens, atomically. The witness binds every bridge field (the
 * hashing is cross-pinned to the Solidity router in l1.test.ts), so a relayer can't alter
 * recipients/amounts/route after signing. Returns the two claim secrets + the Inbox leaf indices
 * (read from the `BridgeWithFuel` event, not guessed from deposit order) the L2 side claims with.
 * viem-only; the L2 claims (token via claim_*, fuel via publicFeeJuicePayment) run separately.
 */
export async function runSwapBridge(
	l1: L1Ctx,
	p: SwapBridgeParams,
	onStage?: (s: SwapFlowStage) => void,
	recovery?: SwapRecoveryHooks,
): Promise<SwapBridgeResult> {
	// Fail closed on the private-fuel invariants BEFORE any secret generation or signing. Without
	// this, a missing fuelSecret silently falls back to Fr.random() below and strands the Fee Juice
	// (the PrivateFPC claimer reconstructs the secret from msg_sender — a random one is unrecoverable),
	// and a non-FPC fuelRecipient deposits the gas publicly to the wrong L2 address. The shipping
	// faucet always passes both; this guards every other caller of the exported helper.
	if (p.isPrivate) {
		if (!p.fuelSecret) {
			throw new Error(
				"runSwapBridge: private fuel requires an injected fuelSecret (deriveBridgeSecret(salt, claimer)) — a random secret strands the Fee Juice",
			)
		}
		if (p.fuelRecipient.toLowerCase() !== PRIVATE_FPC_ADDRESS.toLowerCase()) {
			throw new Error(
				`runSwapBridge: private fuel must target the PrivateFPC (${PRIVATE_FPC_ADDRESS}); got fuelRecipient=${p.fuelRecipient}`,
			)
		}
	}
	const tokenSecret = Fr.random()
	// PUBLIC fuel: recipient-bound, random is correct. PRIVATE fuel: the caller injects the derived
	// bridge secret so the FPC claimer can reconstruct it (a random one would strand the FJ — L3).
	const fuelSecret = p.fuelSecret ?? Fr.random()
	const tokenSecretHash = (await computeSecretHash(tokenSecret)).toString() as Hex
	const fuelSecretHash = (await computeSecretHash(fuelSecret)).toString() as Hex
	// Persist BOTH secrets before the irreversible swap+bridge — a lost preimage strands the claim.
	recovery?.onSecrets?.({
		tokenSecretHex: tokenSecret.toString(),
		fuelSecretHex: fuelSecret.toString(),
		aztecRecipient: p.aztecRecipient,
		isPrivate: p.isPrivate,
	})

	const witness: BridgeWitness = {
		tokenPortal: p.tokenPortal,
		bridgeToken: p.bridgeToken,
		totalAmount: p.totalAmount,
		fuelAmount: p.fuelAmount,
		aztecRecipient: p.aztecRecipient,
		fuelRecipient: p.fuelRecipient,
		tokenSecretHash,
		fuelSecretHash,
		minFuelOutput: p.minFuelOutput,
		routeHash: hashRoute(p.path, p.zeroForOnes),
		isPrivate: p.isPrivate,
		swapTarget: p.swapTarget,
	}
	const typedData = bridgeWitnessPermitTypedData(
		{ permitted: { token: p.bridgeToken, amount: p.totalAmount }, spender: p.router, nonce: p.nonce, deadline: p.deadline },
		witness,
		p.permit2,
		p.chainId,
	)

	onStage?.("signing")
	const signature = await l1.wallet.signTypedData({ account: l1.account, ...typedData } as never)

	onStage?.("swapping")
	const bridgeParams = {
		tokenPortal: p.tokenPortal,
		bridgeToken: p.bridgeToken,
		totalAmount: p.totalAmount,
		fuelAmount: p.fuelAmount,
		aztecRecipient: p.aztecRecipient,
		fuelRecipient: p.fuelRecipient,
		tokenSecretHash,
		fuelSecretHash,
		minFuelOutput: p.minFuelOutput,
		path: p.path,
		zeroForOnes: p.zeroForOnes,
		isPrivate: p.isPrivate,
	}
	const receipt = await l1.pub.waitForTransactionReceipt({
		hash: await l1.wallet.writeContract({
			address: p.router,
			abi: p.routerAbi,
			functionName: "bridgeWithFuel",
			args: [bridgeParams, { nonce: p.nonce, deadline: p.deadline, signature }],
			account: l1.account,
			chain: l1.wallet.chain,
		} as never),
	})

	onStage?.("syncing")
	const events = parseEventLogs({ abi: p.routerAbi, eventName: "BridgeWithFuel", logs: receipt.logs })
	const ev = events[0] as { args?: { tokenIndex?: bigint; fuelIndex?: bigint; fuelAmount?: bigint } } | undefined
	if (ev?.args?.tokenIndex === undefined || ev.args.fuelIndex === undefined) {
		throw new Error("bridgeWithFuel emitted no BridgeWithFuel event")
	}
	recovery?.onBridged?.({ tokenLeafIndex: ev.args.tokenIndex, fuelLeafIndex: ev.args.fuelIndex })
	onStage?.("done")
	return {
		tokenSecretHex: tokenSecret.toString(),
		fuelSecretHex: fuelSecret.toString(),
		tokenLeafIndex: ev.args.tokenIndex,
		fuelLeafIndex: ev.args.fuelIndex,
		fuelReceived: ev.args.fuelAmount ?? 0n,
	}
}
