import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { effectScope, nextTick } from "vue"
import { useFeeEstimation } from "./useFeeEstimation"

describe("useFeeEstimation — remote cancellation + handoff", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	const flushAll = async () => {
		await Promise.resolve()
		await Promise.resolve()
		await nextTick()
	}

	const make = () => {
		const cancelRemote = vi.fn()
		const tokens: string[] = []
		const scope = effectScope()
		const composable = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (n, token) => {
					tokens.push(token)
					return n * 2
				},
				cancelRemote,
			}),
		)!
		return { scope, composable, cancelRemote, tokens }
	}

	it("mints a distinct token per attempt and passes it to the estimator", async () => {
		const { scope, composable, tokens } = make()
		composable.estimate(1)
		await vi.advanceTimersByTimeAsync(800)
		await flushAll()
		composable.estimate(2)
		await vi.advanceTimersByTimeAsync(800)
		await flushAll()
		expect(tokens).toHaveLength(2)
		expect(tokens[0]).not.toBe(tokens[1])
		scope.stop()
	})

	it("refire before the RPC started: no remote cancel (nothing to cancel server-side)", async () => {
		const { scope, composable, cancelRemote } = make()
		composable.estimate(1)
		await vi.advanceTimersByTimeAsync(100) // debounce still pending
		composable.estimate(2)
		expect(cancelRemote).not.toHaveBeenCalled()
		scope.stop()
	})

	it("refire supersedes a COMPLETED estimate: its token is remote-cancelled (stash evicted)", async () => {
		const { scope, composable, cancelRemote, tokens } = make()
		composable.estimate(1)
		await vi.advanceTimersByTimeAsync(800)
		await flushAll()
		expect(cancelRemote).not.toHaveBeenCalled()
		composable.estimate(2)
		expect(cancelRemote).toHaveBeenCalledExactlyOnceWith(tokens[0])
		scope.stop()
	})

	it("dispose remote-cancels the completed estimate", async () => {
		const { scope, composable, cancelRemote, tokens } = make()
		composable.estimate(1)
		await vi.advanceTimersByTimeAsync(800)
		await flushAll()
		composable.dispose()
		expect(cancelRemote).toHaveBeenCalledExactlyOnceWith(tokens[0])
		scope.stop()
	})

	it("(HANDOFF RACE PIN) submit → handoff → unmount: NO remote cancel fires for the handed-off token", async () => {
		const { scope, composable, cancelRemote, tokens } = make()
		composable.estimate(1)
		await vi.advanceTimersByTimeAsync(800)
		await flushAll()
		const handed = composable.handoff()
		expect(handed).toBe(tokens[0])
		composable.dispose()
		scope.stop()
		expect(cancelRemote).not.toHaveBeenCalled()
	})

	it("handoff with nothing completed or in flight returns null", () => {
		const { scope, composable } = make()
		expect(composable.handoff()).toBeNull()
		scope.stop()
	})

	it("(IN-FLIGHT HANDOFF PIN) handoff of a started-but-unsettled estimate returns its token; unmount does NOT remote-cancel it", async () => {
		// handoff() is deliberately in-flight-inclusive (completedToken ?? inflight?.token):
		// the submit path consumes THIS slot's estimate, so a still-in-flight token's
		// stash will be consumed the moment it lands. Contrast handoffAll() on the
		// keyed composable, which is completed-only by design.
		const cancelRemote = vi.fn()
		let release: (n: number) => void = () => {}
		const gate = new Promise<number>((r) => {
			release = r
		})
		const tokens: string[] = []
		const scope = effectScope()
		const composable = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (_n, token) => {
					tokens.push(token)
					return gate
				},
				cancelRemote,
			}),
		)!
		composable.estimate(1)
		await vi.advanceTimersByTimeAsync(800) // RPC in flight, unsettled
		expect(composable.handoff()).toBe(tokens[0])
		composable.dispose()
		scope.stop()
		expect(cancelRemote).not.toHaveBeenCalled()
		release(0)
	})

	it("handoff of a never-started (debounce-pending) token still returns the token", async () => {
		const { scope, composable, cancelRemote } = make()
		composable.estimate(1)
		await vi.advanceTimersByTimeAsync(100) // debounce still pending, RPC never fired
		expect(composable.handoff()).not.toBeNull()
		composable.dispose()
		scope.stop()
		expect(cancelRemote).not.toHaveBeenCalled()
	})

	it("cancel() remote-cancels an in-flight (started) estimate", async () => {
		const cancelRemote = vi.fn()
		let release: (n: number) => void = () => {}
		const gate = new Promise<number>((r) => {
			release = r
		})
		const tokens: string[] = []
		const slowScope = effectScope()
		const slow = slowScope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (_n, token) => {
					tokens.push(token)
					return gate
				},
				cancelRemote,
			}),
		)!
		slow.estimate(1)
		await vi.advanceTimersByTimeAsync(800) // RPC now in flight
		slow.cancel()
		expect(cancelRemote).toHaveBeenCalledExactlyOnceWith(tokens[0])
		release(0)
		slowScope.stop()
	})

	it("a transport failure (RPC timeout) remote-cancels the orphaned SW-side token", async () => {
		const cancelRemote = vi.fn()
		const tokens: string[] = []
		const scope = effectScope()
		const composable = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (_n, token) => {
					tokens.push(token)
					throw new Error("RPC timeout")
				},
				cancelRemote,
				onError: () => {},
			}),
		)!
		composable.estimate(1)
		await vi.advanceTimersByTimeAsync(800)
		await flush()
		expect(cancelRemote).toHaveBeenCalledExactlyOnceWith(tokens[0])
		scope.stop()
	})
})

const flush = async () => {
	await Promise.resolve()
	await Promise.resolve()
	await nextTick()
}

describe("useFeeEstimation", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("starts with null result and not estimating", () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (n) => n * 2,
			}),
		)!
		expect(result.result.value).toBeNull()
		expect(result.isEstimating.value).toBe(false)
		scope.stop()
	})

	it("flips isEstimating immediately when estimate() is called", () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (n) => n * 2,
			}),
		)!
		result.estimate(5)
		expect(result.isEstimating.value).toBe(true)
		expect(result.result.value).toBeNull()
		scope.stop()
	})

	it("resolves the result after the debounce window", async () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (n) => n * 2,
				debounceMs: 100,
			}),
		)!
		result.estimate(5)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		expect(result.result.value).toBe(10)
		expect(result.isEstimating.value).toBe(false)
		scope.stop()
	})

	it("debounces back-to-back estimate() calls", async () => {
		const estimator = vi.fn(async (n: number) => n * 2)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(1)
		await vi.advanceTimersByTimeAsync(50)
		result.estimate(2)
		await vi.advanceTimersByTimeAsync(50)
		result.estimate(3)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		expect(estimator).toHaveBeenCalledTimes(1)
		expect(estimator).toHaveBeenCalledWith(3, expect.any(String))
		expect(result.result.value).toBe(6)
		scope.stop()
	})

	it("rejects stale results when a newer estimate kicks in", async () => {
		let resolveFirst: (v: number) => void = () => {}
		let count = 0
		const estimator = vi.fn(async (n: number) => {
			count++
			if (count === 1) {
				return new Promise<number>((res) => {
					resolveFirst = res
				})
			}
			return n * 10
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(1)
		await vi.advanceTimersByTimeAsync(100) // first estimator runs (pending)
		await flush()
		result.estimate(2)
		await vi.advanceTimersByTimeAsync(100) // second estimator runs (resolves to 20)
		await flush()
		// Now resolve the stale first estimator — must be ignored
		resolveFirst(99)
		await flush()
		expect(result.result.value).toBe(20)
		scope.stop()
	})

	it("clears result when a new estimate is scheduled", () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (n) => n,
			}),
		)!
		// Manually seed a stale result
		result.result.value = 42 as unknown as number
		result.estimate(1)
		expect(result.result.value).toBeNull()
		scope.stop()
	})

	it("surfaces estimator errors via onError and clears result", async () => {
		const onError = vi.fn()
		const boom = new Error("estimate failed")
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async () => {
					throw boom
				},
				debounceMs: 100,
				onError,
			}),
		)!
		result.estimate(1)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		expect(result.result.value).toBeNull()
		expect(result.isEstimating.value).toBe(false)
		expect(onError).toHaveBeenCalledWith(boom)
		scope.stop()
	})

	it("cancel() before debounce fires aborts the estimation", async () => {
		const estimator = vi.fn(async (n: number) => n)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(1)
		expect(result.isEstimating.value).toBe(true)
		result.cancel()
		expect(result.isEstimating.value).toBe(false)
		expect(result.result.value).toBeNull()
		await vi.advanceTimersByTimeAsync(200)
		await flush()
		expect(estimator).not.toHaveBeenCalled()
		scope.stop()
	})

	it("cancel() after debounce fires but before resolve discards the result", async () => {
		let resolveIt: (v: number) => void = () => {}
		const estimator = vi.fn(
			() =>
				new Promise<number>((res) => {
					resolveIt = res
				}),
		)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(1)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		// Estimator is now pending
		result.cancel()
		resolveIt(99)
		await flush()
		expect(result.result.value).toBeNull()
		expect(result.isEstimating.value).toBe(false)
		scope.stop()
	})

	it("dispose() prevents any further state mutation", async () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (n) => n,
				debounceMs: 100,
			}),
		)!
		result.estimate(1)
		result.dispose()
		await vi.advanceTimersByTimeAsync(200)
		await flush()
		expect(result.result.value).toBeNull()
		expect(result.isEstimating.value).toBe(true) // dispose doesn't clear, cancel does — pin behavior
		scope.stop()
	})

	it("auto-disposes when its effect scope stops", async () => {
		const estimator = vi.fn(async (n: number) => n)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(1)
		scope.stop()
		await vi.advanceTimersByTimeAsync(200)
		await flush()
		expect(estimator).not.toHaveBeenCalled()
	})

	it("default debounce is 800ms", async () => {
		const estimator = vi.fn(async (n: number) => n)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: estimator,
			}),
		)!
		result.estimate(1)
		await vi.advanceTimersByTimeAsync(799)
		await flush()
		expect(estimator).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		await flush()
		expect(estimator).toHaveBeenCalledOnce()
		scope.stop()
	})

	it("re-estimating after a successful run yields the new result", async () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimation<number, number>({
				estimate: async (n) => n * 2,
				debounceMs: 50,
			}),
		)!
		result.estimate(3)
		await vi.advanceTimersByTimeAsync(50)
		await flush()
		expect(result.result.value).toBe(6)
		result.estimate(4)
		await vi.advanceTimersByTimeAsync(50)
		await flush()
		expect(result.result.value).toBe(8)
		scope.stop()
	})
})
