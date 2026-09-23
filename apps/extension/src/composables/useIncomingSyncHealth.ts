import type { EventHandler } from "@nulo/wallet-core/utils"
import { type Ref, ref } from "vue"
import type { IncomingSyncHealth, IncomingSyncHealthChanged } from "@/wallet/services/incoming-transfer/spec"

/** Once shown, the stalled notice stays at least this long, so a Retry that works at once does not
 *  make it blink in and out. */
export const STALLED_MIN_DISPLAY_MS = 5_000

type Subscribable<T> = Pick<EventHandler<T>, "add" | "remove">

export interface IncomingSyncScope {
	profileId: string
	networkId: string
}

export interface UseIncomingSyncHealthDeps {
	/** The parent's client; the parent owns connect and disconnect. */
	client: {
		getIncomingSyncHealth(networkId: string): Promise<IncomingSyncHealth>
		retryIncomingScan(networkId: string): Promise<void>
		onIncomingSyncHealthChanged: Subscribable<IncomingSyncHealthChanged>
		onConnected: Subscribable<void>
	}
	/** The store's profile + network, or undefined while either is missing. */
	getScope: () => IncomingSyncScope | undefined
}

export interface UseIncomingSyncHealth {
	/** Whether the stalled notice is on screen — the worker's verdict, held for the minimum display. */
	stalled: Ref<boolean>
	retrying: Ref<boolean>
	/** Parent calls it on mount and on every scope change. */
	refresh: () => Promise<void>
	retry: () => Promise<void>
	dispose: () => void
}

const scopeKeyOf = (scope: IncomingSyncScope | undefined) => (scope ? `${scope.profileId}|${scope.networkId}` : "")

/**
 * Whether the active network's incoming scan is stalled. The health event is an invalidation, not a
 * value: every signal (event, reconnect, scope change, retry) refetches. A fetch that fails changes
 * nothing — it can neither invent a stall nor clear one.
 */
export function useIncomingSyncHealth(deps: UseIncomingSyncHealthDeps): UseIncomingSyncHealth {
	const stalled = ref(false)
	const retrying = ref(false)

	let disposed = false
	let generation = 0
	let retryGeneration = 0
	let shownScope = ""
	let shownAt = 0
	let hideTimer: ReturnType<typeof setTimeout> | undefined
	// The first connect is the one the first request opened; only later ones are reconnects.
	let connectsSeen = 0

	const cancelHide = () => {
		if (hideTimer !== undefined) clearTimeout(hideTimer)
		hideTimer = undefined
	}

	/** Nothing of another scope carries over: not its notice, not even for the minimum display, and not
	 *  its pending Retry, which would leave this scope's button disabled by a request it never made. */
	const enterScope = (key: string) => {
		if (key === shownScope) return
		shownScope = key
		cancelHide()
		stalled.value = false
		retryGeneration += 1
		retrying.value = false
	}

	const apply = (isStalled: boolean) => {
		if (isStalled) {
			cancelHide()
			if (!stalled.value) shownAt = Date.now()
			stalled.value = true
			return
		}
		if (!stalled.value || hideTimer !== undefined) return
		const remaining = shownAt + STALLED_MIN_DISPLAY_MS - Date.now()
		if (remaining <= 0) {
			stalled.value = false
			return
		}
		hideTimer = setTimeout(() => {
			hideTimer = undefined
			stalled.value = false
		}, remaining)
	}

	const refresh = async () => {
		const current = ++generation
		const scope = deps.getScope()
		enterScope(scopeKeyOf(scope))
		if (!scope) return
		const health = await deps.client.getIncomingSyncHealth(scope.networkId).catch(() => undefined)
		if (disposed || current !== generation || !health) return
		apply(health.stalled)
	}

	const onChanged = (changed: IncomingSyncHealthChanged) => {
		if (scopeKeyOf(changed) === scopeKeyOf(deps.getScope())) void refresh()
	}

	const onConnected = () => {
		connectsSeen += 1
		if (connectsSeen > 1) void refresh()
	}

	const retry = async () => {
		const scope = deps.getScope()
		if (!scope || retrying.value) return
		enterScope(scopeKeyOf(scope))
		const current = ++retryGeneration
		retrying.value = true
		try {
			await deps.client.retryIncomingScan(scope.networkId)
		} catch {
			// Unreachable worker: the refetch below shows whatever is true now.
		}
		// A retry that outlived its scope owns neither the flag nor the next fetch.
		if (disposed || current !== retryGeneration) return
		retrying.value = false
		await refresh()
	}

	deps.client.onIncomingSyncHealthChanged.add(onChanged)
	deps.client.onConnected.add(onConnected)

	const dispose = () => {
		disposed = true
		generation += 1
		cancelHide()
		deps.client.onIncomingSyncHealthChanged.remove(onChanged)
		deps.client.onConnected.remove(onConnected)
	}

	return { stalled, retrying, refresh, retry, dispose }
}
