/**
 * B-07: openChainStore quarantines a timed-out (un-cancellable) OPFS worker open
 * per chain dir, so a same-chain retry fails fast instead of spawning a second
 * worker that would deadlock on the first's exclusive SAH-pool lock.
 */
import { afterEach, describe, expect, test, vi } from "vitest"

const { mockOpen } = vi.hoisted(() => ({ mockOpen: vi.fn() }))

vi.mock("@aztec/kv-store/sqlite-opfs", () => {
	class SqliteEncryptionError extends Error {}
	return { AztecSQLiteOPFSStore: { open: mockOpen }, SqliteEncryptionError }
})

import { SqliteEncryptionError as RealSqliteEncryptionError } from "@aztec/kv-store/sqlite-opfs"
import type { ChainCoordinates } from "./chain-coordinates"
import { ChainStoreWedgedError, openChainStore, WrongStoreKeyError } from "./opfs-store"

// The mocked class (below) inherits Error's 1-arg constructor; the real type
// declares `(code, message)`, so cast to a 1-arg ctor for construction.
const SqliteEncryptionError = RealSqliteEncryptionError as unknown as new (message: string) => Error

const nullLog = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {}, verbose: () => {}, fatal: () => {} } as never
const ROLLUP = "0x00000000000000000000000000000000000000aa"
const key = () => new Uint8Array(32)
const net = (profileId: string, chainId = 1): ChainCoordinates => ({ profileId, chainId })

/** Minimal store satisfying initStoreVersionStamp (fresh → stamps, no clear). */
function fakeStore() {
	const set = vi.fn(async () => {})
	return {
		openSingleton: () => ({ getAsync: async () => undefined, set }),
		clear: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
		_set: set,
	}
}

const open = (n: ChainCoordinates) => openChainStore({ network: n, rollupAddress: ROLLUP, storeKey: key(), log: nullLog })
const flush = () => vi.advanceTimersByTimeAsync(0)

afterEach(() => {
	mockOpen.mockReset()
})

describe("openChainStore — B-07 abandoned-open quarantine", () => {
	test("never-resolving open: first call times out, retries fail fast, worker spawned once", async () => {
		vi.useFakeTimers()
		try {
			mockOpen.mockReturnValueOnce(new Promise(() => {})) // hangs forever
			const n = net("p-never")
			const p1 = open(n).catch((e) => e)
			await vi.advanceTimersByTimeAsync(30_000)
			expect(String(await p1)).toContain("did not answer init within 30s")

			// Retry while quarantined → fail fast, NO second worker.
			await expect(open(n)).rejects.toBeInstanceOf(ChainStoreWedgedError)
			// A retry with the SAME (profileId, chainId) but a different key/url still
			// shares the dir → rejected, never inherits the pending store.
			await expect(open({ ...n })).rejects.toBeInstanceOf(ChainStoreWedgedError)
			expect(mockOpen).toHaveBeenCalledTimes(1)
		} finally {
			vi.useRealTimers()
		}
	})

	test("late-resolving open: the abandoned store is closed exactly once, then the dir frees", async () => {
		vi.useFakeTimers()
		try {
			let resolveOpen!: (s: unknown) => void
			const abandoned = fakeStore()
			mockOpen.mockReturnValueOnce(new Promise((r) => (resolveOpen = r)))
			const n = net("p-late")

			const p1 = open(n).catch((e) => e)
			await vi.advanceTimersByTimeAsync(30_000)
			await p1 // timed out → quarantined

			// The abandoned open resolves LATE → its store is closed once (never handed out).
			resolveOpen(abandoned)
			await flush()
			await flush()
			expect(abandoned.close).toHaveBeenCalledTimes(1)

			// Dir freed → a fresh open now proceeds and spawns a new worker.
			mockOpen.mockResolvedValueOnce(fakeStore())
			await expect(open(n)).resolves.toBeDefined()
			expect(mockOpen).toHaveBeenCalledTimes(2)
		} finally {
			vi.useRealTimers()
		}
	})

	test("a retry during the abandoned store's close still fails fast (no second worker)", async () => {
		vi.useFakeTimers()
		try {
			let resolveOpen!: (s: unknown) => void
			const abandoned = fakeStore()
			let resolveClose!: () => void
			abandoned.close.mockImplementationOnce(() => new Promise<void>((r) => (resolveClose = r)))
			mockOpen.mockReturnValueOnce(new Promise((r) => (resolveOpen = r)))
			const n = net("p-closing")

			const p1 = open(n).catch((e) => e)
			await vi.advanceTimersByTimeAsync(30_000)
			await p1
			resolveOpen(abandoned) // enters "closing" (close is pending)
			await flush()

			// While the close is still in flight, a retry must NOT start a worker.
			await expect(open(n)).rejects.toBeInstanceOf(ChainStoreWedgedError)
			expect(mockOpen).toHaveBeenCalledTimes(1)

			resolveClose() // close finishes → dir frees
			await flush()
			await flush()
			mockOpen.mockResolvedValueOnce(fakeStore())
			await expect(open(n)).resolves.toBeDefined()
		} finally {
			vi.useRealTimers()
		}
	})

	test("open rejection frees the dir immediately; a wrong-key rejection maps to WrongStoreKeyError", async () => {
		const n = net("p-reject")
		mockOpen.mockRejectedValueOnce(new SqliteEncryptionError("bad key"))
		await expect(open(n)).rejects.toBeInstanceOf(WrongStoreKeyError)

		// Dir was freed (open failed, its worker gone) → next call starts fresh.
		mockOpen.mockResolvedValueOnce(fakeStore())
		await expect(open(n)).resolves.toBeDefined()
		expect(mockOpen).toHaveBeenCalledTimes(2)
	})

	test("normal resolution returns the store, never auto-closes it, and stamps the version", async () => {
		const n = net("p-ok")
		const store = fakeStore()
		mockOpen.mockResolvedValueOnce(store)
		const result = await open(n)
		expect(result).toBe(store)
		expect(store.close).not.toHaveBeenCalled() // owned by the caller, not closed
		expect(store._set).toHaveBeenCalledTimes(1) // version stamped

		// The dir is free afterward → a subsequent open proceeds normally.
		mockOpen.mockResolvedValueOnce(fakeStore())
		await expect(open(n)).resolves.toBeDefined()
	})
})
