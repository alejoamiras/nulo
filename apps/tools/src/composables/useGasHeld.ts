/**
 * The private Fee Juice the connected Aztec account holds at the PrivateFPC: a token-only claim has
 * no bridged Fee Juice to pay itself with, so it spends this — and only this. The account's public
 * Fee Juice cannot be named as a dApp transaction's payer through the wallet (a payer with no claim
 * call is routed as a claim-in-setup that never ends setup), and a claim sent without a payer is
 * left to the wallet's picker, whose default is the sponsored FPC no bridge path may lean on. Read
 * ahead of the review so the user is steered to a fueled send before signing anything on Ethereum.
 *
 * `null` means unknown: no Aztec account yet, or a read that failed. The amount step blocks nothing
 * on an unknown; the confirm requires a known balance, and the claim's own gate reads again.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { type Ref, ref, watch } from "vue"
import { readFeeJuiceOrNull, readPrivateFeeJuiceBalance } from "./deposit-flow"

export interface GasHeldDeps {
	aztec: () => unknown
	account: () => string | undefined
}

export interface UseGasHeldHandle {
	readonly credit: Ref<bigint | null>
	refresh: () => Promise<void>
	dispose: () => void
}

export function useGasHeld(deps: GasHeldDeps): UseGasHeldHandle {
	const credit = ref<bigint | null>(null)
	let epoch = 0
	let disposed = false

	async function refresh(): Promise<void> {
		const mine = ++epoch
		const aztec = deps.aztec()
		const account = deps.account()
		if (!aztec || !account) {
			credit.value = null
			return
		}
		const recipient = AztecAddress.fromStringUnsafe(account)
		const read = await readFeeJuiceOrNull("private FJ", () => readPrivateFeeJuiceBalance(aztec, recipient))
		if (disposed || mine !== epoch) return
		credit.value = read
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

	return { credit, refresh, dispose }
}
