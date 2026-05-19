import { describe, expect, test } from "vitest"

import { type SubscribableSource, subscribeWithSnapshot } from "./subscribe-with-snapshot"

/**
 * Minimal in-memory source that mirrors the production messaging shape:
 *  - onChange/onConnected each expose `add`/`remove`
 *  - fetchSnapshot reads the latest value
 *  - `setValue` synchronously dispatches to onChange handlers
 *  - `signalReconnect` synchronously dispatches to onConnected handlers
 */
function makeFakeSource<T>(initial: T) {
	const onChangeHandlers = new Set<(v: T) => void>()
	const onConnectedHandlers = new Set<() => void>()
	let current = initial
	let pendingDelay: Promise<void> | null = null

	const source: SubscribableSource<T> = {
		onChange: {
			add: (h) => {
				onChangeHandlers.add(h)
			},
			remove: (h) => {
				onChangeHandlers.delete(h)
			},
		},
		onConnected: {
			add: (h) => {
				onConnectedHandlers.add(h)
			},
			remove: (h) => {
				onConnectedHandlers.delete(h)
			},
		},
		fetchSnapshot: async () => {
			if (pendingDelay) await pendingDelay
			return current
		},
	}

	return {
		source,
		setValue: (v: T) => {
			current = v
			for (const h of onChangeHandlers) h(v)
		},
		signalReconnect: () => {
			for (const h of onConnectedHandlers) h()
		},
		setPendingDelay: (delay: Promise<void>) => {
			pendingDelay = delay
		},
		currentValue: () => current,
		changeHandlerCount: () => onChangeHandlers.size,
		connectedHandlerCount: () => onConnectedHandlers.size,
	}
}

describe("subscribeWithSnapshot", () => {
	test("fires handler with snapshot value on initial subscribe", async () => {
		const fake = makeFakeSource(42)
		const received: number[] = []

		await subscribeWithSnapshot(fake.source, (v) => {
			received.push(v)
		})

		expect(received).toEqual([42])
	})

	test("event arriving during snapshot fetch fires handler before snapshot — handler sees both", async () => {
		const fake = makeFakeSource("initial")
		const received: string[] = []

		let resolveFetch: () => void = () => undefined
		const fetchGate = new Promise<void>((r) => {
			resolveFetch = r
		})
		fake.setPendingDelay(fetchGate)

		// Start subscribe; snapshot fetch will hang on the gate.
		const subscribePromise = subscribeWithSnapshot(fake.source, (v) => {
			received.push(v)
		})

		// Immediately fire an event before snapshot resolves.
		// Handler is already registered, so it fires synchronously.
		fake.setValue("event-during-fetch")
		expect(received).toEqual(["event-during-fetch"])

		// Release the snapshot — it returns the latest value ("event-during-fetch").
		resolveFetch()
		await subscribePromise

		// Snapshot is at least as recent as the event (FIFO guarantee in production
		// transport — modeled here as snapshot reads `current` which the event updated).
		expect(received).toEqual(["event-during-fetch", "event-during-fetch"])
	})

	test("unsubscribe detaches both change and connected listeners", async () => {
		const fake = makeFakeSource(1)
		const received: number[] = []

		const unsubscribe = await subscribeWithSnapshot(fake.source, (v) => {
			received.push(v)
		})

		expect(fake.changeHandlerCount()).toBe(1)
		expect(fake.connectedHandlerCount()).toBe(1)

		unsubscribe()

		expect(fake.changeHandlerCount()).toBe(0)
		expect(fake.connectedHandlerCount()).toBe(0)

		// Post-unsubscribe events and reconnects don't fire the handler.
		fake.setValue(2)
		fake.signalReconnect()
		expect(received).toEqual([1])
	})

	test("reconnect re-fires the snapshot", async () => {
		const fake = makeFakeSource("v0")
		const received: string[] = []

		await subscribeWithSnapshot(fake.source, (v) => {
			received.push(v)
		})

		fake.setValue("v1")
		// `setValue` mutates current AND fires handler — but reconnect re-fetches.
		fake.signalReconnect()
		await Promise.resolve()
		await Promise.resolve()

		expect(received).toEqual(["v0", "v1", "v1"])
	})

	test("unsubscribe before an in-flight reconnect-snapshot resolves: handler does NOT fire with the late snapshot", async () => {
		const fake = makeFakeSource("v0")
		const received: string[] = []

		// Initial subscribe with a fast fetch — the unsubscribe fn becomes
		// available, then we trigger a reconnect (which queues a second
		// emitSnapshot) while gating that second fetch.
		const unsubscribe = await subscribeWithSnapshot(fake.source, (v) => {
			received.push(v)
		})

		expect(received).toEqual(["v0"])

		// Gate the NEXT fetch and trigger a reconnect.
		let resolveFetch: () => void = () => undefined
		fake.setPendingDelay(
			new Promise<void>((r) => {
				resolveFetch = r
			}),
		)
		fake.setValue("v1")
		fake.signalReconnect() // triggers a second emitSnapshot, blocked on the gate

		// Tear down while the reconnect-snapshot is in flight.
		unsubscribe()

		// Release the gate; the late tick must be suppressed by the unsub guard.
		resolveFetch()
		await Promise.resolve()
		await Promise.resolve()

		// "v1" arrived via the synchronous `setValue` fan-out BEFORE unsubscribe,
		// so received is ["v0", "v1"]. The late reconnect-snapshot would have
		// pushed another "v1" without the guard.
		expect(received).toEqual(["v0", "v1"])
	})

	test("snapshot fetch rejection leaves the change listener registered (subsequent events flow)", async () => {
		const onChangeHandlers = new Set<(v: number) => void>()
		const onConnectedHandlers = new Set<() => void>()
		let fetchAttempts = 0
		const source: SubscribableSource<number> = {
			onChange: {
				add: (h) => {
					onChangeHandlers.add(h)
				},
				remove: (h) => {
					onChangeHandlers.delete(h)
				},
			},
			onConnected: {
				add: (h) => {
					onConnectedHandlers.add(h)
				},
				remove: (h) => {
					onConnectedHandlers.delete(h)
				},
			},
			fetchSnapshot: async () => {
				fetchAttempts += 1
				throw new Error("transient")
			},
		}

		const received: number[] = []
		await subscribeWithSnapshot(source, (v) => {
			received.push(v)
		})

		// Snapshot didn't fire (fetch threw), but the change handler is registered.
		expect(received).toEqual([])
		expect(onChangeHandlers.size).toBe(1)
		expect(fetchAttempts).toBe(1)

		// Subsequent events still reach the handler.
		for (const h of onChangeHandlers) h(99)
		expect(received).toEqual([99])
	})
})
