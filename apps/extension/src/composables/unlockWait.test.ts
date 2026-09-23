import { describe, expect, test, vi } from "vitest"
import { reactive } from "vue"
import { awaitProfileActivation, BootstrapFailedError, UnlockTimeoutError } from "./unlockWait"

function makeStore(
	over: Partial<{ isLogined: boolean; profile?: { id: string }; bootstrapFailure: { profileId: string; message: string } | null }> = {},
) {
	return reactive({
		isLogined: false,
		profile: undefined as { id: string } | undefined,
		bootstrapFailure: null as { profileId: string; message: string } | null,
		...over,
	})
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("awaitProfileActivation", () => {
	test("already active for the expected profile: resolves immediately", async () => {
		const store = makeStore({ isLogined: true, profile: { id: "A" } })
		await expect(awaitProfileActivation(store, "A", 1_000)).resolves.toBeUndefined()
	})

	test("pre-existing failure record for the expected profile: rejects immediately with the typed error", async () => {
		const store = makeStore({ bootstrapFailure: { profileId: "A", message: "boom" } })
		await expect(awaitProfileActivation(store, "A", 1_000)).rejects.toBeInstanceOf(BootstrapFailedError)
	})

	test("activation arriving later resolves the wait", async () => {
		const store = makeStore()
		const wait = awaitProfileActivation(store, "A", 5_000)
		store.profile = { id: "A" }
		store.isLogined = true
		await flush()
		await expect(wait).resolves.toBeUndefined()
	})

	test("isLogined WITHOUT the expected identity does not resolve; the matching identity later does", async () => {
		const store = makeStore()
		const wait = awaitProfileActivation(store, "A", 5_000)
		store.profile = { id: "B" }
		store.isLogined = true
		await flush()
		store.profile = { id: "A" }
		await flush()
		await expect(wait).resolves.toBeUndefined()
	})

	test("a failure recorded mid-wait rejects IMMEDIATELY (never burns the bound)", async () => {
		vi.useFakeTimers()
		try {
			const store = makeStore()
			const wait = awaitProfileActivation(store, "A", 30_000)
			const settled = vi.fn()
			wait.catch(settled)
			store.bootstrapFailure = { profileId: "A", message: "rpc down" }
			await vi.advanceTimersByTimeAsync(0)
			expect(settled).toHaveBeenCalledTimes(1)
			expect(settled.mock.calls[0][0]).toBeInstanceOf(BootstrapFailedError)
			expect(settled.mock.calls[0][0].message).toBe("rpc down")
		} finally {
			vi.useRealTimers()
		}
	})

	test("a failure for a DIFFERENT profile does not reject the wait", async () => {
		const store = makeStore()
		const wait = awaitProfileActivation(store, "A", 5_000)
		const settled = vi.fn()
		wait.then(settled, settled)
		store.bootstrapFailure = { profileId: "B", message: "other" }
		await flush()
		expect(settled).not.toHaveBeenCalled()
		store.profile = { id: "A" }
		store.isLogined = true
		await flush()
		await expect(wait).resolves.toBeUndefined()
	})

	test("timeout rejects with the typed UnlockTimeoutError", async () => {
		vi.useFakeTimers()
		try {
			const store = makeStore()
			const wait = awaitProfileActivation(store, "A", 1_000)
			const settled = vi.fn()
			wait.catch(settled)
			await vi.advanceTimersByTimeAsync(1_001)
			expect(settled.mock.calls[0][0]).toBeInstanceOf(UnlockTimeoutError)
		} finally {
			vi.useRealTimers()
		}
	})

	test("activation after settle is inert (watcher torn down; no double-settle throw)", async () => {
		vi.useFakeTimers()
		try {
			const store = makeStore()
			const wait = awaitProfileActivation(store, "A", 1_000)
			wait.catch(() => {})
			await vi.advanceTimersByTimeAsync(1_001)
			store.profile = { id: "A" }
			store.isLogined = true
			await vi.advanceTimersByTimeAsync(0)
			// No unhandled resolve/reject — reaching here without a throw is the assertion.
		} finally {
			vi.useRealTimers()
		}
	})

	test("resolution clears the timer (no late spurious rejection)", async () => {
		vi.useFakeTimers()
		try {
			const store = makeStore()
			const wait = awaitProfileActivation(store, "A", 1_000)
			store.profile = { id: "A" }
			store.isLogined = true
			await vi.advanceTimersByTimeAsync(0)
			await expect(wait).resolves.toBeUndefined()
			await vi.advanceTimersByTimeAsync(2_000) // past the bound — nothing fires
		} finally {
			vi.useRealTimers()
		}
	})

	test("failure settle also tears down: a later activation does not resurrect the promise", async () => {
		const store = makeStore()
		const wait = awaitProfileActivation(store, "A", 5_000)
		const outcomes: unknown[] = []
		wait.then(
			() => outcomes.push("resolved"),
			(e) => outcomes.push(e),
		)
		store.bootstrapFailure = { profileId: "A", message: "boom" }
		await flush()
		store.profile = { id: "A" }
		store.isLogined = true
		await flush()
		expect(outcomes).toHaveLength(1)
		expect(outcomes[0]).toBeInstanceOf(BootstrapFailedError)
	})
})
