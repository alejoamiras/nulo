/**
 * The L1 mechanics shared by the plain-token deposit (`deposit-flow.ts`) and the Fuel deposit
 * (`useFuel.ts`): the one-time Permit2 approval, the router `bridge()` leg up to hash persistence,
 * and the best-effort L2 height snapshot. Deliberately small: no deployment constants — every caller
 * names the token, portal and router it means, so a wrong-token approval cannot happen by default.
 */
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import {
	type BridgeWitness,
	SWAP_BRIDGE_ROUTER_ABI,
	awaitL1Receipt,
	bridgeWitnessPermitTypedData,
	ensurePermit2Allowance,
	PERMIT_DEADLINE_SECONDS,
} from "@nulo/bridge-core"
import { NETWORK } from "@/lib/network"
import { ERC20_ABI } from "./useL1Usdc"
import { markApproveOutcome, runOnLane, setRecordStep, updateRecord } from "./useBridgeJournal"

/** The viem surface the leg needs — `DepositL1Ctx` and the Fuel flow's ad-hoc `{ publicClient, wallet, from }` both satisfy it. */
export interface RouterL1Ctx {
	publicClient: { readContract: (args: unknown) => Promise<unknown> }
	wallet: {
		signTypedData: (args: unknown) => Promise<unknown>
		writeContract: (args: unknown) => Promise<unknown>
	}
	from: string
}

const NODE_URL = NETWORK.nodeUrl

/** L2 height snapshot, best-effort: a dead node just means the gate narrates without the countdown. */
export async function bestEffortL2Block(): Promise<number | undefined> {
	try {
		return Number(await createAztecNodeClient(NODE_URL).getBlockNumber())
	} catch {
		return undefined
	}
}

/** Real USDC (and the DP7 permissionless-mint test token) start at ZERO Permit2 allowance, so a
 *  deposit must do a one-time approve(Permit2, max) before the witness transfer. The testnet
 *  MintableERC20 auto-grants Permit2 → this short-circuits (no tx) for it; the DP7 token + real
 *  USDC are what exercise the approve (codex F2/F4). The canonical fee asset does NOT pre-approve
 *  Permit2 either, so the Fuel flow's FIRST deposit needs it too. The shared approval state
 *  machine (bridge-core) — the same sequencing the candidate smokes rehearse. The approval hash is
 *  JOURNALED the moment it exists, so a rejection after the approval mines still shows the
 *  standing max allowance instead of "nothing was sent". */
export async function ensurePermit2Approval(p: {
	permit2: `0x${string}`
	/** The ERC-20 being bridged — REQUIRED (no default): a caller must name the token it approves. */
	token: `0x${string}`
	needed: bigint
	recordId: string
	l1: RouterL1Ctx
}): Promise<void> {
	const { permit2, token, needed, recordId, l1 } = p
	await ensurePermit2Allowance({
		allowance: async () =>
			(await l1.publicClient.readContract({
				address: token,
				abi: ERC20_ABI,
				functionName: "allowance",
				args: [l1.from, permit2],
			})) as bigint,
		approveMax: async () =>
			(await runOnLane("l1", () =>
				l1.wallet.writeContract({
					address: token,
					abi: ERC20_ABI,
					functionName: "approve",
					args: [permit2, (1n << 256n) - 1n],
					chain: NETWORK.viemChain,
					account: l1.from,
				}),
			)) as `0x${string}`,
		waitReceipt: async (hash) =>
			await awaitL1Receipt(l1.publicClient as never, hash, {
				onStillWaiting: (attempt) => setRecordStep(recordId, "approving", `still waiting for the approval (round ${attempt})`),
			}),
		needed,
		onStatus: (status, txHash) => {
			if (status === "approving") setRecordStep(recordId, "approving", "first time only: approve Permit2 in your Ethereum wallet")
			if (status === "waiting" && txHash) updateRecord(recordId, { approveTxHash: txHash })
			if (status === "approved") markApproveOutcome(recordId, "done")
		},
	})
}

/** The router `bridge()` leg up to HASH PERSISTENCE: signing prompt → nonce/deadline → witness →
 *  Permit2 typed data → one signature → `beforeConfirm` → confirmation prompt → `bridge()` write →
 *  `updateRecord({ depositTxHash })`. The receipt wait and the event parse stay with each caller:
 *  their post-receipt tails differ. */
export async function signAndSendRouterBridge(
	l1: RouterL1Ctx,
	p: {
		id: string
		router: `0x${string}`
		permit2: `0x${string}`
		swapTarget: `0x${string}`
		tokenPortal: `0x${string}`
		bridgeToken: `0x${string}`
		amount: bigint
		aztecRecipient: `0x${string}`
		secretHash: `0x${string}`
		isPrivate: boolean
		prompts: { sign: string; confirm: string }
		/** Runs after the signature lands, immediately before the confirmation step narrates. */
		beforeConfirm?: () => void
	},
): Promise<{ depositTxHash: `0x${string}` }> {
	setRecordStep(p.id, "signing", p.prompts.sign)
	const nonce = BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)
	const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_DEADLINE_SECONDS
	const witness: BridgeWitness = {
		tokenPortal: p.tokenPortal,
		bridgeToken: p.bridgeToken,
		totalAmount: p.amount,
		fuelAmount: 0n,
		aztecRecipient: p.aztecRecipient,
		fuelRecipient: `0x${"0".repeat(64)}`,
		tokenSecretHash: p.secretHash,
		fuelSecretHash: `0x${"0".repeat(64)}`,
		minFuelOutput: 0n,
		routeHash: `0x${"0".repeat(64)}`,
		isPrivate: p.isPrivate,
		swapTarget: p.swapTarget,
	}
	const typed = bridgeWitnessPermitTypedData(
		{ permitted: { token: p.bridgeToken, amount: p.amount }, spender: p.router, nonce, deadline },
		witness,
		p.permit2,
		NETWORK.l1ChainId,
	)
	const signature = await runOnLane("l1", () => l1.wallet.signTypedData({ account: l1.from, ...typed } as never))

	p.beforeConfirm?.()
	setRecordStep(p.id, "depositing", p.prompts.confirm)
	const depositTxHash = await runOnLane("l1", () =>
		l1.wallet.writeContract({
			address: p.router,
			abi: SWAP_BRIDGE_ROUTER_ABI,
			functionName: "bridge",
			args: [
				{
					tokenPortal: p.tokenPortal,
					bridgeToken: p.bridgeToken,
					amount: p.amount,
					aztecRecipient: p.aztecRecipient,
					secretHash: p.secretHash,
					isPrivate: p.isPrivate,
				},
				{ nonce, deadline, signature },
			],
			chain: NETWORK.viemChain,
			account: l1.from,
		} as never),
	)
	// Persisted the moment the hash exists - leafIndex stays chain-recoverable from here on.
	updateRecord(p.id, { depositTxHash: depositTxHash as string })
	return { depositTxHash: depositTxHash as `0x${string}` }
}
