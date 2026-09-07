import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ChromeStorageIncomingPollGate, INCOMING_POLL_HOLD_KEY, INCOMING_POLL_STATUS_KEY } from "./chrome-storage-incoming-poll-gate"
import { ChromeStorageRestoreGate, RESTORE_GATE_KEY } from "./chrome-storage-restore-gate"
import { waitForStorageRelease } from "./storage-gate"

function makeFakeStorage() {
	const store = new Map<string, unknown>()
	const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = []
	const emit = (key: string, newValue: unknown) => {
		for (const l of [...listeners]) l({ [key]: { newValue } as chrome.storage.StorageChange }, "session")
	}
	// Runs once, inside the next read, so a test can land a write between a gate's subscription and its re-check.
	let beforeNextGet: (() => void) | undefined
	const session = {
		get: async (key: string) => {
			beforeNextGet?.()
			beforeNextGet = undefined
			return store.has(key) ? { [key]: store.get(key) } : {}
		},
		set: async (obj: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(obj)) {
				store.set(k, v)
				emit(k, v)
			}
		},
		remove: async (key: string) => {
			store.delete(key)
			emit(key, undefined)
		},
	}
	const onChanged = {
		addListener: (l: (typeof listeners)[number]) => listeners.push(l),
		removeListener: (l: (typeof listeners)[number]) => {
			const i = listeners.indexOf(l)
			if (i >= 0) listeners.splice(i, 1)
		},
	}
	return {
		session,
		onChanged,
		store,
		listenerCount: () => listeners.length,
		beforeNextGet: (fn: () => void) => {
			beforeNextGet = fn
		},
	}
}

let fake: ReturnType<typeof makeFakeStorage>
const KEY = "nulo:e2e:test-gate"
beforeEach(() => {
	fake = makeFakeStorage()
	;(chrome as unknown as { storage: unknown }).storage = { session: fake.session, onChanged: fake.onChanged }
})
afterEach(() => {
	vi.useRealTimers()
})

describe("waitForStorageRelease", () => {
	test("releases on the key's removal, running onFinish before it resolves", async () => {
		await fake.session.set({ [KEY]: 1 })
		const order: string[] = []
		const waiting = waitForStorageRelease({
			key: KEY,
			stillHeld: async () => (await fake.session.get(KEY))[KEY] !== undefined,
			timeoutMs: 60_000,
			onTimeout: () => order.push("timeout"),
			onFinish: () => order.push("finish"),
		}).then(() => order.push("resolved"))
		await Promise.resolve()
		await Promise.resolve()
		expect(order).toEqual([])
		expect(fake.listenerCount()).toBe(1)
		await fake.session.remove(KEY)
		await waiting
		expect(order).toEqual(["finish", "resolved"])
		expect(fake.listenerCount()).toBe(0)
	})

	test("a release that landed between the caller's check and the subscription is not missed", async () => {
		let held = true
		const waiting = waitForStorageRelease({
			key: KEY,
			// Resolved one microtask later, i.e. after the caller's synchronous release below.
			stillHeld: async () => {
				await Promise.resolve()
				return held
			},
			timeoutMs: 60_000,
			onTimeout: () => {},
		})
		held = false
		await expect(waiting).resolves.toBeUndefined()
		expect(fake.listenerCount()).toBe(0)
	})

	test("the safety timeout releases and reports", async () => {
		vi.useFakeTimers()
		let timedOut = false
		const waiting = waitForStorageRelease({
			key: KEY,
			stillHeld: async () => true,
			timeoutMs: 1_000,
			onTimeout: () => (timedOut = true),
		})
		await vi.advanceTimersByTimeAsync(1_000)
		await waiting
		expect(timedOut).toBe(true)
		expect(fake.listenerCount()).toBe(0)
	})
})

describe("ChromeStorageRestoreGate over waitForStorageRelease", () => {
	test("a record naming another hold point does not hold", async () => {
		await fake.session.set({ [RESTORE_GATE_KEY]: { at: "account-state", held: false } })
		await expect(new ChromeStorageRestoreGate().waitAt("service-restore")).resolves.toBeUndefined()
		expect(fake.listenerCount()).toBe(0)
	})

	test("a matching hold point acknowledges, holds, and clears the key itself once released", async () => {
		await fake.session.set({ [RESTORE_GATE_KEY]: { at: "service-restore", held: false } })
		let released = false
		const waiting = new ChromeStorageRestoreGate().waitAt("service-restore").then(() => {
			released = true
		})
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		expect(released).toBe(false)
		expect(fake.store.get(RESTORE_GATE_KEY)).toEqual({ at: "service-restore", held: true })
		await fake.session.remove(RESTORE_GATE_KEY)
		await waiting
		expect(released).toBe(true)
		expect(fake.store.has(RESTORE_GATE_KEY)).toBe(false)
	})

	test("a hold point that changed under the post-subscription re-check releases and clears the key", async () => {
		await fake.session.set({ [RESTORE_GATE_KEY]: { at: "service-restore", held: false } })
		const waiting = new ChromeStorageRestoreGate().waitAt("service-restore")
		// The first read has already run; the next one is the helper's re-check.
		fake.beforeNextGet(() => fake.store.set(RESTORE_GATE_KEY, { at: "account-state", held: false }))
		await expect(waiting).resolves.toBeUndefined()
		expect(fake.store.has(RESTORE_GATE_KEY)).toBe(false)
		expect(fake.listenerCount()).toBe(0)
	})
})

describe("ChromeStorageIncomingPollGate over waitForStorageRelease", () => {
	const hold = { profileId: "p", networkId: "n", accountAddress: "a", contract: "c", txHash: "t" }
	const match = { ...hold, txHashes: ["t"] }

	test("the safety timeout releases the waiter and leaves the HOLD key for the test to read", async () => {
		vi.useFakeTimers()
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await fake.session.set({ [INCOMING_POLL_HOLD_KEY]: hold })
		const waiting = new ChromeStorageIncomingPollGate().waitIfArmed(match)
		await vi.advanceTimersByTimeAsync(15_000)
		await expect(waiting).resolves.toBe("t")
		expect(fake.store.get(INCOMING_POLL_HOLD_KEY)).toEqual(hold)
		expect(fake.store.get(INCOMING_POLL_STATUS_KEY)).toEqual({ phase: "released", txHash: "t" })
		expect(warn).toHaveBeenCalledTimes(1)
		expect(fake.listenerCount()).toBe(0)
		warn.mockRestore()
	})
})
