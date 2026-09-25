import { onScopeDispose, ref, watch, type Ref } from "vue"
import type { EventHandler } from "@nulo/wallet-core/utils"
import type { ConfigProp } from "@/wallet/config"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import { ADDED_COALESCE, coalesce } from "@/utils/coalesce"

/**
 * Shared incoming-transfer feed wiring for the activity page + the home
 * Recent-Activity widget. The parent owns the service clients and their
 * connect/disconnect lifecycle (so the page's `request()`-driven auto-connect
 * timing is unchanged); this only wires the listeners, the update and delete
 * merges and the coalesced refresh on Added, the `incomingTransfersVisible`
 * toggle reload, and the D8 dust re-filter. An Added is never merged as sent:
 * only a read applies the dust filter. `dispose()` removes every handler (also
 * auto-invoked via `onScopeDispose`).
 */

export type IncomingScope = { profileId: string; networkId: string; account: string }

/** Minimal slice of `IncomingTransferServiceClient` this composable touches. */
export interface IncomingTransferServiceLike {
	getIncomingTransfers(profileId: string, networkId: string, account: string): Promise<IncomingTransferRecord[]>
	onIncomingTransferAdded: EventHandler<IncomingTransferRecord>
	onIncomingTransferUpdated: EventHandler<IncomingTransferRecord>
	onIncomingTransferDeleted: EventHandler<IncomingTransferRecord>
	onConnected: EventHandler<void>
}

/** Minimal slice of `ConfigServiceClient` this composable touches. */
export interface ConfigServiceLike {
	onUpdate: EventHandler<ConfigProp>
}

/** Minimal slice of `PriceServiceClient` — the dust filter re-evaluates when quotes refresh (D8). */
export interface PriceServiceLike {
	onQuotesUpdated: EventHandler<unknown>
}

export interface UseIncomingTransfersOptions {
	incomingTransferService: IncomingTransferServiceLike
	configService: ConfigServiceLike
	/** Optional — when supplied, an `onQuotesUpdated` re-runs the read-time dust filter (D8). */
	priceService?: PriceServiceLike
	/** Resolves the fetch scope; returns `undefined` when the active
	 *  profile/network/account isn't ready yet (mirrors the original guard,
	 *  which silently skipped the load). */
	scope: () => IncomingScope | undefined
	/** Awaited after each read and before its rows are assigned, under the same guards; its failure
	 *  still assigns them. Lists that play arrivals pass the coordinator's `load`, so a row is first
	 *  painted under the state that judges it. */
	afterRead?: (scope: IncomingScope) => Promise<void>
}

export interface UseIncomingTransfersResult {
	/** Visible (trusted) incoming-transfer records; the service layer already
	 *  filters + sorts, so consumers attach them as feed rows directly. */
	incomingTransfers: Ref<IncomingTransferRecord[]>
	/** Re-fetch for the current scope. Returns `[]` (clearing atomically) when
	 *  the visibility toggle is off. No-op when scope isn't ready. */
	refresh: () => Promise<void>
	dispose: () => void
}

export function useIncomingTransfers(options: UseIncomingTransfersOptions): UseIncomingTransfersResult {
	const { incomingTransferService, configService, priceService, scope, afterRead } = options

	const incomingTransfers = ref<IncomingTransferRecord[]>([])
	let disposed = false

	// Stable identity of the active scope ("" when not ready). Drives both the
	// reset-on-switch watcher and the stale-fetch / foreign-event rejection.
	const scopeKey = (s: IncomingScope | undefined): string => (s ? `${s.profileId} ${s.networkId} ${s.account}` : "")

	// Bumped per refresh so a late fetch for a superseded scope (A→B→A) is
	// dropped instead of clobbering the current one.
	let refreshSeq = 0
	// Dropped if disposed, a newer refresh started, or the active scope changed
	// during an await — never assign a stale/foreign snapshot.
	const isStale = (seq: number, key: string) => disposed || seq !== refreshSeq || scopeKey(scope()) !== key
	// Ids deleted while each read is in flight: its rows can predate the delete, taken by the
	// service before it or held across `afterRead`, and assigning them would bring the row back.
	const deletedDuringRead = new Set<Set<string>>()

	const readRows = async (s: IncomingScope, seq: number, key: string, deleted: Set<string>): Promise<void> => {
		const rows = await incomingTransferService.getIncomingTransfers(s.profileId, s.networkId, s.account)
		if (isStale(seq, key)) return
		if (afterRead) {
			try {
				await afterRead(s)
			} catch {
				// The rows are the feed; a judge that failed must not hide them.
			}
			if (isStale(seq, key)) return
		}
		incomingTransfers.value = deleted.size ? rows.filter((x) => !deleted.has(x.id)) : rows
	}

	const refresh = async (): Promise<void> => {
		const s = scope()
		if (!s) return
		const deleted = new Set<string>()
		deletedDuringRead.add(deleted)
		try {
			await readRows(s, ++refreshSeq, scopeKey(s), deleted)
		} finally {
			deletedDuringRead.delete(deleted)
		}
	}
	const addedRefresh = coalesce(() => void refresh(), ADDED_COALESCE)

	// Layer-A containment: a record is accepted into the active view ONLY when it
	// belongs to the CURRENTLY active (profile, network, account). The service
	// broadcasts every account's events to every client, so the active account is
	// enforced HERE — never trusted from the wire, never inferred.
	const inLiveScope = (inc: IncomingTransferRecord): boolean => {
		const s = scope()
		return !!s && inc.profileId === s.profileId && inc.networkId === s.networkId && inc.accountAddress === s.account
	}

	const onAdded = (inc: IncomingTransferRecord) => {
		if (inLiveScope(inc)) addedRefresh.trigger()
	}
	const onUpdated = (inc: IncomingTransferRecord) => {
		if (!inLiveScope(inc)) return
		const idx = incomingTransfers.value.findIndex((x) => x.id === inc.id)
		if (idx !== -1) incomingTransfers.value[idx] = inc
	}
	const onDeleted = (inc: IncomingTransferRecord) => {
		// Unscoped by design: a delete is strictly subtractive (filter by the
		// profile+network-scoped PK). A foreign-scope delete can't remove an
		// active-scope row (the id won't be present), and applying it unconditionally
		// avoids dropping a legitimate active-scope delete during a momentary
		// scope-read gap.
		incomingTransfers.value = incomingTransfers.value.filter((x) => x.id !== inc.id)
		for (const deleted of deletedDuringRead) deleted.add(inc.id)
	}
	const onConfigUpdate = (prop: ConfigProp) => {
		// Both the visibility toggle and the dust threshold change the read-time filtered list (D8).
		if (prop.key === "incomingTransfersVisible" || prop.key === "incomingDustUsdThreshold") refresh()
	}
	// A fresh quote can move a receipt across the dust threshold — re-run the read-time filter (D8).
	const onQuotesUpdated = () => refresh()

	// Synchronous reset on scope change (account/network/profile switch). `flush:
	// 'sync'` so B's view clears BEFORE Vue paints the new account — a default
	// (post-nextTick) watcher leaves a one-tick window rendering A's rows under B.
	const stopScopeWatch = watch(
		() => scopeKey(scope()),
		(key) => {
			incomingTransfers.value = []
			if (key) refresh()
		},
		{ flush: "sync" },
	)

	incomingTransferService.onIncomingTransferAdded.add(onAdded)
	incomingTransferService.onIncomingTransferUpdated.add(onUpdated)
	incomingTransferService.onIncomingTransferDeleted.add(onDeleted)
	incomingTransferService.onConnected.add(refresh)
	configService.onUpdate.add(onConfigUpdate)
	priceService?.onQuotesUpdated.add(onQuotesUpdated)

	const dispose = () => {
		if (disposed) return
		disposed = true
		addedRefresh.cancel()
		stopScopeWatch()
		incomingTransferService.onIncomingTransferAdded.remove(onAdded)
		incomingTransferService.onIncomingTransferUpdated.remove(onUpdated)
		incomingTransferService.onIncomingTransferDeleted.remove(onDeleted)
		incomingTransferService.onConnected.remove(refresh)
		configService.onUpdate.remove(onConfigUpdate)
		priceService?.onQuotesUpdated.remove(onQuotesUpdated)
	}
	onScopeDispose(dispose)

	return { incomingTransfers, refresh, dispose }
}
