import type { Ref } from "vue"
import { createRunFence } from "@/composables/runFence"
import { type LiveTokenScope, forChain, isActiveScopeRow } from "@/utils/token-order"
import type { TokenBalanceInfo, TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"

/** `loading` and `unavailable` both mean "not known yet": only `loaded` may say the list is empty. */
export type TokenBalanceSnapshotState = "loading" | "unavailable" | "loaded"

interface TokenBalanceSnapshotDeps<T> {
	/** Connected and disconnected by the parent; the snapshot only requests and listens. */
	client: Pick<TokenBalanceServiceClient, "getTokenBalances" | "onConnected">
	live: LiveTokenScope
	rows: Ref<T[]>
	state: Ref<TokenBalanceSnapshotState>
	/** Captured at run start; a run whose fence goes false lands nothing. For a parent whose scope
	 *  change awaits before refetching, so the run's own generation cannot fence the old scope yet. */
	scopeFence?: () => () => boolean
	/** Applied to each landed row, after the chain filter. */
	mapRow?: (row: TokenBalanceInfo) => T
}

/** A rejected snapshot is retried once on a timer; after that a reconnect or a scope change retries. */
const RETRY_MS = 2_000

/**
 * The active account's token-balance rows on the active chain, fetched latest-wins. A snapshot in
 * flight is older than any in-scope event that lands meanwhile: the event marks it dirty and the
 * run refetches instead of overwriting the event. A rejection never reads as an empty list, and a
 * refetch within a scope keeps the rows already shown; clearing them on a scope change is the
 * parent's. The parent calls `dispose()` before it disconnects the client.
 */
export function useTokenBalanceSnapshot<T = TokenBalanceInfo>({
	client,
	live,
	rows,
	state,
	scopeFence,
	mapRow,
}: TokenBalanceSnapshotDeps<T>) {
	const fence = createRunFence()
	let dirty = false
	let retryTimer: ReturnType<typeof setTimeout> | undefined
	// The first connect is the one the first request opened. A later one is a port drop: events
	// may have been missed and the request in flight was rejected, so resnapshot.
	let connectsSeen = 0

	const inActiveScope = (tb: TokenBalanceInfo) => isActiveScopeRow(live, tb)
	const markDirty = () => {
		dirty = true
	}

	function settleRejected(isTimedRetry: boolean) {
		if (state.value !== "loaded") state.value = "unavailable"
		if (!isTimedRetry) retryTimer = setTimeout(() => void fetchTokenBalances(true), RETRY_MS)
	}

	function land(fetched: TokenBalanceInfo[], chainId: number | undefined) {
		const landed = forChain(fetched, chainId)
		rows.value = mapRow ? landed.map(mapRow) : (landed as T[])
		state.value = "loaded"
	}

	async function fetchTokenBalances(isTimedRetry = false): Promise<void> {
		const inScope = scopeFence?.()
		const isCurrent = fence.begin()
		const superseded = () => (inScope && !inScope()) || !isCurrent()
		clearTimeout(retryTimer)
		dirty = false
		const address = live.account?.address
		const chainId = live.network?.chainId
		if (!address) {
			rows.value = []
			state.value = "loaded"
			return
		}
		let fetched: TokenBalanceInfo[]
		try {
			fetched = await client.getTokenBalances(undefined, address)
		} catch {
			if (!superseded()) settleRejected(isTimedRetry)
			return
		}
		if (superseded()) return
		if (dirty) return fetchTokenBalances()
		land(fetched, chainId)
	}

	function onBalanceUpdated(tb: TokenBalanceInfo) {
		if (inActiveScope(tb)) markDirty()
		const idx = rows.value.findIndex((row) => (row as { id: unknown }).id === tb.id)
		if (idx !== -1) rows.value[idx] = tb as T
	}

	function onReconnected() {
		connectsSeen++
		if (connectsSeen > 1) void fetchTokenBalances()
	}
	client.onConnected.add(onReconnected)

	function dispose() {
		fence.invalidate()
		clearTimeout(retryTimer)
		client.onConnected.remove(onReconnected)
	}

	return { fetchTokenBalances, markDirty, inActiveScope, onBalanceUpdated, dispose }
}
