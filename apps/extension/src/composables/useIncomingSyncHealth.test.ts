import { EventHandler } from "@nulo/wallet-core/utils"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { IncomingSyncHealth, IncomingSyncHealthChanged } from "@/wallet/services/incoming-transfer/spec"
import { type IncomingSyncScope, STALLED_MIN_DISPLAY_MS, useIncomingSyncHealth } from "./useIncomingSyncHealth"

const SCOPE: IncomingSyncScope = { profileId: "p1", networkId: "n1" }
const STALLED: IncomingSyncHealth = { stalled: true, since: 1 }
const HEALTHY: IncomingSyncHealth = { stalled: false, since: null }

function setup(initial: IncomingSyncHealth = HEALTHY) {
	let scope: IncomingSyncScope | undefined = SCOPE
	const client = {
		getIncomingSyncHealth: vi.fn(async (_networkId: string) => initial),
		retryIncomingScan: vi.fn(async (_networkId: string) => undefined),
		onIncomingSyncHealthChanged: new EventHandler<IncomingSyncHealthChanged>(),
		onConnected: new EventHandler<void>(),
	}
	const health = useIncomingSyncHealth({ client, getScope: () => scope })
	return {
		client,
		health,
		setScope: (next: IncomingSyncScope | undefined) => {
			scope = next
		},
		answer: (next: IncomingSyncHealth) => client.getIncomingSyncHealth.mockResolvedValue(next),
	}
}

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
})

describe("useIncomingSyncHealth", () => {
	test("starts hidden and reads the active network's health on refresh", async () => {
		const { client, health } = setup(STALLED)
		expect(health.stalled.value).toBe(false)

		await health.refresh()

		expect(client.getIncomingSyncHealth).toHaveBeenCalledWith("n1")
		expect(health.stalled.value).toBe(true)
	})

	test("no scope: nothing is fetched and nothing is shown", async () => {
		const { client, health, setScope } = setup(STALLED)
		setScope(undefined)

		await health.refresh()

		expect(client.getIncomingSyncHealth).not.toHaveBeenCalled()
		expect(health.stalled.value).toBe(false)
	})

	test("the health event is an invalidation: a matching one refetches, another profile's or network's does not", async () => {
		const { client, health, answer } = setup()
		await health.refresh()
		answer(STALLED)

		client.onIncomingSyncHealthChanged.invoke({ profileId: "p2", networkId: "n1" })
		client.onIncomingSyncHealthChanged.invoke({ profileId: "p1", networkId: "n2" })
		await flushPromises()
		expect(client.getIncomingSyncHealth).toHaveBeenCalledTimes(1)

		client.onIncomingSyncHealthChanged.invoke({ profileId: "p1", networkId: "n1" })
		await flushPromises()
		expect(health.stalled.value).toBe(true)
	})

	test("once shown the notice stays at least the minimum display, then leaves on schedule", async () => {
		const { health, answer } = setup(STALLED)
		await health.refresh()
		answer(HEALTHY)

		vi.advanceTimersByTime(1_000)
		await health.refresh()
		expect(health.stalled.value).toBe(true)

		vi.advanceTimersByTime(STALLED_MIN_DISPLAY_MS - 1_001)
		expect(health.stalled.value).toBe(true)
		vi.advanceTimersByTime(1)
		expect(health.stalled.value).toBe(false)
	})

	test("a recovery after the minimum display hides the notice at once", async () => {
		const { health, answer } = setup(STALLED)
		await health.refresh()
		answer(HEALTHY)
		vi.advanceTimersByTime(STALLED_MIN_DISPLAY_MS)

		await health.refresh()

		expect(health.stalled.value).toBe(false)
	})

	test("stalling again during the minimum display cancels the scheduled hide", async () => {
		const { health, answer } = setup(STALLED)
		await health.refresh()
		answer(HEALTHY)
		await health.refresh()
		answer(STALLED)
		await health.refresh()

		vi.advanceTimersByTime(STALLED_MIN_DISPLAY_MS * 2)

		expect(health.stalled.value).toBe(true)
	})

	test("a scope change drops the notice immediately and cancels its minimum display", async () => {
		const { health, setScope, answer } = setup(STALLED)
		await health.refresh()
		answer(HEALTHY)
		setScope({ profileId: "p1", networkId: "n2" })

		const pending = health.refresh()
		expect(health.stalled.value).toBe(false)
		await pending

		// The new scope's own stall must not inherit the old scope's display clock.
		answer(STALLED)
		await health.refresh()
		vi.advanceTimersByTime(STALLED_MIN_DISPLAY_MS)
		expect(health.stalled.value).toBe(true)
	})

	test("a rejected fetch changes nothing: it neither invents a stall nor clears one", async () => {
		const { client, health } = setup(STALLED)
		await health.refresh()
		client.getIncomingSyncHealth.mockRejectedValue(new Error("port closed"))

		await health.refresh()
		vi.advanceTimersByTime(STALLED_MIN_DISPLAY_MS * 2)

		expect(health.stalled.value).toBe(true)
	})

	test("an answer that arrives after a newer request is ignored", async () => {
		const { client, health } = setup()
		let releaseStale: (value: IncomingSyncHealth) => void = () => {}
		client.getIncomingSyncHealth.mockImplementationOnce(() => new Promise((resolve) => (releaseStale = resolve)))

		const stale = health.refresh()
		await health.refresh()
		releaseStale(STALLED)
		await stale

		expect(health.stalled.value).toBe(false)
	})

	test("a reconnect refetches; the first connect (the one the first request opened) does not", async () => {
		const { client, health } = setup()
		await health.refresh()

		client.onConnected.invoke()
		await flushPromises()
		expect(client.getIncomingSyncHealth).toHaveBeenCalledTimes(1)

		client.onConnected.invoke()
		await flushPromises()
		expect(client.getIncomingSyncHealth).toHaveBeenCalledTimes(2)
	})

	test("retry asks the worker to scan now, flags retrying meanwhile, then refetches", async () => {
		const { client, health } = setup(STALLED)
		await health.refresh()
		let finishRetry: () => void = () => {}
		client.retryIncomingScan.mockImplementationOnce(() => new Promise<undefined>((resolve) => (finishRetry = () => resolve(undefined))))

		const retrying = health.retry()
		expect(health.retrying.value).toBe(true)
		await health.retry() // a second press while one is running is ignored
		finishRetry()
		await retrying

		expect(client.retryIncomingScan).toHaveBeenCalledTimes(1)
		expect(client.retryIncomingScan).toHaveBeenCalledWith("n1")
		expect(health.retrying.value).toBe(false)
		expect(client.getIncomingSyncHealth).toHaveBeenCalledTimes(2)
	})

	test("a retry the worker rejects still clears retrying and refetches", async () => {
		const { client, health } = setup(STALLED)
		await health.refresh()
		client.retryIncomingScan.mockRejectedValue(new Error("port closed"))

		await health.retry()

		expect(health.retrying.value).toBe(false)
		expect(client.getIncomingSyncHealth).toHaveBeenCalledTimes(2)
	})

	test("dispose unsubscribes, cancels the pending hide and ignores an in-flight answer", async () => {
		const { client, health, answer } = setup(STALLED)
		await health.refresh()
		answer(HEALTHY)
		await health.refresh() // schedules the hide

		health.dispose()
		vi.advanceTimersByTime(STALLED_MIN_DISPLAY_MS * 2)
		client.onIncomingSyncHealthChanged.invoke({ profileId: "p1", networkId: "n1" })
		client.onConnected.invoke()
		client.onConnected.invoke()
		await flushPromises()

		expect(health.stalled.value).toBe(true)
		expect(client.getIncomingSyncHealth).toHaveBeenCalledTimes(2)
	})
})
