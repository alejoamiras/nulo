import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ChromeStorageProofGate, PROOF_GATE_KEY } from "./chrome-storage-proof-gate"

/**
 * Controllable in-memory fake of the slice of `chrome.storage` the gate
 * uses: `session.{get,set,remove}` + `onChanged`. `set`/`remove` fire
 * `onChanged` with the area "session" so the gate's event path is exercised
 * exactly as in the browser.
 */
function makeFakeStorage() {
	const store = new Map<string, unknown>()
	const listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = []
	const emit = (key: string, newValue: unknown) => {
		for (const l of [...listeners]) l({ [key]: { newValue } as chrome.storage.StorageChange }, "session")
	}
	const session = {
		get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
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
	return { session, onChanged, store, listenerCount: () => listeners.length }
}

let fake: ReturnType<typeof makeFakeStorage>

beforeEach(() => {
	fake = makeFakeStorage()
	// The global setup stubs `chrome` with `storage: {}`; augment it.
	;(chrome as unknown as { storage: unknown }).storage = { session: fake.session, onChanged: fake.onChanged }
})

afterEach(() => {
	vi.useRealTimers()
})

describe("ChromeStorageProofGate", () => {
	test("resolves immediately when the gate key is absent (the bulk path)", async () => {
		const gate = new ChromeStorageProofGate()
		await expect(gate.wait()).resolves.toBeUndefined()
		// No listener should be left behind on the instant path.
		expect(fake.listenerCount()).toBe(0)
	})

	test("holds while the key is present, releases when it is removed", async () => {
		await fake.session.set({ [PROOF_GATE_KEY]: { held: true } })
		const gate = new ChromeStorageProofGate()

		let released = false
		const waiting = gate.wait().then(() => {
			released = true
		})

		// Let the isHeld() + re-check microtasks settle; still held.
		await Promise.resolve()
		await Promise.resolve()
		expect(released).toBe(false)
		expect(fake.listenerCount()).toBe(1)

		await fake.session.remove(PROOF_GATE_KEY)
		await waiting
		expect(released).toBe(true)
		// Listener cleaned up; key cleared so it can't bleed into a later test.
		expect(fake.listenerCount()).toBe(0)
		expect(fake.store.has(PROOF_GATE_KEY)).toBe(false)
	})

	test("safety timeout resolves loudly when release is forgotten", async () => {
		vi.useFakeTimers()
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await fake.session.set({ [PROOF_GATE_KEY]: { held: true } })
		const gate = new ChromeStorageProofGate()

		let released = false
		const waiting = gate.wait().then(() => {
			released = true
		})

		await vi.advanceTimersByTimeAsync(19_000)
		expect(released).toBe(false)
		await vi.advanceTimersByTimeAsync(2_000)
		await waiting

		expect(released).toBe(true)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("safety timeout"))
		expect(fake.listenerCount()).toBe(0)
		expect(fake.store.has(PROOF_GATE_KEY)).toBe(false)
		warn.mockRestore()
	})

	test("resolves if the key is removed between the held-check and subscribe (race)", async () => {
		await fake.session.set({ [PROOF_GATE_KEY]: { held: true } })
		const gate = new ChromeStorageProofGate()

		// Remove the key on the next microtask — after the initial isHeld()
		// read but before/around the re-check; the re-check must catch it.
		const waiting = gate.wait()
		fake.store.delete(PROOF_GATE_KEY)

		await expect(waiting).resolves.toBeUndefined()
		expect(fake.listenerCount()).toBe(0)
	})
})
