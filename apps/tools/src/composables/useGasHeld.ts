/**
 * Whether the connected Aztec account already holds gas: a token-only claim has no bridged Fee
 * Juice to pay itself with, so it spends what the account holds — public Fee Juice, or the private
 * remainder at the PrivateFPC — and cannot land without either. Read ahead of the review so the
 * user is steered to a fueled send before signing anything on Ethereum.
 *
 * `null` means unknown: no Aztec account yet, or a read that failed. The claim's own gate reads
 * again and fails closed, so an unknown here blocks nothing.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { type Ref, ref, watch } from "vue"
import { readFeeJuiceOrNull, readPrivateFeeJuiceBalance, readPublicFeeJuiceBalance } from "./deposit-flow"

export interface GasHeldDeps {
	aztec: () => unknown
	account: () => string | undefined
}

export interface UseGasHeldHandle {
	readonly held: Ref<boolean | null>
	refresh: () => Promise<void>
	dispose: () => void
}

/** One readable non-zero balance is enough to pay; two readable zeros mean none; anything unread
 *  leaves the answer open rather than claiming an empty account. */
export function verdictOf(pub: bigint | null, priv: bigint | null): boolean | null {
	if ((pub ?? 0n) > 0n || (priv ?? 0n) > 0n) return true
	return pub === null || priv === null ? null : false
}

export function useGasHeld(deps: GasHeldDeps): UseGasHeldHandle {
	const held = ref<boolean | null>(null)
	let epoch = 0
	let disposed = false

	async function refresh(): Promise<void> {
		const mine = ++epoch
		const aztec = deps.aztec()
		const account = deps.account()
		if (!aztec || !account) {
			held.value = null
			return
		}
		const recipient = AztecAddress.fromStringUnsafe(account)
		const [pub, priv] = await Promise.all([
			readFeeJuiceOrNull("public FJ", () => readPublicFeeJuiceBalance(aztec, recipient)),
			readFeeJuiceOrNull("private FJ", () => readPrivateFeeJuiceBalance(aztec, recipient)),
		])
		if (disposed || mine !== epoch) return
		held.value = verdictOf(pub, priv)
	}

	const stop = watch(
		() => `${deps.aztec() ? "w" : ""}|${deps.account() ?? ""}`,
		() => void refresh(),
		{ immediate: true },
	)

	function dispose(): void {
		disposed = true
		epoch++
		stop()
	}

	return { held, refresh, dispose }
}
