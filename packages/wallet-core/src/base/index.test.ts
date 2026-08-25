/**
 * ServiceCollection.start() phase-execution pins (N-28): a mid-phase failure
 * must settle every same-phase sibling before failing, aggregate EVERY
 * rejection, and never start a later phase. (The old reject-fast Promise.all
 * left pending siblings running unobserved; note their rejections were
 * HANDLED even then — Promise.all installs handlers on all inputs — so the
 * defect was the unobserved settle, not an unhandled rejection.)
 */
import { describe, expect, test } from "vitest"
import { ServiceCollection, type IService } from "./index"

function deferred() {
	let resolve!: () => void
	let reject!: (e: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function svc(name: string, start: (c: ServiceCollection) => Promise<void>, dependencies?: readonly string[]): IService {
	return { name, dependencies, start }
}

describe("ServiceCollection.start — mid-phase failure semantics (N-28)", () => {
	test("start() stays PENDING until every same-phase sibling settles, then rejects with an AggregateError naming every rejection", async () => {
		const collection = new ServiceCollection()
		const slowB = deferred()
		let bSettled = false
		collection.add(svc("A", async () => Promise.reject(new Error("A broke"))))
		collection.add(
			svc("B", async () => {
				await slowB.promise
				bSettled = true
			}),
		)

		let settled: "pending" | "rejected" = "pending"
		const run = collection.start().catch((e: unknown) => {
			settled = "rejected"
			throw e
		})
		const outcome = expect(run).rejects.toBeInstanceOf(AggregateError)
		// A already rejected; the old reject-fast semantics would reject NOW,
		// while B is still pending. The barrier must hold.
		await new Promise((r) => setTimeout(r, 10))
		expect(settled).toBe("pending")
		slowB.resolve()
		await outcome
		expect(bSettled).toBe(true) // B ran to completion, observed
	})

	test("the aggregate names EVERY failed service, not just the first", async () => {
		const collection = new ServiceCollection()
		collection.add(svc("A", async () => Promise.reject(new Error("A broke"))))
		collection.add(svc("B", async () => Promise.reject(new Error("B broke"))))
		const err = await collection.start().then(
			() => undefined,
			(e: unknown) => e as AggregateError,
		)
		expect(err).toBeInstanceOf(AggregateError)
		expect(err?.message).toContain("A")
		expect(err?.message).toContain("B")
		expect(err?.errors.map((e: Error) => e.message).sort()).toEqual(["A broke", "B broke"])
	})

	test("a failing phase prevents every later phase from starting", async () => {
		const collection = new ServiceCollection()
		let laterStarted = false
		collection.add(svc("A", async () => Promise.reject(new Error("A broke"))))
		collection.add(
			svc("C", async () => {
				laterStarted = true
			}, ["A"]),
		)
		await expect(collection.start()).rejects.toBeInstanceOf(AggregateError)
		await new Promise((r) => setTimeout(r, 10))
		expect(laterStarted).toBe(false)
	})

	test("all-green phases start in dependency order, unchanged", async () => {
		const collection = new ServiceCollection()
		const order: string[] = []
		collection.add(
			svc("A", async () => {
				order.push("A")
			}),
		)
		collection.add(
			svc("C", async () => {
				order.push("C")
			}, ["A"]),
		)
		await collection.start()
		expect(order).toEqual(["A", "C"])
	})
})
