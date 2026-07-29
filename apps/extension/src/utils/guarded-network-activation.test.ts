import { describe, expect, test, vi } from "vitest"
import { activateNetworkGuarded } from "./guarded-network-activation"

type Net = { id: string }

function makeStore(current: Net | undefined, admit: boolean | (() => boolean), profileId = "p1") {
	const store = {
		network: current,
		profile: { id: profileId },
		commitScopeChange: vi.fn(async (commit: () => void) => {
			const ok = typeof admit === "function" ? admit() : admit
			if (!ok) return false
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
		const store = makeStore({ id: "n1" }, true)
		const persist = vi.fn(async () => {
			throw new Error("port closed before response")
		})
		const read = vi.fn(async () => ({ id: "n2" }))

		const result = await activateNetworkGuarded(store, persist, read, { id: "n2" })

		expect(result).toBe("unconfirmed")
		expect(store.network?.id).toBe("n2")
	})

	test("persist error, write did NOT land → guarded reconcile returns to the durable network", async () => {
		const store = makeStore({ id: "n1" }, true)
		const persist = vi.fn(async () => {
			throw new Error("boom before write")
		})
		const read = vi.fn(async () => ({ id: "n1" }))

		const result = await activateNetworkGuarded(store, persist, read, { id: "n1" })

		expect(result).toBe("unconfirmed")
		expect(store.network?.id).toBe("n1")
		// The reconcile itself went THROUGH the guard (two commits total).
		expect(store.commitScopeChange).toHaveBeenCalledTimes(2)
	})

	test("reconcile is REFUSED (send started in the admitted scope) → view stays put, still unconfirmed", async () => {
		// Admission passes; a send then starts in the newly viewed scope; the
		// persist fails. Reconciling back would hide the send's activity — the
		// guard refuses and the view deliberately stays diverged until the send
		// settles or the popup reopens.
		let calls = 0
		const store = makeStore({ id: "n1" }, () => {
			calls += 1
			return calls === 1 // admit the activation, refuse the reconcile
		})
		const persist = vi.fn(async () => {
			throw new Error("boom")
		})
		const read = vi.fn(async () => ({ id: "n1" }))

		const result = await activateNetworkGuarded(store, persist, read, { id: "n2" })

		expect(result).toBe("unconfirmed")
		expect(store.network?.id).toBe("n2")
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

	test("activations are strictly serialized — an older activation cannot overtake a newer one", async () => {
		// A stalls inside its persist; B is requested next. B must WAIT for A to
		// fully finish (serialization), so the final state is the LAST requested
		// target — never the older one resuming over the newer.
		const store = makeStore({ id: "n1" }, true)
		const order: string[] = []
		let releaseA: () => void = () => undefined
		const aBlocked = new Promise<void>((r) => {
			releaseA = r
		})
		const persistA = vi.fn(async () => {
			order.push("a-start")
			await aBlocked
			order.push("a-done")
		})
		const persistB = vi.fn(async () => {
			order.push("b")
		})
		const read = vi.fn(async () => ({ id: "nX" }))

		const a = activateNetworkGuarded(store, persistA, read, { id: "n2" })
		const b = activateNetworkGuarded(store, persistB, read, { id: "n3" })
		await new Promise((r) => setTimeout(r, 10))
		expect(order).toEqual(["a-start"]) // B has not begun
		releaseA()

		expect(await a).toBe("activated")
		expect(await b).toBe("activated")
		expect(order).toEqual(["a-start", "a-done", "b"])
		expect(store.network?.id).toBe("n3")
	})

	test("a throwing activation does not wedge the queue (rejection-proof tail)", async () => {
		const store = makeStore({ id: "n1" }, true)
		const boom = vi.fn(async () => {
			throw new Error("persist failed")
		})
		const readBoom = vi.fn(async () => {
			throw new Error("read failed")
		})

		expect(await activateNetworkGuarded(store, boom, readBoom, { id: "n2" })).toBe("unconfirmed")
		// The next activation still runs normally.
		expect(
			await activateNetworkGuarded(
				store,
				async () => undefined,
				async () => ({ id: "n3" }),
				{ id: "n3" },
			),
		).toBe("activated")
		expect(store.network?.id).toBe("n3")
	})

	test("a queued activation whose profile changed while waiting is dropped as stale", async () => {
		// Captured at enqueue under p1; by the time it runs the wallet re-scoped
		// to p2 (lock → unlock another profile). The target belongs to a foreign
		// profile — nothing may move.
		const store = makeStore({ id: "n1" }, true, "p1")
		const persist = vi.fn(async () => undefined)
		const read = vi.fn(async () => ({ id: "n1" }))

		const p = activateNetworkGuarded(store, persist, read, { id: "n2" })
		store.profile = { id: "p2" }

		expect(await p).toBe("stale")
		expect(persist).not.toHaveBeenCalled()
		expect(store.network?.id).toBe("n1")
	})
})
