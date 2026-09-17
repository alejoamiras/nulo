import type { EventHandler } from "@nulo/wallet-core/utils"
import { type ComputedRef, type Ref, computed, ref } from "vue"
import type { SeedScope, SeedStatusEntry, SeedStatusSnapshot } from "@/wallet/services/token/spec"

/**
 * A snapshot that has not answered is not an empty one: `unavailable` (the fetch was
 * rejected and nothing for this scope ever loaded) must never read as "no defaults".
 */
export type SnapshotState = "loading" | "loaded" | "unavailable"

/** A rejected fetch is retried once on a timer; after that only a reconnect or an event retries. */
export const SEED_STATUS_RETRY_MS = 2_000

/** How long a seeded default stays listed (as `seeding`) for its balance row to show up. Consumers
 *  drop it sooner by matching the row's contract; the cap only bounds a row that never comes. */
export const SEED_HANDOFF_MS = 5_000

type Subscribable<T> = Pick<EventHandler<T>, "add" | "remove">

export interface UseSeedStatusDeps {
	/** The parent's CONNECTED-on-demand token client; the parent owns disconnect. */
	client: {
		getSeedStatus(chainId: number): Promise<SeedStatusSnapshot>
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

	const departed = new Map<string, { entry: SeedStatusEntry; timer: ReturnType<typeof setTimeout> }>()
	const clearDeparted = () => {
		for (const held of departed.values()) clearTimeout(held.timer)
		departed.clear()
	}
	const releaseDeparted = (key: string) => {
		clearTimeout(departed.get(key)?.timer)
		departed.delete(key)
	}

	/** Keeps a default that was being worked on and has now left the list: it was seeded, but its
	 *  balance row is created after the token row, by another service, and may not be visible yet. */
	const holdDeparted = (next: SeedStatusEntry[]) => {
		const present = new Set(next.map((e) => e.contract.toLowerCase()))
		for (const key of [...departed.keys()]) if (present.has(key)) releaseDeparted(key)
		for (const entry of entries.value) {
			const key = entry.contract.toLowerCase()
			if (present.has(key) || departed.has(key) || (entry.status !== "pending" && entry.status !== "seeding")) continue
			const timer = setTimeout(() => {
				departed.delete(key)
				entries.value = entries.value.filter((e) => e.contract.toLowerCase() !== key)
			}, SEED_HANDOFF_MS)
			departed.set(key, { entry: { ...entry, status: "seeding" }, timer })
		}
	}

	/** Another scope's rows are never shown under this one, not even while its own are loading. */
	const enterScope = (scope: SeedScope | undefined) => {
		const key = scopeKeyOf(scope)
		if (key === shownScope) return
		shownScope = key
		clearDeparted()
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
		const next = await deps.client.getSeedStatus(scope.chainId).catch(() => undefined)
		if (!isLatest()) return
		// The chain is ours by request; the profile is the service worker's. An answer for another
		// profile says nothing about this one, least of all "no defaults".
		if (!next || scopeKeyOf(next.scope) !== scopeKeyOf(scope)) return onRejected(isTimedRetry)
		holdDeparted(next.entries)
		entries.value = [...next.entries, ...[...departed.values()].map((held) => held.entry)]
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
		clearDeparted()
		deps.client.onSeedStatusChanged.remove(onChanged)
		deps.client.onConnected.remove(onConnected)
	}

	return { entries, state, ready, refresh, retry, dispose }
}
