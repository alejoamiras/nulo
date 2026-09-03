/**
 * The slice of a `token+gas` deposit that goes to Fee Juice, and the output floor that slice is
 * signed against. Pure integer math over the generation's swap parameters — no chain reads, so a
 * slider can call it on every frame. The one exception is a PRIVATE send: its claim is paid
 * through the PrivateFPC, which keeps each transaction's committed fee ceiling rather than its
 * charge, so the slice is sized from the network's predicted fees, priced once and refreshed in
 * the background.
 */
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import {
	type GasShareResult,
	PRIVATE_HUB_CLAIM_GAS,
	PRIVATE_HUB_REGISTER_GAS,
	predictedWorstMinFees,
	privateFpcFeeLimit,
	proposeGasShare,
	signedMinFuelOutput,
	type TokenState,
} from "@nulo/bridge-core"
import { ref, type Ref } from "vue"
import { SWAP } from "@/contracts/bridge-generation"
import { NETWORK } from "@/lib/network"

/** Enough for a first session on L2 without over-diverting the deposit. */
const DEFAULT_TX_TARGET = 20

/** Fees move every block; a quote priced longer ago than this is re-priced behind the next proposal. */
const FEES_FRESH_MS = 60_000

export interface GasShareProposal {
	/** The user's total, in the token's base units. */
	amount: bigint
	decimals: number
	state: TokenState
	/** A dust probe: `probeOut` Fee Juice came out for `probeIn` token in. */
	rate: { probeIn: bigint; probeOut: bigint }
	/** A private send's claim forfeits fee ceilings, sized from live fees instead of the calibration. */
	isPrivate?: boolean
}

/** `null` = this network has no swap venue; "pricing" = a private slice awaits the network's fees. */
export type GasShareOutcome = GasShareResult | null | "pricing"

export interface UseGasShareHandle {
	readonly txTarget: Ref<number>
	propose: (input: GasShareProposal) => GasShareOutcome
	floorFor: (quote: bigint) => bigint
	/** The Fee Juice a private claim commits to fee ceilings — the claim's, plus a registration's for
	 *  a token the hub does not know yet — at the last priced fees; null until priced. */
	ceilingsFor: (state: TokenState) => bigint | null
	/** Price the ceilings from the network's predicted fees. Concurrent calls share one read. */
	prime: () => Promise<void>
	/** Back to the default target: a new send is sized from it, never from the last one's. */
	reset: () => void
	dispose: () => void
}

type MaxFees = { feePerDaGas: bigint; feePerL2Gas: bigint }

/** `null` from `propose` (and a throw from `floorFor`) means this network has no swap venue. */
export function useGasShare(): UseGasShareHandle {
	const txTarget = ref(DEFAULT_TX_TARGET)
	const fees = ref<{ maxFees: MaxFees; at: number } | null>(null)
	let pricing: Promise<void> | null = null

	function prime(): Promise<void> {
		if (pricing) return pricing
		pricing = predictedWorstMinFees(createAztecNodeClient(NETWORK.nodeUrl))
			.then((predicted) => {
				fees.value = { maxFees: { feePerDaGas: predicted.feePerDaGas, feePerL2Gas: predicted.feePerL2Gas }, at: Date.now() }
			})
			.catch((e: unknown) => {
				// Unpriced is a visible state (the slice reads "pricing"), never a silently wrong slice.
				console.warn("[gas-share] fee pricing unavailable:", e)
			})
			.finally(() => {
				pricing = null
			})
		return pricing
	}

	function ceilingsFor(state: TokenState): bigint | null {
		const priced = fees.value
		if (!priced) return null
		const claim = privateFpcFeeLimit(PRIVATE_HUB_CLAIM_GAS, priced.maxFees)
		return state.kind === "registered" ? claim : claim + privateFpcFeeLimit(PRIVATE_HUB_REGISTER_GAS, priced.maxFees)
	}

	/** A private slice's ceilings, or "pricing" while the fees are still on their way. */
	function privateCeilings(state: TokenState): bigint | "pricing" {
		if (!fees.value || Date.now() - fees.value.at > FEES_FRESH_MS) void prime()
		return ceilingsFor(state) ?? "pricing"
	}

	function propose(input: GasShareProposal): GasShareOutcome {
		const swap = SWAP
		if (!swap) return null
		const ceilings = input.isPrivate ? privateCeilings(input.state) : undefined
		if (ceilings === "pricing") return "pricing"
		return proposeGasShare({
			amount: input.amount,
			decimals: input.decimals,
			txTarget: txTarget.value,
			fjPerTx: BigInt(swap.fjPerTx),
			// The first claim of an unregistered token also registers it, and that costs more than a transfer.
			fjRegister: input.state.kind === "registered" ? undefined : BigInt(swap.fjRegister),
			fjCeilings: ceilings,
			minFuelFj: BigInt(swap.minFuelFj),
			rate: input.rate,
			slippageBps: swap.slippageBps,
		})
	}

	function floorFor(quote: bigint): bigint {
		const swap = SWAP
		// Refusing beats returning a zero floor: a floor of zero lets the swap land Fee Juice too
		// small to claim, stranding it on L1.
		if (!swap) throw new Error("This network has no swap venue, so a deposit cannot buy gas.")
		return signedMinFuelOutput(quote, swap.slippageBps, BigInt(swap.minFuelFj))
	}

	function reset(): void {
		txTarget.value = DEFAULT_TX_TARGET
	}

	// A re-entered wizard proposes from the default, never from the last session's target.
	const dispose = reset

	return { txTarget, propose, floorFor, ceilingsFor, prime, reset, dispose }
}
