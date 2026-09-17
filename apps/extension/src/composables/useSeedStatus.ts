import type { EventHandler } from "@nulo/wallet-core/utils"
import { type ComputedRef, type Ref, computed, ref } from "vue"
import type { SeedScope, SeedStatusEntry } from "@/wallet/services/token/spec"

/**
 * A snapshot that has not answered is not an empty one: `unavailable` (the fetch was
 * rejected and nothing for this scope ever loaded) must never read as "no defaults".
 */
export type SnapshotState = "loading" | "loaded" | "unavailable"

/** A rejected fetch is retried once on a timer; after that only a reconnect or an event retries. */
export const SEED_STATUS_RETRY_MS = 2_000

type Subscribable<T> = Pick<EventHandler<T>, "add" | "remove">

export interface UseSeedStatusDeps {
	/** The parent's CONNECTED-on-demand token client; the parent owns disconnect. */
	client: {
		getSeedStatus(): Promise<SeedStatusEntry[]>
		ensureSeeding(): Promise<void>
		retrySeed(chainId: number, contract: string): Promise<boolean>
		onSeedStatusChanged: Subscribable<SeedScope>
		onConnected: Subscribable<void>
	}
	/** The store's profile + chain, or undefined while either is missing. */
	getScope: () => SeedScope | undefined
}

export interface UseSeedStatus {
	entries: Ref<SeedStatusEntry[]>
	state: Ref<SnapshotState>
	ready: ComputedRef<boolean>
	/** Parent calls it on mount and on every scope change. */
	refresh: () => Promise<void>
	retry: (entry: Pick<SeedStatusEntry, "chainId" | "contract">) => Promise<void>
	dispose: () => void
}

const scopeKeyOf = (scope: SeedScope | undefined) => (scope ? `${scope.profileId}|${scope.chainId}` : "")

/**
 * Default tokens that are not token rows yet, for the active scope. The status RPC is a pure read,
 * so nothing here can start seeding by reading; the one deliberate kick is `ensureSeeding`, issued
 * once per scope and again after every reconnect — a reconnect means the service worker restarted,
 * and its once-per-lifetime latch with it.
 */
export function useSeedStatus(deps: UseSeedStatusDeps): UseSeedStatus {
	const entries = ref<SeedStatusEntry[]>([])
	const state = ref<SnapshotState>("loading")
	const ready = computed(() => state.value === "loaded")

	let disposed = false
	let generation = 0
	let shownScope: string | undefined
	let retryTimer: ReturnType<typeof setTimeout> | undefined
	// The first connect is the one the first request opened; only later ones are reconnects.
	let connectsSeen = 0

	const clearRetry = () => {
		if (retryTimer !== undefined) clearTimeout(retryTimer)
		retryTimer = undefined
	}

	const kick = () => {
		// A rejected kick is a port race: the reconnect that follows re-issues it.
		deps.client.ensureSeeding().catch(() => undefined)
	}

	/** Another scope's rows are never shown under this one, not even while its own are loading. */
	const enterScope = (scope: SeedScope | undefined) => {
		const key = scopeKeyOf(scope)
		if (key === shownScope) return
		shownScope = key
		entries.value = []
		state.value = scope ? "loading" : "loaded"
		if (scope) kick()
	}

	/** Rows already obtained for this scope stay; only a never-loaded scope reads `unavailable`. */
	const onRejected = (isTimedRetry: boolean) => {
		if (state.value !== "loaded") state.value = "unavailable"
		if (!isTimedRetry) retryTimer = setTimeout(() => void load(true), SEED_STATUS_RETRY_MS)
	}

	const load = async (isTimedRetry: boolean) => {
		const current = ++generation
		const isLatest = () => !disposed && current === generation
		clearRetry()
		const scope = deps.getScope()
		enterScope(scope)
		if (!scope) return
		const next = await deps.client.getSeedStatus().catch(() => undefined)
		if (!isLatest()) return
		if (!next) return onRejected(isTimedRetry)
		// The RPC answers for the service worker's active scope, read a moment before or after ours.
		entries.value = next.filter((e) => e.chainId === scope.chainId)
		state.value = "loaded"
	}

	const refresh = () => load(false)

	const onChanged = (scope: SeedScope) => {
		if (scopeKeyOf(scope) === scopeKeyOf(deps.getScope())) void refresh()
	}

	const onConnected = () => {
		connectsSeen += 1
		if (connectsSeen === 1 || !deps.getScope()) return
		kick()
		void refresh()
	}

	const retry = async (entry: Pick<SeedStatusEntry, "chainId" | "contract">) => {
		try {
			await deps.client.retrySeed(entry.chainId, entry.contract)
		} catch {
			// Refused or unreachable: the refetch below shows whatever is true now.
		}
		if (!disposed) await refresh()
	}

	deps.client.onSeedStatusChanged.add(onChanged)
	deps.client.onConnected.add(onConnected)

	const dispose = () => {
		disposed = true
		generation += 1
		clearRetry()
		deps.client.onSeedStatusChanged.remove(onChanged)
		deps.client.onConnected.remove(onConnected)
	}

	return { entries, state, ready, refresh, retry, dispose }
}
