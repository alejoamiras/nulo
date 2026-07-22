import { onScopeDispose, ref, type Ref } from "vue"
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

export interface UseIncomingTransfersOptions {
	incomingTransferService: IncomingTransferServiceLike
	configService: ConfigServiceLike
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
	const { incomingTransferService, configService, scope } = options

	const incomingTransfers = ref<IncomingTransferRecord[]>([])
	let disposed = false

	const refresh = async (): Promise<void> => {
		const s = scope()
		if (!s) return
		incomingTransfers.value = await incomingTransferService.getIncomingTransfers(s.profileId, s.networkId, s.account)
	}

	const onAdded = (inc: IncomingTransferRecord) => {
		const idx = incomingTransfers.value.findIndex((x) => x.id === inc.id)
		if (idx === -1) incomingTransfers.value = [inc, ...incomingTransfers.value]
		else incomingTransfers.value[idx] = inc
	}
	const onUpdated = (inc: IncomingTransferRecord) => {
		const idx = incomingTransfers.value.findIndex((x) => x.id === inc.id)
		if (idx !== -1) incomingTransfers.value[idx] = inc
	}
	const onDeleted = (inc: IncomingTransferRecord) => {
		incomingTransfers.value = incomingTransfers.value.filter((x) => x.id !== inc.id)
	}
	const onConfigUpdate = (prop: ConfigProp) => {
		if (prop.key === "incomingTransfersVisible") refresh()
	}

	incomingTransferService.onIncomingTransferAdded.add(onAdded)
	incomingTransferService.onIncomingTransferUpdated.add(onUpdated)
	incomingTransferService.onIncomingTransferDeleted.add(onDeleted)
	incomingTransferService.onConnected.add(refresh)
	configService.onUpdate.add(onConfigUpdate)

	const dispose = () => {
		if (disposed) return
		disposed = true
		incomingTransferService.onIncomingTransferAdded.remove(onAdded)
		incomingTransferService.onIncomingTransferUpdated.remove(onUpdated)
		incomingTransferService.onIncomingTransferDeleted.remove(onDeleted)
		incomingTransferService.onConnected.remove(refresh)
		configService.onUpdate.remove(onConfigUpdate)
	}
	onScopeDispose(dispose)

	return { incomingTransfers, refresh, dispose }
}
