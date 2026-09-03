/**
 * The Ethereum balance behind every row of the token list, read in one batch for the connected
 * account and keyed by `logoKey`. A read that fails leaves the previous map standing rather than
 * blanking every row at once; a read that is superseded never lands.
 */
import { readErc20Balances } from "@nulo/bridge-core"
import type { Address, PublicClient } from "viem"
import { type Ref, shallowRef, watch } from "vue"
import type { SelectableToken } from "@/lib/send-model"

/** A remote list can run to hundreds of tokens; the batch stays bounded to what a screen shows,
 *  and the catalog puts the manifest's own tokens and anything the user added first. */
const MAX_ROWS = 50

export interface RowBalancesDeps {
	pub: () => PublicClient | undefined
	owner: () => Address | undefined
	tokens: () => readonly SelectableToken[]
}

export interface UseRowBalancesHandle {
	readonly balances: Ref<Record<string, bigint>>
	refresh: () => Promise<void>
	dispose: () => void
}

export function useRowBalances(deps: RowBalancesDeps): UseRowBalancesHandle {
	const balances = shallowRef<Record<string, bigint>>({})
	let epoch = 0
	let disposed = false

	async function refresh(): Promise<void> {
		const mine = ++epoch
		const pub = deps.pub()
		const owner = deps.owner()
		const rows = deps.tokens().slice(0, MAX_ROWS)
		if (!pub || !owner || rows.length === 0) {
			balances.value = {}
			return
		}
		try {
			const read = await readErc20Balances(
				pub,
				owner,
				rows.map((r) => r.address),
			)
			if (disposed || mine !== epoch) return
			const next: Record<string, bigint> = {}
			for (const row of rows) next[row.logoKey] = read.get(row.address) ?? 0n
			balances.value = next
		} catch (e) {
			console.debug(e instanceof Error ? e : new Error("row balances could not be read"))
		}
	}

	// Keyed on the identity of the inputs, not their objects: a list load replaces the array several
	// times while the rows it holds stay the same, and each replacement must not cost a batch read.
	const stop = watch(
		() =>
			`${deps.owner() ?? ""}|${deps
				.tokens()
				.slice(0, MAX_ROWS)
				.map((t) => t.logoKey)
				.join(",")}`,
		() => void refresh(),
		{ immediate: true },
	)

	function dispose(): void {
		disposed = true
		epoch++
		stop()
	}

	return { balances, refresh, dispose }
}
