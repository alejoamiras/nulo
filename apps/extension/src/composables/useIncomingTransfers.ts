import { onScopeDispose, ref, watch, type Ref } from "vue"
import type { EventHandler } from "@nulo/wallet-core/utils"
import type { ConfigProp } from "@/wallet/config"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"

/**
 * Shared incoming-transfer feed wiring for the activity page + the home
 * Recent-Activity widget, which previously duplicated this verbatim. The
 * parent owns the service clients and their connect/disconnect lifecycle (so
 * the page's `request()`-driven auto-connect timing is unchanged); this only
 * wires the listeners, the optimistic add/update/delete merges, the
 * `incomingTransfersVisible` toggle reload, and the D8 dust re-filter.
 * `dispose()` removes every handler (also auto-invoked via `onScopeDispose`).
 */

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
	scope: () => { profileId: string; networkId: string; account: string } | undefined
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
	const { incomingTransferService, configService, priceService, scope } = options

	const incomingTransfers = ref<IncomingTransferRecord[]>([])
	let disposed = false

	// Stable identity of the active scope ("" when not ready). Drives both the
	// reset-on-switch watcher and the stale-fetch / foreign-event rejection.
	const scopeKey = (s: { profileId: string; networkId: string; account: string } | undefined): string =>
		s ? `${s.profileId} ${s.networkId} ${s.account}` : ""

	// Bumped per refresh so a late fetch for a superseded scope (A→B→A) is
	// dropped instead of clobbering the current one.
	let refreshSeq = 0

	const refresh = async (): Promise<void> => {
		const s = scope()
		if (!s) return
		const myKey = scopeKey(s)
		const mySeq = ++refreshSeq
		const rows = await incomingTransferService.getIncomingTransfers(s.profileId, s.networkId, s.account)
		// Drop if disposed, a newer refresh started, or the active scope changed
		// during the await — never assign a stale/foreign snapshot.
		if (disposed || mySeq !== refreshSeq || scopeKey(scope()) !== myKey) return
		incomingTransfers.value = rows
	}

	// Layer-A containment: a record is accepted into the active view ONLY when it
	// belongs to the CURRENTLY active (profile, network, account). The service
	// broadcasts every account's events to every client, so the active account is
	// enforced HERE — never trusted from the wire, never inferred.
	const inLiveScope = (inc: IncomingTransferRecord): boolean => {
		const s = scope()
		return !!s && inc.profileId === s.profileId && inc.networkId === s.networkId && inc.accountAddress === s.account
	}

	const onAdded = (inc: IncomingTransferRecord) => {
		if (!inLiveScope(inc)) return
		const idx = incomingTransfers.value.findIndex((x) => x.id === inc.id)
		if (idx === -1) incomingTransfers.value = [inc, ...incomingTransfers.value]
		else incomingTransfers.value[idx] = inc
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
