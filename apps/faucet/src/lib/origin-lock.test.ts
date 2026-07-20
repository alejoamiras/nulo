import { describe, expect, it } from "vitest"
import { type OriginLockApi, withOriginLock } from "./origin-lock"

/** A faithful exclusive-lock fake: per-name FIFO queue. */
function fakeLocks(): OriginLockApi {
	const tails = new Map<string, Promise<unknown>>()
	return {
		async request<T>(name: string, _o: { mode: "exclusive" }, cb: () => Promise<T>): Promise<T> {
			const prev = tails.get(name) ?? Promise.resolve()
			const run = prev.then(cb, cb)
			tails.set(
				name,
				run.catch(() => {}),
			)
			return run
		},
	}
}

describe("withOriginLock", () => {
	it("FAIL-CLOSED: no locks API ⇒ throws, callback never runs", async () => {
		let ran = false
		await expect(
			withOriginLock(
				"x",
				async () => {
					ran = true
				},
				undefined,
			),
		).rejects.toThrow(/fail-closed/i)
		expect(ran).toBe(false)
	})

	it("serializes two contenders on the same name — the race pin", async () => {
		const locks = fakeLocks()
		const order: string[] = []
		let releaseA: () => void = () => {}
		const gate = new Promise<void>((r) => {
			releaseA = r
		})
		const a = withOriginLock(
			"resume:0xrec",
			async () => {
				order.push("a-start")
				await gate
				order.push("a-end")
			},
			locks,
		)
		const b = withOriginLock(
			"resume:0xrec",
			async () => {
				order.push("b-start")
			},
			locks,
		)
		await new Promise((r) => setTimeout(r, 0))
		expect(order).toEqual(["a-start"]) // b is queued, not interleaved
		releaseA()
		await Promise.all([a, b])
		expect(order).toEqual(["a-start", "a-end", "b-start"])
	})

	it("a throwing holder releases the lock for the next contender", async () => {
		const locks = fakeLocks()
		await expect(
			withOriginLock(
				"y",
				async () => {
					throw new Error("boom")
				},
				locks,
			),
		).rejects.toThrow("boom")
		await expect(withOriginLock("y", async () => "next", locks)).resolves.toBe("next")
	})
})
