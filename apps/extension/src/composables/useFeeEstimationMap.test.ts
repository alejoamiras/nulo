import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { effectScope, nextTick } from "vue"
import { useFeeEstimationMap } from "./useFeeEstimationMap"

const flush = async () => {
	await Promise.resolve()
	await Promise.resolve()
	await nextTick()
}

describe("useFeeEstimationMap", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("starts with empty results and no keys estimating", () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: async (n) => n * 2,
			}),
		)!
		expect(Object.keys(result.results.value)).toHaveLength(0)
		expect(Object.keys(result.estimating.value)).toHaveLength(0)
		scope.stop()
	})

	it("flips estimating[key] immediately when estimate(key, ...) is called", () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: async (n) => n * 2,
			}),
		)!
		result.estimate(0, 5)
		expect(result.estimating.value[0]).toBe(true)
		expect(result.results.value[0]).toBeNull()
		scope.stop()
	})

	it("resolves the result for a single key after the debounce window", async () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: async (n) => n * 2,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 5)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		expect(result.results.value[0]).toBe(10)
		expect(result.estimating.value[0]).toBe(false)
		scope.stop()
	})

	it("estimates multiple keys in parallel with independent state", async () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: async (n) => n * 2,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 5)
		result.estimate(1, 10)
		result.estimate(2, 20)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		expect(result.results.value).toEqual({ 0: 10, 1: 20, 2: 40 })
		expect(Object.values(result.estimating.value).every((v) => v === false)).toBe(true)
		scope.stop()
	})

	it("debounces back-to-back estimate(key, ...) calls for the same key", async () => {
		const estimator = vi.fn(async (n: number) => n * 2)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 1)
		await vi.advanceTimersByTimeAsync(50)
		result.estimate(0, 2)
		await vi.advanceTimersByTimeAsync(50)
		result.estimate(0, 3)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		expect(estimator).toHaveBeenCalledTimes(1)
		expect(estimator).toHaveBeenCalledWith(3)
		expect(result.results.value[0]).toBe(6)
		scope.stop()
	})

	it("debounces are independent per key", async () => {
		const estimator = vi.fn(async (n: number) => n)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 1)
		// re-trigger key 0 mid-debounce; key 1 starts later but with its own clock
		await vi.advanceTimersByTimeAsync(50)
		result.estimate(0, 2)
		result.estimate(1, 5)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		expect(estimator).toHaveBeenCalledTimes(2)
		expect(result.results.value).toEqual({ 0: 2, 1: 5 })
		scope.stop()
	})

	it("rejects stale results when a newer estimate for the same key kicks in", async () => {
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
			useFeeEstimationMap<number, number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 1)
		await vi.advanceTimersByTimeAsync(100) // first estimator runs (pending)
		await flush()
		result.estimate(0, 2)
		await vi.advanceTimersByTimeAsync(100) // second estimator runs (resolves to 20)
		await flush()
		// Resolve the stale first estimator — must be ignored
		resolveFirst(99)
		await flush()
		expect(result.results.value[0]).toBe(20)
		scope.stop()
	})

	it("surfaces estimator errors via onError with the key and clears that key's result", async () => {
		const onError = vi.fn()
		const boom = new Error("estimate failed")
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: async () => {
					throw boom
				},
				debounceMs: 100,
				onError,
			}),
		)!
		result.estimate(7, 1)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		expect(result.results.value[7]).toBeNull()
		expect(result.estimating.value[7]).toBe(false)
		expect(onError).toHaveBeenCalledWith(7, boom)
		scope.stop()
	})

	it("cancel(key) before debounce fires aborts only that key's estimation", async () => {
		const estimator = vi.fn(async (n: number) => n)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 1)
		result.estimate(1, 2)
		expect(result.estimating.value[0]).toBe(true)
		expect(result.estimating.value[1]).toBe(true)
		result.cancel(0)
		expect(result.estimating.value[0]).toBe(false)
		expect(result.estimating.value[1]).toBe(true)
		await vi.advanceTimersByTimeAsync(200)
		await flush()
		expect(estimator).toHaveBeenCalledTimes(1)
		expect(estimator).toHaveBeenCalledWith(2)
		scope.stop()
	})

	it("cancel(key) after debounce fires but before resolve discards that key's result", async () => {
		let resolveIt: (v: number) => void = () => {}
		const estimator = vi.fn(
			() =>
				new Promise<number>((res) => {
					resolveIt = res
				}),
		)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 1)
		await vi.advanceTimersByTimeAsync(100)
		await flush()
		// estimator pending
		result.cancel(0)
		resolveIt(99)
		await flush()
		expect(result.results.value[0]).toBeNull()
		expect(result.estimating.value[0]).toBe(false)
		scope.stop()
	})

	it("cancelAll() aborts every pending estimation", async () => {
		const estimator = vi.fn(async (n: number) => n)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 1)
		result.estimate(1, 2)
		result.estimate(2, 3)
		result.cancelAll()
		await vi.advanceTimersByTimeAsync(200)
		await flush()
		expect(estimator).not.toHaveBeenCalled()
		expect(Object.values(result.estimating.value).every((v) => !v)).toBe(true)
		scope.stop()
	})

	it("dispose() prevents any further state mutation", async () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: async (n) => n,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 1)
		result.dispose()
		await vi.advanceTimersByTimeAsync(200)
		await flush()
		expect(result.results.value[0]).toBeNull()
		scope.stop()
	})

	it("auto-disposes when its effect scope stops", async () => {
		const estimator = vi.fn(async (n: number) => n)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: estimator,
				debounceMs: 100,
			}),
		)!
		result.estimate(0, 1)
		scope.stop()
		await vi.advanceTimersByTimeAsync(200)
		await flush()
		expect(estimator).not.toHaveBeenCalled()
	})

	it("default debounce is 500ms", async () => {
		const estimator = vi.fn(async (n: number) => n)
		const scope = effectScope()
		const result = scope.run(() =>
			useFeeEstimationMap<number, number, number>({
				estimate: estimator,
			}),
		)!
		result.estimate(0, 1)
		await vi.advanceTimersByTimeAsync(499)
		await flush()
		expect(estimator).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		await flush()
		expect(estimator).toHaveBeenCalledOnce()
		scope.stop()
	})
})
