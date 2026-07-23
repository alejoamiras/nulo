import { onScopeDispose, ref, watch, type Ref } from "vue"
import type { EventHandler } from "@nulo/wallet-core/utils"
import type { ConfigProp } from "@/wallet/config"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"

/**
 * Shared incoming-transfer feed wiring for the activity page + the home
 * Recent-Activity widget, which previously duplicated this verbatim. The
 * parent owns the service clients and their connect/disconnect lifecycle (so
 * the page's `request()`-driven auto-connect timing is unchanged); this only
 * wires the listeners, the optimistic add/update/delete merges, and the
 * `incomingTransfersVisible` toggle reload. `dispose()` removes every handler
 * (also auto-invoked via `onScopeDispose`).
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
	// Monotonic in-flight token: the service scans ALL accounts in the profile, so quotes/config/scope
	// changes can overlap `refresh()` calls; only the newest may write the ref (else an older account's
	// slower fetch clobbers a newer one — code-review #6).
	let requestId = 0

	const refresh = async (): Promise<void> => {
		const s = scope()
		if (!s) return
		const token = ++requestId
		const rows = await incomingTransferService.getIncomingTransfers(s.profileId, s.networkId, s.account)
		if (token !== requestId || disposed) return // a newer refresh (or dispose) superseded this one
		incomingTransfers.value = rows
	}

	// The service emits add/update for ANY account it scanned in the profile (one stream serves all
	// accounts), so live events MUST be filtered to the on-screen scope — else another account's receipt
	// (its amount + sender) leaks into the active account's feed (code-review #1).
	const inScope = (inc: IncomingTransferRecord): boolean => {
		const s = scope()
		return !!s && inc.profileId === s.profileId && inc.networkId === s.networkId && inc.accountAddress === s.account
	}
	const onAdded = (inc: IncomingTransferRecord) => {
		if (!inScope(inc)) return
		const idx = incomingTransfers.value.findIndex((x) => x.id === inc.id)
		if (idx === -1) incomingTransfers.value = [inc, ...incomingTransfers.value]
		else incomingTransfers.value[idx] = inc
	}
	const onUpdated = (inc: IncomingTransferRecord) => {
		if (!inScope(inc)) return
		const idx = incomingTransfers.value.findIndex((x) => x.id === inc.id)
		if (idx !== -1) incomingTransfers.value[idx] = inc
	}
	const onDeleted = (inc: IncomingTransferRecord) => {
		// Delete is keyed by id (unique across accounts) — safe to apply unconditionally; a foreign
		// record simply isn't in the list.
		incomingTransfers.value = incomingTransfers.value.filter((x) => x.id !== inc.id)
	}
	const onConfigUpdate = (prop: ConfigProp) => {
		// Both the visibility toggle and the dust threshold change the read-time filtered list (D8).
		if (prop.key === "incomingTransfersVisible" || prop.key === "incomingDustUsdThreshold") refresh()
	}
	// A fresh quote can move a receipt across the dust threshold — re-run the read-time filter.
	const onQuotesUpdated = () => refresh()

	incomingTransferService.onIncomingTransferAdded.add(onAdded)
	incomingTransferService.onIncomingTransferUpdated.add(onUpdated)
	incomingTransferService.onIncomingTransferDeleted.add(onDeleted)
	incomingTransferService.onConnected.add(refresh)
	configService.onUpdate.add(onConfigUpdate)
	priceService?.onQuotesUpdated.add(onQuotesUpdated)

	// Re-fetch when the active account/network/profile changes (an account switch is a pure store
	// mutation — no remount, no reconnect — so nothing else triggers a reload; the feed would otherwise
	// keep showing the previous account's receipts — code-review #2).
	const scopeKey = () => {
		const s = scope()
		return s ? `${s.profileId}|${s.networkId}|${s.account}` : undefined
	}
	const stopScopeWatch = watch(scopeKey, () => {
		void refresh()
	})

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
