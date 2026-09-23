/**
 * Placement pins for the pre-claim vouching chain (N-07): begin BEFORE the
 * FIFO wait, end at SETTLEMENT (never the early execution-enqueue release).
 */
import { describe, expect, test, vi } from "vitest"
import { chainSendTxWithVouching } from "./queued-wait-vouching"

function deferred<T = void>() {
	let resolve!: (v: T) => void
	let reject!: (e: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function makeVouch() {
	return { beginQueuedWait: vi.fn(), endQueuedWait: vi.fn() }
}

describe("chainSendTxWithVouching (N-07 placement pins)", () => {
	test("begin fires at id-resolution while `prev` is still UNRESOLVED (the FIFO park)", async () => {
		const vouch = makeVouch()
		const prev = deferred()
		const run = vi.fn(async () => "done")
		chainSendTxWithVouching({
			queuedJournalIdPromise: Promise.resolve("q1"),
			prev: prev.promise,
			vouch,
			releaseFifo: vi.fn(),
			run,
		})
		await Promise.resolve()
		await Promise.resolve()
		// The sibling is parked behind prev — and already vouched for.
		expect(vouch.beginQueuedWait).toHaveBeenCalledWith("q1")
		expect(run).not.toHaveBeenCalled()
		expect(vouch.endQueuedWait).not.toHaveBeenCalled()
		prev.resolve()
	})

	test("an early releaseFifo (execution-enqueue) does NOT end the vouching — only settlement does", async () => {
		const vouch = makeVouch()
		const releaseFifo = vi.fn()
		const running = deferred<string>()
		const chain = chainSendTxWithVouching({
			queuedJournalIdPromise: Promise.resolve("q1"),
			prev: Promise.resolve(),
			vouch,
			releaseFifo,
			run: async () => {
				releaseFifo() // the onExecutionEnqueued early release fires mid-handler
				return running.promise
			},
		})
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		expect(releaseFifo).toHaveBeenCalled() // early release happened…
		expect(vouch.endQueuedWait).not.toHaveBeenCalled() // …but the vouching holds
		running.resolve("ok")
		await chain
		await Promise.resolve()
		expect(vouch.endQueuedWait).toHaveBeenCalledWith("q1") // ends at settlement
	})

	test("end + releaseFifo fire on a REJECTED handler too (backstop covers every path)", async () => {
		const vouch = makeVouch()
		const releaseFifo = vi.fn()
		const chain = chainSendTxWithVouching({
			queuedJournalIdPromise: Promise.resolve("q1"),
			prev: Promise.resolve(),
			vouch,
			releaseFifo,
			run: async () => {
				throw new Error("handler broke")
			},
		})
		await expect(chain).rejects.toThrow("handler broke")
		await Promise.resolve()
		expect(vouch.endQueuedWait).toHaveBeenCalledWith("q1")
		expect(releaseFifo).toHaveBeenCalled()
	})

	test("no id (non-sendTx / establishment-dropped) → no vouching calls at all", async () => {
		const vouch = makeVouch()
		const chain = chainSendTxWithVouching({
			queuedJournalIdPromise: Promise.resolve(undefined),
			prev: Promise.resolve(),
			vouch,
			releaseFifo: vi.fn(),
			run: async () => "ok",
		})
		await chain
		await Promise.resolve()
		expect(vouch.beginQueuedWait).not.toHaveBeenCalled()
		expect(vouch.endQueuedWait).not.toHaveBeenCalled()
	})
})
