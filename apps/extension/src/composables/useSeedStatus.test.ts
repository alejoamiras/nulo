import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises } from "@vue/test-utils"
import type { SeedScope, SeedStatusEntry, SeedStatusSnapshot } from "@/wallet/services/token/spec"
import { SEED_HANDOFF_MS, SEED_STATUS_RETRY_MS, type UseSeedStatus, useSeedStatus } from "./useSeedStatus"

function makeEvent<T>() {
	const handlers = new Set<(x: T) => void>()
	return {
		add: (fn: (x: T) => void) => void handlers.add(fn),
		remove: (fn: (x: T) => void) => void handlers.delete(fn),
		emit: (x: T) => {
			for (const fn of [...handlers]) fn(x)
		},
		size: () => handlers.size,
	}
}

function deferred<T>() {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

const entry = (status: SeedStatusEntry["status"], chainId = 1): SeedStatusEntry => ({
	chainId,
	contract: "0xseed",
	symbol: "cUSDC",
	displayName: "Clean USDC",
	status,
})

const snap = (entries: SeedStatusEntry[], scope: SeedScope | undefined = { profileId: "p1", chainId: 1 }): SeedStatusSnapshot => ({
	scope,
	entries,
})

function harness() {
	const scope: { current: SeedScope | undefined } = { current: { profileId: "p1", chainId: 1 } }
	const client = {
		getSeedStatus: vi.fn(async (): Promise<SeedStatusSnapshot> => snap([entry("pending")])),
		ensureSeeding: vi.fn(async () => {}),
		retrySeed: vi.fn(async () => true),
		onSeedStatusChanged: makeEvent<SeedScope>(),
		onConnected: makeEvent<void>(),
	}
	const seed = useSeedStatus({ client, getScope: () => scope.current })
	live.push(seed)
	return { seed, client, scope }
}
const live: UseSeedStatus[] = []

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
})
afterEach(() => {
	for (const seed of live.splice(0)) seed.dispose()
	vi.useRealTimers()
})

describe("useSeedStatus", () => {
	test("first refresh: loading → loaded with the entries, and one seeding kick for the scope", async () => {
		const { seed, client } = harness()
		expect(seed.state.value).toBe("loading")
		expect(seed.ready.value).toBe(false)
		await seed.refresh()
		expect(seed.state.value).toBe("loaded")
		expect(seed.ready.value).toBe(true)
		expect(seed.entries.value).toEqual([entry("pending")])
		expect(client.ensureSeeding).toHaveBeenCalledTimes(1)
		expect(client.getSeedStatus).toHaveBeenCalledWith(1)
	})

	test("refetching the same scope neither kicks again nor drops the rows it already shows", async () => {
		const { seed, client } = harness()
		await seed.refresh()
		const pending = deferred<SeedStatusSnapshot>()
		client.getSeedStatus.mockReturnValueOnce(pending.promise)
		const refetch = seed.refresh()
		expect(seed.entries.value).toEqual([entry("pending")])
		expect(seed.state.value).toBe("loaded")
		pending.resolve(snap([entry("seeding")]))
		await refetch
		expect(seed.entries.value).toEqual([entry("seeding")])
		expect(client.ensureSeeding).toHaveBeenCalledTimes(1)
	})

	test("no scope: nothing to wait for — loaded, empty, no RPC", async () => {
		const { seed, client, scope } = harness()
		scope.current = undefined
		await seed.refresh()
		expect(seed.state.value).toBe("loaded")
		expect(seed.entries.value).toEqual([])
		expect(client.getSeedStatus).not.toHaveBeenCalled()
		expect(client.ensureSeeding).not.toHaveBeenCalled()
	})

	test("a rejected first fetch is `unavailable`, never loaded-and-empty; the timed retry recovers it once", async () => {
		const { seed, client } = harness()
		client.getSeedStatus.mockRejectedValueOnce(new Error("port closed"))
		await seed.refresh()
		expect(seed.state.value).toBe("unavailable")
		expect(seed.ready.value).toBe(false)

		await vi.advanceTimersByTimeAsync(SEED_STATUS_RETRY_MS)
		expect(seed.state.value).toBe("loaded")
		expect(client.getSeedStatus).toHaveBeenCalledTimes(2)
	})

	test("the timed retry is one shot: a second rejection waits for a reconnect or an event", async () => {
		const { seed, client } = harness()
		client.getSeedStatus.mockRejectedValue(new Error("port closed"))
		await seed.refresh()
		await vi.advanceTimersByTimeAsync(SEED_STATUS_RETRY_MS * 10)
		expect(client.getSeedStatus).toHaveBeenCalledTimes(2)
		expect(seed.state.value).toBe("unavailable")
	})

	test("a rejected REFETCH keeps the loaded rows instead of downgrading them", async () => {
		const { seed, client } = harness()
		await seed.refresh()
		client.getSeedStatus.mockRejectedValueOnce(new Error("port closed"))
		await seed.refresh()
		expect(seed.state.value).toBe("loaded")
		expect(seed.entries.value).toEqual([entry("pending")])
	})

	test("a status event for this scope refetches; one for another scope is ignored", async () => {
		const { seed, client } = harness()
		await seed.refresh()
		client.onSeedStatusChanged.emit({ profileId: "p2", chainId: 1 })
		client.onSeedStatusChanged.emit({ profileId: "p1", chainId: 2 })
		await flushPromises()
		expect(client.getSeedStatus).toHaveBeenCalledTimes(1)

		client.getSeedStatus.mockResolvedValueOnce(snap([entry("failed")]))
		client.onSeedStatusChanged.emit({ profileId: "p1", chainId: 1 })
		await flushPromises()
		expect(seed.entries.value).toEqual([entry("failed")])
	})

	test("a default that leaves the list while being worked on is held as `seeding` until its row can show", async () => {
		const { seed, client } = harness()
		await seed.refresh()
		client.getSeedStatus.mockResolvedValue(snap([]))
		await seed.refresh()
		expect(seed.entries.value).toEqual([entry("seeding")])
		expect(seed.ready.value).toBe(true)

		// A refetch during the hold neither drops it nor restarts its clock.
		await vi.advanceTimersByTimeAsync(SEED_HANDOFF_MS - 1)
		await seed.refresh()
		expect(seed.entries.value).toEqual([entry("seeding")])
		await vi.advanceTimersByTimeAsync(1)
		expect(seed.entries.value).toEqual([])
	})

	test("the hold is for work in progress only, and a default that comes back is not listed twice", async () => {
		const { seed, client } = harness()
		client.getSeedStatus.mockResolvedValueOnce(snap([entry("failed")])).mockResolvedValueOnce(snap([]))
		await seed.refresh()
		await seed.refresh()
		expect(seed.entries.value).toEqual([])

		client.getSeedStatus
			.mockResolvedValueOnce(snap([entry("pending")]))
			.mockResolvedValueOnce(snap([]))
			.mockResolvedValueOnce(snap([entry("failed")]))
		await seed.refresh()
		await seed.refresh()
		await seed.refresh()
		expect(seed.entries.value).toEqual([entry("failed")])
		await vi.advanceTimersByTimeAsync(SEED_HANDOFF_MS)
		expect(seed.entries.value).toEqual([entry("failed")])
	})

	test("an answer read for another scope is no answer: never loaded-and-empty, retried once", async () => {
		const { seed, client } = harness()
		client.getSeedStatus
			.mockResolvedValueOnce(snap([], { profileId: "p2", chainId: 1 }))
			.mockResolvedValueOnce({ scope: undefined, entries: [] })
		await seed.refresh()
		expect(seed.state.value).toBe("unavailable")
		await vi.advanceTimersByTimeAsync(SEED_STATUS_RETRY_MS)
		expect(seed.state.value).toBe("unavailable")
		expect(client.getSeedStatus).toHaveBeenCalledTimes(2)

		await seed.refresh()
		expect(seed.state.value).toBe("loaded")
	})

	test("only the latest request lands: an older answer resolving late is dropped", async () => {
		const { seed, client } = harness()
		const slow = deferred<SeedStatusSnapshot>()
		client.getSeedStatus.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(snap([entry("seeding")]))
		const first = seed.refresh()
		await seed.refresh()
		slow.resolve(snap([entry("failed")]))
		await first
		expect(seed.entries.value).toEqual([entry("seeding")])
	})

	test("a scope change clears the old rows at once, goes back to loading, and kicks the new scope", async () => {
		const { seed, client, scope } = harness()
		await seed.refresh()
		const pending = deferred<SeedStatusSnapshot>()
		client.getSeedStatus.mockReturnValueOnce(pending.promise)
		scope.current = { profileId: "p1", chainId: 2 }
		const refetch = seed.refresh()
		expect(seed.entries.value).toEqual([])
		expect(seed.state.value).toBe("loading")
		expect(client.ensureSeeding).toHaveBeenCalledTimes(2)

		pending.resolve(snap([entry("pending", 2)], { profileId: "p1", chainId: 2 }))
		await refetch
		expect(seed.entries.value).toEqual([entry("pending", 2)])
	})

	test("a scope change drops a held default with the rest of the old scope", async () => {
		const { seed, client, scope } = harness()
		await seed.refresh()
		client.getSeedStatus.mockResolvedValueOnce(snap([]))
		await seed.refresh()
		expect(seed.entries.value).toEqual([entry("seeding")])

		scope.current = { profileId: "p1", chainId: 2 }
		client.getSeedStatus.mockResolvedValueOnce(snap([], { profileId: "p1", chainId: 2 }))
		await seed.refresh()
		expect(seed.entries.value).toEqual([])
	})

	test("a reconnect re-issues the kick and refetches; the first connect is the mount's own", async () => {
		const { seed, client } = harness()
		await seed.refresh()
		client.onConnected.emit()
		await flushPromises()
		expect(client.ensureSeeding).toHaveBeenCalledTimes(1)
		expect(client.getSeedStatus).toHaveBeenCalledTimes(1)

		client.onConnected.emit()
		await flushPromises()
		expect(client.ensureSeeding).toHaveBeenCalledTimes(2)
		expect(client.getSeedStatus).toHaveBeenCalledTimes(2)
	})

	test("a rejected kick is swallowed — the reconnect that follows re-issues it", async () => {
		const { seed, client } = harness()
		client.ensureSeeding.mockRejectedValueOnce(new Error("port closed"))
		await expect(seed.refresh()).resolves.toBeUndefined()
		expect(seed.state.value).toBe("loaded")
	})

	test("retry calls the service for that default, then shows whatever is true — even when the call rejects", async () => {
		const { seed, client } = harness()
		await seed.refresh()
		client.getSeedStatus.mockResolvedValueOnce(snap([entry("seeding")]))
		await seed.retry({ chainId: 1, contract: "0xseed" })
		expect(client.retrySeed).toHaveBeenCalledWith(1, "0xseed")
		expect(seed.entries.value).toEqual([entry("seeding")])

		client.retrySeed.mockRejectedValueOnce(new Error("port closed"))
		await expect(seed.retry({ chainId: 1, contract: "0xseed" })).resolves.toBeUndefined()
	})

	test("dispose: handlers removed, the retry timer cancelled, a late answer ignored", async () => {
		const { seed, client } = harness()
		const slow = deferred<SeedStatusSnapshot>()
		client.getSeedStatus.mockReturnValueOnce(slow.promise)
		const inFlight = seed.refresh()
		seed.dispose()
		slow.resolve(snap([entry("failed")]))
		await inFlight
		expect(seed.entries.value).toEqual([])
		expect(client.onSeedStatusChanged.size()).toBe(0)
		expect(client.onConnected.size()).toBe(0)

		const second = harness()
		second.client.getSeedStatus.mockRejectedValue(new Error("port closed"))
		await second.seed.refresh()
		second.seed.dispose()
		await vi.advanceTimersByTimeAsync(SEED_STATUS_RETRY_MS)
		expect(second.client.getSeedStatus).toHaveBeenCalledTimes(1)
	})
})
