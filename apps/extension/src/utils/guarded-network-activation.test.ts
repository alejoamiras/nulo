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
		const calls: string[] = []
		const persist = vi.fn(async (id: string) => {
			// The guard's commit must have run BEFORE the durable write.
			expect(store.network?.id).toBe("n2")
			calls.push(id)
		})

		const result = await activateNetworkGuarded(store, persist, { id: "n2" })

		expect(result).toBe("activated")
		expect(calls).toEqual(["n2"])
	})

	test("guard refuses → NOTHING moves: no durable write, in-memory untouched", async () => {
		const store = makeStore({ id: "n1" }, false)
		const persist = vi.fn(async () => undefined)

		const result = await activateNetworkGuarded(store, persist, { id: "n2" })

		expect(result).toBe("blocked")
		expect(persist).not.toHaveBeenCalled()
		expect(store.network?.id).toBe("n1")
	})

	test("persist fails after the guard admitted → in-memory reverts to the previous network", async () => {
		const store = makeStore({ id: "n1" }, true)
		const persist = vi.fn(async () => {
			throw new Error("service worker unreachable")
		})

		const result = await activateNetworkGuarded(store, persist, { id: "n2" })

		expect(result).toBe("failed")
		expect(store.network?.id).toBe("n1")
	})

	test("persist failure with no previous network reverts to undefined, not the target", async () => {
		const store = makeStore(undefined, true)
		const persist = vi.fn(async () => {
			throw new Error("boom")
		})

		const result = await activateNetworkGuarded(store, persist, { id: "n2" })

		expect(result).toBe("failed")
		expect(store.network).toBeUndefined()
	})
})
