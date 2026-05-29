/**
 * Unit tests for the per-session FIFO baton primitive.
 *
 * Plan v6 §Tests #17-#21:
 *   - Handler completes without calling releaseFifo → baton resolves at completion (safety net)
 *   - Handler calls releaseFifo mid-execution → baton resolves immediately
 *   - Idempotent release: double-call to releaseFifo no-ops
 *   - Safety net on handler failure: handler throws → baton resolves
 *   - Order preservation with mixed release timing
 */
import { describe, expect, test, vi } from "vitest"
import { createSessionBaton } from "./session-baton"

describe("createSessionBaton", () => {
	test("baton starts unresolved; resolves only after releaseFifo()", async () => {
		const { baton, releaseFifo } = createSessionBaton()
		let resolved = false
		baton.then(() => {
			resolved = true
		})
		await Promise.resolve()
		expect(resolved).toBe(false)

		releaseFifo()
		await baton
		expect(resolved).toBe(true)
	})

	test("releaseFifo is idempotent — only the first call resolves the baton", async () => {
		const { baton, releaseFifo } = createSessionBaton()
		releaseFifo()
		releaseFifo() // no-op
		releaseFifo() // no-op
		// Should not throw + baton still resolved exactly once.
		await expect(baton).resolves.toBeUndefined()
	})

	test("safety-net pattern: handler completes without explicit release → baton resolves on .finally", async () => {
		const { baton, releaseFifo } = createSessionBaton()
		const handler = async () => {
			// Handler that doesn't call releaseFifo explicitly.
			await Promise.resolve()
			return "done"
		}
		const handlerPromise = handler()
		// Mirror the onWalletMessage safety-net wiring:
		handlerPromise.finally(releaseFifo).catch(() => {})

		const result = await handlerPromise
		expect(result).toBe("done")
		await expect(baton).resolves.toBeUndefined()
	})

	test("safety-net pattern: handler THROWS → baton still resolves via .finally", async () => {
		const { baton, releaseFifo } = createSessionBaton()
		const handler = async () => {
			throw new Error("handler error")
		}
		// Mirror the onWalletMessage safety-net wiring.
		handler()
			.finally(releaseFifo)
			.catch(() => {})

		// Baton resolves despite the throw — the next message must not be blocked.
		await expect(baton).resolves.toBeUndefined()
	})

	test("early release: handler calls releaseFifo mid-execution → baton resolves BEFORE handler completes", async () => {
		const { baton, releaseFifo } = createSessionBaton()
		let handlerResolved = false
		let resolveDeferred!: () => void
		const deferred = new Promise<void>((resolve) => {
			resolveDeferred = resolve
		})
		const handler = async () => {
			// Halfway through the handler, release the baton.
			releaseFifo()
			await deferred
			handlerResolved = true
		}
		const handlerPromise = handler()
		handlerPromise.finally(releaseFifo).catch(() => {}) // safety-net (no-op since already released)

		// Baton resolves now even though deferred hasn't fired.
		await baton
		expect(handlerResolved).toBe(false)

		// Now let the handler complete.
		resolveDeferred()
		await handlerPromise
		expect(handlerResolved).toBe(true)
	})

	test("multiple sessions get independent batons", async () => {
		const a = createSessionBaton()
		const b = createSessionBaton()
		a.releaseFifo()
		// b's baton is unaffected.
		let bResolved = false
		b.baton.then(() => {
			bResolved = true
		})
		await a.baton
		await Promise.resolve()
		expect(bResolved).toBe(false)
		b.releaseFifo()
		await b.baton
		expect(bResolved).toBe(true)
	})

	test("order preservation: chained handlers run sequentially when each awaits prev baton", async () => {
		// Simulates the onWalletMessage FIFO pattern: handler N awaits prev.
		const order: number[] = []
		const sessionQueues = new Map<string, Promise<void>>()
		const key = "session-X"

		// Helper mimics what onWalletMessage does per message.
		const enqueue = (id: number, handler: () => Promise<void>): Promise<void> => {
			const prev = sessionQueues.get(key) ?? Promise.resolve()
			const { baton, releaseFifo } = createSessionBaton()
			const chain = prev.then(async () => {
				order.push(id)
				await handler()
			})
			chain.finally(releaseFifo).catch(() => {})
			sessionQueues.set(
				key,
				baton.catch(() => {}),
			)
			return chain
		}

		// All three handlers complete normally (no early release). Order should
		// be strictly A → B → C because each baton-resolution waits for handler
		// completion via the safety-net.
		const handlerWork = (delayMs: number) => () => new Promise<void>((resolve) => setTimeout(resolve, delayMs))
		const a = enqueue(1, handlerWork(20))
		const b = enqueue(2, handlerWork(5))
		const c = enqueue(3, handlerWork(0))
		await Promise.all([a, b, c])

		expect(order).toEqual([1, 2, 3])
	})

	test("early release allows next handler to start BEFORE previous handler completes", async () => {
		// Mimics the sendTx + sendTx scenario: A releases early after tx-build,
		// B starts immediately even though A's proving is still in-flight.
		const startOrder: number[] = []
		const completeOrder: number[] = []
		const sessionQueues = new Map<string, Promise<void>>()
		const key = "session-X"

		let resolveA!: () => void
		const aTail = new Promise<void>((resolve) => {
			resolveA = resolve
		})

		const enqueueWithEarlyRelease = (id: number, body: (release: () => void) => Promise<void>): Promise<void> => {
			const prev = sessionQueues.get(key) ?? Promise.resolve()
			const { baton, releaseFifo } = createSessionBaton()
			const chain = prev.then(async () => {
				startOrder.push(id)
				await body(releaseFifo)
				completeOrder.push(id)
			})
			chain.finally(releaseFifo).catch(() => {})
			sessionQueues.set(
				key,
				baton.catch(() => {}),
			)
			return chain
		}

		const a = enqueueWithEarlyRelease(1, async (release) => {
			release() // early release — mimics onExecutionEnqueued firing
			await aTail // simulate long proving tail
		})
		const b = enqueueWithEarlyRelease(2, async () => {
			// Just run.
		})

		// Give B's start a moment.
		await new Promise((r) => setTimeout(r, 5))
		expect(startOrder).toEqual([1, 2]) // B started before A completed
		expect(completeOrder).toEqual([2]) // B completed; A still waiting

		resolveA()
		await Promise.all([a, b])
		expect(completeOrder).toEqual([2, 1]) // A completes after B
	})
})
