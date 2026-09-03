/**
 * The slice of a `token+gas` deposit that goes to Fee Juice, and the output floor that slice is
 * signed against. Pure integer math over the generation's swap parameters — no chain reads, so a
 * slider can call it on every frame.
 */
import { type GasShareResult, proposeGasShare, signedMinFuelOutput, type TokenState } from "@nulo/bridge-core"
import { ref, type Ref } from "vue"
import { SWAP } from "@/contracts/bridge-generation"

/** Enough for a first session on L2 without over-diverting the deposit. */
const DEFAULT_TX_TARGET = 20

export interface GasShareProposal {
	/** The user's total, in the token's base units. */
	amount: bigint
	decimals: number
	state: TokenState
	/** A dust probe: `probeOut` Fee Juice came out for `probeIn` token in. */
	rate: { probeIn: bigint; probeOut: bigint }
}

export interface UseGasShareHandle {
	readonly txTarget: Ref<number>
	propose: (input: GasShareProposal) => GasShareResult | null
	floorFor: (quote: bigint) => bigint
	dispose: () => void
}

/** `null` from `propose` (and a throw from `floorFor`) means this network has no swap venue. */
export function useGasShare(): UseGasShareHandle {
	const txTarget = ref(DEFAULT_TX_TARGET)

	function propose(input: GasShareProposal): GasShareResult | null {
		const swap = SWAP
		if (!swap) return null
		return proposeGasShare({
			amount: input.amount,
			decimals: input.decimals,
			txTarget: txTarget.value,
			fjPerTx: BigInt(swap.fjPerTx),
			// The first claim of an unregistered token also registers it, and that costs more than a transfer.
			fjRegister: input.state.kind === "registered" ? undefined : BigInt(swap.fjRegister),
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

	function dispose(): void {
		// A re-entered wizard proposes from the default, never from the last session's target.
		txTarget.value = DEFAULT_TX_TARGET
	}

	return { txTarget, propose, floorFor, dispose }
}
