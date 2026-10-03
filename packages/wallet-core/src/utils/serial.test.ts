import { describe, expect, test } from "vitest"
import { createSerialQueue } from "./serial"

const CAP = 2_000

/**
 * Runs `scenario` beside a self-requeueing microtask counter and returns its stamps. The counter
 * stops in `finally`, and running out of budget fails the test instead of passing on a truncated log.
 */
async function trace(scenario: (stamp: (event: string) => void) => Promise<unknown>): Promise<string[]> {
	const log: string[] = []
	let ticks = 0
	let stopped = false
	let exhausted = false
	const spin = () => {
		if (stopped) return
		if (++ticks >= CAP) {
			exhausted = true
			return
		}
		queueMicrotask(spin)
	}
	queueMicrotask(spin)
	try {
		await scenario((event) => log.push(`${ticks}:${event}`))
	} finally {
		stopped = true
	}
	if (exhausted) throw new Error(`the spinner ran out of its ${CAP}-job budget`)
	return log
}

/** Settles after `jobs` microtasks, resolving or rejecting with `value`. */
function settleAfter(jobs: number, value: unknown, reject = false): Promise<unknown> {
	return new Promise((resolve, fail) => {
		let n = 0
		const step = () => (++n >= jobs ? (reject ? fail(value) : resolve(value)) : queueMicrotask(step))
		queueMicrotask(step)
	})
}

type Run = (op: () => Promise<unknown>) => Promise<unknown>

/** Ops that resolve, reject, throw synchronously, and reject with the value a rethrowing reporter rethrows. */
async function script(run: Run, stamp: (event: string) => void, getTail?: () => Promise<unknown>): Promise<void> {
	const ops: { name: string; jobs: number; reject?: boolean; sync?: boolean }[] = [
		{ name: "a", jobs: 2 },
		{ name: "b", jobs: 1, reject: true },
		{ name: "c", jobs: 3 },
		{ name: "d", jobs: 1, sync: true },
		{ name: "rethrow", jobs: 1, reject: true },
		{ name: "f", jobs: 2 },
	]
	const settled = ops.map(({ name, jobs, reject, sync }) =>
		run(() => {
			stamp(`start:${name}`)
			if (sync) throw `sync-${name}`
			return settleAfter(jobs, name, reject)
		}).then(
			(value) => stamp(`ok:${name}:${String(value)}`),
			(error) => stamp(`err:${name}:${String(error)}`),
		),
	)
	if (getTail) {
		await getTail().then(
			() => stamp("tail-ok"),
			(error) => stamp(`tail-err:${String(error)}`),
		)
	}
	await Promise.all(settled)
	await settleAfter(20, undefined)
}

describe("createSerialQueue against the hand-written chains it replaces", () => {
	test("propagate: the same promise graph as `run = tail.then(op); tail = run.then(noop, noop)`", async () => {
		const reference = () => {
			let tail: Promise<unknown> = Promise.resolve()
			return {
				run: (op: () => Promise<unknown>) => {
					const run = tail.then(op)
					tail = run.then(
						() => undefined,
						() => undefined,
					)
					return run
				},
				tail: () => tail,
			}
		}
		const ref = reference()
		const expected = await trace((stamp) => script(ref.run, stamp, ref.tail))
		const queue = createSerialQueue()
		const actual = await trace((stamp) =>
			script(
				(op) => queue.run(op),
				stamp,
				() => queue.tail,
			),
		)
		expect(actual).toEqual(expected)
		expect(actual.some((e) => e.endsWith(":err:b:b"))).toBe(true)
		expect(actual.some((e) => e.endsWith("start:f"))).toBe(true)
	})

	test("report: the same promise graph as `tail = tail.then(op).catch(onError)`, a rethrowing reporter included", async () => {
		const reports = (log: string[]) => (error: unknown) => {
			log.push(`report:${String(error)}`)
			if (error === "rethrow") throw "rethrown"
		}
		const referenceLog: string[] = []
		let tail: Promise<unknown> = Promise.resolve()
		const onRefError = reports(referenceLog)
		const expected = await trace((stamp) =>
			script(
				(op) => {
					tail = tail.then(op).catch(onRefError)
					return tail
				},
				stamp,
				() => tail,
			),
		)
		const actualLog: string[] = []
		const queue = createSerialQueue({ onError: reports(actualLog) })
		const actual = await trace((stamp) =>
			script(
				(op) => queue.run(op),
				stamp,
				() => queue.tail,
			),
		)
		expect(actual).toEqual(expected)
		expect(actualLog).toEqual(referenceLog)
		// A rethrowing reporter rejects the tail: the next op is skipped and the reporter sees the rethrow.
		expect(actualLog).toEqual(["report:b", "report:sync-d", "report:rethrow", "report:rethrown"])
		expect(actual.some((e) => e.endsWith("start:f"))).toBe(false)
	})
})

describe("createSerialQueue", () => {
	test("propagate: each op starts only after the previous settled, and a rejection reaches its caller only", async () => {
		const queue = createSerialQueue()
		const order: string[] = []
		let release!: () => void
		const first = queue.run(
			() =>
				new Promise<string>((resolve) => {
					order.push("first-start")
					release = () => resolve("one")
				}),
		)
		const second = queue.run(async () => {
			order.push("second-start")
			throw new Error("boom")
		})
		const third = queue.run(async () => {
			order.push("third-start")
			return 3
		})
		await settleAfter(10, undefined)
		expect(order).toEqual(["first-start"])
		release()
		await expect(first).resolves.toBe("one")
		await expect(second).rejects.toThrow("boom")
		await expect(third).resolves.toBe(3)
		expect(order).toEqual(["first-start", "second-start", "third-start"])
	})

	test("report: run(op) is the tail, read live; it resolves through a rejection and the reporter sees it once", async () => {
		const errors: unknown[] = []
		const queue = createSerialQueue({
			onError: (error) => {
				errors.push(error)
			},
		})
		const initial = queue.tail
		expect(queue.tail).toBe(initial)
		const link = queue.run(async () => {
			throw new Error("quota")
		})
		expect(queue.tail).toBe(link)
		expect(queue.tail).not.toBe(initial)
		await expect(link).resolves.toBeUndefined()
		expect(errors).toEqual([new Error("quota")])
		const next = queue.run(async () => "ok")
		expect(queue.tail).toBe(next)
		await expect(next).resolves.toBe("ok")
	})

	test("propagate: the tail moves on every run and never rejects", async () => {
		const queue = createSerialQueue()
		const initial = queue.tail
		const run = queue.run(async () => {
			throw new Error("boom")
		})
		const tail = queue.tail
		expect(tail).not.toBe(initial)
		expect(tail).not.toBe(run)
		await expect(run).rejects.toThrow("boom")
		await expect(tail).resolves.toBeUndefined()
	})

	test("the spinner itself fails on exhaustion rather than truncating", async () => {
		await expect(trace(() => settleAfter(CAP + 10, undefined))).rejects.toThrow("ran out")
	})
})
