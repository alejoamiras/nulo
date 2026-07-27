import { describe, expect, test, vi } from "vitest"
import { activateNetworkGuarded } from "./guarded-network-activation"

type Net = { id: string }

function makeStore(current: Net | undefined, admit: boolean) {
	const store = {
		network: current,
		commitScopeChange: vi.fn(async (commit: () => void) => {
			if (!admit) return false
			commit()
			return true
		}),
	}
	return store
}

describe("activateNetworkGuarded", () => {
	test("guard admits → in-memory moves, then the durable pointer persists", async () => {
		const store = makeStore({ id: "n1" }, true)
		const persist = vi.fn(async () => {
			// The guard's commit must have run BEFORE the durable write.
			expect(store.network?.id).toBe("n2")
		})
		const read = vi.fn(async () => ({ id: "n2" }))

		const result = await activateNetworkGuarded(store, persist, read, { id: "n2" })

		expect(result).toBe("activated")
		expect(read).not.toHaveBeenCalled()
	})

	test("guard refuses → NOTHING moves: no durable write, in-memory untouched", async () => {
		const store = makeStore({ id: "n1" }, false)
		const persist = vi.fn(async () => undefined)
		const read = vi.fn(async () => ({ id: "n1" }))

		const result = await activateNetworkGuarded(store, persist, read, { id: "n2" })

		expect(result).toBe("blocked")
		expect(persist).not.toHaveBeenCalled()
		expect(store.network?.id).toBe("n1")
	})

	test("persist error but the write actually LANDED → reconcile keeps the target (no split-brain revert)", async () => {
		// Transport failure after the durable write: the pointer is on n2. A
		// blind revert to n1 would recreate the durable/UI split-brain.
		const store = makeStore({ id: "n1" }, true)
		const persist = vi.fn(async () => {
			throw new Error("port closed before response")
		})
		const read = vi.fn(async () => ({ id: "n2" }))

		const result = await activateNetworkGuarded(store, persist, read, { id: "n2" })

		expect(result).toBe("unconfirmed")
		expect(store.network?.id).toBe("n2")
	})

	test("persist error and the write did NOT land → reconcile returns to the durable network", async () => {
		const store = makeStore({ id: "n1" }, true)
		const persist = vi.fn(async () => {
			throw new Error("boom before write")
		})
		const read = vi.fn(async () => ({ id: "n1" }))

		const result = await activateNetworkGuarded(store, persist, read, { id: "n1" })

		expect(result).toBe("unconfirmed")
		expect(store.network?.id).toBe("n1")
	})

	test("reconcile read fails → in-memory stays on the target (indeterminate, converges on next bootstrap)", async () => {
		const store = makeStore({ id: "n1" }, true)
		const persist = vi.fn(async () => {
			throw new Error("boom")
		})
		const read = vi.fn(async () => {
			throw new Error("read also failed")
		})

		const result = await activateNetworkGuarded(store, persist, read, { id: "n2" })

		expect(result).toBe("unconfirmed")
		expect(store.network?.id).toBe("n2")
	})

	test("a stale activation's failure handling never clobbers a newer activation", async () => {
		const store = makeStore({ id: "n1" }, true)
		// First activation: persist hangs until released, then fails.
		let releaseFirst: () => void = () => undefined
		const firstBlocked = new Promise<void>((r) => {
			releaseFirst = r
		})
		const persistFirst = vi.fn(async () => {
			await firstBlocked
			throw new Error("slow failure")
		})
		const readFirst = vi.fn(async () => ({ id: "n1" }))
		const first = activateNetworkGuarded(store, persistFirst, readFirst, { id: "n2" })

		// Second activation supersedes and succeeds.
		const second = await activateNetworkGuarded(
			store,
			async () => undefined,
			async () => ({ id: "n3" }),
			{ id: "n3" },
		)
		expect(second).toBe("activated")
		expect(store.network?.id).toBe("n3")

		// The stale failure resolves — it must NOT reconcile over n3.
		releaseFirst()
		expect(await first).toBe("unconfirmed")
		expect(store.network?.id).toBe("n3")
		expect(readFirst).not.toHaveBeenCalled()
	})
})
